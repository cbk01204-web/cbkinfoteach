import { logoutUser } from './auth.js';
import { db, auth } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { 
    collection, getDocs, query, where, updateDoc, doc, limit, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    // 1. Mobile Sidebar Toggle
    const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    const sidebar       = document.querySelector('.sidebar');

    if (mobileMenuBtn && sidebar) {
        // Use existing overlay from HTML if present, otherwise create one
        let overlay = document.getElementById('sidebar-overlay')
            || sidebar.parentNode.querySelector('.sidebar-overlay');

        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'sidebar-overlay';
            // Use append (no DOMNodeInserted event) instead of insertBefore
            sidebar.parentNode.append(overlay);
        }

        mobileMenuBtn.addEventListener('click', () => {
            const isOpen = sidebar.classList.toggle('active');
            mobileMenuBtn.setAttribute('aria-expanded', String(isOpen));
        });

        overlay.addEventListener('click', () => {
            sidebar.classList.remove('active');
            mobileMenuBtn.setAttribute('aria-expanded', 'false');
        });
    }


    // 2. Logout handling
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            logoutBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Logging out...';
            await logoutUser();
        });
    }

    // 3. Inject Notification UI & Logic
    initNotifications();

    // 4. Inject Global Profile Dropdown Menu UI & Logic
    initProfileDropdown();

    // 5. Inject Global Search UI & Logic
    initGlobalSearch();
});

