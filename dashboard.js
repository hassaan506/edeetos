import { auth, db, storage } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, updateDoc, addDoc, collection, serverTimestamp, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
let currentUserData = null;
let currentUserId = null;

// ==========================================
// 1. DASHBOARD LOAD & BADGE LOGIC
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUserId = user.uid;
        const userRef = doc(db, "users", user.uid);
        try {
            const docSnap = await getDoc(userRef);

            if (docSnap.exists()) {
                currentUserData = docSnap.data();
                
                document.getElementById('user-name').textContent = currentUserData.fullName || "Doctor";
                
                const subStatus = document.getElementById('subscription-status');
                const freeWarning = document.getElementById('free-warning-text');
                const userRole = (currentUserData.role || '').toUpperCase();

                subStatus.className = "status-badge";
                subStatus.style.background = "";
                subStatus.style.color = "";
                subStatus.style.border = "";

                if (userRole === 'MANAGEMENT' || userRole === 'ADMIN') {
                    subStatus.textContent = "Admin";
                    subStatus.style.background = "#f3e8ff";
                    subStatus.style.color = "#8b5cf6";
                    subStatus.style.border = "1px solid #c084fc";
                    
                    document.getElementById('btn-admin-panel').style.display = 'flex';
                    if (freeWarning) freeWarning.style.display = 'none';
                    
                } else if (currentUserData.isPremium) {
                    subStatus.textContent = "Premium";
                    subStatus.className = "status-badge badge-pro";
                    if (freeWarning) freeWarning.style.display = 'none';
                    
                } else {
                    subStatus.textContent = "Free Tier";
                    subStatus.className = "status-badge badge-free";
                    if (freeWarning) freeWarning.style.display = 'inline';
                }

                // GLOBAL MENTOR PING LISTENER
                if (userRole === 'MENTOR' || userRole === 'MANAGEMENT' || userRole === 'ADMIN') {
                    const qChats = query(collection(db, "chats"), where("status", "==", "pending"));
                    onSnapshot(qChats, (snapshot) => {
                        snapshot.docChanges().forEach((change) => {
                            if (change.type === "added") {
                                const data = change.doc.data();
                                alert(`🚨 EDEETOS ALERT: Incoming Mentor Request from ${data.studentName}! Please open the Mentorship Hub to accept the chat.`);
                            }
                        });
                    });
                }

            }
        } catch (error) {
            console.error("Error fetching user data:", error);
        }
    } else {
        if (localStorage.getItem('edeetos_guest_mode') === 'true') {
            currentUserId = 'guest';
            currentUserData = { role: 'GUEST', fullName: 'Guest User', isPremium: false };
            document.getElementById('user-name').textContent = "Guest User";
            
            const subStatus = document.getElementById('subscription-status');
            const freeWarning = document.getElementById('free-warning-text');
            if (subStatus) {
                subStatus.textContent = "Guest Mode";
                subStatus.className = "status-badge badge-free";
            }
            if (freeWarning) freeWarning.style.display = 'inline';
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