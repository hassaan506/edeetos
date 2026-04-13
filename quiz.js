import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, getDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ==========================================
// 1. STATE VARIABLES & CONFIG LOAD
// ==========================================
let quizQueue = [];
let currentIndex = 0;
let currentQuestionData = null;
let wrongAttempts = 0;
let hasAnsweredCorrectly = false;
let sessionSeconds = 0;
let timerInterval;

const configStr = localStorage.getItem('edeetos_quiz_config');
const quizConfig = configStr ? JSON.parse(configStr) : { mode: 'practice', timer: 0 };
const isExamMode = quizConfig.mode === 'exam';

const cardEl = document.querySelector('.question-card'); 
const timerDisplay = document.getElementById('timer-display');
const questionTextEl = document.getElementById('question-text');
const optionsContainer = document.getElementById('options-container');
const wrongCountEl = document.getElementById('wrong-count');
const rightCountEl = document.getElementById('right-count');
const feedbackFill = document.getElementById('feedback-fill');
const explanationBtn = document.getElementById('show-explanation-btn');
const explanationModal = document.getElementById('explanation-modal');
const explanationText = document.getElementById('explanation-text');
const closeExplanationBtn = document.getElementById('close-explanation');
const questionIdBadge = document.getElementById('question-id-badge');
const numberGrid = document.getElementById('number-grid');
const skipBtn = document.getElementById('skip-btn');
const skippedWarningEl = document.getElementById('skipped-warning');
const notesModal = document.getElementById('notes-modal');
const noteInput = document.getElementById('note-input');
const closeNotesBtn = document.getElementById('close-notes-btn');
const saveNoteBtn = document.getElementById('save-note-btn');

explanationModal.classList.remove('hidden');

if (isExamMode) {
    document.body.classList.add('mode-exam');
    sessionSeconds = quizConfig.timer * 60; 
}

function loadSession() {
    const storedData = localStorage.getItem('edeetos_active_quiz');
    if (!storedData) {
        window.location.href = 'questions.html';
        return;
    }
    quizQueue = JSON.parse(storedData);
    if (quizQueue.length === 0) {
        window.location.href = 'questions.html';
        return;
    }
    quizQueue.forEach((q, i) => {     
        if (!q.originalNumber) {
            const idFromCSV = q['QuestionID'] || q['Question ID'] || q['ID'] || q['id'];
            q.originalNumber = idFromCSV || `q-${i + 1}`; 
        }
    });
	
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            console.log("👤 User verified! Fetching saved notes and bookmarks...");
            const userRef = doc(db, "users", user.uid);
            
            try {
                const docSnap = await getDoc(userRef);
                
                if (docSnap.exists()) {
                    const dbData = docSnap.data();
                    const savedNotes = dbData.notes || {}; 
                    const savedBookmarks = dbData.bookmarks || []; 
                    
                    Object.keys(dbData).forEach(key => {
                        if (key.startsWith('notes.')) {
                            const recoveredId = key.substring(6); // Removes the "notes." part
                            savedNotes[recoveredId] = dbData[key];
                        }
                    });

                    quizQueue.forEach(q => {
                        q.isBookmarked = savedBookmarks.includes(q.originalNumber);
                        q.userNote = savedNotes[q.originalNumber] || "";
                        q.isSolvedInDatabase = false; // Forces Practice Mode not to auto-solve!
                    });
                    console.log("✅ Data successfully merged with questions!");
                }
            } catch (error) {
                console.error("❌ Firebase Load Error:", error);
            }
        } else {
            console.warn("⚠️ No user logged in. Starting quiz without saved data.");
        }
       
        startTimer();
        if (!isExamMode) buildNumberGrid(); 
        loadQuestion(0);
    });
}

