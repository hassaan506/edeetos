import { auth } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ==========================================
// THEME TOGGLE LOGIC
// ==========================================
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
document.addEventListener('DOMContentLoaded', attachDarkMode);

let activeDeck = [];
let currentIndex = 0;
let attemptedCards = JSON.parse(localStorage.getItem('edeetos_fc_attempts') || '{}');
let deckCache = {};
let currentSystem = null;

const selectionScreen = document.getElementById('selection-screen');
const trainingScreen = document.getElementById('training-screen');
const deckGrid = document.getElementById('deck-grid');
const flashcardInner = document.getElementById('flashcard-inner');
const evalControls = document.getElementById('fc-eval-controls');
const prevBtn = document.getElementById('btn-prev-card');
const backBtn = document.getElementById('btn-back');

const medicalSystems = [
    { id: 'Cardiovascular System', title: 'Cardiovascular' },
    { id: 'Respiratory System', title: 'Respiratory' },
    { id: 'Gastrointestinal System', title: 'Gastrointestinal' },
    { id: 'Neurology System', title: 'Neurology' },
    { id: 'Renal System', title: 'Renal & Urology' },
    { id: 'Endocrine System', title: 'Endocrinology' },
    { id: 'Reproductive System', title: 'Reproductive' },
    { id: 'Musculoskeletal System', title: 'Musculoskeletal' },
    { id: 'Hematology System', title: 'Hematology' },
    { id: 'Psychiatry System', title: 'Psychiatry' },
    { id: 'Dermatology System', title: 'Dermatology' },
    { id: 'General Surgery', title: 'General Surgery' }
];

document.getElementById('deck-grid').onmousemove = e => {
    for(const card of document.getElementsByClassName("bento-card")) {
        const rect = card.getBoundingClientRect(),
              x = e.clientX - rect.left,
              y = e.clientY - rect.top;
        card.style.setProperty("--mouse-x", `${x}px`);
        card.style.setProperty("--mouse-y", `${y}px`);
    }
};

async function prefetchAllDecks() {
    const promises = medicalSystems.map(async sys => {
        try {
            const res = await fetch(`Flashcards/${sys.id}.json`);
            if (res.ok) deckCache[sys.id] = await res.json();
        } catch(e) {}
    });
    await Promise.all(promises);
    buildSystemSelection(); // Re-render with actual data populated
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        buildSystemSelection(); // Renders placeholder "Loading" states first
        await prefetchAllDecks(); // Fetches all decks in background and re-renders true progress
    } else {
        window.location.href = 'login.html';
    }
});

function getCardId(card) {
    if (card.id) return String(card.id);
    if (card.QuestionID) return String(card.QuestionID);
    const str = (card.Stem || "") + (card.Answer || "");
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = Math.imul(31, hash) + str.charCodeAt(i) | 0;
    return "fc_" + hash;
}

function markCardAttempted(card) {
    const id = getCardId(card);
    if (!attemptedCards[id]) {
        attemptedCards[id] = true;
        localStorage.setItem('edeetos_fc_attempts', JSON.stringify(attemptedCards));
    }
}

function buildSystemSelection() {
    currentSystem = null;
    document.getElementById('selection-title').textContent = "Select a System";
    document.getElementById('selection-subtitle').textContent = "Choose a medical system to begin reviewing.";
    backBtn.style.display = 'none';
    
    deckGrid.innerHTML = '';
    
    medicalSystems.forEach(system => {
        const isLoaded = !!deckCache[system.id];
        let totalQs = isLoaded ? deckCache[system.id].length : '--';
        let attemptedQs = isLoaded ? deckCache[system.id].filter(c => attemptedCards[getCardId(c)]).length : '--';
        let percent = isLoaded && totalQs > 0 ? Math.round((attemptedQs / totalQs) * 100) : 0;
        
        const cardEl = document.createElement('div');
        cardEl.className = 'bento-card';
        cardEl.onclick = () => buildTopicSelection(system.id, system.title);
        cardEl.innerHTML = `
            <div class="bento-content">
                <div class="card-header">
                    <h3 class="card-title">${system.title}</h3>
                    <span class="meta-text">${isLoaded ? `${attemptedQs} / ${totalQs}` : 'Loading...'}</span>
                </div>
                <div class="progress-track">
                    <div class="progress-fill" style="width: ${percent}%; ${!isLoaded ? 'background: transparent;' : ''}"></div>
                </div>
            </div>
        `;
        deckGrid.appendChild(cardEl);
    });
}

function buildTopicSelection(systemId, systemTitle) {
    currentSystem = systemId;
    
    if (!deckCache[systemId]) {
        deckGrid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); font-family: var(--font-mono);">Downloading data for ${systemTitle}...</div>`;
        fetch(`Flashcards/${systemId}.json`)
            .then(res => {
                if (!res.ok) throw new Error("Network response was not ok");
                return res.json();
            })
            .then(data => {
                deckCache[systemId] = data;
                renderTopics(systemId, systemTitle);
            })
            .catch(e => {
                console.error(e);
                alert(`Could not load data for ${systemTitle}. Please check your files.`);
                buildSystemSelection();
            });
        return;
    }
    
    renderTopics(systemId, systemTitle);
}

