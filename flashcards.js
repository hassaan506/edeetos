import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

let activeDeck = [];
let currentIndex = 0;
let attemptedCards = JSON.parse(localStorage.getItem('edeetos_fc_attempts') || '{}');
let deckCache = {};
let currentSystem = null;

const selectionScreen = document.getElementById('fc-selection-screen');
const trainingScreen = document.getElementById('fc-training-screen');
const deckGrid = document.getElementById('deck-grid');
const flashcardInner = document.getElementById('flashcard-inner');
const evalControls = document.getElementById('fc-eval-controls');
const prevBtn = document.getElementById('btn-prev-card');

const activeCourse = localStorage.getItem('edeetos_active_course');
if (!activeCourse) window.location.href = 'dashboard.html';

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
        prefetchAllDecks();
        buildSystemSelection();
    } else {
        window.location.href = 'login.html';
    }
});

function getCardId(card) {
    if (card.id) return String(card.id);
    if (card.QuestionID) return String(card.QuestionID);
    const str = (card.Stem || "") + (card.Answer || "");
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0; 
    }
    return "fc_" + hash;
}

function markCardAttempted(card) {
    const id = getCardId(card);
    if (!attemptedCards[id]) {
        attemptedCards[id] = true;
        localStorage.setItem('edeetos_fc_attempts', JSON.stringify(attemptedCards));
    }
}

function prefetchAllDecks() {
    medicalSystems.forEach(async (sys) => {
        try {
            const res = await fetch(`Flashcards/${sys.id}.json`, { cache: 'no-cache' });
            if (res.ok) {
                const data = await res.json();
                deckCache[sys.id] = data;
                if (currentSystem === null) {
                    updateSystemCardStat(sys.id);
                }
            }
        } catch (e) {
            console.warn("Could not prefetch " + sys.id);
        }
    });
}

function buildSystemSelection() {
    currentSystem = null;
    document.getElementById('selection-title').textContent = "Select a System";
    document.getElementById('selection-subtitle').textContent = "Choose a system to view its topics.";
    document.getElementById('btn-back-systems').style.display = 'none';
    
    deckGrid.innerHTML = '';
    
    medicalSystems.forEach(system => {
        const cardEl = document.createElement('div');
        cardEl.className = 'deck-card';
        cardEl.id = `sys-card-${system.id.replace(/\s+/g, '-')}`;
        
        let totalQs = 0;
        let attemptedQs = 0;
        if (deckCache[system.id]) {
            totalQs = deckCache[system.id].length;
            attemptedQs = deckCache[system.id].filter(c => attemptedCards[getCardId(c)]).length;
        }
        
        let percent = totalQs > 0 ? Math.round((attemptedQs / totalQs) * 100) : 0;
        
        cardEl.innerHTML = `
            <div style="font-size: 3.5rem; margin-bottom: 15px; text-align: center;">${system.icon}</div>
            <div class="deck-title" style="text-align: center; font-size: 1.5rem;">${system.title}</div>
            <div class="card-header-flex" style="margin-top: 20px;">
                <span style="font-size: 0.85rem; font-weight: bold; color: #64748b;">Progress</span>
                <span class="card-count" id="count-${system.id.replace(/\s+/g, '-')}">${attemptedQs} / ${totalQs}</span>
            </div>
            <div class="progress-container"><div class="progress-bar-fill" id="prog-${system.id.replace(/\s+/g, '-')}" style="width: ${percent}%;"></div></div>
        `;
        
        cardEl.onclick = () => buildTopicSelection(system.id, system.title);
        deckGrid.appendChild(cardEl);
    });
}

function updateSystemCardStat(sysId) {
    if (currentSystem !== null) return; 
    const safeId = sysId.replace(/\s+/g, '-');
    const countEl = document.getElementById(`count-${safeId}`);
    const progEl = document.getElementById(`prog-${safeId}`);
    
    if (countEl && progEl && deckCache[sysId]) {
        const totalQs = deckCache[sysId].length;
        const attemptedQs = deckCache[sysId].filter(c => attemptedCards[getCardId(c)]).length;
        const percent = totalQs > 0 ? Math.round((attemptedQs / totalQs) * 100) : 0;
        
        countEl.textContent = `${attemptedQs} / ${totalQs}`;
        progEl.style.width = `${percent}%`;
    }
}

