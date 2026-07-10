import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, updateDoc, getDoc, arrayUnion, arrayRemove, onSnapshot, addDoc, collection, serverTimestamp, deleteField } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let currentUserId = null; 
let currentUserData = null;

// ==========================================
// 1. STATE VARIABLES & CONFIG LOAD
// ==========================================
let quizQueue = [];
let currentIndex = 0;
let currentQuestionData = null;
let wrongAttempts = 0;
let hasAnsweredCorrectly = false;
let sessionSeconds = 0;
let timerInterval;

// Multiplayer specific states
let activeRoomId = localStorage.getItem('active_study_room');
let roomRef = activeRoomId ? doc(db, "study_rooms", activeRoomId) : null;
let hasRevealedCurrentQuestion = false;
let hasAnsweredCurrentQuestion = false;

const configStr = localStorage.getItem('edeetos_quiz_config');
const quizConfig = configStr ? JSON.parse(configStr) : { mode: 'practice', timer: 0 };
const isExamMode = (quizConfig.mode === 'exam') && !activeRoomId;

// ---------- NEW HELPER ----------
// Checks if the current quiz session is from a book (not a course)
function isBookSession() {
    return quizQueue.length > 0 && quizQueue[0]?.isBookQuestion === true;
}
// ---------------------------------

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

if (isExamMode) {
    document.body.classList.add('mode-exam');
    sessionSeconds = quizConfig.timer * 60; 
}

