import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, updateDoc, getDoc, arrayUnion, arrayRemove, onSnapshot, addDoc, collection, serverTimestamp, deleteField, increment } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

let activeRoomId = localStorage.getItem('active_study_room');
let roomRef = activeRoomId ? doc(db, "study_rooms", activeRoomId) : null;
let hasRevealedCurrentQuestion = false;
let hasAnsweredCurrentQuestion = false;

let hasShownSkipPopup = false;

const configStr = localStorage.getItem('edeetos_quiz_config');
const quizConfig = configStr ? JSON.parse(configStr) : { mode: 'practice', timer: 0 };
const isExamMode = (quizConfig.mode === 'exam') && !activeRoomId;

function isBookSession() {
    return quizQueue.length > 0 && quizQueue[0]?.isBookQuestion === true;
}

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

async function loadSession() {
    if (activeRoomId && localStorage.getItem('is_study_guest') === 'true') return;
    if (quizQueue && quizQueue.length > 0) return; // Skip if a backup was already restored

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
                    
                    // CRITICAL FIX: If this queue came from a friend challenge, strip the host's answers so they don't leak.
                    q.userSelectedAnswer = null;
                    q.eliminatedOptions = [];
                });
                resolve();
            };
        };
        request.onerror = () => window.location.href = 'questions.html';
    });
}

