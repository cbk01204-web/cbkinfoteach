import { db } from './firebase-config.js';
import { 
    collection, getDocs, query, where, doc, getDoc, setDoc 
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

export const initAdminDepartments = async () => {
    console.log("Admin Departments initialized.");

    const departmentsGrid = document.getElementById('departments-grid');
    const modal = document.getElementById('dept-modal');
    const modalTitle = document.getElementById('dept-modal-title');
    const modalTbody = document.getElementById('dept-modal-tbody');

    // Add Department Modal elements
    const addDeptBtn = document.getElementById('add-dept-btn');
    const addDeptModal = document.getElementById('add-dept-modal');
    const closeAddDeptModal = document.getElementById('close-add-dept-modal');
    const cancelAddDeptBtn = document.getElementById('cancel-add-dept-btn');
    const addDeptForm = document.getElementById('add-dept-form');

    let DEPARTMENTS = [];
    let employeesList = [];
    let payrollList = [];

    const loadData = async () => {
        try {
            // Fetch employees (excluding configuration documents)
            const empSnap = await getDocs(collection(db, "employees"));
            employeesList = [];
            empSnap.forEach(d => {
                if (!d.id.startsWith('__config_')) {
                    employeesList.push({ id: d.id, ...d.data() });
                }
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

            // Fetch departments from employees/__config_departments__
            DEPARTMENTS = [];
            try {
                const configDocRef = doc(db, "employees", "__config_departments__");
                const docSnap = await getDoc(configDocRef);
                if (docSnap.exists() && docSnap.data().list) {
                    DEPARTMENTS = docSnap.data().list;
                } else {
                    // Seed default departments
                    DEPARTMENTS = [
                        { id: '1', name: 'Engineering', icon: 'fa-code', color: 'primary', manager: 'Alex Rivera' },
                        { id: '2', name: 'Marketing', icon: 'fa-bullhorn', color: 'success', manager: 'Sarah Jenkins' },
                        { id: '3', name: 'Sales', icon: 'fa-chart-line', color: 'warning', manager: 'Michael Chang' },
                        { id: '4', name: 'HR', icon: 'fa-users', color: 'info', manager: 'Emma Watson' },
                        { id: '5', name: 'Support', icon: 'fa-headset', color: 'danger', manager: 'David Miller' }
                    ];
                    await setDoc(configDocRef, { list: DEPARTMENTS });
                }
            } catch (deptErr) {
                console.warn("Failed to fetch departments from Firestore. Using local defaults.", deptErr);
                DEPARTMENTS = [
                    { id: '1', name: 'Engineering', icon: 'fa-code', color: 'primary', manager: 'Alex Rivera' },
                    { id: '2', name: 'Marketing', icon: 'fa-bullhorn', color: 'success', manager: 'Sarah Jenkins' },
                    { id: '3', name: 'Sales', icon: 'fa-chart-line', color: 'warning', manager: 'Michael Chang' },
                    { id: '4', name: 'HR', icon: 'fa-users', color: 'info', manager: 'Emma Watson' },
                    { id: '5', name: 'Support', icon: 'fa-headset', color: 'danger', manager: 'David Miller' }
                ];
            }

            // Set overview stats
            document.getElementById('stat-total-depts').textContent = DEPARTMENTS.length;
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
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <button class="delete-dept-btn icon-btn text-danger" data-id="${dept.id}" title="Delete Department" style="font-size: 0.95rem; border: none; background: transparent; cursor: pointer; opacity: 0.7;">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                            <div class="stat-icon ${dept.color}" style="width: 42px; height: 42px; font-size: 1.2rem; border-radius: 10px;">
                                <i class="fa-solid ${dept.icon}"></i>
                            </div>
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
                            <strong>Monthly Budget:</strong> <span style="color: var(--primary); font-weight: 600;">₹${totalBudget.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
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

        // Bind delete click
        document.querySelectorAll('.delete-dept-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const deptId = e.currentTarget.getAttribute('data-id');
                const deptName = DEPARTMENTS.find(d => d.id === deptId)?.name || 'this department';
                
                showCustomConfirm(`Are you sure you want to delete the "${deptName}" department? This action cannot be undone.`, async () => {
                    try {
                        const updatedDepts = DEPARTMENTS.filter(d => d.id !== deptId);
                        const configDocRef = doc(db, "employees", "__config_departments__");
                        await setDoc(configDocRef, { list: updatedDepts });

                        import('./utils.js').then(m => m.showToast("Department deleted successfully.", "success"));
                        await loadData();
                    } catch (error) {
                        console.error("Error deleting department:", error);
                        import('./utils.js').then(m => m.showToast("Failed to delete department.", "danger"));
                    }
                });
            });
        });
    };

    const showCustomConfirm = (message, onConfirm) => {
        const confirmModal = document.getElementById('confirm-delete-modal');
        const msgEl = document.getElementById('confirm-delete-msg');
        const cancelBtn = document.getElementById('confirm-delete-cancel-btn');
        const confirmBtn = document.getElementById('confirm-delete-btn');

        if (!confirmModal || !msgEl || !cancelBtn || !confirmBtn) return;

        msgEl.textContent = message;
        confirmModal.classList.add('active');

        const closeConfirm = () => {
            confirmModal.classList.remove('active');
            const newConfirmBtn = confirmBtn.cloneNode(true);
            const newCancelBtn = cancelBtn.cloneNode(true);
            confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
            cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
        };

        const activeConfirmBtn = document.getElementById('confirm-delete-btn');
        const activeCancelBtn = document.getElementById('confirm-delete-cancel-btn');

        activeCancelBtn.addEventListener('click', closeConfirm);
        activeConfirmBtn.addEventListener('click', () => {
            onConfirm();
            closeConfirm();
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

    // Add Department modal open/close
    const openAddDeptModal = () => {
        addDeptModal.classList.add('active');
    };
    
    const closeAddDeptModalFn = () => {
        addDeptModal.classList.remove('active');
        addDeptForm.reset();
    };

    if (addDeptBtn) addDeptBtn.addEventListener('click', openAddDeptModal);
    if (closeAddDeptModal) closeAddDeptModal.addEventListener('click', closeAddDeptModalFn);
    if (cancelAddDeptBtn) cancelAddDeptBtn.addEventListener('click', closeAddDeptModalFn);

    if (addDeptForm) {
        addDeptForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('dept-name').value.trim();
            const manager = document.getElementById('dept-manager').value.trim();
            const icon = document.getElementById('dept-icon').value;
            const color = document.getElementById('dept-color').value;

            // Check if department already exists
            if (DEPARTMENTS.some(d => d.name.toLowerCase() === name.toLowerCase())) {
                import('./utils.js').then(m => m.showToast("Department name already exists.", "warning"));
                return;
            }

            try {
                const newDept = {
                    id: Date.now().toString(),
                    name,
                    manager,
                    icon,
                    color
                };
                const updatedDepts = [...DEPARTMENTS, newDept];
                const configDocRef = doc(db, "employees", "__config_departments__");
                await setDoc(configDocRef, { list: updatedDepts });

                import('./utils.js').then(m => m.showToast("Department added successfully.", "success"));
                closeAddDeptModalFn();
                await loadData();
            } catch (error) {
                console.error("Error adding department:", error);
                import('./utils.js').then(m => m.showToast("Failed to add department.", "danger"));
            }
        });
    }

    // Initial Load
    loadData();
};
