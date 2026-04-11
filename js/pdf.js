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

    function tintColor(hex, amount) {
        var clean = (hex || '#999999').replace('#', '');
        if (clean.length !== 6) return '#f8f8fc';
        var r = parseInt(clean.substring(0, 2), 16);
        var g = parseInt(clean.substring(2, 4), 16);
        var b = parseInt(clean.substring(4, 6), 16);
        var mix = function(c) { return Math.round(255 - (255 - c) * amount); };
        var toHex = function(c) { return c.toString(16).padStart(2, '0'); };
        return '#' + toHex(mix(r)) + toHex(mix(g)) + toHex(mix(b));
    }

    function formatMoney(amount, currency) {
        var sym = getCurrencySymbol(currency);
        var num = parseFloat(amount) || 0;
        if (currency === 'JPY') return sym + Math.round(num).toLocaleString();
        return sym + num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function formatDate(dateStr, format) {
        if (!dateStr) return '';
        var d = new Date(dateStr + 'T00:00:00');
        if (isNaN(d.getTime())) return '';
        var yyyy = d.getFullYear();
        var mm = String(d.getMonth() + 1).padStart(2, '0');
        var dd = String(d.getDate()).padStart(2, '0');
        switch (format) {
            case 'us': return mm + '/' + dd + '/' + yyyy;
            case 'eu': return dd + '/' + mm + '/' + yyyy;
            case 'iso': return yyyy + '-' + mm + '-' + dd;
            case 'long': return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
            case 'short':
            default: return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        }
    }

    function generateDefinition(invoice) {
        var curr = invoice.currency || 'USD';
        var brandColor = invoice.brandColor || '#6C5CE7';
        var headingColor = invoice.headingColor || '#1a1a2e';
        var bodyColor = invoice.bodyColor || '#333333';
        var mutedColor = invoice.mutedColor || '#999999';
        var logoSize = invoice.logoSize || 'medium';
        var paperSize = invoice.paperSize || 'A4';
        var dateFormat = invoice.dateFormat || 'short';
        var headerAlign = invoice.headerAlign || 'split';
        var accentBar = invoice.accentBar || 'none';
        var showQty = invoice.showQty !== false;
        var showRate = invoice.showRate !== false;
        var showStatus = invoice.showStatus !== false;
        var showCurrency = invoice.showCurrency !== false;
        var showDue = invoice.showDue !== false;
        var showFooter = invoice.showFooter !== false;

        var docType = invoice.docType || 'invoice';
        var isNonInvoice = (docType === 'estimate' || docType === 'quote' || docType === 'proforma');

        var DOC_TITLES = {
            invoice: invoice.docTitle || 'INVOICE',
            quote: 'QUOTE',
            estimate: invoice.estTitle || 'ESTIMATE',
            receipt: 'RECEIPT',
            proforma: 'PROFORMA INVOICE',
            'credit-note': 'CREDIT NOTE'
        };
        var titleText = DOC_TITLES[docType] || 'INVOICE';

        var LOGO_FITS = {
            small:  [130, 60],
            medium: [180, 90],
            large:  [240, 130],
            xlarge: [300, 170]
        };
        var logoFit = LOGO_FITS[logoSize] || LOGO_FITS.medium;

        var items = invoice.items || [];
        var subtotal = 0;
        for (var i = 0; i < items.length; i++) {
            subtotal += (parseFloat(items[i].quantity) || 0) * (parseFloat(items[i].rate) || 0);
        }

        var discountAmount = 0;
        if (invoice.discountType === 'percentage') {
            discountAmount = subtotal * ((parseFloat(invoice.discount) || 0) / 100);
        } else {
            discountAmount = parseFloat(invoice.discount) || 0;
        }

        var afterDiscount = subtotal - discountAmount;
        var taxAmount = afterDiscount * ((parseFloat(invoice.taxRate) || 0) / 100);
        var total = afterDiscount + taxAmount;
        var amountPaid = parseFloat(invoice.amountPaid) || 0;
        var balanceDue = total - amountPaid;

        // --- Line Items Table ---
        var headerRow = [{ text: 'Description', style: 'tableHeader' }];
        if (showQty) headerRow.push({ text: 'Qty', style: 'tableHeader', alignment: 'center' });
        if (showRate) headerRow.push({ text: 'Rate', style: 'tableHeader', alignment: 'right' });
        headerRow.push({ text: 'Amount', style: 'tableHeader', alignment: 'right' });

        var tableBody = [headerRow];
        var tableWidths = ['*'];
        if (showQty) tableWidths.push(50);
        if (showRate) tableWidths.push(80);
        tableWidths.push(80);

        for (var j = 0; j < items.length; j++) {
            var qty = parseFloat(items[j].quantity) || 0;
            var rate = parseFloat(items[j].rate) || 0;
            var row = [{ text: items[j].description || '', style: 'tableCell' }];
            if (showQty) row.push({ text: String(qty), style: 'tableCell', alignment: 'center' });
            if (showRate) row.push({ text: formatMoney(rate, curr), style: 'tableCell', alignment: 'right' });
            row.push({ text: formatMoney(qty * rate, curr), style: 'tableCell', alignment: 'right' });
            tableBody.push(row);
        }

        // --- Totals ---
        var totalsBody = [
            [{ text: 'Subtotal', alignment: 'right', color: mutedColor }, { text: formatMoney(subtotal, curr), alignment: 'right', color: bodyColor }]
        ];

        if (discountAmount > 0) {
            var discLabel = invoice.discountType === 'percentage'
                ? 'Discount (' + invoice.discount + '%)'
                : 'Discount';
            totalsBody.push([
                { text: discLabel, alignment: 'right', color: mutedColor },
                { text: '-' + formatMoney(discountAmount, curr), alignment: 'right', color: bodyColor }
            ]);
        }

        if (parseFloat(invoice.taxRate) > 0) {
            totalsBody.push([
                { text: 'Tax (' + invoice.taxRate + '%)', alignment: 'right', color: mutedColor },
                { text: formatMoney(taxAmount, curr), alignment: 'right', color: bodyColor }
            ]);
        }

        var totalRowIdx = totalsBody.length;
        totalsBody.push([
            { text: 'Total', alignment: 'right', bold: true, fontSize: 13, color: headingColor },
            { text: formatMoney(total, curr), alignment: 'right', bold: true, fontSize: 13, color: headingColor }
        ]);

        if (!isNonInvoice) {
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

        // --- Build content ---
        var content = [];

        // Accent bar top
        if (accentBar === 'top' || accentBar === 'both') {
            content.push({
                canvas: [{ type: 'rect', x: 0, y: 0, w: 515, h: 6, color: brandColor }],
                margin: [0, 0, 0, 16]
            });
        }

        // Header
        var logoEl;
        if (invoice.logo) {
            logoEl = { image: invoice.logo, fit: logoFit };
        } else {
            logoEl = { text: invoice.fromName || '', style: 'brandName' };
        }

        var titleEl = {
            stack: [
                { text: titleText, style: 'invoiceTitle' },
                { text: invoice.number || '', style: 'invoiceNumber' }
            ]
        };

        if (headerAlign === 'center') {
            if (invoice.logo) {
                content.push({ image: invoice.logo, fit: logoFit, alignment: 'center', margin: [0, 0, 0, 8] });
            } else {
                content.push({ text: invoice.fromName || '', style: 'brandName', alignment: 'center', margin: [0, 0, 0, 8] });
            }
            content.push({ text: titleText, style: 'invoiceTitle', alignment: 'center' });
            content.push({ text: invoice.number || '', style: 'invoiceNumber', alignment: 'center', margin: [0, 0, 0, 24] });
        } else if (headerAlign === 'left') {
            content.push(logoEl);
            content.push({ text: titleText, style: 'invoiceTitle', margin: [0, 10, 0, 0] });
            content.push({ text: invoice.number || '', style: 'invoiceNumber', margin: [0, 0, 0, 24] });
        } else {
            content.push({
                columns: [
                    logoEl,
                    { stack: [
                        { text: titleText, style: 'invoiceTitle', alignment: 'right' },
                        { text: invoice.number || '', style: 'invoiceNumber', alignment: 'right' }
                    ]}
                ],
                columnGap: 20,
                margin: [0, 0, 0, 24]
            });
        }

        // From / To
        var fromStack = [
            { text: 'FROM', style: 'sectionLabel' },
            { text: invoice.fromName || '', style: 'partyName' },
            { text: invoice.fromEmail || '', style: 'partyDetail' },
            { text: invoice.fromAddress || '', style: 'partyDetail' },
            { text: invoice.fromPhone || '', style: 'partyDetail' }
        ];
        if (invoice.website) fromStack.push({ text: invoice.website, style: 'partyDetail', color: brandColor });
        if (invoice.taxId) fromStack.push({ text: 'Tax ID: ' + invoice.taxId, fontSize: 9, color: mutedColor });
        if (invoice.regNumber) fromStack.push({ text: 'Reg #: ' + invoice.regNumber, fontSize: 9, color: mutedColor });

        content.push({
            columns: [
                { stack: fromStack },
                { stack: [
                    { text: isNonInvoice ? 'PREPARED FOR' : 'BILL TO', style: 'sectionLabel' },
                    { text: invoice.toName || '', style: 'partyName' },
                    { text: invoice.toEmail || '', style: 'partyDetail' },
                    { text: invoice.toAddress || '', style: 'partyDetail' }
                ]}
            ],
            margin: [0, 0, 0, 20]
        });

        // Meta row
        var metaCells = [
            { stack: [{ text: 'Issue Date', style: 'metaLabel' }, { text: formatDate(invoice.date, dateFormat), style: 'metaValue' }] }
        ];
        if (!isNonInvoice && showDue) {
            metaCells.push({ stack: [{ text: 'Due Date', style: 'metaLabel' }, { text: formatDate(invoice.dueDate, dateFormat), style: 'metaValue' }] });
        }
        if (isNonInvoice && invoice.dueDate) {
            metaCells.push({ stack: [{ text: 'Valid Until', style: 'metaLabel' }, { text: formatDate(invoice.dueDate, dateFormat), style: 'metaValue' }] });
        }
        if (showStatus) {
            metaCells.push({ stack: [{ text: 'Status', style: 'metaLabel' }, { text: (invoice.status || 'draft').toUpperCase(), style: 'metaValue' }] });
        }
        if (showCurrency) {
            metaCells.push({ stack: [{ text: 'Currency', style: 'metaLabel' }, { text: curr, style: 'metaValue' }] });
        }

        var metaWidths = [];
        for (var m = 0; m < metaCells.length; m++) metaWidths.push('*');

        content.push({
            table: { widths: metaWidths, body: [metaCells] },
            layout: {
                fillColor: function() { return tintColor(brandColor, 0.08); },
                hLineWidth: function() { return 0; },
                vLineWidth: function() { return 0; },
                paddingLeft: function() { return 10; },
                paddingRight: function() { return 10; },
                paddingTop: function() { return 8; },
                paddingBottom: function() { return 8; }
            },
            margin: [0, 0, 0, 20]
        });

        // Line Items Table
        content.push({
            table: { headerRows: 1, widths: tableWidths, body: tableBody },
            layout: {
                hLineWidth: function(i, node) { return (i === 0 || i === 1 || i === node.table.body.length) ? 1 : 0.5; },
                vLineWidth: function() { return 0; },
                hLineColor: function(i) { return i <= 1 ? tintColor(mutedColor, 0.5) : tintColor(mutedColor, 0.2); },
                paddingTop: function() { return 8; },
                paddingBottom: function() { return 8; }
            },
            margin: [0, 0, 0, 16]
        });

        // Totals
        content.push({
            columns: [
                { width: '*', text: '' },
                {
                    width: 240,
                    table: { widths: ['*', 'auto'], body: totalsBody },
                    layout: {
                        hLineWidth: function(i) { return i === totalRowIdx ? 1 : 0; },
                        vLineWidth: function() { return 0; },
                        hLineColor: function() { return brandColor; },
                        paddingTop: function() { return 4; },
                        paddingBottom: function() { return 4; }
                    }
                }
            ],
            margin: [0, 0, 0, 20]
        });

        // Payment Instructions
        if (invoice.paymentInstructions && !isNonInvoice) {
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
                canvas: [{ type: 'rect', x: 0, y: 0, w: 515, h: 6, color: brandColor }],
                margin: [0, 16, 0, 0]
            });
        }

        var footerText = invoice.footerText || 'Created with Invoy — Free Invoice Generator';
        var footerColor = tintColor(mutedColor, 0.5);

        var docDef = {
            content: content,
            styles: {
                invoiceTitle: { fontSize: 28, bold: true, color: brandColor },
                invoiceNumber: { fontSize: 11, color: mutedColor, margin: [0, 2, 0, 0] },
                brandName: { fontSize: 18, bold: true, color: headingColor },
                sectionLabel: { fontSize: 9, bold: true, color: mutedColor },
                partyName: { fontSize: 12, bold: true, color: headingColor, margin: [0, 4, 0, 2] },
                partyDetail: { fontSize: 10, color: bodyColor },
                metaLabel: { fontSize: 8, color: mutedColor, bold: true },
                metaValue: { fontSize: 11, color: headingColor, bold: true, margin: [0, 2, 0, 0] },
                tableHeader: { fontSize: 8, bold: true, color: mutedColor },
                tableCell: { fontSize: 10, color: bodyColor }
            },
            defaultStyle: { font: 'Roboto' },
            pageSize: paperSize,
            pageMargins: [40, 40, 40, 60]
        };

        if (showFooter) {
            docDef.footer = function(currentPage, pageCount) {
                return {
                    columns: [
                        { text: 'Page ' + currentPage + ' of ' + pageCount, alignment: 'left', fontSize: 8, color: footerColor, margin: [40, 0, 0, 0] },
                        { text: footerText, alignment: 'right', fontSize: 8, color: footerColor, margin: [0, 0, 40, 0] }
                    ]
                };
            };
        }

        return docDef;
    }

    function download(invoice) {
        try {
            var docDef = generateDefinition(invoice);
            var filename = (invoice.number || 'invoice').replace(/[^a-zA-Z0-9-]/g, '_') + '.pdf';
            pdfMake.createPdf(docDef).download(filename);
        } catch (err) {
            console.error('PDF generation error:', err);
            alert('PDF generation failed: ' + err.message + '\n\nTry removing the logo image and downloading again.');
        }
    }

    function preview(invoice) {
        try {
            var docDef = generateDefinition(invoice);
            pdfMake.createPdf(docDef).open();
        } catch (err) {
            console.error('PDF preview error:', err);
            alert('PDF preview failed: ' + err.message);
        }
    }

    return { download: download, preview: preview, formatMoney: formatMoney, formatDate: formatDate, getCurrencySymbol: getCurrencySymbol };
})();
