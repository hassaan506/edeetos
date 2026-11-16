const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');
const axios = require('axios'); // Run `npm install axios` in your functions folder

exports.secureFetchAndDecrypt = functions.https.onCall(async (data, context) => {
    // 1. Verify Authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Access Denied.');
    }

    const requestedPath = data.path;
    if (!requestedPath || typeof requestedPath !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'Path is required.');
    }

    // 2. SSRF Protection: Hardcode the base URL and sanitize the path
    // This guarantees attackers cannot use your server to fetch external URLs
    const safePath = requestedPath.replace(/^[./]+/, ""); 
    if (!safePath.startsWith('Data/') && !safePath.startsWith('Books/')) {
        throw new functions.https.HttpsError('permission-denied', 'Invalid directory requested.');
    }
    
    const targetUrl = `https://hassaan506.github.io/edeetos/${safePath}`;

    // 3. Fetch Master Key from Firestore Securely
    const db = admin.firestore();
    const keySnap = await db.collection("system_config").doc("security").get();
    if (!keySnap.exists) {
        throw new functions.https.HttpsError('internal', 'Server configuration error.');
    }
    const masterKeyBase64 = keySnap.data().masterKey;

    try {
        // 4. Fetch the encrypted payload from GitHub
        const response = await axios.get(targetUrl, { responseType: 'text' });
        const encryptedText = response.data;

        // If it's already plaintext JSON (e.g., during development), just return it
        if (encryptedText.trim().startsWith('{') || encryptedText.trim().startsWith('[')) {
            return JSON.parse(encryptedText);
        }

        // 5. Node.js AES-256-GCM Decryption
        const rawData = Buffer.from(encryptedText, 'base64');
        const iv = rawData.slice(0, 12); // First 12 bytes are the IV
        const authTag = rawData.slice(rawData.length - 16); // Last 16 bytes are the Auth Tag
        const ciphertext = rawData.slice(12, rawData.length - 16); 
        const key = Buffer.from(masterKeyBase64, 'base64');

        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        
        let decrypted = decipher.update(ciphertext, null, 'utf8');
        decrypted += decipher.final('utf8');

        // Return the clean JSON object to the frontend
        return JSON.parse(decrypted);

    } catch (error) {
        console.error("Backend decryption failed:", error.message);
        throw new functions.https.HttpsError('internal', 'Failed to retrieve or decrypt data.');
    }
});