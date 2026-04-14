import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
let userExamHistory = [];

// NEW: Global arrays to hold custom filtered data
let globalPracticeMistakes = [];
let globalExamMistakes = [];
let globalBookmarks = [];
let activeCustomPool = null; // Tells the app to "lock in" to mistakes/bookmarks

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
        if (unattemptedFilter.checked && attemptedQuestions.includes(getQID(q))) return false;
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
	const generatedTitle = generateExamTitle(paths, currentView);
    
	window.launchQuiz(examPool, 'exam', timerInput, generatedTitle);
});

// Clear custom pool when changing views
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

// IMPORTANT: Clear the custom pool if they close the popup!
popupClose.onclick = () => { popupHistory = []; popupOverlay.style.display = 'none'; activeCustomPool = null; };
popupOverlay.onclick = (e) => { if(e.target === popupOverlay) { popupHistory = []; popupOverlay.style.display = 'none'; activeCustomPool = null; } }

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
    activeCustomPool = null; // Reset custom modes
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

function generateExamTitle(paths, currentView) {
    if (!paths || paths.length === 0) return "Custom Exam";
    const topLevels = new Set();
    const subLevels = new Set();
    paths.forEach(p => {
        if (p[0]) topLevels.add(p[0]); 
        if (p[1]) subLevels.add(p[1]); 
    });
    const topArr = Array.from(topLevels);
    const subArr = Array.from(subLevels);

    if (currentView === 'exam') return topArr.join(" + "); 
    if (topArr.length === 1) {
        if (subArr.length > 3 || subArr.length === 0) return `${topArr[0]} (Full)`; 
        else return `${topArr[0]} - ${subArr.join(" + ")}`;
    } else {
        if (topArr.length <= 3) return topArr.join(" + "); 
        else return `Mixed Exam (${topArr.length} Topics)`; 
    }
}

