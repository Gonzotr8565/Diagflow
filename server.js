const express = require('express');
const cors = require('cors');
const { Resend } = require('resend');
const PDFDocument = require('pdfkit');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// Auth Configuration
const BETA_PASSWORD = process.env.BETA_PASSWORD || 'diagflow2024';
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

// Simple JWT-like token generation
function generateToken(data) {
  const payload = JSON.stringify({ ...data, exp: Date.now() + (7 * 24 * 60 * 60 * 1000) });
  const encoded = Buffer.from(payload).toString('base64');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(encoded).digest('hex');
  return `${encoded}.${signature}`;
}

function verifyToken(token) {
  try {
    const [encoded, signature] = token.split('.');
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(encoded).digest('hex');
    if (signature !== expectedSig) return null;
    const payload = JSON.parse(Buffer.from(encoded, 'base64').toString());
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// Auth Endpoints
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  if (password === BETA_PASSWORD) {
    const token = generateToken({ user: 'beta', loginTime: Date.now() });
    console.log('Login successful');
    res.json({ success: true, token });
  } else {
    console.log('Login failed - invalid password');
    res.json({ success: false, error: 'Invalid password' });
  }
});

app.get('/api/auth/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.json({ valid: false });
  }
  const token = authHeader.substring(7);
  const payload = verifyToken(token);
  res.json(payload ? { valid: true, user: payload.user } : { valid: false });
});

// Resend Email Setup
let resend = null;
if (process.env.RESEND_API_KEY) {
  resend = new Resend(process.env.RESEND_API_KEY);
  console.log('Resend configured successfully');
} else {
  console.warn('RESEND_API_KEY not set');
}

const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@example.com';

// =============================================
// TASK MANAGER ROUTE (no auth required)
// =============================================
app.get('/tasks', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tasks.html'));
});

