import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

let activeDeck = [];
let currentIndex = 0;

const selectionScreen = document.getElementById('fc-selection-screen');
const trainingScreen = document.getElementById('fc-training-screen');
const deckGrid = document.getElementById('deck-grid');
const flashcardInner = document.getElementById('flashcard-inner');
const controlsDiv = document.getElementById('fc-controls');

// Ensure user has an active session
const activeCourse = localStorage.getItem('edeetos_active_course');
if (!activeCourse) window.location.href = 'dashboard.html';

// The 'id' must exactly match your JSON file name (without the .json extension)
const medicalSystems = [
    { id: 'Cardiovascular System', title: 'Cardiovascular', icon: '🫀' },
    { id: 'Respiratory System', title: 'Respiratory', icon: '🫁' },
    { id: 'Gastrointestinal System', title: 'Gastrointestinal', icon: '🍏' },
    { id: 'Neurology System', title: 'Neurology', icon: '🧠' },
    { id: 'Renal System', title: 'Renal & Urology', icon: '💧' },
    { id: 'Endocrine System', title: 'Endocrinology', icon: '⚖️' },
    { id: 'Reproductive System', title: 'Reproductive', icon: '🧬' },
    { id: 'Musculoskeletal System', title: 'Musculoskeletal', icon: '🦴' },
    { id: 'Hematology System', title: 'Hematology', icon: '🩸' },
    { id: 'Psychiatry System', title: 'Psychiatry', icon: '🧩' },
    { id: 'Dermatology System', title: 'Dermatology', icon: '🔍' },
    { id: 'General Surgery', title: 'General Surgery', icon: '🔪' }
];

onAuthStateChanged(auth, async (user) => {
    if (user) {
        buildDeckSelection();
    } else {
        window.location.href = 'login.html';
    }
});

function buildDeckSelection() {
    deckGrid.innerHTML = '';
    
    medicalSystems.forEach(system => {
        const cardEl = document.createElement('div');
        cardEl.className = 'deck-card';
        cardEl.innerHTML = `
            <div style="font-size: 2.5rem; margin-bottom: 10px;">${system.icon}</div>
            <div class="deck-title">${system.title}</div>
            <div class="deck-count" style="font-size: 0.75rem;">Load Deck ➡</div>
        `;
        
        cardEl.onclick = () => fetchAndLaunchDeck(system.id, cardEl);
        deckGrid.appendChild(cardEl);
    });
}

async function fetchAndLaunchDeck(systemId, cardElement) {
    const originalContent = cardElement.innerHTML;
    cardElement.innerHTML = `<div style="text-align: center; color: #a855f7; font-weight: bold; padding: 20px 0;"><i class="fas fa-spinner fa-spin"></i> Downloading...</div>`;
    cardElement.style.pointerEvents = 'none';

    try {
        // Constructs the filename exactly as requested: e.g., Flashcards/Cardiovascular System.json
        const fileName = `Flashcards/${systemId}.json`;
        const res = await fetch(fileName, { cache: 'no-cache' });
        
        if (!res.ok) throw new Error("File not found");
        
        const deckData = await res.json();
        
        if (deckData.length === 0) {
            throw new Error("Deck is empty");
        }

        // Shuffle the deck for active recall
        activeDeck = deckData.sort(() => 0.5 - Math.random());
        currentIndex = 0;
        
        selectionScreen.style.display = 'none';
        trainingScreen.style.display = 'block';
        
        renderCard();

    } catch (e) {
        console.error("Failed to load deck:", e);
        alert(`Could not load ${systemId} deck. Ensure Flashcards/${systemId}.json exists.`);
    } finally {
        cardElement.innerHTML = originalContent;
        cardElement.style.pointerEvents = 'auto';
    }
}

function renderCard() {
    const card = activeDeck[currentIndex];
    
    flashcardInner.classList.remove('is-flipped');
    controlsDiv.style.display = 'none'; // Hide buttons until they flip the card
    
    document.getElementById('fc-progress-text').textContent = `${currentIndex + 1} / ${activeDeck.length}`;
    document.getElementById('fc-meta').textContent = `${card.System || 'System'} > ${card.Chapter || 'Chapter'} > ${card.Topic || 'Topic'}`;
    
    const highYieldBadge = document.getElementById('fc-high-yield');
    highYieldBadge.style.display = card.HighYield ? 'block' : 'none';
    
    document.getElementById('fc-stem').innerHTML = card.Stem || "Missing question stem.";
    document.getElementById('fc-answer').innerHTML = card.Answer || "Missing answer.";
    
    const trickContainer = document.getElementById('fc-trick-container');
    if (card.Trick && card.Trick.trim() !== "") {
        document.getElementById('fc-trick').innerHTML = card.Trick;
        trickContainer.style.display = 'block';
    } else {
        trickContainer.style.display = 'none';
    }

    // Handle Images if they exist in your JSON
    const imgFront = document.getElementById('fc-image-front');
    const imgBack = document.getElementById('fc-image-back');
    
    if (card.Image && card.Image.trim() !== "") {
        imgFront.style.display = 'block';
        imgFront.querySelector('img').src = card.Image;
        imgBack.style.display = 'none';
    } else {
        imgFront.style.display = 'none';
        imgBack.style.display = 'none';
    }
}

// Interaction Listeners
document.getElementById('flashcard-container').onclick = () => {
    if (!flashcardInner.classList.contains('is-flipped')) {
        flashcardInner.classList.add('is-flipped');
        controlsDiv.style.display = 'flex'; // Reveal the eval buttons
    }
};

document.getElementById('btn-back-decks').onclick = () => {
    trainingScreen.style.display = 'none';
    selectionScreen.style.display = 'block';
};

// Traversal Buttons
document.querySelectorAll('.fc-eval-btn').forEach(btn => {
    btn.onclick = (e) => {
        e.stopPropagation(); // Prevent card from un-flipping when button is clicked
        
        if (currentIndex < activeDeck.length - 1) {
            flashcardInner.classList.remove('is-flipped');
            controlsDiv.style.display = 'none';
            setTimeout(() => {
                currentIndex++;
                renderCard();
            }, 300); // Wait for unflip animation
        } else {
            alert("Deck completed! Returning to menu.");
            document.getElementById('btn-back-decks').click();
        }
    };
});

// Keyboard Navigation
document.addEventListener('keydown', (e) => {
    if (trainingScreen.style.display === 'block') {
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            if (!flashcardInner.classList.contains('is-flipped')) {
                document.getElementById('flashcard-container').click();
            }
        }
        if (e.key === 'ArrowRight' && flashcardInner.classList.contains('is-flipped')) {
            document.querySelector('.fc-eval-btn[data-eval="easy"]').click();
        }
        if (e.key === 'ArrowLeft' && flashcardInner.classList.contains('is-flipped')) {
            document.querySelector('.fc-eval-btn[data-eval="hard"]').click();
        }
    }
});