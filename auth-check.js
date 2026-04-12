import { auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// Find the menu area on the webpage
const authMenu = document.getElementById('auth-menu');

// This Firebase tool constantly watches to see if a user logs in or out
if (authMenu) {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            // IF LOGGED IN: Change the buttons
            authMenu.innerHTML = `
                <li><a href="dashboard.html" class="btn-solid">My Dashboard</a></li>
                <li><button id="logout-btn" class="btn-outline" style="font-family: inherit; font-size: 1rem;">Logout</button></li>
            `;

            // Make the Logout button actually work
            document.getElementById('logout-btn').addEventListener('click', () => {
                signOut(auth).then(() => {
                    window.location.reload(); // Refresh page after logging out
                });
            });

        } else {
            // IF LOGGED OUT: Show normal Register/Login buttons
            authMenu.innerHTML = `
                <li><a href="register.html" class="btn-outline">Register</a></li>
                <li><a href="login.html" class="btn-solid">Log In</a></li>
            `;
        }
    });
}