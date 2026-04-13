// ==========================================
// 1. STATE VARIABLES
// ==========================================
let subjectTree = {}; 
let systemTree = {};
let examTree = {};
let allQuestions = []; 
let currentView = "subject"; 
let currentMode = "practice"; 
let selectedCart = new Set(); 
let popupHistory = []; 
let attemptedQuestions = []; 

// ==========================================
// 2. DOM ELEMENTS
// ==========================================
const subjectsGrid = document.getElementById('subjects-grid');
const popupOverlay = document.getElementById('popup-overlay');
const popupTitle = document.getElementById('popup-title');
const popupList = document.getElementById('popup-list');
const popupBack = document.getElementById('popup-back');
const popupClose = document.getElementById('popup-close');
const globalSearch = document.getElementById('global-search');
const searchDropdown = document.getElementById('search-dropdown');
const unattemptedFilter = document.getElementById('unattempted-filter');
const sidebarEl = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const viewTitle = document.getElementById('current-view-title');

// ==========================================
// 3. EVENT LISTENERS
// ==========================================
globalSearch.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    if (query.length < 2) { 
        searchDropdown.style.display = 'none';
        return;
    }
    const matchedQuestions = allQuestions.filter(q => {
        if (unattemptedFilter.checked && attemptedQuestions.includes(q.QuestionID)) return false;
        const textToSearch = `${q.Subject} ${q.Chapter} ${q.Topic} ${q.Question || ''}`.toLowerCase();
        return textToSearch.includes(query);
    });

    searchDropdown.innerHTML = '';
    if (matchedQuestions.length === 0) {
        searchDropdown.innerHTML = `<div class="search-item" style="color:#64748b;">No matches found for "${query}"</div>`;
    } else {
        matchedQuestions.slice(0, 30).forEach(q => { 
            const div = document.createElement('div');
            div.className = 'search-item';
            const title = `${q.Subject} > ${q.Chapter || ''} ${q.Topic ? '> ' + q.Topic : ''}`;
            const questionSnippet = q.Question ? q.Question.substring(0, 90) + "..." : "No text";

            div.innerHTML = `
                <div class="search-item-title" style="font-weight:bold; color:#064e3b; margin-bottom:5px;">${title}</div>
                <div class="search-item-snippet" style="font-size:0.9rem; color:#475569;">${questionSnippet}</div>
            `;
            div.onclick = () => {
                searchDropdown.style.display = 'none';
                globalSearch.value = '';
                window.launchQuiz([q], 'practice', 0); 
            };
            searchDropdown.appendChild(div);
        });
    }
    searchDropdown.style.display = 'block';
});

document.addEventListener('click', (e) => {
    if (!globalSearch.contains(e.target) && !searchDropdown.contains(e.target)) {
        searchDropdown.style.display = 'none';
    }
});

unattemptedFilter.addEventListener('change', renderGrid);
document.getElementById('mode-practice').addEventListener('click', () => switchMode('practice'));
document.getElementById('mode-exam').addEventListener('click', () => switchMode('exam'));

document.getElementById('start-exam-btn').addEventListener('click', () => {
    const paths = Array.from(selectedCart).map(str => JSON.parse(str));
    let examPool = allQuestions.filter(q => {
        return paths.some(pathArr => getQuestionCount(currentView, pathArr, [q]) > 0);
    });

    const qCountInput = parseInt(document.getElementById('exam-q-count').value);
    const timerInput = parseInt(document.getElementById('exam-timer').value);

    if (!timerInput || timerInput <= 0 || isNaN(timerInput)) {
        alert("Please enter a valid time in minutes.");
        return;
    }

    if (qCountInput && qCountInput > 0 && qCountInput < examPool.length) {
        examPool = examPool.sort(() => 0.5 - Math.random()).slice(0, qCountInput);
    } else {
        examPool = examPool.sort(() => 0.5 - Math.random());
    }

    window.launchQuiz(examPool, 'exam', timerInput);
});

