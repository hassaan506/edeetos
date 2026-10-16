/*
=========================================
INDEX OF FEATURES
=========================================
1. FIREBASE IMPORTS & GLOBALS
2. DASHBOARD INIT & ROLE BADGES
3. NAVIGATION & UI TOGGLES
4. DYNAMIC MODALS (Tasks, Guests, Bans)
5. NOTES VAULT
6. PREMIUM MODAL & COURSE SELECTOR
7. PAYMENT UPLOAD & PROMO LOGIC
8. REDEEM CODE
9. USER PROFILE MANAGEMENT
10. GROUP STUDY (Create & Join)
11. DARK MODE TOGGLE
=========================================
*/

// === 1. FIREBASE IMPORTS & GLOBALS ===
import { auth, db, storage, courseNamesMap, mergedNamesMap } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, updateDoc, addDoc, collection, setDoc, serverTimestamp, query, where, onSnapshot, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

let currentUserData = null;
let currentUserId = null;
let hasCheckedDowngrade = false;
let cachedNotesData = []; 

// === 2. DASHBOARD INIT & ROLE BADGES ===
onAuthStateChanged(auth, async (user) => {
    const freeWarning = document.getElementById('free-warning-text');
    const subStatus = document.getElementById('subscription-status');

    if (user) {
        currentUserId = user.uid;
        const userRef = doc(db, "users", user.uid);
        
        const cachedUser = sessionStorage.getItem('edeetos_dash_cache');
        if (cachedUser && document.getElementById('user-name').textContent === "...") {
            try { document.getElementById('user-name').textContent = JSON.parse(cachedUser).fullName || "Doctor"; } 
            catch (e) { console.warn("Cache parse failed"); }
        }

        try {
            const docSnap = await getDoc(userRef);
            if (docSnap.exists()) {
                currentUserData = docSnap.data();
                sessionStorage.setItem('edeetos_dash_cache', JSON.stringify(currentUserData)); 
                const userRoleUpper = (currentUserData.role || 'STUDENT').toUpperCase();
                
                // BAN CHECK
                if (currentUserData.isBanned || currentUserData.role === 'BANNED') {
                    document.getElementById('user-name').textContent = "ACCOUNT SUSPENDED";
                    if (subStatus) { subStatus.textContent = "BANNED"; subStatus.className = "status-badge badge-banned"; }
                    renderLockoutScreen();
                    return; 
                }               
                
                // HEADER UI
                document.getElementById('user-name').textContent = currentUserData.fullName || "Doctor";

                if (currentUserData.examDate) {
                    const today = new Date(); today.setHours(0, 0, 0, 0); 
                    const examD = new Date(currentUserData.examDate); examD.setHours(0, 0, 0, 0);
                    const diffDays = Math.ceil((examD - today) / (1000 * 60 * 60 * 24));
                    
                    const countdownContainer = document.getElementById('exam-countdown-container');
                    const countdownText = document.getElementById('exam-countdown-text');
                    
                    if (countdownContainer && countdownText) {
                        countdownContainer.classList.remove('view-hidden');
                        document.getElementById('dash-subtitle')?.classList.add('view-hidden');
                        
                        if (diffDays > 0) countdownText.textContent = `${diffDays} Days left until Exam Day!`;
                        else if (diffDays === 0) countdownText.textContent = "Exam Day is TODAY! Go conquer it.";
                        else {
                            countdownText.textContent = "Exam date has passed.";
                            document.getElementById('exam-countdown-badge').className = "countdown-badge-expired";
                        }
                    }
                }
                
                const userCourseCode = currentUserData.selectedCourse; 
                const activeCourseEl = document.getElementById('active-course-name');
                if (activeCourseEl) {
                    activeCourseEl.textContent = userCourseCode ? (courseNamesMap[userCourseCode] || "Unknown Course") : "No Course Assigned";
                    if (!userCourseCode) activeCourseEl.style.color = "#fca5a5";
                }

                const dynamicCourseContainer = document.getElementById('dynamic-course-container');
                if (dynamicCourseContainer) {
                    if (userCourseCode) {
                        dynamicCourseContainer.innerHTML = `<label class="course-checkbox-label cursor-pointer font-bold"><input type="checkbox" class="course-check" value="${userCourseCode}" checked> ${courseNamesMap[userCourseCode] || "Unknown Course"}</label>`;
                    } else {
                        dynamicCourseContainer.innerHTML = `<div class="font-xs font-bold" style="color:#fca5a5;">Action Required: Request a course in your Profile first.</div>`;
                    }
                }

                // DOWNGRADE CHECK
                let hasActiveSubscription = false;
                if (currentUserData.isPremium && currentUserData.subscriptions) {
                    for (const expiry of Object.values(currentUserData.subscriptions)) {
                        if (expiry === 'lifetime' || new Date(expiry) > new Date()) { hasActiveSubscription = true; break; }
                    }
                }
                
                if (!hasCheckedDowngrade && currentUserData.isPremium && !hasActiveSubscription) {
                    hasCheckedDowngrade = true; 
                    updateDoc(userRef, { isPremium: false }).catch(err => console.error("Error auto-downgrading:", err));
                }

                // ROLE UI BADGES
                if(subStatus) subStatus.className = "status-badge";
                if (userRoleUpper === 'MANAGEMENT' || userRoleUpper === 'ADMIN') {
                    if(subStatus) { subStatus.textContent = "Admin"; subStatus.classList.add('badge-pro'); }
                    document.getElementById('btn-admin-panel').classList.remove('view-hidden');
                    if (freeWarning) freeWarning.classList.add('view-hidden');
                } else if (hasActiveSubscription) { 
                    if(subStatus) { subStatus.textContent = "Premium"; subStatus.classList.add('badge-pro'); }
                    if (freeWarning) freeWarning.classList.add('view-hidden');
                } else {
                    if(subStatus) { subStatus.textContent = "Free Tier"; subStatus.classList.add('badge-free'); }
                    if (freeWarning) { freeWarning.classList.remove('view-hidden'); freeWarning.textContent = "(Free users limited to 50Qs/subject)"; }
                }
                
                const btnReports = document.getElementById('btn-reports-panel');
                if (userRoleUpper === 'MENTOR' || userRoleUpper === 'MANAGEMENT' || userRoleUpper === 'ADMIN') {
                    if (btnReports) btnReports.classList.remove('view-hidden');
                    
                    const btnMentor = document.getElementById('btn-contact-mentor');
                    if (btnMentor) {
                        btnMentor.innerHTML = "Open Mentorship Hub";
                        const cardH3 = btnMentor.parentElement.querySelector('h3');
                        const cardP = btnMentor.parentElement.querySelector('p');
                        if (cardH3) cardH3.textContent = "Mentorship Hub";
                        if (cardP) cardP.textContent = "Manage incoming student chat requests.";
                    }

                    setupMentorStatus();
                    setupMentorAlerts();
                }

                // ASSIGNED EXAMS UI
                if (userRoleUpper === 'STUDENT' || hasActiveSubscription) checkAssignedExams();

            }
        } catch (error) { console.error("Error fetching user data:", error); }
    } else {
        // GUEST MODE
        if (localStorage.getItem('edeetos_guest_mode') === 'true') {
            document.getElementById('user-name').textContent = "Guest";
            if(subStatus) { subStatus.textContent = "Guest Mode"; subStatus.className = "status-badge badge-guest"; }
            if (freeWarning) { freeWarning.classList.remove('view-hidden'); freeWarning.textContent = "(Guests limited to 20Qs/subject)"; freeWarning.style.color = "#94a3b8"; }
        } else {
            window.location.href = 'index.html'; 
        }
    }
});

