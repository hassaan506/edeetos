import { auth, db, storage } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
// 👉 We added query, where, and onSnapshot to this import line!
import { doc, getDoc, updateDoc, addDoc, collection, serverTimestamp, query, where, onSnapshot, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
let currentUserData = null;
let currentUserId = null;

// ==========================================
// 1. DASHBOARD LOAD & BADGE LOGIC
// ==========================================
onAuthStateChanged(auth, async (user) => {
    const freeWarning = document.getElementById('free-warning-text');
    const subStatus = document.getElementById('subscription-status');

    if (user) {
        currentUserId = user.uid;
        const userRef = doc(db, "users", user.uid);
        try {
            const docSnap = await getDoc(userRef);

            if (docSnap.exists()) {
                currentUserData = docSnap.data();
                if (currentUserData.isBanned || currentUserData.role === 'BANNED') {
                    
                    // 1. Visually change the underlying dashboard UI
                    document.getElementById('user-name').textContent = "ACCOUNT SUSPENDED";
                    if (subStatus) {
                        subStatus.textContent = "BANNED";
                        subStatus.className = "status-badge";
                        subStatus.style.background = "#fee2e2";
                        subStatus.style.color = "#ef4444";
                        subStatus.style.border = "1px solid #fca5a5";
                    }
                    
                    // 2. Create the inescapable full-screen lockout overlay
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
                    
                    // 3. Add it to the page and kill scrolling
                    document.body.appendChild(lockoutScreen);
                    document.body.style.overflow = 'hidden'; // Prevents them from scrolling down
                    
                    // 4. Add the logout functionality to the button inside the overlay
                    document.getElementById('btn-banned-logout').addEventListener('click', () => {
                        document.getElementById('btn-banned-logout').textContent = "Logging out...";
                        signOut(auth).then(() => {
                            window.location.href = 'index.html';
                        }).catch(() => {
                            window.location.href = 'index.html';
                        });
                    });
                    
                    return; // Stop the rest of the dashboard from loading!
                }				
                document.getElementById('user-name').textContent = currentUserData.fullName || "Doctor";
                
                const userRole = (currentUserData.role || '').toUpperCase();

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
                    
                } else if (currentUserData.isPremium) {
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

                // 👉 GLOBAL MENTOR NOTIFICATIONS
                if (userRole === 'MENTOR' || userRole === 'MANAGEMENT' || userRole === 'ADMIN') {
                    
                    // UX Improvement: Update their dashboard card text since they ARE the mentor
                    const btnMentor = document.getElementById('btn-contact-mentor');
                    if (btnMentor) {
                        btnMentor.textContent = "Open Mentorship Hub";
                        const cardH3 = btnMentor.parentElement.querySelector('h3');
                        const cardP = btnMentor.parentElement.querySelector('p');
                        if (cardH3) cardH3.textContent = "Mentorship Hub";
                        if (cardP) cardP.textContent = "Manage incoming student chat requests.";
                    }

                    // Real-time listener for incoming chats
                    const chatsRef = collection(db, "chats");
                    const q = query(chatsRef, where("mentorId", "==", currentUserId), where("status", "==", "pending"));
                    
                    onSnapshot(q, (snapshot) => {
                        let banner = document.getElementById('mentor-alert-banner');
                        
                        if (!snapshot.empty) {
                            // If someone is calling, create and show the pulsing red banner!
                            if (!banner) {
                                banner = document.createElement('div');
                                banner.id = 'mentor-alert-banner';
                                banner.style = "position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #ef4444; color: white; padding: 12px 24px; border-radius: 30px; font-weight: 800; font-size: 1.1rem; z-index: 9999; cursor: pointer; display: flex; align-items: center; gap: 10px;";
                                banner.innerHTML = `<span>🚨</span> <span>Incoming Chat Request! Click here to answer.</span>`;
                                banner.onclick = () => window.location.href = 'mentor.html';
                                document.body.appendChild(banner);
                                
                                // Injecting animation CSS safely
                                if(!document.getElementById('pulse-anim-style')) {
                                    const style = document.createElement('style');
                                    style.id = 'pulse-anim-style';
                                    style.innerHTML = `@keyframes alertPulse { 0% { transform: translateX(-50%) scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); } 70% { transform: translateX(-50%) scale(1.05); box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); } 100% { transform: translateX(-50%) scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); } } #mentor-alert-banner { animation: alertPulse 1.5s infinite; }`;
                                    document.head.appendChild(style);
                                }
                            }
                            banner.style.display = 'flex';
                        } else {
                            // If they hang up or the chat is answered, hide the banner
                            if (banner) banner.style.display = 'none';
                        }
                    });
                }

                // ==========================================
                // 👉 NEW: STUDENT FEATURE: FETCH ASSIGNED EXAMS
                // ==========================================
                if (userRole === 'STUDENT' || currentUserData.isPremium) {
                    const examsRef = collection(db, "assigned_exams");
                    const assignedQuery = query(examsRef, where("assignedTo", "array-contains", currentUserId));
                    
                    try {
                        const examsSnapshot = await getDocs(assignedQuery);
                        const pendingExams = [];
                        
                        examsSnapshot.forEach((docSnap) => {
                            const data = docSnap.data();
                            // Only show exams they haven't completed yet
                            if (!data.isCompletedBy || !data.isCompletedBy.includes(currentUserId)) {
                                pendingExams.push({ id: docSnap.id, ...data });
                            }
                        });

                        if (pendingExams.length > 0) {
                            // Create a container on the dashboard for assigned exams
                            const dashboardContainer = document.querySelector('.dashboard-container') || document.body;
                            
                            const examsCard = document.createElement('div');
                            examsCard.className = 'glass-panel';
                            examsCard.style.cssText = "margin-top: 2rem; border: 2px solid #3b82f6; background: rgba(59, 130, 246, 0.05);";
                            
                            let examsHtml = `
                                <h3 style="color: #1e3a8a; margin-bottom: 1rem;">
                                    <i class="fas fa-clipboard-list"></i> Assigned Exams (${pendingExams.length})
                                </h3>
                                <p style="color: #475569; margin-bottom: 1rem;">Your mentor has assigned you the following tasks.</p>
                                <div style="display: flex; flex-direction: column; gap: 10px;">
                            `;

                            pendingExams.forEach((exam, index) => {
                                examsHtml += `
                                    <div style="background: white; padding: 15px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                                        <div>
                                            <strong style="color: #0f172a;">${exam.title}</strong>
                                            <div style="font-size: 0.85rem; color: #64748b; margin-top: 5px;">
                                                ⏱ ${exam.timerMinutes} Minutes • 📝 ${exam.questions.length} Questions
                                            </div>
                                        </div>
                                        <button id="launch-assigned-${index}" class="btn-solid mini-btn" style="background: #3b82f6;">Start Exam</button>
                                    </div>
                                `;
                            });

                            examsHtml += `</div>`;
                            examsCard.innerHTML = examsHtml;
                            
                            // Insert it at the top of the dashboard
                            dashboardContainer.insertBefore(examsCard, dashboardContainer.firstChild);

                            // Add click listeners to launch the quizzes
                            pendingExams.forEach((exam, index) => {
                                document.getElementById(`launch-assigned-${index}`).addEventListener('click', () => {
                                    localStorage.setItem('edeetos_active_quiz', JSON.stringify(exam.questions));
                                    localStorage.setItem('edeetos_quiz_config', JSON.stringify({ 
                                        mode: 'exam', 
                                        timer: exam.timerMinutes, 
                                        examName: exam.title 
                                    }));
                                    localStorage.setItem('edeetos_assigned_exam_id', exam.id);
                                    
                                    window.location.href = 'quiz.html';
                                });
                            });
                        }
                    } catch (examErr) {
                        console.error("Error fetching assigned exams:", examErr);
                    }
                }
                // ==========================================
                // END NEW ASSIGNED EXAMS LOGIC
                // ==========================================

            }
        } catch (error) {
            console.error("Error fetching user data:", error);
        }
    } else {
        // GUEST MODE LOGIC
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
// ==========================================
// 2. NAVIGATION BUTTONS
// ==========================================
document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('edeetos_guest_mode');
    signOut(auth).then(() => { window.location.href = 'index.html'; }).catch(() => {
        window.location.href = 'index.html';
    });
});

document.getElementById('btn-admin-panel').addEventListener('click', () => {
    window.location.href = 'admin.html';
});

document.getElementById('btn-contact-mentor').addEventListener('click', () => {
    if (localStorage.getItem('edeetos_guest_mode') === 'true') return alert("Please register to access Mentorship.");
    window.location.href = 'mentor.html';
});

document.getElementById('btn-open-premium').addEventListener('click', () => {
    if (localStorage.getItem('edeetos_guest_mode') === 'true') return alert("Please register to upgrade to Premium.");
    document.getElementById('premium-modal').style.display = 'flex';
    updatePrices();
});

document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.target.closest('.popup-overlay').style.display = 'none';
    });
});

