/* ============================================
   INVOY — Main Application Logic
   ============================================ */

const App = (() => {
    // --- State ---
    let currentInvoice = null;
    let editingInvoiceId = null;
    let settings = {};
    let lineItemCounter = 0;
    let sortableInstance = null;

    // --- Utility ---
    function uuid() {
        return 'xxxx-xxxx-xxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));
    }

    function $(selector) { return document.querySelector(selector); }
    function $$(selector) { return document.querySelectorAll(selector); }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    function showToast(message, type = 'info') {
        const container = $('#toast-container');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(60px)'; }, 2800);
        setTimeout(() => toast.remove(), 3100);
    }

    function openModal(id) {
        document.getElementById(id).classList.add('active');
    }

    function closeModal(id) {
        document.getElementById(id).classList.remove('active');
    }

    function formatDateForInput(dateStr) {
        if (!dateStr) return '';
        return dateStr.substring(0, 10);
    }

    function addDays(dateStr, days) {
        const d = new Date(dateStr + 'T00:00:00');
        d.setDate(d.getDate() + days);
        return d.toISOString().substring(0, 10);
    }

    function todayStr() {
        return new Date().toISOString().substring(0, 10);
    }

    // --- Router ---
    function navigate() {
        const hash = location.hash.replace('#', '') || 'dashboard';
        const viewMap = {
            'dashboard': 'view-dashboard',
            'new': 'view-editor',
            'edit': 'view-editor',
            'clients': 'view-clients',
            'settings': 'view-settings'
        };

        const viewKey = hash.split('/')[0];
        const viewId = viewMap[viewKey] || 'view-dashboard';

        // Hide all views
        $$('.view').forEach(v => v.style.display = 'none');

        // Show target
        const target = document.getElementById(viewId);
        if (target) target.style.display = 'block';

        // Update nav
        $$('.nav-link').forEach(l => l.classList.remove('active'));
        const activeLink = $(`.nav-link[data-view="${viewKey === 'edit' ? 'editor' : viewKey === 'new' ? 'editor' : viewKey}"]`);
        if (activeLink) activeLink.classList.add('active');

        // Close mobile sidebar
        $('#sidebar').classList.remove('open');

        // View-specific init
        if (viewKey === 'dashboard') loadDashboard();
        else if (viewKey === 'new') initNewInvoice();
        else if (viewKey === 'edit') initEditInvoice(hash.split('/')[1]);
        else if (viewKey === 'clients') loadClients();
        else if (viewKey === 'settings') loadSettings();
    }

    // ==================== DASHBOARD ====================
    async function loadDashboard() {
        const invoices = await InvoyDB.getAllInvoices();
        invoices.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // Stats
        let totalRevenue = 0, outstanding = 0, overdue = 0;
        const today = todayStr();

        invoices.forEach(inv => {
            const total = computeTotal(inv);
            const paid = parseFloat(inv.amountPaid) || 0;
            if (inv.status === 'paid') {
                totalRevenue += total;
            } else if (inv.status === 'sent' || inv.status === 'overdue') {
                outstanding += total - paid;
                if (inv.dueDate && inv.dueDate < today) {
                    overdue += total - paid;
                }
            }
        });

        const curr = settings.currency || 'USD';
        $('#stat-revenue').textContent = InvoyPDF.formatMoney(totalRevenue, curr);
        $('#stat-outstanding').textContent = InvoyPDF.formatMoney(outstanding, curr);
        $('#stat-overdue').textContent = InvoyPDF.formatMoney(overdue, curr);
        $('#stat-count').textContent = invoices.length;

        // Filter
        const statusFilter = $('#filter-status').value;
        const filtered = statusFilter === 'all' ? invoices : invoices.filter(i => i.status === statusFilter);

        // Render list
        const listEl = $('#invoice-list');
        const emptyEl = $('#dashboard-empty');

        if (filtered.length === 0) {
            emptyEl.style.display = 'flex';
            // Remove any previous items
            listEl.querySelectorAll('.invoice-list-item').forEach(el => el.remove());
            return;
        }

        emptyEl.style.display = 'none';
        const fragment = document.createDocumentFragment();

        filtered.forEach(inv => {
            const total = computeTotal(inv);
            const invCurr = inv.currency || curr;
            const el = document.createElement('div');
            el.className = 'invoice-list-item';
            el.innerHTML = `
                <span class="inv-list-number">${escapeHtml(inv.number)}</span>
                <span class="inv-list-client">${escapeHtml(inv.toName || 'No client')}</span>
                <span class="inv-list-date">${InvoyPDF.formatDate(inv.date)}</span>
                <span class="status-badge status-${inv.status}">${inv.status}</span>
                <span class="inv-list-amount">${InvoyPDF.formatMoney(total, invCurr)}</span>
            `;
            el.addEventListener('click', (e) => {
                if (e.target.closest('.inv-list-actions')) return;
                location.hash = `#edit/${inv.id}`;
            });
            fragment.appendChild(el);
        });

        // Clear previous items but keep empty state
        listEl.querySelectorAll('.invoice-list-item').forEach(el => el.remove());
        listEl.appendChild(fragment);
    }

    function computeTotal(inv) {
        const items = inv.items || [];
        const subtotal = items.reduce((s, item) => s + ((parseFloat(item.quantity) || 0) * (parseFloat(item.rate) || 0)), 0);
        let discount = 0;
        if (inv.discountType === 'percentage') {
            discount = subtotal * ((parseFloat(inv.discount) || 0) / 100);
        } else {
            discount = parseFloat(inv.discount) || 0;
        }
        const afterDiscount = subtotal - discount;
        const tax = afterDiscount * ((parseFloat(inv.taxRate) || 0) / 100);
        return afterDiscount + tax;
    }

    // ==================== INVOICE EDITOR ====================
    async function initNewInvoice() {
        editingInvoiceId = null;
        $('#editor-title').textContent = 'New Invoice';
        await loadSettings();

        const prefix = settings.prefix || 'INV';
        const nextNum = parseInt(settings.nextNum) || 1;
        const number = `${prefix}-${String(nextNum).padStart(3, '0')}`;
        const dueDays = parseInt(settings.dueDays) || 30;

        // Populate form
        $('#inv-number').value = number;
        $('#inv-status').value = 'draft';
        $('#inv-date').value = todayStr();
        $('#inv-due-date').value = addDays(todayStr(), dueDays);
        $('#inv-currency').value = settings.currency || 'USD';
        $('#inv-from-name').value = settings.businessName || '';
        $('#inv-from-email').value = settings.email || '';
        $('#inv-from-address').value = settings.address || '';
        $('#inv-from-phone').value = settings.phone || '';
        $('#inv-to-name').value = '';
        $('#inv-to-email').value = '';
        $('#inv-to-address').value = '';
        $('#inv-discount').value = '0';
        $('#inv-discount-type').value = 'percentage';
        $('#inv-tax').value = settings.taxRate || '0';
        $('#inv-paid').value = '0';
        $('#inv-notes').value = settings.defaultNotes || '';
        $('#inv-terms').value = settings.defaultTerms || '';

        // Auto-fill logo from settings
        const logoPreview = $('#logo-preview');
        if (settings.logo) {
            logoPreview.innerHTML = `<img src="${settings.logo}" alt="Logo">`;
        } else {
            logoPreview.innerHTML = `
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span>Click to upload logo</span>
            `;
        }

        // Clear line items and add one empty row
        $('#line-items').innerHTML = '';
        lineItemCounter = 0;
        addLineItem();

        initSortable();
        updateTotals();
        updatePreview();
    }

    async function initEditInvoice(id) {
        if (!id) { location.hash = '#dashboard'; return; }

        const inv = await InvoyDB.getInvoice(id);
        if (!inv) { showToast('Invoice not found', 'error'); location.hash = '#dashboard'; return; }

        editingInvoiceId = id;
        $('#editor-title').textContent = `Edit ${inv.number}`;

        $('#inv-number').value = inv.number || '';
        $('#inv-status').value = inv.status || 'draft';
        $('#inv-date').value = formatDateForInput(inv.date) || '';
        $('#inv-due-date').value = formatDateForInput(inv.dueDate) || '';
        $('#inv-currency').value = inv.currency || 'USD';
        $('#inv-from-name').value = inv.fromName || '';
        $('#inv-from-email').value = inv.fromEmail || '';
        $('#inv-from-address').value = inv.fromAddress || '';
        $('#inv-from-phone').value = inv.fromPhone || '';
        $('#inv-to-name').value = inv.toName || '';
        $('#inv-to-email').value = inv.toEmail || '';
        $('#inv-to-address').value = inv.toAddress || '';
        $('#inv-discount').value = inv.discount || '0';
        $('#inv-discount-type').value = inv.discountType || 'percentage';
        $('#inv-tax').value = inv.taxRate || '0';
        $('#inv-paid').value = inv.amountPaid || '0';
        $('#inv-notes').value = inv.notes || '';
        $('#inv-terms').value = inv.terms || '';

        // Logo
        const logoPreview = $('#logo-preview');
        if (inv.logo) {
            logoPreview.innerHTML = `<img src="${inv.logo}" alt="Logo">`;
        } else {
            logoPreview.innerHTML = `
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span>Click to upload logo</span>
            `;
        }

        // Line items
        $('#line-items').innerHTML = '';
        lineItemCounter = 0;
        if (inv.items && inv.items.length > 0) {
            inv.items.forEach(item => addLineItem(item));
        } else {
            addLineItem();
        }

        initSortable();
        updateTotals();
        updatePreview();
    }

    function addLineItem(data = {}) {
        const id = lineItemCounter++;
        const container = $('#line-items');
        const row = document.createElement('div');
        row.className = 'line-item';
        row.dataset.id = id;
        row.innerHTML = `
            <input type="text" class="form-input li-input-desc" placeholder="Description" value="${escapeHtml(data.description || '')}">
            <input type="number" class="form-input li-input-qty" placeholder="1" value="${data.quantity || ''}" min="0" step="0.01">
            <input type="number" class="form-input li-input-rate" placeholder="0.00" value="${data.rate || ''}" min="0" step="0.01">
            <span class="li-amount">${InvoyPDF.formatMoney((parseFloat(data.quantity) || 0) * (parseFloat(data.rate) || 0), $('#inv-currency')?.value || 'USD')}</span>
            <button class="btn-remove" title="Remove item">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        `;

        // Event listeners
        row.querySelector('.li-input-qty').addEventListener('input', () => { updateLineAmount(row); updateTotals(); updatePreview(); });
        row.querySelector('.li-input-rate').addEventListener('input', () => { updateLineAmount(row); updateTotals(); updatePreview(); });
        row.querySelector('.li-input-desc').addEventListener('input', () => updatePreview());
        row.querySelector('.btn-remove').addEventListener('click', () => {
            row.remove();
            updateTotals();
            updatePreview();
        });

        container.appendChild(row);
    }

    function updateLineAmount(row) {
        const qty = parseFloat(row.querySelector('.li-input-qty').value) || 0;
        const rate = parseFloat(row.querySelector('.li-input-rate').value) || 0;
        const curr = $('#inv-currency').value || 'USD';
        row.querySelector('.li-amount').textContent = InvoyPDF.formatMoney(qty * rate, curr);
    }

    function initSortable() {
        if (sortableInstance) sortableInstance.destroy();
        const el = $('#line-items');
        if (el && typeof Sortable !== 'undefined') {
            sortableInstance = Sortable.create(el, {
                animation: 150,
                ghostClass: 'sortable-ghost',
                onEnd: () => updatePreview()
            });
        }
    }

    function updateTotals() {
        const curr = $('#inv-currency').value || 'USD';
        const items = getLineItems();
        const subtotal = items.reduce((s, item) => s + ((parseFloat(item.quantity) || 0) * (parseFloat(item.rate) || 0)), 0);

        let discountAmount = 0;
        const discountVal = parseFloat($('#inv-discount').value) || 0;
        const discountType = $('#inv-discount-type').value;
        if (discountType === 'percentage') {
            discountAmount = subtotal * (discountVal / 100);
        } else {
            discountAmount = discountVal;
        }

        const afterDiscount = subtotal - discountAmount;
        const taxRate = parseFloat($('#inv-tax').value) || 0;
        const taxAmount = afterDiscount * (taxRate / 100);
        const total = afterDiscount + taxAmount;
        const paid = parseFloat($('#inv-paid').value) || 0;
        const balance = total - paid;

        $('#inv-subtotal').textContent = InvoyPDF.formatMoney(subtotal, curr);
        $('#inv-discount-display').textContent = '-' + InvoyPDF.formatMoney(discountAmount, curr);
        $('#inv-tax-display').textContent = InvoyPDF.formatMoney(taxAmount, curr);
        $('#inv-total').textContent = InvoyPDF.formatMoney(total, curr);
        $('#inv-paid-display').textContent = InvoyPDF.formatMoney(paid, curr);
        $('#inv-balance').textContent = InvoyPDF.formatMoney(balance, curr);
    }

    function getLineItems() {
        const rows = $$('#line-items .line-item');
        return Array.from(rows).map(row => ({
            description: row.querySelector('.li-input-desc').value,
            quantity: row.querySelector('.li-input-qty').value,
            rate: row.querySelector('.li-input-rate').value
        }));
    }

    function getInvoiceFromForm() {
        return {
            id: editingInvoiceId || uuid(),
            number: $('#inv-number').value,
            status: $('#inv-status').value,
            date: $('#inv-date').value,
            dueDate: $('#inv-due-date').value,
            currency: $('#inv-currency').value,
            fromName: $('#inv-from-name').value,
            fromEmail: $('#inv-from-email').value,
            fromAddress: $('#inv-from-address').value,
            fromPhone: $('#inv-from-phone').value,
            logo: getLogoData(),
            toName: $('#inv-to-name').value,
            toEmail: $('#inv-to-email').value,
            toAddress: $('#inv-to-address').value,
            clientId: '',
            items: getLineItems(),
            discount: $('#inv-discount').value,
            discountType: $('#inv-discount-type').value,
            taxRate: $('#inv-tax').value,
            amountPaid: $('#inv-paid').value,
            notes: $('#inv-notes').value,
            terms: $('#inv-terms').value,
            // Settings-derived fields
            brandColor: settings.brandColor || '#6C5CE7',
            website: settings.website || '',
            taxId: settings.taxId || '',
            regNumber: settings.regNumber || '',
            footerText: settings.footerText || '',
            paymentInstructions: settings.paymentInstructions || ''
        };
    }

    function getLogoData() {
        const img = $('#logo-preview img');
        return img ? img.src : null;
    }

    // Live Preview
    function updatePreview() {
        const inv = getInvoiceFromForm();
        const curr = inv.currency || 'USD';
        const items = inv.items || [];
        const subtotal = items.reduce((s, item) => s + ((parseFloat(item.quantity) || 0) * (parseFloat(item.rate) || 0)), 0);

        let discountAmount = 0;
        if (inv.discountType === 'percentage') {
            discountAmount = subtotal * ((parseFloat(inv.discount) || 0) / 100);
        } else {
            discountAmount = parseFloat(inv.discount) || 0;
        }
        const afterDiscount = subtotal - discountAmount;
        const taxAmount = afterDiscount * ((parseFloat(inv.taxRate) || 0) / 100);
        const total = afterDiscount + taxAmount;
        const paid = parseFloat(inv.amountPaid) || 0;
        const balance = total - paid;

        let itemsHtml = '';
        items.forEach(item => {
            const qty = parseFloat(item.quantity) || 0;
            const rate = parseFloat(item.rate) || 0;
            if (item.description || qty || rate) {
                itemsHtml += `<tr>
                    <td>${escapeHtml(item.description)}</td>
                    <td class="td-qty">${qty}</td>
                    <td class="td-rate">${InvoyPDF.formatMoney(rate, curr)}</td>
                    <td>${InvoyPDF.formatMoney(qty * rate, curr)}</td>
                </tr>`;
            }
        });

        const logoHtml = inv.logo
            ? `<div class="inv-p-logo"><img src="${inv.logo}" alt="Logo"></div>`
            : `<div class="inv-p-logo" style="font-size:16px;font-weight:700;color:#1a1a2e">${escapeHtml(inv.fromName)}</div>`;

        let totalsHtml = `<div class="inv-p-totals-row"><span>Subtotal</span><span>${InvoyPDF.formatMoney(subtotal, curr)}</span></div>`;
        if (discountAmount > 0) {
            const dLabel = inv.discountType === 'percentage' ? `Discount (${inv.discount}%)` : 'Discount';
            totalsHtml += `<div class="inv-p-totals-row"><span>${dLabel}</span><span>-${InvoyPDF.formatMoney(discountAmount, curr)}</span></div>`;
        }
        if (parseFloat(inv.taxRate) > 0) {
            totalsHtml += `<div class="inv-p-totals-row"><span>Tax (${inv.taxRate}%)</span><span>${InvoyPDF.formatMoney(taxAmount, curr)}</span></div>`;
        }
        const previewBrandColor = (settings.brandColor || '#6C5CE7');
        totalsHtml += `<div class="inv-p-totals-row inv-p-totals-total" style="border-top-color:${previewBrandColor}"><span>Total</span><span>${InvoyPDF.formatMoney(total, curr)}</span></div>`;
        if (paid > 0) {
            totalsHtml += `<div class="inv-p-totals-row"><span>Amount Paid</span><span>${InvoyPDF.formatMoney(paid, curr)}</span></div>`;
        }
        totalsHtml += `<div class="inv-p-totals-row inv-p-totals-due" style="color:${previewBrandColor}"><span>Balance Due</span><span>${InvoyPDF.formatMoney(balance, curr)}</span></div>`;

        let notesHtml = '';
        if (inv.notes) {
            notesHtml += `<div class="inv-p-notes"><h4>Notes</h4><p>${escapeHtml(inv.notes)}</p></div>`;
        }
        if (inv.terms) {
            notesHtml += `<div class="inv-p-notes"><h4>Terms & Conditions</h4><p>${escapeHtml(inv.terms)}</p></div>`;
        }

        const brandColor = inv.brandColor || '#6C5CE7';

        // Extra from-info lines
        let fromExtra = '';
        if (inv.website) fromExtra += `<p>${escapeHtml(inv.website)}</p>`;
        if (inv.taxId) fromExtra += `<p style="font-size:10px;color:#888">Tax ID: ${escapeHtml(inv.taxId)}</p>`;
        if (inv.regNumber) fromExtra += `<p style="font-size:10px;color:#888">Reg #: ${escapeHtml(inv.regNumber)}</p>`;

        // Payment instructions
        let paymentHtml = '';
        if (inv.paymentInstructions) {
            paymentHtml = `<div class="inv-p-notes"><h4>Payment Instructions</h4><p>${escapeHtml(inv.paymentInstructions)}</p></div>`;
        }

        // Footer text
        const footerText = inv.footerText
            ? escapeHtml(inv.footerText)
            : 'Created with Invoy &mdash; Free Invoice Generator';

        $('#invoice-preview').innerHTML = `
            <div class="inv-p-header">
                ${logoHtml}
                <div>
                    <div class="inv-p-title" style="color:${brandColor}">INVOICE</div>
                    <div class="inv-p-number">${escapeHtml(inv.number)}</div>
                </div>
            </div>
            <div class="inv-p-parties">
                <div class="inv-p-party">
                    <h4>From</h4>
                    <p class="party-name">${escapeHtml(inv.fromName)}</p>
                    <p>${escapeHtml(inv.fromEmail)}</p>
                    <p>${escapeHtml(inv.fromAddress)}</p>
                    <p>${escapeHtml(inv.fromPhone)}</p>
                    ${fromExtra}
                </div>
                <div class="inv-p-party" style="text-align:right">
                    <h4>Bill To</h4>
                    <p class="party-name">${escapeHtml(inv.toName)}</p>
                    <p>${escapeHtml(inv.toEmail)}</p>
                    <p>${escapeHtml(inv.toAddress)}</p>
                </div>
            </div>
            <div class="inv-p-meta">
                <div class="inv-p-meta-item"><label>Issue Date</label><span>${InvoyPDF.formatDate(inv.date)}</span></div>
                <div class="inv-p-meta-item"><label>Due Date</label><span>${InvoyPDF.formatDate(inv.dueDate)}</span></div>
                <div class="inv-p-meta-item"><label>Status</label><span>${(inv.status || 'draft').toUpperCase()}</span></div>
            </div>
            <table class="inv-p-table">
                <thead><tr>
                    <th>Description</th>
                    <th class="th-qty">Qty</th>
                    <th class="th-rate">Rate</th>
                    <th style="text-align:right">Amount</th>
                </tr></thead>
                <tbody>${itemsHtml || '<tr><td colspan="4" style="text-align:center;color:#ccc;padding:20px">Add line items to see them here</td></tr>'}</tbody>
            </table>
            <div class="inv-p-totals">${totalsHtml}</div>
            ${paymentHtml}
            ${notesHtml}
            <div class="inv-p-footer">
                <a>${footerText}</a>
            </div>
        `;
    }

    async function saveInvoice() {
        const inv = getInvoiceFromForm();
        await InvoyDB.saveInvoice(inv);

        // Update next invoice number if this is a new invoice
        if (!editingInvoiceId) {
            const prefix = settings.prefix || 'INV';
            const currentNum = parseInt(inv.number.replace(prefix + '-', '')) || 0;
            await InvoyDB.setSetting('nextNum', currentNum + 1);
            settings.nextNum = currentNum + 1;
        }

        editingInvoiceId = inv.id;

        // Auto-save client if new
        if (inv.toName && inv.toEmail) {
            const clients = await InvoyDB.getAllClients();
            const existing = clients.find(c => c.email === inv.toEmail);
            if (!existing) {
                await InvoyDB.saveClient({
                    id: uuid(),
                    name: inv.toName,
                    email: inv.toEmail,
                    address: inv.toAddress,
                    phone: ''
                });
            }
        }

        showToast('Invoice saved', 'success');
    }

    // ==================== CLIENTS ====================
    async function loadClients() {
        const clients = await InvoyDB.getAllClients();
        clients.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        const listEl = $('#client-list');
        const emptyEl = $('#clients-empty');

        if (clients.length === 0) {
            emptyEl.style.display = 'flex';
            listEl.querySelectorAll('.client-list-item').forEach(el => el.remove());
            return;
        }

        emptyEl.style.display = 'none';
        const fragment = document.createDocumentFragment();

        clients.forEach(client => {
            const el = document.createElement('div');
            el.className = 'client-list-item';
            el.innerHTML = `
                <div class="client-info">
                    <div class="client-name">${escapeHtml(client.name)}</div>
                    <div class="client-email">${escapeHtml(client.email)}</div>
                </div>
                <span style="font-size:0.82rem;color:var(--color-text-muted)">${escapeHtml(client.address || '')}</span>
                <div class="client-actions">
                    <button class="btn btn-ghost btn-xs btn-edit-client" data-id="${client.id}" title="Edit">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                    </button>
                    <button class="btn btn-danger btn-xs btn-delete-client" data-id="${client.id}" title="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            `;
            fragment.appendChild(el);
        });

        listEl.querySelectorAll('.client-list-item').forEach(el => el.remove());
        listEl.appendChild(fragment);
    }

    function openEditClientModal(client = null) {
        $('#edit-client-id').value = client ? client.id : '';
        $('#edit-client-name').value = client ? client.name : '';
        $('#edit-client-email').value = client ? client.email : '';
        $('#edit-client-address').value = client ? client.address : '';
        $('#edit-client-phone').value = client ? client.phone : '';
        $('#edit-client-title').textContent = client ? 'Edit Client' : 'Add Client';
        openModal('edit-client-overlay');
    }

    async function saveClientFromModal() {
        const id = $('#edit-client-id').value || uuid();
        const client = {
            id,
            name: $('#edit-client-name').value,
            email: $('#edit-client-email').value,
            address: $('#edit-client-address').value,
            phone: $('#edit-client-phone').value
        };

        if (!client.name) { showToast('Client name is required', 'error'); return; }

        await InvoyDB.saveClient(client);
        closeModal('edit-client-overlay');
        showToast('Client saved', 'success');
        loadClients();
    }

    async function openClientSelector() {
        const clients = await InvoyDB.getAllClients();
        const listEl = $('#client-select-list');
        listEl.innerHTML = '';

        if (clients.length === 0) {
            listEl.innerHTML = '<p style="color:var(--color-text-muted);padding:16px;text-align:center">No clients saved yet. Create an invoice to auto-save clients.</p>';
        } else {
            clients.forEach(client => {
                const el = document.createElement('div');
                el.className = 'client-select-item';
                el.innerHTML = `
                    <div class="client-name">${escapeHtml(client.name)}</div>
                    <div class="client-email">${escapeHtml(client.email)}</div>
                `;
                el.addEventListener('click', () => {
                    $('#inv-to-name').value = client.name || '';
                    $('#inv-to-email').value = client.email || '';
                    $('#inv-to-address').value = client.address || '';
                    closeModal('client-modal-overlay');
                    updatePreview();
                });
                listEl.appendChild(el);
            });
        }

        openModal('client-modal-overlay');
    }

    // ==================== SETTINGS ====================
    async function loadSettings() {
        settings = await InvoyDB.getSettings();

        if ($('#set-name')) {
            $('#set-name').value = settings.businessName || '';
            $('#set-email').value = settings.email || '';
            $('#set-address').value = settings.address || '';
            $('#set-phone').value = settings.phone || '';
            $('#set-website').value = settings.website || '';
            $('#set-tax-id').value = settings.taxId || '';
            $('#set-reg-number').value = settings.regNumber || '';
            $('#set-prefix').value = settings.prefix || 'INV';
            $('#set-next-num').value = settings.nextNum || 1;
            $('#set-currency').value = settings.currency || 'USD';
            $('#set-tax').value = settings.taxRate || 0;
            $('#set-due-days').value = settings.dueDays || 30;
            $('#set-notes').value = settings.defaultNotes || '';
            $('#set-terms').value = settings.defaultTerms || '';
            $('#set-brand-color').value = settings.brandColor || '#6C5CE7';
            $('#set-brand-color-hex').value = settings.brandColor || '#6C5CE7';
            $('#set-footer-text').value = settings.footerText || '';
            $('#set-payment-instructions').value = settings.paymentInstructions || '';

            // Logo preview
            renderSettingsLogo(settings.logo);

            // Highlight active color swatch
            updateColorSwatches(settings.brandColor || '#6C5CE7');
        }
    }

    function renderSettingsLogo(logoData) {
        const preview = $('#settings-logo-preview');
        const removeBtn = $('#btn-remove-logo');
        if (logoData) {
            preview.innerHTML = `<img src="${logoData}" alt="Company Logo">`;
            removeBtn.style.display = 'inline-flex';
        } else {
            preview.innerHTML = `
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span>Click to upload your company logo</span>
                <span class="upload-hint">Recommended: PNG or SVG, max 500KB</span>
            `;
            removeBtn.style.display = 'none';
        }
    }

    function updateColorSwatches(color) {
        $$('.color-swatch').forEach(s => {
            s.classList.toggle('active', s.dataset.color.toLowerCase() === color.toLowerCase());
        });
    }

    async function saveSettings() {
        const settingsMap = {
            businessName: $('#set-name').value,
            email: $('#set-email').value,
            address: $('#set-address').value,
            phone: $('#set-phone').value,
            website: $('#set-website').value,
            taxId: $('#set-tax-id').value,
            regNumber: $('#set-reg-number').value,
            prefix: $('#set-prefix').value,
            nextNum: parseInt($('#set-next-num').value) || 1,
            currency: $('#set-currency').value,
            taxRate: parseFloat($('#set-tax').value) || 0,
            dueDays: parseInt($('#set-due-days').value) || 30,
            defaultNotes: $('#set-notes').value,
            defaultTerms: $('#set-terms').value,
            brandColor: $('#set-brand-color').value,
            footerText: $('#set-footer-text').value,
            paymentInstructions: $('#set-payment-instructions').value,
            logo: settings.logo || null
        };

        for (const [key, value] of Object.entries(settingsMap)) {
            await InvoyDB.setSetting(key, value);
        }

        settings = settingsMap;
        showToast('Settings saved', 'success');
    }

    // ==================== BACKUP / RESTORE ====================
    async function backupData() {
        const data = await InvoyDB.exportAll();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `invoy-backup-${todayStr()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Backup downloaded', 'success');
    }

    async function restoreData(file) {
        const text = await file.text();
        const data = JSON.parse(text);
        await InvoyDB.importAll(data);
        showToast('Data restored successfully', 'success');
        navigate();
    }

    // ==================== EVENT BINDINGS ====================
    function bindEvents() {
        // Router
        window.addEventListener('hashchange', navigate);

        // Mobile hamburger
        $('#hamburger').addEventListener('click', () => {
            $('#sidebar').classList.toggle('open');
        });

        // Close modals
        $$('[data-close-modal]').forEach(btn => {
            btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
        });

        // Close modals on overlay click
        $$('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) overlay.classList.remove('active');
            });
        });

        // Dashboard filter
        $('#filter-status').addEventListener('change', loadDashboard);

        // Editor: Add line item
        $('#btn-add-item').addEventListener('click', () => {
            addLineItem();
            initSortable();
        });

        // Editor: Save
        $('#btn-save-draft').addEventListener('click', saveInvoice);

        // Editor: Download PDF
        $('#btn-download-pdf').addEventListener('click', () => {
            const inv = getInvoiceFromForm();
            InvoyPDF.download(inv);
        });

        // Editor: Preview PDF
        $('#btn-preview-pdf').addEventListener('click', () => {
            const inv = getInvoiceFromForm();
            InvoyPDF.preview(inv);
        });

        // Editor: Live update on input changes
        const editorForm = $('#editor-form');
        editorForm.addEventListener('input', (e) => {
            if (e.target.closest('#line-items')) return; // Handled individually
            updateTotals();
            updatePreview();
        });

        editorForm.addEventListener('change', (e) => {
            updateTotals();
            updatePreview();
        });

        // Editor: Logo upload
        $('#logo-upload').addEventListener('click', () => {
            $('#logo-input').click();
        });

        $('#logo-input').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (file.size > 500 * 1024) {
                showToast('Logo must be under 500KB', 'error');
                return;
            }

            const reader = new FileReader();
            reader.onload = (ev) => {
                $('#logo-preview').innerHTML = `<img src="${ev.target.result}" alt="Logo">`;
                updatePreview();
            };
            reader.readAsDataURL(file);
        });

        // Editor: Select client
        $('#btn-select-client').addEventListener('click', openClientSelector);

        // Clients: Add
        $('#btn-add-client').addEventListener('click', () => openEditClientModal());

        // Clients: Edit / Delete (delegated)
        $('#client-list').addEventListener('click', async (e) => {
            const editBtn = e.target.closest('.btn-edit-client');
            const deleteBtn = e.target.closest('.btn-delete-client');

            if (editBtn) {
                const client = await InvoyDB.getClient(editBtn.dataset.id);
                if (client) openEditClientModal(client);
            }

            if (deleteBtn) {
                if (confirm('Delete this client?')) {
                    await InvoyDB.deleteClient(deleteBtn.dataset.id);
                    showToast('Client deleted', 'success');
                    loadClients();
                }
            }
        });

        // Client modal: Save
        $('#btn-save-client').addEventListener('click', saveClientFromModal);

        // Settings: Save
        $('#btn-save-settings').addEventListener('click', saveSettings);

        // Settings: Logo upload
        $('#settings-logo-upload').addEventListener('click', () => {
            $('#set-logo-input').click();
        });

        $('#set-logo-input').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > 500 * 1024) {
                showToast('Logo must be under 500KB', 'error');
                return;
            }
            const reader = new FileReader();
            reader.onload = async (ev) => {
                settings.logo = ev.target.result;
                await InvoyDB.setSetting('logo', settings.logo);
                renderSettingsLogo(settings.logo);
                showToast('Logo uploaded', 'success');
            };
            reader.readAsDataURL(file);
        });

        // Settings: Remove logo
        $('#btn-remove-logo').addEventListener('click', async () => {
            settings.logo = null;
            await InvoyDB.setSetting('logo', null);
            renderSettingsLogo(null);
            showToast('Logo removed', 'success');
        });

        // Settings: Brand color picker sync
        $('#set-brand-color').addEventListener('input', (e) => {
            $('#set-brand-color-hex').value = e.target.value;
            updateColorSwatches(e.target.value);
        });

        $('#set-brand-color-hex').addEventListener('input', (e) => {
            const val = e.target.value;
            if (/^#[0-9a-fA-F]{6}$/.test(val)) {
                $('#set-brand-color').value = val;
                updateColorSwatches(val);
            }
        });

        // Settings: Color preset swatches
        $('#color-presets').addEventListener('click', (e) => {
            const swatch = e.target.closest('.color-swatch');
            if (!swatch) return;
            const color = swatch.dataset.color;
            $('#set-brand-color').value = color;
            $('#set-brand-color-hex').value = color;
            updateColorSwatches(color);
        });

        // Backup / Restore
        $('#btn-backup').addEventListener('click', backupData);
        $('#btn-restore').addEventListener('click', () => $('#restore-input').click());
        $('#restore-input').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) restoreData(file);
        });

        // Keyboard shortcut: Cmd/Ctrl + S to save
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                const editorVisible = $('#view-editor').style.display !== 'none';
                if (editorVisible) saveInvoice();
            }
        });
    }

    // ==================== INIT ====================
    async function init() {
        await InvoyDB.open();
        await loadSettings();
        bindEvents();
        navigate();

        // Register service worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js').catch(() => {});
        }
    }

    // Boot
    document.addEventListener('DOMContentLoaded', init);

    return { init };
})();
