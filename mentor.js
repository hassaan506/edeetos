// mentor.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, collection, query, where, getDocs, addDoc, updateDoc, onSnapshot, orderBy, serverTimestamp, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let currentUser = null;
let currentUserData = null;
let currentRole = 'STUDENT';
let currentChatId = null;
let chatUnsubscribe = null; 
let requestUnsubscribe = null;
let localMessages = [];

// DOM Elements
const studentView = document.getElementById('student-view');
const mentorView = document.getElementById('mentor-view');
const liveChatView = document.getElementById('live-chat-view');

const onlineMentorsList = document.getElementById('online-mentors-list');
const offlineMentorsList = document.getElementById('offline-mentors-list');
const requestsList = document.getElementById('requests-list');

const chatPartnerName = document.getElementById('chat-partner-name');
const chatTypeBadge = document.getElementById('chat-type-badge');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const btnEndChat = document.getElementById('btn-end-chat');
const toggleStatusBtn = document.getElementById('toggle-status-btn');

// ==========================================
// 0. BENTO CARD MOUSE TRACKING
// ==========================================
document.addEventListener("mousemove", (e) => {
    document.querySelectorAll(".bento-card").forEach((card) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        card.style.setProperty("--mouse-x", `${x}px`);
        card.style.setProperty("--mouse-y", `${y}px`);
    });
});

// ==========================================
// 1. INIT & ROUTING
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (!user) return window.location.href = 'index.html';
    
    currentUser = user;
    const userRef = doc(db, "users", user.uid);
    const docSnap = await getDoc(userRef);
    
    if (docSnap.exists()) {
        currentUserData = docSnap.data();
        currentRole = currentUserData.role || 'STUDENT';
        
        if (currentRole === 'MENTOR' || currentRole === 'MANAGEMENT') {
            setupMentorView();
        } else {
            setupStudentView();
        }
    }
});

// ==========================================
// 2. MENTOR LOGIC
// ==========================================
function setupMentorView() {
    studentView.style.display = 'none';
    mentorView.style.display = 'block';
    
    updateStatusBtn(currentUserData.isOnline || false);

    toggleStatusBtn.onclick = async () => {
        const newStatus = !(currentUserData.isOnline || false);
        await updateDoc(doc(db, "users", currentUser.uid), { isOnline: newStatus });
        currentUserData.isOnline = newStatus;
        updateStatusBtn(newStatus);
    };

    listenForRequestsAndMessages();
}

function updateStatusBtn(isOnline) {
    if (isOnline) {
        toggleStatusBtn.textContent = "You are Online (Click to go Offline)";
        toggleStatusBtn.classList.add('btn-danger');
    } else {
        toggleStatusBtn.textContent = "You are Offline (Click to go Online)";
        toggleStatusBtn.classList.remove('btn-danger');
    }
}