function formatCSVQuestion(rawCsvRow) {
    const correctLetter = (rawCsvRow['CorrectAnswer'] || '').toString().trim().toUpperCase();
    const options = [];
    
    ['A', 'B', 'C', 'D', 'E'].forEach(letter => {
        const optKey = `Option${letter}`;
        const optText = rawCsvRow[optKey]; 
        if (optText && optText.trim() !== '') {
            options.push({ text: optText, isCorrect: correctLetter === letter, letter: letter });
        }
    });

    return {
        text: rawCsvRow.Question || "Missing Question Text",
        options: options,
        explanation: rawCsvRow.Explanation || "No explanation provided.",
        
        // Ensure ID is perfectly carried over
        originalNumber: rawCsvRow['QuestionID'] || rawCsvRow['Question ID'] || rawCsvRow['ID'] || rawCsvRow['id'] || rawCsvRow.originalNumber,
        
        isBookmarked: rawCsvRow.isBookmarked || false,
        userNote: rawCsvRow.userNote || "",
        isSolvedInDatabase: false, // Ensures it doesn't auto-solve!
        
        hasBeenSkipped: rawCsvRow.hasBeenSkipped || false,
        userSelectedAnswer: rawCsvRow.userSelectedAnswer || null
    };	
} // <-- This crucial closing bracket was missing!

function buildNumberGrid() {
    numberGrid.innerHTML = '';
    quizQueue.forEach((q, index) => {
        const numBtn = document.createElement('div');
        numBtn.className = 'grid-num';
        numBtn.id = `grid-num-${index}`;
        numBtn.textContent = index + 1;
        
        if (q.isSolvedInDatabase) numBtn.classList.add('solved');

        numBtn.onclick = () => {
            if (isExamMode) return; 
            if(index === currentIndex) return;
            const direction = index > currentIndex ? 'right' : 'left';
            triggerSlideTransition(index, direction);
        };
        numberGrid.appendChild(numBtn);
    });
}

function updateGridStyles() {
    if (isExamMode) return;
    document.querySelectorAll('.grid-num').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`grid-num-${currentIndex}`);
    if (activeBtn) activeBtn.classList.add('active');
}

// ==========================================
// 2. SLIDE TRANSITIONS & RENDER
// ==========================================
function triggerSlideTransition(newIndex, direction) {
    const outClass = direction === 'right' ? 'slide-out-left' : 'slide-out-right';
    const inClass = direction === 'right' ? 'slide-in-right' : 'slide-in-left';

    cardEl.className = 'question-card';
    void cardEl.offsetWidth; 
    cardEl.classList.add(outClass);
    
    setTimeout(() => {
        loadQuestion(newIndex);
        cardEl.className = 'question-card'; 
        void cardEl.offsetWidth; 
        cardEl.classList.add(inClass);
    }, 300);
}

