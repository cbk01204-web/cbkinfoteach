/**
 * CBK INFOTECH HRMS — Admin Dashboard Engine
 * 
 * Firebase Connections:
 *  - employees    → KPI stats, charts, activities, calendar, search
 *  - attendance   → Present-today KPI, attendance chart, activities
 *  - leaves       → On-leave KPI, pending count, calendar events, activities
 *  - payroll      → Monthly payroll KPI, dept cost chart, activities
 *  - departments  → Department list cache (for filter dropdowns)
 *  - settings     → Company name for header display
 * 
 * All collections use onSnapshot() for real-time updates.
 * A 120ms debounce prevents redundant UI redraws.
 */

import { db, auth } from './firebase-config.js';
import {
    collection, onSnapshot, query,
    orderBy, limit, getDoc, doc, setDoc
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

// ── Chart instances (stored to destroy before re-render) ──────────────
let attendanceChartInstance        = null;
let deptChartInstance              = null;
let deptDistributionChartInstance  = null;
let genderChartInstance            = null;
let growthChartInstance            = null;
let newEmployeesChartInstance      = null;

// ── Realtime caches (filled by onSnapshot listeners) ──────────────────
let cacheEmployees   = [];
let cacheAttendance  = [];
let cacheLeaves      = [];
let cachePayroll     = [];
let cacheDepartments = [];
let cacheHolidays    = [];

// ── Listener cleanup handles ──────────────────────────────────────────
const _unsubs = [];

// ── Debounce: batch rapid Firestore updates into one UI redraw ────────
let _redrawTimer = null;
const scheduleRedraw = () => {
    clearTimeout(_redrawTimer);
    _redrawTimer = setTimeout(updateDashboardUI, 120);
};

// ─────────────────────────────────────────────────────────────────────
// INITIALIZER
// ─────────────────────────────────────────────────────────────────────
export const initAdminDashboard = () => {
    // ── 1. Theme toggle ───────────────────────────────────────────────
    const themeToggleBtn = document.getElementById('theme-toggle');
    const body = document.body;
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        body.classList.add('dark-theme');
        if (themeToggleBtn) themeToggleBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
    } else {
        if (themeToggleBtn) themeToggleBtn.innerHTML = '<i class="fa-solid fa-moon"></i>';
    }
    themeToggleBtn?.addEventListener('click', () => {
        body.classList.toggle('dark-theme');
        const isDark = body.classList.contains('dark-theme');
        if (themeToggleBtn) {
            themeToggleBtn.innerHTML = isDark
                ? '<i class="fa-solid fa-sun"></i>'
                : '<i class="fa-solid fa-moon"></i>';
        }
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
        initCharts(); // re-render charts in new colour mode
    });

    // ── 2. Populate header with live Firebase Auth user ───────────────
    populateHeaderUser();

    // ── 3. Load company name from Firestore settings ──────────────────
    loadCompanyName();

    // ── 4. Wire up Firestore realtime listeners ───────────────────────
    startRealtimeSync();

    // ── 5. Refresh button ─────────────────────────────────────────────
    document.getElementById('refresh-activities-btn')
        ?.addEventListener('click', loadRecentActivities);

    // ── 6. Wire up header search ──────────────────────────────────────
    initHeaderSearch();

    // ── 7. Cleanup on page hide ───────────────────────────────────────
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') clearTimeout(_redrawTimer);
    });
};

// ─────────────────────────────────────────────────────────────────────
// FIREBASE AUTH: Show real user name in header
// ─────────────────────────────────────────────────────────────────────
const populateHeaderUser = () => {
    onAuthStateChanged(auth, async (user) => {
        const nameEl = document.getElementById('header-user-name');
        if (!user) return;

        // Prefer displayName from Auth, fall back to Firestore employees doc
        let displayName = user.displayName || '';
        let role        = 'HR Director';

        if (!displayName || displayName.trim() === '') {
            try {
                const empSnap = await getDoc(doc(db, 'employees', user.uid));
                if (empSnap.exists()) {
                    const d = empSnap.data();
                    displayName = `${d.firstName || ''} ${d.lastName || ''}`.trim();
                    role        = d.role || 'Administrator';
                }
            } catch (_) { /* silent */ }
        }

        if (!displayName) displayName = user.email?.split('@')[0] || 'Admin';

        if (nameEl) nameEl.textContent = displayName;
        const roleEl = nameEl?.nextElementSibling;
        if (roleEl && roleEl.tagName === 'SPAN') roleEl.textContent = role;

        // Store for use in other parts of the dashboard
        localStorage.setItem('userEmail',       user.email || '');
        localStorage.setItem('userDisplayName', displayName);
    });
};

// ─────────────────────────────────────────────────────────────────────
// FIRESTORE: Load company name from settings document
// ─────────────────────────────────────────────────────────────────────
const loadCompanyName = async () => {
    try {
        const snap = await getDoc(doc(db, 'settings', 'general'));
        if (snap.exists()) {
            const name = snap.data().companyName;
            if (name) {
                const brand = document.querySelector('.sidebar-brand h2');
                if (brand) brand.textContent = name;
                document.title = `Dashboard — ${name} HRMS`;
            }
        }
    } catch (err) {
        // Non-critical — silently ignore
    }
};

