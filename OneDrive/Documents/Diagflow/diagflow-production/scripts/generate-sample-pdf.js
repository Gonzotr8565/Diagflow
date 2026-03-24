const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

function generatePDFReport(reportData, outPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 50, bottom: 70, left: 50, right: 50 } });
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);

    const pageWidth = doc.page.width - 100;
    const v = reportData.vehicleInfo || {};

    // Header
    doc.rect(0, 0, doc.page.width, 80).fill('#0066ff');
    doc.fillColor('#ffffff').fontSize(28).font('Helvetica-Bold').text('DiagFlow', 50, 20);
    doc.fontSize(12).font('Helvetica').text('Professional Diagnostic Report', 50, 50);
    doc.fillColor('#99ccff').fontSize(10).font('Helvetica-Oblique').text('Never Miss A Step', 400, 50, { align: 'right', width: 150 });
    doc.y = 100;

    // Vehicle info
    doc.fillColor('#f5f5f5').rect(50, doc.y, pageWidth, 85).fill();
    doc.strokeColor('#dddddd').rect(50, doc.y, pageWidth, 85).stroke();
    const boxY = doc.y + 10;
    doc.fillColor('#0066ff').fontSize(12).font('Helvetica-Bold').text('VEHICLE INFORMATION', 60, boxY);
    doc.fillColor('#333333').fontSize(10).font('Helvetica');
    const vehicleText = [v.year, v.make, v.model].filter(Boolean).join(' ') || 'N/A';
    doc.text(`Year/Make/Model: ${vehicleText}`, 60, boxY + 20);
    doc.text(`VIN: ${v.vin || 'N/A'}`, 60, boxY + 35);
    doc.text(`Mileage: ${v.mileage || 'N/A'}`, 60, boxY + 50);
    doc.text(`RO Number: ${v.roNumber || 'N/A'}`, 320, boxY + 20);
    doc.text(`Technician: ${reportData.technicianName || 'N/A'}`, 320, boxY + 35);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 320, boxY + 50);
    doc.y = boxY + 85;

    // Parts table
    const parts = reportData.partsRequest || [];
    if (parts.length > 0) {
      doc.y += 10;
      const tableLeft = 50;
      const tableWidth = pageWidth;
      const col = { qty: 40, pn: 90, desc: 180, unit: 70, ext: 70, vendor: 80 };
      col.status = tableWidth - (col.qty + col.pn + col.desc + col.unit + col.ext + col.vendor) - 8;

      doc.fillColor('#166534').fontSize(14).font('Helvetica-Bold').text('Parts & Labor Request', tableLeft + 4, doc.y + 6);
      doc.y += 30;

      const headerY = doc.y;
      doc.fillColor('#f3faf1').rect(tableLeft, headerY, tableWidth, 28).fill();
      doc.fillColor('#064e3b').fontSize(10).font('Helvetica-Bold');
      doc.text('Qty', tableLeft + 6, headerY + 8, { width: col.qty });
      doc.text('P/N', tableLeft + 6 + col.qty, headerY + 8, { width: col.pn });
      doc.text('Description', tableLeft + 6 + col.qty + col.pn, headerY + 8, { width: col.desc });
      doc.text('Unit', tableLeft + 6 + col.qty + col.pn + col.desc, headerY + 8, { width: col.unit, align: 'right' });
      doc.text('Ext', tableLeft + 6 + col.qty + col.pn + col.desc + col.unit, headerY + 8, { width: col.ext, align: 'right' });
      doc.text('Vendor/ETA', tableLeft + 6 + col.qty + col.pn + col.desc + col.unit + col.ext, headerY + 8, { width: col.vendor });
      doc.text('Status', tableLeft + 6 + col.qty + col.pn + col.desc + col.unit + col.ext + col.vendor, headerY + 8, { width: col.status });

      doc.strokeColor('#d1fae5').lineWidth(1.5).moveTo(tableLeft, headerY + 28).lineTo(tableLeft + tableWidth, headerY + 28).stroke();
      doc.y = headerY + 28;

      let partsTotal = 0;
      let laborTotal = 0;

      parts.forEach((p) => {
        const isLabor = p.laborItem;
        const qty = parseInt(p.quantity || 1, 10) || 1;
        const unitPrice = parseFloat(p.unitPrice) || 0;
        const extPrice = isLabor ? 0 : qty * unitPrice;
        const laborHours = parseFloat(p.laborHours) || 0;
        const laborRate = parseFloat(p.laborRate) || 0;
        if (!isLabor) partsTotal += extPrice;
        if (isLabor) laborTotal += laborHours * laborRate;

        const rowHeight = 20 + (p.notes ? 12 : 0);
        if (doc.y + rowHeight > doc.page.height - 80) { doc.addPage(); doc.y = 50; }

        doc.fillColor('#ffffff').rect(tableLeft, doc.y, tableWidth, rowHeight).fill();
        doc.fillColor('#111827').fontSize(10).font('Helvetica-Bold');
        doc.text(String(qty), tableLeft + 6, doc.y + 6, { width: col.qty, align: 'left' });
        doc.font('Helvetica').fontSize(9).fillColor('#111827').text(p.partNumber || '-', tableLeft + 6 + col.qty, doc.y + 6, { width: col.pn });
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(p.partName || p.name || 'Unnamed Part', tableLeft + 6 + col.qty + col.pn, doc.y + 6, { width: col.desc });
        doc.font('Helvetica').fontSize(9).fillColor('#111827').text(unitPrice ? unitPrice.toFixed(2) : '-', tableLeft + 6 + col.qty + col.pn + col.desc, doc.y + 6, { width: col.unit, align: 'right' });
        doc.text(extPrice ? extPrice.toFixed(2) : '-', tableLeft + 6 + col.qty + col.pn + col.desc + col.unit, doc.y + 6, { width: col.ext, align: 'right' });
        doc.fontSize(9).fillColor('#374151').text(p.vendor || p.supplier || '-', tableLeft + 6 + col.qty + col.pn + col.desc + col.unit + col.ext, doc.y + 6, { width: col.vendor });
        const statusText = isLabor ? `Labor ${laborHours}h` : (p.inStock ? 'In Stock' : 'Order');
        const statusColor = isLabor ? '#3b82f6' : (p.inStock ? '#16a34a' : '#dc2626');
        doc.fillColor(statusColor).font('Helvetica-Bold').fontSize(9).text(statusText, tableLeft + 6 + col.qty + col.pn + col.desc + col.unit + col.ext + col.vendor, doc.y + 6, { width: col.status });

        if (p.notes) { doc.font('Helvetica').fontSize(8).fillColor('#6b7280').text(`Note: ${p.notes}`, tableLeft + 6 + col.qty + col.pn + col.desc, doc.y + 20, { width: tableWidth - (col.qty + col.pn + 12) }); doc.y += 12; }

        doc.strokeColor('#e5e7eb').lineWidth(0.5).moveTo(tableLeft, doc.y + rowHeight).lineTo(tableLeft + tableWidth, doc.y + rowHeight).stroke();
        doc.y += rowHeight;
      });

      doc.y += 10;
      doc.fillColor('#064e3b').fontSize(10).font('Helvetica-Bold').text('Summary:', tableLeft + 8, doc.y);
      doc.font('Helvetica').fontSize(10).fillColor('#111827').text(` ${parts.filter(p => !p.laborItem).length} parts (${parts.filter(p => !p.laborItem && p.inStock).length} in stock, ${parts.filter(p => !p.laborItem && !p.inStock).length} to order) | ${parts.filter(p => p.laborItem).length} labor items`, tableLeft + 70, doc.y);
      doc.y += 18;
      doc.fillColor('#111827').fontSize(10).font('Helvetica-Bold').text('Parts Total:', tableLeft + 8, doc.y);
      doc.font('Helvetica').fontSize(10).text(`$${partsTotal.toFixed(2)}`, tableLeft + 120, doc.y);
      doc.y += 14;
      doc.fillColor('#111827').fontSize(10).font('Helvetica-Bold').text('Labor Total:', tableLeft + 8, doc.y);
      doc.font('Helvetica').fontSize(10).text(`$${laborTotal.toFixed(2)}`, tableLeft + 120, doc.y);
      doc.y += 14;
      doc.fillColor('#111827').fontSize(11).font('Helvetica-Bold').text('Grand Total:', tableLeft + 8, doc.y);
      doc.font('Helvetica').fontSize(11).text(`$${(partsTotal + laborTotal).toFixed(2)}`, tableLeft + 120, doc.y);
    }

    // Footer
    doc.fillColor('#666666').fontSize(8).font('Helvetica').text(`Generated by DiagFlow | Never Miss A Step | ${new Date().toLocaleString()}`, 50, doc.page.height - 40, { align: 'center', width: doc.page.width - 100 });

    doc.end();

    stream.on('finish', () => resolve(outPath));
    stream.on('error', reject);
  });
}

