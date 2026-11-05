/*
=========================================
INDEX OF FEATURES - ENTERPRISE SAAS
=========================================
1. FIREBASE IMPORTS & GLOBALS
2. DASHBOARD INIT & ROLE BADGES
3. SYSTEM TELEMETRY (NEW METRICS INTEGRATION)
4. NAVIGATION & UI TOGGLES
5. DYNAMIC MODALS (Tasks, Guests, Bans)
6. PREMIUM MODAL & COURSE SELECTOR
7. PAYMENT UPLOAD & PROMO LOGIC
8. REDEEM CODE
9. USER PROFILE MANAGEMENT
10. GROUP STUDY (Create & Join)
11. HARDWARE-ACCELERATED PHYSICS (MAGNETIC & GLOW)
=========================================
*/

// === 1. FIREBASE IMPORTS & GLOBALS ===
import { auth, db, functions, courseNamesMap, mergedNamesMap } from './firebase-config.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, updateDoc, addDoc, collection, setDoc, serverTimestamp, query, where, onSnapshot, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let currentUserData = null;
let currentUserId = null;
let hasCheckedDowngrade = false;

const idbCache = {
    async init() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open("EdeetosCacheDB", 1);
            req.onupgradeneeded = (e) => e.target.result.createObjectStore("user_profiles");
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    async set(uid, data) {
        try {
            const db = await this.init();
            const tx = db.transaction("user_profiles", "readwrite");
            tx.objectStore("user_profiles").put(data, uid);
        } catch(e) { console.warn("Cache write failed", e); }
    },
    async get(uid) {
        try {
            const db = await this.init();
            return new Promise((resolve) => {
                const tx = db.transaction("user_profiles", "readonly");
                const req = tx.objectStore("user_profiles").get(uid);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
            });
        } catch(e) { return null; }
    }
};

