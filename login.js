// === FEATURE: FIREBASE IMPORTS ===
import { auth, db } from "./firebase-config.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { collection, query, where, getDocs, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// === FEATURE: DOM ELEMENTS ===
const loginForm = document.querySelector('#login-form');
const btnGuest = document.getElementById('btn-guest');
const forgotPasswordLink = document.getElementById('forgot-password-link');

// === FEATURE: REGISTERED USER LOGIN ===
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault(); 

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

            // Username Resolution Logic
            if (!identifier.includes('@')) {
                const usersRef = collection(db, "users");
                const q = query(usersRef, where("username", "==", identifier));
                const querySnapshot = await getDocs(q);

                if (querySnapshot.empty) {
                    throw new Error("Username not found. Please check your spelling or log in using your email address.");
                }

                const userData = querySnapshot.docs[0].data();
                if (!userData.email) {
                    throw new Error("No email linked to this username.");
                }
                
                loginEmail = userData.email; 
            }

            // Firebase Authentication
            const userCred = await signInWithEmailAndPassword(auth, loginEmail, password);
            
            // Session Token Generation
            const newToken = Date.now().toString() + Math.random().toString(36).substring(2);
            localStorage.setItem("edeetos_session_id", newToken);
            
            try {
                await updateDoc(doc(db, "users", userCred.user.uid), { sessionToken: newToken });
            } catch (authErr) {
                console.warn("Session token update skipped due to database rules. Login continuing...", authErr);
            }
            
            alert("Login Successful! Opening your Dashboard...");
            window.location.href = "dashboard.html"; 

        } catch (error) {
            alert("Login failed: " + error.message);
            submitBtn.textContent = "Log In";
            submitBtn.disabled = false;
        }
    });
}

// === FEATURE: GUEST MODE LOGIN ===
if (btnGuest) {
    btnGuest.addEventListener('click', async () => {
        // Swap out valid tokens for guest mode flag
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

// === FEATURE: FORGOT PASSWORD ===
if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener('click', async (e) => {
        e.preventDefault();
        
        // Grab the current value from the identifier input
        const identifierInput = document.querySelector('#login-identifier').value.trim();
        let resetEmail = identifierInput;

        // If the field is empty or contains a username (no '@'), explicitly ask for an email
        if (!resetEmail || !resetEmail.includes('@')) {
            resetEmail = prompt("Please enter the email address associated with your account to reset your password:");
        } else {
            // Confirm with the user if the field already contains an email
            const confirmEmail = confirm(`Send password reset link to ${resetEmail}?`);
            if (!confirmEmail) return;
        }

        // Validate that we have a functional email address before sending to Firebase
        if (!resetEmail || !resetEmail.includes('@')) {
            return alert("A valid email address is required to reset your password.");
        }

        try {
            // Trigger Firebase's built-in reset email function
            await sendPasswordResetEmail(auth, resetEmail);
            alert("Password reset email sent! Please check your inbox and spam folder.");
        } catch (error) {
            console.error("Password Reset Error:", error);
            alert("Failed to send reset email: " + error.message);
        }
    });
}