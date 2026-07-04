import { db, storage } from './firebase-config.js';
import { 
    collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy, getDoc 
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { 
    ref, uploadBytes, getDownloadURL 
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-storage.js";
import { showToast } from './utils.js';

// State
let employeesData = [];
let currentEditId = null;

const populateDepartmentsDropdown = async () => {
    try {
        let depts = [];
        try {
            const deptSnap = await getDoc(doc(db, "employees", "__config_departments__"));
            if (deptSnap.exists() && deptSnap.data().list) {
                const list = deptSnap.data().list || [];
                depts = list.map(d => d.name).filter(Boolean);
            }
        } catch (deptErr) {
            console.warn("Failed to fetch departments from Firestore (possibly offline). Using local defaults.", deptErr);
        }
        
        // If empty, fall back to default
        if (depts.length === 0) {
            depts = ["Engineering", "Marketing", "Sales", "HR", "Support"];
        }

        // Populate department-filter
        const deptFilter = document.getElementById('department-filter');
        if (deptFilter) {
            deptFilter.innerHTML = '<option value="">All Departments</option>';
            depts.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                deptFilter.appendChild(opt);
            });
        }

        // Populate emp-dept
        const empDept = document.getElementById('emp-dept');
        if (empDept) {
            empDept.innerHTML = '<option value="">Select Department...</option>';
            depts.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                empDept.appendChild(opt);
            });
        }
    } catch (e) {
        console.error("Error populating departments dropdown:", e);
    }
};

export const initEmployeeManagement = async () => {
    console.log("Employee Management initialized.");
    
    // UI Elements
    const addBtn = document.getElementById('add-employee-btn');
    const modal = document.getElementById('employee-modal');
    const closeBtn = document.getElementById('close-modal-btn');
    const cancelBtn = document.getElementById('cancel-modal-btn');
    const form = document.getElementById('employee-form');
    const photoInput = document.getElementById('profile-photo');
    const photoPreview = document.getElementById('photo-preview');
    
    const searchInput = document.getElementById('search-input');
    const deptFilter = document.getElementById('department-filter');

    // Load Data
    await populateDepartmentsDropdown();
    await fetchEmployees();

    // Modal Triggers
    const openModal = () => { modal.classList.add('active'); };
    const closeModal = () => { 
        modal.classList.remove('active');
        form.reset();
        currentEditId = null;
        document.getElementById('modal-title').textContent = "Add New Employee";
        photoPreview.innerHTML = '<i class="fa-solid fa-user text-muted" style="font-size: 2rem;"></i>';
    };

    // Auto-generate password helper
    const generateRandomPassword = () => {
        const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$";
        let password = "cbk-";
        for (let i = 0; i < 8; i++) {
            password += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return password;
    };

    addBtn.addEventListener('click', () => {
        closeModal(); // Reset form
        document.getElementById('password-row').style.display = 'block';
        document.getElementById('emp-password').required = true;
        document.getElementById('emp-password').value = generateRandomPassword();
        openModal();
    });
    
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);

    // Generate Button Listener
    document.getElementById('generate-pwd-btn')?.addEventListener('click', () => {
        document.getElementById('emp-password').value = generateRandomPassword();
    });

    // Photo Preview
    photoInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                photoPreview.innerHTML = `<img src="${e.target.result}" alt="Preview">`;
            };
            reader.readAsDataURL(file);
        }
    });

    // Handle Form Submit (Add / Edit)
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const saveBtn = document.getElementById('save-employee-btn');
        const originalBtnText = saveBtn.innerHTML;
        saveBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...';
        saveBtn.disabled = true;

        try {
            // Get form values
            const firstName = document.getElementById('first-name').value;
            const lastName = document.getElementById('last-name').value;
            const email = document.getElementById('emp-email').value.trim();
            const phone = document.getElementById('emp-phone').value;
            const department = document.getElementById('emp-dept').value;
            const role = document.getElementById('emp-role').value;
            
            let photoUrl = null;

            // Handle Photo Upload if selected
            if (photoInput.files.length > 0) {
                const file = photoInput.files[0];
                const storageRef = ref(storage, `profile_photos/${Date.now()}_${file.name}`);
                const snapshot = await uploadBytes(storageRef, file);
                photoUrl = await getDownloadURL(snapshot.ref);
            }

            const empData = {
                firstName,
                lastName,
                email,
                phone,
                department,
                role,
                updatedAt: new Date()
            };

            if (currentEditId) {
                // UPDATE Existing
                if (photoUrl) empData.photoUrl = photoUrl; // Only update photo if new one uploaded
                await updateDoc(doc(db, "employees", currentEditId), empData);
                console.log("Employee updated!");
            } else {
                // ADD New
                empData.createdAt = new Date();
                empData.empId = generateNextEmpId();
                empData.tempPassword = document.getElementById('emp-password').value; // Save temporary password
                if (photoUrl) empData.photoUrl = photoUrl;
                
                await addDoc(collection(db, "employees"), empData);
                console.log("Employee added!");
            }

            closeModal();
            await fetchEmployees(); // Refresh table

        } catch (error) {
            console.error("Error saving employee: ", error);
            showToast("Failed to save employee. Check console for details.");
        } finally {
            saveBtn.innerHTML = originalBtnText;
            saveBtn.disabled = false;
        }
    });

    // Search and Filter Listeners
    searchInput.addEventListener('input', applyFilters);
    deptFilter.addEventListener('change', applyFilters);
};