// === 2. DASHBOARD INIT & ROLE BADGES ===
onAuthStateChanged(auth, async (user) => {
    const freeWarning = document.getElementById('free-warning-text');
    const subStatus = document.getElementById('subscription-status');
    const userNameEl = document.getElementById('user-name');

    if (user) {
        currentUserId = user.uid;
        const userRef = doc(db, "users", user.uid);
        
        const cachedUser = await idbCache.get(user.uid);
        if (cachedUser && userNameEl.textContent === "Doctor") {
            let fName = cachedUser.fullName || "User";
            fName = fName.replace(/^Dr\.?\s*/i, '');
            userNameEl.textContent = `Dr. ${fName}`;
        }

        try {
            const docSnap = await getDoc(userRef);
            if (docSnap.exists()) {
                currentUserData = docSnap.data();
                idbCache.set(user.uid, currentUserData); 
                const userRoleUpper = (currentUserData.role || 'STUDENT').toUpperCase();
                
                // BAN CHECK
                if (currentUserData.isBanned || currentUserData.role === 'BANNED') {
                    userNameEl.textContent = "Account Suspended";
                    if (subStatus) { 
                        subStatus.textContent = "BANNED"; 
                        subStatus.className = "status-badge badge-banned"; 
                    }
                    renderLockoutScreen();
                    return; 
                }               
                
                // HEADER UI
                let cleanName = currentUserData.fullName || "User";
                cleanName = cleanName.replace(/^Dr\.?\s*/i, '');
                userNameEl.textContent = `Dr. ${cleanName}`;

                if (currentUserData.examDate) {
                    const today = new Date(); today.setHours(0, 0, 0, 0); 
                    const examD = new Date(currentUserData.examDate); examD.setHours(0, 0, 0, 0);
                    const diffDays = Math.ceil((examD - today) / (1000 * 60 * 60 * 24));
                    
                    const countdownContainer = document.getElementById('exam-countdown-container');
                    const countdownText = document.getElementById('exam-countdown-text');
                    
                    if (countdownContainer && countdownText) {
                        countdownContainer.classList.remove('view-hidden');
                        document.getElementById('dash-subtitle')?.classList.add('view-hidden');
                        
                        if (diffDays > 0) countdownText.textContent = `${diffDays} Days until Exam Day`;
                        else if (diffDays === 0) countdownText.textContent = "Exam Day is Today! Good Luck.";
                        else {
                            countdownText.textContent = "Exam Date has passed";
                            document.getElementById('exam-countdown-badge').className = "countdown-badge-expired";
                        }
                    }
                }
                
                const userCourseCode = currentUserData.selectedCourse; 
                const activeCourseEl = document.getElementById('active-course-name');
                if (activeCourseEl) {
                    activeCourseEl.textContent = userCourseCode ? (courseNamesMap[userCourseCode] || "Unknown Course") : "No Course Assigned";
                    if (!userCourseCode) activeCourseEl.classList.add('text-danger');
                }

                const dynamicCourseContainer = document.getElementById('dynamic-course-container');
                if (dynamicCourseContainer) {
                    dynamicCourseContainer.innerHTML = '';
                    if (userCourseCode) {
                        const label = document.createElement('label');
                        label.className = 'course-checkbox-label cursor-pointer font-bold';
                        
                        const input = document.createElement('input');
                        input.type = 'checkbox';
                        input.className = 'course-check';
                        input.value = userCourseCode;
                        input.checked = false; // Bug fix: Removed default checking behavior
                        
                        label.appendChild(input);
                        label.appendChild(document.createTextNode(` ${courseNamesMap[userCourseCode] || "Unknown Course"}`));
                        dynamicCourseContainer.appendChild(label);
                    } else {
                        const div = document.createElement('div');
                        div.className = 'font-xs font-bold text-danger';
                        div.style.fontFamily = "'Courier New', monospace";
                        div.textContent = 'Action Required: Please select a course in your Profile.';
                        dynamicCourseContainer.appendChild(div);
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
                    updateDoc(userRef, { isPremium: false }).catch(err => console.error("Downgrade failed:", err));
                }

                // ROLE UI BADGES
                if(subStatus) subStatus.className = "status-badge";
                if (userRoleUpper === 'MANAGEMENT' || userRoleUpper === 'ADMIN') {
                    if(subStatus) { subStatus.textContent = "ADMIN"; subStatus.classList.add('badge-role-admin'); }
                    document.getElementById('btn-admin-panel').classList.remove('view-hidden');
                    if (freeWarning) freeWarning.classList.add('view-hidden');
                } else if (userRoleUpper === 'MENTOR') {
                    if(subStatus) { subStatus.textContent = "MENTOR"; subStatus.classList.add('badge-role-mentor'); }
                    if (freeWarning) freeWarning.classList.add('view-hidden');
                } else if (hasActiveSubscription) { 
                    if(subStatus) { subStatus.textContent = "PREMIUM"; subStatus.classList.add('badge-role-student'); }
                    if (freeWarning) freeWarning.classList.add('view-hidden');
                } else {
                    if(subStatus) { subStatus.textContent = "FREE TIER"; subStatus.classList.add('badge-role-student'); }
                    if (freeWarning) { 
                        freeWarning.classList.remove('view-hidden'); 
                        freeWarning.textContent = "(Free Tier Limit: 50 Questions / Subject)"; 
                    }
                }
                
const btnReports = document.getElementById('btn-reports-panel');
                if (btnReports) btnReports.classList.remove('view-hidden');
                
                if (userRoleUpper === 'MENTOR' || userRoleUpper === 'MANAGEMENT' || userRoleUpper === 'ADMIN') {
                    const btnMentor = document.getElementById('btn-contact-mentor');
                    if (btnMentor) {
                        btnMentor.textContent = "Open Mentor Dashboard";
                        const cardH3 = document.getElementById('mentor-card-title');
                        const cardP = document.getElementById('mentor-card-desc');
                        if (cardH3) cardH3.textContent = "Mentor Hub";
                        if (cardP) cardP.textContent = "Manage incoming messages from students.";
                    }

                    setupMentorStatus();
                    setupMentorAlerts();
                }

                // ASSIGNED EXAMS UI
                if (userRoleUpper === 'STUDENT' || hasActiveSubscription) checkAssignedExams();
                
                // POPULATE SYSTEM TELEMETRY (METRICS)
                await loadSystemTelemetry(user.uid, currentUserData.selectedCourse);

            }
        } catch (error) { console.error("Data fetch failed:", error); }
    } else {
        // GUEST MODE
        if (localStorage.getItem('edeetos_guest_mode') === 'true') {
            userNameEl.textContent = "Guest User";
            if(subStatus) { 
                subStatus.textContent = "GUEST MODE"; 
                subStatus.className = "status-badge badge-free"; 
            }
            if (freeWarning) { 
                freeWarning.classList.remove('view-hidden'); 
                freeWarning.textContent = "(Guest Limit: 20 Questions / Subject)"; 
                freeWarning.classList.add('text-muted'); 
            }
        } else {
            window.location.href = 'index.html'; 
        }
    }
});

// === 3. SYSTEM TELEMETRY (NEW METRICS INTEGRATION) ===
async function loadSystemTelemetry(uid, activeCourse) {
    if (!activeCourse) activeCourse = 'fcps_part1';
    
    try {
        const fetchShard = async (folder, docName) => {
            try { 
                const snap = await getDoc(doc(db, "users", uid, folder, docName)); 
                return snap.exists() ? snap.data() : {}; 
            } catch(e) { return {}; }
        };

        const [cSol, cMis, cBkm, cHis, bSol, bMis, bBkm, bHis] = await Promise.all([
            fetchShard(activeCourse, "solved"), fetchShard(activeCourse, "mistakes"), 
            fetchShard(activeCourse, "bookmarks"), fetchShard(activeCourse, "history"),
            fetchShard("books", "solved"), fetchShard("books", "mistakes"), 
            fetchShard("books", "bookmarks"), fetchShard("books", "history")
        ]);

        const solvedList = [...new Set([...(cSol.list || []), ...(bSol.list || [])])];
        const practiceMistakes = [...(cMis.practice || []), ...(bMis.practice || [])];
        const examMistakes = [...(cMis.exam || []), ...(bMis.exam || [])];
        const historicalMistakes = [...(cMis.historical || []), ...(bMis.historical || [])];
        const allMistakesUnique = [...new Set([...practiceMistakes, ...examMistakes])];
        const bookmarksList = [...new Set([...(cBkm.list || []), ...(bBkm.list || [])])];

        const uniqueAttempts = [...new Set([...solvedList, ...allMistakesUnique, ...historicalMistakes])];
        const firstTryCorrect = uniqueAttempts.filter(id => !historicalMistakes.includes(id) && !allMistakesUnique.includes(id));
        const accuracy = uniqueAttempts.length > 0 ? Math.round((firstTryCorrect.length / uniqueAttempts.length) * 100) : 0;

        document.getElementById('stat-solved').textContent = solvedList.length;
        document.getElementById('stat-mistakes').textContent = allMistakesUnique.length;
        document.getElementById('stat-bookmarks').textContent = bookmarksList.length;
        document.getElementById('stat-accuracy').textContent = `${accuracy}%`;

    } catch (err) {
        console.error("Telemetry failure:", err);
    }
}

// === 4. NAVIGATION & UI TOGGLES ===
document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('edeetos_guest_mode'); 
    signOut(auth).then(() => { window.location.href = 'index.html'; }).catch(() => { window.location.href = 'index.html'; });
});

