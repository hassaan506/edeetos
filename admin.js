import { auth, db, courseNamesMap, mergedNamesMap } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { collection, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let allUsersData = [];

// === HELPER: Cross-Reference UID to Real Name ===
function getUserName(uid) {
    if (!allUsersData || allUsersData.length === 0) return uid; 
    const user = allUsersData.find(u => u.uid === uid);
    return user ? user.fullName : "Unknown User";
}

function updatePendingCount() {
    const q = JSON.parse(localStorage.getItem('edeetos_pending_edits')) || [];
    const cntEl = document.getElementById('admin-pending-count');
    if (cntEl) cntEl.textContent = q.length;
}

// === AUTHENTICATION & INITIALIZATION ===
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const userRef = doc(db, "users", user.uid);
            const docSnap = await getDoc(userRef);
            const role = docSnap.exists() ? (docSnap.data().role || '').toUpperCase() : '';
            if (role !== 'MANAGEMENT' && role !== 'ADMIN') {
                alert("Unauthorized Access."); window.location.href = 'dashboard.html'; return;
            }
            
            await fetchAllUsers();
            calculateTotalQuestions();
            updatePendingCount();
            
            fetchStudyRooms();
            fetchFriendChallenges();
            fetchAssignedExams();
            fetchRewardClaims();

            const qChats = query(collection(db, "chats"), where("status", "==", "pending"));
            onSnapshot(qChats, (snapshot) => {
                snapshot.docChanges().forEach((change) => {
                    if (change.type === "added") {
                        const data = change.doc.data();
                        alert(`🚨 EDEETOS ALERT: Incoming Mentor Request from ${data.studentName}! Open the Mentorship Hub.`);
                    }
                });
            });
            
        } catch (error) {
            alert("Database permission error. Check your Firebase Rules.");
        }
    } else {
        window.location.href = 'login.html';
    }
});

// === LAYOUT & SIDEBAR NAVIGATION ===
const sidebar = document.getElementById('admin-sidebar');
document.getElementById('open-mobile-sidebar').onclick = () => sidebar.classList.add('mobile-open');
document.getElementById('close-mobile-sidebar').onclick = () => sidebar.classList.remove('mobile-open');
document.getElementById('btn-exit-admin').onclick = () => window.location.href = 'dashboard.html';

let quillExp, quillHnt;
function initQuillOnce() {
    if (quillExp) return;
    const tb = [['bold', 'italic', 'underline', 'strike'], [{ 'color': [] }, { 'background': [] }], [{ 'list': 'ordered'}, { 'list': 'bullet' }], [{ 'align': [] }], ['clean']];
    quillExp = new Quill('#add-q-exp', { theme: 'snow', modules: { toolbar: tb } });
    quillHnt = new Quill('#add-q-hnt', { theme: 'snow', modules: { toolbar: tb } });
}

window.switchView = function(viewName) {
    const views = ['database', 'addq', 'users', 'studyrooms', 'challenges', 'assigned', 'rewards', 'payments', 'keys', 'promos', 'requests', 'reports', 'messages'];
    views.forEach(v => { const el = document.getElementById(`view-${v}`); if (el) el.style.display = 'none'; });
    
    document.querySelectorAll('.sidebar-link').forEach(t => t.classList.remove('active'));
    
    const targetView = document.getElementById(`view-${viewName}`);
    if (targetView) targetView.style.display = 'block';
    
    const activeTab = document.querySelector(`.sidebar-link[onclick*="${viewName}"]`);
    if (activeTab) activeTab.classList.add('active');

    sidebar.classList.remove('mobile-open');

    // Trigger on-demand fetches & initialization
    if(viewName === 'addq') initQuillOnce();
    if(viewName === 'keys') fetchKeys();
    if(viewName === 'promos') fetchPromos();
    if(viewName === 'payments') fetchPayments();
    if(viewName === 'requests') fetchRequests();
    if(viewName === 'reports') fetchReports();
    if(viewName === 'messages') fetchMessages();
};

// === 1. DATABASE OVERVIEW ===
async function calculateTotalQuestions() {
    const standardCourses = ['fcps_part1', 'fcps_part2', 'fcps_imm', 'mrcs_part1', 'mrcs_part2', 'mbbs_year1', 'mbbs_year2', 'mbbs_year3', 'mbbs_year4', 'mbbs_year5'];
    const referenceBooks = [
        { file: "brs_patho", title: "BRS Patho" }, { file: "brs_physio", title: "BRS Physio" }, { file: "doubleAA", title: "Double AA" },
        { file: "firstaid_step1", title: "FA Step 1" }, { file: "firstaid_step2", title: "FA Step 2" },
        { file: "im_medicine", title: "IM Med" }, { file: "im_surgery", title: "IM Surg" }, { file: "im_pathology", title: "IM Path" },
        { file: "im_pediatrics", title: "IM Peds" }, { file: "pretest_surgery", title: "Pretest Surg" },
        { file: "rafiullah", title: "Rafiullah" }, { file: "RWR", title: "Residency" }
    ];

    let totalQuestions = 0;
    let breakdownHtml = `<div style="font-size: 0.8rem; font-weight: 800; color: #64748b; margin-bottom: 8px;">Core Courses</div><div style="display: flex; flex-wrap: wrap; gap: 8px;">`;

    async function fetchAndCount(path, displayTitle, badgeColor, textColor) {
        try {
            const response = await fetch(path, { cache: 'no-cache' });
            if (response.ok) {
                const data = await response.json();
                if (Array.isArray(data) && data.length > 0) {
                    const count = data.length;
                    totalQuestions += count;
                    breakdownHtml += `<span style="background: ${badgeColor}; color: ${textColor}; padding: 6px 12px; border-radius: 8px; font-weight: bold; border: 1px solid rgba(0,0,0,0.05);">${displayTitle}: ${count} Qs</span>`;
                }
            }
        } catch (e) {}
    }

    for (const course of standardCourses) await fetchAndCount(`Data/${course}_questions.json`, courseNamesMap[course] || course, '#f1f5f9', '#334155');
    
    breakdownHtml += `</div><div style="margin: 20px 0 8px 0; color: #8b5cf6; font-size: 0.8rem; font-weight: 800;">Reference Books</div><div style="display: flex; flex-wrap: wrap; gap: 8px;">`;
    for (const book of referenceBooks) await fetchAndCount(`Books/${book.file}_questions.json`, book.title, '#ede9fe', '#5b21b6');
    breakdownHtml += `</div>`;

    document.getElementById('total-q-count').innerHTML = `Total Qs: ${totalQuestions.toLocaleString()}`;
    document.getElementById('database-breakdown-content').innerHTML = breakdownHtml;
}

