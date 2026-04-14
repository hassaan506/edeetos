import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { collection, getDocs, doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// DOM Elements
const usersListEl = document.getElementById('users-list');
const userCountEl = document.getElementById('user-count');
const searchInput = document.getElementById('admin-search-input');
const searchBtn = document.getElementById('admin-search-btn');

// Modal Elements
const editModal = document.getElementById('edit-user-modal');
const editEmailEl = document.getElementById('edit-user-email');
const editUidEl = document.getElementById('edit-user-uid');
const subsListEl = document.getElementById('user-subscriptions-list');
const btnToggleAdmin = document.getElementById('btn-toggle-admin');

let allUsersData = [];
let editingUser = null;

// ==========================================
// 1. SECURITY & DYNAMIC QUESTION COUNTER
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userRef = doc(db, "users", user.uid);
        const docSnap = await getDoc(userRef);
        
        if (!docSnap.exists() || docSnap.data().role !== 'MANAGEMENT') {
            alert("Unauthorized Access.");
            window.location.href = 'dashboard.html';
            return;
        }

        fetchAllUsers();
        calculateTotalQuestions(); // Trigger the dynamic counter!
    } else {
        window.location.href = 'index.html';
    }
});

// Dynamic Question Counter (Fetches your CSVs)
async function calculateTotalQuestions() {
    // List all possible courses you have CSVs for
    const courses = ['fcps_part1', 'fcps_part2', 'fcps_imm', 'mrcs_part1', 'mrcs_part2', 'mbbs_year1', 'mbbs_year2', 'mbbs_year3', 'mbbs_year4', 'mbbs_year5'];
    let totalQuestions = 0;
    
    for (const course of courses) {
        try {
            const response = await fetch(`Data/${course}.csv`);
            if (response.ok) {
                const text = await response.text();
                // Count lines, subtract 1 for the header row
                const lines = text.split('\n').filter(line => line.trim().length > 0);
                if (lines.length > 1) {
                    totalQuestions += (lines.length - 1);
                }
            }
        } catch (e) {
            // Ignore errors if a CSV file doesn't exist yet
        }
    }
    
    document.getElementById('total-q-count').textContent = `Questions: ${totalQuestions}`;
}

// ==========================================
// 2. TAB ROUTING
// ==========================================
window.switchView = function(viewName) {
    // Hide all views
    document.getElementById('view-users').style.display = 'none';
    document.getElementById('view-keys').style.display = 'none';
    document.getElementById('view-payments').style.display = 'none';
    document.getElementById('view-reports').style.display = 'none';
    
    // Remove active class from tabs
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    
    // Show selected view
    document.getElementById(`view-${viewName}`).style.display = 'block';
    event.currentTarget.classList.add('active');
}

// ==========================================
// 3. USER MANAGEMENT
// ==========================================
async function fetchAllUsers() {
    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        allUsersData = [];
        querySnapshot.forEach((doc) => {
            let data = doc.data(); data.uid = doc.id; allUsersData.push(data);
        });
        userCountEl.textContent = allUsersData.length;
        renderUsers(allUsersData);
    } catch (error) {
        usersListEl.innerHTML = '<p style="color: red; text-align: center;">Failed to load database.</p>';
    }
}

function renderUsers(usersArray) {
    usersListEl.innerHTML = '';
    if (usersArray.length === 0) return;

    usersArray.forEach(user => {
        const role = user.role || 'STUDENT';
        const roleHtml = role === 'MANAGEMENT' ? `<span class="badge b-admin">Admin</span>` : '';
        
        let coursesHtml = '';
        if (user.subscriptions) {
            Object.keys(user.subscriptions).forEach(courseKey => {
                const expiry = user.subscriptions[courseKey];
                let expiryText = "Lifetime";
                if (expiry !== "lifetime") {
                    const daysLeft = Math.ceil((new Date(expiry) - new Date()) / (1000 * 60 * 60 * 24));
                    expiryText = daysLeft > 0 ? `${daysLeft}d left` : 'Expired';
                }
                coursesHtml += `<span class="badge b-course">${courseKey.replace('_', ' ').toUpperCase()}</span> <span class="badge b-time">${expiryText}</span>`;
            });
        }

        const card = document.createElement('div');
        card.style = "display: flex; justify-content: space-between; align-items: center; padding: 1rem 0; border-bottom: 1px solid #f1f5f9;";
        card.innerHTML = `
            <div>
                <div style="font-weight: 800; color: #1e293b; margin-bottom: 0.3rem;">${user.email || user.uid}</div>
                <div style="display: flex; gap: 0.3rem; flex-wrap: wrap;">${roleHtml} ${coursesHtml}</div>
            </div>
            <button class="btn-solid" style="width: 40px; height: 40px; padding: 0; background: #3b82f6;"><i class="fas fa-cog"></i></button>
        `;
        card.querySelector('button').onclick = () => openEditModal(user);
        usersListEl.appendChild(card);
    });
}

