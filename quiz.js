/*
 * ==========================================
 * MASTER INDEX
 * ==========================================
 * 1. STATE VARIABLES & CONFIG LOAD
 * 2. FIREBASE AUTH & SESSION LOAD
 * 3. CORE QUIZ & SLIDE TRANSITIONS
 * 4. FIREBASE PROGRESS SYNC
 * 5. MULTIPLAYER SYNC ENGINE
 * 6. CLINICAL HIGHLIGHTER TOOL
 * 7. EXAM SUBMISSION & RESULTS
 * 8. TIMERS & MODAL MANAGEMENT
 * 9. EVENT LISTENERS & HOTKEYS
 * 10. EXIT ROUTINES & SESSION CLEANUP
 * ==========================================
 */

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, updateDoc, getDoc, arrayUnion, arrayRemove, onSnapshot, addDoc, collection, serverTimestamp, deleteField, increment } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ==========================================
// 1. STATE VARIABLES & CONFIG LOAD
// ==========================================
let currentUserId = null; 
let currentUserData = null;
let quizQueue = [];
let currentIndex = 0;
let currentQuestionData = null;
let wrongAttempts = 0;
let hasAnsweredCorrectly = false;
let sessionSeconds = 0;
let timerInterval;

let activeRoomId = localStorage.getItem('active_study_room');
let roomRef = activeRoomId ? doc(db, "study_rooms", activeRoomId) : null;
let hasRevealedCurrentQuestion = false;
let hasAnsweredCurrentQuestion = false;
let hasShownSkipPopup = false;
let isIntentionalExit = false;
let isPaused = false;
let floatingHighlightBtn;
let quillHint, quillExplanation, quillQuestion;

const configStr = localStorage.getItem('edeetos_quiz_config');
const quizConfig = configStr ? JSON.parse(configStr) : { mode: 'practice', timer: 0 };
const isExamMode = (quizConfig.mode === 'exam') && !activeRoomId;

function isBookSession() { return quizQueue.length > 0 && quizQueue[0]?.isBookQuestion === true; }

// DOM Cache
const cardEl = document.querySelector('.question-card'); 
const timerDisplay = document.getElementById('timer-display');
const questionTextEl = document.getElementById('question-text');
const optionsContainer = document.getElementById('options-container');
const wrongCountEl = document.getElementById('wrong-count');
const rightCountEl = document.getElementById('right-count');
const feedbackFill = document.getElementById('feedback-fill');
const explanationBtn = document.getElementById('show-explanation-btn');
const explanationModal = document.getElementById('explanation-modal');
const explanationText = document.getElementById('explanation-text');
const closeExplanationBtn = document.getElementById('close-explanation');
const questionIdBadge = document.getElementById('question-id-badge');
const numberGrid = document.getElementById('number-grid');
const skipBtn = document.getElementById('skip-btn');
const skippedWarningEl = document.getElementById('skipped-warning');
const notesModal = document.getElementById('notes-modal');
const noteInput = document.getElementById('note-input');
const closeNotesBtn = document.getElementById('close-notes-btn');
const saveNoteBtn = document.getElementById('save-note-btn');
const qTimerDisplay = document.getElementById('question-timer-display');
const labValuesBtn = document.getElementById('lab-values-btn');
const labValuesModal = document.getElementById('lab-values-modal');
const closeLabValuesBtn = document.getElementById('close-lab-values-btn');
const modalNextBtn = document.getElementById('modal-next-btn');
const aiHintBtn = document.getElementById('ai-hint-btn');
const copyQBtn = document.getElementById('copy-q-btn');
const editQBtn = document.getElementById('edit-q-btn');
const adminEditModal = document.getElementById('admin-edit-modal');
const btnCancelEdit = document.getElementById('btn-cancel-edit');
const btnSaveGithub = document.getElementById('btn-save-github');

if (isExamMode) {
    document.body.classList.add('mode-exam');
    sessionSeconds = quizConfig.timer * 60; 
}

// ==========================================
// 2. FIREBASE AUTH & SESSION LOAD
// ==========================================
async function loadSession() {
    if (activeRoomId && localStorage.getItem('is_study_guest') === 'true') return;
    if (quizQueue && quizQueue.length > 0) return; 

    return new Promise((resolve) => {
        const request = indexedDB.open("EdeetosDB", 1);
        request.onupgradeneeded = (e) => { e.target.result.createObjectStore("quiz_sessions"); };
        request.onsuccess = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains("quiz_sessions")) return window.location.href = 'questions.html';
            const tx = db.transaction("quiz_sessions", "readonly");
            const req = tx.objectStore("quiz_sessions").get("active_quiz_queue");
            req.onsuccess = () => {
                if (!req.result || req.result.length === 0) return window.location.href = 'questions.html';
                quizQueue = req.result;
                quizQueue.forEach((q, i) => {     
                    q.originalNumber = q['QuestionID'] || q['Question ID'] || q['ID'] || q['id'] || `q-${i + 1}`; 
                    q.sessionState = null; 
                    q.historicalState = null; 
                    q.sequenceNumber = i + 1; 
                    q.userSelectedAnswer = null;
                    q.eliminatedOptions = [];
                });
                resolve();
            };
        };
        request.onerror = () => window.location.href = 'questions.html';
    });
}

onAuthStateChanged(auth, async (user) => {
    await loadSession(); 
    
    if (user) {
        currentUserId = user.uid; 
        const userRef = doc(db, "users", user.uid);

        try {
            const docSnap = await getDoc(userRef);
            if (docSnap.exists()) {
                const dbData = docSnap.data();
                currentUserData = dbData;

                if (activeRoomId) {
                    await updateDoc(roomRef, { [`activeMembers.${currentUserId}`]: dbData.fullName || "Student" });
                }

                if (dbData.isBanned || dbData.role === 'BANNED') {
                    indexedDB.deleteDatabase("EdeetosDB");
                    localStorage.removeItem('edeetos_active_quiz');
                    localStorage.removeItem('edeetos_quiz_config');
                    
                    const lockoutScreen = document.createElement('div');
                    lockoutScreen.className = 'modal-overlay-solid';
                    lockoutScreen.innerHTML = `
                        <i class="fas fa-ban modal-icon-lg color-red-500"></i>
                        <h1 class="modal-title">Account Suspended</h1>
                        <button id="btn-banned-logout" class="btn-solid modal-btn-danger modal-btn-lg">Log Out</button>
                    `;
                    document.body.appendChild(lockoutScreen);
                    document.body.style.overflow = 'hidden';

                    document.getElementById('btn-banned-logout').addEventListener('click', async () => {
                        await signOut(auth);
                        window.location.href = 'index.html';
                    });
                    return; 
                }

                const activeCourse = localStorage.getItem('edeetos_active_course') || 'fcps_part1';
                const courseData = dbData[activeCourse] || {};
                const booksData = dbData.books || {};
                const savedNotes = { ...(courseData.notes || {}), ...(booksData.notes || {}) };
                const savedBookmarks = [...(courseData.bookmarks || []), ...(booksData.bookmarks || [])];
                const solvedList = [...(courseData.solvedQuestions || []), ...(booksData.solvedQuestions || [])];
                const mistakesList = [...(courseData.mistakes || []), ...(booksData.mistakes || [])];
                const examMistakesList = [...(courseData.examMistakes || []), ...(booksData.examMistakes || [])];

                quizQueue.forEach(q => {
                    q.isBookmarked = savedBookmarks.includes(q.originalNumber);
                    q.userNote = savedNotes[q.originalNumber] || "";
                    if (mistakesList.includes(q.originalNumber) || examMistakesList.includes(q.originalNumber)) q.historicalState = 'wrong';
                    else if (solvedList.includes(q.originalNumber)) q.historicalState = 'correct';
                });
            }
        } catch (error) { console.error("Firebase Load Error:", error);
        } finally {
            if (quizQueue && quizQueue.length > 0) {
                startTimer();
                if (!isExamMode) buildNumberGrid();
                loadQuestion(0);
            }
        }
    } else {
        if (localStorage.getItem('edeetos_guest_mode') === 'true') {
            if (quizQueue && quizQueue.length > 0) {
                startTimer();
                if (!isExamMode) buildNumberGrid();
                loadQuestion(0);
            }
        } else {
            window.location.href = 'login.html';
        }
    }
});

// ==========================================
// 3. CORE QUIZ & SLIDE TRANSITIONS
// ==========================================
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function formatJSONQuestion(q) {
    if (Array.isArray(q.options)) return q;
    const correctLetter = (q.correctAnswer || q.CorrectAnswer || '').toString().trim().toUpperCase();
    const formattedOptions = [];

    if (q.options && typeof q.options === 'object') {
        ['A', 'B', 'C', 'D', 'E'].forEach(letter => {
            const optText = q.options[letter];
            if (optText && optText.trim() !== '') formattedOptions.push({ text: optText, isCorrect: correctLetter === letter, letter: letter });
        });
    }

    return {
        text: q.question || q.Question || "Missing Question Text",
        options: formattedOptions,
        explanation: q.explanation || q.Explanation || "No explanation provided.",
        hint: q.hint || q.Hint || "", 
        originalNumber: q.QuestionID || q.id || q.originalNumber || `q-${Math.random()}`,
        isBookmarked: q.isBookmarked || false,
        userNote: q.userNote || "",
        sessionState: q.sessionState || null,
        historicalState: q.historicalState || null,
        hasBeenSkipped: q.hasBeenSkipped || false,
        sequenceNumber: q.sequenceNumber || 1, 
        userSelectedAnswer: q.userSelectedAnswer || null,
        Subject: q.Subject || q.subject || "",
        Chapter: q.Chapter || q.chapter || "",
        Topic: q.Topic || q.topic || "",
        isBookQuestion: q.isBookQuestion || false,
        bookName: q.bookName || "",
        Year: q.Year || q.year || "",
        Exam: q.Exam || q.exams || [],
        Difficulty: q.Difficulty || q.difficulty || ""
    };
}

