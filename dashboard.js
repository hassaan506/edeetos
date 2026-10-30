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
        if (cachedUser && userNameEl.textContent === "...") {
            userNameEl.textContent = cachedUser.fullName || "Doctor";
        }

        try {
            const docSnap = await getDoc(userRef);
            if (docSnap.exists()) {
                currentUserData = docSnap.data();
                idbCache.set(user.uid, currentUserData); 
                const userRoleUpper = (currentUserData.role || 'STUDENT').toUpperCase();
                
                // BAN CHECK
                if (currentUserData.isBanned || currentUserData.role === 'BANNED') {
                    userNameEl.textContent = "ACCOUNT SUSPENDED";
                    if (subStatus) { 
                        subStatus.textContent = "BANNED"; 
                        subStatus.className = "status-badge badge-banned"; 
                    }
                    renderLockoutScreen();
                    return; 
                }               
                
                // HEADER UI
                userNameEl.textContent = currentUserData.fullName || "Doctor";

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
                        input.checked = true;
                        
                        label.appendChild(input);
                        label.appendChild(document.createTextNode(` ${courseNamesMap[userCourseCode] || "Unknown Course"}`));
                        dynamicCourseContainer.appendChild(label);
                    } else {
                        const div = document.createElement('div');
                        div.className = 'font-xs font-bold text-danger';
                        div.textContent = 'Action Required: Request a course in your Profile first.';
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
                    if (freeWarning) { 
                        freeWarning.classList.remove('view-hidden'); 
                        freeWarning.textContent = "(Free users limited to 50Qs/subject)"; 
                    }
                }
                
                const btnReports = document.getElementById('btn-reports-panel');
                if (userRoleUpper === 'MENTOR' || userRoleUpper === 'MANAGEMENT' || userRoleUpper === 'ADMIN') {
                    if (btnReports) btnReports.classList.remove('view-hidden');
                    
                    const btnMentor = document.getElementById('btn-contact-mentor');
                    if (btnMentor) {
                        btnMentor.textContent = "Open Mentorship Hub";
                        const cardH3 = document.getElementById('mentor-card-title');
                        const cardP = document.getElementById('mentor-card-desc');
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
            userNameEl.textContent = "Guest";
            if(subStatus) { 
                subStatus.textContent = "Guest Mode"; 
                subStatus.className = "status-badge badge-guest"; 
            }
            if (freeWarning) { 
                freeWarning.classList.remove('view-hidden'); 
                freeWarning.textContent = "(Guests limited to 20Qs/subject)"; 
                freeWarning.classList.add('text-muted'); 
            }
        } else {
            window.location.href = 'index.html'; 
        }
    }
});

// === 3. NAVIGATION & UI TOGGLES ===
document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('edeetos_guest_mode'); 
    signOut(auth).then(() => { window.location.href = 'index.html'; }).catch(() => { window.location.href = 'index.html'; });
});

const btnAdminPanel = document.getElementById('btn-admin-panel');
if (btnAdminPanel) btnAdminPanel.addEventListener('click', () => window.location.href = 'admin.html');

const btnReportsPanel = document.getElementById('btn-reports-panel');
if (btnReportsPanel) btnReportsPanel.addEventListener('click', () => window.location.href = 'reports.html?v=7');

const btnStudyVault = document.getElementById('btn-study-vault');
if (btnStudyVault) btnStudyVault.addEventListener('click', () => alert('Study Vault is Coming Soon!'));

const btnContactMentor = document.getElementById('btn-contact-mentor');
if (btnContactMentor) {
    btnContactMentor.addEventListener('click', () => {
        if (localStorage.getItem('edeetos_guest_mode') === 'true') return alert("Please register to access Mentorship.");
        window.location.href = 'mentor.html';
    });
}

document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.addEventListener('click', (e) => e.target.closest('.popup-overlay').classList.add('view-hidden'));
});

