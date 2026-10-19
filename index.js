import { db } from "./firebase-config.js";
import { collection, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

document.addEventListener('DOMContentLoaded', () => {
    const auth = getAuth();

    // AUTHENTICATION STATE OVERRIDE
    onAuthStateChanged(auth, (user) => {
        if (user) {
            // Target your login button and switch it to a Dashboard link
            // Replace '.your-login-btn-class' with your actual button selector
            const loginBtn = document.querySelector('.your-login-btn-class');
            if (loginBtn) {
                loginBtn.textContent = "Go to Dashboard";
                loginBtn.href = "dashboard.html";
                
                // If it's a button element instead of an anchor link:
                loginBtn.onclick = (e) => {
                    e.preventDefault();
                    window.location.href = "dashboard.html";
                };
            }
        }
    });

    // === FEATURE: CONTACT FORM SUBMISSION ===
    const contactForm = document.getElementById('contact-form');
    if (contactForm) {
        contactForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const submitBtn = contactForm.querySelector('button[type="submit"]');
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
            submitBtn.disabled = true;
            
            try {
                await addDoc(collection(db, "contact_messages"), {
                    name: document.getElementById('contact-name').value,
                    email: document.getElementById('contact-email').value,
                    whatsapp: document.getElementById('contact-whatsapp').value,
                    message: document.getElementById('contact-msg').value,
                    timestamp: new Date().toISOString()
                });
                
                alert("Thank you for reaching out! A member of the EDEETOS team will get back to you shortly.");
                contactForm.reset();
            } catch (error) {
                console.error("Firebase DB error:", error);
                alert("Security Error: Your database rules are blocking incoming messages from public users. Please update your Firebase Rules to allow 'contact_messages'.");
            } finally {
                submitBtn.textContent = "Send Message";
                submitBtn.disabled = false;
            }
        });
    }

    // === FEATURE: DARK MODE TOGGLE ===
    const darkModeBtn = document.getElementById('dark-mode-toggle');
    if (darkModeBtn) {
        const icon = darkModeBtn.querySelector('i');
        
        // Initialize Theme (Targeting documentElement to match CSS html.dark-mode)
        if (localStorage.getItem('theme') === 'dark') {
            document.documentElement.classList.add('dark-mode');
            if (icon) icon.className = 'fas fa-sun';
        }

        // Toggle Event
        darkModeBtn.addEventListener('click', () => {
            document.documentElement.classList.toggle('dark-mode');
            const isDark = document.documentElement.classList.contains('dark-mode');
            
            if (icon) icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        });
    }
});