document.getElementById('nav-subject').onclick = () => changeView('subject', 'Subject Wise');
document.getElementById('nav-system').onclick = () => changeView('system', 'System Wise');
document.getElementById('nav-exam').onclick = () => changeView('exam', 'Past Papers');
document.getElementById('open-sidebar').onclick = () => toggleSidebar(true);
document.getElementById('close-sidebar').onclick = () => toggleSidebar(false);
sidebarOverlay.onclick = () => toggleSidebar(false);

popupBack.onclick = () => {
    popupHistory.pop(); 
    const prev = popupHistory[popupHistory.length - 1]; 
    openPopup(prev.title, prev.dataObj, prev.level, prev.pathArr, true);
};
popupClose.onclick = () => { popupHistory = []; popupOverlay.style.display = 'none'; };
popupOverlay.onclick = (e) => { if(e.target === popupOverlay) { popupHistory = []; popupOverlay.style.display = 'none'; } }

// ==========================================
// 4. CORE FUNCTIONS
// ==========================================
function toggleSidebar(show) {
    if (show) {
        sidebarEl.classList.add('active');
        sidebarOverlay.style.display = 'block';
    } else {
        sidebarEl.classList.remove('active');
        sidebarOverlay.style.display = 'none';
    }
}

function changeView(viewName, titleText) {
    currentView = viewName;
    if (viewTitle) viewTitle.textContent = titleText;

    document.querySelectorAll('.sidebar-links a').forEach(link => {
        link.classList.remove('active-link');
    });
    const activeLink = document.getElementById('nav-' + viewName);
    if (activeLink) activeLink.classList.add('active-link');

    toggleSidebar(false);
    popupHistory = []; 
    popupOverlay.style.display = 'none';
    globalSearch.value = ""; 
    searchDropdown.style.display = 'none';
    
    renderGrid();
}

function switchMode(mode) {
    currentMode = mode;
    selectedCart.clear();
    document.getElementById('cart-count').textContent = `0 Topics Selected`;
    document.getElementById('start-exam-btn').disabled = true;

    const searchBar = document.querySelector('.search-filter-bar');

    if (mode === 'practice') {
        document.getElementById('mode-practice').className = "btn-solid active-mode";
        document.getElementById('mode-exam').className = "btn-outline";
        document.getElementById('exam-cart').style.display = "none";
        if (searchBar) searchBar.style.display = "flex"; // Show search and filters
    } else {
        document.getElementById('mode-exam').className = "btn-solid active-mode";
        document.getElementById('mode-practice').className = "btn-outline";
        document.getElementById('exam-cart').style.display = "flex";
        if (searchBar) searchBar.style.display = "none"; // Hide search and filters in Exam Mode
    }
    
    renderGrid(); // Re-render grid to apply/remove progress bars
}

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

            if (!rowObj.Subject || rowObj.Subject === "") return;
            allQuestions.push(rowObj); 
           
            const Exam = rowObj.Exam;
            const Subject = rowObj.Subject;
            const Chapter = rowObj.Chapter;
            const Topic = rowObj.Topic;
           
            if (!subjectTree[Subject]) subjectTree[Subject] = {};
            if (!subjectTree[Subject][Chapter]) subjectTree[Subject][Chapter] = [];
            if (Topic && !subjectTree[Subject][Chapter].includes(Topic)) subjectTree[Subject][Chapter].push(Topic);

            if (Chapter) {
                if (!systemTree[Chapter]) systemTree[Chapter] = {};
                if (!systemTree[Chapter][Subject]) systemTree[Chapter][Subject] = [];
                if (Topic && !systemTree[Chapter][Subject].includes(Topic)) systemTree[Chapter][Subject].push(Topic);
            }

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