function buildNumberGrid() {
    numberGrid.innerHTML = '';
    quizQueue.forEach((q, index) => {
        const numBtn = document.createElement('div');
        numBtn.className = 'grid-num';
        
        const stateToShow = q.sessionState || q.historicalState;
        if (stateToShow === 'correct') numBtn.classList.add('correct');
        else if (stateToShow === 'wrong' || stateToShow === 'wrong_then_correct') numBtn.classList.add('incorrect');
        
        numBtn.id = `grid-num-${index}`;
        numBtn.textContent = index + 1;
        
        numBtn.onclick = () => {
            if (isExamMode) return; 
            if (activeRoomId && localStorage.getItem('is_study_guest') === 'true') return alert("Only the host can jump to different questions.");
            if(index === currentIndex) return;
            const direction = index > currentIndex ? 'right' : 'left';
            if (activeRoomId) syncNextQuestion(index); 
            triggerSlideTransition(index, direction);
        };
        numberGrid.appendChild(numBtn);
    });
    updateGridStyles();
}

function updateGridStyles() {
    if (isExamMode) return;
    document.querySelectorAll('.grid-num').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`grid-num-${currentIndex}`);
    if (activeBtn) activeBtn.classList.add('active');
}

function triggerSlideTransition(newIndex, direction) {
    const outClass = direction === 'right' ? 'slide-out-left' : 'slide-out-right';
    const inClass = direction === 'right' ? 'slide-in-right' : 'slide-in-left';

    cardEl.className = 'question-card';
    void cardEl.offsetWidth; 
    cardEl.classList.add(outClass);
    
    setTimeout(() => {
        loadQuestion(newIndex);
        cardEl.className = 'question-card'; 
        void cardEl.offsetWidth; 
        cardEl.classList.add(inClass);
    }, 300);
}

function loadQuestion(index) {
    try { 
        currentIndex = index;
        currentQuestionData = quizQueue[currentIndex];

        hasRevealedCurrentQuestion = false;
        hasAnsweredCurrentQuestion = false;
        const waitEl = document.getElementById('multiplayer-waiting-text');
        if (waitEl) waitEl.classList.add('hidden');
        const forceBtn = document.getElementById('host-force-reveal-btn');
        if (forceBtn) forceBtn.classList.add('hidden');

        const roleUpper = (currentUserData?.role || 'STUDENT').toUpperCase();
        if (roleUpper === 'ADMIN' || roleUpper === 'MANAGEMENT') {
            if (copyQBtn) copyQBtn.classList.remove('hidden');
            if (editQBtn) editQBtn.classList.remove('hidden');
        } else {
            if (copyQBtn) copyQBtn.classList.add('hidden');
            if (editQBtn) editQBtn.classList.add('hidden');
        }

        if (!currentQuestionData.options || !Array.isArray(currentQuestionData.options)) {
            quizQueue[currentIndex] = formatJSONQuestion(currentQuestionData);
            currentQuestionData = quizQueue[currentIndex];
        }

        wrongAttempts = 0;
        hasAnsweredCorrectly = false;
        
        if (aiHintBtn) { aiHintBtn.classList.add('hidden'); aiHintBtn.innerHTML = `<i class="fas fa-lightbulb"></i> Hint`; }
        if (floatingHighlightBtn) floatingHighlightBtn.style.display = 'none'; 
        if (!isExamMode) updateFeedbackBar();
        
        if (hasAnsweredCorrectly && !isExamMode && !activeRoomId) {
            explanationBtn.classList.remove('hidden');
        } else {
            explanationBtn.classList.add('hidden');
            explanationModal.classList.remove('show');
        }

        const displayNum = currentQuestionData.sequenceNumber || (currentIndex + 1);
        if (questionIdBadge) questionIdBadge.textContent = isExamMode ? `Question ${displayNum} / ${quizQueue.length}` : `Question ${displayNum}`;

        const diffBadge = document.getElementById('question-difficulty-badge');
        if (diffBadge) {
            const diffText = (currentQuestionData.Difficulty || "").toLowerCase().trim();
            diffBadge.className = 'diff-badge';
            if (diffText === 'easy') { diffBadge.textContent = "Easy"; diffBadge.classList.add('diff-badge-easy'); diffBadge.classList.remove('hidden'); }
            else if (diffText === 'medium') { diffBadge.textContent = "Medium"; diffBadge.classList.add('diff-badge-medium'); diffBadge.classList.remove('hidden'); }
            else if (diffText === 'hard') { diffBadge.textContent = "Hard"; diffBadge.classList.add('diff-badge-hard'); diffBadge.classList.remove('hidden'); }
            else { diffBadge.classList.add('hidden'); }
        }

        if (isExamMode) {
            if (currentQuestionData.hasBeenSkipped) {
                skippedWarningEl.classList.remove('hidden');
                skipBtn.style.display = 'none'; 
                if (!hasShownSkipPopup) { showSkippedModal(); hasShownSkipPopup = true; }
            } else {
                skippedWarningEl.classList.add('hidden');
                skipBtn.style.display = 'block';
            }
            document.getElementById('next-btn').textContent = (currentIndex === quizQueue.length - 1) ? "Submit Exam" : "Next";
        }

        const examYearInfo = document.getElementById('exam-year-info');
        if (examYearInfo) {
            examYearInfo.innerHTML = ''; 
            let badgesHTML = '';
            let yearData = currentQuestionData.Year || currentQuestionData.year;
            let yearList = Array.isArray(yearData) ? yearData : (typeof yearData === 'string' && yearData.trim() !== '' ? yearData.split(',') : []);
            let examData = currentQuestionData.Exam || currentQuestionData.exams;
            let examList = Array.isArray(examData) ? examData : (examData ? [examData] : []);

            if ((yearList.length > 0 || examList.length > 0) && !isExamMode) {
                examYearInfo.classList.remove('hidden');
                if (yearList.length > 0) badgesHTML += `<span class="badge-year"><i class="fas fa-history"></i> ${yearList.join(', ')}</span>`;
                examList.forEach(ex => { if (ex.trim()) badgesHTML += `<span class="badge-exam"><i class="fas fa-file-signature"></i> ${ex.trim()}</span>`; });
                examYearInfo.innerHTML = badgesHTML;
            } else {
                examYearInfo.classList.add('hidden');
            }
        }

        questionTextEl.innerHTML = currentQuestionData.text || "Missing Question";
        explanationText.innerHTML = currentQuestionData.explanation || "No explanation provided.";

        optionsContainer.innerHTML = '';
        shuffleArray(currentQuestionData.options);
        currentQuestionData.options.forEach(opt => {
            const optBox = document.createElement('div');
            optBox.className = 'option-box';
            optBox.setAttribute('role', 'button');
            optBox.setAttribute('tabindex', '0');
            
            if (isExamMode && currentQuestionData.userSelectedAnswer === opt.text) optBox.classList.add('selected');
            else if (!isExamMode && hasAnsweredCorrectly && !activeRoomId) {
                if (opt.isCorrect) optBox.classList.add('correct');
                optBox.classList.add('locked');
            }

            if (currentQuestionData.eliminatedOptions && currentQuestionData.eliminatedOptions.includes(opt.text)) optBox.classList.add('strikethrough');

            optBox.innerHTML = `
                <div class="option-text">${opt.text}</div>
                <div style="display: flex; gap: 8px;">
                    <button class="strike-btn" title="Strike out option"><i class="fas fa-strikethrough"></i></button>
                </div>
            `;
            
            optBox.addEventListener('click', (e) => {
                e.preventDefault();
                if (e.target.closest('.strike-btn')) {
                    optBox.classList.toggle('strikethrough');
                    if (!currentQuestionData.eliminatedOptions) currentQuestionData.eliminatedOptions = [];
                    if (optBox.classList.contains('strikethrough')) currentQuestionData.eliminatedOptions.push(opt.text);
                    else currentQuestionData.eliminatedOptions = currentQuestionData.eliminatedOptions.filter(t => t !== opt.text);
                    return; 
                }
                handleOptionClick(e, opt, optBox);
            });
            optionsContainer.appendChild(optBox);
        });

        setupControlListeners();
        updateGridStyles();

    } catch (error) { 
        console.error("🚨 CRASH inside loadQuestion:", error);
    }
}

