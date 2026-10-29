/*
----------------------------------------------------
1.	Configurations & Global State (Variables, Cache, Settings)
2.	DOM Elements (Centralized element selections)
3.	Utility Functions (Sanitization, Parsers, ID extractors)
4.	Navigation & Sidebar (View switching, UI updates)
5.	Core UI Rendering (Grid layouts, Books rendering)
6.	Search Engine (Global metadata filtering)
7.	Data Loading & Hierarchy (Chunks fetcher, IndexDB caching)
8.	Popup & Cart Logic (Modal rendering, selections)
9.	Exam Launch & Modes (Practice/Exam switching, timers, Mock UI)
10.	Analytics Engine (Smart stats, charts, recent exams)
11.	Revisions & Spaced Repetition (Day-interval algorithms)
12.	Progress Reset System (Data wiping logic)
13.	Trophies & Milestones (Gamification, rewards)
14.	Multiplayer & Study Rooms (Real-time challenge sync)
15.	Mentor & Admin Actions (Assigning exams, GitHub CSV push)
16.	Initialization & Auth (Firebase state listener, bootstrap)
------------------------------------------------------
*/
	
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, addDoc, collection, serverTimestamp, getDocs, deleteField } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { createDbWorker } from "https://cdn.jsdelivr.net/npm/sql.js-httpvfs@8.4.0/+esm";
// ==========================================
// 1. STATE VARIABLES & CONFIGURATION
// ==========================================
let subjectTree = {};
let systemTree = {};
let examTree = {};
let allQuestions = []; 
let globalMetadata = []; 
let currentView = "subject";
let currentMode = "practice";
let selectedCart = new Set();
let popupHistory = [];
let attemptedQuestions = [];
let userExamHistory = [];

let globalPracticeMistakes = [];
let globalExamMistakes = [];
let globalBookmarks = [];
let globalBookmarkFolders = {};
let globalSkipped = [];
let activeCustomPool = null;
let isPremiumUser = false;
let currentUserRole = "STUDENT";
let currentUserData = null; 
let isGlobalPopupActive = false;
let viewSpecificStats = {
    course: { solved: [], mistakes: [], bookmarks: [], skipped: [], accuracy: 0 },
    book: { solved: [], mistakes: [], bookmarks: [], skipped: [], accuracy: 0 }
};

const loadedBooksCache = {}; 
window.activeChunksCache = {};
let searchTimeout;
let cachedAttemptedPool = null;
let cachedMistakesPool = null;

const savedCourse = localStorage.getItem('edeetos_active_course');
if (!savedCourse) {
    window.location.href = 'dashboard.html';
}
const activeCourse = savedCourse;

const allBooks = [
    { file: "brs_patho", title: "BRS - Pathology" },
    { file: "brs_physio", title: "BRS - Physiology" },
    { file: "doubleAA", title: "Double AA" },
    { file: "firstaid_step1", title: "First Aid Step 1" },
    { file: "firstaid_step2", title: "First Aid Step 2" },
    { file: "im_medicine", title: "Irfan Masood - Medicine" },
    { file: "im_pathology", title: "Irfan Masood - Pathology" },
    { file: "im_pediatrics", title: "Irfan Masood - Pediatrics" },
    { file: "im_surgery", title: "Irfan Masood - Surgery" },
    { file: "pretest_surgery", title: "Pretest Surgery" },
    { file: "rafiullah", title: "Rafiullah FCPS" },
    { file: "RWR", title: "Residents Way to Residency" }
];

const availableBooks = allBooks.filter(book => {
    if (book.file === "rafiullah") {
        return activeCourse && activeCourse.startsWith("fcps_part1"); 
    }    
    return true; 
});

const idbCache = {
    async init() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open("EdeetosCacheDB", 1);
            req.onupgradeneeded = (e) => e.target.result.createObjectStore("user_profiles");
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    async set(uid, data) {
        try {
            const db = await this.init();
            const tx = db.transaction("user_profiles", "readwrite");
            tx.objectStore("user_profiles").put(data, uid);
        } catch(e) { console.warn("Cache write failed", e); }
    },
    async get(uid) {
        try {
            const db = await this.init();
            return new Promise((resolve) => {
                const tx = db.transaction("user_profiles", "readonly");
                const req = tx.objectStore("user_profiles").get(uid);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
            });
        } catch(e) { return null; }
    }
};

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
const examQInput = document.getElementById('exam-q-count');
const examTimerInput = document.getElementById('exam-timer');
const startExamBtn = document.getElementById('start-exam-btn');
const diffEasyFilter = document.getElementById('diff-easy-filter');
const diffMediumFilter = document.getElementById('diff-medium-filter');
const diffHardFilter = document.getElementById('diff-hard-filter');
const btnPushEdits = document.getElementById('btn-push-edits');
const pendingEditsCount = document.getElementById('pending-edits-count');
const darkModeBtn = document.getElementById('dark-mode-toggle');

if (darkModeBtn) {
    const isInitiallyDark = document.documentElement.classList.contains('dark-mode');
    darkModeBtn.innerHTML = isInitiallyDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';

    darkModeBtn.addEventListener('click', () => {
        document.documentElement.classList.toggle('dark-mode');
        const isDark = document.documentElement.classList.contains('dark-mode');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
        darkModeBtn.innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
    });
}

