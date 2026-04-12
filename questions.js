// --- 1. DYNAMIC DATA ENGINE ---
let syllabusTree = {}; 
let allQuestions = []; // Stores the actual question data for later

// Function to fetch the JSON file and build the tree
async function loadDataAndBuildTree() {
    try {
        // We will assume you save your converted Excel file as 'questions.json'
        const response = await fetch('questions.json'); 
        allQuestions = await response.json();

        // Automatically sort everything into Subject > Chapter > Topic > Subtopic
        allQuestions.forEach(row => {
            const subject = row.Subject;
            const chapter = row.Chapter;
            const topic = row.Topic;
            const subtopic = row.SubTopic;

            // If the subject doesn't exist in our tree yet, create it
            if (!syllabusTree[subject]) syllabusTree[subject] = {};
            
            // If the chapter doesn't exist under the subject, create it
            if (!syllabusTree[subject][chapter]) syllabusTree[subject][chapter] = {};
            
            // If the topic doesn't exist under the chapter, create an array for subtopics
            if (!syllabusTree[subject][chapter][topic]) syllabusTree[subject][chapter][topic] = [];

            // Finally, add the subtopic to the array (if it's not already there)
            if (!syllabusTree[subject][chapter][topic].includes(subtopic)) {
                syllabusTree[subject][chapter][topic].push(subtopic);
            }
        });

        // Now that the tree is built dynamically, render the grid on the screen!
        renderGrid();

    } catch (error) {
        console.error("Error loading the questions data:", error);
        subjectsGrid.innerHTML = `<p style="color: red;">Failed to load data. Make sure questions.json exists.</p>`;
    }
}

loadDataAndBuildTree();


// --- 2. STATE VARIABLES ---
let currentMode = "practice"; // 'practice' or 'exam'
let selectedCart = new Set(); // Stores checked topics for Exam Mode

// UI Elements
const subjectsGrid = document.getElementById('subjects-grid');
const modePracticeBtn = document.getElementById('mode-practice');
const modeExamBtn = document.getElementById('mode-exam');
const modeDesc = document.getElementById('mode-description');
const examCart = document.getElementById('exam-cart');
const cartCount = document.getElementById('cart-count');
const startExamBtn = document.getElementById('start-exam-btn');

// Popup Elements
const popupOverlay = document.getElementById('popup-overlay');
const popupTitle = document.getElementById('popup-title');
const popupList = document.getElementById('popup-list');
const popupBack = document.getElementById('popup-back');
const popupClose = document.getElementById('popup-close');

// --- 3. MODE TOGGLE LOGIC ---
function switchMode(mode) {
    currentMode = mode;
    selectedCart.clear();
    updateCartUI();

    if (mode === 'practice') {
        modePracticeBtn.className = "btn-solid active-mode";
        modeExamBtn.className = "btn-outline";
        modeDesc.textContent = "Practice Mode: Instant feedback, detailed explanations, pause & resume anytime.";
        examCart.style.display = "none";
    } else {
        modeExamBtn.className = "btn-solid active-mode";
        modePracticeBtn.className = "btn-outline";
        modeDesc.textContent = "Exam Mode: Timed mock exam. Mix and match topics using checkboxes. No instant feedback.";
        examCart.style.display = "flex";
    }
}

modePracticeBtn.addEventListener('click', () => switchMode('practice'));
modeExamBtn.addEventListener('click', () => switchMode('exam'));

// --- 4. RENDER INITIAL GRID ---
function renderGrid() {
    subjectsGrid.innerHTML = '';
    Object.keys(syllabusTree).forEach(subject => {
        const card = document.createElement('div');
        card.className = 'glass-panel feature-card';
        card.style.cursor = 'pointer';
        card.innerHTML = `
            <div class="icon">📚</div>
            <h3>${subject}</h3>
            <p>Click to browse chapters</p>
        `;
        card.onclick = () => openPopup(subject, syllabusTree[subject], 'Subject');
        subjectsGrid.appendChild(card);
    });
}

// --- 5. POPUP DRILL-DOWN LOGIC ---
function openPopup(title, dataObj, level) {
    popupTitle.textContent = title;
    popupList.innerHTML = '';
    popupOverlay.style.display = 'flex';

    // If we are looking at an array (Subtopics)
    if (Array.isArray(dataObj)) {
        dataObj.forEach(subtopic => {
            renderListItem(subtopic, subtopic, 'Subtopic');
        });
    } else {
        // If we are looking at an Object (Chapters or Topics)
        Object.keys(dataObj).forEach(key => {
            renderListItem(key, dataObj[key], level);
        });
    }
}

function renderListItem(itemName, nextData, level) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'list-item';

    const labelDiv = document.createElement('div');
    labelDiv.style.flexGrow = '1';
    
    // Add Checkbox for Exam Mode
    if (currentMode === 'exam') {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.style.marginRight = '10px';
        checkbox.checked = selectedCart.has(itemName);
        checkbox.onchange = (e) => {
            if (e.target.checked) selectedCart.add(itemName);
            else selectedCart.delete(itemName);
            updateCartUI();
        };
        labelDiv.appendChild(checkbox);
    }

    const textSpan = document.createElement('span');
    textSpan.textContent = itemName;
    textSpan.style.fontWeight = "500";
    labelDiv.appendChild(textSpan);
    itemDiv.appendChild(labelDiv);

    // Action Button
    const actionBtn = document.createElement('button');
    actionBtn.className = 'btn-outline mini-btn';
    actionBtn.style.marginTop = '0';
    
    if (Array.isArray(nextData) || typeof nextData === 'object') {
        actionBtn.textContent = 'View Contents ➡';
        actionBtn.onclick = () => openPopup(itemName, nextData, 'NextLevel');
    } else {
        actionBtn.textContent = currentMode === 'practice' ? 'Practice Now' : 'Select';
    }
    
    itemDiv.appendChild(actionBtn);
    popupList.appendChild(itemDiv);
}

// --- 6. CART & POPUP CONTROLS ---
function updateCartUI() {
    cartCount.textContent = `${selectedCart.size} Topics Selected`;
    startExamBtn.disabled = selectedCart.size === 0;
}

popupClose.onclick = () => popupOverlay.style.display = 'none';
// Hide popup if clicking outside the glass panel
popupOverlay.onclick = (e) => {
    if(e.target === popupOverlay) popupOverlay.style.display = 'none';
}

// Initialize the screen
renderGrid();
switchMode('practice');