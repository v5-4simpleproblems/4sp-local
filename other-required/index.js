const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();

const crypto = require('crypto');

// IMPORTANT: Replace with a strong, securely stored secret key.
// Use Firebase Environment Configuration or Google Secret Manager in production.
// Example for Firebase Environment Configuration: firebase functions:config:set localclient.hmac_secret="YOUR_RANDOM_SECRET_KEY"
// Then access as: process.env.FIREBASE_CONFIG.localclient.hmac_secret
const HMAC_SECRET = process.env.HMAC_SECRET || 'super-secret-key-please-change'; 

// Helper function to generate HMAC-SHA256 hash
function generateHmac(data) {
    return crypto.createHmac('sha256', HMAC_SECRET)
                 .update(data)
                 .digest('hex');
}

// Helper function to generate a random alphanumeric code
function generateRandomCode(length = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// ==================================================================
// CONFIGURATION: API KEYS
// Get these from https://dictionaryapi.com/ (Merriam-Webster)
// ==================================================================
const MW_DICT_KEY = "YOUR_MERRIAM_WEBSTER_DICTIONARY_KEY"; 
const MW_THES_KEY = "YOUR_MERRIAM_WEBSTER_THESAURUS_KEY";
// ==================================================================

// Cloud Function to generate a new unlock code
exports.generateCode = onRequest({ cors: true }, async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    // TODO: Add authentication/authorization for who can generate codes
    // For example, only authenticated users from the connector site should be able to.
    // if (!req.auth || !req.auth.uid) {
    //     res.status(403).send('Unauthorized');
    //     return;
    // }

    try {
        const plaintextCode = generateRandomCode(12); // Generate a 12-character code
        const codeHash = generateHmac(plaintextCode);
        const expiryDate = admin.firestore.Timestamp.fromMillis(Date.now() + 1000 * 60 * 30); // Code valid for 30 minutes

        await admin.firestore().collection('unlockCodes').doc(codeHash).set({
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: expiryDate,
            used: false,
            revoked: false,
            userId: req.auth ? req.auth.uid : null, // Associate with a user if authenticated
            deviceFingerprint: null, // Will be set upon redemption
            usedAt: null
        });

        logger.info(`Generated code for user: ${req.auth ? req.auth.uid : 'anonymous'}`);
        res.status(200).json({ success: true, code: plaintextCode, expiresAt: expiryDate.toDate() });

    } catch (error) {
    }
});

// Cloud Function to redeem an unlock code
exports.redeemCode = onRequest({ cors: true }, async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    const { code, fingerprint } = req.body;

    if (!code || !fingerprint) {
        res.status(400).json({ error: "Missing 'code' or 'fingerprint' in request body" });
        return;
    }

    const codeHash = generateHmac(code);
    const codeRef = admin.firestore().collection('unlockCodes').doc(codeHash);

    try {
        const result = await admin.firestore().runTransaction(async (transaction) => {
            const doc = await transaction.get(codeRef);

            if (!doc.exists) {
                throw new Error('Code not found.');
            }

            const codeData = doc.data();

            if (codeData.used) {
                throw new Error('Code already used.');
            }
            if (codeData.revoked) {
                throw new Error('Code has been revoked.');
            }
            if (codeData.expiresAt && codeData.expiresAt.toDate() < new Date()) {
                throw new Error('Code has expired.');
            }

            // Device binding logic
            if (codeData.deviceFingerprint && codeData.deviceFingerprint !== fingerprint) {
                throw new Error('Code already bound to another device.');
            }

            // Update code status
            transaction.update(codeRef, {
                used: true,
                usedAt: admin.firestore.FieldValue.serverTimestamp(),
                deviceFingerprint: fingerprint // Bind or re-bind to this device
            });

            // Generate short-lived download token (placeholder for now)
            // In a real scenario, this would be a JWT signed with a private key
            const downloadToken = `temp_token_${codeHash}_${Date.now()}`; 
            
            return { success: true, message: 'Code redeemed successfully!', token: downloadToken };
        });

        res.status(200).json(result);

    } catch (error) {
        logger.error("Error redeeming code:", error);
        res.status(400).json({ success: false, message: error.message || 'Error redeeming code.' });
    }
});

