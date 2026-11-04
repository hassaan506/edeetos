document.addEventListener('DOMContentLoaded', () => {
    
    // === 1. DARK MODE LOGIC ===
    const darkModeBtn = document.getElementById('dark-mode-toggle');
    
    const attachDarkMode = () => {
        if (darkModeBtn) {
            const icon = darkModeBtn.querySelector('i');
            
            // Set initial icon based on root element state
            if (document.documentElement.classList.contains('dark-mode')) {
                if (icon) icon.className = 'fas fa-sun';
            }

            darkModeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                document.documentElement.classList.toggle('dark-mode');
                const isDark = document.documentElement.classList.contains('dark-mode');
                if (icon) icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
                localStorage.setItem('theme', isDark ? 'dark' : 'light');
            });
        }
    };
    attachDarkMode();

    // === 2. SCROLL REVEAL ANIMATIONS ===
    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                obs.unobserve(entry.target); 
            }
        });
    }, { threshold: 0.1 });
    
    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

    // === 3. RADIAL GLOW MOUSE TRACKING ===
    // Syncs with the Enterprise Clinical SaaS V6 Bento Grid CSS
    document.addEventListener('mousemove', (e) => {
        document.querySelectorAll('.feature-card').forEach(card => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            card.style.setProperty('--mouse-x', `${x}px`);
            card.style.setProperty('--mouse-y', `${y}px`);
        });
    });
});