import { db } from "./firebase-config.js";
import { collection, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    // === FEATURE: CONTACT FORM SUBMISSION ===
    const contactForm = document.getElementById('contact-form');
    if (contactForm) {
        contactForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const submitBtn = contactForm.querySelector('button[type="submit"]');
            submitBtn.textContent = "Sending...";
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
        
        // Initialize Theme
        if (localStorage.getItem('theme') === 'dark') {
            document.body.classList.add('dark-mode');
            if (icon) icon.className = 'fas fa-sun';
        }

        // Toggle Event
        darkModeBtn.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            const isDark = document.body.classList.contains('dark-mode');
            
            if (icon) icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        });
    }
});