// === 3. NAVIGATION & UTILITIES ===
document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('edeetos_guest_mode'); sessionStorage.removeItem('edeetos_dash_cache');
    signOut(auth).then(() => { window.location.href = 'index.html'; }).catch(() => { window.location.href = 'index.html'; });
});

document.getElementById('btn-admin-panel').addEventListener('click', () => window.location.href = 'admin.html');
document.getElementById('btn-contact-mentor').addEventListener('click', () => {
    if (localStorage.getItem('edeetos_guest_mode') === 'true') return alert("Please register to access Mentorship.");
    window.location.href = 'mentor.html';
});

document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.addEventListener('click', (e) => e.target.closest('.popup-overlay').classList.add('view-hidden'));
});

// === 4. DYNAMIC MODALS & ALERTS ===
function renderLockoutScreen() {
    const lockoutModal = document.getElementById('lockout-screen');
    if(lockoutModal) lockoutModal.classList.remove('view-hidden');
    document.body.style.overflow = 'hidden';
    
    document.getElementById('btn-banned-logout').addEventListener('click', () => {
        document.getElementById('btn-banned-logout').textContent = "Logging out...";
        signOut(auth).then(() => window.location.href = 'index.html').catch(() => window.location.href = 'index.html');
    });
}

function setupMentorStatus() {
    const btnMentorStatus = document.getElementById('btn-mentor-status');
    if (!btnMentorStatus) return;
    btnMentorStatus.classList.remove('view-hidden');
    let isOnline = currentUserData.isOnline || false;

    const updateStatusUI = (status) => {
        if (status) { 
            btnMentorStatus.innerHTML = '🟢 Online'; 
            btnMentorStatus.style.background = 'rgba(16, 185, 129, 0.2)'; 
            btnMentorStatus.style.color = '#34d399'; 
            btnMentorStatus.style.borderColor = '#34d399';
        } else { 
            btnMentorStatus.innerHTML = '⚪ Offline'; 
            btnMentorStatus.style.background = 'transparent'; 
            btnMentorStatus.style.color = '#94a3b8'; 
            btnMentorStatus.style.borderColor = 'rgba(255,255,255,0.2)';
        }
    };

    updateStatusUI(isOnline);
    btnMentorStatus.onclick = async () => {
        isOnline = !isOnline;
        await updateDoc(doc(db, "users", currentUserId), { isOnline: isOnline });
        currentUserData.isOnline = isOnline; updateStatusUI(isOnline);
    };
}

