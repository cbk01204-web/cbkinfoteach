import { db } from './firebase-config.js';
import { 
    collection, getDocs, doc, query, where 
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

export const initAdminPayslips = async () => {
    console.log("Admin Payslips initialized.");

    const monthFilter = document.getElementById('month-year-filter');
    const searchInput = document.getElementById('search-input');
    const tbody = document.getElementById('payslips-table-body');
    const modal = document.getElementById('payslip-modal');
    
    // Default to current month (YYYY-MM)
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    monthFilter.value = `${yyyy}-${mm}`;

    let employeesMap = {};
    let allPayslips = [];

    const fetchPayslips = async () => {
        const selectedMonth = monthFilter.value;
        if (!selectedMonth) return;

        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem;"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading...</td></tr>`;

        try {
            // Fetch employees map (if not already fetched)
            if (Object.keys(employeesMap).length === 0) {
                const empSnap = await getDocs(collection(db, "employees"));
                empSnap.forEach(d => {
                    const data = d.data();
                    employeesMap[data.email] = {
                        name: `${data.firstName} ${data.lastName}`,
                        department: data.department || 'N/A',
                        role: data.role || 'N/A'
                    };
                });
            }

            // Fetch processed payroll
            const q = query(
                collection(db, "payroll"),
                where("monthYear", "==", selectedMonth)
            );
            const prSnap = await getDocs(q);
            allPayslips = [];
            prSnap.forEach(d => {
                const data = d.data();
                allPayslips.push({ id: d.id, ...data });
            });

            renderTable();
        } catch (error) {
            console.error("Error fetching payslips:", error);
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--danger); padding: 2rem;">Error loading data.</td></tr>`;
        }
    };

    const renderTable = () => {
        const searchVal = searchInput.value.toLowerCase().trim();
        const filtered = allPayslips.filter(ps => {
            const emp = employeesMap[ps.userId];
            const name = emp ? emp.name.toLowerCase() : ps.userId.toLowerCase();
            return name.includes(searchVal);
        });

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem;">No processed payslips found.</td></tr>`;
            return;
        }

        tbody.innerHTML = '';
        filtered.forEach(ps => {
            const emp = employeesMap[ps.userId] || { name: ps.userId, department: 'N/A', role: 'N/A' };
            const basic = ps.basicSalary || 0;
            const net = ps.netSalary || 0;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight: 500;">${emp.name}</td>
                <td>${emp.department}</td>
                <td>${ps.monthYear}</td>
                <td>₹${basic.toFixed(2)}</td>
                <td style="font-weight: 600; color: var(--primary);">₹${net.toFixed(2)}</td>
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
                const payslip = allPayslips.find(p => p.id === docId);
                if (payslip) openPayslipModal(payslip);
            });
        });
    };

    const openPayslipModal = (ps) => {
        const emp = employeesMap[ps.userId] || { name: ps.userId, department: 'N/A', role: 'N/A' };
        
        // Month Formatting (e.g. October 2026)
        const [year, month] = ps.monthYear.split('-');
        const dateObj = new Date(year, parseInt(month) - 1, 1);
        const monthName = dateObj.toLocaleString('default', { month: 'long' }) + ' ' + year;

        // Populate fields
        document.getElementById('payslip-month').textContent = monthName;
        document.getElementById('payslip-emp-name').textContent = emp.name;
        document.getElementById('payslip-emp-email').textContent = ps.userId;
        document.getElementById('payslip-emp-dept').textContent = emp.department;
        document.getElementById('payslip-emp-role').textContent = emp.role;
        document.getElementById('payslip-ref').textContent = `CBK-PS-${year}-${ps.userId.split('@')[0].toUpperCase()}`;
        const processedDate = ps.processedAt?.toDate ? ps.processedAt.toDate() : (ps.processedAt ? new Date(ps.processedAt) : null);
        document.getElementById('payslip-date').textContent = processedDate ? processedDate.toISOString().split('T')[0] : 'N/A';

        // Earnings values
        const basic = ps.basicSalary || 0;
        const allowances = ps.allowances || 0;
        // Mock HRA and Bonus as standard proportions of basic/allowance for UI completeness
        const hra = basic * 0.1;
        const bonus = 0;
        const gross = basic + hra + allowances + bonus;

        // Deductions values
        const deductions = ps.deductions || 0;
        const pf = basic * 0.08;
        const tax = deductions - pf > 0 ? deductions - pf : 0;
        const other = 0;

        document.getElementById('payslip-val-basic').textContent = `₹${basic.toFixed(2)}`;
        document.getElementById('payslip-val-hra').textContent = `₹${hra.toFixed(2)}`;
        document.getElementById('payslip-val-allowances').textContent = `₹${allowances.toFixed(2)}`;
        document.getElementById('payslip-val-bonus').textContent = `₹${bonus.toFixed(2)}`;
        document.getElementById('payslip-val-gross').textContent = `₹${gross.toFixed(2)}`;

        document.getElementById('payslip-val-pf').textContent = `₹${pf.toFixed(2)}`;
        document.getElementById('payslip-val-tax').textContent = `₹${tax.toFixed(2)}`;
        document.getElementById('payslip-val-other').textContent = `₹${other.toFixed(2)}`;
        document.getElementById('payslip-val-deductions').textContent = `₹${deductions.toFixed(2)}`;

        document.getElementById('payslip-val-net').textContent = `₹${(ps.netSalary || 0).toFixed(2)}`;

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

    // Event Listeners
    monthFilter.addEventListener('change', fetchPayslips);
    searchInput.addEventListener('input', renderTable);

    // Initial Load
    fetchPayslips();
};