// Cloud Function to revoke an unlock code or unlink a device
exports.revokeCode = onRequest({ cors: true }, async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    const { code, codeHash, unlinkDevice } = req.body;

    let targetCodeHash;
    if (code) {
        targetCodeHash = generateHmac(code);
    } else if (codeHash) {
        targetCodeHash = codeHash;
    } else {
        res.status(400).json({ error: "Missing 'code' or 'codeHash' in request body" });
        return;
    }

    const codeRef = admin.firestore().collection('unlockCodes').doc(targetCodeHash);

    try {
        await admin.firestore().runTransaction(async (transaction) => {
            const doc = await transaction.get(codeRef);

            if (!doc.exists) {
                throw new Error('Code not found.');
            }

            const codeData = doc.data();

            // TODO: Add authorization check here:
            // Ensure req.auth.uid (if authenticated) matches codeData.userId, or is an admin.
            // For now, any POST can revoke. This needs tightening.
            // if (req.auth && req.auth.uid !== codeData.userId && !isAdmin(req.auth.uid)) {
            //     throw new Error('Unauthorized to revoke this code.');
            // }

            const updateData = {
                revoked: true,
                revokedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            if (unlinkDevice) {
                updateData.deviceFingerprint = null; // Unlink device
                updateData.used = false; // Allow re-use on a new device
            }
            
            transaction.update(codeRef, updateData);
        });

        logger.info(`Revoked code hash: ${targetCodeHash}${unlinkDevice ? ' and unlinked device' : ''}`);
        res.status(200).json({ success: true, message: 'Code revoked successfully.' });

    } catch (error) {
        logger.error("Error revoking code:", error);
        res.status(400).json({ success: false, message: error.message || 'Error revoking code.' });
    }
});
exports.getWordData = onRequest({ cors: true }, async (req, res) => {
    try {
        const word = req.query.word;

        if (!word) {
            res.status(400).json({ error: "Missing 'word' query parameter" });
            return;
        }

        // logger.info(`Fetching data for word: ${word}`);

        // Execute both API calls in parallel
        const [dictResponse, thesResponse] = await Promise.all([
            axios.get(`https://www.dictionaryapi.com/api/v3/references/collegiate/json/${encodeURIComponent(word)}?key=${MW_DICT_KEY}`),
            axios.get(`https://www.dictionaryapi.com/api/v3/references/thesaurus/json/${encodeURIComponent(word)}?key=${MW_THES_KEY}`)
        ]);

        res.status(200).json({
            dictionary: dictResponse.data,
            thesaurus: thesResponse.data
        });

    } catch (error) {
        logger.error("Error in getWordData:", error);
        
        const status = error.response ? error.response.status : 500;
        const message = error.message || "Internal Server Error";
        
        res.status(status).json({ 
            error: message,
            details: "Check Cloud Function logs for more info." 
        });
    }
});

