import { db } from './firebase-config.js';
import { 
    collection, getDocs, updateDoc, doc, query, orderBy 
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { createNotification } from './notifications.js';

export const initAdminLeaves = async () => {
    console.log("Admin Leaves module initialized.");

    const statusFilter = document.getElementById('status-filter');
    const tbody = document.getElementById('admin-leaves-body');
    const balanceTbody = document.getElementById('leave-balance-body');

    let allLeaves = [];
    let employeesMap = {};

    const fetchAllLeaves = async () => {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem;"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading data...</td></tr>`;
        balanceTbody.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 1.5rem;"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading...</td></tr>`;

        // Reset stat values to skeletons
        const statsIds = ['stat-pending-leaves', 'stat-approved-leaves', 'stat-rejected-leaves', 'stat-active-leaves', 'stat-upcoming-leaves'];
        statsIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<span class="skeleton" style="width: 40px; height: 18px;"></span>';
        });

        try {
            // 1. Fetch and map employees
            const empSnapshot = await getDocs(collection(db, "employees"));
            employeesMap = {};
            empSnapshot.forEach(d => {
                const data = d.data();
                employeesMap[data.email] = `${data.firstName} ${data.lastName}`;
            });

            // 2. Fetch leaves
            let leaveSnapshot;
            try {
                leaveSnapshot = await getDocs(query(collection(db, "leaves"), orderBy("appliedAt", "desc")));
            } catch (e) {
                // Fallback if index missing
                leaveSnapshot = await getDocs(collection(db, "leaves"));
            }

            allLeaves = [];
            leaveSnapshot.forEach(d => {
                allLeaves.push({ id: d.id, ...d.data() });
            });

            // If manual sorting was required by fallback
            if (!allLeaves[0]?.appliedAt?.toDate) {
                allLeaves.sort((a,b) => {
                    const tA = a.appliedAt?.toDate ? a.appliedAt.toDate() : new Date(a.appliedAt);
                    const tB = b.appliedAt?.toDate ? b.appliedAt.toDate() : new Date(b.appliedAt);
                    return tB - tA;
                });
            }

            calculateMetricsAndBalance();
            renderTable();
        } catch (error) {
            console.error("Error loading leave management data:", error);
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger); padding: 2rem;">Error loading data.</td></tr>`;
            balanceTbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--danger); padding: 1.5rem;">Error.</td></tr>`;
        }
    };

    const calculateMetricsAndBalance = () => {
        const todayStr = new Date().toISOString().split('T')[0];

        let pendingCount = 0;
        let approvedCount = 0;
        let rejectedCount = 0;
        let activeCount = 0;
        let upcomingCount = 0;

        // Balance tracking map: email -> { annualUsed, sickUsed }
        const usageMap = {};
        Object.keys(employeesMap).forEach(email => {
            usageMap[email] = { annualUsed: 0, sickUsed: 0 };
        });

        allLeaves.forEach(leave => {
            // Count states
            if (leave.status === 'Pending') {
                pendingCount++;
            } else if (leave.status === 'Approved') {
                approvedCount++;

                // Currently on leave (today falls within range)
                if (todayStr >= leave.startDate && todayStr <= leave.endDate) {
                    activeCount++;
                }
                // Upcoming leave (starts in the future)
                else if (leave.startDate > todayStr) {
                    upcomingCount++;
                }

                // Calculate duration in days
                const sDate = new Date(leave.startDate);
                const eDate = new Date(leave.endDate);
                const duration = Math.ceil(Math.abs(eDate - sDate) / (1000 * 60 * 60 * 24)) + 1;

                // Accumulate usage
                if (usageMap[leave.userId]) {
                    if (leave.leaveType === 'Annual Leave') {
                        usageMap[leave.userId].annualUsed += duration;
                    } else if (leave.leaveType === 'Sick Leave') {
                        usageMap[leave.userId].sickUsed += duration;
                    }
                }
            } else if (leave.status === 'Rejected') {
                rejectedCount++;
            }
        });

        // Update stats summary headers
        document.getElementById('stat-pending-leaves').textContent = pendingCount;
        document.getElementById('stat-approved-leaves').textContent = approvedCount;
        document.getElementById('stat-rejected-leaves').textContent = rejectedCount;
        document.getElementById('stat-active-leaves').textContent = activeCount;
        document.getElementById('stat-upcoming-leaves').textContent = upcomingCount;

        // Render Leave Balance Summary
        balanceTbody.innerHTML = '';
        const emails = Object.keys(employeesMap);
        if (emails.length === 0) {
            balanceTbody.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 1rem;">No employees registered.</td></tr>`;
            return;
        }

        emails.forEach(email => {
            const name = employeesMap[email];
            const usage = usageMap[email] || { annualUsed: 0, sickUsed: 0 };
            
            // Standard limits: Annual = 15 days, Sick = 10 days
            const annualRem = Math.max(0, 15 - usage.annualUsed);
            const sickRem = Math.max(0, 10 - usage.sickUsed);

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 110px;" title="${name}">${name}</td>
                <td><span style="font-weight: 600; color: var(--primary);">${annualRem}d</span> <span style="font-size:0.75rem; color:var(--text-muted);">/15</span></td>
                <td><span style="font-weight: 600; color: var(--secondary);">${sickRem}d</span> <span style="font-size:0.75rem; color:var(--text-muted);">/10</span></td>
            `;
            balanceTbody.appendChild(tr);
        });
    };

    const renderTable = () => {
        const filterVal = statusFilter.value;
        const filtered = filterVal === 'All' ? allLeaves : allLeaves.filter(l => l.status === filterVal);

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem;">No leave requests found.</td></tr>`;
            return;
        }

        tbody.innerHTML = '';
        filtered.forEach(data => {
            const empName = employeesMap[data.userId] || data.userId;
            
            const sDate = new Date(data.startDate);
            const eDate = new Date(data.endDate);
            const durationDays = Math.ceil(Math.abs(eDate - sDate) / (1000 * 60 * 60 * 24)) + 1;

            let badgeClass = 'badge-warning';
            if (data.status === 'Approved') badgeClass = 'badge-success';
            else if (data.status === 'Rejected') badgeClass = 'badge-danger';
            else if (data.status === 'Cancelled') badgeClass = 'badge-secondary';

            let actionHtml = '-';
            if (data.status === 'Pending') {
                actionHtml = `
                    <div style="display:flex; gap: 0.5rem;">
                        <button class="btn btn-outline approve-btn" data-id="${data.id}" data-user="${data.userId}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; color: var(--secondary); border-color: var(--secondary);"><i class="fa-solid fa-check"></i></button>
                        <button class="btn btn-outline reject-btn" data-id="${data.id}" data-user="${data.userId}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; color: var(--danger); border-color: var(--danger);"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                `;
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight: 500;">${empName}</td>
                <td>${data.leaveType}</td>
                <td><span style="font-weight:600;">${durationDays} Day(s)</span></td>
                <td style="font-size: 0.875rem;">${data.startDate} to ${data.endDate}</td>
                <td style="max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${data.reason}">${data.reason}</td>
                <td><span class="badge ${badgeClass}">${data.status}</span></td>
                <td>${actionHtml}</td>
            `;
            tbody.appendChild(tr);
        });

        // Bind Approve/Reject buttons
        document.querySelectorAll('.approve-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const btnEl = e.currentTarget;
                const id = btnEl.getAttribute('data-id');
                const userEmail = btnEl.getAttribute('data-user');
                
                btnEl.disabled = true;
                btnEl.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';

                try {
                    await updateDoc(doc(db, "leaves", id), { status: 'Approved' });
                    await createNotification(
                        userEmail,
                        "Leave Approved",
                        "Your leave application has been approved by the HR Director.",
                        "leave"
                    );
                    fetchAllLeaves();
                } catch (err) {
                    console.error("Error approving leave:", err);
                    btnEl.disabled = false;
                    btnEl.innerHTML = '<i class="fa-solid fa-check"></i>';
                }
            });
        });

        document.querySelectorAll('.reject-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const btnEl = e.currentTarget;
                const id = btnEl.getAttribute('data-id');
                const userEmail = btnEl.getAttribute('data-user');
                
                btnEl.disabled = true;
                btnEl.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';

                try {
                    await updateDoc(doc(db, "leaves", id), { status: 'Rejected' });
                    await createNotification(
                        userEmail,
                        "Leave Rejected",
                        "Your leave application has been rejected. Please contact HR.",
                        "leave"
                    );
                    fetchAllLeaves();
                } catch (err) {
                    console.error("Error rejecting leave:", err);
                    btnEl.disabled = false;
                    btnEl.innerHTML = '<i class="fa-solid fa-xmark"></i>';
                }
            });
        });
    };

    // Event listeners
    statusFilter.addEventListener('change', renderTable);

    // Initial Fetch
    fetchAllLeaves();
};
