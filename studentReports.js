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
            const docSnap = await getDoc(userRef);
            
            if (docSnap.exists()) {
                const userData = { id: docSnap.id, ...docSnap.data() };
                const role = (userData.role || 'STUDENT').toUpperCase();
                
                if (role === 'BANNED') {
                    window.location.href = 'dashboard.html';
                    return;
                }

                if (role === 'STUDENT') {
                    // Hide the left sidebar (search and student list)
                    if (searchInput) searchInput.parentElement.style.display = 'none';
                    if (studentListContainer) studentListContainer.parentElement.style.display = 'none';
                    
                    // Expand the details panel to full width
                    if (detailsPanel) {
                        detailsPanel.style.width = '100%';
                        detailsPanel.style.maxWidth = '100%';
                        detailsPanel.style.flex = '1';
                    }
                    
                    // Directly load the student's own data
                    displayDetailedReport(userData);
                } else {
                    // Admins and Mentors get the full list (and their own profile)
                    fetchStudents(userData);
                }
            }
        } catch (error) {
            console.error("Auth check failed:", error);
        }
    } else {
        window.location.href = 'index.html'; 
    }
});

// 2. Fetch all standard students & Include the logged-in Mentor
async function fetchStudents(currentUserData) {
    try {
        studentsData = [];
        
        // ADD CURRENT MENTOR/ADMIN FIRST
        if (currentUserData) {
            studentsData.push({
                ...currentUserData,
                fullName: (currentUserData.fullName || "My Account") + " (Me)"
            });
        }

        const usersRef = collection(db, "users");
        const userSnap = await getDocs(usersRef);
        
        userSnap.forEach(docSnap => {
            const data = docSnap.data();
            const role = (data.role || 'STUDENT').toUpperCase();
            
            // Only add actual students to the rest of the list
            if (role !== 'ADMIN' && role !== 'MENTOR' && role !== 'MANAGEMENT' && role !== 'BANNED') {
                // Prevent duplicating the current user if they somehow slip through
                if (docSnap.id !== currentUserData.id) {
                    studentsData.push({ id: docSnap.id, ...data });
                }
            }
        });

        // Sort alphabetically, but keep "(Me)" at the top
        studentsData.sort((a, b) => {
            if (a.id === currentUserData.id) return -1;
            if (b.id === currentUserData.id) return 1;
            return (a.fullName || "A").localeCompare(b.fullName || "A");
        });
        
        renderStudentList(studentsData);

    } catch (error) {
        console.error("Failed to load students:", error);
        studentListContainer.innerHTML = `<div class="empty-state"><p style="color: red;">Failed to load data. Check console.</p></div>`;
    }
}

