import { showToast } from './utils.js';
import { db } from './firebase-config.js';
import { 
    collection, getDocs, query, where 
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

export const initAdminReports = async () => {
    console.log("Admin Reports Dashboard module initialized.");

    const reportTypeSelect = document.getElementById('report-type');
    const monthFilter = document.getElementById('month-filter');
    const generateBtn = document.getElementById('generate-btn');
    
    const exportPdfBtn = document.getElementById('export-pdf-btn');
    const exportExcelBtn = document.getElementById('export-excel-btn');
    const exportCsvBtn = document.getElementById('export-csv-btn');

    const thead = document.getElementById('report-thead');
    const tbody = document.getElementById('report-tbody');
    const chartTitle = document.getElementById('chart-title');
    const tableTitle = document.getElementById('table-title');

    // Default Date to YYYY-MM format
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    monthFilter.value = `${yyyy}-${mm}`;

    let chartInstance = null;
    
    // Global state arrays for exports
    let currentHeaders = [];
    let currentRows = [];
    let currentReportName = "Report";

    const getEmployeesMap = async () => {
        const empSnap = await getDocs(collection(db, "employees"));
        let map = {};
        empSnap.forEach(d => {
            const data = d.data();
            map[data.email] = `${data.firstName} ${data.lastName}`;
        });
        return map;
    };

    const generateReport = async () => {
        const type = reportTypeSelect.value;
        const monthVal = monthFilter.value; // YYYY-MM
        
        generateBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Loading...';
        generateBtn.disabled = true;

        tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 2rem;"><i class="fa-solid fa-circle-notch fa-spin"></i> Compiling report data from Firestore...</td></tr>`;
        thead.innerHTML = '';
        
        currentHeaders = [];
        currentRows = [];
        currentReportName = `${type}_Report_${monthVal}`;

        try {
            const empMap = await getEmployeesMap();

            if (type === 'Attendance') {
                await generateAttendanceReport(monthVal, empMap);
            } else if (type === 'Payroll') {
                await generatePayrollReport(monthVal, empMap);
            } else if (type === 'Employees') {
                await generateEmployeeReport();
            } else if (type === 'Leaves') {
                await generateLeaveReport(monthVal, empMap);
            } else if (type === 'Departments') {
                await generateDepartmentReport(monthVal);
            }
            
            renderTableUI();
        } catch (error) {
            console.error("Report Compilation Error:", error);
            tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--danger); padding: 2rem;">Failed to compile report. Check console.</td></tr>`;
        } finally {
            generateBtn.innerHTML = '<i class="fa-solid fa-bolt mr-2"></i> Generate';
            generateBtn.disabled = false;
        }
    };

    // --- Dynamic Generators ---

    const generateAttendanceReport = async (monthStr, empMap) => {
        chartTitle.textContent = `Attendance Metrics (${monthStr})`;
        tableTitle.textContent = "Attendance Log";

        const aSnap = await getDocs(collection(db, "attendance"));
        currentHeaders = ["Employee", "Date", "Status", "Working Hours", "Overtime"];
        
        let lateCount = 0;
        let onTimeCount = 0;

        aSnap.forEach(d => {
            const data = d.data();
            // Check if record matches filter month
            if (data.date && data.date.startsWith(monthStr)) {
                let status = "Punched In";
                if (data.isLate) { 
                    status = "Late"; 
                    lateCount++; 
                } else if (data.punchOut) { 
                    status = "On Time"; 
                    onTimeCount++; 
                }

                currentRows.push([
                    empMap[data.userId] || data.userId,
                    data.date,
                    status,
                    data.workingHours ? `${data.workingHours.toFixed(1)}h` : '0h',
                    data.overtimeHours ? `${data.overtimeHours.toFixed(1)}h` : '0h'
                ]);
            }
        });

        renderChart('pie', ['On Time', 'Late'], [onTimeCount, lateCount], 'Attendance Distribution');
    };

    const generatePayrollReport = async (monthStr, empMap) => {
        chartTitle.textContent = `Payroll Breakdown (${monthStr})`;
        tableTitle.textContent = "Processed Payroll";

        const pSnap = await getDocs(query(collection(db, "payroll"), where("monthYear", "==", monthStr)));
        currentHeaders = ["Employee", "Basic ($)", "Allowances ($)", "Deductions ($)", "Net Salary ($)", "Status"];
        
        let empNames = [];
        let netSalaries = [];

        pSnap.forEach(d => {
            const data = d.data();
            const deductions = (data.pf || 0) + (data.tax || 0) + (data.otherDeductions || 0);
            const name = empMap[data.userId] || data.userId;
            
            currentRows.push([
                name,
                data.basicSalary ? data.basicSalary.toFixed(2) : '0.00',
                data.allowances ? data.allowances.toFixed(2) : '0.00',
                deductions.toFixed(2),
                data.netSalary ? data.netSalary.toFixed(2) : '0.00',
                data.status || 'Processed'
            ]);

            empNames.push(name.split(" ")[0]);
            netSalaries.push(data.netSalary || 0);
        });

        renderChart('bar', empNames, netSalaries, 'Net Salary Payments ($)');
    };

    const generateEmployeeReport = async () => {
        chartTitle.textContent = "Employee Department Distribution";
        tableTitle.textContent = "Employee Register Roster";

        const eSnap = await getDocs(collection(db, "employees"));
        currentHeaders = ["ID", "Name", "Email", "Department", "Role", "Phone"];
        
        let deptCounts = {};
        
        eSnap.forEach(d => {
            const data = d.data();
            currentRows.push([
                data.empId || 'N/A',
                `${data.firstName} ${data.lastName}`,
                data.email,
                data.department || 'N/A',
                data.role || 'N/A',
                data.phone || 'N/A'
            ]);

            const dept = data.department || 'Unassigned';
            deptCounts[dept] = (deptCounts[dept] || 0) + 1;
        });

        renderChart('doughnut', Object.keys(deptCounts), Object.values(deptCounts), 'Headcount');
    };

    const generateLeaveReport = async (monthStr, empMap) => {
        chartTitle.textContent = `Leave Request Overview (${monthStr})`;
        tableTitle.textContent = "Leave Ledger";

        const lSnap = await getDocs(collection(db, "leaves"));
        currentHeaders = ["Employee", "Type", "Start Date", "End Date", "Status"];
        
        let statusCounts = { Approved: 0, Pending: 0, Rejected: 0, Cancelled: 0 };

        lSnap.forEach(d => {
            const data = d.data();
            // Filter leaves that start in this filtered month
            if (data.startDate && data.startDate.startsWith(monthStr)) {
                currentRows.push([
                    empMap[data.userId] || data.userId,
                    data.leaveType,
                    data.startDate,
                    data.endDate,
                    data.status
                ]);
                if (statusCounts[data.status] !== undefined) {
                    statusCounts[data.status]++;
                }
            }
        });

        renderChart('bar', Object.keys(statusCounts), Object.values(statusCounts), 'Request Count');
    };

    const generateDepartmentReport = async (monthStr) => {
        chartTitle.textContent = `Department Resource Budget Overview (${monthStr})`;
        tableTitle.textContent = "Department Summary Data";

        const empSnap = await getDocs(collection(db, "employees"));
        const paySnap = await getDocs(query(collection(db, "payroll"), where("monthYear", "==", monthStr)));

        const deptMap = {}; // department -> { headcount: 0, totalSalary: 0 }
        
        // Count headcount
        empSnap.forEach(d => {
            const data = d.data();
            const dept = data.department || 'Unassigned';
            if (!deptMap[dept]) {
                deptMap[dept] = { headcount: 0, totalSalary: 0, emails: [] };
            }
            deptMap[dept].headcount++;
            deptMap[dept].emails.push(data.email);
        });

        // Add matching salary budgets
        paySnap.forEach(d => {
            const data = d.data();
            // Find which department this user belongs to
            Object.keys(deptMap).forEach(deptName => {
                if (deptMap[deptName].emails.includes(data.userId)) {
                    deptMap[deptName].totalSalary += (data.netSalary || 0);
                }
            });
        });

        currentHeaders = ["Department", "Staff Headcount", "Total Net Payroll ($)", "Avg Salary ($)"];
        
        const depts = Object.keys(deptMap);
        const budgets = [];

        depts.forEach(deptName => {
            const info = deptMap[deptName];
            const avg = info.headcount > 0 ? (info.totalSalary / info.headcount) : 0;
            currentRows.push([
                deptName,
                info.headcount,
                info.totalSalary.toFixed(2),
                avg.toFixed(2)
            ]);
            budgets.push(info.totalSalary);
        });

        renderChart('bar', depts, budgets, 'Payroll Budget ($)');
    };

    // --- UI Renderers ---

    const renderTableUI = () => {
        thead.innerHTML = '<tr>' + currentHeaders.map(h => `<th>${h}</th>`).join('') + '</tr>';
        
        if (currentRows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${currentHeaders.length}" style="text-align: center; padding: 2rem;">No matching data found for the selected criteria.</td></tr>`;
            return;
        }

        tbody.innerHTML = currentRows.map(row => {
            return '<tr>' + row.map(cell => `<td>${cell}</td>`).join('') + '</tr>';
        }).join('');
    };

    const renderChart = (type, labels, dataPoints, label) => {
        const isDark = document.body.classList.contains('dark-theme');
        const textColor = isDark ? '#94a3b8' : '#64748b';
        const gridColor = isDark ? '#334155' : '#e2e8f0';

        Chart.defaults.color = textColor;
        Chart.defaults.font.family = "'Inter', sans-serif";

        if (chartInstance) chartInstance.destroy();

        const ctx = document.getElementById('reportChart').getContext('2d');
        chartInstance = new Chart(ctx, {
            type: type,
            data: {
                labels: labels,
                datasets: [{
                    label: label,
                    data: dataPoints,
                    backgroundColor: [
                        'rgba(79, 70, 229, 0.75)', // Indigo
                        'rgba(16, 185, 129, 0.75)', // Emerald
                        'rgba(245, 158, 11, 0.75)',  // Amber
                        'rgba(236, 72, 153, 0.75)',  // Pink
                        'rgba(14, 165, 233, 0.75)',  // Sky Blue
                        'rgba(139, 92, 246, 0.75)'   // Purple
                    ],
                    borderColor: isDark ? '#1e293b' : '#fff',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: { boxWidth: 12, padding: 8 }
                    }
                },
                scales: type !== 'pie' && type !== 'doughnut' ? {
                    y: {
                        beginAtZero: true,
                        grid: { color: gridColor, drawBorder: false }
                    },
                    x: {
                        grid: { display: false, drawBorder: false }
                    }
                } : {}
            }
        });
    };

    // --- Export Engines ---

    const exportToPDF = () => {
        if (currentRows.length === 0) {
            showToast("Please generate a report with data first.");
            return;
        }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        doc.text(`CBK INFOTECH HRMS - ${currentReportName.replace(/_/g, ' ')}`, 14, 15);
        
        doc.autoTable({
            head: [currentHeaders],
            body: currentRows,
            startY: 20,
            theme: 'grid',
            styles: { fontSize: 8, font: 'helvetica' },
            headStyles: { fillColor: [79, 70, 229] } // Match brand indigo
        });
        
        doc.save(`${currentReportName}.pdf`);
    };

    const exportToExcel = () => {
        if (currentRows.length === 0) {
            showToast("Please generate a report with data first.");
            return;
        }
        const sheetData = [currentHeaders, ...currentRows];
        const ws = XLSX.utils.aoa_to_sheet(sheetData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "HRMS Report");
        
        XLSX.writeFile(wb, `${currentReportName}.xlsx`);
    };

    const exportToCSV = () => {
        if (currentRows.length === 0) {
            showToast("Please generate a report with data first.");
            return;
        }

        const escapeCsv = (val) => {
            if (val === null || val === undefined) return '';
            let str = String(val);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                str = '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        };

        const csvContent = [
            currentHeaders.map(escapeCsv).join(','),
            ...currentRows.map(row => row.map(escapeCsv).join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `${currentReportName}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    // Listeners
    generateBtn.addEventListener('click', generateReport);
    exportPdfBtn.addEventListener('click', exportToPDF);
    exportExcelBtn.addEventListener('click', exportToExcel);
    exportCsvBtn.addEventListener('click', exportToCSV);

    // Initial load
    generateReport();
};
