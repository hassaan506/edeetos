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
            
            renderStudentDetails(student);
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

// 5. Render the Main Details Panel
function renderStudentDetails(student) {
    // Get the course the mentor/admin currently has active in their own local storage
    const activeCourse = localStorage.getItem('edeetos_active_course') || 'fcps_part1';
    
    // Extract data
    const courseData = student[activeCourse] || {};
    const solvedCount = courseData.solvedQuestions ? courseData.solvedQuestions.length : 0;
    
    // Calculate unique mistakes
    const practiceMistakes = courseData.mistakes || [];
    const examMistakes = courseData.examMistakes || [];
    const totalUniqueMistakes = [...new Set([...practiceMistakes, ...examMistakes])].length;

    // Calculate accuracy
    const totalAttempts = solvedCount + totalUniqueMistakes;
    const accuracy = totalAttempts > 0 ? Math.round((solvedCount / totalAttempts) * 100) : 0;
    const examHistory = courseData.examHistory || [];

    // Build the UI using our clean CSS classes
    let html = `
        <div class="details-header">
            <h1>${student.fullName || "Unnamed User"}</h1>
            <div class="details-meta">${student.email || "No Email"} &bull; Viewing Data For: <span class="course-badge">${activeCourse}</span></div>
        </div>

        <div class="stats-grid">
            <div class="stat-card green">
                <div class="stat-title">Total Solved</div>
                <div class="stat-value">${solvedCount}</div>
            </div>
            <div class="stat-card red">
                <div class="stat-title">Total Mistakes</div>
                <div class="stat-value">${totalUniqueMistakes}</div>
            </div>
            <div class="stat-card blue">
                <div class="stat-title">Overall Accuracy</div>
                <div class="stat-value">${accuracy}%</div>
            </div>
        </div>

        <div class="history-section">
            <h3>Exam History</h3>
    `;

    if (examHistory.length === 0) {
        html += `<div class="empty-state" style="height: 100px;"><p>No exams taken yet.</p></div>`;
    } else {
        html += `
            <table class="history-table">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Exam Name</th>
                        <th>Score</th>
                        <th>Time Spent</th>
                    </tr>
                </thead>
                <tbody>
        `;

        // Reverse to show newest exams at the top
        examHistory.slice().reverse().forEach(ex => {
            const isAssigned = ex.examName.includes("(Assigned)");
            const badgeHtml = isAssigned ? `<span class="badge-assigned">Assigned</span>` : `<span class="badge-self">Self-Practice</span>`;
            
            // Dynamic text color for score based on percentage
            const scoreColor = ex.percentage >= 75 ? '#15803d' : (ex.percentage >= 50 ? '#d97706' : '#b91c1c');
            const timeSpentStr = ex.timeSpentMinutes ? `${ex.timeSpentMinutes} min` : "N/A";

            html += `
                <tr>
                    <td>${new Date(ex.date).toLocaleDateString()}</td>
                    <td style="font-weight: 500;">${ex.examName} ${badgeHtml}</td>
                    <td style="font-weight: bold; color: ${scoreColor};">${ex.percentage}%</td>
                    <td>${timeSpentStr}</td>
                </tr>
            `;
        });

        html += `</tbody></table>`;
    }

    html += `</div>`;
    detailsPanel.innerHTML = html;
}