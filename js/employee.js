/**
 * CBK INFOTECH HRMS — Employee Dashboard Engine
 * 
 * Firebase Connections:
 *  - employees    → Profile name, role, photo, leave balance
 *  - attendance   → Current day's punch in/out, monthly working hours, activity feed
 *  - leaves       → Recent leave applications, activity feed
 *  - payroll      → Latest payslip, activity feed
 *  - notifications→ Live user notifications list
 */

import { showToast } from './utils.js';
import { db, auth } from './firebase-config.js';
import { 
    collection, addDoc, updateDoc, setDoc, doc, query, where, Timestamp, onSnapshot, orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { createNotification } from './notifications.js';

// Caches and unsubscribes for real-time memory management
let cacheEmployeeInfo = null;
let cacheUsedLeaves = 0;
const _unsubs = [];

export const initEmployeeDashboard = async () => {
    console.log("[HRMS] Employee dashboard initialized.");

    // ── 1. Set Localized Date ─────────────────────────────────────────
    const dateEl = document.getElementById('current-date');
    if (dateEl) {
        dateEl.textContent = new Date().toLocaleDateString(undefined, {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });
    }

    // ── 2. Handle theme toggle setup ──────────────────────────────────
    const themeToggleBtn = document.getElementById('theme-toggle');
    const body = document.body;
    if (localStorage.getItem('theme') === 'dark') {
        body.classList.add('dark-theme');
        if (themeToggleBtn) themeToggleBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
    } else {
        if (themeToggleBtn) themeToggleBtn.innerHTML = '<i class="fa-solid fa-moon"></i>';
    }
    themeToggleBtn?.addEventListener('click', () => {
        body.classList.toggle('dark-theme');
        const isDark = body.classList.contains('dark-theme');
        themeToggleBtn.innerHTML = isDark ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
    });

    // ── 3. Bind navigation click events to stats cards ────────────────
    const payslipCard = document.querySelector('.stats-grid > div:nth-child(3)');
    if (payslipCard) {
        payslipCard.addEventListener('click', () => {
            window.location.href = 'employee-payslips.html';
        });
    }

    const profileCard = document.querySelector('.stats-grid > div:nth-child(4)');
    if (profileCard) {
        profileCard.addEventListener('click', () => {
            window.location.href = 'employee-profile.html';
        });
    }

    // ── 4. Resolve user context and listen to auth state ──────────────
    onAuthStateChanged(auth, (user) => {
        if (!user) {
            // Clean up listeners if logged out
            _unsubs.forEach(un => un());
            _unsubs.length = 0;
            return;
        }

        // Clean up previous listeners if any (re-auth safety)
        _unsubs.forEach(un => un());
        _unsubs.length = 0;

        // Establish real-time snapshot sync
        startRealtimeSync(user);
    });
};

// ─────────────────────────────────────────────────────────────────────
// REAL-TIME FIRESTORE SNAPS
// ─────────────────────────────────────────────────────────────────────
const startRealtimeSync = (user) => {
    const userEmail = user.email;
    
    // Construct local calendar date string to avoid timezone offset shifts
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;

    // ── A. Listen to Employee record directly using user's Auth UID ──
    const unsubEmp = onSnapshot(
        doc(db, "employees", user.uid),
        (docSnap) => {
            if (docSnap.exists()) {
                cacheEmployeeInfo = { id: docSnap.id, ...docSnap.data() };
                updateProfileHeader(cacheEmployeeInfo);
                updateStatsOverview(cacheEmployeeInfo);
            } else {
                console.warn(`No employee profile document found for UID: ${user.uid}. Initializing self-healing fallback...`);
                
                const fallbackDoc = {
                    firstName: user.displayName ? user.displayName.split(' ')[0] : 'Employee',
                    lastName: user.displayName ? user.displayName.split(' ').slice(1).join(' ') : '',
                    email: user.email || userEmail,
                    role: 'Staff Member',
                    department: 'General',
                    phone: '',
                    empId: `EMP-${Math.floor(1000 + Math.random() * 9000)}`,
                    leaveBalance: 14,
                    createdAt: Timestamp.now(),
                    updatedAt: Timestamp.now(),
                    uid: user.uid
                };

                setDoc(doc(db, "employees", user.uid), fallbackDoc)
                    .then(() => console.log("Successfully created self-healing employee profile document."))
                    .catch(err => console.error("Failed to create fallback profile:", err));
            }
        },
        (err) => console.error("Employee info sync failed:", err)
    );
    _unsubs.push(unsubEmp);

    // ── B. Listen to Today's Attendance State ───────────────────────
    const unsubTodayAttendance = onSnapshot(
        query(collection(db, "attendance"), where("userId", "==", userEmail), where("date", "==", todayStr)),
        (snap) => {
            handleAttendanceUI(snap, userEmail, todayStr);
        },
        (err) => console.error("Today's attendance sync failed:", err)
    );
    _unsubs.push(unsubTodayAttendance);

    // ── C. Listen to Monthly Working Hours (Current Month) ──────────
    // Single-property query avoids index dependency: filter by date client-side
    const startOfMonth = todayStr.substring(0, 7) + "-01";
    const unsubMonthlyHours = onSnapshot(
        query(collection(db, "attendance"), where("userId", "==", userEmail)),
        (snap) => {
            const monthlyDocs = [];
            snap.forEach(d => {
                const data = d.data();
                if (data.date >= startOfMonth) {
                    monthlyDocs.push(d);
                }
            });
            calculateMonthlyHours(monthlyDocs);
        },
        (err) => console.error("Monthly hours sync failed:", err)
    );
    _unsubs.push(unsubMonthlyHours);

    // ── D. Listen to Latest Payslip ─────────────────────────────────
    // Single-property query avoids index dependency: sort desc client-side to find the latest
    const unsubPayroll = onSnapshot(
        query(collection(db, "payroll"), where("userId", "==", userEmail)),
        (snap) => {
            let latestDoc = null;
            snap.forEach(d => {
                const data = d.data();
                if (!latestDoc || (data.monthYear && data.monthYear > (latestDoc.monthYear || ''))) {
                    latestDoc = data;
                }
            });
            handlePayslipWidget(latestDoc);
        },
        (err) => console.error("Payroll sync failed:", err)
    );
    _unsubs.push(unsubPayroll);

    // ── E. Listen to Leaves collection to calculate balance ──────────
    const unsubLeaves = onSnapshot(
        query(collection(db, "leaves"), where("userId", "==", userEmail)),
        (snap) => {
            let usedLeaves = 0;
            snap.forEach(d => {
                const data = d.data();
                if (data.status === 'Approved') {
                    const start = new Date(data.startDate);
                    const end = new Date(data.endDate);
                    if (!isNaN(start) && !isNaN(end)) {
                        const days = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
                        usedLeaves += days;
                    }
                }
            });
            cacheUsedLeaves = usedLeaves;
            calculateAndDisplayLeaves();
        },
        (err) => console.error("Leaves balance sync failed:", err)
    );
    _unsubs.push(unsubLeaves);

    // ── F. Listen to Recent Activities (attendance, leaves, payroll, profile) ──
    startActivityFeedListener(user);

    // ── G. Listen to Dashboard Alerts Panel ────────────────────────
    startNotificationsPanelListener(userEmail);
};

// ─────────────────────────────────────────────────────────────────────
// ATTENDANCE CORE HANDLER
// ─────────────────────────────────────────────────────────────────────
const handleAttendanceUI = (snap, userEmail, dateString) => {
    const punchInBtn      = document.getElementById('punch-in-btn');
    const punchOutBtn     = document.getElementById('punch-out-btn');
    const breakBtn        = document.getElementById('break-btn');
    const statusBadge     = document.getElementById('status-badge');
    const checkInTimeEl   = document.getElementById('check-in-time');
    const checkOutTimeEl  = document.getElementById('check-out-time');
    const totalHoursEl    = document.getElementById('total-hours');
    const totalBreakEl    = document.getElementById('total-break');
    const todayOvertimeEl = document.getElementById('today-overtime');
    const todayStatusEl   = document.getElementById('today-status');

    if (!punchInBtn || !punchOutBtn) return;

    let activeDocId = null;
    let punchInTime = null;

    // Reset default views
    checkInTimeEl.textContent  = "--:-- AM";
    checkOutTimeEl.textContent = "--:-- PM";
    totalHoursEl.textContent    = "0h 0m";
    if (totalBreakEl) totalBreakEl.textContent = "0h 0m";
    if (breakBtn) breakBtn.style.display = 'none';
    if (todayOvertimeEl) todayOvertimeEl.textContent = "0h 0m";
    if (todayStatusEl) {
        todayStatusEl.textContent = "—";
        todayStatusEl.style.color = "var(--text-main)";
    }

    if (!snap.empty) {
        const docSnap = snap.docs[0];
        activeDocId = docSnap.id;
        const data = docSnap.data();

        punchInTime = data.punchIn?.toDate();
        if (punchInTime) {
            checkInTimeEl.textContent = punchInTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        if (totalBreakEl) {
            const btHours = Math.floor(data.breakTime || 0);
            const btMins  = Math.round(((data.breakTime || 0) - btHours) * 60);
            totalBreakEl.textContent = `${btHours}h ${btMins}m`;
        }

        if (data.punchOut) {
            // Completed for today
            const punchOutTime = data.punchOut.toDate();
            checkOutTimeEl.textContent = punchOutTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            punchInBtn.disabled     = true;
            punchOutBtn.disabled    = true;
            if (breakBtn) breakBtn.style.display = 'none';
            statusBadge.className   = 'badge badge-success';
            statusBadge.style.background = 'rgba(16,185,129,0.12)';
            statusBadge.style.color = '#10b981';
            statusBadge.textContent = 'Completed';

            const hours = Math.floor(data.workingHours || 0);
            const mins  = Math.round(((data.workingHours || 0) - hours) * 60);
            totalHoursEl.textContent = `${hours}h ${mins}m`;

            if (todayOvertimeEl) {
                const otHours = Math.floor(data.overtimeHours || 0);
                const otMins  = Math.round(((data.overtimeHours || 0) - otHours) * 60);
                todayOvertimeEl.textContent = `${otHours}h ${otMins}m`;
            }

            if (todayStatusEl) {
                let statusStr = data.isLate ? 'Late Check In' : 'On Time';
                if (data.isEarlyExit) statusStr += ', Early Exit';
                todayStatusEl.textContent = statusStr;
                todayStatusEl.style.color = (data.isLate || data.isEarlyExit) ? '#f59e0b' : '#10b981';
            }
        } else {
            // Punched In
            const breaks = data.breaks || [];
            const isOnBreak = breaks.length > 0 && !breaks[breaks.length - 1].end;

            if (isOnBreak) {
                // On Break State
                punchInBtn.disabled     = true;
                punchOutBtn.disabled    = true;
                statusBadge.className   = 'badge badge-warning';
                statusBadge.style.background = 'rgba(245,158,11,0.12)';
                statusBadge.style.color = '#f59e0b';
                statusBadge.textContent = 'On Break';

                if (breakBtn) {
                    breakBtn.style.display = 'inline-flex';
                    breakBtn.innerHTML = '<i class="fa-solid fa-play mr-2"></i> End Break';
                    breakBtn.className = 'btn btn-primary';
                    breakBtn.style.marginTop = '1rem';
                }
            } else {
                // Working State
                punchInBtn.disabled     = true;
                punchOutBtn.disabled    = false;
                statusBadge.className   = 'badge badge-primary';
                statusBadge.style.background = 'rgba(79,70,229,0.12)';
                statusBadge.style.color = '#4f46e5';
                statusBadge.textContent = 'Punched In';

                if (breakBtn) {
                    breakBtn.style.display = 'inline-flex';
                    breakBtn.innerHTML = '<i class="fa-solid fa-mug-hot mr-2"></i> Start Break';
                    breakBtn.className = 'btn btn-outline';
                    breakBtn.style.marginTop = '1rem';
                }
            }

            if (todayStatusEl) {
                todayStatusEl.textContent = data.isLate ? 'Late Check In' : 'On Time';
                todayStatusEl.style.color = data.isLate ? '#f59e0b' : '#10b981';
            }
        }

        // Bind break button action
        if (breakBtn) {
            breakBtn.onclick = async () => {
                if (!activeDocId) return;

                const breaks = data.breaks || [];
                const isOnBreak = breaks.length > 0 && !breaks[breaks.length - 1].end;
                const now = new Date();

                breakBtn.disabled = true;
                if (isOnBreak) {
                    breakBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i> Ending Break...';
                    try {
                        const lastBreak = breaks[breaks.length - 1];
                        lastBreak.end = Timestamp.fromDate(now);

                        const start = lastBreak.start.toDate();
                        const diffMs = now - start;
                        const breakHours = diffMs / (1000 * 60 * 60);

                        const totalBreakHours = (data.breakTime || 0) + breakHours;

                        await updateDoc(doc(db, "attendance", activeDocId), {
                            breaks: breaks,
                            breakTime: totalBreakHours
                        });
                        showToast("Break ended, back to work!");
                    } catch (err) {
                        console.error("Error ending break:", err);
                        showToast("Failed to end break.");
                        breakBtn.disabled = false;
                    }
                } else {
                    breakBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i> Starting Break...';
                    try {
                        const updatedBreaks = [...breaks, { start: Timestamp.fromDate(now), end: null }];
                        await updateDoc(doc(db, "attendance", activeDocId), {
                            breaks: updatedBreaks
                        });
                        showToast("Break started. Enjoy!");
                    } catch (err) {
                        console.error("Error starting break:", err);
                        showToast("Failed to start break.");
                        breakBtn.disabled = false;
                    }
                }
            };
        }

    } else {
        // Not punched in yet
        punchInBtn.disabled     = false;
        punchOutBtn.disabled    = true;
        if (breakBtn) breakBtn.style.display = 'none';
        statusBadge.className   = 'badge badge-warning';
        statusBadge.style.background = 'rgba(245,158,11,0.12)';
        statusBadge.style.color = '#f59e0b';
        statusBadge.textContent = 'Not Punched In';
        
        // Reminder trigger once a day
        const currentHour = new Date().getHours();
        const reminderKey = `att_rem_${dateString}_${userEmail}`;
        if (currentHour >= 9 && !localStorage.getItem(reminderKey)) {
            createNotification(userEmail, "Attendance Reminder", "Don't forget to punch in for today's shift!", "attendance");
            localStorage.setItem(reminderKey, "true");
        }
    }

    // Bind action listeners (only once, clean previous to avoid stack buildup)
    punchInBtn.onclick = async () => {
        const now = new Date();
        punchInBtn.disabled = true;
        punchInBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i> Punching In...';

        try {
            const shiftStart = new Date();
            shiftStart.setHours(9, 15, 0); // Late threshold
            const isLate = now > shiftStart;

            await addDoc(collection(db, "attendance"), {
                userId: userEmail,
                date: dateString,
                punchIn: Timestamp.fromDate(now),
                punchOut: null,
                isLate: isLate,
                workingHours: 0,
                breakTime: 0,
                breaks: [],
                overtimeHours: 0,
                isEarlyExit: false
            });
            showToast("Punched in successfully!");
        } catch (err) {
            console.error("Error punching in:", err);
            showToast("Failed to punch in. Try again.");
            punchInBtn.disabled = false;
        } finally {
            punchInBtn.innerHTML = '<i class="fa-solid fa-fingerprint mr-2"></i> Punch In';
        }
    };

    punchOutBtn.onclick = async () => {
        if (!activeDocId || !punchInTime) return;
        punchOutBtn.disabled = true;
        punchOutBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i> Punching Out...';

        try {
            const now = new Date();
            const diffMs = now - punchInTime;
            let workingHours = diffMs / (1000 * 60 * 60);

            // Subtract total break time
            const docSnap = await getDoc(doc(db, "attendance", activeDocId));
            const freshData = docSnap.exists() ? docSnap.data() : {};
            const breakTime = freshData.breakTime || 0;
            workingHours = Math.max(0, workingHours - breakTime);

            const shiftEnd = new Date();
            shiftEnd.setHours(17, 45, 0); // Early exit threshold
            const isEarlyExit = now < shiftEnd;
            const overtimeHours = workingHours > 8 ? workingHours - 8 : 0;

            await updateDoc(doc(db, "attendance", activeDocId), {
                punchOut: Timestamp.fromDate(now),
                workingHours: workingHours,
                overtimeHours: overtimeHours,
                isEarlyExit: isEarlyExit
            });
            showToast("Punched out successfully!");
        } catch (err) {
            console.error("Error punching out:", err);
            showToast("Failed to punch out.");
            punchOutBtn.disabled = false;
        } finally {
            punchOutBtn.innerHTML = '<i class="fa-solid fa-arrow-right-from-bracket mr-2"></i> Punch Out';
        }
    };
};

// ─────────────────────────────────────────────────────────────────────
// UPDATE PROFILE INFO
// ─────────────────────────────────────────────────────────────────────
const updateProfileHeader = (emp) => {
    const nameEls = document.querySelectorAll('.user-info p');
    const roleEls = document.querySelectorAll('.user-info span');
    const avatarEl = document.querySelector('.user-profile .avatar');

    const fullName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || 'Employee';
    const role     = emp.role || 'Designation';

    nameEls.forEach(el => el.textContent = fullName);
    roleEls.forEach(el => el.textContent = role);

    if (avatarEl) {
        if (emp.photoUrl) {
            avatarEl.innerHTML = `<img src="${emp.photoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="Avatar">`;
        } else {
            const init = `${(emp.firstName || '?').charAt(0)}${(emp.lastName || '').charAt(0)}`.toUpperCase();
            avatarEl.style.background = 'linear-gradient(135deg, #10b981, #34d399)';
            avatarEl.textContent = init;
        }
    }
};

// ─────────────────────────────────────────────────────────────────────
// CALCULATE WORKING HOURS & UPDATE STATS
// ─────────────────────────────────────────────────────────────────────
const calculateMonthlyHours = (snap) => {
    let totalMins = 0;
    let overtimeMins = 0;

    snap.forEach(d => {
        const data = d.data();
        if (data.workingHours) {
            totalMins += Math.round(data.workingHours * 60);
        }
        if (data.overtimeHours) {
            overtimeMins += Math.round(data.overtimeHours * 60);
        }
    });

    const totalHours = (totalMins / 60).toFixed(0);
    const overtimeHours = (overtimeMins / 60).toFixed(0);

    const hoursCard = document.querySelector('.stats-grid > div:nth-child(1)');
    if (hoursCard) {
        hoursCard.querySelector('h3').textContent = `${totalHours}h`;
        const trendEl = hoursCard.querySelector('.stat-trend');
        if (trendEl) {
            trendEl.innerHTML = overtimeHours > 0 
                ? `<i class="fas fa-arrow-up"></i> +${overtimeHours}h overtime`
                : `<i class="fas fa-check"></i> Standard hours`;
            trendEl.className = `stat-trend ${overtimeHours > 0 ? 'trend-up' : 'text-muted'}`;
        }
    }
};

// ─────────────────────────────────────────────────────────────────────
// UPDATE OTHER STATS (Leaves balance, profile completion)
// ─────────────────────────────────────────────────────────────────────
const calculateAndDisplayLeaves = () => {
    const total = cacheEmployeeInfo && cacheEmployeeInfo.leaveBalance !== undefined 
        ? Number(cacheEmployeeInfo.leaveBalance) 
        : 14;
    const used = Number(cacheUsedLeaves || 0);
    const remaining = total - used;

    const leaveCard = document.querySelector('.stats-grid > div:nth-child(2)');
    if (leaveCard) {
        const valEl = leaveCard.querySelector('h3');
        const trendEl = leaveCard.querySelector('.stat-trend');

        if (valEl) valEl.textContent = remaining;
        if (trendEl) {
            trendEl.innerHTML = `<i class="fas fa-calendar-check"></i> ${used} used / ${total} total`;
            trendEl.className = 'stat-trend text-muted';
        }
    }
};

const updateStatsOverview = (emp) => {
    // 1. Leave Balance
    calculateAndDisplayLeaves();

    // 2. Profile Completion
    const profileCard = document.querySelector('.stats-grid > div:nth-child(4)');
    if (profileCard) {
        let completedItems = 0;
        const totalItems = 8;

        // A. Name (both first and last name populated)
        if ((emp.firstName && String(emp.firstName).trim() !== '') && (emp.lastName && String(emp.lastName).trim() !== '')) {
            completedItems++;
        }
        // B. Email
        if (emp.email && String(emp.email).trim() !== '') completedItems++;
        // C. Phone
        if (emp.phone && String(emp.phone).trim() !== '') completedItems++;
        // D. Department
        if (emp.department && String(emp.department).trim() !== '') completedItems++;
        // E. Designation (role)
        if (emp.role && String(emp.role).trim() !== '') completedItems++;
        // F. Address
        if (emp.address && String(emp.address).trim() !== '') completedItems++;
        // G. Profile Photo
        if (emp.photoUrl && String(emp.photoUrl).trim() !== '') completedItems++;
        // H. Emergency Contact
        if (emp.emergencyContact && String(emp.emergencyContact).trim() !== '') completedItems++;

        const percentage = Math.round((completedItems / totalItems) * 100);
        profileCard.querySelector('h3').textContent = `${percentage}%`;
        
        const trendEl = profileCard.querySelector('.stat-trend');
        if (trendEl) {
            trendEl.innerHTML = percentage === 100 
                ? `<i class="fas fa-check-double"></i> Profile complete`
                : `<i class="fas fa-edit"></i> Complete profile details`;
            trendEl.className = `stat-trend ${percentage === 100 ? 'trend-up' : 'warning'}`;
        }
    }
};

// ─────────────────────────────────────────────────────────────────────
// PAYSLIP WIDGET
// ─────────────────────────────────────────────────────────────────────
const handlePayslipWidget = (data) => {
    const payslipCard = document.querySelector('.stats-grid > div:nth-child(3)');
    if (!payslipCard) return;

    if (data) {
        const monthYear = data.monthYear || '—'; // YYYY-MM
        
        // Format Month
        let displayMonth = monthYear;
        try {
            const parts = monthYear.split('-');
            const d = new Date(parts[0], parseInt(parts[1], 10) - 1, 1);
            displayMonth = d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
        } catch (_) {}

        payslipCard.querySelector('h3').textContent = displayMonth;
        
        const descEl = payslipCard.querySelector('p');
        if (descEl) {
            const netVal = Number(data.netSalary || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            descEl.textContent = `Latest Payslip (Net: ₹${netVal})`;
        }

        const trendEl = payslipCard.querySelector('.stat-trend');
        if (trendEl) {
            trendEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> Status: ${data.status || 'Processed'}`;
            trendEl.className = 'stat-trend trend-up';
        }
    } else {
        payslipCard.querySelector('h3').textContent = 'None';
        const descEl = payslipCard.querySelector('p');
        if (descEl) descEl.textContent = 'Latest Payslip';
        
        const trendEl = payslipCard.querySelector('.stat-trend');
        if (trendEl) {
            trendEl.textContent = 'No payslips generated';
            trendEl.className = 'stat-trend text-muted';
        }
    }
};

// ─────────────────────────────────────────────────────────────────────
// ACTIVITY FEED
// ─────────────────────────────────────────────────────────────────────
const startActivityFeedListener = (user) => {
    const listEl = document.querySelector('.table-card tbody');
    if (!listEl) return;

    const userEmail = user.email;
    const userUid = user.uid;

    const toDate = (v) => {
        if (!v) return null;
        if (v.toDate) return v.toDate();
        const d = new Date(v);
        return isNaN(d) ? null : d;
    };

    // Join attendance, leaves, payroll, and profile update records to build recent activities
    let attendanceList = [];
    let leaveList      = [];
    let payrollList    = [];
    let employeeData   = null;

    const redrawFeed = () => {
        const activities = [];

        // 1. Attendance actions
        attendanceList.forEach(a => {
            const ts = toDate(a.punchIn);
            if (ts) {
                activities.push({
                    date: a.date,
                    text: `Checked In: ${a.isLate ? '⚠ Late Check In' : '✓ On time'}`,
                    status: 'Completed',
                    statusClass: 'badge-info',
                    timestamp: ts
                });
            }
            const outTs = toDate(a.punchOut);
            if (outTs) {
                activities.push({
                    date: a.date,
                    text: `Checked Out: ${a.isEarlyExit ? '⚠ Early exit' : '✓ Standard exit'}`,
                    status: 'Completed',
                    statusClass: 'badge-info',
                    timestamp: outTs
                });
            }
        });

        // 2. Leave applications
        leaveList.forEach(lv => {
            const ts = toDate(lv.appliedAt || lv.createdAt);
            if (ts) {
                const isApproved = lv.status === 'Approved';
                const label = isApproved ? 'Leave Approved' : 'Leave Applied';
                activities.push({
                    date: lv.startDate,
                    text: `${label} (${lv.leaveType})`,
                    status: lv.status || 'Pending',
                    statusClass: lv.status === 'Approved' ? 'badge-success' : (lv.status === 'Rejected' ? 'badge-danger' : 'badge-warning'),
                    timestamp: ts
                });
            }
        });

        // 3. Payslips
        payrollList.forEach(pay => {
            const ts = toDate(pay.processedAt || pay.createdAt);
            if (ts) {
                activities.push({
                    date: pay.monthYear,
                    text: `Payslip Generated (Net: ₹${(pay.netSalary || 0).toLocaleString(undefined, {maximumFractionDigits: 0})})`,
                    status: 'Issued',
                    statusClass: 'badge-success',
                    timestamp: ts
                });
            }
        });

        // 4. Profile Updates
        if (employeeData && employeeData.updatedAt) {
            const ts = toDate(employeeData.updatedAt);
            if (ts) {
                let displayDate = '';
                try {
                    displayDate = ts.toISOString().split('T')[0];
                } catch (_) {
                    displayDate = new Date().toISOString().split('T')[0];
                }
                activities.push({
                    date: displayDate,
                    text: `Profile Updated`,
                    status: 'Completed',
                    statusClass: 'badge-info',
                    timestamp: ts
                });
            }
        }

        // Sort activities by timestamp desc, display top 20
        activities.sort((a, b) => b.timestamp - a.timestamp);
        const top20 = activities.slice(0, 20);

        if (top20.length === 0) {
            listEl.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No recent activities found.</td></tr>`;
            return;
        }

        listEl.innerHTML = top20.map(act => {
            let statusStyle = '';
            if (act.statusClass === 'badge-info') {
                statusStyle = 'background: rgba(14, 165, 233, 0.1); color: #0ea5e9;';
            }
            return `
                <tr style="animation: fadeInUp 0.2s ease;">
                    <td>${act.timestamp.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                    <td style="font-weight: 500; color: var(--text-main);">${act.text}</td>
                    <td><span class="badge ${act.statusClass}" style="${statusStyle}">${act.status}</span></td>
                </tr>
            `;
        }).join('');
    };

    _unsubs.push(
        onSnapshot(query(collection(db, "attendance"), where("userId", "==", userEmail)), (snap) => {
            attendanceList = [];
            snap.forEach(d => attendanceList.push(d.data()));
            redrawFeed();
        }, (err) => {
            console.warn("[HRMS] Activity feed attendance listener restricted:", err);
        }),
        onSnapshot(query(collection(db, "leaves"), where("userId", "==", userEmail)), (snap) => {
            leaveList = [];
            snap.forEach(d => leaveList.push(d.data()));
            redrawFeed();
        }, (err) => {
            console.warn("[HRMS] Activity feed leaves listener restricted:", err);
        }),
        onSnapshot(query(collection(db, "payroll"), where("userId", "==", userEmail)), (snap) => {
            payrollList = [];
            snap.forEach(d => payrollList.push(d.data()));
            redrawFeed();
        }, (err) => {
            console.warn("[HRMS] Activity feed payroll listener restricted:", err);
        }),
        onSnapshot(doc(db, "employees", userUid), (docSnap) => {
            if (docSnap.exists()) {
                employeeData = docSnap.data();
                redrawFeed();
            }
        }, (err) => {
            console.warn("[HRMS] Activity feed employee profile listener restricted:", err);
        })
    );
};

// ─────────────────────────────────────────────────────────────────────
// NOTIFICATIONS PANEL WIDGET
// ─────────────────────────────────────────────────────────────────────
const startNotificationsPanelListener = (userEmail) => {
    const listEl = document.querySelector('.charts-grid > div:nth-child(2) > div:nth-child(2)');
    if (!listEl) return;

    _unsubs.push(
        onSnapshot(
            query(collection(db, "notifications"), where("userId", "==", userEmail), limit(10)),
            (snap) => {
                if (snap.empty) {
                    listEl.innerHTML = `
                        <div class="empty-state" style="padding:1.5rem 1rem;">
                            <i class="fa-solid fa-bell-slash" style="font-size:1.5rem; opacity:0.35;"></i>
                            <p style="font-size:0.8rem; margin:0.5rem 0 0;">No notifications found.</p>
                        </div>`;
                    return;
                }

                // Convert to array and sort desc client-side by createdAt
                const notifs = [];
                snap.forEach(d => {
                    notifs.push({ id: d.id, ...d.data() });
                });
                notifs.sort((a, b) => {
                    const timeA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
                    const timeB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
                    return timeB - timeA;
                });

                listEl.innerHTML = '';
                notifs.forEach(notif => {
                    const dateStr = notif.createdAt 
                        ? notif.createdAt.toDate().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) 
                        : 'Just now';
                    
                    const isRead = !!notif.isRead;
                    const type = notif.type || 'system';

                    // Pick border color based on category type
                    let borderCol = 'var(--primary)';
                    if (type === 'attendance') borderCol = '#10b981';
                    if (type === 'leave')      borderCol = '#f59e0b';
                    if (type === 'payroll')    borderCol = '#0ea5e9';

                    const item = document.createElement('div');
                    item.style.cssText = `
                        padding: 0.85rem 1rem; border-left: 4px solid ${borderCol};
                        background: var(--bg-main); border-radius: 8px;
                        display: flex; flex-direction: column; gap: 0.2rem;
                        cursor: ${!isRead ? 'pointer' : 'default'};
                        transition: transform 0.15s ease;
                        position: relative;
                        animation: fadeInUp 0.25s ease;`;

                    const statusBadge = isRead
                        ? `<span class="badge" style="font-size:0.6rem; padding:0.15rem 0.4rem; background:rgba(16,185,129,0.12); color:#10b981;">Read</span>`
                        : `<span class="badge" style="font-size:0.6rem; padding:0.15rem 0.4rem; background:rgba(245,158,11,0.12); color:#f59e0b; font-weight:600;">Unread</span>`;

                    item.innerHTML = `
                        <h4 style="margin: 0; font-size: 0.85rem; font-weight:600; color:var(--text-main);">${notif.title || 'Notification'}</h4>
                        <p style="margin: 0; font-size: 0.72rem; color: var(--text-muted); line-height:1.4;">${notif.message || ''}</p>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.3rem; font-size: 0.65rem;">
                            <span style="color: var(--text-muted); font-size: 0.65rem;">${dateStr}</span>
                            ${statusBadge}
                        </div>
                    `;

                    // Hover effects for unread items
                    if (!isRead) {
                        item.addEventListener('mouseenter', () => {
                            item.style.transform = 'translateX(3px)';
                        });
                        item.addEventListener('mouseleave', () => {
                            item.style.transform = 'translateX(0)';
                        });
                        item.addEventListener('click', async (e) => {
                            e.stopPropagation();
                            try {
                                await updateDoc(doc(db, "notifications", notif.id), { isRead: true });
                                showToast("Notification marked as read.");
                            } catch (err) {
                                console.error("Failed to mark notification as read:", err);
                            }
                        });
                    }

                    listEl.appendChild(item);
                });
            },
            (err) => console.error("Notifications list sync failed:", err)
        )
    );
};
