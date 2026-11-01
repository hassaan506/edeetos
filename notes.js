import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let allStructuredNotes = [];

function sanitizeFilename(name) {
    if (!name) return "unknown";
    return String(name).toLowerCase().trim().replace(/[\\/*?:"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
}

onAuthStateChanged(auth, async (user) => {
    if (!user) return window.location.href = 'login.html';

    const activeCourse = localStorage.getItem('edeetos_active_course') || 'fcps_part1';

    try {
        const fetchShard = async (folder, docName) => {
            try { 
                const snap = await getDoc(doc(db, "users", user.uid, folder, docName)); 
                return snap.exists() ? snap.data() : {}; 
            } catch(e) { return {}; }
        };

        const [cNot, bNot] = await Promise.all([
            fetchShard(activeCourse, "notes"),
            fetchShard("books", "notes")
        ]);

        let courseNotesRaw = cNot.data || cNot || {};
        let bookNotesRaw = bNot.data || bNot || {};
        
        delete courseNotesRaw['folders'];
        delete bookNotesRaw['folders'];

        const combinedNotesRaw = { ...courseNotesRaw, ...bookNotesRaw };
        const noteKeys = Object.keys(combinedNotesRaw).filter(k => typeof combinedNotesRaw[k] === 'string' && combinedNotesRaw[k].trim() !== '');

        const metaCountEl = document.getElementById('notes-meta-count');
        
        if (noteKeys.length === 0) {
            metaCountEl.textContent = '0 Records Found';
            document.getElementById('notes-content-area').innerHTML = '<div class="loading-state">No notes found. Create notes during practice sessions.</div>';
            return;
        }

        metaCountEl.textContent = 'Fetching Meta...';

        const metaRes = await fetch(`Data/${activeCourse}_metadata.json`, { cache: 'no-cache' });
        let globalMetadata = [];
        if (metaRes.ok) globalMetadata = await metaRes.json();

        const chunksToLoad = new Set();
        const pendingNotesMap = [];

        noteKeys.forEach(qId => {
            const meta = globalMetadata.find(q => String(q.id || q.QuestionID) === qId);
            
            if (meta) {
                const s = sanitizeFilename(meta.Subject || meta.subject || 'Uncategorized');
                const c = sanitizeFilename(meta.Chapter || meta.chapter || 'General');
                chunksToLoad.add(`Data/${activeCourse}/subjects/${s}_${c}.json`);
                
                pendingNotesMap.push({
                    id: qId,
                    note: combinedNotesRaw[qId],
                    subject: meta.Subject || meta.subject || 'Uncategorized',
                    chapter: meta.Chapter || meta.chapter || 'General',
                    topic: meta.Topic || meta.topic || 'General'
                });
            } else {
                pendingNotesMap.push({
                    id: qId,
                    note: combinedNotesRaw[qId],
                    subject: 'Library / Miscellaneous',
                    chapter: 'Book Notes',
                    topic: 'General Reference'
                });
            }
        });

        metaCountEl.textContent = 'Downloading Chunks...';
        
        const activeChunksCache = {};
        const fetchPromises = Array.from(chunksToLoad).map(async (baseUrl) => {
            let page = 1;
            let keepFetching = true;
            while (keepFetching) {
                const pageUrl = baseUrl.replace('.json', `_${page}.json`);
                try {
                    const res = await fetch(pageUrl);
                    if (res.ok) activeChunksCache[pageUrl] = await res.json();
                    else keepFetching = false;
                } catch(e) { keepFetching = false; }
                page++;
            }
        });

        await Promise.all(fetchPromises);

        const fullQuestionsMap = {};
        Object.values(activeChunksCache).forEach(chunkArray => {
            chunkArray.forEach(fullQ => {
                const qId = fullQ.id || fullQ.QuestionID;
                if (qId) fullQuestionsMap[String(qId)] = fullQ;
            });
        });

        allStructuredNotes = pendingNotesMap.map(item => {
            const fullQ = fullQuestionsMap[String(item.id)];
            let questionStem = "Original question text not found in local cache (likely a Book reference).";
            if (fullQ) {
                const rawText = fullQ.question || fullQ.Question || fullQ.text || fullQ.statement || "Visual based question";
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = rawText;
                questionStem = tempDiv.textContent || tempDiv.innerText || rawText;
            }
            return { ...item, stem: questionStem };
        });

        metaCountEl.textContent = `${allStructuredNotes.length} Records Active`;
        renderNotesHierarchy(allStructuredNotes);
        
        const searchBar = document.getElementById('notes-search-bar');
        searchBar.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const filtered = allStructuredNotes.filter(n => 
                n.note.toLowerCase().includes(term) || 
                n.stem.toLowerCase().includes(term) || 
                n.subject.toLowerCase().includes(term) || 
                n.chapter.toLowerCase().includes(term) ||
                n.id.toLowerCase().includes(term)
            );
            renderNotesHierarchy(filtered);
        });

    } catch (e) {
        document.getElementById('notes-content-area').innerHTML = '<div class="loading-state" style="color:var(--danger);">Error syncing database.</div>';
    }
});

function renderNotesHierarchy(notesArray) {
    const container = document.getElementById('notes-content-area');
    container.innerHTML = '';

    if (notesArray.length === 0) {
        container.innerHTML = '<div class="loading-state">No matching notes found.</div>';
        return;
    }

    const tree = {};
    notesArray.forEach(n => {
        if (!tree[n.subject]) tree[n.subject] = {};
        if (!tree[n.subject][n.chapter]) tree[n.subject][n.chapter] = {};
        if (!tree[n.subject][n.chapter][n.topic]) tree[n.subject][n.chapter][n.topic] = [];
        tree[n.subject][n.chapter][n.topic].push(n);
    });

    Object.keys(tree).sort().forEach(subject => {
        const subjDiv = document.createElement('div');
        subjDiv.className = 'subject-group';
        
        const subjTitle = document.createElement('h2');
        subjTitle.className = 'subject-title';
        subjTitle.innerHTML = `<i class="fa-solid fa-folder-open" style="margin-right:12px; font-size: 1.5rem;"></i>${subject}`;
        subjDiv.appendChild(subjTitle);

        Object.keys(tree[subject]).sort().forEach(chapter => {
            const chapDiv = document.createElement('div');
            chapDiv.className = 'chapter-group';
            
            const chapTitle = document.createElement('h3');
            chapTitle.className = 'chapter-title';
            chapTitle.innerHTML = `<i class="fa-solid fa-layer-group" style="margin-right:8px; font-size: 1rem; color: var(--text-muted);"></i>${chapter}`;
            chapDiv.appendChild(chapTitle);

            Object.keys(tree[subject][chapter]).sort().forEach(topic => {
                const topicDiv = document.createElement('div');
                topicDiv.className = 'topic-group';
                
                const topicTitle = document.createElement('h4');
                topicTitle.className = 'topic-title';
                topicTitle.textContent = topic;
                topicDiv.appendChild(topicTitle);

                tree[subject][chapter][topic].forEach(noteObj => {
                    const card = document.createElement('div');
                    card.className = 'note-card';

                    const idDiv = document.createElement('div');
                    idDiv.className = 'note-id';
                    idDiv.textContent = `QID: ${noteObj.id}`;

                    const stemDiv = document.createElement('div');
                    stemDiv.className = 'note-stem';
                    stemDiv.textContent = `"${noteObj.stem}"`;

                    const bodyDiv = document.createElement('div');
                    bodyDiv.className = 'note-body';
                    bodyDiv.textContent = noteObj.note;

                    card.appendChild(idDiv);
                    card.appendChild(stemDiv);
                    card.appendChild(bodyDiv);
                    topicDiv.appendChild(card);
                });
                chapDiv.appendChild(topicDiv);
            });
            subjDiv.appendChild(chapDiv);
        });
        container.appendChild(subjDiv);
    });
}