function handleOptionClick(event, optionData, optionElement) {
    if (isExamMode) {
        document.querySelectorAll('.option-box').forEach(b => b.classList.remove('selected'));
        optionElement.classList.add('selected');
        currentQuestionData.userSelectedAnswer = optionData.text;
        skipBtn.style.display = 'none';
        return; 
    }

    if (activeRoomId) {
        if (hasAnsweredCurrentQuestion || hasRevealedCurrentQuestion) return;
        hasAnsweredCurrentQuestion = true;
        optionElement.style.border = "2px solid #3b82f6";
        document.querySelectorAll('.option-box').forEach(box => box.classList.add('locked'));
        updateDoc(roomRef, { [`answers.${currentIndex}.${currentUserId}`]: optionData.text });
        return;
    }

    if (hasAnsweredCorrectly || optionElement.classList.contains('incorrect')) return; 

    if (!optionData.isCorrect) {
        optionElement.classList.remove('apply-shake');
        void optionElement.offsetWidth;
        optionElement.classList.add('incorrect', 'apply-shake');
        wrongAttempts++;
        updateFeedbackBar();
        
        if (!currentQuestionData.sessionState) {
            currentQuestionData.sessionState = 'wrong'; 
            const btn = document.getElementById(`grid-num-${currentIndex}`);
            if (btn) { btn.classList.remove('correct'); btn.classList.add('incorrect'); }
        }
        savePracticeProgress(currentQuestionData.originalNumber, false); 
        
    } else {
        optionElement.classList.remove('apply-pop');
        void optionElement.offsetWidth; 
        optionElement.classList.add('correct', 'apply-pop');
        hasAnsweredCorrectly = true;
        
        document.querySelectorAll('.option-box').forEach(box => box.classList.add('locked'));
        updateFeedbackBar();

        if (!currentQuestionData.sessionState) {
            currentQuestionData.sessionState = 'correct'; 
            const btn = document.getElementById(`grid-num-${currentIndex}`);
            if (btn) { btn.classList.remove('incorrect'); btn.classList.add('correct'); }
        } else if (currentQuestionData.sessionState === 'wrong') {
            currentQuestionData.sessionState = 'wrong_then_correct';
        }
        
        savePracticeProgress(currentQuestionData.originalNumber, true); 
        
        explanationBtn.classList.remove('hidden'); 
        setTimeout(() => {
            if (explanationModal) {
                explanationModal.classList.remove('hidden');
                explanationModal.classList.add('show');
            }
        }, 600);
    }
}

function updateFeedbackBar() {
    wrongCountEl.textContent = `${wrongAttempts} ✖`;
    rightCountEl.textContent = `${hasAnsweredCorrectly ? 1 : 0} ✔`;
    const totalAttempts = wrongAttempts + (hasAnsweredCorrectly ? 1 : 0);
    if (totalAttempts > 0) feedbackFill.style.width = `${(hasAnsweredCorrectly ? 1 : 0) / totalAttempts * 100}%`;
    else feedbackFill.style.width = `0%`;
}

// ==========================================
// 4. FIREBASE PROGRESS SYNC
// ==========================================
async function syncNextQuestion(newIndex) {
    const isGuest = localStorage.getItem('is_study_guest') === 'true';
    if (!isGuest && activeRoomId) await updateDoc(doc(db, "study_rooms", activeRoomId), { currentQuestionIndex: newIndex });
}

async function savePracticeProgress(questionId, isCorrect) {
    if (localStorage.getItem('edeetos_guest_mode') === 'true') return;
    const user = auth.currentUser;
    if (!user) return; 
    const userRef = doc(db, "users", user.uid);
    const rootKey = isBookSession() ? "books" : (localStorage.getItem('edeetos_active_course') || 'fcps_part1');
    let updates = {};

    if (isCorrect) {
        updates.solvedQuestions = arrayUnion(questionId); 
        if (wrongAttempts === 0) {
            updates.mistakes = arrayRemove(questionId);      
            updates.examMistakes = arrayRemove(questionId);   
        }
    } else updates.mistakes = arrayUnion(questionId);
    try { await setDoc(userRef, { [rootKey]: updates }, { merge: true }); } catch (error) { console.error("Progress Error:", error); }
}

async function savePracticeTime(timeInSeconds) {
    if (localStorage.getItem('edeetos_guest_mode') === 'true') return;
    const user = auth.currentUser;
    if (!user || timeInSeconds <= 0) return; 
    const userRef = doc(db, "users", user.uid);
    const rootKey = isBookSession() ? "books" : (localStorage.getItem('edeetos_active_course') || 'fcps_part1');
    try { await setDoc(userRef, { [rootKey]: { practiceTimeSpent: increment(timeInSeconds) } }, { merge: true }); } catch (error) { console.error("Time Sync Error:", error); }
}

async function saveExamProgress(correctIds, mistakeIds, correctCount, totalQuestions, timeSpent) {
    if (localStorage.getItem('edeetos_guest_mode') === 'true') return;
    const user = auth.currentUser;
    if (!user) return; 
    const userRef = doc(db, "users", user.uid);
    const rootKey = isBookSession() ? "books" : (localStorage.getItem('edeetos_active_course') || 'fcps_part1');
    try {
        let updates = {};
        if (correctIds.length > 0) updates.examMistakes = arrayRemove(...correctIds);  
        if (mistakeIds.length > 0) updates.examMistakes = arrayUnion(...mistakeIds);
        const examRecord = { examName: quizConfig.examName || "Custom Exam", score: correctCount, totalQuestions: totalQuestions, percentage: Math.round((correctCount / totalQuestions) * 100), timeSpent: timeSpent, date: new Date().toISOString() };
        updates.examHistory = arrayUnion(examRecord);
        if (Object.keys(updates).length > 0) await setDoc(userRef, { [rootKey]: updates }, { merge: true });
    } catch (error) { console.error("Exam Progress Sync Error:", error); }
}

async function toggleBookmarkInFirebase(questionId, isBookmarking) {
    if (localStorage.getItem('edeetos_guest_mode') === 'true' || !auth.currentUser) return;
    const rootKey = isBookSession() ? "books" : (localStorage.getItem('edeetos_active_course') || 'fcps_part1');
    try { await setDoc(doc(db, "users", auth.currentUser.uid), { [rootKey]: { bookmarks: isBookmarking ? arrayUnion(questionId) : arrayRemove(questionId) } }, { merge: true }); } catch (error) { console.error("Bookmark Error:", error); }
}

async function saveNoteToFirebase(questionId, noteText) {
    if (localStorage.getItem('edeetos_guest_mode') === 'true' || !auth.currentUser) return;
    const rootKey = isBookSession() ? "books" : (localStorage.getItem('edeetos_active_course') || 'fcps_part1');
    try { await setDoc(doc(db, "users", auth.currentUser.uid), { [rootKey]: { notes: { [questionId]: noteText } } }, { merge: true }); } catch (error) { console.error("Note Error:", error); }
}

// ==========================================
// 5. MULTIPLAYER SYNC ENGINE
// ==========================================
function revealMultiplayerAnswers(answersObj, activeMembersMap) {
    hasRevealedCurrentQuestion = true;
    const waitEl = document.getElementById('multiplayer-waiting-text');
    if (waitEl) waitEl.classList.add('hidden');
    const forceBtn = document.getElementById('host-force-reveal-btn');
    if (forceBtn) forceBtn.classList.add('hidden');

    const myAnswerText = answersObj[currentUserId];
    if (myAnswerText) {
        const myOpt = currentQuestionData.options.find(o => o.text === myAnswerText);
        if (myOpt) {
            if (myOpt.isCorrect) { hasAnsweredCorrectly = true; savePracticeProgress(currentQuestionData.originalNumber, true); } 
            else { wrongAttempts++; savePracticeProgress(currentQuestionData.originalNumber, false); }
        }
    }
    
    updateFeedbackBar();
    explanationBtn.classList.remove('hidden');
    document.querySelectorAll('.option-box').forEach(box => box.classList.add('locked'));

    document.querySelectorAll('.option-box').forEach(box => {
        const optText = box.querySelector('.option-text')?.textContent || '';
        const isOptCorrect = currentQuestionData.options.find(o => o.text === optText)?.isCorrect;

        if (isOptCorrect) box.classList.add('correct', 'apply-pop');
        else if (Object.values(answersObj).includes(optText)) box.classList.add('incorrect');

        const voters = Object.keys(answersObj).filter(uid => answersObj[uid] === optText);
        if (voters.length > 0) {
            const tagContainer = document.createElement('div');
            tagContainer.className = "mp-tag-container";
            voters.forEach(uid => {
                const name = activeMembersMap[uid] || "Student";
                const isMe = uid === currentUserId;
                const bg = isMe ? "#3b82f6" : "rgba(0,0,0,0.1)";
                const color = isMe ? "white" : "inherit";
                tagContainer.innerHTML += `<span class="mp-tag" style="background: ${bg}; color: ${color};">${name}</span>`;
            });
            box.appendChild(tagContainer);
        }
    });
}

