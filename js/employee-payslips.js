import { auth, db } from './firebase-config.js';
import { 
    collection, getDocs, doc, getDoc, query, where, orderBy 
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

export const initEmployeePayslips = () => {
    console.log("Employee Payslips initialized.");

    onAuthStateChanged(auth, async (user) => {
        if (!user) return;

        const userEmail = user.email;
        const tbody = document.getElementById('employee-payslips-tbody');
        const modal = document.getElementById('payslip-modal');

        let employeeInfo = {
            name: 'Employee',
            email: userEmail,
            department: 'N/A',
            role: 'Staff Member'
        };

        let payslipsList = [];

        const loadData = async () => {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem;"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading...</td></tr>`;

        try {
            // 1. Fetch employee details from employees collection matching email
            const qEmp = query(collection(db, "employees"), where("email", "==", userEmail));
            const empSnap = await getDocs(qEmp);
            if (!empSnap.empty) {
                const empDoc = empSnap.docs[0];
                const empData = empDoc.data();
                employeeInfo = {
                    name: `${empData.firstName} ${empData.lastName}`,
                    email: userEmail,
                    department: empData.department || 'N/A',
                    role: empData.role || 'N/A'
                };
                
                // Update UI header profile info
                document.getElementById('profile-name-top').textContent = employeeInfo.name;
                const avatarCode = `${empData.firstName[0] || 'E'}${empData.lastName[0] || 'E'}`.toUpperCase();
                document.getElementById('profile-avatar-top').textContent = avatarCode;
            }

            // 2. Fetch payroll records for this user
            const qPayroll = query(
                collection(db, "payroll"),
                where("userId", "==", userEmail)
            );
            const prSnap = await getDocs(qPayroll);
            payslipsList = [];
            prSnap.forEach(d => {
                payslipsList.push({ id: d.id, ...d.data() });
            });

            // Sort payslips descending by monthYear
            payslipsList.sort((a, b) => b.monthYear.localeCompare(a.monthYear));

            renderTable();
        } catch (error) {
            console.error("Error loading employee payslips:", error);
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--danger); padding: 2rem;">Error loading your payslips.</td></tr>`;
        }
    };

    const renderTable = () => {
        if (payslipsList.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem;">No payslips have been processed for your account yet.</td></tr>`;
            return;
        }

        tbody.innerHTML = '';
        payslipsList.forEach(ps => {
            const basic = ps.basicSalary || 0;
            const allowances = ps.allowances || 0;
            const deductions = ps.deductions || 0;
            const net = ps.netSalary || 0;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight: 500;">${ps.monthYear}</td>
                <td>$${basic.toFixed(2)}</td>
                <td>$${allowances.toFixed(2)}</td>
                <td style="color: var(--danger);">$${deductions.toFixed(2)}</td>
                <td style="font-weight: 600; color: var(--primary);">$${net.toFixed(2)}</td>
                <td>
                    <button class="btn btn-outline view-payslip-btn" data-id="${ps.id}" style="padding: 0.25rem 0.75rem; font-size: 0.75rem;">
                        <i class="fa-solid fa-eye mr-1"></i> View
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Bind View Buttons
        document.querySelectorAll('.view-payslip-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const docId = e.currentTarget.getAttribute('data-id');
                const payslip = payslipsList.find(p => p.id === docId);
                if (payslip) openPayslipModal(payslip);
            });
        });
    };

    const openPayslipModal = (ps) => {
        // Month Formatting (e.g. October 2026)
        const [year, month] = ps.monthYear.split('-');
        const dateObj = new Date(year, parseInt(month) - 1, 1);
        const monthName = dateObj.toLocaleString('default', { month: 'long' }) + ' ' + year;

        // Populate fields
        document.getElementById('payslip-month').textContent = monthName;
        document.getElementById('payslip-emp-name').textContent = employeeInfo.name;
        document.getElementById('payslip-emp-email').textContent = employeeInfo.email;
        document.getElementById('payslip-emp-dept').textContent = employeeInfo.department;
        document.getElementById('payslip-emp-role').textContent = employeeInfo.role;
        document.getElementById('payslip-ref').textContent = `CBK-PS-${year}-${employeeInfo.email.split('@')[0].toUpperCase()}`;
        document.getElementById('payslip-date').textContent = ps.processedAt ? ps.processedAt.split('T')[0] : 'N/A';

        // Earnings values
        const basic = ps.basicSalary || 0;
        const allowances = ps.allowances || 0;
        const hra = basic * 0.1;
        const bonus = 0;
        const gross = basic + hra + allowances + bonus;

        // Deductions values
        const deductions = ps.deductions || 0;
        const pf = basic * 0.08;
        const tax = deductions - pf > 0 ? deductions - pf : 0;
        const other = 0;

        document.getElementById('payslip-val-basic').textContent = `$${basic.toFixed(2)}`;
        document.getElementById('payslip-val-hra').textContent = `$${hra.toFixed(2)}`;
        document.getElementById('payslip-val-allowances').textContent = `$${allowances.toFixed(2)}`;
        document.getElementById('payslip-val-bonus').textContent = `$${bonus.toFixed(2)}`;
        document.getElementById('payslip-val-gross').textContent = `$${gross.toFixed(2)}`;

        document.getElementById('payslip-val-pf').textContent = `$${pf.toFixed(2)}`;
        document.getElementById('payslip-val-tax').textContent = `$${tax.toFixed(2)}`;
        document.getElementById('payslip-val-other').textContent = `$${other.toFixed(2)}`;
        document.getElementById('payslip-val-deductions').textContent = `$${deductions.toFixed(2)}`;

        document.getElementById('payslip-val-net').textContent = `$${(ps.netSalary || 0).toFixed(2)}`;

        // Open modal
        modal.classList.add('active');
    };

    // Close Modal Events
    const closeModal = () => modal.classList.remove('active');
    document.getElementById('close-modal-btn').addEventListener('click', closeModal);
    document.getElementById('close-modal-footer-btn').addEventListener('click', closeModal);

    // Print Payslip
    document.getElementById('print-payslip-btn').addEventListener('click', () => {
        window.print();
    });

    // Initial Load
    loadData();
    });
};