function loadQuestion(index) {
    try { 
        currentIndex = index;
        currentQuestionData = quizQueue[currentIndex];

        if (!currentQuestionData) {
            console.error("❌ CRITICAL ERROR: No data found at index", index);
            return; 
        }

        if (!currentQuestionData.options) {
            quizQueue[currentIndex] = formatCSVQuestion(currentQuestionData);
            currentQuestionData = quizQueue[currentIndex];
        }

        wrongAttempts = 0;
        hasAnsweredCorrectly = currentQuestionData.isSolvedInDatabase; 
        
        if (!isExamMode) updateFeedbackBar();
        
        if (explanationBtn) explanationBtn.style.display = 'none'; 
        if (explanationModal) explanationModal.classList.remove('show');

// === EXAM UI LOGIC ===
        if (isExamMode) {
            if (questionIdBadge) questionIdBadge.textContent = `Question ${currentIndex + 1} / ${quizQueue.length}`;
            
            if (currentQuestionData.hasBeenSkipped) {
                if (skippedWarningEl) skippedWarningEl.classList.remove('hidden');
                if (skipBtn) skipBtn.style.display = 'none'; 
            } else {
                if (skippedWarningEl) skippedWarningEl.classList.add('hidden');
                if (skipBtn) skipBtn.style.display = 'block';
            }

            const nextBtn = document.getElementById('next-btn');
            if (nextBtn) {
                if (currentIndex === quizQueue.length - 1) {
                    nextBtn.textContent = "Submit Exam";
                } else {
                    nextBtn.textContent = "Next";
                }
            }
        } else {
            if (questionIdBadge) questionIdBadge.textContent = `Question ${currentIndex + 1}`;
        }
		

        if (questionTextEl) questionTextEl.textContent = currentQuestionData.text;
        if (explanationText) explanationText.textContent = currentQuestionData.explanation;

        if (optionsContainer) {
            optionsContainer.innerHTML = '';
            currentQuestionData.options.forEach(opt => {
                const optBox = document.createElement('div');
                optBox.className = 'option-box';
                
                if (isExamMode && currentQuestionData.userSelectedAnswer === opt.text) {
                    optBox.classList.add('selected');
                } else if (!isExamMode && hasAnsweredCorrectly && opt.isCorrect) {
                    optBox.classList.add('correct');
                }

                optBox.innerHTML = `
                    <div class="option-text">${opt.text}</div>
                    <i class="fas fa-eye eye-icon" title="Strikeout option"></i>
                `;
                optBox.onclick = (e) => handleOptionClick(e, opt, optBox);
                optionsContainer.appendChild(optBox);
            });
        }

        // === BOOKMARK LOGIC ===
        const bookmarkBtn = document.getElementById('bookmark-btn');
        if (bookmarkBtn) {
            const starIcon = bookmarkBtn.querySelector('i');
            
            if (!starIcon) {
                console.warn("⚠️ Bookmark button found, but the <i> star icon inside it is missing in the HTML!");
            } else {
                if (currentQuestionData.isBookmarked) {
                    starIcon.classList.remove('far', 'fa-regular');
                    starIcon.classList.add('fas', 'fa-solid');
                } else {
                    starIcon.classList.remove('fas', 'fa-solid');
                    starIcon.classList.add('far', 'fa-regular');
                }

                bookmarkBtn.onclick = (e) => {
                    e.preventDefault();
                    currentQuestionData.isBookmarked = !currentQuestionData.isBookmarked;

                    if (currentQuestionData.isBookmarked) {
                        starIcon.classList.replace('far', 'fas');
                        starIcon.classList.add('fa-solid');
                    } else {
                        starIcon.classList.replace('fas', 'far');
                        starIcon.classList.remove('fa-solid');
                    }

                    toggleBookmarkInFirebase(currentQuestionData.originalNumber, currentQuestionData.isBookmarked);
                };
            }
        }

        // === NOTES LOGIC ===
        const noteBtn = document.getElementById('note-btn');
        if (noteBtn) {
            noteBtn.onclick = (e) => {
                e.preventDefault();
                if (noteInput) {
                    noteInput.value = currentQuestionData.userNote || ""; 
                }
                if (notesModal) notesModal.classList.add('show');
            };
        }

        if (saveNoteBtn) {
            saveNoteBtn.onclick = () => {
                const typedNote = noteInput.value.trim();
                currentQuestionData.userNote = typedNote; 
                
                if (typeof saveNoteToFirebase === "function") {
                    saveNoteToFirebase(currentQuestionData.originalNumber, typedNote);
                }
                
                notesModal.classList.remove('show');
            };
        }

        if (closeNotesBtn) {
            closeNotesBtn.onclick = () => {
                notesModal.classList.remove('show');
            };
        }
		
        updateGridStyles();

    } catch (error) { 
        console.error("🚨 CRASH inside loadQuestion:", error);
    }
}

// ==========================================
// 3. DATABASE SYNC FUNCTIONS
// ==========================================
async function savePracticeProgress(questionId, isCorrect) {
    const user = auth.currentUser;
    if (!user) return; 

    const userRef = doc(db, "users", user.uid);
    
    try {
        if (isCorrect) {
            await setDoc(userRef, {
                solvedQuestions: arrayUnion(questionId) 
            }, { merge: true });
        } else {
            await setDoc(userRef, {
                mistakes: arrayUnion(questionId)
            }, { merge: true });
        }
    } catch (error) {
        console.error("Error saving to Firebase:", error);
    }
}