// 3. Render the sidebar list
function renderStudentList(list) {
    studentListContainer.innerHTML = '';

    if (list.length === 0) {
        studentListContainer.innerHTML = `<div class="empty-state"><p>No students found.</p></div>`;
        return;
    }

    list.forEach(student => {
        const item = document.createElement('div');
        item.className = 'student-item';
        
        // Highlight the Mentor's own profile slightly differently
        const isMe = student.fullName.includes("(Me)");
        if (isMe) {
            item.style.borderLeft = "4px solid #8b5cf6";
            item.style.backgroundColor = "#f8fafc";
        }
        
        item.innerHTML = `
            <div class="student-name" style="${isMe ? 'color: #8b5cf6;' : ''}">${student.fullName || "Unnamed User"}</div>
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
// 4. THE DATA WAREHOUSE (CSV FETCHING)
// ==========================================
const standardCourses = [
    'fcps_part1', 'fcps_part2', 'fcps_imm', 'mrcs_part1', 'mrcs_part2', 
    'mbbs_year1', 'mbbs_year2', 'mbbs_year3', 'mbbs_year4', 'mbbs_year5'
];

const referenceBooks = [
    'firstaid_step1',
    'firstaid_step2',
    'rafiullah',
    'im_medicine',
    'im_surgery',
    'im_pathology',
    'im_pediatrics',
    'brs_patho',
    'brs_physio',
    'doubleAA',
    'RWR',
    'pretest_surgery'
];

const titles = {
    'fcps_part1': 'FCPS Part 1', 'fcps_part2': 'FCPS Part 2', 'fcps_imm': 'FCPS IMM',
    'mrcs_part1': 'MRCS Part 1', 'mrcs_part2': 'MRCS Part 2',
    'mbbs_year1': 'MBBS Year 1', 'mbbs_year2': 'MBBS Year 2', 'mbbs_year3': 'MBBS Year 3',
    'mbbs_year4': 'MBBS Year 4', 'mbbs_year5': 'MBBS Year 5',
    'firstaid_step1': 'First Aid Step 1', 'firstaid_step2': 'First Aid Step 2',
	'im_medicine': 'IM Medicine', 'im_surgery': 'IM Surgery', 'im_pathology': 'IM Pathology', 'im_pediatrics': 'IM Pediatrics',
	'brs_patho': 'BRS Pathology', 'brs_physio': 'BRS Physiology',
	'rafiullah': 'Rafiullah', 'doubleAA': 'Double AA',
	'RWR': 'Residents Way to Residency', 'pretest_surgery': 'Pretest Surgery', 
};

let globalQuestionBank = {};
let bankLoadPromise = null;

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

// Optimized lazy loader targeting only the relevant file asset
async function loadTargetedFileToBank(fileKey) {
    if (globalQuestionBank[fileKey]) return; // Already loaded

    const isBook = referenceBooks.includes(fileKey);
    const folder = isBook ? 'Books' : 'Data';

    try {
        const res = await fetch(`${folder}/${fileKey}.csv`);
        if (!res.ok) return;

        const text = (await res.text()).replace(/^\uFEFF/, '');
        const rows = parseCSV(text);
        const headers = rows[0].map(h => h ? h.trim() : "");

        if (!globalQuestionBank[fileKey]) globalQuestionBank[fileKey] = {};

        rows.slice(1).forEach((row, rowIndex) => {
            if (row.join('').replace(/,/g, '').trim() === '') return;

            let q = {};
            headers.forEach((h, i) => q[h] = row[i] ? row[i].trim() : "");

            let fallbackPrefix = isBook ? `${fileKey}-` : '';
            let qId = String(q.QuestionID || q['Question ID'] || q.ID || q.id || `${fallbackPrefix}q-${rowIndex + 1}`);

            globalQuestionBank[fileKey][qId] = {
                Subject: isBook ? (titles[fileKey] || q.Subject) : (q.Subject || 'Unknown Subject'),
                Chapter: q.Chapter || 'Unknown Chapter',
                Topic: q.Topic || 'Unknown Topic'
            };
        });
    } catch(e) {
        console.warn(`Could not lazy-load database map for ${fileKey}`, e);
    }
}

// Helper to load either everything or just the requested filter
async function loadRequiredBanks(activeCourseFilter) {
    if (activeCourseFilter === 'all') {
        const allFiles = [...standardCourses, ...referenceBooks];
        await Promise.all(allFiles.map(file => loadTargetedFileToBank(file)));
    } else {
        await loadTargetedFileToBank(activeCourseFilter);
    }
}

// ==========================================
// 5. COMPREHENSIVE STUDENT REPORT GENERATOR
// ==========================================
async function displayDetailedReport(student, activeCourseFilter = 'all') {

    if (!student) {
        detailsPanel.innerHTML = `<div class="empty-state"><h3>No Student Selected</h3></div>`;
        return;
    }

    // Show loading state while parsing CSVs
    detailsPanel.innerHTML = `
        <div class="empty-state" style="display:flex; flex-direction:column; align-items:center; gap:15px;">
            <i class="fas fa-spinner fa-spin" style="font-size: 3rem; color: #3b82f6;"></i>
            <h3 style="color: #1e293b;">Compiling Raw Data from CSVs...</h3>
            <p style="color: #64748b;">Mapping database IDs to original question files.</p>
        </div>
    `;

	// Ensure our targeted Data Warehouse is built
	await loadRequiredBanks(activeCourseFilter);

    let filterOptions = `<option value="all">All Courses & Books</option>`;
    filterOptions += `<optgroup label="Courses">`;
    standardCourses.forEach(course => filterOptions += `<option value="${course}" ${activeCourseFilter === course ? 'selected' : ''}>${titles[course]}</option>`);
    filterOptions += `</optgroup><optgroup label="Books">`;
    referenceBooks.forEach(book => filterOptions += `<option value="${book}" ${activeCourseFilter === book ? 'selected' : ''}>${titles[book]}</option>`);
    filterOptions += `</optgroup>`;

    let examHistory = [];
    let rawSolved = [];
    let rawMistakes = [];
    
    // Time Tracking Variables
    let totalPracticeTime = 0; // in seconds
    let totalExamTime = 0; // in seconds
    let totalExamQuestions = 0;

    // Dump all raw IDs with their buckets & track time
    standardCourses.forEach(c => {
        if (student[c]) {
            [...new Set(student[c].solvedQuestions || [])].forEach(id => rawSolved.push({id: String(id), bucket: c}));
            const mistakes = [...new Set([...(student[c].mistakes || []), ...(student[c].examMistakes || [])])];
            mistakes.forEach(id => rawMistakes.push({id: String(id), bucket: c}));
            
            // Collect practice time if it exists in DB
            if (student[c].practiceTimeSpent) {
                totalPracticeTime += student[c].practiceTimeSpent;
            }

            // Collect exam history and exam time
            if (student[c].examHistory) {
                student[c].examHistory.forEach(exam => {
                    examHistory.push(exam);
                    if (exam.timeSpent) totalExamTime += exam.timeSpent;
                    if (exam.totalQuestions) totalExamQuestions += exam.totalQuestions;
                });
            }
        }
    });

    if (student.books) {
        [...new Set(student.books.solvedQuestions || [])].forEach(id => rawSolved.push({id: String(id), bucket: 'books'}));
        const mistakes = [...new Set([...(student.books.mistakes || []), ...(student.books.examMistakes || [])])];
        mistakes.forEach(id => rawMistakes.push({id: String(id), bucket: 'books'}));
        
        if (student.books.practiceTimeSpent) {
            totalPracticeTime += student.books.practiceTimeSpent;
        }

        if (student.books.examHistory) {
            student.books.examHistory.forEach(exam => {
                examHistory.push(exam);
                if (exam.timeSpent) totalExamTime += exam.timeSpent;
                if (exam.totalQuestions) totalExamQuestions += exam.totalQuestions;
            });
        }
    }

    // Process all raw IDs into topics!
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
        const chapter = meta ? meta.Chapter : 'Unknown Chapter';
        const topic = meta ? meta.Topic : 'Unknown Topic';

        const key = `${subject}::${chapter}::${topic}::${sourceKey}`;

        if (!processedTopics[key]) {
            processedTopics[key] = { subject, chapter, topic, isBook, sourceName, sourceKey, solved: 0, mistakes: 0 };
        }

        if (isMistake) processedTopics[key].mistakes++;
        else processedTopics[key].solved++;
    }

    rawSolved.forEach(item => processId(item.id, false, item.bucket));
    rawMistakes.forEach(item => processId(item.id, true, item.bucket));

    // Calculate Final Stats
    let absoluteSolved = 0;
    let absoluteMistakes = 0;
    const subjectStats = {};
    const chapterStats = {};
    const topicStats = {};
    const sourceStats = {};
    const heatmapData = {};
    let topicHtml = '';

    Object.values(processedTopics).forEach(data => {
        const { subject, chapter, topic, isBook, sourceName, sourceKey, solved, mistakes } = data;
        const attempts = solved + mistakes;
        const accuracy = attempts > 0 ? Math.round((solved / attempts) * 100) : 0;

        let shouldInclude = false;
        if (activeCourseFilter === 'all') {
            shouldInclude = true;
        } else if (referenceBooks.includes(activeCourseFilter)) {
            if (isBook && sourceKey === activeCourseFilter) shouldInclude = true;
        } else if (standardCourses.includes(activeCourseFilter)) {
            if (!isBook && sourceKey === activeCourseFilter) shouldInclude = true;
        }

        if (!shouldInclude) return;

        absoluteSolved += solved;
        absoluteMistakes += mistakes;

        if (!subjectStats[subject]) subjectStats[subject] = { solved: 0, mistakes: 0 };
        subjectStats[subject].solved += solved;
        subjectStats[subject].mistakes += mistakes;

        if (!chapterStats[chapter]) chapterStats[chapter] = { solved: 0, mistakes: 0 };
        chapterStats[chapter].solved += solved;
        chapterStats[chapter].mistakes += mistakes;

        topicStats[topic] = { accuracy, solved, mistakes };

        if (!sourceStats[sourceName]) sourceStats[sourceName] = { solved: 0, mistakes: 0 };
        sourceStats[sourceName].solved += solved;
        sourceStats[sourceName].mistakes += mistakes;

        const level = accuracy >= 80 ? 'excellent' : accuracy >= 60 ? 'good' : accuracy >= 40 ? 'average' : 'weak';
        heatmapData[topic] = level;

        const accClass = accuracy >= 75 ? 'text-green' : accuracy >= 50 ? 'text-yellow' : 'text-red';

        topicHtml += `
            <div class="topic-row">
                <div class="topic-hierarchy">
                    <div class="subject-name">${subject}</div>
                    <div class="chapter-name">${chapter}</div>
                    <div class="topic-name">${topic}</div>
                    <div class="topic-source">
                        ${isBook ? '📕 Book' : '🎓 Course'} • ${sourceName}
                    </div>
                </div>
                <div class="topic-stats">
                    <div>Accuracy: <strong class="${accClass}">${accuracy}%</strong></div>
                    <div>Solved: <strong>${solved}</strong></div>
                    <div>Mistakes: <strong class="text-red">${mistakes}</strong></div>
                </div>
            </div>
        `;
    });

    const absoluteAttempts = absoluteSolved + absoluteMistakes;
    const overallAccuracy = absoluteAttempts > 0 ? Math.round((absoluteSolved / absoluteAttempts) * 100) : 0;

    // Calculate Average Times
    const avgPracticeTimePerQ = absoluteAttempts > 0 ? (totalPracticeTime / absoluteAttempts) : 0;
    const avgExamTimePerQ = totalExamQuestions > 0 ? (totalExamTime / totalExamQuestions) : 0;

    let weakestSubject = 'N/A';
    let weakestSubjectAccuracy = 100;
    Object.entries(subjectStats).forEach(([name, stats]) => {
        const attempts = stats.solved + stats.mistakes;
        const accuracy = attempts > 0 ? Math.round((stats.solved / attempts) * 100) : 0;
        if (accuracy < weakestSubjectAccuracy) { weakestSubjectAccuracy = accuracy; weakestSubject = name; }
    });

    let weakestChapter = 'N/A';
    let weakestChapterAccuracy = 100;
    Object.entries(chapterStats).forEach(([name, stats]) => {
        const attempts = stats.solved + stats.mistakes;
        const accuracy = attempts > 0 ? Math.round((stats.solved / attempts) * 100) : 0;
        if (accuracy < weakestChapterAccuracy) { weakestChapterAccuracy = accuracy; weakestChapter = name; }
    });

    let strongestTopic = 'N/A';
    let strongestAccuracy = 0;
    Object.entries(topicStats).forEach(([topic, stats]) => {
        if (stats.accuracy > strongestAccuracy) { strongestAccuracy = stats.accuracy; strongestTopic = topic; }
    });

    let sourcePerformanceHtml = '';
    Object.entries(sourceStats).forEach(([source, stats]) => {
        const attempts = stats.solved + stats.mistakes;
        const accuracy = attempts > 0 ? Math.round((stats.solved / attempts) * 100) : 0;
        sourcePerformanceHtml += `
            <div class="analytics-card">
                <div class="analytics-title">${source}</div>
                <div class="analytics-value">${accuracy}%</div>
            </div>
        `;
    });

    let heatmapHtml = '';
    Object.entries(heatmapData).forEach(([topic, level]) => {
        heatmapHtml += `<div class="heatmap-box ${level}">${topic}</div>`;
    });

    // Exam History Table to include Time Metrics
    examHistory.sort((a, b) => new Date(b.date) - new Date(a.date));
    let historyHtml = examHistory.length === 0 ? `<p class="empty-data-text">No Exam History</p>` : `
        <table class="history-table">
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Exam</th>
                    <th>Score</th>
                    <th>Total Time</th>
                    <th>Avg Time / Q</th>
                </tr>
            </thead>
            <tbody>
                ${examHistory.map(exam => {
                    const examAvg = exam.totalQuestions && exam.timeSpent ? (exam.timeSpent / exam.totalQuestions) : 0;
                    return `
                    <tr>
                        <td>${new Date(exam.date).toLocaleDateString()}</td>
                        <td>${exam.examName || 'Practice'}</td>
                        <td>${exam.percentage || 0}%</td>
                        <td>${formatTime(exam.timeSpent)}</td>
                        <td>${formatTime(examAvg)}</td>
                    </tr>
                    `;
                }).join('')}
            </tbody>
        </table>`;

    detailsPanel.innerHTML = `
        <div class="details-header">
            <div>
                <h1>${student.fullName || 'Student'}</h1>
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
                <div class="stat-title">Absolute Solved</div>
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
                <div class="stat-title">Strongest Topic</div>
                <div class="stat-value" style="font-size:1rem;">${strongestTopic}</div>
            </div>
        </div>

        <div class="report-card">
            <h3>⏱️ Time Tracking Analytics</h3>
            <div class="analytics-grid">
                <div class="analytics-card">
                    <div class="analytics-title">Total Practice Time</div>
                    <div class="analytics-value text-blue">${formatTime(totalPracticeTime)}</div>
                    <small>Avg: ${formatTime(avgPracticeTimePerQ)} / question</small>
                </div>
                <div class="analytics-card">
                    <div class="analytics-title">Total Exam Time</div>
                    <div class="analytics-value text-blue">${formatTime(totalExamTime)}</div>
                    <small>Avg: ${formatTime(avgExamTimePerQ)} / question</small>
                </div>
            </div>
        </div>

        <div class="report-card">
            <h3>📊 Advanced Analytics</h3>
            <div class="analytics-grid">
                <div class="analytics-card">
                    <div class="analytics-title">Weakest Subject</div>
                    <div class="analytics-value text-red">${weakestSubject}</div>
                    <small>${weakestSubject === 'N/A' ? '' : weakestSubjectAccuracy + '%'}</small>
                </div>
                <div class="analytics-card">
                    <div class="analytics-title">Weakest Chapter</div>
                    <div class="analytics-value text-yellow">${weakestChapter}</div>
                    <small>${weakestChapter === 'N/A' ? '' : weakestChapterAccuracy + '%'}</small>
                </div>
            </div>
        </div>

        <div class="report-card">
            <h3>📚 Course & Book Performance</h3>
            <div class="analytics-grid">
                ${sourcePerformanceHtml || '<p>No Data Available</p>'}
            </div>
        </div>

        <div class="report-card">
            <h3>🔥 Performance Heatmap</h3>
            <div class="heatmap-grid">
                ${heatmapHtml || '<p>No Data Available</p>'}
            </div>
        </div>

        <div class="report-card">
            <h3>📘 Full Topic Proficiency</h3>
            ${topicHtml || '<p>No Data Available</p>'}
        </div>

        <div class="report-card">
            <h3>📝 Exam History</h3>
            ${historyHtml}
        </div>
    `;

    document.getElementById('course-filter').addEventListener('change', (e) => {
        displayDetailedReport(student, e.target.value);
    });
}