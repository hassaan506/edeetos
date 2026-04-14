import { auth, db } from "./firebase-config.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const registerForm = document.querySelector('#register-form');

if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // 1. Grab EVERY piece of data from the new detailed form
        const name = document.querySelector('#reg-name').value;
        const username = document.querySelector('#reg-username').value;
        const email = document.querySelector('#reg-email').value;
        const phone = document.querySelector('#reg-phone').value;
        const uni = document.querySelector('#reg-uni').value;
        const year = document.querySelector('#reg-year').value;
        const exam = document.querySelector('#reg-exam').value;
        const location = document.querySelector('#reg-location').value;
        const password = document.querySelector('#reg-password').value;

        try {
            // 2. Create login credentials in Firebase Auth
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            const newToken = Date.now().toString() + Math.random().toString(36).substring(2);
            localStorage.setItem("edeetos_session_id", newToken);

            // 3. Save the complete detailed profile to the Firestore database
            await setDoc(doc(db, "users", user.uid), {
                fullName: name,
                username: username,
                email: email,
                phone: phone,
                institution: uni,
                yearOfStudy: year,
                targetExam: exam,
                location: location,
                role: "student", // Automatically locked to student
                sessionToken: newToken,
                createdAt: new Date().toISOString()
            });

            alert("Success! Your detailed EDEETOS profile has been created.");
            window.location.href = "index.html"; 

        } catch (error) {
            alert("Registration failed: " + error.message);
        }
    });
}
