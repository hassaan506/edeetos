// mentor_2.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, collection, query, where, addDoc, updateDoc, onSnapshot, orderBy, serverTimestamp, deleteDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let currentUser = null;
let currentUserData = null;
let currentRole = 'STUDENT';
let currentChatId = null;
let chatUnsubscribe = null; 

// DOM Elements
const studentView = document.getElementById('student-view');
const mentorView = document.getElementById('mentor-view');
const liveChatView = document.getElementById('live-chat-view');

// Student DOM
const btnRequestLive = document.getElementById('btn-request-live');
const btnSubmitTicket = document.getElementById('btn-submit-ticket');
const ticketInput = document.getElementById('ticket-input');
const studentInboxList = document.getElementById('student-inbox-list');
const activeWaitingState = document.getElementById('active-waiting-state');
const studentActionsGrid = document.getElementById('student-actions-grid');
const btnCancelRequest = document.getElementById('btn-cancel-request');
const onlineCountBadge = document.getElementById('online-count-badge');

// Mentor DOM
const toggleStatusBtn = document.getElementById('toggle-status-btn');
const mentorLiveQueue = document.getElementById('mentor-live-queue');
const mentorTicketQueue = document.getElementById('mentor-ticket-queue');

// Chat DOM
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const btnEndChat = document.getElementById('btn-end-chat');
const chatPartnerName = document.getElementById('chat-partner-name');

// Modal DOM
const replyModal = document.getElementById('ticket-reply-modal');
const modalQuestionText = document.getElementById('modal-student-question');
const modalReplyInput = document.getElementById('modal-mentor-reply');
const btnCancelReply = document.getElementById('btn-cancel-reply');
const btnSubmitReply = document.getElementById('btn-submit-reply');
let activeTicketId = null;

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
// 2. MENTOR LOGIC (GLOBAL POOLS)
// ==========================================
function setupMentorView() {
    studentView.style.display = 'none';
    mentorView.style.display = 'block';
    
    updateStatusBtn(currentUserData.isOnline || false);

    window.addEventListener('beforeunload', forceOffline);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') forceOffline(); });

    toggleStatusBtn.onclick = async () => {
        const newStatus = !(currentUserData.isOnline || false);
        await updateDoc(doc(db, "users", currentUser.uid), { isOnline: newStatus });
        currentUserData.isOnline = newStatus;
        updateStatusBtn(newStatus);
    };

    listenToLiveRequests();
    listenToTicketQueue();
}

