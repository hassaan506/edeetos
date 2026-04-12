// --- 1. DYNAMIC DATA ENGINE ---
let subjectTree = {}; 
let systemTree = {};
let examTree = {};
let allQuestions = []; // Stores the actual rows to count questions
let currentView = "subject"; 


async function loadDataAndBuildTree() {
    try {
        const csvPath = 'Data/fcps_part1.csv';
        const response = await fetch(csvPath);
        if (!response.ok) throw new Error("CSV file not found");

        const csvText = await response.text();

        function parseCSV(text) {
            let p = '', row = [''], ret = [row], i = 0, r = 0, s = !0, l;
            for (l of text) {
                if ('"' === l) {
                    if (s && l === p) row[i] += l;
                    s = !s;
                } else if (',' === l && s) l = row[++i] = '';
                else if ('\n' === l && s) {
                    if ('\r' === p) row[i] = row[i].slice(0, -1);
                    row = ret[++r] = [l = '']; i = 0;
                } else row[i] += l;
                p = l;
            }
            return ret;
        }

        const rows = parseCSV(csvText);
        const headers = rows[0].map(h => h ? h.trim() : "");
        const dataRows = rows.slice(1);

        subjectTree = {}; systemTree = {}; examTree = {}; allQuestions = [];

        dataRows.forEach(row => {
            if (row.length < 2) return; 

            let rowObj = {};
            headers.forEach((header, index) => {
                rowObj[header] = row[index] ? row[index].trim() : "";
            });

            const Exam = rowObj.Exam;
            const Subject = rowObj.Subject;
            const Chapter = rowObj.Chapter;
            const Topic = rowObj.Topic;

            if (!Subject || Subject === "") return;

            // Save row for counting
            allQuestions.push({ Exam, Subject, Chapter, Topic });

            // 1. Build SUBJECT Tree
            if (!subjectTree[Subject]) subjectTree[Subject] = {};
            if (!subjectTree[Subject][Chapter]) subjectTree[Subject][Chapter] = [];
            if (Topic && !subjectTree[Subject][Chapter].includes(Topic)) subjectTree[Subject][Chapter].push(Topic);

            // 2. Build SYSTEM Tree
            if (Chapter) {
                if (!systemTree[Chapter]) systemTree[Chapter] = {};
                if (!systemTree[Chapter][Subject]) systemTree[Chapter][Subject] = [];
                if (Topic && !systemTree[Chapter][Subject].includes(Topic)) systemTree[Chapter][Subject].push(Topic);
            }

            // 3. Build EXAM Tree
            if (Exam) {
                if (!examTree[Exam]) examTree[Exam] = {};
                if (!examTree[Exam][Subject]) examTree[Exam][Subject] = [];
                if (Topic && !examTree[Exam][Subject].includes(Topic)) examTree[Exam][Subject].push(Topic);
            }
        });

        renderGrid();

    } catch (error) {
        console.error("Data Load Error:", error);
    }
}

// Helper: Count questions based on current path AND filters
function getQuestionCount(view, pathArr, customPool = null) {
    const pool = customPool || allQuestions;
    return pool.filter(q => {
        // 1. Unattempted Filter Logic (Assumes we have a unique ID for questions later)
        // For now, it passes everything until we build the quiz engine
        if (unattemptedFilter.checked && attemptedQuestions.includes(q.QuestionID)) return false;

        // 2. Path Logic
        if (view === 'subject') {
            if (pathArr[0] && q.Subject !== pathArr[0]) return false;
            if (pathArr[1] && q.Chapter !== pathArr[1]) return false;
            if (pathArr[2] && q.Topic !== pathArr[2]) return false;
        } else if (view === 'system') {
            if (pathArr[0] && q.Chapter !== pathArr[0]) return false;
            if (pathArr[1] && q.Subject !== pathArr[1]) return false;
            if (pathArr[2] && q.Topic !== pathArr[2]) return false;
        } else if (view === 'exam') {
            if (pathArr[0] && q.Exam !== pathArr[0]) return false;
            if (pathArr[1] && q.Subject !== pathArr[1]) return false;
            if (pathArr[2] && q.Topic !== pathArr[2]) return false;
        }
        return true;
    }).length;
}

// Event Listeners for Search and Filter
globalSearch.addEventListener('input', renderGrid);
unattemptedFilter.addEventListener('change', renderGrid);