window.addEventListener('load', () => {
    const savedCourse = localStorage.getItem('edeetos_active_course');
    if (savedCourse) {
        const drop = document.getElementById('course-dropdown');
        if(drop) drop.value = savedCourse;
    }
});

document.getElementById('btn-launch-course').addEventListener('click', () => {
    const selectedCourse = document.getElementById('course-dropdown').value;
    localStorage.setItem('edeetos_active_course', selectedCourse);
    window.location.href = 'questions.html';
});

// ==========================================
// 3. PRICING MODAL TABS & LOGIC
// ==========================================
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
    const checkedCount = document.querySelectorAll('.course-check:checked').length;
    if (checkedCount === 0) return alert("You must select at least one course.");
    document.getElementById('selected-courses-text').textContent = `${checkedCount} Course${checkedCount > 1 ? 's' : ''} Selected`;
    courseSelectorModal.style.display = 'none';
    updatePrices();
});

const basePrices = [50, 150, 250, 400, 1000, 1500, 2500, 3500];
const maxPrices = [200, 500, 800, 1500, 3000, 4000, 4500, 5000];

function updatePrices() {
    const count = Math.max(1, document.querySelectorAll('.course-check:checked').length);
    const multiplier = 1 + ((count - 1) * 0.25); 

    for(let i = 0; i < 8; i++) {
        let calculatedPrice = Math.round(basePrices[i] * multiplier);
        if (calculatedPrice > maxPrices[i]) calculatedPrice = maxPrices[i];
        const priceEl = document.getElementById('price-' + i);
        if(priceEl) priceEl.textContent = 'Rs. ' + calculatedPrice.toLocaleString();
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

// ==========================================
// 4. SUBMIT PAYMENT REQUEST
// ==========================================
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
        // Ensure user is logged in
        if(!currentUserId) return alert("Authentication error. Please refresh the page.");

        // Change button state
        btnSubmitPayment.textContent = "Submitting...";
        btnSubmitPayment.disabled = true;

        try {
            // Moved all element fetching inside the try block to catch any unexpected HTML errors
            const courses = Array.from(document.querySelectorAll('.course-check:checked')).map(cb => cb.value);
            const selectedPlan = document.querySelector('.plan-card.selected');
            
            if (!selectedPlan) throw new Error("No plan selected.");

            const durationDays = selectedPlan.getAttribute('data-days');
            const planName = selectedPlan.getAttribute('data-name');
            const fallbackEmail = auth.currentUser ? auth.currentUser.email : "Unknown Email";

            const fileInput = document.getElementById('payment-proof');
            const file = fileInput.files[0];
            
            if (!file) {
                alert("Please upload your payment proof.");
                // Reset button if returning early
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

            // Using optional chaining (?.) so it won't crash if currentUserData is temporarily null
            const userEmailToSave = currentUserData?.email || fallbackEmail;

            // Prepare the Firestore request
            const submitPromise = addDoc(collection(db, "payment_requests"), {
                userId: currentUserId,
                userEmail: userEmailToSave,
                courses: courses,
                durationDays: durationDays,
                planName: planName,
                receiptUrl: receiptUrl,
                status: 'pending',
                timestamp: serverTimestamp()
            });

            // Set up a 12-second timeout in case Firebase hangs due to a weak connection
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error("Request timed out. Please check your internet connection.")), 12000);
            });

            // Race the upload against the timeout. Whichever finishes first wins!
            await Promise.race([submitPromise, timeoutPromise]);
            
            alert("Payment request submitted successfully! Please wait for admin approval.");
            document.getElementById('premium-modal').style.display = 'none';

        } catch (e) {
            console.error("Payment submission error: ", e);
            alert("Failed to submit request: " + (e.message || "An unknown error occurred."));
        } finally {
            // This 'finally' block is guaranteed to run, resetting your button safely
            btnSubmitPayment.textContent = "Confirm & Submit Request";
            btnSubmitPayment.disabled = false;
        }
    });
}

