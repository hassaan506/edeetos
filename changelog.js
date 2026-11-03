document.addEventListener('DOMContentLoaded', () => {
    // Theme checks based on system or local storage
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark-mode');
    }

    // Dynamic hover glow mapping to CSS variables
    const cards = document.querySelectorAll('.bento-card');
    
    cards.forEach(card => {
        card.addEventListener('mousemove', e => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            card.style.setProperty('--mouse-x', `${x}px`);
            card.style.setProperty('--mouse-y', `${y}px`);
        });
    });
});

window.changePage = function(pageNum) {
    // Hide all pages
    document.querySelectorAll('.changelog-page').forEach(page => {
        page.classList.remove('active');
    });
    
    // Reset all buttons
    document.querySelectorAll('.page-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.style.borderBottomWidth = "3px"; // Reset physical press look
    });

    // Show selected page
    const selectedPage = document.getElementById(`page-${pageNum}`);
    if (selectedPage) {
        selectedPage.classList.add('active');
    }
    
    // Highlight the clicked button
    const buttons = document.querySelectorAll('.page-btn');
    if (buttons[pageNum - 1]) {
        buttons[pageNum - 1].classList.add('active');
    }

    // Snap up to top of grid
    const grid = document.querySelector('.header');
    if (grid) {
        window.scrollTo({ top: grid.offsetTop, behavior: 'smooth' });
    }
};

// Keyboard Navigation (Arrow Keys)
document.addEventListener('keydown', (e) => {
    const activeBtn = document.querySelector('.page-btn.active');
    if (!activeBtn) return;
    
    let currentPage = parseInt(activeBtn.innerText);
    const totalPages = document.querySelectorAll('.page-btn').length;

    if (e.key === 'ArrowRight' && currentPage < totalPages) {
        window.changePage(currentPage + 1);
    } else if (e.key === 'ArrowLeft' && currentPage > 1) {
        window.changePage(currentPage - 1);
    }
});