function listenForRequestsAndMessages() {
    const q = query(collection(db, "chats"), where("mentorId", "==", currentUser.uid), where("status", "in", ["pending", "active", "offline_thread"]));
    
    requestUnsubscribe = onSnapshot(q, (snapshot) => {
        requestsList.innerHTML = ''; 
        if (snapshot.empty) {
            requestsList.innerHTML = '<span class="mono-label" style="text-align: center; display: block; width: 100%;">No pending requests.</span>';
            return;
        }

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const chatId = docSnap.id;
            
            const card = document.createElement('div');
            card.className = `bento-card ${data.type === 'live' ? 'card-success' : 'card-primary'}`;
            
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div class="mono-label">${data.type === 'live' ? 'LIVE REQUEST' : 'OFFLINE MESSAGE'}</div>
                        <div style="font-size: 1.1rem; font-weight: bold; margin-top: 0.25rem;">${data.studentName}</div>
                    </div>
                    <button class="btn-solid btn-accept">Open</button>
                </div>
            `;
            
            card.querySelector('.btn-accept').onclick = async () => {
                if (data.status === 'pending') await updateDoc(doc(db, "chats", chatId), { status: 'active' });
                mentorView.style.display = 'none';
                openChat(chatId, data.studentName, data.type);
            };
            
            requestsList.appendChild(card);
        });
    });
}

// ==========================================
// 3. STUDENT LOGIC
// ==========================================
async function setupStudentView() {
    studentView.style.display = 'block';
    
    const q = query(collection(db, "chats"), where("studentId", "==", currentUser.uid), where("status", "in", ["pending", "active", "offline_thread"]));
    const chatSnap = await getDocs(q);

    if (!chatSnap.empty) {
        const activeChat = chatSnap.docs[0];
        studentView.style.display = 'none';
        openChat(activeChat.id, activeChat.data().mentorName, activeChat.data().type);
        return;
    }

    fetchMentors();
}

// FIXED: Now uses onSnapshot so mentor list updates in real-time
function fetchMentors() {
    const q = query(collection(db, "users"), where("role", "in", ["MENTOR", "MANAGEMENT"]));
    
    onSnapshot(q, (snapshot) => {
        onlineMentorsList.innerHTML = '';
        offlineMentorsList.innerHTML = '';

        snapshot.forEach((docSnap) => {
            const mentor = docSnap.data();
            const isOnline = mentor.isOnline || false;
            const targetList = isOnline ? onlineMentorsList : offlineMentorsList;
            
            const card = document.createElement('div');
            card.className = 'bento-card';
            card.style.display = 'flex';
            card.style.flexDirection = 'row';
            card.style.alignItems = 'center';
            card.style.padding = '1rem';
            
            card.innerHTML = `
                <div style="flex-grow: 1;">
                    <div style="font-weight: 800; font-size: 1.1rem; display: flex; align-items: center;">
                        <span class="status-indicator ${isOnline ? 'status-online' : 'status-offline'}"></span>
                        ${mentor.fullName || 'Verified Mentor'}
                    </div>
                </div>
                <button class="btn-solid" style="padding: 0.5rem 1rem;">
                    ${isOnline ? 'Live Chat' : 'Leave Message'}
                </button>
            `;
            
            card.querySelector('button').onclick = () => initiateChat(docSnap.id, mentor.fullName, isOnline);
            targetList.appendChild(card);
        });

        if (onlineMentorsList.innerHTML === '') onlineMentorsList.innerHTML = '<span class="mono-label">No mentors online.</span>';
        if (offlineMentorsList.innerHTML === '') offlineMentorsList.innerHTML = '<span class="mono-label">No offline mentors.</span>';

    }, (error) => {
        console.error("Error fetching mentors:", error);
    });
}

async function initiateChat(mentorId, mentorName, isOnline) {
    try {
        const type = isOnline ? 'live' : 'offline';
        const status = isOnline ? 'pending' : 'offline_thread';

        const chatRef = await addDoc(collection(db, "chats"), {
            studentId: currentUser.uid,
            studentName: currentUserData.fullName || "Student",
            mentorId: mentorId,
            mentorName: mentorName || "Mentor",
            type: type,
            status: status,
            createdAt: serverTimestamp()
        });

        studentView.style.display = 'none';
        openChat(chatRef.id, mentorName, type);
    } catch (error) {
        console.error("Error starting chat:", error);
        alert("Failed to start chat. Please try again.");
    }
}

// ==========================================
// 4. SHARED CHAT ENGINE
// ==========================================
function openChat(chatId, partnerName, type) {
    currentChatId = chatId;
    chatPartnerName.textContent = partnerName;
    
    if (type === 'live') {
        chatTypeBadge.innerHTML = 'Live Session';
        chatTypeBadge.style.color = 'var(--status-success)';
    } else {
        chatTypeBadge.innerHTML = 'Offline Message (Replies may be delayed)';
        chatTypeBadge.style.color = 'var(--accent)';
    }

    liveChatView.style.display = 'flex';
    chatMessages.innerHTML = ''; 
    localMessages = [];
    
    if (chatUnsubscribe) chatUnsubscribe();
    
    const q = query(collection(db, "chats", chatId, "messages"), orderBy("timestamp", "asc"));
    
    chatUnsubscribe = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const msg = change.doc.data();
                localMessages.push(msg); 
                
                const isMe = msg.senderId === currentUser.uid;
                const msgDiv = document.createElement('div');
                msgDiv.className = `msg-log ${isMe ? 'msg-sent' : 'msg-received'}`;
                
                const timeString = msg.timestamp ? new Date(msg.timestamp.toMillis()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                const senderName = isMe ? 'You' : partnerName;

                msgDiv.innerHTML = `
                    <span class="msg-sender">[${timeString}] ${senderName}:</span>
                    <div class="msg-text">${msg.text}</div>
                `;
                chatMessages.appendChild(msgDiv);
            }
        });
        chatMessages.scrollTop = chatMessages.scrollHeight; 
    });

    onSnapshot(doc(db, "chats", chatId), (docSnap) => {
        if (!docSnap.exists()) {
            alert("This chat was ended by the other person.");
            window.location.reload();
        }
    });
}

chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !currentChatId) return;

    chatInput.value = ''; 
    await addDoc(collection(db, "chats", currentChatId, "messages"), {
        senderId: currentUser.uid,
        text: text,
        timestamp: serverTimestamp()
    });
});

// FIXED: Clearer logic for ending and downloading chat
btnEndChat.addEventListener('click', async () => {
    if (!currentChatId) return;
    
    if (!confirm("Are you sure you want to end this chat? All messages will be permanently deleted.")) {
        return; // User clicked Cancel, do nothing
    }
    
    // User agreed to delete. Now ask if they want a copy first.
    if (confirm("Do you want to download a copy of this chat before it is deleted?")) {
        downloadTranscript();
    }
    
    // Delete the chat regardless of whether they downloaded it
    try {
        const messagesRef = collection(db, "chats", currentChatId, "messages");
        const snapshot = await getDocs(messagesRef);
        for (const d of snapshot.docs) {
             await deleteDoc(doc(db, "chats", currentChatId, "messages", d.id));
        }
        await deleteDoc(doc(db, "chats", currentChatId));
    } catch(e) {
        console.error("Failed to delete chat:", e);
    }
    
    window.location.reload();
});

function downloadTranscript() {
    let transcriptText = "=== EDEETOS CHAT TRANSCRIPT ===\n";
    transcriptText += `Date: ${new Date().toLocaleString()}\n\n`;
    
    localMessages.forEach((msg) => {
        const sender = msg.senderId === currentUser.uid ? "You" : chatPartnerName.textContent;
        transcriptText += `[${sender}]: ${msg.text}\n`;
    });

    const blob = new Blob([transcriptText], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Edeetos_Chat_${new Date().getTime()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}
