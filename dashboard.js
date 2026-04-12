import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// 1. THE BOUNCER: Check if someone is actually logged in
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // IF LOGGED IN: Go to the database and get their profile
        try {
            const docRef = doc(db, "users", user.uid);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const userData = docSnap.data();
                
                // Inject their specific data into the HTML page
                document.getElementById('user-name').textContent = userData.fullName;
                document.getElementById('user-exam').textContent = userData.targetExam;
            } else {
                console.log("No such user document!");
            }
        } catch (error) {
            console.error("Error fetching user data:", error);
        }
    } else {
        // IF NOT LOGGED IN: Kick them back to the login page immediately!
        window.location.href = "login.html";
    }
});

// 2. THE LOGOUT BUTTON
const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        signOut(auth).then(() => {
            // Once logged out, send them to the homepage
            window.location.href = "index.html";
        }).catch((error) => {
            console.error("Logout error:", error);
        });
    });
}