function switchMode(mode) {
    currentMode = mode;
    selectedCart.clear();
    document.getElementById('cart-count').textContent = `0 Topics Selected`;
    document.getElementById('start-exam-btn').disabled = true;
    const searchBar = document.querySelector('.search-filter-bar');
    const modeDesc = document.getElementById('mode-description');
    if (mode === 'practice') {
        document.getElementById('mode-practice').className = "btn-solid active-mode";
        document.getElementById('mode-exam').className = "btn-outline";
        document.getElementById('exam-cart').style.display = "none";
        if (modeDesc) modeDesc.textContent = "Practice Mode: Instant feedback, detailed explanations, pause & resume anytime.";
        if (searchBar) searchBar.style.display = "flex"; 
    } else {
        document.getElementById('mode-exam').className = "btn-solid active-mode";
        document.getElementById('mode-practice').className = "btn-outline";
        document.getElementById('exam-cart').style.display = "flex";
        if (modeDesc) modeDesc.textContent = "Exam Mode: Strict timer, no instant feedback, and skipped questions appear at the end.";
        if (searchBar) searchBar.style.display = "none"; 
    }
    renderGrid(); 
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

        dataRows.forEach((row, rowIndex) => {
            if (row.length < 2) return; 
            let rowObj = {};
            headers.forEach((header, index) => {
                rowObj[header] = row[index] ? row[index].trim() : "";
            });

            if (!rowObj.Subject || rowObj.Subject === "") return;
            if (!rowObj.QuestionID && !rowObj['Question ID'] && !rowObj.ID && !rowObj.id) {
                rowObj.QuestionID = `q-${rowIndex + 1}`;
            }

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

// Helper to dynamically build sub-trees for Mistakes/Bookmarks
function buildSubTree(pool) {
    let tree = {};
    pool.forEach(q => {
        const Subject = q.Subject || "Uncategorized";
        const Chapter = q.Chapter || "";
        const Topic = q.Topic || "";

        if (currentView === 'subject') {
            if (!tree[Subject]) tree[Subject] = {};
            if (Chapter) {
                if (!tree[Subject][Chapter]) tree[Subject][Chapter] = [];
                if (Topic && !tree[Subject][Chapter].includes(Topic)) tree[Subject][Chapter].push(Topic);
            }
        } else if (currentView === 'system') {
            if (Chapter) {
                if (!tree[Chapter]) tree[Chapter] = {};
                if (!tree[Chapter][Subject]) tree[Chapter][Subject] = [];
                if (Topic && !tree[Chapter][Subject].includes(Topic)) tree[Chapter][Subject].push(Topic);
            }
        }
    });
    return tree;
}

// UPDATED: Now supports activeCustomPool and pseudo-roots for the Mistakes Popup!
function getQuestionCount(view, pathArr, customPool = null) {
    let pool = customPool || activeCustomPool || allQuestions;
    
    // Handle the pseudo-roots dynamically created for the mistakes popup
    let paths = [...pathArr];
    if (paths[0] === "Practice Mistakes") {
        pool = pool.filter(q => globalPracticeMistakes.includes(getQID(q)));
        paths.shift();
    } else if (paths[0] === "Exam Mistakes") {
        pool = pool.filter(q => globalExamMistakes.includes(getQID(q)));
        paths.shift();
    }

    if (paths.length === 0) return pool.filter(q => !unattemptedFilter.checked || !attemptedQuestions.includes(getQID(q))).length;

    return pool.filter(q => {
        if (unattemptedFilter.checked && attemptedQuestions.includes(getQID(q))) return false;

        if (view === 'subject') {
            if (paths[0] && q.Subject !== paths[0]) return false;
            if (paths[1] && q.Chapter !== paths[1]) return false;
            if (paths[2] && q.Topic !== paths[2]) return false;
        } else if (view === 'system') {
            if (paths[0] && q.Chapter !== paths[0]) return false;
            if (paths[1] && q.Subject !== paths[1]) return false;
            if (paths[2] && q.Topic !== paths[2]) return false;
        } else if (view === 'exam') {
            if (paths[0] && q.Exam !== paths[0]) return false;
            if (paths[1] && q.Subject !== paths[1]) return false;
            if (paths[2] && q.Topic !== paths[2]) return false;
        }
        return true;
    }).length;
}

function getQID(q) {
    return String(q['QuestionID'] || q['Question ID'] || q['ID'] || q['id']);
}

function getSolvedCount(view, pathArr) {
    const attemptedPool = allQuestions.filter(q => attemptedQuestions.includes(getQID(q)));
    return getQuestionCount(view, pathArr, attemptedPool);
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
        
        const doneCount = getSolvedCount(currentView, [cardTitle]);
        const percent = qCount > 0 ? Math.round((doneCount / qCount) * 100) : 0;
        
        const countHtml = currentMode === 'practice' ? `<span class="card-count">${doneCount} / ${qCount}</span>` : '';
        const progressHtml = currentMode === 'practice' ? `<div class="progress-container"><div class="progress-bar-fill" style="width: ${percent}%; background-color: #10b981;"></div></div>` : '';

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
            const pool = (activeCustomPool || allQuestions).filter(q => getQuestionCount(currentView, pathArr, [q]) > 0);
            
            // Name the session "Review Mistakes" if they are in the custom pool!
            let launchTitle = title;
            if (activeCustomPool && title !== "⭐ Bookmarks") launchTitle = "Review Mistakes";
            
            window.launchQuiz(pool, 'practice', 0, launchTitle);
        };
    }

    if (currentMode === 'exam') {
        const selectAllDiv = document.createElement('div');
        selectAllDiv.className = 'list-item';
        selectAllDiv.style.backgroundColor = 'rgba(59, 130, 246, 0.05)'; 
        selectAllDiv.style.border = '1px solid #3b82f6';
        
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
    const doneCount = getSolvedCount(currentView, itemPath);
    const percent = qCount > 0 ? Math.round((doneCount / qCount) * 100) : 0;

    const countHtml = currentMode === 'practice' ? `<span class="card-count">${doneCount} / ${qCount}</span>` : '';
    const progressHtml = currentMode === 'practice' ? `<div class="progress-container"><div class="progress-bar-fill" style="width: ${percent}%; background-color: #10b981;"></div></div>` : '';

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
                const pool = (activeCustomPool || allQuestions).filter(q => getQuestionCount(currentView, itemPath, [q]) > 0);
                
                let launchTitle = itemName;
                if (activeCustomPool && itemName !== "⭐ Bookmarks") launchTitle = "Review Mistakes";
                
                window.launchQuiz(pool, 'practice', 0, launchTitle);
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
window.launchQuiz = function(questionsArray, mode = 'practice', timerMinutes = 0, examName = "Practice Session") {
    if (!questionsArray || questionsArray.length === 0) {
        alert("No questions found for this selection!");
        return;
    }
    localStorage.setItem('edeetos_active_quiz', JSON.stringify(questionsArray));
    localStorage.setItem('edeetos_quiz_config', JSON.stringify({ mode: mode, timer: timerMinutes, examName: examName }));
    window.location.href = 'quiz.html';
};

// ==========================================
// 6. FIREBASE PROGRESS & DASHBOARD SYNC
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userRef = doc(db, "users", user.uid);
        try {
            const docSnap = await getDoc(userRef);
            if (docSnap.exists()) {
                const dbData = docSnap.data();
                
                const solvedList = (dbData.solvedQuestions || []).map(id => String(id));
                
                // Get mistakes safely
                globalPracticeMistakes = (dbData.mistakes || []).map(id => String(id));
                globalExamMistakes = (dbData.examMistakes || []).map(id => String(id));
                globalBookmarks = (dbData.bookmarks || []).map(id => String(id));
                
                userExamHistory = dbData.examHistory || []; 
                attemptedQuestions = solvedList; 
                renderGrid(); 

                const allMistakes = [...new Set([...globalPracticeMistakes, ...globalExamMistakes])];
                const totalAttempts = solvedList.length + allMistakes.length;
                let accuracy = totalAttempts > 0 ? Math.round((solvedList.length / totalAttempts) * 100) : 0;

                if(document.getElementById('stat-solved')) document.getElementById('stat-solved').textContent = solvedList.length;
                if(document.getElementById('stat-mistakes')) document.getElementById('stat-mistakes').textContent = allMistakes.length;
                if(document.getElementById('stat-bookmarks')) document.getElementById('stat-bookmarks').textContent = globalBookmarks.length;
                if(document.getElementById('stat-accuracy')) document.getElementById('stat-accuracy').textContent = `${accuracy}%`;

                // Handle Categorized Mistakes Menu
                const btnMistakes = document.getElementById('btn-practice-mistakes');
                if (btnMistakes && allMistakes.length > 0) {
                    btnMistakes.disabled = false;
                    btnMistakes.style.cursor = "pointer";
                    btnMistakes.onclick = () => {
                        const pPool = allQuestions.filter(q => globalPracticeMistakes.includes(getQID(q)));
                        const ePool = allQuestions.filter(q => globalExamMistakes.includes(getQID(q)));

                        let combinedTree = {};
                        if (pPool.length > 0) combinedTree["Practice Mistakes"] = buildSubTree(pPool);
                        if (ePool.length > 0) combinedTree["Exam Mistakes"] = buildSubTree(ePool);

                        activeCustomPool = [...pPool, ...ePool]; 
                        openPopup("⚠️ Review Mistakes", combinedTree, 'Level1', []);
                    };
                }

                // Handle Categorized Bookmarks Menu
                const btnBookmarks = document.getElementById('btn-review-bookmarks');
                if (btnBookmarks && globalBookmarks.length > 0) {
                    btnBookmarks.disabled = false;
                    btnBookmarks.style.cursor = "pointer";
                    btnBookmarks.onclick = () => {
                        const bPool = allQuestions.filter(q => globalBookmarks.includes(getQID(q)));
                        activeCustomPool = bPool;
                        openPopup("⭐ Bookmarks", buildSubTree(bPool), 'Level1', []);
                    };
                }
            }
        } catch (error) { console.error("Error fetching stats:", error); }
    }
});

