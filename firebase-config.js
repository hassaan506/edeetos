import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// ==========================================
// 0. GLOBAL UI OVERRIDE (BEAUTIFUL ALERTS)
// ==========================================
window.alert = function(message) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.4); backdrop-filter:blur(4px); display:flex; justify-content:center; align-items:center; z-index:999999;';

    const box = document.createElement('div');
    box.style.cssText = 'background:white; padding:2rem; border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,0.2); text-align:center; width:90%; max-width:400px; transform:scale(0.8); opacity:0; transition:all 0.3s ease;';

    const msg = document.createElement('p');
    msg.textContent = message;
    msg.style.cssText = 'color:#334155; font-size:1.1rem; font-weight:bold; margin-bottom:1.5rem;';

    const btn = document.createElement('button');
    btn.textContent = 'Understood';
    btn.style.cssText = 'background:#059669; color:white; border:none; padding:0.6rem 2rem; border-radius:8px; cursor:pointer; font-weight:bold; font-size:1rem;';
    
    btn.onclick = () => {
        box.style.opacity = '0';
        box.style.transform = 'scale(0.8)';
        setTimeout(() => document.body.removeChild(overlay), 300);
    };

    box.appendChild(msg);
    box.appendChild(btn);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
        box.style.opacity = '1';
        box.style.transform = 'scale(1)';
    });
};

const firebaseConfig = {
    apiKey: "AIzaSyDDP1qj2w7YmteqO5DnquFKyW7KKQ9hUx8",
    authDomain: "edeetos-68fd3.firebaseapp.com",
    databaseURL: "https://edeetos-68fd3-default-rtdb.firebaseio.com",
    projectId: "edeetos-68fd3",
    storageBucket: "edeetos-68fd3.firebasestorage.app",
    messagingSenderId: "159305810254",
    appId: "1:159305810254:web:31bc74567fbf016da89e1f",
    measurementId: "G-D5P5TW3SM1"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// GLOBAL MULTIPLE DEVICE LOGIN RESTRICTOR
onAuthStateChanged(auth, (user) => {
    if (user) {
        if (!window.__sessionListenerAttached) {
            window.__sessionListenerAttached = true;
            onSnapshot(doc(db, "users", user.uid), (docSnap) => {
                if (docSnap.exists()) {
                    const localToken = localStorage.getItem("edeetos_session_id");
                    const dbToken = docSnap.data().sessionToken;
                    
                    // If the tokens do not match, another device logged into this account
                    if (dbToken && localToken && dbToken !== localToken) {
                        alert("Security Alert: Your account was logged into from another device. You will now be signed out.");
                        localStorage.removeItem("edeetos_session_id");
                        signOut(auth).then(() => {
                            window.location.href = "login.html";
                        });
                    }
                }
            });
        }
    }
});

// ==========================================
// ANTI-SCREENCAP & ANTI-COPY PROTECTION
// ==========================================
document.addEventListener('contextmenu', e => e.preventDefault()); // Disable right click
document.addEventListener('copy', e => { 
    e.preventDefault(); 
    alert("Copying text is strictly disabled for security."); 
}); 
document.addEventListener('cut', e => e.preventDefault()); 

document.addEventListener('keyup', (e) => {
    if (e.key === 'PrintScreen') {
        navigator.clipboard.writeText(''); 
        document.body.style.display = 'none'; 
        alert("Screenshots are strictly prohibited.");
        setTimeout(() => document.body.style.display = 'block', 500);
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'PrintScreen' || 
       (e.ctrlKey && ['p','c','s','u'].includes(e.key.toLowerCase())) || 
       (e.metaKey && ['c','s','p'].includes(e.key.toLowerCase())) ||
       (e.shiftKey && e.metaKey && ['s','3','4','5'].includes(e.key.toLowerCase()))) {
        
        document.body.style.display = 'none';
        setTimeout(() => document.body.style.display = 'block', 1000);
    }
});

// Snipping Tool OS-Level Blocker (Defocus)
document.addEventListener('visibilitychange', () => {
    document.body.style.filter = document.hidden ? 'blur(10px) brightness(0)' : 'none';
});
window.addEventListener('blur', () => {
    document.body.style.filter = 'blur(10px) brightness(0)';
});
window.addEventListener('focus', () => {
    document.body.style.filter = 'none';
});

export { auth, db, storage };