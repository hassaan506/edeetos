// === FEATURE: FIREBASE IMPORTS ===
import { db } from "./firebase-config.js";
import { collection, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
// Assume you are importing getAuth for role checking
// import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// === FEATURE: SECURITY & ACCESS CONTROL ===
// This function strictly disables copying, right-clicking, and printing
function lockDownContent() {
    console.log("Security: Lockdown engaged. User does not have admin/management privileges.");
    
    // 1. Add CSS class to prevent mouse highlighting
    document.body.classList.add("security-locked");

    // 2. Block Right-Click Context Menu
    document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    // 3. Block Keyboard Copying (Ctrl+C, Cmd+C)
    document.addEventListener('copy', (e) => {
        e.preventDefault();
    });

    // 4. Intercept specific keystrokes (PrintScreen)
    document.addEventListener('keydown', (e) => {
        // Block physical PrintScreen key
        if (e.key === 'PrintScreen') {
            navigator.clipboard.writeText(''); // Attempt to clear clipboard
            e.preventDefault();
        }
        
        // Block Ctrl+C or Cmd+C physically
        if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
            e.preventDefault();
        }
    });
}

// Check User Role (You must link this to your actual Firebase Auth/Firestore logic)
function initializeSecurity() {
    // MOCK DATA: Replace this with your actual database role check
    const currentUserRole = "student"; // Could be 'admin', 'management', 'student', etc.
    
    if (currentUserRole !== "admin" && currentUserRole !== "management") {
        lockDownContent();
    } else {
        console.log("Security: Full access granted. Role verified as admin/management.");
    }
}
// Execute security check on load
initializeSecurity();


// === FEATURE: CONTACT FORM SUBMISSION ===
const contactForm = document.getElementById('contact-form');

if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
        e.preventDefault(); //[cite: 3]
        
        const name = document.getElementById('contact-name').value; //[cite: 3]
        const email = document.getElementById('contact-email').value; //[cite: 3]
        const whatsapp = document.getElementById('contact-whatsapp').value; //[cite: 3]
        const msg = document.getElementById('contact-msg').value; //[cite: 3]
        
        const submitBtn = contactForm.querySelector('button[type="submit"]'); //[cite: 3]
        submitBtn.textContent = "Sending..."; //[cite: 3]
        submitBtn.disabled = true; //[cite: 3]
        
        try {
            await addDoc(collection(db, "contact_messages"), { //[cite: 3]
                name: name, //[cite: 3]
                email: email, //[cite: 3]
                whatsapp: whatsapp, //[cite: 3]
                message: msg, //[cite: 3]
                timestamp: new Date().toISOString() //[cite: 3]
            }); //[cite: 3]
            
            alert("Thank you for reaching out! A member of the EDEETOS team will get back to you shortly."); //[cite: 3]
            contactForm.reset(); //[cite: 3]
        } catch (error) {
            console.error("Firebase DB error:", error); //[cite: 3]
            alert("Security Error: Your database rules are blocking incoming messages from public users. Please update your Firebase Rules to allow 'contact_messages'."); //[cite: 3]
        } finally {
            submitBtn.textContent = "Send Message"; //[cite: 3]
            submitBtn.disabled = false; //[cite: 3]
        }
    });
}