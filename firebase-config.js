import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyDDP1qj2w7YmteqO5DnquFKyW7KKQ9hUx8",
    authDomain: "edeetos-68fd3.firebaseapp.com",
    databaseURL: "https://edeetos-68fd3-default-rtdb.firebaseio.com",
    projectId: "edeetos-68fd3",
    storageBucket: "edeetos-68fd3.firebasestorage.app",
    messagingSenderId: "159305810254",
    appId: "1:159305810254:web:31bc74567fbf016da89e1f",
    measurementId: "G-D5P5TW3SM1"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

export { auth, db, storage };