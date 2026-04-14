import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, getDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
        q.historicalState = null; // NEW: Tracks history without locking the question
    });
	
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            const userRef = doc(db, "users", user.uid);
            try {
                const docSnap = await getDoc(userRef);
                if (docSnap.exists()) {
                    const dbData = docSnap.data();
                    const savedNotes = dbData.notes || {}; 
                    const savedBookmarks = dbData.bookmarks || []; 
                    
                    const solvedList = dbData.solvedQuestions || [];
                    const mistakesList = dbData.mistakes || [];
                    
                    Object.keys(dbData).forEach(key => {
                        if (key.startsWith('notes.')) {
                            const recoveredId = key.substring(6); 
                            savedNotes[recoveredId] = dbData[key];
                        }
                    });

                    quizQueue.forEach(q => {
                        q.isBookmarked = savedBookmarks.includes(q.originalNumber);
                        q.userNote = savedNotes[q.originalNumber] || "";
                        
                        // FIX: Save to historicalState so it colors the grid, but leaves the question unlocked!
                        if (solvedList.includes(q.originalNumber)) {
                            q.historicalState = 'correct';
                        } else if (mistakesList.includes(q.originalNumber)) {
                            q.historicalState = 'wrong';
                        }
                    });
                }
            } catch (error) {
                console.error("❌ Firebase Load Error:", error);
            }
        }
       
        startTimer();
        if (!isExamMode) buildNumberGrid(); 
        loadQuestion(0);
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
        
        // FIX: Look at current session first, fallback to historical colors
        const stateToShow = q.sessionState || q.historicalState;
        if (stateToShow === 'correct' || stateToShow === 'wrong_then_correct') numBtn.classList.add('correct');
        if (stateToShow === 'wrong') numBtn.classList.add('incorrect');
        
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
        // FIX: Question only locks if answered correctly IN THIS SESSION.
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

        questionTextEl.textContent = currentQuestionData.text;
        explanationText.textContent = currentQuestionData.explanation;

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
		
        updateGridStyles();

    } catch (error) { 
        console.error("🚨 CRASH inside loadQuestion:", error);
    }
}

// ==========================================
// 3. DATABASE SYNC FUNCTIONS
// ==========================================
async function savePracticeProgress(questionId, isCorrect) {
    const user = auth.currentUser;
    if (!user) return; 

    const userRef = doc(db, "users", user.uid);
    
    try {
        if (isCorrect) {
            const isReviewMistakesMode = (quizConfig.examName === "Review Mistakes");
            
            let updates = {
                solvedQuestions: arrayUnion(questionId) 
            };

            if (isReviewMistakesMode) {
                updates.mistakes = arrayRemove(questionId);      
                updates.examMistakes = arrayRemove(questionId);   
            }

            await setDoc(userRef, updates, { merge: true });
        } else {
            await setDoc(userRef, {
                mistakes: arrayUnion(questionId)
            }, { merge: true });
        }
    } catch (error) {
        console.error("Error saving to Firebase:", error);
    }
}

async function saveExamProgress(correctIds, mistakeIds, correctCount, totalQuestions) {
    const user = auth.currentUser;
    if (!user) return; 

    const userRef = doc(db, "users", user.uid);
    
    try {
        let updates = {};
        
        if (correctIds.length > 0) {
            updates.examSolvedQuestions = arrayUnion(...correctIds);
            updates.mistakes = arrayRemove(...correctIds);      
            updates.examMistakes = arrayRemove(...correctIds);  
        }
        if (mistakeIds.length > 0) {
            updates.examMistakes = arrayUnion(...mistakeIds);
        }

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
            await setDoc(userRef, updates, { merge: true });
        }
    } catch (error) {
        console.error("Error saving exam progress to Firebase:", error);
    }
}

async function toggleBookmarkInFirebase(questionId, isBookmarking) {
    const user = auth.currentUser;
    if (!user) return; 
    const userRef = doc(db, "users", user.uid);
    try {
        await setDoc(userRef, {
            bookmarks: isBookmarking ? arrayUnion(questionId) : arrayRemove(questionId)
        }, { merge: true });
    } catch (error) { console.error("Error updating bookmark in Firebase:", error); }
}

async function saveNoteToFirebase(questionId, noteText) {
    const user = auth.currentUser;
    if (!user) return; 
    const userRef = doc(db, "users", user.uid);
    try {
        const noteUpdate = { notes: {} };
        noteUpdate.notes[questionId] = noteText;
        await setDoc(userRef, noteUpdate, { merge: true });
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
            if (btn) btn.classList.add('incorrect');
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
                btn.classList.remove('incorrect'); // Clean up any historical red
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