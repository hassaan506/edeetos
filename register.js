import { auth, db } from "./firebase-config.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const registerForm = document.querySelector('#register-form');

if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Capture data from the updated, cleaner form fields
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
            // 1. Create the user in Firebase Auth
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // 2. Generate and store a secure session token
            const newToken = Date.now().toString() + Math.random().toString(36).substring(2);
            localStorage.setItem("edeetos_session_id", newToken);

            // 3. Save the profile to Firestore (Notice we removed yearOfStudy and targetExam)
            await setDoc(doc(db, "users", user.uid), {
                fullName: name,
                username: username,
                email: email,
                phone: phone,
                institution: uni,
                location: location,
                selectedCourse: course, // The exact file prefix (e.g., mbbs_year1)
                courseChangeRequested: false, // Ready for your admin approval feature
                role: "student", 
                sessionToken: newToken,
                createdAt: new Date().toISOString()
            });

            alert("Success! Your profile has been created.");
            
            // 4. Redirect straight to the dashboard
            window.location.href = "dashboard.html"; 

        } catch (error) {
            alert("Registration failed: " + error.message);
        }
    });
}