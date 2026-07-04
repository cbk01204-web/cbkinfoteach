import { showToast } from './utils.js';
import { db, auth, storage } from './firebase-config.js';
import { 
    getDoc, updateDoc, doc 
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { 
    ref, uploadBytes, getDownloadURL 
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-storage.js";
import { 
    updatePassword, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

export const initEmployeeProfile = async () => {
    console.log("Employee Profile initialized.");

    // UI Elements
    const profilePreview = document.getElementById('profile-preview');
    const photoUploadInput = document.getElementById('photo-upload');
    const triggerUploadBtn = document.getElementById('trigger-upload-btn');
    
    const infoForm = document.getElementById('personal-info-form');
    const securityForm = document.getElementById('security-form');

    let currentDocId = null;
    let userEmail = '';

    // Fetch and Populate Data using UID document reference
    const loadProfileData = async (user) => {
        try {
            const docRef = doc(db, "employees", user.uid);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                currentDocId = docSnap.id;
                const data = docSnap.data();

                // Populate Static Info
                document.getElementById('profile-name').textContent = `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'Employee';
                document.getElementById('profile-role').textContent = data.role || 'N/A';
                document.getElementById('profile-id').textContent = data.empId || 'N/A';
                document.getElementById('profile-dept').textContent = data.department || 'N/A';
                document.getElementById('profile-email').textContent = data.email || user.email;

                // Populate Header Info
                document.getElementById('header-name').textContent = `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'Employee';
                document.getElementById('header-role').textContent = data.role || 'N/A';

                // Profile Image
                if (data.photoUrl) {
                    profilePreview.src = data.photoUrl;
                    document.getElementById('header-avatar').innerHTML = `<img src="${data.photoUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
                }

                // Populate Form Fields
                document.getElementById('first-name').value = data.firstName || '';
                document.getElementById('last-name').value = data.lastName || '';
                document.getElementById('phone').value = data.phone || '';
                document.getElementById('address').value = data.address || '';
            } else {
                console.warn(`No profile found in Firestore for UID: ${user.uid}`);
            }
        } catch (error) {
            console.error("Error loading profile:", error);
        }
    };

    onAuthStateChanged(auth, (user) => {
        if (!user) {
            // Redirect to login if unauthenticated
            window.location.href = 'employee-login.html';
            return;
        }
        userEmail = user.email;
        loadProfileData(user);
    });

    // --- Photo Upload Logic ---
    triggerUploadBtn.addEventListener('click', () => {
        photoUploadInput.click();
    });

    photoUploadInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || !currentDocId) return;

        triggerUploadBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
        triggerUploadBtn.disabled = true;

        try {
            // Upload to Storage
            const storageRef = ref(storage, `profilePhotos/${userEmail}_${Date.now()}`);
            await uploadBytes(storageRef, file);
            const downloadUrl = await getDownloadURL(storageRef);

            // Update Firestore
            await updateDoc(doc(db, "employees", currentDocId), {
                photoUrl: downloadUrl
            });

            // Update UI instantly
            profilePreview.src = downloadUrl;
            document.getElementById('header-avatar').innerHTML = `<img src="${downloadUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
            showToast("Profile photo updated successfully!");
        } catch (error) {
            console.error("Error uploading photo:", error);
            showToast("Failed to upload photo. Ensure Storage rules allow uploads.");
        } finally {
            triggerUploadBtn.innerHTML = '<i class="fa-solid fa-camera"></i>';
            triggerUploadBtn.disabled = false;
        }
    });

    // --- Update Personal Info ---
    infoForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentDocId) return;

        const btn = document.getElementById('save-info-btn');
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i> Saving...';
        btn.disabled = true;

        try {
            await updateDoc(doc(db, "employees", currentDocId), {
                phone: document.getElementById('phone').value,
                address: document.getElementById('address').value
            });
            showToast("Personal information updated successfully!");
        } catch (error) {
            console.error("Error updating info:", error);
            showToast("Failed to update information.");
        } finally {
            btn.innerHTML = '<i class="fa-solid fa-save mr-2"></i> Save Changes';
            btn.disabled = false;
        }
    });

    // --- Change Password Logic ---
    securityForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = document.getElementById('new-password').value;
        const confirm = document.getElementById('confirm-password').value;

        if (pwd !== confirm) {
            showToast("Passwords do not match!");
            return;
        }

        const btn = document.getElementById('save-password-btn');
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i> Updating...';
        btn.disabled = true;

        try {
            // Firebase Auth requires recent login for this operation
            if (auth.currentUser) {
                await updatePassword(auth.currentUser, pwd);
                // Keep tempPassword in Firestore synced to support Forgot Password flow
                try {
                    const empRef = doc(db, 'employees', auth.currentUser.uid);
                    await updateDoc(empRef, { tempPassword: pwd });
                } catch (dbErr) {
                    console.warn("Failed to sync new password to employee profile doc:", dbErr);
                }
                showToast("Password updated successfully!");
                securityForm.reset();
            } else {
                throw new Error("No authenticated user found.");
            }
        } catch (error) {
            console.error("Error changing password:", error);
            if (error.code === 'auth/requires-recent-login') {
                showToast("Security alert: Please log out and log back in to change your password.");
            } else {
                showToast("Failed to change password: " + error.message);
            }
        } finally {
            btn.innerHTML = '<i class="fa-solid fa-lock mr-2"></i> Update Password';
            btn.disabled = false;
        }
    });

    await loadProfileData();
};

