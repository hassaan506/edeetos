import { auth, db } from "./firebase-config.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
// We need these new tools to search the database
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const loginForm = document.querySelector('#login-form');

if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault(); 

        // We call it 'identifier' because it could be an email OR a username
        const identifier = document.querySelector('#login-identifier').value.trim();
        const password = document.querySelector('#login-password').value;
        
        let loginEmail = identifier.toLowerCase(); 

        try {
            // Nuke guest token before attempting true login
            localStorage.removeItem('edeetos_guest_mode');

            // STEP 1: If they didn't type an '@', they must have typed a username!
            if (!identifier.includes('@')) {
                throw new Error("For security purposes, Firebase requires email-based authentication. Please use your registered Email Address to log in instead of your username.");
            }

            // STEP 2: Now that we definitely have the email, log them in!
            const userCred = await signInWithEmailAndPassword(auth, loginEmail, password);
            
            const newToken = Date.now().toString() + Math.random().toString(36).substring(2);
            localStorage.setItem("edeetos_session_id", newToken);
            
            const { doc, updateDoc } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
            await updateDoc(doc(db, "users", userCred.user.uid), { sessionToken: newToken });
            
            alert("Login Successful! Opening your Dashboard...");
            window.location.href = "dashboard.html"; 

        } catch (error) {
            // If they type a wrong password or bad username, tell them beautifully
            alert("Login failed: " + error.message);
        }
    });
}

const btnGuest = document.getElementById('btn-guest');
if (btnGuest) {
    btnGuest.addEventListener('click', async () => {
        localStorage.removeItem('edeetos_session_id');
        localStorage.setItem('edeetos_guest_mode', 'true');
        
        try {
            const { signOut } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
            await signOut(auth);
        } catch(e) { }

        alert("Entering Guest Mode. You will have limited access to questions.");
        window.location.href = "dashboard.html";
    });
}