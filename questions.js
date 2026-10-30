/* questions.js - PART 1 of 2 (Sections 1 - 8) */

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, addDoc, collection, serverTimestamp, getDocs, deleteField } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { createDbWorker } from './assets/sqlite/sql-vfs-bundle.js';

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
window.isSearchEngineLoading = false;
window.activeChunksCache = new Proxy({}, {
    set: function(target, prop, value) {
        target[prop] = value;
        const keys = Object.keys(target);
        if (keys.length > 30) { delete target[keys[0]]; } // Keep memory under control
        return true;
    }
});
let searchTimeout;
let cachedAttemptedPool = null;
let cachedMistakesPool = null;

let activeCourse = localStorage.getItem('edeetos_active_course');
if (!activeCourse) {
    activeCourse = 'fcps_part1'; 
    localStorage.setItem('edeetos_active_course', activeCourse);
    if (!window.location.pathname.includes('dashboard.html')) {
        window.location.href = 'dashboard.html';
    }
}

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
    if (book.file === "rafiullah") { return activeCourse && activeCourse.startsWith("fcps_part1"); }    
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

// Modals
const joinChallengeModal = document.getElementById('join-challenge-modal');
const hostExitModal = document.getElementById('host-exit-modal');
const assignExamModal = document.getElementById('assign-exam-modal');
const mockModal = document.getElementById('mock-exam-modal');
const journeyModal = document.getElementById('journey-modal');
const milestoneModal = document.getElementById('milestone-reward-modal');
const revisionModal = document.getElementById('revision-popup-modal');
const resetModal = document.getElementById('reset-modal');
const analyticsModal = document.getElementById('analytics-modal');

if (darkModeBtn) {
    const updateIcon = () => {
        const isDark = document.documentElement.classList.contains('dark-mode');
        darkModeBtn.innerHTML = ''; 
        const icon = document.createElement('i');
        icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
        darkModeBtn.appendChild(icon);
    };
    updateIcon();
    darkModeBtn.addEventListener('click', () => {
        document.documentElement.classList.toggle('dark-mode');
        localStorage.setItem('theme', document.documentElement.classList.contains('dark-mode') ? 'dark' : 'light');
        updateIcon();
    });
}

