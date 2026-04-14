import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { collection, getDocs, doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const usersListEl = document.getElementById('users-list');
const userCountEl = document.getElementById('user-count');
const searchInput = document.getElementById('admin-search-input');
const searchBtn = document.getElementById('admin-search-btn');

// Modal Elements
const editModal = document.getElementById('edit-user-modal');
const editEmailEl = document.getElementById('edit-user-email');
const editRole = document.getElementById('edit-role');
const editPremium = document.getElementById('edit-premium');
const editAddCourse = document.getElementById('edit-add-course');
const editExpiryDate = document.getElementById('edit-expiry-date');
const btnSaveUser = document.getElementById('btn-save-user');

let allUsersData = [];
let editingUserId = null;

// ==========================================
// 1. SECURITY & AUTHENTICATION CHECK
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userRef = doc(db, "users", user.uid);
        const docSnap = await getDoc(userRef);
        
        // Strict Kick-out if not MANAGEMENT
        if (!docSnap.exists() || docSnap.data().role !== 'MANAGEMENT') {
            alert("Unauthorized Access. Redirecting to Dashboard.");
            window.location.href = 'dashboard.html';
            return;
        }

        // If authorized, load the user database
        fetchAllUsers();
    } else {
        window.location.href = 'index.html';
    }
});

// ==========================================
// 2. FETCH & RENDER USERS
// ==========================================
async function fetchAllUsers() {
    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        allUsersData = [];
        
        querySnapshot.forEach((doc) => {
            let data = doc.data();
            data.uid = doc.id;
            allUsersData.push(data);
        });

        userCountEl.textContent = allUsersData.length;
        renderUsers(allUsersData);

    } catch (error) {
        console.error("Error fetching users:", error);
        usersListEl.innerHTML = '<p style="color: red; text-align: center;">Failed to load user database.</p>';
    }
}

function renderUsers(usersArray) {
    usersListEl.innerHTML = '';

    if (usersArray.length === 0) {
        usersListEl.innerHTML = '<p style="text-align: center; color: #64748b; padding: 1rem;">No users found.</p>';
        return;
    }

    usersArray.forEach(user => {
        const role = user.role || 'STUDENT';
        const roleClass = role === 'MANAGEMENT' || role === 'MENTOR' ? 'badge-role-admin' : 'badge-role-student';
        const roleDisplay = role === 'MANAGEMENT' ? 'Admin' : role === 'MENTOR' ? 'Mentor' : 'Student';
        
        const isPremium = user.isPremium === true;
        const premiumClass = isPremium ? 'badge-tier-pro' : 'badge-tier-free';
        const premiumDisplay = isPremium ? 'Premium' : 'Free';

        // Parse custom course accesses (simulated from a 'subscriptions' map in DB)
        let coursesHtml = '';
        if (user.subscriptions && typeof user.subscriptions === 'object') {
            Object.keys(user.subscriptions).forEach(courseKey => {
                const expiry = user.subscriptions[courseKey];
                let expiryText = "Lifetime";
                if (expiry && expiry !== "lifetime") {
                    const daysLeft = Math.ceil((new Date(expiry) - new Date()) / (1000 * 60 * 60 * 24));
                    expiryText = daysLeft > 0 ? `${daysLeft} days left` : 'Expired';
                }
                
                // Format course name beautifully
                const prettyCourse = courseKey.replace('_', ' ').toUpperCase();
                coursesHtml += `<span class="adm-badge badge-course">${prettyCourse} (${expiryText})</span>`;
            });
        }

        const card = document.createElement('div');
        card.className = 'user-card';
        card.innerHTML = `
            <div class="user-info">
                <div class="user-email">${user.email || user.uid}</div>
                <div class="badge-row">
                    <span class="adm-badge ${roleClass}">${roleDisplay}</span>
                    <span class="adm-badge ${premiumClass}">${premiumDisplay}</span>
                    ${coursesHtml}
                </div>
            </div>
            <button class="btn-settings"><i class="fas fa-cog"></i></button>
        `;

        // Open Edit Modal
        card.querySelector('.btn-settings').onclick = () => openEditModal(user);
        
        usersListEl.appendChild(card);
    });
}

// ==========================================
// 3. SEARCH FUNCTIONALITY
// ==========================================
function executeSearch() {
    const query = searchInput.value.toLowerCase().trim();
    if (!query) {
        renderUsers(allUsersData);
        return;
    }

    const filtered = allUsersData.filter(u => {
        const emailMatch = (u.email || "").toLowerCase().includes(query);
        const uidMatch = u.uid.toLowerCase().includes(query);
        return emailMatch || uidMatch;
    });
    renderUsers(filtered);
}

searchBtn.addEventListener('click', executeSearch);
searchInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') executeSearch(); });

// ==========================================
// 4. EDIT USER LOGIC
// ==========================================
function openEditModal(user) {
    editingUserId = user.uid;
    editEmailEl.textContent = user.email || user.uid;
    
    // Pre-fill existing data
    editRole.value = user.role || 'STUDENT';
    editPremium.value = user.isPremium === true ? "true" : "false";
    
    // Clear course inputs
    editAddCourse.value = "";
    editExpiryDate.value = "";

    editModal.style.display = 'flex';
}

btnSaveUser.onclick = async () => {
    if (!editingUserId) return;
    
    const newRole = editRole.value;
    const newPremium = editPremium.value === "true";
    const selectedCourse = editAddCourse.value;
    const expiryDate = editExpiryDate.value || "lifetime";

    btnSaveUser.textContent = "Saving...";
    btnSaveUser.disabled = true;

    try {
        const userRef = doc(db, "users", editingUserId);
        
        let updates = {
            role: newRole,
            isPremium: newPremium
        };

        // If admin selected a course to grant access to
        if (selectedCourse) {
            updates[`subscriptions.${selectedCourse}`] = expiryDate;
        }

        await updateDoc(userRef, updates);
        
        alert("User updated successfully!");
        editModal.style.display = 'none';
        
        // Refresh the list to show new data
        await fetchAllUsers();

    } catch (error) {
        console.error("Update Error:", error);
        alert("Failed to update user.");
    } finally {
        btnSaveUser.textContent = "Save Changes";
        btnSaveUser.disabled = false;
    }
};