async function saveExamProgress(correctIds, mistakeIds, correctCount, totalQuestions) {
    console.log("🚀 Initiating Exam Save...");
    
    const user = auth.currentUser;
    if (!user) return; 

    const userRef = doc(db, "users", user.uid);
    
    try {
        let updates = {};
        
        if (correctIds.length > 0) {
            updates.solvedQuestions = arrayUnion(...correctIds);
        }
        if (mistakeIds.length > 0) {
            updates.mistakes = arrayUnion(...mistakeIds);
        }

        const examTitle = quizConfig.examName || "Custom Exam"; 
        
        const examRecord = {
            examName: examTitle,
            score: correctCount,
            total: totalQuestions,
            percentage: Math.round((correctCount / totalQuestions) * 100),
            date: new Date().toISOString() 
        };

        updates.examHistory = arrayUnion(examRecord);

        if (Object.keys(updates).length > 0) {
            await setDoc(userRef, updates, { merge: true });
            console.log("✅ Exam progress and history successfully saved to Firebase!");
        }
    } catch (error) {
        console.error("❌ Error saving exam progress to Firebase:", error);
    }
}

async function toggleBookmarkInFirebase(questionId, isBookmarking) {
    const user = auth.currentUser;
    if (!user) return; 

    const userRef = doc(db, "users", user.uid);
    
    try {
        await setDoc(userRef, {
            bookmarks: isBookmarking ? arrayUnion(questionId) : arrayRemove(questionId)
        }, { merge: true });
    } catch (error) {
        console.error("Error updating bookmark in Firebase:", error);
    }
}

// ==========================================
// NOTES SYNC FUNCTION (FIXED)
// ==========================================
async function saveNoteToFirebase(questionId, noteText) {
    const user = auth.currentUser;
    if (!user) return; 

    const userRef = doc(db, "users", user.uid);
    
    try {
        // FIX: Create a proper nested object so Firebase merges it correctly
        const noteUpdate = { notes: {} };
        noteUpdate.notes[questionId] = noteText;

        await setDoc(userRef, noteUpdate, { merge: true });
        
        console.log(`✅ Note saved securely for Question ${questionId}`);
    } catch (error) {
        console.error("❌ Error saving note to Firebase:", error);
    }
}


function handleOptionClick(event, optionData, optionElement) {
    if (event.target.classList.contains('eye-icon')) {
        optionElement.classList.toggle('strikethrough');
        return; 
    }

    if (isExamMode) {
        document.querySelectorAll('.option-box').forEach(b => b.classList.remove('selected'));
        optionElement.classList.add('selected');
        currentQuestionData.userSelectedAnswer = optionData.text;
        skipBtn.style.display = 'none';
        return; 
    }

    if (hasAnsweredCorrectly || optionElement.classList.contains('incorrect')) return; 

    if (!optionData.isCorrect) {
        optionElement.classList.remove('apply-shake');
        void optionElement.offsetWidth;
        optionElement.classList.add('incorrect', 'apply-shake');
        wrongAttempts++;
        updateFeedbackBar();
        
        savePracticeProgress(currentQuestionData.originalNumber, false); 
        
    } else {
        optionElement.classList.remove('apply-pop');
        void optionElement.offsetWidth; 
        optionElement.classList.add('correct', 'apply-pop');
        hasAnsweredCorrectly = true;
        currentQuestionData.isSolvedInDatabase = true; 
        document.querySelectorAll('.option-box').forEach(box => box.classList.add('locked'));
        updateFeedbackBar();
        document.getElementById(`grid-num-${currentIndex}`).classList.add('solved');
        
        savePracticeProgress(currentQuestionData.originalNumber, true); 
        
        explanationBtn.style.display = 'inline-block'; 
        setTimeout(() => explanationModal.classList.add('show'), 600);
    }
}

