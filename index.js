// === FEATURE: FIREBASE DATABASE IMPORTS ===
import { db } from "./firebase-config.js";
import { collection, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// === FEATURE: SECURITY & ACCESS CONTROL ===
function lockDownContent() {
    console.log("Security: Lockdown engaged. User does not have admin/management privileges.");
    
    // Add CSS class to prevent mouse text highlighting
    document.body.classList.add("security-locked");

    // Block Right-Click Context Menu
    document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    // Block Keyboard Copying (Ctrl+C, Cmd+C)
    document.addEventListener('copy', (e) => {
        e.preventDefault();
    });

    // Intercept specific keystrokes (PrintScreen, Ctrl+C)
    document.addEventListener('keydown', (e) => {
        if (e.key === 'PrintScreen') {
            navigator.clipboard.writeText(''); 
            e.preventDefault();
        }
        
        if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
            e.preventDefault();
        }
    });
}

function initializeSecurity() {
    // Replace this string with your actual Firebase Auth user role check
    const currentUserRole = "student"; 
    
    if (currentUserRole !== "admin" && currentUserRole !== "management") {
        lockDownContent();
    } else {
        console.log("Security: Full access granted. Role verified as admin/management.");
    }
}

initializeSecurity();


// === FEATURE: CONTACT FORM SUBMISSION ===
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