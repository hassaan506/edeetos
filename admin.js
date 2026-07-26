// === FEATURE: FIREBASE IMPORTS ===
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { collection, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth, db, courseNamesMap, mergedNamesMap } from './firebase-config.js';

// === FEATURE: ADMIN AUTHENTICATION & INITIALIZATION ===
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const userRef = doc(db, "users", user.uid);
            const docSnap = await getDoc(userRef);
            
            const role = docSnap.exists() ? (docSnap.data().role || '').toUpperCase() : '';
            if (role !== 'MANAGEMENT' && role !== 'ADMIN') {
                alert("Unauthorized Access."); window.location.href = 'dashboard.html'; return;
            }

            const qChats = query(collection(db, "chats"), where("status", "==", "pending"));
            onSnapshot(qChats, (snapshot) => {
                snapshot.docChanges().forEach((change) => {
                    if (change.type === "added") {
                        const data = change.doc.data();
                        alert(`🚨 EDEETOS ALERT: Incoming Mentor Request from ${data.studentName}! Please open the Mentorship Hub to accept the chat.`);
                    }
                });
            });

            fetchAllUsers();
            calculateTotalQuestions();
        } catch (error) {
            console.error("Admin Panel Auth Init Error:", error);
            alert("Database permission error. Firebase is blocking your access to the users database. Error: " + error.message);
            fetchAllUsers(); calculateTotalQuestions();
        }
    } else {
        window.location.href = 'index.html';
    }
});

const btnExit = document.getElementById('btn-exit-admin');
if(btnExit) btnExit.addEventListener('click', () => { window.location.href = 'dashboard.html'; });

// === FEATURE: DYNAMIC QUESTION COUNTER ===
async function calculateTotalQuestions() {
    const standardCourses = ['fcps_part1', 'fcps_part2', 'fcps_imm', 'mrcs_part1', 'mrcs_part2', 'mbbs_year1', 'mbbs_year2', 'mbbs_year3', 'mbbs_year4', 'mbbs_year5'];
    const referenceBooks = [
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

    let totalQuestions = 0;
    
    let breakdownHtml = `
        <div style="font-size: 0.8rem; font-weight: 800; color: #64748b; text-transform: uppercase; margin-bottom: 8px;">Core Courses</div>
        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
    `;

    async function fetchAndCount(path, displayTitle, badgeColor, textColor) {
        try {
            const response = await fetch(path, { cache: 'no-cache' });
            if (response.ok) {
                const data = await response.json();
                if (Array.isArray(data) && data.length > 0) {
                    const count = data.length;
                    totalQuestions += count;
                    breakdownHtml += `<span style="background: ${badgeColor}; color: ${textColor}; padding: 6px 12px; border-radius: 8px; font-size: 0.85rem; font-weight: bold; border: 1px solid rgba(0,0,0,0.05); display: inline-flex; align-items: center; gap: 8px; white-space: nowrap;">${displayTitle} <span style="background: rgba(255,255,255,0.6); color: #0f172a; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem;">${count} Qs</span></span>`;
                }
            }
        } catch (e) {}
    }

    for (const course of standardCourses) await fetchAndCount(`Data/${course}_questions.json`, courseNamesMap[course], '#f1f5f9', '#334155');
    
    breakdownHtml += `</div><div style="margin: 20px 0 8px 0; color: #8b5cf6; font-size: 0.8rem; font-weight: 800; text-transform: uppercase;"><i class="fas fa-book-open"></i> Reference Books</div><div style="display: flex; flex-wrap: wrap; gap: 8px;">`;
    
    for (const book of referenceBooks) await fetchAndCount(`Books/${book.file}_questions.json`, book.title, '#ede9fe', '#5b21b6');
    breakdownHtml += `</div>`;

    const totalEl = document.getElementById('total-q-count');
    if (totalEl) {
        totalEl.innerHTML = `<i class="fas fa-layer-group"></i> Total Qs: ${totalQuestions.toLocaleString()}`;
    }

    const breakdownBox = document.getElementById('database-breakdown-box');
    const breakdownContent = document.getElementById('database-breakdown-content');
    
    if (breakdownBox && breakdownContent) {
        breakdownBox.style.display = 'block';
        breakdownContent.innerHTML = breakdownHtml;
    }
}

// === FEATURE: UI NAVIGATION & TABS ===
window.switchView = function(viewName) {
    const views = ['view-users', 'view-keys', 'view-payments', 'view-reports', 'view-messages', 'view-requests', 'view-promos'];
    views.forEach(v => { const el = document.getElementById(v); if (el) el.style.display = 'none'; });
    
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    
    const targetView = document.getElementById(`view-${viewName}`);
    if (targetView) targetView.style.display = 'block';
    
    const activeTab = document.querySelector(`.admin-tab[onclick*="${viewName}"]`);
    if (activeTab) activeTab.classList.add('active');

    if(viewName === 'keys') fetchKeys();
    if(viewName === 'payments') fetchPayments();
    if(viewName === 'reports') fetchReports();
    if(viewName === 'messages') fetchMessages(); 
    if(viewName === 'requests') fetchRequests();
	if(viewName === 'promos') fetchPromos();	
};

// === FEATURE: USER MANAGEMENT & SEARCH ===
const usersListEl = document.getElementById('users-list');
const userCountEl = document.getElementById('user-count');
const searchInput = document.getElementById('admin-search-input');
const searchBtn = document.getElementById('admin-search-btn');
let allUsersData = [];

async function fetchAllUsers() {
    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        allUsersData = [];
        
        querySnapshot.forEach((doc) => {
            let data = doc.data(); 
            data.uid = doc.id; 
            allUsersData.push(data);
        });

        const rolePriority = { 'MANAGEMENT': 1, 'ADMIN': 1, 'MENTOR': 2, 'STUDENT': 3 };
        
        allUsersData.sort((a, b) => {
            const roleA = (a.role || 'STUDENT').toUpperCase();
            const roleB = (b.role || 'STUDENT').toUpperCase();
            return (rolePriority[roleA] || 3) - (rolePriority[roleB] || 3);
        });

        if(userCountEl) userCountEl.textContent = allUsersData.length;
        renderUsers(allUsersData);
    } catch (error) {
        if(usersListEl) usersListEl.innerHTML = '<p style="color: red; text-align: center;">Failed to load database.</p>';
    }
}

