import { showToast } from './utils.js';
import { db } from './firebase-config.js';
import { 
    collection, getDocs, doc, query, where, setDoc, Timestamp 
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { createNotification } from './notifications.js';

// Global variables for Chart instances to avoid overlapping/hover glitches
let monthlyPayrollChartInstance = null;
let deptPayrollCostChartInstance = null;

export const initAdminPayroll = async () => {
    console.log("Admin Payroll Analytics initialized.");

    const monthFilter = document.getElementById('month-year-filter');
    const tbody = document.getElementById('payroll-table-body');
    const modal = document.getElementById('payroll-modal');
    const form = document.getElementById('payroll-form');

    // Default to current month (YYYY-MM)
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    if (!monthFilter.value) {
        monthFilter.value = `${yyyy}-${mm}`;
    }

    let employeesList = [];
    let currentPayrollDocs = {}; // Mapping of email -> payroll data for current month
    let allPayrollRecords = []; // Historical payroll for trends

    const fetchPayrollData = async () => {
        const selectedMonth = monthFilter.value;
        if (!selectedMonth) return;

        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem;"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading payroll records...</td></tr>`;

        // Reset summary stats to loading skeletons
        const statIds = ['stat-monthly-total', 'stat-processed-count', 'stat-pending-count', 'stat-avg-salary', 'stat-highest-salary'];
        statIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<span class="skeleton" style="width: 50px; height: 18px;"></span>';
        });

        try {
            // 1. Fetch all employees (if not fetched yet)
            if (employeesList.length === 0) {
                const empSnap = await getDocs(collection(db, "employees"));
                employeesList = [];
                empSnap.forEach(d => employeesList.push({ id: d.id, ...d.data() }));
            }

            if (employeesList.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem;">No employees found in the system.</td></tr>`;
                return;
            }

            // 2. Fetch payroll records for this month
            const q = query(
                collection(db, "payroll"),
                where("monthYear", "==", selectedMonth)
            );
            const prSnap = await getDocs(q);
            currentPayrollDocs = {};
            prSnap.forEach(d => {
                const data = d.data();
                currentPayrollDocs[data.userId] = data;
            });

            // 3. Fetch historical payroll records (for past 6 months trend chart)
            const histSnap = await getDocs(collection(db, "payroll"));
            allPayrollRecords = [];
            histSnap.forEach(d => {
                allPayrollRecords.push(d.data());
            });

            // Calculate Metrics
            calculateAnalyticsMetrics(selectedMonth);
            renderTable();
        } catch (error) {
            console.error("Error fetching payroll data:", error);
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--danger); padding: 2rem;">Error loading payroll data.</td></tr>`;
        }
    };

    const calculateAnalyticsMetrics = (selectedMonth) => {
        let monthlyTotal = 0;
        let processedCount = 0;
        let highestSalary = 0;
        const salaries = [];

        // Department cost maps
        const deptCostMap = {};
        employeesList.forEach(emp => {
            const payroll = currentPayrollDocs[emp.email];
            if (payroll) {
                processedCount++;
                const net = payroll.netSalary || 0;
                monthlyTotal += net;
                salaries.push(net);
                if (net > highestSalary) highestSalary = net;

                // Department accumulation
                const dept = emp.department || 'Unassigned';
                deptCostMap[dept] = (deptCostMap[dept] || 0) + net;
            }
        });

        const pendingCount = employeesList.length - processedCount;
        const avgSalary = processedCount > 0 ? (monthlyTotal / processedCount) : 0;

        // Render stats cards values
        document.getElementById('stat-monthly-total').textContent = `$${monthlyTotal.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
        document.getElementById('stat-processed-count').textContent = processedCount;
        document.getElementById('stat-pending-count').textContent = pendingCount;
        document.getElementById('stat-avg-salary').textContent = `$${avgSalary.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
        document.getElementById('stat-highest-salary').textContent = `$${highestSalary.toLocaleString(undefined, {maximumFractionDigits: 0})}`;

        // 4. Construct Last 6 Months Labels & Values for Line Chart
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const [selYear, selMonth] = selectedMonth.split('-').map(Number);
        
        const last6Months = [];
        for (let i = 5; i >= 0; i--) {
            const date = new Date(selYear, selMonth - 1 - i, 1);
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            last6Months.push({
                key: `${y}-${m}`,
                label: `${monthNames[date.getMonth()]} ${y}`
            });
        }

        const monthlyTrendValues = last6Months.map(item => {
            let sum = 0;
            allPayrollRecords.forEach(p => {
                if (p.monthYear === item.key) {
                    sum += p.netSalary || 0;
                }
            });
            return sum;
        });

        // 5. Draw Charts
        renderPayrollCharts(
            last6Months.map(x => x.label),
            monthlyTrendValues,
            Object.keys(deptCostMap).length > 0 ? Object.keys(deptCostMap) : ['None'],
            Object.keys(deptCostMap).length > 0 ? Object.values(deptCostMap) : [0]
        );
    };

    const renderPayrollCharts = (trendLabels, trendValues, deptLabels, deptValues) => {
        if (typeof Chart === 'undefined') return;

        const isDark = document.body.classList.contains('dark-theme');
        const textColor = isDark ? '#94a3b8' : '#64748b';
        const gridColor = isDark ? '#334155' : '#e2e8f0';

        Chart.defaults.color = textColor;
        Chart.defaults.font.family = "'Inter', sans-serif";

        if (monthlyPayrollChartInstance) monthlyPayrollChartInstance.destroy();
        if (deptPayrollCostChartInstance) deptPayrollCostChartInstance.destroy();

        // 1. Monthly Payroll Cost Trend (Line Chart)
        const ctxMonthly = document.getElementById('monthlyPayrollChart').getContext('2d');
        const gradient = ctxMonthly.createLinearGradient(0, 0, 0, 200);
        gradient.addColorStop(0, 'rgba(79, 70, 229, 0.4)');
        gradient.addColorStop(1, 'rgba(79, 70, 229, 0.0)');

        monthlyPayrollChartInstance = new Chart(ctxMonthly, {
            type: 'line',
            data: {
                labels: trendLabels,
                datasets: [{
                    label: 'Total Cost ($)',
                    data: trendValues,
                    borderColor: '#4f46e5',
                    backgroundColor: gradient,
                    borderWidth: 2,
                    pointBackgroundColor: '#4f46e5',
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
                        ticks: { callback: value => `$${value}` },
                        grid: { color: gridColor, drawBorder: false }
                    },
                    x: {
                        grid: { display: false, drawBorder: false }
                    }
                }
            }
        });

        // 2. Department Cost Distribution (Bar Chart)
        const ctxDept = document.getElementById('deptPayrollCostChart').getContext('2d');
        deptPayrollCostChartInstance = new Chart(ctxDept, {
            type: 'bar',
            data: {
                labels: deptLabels,
                datasets: [{
                    label: 'Department Cost ($)',
                    data: deptValues,
                    backgroundColor: 'rgba(16, 185, 129, 0.75)',
                    borderColor: '#10b981',
                    borderWidth: 1,
                    borderRadius: 4
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
                        ticks: { callback: value => `$${value}` },
                        grid: { color: gridColor, drawBorder: false }
                    },
                    x: {
                        grid: { display: false, drawBorder: false }
                    }
                }
            }
        });
    };

    const renderTable = () => {
        tbody.innerHTML = '';

        employeesList.forEach(emp => {
            const payrollData = currentPayrollDocs[emp.email];
            const isProcessed = !!payrollData;
            
            const netSalary = isProcessed ? payrollData.netSalary : 0;
            const statusBadge = isProcessed 
                ? `<span class="badge badge-success">Processed</span>` 
                : `<span class="badge badge-warning">Pending</span>`;
            
            const actionBtn = isProcessed
                ? `<button class="btn btn-outline process-btn" data-email="${emp.email}" style="padding: 0.25rem 0.75rem; font-size: 0.75rem;"><i class="fa-solid fa-pen"></i> Edit</button>`
                : `<button class="btn btn-primary process-btn" data-email="${emp.email}" style="padding: 0.25rem 0.75rem; font-size: 0.75rem;">Process</button>`;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight: 500;">${emp.firstName} ${emp.lastName}</td>
                <td>${emp.department || 'N/A'}</td>
                <td>${emp.role || 'N/A'}</td>
                <td style="font-weight: 600; color: var(--primary);">$${netSalary.toFixed(2)}</td>
                <td>${statusBadge}</td>
                <td>${actionBtn}</td>
            `;
            tbody.appendChild(tr);
        });

        // Bind Process Buttons
        document.querySelectorAll('.process-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const email = e.currentTarget.getAttribute('data-email');
                openModal(email);
            });
        });
    };

    // --- Modal Logic ---
    const openModal = (email) => {
        const emp = employeesList.find(e => e.email === email);
        if (!emp) return;

        document.getElementById('modal-emp-name').textContent = `${emp.firstName} ${emp.lastName}`;
        document.getElementById('modal-emp-dept').textContent = `${emp.department || 'N/A'} | ${emp.role || 'N/A'}`;
        document.getElementById('emp-email').value = emp.email;

        const pData = currentPayrollDocs[email];
        
        // Populate or Reset
        document.getElementById('basic-salary').value = pData ? pData.basicSalary : '';
        document.getElementById('hra').value = pData ? pData.hra : 0;
        document.getElementById('allowances').value = pData ? pData.allowances : 0;
        document.getElementById('bonus').value = pData ? pData.bonus : 0;
        document.getElementById('pf').value = pData ? pData.pf : 0;
        document.getElementById('tax').value = pData ? pData.tax : 0;
        document.getElementById('other-deductions').value = pData ? pData.otherDeductions : 0;

        calculateNet();
        modal.classList.add('active');
    };

    const calculateNet = () => {
        const getVal = (id) => parseFloat(document.getElementById(id).value) || 0;
        
        const earnings = getVal('basic-salary') + getVal('hra') + getVal('allowances') + getVal('bonus');
        const deductions = getVal('pf') + getVal('tax') + getVal('other-deductions');
        const net = earnings - deductions;

        const display = document.getElementById('net-salary-display');
        display.textContent = `$${net.toFixed(2)}`;
        
        if (net < 0) {
            display.style.color = 'var(--danger)';
        } else {
            display.style.color = 'var(--primary)';
        }
    };

    // Live Calculation Listeners
    document.querySelectorAll('.calc-input').forEach(input => {
        input.addEventListener('input', calculateNet);
    });

    document.getElementById('close-modal-btn').addEventListener('click', () => modal.classList.remove('active'));
    document.getElementById('cancel-modal-btn').addEventListener('click', () => modal.classList.remove('active'));

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById('save-payroll-btn');
        submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...';
        submitBtn.disabled = true;

        try {
            const email = document.getElementById('emp-email').value;
            const selectedMonth = monthFilter.value;
            
            const getVal = (id) => parseFloat(document.getElementById(id).value) || 0;
            const earnings = getVal('basic-salary') + getVal('hra') + getVal('allowances') + getVal('bonus');
            const deductions = getVal('pf') + getVal('tax') + getVal('other-deductions');
            const netSalary = earnings - deductions;

            const payrollData = {
                userId: email,
                monthYear: selectedMonth,
                basicSalary: getVal('basic-salary'),
                hra: getVal('hra'),
                allowances: getVal('allowances'),
                bonus: getVal('bonus'),
                pf: getVal('pf'),
                tax: getVal('tax'),
                otherDeductions: getVal('other-deductions'),
                netSalary: netSalary,
                status: 'Processed',
                processedAt: Timestamp.now()
            };

            const docId = `${email}_${selectedMonth}`;
            await setDoc(doc(db, "payroll", docId), payrollData);
            
            // Send Notification
            await createNotification(email, "Salary Credited", `Your payroll for ${selectedMonth} has been processed. Net Salary: $${netSalary.toFixed(2)}.`, "payroll");

            modal.classList.remove('active');
            await fetchPayrollData(); // Refresh metrics and table
        } catch (error) {
            console.error("Error saving payroll:", error);
            showToast("Failed to process payroll.");
        } finally {
            submitBtn.innerHTML = 'Save & Process';
            submitBtn.disabled = false;
        }
    });

    monthFilter.addEventListener('change', fetchPayrollData);

    // Initial Fetch
    await fetchPayrollData();
};