const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const navActionsMenu = document.getElementById('nav-actions-menu');
const closeMenuBtn = document.getElementById('close-menu-btn');

if (mobileMenuBtn && navActionsMenu) {
    mobileMenuBtn.addEventListener('click', () => {
        navActionsMenu.classList.add('sidebar-active');
    });
}

if (closeMenuBtn && navActionsMenu) {
    closeMenuBtn.addEventListener('click', () => {
        navActionsMenu.classList.remove('sidebar-active');
    });
}

const btnAdminPanel = document.getElementById('btn-admin-panel');
if (btnAdminPanel) btnAdminPanel.addEventListener('click', () => window.location.href = 'admin.html');

const btnReportsPanel = document.getElementById('btn-reports-panel');
if (btnReportsPanel) btnReportsPanel.addEventListener('click', () => window.location.href = 'reports.html?v=7');

const btnStudyVault = document.getElementById('btn-study-vault');
if (btnStudyVault) btnStudyVault.addEventListener('click', () => alert('The Study Vault is currently under construction. Check back soon!'));

const btnContactMentor = document.getElementById('btn-contact-mentor');
if (btnContactMentor) {
    btnContactMentor.addEventListener('click', () => {
        if (localStorage.getItem('edeetos_guest_mode') === 'true') return alert("Please register to contact a mentor.");
        window.location.href = 'mentor.html';
    });
}

document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.addEventListener('click', (e) => e.target.closest('.popup-overlay').classList.add('view-hidden'));
});

// === 5. DYNAMIC MODALS (Tasks, Guests, Bans) ===
function renderLockoutScreen() {
    const lockoutModal = document.getElementById('lockout-screen');
    if (!lockoutModal) return;
    
    lockoutModal.classList.remove('view-hidden');
    document.body.style.overflow = 'hidden';

    document.getElementById('btn-submit-appeal').addEventListener('click', async (e) => {
        const text = document.getElementById('appeal-text').value.trim();
        if (!text) return alert("Please explain the situation before submitting.");
        
        const btn = e.target;
        btn.textContent = "Submitting...";
        btn.disabled = true;
        
        try {
            const user = auth.currentUser;
            await addDoc(collection(db, "ban_appeals"), {
                userId: user.uid,
                userEmail: user.email,
                appealText: text,
                status: 'pending',
                timestamp: serverTimestamp()
            });
            alert("Your appeal has been sent. The admin team will review it shortly.");
            btn.textContent = "Appeal Sent";
        } catch(err) {
            alert("Failed to submit appeal.");
            btn.textContent = "Submit Appeal";
            btn.disabled = false;
        }
    });
    
    document.getElementById('btn-banned-logout').addEventListener('click', () => {
        document.getElementById('btn-banned-logout').textContent = "Logging out...";
        signOut(auth).then(() => window.location.href = 'index.html').catch(() => window.location.href = 'index.html');
    });
}