// ─────────────────────────────────────────────────────────────────────
// REALTIME SNAPSHOT LISTENERS
// ─────────────────────────────────────────────────────────────────────
const startRealtimeSync = () => {
    const mkNextHandler = (target) => (snap) => {
        target.length = 0;
        snap.forEach(d => {
            if (!d.id.startsWith('config_')) {
                target.push({ id: d.id, ...d.data() });
            }
        });
        scheduleRedraw();
    };

    const mkErrHandler = (label) => (err) => {
        console.warn(`[HRMS] ${label} listener restricted:`, err);
        showListenerError(label);
    };

    _unsubs.push(
        // Core collections (filter config documents from employees cache)
        onSnapshot(collection(db, 'employees'), (snap) => {
            cacheEmployees = [];
            snap.forEach(d => {
                if (!d.id.startsWith('config_')) {
                    cacheEmployees.push({ id: d.id, ...d.data() });
                }
            });
            scheduleRedraw();
        }, (err) => {
            console.warn("[HRMS] Employees listener restricted:", err);
        }),
        onSnapshot(collection(db, 'attendance'),   mkNextHandler(cacheAttendance), mkErrHandler('Attendance')),
        onSnapshot(collection(db, 'leaves'),       mkNextHandler(cacheLeaves),     mkErrHandler('Leaves')),
        onSnapshot(collection(db, 'payroll'),      mkNextHandler(cachePayroll),    mkErrHandler('Payroll')),
        // Dynamic Holidays from employees/config_holidays
        onSnapshot(doc(db, 'employees', 'config_holidays'), (snap) => {
            if (snap.exists()) {
                cacheHolidays = snap.data().list || [];
                scheduleRedraw();
            }
        }, (err) => {
            console.warn("[HRMS] holidays listener restricted:", err);
        }),
        // Company name (silently ignore permission restrictions)
        onSnapshot(doc(db, 'settings', 'general'), (snap) => {
            if (snap.exists()) {
                const name = snap.data().companyName;
                if (name) {
                    const brand = document.querySelector('.sidebar-brand h2');
                    if (brand) brand.textContent = name;
                    document.title = `Dashboard — ${name} HRMS`;
                }
            }
        }, (err) => {
            // Silently skip settings rule restrict
        })
    );
};

// Show a subtle error badge when a listener fails (e.g. permission denied)
const showListenerError = (label) => {
    const el = document.getElementById('recent-activities-list');
    if (el && el.children.length === 0) {
        el.innerHTML = `
            <div class="error-state" role="alert">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <p>${label} data unavailable. Check Firestore rules or your connection.</p>
            </div>`;
    }
};

// ─────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────
const setStat = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
};

const showTrend = (id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'flex';
};

const formatPayroll = (value) => {
    if (value <= 0)        return '₹0';
    if (value < 1_000)     return `₹${value.toFixed(0)}`;
    if (value < 1_000_000) return `₹${(value / 1_000).toFixed(1)}k`;
    return                        `₹${(value / 1_000_000).toFixed(2)}m`;
};

const formatTimeAgo = (date) => {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 0) return 'Just now';
    let i = Math.floor(seconds / 31536000); if (i >= 1) return i === 1 ? '1 year ago'  : `${i} years ago`;
        i = Math.floor(seconds /  2592000); if (i >= 1) return i === 1 ? '1 month ago' : `${i} months ago`;
        i = Math.floor(seconds /    86400); if (i >= 1) return i === 1 ? '1 day ago'   : `${i} days ago`;
        i = Math.floor(seconds /     3600); if (i >= 1) return i === 1 ? '1 hour ago'  : `${i} hours ago`;
        i = Math.floor(seconds /       60); if (i >= 1) return i === 1 ? '1 min ago'   : `${i} mins ago`;
    return 'Just now';
};

// ─────────────────────────────────────────────────────────────────────
// MAIN UI ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────
const updateDashboardUI = () => {
    try {
        const today        = new Date();
        const yyyy         = today.getFullYear();
        const mm           = String(today.getMonth() + 1).padStart(2, '0');
        const dd           = String(today.getDate()).padStart(2, '0');
        const todayStr     = `${yyyy}-${mm}-${dd}`;
        const currentMonth = `${yyyy}-${mm}`;

        // ── KPI: Employees ────────────────────────────────────────────
        const totalEmployees  = cacheEmployees.length;
        const activeEmployees = cacheEmployees.filter(e => (e.status || 'Active') !== 'Inactive').length;
        setStat('stat-total-employees',  totalEmployees);
        setStat('stat-active-employees', activeEmployees);

        // ── KPI: Present today ────────────────────────────────────────
        const presentToday = cacheAttendance.filter(a => a.date === todayStr).length;
        setStat('stat-present-today', presentToday);

        // ── KPI: Leaves ───────────────────────────────────────────────
        let onLeaveToday  = 0;
        let pendingLeaves = 0;
        cacheLeaves.forEach(lv => {
            if (lv.status === 'Approved' && todayStr >= lv.startDate && todayStr <= lv.endDate) {
                onLeaveToday++;
            } else if (lv.status === 'Pending') {
                pendingLeaves++;
            }
        });
        setStat('stat-on-leave',       onLeaveToday);
        setStat('stat-pending-leaves', pendingLeaves);

        // ── KPI: Monthly Payroll ──────────────────────────────────────
        const totalPayroll = cachePayroll.reduce((sum, p) =>
            p.monthYear === currentMonth ? sum + (p.netSalary || 0) : sum, 0);
        setStat('stat-monthly-payroll', formatPayroll(totalPayroll));

        // ── Show live trend indicators ────────────────────────────────
        ['trend-total-employees', 'trend-active-employees', 'trend-present-today',
         'trend-on-leave', 'trend-monthly-payroll', 'trend-pending-leaves']
            .forEach(showTrend);

        // ── Widgets ───────────────────────────────────────────────────
        loadRecentActivities();
        initCalendar();
        initCharts();

    } catch (err) {
        console.error('[HRMS] updateDashboardUI error:', err);
    }
};

