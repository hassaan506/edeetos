import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, collection, query, where, getDocs, addDoc, updateDoc, onSnapshot, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ==========================================
// STATE VARIABLES
// ==========================================
let currentUser = null;
let currentRole = 'STUDENT';
let currentChatId = null;
let chatUnsubscribe = null; 
let requestUnsubscribe = null;

// DOM Elements
const userNameEl = document.getElementById('user-name');
const subStatusEl = document.getElementById('subscription-status');
const logoutBtn = document.getElementById('logout-btn');

// Chat DOM Elements
const btnOpenMentors = document.getElementById('btn-open-mentors');
const mentorListModal = document.getElementById('mentor-list-modal');
const mentorsContainer = document.getElementById('mentors-container');
const incomingRequestModal = document.getElementById('incoming-request-modal');
const incomingStudentName = document.getElementById('incoming-student-name');
const btnAcceptChat = document.getElementById('btn-accept-chat');
const btnRejectChat = document.getElementById('btn-reject-chat');
const liveChatModal = document.getElementById('live-chat-modal');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const btnEndChat = document.getElementById('btn-end-chat');

// ==========================================
// AUTHENTICATION & INITIALIZATION
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        const userRef = doc(db, "users", user.uid);
        const docSnap = await getDoc(userRef);
        
        if (docSnap.exists()) {
            const dbData = docSnap.data();
            userNameEl.textContent = dbData.fullName || "Doctor";
            currentRole = dbData.role || 'STUDENT';
            
            // Handle Pro Badge logic
            if (dbData.isPremium) {
                subStatusEl.textContent = "Premium";
                subStatusEl.className = "status-badge badge-pro";
                document.getElementById('free-warning-text').style.display = 'none';
            }

            // If the user is a MENTOR, start listening for incoming chat requests
            if (currentRole === 'MENTOR' || currentRole === 'MANAGEMENT') {
                listenForIncomingRequests();
                btnOpenMentors.textContent = "You are a Mentor (Waiting...)";
                btnOpenMentors.disabled = true;
            }
        }
    } else {
        window.location.href = 'index.html'; // Redirect to login if not authenticated
    }
});

logoutBtn.addEventListener('click', () => {
    signOut(auth).then(() => {
        window.location.href = 'index.html';
    });
});

// ==========================================
// 1. STUDENT: FETCH AND REQUEST MENTOR
// ==========================================
btnOpenMentors.addEventListener('click', async () => {
    if (currentRole === 'MENTOR' || currentRole === 'MANAGEMENT') return; // Mentors don't request mentors

    mentorListModal.style.display = 'flex';
    mentorsContainer.innerHTML = '<p style="text-align: center; color: #94a3b8;">Finding available mentors...</p>';

    try {
        const usersRef = collection(db, "users");
        // Query for mentors. NOTE: Ensure your Firestore rules allow reading users with role 'MENTOR'
        const q = query(usersRef, where("role", "in", ["MENTOR", "MANAGEMENT"]));
        const querySnapshot = await getDocs(q);
        
        mentorsContainer.innerHTML = '';
        
        if (querySnapshot.empty) {
            mentorsContainer.innerHTML = '<p style="text-align: center; color: #ef4444;">No mentors are currently online.</p>';
            return;
        }

        querySnapshot.forEach((docSnap) => {
            const mentorData = docSnap.data();
            const mentorId = docSnap.id;
            
            const card = document.createElement('div');
            card.className = 'mentor-card';
            card.innerHTML = `
                <div>
                    <div style="font-weight: 800; color: #1e293b;">${mentorData.fullName || 'Verified Mentor'}</div>
                    <div style="font-size: 0.75rem; color: #10b981; font-weight: bold;">🟢 Online</div>
                </div>
                <button class="btn-solid" style="padding: 0.4rem 1rem; border-radius: 20px; font-size: 0.8rem; border: none; background: #0f172a;" onclick="requestChat('${mentorId}', '${mentorData.fullName}')">
                    Request Chat
                </button>
            `;
            mentorsContainer.appendChild(card);
        });

    } catch (error) {
        console.error("Error fetching mentors:", error);
        mentorsContainer.innerHTML = '<p style="text-align: center; color: #ef4444;">Error loading mentors.</p>';
    }
});

