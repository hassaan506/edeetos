document.addEventListener('DOMContentLoaded', () => {
    // 1. Intersection Observer for Scroll Animations
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.15 // Triggers when 15% of the element is visible on screen
    };

    const scrollObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                // Add the class that triggers the CSS animation
                entry.target.classList.add('is-visible');
                
                // Optional: Uncomment the next line if you only want the animation to happen ONCE
                // observer.unobserve(entry.target); 
            }
        });
    }, observerOptions);

    // Apply observer to all elements with the animation class
    const animatedElements = document.querySelectorAll('.animate-on-scroll');
    animatedElements.forEach(el => scrollObserver.observe(el));

    // 2. Dark Mode Initialization Check
    // Ensures the changelog matches the theme selected on the main dashboard
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark-mode');
    }
});

// --- PAGINATION LOGIC ---
// Attached to window so the HTML onclick="window.changePage(x)" works
window.changePage = function(pageNum) {
    // Hide all pages
    document.querySelectorAll('.changelog-page').forEach(page => {
        page.classList.remove('active');
    });
    
    // Remove active class from all buttons
    document.querySelectorAll('.page-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Show selected page
    const selectedPage = document.getElementById(`page-${pageNum}`);
    if (selectedPage) {
        selectedPage.classList.add('active');
        
        // Re-trigger animations for elements on the new page
        const newElements = selectedPage.querySelectorAll('.animate-on-scroll');
        newElements.forEach(el => {
            el.classList.remove('is-visible');
            // A slight delay ensures the CSS transition resets before re-applying
            setTimeout(() => el.classList.add('is-visible'), 50);
        });
    }
    
    // Highlight the correct button
    const buttons = document.querySelectorAll('.page-btn');
    if (buttons[pageNum - 1]) {
        buttons[pageNum - 1].classList.add('active');
    }

    // Smooth scroll to the top of the timeline section
    const timeline = document.querySelector('.timeline-container');
    if (timeline) {
        window.scrollTo({ top: timeline.offsetTop - 100, behavior: 'smooth' });
    }
};