// ─────────────────────────────────────────────────────────────────────
// RECENT ACTIVITIES (built from cache arrays sorted by timestamp)
// ─────────────────────────────────────────────────────────────────────
const loadRecentActivities = () => {
    const listEl = document.getElementById('recent-activities-list');
    if (!listEl) return;

    // Build employee email → name lookup map
    const empMap = {};
    cacheEmployees.forEach(e => {
        if (e.email) empMap[e.email] = `${e.firstName || ''} ${e.lastName || ''}`.trim() || e.email;
        if (e.id)    empMap[e.id]    = `${e.firstName || ''} ${e.lastName || ''}`.trim() || e.email;
    });

    const toDate = (v) => {
        if (!v) return null;
        if (v?.toDate) return v.toDate();
        const d = new Date(v);
        return isNaN(d) ? null : d;
    };

    const activities = [];

    // A. Employee additions
    cacheEmployees.forEach(emp => {
        const ts = toDate(emp.createdAt);
        if (ts) activities.push({
            text:       `New employee <strong>${emp.firstName || ''} ${emp.lastName || ''}</strong> added to ${emp.department || 'the company'}.`,
            subtext:    `Role: ${emp.role || 'Staff'}`,
            timestamp:  ts,
            icon:       'fa-user-plus',
            color:      'primary'
        });
    });

    // B. Attendance records
    cacheAttendance.forEach(att => {
        const ts = toDate(att.punchIn || att.createdAt);
        if (ts) {
            const name = empMap[att.employeeId] || empMap[att.userId] || att.employeeId || 'Employee';
            activities.push({
                text:       `<strong>${name}</strong> marked attendance.`,
                subtext:    `Date: ${att.date || 'Today'} | ${att.isLate ? '⚠ Late arrival' : '✓ On time'}`,
                timestamp:  ts,
                icon:       'fa-fingerprint',
                color:      'success'
            });
        }
    });

    // C. Leave applications & decisions
    cacheLeaves.forEach(lv => {
        const name     = empMap[lv.employeeId] || empMap[lv.userId] || lv.userId || 'Employee';
        const appliedTs = toDate(lv.appliedAt || lv.createdAt);
        if (appliedTs) activities.push({
            text:       `<strong>${name}</strong> applied for ${lv.leaveType || 'leave'}.`,
            subtext:    `${lv.startDate} → ${lv.endDate}`,
            timestamp:  appliedTs,
            icon:       'fa-envelope-open-text',
            color:      'warning'
        });
        if (lv.status === 'Approved' || lv.status === 'Rejected') {
            const actionTs = toDate(lv.processedAt) || (appliedTs ? new Date(appliedTs.getTime() + 3_600_000) : null);
            if (actionTs) activities.push({
                text:       `Leave for <strong>${name}</strong> was ${lv.status.toLowerCase()}.`,
                subtext:    `Status updated by HR`,
                timestamp:  actionTs,
                icon:       lv.status === 'Approved' ? 'fa-circle-check' : 'fa-circle-xmark',
                color:      lv.status === 'Approved' ? 'success' : 'danger'
            });
        }
    });

    // D. Payroll processed
    cachePayroll.forEach(pay => {
        const ts   = toDate(pay.processedAt || pay.createdAt);
        const name = empMap[pay.employeeId] || empMap[pay.userId] || pay.userId || 'Employee';
        if (ts) activities.push({
            text:       `Payroll processed for <strong>${name}</strong>.`,
            subtext:    `Month: ${pay.monthYear || '—'} | Net: ${formatPayroll(pay.netSalary || 0)}`,
            timestamp:  ts,
            icon:       'fa-money-check-dollar',
            color:      'info'
        });
    });

    // Sort by newest first, take top 20
    activities.sort((a, b) => b.timestamp - a.timestamp);
    const latest = activities.slice(0, 20);

    if (latest.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state" role="status" aria-live="polite">
                <i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>
                <p>No activities yet. They'll appear here as employees use the system.</p>
            </div>`;
        return;
    }

    const COLOR_MAP = {
        primary: { bg: 'rgba(79,70,229,0.12)',   fg: '#4f46e5' },
        success: { bg: 'rgba(16,185,129,0.12)',  fg: '#10b981' },
        warning: { bg: 'rgba(245,158,11,0.12)',  fg: '#f59e0b' },
        danger:  { bg: 'rgba(239,68,68,0.12)',   fg: '#ef4444' },
        info:    { bg: 'rgba(14,165,233,0.12)',  fg: '#0ea5e9' },
    };

    const frag = document.createDocumentFragment();
    latest.forEach((act, i) => {
        const col  = COLOR_MAP[act.color] || COLOR_MAP.primary;
        const item = document.createElement('article');
        item.setAttribute('aria-label', act.text.replace(/<[^>]+>/g, ''));
        item.style.cssText = [
            'display:flex', 'align-items:center', 'justify-content:space-between',
            'padding:.65rem .875rem', 'background:var(--bg-main)', 'border-radius:10px',
            'border:1px solid var(--border-color)', 'gap:.875rem',
            `animation:fadeInUp .3s ease ${i * 0.025}s both`
        ].join(';');

        item.innerHTML = `
            <div style="display:flex;align-items:center;gap:.75rem;min-width:0;">
                <div aria-hidden="true"
                     style="width:36px;height:36px;border-radius:50%;display:flex;
                            align-items:center;justify-content:center;
                            background:${col.bg};color:${col.fg};flex-shrink:0;font-size:.95rem;">
                    <i class="fa-solid ${act.icon}"></i>
                </div>
                <div style="min-width:0;">
                    <p style="margin:0;font-weight:500;color:var(--text-main);font-size:.84rem;
                              white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        ${act.text}
                    </p>
                    <span style="font-size:.73rem;color:var(--text-muted);">${act.subtext}</span>
                </div>
            </div>
            <time datetime="${act.timestamp.toISOString()}"
                  style="font-size:.72rem;color:var(--text-muted);font-weight:500;white-space:nowrap;flex-shrink:0;">
                ${formatTimeAgo(act.timestamp)}
            </time>`;

        frag.appendChild(item);
    });

    listEl.innerHTML = '';
    listEl.appendChild(frag);
};

// ─────────────────────────────────────────────────────────────────────
// CALENDAR (pulls events from cacheLeaves, cacheEmployees)
// ─────────────────────────────────────────────────────────────────────
const initCalendar = () => {
    const monthYearEl = document.getElementById('calendar-month-year');
    const gridEl      = document.getElementById('calendar-days-grid');
    const prevBtn     = document.getElementById('calendar-prev-btn');
    const nextBtn     = document.getElementById('calendar-next-btn');
    const eventDateEl = document.getElementById('calendar-event-date');
    const eventListEl = document.getElementById('calendar-event-list');

    if (!gridEl || !monthYearEl) return;

    // Only initialise navigation listeners once
    if (!gridEl._calInit) {
        gridEl._calInit = true;
        let curYear  = new Date().getFullYear();
        let curMonth = new Date().getMonth();

        const MONTH_NAMES = ['January','February','March','April','May','June',
                             'July','August','September','October','November','December'];

        // Public holidays (MM-DD)
        const PUBLIC_HOLIDAYS = [
            { date: '01-01', name: "New Year's Day"  },
            { date: '05-01', name: "Labour Day"      },
            { date: '12-25', name: "Christmas Day"   },
            { date: '12-26', name: "Boxing Day"      },
        ];

        let selectedDateStr = null;

        const renderCalendar = () => {
            gridEl.innerHTML = '';
            monthYearEl.textContent = `${MONTH_NAMES[curMonth]} ${curYear}`;

            const firstDay      = new Date(curYear, curMonth, 1).getDay();
            let offset          = firstDay - 1;
            if (offset < 0) offset = 6; // Monday-first grid

            const totalDays     = new Date(curYear, curMonth + 1, 0).getDate();
            const prevMonthDays = new Date(curYear, curMonth, 0).getDate();
            const today         = new Date();

            // ── Previous-month filler cells ──
            for (let i = offset; i > 0; i--) {
                const cell = document.createElement('div');
                cell.style.cssText = 'padding:.4rem 0;font-size:.78rem;color:var(--text-muted);opacity:.3;text-align:center;';
                cell.textContent = prevMonthDays - i + 1;
                gridEl.appendChild(cell);
            }

            // ── Active-month day cells ──
            for (let day = 1; day <= totalDays; day++) {
                const mm_pad  = String(curMonth + 1).padStart(2, '0');
                const dd_pad  = String(day).padStart(2, '0');
                const dateKey = `${curYear}-${mm_pad}-${dd_pad}`;
                const mdKey   = `${mm_pad}-${dd_pad}`;

                const dayEvents = [];

                // A. Public holidays (from static list)
                const hol = PUBLIC_HOLIDAYS.find(h => h.date === mdKey);
                if (hol) dayEvents.push({ text: `🎉 ${hol.name}`, type: 'holiday', isCustom: false });

                // Custom dynamic holidays declared by Admin
                const customHols = cacheHolidays.filter(h => h.date === dateKey || h.date === mdKey);
                customHols.forEach(h => {
                    dayEvents.push({ 
                        id: h.id, 
                        text: `🎉 ${h.name}`, 
                        rawName: h.name, 
                        type: 'holiday', 
                        isCustom: true 
                    });
                });

                // B. Employee birthdays (from Firestore cache)
                cacheEmployees.forEach(emp => {
                    if (!emp.dob) return;
                    try {
                        const dobParts = emp.dob.split('-'); // YYYY-MM-DD
                        if (dobParts.length >= 3) {
                            const dobMD = `${dobParts[1]}-${dobParts[2]}`;
                            if (dobMD === mdKey) {
                                dayEvents.push({ text: `🎂 ${emp.firstName || 'Employee'}'s Birthday`, type: 'birthday' });
                            }
                        }
                    } catch (_) {}
                });

                // C. Work anniversaries (from Firestore joinDate)
                cacheEmployees.forEach(emp => {
                    if (!emp.joinDate) return;
                    try {
                        const parts = emp.joinDate.split('-');
                        if (parts.length >= 3) {
                            const joinMD   = `${parts[1]}-${parts[2]}`;
                            const joinYear = parseInt(parts[0], 10);
                            const years    = curYear - joinYear;
                            if (joinMD === mdKey && years > 0) {
                                dayEvents.push({ text: `🏆 ${emp.firstName || 'Employee'} — ${years}yr Anniversary`, type: 'anniversary' });
                            }
                        }
                    } catch (_) {}
                });

                // D. Approved leaves (from Firestore cache)
                cacheLeaves.forEach(lv => {
                    if (lv.status !== 'Approved') return;
                    if (dateKey >= (lv.startDate || '') && dateKey <= (lv.endDate || '')) {
                        const empObj = cacheEmployees.find(e => e.id === lv.employeeId || e.id === lv.userId);
                        const name   = empObj ? `${empObj.firstName || ''} ${empObj.lastName || ''}`.trim() : 'Employee';
                        dayEvents.push({ text: `🏖 ${name} on leave`, type: 'leave' });
                    }
                });

                // Build cell
                const isToday = today.getDate() === day
                    && today.getMonth() === curMonth
                    && today.getFullYear() === curYear;

                const hasEvents = dayEvents.length > 0;

                const cell = document.createElement('div');
                cell.setAttribute('role', 'gridcell');
                cell.setAttribute('tabindex', '0');
                cell.setAttribute('aria-label', `${day} ${MONTH_NAMES[curMonth]}${hasEvents ? ' — has events' : ''}`);
                cell.style.cssText = `
                    padding:.4rem 0; font-size:.8rem; text-align:center; border-radius:6px;
                    cursor:pointer; position:relative; transition:background .15s ease;
                    color:${isToday ? '#4f46e5' : 'var(--text-main)'};
                    font-weight:${isToday ? '700' : '400'};
                    background:${isToday ? 'rgba(79,70,229,0.12)' : 'transparent'};
                    border:${isToday ? '1px solid rgba(79,70,229,0.35)' : '1px solid transparent'};
                `;

                const numEl = document.createElement('span');
                numEl.textContent = day;
                cell.appendChild(numEl);

                // Coloured event dot(s)
                if (hasEvents) {
                    const dot = document.createElement('span');
                    const dotColors = { holiday: '#ef4444', birthday: '#ec4899', anniversary: '#f59e0b', leave: '#0ea5e9' };
                    dot.style.cssText = `
                        display:block; width:5px; height:5px; border-radius:50%;
                        background:${dotColors[dayEvents[0].type] || '#4f46e5'};
                        margin:2px auto 0;
                    `;
                    cell.appendChild(dot);
                }

                // Click: show events in the detail panel
                const showEvents = () => {
                    selectedDateStr = dateKey;
                    if (eventDateEl) eventDateEl.textContent = `${MONTH_NAMES[curMonth]} ${day}, ${curYear}`;
                    
                    const addHolidayBtn = document.getElementById('add-holiday-btn');
                    if (addHolidayBtn) addHolidayBtn.style.display = 'inline-flex';

                    if (eventListEl) {
                        if (dayEvents.length === 0) {
                            eventListEl.innerHTML = '<li>No events scheduled.</li>';
                        } else {
                            eventListEl.innerHTML = '';
                            dayEvents.forEach(ev => {
                                const li = document.createElement('li');
                                li.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:0.25rem;';
                                
                                const span = document.createElement('span');
                                span.textContent = ev.text;
                                li.appendChild(span);

                                if (ev.isCustom) {
                                    const delBtn = document.createElement('button');
                                    delBtn.className = 'icon-btn text-danger';
                                    delBtn.style.cssText = 'border:none; background:transparent; cursor:pointer; padding:0.1rem 0.3rem; font-size:0.75rem;';
                                    delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
                                    delBtn.title = 'Remove Holiday';
                                    delBtn.addEventListener('click', async (e) => {
                                        e.stopPropagation();
                                        if (confirm(`Remove holiday "${ev.rawName}"?`)) {
                                            try {
                                                const updatedHols = cacheHolidays.filter(h => h.id !== ev.id);
                                                const configDocRef = doc(db, "employees", "config_holidays");
                                                await setDoc(configDocRef, { list: updatedHols });
                                                import('./utils.js').then(m => m.showToast("Holiday removed successfully.", "success"));
                                            } catch (err) {
                                                console.error("Error removing holiday:", err);
                                                import('./utils.js').then(m => m.showToast("Failed to remove holiday.", "danger"));
                                            }
                                        }
                                    });
                                    li.appendChild(delBtn);
                                }
                                eventListEl.appendChild(li);
                            });
                        }
                    }
                    // Highlight selected
                    gridEl.querySelectorAll('[aria-selected]').forEach(c => c.removeAttribute('aria-selected'));
                    cell.setAttribute('aria-selected', 'true');
                    cell.style.background = hasEvents ? 'rgba(79,70,229,0.18)' : 'rgba(79,70,229,0.08)';
                };

                cell.addEventListener('click',  showEvents);
                cell.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showEvents(); } });

                cell.addEventListener('mouseenter', () => { if (!cell.getAttribute('aria-selected')) cell.style.background = 'var(--hover-bg)'; });
                cell.addEventListener('mouseleave', () => { if (!cell.getAttribute('aria-selected')) cell.style.background = isToday ? 'rgba(79,70,229,0.12)' : 'transparent'; });

                gridEl.appendChild(cell);
            }
        };

        prevBtn?.addEventListener('click', () => {
            curMonth--;
            if (curMonth < 0) { curMonth = 11; curYear--; }
            renderCalendar();
        });

        nextBtn?.addEventListener('click', () => {
            curMonth++;
            if (curMonth > 11) { curMonth = 0; curYear++; }
            renderCalendar();
        });

        // ── Holiday Modal Setup ──
        const addHolidayBtn = document.getElementById('add-holiday-btn');
        const holidayModal = document.getElementById('holiday-modal');
        const closeHolidayModal = document.getElementById('close-holiday-modal');
        const cancelHolidayBtn = document.getElementById('cancel-holiday-btn');
        const holidayForm = document.getElementById('holiday-form');
        
        const openHolidayModal = () => {
            if (!selectedDateStr) return;
            const parts = selectedDateStr.split('-');
            const y = parts[0];
            const m = MONTH_NAMES[parseInt(parts[1]) - 1];
            const d = parseInt(parts[2]);
            document.getElementById('holiday-date-display').value = `${m} ${d}, ${y}`;
            holidayModal.classList.add('active');
        };
        
        const closeHolidayModalFn = () => {
            holidayModal.classList.remove('active');
            holidayForm.reset();
        };

        if (addHolidayBtn) addHolidayBtn.addEventListener('click', openHolidayModal);
        if (closeHolidayModal) closeHolidayModal.addEventListener('click', closeHolidayModalFn);
        if (cancelHolidayBtn) cancelHolidayBtn.addEventListener('click', closeHolidayModalFn);

        if (holidayForm) {
            holidayForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const name = document.getElementById('holiday-name').value.trim();
                const recur = document.getElementById('holiday-recur').value === 'true';
                
                if (!selectedDateStr || !name) return;

                const parts = selectedDateStr.split('-');
                const dateVal = recur ? `${parts[1]}-${parts[2]}` : selectedDateStr;

                const newHoliday = {
                    id: Date.now().toString(),
                    date: dateVal,
                    name: name,
                    recur: recur
                };

                try {
                    const updatedHols = [...cacheHolidays, newHoliday];
                    const configDocRef = doc(db, "employees", "config_holidays");
                    await setDoc(configDocRef, { list: updatedHols });

                    import('./utils.js').then(m => m.showToast("Holiday declared successfully.", "success"));
                    closeHolidayModalFn();
                } catch (err) {
                    console.error("Error declaring holiday:", err);
                    import('./utils.js').then(m => m.showToast("Failed to declare holiday.", "danger"));
                }
            });
        }

        renderCalendar();

        // Re-render when cache updates without re-binding listeners
        gridEl._renderCalendar = renderCalendar;

    } else {
        // Re-render calendar with fresh cache data (listeners already bound)
        gridEl._renderCalendar?.();
    }
};

