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
            alert("Security Error: Your database rules are blocking incoming messages from public users. Please update your Firebase Rules to allow 'contact_messages'.");
        } finally {
            submitBtn.textContent = "Send Message";
            submitBtn.disabled = false;
        }
    });
}
// Variable to store the install event
let deferredPrompt;
const installBtn = document.getElementById('install-app-btn');

// Listen for the browser determining the app is installable
window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent Chrome 67 and earlier from automatically showing the prompt
    e.preventDefault();
    
    // Stash the event so it can be triggered later
    deferredPrompt = e;
    
    // Unhide your custom Install button
    if (installBtn) {
        installBtn.style.display = 'inline-block';
    }
});

// Add click event to your button
if (installBtn) {
    installBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
            // Show the browser's official install prompt
            deferredPrompt.prompt();
            
            // Wait for the user to respond to the prompt
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                console.log('User accepted the install prompt');
            } else {
                console.log('User dismissed the install prompt');
            }
            
            // We've used the prompt, and can't use it again, discard it
            deferredPrompt = null;
            
            // Hide the button since they either installed it or declined
            installBtn.style.display = 'none';
        } else {
            alert("The app cannot be automatically installed on this device right now. You can manually install it by opening your browser's menu and selecting 'Add to Home Screen' or 'Install App'.");
        }
    });
}

// Optional: Listen to see if the app was successfully installed
window.addEventListener('appinstalled', () => {
    // Hide the button just in case
    if (installBtn) installBtn.style.display = 'none';
    console.log('EDEETOS App was successfully installed!');
});

// --- iOS PWA Install Logic ---

// 1. Detect if the device is iOS
const isIos = () => {
    const userAgent = window.navigator.userAgent.toLowerCase();
    return /iphone|ipad|ipod/.test(userAgent);
};

// 2. Detect if the app is already installed (Safari uses the 'standalone' property)
const isStandalone = () => {
    return ('standalone' in window.navigator) && window.navigator.standalone;
};

// 3. Detect if the user is actually using Safari 
// (Chrome on iOS cannot install PWAs to the home screen)
const isSafari = () => {
    const userAgent = window.navigator.userAgent.toLowerCase();
    return /safari/.test(userAgent) && !/chrome|crios|fxios/.test(userAgent);
};

// Show the banner if they are on iOS Safari and haven't installed it yet
const iosBanner = document.getElementById('ios-install-banner');
const closeIosBannerBtn = document.getElementById('close-ios-banner');

if (iosBanner && closeIosBannerBtn) {
    if (isIos() && isSafari() && !isStandalone()) {
        // Wait a few seconds before showing it so it isn't too aggressive
        setTimeout(() => {
            iosBanner.style.display = 'block';
        }, 3000); 
    }

    // Allow the user to dismiss the banner
    closeIosBannerBtn.addEventListener('click', () => {
        iosBanner.style.display = 'none';
    });
}