function updateFeedbackBar() {
    wrongCountEl.textContent = `${wrongAttempts} ✖`;
    rightCountEl.textContent = `${hasAnsweredCorrectly ? 1 : 0} ✔`;
    const totalAttempts = wrongAttempts + (hasAnsweredCorrectly ? 1 : 0);
    if (totalAttempts > 0) {
        const percentGreen = (hasAnsweredCorrectly ? 1 : 0) / totalAttempts * 100;
        feedbackFill.style.width = `${percentGreen}%`;
    } else {
        feedbackFill.style.width = `0%`;
    }
}

// ==========================================
// 4. EXAM SUBMISSION & RESULTS
// ==========================================
function showResults() {
    clearInterval(timerInterval);    
    let correctCount = 0;
    let correctIds = [];
    let mistakeIds = [];
    
    quizQueue.forEach(q => {
        let correctOpt = q.options.find(o => o.isCorrect);
        if (correctOpt && q.userSelectedAnswer === correctOpt.text) {
            correctCount++;
            correctIds.push(q.originalNumber);
        } else if (q.userSelectedAnswer) {
            mistakeIds.push(q.originalNumber);
        }
    });

    const total = quizQueue.length;
    const percentage = Math.round((correctCount / total) * 100);
    
	if (isExamMode) {
        saveExamProgress(correctIds, mistakeIds, correctCount, total);
    }
	
    document.getElementById('quiz-ui-container').style.display = 'none';
    document.getElementById('bottom-actions-container').style.display = 'none';
    
    const resultsEl = document.getElementById('exam-result-screen');
    resultsEl.classList.remove('hidden');
    resultsEl.classList.add('result-pop-in'); 
    
    const titleEl = document.getElementById('result-title');
    const scoreEl = document.getElementById('result-score');
    
    scoreEl.textContent = `You scored ${correctCount} out of ${total} (${percentage}%)`;
    
    if (percentage >= 75) {
        titleEl.innerHTML = `<i class="fas fa-check-circle" style="font-size: 3.5rem; display: block; margin-bottom: 1rem; color: #10b981;"></i> 🎉 Passed!`;
        titleEl.style.color = "#065f46";
    } else {
        titleEl.innerHTML = `<i class="fas fa-times-circle" style="font-size: 3.5rem; display: block; margin-bottom: 1rem; color: #ef4444;"></i> ❌ Failed`;
        titleEl.style.color = "#991b1b";
    }
}

// ==========================================
// 5. TIMER & SKIP LOGIC
// ==========================================
function startTimer() {
    timerInterval = setInterval(() => {
        if (isExamMode) {
            sessionSeconds--; 
            if (sessionSeconds <= 0) {
                clearInterval(timerInterval);
                alert("Time is up! Submitting exam automatically.");
                showResults();
                return;
            }
        } else {
            sessionSeconds++; 
        }

        const mins = Math.floor(sessionSeconds / 60).toString().padStart(2, '0');
        const secs = (sessionSeconds % 60).toString().padStart(2, '0');
        timerDisplay.textContent = `${mins}:${secs}`;
    }, 1000);
}

skipBtn.onclick = () => {
    let skippedQuestion = quizQueue.splice(currentIndex, 1)[0];
    skippedQuestion.hasBeenSkipped = true;
    quizQueue.push(skippedQuestion);
    triggerSlideTransition(currentIndex, 'right');
};

// ==========================================
// 6. MODAL & NAVIGATION CONTROLS
// ==========================================
explanationBtn.onclick = () => explanationModal.classList.add('show');
closeExplanationBtn.onclick = () => explanationModal.classList.remove('show');

document.getElementById('next-btn').onclick = () => {
    if (isExamMode) {
        if (!currentQuestionData.userSelectedAnswer) {
            alert("Please select an answer. If you are stuck, click Skip.");
            return;
        }
        if (currentIndex === quizQueue.length - 1) {
            showResults();
            return;
        }
    }

    if (currentIndex < quizQueue.length - 1) {
        triggerSlideTransition(currentIndex + 1, 'right');
    }
};

document.getElementById('prev-btn').onclick = () => {
    if (isExamMode) return; 
    if (currentIndex > 0) triggerSlideTransition(currentIndex - 1, 'left');
};

loadSession();