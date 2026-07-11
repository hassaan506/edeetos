// === FEATURE: FIREBASE IMPORTS & GLOBALS ===
import { auth, db, storage } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, updateDoc, addDoc, collection, setDoc, serverTimestamp, query, where, onSnapshot, getDocs, arrayUnion } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

let currentUserData = null;
let currentUserId = null;
let hasCheckedDowngrade = false;

const courseNamesMap = {
    'mbbs_year1': 'MBBS 1st Year', 'mbbs_year2': 'MBBS 2nd Year', 'mbbs_year3': 'MBBS 3rd Year', 'mbbs_year4': 'MBBS 4th Year', 'mbbs_year5': 'MBBS 5th Year',
    'fcps_imm': 'FCPS IMM', 'fcps_part1': 'FCPS Part 1', 'fcps_part2': 'FCPS Part 2',
    'mrcs_part1': 'MRCS Part 1', 'mrcs_part2': 'MRCS Part 2'
};

const mergedNamesMap = { 
    ...courseNamesMap, 
    'firstaid_step1': 'First Aid Step 1', 'firstaid_step2': 'First Aid Step 2', 'im_medicine': 'IM Medicine', 'im_surgery': 'IM Surgery', 'im_pathology': 'IM Pathology', 'im_pediatrics': 'IM Pediatrics', 'brs_patho': 'BRS Pathology', 'brs_physio': 'BRS Physiology', 'rafiullah': 'Rafiullah', 'doubleAA': 'Double AA'
};