exports.leviumProxy = onRequest({ cors: true }, async (req, res) => {
    const TARGET_ORIGIN = "https://levium-student-management.global.ssl.fastly.net";
    const PROXY_BASE_PATH = "/leviumProxy/"; // Define proxy base path here
    
    // Default to levium.html if root is requested
    let path = req.path;
    if (!path || path === "/") {
        path = "/levium.html";
    }

    const url = TARGET_ORIGIN + path;

    try {
        const response = await axios({
            method: req.method,
            url: url,
            params: req.query,
            responseType: 'arraybuffer', // vital for binary files and manual string decoding
            validateStatus: () => true, // capture all statuses
            headers: {
                ...req.headers,
                // Spoof headers to make the target think it's a direct request
                host: new URL(TARGET_ORIGIN).host,
                origin: TARGET_ORIGIN,
                referer: TARGET_ORIGIN + '/'
            }
        });

        // Forward headers from the target response to the client
        for (const [key, value] of Object.entries(response.headers)) {
            const lowerKey = key.toLowerCase();
            // content-length: we might modify the body, so let the framework set it
            // content-encoding: axios decodes it, so we don't want to say it's gzip if we send plain text
            // host: never forward host
            if (!['host', 'content-length', 'content-encoding'].includes(lowerKey)) {
                res.setHeader(key, value);
            }
        }

        const contentType = response.headers['content-type'] || '';

        // If it's HTML, we need to rewrite paths so the browser keeps using the proxy
        if (contentType.includes('text/html')) {
            let html = response.data.toString('utf8');

            // 1. Rewrite HTML attributes that start with '/' (absolute paths)
            // src="/foo.js" -> src="/leviumProxy/foo.js"
            // Negative lookahead (?!\/) ensures we don't match protocol relative URLs (//example.com)
            html = html.replace(/(src|href|action|data-url)=["']\/(?!\/)(.*?)["']/g, (match, attr, path) => {
                const quote = match.includes("'") ? "'" : '"';
                return `${attr}=${quote}${PROXY_BASE_PATH}${path}${quote}`;
            });
            
            // 2. Rewrite specific UV/Bare patterns often found in JS strings
            // Catch "/uv/" literal strings in JS
            html = html.replace(/"\/uv\//g, `"${PROXY_BASE_PATH}uv/`);
            html = html.replace(/'\/uv\//g, `'${PROXY_BASE_PATH}uv/`);
            
            // 3. Rewrite usage of /bare/ if it exists
            html = html.replace(/"\/bare\//g, `"${PROXY_BASE_PATH}bare/`);
            html = html.replace(/'\/bare\//g, `'${PROXY_BASE_PATH}bare/`);

            // 4. Rewrite <base href="/..."> tags to point to the proxy base path
            // This is crucial if the original page sets a different base for relative URLs
            html = html.replace(/<base\s+href=["']\/(?!\/)(.*?)["']\s*\/?>/i, `<base href="${PROXY_BASE_PATH}$1">`);


            res.status(response.status).send(html); // Ensure status is forwarded
        } else {
            // For non-HTML (JS, CSS, Images, etc.), just send the buffer
            res.status(response.status).send(response.data);
        }
    } catch (error) {
        logger.error("Proxy Error", error);
        res.status(500).send("Proxy Error: " + error.message); // More descriptive error
    }
});

exports.reportContent = onRequest({ cors: true }, async (req, res) => {
    try {
        if (req.method !== 'POST') {
            res.status(405).send('Method Not Allowed');
            return;
        }

        const { collectionName, docId, reason, reportedBy } = req.body;

        if (!collectionName || !docId) {
            res.status(400).json({ error: "Missing required parameters: collectionName, docId" });
            return;
        }

        // 1. Log the report in a separate collection for admin review
        await admin.firestore().collection('reports').add({
            targetCollection: collectionName,
            targetDocId: docId,
            reason: reason || 'User Report',
            reportedBy: reportedBy || 'Anonymous',
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        // 2. Mark the content as reported in its original document
        //    This allows for client-side filtering (e.g., hiding it from the reporter)
        //    and potential global hiding if a threshold is reached.
        await admin.firestore().collection(collectionName).doc(docId).update({
             reported: true, // Simple flag
             reportedBy: admin.firestore.FieldValue.arrayUnion(reportedBy) // Track who reported it
        });

        res.status(200).json({ success: true, message: "Report submitted successfully." });

    } catch (error) {
        logger.error("Report Function Error", error);
    }
});

// Cloud Function to serve authorized files (acting as a secure proxy to the CDN)
exports.downloadEndpoint = onRequest({ cors: true }, async (req, res) => {
    const requestedPath = req.path.substring(1); // Remove leading slash
    const authHeader = req.headers.authorization;
    const downloadToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

    if (!downloadToken) {
        res.status(401).send('Authorization token required.');
        return;
    }

    // TODO: Implement proper token validation here.
    // For now, a very basic placeholder check.
    // In a real scenario, this would verify a JWT, check expiry, signature, etc.
    if (!downloadToken.startsWith('temp_token_')) { 
        res.status(403).send('Invalid token.');
        return;
    }

    // Construct the URL to the actual file on the CDN
    const CDN_BASE_URL = 'https://your-cdn-url.com/web-files'; // Matches CDN_BASE in client
    const fileUrl = `${CDN_BASE_URL}/${requestedPath}`;

    try {
        const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });

        // Forward headers from the CDN response to the client
        for (const [key, value] of Object.entries(response.headers)) {
            // Avoid forwarding sensitive or problematic headers
            const lowerKey = key.toLowerCase();
            if (!['host', 'authorization', 'x-forwarded-for'].includes(lowerKey)) {
                res.setHeader(key, value);
            }
        }
        
        res.status(response.status).send(response.data);

    } catch (error) {
        logger.error(`Error serving file ${requestedPath}:`, error);
        if (error.response) {
            res.status(error.response.status).send(error.response.data);
        } else {
            res.status(500).send('Internal Server Error while fetching file.');
        }
    }
});

// V2 Function with built-in CORS support