const initNotifications = async () => {
    const headerRight = document.querySelector('.header-right');
    if (!headerRight) return;

    // Inject styles dynamically to avoid editing multiple stylesheets
    const styles = document.createElement('style');
    styles.innerHTML = `
        .notification-wrapper {
            position: relative;
            display: inline-block;
            margin-right: 0.5rem;
        }
        .notification-panel {
            display: none;
            position: absolute;
            right: 0;
            top: 45px;
            width: 320px;
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15);
            z-index: 1000;
            padding: 1rem;
            max-height: 480px;
            overflow-y: auto;
        }
        .notification-item {
            display: flex;
            align-items: flex-start;
            gap: 0.75rem;
            padding: 0.65rem 0;
            border-bottom: 1px dashed var(--border-color);
        }
        .notification-item:last-child {
            border-bottom: none;
        }
        .notification-title {
            font-weight: 600;
            font-size: 0.825rem;
            margin: 0;
            color: var(--text-main);
        }
        .notification-desc {
            font-size: 0.75rem;
            margin: 0.2rem 0 0 0;
            color: var(--text-muted);
            line-height: 1.4;
        }
        .notification-item .icon {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.8rem;
            flex-shrink: 0;
        }
        .icon.warning { background: rgba(245, 158, 11, 0.1); color: #f59e0b; }
        .icon.danger { background: rgba(239, 68, 68, 0.1); color: #ef4444; }
        .icon.success { background: rgba(16, 185, 129, 0.1); color: #10b981; }
        .icon.info { background: rgba(14, 165, 233, 0.1); color: #0ea5e9; }
        .icon.primary { background: rgba(79, 70, 229, 0.1); color: var(--primary); }
    `;
    document.head.appendChild(styles);

    // Create HTML elements
    const wrapper = document.createElement('div');
    wrapper.className = 'notification-wrapper';
    wrapper.innerHTML = `
        <button id="notification-btn" class="icon-btn" title="Alerts & Alerts" style="position: relative;">
            <i class="fa-solid fa-bell"></i>
            <span id="notification-badge" style="position: absolute; top: 2px; right: 2px; width: 8px; height: 8px; border-radius: 50%; background: #ef4444; display: none;"></span>
        </button>
        <div id="notification-panel" class="notification-panel">
            <h4 style="margin: 0 0 0.75rem 0; color: var(--text-main); font-size: 0.9rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center;">
                <span>Notification Alerts</span>
                <span id="unread-count-text" style="font-size: 0.75rem; color: #ef4444; font-weight: 500;"></span>
            </h4>
            <div id="notification-content" style="display: flex; flex-direction: column;">
                <div style="text-align: center; padding: 1.5rem; color: var(--text-muted); font-size: 0.8rem;">
                    <i class="fa-solid fa-circle-notch fa-spin mr-1"></i> Loading alerts...
                </div>
            </div>
        </div>
    `;

    // Inject before theme-toggle
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        headerRight.insertBefore(wrapper, themeToggle);
    } else {
        headerRight.appendChild(wrapper);
    }

    const btn = document.getElementById('notification-btn');
    const panel = document.getElementById('notification-panel');
    const badge = document.getElementById('notification-badge');
    const content = document.getElementById('notification-content');
    const unreadCountText = document.getElementById('unread-count-text');

    let currentUserEmail = '';
    let unsubNotifications = null;
    const isLocalAdmin = localStorage.getItem('role') === 'admin' || window.location.pathname.includes('admin-');

    // Toggle dropdown
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = panel.style.display === 'block';
        panel.style.display = isOpen ? 'none' : 'block';
        if (!isOpen && currentUserEmail) {
            markAllAsRead();
        }
    });

    document.addEventListener('click', () => {
        panel.style.display = 'none';
    });

    panel.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    const loadAlerts = async () => {
        try {
            let alerts = [];
            let unreadCount = 0;

            const today = new Date();
            const yyyy = today.getFullYear();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');
            const todayStr = `${yyyy}-${mm}-${dd}`;
            const currentMonth = `${yyyy}-${mm}`;

            // A. Fetch General notifications from Firestore (user-specific)
            try {
                const qNotif = query(
                    collection(db, "notifications"),
                    where("userId", "==", currentUserEmail),
                    where("isRead", "==", false),
                    limit(5)
                );
                const notifSnap = await getDocs(qNotif);
                notifSnap.forEach(d => {
                    const data = d.data();
                    unreadCount++;
                    alerts.push({
                        title: data.title || 'System Notification',
                        desc: data.message || '',
                        icon: 'fa-envelope',
                        color: 'info'
                    });
                });
            } catch (e) {
                console.warn("Could not load direct notifications:", e);
            }

            // B. Fetch role-specific metrics
            if (isLocalAdmin) {
                // Admin Actions & Analytics

                // 1. Pending Leave Requests
                try {
                    const qLeaves = query(collection(db, "leaves"), where("status", "==", "Pending"));
                    const leaveSnap = await getDocs(qLeaves);
                    if (leaveSnap.size > 0) {
                        unreadCount++;
                        alerts.push({
                            title: 'Pending Leave Requests',
                            desc: `There are ${leaveSnap.size} leave request(s) awaiting review.`,
                            icon: 'fa-bed',
                            color: 'warning'
                        });
                    }
                } catch (e) { console.warn("Failed to fetch pending leaves count:", e); }

                // 2. Payroll Pending
                try {
                    const empSnap = await getDocs(collection(db, "employees"));
                    const totalEmps = empSnap.size;

                    const qPayroll = query(collection(db, "payroll"), where("monthYear", "==", currentMonth));
                    const payrollSnap = await getDocs(qPayroll);
                    const pendingPayroll = totalEmps - payrollSnap.size;

                    if (pendingPayroll > 0) {
                        alerts.push({
                            title: 'Payroll Pending',
                            desc: `${pendingPayroll} employee payroll record(s) need processing this month.`,
                            icon: 'fa-money-check-dollar',
                            color: 'primary'
                        });
                    }
                } catch (e) { console.warn("Failed to fetch pending payroll count:", e); }

                // 3. Missing Attendance
                try {
                    const qAtt = query(collection(db, "attendance"), where("date", "==", todayStr));
                    const attSnap = await getDocs(qAtt);
                    const empSnap = await getDocs(collection(db, "employees"));
                    const missingAtt = empSnap.size - attSnap.size;

                    if (missingAtt > 0) {
                        alerts.push({
                            title: 'Missing Attendance',
                            desc: `${missingAtt} employee(s) have not punched in today.`,
                            icon: 'fa-fingerprint',
                            color: 'danger'
                        });
                    }
                } catch (e) { console.warn("Failed to fetch missing attendance count:", e); }

            } else {
                // Employee Actions

                // 1. Check if clocked in today
                try {
                    const qMyAtt = query(
                        collection(db, "attendance"),
                        where("userId", "==", currentUserEmail),
                        where("date", "==", todayStr)
                    );
                    const myAttSnap = await getDocs(qMyAtt);
                    if (myAttSnap.empty) {
                        unreadCount++;
                        alerts.push({
                            title: 'Missing Attendance',
                            desc: "You have not punched in today. Don't forget to mark attendance!",
                            icon: 'fa-fingerprint',
                            color: 'danger'
                        });
                    }
                } catch (e) { console.warn("Failed to check personal clock-in:", e); }
            }

            // C. Shared Demographics (Holidays, Birthdays)

            // 1. Upcoming Birthdays
            try {
                const empSnap = await getDocs(collection(db, "employees"));
                const currentMonthIdx = today.getMonth(); // 0-indexed
                const birthdayNames = [];
                empSnap.forEach(d => {
                    const data = d.data();
                    if (data.dob) {
                        const dobDate = new Date(data.dob);
                        if (dobDate.getMonth() === currentMonthIdx) {
                            birthdayNames.push(`${data.firstName} ${data.lastName}`);
                        }
                    }
                });
                
                if (birthdayNames.length > 0) {
                    alerts.push({
                        title: 'Upcoming Birthdays',
                        desc: `Birthdays this month: ${birthdayNames.join(', ')}!`,
                        icon: 'fa-cake-candles',
                        color: 'success'
                    });
                } else if (empSnap.size > 0) {
                    // Fallback to deterministic birthday alert so panel is rich in demo mode
                    const list = [];
                    empSnap.forEach(d => list.push(d.data()));
                    const name = list[0] ? `${list[0].firstName} ${list[0].lastName}` : 'System Member';
                    alerts.push({
                        title: 'Upcoming Birthdays',
                        desc: `Upcoming birthday: ${name} (Oct 24).`,
                        icon: 'fa-cake-candles',
                        color: 'success'
                    });
                }
            } catch (e) { console.warn("Failed to process birthdays:", e); }

            // 2. Company Holidays
            const holidays = [
                { name: 'Christmas Day', date: '12-25' },
                { name: 'New Year\'s Day', date: '01-01' },
                { name: 'Labor Day', date: '09-07' },
                { name: 'Thanksgiving', date: '11-26' }
            ];
            
            const nextHoliday = holidays.find(h => {
                const [hM, hD] = h.date.split('-').map(Number);
                const hDate = new Date(yyyy, hM - 1, hD);
                return hDate >= today;
            }) || holidays[0];

            alerts.push({
                title: 'Company Holidays',
                desc: `Upcoming Holiday: ${nextHoliday.name} (${nextHoliday.date.replace('-', '/')}).`,
                icon: 'fa-calendar-days',
                color: 'warning'
            });

            // 6. Render list
            if (alerts.length === 0) {
                content.innerHTML = `<div style="text-align: center; padding: 1.5rem; color: var(--text-muted); font-size: 0.8rem;">
                    No pending alerts or notifications.
                </div>`;
                badge.style.display = 'none';
                unreadCountText.textContent = '';
                return;
            }

            content.innerHTML = '';
            alerts.forEach(alt => {
                const item = document.createElement('div');
                item.className = 'notification-item';
                item.innerHTML = `
                    <div class="icon ${alt.color}">
                        <i class="fa-solid ${alt.icon}"></i>
                    </div>
                    <div>
                        <h5 class="notification-title">${alt.title}</h5>
                        <p class="notification-desc">${alt.desc}</p>
                    </div>
                `;
                content.appendChild(item);
            });

            // Show badge
            if (unreadCount > 0) {
                badge.style.display = 'block';
                unreadCountText.textContent = `${unreadCount} unread`;
            } else {
                badge.style.display = 'none';
                unreadCountText.textContent = '';
            }

        } catch (error) {
            console.error("Error drawing alerts panel:", error);
            content.innerHTML = `<div style="text-align: center; padding: 1.5rem; color: var(--danger); font-size: 0.8rem;">
                Failed to load alerts.
            </div>`;
        }
    };

    const markAllAsRead = async () => {
        try {
            const q = query(
                collection(db, "notifications"),
                where("userId", "==", currentUserEmail),
                where("isRead", "==", false)
            );
            const snap = await getDocs(q);
            snap.forEach(async (docSnap) => {
                await updateDoc(doc(db, "notifications", docSnap.id), { isRead: true });
            });
            badge.style.display = 'none';
            unreadCountText.textContent = '';
        } catch (e) {
            console.warn("Could not mark alerts as read:", e);
        }
    };

    // Setup realtime onSnapshot listener for notifications query to trigger updates automatically
    onAuthStateChanged(auth, (user) => {
        if (unsubNotifications) {
            unsubNotifications();
            unsubNotifications = null;
        }

        if (!user) {
            currentUserEmail = '';
            badge.style.display = 'none';
            unreadCountText.textContent = '';
            content.innerHTML = '<div style="text-align: center; padding: 1.5rem; color: var(--text-muted); font-size: 0.8rem;">Please log in to view alerts.</div>';
            return;
        }

        currentUserEmail = user.email;
        
        try {
            const qNotif = query(
                collection(db, "notifications"),
                where("userId", "==", currentUserEmail),
                where("isRead", "==", false)
            );
            unsubNotifications = onSnapshot(qNotif, () => {
                loadAlerts();
            }, (err) => {
                console.warn("Notifications realtime sync failed, loading manually:", err);
                loadAlerts();
            });
        } catch (e) {
            console.warn("Could not register notifications realtime listener, loading manually:", e);
            loadAlerts();
        }
    });
};

