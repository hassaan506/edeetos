import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, addDoc, collection, serverTimestamp, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
// ==========================================
// 1. STATE VARIABLES
// ==========================================
let subjectTree = {};
let systemTree = {};
let examTree = {};
let allQuestions = []; // The final pool used by the UI
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

// Allow Enter key to trigger Start Exam natively since these inputs aren't in a real <form>
const examQInput = document.getElementById('exam-q-count');
const examTimerInput = document.getElementById('exam-timer');
const startExamBtn = document.getElementById('start-exam-btn');

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
// ==========================================
// MENTOR FEATURE: ASSIGN EXAM TO STUDENT(S)
// ==========================================
setTimeout(() => {
    if (currentUserRole === 'MENTOR' || currentUserRole === 'ADMIN' || currentUserRole === 'MANAGEMENT') {
        const startBtn = document.getElementById('start-exam-btn');
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

                if (!timerInput || timerInput <= 0 || isNaN(timerInput)) {
                    alert("Please enter a valid time in minutes.");
                    return;
                }

                if (qCountInput && qCountInput > 0 && qCountInput < examPool.length) {
                    examPool = examPool.sort(() => 0.5 - Math.random()).slice(0, qCountInput);
                } else {
                    examPool = examPool.sort(() => 0.5 - Math.random());
                }

                if (examPool.length === 0) {
                    return alert("No questions selected!");
                }

                const generatedTitle = generateExamTitle(paths, currentView) + " (Assigned)";

                // Change button state while fetching users
                assignBtn.textContent = "Loading Students...";
                assignBtn.disabled = true;

                try {
                    // 1. Fetch Students from Firestore
                    const usersRef = collection(db, "users");
                    const userSnap = await getDocs(usersRef);
                    
                    let studentsList = [];
                    userSnap.forEach(docSnap => {
                        const data = docSnap.data();
                        const role = (data.role || 'STUDENT').toUpperCase();
                        // Filter out mentors, admins, and banned users
                        if (role !== 'ADMIN' && role !== 'MENTOR' && role !== 'MANAGEMENT' && role !== 'BANNED') {
                            studentsList.push({
                                id: docSnap.id,
                                name: data.fullName || "Unnamed User",
                                email: data.email || "No Email"
                            });
                        }
                    });

                    // 2. Build the UI Modal dynamically
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
                        // Sort students alphabetically by name
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

                    // 3. Add interactions to the modal
                    const searchInput = document.getElementById('student-search-input');
                    const studentItems = document.querySelectorAll('.student-item');

                    // Search filtering
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

                    // Cancel Button
                    document.getElementById('btn-cancel-assign').addEventListener('click', () => {
                        document.body.removeChild(modalOverlay);
                    });

// Confirm Button
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
                            // 🚀 THE FIX: Sanitize the data! 
                            // This instantly strips out any hidden 'undefined' values that the CSV loader 
                            // might have left behind, which Firestore heavily rejects.
                            const cleanExamPool = JSON.parse(JSON.stringify(examPool));

                            await addDoc(collection(db, "assigned_exams"), {
                                title: generatedTitle,
                                assignedBy: auth.currentUser.uid,
                                assignedTo: selectedStudentIds, 
                                questions: cleanExamPool,
                                timerMinutes: timerInput,
                                isCompletedBy: [],
                                createdAt: serverTimestamp()
                            });
                            
                            alert(`Exam successfully assigned to ${selectedStudentIds.length} student(s)!`);
                            document.body.removeChild(modalOverlay);
                        } catch (error) {
                            console.error("Error assigning exam: ", error);
                            // 🚨 Show the EXACT error on the screen so we don't have to guess!
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
}, 1500);


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

popupClose.onclick = () => { popupHistory = []; popupOverlay.style.display = 'none'; activeCustomPool = null; };
popupOverlay.onclick = (e) => { if (e.target === popupOverlay) { popupHistory = []; popupOverlay.style.display = 'none'; activeCustomPool = null; } }

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
    activeCustomPool = null;
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

// ==========================================
// 5. QUESTION DISTRIBUTION ALGORITHM
// ==========================================
function applyTierLimits(rawQuestions, limitPerSubject) {
    let filteredList = [];
    const questionsBySubject = {};

    // Step 1: Group everything by Subject -> Topic
    rawQuestions.forEach(q => {
        const sub = q.Subject || "Uncategorized";
        const top = q.Topic || "General";
        if (!questionsBySubject[sub]) questionsBySubject[sub] = {};
        if (!questionsBySubject[sub][top]) questionsBySubject[sub][top] = [];
        questionsBySubject[sub][top].push(q);
    });

    // Step 2: Extract exactly the limit per subject, distributed evenly among topics
    Object.keys(questionsBySubject).forEach(sub => {
        const topics = Object.keys(questionsBySubject[sub]);
        const numTopics = topics.length;

        const baseQuota = Math.floor(limitPerSubject / numTopics);
        let remainder = limitPerSubject % numTopics;

        topics.forEach(top => {
            const quota = baseQuota + (remainder > 0 ? 1 : 0);
            if (remainder > 0) remainder--;

            // Grab the allowed number of questions from this topic
            filteredList.push(...questionsBySubject[sub][top].slice(0, quota));
        });
    });

    return filteredList;
}

// ==========================================
// 6. CSV LOADER & TREE BUILDER
// ==========================================
async function loadDataAndBuildTree() {
    try {
        const activeCourse = localStorage.getItem('edeetos_active_course') || 'fcps_part1';
        const csvPath = `Data/${activeCourse}.csv`;

        const response = await fetch(csvPath, { cache: 'no-cache' });
        if (!response.ok) throw new Error("CSV file not found: " + csvPath);
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

        let masterQuestions = [];

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

            masterQuestions.push(rowObj);
        });

        // APPLY THE PROPER FILTER BASED ON USER TIER
        if (localStorage.getItem('edeetos_guest_mode') === 'true') {
            allQuestions = applyTierLimits(masterQuestions, 20); // Guests: 20 per subject
        } else if (!isPremiumUser) {
            allQuestions = applyTierLimits(masterQuestions, 50); // Free Users: 50 per subject
        } else {
            allQuestions = [...masterQuestions]; // Premium: All questions
        }

        // Now build the trees based on the final filtered list
        subjectTree = {}; systemTree = {}; examTree = {};

        allQuestions.forEach(rowObj => {
            const Exam = rowObj.Exam;
            const Subject = rowObj.Subject;
            const Chapter = rowObj.Chapter;
            const Topic = rowObj.Topic;

            if (!subjectTree[Subject]) subjectTree[Subject] = {};
            if (!subjectTree[Subject][Chapter]) subjectTree[Subject][Chapter] = [];
            if (Topic && !subjectTree[Subject][Chapter].includes(Topic)) subjectTree[Subject][Chapter].push(Topic);

            if (Chapter && Chapter.toLowerCase().includes('system')) {
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
            if (Chapter && Chapter.toLowerCase().includes('system')) {
                if (!tree[Chapter]) tree[Chapter] = {};
                if (!tree[Chapter][Subject]) tree[Chapter][Subject] = [];
                if (Topic && !tree[Chapter][Subject].includes(Topic)) tree[Chapter][Subject].push(Topic);
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
// 7. THE BRIDGE: LAUNCH QUIZ (MULTIPLAYER UPGRADED)
// ==========================================
window.launchQuiz = async function (questionsArray, mode = 'practice', timerMinutes = 0, examName = "Practice Session") {
    if (!questionsArray || questionsArray.length === 0) {
        alert("No questions found for this selection!");
        return;
    }

    const roomId = localStorage.getItem('active_study_room');
    const isGuest = localStorage.getItem('is_study_guest') === 'true';

    // 🚀 IF HOSTING A GROUP STUDY ROOM: Upload to Firebase instead of playing solo
    if (roomId && !isGuest) {
        try {
            document.body.style.cursor = 'wait'; // Show loading cursor
            
            // Clean the data to prevent Firebase from crashing on undefined values
            const cleanPool = JSON.parse(JSON.stringify(questionsArray));

            // Push the payload to the active room
            await updateDoc(doc(db, "study_rooms", roomId), {
                questions: cleanPool,
                quizConfig: { mode, timer: timerMinutes, examName },
                status: 'playing', // Signals to the waiting guests that the game has started!
                currentQuestionIndex: 0,
                memberAnswers: {} // We will use this in Phase 2 to track who picked what
            });

            // Save locally for the host as well
            localStorage.setItem('edeetos_active_quiz', JSON.stringify(cleanPool));
            localStorage.setItem('edeetos_quiz_config', JSON.stringify({ mode: mode, timer: timerMinutes, examName: examName }));

            document.body.style.cursor = 'default';
            window.location.href = 'quiz.html';
            return;
        } catch (error) {
            console.error("Failed to sync room:", error);
            alert("Error syncing questions to the study room. Check your internet connection.");
            document.body.style.cursor = 'default';
            return;
        }
    }

    // 👤 NORMAL SOLO MODE (If they are not in a group)
    localStorage.setItem('edeetos_active_quiz', JSON.stringify(questionsArray));
    localStorage.setItem('edeetos_quiz_config', JSON.stringify({ mode: mode, timer: timerMinutes, examName: examName }));
    window.location.href = 'quiz.html';
};

// ==========================================
// 8. FIREBASE PROGRESS & DATA INITIALIZATION
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        localStorage.removeItem('edeetos_guest_mode');
        const userRef = doc(db, "users", user.uid);
        try {
            const docSnap = await getDoc(userRef);
            if (docSnap.exists()) {
                const dbData = docSnap.data();
				currentUserRole = dbData.role || 'STUDENT';
// 1. Get the active course first
                const activeCourse = localStorage.getItem('edeetos_active_course') || 'fcps_part1';
                const courseData = dbData[activeCourse] || {};

                // 2. COURSE-SPECIFIC PREMIUM CHECK
                isPremiumUser = false; // Default to free tier
                
                // Admins always get premium access
                if (dbData.role === 'ADMIN' || dbData.role === 'MANAGEMENT') {
                    isPremiumUser = true;
                } 
                // Check if they own THIS specific course
                else if (dbData.subscriptions && dbData.subscriptions[activeCourse]) {
                    const expiry = dbData.subscriptions[activeCourse];
                    if (expiry === 'lifetime') {
                        isPremiumUser = true;
                    } else {
                        // Check if it has expired
                        const expiryDate = new Date(expiry);
                        if (expiryDate >= new Date()) {
                            isPremiumUser = true;
                        }
                    }
                }
				
                const solvedList = (courseData.solvedQuestions || []).map(id => String(id));
                globalPracticeMistakes = (courseData.mistakes || []).map(id => String(id));
                globalExamMistakes = (courseData.examMistakes || []).map(id => String(id));
                globalBookmarks = (courseData.bookmarks || []).map(id => String(id));

                userExamHistory = courseData.examHistory || [];
                attemptedQuestions = solvedList;

                // 3. Now that we know their status, load and filter the CSV!
                await loadDataAndBuildTree();

                // 4. Update the UI Dashboards
                const allMistakes = [...new Set([...globalPracticeMistakes, ...globalExamMistakes])];
                const totalAttempts = solvedList.length + allMistakes.length;
                let accuracy = totalAttempts > 0 ? Math.round((solvedList.length / totalAttempts) * 100) : 0;

                if (document.getElementById('stat-solved')) document.getElementById('stat-solved').textContent = solvedList.length;
                if (document.getElementById('stat-mistakes')) document.getElementById('stat-mistakes').textContent = allMistakes.length;
                if (document.getElementById('stat-bookmarks')) document.getElementById('stat-bookmarks').textContent = globalBookmarks.length;
                if (document.getElementById('stat-accuracy')) document.getElementById('stat-accuracy').textContent = `${accuracy}%`;

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

// Analytics Modal
const btnAnalytics = document.getElementById('btn-view-analytics');
if (btnAnalytics) {
    btnAnalytics.onclick = () => {
        if (localStorage.getItem('edeetos_guest_mode') === 'true') {
            return alert("Please register an account to view detailed Analytics.");
        }
        const body = document.getElementById('analytics-body');

        let activeTree = {};
        let statTitle = "";
        let itemLabel = "";

        if (currentView === 'subject') {
            activeTree = subjectTree;
            statTitle = "Subject Stats";
            itemLabel = "subjects";
        } else if (currentView === 'system') {
            activeTree = systemTree;
            statTitle = "System Stats";
            itemLabel = "systems";
        } else if (currentView === 'exam') {
            activeTree = examTree;
            statTitle = "Past Paper Stats";
            itemLabel = "past papers";
        }

        let html = `<h4 style="color:#064e3b; border-bottom:2px solid #e2e8f0; padding-bottom:5px;">${statTitle}</h4>`;

        let itemAdded = false;

        Object.keys(activeTree).forEach(key => {
            const total = getQuestionCount(currentView, [key], allQuestions);
            const solved = getSolvedCount(currentView, [key]);

            const allMistakes = [...new Set([...globalPracticeMistakes, ...globalExamMistakes])];
            const mistakesInSection = getQuestionCount(currentView, [key], allQuestions.filter(q => allMistakes.includes(getQID(q))));

            if (solved === 0 && mistakesInSection === 0) return;

            itemAdded = true;

            const pct = Math.round((solved / total) * 100);
            html += `<div style="margin: 10px 0;">
                        <div style="display:flex; justify-content:space-between; font-size:0.85rem;">
                            <span>${key}</span><span>${pct}% (${solved}/${total})</span>
                        </div>
                        <div style="background:#e2e8f0; height:6px; border-radius:3px; overflow:hidden; margin-top:4px;">
                            <div style="width:${pct}%; background:#10b981; height:100%;"></div>
                        </div>
                     </div>`;
        });

        if (!itemAdded) {
            html += `<p style="font-size:0.8rem; color:#64748b; text-align:center; padding: 1rem 0;">No ${itemLabel} attempted yet.</p>`;
        }

        html += `<h4 style="color:#064e3b; border-bottom:2px solid #e2e8f0; padding-bottom:5px; margin-top:20px;">Recent Exams</h4>`;
        if (userExamHistory.length === 0) {
            html += `<p style="font-size:0.8rem; color:#64748b; text-align:center;">No exams taken yet.</p>`;
        } else {
            html += `<div style="font-size:0.8rem; max-height:200px; overflow-y:auto;">
                        <table style="width:100%; text-align:left;">
                            <tr style="color:#64748b;"><th>Date</th><th>Exam</th><th>Score</th></tr>`;
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

// ==========================================
// 9. CUSTOM RESET PROGRESS UI
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
        // FIX 1: Safely get the type even if they click the icon inside the button
        const type = btn.getAttribute('data-type'); 
        const activeCourse = localStorage.getItem('edeetos_active_course') || 'fcps_part1';

        switch (type) {
            case "1":
                pendingUpdates = {
                    [`${activeCourse}.solvedQuestions`]: [],
                    [`${activeCourse}.mistakes`]: [],
                    [`${activeCourse}.examMistakes`]: [],
                    [`${activeCourse}.bookmarks`]: [],
                    [`${activeCourse}.examHistory`]: []
                };
                pendingResetMsg = "All progress has been fully reset!";
                confirmText.textContent = "Are you sure you want to completely wipe ALL your progress for this course? This cannot be undone.";
                break;
            case "2":
                pendingUpdates = { [`${activeCourse}.mistakes`]: [], [`${activeCourse}.examMistakes`]: [] };
                pendingResetMsg = "All mistakes have been cleared!";
                confirmText.textContent = "Are you sure you want to clear your Mistake history?";
                break;
            case "3":
                pendingUpdates = { [`${activeCourse}.bookmarks`]: [] };
                pendingResetMsg = "All bookmarks have been cleared!";
                confirmText.textContent = "Are you sure you want to delete all your Bookmarks?";
                break;
            case "4":
                pendingUpdates = { [`${activeCourse}.examHistory`]: [] };
                pendingResetMsg = "Exam history has been cleared!";
                confirmText.textContent = "Are you sure you want to delete your Past Exam scores?";
                break;
            case "5":
                pendingUpdates = { [`${activeCourse}.solvedQuestions`]: [] };
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
            
            // FIX 2: Use updateDoc so it actually updates the nested database folders!
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
// 10. TROPHY / JOURNEY SYSTEM
// ==========================================
const btnJourney = document.getElementById('btn-view-journey');
const journeyModal = document.getElementById('journey-modal');
const closeJourneyBtn = document.getElementById('close-journey-btn');
const trophiesGrid = document.getElementById('trophies-grid');

const trophies = [
    { title: "Novice", req: 10, icon: "👶" },
    { title: "Bronze", req: 100, icon: "🥉" },
    { title: "Silver", req: 500, icon: "🥈" },
    { title: "Gold", req: 1000, icon: "🥇" },
    { title: "Diamond", req: 2000, icon: "💎" },
    { title: "Master", req: 5000, icon: "👑" }
];

if (btnJourney) {
    btnJourney.onclick = () => {
        if (localStorage.getItem('edeetos_guest_mode') === 'true') {
            return alert("Please register an account to track your Journey and unlock trophies.");
        }
        const solvedCount = attemptedQuestions.length;

        trophiesGrid.innerHTML = trophies.map(t => {
            const isUnlocked = solvedCount >= t.req;
            const borderColor = isUnlocked ? '#fbbf24' : '#e2e8f0';
            const bgColor = isUnlocked ? 'rgba(255, 255, 255, 0.9)' : 'rgba(248, 250, 252, 0.6)';
            const iconStyle = isUnlocked ? '' : 'filter: grayscale(100%) opacity(0.4);';
            const textColor = isUnlocked ? '#1e3a8a' : '#94a3b8';
            const statusIcon = isUnlocked ? '<i class="fas fa-check-circle" style="color: #10b981;"></i>' : '<i class="fas fa-lock" style="color: #cbd5e1;"></i>';

            return `
                <div class="glass-panel" style="display: flex; align-items: center; padding: 0.9rem; border-radius: 12px; background: ${bgColor}; border: 2px solid ${borderColor}; box-shadow: ${isUnlocked ? '0 4px 12px rgba(0,0,0,0.05)' : 'none'};">
                    <div style="font-size: 2.2rem; margin-right: 1rem; ${iconStyle}">${t.icon}</div>
                    <div style="flex-grow: 1;">
                        <div style="font-weight: 800; color: ${textColor}; font-size: 1.05rem; margin-bottom: 0.1rem;">${t.title}</div>
                        <div style="font-size: 0.75rem; color: #64748b;">Solve ${t.req} Questions</div>
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

switchMode('practice');