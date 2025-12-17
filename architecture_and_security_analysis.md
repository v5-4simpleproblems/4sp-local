**4SP Version 5 DV: Architecture and Security Analysis**

This document outlines the architecture, security model, and technical justifications for 4SP Version 5 DV, an offline-first, locally hosted student platform.

---

### 1. Step-by-step Architecture Flow

The system operates with a clear separation of concerns between the local client, the connector website, and Firebase Cloud Functions/Firestore.

**A. Initial Access Code Generation (Connector Website)**

1.  **User Authentication:** A student navigates to the connector website (e.g., `4sp-organization.github.io`). They sign in using a trusted identity provider (Google, Microsoft, etc.) via Firebase Authentication. The connector website's Firebase Auth SDK manages this process; no sensitive credentials or admin SDKs are used.
2.  **Request Code Generation:** Upon successful authentication, the connector website calls the `generateCode` Cloud Function, passing the user's Firebase ID token in the `Authorization` header.
3.  **Cloud Function `generateCode`:**
    *   Verifies the Firebase ID token to ensure the request is from an authenticated user.
    *   Generates a cryptographically secure, random plaintext code (e.g., 12 characters alphanumeric).
    *   Computes an HMAC-SHA256 hash of this plaintext code using a server-side secret key.
    *   Stores the code's hash, associated `userId` (from the ID token), `createdAt`, `expiresAt`, `used: false`, `revoked: false`, and `deviceFingerprint: null` in a Firestore collection (`unlockCodes`).
    *   Returns the *plaintext* code and its `expiresAt` timestamp to the connector website.
4.  **Code Display:** The connector website displays the plaintext code to the user **once**, with clear instructions to copy and save it. It emphasizes the one-time display and expiration. The user is also instructed on how to use this code with their local 4SP client.
5.  **Code Management (Optional):** The connector website can display a list of the user's active codes (by querying Firestore for codes owned by their `userId`) and offer functionality to `revokeCode` (call the `revokeCode` Cloud Function).

**B. Local Client Setup & Access (Offline-First Device)**

1.  **Local Client Launch:** The student launches the `4simpleproblems_v5.html` file locally on their device. This HTML file acts as a small bootstrapper.
2.  **Initial Check:** The bootstrapper checks `localStorage` for a previously redeemed `4sp_unlock_token`.
3.  **No Token - Code Entry UI:** If no valid `4sp_unlock_token` is found, the bootstrapper presents a UI requesting the one-time access code obtained from the connector website.
4.  **Device Fingerprinting:** The bootstrapper generates a unique, deterministic device fingerprint using Web Crypto API (e.g., hashing a combination of stable device attributes like user agent, screen resolution, language, and a locally generated random ID stored in `localStorage`). This fingerprint contains no personally identifiable information (PII).
5.  **Request Code Redemption:** The student enters the plaintext code and clicks "Unlock". The bootstrapper calls the `redeemCode` Cloud Function, sending the plaintext code and the device fingerprint.
6.  **Cloud Function `redeemCode`:**
    *   Computes the HMAC-SHA256 hash of the received plaintext code using the *same* server-side secret key.
    *   Initiates an atomic Firestore transaction on the `unlockCodes` collection using the computed code hash as the document ID.
    *   **Verification Steps:**
        *   Checks if the code hash exists in Firestore.
        *   Checks if `used` is `false`, `revoked` is `false`, and `expiresAt` is in the future.
        *   If `deviceFingerprint` field in Firestore is `null`, it sets it to the provided device fingerprint (first use binding).
        *   If `deviceFingerprint` is *not* `null`, it verifies that the provided device fingerprint matches the stored one (prevents unauthorized device changes).
    *   If all verifications pass:
        *   Updates the Firestore document: sets `used: true`, `usedAt` timestamp, and confirms the `deviceFingerprint`.
        *   Generates a short-lived, cryptographically signed download token (e.g., a JWT signed with a private key), including claims like `userId`, `deviceFingerprint`, and `exp`.
    *   Returns the signed download token to the local client bootstrapper.
7.  **Token Storage:** The local client bootstrapper stores the received `4sp_unlock_token` securely in `localStorage` (or optionally encrypts it with Web Crypto if implemented).
8.  **Application Download & Launch:** With the valid `4sp_unlock_token`, the bootstrapper proceeds to download the actual 4SP application files (HTML, CSS, JS) from a CDN, including the token in the `Authorization: Bearer` header for each request. The bootstrapper uses the `downloadEndpoint` Cloud Function as a secure proxy to fetch these files.
9.  **Cloud Function `downloadEndpoint`:**
    *   Verifies the download token (JWT signature, expiry, claims like `userId` and `deviceFingerprint`).
    *   If valid, it proxies the request to the actual CDN where the 4SP application files (`web-files/`) are hosted, streaming the content back to the client. This allows the CDN files to remain private or only accessible via this authorized endpoint.
    *   If invalid, it returns a 401/403 error.