function buildTopicSelection(systemId, systemTitle) {
    currentSystem = systemId;
    
    if (!deckCache[systemId]) {
        deckGrid.innerHTML = `<div style="text-align: center; width: 100%; color: #a855f7;"><i class="fas fa-spinner fa-spin fa-2x"></i><p style="margin-top: 10px; font-weight: bold;">Downloading Deck...</p></div>`;
        fetch(`Flashcards/${systemId}.json`, { cache: 'no-cache' })
            .then(res => res.json())
            .then(data => {
                deckCache[systemId] = data;
                renderTopics(systemId, systemTitle);
            })
            .catch(e => {
                alert("Failed to load deck.");
                buildSystemSelection();
            });
        return;
    }
    
    renderTopics(systemId, systemTitle);
}

function renderTopics(systemId, systemTitle) {
    document.getElementById('selection-title').textContent = systemTitle;
    document.getElementById('selection-subtitle').textContent = "Select a topic to start memorizing.";
    const backBtn = document.getElementById('btn-back-systems');
    backBtn.style.display = 'inline-flex';
    backBtn.onclick = buildSystemSelection;
    
    deckGrid.innerHTML = '';
    
    const topicsMap = {};
    const fullDeck = deckCache[systemId];
    
    fullDeck.forEach(card => {
        const topic = card.Topic || 'General Overview';
        if (!topicsMap[topic]) topicsMap[topic] = [];
        topicsMap[topic].push(card);
    });
    
    const sortedTopics = Object.keys(topicsMap).sort((a,b) => a.localeCompare(b));
    
    const allCard = document.createElement('div');
    allCard.className = 'deck-card';
    allCard.style.borderColor = '#a855f7';
    allCard.style.background = 'linear-gradient(135deg, #faf5ff, #ffffff)';
    
    const totalQs = fullDeck.length;
    const attemptedQs = fullDeck.filter(c => attemptedCards[getCardId(c)]).length;
    const percent = totalQs > 0 ? Math.round((attemptedQs / totalQs) * 100) : 0;
    
    allCard.innerHTML = `
        <div class="deck-title" style="color: #7e22ce; font-size: 1.2rem;"><i class="fas fa-layer-group"></i> Review Entire System</div>
        <div class="card-header-flex" style="margin-top: 15px;">
            <span style="font-size: 0.85rem; font-weight: bold; color: #64748b;">Progress</span>
            <span class="card-count" style="background: rgba(168, 85, 247, 0.1); color: #7e22ce;">${attemptedQs} / ${totalQs}</span>
        </div>
        <div class="progress-container"><div class="progress-bar-fill" style="width: ${percent}%; background-color: #a855f7;"></div></div>
    `;
    allCard.onclick = () => launchFlashcards(fullDeck, `${systemTitle} (All)`);
    deckGrid.appendChild(allCard);
    
    sortedTopics.forEach(topicName => {
        const topicCards = topicsMap[topicName];
        const tTotal = topicCards.length;
        const tAttempted = topicCards.filter(c => attemptedCards[getCardId(c)]).length;
        const tPercent = tTotal > 0 ? Math.round((tAttempted / tTotal) * 100) : 0;
        
        const cardEl = document.createElement('div');
        cardEl.className = 'deck-card';
        cardEl.innerHTML = `
            <div class="deck-title" style="font-size: 1.1rem; color: #0f172a;">${topicName}</div>
            <div class="card-header-flex" style="margin-top: 15px;">
                <span style="font-size: 0.85rem; font-weight: bold; color: #64748b;">Progress</span>
                <span class="card-count">${tAttempted} / ${tTotal}</span>
            </div>
            <div class="progress-container"><div class="progress-bar-fill" style="width: ${tPercent}%;"></div></div>
        `;
        cardEl.onclick = () => launchFlashcards(topicCards, topicName);
        deckGrid.appendChild(cardEl);
    });
}

function launchFlashcards(cardsArray, title) {
    activeDeck = [...cardsArray];
    
    // Auto-resume logic: Find first unattempted card
    let firstUnattempted = 0;
    for (let i = 0; i < activeDeck.length; i++) {
        if (!attemptedCards[getCardId(activeDeck[i])]) {
            firstUnattempted = i;
            break;
        }
    }
    currentIndex = firstUnattempted;
    
    document.getElementById('fc-selection-screen').style.display = 'none';
    document.getElementById('fc-training-screen').style.display = 'block';
    
    renderCard();
}