(async () => {
  try {
    const sampleReport = {
      shopName: 'Acme Auto Repair',
      technicianName: 'Sam Tech',
      vehicleInfo: { year: 2018, make: 'Toyota', model: 'Camry', vin: '1ABCDEFGH23456789', mileage: 78500, roNumber: 'RO12345' },
      completedSteps: 6,
      totalSteps: 15,
      steps: [
        { id: 1, title: 'Initial Scan', completed: true, notes: 'P0100 stored', images: [] },
        { id: 2, title: 'Visual Inspection', completed: true, notes: 'Loose connector at MAF', images: [] }
      ],
      partsRequest: [
        { partName: 'Mass Air Flow Sensor', partNumber: 'MAF-1234', quantity: 1, unitPrice: 145.0, inStock: false, vendor: 'OEM', notes: 'Replace due to contamination' },
        { partName: 'Cabin Air Filter', partNumber: 'CF-5678', quantity: 1, unitPrice: 19.99, inStock: true, vendor: 'Aftermarket' },
        { name: 'Diagnostic Labor', laborItem: true, laborHours: 1.5, laborRate: 95 }
      ]
    };

    const outPath = path.join(__dirname, '..', 'DiagFlow_Sample_Report.pdf');
    console.log('Generating sample PDF to', outPath);
    const result = await generatePDFReport(sampleReport, outPath);
    console.log('Sample PDF generated:', result);
  } catch (err) {
    console.error('Error generating sample PDF:', err);
    process.exit(1);
  }
})();