function forceOffline() {
    if (currentUserData && currentUserData.isOnline) {
        updateDoc(doc(db, "users", currentUser.uid), { isOnline: false }).catch(()=>{});
        currentUserData.isOnline = false;
    }
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

function listenToLiveRequests() {
    const q = query(collection(db, "chats"), where("status", "==", "pending"));
    
    onSnapshot(q, (snapshot) => {
        mentorLiveQueue.innerHTML = ''; 
        let found = false;

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.type !== 'live') return;
            found = true;

            const el = document.createElement('div');
            el.className = 'ticket-item';
            el.style.borderLeftColor = 'var(--status-success)';
            el.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div class="mono-label">LIVE REQUEST</div>
                        <div style="font-weight: bold; margin-top: 4px;">Student: ${data.studentName}</div>
                    </div>
                    <button class="btn-success btn-accept-live">Accept</button>
                </div>
            `;
            el.querySelector('.btn-accept-live').onclick = async () => {
                await updateDoc(docSnap.ref, { status: 'active', mentorId: currentUser.uid, mentorName: currentUserData.fullName });
                mentorView.style.display = 'none';
                openChat(docSnap.id, data.studentName);
            };
            mentorLiveQueue.appendChild(el);
        });

        if (!found) mentorLiveQueue.innerHTML = '<span class="mono-label" style="display: block; text-align: center; opacity: 0.5;">No Live Requests</span>';
    });
}

function listenToTicketQueue() {
    const q = query(collection(db, "chats"), where("status", "==", "open"));
    
    onSnapshot(q, (snapshot) => {
        mentorTicketQueue.innerHTML = ''; 
        let found = false;

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.type !== 'ticket') return;
            found = true;

            const el = document.createElement('div');
            el.className = 'ticket-item';
            el.innerHTML = `
                <div class="mono-label" style="margin-bottom: 0.5rem;">From: ${data.studentName}</div>
                <div class="ticket-q">${data.question}</div>
                <button class="btn-outline btn-claim-ticket" style="margin-top: 0.5rem; width: 100%;">Answer Question</button>
            `;
            el.querySelector('.btn-claim-ticket').onclick = () => {
                activeTicketId = docSnap.id;
                modalQuestionText.textContent = data.question;
                modalReplyInput.value = "";
                replyModal.classList.remove('view-hidden');
            };
            mentorTicketQueue.appendChild(el);
        });

        if (!found) mentorTicketQueue.innerHTML = '<span class="mono-label" style="display: block; text-align: center; opacity: 0.5;">Inbox Zero</span>';
    });
}

btnCancelReply.onclick = () => replyModal.classList.add('view-hidden');
btnSubmitReply.onclick = async () => {
    const replyText = modalReplyInput.value.trim();
    if (!replyText) return alert("Explanation cannot be empty.");
    
    btnSubmitReply.textContent = "Sending...";
    btnSubmitReply.disabled = true;
    
    try {
        await updateDoc(doc(db, "chats", activeTicketId), {
            status: 'resolved',
            mentorId: currentUser.uid,
            mentorName: currentUserData.fullName || "Doctor",
            answer: replyText,
            resolvedAt: serverTimestamp()
        });
        replyModal.classList.add('view-hidden');
    } catch (e) {
        alert("Failed to resolve ticket.");
    } finally {
        btnSubmitReply.textContent = "Resolve & Send";
        btnSubmitReply.disabled = false;
    }
};

// ==========================================
// 3. STUDENT LOGIC
// ==========================================
async function setupStudentView() {
    studentView.style.display = 'block';
    
    const qLive = query(collection(db, "chats"), where("studentId", "==", currentUser.uid));
    onSnapshot(qLive, (snapshot) => {
        let hasActiveLive = false;
        
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.type === 'live' && (data.status === 'pending' || data.status === 'active')) {
                hasActiveLive = true;
                currentChatId = docSnap.id;
                
                if (data.status === 'pending') {
                    studentActionsGrid.style.display = 'none';
                    activeWaitingState.style.display = 'block';
                    liveChatView.style.display = 'none';
                } else if (data.status === 'active') {
                    studentView.style.display = 'none';
                    openChat(docSnap.id, data.mentorName);
                }
            }
        });

        if (!hasActiveLive) {
            studentActionsGrid.style.display = 'grid';
            activeWaitingState.style.display = 'none';
        }
    });

    const qMentors = query(collection(db, "users"), where("isOnline", "==", true));
    onSnapshot(qMentors, (snapshot) => {
        let count = 0;
        snapshot.forEach(d => { if(d.data().role === 'MENTOR' || d.data().role === 'MANAGEMENT') count++; });
        
        onlineCountBadge.textContent = `${count} Doctors Online`;
        if (count === 0) {
            btnRequestLive.disabled = true;
            btnRequestLive.style.opacity = '0.5';
            btnRequestLive.textContent = "No Doctors Online";
        } else {
            btnRequestLive.disabled = false;
            btnRequestLive.style.opacity = '1';
            btnRequestLive.textContent = "Request Live Doctor";
        }
    });

    const qTickets = query(collection(db, "chats"), where("studentId", "==", currentUser.uid));
    onSnapshot(qTickets, (snapshot) => {
        studentInboxList.innerHTML = '';
        const tickets = [];

        snapshot.forEach((docSnap) => {
            if (docSnap.data().type === 'ticket') {
                tickets.push(docSnap.data());
            }
        });

        tickets.sort((a, b) => {
            const tA = a.createdAt ? a.createdAt.toMillis() : 0;
            const tB = b.createdAt ? b.createdAt.toMillis() : 0;
            return tB - tA;
        });

        if (tickets.length === 0) {
            studentInboxList.innerHTML = '<span class="mono-label" style="display: block; text-align: center; opacity: 0.5;">No questions asked yet.</span>';
            return;
        }

        tickets.forEach((data) => {
            const isResolved = data.status === 'resolved';
            const el = document.createElement('div');
            el.className = `ticket-item ${isResolved ? 'resolved' : ''}`;
            
            if (!isResolved) el.style.borderLeftColor = 'var(--accent)';

            el.innerHTML = `
                <div class="mono-label" style="margin-bottom: 0.5rem; color: ${isResolved ? 'var(--status-success)' : 'var(--accent)'};">
                    ${isResolved ? `Answered by ${data.mentorName}` : 'Pending Doctor Review...'}
                </div>
                <div class="ticket-q">Q: ${data.question}</div>
                ${isResolved ? `<div class="ticket-a">A: ${data.answer}</div>` : ''}
            `;
            studentInboxList.appendChild(el);
        });
    });
}

btnRequestLive.onclick = async () => {
    btnRequestLive.disabled = true;
    try {
        await addDoc(collection(db, "chats"), {
            type: 'live',
            status: 'pending',
            studentId: currentUser.uid,
            studentName: currentUserData.fullName || "Student",
            mentorId: null,
            createdAt: serverTimestamp()
        });
    } catch (error) {
        alert("Failed to submit request.");
        btnRequestLive.disabled = false;
    }
};

btnCancelRequest.onclick = async () => {
    if (!currentChatId) return;
    await deleteDoc(doc(db, "chats", currentChatId));
    currentChatId = null;
};

btnSubmitTicket.onclick = async () => {
    const text = ticketInput.value.trim();
    if (!text) return alert("Please enter a question.");
    
    btnSubmitTicket.textContent = "Submitting...";
    btnSubmitTicket.disabled = true;
    
    try {
        await addDoc(collection(db, "chats"), {
            type: 'ticket',
            status: 'open',
            studentId: currentUser.uid,
            studentName: currentUserData.fullName || "Student",
            question: text,
            createdAt: serverTimestamp(),
            mentorId: null 
        });
        ticketInput.value = "";
    } catch (e) {
        alert("Failed to submit ticket.");
    } finally {
        btnSubmitTicket.textContent = "Submit to Queue";
        btnSubmitTicket.disabled = false;
    }
};

// ==========================================
// 4. EPHEMERAL LIVE CHAT ENGINE
// ==========================================
function openChat(chatId, partnerName) {
    currentChatId = chatId;
    chatPartnerName.textContent = partnerName || "Connected";
    
    liveChatView.style.display = 'flex';
    chatMessages.innerHTML = '<div class="mono-label" style="text-align: center; margin-top: auto; opacity: 0.5;">Session Started</div>'; 
    
    if (chatUnsubscribe) chatUnsubscribe();
    
    const q = query(collection(db, "chats", chatId, "messages"), orderBy("timestamp", "asc"));
    
    chatUnsubscribe = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const msg = change.doc.data();
                const isMe = msg.senderId === currentUser.uid;
                const msgDiv = document.createElement('div');
                msgDiv.className = `msg-log ${isMe ? 'msg-sent' : 'msg-received'}`;
                
                const timeString = msg.timestamp ? new Date(msg.timestamp.toMillis()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                const senderName = isMe ? 'You' : (partnerName || "Doctor");

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
        if (!docSnap.exists() || docSnap.data().status === 'ended') {
            alert("The session was ended.");
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

btnEndChat.addEventListener('click', async () => {
    if (!currentChatId) return;
    if (!confirm("End this session? Chat records will be deleted.")) return;
    
    try {
        // Step 1: Update status to trigger the reload alert on the remote client
        await updateDoc(doc(db, "chats", currentChatId), { status: 'ended' });
        
        // Step 2: Wipe messages
        const messagesRef = collection(db, "chats", currentChatId, "messages");
        const snapshot = await getDocs(messagesRef);
        for (const d of snapshot.docs) {
             await deleteDoc(doc(db, "chats", currentChatId, "messages", d.id));
        }
        
        // Step 3: Remove the document
        await deleteDoc(doc(db, "chats", currentChatId));
    } catch(e) {
        console.error("Purge failure:", e);
    }
    
    window.location.reload();
});