// ==========================================
// 3. INITIALIZATION & FIREBASE AUTH
// ==========================================
onAuthStateChanged(auth, async (user) => {
    await loadSession(); // FORCE THE QUEUE TO LOAD BEFORE FIREBASE CHECKS IT
    
    if (user) {
        currentUserId = user.uid; 
        const userRef = doc(db, "users", user.uid);

        try {
            const docSnap = await getDoc(userRef);

            if (docSnap.exists()) {
                const dbData = docSnap.data();
                currentUserData = dbData;

				if (activeRoomId) {
					await updateDoc(roomRef, {
						[`activeMembers.${currentUserId}`]: dbData.fullName || "Student"
					});
				}

                if (dbData.isBanned || dbData.role === 'BANNED') {
                    indexedDB.deleteDatabase("EdeetosDB");
                    localStorage.removeItem('edeetos_active_quiz');
                    localStorage.removeItem('edeetos_quiz_config');
                    
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

// ==========================================
// 4. SLIDE TRANSITIONS & RENDER
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
            if (optText && optText.trim() !== '') {
                formattedOptions.push({ text: optText, isCorrect: correctLetter === letter, letter: letter });
            }
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

function showSkippedModal() {
    const modal = document.createElement('div');
    modal.id = 'skipped-popup-modal';
    modal.style.cssText = `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background-color: rgba(15, 23, 42, 0.95); z-index: 2147483647; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; backdrop-filter: blur(10px);`;
    modal.innerHTML = `
        <i class="fas fa-exclamation-triangle" style="color: #f59e0b; font-size: 5rem; margin-bottom: 1.5rem;"></i>
        <h1 style="color: white; font-family: 'Nunito', sans-serif; font-size: 2.5rem; margin-bottom: 1rem;">Skipped Questions Phase</h1>
        <p style="color: #94a3b8; font-size: 1.2rem; margin-bottom: 2rem; max-width: 500px;">You are now returning to the questions you skipped. You must answer them now and can no longer skip.</p>
        <button id="btn-understood-skip" style="background: #3b82f6; color: white; border: none; padding: 1rem 2.5rem; border-radius: 12px; font-weight: bold; cursor: pointer; font-size: 1.1rem; transition: 0.3s;">Understood (Enter)</button>
    `;
    document.body.appendChild(modal);

    document.getElementById('btn-understood-skip').onclick = () => {
        modal.remove();
    };
}

function showMustAnswerModal() {
    if (document.getElementById('must-answer-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'must-answer-modal';
    modal.style.cssText = `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background-color: rgba(15, 23, 42, 0.85); z-index: 2147483647; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; backdrop-filter: blur(10px);`;
    modal.innerHTML = `
        <div class="glass-panel" style="background: white; padding: 30px; border-radius: 16px; max-width: 450px; width: 90%; box-shadow: 0 25px 50px rgba(0,0,0,0.25); animation: gentlePopIn 0.3s forwards;">
            <i class="fas fa-exclamation-circle" style="color: #f59e0b; font-size: 4rem; margin-bottom: 1rem;"></i>
            <h2 style="color: #1e3a8a; margin-top: 0; margin-bottom: 10px;">Select an Answer</h2>
            <p style="color: #475569; font-size: 1.05rem; margin-bottom: 20px;">Please select an answer to proceed. If you are stuck, use the <strong>Skip</strong> button.</p>
            <button id="btn-understood-must-answer" class="btn-solid" style="background: #3b82f6; color: white; border: none; padding: 0.8rem 2rem; border-radius: 8px; font-weight: bold; cursor: pointer; width: 100%; font-size: 1.1rem; transition: 0.2s;">Understood (Enter)</button>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('btn-understood-must-answer').onclick = () => {
        modal.remove();
    };
}

let quillHint, quillExplanation, quillQuestion;

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

        // ==========================================
        // ADMIN/MANAGEMENT BUTTON VISIBILITY CHECK
        // ==========================================
        const roleUpper = (currentUserData?.role || 'STUDENT').toUpperCase();
        if (roleUpper === 'ADMIN' || roleUpper === 'MANAGEMENT') {
            if (copyQBtn) copyQBtn.style.display = 'flex';
            if (editQBtn) editQBtn.style.display = 'flex';
        } else {
            if (copyQBtn) copyQBtn.style.display = 'none';
            if (editQBtn) editQBtn.style.display = 'none';
        }

        if (!currentQuestionData.options || !Array.isArray(currentQuestionData.options)) {
            quizQueue[currentIndex] = formatJSONQuestion(currentQuestionData);
            currentQuestionData = quizQueue[currentIndex];
        }

        wrongAttempts = 0;
        hasAnsweredCorrectly = false;
        
        if (aiHintBtn) {
            aiHintBtn.style.display = 'none'; 
            aiHintBtn.innerHTML = `<i class="fas fa-lightbulb"></i> Hint`; 
        }
        
        if (floatingHighlightBtn) floatingHighlightBtn.style.display = 'none'; 
        if (!isExamMode) updateFeedbackBar();
        
        if (hasAnsweredCorrectly && !isExamMode && !activeRoomId) {
            explanationBtn.style.display = 'inline-block';
        } else {
            explanationBtn.style.display = 'none'; 
            explanationModal.classList.remove('show');
        }

        const displayNum = currentQuestionData.sequenceNumber || (currentIndex + 1);
        if (questionIdBadge) {
            questionIdBadge.textContent = isExamMode ? `Question ${displayNum} / ${quizQueue.length}` : `Question ${displayNum}`;
        }

        const diffBadge = document.getElementById('question-difficulty-badge');
        if (diffBadge) {
            const diffText = (currentQuestionData.Difficulty || "").toLowerCase().trim();
            const baseStyle = "display: inline-block; padding: 0.4rem 1rem; border-radius: 20px; font-weight: 800; font-size: 0.8rem; letter-spacing: 0.5px;";
            
            if (diffText === 'easy') {
                diffBadge.textContent = "Easy";
                diffBadge.style.cssText = `${baseStyle} background: rgba(16, 185, 129, 0.15); color: #059669; border: 1px solid rgba(16, 185, 129, 0.3);`;
            } else if (diffText === 'medium') {
                diffBadge.textContent = "Medium";
                diffBadge.style.cssText = `${baseStyle} background: rgba(245, 158, 11, 0.15); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.3);`;
            } else if (diffText === 'hard') {
                diffBadge.textContent = "Hard";
                diffBadge.style.cssText = `${baseStyle} background: rgba(239, 68, 68, 0.15); color: #dc2626; border: 1px solid rgba(239, 68, 68, 0.3);`;
            } else {
                diffBadge.style.display = "none";
            }
        }

        if (isExamMode) {
            if (currentQuestionData.hasBeenSkipped) {
                skippedWarningEl.classList.remove('hidden');
                skipBtn.style.display = 'none'; 
                
                if (!hasShownSkipPopup) {
                    showSkippedModal();
                    hasShownSkipPopup = true;
                }
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
            let yearList = [];
            if (Array.isArray(yearData)) yearList = yearData;
            else if (typeof yearData === 'string' && yearData.trim() !== '') yearList = yearData.split(',');

            let examData = currentQuestionData.Exam || currentQuestionData.exams;
            let examList = Array.isArray(examData) ? examData : (examData ? [examData] : []);

            if ((yearList.length > 0 || examList.length > 0) && !isExamMode) {
                examYearInfo.style.display = 'flex';
                
                if (yearList.length > 0) {
                    badgesHTML += `<span style="background: #e2e8f0; color: #475569; padding: 4px 12px; border-radius: 12px; font-size: 0.75rem; font-weight: 800; letter-spacing: 0.5px;"><i class="fas fa-history" style="margin-right: 4px;"></i> ${yearList.join(', ')}</span>`;
                }
                
                examList.forEach(ex => {
                    if (ex.trim()) {
                        badgesHTML += `<span style="background: rgba(59, 130, 246, 0.15); color: #1e3a8a; border: 1px solid rgba(59, 130, 246, 0.3); padding: 4px 12px; border-radius: 12px; font-size: 0.75rem; font-weight: 800;"><i class="fas fa-file-signature" style="margin-right: 4px;"></i> ${ex.trim()}</span>`;
                    }
                });
                
                examYearInfo.innerHTML = badgesHTML;
            } else {
                examYearInfo.style.display = 'none';
            }
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

            if (currentQuestionData.eliminatedOptions && currentQuestionData.eliminatedOptions.includes(opt.text)) {
                optBox.classList.add('strikethrough');
            }

optBox.innerHTML = `
                <div class="option-text">${opt.text}</div>
                <div style="display: flex; gap: 8px;">
                    <button class="strike-btn" style="background: none; border: none; color: #94a3b8; font-size: 1.1rem; cursor: pointer; padding: 2px 6px; transition: 0.2s;" title="Strike out option">
                        <i class="fas fa-strikethrough"></i>
                    </button>
                </div>
            `;
            
            optBox.addEventListener('click', (e) => {
                e.preventDefault();
                if (e.target.closest('.strike-btn')) {
                    optBox.classList.toggle('strikethrough');
                    if (!currentQuestionData.eliminatedOptions) currentQuestionData.eliminatedOptions = [];
                    
                    if (optBox.classList.contains('strikethrough')) {
                        currentQuestionData.eliminatedOptions.push(opt.text);
                    } else {
                        currentQuestionData.eliminatedOptions = currentQuestionData.eliminatedOptions.filter(t => t !== opt.text);
                    }
                    return; 
                }
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

        // ==========================================
        // ADMIN COPY QUESTION LOGIC
        // ==========================================
        if (copyQBtn) {
            copyQBtn.onclick = () => {
                if (!currentQuestionData) return;
                
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = currentQuestionData.text || "Missing Question";
                let textToCopy = tempDiv.textContent.trim() + "\n\n";
                
                if (currentQuestionData.options && Array.isArray(currentQuestionData.options)) {
                    currentQuestionData.options.forEach((opt, idx) => {
                        const letter = String.fromCharCode(65 + idx);
                        textToCopy += `${letter}) ${opt.text}\n`;
                    });
                }
                
                const triggerSuccess = () => {
                    const icon = copyQBtn.querySelector('i');
                    icon.className = 'fas fa-check';
                    setTimeout(() => icon.className = 'far fa-copy', 1500);
                };

                if (navigator.clipboard && window.isSecureContext) {
                    navigator.clipboard.writeText(textToCopy).then(triggerSuccess);
                } else {
                    const textArea = document.createElement("textarea");
                    textArea.value = textToCopy;
                    document.body.appendChild(textArea);
                    textArea.select();
                    try {
                        document.execCommand('copy');
                        triggerSuccess();
                    } catch (err) {
                        console.error("Fallback copy failed", err);
                    }
                    document.body.removeChild(textArea);
                }
            };
        }

        // ==========================================
        // ADMIN EDIT QUESTION LOGIC & RICH TEXT
        // ==========================================
        if (editQBtn) {
            editQBtn.onclick = () => {
                if (!currentQuestionData) return;

                // Initialize Quill editors if they don't exist yet
                if (!quillHint) {
                    const toolbarOptions = [
                        ['bold', 'italic', 'underline', 'strike'], 
                        [{ 'script': 'sub'}, { 'script': 'super' }], // Added Sub/Super
                        [{ 'color': [] }, { 'background': [] }],
                        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                        [{ 'align': [] }],
                        ['clean']
                    ];
                    quillQuestion = new Quill('#edit-q-text', { theme: 'snow', modules: { toolbar: toolbarOptions } });
                    quillHint = new Quill('#edit-q-hint', { theme: 'snow', modules: { toolbar: toolbarOptions } });
                    quillExplanation = new Quill('#edit-q-explanation', { theme: 'snow', modules: { toolbar: toolbarOptions } });
                }

                // Populate Metadata (Checking both Uppercase and Lowercase from Python script)
                document.getElementById('edit-q-id').value = currentQuestionData.originalNumber || currentQuestionData.id || currentQuestionData.QuestionID || "";
                quillQuestion.root.innerHTML = currentQuestionData.text || currentQuestionData.question || "";
                document.getElementById('edit-q-subject').value = currentQuestionData.Subject || currentQuestionData.subject || "";
                document.getElementById('edit-q-chapter').value = currentQuestionData.Chapter || currentQuestionData.chapter || "";
                document.getElementById('edit-q-topic').value = currentQuestionData.Topic || currentQuestionData.topic || "";
                document.getElementById('edit-q-diff').value = (currentQuestionData.Difficulty || currentQuestionData.difficulty || "medium").toLowerCase();
                
                const yearVal = currentQuestionData.Year || currentQuestionData.year || "";
                document.getElementById('edit-q-year').value = Array.isArray(yearVal) ? yearVal.join(', ') : yearVal;
                
                const examVal = currentQuestionData.Exam || currentQuestionData.exams || currentQuestionData.exam || "";
                document.getElementById('edit-q-exam').value = Array.isArray(examVal) ? examVal.join(', ') : examVal;
                
                // Load HTML into the visual editors
                quillHint.root.innerHTML = currentQuestionData.hint || "";
                quillExplanation.root.innerHTML = currentQuestionData.explanation || "";

                // Populate Options
                const optsContainer = document.getElementById('edit-options-container');
                optsContainer.innerHTML = '';
                
if (currentQuestionData.options && Array.isArray(currentQuestionData.options)) {
                    currentQuestionData.options.forEach((opt, idx) => {
                        const letter = String.fromCharCode(65 + idx);
                        const isCorrect = opt.isCorrect ? "checked" : "";
                        
                        optsContainer.innerHTML += `
                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 5px;">
                                <input type="radio" name="edit-correct-opt" value="${idx}" ${isCorrect} style="transform: scale(1.2); cursor: pointer;" title="Mark as Correct">
                                <span style="font-weight: bold; color: #1e293b; width: 20px;">${letter})</span>
                                <input type="text" id="edit-opt-${idx}" value="${opt.text}" style="flex: 1; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px;">
                                <button type="button" class="tag-inject-btn btn-outline" data-target="edit-opt-${idx}" data-tag="br" style="padding: 2px 6px; font-size: 0.75rem; min-width: auto;" title="Line Break">↵</button>
                                <button type="button" class="tag-inject-btn btn-outline" data-target="edit-opt-${idx}" data-tag="sub" style="padding: 2px 6px; font-size: 0.75rem; min-width: auto;" title="Subscript">X₂</button>
                                <button type="button" class="tag-inject-btn btn-outline" data-target="edit-opt-${idx}" data-tag="sup" style="padding: 2px 6px; font-size: 0.75rem; min-width: auto;" title="Superscript">X²</button>
                            </div>
                        `;
                    });

                    // Cursor-aware tag injection for Option fields
                    document.querySelectorAll('.tag-inject-btn').forEach(btn => {
                        btn.onclick = (e) => {
                            e.preventDefault();
                            const targetId = btn.getAttribute('data-target');
                            const tag = btn.getAttribute('data-tag');
                            const input = document.getElementById(targetId);
                            const start = input.selectionStart;
                            const end = input.selectionEnd;
                            const val = input.value;
                            
                            if (tag === 'br') {
                                input.value = val.slice(0, start) + '<br>' + val.slice(end);
                                input.setSelectionRange(start + 4, start + 4);
                            } else {
                                const selected = val.slice(start, end);
                                input.value = val.slice(0, start) + `<${tag}>${selected}</${tag}>` + val.slice(end);
                                input.setSelectionRange(start + tag.length + 2, end + tag.length + 2);
                            }
                            input.focus();
                        };
                    });
                }

                adminEditModal.classList.remove('hidden');
                adminEditModal.classList.add('show');
            };
        }

        if (btnCancelEdit) {
            btnCancelEdit.onclick = () => {
                adminEditModal.classList.remove('show');
                setTimeout(() => adminEditModal.classList.add('hidden'), 300);
            };
        }

        if (btnSaveGithub) {
            btnSaveGithub.onclick = () => {
                const targetId = document.getElementById('edit-q-id').value;
                const radioElements = document.querySelectorAll('input[name="edit-correct-opt"]');
                let correctLetter = "A";
                radioElements.forEach((radio, index) => {
                    if (radio.checked) correctLetter = String.fromCharCode(65 + index);
                });

// Decodes structural blocks and inline styles without breaking math symbols
                const unescapeHTML = (str) => {
                    // 1. Target specific HTML tags and their attributes
                    let html = str.replace(/&lt;(\/?(h[1-6]|p|strong|em|sub|sup|br|div|span|ul|li|ol|b|i|u)(?:\s+[^&>]+)?)\&gt;/gi, '<$1>');
                    // 2. Fix the quotation marks that Quill escapes inside your style tags
                    return html.replace(/&quot;/g, '"');
                };

                const questionHTML = unescapeHTML(quillQuestion.root.innerHTML);
                const hintHTML = unescapeHTML(quillHint.root.innerHTML);
                const explanationHTML = unescapeHTML(quillExplanation.root.innerHTML);

const updatedRow = {
    "QuestionID": targetId,
    "Year": document.getElementById('edit-q-year').value.trim(),
    "Exam": document.getElementById('edit-q-exam').value.trim(),
    "Subject": document.getElementById('edit-q-subject').value.trim(),
    "Chapter": document.getElementById('edit-q-chapter').value.trim(),
    "Topic": document.getElementById('edit-q-topic').value.trim(),
    "Question": questionHTML,
    "OptionA": document.getElementById('edit-opt-0')?.value.trim() || "",
    "OptionB": document.getElementById('edit-opt-1')?.value.trim() || "",
    "OptionC": document.getElementById('edit-opt-2')?.value.trim() || "",
    "OptionD": document.getElementById('edit-opt-3')?.value.trim() || "",
    "OptionE": document.getElementById('edit-opt-4')?.value.trim() || "",
    "CorrectAnswer": correctLetter,
    "Explanation": explanationHTML,
    "Hint": hintHTML,
    "Difficulty": document.getElementById('edit-q-diff').value
};

                const isBook = currentQuestionData.isBookQuestion === true;
                const courseFile = isBook ? currentQuestionData.bookName : (localStorage.getItem('edeetos_active_course') || 'fcps_part1');

// Add to the local Queue
let pendingEditsQueue = JSON.parse(localStorage.getItem('edeetos_pending_edits')) || [];
const existingIndex = pendingEditsQueue.findIndex(e => e.row["QuestionID"] === targetId);
                
                if (existingIndex !== -1) {
                    pendingEditsQueue[existingIndex] = { row: updatedRow, courseFile, isBook };
                } else {
                    pendingEditsQueue.push({ row: updatedRow, courseFile, isBook });
                }
                
                localStorage.setItem('edeetos_pending_edits', JSON.stringify(pendingEditsQueue));

                // Instantly update the UI so you can see your changes while studying
                currentQuestionData.text = updatedRow["Question"];
                currentQuestionData.explanation = updatedRow["Explanation"];
                currentQuestionData.hint = updatedRow["Hint"];
                currentQuestionData.Subject = updatedRow["Subject"];
                currentQuestionData.Chapter = updatedRow["Chapter"];
                currentQuestionData.Topic = updatedRow["Topic"];
                currentQuestionData.Difficulty = updatedRow["Difficulty"];
                currentQuestionData.Year = updatedRow["Year"];
                currentQuestionData.Exam = updatedRow["Exam"];
                
                questionTextEl.innerHTML = currentQuestionData.text;
                explanationText.innerHTML = currentQuestionData.explanation;

                // Close the modal
                adminEditModal.classList.remove('show');
                setTimeout(() => adminEditModal.classList.add('hidden'), 300);
            };
        }

        updateGridStyles();

    } catch (error) { 
        console.error("🚨 CRASH inside loadQuestion:", error);
    }
}

// ==========================================
// 5. DATABASE SYNC FUNCTIONS
// ==========================================
async function syncNextQuestion(newIndex) {
    const isGuest = localStorage.getItem('is_study_guest') === 'true';
    if (isGuest) return;

    if (activeRoomId) {
        await updateDoc(doc(db, "study_rooms", activeRoomId), {
            currentQuestionIndex: newIndex
        });
    }
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
    } else {
        updates.mistakes = arrayUnion(questionId);
    }

    try {
        await setDoc(userRef, { [rootKey]: updates }, { merge: true });
    } catch (error) { console.error("Error saving practice progress:", error); }
}

async function savePracticeTime(timeInSeconds) {
    if (localStorage.getItem('edeetos_guest_mode') === 'true') return;
    const user = auth.currentUser;
    if (!user || timeInSeconds <= 0) return; 

    const userRef = doc(db, "users", user.uid);
    const rootKey = isBookSession() ? "books" : (localStorage.getItem('edeetos_active_course') || 'fcps_part1');
    
    try {
        // Uses increment to continuously add to their lifetime practice total
        await setDoc(userRef, { [rootKey]: { practiceTimeSpent: increment(timeInSeconds) } }, { merge: true });
    } catch (error) { console.error("Error saving practice time:", error); }
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

        const examTitle = quizConfig.examName || "Custom Exam"; 
        const examRecord = {
            examName: examTitle,
            score: correctCount,
            totalQuestions: totalQuestions, 
            percentage: Math.round((correctCount / totalQuestions) * 100),
            timeSpent: timeSpent, 
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
        
        if (!currentQuestionData.eliminatedOptions) {
            currentQuestionData.eliminatedOptions = [];
        }
        
        if (optionElement.classList.contains('strikethrough')) {
            currentQuestionData.eliminatedOptions.push(optionData.text);
        } else {
            currentQuestionData.eliminatedOptions = currentQuestionData.eliminatedOptions.filter(t => t !== optionData.text);
        }
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
// 6. CLINICAL HIGHLIGHTER & STRIKETHROUGH
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

    const handleTextSelection = () => {
        // A short timeout ensures mobile OS native selection finishes registering
        setTimeout(() => {
            const selection = window.getSelection();
            const selectedText = selection.toString().trim();
            
            // Ensure selection is actually inside the question text
            if (selectedText.length > 0 && questionTextEl.contains(selection.anchorNode)) {
                const range = selection.getRangeAt(0);
                const rect = range.getBoundingClientRect();
                
                floatingHighlightBtn.style.top = `${rect.top + window.scrollY - 45}px`;
                // Center the popup over the selection
                floatingHighlightBtn.style.left = `${rect.left + window.scrollX + (rect.width / 2) - 45}px`;
                floatingHighlightBtn.style.display = 'flex';
                
                // Use mousedown/touchstart to apply styling BEFORE the browser clears the selection
                const applyYellow = (e) => {
                    e.preventDefault(); 
                    applyTextFormat(range, selection, 'background-color: #fef08a; padding: 2px 4px; border-radius: 4px; color: #1e293b;');
                };
                
                const applyStrike = (e) => {
                    e.preventDefault(); 
                    applyTextFormat(range, selection, 'text-decoration: line-through; color: #94a3b8;');
                };

                const toolYellow = document.getElementById('tool-hl-yellow');
                const toolStrike = document.getElementById('tool-hl-strike');

                toolYellow.onmousedown = applyYellow;
                toolYellow.ontouchstart = applyYellow;
                
                toolStrike.onmousedown = applyStrike;
                toolStrike.ontouchstart = applyStrike;

            } else {
                floatingHighlightBtn.style.display = 'none';
            }
        }, 50);
    };

    // Listen for desktop mouse release and mobile touch release
    questionTextEl.addEventListener('mouseup', handleTextSelection);
    questionTextEl.addEventListener('touchend', handleTextSelection);

    // Actively monitor for selection changes/clears
    document.addEventListener('selectionchange', () => {
        const selection = window.getSelection();
        if (selection.toString().trim().length === 0) {
             floatingHighlightBtn.style.display = 'none';
        }
    });

    // Hide toolkit when tapping/clicking elsewhere
    const hideToolkit = (e) => {
        if (e.target.closest('#floating-toolkit') === null) {
            floatingHighlightBtn.style.display = 'none';
        }
    };

    document.addEventListener('mousedown', hideToolkit);
    document.addEventListener('touchstart', hideToolkit, { passive: true });
}

function applyTextFormat(range, selection, inlineStyles) {
    try {
        const mark = document.createElement('span');
        mark.style.cssText = inlineStyles;

        // Extract the selected content safely to handle compound nodes
        const fragment = range.extractContents();
        mark.appendChild(fragment);
        range.insertNode(mark);
    } catch (err) {
        console.warn("Highlighter fallback applied for compound node layouts.");
        // Non-destructive fallback if node structure is too complex
        const mark = document.createElement('mark');
        mark.style.cssText = inlineStyles;
        range.surroundContents(mark);
    }
    selection.removeAllRanges();
    if (floatingHighlightBtn) floatingHighlightBtn.style.display = 'none';
}

// ==========================================
// 7. MULTIPLAYER SYNC ENGINE
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
// 8. EXAM SUBMISSION & RESULTS
// ==========================================

// Intentional Exit Flag
let isIntentionalExit = false;

// Helper function to navigate away safely without triggering backups
function exitSafely(url) {
    isIntentionalExit = true;
    localStorage.removeItem('edeetos_aborted_session_backup');
    localStorage.removeItem('edeetos_challenge_data');
    window.location.href = url;
}

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
        } else {
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

    const challengeBtn = document.getElementById('btn-challenge-friend');
    const shareModal = document.getElementById('share-challenge-modal');
    const shareMsgEl = document.getElementById('share-message-text');
    const copyShareBtn = document.getElementById('btn-copy-share');
    const whatsappShareBtn = document.getElementById('btn-whatsapp-share');
    const closeShareBtn = document.getElementById('close-share-modal');

    if (isExamMode && challengeBtn) {
        challengeBtn.style.display = 'inline-block';
        
        challengeBtn.onclick = async (e) => {
            e.preventDefault();
            challengeBtn.textContent = "Generating Code...";
            challengeBtn.disabled = true;
            
            const timeTaken = (quizConfig.timer * 60) - sessionSeconds;
            const code = Math.random().toString(36).substring(2, 7).toUpperCase();
            
            try {
                // CRITICAL FIX: Aggressively scrub the queue so the host's answers NEVER leak to the friend.
                const sanitizedQueue = quizQueue.map(q => {
                    const newQ = { ...q };
                    newQ.userSelectedAnswer = null;
                    newQ.sessionState = null;
                    newQ.historicalState = null;
                    newQ.eliminatedOptions = [];
                    newQ.isBookmarked = false;
                    newQ.userNote = "";
                    return newQ;
                });
                
                const cleanQueue = JSON.parse(JSON.stringify(sanitizedQueue, (k, v) => v === undefined ? null : v));
                
                await setDoc(doc(db, "friend_challenges", code), {
                    hostName: (currentUserData && currentUserData.fullName) ? currentUserData.fullName : "A Friend",
                    score: correctCount,
                    total: total,
                    timeTaken: timeTaken,
                    calcMinutes: quizConfig.timer,
                    queue: cleanQueue,
                    timestamp: serverTimestamp()
                });
                
                // Format the share message
                const challengeText = `I just wrapped up a rigorous mock exam on EDEETOS and scored ${correctCount} out of ${total}! 🎯\n\nThink you have what it takes to beat my accuracy and time? Step up to the Friend Challenge and prove it.\n\nDrop my Challenge Code in the app: *${code}*\n\nLet's see who really knows their stuff!`;
                
                // Set modal values
                if (shareMsgEl) shareMsgEl.innerText = challengeText;
                
                if (whatsappShareBtn) {
                    whatsappShareBtn.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(challengeText)}`;
                }

                if (copyShareBtn) {
                    copyShareBtn.onclick = () => {
                        if (navigator.clipboard && window.isSecureContext) {
                            navigator.clipboard.writeText(challengeText).then(() => {
                                copyShareBtn.innerHTML = `<i class="fas fa-check"></i> Copied!`;
                                setTimeout(() => copyShareBtn.innerHTML = `<i class="fas fa-copy"></i> Copy Message`, 2000);
                            });
                        } else {
                            // Old browser/HTTP fallback
                            const textArea = document.createElement("textarea");
                            textArea.value = challengeText;
                            document.body.appendChild(textArea);
                            textArea.select();
                            try {
                                document.execCommand('copy');
                                copyShareBtn.innerHTML = `<i class="fas fa-check"></i> Copied!`;
                                setTimeout(() => copyShareBtn.innerHTML = `<i class="fas fa-copy"></i> Copy Message`, 2000);
                            } catch (err) {
                                prompt("Copy this challenge message:", challengeText);
                            }
                            document.body.removeChild(textArea);
                        }
                    };
                }

                if (closeShareBtn) {
                    closeShareBtn.onclick = () => {
                        shareModal.classList.remove('show');
                        setTimeout(() => shareModal.classList.add('hidden'), 300);
                    };
                }
                
                challengeBtn.innerHTML = `🎯 Challenge Code: <strong>${code}</strong>`;
                challengeBtn.disabled = false; // Allow re-opening the modal
                
                // Show the share modal
                if (shareModal) {
                    shareModal.classList.remove('hidden');
                    shareModal.classList.add('show');
                }
                
            } catch (err) {
                console.error("Challenge Link Error:", err);
                challengeBtn.textContent = "Error Generating Link";
                challengeBtn.disabled = false;
                alert("Failed to save challenge. Ensure you are connected to the internet and Firestore security rules allow writes.");
            }
        };
    }

    const returnBtn = document.getElementById('btn-return-home');
    const reviewBtn = document.getElementById('btn-review-exam-mistakes');
    
    // Core function to push the score to Firebase
    const saveExamData = async () => {
        const timeTaken = (quizConfig.timer * 60) - sessionSeconds; 
        const tasks = [];
        if (isExamMode) tasks.push(saveExamProgress(correctIds, mistakeIds, correctCount, total, timeTaken));
        tasks.push(updateSpacedRepetition());

        const assignedExamId = localStorage.getItem('edeetos_assigned_exam_id');
        if (assignedExamId && currentUserId) {
            tasks.push(updateDoc(doc(db, "assigned_exams", assignedExamId), {
                isCompletedBy: arrayUnion(currentUserId)
            }));
        }
        await Promise.all(tasks);
        localStorage.removeItem('edeetos_assigned_exam_id');
    };

    if (mistakeIds.length > 0 && reviewBtn) {
        reviewBtn.style.display = 'inline-block';
        reviewBtn.onclick = async (e) => {
            e.preventDefault();
            reviewBtn.textContent = "Loading Review...";
            reviewBtn.disabled = true;
            if (returnBtn) returnBtn.disabled = true;
            
            await saveExamData();
            
            // Set up a new practice session with only the mistakes using IndexedDB
            const mistakeQuestions = quizQueue.filter(q => mistakeIds.includes(q.originalNumber));
            const request = indexedDB.open("EdeetosDB", 1);
            
            request.onsuccess = (e) => {
                const idb = e.target.result;
                const tx = idb.transaction("quiz_sessions", "readwrite");
                tx.objectStore("quiz_sessions").put(mistakeQuestions, "active_quiz_queue");
                
                tx.oncomplete = () => {
                    localStorage.setItem('edeetos_quiz_config', JSON.stringify({ mode: 'practice', timer: 0, examName: 'Exam Review' }));
                    window.location.reload(); 
                };
            };
        };
    }

    if (returnBtn) {
        returnBtn.onclick = async (e) => {
            e.preventDefault();
            returnBtn.textContent = "Saving Exam Data...";
            returnBtn.disabled = true;
            if (reviewBtn) reviewBtn.disabled = true;

            await saveExamData();
            exitSafely('questions.html');
        };
    }
}

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
        
        const tasks = [updateSpacedRepetition()];
        if (!isExamMode) tasks.push(savePracticeTime(sessionSeconds));
        
        await Promise.all(tasks);
        
        if (!activeRoomId) {
            localStorage.removeItem('active_study_room');
            localStorage.removeItem('is_study_guest');
        }
        
        exitSafely('questions.html'); 
    });
}

// ==========================================
// 9. TIMER & MODAL NAVIGATION
// ==========================================
let isPaused = false;

const pauseOverlay = document.createElement('div');
pauseOverlay.id = 'pause-overlay';
pauseOverlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(15, 23, 42, 0.98); z-index: 999999; display: none; flex-direction: column; justify-content: center; align-items: center; color: white;";
pauseOverlay.innerHTML = `
    <i class="fas fa-pause-circle" style="font-size: 5rem; color: #3b82f6; margin-bottom: 20px;"></i>
    <h1 style="font-family: 'Nunito', sans-serif; margin-bottom: 10px;">Session Paused</h1>
    <p style="color: #94a3b8; margin-bottom: 30px;">Timer is frozen. Question text is hidden to prevent cheating.</p>
    <button id="btn-resume-quiz" class="btn-solid" style="background: #10b981; border: none; padding: 15px 30px; border-radius: 12px; font-size: 1.2rem; cursor: pointer; font-weight: bold; color: white;">Resume Session</button>
`;
document.body.appendChild(pauseOverlay);

document.getElementById('btn-resume-quiz').onclick = () => {
    isPaused = false;
    pauseOverlay.style.display = 'none';
};

function startTimer() {
    // CRITICAL FIX: The Pause Button is completely blocked from generating if it is Exam Mode
    if (!isExamMode && timerDisplay && timerDisplay.parentElement && !document.getElementById('pause-btn')) {
        const pauseBtn = document.createElement('button');
        pauseBtn.id = 'pause-btn';
        pauseBtn.innerHTML = '<i class="fas fa-pause"></i> Pause';
        
        // UI FIX: Stylized to match the green pill container with proper contrast
        pauseBtn.style.cssText = "background: white; border: 1px solid #a7f3d0; color: #065f46; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 0.8rem; font-weight: bold; transition: all 0.2s; display: flex; align-items: center; gap: 5px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); height: fit-content;";
        
        // UI FIX: Appended to the outer horizontal flex container (next to the total time block), preventing it from dropping below the numbers
        timerDisplay.parentElement.parentElement.appendChild(pauseBtn);
        
        pauseBtn.onclick = () => {
            isPaused = true;
            pauseOverlay.style.display = 'flex';
        };
    }

    timerInterval = setInterval(() => {
        if (isPaused) return; 

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
        if (timerDisplay) {
            timerDisplay.textContent = `${sMins}:${sSecs}`;
            
            if (isExamMode && sessionSeconds <= 300 && sessionSeconds > 0) {
                if (!document.getElementById('timer-stress-style')) {
                    const style = document.createElement('style');
                    style.id = 'timer-stress-style';
                    style.innerHTML = `@keyframes pulseRed { 0% { color: #ef4444; text-shadow: 0 0 10px rgba(239, 68, 68, 0.4); transform: scale(1); } 50% { color: #f87171; text-shadow: 0 0 20px rgba(239, 68, 68, 0.8); transform: scale(1.1); } 100% { color: #ef4444; text-shadow: 0 0 10px rgba(239, 68, 68, 0.4); transform: scale(1); } } .stress-active { animation: pulseRed 1s infinite; color: #ef4444 !important; }`;
                    document.head.appendChild(style);
                }
                timerDisplay.classList.add('stress-active');
            } else {
                timerDisplay.classList.remove('stress-active');
            }
        }
        
        const challengeDataStr = localStorage.getItem('edeetos_challenge_data');
        if (challengeDataStr && isExamMode) {
            const cData = JSON.parse(challengeDataStr);
            document.getElementById('challenge-tracker-wrapper').style.display = 'block';
            document.getElementById('challenge-name-display').textContent = `${cData.hostName}'s Pace`;
            document.getElementById('challenge-target-display').textContent = `Target: ${cData.score}/${cData.total}`;
            
            const timePassed = (quizConfig.timer * 60) - sessionSeconds;
            const progress = Math.min((timePassed / cData.timeTaken) * 100, 100);
            document.getElementById('challenge-bar-fill').style.width = `${progress}%`;
        }
		
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

const labSearchInput = document.getElementById('lab-search-input');
if (labSearchInput) {
    labSearchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const rows = document.querySelectorAll('#lab-values-table tr');
        
        rows.forEach((row, index) => {
            if (index === 0) return; 
            const testName = row.cells[0]?.textContent.toLowerCase() || "";
            if (testName.includes(query)) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
    });
}

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

            // Create a dynamic modal to render the HTML hint properly
            const hintModal = document.createElement('div');
            hintModal.id = 'dynamic-hint-modal';
            hintModal.style.cssText = `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background-color: rgba(15, 23, 42, 0.85); z-index: 2147483647; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; backdrop-filter: blur(8px); padding: 20px; box-sizing: border-box;`;
            
            hintModal.innerHTML = `
                <div style="background: white; padding: 30px; border-radius: 16px; max-width: 500px; width: 100%; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);">
                    <h2 style="color: #f59e0b; margin-top: 0; margin-bottom: 15px; font-family: 'Nunito', sans-serif;"><i class="fas fa-lightbulb"></i> Hint</h2>
                    <div style="color: #334155; font-size: 1.1rem; line-height: 1.6; margin-bottom: 25px; text-align: left;">
                        ${hintText}
                    </div>
                    <button id="close-dynamic-hint" style="background: #3b82f6; color: white; border: none; padding: 0.8rem 2rem; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 1rem; width: 100%; transition: 0.3s;">Got it!</button>
                </div>
            `;
            
            document.body.appendChild(hintModal);

            // Close the modal and remove it from the DOM when clicked
            document.getElementById('close-dynamic-hint').onclick = () => {
                hintModal.remove();
            };

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
        if (!currentQuestionData.userSelectedAnswer) {
            showMustAnswerModal(); // Replaced native alert()
            return;
        }
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
// 10. HOTKEYS & EVENT LISTENERS
// ==========================================
const shortcutsBtn = document.getElementById('shortcuts-btn');
const shortcutsModal = document.getElementById('shortcuts-modal');
const closeShortcutsBtn = document.getElementById('close-shortcuts-btn');

if (shortcutsBtn) shortcutsBtn.addEventListener('click', () => { if(shortcutsModal) { shortcutsModal.classList.remove('hidden'); shortcutsModal.classList.add('show'); shortcutsModal.style.display = 'flex'; } });
if (closeShortcutsBtn) closeShortcutsBtn.addEventListener('click', () => { if(shortcutsModal) { shortcutsModal.classList.add('hidden'); shortcutsModal.classList.remove('show'); setTimeout(() => { shortcutsModal.style.display = 'none'; }, 300); } });

document.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return; 
    
    // Check if Quill editor is active
    if (activeEl && activeEl.classList.contains('ql-editor')) return;

    // Add this block to close the Must Answer modal using Enter
    const mustAnswerModal = document.getElementById('must-answer-modal');
    if (mustAnswerModal && e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('btn-understood-must-answer').click();
        return;
    }

    const skippedModal = document.getElementById('skipped-popup-modal');
    if (skippedModal && e.key === 'Enter') {
        e.preventDefault();
        const understoodBtn = document.getElementById('btn-understood-skip');
        if (understoodBtn) understoodBtn.click();
        return; 
    }
    const nextBtnLocal = document.getElementById('next-btn');
    const prevBtnLocal = document.getElementById('prev-btn');
    const explanationModalLocal = document.getElementById('explanation-modal');
    const isExplanationOpen = explanationModalLocal && explanationModalLocal.classList.contains('show');

// Intercept physical number keys directly to bypass OS NumLock/Shift overrides
    if (e.code === 'Numpad1' || e.code === 'Digit1') { e.preventDefault(); e.shiftKey ? toggleStrikeByIndex(0) : selectOptionByIndex(0); return; }
    if (e.code === 'Numpad2' || e.code === 'Digit2') { e.preventDefault(); e.shiftKey ? toggleStrikeByIndex(1) : selectOptionByIndex(1); return; }
    if (e.code === 'Numpad3' || e.code === 'Digit3') { e.preventDefault(); e.shiftKey ? toggleStrikeByIndex(2) : selectOptionByIndex(2); return; }
    if (e.code === 'Numpad4' || e.code === 'Digit4') { e.preventDefault(); e.shiftKey ? toggleStrikeByIndex(3) : selectOptionByIndex(3); return; }
    if (e.code === 'Numpad5' || e.code === 'Digit5') { e.preventDefault(); e.shiftKey ? toggleStrikeByIndex(4) : selectOptionByIndex(4); return; }

    if (isExplanationOpen) {
        const modalContent = explanationModalLocal.querySelector('.modal-content');
        if (e.key === 'ArrowUp') { e.preventDefault(); if(modalContent) modalContent.scrollTop -= 40; return; } 
        else if (e.key === 'ArrowDown') { e.preventDefault(); if(modalContent) modalContent.scrollTop += 40; return; }
    }

    switch(e.key) {
        case 'ArrowRight': e.preventDefault(); if(nextBtnLocal) nextBtnLocal.click(); break;
        case 'ArrowLeft': e.preventDefault(); if(prevBtnLocal) prevBtnLocal.click(); break;
        case 'h': case 'H': e.preventDefault(); if (aiHintBtn && aiHintBtn.style.display !== 'none') aiHintBtn.click(); break;
        case 'Escape': e.preventDefault(); if (shortcutsModal && !shortcutsModal.classList.contains('hidden')) document.getElementById('close-shortcuts-btn').click(); else if (isExplanationOpen) document.getElementById('close-explanation').click(); else exitSafely('questions.html'); break; 
case 'Enter': 
            e.preventDefault(); 
            const dynamicHintBtn = document.getElementById('close-dynamic-hint');
            const practiceHomeBtn = document.getElementById('btn-practice-home');
            const returnHomeBtn = document.getElementById('btn-return-home');
            const resumeBtnLocal = document.getElementById('btn-resume-quiz');
            
            if (isPaused && resumeBtnLocal) resumeBtnLocal.click();
            else if (dynamicHintBtn) dynamicHintBtn.click();
            else if (practiceHomeBtn && document.getElementById('practice-complete-modal')) practiceHomeBtn.click();
            else if (returnHomeBtn && !document.getElementById('exam-result-screen').classList.contains('hidden')) returnHomeBtn.click();
            else if (isExplanationOpen) document.getElementById('close-explanation').click(); 
            else if (isExamMode && nextBtnLocal) nextBtnLocal.click(); 
            break;
        case 'x': case 'X': e.preventDefault(); if (hasAnsweredCorrectly && !isExamMode) { if (isExplanationOpen) document.getElementById('close-explanation').click(); else explanationBtn.click(); } break;
        case 'p': case 'P': 
            e.preventDefault(); 
            if (isExamMode && skipBtn) {
                skipBtn.click(); 
            } else if (!isExamMode) {
                const resumeBtnP = document.getElementById('btn-resume-quiz');
                if (isPaused && resumeBtnP) {
                    resumeBtnP.click();
                } else {
                    const pauseBtnLocal = document.getElementById('pause-btn');
                    if (pauseBtnLocal) pauseBtnLocal.click();
                }
            }
            break;
        case 's': case 'S': e.preventDefault(); if (currentQuestionData) document.getElementById('bookmark-btn').click(); break;
        case 'a': case 'A': e.shiftKey ? toggleStrikeByIndex(0) : selectOptionByIndex(0); break;
        case 'b': case 'B': e.shiftKey ? toggleStrikeByIndex(1) : selectOptionByIndex(1); break;
        case 'c': case 'C': e.shiftKey ? toggleStrikeByIndex(2) : selectOptionByIndex(2); break;
        case 'd': case 'D': e.shiftKey ? toggleStrikeByIndex(3) : selectOptionByIndex(3); break;
        case 'e': case 'E': e.shiftKey ? toggleStrikeByIndex(4) : selectOptionByIndex(4); break;
    }
});

function selectOptionByIndex(index) {
    if (hasAnsweredCorrectly && !isExamMode) return; 
    const options = document.querySelectorAll('.option-box');
    if (options && options[index]) options[index].click(); 
}

function toggleStrikeByIndex(index) {
    if (hasAnsweredCorrectly && !isExamMode) return; 
    const options = document.querySelectorAll('.option-box');
    if (options && options[index]) {
        const optBox = options[index];
        const optTextElement = optBox.querySelector('.option-text');
        if (!optTextElement) return;
        const optText = optTextElement.textContent;

        optBox.classList.toggle('strikethrough');
        if (!currentQuestionData.eliminatedOptions) currentQuestionData.eliminatedOptions = [];
        
        if (optBox.classList.contains('strikethrough')) {
            currentQuestionData.eliminatedOptions.push(optText);
        } else {
            currentQuestionData.eliminatedOptions = currentQuestionData.eliminatedOptions.filter(t => t !== optText);
        }
    }
}

// ==========================================
// 11. EXIT LOGIC (Solo & Group Study)
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
                        !isExamMode ? savePracticeTime(sessionSeconds) : Promise.resolve(), // Saves practice time
                        setDoc(doc(db, "study_rooms", activeRoomId), {
                            status: "waiting",
                            answers: {},           
                            memberAnswers: {},     
                            forceReveal: {},       
                            currentQuestionIndex: 0
                        }, { merge: true })
                    ];
                    await Promise.all(tasks);

                    exitSafely('questions.html'); 
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
            if (!isExamMode) tasks.push(savePracticeTime(sessionSeconds)); // Saves practice time

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
            exitSafely('questions.html'); 
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
			if (!question.userSelectedAnswer && !question.sessionState) return;
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

// ==========================================
// 12. TAB CLOSURE SAFETY & CHALLENGE USER CLEANUP
// ==========================================
function checkAndRestoreAbortedSession() {
    const backupStr = localStorage.getItem('edeetos_aborted_session_backup');
    if (backupStr) {
        if (confirm("We noticed your last practice session ended unexpectedly. Would you like to restore your progress?")) {
            const backup = JSON.parse(backupStr);
            quizQueue = backup.queue;
            // Need to parse config again to restore the object
            const restoredConfig = backup.config; 
            currentIndex = backup.index;
            sessionSeconds = backup.seconds;
            localStorage.removeItem('edeetos_aborted_session_backup');
            return true;
        }
        localStorage.removeItem('edeetos_aborted_session_backup');
    }
    return false;
}

window.addEventListener('beforeunload', (e) => {
    // Only save the backup if the exit flag is false
    if (!isIntentionalExit && quizQueue && quizQueue.length > 0 && !isExamMode && !activeRoomId) {
        localStorage.setItem('edeetos_aborted_session_backup', JSON.stringify({
            queue: quizQueue,
            config: quizConfig,
            index: currentIndex,
            seconds: sessionSeconds
        }));
    }
});

window.addEventListener('unload', () => {
    // Clean up the study room instantly if a user closes the window
    if (activeRoomId) {
        const isGuest = localStorage.getItem('is_study_guest') === 'true';
        if (roomRef) {
            import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js").then(({ updateDoc, deleteField }) => {
                if (isGuest && currentUserId) {
                    updateDoc(roomRef, { [`activeMembers.${currentUserId}`]: deleteField() });
                } else if (!isGuest) {
                    updateDoc(roomRef, { status: "ended" });
                }
            });
        }
    }
});

checkAndRestoreAbortedSession();