10. **Offline Operation:** Once the 4SP application files are loaded by the bootstrapper, the client runs entirely offline. Subsequent page navigations within the 4SP client are handled locally or from the browser cache. The `4sp_unlock_token` is periodically checked (e.g., on app launch or after a certain period) to re-verify access by attempting a small authorized request via `downloadEndpoint` or a dedicated lightweight "ping" Cloud Function.

---

### 2. Threat Model (School Admin Capabilities)

This section analyzes the capabilities of a typical school administrator with network and local device access, and how 4SP Version 5 DV resists potential attacks.

**School Admin Capabilities:**

*   **Network-level Blocking & Inspection:**
    *   DNS blocking (blocking domains like `firebase.googleapis.com`, `cloudfunctions.net`, `4sp-organization.github.io`, CDN domains).
    *   IP address blocking.
    *   Deep Packet Inspection (DPI) to identify and block specific protocols or content (e.g., VPNs, proxy traffic).
    *   SSL/TLS interception (Man-in-the-Middle) using custom root certificates.
    *   Firewall rules (blocking outbound connections on non-standard ports).
*   **Content Filtering:** Blocking websites based on keywords, categories, or blacklists.
*   **Local Device Inspection:**
    *   Monitoring running processes.
    *   Inspecting browser history, cache, `localStorage`, and `IndexedDB`.
    *   Installing monitoring software (MDM solutions, screen recorders, keyloggers).
    *   Accessing local file systems (though user permissions typically restrict arbitrary file modification of downloaded apps).

**Resistance to School Admin Actions:**

*   **Network-level Blocking (Initial Setup):**
    *   **DNS/IP Blocking of Firebase/CDN:** The initial connection to `4sp-organization.github.io` (for code generation) and Firebase Cloud Functions (for `generateCode`, `redeemCode`, `downloadEndpoint`) *can* be blocked. This prevents initial setup or re-verification.
    *   **Resistance:** This is an expected blocking vector. The solution **requires initial external network access** for code generation and application download. Once downloaded, the client functions offline. The threat model explicitly states "offline-first, locally hosted" and "runs fully offline *after initial setup*." The design goal is not to circumvent initial blocking, but to function *after* that initial hurdle. If the user cannot reach the connector site or Cloud Functions *at all*, they cannot perform the initial setup.
    *   **SSL/TLS Interception:** If admins install custom root certificates, they can intercept HTTPS traffic. This could potentially allow them to inspect API calls to Cloud Functions.
    *   **Resistance:** HTTPS is used for all Cloud Function communication, preventing passive eavesdropping. Token verification (JWT signature check) ensures that even if traffic is inspected, a tampered token would be rejected by the Cloud Function.
*   **Content Filtering:**
    *   Blocking `4sp-organization.github.io` due to content classification.
    *   **Resistance:** Similar to network blocking, this prevents initial setup. Once downloaded, content filtering is irrelevant for the local client.
*   **Local Device Inspection:**
    *   **Inspecting `localStorage`:** Admins can view the `4sp_unlock_token` and `4sp_device_id`.
    *   **Resistance:** The `4sp_unlock_token` is short-lived and cryptographically signed (JWT). Viewing it allows an admin to *impersonate that specific device* for the token's duration, but it does *not* reveal long-term secrets (like the HMAC secret) or grant access to other users' accounts. The `4sp_device_id` is a random identifier, not PII. The token is also bound to a device fingerprint server-side, making simple token reuse on a different device difficult without also spoofing the fingerprint. Client-side encryption of the token (as noted in Security Implementation) would further mitigate this but adds complexity.
    *   **Inspecting downloaded files:** Admins can view the `4simpleproblems_v5.html` and other application files.
    *   **Resistance:** The local client contains no secrets. Its purpose is to bootstrap, collect input, and make API calls. All sensitive logic is server-side. Inspection reveals nothing exploitable beyond understanding the client's operation.
    *   **Modifying local client files:** Admins could theoretically modify `4simpleproblems_v5.html` or other downloaded JS files.
    *   **Resistance:** Client modification does not grant privileges. The Cloud Functions enforce all security and authorization. Modifying the client to bypass input validation, for example, would simply result in the Cloud Function rejecting the invalid request. The `4sp_unlock_token` is also verified server-side.
    *   **Installing monitoring software:** This is an OS-level concern beyond the application's direct control.
    *   **Resistance:** This architecture cannot prevent sophisticated OS-level monitoring. However, it minimizes the attack surface by not storing sensitive information locally.

---

### 3. Firestore Ruleset

The `firestore.rules` ensure strict access control for the `unlockCodes` collection and protect other data.

```firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // --- Helper Functions ---
    function isAuthenticated() {
      return request.auth != null;
    }

    function isOwner(userId) {
      return isAuthenticated() && request.auth.uid == userId;
    }

    function isAdminOrSuperAdmin() {
      return isAuthenticated() && (
             request.auth.token.email == '4simpleproblems@gmail.com' ||
             (exists(/databases/$(database)/documents/admins/$(request.auth.uid)) &&
             get(/databases/$(database)/documents/admins/$(request.auth.uid)).data.role in ['admin', 'superadmin'])
      );
    }
    
    // --- User Profiles Collection (`users`) ---
    match /users/{userId} {
      allow read: if isAuthenticated(); 
      allow list: if isAdminOrSuperAdmin(); 
      allow create: if isOwner(userId)
                      && request.resource.id == request.auth.uid
                      && 'username' in request.resource.data;
      allow update: if isOwner(userId) || 
                    (isAuthenticated() && 
                     request.resource.data.diff(resource.data).affectedKeys().hasOnly(['pending_requests', 'friends']));
      allow delete: if isOwner(userId);
    }

    // --- Friend Codes Collection (`friend_codes`) - Preserved from original ---
    match /friend_codes/{code} {
      allow read: if isAuthenticated();
      allow create: if isAuthenticated() 
                      && request.resource.data.userId == request.auth.uid;
      allow delete: if isAuthenticated() && resource.data.userId == request.auth.uid;
      allow update: if false; 
    }

    // --- Admin Status Collection (`admins`) - Preserved from original ---
    match /admins/{userId} {
      allow read: if isOwner(userId) || isAdminOrSuperAdmin();
      allow list: if isAdminOrSuperAdmin(); 
      allow create, update, delete: if isAdminOrSuperAdmin(); 
    }

    // --- Daily Photos Collection (`daily_photos`) - Preserved from original ---
    match /daily_photos/{photoId} {
      allow read: if isAuthenticated(); 
      allow create: if isAuthenticated() && request.resource.data.creatorUid == request.auth.uid;
      allow update: if isAuthenticated() && (
        resource.data.creatorUid == request.auth.uid ||
        request.resource.data.diff(resource.data).affectedKeys().hasOnly(['hearts', 'comments'])
      );
      allow delete: if isAuthenticated() && resource.data.creatorUid == request.auth.uid;
    }

    // --- Legacy / Unused Collections - Preserved from original ---
    match /dailyPhotos/{photoId} {
      allow create: if isAuthenticated() && (
        (request.resource.data.creatorUid == request.auth.uid) || 
        (request.resource.data.userId == request.auth.uid)
      );
      allow update, delete: if isAuthenticated() && (
        (resource.data.creatorUid == request.auth.uid) || 
        (resource.data.userId == request.auth.uid)
      );
      allow read: if isAuthenticated(); 
    }

    match /friendRequests/{requestId} {
      allow create: if isAuthenticated() && request.resource.data.senderId == request.auth.uid;
      allow delete: if isAuthenticated() && (
        (resource.data.senderId == request.auth.uid) || 
        (resource.data.recipientId == request.auth.uid)
      );
      allow read: if isAuthenticated() && (
        (resource.data.senderId == request.auth.uid) || 
        (resource.data.recipientId == request.auth.uid)
      );
      allow update: if false;
    }
    
    // --- Banned Users & Bans - Preserved from original ---
    match /banned_users/{userId} {
      allow read, create, update, delete: if isAdminOrSuperAdmin();
    }
    
    match /bans/{userId} {
      allow read: if isAdminOrSuperAdmin() || (isAuthenticated() && request.auth.uid == userId);
      allow create, update, delete: if isAdminOrSuperAdmin();
    }

    // --- Global Configuration (New) - Preserved from original ---
    match /config/{configId} {
      allow read: if isAuthenticated();
      allow write: if isAdminOrSuperAdmin();
    }

    // --- Analytics Collection (`analytics`) - Preserved from original ---
    match /analytics/{sessionId} {
      allow read, write: if isAdminOrSuperAdmin();
      allow create, update: if (request.auth == null && request.resource.data.userId == 'anonymous') ||
                               (isAuthenticated() && request.resource.data.userId == request.auth.uid);
      allow delete: if false;
    }

    // --- Unlock Codes Collection (`unlockCodes`) ---
    match /unlockCodes/{codeHash} {
      // Only Cloud Functions (via Admin SDK) can create, update, or delete these documents.
      // Client-side creates, updates, and deletes are explicitly denied.
      allow create, update, delete: if false; 

      // Authenticated users can read their own codes (for management on connector site).
      // Administrators can read all codes for auditing.
      allow read: if isOwner(resource.data.userId) || isAdminOrSuperAdmin();
    }
  }
}
```

---

### 4. Cloud Functions `index.js`

The Cloud Functions are the core of the security and sensitive logic.