function setupMentorAlerts() {
    const chatsRef = collection(db, "chats");
    const q = query(chatsRef, where("mentorId", "==", currentUserId), where("status", "==", "pending"));
    
    onSnapshot(q, (snapshot) => {
        let banner = document.getElementById('mentor-alert-banner');
        if(!banner) return;
        
        if (!snapshot.empty) {
            banner.classList.remove('view-hidden');
            banner.onclick = () => window.location.href = 'mentor.html';
        } else {
            banner.classList.add('view-hidden');
        }
    });
}

async function checkAssignedExams() {
    const examsRef = collection(db, "assigned_exams");
    const assignedQuery = query(examsRef, where("assignedTo", "array-contains", currentUserId));
    
    try {
        const examsSnapshot = await getDocs(assignedQuery);
        const pendingExams = [];
        examsSnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (!data.isCompletedBy || !data.isCompletedBy.includes(currentUserId)) pendingExams.push({ id: docSnap.id, ...data });
        });

        if (pendingExams.length > 0) {
            const container = document.getElementById('task-notify-container');
            if(!container || container.children.length > 0) return; // already rendered
            
            const notifyCard = document.createElement('div');
            notifyCard.className = 'task-notify-card glass-panel';
            notifyCard.innerHTML = `
                <div class="flex-align-center gap-15px">
                    <div class="task-notify-icon"><i class="fas fa-bell"></i></div>
                    <div>
                        <h3 class="task-notify-title">New Mentor Assignments</h3>
                        <p class="task-notify-desc">You have ${pendingExams.length} task${pendingExams.length > 1 ? 's' : ''} waiting for you.</p>
                    </div>
                </div>
                <button class="action-btn next-btn" style="padding: 0.5rem 1rem;">View Tasks</button>
            `;
            container.appendChild(notifyCard);

            const taskModal = document.getElementById('assigned-tasks-modal');
            const taskListContainer = document.getElementById('task-list-container');
            
            let modalHtml = "";
            pendingExams.forEach((exam, index) => {
                modalHtml += `
                    <div class="task-item-card">
                        <div>
                            <div class="task-item-title">${exam.title}</div>
                            <div class="flex-row gap-10px">
                                <span class="task-badge-time"><i class="fas fa-clock"></i> ${exam.timerMinutes} Min</span>
                                <span class="task-badge-count"><i class="fas fa-layer-group"></i> ${exam.questions.length} Qs</span>
                            </div>
                        </div>
                        <button id="launch-assigned-${index}" class="action-btn" style="background: rgba(59, 130, 246, 0.2); border-color: #3b82f6; color: #93c5fd;">Start Now</button>
                    </div>
                `;
            });
            taskListContainer.innerHTML = modalHtml;

            notifyCard.onclick = () => taskModal.classList.remove('view-hidden');
            document.getElementById('close-tasks-modal').onclick = () => taskModal.classList.add('view-hidden');

            pendingExams.forEach((exam, index) => {
                const launchBtn = document.getElementById(`launch-assigned-${index}`);
                launchBtn.addEventListener('click', () => {
                    launchBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Loading...`;
                    launchBtn.style.opacity = "0.8"; launchBtn.style.pointerEvents = "none";
                    if (exam.course) localStorage.setItem('edeetos_active_course', exam.course);
                    localStorage.setItem('edeetos_quiz_config', JSON.stringify({ mode: 'exam', timer: exam.timerMinutes, examName: exam.title }));
                    localStorage.setItem('edeetos_assigned_exam_id', exam.id);
                    localStorage.removeItem('edeetos_aborted_session_backup');
                    localStorage.removeItem('edeetos_quiz_state');

                    const request = indexedDB.open("EdeetosDB", 1);
                    request.onupgradeneeded = (e) => { if (!e.target.result.objectStoreNames.contains("quiz_sessions")) e.target.result.createObjectStore("quiz_sessions"); };
                    request.onsuccess = (e) => {
                        const tx = e.target.result.transaction("quiz_sessions", "readwrite");
                        tx.objectStore("quiz_sessions").put(exam.questions, "active_quiz_queue");
                        tx.oncomplete = () => window.location.href = 'quiz.html';
                    };
                    request.onerror = (e) => { alert("Failed to load exam data."); launchBtn.innerHTML = "Start Now"; launchBtn.style.opacity = "1"; launchBtn.style.pointerEvents = "auto"; };
                });
            });
        }
    } catch (examErr) { console.error("Error fetching assigned exams:", examErr); }
}

document.getElementById('btn-launch-course').addEventListener('click', () => {
    if (localStorage.getItem('edeetos_guest_mode') === 'true') {
        const guestModal = document.getElementById('guest-course-modal');
        if (guestModal) {
            guestModal.classList.remove('view-hidden');
            document.getElementById('btn-cancel-guest').onclick = () => guestModal.classList.add('view-hidden');
            document.getElementById('btn-confirm-guest').onclick = () => {
                localStorage.setItem('edeetos_active_course', document.getElementById('guest-course-select').value);
                window.location.href = 'questions.html';
            };
        }
        return;
    }

    if (currentUserData) {
        let activeSub = null;
        if (currentUserData.subscriptions && Object.keys(currentUserData.subscriptions).length > 0) activeSub = Object.keys(currentUserData.subscriptions)[0];
        
        if (currentUserData.selectedCourse) { localStorage.setItem('edeetos_active_course', currentUserData.selectedCourse); window.location.href = 'questions.html'; } 
        else if (activeSub) { localStorage.setItem('edeetos_active_course', activeSub); window.location.href = 'questions.html'; } 
        else { alert("Your assigned course is missing. Please request one in your Profile."); }
    }
});

const btnOpenFlashcards = document.getElementById('btn-open-flashcards');
if (btnOpenFlashcards) {
    btnOpenFlashcards.addEventListener('click', () => {
        if (localStorage.getItem('edeetos_guest_mode') === 'true') return alert("Please register an account to access Flashcards.");
        if (currentUserData) {
            let activeSub = currentUserData.subscriptions ? Object.keys(currentUserData.subscriptions)[0] : null;
            if (currentUserData.selectedCourse || activeSub) {
                localStorage.setItem('edeetos_active_course', currentUserData.selectedCourse || activeSub);
                window.location.href = 'flashcards.html';
            } else { alert("Your assigned course is missing. Please request one in your Profile."); }
        }
    });
}

// === 5. NOTES VAULT (Updated for Dynamic Chunking) ===
const btnOpenNotes = document.getElementById('btn-open-notes');
if (btnOpenNotes) {
    btnOpenNotes.addEventListener('click', async () => {
        if (localStorage.getItem('edeetos_guest_mode') === 'true') return alert("Please register to access Notes.");
        if (!currentUserData) return alert("User data loading, please wait...");
        
        const modal = document.getElementById('notes-vault-modal');
        const listEl = document.getElementById('notes-vault-list');
        const searchInput = document.getElementById('notes-search-input');
        modal.classList.remove('view-hidden'); searchInput.value = ''; 
        
        const activeCourse = currentUserData.selectedCourse;
        const notesObj = (activeCourse && currentUserData[activeCourse] && currentUserData[activeCourse].notes) ? currentUserData[activeCourse].notes : {};
        const noteKeys = Object.keys(notesObj);
        
        if (noteKeys.length === 0) return listEl.innerHTML = '<div class="text-muted text-center p-2">You haven\'t saved any notes yet.</div>';
        listEl.innerHTML = '<div class="text-muted text-center p-2 font-bold"><i class="fas fa-spinner fa-spin" style="margin-right:8px;"></i> Loading question data...</div>';

        let allQuestions = [];
        try {
            // 1. Fetch metadata first to locate which mini-chunks contain the user's noted questions
            const metaRes = await fetch(`Data/${activeCourse}_metadata.json`, { cache: 'no-cache' });
            if (metaRes.ok) {
                const metadata = await metaRes.json();
                
                const requiredChunks = new Set();
                metadata.forEach(metaQ => {
                    const qId = String(metaQ.id || metaQ.QuestionID);
                    if (noteKeys.includes(qId)) {
                        const sanitize = (str) => String(str).toLowerCase().trim().replace(/[\\/*?:"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
                        const s = sanitize(metaQ.Subject || metaQ.subject || 'Uncategorized');
                        const c = sanitize(metaQ.Chapter || metaQ.chapter || 'General');
                        requiredChunks.add(`Data/${activeCourse}/subjects/${s}_${c}.json`);
                    }
                });

                // 2. Fetch only the specific chunks that hold the notes
                const fetchPromises = Array.from(requiredChunks).map(async (chunkUrl) => {
                    try {
                        const chunkRes = await fetch(chunkUrl);
                        if (chunkRes.ok) {
                            const chunkData = await chunkRes.json();
                            allQuestions.push(...chunkData);
                        }
                    } catch(e) { console.warn("Failed to fetch chunk:", chunkUrl); }
                });

                await Promise.all(fetchPromises);
            }
        } catch(e) { console.warn("Could not load question metadata for notes:", e); }

        cachedNotesData = noteKeys.map(qId => {
            if (!notesObj[qId].trim()) return null;
            let questionStem = "Unknown Question / Not Found in Current Database";
            const matchedQ = allQuestions.find(q => String(q.QuestionID || q.id || q['Question ID'] || q.originalNumber) === String(qId));
            if (matchedQ) {
                const rawText = matchedQ.question || matchedQ.Question || matchedQ.text || matchedQ.statement || "Image/Table Based Question";
                questionStem = rawText.substring(0, 150) + (rawText.length > 150 ? "..." : "");
            }
            return { id: qId, stem: questionStem, note: notesObj[qId] };
        }).filter(item => item !== null);

        renderNotes(cachedNotesData);
    });
}

function renderNotes(notesArray) {
    const listEl = document.getElementById('notes-vault-list');
    listEl.innerHTML = '';
    if (notesArray.length === 0) return listEl.innerHTML = '<div class="text-muted text-center p-2">No matching notes found.</div>';
    
    for (let i = 0; i < Math.min(notesArray.length, 50); i++) {
        const data = notesArray[i];
        const noteCard = document.createElement('div');
        noteCard.className = "note-card";
        noteCard.innerHTML = `
            <div class="note-id">ID: ${data.id}</div>
            <div class="note-stem">"${data.stem}"</div>
            <div class="note-body">${data.note}</div>
        `;
        listEl.appendChild(noteCard);
    }
}

const searchInput = document.getElementById('notes-search-input');
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        renderNotes(cachedNotesData.filter(item => item.stem.toLowerCase().includes(term) || item.note.toLowerCase().includes(term) || item.id.toLowerCase().includes(term)));
    });
}

// === 6. PREMIUM MODAL & COURSE SELECTOR ===
document.getElementById('btn-open-premium').addEventListener('click', () => {
    if (localStorage.getItem('edeetos_guest_mode') === 'true') return alert("Please register to upgrade to Premium.");
    document.getElementById('premium-modal').classList.remove('view-hidden');
    updatePrices();
});

const tabBuy = document.getElementById('tab-buy'); const tabRedeem = document.getElementById('tab-redeem');
const viewBuy = document.getElementById('view-buy'); const viewRedeem = document.getElementById('view-redeem');

if(tabBuy) tabBuy.addEventListener('click', () => { tabBuy.className = 'active-tab'; tabRedeem.className = 'inactive-tab'; viewBuy.classList.remove('view-hidden'); viewRedeem.classList.add('view-hidden'); });
if(tabRedeem) tabRedeem.addEventListener('click', () => { tabRedeem.className = 'active-tab'; tabBuy.className = 'inactive-tab'; viewRedeem.classList.remove('view-hidden'); viewBuy.classList.add('view-hidden'); });

const courseSelectorModal = document.getElementById('course-selector-modal');
document.getElementById('btn-open-course-selector').addEventListener('click', () => courseSelectorModal.classList.remove('view-hidden'));
document.getElementById('btn-confirm-courses').addEventListener('click', () => {
    if (document.querySelectorAll('.course-check:checked').length === 0 && document.querySelectorAll('.book-check:checked').length === 0) return alert("You must select at least one course or book.");
    courseSelectorModal.classList.add('view-hidden'); updatePrices();
});

let activePromoCode = null; let activePromoDiscount = 0; 
const btnApplyPromo = document.getElementById('btn-apply-promo');
if (btnApplyPromo) {
    btnApplyPromo.addEventListener('click', async () => {
        const codeInput = document.getElementById('promo-input').value.trim().toUpperCase();
        const msgBox = document.getElementById('promo-message');
        
        if (!codeInput) { activePromoCode = null; activePromoDiscount = 0; msgBox.textContent = ""; updatePrices(); return; }
        btnApplyPromo.innerHTML = "<i class='fas fa-spinner fa-spin'></i>"; btnApplyPromo.disabled = true;

        try {
            const promoSnap = await getDoc(doc(db, "promo_codes", codeInput));
            if (promoSnap.exists()) {
                const data = promoSnap.data();
                if (data.isActive && (!data.expiryDate || new Date(data.expiryDate) > new Date())) {
                    activePromoCode = codeInput; activePromoDiscount = data.discountPercentage || 0;
                    msgBox.textContent = `✅ Promo applied: ${activePromoDiscount}% off!`; msgBox.style.color = '#34d399';
                    updatePrices();
                } else throw new Error("Expired or inactive.");
            } else throw new Error("Invalid promo code.");
        } catch (e) {
            activePromoCode = null; activePromoDiscount = 0;
            msgBox.textContent = `❌ ${e.message || "Invalid code"}`; msgBox.style.color = '#fca5a5';
            updatePrices();
        } finally { btnApplyPromo.textContent = "Apply"; btnApplyPromo.disabled = false; }
    });
}

function updatePrices() {
    const courseCount = document.querySelectorAll('.course-check:checked').length;
    const bookCount = document.querySelectorAll('.book-check:checked').length;
    const bookDiscount = bookCount >= 5 ? 0.30 : (bookCount >= 3 ? 0.20 : (bookCount >= 2 ? 0.10 : 0));

    const baseC = [100, 500, 800, 1200, 2500, 3500, 4500, 5000];
    const baseB = [20, 50, 80, 120, 250, 350, 450, 500];

    for(let i = 0; i < 8; i++) {
        let totalPrice = Math.round((courseCount > 0 ? baseC[i] : 0) + ((bookCount * baseB[i]) * (1 - bookDiscount)));
        if (activePromoDiscount > 0) totalPrice = Math.round(totalPrice * (1 - (activePromoDiscount / 100)));
        const priceEl = document.getElementById('price-' + i);
        if(priceEl) priceEl.textContent = 'Rs. ' + totalPrice.toLocaleString();
    }
    const summaryText = document.getElementById('selected-courses-text');
    if (summaryText) summaryText.textContent = `${courseCount} Course | ${bookCount} Book${bookCount !== 1 ? 's' : ''}`;
}

document.querySelectorAll('.plan-card').forEach(card => {
    card.addEventListener('click', function() {
        document.querySelectorAll('.plan-card').forEach(c => { 
            c.classList.remove('selected'); 
            const lifePrice = c.querySelector('#price-7'); 
            if (lifePrice) lifePrice.classList.remove('text-orange'); 
        });
        this.classList.add('selected');
        const lifePrice = this.querySelector('#price-7'); 
        if (lifePrice) lifePrice.classList.add('text-orange');
    });
});

// === 7. PAYMENT UPLOAD & PROMO LOGIC ===
function compressImage(file) {
    return new Promise((resolve, reject) => {
        if (!file) return reject(new Error("No file"));
        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas'); const MAX_WIDTH = 800; let scale = 1;
                    if (img.width > MAX_WIDTH) scale = MAX_WIDTH / img.width;
                    canvas.width = img.width * scale; canvas.height = img.height * scale;
                    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/jpeg', 0.6));
                } catch (err) { reject(err); }
            }
            img.onerror = () => reject(new Error("Invalid image")); img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error("Read failed")); reader.readAsDataURL(file);
    });
}

const btnSubmitPayment = document.getElementById('btn-submit-payment');
if (btnSubmitPayment) {
    btnSubmitPayment.addEventListener('click', async () => {
        if(!currentUserId) return alert("Authentication error.");
        btnSubmitPayment.textContent = "Submitting..."; btnSubmitPayment.disabled = true;

        try {
            const courses = Array.from(document.querySelectorAll('.course-check:checked')).map(cb => cb.value);
            const books = Array.from(document.querySelectorAll('.book-check:checked')).map(cb => cb.value);
            if (courses.length === 0 && books.length === 0) { alert("Select a course or book."); return; }

            const selectedPlan = document.querySelector('.plan-card.selected');
            if (!selectedPlan) throw new Error("No plan selected.");

            const file = document.getElementById('payment-proof').files[0];
            if (!file) { alert("Upload payment proof."); return; }

            let receiptUrl = "";
            try { receiptUrl = await compressImage(file); } 
            catch(e) { alert("Invalid picture format (JPG/PNG)."); return; }

            const submitPromise = addDoc(collection(db, "payment_requests"), {
                userId: currentUserId, userEmail: currentUserData?.email || (auth.currentUser ? auth.currentUser.email : "Unknown"),
                courses, books, durationDays: selectedPlan.getAttribute('data-days'), planName: selectedPlan.getAttribute('data-name'),
                receiptUrl, appliedPromoCode: activePromoCode, promoDiscountApplied: activePromoDiscount, status: 'pending', timestamp: serverTimestamp()
            });

            await Promise.race([submitPromise, new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout.")), 12000))]);
            alert("Payment request submitted successfully!");
            
            activePromoCode = null; activePromoDiscount = 0; document.getElementById('promo-input').value = ""; document.getElementById('promo-message').textContent = "";
            document.getElementById('premium-modal').classList.add('view-hidden');
        } catch (e) { alert("Failed to submit request: " + (e.message || "Unknown error.")); } 
        finally { btnSubmitPayment.textContent = "Confirm & Submit Request"; btnSubmitPayment.disabled = false; }
    });
}

// === 8. REDEEM CODE ===
const btnRedeem = document.getElementById('btn-submit-redeem');
if (btnRedeem) {
    btnRedeem.addEventListener('click', async () => {
        const codeInput = document.getElementById('redeem-input').value.trim().toUpperCase();
        if(codeInput.length < 3) return alert("Invalid code.");
        btnRedeem.textContent = "Verifying..."; btnRedeem.disabled = true;

        try {
            const keyRef = doc(db, "keys", codeInput); const keySnap = await getDoc(keyRef);
            if(!keySnap.exists()) { alert("Code invalid."); return; }
            
            const keyData = keySnap.data();
            if(keyData.usedCount >= keyData.maxUsage) { alert("Code limit reached."); return; }
            if(keyData.expiryDate && new Date(keyData.expiryDate) < new Date()) { alert("Code expired."); return; }

            let expiryValue = keyData.duration === "lifetime" ? "lifetime" : new Date(new Date().setDate(new Date().getDate() + parseInt(keyData.duration))).toISOString();
            let currentSubs = currentUserData.subscriptions || {};
            
            if(keyData.course === 'ALL') ['fcps_part1', 'fcps_part2', 'fcps_imm', 'mrcs_part1', 'mrcs_part2', 'mbbs_year1', 'mbbs_year2', 'mbbs_year3', 'mbbs_year4', 'mbbs_year5'].forEach(c => currentSubs[c] = expiryValue);
            else if (keyData.course && keyData.course !== 'NONE') currentSubs[keyData.course] = expiryValue;

            if (keyData.books && Array.isArray(keyData.books)) keyData.books.forEach(b => currentSubs[b] = expiryValue);

            await updateDoc(doc(db, "users", currentUserId), { subscriptions: currentSubs, isPremium: true });
            await updateDoc(keyRef, { usedCount: keyData.usedCount + 1 });
            alert("Code redeemed!"); window.location.reload();
        } catch (e) { alert("Error redeeming code."); } finally { btnRedeem.textContent = "Redeem Now"; btnRedeem.disabled = false; }
    });
}

// === 9. USER PROFILE MANAGEMENT ===
const btnOpenProfile = document.getElementById('btn-open-profile');
if (btnOpenProfile) {
    btnOpenProfile.addEventListener('click', () => {
        if (localStorage.getItem('edeetos_guest_mode') === 'true') return alert("Please register.");
        if (!currentUserData) return alert("Loading...");
        document.getElementById('profile-modal').classList.remove('view-hidden');
        
        document.getElementById('prof-role-badge').textContent = (currentUserData.role || 'STUDENT').toUpperCase();
        ['name', 'username', 'email', 'phone', 'uni', 'location', 'exam-date'].forEach(id => {
            const map = {name:'fullName', uni:'institution', 'exam-date':'examDate'};
            if (document.getElementById(`prof-${id}`)) document.getElementById(`prof-${id}`).value = currentUserData[map[id] || id] || '';
        });

        const displayField = document.getElementById('prof-course-display');
        if(displayField) displayField.value = currentUserData.selectedCourse ? (courseNamesMap[currentUserData.selectedCourse] || "Unknown Course") : "None (Action Required)";
        
        const btnChange = document.getElementById('btn-request-course-change');
        if (btnChange && currentUserData.courseChangeRequested) { btnChange.textContent = "Change Request Pending Admin Approval..."; btnChange.style.color = "#94a3b8"; btnChange.style.pointerEvents = "none"; }
        
        const subsList = document.getElementById('prof-subs-list'); subsList.innerHTML = '';
        let hasSubs = false;

        for (const [key, expiry] of Object.entries(currentUserData.subscriptions || {})) {
            hasSubs = true;
            const item = document.createElement('div'); item.className = 'sub-item';
            let badgeHtml = expiry === 'lifetime' ? '<span class="sub-tag sub-lifetime">Lifetime</span>' : (new Date(expiry) < new Date() ? '<span class="sub-tag sub-expired">Expired</span>' : `<span class="sub-tag sub-active">Active till ${new Date(expiry).toLocaleDateString()}</span>`);
            item.innerHTML = `<span class="sub-name">${mergedNamesMap[key] || key}</span>${badgeHtml}`;
            subsList.appendChild(item);
        }
        if (!hasSubs) subsList.innerHTML = '<div class="text-muted font-sm text-center p-1">No active subscriptions found.</div>';
    });
}

const btnRequestChange = document.getElementById('btn-request-course-change');
const courseChangeModal = document.getElementById('course-change-modal');

if (btnRequestChange && courseChangeModal) {
    btnRequestChange.addEventListener('click', () => courseChangeModal.classList.remove('view-hidden'));
    const btnSubmitChange = document.getElementById('btn-submit-course-change');
    if (btnSubmitChange) {
        btnSubmitChange.addEventListener('click', async () => {
            const newCourse = document.getElementById('new-course-request-select').value;
            if (!newCourse) return alert("Select a new course first.");
            btnSubmitChange.textContent = "Submitting..."; btnSubmitChange.disabled = true;
            try {
                await updateDoc(doc(db, "users", currentUserId), { courseChangeRequested: true, requestedCourse: newCourse });
                currentUserData.courseChangeRequested = true; currentUserData.requestedCourse = newCourse;
                btnRequestChange.textContent = "Change Request Pending..."; btnRequestChange.style.color = "#94a3b8"; btnRequestChange.style.pointerEvents = "none";
                alert(`Request to switch to ${courseNamesMap[newCourse] || newCourse} submitted!`);
                courseChangeModal.classList.add('view-hidden');
            } catch (error) { alert("Failed to submit request."); } finally { btnSubmitChange.textContent = "Submit Request"; btnSubmitChange.disabled = false; }
        });
    }
}

const profileForm = document.getElementById('profile-form');
if (profileForm) {
    profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btnSave = document.getElementById('btn-save-profile'); btnSave.textContent = "Saving..."; btnSave.disabled = true;
        try {
            await updateDoc(doc(db, "users", currentUserId), {
                fullName: document.getElementById('prof-name').value, phone: document.getElementById('prof-phone').value,
                institution: document.getElementById('prof-uni').value, location: document.getElementById('prof-location').value, examDate: document.getElementById('prof-exam-date').value 
            });
            ['name', 'phone', 'uni', 'location', 'exam-date'].forEach(id => { const map = {name:'fullName', uni:'institution', 'exam-date':'examDate'}; currentUserData[map[id] || id] = document.getElementById(`prof-${id}`).value; });
            document.getElementById('user-name').textContent = currentUserData.fullName;
            sessionStorage.setItem('edeetos_dash_cache', JSON.stringify(currentUserData)); 
            alert("Profile updated!"); document.getElementById('profile-modal').classList.add('view-hidden');
        } catch (error) { alert("Failed to update profile."); } finally { btnSave.textContent = "Save Profile Changes"; btnSave.disabled = false; }
    });
}

// === 10. GROUP STUDY (Create & Join) ===
const btnCreate = document.getElementById('btn-create-room');
if (btnCreate) {
    btnCreate.onclick = async () => {
        if (!currentUserId) return alert("Loading...");
        if (localStorage.getItem('edeetos_guest_mode') === 'true') return alert("Guest accounts cannot host Group Study.");

        const roomId = Math.floor(1000 + Math.random() * 9000).toString();
        const activeCourse = localStorage.getItem('edeetos_active_course') || currentUserData.selectedCourse || 'Unknown';
        btnCreate.textContent = "Creating..."; btnCreate.disabled = true;

        try {
            await setDoc(doc(db, "study_rooms", roomId), { hostId: currentUserId, course: activeCourse, currentQuestionIndex: 0, status: "waiting", createdAt: serverTimestamp() });
            
            const modal = document.getElementById('room-created-modal');
            document.getElementById('room-code-box').textContent = roomId;
            modal.classList.remove('view-hidden');
            
            document.getElementById('copy-room-code').onclick = () => { navigator.clipboard.writeText(roomId); document.getElementById('copy-room-code').innerHTML = "<i class='fas fa-check'></i> Copied"; };
            document.getElementById('enter-room').onclick = () => { localStorage.setItem('active_study_room', roomId); localStorage.removeItem('is_study_guest'); window.location.href = 'questions.html'; };
        } catch (error) { alert("Failed to create room."); } finally { btnCreate.textContent = "Create"; btnCreate.disabled = false; }
    };
}

const joinModal = document.getElementById('join-room-modal');
const btnJoin = document.getElementById('btn-join-room');
const btnSubmitJoin = document.getElementById('btn-submit-join');
const joinInput = document.getElementById('join-room-input');

if (btnJoin) {
    btnJoin.onclick = () => {
        if (localStorage.getItem('edeetos_guest_mode') === 'true') return alert("Guest accounts cannot join Group Study.");
        joinInput.value = ""; joinModal.classList.remove('view-hidden'); joinInput.focus();
    };
}

if (btnSubmitJoin) {
    btnSubmitJoin.onclick = async () => {
        const code = joinInput.value.trim();
        if (code.length !== 4) return alert("Please enter a valid 4-digit code.");
        btnSubmitJoin.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Verifying..."; btnSubmitJoin.disabled = true;

        try {
            const roomSnap = await getDoc(doc(db, "study_rooms", code));
            if (roomSnap.exists()) {
                const roomCourse = roomSnap.data().course;
                const subs = currentUserData.subscriptions || {}; const expiry = subs[roomCourse] || subs['ALL'];
                const role = (currentUserData.role || '').toUpperCase();
                let hasPremiumAccess = (expiry && (expiry === 'lifetime' || new Date(expiry) > new Date())) || role === 'ADMIN' || role === 'MANAGEMENT';

                if (!hasPremiumAccess) {
                    alert(`Access Denied 🛑\n\nThis room is studying the Premium Question Bank for ${courseNamesMap[roomCourse] || roomCourse}. You must have an active subscription for this course to join your friend!`);
                    joinModal.classList.add('view-hidden'); document.getElementById('premium-modal').classList.remove('view-hidden');
                    if (typeof updatePrices === 'function') updatePrices();
                    return;
                }

                localStorage.setItem('active_study_room', code); localStorage.setItem('is_study_guest', 'true'); 
                btnSubmitJoin.style.background = '#3b82f6'; btnSubmitJoin.style.borderColor = '#3b82f6'; btnSubmitJoin.textContent = "✅ Connected!";
                setTimeout(() => window.location.href = 'quiz.html', 800);
            } else alert("Room not found. Please double-check the code.");
        } catch (error) { alert("Error connecting to room."); } finally { btnSubmitJoin.textContent = "Join Room"; btnSubmitJoin.disabled = false; }
    };
}

// === 11. DARK MODE TOGGLE ===
document.addEventListener('DOMContentLoaded', () => {
    const darkModeBtn = document.getElementById('dark-mode-toggle');
    if (!darkModeBtn) return;
    const icon = darkModeBtn.querySelector('i');
    
    if (localStorage.getItem('theme') === 'dark') { document.documentElement.classList.add('dark-mode'); if (icon) { icon.classList.remove('fa-moon'); icon.classList.add('fa-sun'); } }

    darkModeBtn.addEventListener('click', () => {
        document.documentElement.classList.toggle('dark-mode');
        const isDark = document.documentElement.classList.contains('dark-mode');
        
        if (isDark) { if (icon) { icon.classList.remove('fa-moon'); icon.classList.add('fa-sun'); } localStorage.setItem('theme', 'dark'); } 
        else { if (icon) { icon.classList.remove('fa-sun'); icon.classList.add('fa-moon'); } localStorage.setItem('theme', 'light'); }
    });
});