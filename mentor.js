import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, collection, query, where, getDocs, addDoc, updateDoc, onSnapshot, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let currentUser = null;
let currentUserData = null;
let currentRole = 'STUDENT';
let currentChatId = null;
let chatUnsubscribe = null; 
let requestUnsubscribe = null;

const studentView = document.getElementById('student-view');
const mentorView = document.getElementById('mentor-view');
const liveChatView = document.getElementById('live-chat-view');

const mentorsList = document.getElementById('mentors-list');
const requestsList = document.getElementById('requests-list');
const hubSubtitle = document.getElementById('hub-subtitle');

const chatPartnerName = document.getElementById('chat-partner-name');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const btnEndChat = document.getElementById('btn-end-chat');

// ==========================================
// 1. AUTHENTICATION & ROLE ROUTING
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        const userRef = doc(db, "users", user.uid);
        const docSnap = await getDoc(userRef);
        
        if (docSnap.exists()) {
            currentUserData = docSnap.data();
            currentRole = currentUserData.role || 'STUDENT';
            
            if (currentRole === 'MENTOR' || currentRole === 'MANAGEMENT') {
                hubSubtitle.textContent = "You are online and ready to assist students.";
                studentView.style.display = 'none';
                mentorView.style.display = 'block';
                listenForIncomingRequests();
            } else {
                fetchAvailableMentors();
            }
        }
    } else {
        window.location.href = 'index.html';
    }
});

// ==========================================
// 2. STUDENT LOGIC: FIND MENTOR
// ==========================================
async function fetchAvailableMentors() {
    try {
        const usersRef = collection(db, "users");
        // NOTE: Make sure Firebase rules allow students to read docs where role == MENTOR
        const q = query(usersRef, where("role", "in", ["MENTOR", "MANAGEMENT"]));
        const querySnapshot = await getDocs(q);
        
        mentorsList.innerHTML = '';
        if (querySnapshot.empty) {
            mentorsList.innerHTML = '<p style="text-align: center; color: #ef4444;">No mentors are currently online.</p>';
            return;
        }

        querySnapshot.forEach((docSnap) => {
            const mentorData = docSnap.data();
            const card = document.createElement('div');
            card.className = 'mentor-card';
            card.innerHTML = `
                <div>
                    <div style="font-weight: 800; color: #1e293b; font-size: 1.1rem;">Dr. ${mentorData.fullName || 'Verified Mentor'}</div>
                    <div style="font-size: 0.8rem; color: #10b981; font-weight: bold;">🟢 Available Now</div>
                </div>
                <button class="btn-solid" style="padding: 0.6rem 1.2rem; border-radius: 8px; border: none; background: #0f172a; font-weight: bold; cursor: pointer;">
                    Start Chat
                </button>
            `;
            // Attach click event
            card.querySelector('button').onclick = () => requestChat(docSnap.id, mentorData.fullName || 'Mentor');
            mentorsList.appendChild(card);
        });
    } catch (error) {
        console.error("Error fetching mentors:", error);
        mentorsList.innerHTML = '<p style="text-align: center; color: #ef4444;">Failed to load mentors.</p>';
    }
}

async function requestChat(mentorId, mentorName) {
    mentorsList.innerHTML = `<div style="text-align: center; padding: 2rem;"><p style="color: #d97706; font-weight: bold; font-size: 1.2rem;">Ringing Dr. ${mentorName}...</p><p style="color: #64748b;">Please wait for them to accept the chat.</p></div>`;
    
    try {
        const chatRef = await addDoc(collection(db, "chats"), {
            studentId: currentUser.uid,
            studentName: currentUserData ? (currentUserData.fullName || currentUser.email) : "Student",
            studentEmail: currentUser.email || "No Email",
            mentorId: mentorId,
            mentorName: mentorName,
            status: 'pending', 
            createdAt: serverTimestamp()
        });

        currentChatId = chatRef.id;
        
        // Listen to see if Mentor accepts
        chatUnsubscribe = onSnapshot(doc(db, "chats", currentChatId), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                if (data.status === 'active') {
                    studentView.style.display = 'none';
                    openLiveChat(currentChatId, "Dr. " + mentorName);
                } else if (data.status === 'rejected' || data.status === 'ended') {
                    alert("Mentor is currently busy or ended the chat.");
                    window.location.reload();
                }
            }
        });
    } catch (error) {
        console.error("Error requesting chat:", error);
    }
}

