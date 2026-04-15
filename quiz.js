import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, updateDoc, getDoc, arrayUnion, arrayRemove, addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

explanationModal.classList.remove('hidden');

if (isExamMode) {
    document.body.classList.add('mode-exam');
    sessionSeconds = quizConfig.timer * 60; 
}

function loadSession() {
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
	
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            const userRef = doc(db, "users", user.uid);
            try {
                const docSnap = await getDoc(userRef);
                if (docSnap.exists()) {
                    const dbData = docSnap.data();
                    
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
                console.error("❌ Firebase Load Error:", error);
            } finally {
                startTimer();
                if (!isExamMode) buildNumberGrid(); 
                loadQuestion(0);
            }
        } else {
            if (localStorage.getItem('edeetos_guest_mode') === 'true') {
                startTimer();
                if (!isExamMode) buildNumberGrid(); 
                loadQuestion(0);
            } else {
                window.location.href = 'login.html';
            }
        }
    });
}

function formatCSVQuestion(rawCsvRow) {
    const correctLetter = (rawCsvRow['CorrectAnswer'] || '').toString().trim().toUpperCase();
    const options = [];
    ['A', 'B', 'C', 'D', 'E'].forEach(letter => {
        const optKey = `Option${letter}`;
        const optText = rawCsvRow[optKey]; 
        if (optText && optText.trim() !== '') {
            options.push({ text: optText, isCorrect: correctLetter === letter, letter: letter });
        }
    });

    return {
        text: rawCsvRow.Question || "Missing Question Text",
        options: options,
        explanation: rawCsvRow.Explanation || "No explanation provided.",
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
        
        if (stateToShow === 'correct') {
            numBtn.classList.add('correct');
        } else if (stateToShow === 'wrong' || stateToShow === 'wrong_then_correct') {
            numBtn.classList.add('incorrect');
        }
        
        numBtn.id = `grid-num-${index}`;
        numBtn.textContent = index + 1;
        
        numBtn.onclick = () => {
            if (isExamMode) return; 
            if(index === currentIndex) return;
            const direction = index > currentIndex ? 'right' : 'left';
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

        if (!currentQuestionData.options) {
            quizQueue[currentIndex] = formatCSVQuestion(currentQuestionData);
            currentQuestionData = quizQueue[currentIndex];
        }

        wrongAttempts = 0;
        hasAnsweredCorrectly = (currentQuestionData.sessionState === 'correct' || currentQuestionData.sessionState === 'wrong_then_correct'); 
        
        if (!isExamMode) updateFeedbackBar();
        
        if (hasAnsweredCorrectly && !isExamMode) {
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

        questionTextEl.innerHTML = currentQuestionData.text;
        explanationText.innerHTML = currentQuestionData.explanation;

        optionsContainer.innerHTML = '';
        currentQuestionData.options.forEach(opt => {
            const optBox = document.createElement('div');
            optBox.className = 'option-box';
            
            if (isExamMode && currentQuestionData.userSelectedAnswer === opt.text) {
                optBox.classList.add('selected');
            } else if (!isExamMode && hasAnsweredCorrectly) {
                if (opt.isCorrect) optBox.classList.add('correct');
                optBox.classList.add('locked');
            }

            optBox.innerHTML = `<div class="option-text">${opt.text}</div><i class="fas fa-eye eye-icon"></i>`;
            optBox.onclick = (e) => handleOptionClick(e, opt, optBox);
            optionsContainer.appendChild(optBox);
        });

        // BOOKMARK
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

        // NOTES
        const noteBtn = document.getElementById('note-btn');
        if (noteBtn) {
            noteBtn.onclick = (e) => {
                e.preventDefault();
                if (localStorage.getItem('edeetos_guest_mode') === 'true') return alert("Please register an account to save personal notes.");
                if (noteInput) noteInput.value = currentQuestionData.userNote || ""; 
                if (notesModal) notesModal.classList.add('show');
            };
        }

        if (saveNoteBtn) {
            saveNoteBtn.onclick = () => {
                const typedNote = noteInput.value.trim();
                currentQuestionData.userNote = typedNote; 
                if (typeof saveNoteToFirebase === "function") {
                    saveNoteToFirebase(currentQuestionData.originalNumber, typedNote);
                }
                notesModal.classList.remove('show');
            };
        }

        if (closeNotesBtn) {
            closeNotesBtn.onclick = () => notesModal.classList.remove('show');
        }
		
        // REPORT QUESTION
        const btnReport = document.getElementById('btn-report');
        const reportModal = document.getElementById('report-modal');
        const closeReportBtn = document.getElementById('close-report-btn');
        const submitReportBtn = document.getElementById('submit-report-btn');
        const reportReasonInput = document.getElementById('report-reason-input');

        if (btnReport) {
            btnReport.onclick = () => {
                reportReasonInput.value = "";
                if (reportModal) reportModal.classList.remove('hidden');
                if (reportModal) reportModal.classList.add('show');
            };
        }

        if (closeReportBtn) {
            closeReportBtn.onclick = () => {
                if (reportModal) reportModal.classList.remove('show');
                setTimeout(() => reportModal.classList.add('hidden'), 300);
            };
        }

        if (submitReportBtn) {
            submitReportBtn.onclick = async () => {
                const reason = reportReasonInput.value.trim();
                if (!reason) return alert("Please specify why you are reporting this question.");
                
                const user = auth.currentUser;
                if (!user) return alert("Authentication error.");

                submitReportBtn.textContent = "Submitting...";
                submitReportBtn.disabled = true;

                try {
                    const activeCourse = localStorage.getItem('edeetos_active_course') || 'Unknown Course';
                    await addDoc(collection(db, "reported_questions"), {
                        userId: user.uid,
                        userEmail: user.email || "Unknown Email",
                        questionId: currentQuestionData.originalNumber,
                        courseFile: activeCourse,
                        questionText: currentQuestionData.text ? currentQuestionData.text.substring(0, 100) + "..." : "No text",
                        reason: reason,
                        timestamp: serverTimestamp()
                    });
                    
                    alert("Report submitted successfully. Thank you!");
                    if (reportModal) reportModal.classList.remove('show');
                    setTimeout(() => reportModal.classList.add('hidden'), 300);
                } catch (e) {
                    console.error("Error reporting question: ", e);
                    alert("Failed to submit report.");
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
// 3. DATABASE SYNC FUNCTIONS (COURSE ISOLATED)
// ==========================================
async function savePracticeProgress(questionId, isCorrect) {
    if (localStorage.getItem('edeetos_guest_mode') === 'true') return;
    const user = auth.currentUser;
    if (!user) return; 

    const activeCourse = localStorage.getItem('edeetos_active_course') || 'fcps_part1';
    const userRef = doc(db, "users", user.uid);
    
    // Dynamic paths for Firebase Dot Notation
    const solvedPath = `${activeCourse}.solvedQuestions`;
    const mistakesPath = `${activeCourse}.mistakes`;
    const examMistakesPath = `${activeCourse}.examMistakes`;
    
    let updates = {};

    if (isCorrect) {
        const isReviewMistakesMode = (quizConfig.examName === "Review Mistakes");
        
        updates[solvedPath] = arrayUnion(questionId); 

        // ONLY remove the mistake if they are actively in Practice Mistakes mode!
        if (isReviewMistakesMode) {
            updates[mistakesPath] = arrayRemove(questionId);      
            updates[examMistakesPath] = arrayRemove(questionId);   
        }
    } else {
        updates[mistakesPath] = arrayUnion(questionId);
    }

    try {
        await setDoc(userRef, updates, { merge: true });
    } catch (error) {
        console.error("Error saving to Firebase:", error);
    }
}

async function saveExamProgress(correctIds, mistakeIds, correctCount, totalQuestions) {
    if (localStorage.getItem('edeetos_guest_mode') === 'true') return;
    const user = auth.currentUser;
    if (!user) return; 

    const activeCourse = localStorage.getItem('edeetos_active_course') || 'fcps_part1';
    const userRef = doc(db, "users", user.uid);
    
    try {
        let updates = {};
        
        if (correctIds.length > 0) {
            updates[`${activeCourse}.examSolvedQuestions`] = arrayUnion(...correctIds);
            updates[`${activeCourse}.mistakes`] = arrayRemove(...correctIds);      
            updates[`${activeCourse}.examMistakes`] = arrayRemove(...correctIds);  
        }
        if (mistakeIds.length > 0) {
            updates[`${activeCourse}.examMistakes`] = arrayUnion(...mistakeIds);
        }

        const examTitle = quizConfig.examName || "Custom Exam"; 
        const examRecord = {
            examName: examTitle,
            score: correctCount,
            total: totalQuestions,
            percentage: Math.round((correctCount / totalQuestions) * 100),
            date: new Date().toISOString() 
        };

        updates[`${activeCourse}.examHistory`] = arrayUnion(examRecord);

        if (Object.keys(updates).length > 0) {
            await setDoc(userRef, updates, { merge: true });
        }
    } catch (error) {
        console.error("Error saving exam progress to Firebase:", error);
    }
}

async function toggleBookmarkInFirebase(questionId, isBookmarking) {
    const user = auth.currentUser;
    if (!user) return; 
    
    const activeCourse = localStorage.getItem('edeetos_active_course') || 'fcps_part1';
    const userRef = doc(db, "users", user.uid);
    
    try {
        await setDoc(userRef, {
            [`${activeCourse}.bookmarks`]: isBookmarking ? arrayUnion(questionId) : arrayRemove(questionId)
        }, { merge: true });
    } catch (error) { console.error("Error updating bookmark in Firebase:", error); }
}

async function saveNoteToFirebase(questionId, noteText) {
    const user = auth.currentUser;
    if (!user) return; 
    
    const activeCourse = localStorage.getItem('edeetos_active_course') || 'fcps_part1';
    const userRef = doc(db, "users", user.uid);
    
    try {
        await updateDoc(userRef, {
            [`${activeCourse}.notes.${questionId}`]: noteText
        });
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
            if (btn) {
                btn.classList.remove('correct'); 
                btn.classList.add('incorrect');
            }
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
            if (btn) {
                btn.classList.remove('incorrect');
                btn.classList.add('correct');
            }
        } else if (currentQuestionData.sessionState === 'wrong') {
            currentQuestionData.sessionState = 'wrong_then_correct';
        }
        
        savePracticeProgress(currentQuestionData.originalNumber, true); 
        
        explanationBtn.style.display = 'inline-block'; 
        setTimeout(() => explanationModal.classList.add('show'), 600);
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
// 4. EXAM SUBMISSION & RESULTS
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
    const percentage = Math.round((correctCount / total) * 100);
    
	if (isExamMode) {
        saveExamProgress(correctIds, mistakeIds, correctCount, total);
    }
	
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
// 5. TIMER & SKIP LOGIC
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

// ==========================================
// 6. MODAL & NAVIGATION CONTROLS
// ==========================================
explanationBtn.onclick = () => explanationModal.classList.add('show');
closeExplanationBtn.onclick = () => explanationModal.classList.remove('show');

document.getElementById('next-btn').onclick = () => {
    if (isExamMode) {
        if (!currentQuestionData.userSelectedAnswer) {
            alert("Please select an answer. If you are stuck, click Skip.");
            return;
        }
        if (currentIndex === quizQueue.length - 1) {
            showResults();
            return;
        }
    }

    if (currentIndex < quizQueue.length - 1) {
        triggerSlideTransition(currentIndex + 1, 'right');
    }
};

document.getElementById('prev-btn').onclick = () => {
    if (isExamMode) return; 
    if (currentIndex > 0) triggerSlideTransition(currentIndex - 1, 'left');
};

loadSession();

// ==========================================
// KEYBOARD SHORTCUTS
// ==========================================
const shortcutsBtn = document.getElementById('shortcuts-btn');
const shortcutsModal = document.getElementById('shortcuts-modal');
const closeShortcutsBtn = document.getElementById('close-shortcuts-btn');

if (shortcutsBtn) {
    shortcutsBtn.addEventListener('click', () => {
        if(shortcutsModal) shortcutsModal.classList.remove('hidden');
    });
}
if (closeShortcutsBtn) {
    closeShortcutsBtn.addEventListener('click', () => {
        if(shortcutsModal) shortcutsModal.classList.add('hidden');
    });
}

document.addEventListener('keydown', (e) => {
    // 1. Ignore shortcuts if the user is typing in any input or textarea
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        return; 
    }

    // 2. Handle Explanation Modal Scroll Hijacking (Up/Down)
    const explanationModalLocal = document.getElementById('explanation-modal');
    if (explanationModalLocal && !explanationModalLocal.classList.contains('hidden')) {
        const modalContent = document.querySelector('#explanation-modal .modal-content');
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            modalContent.scrollTop -= 40;
            return;
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            modalContent.scrollTop += 40;
            return;
        }
    }

    switch(e.key) {
        case 'ArrowRight':
            e.preventDefault();
            if(nextBtn) nextBtn.click();
            break;
        case 'ArrowLeft':
            e.preventDefault();
            const pBtn = document.getElementById('prev-btn');
            if(pBtn) pBtn.click();
            break;
        case 'Escape':
            e.preventDefault();
            // Close modals first if any are open
            if (shortcutsModal && !shortcutsModal.classList.contains('hidden')) shortcutsModal.classList.add('hidden');
            else if (explanationModalLocal && !explanationModalLocal.classList.contains('hidden')) document.getElementById('close-explanation').click();
            else if (document.getElementById('notes-modal') && document.getElementById('notes-modal').classList.contains('show')) document.getElementById('close-notes-btn').click();
            else if (document.getElementById('report-modal') && !document.getElementById('report-modal').classList.contains('hidden')) document.getElementById('close-report-btn').click();
            else window.location.href = 'questions.html'; 
            break;
        case 'Enter':
            // In Exam Mode, Enter acts as submitting the question. So click Next.
            if (isExamMode) {
                e.preventDefault();
                if(nextBtn) nextBtn.click();
            } else if (explanationModalLocal && !explanationModalLocal.classList.contains('hidden')) {
                e.preventDefault();
                document.getElementById('close-explanation').click();
            }
            break;
        case 'p':
        case 'P':
            e.preventDefault();
            if (isExamMode && skipBtn) skipBtn.click();
            break;
        case 's':
        case 'S':
            e.preventDefault();
            if (currentQuestionData) document.getElementById('bookmark-btn').click();
            break;
            
        // Map Keys A-E and 1-5 to Option Selection
        case 'a': case 'A': case '1': selectOptionByIndex(0); break;
        case 'b': case 'B': case '2': selectOptionByIndex(1); break;
        case 'c': case 'C': case '3': selectOptionByIndex(2); break;
        case 'd': case 'D': case '4': selectOptionByIndex(3); break;
        case 'e': case 'E': case '5': selectOptionByIndex(4); break;
    }
});

function selectOptionByIndex(index) {
    if (hasAnsweredCorrectly && !isExamMode) return; 
    const optionLabels = document.querySelectorAll('.option-label input[type="radio"]');
    if (optionLabels && optionLabels[index]) {
        optionLabels[index].click(); // This triggers the change event attached to labels naturally
    } else {
        // Fallback if structured differently
        const altLabels = document.querySelectorAll('.option-box');
        if (altLabels && altLabels[index]) altLabels[index].click();
    }
}