// ============ PDF GENERATION ============
function generatePDFReport(reportData) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ 
      size: 'LETTER', 
      margins: { top: 50, bottom: 70, left: 50, right: 50 },
      bufferPages: true
    });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - 100;
    const v = reportData.vehicleInfo || {};
    const shopName = reportData.shopName || '';
    const techName = reportData.technicianName || '';

    // ============ HEADER ============
    doc.rect(0, 0, doc.page.width, 80).fill('#0066ff');
    
    doc.fillColor('#ffffff')
       .fontSize(28)
       .font('Helvetica-Bold')
       .text('DiagFlow', 50, 20);
    
    doc.fontSize(12)
       .font('Helvetica')
       .text('Professional Diagnostic Report', 50, 50);

    if (shopName) {
      doc.fontSize(14)
         .font('Helvetica-Bold')
         .text(shopName, 400, 25, { align: 'right', width: 150 });
    }

    doc.fontSize(10)
       .font('Helvetica-Oblique')
       .fillColor('#99ccff')
       .text('Never Miss A Step', 400, 50, { align: 'right', width: 150 });

    doc.y = 100;

    // ============ VEHICLE INFO BOX ============
    doc.fillColor('#f5f5f5')
       .rect(50, doc.y, pageWidth, 85)
       .fill();
    
    doc.strokeColor('#dddddd')
       .rect(50, doc.y, pageWidth, 85)
       .stroke();

    const boxY = doc.y + 10;
    
    doc.fillColor('#0066ff')
       .fontSize(12)
       .font('Helvetica-Bold')
       .text('VEHICLE INFORMATION', 60, boxY);

    doc.fillColor('#333333')
       .fontSize(10)
       .font('Helvetica');

    const vehicleText = [v.year, v.make, v.model].filter(Boolean).join(' ') || 'N/A';
    doc.text(`Year/Make/Model: ${vehicleText}`, 60, boxY + 20);
    doc.text(`VIN: ${v.vin || 'N/A'}`, 60, boxY + 35);
    doc.text(`Mileage: ${v.mileage || 'N/A'}`, 60, boxY + 50);

    doc.text(`RO Number: ${v.roNumber || 'N/A'}`, 320, boxY + 20);
    doc.text(`Technician: ${techName || 'N/A'}`, 320, boxY + 35);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 320, boxY + 50);

    doc.y = boxY + 85;

    // ============ PROGRESS BAR ============
    const completed = reportData.completedSteps || 0;
    const total = reportData.totalSteps || 15;
    const percentage = Math.round((completed / total) * 100);

    doc.fillColor('#0066ff')
       .fontSize(12)
       .font('Helvetica-Bold')
       .text('DIAGNOSTIC PROGRESS', 50, doc.y);

    doc.y += 18;

    doc.fillColor('#e0e0e0')
       .roundedRect(50, doc.y, pageWidth, 22, 3)
       .fill();

    const progressWidth = Math.max((completed / total) * pageWidth, 0);
    if (progressWidth > 0) {
      doc.fillColor(percentage === 100 ? '#22c55e' : '#0066ff')
         .roundedRect(50, doc.y, progressWidth, 22, 3)
         .fill();
    }

    doc.fillColor('#333333')
       .fontSize(10)
       .font('Helvetica-Bold')
       .text(`${completed} of ${total} steps completed (${percentage}%)`, 50, doc.y + 5, { 
         align: 'center', 
         width: pageWidth 
       });

    doc.y += 35;

    // ============ STEPS TABLE ============
    doc.fillColor('#0066ff')
       .fontSize(12)
       .font('Helvetica-Bold')
       .text('DIAGNOSTIC WORKFLOW', 50, doc.y);

    doc.y += 18;

    const headerY = doc.y;
    doc.fillColor('#0066ff')
       .rect(50, headerY, pageWidth, 22)
       .fill();

    doc.fillColor('#ffffff')
       .fontSize(9)
       .font('Helvetica-Bold');
    
    doc.text('Status', 55, headerY + 6);
    doc.text('#', 100, headerY + 6);
    doc.text('Description', 125, headerY + 6);
    doc.text('Category', 400, headerY + 6);

    doc.y = headerY + 22;

    const steps = reportData.steps || [];
    
    steps.forEach((step, index) => {
      if (doc.y > 680) {
        doc.addPage();
        doc.y = 50;
      }

      const isCompleted = step.completed;
      const hasNotes = step.notes && step.notes.trim().length > 0;
      const rowHeight = hasNotes ? 38 : 22;
      const rowColor = index % 2 === 0 ? '#ffffff' : '#f8f8f8';

      doc.fillColor(rowColor)
         .rect(50, doc.y, pageWidth, rowHeight)
         .fill();

      const statusX = 65;
      const statusY = doc.y + 11;
      
      if (isCompleted) {
        doc.circle(statusX, statusY, 6).fill('#22c55e');
        doc.strokeColor('#ffffff')
           .lineWidth(1.5)
           .moveTo(statusX - 3, statusY)
           .lineTo(statusX - 1, statusY + 3)
           .lineTo(statusX + 4, statusY - 3)
           .stroke();
      } else {
        doc.circle(statusX, statusY, 6)
           .lineWidth(1.5)
           .strokeColor('#cccccc')
           .stroke();
      }

      doc.fillColor('#333333')
         .fontSize(9)
         .font('Helvetica')
         .text(step.id.toString(), 100, doc.y + 6);

      doc.text(step.title || '', 125, doc.y + 6, { width: 260 });

      doc.fillColor('#666666')
         .fontSize(8)
         .text(step.category || '', 400, doc.y + 6, { width: 100 });

      if (hasNotes) {
        doc.fillColor('#0066ff')
           .fontSize(8)
           .font('Helvetica-Oblique')
           .text(`Note: ${step.notes}`, 125, doc.y + 20, { width: 380 });
      }

      doc.strokeColor('#e0e0e0')
         .lineWidth(0.5)
         .moveTo(50, doc.y + rowHeight)
         .lineTo(50 + pageWidth, doc.y + rowHeight)
         .stroke();

      doc.y += rowHeight;
    });

    // ============ IMAGES SECTION ============
    const stepsWithImages = steps.filter(s => s.images && s.images.length > 0);
    
    if (stepsWithImages.length > 0) {
      if (doc.y > 500) {
        doc.addPage();
        doc.y = 50;
      } else {
        doc.y += 20;
      }

      doc.fillColor('#0066ff')
         .fontSize(12)
         .font('Helvetica-Bold')
         .text('DIAGNOSTIC IMAGES', 50, doc.y);

      doc.y += 20;

      stepsWithImages.forEach(step => {
        if (doc.y > 600) {
          doc.addPage();
          doc.y = 50;
        }

        doc.fillColor('#333333')
           .fontSize(10)
           .font('Helvetica-Bold')
           .text(`Step ${step.id}: ${step.title}`, 50, doc.y);

        doc.y += 15;

        step.images.forEach((img, imgIndex) => {
          if (doc.y > 650) {
            doc.addPage();
            doc.y = 50;
          }

          try {
            const imgData = typeof img === 'string' ? img : img.url;
            if (imgData && imgData.startsWith('data:image')) {
              const base64Data = imgData.split(',')[1];
              const imgBuffer = Buffer.from(base64Data, 'base64');
              doc.image(imgBuffer, 50, doc.y, { width: 150, height: 100 });
              doc.y += 110;
            }
          } catch (imgErr) {
            console.error('Error embedding image:', imgErr.message);
            doc.fillColor('#999999')
               .fontSize(8)
               .text(`[Image ${imgIndex + 1} could not be embedded]`, 50, doc.y);
            doc.y += 15;
          }
        });

        doc.y += 10;
      });
    }

    // ============ FOOTER ON ALL PAGES ============
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      
      doc.fillColor('#e0e0e0')
         .rect(0, doc.page.height - 50, doc.page.width, 50)
         .fill();
      
      doc.fillColor('#666666')
         .fontSize(8)
         .font('Helvetica')
         .text(
           `Generated by DiagFlow | ${new Date().toLocaleString()}`,
           50,
           doc.page.height - 35,
           { align: 'center', width: doc.page.width - 100 }
         );
      
      doc.text(
        `Page ${i + 1} of ${pages.count}`,
        50,
        doc.page.height - 25,
        { align: 'center', width: doc.page.width - 100 }
      );
    }

    doc.end();
  });
}