if (roomRef) {
    onSnapshot(roomRef, (snapshot) => {
        const data = snapshot.data();
        if (!data || data.status === "ended") return showPracticeCompleteModal(true);

        const isGuest = localStorage.getItem('is_study_guest') === 'true';

        if (data.status === "waiting" && isGuest) {
            if (!document.getElementById('mp-lobby-screen')) {
                const lobby = document.createElement('div');
                lobby.id = 'mp-lobby-screen';
                lobby.className = 'modal-overlay-solid';
                lobby.innerHTML = `<i class="fas fa-users modal-icon-md color-blue-500"></i><h2 class="modal-title">Waiting for Host...</h2><p class="modal-desc">The host is picking the test material.</p>`;
                document.body.appendChild(lobby);
            }
            return;
        }

        if (data.status === "playing" && isGuest) {
            const lobby = document.getElementById('mp-lobby-screen');
            if (lobby) lobby.remove();
            const isNewBatch = !quizQueue || quizQueue.length === 0 || (data.questions && data.questions.length > 0 && quizQueue[0].text !== data.questions[0].text);
            if (isNewBatch && data.questions) {
                quizQueue = data.questions;
                quizQueue.forEach((q, i) => { if (!q.originalNumber) q.originalNumber = q['QuestionID'] || `q-${i + 1}`; });
                buildNumberGrid();
                loadQuestion(data.currentQuestionIndex || 0);
            }
        }

        if (quizQueue && quizQueue.length > 0 && data.currentQuestionIndex !== undefined && data.currentQuestionIndex !== currentIndex) {
            triggerSlideTransition(data.currentQuestionIndex, data.currentQuestionIndex > currentIndex ? 'right' : 'left');
        }

        if (data.status === "playing" && activeRoomId) {
            const currentAnswers = (data.answers && data.answers[currentIndex]) ? data.answers[currentIndex] : {};
            const activeMembers = data.activeMembers || {};
            const answerCount = Object.keys(currentAnswers).length;
            const memberCount = Object.keys(activeMembers).length || 1;

            let rosterBox = document.getElementById('mp-roster-box');
            if (!rosterBox) {
                rosterBox = document.createElement('div');
                rosterBox.id = 'mp-roster-box';
                rosterBox.className = 'mp-roster-box';
                cardEl.parentElement.insertBefore(rosterBox, cardEl);
            }

            let rosterHtml = `<h4 class="mp-roster-header"><i class="fas fa-users color-emerald-500"></i> Live Roster</h4>`;
            Object.keys(activeMembers).forEach(uid => {
                const name = activeMembers[uid];
                const hasAnswered = currentAnswers.hasOwnProperty(uid);
                rosterHtml += `
                    <div class="mp-roster-row">
                        <span class="mp-roster-name" style="font-weight: ${uid === currentUserId ? '800' : '500'};">${name} ${uid === currentUserId ? "(You)" : ""}</span>
                        <span class="mp-roster-status">${hasAnswered ? "Locked In" : "Thinking"} <div class="mp-status-dot" style="background: ${hasAnswered ? "#10b981" : "#94a3b8"};"></div></span>
                    </div>`;
            });
            rosterBox.innerHTML = rosterHtml;

            let waitEl = document.getElementById('multiplayer-waiting-text');
            if (!waitEl) {
                waitEl = document.createElement('div');
                waitEl.id = 'multiplayer-waiting-text';
                waitEl.className = 'mp-wait-text';
                optionsContainer.parentElement.appendChild(waitEl);
            }

            if (hasAnsweredCurrentQuestion && !hasRevealedCurrentQuestion) {
                waitEl.classList.remove('hidden');
                waitEl.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Waiting for others... (${answerCount}/${memberCount} answered)`;
            }

            if (!isGuest && !hasRevealedCurrentQuestion) {
                let forceBtn = document.getElementById('host-force-reveal-btn');
                if (!forceBtn) {
                    forceBtn = document.createElement('button');
                    forceBtn.id = 'host-force-reveal-btn';
                    forceBtn.className = 'btn-outline btn-force-reveal';
                    forceBtn.innerHTML = "Force Reveal Answers (Someone disconnected?)";
                    optionsContainer.parentElement.appendChild(forceBtn);
                    forceBtn.onclick = () => updateDoc(roomRef, { [`forceReveal.${currentIndex}`]: true });
                }
                if (answerCount > 0 && answerCount < memberCount) forceBtn.classList.remove('hidden'); else forceBtn.classList.add('hidden');
            }

            if ((answerCount >= memberCount || (data.forceReveal && data.forceReveal[currentIndex])) && !hasRevealedCurrentQuestion && answerCount > 0) {
                revealMultiplayerAnswers(currentAnswers, data.activeMembers);
            }
        }
    });
}

// ==========================================
// 6. CLINICAL HIGHLIGHTER TOOL
// ==========================================
if (!document.getElementById('floating-toolkit')) {
    floatingHighlightBtn = document.createElement('div');
    floatingHighlightBtn.id = 'floating-toolkit';
    floatingHighlightBtn.className = 'floating-toolkit';
    floatingHighlightBtn.innerHTML = `
        <button id="tool-hl-yellow" class="toolkit-btn toolkit-btn-hl" title="Highlight"><i class="fas fa-highlighter"></i></button>
        <button id="tool-hl-strike" class="toolkit-btn toolkit-btn-strike" title="Strike">S</button>
    `;
    document.body.appendChild(floatingHighlightBtn);
} else { floatingHighlightBtn = document.getElementById('floating-toolkit'); }

if (questionTextEl) {
    const handleTextSelection = () => {
        setTimeout(() => {
            const selection = window.getSelection();
            if (selection.toString().trim().length > 0 && questionTextEl.contains(selection.anchorNode)) {
                const range = selection.getRangeAt(0);
                const rect = range.getBoundingClientRect();
                floatingHighlightBtn.style.top = `${rect.top + window.scrollY - 45}px`;
                floatingHighlightBtn.style.left = `${rect.left + window.scrollX + (rect.width / 2) - 45}px`;
                floatingHighlightBtn.style.display = 'flex';
                
                const applyYellow = (e) => { e.preventDefault(); applyTextFormat(range, selection, 'hl-yellow-style'); };
                const applyStrike = (e) => { e.preventDefault(); applyTextFormat(range, selection, 'hl-strike-style'); };
                document.getElementById('tool-hl-yellow').onmousedown = applyYellow;
                document.getElementById('tool-hl-yellow').ontouchstart = applyYellow;
                document.getElementById('tool-hl-strike').onmousedown = applyStrike;
                document.getElementById('tool-hl-strike').ontouchstart = applyStrike;
            } else { floatingHighlightBtn.style.display = 'none'; }
        }, 50);
    };

    questionTextEl.addEventListener('mouseup', handleTextSelection);
    questionTextEl.addEventListener('touchend', handleTextSelection);
    document.addEventListener('selectionchange', () => { if (window.getSelection().toString().trim().length === 0) floatingHighlightBtn.style.display = 'none'; });
    const hideToolkit = (e) => { if (e.target.closest('#floating-toolkit') === null) floatingHighlightBtn.style.display = 'none'; };
    document.addEventListener('mousedown', hideToolkit);
    document.addEventListener('touchstart', hideToolkit, { passive: true });
}

function applyTextFormat(range, selection, className) {
    try {
        const mark = document.createElement('span');
        mark.className = className;
        const fragment = range.extractContents();
        mark.appendChild(fragment);
        range.insertNode(mark);
    } catch (err) {
        const mark = document.createElement('mark');
        mark.className = className;
        range.surroundContents(mark);
    }
    selection.removeAllRanges();
    if (floatingHighlightBtn) floatingHighlightBtn.style.display = 'none';
}

// ==========================================
// 7. EXAM SUBMISSION & RESULTS
// ==========================================
function exitSafely(url) {
    isIntentionalExit = true;
    localStorage.removeItem('edeetos_aborted_session_backup');
    localStorage.removeItem('edeetos_challenge_data');
    window.location.href = url;
}

function showResults() {
    clearInterval(timerInterval);    
    let correctCount = 0; let correctIds = []; let mistakeIds = [];
    
    quizQueue.forEach(q => {
        let correctOpt = q.options.find(o => o.isCorrect);
        if (correctOpt && q.userSelectedAnswer === correctOpt.text) { correctCount++; correctIds.push(q.originalNumber); } 
        else { mistakeIds.push(q.originalNumber); }
    });

    const total = quizQueue.length;
    const percentage = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    
    document.getElementById('quiz-ui-container').classList.add('hidden');
    document.getElementById('bottom-actions-container').classList.add('hidden');
    
    const resultsEl = document.getElementById('exam-result-screen');
    resultsEl.classList.remove('hidden');
    resultsEl.classList.add('result-pop-in'); 
    
    const titleEl = document.getElementById('result-title');
    document.getElementById('result-score').textContent = `You scored ${correctCount} out of ${total} (${percentage}%)`;
    
    if (percentage >= 75) {
        titleEl.innerHTML = `<i class="fas fa-check-circle" style="font-size: 3.5rem; display: block; margin-bottom: 1rem; color: #10b981;"></i> 🎉 Passed!`;
        titleEl.style.color = "#065f46";
    } else {
        titleEl.innerHTML = `<i class="fas fa-times-circle" style="font-size: 3.5rem; display: block; margin-bottom: 1rem; color: #ef4444;"></i> ❌ Failed`;
        titleEl.style.color = "#991b1b";
    }

    const challengeBtn = document.getElementById('btn-challenge-friend');
    if (isExamMode && challengeBtn) {
        challengeBtn.classList.remove('hidden');
        challengeBtn.onclick = async (e) => {
            e.preventDefault(); challengeBtn.textContent = "Generating Code..."; challengeBtn.disabled = true;
            const timeTaken = (quizConfig.timer * 60) - sessionSeconds;
            const code = Math.random().toString(36).substring(2, 7).toUpperCase();
            try {
                const sanitizedQueue = quizQueue.map(q => ({ ...q, userSelectedAnswer: null, sessionState: null, historicalState: null, eliminatedOptions: [], isBookmarked: false, userNote: "" }));
                const cleanQueue = JSON.parse(JSON.stringify(sanitizedQueue, (k, v) => v === undefined ? null : v));
                await setDoc(doc(db, "friend_challenges", code), { hostName: currentUserData?.fullName || "A Friend", score: correctCount, total: total, timeTaken: timeTaken, calcMinutes: quizConfig.timer, queue: cleanQueue, timestamp: serverTimestamp() });
                const challengeText = `I just wrapped up a rigorous mock exam on EDEETOS and scored ${correctCount} out of ${total}! 🎯\n\nThink you have what it takes to beat my accuracy and time? Step up to the Friend Challenge and prove it.\n\nDrop my Challenge Code in the app: *${code}*\n\nLet's see who really knows their stuff!`;
                document.getElementById('share-message-text').innerText = challengeText;
                document.getElementById('btn-whatsapp-share').href = `https://api.whatsapp.com/send?text=${encodeURIComponent(challengeText)}`;
                
                document.getElementById('btn-copy-share').onclick = () => {
                    navigator.clipboard.writeText(challengeText).then(() => {
                        document.getElementById('btn-copy-share').innerHTML = `<i class="fas fa-check"></i> Copied!`;
                        setTimeout(() => document.getElementById('btn-copy-share').innerHTML = `<i class="fas fa-copy"></i> Copy Message`, 2000);
                    });
                };
                document.getElementById('close-share-modal').onclick = () => {
                    document.getElementById('share-challenge-modal').classList.remove('show');
                    setTimeout(() => document.getElementById('share-challenge-modal').classList.add('hidden'), 300);
                };
                challengeBtn.innerHTML = `🎯 Challenge Code: <strong>${code}</strong>`; challengeBtn.disabled = false;
                document.getElementById('share-challenge-modal').classList.remove('hidden'); document.getElementById('share-challenge-modal').classList.add('show');
            } catch (err) { console.error("Challenge Link Error:", err); challengeBtn.textContent = "Error Generating Link"; challengeBtn.disabled = false; }
        };
    }

    const saveExamData = async () => {
        const timeTaken = (quizConfig.timer * 60) - sessionSeconds; 
        const tasks = [];
        if (isExamMode) tasks.push(saveExamProgress(correctIds, mistakeIds, correctCount, total, timeTaken));
        tasks.push(updateSpacedRepetition());
        const assignedExamId = localStorage.getItem('edeetos_assigned_exam_id');
        if (assignedExamId && currentUserId) tasks.push(updateDoc(doc(db, "assigned_exams", assignedExamId), { isCompletedBy: arrayUnion(currentUserId) }));
        await Promise.all(tasks); localStorage.removeItem('edeetos_assigned_exam_id');
    };

    const reviewBtn = document.getElementById('btn-review-exam-mistakes');
    if (mistakeIds.length > 0 && reviewBtn) {
        reviewBtn.classList.remove('hidden');
        reviewBtn.onclick = async (e) => {
            e.preventDefault(); reviewBtn.textContent = "Loading Review..."; reviewBtn.disabled = true; document.getElementById('btn-return-home').disabled = true;
            await saveExamData();
            const mistakeQuestions = quizQueue.filter(q => mistakeIds.includes(q.originalNumber));
            const request = indexedDB.open("EdeetosDB", 1);
            request.onsuccess = (e) => {
                const tx = e.target.result.transaction("quiz_sessions", "readwrite");
                tx.objectStore("quiz_sessions").put(mistakeQuestions, "active_quiz_queue");
                tx.oncomplete = () => { localStorage.setItem('edeetos_quiz_config', JSON.stringify({ mode: 'practice', timer: 0, examName: 'Exam Review' })); window.location.reload(); };
            };
        };
    }

    document.getElementById('btn-return-home').onclick = async (e) => {
        e.preventDefault(); e.target.textContent = "Saving Exam Data..."; e.target.disabled = true;
        await saveExamData(); exitSafely('questions.html');
    };
}

function showPracticeCompleteModal(isGuest = false) {
    if (document.getElementById('practice-complete-modal')) return; 
    const modal = document.createElement('div');
    modal.id = 'practice-complete-modal';
    modal.className = 'modal-overlay-solid';
    const title = isGuest ? "Session Ended" : "Practice Complete!";
    const desc = isGuest ? "The host has finished the session and closed the study room." : "Great job! You have finished all the questions.";
    modal.innerHTML = `
        <i class="fas fa-check-circle modal-icon-lg color-emerald-500"></i>
        <h1 class="modal-title">${title}</h1>
        <p class="modal-desc">${desc}</p>
        <button id="btn-practice-home" class="btn-solid modal-btn-lg modal-btn-primary">Save & Return Home</button>
    `;
    document.body.appendChild(modal); document.body.style.overflow = 'hidden';
    document.getElementById('btn-practice-home').addEventListener('click', async (e) => {
        e.target.textContent = "Saving Progress..."; e.target.disabled = true;
        const tasks = [updateSpacedRepetition()];
        if (!isExamMode) tasks.push(savePracticeTime(sessionSeconds));
        await Promise.all(tasks);
        if (!activeRoomId) { localStorage.removeItem('active_study_room'); localStorage.removeItem('is_study_guest'); }
        exitSafely('questions.html'); 
    });
}

function showSkippedModal() {
    const modal = document.createElement('div');
    modal.id = 'skipped-popup-modal';
    modal.className = 'modal-overlay-solid';
    modal.innerHTML = `
        <i class="fas fa-exclamation-triangle modal-icon-lg color-amber-500"></i>
        <h1 class="modal-title">Skipped Questions Phase</h1>
        <p class="modal-desc">You are now returning to the questions you skipped. You must answer them now and can no longer skip.</p>
        <button id="btn-understood-skip" class="btn-solid modal-btn-lg modal-btn-primary">Understood (Enter)</button>
    `;
    document.body.appendChild(modal);
    document.getElementById('btn-understood-skip').onclick = () => modal.remove();
}

function showMustAnswerModal() {
    if (document.getElementById('must-answer-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'must-answer-modal';
    modal.className = 'modal-overlay-solid';
    modal.innerHTML = `
        <div class="glass-panel modal-content text-center">
            <i class="fas fa-exclamation-circle modal-icon-md color-amber-500"></i>
            <h2 class="color-blue-900 mt-0 mb-sm">Select an Answer</h2>
            <p class="color-slate-600 mb-md">Please select an answer to proceed. If you are stuck, use the <strong>Skip</strong> button.</p>
            <button id="btn-understood-must-answer" class="btn-solid modal-btn-primary w-full">Understood (Enter)</button>
        </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('btn-understood-must-answer').onclick = () => modal.remove();
}

// ==========================================
// 8. TIMERS & MODAL MANAGEMENT
// ==========================================
const pauseOverlay = document.createElement('div');
pauseOverlay.id = 'pause-overlay';
pauseOverlay.className = 'modal-overlay-solid hidden';
pauseOverlay.innerHTML = `
    <i class="fas fa-pause-circle modal-icon-lg color-blue-500"></i>
    <h1 class="modal-title">Session Paused</h1>
    <p class="modal-desc">Timer is frozen. Question text is hidden to prevent cheating.</p>
    <button id="btn-resume-quiz" class="btn-solid modal-btn-lg modal-btn-success">Resume Session</button>
`;
document.body.appendChild(pauseOverlay);

document.getElementById('btn-resume-quiz').onclick = () => {
    isPaused = false;
    pauseOverlay.classList.add('hidden');
};

function startTimer() {
    if (!isExamMode && timerDisplay && timerDisplay.parentElement && !document.getElementById('pause-btn')) {
        const pauseBtn = document.createElement('button');
        pauseBtn.id = 'pause-btn';
        pauseBtn.className = 'btn-pause';
        pauseBtn.innerHTML = '<i class="fas fa-pause"></i> Pause';
        timerDisplay.parentElement.parentElement.appendChild(pauseBtn);
        pauseBtn.onclick = () => { isPaused = true; pauseOverlay.classList.remove('hidden'); };
    }

    timerInterval = setInterval(() => {
        if (isPaused) return; 
        if (isExamMode) {
            sessionSeconds--; 
            if (sessionSeconds <= 0) { clearInterval(timerInterval); alert("Time is up! Submitting exam automatically."); showResults(); return; }
        } else { sessionSeconds++; }

        if (timerDisplay) {
            timerDisplay.textContent = `${Math.floor(sessionSeconds / 60).toString().padStart(2, '0')}:${(sessionSeconds % 60).toString().padStart(2, '0')}`;
            if (isExamMode && sessionSeconds <= 300 && sessionSeconds > 0) timerDisplay.classList.add('stress-active');
            else timerDisplay.classList.remove('stress-active');
        }
        
        const challengeDataStr = localStorage.getItem('edeetos_challenge_data');
        if (challengeDataStr && isExamMode) {
            const cData = JSON.parse(challengeDataStr);
            document.getElementById('challenge-tracker-wrapper').classList.remove('hidden');
            document.getElementById('challenge-name-display').textContent = `${cData.hostName}'s Pace`;
            document.getElementById('challenge-target-display').textContent = `Target: ${cData.score}/${cData.total}`;
            document.getElementById('challenge-bar-fill').style.width = `${Math.min((((quizConfig.timer * 60) - sessionSeconds) / cData.timeTaken) * 100, 100)}%`;
        }
		
        if (currentQuestionData) {
            currentQuestionData.timeSpent = (currentQuestionData.timeSpent || 0) + 1;
            if (qTimerDisplay) qTimerDisplay.textContent = `${Math.floor(currentQuestionData.timeSpent / 60).toString().padStart(2, '0')}:${(currentQuestionData.timeSpent % 60).toString().padStart(2, '0')}`;
            if (!isExamMode && !hasAnsweredCorrectly && currentQuestionData.timeSpent === 15 && aiHintBtn) {
                aiHintBtn.classList.remove('hidden');
                aiHintBtn.classList.add('pop-in'); 
            }
        }
    }, 1000);
}

