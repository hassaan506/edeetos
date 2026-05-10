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

// 1. Security Check: Ensure only authorized users are here
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const userRef = doc(db, "users", user.uid);
            const docSnap = await getDoc(userRef);
            
            if (docSnap.exists()) {
                const role = (docSnap.data().role || '').toUpperCase();
                
                // If they are not staff, kick them back to the dashboard
                if (role !== 'MENTOR' && role !== 'ADMIN' && role !== 'MANAGEMENT') {
                    window.location.href = 'dashboard.html';
                } else {
                    // They are authorized! Fetch the students.
                    fetchStudents();
                }
            }
        } catch (error) {
            console.error("Auth check failed:", error);
        }
    } else {
        window.location.href = 'index.html'; // Kick out guests
    }
});

// 2. Fetch all standard students
async function fetchStudents() {
    try {
        const usersRef = collection(db, "users");
        const userSnap = await getDocs(usersRef);
        
        userSnap.forEach(docSnap => {
            const data = docSnap.data();
            const role = (data.role || 'STUDENT').toUpperCase();
            
            if (role !== 'ADMIN' && role !== 'MENTOR' && role !== 'MANAGEMENT' && role !== 'BANNED') {
                studentsData.push({ id: docSnap.id, ...data });
            }
        });

        // Sort alphabetically
        studentsData.sort((a, b) => (a.fullName || "A").localeCompare(b.fullName || "A"));
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
        
        item.innerHTML = `
            <div class="student-name">${student.fullName || "Unnamed User"}</div>
            <div class="student-email">${student.email || "No Email"}</div>
        `;

        item.addEventListener('click', () => {
            // Remove 'active' class from all items, add to the clicked one
            document.querySelectorAll('.student-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            
            // Call the upgraded god-view function
            displayDetailedReport(student);
        });

        studentListContainer.appendChild(item);
    });
}

// 4. Search Filter Logic
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
// 5. COMPREHENSIVE STUDENT REPORT GENERATOR (CLEAN UI)
// ==========================================
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

// 1. Security Check: Ensure only authorized users are here
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const userRef = doc(db, "users", user.uid);
            const docSnap = await getDoc(userRef);
            
            if (docSnap.exists()) {
                const role = (docSnap.data().role || '').toUpperCase();
                
                // If they are not staff, kick them back to the dashboard
                if (role !== 'MENTOR' && role !== 'ADMIN' && role !== 'MANAGEMENT') {
                    window.location.href = 'dashboard.html';
                } else {
                    // They are authorized! Fetch the students.
                    fetchStudents();
                }
            }
        } catch (error) {
            console.error("Auth check failed:", error);
        }
    } else {
        window.location.href = 'index.html'; // Kick out guests
    }
});

// 2. Fetch all standard students
async function fetchStudents() {
    try {
        const usersRef = collection(db, "users");
        const userSnap = await getDocs(usersRef);
        
        userSnap.forEach(docSnap => {
            const data = docSnap.data();
            const role = (data.role || 'STUDENT').toUpperCase();
            
            if (role !== 'ADMIN' && role !== 'MENTOR' && role !== 'MANAGEMENT' && role !== 'BANNED') {
                studentsData.push({ id: docSnap.id, ...data });
            }
        });

        // Sort alphabetically
        studentsData.sort((a, b) => (a.fullName || "A").localeCompare(b.fullName || "A"));
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
        
        item.innerHTML = `
            <div class="student-name">${student.fullName || "Unnamed User"}</div>
            <div class="student-email">${student.email || "No Email"}</div>
        `;

        item.addEventListener('click', () => {
            // Remove 'active' class from all items, add to the clicked one
            document.querySelectorAll('.student-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            
            // Call the upgraded god-view function
            displayDetailedReport(student);
        });

        studentListContainer.appendChild(item);
    });
}