// Submit Report Endpoint
app.post('/api/submit-report', async (req, res) => {
  try {
    const { reportData, recipientEmail, recipients } = req.body;

    if (!resend) {
      return res.status(500).json({ success: false, error: 'Email service not configured. Set RESEND_API_KEY in Railway environment variables.' });
    }

    const pdfBuffer = await generatePDFReport(reportData);
    const v = reportData.vehicleInfo || {};
    const filename = `DiagFlow_Report_${v.year || 'Vehicle'}_${v.make || ''}_${v.model || ''}_${Date.now()}.pdf`;

    // Support both 'recipients' (array from frontend) and 'recipientEmail' (string, legacy)
    let emailList = [];
    if (recipients && Array.isArray(recipients)) {
      emailList = recipients.map(e => e.trim()).filter(e => e);
    } else if (recipientEmail) {
      emailList = recipientEmail.split(',').map(e => e.trim()).filter(e => e);
    }

    if (emailList.length === 0) {
      return res.status(400).json({ success: false, error: 'No recipient email provided' });
    }

    // Build parts request section if available
    let partsHtml = '';
    if (reportData.partsRequest && reportData.partsRequest.length > 0) {
      partsHtml = `
        <div style="margin-top: 20px; padding: 15px; background: #f0fff4; border-radius: 8px; border: 1px solid #86efac;">
          <h3 style="margin: 0 0 10px 0; color: #166534;">🛒 Parts & Labor Request</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <tr style="background: #dcfce7;">
              <th style="padding: 8px; text-align: left; border-bottom: 2px solid #86efac;">Part/Labor</th>
              <th style="padding: 8px; text-align: center; border-bottom: 2px solid #86efac;">Type</th>
              <th style="padding: 8px; text-align: center; border-bottom: 2px solid #86efac;">Stock</th>
            </tr>
            ${reportData.partsRequest.map(part => `
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">
                  <strong>${part.name}</strong>
                  ${part.partNumber ? `<br><span style="color: #666; font-size: 11px;">P/N: ${part.partNumber}</span>` : ''}
                  ${part.notes ? `<br><span style="color: #666; font-size: 11px;">Note: ${part.notes}</span>` : ''}
                </td>
                <td style="padding: 8px; text-align: center; border-bottom: 1px solid #e5e7eb;">
                  <span style="color: ${part.laborItem ? '#3b82f6' : '#666'}; font-weight: bold;">
                    ${part.laborItem ? '🔧 Labor' : '📦 Part'}
                  </span>
                </td>
                <td style="padding: 8px; text-align: center; border-bottom: 1px solid #e5e7eb;">
                  ${part.laborItem ? '-' : `<span style="color: ${part.inStock ? '#22c55e' : '#ef4444'}; font-weight: bold;">${part.inStock ? '✓ In Stock' : '⚠ Order'}</span>`}
                </td>
              </tr>
            `).join('')}
          </table>
          <p style="margin: 10px 0 0 0; font-size: 12px; color: #166534;">
            <strong>Summary:</strong> 
            ${reportData.partsRequest.filter(p => !p.laborItem).length} parts 
            (${reportData.partsRequest.filter(p => !p.laborItem && p.inStock).length} in stock, 
            ${reportData.partsRequest.filter(p => !p.laborItem && !p.inStock).length} to order) | 
            ${reportData.partsRequest.filter(p => p.laborItem).length} labor items
          </p>
        </div>
      `;
    }

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #0066ff, #0052cc); padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">DiagFlow Report</h1>
          <p style="color: #99ccff; margin: 5px 0 0 0;">Professional Diagnostic Workflow</p>
        </div>
        
        <div style="padding: 20px; background: #f5f5f5;">
          <h2 style="color: #333; margin-top: 0;">Vehicle Information</h2>
          <table style="width: 100%; background: white; border-radius: 8px; overflow: hidden;">
            <tr>
              <td style="padding: 10px; font-weight: bold; background: #f0f0f0;">Year/Make/Model</td>
              <td style="padding: 10px;">${v.year || ''} ${v.make || ''} ${v.model || ''}</td>
            </tr>
            <tr>
              <td style="padding: 10px; font-weight: bold; background: #f0f0f0;">VIN</td>
              <td style="padding: 10px;">${v.vin || 'N/A'}</td>
            </tr>
            <tr>
              <td style="padding: 10px; font-weight: bold; background: #f0f0f0;">RO Number</td>
              <td style="padding: 10px;">${v.roNumber || 'N/A'}</td>
            </tr>
            <tr>
              <td style="padding: 10px; font-weight: bold; background: #f0f0f0;">Mileage</td>
              <td style="padding: 10px;">${v.mileage || 'N/A'}</td>
            </tr>
          </table>
          
          <div style="margin-top: 20px; padding: 15px; background: white; border-radius: 8px;">
            <h3 style="margin: 0 0 10px 0; color: #0066ff;">Progress</h3>
            <p style="margin: 0; font-size: 18px;">
              <strong>${reportData.completedSteps || 0}</strong> of <strong>${reportData.totalSteps || 15}</strong> steps completed
            </p>
          </div>

          ${partsHtml}
          
          <p style="margin-top: 20px; color: #666;">
            Please find the complete diagnostic report attached as a PDF.
          </p>
        </div>
        
        <div style="background: #333; padding: 15px; text-align: center;">
          <p style="color: #999; margin: 0; font-size: 12px;">
            Generated by DiagFlow | Never Miss A Step
          </p>
        </div>
      </div>
    `;

    console.log(`Sending email to ${emailList.length} recipient(s):`, emailList.join(', '));
    
    const emailPromises = emailList.map(email => 
      resend.emails.send({
        from: FROM_EMAIL,
        to: email,
        subject: `DiagFlow Report: ${v.year || ''} ${v.make || ''} ${v.model || ''} - RO# ${v.roNumber || 'N/A'}`,
        html: emailHtml,
        attachments: [{
          filename: filename,
          content: pdfBuffer.toString('base64')
        }]
      })
    );

    const results = await Promise.allSettled(emailPromises);
    
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    if (failed > 0) {
      console.warn(`Email sending: ${successful} successful, ${failed} failed`);
    } else {
      console.log(`All ${successful} emails sent successfully!`);
    }
    
    res.json({ 
      success: true, 
      sent: successful,
      failed: failed,
      recipients: emailList
    });

  } catch (error) {
    console.error('Submit report error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Support Request Endpoint
app.post('/api/support-request', async (req, res) => {
  try {
    const { 
      vehicleInfo, 
      helpType, 
      description, 
      phoneNumber, 
      technicianEmail,
      technicianName,
      shopName,
      diagnosticProgress 
    } = req.body;
    
    const year = vehicleInfo?.year || req.body.year || '';
    const make = vehicleInfo?.make || req.body.make || '';
    const model = vehicleInfo?.model || req.body.model || '';
    const email = technicianEmail || req.body.email || '';

    if (!resend) {
      return res.status(500).json({ success: false, error: 'Email service not configured' });
    }

    let progressHtml = '';
    if (diagnosticProgress) {
      const stepsHtml = diagnosticProgress.stepsWithNotes?.map(step => 
        `<tr>
          <td style="padding: 5px; border-bottom: 1px solid #eee;">${step.completed ? '✅' : '⬜'} Step ${step.step}</td>
          <td style="padding: 5px; border-bottom: 1px solid #eee;">${step.title}</td>
          <td style="padding: 5px; border-bottom: 1px solid #eee; font-style: italic; color: #666;">${step.notes || '-'}</td>
        </tr>`
      ).join('') || '';

      progressHtml = `
        <div style="margin-top: 20px; padding: 15px; background: #f0f7ff; border-radius: 8px; border: 1px solid #cce0ff;">
          <h3 style="margin: 0 0 10px 0; color: #0066ff;">📊 Diagnostic Progress</h3>
          <p style="margin: 5px 0;"><strong>${diagnosticProgress.completedSteps} of ${diagnosticProgress.totalSteps} steps completed (${diagnosticProgress.percentage}%)</strong></p>
          ${stepsHtml ? `
            <table style="width: 100%; margin-top: 10px; font-size: 12px;">
              <tr style="background: #e0eeff;">
                <th style="padding: 5px; text-align: left;">Status</th>
                <th style="padding: 5px; text-align: left;">Step</th>
                <th style="padding: 5px; text-align: left;">Notes</th>
              </tr>
              ${stepsHtml}
            </table>
          ` : ''}
        </div>
      `;
    }

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #f97316, #ea580c); padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">DiagFlow Support Request</h1>
        </div>
        
        <div style="padding: 20px; background: #fff8f5; border: 1px solid #fed7aa;">
          <h2 style="color: #ea580c; margin-top: 0;">New Help Request</h2>
          
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 10px; font-weight: bold; width: 140px; vertical-align: top;">Vehicle:</td>
              <td style="padding: 10px;">${year} ${make} ${model}</td>
            </tr>
            ${vehicleInfo?.vin ? `<tr style="background: #fef3e8;"><td style="padding: 10px; font-weight: bold;">VIN:</td><td style="padding: 10px;">${vehicleInfo.vin}</td></tr>` : ''}
            ${vehicleInfo?.mileage ? `<tr><td style="padding: 10px; font-weight: bold;">Mileage:</td><td style="padding: 10px;">${vehicleInfo.mileage}</td></tr>` : ''}
            ${vehicleInfo?.roNumber ? `<tr style="background: #fef3e8;"><td style="padding: 10px; font-weight: bold;">RO Number:</td><td style="padding: 10px;">${vehicleInfo.roNumber}</td></tr>` : ''}
            <tr>
              <td style="padding: 10px; font-weight: bold; vertical-align: top;">Help Type:</td>
              <td style="padding: 10px;">${helpType || 'General'}</td>
            </tr>
            <tr style="background: #fef3e8;">
              <td style="padding: 10px; font-weight: bold; vertical-align: top;">Description:</td>
              <td style="padding: 10px;">${description || 'No description provided'}</td>
            </tr>
          </table>
          
          <div style="margin-top: 20px; padding: 15px; background: white; border-radius: 8px; border: 1px solid #e5e5e5;">
            <h3 style="margin: 0 0 10px 0; color: #333;">👤 Contact Information</h3>
            ${shopName ? `<p style="margin: 5px 0;">Shop: <strong>${shopName}</strong></p>` : ''}
            ${technicianName ? `<p style="margin: 5px 0;">Technician: <strong>${technicianName}</strong></p>` : ''}
            <p style="margin: 5px 0;">📞 Phone: <strong>${phoneNumber || 'Not provided'}</strong></p>
            <p style="margin: 5px 0;">📧 Email: <strong>${email || 'Not provided'}</strong></p>
          </div>
          
          ${progressHtml}
        </div>
        
        <div style="background: #333; padding: 15px; text-align: center;">
          <p style="color: #999; margin: 0; font-size: 12px;">DiagFlow Support System</p>
        </div>
      </div>
    `;

    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: SUPPORT_EMAIL,
      subject: `DiagFlow Support: ${helpType || 'Help'} - ${year} ${make} ${model}`,
      html: emailHtml,
      replyTo: email || undefined
    });

    console.log('Support request sent:', result);
    res.json({ success: true, messageId: result.id });

  } catch (error) {
    console.error('Support request error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: 'V47 Pro', auth: 'enabled' });
});

// Serve frontend (catch-all - must be last)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('');
  console.log('==============================================');
  console.log('  DiagFlow V47 Pro Server');
  console.log('==============================================');
  console.log('  Port:', PORT);
  console.log('  Auth: Enabled');
  console.log('  Password:', BETA_PASSWORD);
  console.log('  Email:', process.env.RESEND_API_KEY ? 'Configured' : 'Not configured');
  console.log('  From:', FROM_EMAIL);
  console.log('  Support:', SUPPORT_EMAIL);
  console.log('  Tasks: /tasks (no auth)');
  console.log('==============================================');
  console.log('');
});
