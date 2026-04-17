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
const isExamMode = quizConfig.mode === 'exam';

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

if (isExamMode) {
    document.body.classList.add('mode-exam');
    sessionSeconds = quizConfig.timer * 60; 
}

function loadSession() {
    // If you are a guest in a study room, do NOT load from local storage. Wait for Firebase.
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

                // MULTIPLAYER ATTENDANCE SYNC
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
                const savedNotes = courseData.notes || {};
                const savedBookmarks = courseData.bookmarks || [];
                const solvedList = courseData.solvedQuestions || [];
                const mistakesList = courseData.mistakes || [];
                const examMistakesList = courseData.examMistakes || [];

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
            // Only auto-start if they aren't waiting in a multiplayer lobby
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

function formatCSVQuestion(rawCsvRow) {
    const correctLetter = (rawCsvRow['CorrectAnswer'] || rawCsvRow['correctAnswer'] || '').toString().trim().toUpperCase();
    const options = [];
    
    ['A', 'B', 'C', 'D', 'E'].forEach(letter => {
        const optKeyUpper = `Option${letter}`;
        const optKeyLower = `option${letter}`;
        const optText = rawCsvRow[optKeyUpper] || rawCsvRow[optKeyLower]; 
        if (optText && optText.trim() !== '') {
            options.push({ text: optText, isCorrect: correctLetter === letter, letter: letter });
        }
    });
    
	const rawExplanation = rawCsvRow.Explanation || rawCsvRow.explanation || "No explanation provided.";

    return {
        text: rawCsvRow.Question || rawCsvRow.question || "Missing Question Text",
        options: options,
        explanation: rawExplanation,
        originalNumber: rawCsvRow.originalNumber,
        isBookmarked: rawCsvRow.isBookmarked || false,
        userNote: rawCsvRow.userNote || "",
        sessionState: rawCsvRow.sessionState || null,
        historicalState: rawCsvRow.historicalState || null,
        hasBeenSkipped: rawCsvRow.hasBeenSkipped || false,
        userSelectedAnswer: rawCsvRow.userSelectedAnswer || null
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
            
            // Lock out guests
            if (activeRoomId && localStorage.getItem('is_study_guest') === 'true') {
                alert("Only the host can jump to different questions.");
                return;
            }
            
            if(index === currentIndex) return;
            const direction = index > currentIndex ? 'right' : 'left';
            
            // Sync host clicks to the group
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

        // Reset Multiplayer states
        hasRevealedCurrentQuestion = false;
        hasAnsweredCurrentQuestion = false;
        const waitEl = document.getElementById('multiplayer-waiting-text');
        if (waitEl) waitEl.style.display = 'none';
        const forceBtn = document.getElementById('host-force-reveal-btn');
        if (forceBtn) forceBtn.style.display = 'none';

        if (!currentQuestionData.options) {
            quizQueue[currentIndex] = formatCSVQuestion(currentQuestionData);
            currentQuestionData = quizQueue[currentIndex];
        }

        wrongAttempts = 0;
        hasAnsweredCorrectly = (currentQuestionData.sessionState === 'correct' || currentQuestionData.sessionState === 'wrong_then_correct'); 
        
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
            
            if (isExamMode && currentQuestionData.userSelectedAnswer === opt.text) {
                optBox.classList.add('selected');
            } else if (!isExamMode && hasAnsweredCorrectly && !activeRoomId) {
                if (opt.isCorrect) optBox.classList.add('correct');
                optBox.classList.add('locked');
            }

            optBox.innerHTML = `<div class="option-text">${opt.text}</div><i class="fas fa-eye eye-icon"></i>`;
            optBox.onclick = (e) => handleOptionClick(e, opt, optBox);
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
// 3. DATABASE SYNC FUNCTIONS
// ==========================================
async function savePracticeProgress(questionId, isCorrect) {
    if (localStorage.getItem('edeetos_guest_mode') === 'true') return;
    const user = auth.currentUser;
    if (!user) return; 

    const activeCourse = localStorage.getItem('edeetos_active_course') || 'fcps_part1';
    const userRef = doc(db, "users", user.uid);
    let courseUpdates = {};

    if (isCorrect) {
        const isReviewMistakesMode = (quizConfig.examName === "Review Mistakes");
        courseUpdates.solvedQuestions = arrayUnion(questionId); 

        if (isReviewMistakesMode) {
            courseUpdates.mistakes = arrayRemove(questionId);      
            courseUpdates.examMistakes = arrayRemove(questionId);   
        }
    } else {
        courseUpdates.mistakes = arrayUnion(questionId);
    }

    try {
        await setDoc(userRef, { [activeCourse]: courseUpdates }, { merge: true });
    } catch (error) { console.error("Error saving practice progress:", error); }
}

async function saveExamProgress(correctIds, mistakeIds, correctCount, totalQuestions) {
    if (localStorage.getItem('edeetos_guest_mode') === 'true') return;
    const user = auth.currentUser;
    if (!user) return; 

    const activeCourse = localStorage.getItem('edeetos_active_course') || 'fcps_part1';
    const userRef = doc(db, "users", user.uid);
    
    try {
        let courseUpdates = {};
        if (correctIds.length > 0) courseUpdates.examMistakes = arrayRemove(...correctIds);  
        if (mistakeIds.length > 0) courseUpdates.examMistakes = arrayUnion(...mistakeIds);

        const examTitle = quizConfig.examName || "Custom Exam"; 
        const examRecord = {
            examName: examTitle,
            score: correctCount,
            total: totalQuestions,
            percentage: Math.round((correctCount / totalQuestions) * 100),
            date: new Date().toISOString() 
        };
        courseUpdates.examHistory = arrayUnion(examRecord);

        if (Object.keys(courseUpdates).length > 0) {
            await setDoc(userRef, { [activeCourse]: courseUpdates }, { merge: true });
        }
    } catch (error) { console.error("Error saving exam progress:", error); }
}

async function toggleBookmarkInFirebase(questionId, isBookmarking) {
    if (localStorage.getItem('edeetos_guest_mode') === 'true') return;
    const user = auth.currentUser;
    if (!user) return; 
    
    const activeCourse = localStorage.getItem('edeetos_active_course') || 'fcps_part1';
    const userRef = doc(db, "users", user.uid);
    
    try {
        await setDoc(userRef, { [activeCourse]: { bookmarks: isBookmarking ? arrayUnion(questionId) : arrayRemove(questionId) } }, { merge: true });
    } catch (error) { console.error("Error updating bookmark:", error); }
}

async function saveNoteToFirebase(questionId, noteText) {
    if (localStorage.getItem('edeetos_guest_mode') === 'true') return;
    const user = auth.currentUser;
    if (!user) return; 
    
    const activeCourse = localStorage.getItem('edeetos_active_course') || 'fcps_part1';
    const userRef = doc(db, "users", user.uid);
    
    try {
        await setDoc(userRef, { [activeCourse]: { notes: { [questionId]: noteText } } }, { merge: true });
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

    // MULTIPLAYER OVERRIDE
    if (activeRoomId) {
        if (hasAnsweredCurrentQuestion || hasRevealedCurrentQuestion) return;
        hasAnsweredCurrentQuestion = true;

        optionElement.style.border = "2px solid #3b82f6";
        document.querySelectorAll('.option-box').forEach(box => box.classList.add('locked'));

        // Push answer to Cloud
        updateDoc(roomRef, { [`answers.${currentIndex}.${currentUserId}`]: optionData.text });
        return;
    }

    // NORMAL SOLO MODE
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
// 4. MULTIPLAYER SYNC ENGINE
// ==========================================
function revealMultiplayerAnswers(answersObj, activeMembersMap) {
    hasRevealedCurrentQuestion = true;

    const waitEl = document.getElementById('multiplayer-waiting-text');
    if (waitEl) waitEl.style.display = 'none';

    const forceBtn = document.getElementById('host-force-reveal-btn');
    if (forceBtn) forceBtn.style.display = 'none';

    // Grade local user silently
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

    // Inject visual feedback and tags for all voters
    document.querySelectorAll('.option-box').forEach(box => {
        const textDiv = box.querySelector('.option-text');
        const optText = textDiv ? textDiv.textContent : '';
        const isOptCorrect = currentQuestionData.options.find(o => o.text === optText)?.isCorrect;

        if (isOptCorrect) box.classList.add('correct', 'apply-pop');
        else if (Object.values(answersObj).includes(optText)) box.classList.add('incorrect');

        // Look for anyone who voted for this box
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
            alert("The host has ended the study session.");
            localStorage.removeItem('active_study_room');
            localStorage.removeItem('is_study_guest');
            window.location.href = 'questions.html';
            return;
        }

        const isGuest = localStorage.getItem('is_study_guest') === 'true';

        // 1. LOBBY STATE (Guests waiting for Host)
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

        // 2. GAME INITIATION (Guests download questions)
        if (data.status === "playing" && isGuest) {
            const lobby = document.getElementById('mp-lobby-screen');
            if (lobby) lobby.remove();

            if (!quizQueue || quizQueue.length === 0) {
                quizQueue = data.questions;
                quizQueue.forEach((q, i) => { if (!q.originalNumber) q.originalNumber = q['QuestionID'] || `q-${i + 1}`; });
                loadQuestion(data.currentQuestionIndex || 0);
            }
        }

        // 3. SYNC PAGE NAVIGATION
        if (quizQueue && quizQueue.length > 0 && data.currentQuestionIndex !== undefined && data.currentQuestionIndex !== currentIndex) {
            const direction = data.currentQuestionIndex > currentIndex ? 'right' : 'left';
            triggerSlideTransition(data.currentQuestionIndex, direction);
        }

// 4. LIVE VOTING TRACKER & VISUAL ROSTER
        if (data.status === "playing" && activeRoomId) {
            const currentAnswers = (data.answers && data.answers[currentIndex]) ? data.answers[currentIndex] : {};
            const activeMembers = data.activeMembers || {};
            const answerCount = Object.keys(currentAnswers).length;
            const memberCount = Object.keys(activeMembers).length || 1;

            // --- INJECT VISUAL ROSTER HERE ---
            let rosterBox = document.getElementById('mp-roster-box');
            if (!rosterBox) {
                rosterBox = document.createElement('div');
                rosterBox.id = 'mp-roster-box';
                // Floats the roster on the top right of the screen
                rosterBox.style.cssText = "position: fixed; top: 100px; right: 20px; background: white; padding: 15px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); width: 220px; z-index: 1000; border: 1px solid #e2e8f0;";
                cardEl.parentElement.insertBefore(rosterBox, cardEl);
            }

            let rosterHtml = `<h4 style="margin: 0 0 10px 0; border-bottom: 2px solid #f1f5f9; padding-bottom: 8px; color: #0f172a; font-size: 1rem;">Live Roster</h4>`;
            
            Object.keys(activeMembers).forEach(uid => {
                const name = activeMembers[uid];
                const hasAnswered = currentAnswers.hasOwnProperty(uid);
                const isMe = uid === currentUserId;
                
                const statusColor = hasAnswered ? "#10b981" : "#cbd5e1"; 
                const statusText = hasAnswered ? "Locked In" : "Thinking";
                const nameWeight = isMe ? "800" : "500";
                
                rosterHtml += `
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
                        <span style="font-size: 0.9rem; font-weight: ${nameWeight}; color: #334155; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 110px;" title="${name}">
                            ${name} ${isMe ? "(You)" : ""}
                        </span>
                        <span style="display: flex; align-items: center; gap: 6px; font-size: 0.75rem; color: #64748b; font-weight: 600;">
                            ${statusText} <div style="width: 10px; height: 10px; border-radius: 50%; background: ${statusColor};"></div>
                        </span>
                    </div>
                `;
            });
            rosterBox.innerHTML = rosterHtml;
            // --- END VISUAL ROSTER ---

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

            // Trigger standard reveal
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
    
	if (isExamMode) saveExamProgress(correctIds, mistakeIds, correctCount, total);
	
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
        } else { sessionSeconds++; }

        const mins = Math.floor(sessionSeconds / 60).toString().padStart(2, '0');
        const secs = (sessionSeconds % 60).toString().padStart(2, '0');
        timerDisplay.textContent = `${mins}:${secs}`;
    }, 1000);
}

skipBtn.onclick = () => {
    let skippedQuestion = quizQueue.splice(currentIndex, 1)[0];
    skippedQuestion.hasBeenSkipped = true;
    quizQueue.push(skippedQuestion);
    triggerSlideTransition(currentIndex, 'right');
};

if (explanationBtn) explanationBtn.onclick = () => { explanationModal.classList.remove('hidden'); explanationModal.classList.add('show'); };
if (closeExplanationBtn) closeExplanationBtn.onclick = () => explanationModal.classList.remove('show');

document.getElementById('next-btn').onclick = () => {
    if (isExamMode) {
        if (!currentQuestionData.userSelectedAnswer) return alert("Please select an answer. If you are stuck, click Skip.");
        if (currentIndex === quizQueue.length - 1) return showResults();
    }

    if (currentIndex < quizQueue.length - 1) {
        const newIndex = currentIndex + 1;
        syncNextQuestion(newIndex);
        triggerSlideTransition(newIndex, 'right');
    }
};

document.getElementById('prev-btn').onclick = () => {
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

let isScreenshotBlockEnabled = true; 
document.addEventListener("keyup", (e) => {
    if (isScreenshotBlockEnabled && e.key === "PrintScreen") {
        navigator.clipboard.writeText("Screenshots are disabled for copyright protection.");
        document.getElementById('anti-screenshot-screen').style.display = 'flex';
    }
});

// ==========================================
// 8. GROUP STUDY: LEAVE LOGIC
// ==========================================
const leaveBtn = document.getElementById('leave-room-btn');
if (activeRoomId && leaveBtn) {
    leaveBtn.style.display = 'inline-block';

    leaveBtn.onclick = async () => {
        if (!confirm("Are you sure you want to leave the study group?")) return;
        const isGuest = localStorage.getItem('is_study_guest') === 'true';

        try {
            if (!isGuest) {
                await updateDoc(doc(db, "study_rooms", activeRoomId), { status: "ended", endedAt: serverTimestamp() });
            } else {
                // Remove self from active roster
                await updateDoc(doc(db, "study_rooms", activeRoomId), { [`activeMembers.${currentUserId}`]: deleteField() });
            }
        } catch (error) { console.error("Error leaving room:", error); } 
        finally {
            localStorage.removeItem('active_study_room');
            localStorage.removeItem('is_study_guest');
            window.location.href = 'questions.html';
        }
    };
}

loadSession();