// === 4. DYNAMIC MODALS (Tasks, Guests, Bans) ===
function renderLockoutScreen() {
    const lockoutModal = document.getElementById('lockout-screen');
    if (!lockoutModal) return;
    
    lockoutModal.classList.remove('view-hidden');
    document.body.style.overflow = 'hidden';

    document.getElementById('btn-submit-appeal').addEventListener('click', async (e) => {
        const text = document.getElementById('appeal-text').value.trim();
        if (!text) return alert("Please enter a reason for your appeal.");
        
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
            alert("Appeal submitted. The admin will review it shortly.");
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
            iconSpan.textContent = '🟢';
            textSpan.textContent = 'Online';
            btnMentorStatus.classList.remove('mentor-offline');
            btnMentorStatus.classList.add('mentor-online');
        } else { 
            iconSpan.textContent = '⚪';
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
    const chatsRef = collection(db, "chats");
    const q = query(chatsRef, where("mentorId", "==", currentUserId), where("status", "==", "pending"));
    
    onSnapshot(q, (snapshot) => {
        const banner = document.getElementById('mentor-alert-banner');
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
            if(!container || container.children.length > 0) return; 
            
            const tmpl = document.getElementById('task-notify-template');
            if(tmpl) {
                const clone = tmpl.content.cloneNode(true);
                const countSpan = clone.querySelector('.task-count');
                const btnView = clone.querySelector('button');
                
                countSpan.textContent = `${pendingExams.length} task${pendingExams.length > 1 ? 's' : ''}`;
                container.appendChild(clone);
                
                const taskModal = document.getElementById('assigned-tasks-modal');
                const taskListContainer = document.getElementById('task-list-container');
                taskListContainer.innerHTML = '';
                
                pendingExams.forEach((exam, index) => {
                    const cardDiv = document.createElement('div');
                    cardDiv.className = 'task-item-card';
                    
                    const infoDiv = document.createElement('div');
                    
                    const titleDiv = document.createElement('div');
                    titleDiv.className = 'task-item-title';
                    titleDiv.textContent = exam.title;
                    
                    const badgeRow = document.createElement('div');
                    badgeRow.className = 'flex-row gap-10px';
                    
                    const timeBadge = document.createElement('span');
                    timeBadge.className = 'task-badge-time';
                    timeBadge.textContent = `⏱ ${exam.timerMinutes} Min`;
                    
                    const countBadge = document.createElement('span');
                    countBadge.className = 'task-badge-count';
                    countBadge.textContent = `📚 ${exam.questions.length} Qs`;
                    
                    badgeRow.appendChild(timeBadge);
                    badgeRow.appendChild(countBadge);
                    
                    infoDiv.appendChild(titleDiv);
                    infoDiv.appendChild(badgeRow);
                    
                    const launchBtn = document.createElement('button');
                    launchBtn.id = `launch-assigned-${index}`;
                    launchBtn.className = 'action-btn task-start-btn';
                    launchBtn.textContent = 'Start Now';
                    
                    cardDiv.appendChild(infoDiv);
                    cardDiv.appendChild(launchBtn);
                    taskListContainer.appendChild(cardDiv);
                });

                container.firstElementChild.onclick = () => taskModal.classList.remove('view-hidden');
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
                        } catch (err) { console.error("Hydration Error:", err); }

                        if (hydratedQueue.length === 0) {
                            launchBtn.textContent = "Start Now"; 
                            launchBtn.classList.remove('btn-loading');
                            return alert("Failed to load exam questions.");
                        }

                        const request = indexedDB.open("EdeetosDB", 1);
                        request.onupgradeneeded = (e) => { if (!e.target.result.objectStoreNames.contains("quiz_sessions")) e.target.result.createObjectStore("quiz_sessions"); };
                        request.onsuccess = (e) => {
                            const tx = e.target.result.transaction("quiz_sessions", "readwrite");
                            tx.objectStore("quiz_sessions").put(hydratedQueue, "active_quiz_queue");
                            tx.oncomplete = () => window.location.href = 'quiz.html';
                        };
                        request.onerror = (e) => { 
                            alert("Failed to load exam data."); 
                            launchBtn.textContent = "Start Now"; 
                            launchBtn.classList.remove('btn-loading'); 
                        };
                    });
                });
            }
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
        
        if (currentUserData.selectedCourse) { 
            localStorage.setItem('edeetos_active_course', currentUserData.selectedCourse); 
            window.location.href = 'questions.html'; 
        } else if (activeSub) { 
            localStorage.setItem('edeetos_active_course', activeSub); 
            window.location.href = 'questions.html'; 
        } else { 
            alert("Your assigned course is missing. Please request one in your Profile."); 
        }
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
        
        modal.classList.remove('view-hidden'); 
        searchInput.value = ''; 
        listEl.innerHTML = '';
        
        const activeCourse = currentUserData.selectedCourse;
        const notesObj = (activeCourse && currentUserData[activeCourse] && currentUserData[activeCourse].notes) ? currentUserData[activeCourse].notes : {};
        const noteKeys = Object.keys(notesObj);
        
        const msgDiv = document.createElement('div');
        msgDiv.className = 'text-muted text-center p-2 font-bold';

        if (noteKeys.length === 0) {
            msgDiv.textContent = "You haven't saved any notes yet.";
            listEl.appendChild(msgDiv);
            return;
        }

        msgDiv.textContent = "Loading question data...";
        listEl.appendChild(msgDiv);

        let allQuestions = [];
        try {
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

    if (notesArray.length === 0) {
        const div = document.createElement('div');
        div.className = 'text-muted text-center p-2';
        div.textContent = 'No matching notes found.';
        listEl.appendChild(div);
        return;
    }
    
    for (let i = 0; i < Math.min(notesArray.length, 50); i++) {
        const data = notesArray[i];
        
        const noteCard = document.createElement('div');
        noteCard.className = "note-card";
        
        const idDiv = document.createElement('div');
        idDiv.className = "note-id";
        idDiv.textContent = `ID: ${data.id}`;
        
        const stemDiv = document.createElement('div');
        stemDiv.className = "note-stem";
        stemDiv.textContent = `"${data.stem}"`;
        
        const bodyDiv = document.createElement('div');
        bodyDiv.className = "note-body";
        bodyDiv.textContent = data.note;
        
        noteCard.appendChild(idDiv);
        noteCard.appendChild(stemDiv);
        noteCard.appendChild(bodyDiv);
        
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
    if (document.querySelectorAll('.course-check:checked').length === 0 && document.querySelectorAll('.book-check:checked').length === 0) return alert("You must select at least one course or book.");
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
const fileInput = document.getElementById('payment-proof');
const fileNameDisplay = document.getElementById('file-name-display');

if (fileInput && fileNameDisplay) {
    fileInput.addEventListener('change', function() {
        if (this.files && this.files[0]) {
            fileNameDisplay.textContent = this.files[0].name;
            fileNameDisplay.classList.add('file-uploaded');
        } else {
            fileNameDisplay.textContent = 'Click to browse or drag receipt here';
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
        
        btnApplyPromo.textContent = "Loading..."; 
        btnApplyPromo.disabled = true;

        try {
            const promoSnap = await getDoc(doc(db, "promo_codes", codeInput));
            if (promoSnap.exists()) {
                const data = promoSnap.data();
                if (data.isActive && (!data.expiryDate || new Date(data.expiryDate) > new Date())) {
                    activePromoCode = codeInput; 
                    activePromoDiscount = data.discountPercentage || 0;
                    msgBox.textContent = `✅ Promo applied: ${activePromoDiscount}% off!`; 
                    msgBox.className = 'font-xs font-bold text-left mb-1-5 text-emerald';
                    updatePrices();
                } else throw new Error("Expired or inactive.");
            } else throw new Error("Invalid promo code.");
        } catch (e) {
            activePromoCode = null; activePromoDiscount = 0;
            msgBox.textContent = `❌ ${e.message || "Invalid code"}`; 
            msgBox.className = 'font-xs font-bold text-left mb-1-5 text-danger';
            updatePrices();
        } finally { btnApplyPromo.textContent = "Apply"; btnApplyPromo.disabled = false; }
    });
}

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
            
            activePromoCode = null; activePromoDiscount = 0; 
            document.getElementById('promo-input').value = ""; 
            document.getElementById('promo-message').textContent = "";
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
        if (btnChange && currentUserData.courseChangeRequested) { 
            btnChange.textContent = "Change Request Pending Admin Approval..."; 
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
            if (expiry === 'lifetime') {
                badgeSpan.className = 'sub-tag sub-lifetime';
                badgeSpan.textContent = 'Lifetime';
            } else if (new Date(expiry) < new Date()) {
                badgeSpan.className = 'sub-tag sub-expired';
                badgeSpan.textContent = 'Expired';
            } else {
                badgeSpan.className = 'sub-tag sub-active';
                badgeSpan.textContent = `Active till ${new Date(expiry).toLocaleDateString()}`;
            }
            
            item.appendChild(nameSpan);
            item.appendChild(badgeSpan);
            subsList.appendChild(item);
        }
        if (!hasSubs) {
            const p = document.createElement('div');
            p.className = 'text-muted font-sm text-center p-1';
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
            if (!newCourse) return alert("Select a new course first.");
            btnSubmitChange.textContent = "Submitting..."; btnSubmitChange.disabled = true;
            try {
                await updateDoc(doc(db, "users", currentUserId), { courseChangeRequested: true, requestedCourse: newCourse });
                currentUserData.courseChangeRequested = true; currentUserData.requestedCourse = newCourse;
                btnRequestChange.textContent = "Change Request Pending..."; 
                btnRequestChange.classList.add('btn-pending');
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
            
            idbCache.set(currentUserId, JSON.parse(JSON.stringify(currentUserData))); 
            
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
            
            document.getElementById('copy-room-code').onclick = () => { 
                navigator.clipboard.writeText(roomId); 
                document.getElementById('copy-room-code').textContent = "Copied"; 
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
        if (localStorage.getItem('edeetos_guest_mode') === 'true') return alert("Guest accounts cannot join Group Study.");
        joinInput.value = ""; joinModal.classList.remove('view-hidden'); joinInput.focus();
    };
}

if (btnSubmitJoin) {
    btnSubmitJoin.onclick = async () => {
        const code = joinInput.value.trim();
        if (code.length !== 4) return alert("Please enter a valid 4-digit code.");
        btnSubmitJoin.textContent = "Verifying..."; 
        btnSubmitJoin.disabled = true;

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

                localStorage.setItem('active_study_room', code); 
                localStorage.setItem('is_study_guest', 'true'); 
                btnSubmitJoin.classList.add('btn-connected'); 
                btnSubmitJoin.textContent = "Connected!";
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
    
    if (localStorage.getItem('theme') === 'dark') { 
        document.documentElement.classList.add('dark-mode'); 
        if (icon) { icon.classList.remove('fa-moon'); icon.classList.add('fa-sun'); } 
    }

    darkModeBtn.addEventListener('click', () => {
        document.documentElement.classList.toggle('dark-mode');
        const isDark = document.documentElement.classList.contains('dark-mode');
        
        if (isDark) { 
            if (icon) { icon.classList.remove('fa-moon'); icon.classList.add('fa-sun'); } 
            localStorage.setItem('theme', 'dark'); 
        } else { 
            if (icon) { icon.classList.remove('fa-sun'); icon.classList.add('fa-moon'); } 
            localStorage.setItem('theme', 'light'); 
        }
    });
});