import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let isUserPremium = false;

// 1. Authenticate and check premium status
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const docSnap = await getDoc(doc(db, "users", user.uid));
        if (docSnap.exists()) {
            isUserPremium = docSnap.data().isPremium || false;
            document.getElementById('vault-user-status').textContent = isUserPremium ? "Premium Access" : "Free Access";
            document.getElementById('vault-user-status').style.background = isUserPremium ? "#ecfdf5" : "#fffbeb";
            loadSyllabus();
        }
    } else {
        window.location.href = 'index.html';
    }
});

// 2. Fetch the JSON Map
async function loadSyllabus() {
    try {
        const response = await fetch('Data/Vault/vault_index.json');
        const syllabus = await response.json();
        renderSidebar(syllabus);
    } catch (error) {
        document.getElementById('vault-sidebar').innerHTML = "<p>Failed to load syllabus.</p>";
    }
}

// 3. Build the Sidebar
function renderSidebar(syllabus) {
    const sidebar = document.getElementById('vault-sidebar');
    sidebar.innerHTML = '';

    syllabus.subjects.forEach(subject => {
        const group = document.createElement('div');
        group.className = 'subject-group';
        group.innerHTML = `<h4>${subject.name}</h4>`;

        subject.topics.forEach(topic => {
            const item = document.createElement('div');
            item.className = 'topic-item';
            
            const lockIcon = (topic.isPremium && !isUserPremium) ? '<i class="fas fa-lock" style="color:#ef4444;"></i>' : '';
            item.innerHTML = `<span>${topic.title}</span> ${lockIcon}`;
            
            item.onclick = () => loadTopicContent(topic);
            group.appendChild(item);
        });

        sidebar.appendChild(group);
    });
}

// 4. Load the Markdown Content
async function loadTopicContent(topic) {
    if (topic.isPremium && !isUserPremium) {
        document.getElementById('vault-premium-modal').style.display = 'flex';
        return;
    }

    const contentArea = document.getElementById('vault-content');
    contentArea.innerHTML = '<p>Loading notes...</p>';

    try {
        const response = await fetch(topic.fileUrl);
        if (!response.ok) throw new Error("File missing");
        
        const markdown = await response.text();
        // Parse Markdown to HTML
        contentArea.innerHTML = marked.parse(markdown);
    } catch (error) {
        contentArea.innerHTML = '<p style="color: red;">Content not available yet.</p>';
    }
}