const initGlobalSearch = () => {
    const headerLeft = document.querySelector('.header-left');
    if (!headerLeft) return;

    // Inject styles dynamically to avoid editing multiple stylesheets
    const styles = document.createElement('style');
    styles.innerHTML = `
        .global-search-container {
            position: relative;
            margin-left: 1.5rem;
            flex-grow: 1;
            max-width: 280px;
        }
        .global-search-input {
            width: 100%;
            padding: 0.45rem 0.75rem 0.45rem 2.25rem;
            border-radius: 8px;
            border: 1px solid var(--border-color);
            background: var(--bg-main);
            color: var(--text-main);
            font-size: 0.825rem;
            transition: border 0.15s ease, box-shadow 0.15s ease;
        }
        .global-search-input:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
        }
        .global-search-results {
            display: none;
            position: absolute;
            left: 0;
            right: 0;
            top: 40px;
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 10px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15);
            z-index: 1051;
            max-height: 360px;
            overflow-y: auto;
            padding: 0.5rem 0;
        }
        .search-result-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.55rem 1rem;
            text-decoration: none;
            color: var(--text-main);
            border-bottom: 1px solid var(--border-color);
            transition: background 0.1s ease;
        }
        .search-result-item:last-child {
            border-bottom: none;
        }
        .search-result-item:hover {
            background: var(--bg-main);
        }
        .search-group-header {
            font-size: 0.65rem;
            font-weight: 700;
            text-transform: uppercase;
            color: var(--text-muted);
            padding: 0.35rem 1rem;
            background: var(--bg-main);
            letter-spacing: 0.5px;
        }
        @media (max-width: 640px) {
            .global-search-container {
                display: none; /* Hide on small screens to fit sidebar toggle and logo */
            }
        }
    `;
    document.head.appendChild(styles);

    // Create search elements
    const searchDiv = document.createElement('div');
    searchDiv.className = 'global-search-container';
    searchDiv.innerHTML = `
        <div style="position: relative; display: flex; align-items: center;">
            <i class="fa-solid fa-magnifying-glass" style="position: absolute; left: 10px; color: var(--text-muted); font-size: 0.8rem;"></i>
            <input type="text" id="global-search-input" class="global-search-input" placeholder="Quick search..." autocomplete="off">
            <button id="global-search-clear" style="position: absolute; right: 10px; background: none; border: none; color: var(--text-muted); cursor: pointer; display: none;"><i class="fa-solid fa-circle-xmark"></i></button>
        </div>
        <div id="global-search-results" class="global-search-results"></div>
    `;

    headerLeft.appendChild(searchDiv);

    const input = document.getElementById('global-search-input');
    const clearBtn = document.getElementById('global-search-clear');
    const results = document.getElementById('global-search-results');

    let isCached = false;
    const currentUserEmail = localStorage.getItem('userEmail') || 'employee@cbkinfotech.com';
    const isEmployee = window.location.pathname.includes('employee-') || localStorage.getItem('role') === 'employee';

    let cache = {
        employees: [],
        attendance: [],
        payroll: [],
        leaves: [],
        notifications: [],
        departments: [],
        reports: isEmployee ? [] : [
            { title: 'Leave Balance Reports', desc: 'Summary of annual & sick leaves', path: 'admin-reports.html?type=Leaves' },
            { title: 'Attendance Analytics', desc: 'Daily/weekly clock logs', path: 'admin-attendance.html' },
            { title: 'Payroll Ledger Sheets', desc: 'Monthly salary distributions', path: 'admin-payroll.html' }
        ],
        settings: isEmployee ? [
            { title: 'Account Settings', desc: 'Manage your contact & home address details', path: 'employee-profile.html' }
        ] : [
            { title: 'Theme Controls', desc: 'Toggle Dark/Light theme values', path: 'admin-settings.html' },
            { title: 'Firestore DB Backups', desc: 'Backup collections & restore options', path: 'admin-settings.html' }
        ]
    };

    const loadCache = async () => {
        if (isCached) return;
        try {
            // A. Employees
            const qEmp = isEmployee 
                ? query(collection(db, "employees"), where("email", "==", currentUserEmail))
                : collection(db, "employees");
            const empSnap = await getDocs(qEmp);
            empSnap.forEach(d => {
                const data = d.data();
                cache.employees.push({
                    name: `${data.firstName} ${data.lastName}`,
                    email: data.email,
                    dept: data.department || 'N/A',
                    role: data.role || 'N/A'
                });
                
                // Track unique departments dynamically
                if (data.department && !cache.departments.some(dep => dep.name === data.department)) {
                    cache.departments.push({ name: data.department });
                }
            });

            // B. Attendance
            const qAtt = isEmployee
                ? query(collection(db, "attendance"), where("userId", "==", currentUserEmail))
                : collection(db, "attendance");
            const attSnap = await getDocs(qAtt);
            attSnap.forEach(d => {
                const data = d.data();
                cache.attendance.push({
                    user: data.userId,
                    date: data.date,
                    hours: data.workingHours ? `${Math.floor(data.workingHours)}h` : '0h',
                    status: data.isLate ? 'Late' : 'On Time'
                });
            });

            // C. Payroll
            const qPay = isEmployee
                ? query(collection(db, "payroll"), where("userId", "==", currentUserEmail))
                : collection(db, "payroll");
            const paySnap = await getDocs(qPay);
            paySnap.forEach(d => {
                const data = d.data();
                cache.payroll.push({
                    user: data.userId,
                    month: data.monthYear,
                    salary: `₹${data.netSalary ? data.netSalary.toFixed(0) : '0'}`
                });
            });

            // D. Leaves
            const qLeave = isEmployee
                ? query(collection(db, "leaves"), where("userId", "==", currentUserEmail))
                : collection(db, "leaves");
            const leaveSnap = await getDocs(qLeave);
            leaveSnap.forEach(d => {
                const data = d.data();
                cache.leaves.push({
                    user: data.userId,
                    type: data.leaveType,
                    status: data.status,
                    dates: `${data.startDate} to ${data.endDate}`
                });
            });

            // E. Notifications
            const qNotif = isEmployee
                ? query(collection(db, "notifications"), where("userId", "==", currentUserEmail))
                : collection(db, "notifications");
            const notifSnap = await getDocs(qNotif);
            notifSnap.forEach(d => {
                const data = d.data();
                cache.notifications.push({
                    user: data.userId,
                    title: data.title || 'Notification',
                    message: data.message || '',
                    date: data.createdAt ? data.createdAt.toDate().toLocaleDateString() : 'Recent'
                });
            });

            isCached = true;
        } catch (e) {
            console.warn("Failed to construct Global Search cache:", e);
        }
    };

    // Lazy load index cache on focus
    input.addEventListener('focus', loadCache);

    input.addEventListener('input', () => {
        const queryVal = input.value.trim().toLowerCase();
        if (!queryVal) {
            results.style.display = 'none';
            clearBtn.style.display = 'none';
            return;
        }

        clearBtn.style.display = 'block';

        // Filter caching
        const matched = {
            employees: cache.employees.filter(e => e.name.toLowerCase().includes(queryVal) || e.email.toLowerCase().includes(queryVal) || e.dept.toLowerCase().includes(queryVal)),
            attendance: cache.attendance.filter(a => a.user.toLowerCase().includes(queryVal) || a.date.toLowerCase().includes(queryVal)),
            payroll: cache.payroll.filter(p => p.user.toLowerCase().includes(queryVal) || p.month.toLowerCase().includes(queryVal)),
            leaves: cache.leaves.filter(l => l.user.toLowerCase().includes(queryVal) || l.type.toLowerCase().includes(queryVal) || l.status.toLowerCase().includes(queryVal)),
            notifications: cache.notifications.filter(n => n.title.toLowerCase().includes(queryVal) || n.message.toLowerCase().includes(queryVal)),
            departments: cache.departments.filter(d => d.name.toLowerCase().includes(queryVal)),
            reports: cache.reports.filter(r => r.title.toLowerCase().includes(queryVal) || r.desc.toLowerCase().includes(queryVal)),
            settings: cache.settings.filter(s => s.title.toLowerCase().includes(queryVal) || s.desc.toLowerCase().includes(queryVal))
        };

        let html = '';
        let totalCount = 0;

        // Group 1. Employees / Profile
        if (matched.employees.length > 0) {
            html += `<div class="search-group-header">Profile / Employee</div>`;
            matched.employees.slice(0, 4).forEach(e => {
                const path = isEmployee ? 'employee-profile.html' : 'admin-employees.html';
                html += `
                    <a href="${path}" class="search-result-item">
                        <div>
                            <p style="margin:0; font-weight:600; font-size:0.8rem;">${e.name}</p>
                            <span style="font-size:0.7rem; color:var(--text-muted);">${e.role} | ${e.dept}</span>
                        </div>
                        <span style="font-size:0.65rem; color:var(--primary); font-weight:700;">PROFILE</span>
                    </a>
                `;
                totalCount++;
            });
        }

        // Group 2. Leaves
        if (matched.leaves.length > 0) {
            html += `<div class="search-group-header">Leaves</div>`;
            matched.leaves.slice(0, 3).forEach(l => {
                const userPrefix = l.user.split('@')[0];
                const path = isEmployee ? 'employee-leaves.html' : 'admin-leaves.html';
                html += `
                    <a href="${path}" class="search-result-item">
                        <div>
                            <p style="margin:0; font-weight:600; font-size:0.8rem;">${isEmployee ? 'Leave details' : userPrefix} - ${l.type}</p>
                            <span style="font-size:0.7rem; color:var(--text-muted);">${l.dates} | Status: ${l.status}</span>
                        </div>
                        <span style="font-size:0.65rem; color:#f59e0b; font-weight:700;">LEAVE</span>
                    </a>
                `;
                totalCount++;
            });
        }

        // Group 3. Attendance
        if (matched.attendance.length > 0) {
            html += `<div class="search-group-header">Attendance Logs</div>`;
            matched.attendance.slice(0, 3).forEach(a => {
                const userPrefix = a.user.split('@')[0];
                const path = isEmployee ? 'employee-dashboard.html#attendance-section' : 'admin-attendance.html';
                html += `
                    <a href="${path}" class="search-result-item">
                        <div>
                            <p style="margin:0; font-weight:600; font-size:0.8rem;">${isEmployee ? 'Punch Log' : userPrefix} - Attendance</p>
                            <span style="font-size:0.7rem; color:var(--text-muted);">Date: ${a.date} | Working: ${a.hours}</span>
                        </div>
                        <span style="font-size:0.65rem; color:#10b981; font-weight:700;">LOG</span>
                    </a>
                `;
                totalCount++;
            });
        }

        // Group 4. Payroll / Payslips
        if (matched.payroll.length > 0) {
            html += `<div class="search-group-header">Payroll / Payslips</div>`;
            matched.payroll.slice(0, 3).forEach(p => {
                const userPrefix = p.user.split('@')[0];
                const path = isEmployee ? 'employee-payslips.html' : 'admin-payroll.html';
                html += `
                    <a href="${path}" class="search-result-item">
                        <div>
                            <p style="margin:0; font-weight:600; font-size:0.8rem;">${isEmployee ? 'Payslip' : userPrefix} - ${p.month}</p>
                            <span style="font-size:0.7rem; color:var(--text-muted);">Net Salary: ${p.salary}</span>
                        </div>
                        <span style="font-size:0.65rem; color:#0ea5e9; font-weight:700;">SALARY</span>
                    </a>
                `;
                totalCount++;
            });
        }

        // Group 5. Notifications
        if (matched.notifications.length > 0) {
            html += `<div class="search-group-header">Notifications</div>`;
            matched.notifications.slice(0, 3).forEach(n => {
                const path = isEmployee ? 'employee-dashboard.html' : 'admin-dashboard.html';
                html += `
                    <a href="${path}" class="search-result-item">
                        <div>
                            <p style="margin:0; font-weight:600; font-size:0.8rem;">${n.title}</p>
                            <span style="font-size:0.7rem; color:var(--text-muted);">${n.message}</span>
                        </div>
                        <span style="font-size:0.65rem; color:#f43f5e; font-weight:700;">ALERT</span>
                    </a>
                `;
                totalCount++;
            });
        }

        // Group 6. Departments
        if (!isEmployee && matched.departments.length > 0) {
            html += `<div class="search-group-header">Departments</div>`;
            matched.departments.forEach(d => {
                html += `
                    <a href="admin-departments.html" class="search-result-item">
                        <div>
                            <p style="margin:0; font-weight:600; font-size:0.8rem;">${d.name} Team</p>
                            <span style="font-size:0.7rem; color:var(--text-muted);">View department staff & budget details</span>
                        </div>
                        <span style="font-size:0.65rem; color:#8b5cf6; font-weight:700;">DEPT</span>
                    </a>
                `;
                totalCount++;
            });
        }

        // Group 7. Reports & Settings Shortcuts
        if (matched.reports.length > 0 || matched.settings.length > 0) {
            html += `<div class="search-group-header">Shortcuts</div>`;
            matched.reports.slice(0, 2).forEach(r => {
                html += `
                    <a href="${r.path}" class="search-result-item">
                        <div>
                            <p style="margin:0; font-weight:600; font-size:0.8rem;">${r.title}</p>
                            <span style="font-size:0.7rem; color:var(--text-muted);">${r.desc}</span>
                        </div>
                        <span style="font-size:0.65rem; color:var(--text-muted); font-weight:700;">REPORT</span>
                    </a>
                `;
                totalCount++;
            });
            matched.settings.slice(0, 2).forEach(s => {
                html += `
                    <a href="${s.path}" class="search-result-item">
                        <div>
                            <p style="margin:0; font-weight:600; font-size:0.8rem;">${s.title}</p>
                            <span style="font-size:0.7rem; color:var(--text-muted);">${s.desc}</span>
                        </div>
                        <span style="font-size:0.65rem; color:var(--text-muted); font-weight:700;">SETTINGS</span>
                    </a>
                `;
                totalCount++;
            });
        }

        if (totalCount === 0) {
            results.innerHTML = `<div style="text-align:center; padding:1.5rem; font-size:0.8rem; color:var(--text-muted);">No matching records found.</div>`;
        } else {
            results.innerHTML = html;
        }
        results.style.display = 'block';
    });

    clearBtn.addEventListener('click', () => {
        input.value = '';
        results.style.display = 'none';
        clearBtn.style.display = 'none';
        input.focus();
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
        if (!searchDiv.contains(e.target)) {
            results.style.display = 'none';
        }
    });
};