// Auto-generate ID: EMP-1000 format
const generateNextEmpId = () => {
    if (employeesData.length === 0) return "EMP-1000";
    
    // Find the highest ID number
    let maxId = 999;
    employeesData.forEach(emp => {
        if (emp.empId && emp.empId.startsWith("EMP-")) {
            const num = parseInt(emp.empId.split("-")[1]);
            if (!isNaN(num) && num > maxId) {
                maxId = num;
            }
        }
    });
    return `EMP-${maxId + 1}`;
};

const fetchEmployees = async () => {
    try {
        const q = query(collection(db, "employees"), orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);
        
        employeesData = [];
        querySnapshot.forEach((doc) => {
            if (!doc.id.startsWith('__config_')) {
                employeesData.push({ id: doc.id, ...doc.data() });
            }
        });
        
        applyFilters(); // Renders the table
    } catch (error) {
        console.error("Error fetching employees: ", error);
        // If index is missing for orderBy, it will throw an error. Fallback to normal fetch.
        try {
            const querySnapshot = await getDocs(collection(db, "employees"));
            employeesData = [];
            querySnapshot.forEach((doc) => {
                if (!doc.id.startsWith('__config_')) {
                    employeesData.push({ id: doc.id, ...doc.data() });
                }
            });
            applyFilters();
        } catch (e) {
            document.getElementById('employee-table-body').innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--danger);">Failed to load data. Please ensure Firebase is configured.</td></tr>`;
        }
    }
};

const applyFilters = () => {
    const searchTerm = document.getElementById('search-input').value.toLowerCase();
    const deptFilter = document.getElementById('department-filter').value;

    const filtered = employeesData.filter(emp => {
        const name = `${emp.firstName} ${emp.lastName}`.toLowerCase();
        const matchesSearch = name.includes(searchTerm) || 
                              (emp.email && emp.email.toLowerCase().includes(searchTerm)) || 
                              (emp.empId && emp.empId.toLowerCase().includes(searchTerm));
        const matchesDept = deptFilter === "" || emp.department === deptFilter;
        
        return matchesSearch && matchesDept;
    });

    renderTable(filtered);
};

