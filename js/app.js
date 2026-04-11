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
            'new-estimate': 'view-editor',
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
        const navKey = (viewKey === 'edit' || viewKey === 'new-estimate') ? 'editor' : (viewKey === 'new' ? 'editor' : viewKey);
        const activeLink = $(`.nav-link[data-view="${navKey}"]`);
        if (activeLink) activeLink.classList.add('active');

        // Close mobile sidebar
        $('#sidebar').classList.remove('open');

        // View-specific init
        if (viewKey === 'dashboard') loadDashboard();
        else if (viewKey === 'new') initNewInvoice('invoice');
        else if (viewKey === 'new-estimate') initNewInvoice('estimate');
        else if (viewKey === 'edit') initEditInvoice(hash.split('/')[1]);
        else if (viewKey === 'clients') loadClients();
        else if (viewKey === 'settings') loadSettings();
    }

    // ==================== DASHBOARD ====================
    let _allDocs = [];

    async function loadDashboard() {
        const all = await InvoyDB.getAllInvoices();
        _allDocs = all;

        // Stats (only invoices, not estimates)
        const invoices = all.filter(i => (i.docType || 'invoice') === 'invoice');
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
        $('#stat-count').textContent = all.length;

        renderRevenueChart(invoices, curr);
        renderDocList();
    }

    function renderDocList() {
        const typeFilter = $('#filter-type')?.value || 'all';
        const statusFilter = $('#filter-status')?.value || 'all';
        const sortBy = $('#sort-by')?.value || 'date-desc';
        const search = ($('#search-input')?.value || '').trim().toLowerCase();

        let filtered = [..._allDocs];

        if (typeFilter !== 'all') {
            filtered = filtered.filter(d => (d.docType || 'invoice') === typeFilter);
        }
        if (statusFilter !== 'all') {
            filtered = filtered.filter(d => d.status === statusFilter);
        }
        if (search) {
            filtered = filtered.filter(d =>
                (d.number || '').toLowerCase().includes(search) ||
                (d.toName || '').toLowerCase().includes(search) ||
                (d.toEmail || '').toLowerCase().includes(search)
            );
        }

        // Sort
        filtered.sort((a, b) => {
            switch (sortBy) {
                case 'date-desc': return new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt);
                case 'date-asc':  return new Date(a.date || a.createdAt) - new Date(b.date || b.createdAt);
                case 'amount-desc': return computeTotal(b) - computeTotal(a);
                case 'amount-asc':  return computeTotal(a) - computeTotal(b);
                case 'client': return (a.toName || '').localeCompare(b.toName || '');
                case 'number': return (a.number || '').localeCompare(b.number || '', undefined, { numeric: true });
                default: return 0;
            }
        });

        const listEl = $('#invoice-list');
        const emptyEl = $('#dashboard-empty');
        listEl.querySelectorAll('.invoice-list-item').forEach(el => el.remove());

        if (filtered.length === 0) {
            emptyEl.style.display = 'flex';
            emptyEl.querySelector('p').textContent = search || typeFilter !== 'all' || statusFilter !== 'all'
                ? 'No documents match your filters.'
                : 'No invoices yet. Create your first one!';
            return;
        }

        emptyEl.style.display = 'none';
        const curr = settings.currency || 'USD';
        const fragment = document.createDocumentFragment();

        filtered.forEach(inv => {
            const total = computeTotal(inv);
            const invCurr = inv.currency || curr;
            const docType = inv.docType || 'invoice';
            const el = document.createElement('div');
            el.className = 'invoice-list-item';
            el.innerHTML = `
                <span class="inv-list-number">
                    <span class="doc-type-badge doc-type-${docType}">${docType === 'estimate' ? 'EST' : 'INV'}</span>
                    ${escapeHtml(inv.number)}
                </span>
                <span class="inv-list-client">${escapeHtml(inv.toName || 'No client')}</span>
                <span class="inv-list-date">${InvoyPDF.formatDate(inv.date)}</span>
                <span class="status-badge status-${inv.status}">${inv.status}</span>
                <span class="inv-list-amount">${InvoyPDF.formatMoney(total, invCurr)}</span>
                <span class="row-actions">
                    <button class="row-action-btn" data-action="duplicate" data-id="${inv.id}" title="Duplicate">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                    <button class="row-action-btn danger" data-action="delete" data-id="${inv.id}" title="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </span>
            `;
            el.addEventListener('click', (e) => {
                if (e.target.closest('.row-actions')) return;
                location.hash = `#edit/${inv.id}`;
            });
            fragment.appendChild(el);
        });

        listEl.appendChild(fragment);
    }

    function renderRevenueChart(invoices, curr) {
        const container = $('#revenue-chart');
        if (!container) return;

        // Build 12 month buckets ending this month
        const now = new Date();
        const buckets = [];
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            buckets.push({
                key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
                label: d.toLocaleDateString('en-US', { month: 'short' }),
                total: 0
            });
        }

        // Fill buckets with paid invoice totals by month
        invoices.forEach(inv => {
            if (inv.status !== 'paid' || !inv.date) return;
            const key = inv.date.substring(0, 7);
            const bucket = buckets.find(b => b.key === key);
            if (bucket) bucket.total += computeTotal(inv);
        });

        const max = Math.max(...buckets.map(b => b.total), 1);
        container.innerHTML = buckets.map(b => {
            const height = Math.max((b.total / max) * 100, 1);
            return `
                <div class="chart-bar-wrap">
                    <div class="bar-value">${InvoyPDF.formatMoney(b.total, curr)}</div>
                    <div class="chart-bar" style="height:${height}%" title="${b.label}: ${InvoyPDF.formatMoney(b.total, curr)}"></div>
                    <div class="bar-label">${b.label}</div>
                </div>
            `;
        }).join('');
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
    let currentDocType = 'invoice';

    async function initNewInvoice(docType = 'invoice') {
        editingInvoiceId = null;
        currentDocType = docType;
        $('#editor-title').textContent = docType === 'estimate' ? 'New Estimate' : 'New Invoice';
        $('#btn-convert').style.display = ['estimate', 'quote', 'proforma'].includes(docType) ? 'inline-flex' : 'none';
        await loadSettings();

        const prefix = docType === 'estimate'
            ? (settings.estPrefix || 'EST')
            : (settings.prefix || 'INV');
        const nextNum = docType === 'estimate'
            ? (parseInt(settings.estNextNum) || 1)
            : (parseInt(settings.nextNum) || 1);
        const number = `${prefix}-${String(nextNum).padStart(3, '0')}`;
        const dueDays = parseInt(settings.dueDays) || 30;

        // Populate form
        $('#inv-doc-type').value = docType;
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
        if (!inv) { showToast('Document not found', 'error'); location.hash = '#dashboard'; return; }

        editingInvoiceId = id;
        currentDocType = inv.docType || 'invoice';
        const docLabel = currentDocType === 'estimate' ? 'Estimate' : 'Invoice';
        $('#editor-title').textContent = `Edit ${docLabel} ${inv.number}`;
        $('#btn-convert').style.display = (currentDocType === 'estimate' || currentDocType === 'quote') ? 'inline-flex' : 'none';

        $('#inv-doc-type').value = currentDocType;
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
            docType: $('#inv-doc-type').value || 'invoice',
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
            headingColor: settings.headingColor || '#1a1a2e',
            bodyColor: settings.bodyColor || '#333333',
            mutedColor: settings.mutedColor || '#999999',
            logoSize: settings.logoSize || 'medium',
            website: settings.website || '',
            taxId: settings.taxId || '',
            regNumber: settings.regNumber || '',
            footerText: settings.footerText || '',
            paymentInstructions: settings.paymentInstructions || '',
            // Document layout customization
            paperSize: settings.paperSize || 'A4',
            dateFormat: settings.dateFormat || 'short',
            fontFamily: settings.fontFamily || 'Roboto',
            headerAlign: settings.headerAlign || 'split',
            docTitle: settings.docTitle || 'INVOICE',
            estTitle: settings.estTitle || 'ESTIMATE',
            accentBar: settings.accentBar || 'none',
            showQty: settings.showQty !== false,
            showRate: settings.showRate !== false,
            showStatus: settings.showStatus !== false,
            showCurrency: settings.showCurrency !== false,
            showDue: settings.showDue !== false,
            showFooter: settings.showFooter !== false
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

        // Theme colors and logo size
        const brandColor = inv.brandColor || '#6C5CE7';
        const headingColor = inv.headingColor || '#1a1a2e';
        const bodyColor = inv.bodyColor || '#333333';
        const mutedColor = inv.mutedColor || '#999999';
        const logoSize = inv.logoSize || 'medium';
        const fontFamily = inv.fontFamily || 'Roboto';
        const headerAlign = inv.headerAlign || 'split';
        const accentBar = inv.accentBar || 'none';
        const showQty = inv.showQty !== false;
        const showRate = inv.showRate !== false;
        const showStatus = inv.showStatus !== false;
        const showCurrency = inv.showCurrency !== false;
        const showDue = inv.showDue !== false;
        const showFooter = inv.showFooter !== false;

        const fontMap = {
            Roboto: 'Inter, sans-serif',
            Helvetica: 'Helvetica, Arial, sans-serif',
            Times: '"Times New Roman", Times, serif',
            Courier: '"Courier New", Courier, monospace'
        };
        const previewFont = fontMap[fontFamily] || fontMap.Roboto;

        const logoSizeMap = {
            small: { max: 60, width: 120 },
            medium: { max: 90, width: 180 },
            large: { max: 130, width: 240 },
            xlarge: { max: 170, width: 300 }
        };
        const logoDims = logoSizeMap[logoSize] || logoSizeMap.medium;

        // Title based on document type
        const docType = inv.docType || 'invoice';
        const isNonInvoice = ['estimate', 'quote', 'proforma'].includes(docType);
        const DOC_TITLES = {
            invoice: inv.docTitle || 'INVOICE',
            quote: 'QUOTE',
            estimate: inv.estTitle || 'ESTIMATE',
            receipt: 'RECEIPT',
            proforma: 'PROFORMA INVOICE',
            'credit-note': 'CREDIT NOTE'
        };
        const titleText = DOC_TITLES[docType] || inv.docTitle || 'INVOICE';

        // Format date based on settings
        const fmtDate = (dateStr) => formatDateCustom(dateStr, inv.dateFormat || 'short');

        // Calculate total columns for the table (based on show/hide)
        let numCols = 2; // description + amount
        if (showQty) numCols++;
        if (showRate) numCols++;

        let itemsHtml = '';
        items.forEach(item => {
            const qty = parseFloat(item.quantity) || 0;
            const rate = parseFloat(item.rate) || 0;
            if (item.description || qty || rate) {
                let row = `<td style="color:${bodyColor}">${escapeHtml(item.description)}</td>`;
                if (showQty) row += `<td class="td-qty" style="color:${bodyColor}">${qty}</td>`;
                if (showRate) row += `<td class="td-rate" style="color:${bodyColor}">${InvoyPDF.formatMoney(rate, curr)}</td>`;
                row += `<td style="color:${bodyColor}">${InvoyPDF.formatMoney(qty * rate, curr)}</td>`;
                itemsHtml += `<tr>${row}</tr>`;
            }
        });

        const logoHtml = inv.logo
            ? `<div class="inv-p-logo"><img src="${inv.logo}" alt="Logo" style="max-height:${logoDims.max}px;max-width:${logoDims.width}px"></div>`
            : `<div class="inv-p-logo" style="font-size:18px;font-weight:700;color:${headingColor}">${escapeHtml(inv.fromName)}</div>`;

        let totalsHtml = `<div class="inv-p-totals-row" style="color:${bodyColor}"><span>Subtotal</span><span>${InvoyPDF.formatMoney(subtotal, curr)}</span></div>`;
        if (discountAmount > 0) {
            const dLabel = inv.discountType === 'percentage' ? `Discount (${inv.discount}%)` : 'Discount';
            totalsHtml += `<div class="inv-p-totals-row" style="color:${bodyColor}"><span>${dLabel}</span><span>-${InvoyPDF.formatMoney(discountAmount, curr)}</span></div>`;
        }
        if (parseFloat(inv.taxRate) > 0) {
            totalsHtml += `<div class="inv-p-totals-row" style="color:${bodyColor}"><span>Tax (${inv.taxRate}%)</span><span>${InvoyPDF.formatMoney(taxAmount, curr)}</span></div>`;
        }
        totalsHtml += `<div class="inv-p-totals-row inv-p-totals-total" style="border-top-color:${brandColor};color:${headingColor}"><span>Total</span><span>${InvoyPDF.formatMoney(total, curr)}</span></div>`;
        if (paid > 0 && !isNonInvoice) {
            totalsHtml += `<div class="inv-p-totals-row" style="color:${bodyColor}"><span>Amount Paid</span><span>${InvoyPDF.formatMoney(paid, curr)}</span></div>`;
        }
        if (!isNonInvoice) {
            totalsHtml += `<div class="inv-p-totals-row inv-p-totals-due" style="color:${brandColor}"><span>Balance Due</span><span>${InvoyPDF.formatMoney(balance, curr)}</span></div>`;
        }

        let notesHtml = '';
        if (inv.notes) {
            notesHtml += `<div class="inv-p-notes"><h4 style="color:${mutedColor}">Notes</h4><p style="color:${bodyColor}">${escapeHtml(inv.notes)}</p></div>`;
        }
        if (inv.terms) {
            notesHtml += `<div class="inv-p-notes"><h4 style="color:${mutedColor}">Terms & Conditions</h4><p style="color:${bodyColor}">${escapeHtml(inv.terms)}</p></div>`;
        }

        // Extra from-info lines
        let fromExtra = '';
        if (inv.website) fromExtra += `<p style="color:${brandColor}">${escapeHtml(inv.website)}</p>`;
        if (inv.taxId) fromExtra += `<p style="font-size:10px;color:${mutedColor}">Tax ID: ${escapeHtml(inv.taxId)}</p>`;
        if (inv.regNumber) fromExtra += `<p style="font-size:10px;color:${mutedColor}">Reg #: ${escapeHtml(inv.regNumber)}</p>`;

        // Payment instructions (only for invoices)
        let paymentHtml = '';
        if (inv.paymentInstructions && !isNonInvoice) {
            paymentHtml = `<div class="inv-p-notes"><h4 style="color:${mutedColor}">Payment Instructions</h4><p style="color:${bodyColor}">${escapeHtml(inv.paymentInstructions)}</p></div>`;
        }

        // Footer text
        const footerText = inv.footerText
            ? escapeHtml(inv.footerText)
            : 'Created with Invoy &mdash; Free Invoice Generator';

        // Header layout
        const titleBlock = `
            <div>
                <div class="inv-p-title" style="color:${brandColor}">${escapeHtml(titleText)}</div>
                <div class="inv-p-number" style="color:${mutedColor}">${escapeHtml(inv.number)}</div>
            </div>
        `;

        let headerHtml = '';
        if (headerAlign === 'center') {
            headerHtml = `
                <div class="inv-p-header" style="flex-direction:column;align-items:center;text-align:center;gap:10px">
                    ${logoHtml}
                    ${titleBlock}
                </div>
            `;
        } else if (headerAlign === 'left') {
            headerHtml = `
                <div class="inv-p-header" style="flex-direction:column;align-items:flex-start;gap:10px">
                    ${logoHtml}
                    <div style="text-align:left">
                        <div class="inv-p-title" style="color:${brandColor}">${escapeHtml(titleText)}</div>
                        <div class="inv-p-number" style="color:${mutedColor}">${escapeHtml(inv.number)}</div>
                    </div>
                </div>
            `;
        } else {
            // split (default)
            headerHtml = `
                <div class="inv-p-header">
                    ${logoHtml}
                    ${titleBlock}
                </div>
            `;
        }

        // Accent bar
        const barTop = (accentBar === 'top' || accentBar === 'both')
            ? `<div style="height:6px;background:${brandColor};margin:-40px -40px 30px"></div>`
            : '';
        const barBottom = (accentBar === 'bottom' || accentBar === 'both')
            ? `<div style="height:6px;background:${brandColor};margin:30px -40px -40px"></div>`
            : '';

        // Meta row with show/hide
        const metaItems = [
            `<div class="inv-p-meta-item"><label style="color:${mutedColor}">Issue Date</label><span style="color:${headingColor}">${fmtDate(inv.date)}</span></div>`
        ];
        if (showDue && !isNonInvoice) metaItems.push(`<div class="inv-p-meta-item"><label style="color:${mutedColor}">Due Date</label><span style="color:${headingColor}">${fmtDate(inv.dueDate)}</span></div>`);
        if (isNonInvoice && inv.dueDate) metaItems.push(`<div class="inv-p-meta-item"><label style="color:${mutedColor}">Valid Until</label><span style="color:${headingColor}">${fmtDate(inv.dueDate)}</span></div>`);
        if (showStatus) metaItems.push(`<div class="inv-p-meta-item"><label style="color:${mutedColor}">Status</label><span style="color:${headingColor}">${(inv.status || 'draft').toUpperCase()}</span></div>`);
        if (showCurrency) metaItems.push(`<div class="inv-p-meta-item"><label style="color:${mutedColor}">Currency</label><span style="color:${headingColor}">${curr}</span></div>`);

        // Table headers with show/hide
        let theadHtml = `<th style="color:${mutedColor}">Description</th>`;
        if (showQty) theadHtml += `<th class="th-qty" style="color:${mutedColor}">Qty</th>`;
        if (showRate) theadHtml += `<th class="th-rate" style="color:${mutedColor}">Rate</th>`;
        theadHtml += `<th style="text-align:right;color:${mutedColor}">Amount</th>`;

        $('#invoice-preview').innerHTML = `
            <div style="font-family:${previewFont}">
                ${barTop}
                ${headerHtml}
                <div class="inv-p-parties">
                    <div class="inv-p-party">
                        <h4 style="color:${mutedColor}">From</h4>
                        <p class="party-name" style="color:${headingColor}">${escapeHtml(inv.fromName)}</p>
                        <p style="color:${bodyColor}">${escapeHtml(inv.fromEmail)}</p>
                        <p style="color:${bodyColor}">${escapeHtml(inv.fromAddress)}</p>
                        <p style="color:${bodyColor}">${escapeHtml(inv.fromPhone)}</p>
                        ${fromExtra}
                    </div>
                    <div class="inv-p-party" style="text-align:right">
                        <h4 style="color:${mutedColor}">${isNonInvoice ? 'Prepared For' : 'Bill To'}</h4>
                        <p class="party-name" style="color:${headingColor}">${escapeHtml(inv.toName)}</p>
                        <p style="color:${bodyColor}">${escapeHtml(inv.toEmail)}</p>
                        <p style="color:${bodyColor}">${escapeHtml(inv.toAddress)}</p>
                    </div>
                </div>
                <div class="inv-p-meta">${metaItems.join('')}</div>
                <table class="inv-p-table">
                    <thead><tr>${theadHtml}</tr></thead>
                    <tbody>${itemsHtml || `<tr><td colspan="${numCols}" style="text-align:center;color:#ccc;padding:20px">Add line items to see them here</td></tr>`}</tbody>
                </table>
                <div class="inv-p-totals">${totalsHtml}</div>
                ${paymentHtml}
                ${notesHtml}
                ${showFooter ? `<div class="inv-p-footer"><a style="color:${mutedColor};opacity:0.7">${footerText}</a></div>` : ''}
                ${barBottom}
            </div>
        `;
    }

    function formatDateCustom(dateStr, format) {
        if (!dateStr) return '';
        const d = new Date(dateStr + 'T00:00:00');
        if (isNaN(d)) return '';
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        switch (format) {
            case 'us': return `${mm}/${dd}/${yyyy}`;
            case 'eu': return `${dd}/${mm}/${yyyy}`;
            case 'iso': return `${yyyy}-${mm}-${dd}`;
            case 'long': return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
            case 'short':
            default: return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        }
    }

    async function saveInvoice(silent = false) {
        const inv = getInvoiceFromForm();
        await InvoyDB.saveInvoice(inv);

        // Update next number if this is a new document
        if (!editingInvoiceId) {
            const isEstimate = inv.docType === 'estimate';
            const prefix = isEstimate ? (settings.estPrefix || 'EST') : (settings.prefix || 'INV');
            const numPart = inv.number.replace(prefix + '-', '').replace(/[^\d]/g, '');
            const currentNum = parseInt(numPart) || 0;
            const key = isEstimate ? 'estNextNum' : 'nextNum';
            await InvoyDB.setSetting(key, currentNum + 1);
            settings[key] = currentNum + 1;
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

        if (!silent) {
            const label = inv.docType === 'estimate' ? 'Estimate' : 'Invoice';
            showToast(`${label} saved`, 'success');
        }
    }

    // ==================== AUTO-SAVE ====================
    let autosaveTimer = null;
    let autosavePending = false;

    function triggerAutoSave() {
        if (!$('#view-editor') || $('#view-editor').style.display === 'none') return;
        const inv = getInvoiceFromForm();
        // Only auto-save if there's meaningful content
        if (!inv.toName && !inv.items?.some(i => i.description || i.rate)) return;

        autosavePending = true;
        setAutosaveStatus('saving');
        clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(async () => {
            await saveInvoice(true);
            autosavePending = false;
            setAutosaveStatus('saved');
        }, 1200);
    }

    function setAutosaveStatus(status) {
        const el = $('#autosave-indicator');
        if (!el) return;
        el.className = 'autosave-indicator ' + status;
        if (status === 'saving') {
            el.innerHTML = '<span class="dot"></span> Saving…';
        } else if (status === 'saved') {
            el.innerHTML = '<span class="dot"></span> Saved';
        } else {
            el.innerHTML = '';
        }
    }

    // ==================== DUPLICATE / DELETE / CONVERT ====================
    async function duplicateInvoice(id) {
        const src = id ? await InvoyDB.getInvoice(id) : getInvoiceFromForm();
        if (!src) return;
        const isEstimate = (src.docType || 'invoice') === 'estimate';
        const prefix = isEstimate ? (settings.estPrefix || 'EST') : (settings.prefix || 'INV');
        const nextNum = isEstimate ? (parseInt(settings.estNextNum) || 1) : (parseInt(settings.nextNum) || 1);
        const copy = {
            ...src,
            id: uuid(),
            number: `${prefix}-${String(nextNum).padStart(3, '0')}`,
            status: 'draft',
            date: todayStr(),
            dueDate: addDays(todayStr(), parseInt(settings.dueDays) || 30),
            amountPaid: 0,
            createdAt: undefined,
            updatedAt: undefined
        };
        await InvoyDB.saveInvoice(copy);
        await InvoyDB.setSetting(isEstimate ? 'estNextNum' : 'nextNum', nextNum + 1);
        settings[isEstimate ? 'estNextNum' : 'nextNum'] = nextNum + 1;
        showToast('Duplicated', 'success');
        location.hash = `#edit/${copy.id}`;
    }

    // Generic confirmation
    let _confirmAction = null;
    function confirmDialog({ title, text, action, confirmLabel = 'Delete' }) {
        $('#confirm-title').textContent = title || 'Are you sure?';
        $('#confirm-text').textContent = text || 'This action cannot be undone.';
        $('#btn-confirm-action').textContent = confirmLabel;
        _confirmAction = action;
        openModal('confirm-overlay');
    }

    async function deleteInvoice(id) {
        confirmDialog({
            title: 'Delete this document?',
            text: 'This will permanently remove the invoice or estimate from your records.',
            confirmLabel: 'Delete',
            action: async () => {
                await InvoyDB.deleteInvoice(id);
                showToast('Deleted', 'success');
                if (editingInvoiceId === id) {
                    editingInvoiceId = null;
                    location.hash = '#dashboard';
                } else {
                    loadDashboard();
                }
            }
        });
    }

    async function convertEstimateToInvoice() {
        if (!editingInvoiceId) return;
        const src = await InvoyDB.getInvoice(editingInvoiceId);
        if (!src || src.docType !== 'estimate') return;

        const prefix = settings.prefix || 'INV';
        const nextNum = parseInt(settings.nextNum) || 1;
        const newInvoice = {
            ...src,
            id: uuid(),
            docType: 'invoice',
            number: `${prefix}-${String(nextNum).padStart(3, '0')}`,
            status: 'draft',
            date: todayStr(),
            dueDate: addDays(todayStr(), parseInt(settings.dueDays) || 30),
            createdAt: undefined,
            updatedAt: undefined
        };
        await InvoyDB.saveInvoice(newInvoice);
        await InvoyDB.setSetting('nextNum', nextNum + 1);
        settings.nextNum = nextNum + 1;

        // Mark estimate as accepted
        src.status = 'accepted';
        await InvoyDB.saveInvoice(src);

        showToast('Converted to invoice', 'success');
        location.hash = `#edit/${newInvoice.id}`;
    }

    // ==================== PRINT ====================
    function printInvoice() {
        const preview = $('#invoice-preview');
        if (!preview) return;

        const printWindow = window.open('', '_blank', 'width=900,height=1100');
        const styles = `
            body { font-family: Inter, sans-serif; background: #fff; color: #1a1a2e; margin: 0; padding: 30px; }
            ${Array.from(document.styleSheets)
                .map(sheet => {
                    try {
                        return Array.from(sheet.cssRules).map(r => r.cssText).join('\n');
                    } catch { return ''; }
                })
                .join('\n')}
            @media print { body { padding: 0; } .invoice-preview { padding: 20px; } }
        `;
        printWindow.document.write(`
            <!DOCTYPE html><html><head><title>Print</title><style>${styles}</style></head>
            <body><div class="invoice-preview">${preview.innerHTML}</div></body></html>
        `);
        printWindow.document.close();
        setTimeout(() => { printWindow.print(); }, 400);
    }

    // ==================== CSV EXPORT ====================
    function csvEscape(val) {
        if (val == null) return '';
        const s = String(val);
        if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
    }

    async function exportCSV() {
        const all = await InvoyDB.getAllInvoices();
        if (all.length === 0) { showToast('No documents to export', 'error'); return; }

        const headers = [
            'Type', 'Number', 'Status', 'Date', 'Due Date', 'Client Name', 'Client Email',
            'Currency', 'Subtotal', 'Discount', 'Tax Rate', 'Tax Amount', 'Total',
            'Amount Paid', 'Balance Due', 'Notes'
        ];
        const rows = [headers];

        all.forEach(inv => {
            const items = inv.items || [];
            const subtotal = items.reduce((s, i) => s + ((parseFloat(i.quantity) || 0) * (parseFloat(i.rate) || 0)), 0);
            let discount = 0;
            if (inv.discountType === 'percentage') discount = subtotal * ((parseFloat(inv.discount) || 0) / 100);
            else discount = parseFloat(inv.discount) || 0;
            const afterDiscount = subtotal - discount;
            const taxAmount = afterDiscount * ((parseFloat(inv.taxRate) || 0) / 100);
            const total = afterDiscount + taxAmount;
            const paid = parseFloat(inv.amountPaid) || 0;
            const balance = total - paid;

            rows.push([
                inv.docType || 'invoice',
                inv.number || '',
                inv.status || '',
                inv.date || '',
                inv.dueDate || '',
                inv.toName || '',
                inv.toEmail || '',
                inv.currency || 'USD',
                subtotal.toFixed(2),
                discount.toFixed(2),
                inv.taxRate || '0',
                taxAmount.toFixed(2),
                total.toFixed(2),
                paid.toFixed(2),
                balance.toFixed(2),
                inv.notes || ''
            ]);
        });

        const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `invoy-export-${todayStr()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showToast(`Exported ${all.length} documents`, 'success');
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
            $('#set-heading-color').value = settings.headingColor || '#1a1a2e';
            $('#set-heading-color-hex').value = settings.headingColor || '#1a1a2e';
            $('#set-body-color').value = settings.bodyColor || '#333333';
            $('#set-body-color-hex').value = settings.bodyColor || '#333333';
            $('#set-muted-color').value = settings.mutedColor || '#999999';
            $('#set-muted-color-hex').value = settings.mutedColor || '#999999';
            $('#set-logo-size').value = settings.logoSize || 'medium';
            $('#set-footer-text').value = settings.footerText || '';
            $('#set-payment-instructions').value = settings.paymentInstructions || '';

            // Document Layout
            if ($('#set-paper-size')) {
                $('#set-paper-size').value = settings.paperSize || 'A4';
                $('#set-date-format').value = settings.dateFormat || 'short';
                $('#set-font-family').value = settings.fontFamily || 'Roboto';
                $('#set-header-align').value = settings.headerAlign || 'split';
                $('#set-doc-title').value = settings.docTitle || 'INVOICE';
                $('#set-est-title').value = settings.estTitle || 'ESTIMATE';
                $('#set-accent-bar').value = settings.accentBar || 'none';
                $('#set-show-qty').checked = settings.showQty !== false;
                $('#set-show-rate').checked = settings.showRate !== false;
                $('#set-show-status').checked = settings.showStatus !== false;
                $('#set-show-currency').checked = settings.showCurrency !== false;
                $('#set-show-due').checked = settings.showDue !== false;
                $('#set-show-footer').checked = settings.showFooter !== false;
            }

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
            headingColor: $('#set-heading-color').value,
            bodyColor: $('#set-body-color').value,
            mutedColor: $('#set-muted-color').value,
            logoSize: $('#set-logo-size').value,
            footerText: $('#set-footer-text').value,
            paymentInstructions: $('#set-payment-instructions').value,
            logo: settings.logo || null,
            // Document Layout
            paperSize: $('#set-paper-size').value,
            dateFormat: $('#set-date-format').value,
            fontFamily: $('#set-font-family').value,
            headerAlign: $('#set-header-align').value,
            docTitle: $('#set-doc-title').value || 'INVOICE',
            estTitle: $('#set-est-title').value || 'ESTIMATE',
            accentBar: $('#set-accent-bar').value,
            showQty: $('#set-show-qty').checked,
            showRate: $('#set-show-rate').checked,
            showStatus: $('#set-show-status').checked,
            showCurrency: $('#set-show-currency').checked,
            showDue: $('#set-show-due').checked,
            showFooter: $('#set-show-footer').checked,
            // Preserve estimate numbering
            estPrefix: settings.estPrefix || 'EST',
            estNextNum: settings.estNextNum || 1
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

        // Dashboard filters + search + sort
        $('#filter-status').addEventListener('change', renderDocList);
        $('#filter-type').addEventListener('change', renderDocList);
        $('#sort-by').addEventListener('change', renderDocList);

        let searchDebounce;
        $('#search-input').addEventListener('input', () => {
            clearTimeout(searchDebounce);
            searchDebounce = setTimeout(renderDocList, 150);
        });

        // Dashboard row actions (delegated)
        $('#invoice-list').addEventListener('click', (e) => {
            const btn = e.target.closest('.row-action-btn');
            if (!btn) return;
            e.stopPropagation();
            const id = btn.dataset.id;
            if (btn.dataset.action === 'duplicate') duplicateInvoice(id);
            else if (btn.dataset.action === 'delete') deleteInvoice(id);
        });

        // Dashboard CSV export
        $('#btn-export-csv').addEventListener('click', exportCSV);

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
            if (e.target.closest('#line-items')) {
                triggerAutoSave();
                return; // totals/preview handled individually
            }
            updateTotals();
            updatePreview();
            triggerAutoSave();
        });

        editorForm.addEventListener('change', (e) => {
            updateTotals();
            updatePreview();
            triggerAutoSave();
        });

        // Editor: Duplicate, Print, Convert
        $('#btn-duplicate').addEventListener('click', async () => {
            if (editingInvoiceId) {
                await saveInvoice(true);
                duplicateInvoice(editingInvoiceId);
            } else {
                await saveInvoice(true);
                duplicateInvoice(editingInvoiceId);
            }
        });

        $('#btn-print').addEventListener('click', printInvoice);
        $('#btn-convert').addEventListener('click', convertEstimateToInvoice);

        // Editor: Doc type change
        $('#inv-doc-type').addEventListener('change', (e) => {
            const type = e.target.value;
            currentDocType = type;
            const nonInvoice = ['estimate', 'quote', 'proforma'].includes(type);
            $('#btn-convert').style.display = nonInvoice ? 'inline-flex' : 'none';
            updatePreview();
            triggerAutoSave();
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

        // Settings: Color picker sync (reusable)
        function bindColorSync(pickerId, hexId, onChange) {
            $(pickerId).addEventListener('input', (e) => {
                $(hexId).value = e.target.value.toUpperCase();
                if (onChange) onChange(e.target.value);
            });
            $(hexId).addEventListener('input', (e) => {
                const val = e.target.value;
                if (/^#[0-9a-fA-F]{6}$/.test(val)) {
                    $(pickerId).value = val;
                    if (onChange) onChange(val);
                }
            });
        }

        bindColorSync('#set-brand-color', '#set-brand-color-hex', updateColorSwatches);
        bindColorSync('#set-heading-color', '#set-heading-color-hex');
        bindColorSync('#set-body-color', '#set-body-color-hex');
        bindColorSync('#set-muted-color', '#set-muted-color-hex');

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

        // Confirm modal action
        $('#btn-confirm-action').addEventListener('click', async () => {
            if (_confirmAction) {
                const fn = _confirmAction;
                _confirmAction = null;
                closeModal('confirm-overlay');
                await fn();
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Don't trigger shortcuts when typing in inputs
            const inInput = e.target.matches('input, textarea, select');

            // Cmd/Ctrl + S = save
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                const editorVisible = $('#view-editor').style.display !== 'none';
                if (editorVisible) saveInvoice();
                return;
            }

            // Escape = close any open modal
            if (e.key === 'Escape') {
                $$('.modal-overlay.active').forEach(m => m.classList.remove('active'));
                return;
            }

            if (inInput) return;

            // N = new invoice (from dashboard)
            if (e.key === 'n' || e.key === 'N') {
                e.preventDefault();
                location.hash = '#new';
                return;
            }

            // E = new estimate
            if (e.key === 'e' || e.key === 'E') {
                e.preventDefault();
                location.hash = '#new-estimate';
                return;
            }

            // / = focus search (on dashboard)
            if (e.key === '/') {
                const dashVisible = $('#view-dashboard').style.display !== 'none';
                if (dashVisible && $('#search-input')) {
                    e.preventDefault();
                    $('#search-input').focus();
                }
                return;
            }

            // D = dashboard
            if (e.key === 'd' || e.key === 'D') {
                e.preventDefault();
                location.hash = '#dashboard';
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