// ─────────────────────────────────────────────────────────────────────
// CHARTS (all driven from Firestore cache arrays)
// ─────────────────────────────────────────────────────────────────────
const initCharts = () => {
    if (typeof Chart === 'undefined') {
        // Chart.js not yet loaded — retry after a short delay
        setTimeout(initCharts, 300);
        return;
    }

    const isDark     = document.body.classList.contains('dark-theme');
    const textColor  = isDark ? '#94a3b8' : '#64748b';
    const gridColor  = isDark ? '#334155' : '#e2e8f0';
    const PALETTE    = ['#4f46e5','#10b981','#f59e0b','#ec4899','#0ea5e9','#8b5cf6','#64748b','#ef4444'];

    Chart.defaults.color      = textColor;
    Chart.defaults.font.family = "'Inter', sans-serif";

    // Destroy existing instances to avoid canvas memory leaks
    [attendanceChartInstance, deptChartInstance, deptDistributionChartInstance,
     genderChartInstance, growthChartInstance, newEmployeesChartInstance]
        .forEach(c => c?.destroy());

    // ── 1. Line Chart: Attendance Trends (Last 7 Days) ───────────────
    const ctxAtt = document.getElementById('attendanceChart');
    if (ctxAtt) {
        const WEEKDAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const today      = new Date();
        const labels     = [];
        const countMap   = {};

        for (let i = 6; i >= 0; i--) {
            const d = new Date(); d.setDate(today.getDate() - i);
            const key = d.toISOString().split('T')[0];
            labels.push(WEEKDAYS[d.getDay()]);
            countMap[key] = 0;
        }

        cacheAttendance.forEach(a => {
            if (countMap[a.date] !== undefined) countMap[a.date]++;
        });

        const data = Object.values(countMap);

        attendanceChartInstance = new Chart(ctxAtt, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Present',
                    data,
                    borderColor: '#4f46e5',
                    backgroundColor: (ctx) => {
                        const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 220);
                        g.addColorStop(0, 'rgba(79,70,229,0.25)');
                        g.addColorStop(1, 'rgba(79,70,229,0)');
                        return g;
                    },
                    borderWidth: 2.5,
                    pointBackgroundColor: '#4f46e5',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: gridColor } },
                    x: { grid: { display: false } }
                }
            }
        });
    }

    // ── 2. Prepare department data from cache ─────────────────────────
    const deptCounts = {};
    cacheEmployees.forEach(e => {
        const d = e.department || 'Unassigned';
        deptCounts[d] = (deptCounts[d] || 0) + 1;
    });
    const deptLabels = Object.keys(deptCounts).length > 0 ? Object.keys(deptCounts) : ['No Data'];
    const deptValues = Object.keys(deptCounts).length > 0 ? Object.values(deptCounts) : [1];

    const doughnutOpts = (isDark) => ({
        responsive: true, maintainAspectRatio: false, cutout: '70%',
        plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10, padding: 10, usePointStyle: true } }
        }
    });

    // ── 3. Doughnut: Department Distribution (overview section) ───────
    const ctxDeptDist = document.getElementById('deptDistributionChart');
    if (ctxDeptDist) {
        deptDistributionChartInstance = new Chart(ctxDeptDist, {
            type: 'doughnut',
            data: { labels: deptLabels, datasets: [{ data: deptValues, backgroundColor: PALETTE, borderWidth: isDark ? 2 : 0, borderColor: isDark ? '#1e293b' : '#fff', hoverOffset: 6 }] },
            options: doughnutOpts(isDark)
        });
    }

    // ── 4. Doughnut: Department Distribution (main charts section) ────
    const ctxDept = document.getElementById('deptChart');
    if (ctxDept) {
        deptChartInstance = new Chart(ctxDept, {
            type: 'doughnut',
            data: { labels: deptLabels, datasets: [{ data: deptValues, backgroundColor: PALETTE, borderWidth: isDark ? 2 : 0, borderColor: isDark ? '#1e293b' : '#fff', hoverOffset: 6 }] },
            options: doughnutOpts(isDark)
        });
    }

    // ── 5. Pie Chart: Gender Breakdown ────────────────────────────────
    const ctxGender = document.getElementById('genderChart');
    if (ctxGender) {
        const gCount = { Male: 0, Female: 0, Other: 0 };
        cacheEmployees.forEach(e => {
            const g = e.gender;
            if (g === 'Male' || g === 'Female') gCount[g]++;
            else if (g) gCount.Other++;
            else {
                // Deterministic fallback using first-name char code
                const c = (e.firstName || '').charCodeAt(0) || 65;
                (c % 2 === 0 ? gCount.Female++ : gCount.Male++);
            }
        });
        const gLabels = ['Male', 'Female', 'Other'].filter(k => gCount[k] > 0);
        const gValues = gLabels.map(k => gCount[k]);

        genderChartInstance = new Chart(ctxGender, {
            type: 'pie',
            data: { labels: gLabels, datasets: [{ data: gValues, backgroundColor: ['#0ea5e9','#ec4899','#8b5cf6'], borderWidth: isDark ? 2 : 0, borderColor: isDark ? '#1e293b' : '#fff', hoverOffset: 4 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 10, usePointStyle: true } } } }
        });
    }

    // ── 6. Area Chart: Cumulative Employee Growth ─────────────────────
    const ctxGrowth = document.getElementById('growthChart');
    if (ctxGrowth) {
        const MONTHS    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const nowMonth  = new Date().getMonth();
        const nowYear   = new Date().getFullYear();
        const labels    = MONTHS.slice(0, nowMonth + 1);
        const byMonth   = Array(labels.length).fill(0);

        cacheEmployees.forEach(e => {
            const d = e.createdAt?.toDate ? e.createdAt.toDate() : (e.createdAt ? new Date(e.createdAt) : null);
            if (d && d.getFullYear() === nowYear && d.getMonth() <= nowMonth) {
                byMonth[d.getMonth()]++;
            }
        });

        const cumulative = byMonth.reduce((acc, v, i) => { acc.push((acc[i - 1] || 0) + v); return acc; }, []);

        const gCtx = ctxGrowth.getContext('2d');
        const grad = gCtx.createLinearGradient(0, 0, 0, 260);
        grad.addColorStop(0, 'rgba(139,92,246,0.45)');
        grad.addColorStop(1, 'rgba(139,92,246,0)');

        growthChartInstance = new Chart(ctxGrowth, {
            type: 'line',
            data: { labels, datasets: [{ label: 'Headcount', data: cumulative, borderColor: '#8b5cf6', backgroundColor: grad, borderWidth: 2.5, fill: true, tension: 0.4, pointBackgroundColor: '#8b5cf6', pointBorderColor: '#fff', pointBorderWidth: 2 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: gridColor } }, x: { grid: { display: false } } } }
        });
    }

    // ── 7. Bar Chart: New Hires This Month by Department ─────────────
    const ctxNew = document.getElementById('newEmployeesChart');
    if (ctxNew) {
        const nowMonth = new Date().getMonth();
        const nowYear  = new Date().getFullYear();
        const hireMap  = {};

        cacheEmployees.forEach(e => {
            const d = e.createdAt?.toDate ? e.createdAt.toDate() : (e.createdAt ? new Date(e.createdAt) : null);
            if (d && d.getMonth() === nowMonth && d.getFullYear() === nowYear) {
                const dept = e.department || 'Unassigned';
                hireMap[dept] = (hireMap[dept] || 0) + 1;
            }
        });

        const nLabels = Object.keys(hireMap).length > 0 ? Object.keys(hireMap)  : ['No new hires'];
        const nValues = Object.keys(hireMap).length > 0 ? Object.values(hireMap) : [0];

        newEmployeesChartInstance = new Chart(ctxNew, {
            type: 'bar',
            data: { labels: nLabels, datasets: [{ label: 'New Hires', data: nValues, backgroundColor: 'rgba(16,185,129,0.75)', borderColor: '#10b981', borderWidth: 1, borderRadius: 5 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: gridColor } }, x: { grid: { display: false } } } }
        });
    }
};