// === FEATURE: DASHBOARD LOAD, ROLES, & BADGES ===
onAuthStateChanged(auth, async (user) => {
    const freeWarning = document.getElementById('free-warning-text');
    const subStatus = document.getElementById('subscription-status');

    if (user) {
        currentUserId = user.uid;
        const userRef = doc(db, "users", user.uid);
        
        const cachedUser = sessionStorage.getItem('edeetos_dash_cache');
        if (cachedUser && document.getElementById('user-name').textContent === "...") {
            try {
                const tempUser = JSON.parse(cachedUser);
                document.getElementById('user-name').textContent = tempUser.fullName || "Doctor";
            } catch (e) { console.warn("Cache parse failed"); }
        }

        try {
            const docSnap = await getDoc(userRef);

            if (docSnap.exists()) {
                currentUserData = docSnap.data();
                sessionStorage.setItem('edeetos_dash_cache', JSON.stringify(currentUserData)); 
                
                // 1. Check Banned Status
                if (currentUserData.isBanned || currentUserData.role === 'BANNED') {
                    document.getElementById('user-name').textContent = "ACCOUNT SUSPENDED";
                    if (subStatus) {
                        subStatus.textContent = "BANNED";
                        subStatus.className = "status-badge";
                        subStatus.style.background = "#fee2e2";
                        subStatus.style.color = "#ef4444";
                        subStatus.style.border = "1px solid #fca5a5";
                    }
                    
                    const lockoutScreen = document.createElement('div');
                    lockoutScreen.style.cssText = "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background-color: rgba(15, 23, 42, 0.95); z-index: 2147483647; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; backdrop-filter: blur(10px);";
                    
                    lockoutScreen.innerHTML = `
                        <i class="fas fa-ban" style="color: #ef4444; font-size: 5rem; margin-bottom: 1.5rem;"></i>
                        <h1 style="color: white; font-family: 'Nunito', sans-serif; font-size: 2.5rem; margin-bottom: 1rem; margin-top: 0;">Account Suspended</h1>
                        <p style="color: #94a3b8; font-family: 'Nunito', sans-serif; font-size: 1.1rem; max-width: 500px; line-height: 1.6; margin-bottom: 2.5rem; padding: 0 1.5rem;">
                            Your account has been restricted due to policy violations. You no longer have access to EDEETOS materials, questions, or premium features.
                        </p>
                        <button id="btn-banned-logout" style="background: #ef4444; color: white; border: none; padding: 1rem 2.5rem; border-radius: 12px; font-weight: bold; font-size: 1.1rem; cursor: pointer; box-shadow: 0 4px 15px rgba(239, 68, 68, 0.4); transition: transform 0.2s;">
                            Log Out
                        </button>
                    `;
                    
                    document.body.appendChild(lockoutScreen);
                    document.body.style.overflow = 'hidden';
                    
                    document.getElementById('btn-banned-logout').addEventListener('click', () => {
                        document.getElementById('btn-banned-logout').textContent = "Logging out...";
                        signOut(auth).then(() => {
                            window.location.href = 'index.html';
                        }).catch(() => {
                            window.location.href = 'index.html';
                        });
                    });
                    
                    return; 
                }				
                
                // 2. Set UI Elements
                document.getElementById('user-name').textContent = currentUserData.fullName || "Doctor";
                
                const userCourseCode = currentUserData.selectedCourse; 
                const activeCourseEl = document.getElementById('active-course-name');
                if (activeCourseEl) {
                    if (userCourseCode) {
                        activeCourseEl.textContent = courseNamesMap[userCourseCode] || "Unknown Course";
                    } else {
                        activeCourseEl.textContent = "No Course Assigned";
                        activeCourseEl.style.color = "#ef4444"; 
                    }
                }

                const dynamicCourseContainer = document.getElementById('dynamic-course-container');
                if (dynamicCourseContainer) {
                    if (userCourseCode) {
                        const courseName = courseNamesMap[userCourseCode] || "Unknown Course";
                        dynamicCourseContainer.innerHTML = `<label class="course-checkbox-label" style="cursor: pointer; font-weight: bold;"><input type="checkbox" class="course-check" value="${userCourseCode}" checked> ${courseName}</label>`;
                    } else {
                        dynamicCourseContainer.innerHTML = `<div style="color: #ef4444; font-size: 0.8rem; font-weight: bold;">Action Required: Request a course in your Profile first.</div>`;
                    }
                }

                // 3. Subscription Downgrade Check
                const userRole = (currentUserData.role || '').toUpperCase();
                let hasActiveSubscription = false;
                if (currentUserData.isPremium && currentUserData.subscriptions) {
                    for (const expiry of Object.values(currentUserData.subscriptions)) {
                        if (expiry === 'lifetime' || new Date(expiry) > new Date()) {
                            hasActiveSubscription = true;
                            break; 
                        }
                    }
                }
                
                if (!hasCheckedDowngrade && currentUserData.isPremium && !hasActiveSubscription) {
                    hasCheckedDowngrade = true; 
                    updateDoc(userRef, { isPremium: false }).catch(err => console.error("Error auto-downgrading user:", err));
                }

                // 4. Role Based Badges
                if(subStatus) {
                    subStatus.className = "status-badge";
                    subStatus.style.background = "";
                    subStatus.style.color = "";
                    subStatus.style.border = "";
                }

                if (userRole === 'MANAGEMENT' || userRole === 'ADMIN') {
                    if(subStatus) {
                        subStatus.textContent = "Admin";
                        subStatus.style.background = "#f3e8ff";
                        subStatus.style.color = "#8b5cf6";
                        subStatus.style.border = "1px solid #c084fc";
                    }
                    document.getElementById('btn-admin-panel').style.display = 'flex';
                    if (freeWarning) freeWarning.style.display = 'none';
                    
                } else if (hasActiveSubscription) { 
                    if(subStatus) {
                        subStatus.textContent = "Premium";
                        subStatus.className = "status-badge badge-pro";
                    }
                    if (freeWarning) freeWarning.style.display = 'none';
                    
                } else {
                    if(subStatus) {
                        subStatus.textContent = "Free Tier";
                        subStatus.className = "status-badge badge-free";
                    }
                    if (freeWarning) {
                        freeWarning.style.display = 'inline';
                        freeWarning.textContent = "(Free users limited to 50Qs/subject)";
                    }
                }

                // 5. Mentor Specific Logic
                if (userRole === 'MENTOR' || userRole === 'MANAGEMENT' || userRole === 'ADMIN') {
                    const btnReports = document.getElementById('btn-reports-panel');
                    if (btnReports) btnReports.style.display = 'flex';
                    
                    const btnMentor = document.getElementById('btn-contact-mentor');
                    if (btnMentor) {
                        btnMentor.textContent = "Open Mentorship Hub";
                        const cardH3 = btnMentor.parentElement.querySelector('h3');
                        const cardP = btnMentor.parentElement.querySelector('p');
                        if (cardH3) cardH3.textContent = "Mentorship Hub";
                        if (cardP) cardP.textContent = "Manage incoming student chat requests.";
                    }

                    const chatsRef = collection(db, "chats");
                    const q = query(chatsRef, where("mentorId", "==", currentUserId), where("status", "==", "pending"));
                    
                    onSnapshot(q, (snapshot) => {
                        let banner = document.getElementById('mentor-alert-banner');
                        
                        if (!snapshot.empty) {
                            if (!banner) {
                                banner = document.createElement('div');
                                banner.id = 'mentor-alert-banner';
                                banner.style = "position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #ef4444; color: white; padding: 12px 24px; border-radius: 30px; font-weight: 800; font-size: 1.1rem; z-index: 9999; cursor: pointer; display: flex; align-items: center; gap: 10px;";
                                banner.innerHTML = `<span>🚨</span> <span>Incoming Chat Request! Click here to answer.</span>`;
                                banner.onclick = () => window.location.href = 'mentor.html';
                                document.body.appendChild(banner);
                                
                                if(!document.getElementById('pulse-anim-style')) {
                                    const style = document.createElement('style');
                                    style.id = 'pulse-anim-style';
                                    style.innerHTML = `@keyframes alertPulse { 0% { transform: translateX(-50%) scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); } 70% { transform: translateX(-50%) scale(1.05); box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); } 100% { transform: translateX(-50%) scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); } } #mentor-alert-banner { animation: alertPulse 1.5s infinite; }`;
                                    document.head.appendChild(style);
                                }
                            }
                            banner.style.display = 'flex';
                        } else {
                            if (banner) banner.style.display = 'none';
                        }
                    });
                }

                // 6. Assigned Exams Logic (Dynamic Task UI)
                if (userRole === 'STUDENT' || hasActiveSubscription) {
                    const examsRef = collection(db, "assigned_exams");
                    const assignedQuery = query(examsRef, where("assignedTo", "array-contains", currentUserId));
                    
                    try {
                        const examsSnapshot = await getDocs(assignedQuery);
                        const pendingExams = [];
                        
                        examsSnapshot.forEach((docSnap) => {
                            const data = docSnap.data();
                            if (!data.isCompletedBy || !data.isCompletedBy.includes(currentUserId)) {
                                pendingExams.push({ id: docSnap.id, ...data });
                            }
                        });

                        if (pendingExams.length > 0) {
                            const dashboardContainer = document.querySelector('.section-container') || document.body;
                            const headerElement = document.querySelector('.dashboard-header');
                            
                            const notifyCard = document.createElement('div');
                            notifyCard.className = 'glass-panel';
                            notifyCard.style.cssText = "background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 2px solid #10b981; border-radius: 16px; padding: 20px; margin-bottom: 25px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 10px 25px -5px rgba(16, 185, 129, 0.2); transition: transform 0.2s;";
                            
                            notifyCard.innerHTML = `
                                <div style="display: flex; align-items: center; gap: 15px;">
                                    <div style="background: #10b981; color: white; width: 50px; height: 50px; border-radius: 50%; display: flex; justify-content: center; align-items: center; font-size: 1.5rem; box-shadow: 0 4px 10px rgba(16,185,129,0.3);">
                                        <i class="fas fa-bell"></i>
                                    </div>
                                    <div>
                                        <h3 style="margin: 0 0 5px 0; color: #064e3b; font-weight: 800; font-size: 1.2rem;">New Mentor Assignments</h3>
                                        <p style="margin: 0; color: #059669; font-size: 0.9rem; font-weight: 600;">You have ${pendingExams.length} task${pendingExams.length > 1 ? 's' : ''} waiting for you.</p>
                                    </div>
                                </div>
                                <button class="btn-solid" style="background: #059669; padding: 10px 20px; border-radius: 12px; border: none; font-size: 0.95rem;">View Tasks</button>
                            `;

                            notifyCard.onmouseover = () => notifyCard.style.transform = "translateY(-3px)";
                            notifyCard.onmouseout = () => notifyCard.style.transform = "translateY(0)";

                            if (headerElement && headerElement.nextSibling) {
                                dashboardContainer.insertBefore(notifyCard, headerElement.nextSibling);
                            } else {
                                dashboardContainer.insertBefore(notifyCard, dashboardContainer.firstChild);
                            }

                            const taskModal = document.createElement('div');
                            taskModal.id = 'assigned-tasks-modal';
                            taskModal.style.cssText = "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(15, 23, 42, 0.75); z-index: 99999; display: none; justify-content: center; align-items: center; backdrop-filter: blur(4px);";
                            
                            let modalHtml = `
                                <div class="glass-panel" style="background: white; padding: 25px; border-radius: 16px; width: 90%; max-width: 550px; max-height: 85vh; display: flex; flex-direction: column; box-shadow: 0 20px 40px rgba(0,0,0,0.2);">
                                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 15px; margin-bottom: 20px;">
                                        <h3 style="color: #064e3b; margin: 0; font-size: 1.3rem;"><i class="fas fa-clipboard-check" style="color: #10b981; margin-right: 8px;"></i> Assigned Tasks</h3>
                                        <button id="close-tasks-modal" style="font-size: 1.5rem; color: #64748b; background: none; border: none; cursor: pointer; padding: 0;">&times;</button>
                                    </div>
                                    <div style="overflow-y: auto; flex-grow: 1; display: flex; flex-direction: column; gap: 15px; padding-right: 5px;">
                            `;

                            pendingExams.forEach((exam, index) => {
                                modalHtml += `
                                    <div style="border: 2px solid #e2e8f0; border-radius: 12px; padding: 15px; background: #f8fafc; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">
                                        <div>
                                            <div style="font-weight: 800; color: #1e293b; font-size: 1.1rem; margin-bottom: 5px;">${exam.title}</div>
                                            <div style="display: flex; gap: 10px; font-size: 0.8rem; font-weight: 700;">
                                                <span style="background: #e0f2fe; color: #0369a1; padding: 4px 8px; border-radius: 6px;"><i class="fas fa-clock"></i> ${exam.timerMinutes} Min</span>
                                                <span style="background: #f3e8ff; color: #7e22ce; padding: 4px 8px; border-radius: 6px;"><i class="fas fa-layer-group"></i> ${exam.questions.length} Qs</span>
                                            </div>
                                        </div>
                                        <button id="launch-assigned-${index}" class="btn-solid" style="background: #3b82f6; padding: 10px 20px; border: none; border-radius: 8px;">Start Now</button>
                                    </div>
                                `;
                            });

                            modalHtml += `
                                    </div>
                                </div>
                            `;
                            taskModal.innerHTML = modalHtml;
                            document.body.appendChild(taskModal);

                            notifyCard.onclick = () => taskModal.style.display = 'flex';
                            document.getElementById('close-tasks-modal').onclick = () => taskModal.style.display = 'none';
                            taskModal.onclick = (e) => { if(e.target === taskModal) taskModal.style.display = 'none'; };

                            pendingExams.forEach((exam, index) => {
                                const launchBtn = document.getElementById(`launch-assigned-${index}`);
                                launchBtn.addEventListener('click', async () => {
                                    launchBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Loading...`;
                                    launchBtn.style.opacity = "0.8";
                                    launchBtn.style.pointerEvents = "none";

                                    try {
                                        const examRefToUpdate = doc(db, "assigned_exams", exam.id);
                                        await updateDoc(examRefToUpdate, {
                                            isCompletedBy: arrayUnion(currentUserId)
                                        });
                                    } catch (err) {
                                        console.error("Failed to register exam attempt:", err);
                                    }

                                    setTimeout(() => {
                                        localStorage.setItem('edeetos_active_quiz', JSON.stringify(exam.questions));
                                        localStorage.setItem('edeetos_quiz_config', JSON.stringify({ 
                                            mode: 'exam', 
                                            timer: exam.timerMinutes, 
                                            examName: exam.title 
                                        }));
                                        localStorage.setItem('edeetos_assigned_exam_id', exam.id);
                                        
                                        window.location.href = 'quiz.html';
                                    }, 50);
                                });
                            });
                        }
                    } catch (examErr) {
                        console.error("Error fetching assigned exams:", examErr);
                    }
                }

            }
        } catch (error) {
            console.error("Error fetching user data:", error);
        }
    } else {
        // 7. Handle Logged Out / Guest Mode
        if (localStorage.getItem('edeetos_guest_mode') === 'true') {
            document.getElementById('user-name').textContent = "Guest";
            
            if(subStatus) {
                subStatus.textContent = "Guest Mode";
                subStatus.className = "status-badge badge-free";
                subStatus.style.background = "#e2e8f0"; 
                subStatus.style.color = "#475569";
                subStatus.style.borderColor = "#cbd5e1";
            }
            
            if (freeWarning) {
                freeWarning.style.display = 'inline';
                freeWarning.textContent = "(Guests limited to 20Qs/subject)";
                freeWarning.style.color = "#64748b"; 
            }
        } else {
            window.location.href = 'index.html'; 
        }
    }
});

// === FEATURE: NAVIGATION BUTTONS & COURSE LAUNCH ===
document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('edeetos_guest_mode');
    sessionStorage.removeItem('edeetos_dash_cache');
    signOut(auth).then(() => { window.location.href = 'index.html'; }).catch(() => {
        window.location.href = 'index.html';
    });
});

document.getElementById('btn-admin-panel').addEventListener('click', () => {
    window.location.href = 'admin.html';
});

document.getElementById('btn-contact-mentor').addEventListener('click', () => {
    if (localStorage.getItem('edeetos_guest_mode') === 'true') {
        alert("Please register to access Mentorship.");
        return;
    }
    window.location.href = 'mentor.html';
});

document.getElementById('btn-open-premium').addEventListener('click', () => {
    if (localStorage.getItem('edeetos_guest_mode') === 'true') {
        alert("Please register to upgrade to Premium.");
        return;
    }
    document.getElementById('premium-modal').style.display = 'flex';
    updatePrices();
});

document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.target.closest('.popup-overlay').style.display = 'none';
    });
});

document.getElementById('btn-launch-course').addEventListener('click', () => {
    if (localStorage.getItem('edeetos_guest_mode') === 'true') {
        let guestModal = document.getElementById('guest-course-modal');
        if (!guestModal) {
            guestModal = document.createElement('div');
            guestModal.id = 'guest-course-modal';
            guestModal.style.cssText = "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(15, 23, 42, 0.75); z-index: 99999; display: flex; justify-content: center; align-items: center; backdrop-filter: blur(4px);";
            
            guestModal.innerHTML = `
                <div class="glass-panel" style="background: white; padding: 25px; border-radius: 16px; width: 90%; max-width: 400px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.2);">
                    <h3 style="color: #1e3a8a; margin-top: 0; font-size: 1.3rem;"><i class="fas fa-user-graduate" style="color: #3b82f6; margin-right: 8px;"></i> Select Demo Course</h3>
                    <p style="color: #64748b; font-size: 0.9rem; margin-bottom: 20px;">Which course would you like to explore as a guest today?</p>
                    
                    <select id="guest-course-select" style="width: 100%; padding: 12px; border: 2px solid #e2e8f0; border-radius: 8px; margin-bottom: 20px; font-weight: bold; color: #1e293b; outline: none;">
                        <optgroup label="FCPS Series">
                            <option value="fcps_part1">FCPS Part 1</option>
                            <option value="fcps_part2">FCPS Part 2</option>
                            <option value="fcps_imm">FCPS IMM</option>
                        </optgroup>
                        <optgroup label="MRCS Series">
                            <option value="mrcs_part1">MRCS Part 1</option>
                            <option value="mrcs_part2">MRCS Part 2</option>
                        </optgroup>
                        <optgroup label="MBBS Journey">
                            <option value="mbbs_year1">MBBS Year 1</option>
                            <option value="mbbs_year2">MBBS Year 2</option>
                            <option value="mbbs_year3">MBBS Year 3</option>
                            <option value="mbbs_year4">MBBS Year 4</option>
                            <option value="mbbs_year5">MBBS Year 5</option>
                        </optgroup>
                    </select>
                    
                    <div style="display: flex; gap: 10px; justify-content: center;">
                        <button id="btn-cancel-guest" class="btn-outline" style="flex: 1; margin: 0;">Cancel</button>
                        <button id="btn-confirm-guest" class="btn-solid" style="flex: 1; margin: 0; background: #10b981;">Explore</button>
                    </div>
                </div>
            `;
            document.body.appendChild(guestModal);
            
            document.getElementById('btn-cancel-guest').onclick = () => guestModal.style.display = 'none';
            document.getElementById('btn-confirm-guest').onclick = () => {
                const selected = document.getElementById('guest-course-select').value;
                localStorage.setItem('edeetos_active_course', selected);
                window.location.href = 'questions.html';
            };
        }
        guestModal.style.display = 'flex';
        return;
    }

    if (currentUserData) {
        let activeSub = null;
        if (currentUserData.subscriptions && Object.keys(currentUserData.subscriptions).length > 0) {
            activeSub = Object.keys(currentUserData.subscriptions)[0];
        }

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

// === FEATURE: PREMIUM MODAL LOGIC & CALCULATOR ===
const tabBuy = document.getElementById('tab-buy');
const tabRedeem = document.getElementById('tab-redeem');
const viewBuy = document.getElementById('view-buy');
const viewRedeem = document.getElementById('view-redeem');

if(tabBuy) tabBuy.addEventListener('click', () => {
    tabBuy.className = 'active-tab'; tabRedeem.className = 'inactive-tab';
    viewBuy.style.display = 'block'; viewRedeem.style.display = 'none';
});

if(tabRedeem) tabRedeem.addEventListener('click', () => {
    tabRedeem.className = 'active-tab'; tabBuy.className = 'inactive-tab';
    viewRedeem.style.display = 'block'; viewBuy.style.display = 'none';
});

const courseSelectorModal = document.getElementById('course-selector-modal');
document.getElementById('btn-open-course-selector').addEventListener('click', () => {
    courseSelectorModal.style.display = 'flex';
});

document.getElementById('btn-confirm-courses').addEventListener('click', () => {
    const courseCount = document.querySelectorAll('.course-check:checked').length;
    const bookCount = document.querySelectorAll('.book-check:checked').length;
    
    if (courseCount === 0 && bookCount === 0) return alert("You must select at least one course or book.");
    
    courseSelectorModal.style.display = 'none';
    updatePrices();
});

function updatePrices() {
    const courseCount = document.querySelectorAll('.course-check:checked').length;
    const bookCount = document.querySelectorAll('.book-check:checked').length;

    let bookDiscount = 0;
    if (bookCount >= 5) bookDiscount = 0.30;      
    else if (bookCount >= 3) bookDiscount = 0.20; 
    else if (bookCount >= 2) bookDiscount = 0.10; 

    const baseCoursePrices = [100, 500, 800, 1200, 2500, 3500, 4500, 5000];
    const baseBookPrices = [20, 50, 80, 120, 250, 350, 450, 500];

    for(let i = 0; i < 8; i++) {
        let coursePrice = courseCount > 0 ? baseCoursePrices[i] : 0;
        let rawBookTotal = bookCount * baseBookPrices[i];
        let discountedBookTotal = rawBookTotal * (1 - bookDiscount);
        let totalPrice = Math.round(coursePrice + discountedBookTotal);
        
        const priceEl = document.getElementById('price-' + i);
        if(priceEl) priceEl.textContent = 'Rs. ' + totalPrice.toLocaleString();
    }

    const summaryText = document.getElementById('selected-courses-text');
    if (summaryText) {
        summaryText.textContent = `${courseCount} Course | ${bookCount} Book${bookCount !== 1 ? 's' : ''}`;
    }
}

document.querySelectorAll('.plan-card').forEach(card => {
    card.addEventListener('click', function() {
        document.querySelectorAll('.plan-card').forEach(c => {
            c.classList.remove('selected');
            const lifePrice = c.querySelector('#price-7');
            if (lifePrice) lifePrice.style.color = '#1e293b'; 
        });
        this.classList.add('selected');
        const lifePrice = this.querySelector('#price-7');
        if (lifePrice) lifePrice.style.color = '#d97706';
    });
});

// === FEATURE: PAYMENT PROOF UPLOAD ===
function compressImage(file) {
    return new Promise((resolve, reject) => {
        if (!file) return reject(new Error("No file provided"));
        
        const reader = new FileReader();
        reader.onload = event => {
            const img = new Image();
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const MAX_WIDTH = 800;
                    let scaleSize = 1;
                    if (img.width > MAX_WIDTH) scaleSize = MAX_WIDTH / img.width;
                    canvas.width = img.width * scaleSize;
                    canvas.height = img.height * scaleSize;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/jpeg', 0.6));
                } catch (e) {
                    reject(e);
                }
            }
            img.onerror = () => reject(new Error("Invalid image file"));
            img.src = event.target.result;
        };
        reader.onerror = () => reject(new Error("File read failed"));
        reader.readAsDataURL(file);
    });
}

const btnSubmitPayment = document.getElementById('btn-submit-payment');
if (btnSubmitPayment) {
    btnSubmitPayment.addEventListener('click', async () => {
        if(!currentUserId) return alert("Authentication error. Please refresh the page.");

        btnSubmitPayment.textContent = "Submitting...";
        btnSubmitPayment.disabled = true;

        try {
            const courses = Array.from(document.querySelectorAll('.course-check:checked')).map(cb => cb.value);
            const books = Array.from(document.querySelectorAll('.book-check:checked')).map(cb => cb.value);
            if (courses.length === 0 && books.length === 0) {
                alert("You must select at least one course or book to proceed.");
                btnSubmitPayment.textContent = "Confirm & Submit Request";
                btnSubmitPayment.disabled = false;
                return;
            }

            const selectedPlan = document.querySelector('.plan-card.selected');
            if (!selectedPlan) throw new Error("No plan selected.");

            const durationDays = selectedPlan.getAttribute('data-days');
            const planName = selectedPlan.getAttribute('data-name');
            const fallbackEmail = auth.currentUser ? auth.currentUser.email : "Unknown Email";

            const fileInput = document.getElementById('payment-proof');
            const file = fileInput.files[0];
            
            if (!file) {
                alert("Please upload your payment proof.");
                btnSubmitPayment.textContent = "Confirm & Submit Request";
                btnSubmitPayment.disabled = false;
                return;
            }

            let receiptUrl = "";
            try {
                receiptUrl = await compressImage(file);
            } catch(uploadErr) {
                console.warn("Base64 compression failed. Error: ", uploadErr);
                alert("Could not process the image. Please use a valid picture format (JPG/PNG).");
                btnSubmitPayment.textContent = "Confirm & Submit Request";
                btnSubmitPayment.disabled = false;
                return;
            }

            const userEmailToSave = currentUserData?.email || fallbackEmail;

            const submitPromise = addDoc(collection(db, "payment_requests"), {
                userId: currentUserId,
                userEmail: userEmailToSave,
                courses: courses,
                books: books,
                durationDays: durationDays,
                planName: planName,
                receiptUrl: receiptUrl,
                status: 'pending',
                timestamp: serverTimestamp()
            });

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error("Request timed out. Please check your internet connection.")), 12000);
            });

            await Promise.race([submitPromise, timeoutPromise]);
            
            alert("Payment request submitted successfully! Please wait for admin approval.");
            document.getElementById('premium-modal').style.display = 'none';

        } catch (e) {
            console.error("Payment submission error: ", e);
            alert("Failed to submit request: " + (e.message || "An unknown error occurred."));
        } finally {
            btnSubmitPayment.textContent = "Confirm & Submit Request";
            btnSubmitPayment.disabled = false;
        }
    });
}

// === FEATURE: REDEEM CODE ===
const btnRedeem = document.getElementById('btn-submit-redeem');
if (btnRedeem) {
    btnRedeem.addEventListener('click', async () => {
        const codeInput = document.getElementById('redeem-input').value.trim().toUpperCase();
        if(codeInput.length < 3) return alert("Invalid code.");

        btnRedeem.textContent = "Verifying...";
        btnRedeem.disabled = true;

        try {
            const keyRef = doc(db, "keys", codeInput);
            const keySnap = await getDoc(keyRef);

            if(!keySnap.exists()) {
                alert("Code is invalid or does not exist.");
                btnRedeem.textContent = "Redeem Now";
                btnRedeem.disabled = false;
                return;
            }
            
            const keyData = keySnap.data();

            if(keyData.usedCount >= keyData.maxUsage) {
                alert("This code has reached its maximum usage limit.");
                btnRedeem.textContent = "Redeem Now";
                btnRedeem.disabled = false;
                return;
            }
            if(keyData.expiryDate && new Date(keyData.expiryDate) < new Date()) {
                alert("This code has expired.");
                btnRedeem.textContent = "Redeem Now";
                btnRedeem.disabled = false;
                return;
            }

            let expiryValue = "lifetime";
            if(keyData.duration !== "lifetime") {
                const d = new Date();
                d.setDate(d.getDate() + parseInt(keyData.duration));
                expiryValue = d.toISOString();
            }

            let currentSubs = currentUserData.subscriptions || {};
            
            if(keyData.course === 'ALL') {
                 ['fcps_part1', 'fcps_part2', 'fcps_imm', 'mrcs_part1', 'mrcs_part2', 'mbbs_year1', 'mbbs_year2', 'mbbs_year3', 'mbbs_year4', 'mbbs_year5'].forEach(c => currentSubs[c] = expiryValue);
            } else if (keyData.course && keyData.course !== 'NONE') {
                currentSubs[keyData.course] = expiryValue;
            }

            if (keyData.books && Array.isArray(keyData.books)) {
                keyData.books.forEach(book => currentSubs[book] = expiryValue);
            }

            await updateDoc(doc(db, "users", currentUserId), {
                subscriptions: currentSubs,
                isPremium: true
            });
            await updateDoc(keyRef, { usedCount: keyData.usedCount + 1 });

            alert("Code redeemed successfully! Premium access granted.");
            window.location.reload();

        } catch (e) {
            console.error("Redemption error: ", e);
            alert("Error redeeming code.");
            btnRedeem.textContent = "Redeem Now";
            btnRedeem.disabled = false;
        }
    });
}

// === FEATURE: USER PROFILE MANAGEMENT ===
const btnOpenProfile = document.getElementById('btn-open-profile');
if (btnOpenProfile) {
    btnOpenProfile.addEventListener('click', () => {
        if (localStorage.getItem('edeetos_guest_mode') === 'true') return alert("Please register to access your Profile.");
        if (!currentUserData) return alert("User data loading, please wait...");
        document.getElementById('profile-modal').style.display = 'flex';
        
        document.getElementById('prof-role-badge').textContent = (currentUserData.role || 'STUDENT').toUpperCase();
        document.getElementById('prof-name').value = currentUserData.fullName || '';
        document.getElementById('prof-username').value = currentUserData.username || '';
        document.getElementById('prof-email').value = currentUserData.email || '';
        document.getElementById('prof-phone').value = currentUserData.phone || '';
        document.getElementById('prof-uni').value = currentUserData.institution || '';
        document.getElementById('prof-location').value = currentUserData.location || '';

        const userCourseCode = currentUserData.selectedCourse;
        const displayField = document.getElementById('prof-course-display');
        if(displayField) {
            displayField.value = userCourseCode ? (courseNamesMap[userCourseCode] || "Unknown Course") : "None (Action Required)";
        }        
        
        const btnChange = document.getElementById('btn-request-course-change');
        if (btnChange && currentUserData.courseChangeRequested) {
            btnChange.textContent = "Change Request Pending Admin Approval...";
            btnChange.style.color = "#94a3b8";
            btnChange.style.pointerEvents = "none";
        }
        
        const subsList = document.getElementById('prof-subs-list');
        subsList.innerHTML = '';
        
        const subs = currentUserData.subscriptions || {};
        let hasSubs = false;

        for (const [key, expiry] of Object.entries(subs)) {
            hasSubs = true;
            const name = mergedNamesMap[key] || key;
            const item = document.createElement('div');
            item.className = 'sub-item';
            
            let badgeHtml = '';
            if (expiry === 'lifetime') {
                badgeHtml = '<span class="sub-tag sub-lifetime">Lifetime</span>';
            } else {
                const expDate = new Date(expiry);
                if (expDate < new Date()) {
                    badgeHtml = '<span class="sub-tag sub-expired">Expired</span>';
                } else {
                    badgeHtml = `<span class="sub-tag sub-active">Active till ${expDate.toLocaleDateString()}</span>`;
                }
            }
            item.innerHTML = `<span class="sub-name">${name}</span>${badgeHtml}`;
            subsList.appendChild(item);
        }
        
        if (!hasSubs) {
            subsList.innerHTML = '<div style="color: #64748b; font-size: 0.9rem; text-align: center; padding: 1rem;">No active subscriptions found.</div>';
        }
    });
}

const btnRequestChange = document.getElementById('btn-request-course-change');
const courseChangeModal = document.getElementById('course-change-modal');

if (btnRequestChange && courseChangeModal) {
    btnRequestChange.addEventListener('click', () => {
        courseChangeModal.style.display = 'flex';
    });
    
    const btnSubmitChange = document.getElementById('btn-submit-course-change');
    if (btnSubmitChange) {
        btnSubmitChange.addEventListener('click', async () => {
            const newCourse = document.getElementById('new-course-request-select').value;
            if (!newCourse) return alert("Please select a new course from the dropdown first.");
            
            btnSubmitChange.textContent = "Submitting...";
            btnSubmitChange.disabled = true;
            
            try {
                await updateDoc(doc(db, "users", currentUserId), {
                    courseChangeRequested: true,
                    requestedCourse: newCourse 
                });
                
                currentUserData.courseChangeRequested = true;
                currentUserData.requestedCourse = newCourse;
                
                btnRequestChange.textContent = "Change Request Pending Admin Approval...";
                btnRequestChange.style.color = "#94a3b8";
                btnRequestChange.style.pointerEvents = "none";
                
                alert(`Request to switch to ${courseNamesMap[newCourse] || newCourse} submitted! An Admin will review it shortly.`);
                courseChangeModal.style.display = 'none';
                
            } catch (error) {
                console.error(error);
                alert("Failed to submit request. Please check your internet connection.");
            } finally {
                btnSubmitChange.textContent = "Submit Request";
                btnSubmitChange.disabled = false;
            }
        });
    }
}

const profileForm = document.getElementById('profile-form');
if (profileForm) {
    profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btnSave = document.getElementById('btn-save-profile');
        btnSave.textContent = "Saving...";
        btnSave.disabled = true;
        
        try {
            await updateDoc(doc(db, "users", currentUserId), {
                fullName: document.getElementById('prof-name').value,
                phone: document.getElementById('prof-phone').value,
                institution: document.getElementById('prof-uni').value,
                location: document.getElementById('prof-location').value
            });
            
            currentUserData.fullName = document.getElementById('prof-name').value;
            currentUserData.phone = document.getElementById('prof-phone').value;
            currentUserData.institution = document.getElementById('prof-uni').value;
            currentUserData.location = document.getElementById('prof-location').value;
            
            document.getElementById('user-name').textContent = currentUserData.fullName;
            sessionStorage.setItem('edeetos_dash_cache', JSON.stringify(currentUserData)); 
            
            alert("Profile updated successfully!");
            document.getElementById('profile-modal').style.display = 'none';
        } catch (error) {
            console.error("Error updating profile: ", error);
            alert("Failed to update profile.");
        } finally {
            btnSave.textContent = "Save Profile Changes";
            btnSave.disabled = false;
        }
    });
}

// === FEATURE: GROUP STUDY & ROOM GENERATION ===
const btnCreate = document.getElementById('btn-create-room');
if (btnCreate) {
    btnCreate.onclick = async () => {
        if (!currentUserId) {
            alert("User not loaded yet. Please wait...");
            return;
        }

        if (localStorage.getItem('edeetos_guest_mode') === 'true') {
            return alert("Guest accounts cannot host Group Study sessions. Please register for an account.");
        }

        const roomId = Math.floor(1000 + Math.random() * 9000).toString();
        const activeCourse = localStorage.getItem('edeetos_active_course') || currentUserData.selectedCourse || 'Unknown';

        btnCreate.textContent = "Creating...";
        btnCreate.disabled = true;

        try {
            await setDoc(doc(db, "study_rooms", roomId), {
                hostId: currentUserId,
                course: activeCourse,
                currentQuestionIndex: 0,
                status: "waiting",
                createdAt: serverTimestamp()
            });

            const modal = document.createElement('div');
            modal.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                background: rgba(0,0,0,0.7); display: flex; justify-content: center;
                align-items: center; z-index: 99999;
            `;

            modal.innerHTML = `
                <div style="background: white; padding: 30px; border-radius: 12px; text-align: center; max-width: 350px; width: 90%;">
                    <h2 style="margin-bottom: 10px;">Room Created 🎉</h2>
                    <p style="margin-bottom: 15px;">Share this code:</p>
                    <div id="room-code-box" style="font-size: 2rem; font-weight: bold; background: #f1f5f9; padding: 10px; border-radius: 8px; letter-spacing: 4px; margin-bottom: 20px;">${roomId}</div>
                    <button id="copy-room-code" style="margin-bottom: 10px; padding: 10px 20px; border: none; background: #3b82f6; color: white; border-radius: 8px; cursor: pointer;">Copy Code</button><br>
                    <button id="enter-room" style="padding: 10px 20px; border: none; background: #10b981; color: white; border-radius: 8px; cursor: pointer;">Enter Room</button>
                </div>
            `;

            document.body.appendChild(modal);
            btnCreate.textContent = "Create Room";
            btnCreate.disabled = false;

            document.getElementById('copy-room-code').onclick = () => {
                navigator.clipboard.writeText(roomId);
                document.getElementById('copy-room-code').textContent = "Copied ✔️";
            };

            document.getElementById('enter-room').onclick = () => {
                localStorage.setItem('active_study_room', roomId);
                localStorage.removeItem('is_study_guest');
                window.location.href = 'questions.html';
            };

        } catch (error) {
            console.error(error);
            alert("Failed to create room.");
            btnCreate.textContent = "Create Room";
            btnCreate.disabled = false;
        }
    };
}

const joinModal = document.getElementById('join-room-modal');
const btnJoin = document.getElementById('btn-join-room');
const btnCloseJoin = document.getElementById('btn-close-join');
const btnSubmitJoin = document.getElementById('btn-submit-join');
const joinInput = document.getElementById('join-room-input');

if (btnJoin) {
    btnJoin.onclick = () => {
        if (localStorage.getItem('edeetos_guest_mode') === 'true') {
            alert("Guest accounts cannot join Group Study sessions. Please register for an account.");
            return;
        }
        joinInput.value = ""; 
        joinModal.style.display = 'flex';
        joinInput.focus();
    };
}

if (btnCloseJoin) {
    btnCloseJoin.onclick = () => joinModal.style.display = 'none';
}

if (btnSubmitJoin) {
    btnSubmitJoin.onclick = async () => {
        const code = joinInput.value.trim();
        if (code.length !== 4) return alert("Please enter a valid 4-digit code.");

        btnSubmitJoin.textContent = "Verifying...";
        btnSubmitJoin.disabled = true;

        try {
            const roomRef = doc(db, "study_rooms", code);
            const roomSnap = await getDoc(roomRef);

            if (roomSnap.exists()) {
                const roomData = roomSnap.data();
                const roomCourse = roomData.course;

                let hasPremiumAccess = false;
                const subs = currentUserData.subscriptions || {};
                const expiry = subs[roomCourse] || subs['ALL'];

                if (expiry && (expiry === 'lifetime' || new Date(expiry) > new Date())) {
                    hasPremiumAccess = true;
                }
                
                const role = (currentUserData.role || '').toUpperCase();
                if (role === 'ADMIN' || role === 'MANAGEMENT') hasPremiumAccess = true;

                if (!hasPremiumAccess) {
                    alert(`Access Denied 🛑\n\nThis room is studying the Premium Question Bank for ${courseNamesMap[roomCourse] || roomCourse}. You must have an active subscription for this course to join your friend!`);
                    
                    joinModal.style.display = 'none';
                    document.getElementById('premium-modal').style.display = 'flex';
                    if (typeof updatePrices === 'function') updatePrices();
                    
                    btnSubmitJoin.textContent = "Join Room";
                    btnSubmitJoin.disabled = false;
                    return;
                }

                localStorage.setItem('active_study_room', code);
                localStorage.setItem('is_study_guest', 'true'); 
                
                btnSubmitJoin.style.background = "#10b981";
                btnSubmitJoin.textContent = "✅ Connected!";
                
                setTimeout(() => {
                    window.location.href = 'quiz.html';
                }, 800);
            } else {
                alert("Room not found. Please double-check the code with your friend.");
                btnSubmitJoin.textContent = "Join Room";
                btnSubmitJoin.disabled = false;
            }
        } catch (error) {
            console.error("Join error:", error);
            alert("Error connecting to room. Check your connection.");
            btnSubmitJoin.textContent = "Join Room";
            btnSubmitJoin.disabled = false;
        }
    };
}