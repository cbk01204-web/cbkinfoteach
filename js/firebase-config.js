import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-analytics.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-storage.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyClUfYirk8apM1yR9vl17d76wirS1q5pG4",
  authDomain: "cbkinfotech.firebaseapp.com",
  projectId: "cbkinfotech",
  storageBucket: "cbkinfotech.firebasestorage.app",
  messagingSenderId: "724054011487",
  appId: "1:724054011487:web:14372a44700a4367cbf5ea",
  measurementId: "G-5K3K0JKEYB"
};

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Firebase Services
export const analytics = getAnalytics(app);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

console.log("🔥 Firebase initialized successfully (v12.15.0 Modular SDK)");