function loadSession() {
    if (activeRoomId && localStorage.getItem('is_study_guest') === 'true') {
        return; 
    }

    const storedData = localStorage.getItem('edeetos_active_quiz');
    if (!storedData) {
        window.location.href = 'questions.html';
        return;
    }
    quizQueue = JSON.parse(storedData);
    if (quizQueue.length === 0) {
        window.location.href = 'questions.html';
        return;
    }

    quizQueue.forEach((q, i) => {     
        if (!q.originalNumber) {
            const idFromCSV = q['QuestionID'] || q['Question ID'] || q['ID'] || q['id'];
            q.originalNumber = idFromCSV || `q-${i + 1}`; 
        }
        q.sessionState = null; 
        q.historicalState = null; 
    });
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUserId = user.uid; 
        const userRef = doc(db, "users", user.uid);

        try {
            const docSnap = await getDoc(userRef);

            if (docSnap.exists()) {
                const dbData = docSnap.data();
                currentUserData = dbData;

                // ==========================================
                // ANTI-CHEAT SECURITY MEASURES
                // ==========================================
                const roleUpper = (dbData.role || 'STUDENT').toUpperCase();
                if (roleUpper === 'ADMIN' || roleUpper === 'MANAGEMENT') {
                    window.isScreenshotBlockEnabled = false;
                    document.body.style.userSelect = 'auto';
                    document.body.style.webkitUserSelect = 'auto';
                    document.oncontextmenu = null;
                } else {
                    window.isScreenshotBlockEnabled = true;
                    document.body.style.userSelect = 'none';
                    document.body.style.webkitUserSelect = 'none';
                    document.oncontextmenu = (e) => e.preventDefault();
                }
                // ==========================================

                if (activeRoomId) {
                    await updateDoc(roomRef, {
                        [`activeMembers.${currentUserId}`]: dbData.fullName || "Student"
                    });
                }

                if (dbData.isBanned || dbData.role === 'BANNED') {
                    const lockoutScreen = document.createElement('div');
                    lockoutScreen.style.cssText = `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background-color: rgba(15, 23, 42, 0.95); z-index: 2147483647; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; backdrop-filter: blur(10px);`;
                    lockoutScreen.innerHTML = `
                        <i class="fas fa-ban" style="color: #ef4444; font-size: 5rem; margin-bottom: 1.5rem;"></i>
                        <h1 style="color: white; font-family: 'Nunito', sans-serif; font-size: 2.5rem; margin-bottom: 1rem;">Account Suspended</h1>
                        <button id="btn-banned-logout" style="background: #ef4444; color: white; border: none; padding: 1rem 2.5rem; border-radius: 12px; font-weight: bold; cursor: pointer;">Log Out</button>
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
                const savedBookmarks = [
                    ...(courseData.bookmarks || []),
                    ...(booksData.bookmarks || [])
                ];
                const solvedList = [
                    ...(courseData.solvedQuestions || []),
                    ...(booksData.solvedQuestions || [])
                ];
                const mistakesList = [
                    ...(courseData.mistakes || []),
                    ...(booksData.mistakes || [])
                ];
                const examMistakesList = [
                    ...(courseData.examMistakes || []),
                    ...(booksData.examMistakes || [])
                ];

                quizQueue.forEach(q => {
                    q.isBookmarked = savedBookmarks.includes(q.originalNumber);
                    q.userNote = savedNotes[q.originalNumber] || "";
                    if (mistakesList.includes(q.originalNumber) || examMistakesList.includes(q.originalNumber)) {
                        q.historicalState = 'wrong';
                    } else if (solvedList.includes(q.originalNumber)) {
                        q.historicalState = 'correct';
                    }
                });
            }

        } catch (error) {
            console.error("Firebase Load Error:", error);
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

async function syncNextQuestion(newIndex) {
    const isGuest = localStorage.getItem('is_study_guest') === 'true';
    if (isGuest) return;

    if (activeRoomId) {
        await updateDoc(doc(db, "study_rooms", activeRoomId), {
            currentQuestionIndex: newIndex
        });
    }
}

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
            if (optText && optText.trim() !== '') {
                formattedOptions.push({ text: optText, isCorrect: correctLetter === letter, letter: letter });
            }
        });
    }

    return {
        text: q.question || q.Question || "Missing Question Text",
        options: formattedOptions,
        explanation: q.explanation || q.Explanation || "No explanation provided.",
        hint: q.hint || q.Hint || "", // Pulls directly from CSV/JSON
        originalNumber: q.QuestionID || q.id || q.originalNumber || `q-${Math.random()}`,
        isBookmarked: q.isBookmarked || false,
        userNote: q.userNote || "",
        sessionState: q.sessionState || null,
        historicalState: q.historicalState || null,
        hasBeenSkipped: q.hasBeenSkipped || false,
        userSelectedAnswer: q.userSelectedAnswer || null,
        
        Subject: q.Subject || q.subject || "",
        Chapter: q.Chapter || q.chapter || "",
        Topic: q.Topic || q.topic || "",
        isBookQuestion: q.isBookQuestion || false,
        bookName: q.bookName || ""
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
            
            if (activeRoomId && localStorage.getItem('is_study_guest') === 'true') {
                alert("Only the host can jump to different questions.");
                return;
            }
            
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

// ==========================================
// 2. SLIDE TRANSITIONS & RENDER
// ==========================================
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
        if (waitEl) waitEl.style.display = 'none';
        const forceBtn = document.getElementById('host-force-reveal-btn');
        if (forceBtn) forceBtn.style.display = 'none';

        if (!currentQuestionData.options || !Array.isArray(currentQuestionData.options)) {
            quizQueue[currentIndex] = formatJSONQuestion(currentQuestionData);
            currentQuestionData = quizQueue[currentIndex];
        }

        wrongAttempts = 0;
        hasAnsweredCorrectly = false;
        
        if (aiHintBtn) {
            aiHintBtn.style.display = 'none'; 
            aiHintBtn.innerHTML = `<i class="fas fa-lightbulb"></i> Hint`; // Standardize UI
        }
        
        if (floatingHighlightBtn) floatingHighlightBtn.style.display = 'none'; 
        if (!isExamMode) updateFeedbackBar();
        
        if (hasAnsweredCorrectly && !isExamMode && !activeRoomId) {
            explanationBtn.style.display = 'inline-block';
        } else {
            explanationBtn.style.display = 'none'; 
            explanationModal.classList.remove('show');
        }

        const displayNum = currentIndex + 1;
        if (questionIdBadge) {
            questionIdBadge.textContent = isExamMode ? `Question ${displayNum} / ${quizQueue.length}` : `Question ${displayNum}`;
        }

        if (isExamMode) {
            if (currentQuestionData.hasBeenSkipped) {
                skippedWarningEl.classList.remove('hidden');
                skipBtn.style.display = 'none'; 
            } else {
                skippedWarningEl.classList.add('hidden');
                skipBtn.style.display = 'block';
            }
            document.getElementById('next-btn').textContent = (currentIndex === quizQueue.length - 1) ? "Submit Exam" : "Next";
        }

        questionTextEl.innerHTML = currentQuestionData.text || "Missing Question";
        explanationText.innerHTML = currentQuestionData.explanation || "No explanation provided.";

        optionsContainer.innerHTML = '';
        shuffleArray(currentQuestionData.options);
        currentQuestionData.options.forEach(opt => {
            const optBox = document.createElement('div');
            optBox.className = 'option-box';
            optBox.style.cursor = 'pointer';
            optBox.setAttribute('role', 'button');
            optBox.setAttribute('tabindex', '0');
            optBox.setAttribute('onclick', 'void(0);');
            
            if (isExamMode && currentQuestionData.userSelectedAnswer === opt.text) {
                optBox.classList.add('selected');
            } else if (!isExamMode && hasAnsweredCorrectly && !activeRoomId) {
                if (opt.isCorrect) optBox.classList.add('correct');
                optBox.classList.add('locked');
            }

            optBox.innerHTML = `<div class="option-text">${opt.text}</div><i class="fas fa-eye eye-icon"></i>`;
            optBox.addEventListener('click', (e) => {
                e.preventDefault();
                handleOptionClick(e, opt, optBox);
            });
            optionsContainer.appendChild(optBox);
        });

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
                if (notesModal) {
                    notesModal.classList.remove('hidden');
                    notesModal.classList.add('show');
                }
            };
        }

        if (saveNoteBtn) {
            saveNoteBtn.onclick = () => {
                const typedNote = noteInput.value.trim();
                currentQuestionData.userNote = typedNote; 
                saveNoteToFirebase(currentQuestionData.originalNumber, typedNote);
                notesModal.classList.remove('show');
                setTimeout(() => notesModal.classList.add('hidden'), 300);
            };
        }

        if (closeNotesBtn) {
            closeNotesBtn.onclick = () => {
                notesModal.classList.remove('show');
                setTimeout(() => notesModal.classList.add('hidden'), 300);
            };
        }
		
        const btnReport = document.getElementById('btn-report');
        const reportModal = document.getElementById('report-modal');
        const closeReportBtn = document.getElementById('close-report-btn');
        const submitReportBtn = document.getElementById('submit-report-btn');
        const reportReasonInput = document.getElementById('report-reason-input');

        if (btnReport) {
            btnReport.onclick = () => {
                reportReasonInput.value = "";
                if (reportModal) {
                    reportModal.classList.remove('hidden');
                    reportModal.classList.add('show');
                }
            };
        }

        if (closeReportBtn) {
            closeReportBtn.onclick = () => {
                if (reportModal) {
                    reportModal.classList.remove('show');
                    setTimeout(() => reportModal.classList.add('hidden'), 300);
                }
            };
        }

        if (submitReportBtn) {
            submitReportBtn.onclick = async () => {
                const reason = reportReasonInput.value.trim();
                if (!reason) return alert("Please specify why you are reporting this question.");
                
                if (localStorage.getItem('edeetos_guest_mode') === 'true') {
                    return alert("Please register an account to report questions.");
                }

                const user = auth.currentUser;
                if (!user) return alert("Authentication error. Please log in again.");

                submitReportBtn.textContent = "Submitting...";
                submitReportBtn.disabled = true;

                try {
                    const activeCourse = localStorage.getItem('edeetos_active_course') || 'Unknown Course';
                    const qText = currentQuestionData.text ? String(currentQuestionData.text).substring(0, 100) + "..." : "No text";

                    await addDoc(collection(db, "reported_questions"), {
                        userId: user.uid,
                        userEmail: user.email || "Unknown Email",
                        questionId: currentQuestionData.originalNumber,
                        courseFile: activeCourse,
                        questionText: qText,
                        reason: reason,
                        timestamp: serverTimestamp()
                    });
                    
                    alert("Report submitted successfully. Thank you!");
                    if (reportModal) reportModal.classList.remove('show');
                } catch (e) {
                    console.error("Error reporting question: ", e);
                    alert("Failed to submit report. Please check your internet connection or try again later.");
                } finally {
                    submitReportBtn.textContent = "Submit Report";
                    submitReportBtn.disabled = false;
                }
            };
        }
        updateGridStyles();

    } catch (error) { 
        console.error("🚨 CRASH inside loadQuestion:", error);
    }
}

// ==========================================
// 3. DATABASE SYNC FUNCTIONS (MODIFIED)
// ==========================================
async function savePracticeProgress(questionId, isCorrect) {
    if (localStorage.getItem('edeetos_guest_mode') === 'true') return;
    const user = auth.currentUser;
    if (!user) return; 

    const userRef = doc(db, "users", user.uid);
    const rootKey = isBookSession() ? "books" : (localStorage.getItem('edeetos_active_course') || 'fcps_part1');
    let updates = {};

    if (isCorrect) {
        const isReviewMistakesMode = (quizConfig.examName === "Review Mistakes");
        updates.solvedQuestions = arrayUnion(questionId); 

        if (isReviewMistakesMode) {
            updates.mistakes = arrayRemove(questionId);      
            updates.examMistakes = arrayRemove(questionId);   
        }
    } else {
        updates.mistakes = arrayUnion(questionId);
    }

    try {
        await setDoc(userRef, { [rootKey]: updates }, { merge: true });
    } catch (error) { console.error("Error saving practice progress:", error); }
}

async function saveExamProgress(correctIds, mistakeIds, correctCount, totalQuestions) {
    if (localStorage.getItem('edeetos_guest_mode') === 'true') return;
    const user = auth.currentUser;
    if (!user) return; 

    const userRef = doc(db, "users", user.uid);
    const rootKey = isBookSession() ? "books" : (localStorage.getItem('edeetos_active_course') || 'fcps_part1');
    
    try {
        let updates = {};
        if (correctIds.length > 0) updates.examMistakes = arrayRemove(...correctIds);  
        if (mistakeIds.length > 0) updates.examMistakes = arrayUnion(...mistakeIds);

        const examTitle = quizConfig.examName || "Custom Exam"; 
        const examRecord = {
            examName: examTitle,
            score: correctCount,
            total: totalQuestions,
            percentage: Math.round((correctCount / totalQuestions) * 100),
            date: new Date().toISOString() 
        };
        updates.examHistory = arrayUnion(examRecord);

        if (Object.keys(updates).length > 0) {
            await setDoc(userRef, { [rootKey]: updates }, { merge: true });
        }
    } catch (error) { console.error("Error saving exam progress:", error); }
}

async function toggleBookmarkInFirebase(questionId, isBookmarking) {
    if (localStorage.getItem('edeetos_guest_mode') === 'true') return;
    const user = auth.currentUser;
    if (!user) return; 
    
    const userRef = doc(db, "users", user.uid);
    const rootKey = isBookSession() ? "books" : (localStorage.getItem('edeetos_active_course') || 'fcps_part1');
    
    try {
        await setDoc(userRef, { [rootKey]: { bookmarks: isBookmarking ? arrayUnion(questionId) : arrayRemove(questionId) } }, { merge: true });
    } catch (error) { console.error("Error updating bookmark:", error); }
}

async function saveNoteToFirebase(questionId, noteText) {
    if (localStorage.getItem('edeetos_guest_mode') === 'true') return;
    const user = auth.currentUser;
    if (!user) return; 
    
    const userRef = doc(db, "users", user.uid);
    const rootKey = isBookSession() ? "books" : (localStorage.getItem('edeetos_active_course') || 'fcps_part1');
    
    try {
        await setDoc(userRef, { [rootKey]: { notes: { [questionId]: noteText } } }, { merge: true });
    } catch (error) { console.error("Error saving note:", error); }
}

function handleOptionClick(event, optionData, optionElement) {
    if (event.target.classList.contains('eye-icon')) {
        optionElement.classList.toggle('strikethrough');
        return; 
    }

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
        
        explanationBtn.style.display = 'inline-block'; 
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
    if (totalAttempts > 0) {
        const percentGreen = (hasAnsweredCorrectly ? 1 : 0) / totalAttempts * 100;
        feedbackFill.style.width = `${percentGreen}%`;
    } else {
        feedbackFill.style.width = `0%`;
    }
}

// ==========================================
// CLINICAL HIGHLIGHTER & STRIKETHROUGH
// ==========================================
let floatingHighlightBtn = document.getElementById('floating-toolkit');

if (!floatingHighlightBtn) {
    floatingHighlightBtn = document.createElement('div');
    floatingHighlightBtn.id = 'floating-toolkit';
    floatingHighlightBtn.style.cssText = 'position: absolute; display: none; background: #1e293b; padding: 6px; border-radius: 8px; z-index: 1000; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3); gap: 6px;';
    
    floatingHighlightBtn.innerHTML = `
        <button id="tool-hl-yellow" style="background: #eab308; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-weight: bold;" title="Highlight"><i class="fas fa-highlighter"></i></button>
        <button id="tool-hl-strike" style="background: #ef4444; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-weight: bold; text-decoration: line-through;" title="Strike">S</button>
    `;
    document.body.appendChild(floatingHighlightBtn);
}

if (questionTextEl) {
    questionTextEl.style.userSelect = 'text';
    questionTextEl.style.webkitUserSelect = 'text';

    questionTextEl.addEventListener('mouseup', (e) => {
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();
        
        if (selectedText.length > 0) {
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            
            floatingHighlightBtn.style.top = `${rect.top + window.scrollY - 45}px`;
            floatingHighlightBtn.style.left = `${rect.left + window.scrollX + (rect.width / 2) - 45}px`;
            floatingHighlightBtn.style.display = 'flex';
            
            document.getElementById('tool-hl-yellow').onclick = () => {
                applyTextFormat(range, selection, 'background-color: #fef08a; padding: 2px 4px; border-radius: 4px; color: #1e293b;');
            };
            
            document.getElementById('tool-hl-strike').onclick = () => {
                applyTextFormat(range, selection, 'text-decoration: line-through; color: #94a3b8;');
            };
        } else {
            floatingHighlightBtn.style.display = 'none';
        }
    });

    document.addEventListener('mousedown', (e) => {
        if (e.target.closest('#floating-toolkit') === null) {
            floatingHighlightBtn.style.display = 'none';
        }
    });
}

function applyTextFormat(range, selection, inlineStyles) {
    const mark = document.createElement('span');
    mark.style.cssText = inlineStyles;
    try {
        range.surroundContents(mark);
    } catch (err) {
        console.warn("Cannot format across multiple paragraphs. Select text within a single block.");
    }
    selection.removeAllRanges();
    floatingHighlightBtn.style.display = 'none';
}

// ==========================================
// 4. MULTIPLAYER SYNC ENGINE
// ==========================================
function revealMultiplayerAnswers(answersObj, activeMembersMap) {
    hasRevealedCurrentQuestion = true;

    const waitEl = document.getElementById('multiplayer-waiting-text');
    if (waitEl) waitEl.style.display = 'none';

    const forceBtn = document.getElementById('host-force-reveal-btn');
    if (forceBtn) forceBtn.style.display = 'none';

    const myAnswerText = answersObj[currentUserId];
    if (myAnswerText) {
        const myOpt = currentQuestionData.options.find(o => o.text === myAnswerText);
        if (myOpt) {
            if (myOpt.isCorrect) {
                hasAnsweredCorrectly = true;
                savePracticeProgress(currentQuestionData.originalNumber, true);
            } else {
                wrongAttempts++;
                savePracticeProgress(currentQuestionData.originalNumber, false);
            }
        }
    }
    
    updateFeedbackBar();
    explanationBtn.style.display = 'inline-block';
    document.querySelectorAll('.option-box').forEach(box => box.classList.add('locked'));

    document.querySelectorAll('.option-box').forEach(box => {
        const textDiv = box.querySelector('.option-text');
        const optText = textDiv ? textDiv.textContent : '';
        const isOptCorrect = currentQuestionData.options.find(o => o.text === optText)?.isCorrect;

        if (isOptCorrect) box.classList.add('correct', 'apply-pop');
        else if (Object.values(answersObj).includes(optText)) box.classList.add('incorrect');

        const voters = Object.keys(answersObj).filter(uid => answersObj[uid] === optText);
        if (voters.length > 0) {
            const tagContainer = document.createElement('div');
            tagContainer.style.cssText = "display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; width: 100%;";
            voters.forEach(uid => {
                const name = activeMembersMap[uid] || "Student";
                const isMe = uid === currentUserId;
                const bg = isMe ? "#3b82f6" : "rgba(0,0,0,0.1)";
                const color = isMe ? "white" : "inherit";
                tagContainer.innerHTML += `<span style="background: ${bg}; color: ${color}; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: bold;">${name}</span>`;
            });
            box.appendChild(tagContainer);
        }
    });
}

if (roomRef) {
    onSnapshot(roomRef, (snapshot) => {
        const data = snapshot.data();

        if (!data || data.status === "ended") {
            showPracticeCompleteModal(true);
            return;
        }

        const isGuest = localStorage.getItem('is_study_guest') === 'true';

        if (data.status === "waiting" && isGuest) {
            if (!document.getElementById('mp-lobby-screen')) {
                const lobby = document.createElement('div');
                lobby.id = 'mp-lobby-screen';
                lobby.style.cssText = "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: #0f172a; z-index: 999999; display: flex; flex-direction: column; justify-content: center; align-items: center; color: white;";
                lobby.innerHTML = `
                    <i class="fas fa-users" style="font-size: 4rem; color: #3b82f6; margin-bottom: 20px;"></i>
                    <h2 style="font-family: 'Nunito', sans-serif;">Waiting for Host...</h2>
                    <p style="color: #94a3b8; margin-top: 10px;">The host is picking the test material. Hang tight.</p>
                `;
                document.body.appendChild(lobby);
            }
            return;
        }

        if (data.status === "playing" && isGuest) {
            const lobby = document.getElementById('mp-lobby-screen');
            if (lobby) lobby.remove();
            const isNewBatch = !quizQueue || quizQueue.length === 0 || 
                               (data.questions && data.questions.length > 0 && quizQueue[0].text !== data.questions[0].text);

            if (isNewBatch && data.questions) {
                quizQueue = data.questions;
                quizQueue.forEach((q, i) => { if (!q.originalNumber) q.originalNumber = q['QuestionID'] || `q-${i + 1}`; });
                
                buildNumberGrid();
                loadQuestion(data.currentQuestionIndex || 0);
            }
        }

        if (quizQueue && quizQueue.length > 0 && data.currentQuestionIndex !== undefined && data.currentQuestionIndex !== currentIndex) {
            const direction = data.currentQuestionIndex > currentIndex ? 'right' : 'left';
            triggerSlideTransition(data.currentQuestionIndex, direction);
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
                rosterBox.style.cssText = "position: fixed; top: 100px; right: 20px; background: white; padding: 15px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); width: 220px; z-index: 1000; border: 1px solid #e2e8f0;";
                cardEl.parentElement.insertBefore(rosterBox, cardEl);
            }

            let rosterHtml = `<h4 style="margin: 0 0 15px 0; border-bottom: 2px solid rgba(255,255,255,0.5); padding-bottom: 10px; color: #0f172a; font-size: 1.1rem; text-align: center; font-weight: 800; letter-spacing: 0.5px;"><i class="fas fa-users" style="margin-right: 8px; color: #10b981;"></i>Live Roster</h4>`;
            
            Object.keys(activeMembers).forEach(uid => {
                const name = activeMembers[uid];
                const hasAnswered = currentAnswers.hasOwnProperty(uid);
                const isMe = uid === currentUserId;
                
                const statusColor = hasAnswered ? "#10b981" : "#94a3b8"; 
                const statusText = hasAnswered ? "Locked In" : "Thinking";
                const nameWeight = isMe ? "800" : "500";
                
                rosterHtml += `
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; background: rgba(255,255,255,0.4); padding: 8px 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.6); box-shadow: 0 4px 6px rgba(0,0,0,0.02);">
                        <span style="font-size: 0.95rem; font-weight: ${nameWeight}; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 110px;" title="${name}">
                            ${name} ${isMe ? "(You)" : ""}
                        </span>
                        <span style="display: flex; align-items: center; gap: 6px; font-size: 0.75rem; color: #475569; font-weight: 700;">
                            ${statusText} <div style="width: 10px; height: 10px; border-radius: 50%; background: ${statusColor}; border: 1px solid rgba(255,255,255,0.8);"></div>
                        </span>
                    </div>
                `;
            });
            rosterBox.innerHTML = rosterHtml;

            let waitEl = document.getElementById('multiplayer-waiting-text');
            if (!waitEl) {
                waitEl = document.createElement('div');
                waitEl.id = 'multiplayer-waiting-text';
                waitEl.style.cssText = "text-align: center; margin-top: 15px; font-weight: bold; color: #3b82f6; display: none;";
                optionsContainer.parentElement.appendChild(waitEl);
            }

            if (hasAnsweredCurrentQuestion && !hasRevealedCurrentQuestion) {
                waitEl.style.display = 'block';
                waitEl.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Waiting for others... (${answerCount}/${memberCount} answered)`;
            }

            if (!isGuest && !hasRevealedCurrentQuestion) {
                let forceBtn = document.getElementById('host-force-reveal-btn');
                if (!forceBtn) {
                    forceBtn = document.createElement('button');
                    forceBtn.id = 'host-force-reveal-btn';
                    forceBtn.className = 'btn-outline';
                    forceBtn.style.cssText = "margin-top: 15px; width: 100%; border-color: #ef4444; color: #ef4444;";
                    forceBtn.innerHTML = "Force Reveal Answers (Someone disconnected?)";
                    optionsContainer.parentElement.appendChild(forceBtn);
                    forceBtn.onclick = () => updateDoc(roomRef, { [`forceReveal.${currentIndex}`]: true });
                }
                forceBtn.style.display = (answerCount > 0 && answerCount < memberCount) ? 'block' : 'none';
            }

            const forceReveal = data.forceReveal && data.forceReveal[currentIndex];

            if ((answerCount >= memberCount || forceReveal) && !hasRevealedCurrentQuestion && answerCount > 0) {
                revealMultiplayerAnswers(currentAnswers, data.activeMembers);
            }
        }
    });
}