function renderUsers(usersArray) {
    if(!usersListEl) return;
    usersListEl.innerHTML = '';
    
    if (usersArray.length === 0) {
        usersListEl.innerHTML = '<p style="text-align: center; color: #64748b; padding: 2rem;">No matching users found.</p>';
        return;
    }

    usersArray.forEach(user => {
        const role = (user.role || 'STUDENT').toUpperCase();
        let roleHtml = '';
        if (user.isBanned || role === 'BANNED') roleHtml = `<span class="badge" style="background: #fee2e2; color: #ef4444; border: 1px solid #fca5a5;">Banned</span>`;
        else if (role === 'MANAGEMENT' || role === 'ADMIN') roleHtml = `<span class="badge b-admin">Admin</span>`;
        else if (role === 'MENTOR') roleHtml = `<span class="badge b-mentor">Mentor</span>`;
        else roleHtml = `<span class="badge b-student">Student</span>`;
        
        let coursesHtml = '';
        if (user.subscriptions) {
            Object.keys(user.subscriptions).forEach(courseKey => {
                const expiry = user.subscriptions[courseKey];
                let expiryText = "Lifetime";
                if (expiry !== "lifetime") {
                    const daysLeft = Math.ceil((new Date(expiry) - new Date()) / (1000 * 60 * 60 * 24));
                    expiryText = daysLeft > 0 ? `${daysLeft}d left` : 'Expired';
                }
                const displayName = mergedNamesMap[courseKey] || courseKey.replace('_', ' ').toUpperCase();
                coursesHtml += `<span class="badge b-course">${displayName}</span> <span class="badge b-time">${expiryText}</span> `;
            });
        }

        const userName = user.fullName || "Unknown User";
        const userEmail = user.email || "No Email";
        const userPhone = user.phone || "No Phone";

        const card = document.createElement('div');
        card.style = "display: flex; justify-content: space-between; align-items: center; padding: 1.2rem 0.5rem; border-bottom: 2px solid #f1f5f9;";
        card.innerHTML = `
            <div style="flex-grow: 1;">
                <div style="display: flex; flex-direction: column; margin-bottom: 0.5rem; gap: 0.2rem;">
                    <div style="font-weight: 800; color: #1e293b; font-size: 1.1rem;">${userName}</div>
                    <div style="display: flex; flex-wrap: wrap; font-size: 0.85rem; color: #64748b; font-weight: 600; gap: 0.5rem;">
                        <span style="white-space: nowrap;">📧 ${userEmail}</span><span style="color: #cbd5e1;">|</span><span style="white-space: nowrap;">📞 ${userPhone}</span>
                    </div>
                </div>
                <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;">${roleHtml} ${coursesHtml}</div>
            </div>
            <button class="btn-action-icon btn-edit-user"><i class="fas fa-cog"></i></button>
        `;
        card.querySelector('.btn-edit-user').addEventListener('click', () => openEditModal(user));
        usersListEl.appendChild(card);
    });
}

function executeSearch() {
    if(!searchInput) return;
    const query = searchInput.value.toLowerCase().trim();
    if (!query) { renderUsers(allUsersData); return; }
    
    const filtered = allUsersData.filter(u => {
        const nameMatch = (u.fullName || "").toLowerCase().includes(query);
        const emailMatch = (u.email || "").toLowerCase().includes(query);
        const phoneMatch = (u.phone || "").toLowerCase().includes(query);
        const uidMatch = u.uid.toLowerCase().includes(query);
        return nameMatch || emailMatch || phoneMatch || uidMatch;
    });
    renderUsers(filtered);
}

if(searchBtn) searchBtn.addEventListener('click', executeSearch);
if(searchInput) searchInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') executeSearch(); });

// === FEATURE: USER PROFILE EDITING & ROLES ===
const editModal = document.getElementById('edit-user-modal');
const editNameEl = document.getElementById('edit-user-name');
const editEmailEl = document.getElementById('edit-user-email');
const editPhoneEl = document.getElementById('edit-user-phone');
const editUidEl = document.getElementById('edit-user-uid');
let editingUser = null;

const btnCloseEdit = document.getElementById('btn-close-edit-modal');
if(btnCloseEdit) btnCloseEdit.addEventListener('click', () => { editModal.style.display = 'none'; });

function openEditModal(user) {
    editingUser = user;
    if(editNameEl) editNameEl.textContent = user.fullName || "Unknown User";
    if(editEmailEl) editEmailEl.textContent = user.email || "No Email Provided";
    if(editPhoneEl) editPhoneEl.textContent = user.phone || "No Phone Provided";
    if(editUidEl) editUidEl.textContent = `ID: ${user.uid}`;
    
    const banBtn = document.getElementById('btn-ban-user');
    const unbanBtn = document.getElementById('btn-unban-user');
    const makeStudentBtn = document.getElementById('btn-make-student');
    const makeMentorBtn = document.getElementById('btn-make-mentor');
    const makeAdminBtn = document.getElementById('btn-make-admin');

    const isSuperAdmin = user.uid === 'KpNtNoeNVveHO9Ga2Kc9dxuhvZp2';
    const isSelf = auth.currentUser && user.uid === auth.currentUser.uid;

    if (isSuperAdmin || isSelf) {
        if (banBtn) banBtn.style.display = 'none';
        if (unbanBtn) unbanBtn.style.display = 'none';
        if (makeStudentBtn) makeStudentBtn.style.display = 'none';
        if (makeMentorBtn) makeMentorBtn.style.display = 'none';
        if (makeAdminBtn) makeAdminBtn.style.display = 'none';
    } else {
        if (makeStudentBtn) makeStudentBtn.style.display = 'block';
        if (makeMentorBtn) makeMentorBtn.style.display = 'block';
        if (makeAdminBtn) makeAdminBtn.style.display = 'block';

        if (user.isBanned || user.role === 'BANNED') {
            if (banBtn) banBtn.style.display = 'none';
            if (unbanBtn) unbanBtn.style.display = 'block';
        } else {
            if (banBtn) banBtn.style.display = 'block';
            if (unbanBtn) unbanBtn.style.display = 'none';
        }
    }
    
    renderSubscriptions();
    if(editModal) editModal.style.display = 'flex';
}

