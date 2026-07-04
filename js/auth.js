import { showToast } from './utils.js';
import { auth, db } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, 
    signOut, 
    setPersistence, 
    browserLocalPersistence, 
    browserSessionPersistence,
    sendPasswordResetEmail,
    onAuthStateChanged,
    GoogleAuthProvider,
    signInWithPopup,
    createUserWithEmailAndPassword,
    updateProfile,
    fetchSignInMethodsForEmail
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { doc, getDoc, setDoc, collection, query, where, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// Helper to map Firebase errors to user-friendly messages
const getErrorMessage = (error) => {
    // Log unexpected errors only (exclude standard validation issues to keep console clean)
    const code = error?.code || error?.message || String(error);
    if (code !== 'auth/invalid-credential' && code !== 'auth/wrong-password' && code !== 'auth/user-not-found') {
        console.warn("[HRMS Auth] Detail error log:", error);
    }
    switch (code) {
        case 'permission-denied':
        case 'FirestoreError: permission-denied':
            return 'Firestore Permission Denied. Please update your Firestore Security Rules to allow reading the employees collection: match /employees/{docId} { allow read: if true; }';
        case 'auth/invalid-email':
            return 'Invalid email address format.';
        case 'auth/email-already-in-use':
            return 'This email address is already registered. Please sign in.';
        case 'auth/user-disabled':
            return 'This account has been disabled.';
        case 'auth/user-not-found':
            return 'No user found with this email.';
        case 'auth/wrong-password':
            return 'Incorrect password.';
        case 'auth/invalid-credential':
            return 'Invalid email or password.';
        case 'auth/too-many-requests':
            return 'Too many failed login attempts. Please try again later.';
        case 'auth/network-request-failed':
            return 'Network error. Please check your connection.';
        case 'auth/unauthorized-domain':
            return 'Google Login is not authorized for this domain. Please access the site via http://localhost:5500 instead of 127.0.0.1';
        default:
            return 'An error occurred during authentication. Check browser console for full stack trace.';
    }
};

// Login Function
export const loginUser = async (email, password, rememberMe, expectedRole) => {
    try {
        // Set persistence based on Remember Me
        const persistenceType = rememberMe ? browserLocalPersistence : browserSessionPersistence;
        await setPersistence(auth, persistenceType);

        let user;
        try {
            // Attempt standard Firebase Auth sign in
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            user = userCredential.user;
        } catch (authError) {
            // Fallback for auto-generated temporary password:
            try {
                // Check if user is present in Firestore 'employees' collection
                const q = query(collection(db, "employees"), where("email", "==", email));
                const querySnapshot = await getDocs(q);
                
                let matchDoc = null;
                let oldDocId = null;
                querySnapshot.forEach(d => {
                    const data = d.data();
                    if (data.tempPassword && data.tempPassword === password) {
                        matchDoc = data;
                        oldDocId = d.id;
                    }
                });

                if (matchDoc) {
                    // Pre-created by admin with this temporary password:
                    // Auto-register in Firebase Auth without logging out current context
                    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                    user = userCredential.user;

                    // Sync profile name
                    const fullName = `${matchDoc.firstName || ''} ${matchDoc.lastName || ''}`.trim();
                    if (fullName) {
                        await updateProfile(user, { displayName: fullName });
                    }

                    // Add to 'users' table
                    await setDoc(doc(db, 'users', user.uid), {
                        email: user.email,
                        role: 'employee',
                        fullName: fullName,
                        dob: matchDoc.dob || '',
                        updatedAt: new Date().toISOString()
                    });

                    // Write employee record using user.uid as the document ID
                    await setDoc(doc(db, 'employees', user.uid), {
                        ...matchDoc,
                        uid: user.uid,
                        updatedAt: new Date()
                    });

                    // Clean up old temporary record
                    if (oldDocId && oldDocId !== user.uid) {
                        await deleteDoc(doc(db, 'employees', oldDocId));
                    }

                    console.log("Pre-registered employee successfully activated on login.");
                } else {
                    // No match, throw original auth error
                    throw authError;
                }
            } catch (dbErr) {
                // If database query fails (due to permissions/offline), fallback to original Auth error
                throw authError;
            }
        }

        localStorage.setItem('userRole', expectedRole);
        localStorage.setItem('userEmail', user.email);

        // Redirect based on role
        if (expectedRole === 'admin') {
            window.location.href = 'admin-dashboard.html';
        } else {
            window.location.href = 'employee-dashboard.html';
        }
    } catch (error) {
        throw new Error(getErrorMessage(error));
    }
};

// Register Function
export const registerUser = async (email, password, expectedRole, fullName = '', dob = '') => {
    let user;
    try {
        const methods = await fetchSignInMethodsForEmail(auth, email);
        if (methods && methods.length > 0) {
            // Email is already in use, try logging them in automatically
            try {
                const loginCredential = await signInWithEmailAndPassword(auth, email, password);
                user = loginCredential.user;
            } catch (loginError) {
                throw new Error("This email is already registered. Please switch to Sign In.");
            }
        } else {
            // Email not in use, create user
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            user = userCredential.user;
        }
    } catch (error) {
        throw new Error(getErrorMessage(error));
    }

    // Update auth profile with full name
    if (fullName && user) {
        try {
            await updateProfile(user, { displayName: fullName });
        } catch (profileError) {
            console.warn("Failed to update auth profile:", profileError);
        }
    }

    // Save additional details to Firestore
    if (user) {
        try {
            await setDoc(doc(db, 'users', user.uid), {
                email: user.email,
                role: expectedRole,
                fullName: fullName,
                dob: dob,
                updatedAt: new Date().toISOString()
            });

            // If registering as employee, also create an employee profile document under their UID
            if (expectedRole === 'employee') {
                const nameParts = fullName.trim().split(/\s+/);
                const firstName = nameParts[0] || 'Employee';
                const lastName = nameParts.slice(1).join(' ') || '';
                
                await setDoc(doc(db, 'employees', user.uid), {
                    firstName,
                    lastName,
                    email: user.email,
                    role: 'Employee',
                    department: 'Engineering', // Default department
                    phone: '',
                    empId: `EMP-${Math.floor(1000 + Math.random() * 9000)}`, // Random temporary ID
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    uid: user.uid
                });
            }
        } catch (dbError) {
            console.warn("Could not save to Firestore due to permissions, but user is authenticated:", dbError);
        }
        
        localStorage.setItem('userRole', expectedRole);
        localStorage.setItem('userEmail', user.email);

        if (expectedRole === 'admin') {
            window.location.href = 'admin-dashboard.html';
        } else {
            window.location.href = 'employee-dashboard.html';
        }
    }
};

// Google Login Function
export const loginWithGoogle = async (expectedRole) => {
    try {
        const provider = new GoogleAuthProvider();
        const userCredential = await signInWithPopup(auth, provider);
        const user = userCredential.user;
        
        localStorage.setItem('userRole', expectedRole);
        localStorage.setItem('userEmail', user.email);

        if (expectedRole === 'admin') {
            window.location.href = 'admin-dashboard.html';
        } else {
            window.location.href = 'employee-dashboard.html';
        }
    } catch (error) {
        throw new Error(getErrorMessage(error));
    }
};

// Logout Function
export const logoutUser = async () => {
    try {
        await signOut(auth);
        localStorage.removeItem('userRole');
        localStorage.removeItem('userEmail');
        window.location.href = 'index.html';
    } catch (error) {
        console.error("Logout Error:", error);
        showToast("Failed to log out. Please try again.");
    }
};

// Forgot Password Function
export const resetPassword = async (email) => {
    if (!email) {
        throw new Error("Please enter your email address first.");
    }
    try {
        await sendPasswordResetEmail(auth, email);
        return "Password reset email sent! Check your inbox.";
    } catch (error) {
        throw new Error(getErrorMessage(error));
    }
};

// Route Guard - Prevent unauthorized access
export const checkAuthState = (requiredRole = null) => {
    onAuthStateChanged(auth, (user) => {
        if (!user) {
            // Not logged in — show a gentle overlay instead of instant redirect
            // This keeps the page visible (no blank flash) while prompting login
            showSessionExpiredOverlay(requiredRole);
        } else {
            // User is logged in
            const currentRole = localStorage.getItem('userRole');
            
            // Check if they are authorized for this specific dashboard
            if (requiredRole && currentRole !== requiredRole) {
                console.log(`Unauthorized access. Required: ${requiredRole}, Current: ${currentRole}`);
                if (currentRole === 'admin') {
                    window.location.href = 'admin-dashboard.html';
                } else if (currentRole === 'employee') {
                    window.location.href = 'employee-dashboard.html';
                } else {
                    logoutUser();
                }
            }
            // User is authorized — remove any overlay if it exists
            const overlay = document.getElementById('auth-overlay');
            if (overlay) overlay.remove();
        }
    });
};

// Show a non-blocking session overlay instead of instant redirect
const showSessionExpiredOverlay = (role) => {
    if (document.getElementById('auth-overlay')) return; // Already showing
    const loginPage = role === 'admin' ? 'admin-login.html' : 'employee-login.html';
    const overlay = document.createElement('div');
    overlay.id = 'auth-overlay';
    overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 9999;
        background: rgba(15,23,42,0.85); backdrop-filter: blur(6px);
        display: flex; align-items: center; justify-content: center;
        animation: fadeIn 0.3s ease;
    `;
    overlay.innerHTML = `
        <div style="background:#1e293b; border-radius:16px; padding:2.5rem 3rem; text-align:center;
                    box-shadow:0 25px 50px rgba(0,0,0,0.5); border:1px solid #334155; max-width:380px;">
            <div style="font-size:3rem; margin-bottom:1rem;">🔒</div>
            <h2 style="color:#f8fafc; margin:0 0 0.5rem; font-family:Inter,sans-serif;">Session Required</h2>
            <p style="color:#94a3b8; margin:0 0 1.5rem; font-size:0.9rem; font-family:Inter,sans-serif;">
                Please log in to access this page.
            </p>
            <a href="${loginPage}" style="
                display:inline-block; background:#4f46e5; color:white;
                padding:0.75rem 2rem; border-radius:8px; font-weight:600;
                font-family:Inter,sans-serif; text-decoration:none;
                transition: background 0.2s;">
                Go to Login →
            </a>
        </div>`;
    document.body.appendChild(overlay);
};


/**
 * Standardizes Auth state persistence.
 */