// ==========================================
// 5. EXAM SUBMISSION & RESULTS
// ==========================================
function showResults() {
    clearInterval(timerInterval);    
    let correctCount = 0;
    let correctIds = [];
    let mistakeIds = [];
    
    quizQueue.forEach(q => {
        let correctOpt = q.options.find(o => o.isCorrect);
        if (correctOpt && q.userSelectedAnswer === correctOpt.text) {
            correctCount++;
            correctIds.push(q.originalNumber);
        } else if (q.userSelectedAnswer) {
            mistakeIds.push(q.originalNumber);
        }
    });

    const total = quizQueue.length;
    const percentage = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    
    document.getElementById('quiz-ui-container').style.display = 'none';
    document.getElementById('bottom-actions-container').style.display = 'none';
    
    const resultsEl = document.getElementById('exam-result-screen');
    resultsEl.classList.remove('hidden');
    resultsEl.classList.add('result-pop-in'); 
    
    const titleEl = document.getElementById('result-title');
    const scoreEl = document.getElementById('result-score');
    
    scoreEl.textContent = `You scored ${correctCount} out of ${total} (${percentage}%)`;
    
    if (percentage >= 75) {
        titleEl.innerHTML = `<i class="fas fa-check-circle" style="font-size: 3.5rem; display: block; margin-bottom: 1rem; color: #10b981;"></i> 🎉 Passed!`;
        titleEl.style.color = "#065f46";
    } else {
        titleEl.innerHTML = `<i class="fas fa-times-circle" style="font-size: 3.5rem; display: block; margin-bottom: 1rem; color: #ef4444;"></i> ❌ Failed`;
        titleEl.style.color = "#991b1b";
    }

    const returnBtn = resultsEl.querySelector('button');
    if (returnBtn) {
        returnBtn.onclick = async (e) => {
            e.preventDefault();
            returnBtn.textContent = "Saving Exam Data...";
            returnBtn.disabled = true;

            const tasks = [];
            if (isExamMode) tasks.push(saveExamProgress(correctIds, mistakeIds, correctCount, total));
            tasks.push(updateSpacedRepetition());

            await Promise.all(tasks);
            window.location.href = 'questions.html';
        };
    }
}