// --- RENDER ACTIVE GRID (WITH SEARCH) ---
function renderGrid() {
    if (!subjectsGrid) return;
    subjectsGrid.innerHTML = '';
    
    const query = globalSearch.value.toLowerCase().trim();

    // IF SEARCHING: Show dynamic Search Results
    if (query !== '') {
        const matchedQuestions = allQuestions.filter(q => {
            if (unattemptedFilter.checked && attemptedQuestions.includes(q.QuestionID)) return false;
            // Search across Subject, Chapter, and Topic
            const textToSearch = `${q.Subject} ${q.Chapter} ${q.Topic}`.toLowerCase();
            return textToSearch.includes(query);
        });

        if (matchedQuestions.length === 0) {
            subjectsGrid.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: #64748b;">No questions found matching "${query}"</p>`;
            return;
        }

        // Extract unique topics from matches
        let matchedTopicsObj = {};
        matchedQuestions.forEach(q => { if (q.Topic) matchedTopicsObj[q.Topic] = null; });

        const card = document.createElement('div');
        card.className = 'glass-panel feature-card';
        card.style.cursor = 'pointer';
        card.innerHTML = `
            <div class="card-header-flex">
                <h3 class="card-title">🔍 Search Results</h3>
                <span class="card-count">0 / ${matchedQuestions.length}</span>
            </div>
            <div class="progress-container"><div class="progress-bar-fill" style="width: 0%;"></div></div>
        `;
        card.onclick = () => openPopup(`Search: ${query}`, matchedTopicsObj, 'Topic', [], false);
        subjectsGrid.appendChild(card);
        return; // Stop here so we don't draw the normal grid
    }

    // IF NOT SEARCHING: Draw normal grid
    let activeTree = {};
    if (currentView === 'subject') activeTree = subjectTree;
    if (currentView === 'system') activeTree = systemTree;
    if (currentView === 'exam') activeTree = examTree;
    
    Object.keys(activeTree).forEach(cardTitle => {
        const qCount = getQuestionCount(currentView, [cardTitle]);
        
        // Hide card if filter is on and there are 0 unattempted questions
        if (unattemptedFilter.checked && qCount === 0) return;

        let doneDummy = 0; 
        
        const card = document.createElement('div');
        card.className = 'glass-panel feature-card';
        card.style.cursor = 'pointer';
        card.innerHTML = `
            <div class="card-header-flex">
                <h3 class="card-title">${cardTitle}</h3>
                <span class="card-count">${doneDummy} / ${qCount}</span>
            </div>
            <div class="progress-container"><div class="progress-bar-fill" style="width: 0%;"></div></div>
        `;
        card.onclick = () => openPopup(cardTitle, activeTree[cardTitle], 'Level1', [cardTitle], false);
        subjectsGrid.appendChild(card);
    });
}

// --- 2. STATE VARIABLES ---
let currentMode = "practice"; 
let selectedCart = new Set(); 
let popupHistory = []; 

const subjectsGrid = document.getElementById('subjects-grid');
const popupOverlay = document.getElementById('popup-overlay');
const popupTitle = document.getElementById('popup-title');
const popupList = document.getElementById('popup-list');
const popupBack = document.getElementById('popup-back');
const globalSearch = document.getElementById('global-search');
const unattemptedFilter = document.getElementById('unattempted-filter');

// Dummy array for future Local Storage (IDs of questions you've answered)
let attemptedQuestions = [];

// ... (Keep your switchMode and Sidebar functions exactly as they were) ...
function switchMode(mode) {
    currentMode = mode;
    selectedCart.clear();
    document.getElementById('cart-count').textContent = `0 Topics Selected`;
    document.getElementById('start-exam-btn').disabled = true;

    if (mode === 'practice') {
        document.getElementById('mode-practice').className = "btn-solid active-mode";
        document.getElementById('mode-exam').className = "btn-outline";
        document.getElementById('exam-cart').style.display = "none";
    } else {
        document.getElementById('mode-exam').className = "btn-solid active-mode";
        document.getElementById('mode-practice').className = "btn-outline";
        document.getElementById('exam-cart').style.display = "flex";
    }
}
document.getElementById('mode-practice').addEventListener('click', () => switchMode('practice'));
document.getElementById('mode-exam').addEventListener('click', () => switchMode('exam'));

