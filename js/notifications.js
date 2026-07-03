import { db } from './firebase-config.js';
import { 
    collection, addDoc, updateDoc, doc, query, where, orderBy, onSnapshot, Timestamp, writeBatch, getDocs 
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// Helper to create a notification (callable from any module)
export const createNotification = async (userId, title, message, type) => {
    try {
        await addDoc(collection(db, "notifications"), {
            userId: userId,
            title: title,
            message: message,
            type: type, // 'leave', 'payroll', 'attendance', 'system'
            isRead: false,
            createdAt: Timestamp.now()
        });
        console.log(`Notification created for ${userId}: ${title}`);
    } catch (error) {
        console.error("Error creating notification: ", error);
    }
};

// Main initializer for the Notification UI
export const initNotifications = () => {
    console.log("Notifications UI initialized.");

    const userEmail = localStorage.getItem('userEmail');
    if (!userEmail) return;

    const bellBtn = document.getElementById('notification-bell');
    const dropdown = document.getElementById('notification-dropdown');
    const badge = document.getElementById('notification-badge');
    const list = document.getElementById('notification-list');
    const markAllReadBtn = document.getElementById('mark-all-read');

    if (!bellBtn || !dropdown || !badge || !list) return;

    let unreadCount = 0;
    let currentNotifications = [];

    // Toggle Dropdown
    bellBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('active');
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#notification-wrapper')) {
            dropdown.classList.remove('active');
        }
    });

    // Listen to Notifications in Real-time
    const q = query(
        collection(db, "notifications"),
        where("userId", "==", userEmail),
        orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
        currentNotifications = [];
        unreadCount = 0;

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            currentNotifications.push({ id: docSnap.id, ...data });
            if (!data.isRead) unreadCount++;
        });

        updateUI();
    }, (error) => {
        console.error("Error listening to notifications: ", error);
        // Fallback if missing index:
        // the console will show a link to create the composite index on (userId, createdAt)
    });

    const updateUI = () => {
        // Update Badge
        if (unreadCount > 0) {
            badge.textContent = unreadCount;
            badge.style.display = 'block';
        } else {
            badge.style.display = 'none';
        }

        // Update List
        if (currentNotifications.length === 0) {
            list.innerHTML = `<div style="padding: 1.5rem; text-align: center; color: var(--text-muted);">You have no notifications.</div>`;
            return;
        }

        list.innerHTML = '';
        currentNotifications.forEach(notif => {
            const dateStr = notif.createdAt ? notif.createdAt.toDate().toLocaleString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : 'Just now';
            
            const item = document.createElement('div');
            item.className = `notification-item ${!notif.isRead ? 'unread' : ''}`;
            item.innerHTML = `
                <div class="notification-title">${notif.title}</div>
                <div class="notification-msg">${notif.message}</div>
                <div class="notification-time">${dateStr}</div>
            `;
            
            // Mark as read on click
            if (!notif.isRead) {
                item.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    try {
                        await updateDoc(doc(db, "notifications", notif.id), { isRead: true });
                        // UI will auto-update via onSnapshot
                    } catch (err) {
                        console.error("Failed to mark as read:", err);
                    }
                });
            }

            list.appendChild(item);
        });
    };

    // Mark All Read
    if (markAllReadBtn) {
        markAllReadBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (unreadCount === 0) return;

            try {
                // We use writeBatch for multiple updates
                const unreadDocs = currentNotifications.filter(n => !n.isRead);
                
                // Firestore batches can handle up to 500 ops.
                const batch = writeBatch(db);
                unreadDocs.forEach(notif => {
                    const docRef = doc(db, "notifications", notif.id);
                    batch.update(docRef, { isRead: true });
                });

                await batch.commit();
                console.log("Marked all as read.");
            } catch (err) {
                console.error("Failed to mark all as read:", err);
            }
        });
    }
};