// === 2. ADD QUESTION & PUSH COMPILER ===

document.getElementById('btn-save-new-q').onclick = () => {
    const qText = document.getElementById('add-q-txt').value.trim();
    if (!qText) return alert("Question text is required.");

    // Generate strict 8-character ID ensuring zero whitespace
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let newId = "";
    for (let i = 0; i < 8; i++) newId += chars.charAt(Math.floor(Math.random() * chars.length));
    
    const targetVal = document.getElementById('add-q-dest').value.split(':');
    const isBook = targetVal[0] === 'BOOK';
    const courseFile = targetVal[1];

    const correctOptNode = document.querySelector('input[name="add-correct-opt"]:checked');
    const correctLetter = correctOptNode ? correctOptNode.value : 'A';

    const newRow = {
        "QuestionID": newId,
        "Year": document.getElementById('add-q-yr').value.trim(),
        "Exam": document.getElementById('add-q-exm').value.trim(),
        "Subject": document.getElementById('add-q-sub').value.trim(),
        "Chapter": document.getElementById('add-q-chap').value.trim(),
        "Topic": document.getElementById('add-q-top').value.trim(),
        "Question": qText,
        "OptionA": document.getElementById('add-opt-a').value.trim(),
        "OptionB": document.getElementById('add-opt-b').value.trim(),
        "OptionC": document.getElementById('add-opt-c').value.trim(),
        "OptionD": document.getElementById('add-opt-d').value.trim(),
        "OptionE": document.getElementById('add-opt-e').value.trim(),
        "CorrectAnswer": correctLetter,
        "Explanation": quillExp.root.innerHTML,
        "Hint": quillHnt.root.innerHTML,
        "Difficulty": document.getElementById('add-q-dif').value
    };

    let pendingEditsQueue = JSON.parse(localStorage.getItem('edeetos_pending_edits')) || [];
    pendingEditsQueue.push({ row: newRow, courseFile, isBook });
    localStorage.setItem('edeetos_pending_edits', JSON.stringify(pendingEditsQueue));
    
    updatePendingCount();
    
    // Reset Form
    ['add-q-sub', 'add-q-chap', 'add-q-top', 'add-q-yr', 'add-q-exm', 'add-q-txt', 'add-opt-a', 'add-opt-b', 'add-opt-c', 'add-opt-d', 'add-opt-e'].forEach(id => document.getElementById(id).value = '');
    quillExp.root.innerHTML = ''; quillHnt.root.innerHTML = '';
    document.getElementById('add-q-dif').value = 'medium';
    document.querySelector('input[name="add-correct-opt"][value="A"]').checked = true;

    alert('Question added to your browser queue! Click "Push Database to GitHub" to publish it live.');
};

