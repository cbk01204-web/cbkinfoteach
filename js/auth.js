import { showToast } from './utils.js';
import { auth, db, firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
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
import { doc, getDoc, setDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// Initialize a secondary Firebase Auth instance to create employees without signing out the Admin session
let secondaryAuth = null;
try {
    const secondaryApp = initializeApp(firebaseConfig, "SecondaryApp");
    secondaryAuth = getAuth(secondaryApp);
} catch (err) {
    console.warn("Secondary Auth initialization check:", err);
}

function getAuth(appInstance) {
    const { getAuth: fbGetAuth } = requirefbAuth();
    return fbGetAuth(appInstance);
}

function requirefbAuth() {
    return {
        getAuth: (app) => {
            const { getAuth } = AuthSDK;
            return getAuth(app);
        }
    };
}

const AuthSDK = {
    getAuth: (app) => {
        return getAuthFromSDK(app);
    }
};

function getAuthFromSDK(app) {
    try {
        const { getAuth: fbGetAuth } = window.firebaseAuth || {};
        if (fbGetAuth) return fbGetAuth(app);
    } catch (e) {}
    return getAuthDirect(app);
}

import { getAuth as getAuthDirect } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

// Helper to map Firebase errors to user-friendly messages
const getErrorMessage = (error) => {
    const code = error?.code || error?.message || String(error);
    switch (code) {
        case 'permission-denied':
        case 'FirestoreError: permission-denied':
            return 'Firestore Permission Denied. Please check your Firestore security rules configuration.';
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
            return 'This domain is not authorized for Firebase Authentication.';
        default:
            return code;
    }
};

// Login Function (Clean, using signInWithEmailAndPassword only)
export const loginUser = async (email, password, rememberMe, expectedRole) => {
    // Set persistence based on Remember Me
    const persistenceType = rememberMe ? browserLocalPersistence : browserSessionPersistence;
    await setPersistence(auth, persistenceType);

    try {
        // Attempt standard Firebase Auth sign in
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Fetch user document from Firestore 'users' collection to check role
        const userDocRef = doc(db, 'users', user.uid);
        const userDocSnap = await getDoc(userDocRef);

        let role = null;
        if (userDocSnap.exists()) {
            role = userDocSnap.data().role;
        } else {
            // Fallback to employees collection check
            const empDocRef = doc(db, 'employees', user.uid);
            const empDocSnap = await getDoc(empDocRef);
            if (empDocSnap.exists()) {
                role = empDocSnap.data().role || 'employee';
            } else {
                await signOut(auth);
                throw new Error("Unauthorized access. User profile not found.");
            }
        }

        // Validate role matches expected login portal
        if (expectedRole && role !== expectedRole) {
            await signOut(auth);
            throw new Error(`Access denied. You do not have permission to access the ${expectedRole} portal.`);
        }

        // Check active/disabled status from employees collection
        const empDocRef = doc(db, 'employees', user.uid);
        const empDocSnap = await getDoc(empDocRef);
        if (empDocSnap.exists()) {
            const empData = empDocSnap.data();
            if (empData.status && empData.status.toLowerCase() === 'disabled') {
                await signOut(auth);
                throw new Error("Account is disabled. Please contact the administrator.");
            }
        }

        localStorage.setItem('userRole', role || '');
        localStorage.setItem('userEmail', user.email);

        // Redirect based on role
        if (role === 'admin') {
            window.location.href = 'admin-dashboard.html';
        } else {
            window.location.href = 'employee-dashboard.html';
        }
        return user;
    } catch (error) {
        throw new Error(getErrorMessage(error));
    }
};

// Disabled Self-Registration (Blocks direct registration attempts)
export const registerUser = async (email, password, expectedRole, fullName = '', dob = '') => {
    throw new Error("Self-registration is disabled. Please request an administrator to create your account.");
};

// Function to register a new employee from the Admin Portal (using Secondary App to avoid logging out the Admin)
export const registerEmployeeFromAdmin = async (empData, password) => {
    if (!secondaryAuth) {
        try {
            const secondaryApp = initializeApp(firebaseConfig, "SecondaryApp");
            secondaryAuth = getAuth(secondaryApp);
        } catch (err) {
            console.error("Secondary app init error:", err);
            throw new Error("Secondary Authentication service is not initialized.");
        }
    }

    const email = empData.email.trim();
    
    // Prevent duplicate email creation - check Firestore users collection
    const usersQuery = query(collection(db, "users"), where("email", "==", email));
    const usersSnap = await getDocs(usersQuery);
    if (!usersSnap.empty) {
        throw new Error("An account with this email address already exists.");
    }

    try {
        // Create the user in Firebase Auth
        const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
        const user = userCredential.user;

        // Update their auth profile display name
        const fullName = `${empData.firstName} ${empData.lastName}`.trim();
        await updateProfile(user, { displayName: fullName });

        // Save to 'users' collection
        await setDoc(doc(db, 'users', user.uid), {
            email: user.email,
            role: 'employee',
            fullName: fullName,
            dob: empData.dob || '',
            updatedAt: new Date().toISOString()
        });

        // Save to 'employees' collection using user.uid as Document ID
        const employeeDocData = {
            uid: user.uid,
            email: user.email,
            firstName: empData.firstName,
            lastName: empData.lastName,
            phone: empData.phone || '',
            department: empData.department,
            designation: empData.role || '',
            role: 'employee',
            joiningDate: empData.joiningDate || new Date().toISOString().split('T')[0],
            salary: Number(empData.salary) || 50000,
            status: empData.status || 'Active',
            empId: empData.empId,
            tempPassword: password,
            createdAt: empData.createdAt || new Date(),
            updatedAt: new Date()
        };
        if (empData.photoUrl) {
            employeeDocData.photoUrl = empData.photoUrl;
        }

        await setDoc(doc(db, 'employees', user.uid), employeeDocData);
        console.log(`Pre-registered employee ${fullName} successfully created with UID: ${user.uid}`);
        return user;
    } catch (error) {
        throw new Error(getErrorMessage(error));
    }
};

// Google Login Function
export const loginWithGoogle = async (expectedRole) => {
    try {
        const provider = new GoogleAuthProvider();
        const userCredential = await signInWithPopup(auth, provider);
        const user = userCredential.user;

        // Fetch user document from Firestore 'users' collection to check role
        const userDocRef = doc(db, 'users', user.uid);
        const userDocSnap = await getDoc(userDocRef);

        let role = expectedRole;
        if (userDocSnap.exists()) {
            role = userDocSnap.data().role;
        } else {
            // Write default user document if login with Google is clean
            await setDoc(userDocRef, {
                email: user.email,
                role: expectedRole,
                fullName: user.displayName || 'Google User',
                updatedAt: new Date().toISOString()
            });
        }

        // Verify role match
        if (expectedRole && role !== expectedRole) {
            await signOut(auth);
            throw new Error(`Access denied. You do not have permission to access the ${expectedRole} portal.`);
        }

        localStorage.setItem('userRole', role);
        localStorage.setItem('userEmail', user.email);

        if (role === 'admin') {
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
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            showSessionExpiredOverlay(requiredRole);
        } else {
            try {
                // Securely retrieve role from Firestore directly to block local storage manipulation
                const userDocRef = doc(db, 'users', user.uid);
                const userDocSnap = await getDoc(userDocRef);
                
                let currentRole = null;
                let status = 'Active';

                if (userDocSnap.exists()) {
                    currentRole = userDocSnap.data().role;
                } else {
                    // Fallback to employees collection
                    const empDocRef = doc(db, 'employees', user.uid);
                    const empDocSnap = await getDoc(empDocRef);
                    if (empDocSnap.exists()) {
                        currentRole = empDocSnap.data().role || 'employee';
                        status = empDocSnap.data().status || 'Active';
                    }
                }

                // Check active status
                const empDocRef = doc(db, 'employees', user.uid);
                const empDocSnap = await getDoc(empDocRef);
                if (empDocSnap.exists()) {
                    status = empDocSnap.data().status || 'Active';
                }

                if (status && status.toLowerCase() === 'disabled') {
                    console.warn("User account is marked disabled. Revoking access.");
                    await signOut(auth);
                    showSessionExpiredOverlay(requiredRole);
                    return;
                }

                if (requiredRole && currentRole !== requiredRole) {
                    console.warn(`Role bypass detected. Required: ${requiredRole}, Current: ${currentRole}`);
                    if (currentRole === 'admin') {
                        window.location.href = 'admin-dashboard.html';
                    } else if (currentRole === 'employee') {
                        window.location.href = 'employee-dashboard.html';
                    } else {
                        await signOut(auth);
                        showSessionExpiredOverlay(requiredRole);
                    }
                } else {
                    localStorage.setItem('userRole', currentRole || '');
                    localStorage.setItem('userEmail', user.email);

                    // Remove lock overlay if authorized
                    const overlay = document.getElementById('auth-overlay');
                    if (overlay) overlay.remove();
                }
            } catch (err) {
                console.error("Route guard verification failed:", err);
                const currentRole = localStorage.getItem('userRole');
                if (requiredRole && currentRole !== requiredRole) {
                    showSessionExpiredOverlay(requiredRole);
                }
            }
        }
    });
};

// Show a non-blocking session overlay instead of instant redirect
const showSessionExpiredOverlay = (role) => {
    if (document.getElementById('auth-overlay')) return;
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