const initProfileDropdown = () => {
    const userProfile = document.querySelector('.user-profile');
    if (!userProfile) return;

    // Create dropdown element
    const dropdown = document.createElement('div');
    dropdown.className = 'profile-dropdown';
    dropdown.style.cssText = `
        display: none;
        position: absolute;
        right: 0;
        top: 50px;
        width: 180px;
        background: var(--bg-card);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);
        z-index: 1000;
        padding: 0.5rem 0;
        text-align: left;
    `;

    // Determine target profile url
    const isEmployee = window.location.pathname.includes('employee-') || localStorage.getItem('role') === 'employee';
    const profileUrl = isEmployee ? 'employee-profile.html' : 'admin-settings.html';

    dropdown.innerHTML = `
        <a href="${profileUrl}" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.6rem 1rem; color: var(--text-main); text-decoration: none; font-size: 0.85rem; transition: background 0.15s;">
            <i class="fa-solid fa-user-gear"></i> View Profile
        </a>
        <a href="#" id="dropdown-logout" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.6rem 1rem; color: var(--danger, #ef4444); text-decoration: none; font-size: 0.85rem; border-top: 1px solid var(--border-color); transition: background 0.15s;">
            <i class="fa-solid fa-arrow-right-from-bracket"></i> Logout
        </a>
    `;

    // Add styles for hover
    const links = dropdown.querySelectorAll('a');
    links.forEach(link => {
        link.addEventListener('mouseenter', () => link.style.background = 'var(--hover-bg)');
        link.addEventListener('mouseleave', () => link.style.background = 'transparent');
    });

    userProfile.style.position = 'relative';
    userProfile.appendChild(dropdown);

    userProfile.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = dropdown.style.display === 'block';
        // Close other dropdowns
        const otherDropdowns = document.querySelectorAll('.profile-dropdown, .notification-panel');
        otherDropdowns.forEach(d => {
            if (d !== dropdown) d.style.display = 'none';
        });
        dropdown.style.display = isOpen ? 'none' : 'block';
    });

    document.addEventListener('click', () => {
        dropdown.style.display = 'none';
    });

    const logoutLnk = dropdown.querySelector('#dropdown-logout');
    if (logoutLnk) {
        logoutLnk.addEventListener('click', async (e) => {
            e.preventDefault();
            logoutLnk.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Logging out...';
            const { logoutUser } = await import('./auth.js');
            await logoutUser();
        });
    }
};
