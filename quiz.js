import { auth, db } from './firebase-config.js';
import { doc, setDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

explanationModal.classList.remove('hidden');

if (isExamMode) {
    document.body.classList.add('mode-exam');
    sessionSeconds = quizConfig.timer * 60; 
}

function loadSession() {
    const storedData = localStorage.getItem('edeetos_active_quiz');
    if (storedData) {
        quizQueue = JSON.parse(storedData);
        if (quizQueue.length > 0) {
            // Assign original tracking numbers for logical sequence display
            quizQueue.forEach((q, i) => { if (!q.originalNumber) q.originalNumber = i + 1; });
            startTimer();
            if (!isExamMode) buildNumberGrid(); 
            loadQuestion(0);
        } else {
            window.location.href = 'questions.html';
        }
    } else {
        window.location.href = 'questions.html';
    }
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
        isSolvedInDatabase: false,
        hasBeenSkipped: false,
        userSelectedAnswer: null,
        originalNumber: rawCsvRow.originalNumber 
    };
}

function buildNumberGrid() {
    numberGrid.innerHTML = '';
    quizQueue.forEach((q, index) => {
        const numBtn = document.createElement('div');
        numBtn.className = 'grid-num';
        numBtn.id = `grid-num-${index}`;
        numBtn.textContent = index + 1;
        
        if (q.isSolvedInDatabase) numBtn.classList.add('solved');

        numBtn.onclick = () => {
            if (isExamMode) return; // Completely lock grid in exam mode
            if(index === currentIndex) return;
            const direction = index > currentIndex ? 'right' : 'left';
            triggerSlideTransition(index, direction);
        };
        numberGrid.appendChild(numBtn);
    });
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
    currentIndex = index;
    currentQuestionData = quizQueue[currentIndex];

    // Ensure question is formatted if it's still raw CSV data
    if (!currentQuestionData.options) {
        quizQueue[currentIndex] = formatCSVQuestion(currentQuestionData);
        currentQuestionData = quizQueue[currentIndex];
    }

    // Reset local state for the current view
    wrongAttempts = 0;
    hasAnsweredCorrectly = currentQuestionData.isSolvedInDatabase; 
    
    // UI Reset
    if (!isExamMode) updateFeedbackBar();
    explanationBtn.style.display = 'none'; 
    explanationModal.classList.remove('show');

    // === EXAM UI LOGIC ===
    if (isExamMode) {
        questionIdBadge.textContent = `Question ${currentQuestionData.originalNumber} / ${quizQueue.length}`;
        
        if (currentQuestionData.hasBeenSkipped) {
            skippedWarningEl.classList.remove('hidden');
            skipBtn.style.display = 'none'; 
        } else {
            skippedWarningEl.classList.add('hidden');
            skipBtn.style.display = 'block';
        }

        // Change button text on the last question
        if (currentIndex === quizQueue.length - 1) {
            document.getElementById('next-btn').textContent = "Submit Exam";
        } else {
            document.getElementById('next-btn').textContent = "Next";
        }
    } else {
        questionIdBadge.textContent = `Question ${currentQuestionData.originalNumber}`;
    }

    // Set Text Content
    questionTextEl.textContent = currentQuestionData.text;
    explanationText.textContent = currentQuestionData.explanation;

    // Render Options
    optionsContainer.innerHTML = '';
    currentQuestionData.options.forEach(opt => {
        const optBox = document.createElement('div');
        optBox.className = 'option-box';
        
        // Restore previous selection visuals
        if (isExamMode && currentQuestionData.userSelectedAnswer === opt.text) {
            optBox.classList.add('selected');
        } else if (!isExamMode && hasAnsweredCorrectly && opt.isCorrect) {
            optBox.classList.add('correct');
        }

        optBox.innerHTML = `
            <div class="option-text">${opt.text}</div>
            <i class="fas fa-eye eye-icon" title="Strikeout option"></i>
        `;
        optBox.onclick = (e) => handleOptionClick(e, opt, optBox);
        optionsContainer.appendChild(optBox);
    });

    // === BOOKMARK LOGIC (FIXED) ===
    const bookmarkBtn = document.getElementById('bookmark-btn');
    if (bookmarkBtn) {
        const starIcon = bookmarkBtn.querySelector('i');

        // 1. Set initial visual state based on data
        if (currentQuestionData.isBookmarked) {
            starIcon.classList.remove('far', 'fa-regular');
            starIcon.classList.add('fas', 'fa-solid');
        } else {
            starIcon.classList.remove('fas', 'fa-solid');
            starIcon.classList.add('far', 'fa-regular');
        }

        // 2. Fresh click handler for the current question
        bookmarkBtn.onclick = (e) => {
            e.preventDefault();
            
            // Toggle local data
            currentQuestionData.isBookmarked = !currentQuestionData.isBookmarked;

            // Toggle Visuals
            if (currentQuestionData.isBookmarked) {
                starIcon.classList.replace('far', 'fas');
                starIcon.classList.add('fa-solid');
            } else {
                starIcon.classList.replace('fas', 'far');
                starIcon.classList.remove('fa-solid');
            }

            // Sync with Firebase
            toggleBookmarkInFirebase(currentQuestionData.originalNumber, currentQuestionData.isBookmarked);
        };
    }

    updateGridStyles();
}
    // ==========================================
    // BOOKMARK UI SYNC (NEW)
    // ==========================================
    const bookmarkBtn = document.getElementById('bookmark-btn');
    if (bookmarkBtn) {
        // Check if this question is already bookmarked in our local state
        if (currentQuestionData.isBookmarked) {
            bookmarkBtn.classList.replace('far', 'fas'); // Change empty star to solid
        } else {
            bookmarkBtn.classList.replace('fas', 'far'); // Change solid star to empty
        }

        // Attach the click handler
        bookmarkBtn.onclick = () => {
            // Toggle local state
            currentQuestionData.isBookmarked = !currentQuestionData.isBookmarked;

            // Visual toggle
            if (currentQuestionData.isBookmarked) {
                bookmarkBtn.classList.replace('far', 'fas');
            } else {
                bookmarkBtn.classList.replace('fas', 'far');
            }

            // Save to Firebase (using the function we wrote in the previous step)
            toggleBookmarkInFirebase(currentQuestionData.originalNumber, currentQuestionData.isBookmarked);
        };
    }

    updateGridStyles();
}