// Analytics Modal
const btnAnalytics = document.getElementById('btn-view-analytics');
if (btnAnalytics) {
    btnAnalytics.onclick = () => {
        const body = document.getElementById('analytics-body');
        let html = `<h4 style="color:#064e3b; border-bottom:2px solid #e2e8f0; padding-bottom:5px;">Subject Stats</h4>`;
        
        Object.keys(subjectTree).forEach(sub => {
            const total = getQuestionCount('subject', [sub], allQuestions); // Force allQuestions for accuracy graph
            const solved = getSolvedCount('subject', [sub]);
            if (total === 0) return;
            const pct = Math.round((solved / total) * 100);
            html += `<div style="margin: 10px 0;">
                        <div style="display:flex; justify-content:space-between; font-size:0.85rem;">
                            <span>${sub}</span><span>${pct}% (${solved}/${total})</span>
                        </div>
                        <div style="background:#e2e8f0; height:6px; border-radius:3px; overflow:hidden; margin-top:4px;">
                            <div style="width:${pct}%; background:#10b981; height:100%;"></div>
                        </div>
                     </div>`;
        });

        html += `<h4 style="color:#064e3b; border-bottom:2px solid #e2e8f0; padding-bottom:5px; margin-top:20px;">Recent Exams</h4>`;
        if (userExamHistory.length === 0) {
            html += `<p style="font-size:0.8rem; color:#64748b; text-align:center;">No exams taken yet.</p>`;
        } else {
            html += `<div style="font-size:0.8rem; max-height:200px; overflow-y:auto;">
                        <table style="width:100%; text-align:left;">
                            <tr style="color:#64748b;"><th>Date</th><th>Subject</th><th>Score</th></tr>`;
            userExamHistory.reverse().forEach(ex => {
                html += `<tr style="border-top:1px solid #f1f5f9;">
                            <td style="padding:5px 0;">${new Date(ex.date).toLocaleDateString()}</td>
                            <td>${ex.examName}</td>
                            <td style="color:${ex.percentage >= 75 ? '#10b981' : '#ef4444'}; font-weight:bold;">${ex.percentage}%</td>
                         </tr>`;
            });
            html += `</table></div>`;
        }

        body.innerHTML = html;
        document.getElementById('analytics-modal').style.display = 'flex';
    };
}

const closeAnalytics = document.getElementById('close-analytics');
if (closeAnalytics) closeAnalytics.onclick = () => document.getElementById('analytics-modal').style.display = 'none';

switchMode('practice');
loadDataAndBuildTree();