// --- 4. POPUP & HISTORY LOGIC ---
function openPopup(title, dataObj, level, pathArr, isBackNav = false) {
    if (!isBackNav) popupHistory.push({ title, dataObj, level, pathArr });

    popupTitle.textContent = title;
    popupList.innerHTML = '';
    popupOverlay.style.display = 'flex';
    popupBack.style.display = popupHistory.length > 1 ? 'inline-block' : 'none';

    // 🌟 ADD "PRACTICE FULL" BUTTON AT THE TOP 🌟
    if (currentMode === 'practice') {
        const fullCount = getQuestionCount(currentView, pathArr);
        const practiceAllDiv = document.createElement('div');
        practiceAllDiv.className = 'list-item';
        practiceAllDiv.style.backgroundColor = 'rgba(16, 185, 129, 0.1)'; // Highlighted green
        practiceAllDiv.style.border = '1px solid #10b981';
        practiceAllDiv.innerHTML = `
            <div style="flex-grow: 1;">
                <div class="card-header-flex">
                    <span style="font-weight: bold; color: #064e3b;">Practice Full ${title}</span>
                    <span class="card-count" style="color: #059669;">0 / ${fullCount}</span>
                </div>
                <div class="progress-container"><div class="progress-bar-fill" style="width: 0%;"></div></div>
            </div>
            <button class="btn-solid mini-btn" style="margin-left: 15px;">Start ➡</button>
        `;
        popupList.appendChild(practiceAllDiv);
    }

    // Render list items dynamically
    if (Array.isArray(dataObj)) {
        dataObj.forEach(topic => renderListItem(topic, null, 'Topic', [...pathArr, topic]));
    } else {
        Object.keys(dataObj).forEach(key => renderListItem(key, dataObj[key], level, [...pathArr, key]));
    }
}

function renderListItem(itemName, nextData, level, itemPath) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'list-item';

    const labelDiv = document.createElement('div');
    labelDiv.style.flexGrow = '1';
    
    // Calculate questions for this specific row
    const qCount = getQuestionCount(currentView, itemPath);
    let doneDummy = 0; // We will link this to local storage later

    labelDiv.innerHTML = `
        <div class="card-header-flex">
            <span style="font-weight: 600; display: flex; align-items: center;">
                ${currentMode === 'exam' ? `<input type="checkbox" style="margin-right: 10px;" id="cb-${itemName}">` : ''}
                ${itemName}
            </span>
            <span class="card-count">${doneDummy} / ${qCount}</span>
        </div>
        <div class="progress-container"><div class="progress-bar-fill" style="width: 0%;"></div></div>
    `;

    itemDiv.appendChild(labelDiv);

    const actionBtn = document.createElement('button');
    actionBtn.className = 'btn-outline mini-btn';
    actionBtn.style.marginLeft = '15px';
    
    if (nextData) {
        actionBtn.textContent = 'View ➡';
        actionBtn.onclick = () => openPopup(itemName, nextData, 'Chapter', itemPath, false);
    } else {
        actionBtn.textContent = currentMode === 'practice' ? 'Practice' : 'Select';
    }
    
    itemDiv.appendChild(actionBtn);
    popupList.appendChild(itemDiv);

    // Exam Mode Checkbox Logic
    if (currentMode === 'exam') {
        const cb = itemDiv.querySelector('input[type="checkbox"]');
        cb.checked = selectedCart.has(itemName);
        cb.onchange = (e) => {
            if (e.target.checked) selectedCart.add(itemName);
            else selectedCart.delete(itemName);
            document.getElementById('cart-count').textContent = `${selectedCart.size} Topics Selected`;
            document.getElementById('start-exam-btn').disabled = selectedCart.size === 0;
        };
    }
}


// Setup standard UI interactions
popupBack.onclick = () => {
    popupHistory.pop(); 
    const prev = popupHistory[popupHistory.length - 1]; 
    openPopup(prev.title, prev.dataObj, prev.level, prev.pathArr, true);
};
document.getElementById('popup-close').onclick = () => { popupHistory = []; popupOverlay.style.display = 'none'; };
popupOverlay.onclick = (e) => { if(e.target === popupOverlay) { popupHistory = []; popupOverlay.style.display = 'none'; } }

// Sidebar logic
function changeView(viewName, titleText) {
    // 1. Update the state
    currentView = viewName;
    
    // 2. Force the Header Title to update
    const viewTitle = document.getElementById('current-view-title');
    if (viewTitle) {
        viewTitle.textContent = titleText;
    }

    // 3. Force Sidebar Highlights to update
    document.querySelectorAll('.sidebar-links a').forEach(link => {
        link.classList.remove('active-link');
    });

    const activeLink = document.getElementById('nav-' + viewName);
    if (activeLink) {
        activeLink.classList.add('active-link');
    }

    // 4. Close Sidebar and Reset UI
    toggleSidebar(false);
    popupHistory = []; 
    popupOverlay.style.display = 'none';
    
    // 5. Redraw the grid with the new tree
    renderGrid();
}

// Init
switchMode('practice');
loadDataAndBuildTree();