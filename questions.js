// --- 1. DYNAMIC DATA ENGINE ---
let syllabusTree = {}; 
let allQuestions = []; // Stores the actual question data for later

async function loadDataAndBuildTree() {
    try {
        const csvPath = 'Data/fcps_part1.csv';
        const response = await fetch(csvPath);
        
        if (!response.ok) throw new Error("CSV not found");

        const csvText = await response.text();

        // --- MANUAL CSV PARSER ---
        const rows = csvText.split('\n').map(row => row.split(','));
        const headers = rows[0].map(h => h.trim()); // Get Subject, Chapter, etc.
        const dataRows = rows.slice(1); // Get all rows after the header

        syllabusTree = {}; 

        dataRows.forEach(row => {
            if (row.length < headers.length) return; // Skip empty/broken rows

            // Create an object for the row based on headers
            let rowObj = {};
            headers.forEach((header, index) => {
                rowObj[header] = row[index] ? row[index].trim() : "";
            });

            // Use the data to build the tree
            const { Subject, Chapter, Topic, SubTopic } = rowObj;

            if (!Subject) return;

            if (!syllabusTree[Subject]) syllabusTree[Subject] = {};
            if (!syllabusTree[Subject][Chapter]) syllabusTree[Subject][Chapter] = {};
            if (!syllabusTree[Subject][Chapter][Topic]) syllabusTree[Subject][Chapter][Topic] = [];

            if (SubTopic && !syllabusTree[Subject][Chapter][Topic].includes(SubTopic)) {
                syllabusTree[Subject][Chapter][Topic].push(SubTopic);
            }
        });

        console.log("Tree built using Manual Parser!");
        renderGrid();

    } catch (error) {
        console.error("Load Error:", error);
        renderGrid(); 
    }
}


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