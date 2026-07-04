/**
 * Utility Functions Module
 * Contains reusable components like Toast notifications and formatting helpers.
 */

/**
 * Displays a custom Toast notification.
 * @param {string} message - The message to display.
 * @param {string} [type='info'] - The type of toast ('success', 'error', 'info', 'warning').
 */
export const showToast = (message, type = 'info') => {
    // Check if container exists, if not create it
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 10px;
        `;
        document.body.appendChild(container);
    }

    // Create Toast Element
    const toast = document.createElement('div');
    
    // Set colors based on type
    let bgColor = 'var(--primary)';
    let icon = 'fa-info-circle';
    
    if (type === 'success') { bgColor = 'var(--success)'; icon = 'fa-check-circle'; }
    if (type === 'error') { bgColor = 'var(--danger)'; icon = 'fa-exclamation-circle'; }
    if (type === 'warning') { bgColor = 'var(--warning)'; icon = 'fa-triangle-exclamation'; }

    toast.style.cssText = `
        background-color: ${bgColor};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.2);
        display: flex;
        align-items: center;
        gap: 10px;
        font-weight: 500;
        opacity: 0;
        transform: translateX(100%);
        transition: all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
        min-width: 250px;
        max-width: 350px;
    `;
    
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    // Animate In
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(0)';
    });

    // Auto Remove after 4 seconds
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (container.contains(toast)) {
                container.removeChild(toast);
            }
        }, 300);
    }, 4000);
};

/**
 * Formats a number as a currency string.
 * @param {number} amount - The amount to format.
 * @param {string} [currency='USD'] - The currency code.
 * @returns {string} Formatted currency string.
 */
export const formatCurrency = (amount, currency = 'USD') => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency
    }).format(amount);
};

/**
 * Retries a promise-returning function upon failure.
 * @param {Function} fn - The async function to retry.
 * @param {number} [retries=3] - Number of retry attempts.
 * @param {number} [delayMs=1500] - Delay between retries.
 */
export const runWithRetry = async (fn, retries = 3, delayMs = 1500) => {
    let lastErr = null;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            const isNetworkErr = !navigator.onLine || err.message?.includes("network") || err.code === "unavailable" || err.message?.includes("failed");
            if (!isNetworkErr || i === retries - 1) {
                throw err;
            }
            console.warn(`[Firestore] Request failed, retrying in ${delayMs}ms... (Attempt ${i + 1}/${retries})`);
            await new Promise(res => setTimeout(res, delayMs));
        }
    }
    throw lastErr;
};
