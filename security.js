// === FEATURE: FIREBASE IMPORTS ===
import { auth, db } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// === FEATURE: SECURITY LOCKDOWN LOGIC ===
function enforceSecurityLockdown() {
    console.log("Security Active: User is standard. Protection engaged.");
    
    // 1. Prevent text selection
    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";

    // 2. Block right-click
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    // 3. Block Ctrl+C / Cmd+C
    document.addEventListener('copy', (e) => e.preventDefault());

    // 4. Intercept PrintScreen
    document.addEventListener('keydown', (e) => {
        if (e.key === 'PrintScreen') {
            navigator.clipboard.writeText(''); // Clear clipboard
            alert("Screenshots are strictly prohibited."); // Specific alert requested
            e.preventDefault();
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
            e.preventDefault();
        }
    });

    // 5. Blur Screen on Tab/Window Switch
    const blurOverlay = document.createElement('div');
    blurOverlay.id = 'security-blur-overlay';
    blurOverlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(255,255,255,0.85); backdrop-filter: blur(15px); z-index: 2147483647; display: none; justify-content: center; align-items: center; font-size: 2rem; font-weight: 800; color: #ef4444; flex-direction: column; text-align: center;';
    blurOverlay.innerHTML = '<i class="fas fa-eye-slash" style="font-size: 4rem; margin-bottom: 1rem;"></i><div>Content Hidden</div><div style="font-size: 1rem; color: #64748b; margin-top: 10px;">Return to this window to continue viewing.</div>';
    document.body.appendChild(blurOverlay);

    // Triggers when window loses focus
    window.addEventListener('blur', () => { blurOverlay.style.display = 'flex'; });
    // Triggers when window regains focus
    window.addEventListener('focus', () => { blurOverlay.style.display = 'none'; });
    // Triggers when switching browser tabs
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) blurOverlay.style.display = 'flex';
        else blurOverlay.style.display = 'none';
    });
}

// === FEATURE: ROLE VALIDATION ===
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists()) {
                const role = (userDoc.data().role || "").toLowerCase();
                // Grant absolute access to Admins and Management
                if (role === "admin" || role === "management") {
                    console.log("Security Bypassed: Admin/Management access granted.");
                    return; 
                }
            }
        } catch (error) {
            console.error("Error verifying role:", error);
        }
    }
    // If not admin/management, or not logged in, enforce lockdown
    enforceSecurityLockdown();
});