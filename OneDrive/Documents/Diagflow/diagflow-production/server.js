const express = require('express');
const cors = require('cors');
const { Resend } = require('resend');
const PDFDocument = require('pdfkit');
const path = require('path');
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const VERSION = 'V49 Pro';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// =============================================
// SUPABASE CONFIGURATION
// =============================================
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qafmmnwjgzlssogsipua.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhZm1tbndqZ3psc3NvZ3NpcHVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MTA0MDgsImV4cCI6MjA4MzI4NjQwOH0.67M7Ea2lDXK4bYRsPuZ0fagb4RtHAn5A2cAyBWV8TcQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
console.log('Supabase connected');

// =============================================
// AUTH CONFIGURATION
// =============================================
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const FALLBACK_PASSWORD = process.env.BETA_PASSWORD || 'diagflow2024';

// Anthropic AI Configuration
let anthropic = null;
if (process.env.ANTHROPIC_API_KEY) {
  anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  console.log('Anthropic AI configured successfully');
} else {
  console.warn('ANTHROPIC_API_KEY not set - AI analysis disabled');
}

// JWT Token Functions
function generateToken(data) {
  const payload = JSON.stringify({ ...data, exp: Date.now() + (7 * 24 * 60 * 60 * 1000) });
  const encoded = Buffer.from(payload).toString('base64');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(encoded).digest('hex');
  return encoded + '.' + signature;
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

// =============================================
// AUTH ENDPOINTS (Multi-Org)
// =============================================
app.post('/api/auth/login', async (req, res) => {
  const { password } = req.body;
  
  try {
    // Look up organization by password
    const { data: org, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('beta_password', password)
      .single();
    
    if (error || !org) {
      // Fallback to env password for backwards compatibility
      if (password === FALLBACK_PASSWORD) {
        const token = generateToken({ 
          user: 'beta', 
          orgId: null,
          orgName: 'DiagFlow Beta',
          loginTime: Date.now() 
        });
        console.log('Login successful (fallback)');
        return res.json({ 
          success: true, 
          token,
          organization: {
            id: null,
            name: 'DiagFlow Beta',
            advisorEmails: [],
            fromEmail: process.env.FROM_EMAIL || 'onboarding@resend.dev'
          }
        });
      }
      
      console.log('Login failed - invalid password');
      return res.json({ success: false, error: 'Invalid password' });
    }
    
    // Success - create token with org info
    const token = generateToken({ 
      user: org.slug, 
      orgId: org.id,
      orgName: org.name,
      loginTime: Date.now() 
    });
    
    console.log('Login successful:', org.name);
    
    res.json({ 
      success: true, 
      token,
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        advisorEmails: org.advisor_emails || [],
        fromEmail: org.from_email || process.env.FROM_EMAIL || 'onboarding@resend.dev',
        settings: org.settings || {}
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.json({ success: false, error: 'Login failed' });
  }
});

app.get('/api/auth/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.json({ valid: false });
  }
  const token = authHeader.substring(7);
  const payload = verifyToken(token);
  
  if (payload) {
    res.json({ 
      valid: true, 
      user: payload.user,
      orgId: payload.orgId,
      orgName: payload.orgName
    });
  } else {
    res.json({ valid: false });
  }
});

// =============================================
// ORGANIZATION ENDPOINTS
// =============================================
app.get('/api/organization/:id', async (req, res) => {
  try {
    const { data: org, error } = await supabase
      .from('organizations')
      .select('id, name, slug, from_email, advisor_emails, settings')
      .eq('id', req.params.id)
      .single();
    
    if (error || !org) {
      return res.status(404).json({ success: false, error: 'Organization not found' });
    }
    
    res.json({
      success: true,
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        advisorEmails: org.advisor_emails || [],
        fromEmail: org.from_email,
        settings: org.settings || {}
      }
    });
  } catch (error) {
    console.error('Get organization error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================
// REPORTS ENDPOINTS (Org-Scoped)
// =============================================
app.post('/api/reports/save', async (req, res) => {
  try {
    const { reportData, orgId } = req.body;
    
    const record = {
      org_id: orgId || null,
      shop_name: reportData.shopName,
      technician_name: reportData.technicianName,
      vehicle_year: reportData.vehicleInfo?.year,
      vehicle_make: reportData.vehicleInfo?.make,
      vehicle_model: reportData.vehicleInfo?.model,
      vehicle_vin: reportData.vehicleInfo?.vin,
      ro_number: reportData.vehicleInfo?.roNumber,
      mileage: reportData.vehicleInfo?.mileage,
      completed_steps: reportData.completedSteps || [],
      step_notes: reportData.stepNotes || {},
      step_images: reportData.stepImages || {},
      parts_request: reportData.partsRequest || [],
      status: reportData.status || 'active',
      updated_at: new Date().toISOString()
    };
    
    let result;
    if (reportData.id) {
      // Update existing
      const { data, error } = await supabase
        .from('reports')
        .update(record)
        .eq('id', reportData.id)
        .select()
        .single();
      
      if (error) throw error;
      result = data;
    } else {
      // Insert new
      record.created_at = new Date().toISOString();
      const { data, error } = await supabase
        .from('reports')
        .insert(record)
        .select()
        .single();
      
      if (error) throw error;
      result = data;
    }
    
    res.json({ success: true, report: result });
  } catch (error) {
    console.error('Save report error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/reports/active', async (req, res) => {
  try {
    const orgId = req.query.orgId;
    
    let query = supabase
      .from('reports')
      .select('*')
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(1);
    
    if (orgId) {
      query = query.eq('org_id', orgId);
    }
    
    const { data, error } = await query.single();
    
    if (error && error.code !== 'PGRST116') throw error;
    
    res.json({ success: true, report: data || null });
  } catch (error) {
    console.error('Get active report error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/reports/archived/list', async (req, res) => {
  try {
    const orgId = req.query.orgId;
    
    let query = supabase
      .from('reports')
      .select('*')
      .eq('status', 'archived')
      .order('updated_at', { ascending: false });
    
    // Filter by org if provided
    if (orgId) {
      query = query.eq('org_id', orgId);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    res.json({ success: true, reports: data || [] });
  } catch (error) {
    console.error('List archived reports error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/reports/:id/archive', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('reports')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ success: true, report: data });
  } catch (error) {
    console.error('Archive report error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/reports/:id/restore', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('reports')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ success: true, report: data });
  } catch (error) {
    console.error('Restore report error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/reports/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('reports')
      .delete()
      .eq('id', req.params.id);
    
    if (error) throw error;
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete report error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================
// RESEND EMAIL SETUP
// =============================================
let resend = null;
if (process.env.RESEND_API_KEY) {
  resend = new Resend(process.env.RESEND_API_KEY);
  console.log('Resend configured successfully');
} else {
  console.warn('RESEND_API_KEY not set');
}

const DEFAULT_FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@example.com';

// =============================================
// TASK MANAGER ROUTE (no auth required)
// =============================================
app.get('/tasks', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tasks.html'));
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
      const total = reportData.totalSteps || 13;
      const percentage = Math.round((completed / total) * 100);

      doc.fillColor('#0066ff')
         .fontSize(12)
         .font('Helvetica-Bold')
         .text('DIAGNOSTIC PROGRESS', 50, doc.y);

      doc.y += 18;

      doc.fillColor('#333333')
         .fontSize(11)
         .font('Helvetica')
         .text(completed + ' of ' + total + ' steps completed (' + Math.min(percentage, 100) + '%)', 50, doc.y);

      doc.y += 25;

      // ============ STEPS ============
      doc.fillColor('#0066ff')
         .fontSize(12)
         .font('Helvetica-Bold')
         .text('DIAGNOSTIC WORKFLOW', 50, doc.y);

      doc.y += 18;

      const steps = reportData.steps || [];
      
      steps.forEach((step) => {
        if (doc.y > 650) {
          doc.addPage();
          doc.y = 50;
        }

        const isCompleted = step.completed;
        const hasNotes = step.notes && step.notes.trim().length > 0;
        const hasImages = step.images && step.images.length > 0;

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

        // Inline images for this step
        if (hasImages) {
          let imgX = 65;
          let imgY = doc.y;
          let imagesInRow = 0;
          
          step.images.forEach((img) => {
            try {
              const imgData = typeof img === 'string' ? img : (img.url || img.data);
              if (imgData && imgData.startsWith('data:image')) {
                if (imgY > 620) {
                  doc.addPage();
                  imgY = 50;
                  imgX = 65;
                  imagesInRow = 0;
                }
                
                const base64Data = imgData.split(',')[1];
                const imgBuffer = Buffer.from(base64Data, 'base64');
                
                doc.image(imgBuffer, imgX, imgY, { width: 150, height: 100 });
                
                imgX += 160;
                imagesInRow++;
                
                if (imagesInRow >= 3) {
                  imgX = 65;
                  imgY += 110;
                  imagesInRow = 0;
                }
              }
            } catch (imgErr) {
              console.error('Error embedding image:', imgErr.message);
            }
          });
          
          if (imagesInRow > 0) {
            doc.y = imgY + 110;
          } else if (step.images.length > 0) {
            doc.y = imgY;
          }
        }

        doc.y += 6;
      });

      // ============ PARTS REQUEST ============
      const partsRequest = reportData.partsRequest || [];
      console.log('Parts Request received:', JSON.stringify(partsRequest, null, 2));
      
      if (partsRequest.length > 0) {
        if (doc.y > 500) {
          doc.addPage();
          doc.y = 50;
        } else {
          doc.y += 25;
        }

        const partsStartY = doc.y;
        
        doc.fillColor('#166534')
           .fontSize(13)
           .font('Helvetica-Bold')
           .text('Parts & Labor Request', 50, doc.y);

        doc.y += 22;

        const headerY = doc.y;
        doc.fillColor('#dcfce7')
           .rect(50, headerY, pageWidth, 24)
           .fill();
        
        doc.strokeColor('#86efac')
           .lineWidth(2)
           .moveTo(50, headerY + 24)
           .lineTo(50 + pageWidth, headerY + 24)
           .stroke();

        doc.fillColor('#166534')
           .fontSize(10)
           .font('Helvetica-Bold')
           .text('Part/Labor', 58, headerY + 7)
           .text('Type', 320, headerY + 7)
           .text('Stock', 440, headerY + 7);

        doc.y = headerY + 26;

        partsRequest.forEach((part, index) => {
          if (doc.y > 680) {
            doc.addPage();
            doc.y = 50;
          }

          const partName = part.partName || part.name || 'Unnamed Part';
          const partNumber = part.partNumber || '';
          const isLabor = part.laborItem;
          const inStock = part.inStock;
          const rowHeight = partNumber ? 36 : 24;
          const rowY = doc.y;

          if (index % 2 === 0) {
            doc.fillColor('#f9fafb')
               .rect(50, rowY, pageWidth, rowHeight)
               .fill();
          }

          doc.fillColor('#111827')
             .fontSize(10)
             .font('Helvetica-Bold')
             .text(partName, 58, rowY + 6, { width: 250 });
          
          if (partNumber) {
            doc.fillColor('#6b7280')
               .fontSize(9)
               .font('Helvetica')
               .text('P/N: ' + partNumber, 58, rowY + 20);
          }

          const typeText = isLabor ? 'Labor' : 'Part';
          const typeColor = isLabor ? '#3b82f6' : '#666666';
          doc.fillColor(typeColor)
             .fontSize(10)
             .font('Helvetica-Bold')
             .text(typeText, 320, rowY + 6);

          if (isLabor) {
            doc.fillColor('#9ca3af')
               .fontSize(10)
               .font('Helvetica')
               .text('-', 440, rowY + 6);
          } else {
            const stockText = inStock ? 'In Stock' : 'Order';
            const stockColor = inStock ? '#22c55e' : '#ef4444';
            doc.fillColor(stockColor)
               .fontSize(10)
               .font('Helvetica-Bold')
               .text(stockText, 440, rowY + 6);
          }

          doc.strokeColor('#e5e7eb')
             .lineWidth(0.5)
             .moveTo(50, rowY + rowHeight)
             .lineTo(50 + pageWidth, rowY + rowHeight)
             .stroke();

          doc.y = rowY + rowHeight;
        });

        doc.y += 10;
        const partsCount = partsRequest.filter(p => !p.laborItem).length;
        const inStockCount = partsRequest.filter(p => !p.laborItem && p.inStock).length;
        const toOrderCount = partsRequest.filter(p => !p.laborItem && !p.inStock).length;
        const laborCount = partsRequest.filter(p => p.laborItem).length;
        
        doc.fillColor('#166534')
           .fontSize(10)
           .font('Helvetica-Bold')
           .text('Summary: ', 58, doc.y, { continued: true })
           .font('Helvetica')
           .text(partsCount + ' parts (' + inStockCount + ' in stock, ' + toOrderCount + ' to order) | ' + laborCount + ' labor items');
        
        doc.y += 20;
      }

      // ============ FUEL TRIMS SECTION ============
      const fuelTrims = reportData.fuelTrims;
      const postRepairTrims = reportData.postRepairTrims;
      const hasPreTrims = fuelTrims && (fuelTrims.idle?.stftB1 || fuelTrims.idle?.ltftB1);
      const hasPostTrims = postRepairTrims && (postRepairTrims.idle?.stftB1 || postRepairTrims.idle?.ltftB1);
      
      if (hasPreTrims || hasPostTrims) {
        if (doc.y > 500) {
          doc.addPage();
          doc.y = 50;
        } else {
          doc.y += 15;
        }

        doc.fillColor('#0066ff')
           .fontSize(13)
           .font('Helvetica-Bold')
           .text('Fuel Trim Data', 50, doc.y);
        doc.y += 20;

        // Helper function to render a trim table
        const renderTrimTable = (trims, title, color, headerBg, headerText) => {
          // Page overflow guard
          if (doc.y > 580) { doc.addPage(); doc.y = 50; }

          // Section title — lineBreak:false so PDFKit doesn't advance doc.y
          const titleY = doc.y;
          doc.fillColor(color).fontSize(11).font('Helvetica-Bold')
             .text(title, 50, titleY, { lineBreak: false });
          doc.y = titleY + 16;

          // Column layout
          const tableX = 50;
          const tableW = pageWidth;
          const col0W  = 120;
          const valW   = Math.floor((tableW - col0W) / 4);
          const col0X  = tableX;
          const col1X  = tableX + col0W;
          const col2X  = col1X + valW;
          const col3X  = col2X + valW;
          const col4X  = col3X + valW;
          const rowH   = 22;

          // ---- HEADER ROW ----
          const hdrY = doc.y;
          doc.fillColor(headerBg).rect(tableX, hdrY, tableW, rowH).fill();
          doc.strokeColor(color).lineWidth(1)
             .moveTo(tableX, hdrY + rowH).lineTo(tableX + tableW, hdrY + rowH).stroke();

          // All header text pinned to hdrY — lineBreak:false prevents doc.y drift
          doc.fillColor(headerText).fontSize(9).font('Helvetica-Bold');
          doc.text('Condition', col0X + 4, hdrY + 7, { width: col0W - 6, lineBreak: false });
          doc.text('STFT B1',   col1X,     hdrY + 7, { width: valW, align: 'center', lineBreak: false });
          doc.text('LTFT B1',   col2X,     hdrY + 7, { width: valW, align: 'center', lineBreak: false });
          doc.text('STFT B2',   col3X,     hdrY + 7, { width: valW, align: 'center', lineBreak: false });
          doc.text('LTFT B2',   col4X,     hdrY + 7, { width: valW, align: 'center', lineBreak: false });
          doc.y = hdrY + rowH;

          // ---- DATA ROWS ----
          const rows = [
            { label: 'Idle',           data: trims.idle          || {} },
            { label: 'Light Throttle', data: trims.lightThrottle || {} },
            { label: 'Loaded',         data: trims.loaded        || {} }
          ];

          const trimColor = (val) => {
            const n = parseFloat(val);
            if (isNaN(n) || val === '' || val === undefined) return '#555555';
            if (Math.abs(n) > 10) return '#dc2626';
            if (Math.abs(n) > 5)  return '#d97706';
            return '#16a34a';
          };
          const fmt = (val) => (val !== undefined && val !== null && val !== '') ? val + '%' : '-';

          rows.forEach((row, idx) => {
            const rowY = doc.y; // pin Y — this stops the stairstepping

            if (idx % 2 === 0) {
              doc.fillColor('#f9fafb').rect(tableX, rowY, tableW, rowH).fill();
            }

            doc.fillColor('#111827').fontSize(9).font('Helvetica-Bold');
            doc.text(row.label, col0X + 4, rowY + 7, { width: col0W - 6, lineBreak: false });

            const keys = ['stftB1', 'ltftB1', 'stftB2', 'ltftB2'];
            const xPos = [col1X, col2X, col3X, col4X];
            keys.forEach((key, ci) => {
              const val = row.data[key];
              doc.fillColor(trimColor(val)).fontSize(9).font('Helvetica-Bold');
              doc.text(fmt(val), xPos[ci], rowY + 7, { width: valW, align: 'center', lineBreak: false });
            });

            doc.strokeColor('#e5e7eb').lineWidth(0.5)
               .moveTo(tableX, rowY + rowH).lineTo(tableX + tableW, rowY + rowH).stroke();

            doc.y = rowY + rowH; // advance exactly one row
          });

          // Bottom border
          doc.strokeColor(color).lineWidth(1)
             .moveTo(tableX, doc.y).lineTo(tableX + tableW, doc.y).stroke();

          // Legend — plain ASCII, no special chars
          const legendY = doc.y + 5;
          doc.fillColor('#6b7280').fontSize(8).font('Helvetica');
          doc.text('Good: +/-5%   Marginal: +/-10%   Problem: >+/-10%   (B2 = V6/V8 only)',
                   tableX, legendY, { width: tableW, lineBreak: false });
          doc.y = legendY + 14;
        };

        if (hasPreTrims) {
          renderTrimTable(fuelTrims, 'Pre-Repair Fuel Trims  —  Step 2', '#16a34a', '#dcfce7', '#166534');
        }
        if (hasPostTrims) {
          if (hasPreTrims) doc.y += 8;
          renderTrimTable(postRepairTrims, 'Post-Repair Fuel Trims  —  Step 13', '#ea580c', '#ffedd5', '#9a3412');
        }
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

// =============================================
// SUBMIT REPORT ENDPOINT (Multi-Org)
// =============================================
app.post('/api/submit-report', async (req, res) => {
  console.log('=== SUBMIT REPORT STARTED ===');
  try {
    const { reportData, recipientEmail, recipients, email, orgId } = req.body;
    console.log('Recipients:', recipients || recipientEmail || email);
    console.log('OrgId:', orgId);

    if (!resend) {
      console.log('ERROR: Resend not configured');
      return res.status(500).json({ success: false, error: 'Email service not configured' });
    }

    // Get org-specific from_email if orgId provided
    let fromEmail = DEFAULT_FROM_EMAIL;
    if (orgId) {
      const { data: org } = await supabase
        .from('organizations')
        .select('from_email')
        .eq('id', orgId)
        .single();
      
      if (org && org.from_email) {
        fromEmail = org.from_email;
      }
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
    console.log('From:', fromEmail);

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
      '<p style="margin: 0; font-size: 18px;"><strong>' + (reportData.completedSteps || 0) + '</strong> of <strong>' + (reportData.totalSteps || 13) + '</strong> steps completed</p>' +
      '</div>' +
      partsHtml +
      '<p style="margin-top: 20px; color: #666;">Please find the complete diagnostic report attached as a PDF.</p>' +
      '</div>' +
      '<div style="background: #333; padding: 15px; text-align: center;">' +
      '<p style="color: #999; margin: 0; font-size: 12px;">Generated by DiagFlow | Never Miss A Step</p>' +
      '</div></div>';

    const result = await resend.emails.send({
      from: fromEmail,
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
      from: DEFAULT_FROM_EMAIL,
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
    version: VERSION, 
    auth: 'enabled',
    multiOrg: 'enabled',
    ai: anthropic ? 'configured' : 'not configured',
    email: resend ? 'configured' : 'not configured',
    supabase: 'connected'
  });
});

// Explicit sw.js route — must come BEFORE catch-all
// Serves from public/ if it exists, otherwise serves a minimal no-op SW
// This prevents the catch-all from returning index.html with text/html MIME
app.get('/sw.js', (req, res) => {
  const swPath = path.join(__dirname, 'public', 'sw.js');
  if (require('fs').existsSync(swPath)) {
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Service-Worker-Allowed', '/');
    res.sendFile(swPath);
  } else {
    // Minimal no-op SW so the browser stops throwing the MIME error
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Service-Worker-Allowed', '/');
    res.send(`
// DiagFlow Service Worker
const CACHE = 'diagflow-v49';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  // Network-first: always try network, fall back to cache
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
    `.trim());
  }
});

// Explicit manifest.json route with correct MIME type
app.get('/manifest.json', (req, res) => {
  const manifestPath = path.join(__dirname, 'public', 'manifest.json');
  if (require('fs').existsSync(manifestPath)) {
    res.setHeader('Content-Type', 'application/manifest+json');
    res.sendFile(manifestPath);
  } else {
    res.setHeader('Content-Type', 'application/manifest+json');
    res.json({
      name: 'DiagFlow',
      short_name: 'DiagFlow',
      start_url: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#0066ff',
      icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }]
    });
  }
});

// Serve frontend (catch-all - must be last)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('');
  console.log('==============================================');
  console.log('  DiagFlow ' + VERSION + ' Server');
  console.log('  Multi-Organization Support Enabled');
  console.log('==============================================');
  console.log('  Port:', PORT);
  console.log('  Auth: Multi-Org (Supabase)');
  console.log('  AI:', anthropic ? 'Configured (Claude)' : 'Not configured');
  console.log('  Email:', process.env.RESEND_API_KEY ? 'Configured' : 'Not configured');
  console.log('  Supabase: Connected');
  console.log('  Default From:', DEFAULT_FROM_EMAIL);
  console.log('  Support:', SUPPORT_EMAIL);
  console.log('  Tasks: /tasks (no auth)');
  console.log('==============================================');
  console.log('');
});
