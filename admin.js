/*
=========================================
INDEX OF FEATURES
=========================================
1. INITIALIZATION & AUTH
2. NAVIGATION & UI ROUTING
3. DASHBOARD / DATABASE OVERVIEW
4. QUESTION COMPILER & GITHUB PUSH
5. USER MANAGER & MIGRATION
6. STUDY ROOMS
7. FRIEND CHALLENGES
8. ASSIGNED EXAMS
9. REWARD CLAIMS
10. PAYMENTS
11. ACCESS KEYS
12. PROMO CODES
13. COURSE CHANGE REQUESTS
14. REPORTED QUESTIONS
15. CONTACT MESSAGES
=========================================
*/

import { auth, db, courseNamesMap, mergedNamesMap } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { collection, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let allUsersData = [];
let unsubRooms, unsubChal, unsubExams, unsubRewards, unsubscribePayments, unsubPromos, unsubReqs, unsubReps, unsubMsgs;

// === HELPER UTILITIES ===
function getUserName(uid) {
    if (!allUsersData.length) return uid; 
    const user = allUsersData.find(u => u.uid === uid);
    return user ? user.fullName : "Unknown User";
}

function updatePendingCount() {
    const q = JSON.parse(localStorage.getItem('edeetos_pending_edits')) || [];
    const cntEl = document.getElementById('admin-pending-count');
    if (cntEl) cntEl.textContent = q.length;
}

// === 1. INITIALIZATION & AUTH ===
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const userRef = doc(db, "users", user.uid);
            const docSnap = await getDoc(userRef);
            const role = docSnap.exists() ? (docSnap.data().role || '').toUpperCase() : '';
            if (role !== 'MANAGEMENT' && role !== 'ADMIN') {
                alert("Unauthorized Access."); window.location.href = 'dashboard.html'; return;
            }
            
            await fetchAllUsers();
            calculateTotalQuestions();
            updatePendingCount();
            
            fetchStudyRooms();
            fetchFriendChallenges();
            fetchAssignedExams();
            fetchRewardClaims();

            const qChats = query(collection(db, "chats"), where("status", "==", "pending"));
            onSnapshot(qChats, (snapshot) => {
                snapshot.docChanges().forEach((change) => {
                    if (change.type === "added") {
                        alert(`🚨 EDEETOS ALERT: Incoming Mentor Request from ${change.doc.data().studentName}! Open the Mentorship Hub.`);
                    }
                });
            });
            
        } catch (error) {
            alert("Database permission error. Check your Firebase Rules.");
        }
    } else {
        window.location.href = 'login.html';
    }
});

// === 2. NAVIGATION & UI ROUTING ===
const sidebar = document.getElementById('admin-sidebar');
document.getElementById('open-mobile-sidebar').onclick = () => sidebar.classList.add('mobile-open');
document.getElementById('close-mobile-sidebar').onclick = () => sidebar.classList.remove('mobile-open');
document.getElementById('btn-exit-admin').onclick = () => window.location.href = 'dashboard.html';

let quillExp, quillHnt;
function initQuillOnce() {
    if (quillExp) return;
    const tb = [['bold', 'italic', 'underline', 'strike'], [{ 'color': [] }, { 'background': [] }], [{ 'list': 'ordered'}, { 'list': 'bullet' }], [{ 'align': [] }], ['clean']];
    quillExp = new Quill('#add-q-exp', { theme: 'snow', modules: { toolbar: tb } });
    quillHnt = new Quill('#add-q-hnt', { theme: 'snow', modules: { toolbar: tb } });
}

window.switchView = function(viewName) {
    document.querySelectorAll('.admin-content').forEach(el => { el.classList.remove('view-active'); el.classList.add('view-hidden'); });
    document.querySelectorAll('.sidebar-link').forEach(t => t.classList.remove('active'));
    
    const targetView = document.getElementById(`view-${viewName}`);
    if (targetView) { targetView.classList.remove('view-hidden'); targetView.classList.add('view-active'); }
    
    const activeTab = document.querySelector(`.sidebar-link[onclick*="${viewName}"]`);
    if (activeTab) activeTab.classList.add('active');

    sidebar.classList.remove('mobile-open');

const routing = {
        'addq': initQuillOnce, 'keys': fetchKeys, 'promos': fetchPromos, 'payments': fetchPayments,
        'requests': fetchRequests, 'reports': fetchReports, 'messages': fetchMessages, 'appeals': fetchAppeals
    };
    if (routing[viewName]) routing[viewName]();
};

// === 3. DASHBOARD / DATABASE OVERVIEW ===
async function calculateTotalQuestions() {
    const standardCourses = ['fcps_part1', 'fcps_part2', 'fcps_imm', 'mrcs_part1', 'mrcs_part2', 'mbbs_year1', 'mbbs_year2', 'mbbs_year3', 'mbbs_year4', 'mbbs_year5'];
    const referenceBooks = [
        { file: "brs_patho", title: "BRS Patho" }, { file: "brs_physio", title: "BRS Physio" }, { file: "doubleAA", title: "Double AA" },
        { file: "firstaid_step1", title: "FA Step 1" }, { file: "firstaid_step2", title: "FA Step 2" },
        { file: "im_medicine", title: "IM Med" }, { file: "im_surgery", title: "IM Surg" }, { file: "im_pathology", title: "IM Path" },
        { file: "im_pediatrics", title: "IM Peds" }, { file: "pretest_surgery", title: "Pretest Surg" },
        { file: "rafiullah", title: "Rafiullah" }, { file: "RWR", title: "Residency" }
    ];

    let totalQuestions = 0;
    let breakdownHtml = `<div style="font-size: 0.8rem; font-weight: 800; color: #64748b; margin-bottom: 8px;">Core Courses</div><div style="display: flex; flex-wrap: wrap; gap: 8px;">`;

    async function fetchAndCount(path, displayTitle, badgeColor, textColor) {
        try {
            const response = await fetch(path, { cache: 'no-cache' });
            if (response.ok) {
                const data = await response.json();
                if (Array.isArray(data) && data.length > 0) {
                    totalQuestions += data.length;
                    breakdownHtml += `<span style="background: ${badgeColor}; color: ${textColor}; padding: 6px 12px; border-radius: 8px; font-weight: bold; border: 1px solid rgba(0,0,0,0.05);">${displayTitle}: ${data.length} Qs</span>`;
                }
            }
        } catch (e) {}
    }

    for (const course of standardCourses) await fetchAndCount(`Data/${course}_metadata.json`, courseNamesMap[course] || course, '#f1f5f9', '#334155');
    breakdownHtml += `</div><div style="margin: 20px 0 8px 0; color: #8b5cf6; font-size: 0.8rem; font-weight: 800;">Reference Books</div><div style="display: flex; flex-wrap: wrap; gap: 8px;">`;
    for (const book of referenceBooks) await fetchAndCount(`Books/${book.file}_questions.json`, book.title, '#ede9fe', '#5b21b6');
    breakdownHtml += `</div>`;

    document.getElementById('total-q-count').innerHTML = `Total Qs: ${totalQuestions.toLocaleString()}`;
    document.getElementById('database-breakdown-content').innerHTML = breakdownHtml;
}

// === 4. QUESTION COMPILER & GITHUB PUSH ===
document.getElementById('btn-save-new-q').onclick = () => {
    const qText = document.getElementById('add-q-txt').value.trim();
    if (!qText) return alert("Question text is required.");

    // Generate a random 8-character alphanumeric ID
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let newId = "";
    for (let i = 0; i < 8; i++) newId += chars.charAt(Math.floor(Math.random() * chars.length));
    
    const targetVal = document.getElementById('add-q-dest').value.split(':');
    const isBook = targetVal[0] === 'BOOK';
    const courseFile = targetVal[1];
    const correctOptNode = document.querySelector('input[name="add-correct-opt"]:checked');

    // Build the row with the new Specialty field included
    const newRow = {
        "QuestionID": newId,
        "Year": document.getElementById('add-q-yr').value.trim(),
        "Specialty": document.getElementById('add-q-spec').value.trim(),
        "Exam": document.getElementById('add-q-exm').value.trim(),
        "Subject": document.getElementById('add-q-sub').value.trim(),
        "Chapter": document.getElementById('add-q-chap').value.trim(),
        "Topic": document.getElementById('add-q-top').value.trim(),
        "Question": qText,
        "OptionA": document.getElementById('add-opt-a').value.trim(),
        "OptionB": document.getElementById('add-opt-b').value.trim(),
        "OptionC": document.getElementById('add-opt-c').value.trim(),
        "OptionD": document.getElementById('add-opt-d').value.trim(),
        "OptionE": document.getElementById('add-opt-e').value.trim(),
        "CorrectAnswer": correctOptNode ? correctOptNode.value : 'A',
        "Explanation": quillExp.root.innerHTML,
        "Hint": quillHnt.root.innerHTML,
        "Difficulty": document.getElementById('add-q-dif').value
    };

    // Save to the pending queue in local storage
    let pendingEditsQueue = JSON.parse(localStorage.getItem('edeetos_pending_edits')) || [];
    pendingEditsQueue.push({ row: newRow, courseFile, isBook });
    localStorage.setItem('edeetos_pending_edits', JSON.stringify(pendingEditsQueue));
    updatePendingCount();
    
    // Clear the form fields (now including 'add-q-spec')
    ['add-q-sub', 'add-q-chap', 'add-q-top', 'add-q-yr', 'add-q-spec', 'add-q-exm', 'add-q-txt', 'add-opt-a', 'add-opt-b', 'add-opt-c', 'add-opt-d', 'add-opt-e'].forEach(id => document.getElementById(id).value = '');
    quillExp.root.innerHTML = ''; 
    quillHnt.root.innerHTML = '';
    document.getElementById('add-q-dif').value = 'medium';
    document.querySelector('input[name="add-correct-opt"][value="A"]').checked = true;

    alert('Question added to queue!');
};