const renderTable = (data) => {
    const tbody = document.getElementById('employee-table-body');
    tbody.innerHTML = '';

    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem;">No employees found.</td></tr>`;
        return;
    }

    data.forEach(emp => {
        const tr = document.createElement('tr');
        
        // Avatar generation
        let avatarHtml = '';
        if (emp.photoUrl) {
            avatarHtml = `<img src="${emp.photoUrl}" class="avatar-sm" alt="Profile">`;
        } else {
            const initials = `${emp.firstName?.charAt(0) || ''}${emp.lastName?.charAt(0) || ''}`.toUpperCase();
            avatarHtml = `<div class="avatar-sm">${initials}</div>`;
        }

        const pwdDisplay = emp.tempPassword 
            ? `<div style="display:flex;align-items:center;gap:0.4rem;">
                 <code style="font-family:monospace;font-size:0.825rem;background:var(--hover-bg);padding:0.2rem 0.4rem;border-radius:4px;color:var(--text-main);">${emp.tempPassword}</code>
                 <button class="icon-btn copy-pwd-btn" data-pwd="${emp.tempPassword}" title="Copy password" style="font-size:0.75rem;padding:0.2rem;color:var(--text-muted);">
                     <i class="fa-regular fa-copy"></i>
                 </button>
               </div>`
            : `<span class="badge badge-success">Active</span>`;

        tr.innerHTML = `
            <td>
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    ${avatarHtml}
                    <div>
                        <span style="font-weight: 500; display: block;">${emp.firstName} ${emp.lastName}</span>
                        <span style="font-size: 0.75rem; color: var(--text-muted);">${emp.email}</span>
                    </div>
                </div>
            </td>
            <td style="font-family: monospace; font-weight: 500;">${emp.empId || 'N/A'}</td>
            <td>${emp.phone || 'N/A'}</td>
            <td><span class="badge" style="background: var(--hover-bg); color: var(--text-main);">${emp.department || 'N/A'}</span></td>
            <td>${emp.role || 'N/A'}</td>
            <td>${pwdDisplay}</td>
            <td>
                <div style="display: flex; gap: 0.5rem;">
                    <button class="icon-btn edit-btn" data-id="${emp.id}" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>
                    <button class="icon-btn delete-btn" data-id="${emp.id}" style="color: var(--danger);" title="Delete"><i class="fa-solid fa-trash"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Attach copy password listener
    tbody.querySelectorAll('.copy-pwd-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const pwd = btn.getAttribute('data-pwd');
            navigator.clipboard.writeText(pwd).then(() => {
                showToast("Password copied to clipboard!");
            });
        });
    });

    // Attach Event Listeners to Edit/Delete buttons
    document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => handleEdit(e.currentTarget.getAttribute('data-id')));
    });

    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => handleDelete(e.currentTarget.getAttribute('data-id')));
    });
};

const handleEdit = (id) => {
    const emp = employeesData.find(e => e.id === id);
    if (!emp) return;

    currentEditId = id;
    
    // Hide password row when editing
    document.getElementById('password-row').style.display = 'none';
    document.getElementById('emp-password').required = false;
    document.getElementById('emp-password').value = '';

    // Populate form
    document.getElementById('modal-title').textContent = "Edit Employee";
    document.getElementById('first-name').value = emp.firstName;
    document.getElementById('last-name').value = emp.lastName;
    document.getElementById('emp-email').value = emp.email;
    document.getElementById('emp-phone').value = emp.phone;
    document.getElementById('emp-dept').value = emp.department;
    document.getElementById('emp-role').value = emp.role;
    
    // Preview photo
    const photoPreview = document.getElementById('photo-preview');
    if (emp.photoUrl) {
        photoPreview.innerHTML = `<img src="${emp.photoUrl}" alt="Preview">`;
    } else {
        photoPreview.innerHTML = '<i class="fa-solid fa-user text-muted" style="font-size: 2rem;"></i>';
    }

    document.getElementById('employee-modal').classList.add('active');
};

const handleDelete = async (id) => {
    if (confirm("Are you sure you want to delete this employee? This action cannot be undone.")) {
        try {
            await deleteDoc(doc(db, "employees", id));
            console.log("Document successfully deleted!");
            await fetchEmployees();
        } catch (error) {
            console.error("Error removing document: ", error);
            showToast("Error deleting employee.");
        }
    }
};

