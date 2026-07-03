import { db } from './firebase-config.js';
import { 
    collection, getDocs, query, where 
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

export const initAdminDepartments = async () => {
    console.log("Admin Departments initialized.");

    const departmentsGrid = document.getElementById('departments-grid');
    const modal = document.getElementById('dept-modal');
    const modalTitle = document.getElementById('dept-modal-title');
    const modalTbody = document.getElementById('dept-modal-tbody');

    const DEPARTMENTS = [
        { name: 'Engineering', icon: 'fa-code', color: 'primary', manager: 'Alex Rivera' },
        { name: 'Marketing', icon: 'fa-bullhorn', color: 'success', manager: 'Sarah Jenkins' },
        { name: 'Sales', icon: 'fa-chart-line', color: 'warning', manager: 'Michael Chang' },
        { name: 'HR', icon: 'fa-users', color: 'info', manager: 'Emma Watson' },
        { name: 'Support', icon: 'fa-headset', color: 'danger', manager: 'David Miller' }
    ];

    let employeesList = [];
    let payrollList = [];

    const loadData = async () => {
        try {
            // Fetch employees
            const empSnap = await getDocs(collection(db, "employees"));
            employeesList = [];
            empSnap.forEach(d => {
                employeesList.push({ id: d.id, ...d.data() });
            });

            // Fetch current month's payroll to sum budget
            const today = new Date();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const yyyy = today.getFullYear();
            const currentMonth = `${yyyy}-${mm}`;

            const q = query(
                collection(db, "payroll"),
                where("monthYear", "==", currentMonth)
            );
            const prSnap = await getDocs(q);
            payrollList = [];
            prSnap.forEach(d => {
                payrollList.push(d.data());
            });

            // Set overview stats
            document.getElementById('stat-total-emp').textContent = employeesList.length;

            renderDepartments();
        } catch (error) {
            console.error("Error loading departments data:", error);
            departmentsGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--danger);">
                <i class="fa-solid fa-triangle-exclamation fa-2x"></i> Error loading department details.
            </div>`;
        }
    };

    const renderDepartments = () => {
        departmentsGrid.innerHTML = '';

        DEPARTMENTS.forEach(dept => {
            // Filter employees
            const deptEmps = employeesList.filter(emp => emp.department === dept.name);
            
            // Calculate monthly budget (sum processed payroll, fallback to mock average for unprocessed)
            let totalBudget = 0;
            deptEmps.forEach(emp => {
                const payroll = payrollList.find(p => p.userId === emp.email);
                totalBudget += payroll ? payroll.netSalary : 4500.00; // Fallback value
            });

            // Find HOD (first with manager/director title, or default to HOD name in config)
            let managerName = dept.manager;
            const managerEmp = deptEmps.find(emp => {
                const role = (emp.role || '').toLowerCase();
                return role.includes('manager') || role.includes('head') || role.includes('director');
            });
            if (managerEmp) {
                managerName = `${managerEmp.firstName} ${managerEmp.lastName}`;
            }

            const card = document.createElement('div');
            card.className = 'chart-card';
            card.style.cssText = `
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                min-height: 250px;
                padding: 1.5rem;
                position: relative;
                transition: transform 0.3s ease, box-shadow 0.3s ease;
                border: 1px solid var(--border-color);
            `;
            
            card.innerHTML = `
                <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem;">
                        <h3 style="margin: 0; font-size: 1.25rem; font-weight: 700; color: var(--text-main);">${dept.name}</h3>
                        <div class="stat-icon ${dept.color}" style="width: 42px; height: 42px; font-size: 1.2rem; border-radius: 10px;">
                            <i class="fa-solid ${dept.icon}"></i>
                        </div>
                    </div>
                    
                    <div style="margin-bottom: 1rem; font-size: 0.9rem; line-height: 1.8;">
                        <p style="margin: 0; color: var(--text-muted);">
                            <strong>Head of Dept:</strong> <span style="color: var(--text-main); font-weight: 500;">${managerName}</span>
                        </p>
                        <p style="margin: 0; color: var(--text-muted);">
                            <strong>Total Employees:</strong> <span style="color: var(--text-main); font-weight: 500;">${deptEmps.length} Members</span>
                        </p>
                        <p style="margin: 0; color: var(--text-muted);">
                            <strong>Monthly Budget:</strong> <span style="color: var(--primary); font-weight: 600;">$${totalBudget.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                        </p>
                    </div>
                </div>

                <button class="btn btn-outline view-members-btn" data-dept="${dept.name}" style="width: 100%; border-radius: 8px; font-size: 0.8rem; padding: 0.5rem; margin-top: 1rem;">
                    <i class="fa-solid fa-eye mr-2"></i> View Members
                </button>
            `;

            // Hover effect
            card.addEventListener('mouseenter', () => {
                card.style.transform = 'translateY(-5px)';
                card.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1)';
            });
            card.addEventListener('mouseleave', () => {
                card.style.transform = 'none';
                card.style.boxShadow = 'var(--shadow-subtle)';
            });

            departmentsGrid.appendChild(card);
        });

        // Bind members view click
        document.querySelectorAll('.view-members-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const deptName = e.currentTarget.getAttribute('data-dept');
                openMembersModal(deptName);
            });
        });
    };

    const openMembersModal = (deptName) => {
        const deptEmps = employeesList.filter(emp => emp.department === deptName);
        modalTitle.textContent = `${deptName} Department Members`;

        if (deptEmps.length === 0) {
            modalTbody.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 2rem;">No employees assigned to this department yet.</td></tr>`;
        } else {
            modalTbody.innerHTML = '';
            deptEmps.forEach(emp => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="font-weight: 500;">${emp.firstName} ${emp.lastName}</td>
                    <td>${emp.email}</td>
                    <td>${emp.role || 'N/A'}</td>
                `;
                modalTbody.appendChild(tr);
            });
        }

        modal.classList.add('active');
    };

    // Close Modal Events
    const closeModal = () => modal.classList.remove('active');
    document.getElementById('close-dept-modal').addEventListener('click', closeModal);
    document.getElementById('close-dept-modal-btn').addEventListener('click', closeModal);

    // Initial Load
    loadData();
};