// ==========================================
// 3. MENTOR LOGIC: INCOMING REQUESTS
// ==========================================
function listenForIncomingRequests() {
    const chatsRef = collection(db, "chats");
    const q = query(chatsRef, where("mentorId", "==", currentUser.uid), where("status", "==", "pending"));
    
    requestUnsubscribe = onSnapshot(q, (snapshot) => {
        requestsList.innerHTML = ''; // Clear list
        
        if (snapshot.empty) {
            requestsList.innerHTML = '<p style="text-align: center; color: #94a3b8;">No pending requests.</p>';
            return;
        }

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const chatId = docSnap.id;
            
            const card = document.createElement('div');
            card.className = 'mentor-card';
            card.style.borderColor = '#fbbf24';
            card.style.background = '#fffbeb';
            card.innerHTML = `
                <div>
                    <div style="font-weight: 800; color: #b45309; font-size: 1.1rem;">🔔 New Request!</div>
                    <div style="font-size: 0.9rem; color: #1e293b; font-weight: bold;">From: ${data.studentName}</div>
                    <div style="font-size: 0.75rem; color: #64748b;">${data.studentEmail}</div>
                </div>
                <div style="display: flex; gap: 0.5rem; align-items: center;">
                    <button class="btn-outline btn-reject" style="border-color: #ef4444; color: #ef4444; padding: 0.5rem 1rem;">Decline</button>
                    <button class="btn-solid btn-accept" style="background: #10b981; border: none; padding: 0.5rem 1rem;">Accept</button>
                </div>
            `;
            
            card.querySelector('.btn-accept').onclick = async () => {
                await updateDoc(doc(db, "chats", chatId), { status: 'active' });
                mentorView.style.display = 'none';
                openLiveChat(chatId, data.studentName);
            };
            
            card.querySelector('.btn-reject').onclick = async () => {
                await updateDoc(doc(db, "chats", chatId), { status: 'rejected' });
            };
            
            requestsList.appendChild(card);
        });
    });
}

// ==========================================
// 4. SHARED LIVE CHAT ENGINE
// ==========================================
function openLiveChat(chatId, partnerName) {
    currentChatId = chatId;
    chatPartnerName.textContent = partnerName;
    liveChatView.style.display = 'flex';
    chatMessages.innerHTML = ''; 
    
    // 1. Listen for new messages
    const messagesRef = collection(db, "chats", chatId, "messages");
    const q = query(messagesRef, orderBy("timestamp", "asc"));
    
    if (chatUnsubscribe) chatUnsubscribe(); // Clear old listeners
    
    chatUnsubscribe = onSnapshot(q, (snapshot) => {
        chatMessages.innerHTML = ''; 
        snapshot.forEach((docSnap) => {
            const msg = docSnap.data();
            const isMe = msg.senderId === currentUser.uid;
            
            const msgDiv = document.createElement('div');
            msgDiv.className = `msg-bubble ${isMe ? 'msg-sent' : 'msg-received'}`;
            msgDiv.textContent = msg.text;
            chatMessages.appendChild(msgDiv);
        });
        chatMessages.scrollTop = chatMessages.scrollHeight; // Auto-scroll
    });

    // 2. Listen to see if the OTHER person ended the chat
    onSnapshot(doc(db, "chats", chatId), (docSnap) => {
        if (docSnap.exists() && docSnap.data().status === 'ended') {
            alert("The other person has ended the chat. Transcript will be saved.");
            window.location.href = 'dashboard.html';
        }
    });
}

// Send Message
chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !currentChatId) return;

    chatInput.value = ''; 

    try {
        await addDoc(collection(db, "chats", currentChatId, "messages"), {
            senderId: currentUser.uid,
            text: text,
            timestamp: serverTimestamp()
        });
    } catch (error) { console.error("Error sending message:", error); }
});

// End Chat & "Email Transcript"
btnEndChat.addEventListener('click', async () => {
    if (!currentChatId) return;
    
    if (confirm("End chat session? A transcript will be prepared for the student.")) {
        await updateDoc(doc(db, "chats", currentChatId), { status: 'ended' });
        
        try {
            const messagesRef = collection(db, "chats", currentChatId, "messages");
            const q = query(messagesRef, orderBy("timestamp", "asc"));
            const { getDocs } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
            const snapshot = await getDocs(q);
            
            let transcriptText = "=== EDEETOS MENTORSHIP TRANSCRIPT ===\n";
            transcriptText += "Mentorship provided by Edeetos (edeetos@gmail.com)\n\n";
            
            snapshot.forEach((docSnap) => {
                const msg = docSnap.data();
                const sender = msg.senderId === currentUser.uid ? "Mentor" : "Student";
                transcriptText += `[${sender}]: ${msg.text}\n`;
            });
            
            const chatDoc = await getDoc(doc(db, "chats", currentChatId));
            let studentEmail = "student@gmail.com";
            if (chatDoc.exists() && chatDoc.data().studentEmail) {
                studentEmail = chatDoc.data().studentEmail;
            }

            const subject = encodeURIComponent("Your Edeetos Mentorship Transcript");
            const body = encodeURIComponent(transcriptText);

            window.location.href = `mailto:${studentEmail}?cc=edeetos@gmail.com&subject=${subject}&body=${body}`;
            alert("Session Ended. Email client opening with transcript.");
            
        } catch(e) {
            console.error("Transcript Error", e);
            alert("Session Ended, but transcript generation failed.");
        }

        setTimeout(() => {
            window.location.href = 'dashboard.html';
        }, 1500);
    }
});