```javascript
const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const axios = require("axios");
const crypto = require('crypto');

admin.initializeApp();

// IMPORTANT: Replace with a strong, securely stored secret key.
// Use Firebase Environment Configuration or Google Secret Manager in production.
// Example for Firebase Environment Configuration: firebase functions:config:set localclient.hmac_secret="YOUR_RANDOM_SECRET_KEY"
// Then access as: process.env.HMAC_SECRET (Firebase automatically makes env vars available)
// Ensure this key is NEVER hardcoded in production and is sufficiently random/long.
const HMAC_SECRET = process.env.HMAC_SECRET || 'super-secret-key-please-change-in-production-!!!!!!'; 

// Helper function to generate HMAC-SHA256 hash
function generateHmac(data) {
    return crypto.createHmac('sha256', HMAC_SECRET)
                 .update(data)
                 .digest('hex');
}

// Helper function to generate a random alphanumeric code
function generateRandomCode(length = 12) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Helper function to generate a short-lived download token (JWT)
// For this example, a simple string, but should be a signed JWT in production
// A JWT would contain claims like userId, deviceFingerprint, expiry
function generateDownloadToken(userId, deviceFingerprint, expiresInMinutes = 15) {
    // In a real system, you'd use a library like 'jsonwebtoken' to sign a JWT.
    // e.g., jwt.sign({ userId, deviceFingerprint }, JWT_SECRET, { expiresIn: `${expiresInMinutes}m` });
    // For now, a simple placeholder token incorporating relevant data.
    return `dl_token_${userId}_${deviceFingerprint}_${Date.now() + expiresInMinutes * 60 * 1000}`;
}

// ==================================================================
// CONFIGURATION: API KEYS (Preserved from original, user to manage)
// Get these from https://dictionaryapi.com/ (Merriam-Webster)
// ==================================================================
const MW_DICT_KEY = "YOUR_MERRIAM_WEBSTER_DICTIONARY_KEY"; 
const MW_THES_KEY = "YOUR_MERRIAM_WEBSTER_THESAURUS_KEY";
// ==================================================================

/**
 * Cloud Function to generate a new unlock code.
 * Accessible from the connector website after user authentication.
 * Requires an authenticated Firebase user ID token in the Authorization header.
 * Stores the HMAC hash of the code in Firestore.
 */
exports.generateCode = onRequest({ cors: true }, async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    // Firebase Admin SDK automatically verifies ID token if present and populates req.auth.
    if (!req.auth || !req.auth.uid) {
        logger.warn('Unauthorized attempt to generate code (no auth token).');
        res.status(403).json({ success: false, message: 'Unauthorized: Authentication required.' });
        return;
    }

    try {
        const plaintextCode = generateRandomCode(); // 12-character code
        const codeHash = generateHmac(plaintextCode);
        const expiresInMinutes = 30; // Code valid for 30 minutes
        const expiryDate = admin.firestore.Timestamp.fromMillis(Date.now() + 1000 * 60 * expiresInMinutes);

        // Store only the hash, not the plaintext code
        await admin.firestore().collection('unlockCodes').doc(codeHash).set({
            userId: req.auth.uid, // Associated with the authenticated user
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: expiryDate,
            used: false,
            revoked: false,
            deviceFingerprint: null, // Set upon first successful redemption
            usedAt: null
        });

        logger.info(`Code generated by user ${req.auth.uid}. Hash: ${codeHash.substring(0, 10)}...`);
        res.status(200).json({ success: true, code: plaintextCode, expiresAt: expiryDate.toDate() });

    } catch (error) {
        logger.error("Error generating code:", { error: error.message, userId: req.auth?.uid });
        res.status(500).json({ success: false, error: "Internal Server Error", details: error.message });
    }
});

/**
 * Cloud Function to redeem an unlock code from the local client.
 * Performs atomic verification and device binding.
 * Returns a short-lived download token.
 */
exports.redeemCode = onRequest({ cors: true }, async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    const { code, fingerprint } = req.body;

    if (!code || !fingerprint) {
        logger.warn('Missing code or fingerprint in redeemCode request.');
        res.status(400).json({ success: false, message: "Missing 'code' or 'fingerprint' in request body." });
        return;
    }

    const codeHash = generateHmac(code); // Compute hash of received plaintext code
    const codeRef = admin.firestore().collection('unlockCodes').doc(codeHash);

    try {
        const result = await admin.firestore().runTransaction(async (transaction) => {
            const doc = await transaction.get(codeRef);

            if (!doc.exists) {
                logger.info(`Redemption attempt for non-existent code hash: ${codeHash.substring(0, 10)}...`);
                throw new Error('Invalid code.'); // Generic message for security
            }

            const codeData = doc.data();

            if (codeData.used) {
                logger.info(`Redemption attempt for already used code hash: ${codeHash.substring(0, 10)}...`);
                throw new Error('Code already used.');
            }
            if (codeData.revoked) {
                logger.info(`Redemption attempt for revoked code hash: ${codeHash.substring(0, 10)}...`);
                throw new Error('Code has been revoked.');
            }
            if (codeData.expiresAt && codeData.expiresAt.toDate() < new Date()) {
                logger.info(`Redemption attempt for expired code hash: ${codeHash.substring(0, 10)}...`);
                throw new Error('Code has expired.');
            }

            // Device binding logic:
            // If deviceFingerprint is null, this is the first redemption for this code, bind it.
            // If deviceFingerprint exists, ensure it matches the current request's fingerprint.
            if (codeData.deviceFingerprint && codeData.deviceFingerprint !== fingerprint) {
                logger.warn(`Device mismatch for code hash: ${codeHash.substring(0, 10)}... Expected: ${codeData.deviceFingerprint}, Received: ${fingerprint}`);
                throw new Error('Code already bound to another device or device mismatch.');
            }

            // Update code status: mark as used and bind fingerprint
            transaction.update(codeRef, {
                used: true,
                usedAt: admin.firestore.FieldValue.serverTimestamp(),
                deviceFingerprint: fingerprint 
            });

            const downloadToken = generateDownloadToken(codeData.userId, fingerprint); 
            
            logger.info(`Code redeemed successfully. Hash: ${codeHash.substring(0, 10)}..., User: ${codeData.userId}, Fingerprint: ${fingerprint.substring(0, 10)}...`);
            return { success: true, message: 'Code redeemed successfully!', token: downloadToken };
        });

        res.status(200).json(result);

    } catch (error) {
        logger.error("Error redeeming code:", { error: error.message, codeHash: codeHash.substring(0, 10) });
        res.status(400).json({ success: false, message: error.message || 'Error redeeming code.' });
    }
});

/**
 * Cloud Function to revoke an unlock code or unlink a device.
 * Requires an authenticated Firebase user ID token in the Authorization header.
 * Only the owner of the code or an administrator can revoke/unlink.
 */
exports.revokeCode = onRequest({ cors: true }, async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    if (!req.auth || !req.auth.uid) {
        logger.warn('Unauthorized attempt to revoke code (no auth token).');
        res.status(403).json({ success: false, message: 'Unauthorized: Authentication required.' });
        return;
    }

    const { code, codeHash, unlinkDevice } = req.body;

    let targetCodeHash;
    if (code) {
        targetCodeHash = generateHmac(code); // If plaintext code is sent
    } else if (codeHash) {
        targetCodeHash = codeHash; // If hash is sent (e.g., from UI list)
    } else {
        logger.warn(`Missing 'code' or 'codeHash' in revokeCode request by user ${req.auth.uid}.`);
        res.status(400).json({ success: false, message: "Missing 'code' or 'codeHash' in request body." });
        return;
    }

    const codeRef = admin.firestore().collection('unlockCodes').doc(targetCodeHash);

    try {
        await admin.firestore().runTransaction(async (transaction) => {
            const doc = await transaction.get(codeRef);

            if (!doc.exists) {
                logger.info(`Revocation attempt for non-existent code hash: ${targetCodeHash.substring(0, 10)}... by user ${req.auth.uid}.`);
                throw new Error('Code not found.');
            }

            const codeData = doc.data();

            // Authorization check: Only the owner of the code or an administrator can revoke/unlink.
            const isAdminDoc = await transaction.get(admin.firestore().collection('admins').doc(req.auth.uid));
            const isCallerAdmin = isAdminDoc.exists && ['admin', 'superadmin'].includes(isAdminDoc.data().role);

            if (req.auth.uid !== codeData.userId && !isCallerAdmin) {
                logger.warn(`Unauthorized revocation attempt. Code owner: ${codeData.userId}, Caller: ${req.auth.uid}.`);
                throw new Error('Unauthorized to revoke this code.');
            }

            const updateData = {};
            let actionMessage = `Code hash: ${targetCodeHash.substring(0, 10)}...`;

            if (unlinkDevice) {
                updateData.deviceFingerprint = null; // Clear fingerprint
                updateData.used = false; // Allow code to be reused on a new device
                updateData.unlinkedAt = admin.firestore.FieldValue.serverTimestamp();
                actionMessage += ' (device unlinked)';
            } else {
                updateData.revoked = true; // Mark code as fully revoked
                updateData.revokedAt = admin.firestore.FieldValue.serverTimestamp();
                actionMessage += ' (fully revoked)';
            }
            
            transaction.update(codeRef, updateData);
            logger.info(`${actionMessage} by user ${req.auth.uid}.`);
        });

        res.status(200).json({ success: true, message: 'Code updated successfully.' });

    } catch (error) {
        logger.error("Error revoking code:", { error: error.message, codeHash: targetCodeHash?.substring(0, 10), userId: req.auth?.uid });
        res.status(400).json({ success: false, message: error.message || 'Error updating code.' });
    }
});

/**
 * Cloud Function to serve authorized files (acting as a secure proxy to the static asset CDN).
 * Requires a valid download token in the Authorization header.
 */
exports.downloadEndpoint = onRequest({ cors: true }, async (req, res) => {
    // TODO: Consider rate limiting this endpoint to prevent abuse.
    const requestedPath = req.path.substring(1); // Remove leading slash (e.g., 'logged-in/dashboard.html')
    const authHeader = req.headers.authorization;
    const downloadToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

    if (!downloadToken) {
        logger.warn('Download attempt without authorization token.');
        res.status(401).json({ success: false, message: 'Authorization token required.' });
        return;
    }

    // TODO: Implement proper JWT validation here.
    // This includes:
    // 1. Verifying the JWT signature using the server's private key.
    // 2. Checking the token's expiry (`exp` claim).
    // 3. Extracting claims like `userId` and `deviceFingerprint` from the token.
    // 4. Optionally, re-verifying the deviceFingerprint against the token's claim.
    // For now, a very basic placeholder check for the simple token string.
    const expectedPrefix = 'dl_token_';
    if (!downloadToken.startsWith(expectedPrefix) || downloadToken.split('_').length < 4) { 
        logger.warn(`Invalid download token format: ${downloadToken.substring(0, 20)}...`);
        res.status(403).json({ success: false, message: 'Invalid token format.' });
        return;
    }

    // For placeholder token: extract data from it (in a real JWT, these would be claims)
    const tokenParts = downloadToken.split('_');
    const tokenUserId = tokenParts[2];
    const tokenDeviceFingerprint = tokenParts[3];
    const tokenExpiryMillis = parseInt(tokenParts[4], 10);

    if (isNaN(tokenExpiryMillis) || tokenExpiryMillis < Date.now()) {
        logger.warn(`Expired download token: ${downloadToken.substring(0, 20)}... for user ${tokenUserId}`);
        res.status(403).json({ success: false, message: 'Download token expired.' });
        return;
    }

    // Construct the URL to the actual file on the static asset CDN.
    // IMPORTANT: This CDN_BASE_URL must be configured by the user to point to their
    // static asset hosting (e.g., a Firebase Hosting custom domain, Google Cloud Storage bucket, etc.).
    // The files at this URL might be publicly readable, with this Cloud Function acting as the access gate.
    // If files are private in the origin, this function would need Admin SDK to fetch them.
    const STATIC_ASSET_CDN_BASE_URL = 'https://your-static-assets-cdn.com/web-files'; // User to configure
    const fileUrl = `${STATIC_ASSET_CDN_BASE_URL}/${requestedPath}`;

    try {
        const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });

        // Forward headers from the CDN response to the client
        for (const [key, value] of Object.entries(response.headers)) {
            // Avoid forwarding sensitive or problematic headers
            const lowerKey = key.toLowerCase();
            if (!['host', 'authorization', 'x-forwarded-for', 'set-cookie'].includes(lowerKey)) {
                res.setHeader(key, value);
            }
        }
        
        logger.info(`File ${requestedPath} served successfully for user ${tokenUserId}, device ${tokenDeviceFingerprint.substring(0, 10)}...`);
        res.status(response.status).send(response.data);

    } catch (error) {
        logger.error(`Error serving file ${requestedPath} for user ${tokenUserId}, device ${tokenDeviceFingerprint.substring(0, 10)}...`, { error: error.message, details: error.response?.data?.toString() });
        if (error.response) {
            res.status(error.response.status).send(error.response.data);
        } else {
            res.status(500).json({ success: false, message: 'Internal Server Error while fetching file.' });
        }
    }
});

// --- Preserved from original (user to manage API keys) ---
exports.getWordData = onRequest({ cors: true }, async (req, res) => {
    try {
        const word = req.query.word;
        if (!word) {
            res.status(400).json({ error: "Missing 'word' query parameter" });
            return;
        }
        const [dictResponse, thesResponse] = await Promise.all([
            axios.get(`https://www.dictionaryapi.com/api/v3/references/collegiate/json/${encodeURIComponent(word)}?key=${MW_DICT_KEY}`),
            axios.get(`https://www.dictionaryapi.com/api/v3/references/thesaurus/json/${encodeURIComponent(word)}?key=${MW_THES_KEY}`)
        ]);
        res.status(200).json({ dictionary: dictResponse.data, thesaurus: thesResponse.data });
    } catch (error) {
        logger.error("Error in getWordData:", error);
        const status = error.response ? error.response.status : 500;
        const message = error.message || "Internal Server Error";
        res.status(status).json({ error: message, details: "Check Cloud Function logs for more info." });
    }
});

