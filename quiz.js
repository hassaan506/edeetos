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

// Load Config from Bridge
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

explanationModal.classList.remove('hidden');

// Setup UI for Exam Mode
if (isExamMode) {
    document.body.classList.add('mode-exam');
    sessionSeconds = quizConfig.timer * 60; // Convert minutes to seconds for countdown
}

function loadSession() {
    const storedData = localStorage.getItem('edeetos_active_quiz');
    if (storedData) {
        quizQueue = JSON.parse(storedData);
        if (quizQueue.length > 0) {
            startTimer();
            buildNumberGrid();
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
        userSelectedAnswer: null // Tracks exam answer
    };
}

function buildNumberGrid() {
    numberGrid.innerHTML = '';
    quizQueue.forEach((q, index) => {
        const numBtn = document.createElement('div');
        numBtn.className = 'grid-num';
        numBtn.id = `grid-num-${index}`;
        numBtn.textContent = index + 1;
        
        // Restore answered state if user jumps around
        if (q.userSelectedAnswer || q.isSolvedInDatabase) {
            numBtn.classList.add(isExamMode ? 'answered' : 'solved');
        }

        numBtn.onclick = () => {
            if(index === currentIndex) return;
            const direction = index > currentIndex ? 'right' : 'left';
            triggerSlideTransition(index, direction);
        };
        numberGrid.appendChild(numBtn);
    });
}

function updateGridStyles() {
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

    // Format if not formatted yet
    if (!currentQuestionData.options) {
        quizQueue[currentIndex] = formatCSVQuestion(currentQuestionData);
        currentQuestionData = quizQueue[currentIndex];
    }

    wrongAttempts = 0;
    hasAnsweredCorrectly = currentQuestionData.isSolvedInDatabase; // Persist practice state
    
    if (!isExamMode) updateFeedbackBar();
    explanationBtn.style.display = 'none'; 
    explanationModal.classList.remove('show');

    // Skip Button Logic
    if (isExamMode && !currentQuestionData.hasBeenSkipped && !currentQuestionData.userSelectedAnswer) {
        skipBtn.style.display = 'block';
    } else {
        skipBtn.style.display = 'none';
    }

    questionIdBadge.textContent = `Question ${currentIndex + 1}`;
    questionTextEl.textContent = currentQuestionData.text;
    explanationText.textContent = currentQuestionData.explanation;

    optionsContainer.innerHTML = '';
    currentQuestionData.options.forEach(opt => {
        const optBox = document.createElement('div');
        optBox.className = 'option-box';
        
        // Restore previous states
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
// 3. RIGHT/WRONG vs EXAM SELECTION
// ==========================================
function handleOptionClick(event, optionData, optionElement) {
    if (event.target.classList.contains('eye-icon')) {
        optionElement.classList.toggle('strikethrough');
        return; 
    }

    // --- EXAM MODE BEHAVIOR ---
    if (isExamMode) {
        // Clear other selections
        document.querySelectorAll('.option-box').forEach(b => b.classList.remove('selected'));
        optionElement.classList.add('selected');
        
        // Save Answer
        currentQuestionData.userSelectedAnswer = optionData.text;
        document.getElementById(`grid-num-${currentIndex}`).classList.add('answered');
        
        // Hide Skip Button once answered
        skipBtn.style.display = 'none';
        return; 
    }

    // --- PRACTICE MODE BEHAVIOR ---
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
        currentQuestionData.isSolvedInDatabase = true; // Save solved state locally
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
// 4. TIMER & SKIP LOGIC
// ==========================================
function startTimer() {
    timerInterval = setInterval(() => {
        if (isExamMode) {
            sessionSeconds--; // Countdown
            if (sessionSeconds <= 0) {
                clearInterval(timerInterval);
                alert("Time is up! Your exam will now be submitted.");
                window.location.href = 'questions.html'; // Or redirect to a results page
                return;
            }
        } else {
            sessionSeconds++; // Countup
        }

        const mins = Math.floor(sessionSeconds / 60).toString().padStart(2, '0');
        const secs = (sessionSeconds % 60).toString().padStart(2, '0');
        timerDisplay.textContent = `${mins}:${secs}`;
    }, 1000);
}

// SKIP LOGIC
skipBtn.onclick = () => {
    // 1. Remove the current question from the array
    let skippedQuestion = quizQueue.splice(currentIndex, 1)[0];
    
    // 2. Mark it so it can't be skipped again
    skippedQuestion.hasBeenSkipped = true;
    
    // 3. Push it to the very end of the array
    quizQueue.push(skippedQuestion);
    
    // 4. Rebuild the visual grid to reflect the new order
    buildNumberGrid();
    
    // 5. The next question naturally falls into the currentIndex, so just trigger a reload
    // Edge case: if we skipped the very last item, pull index back by 1
    if (currentIndex >= quizQueue.length) {
        currentIndex = quizQueue.length - 1;
    }
    triggerSlideTransition(currentIndex, 'right');
};

// ==========================================
// 5. MODAL & NAVIGATION CONTROLS
// ==========================================
explanationBtn.onclick = () => explanationModal.classList.add('show');
closeExplanationBtn.onclick = () => explanationModal.classList.remove('show');

document.getElementById('next-btn').onclick = () => {
    if (currentIndex < quizQueue.length - 1) triggerSlideTransition(currentIndex + 1, 'right');
};

document.getElementById('prev-btn').onclick = () => {
    if (currentIndex > 0) triggerSlideTransition(currentIndex - 1, 'left');
};

loadSession();