// Search Logic
function executeSearch() {
    const query = searchInput.value.toLowerCase().trim();
    if (!query) { renderUsers(allUsersData); return; }
    const filtered = allUsersData.filter(u => (u.email || "").toLowerCase().includes(query) || u.uid.toLowerCase().includes(query));
    renderUsers(filtered);
}
searchBtn.addEventListener('click', executeSearch);
searchInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') executeSearch(); });

// ==========================================
// 4. EDIT USER MODAL
// ==========================================
function openEditModal(user) {
    editingUser = user;
    editEmailEl.textContent = user.email || "No Email";
    editUidEl.textContent = `ID: ${user.uid}`;
    
    // Toggle Admin Button Logic
    if (user.role === 'MANAGEMENT') {
        btnToggleAdmin.textContent = "⬇ Remove Admin Access";
        btnToggleAdmin.onclick = () => changeUserRole('STUDENT');
    } else {
        btnToggleAdmin.textContent = "⬆ Grant Admin Access";
        btnToggleAdmin.onclick = () => changeUserRole('MANAGEMENT');
    }

    renderSubscriptions();
    editModal.style.display = 'flex';
}

function renderSubscriptions() {
    subsListEl.innerHTML = '';
    if (!editingUser.subscriptions || Object.keys(editingUser.subscriptions).length === 0) {
        subsListEl.innerHTML = '<p style="font-size: 0.8rem; color: #94a3b8;">No active subscriptions.</p>';
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

        const box = document.createElement('div');
        box.className = `subs-box ${isExpired ? '' : 'active-sub'}`;
        box.innerHTML = `
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                <i class="fas ${isExpired ? 'fa-times-circle' : 'fa-check-circle'}" style="color: ${isExpired ? '#ef4444' : '#10b981'}; font-size: 1.2rem;"></i>
                <div>
                    <div style="font-weight: 800; color: #1e293b; font-size: 0.9rem;">${courseKey.replace('_', ' ').toUpperCase()}</div>
                    <div style="font-size: 0.7rem; color: #64748b;">Premium Access</div>
                </div>
            </div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                <div style="text-align: right; background: ${isExpired ? '#fee2e2' : '#f1f5f9'}; padding: 0.2rem 0.5rem; border-radius: 4px; border: 1px solid ${isExpired ? '#fca5a5' : '#e2e8f0'};">
                    <div style="font-size: 0.75rem; font-weight: 800; color: ${isExpired ? '#991b1b' : '#334155'};">${expiryText}</div>
                    ${isExpired ? '<div style="font-size: 0.6rem; color: #ef4444;">Expired</div>' : ''}
                </div>
                <button class="btn-outline" style="border-color: #fca5a5; color: #ef4444; padding: 0.4rem; width: auto; margin: 0;"><i class="fas fa-times"></i></button>
            </div>
        `;
        
        // Remove Sub Logic
        box.querySelector('button').onclick = async () => {
            if(confirm(`Remove access to ${courseKey}?`)) {
                let newSubs = { ...editingUser.subscriptions };
                delete newSubs[courseKey];
                await updateDoc(doc(db, "users", editingUser.uid), { subscriptions: newSubs });
                editingUser.subscriptions = newSubs;
                renderSubscriptions();
                fetchAllUsers();
            }
        };

        subsListEl.appendChild(box);
    });
}

window.grantAccess = async function() {
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

    await updateDoc(doc(db, "users", editingUser.uid), { 
        subscriptions: currentSubs,
        isPremium: true // Ensure they get the badge
    });
    
    editingUser.subscriptions = currentSubs;
    renderSubscriptions();
    fetchAllUsers();
};

async function changeUserRole(newRole) {
    if(confirm(`Change role to ${newRole}?`)) {
        await updateDoc(doc(db, "users", editingUser.uid), { role: newRole });
        editingUser.role = newRole;
        openEditModal(editingUser); // Refresh modal
        fetchAllUsers();
    }
}