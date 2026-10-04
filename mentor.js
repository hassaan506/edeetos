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
    
    // Update button based on current DB status
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
        toggleStatusBtn.textContent = "Go Offline";
        toggleStatusBtn.style.borderColor = "#ef4444";
        toggleStatusBtn.style.color = "#ef4444";
    } else {
        toggleStatusBtn.textContent = "Go Online";
        toggleStatusBtn.style.borderColor = "#10b981";
        toggleStatusBtn.style.color = "#10b981";
    }
}

function listenForRequestsAndMessages() {
    const q = query(collection(db, "chats"), where("mentorId", "==", currentUser.uid), where("status", "in", ["pending", "active", "offline_thread"]));
    
    requestUnsubscribe = onSnapshot(q, (snapshot) => {
        requestsList.innerHTML = ''; 
        if (snapshot.empty) {
            requestsList.innerHTML = '<p style="text-align: center; color: #94a3b8;">No pending requests or messages.</p>';
            return;
        }

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const chatId = docSnap.id;
            
            const card = document.createElement('div');
            card.className = 'mentor-card';
            card.style.borderColor = data.type === 'live' ? '#10b981' : '#94a3b8';
            
            card.innerHTML = `
                <div>
                    <div style="font-weight: 800; color: #1e293b;">${data.type === 'live' ? '🟢 Live Request' : '⚪ Offline Message'}</div>
                    <div style="font-size: 0.9rem; font-weight: bold;">From: ${data.studentName}</div>
                </div>
                <div style="display: flex; gap: 0.5rem;">
                    <button class="btn-solid btn-accept" style="background: #0f172a; padding: 0.5rem 1rem;">Open</button>
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
    
    // Check for existing active chats (live or offline thread)
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

async function fetchMentors() {
    try {
        const q = query(collection(db, "users"), where("role", "in", ["MENTOR", "MANAGEMENT"]));
        const snapshot = await getDocs(q);
        
        onlineMentorsList.innerHTML = '';
        offlineMentorsList.innerHTML = '';

        snapshot.forEach((docSnap) => {
            const mentor = docSnap.data();
            const isOnline = mentor.isOnline || false;
            const targetList = isOnline ? onlineMentorsList : offlineMentorsList;
            
            const card = document.createElement('div');
            card.className = 'mentor-card';
            card.innerHTML = `
                <div>
                    <div style="font-weight: bold; color: #1e293b;">
                        <span class="status-dot ${isOnline ? 'status-online' : 'status-offline'}"></span>
                        ${mentor.fullName || 'Verified Mentor'}
                    </div>
                </div>
                <button class="btn-solid" style="padding: 0.5rem 1rem; background: #0f172a; border: none;">
                    ${isOnline ? 'Live Chat' : 'Leave Message'}
                </button>
            `;
            
            card.querySelector('button').onclick = () => initiateChat(docSnap.id, mentor.fullName, isOnline);
            targetList.appendChild(card);
        });

        if (onlineMentorsList.innerHTML === '') onlineMentorsList.innerHTML = '<p style="color: #94a3b8;">No mentors online.</p>';
        if (offlineMentorsList.innerHTML === '') offlineMentorsList.innerHTML = '<p style="color: #94a3b8;">No offline mentors available.</p>';

    } catch (error) {
        console.error("Error fetching mentors:", error);
    }
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
        console.error("Error creating chat:", error);
        alert("Failed to start conversation.");
    }
}

// ==========================================
// 4. SHARED CHAT ENGINE & PURGE
// ==========================================
function openChat(chatId, partnerName, type) {
    currentChatId = chatId;
    chatPartnerName.textContent = partnerName;
    
    if (type === 'live') {
        chatTypeBadge.innerHTML = '🟢 Live Session';
        chatTypeBadge.style.color = '#10b981';
    } else {
        chatTypeBadge.innerHTML = '⚪ Offline Thread (Replies may be delayed)';
        chatTypeBadge.style.color = '#64748b';
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
                msgDiv.className = `msg-bubble ${isMe ? 'msg-sent' : 'msg-received'}`;
                msgDiv.textContent = msg.text;
                chatMessages.appendChild(msgDiv);
            }
        });
        chatMessages.scrollTop = chatMessages.scrollHeight; 
    });

    // Listen to see if the other person ended/purged the chat
    onSnapshot(doc(db, "chats", chatId), (docSnap) => {
        if (!docSnap.exists()) {
            alert("This conversation has been ended and purged by the other party.");
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

// Ephemeral Purge Logic
btnEndChat.addEventListener('click', async () => {
    if (!currentChatId) return;
    
    if (!confirm("Are you sure you want to end this session? Edeetos does not store messages. They will be deleted permanently.")) return;
    
    if (confirm("Do you want to download a transcript before the chat is permanently purged?")) {
        downloadTranscript();
    }
    
    alert("Purging chat data...");
    
    // Client-side recursive delete for ephemerality
    try {
        const messagesRef = collection(db, "chats", currentChatId, "messages");
        const snapshot = await getDocs(messagesRef);
        for (const d of snapshot.docs) {
             await deleteDoc(doc(db, "chats", currentChatId, "messages", d.id));
        }
        await deleteDoc(doc(db, "chats", currentChatId));
    } catch(e) {
        console.error("Purge Error", e);
    }
    
    window.location.reload();
});

function downloadTranscript() {
    let transcriptText = "=== EDEETOS MENTORSHIP TRANSCRIPT ===\n";
    const pName = chatPartnerName.textContent;
    transcriptText += `Participants: ${currentUserData.fullName} & ${pName}\n\n`;
    
    localMessages.forEach((msg) => {
        const sender = msg.senderId === currentUser.uid ? "You" : pName;
        transcriptText += `[${sender}]: ${msg.text}\n`;
    });

    const blob = new Blob([transcriptText], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Edeetos_Chat_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}