// ==========================================
// DATABASE SYNC FUNCTIONS
// ==========================================
async function savePracticeProgress(questionId, isCorrect) {
    const user = auth.currentUser;
    if (!user) return; // If the user isn't logged in, do nothing

    // Point to this specific user's document in the "users" collection
    const userRef = doc(db, "users", user.uid);
    
    try {
        // setDoc with { merge: true } is safe: it creates the document if the 
        // user is brand new, or just updates it if they already exist!
        if (isCorrect) {
            await setDoc(userRef, {
                solvedQuestions: arrayUnion(questionId) // Adds to the list without duplicates
            }, { merge: true });
        } else {
            await setDoc(userRef, {
                mistakes: arrayUnion(questionId)
            }, { merge: true });
        }
    } catch (error) {
        console.error("Error saving to Firebase:", error);
    }
}

// ==========================================
// EXAM MODE DATABASE SYNC 
// ==========================================
// ==========================================
// EXAM MODE DATABASE SYNC (UPDATED)
// ==========================================
async function saveExamProgress(correctIds, mistakeIds) {
    console.log("🚀 Initiating Exam Save...");
    console.log("Correct IDs to save:", correctIds);
    console.log("Mistake IDs to save:", mistakeIds);

    const user = auth.currentUser;
    if (!user) {
        console.error("⚠️ Cannot save exam: No user is logged in.");
        return; 
    }

    const userRef = doc(db, "users", user.uid);
    
    try {
        let updates = {};
        
        if (correctIds.length > 0) {
            updates.solvedQuestions = arrayUnion(...correctIds);
        }
        if (mistakeIds.length > 0) {
            updates.mistakes = arrayUnion(...mistakeIds);
        }

        if (Object.keys(updates).length > 0) {
            await setDoc(userRef, updates, { merge: true });
            console.log("✅ Exam progress successfully saved to Firebase!");
        } else {
            console.log("ℹ️ No questions were answered, nothing to save.");
        }
        
    } catch (error) {
        console.error("❌ Error saving exam progress to Firebase:", error);
    }
}

// ==========================================
// BOOKMARK SYNC FUNCTION
// ==========================================
async function toggleBookmarkInFirebase(questionId, isBookmarking) {
    const user = auth.currentUser;
    if (!user) return; // Do nothing if not logged in

    const userRef = doc(db, "users", user.uid);
    
    try {
        // If isBookmarking is true, we add it. If false, we remove it.
        await setDoc(userRef, {
            bookmarks: isBookmarking ? arrayUnion(questionId) : arrayRemove(questionId)
        }, { merge: true });
    } catch (error) {
        console.error("Error updating bookmark in Firebase:", error);
    }
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

    // ... inside handleOptionClick ...
    
    if (!optionData.isCorrect) {
        optionElement.classList.remove('apply-shake');
        void optionElement.offsetWidth;
        optionElement.classList.add('incorrect', 'apply-shake');
        wrongAttempts++;
        updateFeedbackBar();
        
        // NEW: Save the mistake to Firebase
        savePracticeProgress(currentQuestionData.originalNumber, false); 
        
    } else {
        optionElement.classList.remove('apply-pop');
        void optionElement.offsetWidth; 
        optionElement.classList.add('correct', 'apply-pop');
        hasAnsweredCorrectly = true;
        currentQuestionData.isSolvedInDatabase = true; 
        document.querySelectorAll('.option-box').forEach(box => box.classList.add('locked'));
        updateFeedbackBar();
        document.getElementById(`grid-num-${currentIndex}`).classList.add('solved');
        
        // NEW: Save the solved question to Firebase
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

    if (isExamMode) {
        saveExamProgress(correctIds, mistakeIds);
    }

    const total = quizQueue.length;
    const percentage = Math.round((correctCount / total) * 100);
    
    document.getElementById('quiz-ui-container').style.display = 'none';
    document.getElementById('bottom-actions-container').style.display = 'none';
    
    // Target the Result Screen
    const resultsEl = document.getElementById('exam-result-screen');
    
    // Trigger the beautiful CSS pop-in animation
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
    if (isExamMode) return; // Completely blocked in exam mode
    if (currentIndex > 0) triggerSlideTransition(currentIndex - 1, 'left');
};

loadSession();