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

    if (!currentQuestionData.options) {
        quizQueue[currentIndex] = formatCSVQuestion(currentQuestionData);
        currentQuestionData = quizQueue[currentIndex];
    }

    wrongAttempts = 0;
    hasAnsweredCorrectly = currentQuestionData.isSolvedInDatabase; 
    
    if (!isExamMode) updateFeedbackBar();
    explanationBtn.style.display = 'none'; 
    explanationModal.classList.remove('show');

    // EXAM UI LOGIC
    if (isExamMode) {
        // Track the original sequence number so skipping feels logical
        questionIdBadge.textContent = `Question ${currentQuestionData.originalNumber} / ${quizQueue.length}`;
        
        if (currentQuestionData.hasBeenSkipped) {
            skippedWarningEl.classList.remove('hidden');
            skipBtn.style.display = 'none'; 
        } else {
            skippedWarningEl.classList.add('hidden');
            skipBtn.style.display = 'block';
        }

        if (currentIndex === quizQueue.length - 1) {
            document.getElementById('next-btn').textContent = "Submit Exam";
        } else {
            document.getElementById('next-btn').textContent = "Next";
        }
    } else {
        questionIdBadge.textContent = `Question ${currentQuestionData.originalNumber}`;
    }

    questionTextEl.textContent = currentQuestionData.text;
    explanationText.textContent = currentQuestionData.explanation;

    optionsContainer.innerHTML = '';
    currentQuestionData.options.forEach(opt => {
        const optBox = document.createElement('div');
        optBox.className = 'option-box';
        
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

    updateGridStyles();
}

// ==========================================
// 3. OPTION SELECTION LOGIC
// ==========================================
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
    } else {
        optionElement.classList.remove('apply-pop');
        void optionElement.offsetWidth; 
        optionElement.classList.add('correct', 'apply-pop');
        hasAnsweredCorrectly = true;
        currentQuestionData.isSolvedInDatabase = true; 
        document.querySelectorAll('.option-box').forEach(box => box.classList.add('locked'));
        updateFeedbackBar();
        document.getElementById(`grid-num-${currentIndex}`).classList.add('solved');
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
    quizQueue.forEach(q => {
        let correctOpt = q.options.find(o => o.isCorrect);
        if (correctOpt && q.userSelectedAnswer === correctOpt.text) {
            correctCount++;
        }
    });

    const total = quizQueue.length;
    const percentage = Math.round((correctCount / total) * 100);
    
    // Hide the quiz question UI completely
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