function renderCard() {
    const card = activeDeck[currentIndex];
    
    flashcardInner.classList.remove('is-flipped');
    evalControls.style.display = 'none'; 
    
    if (currentIndex > 0) {
        prevBtn.style.display = 'flex';
    } else {
        prevBtn.style.display = 'none';
    }
    
    
    document.getElementById('fc-jump-input').value = currentIndex + 1;
    document.getElementById('fc-progress-total').textContent = ` / ${activeDeck.length}`;
    
    document.getElementById('fc-meta').textContent = `${card.System || 'System'} > ${card.Chapter || 'Chapter'} > ${card.Topic || 'Topic'}`;
    
    const highYieldBadge = document.getElementById('fc-high-yield');
    highYieldBadge.style.display = card.HighYield ? 'inline-block' : 'none';
    
    document.getElementById('fc-stem').innerHTML = card.Stem || "Missing question stem.";
    document.getElementById('fc-answer').innerHTML = card.Answer || "Missing answer.";
    
    const trickContainer = document.getElementById('fc-trick-container');
    if (card.Trick && card.Trick.trim() !== "") {
        document.getElementById('fc-trick').innerHTML = card.Trick;
        trickContainer.style.display = 'block';
    } else {
        trickContainer.style.display = 'none';
    }

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

document.getElementById('flashcard-container').onclick = () => {
    if (!flashcardInner.classList.contains('is-flipped')) {
        flashcardInner.classList.add('is-flipped');
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
        flashcardInner.classList.remove('is-flipped');
        evalControls.style.display = 'none';
        setTimeout(() => {
            currentIndex--;
            renderCard();
        }, 300);
    }
};

document.getElementById('btn-eval-easy').onclick = (e) => {
    e.stopPropagation(); 
    markCardAttempted(activeDeck[currentIndex]);
    moveToNextCard();
};

document.getElementById('btn-eval-hard').onclick = (e) => {
    e.stopPropagation(); 
    markCardAttempted(activeDeck[currentIndex]);
    const currentCard = activeDeck[currentIndex];
    activeDeck.push(currentCard);
    moveToNextCard();
};

function moveToNextCard() {
    if (currentIndex < activeDeck.length - 1) {
        flashcardInner.classList.remove('is-flipped');
        evalControls.style.display = 'none';
        setTimeout(() => {
            currentIndex++;
            renderCard();
        }, 300); 
    } else {
        alert("Deck completed! Outstanding work.");
        document.getElementById('btn-back-decks').click();
    }
}

document.addEventListener('keydown', (e) => {
    if (trainingScreen.style.display === 'block') {
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            if (!flashcardInner.classList.contains('is-flipped')) {
                document.getElementById('flashcard-container').click();
            }
        }
        if (e.key === 'ArrowRight' && flashcardInner.classList.contains('is-flipped')) {
            document.getElementById('btn-eval-easy').click();
        }
        if (e.key === 'ArrowDown' && flashcardInner.classList.contains('is-flipped')) {
            document.getElementById('btn-eval-hard').click();
        }
        if (e.key === 'ArrowLeft') {
            if (currentIndex > 0) prevBtn.click();
        }
    }
});

// --- JUMP TO CARD LOGIC ---
const jumpInput = document.getElementById('fc-jump-input');
const jumpBtn = document.getElementById('btn-jump');

function executeJump() {
    if (!jumpInput) return;
    let val = parseInt(jumpInput.value);
    if (isNaN(val)) val = 1;
    if (val < 1) val = 1;
    if (val > activeDeck.length) val = activeDeck.length;
    
    currentIndex = val - 1;
    
    // Reset flip state if jumping while flipped
    flashcardInner.classList.remove('is-flipped');
    evalControls.style.display = 'none';
    
    setTimeout(() => {
        renderCard();
    }, 150);
}

if (jumpInput) {
    jumpInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            jumpInput.blur();
            executeJump();
        }
    });
}

if (jumpBtn) {
    jumpBtn.addEventListener('click', executeJump);
}