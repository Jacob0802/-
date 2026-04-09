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

    function formatMoney(amount, currency) {
        const sym = getCurrencySymbol(currency);
        const num = parseFloat(amount) || 0;
        if (currency === 'JPY') return sym + Math.round(num).toLocaleString();
        return sym + num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function generateDefinition(invoice) {
        const curr = invoice.currency || 'USD';
        const brandColor = invoice.brandColor || '#6C5CE7';
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

        // Build line items table body
        const tableBody = [
            [
                { text: 'Description', style: 'tableHeader' },
                { text: 'Qty', style: 'tableHeader', alignment: 'center' },
                { text: 'Rate', style: 'tableHeader', alignment: 'right' },
                { text: 'Amount', style: 'tableHeader', alignment: 'right' }
            ]
        ];

        items.forEach(item => {
            const qty = parseFloat(item.quantity) || 0;
            const rate = parseFloat(item.rate) || 0;
            tableBody.push([
                { text: item.description || '', style: 'tableCell' },
                { text: qty.toString(), style: 'tableCell', alignment: 'center' },
                { text: formatMoney(rate, curr), style: 'tableCell', alignment: 'right' },
                { text: formatMoney(qty * rate, curr), style: 'tableCell', alignment: 'right' }
            ]);
        });

        // Build totals
        const totalsBody = [
            [{ text: 'Subtotal', alignment: 'right', color: '#666' }, { text: formatMoney(subtotal, curr), alignment: 'right' }]
        ];

        if (discountAmount > 0) {
            const discLabel = invoice.discountType === 'percentage'
                ? `Discount (${invoice.discount}%)`
                : 'Discount';
            totalsBody.push([
                { text: discLabel, alignment: 'right', color: '#666' },
                { text: '-' + formatMoney(discountAmount, curr), alignment: 'right' }
            ]);
        }

        if (parseFloat(invoice.taxRate) > 0) {
            totalsBody.push([
                { text: `Tax (${invoice.taxRate}%)`, alignment: 'right', color: '#666' },
                { text: formatMoney(taxAmount, curr), alignment: 'right' }
            ]);
        }

        totalsBody.push([
            { text: 'Total', alignment: 'right', bold: true, fontSize: 13 },
            { text: formatMoney(total, curr), alignment: 'right', bold: true, fontSize: 13 }
        ]);

        if (amountPaid > 0) {
            totalsBody.push([
                { text: 'Amount Paid', alignment: 'right', color: '#666' },
                { text: formatMoney(amountPaid, curr), alignment: 'right' }
            ]);
        }

        totalsBody.push([
            { text: 'Balance Due', alignment: 'right', bold: true, fontSize: 12, color: brandColor },
            { text: formatMoney(balanceDue, curr), alignment: 'right', bold: true, fontSize: 12, color: brandColor }
        ]);

        // Build document content
        const content = [];

        // Header: Logo + INVOICE title
        const headerColumns = [];
        if (invoice.logo) {
            headerColumns.push({ image: invoice.logo, width: 120, fit: [120, 50] });
        } else {
            headerColumns.push({ text: invoice.fromName || '', style: 'brandName' });
        }
        headerColumns.push({
            stack: [
                { text: 'INVOICE', style: 'invoiceTitle' },
                { text: invoice.number || '', style: 'invoiceNumber' }
            ],
            alignment: 'right'
        });

        content.push({ columns: headerColumns, margin: [0, 0, 0, 24] });

        // From / To
        const fromStack = [
            { text: 'FROM', style: 'sectionLabel' },
            { text: invoice.fromName || '', style: 'partyName' },
            { text: invoice.fromEmail || '', style: 'partyDetail' },
            { text: invoice.fromAddress || '', style: 'partyDetail' },
            { text: invoice.fromPhone || '', style: 'partyDetail' }
        ];
        if (invoice.website) fromStack.push({ text: invoice.website, style: 'partyDetail', color: brandColor });
        if (invoice.taxId) fromStack.push({ text: 'Tax ID: ' + invoice.taxId, style: 'partyDetail', fontSize: 9, color: '#888' });
        if (invoice.regNumber) fromStack.push({ text: 'Reg #: ' + invoice.regNumber, style: 'partyDetail', fontSize: 9, color: '#888' });

        content.push({
            columns: [
                { stack: fromStack },
                {
                    stack: [
                        { text: 'BILL TO', style: 'sectionLabel' },
                        { text: invoice.toName || '', style: 'partyName' },
                        { text: invoice.toEmail || '', style: 'partyDetail' },
                        { text: invoice.toAddress || '', style: 'partyDetail' }
                    ]
                }
            ],
            margin: [0, 0, 0, 20]
        });

        // Meta row (dates, status)
        content.push({
            table: {
                widths: ['*', '*', '*', '*'],
                body: [[
                    { stack: [{ text: 'Issue Date', style: 'metaLabel' }, { text: formatDate(invoice.date), style: 'metaValue' }] },
                    { stack: [{ text: 'Due Date', style: 'metaLabel' }, { text: formatDate(invoice.dueDate), style: 'metaValue' }] },
                    { stack: [{ text: 'Status', style: 'metaLabel' }, { text: (invoice.status || 'draft').toUpperCase(), style: 'metaValue' }] },
                    { stack: [{ text: 'Currency', style: 'metaLabel' }, { text: curr, style: 'metaValue' }] }
                ]]
            },
            layout: {
                fillColor: () => '#f8f8fc',
                hLineWidth: () => 0,
                vLineWidth: () => 0,
                paddingLeft: () => 10,
                paddingRight: () => 10,
                paddingTop: () => 8,
                paddingBottom: () => 8
            },
            margin: [0, 0, 0, 20]
        });

        // Line Items Table
        content.push({
            table: {
                headerRows: 1,
                widths: ['*', 50, 80, 80],
                body: tableBody
            },
            layout: {
                hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length) ? 1 : 0.5,
                vLineWidth: () => 0,
                hLineColor: (i) => i <= 1 ? '#ddd' : '#f0f0f0',
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

        // Payment Instructions
        if (invoice.paymentInstructions) {
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

        const footerText = invoice.footerText || 'Created with Invoy \u2014 Free Invoice Generator';

        return {
            content,
            footer: (currentPage, pageCount) => ({
                columns: [
                    { text: `Page ${currentPage} of ${pageCount}`, alignment: 'left', fontSize: 8, color: '#bbb', margin: [40, 0, 0, 0] },
                    { text: footerText, alignment: 'right', fontSize: 8, color: '#bbb', margin: [0, 0, 40, 0] }
                ]
            }),
            styles: {
                invoiceTitle: { fontSize: 28, bold: true, color: brandColor },
                invoiceNumber: { fontSize: 11, color: '#888', margin: [0, 2, 0, 0] },
                brandName: { fontSize: 16, bold: true, color: '#1a1a2e' },
                sectionLabel: { fontSize: 9, bold: true, color: '#999', letterSpacing: 0.5 },
                partyName: { fontSize: 12, bold: true, color: '#1a1a2e', margin: [0, 4, 0, 2] },
                partyDetail: { fontSize: 10, color: '#555', lineHeight: 1.4 },
                metaLabel: { fontSize: 8, color: '#999', bold: true },
                metaValue: { fontSize: 11, color: '#333', bold: true, margin: [0, 2, 0, 0] },
                tableHeader: { fontSize: 8, bold: true, color: '#999', margin: [0, 0, 0, 0] },
                tableCell: { fontSize: 10, color: '#333' }
            },
            defaultStyle: {
                font: 'Roboto'
            },
            pageSize: 'A4',
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
