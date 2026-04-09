/* ============================================
   INVOY — PDF Generation (pdfmake)
   ============================================ */

const InvoyPDF = (() => {

    const CURRENCY_SYMBOLS = {
        USD: '$', EUR: '\u20AC', GBP: '\u00A3', CAD: 'C$', AUD: 'A$',
        JPY: '\u00A5', INR: '\u20B9', BRL: 'R$', CHF: 'Fr', SEK: 'kr',
        NZD: 'NZ$', MXN: 'MX$', NGN: '\u20A6', ZAR: 'R'
    };

    function getCurrencySymbol(code) {
        return CURRENCY_SYMBOLS[code] || code + ' ';
    }

    // Blend a hex color with white for a soft tint (0 = white, 1 = full color)
    function tintColor(hex, amount) {
        const clean = hex.replace('#', '');
        if (clean.length !== 6) return '#f8f8fc';
        const r = parseInt(clean.substring(0, 2), 16);
        const g = parseInt(clean.substring(2, 4), 16);
        const b = parseInt(clean.substring(4, 6), 16);
        const mix = (c) => Math.round(255 - (255 - c) * amount);
        const toHex = (c) => c.toString(16).padStart(2, '0');
        return '#' + toHex(mix(r)) + toHex(mix(g)) + toHex(mix(b));
    }

    function formatMoney(amount, currency) {
        const sym = getCurrencySymbol(currency);
        const num = parseFloat(amount) || 0;
        if (currency === 'JPY') return sym + Math.round(num).toLocaleString();
        return sym + num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function formatDate(dateStr, format) {
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

    function generateDefinition(invoice) {
        const curr = invoice.currency || 'USD';
        const brandColor = invoice.brandColor || '#6C5CE7';
        const headingColor = invoice.headingColor || '#1a1a2e';
        const bodyColor = invoice.bodyColor || '#333333';
        const mutedColor = invoice.mutedColor || '#999999';
        const logoSize = invoice.logoSize || 'medium';
        const paperSize = invoice.paperSize || 'A4';
        const dateFormat = invoice.dateFormat || 'short';
        const fontFamily = invoice.fontFamily || 'Roboto';
        const headerAlign = invoice.headerAlign || 'split';
        const accentBar = invoice.accentBar || 'none';
        const showQty = invoice.showQty !== false;
        const showRate = invoice.showRate !== false;
        const showStatus = invoice.showStatus !== false;
        const showCurrency = invoice.showCurrency !== false;
        const showDue = invoice.showDue !== false;
        const showFooter = invoice.showFooter !== false;

        const isEstimate = invoice.docType === 'estimate';
        const titleText = isEstimate
            ? (invoice.estTitle || 'ESTIMATE')
            : (invoice.docTitle || 'INVOICE');

        const fmtD = (s) => formatDate(s, dateFormat);

        const LOGO_DIMS = {
            small:  { width: 130, fit: [130, 60] },
            medium: { width: 180, fit: [180, 90] },
            large:  { width: 240, fit: [240, 130] },
            xlarge: { width: 300, fit: [300, 170] }
        };
        const logoDims = LOGO_DIMS[logoSize] || LOGO_DIMS.medium;

        const items = invoice.items || [];
        const subtotal = items.reduce((sum, item) => sum + ((parseFloat(item.quantity) || 0) * (parseFloat(item.rate) || 0)), 0);

        let discountAmount = 0;
        if (invoice.discountType === 'percentage') {
            discountAmount = subtotal * ((parseFloat(invoice.discount) || 0) / 100);
        } else {
            discountAmount = parseFloat(invoice.discount) || 0;
        }

        const afterDiscount = subtotal - discountAmount;
        const taxAmount = afterDiscount * ((parseFloat(invoice.taxRate) || 0) / 100);
        const total = afterDiscount + taxAmount;
        const amountPaid = parseFloat(invoice.amountPaid) || 0;
        const balanceDue = total - amountPaid;

        // Build line items table body (respecting show/hide)
        const headerRow = [{ text: 'Description', style: 'tableHeader' }];
        if (showQty)  headerRow.push({ text: 'Qty', style: 'tableHeader', alignment: 'center' });
        if (showRate) headerRow.push({ text: 'Rate', style: 'tableHeader', alignment: 'right' });
        headerRow.push({ text: 'Amount', style: 'tableHeader', alignment: 'right' });

        const tableBody = [headerRow];
        const tableWidths = ['*'];
        if (showQty)  tableWidths.push(50);
        if (showRate) tableWidths.push(80);
        tableWidths.push(80);

        items.forEach(item => {
            const qty = parseFloat(item.quantity) || 0;
            const rate = parseFloat(item.rate) || 0;
            const row = [{ text: item.description || '', style: 'tableCell' }];
            if (showQty)  row.push({ text: qty.toString(), style: 'tableCell', alignment: 'center' });
            if (showRate) row.push({ text: formatMoney(rate, curr), style: 'tableCell', alignment: 'right' });
            row.push({ text: formatMoney(qty * rate, curr), style: 'tableCell', alignment: 'right' });
            tableBody.push(row);
        });

        // Build totals
        const totalsBody = [
            [{ text: 'Subtotal', alignment: 'right', color: mutedColor }, { text: formatMoney(subtotal, curr), alignment: 'right', color: bodyColor }]
        ];

        if (discountAmount > 0) {
            const discLabel = invoice.discountType === 'percentage'
                ? `Discount (${invoice.discount}%)`
                : 'Discount';
            totalsBody.push([
                { text: discLabel, alignment: 'right', color: mutedColor },
                { text: '-' + formatMoney(discountAmount, curr), alignment: 'right', color: bodyColor }
            ]);
        }

        if (parseFloat(invoice.taxRate) > 0) {
            totalsBody.push([
                { text: `Tax (${invoice.taxRate}%)`, alignment: 'right', color: mutedColor },
                { text: formatMoney(taxAmount, curr), alignment: 'right', color: bodyColor }
            ]);
        }

        totalsBody.push([
            { text: 'Total', alignment: 'right', bold: true, fontSize: 13, color: headingColor },
            { text: formatMoney(total, curr), alignment: 'right', bold: true, fontSize: 13, color: headingColor }
        ]);

        if (!isEstimate) {
            if (amountPaid > 0) {
                totalsBody.push([
                    { text: 'Amount Paid', alignment: 'right', color: mutedColor },
                    { text: formatMoney(amountPaid, curr), alignment: 'right', color: bodyColor }
                ]);
            }

            totalsBody.push([
                { text: 'Balance Due', alignment: 'right', bold: true, fontSize: 12, color: brandColor },
                { text: formatMoney(balanceDue, curr), alignment: 'right', bold: true, fontSize: 12, color: brandColor }
            ]);
        }

        // Build document content
        const content = [];

        // Accent bar top
        if (accentBar === 'top' || accentBar === 'both') {
            content.push({
                canvas: [{ type: 'rect', x: -40, y: -40, w: 595, h: 8, color: brandColor }],
                margin: [0, 0, 0, 20]
            });
        }

        // Header: Logo + TITLE
        const logoEl = invoice.logo
            ? { image: invoice.logo, width: logoDims.width, fit: logoDims.fit }
            : { text: invoice.fromName || '', style: 'brandName' };

        const titleStack = {
            stack: [
                { text: titleText, style: 'invoiceTitle' },
                { text: invoice.number || '', style: 'invoiceNumber' }
            ]
        };

        if (headerAlign === 'center') {
            content.push({ stack: [logoEl, { ...titleStack, alignment: 'center', margin: [0, 10, 0, 0] }], alignment: 'center', margin: [0, 0, 0, 24] });
        } else if (headerAlign === 'left') {
            content.push({ stack: [logoEl, { ...titleStack, margin: [0, 10, 0, 0] }], margin: [0, 0, 0, 24] });
        } else {
            // split
            content.push({
                columns: [logoEl, { ...titleStack, alignment: 'right' }],
                margin: [0, 0, 0, 24],
                columnGap: 20
            });
        }

        // From / To
        const fromStack = [
            { text: 'FROM', style: 'sectionLabel' },
            { text: invoice.fromName || '', style: 'partyName' },
            { text: invoice.fromEmail || '', style: 'partyDetail' },
            { text: invoice.fromAddress || '', style: 'partyDetail' },
            { text: invoice.fromPhone || '', style: 'partyDetail' }
        ];
        if (invoice.website) fromStack.push({ text: invoice.website, style: 'partyDetail', color: brandColor });
        if (invoice.taxId) fromStack.push({ text: 'Tax ID: ' + invoice.taxId, style: 'partyDetail', fontSize: 9, color: mutedColor });
        if (invoice.regNumber) fromStack.push({ text: 'Reg #: ' + invoice.regNumber, style: 'partyDetail', fontSize: 9, color: mutedColor });

        content.push({
            columns: [
                { stack: fromStack },
                {
                    stack: [
                        { text: isEstimate ? 'PREPARED FOR' : 'BILL TO', style: 'sectionLabel' },
                        { text: invoice.toName || '', style: 'partyName' },
                        { text: invoice.toEmail || '', style: 'partyDetail' },
                        { text: invoice.toAddress || '', style: 'partyDetail' }
                    ]
                }
            ],
            margin: [0, 0, 0, 20]
        });

        // Meta row (respecting show/hide)
        const metaCells = [
            { stack: [{ text: 'Issue Date', style: 'metaLabel' }, { text: fmtD(invoice.date), style: 'metaValue' }] }
        ];
        if (!isEstimate && showDue) {
            metaCells.push({ stack: [{ text: 'Due Date', style: 'metaLabel' }, { text: fmtD(invoice.dueDate), style: 'metaValue' }] });
        }
        if (isEstimate && invoice.dueDate) {
            metaCells.push({ stack: [{ text: 'Valid Until', style: 'metaLabel' }, { text: fmtD(invoice.dueDate), style: 'metaValue' }] });
        }
        if (showStatus) {
            metaCells.push({ stack: [{ text: 'Status', style: 'metaLabel' }, { text: (invoice.status || 'draft').toUpperCase(), style: 'metaValue' }] });
        }
        if (showCurrency) {
            metaCells.push({ stack: [{ text: 'Currency', style: 'metaLabel' }, { text: curr, style: 'metaValue' }] });
        }

        if (metaCells.length > 0) {
            const metaWidths = metaCells.map(() => '*');
            content.push({
                table: { widths: metaWidths, body: [metaCells] },
                layout: {
                    fillColor: () => tintColor(brandColor, 0.08),
                    hLineWidth: () => 0,
                    vLineWidth: () => 0,
                    paddingLeft: () => 10,
                    paddingRight: () => 10,
                    paddingTop: () => 8,
                    paddingBottom: () => 8
                },
                margin: [0, 0, 0, 20]
            });
        }

        // Line Items Table
        content.push({
            table: {
                headerRows: 1,
                widths: tableWidths,
                body: tableBody
            },
            layout: {
                hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length) ? 1 : 0.5,
                vLineWidth: () => 0,
                hLineColor: (i) => i <= 1 ? tintColor(mutedColor, 0.5) : tintColor(mutedColor, 0.2),
                paddingTop: () => 8,
                paddingBottom: () => 8
            },
            margin: [0, 0, 0, 16]
        });

        // Totals
        content.push({
            columns: [
                { width: '*', text: '' },
                {
                    width: 240,
                    table: {
                        widths: ['*', 'auto'],
                        body: totalsBody
                    },
                    layout: {
                        hLineWidth: (i) => {
                            const totalIdx = totalsBody.findIndex(r => r[0].fontSize === 13);
                            return i === totalIdx ? 1 : 0;
                        },
                        vLineWidth: () => 0,
                        hLineColor: () => brandColor,
                        paddingTop: () => 4,
                        paddingBottom: () => 4
                    }
                }
            ],
            margin: [0, 0, 0, 20]
        });

        // Payment Instructions (only for invoices)
        if (invoice.paymentInstructions && !isEstimate) {
            content.push({ text: 'Payment Instructions', style: 'sectionLabel', margin: [0, 10, 0, 4] });
            content.push({ text: invoice.paymentInstructions, style: 'partyDetail', margin: [0, 0, 0, 10] });
        }

        // Notes
        if (invoice.notes) {
            content.push({ text: 'Notes', style: 'sectionLabel', margin: [0, 10, 0, 4] });
            content.push({ text: invoice.notes, style: 'partyDetail', margin: [0, 0, 0, 10] });
        }

        // Terms
        if (invoice.terms) {
            content.push({ text: 'Terms & Conditions', style: 'sectionLabel', margin: [0, 6, 0, 4] });
            content.push({ text: invoice.terms, style: 'partyDetail', margin: [0, 0, 0, 10] });
        }

        // Accent bar bottom
        if (accentBar === 'bottom' || accentBar === 'both') {
            content.push({
                canvas: [{ type: 'rect', x: -40, y: 10, w: 595, h: 8, color: brandColor }],
                margin: [0, 10, 0, 0]
            });
        }

        const footerText = invoice.footerText || 'Created with Invoy \u2014 Free Invoice Generator';

        // pdfmake only ships with Roboto. Other fonts require VFS setup.
        // Fall back to Roboto for unsupported fonts but keep the live preview accurate.
        const usableFont = 'Roboto';

        return {
            content,
            footer: showFooter ? (currentPage, pageCount) => ({
                columns: [
                    { text: `Page ${currentPage} of ${pageCount}`, alignment: 'left', fontSize: 8, color: mutedColor, opacity: 0.7, margin: [40, 0, 0, 0] },
                    { text: footerText, alignment: 'right', fontSize: 8, color: mutedColor, opacity: 0.7, margin: [0, 0, 40, 0] }
                ]
            }) : null,
            styles: {
                invoiceTitle: { fontSize: 28, bold: true, color: brandColor },
                invoiceNumber: { fontSize: 11, color: mutedColor, margin: [0, 2, 0, 0] },
                brandName: { fontSize: 18, bold: true, color: headingColor },
                sectionLabel: { fontSize: 9, bold: true, color: mutedColor, letterSpacing: 0.5 },
                partyName: { fontSize: 12, bold: true, color: headingColor, margin: [0, 4, 0, 2] },
                partyDetail: { fontSize: 10, color: bodyColor, lineHeight: 1.4 },
                metaLabel: { fontSize: 8, color: mutedColor, bold: true },
                metaValue: { fontSize: 11, color: headingColor, bold: true, margin: [0, 2, 0, 0] },
                tableHeader: { fontSize: 8, bold: true, color: mutedColor, margin: [0, 0, 0, 0] },
                tableCell: { fontSize: 10, color: bodyColor }
            },
            defaultStyle: {
                font: usableFont
            },
            pageSize: paperSize,
            pageMargins: [40, 40, 40, 40]
        };
    }

    function download(invoice) {
        const docDef = generateDefinition(invoice);
        const filename = `${(invoice.number || 'invoice').replace(/[^a-zA-Z0-9-]/g, '_')}.pdf`;
        pdfMake.createPdf(docDef).download(filename);
    }

    function preview(invoice) {
        const docDef = generateDefinition(invoice);
        pdfMake.createPdf(docDef).open();
    }

    return { download, preview, formatMoney, formatDate, getCurrencySymbol };
})();
