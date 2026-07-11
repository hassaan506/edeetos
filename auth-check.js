// === FEATURE: FIREBASE IMPORTS ===
import { auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// === FEATURE: DOM ELEMENTS ===
const authMenu = document.getElementById('auth-menu');

// === FEATURE: AUTH STATE LISTENER & UI UPDATES ===
if (authMenu) {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            // STATE: LOGGED IN - Render Dashboard & Logout controls
            authMenu.innerHTML = `
                <li><a href="dashboard.html" class="btn-solid">My Dashboard</a></li>
                <li><button id="logout-btn" class="btn-outline" style="font-family: inherit; font-size: 1rem;">Logout</button></li>
            `;

            // FEATURE: LOGOUT LOGIC
            document.getElementById('logout-btn').addEventListener('click', () => {
                signOut(auth).then(() => {
                    window.location.reload(); 
                });
            });

        } else {
            // STATE: LOGGED OUT - Render Register & Login controls
            authMenu.innerHTML = `
                <li><a href="register.html" class="btn-outline">Register</a></li>
                <li><a href="login.html" class="btn-solid">Log In</a></li>
            `;
        }
    });
}