// ==========================================
// 3. UTILITY FUNCTIONS (Sanitization & Parsers)
// ==========================================
function sanitizeFilename(name) {
    if (!name) return "unknown";
    return String(name)
        .toLowerCase()
        .trim()
        .replace(/[\\/*?:"<>|\s]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function parseExamInfo(examStr, fallbackYear, fallbackSpec) {
    const parts = String(examStr).split("-").map(p => p.trim());
    let examYear = fallbackYear;
    let examSpec = fallbackSpec;
    
    if (parts.length >= 2) {
        const prefix = parts[0].toLowerCase();
        if (prefix.includes("surgery")) examSpec = "Surgery & Allied";
        else if (prefix.includes("medicine")) examSpec = "Medicine & Allied";
        else if (prefix.includes("gynecology") || prefix.includes("gyn")) examSpec = "Gynecology & Obstetrics";
        else if (prefix.includes("anesthesia")) examSpec = "Anesthesia";
        else if (prefix.includes("radiology")) examSpec = "Radiology";
        else if (prefix.includes("pathology")) examSpec = "Pathology";
        else examSpec = parts[0];

        const datePart = parts[1];
        if (datePart && datePart.includes("/")) {
            const yy = datePart.split("/").pop().trim();
            if (yy.length === 2) examYear = "20" + yy;
            else if (yy.length === 4) examYear = yy;
        }
    }
    return { examYear, examSpec };
}

function getTreeCount(obj) {
    if (typeof obj === 'number') return obj;
    if (!obj || typeof obj !== 'object') return 0;
    let sum = 0;
    for (let k in obj) sum += getTreeCount(obj[k]);
    return sum;
}

function buildSubTree(pool) {
    let tree = {};
    pool.forEach(q => {
        let s = q.Subject || q.subject || 'Uncategorized';
        let c = q.Chapter || q.chapter || 'General';
        let t = q.Topic || q.topic || 'General';
        
        if (!tree[s]) tree[s] = {};
        if (!tree[s][c]) tree[s][c] = {};
        tree[s][c][t] = (tree[s][c][t] || 0) + 1;
    });
    return tree;
}

function getQID(q) {
    return String(q['QuestionID'] || q['Question ID'] || q['ID'] || q['id']);
}

// ==========================================
// 4. NAVIGATION & SIDEBAR
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

if (document.getElementById('nav-subject')) document.getElementById('nav-subject').onclick = () => changeView('subject', 'Subject Wise');
if (document.getElementById('nav-system')) document.getElementById('nav-system').onclick = () => changeView('system', 'System Wise');
if (document.getElementById('nav-exam')) document.getElementById('nav-exam').onclick = () => changeView('exam', 'Past Papers');
if (document.getElementById('nav-book')) document.getElementById('nav-book').onclick = () => changeView('book', 'Books Library');
if (document.getElementById('open-sidebar')) document.getElementById('open-sidebar').onclick = () => toggleSidebar(true);
if (document.getElementById('close-sidebar')) document.getElementById('close-sidebar').onclick = () => toggleSidebar(false);
if (sidebarOverlay) sidebarOverlay.onclick = () => toggleSidebar(false);

window.updateDashboardUI = function() {
    const type = currentView === 'book' ? 'book' : 'course';
    const stats = viewSpecificStats[type];

	if (document.getElementById('stat-solved')) document.getElementById('stat-solved').textContent = stats.solved.length;
    if (document.getElementById('stat-mistakes')) document.getElementById('stat-mistakes').textContent = stats.mistakes.length;
    if (document.getElementById('stat-bookmarks')) document.getElementById('stat-bookmarks').textContent = stats.bookmarks.length;
    if (document.getElementById('stat-skipped')) document.getElementById('stat-skipped').textContent = stats.skipped.length;
    if (document.getElementById('stat-accuracy')) document.getElementById('stat-accuracy').textContent = `${stats.accuracy}%`;
};

function changeView(viewName, titleText) {
    currentView = viewName;
	cachedAttemptedPool = null;
    cachedMistakesPool = null;
    activeCustomPool = null;
    isGlobalPopupActive = false;
    localStorage.setItem('edeetos_last_view', viewName);
    localStorage.setItem('edeetos_last_title', titleText);

    if (viewTitle) viewTitle.textContent = titleText;

    document.querySelectorAll('.sidebar-links a').forEach(link => {
        link.classList.remove('active-link');
    });
    const activeLink = document.getElementById('nav-' + viewName);
    if (activeLink) activeLink.classList.add('active-link');

    toggleSidebar(false);
    popupHistory = [];
    if (popupOverlay) popupOverlay.style.display = 'none';
    if (globalSearch) globalSearch.value = "";
    if (searchDropdown) searchDropdown.style.display = 'none';

    if (viewName === 'book') {
        renderBooksGrid();    
    } else {
        renderGrid();
    }
    if (typeof updateDashboardUI === 'function') updateDashboardUI();
    initMentorFeatures();
}

function restoreLastState() {
    switchMode('practice');
    const lastView = localStorage.getItem('edeetos_last_view') || 'subject';
    const lastTitle = localStorage.getItem('edeetos_last_title') || 'Subject Wise';
    
    changeView(lastView, lastTitle);

    if (lastView === 'book') return; 

    const savedPathStr = localStorage.getItem('edeetos_saved_popup_path');
    const savedTitle = localStorage.getItem('edeetos_saved_popup_title');

    if (savedPathStr && savedTitle) {
        try {
            const pathArr = JSON.parse(savedPathStr);
            if (pathArr.length === 0) return;

            let currentTree = {};
            if (lastView === 'subject') currentTree = subjectTree;
            else if (lastView === 'system') currentTree = systemTree;
            else if (lastView === 'exam') currentTree = examTree;

            let dataObj = currentTree;
            let isValid = true;
            
            for (let i = 0; i < pathArr.length; i++) {
                if (dataObj[pathArr[i]]) {
                    dataObj = dataObj[pathArr[i]];
                } else {
                    isValid = false;
                    break;
                }
            }

            if (isValid) {
                openPopup(savedTitle, dataObj, 'Restored', pathArr, false);
            }
        } catch (e) {
            console.error("Failed to restore popup state", e);
        }
    }
}

// ==========================================
// 5. CORE VIEWS & GRID RENDERING
// ==========================================
function renderGrid() {
    if (!subjectsGrid) return;
    subjectsGrid.innerHTML = '';

    let activeTree = {};
    if (currentView === 'subject') activeTree = subjectTree;
    if (currentView === 'system') activeTree = systemTree;
    if (currentView === 'exam') activeTree = examTree;

    Object.keys(activeTree).forEach(cardTitle => {
        const qCount = getQuestionCount(currentView, [cardTitle]);
        
        if (currentMode !== 'exam' && unattemptedFilter && unattemptedFilter.checked && qCount === 0) return;
        if (qCount === 0) return;

// We killed the massive global metadata payload to save RAM.
        // Therefore, exact progress stats will only render inside the popup AFTER a user clicks and loads the specific topic.
        const countHtml = `<span class="card-count">${qCount} Qs</span>`;
        const progressHtml = ``;

        let cardStatsHtml = '';
        if (currentView === 'exam') {
            cardStatsHtml = `<div style="font-size: 0.75rem; margin-top: 10px; color: #94a3b8; font-weight: 600;"><i class="fas fa-chart-bar" style="margin-right: 5px;"></i> Click to load exam statistics</div>`;
        }

        const card = document.createElement('div');
        card.className = 'glass-panel feature-card';
        card.style.cursor = 'pointer';
        card.innerHTML = `
            <div class="card-header-flex">
                <h3 class="card-title">${cardTitle}</h3>${countHtml}
            </div>
            ${cardStatsHtml}${progressHtml}
        `;
card.onclick = async () => {
            if (currentView !== 'book') {
                document.body.style.cursor = 'wait';
                try {
                    const chunks = await fetchRequiredChunks(currentView, [[cardTitle]]);
                    const uniqueIds = new Set();
                    const deduplicated = [];
                    chunks.forEach(q => {
                        const qId = String(q.id || q.QuestionID);
                        if (!uniqueIds.has(qId)) {
                            uniqueIds.add(qId);
                            deduplicated.push(q);
                        }
                    });
                    activeCustomPool = deduplicated;
                } catch(e) { console.error("Error loading chunks for popup:", e); }
                document.body.style.cursor = 'default';
            }
            openPopup(cardTitle, activeTree[cardTitle], 'Level1', [cardTitle], false);
        };
        subjectsGrid.appendChild(card);
    });
}

function checkPremiumAccess(itemKey) {
    if (currentUserRole === 'ADMIN' || currentUserRole === 'MANAGEMENT') return true;
    if (!currentUserData || !currentUserData.subscriptions) return false;
    
    const expiry = currentUserData.subscriptions[itemKey] || currentUserData.subscriptions['ALL'];
    if (!expiry) return false;
    if (expiry === 'lifetime') return true;
    return new Date(expiry) > new Date();
}

function renderBooksGrid() {
    if (!subjectsGrid) return;
    subjectsGrid.innerHTML = '';

    availableBooks.forEach(book => {
        const isUnlocked = checkPremiumAccess(book.file);
        
        const card = document.createElement('div');
        card.className = 'glass-panel feature-card';
        card.style.cursor = isUnlocked ? 'pointer' : 'not-allowed';
        card.style.opacity = isUnlocked ? '1' : '0.6';
        
        card.innerHTML = `
            <div class="card-header-flex" style="border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px; margin-bottom: 10px;">
                <h3 class="card-title" style="color: #93c5fd;">${book.title}</h3>${isUnlocked ? '<i class="fas fa-book-open" style="color: #34d399; font-size: 1.2rem;"></i>' : '<i class="fas fa-lock" style="color: #fca5a5; font-size: 1.2rem;"></i>'}
            </div>
            <div style="font-size: 0.8rem; font-weight: bold; color: ${isUnlocked ? '#6ee7b7' : '#f87171'};">
                ${isUnlocked ? '✅ Access Granted' : '🔒 Premium Subscription Required'}
            </div>
        `;
        
        card.onclick = () => {
            if (isUnlocked) {
                loadAndOpenBook(book);
            } else {
                alert(`You do not have premium access to ${book.title}. Please visit the Dashboard to unlock it.`);
            }
        };
        
        subjectsGrid.appendChild(card);
    });
}

// ==========================================
// 6. GLOBAL SEARCH SYSTEM (SQLITE HTTP-VFS)
// ==========================================
if (globalSearch && searchDropdown) {
    let sqlWorker = null;
    let isSearchEngineLoading = false;
    
    globalSearch.addEventListener('focus', async () => {
        if (!sqlWorker && !isSearchEngineLoading && currentView !== 'book') {
            isSearchEngineLoading = true;
            globalSearch.placeholder = "Booting Search Engine...";
            try {
                const workerUrl = "https://cdn.jsdelivr.net/npm/sql.js-httpvfs@8.4.0/dist/sqlite.worker.js";
                const wasmUrl = "https://cdn.jsdelivr.net/npm/sql.js-httpvfs@8.4.0/dist/sql-wasm.wasm";
                
                sqlWorker = await createDbWorker(
                    [{
                        from: "inline",
                        config: {
                            serverMode: "full",
                            url: `Data/${activeCourse}_search_index.sqlite`,
                            requestChunkSize: 4096,
                        }
                    }],
                    workerUrl,
                    wasmUrl,
                    10 * 1024 * 1024 
                );
                globalSearch.placeholder = "Search 40,000+ questions...";
            } catch(e) {
                console.error("Search engine boot failed", e);
                globalSearch.placeholder = "Search unavailable";
            }
            isSearchEngineLoading = false;
        }
    });

globalSearch.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value.toLowerCase().trim();
        
        if (query.length < 3) {
            searchDropdown.style.display = 'none';
            return;
        }

        searchTimeout = setTimeout(async () => {
            let isBookView = currentView === 'book';

            if (isBookView) {
                if (!activeCustomPool || activeCustomPool.length === 0) {
                    searchDropdown.innerHTML = `<div class="search-item" style="color:#94a3b8;">Please open a book first to search its contents.</div>`;
                    searchDropdown.style.display = 'block';
                    return;
                }
                
                const matchedMeta = activeCustomPool.filter(q => {
                    const qId = String(getQID(q));
                    const text = (q.question || q.Question || "").toLowerCase();
                    const hierarchyText = `${q.Subject || q.subject || ''} ${q.Chapter || q.chapter || ''}${q.Topic || q.topic || ''}`.toLowerCase();
                    
                    const isMatch = text.includes(query) || hierarchyText.includes(query);
                    if (!isMatch) return false;
                    if (unattemptedFilter && unattemptedFilter.checked && (attemptedQuestions.includes(qId) || globalPracticeMistakes.includes(qId) || globalExamMistakes.includes(qId))) return false;
                    if (!passesDifficultyFilter(q)) return false; 
                    
                    return true;
                });
                
                renderSearchResults(matchedMeta, query);
                return;
            }

            if (!window.sqlWorker) return;

            const safeQuery = query.replace(/"/g, '""');
            
            try {
                const sqlQuery = `
                    SELECT id, snippet(search_data, 1, '<b>', '</b>', '...', 15) as snippet, subject, chapter, topic, difficulty 
                    FROM search_data 
                    WHERE search_data MATCH '"${safeQuery}" *'
                    LIMIT 100
                `;
                
                const results = await window.sqlWorker.db.query(sqlQuery);
                
                const matchedMeta = results.map(r => {
                    if (unattemptedFilter && unattemptedFilter.checked && (attemptedQuestions.includes(r.id) || globalPracticeMistakes.includes(r.id) || globalExamMistakes.includes(r.id))) return null;
                    
                    if (diffEasyFilter || diffMediumFilter || diffHardFilter) {
                        const easy = diffEasyFilter?.checked;
                        const medium = diffMediumFilter?.checked;
                        const hard = diffHardFilter?.checked;
                        if (easy || medium || hard) {
                            const diff = (r.difficulty || "").toLowerCase().trim();
                            if (!(easy && diff === 'easy') && !(medium && diff === 'medium') && !(hard && diff === 'hard')) {
                                return null;
                            }
                        }
                    }

                    return {
                        id: r.id, QuestionID: r.id, Subject: r.subject, Chapter: r.chapter, 
                        Topic: r.topic, Difficulty: r.difficulty, isBookQuestion: false, _snippet: r.snippet
                    };
                }).filter(q => q !== null);
                
                renderSearchResults(matchedMeta, query);

            } catch (e) {
                console.error("SQL Search Error:", e);
            }
        }, 300);
    });
}

function renderSearchResults(matchedMeta, query) {
    searchDropdown.innerHTML = '';
    if (matchedMeta.length === 0) {
        searchDropdown.innerHTML = `<div class="search-item" style="color:#94a3b8;">No matches found for "${query}"</div>`;
    } else {
        const limitCount = Math.min(matchedMeta.length, 50);
        const quizAllBtn = document.createElement('div');
        quizAllBtn.className = 'search-item';
        quizAllBtn.style.cssText = 'background: rgba(59, 130, 246, 0.2); color: #93c5fd; font-weight: bold; text-align: center; position: sticky; top: 0; z-index: 10; border-bottom: 1px solid rgba(59, 130, 246, 0.4); border-radius: 12px 12px 0 0; cursor: pointer;';
        quizAllBtn.innerHTML = `<i class="fas fa-play-circle" style="margin-right: 8px;"></i> Create Quiz from Search (${limitCount} Qs)`;
        
        quizAllBtn.onclick = async () => {
            searchDropdown.style.display = 'none';
            globalSearch.value = '';
            const pool = matchedMeta.slice(0, 50);
            const hydratedPool = await hydrateQuestions(pool);
            window.launchQuiz(hydratedPool, 'practice', 0, `Search: ${query}`);
        };
        searchDropdown.appendChild(quizAllBtn);

        matchedMeta.slice(0, 30).forEach(q => {
            const div = document.createElement('div');
            div.className = 'search-item';
            const title = `${q.Subject || q.subject || 'Unknown'} > ${q.Chapter || q.chapter || ''}${q.Topic || q.topic ? '> ' + (q.Topic || q.topic) : ''}`;
            
            let snippetText = q._snippet || q.question || q.Question || "Click to load question details";
            if (!q._snippet && snippetText.length > 80) snippetText = snippetText.substring(0, 80) + '...';

            div.innerHTML = `
                <div class="search-item-title">${title}</div>
                <div class="search-item-snippet" style="color: #94a3b8;">${snippetText}</div>
            `;
            
            div.onclick = async () => {
                searchDropdown.style.display = 'none';
                globalSearch.value = '';
                const hydratedPool = await hydrateQuestions([q]);
                window.launchQuiz(hydratedPool, 'practice', 0);
            };
            searchDropdown.appendChild(div);
        });
    }
    searchDropdown.style.display = 'block';
}

document.addEventListener('click', (e) => {
    if (globalSearch && searchDropdown && !globalSearch.contains(e.target) && !searchDropdown.contains(e.target)) {
        searchDropdown.style.display = 'none';
    }
});

function passesDifficultyFilter(q) {
    if (!diffEasyFilter || !diffMediumFilter || !diffHardFilter) return true;
    const easy = diffEasyFilter.checked, medium = diffMediumFilter.checked, hard = diffHardFilter.checked;
    if (!easy && !medium && !hard) return true; 
    const qDiff = (q.Difficulty || q.difficulty || "").toLowerCase().trim();
    if (easy && qDiff === 'easy') return true;
    if (medium && qDiff === 'medium') return true;
    if (hard && qDiff === 'hard') return true;
    return false;
}

function triggerFilterUpdate() {
    if (currentView === 'book') renderBooksGrid();
    else renderGrid();
    
    if (popupOverlay && popupOverlay.style.display === 'flex') {
        const current = popupHistory[popupHistory.length - 1];
        if (current) {
            popupHistory.pop();
            openPopup(current.title, current.dataObj, current.level, current.pathArr, true);
        }
    }
}

if (unattemptedFilter) unattemptedFilter.addEventListener('change', triggerFilterUpdate);
if (diffEasyFilter) diffEasyFilter.addEventListener('change', triggerFilterUpdate);
if (diffMediumFilter) diffMediumFilter.addEventListener('change', triggerFilterUpdate);
if (diffHardFilter) diffHardFilter.addEventListener('change', triggerFilterUpdate);

// ==========================================
// 7. DATA LOADING & HIERARCHY TREES
// ==========================================
async function loadDataAndBuildTree() {
    try {
        if (!activeCourse) return; 
        
        const hierarchyRes = await fetch(`Data/${activeCourse}_hierarchy.json`, { cache: 'no-cache' });
        if (!hierarchyRes.ok) throw new Error("Hierarchy file not found");

        const hierarchyData = await hierarchyRes.json();

        subjectTree = hierarchyData.subjects || {};
        systemTree = hierarchyData.systems || {};
        examTree = hierarchyData.exams || {}; 
        
        // Boot SQLite Engine Silently for Search and Mock Exams
        if (!window.sqlWorker) {
            try {
                const workerUrl = "https://cdn.jsdelivr.net/npm/sql.js-httpvfs@8.4.0/dist/sqlite.worker.js";
                const wasmUrl = "https://cdn.jsdelivr.net/npm/sql.js-httpvfs@8.4.0/dist/sql-wasm.wasm";
                window.sqlWorker = await createDbWorker(
                    [{ from: "inline", config: { serverMode: "full", url: `Data/${activeCourse}_search_index.sqlite`, requestChunkSize: 4096 } }],
                    workerUrl, wasmUrl, 10 * 1024 * 1024 
                );
            } catch(e) { console.warn("SQLite boot failed", e); }
        }

        renderGrid();
    } catch (error) {
        console.error("Data Load Error:", error);
    }
}

async function loadAndOpenBook(book) {
    try {
        document.body.style.cursor = 'wait';
        
        if (!loadedBooksCache[book.file]) {
            const response = await fetch(`Books/${book.file}_questions.json`, { cache: 'no-cache' });
            if (!response.ok) throw new Error("JSON file not found");
            
            let bookQuestions = await response.json();
            bookQuestions.forEach(q => {
                q.QuestionID = q.id;
                q.Subject = book.title;
                q.Chapter = q.chapter;
                q.Topic = q.topic;
                q.Exam = q.exams;
                q.Year = q.year;
                q.isBookQuestion = true;
                q.bookName = book.file;
            });
            
            loadedBooksCache[book.file] = bookQuestions;
            
            allQuestions = allQuestions.filter(q => q.bookName !== book.file);
            allQuestions.push(...bookQuestions);
        }

        let bookQuestions = loadedBooksCache[book.file];
        
        let tempBookTree = {};
        bookQuestions.forEach(q => {
            if (q.Chapter) {
                if (!tempBookTree[q.Chapter]) tempBookTree[q.Chapter] = [];
                if (q.Topic && !tempBookTree[q.Chapter].includes(q.Topic)) tempBookTree[q.Chapter].push(q.Topic);
            }
        });

        activeCustomPool = bookQuestions;
        document.body.style.cursor = 'default';
        openPopup(book.title, tempBookTree, 'Level1', []);

    } catch (error) {
        document.body.style.cursor = 'default';
        console.error("Error loading book:", error);
        alert("Failed to load book content.");
    }
}

async function fetchRequiredChunks(view, pathsArray) {
    const urls = new Set();
    
    pathsArray.forEach(pathArr => {
        if (pathArr.length === 0 || pathArr[0] === "Books" || pathArr[0] === "Practice Mistakes" || pathArr[0] === "Exam Mistakes") return; 
        
        if (view === 'subject') {
            let current = subjectTree;
            for (let p of pathArr) { if (current[p]) current = current[p]; else return; }
            const traverseSubj = (obj, pth) => {
                if (pth.length >= 2) {
                    urls.add(`Data/${activeCourse}/subjects/${sanitizeFilename(pth[0])}_${sanitizeFilename(pth[1])}.json`);
                    return;
                }
                if (typeof obj === 'number') return;
                for (let k in obj) traverseSubj(obj[k], [...pth, k]);
            };
            traverseSubj(current, pathArr);
        } 
        else if (view === 'system') {
            let current = systemTree;
            for (let p of pathArr) { if (current[p]) current = current[p]; else return; }
            const traverseSys = (obj, pth) => {
                if (pth.length >= 2) {
                    urls.add(`Data/${activeCourse}/systems/${sanitizeFilename(pth[0])}_${sanitizeFilename(pth[1])}.json`);
                    return;
                }
                if (typeof obj === 'number') return;
                for (let k in obj) traverseSys(obj[k], [...pth, k]);
            };
            traverseSys(current, pathArr);
        } 
        else if (view === 'exam') {
            let current = examTree;
            for (let p of pathArr) { if (current[p]) current = current[p]; else return; }
            const traverseEx = (obj, pth) => {
                if (pth.length >= 3) {
                    urls.add(`Data/${activeCourse}/exams/${sanitizeFilename(pth[0])}_${sanitizeFilename(pth[1])}_${sanitizeFilename(pth[2])}.json`);
                    return;
                }
                if (typeof obj === 'number') return;
                for (let k in obj) traverseEx(obj[k], [...pth, k]);
            };
            traverseEx(current, pathArr);
        }
    });

    document.body.style.cursor = 'wait';
    const fetchedQs = [];
    const seenIds = new Set();
    
for (let baseUrl of urls) {
        let page = 1;
        let keepFetching = true;
        
        while (keepFetching) {
            const pageUrl = baseUrl.replace('.json', `_${page}.json`);
            if (!window.activeChunksCache[pageUrl]) {
                try {
                    const res = await fetch(pageUrl);
                    if (res.ok) {
                        window.activeChunksCache[pageUrl] = await res.json();
                    } else {
                        window.activeChunksCache[pageUrl] = [];
                        keepFetching = false;
                    }
                } catch(e) {
                    window.activeChunksCache[pageUrl] = [];
                    keepFetching = false;
                }
            } else if (window.activeChunksCache[pageUrl].length === 0) {
                keepFetching = false;
            }
            
            if (window.activeChunksCache[pageUrl]) {
                window.activeChunksCache[pageUrl].forEach(q => {
                    const qId = String(q.id || q.QuestionID);
                    if (!seenIds.has(qId)) {
                        seenIds.add(qId);
                        fetchedQs.push(q);
                    }
                });
            }
            page++;
        }
    }
    
    document.body.style.cursor = 'default';
    return fetchedQs;
}

// ==========================================
// 8. POPUP, CART & CHECKBOXES
// ==========================================
if (popupBack) {
    popupBack.onclick = () => {
        if (popupHistory.length > 1) {
            popupHistory.pop();
            const prev = popupHistory[popupHistory.length - 1];
            openPopup(prev.title, prev.dataObj, prev.level, prev.pathArr, true);
        } else {
            if (popupOverlay) popupOverlay.style.display = 'none';
        }
    };
}

if (popupClose) {
    popupClose.onclick = () => { 
        popupHistory = []; 
        if(popupOverlay) popupOverlay.style.display = 'none'; 
        activeCustomPool = null; 
        isGlobalPopupActive = false; 
        localStorage.removeItem('edeetos_saved_popup_path'); 
        localStorage.removeItem('edeetos_saved_popup_title');
    };
}

if (popupOverlay) {
    popupOverlay.onclick = (e) => { 
        if (e.target === popupOverlay) { 
            popupHistory = []; 
            popupOverlay.style.display = 'none'; 
            activeCustomPool = null; 
            isGlobalPopupActive = false; 
            localStorage.removeItem('edeetos_saved_popup_path');
            localStorage.removeItem('edeetos_saved_popup_title');
        } 
    };
}

function openPopup(title, dataObj, level, pathArr, isBackNav = false) {
    if (!isBackNav) popupHistory.push({ title, dataObj, level, pathArr });

    if (popupTitle) popupTitle.textContent = title;
	localStorage.setItem('edeetos_saved_popup_path', JSON.stringify(pathArr));
    localStorage.setItem('edeetos_saved_popup_title', title);
    if (popupList) popupList.innerHTML = '';
    if (popupOverlay) popupOverlay.style.display = 'flex';
    if (popupBack) popupBack.style.display = popupHistory.length > 1 ? 'inline-block' : 'none';

    const selectAllDiv = document.createElement('div');
    selectAllDiv.className = 'list-item hero-item';
    selectAllDiv.innerHTML = `
        <div style="flex-grow: 1;">
            <div class="card-header-flex">
                <span style="font-weight: bold; color: #bfdbfe;">Select Full ${title}</span>
            </div>
        </div>
        <button class="action-btn select-all-btn" style="margin-left: 15px; background: rgba(59, 130, 246, 0.2); border-color: #3b82f6; padding: 0.5rem 1rem;">Select All</button>
    `;
    if(popupList) popupList.appendChild(selectAllDiv);

    selectAllDiv.querySelector('.select-all-btn').onclick = () => {
        const allCbs = popupList.querySelectorAll('.item-checkbox');
        let allAreChecked = true;
        allCbs.forEach(cb => { if (!cb.checked) allAreChecked = false; });

        allCbs.forEach(cb => {
            cb.checked = !allAreChecked;
            cb.dispatchEvent(new Event('change'));
        });
        selectAllDiv.querySelector('.select-all-btn').textContent = allAreChecked ? 'Select All' : 'Deselect All';
    };

    if (Array.isArray(dataObj)) {
        let sortedTopics = [...dataObj].sort((a, b) => a.localeCompare(b));
        sortedTopics.forEach(topic => renderListItem(topic, null, 'Topic', [...pathArr, topic]));
    } else {
        let keys = Object.keys(dataObj);
        
        if (currentView === 'exam' && level === 'Level1') {
            const parseSortDetails = (str) => {
                const parts = str.split('-').map(p => p.trim());
                const subject = (parts[0] || str).toLowerCase();
                
                let year = 9999;
                let month = 99;
                let day = 99;

                const sessionMatch = str.match(/\b(\d{1,2})\/(\d{2,4})\b/);
                if (sessionMatch) {
                    month = parseInt(sessionMatch[1], 10);
                    const rawYear = parseInt(sessionMatch[2], 10);
                    year = rawYear < 100 ? 2000 + rawYear : rawYear;
                }

                const lowerStr = str.toLowerCase();
                const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
                if (month === 99) {
                    for (let i = 0; i < months.length; i++) {
                        if (lowerStr.includes(months[i])) {
                            month = i + 1;
                            break;
                        }
                    }
                }

                const dayMatch = lowerStr.match(/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*[-–]?\s*(\d{1,2})\b/)
                              || lowerStr.match(/\b(\d{1,2})\s*[-–]?\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/);
                if (dayMatch) {
                    day = parseInt(dayMatch[1], 10);
                } else if (parts[2]) {
                    const partDayMatch = parts[2].match(/\b(\d{1,2})\b/);
                    if (partDayMatch) day = parseInt(partDayMatch[1], 10);
                }

                const shiftMap = {
                    'morning': 1,
                    'afternoon': 2,
                    'evening': 3,
                    'night': 4
                };
                let shiftPriority = 99;
                for (const [shiftKey, priority] of Object.entries(shiftMap)) {
                    if (lowerStr.includes(shiftKey)) {
                        shiftPriority = priority;
                        break;
                    }
                }

                return { subject, year, month, day, shiftPriority };
            };

            keys.sort((a, b) => {
                const itemA = parseSortDetails(a);
                const itemB = parseSortDetails(b);

                if (itemA.subject !== itemB.subject) {
                    return itemA.subject.localeCompare(itemB.subject);
                }
                if (itemA.year !== itemB.year) return itemA.year - itemB.year;
                if (itemA.month !== itemB.month) return itemA.month - itemB.month;
                if (itemA.day !== itemB.day) return itemA.day - itemB.day;
                if (itemA.shiftPriority !== itemB.shiftPriority) {
                    return itemA.shiftPriority - itemB.shiftPriority;
                }

                return a.localeCompare(b);
            });
        } else {
            keys.sort((a, b) => a.localeCompare(b));
        }
        keys.forEach(key => renderListItem(key, dataObj[key], level, [...pathArr, key]));
    }
}

function renderListItem(itemName, nextData, level, itemPath) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'list-item';
    const labelDiv = document.createElement('div');
    labelDiv.style.flexGrow = '1';

    const qCount = getQuestionCount(currentView, itemPath);
    
    const filtersActive = (unattemptedFilter && unattemptedFilter.checked) || 
                          (diffEasyFilter && diffEasyFilter.checked) || 
                          (diffMediumFilter && diffMediumFilter.checked) || 
                          (diffHardFilter && diffHardFilter.checked);
                          
    if (qCount === 0 && filtersActive) return;

    const doneCount = getSolvedCount(currentView, itemPath);
    
    let countHtml = '';
    let progressHtml = '';
    let examStatsHtml = '';

    if (typeof isGlobalPopupActive !== 'undefined' && isGlobalPopupActive) {
        countHtml = `<span class="card-count">${qCount} Qs</span>`;
    } else {
        const percent = qCount > 0 ? Math.round((doneCount / qCount) * 100) : 0;
        countHtml = `<span class="card-count">${doneCount} /${qCount}</span>`;
        progressHtml = `<div class="progress-container"><div class="progress-bar-fill" style="width: ${percent}%;"></div></div>`;
    }

    if (currentView === 'exam') {
        const mistakeCount = getMistakesCount(currentView, itemPath);
        const totalAttempts = doneCount + mistakeCount;
        const accuracy = totalAttempts > 0 ? Math.round((doneCount / totalAttempts) * 100) : 0;

        const accColor = totalAttempts === 0 ? '#94a3b8' : (accuracy >= 75 ? '#34d399' : (accuracy >= 50 ? '#fbbf24' : '#fca5a5'));
        const accBg = totalAttempts === 0 ? 'rgba(255,255,255,0.1)' : (accuracy >= 75 ? 'rgba(16,185,129,0.15)' : (accuracy >= 50 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)'));
        const accBorder = totalAttempts === 0 ? 'rgba(255,255,255,0.2)' : (accuracy >= 75 ? 'rgba(16,185,129,0.3)' : (accuracy >= 50 ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.3)'));

        examStatsHtml = `
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 6px 0 6px 28px; font-size: 0.75rem;">
                <span style="background: rgba(16,185,129,0.15); color: #6ee7b7; border: 1px solid rgba(16,185,129,0.3); padding: 2px 8px; border-radius: 6px; font-weight: 600;">
                    <i class="fas fa-check" style="margin-right: 4px;"></i>${doneCount} Solved
                </span>
                <span style="background: rgba(239,68,68,0.15); color: #fca5a5; border: 1px solid rgba(239,68,68,0.3); padding: 2px 8px; border-radius: 6px; font-weight: 600;">
                    <i class="fas fa-times" style="margin-right: 4px;"></i>${mistakeCount} Mistakes
                </span>
                <span style="background: ${accBg}; color: ${accColor}; border: 1px solid${accBorder}; padding: 2px 8px; border-radius: 6px; font-weight: 700;">
                    <i class="fas fa-bullseye" style="margin-right: 4px;"></i>${totalAttempts > 0 ? accuracy + '% Accuracy' : 'Unattempted'}
                </span>
            </div>
        `;
    }

    const hasSubLevels = typeof nextData === 'object' && nextData !== null && Object.keys(nextData).length > 0;
    const safePath = encodeURIComponent(JSON.stringify(itemPath));
    const pathStr = JSON.stringify(itemPath);
    const displayInstantStart = currentMode === 'exam' ? 'none' : 'inline-block';
    
    // Pass safePath to a data attribute instead of inline strings to prevent escaping issues
    const instantStartBtn = `<button class="action-btn instant-start-btn" data-path="${safePath}" style="display: ${displayInstantStart}; margin-left: 10px; padding: 0.3rem 0.6rem; font-size: 0.75rem; border-radius: 6px; background: rgba(16,185,129,0.2); border-color: #34d399; color: #a7f3d0;">Start</button>`;

    labelDiv.innerHTML = `
        <div class="card-header-flex" style="align-items: center;">
            <span style="font-weight: 600; display: flex; align-items: center; color: #f8fafc;">
                <input type="checkbox" class="item-checkbox">
                ${itemName}
            </span>
            <div style="display: flex; align-items: center; gap: 8px;">
                ${countHtml}${instantStartBtn}
            </div>
        </div>
        ${examStatsHtml}${progressHtml}
    `;
    itemDiv.appendChild(labelDiv);
    
    const instBtn = itemDiv.querySelector('.instant-start-btn');
    if (instBtn) {
        instBtn.onclick = (e) => {
            e.stopPropagation();
            startInstantPractice(instBtn.getAttribute('data-path'));
        };
    }

    const cb = itemDiv.querySelector('.item-checkbox');
    cb.checked = selectedCart.has(pathStr);

    cb.onchange = (e) => {
        if (e.target.checked) selectedCart.add(pathStr);
        else selectedCart.delete(pathStr);

        const cartCountEl = document.getElementById('cart-count');
        const startBtnEl = document.getElementById('start-exam-btn');
        const examCart = document.getElementById('exam-cart');
        
        if (cartCountEl) cartCountEl.textContent = `${selectedCart.size} Topics Selected`;
        if (startBtnEl) startBtnEl.disabled = selectedCart.size === 0;
        
        if (examCart) examCart.style.display = (currentMode === 'exam' || selectedCart.size > 0) ? "flex" : "none";
    };

    itemDiv.style.cursor = 'pointer';
    itemDiv.onclick = (e) => {
        if (e.target !== cb && e.target.tagName !== 'BUTTON') {
            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event('change'));
        }
    };

    if (hasSubLevels) {
        const actionBtn = document.createElement('button');
        actionBtn.className = 'action-btn';
        actionBtn.style.marginLeft = '15px';
        actionBtn.style.padding = '0.5rem 1rem';
        actionBtn.textContent = 'View ➡';
        actionBtn.onclick = (e) => {
            e.stopPropagation(); 
            openPopup(itemName, nextData, 'Chapter', itemPath, false);
        };
        itemDiv.appendChild(actionBtn);
    }

    if (popupList) popupList.appendChild(itemDiv);
}

function getQuestionCount(view, pathArr, customPool = null) {
    if (customPool !== null && customPool.length === 0) {
        return 0;
    }
    
    let pool = customPool || activeCustomPool || globalMetadata;
    let paths = [...pathArr];

    if (paths[0] === "Practice Mistakes") {
        pool = pool.filter(q => globalPracticeMistakes.includes(getQID(q)));
        paths.shift();
    } else if (paths[0] === "Exam Mistakes") {
        pool = pool.filter(q => globalExamMistakes.includes(getQID(q)));
        paths.shift();
    } else if (paths[0] === "Skipped Questions") {
        pool = pool.filter(q => globalSkipped.includes(getQID(q)));
        paths.shift();
    } else if (paths[0] && paths[0].startsWith("\u200B")) {
        const folderName = paths[0].replace("\u200B", "");
        pool = pool.filter(q => (globalBookmarkFolders[getQID(q)] || "For Revision") === folderName);
        paths.shift();
    }

    const isDefaultPool = (pool === globalMetadata || pool === activeCustomPool);
    
    // NEW: Ignore filters for the root dashboard grid so it never blanks out
    const isRootGrid = (!isGlobalPopupActive && paths.length === 1 && view !== 'book');
    const noFiltersActive = (!diffEasyFilter?.checked && !diffMediumFilter?.checked && !diffHardFilter?.checked && !unattemptedFilter?.checked);

    if (isDefaultPool && (noFiltersActive || isRootGrid) && !isGlobalPopupActive) {
        let tree = {};
        if (view === 'subject') tree = subjectTree;
        else if (view === 'system') tree = systemTree;
        else if (view === 'exam') tree = examTree;
        else if (view === 'book') {
            let current = activeCustomPool ? buildSubTree(activeCustomPool) : {};
            const subjects = Object.keys(current);
            if (subjects.length > 0) current = current[subjects[0]];
            for (let p of paths) {
                if (current && current[p]) current = current[p];
                else return 0;
            }
            return getTreeCount(current);
        }
        
        if (Object.keys(tree).length > 0) {
            let current = tree;
            for(let p of paths) {
                if(current && current[p]) current = current[p];
                else return 0;
            }
            return getTreeCount(current);
        }
    }

    // SLOW PATH: Execute strict filtering only when UI filters are active
    if (pool && pool.length > 0) {
        if (paths.length === 0) {
            return pool.filter(q => {
                if (!passesDifficultyFilter(q)) return false;
                if (!isGlobalPopupActive && unattemptedFilter && unattemptedFilter.checked && window.fastAttemptedSet && window.fastAttemptedSet.has(getQID(q))) return false;
                return true;
            }).length;
        }

        return pool.filter(q => {
            if (!passesDifficultyFilter(q)) return false;
            if (!isGlobalPopupActive && unattemptedFilter && unattemptedFilter.checked && window.fastAttemptedSet && window.fastAttemptedSet.has(getQID(q))) return false;
            
            const qSubj = q.Subject || q.subject;
            const qChap = q.Chapter || q.chapter;
            const qTop = q.Topic || q.topic;

            if (isGlobalPopupActive) {
                if (paths[0] === "Books") {
                    if (!q.isBookQuestion) return false;
                    if (paths[1] && qSubj !== paths[1]) return false;
                    if (paths[2] && qChap !== paths[2]) return false;
                    if (paths[3] && qTop !== paths[3]) return false;
                    return true;
                } else {
                    if (q.isBookQuestion) return false;
                    if (paths[0] && qSubj !== paths[0]) return false;
                    if (paths[1] && qChap !== paths[1]) return false;
                    if (paths[2] && qTop !== paths[2]) return false;
                    return true;
                } 
            }

            if (view === 'subject') {
                if (q.isBookQuestion) return false; 
                if (paths[0] && qSubj !== paths[0]) return false;
                if (paths[1] && qChap !== paths[1]) return false;
                if (paths[2] && qTop !== paths[2]) return false;
            } else if (view === 'system') {
                if (q.isBookQuestion) return false; 
                if (paths[0] && qChap !== paths[0]) return false;
                if (paths[1] && qSubj !== paths[1]) return false;
                if (paths[2] && qTop !== paths[2]) return false;
            } else if (view === 'exam') {
                const toArray = (val) => Array.isArray(val) ? val.map(v => String(v).trim()) : (typeof val === 'string' ? val.split(',').map(v => v.trim()) : (val ? [String(val).trim()] : []));
                
                let qYears = toArray(q.year || q.Year);
                let qSpecs = toArray(q.specialty || q.Specialty);
                let qExams = toArray(q.exams || q.Exam);

                let matchFound = false;
                const maxLen = Math.max(qYears.length, qSpecs.length, qExams.length);
                
                if (maxLen === 0) {
                    if (paths[0] && paths[0] !== "Unknown Year") return false;
                }
                
                for (let i = 0; i < maxLen; i++) {
                    const fbYear = qYears[i] !== undefined ? qYears[i] : (qYears[qYears.length - 1] || "Unknown Year");
                    const fbSpec = qSpecs[i] !== undefined ? qSpecs[i] : (qSpecs[qSpecs.length - 1] || "Unknown Specialty");
                    const rawExam = qExams[i] !== undefined ? qExams[i] : (qExams[qExams.length - 1] || "Unknown Exam");
                    
                    const parsed = parseExamInfo(rawExam, fbYear, fbSpec);
                    
                    let currentMatch = true;
                    if (paths[0] && parsed.examYear !== paths[0]) currentMatch = false;
                    if (paths[1] && parsed.examSpec !== paths[1]) currentMatch = false;
                    if (paths[2] && rawExam !== paths[2]) currentMatch = false;
                    
                    if (currentMatch) {
                        matchFound = true;
                        break;
                    }
                }
                if (!matchFound) return false;
                if (paths[2] && qSubj !== paths[2]) return false;
                if (paths[3] && qTop !== paths[3]) return false;

            } else if (view === 'book') {
                if (!q.isBookQuestion) return false;
                if (paths[0] && qChap !== paths[0]) return false;
                if (paths[1] && qTop !== paths[1]) return false;
            }
            return true;
        }).length;
    }

    return 0;
}

function getSolvedCount(view, pathArr) {
    const pool = activeCustomPool || globalMetadata;
    
    if (!cachedAttemptedPool || cachedAttemptedPool.poolRef !== pool) {
        cachedAttemptedPool = {
            poolRef: pool,
            data: pool.filter(q => window.fastAttemptedSet && window.fastAttemptedSet.has(getQID(q)))
        };
    }
    return getQuestionCount(view, pathArr, cachedAttemptedPool.data);
}

function getMistakesCount(view, pathArr) {
    const pool = activeCustomPool || globalMetadata;
    
    if (!cachedMistakesPool || cachedMistakesPool.poolRef !== pool) {
        const allMistakesSet = new Set([...globalPracticeMistakes, ...globalExamMistakes]);
        cachedMistakesPool = {
            poolRef: pool,
            data: pool.filter(q => allMistakesSet.has(getQID(q)))
        };
    }
    return getQuestionCount(view, pathArr, cachedMistakesPool.data);
}

// ==========================================
// 9. EXAM LAUNCH & MODES
// ==========================================
if (document.getElementById('mode-practice')) document.getElementById('mode-practice').addEventListener('click', () => switchMode('practice'));
if (document.getElementById('mode-exam')) document.getElementById('mode-exam').addEventListener('click', () => switchMode('exam'));

function switchMode(mode) {
    currentMode = mode;
    
    const searchBar = document.querySelector('.search-filter-bar');
    const modeDesc = document.getElementById('mode-description');
    const startBtn = document.getElementById('start-exam-btn');
    
    const qCountInput = document.getElementById('exam-q-count');
    const timerInput = document.getElementById('exam-timer');
    
    const examCart = document.getElementById('exam-cart');
    if (examCart) examCart.style.display = (mode === 'exam' || selectedCart.size > 0) ? "flex" : "none";
    
    if (startBtn) startBtn.textContent = mode === 'practice' ? 'Start Practice' : 'Start Exam';

    if (mode === 'practice') {
        const modePracBtn = document.getElementById('mode-practice');
        const modeExamBtn = document.getElementById('mode-exam');
        if (modePracBtn) { modePracBtn.classList.add('active-mode'); modePracBtn.style.background = 'rgba(16, 185, 129, 0.2)'; modePracBtn.style.borderColor = '#34d399'; modePracBtn.style.color = '#a7f3d0'; }
        if (modeExamBtn) { modeExamBtn.classList.remove('active-mode'); modeExamBtn.style.background = 'rgba(255, 255, 255, 0.08)'; modeExamBtn.style.borderColor = 'rgba(255,255,255,0.2)'; modeExamBtn.style.color = '#f8fafc'; }
        
        if (qCountInput && qCountInput.parentElement) qCountInput.parentElement.style.display = 'flex';
        if (timerInput && timerInput.parentElement) timerInput.parentElement.style.display = 'none';
        
        if (modeDesc) modeDesc.textContent = "Practice Mode: Select your topics below. Enjoy instant feedback and detailed explanations.";
        
        if (searchBar) {
            if (searchBar.contains(document.getElementById('subjects-grid'))) {
                Array.from(searchBar.children).forEach(child => {
                    if (child.id !== 'subjects-grid' && child.id !== 'mock-exam-modal' && child.id !== 'exam-cart') {
                        child.style.display = '';
                    }
                });
            } else {
                searchBar.style.display = "flex";
            }
        }
    } else {
        const modePracBtn = document.getElementById('mode-practice');
        const modeExamBtn = document.getElementById('mode-exam');
        if (modeExamBtn) { modeExamBtn.classList.add('active-mode'); modeExamBtn.style.background = 'rgba(59, 130, 246, 0.2)'; modeExamBtn.style.borderColor = '#3b82f6'; modeExamBtn.style.color = '#bfdbfe'; }
        if (modePracBtn) { modePracBtn.classList.remove('active-mode'); modePracBtn.style.background = 'rgba(255, 255, 255, 0.08)'; modePracBtn.style.borderColor = 'rgba(255,255,255,0.2)'; modePracBtn.style.color = '#f8fafc'; }
        
        if (qCountInput && qCountInput.parentElement) qCountInput.parentElement.style.display = 'flex';
        if (timerInput && timerInput.parentElement) timerInput.parentElement.style.display = 'flex';
        
        if (modeDesc) modeDesc.textContent = "Exam Mode: Strict timer, no instant feedback, skipped questions appear at the end.";
        
        if (searchBar) {
            if (searchBar.contains(document.getElementById('subjects-grid'))) {
                Array.from(searchBar.children).forEach(child => {
                    if (child.id !== 'subjects-grid' && child.id !== 'mock-exam-modal' && child.id !== 'exam-cart') {
                        child.style.display = 'none';
                    }
                });
            } else {
                searchBar.style.display = "none";
            }
        }
    }
    
    if (currentView === 'book') renderBooksGrid();
    else renderGrid();

    if (popupOverlay && popupOverlay.style.display === 'flex') {
        const current = popupHistory[popupHistory.length - 1];
        if (current) {
            popupHistory.pop(); 
            openPopup(current.title, current.dataObj, current.level, current.pathArr, true);
        }
    }
}

if (examQInput) {
    examQInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && startExamBtn) startExamBtn.click();
    });
}
if (examTimerInput) {
    examTimerInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && startExamBtn) startExamBtn.click();
    });
}

const btnQuickMock = document.getElementById('btn-quick-mock');
const mockModal = document.getElementById('mock-exam-modal');
const mockQCount = document.getElementById('mock-q-count');
const btnCancelMock = document.getElementById('btn-cancel-mock');
const btnStartMock = document.getElementById('btn-start-mock');
const btnJoinChallenge = document.getElementById('btn-join-challenge');

if (btnJoinChallenge) {
    btnJoinChallenge.addEventListener('click', () => {
        if (localStorage.getItem('edeetos_guest_mode') === 'true') {
            return alert("Please register to join a challenge.");
        }

        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'join-challenge-modal';
        modalOverlay.className = "popup-overlay";
        modalOverlay.style.display = "flex";

        modalOverlay.innerHTML = `
            <div class="glass-panel popup-content text-center" style="max-width: 400px; width: 90%;">
                <h3 style="color: #d8b4fe; margin-top: 0; margin-bottom: 10px; font-size: 1.6rem;"><i class="fas fa-flag-checkered"></i> Join Challenge</h3>
                <p class="modal-subtitle" style="margin-bottom: 20px;">Enter the 5-character code shared by your friend.</p>
                
                <input type="text" id="challenge-code-input" class="glass-input" placeholder="e.g. A1B2C" maxlength="5" style="margin-bottom: 20px; font-size: 1.8rem; text-align: center; font-weight: 800; text-transform: uppercase; letter-spacing: 2px;">
                
                <div style="display: flex; gap: 10px;">
                    <button id="btn-cancel-join" class="action-btn" style="flex: 1;">Cancel</button>
                    <button id="btn-confirm-join" class="action-btn" style="flex: 1; background: rgba(168, 85, 247, 0.2); border-color: #c084fc; color: #e9d5ff;">Join Match</button>
                </div>
            </div>
        `;

        document.body.appendChild(modalOverlay);

        const inputField = document.getElementById('challenge-code-input');
        inputField.focus();

        document.getElementById('btn-cancel-join').addEventListener('click', () => {
            modalOverlay.remove();
        });

        const processJoin = async () => {
            const code = inputField.value.trim().toUpperCase();
            if (!code || code.length !== 5) {
                inputField.style.borderColor = '#ef4444';
                return;
            }

            const confirmBtn = document.getElementById('btn-confirm-join');
            confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
            confirmBtn.disabled = true;
            
            try {
                const challengeSnap = await getDoc(doc(db, "friend_challenges", code));
                if (!challengeSnap.exists()) {
                    alert("Invalid or expired Challenge Code.");
                    confirmBtn.innerHTML = 'Join Match';
                    confirmBtn.disabled = false;
                    return;
                }
                
                const challengeData = challengeSnap.data();
                localStorage.setItem('edeetos_challenge_data', JSON.stringify(challengeData));
                
                document.body.style.cursor = 'wait';
                const request = indexedDB.open("EdeetosDB", 1);
                
                request.onupgradeneeded = (e) => {
                    const idb = e.target.result;
                    if (!idb.objectStoreNames.contains("quiz_sessions")) idb.createObjectStore("quiz_sessions");
                };
                
                request.onsuccess = (e) => {
                    const idb = e.target.result;
                    const tx = idb.transaction("quiz_sessions", "readwrite");
                    tx.objectStore("quiz_sessions").put(challengeData.queue, "active_quiz_queue");
                    tx.oncomplete = () => {
                        localStorage.setItem('edeetos_quiz_config', JSON.stringify({ mode: 'exam', timer: challengeData.calcMinutes, examName: 'Friend Challenge vs ' + challengeData.hostName }));
                        window.location.href = 'quiz.html';
                    };
                };
            } catch (err) {
                console.error(err);
                alert("Failed to load friend challenge.");
                confirmBtn.innerHTML = 'Join Match';
                confirmBtn.disabled = false;
            }
        };

        document.getElementById('btn-confirm-join').addEventListener('click', processJoin);
        inputField.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') processJoin();
        });
    });
}

if (btnQuickMock && mockModal) {
    btnQuickMock.addEventListener('click', () => {
        if (localStorage.getItem('edeetos_guest_mode') === 'true') return alert("Please register to take mock exams.");
        mockModal.style.display = 'flex';
        if(mockQCount) mockQCount.focus();
    });
    
    if(btnCancelMock) btnCancelMock.addEventListener('click', () => mockModal.style.display = 'none');
    
if(btnStartMock) btnStartMock.addEventListener('click', async () => {
        let count = parseInt(mockQCount.value);
        if (!count || count < 5) return alert("Please enter a valid number of questions (minimum 5).");

        btnStartMock.textContent = "Generating...";
        btnStartMock.disabled = true;

        if (!window.sqlWorker) {
            btnStartMock.textContent = "Start Exam";
            btnStartMock.disabled = false;
            return alert("Database is still booting. Please try again in a few seconds.");
        }

        try {
            // Fetch random pool directly from SQLite to bypass empty globalMetadata
            const sqlQuery = `SELECT id, subject, chapter, topic, difficulty FROM search_data ORDER BY RANDOM() LIMIT 500`;
            const results = await window.sqlWorker.db.query(sqlQuery);
            
            const allMistakes = [...new Set([...globalPracticeMistakes, ...globalExamMistakes])];
            
            let metaPool = results.map(r => ({
                id: r.id, QuestionID: r.id, Subject: r.subject, Chapter: r.chapter, 
                Topic: r.topic, Difficulty: r.difficulty, isBookQuestion: false
            })).filter(q => !attemptedQuestions.includes(q.id) && !allMistakes.includes(q.id));

            if (metaPool.length < count) {
                metaPool = results.map(r => ({
                    id: r.id, QuestionID: r.id, Subject: r.subject, Chapter: r.chapter, 
                    Topic: r.topic, Difficulty: r.difficulty, isBookQuestion: false
                }));
            }

            if (metaPool.length < count) {
                btnStartMock.textContent = "Start Exam";
                btnStartMock.disabled = false;
                return alert("Not enough questions available for a mock exam.");
            }

            let finalPool = metaPool.sort(() => 0.5 - Math.random()).slice(0, count);
            const calcMinutes = Math.ceil(count * 1.2);

            mockModal.style.display = 'none';
            btnStartMock.textContent = "Start Exam";
            btnStartMock.disabled = false;

            finalPool = await hydrateQuestions(finalPool);
            window.launchQuiz(finalPool, 'exam', calcMinutes, `Mock Exam (${count} Qs)`);
        } catch (e) {
            console.error("Mock Exam Error:", e);
            btnStartMock.textContent = "Start Exam";
            btnStartMock.disabled = false;
            alert("Failed to generate mock exam from database.");
        }
    });
}

if (startExamBtn) {
    startExamBtn.addEventListener('click', async () => {
        const paths = Array.from(selectedCart).map(str => JSON.parse(str));
        
        startExamBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
        startExamBtn.disabled = true;

        let sourcePool = currentView === 'book' ? (activeCustomPool || allQuestions) : await fetchRequiredChunks(currentView, paths);

        let pool = sourcePool.filter(q => {
            return paths.some(pathArr => getQuestionCount(currentView, pathArr, [q]) > 0);
        });

        const qCountInput = parseInt(document.getElementById('exam-q-count').value);
        const timerInput = parseInt(document.getElementById('exam-timer').value);

        if (currentMode === 'exam' && (!timerInput || timerInput <= 0 || isNaN(timerInput))) {
            alert("Please enter a valid time in minutes for Exam Mode.");
            startExamBtn.textContent = 'Start Exam';
            startExamBtn.disabled = false;
            return;
        }

        if (currentMode === 'exam') {
            if (qCountInput && qCountInput > 0 && qCountInput < pool.length) {
                pool = pool.sort(() => 0.5 - Math.random()).slice(0, qCountInput);
            } else {
                pool = pool.sort(() => 0.5 - Math.random());
            }
        } else {
            if (qCountInput && qCountInput > 0 && qCountInput < pool.length) {
                pool = pool.sort(() => 0.5 - Math.random()).slice(0, qCountInput);
            }
        }
        
		const generatedTitle = generateExamTitle(paths, currentView);
        pool = await hydrateQuestions(pool);
        
        startExamBtn.textContent = currentMode === 'practice' ? 'Start Practice' : 'Start Exam';
        startExamBtn.disabled = false;

        window.launchQuiz(pool, currentMode, currentMode === 'exam' ? timerInput : 0, generatedTitle);
    });
}

async function hydrateQuestions(metadataPool) {
    const needsHydration = metadataPool.filter(q => !q.isBookQuestion && !q.question); 
    if (needsHydration.length === 0) return metadataPool;

    document.body.style.cursor = 'wait';
    const chunksToLoad = new Set();

    needsHydration.forEach(q => {
        const s = sanitizeFilename(q.Subject || q.subject || 'Uncategorized');
        const c = sanitizeFilename(q.Chapter || q.chapter || 'General');
        chunksToLoad.add(`Data/${activeCourse}/subjects/${s}_${c}.json`);
    });

const fetchPromises = Array.from(chunksToLoad).map(async (baseUrl) => {
        let page = 1;
        let keepFetching = true;
        while (keepFetching) {
            const pageUrl = baseUrl.replace('.json', `_${page}.json`);
            if (!window.activeChunksCache[pageUrl]) {
                try {
                    const res = await fetch(pageUrl);
                    if (res.ok) window.activeChunksCache[pageUrl] = await res.json();
                    else { window.activeChunksCache[pageUrl] = []; keepFetching = false; }
                } catch(e) { window.activeChunksCache[pageUrl] = []; keepFetching = false; }
            } else if (window.activeChunksCache[pageUrl].length === 0) {
                keepFetching = false;
            }
            page++;
        }
    });

    await Promise.all(fetchPromises);

    const fullQuestionsMap = {};
    Object.values(window.activeChunksCache).forEach(chunkArray => {
        chunkArray.forEach(fullQ => {
            const qId = fullQ.id || fullQ.QuestionID;
            if (qId) fullQuestionsMap[String(qId)] = fullQ;
        });
    });

    const hydratedPool = metadataPool.map(q => {
        if (q.isBookQuestion) return q;
        const qId = q.id || q.QuestionID;
        const fullQ = fullQuestionsMap[String(qId)];
        return fullQ ? { ...q, ...fullQ } : q; 
    });

    document.body.style.cursor = 'default';
    return hydratedPool;
}

window.startInstantPractice = async function(encodedPath) {
    if (currentMode === 'exam') {
        return alert("To take an Exam, please check the box and use the Start Exam button at the bottom to set a timer.");
    }

    const pathArr = JSON.parse(decodeURIComponent(encodedPath));
    
    let sourcePool = activeCustomPool;
    if (currentView !== 'book') {
        const chunks = await fetchRequiredChunks(currentView, [pathArr]);
        sourcePool = chunks.length > 0 ? chunks : globalMetadata;
    }
    
    let finalPool = sourcePool.filter(q => getQuestionCount(currentView, pathArr, [q]) > 0);
    
    if (finalPool.length === 0) return alert("No unattempted questions left in this topic!");
    
    const qCountInputEl = document.getElementById('exam-q-count');
    if (qCountInputEl) {
        const qCountInput = parseInt(qCountInputEl.value);
        if (qCountInput && qCountInput > 0 && qCountInput < finalPool.length) {
            finalPool = finalPool.sort(() => 0.5 - Math.random()).slice(0, qCountInput);
        }
    }
    
    const generatedTitle = generateExamTitle([pathArr], currentView);
    finalPool = await hydrateQuestions(finalPool);
    window.launchQuiz(finalPool, 'practice', 0, generatedTitle);
};

window.launchQuiz = async function (questionsArray, mode = 'practice', timerMinutes = 0, examName = "Practice Session") {
    if (!questionsArray || questionsArray.length === 0) {
        alert("No questions found for this selection!");
        return;
    }

    const roomId = localStorage.getItem('active_study_room');
    const isGuest = localStorage.getItem('is_study_guest') === 'true';

    let safeStorageArray = questionsArray;
    if (safeStorageArray.length > 200) {
        alert(`Your selection has ${questionsArray.length} questions. Capping to 200 to prevent browser crashes.`);
        safeStorageArray = safeStorageArray.sort(() => 0.5 - Math.random()).slice(0, 200);
    }

    const cleanPool = JSON.parse(JSON.stringify(safeStorageArray));

    if (roomId && !isGuest) {
        try {
            document.body.style.cursor = 'wait';
            let roomPool = cleanPool;
            if (roomPool.length > 50) roomPool = roomPool.slice(0, 50);

await setDoc(doc(db, "study_rooms", roomId), {
                questions: roomPool,
                quizConfig: { mode, timer: timerMinutes, examName },
                status: 'playing',
                currentQuestionIndex: 0,
                answers: {},
                memberAnswers: {},
                forceReveal: {},
                hostId: auth.currentUser ? auth.currentUser.uid : null
            }, { merge: true });
        } catch (error) {
            console.error("Failed to sync room:", error);
            alert("Firebase Error: " + error.message);
            document.body.style.cursor = 'default';
            return;
        }
    }

    const staleKeys = [
        'edeetos_saved_quiz_state',
        'edeetos_quiz_state',
        'edeetos_exam_progress',
        'edeetos_active_quiz_session',
        'quiz_in_progress',
        'edeetos_active_quiz' 
    ];
    
    staleKeys.forEach(key => {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
    });

    localStorage.setItem('edeetos_quiz_config', JSON.stringify({ mode: mode, timer: timerMinutes, examName: examName }));

    document.body.style.cursor = 'wait';
    
    const idbRequest = indexedDB.open("EdeetosDB", 1);

    idbRequest.onupgradeneeded = (e) => {
        const idb = e.target.result;
        if (!idb.objectStoreNames.contains("quiz_sessions")) {
            idb.createObjectStore("quiz_sessions");
        }
    };

    idbRequest.onsuccess = (e) => {
        const idb = e.target.result;
        const tx = idb.transaction("quiz_sessions", "readwrite");
        const store = tx.objectStore("quiz_sessions");

        store.put(cleanPool, "active_quiz_queue");

        try {
            store.delete("active_quiz_state");
            store.delete("saved_session");
        } catch (err) {}

        tx.oncomplete = () => {
            document.body.style.cursor = 'default';
            window.location.href = 'quiz.html';
        };

        tx.onerror = () => {
            document.body.style.cursor = 'default';
            window.location.href = 'quiz.html';
        };
    };

    idbRequest.onerror = () => {
        document.body.style.cursor = 'default';
        window.location.href = 'quiz.html';
    };
};

function generateExamTitle(paths, currentView) {
    if (!paths || paths.length === 0) return "Custom Practice";
    
    const topLevels = new Set();
    const subLevels = new Set();
    
    paths.forEach(p => {
        if (p[0]) topLevels.add(p[0]); 
        if (p[1]) subLevels.add(p[1]); 
    });
    
    const topArr = Array.from(topLevels);
    const subArr = Array.from(subLevels);

    if (currentView === 'exam') {
        if (topArr.length === 1) {
            if (subArr.length === 0) return `${topArr[0]} (All Papers)`;
            return `${topArr[0]} -${subArr.join(" + ")}`; 
        } else {
            return subArr.length > 0 ? subArr.join(" + ") : topArr.join(" + "); 
        }
    }
    if (topArr.length === 1) {
        if (subArr.length > 3 || subArr.length === 0) return `${topArr[0]} (Full)`;
        else return `${topArr[0]} -${subArr.join(" + ")}`;
    } else {
        if (topArr.length <= 3) return topArr.join(" + ");
        else return `Mixed Session (${topArr.length} Topics)`;
    }
}

// ==========================================
// 10. MULTIPLAYER & STUDY ROOMS
// ==========================================
const activeRoomId = localStorage.getItem('active_study_room');
const isGuest = localStorage.getItem('is_study_guest') === 'true';

if (activeRoomId) {
    if (isGuest) {
        localStorage.removeItem('active_study_room');
        localStorage.removeItem('is_study_guest');
    } else {
        const hostBanner = document.createElement('div');
        hostBanner.style.cssText = "background: rgba(245, 158, 11, 0.2); border-bottom: 1px solid rgba(245, 158, 11, 0.4); color: #fde68a; padding: 12px 20px; font-weight: bold; position: sticky; top: 0; z-index: 99999; backdrop-filter: blur(10px); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;";
        
        hostBanner.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <i class="fas fa-users"></i> 
                <span>You are hosting Study Room <strong style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; letter-spacing: 1px; border: 1px solid rgba(255,255,255,0.2);">${activeRoomId}</strong>. Select a topic and click Start to resume.</span>
            </div>
            <button id="btn-exit-host-room" class="action-btn" style="background: rgba(239, 68, 68, 0.2); border-color: rgba(239, 68, 68, 0.5); color: #fca5a5; padding: 6px 16px;">Exit Room</button>
        `;
        document.body.prepend(hostBanner);

        document.getElementById('btn-exit-host-room').addEventListener('click', () => {
            const exitModal = document.createElement('div');
            exitModal.id = 'host-exit-modal';
            exitModal.className = "popup-overlay";
            exitModal.style.display = "flex";
            exitModal.innerHTML = `
                <div class="glass-panel popup-content text-center" style="max-width: 450px; width: 90%;">
                    <i class="fas fa-sign-out-alt" style="color: #fca5a5; font-size: 3rem; margin-bottom: 1rem;"></i>
                    <h2 class="modal-title-blue" style="margin-top: 0; margin-bottom: 10px;">Exit Study Room</h2>
                    <p class="modal-subtitle" style="margin-bottom: 20px;">You are the host of Room <strong style="color: #f8fafc;">${activeRoomId}</strong>. Do you want to just leave the room, or end the session completely and kick all guests?</p>
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        <button id="btn-leave-only" class="action-btn" style="border-color: rgba(245, 158, 11, 0.4); color: #fcd34d; background: rgba(245, 158, 11, 0.1);">🚶‍♂️ Just Leave (Keep Room Active)</button>
                        <button id="btn-end-room" class="action-btn" style="background: rgba(239, 68, 68, 0.2); border-color: rgba(239, 68, 68, 0.5); color: #fca5a5;">🛑 End Room & Kick Everyone</button>
                        <button id="btn-cancel-exit" class="btn-text-muted" style="margin-top: 5px;">Cancel</button>
                    </div>
                </div>
            `;
            document.body.appendChild(exitModal);

            document.getElementById('btn-cancel-exit').onclick = () => exitModal.remove();

            document.getElementById('btn-leave-only').onclick = async () => {
                const btn = document.getElementById('btn-leave-only');
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Leaving...';
                btn.disabled = true;
                
                try {
                    if (auth.currentUser) {
                        await updateDoc(doc(db, "study_rooms", activeRoomId), {
                            [`activeMembers.${auth.currentUser.uid}`]: deleteField()
                        });
                    }
                } catch(e) {
                    console.warn("Could not sync departure to Firebase:", e);
                }
                
                localStorage.removeItem('active_study_room');
                localStorage.removeItem('is_study_guest');
                hostBanner.remove();
                exitModal.remove();
            };

            document.getElementById('btn-end-room').onclick = async () => {
                const btn = document.getElementById('btn-end-room');
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Ending...';
                btn.disabled = true;
                
                try {
                    await updateDoc(doc(db, "study_rooms", activeRoomId), { status: 'ended' });
                } catch(e) {
                    console.warn("Could not sync room closure to Firebase:", e);
                }
                
                localStorage.removeItem('active_study_room');
                localStorage.removeItem('is_study_guest');
                hostBanner.remove();
                exitModal.remove();
            };
        });
    }
}

// ==========================================
// 11. SMART ANALYTICS ENGINE
// ==========================================
const btnAnalytics = document.getElementById('btn-view-analytics');
if (btnAnalytics) {
    btnAnalytics.onclick = () => {
        if (localStorage.getItem('edeetos_guest_mode') === 'true') {
            return alert("Please register an account to view detailed Analytics.");
        }
        const body = document.getElementById('analytics-body');

        let stats = {};
        const allMistakes = [...new Set([...globalPracticeMistakes, ...globalExamMistakes])];
        const allMistakesSet = new Set(allMistakes);
        const attemptedSet = new Set(attemptedQuestions);

        globalMetadata.forEach(q => {
            const topicName = q.Topic || q.topic || q.Chapter || q.chapter || q.Subject || q.subject || "Core Material";
            const qId = getQID(q);
            
            if (!stats[topicName]) {
                stats[topicName] = { total: 0, attempted: 0, mistakes: 0, questions: [] };
            }
            
            stats[topicName].total++;
            stats[topicName].questions.push(q);

            const isAttempted = attemptedSet.has(qId) || allMistakesSet.has(qId);
            const isMistake = allMistakesSet.has(qId);

            if (isAttempted) {
                stats[topicName].attempted++;
                if (isMistake) stats[topicName].mistakes++;
            }
        });

        let processedTopics = Object.keys(stats).map(topic => {
            const d = stats[topic];
            return {
                topic: topic,
                attempted: d.attempted,
                mistakes: d.mistakes,
                accuracy: d.attempted > 0 ? Math.round(((d.attempted - d.mistakes) / d.attempted) * 100) : 0,
                pool: d.questions
            };
        }).filter(t => t.attempted >= 3);

        let weaknesses = processedTopics.filter(t => t.accuracy < 70).sort((a, b) => a.accuracy - b.accuracy || b.mistakes - a.mistakes).slice(0, 4);
        let strengths = processedTopics.filter(t => t.accuracy >= 70).sort((a, b) => b.accuracy - a.accuracy).slice(0, 4);

        let html = ``;

        if (processedTopics.length === 0) {
            html += `
                <div style="text-align: center; padding: 30px 10px;">
                    <i class="fas fa-chart-pie" style="font-size: 3rem; color: #64748b; margin-bottom: 15px;"></i>
                    <h3 style="color: #94a3b8; margin-bottom: 5px;">Not Enough Data</h3>
                    <p style="color: #cbd5e1; font-size: 0.9rem;">Answer at least 3 questions in any topic to unlock your Smart Performance Dashboard.</p>
                </div>
            `;
        } else {
            html += `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 15px; margin-bottom: 25px;">`;
            
            html += `<div class="glass-panel" style="background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.3); padding: 15px;">
                        <h4 style="color:#fca5a5; margin-top: 0; margin-bottom: 15px; border-bottom: 1px solid rgba(239,68,68,0.3); padding-bottom: 5px;"><i class="fas fa-exclamation-triangle" style="margin-right: 5px;"></i> Priority Review</h4>`;
            if (weaknesses.length === 0) {
                html += `<div style="color: #6ee7b7; font-weight: bold; font-size: 0.85rem;"><i class="fas fa-check"></i> No critical weaknesses!</div>`;
            } else {
                weaknesses.forEach(w => {
                    html += `
                        <div style="margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid rgba(239,68,68,0.2);">
                            <div style="display:flex; justify-content:space-between; font-size:0.85rem; font-weight: bold; color: #f87171;">
                                <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 70%;">${w.topic}</span>
                                <span>${w.accuracy}%</span>
                            </div>
                            <div style="font-size: 0.75rem; color: #fca5a5; margin-top: 4px;">${w.mistakes} mistakes / ${w.attempted} attempts</div>
                        </div>`;
                });
            }
            html += `</div>`;

            html += `<div class="glass-panel" style="background: rgba(16, 185, 129, 0.1); border-color: rgba(16, 185, 129, 0.3); padding: 15px;">
                        <h4 style="color:#6ee7b7; margin-top: 0; margin-bottom: 15px; border-bottom: 1px solid rgba(16,185,129,0.3); padding-bottom: 5px;"><i class="fas fa-star" style="color: #34d399; margin-right: 5px;"></i> Top Strengths</h4>`;
            if (strengths.length === 0) {
                html += `<div style="color: #94a3b8; font-size: 0.85rem;">Keep practicing to build your strengths!</div>`;
            } else {
                strengths.forEach(s => {
                    html += `
                        <div style="margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid rgba(16,185,129,0.2);">
                            <div style="display:flex; justify-content:space-between; font-size:0.85rem; font-weight: bold; color: #34d399;">
                                <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 70%;">${s.topic}</span>
                                <span>${s.accuracy}%</span>
                            </div>
                            <div style="font-size: 0.75rem; color: #a7f3d0; margin-top: 4px;">Mastered ${s.attempted - s.mistakes} / ${s.attempted}</div>
                        </div>`;
                });
            }
            html += `</div></div>`;

            html += `
                <h4 style="color:#93c5fd; border-bottom:1px solid rgba(59,130,246,0.3); padding-bottom:5px; margin-top: 0; margin-bottom: 15px;"><i class="fas fa-dumbbell" style="margin-right: 8px; color: #60a5fa;"></i> Smart Training Hub</h4>
                <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 25px;">
            `;

            const totalMistakesCount = allMistakes.length;
            if (totalMistakesCount > 0) {
                html += `<button id="btn-train-redemption" class="action-btn" style="background: rgba(245, 158, 11, 0.2); border-color: rgba(245, 158, 11, 0.4); color: #fde68a; text-align: left; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                            <span style="font-weight: bold; font-size: 0.95rem; flex: 1; min-width: 150px;"><i class="fas fa-sync-alt" style="margin-right: 8px;"></i> Redemption Mode</span>
                            <span style="font-size: 0.75rem; background: rgba(0,0,0,0.3); padding: 3px 8px; border-radius: 12px; white-space: nowrap;">Revisit ${totalMistakesCount} Mistakes</span>
                         </button>`;
            }

            if (weaknesses.length > 0) {
                html += `<button id="btn-train-focus" class="action-btn" style="background: rgba(239, 68, 68, 0.2); border-color: rgba(239, 68, 68, 0.4); color: #fca5a5; text-align: left; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                            <span style="font-weight: bold; font-size: 0.95rem; flex: 1; min-width: 150px;"><i class="fas fa-bullseye" style="margin-right: 8px;"></i> Targeted Focus</span>
                            <span style="font-size: 0.75rem; background: rgba(0,0,0,0.3); padding: 3px 8px; border-radius: 12px; white-space: nowrap;">Drill 15 Qs on Weakest Topic</span>
                         </button>`;
            }

            if (strengths.length > 0 && weaknesses.length > 0) {
                html += `<button id="btn-train-mix" class="action-btn" style="background: rgba(59, 130, 246, 0.2); border-color: rgba(59, 130, 246, 0.4); color: #bfdbfe; text-align: left; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                            <span style="font-weight: bold; font-size: 0.95rem; flex: 1; min-width: 150px;"><i class="fas fa-balance-scale" style="margin-right: 8px;"></i> Balanced Mix</span>
                            <span style="font-size: 0.75rem; background: rgba(0,0,0,0.3); padding: 3px 8px; border-radius: 12px; white-space: nowrap;">30 Qs (Strengths + Weaknesses)</span>
                         </button>`;
            }

            html += `</div>`;
        }

        html += `<h4 class="modal-section-title"><i class="fas fa-history" style="margin-right: 5px;"></i> Recent Exams</h4>`;
        if (userExamHistory.length === 0) {
            html += `<p style="font-size:0.8rem; color:#94a3b8; text-align:center;">No exams taken yet.</p>`;
        } else {
            html += `<div style="width: 100%; height: 200px; margin-bottom: 20px;"><canvas id="examScoreChart"></canvas></div>`;
            html += `<div style="font-size:0.85rem; max-height:180px; overflow-y:auto;">
                        <table style="width:100%; text-align:left; border-collapse: collapse; table-layout: fixed;">
                            <thead>
                                <tr style="color: #64748b; font-weight: bold; border-bottom: 1px solid rgba(255,255,255,0.2);">
                                    <th style="padding: 10px 0; width: 25%;">Date</th>
                                    <th style="width: 40%;">Exam Name</th>
                                    <th style="width: 15%;">Score</th>
                                    <th style="width: 20%;">Time</th>
                                </tr>
                            </thead>
                            <tbody>`;
                        
            userExamHistory.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10).forEach(ex => {
                const totalSecs = ex.timeSpent || 0;
                const totalQs = ex.totalQuestions || 1;
                const avgSecs = Math.round(totalSecs / totalQs);
                const avgMins = Math.floor(avgSecs / 60);
                const remainSecs = (avgSecs % 60).toString().padStart(2, '0');
                const timeString = totalSecs > 0 ? `${avgMins}m ${remainSecs}s` : "N/A";
                
                html += `<tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
                            <td style="padding:10px 0; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${new Date(ex.date).toLocaleDateString()}</td>
                            <td style="color: #f8fafc; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${ex.examName}</td>
                            <td style="color:${ex.percentage >= 75 ? '#34d399' : '#f87171'}; font-weight:bold;">${ex.percentage}%</td>
                            <td style="color: #94a3b8; font-weight: 500;">${timeString}</td>
                         </tr>`;
            });
            html += `</tbody></table></div>`;
        }

        if (body) body.innerHTML = html;
        const analyticsModal = document.getElementById('analytics-modal');
        if (analyticsModal) analyticsModal.style.display = 'flex';

        if (userExamHistory.length > 0) {
            const ctx = document.getElementById('examScoreChart');
            if (ctx) {
                if (window.examChartInstance) window.examChartInstance.destroy();
                
                const recentExams = userExamHistory.slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date)) // Sort newest first
    .slice(0, 10) // Grab the 10 most recent
    .reverse(); // Flip it so the chart reads left-to-right (oldest to newest)
                const labels = recentExams.map(ex => new Date(ex.date).toLocaleDateString(undefined, {month: 'short', day: 'numeric'}));
                const scores = recentExams.map(ex => ex.percentage);

                window.examChartInstance = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Exam Score (%)',
                            data: scores,
                            borderColor: '#60a5fa',
                            backgroundColor: 'rgba(96, 165, 250, 0.2)',
                            borderWidth: 2,
                            fill: true,
                            tension: 0.3,
                            pointBackgroundColor: '#34d399',
                            pointRadius: 4
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: { 
                            y: { 
                                beginAtZero: true, 
                                max: 100, 
                                grid: { color: 'rgba(255,255,255,0.1)' },
                                ticks: { color: '#cbd5e1' }
                            },
                            x: {
                                grid: { color: 'rgba(255,255,255,0.1)' },
                                ticks: { color: '#cbd5e1' }
                            }
                        },
                        plugins: { legend: { display: false } }
                    }
                });
            }
        }

        const btnRedemption = document.getElementById('btn-train-redemption');
        if (btnRedemption) {
            btnRedemption.onclick = async () => {
                btnRedemption.textContent = "Loading...";
                let pool = globalMetadata.filter(q => allMistakes.includes(getQID(q))).sort(() => 0.5 - Math.random());
                if (pool.length > 50) pool = pool.slice(0, 50); 
                pool = await hydrateQuestions(pool);
                window.launchQuiz(pool, 'practice', 0, "Redemption Mode");
            };
        }

        const btnFocus = document.getElementById('btn-train-focus');
        if (btnFocus) {
            btnFocus.onclick = async () => {
                btnFocus.textContent = "Loading...";
                const worstTopic = weaknesses[0]; 
                let pool = worstTopic.pool.filter(q => !attemptedQuestions.includes(getQID(q)) || allMistakes.includes(getQID(q)));
                if (pool.length === 0) pool = worstTopic.pool; 
                
                pool = pool.sort(() => 0.5 - Math.random()).slice(0, 15);
                pool = await hydrateQuestions(pool);
                window.launchQuiz(pool, 'practice', 0, `Targeted Focus: ${worstTopic.topic}`);
            };
        }

        const btnMix = document.getElementById('btn-train-mix');
        if (btnMix) {
            btnMix.onclick = async () => {
                btnMix.textContent = "Loading...";
                let mixPool = [];
                
                weaknesses.slice(0, 2).forEach(w => {
                    let q = w.pool.filter(q => !attemptedQuestions.includes(getQID(q)) || allMistakes.includes(getQID(q)));
                    mixPool.push(...q.sort(() => 0.5 - Math.random()).slice(0, 10)); 
                });

                strengths.slice(0, 2).forEach(s => {
                    let q = s.pool.filter(q => !attemptedQuestions.includes(getQID(q)));
                    if (q.length === 0) q = s.pool; 
                    mixPool.push(...q.sort(() => 0.5 - Math.random()).slice(0, 5)); 
                });

                mixPool = mixPool.sort(() => 0.5 - Math.random());
                mixPool = await hydrateQuestions(mixPool);
                window.launchQuiz(mixPool, 'practice', 0, "Balanced Mix (30 Qs)");
            };
        }
    };
}

const closeAnalytics = document.getElementById('close-analytics');
if (closeAnalytics) closeAnalytics.onclick = () => {
    const modal = document.getElementById('analytics-modal');
    if (modal) modal.style.display = 'none';
};

// ==========================================
// 12. REVISIONS & SPACED REPETITION
// ==========================================
window.generateRevisionQuiz = async function(topicIdsArray, intervalDay) {
    if (!topicIdsArray || topicIdsArray.length === 0) {
        return alert("Invalid revision topics.");
    }

    let combinedPool = [];
    const currentActiveCourse = localStorage.getItem('edeetos_active_course') || 'fcps_part1';

    document.body.style.cursor = 'wait';

    try {
        for (let topicId of topicIdsArray) {
            let subject, chapter, topic, sourceName;
            const parts = topicId.split('::');
            
            if (parts.length >= 4) {
                subject = parts[0]; chapter = parts[1]; topic = parts[2]; sourceName = parts[3];
            } else {
                const oldParts = topicId.split('_');
                sourceName = oldParts.pop(); topic = oldParts.pop() || ''; chapter = oldParts.pop() || ''; subject = oldParts.join('_') || '';
            }

            const isBookRevision = (sourceName !== currentActiveCourse);

            if (isBookRevision) {
                const book = availableBooks.find(b => b.file === sourceName);
                if (book && !loadedBooksCache[book.file]) {
                    const response = await fetch(`Books/${book.file}_questions.json`, { cache: 'no-cache' });
                    if (response.ok) {
                        let bookQuestions = await response.json();
                        bookQuestions.forEach(q => {
                            q.QuestionID = q.id; q.Subject = book.title; q.Chapter = q.chapter; q.Topic = q.topic;
                            q.Exam = q.exams; q.Year = q.year; q.isBookQuestion = true; q.bookName = book.file;
                        });
                        loadedBooksCache[book.file] = bookQuestions;
                        allQuestions = allQuestions.filter(q => q.bookName !== book.file);
                        allQuestions.push(...bookQuestions);
                    }
                }
            }

            const searchSource = isBookRevision ? loadedBooksCache[sourceName] : globalMetadata;
            const topicPool = searchSource.filter(q => {
                const qSubject = q.Subject || q.subject || '';
                const qChapter = q.Chapter || q.chapter || '';
                const qTopic = q.Topic || q.topic || '';
                const qIsBook = q.isBookQuestion || false;
                
                return (
                    qSubject.trim().toLowerCase() === subject.trim().toLowerCase() &&
                    qChapter.trim().toLowerCase() === chapter.trim().toLowerCase() &&
                    qTopic.trim().toLowerCase() === topic.trim().toLowerCase() &&
                    (isBookRevision ? qIsBook : !qIsBook)
                );
            });

            combinedPool.push(...topicPool);
        }
    } catch (e) {
        console.error(e);
    } finally {
        document.body.style.cursor = 'default';
    }

    const uniqueIds = new Set();
    combinedPool = combinedPool.filter(q => {
        const id = getQID(q);
        if (uniqueIds.has(id)) return false;
        uniqueIds.add(id);
        return true;
    });

    if (combinedPool.length === 0) return alert("No questions available for this revision.");

    const allMistakes = [...new Set([...globalPracticeMistakes, ...globalExamMistakes])];
    let weakPool = [];
    let strongPool = [];
    let untouchedPool = [];

    combinedPool.forEach(q => {
        const qId = getQID(q);
        if (allMistakes.includes(qId)) weakPool.push(q);
        else if (attemptedQuestions.includes(qId)) strongPool.push(q);
        else untouchedPool.push(q);
    });

    weakPool = weakPool.sort(() => 0.5 - Math.random());
    strongPool = strongPool.sort(() => 0.5 - Math.random());
    untouchedPool = untouchedPool.sort(() => 0.5 - Math.random());

    let finalQuiz = [];
    const MAX_QUESTIONS = 40;
    let weakTarget, strongTarget;

    if (intervalDay <= 7) {
        weakTarget = Math.round(MAX_QUESTIONS * 0.70);
        strongTarget = Math.round(MAX_QUESTIONS * 0.30);
    } else {
        weakTarget = Math.round(MAX_QUESTIONS * 0.30);
        strongTarget = Math.round(MAX_QUESTIONS * 0.70);
    }

    finalQuiz.push(...weakPool.slice(0, weakTarget));
    finalQuiz.push(...strongPool.slice(0, strongTarget));

    if (finalQuiz.length < 15) {
        const remaining = combinedPool.filter(q => !finalQuiz.includes(q));
        finalQuiz.push(...remaining.sort(() => 0.5 - Math.random()).slice(0, 15 - finalQuiz.length));
    }

    finalQuiz = [...new Set(finalQuiz)].sort(() => 0.5 - Math.random());

    if (finalQuiz.length === 0) return alert("Not enough data to generate revision.");

    finalQuiz = await hydrateQuestions(finalQuiz);
    window.launchQuiz(finalQuiz, 'practice', 0, `Day ${intervalDay} Spaced Revision`);
};

// ==========================================
// 13. TROPHIES & MILESTONES
// ==========================================
const btnJourney = document.getElementById('btn-view-journey');
const journeyModal = document.getElementById('journey-modal');
const closeJourneyBtn = document.getElementById('close-journey-btn');
const trophiesGrid = document.getElementById('trophies-grid');

const trophies = [
    { title: "Novice", req: 10, icon: "👶", rewardValue: 1, rewardUnit: "Hour" },
    { title: "Bronze", req: 100, icon: "🥉", rewardValue: 1, rewardUnit: "Day" },
    { title: "Silver", req: 500, icon: "🥈", rewardValue: 3, rewardUnit: "Days" },
    { title: "Gold", req: 1000, icon: "🥇", rewardValue: 7, rewardUnit: "Days" },
    { title: "Diamond", req: 2000, icon: "💎", rewardValue: 14, rewardUnit: "Days" },
    { title: "Master", req: 5000, icon: "👑", rewardValue: 21, rewardUnit: "Days" }
];

let cumulativeSum = 0;
const processedTrophies = trophies.map((t) => {
    const previousCum = cumulativeSum;
    cumulativeSum += t.req;
    return { ...t, cumulativeReq: cumulativeSum, previousCum: previousCum };
});

function checkMilestones(currentFlawless) {
    if (localStorage.getItem('edeetos_guest_mode') === 'true') return;

    const storageKey = `edeetos_unlocked_tiers_${auth.currentUser?.uid || 'user'}`;
    let unlockedTiers = JSON.parse(localStorage.getItem(storageKey)) || [];
    
    const dbClaimed = currentUserData?.claimedMilestones || [];

    const newlyUnlocked = processedTrophies.filter(t => 
        currentFlawless >= t.cumulativeReq && 
        !unlockedTiers.includes(t.title) &&
        !dbClaimed.includes(t.title) 
    );

    if (newlyUnlocked.length > 0) {
        let unclaimed = JSON.parse(localStorage.getItem('edeetos_unclaimed_rewards')) || [];
        
        newlyUnlocked.forEach(t => {
            unlockedTiers.push(t.title);
            if (!unclaimed.some(u => u.title === t.title)) {
                unclaimed.push(t);
            }
        });
        
        localStorage.setItem(storageKey, JSON.stringify(unlockedTiers));
        localStorage.setItem('edeetos_unclaimed_rewards', JSON.stringify(unclaimed));
        
        showMilestonePopup(newlyUnlocked[0]);
    }
}

function removeUnclaimedReward(title) {
    let unclaimed = JSON.parse(localStorage.getItem('edeetos_unclaimed_rewards')) || [];
    unclaimed = unclaimed.filter(t => t.title !== title);
    localStorage.setItem('edeetos_unclaimed_rewards', JSON.stringify(unclaimed));
}

function showMilestonePopup(trophy) {
    const existing = document.getElementById('milestone-reward-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'milestone-reward-modal';
    modal.className = 'popup-overlay';
    modal.style.display = 'flex';
    
    let subStatus = "free";
    const currentSub = currentUserData?.subscriptions?.[activeCourse] || currentUserData?.subscriptions?.['ALL'];
    
    if (currentSub === 'lifetime') {
        subStatus = 'lifetime';
    } else if (currentSub && new Date(currentSub) > new Date()) {
        subStatus = 'active';
    }

    const isLifetime = subStatus === 'lifetime';
    const courseOptionsHtml = `<option value="${activeCourse}" selected>${activeCourse.toUpperCase().replace('_', ' ')}</option>`;

    let claimableBooksCount = 0;
    const bookOptionsHtml = availableBooks.map(b => {
        const hasLifetimeBook = currentUserData?.subscriptions?.[b.file] === 'lifetime';
        if (hasLifetimeBook) {
            return `<option value="${b.file}" disabled>✅ ${b.title} (Owned)</option>`;
        }
        claimableBooksCount++;
        return `<option value="${b.file}">${b.title}</option>`;
    }).join('');

    const allBooksOwned = claimableBooksCount === 0;

    let rewardOptionsHtml = '';
    if (trophy.rewardValue > 0) {
        
        if (isLifetime && allBooksOwned) {
            rewardOptionsHtml = `
                <div style="margin-top: 15px; text-align: center; background: rgba(16, 185, 129, 0.15); padding: 15px; border-radius: 8px; border: 1px solid rgba(16, 185, 129, 0.3);">
                    <div style="color: #34d399; font-weight: bold; font-size: 0.95rem;">✅ You already own all available content!</div>
                    <p style="font-size: 0.8rem; color: #a7f3d0; margin-top: 5px;">There are no more rewards to claim. Amazing job!</p>
                </div>
            `;
        } else {
            rewardOptionsHtml = `
                <div style="margin-top: 15px; text-align: left; background: rgba(255, 255, 255, 0.05); padding: 15px; border-radius: 8px;">
                    <p style="font-size: 0.95rem; color: #93c5fd; margin-bottom: 15px; font-weight: bold;">Choose ONE Reward:</p>
                    
                    <div style="display: flex; flex-direction: column; gap: 15px; margin-bottom: 20px;">
                        
                        ${!isLifetime ? `
                        <div style="background: rgba(0, 0, 0, 0.2); border: 1px solid rgba(255, 255, 255, 0.2); padding: 12px; border-radius: 8px;">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: bold; color: #f8fafc; margin-bottom: 8px;">
                                <input type="radio" name="rewardChoice" value="course" checked style="transform: scale(1.2);"> 
                                Extend Course Access (+${trophy.rewardValue}${trophy.rewardUnit})
                            </label>
                            <div id="course-selection-div" style="padding-left: 24px; transition: 0.3s;">
                                <select id="reward-course-selection" class="glass-input" style="padding: 10px;">
                                    ${courseOptionsHtml}
                                </select>
                            </div>
                        </div>
                        ` : '<div style="color: #6ee7b7; font-weight: bold; font-size: 0.85rem; padding: 10px; background: rgba(16, 185, 129, 0.1); border-radius: 8px; border: 1px solid rgba(16, 185, 129, 0.2);">✅ You have Lifetime Course Access.</div>'}
                        
                        ${!allBooksOwned ? `
                        <div style="background: rgba(0, 0, 0, 0.2); border: 1px solid rgba(255, 255, 255, 0.2); padding: 12px; border-radius: 8px; ${isLifetime ? '' : 'opacity: 0.6;'} transition: 0.3s;" id="book-container-div">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: bold; color: #f8fafc; margin-bottom: 8px;">
                                <input type="radio" name="rewardChoice" value="book" ${isLifetime ? 'checked' : ''} style="transform: scale(1.2);">
                                Claim a Study Book (+${trophy.rewardValue}${trophy.rewardUnit})
                            </label>
                            <div id="book-selection-div" style="padding-left: 24px; ${isLifetime ? '' : 'pointer-events: none;'} transition: 0.3s;">
                                <select id="reward-book-selection" class="glass-input" style="padding: 10px;">
                                    <option value="" disabled selected>Select a Study Book...</option>
                                    ${bookOptionsHtml}
                                </select>
                            </div>
                        </div>
                        ` : '<div style="color: #6ee7b7; font-weight: bold; font-size: 0.85rem; padding: 10px; background: rgba(16, 185, 129, 0.1); border-radius: 8px; border: 1px solid rgba(16, 185, 129, 0.2);">✅ You own all available Books.</div>'}

                    </div>

                    <button id="btn-confirm-reward" class="action-btn next-btn w-100" style="padding: 12px; font-size: 1rem;">
                        Claim Selected Reward
                    </button>
                </div>
            `;
        }
    }

modal.innerHTML = `
        <div class="glass-panel popup-content text-center" style="max-width: 380px; width: 90%; padding: 1.5rem;">
            <div style="font-size: 3rem; margin-bottom: 5px; line-height: 1;">${trophy.icon}</div>
            <h2 class="modal-title-blue" style="margin-bottom: 5px; font-size: 1.5rem;">Milestone Reached!</h2>
            <p class="modal-subtitle" style="margin-bottom: 10px; font-size: 0.85rem;">You achieved the <strong style="color: #f8fafc;">${trophy.title}</strong> rank by completing ${trophy.req} flawless questions!</p>
            ${rewardOptionsHtml}
            <button id="close-milestone-btn" class="action-btn w-100" style="margin-top: 10px; padding: 0.8rem;">Dismiss</button>
        </div>
    `;
    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('#close-milestone-btn');
    
    if (isLifetime && allBooksOwned) {
        closeBtn.onclick = () => {
            removeUnclaimedReward(trophy.title);
            modal.remove();
        };
    } else {
        closeBtn.onclick = () => {
            modal.remove();
        };
    }

    if (trophy.rewardValue > 0 && !(isLifetime && allBooksOwned)) {
        const radios = modal.querySelectorAll('input[name="rewardChoice"]');
        const courseDiv = modal.querySelector('#course-selection-div');
        const bookContainerDiv = modal.querySelector('#book-container-div');
        const bookDiv = modal.querySelector('#book-selection-div');

        radios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.value === 'course') {
                    if (courseDiv) { courseDiv.parentElement.style.opacity = '1'; courseDiv.style.pointerEvents = 'auto'; }
                    if (bookContainerDiv) { bookContainerDiv.style.opacity = '0.6'; bookDiv.style.pointerEvents = 'none'; }
                } else {
                    if (courseDiv) { courseDiv.parentElement.style.opacity = '0.6'; courseDiv.style.pointerEvents = 'none'; }
                    if (bookContainerDiv) { bookContainerDiv.style.opacity = '1'; bookDiv.style.pointerEvents = 'auto'; }
                }
            });
        });

        const btnConfirm = modal.querySelector('#btn-confirm-reward');
        if (btnConfirm) {
            btnConfirm.onclick = async () => {
                const selectedType = modal.querySelector('input[name="rewardChoice"]:checked')?.value || (isLifetime ? 'book' : 'course');
                
                btnConfirm.textContent = "Processing...";
                btnConfirm.disabled = true;

                try {
                if (selectedType === 'course') {
                    const targetCourse = modal.querySelector('#reward-course-selection').value;
                    await grantSubscriptionReward(trophy.rewardValue, trophy.rewardUnit, targetCourse, trophy.title);
                } else {
                    const selectedBook = modal.querySelector('#reward-book-selection').value;
                    if (!selectedBook) {
                        btnConfirm.textContent = "Claim Selected Reward";
                        btnConfirm.disabled = false;
                        return alert("You must select a book from the dropdown first.");
                    }
                    await claimBookReward(trophy.rewardValue, trophy.rewardUnit, trophy.title, selectedBook);
                    }
                    
                    removeUnclaimedReward(trophy.title);
                    modal.remove();
                    
                } catch (err) {
                    btnConfirm.textContent = "Claim Selected Reward";
                    btnConfirm.disabled = false;
                }
            };
        }
    }
}

async function grantSubscriptionReward(rewardValue, rewardUnit, targetCourse, milestoneTitle) {
    try {
        if (!auth?.currentUser?.uid) return alert("Authentication error: Session lost.");

        const userRef = doc(db, "users", auth.currentUser.uid);
        
        let currentSubs = currentUserData?.subscriptions ? { ...currentUserData.subscriptions } : {};
        let currentExpiry = currentSubs[targetCourse];
        let newExpiryDate = new Date();

        if (currentExpiry && currentExpiry !== 'lifetime') {
            const existingDate = new Date(currentExpiry);
            if (existingDate > newExpiryDate) {
                newExpiryDate = existingDate;
            }
        }

        if (rewardUnit === "Hour") {
            newExpiryDate.setHours(newExpiryDate.getHours() + rewardValue);
        } else {
            newExpiryDate.setDate(newExpiryDate.getDate() + rewardValue);
        }

        currentSubs[targetCourse] = newExpiryDate.toISOString();

        let claimedMilestones = currentUserData?.claimedMilestones || [];
        if (!claimedMilestones.includes(milestoneTitle)) {
            claimedMilestones.push(milestoneTitle);
        }

        await updateDoc(userRef, {
            subscriptions: currentSubs,
            isPremium: true,
            claimedMilestones: claimedMilestones
        });

        if (currentUserData) {
            currentUserData.subscriptions = currentSubs;
            currentUserData.isPremium = true;
            currentUserData.claimedMilestones = claimedMilestones;
        }

        alert(`Success! Your access to ${targetCourse.replace('_', ' ').toUpperCase()} has been extended by ${rewardValue}${rewardUnit}.`);
    } catch (err) {
        console.error("Error extending sub:", err);
        alert("Firebase Error: " + err.message);
    }
}

async function claimBookReward(rewardValue, rewardUnit, trophyTitle, selectedBookFile) {
    try {
        if (!auth?.currentUser?.uid) return alert('Authentication error: Session lost.');

        const userRef = doc(db, 'users', auth.currentUser.uid);
        
        let currentSubs = currentUserData?.subscriptions ? { ...currentUserData.subscriptions } : {};
        
        let currentExpiry = currentSubs[selectedBookFile];
        let newExpiryDate = new Date();

        if (currentExpiry && currentExpiry !== 'lifetime') {
            const existingDate = new Date(currentExpiry);
            if (existingDate > newExpiryDate) {
                newExpiryDate = existingDate;
            }
        }

        if (rewardUnit === "Hour") {
            newExpiryDate.setHours(newExpiryDate.getHours() + rewardValue);
        } else {
            newExpiryDate.setDate(newExpiryDate.getDate() + rewardValue);
        }

        currentSubs[selectedBookFile] = newExpiryDate.toISOString();

        let claimedMilestones = currentUserData?.claimedMilestones || [];
        if (!claimedMilestones.includes(trophyTitle)) {
            claimedMilestones.push(trophyTitle);
        }

        await updateDoc(userRef, {
            subscriptions: currentSubs,
            claimedMilestones: claimedMilestones
        });

        if (currentUserData) {
            currentUserData.subscriptions = currentSubs;
            currentUserData.claimedMilestones = claimedMilestones;
        }

        alert(`Success! Your book is unlocked for ${rewardValue}${rewardUnit}.`);
    } catch (err) {
        console.error('Error claiming book:', err);
        alert('Firebase Error: ' + err.message);
    }
}

if (btnJourney) {
    btnJourney.onclick = () => {
        if (localStorage.getItem('edeetos_guest_mode') === 'true') {
            return alert("Please register an account to track your Journey and unlock trophies.");
        }
        
        const allMistakes = [...new Set([...globalPracticeMistakes, ...globalExamMistakes])];
        const flawlessCount = attemptedQuestions.filter(id => !allMistakes.includes(id)).length;
        
        const dbClaimed = currentUserData?.claimedMilestones || [];

        if (trophiesGrid) {
            trophiesGrid.innerHTML = processedTrophies.map(t => {
                const isUnlocked = flawlessCount >= t.cumulativeReq;
                const isClaimed = dbClaimed.includes(t.title);
                
                let progress = 0;
                if (isUnlocked) {
                    progress = t.req;
                } else if (flawlessCount > t.previousCum) {
                    progress = flawlessCount - t.previousCum;
                } else {
                    progress = 0;
                }

                const borderColor = isUnlocked ? 'rgba(245, 158, 11, 0.4)' : 'rgba(255, 255, 255, 0.1)';
                const bgColor = isUnlocked ? 'rgba(245, 158, 11, 0.1)' : 'rgba(0, 0, 0, 0.2)';
                const iconStyle = isUnlocked ? '' : 'filter: grayscale(100%) opacity(0.4);';
                const textColor = isUnlocked ? '#fde68a' : '#94a3b8';
                const statusIcon = isUnlocked ? '<i class="fas fa-check-circle" style="color: #34d399;"></i>' : '<i class="fas fa-lock" style="color: #64748b;"></i>';
                
                let rewardHtml = '';
                if (t.rewardValue > 0) {
                    if (isUnlocked && !isClaimed) {
                        rewardHtml = `<button class="action-btn claim-reward-btn" data-trophy='${JSON.stringify(t)}' style="background: rgba(16, 185, 129, 0.2); border-color: #34d399; color: #a7f3d0; padding: 6px 12px; font-size: 0.75rem; margin-top: 6px; width: 100%;"><i class="fas fa-gift"></i> Claim Reward</button>`;
                    } else if (isClaimed) {
                        rewardHtml = `<div style="font-size: 0.75rem; font-weight: bold; color: #34d399; margin-top: 6px;"><i class="fas fa-check-double"></i> Reward Claimed</div>`;
                    } else {
                        rewardHtml = `<div style="font-size: 0.75rem; font-weight: bold; color: #fcd34d; margin-top: 6px;"><i class="fas fa-gift"></i> Reward: ${t.rewardValue}${t.rewardUnit} Premium</div>`;
                    }
                }

                return `
                    <div class="glass-panel" style="display: flex; align-items: center; padding: 0.9rem; border-radius: 12px; background: ${bgColor}; border: 1px solid${borderColor};">
                        <div style="font-size: 2.2rem; margin-right: 1rem; ${iconStyle}">${t.icon}</div>
                        <div style="flex-grow: 1;">
                            <div style="font-weight: 800; color: ${textColor}; font-size: 1.05rem; margin-bottom: 0.1rem;">${t.title}</div>
                            <div style="font-size: 0.75rem; color: #cbd5e1;">${progress} / ${t.req} Flawless Qs</div>${rewardHtml}
                        </div>
                        <div style="font-size: 1.3rem;">
                            ${statusIcon}
                        </div>
                    </div>
                `;
            }).join('');

            document.querySelectorAll('.claim-reward-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const targetBtn = e.target.closest('button');
                    const trophyData = JSON.parse(targetBtn.getAttribute('data-trophy'));
                    
                    if (journeyModal) journeyModal.style.display = 'none';
                    showMilestonePopup(trophyData);
                });
            });
        }

        if (journeyModal) journeyModal.style.display = 'flex';
    };
}

if (closeJourneyBtn) {
    closeJourneyBtn.onclick = () => {
        if (journeyModal) journeyModal.style.display = 'none';
    };
}

if (journeyModal) {
    journeyModal.onclick = (e) => {
        if (e.target === journeyModal) journeyModal.style.display = 'none';
    };
}

// ==========================================
// 14. PROGRESS RESET SYSTEM
// ==========================================
const btnReset = document.getElementById('btn-reset-progress');
const resetModal = document.getElementById('reset-modal');
const closeResetModal = document.getElementById('close-reset-modal');
const optionsContainer = document.getElementById('reset-options-container');
const confirmContainer = document.getElementById('reset-confirm-container');
const btnCancelReset = document.getElementById('btn-cancel-reset');
const btnConfirmReset = document.getElementById('btn-confirm-reset');
const confirmText = document.getElementById('reset-confirm-text');

let pendingDocsToClear = [];
let pendingResetMsg = "";

if (btnReset) {
    btnReset.onclick = (e) => {
        if (e) e.preventDefault();
        toggleSidebar(false);
        optionsContainer.style.display = 'flex';
        confirmContainer.style.display = 'none';
        
        const resetTitle = resetModal.querySelector('.popup-header h3');
        if (resetTitle) resetTitle.innerHTML = `<i class="fas fa-trash-alt"></i> Reset ${currentView === 'book' ? 'Book' : 'Course'} Progress`;
        if (resetModal) resetModal.style.display = 'flex';
    };
}

if (closeResetModal) closeResetModal.onclick = () => { if (resetModal) resetModal.style.display = 'none'; };

document.querySelectorAll('.reset-option-btn').forEach(btn => {
    btn.onclick = (e) => {
        const type = btn.getAttribute('data-type'); 
        const isBook = currentView === 'book';

        switch (type) {
            case "1":
                pendingDocsToClear = ["solved", "mistakes", "bookmarks", "history", "revisions", "skipped", "stats"];
                pendingResetMsg = `All ${isBook ? 'Book' : 'Course'} progress has been fully reset!`;
                confirmText.textContent = `Are you sure you want to completely wipe ALL your progress for ${isBook ? 'Books' : 'this course'}? This cannot be undone.`;
                break;
            case "2":
                pendingDocsToClear = ["mistakes"];
                pendingResetMsg = `All ${isBook ? 'Book' : 'Course'} mistakes have been cleared!`;
                confirmText.textContent = `Are you sure you want to clear your Mistake history?`;
                break;
            case "3":
                pendingDocsToClear = ["bookmarks"];
                pendingResetMsg = `All ${isBook ? 'Book' : 'Course'} bookmarks have been cleared!`;
                confirmText.textContent = `Are you sure you want to delete all your Bookmarks?`;
                break;
            case "4":
                pendingDocsToClear = ["history"];
                pendingResetMsg = `${isBook ? 'Book' : 'Course'} Exam history has been cleared!`;
                confirmText.textContent = `Are you sure you want to delete your Past Exam scores?`;
                break;
            case "5":
                pendingDocsToClear = ["solved"];
                pendingResetMsg = `Solved ${isBook ? 'Book' : 'Course'} questions have been cleared!`;
                confirmText.textContent = `Are you sure you want to clear your Solved Questions? Your mistakes and bookmarks will remain.`;
                break;
        }

        if (optionsContainer) optionsContainer.style.display = 'none';
        if (confirmContainer) confirmContainer.style.display = 'block';
    };
});

if (btnCancelReset) {
    btnCancelReset.onclick = () => {
        if (confirmContainer) confirmContainer.style.display = 'none';
        if (optionsContainer) optionsContainer.style.display = 'flex';
    };
}

if (btnConfirmReset) {
    btnConfirmReset.onclick = async () => {
        const user = auth.currentUser;
        if (!user) return alert("You must be logged in to reset progress.");

        btnConfirmReset.textContent = "Clearing...";
        btnConfirmReset.disabled = true;

        try {
            const rootKey = currentView === 'book' ? "books" : (localStorage.getItem('edeetos_active_course') || 'fcps_part1');
            
            // Overwriting the document with an empty object efficiently wipes the arrays
            const wipePromises = pendingDocsToClear.map(docName => 
                setDoc(doc(db, "users", user.uid, rootKey, docName), {})
            );
            await Promise.all(wipePromises);

            if (confirmText) confirmText.innerHTML = `✅ ${pendingResetMsg}`;
            if (btnCancelReset) btnCancelReset.style.display = 'none';
            if (btnConfirmReset) btnConfirmReset.style.display = 'none';

            setTimeout(() => { location.reload(); }, 1500);
        } catch (err) {
            console.error("Reset Error:", err);
            if (confirmText) confirmText.textContent = "❌ Error clearing data. Check console.";
            btnConfirmReset.textContent = "Try Again";
            btnConfirmReset.disabled = false;
        }
    };
}

// ==========================================
// 15. MENTOR & ASSIGNMENT SYSTEM
// ==========================================
function initMentorFeatures() {
    if (currentUserRole === 'MENTOR' || currentUserRole === 'ADMIN' || currentUserRole === 'MANAGEMENT') {
        const startBtn = document.getElementById('start-exam-btn');
        
        if (document.getElementById('assign-exam-btn')) return;

        if (startBtn && startBtn.parentElement) {
            const assignBtn = document.createElement('button');
            assignBtn.className = "action-btn";
            assignBtn.textContent = "Assign to Student";
            assignBtn.style.marginLeft = "10px";
            assignBtn.id = "assign-exam-btn";
            
            startBtn.parentElement.appendChild(assignBtn);

            assignBtn.addEventListener('click', async () => {
                const paths = Array.from(selectedCart).map(str => JSON.parse(str));
                let examPool = globalMetadata.filter(q => {
                    return paths.some(pathArr => getQuestionCount(currentView, pathArr, [q]) > 0);
                });

                const qCountInput = parseInt(document.getElementById('exam-q-count').value);
                const timerInput = parseInt(document.getElementById('exam-timer').value);

                if (currentMode === 'exam' && (!timerInput || timerInput <= 0 || isNaN(timerInput))) {
                    alert("Please enter a valid time in minutes for Exam mode.");
                    return;
                }

                const finalTimer = currentMode === 'exam' ? timerInput : 0;

                if (qCountInput && qCountInput > 0 && qCountInput < examPool.length) {
                    examPool = examPool.sort(() => 0.5 - Math.random()).slice(0, qCountInput);
                } else {
                    examPool = examPool.sort(() => 0.5 - Math.random());
                }

                if (examPool.length === 0) {
                    return alert("No questions selected!");
                }

                const generatedTitle = generateExamTitle(paths, currentView) + (currentMode === 'practice' ? " (Practice Assignment)" : " (Exam Assignment)");

                assignBtn.textContent = "Loading Students...";
                assignBtn.disabled = true;

                try {
                    const usersRef = collection(db, "users");
                    const userSnap = await getDocs(usersRef);
                    
                    let studentsList = [];
                    userSnap.forEach(docSnap => {
                        const data = docSnap.data();
                        const role = (data.role || 'STUDENT').toUpperCase();
                        if (role !== 'ADMIN' && role !== 'MENTOR' && role !== 'MANAGEMENT' && role !== 'BANNED') {
                            studentsList.push({
                                id: docSnap.id,
                                name: data.fullName || "Unnamed User",
                                email: data.email || "No Email"
                            });
                        }
                    });

                    const modalOverlay = document.createElement('div');
                    modalOverlay.className = "popup-overlay";
                    modalOverlay.style.display = "flex";
                    
                    let modalHtml = `
                        <div class="glass-panel popup-content text-left" style="max-width: 500px; width: 90%;">
                            <h3 class="modal-title-blue"><i class="fas fa-users"></i> Select Students</h3>
                            <input type="text" id="student-search-input" class="glass-input" placeholder="Search by name or email..." style="margin-bottom: 15px;">
                            <div id="student-list-container" class="notes-list-container" style="max-height: 40vh; overflow-y: auto; margin-bottom: 20px;">
                    `;

                    if (studentsList.length === 0) {
                        modalHtml += `<div style="text-align: center; color: #94a3b8; padding: 20px;">No students found.</div>`;
                    } else {
                        studentsList.sort((a, b) => a.name.localeCompare(b.name)).forEach(student => {
                            modalHtml += `
                                <label class="student-item list-item" style="flex-direction: row; align-items: center; cursor: pointer;">
                                    <input type="checkbox" class="student-checkbox item-checkbox" value="${student.id}">
                                    <div style="display: flex; flex-direction: column;">
                                        <span class="student-name" style="font-weight: bold; color: #f8fafc;">${student.name}</span>
                                        <span class="student-email" style="font-size: 0.85rem; color: #94a3b8;">${student.email}</span>
                                    </div>
                                </label>
                            `;
                        });
                    }

                    modalHtml += `
                            </div>
                            <div style="display: flex; gap: 12px;">
                                <button id="btn-cancel-assign" class="action-btn" style="flex: 1;">Cancel</button>
                                <button id="btn-confirm-assign" class="action-btn next-btn" style="flex: 1;">Assign Exam</button>
                            </div>
                        </div>
                    `;

                    modalOverlay.innerHTML = modalHtml;
                    document.body.appendChild(modalOverlay);

                    const searchInput = document.getElementById('student-search-input');
                    const studentItems = document.querySelectorAll('.student-item');

                    if(searchInput) {
                        searchInput.addEventListener('input', (e) => {
                            const term = e.target.value.toLowerCase();
                            studentItems.forEach(item => {
                                const name = item.querySelector('.student-name').textContent.toLowerCase();
                                const email = item.querySelector('.student-email').textContent.toLowerCase();
                                if (name.includes(term) || email.includes(term)) {
                                    item.style.display = 'flex';
                                } else {
                                    item.style.display = 'none';
                                }
                            });
                        });
                    }

                    document.getElementById('btn-cancel-assign').addEventListener('click', () => {
                        document.body.removeChild(modalOverlay);
                    });

                    document.getElementById('btn-confirm-assign').addEventListener('click', async () => {
                        const checkedBoxes = document.querySelectorAll('.student-checkbox:checked');
                        const selectedStudentIds = Array.from(checkedBoxes).map(cb => cb.value);

                        if (selectedStudentIds.length === 0) {
                            return alert("Please select at least one student!");
                        }

                        const confirmBtn = document.getElementById('btn-confirm-assign');
                        confirmBtn.textContent = "Assigning...";
                        confirmBtn.disabled = true;

                        try {
                            const hydratedExamPool = await hydrateQuestions(examPool);
                            const cleanExamPool = JSON.parse(JSON.stringify(hydratedExamPool));

                            await addDoc(collection(db, "assigned_exams"), {
                                title: generatedTitle,
                                assignedBy: auth.currentUser.uid,
                                assignedTo: selectedStudentIds, 
                                questions: cleanExamPool,
                                mode: currentMode,
                                timerMinutes: finalTimer,
                                isCompletedBy: [],
                                createdAt: serverTimestamp()
                            });
                            
                            alert(`Exam successfully assigned to ${selectedStudentIds.length} student(s)!`);
                            document.body.removeChild(modalOverlay);
                        } catch (error) {
                            console.error("Error assigning exam: ", error);
                            alert("Firebase Error: " + error.message);
                            confirmBtn.textContent = "Assign Exam";
                            confirmBtn.disabled = false;
                        }
                    });

                } catch (error) {
                    console.error("Error fetching students:", error);
                    alert("Failed to load students list.");
                } finally {
                    assignBtn.textContent = "Assign to Student";
                    assignBtn.disabled = false;
                }
            });
        }
    }
}

// ==========================================
// 16. INITIALIZATION & AUTHENTICATION
// ==========================================
window.syncUserProgress = function(updateObj) {
    if (!currentUserData) currentUserData = {};
    Object.assign(currentUserData, updateObj);
    
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    if (!uid) return;
    
    idbCache.set(uid, JSON.parse(JSON.stringify(currentUserData)));
    
    updateDoc(doc(db, 'users', uid), updateObj).catch(err => console.error("Background sync failed:", err));
};

async function hydrateUserState(dbData) {
    currentUserData = dbData; 
    currentUserRole = dbData.role || 'STUDENT';
    
    isPremiumUser = false;
    if (dbData.role === 'ADMIN' || dbData.role === 'MANAGEMENT') {
        isPremiumUser = true;
        
        const queueStr = localStorage.getItem('edeetos_pending_edits');
        let pendingQueue = [];
        if (queueStr) {
            try { pendingQueue = JSON.parse(queueStr); } catch(e){}
        }
        if (pendingQueue.length > 0 && btnPushEdits) {
            btnPushEdits.style.display = 'flex';
            if (pendingEditsCount) pendingEditsCount.textContent = pendingQueue.length;
            
            btnPushEdits.onclick = async () => {
                let token = localStorage.getItem('edeetos_github_pat');
                if (!token) {
                    token = prompt("Please enter your GitHub Personal Access Token to push edits:\n(This saves securely in your browser)");
                    if (!token) return;
                    localStorage.setItem('edeetos_github_pat', token);
                }

                btnPushEdits.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Pushing & Converting...';
                btnPushEdits.disabled = true;

                try {
                    const Papa = (await import('https://cdn.jsdelivr.net/npm/papaparse@5.4.1/+esm')).default;
                    const { Base64 } = await import('https://cdn.jsdelivr.net/npm/js-base64@3.7.5/+esm');

                    const editsByCourse = {};
                    pendingQueue.forEach(edit => {
                        const key = edit.courseFile;
                        if (!editsByCourse[key]) editsByCourse[key] = { isBook: edit.isBook, rows: [] };
                        editsByCourse[key].rows.push(edit.row);
                    });

                    const owner = "hassaan506";
                    const repo = "edeetos";
                    const branch = "main";

                    const uploadFileToGitHub = async (filePath, contentStr, commitMsg) => {
                        const fileUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
                        let currentSha = null;
                        try {
                            const getRes = await fetch(fileUrl + `?ref=${branch}`, { headers: { "Authorization": `Bearer ${token}` } });
                            if (getRes.ok) {
                                const getJson = await getRes.json();
                                currentSha = getJson.sha;
                            }
                        } catch(e) {}

                        const bodyData = { message: commitMsg, content: Base64.encode(contentStr), branch: branch };
                        if (currentSha) bodyData.sha = currentSha;

                        const putRes = await fetch(fileUrl, {
                            method: 'PUT',
                            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
                            body: JSON.stringify(bodyData)
                        });

                        if (!putRes.ok) {
                            const err = await putRes.json().catch(() => ({}));
                            throw new Error(`Failed to upload ${filePath}: ${err.message || putRes.statusText}`);
                        }
                    };

                    for (const courseFile of Object.keys(editsByCourse)) {
                        const isBook = editsByCourse[courseFile].isBook;
                        const folder = isBook ? "Books" : "Data";
                        const csvPath = `${folder}/${courseFile}.csv`;
                        const questionsJsonPath = `${folder}/${courseFile}_questions.json`;
                        const metadataJsonPath = `${folder}/${courseFile}_metadata.json`;
                        const hierarchyJsonPath = `${folder}/${courseFile}_hierarchy.json`;
                        
                        const csvUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${csvPath}`;

                        const getRes = await fetch(csvUrl + `?ref=${branch}`, { headers: { "Authorization": `Bearer ${token}` } });
                        if (!getRes.ok) throw new Error(`Failed to fetch ${csvPath}. Check token permissions.`);
                        
                        const getJson = await getRes.json();
                        const blobUrl = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${getJson.sha}`;
                        const blobRes = await fetch(blobUrl, { headers: { "Authorization": `Bearer ${token}` } });
                        
                        if (!blobRes.ok) throw new Error("Failed to download CSV from GitHub Blob API.");
                        const blobJson = await blobRes.json();
                        
                        const cleanCsvText = Base64.decode(blobJson.content).replace(/^\uFEFF/, '');
                        
                        let parsed = Papa.parse(cleanCsvText, { header: true, skipEmptyLines: true });
                        let rows = parsed.data;

                        const affectedChunks = new Set();
                        
                        const getChunkPaths = (row, cFile) => {
                            const paths = [];
                            const subj = sanitizeFilename(row["Subject"] || row["subject"]);
                            const chap = sanitizeFilename(row["Chapter"] || row["chapter"]);
                            paths.push(`Data/${cFile}/subjects/${subj}_${chap}.json`);
                            
                            if (String(row["Chapter"] || row["chapter"]).toLowerCase().includes('system')) {
                                paths.push(`Data/${cFile}/systems/${chap}_${subj}.json`);
                            }
                            
                            const years = (row["Year"] || row["year"]) ? String(row["Year"] || row["year"]).split(',').map(s=>s.trim()) : [];
                            const specs = (row["Specialty"] || row["specialty"]) ? String(row["Specialty"] || row["specialty"]).split(',').map(s=>s.trim()) : [];
                            const exams = (row["Exam"] || row["exam"] || row["exams"]) ? String(row["Exam"] || row["exam"] || row["exams"]).split(',').map(s=>s.trim()) : [];
                            
                            exams.forEach((ex, i) => {
                                if(!ex) return;
                                const fbYear = years[i] !== undefined ? years[i] : (years[years.length-1] || "Unknown Year");
                                const fbSpec = specs[i] !== undefined ? specs[i] : (specs[specs.length-1] || "Unknown Specialty");
                                const parsedEx = parseExamInfo(ex, fbYear, fbSpec); 
                                paths.push(`Data/${cFile}/exams/${sanitizeFilename(parsedEx.examYear)}_${sanitizeFilename(parsedEx.examSpec)}_${sanitizeFilename(ex)}.json`);
                            });
                            return paths;
                        };

                        editsByCourse[courseFile].rows.forEach(updatedRow => {
                            const qId = updatedRow["QuestionID"];
                            const actualIdKey = Object.keys(rows[0] || {}).find(k => k.toLowerCase().replace(/\s/g, '') === 'questionid' || k.toLowerCase() === 'id') || "QuestionID";
                            
                            let qIndex = -1;
                            for(let i=0; i<rows.length; i++) {
                                if (String(rows[i][actualIdKey]).trim() === String(qId).trim() && String(qId).trim() !== "") {
                                    qIndex = i; break;
                                }
                            }
                            
                            if (qIndex !== -1) {
                                const oldRow = rows[qIndex];
                                if (!isBook) {
                                    getChunkPaths(oldRow, courseFile).forEach(p => affectedChunks.add(p));
                                    getChunkPaths(updatedRow, courseFile).forEach(p => affectedChunks.add(p));
                                }
                                Object.keys(updatedRow).forEach(newKey => {
                                    const originalKey = Object.keys(oldRow).find(k => k.toLowerCase().replace(/\s/g, '') === newKey.toLowerCase().replace(/\s/g, ''));
                                    oldRow[originalKey || newKey] = updatedRow[newKey];
                                });
                            } else {
                                if (!isBook) {
                                    getChunkPaths(updatedRow, courseFile).forEach(p => affectedChunks.add(p));
                                }
                                rows.push(updatedRow);
                            }
                        });

                        let outQs = [];
                        let subTree = {}, sysTree = {}, exTree = {};
                        let subject_chunks = {}, system_chunks = {}, exam_chunks = {};

                        rows.forEach(row => {
                            const getVal = (names) => {
                                const key = Object.keys(row).find(k => names.includes(k.toLowerCase().replace(/\s/g, '')));
                                return key && row[key] ? String(row[key]).trim() : "";
                            };

                            const qId = getVal(['questionid', 'id']);
                            if (!qId) return;

                            const subject = getVal(['subject']);
                            const chapter = getVal(['chapter']);
                            const topic = getVal(['topic']);
                            const year = getVal(['year']);
                            const rawExams = getVal(['exams', 'exam']);
const rawSpecs = getVal(['specialty', 'speciality', 'spec']);
                            const pointValue = getVal(['point', 'points']);

                            const yearsList = year ? year.split(',').map(e => e.trim()).filter(e => e) : [];
                            const examsList = rawExams ? rawExams.split(',').map(e => e.trim()).filter(e => e) : [];
                            const specialtyList = rawSpecs ? rawSpecs.split(',').map(e => e.trim()).filter(e => e) : [];

                            let qObj = {
                                id: qId,
                                year: yearsList,
                                specialty: specialtyList,
                                exams: examsList,
                                subject: subject,
                                chapter: chapter,
                                topic: topic,
                                difficulty: getVal(['difficulty']),
                                question: getVal(['question']),
                                options: {
                                    A: getVal(['optiona']),
                                    B: getVal(['optionb']),
                                    C: getVal(['optionc']),
                                    D: getVal(['optiond']),
                                    E: getVal(['optione'])
                                },
                                correctAnswer: getVal(['correctanswer']).toUpperCase(),
                                explanation: getVal(['explanation']),
                                hint: getVal(['hint']),
                                Point: pointValue
                            };

                            if (isBook) {
                                qObj.isBookQuestion = true;
                                qObj.bookName = courseFile;
                            }

                            outQs.push(qObj);

                            if (subject) {
                                if (!subTree[subject]) subTree[subject] = {};
                                if (chapter) {
                                    if (!subTree[subject][chapter]) subTree[subject][chapter] = {};
                                    if (topic) subTree[subject][chapter][topic] = (subTree[subject][chapter][topic] || 0) + 1;
                                }
                            }
                            if (chapter && chapter.toLowerCase().includes('system')) {
                                if (!sysTree[chapter]) sysTree[chapter] = {};
                                if (subject) {
                                    if (!sysTree[chapter][subject]) sysTree[chapter][subject] = {};
                                    if (topic) sysTree[chapter][subject][topic] = (sysTree[chapter][subject][topic] || 0) + 1;
                                }
                            }

                            examsList.forEach((ex, i) => {
                                const fbYear = yearsList[i] !== undefined ? yearsList[i] : (yearsList[yearsList.length - 1] || "Unknown Year");
                                const fbSpec = specialtyList[i] !== undefined ? specialtyList[i] : (specialtyList[specialtyList.length - 1] || "Unknown Specialty");
                                
                                const parsedEx = parseExamInfo(ex, fbYear, fbSpec);
                                
                                if (!exTree[parsedEx.examYear]) exTree[parsedEx.examYear] = {};
                                if (!exTree[parsedEx.examYear][parsedEx.examSpec]) exTree[parsedEx.examYear][parsedEx.examSpec] = {};
                                if (!exTree[parsedEx.examYear][parsedEx.examSpec][ex]) exTree[parsedEx.examYear][parsedEx.examSpec][ex] = 0;
                                exTree[parsedEx.examYear][parsedEx.examSpec][ex]++;
                            });

                            if (!isBook) {
                                const s_clean = sanitizeFilename(subject);
                                const c_clean = sanitizeFilename(chapter);
                                const subj_path = `Data/${courseFile}/subjects/${s_clean}_${c_clean}.json`;
                                
                                if (affectedChunks.has(subj_path)) {
                                    if (!subject_chunks[subj_path]) subject_chunks[subj_path] = [];
                                    subject_chunks[subj_path].push(qObj);
                                }

                                if (chapter.toLowerCase().includes('system')) {
                                    const sys_path = `Data/${courseFile}/systems/${c_clean}_${s_clean}.json`;
                                    if (affectedChunks.has(sys_path)) {
                                        if (!system_chunks[sys_path]) system_chunks[sys_path] = [];
                                        system_chunks[sys_path].push(qObj);
                                    }
                                }

                                examsList.forEach((ex, i) => {
                                    const fbYear = yearsList[i] !== undefined ? yearsList[i] : (yearsList[yearsList.length - 1] || "Unknown Year");
                                    const fbSpec = specialtyList[i] !== undefined ? specialtyList[i] : (specialtyList[specialtyList.length - 1] || "Unknown Specialty");
                                    const parsedEx = parseExamInfo(ex, fbYear, fbSpec);
                                    
                                    const exam_path = `Data/${courseFile}/exams/${sanitizeFilename(parsedEx.examYear)}_${sanitizeFilename(parsedEx.examSpec)}_${sanitizeFilename(ex)}.json`;
                                    if (affectedChunks.has(exam_path)) {
                                        if (!exam_chunks[exam_path]) exam_chunks[exam_path] = [];
                                        exam_chunks[exam_path].push(qObj);
                                    }
                                });
                            }
                        });

                        const commitMsg = `Admin Panel: Updated ${editsByCourse[courseFile].rows.length} question(s) & synced micro-chunks`;
                        
                        await uploadFileToGitHub(csvPath, Papa.unparse(rows), commitMsg);
                        
                        if (isBook) {
                            await uploadFileToGitHub(questionsJsonPath, JSON.stringify(outQs, null, 4), commitMsg);
                        } else {
                            const metadataList = outQs.map(q => ({
                                id: q.id,
                                year: q.year,
                                exams: q.exams,
                                subject: q.subject,
                                chapter: q.chapter,
                                topic: q.topic,
                                difficulty: q.difficulty
                            }));
                            await uploadFileToGitHub(metadataJsonPath, JSON.stringify(metadataList), commitMsg);
                            
                            for (const chunkPath of affectedChunks) {
                                let chunkData = subject_chunks[chunkPath] || system_chunks[chunkPath] || exam_chunks[chunkPath] || [];
                                await uploadFileToGitHub(chunkPath, JSON.stringify(chunkData, null, 4), commitMsg);
                            }
                        }
                        
                        const hierarchyObj = { subjects: subTree, systems: sysTree, exams: exTree };
                        await uploadFileToGitHub(hierarchyJsonPath, JSON.stringify(hierarchyObj, null, 4), commitMsg);
                    }

                    alert(`✅ Success! CSV, Metadata, Hierarchy, AND affected micro-chunks synced directly to GitHub.\n\nChanges are live instantly!`);
                    localStorage.removeItem('edeetos_pending_edits');
                    btnPushEdits.style.display = 'none';

                } catch (error) {
                    console.error(error);
                    alert("❌ Push Failed: " + error.message);
                    btnPushEdits.innerHTML = `<i class="fas fa-cloud-upload-alt"></i> Push <span id="pending-edits-count" style="background: rgba(255,255,255,0.2); color: #fde68a; padding: 2px 6px; border-radius: 10px; font-size: 0.75rem;">${pendingQueue.length}</span>`;
                    btnPushEdits.disabled = false;
                }
            };
        }

    } else if (dbData.subscriptions && dbData.subscriptions[activeCourse]) {
        const expiry = dbData.subscriptions[activeCourse];
        if (expiry === 'lifetime') {
            isPremiumUser = true;
        } else {
            const expiryDate = new Date(expiry);
            if (expiryDate >= new Date()) {
                isPremiumUser = true;
            }
        }
    }
    
const uid = auth.currentUser ? auth.currentUser.uid : null;
    const fetchShard = async (folder, docName) => {
        try {
            const snap = await getDoc(doc(db, "users", uid, folder, docName));
            return snap.exists() ? snap.data() : {};
        } catch(e) { return {}; }
    };

    const [
        cSol, cMis, cBkm, cSkp, cHis, cRev, cNot,
        bSol, bMis, bBkm, bSkp, bHis, bRev, bNot
    ] = await Promise.all([
        fetchShard(activeCourse, "solved"), fetchShard(activeCourse, "mistakes"), fetchShard(activeCourse, "bookmarks"), fetchShard(activeCourse, "skipped"), fetchShard(activeCourse, "history"), fetchShard(activeCourse, "revisions"), fetchShard(activeCourse, "notes"),
        fetchShard("books", "solved"), fetchShard("books", "mistakes"), fetchShard("books", "bookmarks"), fetchShard("books", "skipped"), fetchShard("books", "history"), fetchShard("books", "revisions"), fetchShard("books", "notes")
    ]);

    const courseSolved = (cSol.list || []).map(String);
    const coursePracticeMistakes = (cMis.practice || []).map(String);
    const courseExamMistakes = (cMis.exam || []).map(String);
    const courseHistorical = (cMis.historical || []).map(String);
    const courseBookmarks = (cBkm.list || []).map(String);
    const courseSkipped = (cSkp.list || []).map(String);

    const bookSolved = (bSol.list || []).map(String);
    const bookPracticeMistakes = (bMis.practice || []).map(String);
    const bookExamMistakes = (bMis.exam || []).map(String);
    const bookHistorical = (bMis.historical || []).map(String);
    const bookBookmarks = (bBkm.list || []).map(String);
    const bookSkipped = (bSkp.list || []).map(String);

    globalBookmarkFolders = { ...(cBkm.folders || {}), ...(bBkm.folders || {}) };
    userExamHistory = [...(cHis.list || []), ...(bHis.list || [])];
    
    currentUserData[activeCourse] = { revisions: cRev, notes: cNot.data || {} };
    currentUserData.books = { revisions: bRev, notes: bNot.data || {} };

    const validCourseSolved = [...new Set(courseSolved)];
    const validCoursePracticeMistakes = [...new Set(coursePracticeMistakes)];
    const validCourseExamMistakes = [...new Set(courseExamMistakes)];
    const validCourseBookmarks = [...new Set(courseBookmarks)];
    const uniqueCourseSkipped = [...new Set(courseSkipped)];

    const uniqueBookSolved = [...new Set(bookSolved)];
    const uniqueBookPracticeMistakes = [...new Set(bookPracticeMistakes)];
    const uniqueBookExamMistakes = [...new Set(bookExamMistakes)];
    const uniqueBookBookmarks = [...new Set(bookBookmarks)];
    const uniqueBookSkipped = [...new Set(bookSkipped)];

    globalPracticeMistakes = [...validCoursePracticeMistakes, ...uniqueBookPracticeMistakes];
    globalExamMistakes = [...validCourseExamMistakes, ...uniqueBookExamMistakes];
    globalBookmarks = [...validCourseBookmarks, ...uniqueBookBookmarks];
    globalSkipped = [...uniqueCourseSkipped, ...uniqueBookSkipped];
    
    attemptedQuestions = [...validCourseSolved, ...uniqueBookSolved];
    window.fastAttemptedSet = new Set([...attemptedQuestions, ...globalPracticeMistakes, ...globalExamMistakes, ...globalSkipped]);
    
    const courseAllMistakes = [...new Set([...validCoursePracticeMistakes, ...validCourseExamMistakes])];
    
    // --- IMMUTABLE ACCURACY MATH FOR COURSES ---
    const uniqueCourseAttempts = [...new Set([...validCourseSolved, ...courseAllMistakes, ...courseHistorical])];
    const courseFirstTryCorrect = uniqueCourseAttempts.filter(id => !courseHistorical.includes(id) && !courseAllMistakes.includes(id));
    const courseAccuracy = uniqueCourseAttempts.length > 0 ? Math.round((courseFirstTryCorrect.length / uniqueCourseAttempts.length) * 100) : 0;
    
    viewSpecificStats.course = {
        solved: validCourseSolved,
        mistakes: courseAllMistakes,
        bookmarks: validCourseBookmarks,
        skipped: uniqueCourseSkipped,
        accuracy: courseAccuracy
    };

    const bookAllMistakes = [...new Set([...uniqueBookPracticeMistakes, ...uniqueBookExamMistakes])];
    
    // --- IMMUTABLE ACCURACY MATH FOR BOOKS ---
    const uniqueBookAttempts = [...new Set([...uniqueBookSolved, ...bookAllMistakes, ...bookHistorical])];
    const bookFirstTryCorrect = uniqueBookAttempts.filter(id => !bookHistorical.includes(id) && !bookAllMistakes.includes(id));
    const bookAccuracy = uniqueBookAttempts.length > 0 ? Math.round((bookFirstTryCorrect.length / uniqueBookAttempts.length) * 100) : 0;
    
    viewSpecificStats.book = {
        solved: uniqueBookSolved,
        mistakes: bookAllMistakes,
        bookmarks: uniqueBookBookmarks,
        skipped: uniqueBookSkipped,
        accuracy: bookAccuracy
    };
	
    await loadDataAndBuildTree();
    restoreLastState();
    if (typeof updateDashboardUI === 'function') updateDashboardUI();
    
const revisions = {
    ...(currentUserData[activeCourse]?.revisions || {}),
    ...(currentUserData.books?.revisions || {})
};
    
    const now = Date.now();
    const dueTopics = [];

    Object.keys(revisions).forEach(topicId => {
        if (revisions[topicId].dueDate <= now && revisions[topicId].status !== 'missed') {
            let subj = "", chap = "", top = "";
            
            const parts = topicId.split('::');
            if (parts.length >= 4) {
                subj = parts[0];
                chap = parts[1];
                top = parts[2];
            } else {
                const oldParts = topicId.split('_');
                oldParts.pop(); 
                top = oldParts.pop() || '';
                chap = oldParts.pop() || '';
                subj = oldParts.join('_') || '';
            }

            subj = subj || "General";
            chap = chap || "Section";
            top = top || revisions[topicId].topic || "Review Topic";
            if (top === "Unknown Topic") top = "Topic";

            dueTopics.push({ 
                id: topicId, 
                subject: subj,
                chapter: chap,
                topic: top,
                step: revisions[topicId].intervalStep || 1 
            });
        }
    });

    const groupedByDay = {};
    dueTopics.forEach(item => {
        if (!groupedByDay[item.step]) groupedByDay[item.step] = [];
        groupedByDay[item.step].push(item);
    });

    const sortedDays = Object.keys(groupedByDay).map(Number).sort((a, b) => a - b);
    const revisionContainer = document.getElementById('spaced-repetition-container');

    if (dueTopics.length > 0 && revisionContainer) {
        const revisionCard = document.createElement('div');
        revisionCard.className = 'glass-panel feature-card';
        revisionCard.style.borderColor = 'rgba(245, 158, 11, 0.4)';
        revisionCard.style.background = 'rgba(245, 158, 11, 0.1)';
        revisionCard.style.padding = '20px'; 
        revisionCard.style.gridColumn = '1 / -1'; 
        revisionCard.style.marginBottom = '20px';
        revisionCard.style.cursor = 'pointer';
        revisionCard.style.display = 'flex';
        revisionCard.style.flexDirection = 'row';
        revisionCard.style.justifyContent = 'space-between';
        revisionCard.style.alignItems = 'center';

        revisionCard.innerHTML = `
            <div>
                <h3 class="card-title" style="color: #fde68a; margin: 0 0 5px 0;"><i class="fas fa-sync-alt" style="color: #f59e0b; margin-right: 8px;"></i> Due for Revision</h3>
                <p style="color: #fcd34d; font-size: 0.85rem; margin: 0;">You have ${dueTopics.length} topics ready for spaced repetition.</p>
            </div>
            <button class="action-btn" style="background: rgba(245, 158, 11, 0.2); border-color: #f59e0b; color: #fef3c7;">View Plan</button>
        `;

        let existingModal = document.getElementById('revision-popup-modal');
        if (existingModal) existingModal.remove(); 

        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'revision-popup-modal';
        modalOverlay.className = "popup-overlay";

        let modalHtml = `
            <div class="glass-panel popup-content" style="max-width: 600px; width: 90%; max-height: 85vh; display: flex; flex-direction: column;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 15px; margin-bottom: 15px;">
                    <h3 style="color: #93c5fd; margin: 0;"><i class="fas fa-sync-alt" style="color: #f59e0b; margin-right: 8px;"></i> Spaced Repetition Plan</h3>
                    <button id="close-revision-popup" class="icon-btn" style="background: transparent; border: none;">✖</button>
                </div>
                <div style="overflow-y: auto; flex-grow: 1; padding-right: 10px; display: flex; flex-direction: column; gap: 15px;">
        `;

        sortedDays.forEach(day => {
            const topicsArray = groupedByDay[day].map(item => item.id);
            const safeTopicsArray = encodeURIComponent(JSON.stringify(topicsArray));

            modalHtml += `
                <div class="revision-day-group" style="margin-bottom: 10px;">
                    <button class="action-btn" style="width: 100%; text-align: left; display: flex; justify-content: space-between; align-items: center; background: rgba(59, 130, 246, 0.15); border-color: #3b82f6;" onclick="window.generateRevisionQuiz(JSON.parse(decodeURIComponent('${safeTopicsArray}')), ${day})">
                        <div style="font-weight: 700; color: #f8fafc; font-size: 1rem; display: flex; align-items: center;">
                            <i class="fas fa-calendar-day" style="color: #60a5fa; margin-right: 8px;"></i> Day ${day} Review
                        </div>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <span style="background: rgba(255,255,255,0.1); color: #cbd5e1; padding: 4px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: bold;">${groupedByDay[day].length} Topics Combined</span>
                            <i class="fas fa-play-circle" style="color: #60a5fa; font-size: 1.3rem;"></i>
                        </div>
                    </button>
                </div>
            `;

            groupedByDay[day].forEach(item => {
                const safeTopic = encodeURIComponent(item.id);
                const displayPath = `
                    <span style="color:#94a3b8; font-size:0.75rem; margin-bottom: 3px;">${item.subject} <span style="color:rgba(255,255,255,0.2); margin:0 3px;">&gt;</span> ${item.chapter} <span style="color:rgba(255,255,255,0.2); margin:0 3px;">&gt;</span></span>
                    <span style="color:#fde68a; font-size: 0.95rem;">${item.topic}</span>
                `;

                modalHtml += `
                    <button class="action-btn" style="width: 100%; text-align: left; display: flex; justify-content: space-between; align-items: center; background: rgba(245, 158, 11, 0.1); border-color: rgba(245, 158, 11, 0.3);" onclick="window.generateRevisionQuiz([decodeURIComponent('${safeTopic}')])">
                        <div style="font-weight: 700; display: flex; flex-direction: column; width: 90%;">
                            ${displayPath}
                        </div>
                        <i class="fas fa-play-circle" style="color: #fcd34d; font-size: 1.3rem; flex-shrink: 0; margin-left: 10px;"></i>
                    </button>
                `;
            });

            modalHtml += `</div></div>`;
        });

        modalHtml += `</div></div>`;
        modalOverlay.innerHTML = modalHtml;
        document.body.appendChild(modalOverlay);

        revisionCard.onclick = () => {
            modalOverlay.style.display = 'flex';
        };

        const closeBtn = modalOverlay.querySelector('#close-revision-popup');
        if (closeBtn) {
            closeBtn.onclick = (e) => {
                e.stopPropagation();
                modalOverlay.style.display = 'none';
            };
        }

        modalOverlay.onclick = (e) => {
            if (e.target === modalOverlay) modalOverlay.style.display = 'none';
        };

        revisionContainer.innerHTML = ''; 
        revisionContainer.appendChild(revisionCard);

    } else if (revisionContainer) {
        revisionContainer.innerHTML = '';
    }
    
    const btnMistakes = document.getElementById('btn-practice-mistakes');
    if (btnMistakes) {
        btnMistakes.disabled = false;
        btnMistakes.style.cursor = "pointer";
        btnMistakes.onclick = async () => {
            isGlobalPopupActive = true;
            const isBook = currentView === 'book';
            
            const activeMistakes = isBook ? viewSpecificStats.book.mistakes : viewSpecificStats.course.mistakes;
            if (activeMistakes.length === 0) {
                alert(isBook ? "You don't have any book mistakes yet." : "You don't have any course mistakes yet.");
                return;
            }

            let pPool = [];
            let ePool = [];

            if (!isBook) {
                document.body.style.cursor = 'wait';
                const targetUrls = new Set();
                
                globalMetadata.forEach(q => {
                    const qId = getQID(q);
                    if (!q.isBookQuestion && (globalPracticeMistakes.includes(qId) || globalExamMistakes.includes(qId))) {
                        targetUrls.add(`Data/${activeCourse}/subjects/${sanitizeFilename(q.Subject || q.subject)}_${sanitizeFilename(q.Chapter || q.chapter)}.json`);
                    }
                });

                const pSeen = new Set();
                const eSeen = new Set();

for (let baseUrl of targetUrls) {
                    let page = 1;
                    let keepFetching = true;
                    while (keepFetching) {
                        const pageUrl = baseUrl.replace('.json', `_${page}.json`);
                        if (!window.activeChunksCache[pageUrl]) {
                            try {
                                const res = await fetch(pageUrl);
                                if (res.ok) window.activeChunksCache[pageUrl] = await res.json();
                                else { window.activeChunksCache[pageUrl] = []; keepFetching = false; }
                            } catch(e) { window.activeChunksCache[pageUrl] = []; keepFetching = false; }
                        } else if (window.activeChunksCache[pageUrl].length === 0) {
                            keepFetching = false;
                        }
                        
                        if (window.activeChunksCache[pageUrl]) {
                            window.activeChunksCache[pageUrl].forEach(q => {
                                const qId = getQID(q);
                                if (globalPracticeMistakes.includes(qId) && !pSeen.has(qId)) {
                                    pSeen.add(qId);
                                    pPool.push(q);
                                }
                                if (globalExamMistakes.includes(qId) && !eSeen.has(qId)) {
                                    eSeen.add(qId);
                                    ePool.push(q);
                                }
                            });
                        }
                        page++;
                    }
                }
                document.body.style.cursor = 'default';
            } else {
                pPool = allQuestions.filter(q => globalPracticeMistakes.includes(getQID(q)) && q.isBookQuestion);
                ePool = allQuestions.filter(q => globalExamMistakes.includes(getQID(q)) && q.isBookQuestion);
            }

            if (pPool.length === 0 && ePool.length === 0 && isBook) {
                alert("Book mistakes exist, but you must open the specific book first to load its questions into memory.");
                return;
            }

            let combinedTree = {};
            if (pPool.length > 0) combinedTree["Practice Mistakes"] = buildSubTree(pPool);
            if (ePool.length > 0) combinedTree["Exam Mistakes"] = buildSubTree(ePool);

            activeCustomPool = [...new Set([...pPool, ...ePool])];
            openPopup(isBook ? "⚠️ Book Mistakes" : "⚠ Course Mistakes", combinedTree, 'Level1', []);
        };
    }

    const btnBookmarks = document.getElementById('btn-review-bookmarks');
    if (btnBookmarks) {
        btnBookmarks.disabled = false;
        btnBookmarks.style.cursor = "pointer";
        btnBookmarks.onclick = async () => {
            isGlobalPopupActive = true;
            const isBook = currentView === 'book';
            
            const activeBookmarks = isBook ? viewSpecificStats.book.bookmarks : viewSpecificStats.course.bookmarks;
            if (activeBookmarks.length === 0) {
                alert(isBook ? "You don't have any book bookmarks yet." : "You don't have any course bookmarks yet.");
                return;
            }

            let bPool = [];

            if (!isBook) {
                document.body.style.cursor = 'wait';
                const targetUrls = new Set();
                
                globalMetadata.forEach(q => {
                    const qId = getQID(q);
                    if (!q.isBookQuestion && globalBookmarks.includes(qId)) {
                        targetUrls.add(`Data/${activeCourse}/subjects/${sanitizeFilename(q.Subject || q.subject)}_${sanitizeFilename(q.Chapter || q.chapter)}.json`);
                    }
                });

                const bSeen = new Set();
for (let baseUrl of targetUrls) {
                    let page = 1;
                    let keepFetching = true;
                    while (keepFetching) {
                        const pageUrl = baseUrl.replace('.json', `_${page}.json`);
                        if (!window.activeChunksCache[pageUrl]) {
                            try {
                                const res = await fetch(pageUrl);
                                if (res.ok) window.activeChunksCache[pageUrl] = await res.json();
                                else { window.activeChunksCache[pageUrl] = []; keepFetching = false; }
                            } catch(e) { window.activeChunksCache[pageUrl] = []; keepFetching = false; }
                        } else if (window.activeChunksCache[pageUrl].length === 0) {
                            keepFetching = false;
                        }
                        
                        if (window.activeChunksCache[pageUrl]) {
                            window.activeChunksCache[pageUrl].forEach(q => {
                                const qId = getQID(q);
                                if (globalBookmarks.includes(qId) && !bSeen.has(qId)) {
                                    bSeen.add(qId);
                                    bPool.push(q);
                                }
                            });
                        }
                        page++;
                    }
                }
                document.body.style.cursor = 'default';
            } else {
                bPool = allQuestions.filter(q => globalBookmarks.includes(getQID(q)) && q.isBookQuestion);
            }

            if (bPool.length === 0 && isBook) {
                alert("Book bookmarks exist, but you must open the specific book first to load its questions into memory.");
                return;
            }

            activeCustomPool = bPool;
			let folderTree = {};
            bPool.forEach(q => {
                let f = "\u200B" + (globalBookmarkFolders[getQID(q)] || "For Revision");
                let s = q.Subject || q.subject || 'Uncategorized';
                let c = q.Chapter || q.chapter || 'General';
                let t = q.Topic || q.topic || 'General';
                
                if (!folderTree[f]) folderTree[f] = {};
                if (!folderTree[f][s]) folderTree[f][s] = {};
                if (!folderTree[f][s][c]) folderTree[f][s][c] = {};
                folderTree[f][s][c][t] = (folderTree[f][s][c][t] || 0) + 1;
            });

            activeCustomPool = bPool;
            openPopup(isBook ? "⭐ Book Bookmarks" : "⭐ Course Bookmarks", folderTree, 'Level1', []);
        };
    }
    
    setTimeout(() => {
        const allMistakes = [...new Set([...globalPracticeMistakes, ...globalExamMistakes])];
        const flawlessCount = attemptedQuestions.filter(id => !allMistakes.includes(id)).length;
        checkMilestones(flawlessCount);
    }, 2000);
}

const btnSkipped = document.getElementById('btn-practice-skipped');
    if (btnSkipped) {
        btnSkipped.disabled = false;
        btnSkipped.style.cursor = "pointer";
        btnSkipped.onclick = async () => {
            isGlobalPopupActive = true;
            const isBook = currentView === 'book';
            
            const activeSkipped = isBook ? viewSpecificStats.book.skipped : viewSpecificStats.course.skipped;
            if (activeSkipped.length === 0) {
                alert(isBook ? "You don't have any skipped book questions." : "You don't have any skipped course questions.");
                return;
            }

            let sPool = [];
            if (!isBook) {
                document.body.style.cursor = 'wait';
                const targetUrls = new Set();
                globalMetadata.forEach(q => {
                    if (!q.isBookQuestion && globalSkipped.includes(getQID(q))) {
                        targetUrls.add(`Data/${activeCourse}/subjects/${sanitizeFilename(q.Subject || q.subject)}_${sanitizeFilename(q.Chapter || q.chapter)}.json`);
                    }
                });

                const sSeen = new Set();
for (let baseUrl of targetUrls) {
                    let page = 1;
                    let keepFetching = true;
                    while (keepFetching) {
                        const pageUrl = baseUrl.replace('.json', `_${page}.json`);
                        if (!window.activeChunksCache[pageUrl]) {
                            try {
                                const res = await fetch(pageUrl);
                                if (res.ok) window.activeChunksCache[pageUrl] = await res.json();
                                else { window.activeChunksCache[pageUrl] = []; keepFetching = false; }
                            } catch(e) { window.activeChunksCache[pageUrl] = []; keepFetching = false; }
                        } else if (window.activeChunksCache[pageUrl].length === 0) {
                            keepFetching = false;
                        }
                        
                        if (window.activeChunksCache[pageUrl]) {
                            window.activeChunksCache[pageUrl].forEach(q => {
                                const qId = getQID(q);
                                if (globalSkipped.includes(qId) && !sSeen.has(qId)) {
                                    sSeen.add(qId);
                                    sPool.push(q);
                                }
                            });
                        }
                        page++;
                    }
                }
                document.body.style.cursor = 'default';
            } else {
                sPool = allQuestions.filter(q => globalSkipped.includes(getQID(q)) && q.isBookQuestion);
            }

            if (sPool.length === 0 && isBook) {
                alert("Skipped questions exist, but you must open the specific book first to load its questions into memory.");
                return;
            }

            let combinedTree = { "Skipped Questions": buildSubTree(sPool) };
            activeCustomPool = sPool;
            openPopup(isBook ? "⏭️ Skipped Book Qs" : "⏭️ Skipped Course Qs", combinedTree, 'Level1', []);
        };
    }
	
async function migrateOldUserData(userRef, uid, dbData) {
    let requiresUpdate = false;
    let rootUpdates = {};

    const migrateCategory = async (key) => {
        if (!dbData[key]) return;
        const data = dbData[key];
        
        // If solvedQuestions exists, this user hasn't been migrated yet
        if (data.solvedQuestions || data.mistakes || data.bookmarks || data.skippedQuestions || data.examHistory) {
            requiresUpdate = true;
            console.log(`Migrating old data for ${key}...`);
            
            if (data.solvedQuestions) await setDoc(doc(db, "users", uid, key, "solved"), { list: data.solvedQuestions }, { merge: true });
            if (data.mistakes || data.examMistakes || data.historicalMistakes) {
                await setDoc(doc(db, "users", uid, key, "mistakes"), { 
                    practice: data.mistakes || [], 
                    exam: data.examMistakes || [],
                    historical: data.historicalMistakes || []
                }, { merge: true });
            }
            if (data.bookmarks) await setDoc(doc(db, "users", uid, key, "bookmarks"), { list: data.bookmarks, folders: data.bookmarkFolders || {} }, { merge: true });
            if (data.skippedQuestions) await setDoc(doc(db, "users", uid, key, "skipped"), { list: data.skippedQuestions }, { merge: true });
            if (data.examHistory) await setDoc(doc(db, "users", uid, key, "history"), { list: data.examHistory }, { merge: true });
            if (data.notes) await setDoc(doc(db, "users", uid, key, "notes"), { data: data.notes }, { merge: true });
            if (data.revisions) await setDoc(doc(db, "users", uid, key, "revisions"), data.revisions, { merge: true });

            // Mark old arrays for deletion to permanently free up the 1MB limit
            rootUpdates[`${key}.solvedQuestions`] = deleteField();
            rootUpdates[`${key}.mistakes`] = deleteField();
            rootUpdates[`${key}.examMistakes`] = deleteField();
            rootUpdates[`${key}.historicalMistakes`] = deleteField();
            rootUpdates[`${key}.bookmarks`] = deleteField();
            rootUpdates[`${key}.bookmarkFolders`] = deleteField();
            rootUpdates[`${key}.skippedQuestions`] = deleteField();
            rootUpdates[`${key}.examHistory`] = deleteField();
            rootUpdates[`${key}.notes`] = deleteField();
            rootUpdates[`${key}.revisions`] = deleteField();
        }
    };

    const activeCourse = localStorage.getItem('edeetos_active_course') || 'fcps_part1';
    await migrateCategory(activeCourse);
    await migrateCategory('books');

    if (requiresUpdate) {
        await updateDoc(userRef, rootUpdates);
        console.log("Migration complete. Root document cleaned.");
    }
}
	
onAuthStateChanged(auth, async (user) => {
    if (user) {
        localStorage.removeItem('edeetos_guest_mode');
        const userRef = doc(db, "users", user.uid);

        const cachedData = await idbCache.get(user.uid);
        if (cachedData) {
            try {
                await hydrateUserState(cachedData);
            } catch(e) { 
                console.warn("Cache hydration error"); 
            }
        }

try {
            const docSnap = await getDoc(userRef);
            if (docSnap.exists()) {
                const dbData = docSnap.data();
                
                // Fire the migration check
                await migrateOldUserData(userRef, user.uid, dbData);
                
                idbCache.set(user.uid, dbData);
                await hydrateUserState(dbData);
            } else {
                await hydrateUserState({ role: 'STUDENT' });
            }
        } catch (error) {
            console.error("Error fetching stats:", error); 
        }
    } else {
        if (localStorage.getItem('edeetos_guest_mode') === 'true') {
            isPremiumUser = false;
            await loadDataAndBuildTree();

            const lockUI = () => alert("Please register an account to access this feature.");
            const btnMistakes = document.getElementById('btn-practice-mistakes');
            if (btnMistakes) { btnMistakes.disabled = false; btnMistakes.onclick = lockUI; }
            const btnBookmarks = document.getElementById('btn-review-bookmarks');
            if (btnBookmarks) { btnBookmarks.disabled = false; btnBookmarks.onclick = lockUI; }
        } else {
            window.location.href = 'login.html';
        }
    }
});
