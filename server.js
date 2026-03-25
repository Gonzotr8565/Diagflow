const express = require('express');
const cors = require('cors');
const { Resend } = require('resend');
const PdfPrinter = require('pdfmake/src/printer');
const path = require('path');
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');

// Initialize PDFMake fonts for Node.js
const fonts = {
  Roboto: {
    normal: path.join(__dirname, 'node_modules', 'pdfmake', 'build', 'vfs_fonts.js') ? 
      require('pdfmake/build/vfs_fonts').pdfMake?.vfs || require('pdfmake/build/vfs_fonts').vfs : null
  }
};

// For pdfmake Node printer, use built-in fonts path
const printer = new PdfPrinter({
  Roboto: {
    normal: path.resolve(__dirname, 'node_modules/pdfmake/fonts/Roboto-Regular.ttf'),
    bold: path.resolve(__dirname, 'node_modules/pdfmake/fonts/Roboto-Medium.ttf'),
    italics: path.resolve(__dirname, 'node_modules/pdfmake/fonts/Roboto-Italic.ttf'),
    bolditalics: path.resolve(__dirname, 'node_modules/pdfmake/fonts/Roboto-MediumItalic.ttf')
  }
});

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// Auth Configuration
const BETA_PASSWORD = process.env.BETA_PASSWORD || 'diagflow2024';
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

// Anthropic AI Configuration
let anthropic = null;
if (process.env.ANTHROPIC_API_KEY) {
  anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  console.log('Anthropic AI configured successfully');
} else {
  console.warn('ANTHROPIC_API_KEY not set - AI analysis disabled');
}

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

