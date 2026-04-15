import { db } from "./firebase-config.js";
import { collection, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const contactForm = document.getElementById('contact-form');

if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const name = document.getElementById('contact-name').value;
        const email = document.getElementById('contact-email').value;
        const msg = document.getElementById('contact-msg').value;
        
        try {
            await addDoc(collection(db, "contact_messages"), {
                name: name,
                email: email,
                message: msg,
                timestamp: new Date().toISOString()
            });
            
            alert("Thank you for reaching out! A member of the EDEETOS team will get back to you shortly.");
            contactForm.reset();
        } catch (error) {
            console.error(error);
            alert("Error sending message. Please try emailing us directly!");
        }
    });
}
