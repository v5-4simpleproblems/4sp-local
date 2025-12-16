/**
 * ban-enforcer.js (v7.0 - Local Mode)
 *
 * Checks Firestore for ban status based on localStorage UID.
 */

console.log("BanEnforcer (v7.0): Script loaded.");

(function() {
    // Inject Fonts
    if (!document.querySelector('link[href*="fonts.googleapis.com/css2?family=Geist"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap';
        document.head.appendChild(link);
    }
    if (!document.querySelector('link[href*="font-awesome"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css';
        document.head.appendChild(link);
    }
})();

function renderBanVisuals(banData) {
    const shield = document.createElement('div');
    shield.style.cssText = `position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.95);z-index:999999;display:flex;justify-content:center;align-items:center;color:white;font-family:'Geist',sans-serif;flex-direction:column;`;
    
    const msg = document.createElement('div');
    msg.innerHTML = `
        <h1 style="font-size:3rem;color:#ef4444;margin-bottom:1rem;">Access Denied</h1>
        <p style="font-size:1.2rem;">${banData.reason || 'Account Suspended'}</p>
        <p style="margin-top:2rem;font-size:0.8rem;color:#666;">ID: ${banData.uid}</p>
    `;
    
    shield.appendChild(msg);
    document.body.appendChild(shield);
    document.body.style.overflow = 'hidden';
}

document.addEventListener('DOMContentLoaded', () => {
    const uid = localStorage.getItem('4sp_uid');
    if (!uid) return;

    const check = setInterval(() => {
        if (typeof firebase !== 'undefined' && firebase.firestore) {
            clearInterval(check);
            const db = firebase.firestore();
            db.collection('bans').doc(uid).onSnapshot(doc => {
                if (doc.exists) {
                    renderBanVisuals({ uid, ...doc.data() });
                }
            });
        }
    }, 500);
});