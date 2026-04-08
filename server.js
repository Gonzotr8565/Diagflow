const express = require('express');
const cors = require('cors');
const { Resend } = require('resend');
const PDFDocument = require('pdfkit');
const path = require('path');
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');

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

// =============================================
// SCOPE LIBRARY ROUTE (no auth required)
// =============================================
app.get('/scope-library', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'scope-library.html'));
});

// ============ PDF GENERATION (PDFKit) ============
function generatePDFReport(reportData) {
  return new Promise((resolve, reject) => {
    try {
      const chunks = [];
      const doc = new PDFDocument({ 
        size: 'LETTER', 
        margins: { top: 50, bottom: 70, left: 50, right: 50 }
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
      doc.text('Year/Make/Model: ' + vehicleText, 60, boxY + 20);
      doc.text('VIN: ' + (v.vin || 'N/A'), 60, boxY + 35);
      doc.text('Mileage: ' + (v.mileage || 'N/A'), 60, boxY + 50);

      doc.text('RO Number: ' + (v.roNumber || 'N/A'), 320, boxY + 20);
      doc.text('Technician: ' + (techName || 'N/A'), 320, boxY + 35);
      doc.text('Date: ' + new Date().toLocaleDateString(), 320, boxY + 50);

      doc.y = boxY + 85;

      // ============ PROGRESS ============
      const completed = reportData.completedSteps || 0;
      const total = reportData.totalSteps || 15;
      const percentage = Math.round((completed / total) * 100);

      doc.fillColor('#0066ff')
         .fontSize(12)
         .font('Helvetica-Bold')
         .text('DIAGNOSTIC PROGRESS', 50, doc.y);

      doc.y += 18;

      doc.fillColor('#333333')
         .fontSize(11)
         .font('Helvetica')
         .text(completed + ' of ' + total + ' steps completed (' + percentage + '%)', 50, doc.y);

      doc.y += 25;

      // ============ STEPS ============
      doc.fillColor('#0066ff')
         .fontSize(12)
         .font('Helvetica-Bold')
         .text('DIAGNOSTIC WORKFLOW', 50, doc.y);

      doc.y += 18;

      const steps = reportData.steps || [];
      
      steps.forEach((step) => {
        if (doc.y > 680) {
          doc.addPage();
          doc.y = 50;
        }

        const isCompleted = step.completed;
        const hasNotes = step.notes && step.notes.trim().length > 0;

        const statusIcon = isCompleted ? '✓' : '○';
        const statusColor = isCompleted ? '#22c55e' : '#999999';
        
        doc.fillColor(statusColor)
           .fontSize(10)
           .font('Helvetica-Bold')
           .text(statusIcon + ' Step ' + step.id + ': ' + step.title, 50, doc.y);
        
        doc.y += 14;

        if (hasNotes) {
          doc.fillColor('#333333')
             .fontSize(9)
             .font('Helvetica')
             .text('Notes: ' + step.notes, 65, doc.y, { width: pageWidth - 30 });
          doc.y += 14;
        }

        doc.y += 4;
      });

      // ============ PARTS REQUEST ============
      const partsRequest = reportData.partsRequest || [];
      console.log('Parts Request received:', JSON.stringify(partsRequest, null, 2));
      
      if (partsRequest.length > 0) {
        if (doc.y > 550) {
          doc.addPage();
          doc.y = 50;
        } else {
          doc.y += 20;
        }

        doc.fillColor('#166534')
           .fontSize(12)
           .font('Helvetica-Bold')
           .text('PARTS & LABOR REQUEST', 50, doc.y);

        doc.y += 18;

        // Table header
        doc.fillColor('#dcfce7')
           .rect(50, doc.y, pageWidth, 20)
           .fill();

        doc.fillColor('#166534')
           .fontSize(9)
           .font('Helvetica-Bold')
           .text('Part/Labor', 55, doc.y + 6)
           .text('Type', 300, doc.y + 6)
           .text('Stock', 420, doc.y + 6);

        doc.y += 20;

        partsRequest.forEach((part) => {
          if (doc.y > 700) {
            doc.addPage();
            doc.y = 50;
          }

          const partName = part.partName || part.name || 'Unnamed Part';
          const partNumber = part.partNumber || '';
          const isLabor = part.laborItem;
          const inStock = part.inStock;

          doc.fillColor('#333333')
             .fontSize(9)
             .font('Helvetica-Bold')
             .text(partName, 55, doc.y);
          
          if (partNumber) {
            doc.fillColor('#666666')
               .fontSize(8)
               .font('Helvetica')
               .text('P/N: ' + partNumber, 55, doc.y + 10);
          }

          doc.fillColor(isLabor ? '#3b82f6' : '#666666')
             .fontSize(9)
             .font('Helvetica')
             .text(isLabor ? 'Labor' : 'Part', 300, doc.y);

          if (isLabor) {
            doc.fillColor('#999999')
               .text('-', 420, doc.y);
          } else {
            doc.fillColor(inStock ? '#22c55e' : '#ef4444')
               .font('Helvetica-Bold')
               .text(inStock ? 'In Stock' : 'Order', 420, doc.y);
          }

          doc.y += partNumber ? 22 : 14;
        });

        // Summary
        doc.y += 8;
        const partsCount = partsRequest.filter(p => !p.laborItem).length;
        const inStockCount = partsRequest.filter(p => !p.laborItem && p.inStock).length;
        const toOrderCount = partsRequest.filter(p => !p.laborItem && !p.inStock).length;
        const laborCount = partsRequest.filter(p => p.laborItem).length;
        
        doc.fillColor('#166534')
           .fontSize(9)
           .font('Helvetica-Bold')
           .text('Summary: ' + partsCount + ' parts (' + inStockCount + ' in stock, ' + toOrderCount + ' to order) | ' + laborCount + ' labor items', 50, doc.y);
      }

      // ============ FOOTER ============
      doc.fillColor('#666666')
         .fontSize(8)
         .font('Helvetica')
         .text(
           'Generated by DiagFlow | Never Miss A Step | ' + new Date().toLocaleString(),
           50,
           doc.page.height - 40,
           { align: 'center', width: doc.page.width - 100 }
         );

      doc.end();
    } catch (error) {
      console.error('PDF generation error:', error);
      reject(error);
    }
  });
}

// Submit Report Endpoint
app.post('/api/submit-report', async (req, res) => {
  console.log('=== SUBMIT REPORT STARTED ===');
  try {
    const { reportData, recipientEmail, recipients, email } = req.body;
    console.log('Recipients:', recipients || recipientEmail || email);

    if (!resend) {
      console.log('ERROR: Resend not configured');
      return res.status(500).json({ success: false, error: 'Email service not configured' });
    }

    console.log('Generating PDF...');
    const pdfBuffer = await generatePDFReport(reportData);
    console.log('PDF generated, size:', pdfBuffer.length);
    
    const v = reportData.vehicleInfo || {};
    const filename = 'DiagFlow_Report_' + (v.year || 'Vehicle') + '_' + (v.make || '') + '_' + (v.model || '') + '_' + Date.now() + '.pdf';

    // Support multiple input formats
    let emailList = [];
    
    if (Array.isArray(recipients) && recipients.length > 0) {
      emailList = recipients.map(e => e.trim()).filter(e => e);
    } else if (recipientEmail) {
      emailList = recipientEmail.split(',').map(e => e.trim()).filter(e => e);
    } else if (email) {
      emailList = email.split(',').map(e => e.trim()).filter(e => e);
    }

    if (emailList.length === 0) {
      return res.status(400).json({ success: false, error: 'No recipient email provided' });
    }

    console.log('Sending email to:', emailList);

    // Build parts HTML
    let partsHtml = '';
    if (reportData.partsRequest && reportData.partsRequest.length > 0) {
      partsHtml = '<div style="margin-top: 20px; padding: 15px; background: #f0fff4; border-radius: 8px; border: 1px solid #86efac;">' +
        '<h3 style="margin: 0 0 10px 0; color: #166534;">Parts & Labor Request</h3>' +
        '<table style="width: 100%; border-collapse: collapse; font-size: 12px;">' +
        '<tr style="background: #dcfce7;">' +
        '<th style="padding: 8px; text-align: left; border-bottom: 2px solid #86efac;">Part/Labor</th>' +
        '<th style="padding: 8px; text-align: center; border-bottom: 2px solid #86efac;">Type</th>' +
        '<th style="padding: 8px; text-align: center; border-bottom: 2px solid #86efac;">Stock</th>' +
        '</tr>' +
        reportData.partsRequest.map(function(part) {
          var partName = part.partName || part.name || 'Unnamed Part';
          var partNumber = part.partNumber ? '<br><span style="color: #666; font-size: 11px;">P/N: ' + part.partNumber + '</span>' : '';
          var typeText = part.laborItem ? 'Labor' : 'Part';
          var typeColor = part.laborItem ? '#3b82f6' : '#666';
          var stockText = part.laborItem ? '-' : (part.inStock ? 'In Stock' : 'Order');
          var stockColor = part.laborItem ? '#999' : (part.inStock ? '#22c55e' : '#ef4444');
          
          return '<tr>' +
            '<td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><strong>' + partName + '</strong>' + partNumber + '</td>' +
            '<td style="padding: 8px; text-align: center; border-bottom: 1px solid #e5e7eb;"><span style="color: ' + typeColor + '; font-weight: bold;">' + typeText + '</span></td>' +
            '<td style="padding: 8px; text-align: center; border-bottom: 1px solid #e5e7eb;"><span style="color: ' + stockColor + '; font-weight: bold;">' + stockText + '</span></td>' +
            '</tr>';
        }).join('') +
        '</table>' +
        '<p style="margin: 10px 0 0 0; font-size: 12px; color: #166534;">' +
        '<strong>Summary:</strong> ' + 
        reportData.partsRequest.filter(function(p) { return !p.laborItem; }).length + ' parts (' +
        reportData.partsRequest.filter(function(p) { return !p.laborItem && p.inStock; }).length + ' in stock, ' +
        reportData.partsRequest.filter(function(p) { return !p.laborItem && !p.inStock; }).length + ' to order) | ' +
        reportData.partsRequest.filter(function(p) { return p.laborItem; }).length + ' labor items' +
        '</p></div>';
    }

    const emailHtml = '<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">' +
      '<div style="background: linear-gradient(135deg, #0066ff, #0052cc); padding: 20px; text-align: center;">' +
      '<h1 style="color: white; margin: 0;">DiagFlow Report</h1>' +
      '<p style="color: #99ccff; margin: 5px 0 0 0;">Professional Diagnostic Workflow</p>' +
      '</div>' +
      '<div style="padding: 20px; background: #f5f5f5;">' +
      '<h2 style="color: #333; margin-top: 0;">Vehicle Information</h2>' +
      '<table style="width: 100%; background: white; border-radius: 8px; overflow: hidden;">' +
      '<tr><td style="padding: 10px; font-weight: bold; background: #f0f0f0;">Year/Make/Model</td>' +
      '<td style="padding: 10px;">' + (v.year || '') + ' ' + (v.make || '') + ' ' + (v.model || '') + '</td></tr>' +
      '<tr><td style="padding: 10px; font-weight: bold; background: #f0f0f0;">VIN</td>' +
      '<td style="padding: 10px;">' + (v.vin || 'N/A') + '</td></tr>' +
      '<tr><td style="padding: 10px; font-weight: bold; background: #f0f0f0;">RO Number</td>' +
      '<td style="padding: 10px;">' + (v.roNumber || 'N/A') + '</td></tr>' +
      '<tr><td style="padding: 10px; font-weight: bold; background: #f0f0f0;">Mileage</td>' +
      '<td style="padding: 10px;">' + (v.mileage || 'N/A') + '</td></tr>' +
      '</table>' +
      '<div style="margin-top: 20px; padding: 15px; background: white; border-radius: 8px;">' +
      '<h3 style="margin: 0 0 10px 0; color: #0066ff;">Progress</h3>' +
      '<p style="margin: 0; font-size: 18px;"><strong>' + (reportData.completedSteps || 0) + '</strong> of <strong>' + (reportData.totalSteps || 15) + '</strong> steps completed</p>' +
      '</div>' +
      partsHtml +
      '<p style="margin-top: 20px; color: #666;">Please find the complete diagnostic report attached as a PDF.</p>' +
      '</div>' +
      '<div style="background: #333; padding: 15px; text-align: center;">' +
      '<p style="color: #999; margin: 0; font-size: 12px;">Generated by DiagFlow | Never Miss A Step</p>' +
      '</div></div>';

    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: emailList,
      subject: 'DiagFlow Report: ' + (v.year || '') + ' ' + (v.make || '') + ' ' + (v.model || '') + ' - RO# ' + (v.roNumber || 'N/A'),
      html: emailHtml,
      attachments: [
        {
          filename: filename,
          content: pdfBuffer.toString('base64')
        }
      ]
    });

    console.log('Email sent successfully:', result);
    res.json({ success: true, messageId: result.id });

  } catch (error) {
    console.error('Submit report error:', error);
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
      'Step ' + s.id + ' (' + s.title + '): ' + s.notes
    ).join('\n\n');

    const partsListText = partsRequest.length > 0 
      ? partsRequest.map(p => '- ' + (p.partName || p.name) + (p.partNumber ? ' (P/N: ' + p.partNumber + ')' : '') + (p.inStock ? ' [In Stock]' : ' [Needs Order]')).join('\n')
      : 'No parts requested yet.';

    const systemPrompt = 'You are an expert ASE Master Certified automotive diagnostic technician with 45+ years of experience. You specialize in systematic diagnosis using the "Never Miss A Step" 15-step methodology.\n\nYour role is to analyze diagnostic findings from other technicians and provide:\n1. Confirmation or questions about the diagnosis path\n2. Potential root causes they may have missed\n3. Common failures for this specific vehicle/symptom\n4. Recommended next steps or additional tests\n5. Any safety concerns or critical issues\n\nBe direct and technical - you are talking to fellow technicians. Use proper terminology. Reference TSBs or common issues when relevant. If the notes are sparse, ask clarifying questions about what tests were performed.\n\nFormat your response clearly with sections. Be helpful but also challenge assumptions if the diagnostic path seems incomplete.';

    const userMessage = 'Please analyze this diagnostic case:\n\n**VEHICLE INFORMATION:**\n- Year/Make/Model: ' + (v.year || 'Unknown') + ' ' + (v.make || 'Unknown') + ' ' + (v.model || 'Unknown') + '\n- VIN: ' + (v.vin || 'Not provided') + '\n- Mileage: ' + (v.mileage || 'Not recorded') + '\n- RO#: ' + (v.roNumber || 'N/A') + '\n\n**DIAGNOSTIC PROGRESS:**\n- Steps Completed: ' + completedSteps.length + ' of ' + steps.length + '\n- Steps with Documentation: ' + stepsWithNotes.length + '\n- Steps with Photos: ' + stepsWithImages.length + '\n\n**TECHNICIAN FINDINGS:**\n' + (diagnosticSummary || 'No notes recorded in diagnostic steps.') + '\n\n**PARTS IDENTIFIED:**\n' + partsListText + '\n\n---\n\nBased on this information, please provide your analysis. If the documentation is sparse, ask what specific tests or observations the tech has made. If there is enough info, provide your diagnostic insights and recommendations.';

    console.log('AI Analysis requested for:', v.year + ' ' + v.make + ' ' + v.model);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [
        { role: 'user', content: userMessage }
      ],
      system: systemPrompt
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

// Support Request Endpoint
app.post('/api/support-request', async (req, res) => {
  try {
    const { reportData, message, techEmail } = req.body;

    if (!resend) {
      return res.status(500).json({ success: false, error: 'Email service not configured' });
    }

    const v = reportData.vehicleInfo || {};
    
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: [SUPPORT_EMAIL],
      replyTo: techEmail,
      subject: 'DiagFlow Help Request: ' + (v.year || '') + ' ' + (v.make || '') + ' ' + (v.model || ''),
      html: '<h2>Help Request</h2><p><strong>From:</strong> ' + techEmail + '</p><p><strong>Vehicle:</strong> ' + (v.year || '') + ' ' + (v.make || '') + ' ' + (v.model || '') + '</p><p><strong>Message:</strong></p><p>' + message + '</p>'
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
  res.json({ 
    status: 'ok', 
    version: 'V48 Pro', 
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
  console.log('  DiagFlow V48 Pro Server');
  console.log('==============================================');
  console.log('  Port:', PORT);
  console.log('  Auth: Enabled');
  console.log('  Password:', BETA_PASSWORD);
  console.log('  AI:', anthropic ? 'Configured (Claude)' : 'Not configured');
  console.log('  Email:', process.env.RESEND_API_KEY ? 'Configured' : 'Not configured');
  console.log('  From:', FROM_EMAIL);
  console.log('  Support:', SUPPORT_EMAIL);
  console.log('  Tasks: /tasks (no auth)');
  console.log('==============================================');
  console.log('');
});
