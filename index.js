import { db } from "./firebase-config.js";
import { collection, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const contactForm = document.getElementById('contact-form');

if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const name = document.getElementById('contact-name').value;
        const email = document.getElementById('contact-email').value;
        const whatsapp = document.getElementById('contact-whatsapp').value;
        const msg = document.getElementById('contact-msg').value;
        
        const submitBtn = contactForm.querySelector('button[type="submit"]');
        submitBtn.textContent = "Sending...";
        submitBtn.disabled = true;
        
        try {
            await addDoc(collection(db, "contact_messages"), {
                name: name,
                email: email,
                whatsapp: whatsapp,
                message: msg,
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
document.addEventListener('DOMContentLoaded', () => {
    const darkModeBtn = document.getElementById('dark-mode-toggle');
    if (!darkModeBtn) return;

    const icon = darkModeBtn.querySelector('i');
    
    // Check saved preference on load
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark-mode');
        if (icon) {
            icon.classList.remove('fa-moon');
            icon.classList.add('fa-sun');
        }
    }

    // Toggle logic
    darkModeBtn.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');
        
        if (isDark) {
            if (icon) {
                icon.classList.remove('fa-moon');
                icon.classList.add('fa-sun');
            }
            localStorage.setItem('theme', 'dark');
        } else {
            if (icon) {
                icon.classList.remove('fa-sun');
                icon.classList.add('fa-moon');
            }
            localStorage.setItem('theme', 'light');
        }
    });
});