document.getElementById('btn-admin-push').onclick = async () => {
    let pendingQueue = JSON.parse(localStorage.getItem('edeetos_pending_edits')) || [];
    if (pendingQueue.length === 0) return alert("Queue is empty. Nothing to push.");

    let token = localStorage.getItem('edeetos_github_pat');
    if (!token) {
        token = prompt("Please enter your GitHub Personal Access Token:");
        if (!token) return;
        localStorage.setItem('edeetos_github_pat', token);
    }

    const btn = document.getElementById('btn-admin-push');
    const origHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Compiling...';
    btn.disabled = true;

    // Local utilities for generating accurate chunk paths
    const sanitizeFilename = (name) => {
        if (!name) return "unknown";
        return String(name).toLowerCase().trim().replace(/[\\/*?:"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
    };
    
    const parseExamInfo = (examStr, fallbackYear, fallbackSpec) => {
        const parts = String(examStr).split("-").map(p => p.trim());
        let examYear = fallbackYear;
        let examSpec = fallbackSpec;
        if (parts.length >= 2) {
            const prefix = parts[0].toLowerCase();
            if (prefix.includes("surgery")) examSpec = "Surgery & Allied";
            else if (prefix.includes("medicine")) examSpec = "Medicine & Allied";
            else if (prefix.includes("gynecology") || prefix.includes("gyn")) examSpec = "Gynecology & Obstetrics";
            else if (prefix.includes("anesthesia")) examSpec = "Anesthesia";
            else if (prefix.includes("radiology")) examSpec = "Radiology";
            else if (prefix.includes("pathology")) examSpec = "Pathology";
            else examSpec = parts[0];

            const datePart = parts[1];
            if (datePart && datePart.includes("/")) {
                const yy = datePart.split("/").pop().trim();
                if (yy.length === 2) examYear = "20" + yy;
                else if (yy.length === 4) examYear = yy;
            }
        }
        return { examYear, examSpec };
    };

    try {
        const Papa = (await import('https://cdn.jsdelivr.net/npm/papaparse@5.4.1/+esm')).default;
        const { Base64 } = await import('https://cdn.jsdelivr.net/npm/js-base64@3.7.5/+esm');

        const editsByCourse = {};
        pendingQueue.forEach(edit => {
            if (!editsByCourse[edit.courseFile]) editsByCourse[edit.courseFile] = { isBook: edit.isBook, rows: [] };
            editsByCourse[edit.courseFile].rows.push(edit.row);
        });

        const owner = "hassaan506"; const repo = "edeetos"; const branch = "main";
        
        const uploadFileToGitHub = async (filePath, contentStr, commitMsg) => {
            const fileUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
            let currentSha = null;
            try {
                const getRes = await fetch(fileUrl + `?ref=${branch}`, { headers: { "Authorization": `Bearer ${token}` } });
                if (getRes.ok) currentSha = (await getRes.json()).sha;
            } catch(e) {}

            const bodyData = { message: commitMsg, content: Base64.encode(contentStr), branch: branch };
            if (currentSha) bodyData.sha = currentSha;
            const putRes = await fetch(fileUrl, { method: 'PUT', headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(bodyData) });
            if (!putRes.ok) throw new Error(`Failed to upload ${filePath}.`);
        };

        for (const courseFile of Object.keys(editsByCourse)) {
            const isBook = editsByCourse[courseFile].isBook;
            const folder = isBook ? "Books" : "Data";
            const paths = {
                csv: `${folder}/${courseFile}.csv`,
                json: `${folder}/${courseFile}_questions.json`,
                metadata: `${folder}/${courseFile}_metadata.json`,
                hierarchy: `${folder}/${courseFile}_hierarchy.json`
            };
            
            const csvUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${paths.csv}`;
            const getRes = await fetch(csvUrl + `?ref=${branch}`, { headers: { "Authorization": `Bearer ${token}` } });
            if (!getRes.ok) throw new Error(`Failed to fetch ${paths.csv}.`);
            
            const blobRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/blobs/${(await getRes.json()).sha}`, { headers: { "Authorization": `Bearer ${token}` } });
            const cleanCsvText = Base64.decode((await blobRes.json()).content).replace(/^\uFEFF/, '');
            let rows = Papa.parse(cleanCsvText, { header: true, skipEmptyLines: true }).data;

            const affectedChunks = new Set();
            
            const getChunkPaths = (row, cFile) => {
                const paths = [];
                const subj = sanitizeFilename(row["Subject"] || row["subject"]);
                const chap = sanitizeFilename(row["Chapter"] || row["chapter"]);
                paths.push(`Data/${cFile}/subjects/${subj}_${chap}.json`);
                
                if (String(row["Chapter"] || row["chapter"]).toLowerCase().includes('system')) {
                    paths.push(`Data/${cFile}/systems/${chap}_${subj}.json`);
                }
                
                const years = (row["Year"] || row["year"]) ? String(row["Year"] || row["year"]).split(',').map(s=>s.trim()) : [];
                const specs = (row["Specialty"] || row["specialty"]) ? String(row["Specialty"] || row["specialty"]).split(',').map(s=>s.trim()) : [];
                const exams = (row["Exam"] || row["exam"] || row["exams"]) ? String(row["Exam"] || row["exam"] || row["exams"]).split(',').map(s=>s.trim()) : [];
                
                exams.forEach((ex, i) => {
                    if(!ex) return;
                    const fbYear = years[i] !== undefined ? years[i] : (years[years.length-1] || "Unknown Year");
                    const fbSpec = specs[i] !== undefined ? specs[i] : (specs[specs.length-1] || "Unknown Specialty");
                    const parsedEx = parseExamInfo(ex, fbYear, fbSpec); 
                    paths.push(`Data/${cFile}/exams/${sanitizeFilename(parsedEx.examYear)}_${sanitizeFilename(parsedEx.examSpec)}_${sanitizeFilename(ex)}.json`);
                });
                return paths;
            };

            editsByCourse[courseFile].rows.forEach(updatedRow => {
                const qId = updatedRow["QuestionID"];
                const actualIdKey = Object.keys(rows[0] || {}).find(k => k.toLowerCase().replace(/\s/g, '') === 'questionid' || k.toLowerCase() === 'id') || "QuestionID";
                let qIndex = rows.findIndex(r => String(r[actualIdKey]).trim() === String(qId).trim() && String(qId).trim() !== "");
                
                if (qIndex !== -1) {
                    const oldRow = rows[qIndex];
                    if (!isBook) {
                        getChunkPaths(oldRow, courseFile).forEach(p => affectedChunks.add(p));
                        getChunkPaths(updatedRow, courseFile).forEach(p => affectedChunks.add(p));
                    }
                    Object.keys(updatedRow).forEach(newKey => {
                        const originalKey = Object.keys(rows[qIndex]).find(k => k.toLowerCase().replace(/\s/g, '') === newKey.toLowerCase().replace(/\s/g, ''));
                        rows[qIndex][originalKey || newKey] = updatedRow[newKey];
                    });
                } else {
                    if (!isBook) {
                        getChunkPaths(updatedRow, courseFile).forEach(p => affectedChunks.add(p));
                    }
                    rows.push(updatedRow);
                }
            });

            let outQs = [];
            let subTree = {}, sysTree = {}, exTree = {};
            let subject_chunks = {}, system_chunks = {}, exam_chunks = {};

            rows.forEach(row => {
                const getVal = (names) => {
                    const key = Object.keys(row).find(k => names.includes(k.toLowerCase().replace(/\s/g, '')));
                    return key && row[key] ? String(row[key]).trim() : "";
                };
                const qId = getVal(['questionid', 'id']);
                if (!qId) return;

                const subject = getVal(['subject']); const chapter = getVal(['chapter']); const topic = getVal(['topic']);
                const year = getVal(['year']); 
                const rawExams = getVal(['exams', 'exam']);
                const rawSpecs = getVal(['specialty', 'speciality', 'spec']);

                const yearsList = year ? year.split(',').map(e => e.trim()).filter(e => e) : [];
                const examsList = rawExams ? rawExams.split(',').map(e => e.trim()).filter(e => e) : [];
                const specialtyList = rawSpecs ? rawSpecs.split(',').map(e => e.trim()).filter(e => e) : [];

                let qObj = {
                    id: qId, year: yearsList, specialty: specialtyList, exams: examsList, subject: subject, chapter: chapter, topic: topic,
                    difficulty: getVal(['difficulty']), question: getVal(['question']),
                    options: { A: getVal(['optiona']), B: getVal(['optionb']), C: getVal(['optionc']), D: getVal(['optiond']), E: getVal(['optione']) },
                    correctAnswer: getVal(['correctanswer']).toUpperCase(), explanation: getVal(['explanation']), hint: getVal(['hint'])
                };
                if (isBook) { qObj.isBookQuestion = true; qObj.bookName = courseFile; }
                outQs.push(qObj);

                if (subject) {
                    if (!subTree[subject]) subTree[subject] = {};
                    if (chapter) {
                        if (!subTree[subject][chapter]) subTree[subject][chapter] = {};
                        if (topic) subTree[subject][chapter][topic] = (subTree[subject][chapter][topic] || 0) + 1;
                    }
                }
                if (chapter && chapter.toLowerCase().includes('system')) {
                    if (!sysTree[chapter]) sysTree[chapter] = {};
                    if (subject) {
                        if (!sysTree[chapter][subject]) sysTree[chapter][subject] = {};
                        if (topic) sysTree[chapter][subject][topic] = (sysTree[chapter][subject][topic] || 0) + 1;
                    }
                }
                
                examsList.forEach((ex, i) => {
                    const fbYear = yearsList[i] !== undefined ? yearsList[i] : (yearsList[yearsList.length - 1] || "Unknown Year");
                    const fbSpec = specialtyList[i] !== undefined ? specialtyList[i] : (specialtyList[specialtyList.length - 1] || "Unknown Specialty");
                    const parsedEx = parseExamInfo(ex, fbYear, fbSpec);
                    
                    if (!exTree[parsedEx.examYear]) exTree[parsedEx.examYear] = {};
                    if (!exTree[parsedEx.examYear][parsedEx.examSpec]) exTree[parsedEx.examYear][parsedEx.examSpec] = {};
                    if (!exTree[parsedEx.examYear][parsedEx.examSpec][ex]) exTree[parsedEx.examYear][parsedEx.examSpec][ex] = 0;
                    exTree[parsedEx.examYear][parsedEx.examSpec][ex]++;
                });

                // ONLY POPULATE CHUNKS IF THEY WERE AFFECTED BY AN EDIT
                if (!isBook) {
                    const s_clean = sanitizeFilename(subject);
                    const c_clean = sanitizeFilename(chapter);
                    const subj_path = `Data/${courseFile}/subjects/${s_clean}_${c_clean}.json`;
                    
                    if (affectedChunks.has(subj_path)) {
                        if (!subject_chunks[subj_path]) subject_chunks[subj_path] = [];
                        subject_chunks[subj_path].push(qObj);
                    }

                    if (chapter.toLowerCase().includes('system')) {
                        const sys_path = `Data/${courseFile}/systems/${c_clean}_${s_clean}.json`;
                        if (affectedChunks.has(sys_path)) {
                            if (!system_chunks[sys_path]) system_chunks[sys_path] = [];
                            system_chunks[sys_path].push(qObj);
                        }
                    }

                    examsList.forEach((ex, i) => {
                        const fbYear = yearsList[i] !== undefined ? yearsList[i] : (yearsList[yearsList.length - 1] || "Unknown Year");
                        const fbSpec = specialtyList[i] !== undefined ? specialtyList[i] : (specialtyList[specialtyList.length - 1] || "Unknown Specialty");
                        const parsedEx = parseExamInfo(ex, fbYear, fbSpec);
                        
                        const exam_path = `Data/${courseFile}/exams/${sanitizeFilename(parsedEx.examYear)}_${sanitizeFilename(parsedEx.examSpec)}_${sanitizeFilename(ex)}.json`;
                        if (affectedChunks.has(exam_path)) {
                            if (!exam_chunks[exam_path]) exam_chunks[exam_path] = [];
                            exam_chunks[exam_path].push(qObj);
                        }
                    });
                }
            });

            const commitMsg = `Admin Panel: Updated live database & synced micro-chunks`;
            await uploadFileToGitHub(paths.csv, Papa.unparse(rows), commitMsg);
            
            if (isBook) {
                await uploadFileToGitHub(paths.json, JSON.stringify(outQs, null, 4), commitMsg);
            } else {
                const metadataList = outQs.map(q => ({
                    id: q.id, year: q.year, exams: q.exams, subject: q.subject, chapter: q.chapter, topic: q.topic, difficulty: q.difficulty
                }));
                await uploadFileToGitHub(paths.metadata, JSON.stringify(metadataList), commitMsg);
                
                // PUSH AFFECTED CHUNKS DIRECTLY TO GITHUB
                for (const chunkPath of affectedChunks) {
                    let chunkData = subject_chunks[chunkPath] || system_chunks[chunkPath] || exam_chunks[chunkPath] || [];
                    await uploadFileToGitHub(chunkPath, JSON.stringify(chunkData, null, 4), commitMsg);
                }
            }
            
            await uploadFileToGitHub(paths.hierarchy, JSON.stringify({ subjects: subTree, systems: sysTree, exams: exTree }, null, 4), commitMsg);
        }

        localStorage.removeItem('edeetos_pending_edits');
        updatePendingCount();
        alert(`✅ Success! CSV, Metadata, Hierarchy, AND micro-chunks synced to GitHub.`);
    } catch (error) {
        alert("❌ Push Failed: " + error.message);
    } finally {
        btn.innerHTML = origHtml; btn.disabled = false;
    }
};

// === 5. USER MANAGER & MIGRATION ===
async function fetchAllUsers() {
    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        allUsersData = [];
        querySnapshot.forEach((doc) => { let data = doc.data(); data.uid = doc.id; allUsersData.push(data); });
        
        const rolePriority = { 'MANAGEMENT': 1, 'ADMIN': 1, 'MENTOR': 2, 'STUDENT': 3 };
        allUsersData.sort((a, b) => (rolePriority[(a.role || 'STUDENT').toUpperCase()] || 3) - (rolePriority[(b.role || 'STUDENT').toUpperCase()] || 3));

        if(document.getElementById('user-count')) document.getElementById('user-count').textContent = allUsersData.length;
        renderUsers(allUsersData);
    } catch (e) { document.getElementById('users-list').innerHTML = '<p style="color:red; text-align: center;">Error loading users.</p>'; }
}

function renderUsers(arr) {
    const listEl = document.getElementById('users-list');
    listEl.innerHTML = '';
    if (arr.length === 0) return listEl.innerHTML = '<p class="text-center text-muted p-2">No matching users.</p>';

    arr.forEach(user => {
        const role = (user.role || 'STUDENT').toUpperCase();
        let roleHtml = `<span class="ub-role">Student</span>`;
        if (user.isBanned || role === 'BANNED') roleHtml = `<span class="ub-role" style="background:#fee2e2; color:#ef4444;">Banned</span>`;
        else if (role === 'MANAGEMENT' || role === 'ADMIN') roleHtml = `<span class="ub-role" style="background:#475569; color:#f8fafc;">Admin</span>`;
        else if (role === 'MENTOR') roleHtml = `<span class="ub-role" style="background:#b45309; color:#f8fafc;">Mentor</span>`;
        
        let coursesHtml = '';
        if (user.subscriptions) {
            Object.keys(user.subscriptions).forEach(courseKey => {
                const expiry = user.subscriptions[courseKey];
                const expiryText = expiry === "lifetime" ? "Lifetime" : new Date(expiry).toLocaleDateString();
                coursesHtml += `<span class="ub-course">${mergedNamesMap[courseKey] || courseKey}</span> <span class="ub-date">${expiryText}</span> `;
            });
        }

        const card = document.createElement('div');
        card.className = "user-list-item";
        card.innerHTML = `
            <div class="user-name">${user.fullName || "Unnamed User"}</div>
            <div class="user-contact">${user.email} <span style="opacity: 0.5; margin: 0 5px;">|</span> ${user.phone || 'No Phone'}</div>
            <div class="user-badges-container">${roleHtml} ${coursesHtml}</div>
        `;
        card.onclick = () => openEditModal(user);
        listEl.appendChild(card);
    });
}

document.getElementById('admin-search-btn').onclick = () => {
    const query = document.getElementById('admin-search-input').value.toLowerCase().trim();
    if (!query) return renderUsers(allUsersData);
    renderUsers(allUsersData.filter(u => (u.fullName||"").toLowerCase().includes(query) || (u.email||"").toLowerCase().includes(query) || u.uid.toLowerCase().includes(query)));
};

if (document.getElementById('btn-fix-usernames')) {
    document.getElementById('btn-fix-usernames').addEventListener('click', async (e) => {
        const btn = e.target;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Migrating...'; btn.disabled = true;
        try {
            const usersSnap = await getDocs(collection(db, "users"));
            let count = 0;
            for (const userDoc of usersSnap.docs) {
                const data = userDoc.data();
                if (data.username && data.email) {
                    await setDoc(doc(db, "username_lookup", data.username.toLowerCase().trim()), { email: data.email, userId: userDoc.id });
                    count++;
                }
            }
            alert(`Migrated ${count} usernames.`);
        } catch (error) { alert("Migration failed."); } 
        finally { btn.innerHTML = '<i class="fas fa-tools mr-1"></i> Migrate Old Usernames'; btn.disabled = false; }
    });
}

// User Modal Logic
let editingUser = null;
const editModal = document.getElementById('edit-user-modal');
document.getElementById('btn-close-edit-modal').onclick = () => editModal.style.display = 'none';

function openEditModal(user) {
    editingUser = user;
    document.getElementById('edit-user-name').textContent = user.fullName || "Unnamed User";
    document.getElementById('edit-user-email').textContent = user.email || "No Email";
    document.getElementById('edit-user-phone').textContent = user.phone || "No Phone";
    document.getElementById('edit-user-uid').textContent = `ID: ${user.uid}`;
    
    const isSuperAdmin = user.uid === 'KpNtNoeNVveHO9Ga2Kc9dxuhvZp2';
    const isSelf = auth.currentUser && user.uid === auth.currentUser.uid;
    const btns = ['btn-make-student', 'btn-make-mentor', 'btn-make-admin', 'btn-hard-delete-user', 'btn-ban-user', 'btn-unban-user'].map(id => document.getElementById(id));

    if (isSuperAdmin || isSelf) {
        btns.forEach(b => { if(b) b.style.display = 'none'; });
    } else {
        btns.slice(0, 4).forEach(b => { if(b) b.style.display = 'block'; });
        if (user.isBanned || user.role === 'BANNED') { btns[4].style.display = 'none'; btns[5].style.display = 'block'; } 
        else { btns[4].style.display = 'block'; btns[5].style.display = 'none'; }
    }
    renderSubscriptions(); editModal.style.display = 'flex';
}

async function changeUserRole(newRole) {
    if(confirm(`Change to ${newRole}?`)) {
        await updateDoc(doc(db, "users", editingUser.uid), { role: newRole });
        editingUser.role = newRole; alert(`Role updated.`); fetchAllUsers();
    }
}
document.getElementById('btn-make-student').onclick = () => changeUserRole('STUDENT');
document.getElementById('btn-make-mentor').onclick = () => changeUserRole('MENTOR');
document.getElementById('btn-make-admin').onclick = () => changeUserRole('MANAGEMENT');

document.getElementById('btn-ban-user').onclick = async () => {
    if (confirm(`🚨 BAN user?`)) { await updateDoc(doc(db, "users", editingUser.uid), { role: 'BANNED', isBanned: true }); alert("Banned."); editModal.style.display = 'none'; fetchAllUsers(); }
};
document.getElementById('btn-unban-user').onclick = async () => {
    if (confirm(`✅ UNBAN user?`)) { await updateDoc(doc(db, "users", editingUser.uid), { role: 'STUDENT', isBanned: false }); alert("Unbanned."); editModal.style.display = 'none'; fetchAllUsers(); }
};
document.getElementById('btn-hard-delete-user').onclick = async () => {
    if (prompt(`Type DELETE to permanently erase ${editingUser.email}`) === 'DELETE') {
        try { 
            await deleteDoc(doc(db, "users", editingUser.uid)); 
            if (editingUser.username) {
                await deleteDoc(doc(db, "username_lookup", editingUser.username.toLowerCase().trim()));
            }
            alert("Database record wiped completely. NOTE: To fully sever access, you must also delete their login credential from the Firebase Authentication console."); 
            editModal.style.display = 'none'; 
            fetchAllUsers(); 
        } catch(e) { alert(e.message); }
    }
};

document.getElementById('btn-wipe-progress').onclick = async () => {
    if (prompt(`Type WIPE to delete ALL study progress for ${editingUser.email}`) === 'WIPE') {
        try {
            const uRef = doc(db, "users", editingUser.uid);
            const data = (await getDoc(uRef)).data();
            let updates = {};
            ['fcps_part1', 'fcps_part2', 'fcps_imm', 'mrcs_part1', 'mrcs_part2', 'mbbs_year1', 'mbbs_year2', 'mbbs_year3', 'mbbs_year4', 'mbbs_year5', 'books'].forEach(c => {
                if(data[c]) { updates[`${c}.solvedQuestions`] = []; updates[`${c}.mistakes`] = []; updates[`${c}.examMistakes`] = []; updates[`${c}.bookmarks`] = []; updates[`${c}.examHistory`] = []; updates[`${c}.revisions`] = {}; }
            });
            if(Object.keys(updates).length > 0) { await updateDoc(uRef, updates); alert("Wiped."); }
        } catch(e) { alert(e.message); }
    }
};

function renderSubscriptions() {
    const list = document.getElementById('user-subscriptions-list');
    list.innerHTML = '';
    if (!editingUser.subscriptions || Object.keys(editingUser.subscriptions).length === 0) return list.innerHTML = '<p class="text-muted">No active subscriptions.</p>';

    Object.keys(editingUser.subscriptions).forEach(courseKey => {
        const expiry = editingUser.subscriptions[courseKey];
        const isExpired = (expiry !== "lifetime" && new Date(expiry) < new Date());
        const box = document.createElement('div');
        box.className = `subs-box ${isExpired ? '' : 'active-sub'}`;
        box.innerHTML = `
            <div><strong style="color:#1e293b;">${mergedNamesMap[courseKey] || courseKey.toUpperCase()}</strong><br><small style="color:#64748b;">${isExpired ? 'Expired' : 'Active till ' + (expiry === "lifetime" ? "Lifetime" : new Date(expiry).toLocaleDateString())}</small></div>
            <button class="btn-action-del"><i class="fas fa-trash-alt"></i></button>
        `;
        box.querySelector('.btn-action-del').onclick = async () => {
            if(confirm(`Remove access?`)) {
                let newSubs = { ...editingUser.subscriptions }; delete newSubs[courseKey];
                await updateDoc(doc(db, "users", editingUser.uid), { subscriptions: newSubs });
                editingUser.subscriptions = newSubs; renderSubscriptions(); fetchAllUsers();
            }
        };
        list.appendChild(box);
    });
}

document.getElementById('btn-grant-access').onclick = async () => {
    const btn = document.getElementById('btn-grant-access'); btn.textContent = "Processing..."; btn.disabled = true;
    try {
        const course = document.getElementById('grant-course').value;
        const days = document.getElementById('grant-duration').value;
        let subs = { ...(editingUser.subscriptions || {}) };
        let expiry = "lifetime";
        
        if (days !== "lifetime") { 
            let startDate = new Date();
            if (subs[course] && subs[course] !== "lifetime" && new Date(subs[course]) > startDate) startDate = new Date(subs[course]);
            startDate.setDate(startDate.getDate() + parseInt(days)); expiry = startDate.toISOString(); 
        }
        subs[course] = expiry;
        await updateDoc(doc(db, "users", editingUser.uid), { subscriptions: subs, isPremium: true });
        editingUser.subscriptions = subs; editingUser.isPremium = true;
        const userIndex = allUsersData.findIndex(u => u.uid === editingUser.uid);
        if (userIndex !== -1) { allUsersData[userIndex].subscriptions = subs; allUsersData[userIndex].isPremium = true; }
        renderSubscriptions(); alert(`Access granted.`);
    } catch (e) { alert("Failed."); } finally { btn.textContent = "Grant Access"; btn.disabled = false; }
};


// === 6. STUDY ROOMS ===
function fetchStudyRooms() {
    if(unsubRooms) return;
    unsubRooms = onSnapshot(collection(db, "study_rooms"), (snap) => {
        const list = document.getElementById('studyrooms-list');
        if(!list) return; list.innerHTML = '';
        if(snap.empty) return list.innerHTML = '<tr><td colspan="5" class="table-loading">No active rooms.</td></tr>';
        
        snap.forEach(d => {
            const data = d.data();
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${d.id}</strong></td>
                <td>${courseNamesMap[data.course] || data.course || 'Unknown'}</td>
                <td>${getUserName(data.hostId)}</td>
                <td><span class="badge ${data.status === 'ended' ? 'b-student' : 'b-admin'}">${data.status}</span></td>
                <td>
                    <button class="btn-action-del btn-end-room" ${data.status === 'ended' ? 'disabled style="opacity:0.5;"' : ''}>End</button>
                    <button class="btn-action-del btn-del-room" style="color: #64748b; border-color: #cbd5e1; margin-left: 5px;"><i class="fas fa-trash"></i></button>
                </td>
            `;
            tr.querySelector('.btn-end-room').onclick = () => updateDoc(doc(db, "study_rooms", d.id), { status: 'ended' });
            tr.querySelector('.btn-del-room').onclick = () => { if(confirm("Delete room completely?")) deleteDoc(doc(db, "study_rooms", d.id)); };
            list.appendChild(tr);
        });
    });
}

// === 7. FRIEND CHALLENGES ===
function fetchFriendChallenges() {
    if(unsubChal) return;
    unsubChal = onSnapshot(collection(db, "friend_challenges"), (snap) => {
        const list = document.getElementById('challenges-list');
        if(!list) return; list.innerHTML = '';
        if(snap.empty) return list.innerHTML = '<tr><td colspan="6" class="table-loading">No challenges found.</td></tr>';
        
        snap.forEach(d => {
            const data = d.data();
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${d.id}</strong></td>
                <td>${data.hostName}</td>
                <td><span class="badge b-time">${data.total || '?'} Qs (${data.calcMinutes || '?'} Min)</span></td>
                <td><span class="badge b-course">${data.attemptedBy ? data.attemptedBy.length : (data.attempts || 0)} Attempt(s)</span></td>
                <td>${data.score} / ${data.total}</td>
                <td><button class="btn-action-del btn-del-chal">Delete</button></td>
            `;
            tr.querySelector('.btn-del-chal').onclick = () => { if(confirm("Delete challenge?")) deleteDoc(doc(db, "friend_challenges", d.id)); };
            list.appendChild(tr);
        });
    });
}

// === 8. ASSIGNED EXAMS ===
function fetchAssignedExams() {
    if(unsubExams) return;
    unsubExams = onSnapshot(collection(db, "assigned_exams"), (snap) => {
        const list = document.getElementById('assigned-list');
        if(!list) return; list.innerHTML = '';
        if(snap.empty) return list.innerHTML = '<tr><td colspan="5" class="table-loading">No assigned exams.</td></tr>';
        
        snap.forEach(d => {
            const data = d.data();
            let studentsHtml = '';
            (data.assignedTo || []).forEach(uid => {
                const sName = getUserName(uid);
                const isDone = (data.isCompletedBy || []).includes(uid);
                let scoreText = `<span style="color:#f59e0b; font-weight:bold; font-size:0.75rem;">Pending</span>`;
                
                if (isDone) {
                    let foundScore = null;
                    const sDoc = allUsersData.find(u => u.uid === uid);
                    if (sDoc) {
                        const allHist = [];
                        Object.keys(sDoc).forEach(k => { if (sDoc[k] && sDoc[k].examHistory) allHist.push(...sDoc[k].examHistory); });
                        const match = allHist.reverse().find(ex => ex.examName === data.title);
                        if (match) foundScore = `${match.percentage}% (${match.score}/${match.totalQuestions})`;
                    }
                    scoreText = `<span style="color:#10b981; font-weight:bold; font-size:0.75rem;">Done ${foundScore ? '- ' + foundScore : ''}</span>`;
                }
                studentsHtml += `<div class="flex-between bg-white border-slate p-05 border-radius-6px mb-05 font-sm"><span>${sName}</span> ${scoreText}</div>`;
            });

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${data.title}</strong><div class="text-muted font-sm mt-05">${data.questions?.length || 0} Qs | ${data.timerMinutes} Min</div></td>
                <td>${getUserName(data.assignedBy)}</td>
                <td style="min-width: 250px;">${studentsHtml || '<span class="text-muted">No students</span>'}</td>
                <td>${data.createdAt ? data.createdAt.toDate().toLocaleDateString() : 'N/A'}</td>
                <td><button class="btn-action-del btn-del-exam">Delete</button></td>
            `;
            tr.querySelector('.btn-del-exam').onclick = () => { if(confirm("Delete exam assignment?")) deleteDoc(doc(db, "assigned_exams", d.id)); };
            list.appendChild(tr);
        });
    });
}

function fetchRewardClaims() {
    if(unsubRewards) return;
    unsubRewards = onSnapshot(collection(db, "reward_claims"), (snap) => {
        const list = document.getElementById('rewards-list');
        if(!list) return; list.innerHTML = '';
        let hasClaims = false;
        
        snap.forEach(d => {
            const data = d.data();
            if(data.status !== 'pending') return;
            hasClaims = true;
            
            const reqUser = allUsersData.find(u => u.uid === data.userId);
            const userName = reqUser ? reqUser.fullName : "Unknown User";
            const userEmail = data.userEmail || (reqUser ? reqUser.email : data.userId);
            
            const card = document.createElement('div');
            card.className = "action-card";
            card.innerHTML = `
                <div class="flex-between mb-10px">
                    <div>
                        <strong style="font-size: 1.1rem;">${userName}</strong>
                        <div class="font-sm text-muted">${userEmail}</div>
                    </div>
                    <span class="badge b-mentor">${data.rewardTitle || 'Reward'}</span>
                </div>
                <p class="text-muted font-sm">Requested Item: <strong style="color: #f8fafc;">${mergedNamesMap[data.requestedItem] || data.requestedItem}</strong></p>
                <div class="flex-gap-10px mt-15px">
                    <button class="btn-solid btn-approve-claim">Approve & Grant Access</button>
                    <button class="btn-outline btn-reject-claim border-danger text-danger">Reject / Delete</button>
                </div>
            `;
            card.querySelector('.btn-approve-claim').onclick = async () => {
                const btn = card.querySelector('.btn-approve-claim'); btn.textContent = "Processing..."; btn.disabled = true;
                try {
                    const uRef = doc(db, "users", data.userId);
                    const uSnap = await getDoc(uRef);
                    if(uSnap.exists()) {
                        let subs = uSnap.data().subscriptions || {};
                        let days = prompt(`Approve access to ${data.requestedItem}? Enter number of days (or 'lifetime'):`, "30");
                        if(days) {
                            subs[data.requestedItem] = days === "lifetime" ? "lifetime" : new Date(new Date().setDate(new Date().getDate() + parseInt(days))).toISOString();
                            await updateDoc(uRef, { subscriptions: subs, isPremium: true });
                            await updateDoc(doc(db, "reward_claims", d.id), { status: 'approved' });
                            alert("Claim approved.");
                        } else { btn.textContent = "Approve & Grant Access"; btn.disabled = false; }
                    }
                } catch(e) { alert(e.message); btn.textContent = "Approve & Grant Access"; btn.disabled = false; }
            };
            card.querySelector('.btn-reject-claim').onclick = async () => { if(confirm("Reject claim?")) await deleteDoc(doc(db, "reward_claims", d.id)); };
            list.appendChild(card);
        });
        if(!hasClaims) list.innerHTML = '<p class="table-loading">No pending claims.</p>';
    });
}

document.getElementById('btn-manual-reward').onclick = () => {
    const email = prompt("Enter the exact email of the user to reward:");
    if (!email) return;
    const user = allUsersData.find(u => (u.email || "").toLowerCase() === email.toLowerCase());
    if (!user) return alert("User not found in database.");
    
    const item = prompt("Enter the exact database key to grant (e.g. 'firstaid_step1' or 'fcps_part1'):");
    if (!item) return;
    
    const days = prompt("Enter days to grant (or 'lifetime'):", "30");
    if (!days) return;
    
    const uRef = doc(db, "users", user.uid);
    let subs = user.subscriptions || {};
    subs[item] = days === "lifetime" ? "lifetime" : new Date(new Date().setDate(new Date().getDate() + parseInt(days))).toISOString();
    
    updateDoc(uRef, { subscriptions: subs, isPremium: true }).then(() => {
        alert(`Reward granted successfully to ${user.fullName} (${user.email}).`);
        fetchAllUsers();
    }).catch(e => alert("Error: " + e.message));
};

// === 10. PAYMENTS ===
document.getElementById('btn-close-receipt').onclick = () => document.getElementById('receipt-modal').style.display = 'none';

function fetchPayments() {
    const list = document.getElementById('payments-list');
    if(!list || unsubscribePayments) return;

    const durMap = { "1": 0, "7": 1, "15": 2, "30": 3, "90": 4, "180": 5, "365": 6, "lifetime": 7 };
    const baseC = [100, 500, 800, 1200, 2500, 3500, 4500, 5000];
    const baseB = [20, 50, 80, 120, 250, 350, 450, 500];

    unsubscribePayments = onSnapshot(collection(db, "payment_requests"), (qSnap) => {
        list.innerHTML = '';
        let hasPending = false;
        
        qSnap.forEach(d => {
            const data = d.data();
            if(data.status !== 'pending') return;
            hasPending = true;

            const cCount = (data.courses || []).length;
            const bCount = (data.books || []).length;
            const idx = durMap[data.durationDays] !== undefined ? durMap[data.durationDays] : 7;
            const bDisc = bCount >= 5 ? 0.3 : (bCount >= 3 ? 0.2 : (bCount >= 2 ? 0.1 : 0));

            let baseTotal = (cCount > 0 ? baseC[idx] : 0) + (bCount * baseB[idx]);
            let bookDiscountAmount = Math.round((bCount * baseB[idx]) * bDisc);
            let subtotal = baseTotal - bookDiscountAmount;
            let expectedTotal = subtotal;
            
            let promoHtml = '';
            if (data.appliedPromoCode && data.promoDiscountApplied > 0) {
                let promoAmount = Math.round(subtotal * (data.promoDiscountApplied / 100));
                expectedTotal = subtotal - promoAmount;
                promoHtml = `<div style="color: #fca5a5; font-weight: bold; margin-top: 5px; font-size: 0.9rem;">Promo (${data.appliedPromoCode}): -Rs. ${promoAmount.toLocaleString()} (${data.promoDiscountApplied}%)</div>`;
            }

            const card = document.createElement('div');
            card.className = "action-card";
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 15px; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;">
                    <div style="font-weight: 800; font-size: 1.2rem; color: #f8fafc;">${data.userEmail}</div>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        ${(data.courses || []).map(c => `<span style="background: rgba(14, 165, 233, 0.2); color: #bae6fd; padding: 4px 10px; border-radius: 6px; font-size: 0.8rem; font-weight: bold;">${c.replace('_', ' ').toUpperCase()}</span>`).join('')}
                        ${(data.books || []).map(b => `<span style="background: rgba(168, 85, 247, 0.2); color: #d8b4fe; padding: 4px 10px; border-radius: 6px; font-size: 0.8rem; font-weight: bold;">${b.replace('_', ' ').toUpperCase()}</span>`).join('')}
                    </div>
                </div>
                <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); margin-bottom: 15px;">
                    <div style="color: #94a3b8; font-size: 0.85rem; font-weight: bold; text-transform: uppercase; margin-bottom: 10px;">Requested Plan: <span style="color: #f8fafc;">${data.durationDays} Days (${data.planName})</span></div>
                    <div style="color: #94a3b8; font-size: 0.9rem; margin-bottom: 5px;">Base Price: Rs. ${baseTotal.toLocaleString()}</div>
                    ${bookDiscountAmount > 0 ? `<div style="color: #6ee7b7; font-size: 0.9rem; margin-bottom: 5px;">Bundle Discount: -Rs. ${bookDiscountAmount.toLocaleString()}</div>` : ''}
                    ${promoHtml}
                    <div style="color: #34d399; font-size: 1.8rem; font-weight: 900; margin-top: 10px; border-top: 1px dashed rgba(255,255,255,0.2); padding-top: 10px;">Final Total: Rs. ${expectedTotal.toLocaleString()}</div>
                </div>
                ${data.receiptUrl ? `<div style="text-align: center; margin: 15px 0;"><img src="${data.receiptUrl}" style="max-height: 150px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2);"><div style="margin-top: 10px;"><span class="view-receipt-trigger" style="color: #34d399; font-weight: bold; cursor: pointer;"><i class="fas fa-search"></i> View Full Receipt</span></div></div>` : `<div style="color: #fca5a5; font-weight: bold; margin-bottom: 15px;">No Receipt Attached</div>`}
                <div style="display: flex; gap: 15px; background: rgba(0,0,0,0.2); padding: 15px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); flex-wrap: wrap;">
                    <div style="flex: 1; min-width: 150px;">
                        <label style="display: block; font-size: 0.8rem; color: #94a3b8; font-weight: bold; margin-bottom: 8px;">Approve Duration:</label>
                        <select class="approve-duration" style="width: 100%; padding: 10px; background: rgba(0,0,0,0.5); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px;">
                            <option value="${data.durationDays}">${data.planName}</option>
                            <option value="30">1 Month</option><option value="365">1 Year</option><option value="lifetime">Lifetime</option>
                        </select>
                    </div>
                    <div style="flex: 1; min-width: 200px; display: flex; gap: 10px; align-items: flex-end;">
                        <button class="btn-solid btn-approve" style="flex: 1; padding: 10px;">Approve</button>
                        <button class="btn-outline btn-reject" style="flex: 1; padding: 10px; border-color: #ef4444; color: #fca5a5 !important;">Reject</button>
                    </div>
                </div>
            `;
if (card.querySelector('.view-receipt-trigger')) {
                card.querySelector('.view-receipt-trigger').onclick = () => { document.getElementById('receipt-modal-img').src = data.receiptUrl; document.getElementById('receipt-modal').style.display = 'flex'; };
            }

            card.querySelector('.btn-approve').onclick = async () => {
                try {
                    const dur = card.querySelector('.approve-duration').value;
                    const uRef = doc(db, "users", data.userId);
                    const uSnap = await getDoc(uRef);
                    if(!uSnap.exists()) return alert("User not found.");

                    let exp = dur === "lifetime" ? "lifetime" : new Date(new Date().setDate(new Date().getDate() + parseInt(dur))).toISOString();
                    let currentSubs = uSnap.data().subscriptions || {};
                    (data.courses || []).forEach(c => currentSubs[c] = exp);
                    (data.books || []).forEach(b => currentSubs[b] = exp);

                    await updateDoc(uRef, { subscriptions: currentSubs, isPremium: true });
                    await updateDoc(doc(db, "payment_requests", d.id), { status: 'approved' });
                    alert("Payment approved!");
                } catch (e) { alert("Error approving payment"); }
            };

            card.querySelector('.btn-reject').onclick = async () => { if(confirm("Reject?")) await updateDoc(doc(db, "payment_requests", d.id), { status: 'rejected' }); };
            list.appendChild(card);
        });
        if(!hasPending) list.innerHTML = '<p class="table-loading">No pending requests.</p>';
    });
}

function fetchAppeals() {
    onSnapshot(collection(db, "ban_appeals"), (qSnap) => {
        const list = document.getElementById('appeals-list');
        if(!list) return; list.innerHTML = '';
        let hasAppeals = false;

        qSnap.forEach(d => {
            const data = d.data();
            if(data.status !== 'pending') return;
            hasAppeals = true;

            const card = document.createElement('div');
            card.className = "action-card";
            card.innerHTML = `
                <div class="flex-between mb-10px">
                    <strong style="font-size: 1.1rem; color: #f8fafc;">${data.userEmail}</strong> 
                    <span class="text-muted font-sm">${data.timestamp ? data.timestamp.toDate().toLocaleDateString() : 'Unknown Date'}</span>
                </div>
                <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); margin-top: 10px;">
                    <p style="margin: 0; color: #cbd5e1;"><strong>Reason provided:</strong><br>${data.appealText}</p>
                </div>
                <div style="display: flex; gap: 15px; margin-top: 15px;">
                    <button class="btn-solid bg-success btn-unban" style="flex: 1; padding: 10px; border: none; border-radius: 8px;">Unban User & Email</button>
                    <button class="btn-outline btn-keep-banned" style="flex: 1; padding: 10px; border: 1px solid #ef4444; color: #fca5a5 !important; border-radius: 8px;">Keep Banned & Email</button>
                </div>
            `;
            
            card.querySelector('.btn-unban').onclick = async () => {
                await updateDoc(doc(db, "users", data.userId), { isBanned: false, role: 'STUDENT' });
                await updateDoc(doc(db, "ban_appeals", d.id), { status: 'unbanned' });
                const body = `Hello,\n\nWe have reviewed your appeal and your account has been successfully unbanned. You may now log in and continue your studies on Edeetos.\n\nRegards,\nEdeetos Administration`;
                window.location.href = `mailto:${data.userEmail}?subject=Account Unbanned - Edeetos&body=${encodeURIComponent(body)}`;
            };
            
            card.querySelector('.btn-keep-banned').onclick = async () => {
                await updateDoc(doc(db, "ban_appeals", d.id), { status: 'rejected' });
                const body = `Hello,\n\nAfter reviewing your appeal, our administration team has decided to uphold your suspension. Your account will remain banned.\n\nRegards,\nEdeetos Administration`;
                window.location.href = `mailto:${data.userEmail}?subject=Appeal Update - Edeetos&body=${encodeURIComponent(body)}`;
            };
            
            list.appendChild(card);
        });
        if(!hasAppeals) list.innerHTML = '<p class="table-loading">No pending appeals.</p>';
    });
}

// === 11. ACCESS KEYS ===
document.getElementById('btn-generate-key').onclick = async function() {
    const btn = this; btn.textContent = "Generating..."; btn.disabled = true;
    const course = document.getElementById('key-course').value;
    const duration = document.getElementById('key-duration').value;
    const usage = parseInt(document.getElementById('key-usage').value) || 1;
    const expiry = document.getElementById('key-expiry').value;
    let code = document.getElementById('key-custom').value.trim().toUpperCase() || "KEY-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    const books = Array.from(document.querySelectorAll('.key-book-check:checked')).map(cb => cb.value);

    try {
        await setDoc(doc(db, "keys", code), { code, course, books, duration, maxUsage: usage, usedCount: 0, expiryDate: expiry || null, createdAt: new Date().toISOString() });
        alert("Key Generated: " + code);
        document.getElementById('key-custom').value = ''; document.querySelectorAll('.key-book-check').forEach(cb => cb.checked = false); fetchKeys();
    } catch(e) { alert("Error generating key."); } finally { btn.textContent = "Generate Key"; btn.disabled = false; }
};

async function fetchKeys() {
    const qSnap = await getDocs(collection(db, "keys"));
    const tbody = document.getElementById('keys-table-body');
    if(!tbody) return; tbody.innerHTML = '';
    qSnap.forEach(d => {
        const data = d.data();
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${data.code}</strong></td>
            <td><span class="badge b-course">${mergedNamesMap[data.course] || data.course}</span>${data.books?.length ? `<div class="font-sm text-muted mt-05">+ Books: ${data.books.join(', ')}</div>` : ''}</td>
            <td>${data.usedCount} / ${data.maxUsage}</td>
            <td><button class="btn-action-del" onclick="deleteDoc(doc(db, 'keys', '${data.code}')); this.closest('tr').remove();">Delete</button></td>
        `;
        tbody.appendChild(tr);
    });
}

// === 12. PROMO CODES ===
document.getElementById('btn-generate-promo').onclick = async function() {
    const code = document.getElementById('promo-code').value.trim().toUpperCase();
    const discount = parseInt(document.getElementById('promo-discount').value);
    const expiry = document.getElementById('promo-expiry').value;
    if (!code || isNaN(discount) || discount <= 0 || discount > 100) return alert("Enter valid code and %.");
    await setDoc(doc(db, "promo_codes", code), { code, discountPercentage: discount, isActive: true, expiryDate: expiry || null, createdAt: new Date().toISOString() });
    alert("Promo Created."); document.getElementById('promo-code').value = ''; document.getElementById('promo-discount').value = '';
};

async function fetchPromos() {
    if (unsubPromos) return;
    unsubPromos = onSnapshot(collection(db, "promo_codes"), (qSnap) => {
        const tbody = document.getElementById('promos-table-body');
        if(!tbody) return; tbody.innerHTML = '';
        if(qSnap.empty) return tbody.innerHTML = '<tr><td colspan="4" class="table-loading">No promos.</td></tr>';
        
        qSnap.forEach(d => {
            const data = d.data();
            const isExp = (data.expiryDate && new Date(data.expiryDate) < new Date());
            const badge = data.isActive && !isExp ? `<span class="badge bg-success text-white">Active</span>` : `<span class="badge bg-danger text-white">${isExp?'Expired':'Inactive'}</span>`;
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${data.code}</strong></td>
                <td><strong class="text-success">${data.discountPercentage}% OFF</strong></td>
                <td>${badge} <small class="text-muted d-block">Exp: ${data.expiryDate ? new Date(data.expiryDate).toLocaleDateString() : 'None'}</small></td>
                <td>
                    <button class="btn-action-del btn-toggle border-warning text-warning"><i class="fas fa-power-off"></i></button>
                    <button class="btn-action-del btn-del"><i class="fas fa-trash-alt"></i></button>
                </td>
            `;
            tr.querySelector('.btn-toggle').onclick = () => updateDoc(doc(db, "promo_codes", data.code), { isActive: !data.isActive });
            tr.querySelector('.btn-del').onclick = () => { if(confirm("Delete promo?")) deleteDoc(doc(db, "promo_codes", data.code)); };
            tbody.appendChild(tr);
        });
    });
}

// === 13. COURSE CHANGE REQUESTS ===
async function fetchRequests() {
    if (unsubReqs) return;
    unsubReqs = onSnapshot(query(collection(db, "users"), where("courseChangeRequested", "==", true)), (qSnap) => {
        const list = document.getElementById('requests-list');
        if(!list) return; list.innerHTML = '';
        if(qSnap.empty) return list.innerHTML = '<p class="table-loading">No requests.</p>';
        
        qSnap.forEach(d => {
            const data = d.data();
            const card = document.createElement('div');
            card.className = 'action-card';
            card.innerHTML = `
                <div class="font-bold text-lg">${data.fullName} <span class="font-sm font-normal text-muted">(${data.email})</span></div>
                <div class="my-15px bg-slate-50 p-10px border-radius-8px">
                    <span class="font-bold text-danger">${courseNamesMap[data.selectedCourse] || data.selectedCourse || 'None'}</span> 
                    <i class="fas fa-arrow-right mx-10px text-slate-300"></i> 
                    <span class="font-bold text-success">${courseNamesMap[data.requestedCourse] || data.requestedCourse}</span>
                </div>
                <div class="flex-gap-10px"><button class="btn-solid btn-app">Approve</button><button class="btn-outline btn-rej border-danger text-danger">Reject</button></div>
            `;
            card.querySelector('.btn-app').onclick = () => updateDoc(doc(db, "users", d.id), { selectedCourse: data.requestedCourse, courseChangeRequested: false, requestedCourse: null });
            card.querySelector('.btn-rej').onclick = () => updateDoc(doc(db, "users", d.id), { courseChangeRequested: false, requestedCourse: null });
            list.appendChild(card);
        });
    });
}

// === 14. REPORTED QUESTIONS ===
async function fetchReports() {
    if (unsubReps) return; 
    unsubReps = onSnapshot(collection(db, "reported_questions"), (qSnap) => {
        const list = document.getElementById('reports-list');
        if(!list) return; list.innerHTML = '';
        let hasReports = false;
        
        qSnap.forEach(d => {
            const data = d.data();
            if(data.status === 'resolved') return;
            hasReports = true;

            const card = document.createElement('div');
            card.className = 'action-card'; card.style.borderLeft = "4px solid #ef4444";
            card.innerHTML = `
                <div class="flex-between mb-10px">
                    <strong>Q-ID: <span class="text-danger">${data.questionId}</span></strong>
                    <span class="text-muted font-sm">${data.timestamp ? data.timestamp.toDate().toLocaleDateString() : ''}</span>
                </div>
                <div class="bg-slate-50 p-10px border-radius-6px font-sm text-slate-600 font-italic mb-10px">${data.questionText}</div>
                <p class="text-slate-800 font-sm"><strong>Reason:</strong> ${data.reason}</p>
                <div class="flex-between align-center mt-15px border-top-slate pt-10px">
                    <small class="text-muted">By: ${data.userEmail}</small>
                    <div class="flex-gap-10px">
                        <button class="btn-solid btn-edit-report bg-blue text-white p-04-1"><i class="fas fa-edit"></i> Edit Q</button>
                        <button class="btn-outline btn-res border-success text-success p-04-1"><i class="fas fa-check"></i> Mark Solved</button>
                    </div>
                </div>
            `;

            card.querySelector('.btn-edit-report').onclick = async (e) => {
                const btn = e.currentTarget; const origHtml = btn.innerHTML; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; btn.disabled = true;
                try {
                    let qData = null;
                    const knownBooks = ['firstaid_step1', 'firstaid_step2', 'im_medicine', 'im_surgery', 'im_pathology', 'im_pediatrics', 'brs_patho', 'brs_physio', 'pretest_surgery', 'rafiullah', 'RWR', 'doubleAA'];
if (data.courseFile) {
    const isBook = knownBooks.includes(data.courseFile);
    if (isBook) {
        const res = await fetch(`Books/${data.courseFile}_questions.json`, { cache: 'no-cache' });
        if (res.ok) qData = (await res.json()).find(q => String(q.id || q.QuestionID) === String(data.questionId));
    } else {
        const metaRes = await fetch(`Data/${data.courseFile}_metadata.json`, { cache: 'no-cache' });
        if (metaRes.ok) {
            const metadata = await metaRes.json();
            const qMeta = metadata.find(q => String(q.id || q.QuestionID) === String(data.questionId));
            
            if (qMeta) {
                const sanitizeFilename = (name) => {
                    if (!name) return "unknown";
                    return String(name).toLowerCase().trim().replace(/[\\/*?:"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
                };
                const subjClean = sanitizeFilename(qMeta.subject || qMeta.Subject);
                const chapClean = sanitizeFilename(qMeta.chapter || qMeta.Chapter);
                const chunkUrl = `Data/${data.courseFile}/subjects/${subjClean}_${chapClean}.json`;
                
                const chunkRes = await fetch(chunkUrl, { cache: 'no-cache' });
                if (chunkRes.ok) {
                    qData = (await chunkRes.json()).find(q => String(q.id || q.QuestionID) === String(data.questionId));
                }
            }
        }
    }
}

                    if (!window.editQuillHint) {
                        const tb = [['bold', 'italic', 'underline', 'strike'], [{ 'color': [] }, { 'background': [] }], [{ 'list': 'ordered'}, { 'list': 'bullet' }], [{ 'align': [] }], ['clean']];
                        window.editQuillHint = new Quill('#edit-q-hint', { theme: 'snow', modules: { toolbar: tb } });
                        window.editQuillExp = new Quill('#edit-q-explanation', { theme: 'snow', modules: { toolbar: tb } });
                    }

                    document.getElementById('edit-q-id').value = qData?.id || data.questionId || '';
                    document.getElementById('edit-q-text').value = qData?.question || data.questionText || '';
                    document.getElementById('edit-q-subject').value = qData?.subject || '';
                    document.getElementById('edit-q-chapter').value = qData?.chapter || '';
                    document.getElementById('edit-q-topic').value = qData?.topic || '';
                    document.getElementById('edit-q-year').value = Array.isArray(qData?.year) ? qData?.year.join(', ') : (qData?.year || '');
                    document.getElementById('edit-q-exam').value = Array.isArray(qData?.exams || qData?.exam) ? (qData?.exams || qData?.exam).join(', ') : (qData?.exams || qData?.exam || '');
                    document.getElementById('edit-q-diff').value = (qData?.difficulty || 'medium').toLowerCase();
                    window.editQuillHint.root.innerHTML = qData?.hint || ''; window.editQuillExp.root.innerHTML = qData?.explanation || '';

                    const destSelect = document.getElementById('edit-q-dest'); destSelect.value = ''; 
                    if (data.courseFile && Array.from(destSelect.options).map(o => o.value).includes(`${knownBooks.includes(data.courseFile) ? 'BOOK:' : 'COURSE:'}${data.courseFile}`)) {
                        destSelect.value = `${knownBooks.includes(data.courseFile) ? 'BOOK:' : 'COURSE:'}${data.courseFile}`;
                    }

                    const optsContainer = document.getElementById('edit-options-container'); optsContainer.innerHTML = '';
                    const fOpts = qData?.options || {}; const cAns = (qData?.correctAnswer || 'A').toUpperCase();

                    for (let i = 0; i < 5; i++) {
                        const letter = String.fromCharCode(65 + i);
                        optsContainer.innerHTML += `<div class="flex-align-center gap-10px"><input type="radio" name="edit-correct-opt" value="${i}" ${cAns === letter ? "checked" : (i===0&&!qData?"checked":"")} class="radio-large"><span class="font-bold text-slate-800 w-20px">${letter})</span><input type="text" id="edit-opt-${i}" value="${(fOpts[letter] || '').replace(/"/g, '&quot;')}" class="input-standard flex-1"></div>`;
                    }
                    document.getElementById('admin-edit-modal').classList.remove('view-hidden');
                } catch (err) { alert("Failed to fetch full data."); } finally { btn.innerHTML = origHtml; btn.disabled = false; }
            };

            card.querySelector('.btn-res').onclick = async () => { if(confirm("Resolved?")) await updateDoc(doc(db, "reported_questions", d.id), { status: 'resolved', resolvedAt: new Date().toISOString() }); };
            list.appendChild(card);
        });
        if(!hasReports) list.innerHTML = '<p class="table-loading">No pending reported questions.</p>';
    });
}

document.getElementById('btn-cancel-edit').onclick = () => document.getElementById('admin-edit-modal').classList.add('view-hidden');

document.getElementById('btn-save-github').onclick = () => {
    const destVal = document.getElementById('edit-q-dest').value;
    if (!destVal) return alert("Select Destination.");
    const targetId = document.getElementById('edit-q-id').value;
    if (!targetId) return alert("ID missing.");

    let correctLetter = "A";
    document.querySelectorAll('input[name="edit-correct-opt"]').forEach((r, i) => { if (r.checked) correctLetter = String.fromCharCode(65 + i); });

    const updatedRow = {
        "QuestionID": targetId, "Year": document.getElementById('edit-q-year').value.trim(), "Exam": document.getElementById('edit-q-exam').value.trim(),
        "Subject": document.getElementById('edit-q-subject').value.trim(), "Chapter": document.getElementById('edit-q-chapter').value.trim(), "Topic": document.getElementById('edit-q-topic').value.trim(),
        "Question": document.getElementById('edit-q-text').value.trim(), "OptionA": document.getElementById('edit-opt-0')?.value.trim() || "", "OptionB": document.getElementById('edit-opt-1')?.value.trim() || "",
        "OptionC": document.getElementById('edit-opt-2')?.value.trim() || "", "OptionD": document.getElementById('edit-opt-3')?.value.trim() || "", "OptionE": document.getElementById('edit-opt-4')?.value.trim() || "",
        "CorrectAnswer": correctLetter, "Explanation": window.editQuillExp?.root.innerHTML || "", "Hint": window.editQuillHint?.root.innerHTML || "", "Difficulty": document.getElementById('edit-q-diff').value
    };

    let q = JSON.parse(localStorage.getItem('edeetos_pending_edits')) || [];
    const idx = q.findIndex(item => item.row["QuestionID"] === targetId);
    const item = { row: updatedRow, courseFile: destVal.split(':')[1], isBook: destVal.split(':')[0] === 'BOOK' };
    idx !== -1 ? q[idx] = item : q.push(item);
    
    localStorage.setItem('edeetos_pending_edits', JSON.stringify(q));
    updatePendingCount(); document.getElementById('admin-edit-modal').classList.add('view-hidden'); alert('Fix added to queue!');
};

// === 15. CONTACT MESSAGES ===
async function fetchMessages() {
    if (unsubMsgs) return; 
    unsubMsgs = onSnapshot(collection(db, "contact_messages"), (qSnap) => {
        const list = document.getElementById('messages-list');
        if(!list) return; list.innerHTML = '';
        if(qSnap.empty) return list.innerHTML = '<p class="table-loading">No messages.</p>';
        
        qSnap.forEach(d => {
            const data = d.data();
            const card = document.createElement('div');
            card.className = 'action-card'; card.style.borderLeft = "4px solid #3b82f6";
            card.innerHTML = `
                <div class="flex-between mb-5px"><strong>${data.name}</strong> <span class="text-muted font-sm">${data.timestamp ? new Date(data.timestamp).toLocaleDateString() : ''}</span></div>
                <div class="font-sm text-blue mb-15px">
                    <a href="mailto:${data.email}" class="mr-15px text-none text-blue">📧 ${data.email}</a>
                    ${data.whatsapp ? `<a href="https://wa.me/${data.whatsapp.replace(/[^0-9]/g, '')}" target="_blank" class="text-none text-success">💬 ${data.whatsapp}</a>` : ''}
                </div>
                <div class="bg-slate-50 p-15px border-radius-8px text-slate-800 line-height-1-6 mb-15px white-space-pre">${data.message}</div>
                <button class="btn-action-del" onclick="deleteDoc(doc(db, 'contact_messages', '${d.id}'));"><i class="fas fa-trash"></i> Delete</button>
            `;
            list.appendChild(card);
        });
    });
}