const btnMakeStudent = document.getElementById('btn-make-student');
const btnMakeMentor = document.getElementById('btn-make-mentor');
const btnMakeAdmin = document.getElementById('btn-make-admin');

if(btnMakeStudent) btnMakeStudent.addEventListener('click', () => changeUserRole('STUDENT'));
if(btnMakeMentor) btnMakeMentor.addEventListener('click', () => changeUserRole('MENTOR'));
if(btnMakeAdmin) btnMakeAdmin.addEventListener('click', () => changeUserRole('MANAGEMENT'));

async function changeUserRole(newRole) {
    if (editingUser.uid === 'KpNtNoeNVveHO9Ga2Kc9dxuhvZp2' || editingUser.uid === auth.currentUser.uid) {
        return alert("Action denied. You cannot modify the Super Admin or your own role.");
    }

    if(confirm(`Change this user's role to ${newRole}?`)) {
        await updateDoc(doc(db, "users", editingUser.uid), { role: newRole });
        editingUser.role = newRole;
        alert(`Role successfully updated to ${newRole}.`);
        fetchAllUsers();
    }
}

const btnBanUser = document.getElementById('btn-ban-user');
if (btnBanUser) {
    btnBanUser.addEventListener('click', async () => {
        if (editingUser.uid === 'KpNtNoeNVveHO9Ga2Kc9dxuhvZp2' || editingUser.uid === auth.currentUser.uid) {
            return alert("Action denied. You cannot ban the Super Admin or yourself.");
        }

        if (confirm(`🚨 Are you absolutely sure you want to BAN ${editingUser.fullName || 'this user'}?\n\nThis will revoke all their premium access and mark their account as banned.`)) {
            btnBanUser.textContent = "Banning..."; btnBanUser.disabled = true;
            try {
                await updateDoc(doc(db, "users", editingUser.uid), { role: 'BANNED', isBanned: true, subscriptions: {}, isPremium: false });
                alert("User has been successfully banned and all access revoked.");
                if (editModal) editModal.style.display = 'none';
                fetchAllUsers();
            } catch (error) {
                console.error("Error banning user:", error); alert("Failed to ban user. Please check your connection.");
            } finally {
                btnBanUser.innerHTML = "⛔ Ban User"; btnBanUser.disabled = false;
            }
        }
    });
}	

const btnUnbanUser = document.getElementById('btn-unban-user');
if (btnUnbanUser) {
    btnUnbanUser.addEventListener('click', async () => {
        if (confirm(`✅ Are you sure you want to UNBAN ${editingUser.fullName || 'this user'}?\n\nThey will be restored as a regular Student.`)) {
            btnUnbanUser.textContent = "Unbanning..."; btnUnbanUser.disabled = true;
            try {
                await updateDoc(doc(db, "users", editingUser.uid), { role: 'STUDENT', isBanned: false });
                alert("User has been successfully unbanned!");
                if (editModal) editModal.style.display = 'none';
                fetchAllUsers();
            } catch (error) {
                console.error("Error unbanning user:", error); alert("Failed to unban user.");
            } finally {
                btnUnbanUser.innerHTML = "✅ Unban User"; btnUnbanUser.disabled = false;
            }
        }
    });
}

// === FEATURE: USER SUBSCRIPTIONS LOGIC ===
const subsListEl = document.getElementById('user-subscriptions-list');

function renderSubscriptions() {
    if(!subsListEl) return;
    subsListEl.innerHTML = '';
    if (!editingUser.subscriptions || Object.keys(editingUser.subscriptions).length === 0) {
        subsListEl.innerHTML = '<p style="font-size: 0.9rem; color: #94a3b8; font-weight: bold;">No active subscriptions.</p>';
        return;
    }

    Object.keys(editingUser.subscriptions).forEach(courseKey => {
        const expiry = editingUser.subscriptions[courseKey];
        let isExpired = false;
        let expiryText = "Lifetime Access";
        
        if (expiry !== "lifetime") {
            const dateObj = new Date(expiry);
            if (dateObj < new Date()) isExpired = true;
            expiryText = dateObj.toLocaleDateString();
        }

        const displayName = mergedNamesMap[courseKey] || courseKey.replace('_', ' ').toUpperCase();

        const box = document.createElement('div');
        box.className = `subs-box ${isExpired ? '' : 'active-sub'}`;
        box.innerHTML = `
            <div style="display: flex; align-items: center; gap: 0.8rem;">
                <i class="fas ${isExpired ? 'fa-times-circle' : 'fa-check-circle'}" style="color: ${isExpired ? '#ef4444' : '#10b981'}; font-size: 1.4rem;"></i>
                <div>
                    <div style="font-weight: 800; color: #1e293b; font-size: 1rem;">${displayName}</div>
                    <div style="font-size: 0.75rem; color: #64748b; font-weight: bold;">Premium Access</div>
                </div>
            </div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                <div style="text-align: right; background: ${isExpired ? '#fee2e2' : '#f1f5f9'}; padding: 0.3rem 0.6rem; border-radius: 6px; border: 1px solid ${isExpired ? '#fca5a5' : '#e2e8f0'};">
                    <div style="font-size: 0.8rem; font-weight: 800; color: ${isExpired ? '#991b1b' : '#334155'};">${expiryText}</div>
                    ${isExpired ? '<div style="font-size: 0.65rem; font-weight: bold; color: #ef4444;">Expired</div>' : ''}
                </div>
                <button class="btn-action-del"><i class="fas fa-trash-alt"></i></button>
            </div>
        `;
        
        box.querySelector('.btn-action-del').addEventListener('click', async () => {
            if(confirm(`Remove access to ${displayName}?`)) {
                let newSubs = { ...editingUser.subscriptions };
                delete newSubs[courseKey];
                await updateDoc(doc(db, "users", editingUser.uid), { subscriptions: newSubs });
                editingUser.subscriptions = newSubs;
                renderSubscriptions();
                fetchAllUsers();
            }
        });
        subsListEl.appendChild(box);
    });
}

