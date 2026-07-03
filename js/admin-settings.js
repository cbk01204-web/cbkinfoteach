import { showToast } from './utils.js';
import { db, auth } from './firebase-config.js';
import { 
    collection, getDocs, setDoc, getDoc, doc 
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { 
    updatePassword 
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

export const initAdminSettings = async () => {
    console.log("Admin Settings initialized.");

    // --- Tab Switching Logic ---
    const navItems = document.querySelectorAll('.settings-nav-item');
    const panels = document.querySelectorAll('.settings-panel');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            // Remove active from all
            navItems.forEach(n => n.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));
            
            // Add active to clicked
            item.classList.add('active');
            const targetId = item.getAttribute('data-target');
            document.getElementById(targetId).classList.add('active');
        });
    });

    // --- General Settings (Company Details) ---
    const companyForm = document.getElementById('company-form');
    
    // Load Company Details
    const loadCompanyDetails = async () => {
        try {
            const docSnap = await getDoc(doc(db, "settings", "general"));
            if (docSnap.exists()) {
                const data = docSnap.data();
                document.getElementById('comp-name').value = data.companyName || '';
                document.getElementById('comp-email').value = data.companyEmail || '';
                document.getElementById('comp-phone').value = data.companyPhone || '';
                document.getElementById('comp-address').value = data.companyAddress || '';
            }
        } catch (error) {
            console.error("Error loading company details: ", error);
        }
    };

    companyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('save-company-btn');
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i> Saving...';
        btn.disabled = true;

        try {
            await setDoc(doc(db, "settings", "general"), {
                companyName: document.getElementById('comp-name').value,
                companyEmail: document.getElementById('comp-email').value,
                companyPhone: document.getElementById('comp-phone').value,
                companyAddress: document.getElementById('comp-address').value,
                updatedAt: new Date()
            }, { merge: true });
            
            showToast("Company details saved successfully!");
        } catch (error) {
            console.error("Error saving company details:", error);
            showToast("Failed to save. Check console for details.");
        } finally {
            btn.innerHTML = '<i class="fa-solid fa-save mr-2"></i> Save Changes';
            btn.disabled = false;
        }
    });

    // --- Appearance Settings ---
    const themeSelect = document.getElementById('theme-select');
    const langSelect = document.getElementById('lang-select');

    // Sync init state
    themeSelect.value = localStorage.getItem('theme') || 'light';
    langSelect.value = localStorage.getItem('lang') || 'en';

    themeSelect.addEventListener('change', (e) => {
        const theme = e.target.value;
        localStorage.setItem('theme', theme);
        
        if (theme === 'dark') {
            document.body.classList.add('dark-theme');
            document.getElementById('theme-toggle').innerHTML = '<i class="fa-solid fa-sun"></i>';
        } else {
            document.body.classList.remove('dark-theme');
            document.getElementById('theme-toggle').innerHTML = '<i class="fa-solid fa-moon"></i>';
        }
    });

    langSelect.addEventListener('change', (e) => {
        localStorage.setItem('lang', e.target.value);
        showToast("Language preference saved! Full translation will be available in a future update.");
    });

    // --- Admin Security ---
    const adminSecurityForm = document.getElementById('admin-security-form');
    adminSecurityForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = document.getElementById('admin-new-pwd').value;
        const confirm = document.getElementById('admin-conf-pwd').value;

        if (pwd !== confirm) {
            showToast("Passwords do not match!");
            return;
        }

        const btn = document.getElementById('save-admin-pwd-btn');
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i> Updating...';
        btn.disabled = true;

        try {
            if (auth.currentUser) {
                await updatePassword(auth.currentUser, pwd);
                showToast("Admin password updated successfully!");
                adminSecurityForm.reset();
            } else {
                throw new Error("No authenticated user.");
            }
        } catch (error) {
            if (error.code === 'auth/requires-recent-login') {
                showToast("Security alert: Please log out and log back in to change your admin password.");
            } else {
                showToast("Failed to change password: " + error.message);
            }
        } finally {
            btn.innerHTML = '<i class="fa-solid fa-lock mr-2"></i> Update Password';
            btn.disabled = false;
        }
    });


    // --- Database Backup Engine ---
    const backupBtn = document.getElementById('trigger-backup-btn');
    const backupStatus = document.getElementById('backup-status');

    backupBtn.addEventListener('click', async () => {
        backupBtn.disabled = true;
        backupStatus.style.display = 'block';
        backupStatus.style.color = 'var(--text-main)';
        backupStatus.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i> Initiating backup sequence...';

        try {
            const collectionsToBackup = ["employees", "attendance", "leaves", "payroll", "settings", "notifications"];
            let backupData = {
                timestamp: new Date().toISOString(),
                version: "1.0",
                data: {}
            };

            for (const colName of collectionsToBackup) {
                backupStatus.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin mr-2"></i> Fetching '${colName}' collection...`;
                
                const snap = await getDocs(collection(db, colName));
                backupData.data[colName] = [];
                
                snap.forEach(docSnap => {
                    backupData.data[colName].push({
                        id: docSnap.id,
                        ...docSnap.data()
                    });
                });
            }

            backupStatus.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin mr-2"></i> Compiling JSON...`;
            
            // Generate JSON String
            const jsonString = JSON.stringify(backupData, null, 2);
            const blob = new Blob([jsonString], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            
            // Create temporary anchor to trigger download
            const a = document.createElement('a');
            a.href = url;
            a.download = `cbk-hrms-backup-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            
            // Cleanup
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            backupStatus.style.color = 'var(--success)';
            backupStatus.innerHTML = '<i class="fa-solid fa-check mr-2"></i> Backup downloaded successfully!';

        } catch (error) {
            console.error("Backup failed: ", error);
            backupStatus.style.color = 'var(--danger)';
            backupStatus.innerHTML = '<i class="fa-solid fa-xmark mr-2"></i> Backup failed! Check console.';
        } finally {
            backupBtn.disabled = false;
            setTimeout(() => {
                if(backupStatus.style.color === 'var(--success)') backupStatus.style.display = 'none';
            }, 5000);
        }
    });

    // Initialize
    await loadCompanyDetails();
};