function getQuestionCount(view, pathArr, customPool = null) {
    const pool = customPool || allQuestions;
    return pool.filter(q => {
        if (unattemptedFilter.checked && attemptedQuestions.includes(q.QuestionID)) return false;

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

function renderGrid() {
    if (!subjectsGrid) return;
    subjectsGrid.innerHTML = '';
    
    let activeTree = {};
    if (currentView === 'subject') activeTree = subjectTree;
    if (currentView === 'system') activeTree = systemTree;
    if (currentView === 'exam') activeTree = examTree;
    
    Object.keys(activeTree).forEach(cardTitle => {
        const qCount = getQuestionCount(currentView, [cardTitle]);
        if (unattemptedFilter.checked && qCount === 0) return;
        let doneDummy = 0; 
        
        // Hide counters and progress bar in Exam Mode
        const countHtml = currentMode === 'practice' ? `<span class="card-count">${doneDummy} / ${qCount}</span>` : '';
        const progressHtml = currentMode === 'practice' ? `<div class="progress-container"><div class="progress-bar-fill" style="width: 0%;"></div></div>` : '';

        const card = document.createElement('div');
        card.className = 'glass-panel feature-card';
        card.style.cursor = 'pointer';
        card.innerHTML = `
            <div class="card-header-flex">
                <h3 class="card-title">${cardTitle}</h3>
                ${countHtml}
            </div>
            ${progressHtml}
        `;
        card.onclick = () => openPopup(cardTitle, activeTree[cardTitle], 'Level1', [cardTitle], false);
        subjectsGrid.appendChild(card);
    });
}

function openPopup(title, dataObj, level, pathArr, isBackNav = false) {
    if (!isBackNav) popupHistory.push({ title, dataObj, level, pathArr });

    popupTitle.textContent = title;
    popupList.innerHTML = '';
    popupOverlay.style.display = 'flex';
    popupBack.style.display = popupHistory.length > 1 ? 'inline-block' : 'none';

    if (currentMode === 'practice') {
        const fullCount = getQuestionCount(currentView, pathArr);
        const practiceAllDiv = document.createElement('div');
        practiceAllDiv.className = 'list-item';
        practiceAllDiv.style.backgroundColor = 'rgba(16, 185, 129, 0.1)'; 
        practiceAllDiv.style.border = '1px solid #10b981';
        
        practiceAllDiv.innerHTML = `
            <div style="flex-grow: 1;">
                <div class="card-header-flex">
                    <span style="font-weight: bold; color: #064e3b;">Practice Full ${title}</span>
                    <span class="card-count" style="color: #059669;">0 / ${fullCount}</span>
                </div>
            </div>
            <button class="btn-solid mini-btn practice-full-btn" style="margin-left: 15px;">Start ➡</button>
        `;
        popupList.appendChild(practiceAllDiv);
        practiceAllDiv.querySelector('.practice-full-btn').onclick = () => {
            const pool = allQuestions.filter(q => getQuestionCount(currentView, pathArr, [q]) > 0);
            window.launchQuiz(pool, 'practice', 0);
        };
    }

    if (currentMode === 'exam') {
        const selectAllDiv = document.createElement('div');
        selectAllDiv.className = 'list-item';
        selectAllDiv.style.backgroundColor = 'rgba(59, 130, 246, 0.05)'; 
        selectAllDiv.style.border = '1px solid #3b82f6';
        
        // Removed the counter for Exam Mode
        selectAllDiv.innerHTML = `
            <div style="flex-grow: 1;">
                <div class="card-header-flex">
                    <span style="font-weight: bold; color: #1e3a8a;">Select Full ${title}</span>
                </div>
            </div>
            <button class="btn-solid mini-btn select-all-btn" style="margin-left: 15px; background: #3b82f6; border: none;">Select All</button>
        `;
        popupList.appendChild(selectAllDiv);
        
        selectAllDiv.querySelector('.select-all-btn').onclick = () => {
            const allCbs = popupList.querySelectorAll('input[type="checkbox"]');
            let allAreChecked = true;
            allCbs.forEach(cb => { if (!cb.checked) allAreChecked = false; });
            
            allCbs.forEach(cb => {
                cb.checked = !allAreChecked; 
                cb.dispatchEvent(new Event('change'));
            });
            selectAllDiv.querySelector('.select-all-btn').textContent = allAreChecked ? 'Select All' : 'Deselect All';
        };
    }

    if (Array.isArray(dataObj)) {
        dataObj.forEach(topic => renderListItem(topic, null, 'Topic', [...pathArr, topic]));
    } else {
        Object.keys(dataObj).forEach(key => renderListItem(key, dataObj[key], level, [...pathArr, key]));
    }
}

function getLeafPaths(dataObj, currentPath) {
    if (!dataObj) return [];
    if (Array.isArray(dataObj)) {
        return dataObj.map(topic => JSON.stringify([...currentPath, topic]));
    }
    let leaves = [];
    Object.keys(dataObj).forEach(key => {
        leaves = leaves.concat(getLeafPaths(dataObj[key], [...currentPath, key]));
    });
    return leaves;
}

function renderListItem(itemName, nextData, level, itemPath) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'list-item';
    const labelDiv = document.createElement('div');
    labelDiv.style.flexGrow = '1';
    
    const qCount = getQuestionCount(currentView, itemPath);
    let doneDummy = 0; 

    // Hide counters and progress bar in Exam Mode
    const countHtml = currentMode === 'practice' ? `<span class="card-count">${doneDummy} / ${qCount}</span>` : '';
    const progressHtml = currentMode === 'practice' ? `<div class="progress-container"><div class="progress-bar-fill" style="width: 0%;"></div></div>` : '';

    labelDiv.innerHTML = `
        <div class="card-header-flex">
            <span style="font-weight: 600; display: flex; align-items: center;">
                ${currentMode === 'exam' ? `<input type="checkbox" style="margin-right: 10px;">` : ''}
                ${itemName}
            </span>
            ${countHtml}
        </div>
        ${progressHtml}
    `;

    itemDiv.appendChild(labelDiv);

    const actionBtn = document.createElement('button');
    actionBtn.className = 'btn-outline mini-btn';
    actionBtn.style.marginLeft = '15px';
    
    if (nextData) {
        actionBtn.textContent = 'View ➡';
        actionBtn.onclick = () => openPopup(itemName, nextData, 'Chapter', itemPath, false);
    } else {
        if (currentMode === 'practice') {
            actionBtn.textContent = 'Practice';
            actionBtn.onclick = () => {
                const pool = allQuestions.filter(q => getQuestionCount(currentView, itemPath, [q]) > 0);
                window.launchQuiz(pool, 'practice', 0);
            };
        } else {
            actionBtn.textContent = 'Select';
            actionBtn.onclick = () => {
                const cb = itemDiv.querySelector('input[type="checkbox"]');
                cb.checked = !cb.checked;
                cb.dispatchEvent(new Event('change'));
            };
        }
    }
    
    itemDiv.appendChild(actionBtn);
    popupList.appendChild(itemDiv);

    if (currentMode === 'exam') {
        const cb = itemDiv.querySelector('input[type="checkbox"]');
        const leafPaths = nextData ? getLeafPaths(nextData, itemPath) : [JSON.stringify(itemPath)];
        
        cb.checked = leafPaths.length > 0 && leafPaths.every(path => selectedCart.has(path));
        
        cb.onchange = (e) => {
            if (e.target.checked) leafPaths.forEach(path => selectedCart.add(path));
            else leafPaths.forEach(path => selectedCart.delete(path));
            
            document.getElementById('cart-count').textContent = `${selectedCart.size} Topics Selected`;
            document.getElementById('start-exam-btn').disabled = selectedCart.size === 0;
        };
    }
}

// ==========================================
// 5. THE BRIDGE: LAUNCH QUIZ
// ==========================================
window.launchQuiz = function(questionsArray, mode = 'practice', timerMinutes = 0) {
    if (!questionsArray || questionsArray.length === 0) {
        alert("No questions found for this selection!");
        return;
    }
    localStorage.setItem('edeetos_active_quiz', JSON.stringify(questionsArray));
    localStorage.setItem('edeetos_quiz_config', JSON.stringify({ mode: mode, timer: timerMinutes }));
    
    window.location.href = 'quiz.html';
};

switchMode('practice');
loadDataAndBuildTree();