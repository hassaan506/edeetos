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