// ==========================================
// 9. EVENT LISTENERS & HOTKEYS
// ==========================================
function setupControlListeners() {
    const bookmarkBtn = document.getElementById('bookmark-btn');
    if (bookmarkBtn) {
        const starIcon = bookmarkBtn.querySelector('i');
        if (currentQuestionData.isBookmarked) starIcon.classList.replace('far', 'fas'), starIcon.classList.add('fa-solid');
        else starIcon.classList.replace('fas', 'far'), starIcon.classList.remove('fa-solid');
        bookmarkBtn.onclick = (e) => {
            e.preventDefault();
            if (localStorage.getItem('edeetos_guest_mode') === 'true') return alert("Please register an account to bookmark questions.");
            currentQuestionData.isBookmarked = !currentQuestionData.isBookmarked;
            if (currentQuestionData.isBookmarked) starIcon.classList.replace('far', 'fas'), starIcon.classList.add('fa-solid');
            else starIcon.classList.replace('fas', 'far'), starIcon.classList.remove('fa-solid');
            toggleBookmarkInFirebase(currentQuestionData.originalNumber, currentQuestionData.isBookmarked);
        };
    }

    const noteBtn = document.getElementById('note-btn');
    if (noteBtn) {
        noteBtn.onclick = (e) => {
            e.preventDefault();
            if (localStorage.getItem('edeetos_guest_mode') === 'true') return alert("Please register an account to save personal notes.");
            if (noteInput) noteInput.value = currentQuestionData.userNote || ""; 
            if (notesModal) { notesModal.classList.remove('hidden'); notesModal.classList.add('show'); }
        };
    }
}

