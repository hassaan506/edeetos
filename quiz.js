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
const progressDisplay = document.getElementById('progress-display');
const questionIdBadge = document.getElementById('question-id-badge');

// ==========================================
// 2. INITIALIZE SESSION FROM LOCAL STORAGE
// ==========================================
function loadSession() {
    const storedData = localStorage.getItem('edeetos_active_quiz');
    if (storedData) {
        quizQueue = JSON.parse(storedData);
        if (quizQueue.length > 0) {
            startTimer();
            loadQuestion(0);
        } else {
            alert("Quiz queue is empty.");
            window.location.href = 'questions.html';
        }
    } else {
        // No data found, kick them back to the bank
        window.location.href = 'questions.html';
    }
}

// Convert your raw CSV row into the format the Quiz UI needs
function formatCSVQuestion(rawCsvRow) {
    // Determine the correct answer. (Adjust 'Answer' to match your exact CSV header)
    const correctLetter = (rawCsvRow['Answer'] || rawCsvRow['Correct Answer'] || '').toString().trim().toUpperCase();

    const options = [];
    // Loop through A, B, C, D, E columns from your CSV
    ['A', 'B', 'C', 'D', 'E'].forEach(letter => {
        // Adjust these to match your exact CSV headers for options (e.g., 'Option A' or just 'A')
        const optText = rawCsvRow[`Option ${letter}`] || rawCsvRow[letter]; 
        
        if (optText && optText.trim() !== '') {
            options.push({
                id: letter,
                text: optText,
                // It is correct if the Answer column matches this letter
                isCorrect: correctLetter.startsWith(letter) || correctLetter === optText.toUpperCase()
            });
        }
    });

    return {
        text: rawCsvRow.Question || "Missing Question Text in Database",
        options: options,
        explanation: rawCsvRow.Explanation || "No explanation provided for this question.",
        isSolvedInDatabase: false // We will connect this to a real database later
    };
}

// ==========================================
// 3. RENDER THE QUESTION
// ==========================================
function loadQuestion(index) {
    currentIndex = index;
    const rawData = quizQueue[currentIndex];
    currentQuestionData = formatCSVQuestion(rawData);

    // Reset State
    wrongAttempts = 0;
    hasAnsweredCorrectly = false;
    updateFeedbackBar();
    explanationBtn.classList.add('hidden');
    explanationModal.classList.add('hidden');

    // Update UI Headers
    progressDisplay.textContent = `${currentIndex + 1} / ${quizQueue.length}`;
    questionIdBadge.textContent = `Question ${currentIndex + 1}`;
    
    // Set Text
    questionTextEl.textContent = currentQuestionData.text;
    explanationText.textContent = currentQuestionData.explanation;

    // Render Options
    optionsContainer.innerHTML = '';
    currentQuestionData.options.forEach(opt => {
        const optBox = document.createElement('div');
        optBox.className = 'option-box';
        optBox.innerHTML = `
            <div class="option-content">
                <div class="option-letter">${opt.id}</div>
                <div class="option-text">${opt.text}</div>
            </div>
            <i class="fas fa-eye eye-icon" title="Strikeout option"></i>
        `;
        optBox.onclick = (e) => handleOptionClick(e, opt, optBox);
        optionsContainer.appendChild(optBox);
    });
}

// ==========================================
// 4. INTERACTION LOGIC ("Red-Until-Right")
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
    else alert("You have reached the end of this quiz session!");
};

document.getElementById('prev-btn').onclick = () => {
    if (currentIndex > 0) loadQuestion(currentIndex - 1);
};

// Start the engine
loadSession();