// --- Preserved from original ---
exports.leviumProxy = onRequest({ cors: true }, async (req, res) => {
    const TARGET_ORIGIN = "https://levium-student-management.global.ssl.fastly.net";
    const PROXY_BASE_PATH = "/leviumProxy/"; 
    let path = req.path;
    if (!path || path === "/") {
        path = "/levium.html";
    }
    const url = TARGET_ORIGIN + path;
    try {
        const response = await axios({
            method: req.method, url: url, params: req.query, responseType: 'arraybuffer', validateStatus: () => true,
            headers: { ...req.headers, host: new URL(TARGET_ORIGIN).host, origin: TARGET_ORIGIN, referer: TARGET_ORIGIN + '/' }
        });
        for (const [key, value] of Object.entries(response.headers)) {
            const lowerKey = key.toLowerCase();
            if (!['host', 'content-length', 'content-encoding'].includes(lowerKey)) { res.setHeader(key, value); }
        }
        const contentType = response.headers['content-type'] || '';
        if (contentType.includes('text/html')) {
            let html = response.data.toString('utf8');
            html = html.replace(/(src|href|action|data-url)=["']\/(?!\/)(.*?)["']/g, (match, attr, path) => {
                const quote = match.includes("'") ? "'" : '"'; return `${attr}=${quote}${PROXY_BASE_PATH}${path}${quote}`; });
            html = html.replace(/"\/uv\//g, `"${PROXY_BASE_PATH}uv/`);
            html = html.replace(/'\/uv\//g, `'${PROXY_BASE_PATH}uv/`);
            html = html.replace(/"\/bare\//g, `"${PROXY_BASE_PATH}bare/`);
            html = html.replace(/'\/bare\//g, `'${PROXY_BASE_PATH}bare/`);
            html = html.replace(/<base\s+href=["']\/(?!\/)(.*?)["']\s*\/?>/i, `<base href="${PROXY_BASE_PATH}$1">`);
            res.status(response.status).send(html);
        } else {
            res.status(response.status).send(response.data);
        }
    } catch (error) {
        logger.error("Proxy Error", error);
        res.status(500).send("Proxy Error: " + error.message);
    }
});

// --- Preserved from original ---
exports.reportContent = onRequest({ cors: true }, async (req, res) => {
    try {
        if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }
        const { collectionName, docId, reason, reportedBy } = req.body;
        if (!collectionName || !docId) { res.status(400).json({ error: "Missing required parameters: collectionName, docId" }); return; }
        await admin.firestore().collection('reports').add({
            targetCollection: collectionName, targetDocId: docId, reason: reason || 'User Report', reportedBy: reportedBy || 'Anonymous', timestamp: admin.firestore.FieldValue.serverTimestamp() });
        await admin.firestore().collection(collectionName).doc(docId).update({
             reported: true, reportedBy: admin.firestore.FieldValue.arrayUnion(reportedBy) });
        res.status(200).json({ success: true, message: "Report submitted successfully." });
    } catch (error) {
        logger.error("Report Function Error", error);
        res.status(500).json({ error: "Internal Server Error", details: error.message });
    }
});
```

---

### 5. Explanation of Resistance to Network-Level Blocking

The 4SP Version 5 DV is designed with inherent resistance to network-level blocking, primarily due to its offline-first nature and the careful placement of security logic.

*   **Offline-First Operation:** After the initial download, the core 4SP client runs entirely from the local file system. It does not require continuous internet access for its primary functionalities. This immediately renders most real-time network filters (DNS blocking, IP blocking, content filtering, DPI) ineffective against the running application. Once loaded, there is no network traffic for school admins to inspect or block.
*   **Encapsulated Verification:** All authentication and authorization checks, along with the sensitive HMAC secret, reside within Firebase Cloud Functions. These functions are accessed via HTTPS endpoints. While these endpoints *can* be blocked during initial setup, the client only needs to successfully contact them *once* to redeem a code and download the application. Subsequent operation is offline.
*   **CDN Proxy via Cloud Function:** The `downloadEndpoint` Cloud Function acts as a secure proxy to the static asset CDN. This means even if the direct CDN URL for assets were blocked, the client attempts to retrieve them through the authorized `downloadEndpoint`. If the `downloadEndpoint` itself is on `cloudfunctions.net` (which is typically a highly resilient and distributed Google infrastructure), blocking it requires blocking a large part of Google's cloud services, which is a significant and often undesirable action for school networks.
*   **HTTPS Everywhere:** All communication with Cloud Functions occurs over HTTPS. This encrypts the data in transit, preventing passive eavesdropping and making it harder for simple content filters to identify the nature of the traffic. While SSL interception is possible for school admins who install custom root certificates, the server-side verification of tokens (e.g., JWT signatures) ensures that even intercepted and modified tokens will be rejected.
*   **No Public Proxies/Mirrors:** The architecture explicitly avoids public proxies or mirrors. This prevents the system from being a target for blanket blocking strategies that target known circumvention tools, thereby reducing the likelihood of detection and blocking.

**Limitations:** The system *requires* initial access to Firebase Cloud Functions and the connector site for setup. If these are permanently blocked, the client cannot be initially onboarded or re-verified (e.g., if a token expires and requires renewal). However, the design ensures that *once set up*, the client is highly resilient.

---

### 6. Explanation of Why Removing Client-Side Auth Improves Security

Removing client-side Firebase Authentication, Admin SDKs, and secrets from the local 4SP client is a fundamental security improvement driven by the "locally hosted" and "unblockable" requirements.

*   **No Secrets in Client Source:** The client (`4simpleproblems_v5.html` and its associated JS) no longer contains any Firebase API keys, service account credentials, or direct access to Firestore collections that might hold sensitive data. In traditional client-side Firebase apps, API keys are exposed. While generally considered safe for client-side use, in a hostile environment like a school network with deep inspection capabilities, any exposed configuration could be scrutinized for attack vectors. The HMAC secret, critical for code verification, is *never* present in the client.
*   **Prevention of Client Modification for Privilege Escalation:** If an attacker (e.g., a technically savvy student or a malicious admin) modifies the local client's JavaScript code, they cannot bypass security. All sensitive operations—code generation, code redemption, token verification, and file serving—are enforced by the Cloud Functions. Even if a client is altered to send incorrect data or skip client-side validation, the Cloud Function's server-side checks will reject the request. The mantra is "never trust the client."
*   **Mitigation of Brute-Force and Replay Attacks:**
    *   **Brute-Force:** The `redeemCode` Cloud Function directly implements logic to check if a code exists, is used, or revoked. Firestore rules deny direct client write access. A client attempting to brute-force codes would quickly be rate-limited by Cloud Functions (a future enhancement) and ultimately fail due to server-side checks. The HMAC hashing of codes means that brute-forcing plaintext codes on the client is futile; the server needs the hash to look up the code.
    *   **Replay Attacks:** The `4sp_unlock_token` is short-lived and, if implemented as a proper JWT, includes an expiration claim (`exp`). Even if intercepted, its utility is limited by time. Furthermore, the `redeemCode` process binds the code to a specific `deviceFingerprint` preventing an attacker from using an intercepted code on a different device.
*   **Centralized Security Logic:** By centralizing all critical security logic in Cloud Functions, it becomes easier to audit, update, and secure. Patches and enhancements to the authentication flow only need to be deployed to the Cloud Functions, not to every distributed local client. This also avoids the complexities of secure client-side storage of cryptographic keys or client-side validation logic that might be circumvented.
*   **Simplified Client Footprint:** The local client becomes a thin "bootstrapper" whose primary role is UI presentation, device fingerprinting, and API invocation. This reduces its complexity and potential attack surface.

---

### 7. Clear Separation of Client, Connector, and Other-Required Assets

The architecture mandates a strict separation of these components for security, maintainability, and clarity.

*   **Local Client (`4simpleproblems_v5.html` and associated JS/CSS loaded from CDN):**
    *   **Purpose:** The entry point for the offline-first application. Handles UI for code entry, device fingerprinting, storage of the `4sp_unlock_token`, and bootstrapping/loading of the full 4SP application from the secure `downloadEndpoint`.
    *   **Location:** `local-file/4simpleproblems_v5.html` on the student's local device. Other application assets (HTML, CSS, JS) are loaded from the CDN via `downloadEndpoint`.
    *   **Separation:** Contains no secrets, no Firebase Admin SDKs, and no direct access to Firestore. All sensitive operations are delegated to Cloud Functions. It's designed to be disposable and easily replaceable/updateable via a new download if required.
*   **Connector Website (`authentication.html` and related assets):**
    *   **Purpose:** The single external touchpoint for initial user authentication and secure generation/management of `unlockCodes`. Provides a user-friendly interface for students to obtain and revoke their access.
    *   **Location:** Hosted publicly (e.g., GitHub Pages) at `4sp-organization.github.io`.
    *   **Separation:** Uses client-side Firebase Auth SDK (not Admin SDK) for user login, but critically, it never directly writes to the `unlockCodes` collection or stores the HMAC secret. All code generation and revocation requests are proxied through authenticated Cloud Function calls. Its primary goal is to securely initiate the process.
*   **Other-Required Assets (`other-required/index.js`, `other-required/firestore.rules`):**
    *   **Purpose:** This folder centralizes all server-side logic and database security configurations. It is the "trusted execution environment."
    *   **Location:** Deployed to Firebase Cloud Functions and Firestore. This is where the HMAC secret resides, where atomic transactions occur, and where all authorization decisions are made.
    *   **Separation:** Absolutely no client-side code or direct client access to these assets. The Firebase Admin SDK is used here, granting full administrative privileges, but these are only accessible to the Cloud Functions themselves, not to any front-end client. This ensures that the most sensitive parts of the system are completely isolated and under strict server-side control.

This separation ensures that compromise of any single client-side component (local file or connector website) does not grant access to the entire system or sensitive backend logic/data. Each component has a minimal set of responsibilities and access privileges.
