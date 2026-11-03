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
        toggleStatusBtn.textContent = "Status: Online (Click to Offline)";
        toggleStatusBtn.classList.add('btn-danger');
    } else {
        toggleStatusBtn.textContent = "Status: Offline (Click to Online)";
        toggleStatusBtn.classList.remove('btn-danger');
    }
}

function listenForRequestsAndMessages() {
    const q = query(collection(db, "chats"), where("mentorId", "==", currentUser.uid), where("status", "in", ["pending", "active", "offline_thread"]));
    
    requestUnsubscribe = onSnapshot(q, (snapshot) => {
        requestsList.innerHTML = ''; 
        if (snapshot.empty) {
            requestsList.innerHTML = '<span class="mono-label" style="text-align: center; display: block; width: 100%;">No active requests found.</span>';
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
                        <div class="mono-label">${data.type === 'live' ? 'LIVE REQUEST' : 'OFFLINE LOG'}</div>
                        <div style="font-size: 1.1rem; font-weight: bold; margin-top: 0.25rem;">ID: ${data.studentName}</div>
                    </div>
                    <button class="btn-solid btn-accept">Access</button>
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
            card.className = 'bento-card';
            card.style.display = 'flex';
            card.style.flexDirection = 'row';
            card.style.alignItems = 'center';
            card.style.padding = '1rem';
            
            card.innerHTML = `
                <div style="flex-grow: 1;">
                    <div style="font-weight: 800; font-size: 1.1rem; display: flex; align-items: center;">
                        <span class="status-indicator ${isOnline ? 'status-online' : 'status-offline'}"></span>
                        ${mentor.fullName || 'Verified ID'}
                    </div>
                </div>
                <button class="btn-solid" style="padding: 0.5rem 1rem;">
                    ${isOnline ? 'Connect' : 'Leave Log'}
                </button>
            `;
            
            card.querySelector('button').onclick = () => initiateChat(docSnap.id, mentor.fullName, isOnline);
            targetList.appendChild(card);
        });

        if (onlineMentorsList.innerHTML === '') onlineMentorsList.innerHTML = '<span class="mono-label">No active personnel found.</span>';
        if (offlineMentorsList.innerHTML === '') offlineMentorsList.innerHTML = '<span class="mono-label">No offline personnel found.</span>';

    } catch (error) {
        console.error("Error fetching personnel:", error);
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
        console.error("Error creating connection:", error);
        alert("Connection failed. Retry.");
    }
}

// ==========================================
// 4. SHARED CHAT ENGINE
// ==========================================
function openChat(chatId, partnerName, type) {
    currentChatId = chatId;
    chatPartnerName.textContent = `ID: ${partnerName}`;
    
    if (type === 'live') {
        chatTypeBadge.innerHTML = 'STATUS: LIVE CONNECTION';
        chatTypeBadge.style.color = 'var(--status-success)';
    } else {
        chatTypeBadge.innerHTML = 'STATUS: OFFLINE LOG';
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
                
                const timeString = msg.timestamp ? new Date(msg.timestamp.toMillis()).toLocaleTimeString() : new Date().toLocaleTimeString();
                
                msgDiv.innerHTML = `
                    <span class="msg-sender">[${timeString}] ${isMe ? 'LOCAL' : 'REMOTE'}:</span>
                    <div class="msg-text">${msg.text}</div>
                `;
                chatMessages.appendChild(msgDiv);
            }
        });
        chatMessages.scrollTop = chatMessages.scrollHeight; 
    });

    onSnapshot(doc(db, "chats", chatId), (docSnap) => {
        if (!docSnap.exists()) {
            alert("Connection terminated by remote user.");
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

// Ephemeral Logic
btnEndChat.addEventListener('click', async () => {
    if (!currentChatId) return;
    
    if (!confirm("Terminate session and wipe logs? This action is irreversible.")) return;
    
    if (confirm("Export log data before termination?")) {
        downloadTranscript();
    }
    
    try {
        const messagesRef = collection(db, "chats", currentChatId, "messages");
        const snapshot = await getDocs(messagesRef);
        for (const d of snapshot.docs) {
             await deleteDoc(doc(db, "chats", currentChatId, "messages", d.id));
        }
        await deleteDoc(doc(db, "chats", currentChatId));
    } catch(e) {
        console.error("Data wipe failed:", e);
    }
    
    window.location.reload();
});

function downloadTranscript() {
    let transcriptText = "=== CLINICAL SYSTEM EXPORT ===\n";
    const pName = chatPartnerName.textContent.replace('ID: ', '');
    transcriptText += `LOCAL: ${currentUserData.fullName}\nREMOTE: ${pName}\nTIMESTAMP: ${new Date().toISOString()}\n\n`;
    
    localMessages.forEach((msg) => {
        const sender = msg.senderId === currentUser.uid ? "LOCAL" : "REMOTE";
        transcriptText += `[${sender}]: ${msg.text}\n`;
    });

    const blob = new Blob([transcriptText], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `system_log_${new Date().getTime()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}