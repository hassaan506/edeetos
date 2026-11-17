import { auth, db } from "./firebase-config.js";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, updateDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// === THEME TOGGLE LOGIC ===
const darkModeBtn = document.getElementById('dark-mode-toggle');
if (darkModeBtn) {
    const icon = darkModeBtn.querySelector('i');
    if (localStorage.getItem('theme') === 'dark') {
        if (icon) icon.className = 'fas fa-sun';
    }
    darkModeBtn.addEventListener('click', () => {
        document.documentElement.classList.toggle('dark-mode');
        const isDark = document.documentElement.classList.contains('dark-mode');
        if (icon) icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
    });
}

// === UI SLIDER & MOBILE TAB LOGIC ===
const signUpBtn = document.getElementById('signUpBtn');
const signInBtn = document.getElementById('signInBtn');
const container = document.getElementById('auth-container');

const mobileLoginBtn = document.getElementById('mobile-login-btn');
const mobileSignupBtn = document.getElementById('mobile-signup-btn');

const triggerSignUp = () => {
    container.classList.add('right-panel-active');
    if (mobileSignupBtn) mobileSignupBtn.classList.add('active');
    if (mobileLoginBtn) mobileLoginBtn.classList.remove('active');
};

const triggerSignIn = () => {
    container.classList.remove('right-panel-active');
    if (mobileLoginBtn) mobileLoginBtn.classList.add('active');
    if (mobileSignupBtn) mobileSignupBtn.classList.remove('active');
};

if (signUpBtn && signInBtn) {
    signUpBtn.addEventListener('click', triggerSignUp);
    signInBtn.addEventListener('click', triggerSignIn);
}

if (mobileLoginBtn && mobileSignupBtn) {
    mobileLoginBtn.addEventListener('click', triggerSignIn);
    mobileSignupBtn.addEventListener('click', triggerSignUp);
}


// === LOGIN LOGIC ===
const loginForm = document.getElementById('login-form');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault(); 
        const identifier = document.querySelector('#login-identifier').value.trim();
        const password = document.querySelector('#login-password').value;
        const submitBtn = loginForm.querySelector('button[type="submit"]');
        let loginEmail = identifier.toLowerCase(); 
        
        submitBtn.textContent = "Logging in...";
        submitBtn.disabled = true;

        try {
            localStorage.removeItem('edeetos_guest_mode');
            if (!identifier.includes('@')) {
                const lookupRef = doc(db, "username_lookup", identifier);
                const lookupSnap = await getDoc(lookupRef);
                if (!lookupSnap.exists()) throw new Error("Username not found. Check spelling or use email.");
                loginEmail = lookupSnap.data().email; 
            }

            const userCred = await signInWithEmailAndPassword(auth, loginEmail, password);
            const newToken = Date.now().toString() + Math.random().toString(36).substring(2);
            sessionStorage.setItem("edeetos_session_id", newToken);
            
            try {
                await updateDoc(doc(db, "users", userCred.user.uid), { sessionToken: newToken });
            } catch (err) {
                console.warn("Token update skipped.");
            }
            window.location.href = "dashboard.html"; 

        } catch (error) {
            alert("Login failed: " + error.message);
            submitBtn.textContent = "Log In";
            submitBtn.disabled = false;
        }
    });
}

// === REGISTRATION LOGIC ===
const registerForm = document.getElementById('register-form');
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = registerForm.querySelector('button[type="submit"]');
        submitBtn.textContent = "Creating account...";
        submitBtn.disabled = true;

        const email = document.querySelector('#reg-email').value.trim();
        const username = document.querySelector('#reg-username').value.toLowerCase().trim();
        const password = document.querySelector('#reg-password').value;

        try {
            const usernameRef = doc(db, "username_lookup", username);
            const usernameSnap = await getDoc(usernameRef);
            if (usernameSnap.exists()) {
                alert("Username is taken. Choose another.");
                submitBtn.textContent = "Sign Up";
                submitBtn.disabled = false;
                return;
            }

            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;
            const newToken = Date.now().toString() + Math.random().toString(36).substring(2);
            sessionStorage.setItem("edeetos_session_id", newToken);

            await setDoc(doc(db, "users", user.uid), {
                email: email,
                username: username,
                profileCompleted: false,
                role: "STUDENT", 
                sessionToken: newToken,
                createdAt: new Date().toISOString()
            });

            await setDoc(doc(db, "username_lookup", username), {
                email: email,
                userId: user.uid
            });

            window.location.href = "dashboard.html"; 

        } catch (error) {
            alert("Registration failed: " + error.message);
            submitBtn.textContent = "Sign Up";
            submitBtn.disabled = false;
        }
    });
}

// === GUEST & PASSWORD RESET ===
const guestBtns = document.querySelectorAll('.guest-btn-trigger');
guestBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
        sessionStorage.removeItem('edeetos_session_id');
        localStorage.setItem('edeetos_guest_mode', 'true');
        try {
            const { signOut } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
            await signOut(auth);
        } catch(e) { }
        window.location.href = "dashboard.html";
    });
});

const forgotPasswordLink = document.getElementById('forgot-password-link');
if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener('click', async (e) => {
        e.preventDefault();
        let resetEmail = document.querySelector('#login-identifier').value.trim();
        if (!resetEmail || !resetEmail.includes('@')) {
            resetEmail = prompt("Enter your email address to reset your password:");
        }
        if (!resetEmail || !resetEmail.includes('@')) return alert("Valid email required.");
        
        try {
            await sendPasswordResetEmail(auth, resetEmail);
            alert("Reset link sent to your inbox.");
        } catch (error) {
            alert("Failed: " + error.message);
        }
    });
}