function renderTopics(systemId, systemTitle) {
    document.getElementById('selection-title').textContent = systemTitle;
    document.getElementById('selection-subtitle').textContent = "Select a specific topic.";
    backBtn.style.display = 'inline-flex';
    backBtn.onclick = buildSystemSelection;
    
    deckGrid.innerHTML = '';
    const topicsMap = {};
    const fullDeck = deckCache[systemId];
    
    fullDeck.forEach(card => {
        const category = card.Chapter || card.Topic || 'Full Deck';
        if (!topicsMap[category]) topicsMap[category] = [];
        topicsMap[category].push(card);
    });
    
    Object.keys(topicsMap).sort().forEach(categoryName => {
        const topicCards = topicsMap[categoryName];
        const tTotal = topicCards.length;
        const tAttempted = topicCards.filter(c => attemptedCards[getCardId(c)]).length;
        const tPercent = tTotal > 0 ? Math.round((tAttempted / tTotal) * 100) : 0;
        
        const cardEl = document.createElement('div');
        cardEl.className = 'bento-card';
        cardEl.onclick = () => launchFlashcards(topicCards);
        cardEl.innerHTML = `
            <div class="bento-content">
                <div class="card-header">
                    <h3 class="card-title" style="font-size: 1.1rem;">${categoryName}</h3>
                    <span class="meta-text">${tAttempted} / ${tTotal}</span>
                </div>
                <div class="progress-track">
                    <div class="progress-fill" style="width: ${tPercent}%;"></div>
                </div>
            </div>
        `;
        deckGrid.appendChild(cardEl);
    });
}

function launchFlashcards(cardsArray) {
    activeDeck = [...cardsArray];
    
    let firstUnattempted = activeDeck.findIndex(c => !attemptedCards[getCardId(c)]);
    currentIndex = firstUnattempted !== -1 ? firstUnattempted : 0;
    
    selectionScreen.style.display = 'none';
    trainingScreen.style.display = 'block';
    renderCard();
}

function renderCard() {
    const card = activeDeck[currentIndex];
    flashcardInner.classList.remove('flipped');
    evalControls.style.display = 'none'; 
    prevBtn.style.display = currentIndex > 0 ? 'inline-flex' : 'none';
    
    document.getElementById('fc-jump-input').value = currentIndex + 1;
    document.getElementById('fc-progress-total').textContent = `of ${activeDeck.length}`;
    
    const activeCategory = card.Chapter || card.Topic || 'General';
    document.getElementById('fc-meta').textContent = `${card.System || 'System'} > ${activeCategory}`;
    
    document.getElementById('fc-stem').innerHTML = card.Stem || "No question provided.";
    document.getElementById('fc-answer').innerHTML = card.Answer || "No answer provided.";
    
    const trickContainer = document.getElementById('fc-trick-container');
    if (card.Trick && card.Trick.trim() !== "") {
        document.getElementById('fc-trick').innerHTML = `<strong>Trick:</strong> ${card.Trick}`;
        trickContainer.style.display = 'block';
    } else {
        trickContainer.style.display = 'none';
    }

    const imgFront = document.getElementById('fc-image-front');
    if (card.Image && card.Image.trim() !== "") {
        imgFront.style.display = 'block';
        imgFront.querySelector('img').src = card.Image;
    } else {
        imgFront.style.display = 'none';
    }
}

document.getElementById('flashcard-container').onclick = () => {
    if (!flashcardInner.classList.contains('flipped')) {
        flashcardInner.classList.add('flipped');
        evalControls.style.display = 'flex';
    }
};

document.getElementById('btn-back-decks').onclick = () => {
    trainingScreen.style.display = 'none';
    selectionScreen.style.display = 'block';
    if (currentSystem) {
        renderTopics(currentSystem, document.getElementById('selection-title').textContent);
    } else {
        buildSystemSelection();
    }
};

prevBtn.onclick = (e) => {
    e.stopPropagation();
    if (currentIndex > 0) {
        flashcardInner.classList.remove('flipped');
        evalControls.style.display = 'none';
        setTimeout(() => { currentIndex--; renderCard(); }, 300);
    }
};

document.getElementById('btn-eval-easy').onclick = (e) => {
    e.stopPropagation(); 
    markCardAttempted(activeDeck[currentIndex]);
    moveToNextCard();
};

document.getElementById('btn-eval-hard').onclick = (e) => {
    e.stopPropagation(); 
    activeDeck.push(activeDeck[currentIndex]);
    moveToNextCard();
};

function moveToNextCard() {
    if (currentIndex < activeDeck.length - 1) {
        flashcardInner.classList.remove('flipped');
        evalControls.style.display = 'none';
        setTimeout(() => { currentIndex++; renderCard(); }, 300); 
    } else {
        alert("You have completed this section.");
        document.getElementById('btn-back-decks').click();
    }
}

document.addEventListener('keydown', (e) => {
    if (trainingScreen.style.display === 'block') {
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            if (!flashcardInner.classList.contains('flipped')) {
                document.getElementById('flashcard-container').click();
            }
        }
        if (e.key === 'ArrowRight' && flashcardInner.classList.contains('flipped')) {
            document.getElementById('btn-eval-easy').click();
        }
        if (e.key === 'ArrowDown' && flashcardInner.classList.contains('flipped')) {
            document.getElementById('btn-eval-hard').click();
        }
        if (e.key === 'ArrowLeft' && currentIndex > 0) {
            prevBtn.click();
        }
    }
});

const jumpInput = document.getElementById('fc-jump-input');
function executeJump() {
    let val = parseInt(jumpInput.value);
    if (isNaN(val) || val < 1) val = 1;
    if (val > activeDeck.length) val = activeDeck.length;
    currentIndex = val - 1;
    flashcardInner.classList.remove('flipped');
    evalControls.style.display = 'none';
    setTimeout(renderCard, 150);
}

jumpInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { 
        e.preventDefault(); 
        jumpInput.blur(); 
        executeJump(); 
    }
});
document.getElementById('btn-jump').addEventListener('click', executeJump);