// 4. Search Filter Logic
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
// 5. COMPREHENSIVE STUDENT REPORT GENERATOR (CLEAN UI)
// ==========================================
function displayDetailedReport(student, activeCourseFilter = 'all') {

    if (!student) {
        detailsPanel.innerHTML = `
            <div class="empty-state">
                <h3>No Student Selected</h3>
            </div>
        `;
        return;
    }

    const standardCourses = [
        'fcps_part1',
        'fcps_part2',
        'fcps_imm',
        'mrcs_part1',
        'mrcs_part2',
        'mbbs_year1',
        'mbbs_year2',
        'mbbs_year3',
        'mbbs_year4',
        'mbbs_year5'
    ];

    const referenceBooks = [
        'firstaid_step1',
        'rafiullah',
        'im_medicine',
        'im_surgery',
        'brs_patho',
        'brs_physio'
    ];

    const titles = {
        'fcps_part1': 'FCPS Part 1',
        'fcps_part2': 'FCPS Part 2',
        'fcps_imm': 'FCPS IMM',
        'mrcs_part1': 'MRCS Part 1',
        'mrcs_part2': 'MRCS Part 2',
        'mbbs_year1': 'MBBS Year 1',
        'mbbs_year2': 'MBBS Year 2',
        'mbbs_year3': 'MBBS Year 3',
        'mbbs_year4': 'MBBS Year 4',
        'mbbs_year5': 'MBBS Year 5',

        'firstaid_step1': 'First Aid Step 1',
        'rafiullah': 'Rafiullah FCPS',
        'im_medicine': 'Irfan Masood Medicine',
        'im_surgery': 'Irfan Masood Surgery',
        'brs_patho': 'BRS Pathology',
        'brs_physio': 'BRS Physiology'
    };

    let filterOptions = `<option value="all">All Courses & Books</option>`;

    filterOptions += `<optgroup label="Courses">`;
    standardCourses.forEach(course => {
        filterOptions += `
            <option value="${course}" ${activeCourseFilter === course ? 'selected' : ''}>
                ${titles[course]}
            </option>
        `;
    });
    filterOptions += `</optgroup>`;

    filterOptions += `<optgroup label="Books">`;
    referenceBooks.forEach(book => {
        filterOptions += `
            <option value="${book}" ${activeCourseFilter === book ? 'selected' : ''}>
                ${titles[book]}
            </option>
        `;
    });
    filterOptions += `</optgroup>`;

    let totalSolved = 0;
    let totalMistakes = 0;
    let topicHtml = '';
    let examHistory = [];

    const subjectStats = {};
    const chapterStats = {};
    const topicStats = {};
    const sourceStats = {};
    const heatmapData = {};

    // ==================================================
    // STEP 1: GATHER ALL DATA (COURSES + BOOKS)
    // ==================================================
    let allRevisions = [];

    // Collect Course Data
    standardCourses.forEach(courseKey => {
        if (student[courseKey]) {
            const revs = student[courseKey].revisions || {};
            Object.entries(revs).forEach(([tId, rev]) => {
                allRevisions.push({
                    topicId: tId,
                    data: rev,
                    parentCourse: courseKey,
                    isBookNode: false
                });
            });
            if (student[courseKey].examHistory) {
                examHistory.push(...student[courseKey].examHistory);
            }
        }
    });

    // Collect Books Data
    if (student.books) {
        const revs = student.books.revisions || {};
        Object.entries(revs).forEach(([tId, rev]) => {
            allRevisions.push({
                topicId: tId,
                data: rev,
                parentCourse: 'books',
                isBookNode: true
            });
        });
        if (student.books.examHistory) {
            examHistory.push(...student.books.examHistory);
        }
    }

    // ==================================================
    // STEP 2: PROCESS & FILTER THE GATHERED DATA
    // ==================================================
    allRevisions.forEach(item => {
        const topicId = item.topicId;
        const data = item.data;

        const isBook = item.isBookNode || data.sourceType === 'book' || topicId.includes('📕');
        const subject = data.subject || 'Unknown Subject';
        const chapter = data.chapter || 'Unknown Chapter';
        const topic = data.topic || topicId.replace(/-/g, ' ');

        let sourceName = data.sourceName;
        if (!sourceName) {
            sourceName = isBook ? subject : (titles[item.parentCourse] || 'Unknown Course');
        }

        const solved = data.correctAnswers || data.solved || data.solvedQuestionsCount || 0;
        const mistakes = data.wrongAnswers || data.mistakes || data.mistakesCount || 0;
        const attempts = solved + mistakes;
        const accuracy = data.lastAccuracy ?? data.accuracy ?? (attempts > 0 ? Math.round((solved / attempts) * 100) : 0);

        // --- FILTERING LOGIC ---
        let shouldInclude = false;
        
        if (activeCourseFilter === 'all') {
            shouldInclude = true;
        } else if (referenceBooks.includes(activeCourseFilter)) {
            // User selected a specific book filter (e.g. 'firstaid_step1')
            const expectedBookTitle = titles[activeCourseFilter]; 
            // Check if the current item belongs to this book
            if (isBook && (sourceName === expectedBookTitle || subject === expectedBookTitle || data.sourceName === activeCourseFilter)) {
                shouldInclude = true;
            }
        } else if (standardCourses.includes(activeCourseFilter)) {
            // User selected a specific course filter
            if (!isBook && item.parentCourse === activeCourseFilter) {
                shouldInclude = true;
            }
        }

        if (!shouldInclude) return;

        totalSolved += solved;
        totalMistakes += mistakes;

        // =========================
        // SUBJECT ANALYTICS
        // =========================
        if (!subjectStats[subject]) {
            subjectStats[subject] = { solved: 0, mistakes: 0 };
        }
        subjectStats[subject].solved += solved;
        subjectStats[subject].mistakes += mistakes;

        // =========================
        // CHAPTER ANALYTICS
        // =========================
        if (!chapterStats[chapter]) {
            chapterStats[chapter] = { solved: 0, mistakes: 0 };
        }
        chapterStats[chapter].solved += solved;
        chapterStats[chapter].mistakes += mistakes;

        // =========================
        // TOPIC ANALYTICS
        // =========================
        topicStats[topic] = { accuracy, solved, mistakes };

        // =========================
        // SOURCE ANALYTICS
        // =========================
        if (!sourceStats[sourceName]) {
            sourceStats[sourceName] = { solved: 0, mistakes: 0 };
        }
        sourceStats[sourceName].solved += solved;
        sourceStats[sourceName].mistakes += mistakes;

        // =========================
        // HEATMAP
        // =========================
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
                    <div>Stage: <strong>${data.intervalStep || 1}</strong></div>
                </div>
            </div>
        `;
    });

    const totalAttempts = totalSolved + totalMistakes;
    const overallAccuracy = totalAttempts > 0 ? Math.round((totalSolved / totalAttempts) * 100) : 0;

    // =========================================
    // WEAKEST SUBJECT
    // =========================================
    let weakestSubject = 'N/A';
    let weakestSubjectAccuracy = 100;

    Object.entries(subjectStats).forEach(([name, stats]) => {
        const attempts = stats.solved + stats.mistakes;
        const accuracy = attempts > 0 ? Math.round((stats.solved / attempts) * 100) : 0;
        if (accuracy < weakestSubjectAccuracy) {
            weakestSubjectAccuracy = accuracy;
            weakestSubject = name;
        }
    });

    // =========================================
    // WEAKEST CHAPTER
    // =========================================
    let weakestChapter = 'N/A';
    let weakestChapterAccuracy = 100;

    Object.entries(chapterStats).forEach(([name, stats]) => {
        const attempts = stats.solved + stats.mistakes;
        const accuracy = attempts > 0 ? Math.round((stats.solved / attempts) * 100) : 0;
        if (accuracy < weakestChapterAccuracy) {
            weakestChapterAccuracy = accuracy;
            weakestChapter = name;
        }
    });

    // =========================================
    // STRONGEST TOPIC
    // =========================================
    let strongestTopic = 'N/A';
    let strongestAccuracy = 0;

    Object.entries(topicStats).forEach(([topic, stats]) => {
        if (stats.accuracy > strongestAccuracy) {
            strongestAccuracy = stats.accuracy;
            strongestTopic = topic;
        }
    });

    // =========================================
    // COURSE/BOOK PERFORMANCE
    // =========================================
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

    // =========================================
    // HEATMAP
    // =========================================
    let heatmapHtml = '';
    Object.entries(heatmapData).forEach(([topic, level]) => {
        heatmapHtml += `
            <div class="heatmap-box ${level}">${topic}</div>
        `;
    });

    // =========================================
    // MENTOR ANALYTICS
    // =========================================
    const mentorInsight = `
        Student has solved ${totalSolved} questions
        with ${overallAccuracy}% overall accuracy.
        Weakest area is ${weakestSubject}.
    `;

    // =========================================
    // COMPARATIVE REPORT
    // =========================================
    const averageStudentAccuracy = 65;
    const comparisonDiff = overallAccuracy - averageStudentAccuracy;
    const comparisonText = comparisonDiff >= 0 ? `+${comparisonDiff}% above average` : `${comparisonDiff}% below average`;

    // =========================================
    // EXAM HISTORY
    // =========================================
    examHistory.sort((a, b) => new Date(b.date) - new Date(a.date));
    let historyHtml = '';

    if (examHistory.length === 0) {
        historyHtml = `
            <p class="empty-data-text">
                No Exam History
            </p>
        `;
    } else {
        historyHtml = `
            <table class="history-table">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Exam</th>
                        <th>Score</th>
                    </tr>
                </thead>
                <tbody>
        `;
        examHistory.forEach(exam => {
            historyHtml += `
                <tr>
                    <td>${new Date(exam.date).toLocaleDateString()}</td>
                    <td>${exam.examName || 'Practice'}</td>
                    <td>${exam.percentage || 0}%</td>
                </tr>
            `;
        });
        historyHtml += `
                </tbody>
            </table>
        `;
    }

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
                <div class="stat-title">Solved</div>
                <div class="stat-value">${totalSolved}</div>
            </div>
            <div class="stat-card green">
                <div class="stat-title">Accuracy</div>
                <div class="stat-value">${overallAccuracy}%</div>
            </div>
            <div class="stat-card red">
                <div class="stat-title">Mistakes</div>
                <div class="stat-value">${totalMistakes}</div>
            </div>
            <div class="stat-card yellow">
                <div class="stat-title">Strongest Topic</div>
                <div class="stat-value" style="font-size:1rem;">
                    ${strongestTopic}
                </div>
            </div>
        </div>

        <div class="report-card">
            <h3>📊 Advanced Analytics</h3>
            <div class="analytics-grid">
                <div class="analytics-card">
                    <div class="analytics-title">Weakest Subject</div>
                    <div class="analytics-value text-red">${weakestSubject}</div>
                    <small>${weakestSubjectAccuracy}%</small>
                </div>
                <div class="analytics-card">
                    <div class="analytics-title">Weakest Chapter</div>
                    <div class="analytics-value text-yellow">${weakestChapter}</div>
                    <small>${weakestChapterAccuracy}%</small>
                </div>
                <div class="analytics-card">
                    <div class="analytics-title">Comparative Report</div>
                    <div class="analytics-value text-blue">${comparisonText}</div>
                </div>
            </div>
        </div>

        <div class="report-card">
            <h3>📚 Course & Book Performance</h3>
            <div class="analytics-grid">
                ${sourcePerformanceHtml}
            </div>
        </div>

        <div class="report-card">
            <h3>🔥 Performance Heatmap</h3>
            <div class="heatmap-grid">
                ${heatmapHtml}
            </div>
        </div>

        <div class="report-card">
            <h3>🧠 Mentor Insights</h3>
            <div class="mentor-insight">
                ${mentorInsight}
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

    document
        .getElementById('course-filter')
        .addEventListener('change', (e) => {
            displayDetailedReport(student, e.target.value);
        });
}