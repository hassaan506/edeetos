import { db } from "./firebase-config.js";
import { collection, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

document.addEventListener('DOMContentLoaded', () => {
    
    // === 1. SCROLL REVEALS ===
    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                obs.unobserve(entry.target); 
            }
        });
    }, { threshold: 0.1 });
    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

    // === 2. VERCEL-STYLE CARD GLOW TRACKING ===
    const featuresSection = document.getElementById("features");
    if (featuresSection) {
        featuresSection.onmousemove = e => {
            for (const card of document.querySelectorAll(".bento-card")) {
                const rect = card.getBoundingClientRect(),
                      x = e.clientX - rect.left,
                      y = e.clientY - rect.top;
                card.style.setProperty("--mouse-x", `${x}px`);
                card.style.setProperty("--mouse-y", `${y}px`);
            }
        };
    }

    // === 3. NUMBER COUNTER ANIMATION ===
    const counters = document.querySelectorAll('.count-up');
    const speed = 100; 

    counters.forEach(counter => {
        const updateCount = () => {
            const target = +counter.getAttribute('data-target');
            const count = +counter.innerText.replace(/,/g, '');
            const inc = target / speed;

            if (count < target) {
                counter.innerText = Math.ceil(count + inc).toLocaleString();
                setTimeout(updateCount, 15);
            } else {
                counter.innerText = target.toLocaleString();
            }
        };
        setTimeout(updateCount, 500); 
    });

    // === 4. FIREBASE AUTHENTICATION ===
    const auth = getAuth();
    onAuthStateChanged(auth, (user) => {
        if (user) {
            const authMenu = document.querySelector('.nav-actions div');
            if (authMenu) {
                authMenu.innerHTML = `
                    <button id="dark-mode-toggle" class="btn-outline" style="padding: 0.6rem; border-radius: 6px;"><i class="fas fa-moon"></i></button>
                    <a href="dashboard.html" class="btn-solid">Dashboard</a>
                    <button id="logout-btn" class="btn-outline">Log Out</button>
                `;
                document.getElementById('logout-btn').addEventListener('click', () => {
                    signOut(auth).then(() => window.location.reload());
                });
                attachDarkMode(); 
            }
        }
    });

    // === 5. SECURE CONTACT FORM ===
    const contactForm = document.getElementById('contact-form');
    if (contactForm) {
        contactForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = contactForm.querySelector('button[type="submit"]');
            submitBtn.textContent = 'Sending...';
            submitBtn.disabled = true;
            
            try {
                await addDoc(collection(db, "contact_messages"), {
                    name: document.getElementById('contact-name').value,
                    email: document.getElementById('contact-email').value,
                    whatsapp: document.getElementById('contact-whatsapp').value || "None",
                    message: document.getElementById('contact-msg').value,
                    timestamp: new Date().toISOString()
                });
                alert("Message sent successfully!");
                contactForm.reset();
            } catch (error) {
                console.error("Error:", error);
                alert("Security Error: Database rules blocked the message.");
            } finally {
                submitBtn.textContent = "Send Message";
                submitBtn.disabled = false;
            }
        });
    }

    // === 6. THEME TOGGLE ===
    function attachDarkMode() {
        const darkModeBtn = document.getElementById('dark-mode-toggle');
        if (darkModeBtn) {
            const icon = darkModeBtn.querySelector('i');
            
            if (localStorage.getItem('theme') === 'dark') {
                document.documentElement.classList.add('dark-mode');
                if (icon) icon.className = 'fas fa-sun';
            }

            darkModeBtn.addEventListener('click', () => {
                document.documentElement.classList.toggle('dark-mode');
                const isDark = document.documentElement.classList.contains('dark-mode');
                if (icon) icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
                localStorage.setItem('theme', isDark ? 'dark' : 'light');
            });
        }
    }
    attachDarkMode();
});