// ============ PDF GENERATION (PDFMake - Node.js Printer) ============
function generatePDFReport(reportData) {
  return new Promise((resolve, reject) => {
    try {
      const v = reportData.vehicleInfo || {};
      const shopName = reportData.shopName || '';
      const techName = reportData.technicianName || '';
      const steps = reportData.steps || [];
      const partsRequest = reportData.partsRequest || [];
      const completed = reportData.completedSteps || 0;
      const total = reportData.totalSteps || 15;
      const percentage = Math.round((completed / total) * 100);

      console.log('Parts Request received:', JSON.stringify(partsRequest, null, 2));

      // Build steps table rows
      const stepsTableBody = [
        [
          { text: 'Status', style: 'tableHeader' },
          { text: '#', style: 'tableHeader' },
          { text: 'Step', style: 'tableHeader' },
          { text: 'Notes', style: 'tableHeader' }
        ]
      ];

      steps.forEach(step => {
        const statusText = step.completed ? '✓' : '○';
        const statusColor = step.completed ? '#22c55e' : '#999999';
        stepsTableBody.push([
          { text: statusText, color: statusColor, bold: true, alignment: 'center' },
          { text: step.id.toString(), alignment: 'center' },
          { text: step.title || '', bold: true },
          { text: step.notes || '-', fontSize: 9, color: '#666666' }
        ]);
      });

      // Build parts table rows
      const partsTableBody = [
        [
          { text: 'Part/Labor', style: 'partsHeader' },
          { text: 'Type', style: 'partsHeader', alignment: 'center' },
          { text: 'Stock', style: 'partsHeader', alignment: 'center' }
        ]
      ];

      partsRequest.forEach(part => {
        const partName = part.partName || part.name || 'Unnamed Part';
        const partNumber = part.partNumber || '';
        const isLabor = part.laborItem;
        const inStock = part.inStock;

        const nameCell = partNumber 
          ? { text: [{ text: partName + '\n', bold: true }, { text: 'P/N: ' + partNumber, fontSize: 9, color: '#666666' }] }
          : { text: partName, bold: true };

        const typeCell = {
          text: isLabor ? 'Labor' : 'Part',
          color: isLabor ? '#3b82f6' : '#666666',
          bold: true,
          alignment: 'center'
        };

        let stockCell;
        if (isLabor) {
          stockCell = { text: '-', color: '#9ca3af', alignment: 'center' };
        } else {
          stockCell = {
            text: inStock ? 'In Stock' : 'Order',
            color: inStock ? '#22c55e' : '#ef4444',
            bold: true,
            alignment: 'center'
          };
        }

        partsTableBody.push([nameCell, typeCell, stockCell]);
      });

      // Parts summary
      const partsCount = partsRequest.filter(p => !p.laborItem).length;
      const inStockCount = partsRequest.filter(p => !p.laborItem && p.inStock).length;
      const toOrderCount = partsRequest.filter(p => !p.laborItem && !p.inStock).length;
      const laborCount = partsRequest.filter(p => p.laborItem).length;

      // Document definition
      const docDefinition = {
        pageSize: 'LETTER',
        pageMargins: [40, 60, 40, 60],
        
        header: {
          columns: [
            {
              text: 'DiagFlow',
              style: 'headerTitle',
              width: '*'
            },
            {
              text: shopName || '',
              style: 'headerShop',
              width: 'auto',
              alignment: 'right'
            }
          ],
          margin: [40, 20, 40, 0]
        },
        
        footer: function(currentPage, pageCount) {
          return {
            text: 'Generated by DiagFlow | Never Miss A Step | Page ' + currentPage + ' of ' + pageCount,
            alignment: 'center',
            fontSize: 8,
            color: '#999999',
            margin: [40, 20, 40, 0]
          };
        },

        content: [
          // Vehicle Info Box
          {
            table: {
              widths: ['30%', '20%', '30%', '20%'],
              body: [
                [
                  { text: 'Year/Make/Model', fillColor: '#f0f0f0', bold: true },
                  { text: [v.year, v.make, v.model].filter(Boolean).join(' ') || 'N/A', colSpan: 3 },
                  {}, {}
                ],
                [
                  { text: 'VIN', fillColor: '#f0f0f0', bold: true },
                  { text: v.vin || 'N/A' },
                  { text: 'RO Number', fillColor: '#f0f0f0', bold: true },
                  { text: v.roNumber || 'N/A' }
                ],
                [
                  { text: 'Mileage', fillColor: '#f0f0f0', bold: true },
                  { text: v.mileage || 'N/A' },
                  { text: 'Technician', fillColor: '#f0f0f0', bold: true },
                  { text: techName || 'N/A' }
                ]
              ]
            },
            layout: 'lightHorizontalLines',
            margin: [0, 0, 0, 15]
          },

          // Progress
          {
            text: 'Progress',
            style: 'sectionHeader',
            margin: [0, 0, 0, 5]
          },
          {
            text: completed + ' of ' + total + ' steps completed (' + percentage + '%)',
            fontSize: 14,
            bold: true,
            color: percentage === 100 ? '#22c55e' : '#0066ff',
            margin: [0, 0, 0, 15]
          },

          // Diagnostic Workflow
          {
            text: 'Diagnostic Workflow',
            style: 'sectionHeader',
            margin: [0, 0, 0, 10]
          },
          {
            table: {
              headerRows: 1,
              widths: [30, 25, '*', '*'],
              body: stepsTableBody
            },
            layout: {
              fillColor: function(rowIndex) {
                return rowIndex === 0 ? '#0066ff' : (rowIndex % 2 === 0 ? '#f8f8f8' : null);
              },
              hLineWidth: function() { return 0.5; },
              vLineWidth: function() { return 0; },
              hLineColor: function() { return '#e0e0e0'; }
            },
            margin: [0, 0, 0, 15]
          },

          // Parts Request Section (if any)
          ...(partsRequest.length > 0 ? [
            {
              text: 'Parts & Labor Request',
              style: 'partsTitle',
              margin: [0, 20, 0, 10]
            },
            {
              table: {
                headerRows: 1,
                widths: ['*', 80, 80],
                body: partsTableBody
              },
              layout: {
                fillColor: function(rowIndex) {
                  return rowIndex === 0 ? '#dcfce7' : (rowIndex % 2 === 0 ? '#f9fafb' : null);
                },
                hLineWidth: function(i) {
                  return i === 1 ? 2 : 0.5;
                },
                vLineWidth: function() { return 0; },
                hLineColor: function(i) {
                  return i === 1 ? '#86efac' : '#e5e7eb';
                }
              },
              margin: [0, 0, 0, 10]
            },
            {
              text: [
                { text: 'Summary: ', bold: true },
                partsCount + ' parts (' + inStockCount + ' in stock, ' + toOrderCount + ' to order) | ' + laborCount + ' labor items'
              ],
              color: '#166534',
              fontSize: 10,
              margin: [0, 0, 0, 15]
            }
          ] : [])
        ],

        styles: {
          headerTitle: {
            fontSize: 24,
            bold: true,
            color: '#0066ff'
          },
          headerShop: {
            fontSize: 12,
            bold: true,
            color: '#333333'
          },
          sectionHeader: {
            fontSize: 14,
            bold: true,
            color: '#0066ff'
          },
          tableHeader: {
            bold: true,
            fontSize: 10,
            color: 'white',
            fillColor: '#0066ff'
          },
          partsTitle: {
            fontSize: 14,
            bold: true,
            color: '#166534'
          },
          partsHeader: {
            bold: true,
            fontSize: 10,
            color: '#166534'
          }
        },

        defaultStyle: {
          font: 'Roboto',
          fontSize: 10
        }
      };

      // Generate PDF using Node.js printer (NOT browser createPdf)
      const pdfDoc = printer.createPdfKitDocument(docDefinition);
      const chunks = [];
      
      pdfDoc.on('data', chunk => chunks.push(chunk));
      pdfDoc.on('end', () => {
        console.log('PDF generated successfully');
        resolve(Buffer.concat(chunks));
      });
      pdfDoc.on('error', err => {
        console.error('PDF stream error:', err);
        reject(err);
      });
      
      pdfDoc.end();

    } catch (error) {
      console.error('PDF generation error:', error);
      reject(error);
    }
  });
}

