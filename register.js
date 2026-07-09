import { auth, db } from "./firebase-config.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const registerForm = document.querySelector('#register-form');

if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = document.querySelector('#reg-name').value;
        const username = document.querySelector('#reg-username').value.toLowerCase().trim();
        const email = document.querySelector('#reg-email').value;
        const phone = document.querySelector('#reg-phone').value;
        const uni = document.querySelector('#reg-uni').value;
        const location = document.querySelector('#reg-location').value;
        const password = document.querySelector('#reg-password').value;
        
        // This is the new master course selector we added
        const course = document.querySelector('#reg-course').value;

        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            const newToken = Date.now().toString() + Math.random().toString(36).substring(2);
            localStorage.setItem("edeetos_session_id", newToken);

            await setDoc(doc(db, "users", user.uid), {
                fullName: name,
                username: username,
                email: email,
                phone: phone,
                institution: uni,
                location: location,
                selectedCourse: course, // The exact file prefix (e.g., mbbs_year1)
                courseChangeRequested: false, 
                role: "student", 
                sessionToken: newToken,
                createdAt: new Date().toISOString()
            });

            alert("Success! Your profile has been created.");
            window.location.href = "dashboard.html"; 

        } catch (error) {
            alert("Registration failed: " + error.message);
        }
    });
}