document.getElementById('btn-admin-push').onclick = async () => {
    let pendingQueue = JSON.parse(localStorage.getItem('edeetos_pending_edits')) || [];
    if (pendingQueue.length === 0) return alert("Queue is empty. Nothing to push.");

    let token = localStorage.getItem('edeetos_github_pat');
    if (!token) {
        token = prompt("Please enter your GitHub Personal Access Token:");
        if (!token) return;
        localStorage.setItem('edeetos_github_pat', token);
    }

    const btn = document.getElementById('btn-admin-push');
    const origHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:8px;"></i> Compiling...';
    btn.disabled = true;

    try {
        const Papa = (await import('https://cdn.jsdelivr.net/npm/papaparse@5.4.1/+esm')).default;
        const { Base64 } = await import('https://cdn.jsdelivr.net/npm/js-base64@3.7.5/+esm');

        const editsByCourse = {};
        pendingQueue.forEach(edit => {
            const key = edit.courseFile;
            if (!editsByCourse[key]) editsByCourse[key] = { isBook: edit.isBook, rows: [] };
            editsByCourse[key].rows.push(edit.row);
        });

        const owner = "hassaan506"; const repo = "edeetos"; const branch = "main";

        const uploadFileToGitHub = async (filePath, contentStr, commitMsg) => {
            const fileUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
            let currentSha = null;
            try {
                const getRes = await fetch(fileUrl + `?ref=${branch}`, { headers: { "Authorization": `Bearer ${token}` } });
                if (getRes.ok) currentSha = (await getRes.json()).sha;
            } catch(e) {}

            const bodyData = { message: commitMsg, content: Base64.encode(contentStr), branch: branch };
            if (currentSha) bodyData.sha = currentSha;

            const putRes = await fetch(fileUrl, {
                method: 'PUT', headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify(bodyData)
            });

            if (!putRes.ok) throw new Error(`Failed to upload ${filePath}. Check token permissions.`);
        };

        for (const courseFile of Object.keys(editsByCourse)) {
            const isBook = editsByCourse[courseFile].isBook;
            const folder = isBook ? "Books" : "Data";
            const csvPath = `${folder}/${courseFile}.csv`;
            const questionsJsonPath = `${folder}/${courseFile}_questions.json`;
            const hierarchyJsonPath = `${folder}/${courseFile}_hierarchy.json`;
            
            const csvUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${csvPath}`;
            const getRes = await fetch(csvUrl + `?ref=${branch}`, { headers: { "Authorization": `Bearer ${token}` } });
            if (!getRes.ok) throw new Error(`Failed to fetch ${csvPath}.`);
            
            const getJson = await getRes.json();
            const blobUrl = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${getJson.sha}`;
            const blobRes = await fetch(blobUrl, { headers: { "Authorization": `Bearer ${token}` } });
            
            const cleanCsvText = Base64.decode((await blobRes.json()).content).replace(/^\uFEFF/, '');
            let rows = Papa.parse(cleanCsvText, { header: true, skipEmptyLines: true }).data;

            editsByCourse[courseFile].rows.forEach(updatedRow => {
                const qId = updatedRow["QuestionID"];
                const actualIdKey = Object.keys(rows[0] || {}).find(k => k.toLowerCase().replace(/\s/g, '') === 'questionid' || k.toLowerCase() === 'id') || "QuestionID";
                
                let qIndex = rows.findIndex(r => String(r[actualIdKey]).trim() === String(qId).trim() && String(qId).trim() !== "");
                
                if (qIndex !== -1) {
                    const targetRow = rows[qIndex];
                    Object.keys(updatedRow).forEach(newKey => {
                        const originalKey = Object.keys(targetRow).find(k => k.toLowerCase().replace(/\s/g, '') === newKey.toLowerCase().replace(/\s/g, ''));
                        targetRow[originalKey || newKey] = updatedRow[newKey];
                    });
                } else {
                    rows.push(updatedRow);
                }
            });

            let outQs = [];
            let subTree = {}, sysTree = {}, exTree = {};

            rows.forEach(row => {
                const getVal = (names) => {
                    const key = Object.keys(row).find(k => names.includes(k.toLowerCase().replace(/\s/g, '')));
                    return key && row[key] ? String(row[key]).trim() : "";
                };

                const qId = getVal(['questionid', 'id']);
                if (!qId) return;

                const subject = getVal(['subject']); const chapter = getVal(['chapter']); const topic = getVal(['topic']);
                const year = getVal(['year']); const rawExams = getVal(['exams', 'exam']);
                const examsList = rawExams ? rawExams.split(',').map(e => e.trim()).filter(e => e) : [];

                let qObj = {
                    id: qId, year: year, exams: examsList, subject: subject, chapter: chapter, topic: topic,
                    difficulty: getVal(['difficulty']), question: getVal(['question']),
                    options: { A: getVal(['optiona']), B: getVal(['optionb']), C: getVal(['optionc']), D: getVal(['optiond']), E: getVal(['optione']) },
                    correctAnswer: getVal(['correctanswer']).toUpperCase(), explanation: getVal(['explanation']), hint: getVal(['hint'])
                };

                if (isBook) { qObj.isBookQuestion = true; qObj.bookName = courseFile; }
                outQs.push(qObj);

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

            const commitMsg = `Admin Panel: Updated live database via Web Compiler`;
            await uploadFileToGitHub(csvPath, Papa.unparse(rows), commitMsg);
            await uploadFileToGitHub(questionsJsonPath, JSON.stringify(outQs, null, 4), commitMsg);
            await uploadFileToGitHub(hierarchyJsonPath, JSON.stringify({ subjects: subTree, systems: sysTree, exams: exTree }, null, 4), commitMsg);
        }

        localStorage.removeItem('edeetos_pending_edits');
        updatePendingCount();
        alert(`✅ Successfully generated new JSON and pushed to GitHub! Changes are live immediately.`);
        
    } catch (error) {
        console.error(error);
        alert("❌ Push Failed: " + error.message);
    } finally {
        btn.innerHTML = origHtml;
        btn.disabled = false;
    }
};

// === 3. USERS ===
const usersListEl = document.getElementById('users-list');
const userCountEl = document.getElementById('user-count');

async function fetchAllUsers() {
    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        allUsersData = [];
        querySnapshot.forEach((doc) => { let data = doc.data(); data.uid = doc.id; allUsersData.push(data); });
        
        const rolePriority = { 'MANAGEMENT': 1, 'ADMIN': 1, 'MENTOR': 2, 'STUDENT': 3 };
        allUsersData.sort((a, b) => {
            const roleA = (a.role || 'STUDENT').toUpperCase();
            const roleB = (b.role || 'STUDENT').toUpperCase();
            return (rolePriority[roleA] || 3) - (rolePriority[roleB] || 3);
        });

        if(userCountEl) userCountEl.textContent = allUsersData.length;
        renderUsers(allUsersData);
    } catch (e) { usersListEl.innerHTML = '<p style="color:red; text-align: center;">Error loading users.</p>'; }
}

function renderUsers(arr) {
    usersListEl.innerHTML = '';
    if (arr.length === 0) return usersListEl.innerHTML = '<p style="text-align: center; color: #94a3b8; padding: 2rem;">No matching users.</p>';

    arr.forEach(user => {
        const role = (user.role || 'STUDENT').toUpperCase();
        let roleHtml = `<span class="badge b-student">Student</span>`;
        if (user.isBanned || role === 'BANNED') roleHtml = `<span class="badge" style="background:#fee2e2; color:#ef4444;">Banned</span>`;
        else if (role === 'MANAGEMENT' || role === 'ADMIN') roleHtml = `<span class="badge b-admin">Admin</span>`;
        else if (role === 'MENTOR') roleHtml = `<span class="badge b-mentor">Mentor</span>`;
        
        let coursesHtml = '';
        if (user.subscriptions) {
            Object.keys(user.subscriptions).forEach(courseKey => {
                const expiry = user.subscriptions[courseKey];
                let expiryText = expiry === "lifetime" ? "Lifetime" : new Date(expiry).toLocaleDateString();
                const displayName = mergedNamesMap[courseKey] || courseKey.toUpperCase();
                coursesHtml += `<span class="badge b-course">${displayName}</span> <span class="badge b-time">${expiryText}</span> `;
            });
        }

        const card = document.createElement('div');
        card.style = "display: flex; justify-content: space-between; align-items: center; padding: 1.2rem 0; border-bottom: 1px solid #e2e8f0;";
        card.innerHTML = `
            <div style="flex-grow: 1;">
                <div style="font-weight: 800; color: #1e293b; font-size: 1.1rem; margin-bottom: 4px;">${user.fullName || "Unnamed User"}</div>
                <div style="font-size: 0.85rem; color: #64748b; margin-bottom: 8px;">${user.email} | ${user.phone || 'No Phone'}</div>
                <div style="display: flex; gap: 5px; flex-wrap: wrap; align-items: center;">${roleHtml} ${coursesHtml}</div>
            </div>
            <button class="btn-outline btn-edit-user">Edit / Grant</button>
        `;
        card.querySelector('.btn-edit-user').onclick = () => openEditModal(user);
        usersListEl.appendChild(card);
    });
}

document.getElementById('admin-search-btn').onclick = () => {
    const query = document.getElementById('admin-search-input').value.toLowerCase().trim();
    if (!query) return renderUsers(allUsersData);
    renderUsers(allUsersData.filter(u => (u.fullName||"").toLowerCase().includes(query) || (u.email||"").toLowerCase().includes(query) || u.uid.toLowerCase().includes(query)));
};

// USER EDITING MODAL
const editModal = document.getElementById('edit-user-modal');
document.getElementById('btn-close-edit-modal').onclick = () => editModal.style.display = 'none';

let editingUser = null;
function openEditModal(user) {
    editingUser = user;
    document.getElementById('edit-user-name').textContent = user.fullName || "Unnamed User";
    document.getElementById('edit-user-email').textContent = user.email || "No Email";
    document.getElementById('edit-user-phone').textContent = user.phone || "No Phone";
    document.getElementById('edit-user-uid').textContent = `ID: ${user.uid}`;
    
    const banBtn = document.getElementById('btn-ban-user');
    const unbanBtn = document.getElementById('btn-unban-user');
    const makeStudentBtn = document.getElementById('btn-make-student');
    const makeMentorBtn = document.getElementById('btn-make-mentor');
    const makeAdminBtn = document.getElementById('btn-make-admin');
    const hardDelBtn = document.getElementById('btn-hard-delete-user');

    const isSuperAdmin = user.uid === 'KpNtNoeNVveHO9Ga2Kc9dxuhvZp2';
    const isSelf = auth.currentUser && user.uid === auth.currentUser.uid;

    if (isSuperAdmin || isSelf) {
        [banBtn, unbanBtn, makeStudentBtn, makeMentorBtn, makeAdminBtn, hardDelBtn].forEach(b => { if(b) b.style.display = 'none'; });
    } else {
        makeStudentBtn.style.display = 'block'; makeMentorBtn.style.display = 'block'; makeAdminBtn.style.display = 'block'; hardDelBtn.style.display = 'block';
        if (user.isBanned || user.role === 'BANNED') { banBtn.style.display = 'none'; unbanBtn.style.display = 'block'; } 
        else { banBtn.style.display = 'block'; unbanBtn.style.display = 'none'; }
    }
    
    renderSubscriptions();
    editModal.style.display = 'flex';
}

document.getElementById('btn-make-student').onclick = () => changeUserRole('STUDENT');
document.getElementById('btn-make-mentor').onclick = () => changeUserRole('MENTOR');
document.getElementById('btn-make-admin').onclick = () => changeUserRole('MANAGEMENT');

async function changeUserRole(newRole) {
    if(confirm(`Change this user's role to ${newRole}?`)) {
        await updateDoc(doc(db, "users", editingUser.uid), { role: newRole });
        editingUser.role = newRole; alert(`Role updated to ${newRole}.`); fetchAllUsers();
    }
}

document.getElementById('btn-ban-user').onclick = async () => {
    if (confirm(`🚨 BAN this user?`)) {
        await updateDoc(doc(db, "users", editingUser.uid), { role: 'BANNED', isBanned: true });
        alert("User banned."); editModal.style.display = 'none'; fetchAllUsers();
    }
};
document.getElementById('btn-unban-user').onclick = async () => {
    if (confirm(`✅ UNBAN this user?`)) {
        await updateDoc(doc(db, "users", editingUser.uid), { role: 'STUDENT', isBanned: false });
        alert("User unbanned."); editModal.style.display = 'none'; fetchAllUsers();
    }
};

document.getElementById('btn-hard-delete-user').onclick = async () => {
    const confirmText = prompt(`Type DELETE to permanently erase ${editingUser.email} from Firestore. This cannot be undone.`);
    if (confirmText === 'DELETE') {
        try {
            await deleteDoc(doc(db, "users", editingUser.uid));
            alert("User document permanently deleted from Firestore.");
            editModal.style.display = 'none';
            fetchAllUsers();
        } catch(e) {
            alert("Error deleting user: " + e.message);
        }
    } else if (confirmText !== null) {
        alert("Deletion cancelled. Text did not match.");
    }
};

document.getElementById('btn-wipe-progress').onclick = async () => {
    const confirmText = prompt(`Type WIPE to delete ALL study progress (Mistakes, Bookmarks, Exam History) for ${editingUser.email}.`);
    if (confirmText === 'WIPE') {
        try {
            const uRef = doc(db, "users", editingUser.uid);
            const snap = await getDoc(uRef);
            if(!snap.exists()) return;
            const data = snap.data();
            
            let updates = {};
            const standardCourses = ['fcps_part1', 'fcps_part2', 'fcps_imm', 'mrcs_part1', 'mrcs_part2', 'mbbs_year1', 'mbbs_year2', 'mbbs_year3', 'mbbs_year4', 'mbbs_year5', 'books'];
            
            standardCourses.forEach(c => {
                if(data[c]) {
                    updates[`${c}.solvedQuestions`] = [];
                    updates[`${c}.mistakes`] = [];
                    updates[`${c}.examMistakes`] = [];
                    updates[`${c}.bookmarks`] = [];
                    updates[`${c}.examHistory`] = [];
                    updates[`${c}.revisions`] = {};
                }
            });

            if(Object.keys(updates).length > 0) {
                await updateDoc(uRef, updates);
                alert("Progress successfully wiped.");
            } else {
                alert("User has no progress to wipe.");
            }
        } catch(e) {
            alert("Error wiping progress: " + e.message);
        }
    } else if (confirmText !== null) {
        alert("Wipe cancelled. Text did not match.");
    }
};

function renderSubscriptions() {
    const subsListEl = document.getElementById('user-subscriptions-list');
    subsListEl.innerHTML = '';
    if (!editingUser.subscriptions || Object.keys(editingUser.subscriptions).length === 0) {
        subsListEl.innerHTML = '<p style="font-size: 0.9rem; color: #94a3b8;">No active subscriptions.</p>'; return;
    }

    Object.keys(editingUser.subscriptions).forEach(courseKey => {
        const expiry = editingUser.subscriptions[courseKey];
        const isExpired = (expiry !== "lifetime" && new Date(expiry) < new Date());
        const expiryText = expiry === "lifetime" ? "Lifetime Access" : new Date(expiry).toLocaleDateString();
        const displayName = mergedNamesMap[courseKey] || courseKey.toUpperCase();

        const box = document.createElement('div');
        box.className = `subs-box ${isExpired ? '' : 'active-sub'}`;
        box.innerHTML = `
            <div><strong style="color:#1e293b;">${displayName}</strong><br><small style="color:#64748b;">${isExpired ? 'Expired' : 'Active till ' + expiryText}</small></div>
            <button class="btn-action-del"><i class="fas fa-trash-alt"></i></button>
        `;
        box.querySelector('.btn-action-del').onclick = async () => {
            if(confirm(`Remove access to ${displayName}?`)) {
                let newSubs = { ...editingUser.subscriptions }; delete newSubs[courseKey];
                await updateDoc(doc(db, "users", editingUser.uid), { subscriptions: newSubs });
                editingUser.subscriptions = newSubs; renderSubscriptions(); fetchAllUsers();
            }
        };
        subsListEl.appendChild(box);
    });
}

window.grantAccess = async function() {
    const course = document.getElementById('grant-course').value;
    const days = document.getElementById('grant-duration').value;
    let expiry = "lifetime";
    if (days !== "lifetime") { const d = new Date(); d.setDate(d.getDate() + parseInt(days)); expiry = d.toISOString(); }
    
    let subs = editingUser.subscriptions || {};
    subs[course] = expiry;
    await updateDoc(doc(db, "users", editingUser.uid), { subscriptions: subs, isPremium: true });
    editingUser.subscriptions = subs; renderSubscriptions(); fetchAllUsers();
};


// === 4. STUDY ROOMS ===
let unsubRooms = null;
function fetchStudyRooms() {
    if(unsubRooms) return;
    unsubRooms = onSnapshot(collection(db, "study_rooms"), (snap) => {
        const list = document.getElementById('studyrooms-list');
        if(!list) return;
        list.innerHTML = '';
        if(snap.empty) return list.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 2rem; color: #94a3b8;">No active rooms.</td></tr>';
        
        snap.forEach(d => {
            const data = d.data();
            const hostName = getUserName(data.hostId);
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${d.id}</strong></td>
                <td>${courseNamesMap[data.course] || data.course || 'Unknown'}</td>
                <td>${hostName}</td>
                <td><span class="badge ${data.status === 'ended' ? 'b-student' : 'b-admin'}">${data.status}</span></td>
                <td>
                    <button class="btn-action-del btn-end-room" ${data.status === 'ended' ? 'disabled style="opacity:0.5;"' : ''}>End</button>
                    <button class="btn-action-del btn-del-room" style="color: #64748b; border-color: #cbd5e1; margin-left: 5px;"><i class="fas fa-trash"></i></button>
                </td>
            `;
            tr.querySelector('.btn-end-room').onclick = () => updateDoc(doc(db, "study_rooms", d.id), { status: 'ended' });
            tr.querySelector('.btn-del-room').onclick = () => { if(confirm("Delete room completely?")) deleteDoc(doc(db, "study_rooms", d.id)); };
            list.appendChild(tr);
        });
    });
}

// === 5. FRIEND CHALLENGES ===
let unsubChal = null;
function fetchFriendChallenges() {
    if(unsubChal) return;
    unsubChal = onSnapshot(collection(db, "friend_challenges"), (snap) => {
        const list = document.getElementById('challenges-list');
        if(!list) return;
        list.innerHTML = '';
        if(snap.empty) return list.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 2rem; color: #94a3b8;">No challenges found.</td></tr>';
        
        snap.forEach(d => {
            const data = d.data();
            const attempts = data.attemptedBy ? data.attemptedBy.length : (data.attempts || 0);
            const examDetails = `${data.total || '?'} Qs (${data.calcMinutes || '?'} Min)`;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${d.id}</strong></td>
                <td>${data.hostName}</td>
                <td><span style="background: #f1f5f9; padding: 4px 8px; border-radius: 6px; font-size: 0.85rem;">${examDetails}</span></td>
                <td><span class="badge b-course">${attempts} Attempt(s)</span></td>
                <td>${data.score} / ${data.total}</td>
                <td><button class="btn-action-del btn-del-chal">Delete</button></td>
            `;
            tr.querySelector('.btn-del-chal').onclick = () => { if(confirm("Delete challenge?")) deleteDoc(doc(db, "friend_challenges", d.id)); };
            list.appendChild(tr);
        });
    });
}

// === 6. ASSIGNED EXAMS (PULLS REAL-TIME SCORE FROM STUDENT HISTORY) ===
let unsubExams = null;
function fetchAssignedExams() {
    if(unsubExams) return;
    unsubExams = onSnapshot(collection(db, "assigned_exams"), (snap) => {
        const list = document.getElementById('assigned-list');
        if(!list) return;
        list.innerHTML = '';
        if(snap.empty) return list.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 2rem; color: #94a3b8;">No assigned exams.</td></tr>';
        
        snap.forEach(d => {
            const data = d.data();
            const dateStr = data.createdAt ? data.createdAt.toDate().toLocaleDateString() : 'N/A';
            
            // Build the student completion list and map scores dynamically
            let studentsHtml = '';
            (data.assignedTo || []).forEach(uid => {
                const sName = getUserName(uid);
                const isDone = (data.isCompletedBy || []).includes(uid);
                let scoreText = `<span style="color:#f59e0b; font-weight:bold; font-size:0.75rem;">Pending</span>`;
                
                if (isDone) {
                    let foundScore = null;
                    const sDoc = allUsersData.find(u => u.uid === uid);
                    if (sDoc) {
                        const allHist = [];
                        Object.keys(sDoc).forEach(k => {
                            if (sDoc[k] && sDoc[k].examHistory) allHist.push(...sDoc[k].examHistory);
                        });
                        // Match the exam exactly by title
                        const match = allHist.reverse().find(ex => ex.examName === data.title);
                        if (match) foundScore = `${match.percentage}% (${match.score}/${match.totalQuestions})`;
                    }
                    scoreText = `<span style="color:#10b981; font-weight:bold; font-size:0.75rem;">Done ${foundScore ? '- ' + foundScore : ''}</span>`;
                }
                studentsHtml += `<div style="margin-bottom: 4px; display:flex; justify-content:space-between; align-items:center; background:#f8fafc; padding:4px 8px; border-radius:6px; border:1px solid #e2e8f0; font-size:0.85rem;"><span>${sName}</span> ${scoreText}</div>`;
            });

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${data.title}</strong><div style="font-size:0.8rem; color:#64748b; margin-top:4px;">${data.questions?.length || 0} Qs | ${data.timerMinutes} Min</div></td>
                <td>${getUserName(data.assignedBy)}</td>
                <td style="min-width: 250px;">${studentsHtml || '<span style="color:#94a3b8;">No students</span>'}</td>
                <td>${dateStr}</td>
                <td><button class="btn-action-del btn-del-exam">Delete</button></td>
            `;
            tr.querySelector('.btn-del-exam').onclick = () => { if(confirm("Delete exam assignment?")) deleteDoc(doc(db, "assigned_exams", d.id)); };
            list.appendChild(tr);
        });
    });
}

// === 7. REWARD CLAIMS (GOD MODE PROCESSOR) ===
let unsubRewards = null;
function fetchRewardClaims() {
    if(unsubRewards) return;
    unsubRewards = onSnapshot(collection(db, "reward_claims"), (snap) => {
        const list = document.getElementById('rewards-list');
        if(!list) return;
        list.innerHTML = '';
        let hasClaims = false;
        
        snap.forEach(d => {
            const data = d.data();
            if(data.status !== 'pending') return;
            hasClaims = true;
            
            const card = document.createElement('div');
            card.className = "action-card";
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; margin-bottom: 10px;">
                    <strong>${data.userEmail || data.userId}</strong>
                    <span class="badge b-mentor">${data.rewardTitle || 'Reward'}</span>
                </div>
                <p style="color:#475569; font-size:0.9rem;">Requested Item: <strong>${mergedNamesMap[data.requestedItem] || data.requestedItem}</strong></p>
                <div style="display:flex; gap:10px; margin-top: 15px;">
                    <button class="btn-solid btn-approve-claim">Approve & Grant Access</button>
                    <button class="btn-outline btn-reject-claim" style="border-color:#ef4444; color:#ef4444;">Reject / Delete</button>
                </div>
            `;
            card.querySelector('.btn-approve-claim').onclick = async () => {
                const btn = card.querySelector('.btn-approve-claim');
                btn.textContent = "Processing..."; btn.disabled = true;
                try {
                    const uRef = doc(db, "users", data.userId);
                    const uSnap = await getDoc(uRef);
                    if(uSnap.exists()) {
                        let subs = uSnap.data().subscriptions || {};
                        let days = prompt(`Approve access to ${data.requestedItem}? Enter number of days (or 'lifetime'):`, "30");
                        if(days) {
                            let expiry = "lifetime";
                            if(days !== "lifetime") {
                                const dt = new Date(); dt.setDate(dt.getDate() + parseInt(days));
                                expiry = dt.toISOString();
                            }
                            subs[data.requestedItem] = expiry;
                            await updateDoc(uRef, { subscriptions: subs, isPremium: true });
                            await updateDoc(doc(db, "reward_claims", d.id), { status: 'approved' });
                            alert("Claim approved and access granted.");
                        } else {
                            btn.textContent = "Approve & Grant Access"; btn.disabled = false;
                        }
                    } else {
                        alert("User document not found.");
                        btn.textContent = "Approve & Grant Access"; btn.disabled = false;
                    }
                } catch(e) { 
                    alert("Error granting reward: " + e.message); 
                    btn.textContent = "Approve & Grant Access"; btn.disabled = false; 
                }
            };
            card.querySelector('.btn-reject-claim').onclick = async () => {
                if(confirm("Reject and delete this claim?")) {
                    await deleteDoc(doc(db, "reward_claims", d.id));
                }
            };
            list.appendChild(card);
        });
        if(!hasClaims) list.innerHTML = '<p style="text-align:center; color: #94a3b8; padding: 2rem;">No pending claims.</p>';
    });
}

// === 8. PAYMENTS ===
let unsubscribePayments = null;
const receiptModal = document.getElementById('receipt-modal');
if (document.getElementById('btn-close-receipt')) {
    document.getElementById('btn-close-receipt').onclick = () => receiptModal.style.display = 'none';
}

function fetchPayments() {
    const list = document.getElementById('payments-list');
    if(!list || unsubscribePayments) return;

    const durationIndexMap = { "1": 0, "7": 1, "15": 2, "30": 3, "90": 4, "180": 5, "365": 6, "lifetime": 7 };
    const baseCoursePrices = [100, 500, 800, 1200, 2500, 3500, 4500, 5000];
    const baseBookPrices = [20, 50, 80, 120, 250, 350, 450, 500];

    unsubscribePayments = onSnapshot(collection(db, "payment_requests"), (qSnap) => {
        list.innerHTML = '';
        let hasPending = false;
        
        qSnap.forEach(d => {
            const data = d.data();
            if(data.status !== 'pending') return;
            hasPending = true;

            const courseCount = (data.courses || []).length;
            const bookCount = (data.books || []).length;
            const durationIdx = durationIndexMap[data.durationDays] !== undefined ? durationIndexMap[data.durationDays] : 7;

            let bookDiscount = 0;
            if (bookCount >= 5) bookDiscount = 0.30;
            else if (bookCount >= 3) bookDiscount = 0.20;
            else if (bookCount >= 2) bookDiscount = 0.10;

            let expectedTotal = Math.round((courseCount > 0 ? baseCoursePrices[durationIdx] : 0) + ((bookCount * baseBookPrices[durationIdx]) * (1 - bookDiscount)));
            let originalTotal = expectedTotal;
            let promoHtml = '';

            if (data.appliedPromoCode && data.promoDiscountApplied > 0) {
                expectedTotal = Math.round(expectedTotal * (1 - (data.promoDiscountApplied / 100)));
                promoHtml = `<div style="background: #fdf2f8; border: 1px dashed #f472b6; color: #be185d; padding: 0.5rem; border-radius: 8px; font-size: 0.85rem; font-weight: 800; margin-top: 0.5rem; display: flex; justify-content: space-between;"><span>🎟️ Promo: ${data.appliedPromoCode}</span><span>-${data.promoDiscountApplied}%</span></div><div style="font-size: 0.75rem; color: #94a3b8; text-decoration: line-through; text-align: right; margin-top: 4px;">Original: Rs. ${originalTotal.toLocaleString()}</div>`;
            }

            const card = document.createElement('div');
            card.className = "action-card";
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px dashed #e2e8f0; padding-bottom: 1rem; margin-bottom: 1rem; flex-wrap: wrap; gap: 10px;">
                    <div style="font-weight: 800; color: #1e293b; font-size: 1.1rem;">${data.userEmail}</div>
                    <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                        ${(data.courses || []).map(c => `<span class="badge b-admin" style="background: #1e293b; color: white;">${c.replace('_', ' ').toUpperCase()}</span>`).join('')}
                        ${(data.books || []).map(b => `<span class="badge b-admin" style="background: #5b21b6; color: white;">${b.replace('_', ' ').toUpperCase()}</span>`).join('')}
                        <span class="badge b-course" style="background: #e0f2fe; color: #0369a1;">${data.planName}</span>
                    </div>
                </div>
                
                <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 1.2rem; margin-bottom: 1.5rem;">
                    <div style="font-size: 0.75rem; color: #64748b; font-weight: 800; text-transform: uppercase;">Expected Payment</div>
                    <div style="font-size: 1.8rem; font-weight: 800; color: #10b981;">Rs. ${expectedTotal.toLocaleString()}</div>
                    ${promoHtml}
                </div>

                ${data.receiptUrl ? `
                <div style="text-align: center; margin: 1.5rem 0;">
                    <img src="${data.receiptUrl}" style="width: 120px; height: 160px; object-fit: cover; border-radius: 12px; border: 2px solid #e2e8f0; box-shadow: 0 4px 10px rgba(0,0,0,0.1);" />
                    <div style="margin-top: 0.8rem;"><span class="view-receipt-trigger" style="color: #10b981; font-weight: 800; cursor: pointer;">🔍 View Receipt</span></div>
                </div>` : `<div style="margin-bottom: 1rem; font-size: 0.8rem; color: #ef4444; font-weight: bold;">No Receipt Attached</div>`}
                
                <div style="display: flex; gap: 1rem; align-items: center; background: #f8fafc; padding: 1.2rem; border-radius: 10px; border: 1px solid #e2e8f0; flex-wrap: wrap;">
                    <div style="flex: 1; min-width: 150px;">
                        <label style="font-size: 0.75rem; font-weight: 800; color: #64748b; text-transform: uppercase; margin-bottom: 0.5rem; display: block;">Approve Duration:</label>
                        <select class="approve-duration" style="width: 100%; padding: 0.8rem; border: 2px solid #cbd5e1; border-radius: 8px; font-weight: bold; outline: none;">
                            <option value="${data.durationDays}">${data.planName} (Requested)</option>
                            <option value="30">1 Month</option><option value="365">1 Year</option><option value="lifetime">Lifetime</option>
                        </select>
                    </div>
                    <div style="display: flex; gap: 10px; flex: 1; min-width: 200px;">
                        <button class="btn-solid btn-approve" style="flex: 1; margin-top: 1.4rem;">Approve</button>
                        <button class="btn-outline btn-reject" style="flex: 1; margin-top: 1.4rem; border-color: #ef4444; color: #ef4444;">Reject</button>
                    </div>
                </div>
            `;

            const viewTrigger = card.querySelector('.view-receipt-trigger');
            if (viewTrigger) {
                viewTrigger.onclick = () => { document.getElementById('receipt-modal-img').src = data.receiptUrl; receiptModal.style.display = 'flex'; };
            }

            card.querySelector('.btn-approve').onclick = async () => {
                try {
                    const dur = card.querySelector('.approve-duration').value;
                    const uRef = doc(db, "users", data.userId);
                    const uSnap = await getDoc(uRef);
                    if(!uSnap.exists()) return alert("User not found.");

                    let expiryValue = "lifetime";
                    if(dur !== "lifetime") { const dt = new Date(); dt.setDate(dt.getDate() + parseInt(dur)); expiryValue = dt.toISOString(); }

                    let currentSubs = uSnap.data().subscriptions || {};
                    (data.courses || []).forEach(c => currentSubs[c] = expiryValue);
                    (data.books || []).forEach(b => currentSubs[b] = expiryValue);

                    await updateDoc(uRef, { subscriptions: currentSubs, isPremium: true });
                    await updateDoc(doc(db, "payment_requests", d.id), { status: 'approved' });
                    alert("Payment approved!");
                } catch (e) { alert("Error approving payment"); }
            };

            card.querySelector('.btn-reject').onclick = async () => {
                if(confirm("Reject this payment?")) await updateDoc(doc(db, "payment_requests", d.id), { status: 'rejected' });
            };

            list.appendChild(card);
        });

        if(!hasPending) list.innerHTML = '<p style="text-align: center; color: #94a3b8; padding: 2rem;">No pending payment requests.</p>';
    });
}

// === 9. KEYS ===
window.generateKey = async function() {
    const btn = document.getElementById('btn-generate-key');
    btn.textContent = "Generating..."; btn.disabled = true;

    const course = document.getElementById('key-course').value;
    const duration = document.getElementById('key-duration').value;
    const usage = parseInt(document.getElementById('key-usage').value) || 1;
    const expiry = document.getElementById('key-expiry').value;
    let customCode = document.getElementById('key-custom').value.trim().toUpperCase();
    const selectedBooks = Array.from(document.querySelectorAll('.key-book-check:checked')).map(cb => cb.value);

    if(!customCode) customCode = "KEY-" + Math.random().toString(36).substring(2, 8).toUpperCase();

    try {
        await setDoc(doc(db, "keys", customCode), {
            code: customCode, course: course, books: selectedBooks, duration: duration, 
            maxUsage: usage, usedCount: 0, expiryDate: expiry || null, createdAt: new Date().toISOString()
        });
        alert("Key Generated: " + customCode);
        document.getElementById('key-custom').value = '';
        document.querySelectorAll('.key-book-check').forEach(cb => cb.checked = false); 
        fetchKeys();
    } catch(e) { alert("Error generating key."); } 
    finally { btn.textContent = "Generate Key"; btn.disabled = false; }
};

async function fetchKeys() {
    const qSnap = await getDocs(collection(db, "keys"));
    const tbody = document.getElementById('keys-table-body');
    if(!tbody) return; tbody.innerHTML = '';
    
    qSnap.forEach(d => {
        const data = d.data();
        const tr = document.createElement('tr');
        let booksHtml = (data.books && data.books.length > 0) ? `<div style="font-size: 0.75rem; color: #64748b; margin-top: 4px;">+ Books: ${data.books.map(b => mergedNamesMap[b] || b).join(', ')}</div>` : '';
        tr.innerHTML = `
            <td><strong>${data.code}</strong></td>
            <td><span class="badge b-course">${mergedNamesMap[data.course] || data.course}</span>${booksHtml}</td>
            <td>${data.usedCount} / ${data.maxUsage}</td>
            <td><button class="btn-action-del" onclick="deleteDoc(doc(db, 'keys', '${data.code}')); this.closest('tr').remove();">Delete</button></td>
        `;
        tbody.appendChild(tr);
    });
}

// === 10. PROMOS ===
window.generatePromo = async function() {
    const code = document.getElementById('promo-code').value.trim().toUpperCase();
    const discount = parseInt(document.getElementById('promo-discount').value);
    const expiry = document.getElementById('promo-expiry').value;

    if (!code || isNaN(discount) || discount <= 0 || discount > 100) return alert("Enter valid code and discount %.");

    await setDoc(doc(db, "promo_codes", code), { code: code, discountPercentage: discount, isActive: true, expiryDate: expiry || null, createdAt: new Date().toISOString() });
    alert("Promo Created: " + code);
    document.getElementById('promo-code').value = ''; document.getElementById('promo-discount').value = '';
};

let unsubPromos = null;
window.fetchPromos = async function() {
    if (unsubPromos) return;
    unsubPromos = onSnapshot(collection(db, "promo_codes"), (qSnap) => {
        const tbody = document.getElementById('promos-table-body');
        if(!tbody) return; tbody.innerHTML = '';
        if(qSnap.empty) return tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 2rem; color: #94a3b8;">No promos found.</td></tr>';
        
        qSnap.forEach(d => {
            const data = d.data();
            const isExpired = (data.expiryDate && new Date(data.expiryDate) < new Date());
            const statusBadge = data.isActive && !isExpired ? `<span class="badge" style="background:#dcfce7; color:#166534;">Active</span>` : `<span class="badge" style="background:#fee2e2; color:#991b1b;">${isExpired?'Expired':'Inactive'}</span>`;
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${data.code}</strong></td>
                <td><strong style="color:#10b981;">${data.discountPercentage}% OFF</strong></td>
                <td>${statusBadge} <small style="color:#64748b; display:block;">Exp: ${data.expiryDate ? new Date(data.expiryDate).toLocaleDateString() : 'None'}</small></td>
                <td>
                    <button class="btn-action-del btn-toggle" style="border-color:#f59e0b; color:#f59e0b;"><i class="fas fa-power-off"></i></button>
                    <button class="btn-action-del btn-del"><i class="fas fa-trash-alt"></i></button>
                </td>
            `;
            tr.querySelector('.btn-toggle').onclick = () => updateDoc(doc(db, "promo_codes", data.code), { isActive: !data.isActive });
            tr.querySelector('.btn-del').onclick = () => { if(confirm("Delete promo?")) deleteDoc(doc(db, "promo_codes", data.code)); };
            tbody.appendChild(tr);
        });
    });
};

// === 11. COURSE CHANGE REQUESTS ===
let unsubReqs = null;
async function fetchRequests() {
    if (unsubReqs) return;
    unsubReqs = onSnapshot(query(collection(db, "users"), where("courseChangeRequested", "==", true)), (qSnap) => {
        const list = document.getElementById('requests-list');
        if(!list) return; list.innerHTML = '';
        if(qSnap.empty) return list.innerHTML = '<p style="text-align:center; color:#94a3b8; padding: 2rem;">No requests.</p>';
        
        qSnap.forEach(d => {
            const data = d.data();
            const card = document.createElement('div');
            card.className = 'action-card';
            card.innerHTML = `
                <div style="font-weight: 800; font-size: 1.1rem;">${data.fullName} <span style="font-size:0.85rem; color:#64748b; font-weight:normal;">(${data.email})</span></div>
                <div style="margin: 15px 0; background: #f8fafc; padding: 10px; border-radius: 8px;">
                    <span style="color:#ef4444; font-weight:bold;">${courseNamesMap[data.selectedCourse] || data.selectedCourse || 'None'}</span> 
                    <i class="fas fa-arrow-right" style="margin: 0 10px; color:#cbd5e1;"></i> 
                    <span style="color:#10b981; font-weight:bold;">${courseNamesMap[data.requestedCourse] || data.requestedCourse}</span>
                </div>
                <div style="display:flex; gap:10px;">
                    <button class="btn-solid btn-app">Approve</button>
                    <button class="btn-outline btn-rej" style="border-color:#ef4444; color:#ef4444;">Reject</button>
                </div>
            `;
            card.querySelector('.btn-app').onclick = () => updateDoc(doc(db, "users", d.id), { selectedCourse: data.requestedCourse, courseChangeRequested: false, requestedCourse: null });
            card.querySelector('.btn-rej').onclick = () => updateDoc(doc(db, "users", d.id), { courseChangeRequested: false, requestedCourse: null });
            list.appendChild(card);
        });
    });
}

// === 12. REPORTS (GOD MODE SOLVER) ===
let unsubReps = null;
async function fetchReports() {
    if (unsubReps) return; 
    unsubReps = onSnapshot(collection(db, "reported_questions"), (qSnap) => {
        const list = document.getElementById('reports-list');
        if(!list) return; list.innerHTML = '';
        let hasReports = false;
        
        qSnap.forEach(d => {
            const data = d.data();
            
            if(data.status === 'resolved') return;
            hasReports = true;

            const card = document.createElement('div');
            card.className = 'action-card';
            card.style.borderLeft = "4px solid #ef4444";
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                    <strong>Q-ID: <span style="color:#ef4444;">${data.questionId}</span></strong>
                    <span style="color:#94a3b8; font-size:0.8rem;">${data.timestamp ? data.timestamp.toDate().toLocaleDateString() : ''}</span>
                </div>
                <div style="background:#f8fafc; padding:10px; border-radius:6px; font-size:0.9rem; color:#475569; font-style:italic; margin-bottom:10px;">${data.questionText}</div>
                <p style="color:#1e293b; font-size:0.95rem;"><strong>Reason:</strong> ${data.reason}</p>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:15px; border-top:1px solid #e2e8f0; padding-top:10px;">
                    <small style="color:#64748b;">By: ${data.userEmail}</small>
                    <button class="btn-outline btn-res" style="border-color:#10b981; color:#10b981; padding:0.4rem 1rem;"><i class="fas fa-check"></i> Mark Solved</button>
                </div>
            `;
            card.querySelector('.btn-res').onclick = async () => { 
                if(confirm("Are you sure this issue is fixed?")) {
                    await updateDoc(doc(db, "reported_questions", d.id), {
                        status: 'resolved',
                        resolvedAt: new Date().toISOString()
                    });
                }
            };
            list.appendChild(card);
        });

        if(!hasReports) list.innerHTML = '<p style="text-align:center; color:#94a3b8; padding: 2rem;">No pending reported questions.</p>';
    });
}

// === 13. MESSAGES ===
let unsubMsgs = null;
async function fetchMessages() {
    if (unsubMsgs) return; 
    unsubMsgs = onSnapshot(collection(db, "contact_messages"), (qSnap) => {
        const list = document.getElementById('messages-list');
        if(!list) return; list.innerHTML = '';
        if(qSnap.empty) return list.innerHTML = '<p style="text-align:center; color:#94a3b8; padding: 2rem;">No messages.</p>';
        
        qSnap.forEach(d => {
            const data = d.data();
            const cleanWhatsapp = data.whatsapp ? data.whatsapp.replace(/[^0-9]/g, '') : '';
            const card = document.createElement('div');
            card.className = 'action-card';
            card.style.borderLeft = "4px solid #3b82f6";
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                    <strong>${data.name}</strong> <span style="color:#94a3b8; font-size:0.8rem;">${data.timestamp ? new Date(data.timestamp).toLocaleDateString() : ''}</span>
                </div>
                <div style="font-size:0.85rem; color:#3b82f6; margin-bottom:15px;">
                    <a href="mailto:${data.email}" style="color:#3b82f6; text-decoration:none; margin-right:15px;">📧 ${data.email}</a>
                    ${data.whatsapp ? `<a href="https://wa.me/${cleanWhatsapp}" target="_blank" style="color:#10b981; text-decoration:none;">💬 ${data.whatsapp}</a>` : ''}
                </div>
                <div style="background:#f8fafc; padding:15px; border-radius:8px; color:#334155; line-height:1.6; margin-bottom:15px; white-space: pre-wrap;">${data.message}</div>
                <button class="btn-action-del" onclick="deleteDoc(doc(db, 'contact_messages', '${d.id}'));"><i class="fas fa-trash"></i> Delete</button>
            `;
            list.appendChild(card);
        });
    });
}