// ==========================================
// Custom Completion Modal
// ==========================================
function showPracticeCompleteModal(isGuest = false) {
    if (document.getElementById('practice-complete-modal')) return; 

    const modal = document.createElement('div');
    modal.id = 'practice-complete-modal';
    modal.style.cssText = `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background-color: rgba(15, 23, 42, 0.95); z-index: 2147483647; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; backdrop-filter: blur(10px);`;

    const title = isGuest ? "Session Ended" : "Practice Complete!";
    const desc = isGuest ? "The host has finished the session and closed the study room." : "Great job! You have finished all the questions.";

    modal.innerHTML = `
        <i class="fas fa-check-circle" style="color: #10b981; font-size: 5rem; margin-bottom: 1.5rem;"></i>
        <h1 style="color: white; font-family: 'Nunito', sans-serif; font-size: 2.5rem; margin-bottom: 1rem;">${title}</h1>
        <p style="color: #94a3b8; font-size: 1.2rem; margin-bottom: 2rem;">${desc}</p>
        <button id="btn-practice-home" style="background: #3b82f6; color: white; border: none; padding: 1rem 2.5rem; border-radius: 12px; font-weight: bold; cursor: pointer; font-size: 1.1rem; transition: 0.3s;">Save & Return Home</button>
    `;
    
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    document.getElementById('btn-practice-home').addEventListener('click', async (e) => {
        const btn = e.target;
        btn.textContent = "Saving Progress...";
        btn.disabled = true;
        
        await updateSpacedRepetition();
        
        if (!activeRoomId) {
            localStorage.removeItem('active_study_room');
            localStorage.removeItem('is_study_guest');
        }
        
        window.location.href = 'questions.html';
    });
}

