// === FEATURE: FIREBASE IMPORTS ===
import { auth, db } from "./firebase-config.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// === FEATURE: DOM ELEMENTS ===
const registerForm = document.querySelector('#register-form');

// === FEATURE: REGISTRATION LOGIC ===
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // 1. Gather Input Values
        const name = document.querySelector('#reg-name').value;
        const username = document.querySelector('#reg-username').value.toLowerCase().trim();
        const email = document.querySelector('#reg-email').value;
        const phone = document.querySelector('#reg-phone').value;
        const uni = document.querySelector('#reg-uni').value;
        const location = document.querySelector('#reg-location').value;
        const password = document.querySelector('#reg-password').value;
        const course = document.querySelector('#reg-course').value;

        try {
            // 2. Create Firebase Auth User
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // 3. Generate Session Token
            const newToken = Date.now().toString() + Math.random().toString(36).substring(2);
            localStorage.setItem("edeetos_session_id", newToken);

            // 4. Write to Firestore Database
            await setDoc(doc(db, "users", user.uid), {
                fullName: name,
                username: username,
                email: email,
                phone: phone,
                institution: uni,
                location: location,
                selectedCourse: course, // Exact file prefix mapped directly
                courseChangeRequested: false, 
                role: "student", 
                sessionToken: newToken,
                createdAt: new Date().toISOString()
            });

            // 5. Success Routing
            alert("Success! Your profile has been created.");
            window.location.href = "dashboard.html"; 

        } catch (error) {
            alert("Registration failed: " + error.message);
        }
    });
}