// Expose to window so the inline onclick in the HTML card works
window.requestChat = async function(mentorId, mentorName) {
    mentorsContainer.innerHTML = `<p style="text-align: center; color: #d97706; font-weight: bold;">Sending request to ${mentorName}... Please wait.</p>`;
    
    try {
        // Create a new document in the 'chats' collection
        const chatRef = await addDoc(collection(db, "chats"), {
            studentId: currentUser.uid,
            studentName: userNameEl.textContent,
            mentorId: mentorId,
            mentorName: mentorName,
            status: 'pending', // 'pending', 'active', 'ended'
            createdAt: serverTimestamp()
        });

        currentChatId = chatRef.id;
        
        // Now listen to see if the mentor accepts it!
        listenForChatAcceptance(currentChatId);

    } catch (error) {
        console.error("Error requesting chat:", error);
        mentorsContainer.innerHTML = '<p style="text-align: center; color: #ef4444;">Failed to send request.</p>';
    }
};

function listenForChatAcceptance(chatId) {
    const chatRef = doc(db, "chats", chatId);
    
    chatUnsubscribe = onSnapshot(chatRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            
            if (data.status === 'active') {
                // Mentor accepted! Close list, open live chat
                mentorListModal.style.display = 'none';
                openLiveChat(chatId);
            } else if (data.status === 'ended' || data.status === 'rejected') {
                alert("The mentor is unavailable right now.");
                mentorListModal.style.display = 'none';
                if (chatUnsubscribe) chatUnsubscribe();
            }
        }
    });
}

// ==========================================
// 2. MENTOR: LISTEN FOR AND ACCEPT REQUESTS
// ==========================================
function listenForIncomingRequests() {
    const chatsRef = collection(db, "chats");
    const q = query(chatsRef, where("mentorId", "==", currentUser.uid), where("status", "==", "pending"));
    
    requestUnsubscribe = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const data = change.doc.data();
                currentChatId = change.doc.id;
                
                incomingStudentName.textContent = data.studentName || "A Student";
                incomingRequestModal.style.display = 'flex';
            }
        });
    });
}

btnAcceptChat.addEventListener('click', async () => {
    incomingRequestModal.style.display = 'none';
    if (!currentChatId) return;

    // Update status to active
    await updateDoc(doc(db, "chats", currentChatId), { status: 'active' });
    openLiveChat(currentChatId);
});

btnRejectChat.addEventListener('click', async () => {
    incomingRequestModal.style.display = 'none';
    if (!currentChatId) return;

    await updateDoc(doc(db, "chats", currentChatId), { status: 'rejected' });
    currentChatId = null;
});

// ==========================================
// 3. SHARED: LIVE CHAT ENGINE
// ==========================================
function openLiveChat(chatId) {
    liveChatModal.style.display = 'flex';
    chatMessages.innerHTML = ''; // Clear previous messages
    
    // Listen for new messages in the subcollection
    const messagesRef = collection(db, "chats", chatId, "messages");
    const q = query(messagesRef, orderBy("timestamp", "asc"));
    
    // If there's an existing listener, kill it
    if (chatUnsubscribe) chatUnsubscribe();
    
    chatUnsubscribe = onSnapshot(q, (snapshot) => {
        chatMessages.innerHTML = ''; // Re-render all messages to ensure order
        
        snapshot.forEach((docSnap) => {
            const msg = docSnap.data();
            const isMe = msg.senderId === currentUser.uid;
            
            const msgDiv = document.createElement('div');
            msgDiv.className = `msg-bubble ${isMe ? 'msg-sent' : 'msg-received'}`;
            msgDiv.textContent = msg.text;
            
            chatMessages.appendChild(msgDiv);
        });
        
        // Auto-scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });

    // Also listen to the main chat document to see if the OTHER person ended it
    onSnapshot(doc(db, "chats", chatId), (docSnap) => {
        if (docSnap.exists() && docSnap.data().status === 'ended') {
            alert("The chat session has ended.");
            closeChatUI();
        }
    });
}

chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !currentChatId) return;

    chatInput.value = ''; // clear input immediately

    try {
        await addDoc(collection(db, "chats", currentChatId, "messages"), {
            senderId: currentUser.uid,
            text: text,
            timestamp: serverTimestamp()
        });
    } catch (error) {
        console.error("Error sending message:", error);
    }
});

btnEndChat.addEventListener('click', async () => {
    if (!currentChatId) return;
    
    if (confirm("Are you sure you want to end this chat? A transcript will be saved.")) {
        await updateDoc(doc(db, "chats", currentChatId), { status: 'ended' });
        
        // In a real production app, this status update triggers a Firebase Cloud Function 
        // to securely fetch the transcript and send the email via SendGrid/Nodemailer.
        alert("Chat ended! A transcript will be sent to your registered email address.");
        
        closeChatUI();
    }
});

function closeChatUI() {
    liveChatModal.style.display = 'none';
    if (chatUnsubscribe) chatUnsubscribe();
    currentChatId = null;
}