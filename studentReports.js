import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ==========================================
// STUDENT REPORTS LOGIC
// ==========================================
const studentListContainer = document.getElementById('student-list');
const searchInput = document.getElementById('search-students');
const detailsPanel = document.getElementById('report-details');

let studentsData = [];
let currentUserRole = 'STUDENT';
let chartInstance = null; // Track chart to destroy on re-render

const activeCourse = localStorage.getItem('edeetos_active_course');
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
// TIME FORMATTING HELPER
// ==========================================
function formatTime(totalSeconds) {
    if (!totalSeconds || isNaN(totalSeconds)) return '0s';
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

// 1. Security Check & Routing
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const userRef = doc(db, "users", user.uid);
            let cachedData = await idbCache.get(user.uid);
            let userData = null;

            if (cachedData) {
                userData = { id: user.uid, ...cachedData };
                processUserRole(userData); 
            }

            const docSnap = await getDoc(userRef);
            if (docSnap.exists()) {
                const freshData = docSnap.data();
                idbCache.set(user.uid, freshData);
                
                if (!cachedData) {
                    userData = { id: docSnap.id, ...freshData };
                    processUserRole(userData);
                }
            }
        } catch (error) {
            console.error("Auth check failed:", error);
        }
    } else {
        window.location.href = 'index.html'; 
    }
});

function processUserRole(userData) {
    const role = (userData.role || 'STUDENT').toUpperCase();
    currentUserRole = role;
    
    if (role === 'BANNED') { window.location.href = 'dashboard.html'; return; }

    if (role === 'STUDENT') {
        if (searchInput) searchInput.parentElement.style.display = 'none';
        if (studentListContainer) studentListContainer.parentElement.style.display = 'none';
        if (detailsPanel) { detailsPanel.style.width = '100%'; detailsPanel.style.maxWidth = '100%'; detailsPanel.style.flex = '1'; }
        displayDetailedReport(userData);
    } else {
        fetchStudents(userData);
    }
}

// 2. Fetch all standard students & Include the logged-in Mentor
async function fetchStudents(currentUserData) {
    try {
        studentsData = [];
        
        if (currentUserData) {
            studentsData.push({ ...currentUserData, fullName: (currentUserData.fullName || "My Account") + " (Me)" });
        }

        const usersRef = collection(db, "users");
        const userSnap = await getDocs(usersRef);
        
        userSnap.forEach(docSnap => {
            const data = docSnap.data();
            const role = (data.role || 'STUDENT').toUpperCase();
            
            if (role !== 'ADMIN' && role !== 'MENTOR' && role !== 'MANAGEMENT' && role !== 'BANNED') {
                if (docSnap.id !== currentUserData.id) {
                    studentsData.push({ id: docSnap.id, ...data });
                }
            }
        });

        studentsData.sort((a, b) => {
            if (a.id === currentUserData.id) return -1;
            if (b.id === currentUserData.id) return 1;
            return (a.fullName || "A").localeCompare(b.fullName || "A");
        });
        
        renderStudentList(studentsData);

    } catch (error) {
        studentListContainer.innerHTML = `<div class="empty-state"><p class="text-danger tech-font font-bold">Failed to load data.</p></div>`;
    }
}

// 3. Render the sidebar list
function renderStudentList(list) {
    studentListContainer.innerHTML = '';

    if (list.length === 0) {
        studentListContainer.innerHTML = `<div class="empty-state"><p class="tech-font font-bold">No users found.</p></div>`;
        return;
    }

    list.forEach(student => {
        const item = document.createElement('div');
        item.className = 'student-item';
        
        const isMe = student.fullName.includes("(Me)");
        if (isMe) {
            item.style.borderLeft = "4px solid var(--primary)";
            item.style.background = "var(--bg)";
        }
        
        item.innerHTML = `
            <div class="student-name">${student.fullName || "Unnamed User"}</div>
            <div class="student-email">${student.email || "No Email"}</div>
        `;

        item.addEventListener('click', () => {
            document.querySelectorAll('.student-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            displayDetailedReport(student);
        });

        studentListContainer.appendChild(item);
    });
}

if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = studentsData.filter(s => 
            (s.fullName && s.fullName.toLowerCase().includes(term)) || 
            (s.email && s.email.toLowerCase().includes(term))
        );
        renderStudentList(filtered);
    });
}

