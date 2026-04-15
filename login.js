import { auth, db } from "./firebase-config.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
// We need these tools to search the database
import { collection, query, where, getDocs, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const loginForm = document.querySelector('#login-form');

if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault(); 

        // We call it 'identifier' because it could be an email OR a username
        const identifier = document.querySelector('#login-identifier').value.trim();
        const password = document.querySelector('#login-password').value;
        const submitBtn = loginForm.querySelector('button[type="submit"]');
        
        let loginEmail = identifier.toLowerCase(); 
        
        // Show loading state
        submitBtn.textContent = "Logging in...";
        submitBtn.disabled = true;

        try {
            // Nuke guest token before attempting true login
            localStorage.removeItem('edeetos_guest_mode');

            // STEP 1: If they didn't type an '@', we assume it's a username!
            if (!identifier.includes('@')) {
                throw new Error("For security purposes, Firebase requires email-based authentication. Please use your registered Email Address to log in instead of your username.");
            }

            // STEP 2: Now that we definitely have the email, log them in!
            const userCred = await signInWithEmailAndPassword(auth, loginEmail, password);
            
            const newToken = Date.now().toString() + Math.random().toString(36).substring(2);
            localStorage.setItem("edeetos_session_id", newToken);
            
            // Save the session token to the database
            try {
                await updateDoc(doc(db, "users", userCred.user.uid), { sessionToken: newToken });
            } catch (authErr) {
                console.warn("Session token update skipped due to database rules. Login continuing...", authErr);
            }
            
            alert("Login Successful! Opening your Dashboard...");
            window.location.href = "dashboard.html"; 

        } catch (error) {
            // If they type a wrong password or bad username, tell them beautifully
            alert("Login failed: " + error.message);
            submitBtn.textContent = "Log In";
            submitBtn.disabled = false;
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