if (saveNoteBtn) saveNoteBtn.onclick = () => {
    currentQuestionData.userNote = noteInput.value.trim(); 
    saveNoteToFirebase(currentQuestionData.originalNumber, currentQuestionData.userNote);
    notesModal.classList.remove('show'); setTimeout(() => notesModal.classList.add('hidden'), 300);
};

if (closeNotesBtn) closeNotesBtn.onclick = () => { notesModal.classList.remove('show'); setTimeout(() => notesModal.classList.add('hidden'), 300); };

const btnReport = document.getElementById('btn-report');
const reportModal = document.getElementById('report-modal');
if (btnReport) btnReport.onclick = () => { document.getElementById('report-reason-input').value = ""; reportModal.classList.remove('hidden'); reportModal.classList.add('show'); };
if (document.getElementById('close-report-btn')) document.getElementById('close-report-btn').onclick = () => { reportModal.classList.remove('show'); setTimeout(() => reportModal.classList.add('hidden'), 300); };

if (document.getElementById('submit-report-btn')) {
    document.getElementById('submit-report-btn').onclick = async () => {
        const reason = document.getElementById('report-reason-input').value.trim();
        if (!reason) return alert("Please specify why you are reporting this question.");
        if (localStorage.getItem('edeetos_guest_mode') === 'true') return alert("Please register an account to report questions.");
        const user = auth.currentUser; if (!user) return alert("Authentication error.");

        document.getElementById('submit-report-btn').textContent = "Submitting..."; document.getElementById('submit-report-btn').disabled = true;
        try {
            await addDoc(collection(db, "reported_questions"), { userId: user.uid, userEmail: user.email || "Unknown Email", questionId: currentQuestionData.originalNumber, courseFile: localStorage.getItem('edeetos_active_course') || 'Unknown Course', questionText: String(currentQuestionData.text).substring(0, 100) + "...", reason: reason, timestamp: serverTimestamp() });
            alert("Report submitted successfully. Thank you!");
            reportModal.classList.remove('show'); setTimeout(() => reportModal.classList.add('hidden'), 300);
        } catch (e) { alert("Failed to submit report."); } 
        finally { document.getElementById('submit-report-btn').textContent = "Submit Report"; document.getElementById('submit-report-btn').disabled = false; }
    };
}

// Admin Listeners
if (copyQBtn) {
    copyQBtn.onclick = () => {
        if (!currentQuestionData) return;
        const tempDiv = document.createElement('div'); tempDiv.innerHTML = currentQuestionData.text || "";
        let textToCopy = tempDiv.textContent.trim() + "\n\n";
        if (Array.isArray(currentQuestionData.options)) {
            currentQuestionData.options.forEach((opt, idx) => { textToCopy += `${String.fromCharCode(65 + idx)}) ${opt.text}\n`; });
        }
        navigator.clipboard.writeText(textToCopy).then(() => {
            copyQBtn.innerHTML = '<i class="fas fa-check"></i>'; setTimeout(() => copyQBtn.innerHTML = '<i class="far fa-copy"></i>', 1500);
        });
    };
}

if (editQBtn) {
    editQBtn.onclick = () => {
        if (!currentQuestionData) return;
        if (!quillHint) {
            const tb = [['bold', 'italic', 'underline', 'strike'], [{ 'script': 'sub'}, { 'script': 'super' }], [{ 'color': [] }, { 'background': [] }], [{ 'list': 'ordered'}, { 'list': 'bullet' }], [{ 'align': [] }], ['clean']];
            quillQuestion = new Quill('#edit-q-text', { theme: 'snow', modules: { toolbar: tb } });
            quillHint = new Quill('#edit-q-hint', { theme: 'snow', modules: { toolbar: tb } });
            quillExplanation = new Quill('#edit-q-explanation', { theme: 'snow', modules: { toolbar: tb } });
        }
        document.getElementById('edit-q-id').value = currentQuestionData.originalNumber || "";
        quillQuestion.root.innerHTML = currentQuestionData.text || "";
        document.getElementById('edit-q-subject').value = currentQuestionData.Subject || "";
        document.getElementById('edit-q-chapter').value = currentQuestionData.Chapter || "";
        document.getElementById('edit-q-topic').value = currentQuestionData.Topic || "";
        document.getElementById('edit-q-diff').value = (currentQuestionData.Difficulty || "medium").toLowerCase();
        document.getElementById('edit-q-year').value = Array.isArray(currentQuestionData.Year) ? currentQuestionData.Year.join(', ') : (currentQuestionData.Year || "");
        document.getElementById('edit-q-exam').value = Array.isArray(currentQuestionData.Exam) ? currentQuestionData.Exam.join(', ') : (currentQuestionData.Exam || "");
        quillHint.root.innerHTML = currentQuestionData.hint || "";
        quillExplanation.root.innerHTML = currentQuestionData.explanation || "";

        const optsContainer = document.getElementById('edit-options-container'); optsContainer.innerHTML = '';
        if (Array.isArray(currentQuestionData.options)) {
            currentQuestionData.options.forEach((opt, idx) => {
                optsContainer.innerHTML += `
                    <div class="admin-opt-row">
                        <input type="radio" name="edit-correct-opt" value="${idx}" ${opt.isCorrect ? "checked" : ""} class="admin-opt-radio">
                        <span class="admin-opt-label">${String.fromCharCode(65 + idx)})</span>
                        <input type="text" id="edit-opt-${idx}" value="${opt.text}" class="admin-opt-input">
                        <button type="button" class="tag-inject-btn btn-outline admin-tag-btn" data-target="edit-opt-${idx}" data-tag="br">↵</button>
                        <button type="button" class="tag-inject-btn btn-outline admin-tag-btn" data-target="edit-opt-${idx}" data-tag="sub">X₂</button>
                        <button type="button" class="tag-inject-btn btn-outline admin-tag-btn" data-target="edit-opt-${idx}" data-tag="sup">X²</button>
                    </div>`;
            });
            document.querySelectorAll('.tag-inject-btn').forEach(btn => {
                btn.onclick = (e) => {
                    e.preventDefault(); const input = document.getElementById(btn.getAttribute('data-target'));
                    const tag = btn.getAttribute('data-tag'); const s = input.selectionStart, e = input.selectionEnd, v = input.value;
                    if (tag === 'br') { input.value = v.slice(0, s) + '<br>' + v.slice(e); input.setSelectionRange(s + 4, s + 4); }
                    else { input.value = v.slice(0, s) + `<${tag}>${v.slice(s, e)}</${tag}>` + v.slice(e); input.setSelectionRange(s + tag.length + 2, e + tag.length + 2); }
                    input.focus();
                };
            });
        }
        adminEditModal.classList.remove('hidden'); adminEditModal.classList.add('show');
    };
}