function setupMentorStatus() {
    const btnMentorStatus = document.getElementById('btn-mentor-status');
    if (!btnMentorStatus) return;
    btnMentorStatus.classList.remove('view-hidden');
    
    const iconSpan = btnMentorStatus.querySelector('.status-icon');
    const textSpan = btnMentorStatus.querySelector('.status-text');
    let isOnline = currentUserData.isOnline || false;

    const updateStatusUI = (status) => {
        if (status) { 
            iconSpan.innerHTML = '<i class="fa-solid fa-circle text-success"></i>';
            textSpan.textContent = 'Available';
            btnMentorStatus.classList.remove('mentor-offline');
            btnMentorStatus.classList.add('mentor-online');
        } else { 
            iconSpan.innerHTML = '<i class="fa-solid fa-circle text-muted"></i>';
            textSpan.textContent = 'Offline';
            btnMentorStatus.classList.remove('mentor-online');
            btnMentorStatus.classList.add('mentor-offline');
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
    // Query only by status to avoid Firebase composite index errors, filter 'live' client-side
    const chatsRef = collection(db, "chats");
    const q = query(chatsRef, where("status", "==", "pending"));
    
    onSnapshot(q, (snapshot) => {
        const banner = document.getElementById('mentor-alert-banner');
        if(!banner) return;
        
        let hasLiveRequest = false;
        snapshot.forEach(docSnap => {
            if (docSnap.data().type === 'live') hasLiveRequest = true;
        });
        
        if (hasLiveRequest) {
            banner.innerHTML = '<i class="fa-solid fa-message text-primary"></i> <span>Live student request waiting in the global pool. Click to claim.</span>';
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
            if(!container || container.children.length > 0) return; 
            
            const tmpl = document.getElementById('task-notify-template');
            if(tmpl) {
                const clone = tmpl.content.cloneNode(true);
                const countSpan = clone.querySelector('.task-count');
                
                countSpan.textContent = `${pendingExams.length}`;
                container.appendChild(clone);
                
                const taskModal = document.getElementById('assigned-tasks-modal');
                const taskListContainer = document.getElementById('task-list-container');
                taskListContainer.innerHTML = '';
                
pendingExams.forEach((exam, index) => {
                            const cardDiv = document.createElement('div');
                            cardDiv.className = 'task-item-card';
                            
                            const infoDiv = document.createElement('div');
                            infoDiv.className = 'flex-1 text-left';
                            
                            const titleDiv = document.createElement('div');
                    titleDiv.className = 'task-item-title m-0 mb-05';
                    titleDiv.textContent = exam.title;
                    
                    const badgeRow = document.createElement('div');
                    badgeRow.className = 'flex-row gap-10px';
                    
                    const timeBadge = document.createElement('span');
                    timeBadge.className = 'task-badge-time font-xs p-1 border-radius';
                    timeBadge.style.border = "1px solid var(--border-color)";
                    timeBadge.textContent = `⏱ ${exam.timerMinutes} MIN`;
                    
                    const countBadge = document.createElement('span');
                    countBadge.className = 'task-badge-count font-xs p-1 border-radius';
                    countBadge.style.border = "1px solid var(--border-color)";
                    countBadge.textContent = `📋 ${exam.questions.length} Q`;
                    
                    badgeRow.appendChild(timeBadge);
                    badgeRow.appendChild(countBadge);
                    
                    infoDiv.appendChild(titleDiv);
                    infoDiv.appendChild(badgeRow);
                    
                    const launchBtn = document.createElement('button');
                    launchBtn.id = `launch-assigned-${index}`;
                    launchBtn.className = 'action-btn next-btn';
                    launchBtn.textContent = 'Start';
                    
                    cardDiv.appendChild(infoDiv);
                    cardDiv.appendChild(launchBtn);
                    taskListContainer.appendChild(cardDiv);
});

// Bulletproof click binding: catches the button and the card reliably
                        container.addEventListener('click', (e) => {
                            e.preventDefault();
                            taskModal.classList.remove('view-hidden');
                        });
                        
                        document.getElementById('close-tasks-modal').onclick = () => taskModal.classList.add('view-hidden');

                pendingExams.forEach((exam, index) => {
                    const launchBtn = document.getElementById(`launch-assigned-${index}`);
                    launchBtn.addEventListener('click', async () => {
                        launchBtn.textContent = 'Loading...';
                        launchBtn.classList.add('btn-loading');
                        
                        if (exam.course) localStorage.setItem('edeetos_active_course', exam.course);
                        localStorage.setItem('edeetos_quiz_config', JSON.stringify({ mode: 'exam', timer: exam.timerMinutes, examName: exam.title }));
                        localStorage.setItem('edeetos_assigned_exam_id', exam.id);
                        localStorage.removeItem('edeetos_aborted_session_backup');
                        localStorage.removeItem('edeetos_quiz_state');

                        let hydratedQueue = [];
                        try {
                            const activeCourse = exam.course || localStorage.getItem('edeetos_active_course') || 'fcps_part1';
                            const hierarchyRes = await fetch(`Data/${activeCourse}_hierarchy.json`);
                            const hierarchyData = await hierarchyRes.json();
                            const subjects = Object.keys(hierarchyData.subjects || {});
                            
                            const metaPromises = subjects.map(async (subj) => {
                                const subjClean = String(subj).toLowerCase().trim().replace(/[\\/*?:"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
                                try {
                                    const res = await fetch(`Data/${activeCourse}/metadata/${subjClean}.json`);
                                    if (res.ok) return await res.json();
                                } catch(e) {}
                                return [];
                            });
                            
                            const allMetaArrays = await Promise.all(metaPromises);
                            const globalMetadata = allMetaArrays.flat();
                            
                            const chunksToLoad = new Set();
                            if (exam.questionIds) {
                                exam.questionIds.forEach(id => {
                                    const meta = globalMetadata.find(q => String(q.id || q.QuestionID) === String(id));
                                    if (meta) {
                                        const s = String(meta.Subject || meta.subject).toLowerCase().trim().replace(/[\\/*?:"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
                                        const c = String(meta.Chapter || meta.chapter).toLowerCase().trim().replace(/[\\/*?:"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
                                        chunksToLoad.add(`Data/${activeCourse}/subjects/${s}_${c}.json`);
                                    }
                                });
                            }

                            const activeChunksCache = {};
                            const fetchPromises = Array.from(chunksToLoad).map(async (baseUrl) => {
                                let page = 1;
                                let keepFetching = true;
                                while (keepFetching) {
                                    const pageUrl = baseUrl.replace('.json', `_${page}.json`);
                                    try {
                                        const res = await fetch(pageUrl);
                                        if (res.ok) activeChunksCache[pageUrl] = await res.json();
                                        else keepFetching = false;
                                    } catch(e) { keepFetching = false; }
                                    page++;
                                }
                            });
                            await Promise.all(fetchPromises);

                            const fullQuestionsMap = {};
                            Object.values(activeChunksCache).forEach(chunkArray => {
                                chunkArray.forEach(fullQ => {
                                    const qId = fullQ.id || fullQ.QuestionID;
                                    if (qId) fullQuestionsMap[String(qId)] = fullQ;
                                });
                            });

                            hydratedQueue = (exam.questionIds || []).map(id => fullQuestionsMap[String(id)]).filter(q => q);
                        } catch (err) { console.error("Failed to load questions:", err); }

                        if (hydratedQueue.length === 0) {
                            launchBtn.textContent = "Start"; 
                            launchBtn.classList.remove('btn-loading');
                            return alert("Failed to load the questions for this exam.");
                        }

                        const request = indexedDB.open("EdeetosDB", 1);
                        request.onupgradeneeded = (e) => { if (!e.target.result.objectStoreNames.contains("quiz_sessions")) e.target.result.createObjectStore("quiz_sessions"); };
                        request.onsuccess = (e) => {
                            const tx = e.target.result.transaction("quiz_sessions", "readwrite");
                            tx.objectStore("quiz_sessions").put(hydratedQueue, "active_quiz_queue");
                            tx.oncomplete = () => window.location.href = 'quiz.html';
                        };
                        request.onerror = (e) => { 
                            alert("Storage error. Please try again."); 
                            launchBtn.textContent = "Start"; 
                            launchBtn.classList.remove('btn-loading'); 
                        };
                    });
                });
            }
        }
    } catch (examErr) { console.error("Error fetching tasks:", examErr); }
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
        
        if (currentUserData.selectedCourse) { 
            localStorage.setItem('edeetos_active_course', currentUserData.selectedCourse); 
            window.location.href = 'questions.html'; 
        } else if (activeSub) { 
            localStorage.setItem('edeetos_active_course', activeSub); 
            window.location.href = 'questions.html'; 
        } else { 
            alert("You don't have a course assigned. Please select one in your Profile."); 
        }
    }
});

const btnOpenFlashcards = document.getElementById('btn-open-flashcards');
if (btnOpenFlashcards) {
    btnOpenFlashcards.addEventListener('click', () => {
        if (localStorage.getItem('edeetos_guest_mode') === 'true') return alert("Please create an account to access Flashcards.");
        if (currentUserData) {
            let activeSub = currentUserData.subscriptions ? Object.keys(currentUserData.subscriptions)[0] : null;
            if (currentUserData.selectedCourse || activeSub) {
                localStorage.setItem('edeetos_active_course', currentUserData.selectedCourse || activeSub);
                window.location.href = 'flashcards.html';
            } else { alert("You don't have a course assigned. Please select one in your Profile."); }
        }
    });
}

// === 6. PREMIUM MODAL & COURSE SELECTOR ===
document.getElementById('btn-open-premium').addEventListener('click', () => {
    if (localStorage.getItem('edeetos_guest_mode') === 'true') return alert("Please create an account to get Premium.");
    document.getElementById('premium-modal').classList.remove('view-hidden');
    updatePrices();
});

const tabBuy = document.getElementById('tab-buy'); 
const tabRedeem = document.getElementById('tab-redeem');
const viewBuy = document.getElementById('view-buy'); 
const viewRedeem = document.getElementById('view-redeem');

if(tabBuy) tabBuy.addEventListener('click', () => { 
    tabBuy.className = 'active-tab'; 
    tabRedeem.className = 'inactive-tab'; 
    viewBuy.classList.remove('view-hidden'); 
    viewRedeem.classList.add('view-hidden'); 
});

if(tabRedeem) tabRedeem.addEventListener('click', () => { 
    tabRedeem.className = 'active-tab'; 
    tabBuy.className = 'inactive-tab'; 
    viewRedeem.classList.remove('view-hidden'); 
    viewBuy.classList.add('view-hidden'); 
});

const courseSelectorModal = document.getElementById('course-selector-modal');
document.getElementById('btn-open-course-selector').addEventListener('click', () => courseSelectorModal.classList.remove('view-hidden'));
document.getElementById('btn-confirm-courses').addEventListener('click', () => {
    if (document.querySelectorAll('.course-check:checked').length === 0 && document.querySelectorAll('.book-check:checked').length === 0) return alert("Please select at least one course or book.");
    courseSelectorModal.classList.add('view-hidden'); updatePrices();
});

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
    if (summaryText) summaryText.textContent = `${courseCount} Course | ${bookCount} Books`;
}

document.querySelectorAll('.plan-card').forEach(card => {
    card.addEventListener('click', function() {
        document.querySelectorAll('.plan-card').forEach(c => { 
            c.classList.remove('selected'); 
        });
        this.classList.add('selected');
    });
});

// === 7. PAYMENT UPLOAD & PROMO LOGIC ===
const fileInput = document.getElementById('payment-proof');
const fileNameDisplay = document.getElementById('file-name-display');

if (fileInput && fileNameDisplay) {
    fileInput.addEventListener('change', function() {
        if (this.files && this.files[0]) {
            fileNameDisplay.textContent = this.files[0].name;
            fileNameDisplay.classList.add('file-uploaded');
        } else {
            fileNameDisplay.textContent = 'Click to upload receipt image';
            fileNameDisplay.classList.remove('file-uploaded');
        }
    });
}

let activePromoCode = null; let activePromoDiscount = 0; 
const btnApplyPromo = document.getElementById('btn-apply-promo');
if (btnApplyPromo) {
    btnApplyPromo.addEventListener('click', async () => {
        const codeInput = document.getElementById('promo-input').value.trim().toUpperCase();
        const msgBox = document.getElementById('promo-message');
        
        if (!codeInput) { 
            activePromoCode = null; activePromoDiscount = 0; 
            msgBox.textContent = ""; 
            updatePrices(); 
            return; 
        }
        
        btnApplyPromo.textContent = "Checking..."; 
        btnApplyPromo.disabled = true;

        try {
            const promoSnap = await getDoc(doc(db, "promo_codes", codeInput));
            if (promoSnap.exists()) {
                const data = promoSnap.data();
                if (data.isActive && (!data.expiryDate || new Date(data.expiryDate) > new Date())) {
                    activePromoCode = codeInput; 
                    activePromoDiscount = data.discountPercentage || 0;
                    msgBox.textContent = `Promo applied! You get ${activePromoDiscount}% off.`; 
                    msgBox.className = 'font-sm font-bold text-left mb-1-5 text-success';
                    updatePrices();
                } else throw new Error("This promo code has expired.");
            } else throw new Error("Invalid promo code.");
        } catch (e) {
            activePromoCode = null; activePromoDiscount = 0;
            msgBox.textContent = e.message || "Invalid code"; 
            msgBox.className = 'font-sm font-bold text-left mb-1-5 text-danger';
            updatePrices();
        } finally { btnApplyPromo.textContent = "Apply"; btnApplyPromo.disabled = false; }
    });
}

function compressImage(file) {
    return new Promise((resolve, reject) => {
        if (!file) return reject(new Error("No file selected"));
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
            img.onerror = () => reject(new Error("Invalid image format")); img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error("Failed to read file")); reader.readAsDataURL(file);
    });
}

const btnSubmitPayment = document.getElementById('btn-submit-payment');
if (btnSubmitPayment) {
    btnSubmitPayment.addEventListener('click', async () => {
        if(!currentUserId) return alert("You must be logged in.");
        btnSubmitPayment.textContent = "Submitting Request..."; btnSubmitPayment.disabled = true;

        try {
            const courses = Array.from(document.querySelectorAll('.course-check:checked')).map(cb => cb.value);
            const books = Array.from(document.querySelectorAll('.book-check:checked')).map(cb => cb.value);
            if (courses.length === 0 && books.length === 0) { alert("Please select a course or book to purchase."); return; }

            const selectedPlan = document.querySelector('.plan-card.selected');
            if (!selectedPlan) throw new Error("Please select a plan duration.");

            const file = document.getElementById('payment-proof').files[0];
            if (!file) { alert("Please upload a picture of your receipt."); return; }

            let receiptUrl = "";
            try { receiptUrl = await compressImage(file); } 
            catch(e) { alert("Invalid picture format. Please upload a JPG or PNG."); return; }

            const submitPromise = addDoc(collection(db, "payment_requests"), {
                userId: currentUserId, userEmail: currentUserData?.email || (auth.currentUser ? auth.currentUser.email : "Unknown"),
                courses, books, durationDays: selectedPlan.getAttribute('data-days'), planName: selectedPlan.getAttribute('data-name'),
                receiptUrl, appliedPromoCode: activePromoCode, promoDiscountApplied: activePromoDiscount, status: 'pending', timestamp: serverTimestamp()
            });

            await Promise.race([submitPromise, new Promise((_, reject) => setTimeout(() => reject(new Error("Connection timeout. Please check your internet.")), 12000))]);
            alert("Your request has been submitted successfully! We will review it shortly.");
            
            activePromoCode = null; activePromoDiscount = 0; 
            document.getElementById('promo-input').value = ""; 
            document.getElementById('promo-message').textContent = "";
            document.getElementById('premium-modal').classList.add('view-hidden');
        } catch (e) { alert("Failed to submit request: " + (e.message || "Unknown error.")); } 
        finally { btnSubmitPayment.textContent = "Submit Payment Request"; btnSubmitPayment.disabled = false; }
    });
}

// === 8. REDEEM CODE ===
const btnRedeem = document.getElementById('btn-submit-redeem');
if (btnRedeem) {
    btnRedeem.addEventListener('click', async () => {
        const codeInput = document.getElementById('redeem-input').value.trim().toUpperCase();
        if(codeInput.length < 3) return alert("Please enter a valid code.");
        btnRedeem.textContent = "Checking Code..."; btnRedeem.disabled = true;

        try {
            const keyRef = doc(db, "keys", codeInput); const keySnap = await getDoc(keyRef);
            if(!keySnap.exists()) { alert("That code doesn't exist."); return; }
            
            const keyData = keySnap.data();
            if(keyData.usedCount >= keyData.maxUsage) { alert("This code has already been used the maximum number of times."); return; }
            if(keyData.expiryDate && new Date(keyData.expiryDate) < new Date()) { alert("This code has expired."); return; }

            let expiryValue = keyData.duration === "lifetime" ? "lifetime" : new Date(new Date().setDate(new Date().getDate() + parseInt(keyData.duration))).toISOString();
            let currentSubs = currentUserData.subscriptions || {};
            
            if(keyData.course === 'ALL') ['fcps_part1', 'fcps_part2', 'fcps_imm', 'mrcs_part1', 'mrcs_part2', 'mbbs_year1', 'mbbs_year2', 'mbbs_year3', 'mbbs_year4', 'mbbs_year5'].forEach(c => currentSubs[c] = expiryValue);
            else if (keyData.course && keyData.course !== 'NONE') currentSubs[keyData.course] = expiryValue;

            if (keyData.books && Array.isArray(keyData.books)) keyData.books.forEach(b => currentSubs[b] = expiryValue);

            await updateDoc(doc(db, "users", currentUserId), { subscriptions: currentSubs, isPremium: true });
            await updateDoc(keyRef, { usedCount: keyData.usedCount + 1 });
            alert("Success! Code redeemed. Reloading your dashboard."); window.location.reload();
        } catch (e) { alert("There was an error redeeming your code."); } finally { btnRedeem.textContent = "Redeem Code"; btnRedeem.disabled = false; }
    });
}

// === 9. USER PROFILE MANAGEMENT ===
const btnOpenProfile = document.getElementById('btn-open-profile');
if (btnOpenProfile) {
    btnOpenProfile.addEventListener('click', () => {
        if (localStorage.getItem('edeetos_guest_mode') === 'true') return alert("Please register an account to set up your profile.");
        if (!currentUserData) return alert("Loading your profile data...");
        document.getElementById('profile-modal').classList.remove('view-hidden');
        
        const roleUpper = (currentUserData.role || 'STUDENT').toUpperCase();
        const badgeEl = document.getElementById('prof-role-badge');
        badgeEl.textContent = roleUpper;
        badgeEl.className = "status-badge mt-05";
        if (roleUpper === 'ADMIN' || roleUpper === 'MANAGEMENT') badgeEl.classList.add('badge-role-admin');
        else if (roleUpper === 'MENTOR') badgeEl.classList.add('badge-role-mentor');
        else badgeEl.classList.add('badge-role-student');

        ['name', 'username', 'email', 'phone', 'uni', 'location', 'exam-date'].forEach(id => {
            const map = {name:'fullName', uni:'institution', 'exam-date':'examDate'};
            if (document.getElementById(`prof-${id}`)) document.getElementById(`prof-${id}`).value = currentUserData[map[id] || id] || '';
        });

        const displayField = document.getElementById('prof-course-display');
        if(displayField) displayField.value = currentUserData.selectedCourse ? (courseNamesMap[currentUserData.selectedCourse] || "Unknown Course") : "None Selected";
        
        const btnChange = document.getElementById('btn-request-course-change');
        if (btnChange && currentUserData.courseChangeRequested) { 
            btnChange.textContent = "Change Pending Admin Approval"; 
            btnChange.classList.add('btn-pending'); 
        }
        
        const subsList = document.getElementById('prof-subs-list'); 
        subsList.innerHTML = '';
        let hasSubs = false;

        for (const [key, expiry] of Object.entries(currentUserData.subscriptions || {})) {
            hasSubs = true;
            const item = document.createElement('div'); 
            item.className = 'sub-item';
            
            const nameSpan = document.createElement('span');
            nameSpan.className = 'sub-name';
            nameSpan.textContent = mergedNamesMap[key] || key;
            
            const badgeSpan = document.createElement('span');
            badgeSpan.className = "font-xs font-bold p-1 border-radius sub-tag";
            
            if (expiry === 'lifetime') {
                badgeSpan.style.color = "var(--primary-ui)";
                badgeSpan.style.borderColor = "var(--primary-ui)";
                badgeSpan.textContent = 'Lifetime Access';
            } else if (new Date(expiry) < new Date()) {
                badgeSpan.style.color = "var(--danger)";
                badgeSpan.style.borderColor = "var(--danger)";
                badgeSpan.textContent = 'Expired';
            } else {
                badgeSpan.style.color = "var(--success)";
                badgeSpan.style.borderColor = "var(--success)";
                badgeSpan.textContent = `Valid until ${new Date(expiry).toLocaleDateString()}`;
            }
            
            item.appendChild(nameSpan);
            item.appendChild(badgeSpan);
            subsList.appendChild(item);
        }
        if (!hasSubs) {
            const p = document.createElement('div');
            p.className = 'text-muted font-sm text-center p-1 font-bold';
            p.style.fontFamily = "'Courier New', monospace";
            p.textContent = 'No active subscriptions found.';
            subsList.appendChild(p);
        }
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
            if (!newCourse) return alert("Please select the course you want to switch to.");
            btnSubmitChange.textContent = "Sending Request..."; btnSubmitChange.disabled = true;
            try {
                await updateDoc(doc(db, "users", currentUserId), { courseChangeRequested: true, requestedCourse: newCourse });
                currentUserData.courseChangeRequested = true; currentUserData.requestedCourse = newCourse;
                btnRequestChange.textContent = "Change Pending Admin Approval"; 
                btnRequestChange.classList.add('btn-pending');
                alert(`Your request to switch to ${courseNamesMap[newCourse] || newCourse} has been sent!`);
                courseChangeModal.classList.add('view-hidden');
            } catch (error) { alert("Failed to send request."); } finally { btnSubmitChange.textContent = "Submit Request"; btnSubmitChange.disabled = false; }
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
            
            let cleanName = currentUserData.fullName;
            cleanName = cleanName.replace(/^Dr\.?\s*/i, '');
            document.getElementById('user-name').textContent = `Dr. ${cleanName}`;
            
            idbCache.set(currentUserId, JSON.parse(JSON.stringify(currentUserData))); 
            
            alert("Profile saved successfully!"); document.getElementById('profile-modal').classList.add('view-hidden');
        } catch (error) { alert("Failed to save profile."); } finally { btnSave.textContent = "Save Profile"; btnSave.disabled = false; }
    });
}

// === 10. GROUP STUDY (Create & Join) ===
const btnCreate = document.getElementById('btn-create-room');
if (btnCreate) {
    btnCreate.onclick = async () => {
        if (!currentUserId) return alert("Loading your details...");
        if (localStorage.getItem('edeetos_guest_mode') === 'true') return alert("Guest users cannot host Group Study sessions.");

        const roomId = Math.floor(1000 + Math.random() * 9000).toString();
        const activeCourse = localStorage.getItem('edeetos_active_course') || currentUserData.selectedCourse || 'Unknown';
        btnCreate.textContent = "Creating..."; btnCreate.disabled = true;

        try {
            await setDoc(doc(db, "study_rooms", roomId), { hostId: currentUserId, course: activeCourse, currentQuestionIndex: 0, status: "waiting", createdAt: serverTimestamp() });
            
            const modal = document.getElementById('room-created-modal');
            document.getElementById('room-code-box').textContent = roomId;
            modal.classList.remove('view-hidden');
            
            document.getElementById('copy-room-code').onclick = () => { 
                navigator.clipboard.writeText(roomId); 
                document.getElementById('copy-room-code').innerHTML = '<i class="fas fa-check"></i> Copied'; 
            };
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
        if (localStorage.getItem('edeetos_guest_mode') === 'true') return alert("Guest users cannot join Group Study sessions.");
        joinInput.value = ""; joinModal.classList.remove('view-hidden'); joinInput.focus();
    };
}

if (btnSubmitJoin) {
    btnSubmitJoin.onclick = async () => {
        const code = joinInput.value.trim();
        if (code.length !== 4) return alert("Please enter a valid 4-digit code.");
        btnSubmitJoin.textContent = "Connecting..."; 
        btnSubmitJoin.disabled = true;

        try {
            const roomSnap = await getDoc(doc(db, "study_rooms", code));
            if (roomSnap.exists()) {
                const roomCourse = roomSnap.data().course;
                const subs = currentUserData.subscriptions || {}; const expiry = subs[roomCourse] || subs['ALL'];
                const role = (currentUserData.role || '').toUpperCase();
                let hasPremiumAccess = (expiry && (expiry === 'lifetime' || new Date(expiry) > new Date())) || role === 'ADMIN' || role === 'MANAGEMENT';

                if (!hasPremiumAccess) {
                    alert(`Access Denied\n\nThis room is studying the Premium Question Bank for ${courseNamesMap[roomCourse] || roomCourse}. You must have an active subscription for this course to join!`);
                    joinModal.classList.add('view-hidden'); document.getElementById('premium-modal').classList.remove('view-hidden');
                    if (typeof updatePrices === 'function') updatePrices();
                    return;
                }

                localStorage.setItem('active_study_room', code); 
                localStorage.setItem('is_study_guest', 'true'); 
                btnSubmitJoin.classList.add('btn-connected'); 
                btnSubmitJoin.textContent = "Connected!";
                setTimeout(() => window.location.href = 'quiz.html', 800);
            } else alert("Room not found. Please check the code and try again.");
        } catch (error) { alert("Error connecting to room."); } finally { btnSubmitJoin.textContent = "Join Room"; btnSubmitJoin.disabled = false; }
    };
}

// === 11. HARDWARE-ACCELERATED PHYSICS (MAGNETIC & GLOW) ===
document.addEventListener('DOMContentLoaded', () => {
    const darkModeBtn = document.getElementById('dark-mode-toggle');
    if (darkModeBtn) {
        const icon = darkModeBtn.querySelector('i');
        
        if (localStorage.getItem('theme') === 'dark') { 
            document.documentElement.classList.add('dark-mode'); 
            if (icon) { icon.classList.replace('fa-moon', 'fa-sun'); icon.classList.add('text-accent-color'); } 
        }

        darkModeBtn.addEventListener('click', () => {
            document.documentElement.classList.toggle('dark-mode');
            const isDark = document.documentElement.classList.contains('dark-mode');
            
            if (isDark) { 
                if (icon) { icon.classList.replace('fa-moon', 'fa-sun'); icon.classList.add('text-accent-color'); } 
                localStorage.setItem('theme', 'dark'); 
            } else { 
                if (icon) { icon.classList.replace('fa-sun', 'fa-moon'); icon.classList.remove('text-accent-color'); } 
                localStorage.setItem('theme', 'light'); 
            }
        });
    }

    // Dynamic Radial Glow Tracking for Bento Grid
    document.addEventListener('mousemove', (e) => {
        document.querySelectorAll('.feature-card, .popup-content').forEach(card => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            card.style.setProperty('--mouse-x', `${x}px`);
            card.style.setProperty('--mouse-y', `${y}px`);
        });
    });

    // Magnetic Button Physics
    document.querySelectorAll('.action-btn, .nav-btn-base').forEach(btn => {
        btn.addEventListener('mousemove', (e) => {
            const rect = btn.getBoundingClientRect();
            const x = e.clientX - rect.left - rect.width / 2;
            const y = e.clientY - rect.top - rect.height / 2;
            btn.style.transform = `translate(${x * 0.15}px, ${y * 0.15}px)`;
        });
        
        btn.addEventListener('mouseleave', () => {
            btn.style.transform = `translate(0px, 0px)`;
        });
    });
});