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
function displayDetailedReport(student) {
    if (!student) {
        detailsPanel.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-user-slash" style="font-size: 3rem; color: #cbd5e1; margin-bottom: 1rem;"></i>
                <h3>Student Data Not Found</h3>
                <p>Unable to load detailed records for this user.</p>
            </div>`;
        return;
    }

    // --- 1. AGGREGATE DATA ACROSS ALL COURSES ---
    const knownCourses = ['fcps_part1', 'fcps_part2', 'fcps_imm', 'mrcs_part1', 'mrcs_part2', 'mbbs_year1', 'mbbs_year2', 'mbbs_year3', 'mbbs_year4', 'mbbs_year5'];
    
    let globalHistory = [];
    let totalSolved = 0;
    let globalMistakesSet = new Set();
    let coursesHtml = '';

    knownCourses.forEach(courseKey => {
        const courseData = student[courseKey];
        if (courseData) {
            // Aggregate Solved Questions
            if (courseData.solvedQuestions) {
                totalSolved += courseData.solvedQuestions.length;
            }

            // Aggregate Unique Mistakes
            if (courseData.mistakes) {
                courseData.mistakes.forEach(m => globalMistakesSet.add(m));
            }
            if (courseData.examMistakes) {
                courseData.examMistakes.forEach(m => globalMistakesSet.add(m));
            }

            // Aggregate Exam History
            if (courseData.examHistory) {
                const taggedHistory = courseData.examHistory.map(ex => ({ ...ex, courseName: courseKey }));
                globalHistory.push(...taggedHistory);
            }

            // Build Topic & Subject Breakdown
            if (courseData.revisions && Object.keys(courseData.revisions).length > 0) {
                const topics = courseData.revisions;
                let topicRows = '';
                
                Object.keys(topics).forEach(topicName => {
                    const data = topics[topicName];
                    const accClass = data.lastAccuracy >= 75 ? 'text-green' : (data.lastAccuracy >= 50 ? 'text-yellow' : 'text-red');
                    
                    topicRows += `
                        <div class="topic-row">
                            <div class="topic-name">
                                <i class="fas fa-book-open"></i> ${topicName.replace(/-/g, ' ').toUpperCase()}
                            </div>
                            <div class="topic-stats">
                                <span>Accuracy: <strong class="${accClass}">${data.lastAccuracy}%</strong></span>
                                <span>Level: <strong>Stage ${data.intervalStep || 1}</strong></span>
                            </div>
                        </div>
                    `;
                });

                coursesHtml += `
                    <div class="course-group">
                        <div class="course-group-title">
                            📘 ${courseKey.replace('_', ' ').toUpperCase()}
                        </div>
                        ${topicRows}
                    </div>
                `;
            }
        }
    });

    if (!coursesHtml) {
        coursesHtml = `<p class="empty-data-text">No specific topic or book data recorded yet.</p>`;
    }

    // Sort global history from newest to oldest
    globalHistory.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Calculate Global Stats
    const totalMistakes = globalMistakesSet.size;
    const totalAttempts = totalSolved + totalMistakes;
    const overallAccuracy = totalAttempts > 0 ? Math.round((totalSolved / totalAttempts) * 100) : 0;

    // --- 2. BUILD EXAM HISTORY TABLE ---
    let historyHtml = '';
    if (globalHistory.length === 0) {
        historyHtml = `<p class="empty-data-text">No exams attempted yet.</p>`;
    } else {
        historyHtml = `
            <table class="history-table detailed-history">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Exam / Source</th>
                        <th>Course</th>
                        <th>Score</th>
                        <th>Solved</th>
                        <th>Mistakes</th>
                        <th>Time</th>
                    </tr>
                </thead>
                <tbody>
        `;

        globalHistory.forEach(ex => {
            const isAssigned = ex.examName && ex.examName.includes("(Assigned)");
            const badgeHtml = isAssigned ? `<span class="badge-assigned">Assigned</span>` : `<span class="badge-self">Self-Practice</span>`;
            
            const scoreClass = ex.percentage >= 75 ? 'text-green' : (ex.percentage >= 50 ? 'text-yellow' : 'text-red');
            const timeStr = ex.timeSpentMinutes ? `${ex.timeSpentMinutes} min` : "N/A";

            historyHtml += `
                <tr>
                    <td>${new Date(ex.date).toLocaleDateString()}</td>
                    <td class="fw-bold">${ex.examName || 'Practice Session'} ${badgeHtml}</td>
                    <td class="course-tag">${ex.courseName ? ex.courseName.replace('_', ' ') : '-'}</td>
                    <td class="fw-bold ${scoreClass}">${ex.percentage || 0}%</td>
                    <td class="fw-bold">${ex.totalQuestions || '-'}</td>
                    <td class="fw-bold text-red">${ex.mistakes || '-'}</td>
                    <td class="time-text">${timeStr}</td>
                </tr>
            `;
        });
        historyHtml += `</tbody></table>`;
    }

    // --- 3. RENDER EVERYTHING USING CLEAN CLASSES ---
    detailsPanel.innerHTML = `
        <div class="details-header">
            <div>
                <h1>${student.fullName || 'Unknown Student'}</h1>
                <div class="details-meta">
                    📧 ${student.email || 'No email'} | 📞 ${student.phone || 'No phone'}
                </div>
            </div>
            <div class="role-badge">
                ${student.targetExam || student.role || 'Student'}
            </div>
        </div>

        <div class="stats-grid">
            <div class="stat-card blue">
                <div class="stat-title">Total Solved</div>
                <div class="stat-value">${totalSolved}</div>
            </div>
            <div class="stat-card ${overallAccuracy >= 75 ? 'green' : (overallAccuracy >= 50 ? 'yellow' : 'red')}">
                <div class="stat-title">Global Accuracy</div>
                <div class="stat-value">${overallAccuracy}%</div>
            </div>
            <div class="stat-card red">
                <div class="stat-title">Total Mistakes</div>
                <div class="stat-value">${totalMistakes}</div>
            </div>
        </div>

        <div class="detailed-reports-grid">
            
            <div class="report-card">
                <h3><i class="fas fa-layer-group text-blue"></i> Subject & Topic Proficiency</h3>
                ${coursesHtml}
            </div>

            <div class="report-card">
                <h3><i class="fas fa-history text-green"></i> Complete Exam History</h3>
                <div class="table-responsive">
                    ${historyHtml}
                </div>
            </div>
            
        </div>
    `;
}