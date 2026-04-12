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

// DOM Elements
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

// ==========================================
// 2. INITIALIZE SESSION
// ==========================================
function loadSession() {
    const storedData = localStorage.getItem('edeetos_active_quiz');
    if (storedData) {
        quizQueue = JSON.parse(storedData);
        if (quizQueue.length > 0) {
            startTimer();
            buildNumberGrid();
            loadQuestion(0);
        } else {
            alert("Quiz queue is empty.");
            window.location.href = 'questions.html';
        }
    } else {
        window.location.href = 'questions.html';
    }
}

function formatCSVQuestion(rawCsvRow) {
    const correctLetter = (rawCsvRow['Answer'] || rawCsvRow['Correct Answer'] || '').toString().trim().toUpperCase();
    const options = [];
    
    ['A', 'B', 'C', 'D', 'E'].forEach(letter => {
        const optText = rawCsvRow[`Option ${letter}`] || rawCsvRow[letter]; 
        if (optText && optText.trim() !== '') {
            options.push({
                text: optText,
                isCorrect: correctLetter.startsWith(letter) || correctLetter === optText.toUpperCase()
            });
        }
    });

    return {
        text: rawCsvRow.Question || "Missing Question Text in Database",
        options: options,
        explanation: rawCsvRow.Explanation || "No explanation provided for this question.",
        isSolvedInDatabase: false 
    };
}

// ==========================================
// 3. RENDER THE QUESTION & GRID
// ==========================================
function buildNumberGrid() {
    numberGrid.innerHTML = '';
    quizQueue.forEach((_, index) => {
        const numBtn = document.createElement('div');
        numBtn.className = 'grid-num';
        numBtn.id = `grid-num-${index}`;
        numBtn.textContent = index + 1;
        numBtn.onclick = () => loadQuestion(index);
        numberGrid.appendChild(numBtn);
    });
}

function updateGridStyles() {
    document.querySelectorAll('.grid-num').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`grid-num-${currentIndex}`);
    if (activeBtn) activeBtn.classList.add('active');
}

function loadQuestion(index) {
    currentIndex = index;
    const rawData = quizQueue[currentIndex];
    currentQuestionData = formatCSVQuestion(rawData);

    wrongAttempts = 0;
    hasAnsweredCorrectly = false;
    updateFeedbackBar();
    explanationBtn.classList.add('hidden');
    explanationModal.classList.add('hidden');

    questionIdBadge.textContent = `Question ${currentIndex + 1}`;
    questionTextEl.textContent = currentQuestionData.text;
    explanationText.textContent = currentQuestionData.explanation;

    optionsContainer.innerHTML = '';
    currentQuestionData.options.forEach(opt => {
        const optBox = document.createElement('div');
        optBox.className = 'option-box';
        // Note: No A/B/C/D letter injected here! Matches old app perfectly.
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
// 4. INTERACTION LOGIC
// ==========================================
function handleOptionClick(event, optionData, optionElement) {
    if (event.target.classList.contains('eye-icon')) {
        optionElement.classList.toggle('strikethrough');
        return; 
    }
    if (hasAnsweredCorrectly || optionElement.classList.contains('incorrect')) return; 

    if (!optionData.isCorrect) {
        optionElement.classList.add('incorrect');
        wrongAttempts++;
        updateFeedbackBar();
    } else {
        optionElement.classList.add('correct');
        hasAnsweredCorrectly = true;
        
        document.querySelectorAll('.option-box').forEach(box => box.classList.add('locked'));
        updateFeedbackBar();
        
        const activeGridBtn = document.getElementById(`grid-num-${currentIndex}`);
        if(activeGridBtn) activeGridBtn.classList.add('solved');

        explanationBtn.classList.remove('hidden'); 
        setTimeout(() => explanationModal.classList.remove('hidden'), 400);
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
// 5. NAVIGATION CONTROLS
// ==========================================
explanationBtn.onclick = () => explanationModal.classList.remove('hidden');
closeExplanationBtn.onclick = () => explanationModal.classList.add('hidden');

document.getElementById('next-btn').onclick = () => {
    if (currentIndex < quizQueue.length - 1) loadQuestion(currentIndex + 1);
};

document.getElementById('prev-btn').onclick = () => {
    if (currentIndex > 0) loadQuestion(currentIndex - 1);
};

// Start the engine
loadSession();