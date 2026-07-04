import { db } from './firebase-config.js';
import { 
    collection, getDocs, query, where, Timestamp 
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// Store chart instances globally to avoid overlay conflicts during destroy/re-render
let dailyChartInstance = null;
let weeklyChartInstance = null;

export const initAdminAttendance = () => {
    console.log("Admin Attendance Dashboard initialized.");

    const dateFilter = document.getElementById('date-filter');
    const refreshBtn = document.getElementById('refresh-btn');
    
    // Set default date to today
    const today = new Date().toISOString().split('T')[0];
    if (!dateFilter.value) {
        dateFilter.value = today;
    }

    const loadRecords = async () => {
        const selectedDate = dateFilter.value;
        if (!selectedDate) return;

        const tbody = document.getElementById('attendance-table-body');
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem;"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading attendance records...</td></tr>`;

        // Reset summary stats to skeletons
        const elements = ['stat-present', 'stat-absent', 'stat-late', 'stat-half-day', 'stat-wfh', 'stat-leave', 'stat-rate'];
        elements.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<span class="skeleton" style="width: 45px; height: 18px;"></span>';
        });

        try {
            // 1. Fetch Employees count once (Optimized lookup cache)
            const empSnapshot = await getDocs(collection(db, "employees"));
            const employeesMap = {};
            empSnapshot.forEach(doc => {
                const data = doc.data();
                employeesMap[data.email] = `${data.firstName} ${data.lastName}`;
            });
            const totalEmployees = empSnapshot.size;

            // 2. Fetch daily attendance records (Optimized date query)
            const qDailyAtt = query(
                collection(db, "attendance"),
                where("date", "==", selectedDate)
            );
            const attSnapshot = await getDocs(qDailyAtt);
            const records = [];
            attSnapshot.forEach(doc => {
                records.push({ id: doc.id, ...doc.data() });
            });

            // 3. Fetch leaves active for the selectedDate
            const leavesSnapshot = await getDocs(collection(db, "leaves"));
            let onLeaveCount = 0;
            const onLeaveEmails = [];
            leavesSnapshot.forEach(d => {
                const data = d.data();
                if (data.status === 'Approved' && selectedDate >= data.startDate && selectedDate <= data.endDate) {
                    onLeaveCount++;
                    onLeaveEmails.push(data.userId); // Email of employee on leave
                }
            });

            // 4. Calculate stats metrics
            let presentCount = 0;
            let lateCount = 0;
            let halfDayCount = 0;
            let wfhCount = 0;

            records.forEach(rec => {
                const isWfh = rec.isWfh || rec.workMode === 'WFH';
                if (isWfh) {
                    wfhCount++;
                } else {
                    presentCount++;
                }

                if (rec.isLate) {
                    lateCount++;
                }

                // Half day is defined as working >0 but <5 hours
                if (rec.workingHours > 0 && rec.workingHours < 5) {
                    halfDayCount++;
                }
            });

            // Absent = Total - (Present check-ins + WFH check-ins + On Leave)
            const activeToday = presentCount + wfhCount;
            let absentCount = totalEmployees - activeToday - onLeaveCount;
            if (absentCount < 0) absentCount = 0;

            // Attendance Rate = Checked-in employees / Total Employees
            const rateVal = totalEmployees > 0 ? ((activeToday / totalEmployees) * 100) : 0;

            // Render stats card values
            document.getElementById('stat-present').textContent = presentCount;
            document.getElementById('stat-absent').textContent = absentCount;
            document.getElementById('stat-late').textContent = lateCount;
            document.getElementById('stat-half-day').textContent = halfDayCount;
            document.getElementById('stat-wfh').textContent = wfhCount;
            document.getElementById('stat-leave').textContent = onLeaveCount;
            document.getElementById('stat-rate').textContent = `${rateVal.toFixed(0)}%`;

            // 5. Query weekly attendance records (Past 7 days up to selectedDate)
            const selectedDateObj = new Date(selectedDate);
            const past7DaysDates = [];
            for (let i = 6; i >= 0; i--) {
                const d = new Date(selectedDateObj);
                d.setDate(selectedDateObj.getDate() - i);
                past7DaysDates.push(d.toISOString().split('T')[0]);
            }
            const minDateLimit = past7DaysDates[0];

            const qWeeklyAtt = query(
                collection(db, "attendance"),
                where("date", ">=", minDateLimit),
                where("date", "<=", selectedDate)
            );
            const weeklySnapshot = await getDocs(qWeeklyAtt);
            
            const weeklyRecordsByDate = {};
            past7DaysDates.forEach(d => { weeklyRecordsByDate[d] = 0; });

            weeklySnapshot.forEach(doc => {
                const data = doc.data();
                if (weeklyRecordsByDate[data.date] !== undefined) {
                    weeklyRecordsByDate[data.date]++;
                }
            });

            const weeklyRates = past7DaysDates.map(d => {
                const count = weeklyRecordsByDate[d] || 0;
                return totalEmployees > 0 ? Math.round((count / totalEmployees) * 100) : 0;
            });

            // 6. Draw Dashboard Charts
            renderAttendanceCharts(
                { present: presentCount, absent: absentCount, late: lateCount, halfDay: halfDayCount, wfh: wfhCount, leave: onLeaveCount },
                past7DaysDates.map(d => {
                    const parts = d.split('-');
                    return `${parts[1]}/${parts[2]}`; // MM/DD format
                }),
                weeklyRates
            );

            // 7. Render Attendance List Table (Maintaining existing style)
            if (records.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem;">No attendance records found for this date.</td></tr>`;
                return;
            }

            tbody.innerHTML = '';
            records.forEach(rec => {
                const tr = document.createElement('tr');
                const empName = employeesMap[rec.userId] || rec.userId;
                
                const pInTime = rec.punchIn ? rec.punchIn.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'N/A';
                const pOutTime = rec.punchOut ? rec.punchOut.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Active';
                
                // Formatting Hours
                let hoursStr = '0h 0m';
                if (rec.workingHours) {
                    const h = Math.floor(rec.workingHours);
                    const m = Math.round((rec.workingHours - h) * 60);
                    hoursStr = `${h}h ${m}m`;
                }

                let ovHoursStr = '0h 0m';
                if (rec.overtimeHours) {
                    const oh = Math.floor(rec.overtimeHours);
                    const om = Math.round((rec.overtimeHours - oh) * 60);
                    ovHoursStr = `${oh}h ${om}m`;
                }

                // Badges matching existing design
                let statusBadges = '';
                if (rec.isLate) statusBadges += '<span class="badge badge-warning" style="margin-right: 5px;">Late</span>';
                if (rec.isEarlyExit) statusBadges += '<span class="badge badge-danger" style="margin-right: 5px;">Early Exit</span>';
                if (!rec.isLate && !rec.isEarlyExit && rec.punchOut) statusBadges += '<span class="badge badge-success" style="margin-right: 5px;">On Time</span>';
                if (!rec.punchOut) {
                    const breaks = rec.breaks || [];
                    const isOnBreak = breaks.length > 0 && !breaks[breaks.length - 1].end;
                    if (isOnBreak) {
                        statusBadges += '<span class="badge badge-warning" style="margin-right: 5px; background: rgba(245,158,11,0.12); color: #f59e0b;">On Break</span>';
                    } else {
                        statusBadges += '<span class="badge badge-info" style="margin-right: 5px;">Working</span>';
                    }
                }

                tr.innerHTML = `
                    <td style="font-weight: 500;">${empName}</td>
                    <td>${rec.date}</td>
                    <td>${pInTime}</td>
                    <td>${pOutTime}</td>
                    <td style="font-weight: 600; color: var(--primary);">${hoursStr}</td>
                    <td style="color: ${rec.overtimeHours > 0 ? 'var(--secondary)' : 'var(--text-muted)'};">${ovHoursStr}</td>
                    <td>${statusBadges}</td>
                `;
                
                tbody.appendChild(tr);
            });

        } catch (error) {
            console.error("Error loading attendance data:", error);
            let errMsg = "Error loading data. Please try again.";
            if (error.code === 'permission-denied' || error.message?.includes('permissions')) {
                errMsg = `<i class="fa-solid fa-lock" style="margin-right:6px;"></i> 
                    Access denied. Please set up Firestore Security Rules in your 
                    <a href="https://console.firebase.google.com/project/cbkinfotech/firestore/rules" 
                       target="_blank" style="color:var(--primary);">Firebase Console</a>.`;
            }
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger); padding: 2rem;">${errMsg}</td></tr>`;
        }
    };

    const renderAttendanceCharts = (dailyData, weeklyLabels, weeklyValues) => {
        if (typeof Chart === 'undefined') return;

        const isDark = document.body.classList.contains('dark-theme');
        const textColor = isDark ? '#94a3b8' : '#64748b';
        const gridColor = isDark ? '#334155' : '#e2e8f0';

        Chart.defaults.color = textColor;
        Chart.defaults.font.family = "'Inter', sans-serif";

        // Destroy previous instances to avoid overlay rendering issues
        if (dailyChartInstance) dailyChartInstance.destroy();
        if (weeklyChartInstance) weeklyChartInstance.destroy();

        // 1. Daily Breakdown Chart (Doughnut)
        const ctxDaily = document.getElementById('dailyAttendanceChart').getContext('2d');
        dailyChartInstance = new Chart(ctxDaily, {
            type: 'doughnut',
            data: {
                labels: ['Present', 'Absent', 'Late', 'Half Day', 'WFH', 'Leave'],
                datasets: [{
                    data: [dailyData.present, dailyData.absent, dailyData.late, dailyData.halfDay, dailyData.wfh, dailyData.leave],
                    backgroundColor: [
                        '#10b981', // Present (Green)
                        '#ef4444', // Absent (Red)
                        '#f59e0b', // Late (Yellow)
                        '#0ea5e9', // Half Day (Sky Blue)
                        '#4f46e5', // WFH (Indigo)
                        '#8b5cf6'  // Leave (Purple)
                    ],
                    borderWidth: isDark ? 2 : 0,
                    borderColor: isDark ? '#1e293b' : '#fff',
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            boxWidth: 12,
                            padding: 10,
                            usePointStyle: true,
                            pointStyle: 'circle'
                        }
                    }
                }
            }
        });

        // 2. Weekly Attendance Chart (Line with gradient)
        const ctxWeekly = document.getElementById('weeklyAttendanceChart').getContext('2d');
        const gradient = ctxWeekly.createLinearGradient(0, 0, 0, 200);
        gradient.addColorStop(0, 'rgba(16, 185, 129, 0.4)');
        gradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

        weeklyChartInstance = new Chart(ctxWeekly, {
            type: 'line',
            data: {
                labels: weeklyLabels,
                datasets: [{
                    label: 'Attendance Rate (%)',
                    data: weeklyValues,
                    borderColor: '#10b981',
                    backgroundColor: gradient,
                    borderWidth: 2,
                    pointBackgroundColor: '#10b981',
                    pointBorderColor: '#fff',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        ticks: { callback: value => `${value}%` },
                        grid: { color: gridColor, drawBorder: false }
                    },
                    x: {
                        grid: { display: false, drawBorder: false }
                    }
                }
            }
        });
    };

    // Listeners
    dateFilter.addEventListener('change', loadRecords);
    refreshBtn.addEventListener('click', loadRecords);

    // Initial load
    loadRecords();
};