// ==========================================
// 6. TIMER & MODAL NAVIGATION
// ==========================================
function startTimer() {
    timerInterval = setInterval(() => {
        if (isExamMode) {
            sessionSeconds--; 
            if (sessionSeconds <= 0) {
                clearInterval(timerInterval);
                alert("Time is up! Submitting exam automatically.");
                showResults();
                return;
            }
        } else { 
            sessionSeconds++; 
        }

        const sMins = Math.floor(sessionSeconds / 60).toString().padStart(2, '0');
        const sSecs = (sessionSeconds % 60).toString().padStart(2, '0');
        if (timerDisplay) timerDisplay.textContent = `${sMins}:${sSecs}`;

        if (currentQuestionData) {
            if (!currentQuestionData.timeSpent) currentQuestionData.timeSpent = 0;
            currentQuestionData.timeSpent++;

            const qMins = Math.floor(currentQuestionData.timeSpent / 60).toString().padStart(2, '0');
            const qSecs = (currentQuestionData.timeSpent % 60).toString().padStart(2, '0');
            if (qTimerDisplay) qTimerDisplay.textContent = `${qMins}:${qSecs}`;

            if (!isExamMode && !hasAnsweredCorrectly && currentQuestionData.timeSpent === 15) {
                if (aiHintBtn) {
                    aiHintBtn.style.display = 'inline-flex';
                    aiHintBtn.classList.add('pop-in'); 
                }
            }
        }
    }, 1000);
}

