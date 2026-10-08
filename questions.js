import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, addDoc, collection, serverTimestamp, getDocs, deleteField } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ==========================================
// 1. STATE VARIABLES & CONFIGURATION
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

let globalPracticeMistakes = [];
let globalExamMistakes = [];
let globalBookmarks = [];
let activeCustomPool = null;
let isPremiumUser = false;
let currentUserRole = "STUDENT";
let currentUserData = null; 
let isGlobalPopupActive = false;
let viewSpecificStats = {
    course: { solved: [], mistakes: [], bookmarks: [], accuracy: 0 },
    book: { solved: [], mistakes: [], bookmarks: [], accuracy: 0 }
};

const loadedBooksCache = {}; 

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

// ==========================================
// 3. DARK MODE TOGGLE LOGIC
// ==========================================
const darkModeToggle = document.getElementById('dark-mode-toggle');

// Set the initial icon on load
if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark-mode');
    if (darkModeToggle) darkModeToggle.innerHTML = '<i class="fas fa-sun"></i>';
}

// Handle clicks
if (darkModeToggle) {
    darkModeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        document.documentElement.classList.toggle('dark-mode');
        
        if (document.body.classList.contains('dark-mode') || document.documentElement.classList.contains('dark-mode')) {
            localStorage.setItem('theme', 'dark');
            darkModeToggle.innerHTML = '<i class="fas fa-sun"></i>';
        } else {
            localStorage.setItem('theme', 'light');
            darkModeToggle.innerHTML = '<i class="fas fa-moon"></i>';
        }
    });
}

// ==========================================
// 4. MULTIPLAYER & STUDY ROOMS
// ==========================================
const activeRoomId = localStorage.getItem('active_study_room');
const isGuest = localStorage.getItem('is_study_guest') === 'true';