if (btnCancelEdit) btnCancelEdit.onclick = () => { adminEditModal.classList.remove('show'); setTimeout(() => adminEditModal.classList.add('hidden'), 300); };
if (btnSaveGithub) btnSaveGithub.onclick = () => {
    let correctLetter = "A"; document.querySelectorAll('input[name="edit-correct-opt"]').forEach((radio, i) => { if (radio.checked) correctLetter = String.fromCharCode(65 + i); });
    const unescapeHTML = (str) => str.replace(/&lt;(\/?(h[1-6]|p|strong|em|sub|sup|br|div|span|ul|li|ol|b|i|u)(?:\s+[^&>]+)?)\&gt;/gi, '<$1>').replace(/&quot;/g, '"');
    const updatedRow = {
        "QuestionID": document.getElementById('edit-q-id').value, "Year": document.getElementById('edit-q-year').value.trim(), "Exam": document.getElementById('edit-q-exam').value.trim(), "Subject": document.getElementById('edit-q-subject').value.trim(), "Chapter": document.getElementById('edit-q-chapter').value.trim(), "Topic": document.getElementById('edit-q-topic').value.trim(),
        "Question": unescapeHTML(quillQuestion.root.innerHTML), "Explanation": unescapeHTML(quillExplanation.root.innerHTML), "Hint": unescapeHTML(quillHint.root.innerHTML), "Difficulty": document.getElementById('edit-q-diff').value, "CorrectAnswer": correctLetter,
        "OptionA": document.getElementById('edit-opt-0')?.value.trim() || "", "OptionB": document.getElementById('edit-opt-1')?.value.trim() || "", "OptionC": document.getElementById('edit-opt-2')?.value.trim() || "", "OptionD": document.getElementById('edit-opt-3')?.value.trim() || "", "OptionE": document.getElementById('edit-opt-4')?.value.trim() || ""
    };
    let queue = JSON.parse(localStorage.getItem('edeetos_pending_edits')) || [];
    const idx = queue.findIndex(e => e.row["QuestionID"] === updatedRow["QuestionID"]);
    const pkg = { row: updatedRow, courseFile: currentQuestionData.isBookQuestion ? currentQuestionData.bookName : (localStorage.getItem('edeetos_active_course') || 'fcps_part1'), isBook: currentQuestionData.isBookQuestion === true };
    if (idx !== -1) queue[idx] = pkg; else queue.push(pkg);
    localStorage.setItem('edeetos_pending_edits', JSON.stringify(queue));
    Object.assign(currentQuestionData, { text: updatedRow.Question, explanation: updatedRow.Explanation, hint: updatedRow.Hint, Subject: updatedRow.Subject, Chapter: updatedRow.Chapter, Topic: updatedRow.Topic, Difficulty: updatedRow.Difficulty, Year: updatedRow.Year, Exam: updatedRow.Exam });
    questionTextEl.innerHTML = currentQuestionData.text; explanationText.innerHTML = currentQuestionData.explanation;
    adminEditModal.classList.remove('show'); setTimeout(() => adminEditModal.classList.add('hidden'), 300);
};

// General Hotkeys
skipBtn.onclick = () => {
    let skippedQuestion = quizQueue.splice(currentIndex, 1)[0]; skippedQuestion.hasBeenSkipped = true; quizQueue.push(skippedQuestion);
    triggerSlideTransition(currentIndex, 'right');
};

if (labValuesBtn) labValuesBtn.onclick = () => { labValuesModal.classList.remove('hidden'); labValuesModal.classList.add('show'); };
if (closeLabValuesBtn) closeLabValuesBtn.onclick = () => { labValuesModal.classList.remove('show'); setTimeout(() => labValuesModal.classList.add('hidden'), 300); };
if (document.getElementById('lab-search-input')) document.getElementById('lab-search-input').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    document.querySelectorAll('#lab-values-table tr').forEach((row, i) => { if (i !== 0) row.style.display = (row.cells[0]?.textContent.toLowerCase().includes(query)) ? '' : 'none'; });
});

if (modalNextBtn) modalNextBtn.onclick = () => { if (closeExplanationBtn) closeExplanationBtn.click(); document.getElementById('next-btn').click(); };
if (explanationBtn) explanationBtn.onclick = () => { explanationModal.classList.remove('hidden'); explanationModal.classList.add('show'); };
if (closeExplanationBtn) closeExplanationBtn.onclick = () => { explanationModal.classList.remove('show'); setTimeout(() => explanationModal.classList.add('hidden'), 300); };

