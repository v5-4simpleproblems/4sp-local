import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "../firebase-config.js"; 

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Check Local Auth
const uid = localStorage.getItem('4sp_uid');
if (!uid) {
    window.location.href = '../authentication.html';
}

const mainView = document.getElementById('settings-main-view');
const sidebarTabs = document.querySelectorAll('.settings-tab');

// Tab Rendering Logic
const renderGeneral = () => {
    mainView.innerHTML = `
        <h2 class="text-2xl font-bold text-white mb-6">General Settings</h2>
        
        <div class="settings-box p-6 mb-6">
            <h3 class="text-xl text-white mb-4">Account Management</h3>
            <p class="text-gray-400 mb-6">
                Your device is linked to your 4SP account. To manage your profile, security, and other account details, please visit the account portal.
            </p>
            <a href="https://v5-4simpleproblems.github.io/web-files/connection.html" target="_blank" 
               class="btn-toolbar-style btn-primary-override px-6 py-3 rounded-xl inline-block text-center">
                <i class="fa-solid fa-external-link-alt mr-2"></i> Open Account Portal
            </a>
        </div>

        <div class="settings-box p-6 border-red-900/50 bg-red-900/10">
            <h3 class="text-xl text-red-500 mb-4">Danger Zone</h3>
            <p class="text-gray-400 mb-6">
                Unlinking this device will remove your access to 4SP on this machine. You will need to generate a new code to reconnect.
            </p>
            <button id="unlinkBtn" class="btn-toolbar-style btn-primary-override-danger px-6 py-3 rounded-xl w-full sm:w-auto">
                <i class="fa-solid fa-unlink mr-2"></i> Unlink Device
            </button>
        </div>
    `;

    document.getElementById('unlinkBtn').addEventListener('click', () => {
        if (confirm("Are you sure you want to unlink this device?")) {
            localStorage.removeItem('4sp_uid');
            localStorage.removeItem('4sp_email');
            localStorage.removeItem('device_fingerprint');
            window.location.href = '../authentication.html';
        }
    });
};

const renderAbout = () => {
    mainView.innerHTML = `
        <h2 class="text-2xl font-bold text-white mb-6">About 4SP</h2>
        <div class="settings-box p-6">
            <p class="text-gray-400">Version 5.0 (Local Client)</p>
            <p class="text-gray-400 mt-2">&copy; 2025 4SimpleProblems</p>
        </div>
    `;
};

// Simple Tab Switcher
sidebarTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        sidebarTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const tabName = tab.dataset.tab;
        
        if (tabName === 'general') renderGeneral();
        else if (tabName === 'about') renderAbout();
        else {
            mainView.innerHTML = `<div class="p-6 text-gray-500">This section is managed via the online portal.</div>`;
        }
    });
});

// Initial Render
renderGeneral();