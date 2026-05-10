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
                <i class="fas fa-user-slash" style="font-size: 3rem; color: #cbd5e1; margin-bottom: 1rem;"></i>
                <h3>Student Data Not Found</h3>
                <p>Unable to load detailed records for this user.</p>
            </div>`;
        return;
    }

    // Books are removed from here because they live INSIDE these root courses!
    const knownCourses = [
        'fcps_part1', 'fcps_part2', 'fcps_imm', 
        'mrcs_part1', 'mrcs_part2', 
        'mbbs_year1', 'mbbs_year2', 'mbbs_year3', 'mbbs_year4', 'mbbs_year5'
    ];

    const courseTitles = {
        'fcps_part1': 'FCPS Part 1',
        'fcps_part2': 'FCPS Part 2',
        'fcps_imm': 'FCPS IMM',
        'mrcs_part1': 'MRCS Part 1',
        'mrcs_part2': 'MRCS Part 2',
        'mbbs_year1': 'MBBS Year 1',
        'mbbs_year2': 'MBBS Year 2',
        'mbbs_year3': 'MBBS Year 3',
        'mbbs_year4': 'MBBS Year 4',
        'mbbs_year5': 'MBBS Year 5'
    };
    
    let courseOptionsHtml = `<option value="all" ${activeCourseFilter === 'all' ? 'selected' : ''}>All Standard Courses</option>`;
    knownCourses.forEach(c => {
        const isSelected = activeCourseFilter === c ? 'selected' : '';
        courseOptionsHtml += `<option value="${c}" ${isSelected}>${courseTitles[c]}</option>`;
    });

    let globalHistory = [];
    let totalSolved = 0;
    let globalMistakesSet = new Set();
    let coursesHtml = '';

    const coursesToProcess = activeCourseFilter === 'all' ? knownCourses : [activeCourseFilter];

    coursesToProcess.forEach(courseKey => {
        const courseData = student[courseKey];
        if (courseData) {
            if (courseData.solvedQuestions) totalSolved += courseData.solvedQuestions.length;
            if (courseData.mistakes) courseData.mistakes.forEach(m => globalMistakesSet.add(m));
            if (courseData.examMistakes) courseData.examMistakes.forEach(m => globalMistakesSet.add(m));
            if (courseData.examHistory) {
                const taggedHistory = courseData.examHistory.map(ex => ({ ...ex, courseName: courseKey }));
                globalHistory.push(...taggedHistory);
            }

            if (courseData.revisions && Object.keys(courseData.revisions).length > 0) {
                const topics = courseData.revisions;
                let standardTopicRows = '';
                let bookRows = '';
                
                Object.keys(topics).forEach(topicName => {
                    const data = topics[topicName];
                    const accClass = data.lastAccuracy >= 75 ? 'text-green' : (data.lastAccuracy >= 50 ? 'text-yellow' : 'text-red');
                    
                    const rowHtml = `
                        <div class="topic-row" style="padding: 10px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between;">
                            <div class="topic-name" style="font-weight: 600; color: #1e293b;">
                                ${topicName.replace(/-/g, ' ')}
                            </div>
                            <div class="topic-stats" style="font-size: 0.85rem; color: #64748b;">
                                <span style="margin-right: 15px;">Accuracy: <strong class="${accClass}">${data.lastAccuracy}%</strong></span>
                                <span>Spaced Repetition: <strong>Stage ${data.intervalStep || 1}</strong></span>
                            </div>
                        </div>
                    `;

                    // Separate books from standard course topics automatically
                    if (topicName.includes('📕')) {
                        bookRows += rowHtml;
                    } else {
                        standardTopicRows += rowHtml;
                    }
                });

                const sectionTitle = courseTitles[courseKey];
                
                coursesHtml += `<div class="course-group" style="margin-bottom: 25px; background: white; border-radius: 12px; border: 1px solid #e2e8f0; padding: 15px;">`;
                coursesHtml += `<h3 style="color: #0f172a; border-bottom: 2px solid #cbd5e1; padding-bottom: 8px;">🎓 ${sectionTitle} Progress</h3>`;
                
                if (standardTopicRows) {
                    coursesHtml += `<h4 style="color: #3b82f6; margin-top: 15px; font-size: 0.9rem; text-transform: uppercase;">Standard Topics</h4>${standardTopicRows}`;
                }
                if (bookRows) {
                    coursesHtml += `<h4 style="color: #8b5cf6; margin-top: 15px; font-size: 0.9rem; text-transform: uppercase;">Reference Books</h4>${bookRows}`;
                }
                
                coursesHtml += `</div>`;
            }
        }
    });

    if (!coursesHtml) {
        coursesHtml = `<p class="empty-data-text" style="color: #64748b; font-style: italic;">No topic or book data recorded yet for this selection.</p>`;
    }

    globalHistory.sort((a, b) => new Date(b.date) - new Date(a.date));
    const totalMistakes = globalMistakesSet.size;
    const totalAttempts = totalSolved + totalMistakes;
    const overallAccuracy = totalAttempts > 0 ? Math.round((totalSolved / totalAttempts) * 100) : 0;

    let historyHtml = '';
    if (globalHistory.length === 0) {
        historyHtml = `<p class="empty-data-text" style="color: #64748b;">No exams attempted yet.</p>`;
    } else {
        historyHtml = `
            <table class="history-table detailed-history" style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                <thead>
                    <tr style="background: #f8fafc; text-align: left; border-bottom: 2px solid #cbd5e1;">
                        <th style="padding: 10px;">Date</th>
                        <th style="padding: 10px;">Exam</th>
                        <th style="padding: 10px;">Score</th>
                        <th style="padding: 10px;">Time</th>
                    </tr>
                </thead>
                <tbody>
        `;

        globalHistory.forEach(ex => {
            const scoreClass = ex.percentage >= 75 ? 'text-green' : (ex.percentage >= 50 ? 'text-yellow' : 'text-red');
            const timeStr = ex.timeSpentMinutes ? `${ex.timeSpentMinutes} min` : "N/A";
            historyHtml += `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 10px;">${new Date(ex.date).toLocaleDateString()}</td>
                    <td style="padding: 10px; font-weight: bold;">${ex.examName || 'Practice Session'}</td>
                    <td style="padding: 10px; font-weight: bold;" class="${scoreClass}">${ex.percentage || 0}%</td>
                    <td style="padding: 10px; color: #64748b;">${timeStr}</td>
                </tr>
            `;
        });
        historyHtml += `</tbody></table>`;
    }

    detailsPanel.innerHTML = `
        <div class="details-header" style="flex-wrap: wrap; gap: 15px;">
            <div style="flex: 1; min-width: 250px;">
                <h1>${student.fullName || 'Unknown Student'}</h1>
                <div class="details-meta" style="color: #64748b; margin-bottom: 15px;">
                    📧 ${student.email || 'No email'}
                </div>
                <div>
                    <label style="font-weight: bold; font-size: 0.9rem; color: #475569; margin-right: 10px;">Filter by Enrollment:</label>
                    <select id="course-filter" style="padding: 0.5rem; border-radius: 8px; border: 1px solid #cbd5e1; outline: none;">
                        ${courseOptionsHtml}
                    </select>
                </div>
            </div>
        </div>

        <div class="stats-grid" style="display: flex; gap: 15px; margin: 20px 0;">
            <div class="stat-card" style="flex: 1; background: #eff6ff; padding: 20px; border-radius: 12px; border-left: 4px solid #3b82f6;">
                <div class="stat-title" style="color: #1e3a8a; font-weight: bold;">Total Solved</div>
                <div class="stat-value" style="font-size: 1.8rem; color: #1d4ed8;">${totalSolved}</div>
            </div>
            <div class="stat-card" style="flex: 1; background: #ecfdf5; padding: 20px; border-radius: 12px; border-left: 4px solid #10b981;">
                <div class="stat-title" style="color: #064e3b; font-weight: bold;">Global Accuracy</div>
                <div class="stat-value" style="font-size: 1.8rem; color: #047857;">${overallAccuracy}%</div>
            </div>
        </div>

        <div class="detailed-reports-grid" style="display: grid; grid-template-columns: 1fr; gap: 20px;">
            <div class="report-card">
                <h3 style="margin-bottom: 15px;"><i class="fas fa-layer-group text-blue"></i> Subject & Topic Proficiency</h3>
                ${coursesHtml}
            </div>
            <div class="report-card" style="background: white; border-radius: 12px; border: 1px solid #e2e8f0; padding: 20px;">
                <h3 style="margin-bottom: 15px;"><i class="fas fa-history text-green"></i> Exam History</h3>
                <div class="table-responsive">
                    ${historyHtml}
                </div>
            </div>
        </div>
    `;

    document.getElementById('course-filter').addEventListener('change', (e) => {
        displayDetailedReport(student, e.target.value);
    });
}