import { db } from "./firebase-config.js";
import { collection, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const contactForm = document.getElementById('contact-form');

if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const name = document.getElementById('contact-name').value;
        const email = document.getElementById('contact-email').value;
        // 👇 We are grabbing the new WhatsApp field here!
        const whatsapp = document.getElementById('contact-whatsapp').value;
        const msg = document.getElementById('contact-msg').value;
        
        const submitBtn = contactForm.querySelector('button[type="submit"]');
        submitBtn.textContent = "Sending...";
        submitBtn.disabled = true;
        
        try {
            await addDoc(collection(db, "contact_messages"), {
                name: name,
                email: email,
                whatsapp: whatsapp, // 👇 And saving it to the database here!
                message: msg,
                timestamp: new Date().toISOString()
            });
            
            alert("Thank you for reaching out! A member of the EDEETOS team will get back to you shortly.");
            contactForm.reset();
        } catch (error) {
            console.error("Firebase DB error:", error);
            
            // Fallback: If Firebase blocks the message, format it for WhatsApp and open it directly!
            const waText = `*New EDEETOS Inquiry*\n\n*Name:* ${name}\n*Email:* ${email}\n*WhatsApp:* ${whatsapp}\n*Message:* ${msg}`;
            const whatsappUrl = `https://wa.me/923202289180?text=${encodeURIComponent(waText)}`;
            
            alert("Database connection blocked. We are seamlessly redirecting you to WhatsApp so you can send this directly to our team!");
            window.open(whatsappUrl, '_blank');
            
        } finally {
            submitBtn.textContent = "Send Message";
            submitBtn.disabled = false;
        }
    });
}