window.grantAccess = async function() {
    const btn = document.getElementById('btn-grant-access');
    if(btn) { btn.textContent = "Saving..."; btn.disabled = true; }
    
    const course = document.getElementById('grant-course').value;
    const days = document.getElementById('grant-duration').value;
    
    let expiryValue = "lifetime";
    if (days !== "lifetime") {
        const date = new Date();
        date.setDate(date.getDate() + parseInt(days));
        expiryValue = date.toISOString();
    }

    let currentSubs = editingUser.subscriptions || {};
    currentSubs[course] = expiryValue;

    try {
        await updateDoc(doc(db, "users", editingUser.uid), { 
            subscriptions: currentSubs,
            isPremium: true 
        });
        editingUser.subscriptions = currentSubs;
        renderSubscriptions();
        fetchAllUsers();
    } catch (e) {
        console.error(e);
        alert("Failed to grant access.");
    } finally {
        if(btn) { btn.textContent = "Grant Access"; btn.disabled = false; }
    }
};

// === FEATURE: KEY GENERATION & MANAGEMENT ===
window.generateKey = async function() {
    const btn = document.getElementById('btn-generate-key');
    if(btn) { btn.textContent = "Generating..."; btn.disabled = true; }

    const course = document.getElementById('key-course').value;
    const duration = document.getElementById('key-duration').value;
    const usage = parseInt(document.getElementById('key-usage').value) || 1;
    const expiry = document.getElementById('key-expiry').value;
    let customCode = document.getElementById('key-custom').value.trim().toUpperCase();

    const selectedBooks = Array.from(document.querySelectorAll('.key-book-check:checked')).map(cb => cb.value);

    if(!customCode) customCode = "KEY-" + Math.random().toString(36).substring(2, 8).toUpperCase();

    try {
        await setDoc(doc(db, "keys", customCode), {
            code: customCode, 
            course: course, 
            books: selectedBooks,
            duration: duration, 
            maxUsage: usage,
            usedCount: 0, 
            expiryDate: expiry || null, 
            createdAt: new Date().toISOString()
        });
        alert("Key Generated: " + customCode);
        document.getElementById('key-custom').value = '';
        document.querySelectorAll('.key-book-check').forEach(cb => cb.checked = false); 
        fetchKeys();
    } catch(e) {
        console.error(e);
        alert("Error generating key.");
    } finally {
        if(btn) { btn.textContent = "Generate Key"; btn.disabled = false; }
    }
};

async function fetchKeys() {
    const qSnap = await getDocs(collection(db, "keys"));
    const tbody = document.getElementById('keys-table-body');
    if(!tbody) return;
    
    tbody.innerHTML = '';
    qSnap.forEach(d => {
        const data = d.data();
        const tr = document.createElement('tr');
        tr.style = "border-bottom: 2px solid #f1f5f9;";
        
        let booksHtml = '';
        if (data.books && data.books.length > 0) {
            const bookTitles = data.books.map(b => mergedNamesMap[b] || b).join(', ');
            booksHtml = `<div style="font-size: 0.75rem; color: #64748b; margin-top: 4px;">+ Books: ${bookTitles}</div>`;
        }

        tr.innerHTML = `
            <td style="padding: 1.2rem; font-weight: 800; font-size: 1.05rem; color: #1e293b;">
                <div style="display: flex; align-items: center; gap: 0.8rem;">
                    ${data.code}
                    <button class="btn-action-icon btn-copy-key" style="width: 28px; height: 28px; font-size: 0.8rem; background: #f1f5f9; color: #3b82f6; border: 1px solid #cbd5e1; box-shadow: none;" title="Copy Key">
                        <i class="fas fa-copy"></i>
                    </button>
                </div>
            </td>
            <td>
                <span class="badge b-course">${mergedNamesMap[data.course] || data.course.replace('_', ' ').toUpperCase()}</span>
                ${booksHtml}
            </td>
            <td style="font-weight: 700; color: #475569;">${data.usedCount} / ${data.maxUsage}</td>
            <td><button class="btn-action-del btn-del-key">Delete</button></td>
        `;
        
        const copyBtn = tr.querySelector('.btn-copy-key');
        copyBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(data.code);
                copyBtn.innerHTML = '<i class="fas fa-check" style="color: #10b981;"></i>';
                copyBtn.style.borderColor = '#10b981';
                setTimeout(() => {
                    copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
                    copyBtn.style.borderColor = '#cbd5e1';
                }, 2000);
            } catch (err) { alert("Clipboard access denied."); }
        });

        tr.querySelector('.btn-del-key').addEventListener('click', async () => {
            if(confirm("Delete this key?")) {
                await deleteDoc(doc(db, "keys", data.code));
                fetchKeys();
            }
        });
        
        tbody.appendChild(tr);
    });
}