skipBtn.onclick = () => {
    let skippedQuestion = quizQueue.splice(currentIndex, 1)[0];
    skippedQuestion.hasBeenSkipped = true;
    quizQueue.push(skippedQuestion);
    triggerSlideTransition(currentIndex, 'right');
};

if (labValuesBtn) labValuesBtn.onclick = () => {
    if (labValuesModal) {
        labValuesModal.classList.remove('hidden');
        labValuesModal.classList.add('show');
    }
};
if (closeLabValuesBtn) closeLabValuesBtn.onclick = () => {
    if (labValuesModal) labValuesModal.classList.remove('show');
};

if (modalNextBtn) {
    modalNextBtn.onclick = () => {
        if (closeExplanationBtn) closeExplanationBtn.click(); 
        document.getElementById('next-btn').click();          
    };
}

if (explanationBtn) explanationBtn.onclick = () => { explanationModal.classList.remove('hidden'); explanationModal.classList.add('show'); };
if (closeExplanationBtn) closeExplanationBtn.onclick = () => explanationModal.classList.remove('show');

// Database Driven Hint Logic
if (aiHintBtn) {
    aiHintBtn.onclick = () => {
        if (!currentQuestionData) return;
        
        const originalText = aiHintBtn.innerHTML;
        aiHintBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Loading...`;
        aiHintBtn.disabled = true;

        setTimeout(() => {
            let hintText = currentQuestionData.hint;
            
            if (!hintText || hintText.trim() === "") {
                hintText = "No specific hint available for this question. Analyze the patient's primary symptoms, labs, and time-course carefully.";
            }

            alert(`💡 Hint:\n\n${hintText}`);

            aiHintBtn.innerHTML = originalText;
            aiHintBtn.disabled = false;
            aiHintBtn.style.display = 'none'; 
            
        }, 400); 
    };
}

document.getElementById('next-btn').onclick = async () => {
    if (activeRoomId && localStorage.getItem('is_study_guest') === 'true') {
        alert("Only the host can jump to different questions.");
        return;
    }
    if (isExamMode) {
        if (!currentQuestionData.userSelectedAnswer) return alert("Please select an answer. If you are stuck, click Skip.");
        if (currentIndex === quizQueue.length - 1) return showResults();
    }

    if (currentIndex < quizQueue.length - 1) {
        const newIndex = currentIndex + 1;
        syncNextQuestion(newIndex);
        triggerSlideTransition(newIndex, 'right');
    } else if (!isExamMode) {
        if (activeRoomId && localStorage.getItem('is_study_guest') !== 'true') {
            try {
                await updateDoc(doc(db, "study_rooms", activeRoomId), {
                    status: "waiting",
                    answers: {},
                    memberAnswers: deleteField(),
                    forceReveal: deleteField()
                });
            } catch (error) {
                console.error("Error resetting room:", error);
            }
        }
        
        showPracticeCompleteModal(false);
    }
};

document.getElementById('prev-btn').onclick = () => {
    if (activeRoomId && localStorage.getItem('is_study_guest') === 'true') {
        alert("Only the host can jump to different questions.");
        return;
    }
    if (isExamMode) return;
    if (currentIndex > 0) {
        const newIndex = currentIndex - 1;
        syncNextQuestion(newIndex);
        triggerSlideTransition(newIndex, 'left');
    }
};

// ==========================================
// 7. HOTKEYS & PROTECTIONS
// ==========================================
const shortcutsBtn = document.getElementById('shortcuts-btn');
const shortcutsModal = document.getElementById('shortcuts-modal');
const closeShortcutsBtn = document.getElementById('close-shortcuts-btn');

if (shortcutsBtn) shortcutsBtn.addEventListener('click', () => { if(shortcutsModal) { shortcutsModal.classList.remove('hidden'); shortcutsModal.classList.add('show'); shortcutsModal.style.display = 'flex'; } });
if (closeShortcutsBtn) closeShortcutsBtn.addEventListener('click', () => { if(shortcutsModal) { shortcutsModal.classList.add('hidden'); shortcutsModal.classList.remove('show'); setTimeout(() => { shortcutsModal.style.display = 'none'; }, 300); } });

document.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return; 

    const nextBtnLocal = document.getElementById('next-btn');
    const prevBtnLocal = document.getElementById('prev-btn');
    const explanationModalLocal = document.getElementById('explanation-modal');
    const isExplanationOpen = explanationModalLocal && explanationModalLocal.classList.contains('show');

    if (isExplanationOpen) {
        const modalContent = explanationModalLocal.querySelector('.modal-content');
        if (e.key === 'ArrowUp') { e.preventDefault(); if(modalContent) modalContent.scrollTop -= 40; return; } 
        else if (e.key === 'ArrowDown') { e.preventDefault(); if(modalContent) modalContent.scrollTop += 40; return; }
    }

    switch(e.key) {
        case 'ArrowRight': e.preventDefault(); if(nextBtnLocal) nextBtnLocal.click(); break;
        case 'ArrowLeft': e.preventDefault(); if(prevBtnLocal) prevBtnLocal.click(); break;
        case 'Escape': e.preventDefault(); if (shortcutsModal && !shortcutsModal.classList.contains('hidden')) document.getElementById('close-shortcuts-btn').click(); else if (isExplanationOpen) document.getElementById('close-explanation').click(); else window.location.href = 'questions.html'; break;
        case 'Enter': e.preventDefault(); if (isExplanationOpen) document.getElementById('close-explanation').click(); else if (isExamMode && nextBtnLocal) nextBtnLocal.click(); break;
        case 'x': case 'X': e.preventDefault(); if (hasAnsweredCorrectly && !isExamMode) { if (isExplanationOpen) document.getElementById('close-explanation').click(); else explanationBtn.click(); } break;
        case 'p': case 'P': e.preventDefault(); if (isExamMode && skipBtn) skipBtn.click(); break;
        case 's': case 'S': e.preventDefault(); if (currentQuestionData) document.getElementById('bookmark-btn').click(); break;
        case 'a': case 'A': case '1': selectOptionByIndex(0); break;
        case 'b': case 'B': case '2': selectOptionByIndex(1); break;
        case 'c': case 'C': case '3': selectOptionByIndex(2); break;
        case 'd': case 'D': case '4': selectOptionByIndex(3); break;
        case 'e': case 'E': case '5': selectOptionByIndex(4); break;
    }
});

function selectOptionByIndex(index) {
    if (hasAnsweredCorrectly && !isExamMode) return; 
    const options = document.querySelectorAll('.option-box');
    if (options && options[index]) options[index].click(); 
}

window.isScreenshotBlockEnabled = true; 

document.addEventListener('copy', (e) => {
    if (window.isScreenshotBlockEnabled) {
        e.preventDefault();
    }
});

document.addEventListener("keyup", (e) => {
    if (window.isScreenshotBlockEnabled && e.key === "PrintScreen") {
        navigator.clipboard.writeText("Screenshots are disabled for copyright protection.");
        const screen = document.getElementById('anti-screenshot-screen');
        if (screen) screen.style.display = 'flex';
    }
});

// ==========================================
// 8. EXIT LOGIC (Solo & Group Study)
// ==========================================
const globalExitBtn = document.getElementById('global-exit-btn');

if (globalExitBtn) {
    if (activeRoomId) {
        const isGuest = localStorage.getItem('is_study_guest') === 'true';

        globalExitBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Leave Room';
        globalExitBtn.style.color = '#ef4444';
        globalExitBtn.style.borderColor = '#ef4444';

        if (!isGuest) {
            const lobbyBtn = document.createElement('button');
            lobbyBtn.id = 'host-lobby-btn';
            lobbyBtn.className = globalExitBtn.className; 
            lobbyBtn.innerHTML = '<i class="fas fa-undo"></i> Return to Lobby';
            
            lobbyBtn.style.color = '#f59e0b';
            lobbyBtn.style.borderColor = '#f59e0b';
            lobbyBtn.style.marginRight = '10px';

            globalExitBtn.parentNode.insertBefore(lobbyBtn, globalExitBtn);

            lobbyBtn.onclick = async (e) => {
                e.preventDefault();
                if (!confirm("Stop the current quiz and return everyone to the lobby to pick new questions?")) return;

                lobbyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Returning...';
                lobbyBtn.disabled = true;
                globalExitBtn.style.display = 'none';

                try {
                    const tasks = [
                        updateSpacedRepetition(),
                        setDoc(doc(db, "study_rooms", activeRoomId), {
                            status: "waiting",
                            answers: {},           
                            memberAnswers: {},     
                            forceReveal: {},       
                            currentQuestionIndex: 0
                        }, { merge: true })
                    ];
                    await Promise.all(tasks);

                    window.location.href = 'questions.html';
                } catch (error) {
                    console.error("🔥 Firebase Error:", error);
                    lobbyBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error';
                }
            };
        }
    }

    globalExitBtn.onclick = async (e) => {
        e.preventDefault();
        
        if (activeRoomId && !confirm("Are you sure you want to completely leave and end the study group?")) return;

        globalExitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        globalExitBtn.disabled = true;

        try {
            const tasks = [updateSpacedRepetition()];

            if (activeRoomId) {
                const isGuest = localStorage.getItem('is_study_guest') === 'true';
                if (!isGuest) {
                    tasks.push(updateDoc(doc(db, "study_rooms", activeRoomId), { status: "ended", endedAt: serverTimestamp() }));
                } else {
                    tasks.push(updateDoc(doc(db, "study_rooms", activeRoomId), { [`activeMembers.${currentUserId}`]: deleteField() }));
                }
            }

            await Promise.all(tasks);

        } catch (error) { 
            console.error("Error during exit sequence:", error); 
        } finally {
            localStorage.removeItem('active_study_room');
            localStorage.removeItem('is_study_guest');
            window.location.href = 'questions.html';
        }
    };
}

async function updateSpacedRepetition() {
    if (localStorage.getItem('edeetos_guest_mode') === 'true') return;
    const user = auth.currentUser;
    if (!user) return;

    let targetName = quizConfig.examName || "General";
    if (targetName.startsWith("Revision: ")) {
        targetName = targetName.replace("Revision: ", "");
    }

    const activeCourse = localStorage.getItem('edeetos_active_course') || 'fcps_part1';
    const userRef = doc(db, "users", user.uid);

    try {
        const dbData = currentUserData || {};

        const isBookSessionLocal = isBookSession();   
        const currentRevisions = isBookSessionLocal
                ? (dbData.books?.revisions || {})
                : (dbData[activeCourse]?.revisions || {});

        const revisionsData = {};

        quizQueue.forEach(question => {
            if (!question) return;

            const subject = question.Subject || question.subject || "Unknown Subject";
            const chapter = question.Chapter || question.chapter || "Unknown Chapter";
            const topic = question.Topic || question.topic || "Unknown Topic";

            const sourceName = question.isBookQuestion
                    ? (question.bookName || question.Subject || 'Reference Book')
                    : activeCourse;

            const topicId = `${subject}::${chapter}::${topic}::${sourceName}`.replace(/[.#$/[\]]/g, '');

            let isCorrect = false;
            if (question.options && Array.isArray(question.options)) {
                const correctOption = question.options.find(o => o.isCorrect);
                isCorrect = correctOption && (question.userSelectedAnswer === correctOption.text || question.sessionState === 'correct');
            }

            if (!revisionsData[topicId]) {
                const existing = currentRevisions[topicId] || {};
                revisionsData[topicId] = {
                    subject, chapter, topic, 
                    sourceType: question.isBookQuestion ? 'book' : 'course',
                    sourceName: sourceName,
                    solvedQuestionsCount: existing.solvedQuestionsCount || 0,
                    mistakesCount: existing.mistakesCount || 0,
                    intervalStep: existing.intervalStep || 0,
                    status: "pending"
                };
            }

            revisionsData[topicId].solvedQuestionsCount += 1;
            if (!isCorrect) {
                revisionsData[topicId].mistakesCount += 1;
            }
        });

        Object.keys(revisionsData).forEach(topicId => {
            const data = revisionsData[topicId];
            const accuracy = Math.round(((data.solvedQuestionsCount - data.mistakesCount) / data.solvedQuestionsCount) * 100);

            let currentStep = data.intervalStep;
            if (accuracy >= 75) {
                currentStep = currentStep === 0 ? 1 : currentStep === 1 ? 7 : currentStep === 7 ? 15 : 30;
            } else {
                currentStep = 1;
            }

            data.accuracy = accuracy;
            data.lastAccuracy = accuracy;
            data.intervalStep = currentStep;
            data.dueDate = Date.now() + (currentStep * 24 * 60 * 60 * 1000);
            data.updatedAt = Date.now();
        });

        if (isBookSessionLocal) {
            await setDoc(userRef, { books: { revisions: revisionsData } }, { merge: true });
        } else {
            await setDoc(userRef, { [activeCourse]: { revisions: revisionsData } }, { merge: true });
        }
    } catch (error) {
        console.error("❌ Failed to update spaced repetition:", error);
    }
}

loadSession();