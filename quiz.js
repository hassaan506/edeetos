// ==========================================
// 1. STATE VARIABLES & DATA LOAD
// ==========================================
let quizQueue = [];
let currentIndex = 0;
let currentQuestionData = null;
let wrongAttempts = 0;
let hasAnsweredCorrectly = false;
let sessionSeconds = 0;
let timerInterval;

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

// Remove conflicting classes on load
explanationModal.classList.remove('hidden');

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
            options.push({ text: optText, isCorrect: correctLetter === letter });
        }
    });

    return {
        text: rawCsvRow.Question || "Missing Question Text",
        options: options,
        explanation: rawCsvRow.Explanation || "No explanation provided.",
        isSolvedInDatabase: false 
    };
}

function buildNumberGrid() {
    numberGrid.innerHTML = '';
    quizQueue.forEach((_, index) => {
        const numBtn = document.createElement('div');
        numBtn.className = 'grid-num';
        numBtn.id = `grid-num-${index}`;
        numBtn.textContent = index + 1;
        
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
// 2. SLIDE TRANSITIONS (NEXT/PREV)
// ==========================================
function triggerSlideTransition(newIndex, direction) {
    const outClass = direction === 'right' ? 'slide-out-left' : 'slide-out-right';
    const inClass = direction === 'right' ? 'slide-in-right' : 'slide-in-left';

    // 1. Clear old classes and force reflow
    cardEl.className = 'question-card';
    void cardEl.offsetWidth; 
    
    // 2. Slide Out
    cardEl.classList.add(outClass);
    
    // 3. Wait for slide out, swap data, then Slide In
    setTimeout(() => {
        loadQuestion(newIndex);
        cardEl.className = 'question-card'; 
        void cardEl.offsetWidth; 
        cardEl.classList.add(inClass);
    }, 300);
}

function loadQuestion(index) {
    currentIndex = index;
    const rawData = quizQueue[currentIndex];
    currentQuestionData = formatCSVQuestion(rawData);

    wrongAttempts = 0;
    hasAnsweredCorrectly = false;
    updateFeedbackBar();
    explanationBtn.style.display = 'none'; // Hide explanation button initially
    explanationModal.classList.remove('show');

    questionIdBadge.textContent = `Question ${currentIndex + 1}`;
    questionTextEl.textContent = currentQuestionData.text;
    explanationText.textContent = currentQuestionData.explanation;

    optionsContainer.innerHTML = '';
    currentQuestionData.options.forEach(opt => {
        const optBox = document.createElement('div');
        optBox.className = 'option-box';
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
// 3. RIGHT/WRONG ANIMATIONS
// ==========================================
function handleOptionClick(event, optionData, optionElement) {
    if (event.target.classList.contains('eye-icon')) {
        optionElement.classList.toggle('strikethrough');
        return; 
    }
    if (hasAnsweredCorrectly || optionElement.classList.contains('incorrect')) return; 

    if (!optionData.isCorrect) {
        // FORCE SHAKE
        optionElement.classList.remove('apply-shake');
        void optionElement.offsetWidth; // Reflow
        optionElement.classList.add('incorrect', 'apply-shake');
        
        wrongAttempts++;
        updateFeedbackBar();
    } else {
        // FORCE POP
        optionElement.classList.remove('apply-pop');
        void optionElement.offsetWidth; // Reflow
        optionElement.classList.add('correct', 'apply-pop');
        
        hasAnsweredCorrectly = true;
        document.querySelectorAll('.option-box').forEach(box => box.classList.add('locked'));
        updateFeedbackBar();
        
        const activeGridBtn = document.getElementById(`grid-num-${currentIndex}`);
        if(activeGridBtn) activeGridBtn.classList.add('solved');

        explanationBtn.style.display = 'inline-block'; 
        
        // Show modal with animation
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

function startTimer() {
    timerInterval = setInterval(() => {
        sessionSeconds++;
        const mins = Math.floor(sessionSeconds / 60).toString().padStart(2, '0');
        const secs = (sessionSeconds % 60).toString().padStart(2, '0');
        timerDisplay.textContent = `${mins}:${secs}`;
    }, 1000);
}

// ==========================================
// 4. MODAL & NAVIGATION CONTROLS
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