// === FEATURE: COURSE CHANGE REQUESTS ===
let unsubscribeRequests = null;

async function fetchRequests() {
    const list = document.getElementById('requests-list');
    if(!list) return;
    if (unsubscribeRequests) return;

    const qReq = query(collection(db, "users"), where("courseChangeRequested", "==", true));
    
    unsubscribeRequests = onSnapshot(qReq, (qSnap) => {
        list.innerHTML = '';
        let hasRequests = false;
        
        qSnap.forEach(d => {
            hasRequests = true;
            const data = d.data();
            const userId = d.id;
            
            const currentCourse = data.selectedCourse ? (courseNamesMap[data.selectedCourse] || data.selectedCourse) : "None Assigned";
            const newCourse = data.requestedCourse ? (courseNamesMap[data.requestedCourse] || data.requestedCourse) : "Unknown Course";

            const card = document.createElement('div');
            card.style = "background: white; border: 2px solid #8b5cf6; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 4px 6px rgba(139, 92, 246, 0.1);";
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px dashed #e2e8f0; padding-bottom: 1rem; margin-bottom: 1rem;">
                    <div>
                        <div style="font-weight: 800; color: #1e293b; font-size: 1.1rem;">${data.fullName || 'Unknown User'}</div>
                        <div style="font-size: 0.85rem; color: #64748b;">${data.email || 'No Email'} | ${data.phone || 'No Phone'}</div>
                    </div>
                </div>
                
                <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; background: #f8fafc; padding: 1rem; border-radius: 8px;">
                    <div style="flex: 1; text-align: center;">
                        <div style="font-size: 0.75rem; font-weight: 800; color: #64748b; text-transform: uppercase;">Current Course</div>
                        <div style="color: #ef4444; font-weight: bold; font-size: 1rem; margin-top: 0.3rem;">${currentCourse}</div>
                    </div>
                    <i class="fas fa-arrow-right" style="color: #cbd5e1; font-size: 1.2rem;"></i>
                    <div style="flex: 1; text-align: center;">
                        <div style="font-size: 0.75rem; font-weight: 800; color: #64748b; text-transform: uppercase;">Requested Course</div>
                        <div style="color: #10b981; font-weight: bold; font-size: 1.1rem; margin-top: 0.3rem;">${newCourse}</div>
                    </div>
                </div>

                <div style="display: flex; gap: 1rem;">
                    <button class="btn-solid btn-approve-req" style="flex: 1; background: #10b981; border: none; padding: 0.8rem; border-radius: 8px; color: white; font-weight: bold; cursor: pointer;">✅ Approve Change</button>
                    <button class="btn-outline btn-reject-req" style="flex: 1; border-color: #ef4444; color: #ef4444; padding: 0.8rem; border-radius: 8px; font-weight: bold; cursor: pointer; background: transparent;">❌ Reject</button>
                </div>
            `;

            card.querySelector('.btn-approve-req').addEventListener('click', async () => {
                const btn = card.querySelector('.btn-approve-req');
                btn.textContent = "Approving..."; btn.disabled = true;
                try {
                    await updateDoc(doc(db, "users", userId), {
                        selectedCourse: data.requestedCourse, courseChangeRequested: false, requestedCourse: null
                    });
                    fetchAllUsers(); 
                } catch (e) {
                    console.error(e); alert("Error approving request.");
                    btn.textContent = "✅ Approve Change"; btn.disabled = false;
                }
            });

            card.querySelector('.btn-reject-req').addEventListener('click', async () => {
                if(confirm("Are you sure you want to reject this course change request?")) {
                    const btn = card.querySelector('.btn-reject-req');
                    btn.textContent = "Rejecting..."; btn.disabled = true;
                    try {
                        await updateDoc(doc(db, "users", userId), { courseChangeRequested: false, requestedCourse: null });
                    } catch (e) {
                        console.error(e); alert("Error rejecting request.");
                        btn.textContent = "❌ Reject"; btn.disabled = false;
                    }
                }
            });

            list.appendChild(card);
        });

        if(!hasRequests) list.innerHTML = '<p style="text-align: center; font-weight: bold; color: #94a3b8; padding: 2rem;">No pending course change requests.</p>';
    });
}

// === FEATURE: PAYMENT REQUEST LOGIC ===
let unsubscribePayments = null;

const receiptModal = document.getElementById('receipt-modal');
const btnCloseReceipt = document.getElementById('btn-close-receipt');
if (btnCloseReceipt && receiptModal) {
    btnCloseReceipt.addEventListener('click', () => {
        receiptModal.style.display = 'none';
    });
}

function fetchPayments() {
    const list = document.getElementById('payments-list');
    if(!list) return;
    
    if (unsubscribePayments) return;

    // Pricing logic maps (Matches dashboard calculator)
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

            // --- Calculate Expected Price ---
            const courseCount = (data.courses || []).length;
            const bookCount = (data.books || []).length;
            const durationIdx = durationIndexMap[data.durationDays] !== undefined ? durationIndexMap[data.durationDays] : 7;

            // Bundle logic
            let bookDiscount = 0;
            if (bookCount >= 5) bookDiscount = 0.30;
            else if (bookCount >= 3) bookDiscount = 0.20;
            else if (bookCount >= 2) bookDiscount = 0.10;

            let coursePrice = courseCount > 0 ? baseCoursePrices[durationIdx] : 0;
            let rawBookTotal = bookCount * baseBookPrices[durationIdx];
            let discountedBookTotal = rawBookTotal * (1 - bookDiscount);

            let expectedTotal = Math.round(coursePrice + discountedBookTotal);
            let originalTotal = expectedTotal;
            let promoHtml = '';

            // Promo logic
            if (data.appliedPromoCode && data.promoDiscountApplied > 0) {
                expectedTotal = Math.round(expectedTotal * (1 - (data.promoDiscountApplied / 100)));
                promoHtml = `
                    <div style="background: #fdf2f8; border: 1px dashed #f472b6; color: #be185d; padding: 0.5rem 0.8rem; border-radius: 8px; font-size: 0.85rem; font-weight: 800; margin-top: 0.5rem; display: flex; justify-content: space-between; align-items: center;">
                        <span>🎟️ Promo: ${data.appliedPromoCode}</span>
                        <span>-${data.promoDiscountApplied}%</span>
                    </div>
                    <div style="font-size: 0.75rem; color: #94a3b8; text-decoration: line-through; text-align: right; margin-top: 4px;">Original: Rs. ${originalTotal.toLocaleString()}</div>
                `;
            }

            // --- Build the UI Card ---
            const card = document.createElement('div');
            card.style = "background: white; border: 2px solid #3b82f6; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; position: relative;";
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px dashed #e2e8f0; padding-bottom: 1rem; margin-bottom: 1rem; flex-wrap: wrap; gap: 10px;">
                    <div style="font-weight: 800; color: #1e293b; font-size: 1.1rem; word-break: break-all;">${data.userEmail}</div>
                    <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                        ${(data.courses || []).map(c => `<span class="badge b-admin" style="background: #1e293b; color: white;">${c.replace('_', ' ').toUpperCase()}</span>`).join('')}
                        ${(data.books || []).map(b => `<span class="badge b-admin" style="background: #5b21b6; color: white;">${b.replace('_', ' ').toUpperCase()}</span>`).join('')}
                        <span class="badge b-course" style="background: #e0f2fe; color: #0369a1;">${data.planName}</span>
                    </div>
                </div>
                
                <!-- Expected Payment Box -->
                <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 1.2rem; margin-bottom: 1.5rem;">
                    <div style="font-size: 0.75rem; color: #64748b; font-weight: 800; text-transform: uppercase;">Expected Payment</div>
                    <div style="font-size: 1.8rem; font-weight: 800; color: #10b981;">Rs. ${expectedTotal.toLocaleString()}</div>
                    ${promoHtml}
                </div>

                ${data.receiptUrl ? `
                <div style="text-align: center; margin: 1.5rem 0;">
                    <img src="${data.receiptUrl}" style="width: 120px; height: 160px; object-fit: cover; border-radius: 12px; border: 2px solid #e2e8f0; box-shadow: 0 4px 10px rgba(0,0,0,0.1);" alt="Payment Receipt" />
                    <div style="margin-top: 0.8rem;">
                        <span class="view-receipt-trigger" style="color: #10b981; font-weight: 800; cursor: pointer; font-size: 1rem; font-family: inherit;">
                            <span style="font-size: 1.1rem; margin-right: 5px;">🔍</span> View Receipt
                        </span>
                    </div>
                </div>` : `<div style="margin-bottom: 1rem; font-size: 0.8rem; color: #ef4444; font-weight: bold;"><i class="fas fa-exclamation-circle"></i> No Receipt Attached</div>`}
                
                <div style="display: flex; gap: 1rem; align-items: center; background: #f8fafc; padding: 1.2rem; border-radius: 10px; border: 1px solid #e2e8f0; flex-wrap: wrap;">
                    <div style="flex: 1; min-width: 150px;">
                        <label style="font-size: 0.75rem; font-weight: 800; color: #64748b; text-transform: uppercase; margin-bottom: 0.5rem; display: block;">Approve Duration:</label>
                        <select class="approve-duration" style="width: 100%; padding: 0.8rem; border: 2px solid #cbd5e1; border-radius: 8px; font-family: inherit; font-weight: bold; color: #1e293b; outline: none;">
                            <option value="${data.durationDays}">${data.planName} (Requested)</option>
                            <option value="1">1 Day</option>
                            <option value="7">1 Week</option>
                            <option value="15">15 Days</option>
                            <option value="30">1 Month</option>
                            <option value="90">3 Months</option>
                            <option value="180">6 Months</option>
                            <option value="365">1 Year</option>
                            <option value="lifetime">Lifetime</option>
                        </select>
                    </div>
                    <div style="display: flex; gap: 10px; flex: 1; min-width: 200px;">
                        <button class="btn-solid btn-approve" style="flex: 1; padding: 0.8rem; margin: 0; margin-top: 1.4rem;">Approve</button>
                        <button class="btn-outline btn-reject" style="flex: 1; border-color: #ef4444; color: #ef4444; padding: 0.8rem; margin: 0; margin-top: 1.4rem; background: transparent;">Reject</button>
                    </div>
                </div>
            `;

            const viewTrigger = card.querySelector('.view-receipt-trigger');
            if (viewTrigger) {
                viewTrigger.addEventListener('click', () => {
                    const modalImg = document.getElementById('receipt-modal-img');
                    if (receiptModal && modalImg) {
                        modalImg.src = data.receiptUrl; 
                        receiptModal.style.display = 'flex'; 
                    }
                });
            }

            card.querySelector('.btn-approve').addEventListener('click', async () => {
                const btn = card.querySelector('.btn-approve');
                btn.textContent = "Saving...";
                try {
                    const durationDays = card.querySelector('.approve-duration').value;
                    const uRef = doc(db, "users", data.userId);
                    const uSnap = await getDoc(uRef);
                    
                    if(!uSnap.exists()) return alert("User not found in database.");

                    let expiryValue = "lifetime";
                    if(durationDays !== "lifetime") {
                        const date = new Date();
                        date.setDate(date.getDate() + parseInt(durationDays));
                        expiryValue = date.toISOString();
                    }

                    let currentSubs = uSnap.data().subscriptions || {};
                    (data.courses || []).forEach(c => currentSubs[c] = expiryValue);
                    (data.books || []).forEach(b => currentSubs[b] = expiryValue);

                    await updateDoc(uRef, { subscriptions: currentSubs, isPremium: true });
                    await updateDoc(doc(db, "payment_requests", d.id), { status: 'approved' });

                    alert("Payment approved and access granted!");
                } catch (e) {
                    console.error(e);
                    alert("Error approving payment");
                    btn.textContent = "Approve";
                }
            });

            card.querySelector('.btn-reject').addEventListener('click', async () => {
                if(confirm("Reject this payment?")) {
                    await updateDoc(doc(db, "payment_requests", d.id), { status: 'rejected' });
                }
            });

            list.appendChild(card);
        });

        if(!hasPending) list.innerHTML = '<p style="text-align: center; font-weight: bold; color: #94a3b8; padding: 2rem;">No pending payment requests.</p>';
    });
}