if (aiHintBtn) {
    aiHintBtn.onclick = () => {
        if (!currentQuestionData) return;
        const originalText = aiHintBtn.innerHTML; aiHintBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Loading...`; aiHintBtn.disabled = true;
        setTimeout(() => {
            let hintText = currentQuestionData.hint || "No specific hint available for this question. Analyze the patient's primary symptoms, labs, and time-course carefully.";
            const hintModal = document.createElement('div'); hintModal.id = 'dynamic-hint-modal'; hintModal.className = 'modal-overlay-solid';
            hintModal.innerHTML = `<div class="glass-panel modal-content text-left"><h2 class="color-amber-500 mt-0 mb-sm"><i class="fas fa-lightbulb"></i> Hint</h2><div class="color-slate-700 mb-lg">${hintText}</div><button id="close-dynamic-hint" class="btn-solid modal-btn-primary w-full">Got it!</button></div>`;
            document.body.appendChild(hintModal);
            document.getElementById('close-dynamic-hint').onclick = () => hintModal.remove();
            aiHintBtn.innerHTML = originalText; aiHintBtn.disabled = false; aiHintBtn.classList.add('hidden'); 
        }, 400); 
    };
}

document.getElementById('next-btn').onclick = async () => {
    if (activeRoomId && localStorage.getItem('is_study_guest') === 'true') return alert("Only the host can jump to different questions.");
    if (isExamMode) {
        if (!currentQuestionData.userSelectedAnswer) return showMustAnswerModal();
        if (currentIndex === quizQueue.length - 1) return showResults();
    }
    if (currentIndex < quizQueue.length - 1) { syncNextQuestion(currentIndex + 1); triggerSlideTransition(currentIndex + 1, 'right'); } 
    else if (!isExamMode) {
        if (activeRoomId && localStorage.getItem('is_study_guest') !== 'true') await updateDoc(doc(db, "study_rooms", activeRoomId), { status: "waiting", answers: {}, memberAnswers: deleteField(), forceReveal: deleteField() });
        showPracticeCompleteModal(false);
    }
};

document.getElementById('prev-btn').onclick = () => {
    if (activeRoomId && localStorage.getItem('is_study_guest') === 'true') return alert("Only the host can jump to different questions.");
    if (isExamMode) return;
    if (currentIndex > 0) { syncNextQuestion(currentIndex - 1); triggerSlideTransition(currentIndex - 1, 'left'); }
};

if (document.getElementById('shortcuts-btn')) document.getElementById('shortcuts-btn').addEventListener('click', () => { document.getElementById('shortcuts-modal').classList.remove('hidden'); document.getElementById('shortcuts-modal').classList.add('show'); });
if (document.getElementById('close-shortcuts-btn')) document.getElementById('close-shortcuts-btn').addEventListener('click', () => { document.getElementById('shortcuts-modal').classList.remove('show'); setTimeout(() => document.getElementById('shortcuts-modal').classList.add('hidden'), 300); });

document.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.classList.contains('ql-editor'))) return; 
    
    if (document.getElementById('must-answer-modal') && e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-understood-must-answer').click(); return; }
    if (document.getElementById('skipped-popup-modal') && e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-understood-skip').click(); return; }

    const isExpOpen = explanationModal && explanationModal.classList.contains('show');
    if (e.code === 'Numpad1' || e.code === 'Digit1') { e.preventDefault(); e.shiftKey ? toggleStrikeByIndex(0) : selectOptionByIndex(0); return; }
    if (e.code === 'Numpad2' || e.code === 'Digit2') { e.preventDefault(); e.shiftKey ? toggleStrikeByIndex(1) : selectOptionByIndex(1); return; }
    if (e.code === 'Numpad3' || e.code === 'Digit3') { e.preventDefault(); e.shiftKey ? toggleStrikeByIndex(2) : selectOptionByIndex(2); return; }
    if (e.code === 'Numpad4' || e.code === 'Digit4') { e.preventDefault(); e.shiftKey ? toggleStrikeByIndex(3) : selectOptionByIndex(3); return; }
    if (e.code === 'Numpad5' || e.code === 'Digit5') { e.preventDefault(); e.shiftKey ? toggleStrikeByIndex(4) : selectOptionByIndex(4); return; }

    if (isExpOpen) {
        const c = explanationModal.querySelector('.modal-content');
        if (e.key === 'ArrowUp') { e.preventDefault(); c.scrollTop -= 40; return; } else if (e.key === 'ArrowDown') { e.preventDefault(); c.scrollTop += 40; return; }
    }

    switch(e.key) {
        case 'ArrowRight': e.preventDefault(); document.getElementById('next-btn').click(); break;
        case 'ArrowLeft': e.preventDefault(); document.getElementById('prev-btn').click(); break;
        case 'h': case 'H': e.preventDefault(); if (aiHintBtn && !aiHintBtn.classList.contains('hidden')) aiHintBtn.click(); break;
        case 'Escape': e.preventDefault(); if (document.getElementById('shortcuts-modal').classList.contains('show')) document.getElementById('close-shortcuts-btn').click(); else if (isExpOpen) document.getElementById('close-explanation').click(); else exitSafely('questions.html'); break; 
        case 'Enter': 
            e.preventDefault(); 
            if (isPaused) document.getElementById('btn-resume-quiz').click();
            else if (document.getElementById('close-dynamic-hint')) document.getElementById('close-dynamic-hint').click();
            else if (document.getElementById('practice-complete-modal')) document.getElementById('btn-practice-home').click();
            else if (!document.getElementById('exam-result-screen').classList.contains('hidden')) document.getElementById('btn-return-home').click();
            else if (isExpOpen) document.getElementById('close-explanation').click(); 
            else if (isExamMode) document.getElementById('next-btn').click(); 
            break;
        case 'x': case 'X': e.preventDefault(); if (hasAnsweredCorrectly && !isExamMode) { if (isExpOpen) document.getElementById('close-explanation').click(); else explanationBtn.click(); } break;
        case 'p': case 'P': e.preventDefault(); if (isExamMode && skipBtn) skipBtn.click(); else if (!isExamMode) { if (isPaused) document.getElementById('btn-resume-quiz').click(); else document.getElementById('pause-btn').click(); } break;
        case 's': case 'S': e.preventDefault(); if (currentQuestionData) document.getElementById('bookmark-btn').click(); break;
        case 'a': case 'A': e.shiftKey ? toggleStrikeByIndex(0) : selectOptionByIndex(0); break;
        case 'b': case 'B': e.shiftKey ? toggleStrikeByIndex(1) : selectOptionByIndex(1); break;
        case 'c': case 'C': e.shiftKey ? toggleStrikeByIndex(2) : selectOptionByIndex(2); break;
        case 'd': case 'D': e.shiftKey ? toggleStrikeByIndex(3) : selectOptionByIndex(3); break;
        case 'e': case 'E': e.shiftKey ? toggleStrikeByIndex(4) : selectOptionByIndex(4); break;
    }
});

function selectOptionByIndex(i) { if (!hasAnsweredCorrectly || isExamMode) document.querySelectorAll('.option-box')[i]?.click(); }
function toggleStrikeByIndex(i) {
    if (hasAnsweredCorrectly && !isExamMode) return; 
    const optBox = document.querySelectorAll('.option-box')[i];
    if (optBox) {
        optBox.classList.toggle('strikethrough');
        const txt = optBox.querySelector('.option-text').textContent;
        currentQuestionData.eliminatedOptions = currentQuestionData.eliminatedOptions || [];
        if (optBox.classList.contains('strikethrough')) currentQuestionData.eliminatedOptions.push(txt); else currentQuestionData.eliminatedOptions = currentQuestionData.eliminatedOptions.filter(t => t !== txt);
    }
}

// ==========================================
// 10. EXIT ROUTINES & SESSION CLEANUP
// ==========================================
const globalExitBtn = document.getElementById('global-exit-btn');
if (globalExitBtn) {
    if (activeRoomId) {
        const isGuest = localStorage.getItem('is_study_guest') === 'true';
        globalExitBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Leave Room';
        globalExitBtn.style.color = '#ef4444'; globalExitBtn.style.borderColor = '#ef4444';
        if (!isGuest) {
            const lobbyBtn = document.createElement('button');
            lobbyBtn.id = 'host-lobby-btn'; lobbyBtn.className = globalExitBtn.className; 
            lobbyBtn.innerHTML = '<i class="fas fa-undo"></i> Return to Lobby';
            lobbyBtn.style.color = '#f59e0b'; lobbyBtn.style.borderColor = '#f59e0b'; lobbyBtn.style.marginRight = '10px';
            globalExitBtn.parentNode.insertBefore(lobbyBtn, globalExitBtn);
            lobbyBtn.onclick = async (e) => {
                e.preventDefault(); if (!confirm("Stop the current quiz and return everyone to the lobby?")) return;
                lobbyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Returning...'; lobbyBtn.disabled = true; globalExitBtn.style.display = 'none';
                try {
                    await Promise.all([ updateSpacedRepetition(), !isExamMode ? savePracticeTime(sessionSeconds) : Promise.resolve(), setDoc(doc(db, "study_rooms", activeRoomId), { status: "waiting", answers: {}, memberAnswers: {}, forceReveal: {}, currentQuestionIndex: 0 }, { merge: true }) ]);
                    exitSafely('questions.html'); 
                } catch (error) { lobbyBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error'; }
            };
        }
    }

    globalExitBtn.onclick = async (e) => {
        e.preventDefault();
        if (activeRoomId && !confirm("Are you sure you want to completely leave?")) return;
        globalExitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; globalExitBtn.disabled = true;
        try {
            const tasks = [updateSpacedRepetition()];
            if (!isExamMode) tasks.push(savePracticeTime(sessionSeconds));
            if (activeRoomId) {
                if (localStorage.getItem('is_study_guest') !== 'true') tasks.push(updateDoc(doc(db, "study_rooms", activeRoomId), { status: "ended", endedAt: serverTimestamp() }));
                else tasks.push(updateDoc(doc(db, "study_rooms", activeRoomId), { [`activeMembers.${currentUserId}`]: deleteField() }));
            }
            await Promise.all(tasks);
        } finally {
            localStorage.removeItem('active_study_room'); localStorage.removeItem('is_study_guest'); exitSafely('questions.html'); 
        }
    };
}

async function updateSpacedRepetition() {
    if (localStorage.getItem('edeetos_guest_mode') === 'true' || !auth.currentUser) return;
    const activeCourse = localStorage.getItem('edeetos_active_course') || 'fcps_part1';
    const userRef = doc(db, "users", auth.currentUser.uid);
    try {
        const isBk = isBookSession();   
        const currentRevisions = isBk ? (currentUserData?.books?.revisions || {}) : (currentUserData?.[activeCourse]?.revisions || {});
        const revisionsData = {};
        quizQueue.forEach(question => {
            if (!question || (!question.userSelectedAnswer && !question.sessionState)) return;
            const subject = question.Subject || question.subject || "Unknown"; const chapter = question.Chapter || question.chapter || "Unknown"; const topic = question.Topic || question.topic || "Unknown";
            const sourceName = question.isBookQuestion ? (question.bookName || question.Subject || 'Reference') : activeCourse;
            const topicId = `${subject}::${chapter}::${topic}::${sourceName}`.replace(/[.#$/[\]]/g, '');
            let isCorrect = question.options?.find(o => o.isCorrect) && (question.userSelectedAnswer === question.options.find(o => o.isCorrect).text || question.sessionState === 'correct');
            
            if (!revisionsData[topicId]) {
                const ex = currentRevisions[topicId] || {};
                revisionsData[topicId] = { subject, chapter, topic, sourceType: question.isBookQuestion ? 'book' : 'course', sourceName: sourceName, solvedQuestionsCount: ex.solvedQuestionsCount || 0, mistakesCount: ex.mistakesCount || 0, intervalStep: ex.intervalStep || 0, status: "pending" };
            }
            revisionsData[topicId].solvedQuestionsCount += 1; if (!isCorrect) revisionsData[topicId].mistakesCount += 1;
        });

        Object.values(revisionsData).forEach(data => {
            const acc = Math.round(((data.solvedQuestionsCount - data.mistakesCount) / data.solvedQuestionsCount) * 100);
            data.intervalStep = acc >= 75 ? (data.intervalStep === 0 ? 1 : data.intervalStep === 1 ? 7 : data.intervalStep === 7 ? 15 : 30) : 1;
            data.accuracy = acc; data.lastAccuracy = acc; data.dueDate = Date.now() + (data.intervalStep * 24 * 60 * 60 * 1000); data.updatedAt = Date.now();
        });

        await setDoc(userRef, { [isBk ? 'books' : activeCourse]: { revisions: revisionsData } }, { merge: true });
    } catch (error) { console.error("Spaced Repetition Error:", error); }
}

function checkAndRestoreAbortedSession() {
    const backupStr = localStorage.getItem('edeetos_aborted_session_backup');
    if (backupStr && confirm("We noticed your last practice session ended unexpectedly. Would you like to restore your progress?")) {
        const backup = JSON.parse(backupStr);
        quizQueue = backup.queue; currentIndex = backup.index; sessionSeconds = backup.seconds;
        localStorage.removeItem('edeetos_aborted_session_backup');
        return true;
    }
    if (backupStr) localStorage.removeItem('edeetos_aborted_session_backup');
    return false;
}

window.addEventListener('beforeunload', (e) => {
    if (!isIntentionalExit && quizQueue && quizQueue.length > 0 && !isExamMode && !activeRoomId) {
        localStorage.setItem('edeetos_aborted_session_backup', JSON.stringify({ queue: quizQueue, config: quizConfig, index: currentIndex, seconds: sessionSeconds }));
    }
});

window.addEventListener('unload', () => {
    if (activeRoomId && roomRef) {
        import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js").then(({ updateDoc, deleteField }) => {
            if (localStorage.getItem('is_study_guest') === 'true' && currentUserId) updateDoc(roomRef, { [`activeMembers.${currentUserId}`]: deleteField() });
            else if (localStorage.getItem('is_study_guest') !== 'true') updateDoc(roomRef, { status: "ended" });
        });
    }
});

checkAndRestoreAbortedSession();