// Submit Report Endpoint
app.post('/api/submit-report', async (req, res) => {
  // 60 second timeout for the whole operation
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      console.error('Submit report timed out after 60s');
      res.status(504).json({ success: false, error: 'Request timed out. Please try again.' });
    }
  }, 60000);

  try {
    const { reportData, recipientEmail, recipients, email } = req.body;

    if (!resend) {
      clearTimeout(timeout);
      return res.status(500).json({ success: false, error: 'Email service not configured' });
    }

    console.log('Generating PDF report...');
    const pdfBuffer = await generatePDFReport(reportData);
    console.log('PDF generated, size:', pdfBuffer.length, 'bytes');
    
    const v = reportData.vehicleInfo || {};
    const filename = `DiagFlow_Report_${v.year || 'Vehicle'}_${v.make || ''}_${v.model || ''}_${Date.now()}.pdf`;

    // Support multiple input formats: recipients array, recipientEmail string, or email string
    let emailList = [];
    
    if (Array.isArray(recipients) && recipients.length > 0) {
      emailList = recipients.map(e => e.trim()).filter(e => e);
    } else if (recipientEmail) {
      emailList = recipientEmail.split(',').map(e => e.trim()).filter(e => e);
    } else if (email) {
      emailList = email.split(',').map(e => e.trim()).filter(e => e);
    }

    if (emailList.length === 0) {
      clearTimeout(timeout);
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
                  <strong>${part.partName || part.name || 'Unnamed Part'}</strong>
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
      const errors = results.filter(r => r.status === 'rejected').map(r => r.reason?.message || 'Unknown error');
      console.warn(`Email sending: ${successful} successful, ${failed} failed`, errors);
    } else {
      console.log(`All ${successful} emails sent successfully!`);
    }
    
    clearTimeout(timeout);
    res.json({ 
      success: true, 
      sent: successful,
      failed: failed,
      recipients: emailList
    });

  } catch (error) {
    clearTimeout(timeout);
    console.error('Submit report error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: error.message });
    }
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

// =============================================
// AI DIAGNOSTIC ANALYSIS ENDPOINT
// =============================================
app.post('/api/ai-analysis', async (req, res) => {
  try {
    if (!anthropic) {
      return res.status(500).json({ 
        success: false, 
        error: 'AI service not configured. Please add ANTHROPIC_API_KEY to environment variables.' 
      });
    }

    const { reportData } = req.body;
    const v = reportData.vehicleInfo || {};
    const steps = reportData.steps || [];
    const partsRequest = reportData.partsRequest || [];
    
    const completedSteps = steps.filter(s => s.completed);
    const stepsWithNotes = steps.filter(s => s.notes && s.notes.trim());
    const stepsWithImages = steps.filter(s => s.images && s.images.length > 0);
    
    const diagnosticSummary = stepsWithNotes.map(s => 
      `Step ${s.id} (${s.title}): ${s.notes}`
    ).join('\n\n');

    const partsListText = partsRequest.length > 0 
      ? partsRequest.map(p => `- ${p.partName || p.name}${p.partNumber ? ` (P/N: ${p.partNumber})` : ''}${p.inStock ? ' [In Stock]' : ' [Needs Order]'}`).join('\n')
      : 'No parts requested yet.';

    const systemPrompt = `You are an expert ASE Master Certified automotive diagnostic technician with 45+ years of experience. You specialize in systematic diagnosis using the "Never Miss A Step" 15-step methodology.

Your role is to analyze diagnostic findings from other technicians and provide:
1. Confirmation or questions about the diagnosis path
2. Potential root causes they may have missed
3. Common failures for this specific vehicle/symptom
4. Recommended next steps or additional tests
5. Any safety concerns or critical issues

Be direct and technical - you're talking to fellow technicians. Use proper terminology. Reference TSBs or common issues when relevant. If the notes are sparse, ask clarifying questions about what tests were performed.

Format your response clearly with sections. Be helpful but also challenge assumptions if the diagnostic path seems incomplete.`;

    const userMessage = `Please analyze this diagnostic case:

**VEHICLE INFORMATION:**
- Year/Make/Model: ${v.year || 'Unknown'} ${v.make || 'Unknown'} ${v.model || 'Unknown'}
- VIN: ${v.vin || 'Not provided'}
- Mileage: ${v.mileage || 'Not recorded'}
- RO#: ${v.roNumber || 'N/A'}

**DIAGNOSTIC PROGRESS:**
- Steps Completed: ${completedSteps.length} of ${steps.length}
- Steps with Documentation: ${stepsWithNotes.length}
- Steps with Photos: ${stepsWithImages.length}

**TECHNICIAN'S FINDINGS:**
${diagnosticSummary || 'No notes recorded in diagnostic steps.'}

**PARTS IDENTIFIED:**
${partsListText}

---

Based on this information, please provide your analysis. If the documentation is sparse, ask what specific tests or observations the tech has made. If there's enough info, provide your diagnostic insights and recommendations.`;

    console.log('AI Analysis requested for:', `${v.year} ${v.make} ${v.model}`);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userMessage }
      ]
    });

    const analysisText = message.content[0].text;
    
    console.log('AI Analysis completed successfully');
    
    res.json({ 
      success: true, 
      analysis: analysisText,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens
      }
    });

  } catch (error) {
    console.error('AI Analysis error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'AI analysis failed. Please try again.' 
    });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: 'V49', 
    auth: 'enabled',
    ai: anthropic ? 'configured' : 'not configured',
    email: resend ? 'configured' : 'not configured'
  });
});

// Serve frontend (catch-all - must be last)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('');
  console.log('==============================================');
  console.log('  DiagFlow V49 Server');
  console.log('==============================================');
  console.log('  Port:', PORT);
  console.log('  Auth: Enabled');
  console.log('  AI:', anthropic ? 'Configured (Claude)' : 'Not configured');
  console.log('  Email:', process.env.RESEND_API_KEY ? 'Configured' : 'Not configured');
  console.log('  From:', FROM_EMAIL);
  console.log('  Support:', SUPPORT_EMAIL);
  console.log('  Tasks: /tasks (no auth)');
  console.log('==============================================');
  console.log('');
});