// === FEATURE: REPORTED QUESTIONS LOGIC ===
let unsubscribeReports = null;

async function fetchReports() {
    const list = document.getElementById('reports-list');
    if(!list) return;
    
    if (unsubscribeReports) return; 

    unsubscribeReports = onSnapshot(collection(db, "reported_questions"), (qSnap) => {
        list.innerHTML = '';
        let hasReports = false;
        
        const reportsDocs = [];
        qSnap.forEach(d => reportsDocs.push({ id: d.id, ...d.data() }));

        reportsDocs.sort((a, b) => {
            if (!a.timestamp || !b.timestamp) return 0;
            return b.timestamp.toMillis() - a.timestamp.toMillis();
        });

        reportsDocs.forEach(data => {
            hasReports = true;

            const card = document.createElement('div');
            card.style = "background: white; border-left: 4px solid #ef4444; border-radius: 8px; padding: 1.2rem; margin-bottom: 1rem; box-shadow: 0 2px 4px rgba(0,0,0,0.05);";
            
            let dateStr = "Unknown Date";
            if (data.timestamp) dateStr = data.timestamp.toDate().toLocaleString();

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.5rem;">
                    <div>
                        <div style="font-weight: 800; color: #1e293b; font-size: 1.1rem;">Question ID: <span style="color: #ef4444;">${data.questionId}</span></div>
                        <div style="font-size: 0.8rem; color: #64748b; margin-top: 0.2rem;"><i class="fas fa-file-alt"></i> ${data.courseFile.replace('_', ' ').toUpperCase()}</div>
                    </div>
                    <div style="text-align: right;">
                        <span class="badge b-course" style="background: #fee2e2; color: #ef4444;"><i class="fas fa-exclamation-circle"></i> Reported</span>
                        <div style="font-size: 0.7rem; color: #94a3b8; margin-top: 0.3rem;">${dateStr}</div>
                    </div>
                </div>
                
                <div style="background: #f8fafc; border: 1px dashed #cbd5e1; padding: 0.8rem; border-radius: 6px; margin-bottom: 1rem;">
                    <div style="font-size: 0.7rem; font-weight: bold; color: #94a3b8; text-transform: uppercase;">Question Snippet:</div>
                    <div style="color: #475569; font-size: 0.9rem; font-style: italic;">"${data.questionText}"</div>
                </div>

                <div>
                    <div style="font-size: 0.75rem; font-weight: bold; color: #0f172a; text-transform: uppercase;">Reporter's Reason:</div>
                    <p style="color: #1e293b; font-size: 0.95rem; margin-top: 0.3rem; margin-bottom: 1rem;">${data.reason}</p>
                </div>

                <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #e2e8f0; padding-top: 0.8rem;">
                    <div style="font-size: 0.8rem; color: #64748b;">
                        <strong>Reported by:</strong> ${data.userEmail}
                    </div>
                    <button class="btn-outline btn-resolve-report" style="border-color: #10b981; color: #10b981; padding: 0.4rem 1rem; font-size: 0.8rem;">Mark Resolved</button>
                </div>
            `;

            card.querySelector('.btn-resolve-report').addEventListener('click', async () => {
                if(confirm("Are you sure you want to resolve and delete this report?")) {
                    try {
                        await deleteDoc(doc(db, "reported_questions", data.id));
                        alert("Report resolved and removed!");
                    } catch (e) {
                        console.error("Error resolving report: ", e);
                        alert("Failed to resolve report.");
                    }
                }
            });

            list.appendChild(card);
        });

        if(!hasReports) list.innerHTML = '<p style="text-align: center; color: #64748b; padding: 2rem;">No reported questions at the moment. ✨</p>';
    });
}

// === FEATURE: CONTACT MESSAGES LOGIC ===
let unsubscribeMessages = null;

async function fetchMessages() {
    const list = document.getElementById('messages-list');
    if(!list) return;
    
    if (unsubscribeMessages) return; 

    unsubscribeMessages = onSnapshot(collection(db, "contact_messages"), (qSnap) => {
        list.innerHTML = '';
        let hasMessages = false;
        
        const messagesDocs = [];
        qSnap.forEach(d => messagesDocs.push({ id: d.id, ...d.data() }));

        messagesDocs.sort((a, b) => {
            const dateA = new Date(a.timestamp || 0);
            const dateB = new Date(b.timestamp || 0);
            return dateB - dateA; 
        });

        messagesDocs.forEach(data => {
            hasMessages = true;

            const card = document.createElement('div');
            card.className = "message-card";
            
            let dateStr = "Unknown Date";
            if (data.timestamp) {
                dateStr = new Date(data.timestamp).toLocaleString(undefined, {
                    month: 'short', day: 'numeric', year: 'numeric', 
                    hour: 'numeric', minute: 'numeric'
                });
            }

            const cleanWhatsapp = data.whatsapp ? data.whatsapp.replace(/[^0-9]/g, '') : '';

            card.innerHTML = `
                <div class="message-header">
                    <div>
                        <div class="message-title">${data.name}</div>
                        <div class="message-email" style="display: flex; gap: 15px; flex-wrap: wrap; margin-top: 5px;">
                            <span>
                                <i class="fas fa-envelope"></i> 
                                <a href="mailto:${data.email}">${data.email}</a>
                            </span>
                            ${data.whatsapp ? `
                            <span>
                                <i class="fab fa-whatsapp" style="color: #25D366; font-size: 1.1em;"></i> 
                                <a href="https://wa.me/${cleanWhatsapp}" target="_blank" style="color: #10b981; text-decoration: none;">${data.whatsapp}</a>
                            </span>
                            ` : ''}
                        </div>
                    </div>
                    <div class="message-date">${dateStr}</div>
                </div>
                
                <div class="message-body">${data.message}</div>

                <div class="message-footer">
                    <button class="btn-outline btn-delete-msg">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </div>
            `;

            card.querySelector('.btn-delete-msg').addEventListener('click', async () => {
                if(confirm("Are you sure you want to delete this message?")) {
                    const btn = card.querySelector('.btn-delete-msg');
                    btn.textContent = "Deleting...";
                    btn.disabled = true;
                    try {
                        await deleteDoc(doc(db, "contact_messages", data.id));
                    } catch (e) {
                        console.error("Error deleting message: ", e);
                        alert("Failed to delete message.");
                        btn.textContent = "Delete";
                        btn.disabled = false;
                    }
                }
            });

            list.appendChild(card);
        });

        if(!hasMessages) list.innerHTML = '<p style="text-align: center; color: #64748b; padding: 2rem;">No new messages. Your inbox is clean! ✨</p>';
    });
}

// === FEATURE: PROMO CODES MANAGEMENT ===
window.generatePromo = async function() {
    const btn = document.getElementById('btn-generate-promo');
    if(btn) { btn.textContent = "Creating..."; btn.disabled = true; }

    const codeInput = document.getElementById('promo-code').value.trim().toUpperCase();
    const discountInput = parseInt(document.getElementById('promo-discount').value);
    const expiryInput = document.getElementById('promo-expiry').value;

    if (!codeInput || isNaN(discountInput) || discountInput <= 0 || discountInput > 100) {
        alert("Please enter a valid promo code and a discount percentage between 1 and 100.");
        if(btn) { btn.textContent = "Create Promo"; btn.disabled = false; }
        return;
    }

    try {
        // We use the code string itself as the Document ID for fast querying
        await setDoc(doc(db, "promo_codes", codeInput), {
            code: codeInput,
            discountPercentage: discountInput,
            isActive: true,
            expiryDate: expiryInput || null,
            createdAt: new Date().toISOString()
        });
        
        alert("Promo Code Created: " + codeInput);
        document.getElementById('promo-code').value = '';
        document.getElementById('promo-discount').value = '';
        document.getElementById('promo-expiry').value = '';
    } catch(e) {
        console.error(e);
        alert("Error creating promo code.");
    } finally {
        if(btn) { btn.textContent = "Create Promo"; btn.disabled = false; }
    }
};

let unsubscribePromos = null;

window.fetchPromos = async function() {
    const tbody = document.getElementById('promos-table-body');
    if(!tbody) return;
    
    // Prevent duplicate listeners
    if (unsubscribePromos) return;

    unsubscribePromos = onSnapshot(collection(db, "promo_codes"), (qSnap) => {
        tbody.innerHTML = '';
        let hasPromos = false;

        qSnap.forEach(d => {
            hasPromos = true;
            const data = d.data();
            const tr = document.createElement('tr');
            tr.style = "border-bottom: 1px solid #f1f5f9;";
            
            let expiryText = "No Expiry";
            let isExpired = false;
            
            if (data.expiryDate) {
                const expDate = new Date(data.expiryDate);
                expiryText = expDate.toLocaleDateString();
                if (expDate < new Date()) isExpired = true;
            }
            
            const statusBadge = data.isActive && !isExpired 
                ? `<span class="badge" style="background: #dcfce7; color: #166534;">Active</span>`
                : `<span class="badge" style="background: #fee2e2; color: #991b1b;">${isExpired ? 'Expired' : 'Inactive'}</span>`;

            tr.innerHTML = `
                <td style="padding: 1.2rem; font-weight: 800; font-size: 1.05rem; color: #1e293b; font-family: monospace;">
                    ${data.code}
                </td>
                <td style="font-weight: 800; color: #10b981;">
                    ${data.discountPercentage}% OFF
                </td>
                <td>
                    <div style="margin-bottom: 5px;">${statusBadge}</div>
                    <div style="font-size: 0.75rem; color: #64748b;">Exp: ${expiryText}</div>
                </td>
                <td>
                    <button class="btn-action-del btn-toggle-promo" style="border-color: #f59e0b; color: #f59e0b; margin-right: 5px;" title="${data.isActive ? 'Deactivate' : 'Activate'}">
                        <i class="fas fa-power-off"></i>
                    </button>
                    <button class="btn-action-del btn-del-promo" title="Delete Promo">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </td>
            `;
            
            // Action: Toggle Active Status
            tr.querySelector('.btn-toggle-promo').addEventListener('click', async () => {
                try {
                    await updateDoc(doc(db, "promo_codes", data.code), { isActive: !data.isActive });
                } catch(e) {
                    alert("Failed to toggle status.");
                }
            });

            // Action: Hard Delete Promo
            tr.querySelector('.btn-del-promo').addEventListener('click', async () => {
                if(confirm(`Are you sure you want to completely delete the promo code ${data.code}?`)) {
                    try {
                        await deleteDoc(doc(db, "promo_codes", data.code));
                    } catch(e) {
                        alert("Failed to delete promo code.");
                    }
                }
            });
            
            tbody.appendChild(tr);
        });

        if(!hasPromos) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 2rem; color: #94a3b8;">No promo codes found.</td></tr>';
        }
    });
};