// ─────────────────────────────────────────────────────────────────────
// HEADER SEARCH (searches across cacheEmployees via client-side filter)
// ─────────────────────────────────────────────────────────────────────
const initHeaderSearch = () => {
    const input = document.getElementById('header-search-input');
    if (!input) return;

    // Create dropdown container
    const dropdown = document.createElement('div');
    dropdown.id = 'header-search-results';
    dropdown.style.cssText = `
        position:absolute; top:calc(100% + 6px); left:0; width:320px; max-height:320px;
        overflow-y:auto; background:var(--bg-card); border:1px solid var(--border-color);
        border-radius:12px; box-shadow:0 8px 24px rgba(0,0,0,0.12); z-index:500;
        display:none; padding:.5rem 0;`;

    const searchWrapper = input.closest('.search-bar');
    if (searchWrapper) {
        searchWrapper.style.position = 'relative';
        searchWrapper.appendChild(dropdown);
    }

    let searchTimer = null;

    input.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            const q = input.value.trim().toLowerCase();
            if (q.length < 2) { dropdown.style.display = 'none'; return; }

            const matches = cacheEmployees.filter(e =>
                `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
                (e.email  || '').toLowerCase().includes(q) ||
                (e.department || '').toLowerCase().includes(q) ||
                (e.role   || '').toLowerCase().includes(q)
            ).slice(0, 8);

            if (matches.length === 0) {
                dropdown.innerHTML = `<p style="padding:.75rem 1rem;font-size:.83rem;color:var(--text-muted);">No employees found for "${q}"</p>`;
            } else {
                const frag = document.createDocumentFragment();
                matches.forEach(emp => {
                    const item = document.createElement('a');
                    item.href = 'admin-employees.html';
                    item.style.cssText = `
                        display:flex;align-items:center;gap:.75rem;padding:.6rem 1rem;
                        text-decoration:none;transition:background .15s;`;
                    item.innerHTML = `
                        <div style="width:32px;height:32px;border-radius:50%;background:rgba(79,70,229,0.12);
                                    color:#4f46e5;display:flex;align-items:center;justify-content:center;
                                    font-weight:700;font-size:.8rem;flex-shrink:0;">
                            ${(emp.firstName || '?').charAt(0).toUpperCase()}
                        </div>
                        <div style="min-width:0;">
                            <p style="margin:0;font-size:.83rem;font-weight:600;color:var(--text-main);
                                      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                                ${emp.firstName || ''} ${emp.lastName || ''}
                            </p>
                            <span style="font-size:.72rem;color:var(--text-muted);">
                                ${emp.department || '—'} · ${emp.role || '—'}
                            </span>
                        </div>`;
                    item.addEventListener('mouseenter', () => item.style.background = 'var(--hover-bg)');
                    item.addEventListener('mouseleave', () => item.style.background = 'transparent');
                    frag.appendChild(item);
                });
                dropdown.innerHTML = '';
                dropdown.appendChild(frag);
            }
            dropdown.style.display = 'block';
        }, 180);
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
        if (!searchWrapper?.contains(e.target)) dropdown.style.display = 'none';
    });

    // Close on Escape
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { dropdown.style.display = 'none'; input.blur(); }
    });
};
