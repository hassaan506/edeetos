import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, addDoc, collection, serverTimestamp, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

const loadedBooksCache = {}; 

const savedCourse = localStorage.getItem('edeetos_active_course');
if (!savedCourse) {
    window.location.href = 'dashboard.html';
}
const activeCourse = savedCourse;

const allBooks = [
    { file: "firstaid_step1", title: "First Aid Step 1" },
    { file: "firstaid_step2", title: "First Aid Step 2" },
    { file: "rafiullah", title: "Rafiullah FCPS" },
    { file: "im_medicine", title: "Irfan Masood - Medicine" },
    { file: "im_surgery", title: "Irfan Masood - Surgery" },
    { file: "im_pathology", title: "Irfan Masood - Pathology" },
    { file: "im_pediatrics", title: "Irfan Masood - Pediatrics" },
    { file: "brs_patho", title: "BRS - Pathology" },
    { file: "brs_physio", title: "BRS - Physiology" },
    { file: "doubleAA", title: "Double AA" }
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

        document.getElementById('btn-exit-host-room').addEventListener('click', async () => {
            if(confirm("Are you sure you want to close this study room? Guests will be disconnected.")) {
                const btn = document.getElementById('btn-exit-host-room');
                btn.textContent = "Closing...";
                btn.disabled = true;
                btn.style.background = "#991b1b";
                
                try {
                    await updateDoc(doc(db, "study_rooms", activeRoomId), { status: 'closed' });
                } catch(e) {
                    console.warn("Could not sync room closure to Firebase:", e);
                }
                
                localStorage.removeItem('active_study_room');
                localStorage.removeItem('is_study_guest');
                hostBanner.remove();
            }
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
}

// ==========================================
// 6. GLOBAL SEARCH SYSTEM
// ==========================================
let searchTimeout;
globalSearch.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.toLowerCase().trim();
    
    if (query.length < 3) {
        searchDropdown.style.display = 'none';
        return;
    }

    searchTimeout = setTimeout(() => {
        const matchedQuestions = allQuestions.filter(q => {
            if (unattemptedFilter.checked && attemptedQuestions.includes(getQID(q))) return false;
            const questionText = q.Question || q.question || q.text || q.statement || "";
            const textToSearch = `${q.Subject || ''} ${q.Chapter || ''} ${q.Topic || ''} ${questionText}`.toLowerCase();
            return textToSearch.includes(query);
        });

        searchDropdown.innerHTML = '';
        if (matchedQuestions.length === 0) {
            searchDropdown.innerHTML = `<div class="search-item" style="color:#64748b;">No matches found for "${query}"</div>`;
        } else {
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

document.addEventListener('click', (e) => {
    if (!globalSearch.contains(e.target) && !searchDropdown.contains(e.target)) {
        searchDropdown.style.display = 'none';
    }
});

unattemptedFilter.addEventListener('change', () => {
    if (currentView === 'book') renderBooksGrid();
    else renderGrid();
});

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
        if (unattemptedFilter.checked && qCount === 0) return;

        const doneCount = getSolvedCount(currentView, [cardTitle]);
        const percent = qCount > 0 ? Math.round((doneCount / qCount) * 100) : 0;

        const countHtml = `<span class="card-count">${doneCount} / ${qCount}</span>`;
        const progressHtml = `<div class="progress-container"><div class="progress-bar-fill" style="width: ${percent}%; background-color: #10b981;"></div></div>`;

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
            const response = await fetch(`Books/${book.file}_questions.json`, { cache: 'force-cache' });
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
popupBack.onclick = () => {
    popupHistory.pop();
    const prev = popupHistory[popupHistory.length - 1];
    openPopup(prev.title, prev.dataObj, prev.level, prev.pathArr, true);
};

popupClose.onclick = () => { 
    popupHistory = []; 
    popupOverlay.style.display = 'none'; 
    activeCustomPool = null; 
    isGlobalPopupActive = false; 
    localStorage.removeItem('edeetos_saved_popup_path'); 
    localStorage.removeItem('edeetos_saved_popup_title');
};

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

function openPopup(title, dataObj, level, pathArr, isBackNav = false) {
    if (!isBackNav) popupHistory.push({ title, dataObj, level, pathArr });

    popupTitle.textContent = title;
	localStorage.setItem('edeetos_saved_popup_path', JSON.stringify(pathArr));
    localStorage.setItem('edeetos_saved_popup_title', title);
    popupList.innerHTML = '';
    popupOverlay.style.display = 'flex';
    popupBack.style.display = popupHistory.length > 1 ? 'inline-block' : 'none';

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
    popupList.appendChild(selectAllDiv);

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

    const qCount = getQuestionCount(currentView, itemPath);
    
    let countHtml = '';
    let progressHtml = '';

    if (typeof isGlobalPopupActive !== 'undefined' && isGlobalPopupActive) {
        countHtml = `<span class="card-count" style="background: #e2e8f0; color: #334155; padding: 2px 8px; border-radius: 12px; font-weight: bold;">${qCount} Qs</span>`;
    } else {
        const doneCount = getSolvedCount(currentView, itemPath);
        const percent = qCount > 0 ? Math.round((doneCount / qCount) * 100) : 0;
        countHtml = `<span class="card-count">${doneCount} / ${qCount}</span>`;
        progressHtml = `<div class="progress-container"><div class="progress-bar-fill" style="width: ${percent}%; background-color: #10b981;"></div></div>`;
    }

    const hasSubLevels = typeof nextData === 'object' && nextData !== null && Object.keys(nextData).length > 0;
    
    const safePath = encodeURIComponent(JSON.stringify(itemPath));
    const pathStr = JSON.stringify(itemPath);

    const instantStartBtn = `<button class="btn-solid mini-btn" style="margin-left: 10px; background: #10b981; border: none; padding: 0.3rem 0.6rem; font-size: 0.75rem; border-radius: 4px;" onclick="event.stopPropagation(); startInstantPractice('${safePath}')">Start</button>`;

    labelDiv.innerHTML = `
        <div class="card-header-flex" style="align-items: center;">
            <span style="font-weight: 600; display: flex; align-items: center;">
                <input type="checkbox" class="item-checkbox" style="margin-right: 12px; transform: scale(1.3); cursor: pointer;">
                ${itemName}
            </span>
            <div style="display: flex; align-items: center; gap: 8px;">
                ${countHtml}
                ${instantStartBtn}
            </div>
        </div>
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
        if (cartCountEl) cartCountEl.textContent = `${selectedCart.size} Topics Selected`;
        if (startBtnEl) startBtnEl.disabled = selectedCart.size === 0;
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

    popupList.appendChild(itemDiv);
}

// ==========================================
// 9. EXAM LAUNCH & MODES
// ==========================================
document.getElementById('mode-practice').addEventListener('click', () => switchMode('practice'));
document.getElementById('mode-exam').addEventListener('click', () => switchMode('exam'));

function switchMode(mode) {
    currentMode = mode;
    
    const searchBar = document.querySelector('.search-filter-bar');
    const modeDesc = document.getElementById('mode-description');
    const startBtn = document.getElementById('start-exam-btn');
    const inputGroups = document.querySelectorAll('.exam-action-bar .input-group');
    
    document.getElementById('exam-cart').style.display = "flex";
    startBtn.textContent = mode === 'practice' ? 'Start Practice' : 'Start Exam';

    if (mode === 'practice') {
        document.getElementById('mode-practice').className = "btn-solid active-mode";
        document.getElementById('mode-exam').className = "btn-outline";
		inputGroups.forEach(group => group.style.display = 'none');
        if (modeDesc) modeDesc.textContent = "Practice Mode: Select your topics below. Enjoy instant feedback and detailed explanations.";
        if (searchBar) searchBar.style.display = "flex";
    } else {
        document.getElementById('mode-exam').className = "btn-solid active-mode";
        document.getElementById('mode-practice').className = "btn-outline";
		inputGroups.forEach(group => group.style.display = 'flex');
        if (modeDesc) modeDesc.textContent = "Exam Mode: Strict timer, no instant feedback, skipped questions appear at the end.";
        if (searchBar) searchBar.style.display = "none";
    }
    
    if (currentView === 'book') renderBooksGrid();
    else renderGrid();

    if (popupOverlay.style.display === 'flex') {
        const current = popupHistory[popupHistory.length - 1];
        if (current) {
            popupHistory.pop(); 
            openPopup(current.title, current.dataObj, current.level, current.pathArr, false);
        }
    }
}

if (examQInput) {
    examQInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') startExamBtn.click();
    });
}
if (examTimerInput) {
    examTimerInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') startExamBtn.click();
    });
}

document.getElementById('start-exam-btn').addEventListener('click', () => {
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

    if (qCountInput && qCountInput > 0 && qCountInput < pool.length) {
        pool = pool.sort(() => 0.5 - Math.random()).slice(0, qCountInput);
    } else {
        pool = pool.sort(() => 0.5 - Math.random());
    }
    
    const generatedTitle = generateExamTitle(paths, currentView);
    window.launchQuiz(pool, currentMode, currentMode === 'exam' ? timerInput : 0, generatedTitle);
});

window.startInstantPractice = function(encodedPath) {
    const pathArr = JSON.parse(decodeURIComponent(encodedPath));
    let pool = activeCustomPool || allQuestions;
    
    let finalPool = pool.filter(q => getQuestionCount(currentView, pathArr, [q]) > 0);
    
    if (finalPool.length === 0) return alert("No unattempted questions left in this topic!");
    
    finalPool = finalPool.sort(() => 0.5 - Math.random());
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

    if (roomId && !isGuest) {
        try {
            document.body.style.cursor = 'wait'; 
            
            let safeArray = questionsArray;
            if (questionsArray.length > 50) {
                safeArray = questionsArray.sort(() => 0.5 - Math.random()).slice(0, 50);
            }

            const cleanPool = JSON.parse(JSON.stringify(safeArray));

            await setDoc(doc(db, "study_rooms", roomId), {
                questions: cleanPool,
                quizConfig: { mode, timer: timerMinutes, examName },
                status: 'playing', 
                currentQuestionIndex: 0,
                answers: {},       
                memberAnswers: {},
                forceReveal: {}     
            }, { merge: true });

            localStorage.setItem('edeetos_active_quiz', JSON.stringify(cleanPool));
            localStorage.setItem('edeetos_quiz_config', JSON.stringify({ mode: mode, timer: timerMinutes, examName: examName }));

            document.body.style.cursor = 'default';
            window.location.href = 'quiz.html';
            return;
        } catch (error) {
            console.error("Failed to sync room:", error);
            alert("Firebase Error: " + error.message);
            document.body.style.cursor = 'default';
            return;
        }
    }

    localStorage.setItem('edeetos_active_quiz', JSON.stringify(questionsArray));
    localStorage.setItem('edeetos_quiz_config', JSON.stringify({ mode: mode, timer: timerMinutes, examName: examName }));
    window.location.href = 'quiz.html';
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
            return `${topArr[0]} - ${subArr.join(" + ")}`; 
        } else {
            return subArr.length > 0 ? subArr.join(" + ") : topArr.join(" + "); 
        }
    }
    if (topArr.length === 1) {
        if (subArr.length > 3 || subArr.length === 0) return `${topArr[0]} (Full)`;
        else return `${topArr[0]} - ${subArr.join(" + ")}`;
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
function applyTierLimits(rawQuestions, limitPerCategory) {
    let filteredList = [];
    const questionsByCategory = {};

    rawQuestions.forEach(q => {
        const cat = q.Subject || q.Chapter || "_internal_cat_";
        const top = q.Topic || "_internal_top_";
        if (!questionsByCategory[cat]) questionsByCategory[cat] = {};
        if (!questionsByCategory[cat][top]) questionsByCategory[cat][top] = [];
        questionsByCategory[cat][top].push(q);
    });

    Object.keys(questionsByCategory).forEach(cat => {
        const topics = Object.keys(questionsByCategory[cat]);
        const numTopics = topics.length;

        const baseQuota = Math.floor(limitPerCategory / numTopics);
        let remainder = limitPerCategory % numTopics;

        topics.forEach(top => {
            const quota = baseQuota + (remainder > 0 ? 1 : 0);
            if (remainder > 0) remainder--;
            filteredList.push(...questionsByCategory[cat][top].slice(0, quota));
        });
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
        examTree = hierarchyData.exams || {};

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
        return pool.filter(q => !(!isGlobalPopupActive && unattemptedFilter.checked) || !attemptedQuestions.includes(getQID(q))).length;
    }

    return pool.filter(q => {
        if (!isGlobalPopupActive && unattemptedFilter.checked && attemptedQuestions.includes(getQID(q))) return false;

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
            const qYear = q.Year || "Other Years";
            if (paths[0] && qYear !== paths[0]) return false;
            if (paths[1] && (!q.Exam || !q.Exam.includes(paths[1]))) return false;
            if (paths[2] && q.Subject !== paths[2]) return false;
            if (paths[3] && q.Topic !== paths[3]) return false;
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
        resetModal.style.display = 'flex';
    };
}

if (closeResetModal) {
    closeResetModal.onclick = () => resetModal.style.display = 'none';
}

document.querySelectorAll('.reset-option-btn').forEach(btn => {
    btn.onclick = (e) => {
        const type = btn.getAttribute('data-type'); 
        const activeCourse = localStorage.getItem('edeetos_active_course');

        switch (type) {
            case "1":
                pendingUpdates = {
                    [`${activeCourse}.solvedQuestions`]: [],
                    [`${activeCourse}.mistakes`]: [],
                    [`${activeCourse}.examMistakes`]: [],
                    [`${activeCourse}.bookmarks`]: [],
                    [`${activeCourse}.examHistory`]: [],
                    [`${activeCourse}.revisions`]: {},
                    [`books.solvedQuestions`]: [],
                    [`books.mistakes`]: [],
                    [`books.examMistakes`]: [],
                    [`books.bookmarks`]: [],
                    [`books.examHistory`]: [],
                    [`books.revisions`]: {} 
                };
                pendingResetMsg = "All progress has been fully reset!";
                confirmText.textContent = "Are you sure you want to completely wipe ALL your progress for this course and your books? This cannot be undone.";
                break;
            case "2":
                pendingUpdates = { 
                    [`${activeCourse}.mistakes`]: [], 
                    [`${activeCourse}.examMistakes`]: [],
                    [`books.mistakes`]: [], 
                    [`books.examMistakes`]: [] 
                };
                pendingResetMsg = "All mistakes have been cleared!";
                confirmText.textContent = "Are you sure you want to clear your Mistake history?";
                break;
            case "3":
                pendingUpdates = { 
                    [`${activeCourse}.bookmarks`]: [],
                    [`books.bookmarks`]: [] 
                };
                pendingResetMsg = "All bookmarks have been cleared!";
                confirmText.textContent = "Are you sure you want to delete all your Bookmarks?";
                break;
            case "4":
                pendingUpdates = { 
                    [`${activeCourse}.examHistory`]: [],
                    [`books.examHistory`]: [] 
                };
                pendingResetMsg = "Exam history has been cleared!";
                confirmText.textContent = "Are you sure you want to delete your Past Exam scores?";
                break;
            case "5":
                pendingUpdates = { 
                    [`${activeCourse}.solvedQuestions`]: [],
                    [`books.solvedQuestions`]: [] 
                };
                pendingResetMsg = "Solved questions have been cleared!";
                confirmText.textContent = "Are you sure you want to clear your Solved Questions? Your mistakes and bookmarks will remain.";
                break;
        }

        optionsContainer.style.display = 'none';
        confirmContainer.style.display = 'block';
    };
});

if (btnCancelReset) {
    btnCancelReset.onclick = () => {
        confirmContainer.style.display = 'none';
        optionsContainer.style.display = 'flex';
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

            confirmText.innerHTML = `✅ ${pendingResetMsg}`;
            btnCancelReset.style.display = 'none';
            btnConfirmReset.style.display = 'none';

            setTimeout(() => {
                location.reload();
            }, 1500);

        } catch (err) {
            console.error("Reset Error:", err);
            confirmText.textContent = "❌ Error clearing data. Check console.";
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
    { title: "Novice", req: 10, icon: "👶", reward: null },
    { title: "Bronze", req: 100, icon: "🥉", reward: null },
    { title: "Silver", req: 500, icon: "🥈", reward: "3 Days Premium Free" },
    { title: "Gold", req: 1000, icon: "🥇", reward: "1 Week Premium Free" },
    { title: "Diamond", req: 2000, icon: "💎", reward: "2 Weeks Premium Free" },
    { title: "Master", req: 5000, icon: "👑", reward: "3 Weeks Premium Free" }
];

let currentCum = 0;
const processedTrophies = trophies.map(t => {
    const prev = currentCum;
    currentCum += t.req;
    return { ...t, cumulativeReq: currentCum, previousCum: prev };
});

function checkMilestones(currentFlawless) {
    if (localStorage.getItem('edeetos_guest_mode') === 'true') return;

    const storageKey = `edeetos_unlocked_tiers_${auth.currentUser?.uid || 'user'}`;
    let unlockedTiers = JSON.parse(localStorage.getItem(storageKey)) || [];

    const newlyUnlocked = processedTrophies.filter(t => currentFlawless >= t.cumulativeReq && !unlockedTiers.includes(t.title));

    if (newlyUnlocked.length > 0) {
        const highestNew = newlyUnlocked[newlyUnlocked.length - 1];
        showMilestonePopup(highestNew);

        newlyUnlocked.forEach(t => unlockedTiers.push(t.title));
        localStorage.setItem(storageKey, JSON.stringify(unlockedTiers));
    }
}

function showMilestonePopup(trophy) {
    const modal = document.createElement('div');
    modal.style.cssText = "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(15, 23, 42, 0.85); z-index: 999999; display: flex; justify-content: center; align-items: center; backdrop-filter: blur(8px);";
    
    const rewardHtml = trophy.reward 
        ? `<div style="background: #ecfdf5; border: 1px solid #10b981; color: #065f46; padding: 12px; border-radius: 8px; margin: 15px 0; font-weight: bold; display: inline-block;"><i class="fas fa-gift"></i> Reward Unlocked: ${trophy.reward}</div>` 
        : `<div style="margin: 15px 0;"></div>`;

    modal.innerHTML = `
        <div class="glass-panel" style="background: white; padding: 30px; border-radius: 16px; text-align: center; max-width: 400px; width: 90%; box-shadow: 0 25px 50px rgba(0,0,0,0.25); animation: popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
            <div style="font-size: 5rem; margin-bottom: 10px;">${trophy.icon}</div>
            <h2 style="color: #1e3a8a; margin-bottom: 10px;">Milestone Reached!</h2>
            <p style="color: #475569; font-size: 1.1rem; margin-bottom: 5px;">You achieved the <strong>${trophy.title}</strong> rank by completing this tier's ${trophy.req} flawless questions!</p>
            ${rewardHtml}
            <button id="close-milestone-btn" class="btn-solid" style="background: #3b82f6; border: none; width: 100%; margin-top: 15px; padding: 12px; font-size: 1.1rem; cursor: pointer; border-radius: 8px;">Continue Journey</button>
        </div>
        <style>
            @keyframes popIn { 0% { transform: scale(0.8); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        </style>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#close-milestone-btn').onclick = () => modal.remove();
}

if (btnJourney) {
    btnJourney.onclick = () => {
        if (localStorage.getItem('edeetos_guest_mode') === 'true') {
            return alert("Please register an account to track your Journey and unlock trophies.");
        }
        
        const allMistakes = [...new Set([...globalPracticeMistakes, ...globalExamMistakes])];
        const flawlessCount = attemptedQuestions.filter(id => !allMistakes.includes(id)).length;

        trophiesGrid.innerHTML = processedTrophies.map(t => {
            const isUnlocked = flawlessCount >= t.cumulativeReq;
            
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
            
            const rewardHtml = t.reward 
                ? `<div style="font-size: 0.75rem; font-weight: bold; color: ${isUnlocked ? '#10b981' : '#f59e0b'}; margin-top: 6px;"><i class="fas fa-gift"></i> Reward: ${t.reward}</div>` 
                : '';

            return `
                <div class="glass-panel" style="display: flex; align-items: center; padding: 0.9rem; border-radius: 12px; background: ${bgColor}; border: 2px solid ${borderColor}; box-shadow: ${isUnlocked ? '0 4px 12px rgba(0,0,0,0.05)' : 'none'};">
                    <div style="font-size: 2.2rem; margin-right: 1rem; ${iconStyle}">${t.icon}</div>
                    <div style="flex-grow: 1;">
                        <div style="font-weight: 800; color: ${textColor}; font-size: 1.05rem; margin-bottom: 0.1rem;">${t.title}</div>
                        <div style="font-size: 0.75rem; color: #64748b;">${progress} / ${t.req} Flawless Qs</div>
                        ${rewardHtml}
                    </div>
                    <div style="font-size: 1.3rem;">
                        ${statusIcon}
                    </div>
                </div>
            `;
        }).join('');

        journeyModal.style.display = 'flex';
    };
}

if (closeJourneyBtn) {
    closeJourneyBtn.onclick = () => journeyModal.style.display = 'none';
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
                const response = await fetch(`Books/${book.file}_questions.json`, { cache: 'force-cache' });
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

        allQuestions.forEach(q => {
            const topicName = q.Topic || q.Chapter || q.Subject || "Core Material";
            const qId = getQID(q);
            
            if (!stats[topicName]) {
                stats[topicName] = { total: 0, attempted: 0, mistakes: 0, questions: [] };
            }
            
            stats[topicName].total++;
            stats[topicName].questions.push(q);

            const isAttempted = attemptedQuestions.includes(qId) || allMistakes.includes(qId);
            const isMistake = allMistakes.includes(qId);

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
            html += `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 25px;">`;
            
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
                html += `<button id="btn-train-redemption" class="btn-solid" style="background: #f59e0b; border: none; padding: 12px; border-radius: 8px; text-align: left; display: flex; align-items: center; justify-content: space-between;">
                            <span style="font-weight: bold; font-size: 0.95rem;"><i class="fas fa-sync-alt" style="margin-right: 8px;"></i> Redemption Mode</span>
                            <span style="font-size: 0.75rem; background: rgba(255,255,255,0.3); padding: 3px 8px; border-radius: 12px;">Revisit ${totalMistakesCount} Mistakes</span>
                         </button>`;
            }

            if (weaknesses.length > 0) {
                html += `<button id="btn-train-focus" class="btn-solid" style="background: #ef4444; border: none; padding: 12px; border-radius: 8px; text-align: left; display: flex; align-items: center; justify-content: space-between;">
                            <span style="font-weight: bold; font-size: 0.95rem;"><i class="fas fa-bullseye" style="margin-right: 8px;"></i> Targeted Focus</span>
                            <span style="font-size: 0.75rem; background: rgba(255,255,255,0.3); padding: 3px 8px; border-radius: 12px;">Drill 15 Qs on Weakest Topic</span>
                         </button>`;
            }

            if (strengths.length > 0 && weaknesses.length > 0) {
                html += `<button id="btn-train-mix" class="btn-solid" style="background: #3b82f6; border: none; padding: 12px; border-radius: 8px; text-align: left; display: flex; align-items: center; justify-content: space-between;">
                            <span style="font-weight: bold; font-size: 0.95rem;"><i class="fas fa-balance-scale" style="margin-right: 8px;"></i> Balanced Mix</span>
                            <span style="font-size: 0.75rem; background: rgba(255,255,255,0.3); padding: 3px 8px; border-radius: 12px;">30 Qs (Strengths + Weaknesses)</span>
                         </button>`;
            }

            html += `</div>`;
        }

        html += `<h4 style="color:#475569; border-bottom:2px solid #e2e8f0; padding-bottom:5px; margin-top:10px;"><i class="fas fa-history" style="margin-right: 5px;"></i> Recent Exams</h4>`;
        if (userExamHistory.length === 0) {
            html += `<p style="font-size:0.8rem; color:#64748b; text-align:center;">No exams taken yet.</p>`;
        } else {
            html += `<div style="font-size:0.85rem; max-height:180px; overflow-y:auto;">
                        <table style="width:100%; text-align:left; border-collapse: collapse;">
                            <tr style="color:#64748b; border-bottom: 2px solid #e2e8f0;">
                                <th style="padding: 8px 0;">Date</th>
                                <th style="padding: 8px 0;">Exam Name</th>
                                <th style="padding: 8px 0;">Score</th>
                            </tr>`;
            userExamHistory.slice().reverse().slice(0, 10).forEach(ex => {
                html += `<tr style="border-bottom:1px solid #f1f5f9;">
                            <td style="padding:10px 0; color: #475569;">${new Date(ex.date).toLocaleDateString()}</td>
                            <td style="color: #1e293b; font-weight: 500;">${ex.examName}</td>
                            <td style="color:${ex.percentage >= 75 ? '#10b981' : '#ef4444'}; font-weight:bold;">${ex.percentage}%</td>
                         </tr>`;
            });
            html += `</table></div>`;
        }

        body.innerHTML = html;
        document.getElementById('analytics-modal').style.display = 'flex';

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
if (closeAnalytics) closeAnalytics.onclick = () => document.getElementById('analytics-modal').style.display = 'none';

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
                
                // Initialize Mentor Tools if allowed
                initMentorFeatures();
                
                isPremiumUser = false;
                if (dbData.role === 'ADMIN' || dbData.role === 'MANAGEMENT') {
                    isPremiumUser = true;
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

                const solvedList = [...new Set([...courseSolved, ...bookSolved])];
                globalPracticeMistakes = [...new Set([...coursePracticeMistakes, ...bookPracticeMistakes])];
                globalExamMistakes = [...new Set([...courseExamMistakes, ...bookExamMistakes])];
                globalBookmarks = [...new Set([...courseBookmarks, ...bookBookmarks])];

                userExamHistory = [...(courseData.examHistory || []), ...(booksData.examHistory || [])];

                attemptedQuestions = solvedList;

                await loadDataAndBuildTree();
                restoreLastState();

                const allMistakes = [...new Set([...globalPracticeMistakes, ...globalExamMistakes])];
                const totalAttempts = solvedList.length + allMistakes.length;
                let accuracy = totalAttempts > 0 ? Math.round((solvedList.length / totalAttempts) * 100) : 0;

                if (document.getElementById('stat-solved')) document.getElementById('stat-solved').textContent = solvedList.length;
                if (document.getElementById('stat-mistakes')) document.getElementById('stat-mistakes').textContent = allMistakes.length;
                if (document.getElementById('stat-bookmarks')) document.getElementById('stat-bookmarks').textContent = globalBookmarks.length;
                if (document.getElementById('stat-accuracy')) document.getElementById('stat-accuracy').textContent = `${accuracy}%`;
                
                // --- Spaced Repetition Block ---
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
                    closeBtn.onclick = (e) => {
                        e.stopPropagation();
                        modalOverlay.style.display = 'none';
                    };

                    modalOverlay.onclick = (e) => {
                        if (e.target === modalOverlay) modalOverlay.style.display = 'none';
                    };

                    revisionContainer.innerHTML = ''; 
                    revisionContainer.appendChild(revisionCard);

                } else if (revisionContainer) {
                    revisionContainer.innerHTML = '';
                }
				
                const btnMistakes = document.getElementById('btn-practice-mistakes');
                if (btnMistakes && allMistakes.length > 0) {
                    btnMistakes.disabled = false;
                    btnMistakes.style.cursor = "pointer";
                    btnMistakes.onclick = () => {
                        isGlobalPopupActive = true;
                        const pPool = allQuestions.filter(q => globalPracticeMistakes.includes(getQID(q)));
                        const ePool = allQuestions.filter(q => globalExamMistakes.includes(getQID(q)));

                        let combinedTree = {};
                        if (pPool.length > 0) combinedTree["Practice Mistakes"] = buildSubTree(pPool);
                        if (ePool.length > 0) combinedTree["Exam Mistakes"] = buildSubTree(ePool);

                        activeCustomPool = [...pPool, ...ePool];
                        openPopup("⚠️ Review Mistakes", combinedTree, 'Level1', []);
                    };
                }

                const btnBookmarks = document.getElementById('btn-review-bookmarks');
                if (btnBookmarks && globalBookmarks.length > 0) {
                    btnBookmarks.disabled = false;
                    btnBookmarks.style.cursor = "pointer";
                    btnBookmarks.onclick = () => {
                        isGlobalPopupActive = true;
                        const bPool = allQuestions.filter(q => globalBookmarks.includes(getQID(q)));
                        activeCustomPool = bPool;
                        openPopup("⭐ Bookmarks", buildSubTree(bPool), 'Level1', []);
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