// ==========================================
// 4. DATA WAREHOUSE (LAZY LOAD)
// ==========================================
const standardCourses = [
    'fcps_part1', 'fcps_part2', 'fcps_imm', 'mrcs_part1', 'mrcs_part2', 
    'mbbs_year1', 'mbbs_year2', 'mbbs_year3', 'mbbs_year4', 'mbbs_year5'
];
const referenceBooks = [
    'firstaid_step1', 'firstaid_step2', 'rafiullah', 'im_medicine', 'im_surgery', 
    'im_pathology', 'im_pediatrics', 'brs_patho', 'brs_physio', 'doubleAA', 'RWR', 'pretest_surgery'
];
const titles = {
    'fcps_part1': 'FCPS Part 1', 'fcps_part2': 'FCPS Part 2', 'fcps_imm': 'FCPS IMM',
    'mrcs_part1': 'MRCS Part 1', 'mrcs_part2': 'MRCS Part 2',
    'mbbs_year1': 'MBBS Year 1', 'mbbs_year2': 'MBBS Year 2', 'mbbs_year3': 'MBBS Year 3',
    'mbbs_year4': 'MBBS Year 4', 'mbbs_year5': 'MBBS Year 5',
    'firstaid_step1': 'First Aid Step 1', 'firstaid_step2': 'First Aid Step 2',
	'im_medicine': 'IM Medicine', 'im_surgery': 'IM Surgery', 'im_pathology': 'IM Pathology', 'im_pediatrics': 'IM Pediatrics',
	'brs_patho': 'BRS Pathology', 'brs_physio': 'BRS Physiology', 'rafiullah': 'Rafiullah', 'doubleAA': 'Double AA',
	'RWR': 'Residency', 'pretest_surgery': 'Pretest Surgery', 
};

let globalQuestionBank = {};

