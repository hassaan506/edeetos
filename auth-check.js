// === FEATURE: FIREBASE IMPORTS ===
import { auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// === FEATURE: DOM ELEMENTS ===
const authMenu = document.getElementById('auth-menu');

// === FEATURE: AUTH STATE LISTENER & UI UPDATES ===
if (authMenu) {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            authMenu.innerHTML = `
                <li><a href="dashboard.html" class="btn-solid">Console</a></li>
                <li><button id="logout-btn" class="btn-outline" style="font-family: inherit; font-size: 0.95rem;">Disconnect</button></li>
            `;

            document.getElementById('logout-btn').addEventListener('click', () => {
                signOut(auth).then(() => {
                    window.location.reload(); 
                });
            });

        } else {
            // Updated to point to the new unified auth file
            authMenu.innerHTML = `
                <li><a href="auth.html" class="btn-outline">Log In</a></li>
                <li><a href="auth.html" class="btn-solid">Sign Up</a></li>
            `;
        }
    });
}