// ==========================================
// 3. UTILITY FUNCTIONS (Sanitization & Parsers)
// ==========================================
function sanitizeFilename(name) {
    if (!name) return "unknown";
    return String(name).toLowerCase().trim().replace(/[\\/*?:"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
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
    // Mentor init happens in part 2, referenced here safely
    if (window.initMentorFeatures) window.initMentorFeatures();
}

function restoreLastState() {
    // switchMode is defined in part 2, calling it safely if initialized
    if (window.switchMode) window.switchMode('practice');
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
function createBadge(iconClass, text, badgeClass) {
    const span = document.createElement('span');
    span.className = `acc-badge-wide ${badgeClass}`;
    const icon = document.createElement('i');
    icon.className = iconClass;
    icon.style.marginRight = '4px';
    span.appendChild(icon);
    span.appendChild(document.createTextNode(text));
    return span;
}

function renderGrid() {
    if (!subjectsGrid) return;
    subjectsGrid.textContent = '';
    const template = document.getElementById('tpl-feature-card');

    let activeTree = {};
    if (currentView === 'subject') activeTree = subjectTree;
    if (currentView === 'system') activeTree = systemTree;
    if (currentView === 'exam') activeTree = examTree;

    Object.keys(activeTree).forEach(cardTitle => {
        const qCount = getQuestionCount(currentView, [cardTitle]);
        if (currentMode !== 'exam' && unattemptedFilter && unattemptedFilter.checked && qCount === 0) return;
        if (qCount === 0) return;

        const clone = template.content.cloneNode(true);
        const card = clone.querySelector('.feature-card');
        const titleEl = clone.querySelector('.card-title');
        const countEl = clone.querySelector('.card-count');
        const statsContainer = clone.querySelector('.card-stats-container');
        const progFill = clone.querySelector('.progress-bar-fill');

        const doneCount = getSolvedCount(currentView, [cardTitle]);
        const percent = qCount > 0 ? Math.round((doneCount / qCount) * 100) : 0;
        
        titleEl.textContent = cardTitle;
        countEl.textContent = `${doneCount} / ${qCount}`;
        progFill.style.width = `${percent}%`;

        if (currentView === 'exam') {
            const mistakeCount = getMistakesCount(currentView, [cardTitle]);
            const totalAttempts = doneCount + mistakeCount;
            const accuracy = totalAttempts > 0 ? Math.round((doneCount / totalAttempts) * 100) : 0;
            
            const accClass = totalAttempts === 0 ? 'badge-gray' : (accuracy >= 75 ? 'badge-green' : (accuracy >= 50 ? 'badge-yellow' : 'badge-red'));
            
            const badgeCont = document.createElement('div');
            badgeCont.className = 'acc-badge-container';
            
            const solvedBadge = createBadge('fas fa-check', `${doneCount} Solved`, 'badge-green');
            const mistakeBadge = createBadge('fas fa-times', `${mistakeCount} Mistake${mistakeCount !== 1 ? 's' : ''}`, 'badge-red');
            const accBadgeStr = totalAttempts > 0 ? `${accuracy}% Acc` : '0%';
            const accBadge = createBadge('fas fa-bullseye', accBadgeStr, accClass);

            badgeCont.appendChild(solvedBadge);
            badgeCont.appendChild(mistakeBadge);
            badgeCont.appendChild(accBadge);
            statsContainer.appendChild(badgeCont);
        }

        card.onclick = async () => {
            if (currentView !== 'book') { activeCustomPool = null; }
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
    subjectsGrid.textContent = '';
    const template = document.getElementById('tpl-feature-card');
    const bookTemplate = document.getElementById('tpl-book-card');

    availableBooks.forEach(book => {
        const isUnlocked = checkPremiumAccess(book.file);
        
        const clone = template.content.cloneNode(true);
        const card = clone.querySelector('.feature-card');
        card.textContent = ''; // Clear default feature content

        const bookClone = bookTemplate.content.cloneNode(true);
        const titleEl = bookClone.querySelector('.book-title');
        const iconWrapper = bookClone.querySelector('.book-icon-wrapper');
        const statusEl = bookClone.querySelector('.book-access-status');

        titleEl.textContent = book.title;
        
        const icon = document.createElement('i');
        if (isUnlocked) {
            icon.className = 'fas fa-book-open';
            icon.style.color = '#34d399';
            icon.style.fontSize = '1.2rem';
            statusEl.textContent = '✅ Access Granted';
            statusEl.style.color = '#6ee7b7';
            card.style.cursor = 'pointer';
            card.style.opacity = '1';
        } else {
            icon.className = 'fas fa-lock';
            icon.style.color = '#fca5a5';
            icon.style.fontSize = '1.2rem';
            statusEl.textContent = '🔒 Premium Subscription Required';
            statusEl.style.color = '#f87171';
            card.style.cursor = 'not-allowed';
            card.style.opacity = '0.6';
        }
        iconWrapper.appendChild(icon);
        card.appendChild(bookClone);
        
        card.onclick = () => {
            if (isUnlocked) { loadAndOpenBook(book); } 
            else { alert(`You do not have premium access to ${book.title}. Please visit the Dashboard to unlock it.`); }
        };
        
        subjectsGrid.appendChild(card);
    });
}

// ==========================================
// 6. GLOBAL SEARCH SYSTEM (SQLITE HTTP-VFS)
// ==========================================
if (globalSearch && searchDropdown) {
    let sqlWorker = window.sqlWorker || null;
    let isSearchEngineLoading = false;
    
    globalSearch.addEventListener('focus', async () => {
        if (!sqlWorker && !isSearchEngineLoading && currentView !== 'book') {
            isSearchEngineLoading = true;
            globalSearch.placeholder = "Booting Search Engine...";
            try {
                const workerUrl = "https://hassaan506.github.io/edeetos/assets/sqlite/sqlite.worker.js";
                const wasmUrl = "https://hassaan506.github.io/edeetos/assets/sqlite/sql-wasm.wasm";
                sqlWorker = await createDbWorker(
                    [{ from: "inline", config: { serverMode: "full", url: `https://hassaan506.github.io/edeetos/Data/${activeCourse}_search_index.sqlite.zip`, requestChunkSize: 4096 } }],
                    workerUrl, wasmUrl, 10 * 1024 * 1024 
                );
                globalSearch.placeholder = "Search keywords among questions...";
            } catch(e) {
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
                    searchDropdown.textContent = '';
                    const div = document.createElement('div');
                    div.className = 'search-item';
                    div.style.color = '#94a3b8';
                    div.textContent = 'Please open a book first to search its contents.';
                    searchDropdown.appendChild(div);
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
                const sqlQuery = `SELECT id, snippet(search_data, 1, '<b>', '</b>', '...', 15) as snippet, subject, chapter, topic, difficulty FROM search_data WHERE search_data MATCH '"${safeQuery}" *' LIMIT 100`;
                const results = await window.sqlWorker.db.query(sqlQuery);
                
                const matchedMeta = results.map(r => {
                    if (unattemptedFilter && unattemptedFilter.checked && (attemptedQuestions.includes(r.id) || globalPracticeMistakes.includes(r.id) || globalExamMistakes.includes(r.id))) return null;
                    if (diffEasyFilter || diffMediumFilter || diffHardFilter) {
                        const easy = diffEasyFilter?.checked; const medium = diffMediumFilter?.checked; const hard = diffHardFilter?.checked;
                        if (easy || medium || hard) {
                            const diff = (r.difficulty || "").toLowerCase().trim();
                            if (!(easy && diff === 'easy') && !(medium && diff === 'medium') && !(hard && diff === 'hard')) { return null; }
                        }
                    }
                    return { id: r.id, QuestionID: r.id, Subject: r.subject, Chapter: r.chapter, Topic: r.topic, Difficulty: r.difficulty, isBookQuestion: false, _snippet: r.snippet };
                }).filter(q => q !== null);
                
                renderSearchResults(matchedMeta, query);
            } catch (e) {}
        }, 300);
    });
}

function renderSearchResults(matchedMeta, query) {
    searchDropdown.textContent = '';
    if (matchedMeta.length === 0) {
        const div = document.createElement('div');
        div.className = 'search-item';
        div.style.color = '#94a3b8';
        div.textContent = `No matches found for "${query}"`;
        searchDropdown.appendChild(div);
    } else {
        const limitCount = Math.min(matchedMeta.length, 50);
        const heroTemplate = document.getElementById('tpl-search-hero');
        const heroClone = heroTemplate.content.cloneNode(true);
        const heroBtn = heroClone.querySelector('.search-hero-btn');
        heroClone.querySelector('.search-hero-text').textContent = `Create Quiz from Search (${limitCount} Qs)`;
        
        heroBtn.onclick = async () => {
            searchDropdown.style.display = 'none';
            globalSearch.value = '';
            const pool = matchedMeta.slice(0, 50);
            const hydratedPool = await window.hydrateQuestions(pool); // Reference global scoped
            window.launchQuiz(hydratedPool, 'practice', 0, `Search: ${query}`);
        };
        searchDropdown.appendChild(heroClone);

        matchedMeta.slice(0, 30).forEach(q => {
            const div = document.createElement('div');
            div.className = 'search-item';
            const titleText = `${q.Subject || q.subject || 'Unknown'} > ${q.Chapter || q.chapter || ''}${q.Topic || q.topic ? '> ' + (q.Topic || q.topic) : ''}`;
            
            const titleDiv = document.createElement('div');
            titleDiv.className = 'search-item-title';
            titleDiv.textContent = titleText;
            
            const snippetDiv = document.createElement('div');
            snippetDiv.className = 'search-item-snippet';
            snippetDiv.style.color = '#94a3b8';
            if (q._snippet) {
                const tempEl = document.createElement('span');
                // Removing raw HTML tags from SQLite return
                tempEl.textContent = q._snippet.replace(/<b>/g, '').replace(/<\/b>/g, '');
                snippetDiv.appendChild(tempEl);
            } else {
                let snippetText = q.question || q.Question || "Click to load question details";
                if (snippetText.length > 80) snippetText = snippetText.substring(0, 80) + '...';
                snippetDiv.textContent = snippetText;
            }

            div.appendChild(titleDiv);
            div.appendChild(snippetDiv);
            
            div.onclick = async () => {
                searchDropdown.style.display = 'none';
                globalSearch.value = '';
                const hydratedPool = await window.hydrateQuestions([q]); // Reference global scoped
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
        
        if (!window.sqlWorker && !window.isSearchEngineLoading) {
            window.isSearchEngineLoading = true;
            try {
                const workerUrl = "https://hassaan506.github.io/edeetos/assets/sqlite/sqlite.worker.js";
                const wasmUrl = "https://hassaan506.github.io/edeetos/assets/sqlite/sql-wasm.wasm";
                window.sqlWorker = await createDbWorker(
                    [{ from: "inline", config: { serverMode: "full", url: `https://hassaan506.github.io/edeetos/Data/${activeCourse}_search_index.sqlite.zip`, requestChunkSize: 4096 } }],
                    workerUrl, wasmUrl, 10 * 1024 * 1024 
                );
            } catch(e) {}
            window.isSearchEngineLoading = false;
        }

        renderGrid();
        fetchAllMetadata();
    } catch (error) {}
}

async function fetchAllMetadata() {
    if (!subjectTree || Object.keys(subjectTree).length === 0) return;
    const subjects = Object.keys(subjectTree);
    const promises = subjects.map(async (subj) => {
        const subjClean = sanitizeFilename(subj);
        try {
            const res = await fetch(`Data/${activeCourse}/metadata/${subjClean}.json`);
            if (res.ok) { return await res.json(); }
        } catch (e) {}
        return [];
    });
    
    const results = await Promise.all(promises);
    globalMetadata = results.flat();
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
                if (pth.length >= 2) { urls.add(`Data/${activeCourse}/subjects/${sanitizeFilename(pth[0])}_${sanitizeFilename(pth[1])}.json`); return; }
                if (typeof obj === 'number') return;
                for (let k in obj) traverseSubj(obj[k], [...pth, k]);
            };
            traverseSubj(current, pathArr);
        } 
        else if (view === 'system') {
            let current = systemTree;
            for (let p of pathArr) { if (current[p]) current = current[p]; else return; }
            const traverseSys = (obj, pth) => {
                if (pth.length >= 2) { urls.add(`Data/${activeCourse}/systems/${sanitizeFilename(pth[0])}_${sanitizeFilename(pth[1])}.json`); return; }
                if (typeof obj === 'number') return;
                for (let k in obj) traverseSys(obj[k], [...pth, k]);
            };
            traverseSys(current, pathArr);
        } 
        else if (view === 'exam') {
            let current = examTree;
            for (let p of pathArr) { if (current[p]) current = current[p]; else return; }
            const traverseEx = (obj, pth) => {
                if (pth.length >= 3) { urls.add(`Data/${activeCourse}/exams/${sanitizeFilename(pth[0])}_${sanitizeFilename(pth[1])}_${sanitizeFilename(pth[2])}.json`); return; }
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
                    if (res.ok) { window.activeChunksCache[pageUrl] = await res.json(); } 
                    else { window.activeChunksCache[pageUrl] = []; keepFetching = false; }
                } catch(e) { window.activeChunksCache[pageUrl] = []; keepFetching = false; }
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
    if (popupList) popupList.textContent = '';
    if (popupOverlay) popupOverlay.style.display = 'flex';
    if (popupBack) popupBack.style.display = popupHistory.length > 1 ? 'inline-block' : 'none';

    const tplSelectAll = document.getElementById('tpl-popup-select-all');
    if (tplSelectAll && popupList) {
        const clone = tplSelectAll.content.cloneNode(true);
        clone.querySelector('.popup-select-title').textContent = `Select Full ${title}`;
        const selectBtn = clone.querySelector('.popup-select-btn');
        
        selectBtn.onclick = () => {
            const allCbs = popupList.querySelectorAll('.item-checkbox');
            let allAreChecked = true;
            allCbs.forEach(cb => { if (!cb.checked) allAreChecked = false; });
            allCbs.forEach(cb => {
                cb.checked = !allAreChecked;
                cb.dispatchEvent(new Event('change'));
            });
            selectBtn.textContent = allAreChecked ? 'Select All' : 'Deselect All';
        };
        popupList.appendChild(clone);
    }

    if (Array.isArray(dataObj)) {
        let sortedTopics = [...dataObj].sort((a, b) => a.localeCompare(b));
        sortedTopics.forEach(topic => renderListItem(topic, null, 'Topic', [...pathArr, topic]));
    } else {
        let keys = Object.keys(dataObj);
        if (currentView === 'exam' && level === 'Level1') {
            const parseSortDetails = (str) => {
                const parts = str.split('-').map(p => p.trim());
                const subject = (parts[0] || str).toLowerCase();
                let year = 9999; let month = 99; let day = 99;
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
                        if (lowerStr.includes(months[i])) { month = i + 1; break; }
                    }
                }
                const dayMatch = lowerStr.match(/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*[-–]?\s*(\d{1,2})\b/) || lowerStr.match(/\b(\d{1,2})\s*[-–]?\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/);
                if (dayMatch) { day = parseInt(dayMatch[1], 10); } 
                else if (parts[2]) {
                    const partDayMatch = parts[2].match(/\b(\d{1,2})\b/);
                    if (partDayMatch) day = parseInt(partDayMatch[1], 10);
                }
                const shiftMap = { 'morning': 1, 'afternoon': 2, 'evening': 3, 'night': 4 };
                let shiftPriority = 99;
                for (const [shiftKey, priority] of Object.entries(shiftMap)) {
                    if (lowerStr.includes(shiftKey)) { shiftPriority = priority; break; }
                }
                return { subject, year, month, day, shiftPriority };
            };

            keys.sort((a, b) => {
                const itemA = parseSortDetails(a); const itemB = parseSortDetails(b);
                if (itemA.subject !== itemB.subject) return itemA.subject.localeCompare(itemB.subject);
                if (itemA.year !== itemB.year) return itemA.year - itemB.year;
                if (itemA.month !== itemB.month) return itemA.month - itemB.month;
                if (itemA.day !== itemB.day) return itemA.day - itemB.day;
                if (itemA.shiftPriority !== itemB.shiftPriority) return itemA.shiftPriority - itemB.shiftPriority;
                return a.localeCompare(b);
            });
        } else {
            keys.sort((a, b) => a.localeCompare(b));
        }
        keys.forEach(key => renderListItem(key, dataObj[key], level, [...pathArr, key]));
    }
}

function renderListItem(itemName, nextData, level, itemPath) {
    const qCount = getQuestionCount(currentView, itemPath);
    const filtersActive = (unattemptedFilter && unattemptedFilter.checked) || (diffEasyFilter && diffEasyFilter.checked) || (diffMediumFilter && diffMediumFilter.checked) || (diffHardFilter && diffHardFilter.checked);
    if (qCount === 0 && filtersActive) return;

    const doneCount = getSolvedCount(currentView, itemPath);
    const template = document.getElementById('tpl-list-item-content');
    
    const itemDiv = document.createElement('div');
    itemDiv.className = 'list-item';
    const clone = template.content.cloneNode(true);
    
    clone.querySelector('.item-name').textContent = itemName;
    const countWrapper = clone.querySelector('.count-wrapper');
    const progWrapper = clone.querySelector('.progress-wrapper');
    const statsWrapper = clone.querySelector('.stats-wrapper');

    if (typeof isGlobalPopupActive !== 'undefined' && isGlobalPopupActive) {
        const cBadge = document.createElement('span');
        cBadge.className = 'card-count';
        cBadge.textContent = `${qCount} Qs`;
        countWrapper.appendChild(cBadge);
    } else {
        const percent = qCount > 0 ? Math.round((doneCount / qCount) * 100) : 0;
        const cBadge = document.createElement('span');
        cBadge.className = 'card-count';
        cBadge.textContent = `${doneCount} /${qCount}`;
        countWrapper.appendChild(cBadge);

        const progCont = document.createElement('div');
        progCont.className = 'progress-container';
        const progFill = document.createElement('div');
        progFill.className = 'progress-bar-fill';
        progFill.style.width = `${percent}%`;
        progCont.appendChild(progFill);
        progWrapper.appendChild(progCont);
    }

    if (currentView === 'exam') {
        const mistakeCount = getMistakesCount(currentView, itemPath);
        const totalAttempts = doneCount + mistakeCount;
        const accuracy = totalAttempts > 0 ? Math.round((doneCount / totalAttempts) * 100) : 0;

        const accClass = totalAttempts === 0 ? 'badge-gray' : (accuracy >= 75 ? 'badge-green' : (accuracy >= 50 ? 'badge-yellow' : 'badge-red'));
        const badgeCont = document.createElement('div');
        badgeCont.className = 'acc-badge-container';
        badgeCont.style.marginLeft = '28px';

        const solvedBadge = createBadge('fas fa-check', `${doneCount} Solved`, 'badge-green');
        const mistakeBadge = createBadge('fas fa-times', `${mistakeCount} Mistakes`, 'badge-red');
        const accBadgeStr = totalAttempts > 0 ? `${accuracy}% Accuracy` : 'Unattempted';
        const accBadge = createBadge('fas fa-bullseye', accBadgeStr, accClass);

        badgeCont.appendChild(solvedBadge);
        badgeCont.appendChild(mistakeBadge);
        badgeCont.appendChild(accBadge);
        statsWrapper.appendChild(badgeCont);
    }

    const pathStr = JSON.stringify(itemPath);
    const instBtn = clone.querySelector('.instant-start-btn');
    if (currentMode === 'exam') {
        instBtn.style.display = 'none';
    } else {
        instBtn.setAttribute('data-path', encodeURIComponent(pathStr));
        instBtn.onclick = (e) => {
            e.stopPropagation();
            if (window.startInstantPractice) window.startInstantPractice(instBtn.getAttribute('data-path'));
        };
    }

    const cb = clone.querySelector('.item-checkbox');
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

    itemDiv.onclick = (e) => {
        if (e.target !== cb && e.target.tagName !== 'BUTTON') {
            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event('change'));
        }
    };

    const hasSubLevels = typeof nextData === 'object' && nextData !== null && Object.keys(nextData).length > 0;
    itemDiv.appendChild(clone);

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
    if (customPool !== null && customPool.length === 0) return 0;
    
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
    const noFiltersActive = (!diffEasyFilter?.checked && !diffMediumFilter?.checked && !diffHardFilter?.checked && !unattemptedFilter?.checked);

    if (isDefaultPool && noFiltersActive && !isGlobalPopupActive) {
        let tree = {};
        if (view === 'subject') tree = subjectTree;
        else if (view === 'system') tree = systemTree;
        else if (view === 'exam') tree = examTree;
        else if (view === 'book') {
            let current = activeCustomPool ? buildSubTree(activeCustomPool) : {};
            const subjects = Object.keys(current);
            if (subjects.length > 0) current = current[subjects[0]];
            for (let p of paths) {
                if (current && current[p]) current = current[p]; else return 0;
            }
            return getTreeCount(current);
        }
        
        if (Object.keys(tree).length > 0) {
            let current = tree;
            for(let p of paths) {
                if(current && current[p]) current = current[p]; else return 0;
            }
            return getTreeCount(current);
        }
    }

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
                if (maxLen === 0) { if (paths[0] && paths[0] !== "Unknown Year") return false; }
                
                for (let i = 0; i < maxLen; i++) {
                    const fbYear = qYears[i] !== undefined ? qYears[i] : (qYears[qYears.length - 1] || "Unknown Year");
                    const fbSpec = qSpecs[i] !== undefined ? qSpecs[i] : (qSpecs[qSpecs.length - 1] || "Unknown Specialty");
                    const rawExam = qExams[i] !== undefined ? qExams[i] : (qExams[qExams.length - 1] || "Unknown Exam");
                    
                    const parsed = parseExamInfo(rawExam, fbYear, fbSpec);
                    let currentMatch = true;
                    if (paths[0] && parsed.examYear !== paths[0]) currentMatch = false;
                    if (paths[1] && parsed.examSpec !== paths[1]) currentMatch = false;
                    if (paths[2] && rawExam !== paths[2]) currentMatch = false;
                    
                    if (currentMatch) { matchFound = true; break; }
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
        cachedAttemptedPool = { poolRef: pool, data: pool.filter(q => window.fastAttemptedSet && window.fastAttemptedSet.has(getQID(q))) };
    }
    return getQuestionCount(view, pathArr, cachedAttemptedPool.data);
}

function getMistakesCount(view, pathArr) {
    const pool = activeCustomPool || globalMetadata;
    if (!cachedMistakesPool || cachedMistakesPool.poolRef !== pool) {
        const allMistakesSet = new Set([...globalPracticeMistakes, ...globalExamMistakes]);
        cachedMistakesPool = { poolRef: pool, data: pool.filter(q => allMistakesSet.has(getQID(q))) };
    }
    return getQuestionCount(view, pathArr, cachedMistakesPool.data);
}

window.hydrateQuestions = hydrateQuestions;
window.switchMode = switchMode;
window.startInstantPractice = startInstantPractice;
window.launchQuiz = launchQuiz;
window.generateRevisionQuiz = generateRevisionQuiz;

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

    const modePracBtn = document.getElementById('mode-practice');
    const modeExamBtn = document.getElementById('mode-exam');

    if (mode === 'practice') {
        if (modePracBtn) { modePracBtn.classList.add('active-mode', 'btn-mode-practice'); }
        if (modeExamBtn) { modeExamBtn.classList.remove('active-mode', 'btn-filled-blue'); }
        
        if (qCountInput && qCountInput.parentElement) qCountInput.parentElement.style.display = 'flex';
        if (timerInput && timerInput.parentElement) timerInput.parentElement.style.display = 'none';
        if (modeDesc) modeDesc.textContent = "Practice Mode: Select your topics below. Enjoy instant feedback and detailed explanations.";
        
        if (searchBar) {
            if (searchBar.contains(document.getElementById('subjects-grid'))) {
                Array.from(searchBar.children).forEach(child => {
                    if (child.id !== 'subjects-grid' && child.id !== 'mock-exam-modal' && child.id !== 'exam-cart') { child.style.display = ''; }
                });
            } else { searchBar.style.display = "flex"; }
        }
    } else {
        if (modeExamBtn) { modeExamBtn.classList.add('active-mode', 'btn-filled-blue'); }
        if (modePracBtn) { modePracBtn.classList.remove('active-mode', 'btn-mode-practice'); }
        
        if (qCountInput && qCountInput.parentElement) qCountInput.parentElement.style.display = 'flex';
        if (timerInput && timerInput.parentElement) timerInput.parentElement.style.display = 'flex';
        if (modeDesc) modeDesc.textContent = "Exam Mode: Strict timer, no instant feedback, skipped questions appear at the end.";
        
        if (searchBar) {
            if (searchBar.contains(document.getElementById('subjects-grid'))) {
                Array.from(searchBar.children).forEach(child => {
                    if (child.id !== 'subjects-grid' && child.id !== 'mock-exam-modal' && child.id !== 'exam-cart') { child.style.display = 'none'; }
                });
            } else { searchBar.style.display = "none"; }
        }
    }
    
    // Note: renderBooksGrid and renderGrid are declared in Part 1
    if (currentView === 'book') renderBooksGrid();
    else renderGrid();

    if (popupOverlay && popupOverlay.style.display === 'flex') {
        const current = popupHistory[popupHistory.length - 1];
        if (current) {
            popupHistory.pop(); 
            // Note: openPopup is declared in Part 1
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
const joinChallengeModal = document.getElementById('join-challenge-modal');

if (btnJoinChallenge) {
    btnJoinChallenge.addEventListener('click', () => {
        if (localStorage.getItem('edeetos_guest_mode') === 'true') {
            return alert("Please register to join a challenge.");
        }
        if (joinChallengeModal) {
            joinChallengeModal.style.display = "flex";
            const inputField = document.getElementById('challenge-code-input');
            if (inputField) inputField.focus();
        }
    });
}

if (document.getElementById('btn-cancel-join')) {
    document.getElementById('btn-cancel-join').addEventListener('click', () => {
        if (joinChallengeModal) joinChallengeModal.style.display = "none";
    });
}

if (document.getElementById('btn-confirm-join')) {
    const processJoin = async () => {
        const inputField = document.getElementById('challenge-code-input');
        if (!inputField) return;
        const code = inputField.value.trim().toUpperCase();
        if (!code || code.length !== 5) {
            inputField.style.borderColor = '#ef4444';
            return;
        }

        const confirmBtn = document.getElementById('btn-confirm-join');
        confirmBtn.textContent = 'Loading...';
        confirmBtn.disabled = true;
        
        try {
            const challengeSnap = await getDoc(doc(db, "friend_challenges", code));
            if (!challengeSnap.exists()) {
                alert("Invalid or expired Challenge Code.");
                confirmBtn.textContent = 'Join Match';
                confirmBtn.disabled = false;
                return;
            }
            
            const challengeData = challengeSnap.data();
            localStorage.setItem('edeetos_challenge_data', JSON.stringify(challengeData));
            document.body.style.cursor = 'wait';
            
            let hydratedQueue = [];
            try {
                const activeCourse = localStorage.getItem('edeetos_active_course') || 'fcps_part1';
                const hierarchyRes = await fetch(`Data/${activeCourse}_hierarchy.json`);
                const hierarchyData = await hierarchyRes.json();
                const subjects = Object.keys(hierarchyData.subjects || {});
                
                const metaPromises = subjects.map(async (subj) => {
                    const subjClean = String(subj).toLowerCase().trim().replace(/[\\/*?:"<>|\\s]+/g, '_').replace(/^_+|_+$/g, '');
                    try {
                        const res = await fetch(`Data/${activeCourse}/metadata/${subjClean}.json`);
                        if (res.ok) return await res.json();
                    } catch(e) {}
                    return [];
                });
                
                const allMetaArrays = await Promise.all(metaPromises);
                const globalMetadataLocal = allMetaArrays.flat();
                
                const chunksToLoad = new Set();
                challengeData.questionIds.forEach(id => {
                    const meta = globalMetadataLocal.find(q => String(q.id || q.QuestionID) === String(id));
                    if (meta) {
                        const s = String(meta.Subject || meta.subject).toLowerCase().trim().replace(/[\\/*?:"<>|\\s]+/g, '_').replace(/^_+|_+$/g, '');
                        const c = String(meta.Chapter || meta.chapter).toLowerCase().trim().replace(/[\\/*?:"<>|\\s]+/g, '_').replace(/^_+|_+$/g, '');
                        chunksToLoad.add(`Data/${activeCourse}/subjects/${s}_${c}.json`);
                    }
                });

                const activeChunksCacheLocal = {};
                const fetchPromises = Array.from(chunksToLoad).map(async (baseUrl) => {
                    let page = 1;
                    let keepFetching = true;
                    while (keepFetching) {
                        const pageUrl = baseUrl.replace('.json', `_${page}.json`);
                        try {
                            const res = await fetch(pageUrl);
                            if (res.ok) activeChunksCacheLocal[pageUrl] = await res.json();
                            else keepFetching = false;
                        } catch(e) { keepFetching = false; }
                        page++;
                    }
                });
                await Promise.all(fetchPromises);

                const fullQuestionsMap = {};
                Object.values(activeChunksCacheLocal).forEach(chunkArray => {
                    chunkArray.forEach(fullQ => {
                        const qId = fullQ.id || fullQ.QuestionID;
                        if (qId) fullQuestionsMap[String(qId)] = fullQ;
                    });
                });

                hydratedQueue = challengeData.questionIds.map(id => fullQuestionsMap[String(id)]).filter(q => q);
            } catch (err) {}

            if (hydratedQueue.length === 0) {
                document.body.style.cursor = 'default';
                confirmBtn.textContent = 'Join Match';
                confirmBtn.disabled = false;
                return alert("Failed to load challenge questions.");
            }
            
            const request = indexedDB.open("EdeetosDB", 1);
            request.onupgradeneeded = (e) => {
                const idb = e.target.result;
                if (!idb.objectStoreNames.contains("quiz_sessions")) idb.createObjectStore("quiz_sessions");
            };
            request.onsuccess = (e) => {
                const idb = e.target.result;
                const tx = idb.transaction("quiz_sessions", "readwrite");
                tx.objectStore("quiz_sessions").put(hydratedQueue, "active_quiz_queue");
                tx.oncomplete = () => {
                    localStorage.setItem('edeetos_quiz_config', JSON.stringify({ mode: 'exam', timer: challengeData.calcMinutes, examName: 'Friend Challenge vs ' + challengeData.hostName }));
                    window.location.href = 'quiz.html';
                };
            };
        } catch (err) {
            alert("Failed to load friend challenge.");
            confirmBtn.textContent = 'Join Match';
            confirmBtn.disabled = false;
        }
    };
    
    document.getElementById('btn-confirm-join').addEventListener('click', processJoin);
    if (document.getElementById('challenge-code-input')) {
        document.getElementById('challenge-code-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') processJoin();
        });
    }
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
            const sqlQuery = `SELECT id, subject, chapter, topic, difficulty FROM search_data ORDER BY RANDOM() LIMIT 500`;
            const results = await window.sqlWorker.db.query(sqlQuery);
            const allMistakes = [...new Set([...globalPracticeMistakes, ...globalExamMistakes])];
            
            let metaPool = results.map(r => ({ id: r.id, QuestionID: r.id, Subject: r.subject, Chapter: r.chapter, Topic: r.topic, Difficulty: r.difficulty, isBookQuestion: false })).filter(q => !attemptedQuestions.includes(q.id) && !allMistakes.includes(q.id));
            if (metaPool.length < count) {
                metaPool = results.map(r => ({ id: r.id, QuestionID: r.id, Subject: r.subject, Chapter: r.chapter, Topic: r.topic, Difficulty: r.difficulty, isBookQuestion: false }));
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
            launchQuiz(finalPool, 'exam', calcMinutes, `Mock Exam (${count} Qs)`);
        } catch (e) {
            btnStartMock.textContent = "Start Exam";
            btnStartMock.disabled = false;
            alert("Failed to generate mock exam from database.");
        }
    });
}

if (startExamBtn) {
    startExamBtn.addEventListener('click', async () => {
        const paths = Array.from(selectedCart).map(str => JSON.parse(str));
        startExamBtn.textContent = 'Loading...';
        startExamBtn.disabled = true;

        // fetchRequiredChunks and getQuestionCount are declared in Part 1
        let sourcePool = currentView === 'book' ? (activeCustomPool || allQuestions) : await fetchRequiredChunks(currentView, paths);
        let pool = sourcePool.filter(q => { return paths.some(pathArr => getQuestionCount(currentView, pathArr, [q]) > 0); });

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
        launchQuiz(pool, currentMode, currentMode === 'exam' ? timerInput : 0, generatedTitle);
    });
}

async function hydrateQuestions(metadataPool) {
    const needsHydration = metadataPool.filter(q => !q.isBookQuestion && !q.question); 
    if (needsHydration.length === 0) return metadataPool;

    document.body.style.cursor = 'wait';
    const chunksToLoad = new Set();
    needsHydration.forEach(q => {
        const s = sanitizeFilename(q.Subject || q.subject || 'Uncategorized'); // sanitizeFilename in Part 1
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
            } else if (window.activeChunksCache[pageUrl].length === 0) { keepFetching = false; }
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

function startInstantPractice(encodedPath) {
    if (currentMode === 'exam') return alert("To take an Exam, please check the box and use the Start Exam button at the bottom to set a timer.");
    const pathArr = JSON.parse(decodeURIComponent(encodedPath));
    
    (async () => {
        let sourcePool = activeCustomPool;
        if (currentView !== 'book') {
            const chunks = await fetchRequiredChunks(currentView, [pathArr]); // fetchRequiredChunks in Part 1
            sourcePool = chunks.length > 0 ? chunks : globalMetadata;
        }
        let finalPool = sourcePool.filter(q => getQuestionCount(currentView, pathArr, [q]) > 0); // getQuestionCount in Part 1
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
        launchQuiz(finalPool, 'practice', 0, generatedTitle);
    })();
}

function launchQuiz(questionsArray, mode = 'practice', timerMinutes = 0, examName = "Practice Session") {
    if (!questionsArray || questionsArray.length === 0) return alert("No questions found for this selection!");
    const roomId = localStorage.getItem('active_study_room');
    const isGuest = localStorage.getItem('is_study_guest') === 'true';

    let safeStorageArray = questionsArray;
    if (safeStorageArray.length > 200) {
        alert(`Your selection has ${questionsArray.length} questions. Capping to 200 to prevent browser crashes.`);
        safeStorageArray = safeStorageArray.sort(() => 0.5 - Math.random()).slice(0, 200);
    }
    const cleanPool = JSON.parse(JSON.stringify(safeStorageArray));

    if (roomId && !isGuest) {
        (async () => {
            try {
                document.body.style.cursor = 'wait';
                let roomPool = cleanPool;
                if (roomPool.length > 50) roomPool = roomPool.slice(0, 50);
                const questionIdsOnly = roomPool.map(q => String(q.id || q.QuestionID));
                await setDoc(doc(db, "study_rooms", roomId), {
                    questionIds: questionIdsOnly,
                    quizConfig: { mode, timer: timerMinutes, examName },
                    status: 'playing', currentQuestionIndex: 0, answers: {}, memberAnswers: {}, forceReveal: {}, hostId: auth.currentUser ? auth.currentUser.uid : null
                }, { merge: true });
            } catch (error) {
                alert("Firebase Error: " + error.message);
                document.body.style.cursor = 'default';
                return;
            }
            proceedToQuiz();
        })();
    } else {
        proceedToQuiz();
    }

    function proceedToQuiz() {
        const staleKeys = [ 'edeetos_saved_quiz_state', 'edeetos_quiz_state', 'edeetos_exam_progress', 'edeetos_active_quiz_session', 'quiz_in_progress', 'edeetos_active_quiz' ];
        staleKeys.forEach(key => { localStorage.removeItem(key); sessionStorage.removeItem(key); });
        localStorage.setItem('edeetos_quiz_config', JSON.stringify({ mode: mode, timer: timerMinutes, examName: examName }));
        document.body.style.cursor = 'wait';
        
        const idbRequest = indexedDB.open("EdeetosDB", 1);
        idbRequest.onupgradeneeded = (e) => {
            const idb = e.target.result;
            if (!idb.objectStoreNames.contains("quiz_sessions")) { idb.createObjectStore("quiz_sessions"); }
        };

        idbRequest.onsuccess = (e) => {
            const idb = e.target.result;
            const tx = idb.transaction("quiz_sessions", "readwrite");
            const store = tx.objectStore("quiz_sessions");
            store.put(cleanPool, "active_quiz_queue");
            try { store.delete("active_quiz_state"); store.delete("saved_session"); } catch (err) {}
            tx.oncomplete = () => { document.body.style.cursor = 'default'; window.location.href = 'quiz.html'; };
            tx.onerror = () => { document.body.style.cursor = 'default'; window.location.href = 'quiz.html'; };
        };
        idbRequest.onerror = () => { document.body.style.cursor = 'default'; window.location.href = 'quiz.html'; };
    }
}

function generateExamTitle(paths, currentView) {
    if (!paths || paths.length === 0) return "Custom Practice";
    const topLevels = new Set();
    const subLevels = new Set();
    paths.forEach(p => { if (p[0]) topLevels.add(p[0]); if (p[1]) subLevels.add(p[1]); });
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
const hostExitModal = document.getElementById('host-exit-modal');

if (activeRoomId) {
    if (isGuest) {
        localStorage.removeItem('active_study_room');
        localStorage.removeItem('is_study_guest');
    } else {
        const hostBanner = document.getElementById('host-banner');
        const hostRoomIdEl = document.getElementById('host-room-id');
        if (hostBanner && hostRoomIdEl) {
            hostRoomIdEl.textContent = activeRoomId;
            hostBanner.style.display = 'flex';
            
            document.getElementById('btn-exit-host-room').addEventListener('click', () => {
                const exitRoomIdEl = document.getElementById('exit-room-id');
                if (exitRoomIdEl) exitRoomIdEl.textContent = activeRoomId;
                if (hostExitModal) hostExitModal.style.display = 'flex';
            });
            
            document.getElementById('btn-cancel-exit').onclick = () => {
                if (hostExitModal) hostExitModal.style.display = 'none';
            };
            
            document.getElementById('btn-leave-only').onclick = async () => {
                const btn = document.getElementById('btn-leave-only');
                btn.textContent = 'Leaving...';
                btn.disabled = true;
                try {
                    if (auth.currentUser) {
                        await updateDoc(doc(db, "study_rooms", activeRoomId), { [`activeMembers.${auth.currentUser.uid}`]: deleteField() });
                    }
                } catch(e) {}
                localStorage.removeItem('active_study_room');
                localStorage.removeItem('is_study_guest');
                hostBanner.style.display = 'none';
                if (hostExitModal) hostExitModal.style.display = 'none';
            };

            document.getElementById('btn-end-room').onclick = async () => {
                const btn = document.getElementById('btn-end-room');
                btn.textContent = 'Ending...';
                btn.disabled = true;
                try { await updateDoc(doc(db, "study_rooms", activeRoomId), { status: 'ended' }); } catch(e) {}
                localStorage.removeItem('active_study_room');
                localStorage.removeItem('is_study_guest');
                hostBanner.style.display = 'none';
                if (hostExitModal) hostExitModal.style.display = 'none';
            };
        }
    }
}

// ==========================================
// 11. SMART ANALYTICS ENGINE
// ==========================================
const btnAnalytics = document.getElementById('btn-view-analytics');
const analyticsModal = document.getElementById('analytics-modal');

if (btnAnalytics) {
    btnAnalytics.onclick = () => {
        if (localStorage.getItem('edeetos_guest_mode') === 'true') return alert("Please register an account to view detailed Analytics.");
        const body = document.getElementById('analytics-body');
        if (!body) return;
        body.textContent = ''; 

        let stats = {};
        const allMistakes = [...new Set([...globalPracticeMistakes, ...globalExamMistakes])];
        const allMistakesSet = new Set(allMistakes);
        const attemptedSet = new Set(attemptedQuestions);

        globalMetadata.forEach(q => {
            const topicName = q.Topic || q.topic || q.Chapter || q.chapter || q.Subject || q.subject || "Core Material";
            const qId = getQID(q); // getQID is in Part 1
            if (!stats[topicName]) { stats[topicName] = { total: 0, attempted: 0, mistakes: 0, questions: [] }; }
            stats[topicName].total++;
            stats[topicName].questions.push(q);
            if (attemptedSet.has(qId) || allMistakesSet.has(qId)) {
                stats[topicName].attempted++;
                if (allMistakesSet.has(qId)) stats[topicName].mistakes++;
            }
        });

        let processedTopics = Object.keys(stats).map(topic => {
            const d = stats[topic];
            return { topic: topic, attempted: d.attempted, mistakes: d.mistakes, accuracy: d.attempted > 0 ? Math.round(((d.attempted - d.mistakes) / d.attempted) * 100) : 0, pool: d.questions };
        }).filter(t => t.attempted >= 3);

        let weaknesses = processedTopics.filter(t => t.accuracy < 70).sort((a, b) => a.accuracy - b.accuracy || b.mistakes - a.mistakes).slice(0, 4);
        let strengths = processedTopics.filter(t => t.accuracy >= 70).sort((a, b) => b.accuracy - a.accuracy).slice(0, 4);

        if (processedTopics.length === 0) {
            const tplEmpty = document.getElementById('tpl-analytics-empty');
            if (tplEmpty) body.appendChild(tplEmpty.content.cloneNode(true));
        } else {
            const tplContent = document.getElementById('tpl-analytics-content');
            const clone = tplContent.content.cloneNode(true);
            
            const priorityCont = clone.querySelector('.priority-content');
            if (weaknesses.length === 0) {
                const emptyMsg = document.createElement('div');
                emptyMsg.style.color = '#6ee7b7'; emptyMsg.style.fontWeight = 'bold'; emptyMsg.style.fontSize = '0.85rem';
                emptyMsg.textContent = '✅ No critical weaknesses!';
                priorityCont.appendChild(emptyMsg);
            } else {
                weaknesses.forEach(w => {
                    const item = document.createElement('div');
                    item.style.marginBottom = '10px'; item.style.paddingBottom = '10px'; item.style.borderBottom = '1px solid rgba(239,68,68,0.2)';
                    const row1 = document.createElement('div');
                    row1.style.display = 'flex'; row1.style.justifyContent = 'space-between'; row1.style.fontSize = '0.85rem'; row1.style.fontWeight = 'bold'; row1.style.color = '#f87171';
                    const spanT = document.createElement('span'); spanT.style.whiteSpace = 'nowrap'; spanT.style.overflow = 'hidden'; spanT.style.textOverflow = 'ellipsis'; spanT.style.maxWidth = '70%'; spanT.textContent = w.topic;
                    const spanA = document.createElement('span'); spanA.textContent = `${w.accuracy}%`;
                    row1.appendChild(spanT); row1.appendChild(spanA);
                    const row2 = document.createElement('div');
                    row2.style.fontSize = '0.75rem'; row2.style.color = '#fca5a5'; row2.style.marginTop = '4px'; row2.textContent = `${w.mistakes} mistakes / ${w.attempted} attempts`;
                    item.appendChild(row1); item.appendChild(row2);
                    priorityCont.appendChild(item);
                });
            }

            const strengthCont = clone.querySelector('.strength-content');
            if (strengths.length === 0) {
                const emptyMsg = document.createElement('div');
                emptyMsg.style.color = '#94a3b8'; emptyMsg.style.fontSize = '0.85rem';
                emptyMsg.textContent = 'Keep practicing to build your strengths!';
                strengthCont.appendChild(emptyMsg);
            } else {
                strengths.forEach(s => {
                    const item = document.createElement('div');
                    item.style.marginBottom = '10px'; item.style.paddingBottom = '10px'; item.style.borderBottom = '1px solid rgba(16,185,129,0.2)';
                    const row1 = document.createElement('div');
                    row1.style.display = 'flex'; row1.style.justifyContent = 'space-between'; row1.style.fontSize = '0.85rem'; row1.style.fontWeight = 'bold'; row1.style.color = '#34d399';
                    const spanT = document.createElement('span'); spanT.style.whiteSpace = 'nowrap'; spanT.style.overflow = 'hidden'; spanT.style.textOverflow = 'ellipsis'; spanT.style.maxWidth = '70%'; spanT.textContent = s.topic;
                    const spanA = document.createElement('span'); spanA.textContent = `${s.accuracy}%`;
                    row1.appendChild(spanT); row1.appendChild(spanA);
                    const row2 = document.createElement('div');
                    row2.style.fontSize = '0.75rem'; row2.style.color = '#a7f3d0'; row2.style.marginTop = '4px'; row2.textContent = `Mastered ${s.attempted - s.mistakes} / ${s.attempted}`;
                    item.appendChild(row1); item.appendChild(row2);
                    strengthCont.appendChild(item);
                });
            }

            const smartHubActions = clone.querySelector('.smart-hub-actions');
            const totalMistakesCount = allMistakes.length;
            if (totalMistakesCount > 0) {
                const btn = document.createElement('button');
                btn.id = 'btn-train-redemption';
                btn.className = 'action-btn btn-outline-amber-alt';
                btn.style.textAlign = 'left'; btn.style.display = 'flex'; btn.style.justifyContent = 'space-between'; btn.style.flexWrap = 'wrap'; btn.style.gap = '8px';
                
                const span1 = document.createElement('span'); span1.style.fontWeight = 'bold'; span1.style.flex = '1';
                const i = document.createElement('i'); i.className = 'fas fa-sync-alt'; i.style.marginRight = '8px';
                span1.appendChild(i); span1.appendChild(document.createTextNode(' Redemption Mode'));
                
                const span2 = document.createElement('span'); span2.className = 'rev-day-badge'; span2.textContent = `Revisit ${totalMistakesCount} Mistakes`;
                btn.appendChild(span1); btn.appendChild(span2);
                smartHubActions.appendChild(btn);
            }
            if (weaknesses.length > 0) {
                const btn = document.createElement('button');
                btn.id = 'btn-train-focus';
                btn.className = 'action-btn btn-filled-red';
                btn.style.textAlign = 'left'; btn.style.display = 'flex'; btn.style.justifyContent = 'space-between'; btn.style.flexWrap = 'wrap'; btn.style.gap = '8px';
                
                const span1 = document.createElement('span'); span1.style.fontWeight = 'bold'; span1.style.flex = '1';
                const i = document.createElement('i'); i.className = 'fas fa-bullseye'; i.style.marginRight = '8px';
                span1.appendChild(i); span1.appendChild(document.createTextNode(' Targeted Focus'));
                
                const span2 = document.createElement('span'); span2.className = 'rev-day-badge'; span2.textContent = `Drill 15 Qs on Weakest Topic`;
                btn.appendChild(span1); btn.appendChild(span2);
                smartHubActions.appendChild(btn);
            }
            if (strengths.length > 0 && weaknesses.length > 0) {
                const btn = document.createElement('button');
                btn.id = 'btn-train-mix';
                btn.className = 'action-btn btn-filled-blue';
                btn.style.textAlign = 'left'; btn.style.display = 'flex'; btn.style.justifyContent = 'space-between'; btn.style.flexWrap = 'wrap'; btn.style.gap = '8px';
                
                const span1 = document.createElement('span'); span1.style.fontWeight = 'bold'; span1.style.flex = '1';
                const i = document.createElement('i'); i.className = 'fas fa-balance-scale'; i.style.marginRight = '8px';
                span1.appendChild(i); span1.appendChild(document.createTextNode(' Balanced Mix'));
                
                const span2 = document.createElement('span'); span2.className = 'rev-day-badge'; span2.textContent = `30 Qs (Strengths + Weaknesses)`;
                btn.appendChild(span1); btn.appendChild(span2);
                smartHubActions.appendChild(btn);
            }

            const recentExamsCont = clone.querySelector('.recent-exams-container');
            if (userExamHistory.length === 0) {
                const msg = document.createElement('p'); msg.style.fontSize = '0.8rem'; msg.style.color = '#94a3b8'; msg.style.textAlign = 'center'; msg.textContent = 'No exams taken yet.';
                recentExamsCont.appendChild(msg);
            } else {
                const chartWrap = document.createElement('div'); chartWrap.style.width = '100%'; chartWrap.style.height = '200px'; chartWrap.style.marginBottom = '20px';
                const canvas = document.createElement('canvas'); canvas.id = 'examScoreChart';
                chartWrap.appendChild(canvas);
                recentExamsCont.appendChild(chartWrap);
                
                const tableWrap = document.createElement('div'); tableWrap.style.fontSize = '0.85rem'; tableWrap.style.maxHeight = '180px'; tableWrap.style.overflowY = 'auto';
                const table = document.createElement('table'); table.style.width = '100%'; table.style.textAlign = 'left'; table.style.borderCollapse = 'collapse'; table.style.tableLayout = 'fixed';
                const thead = document.createElement('thead');
                const trHead = document.createElement('tr'); trHead.style.color = '#64748b'; trHead.style.fontWeight = 'bold'; trHead.style.borderBottom = '1px solid rgba(255,255,255,0.2)';
                const thArr = [ {txt:'Date', w:'25%'}, {txt:'Exam Name', w:'40%'}, {txt:'Score', w:'15%'}, {txt:'Time', w:'20%'} ];
                thArr.forEach(h => {
                    const th = document.createElement('th'); th.style.padding = '10px 0'; th.style.width = h.w; th.textContent = h.txt; trHead.appendChild(th);
                });
                thead.appendChild(trHead); table.appendChild(thead);
                const tbody = document.createElement('tbody');
                userExamHistory.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10).forEach(ex => {
                    const totalSecs = ex.timeSpent || 0; const totalQs = ex.totalQuestions || 1; const avgSecs = Math.round(totalSecs / totalQs);
                    const avgMins = Math.floor(avgSecs / 60); const remainSecs = (avgSecs % 60).toString().padStart(2, '0');
                    const timeString = totalSecs > 0 ? `${avgMins}m ${remainSecs}s` : "N/A";
                    
                    const tr = document.createElement('tr'); tr.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
                    const tdDate = document.createElement('td'); tdDate.style.padding = '10px 0'; tdDate.style.color = '#94a3b8'; tdDate.style.whiteSpace = 'nowrap'; tdDate.style.overflow = 'hidden'; tdDate.style.textOverflow = 'ellipsis'; tdDate.textContent = new Date(ex.date).toLocaleDateString();
                    const tdName = document.createElement('td'); tdName.style.color = '#f8fafc'; tdName.style.whiteSpace = 'nowrap'; tdName.style.overflow = 'hidden'; tdName.style.textOverflow = 'ellipsis'; tdName.textContent = ex.examName;
                    const tdScore = document.createElement('td'); tdScore.style.color = ex.percentage >= 75 ? '#34d399' : '#f87171'; tdScore.style.fontWeight = 'bold'; tdScore.textContent = `${ex.percentage}%`;
                    const tdTime = document.createElement('td'); tdTime.style.color = '#94a3b8'; tdTime.textContent = timeString;
                    tr.appendChild(tdDate); tr.appendChild(tdName); tr.appendChild(tdScore); tr.appendChild(tdTime);
                    tbody.appendChild(tr);
                });
                table.appendChild(tbody);
                tableWrap.appendChild(table);
                recentExamsCont.appendChild(tableWrap);
            }
            body.appendChild(clone);
        }

        if (analyticsModal) analyticsModal.style.display = 'flex';

        if (userExamHistory.length > 0) {
            const ctx = document.getElementById('examScoreChart');
            if (ctx) {
                if (window.examChartInstance) window.examChartInstance.destroy();
                const recentExams = userExamHistory.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10).reverse();
                const labels = recentExams.map(ex => new Date(ex.date).toLocaleDateString(undefined, {month: 'short', day: 'numeric'}));
                const scores = recentExams.map(ex => ex.percentage);

                window.examChartInstance = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [{ label: 'Exam Score (%)', data: scores, borderColor: '#60a5fa', backgroundColor: 'rgba(96, 165, 250, 0.2)', borderWidth: 2, fill: true, tension: 0.3, pointBackgroundColor: '#34d399', pointRadius: 4 }]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        scales: { 
                            y: { beginAtZero: true, max: 100, grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#cbd5e1' } },
                            x: { grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#cbd5e1' } }
                        },
                        plugins: { legend: { display: false } }
                    }
                });
            }
        }

        const btnRedemption = document.getElementById('btn-train-redemption');
        if (btnRedemption) {
            btnRedemption.onclick = async () => {
                const btnText = btnRedemption.querySelector('span:first-child');
                if (btnText) btnText.textContent = "Loading...";
                let pool = globalMetadata.filter(q => allMistakes.includes(getQID(q))).sort(() => 0.5 - Math.random());
                if (pool.length > 50) pool = pool.slice(0, 50); 
                pool = await hydrateQuestions(pool);
                launchQuiz(pool, 'practice', 0, "Redemption Mode");
            };
        }

        const btnFocus = document.getElementById('btn-train-focus');
        if (btnFocus) {
            btnFocus.onclick = async () => {
                const btnText = btnFocus.querySelector('span:first-child');
                if (btnText) btnText.textContent = "Loading...";
                const worstTopic = weaknesses[0]; 
                let pool = worstTopic.pool.filter(q => !attemptedQuestions.includes(getQID(q)) || allMistakes.includes(getQID(q)));
                if (pool.length === 0) pool = worstTopic.pool; 
                pool = pool.sort(() => 0.5 - Math.random()).slice(0, 15);
                pool = await hydrateQuestions(pool);
                launchQuiz(pool, 'practice', 0, `Targeted Focus: ${worstTopic.topic}`);
            };
        }

        const btnMix = document.getElementById('btn-train-mix');
        if (btnMix) {
            btnMix.onclick = async () => {
                const btnText = btnMix.querySelector('span:first-child');
                if (btnText) btnText.textContent = "Loading...";
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
                launchQuiz(mixPool, 'practice', 0, "Balanced Mix (30 Qs)");
            };
        }
    };
}

const closeAnalytics = document.getElementById('close-analytics');
if (closeAnalytics && analyticsModal) closeAnalytics.onclick = () => { analyticsModal.style.display = 'none'; };

// ==========================================
// 12. REVISIONS & SPACED REPETITION
// ==========================================
function generateRevisionQuiz(topicIdsArray, intervalDay) {
    if (!topicIdsArray || topicIdsArray.length === 0) return alert("Invalid revision topics.");
    
    (async () => {
        let combinedPool = [];
        const currentActiveCourse = localStorage.getItem('edeetos_active_course') || 'fcps_part1';
        document.body.style.cursor = 'wait';

        try {
            for (let topicId of topicIdsArray) {
                let subject, chapter, topic, sourceName;
                const parts = topicId.split('::');
                if (parts.length >= 4) { subject = parts[0]; chapter = parts[1]; topic = parts[2]; sourceName = parts[3]; } 
                else { const oldParts = topicId.split('_'); sourceName = oldParts.pop(); topic = oldParts.pop() || ''; chapter = oldParts.pop() || ''; subject = oldParts.join('_') || ''; }
                const isBookRevision = (sourceName !== currentActiveCourse);

                if (isBookRevision) {
                    const book = availableBooks.find(b => b.file === sourceName);
                    if (book && !loadedBooksCache[book.file]) {
                        const response = await fetch(`Books/${book.file}_questions.json`, { cache: 'no-cache' });
                        if (response.ok) {
                            let bookQuestions = await response.json();
                            bookQuestions.forEach(q => { q.QuestionID = q.id; q.Subject = book.title; q.Chapter = q.chapter; q.Topic = q.topic; q.Exam = q.exams; q.Year = q.year; q.isBookQuestion = true; q.bookName = book.file; });
                            loadedBooksCache[book.file] = bookQuestions;
                            allQuestions = allQuestions.filter(q => q.bookName !== book.file);
                            allQuestions.push(...bookQuestions);
                        }
                    }
                }

                const searchSource = isBookRevision ? loadedBooksCache[sourceName] : globalMetadata;
                const topicPool = searchSource.filter(q => {
                    const qSubject = q.Subject || q.subject || ''; const qChapter = q.Chapter || q.chapter || ''; const qTopic = q.Topic || q.topic || ''; const qIsBook = q.isBookQuestion || false;
                    return ( qSubject.trim().toLowerCase() === subject.trim().toLowerCase() && qChapter.trim().toLowerCase() === chapter.trim().toLowerCase() && qTopic.trim().toLowerCase() === topic.trim().toLowerCase() && (isBookRevision ? qIsBook : !qIsBook) );
                });
                combinedPool.push(...topicPool);
            }
        } catch (e) {} finally { document.body.style.cursor = 'default'; }

        const uniqueIds = new Set();
        combinedPool = combinedPool.filter(q => { const id = getQID(q); if (uniqueIds.has(id)) return false; uniqueIds.add(id); return true; });
        if (combinedPool.length === 0) return alert("No questions available for this revision.");

        const allMistakes = [...new Set([...globalPracticeMistakes, ...globalExamMistakes])];
        let weakPool = []; let strongPool = []; let untouchedPool = [];
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

        if (intervalDay <= 7) { weakTarget = Math.round(MAX_QUESTIONS * 0.70); strongTarget = Math.round(MAX_QUESTIONS * 0.30); } 
        else { weakTarget = Math.round(MAX_QUESTIONS * 0.30); strongTarget = Math.round(MAX_QUESTIONS * 0.70); }

        finalQuiz.push(...weakPool.slice(0, weakTarget));
        finalQuiz.push(...strongPool.slice(0, strongTarget));

        if (finalQuiz.length < 15) {
            const remaining = combinedPool.filter(q => !finalQuiz.includes(q));
            finalQuiz.push(...remaining.sort(() => 0.5 - Math.random()).slice(0, 15 - finalQuiz.length));
        }
        finalQuiz = [...new Set(finalQuiz)].sort(() => 0.5 - Math.random());
        if (finalQuiz.length === 0) return alert("Not enough data to generate revision.");
        finalQuiz = await hydrateQuestions(finalQuiz);
        launchQuiz(finalQuiz, 'practice', 0, `Day ${intervalDay} Spaced Revision`);
    })();
}

// ==========================================
// 13. TROPHIES & MILESTONES
// ==========================================
const btnJourney = document.getElementById('btn-view-journey');
const closeJourneyBtn = document.getElementById('close-journey-btn');
const trophiesGrid = document.getElementById('trophies-grid');
const milestoneModal = document.getElementById('milestone-reward-modal');
const journeyModal = document.getElementById('journey-modal');

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

    const newlyUnlocked = processedTrophies.filter(t => currentFlawless >= t.cumulativeReq && !unlockedTiers.includes(t.title) && !dbClaimed.includes(t.title) );
    if (newlyUnlocked.length > 0) {
        let unclaimed = JSON.parse(localStorage.getItem('edeetos_unclaimed_rewards')) || [];
        newlyUnlocked.forEach(t => {
            unlockedTiers.push(t.title);
            if (!unclaimed.some(u => u.title === t.title)) unclaimed.push(t);
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
    if (!milestoneModal) return;
    
    document.getElementById('milestone-icon').textContent = trophy.icon;
    document.getElementById('milestone-rank').textContent = trophy.title;
    document.getElementById('milestone-req').textContent = trophy.req;

    const rewardContainer = document.getElementById('milestone-reward-container');
    rewardContainer.textContent = '';
    
    let subStatus = "free";
    const currentSub = currentUserData?.subscriptions?.[activeCourse] || currentUserData?.subscriptions?.['ALL'];
    if (currentSub === 'lifetime') { subStatus = 'lifetime'; } 
    else if (currentSub && new Date(currentSub) > new Date()) { subStatus = 'active'; }
    const isLifetime = subStatus === 'lifetime';

    let claimableBooksCount = 0;
    const bookOptionsData = availableBooks.map(b => {
        const hasLifetimeBook = currentUserData?.subscriptions?.[b.file] === 'lifetime';
        if (hasLifetimeBook) { return { value: b.file, text: `✅ ${b.title} (Owned)`, disabled: true }; }
        claimableBooksCount++;
        return { value: b.file, text: b.title, disabled: false };
    });
    const allBooksOwned = claimableBooksCount === 0;

    if (trophy.rewardValue > 0) {
        if (isLifetime && allBooksOwned) {
            const div = document.createElement('div');
            div.style.marginTop = '15px'; div.style.textAlign = 'center'; div.style.background = 'rgba(16, 185, 129, 0.15)'; div.style.padding = '15px'; div.style.borderRadius = '8px'; div.style.border = '1px solid rgba(16, 185, 129, 0.3)';
            const titleDiv = document.createElement('div'); titleDiv.style.color = '#34d399'; titleDiv.style.fontWeight = 'bold'; titleDiv.style.fontSize = '0.95rem'; titleDiv.textContent = '✅ You already own all available content!';
            const subP = document.createElement('p'); subP.style.fontSize = '0.8rem'; subP.style.color = '#a7f3d0'; subP.style.marginTop = '5px'; subP.textContent = 'There are no more rewards to claim. Amazing job!';
            div.appendChild(titleDiv); div.appendChild(subP);
            rewardContainer.appendChild(div);
        } else {
            const wrapDiv = document.createElement('div');
            wrapDiv.style.marginTop = '15px'; wrapDiv.style.textAlign = 'left'; wrapDiv.style.background = 'rgba(255, 255, 255, 0.05)'; wrapDiv.style.padding = '15px'; wrapDiv.style.borderRadius = '8px';
            const promptP = document.createElement('p'); promptP.style.fontSize = '0.95rem'; promptP.style.color = '#93c5fd'; promptP.style.marginBottom = '15px'; promptP.style.fontWeight = 'bold'; promptP.textContent = 'Choose ONE Reward:';
            wrapDiv.appendChild(promptP);
            
            const optionsCont = document.createElement('div'); optionsCont.style.display = 'flex'; optionsCont.style.flexDirection = 'column'; optionsCont.style.gap = '15px'; optionsCont.style.marginBottom = '20px';
            
            if (!isLifetime) {
                const opt1 = document.createElement('div'); opt1.style.background = 'rgba(0, 0, 0, 0.2)'; opt1.style.border = '1px solid rgba(255, 255, 255, 0.2)'; opt1.style.padding = '12px'; opt1.style.borderRadius = '8px';
                const lbl = document.createElement('label'); lbl.style.display = 'flex'; lbl.style.alignItems = 'center'; lbl.style.gap = '8px'; lbl.style.cursor = 'pointer'; lbl.style.fontWeight = 'bold'; lbl.style.color = '#f8fafc'; lbl.style.marginBottom = '8px';
                const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'rewardChoice'; radio.value = 'course'; radio.checked = true; radio.style.transform = 'scale(1.2)';
                lbl.appendChild(radio); lbl.appendChild(document.createTextNode(` Extend Course Access (+${trophy.rewardValue}${trophy.rewardUnit})`));
                
                const selDiv = document.createElement('div'); selDiv.id = 'course-selection-div'; selDiv.style.paddingLeft = '24px'; selDiv.style.transition = '0.3s';
                const sel = document.createElement('select'); sel.id = 'reward-course-selection'; sel.className = 'glass-input'; sel.style.padding = '10px';
                const opt = document.createElement('option'); opt.value = activeCourse; opt.selected = true; opt.textContent = activeCourse.toUpperCase().replace('_', ' ');
                sel.appendChild(opt); selDiv.appendChild(sel);
                opt1.appendChild(lbl); opt1.appendChild(selDiv);
                optionsCont.appendChild(opt1);
            } else {
                const msg = document.createElement('div'); msg.style.color = '#6ee7b7'; msg.style.fontWeight = 'bold'; msg.style.fontSize = '0.85rem'; msg.style.padding = '10px'; msg.style.background = 'rgba(16, 185, 129, 0.1)'; msg.style.borderRadius = '8px'; msg.style.border = '1px solid rgba(16, 185, 129, 0.2)'; msg.textContent = '✅ You have Lifetime Course Access.';
                optionsCont.appendChild(msg);
            }

            if (!allBooksOwned) {
                const opt2 = document.createElement('div'); opt2.id = 'book-container-div'; opt2.style.background = 'rgba(0, 0, 0, 0.2)'; opt2.style.border = '1px solid rgba(255, 255, 255, 0.2)'; opt2.style.padding = '12px'; opt2.style.borderRadius = '8px'; opt2.style.transition = '0.3s';
                if (isLifetime) {} else { opt2.style.opacity = '0.6'; }
                
                const lbl = document.createElement('label'); lbl.style.display = 'flex'; lbl.style.alignItems = 'center'; lbl.style.gap = '8px'; lbl.style.cursor = 'pointer'; lbl.style.fontWeight = 'bold'; lbl.style.color = '#f8fafc'; lbl.style.marginBottom = '8px';
                const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'rewardChoice'; radio.value = 'book'; radio.style.transform = 'scale(1.2)';
                if (isLifetime) radio.checked = true;
                lbl.appendChild(radio); lbl.appendChild(document.createTextNode(` Claim a Study Book (+${trophy.rewardValue}${trophy.rewardUnit})`));
                
                const selDiv = document.createElement('div'); selDiv.id = 'book-selection-div'; selDiv.style.paddingLeft = '24px'; selDiv.style.transition = '0.3s';
                if (!isLifetime) selDiv.style.pointerEvents = 'none';
                
                const sel = document.createElement('select'); sel.id = 'reward-book-selection'; sel.className = 'glass-input'; sel.style.padding = '10px';
                const defOpt = document.createElement('option'); defOpt.value = ''; defOpt.disabled = true; defOpt.selected = true; defOpt.textContent = 'Select a Study Book...';
                sel.appendChild(defOpt);
                bookOptionsData.forEach(bData => {
                    const opt = document.createElement('option'); opt.value = bData.value; opt.disabled = bData.disabled; opt.textContent = bData.text; sel.appendChild(opt);
                });
                selDiv.appendChild(sel);
                opt2.appendChild(lbl); opt2.appendChild(selDiv);
                optionsCont.appendChild(opt2);
            } else {
                const msg = document.createElement('div'); msg.style.color = '#6ee7b7'; msg.style.fontWeight = 'bold'; msg.style.fontSize = '0.85rem'; msg.style.padding = '10px'; msg.style.background = 'rgba(16, 185, 129, 0.1)'; msg.style.borderRadius = '8px'; msg.style.border = '1px solid rgba(16, 185, 129, 0.2)'; msg.textContent = '✅ You own all available Books.';
                optionsCont.appendChild(msg);
            }
            wrapDiv.appendChild(optionsCont);

            const btnConfirm = document.createElement('button'); btnConfirm.id = 'btn-confirm-reward'; btnConfirm.className = 'action-btn next-btn w-100'; btnConfirm.style.padding = '12px'; btnConfirm.style.fontSize = '1rem'; btnConfirm.textContent = 'Claim Selected Reward';
            wrapDiv.appendChild(btnConfirm);
            rewardContainer.appendChild(wrapDiv);
        }
    }

    milestoneModal.style.display = 'flex';

    const closeBtn = document.getElementById('close-milestone-btn');
    if (isLifetime && allBooksOwned) {
        closeBtn.onclick = () => { removeUnclaimedReward(trophy.title); milestoneModal.style.display = 'none'; };
    } else {
        closeBtn.onclick = () => { milestoneModal.style.display = 'none'; };
    }

    if (trophy.rewardValue > 0 && !(isLifetime && allBooksOwned)) {
        const radios = milestoneModal.querySelectorAll('input[name="rewardChoice"]');
        const courseDiv = document.getElementById('course-selection-div');
        const bookContainerDiv = document.getElementById('book-container-div');
        const bookDiv = document.getElementById('book-selection-div');

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

        const btnConfirm = document.getElementById('btn-confirm-reward');
        if (btnConfirm) {
            btnConfirm.onclick = async () => {
                const selectedRadio = milestoneModal.querySelector('input[name="rewardChoice"]:checked');
                const selectedType = selectedRadio ? selectedRadio.value : (isLifetime ? 'book' : 'course');
                
                btnConfirm.textContent = "Processing...";
                btnConfirm.disabled = true;

                try {
                    if (selectedType === 'course') {
                        const targetCourse = document.getElementById('reward-course-selection').value;
                        await grantSubscriptionReward(trophy.rewardValue, trophy.rewardUnit, targetCourse, trophy.title);
                    } else {
                        const selectedBook = document.getElementById('reward-book-selection').value;
                        if (!selectedBook) {
                            btnConfirm.textContent = "Claim Selected Reward";
                            btnConfirm.disabled = false;
                            return alert("You must select a book from the dropdown first.");
                        }
                        await claimBookReward(trophy.rewardValue, trophy.rewardUnit, trophy.title, selectedBook);
                    }
                    removeUnclaimedReward(trophy.title);
                    milestoneModal.style.display = 'none';
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
            if (existingDate > newExpiryDate) { newExpiryDate = existingDate; }
        }
        if (rewardUnit === "Hour") { newExpiryDate.setHours(newExpiryDate.getHours() + rewardValue); } 
        else { newExpiryDate.setDate(newExpiryDate.getDate() + rewardValue); }

        currentSubs[targetCourse] = newExpiryDate.toISOString();
        let claimedMilestones = currentUserData?.claimedMilestones || [];
        if (!claimedMilestones.includes(milestoneTitle)) claimedMilestones.push(milestoneTitle);

        await updateDoc(userRef, { subscriptions: currentSubs, isPremium: true, claimedMilestones: claimedMilestones });
        if (currentUserData) { currentUserData.subscriptions = currentSubs; currentUserData.isPremium = true; currentUserData.claimedMilestones = claimedMilestones; }
        alert(`Success! Your access to ${targetCourse.replace('_', ' ').toUpperCase()} has been extended by ${rewardValue}${rewardUnit}.`);
    } catch (err) { alert("Firebase Error: " + err.message); }
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
            if (existingDate > newExpiryDate) { newExpiryDate = existingDate; }
        }
        if (rewardUnit === "Hour") { newExpiryDate.setHours(newExpiryDate.getHours() + rewardValue); } 
        else { newExpiryDate.setDate(newExpiryDate.getDate() + rewardValue); }

        currentSubs[selectedBookFile] = newExpiryDate.toISOString();
        let claimedMilestones = currentUserData?.claimedMilestones || [];
        if (!claimedMilestones.includes(trophyTitle)) claimedMilestones.push(trophyTitle);

        await updateDoc(userRef, { subscriptions: currentSubs, claimedMilestones: claimedMilestones });
        if (currentUserData) { currentUserData.subscriptions = currentSubs; currentUserData.claimedMilestones = claimedMilestones; }
        alert(`Success! Your book is unlocked for ${rewardValue}${rewardUnit}.`);
    } catch (err) { alert('Firebase Error: ' + err.message); }
}

if (btnJourney) {
    btnJourney.onclick = () => {
        if (localStorage.getItem('edeetos_guest_mode') === 'true') return alert("Please register an account to track your Journey and unlock trophies.");
        
        const allMistakes = [...new Set([...globalPracticeMistakes, ...globalExamMistakes])];
        const flawlessCount = attemptedQuestions.filter(id => !allMistakes.includes(id)).length;
        const dbClaimed = currentUserData?.claimedMilestones || [];

        if (trophiesGrid) {
            trophiesGrid.textContent = '';
            processedTrophies.forEach(t => {
                const isUnlocked = flawlessCount >= t.cumulativeReq;
                const isClaimed = dbClaimed.includes(t.title);
                
                let progress = 0;
                if (isUnlocked) progress = t.req;
                else if (flawlessCount > t.previousCum) progress = flawlessCount - t.previousCum;

                const borderColor = isUnlocked ? 'rgba(245, 158, 11, 0.4)' : 'rgba(255, 255, 255, 0.1)';
                const bgColor = isUnlocked ? 'rgba(245, 158, 11, 0.1)' : 'rgba(0, 0, 0, 0.2)';
                const textColor = isUnlocked ? '#fde68a' : '#94a3b8';
                
                const card = document.createElement('div');
                card.className = 'glass-panel';
                card.style.display = 'flex'; card.style.alignItems = 'center'; card.style.padding = '0.9rem'; card.style.borderRadius = '12px'; card.style.background = bgColor; card.style.border = `1px solid ${borderColor}`;
                
                const iconDiv = document.createElement('div'); iconDiv.style.fontSize = '2.2rem'; iconDiv.style.marginRight = '1rem';
                if (!isUnlocked) iconDiv.style.filter = 'grayscale(100%) opacity(0.4)';
                iconDiv.textContent = t.icon;
                
                const contDiv = document.createElement('div'); contDiv.style.flexGrow = '1';
                const titleDiv = document.createElement('div'); titleDiv.style.fontWeight = '800'; titleDiv.style.color = textColor; titleDiv.style.fontSize = '1.05rem'; titleDiv.style.marginBottom = '0.1rem'; titleDiv.textContent = t.title;
                const progDiv = document.createElement('div'); progDiv.style.fontSize = '0.75rem'; progDiv.style.color = '#cbd5e1'; progDiv.textContent = `${progress} / ${t.req} Flawless Qs`;
                contDiv.appendChild(titleDiv); contDiv.appendChild(progDiv);

                if (t.rewardValue > 0) {
                    if (isUnlocked && !isClaimed) {
                        const btn = document.createElement('button'); btn.className = 'action-btn claim-reward-btn'; btn.setAttribute('data-trophy', JSON.stringify(t));
                        btn.style.background = 'rgba(16, 185, 129, 0.2)'; btn.style.borderColor = '#34d399'; btn.style.color = '#a7f3d0'; btn.style.padding = '6px 12px'; btn.style.fontSize = '0.75rem'; btn.style.marginTop = '6px'; btn.style.width = '100%';
                        const iconBtn = document.createElement('i'); iconBtn.className = 'fas fa-gift'; iconBtn.style.marginRight = '5px';
                        btn.appendChild(iconBtn); btn.appendChild(document.createTextNode('Claim Reward'));
                        contDiv.appendChild(btn);
                    } else if (isClaimed) {
                        const msg = document.createElement('div'); msg.style.fontSize = '0.75rem'; msg.style.fontWeight = 'bold'; msg.style.color = '#34d399'; msg.style.marginTop = '6px';
                        const iconMsg = document.createElement('i'); iconMsg.className = 'fas fa-check-double'; iconMsg.style.marginRight = '5px';
                        msg.appendChild(iconMsg); msg.appendChild(document.createTextNode('Reward Claimed'));
                        contDiv.appendChild(msg);
                    } else {
                        const msg = document.createElement('div'); msg.style.fontSize = '0.75rem'; msg.style.fontWeight = 'bold'; msg.style.color = '#fcd34d'; msg.style.marginTop = '6px';
                        const iconMsg = document.createElement('i'); iconMsg.className = 'fas fa-gift'; iconMsg.style.marginRight = '5px';
                        msg.appendChild(iconMsg); msg.appendChild(document.createTextNode(`Reward: ${t.rewardValue}${t.rewardUnit} Premium`));
                        contDiv.appendChild(msg);
                    }
                }

                const statusDiv = document.createElement('div'); statusDiv.style.fontSize = '1.3rem';
                const sIcon = document.createElement('i');
                if (isUnlocked) { sIcon.className = 'fas fa-check-circle'; sIcon.style.color = '#34d399'; }
                else { sIcon.className = 'fas fa-lock'; sIcon.style.color = '#64748b'; }
                statusDiv.appendChild(sIcon);
                
                card.appendChild(iconDiv); card.appendChild(contDiv); card.appendChild(statusDiv);
                trophiesGrid.appendChild(card);
            });

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

if (closeJourneyBtn && journeyModal) closeJourneyBtn.onclick = () => { journeyModal.style.display = 'none'; };

// ==========================================
// 14. PROGRESS RESET SYSTEM
// ==========================================
const btnReset = document.getElementById('btn-reset-progress');
const closeResetModal = document.getElementById('close-reset-modal');
const optionsContainer = document.getElementById('reset-options-container');
const confirmContainer = document.getElementById('reset-confirm-container');
const btnCancelReset = document.getElementById('btn-cancel-reset');
const btnConfirmReset = document.getElementById('btn-confirm-reset');
const confirmText = document.getElementById('reset-confirm-text');
const resetModal = document.getElementById('reset-modal'); // Re-selecting for clear reference locally

let pendingDocsToClear = [];
let pendingResetMsg = "";

if (btnReset) {
    btnReset.onclick = (e) => {
        if (e) e.preventDefault();
        // toggleSidebar is in Part 1
        if (window.toggleSidebar) window.toggleSidebar(false); 
        
        if (optionsContainer) optionsContainer.style.display = 'flex';
        if (confirmContainer) confirmContainer.style.display = 'none';
        
        const resetTitle = resetModal ? resetModal.querySelector('.reset-title') : null;
        if (resetTitle) {
            resetTitle.textContent = '';
            const i = document.createElement('i'); i.className = 'fas fa-trash-alt'; i.style.marginRight = '8px';
            resetTitle.appendChild(i); resetTitle.appendChild(document.createTextNode(`Reset ${currentView === 'book' ? 'Book' : 'Course'} Progress`));
        }
        if (resetModal) resetModal.style.display = 'flex';
    };
}

if (closeResetModal && resetModal) closeResetModal.onclick = () => { resetModal.style.display = 'none'; };

document.querySelectorAll('.reset-option-btn').forEach(btn => {
    btn.onclick = (e) => {
        const type = btn.getAttribute('data-type'); 
        const isBook = currentView === 'book';

        switch (type) {
            case "1":
                pendingDocsToClear = ["solved", "mistakes", "bookmarks", "history", "revisions", "skipped", "stats"];
                pendingResetMsg = `All ${isBook ? 'Book' : 'Course'} progress has been fully reset!`;
                if(confirmText) confirmText.textContent = `Are you sure you want to completely wipe ALL your progress for ${isBook ? 'Books' : 'this course'}? This cannot be undone.`;
                break;
            case "2":
                pendingDocsToClear = ["mistakes"];
                pendingResetMsg = `All ${isBook ? 'Book' : 'Course'} mistakes have been cleared!`;
                if(confirmText) confirmText.textContent = `Are you sure you want to clear your Mistake history?`;
                break;
            case "3":
                pendingDocsToClear = ["bookmarks"];
                pendingResetMsg = `All ${isBook ? 'Book' : 'Course'} bookmarks have been cleared!`;
                if(confirmText) confirmText.textContent = `Are you sure you want to delete all your Bookmarks?`;
                break;
            case "4":
                pendingDocsToClear = ["history"];
                pendingResetMsg = `${isBook ? 'Book' : 'Course'} Exam history has been cleared!`;
                if(confirmText) confirmText.textContent = `Are you sure you want to delete your Past Exam scores?`;
                break;
            case "5":
                pendingDocsToClear = ["solved"];
                pendingResetMsg = `Solved ${isBook ? 'Book' : 'Course'} questions have been cleared!`;
                if(confirmText) confirmText.textContent = `Are you sure you want to clear your Solved Questions? Your mistakes and bookmarks will remain.`;
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
            const wipePromises = pendingDocsToClear.map(docName => setDoc(doc(db, "users", user.uid, rootKey, docName), {}));
            await Promise.all(wipePromises);

            if (confirmText) confirmText.textContent = `✅ ${pendingResetMsg}`;
            if (btnCancelReset) btnCancelReset.style.display = 'none';
            if (btnConfirmReset) btnConfirmReset.style.display = 'none';
            setTimeout(() => { location.reload(); }, 1500);
        } catch (err) {
            if (confirmText) confirmText.textContent = "❌ Error clearing data. Check console.";
            btnConfirmReset.textContent = "Try Again";
            btnConfirmReset.disabled = false;
        }
    };
}

// ==========================================
// 15. MENTOR & ASSIGNMENT SYSTEM
// ==========================================
window.initMentorFeatures = initMentorFeatures;

function initMentorFeatures() {
    if (currentUserRole === 'MENTOR' || currentUserRole === 'ADMIN' || currentUserRole === 'MANAGEMENT') {
        const startBtn = document.getElementById('start-exam-btn');
        if (document.getElementById('assign-exam-btn')) return;
        const assignExamModal = document.getElementById('assign-exam-modal'); // local scope for clarity

        if (startBtn && startBtn.parentElement) {
            const assignBtn = document.createElement('button');
            assignBtn.className = "action-btn";
            assignBtn.textContent = "Assign to Student";
            assignBtn.style.marginLeft = "10px";
            assignBtn.id = "assign-exam-btn";
            startBtn.parentElement.appendChild(assignBtn);

            assignBtn.addEventListener('click', async () => {
                const paths = Array.from(selectedCart).map(str => JSON.parse(str));
                let examPool = globalMetadata.filter(q => { return paths.some(pathArr => window.getQuestionCount(currentView, pathArr, [q]) > 0); }); // getQuestionCount is globally scoped in Part 1

                const qCountInput = parseInt(document.getElementById('exam-q-count').value);
                const timerInput = parseInt(document.getElementById('exam-timer').value);
                if (currentMode === 'exam' && (!timerInput || timerInput <= 0 || isNaN(timerInput))) return alert("Please enter a valid time in minutes for Exam mode.");

                const finalTimer = currentMode === 'exam' ? timerInput : 0;
                if (qCountInput && qCountInput > 0 && qCountInput < examPool.length) { examPool = examPool.sort(() => 0.5 - Math.random()).slice(0, qCountInput); } 
                else { examPool = examPool.sort(() => 0.5 - Math.random()); }
                if (examPool.length === 0) return alert("No questions selected!");

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
                            studentsList.push({ id: docSnap.id, name: data.fullName || "Unnamed User", email: data.email || "No Email" });
                        }
                    });

                    if (assignExamModal) {
                        const listCont = document.getElementById('student-list-container');
                        if (listCont) {
                            listCont.textContent = '';
                            if (studentsList.length === 0) {
                                const msg = document.createElement('div'); msg.style.textAlign = 'center'; msg.style.color = '#94a3b8'; msg.style.padding = '20px'; msg.textContent = 'No students found.';
                                listCont.appendChild(msg);
                            } else {
                                studentsList.sort((a, b) => a.name.localeCompare(b.name)).forEach(student => {
                                    const lbl = document.createElement('label'); lbl.className = 'student-item list-item';
                                    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'student-checkbox item-checkbox'; cb.value = student.id;
                                    const textDiv = document.createElement('div'); textDiv.style.display = 'flex'; textDiv.style.flexDirection = 'column';
                                    const nSpan = document.createElement('span'); nSpan.className = 'student-name'; nSpan.style.fontWeight = 'bold'; nSpan.style.color = '#f8fafc'; nSpan.textContent = student.name;
                                    const eSpan = document.createElement('span'); eSpan.className = 'student-email'; eSpan.style.fontSize = '0.85rem'; eSpan.style.color = '#94a3b8'; eSpan.textContent = student.email;
                                    textDiv.appendChild(nSpan); textDiv.appendChild(eSpan);
                                    lbl.appendChild(cb); lbl.appendChild(textDiv);
                                    listCont.appendChild(lbl);
                                });
                            }
                        }
                        
                        const searchInput = document.getElementById('student-search-input');
                        if (searchInput) {
                            searchInput.value = '';
                            searchInput.oninput = (e) => {
                                const term = e.target.value.toLowerCase();
                                const items = document.querySelectorAll('.student-item');
                                items.forEach(item => {
                                    const n = item.querySelector('.student-name').textContent.toLowerCase();
                                    const em = item.querySelector('.student-email').textContent.toLowerCase();
                                    item.style.display = (n.includes(term) || em.includes(term)) ? 'flex' : 'none';
                                });
                            };
                        }

                        document.getElementById('btn-cancel-assign').onclick = () => { assignExamModal.style.display = 'none'; };
                        
                        document.getElementById('btn-confirm-assign').onclick = async () => {
                            const checkedBoxes = document.querySelectorAll('.student-checkbox:checked');
                            const selectedStudentIds = Array.from(checkedBoxes).map(cb => cb.value);
                            if (selectedStudentIds.length === 0) return alert("Please select at least one student!");

                            const confirmBtn = document.getElementById('btn-confirm-assign');
                            confirmBtn.textContent = "Assigning...";
                            confirmBtn.disabled = true;

                            try {
                                const questionIdsOnly = examPool.map(q => String(q.id || q.QuestionID));
                                await addDoc(collection(db, "assigned_exams"), {
                                    title: generatedTitle, assignedBy: auth.currentUser.uid, assignedTo: selectedStudentIds, 
                                    questionIds: questionIdsOnly, mode: currentMode, timerMinutes: finalTimer, isCompletedBy: [], createdAt: serverTimestamp()
                                });
                                alert(`Exam successfully assigned to ${selectedStudentIds.length} student(s)!`);
                                assignExamModal.style.display = 'none';
                            } catch (error) {
                                confirmBtn.textContent = "Assign Exam";
                                confirmBtn.disabled = false;
                            }
                        };
                        assignExamModal.style.display = 'flex';
                    }
                } catch (error) {} finally {
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
    updateDoc(doc(db, 'users', uid), updateObj).catch(err => {});
};

async function hydrateUserState(dbData) {
    currentUserData = dbData; 
    currentUserRole = dbData.role || 'STUDENT';
    isPremiumUser = false;
    
    if (dbData.role === 'ADMIN' || dbData.role === 'MANAGEMENT') {
        isPremiumUser = true;
        const queueStr = localStorage.getItem('edeetos_pending_edits');
        let pendingQueue = [];
        if (queueStr) { try { pendingQueue = JSON.parse(queueStr); } catch(e){} }
        
        const btnPushEdits = document.getElementById('btn-push-edits');
        const pendingEditsCount = document.getElementById('pending-edits-count');
        if (pendingQueue.length > 0 && btnPushEdits) {
            btnPushEdits.style.display = 'flex';
            if (pendingEditsCount) pendingEditsCount.textContent = pendingQueue.length;
            btnPushEdits.onclick = async () => {
                alert("SECURITY WARNING: Direct GitHub edits from the client browser have been disabled to prevent XSS vulnerabilities and data loss. Please use your secure backend Admin Panel to push updates.");
                btnPushEdits.style.display = 'none';
            };        
        }
    } else if (dbData.subscriptions && dbData.subscriptions[activeCourse]) {
        const expiry = dbData.subscriptions[activeCourse];
        if (expiry === 'lifetime') { isPremiumUser = true; } 
        else { if (new Date(expiry) >= new Date()) isPremiumUser = true; }
    }
    
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    const fetchShard = async (folder, docName) => {
        try { const snap = await getDoc(doc(db, "users", uid, folder, docName)); return snap.exists() ? snap.data() : {}; } catch(e) { return {}; }
    };

    const [ cSol, cMis, cBkm, cSkp, cHis, cRev, cNot, bSol, bMis, bBkm, bSkp, bHis, bRev, bNot ] = await Promise.all([
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
    const uniqueCourseAttempts = [...new Set([...validCourseSolved, ...courseAllMistakes, ...courseHistorical])];
    const courseFirstTryCorrect = uniqueCourseAttempts.filter(id => !courseHistorical.includes(id) && !courseAllMistakes.includes(id));
    const courseAccuracy = uniqueCourseAttempts.length > 0 ? Math.round((courseFirstTryCorrect.length / uniqueCourseAttempts.length) * 100) : 0;
    
    viewSpecificStats.course = { solved: validCourseSolved, mistakes: courseAllMistakes, bookmarks: validCourseBookmarks, skipped: uniqueCourseSkipped, accuracy: courseAccuracy };

    const bookAllMistakes = [...new Set([...uniqueBookPracticeMistakes, ...uniqueBookExamMistakes])];
    const uniqueBookAttempts = [...new Set([...uniqueBookSolved, ...bookAllMistakes, ...bookHistorical])];
    const bookFirstTryCorrect = uniqueBookAttempts.filter(id => !bookHistorical.includes(id) && !bookAllMistakes.includes(id));
    const bookAccuracy = uniqueBookAttempts.length > 0 ? Math.round((bookFirstTryCorrect.length / uniqueBookAttempts.length) * 100) : 0;
    
    viewSpecificStats.book = { solved: uniqueBookSolved, mistakes: bookAllMistakes, bookmarks: uniqueBookBookmarks, skipped: uniqueBookSkipped, accuracy: bookAccuracy };
	
    // These functions are locally scoped or global in Part 1
    if (window.loadDataAndBuildTree) await window.loadDataAndBuildTree();
    if (window.restoreLastState) window.restoreLastState();
    if (window.updateDashboardUI) window.updateDashboardUI();
    
    const revisions = { ...(currentUserData[activeCourse]?.revisions || {}), ...(currentUserData.books?.revisions || {}) };
    const now = Date.now();
    const dueTopics = [];

    Object.keys(revisions).forEach(topicId => {
        if (revisions[topicId].dueDate <= now && revisions[topicId].status !== 'missed') {
            let subj = "", chap = "", top = "";
            const parts = topicId.split('::');
            if (parts.length >= 4) { subj = parts[0]; chap = parts[1]; top = parts[2]; } 
            else { const oldParts = topicId.split('_'); oldParts.pop(); top = oldParts.pop() || ''; chap = oldParts.pop() || ''; subj = oldParts.join('_') || ''; }
            subj = subj || "General"; chap = chap || "Section"; top = top || revisions[topicId].topic || "Review Topic"; if (top === "Unknown Topic") top = "Topic";
            dueTopics.push({ id: topicId, subject: subj, chapter: chap, topic: top, step: revisions[topicId].intervalStep || 1 });
        }
    });

    const groupedByDay = {};
    dueTopics.forEach(item => {
        if (!groupedByDay[item.step]) groupedByDay[item.step] = [];
        groupedByDay[item.step].push(item);
    });
    const sortedDays = Object.keys(groupedByDay).map(Number).sort((a, b) => a - b);
    const revisionContainer = document.getElementById('spaced-repetition-container');
    const revisionModal = document.getElementById('revision-popup-modal');

    if (dueTopics.length > 0 && revisionContainer) {
        const revisionCard = document.createElement('div');
        revisionCard.className = 'glass-panel feature-card card-pointer';
        revisionCard.style.borderColor = 'rgba(245, 158, 11, 0.4)'; revisionCard.style.background = 'rgba(245, 158, 11, 0.1)'; revisionCard.style.padding = '20px'; revisionCard.style.gridColumn = '1 / -1'; revisionCard.style.marginBottom = '20px'; revisionCard.style.flexDirection = 'row'; revisionCard.style.justifyContent = 'space-between'; revisionCard.style.alignItems = 'center';
        
        const infoDiv = document.createElement('div');
        const h3 = document.createElement('h3'); h3.className = 'card-title'; h3.style.color = '#fde68a'; h3.style.margin = '0 0 5px 0';
        const h3I = document.createElement('i'); h3I.className = 'fas fa-sync-alt'; h3I.style.color = '#f59e0b'; h3I.style.marginRight = '8px';
        h3.appendChild(h3I); h3.appendChild(document.createTextNode(' Due for Revision'));
        const pDesc = document.createElement('p'); pDesc.style.color = '#fcd34d'; pDesc.style.fontSize = '0.85rem'; pDesc.style.margin = '0'; pDesc.textContent = `You have ${dueTopics.length} topics ready for spaced repetition.`;
        infoDiv.appendChild(h3); infoDiv.appendChild(pDesc);
        
        const btnView = document.createElement('button'); btnView.className = 'action-btn btn-filled-amber'; btnView.textContent = 'View Plan';
        revisionCard.appendChild(infoDiv); revisionCard.appendChild(btnView);

        if (revisionModal) {
            const listCont = document.getElementById('revision-list-container');
            if (listCont) {
                listCont.textContent = '';
                const tplDay = document.getElementById('tpl-revision-day');
                
                sortedDays.forEach(day => {
                    const topicsArray = groupedByDay[day].map(item => item.id);
                    const clone = tplDay.content.cloneNode(true);
                    clone.querySelector('.day-text').textContent = `Day ${day} Review`;
                    clone.querySelector('.rev-day-badge').textContent = `${groupedByDay[day].length} Topics Combined`;
                    
                    const masterBtn = clone.querySelector('.rev-day-btn');
                    masterBtn.onclick = () => window.generateRevisionQuiz(topicsArray, day);
                    listCont.appendChild(clone);
                    
                    groupedByDay[day].forEach(item => {
                        const btn = document.createElement('button');
                        btn.className = 'action-btn'; btn.style.width = '100%'; btn.style.textAlign = 'left'; btn.style.display = 'flex'; btn.style.justifyContent = 'space-between'; btn.style.alignItems = 'center'; btn.style.background = 'rgba(245, 158, 11, 0.1)'; btn.style.borderColor = 'rgba(245, 158, 11, 0.3)';
                        btn.onclick = () => window.generateRevisionQuiz([item.id]);
                        
                        const textCont = document.createElement('div'); textCont.style.fontWeight = '700'; textCont.style.display = 'flex'; textCont.style.flexDirection = 'column'; textCont.style.width = '90%';
                        
                        const pathSpan = document.createElement('span'); pathSpan.style.color = '#94a3b8'; pathSpan.style.fontSize = '0.75rem'; pathSpan.style.marginBottom = '3px';
                        const ar1 = document.createElement('span'); ar1.style.color = 'rgba(255,255,255,0.2)'; ar1.style.margin = '0 3px'; ar1.textContent = '>';
                        const ar2 = document.createElement('span'); ar2.style.color = 'rgba(255,255,255,0.2)'; ar2.style.margin = '0 3px'; ar2.textContent = '>';
                        pathSpan.appendChild(document.createTextNode(item.subject + ' ')); pathSpan.appendChild(ar1); pathSpan.appendChild(document.createTextNode(' ' + item.chapter + ' ')); pathSpan.appendChild(ar2);
                        
                        const tSpan = document.createElement('span'); tSpan.style.color = '#fde68a'; tSpan.style.fontSize = '0.95rem'; tSpan.textContent = item.topic;
                        
                        textCont.appendChild(pathSpan); textCont.appendChild(tSpan);
                        
                        const iPlay = document.createElement('i'); iPlay.className = 'fas fa-play-circle'; iPlay.style.color = '#fcd34d'; iPlay.style.fontSize = '1.3rem'; iPlay.style.flexShrink = '0'; iPlay.style.marginLeft = '10px';
                        
                        btn.appendChild(textCont); btn.appendChild(iPlay);
                        listCont.appendChild(btn);
                    });
                });
            }
            
            revisionCard.onclick = () => { revisionModal.style.display = 'flex'; };
            const closeBtn = document.getElementById('close-revision-popup');
            if (closeBtn) closeBtn.onclick = (e) => { e.stopPropagation(); revisionModal.style.display = 'none'; };
        }

        revisionContainer.appendChild(revisionCard);
    } else if (revisionContainer) {
        revisionContainer.textContent = '';
    }
    
    const btnMistakes = document.getElementById('btn-practice-mistakes');
    if (btnMistakes) {
        btnMistakes.disabled = false; btnMistakes.style.cursor = "pointer";
        btnMistakes.onclick = async () => {
            isGlobalPopupActive = true;
            const isBook = currentView === 'book';
            const activeMistakes = isBook ? viewSpecificStats.book.mistakes : viewSpecificStats.course.mistakes;
            if (activeMistakes.length === 0) return alert(isBook ? "You don't have any book mistakes yet." : "You don't have any course mistakes yet.");

            let pPool = []; let ePool = [];
            if (!isBook) {
                document.body.style.cursor = 'wait';
                const targetUrls = new Set();
                globalMetadata.forEach(q => {
                    const qId = window.getQID ? window.getQID(q) : q.id;
                    if (!q.isBookQuestion && (globalPracticeMistakes.includes(qId) || globalExamMistakes.includes(qId))) targetUrls.add(`Data/${activeCourse}/subjects/${window.sanitizeFilename(q.Subject || q.subject)}_${window.sanitizeFilename(q.Chapter || q.chapter)}.json`);
                });

                const pSeen = new Set(); const eSeen = new Set();
                for (let baseUrl of targetUrls) {
                    let page = 1; let keepFetching = true;
                    while (keepFetching) {
                        const pageUrl = baseUrl.replace('.json', `_${page}.json`);
                        if (!window.activeChunksCache[pageUrl]) {
                            try {
                                const res = await fetch(pageUrl);
                                if (res.ok) window.activeChunksCache[pageUrl] = await res.json();
                                else { window.activeChunksCache[pageUrl] = []; keepFetching = false; }
                            } catch(e) { window.activeChunksCache[pageUrl] = []; keepFetching = false; }
                        } else if (window.activeChunksCache[pageUrl].length === 0) { keepFetching = false; }
                        
                        if (window.activeChunksCache[pageUrl]) {
                            window.activeChunksCache[pageUrl].forEach(q => {
                                const qId = window.getQID ? window.getQID(q) : q.id;
                                if (globalPracticeMistakes.includes(qId) && !pSeen.has(qId)) { pSeen.add(qId); pPool.push(q); }
                                if (globalExamMistakes.includes(qId) && !eSeen.has(qId)) { eSeen.add(qId); ePool.push(q); }
                            });
                        }
                        page++;
                    }
                }
                document.body.style.cursor = 'default';
            } else {
                pPool = allQuestions.filter(q => globalPracticeMistakes.includes(window.getQID ? window.getQID(q) : q.id) && q.isBookQuestion);
                ePool = allQuestions.filter(q => globalExamMistakes.includes(window.getQID ? window.getQID(q) : q.id) && q.isBookQuestion);
            }

            if (pPool.length === 0 && ePool.length === 0 && isBook) return alert("Book mistakes exist, but you must open the specific book first to load its questions into memory.");
            let combinedTree = {};
            if (pPool.length > 0) combinedTree["Practice Mistakes"] = window.buildSubTree ? window.buildSubTree(pPool) : {};
            if (ePool.length > 0) combinedTree["Exam Mistakes"] = window.buildSubTree ? window.buildSubTree(ePool) : {};
            activeCustomPool = [...new Set([...pPool, ...ePool])];
            if (window.openPopup) window.openPopup(isBook ? "⚠️ Book Mistakes" : "⚠ Course Mistakes", combinedTree, 'Level1', []);
        };
    }

    const btnBookmarks = document.getElementById('btn-review-bookmarks');
    if (btnBookmarks) {
        btnBookmarks.disabled = false; btnBookmarks.style.cursor = "pointer";
        btnBookmarks.onclick = async () => {
            isGlobalPopupActive = true;
            const isBook = currentView === 'book';
            const activeBookmarks = isBook ? viewSpecificStats.book.bookmarks : viewSpecificStats.course.bookmarks;
            if (activeBookmarks.length === 0) return alert(isBook ? "You don't have any book bookmarks yet." : "You don't have any course bookmarks yet.");

            let bPool = [];
            if (!isBook) {
                document.body.style.cursor = 'wait';
                const targetUrls = new Set();
                globalMetadata.forEach(q => {
                    const qId = window.getQID ? window.getQID(q) : q.id;
                    if (!q.isBookQuestion && globalBookmarks.includes(qId)) targetUrls.add(`Data/${activeCourse}/subjects/${window.sanitizeFilename(q.Subject || q.subject)}_${window.sanitizeFilename(q.Chapter || q.chapter)}.json`);
                });

                const bSeen = new Set();
                for (let baseUrl of targetUrls) {
                    let page = 1; let keepFetching = true;
                    while (keepFetching) {
                        const pageUrl = baseUrl.replace('.json', `_${page}.json`);
                        if (!window.activeChunksCache[pageUrl]) {
                            try {
                                const res = await fetch(pageUrl);
                                if (res.ok) window.activeChunksCache[pageUrl] = await res.json();
                                else { window.activeChunksCache[pageUrl] = []; keepFetching = false; }
                            } catch(e) { window.activeChunksCache[pageUrl] = []; keepFetching = false; }
                        } else if (window.activeChunksCache[pageUrl].length === 0) { keepFetching = false; }
                        
                        if (window.activeChunksCache[pageUrl]) {
                            window.activeChunksCache[pageUrl].forEach(q => {
                                const qId = window.getQID ? window.getQID(q) : q.id;
                                if (globalBookmarks.includes(qId) && !bSeen.has(qId)) { bSeen.add(qId); bPool.push(q); }
                            });
                        }
                        page++;
                    }
                }
                document.body.style.cursor = 'default';
            } else { bPool = allQuestions.filter(q => globalBookmarks.includes(window.getQID ? window.getQID(q) : q.id) && q.isBookQuestion); }

            if (bPool.length === 0 && isBook) return alert("Book bookmarks exist, but you must open the specific book first to load its questions into memory.");

            let folderTree = {};
            bPool.forEach(q => {
                let qId = window.getQID ? window.getQID(q) : q.id;
                let f = "\u200B" + (globalBookmarkFolders[qId] || "For Revision"); let s = q.Subject || q.subject || 'Uncategorized'; let c = q.Chapter || q.chapter || 'General'; let t = q.Topic || q.topic || 'General';
                if (!folderTree[f]) folderTree[f] = {}; if (!folderTree[f][s]) folderTree[f][s] = {}; if (!folderTree[f][s][c]) folderTree[f][s][c] = {};
                folderTree[f][s][c][t] = (folderTree[f][s][c][t] || 0) + 1;
            });

            activeCustomPool = bPool;
            if (window.openPopup) window.openPopup(isBook ? "⭐ Book Bookmarks" : "⭐ Course Bookmarks", folderTree, 'Level1', []);
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
    btnSkipped.disabled = false; btnSkipped.style.cursor = "pointer";
    btnSkipped.onclick = async () => {
        isGlobalPopupActive = true;
        const isBook = currentView === 'book';
        const activeSkipped = isBook ? viewSpecificStats.book.skipped : viewSpecificStats.course.skipped;
        if (activeSkipped.length === 0) return alert(isBook ? "You don't have any skipped book questions." : "You don't have any skipped course questions.");

        let sPool = [];
        if (!isBook) {
            document.body.style.cursor = 'wait';
            const targetUrls = new Set();
            globalMetadata.forEach(q => {
                if (!q.isBookQuestion && globalSkipped.includes(window.getQID ? window.getQID(q) : q.id)) targetUrls.add(`Data/${activeCourse}/subjects/${window.sanitizeFilename(q.Subject || q.subject)}_${window.sanitizeFilename(q.Chapter || q.chapter)}.json`);
            });

            const sSeen = new Set();
            for (let baseUrl of targetUrls) {
                let page = 1; let keepFetching = true;
                while (keepFetching) {
                    const pageUrl = baseUrl.replace('.json', `_${page}.json`);
                    if (!window.activeChunksCache[pageUrl]) {
                        try {
                            const res = await fetch(pageUrl);
                            if (res.ok) window.activeChunksCache[pageUrl] = await res.json();
                            else { window.activeChunksCache[pageUrl] = []; keepFetching = false; }
                        } catch(e) { window.activeChunksCache[pageUrl] = []; keepFetching = false; }
                    } else if (window.activeChunksCache[pageUrl].length === 0) { keepFetching = false; }
                    
                    if (window.activeChunksCache[pageUrl]) {
                        window.activeChunksCache[pageUrl].forEach(q => {
                            const qId = window.getQID ? window.getQID(q) : q.id;
                            if (globalSkipped.includes(qId) && !sSeen.has(qId)) { sSeen.add(qId); sPool.push(q); }
                        });
                    }
                    page++;
                }
            }
            document.body.style.cursor = 'default';
        } else { sPool = allQuestions.filter(q => globalSkipped.includes(window.getQID ? window.getQID(q) : q.id) && q.isBookQuestion); }

        if (sPool.length === 0 && isBook) return alert("Skipped questions exist, but you must open the specific book first to load its questions into memory.");
        let combinedTree = { "Skipped Questions": window.buildSubTree ? window.buildSubTree(sPool) : {} };
        activeCustomPool = sPool;
        if (window.openPopup) window.openPopup(isBook ? "⏭️ Skipped Book Qs" : "⏭️ Skipped Course Qs", combinedTree, 'Level1', []);
    };
}
	
async function migrateOldUserData(userRef, uid, dbData) {
    let requiresUpdate = false;
    let rootUpdates = {};

    const migrateCategory = async (key) => {
        if (!dbData[key]) return;
        const data = dbData[key];
        if (data.solvedQuestions || data.mistakes || data.bookmarks || data.skippedQuestions || data.examHistory) {
            requiresUpdate = true;
            if (data.solvedQuestions) await setDoc(doc(db, "users", uid, key, "solved"), { list: data.solvedQuestions }, { merge: true });
            if (data.mistakes || data.examMistakes || data.historicalMistakes) {
                await setDoc(doc(db, "users", uid, key, "mistakes"), { practice: data.mistakes || [], exam: data.examMistakes || [], historical: data.historicalMistakes || [] }, { merge: true });
            }
            if (data.bookmarks) await setDoc(doc(db, "users", uid, key, "bookmarks"), { list: data.bookmarks, folders: data.bookmarkFolders || {} }, { merge: true });
            if (data.skippedQuestions) await setDoc(doc(db, "users", uid, key, "skipped"), { list: data.skippedQuestions }, { merge: true });
            if (data.examHistory) await setDoc(doc(db, "users", uid, key, "history"), { list: data.examHistory }, { merge: true });
            if (data.notes) await setDoc(doc(db, "users", uid, key, "notes"), { data: data.notes }, { merge: true });
            if (data.revisions) await setDoc(doc(db, "users", uid, key, "revisions"), data.revisions, { merge: true });

            rootUpdates[`${key}.solvedQuestions`] = deleteField(); rootUpdates[`${key}.mistakes`] = deleteField(); rootUpdates[`${key}.examMistakes`] = deleteField();
            rootUpdates[`${key}.historicalMistakes`] = deleteField(); rootUpdates[`${key}.bookmarks`] = deleteField(); rootUpdates[`${key}.bookmarkFolders`] = deleteField();
            rootUpdates[`${key}.skippedQuestions`] = deleteField(); rootUpdates[`${key}.examHistory`] = deleteField(); rootUpdates[`${key}.notes`] = deleteField();
            rootUpdates[`${key}.revisions`] = deleteField();
        }
    };

    const activeCourse = localStorage.getItem('edeetos_active_course') || 'fcps_part1';
    await migrateCategory(activeCourse);
    await migrateCategory('books');

    if (requiresUpdate) { await updateDoc(userRef, rootUpdates); }
}
	
onAuthStateChanged(auth, async (user) => {
    if (user) {
        localStorage.removeItem('edeetos_guest_mode');
        const userRef = doc(db, "users", user.uid);
        const cachedData = await idbCache.get(user.uid);
        if (cachedData) { try { await hydrateUserState(cachedData); } catch(e) {} }

        try {
            const docSnap = await getDoc(userRef);
            if (docSnap.exists()) {
                const dbData = docSnap.data();
                try { await migrateOldUserData(userRef, user.uid, dbData); } catch (err) {}
                idbCache.set(user.uid, dbData);
                await hydrateUserState(dbData);
            } else { await hydrateUserState({ role: 'STUDENT' }); }
        } catch (error) {}
    } else {
        if (localStorage.getItem('edeetos_guest_mode') === 'true') {
            isPremiumUser = false;
            if (window.loadDataAndBuildTree) await window.loadDataAndBuildTree(); // defined in Part 1
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