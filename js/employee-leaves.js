import { auth, db } from './firebase-config.js';
import { 
    collection, getDocs, addDoc, updateDoc, doc, query, where, orderBy, Timestamp 
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

export const initEmployeeLeaves = () => {
    console.log("Employee Leaves initialized.");

    onAuthStateChanged(auth, async (user) => {
        if (!user) return;

        const userEmail = user.email;

        const modal = document.getElementById('leave-modal');
        const applyBtn = document.getElementById('apply-leave-btn');
        const closeBtn = document.getElementById('close-modal-btn');
        const cancelBtn = document.getElementById('cancel-modal-btn');
        const form = document.getElementById('leave-form');
        const tbody = document.getElementById('leaves-table-body');

        // Modal Control
        const openModal = () => modal.classList.add('active');
        const closeModal = () => {
            modal.classList.remove('active');
            form.reset();
        };

        // Check if listeners are already attached to prevent duplicates on auth changes
        if (!applyBtn.dataset.listenerAttached) {
            applyBtn.addEventListener('click', openModal);
            closeBtn.addEventListener('click', closeModal);
            cancelBtn.addEventListener('click', closeModal);
            applyBtn.dataset.listenerAttached = "true";
        }

        // Form Submit (Apply Leave)
        if (!form.dataset.listenerAttached) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const submitBtn = document.getElementById('submit-leave-btn');
                submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Submitting...';
                submitBtn.disabled = true;

                try {
                    const leaveData = {
                        userId: userEmail,
                        leaveType: document.getElementById('leave-type').value,
                        startDate: document.getElementById('start-date').value,
                        endDate: document.getElementById('end-date').value,
                        reason: document.getElementById('leave-reason').value,
                        status: 'Pending',
                        appliedAt: Timestamp.now()
                    };

                    // Basic validation
                    if (new Date(leaveData.startDate) > new Date(leaveData.endDate)) {
                        showToast("End Date cannot be before Start Date.");
                        return;
                    }

                    await addDoc(collection(db, "leaves"), leaveData);
                    closeModal();
                    fetchMyLeaves(); // refresh
                } catch (error) {
                    console.error("Error applying for leave:", error);
                    showToast("Failed to apply for leave.");
                } finally {
                    submitBtn.innerHTML = 'Submit Application';
                    submitBtn.disabled = false;
                }
            });
            form.dataset.listenerAttached = "true";
        }

        // Fetch and Display Leaves
        const fetchMyLeaves = async () => {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem;"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading...</td></tr>`;
            try {
                const q = query(
                    collection(db, "leaves"),
                    where("userId", "==", userEmail),
                    orderBy("appliedAt", "desc")
                );
                const snapshot = await getDocs(q);
                
                if (snapshot.empty) {
                    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem;">You have not applied for any leaves.</td></tr>`;
                    return;
                }

                tbody.innerHTML = '';
                snapshot.forEach(docSnap => {
                    const data = docSnap.data();
                    
                    // Calculate Duration
                    const sDate = new Date(data.startDate);
                    const eDate = new Date(data.endDate);
                    const diffTime = Math.abs(eDate - sDate);
                    const durationDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end

                    // Status Badge
                    let badgeClass = 'badge-warning';
                    if (data.status === 'Approved') badgeClass = 'badge-success';
                    else if (data.status === 'Rejected') badgeClass = 'badge-danger';
                    else if (data.status === 'Cancelled') badgeClass = 'badge-secondary';

                    // Cancel Button Logic
                    let actionHtml = '-';
                    if (data.status === 'Pending') {
                        actionHtml = `<button class="btn btn-outline cancel-leave-btn" data-id="${docSnap.id}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; color: var(--danger); border-color: var(--danger);">Cancel</button>`;
                    }

                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td style="font-weight: 500;">${data.leaveType}</td>
                        <td>${data.startDate}</td>
                        <td>${data.endDate}</td>
                        <td>${durationDays} Day(s)</td>
                        <td>${data.appliedAt?.toDate ? data.appliedAt.toDate().toLocaleDateString() : new Date(data.appliedAt).toLocaleDateString()}</td>
                        <td><span class="badge ${badgeClass}">${data.status}</span></td>
                        <td>${actionHtml}</td>
                    `;
                    tbody.appendChild(tr);
                });

                // Bind Cancel events
                document.querySelectorAll('.cancel-leave-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        if (confirm("Are you sure you want to cancel this leave application?")) {
                            const id = e.target.getAttribute('data-id');
                            try {
                                await updateDoc(doc(db, "leaves", id), { status: 'Cancelled' });
                                fetchMyLeaves();
                            } catch(err) {
                                console.error("Error cancelling leave:", err);
                            }
                        }
                    });
                });

            } catch (error) {
                console.error("Error fetching leaves:", error);
                // Fallback if missing index
                try {
                    const snapshot = await getDocs(query(collection(db, "leaves"), where("userId", "==", userEmail)));
                    const docs = [];
                    snapshot.forEach(d => docs.push({id: d.id, ...d.data()}));
                    docs.sort((a,b) => {
                        const tA = a.appliedAt?.toDate ? a.appliedAt.toDate() : new Date(a.appliedAt || 0);
                        const tB = b.appliedAt?.toDate ? b.appliedAt.toDate() : new Date(b.appliedAt || 0);
                        return tB - tA;
                    });
                    
                    tbody.innerHTML = '';
                    docs.forEach(docSnap => {
                        const data = docSnap;
                        
                        const sDate = new Date(data.startDate);
                        const eDate = new Date(data.endDate);
                        const diffTime = Math.abs(eDate - sDate);
                        const durationDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

                        let badgeClass = 'badge-warning';
                        if (data.status === 'Approved') badgeClass = 'badge-success';
                        else if (data.status === 'Rejected') badgeClass = 'badge-danger';
                        else if (data.status === 'Cancelled') badgeClass = 'badge-secondary';

                        let actionHtml = '-';
                        if (data.status === 'Pending') {
                            actionHtml = `<button class="btn btn-outline cancel-leave-btn" data-id="${docSnap.id}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; color: var(--danger); border-color: var(--danger);">Cancel</button>`;
                        }

                        const tr = document.createElement('tr');
                        tr.innerHTML = `
                            <td style="font-weight: 500;">${data.leaveType}</td>
                            <td>${data.startDate}</td>
                            <td>${data.endDate}</td>
                            <td>${durationDays} Day(s)</td>
                            <td>${data.appliedAt?.toDate ? data.appliedAt.toDate().toLocaleDateString() : new Date(data.appliedAt).toLocaleDateString()}</td>
                            <td><span class="badge ${badgeClass}">${data.status}</span></td>
                            <td>${actionHtml}</td>
                        `;
                        tbody.appendChild(tr);
                    });
                } catch (e) {
                     tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger); padding: 2rem;">Error loading data.</td></tr>`;
                }
            }
        };

        // Initial Fetch
        await fetchMyLeaves();
    });
};