async function loadTargetedFileToBank(fileKey) {
    if (globalQuestionBank[fileKey]) return; 

    const isBook = referenceBooks.includes(fileKey);
    try {
        let questions = [];
        if (isBook) {
            const res = await fetch(`Books/${fileKey}_questions.json`);
            if (res.ok) questions = await res.json();
        } else {
            const hierarchyRes = await fetch(`Data/${fileKey}_hierarchy.json`);
            if (hierarchyRes.ok) {
                const hierarchyData = await hierarchyRes.json();
                const subjects = Object.keys(hierarchyData.subjects || {});
                const sanitizeFilename = (name) => {
                    if (!name) return "unknown";
                    return String(name).toLowerCase().trim().replace(/[\\/*?:"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
                };
                const promises = subjects.map(async (subj) => {
                    const subjClean = sanitizeFilename(subj);
                    try {
                        const res = await fetch(`Data/${fileKey}/metadata/${subjClean}.json`);
                        if (res.ok) return await res.json();
                    } catch (e) {}
                    return [];
                });
                const results = await Promise.all(promises);
                questions = results.flat();
            }
        }

        if (!globalQuestionBank[fileKey]) globalQuestionBank[fileKey] = {};

        questions.forEach((q, index) => {
            let fallbackPrefix = isBook ? `${fileKey}-` : '';
            let qId = String(q.id || q.QuestionID || q['Question ID'] || q.ID || `${fallbackPrefix}q-${index + 1}`);

            globalQuestionBank[fileKey][qId] = {
                Subject: isBook ? (titles[fileKey] || q.Subject || q.subject) : (q.subject || q.Subject || 'Unknown'),
                Chapter: q.chapter || q.Chapter || 'Unknown',
                Topic: q.topic || q.Topic || 'Unknown'
            };
        });
    } catch(e) {}
}

async function loadRequiredBanks(activeCourseFilter) {
    if (activeCourseFilter === 'all') {
        const allFiles = [...standardCourses, ...referenceBooks];
        await Promise.all(allFiles.map(file => loadTargetedFileToBank(file)));
    } else {
        await loadTargetedFileToBank(activeCourseFilter);
    }
}

// ==========================================
// 5. THE 100% REDESIGNED REPORT GENERATOR
// ==========================================
async function displayDetailedReport(student, activeCourseFilter = 'all') {

    if (!student) {
        detailsPanel.innerHTML = `<div class="empty-state"><h3 class="tech-font">No User Selected</h3></div>`;
        return;
    }

    // Show loading state
    detailsPanel.innerHTML = `
        <div class="empty-state">
            <h3 class="tech-font text-primary">Loading Data...</h3>
        </div>
    `;

    // 1. Ensure databases are loaded
	await loadRequiredBanks(activeCourseFilter);

    // 2. Fetch Sharded Progress Data
    const uid = student.id;
    const fetchShard = async (folder, docName) => {
        try { 
            const snap = await getDoc(doc(db, "users", uid, folder, docName)); 
            return snap.exists() ? snap.data() : {}; 
        } catch(e) { return {}; }
    };

    const userProgress = {};
    const fetchTasks = [];
    
    [...standardCourses, 'books'].forEach(c => {
        userProgress[c] = { solved: [], mistakes: [], examMistakes: [], examHistory: [], practiceTimeSpent: 0 };
        fetchTasks.push(
            fetchShard(c, "solved").then(d => { userProgress[c].solved = d.list || []; }),
            fetchShard(c, "mistakes").then(d => { 
                userProgress[c].mistakes = d.practice || []; 
                userProgress[c].examMistakes = d.exam || [];
            }),
            fetchShard(c, "history").then(d => { userProgress[c].examHistory = d.list || []; })
        );
        if (student[c] && student[c].practiceTimeSpent) {
            userProgress[c].practiceTimeSpent = student[c].practiceTimeSpent;
        }
    });
    
    await Promise.all(fetchTasks);

    // 3. Build UI Selection
    let filterOptions = `<option value="all">All Courses & Books</option>`;
    if (currentUserRole === 'ADMIN' || currentUserRole === 'MENTOR' || currentUserRole === 'MANAGEMENT') {
        filterOptions += `<optgroup label="Courses">`;
        standardCourses.forEach(course => filterOptions += `<option value="${course}" ${activeCourseFilter === course ? 'selected' : ''}>${titles[course]}</option>`);
        filterOptions += `</optgroup><optgroup label="Books">`;
        referenceBooks.forEach(book => filterOptions += `<option value="${book}" ${activeCourseFilter === book ? 'selected' : ''}>${titles[book]}</option>`);
        filterOptions += `</optgroup>`;
    } else {
        filterOptions += `<optgroup label="Your Course">`;
        if (activeCourse && standardCourses.includes(activeCourse)) {
            filterOptions += `<option value="${activeCourse}" ${activeCourseFilter === activeCourse ? 'selected' : ''}>${titles[activeCourse]}</option>`;
        }
        filterOptions += `</optgroup><optgroup label="Books">`;
        referenceBooks.forEach(book => filterOptions += `<option value="${book}" ${activeCourseFilter === book ? 'selected' : ''}>${titles[book]}</option>`);
        filterOptions += `</optgroup>`;
    }

    let examHistory = [];
    let rawSolved = [];
    let rawMistakes = [];
    let totalPracticeTime = 0;
    let totalExamTime = 0; 
    let totalExamQuestions = 0;

    [...standardCourses, 'books'].forEach(c => {
        const prog = userProgress[c];
        [...new Set(prog.solved || [])].forEach(id => rawSolved.push({id: String(id), bucket: c}));
        const mistakes = [...new Set([...(prog.mistakes || []), ...(prog.examMistakes || [])])];
        mistakes.forEach(id => rawMistakes.push({id: String(id), bucket: c}));
        
        if (prog.practiceTimeSpent) totalPracticeTime += prog.practiceTimeSpent;
        if (prog.examHistory) {
            prog.examHistory.forEach(exam => {
                examHistory.push(exam);
                if (exam.timeSpent) totalExamTime += exam.timeSpent;
                if (exam.totalQuestions) totalExamQuestions += exam.totalQuestions;
            });
        }
    });

    const processedTopics = {};

    function processId(id, isMistake, bucket) {
        let meta = null;
        let isBook = false;
        let sourceKey = bucket;

        if (bucket === 'books') {
            for (const book of referenceBooks) {
                if (globalQuestionBank[book] && globalQuestionBank[book][id]) {
                    meta = globalQuestionBank[book][id];
                    isBook = true;
                    sourceKey = book;
                    break;
                }
            }
        } else {
            if (globalQuestionBank[bucket] && globalQuestionBank[bucket][id]) {
                meta = globalQuestionBank[bucket][id];
                isBook = false;
                sourceKey = bucket;
            }
        }

        const sourceName = titles[sourceKey] || sourceKey || 'Unknown Source';
        const subject = meta ? meta.Subject : 'Unknown Subject';
        const chapter = meta ? meta.Chapter : 'Unknown System/Chapter';
        const topic = meta ? meta.Topic : 'Pending Topic (Will be added)';
        const key = `${subject}::${chapter}::${topic}::${sourceKey}`;

        if (!processedTopics[key]) {
            processedTopics[key] = { subject, chapter, topic, isBook, sourceName, sourceKey, solved: 0, mistakes: 0 };
        }

        if (isMistake) processedTopics[key].mistakes++;
        else processedTopics[key].solved++;
    }

    rawSolved.forEach(item => processId(item.id, false, item.bucket));
    rawMistakes.forEach(item => processId(item.id, true, item.bucket));

    let absoluteSolved = 0;
    let absoluteMistakes = 0;
    const subjectStats = {};
    const chapterStats = {};
    const topicStats = {};
    const sourceStats = {};
    let topicHtml = '';

    Object.values(processedTopics).forEach(data => {
        const { subject, chapter, topic, isBook, sourceName, sourceKey, solved, mistakes } = data;
        const attempts = solved + mistakes;
        const accuracy = attempts > 0 ? Math.round((solved / attempts) * 100) : 0;

        let shouldInclude = false;
        if (activeCourseFilter === 'all') { shouldInclude = true; } 
        else if (referenceBooks.includes(activeCourseFilter)) { if (isBook && sourceKey === activeCourseFilter) shouldInclude = true; } 
        else if (standardCourses.includes(activeCourseFilter)) { if (!isBook && sourceKey === activeCourseFilter) shouldInclude = true; }
        if (!shouldInclude) return;

        absoluteSolved += solved;
        absoluteMistakes += mistakes;

        if (!subjectStats[subject]) subjectStats[subject] = { solved: 0, mistakes: 0 };
        subjectStats[subject].solved += solved;
        subjectStats[subject].mistakes += mistakes;

        if (!chapterStats[chapter]) chapterStats[chapter] = { solved: 0, mistakes: 0 };
        chapterStats[chapter].solved += solved;
        chapterStats[chapter].mistakes += mistakes;

        topicStats[topic] = { accuracy, solved, mistakes, sourceName };

        if (!sourceStats[sourceName]) sourceStats[sourceName] = { solved: 0, mistakes: 0 };
        sourceStats[sourceName].solved += solved;
        sourceStats[sourceName].mistakes += mistakes;

        const accClass = accuracy >= 75 ? 'text-green' : accuracy >= 50 ? 'text-yellow' : 'text-red';

        topicHtml += `
            <div class="topic-row">
                <div class="topic-hierarchy">
                    <div class="subject-name">${subject}</div>
                    <div class="chapter-name">${chapter}</div>
                    <div class="topic-name">${topic}</div>
                    <div class="topic-source">${sourceName}</div>
                </div>
                <div class="topic-stats">
                    <div><span class="tech-font">Acc</span> <strong class="${accClass}" style="font-size:1rem;">${accuracy}%</strong></div>
                    <div><span class="tech-font">Solved</span> <strong style="font-size:1rem;">${solved}</strong></div>
                    <div><span class="tech-font">Mistakes</span> <strong class="text-red" style="font-size:1rem;">${mistakes}</strong></div>
                </div>
            </div>
        `;
    });

    const absoluteAttempts = absoluteSolved + absoluteMistakes;
    const overallAccuracy = absoluteAttempts > 0 ? Math.round((absoluteSolved / absoluteAttempts) * 100) : 0;
    const combinedTime = formatTime(totalPracticeTime + totalExamTime);

    // Deep Analysis
    let weakestTopic = 'N/A';
    let weakestAccuracy = 100;
    let strongestTopic = 'N/A';
    let strongestAccuracy = -1;
    let reviewNeededCount = 0;

    Object.entries(topicStats).forEach(([topic, stats]) => {
        if (stats.solved + stats.mistakes >= 5) { // Only count if they actually practiced it
            if (stats.accuracy < weakestAccuracy) { weakestAccuracy = stats.accuracy; weakestTopic = topic; }
            if (stats.accuracy > strongestAccuracy) { strongestAccuracy = stats.accuracy; strongestTopic = topic; }
            if (stats.accuracy < 60) { reviewNeededCount++; }
        }
    });
    
    // Sort Exams for Chart and Table
    examHistory.sort((a, b) => new Date(a.date) - new Date(b.date)); // Ascending for Chart
    const chartLabels = examHistory.slice(-10).map(e => new Date(e.date).toLocaleDateString(undefined, {month: 'short', day: 'numeric'}));
    const chartScores = examHistory.slice(-10).map(e => e.percentage || 0);

    const reversedHistory = [...examHistory].reverse(); // Descending for Table
    let historyHtml = reversedHistory.length === 0 ? `<p class="empty-data-text">No Exam History</p>` : `
        <div class="overflow-x">
            <table class="history-table">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Exam</th>
                        <th>Score</th>
                        <th>Questions</th>
                        <th>Time Spent</th>
                    </tr>
                </thead>
                <tbody>
                    ${reversedHistory.slice(0, 10).map(exam => `
                        <tr>
                            <td class="tech-font">${new Date(exam.date).toLocaleDateString()}</td>
                            <td>${exam.examName || 'Practice Exam'}</td>
                            <td class="tech-font font-bold ${exam.percentage >= 75 ? 'text-green' : (exam.percentage >= 50 ? 'text-yellow' : 'text-red')}">${exam.percentage || 0}%</td>
                            <td class="tech-font">${exam.totalQuestions || 0}</td>
                            <td class="tech-font">${formatTime(exam.timeSpent)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>`;

    // 4. Inject Strict Bento Layout
    detailsPanel.innerHTML = `
        <div class="details-header">
            <div>
                <h1>${student.fullName || 'User'}</h1>
                <div class="details-meta">${student.email || ''}</div>
            </div>
            <div>
                <select id="course-filter">
                    ${filterOptions}
                </select>
            </div>
        </div>

        <div class="stats-grid">
            <div class="stat-card blue">
                <div class="stat-title">Total Solved</div>
                <div class="stat-value">${absoluteSolved}</div>
            </div>
            <div class="stat-card green">
                <div class="stat-title">True Accuracy</div>
                <div class="stat-value">${overallAccuracy}%</div>
            </div>
            <div class="stat-card red">
                <div class="stat-title">Absolute Mistakes</div>
                <div class="stat-value">${absoluteMistakes}</div>
            </div>
            <div class="stat-card yellow">
                <div class="stat-title">Total Time Studied</div>
                <div class="stat-value" style="font-size:1.5rem;">${combinedTime}</div>
            </div>
        </div>

        <div class="bento-grid-2-col">
            <div class="bento-card" style="margin-bottom: 0;">
                <h3>Performance Graph</h3>
                ${chartLabels.length > 0 ? 
                    `<div class="chart-container"><canvas id="progressChart"></canvas></div>` : 
                    `<p class="empty-data-text">Take exams to generate growth chart.</p>`
                }
            </div>
            
            <div class="bento-card" style="margin-bottom: 0; display:flex; flex-direction:column; justify-content:space-between;">
                <h3 style="margin-bottom: 0.5rem;">Actionable Insights</h3>
                <div style="flex-grow: 1;">
                    <div class="insight-row">
                        <span>Top Strength</span>
                        <strong class="text-green">${strongestTopic === 'N/A' ? 'Not enough data' : strongestTopic}</strong>
                    </div>
                    <div class="insight-row">
                        <span>Critical Weakness</span>
                        <strong class="text-red">${weakestTopic === 'N/A' ? 'Not enough data' : weakestTopic}</strong>
                    </div>
                    <div class="insight-row">
                        <span>Topics Needing Review</span>
                        <strong class="text-yellow">${reviewNeededCount}</strong>
                    </div>
                    <div class="insight-row" style="border-bottom: none;">
                        <span>Total Exams Taken</span>
                        <strong class="text-blue">${examHistory.length}</strong>
                    </div>
                </div>
            </div>
        </div>

        <div class="bento-card">
            <h3>Recent Exam History</h3>
            ${historyHtml}
        </div>

        <div class="bento-card">
            <h3>Detailed Topic Mastery</h3>
            ${topicHtml || '<p class="empty-data-text">No topic data available for this selection.</p>'}
        </div>
    `;

    // 5. Initialize Chart.js safely after injection
    setTimeout(() => {
        const ctx = document.getElementById('progressChart');
        if (ctx && chartLabels.length > 0) {
            if (chartInstance) chartInstance.destroy();
            
            const isDark = document.documentElement.classList.contains('dark-mode');
            const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
            const textColor = isDark ? '#888888' : '#555555';

            chartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: chartLabels,
                    datasets: [{
                        label: 'Exam Score (%)',
                        data: chartScores,
                        borderColor: '#1546D9',
                        backgroundColor: 'rgba(21, 70, 217, 0.1)',
                        borderWidth: 2,
                        tension: 0.1,
                        fill: true,
                        pointBackgroundColor: '#1546D9',
                        pointRadius: 4,
                        pointHoverRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: isDark ? '#0A0C10' : '#FFFFFF',
                            titleColor: isDark ? '#E2E2E2' : '#030407',
                            bodyColor: isDark ? '#E2E2E2' : '#030407',
                            borderColor: isDark ? 'rgba(226, 226, 226, 0.15)' : 'rgba(3, 4, 7, 0.15)',
                            borderWidth: 1,
                            padding: 10,
                            displayColors: false
                        }
                    },
                    scales: {
                        y: { 
                            beginAtZero: true, 
                            max: 100, 
                            grid: { color: gridColor },
                            ticks: { color: textColor, font: { family: 'Courier New' } }
                        },
                        x: { 
                            grid: { display: false },
                            ticks: { color: textColor, font: { family: 'Courier New' } }
                        }
                    }
                }
            });
        }
    }, 100);

    document.getElementById('course-filter').addEventListener('change', (e) => {
        displayDetailedReport(student, e.target.value);
    });

    // Re-attach Mouse Tracking
    document.querySelectorAll('.bento-card, .stat-card').forEach(card => {
        card.addEventListener('mousemove', e => {
            const rect = card.getBoundingClientRect();
            card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
            card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
        });
    });
}