if (activeRoomId) {
    if (isGuest) {
        localStorage.removeItem('active_study_room');
        localStorage.removeItem('is_study_guest');
    } else {
        const hostBanner = document.createElement('div');
        hostBanner.style.cssText = "background: #f59e0b; color: white; padding: 12px 20px; font-weight: bold; position: sticky; top: 0; z-index: 99999; box-shadow: 0 4px 6px rgba(0,0,0,0.1); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;";
        
        hostBanner.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <i class="fas fa-users"></i> 
                <span>You are hosting Study Room <strong style="background: rgba(255,255,255,0.2); padding: 2px 6px; border-radius: 4px; letter-spacing: 1px;">${activeRoomId}</strong>. Select a topic and click Start to resume.</span>
            </div>
            <button id="btn-exit-host-room" style="background: #dc2626; color: white; border: none; padding: 6px 16px; border-radius: 6px; font-weight: bold; cursor: pointer; transition: background 0.2s; box-shadow: 0 2px 4px rgba(220, 38, 38, 0.3);">Exit Room</button>
        `;
        document.body.prepend(hostBanner);

        document.getElementById('btn-exit-host-room').addEventListener('click', () => {
            const exitModal = document.createElement('div');
            exitModal.id = 'host-exit-modal';
            exitModal.style.cssText = "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(15, 23, 42, 0.85); z-index: 999999; display: flex; justify-content: center; align-items: center; backdrop-filter: blur(8px);";
            exitModal.innerHTML = `
                <div class="glass-panel" style="background: white; padding: 30px; border-radius: 16px; text-align: center; max-width: 450px; width: 90%; box-shadow: 0 25px 50px rgba(0,0,0,0.25);">
                    <i class="fas fa-sign-out-alt" style="color: #ef4444; font-size: 3rem; margin-bottom: 1rem;"></i>
                    <h2 style="color: #1e3a8a; margin-bottom: 10px; margin-top: 0;">Exit Study Room</h2>
                    <p style="color: #475569; margin-bottom: 20px; font-size: 0.95rem;">You are the host of Room <strong style="color: #1e293b;">${activeRoomId}</strong>. Do you want to just leave the room, or end the session completely and kick all guests?</p>
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        <button id="btn-leave-only" class="btn-outline" style="border-color: #f59e0b; color: #d97706; padding: 12px; border-radius: 8px; font-weight: bold; cursor: pointer; transition: 0.2s;">🚶‍♂️ Just Leave (Keep Room Active)</button>
                        <button id="btn-end-room" class="btn-solid" style="background: #ef4444; color: white; border: none; padding: 12px; border-radius: 8px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 10px rgba(239, 68, 68, 0.3); transition: 0.2s;">🛑 End Room & Kick Everyone</button>
                        <button id="btn-cancel-exit" class="btn-outline" style="border-color: #cbd5e1; color: #64748b; padding: 12px; border-radius: 8px; margin-top: 5px; cursor: pointer; transition: 0.2s;">Cancel</button>
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
// 5. NAVIGATION & SIDEBAR
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

document.getElementById('nav-subject').onclick = () => changeView('subject', 'Subject Wise');
document.getElementById('nav-system').onclick = () => changeView('system', 'System Wise');
document.getElementById('nav-exam').onclick = () => changeView('exam', 'Past Papers');
document.getElementById('nav-book').onclick = () => changeView('book', 'Books Library');
document.getElementById('open-sidebar').onclick = () => toggleSidebar(true);
document.getElementById('close-sidebar').onclick = () => toggleSidebar(false);
sidebarOverlay.onclick = () => toggleSidebar(false);

window.updateDashboardUI = function() {
    const type = currentView === 'book' ? 'book' : 'course';
    const stats = viewSpecificStats[type];

    if (document.getElementById('stat-solved')) document.getElementById('stat-solved').textContent = stats.solved.length;
    if (document.getElementById('stat-mistakes')) document.getElementById('stat-mistakes').textContent = stats.mistakes.length;
    if (document.getElementById('stat-bookmarks')) document.getElementById('stat-bookmarks').textContent = stats.bookmarks.length;
    if (document.getElementById('stat-accuracy')) document.getElementById('stat-accuracy').textContent = `${stats.accuracy}%`;
};

function changeView(viewName, titleText) {
    currentView = viewName;
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
    popupOverlay.style.display = 'none';
    globalSearch.value = "";
    searchDropdown.style.display = 'none';

    if (viewName === 'book') {
        renderBooksGrid();    
    } else {
        renderGrid();
    }
	if (typeof updateDashboardUI === 'function') updateDashboardUI();
}

// ==========================================
// 6. GLOBAL SEARCH SYSTEM & FILTERS
// ==========================================
let searchTimeout;
if (globalSearch) {
    globalSearch.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value.toLowerCase().trim();
        
        if (query.length < 3) {
            searchDropdown.style.display = 'none';
            return;
        }

        searchTimeout = setTimeout(() => {
            const matchedQuestions = allQuestions.filter(q => {
                if (unattemptedFilter && unattemptedFilter.checked && attemptedQuestions.includes(getQID(q))) return false;
                if (typeof passesDifficultyFilter === 'function' && !passesDifficultyFilter(q)) return false; 
                const questionText = q.Question || q.question || q.text || q.statement || "";
                const textToSearch = `${q.Subject || ''} ${q.Chapter || ''} ${q.Topic || ''} ${questionText}`.toLowerCase();
                return textToSearch.includes(query);
            });

            searchDropdown.innerHTML = '';
            if (matchedQuestions.length === 0) {
                searchDropdown.innerHTML = `<div class="search-item" style="color:#64748b;">No matches found for "${query}"</div>`;
            } else {
                const quizAllBtn = document.createElement('div');
                quizAllBtn.className = 'search-item';
                quizAllBtn.style.cssText = 'background: #3b82f6; color: white; font-weight: bold; text-align: center; position: sticky; top: 0; z-index: 10; border-bottom: 2px solid #2563eb; border-radius: 12px 12px 0 0; cursor: pointer;';
                const limitCount = Math.min(matchedQuestions.length, 50);
                quizAllBtn.innerHTML = `<i class="fas fa-play-circle" style="margin-right: 8px;"></i> Create Quiz from Search (${limitCount} Qs)`;
                
                quizAllBtn.onclick = () => {
                    searchDropdown.style.display = 'none';
                    globalSearch.value = '';
                    const pool = matchedQuestions.slice(0, 50);
                    window.launchQuiz(pool, 'practice', 0, `Search: ${query}`);
                };
                searchDropdown.appendChild(quizAllBtn);

                matchedQuestions.slice(0, 30).forEach(q => {
                    const div = document.createElement('div');
                    div.className = 'search-item';
                    const title = `${q.Subject || 'Unknown Subject'} > ${q.Chapter || ''} ${q.Topic ? '> ' + q.Topic : ''}`;
                    
                    const questionText = q.Question || q.question || q.text || q.statement || "";
                    const questionSnippet = questionText ? questionText.substring(0, 90) + "..." : "Image/Table based question (No text)";

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
        }, 350);
    });
}

document.addEventListener('click', (e) => {
    if (globalSearch && searchDropdown && !globalSearch.contains(e.target) && !searchDropdown.contains(e.target)) {
        searchDropdown.style.display = 'none';
    }
});

function passesDifficultyFilter(q) {
    if (!diffEasyFilter || !diffMediumFilter || !diffHardFilter) return true;
    
    const easy = diffEasyFilter.checked;
    const medium = diffMediumFilter.checked;
    const hard = diffHardFilter.checked;
    
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
            openPopup(current.title, current.dataObj, current.level, current.pathArr, false);
        }
    }
}

if (unattemptedFilter) unattemptedFilter.addEventListener('change', triggerFilterUpdate);
if (diffEasyFilter) diffEasyFilter.addEventListener('change', triggerFilterUpdate);
if (diffMediumFilter) diffMediumFilter.addEventListener('change', triggerFilterUpdate);
if (diffHardFilter) diffHardFilter.addEventListener('change', triggerFilterUpdate);

// ==========================================
// 7. CORE VIEWS & GRID RENDERING
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
        
        // Ensure filters don't hide the cards in Exam Mode
        if (currentMode !== 'exam' && unattemptedFilter && unattemptedFilter.checked && qCount === 0) return;
        if (qCount === 0) return;

        const doneCount = getSolvedCount(currentView, [cardTitle]);
        const percent = qCount > 0 ? Math.round((doneCount / qCount) * 100) : 0;

const countHtml = `<span class="card-count">${doneCount} / ${qCount}</span>`;
        const progressHtml = `<div class="progress-container"><div class="progress-bar-fill" style="width: ${percent}%; background-color: #10b981;"></div></div>`;

        let cardStatsHtml = '';
        if (currentView === 'exam') {
            const mistakeCount = getMistakesCount(currentView, [cardTitle]);
            const totalAttempts = doneCount + mistakeCount;
            const accuracy = totalAttempts > 0 ? Math.round((doneCount / totalAttempts) * 100) : 0;
            const accColor = totalAttempts === 0 ? '#64748b' : (accuracy >= 75 ? '#065f46' : (accuracy >= 50 ? '#92400e' : '#991b1b'));
            const accBg = totalAttempts === 0 ? '#f1f5f9' : (accuracy >= 75 ? '#ecfdf5' : (accuracy >= 50 ? '#fffbeb' : '#fef2f2'));

            cardStatsHtml = `
                <div style="display: flex; gap: 8px; font-size: 0.72rem; margin: 6px 0; flex-wrap: wrap;">
                    <span style="color: #059669; font-weight: 600;"><i class="fas fa-check"></i> ${doneCount}</span>
                    <span style="color: #dc2626; font-weight: 600;"><i class="fas fa-times"></i> ${mistakeCount}</span>
                    <span style="color: ${accColor}; font-weight: 700; background: ${accBg}; padding: 1px 6px; border-radius: 4px;">${totalAttempts > 0 ? accuracy + '%' : '--'} Acc</span>
                </div>
            `;
        }

        const card = document.createElement('div');
        card.className = 'glass-panel feature-card';
        card.style.cursor = 'pointer';
        card.innerHTML = `
            <div class="card-header-flex">
                <h3 class="card-title">${cardTitle}</h3>
                ${countHtml}
            </div>
            ${cardStatsHtml}
            ${progressHtml}
        `;
        card.onclick = () => openPopup(cardTitle, activeTree[cardTitle], 'Level1', [cardTitle], false);
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
            <div class="card-header-flex" style="border-bottom: 1px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 10px;">
                <h3 class="card-title" style="color: #1e3a8a;">${book.title}</h3>
                ${isUnlocked ? '<i class="fas fa-book-open" style="color: #10b981; font-size: 1.2rem;"></i>' : '<i class="fas fa-lock" style="color: #ef4444; font-size: 1.2rem;"></i>'}
            </div>
            <div style="font-size: 0.8rem; font-weight: bold; color: ${isUnlocked ? '#059669' : '#b91c1c'};">
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

// ==========================================
// 8. POPUP, CART & CHECKBOXES
// ==========================================
if (popupBack) {
    popupBack.onclick = () => {
        popupHistory.pop();
        const prev = popupHistory[popupHistory.length - 1];
        openPopup(prev.title, prev.dataObj, prev.level, prev.pathArr, true);
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
    const parseExamDetails = (str) => {
        const parts = str.split('-').map(p => p.trim());
        
        // 1. Subject extraction (first segment before the hyphen)
        const subject = (parts[0] || str).toLowerCase();
        
        let year = 9999;
        let month = 99;
        let day = 99;

        // 2. Extract Session MM/YY or MM/YYYY (e.g. 11/25, 01/26)
        const sessionMatch = str.match(/\b(\d{1,2})\/(\d{2,4})\b/);
        if (sessionMatch) {
            month = parseInt(sessionMatch[1], 10);
            const rawYear = parseInt(sessionMatch[2], 10);
            year = rawYear < 100 ? 2000 + rawYear : rawYear;
        }

        const lowerStr = str.toLowerCase();

        // Fallback for month if MM/YY was missing
        const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
        if (month === 99) {
            for (let i = 0; i < months.length; i++) {
                if (lowerStr.includes(months[i])) {
                    month = i + 1;
                    break;
                }
            }
        }

        // 3. Extract Day of the Month (handles "November 13", "Feburary 8", etc.)
        const dayMatch = lowerStr.match(/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*[-–]?\s*(\d{1,2})\b/)
                      || lowerStr.match(/\b(\d{1,2})\s*[-–]?\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/);
        if (dayMatch) {
            day = parseInt(dayMatch[1], 10);
        } else if (parts[2]) {
            const partDayMatch = parts[2].match(/\b(\d{1,2})\b/);
            if (partDayMatch) day = parseInt(partDayMatch[1], 10);
        }

        // 4. Shift Priority: Morning -> Afternoon -> Evening -> Night
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
        const itemA = parseExamDetails(a);
        const itemB = parseExamDetails(b);

        // Tier 1: Subject wise (A to Z)
        if (itemA.subject !== itemB.subject) {
            return itemA.subject.localeCompare(itemB.subject);
        }

        // Tier 2: Chronological order (Year -> Month -> Day)
        if (itemA.year !== itemB.year) return itemA.year - itemB.year;
        if (itemA.month !== itemB.month) return itemA.month - itemB.month;
        if (itemA.day !== itemB.day) return itemA.day - itemB.day;

        // Tier 3: Shift priority (Morning -> Afternoon -> Evening -> Night)
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
    const doneCount = getSolvedCount(currentView, itemPath);
    
    let countHtml = '';
    let progressHtml = '';
    let examStatsHtml = '';

    if (typeof isGlobalPopupActive !== 'undefined' && isGlobalPopupActive) {
        countHtml = `<span class="card-count" style="background: #e2e8f0; color: #334155; padding: 2px 8px; border-radius: 12px; font-weight: bold;">${qCount} Qs</span>`;
    } else {
        const percent = qCount > 0 ? Math.round((doneCount / qCount) * 100) : 0;
        countHtml = `<span class="card-count">${doneCount} / ${qCount}</span>`;
        progressHtml = `<div class="progress-container"><div class="progress-bar-fill" style="width: ${percent}%; background-color: #10b981;"></div></div>`;
    }

    // Specific Paper Metrics: only calculated and rendered in Past Papers view
    if (currentView === 'exam') {
        const mistakeCount = getMistakesCount(currentView, itemPath);
        const totalAttempts = doneCount + mistakeCount;
        const accuracy = totalAttempts > 0 ? Math.round((doneCount / totalAttempts) * 100) : 0;

        const accColor = totalAttempts === 0 ? '#64748b' : (accuracy >= 75 ? '#065f46' : (accuracy >= 50 ? '#92400e' : '#991b1b'));
        const accBg = totalAttempts === 0 ? '#f1f5f9' : (accuracy >= 75 ? '#ecfdf5' : (accuracy >= 50 ? '#fffbeb' : '#fef2f2'));
        const accBorder = totalAttempts === 0 ? '#cbd5e1' : (accuracy >= 75 ? '#a7f3d0' : (accuracy >= 50 ? '#fde68a' : '#fecaca'));

        examStatsHtml = `
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 6px 0 6px 28px; font-size: 0.75rem;">
                <span style="background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; padding: 2px 8px; border-radius: 6px; font-weight: 600;">
                    <i class="fas fa-check" style="margin-right: 4px; color: #10b981;"></i>${doneCount} Solved
                </span>
                <span style="background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; padding: 2px 8px; border-radius: 6px; font-weight: 600;">
                    <i class="fas fa-times" style="margin-right: 4px; color: #ef4444;"></i>${mistakeCount} Mistakes
                </span>
                <span style="background: ${accBg}; color: ${accColor}; border: 1px solid ${accBorder}; padding: 2px 8px; border-radius: 6px; font-weight: 700;">
                    <i class="fas fa-bullseye" style="margin-right: 4px;"></i>${totalAttempts > 0 ? accuracy + '% Accuracy' : 'Unattempted'}
                </span>
            </div>
        `;
    }

    const hasSubLevels = typeof nextData === 'object' && nextData !== null && Object.keys(nextData).length > 0;
    
    const safePath = encodeURIComponent(JSON.stringify(itemPath));
    const pathStr = JSON.stringify(itemPath);

    // Hide the mini start button when in Exam Mode to force usage of the bottom cart
    const displayInstantStart = currentMode === 'exam' ? 'none' : 'inline-block';
    const instantStartBtn = `<button class="btn-solid mini-btn" style="display: ${displayInstantStart}; margin-left: 10px; background: #10b981; border: none; padding: 0.3rem 0.6rem; font-size: 0.75rem; border-radius: 4px;" onclick="event.stopPropagation(); startInstantPractice('${safePath}')">Start</button>`;

    labelDiv.innerHTML = `
        <div class="card-header-flex" style="align-items: center;">
            <span style="font-weight: 600; display: flex; align-items: center;">
                <input type="checkbox" class="item-checkbox" style="margin-right: 12px; transform: scale(1.3); cursor: pointer;">
                ${itemName}
            </span>
            <div style="display: flex; align-items: center; gap: 8px;">
                ${countHtml}${instantStartBtn}
            </div>
        </div>
        ${examStatsHtml}
        ${progressHtml}
    `;
    itemDiv.appendChild(labelDiv);

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
        
        // Hide the bottom cart entirely if no items are selected
        if (examCart) examCart.style.display = selectedCart.size > 0 ? "flex" : "none";
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
        actionBtn.className = 'btn-outline mini-btn';
        actionBtn.style.marginLeft = '15px';
        actionBtn.textContent = 'View ➡';
        actionBtn.onclick = (e) => {
            e.stopPropagation(); 
            openPopup(itemName, nextData, 'Chapter', itemPath, false);
        };
        itemDiv.appendChild(actionBtn);
    }

    if (popupList) popupList.appendChild(itemDiv);
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
    
    // Target specific inputs instead of hiding all of them
    const qCountInput = document.getElementById('exam-q-count');
    const timerInput = document.getElementById('exam-timer');
    
    const examCart = document.getElementById('exam-cart');
    // Only show cart if items are selected
    if (examCart) examCart.style.display = selectedCart.size > 0 ? "flex" : "none";
    
    if (startBtn) startBtn.textContent = mode === 'practice' ? 'Start Practice' : 'Start Exam';

    if (mode === 'practice') {
        const modePracBtn = document.getElementById('mode-practice');
        const modeExamBtn = document.getElementById('mode-exam');
        if (modePracBtn) modePracBtn.className = "btn-solid active-mode";
        if (modeExamBtn) modeExamBtn.className = "btn-outline";
        
        // Show Question Count, Hide Timer
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
        if (modeExamBtn) modeExamBtn.className = "btn-solid active-mode";
        if (modePracBtn) modePracBtn.className = "btn-outline";
        
        // Show BOTH Question Count and Timer in Exam Mode
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
            openPopup(current.title, current.dataObj, current.level, current.pathArr, false);
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

        // 1. Create the custom modal overlay dynamically
        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'join-challenge-modal';
        modalOverlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(15, 23, 42, 0.75); z-index: 99999; display: flex; justify-content: center; align-items: center; backdrop-filter: blur(4px);";

        modalOverlay.innerHTML = `
            <div class="glass-panel" style="background: white; padding: 30px; border-radius: 16px; width: 90%; max-width: 400px; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.25); animation: gentlePopIn 0.3s forwards;">
                <h3 style="color: #9333ea; margin-top: 0; margin-bottom: 10px; font-size: 1.6rem;"><i class="fas fa-flag-checkered"></i> Join Challenge</h3>
                <p style="color: #64748b; font-size: 0.95rem; margin-bottom: 20px;">Enter the 5-character code shared by your friend.</p>
                
                <input type="text" id="challenge-code-input" placeholder="e.g. A1B2C" maxlength="5" style="width: 100%; padding: 15px; margin-bottom: 20px; border: 2px solid #e2e8f0; border-radius: 10px; font-size: 1.8rem; text-align: center; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; outline: none; transition: border-color 0.2s; box-sizing: border-box; color: #0f172a;">
                
                <div style="display: flex; gap: 10px;">
                    <button id="btn-cancel-join" class="btn-outline" style="flex: 1; border-color: #cbd5e1; color: #64748b; padding: 12px; border-radius: 10px; font-weight: bold; cursor: pointer; transition: 0.2s;">Cancel</button>
                    <button id="btn-confirm-join" class="btn-solid" style="flex: 1; background: #a855f7; border: none; padding: 12px; border-radius: 10px; color: white; font-weight: bold; cursor: pointer; box-shadow: 0 4px 12px rgba(168, 85, 247, 0.3); transition: 0.2s;">Join Match</button>
                </div>
            </div>
            <style>@keyframes gentlePopIn { 0% { transform: scale(0.9); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }</style>
        `;

        document.body.appendChild(modalOverlay);

        const inputField = document.getElementById('challenge-code-input');
        inputField.focus();

        // Focus styling
        inputField.addEventListener('focus', () => inputField.style.borderColor = '#a855f7');
        inputField.addEventListener('blur', () => inputField.style.borderColor = '#e2e8f0');

        // Cancel button
        document.getElementById('btn-cancel-join').addEventListener('click', () => {
            modalOverlay.remove();
        });

        // Core Join Logic
        const processJoin = async () => {
            const code = inputField.value.trim().toUpperCase();
            if (!code || code.length !== 5) {
                inputField.style.borderColor = '#ef4444';
                inputField.classList.add('apply-shake'); // Reuses your existing shake animation if globally available
                setTimeout(() => inputField.classList.remove('apply-shake'), 500);
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
    
    if(btnStartMock) btnStartMock.addEventListener('click', () => {
        let count = parseInt(mockQCount.value);
        if (!count || count < 5) return alert("Please enter a valid number of questions (minimum 5).");

        btnStartMock.textContent = "Generating...";
        btnStartMock.disabled = true;

        const allMistakes = [...new Set([...globalPracticeMistakes, ...globalExamMistakes])];
        let freshPool = allQuestions.filter(q => !attemptedQuestions.includes(getQID(q)) && !allMistakes.includes(getQID(q)) && !q.isBookQuestion);

        if (freshPool.length < count) {
            freshPool = allQuestions.filter(q => !q.isBookQuestion);
        }

        if (freshPool.length === 0) {
            btnStartMock.textContent = "Start Exam";
            btnStartMock.disabled = false;
            return alert("No questions available for a mock exam.");
        }

        const finalPool = freshPool.sort(() => 0.5 - Math.random()).slice(0, count);
        const calcMinutes = Math.ceil(count * 1.2);

        mockModal.style.display = 'none';
        btnStartMock.textContent = "Start Exam";
        btnStartMock.disabled = false;

        window.launchQuiz(finalPool, 'exam', calcMinutes, `Mock Exam (${count} Qs)`);
    });
}

if (startExamBtn) {
    startExamBtn.addEventListener('click', () => {
        const paths = Array.from(selectedCart).map(str => JSON.parse(str));
        let pool = (activeCustomPool || allQuestions).filter(q => {
            return paths.some(pathArr => getQuestionCount(currentView, pathArr, [q]) > 0);
        });

        const qCountInput = parseInt(document.getElementById('exam-q-count').value);
        const timerInput = parseInt(document.getElementById('exam-timer').value);

        if (currentMode === 'exam' && (!timerInput || timerInput <= 0 || isNaN(timerInput))) {
            alert("Please enter a valid time in minutes for Exam Mode.");
            return;
        }

if (currentMode === 'exam') {
            if (qCountInput && qCountInput > 0 && qCountInput < pool.length) {
                pool = pool.sort(() => 0.5 - Math.random()).slice(0, qCountInput);
            } else {
                pool = pool.sort(() => 0.5 - Math.random());
            }
        } else {
            // Shuffle practice mode too when a question limit is set
            if (qCountInput && qCountInput > 0 && qCountInput < pool.length) {
                pool = pool.sort(() => 0.5 - Math.random()).slice(0, qCountInput);
            }
        }
        
        const generatedTitle = generateExamTitle(paths, currentView);
        window.launchQuiz(pool, currentMode, currentMode === 'exam' ? timerInput : 0, generatedTitle);
    });
}

window.startInstantPractice = function(encodedPath) {
    if (currentMode === 'exam') {
        return alert("To take an Exam, please check the box and use the Start Exam button at the bottom to set a timer.");
    }

    const pathArr = JSON.parse(decodeURIComponent(encodedPath));
    let pool = activeCustomPool || allQuestions;
    
    let finalPool = pool.filter(q => getQuestionCount(currentView, pathArr, [q]) > 0);
    
    if (finalPool.length === 0) return alert("No unattempted questions left in this topic!");
    
    // Apply question limit if entered in the bottom bar
    const qCountInputEl = document.getElementById('exam-q-count');
    if (qCountInputEl) {
        const qCountInput = parseInt(qCountInputEl.value);
        if (qCountInput && qCountInput > 0 && qCountInput < finalPool.length) {
            finalPool = finalPool.sort(() => 0.5 - Math.random()).slice(0, qCountInput);
        }
    }
    
    const generatedTitle = generateExamTitle([pathArr], currentView);
    window.launchQuiz(finalPool, 'practice', 0, generatedTitle);
};

window.launchQuiz = async function (questionsArray, mode = 'practice', timerMinutes = 0, examName = "Practice Session") {
    if (!questionsArray || questionsArray.length === 0) {
        alert("No questions found for this selection!");
        return;
    }

    const roomId = localStorage.getItem('active_study_room');
    const isGuest = localStorage.getItem('is_study_guest') === 'true';

    // Cap massive pools to avoid memory/storage crash
    let safeStorageArray = questionsArray;
    if (safeStorageArray.length > 200) {
        alert(`Your selection has ${questionsArray.length} questions. Capping to 200 to prevent browser crashes.`);
        safeStorageArray = safeStorageArray.sort(() => 0.5 - Math.random()).slice(0, 200);
    }

    const cleanPool = JSON.parse(JSON.stringify(safeStorageArray));

    // Handle Study Room Host Sync
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
                forceReveal: {}
            }, { merge: true });
        } catch (error) {
            console.error("Failed to sync room:", error);
            alert("Firebase Error: " + error.message);
            document.body.style.cursor = 'default';
            return;
        }
    }

    // 1. Clear any old in-progress exam states so quiz.html doesn't resume the 174-question exam
    const staleKeys = [
        'edeetos_saved_quiz_state',
        'edeetos_quiz_state',
        'edeetos_exam_progress',
        'edeetos_active_quiz_session',
        'quiz_in_progress'
    ];
    staleKeys.forEach(key => {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
    });

    // 2. Set localStorage configs for backward compatibility
    try {
        localStorage.setItem('edeetos_active_quiz', JSON.stringify(cleanPool));
        localStorage.setItem('edeetos_quiz_config', JSON.stringify({ mode: mode, timer: timerMinutes, examName: examName }));
    } catch (e) {
        console.warn("localStorage quota warning, relying on IndexedDB:", e);
    }

    // 3. Sync to IndexedDB (active_quiz_queue) where quiz.js actually reads from
    document.body.style.cursor = 'wait';
    try {
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

            // Overwrite the stuck queue with the newly selected questions
            store.put(cleanPool, "active_quiz_queue");

            // Clear any persisted state inside IndexedDB
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
    } catch (err) {
        console.error("IndexedDB write failed:", err);
        document.body.style.cursor = 'default';
        window.location.href = 'quiz.html';
    }
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
// 10. MENTOR & ASSIGNMENT SYSTEM
// ==========================================
function initMentorFeatures() {
    if (currentUserRole === 'MENTOR' || currentUserRole === 'ADMIN' || currentUserRole === 'MANAGEMENT') {
        const startBtn = document.getElementById('start-exam-btn');
        
        if (document.getElementById('assign-exam-btn')) return;

        if (startBtn && startBtn.parentElement) {
            const assignBtn = document.createElement('button');
            assignBtn.className = "btn-outline";
            assignBtn.textContent = "Assign to Student";
            assignBtn.style.marginLeft = "10px";
            assignBtn.id = "assign-exam-btn";
            
            startBtn.parentElement.appendChild(assignBtn);

            assignBtn.addEventListener('click', async () => {
                const paths = Array.from(selectedCart).map(str => JSON.parse(str));
                let examPool = allQuestions.filter(q => {
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
                    modalOverlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(15, 23, 42, 0.75); z-index: 99999; display: flex; justify-content: center; align-items: center; backdrop-filter: blur(4px);";
                    
                    let modalHtml = `
                        <div class="glass-panel" style="background: white; padding: 25px; border-radius: 12px; width: 90%; max-width: 500px; max-height: 85vh; display: flex; flex-direction: column; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
                            <h3 style="color: #1e3a8a; margin-bottom: 15px;"><i class="fas fa-users"></i> Select Students</h3>
                            <input type="text" id="student-search-input" placeholder="Search by name or email..." style="width: 100%; padding: 12px; margin-bottom: 15px; border: 1px solid #cbd5e1; border-radius: 8px; font-family: inherit;">
                            <div id="student-list-container" style="overflow-y: auto; flex-grow: 1; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; margin-bottom: 20px; display: flex; flex-direction: column; gap: 8px;">
                    `;

                    if (studentsList.length === 0) {
                        modalHtml += `<div style="text-align: center; color: #64748b; padding: 20px;">No students found.</div>`;
                    } else {
                        studentsList.sort((a, b) => a.name.localeCompare(b.name)).forEach(student => {
                            modalHtml += `
                                <label class="student-item" style="display: flex; align-items: center; padding: 10px; border-radius: 6px; background: #f8fafc; cursor: pointer; transition: background 0.2s; border: 1px solid transparent;">
                                    <input type="checkbox" class="student-checkbox" value="${student.id}" style="margin-right: 12px; transform: scale(1.2);">
                                    <div style="display: flex; flex-direction: column;">
                                        <span class="student-name" style="font-weight: bold; color: #0f172a;">${student.name}</span>
                                        <span class="student-email" style="font-size: 0.85rem; color: #64748b;">${student.email}</span>
                                    </div>
                                </label>
                            `;
                        });
                    }

                    modalHtml += `
                            </div>
                            <div style="display: flex; justify-content: flex-end; gap: 12px;">
                                <button id="btn-cancel-assign" class="btn-outline" style="padding: 10px 20px;">Cancel</button>
                                <button id="btn-confirm-assign" class="btn-solid" style="padding: 10px 20px; background: #3b82f6; border: none;">Assign Exam</button>
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
                            const cleanExamPool = JSON.parse(JSON.stringify(examPool));

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
// 11. DATA LOADING & HIERARCHY TREES
// ==========================================
function applyTierLimits(rawQuestions, limitPerSubject) {
    let filteredList = [];
    const groupedData = {};

    // 1. Group questions by Subject, and then by System (Chapter)
    rawQuestions.forEach(q => {
        const subject = q.Subject || "Unknown Subject";
        const chapter = q.Chapter || "Unknown System";

        if (!groupedData[subject]) groupedData[subject] = {};
        if (!groupedData[subject][chapter]) groupedData[subject][chapter] = [];
        groupedData[subject][chapter].push(q);
    });

    // 2. Distribute the quota equally across systems using a round-robin rotation
    Object.keys(groupedData).forEach(subject => {
        const chapters = Object.keys(groupedData[subject]);
        let questionsAdded = 0;
        
        // Track the current index position for each system
        const chapterPointers = {};
        chapters.forEach(c => chapterPointers[c] = 0);

        let availableChapters = [...chapters];

        // Loop until we hit the limit (50 or 20) or run completely out of questions for this subject
        while (questionsAdded < limitPerSubject && availableChapters.length > 0) {
            
            for (let i = availableChapters.length - 1; i >= 0; i--) {
                if (questionsAdded >= limitPerSubject) break;

                const chapter = availableChapters[i];
                const pointer = chapterPointers[chapter];
                const questionsInChapter = groupedData[subject][chapter];

                if (pointer < questionsInChapter.length) {
                    filteredList.push(questionsInChapter[pointer]);
                    chapterPointers[chapter]++;
                    questionsAdded++;
                } else {
                    availableChapters.splice(i, 1);
                }
            }
        }
    });

    return filteredList;
}

async function loadDataAndBuildTree() {
    try {
        if (!activeCourse) return; 
        
        const [questionsRes, hierarchyRes] = await Promise.all([
            fetch(`Data/${activeCourse}_questions.json`, { cache: 'no-cache' }),
            fetch(`Data/${activeCourse}_hierarchy.json`, { cache: 'no-cache' })
        ]);

        if (!questionsRes.ok || !hierarchyRes.ok) throw new Error("JSON files not found");

        const masterQuestions = await questionsRes.json();
        const hierarchyData = await hierarchyRes.json();

        masterQuestions.forEach(q => {
            q.QuestionID = q.id;
            q.Subject = q.subject;
            q.Chapter = q.chapter;
            q.Topic = q.topic;
            q.Year = q.year;
            q.Exam = q.exams; 
        });

        if (localStorage.getItem('edeetos_guest_mode') === 'true') {
            allQuestions = applyTierLimits(masterQuestions, 20); 
        } else if (!isPremiumUser) {
            allQuestions = applyTierLimits(masterQuestions, 50); 
        } else {
            allQuestions = [...masterQuestions]; 
        }

        subjectTree = hierarchyData.subjects || {};
        systemTree = hierarchyData.systems || {};
        examTree = {};
        
        masterQuestions.forEach(q => {
            let qYears = [];
            if (Array.isArray(q.Year)) {
                qYears = q.Year.map(y => String(y).trim());
            } else if (typeof q.Year === 'string') {
                qYears = q.Year.split(',').map(y => y.trim());
            } else if (q.Year) {
                qYears = [String(q.Year).trim()];
            } else {
                qYears = ["Other Years"];
            }

            let qExams = Array.isArray(q.Exam) ? q.Exam : (q.Exam ? [q.Exam] : []);
            if (qExams.length === 0) qExams = ["Other Exams"];

            let subj = q.Subject || "Unknown Subject";
            let chapter = q.Chapter || "Unknown Chapter";
            let topic = q.Topic || "Unknown Topic";

            qExams.forEach(exam => {
                let matchedYear = null;
                const yearMatch = exam.match(/\/(25|26|2025|2026)\b/);
                if (yearMatch) {
                    let rawY = yearMatch[1];
                    matchedYear = rawY.length === 2 ? `20${rawY}` : rawY;
                }

                let targetYears = matchedYear && qYears.includes(matchedYear) ? [matchedYear] : qYears;

                targetYears.forEach(year => {
                    if (!examTree[year]) examTree[year] = {};
                    if (!examTree[year][exam]) examTree[year][exam] = {};
                    if (!examTree[year][exam][subj]) examTree[year][exam][subj] = {};
                    if (!examTree[year][exam][subj][chapter]) examTree[year][exam][subj][chapter] = [];
                    if (!examTree[year][exam][subj][chapter].includes(topic)) {
                        examTree[year][exam][subj][chapter].push(topic);
                    }
                });
            });
        });
        renderGrid();
    } catch (error) {
        console.error("Data Load Error:", error);
    }
}

function buildSubTree(pool) {
    let tree = {};
    pool.forEach(q => {
        const Subject = q.Subject;
        const Chapter = q.Chapter;
        const Topic = q.Topic;

        if (q.isBookQuestion) {
            if (!tree["Books"]) tree["Books"] = {};
            if (Subject) {
                if (!tree["Books"][Subject]) tree["Books"][Subject] = {}; 
                if (Chapter) {
                    if (!tree["Books"][Subject][Chapter]) tree["Books"][Subject][Chapter] = [];
                    if (Topic && !tree["Books"][Subject][Chapter].includes(Topic)) tree["Books"][Subject][Chapter].push(Topic);
                }
            }
        } else {
            if (Subject) {
                if (!tree[Subject]) tree[Subject] = {};
                if (Chapter) {
                    if (!tree[Subject][Chapter]) tree[Subject][Chapter] = [];
                    if (Topic && !tree[Subject][Chapter].includes(Topic)) tree[Subject][Chapter].push(Topic);
                }
            }
        }
    });
    return tree;
}

function getQuestionCount(view, pathArr, customPool = null) {
    let pool = customPool || activeCustomPool || allQuestions;

    let paths = [...pathArr];
    if (paths[0] === "Practice Mistakes") {
        pool = pool.filter(q => globalPracticeMistakes.includes(getQID(q)));
        paths.shift();
    } else if (paths[0] === "Exam Mistakes") {
        pool = pool.filter(q => globalExamMistakes.includes(getQID(q)));
        paths.shift();
    }

    if (paths.length === 0) {
        return pool.filter(q => {
            if (currentMode === 'exam') return true;
            if (!isGlobalPopupActive && unattemptedFilter && unattemptedFilter.checked && attemptedQuestions.includes(getQID(q))) return false;
            return true;
        }).length;
    }

    return pool.filter(q => {
if (currentMode !== 'exam' && !customPool) {
    if (typeof passesDifficultyFilter === 'function' && !passesDifficultyFilter(q)) return false;
    if (!isGlobalPopupActive && unattemptedFilter && unattemptedFilter.checked && attemptedQuestions.includes(getQID(q))) return false;
}

        if (isGlobalPopupActive) {
            if (paths[0] === "Books") {
                if (!q.isBookQuestion) return false;
                if (paths[1] && q.Subject !== paths[1]) return false;
                if (paths[2] && q.Chapter !== paths[2]) return false;
                if (paths[3] && q.Topic !== paths[3]) return false;
                return true;
            } else {
                if (q.isBookQuestion) return false;
                if (paths[0] && q.Subject !== paths[0]) return false;
                if (paths[1] && q.Chapter !== paths[1]) return false;
                if (paths[2] && q.Topic !== paths[2]) return false;
                return true;
            } 
        }

        if (view === 'subject') {
            if (q.isBookQuestion) return false; 
            if (paths[0] && q.Subject !== paths[0]) return false;
            if (paths[1] && q.Chapter !== paths[1]) return false;
            if (paths[2] && q.Topic !== paths[2]) return false;
        } else if (view === 'system') {
            if (q.isBookQuestion) return false; 
            if (paths[0] && q.Chapter !== paths[0]) return false;
            if (paths[1] && q.Subject !== paths[1]) return false;
            if (paths[2] && q.Topic !== paths[2]) return false;
		} else if (view === 'exam') {
            let qYears = [];
            if (Array.isArray(q.Year)) {
                qYears = q.Year.map(y => String(y).trim());
            } else if (typeof q.Year === 'string') {
                qYears = q.Year.split(',').map(y => y.trim());
            } else if (q.Year) {
                qYears = [String(q.Year).trim()];
            } else {
                qYears = ["Other Years"];
            }
            
            if (paths[0] && !qYears.includes(paths[0])) return false;
            
            let qExams = Array.isArray(q.Exam) ? q.Exam : (q.Exam ? [q.Exam] : []);
            if (paths[1] && !qExams.includes(paths[1])) return false;
            
            if (paths[2] && q.Subject !== paths[2]) return false;
            if (paths[3] && q.Chapter !== paths[3]) return false;
            if (paths[4] && q.Topic !== paths[4]) return false;
        } else if (view === 'book') {
            if (paths[0] && q.Chapter !== paths[0]) return false;
            if (paths[1] && q.Topic !== paths[1]) return false;
        }
        return true;
    }).length;
}

function getQID(q) {
    return String(q['QuestionID'] || q['Question ID'] || q['ID'] || q['id']);
}

function getSolvedCount(view, pathArr) {
    const pool = activeCustomPool || allQuestions;
    const attemptedPool = pool.filter(q => attemptedQuestions.includes(getQID(q)));
    return getQuestionCount(view, pathArr, attemptedPool);
}

function getMistakesCount(view, pathArr) {
    const pool = activeCustomPool || allQuestions;
    const allMistakes = [...new Set([...globalPracticeMistakes, ...globalExamMistakes])];
    const mistakePool = pool.filter(q => allMistakes.includes(getQID(q)));
    return getQuestionCount(view, pathArr, mistakePool);
}

function getLeafPaths(dataObj, currentPath) {
    if (!dataObj) return [];
    if (Array.isArray(dataObj)) return dataObj.map(topic => JSON.stringify([...currentPath, topic]));
    if (typeof dataObj !== 'object') return [JSON.stringify(currentPath)];
    
    let leaves = [];
    Object.keys(dataObj).forEach(key => {
        leaves = leaves.concat(getLeafPaths(dataObj[key], [...currentPath, key]));
    });
    return leaves;
}

// ==========================================
// 12. PROGRESS RESET SYSTEM
// ==========================================
const btnReset = document.getElementById('btn-reset-progress');
const resetModal = document.getElementById('reset-modal');
const closeResetModal = document.getElementById('close-reset-modal');
const optionsContainer = document.getElementById('reset-options-container');
const confirmContainer = document.getElementById('reset-confirm-container');
const btnCancelReset = document.getElementById('btn-cancel-reset');
const btnConfirmReset = document.getElementById('btn-confirm-reset');
const confirmText = document.getElementById('reset-confirm-text');

let pendingUpdates = {};
let pendingResetMsg = "";

if (btnReset) {
    btnReset.onclick = (e) => {
        if (e) e.preventDefault();
        toggleSidebar(false);
        optionsContainer.style.display = 'flex';
        confirmContainer.style.display = 'none';
        
        // Dynamically update the modal title based on the active view
        const resetTitle = resetModal.querySelector('.popup-header h3');
        if (resetTitle) {
            resetTitle.innerHTML = `<i class="fas fa-trash-alt"></i> Reset ${currentView === 'book' ? 'Book' : 'Course'} Progress`;
        }
        
        if (resetModal) resetModal.style.display = 'flex';
    };
}

if (closeResetModal) {
    closeResetModal.onclick = () => {
        if (resetModal) resetModal.style.display = 'none';
    };
}

document.querySelectorAll('.reset-option-btn').forEach(btn => {
    btn.onclick = (e) => {
        const type = btn.getAttribute('data-type'); 
        const activeCourse = localStorage.getItem('edeetos_active_course');
        const isBook = currentView === 'book';

        pendingUpdates = {};

        switch (type) {
            case "1":
                if (isBook) {
                    pendingUpdates = {
                        [`books.solvedQuestions`]: [],
                        [`books.mistakes`]: [],
                        [`books.examMistakes`]: [],
                        [`books.bookmarks`]: [],
                        [`books.examHistory`]: [],
                        [`books.revisions`]: {} 
                    };
                    pendingResetMsg = "All Book progress has been fully reset!";
                    confirmText.textContent = "Are you sure you want to completely wipe ALL your progress for Books? Your course progress will remain. This cannot be undone.";
                } else {
                    pendingUpdates = {
                        [`${activeCourse}.solvedQuestions`]: [],
                        [`${activeCourse}.mistakes`]: [],
                        [`${activeCourse}.examMistakes`]: [],
                        [`${activeCourse}.bookmarks`]: [],
                        [`${activeCourse}.examHistory`]: [],
                        [`${activeCourse}.revisions`]: {}
                    };
                    pendingResetMsg = "All Course progress has been fully reset!";
                    confirmText.textContent = "Are you sure you want to completely wipe ALL your progress for this course? Your books progress will remain. This cannot be undone.";
                }
                break;
            case "2":
                if (isBook) {
                    pendingUpdates = { [`books.mistakes`]: [], [`books.examMistakes`]: [] };
                    pendingResetMsg = "All Book mistakes have been cleared!";
                    confirmText.textContent = "Are you sure you want to clear your Book Mistake history?";
                } else {
                    pendingUpdates = { [`${activeCourse}.mistakes`]: [], [`${activeCourse}.examMistakes`]: [] };
                    pendingResetMsg = "All Course mistakes have been cleared!";
                    confirmText.textContent = "Are you sure you want to clear your Course Mistake history?";
                }
                break;
            case "3":
                if (isBook) {
                    pendingUpdates = { [`books.bookmarks`]: [] };
                    pendingResetMsg = "All Book bookmarks have been cleared!";
                    confirmText.textContent = "Are you sure you want to delete all your Bookmarks for books?";
                } else {
                    pendingUpdates = { [`${activeCourse}.bookmarks`]: [] };
                    pendingResetMsg = "All Course bookmarks have been cleared!";
                    confirmText.textContent = "Are you sure you want to delete all your Bookmarks for this course?";
                }
                break;
            case "4":
                if (isBook) {
                    pendingUpdates = { [`books.examHistory`]: [] };
                    pendingResetMsg = "Book Exam history has been cleared!";
                    confirmText.textContent = "Are you sure you want to delete your Past Exam scores for books?";
                } else {
                    pendingUpdates = { [`${activeCourse}.examHistory`]: [] };
                    pendingResetMsg = "Course Exam history has been cleared!";
                    confirmText.textContent = "Are you sure you want to delete your Past Exam scores for this course?";
                }
                break;
            case "5":
                if (isBook) {
                    pendingUpdates = { [`books.solvedQuestions`]: [] };
                    pendingResetMsg = "Solved Book questions have been cleared!";
                    confirmText.textContent = "Are you sure you want to clear your Solved Questions for books? Your mistakes and bookmarks will remain.";
                } else {
                    pendingUpdates = { [`${activeCourse}.solvedQuestions`]: [] };
                    pendingResetMsg = "Solved Course questions have been cleared!";
                    confirmText.textContent = "Are you sure you want to clear your Solved Questions for this course? Your mistakes and bookmarks will remain.";
                }
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
        if (!user) {
            alert("You must be logged in to reset progress.");
            return;
        }

        btnConfirmReset.textContent = "Clearing...";
        btnConfirmReset.disabled = true;

        try {
            const userRef = doc(db, "users", user.uid);
            await updateDoc(userRef, pendingUpdates);

            if (confirmText) confirmText.innerHTML = `✅ ${pendingResetMsg}`;
            if (btnCancelReset) btnCancelReset.style.display = 'none';
            if (btnConfirmReset) btnConfirmReset.style.display = 'none';

            setTimeout(() => {
                location.reload();
            }, 1500);

        } catch (err) {
            console.error("Reset Error:", err);
            if (confirmText) confirmText.textContent = "❌ Error clearing data. Check console.";
            btnConfirmReset.textContent = "Try Again";
            btnConfirmReset.disabled = false;
        }
    };
}

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
    modal.style.cssText = "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(15, 23, 42, 0.85); z-index: 999999; display: flex; justify-content: center; align-items: center; backdrop-filter: blur(8px);";
    
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
                <div style="margin-top: 15px; text-align: center; background: #ecfdf5; padding: 15px; border-radius: 8px; border: 1px solid #a7f3d0;">
                    <div style="color: #059669; font-weight: bold; font-size: 0.95rem;">✅ You already own all available content!</div>
                    <p style="font-size: 0.8rem; color: #047857; margin-top: 5px;">There are no more rewards to claim. Amazing job!</p>
                </div>
            `;
        } else {
            rewardOptionsHtml = `
                <div style="margin-top: 15px; text-align: left; background: #f8fafc; padding: 15px; border-radius: 8px;">
                    <p style="font-size: 0.95rem; color: #1e3a8a; margin-bottom: 15px; font-weight: bold;">Choose ONE Reward:</p>
                    
                    <div style="display: flex; flex-direction: column; gap: 15px; margin-bottom: 20px;">
                        
                        ${!isLifetime ? `
                        <div style="background: white; border: 1px solid #cbd5e1; padding: 12px; border-radius: 8px;">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: bold; color: #334155; margin-bottom: 8px;">
                                <input type="radio" name="rewardChoice" value="course" checked style="transform: scale(1.2);"> 
                                Extend Course Access (+${trophy.rewardValue} ${trophy.rewardUnit})
                            </label>
                            <div id="course-selection-div" style="padding-left: 24px; transition: 0.3s;">
                                <select id="reward-course-selection" style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #cbd5e1; font-family: inherit;">
                                    ${courseOptionsHtml}
                                </select>
                            </div>
                        </div>
                        ` : '<div style="color: #059669; font-weight: bold; font-size: 0.85rem; padding: 10px; background: #ecfdf5; border-radius: 8px; border: 1px solid #a7f3d0;">✅ You have Lifetime Course Access.</div>'}
                        
                        ${!allBooksOwned ? `
                        <div style="background: white; border: 1px solid #cbd5e1; padding: 12px; border-radius: 8px; ${isLifetime ? '' : 'opacity: 0.6;'} transition: 0.3s;" id="book-container-div">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: bold; color: #334155; margin-bottom: 8px;">
                                <input type="radio" name="rewardChoice" value="book" ${isLifetime ? 'checked' : ''} style="transform: scale(1.2);">
                                Claim a Study Book (+${trophy.rewardValue} ${trophy.rewardUnit})
                            </label>
                            <div id="book-selection-div" style="padding-left: 24px; ${isLifetime ? '' : 'pointer-events: none;'} transition: 0.3s;">
                                <select id="reward-book-selection" style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #cbd5e1; font-family: inherit;">
                                    <option value="" disabled selected>Select a Study Book...</option>
                                    ${bookOptionsHtml}
                                </select>
                            </div>
                        </div>
                        ` : '<div style="color: #059669; font-weight: bold; font-size: 0.85rem; padding: 10px; background: #ecfdf5; border-radius: 8px; border: 1px solid #a7f3d0;">✅ You own all available Books.</div>'}

                    </div>

                    <button id="btn-confirm-reward" class="btn-solid" style="background: #10b981; width: 100%; border: none; padding: 12px; border-radius: 8px; cursor: pointer; font-size: 1rem; font-weight: bold; transition: background 0.2s;">
                        Claim Selected Reward
                    </button>
                </div>
            `;
        }
    }

    modal.innerHTML = `
        <div class="glass-panel" style="background: white; padding: 30px; border-radius: 16px; text-align: center; max-width: 450px; width: 90%; box-shadow: 0 25px 50px rgba(0,0,0,0.25); animation: popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275); max-height: 90vh; overflow-y: auto;">
            <div style="font-size: 4.5rem; margin-bottom: 10px; line-height: 1;">${trophy.icon}</div>
            <h2 style="color: #1e3a8a; margin-bottom: 10px; font-size: 1.6rem;">Milestone Reached!</h2>
            <p style="color: #475569; font-size: 1.05rem; margin-bottom: 5px;">You achieved the <strong style="color: #0f172a;">${trophy.title}</strong> rank by completing ${trophy.req} flawless questions!</p>${rewardOptionsHtml}
            <button id="close-milestone-btn" class="btn-outline" style="width: 100%; margin-top: 15px; padding: 12px; font-size: 1rem; cursor: pointer; border-radius: 8px;">Dismiss</button>
        </div>
        <style>
            @keyframes popIn { 0% { transform: scale(0.8); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        </style>
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
        
        // Fetch the true claimed list from the database
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

                const borderColor = isUnlocked ? '#fbbf24' : '#e2e8f0';
                const bgColor = isUnlocked ? 'rgba(255, 255, 255, 0.9)' : 'rgba(248, 250, 252, 0.6)';
                const iconStyle = isUnlocked ? '' : 'filter: grayscale(100%) opacity(0.4);';
                const textColor = isUnlocked ? '#1e3a8a' : '#94a3b8';
                const statusIcon = isUnlocked ? '<i class="fas fa-check-circle" style="color: #10b981;"></i>' : '<i class="fas fa-lock" style="color: #cbd5e1;"></i>';
                
                let rewardHtml = '';
                if (t.rewardValue > 0) {
                    if (isUnlocked && !isClaimed) {
                        // Unlocked but not claimed: Show a Claim button
                        rewardHtml = `<button class="btn-solid claim-reward-btn" data-trophy='${JSON.stringify(t)}' style="background: #10b981; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 0.75rem; font-weight: bold; cursor: pointer; margin-top: 6px; width: 100%; box-shadow: 0 4px 6px rgba(16,185,129,0.2);"><i class="fas fa-gift"></i> Claim Reward</button>`;
                    } else if (isClaimed) {
                        // Already claimed successfully
                        rewardHtml = `<div style="font-size: 0.75rem; font-weight: bold; color: #10b981; margin-top: 6px;"><i class="fas fa-check-double"></i> Reward Claimed</div>`;
                    } else {
                        // Locked target
                        rewardHtml = `<div style="font-size: 0.75rem; font-weight: bold; color: #f59e0b; margin-top: 6px;"><i class="fas fa-gift"></i> Reward: ${t.rewardValue} ${t.rewardUnit} Premium</div>`;
                    }
                }

                return `
                    <div class="glass-panel" style="display: flex; align-items: center; padding: 0.9rem; border-radius: 12px; background: ${bgColor}; border: 2px solid ${borderColor}; box-shadow:${isUnlocked ? '0 4px 12px rgba(0,0,0,0.05)' : 'none'};">
                        <div style="font-size: 2.2rem; margin-right: 1rem; ${iconStyle}">${t.icon}</div>
                        <div style="flex-grow: 1;">
                            <div style="font-weight: 800; color: ${textColor}; font-size: 1.05rem; margin-bottom: 0.1rem;">${t.title}</div>
                            <div style="font-size: 0.75rem; color: #64748b;">${progress} / ${t.req} Flawless Qs</div>${rewardHtml}
                        </div>
                        <div style="font-size: 1.3rem;">
                            ${statusIcon}
                        </div>
                    </div>
                `;
            }).join('');

            // Attach click listeners to the new dynamic Claim buttons
            document.querySelectorAll('.claim-reward-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const targetBtn = e.target.closest('button');
                    const trophyData = JSON.parse(targetBtn.getAttribute('data-trophy'));
                    
                    // Hide the Journey modal and bring up the Reward claim screen
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
// 14. REVISIONS & SPACED REPETITION
// ==========================================
window.generateRevisionQuiz = async function(topicId) {

    if (!topicId) {
        return alert("Invalid revision topic.");
    }

    let subject, chapter, topic, sourceName;

    const parts = topicId.split('::');
    
    if (parts.length >= 4) {
        subject = parts[0];
        chapter = parts[1];
        topic = parts[2];
        sourceName = parts[3];
    } else {
        const oldParts = topicId.split('_');
        sourceName = oldParts.pop();
        topic = oldParts.pop() || '';
        chapter = oldParts.pop() || '';
        subject = oldParts.join('_') || '';
    }

    const currentActiveCourse = localStorage.getItem('edeetos_active_course') || 'fcps_part1';
    const isBookRevision = (sourceName !== currentActiveCourse);

    if (isBookRevision) {
        const book = availableBooks.find(b => b.file === sourceName);
        if (book && !loadedBooksCache[book.file]) {
            try {
                document.body.style.cursor = 'wait';
				const response = await fetch(`Books/${book.file}_questions.json`, { cache: 'no-cache' });
                if (response.ok) {
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
            } catch(e) { 
                console.error(e); 
            } finally {
                document.body.style.cursor = 'default';
            }
        }
    }

    const topicPool = allQuestions.filter(q => {
        const qSubject = q.Subject || q.subject || '';
        const qChapter = q.Chapter || q.chapter || '';
        const qTopic = q.Topic || q.topic || '';
        const qIsBook = q.isBookQuestion || false;

        const hierarchyMatch = (
            qSubject.trim().toLowerCase() === subject.trim().toLowerCase() &&
            qChapter.trim().toLowerCase() === chapter.trim().toLowerCase() &&
            qTopic.trim().toLowerCase() === topic.trim().toLowerCase()
        );

        const sourceMatch = isBookRevision ? qIsBook : !qIsBook;

        return hierarchyMatch && sourceMatch;
    });

    if (topicPool.length === 0) {
        console.warn("No matching questions found for:", { subject, chapter, topic, sourceName });
        return alert("No questions available for this revision topic.");
    }

    const allMistakes = [...new Set([...globalPracticeMistakes, ...globalExamMistakes])];
    let weakPool = [];
    let strongPool = [];
    let untouchedPool = [];

    topicPool.forEach(q => {
        const qId = getQID(q);
        if (allMistakes.includes(qId)) weakPool.push(q);
        else if (attemptedQuestions.includes(qId)) strongPool.push(q);
        else untouchedPool.push(q);
    });

    weakPool = weakPool.sort(() => 0.5 - Math.random());
    strongPool = strongPool.sort(() => 0.5 - Math.random());
    untouchedPool = untouchedPool.sort(() => 0.5 - Math.random());

    let finalQuiz = [];
    finalQuiz.push(...weakPool.slice(0, 20));
    finalQuiz.push(...strongPool.slice(0, 10));
    finalQuiz.push(...untouchedPool.slice(0, 25 - finalQuiz.length));

    if (finalQuiz.length < 15) {
        const remaining = topicPool.filter(q => !finalQuiz.includes(q));
        finalQuiz.push(...remaining.slice(0, 15 - finalQuiz.length));
    }

    finalQuiz = [...new Set(finalQuiz)].sort(() => 0.5 - Math.random());

    if (finalQuiz.length === 0) return alert("Not enough data to generate revision.");

    window.launchQuiz(
        finalQuiz,
        'practice',
        0,
        `Revision: ${topic}`
    );
};

// ==========================================
// 15. SMART ANALYTICS ENGINE
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

        allQuestions.forEach(q => {
            const topicName = q.Topic || q.Chapter || q.Subject || "Core Material";
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
                    <i class="fas fa-chart-pie" style="font-size: 3rem; color: #cbd5e1; margin-bottom: 15px;"></i>
                    <h3 style="color: #334155; margin-bottom: 5px;">Not Enough Data</h3>
                    <p style="color: #64748b; font-size: 0.9rem;">Answer at least 3 questions in any topic to unlock your Smart Performance Dashboard.</p>
                </div>
            `;
        } else {
            html += `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 15px; margin-bottom: 25px;">`;
            
            html += `<div style="background: #fef2f2; border: 1px solid #fca5a5; border-radius: 12px; padding: 15px;">
                        <h4 style="color:#991b1b; margin-top: 0; margin-bottom: 15px; border-bottom: 2px solid #fecaca; padding-bottom: 5px;"><i class="fas fa-exclamation-triangle" style="margin-right: 5px;"></i> Priority Review</h4>`;
            if (weaknesses.length === 0) {
                html += `<div style="color: #10b981; font-weight: bold; font-size: 0.85rem;"><i class="fas fa-check"></i> No critical weaknesses!</div>`;
            } else {
                weaknesses.forEach(w => {
                    html += `
                        <div style="margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #fecaca;">
                            <div style="display:flex; justify-content:space-between; font-size:0.85rem; font-weight: bold; color: #7f1d1d;">
                                <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 70%;">${w.topic}</span>
                                <span>${w.accuracy}%</span>
                            </div>
                            <div style="font-size: 0.75rem; color: #b91c1c; margin-top: 4px;">${w.mistakes} mistakes / ${w.attempted} attempts</div>
                        </div>`;
                });
            }
            html += `</div>`;

            html += `<div style="background: #ecfdf5; border: 1px solid #6ee7b7; border-radius: 12px; padding: 15px;">
                        <h4 style="color:#065f46; margin-top: 0; margin-bottom: 15px; border-bottom: 2px solid #a7f3d0; padding-bottom: 5px;"><i class="fas fa-star" style="color: #10b981; margin-right: 5px;"></i> Top Strengths</h4>`;
            if (strengths.length === 0) {
                html += `<div style="color: #64748b; font-size: 0.85rem;">Keep practicing to build your strengths!</div>`;
            } else {
                strengths.forEach(s => {
                    html += `
                        <div style="margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #a7f3d0;">
                            <div style="display:flex; justify-content:space-between; font-size:0.85rem; font-weight: bold; color: #047857;">
                                <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 70%;">${s.topic}</span>
                                <span>${s.accuracy}%</span>
                            </div>
                            <div style="font-size: 0.75rem; color: #059669; margin-top: 4px;">Mastered ${s.attempted - s.mistakes} / ${s.attempted}</div>
                        </div>`;
                });
            }
            html += `</div></div>`;

            html += `
                <h4 style="color:#1e3a8a; border-bottom:2px solid #bfdbfe; padding-bottom:5px; margin-top: 0; margin-bottom: 15px;"><i class="fas fa-dumbbell" style="margin-right: 8px; color: #3b82f6;"></i> Smart Training Hub</h4>
                <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 25px;">
            `;

            const totalMistakesCount = allMistakes.length;
            if (totalMistakesCount > 0) {
                html += `<button id="btn-train-redemption" class="btn-solid" style="background: #f59e0b; border: none; padding: 12px; border-radius: 8px; text-align: left; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                            <span style="font-weight: bold; font-size: 0.95rem; flex: 1; min-width: 150px;"><i class="fas fa-sync-alt" style="margin-right: 8px;"></i> Redemption Mode</span>
                            <span style="font-size: 0.75rem; background: rgba(255,255,255,0.3); padding: 3px 8px; border-radius: 12px; white-space: nowrap;">Revisit ${totalMistakesCount} Mistakes</span>
                         </button>`;
            }

            if (weaknesses.length > 0) {
                html += `<button id="btn-train-focus" class="btn-solid" style="background: #ef4444; border: none; padding: 12px; border-radius: 8px; text-align: left; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                            <span style="font-weight: bold; font-size: 0.95rem; flex: 1; min-width: 150px;"><i class="fas fa-bullseye" style="margin-right: 8px;"></i> Targeted Focus</span>
                            <span style="font-size: 0.75rem; background: rgba(255,255,255,0.3); padding: 3px 8px; border-radius: 12px; white-space: nowrap;">Drill 15 Qs on Weakest Topic</span>
                         </button>`;
            }

            if (strengths.length > 0 && weaknesses.length > 0) {
                html += `<button id="btn-train-mix" class="btn-solid" style="background: #3b82f6; border: none; padding: 12px; border-radius: 8px; text-align: left; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                            <span style="font-weight: bold; font-size: 0.95rem; flex: 1; min-width: 150px;"><i class="fas fa-balance-scale" style="margin-right: 8px;"></i> Balanced Mix</span>
                            <span style="font-size: 0.75rem; background: rgba(255,255,255,0.3); padding: 3px 8px; border-radius: 12px; white-space: nowrap;">30 Qs (Strengths + Weaknesses)</span>
                         </button>`;
            }

            html += `</div>`;
        }

        html += `<h4 style="color:#475569; border-bottom:2px solid #e2e8f0; padding-bottom:5px; margin-top:10px;"><i class="fas fa-history" style="margin-right: 5px;"></i> Recent Exams</h4>`;
        if (userExamHistory.length === 0) {
            html += `<p style="font-size:0.8rem; color:#64748b; text-align:center;">No exams taken yet.</p>`;
        } else {
            html += `<div style="width: 100%; height: 200px; margin-bottom: 20px;"><canvas id="examScoreChart"></canvas></div>`;
            html += `<div style="font-size:0.85rem; max-height:180px; overflow-y:auto;">
                        <table style="width:100%; text-align:left; border-collapse: collapse;">`
						
            userExamHistory.slice().reverse().slice(0, 10).forEach(ex => {
                const totalSecs = ex.timeSpent || 0;
                const totalQs = ex.totalQuestions || 1;
                const avgSecs = Math.round(totalSecs / totalQs);
                const avgMins = Math.floor(avgSecs / 60);
                const remainSecs = (avgSecs % 60).toString().padStart(2, '0');
                const timeString = totalSecs > 0 ? `${avgMins}m ${remainSecs}s` : "N/A";
                
                html += `<tr style="border-bottom:1px solid #f1f5f9;">
                            <td style="padding:10px 0; color: #475569;">${new Date(ex.date).toLocaleDateString()}</td>
                            <td style="color: #1e293b; font-weight: 500;">${ex.examName}</td>
                            <td style="color:${ex.percentage >= 75 ? '#10b981' : '#ef4444'}; font-weight:bold;">${ex.percentage}%</td>
                            <td style="color: #475569; font-weight: 500;">${timeString}</td>
                         </tr>`;
            });
            html += `</table></div>`;
        }

        if (body) body.innerHTML = html;
        const analyticsModal = document.getElementById('analytics-modal');
        if (analyticsModal) analyticsModal.style.display = 'flex';

        if (userExamHistory.length > 0) {
            const ctx = document.getElementById('examScoreChart');
            if (ctx) {
                if (window.examChartInstance) window.examChartInstance.destroy();
                
                const recentExams = userExamHistory.slice().reverse().slice(0, 10).reverse();
                const labels = recentExams.map(ex => new Date(ex.date).toLocaleDateString(undefined, {month: 'short', day: 'numeric'}));
                const scores = recentExams.map(ex => ex.percentage);

                window.examChartInstance = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Exam Score (%)',
                            data: scores,
                            borderColor: '#3b82f6',
                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                            borderWidth: 2,
                            fill: true,
                            tension: 0.3,
                            pointBackgroundColor: '#10b981',
                            pointRadius: 4
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: { y: { beginAtZero: true, max: 100 } },
                        plugins: { legend: { display: false } }
                    }
                });
            }
        }

        const btnRedemption = document.getElementById('btn-train-redemption');
        if (btnRedemption) {
            btnRedemption.onclick = () => {
                btnRedemption.textContent = "Loading...";
                let pool = allQuestions.filter(q => allMistakes.includes(getQID(q))).sort(() => 0.5 - Math.random());
                if (pool.length > 50) pool = pool.slice(0, 50); 
                window.launchQuiz(pool, 'practice', 0, "Redemption Mode");
            };
        }

        const btnFocus = document.getElementById('btn-train-focus');
        if (btnFocus) {
            btnFocus.onclick = () => {
                btnFocus.textContent = "Loading...";
                const worstTopic = weaknesses[0]; 
                let pool = worstTopic.pool.filter(q => !attemptedQuestions.includes(getQID(q)) || allMistakes.includes(getQID(q)));
                if (pool.length === 0) pool = worstTopic.pool; 
                
                pool = pool.sort(() => 0.5 - Math.random()).slice(0, 15);
                window.launchQuiz(pool, 'practice', 0, `Targeted Focus: ${worstTopic.topic}`);
            };
        }

        const btnMix = document.getElementById('btn-train-mix');
        if (btnMix) {
            btnMix.onclick = () => {
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
// 16. STATE RESTORATION
// ==========================================
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
// 17. INITIALIZATION & AUTHENTICATION
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        localStorage.removeItem('edeetos_guest_mode');
        const userRef = doc(db, "users", user.uid);
        try {
            const docSnap = await getDoc(userRef);
            if (docSnap.exists()) {
                const dbData = docSnap.data();
                currentUserData = dbData; 
                currentUserRole = dbData.role || 'STUDENT';
                
                initMentorFeatures();
                
                isPremiumUser = false;
                if (dbData.role === 'ADMIN' || dbData.role === 'MANAGEMENT') {
                    isPremiumUser = true;
                    
                    // ==========================================
                    // NEW DIRECT-TO-GITHUB BATCH PUSH LOGIC
                    // ==========================================
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

        // Group edits by file
        const editsByCourse = {};
        pendingQueue.forEach(edit => {
            const key = edit.courseFile;
            if (!editsByCourse[key]) editsByCourse[key] = { isBook: edit.isBook, rows: [] };
            editsByCourse[key].rows.push(edit.row);
        });

        const owner = "hassaan506";
        const repo = "edeetos";
        const branch = "main";

        // Reusable Helper to Upload Files via GitHub API
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
            const hierarchyJsonPath = `${folder}/${courseFile}_hierarchy.json`;
            
            const csvUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${csvPath}`;

            // GET current CSV file via Blob API
            const getRes = await fetch(csvUrl + `?ref=${branch}`, { headers: { "Authorization": `Bearer ${token}` } });
            if (!getRes.ok) throw new Error(`Failed to fetch ${csvPath}. Check token permissions.`);
            
            const getJson = await getRes.json();
            const blobUrl = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${getJson.sha}`;
            const blobRes = await fetch(blobUrl, { headers: { "Authorization": `Bearer ${token}` } });
            
            if (!blobRes.ok) throw new Error("Failed to download CSV from GitHub Blob API.");
            const blobJson = await blobRes.json();
            
            // Decode and Strip Windows BOM
            const cleanCsvText = Base64.decode(blobJson.content).replace(/^\uFEFF/, '');
            
            // Parse CSV
            let parsed = Papa.parse(cleanCsvText, { header: true, skipEmptyLines: true });
            let rows = parsed.data;

            // 1. APPLY EDITS (Strictly preserves original row position)
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
                    // Update in-place so row order remains completely untouched
                    const targetRow = rows[qIndex];
                    Object.keys(updatedRow).forEach(newKey => {
                        const originalKey = Object.keys(targetRow).find(k => k.toLowerCase().replace(/\s/g, '') === newKey.toLowerCase().replace(/\s/g, ''));
                        targetRow[originalKey || newKey] = updatedRow[newKey];
                    });
                } else {
                    rows.push(updatedRow);
                }
            });

            // 2. CONVERT TO JSON IN BROWSER
            let outQs = [];
            let subTree = {}, sysTree = {}, exTree = {};

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
                const examsList = rawExams ? rawExams.split(',').map(e => e.trim()).filter(e => e) : [];

                let qObj = {
                    id: qId,
                    year: year,
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
                    hint: getVal(['hint'])
                };

                if (isBook) {
                    qObj.isBookQuestion = true;
                    qObj.bookName = courseFile;
                }

                outQs.push(qObj);

                // Build Hierarchy Trees
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
                if (year) {
                    if (!exTree[year]) exTree[year] = {};
                    examsList.forEach(ex => {
                        if (!exTree[year][ex]) exTree[year][ex] = {};
                        if (subject) {
                            if (!exTree[year][ex][subject]) exTree[year][ex][subject] = {};
                            if (topic) exTree[year][ex][subject][topic] = (exTree[year][ex][subject][topic] || 0) + 1;
                        }
                    });
                }
            });

            // 3. PUSH ALL THREE FILES DIRECTLY TO GITHUB
            const commitMsg = `Admin Panel: Updated ${editsByCourse[courseFile].rows.length} question(s) & synced JSON`;
            
            // Upload CSV
            await uploadFileToGitHub(csvPath, Papa.unparse(rows), commitMsg);
            
            // Upload Questions JSON
            await uploadFileToGitHub(questionsJsonPath, JSON.stringify(outQs, null, 4), commitMsg);
            
            // Upload Hierarchy JSON
            const hierarchyObj = { subjects: subTree, systems: sysTree, exams: exTree };
            await uploadFileToGitHub(hierarchyJsonPath, JSON.stringify(hierarchyObj, null, 4), commitMsg);
        }

        alert(`✅ Success! Edits saved and JSONs generated dynamically. Changes are live instantly!`);
        localStorage.removeItem('edeetos_pending_edits');
        btnPushEdits.style.display = 'none';

    } catch (error) {
        console.error(error);
        alert("❌ Push Failed: " + error.message);
        btnPushEdits.innerHTML = `<i class="fas fa-cloud-upload-alt"></i> Push <span id="pending-edits-count" style="background: white; color: #f59e0b; padding: 2px 6px; border-radius: 10px; font-size: 0.75rem;">${pendingQueue.length}</span>`;
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
                
                const courseData = dbData[activeCourse] || {};
                const booksData = dbData.books || {};

                const courseSolved = (courseData.solvedQuestions || []).map(id => String(id));
                const coursePracticeMistakes = (courseData.mistakes || []).map(id => String(id));
                const courseExamMistakes = (courseData.examMistakes || []).map(id => String(id));
                const courseBookmarks = (courseData.bookmarks || []).map(id => String(id));

                const bookSolved = (booksData.solvedQuestions || []).map(id => String(id));
                const bookPracticeMistakes = (booksData.mistakes || []).map(id => String(id));
                const bookExamMistakes = (booksData.examMistakes || []).map(id => String(id));
                const bookBookmarks = (booksData.bookmarks || []).map(id => String(id));

userExamHistory = [...(courseData.examHistory || []), ...(booksData.examHistory || [])];

                await loadDataAndBuildTree();

                // 1. Get all valid, currently loaded Course Question IDs
                const validCourseIDs = new Set(allQuestions.filter(q => !q.isBookQuestion).map(q => getQID(q)));

                // 2. Deduplicate arrays and filter out "ghost" IDs for the Course
                const validCourseSolved = [...new Set(courseSolved)].filter(id => validCourseIDs.has(id));
                const validCoursePracticeMistakes = [...new Set(coursePracticeMistakes)].filter(id => validCourseIDs.has(id));
                const validCourseExamMistakes = [...new Set(courseExamMistakes)].filter(id => validCourseIDs.has(id));
                const validCourseBookmarks = [...new Set(courseBookmarks)].filter(id => validCourseIDs.has(id));

                // 3. Deduplicate Books (Cannot filter ghosts yet because books are lazy-loaded)
                const uniqueBookSolved = [...new Set(bookSolved)];
                const uniqueBookPracticeMistakes = [...new Set(bookPracticeMistakes)];
                const uniqueBookExamMistakes = [...new Set(bookExamMistakes)];
                const uniqueBookBookmarks = [...new Set(bookBookmarks)];

                // 4. Update Global Variables so Grid/Popups match the Dashboard EXACTLY
                globalPracticeMistakes = [...validCoursePracticeMistakes, ...uniqueBookPracticeMistakes];
                globalExamMistakes = [...validCourseExamMistakes, ...uniqueBookExamMistakes];
                globalBookmarks = [...validCourseBookmarks, ...uniqueBookBookmarks];
                attemptedQuestions = [...validCourseSolved, ...uniqueBookSolved];

                // 5. Calculate Course Specific Stats based ONLY on valid, unique IDs
                const courseAllMistakes = [...new Set([...validCoursePracticeMistakes, ...validCourseExamMistakes])];
                const courseAttempts = validCourseSolved.length + courseAllMistakes.length;
                
                viewSpecificStats.course = {
                    solved: validCourseSolved,
                    mistakes: courseAllMistakes,
                    bookmarks: validCourseBookmarks,
                    accuracy: courseAttempts > 0 ? Math.round((validCourseSolved.length / courseAttempts) * 100) : 0
                };

                // 6. Calculate Book Specific Stats
                const bookAllMistakes = [...new Set([...uniqueBookPracticeMistakes, ...uniqueBookExamMistakes])];
                const bookAttempts = uniqueBookSolved.length + bookAllMistakes.length;
                
                viewSpecificStats.book = {
                    solved: uniqueBookSolved,
                    mistakes: bookAllMistakes,
                    bookmarks: uniqueBookBookmarks,
                    accuracy: bookAttempts > 0 ? Math.round((uniqueBookSolved.length / bookAttempts) * 100) : 0
                };

                // 7. Update DOM and UI
                restoreLastState();
                if (typeof updateDashboardUI === 'function') updateDashboardUI();
                
                const revisions = {
                    ...(courseData.revisions || {}),
                    ...(booksData.revisions || {})
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
                    revisionCard.style.borderColor = '#f59e0b';
                    revisionCard.style.boxShadow = '0 10px 25px -5px rgba(245, 158, 11, 0.15)';
                    revisionCard.style.padding = '20px'; 
                    revisionCard.style.gridColumn = '1 / -1'; 
                    revisionCard.style.marginBottom = '20px';
                    revisionCard.style.cursor = 'pointer';
                    revisionCard.style.display = 'flex';
                    revisionCard.style.justifyContent = 'space-between';
                    revisionCard.style.alignItems = 'center';

                    revisionCard.innerHTML = `
                        <div>
                            <h3 class="card-title" style="color: #92400e; margin: 0 0 5px 0;"><i class="fas fa-sync-alt" style="color: #f59e0b; margin-right: 8px;"></i> Due for Revision</h3>
                            <p style="color: #b45309; font-size: 0.85rem; margin: 0;">You have ${dueTopics.length} topics ready for spaced repetition.</p>
                        </div>
                        <button class="btn-solid" style="background: #f59e0b; border: none; padding: 10px 20px;">View Plan</button>
                    `;

                    let existingModal = document.getElementById('revision-popup-modal');
                    if (existingModal) existingModal.remove(); 

                    const modalOverlay = document.createElement('div');
                    modalOverlay.id = 'revision-popup-modal';
                    modalOverlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(15, 23, 42, 0.75); z-index: 99999; display: none; justify-content: center; align-items: center; backdrop-filter: blur(4px);";

                    let modalHtml = `
                        <div class="glass-panel" style="background: white; padding: 25px; border-radius: 12px; width: 90%; max-width: 600px; max-height: 85vh; display: flex; flex-direction: column; box-shadow: 0 20px 40px rgba(0,0,0,0.2);">
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 15px; margin-bottom: 15px;">
                                <h3 style="color: #1e3a8a; margin: 0;"><i class="fas fa-sync-alt" style="color: #f59e0b; margin-right: 8px;"></i> Spaced Repetition Plan</h3>
                                <button id="close-revision-popup" style="font-size: 1.5rem; color: #64748b; background: none; border: none; cursor: pointer;">&times;</button>
                            </div>
                            <div style="overflow-y: auto; flex-grow: 1; padding-right: 10px; display: flex; flex-direction: column; gap: 15px;">
                    `;

                    sortedDays.forEach(day => {
                        modalHtml += `
                            <div class="revision-day-group">
                                <button class="btn-outline" style="width: 100%; text-align: left; display: flex; justify-content: space-between; align-items: center; border: 1px solid #cbd5e1; background: #f8fafc; padding: 12px 15px; border-radius: 8px; cursor: pointer; transition: 0.2s;" onclick="const content = this.nextElementSibling; const icon = this.querySelector('.toggle-icon'); if(content.style.display === 'none'){ content.style.display = 'flex'; icon.style.transform = 'rotate(180deg)'; this.style.borderColor = '#3b82f6'; this.style.background = '#eff6ff'; } else { content.style.display = 'none'; icon.style.transform = 'rotate(0deg)'; this.style.borderColor = '#cbd5e1'; this.style.background = '#f8fafc'; }">
                                    <div style="font-weight: 700; color: #1e293b; font-size: 1rem;">
                                        <i class="fas fa-calendar-day" style="color: #3b82f6; margin-right: 8px;"></i> Day ${day}
                                    </div>
                                    <div style="display: flex; align-items: center; gap: 12px;">
                                        <span class="badge" style="background: #e2e8f0; color: #475569; padding: 4px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: bold;">${groupedByDay[day].length} Topics</span>
                                        <i class="fas fa-chevron-down toggle-icon" style="color: #64748b; transition: transform 0.3s;"></i>
                                    </div>
                                </button>
                                
                                <div class="day-content" style="display: none; flex-direction: column; gap: 8px; margin-top: 10px; padding-left: 10px; border-left: 2px solid #cbd5e1; margin-left: 5px;">
                        `;

                        groupedByDay[day].forEach(item => {
                            const safeTopic = encodeURIComponent(item.id);
                            const displayPath = `
                                <span style="color:#64748b; font-size:0.75rem; margin-bottom: 3px;">${item.subject} <span style="color:#cbd5e1; margin:0 3px;">&gt;</span> ${item.chapter} <span style="color:#cbd5e1; margin:0 3px;">&gt;</span></span>
                                <span style="color:#92400e; font-size: 0.95rem;">${item.topic}</span>
                            `;

                            modalHtml += `
                                <button class="btn-outline" style="width: 100%; text-align: left; display: flex; justify-content: space-between; align-items: center; border: 1px solid #fcd34d; background: #fffbeb; padding: 12px 15px; border-radius: 8px; cursor: pointer; transition: 0.2s;" onmouseover="this.style.background='#fef3c7'" onmouseout="this.style.background='#fffbeb'" onclick="window.generateRevisionQuiz(decodeURIComponent('${safeTopic}'))">
                                    <div style="font-weight: 700; display: flex; flex-direction: column; width: 90%;">
                                        ${displayPath}
                                    </div>
                                    <i class="fas fa-play-circle" style="color: #f59e0b; font-size: 1.3rem; flex-shrink: 0; margin-left: 10px;"></i>
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
                    btnMistakes.onclick = () => {
                        isGlobalPopupActive = true;
                        const isBook = currentView === 'book';
                        
                        const activeMistakes = isBook ? viewSpecificStats.book.mistakes : viewSpecificStats.course.mistakes;
                        if (activeMistakes.length === 0) {
                            alert(isBook ? "You don't have any book mistakes yet." : "You don't have any course mistakes yet.");
                            return;
                        }

                        const pPool = allQuestions.filter(q => globalPracticeMistakes.includes(getQID(q)) && !!q.isBookQuestion === isBook);
                        const ePool = allQuestions.filter(q => globalExamMistakes.includes(getQID(q)) && !!q.isBookQuestion === isBook);

                        if (pPool.length === 0 && ePool.length === 0 && isBook) {
                            alert("Book mistakes exist, but you must open the specific book first to load its questions into memory.");
                            return;
                        }

                        let combinedTree = {};
                        if (pPool.length > 0) combinedTree["Practice Mistakes"] = buildSubTree(pPool);
                        if (ePool.length > 0) combinedTree["Exam Mistakes"] = buildSubTree(ePool);

                        activeCustomPool = [...new Set([...pPool, ...ePool])];
                        openPopup(isBook ? "⚠️ Book Mistakes" : "⚠️️ Course Mistakes", combinedTree, 'Level1', []);
                    };
                }

                const btnBookmarks = document.getElementById('btn-review-bookmarks');
                if (btnBookmarks) {
                    btnBookmarks.disabled = false;
                    btnBookmarks.style.cursor = "pointer";
                    btnBookmarks.onclick = () => {
                        isGlobalPopupActive = true;
                        const isBook = currentView === 'book';
                        
                        const activeBookmarks = isBook ? viewSpecificStats.book.bookmarks : viewSpecificStats.course.bookmarks;
                        if (activeBookmarks.length === 0) {
                            alert(isBook ? "You don't have any book bookmarks yet." : "You don't have any course bookmarks yet.");
                            return;
                        }

                        const bPool = allQuestions.filter(q => globalBookmarks.includes(getQID(q)) && !!q.isBookQuestion === isBook);

                        if (bPool.length === 0 && isBook) {
                            alert("Book bookmarks exist, but you must open the specific book first to load its questions into memory.");
                            return;
                        }

                        activeCustomPool = bPool;
                        openPopup(isBook ? "⭐ Book Bookmarks" : "⭐ Course Bookmarks", buildSubTree(bPool), 'Level1', []);
                    };
                }
                
                setTimeout(() => {
                    const flawlessCount = attemptedQuestions.filter(id => !allMistakes.includes(id)).length;
                    checkMilestones(flawlessCount);
                }, 2000);

            }
        } catch (error) { console.error("Error fetching stats:", error); }
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