// ==========================================
// 5. REDEEM CODE 
// ==========================================
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
            } else {
                currentSubs[keyData.course] = expiryValue;
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

// ==========================================
// 6. PROFILE MODAL LOGIC 
// ==========================================
const btnOpenProfile = document.getElementById('btn-open-profile');
if (btnOpenProfile) {
    btnOpenProfile.addEventListener('click', () => {
        if (localStorage.getItem('edeetos_guest_mode') === 'true') return alert("Please register to access your Profile.");
        if (!currentUserData) return alert("User data loading, please wait...");
        document.getElementById('profile-modal').style.display = 'flex';
        
        // Populate form
        document.getElementById('prof-role-badge').textContent = (currentUserData.role || 'STUDENT').toUpperCase();
        document.getElementById('prof-name').value = currentUserData.fullName || '';
        document.getElementById('prof-username').value = currentUserData.username || '';
        document.getElementById('prof-email').value = currentUserData.email || '';
        document.getElementById('prof-phone').value = currentUserData.phone || '';
        document.getElementById('prof-uni').value = currentUserData.institution || '';
        document.getElementById('prof-year').value = currentUserData.yearOfStudy || '';
        document.getElementById('prof-location').value = currentUserData.location || '';
        
        // Subscriptions
        const subsList = document.getElementById('prof-subs-list');
        subsList.innerHTML = '';
        
        const subs = currentUserData.subscriptions || {};
        const courseNames = {
            'fcps_part1': 'FCPS Part 1', 'fcps_part2': 'FCPS Part 2', 'fcps_imm': 'FCPS IMM',
            'mrcs_part1': 'MRCS Part 1', 'mrcs_part2': 'MRCS Part 2',
            'mbbs_year1': 'MBBS Year 1', 'mbbs_year2': 'MBBS Year 2', 'mbbs_year3': 'MBBS Year 3', 'mbbs_year4': 'MBBS Year 4', 'mbbs_year5': 'MBBS Year 5'
        };
        
        let hasSubs = false;
        for (const [key, expiry] of Object.entries(subs)) {
            hasSubs = true;
            const name = courseNames[key] || key;
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
                yearOfStudy: document.getElementById('prof-year').value,
                location: document.getElementById('prof-location').value
            });
            
            currentUserData.fullName = document.getElementById('prof-name').value;
            currentUserData.phone = document.getElementById('prof-phone').value;
            currentUserData.institution = document.getElementById('prof-uni').value;
            currentUserData.yearOfStudy = document.getElementById('prof-year').value;
            currentUserData.location = document.getElementById('prof-location').value;
            
            document.getElementById('user-name').textContent = currentUserData.fullName;
            
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