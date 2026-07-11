document.addEventListener('DOMContentLoaded', () => {
    
    // Simple Intersection Observer to fade in changelog items as you scroll
    const timelineItems = document.querySelectorAll('.timeline-content');

    // Initial setup: hide them slightly
    timelineItems.forEach(item => {
        item.style.opacity = '0';
        item.style.transform = 'translateY(20px)';
        item.style.transition = 'all 0.5s ease-out';
    });

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.1 // Triggers when 10% of the card is visible
    });

    timelineItems.forEach(item => {
        observer.observe(item);
    });

});

// --- PAGINATION LOGIC ---
// Attached to the window object so it can be called directly from the HTML onClick events
window.changePage = function(pageNum) {
    // Hide all pages
    document.querySelectorAll('.changelog-page').forEach(page => {
        page.classList.remove('active');
    });
    
    // Remove active class from all buttons
    document.querySelectorAll('.page-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Show selected page and highlight the correct button
    const selectedPage = document.getElementById(`page-${pageNum}`);
    if (selectedPage) {
        selectedPage.classList.add('active');
    }
    
    const buttons = document.querySelectorAll('.page-btn');
    if (buttons[pageNum - 1]) {
        buttons[pageNum - 1].classList.add('active');
    }

    // Scroll smoothly to the top of the timeline section
    const timeline = document.querySelector('.timeline');
    if (timeline) {
        window.scrollTo({ top: timeline.offsetTop - 50, behavior: 'smooth' });
    }
};