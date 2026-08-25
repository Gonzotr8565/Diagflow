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
const VERSION = 'V50 Pro';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// =============================================
// SUPABASE CONFIGURATION
// =============================================
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qafmmnwjgzlssogsipua.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhZm1tbndqZ3psc3NvZ3NpcHVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MTA0MDgsImV4cCI6MjA4MzI4NjQwOH0.67M7Ea2lDXK4bYRsPuZ0fagb4RtHAn5A2cAyBWV8TcQ';

const SUPABASE_SERVER_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  SUPABASE_ANON_KEY;

if (
  process.env.NODE_ENV === 'production' &&
  SUPABASE_SERVER_KEY === SUPABASE_ANON_KEY
) {
  throw new Error(
    'A Supabase server secret is required in production.'
  );
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVER_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

console.log(
  `Supabase connected with ${
    SUPABASE_SERVER_KEY === SUPABASE_ANON_KEY
      ? 'local anon fallback'
      : 'server secret'
  }`
);

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
function requireOrganizationAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired authentication'
    });
  }

  if (!payload.orgId) {
    return res.status(403).json({
      success: false,
      error: 'Organization access required'
    });
  }

  req.auth = payload;
  next();
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
app.get(
  '/api/organization/:id',
  requireOrganizationAuth,
  async (req, res) => {
  try {
        if (req.params.id !== req.auth.orgId) {
      return res.status(403).json({
        success: false,
        error: 'Organization access denied'
      });
    }
    const { data: org, error } = await supabase
      .from('organizations')
      .select('id, name, slug, from_email, advisor_emails, settings')
      .eq('id', req.auth.orgId)
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
app.post(
  '/api/reports/save',
  requireOrganizationAuth,
  async (req, res) => {
  try {
  const { reportData } = req.body;
const orgId = req.auth.orgId;
    if (!reportData || !reportData.vehicleInfo) {
      return res.status(400).json({ success: false, error: 'Vehicle information is required.' });
    }

    const incomingVehicle = reportData.vehicleInfo;
    const incomingIdentity = [
      incomingVehicle.year,
      incomingVehicle.make,
      incomingVehicle.model,
      incomingVehicle.vin,
      incomingVehicle.roNumber
    ].map(value => String(value || '').trim());

    if (!incomingIdentity.some(Boolean)) {
      return res.status(400).json({
        success: false,
        error: 'A blank job cannot be saved to the account.'
      });
    }

    const countNotes = notes => Object.entries(notes || {})
      .filter(([key, value]) => !key.startsWith('__diagflow') && String(value || '').trim())
      .length;
    const countImages = images => Object.values(images || {})
      .reduce((total, group) => total + (Array.isArray(group) ? group.length : 0), 0);
    const documentationScore = data =>
      (Array.isArray(data.completed_steps || data.completedSteps) ? (data.completed_steps || data.completedSteps).length : 0) +
      countNotes(data.step_notes || data.stepNotes) +
      countImages(data.step_images || data.stepImages) +
      (Array.isArray(data.parts_request || data.partsRequest) ? (data.parts_request || data.partsRequest).length : 0);

    let existing = null;
    if (reportData.id) {
      const { data: existingReport, error: existingError } = await supabase
        .from('reports')
        .select('org_id, vehicle_year, vehicle_make, vehicle_model, vehicle_vin, ro_number, completed_steps, step_notes, step_images, parts_request')
        .eq('id', reportData.id)
        .maybeSingle();

      if (existingError) throw existingError;
      existing = existingReport;

      if (existing && existing.org_id !== orgId) {
        return res.status(403).json({ success: false, error: 'This report belongs to another organization.' });
      }

      if (existing) {
        const existingIdentity = [
        existing.vehicle_year,
        existing.vehicle_make,
        existing.vehicle_model,
        existing.vehicle_vin,
        existing.ro_number
      ].map(value => String(value || '').trim().toLowerCase());
      const normalizedIncomingIdentity = incomingIdentity.map(value => value.toLowerCase());
      const identityChanged = existingIdentity.some((value, index) =>
        value && value !== normalizedIncomingIdentity[index]
      );

        if (identityChanged) {
        return res.status(409).json({
          success: false,
          error: 'Save blocked because this report ID belongs to a different vehicle or repair order.'
        });
      }

        const existingScore = documentationScore(existing);
        const incomingScore = documentationScore(reportData);
        if (existingScore >= 8 && incomingScore <= 4) {
        return res.status(409).json({
          success: false,
          error: 'Save blocked because a nearly blank job would replace a documented active report.'
        });
        }
      }
    }

    const persistedStepNotes = {
  ...(reportData.stepNotes || {}),
  __diagflowFuelTrims: reportData.fuelTrims || null,
  __diagflowPostRepairTrims:
    reportData.postRepairTrims || null
};
    const record = {
      org_id: orgId,
      shop_name: reportData.shopName,
      technician_name: reportData.technicianName,
      vehicle_year: reportData.vehicleInfo?.year,
      vehicle_make: reportData.vehicleInfo?.make,
      vehicle_model: reportData.vehicleInfo?.model,
      vehicle_vin: reportData.vehicleInfo?.vin,
      ro_number: reportData.vehicleInfo?.roNumber,
      mileage: reportData.vehicleInfo?.mileage,
      completed_steps: [...new Set(reportData.completedSteps || [])],
      step_notes: persistedStepNotes,
      step_images: reportData.stepImages || {},
      parts_request: reportData.partsRequest || [],
      status: reportData.status || 'active',
      updated_at: new Date().toISOString()
    };
    if (reportData.id) record.id = reportData.id;
    
    let result;
    if (reportData.id && existing) {
      // Update existing
      const { data, error } = await supabase
        .from('reports')
        .update(record)
        .eq('id', reportData.id)
        .eq('org_id', orgId)
        .select('id, vehicle_year, vehicle_make, vehicle_model, vehicle_vin, ro_number, completed_steps, updated_at')
        .single();
      if (error) throw error;
      result = data;
    } else {
      // Insert new
      record.created_at = new Date().toISOString();
      const { data, error } = await supabase
        .from('reports')
        .insert(record)
        .select('id, vehicle_year, vehicle_make, vehicle_model, vehicle_vin, ro_number, completed_steps, updated_at')
        .single();
      
      if (error) throw error;
      result = data;
    }
    
    res.json({
      success: true,
      report: result,
      summary: { imageCount: countImages(reportData.stepImages) }
    });
  } catch (error) {
    console.error('Save report error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get(
  '/api/reports/active',
  requireOrganizationAuth,
  async (req, res) => {
  try {
    const orgId = req.auth.orgId;
    
    let query = supabase
      .from('reports')
      // Active-job recovery must return the same technician-authored content that
      // save accepts. Omitting step_images here restores an empty image map, and
      // the next auto-save can overwrite the persisted images.
      .select('id, created_at, updated_at, status, shop_name, technician_name, vehicle_year, vehicle_make, vehicle_model, vehicle_vin, ro_number, mileage, completed_steps, step_notes, step_images, parts_request')
      .eq('status', 'active')
      .eq('org_id', orgId)
      .order('updated_at', { ascending: false })
      .limit(1);
    

    const { data, error } = await query.single();
    
    if (error && error.code !== 'PGRST116') throw error;
    
    res.json({ success: true, report: data || null });
  } catch (error) {
    console.error('Get active report error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.patch(
  '/api/reports/:id/vehicle-info',
  requireOrganizationAuth,
  async (req, res) => {
  try {
    const vehicleInfo = req.body?.vehicleInfo || {};
    const clean = value => String(value ?? '').trim();
    const record = {
      vehicle_year: clean(vehicleInfo.year),
      vehicle_make: clean(vehicleInfo.make),
      vehicle_model: clean(vehicleInfo.model),
      vehicle_vin: clean(vehicleInfo.vin).toUpperCase(),
      ro_number: clean(vehicleInfo.roNumber),
      mileage: clean(vehicleInfo.mileage),
      updated_at: new Date().toISOString()
    };

    if (record.vehicle_vin && record.vehicle_vin.length !== 17) {
      return res.status(400).json({ success: false, error: 'VIN must be 17 characters or blank.' });
    }

    const { data, error } = await supabase
      .from('reports')
      .update(record)
      .eq('id', req.params.id)
      .eq('org_id', req.auth.orgId)
      .select('id, vehicle_year, vehicle_make, vehicle_model, vehicle_vin, ro_number, mileage, updated_at')
      .single();
    if (error) throw error;

    res.json({ success: true, report: data });
  } catch (error) {
    console.error('Update vehicle info error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get(
  '/api/reports/archived/list',
  requireOrganizationAuth,
  async (req, res) => {
  try {
    const orgId = req.auth.orgId;
    
    let query = supabase
      .from('reports')
      .select('*')
      .eq('status', 'archived')
      .eq('org_id', orgId)
      .order('updated_at', { ascending: false });
    
    // Filter by org if provided
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    res.json({ success: true, reports: data || [] });
  } catch (error) {
    console.error('List archived reports error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post(
  '/api/reports/:id/archive',
  requireOrganizationAuth,
  async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('reports')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('org_id', req.auth.orgId)
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ success: true, report: data });
  } catch (error) {
    console.error('Archive report error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post(
  '/api/reports/:id/restore',
  requireOrganizationAuth,
  async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('reports')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('org_id', req.auth.orgId)
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ success: true, report: data });
  } catch (error) {
    console.error('Restore report error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete(
  '/api/reports/:id',
  requireOrganizationAuth,
  async (req, res) => {
  try {
      const { error } = await supabase
      .from('reports')
      .delete()
      .eq('id', req.params.id)
      .eq('org_id', req.auth.orgId);
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

        // Inline images for this step (preview thumbnails - larger, full-res versions in appendix)
        if (hasImages) {
          let imgX = 65;
          let imgY = doc.y;
          let imagesInRow = 0;
          const thumbW = 220, thumbH = 150; // preserves aspect ratio via 'fit', larger & clearer than before

          step.images.forEach((img) => {
            try {
              const imgData = typeof img === 'string' ? img : (img.url || img.data);
              if (imgData && imgData.startsWith('data:image')) {
                if (imgY + thumbH > 700) {
                  doc.addPage();
                  imgY = 50;
                  imgX = 65;
                  imagesInRow = 0;
                }
                
                const base64Data = imgData.split(',')[1];
                const imgBuffer = Buffer.from(base64Data, 'base64');
                
                // 'fit' preserves aspect ratio instead of stretching/distorting the image
                doc.image(imgBuffer, imgX, imgY, { fit: [thumbW, thumbH] });
                doc.strokeColor('#e5e7eb').lineWidth(1).rect(imgX, imgY, thumbW, thumbH).stroke();
                
                imgX += thumbW + 20;
                imagesInRow++;
                
                if (imagesInRow >= 2) {
                  imgX = 65;
                  imgY += thumbH + 15;
                  imagesInRow = 0;
                }
              }
            } catch (imgErr) {
              console.error('Error embedding image:', imgErr.message);
            }
          });
          
          if (imagesInRow > 0) {
            doc.y = imgY + thumbH + 15;
          } else if (step.images.length > 0) {
            doc.y = imgY;
          }
        }

        doc.y += 6;
      });

      // ============ FULL-SIZE IMAGE APPENDIX ============
      // Thumbnails above are sized for quick review; this appendix gives each image
      // full-page width so fine detail (waveforms, scan tool screenshots, etc.) is readable.
      const stepsWithImages = steps.filter(s => s.images && s.images.length > 0);
      if (stepsWithImages.length > 0) {
        doc.addPage();
        doc.fillColor('#0066ff')
           .fontSize(15)
           .font('Helvetica-Bold')
           .text('Appendix: Full-Size Images', 50, 50);
        doc.y = 80;

        stepsWithImages.forEach((step) => {
          step.images.forEach((img, imgIdx) => {
            try {
              const imgData = typeof img === 'string' ? img : (img.url || img.data);
              if (!imgData || !imgData.startsWith('data:image')) return;

              if (doc.y > 680) {
                doc.addPage();
                doc.y = 50;
              }

              doc.fillColor('#374151')
                 .fontSize(10)
                 .font('Helvetica-Bold')
                 .text('Step ' + step.id + ': ' + step.title + (step.images.length > 1 ? ' (' + (imgIdx + 1) + ' of ' + step.images.length + ')' : ''), 50, doc.y);
              doc.y += 16;

              const base64Data = imgData.split(',')[1];
              const imgBuffer = Buffer.from(base64Data, 'base64');
              const fullW = pageWidth; // full content width, aspect ratio preserved via 'fit'
              doc.image(imgBuffer, 50, doc.y, { fit: [fullW, 420] });
              doc.y += 300; // conservative spacing; most captures are landscape scan/scope shots

              if (doc.y > 750) {
                doc.addPage();
                doc.y = 50;
              }
            } catch (imgErr) {
              console.error('Error embedding appendix image:', imgErr.message);
            }
          });
        });
      }

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
          const quantity = part.quantity || 1;
          const displayName = quantity + ' x ' + partName;
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
             .text(displayName, 58, rowY + 6, { width: 250 });
          
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
      // Check ALL conditions (idle, light throttle, loaded) and ALL fields - a tech may only
      // fill in one condition, and a value of "0" is a legitimate real reading, not "empty"
      const trimHasData = (trims) => {
        if (!trims) return false;
        return ['idle', 'lightThrottle', 'loaded'].some(cond => {
          const row = trims[cond];
          if (!row) return false;
          return ['stftB1', 'ltftB1', 'stftB2', 'ltftB2'].some(field => 
            row[field] !== undefined && row[field] !== null && String(row[field]).trim() !== ''
          );
        });
      };
      const hasPreTrims = trimHasData(fuelTrims);
      const hasPostTrims = trimHasData(postRepairTrims);
      
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
               const renderTrimTable = (trims, title, color) => {
          const columns = [
            { label: 'Condition', x: 55, width: 80 },
            { label: 'STFT B1', x: 140, width: 70 },
            { label: 'LTFT B1', x: 220, width: 70 },
            { label: 'STFT B2', x: 300, width: 70 },
            { label: 'LTFT B2', x: 380, width: 70 }
          ];

          const writeCell = (value, column, y, align = 'left') => {
            doc.text(
              String(value),
              column.x,
              y,
              {
                width: column.width,
                align,
                lineBreak: false
              }
            );
          };

          const titleY = doc.y;

          doc.fillColor(color)
             .fontSize(11)
             .font('Helvetica-Bold')
             .text(title, 50, titleY, {
               width: pageWidth,
               lineBreak: false
             });

          const headerY = titleY + 25;

          doc.fillColor('#f3f4f6')
             .rect(50, headerY, pageWidth, 20)
             .fill();

          doc.fillColor('#374151')
             .fontSize(9)
             .font('Helvetica-Bold');

          columns.forEach((column, index) => {
            writeCell(
              column.label,
              column,
              headerY + 5,
              index === 0 ? 'left' : 'center'
            );
          });

          const rows = [
            { label: 'Idle', data: trims.idle || {} },
            {
              label: 'Light Throttle',
              data: trims.lightThrottle || {}
            },
            { label: 'Loaded', data: trims.loaded || {} }
          ];

          const fmt = (value) =>
            value !== undefined &&
            value !== null &&
            String(value).trim() !== ''
              ? `${value}%`
              : '-';

          rows.forEach((row, index) => {
            const rowY = headerY + 22 + (index * 18);

            if (index % 2 === 0) {
              doc.fillColor('#f9fafb')
                 .rect(50, rowY, pageWidth, 18)
                 .fill();
            }

            doc.fillColor('#333333')
               .fontSize(9)
               .font('Helvetica');

            const values = [
              row.label,
              fmt(row.data.stftB1),
              fmt(row.data.ltftB1),
              fmt(row.data.stftB2),
              fmt(row.data.ltftB2)
            ];

            values.forEach((value, columnIndex) => {
              writeCell(
                value,
                columns[columnIndex],
                rowY + 4,
                columnIndex === 0 ? 'left' : 'center'
              );
            });
          });

          doc.y = headerY + 86;
        };
        if (hasPreTrims) {
          renderTrimTable(fuelTrims, 'Pre-Repair Trims (Step 2)', '#16a34a');
        }
        if (hasPostTrims) {
          renderTrimTable(postRepairTrims, 'Post-Repair Trims (Step 13)', '#ea580c');
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
// MARKDOWN REPORT GENERATOR
// Plain-text companion to the PDF - easy to paste into a work order system,
// text message, or note, and diffable/searchable in a way a PDF isn't.
// =============================================
function generateMarkdownReport(reportData) {
  const v = reportData.vehicleInfo || {};
  const steps = reportData.steps || [];
  const partsRequest = reportData.partsRequest || [];
  const fuelTrims = reportData.fuelTrims;
  const postRepairTrims = reportData.postRepairTrims;
  const lines = [];

  lines.push('# DiagFlow Diagnostic Report');
  lines.push('');
  lines.push('**Shop:** ' + (reportData.shopName || 'N/A'));
  lines.push('**Technician:** ' + (reportData.technicianName || 'N/A'));
  lines.push('**Generated:** ' + new Date().toLocaleString());
  lines.push('');
  lines.push('## Vehicle Information');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|---|---|');
  lines.push('| Year/Make/Model | ' + [v.year, v.make, v.model].filter(Boolean).join(' ') + ' |');
  lines.push('| VIN | ' + (v.vin || 'N/A') + ' |');
  lines.push('| RO Number | ' + (v.roNumber || 'N/A') + ' |');
  lines.push('| Mileage | ' + (v.mileage || 'N/A') + ' |');
  lines.push('');
  lines.push('**Progress:** ' + (reportData.completedSteps || 0) + ' of ' + (reportData.totalSteps || 13) + ' steps completed');
  lines.push('');
  lines.push('## Diagnostic Steps');
  lines.push('');
  steps.forEach(step => {
    const check = step.completed ? 'x' : ' ';
    lines.push('- [' + check + '] **Step ' + step.id + ': ' + step.title + '**');
    if (step.notes && step.notes.trim()) {
      lines.push('  - Notes: ' + step.notes.trim());
    }
    if (step.images && step.images.length > 0) {
      lines.push('  - Images: ' + step.images.length + ' attached (see PDF or attached image files)');
    }
  });
  lines.push('');

  const trimHasData = (trims) => {
    if (!trims) return false;
    return ['idle', 'lightThrottle', 'loaded'].some(cond => {
      const row = trims[cond];
      if (!row) return false;
      return ['stftB1', 'ltftB1', 'stftB2', 'ltftB2'].some(f => row[f] !== undefined && row[f] !== null && String(row[f]).trim() !== '');
    });
  };
  const fmtTrim = (v) => (v !== undefined && v !== null && String(v).trim() !== '') ? v + '%' : '-';
  const renderTrimMd = (trims, title) => {
    lines.push('### ' + title);
    lines.push('');
    lines.push('| Condition | STFT B1 | LTFT B1 | STFT B2 | LTFT B2 |');
    lines.push('|---|---|---|---|---|');
    [['Idle', 'idle'], ['Light Throttle', 'lightThrottle'], ['Loaded', 'loaded']].forEach(([label, key]) => {
      const row = trims[key] || {};
      lines.push('| ' + label + ' | ' + fmtTrim(row.stftB1) + ' | ' + fmtTrim(row.ltftB1) + ' | ' + fmtTrim(row.stftB2) + ' | ' + fmtTrim(row.ltftB2) + ' |');
    });
    lines.push('');
  };

  if (trimHasData(fuelTrims) || trimHasData(postRepairTrims)) {
    lines.push('## Fuel Trim Data');
    lines.push('');
    if (trimHasData(fuelTrims)) renderTrimMd(fuelTrims, 'Pre-Repair Trims (Step 2)');
    if (trimHasData(postRepairTrims)) renderTrimMd(postRepairTrims, 'Post-Repair Trims (Step 13)');
  }

  if (partsRequest.length > 0) {
    lines.push('## Parts & Labor Request');
    lines.push('');
    lines.push('| Item | Type | Stock | P/N |');
    lines.push('|---|---|---|---|');
    partsRequest.forEach(p => {
      const name = p.partName || p.name || 'Unnamed';
      const type = p.laborItem ? 'Labor' : 'Part';
      const stock = p.laborItem ? '-' : (p.inStock ? 'In Stock' : 'Order');
      lines.push('| ' + (p.quantity || 1) + ' x ' + name + ' | ' + type + ' | ' + stock + ' | ' + (p.partNumber || '-') + ' |');
    });
    lines.push('');
  }

  lines.push('---');
  lines.push('*Generated by DiagFlow | Never Miss A Step*');

  return lines.join('\n');
}

// =============================================
// SUBMIT REPORT ENDPOINT (Multi-Org)
// =============================================
app.post(
  '/api/submit-report',
  requireOrganizationAuth,
  async (req, res) => {
  console.log('=== SUBMIT REPORT STARTED ===');
  try {
    const {
  reportData,
  recipientEmail,
  recipients,
  email
} = req.body;

const orgId = req.auth.orgId;
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
    const baseFilename = 'DiagFlow_Report_' + (v.year || 'Vehicle') + '_' + (v.make || '') + '_' + (v.model || '') + '_' + Date.now();
    const filename = baseFilename + '.pdf';

    // Generate the Markdown companion report (plain-text, easy to paste into a work order
    // system or search later - complements the PDF rather than replacing it)
    const markdownContent = generateMarkdownReport(reportData);
    const mdFilename = baseFilename + '.md';

    // Images are already included in the PDF. Attaching the originals again can push the
    // Base64-encoded email over Resend's 40 MB limit.
    const pdfBase64 = pdfBuffer.toString('base64');
    const markdownBase64 = Buffer.from(markdownContent, 'utf-8').toString('base64');
    const encodedAttachmentBytes = Buffer.byteLength(pdfBase64) + Buffer.byteLength(markdownBase64);
    const MAX_SAFE_ATTACHMENT_BYTES = 38 * 1024 * 1024;

    if (encodedAttachmentBytes > MAX_SAFE_ATTACHMENT_BYTES) {
      console.error('Email attachment budget exceeded:', encodedAttachmentBytes);
      return res.status(413).json({
        success: false,
        error: 'Report PDF is too large to email safely. Reduce image sizes or use secure file links.'
      });
    }

    console.log('Encoded email attachments:', encodedAttachmentBytes, 'bytes');

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
          var displayName = (part.quantity || 1) + ' x ' + partName;
          var partNumber = part.partNumber ? '<br><span style="color: #666; font-size: 11px;">P/N: ' + part.partNumber + '</span>' : '';
          var typeText = part.laborItem ? 'Labor' : 'Part';
          var typeColor = part.laborItem ? '#3b82f6' : '#666';
          var stockText = part.laborItem ? '-' : (part.inStock ? 'In Stock' : 'Order');
          var stockColor = part.laborItem ? '#999' : (part.inStock ? '#22c55e' : '#ef4444');
          
          return '<tr>' +
            '<td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><strong>' + displayName + '</strong>' + partNumber + '</td>' +
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
      '<p style="margin-top: 20px; color: #666;">Please find the complete diagnostic report attached as a PDF. Diagnostic images are included inside the PDF. A plain-text (.md) copy of the report is also attached for easy pasting into other systems.' +
      '</p>' +
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
          content: pdfBase64
        },
        {
          filename: mdFilename,
          content: markdownBase64
        }
      ]
    });

    if (result && result.error) {
      const statusCode = Number(result.error.statusCode);
      const responseStatus = statusCode >= 400 && statusCode <= 599 ? statusCode : 502;
      console.error('Resend rejected email:', result.error);
      return res.status(responseStatus).json({
        success: false,
        error: result.error.message || 'Email provider rejected the report.'
      });
    }

    const messageId = result && result.data ? result.data.id : result && result.id;
    if (!messageId) {
      console.error('Resend returned no message ID:', result);
      return res.status(502).json({
        success: false,
        error: 'Email provider did not confirm delivery acceptance.'
      });
    }

    console.log('Email accepted by Resend:', messageId);
    res.json({ success: true, messageId });

  } catch (error) {
    console.error('Submit report error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================
// AI DIAGNOSTIC ANALYSIS ENDPOINT
// =============================================
app.post(
  '/api/ai-analysis',
  requireOrganizationAuth,
  async (req, res) => {
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
    const checkpointSteps = steps.filter(s => Number(s.id) <= 10);
    const partsRequest = reportData.partsRequest || [];
    
    const completedSteps = checkpointSteps.filter(s => s.completed);
    const stepsWithNotes = checkpointSteps.filter(s => s.notes && s.notes.trim());
    const stepsWithImages = checkpointSteps.filter(s => Number(s.imageCount || 0) > 0);
    const step10 = checkpointSteps.find(s => Number(s.id) === 10);
    const step10HasData = Boolean(String(step10?.notes || '').trim()) || Number(step10?.imageCount || 0) > 0;
    if (!step10HasData) {
      return res.status(400).json({
        success: false,
        error: 'Step 10 must contain notes or an image before AI review.'
      });
    }
    
    const diagnosticSummary = stepsWithNotes.map(s => 
      'Step ' + s.id + ' (' + s.title + '): ' + s.notes
    ).join('\n\n');

    const partsListText = partsRequest.length > 0 
      ? partsRequest.map(p => '- ' + (p.partName || p.name) + (p.partNumber ? ' (P/N: ' + p.partNumber + ')' : '') + (p.inStock ? ' [In Stock]' : ' [Needs Order]')).join('\n')
      : 'No parts requested yet.';

    const systemPrompt = 'You are an expert ASE Master Certified automotive diagnostic technician reviewing evidence documented through Step 10 of DiagFlow\'s 13-step "Never Miss A Step" workflow. The review may be requested before or after the technician has worked in later steps. Never criticize, flag, or comment on the completion state or ordering of Step 11 or any later step. Step 11 completion is allowed and is not a documentation-integrity issue.\n\nProvide:\n1. What the documented evidence supports\n2. Only material gaps or contradictions\n3. No more than three focused questions\n4. No more than three highest-value next tests\n5. Safety concerns or applicability limits\n\nWorkflow rule: Steps 4 and 7 are conditional, not universally required. Step 4 may not require a full charging-system test when the vehicle behavior and diagnostic circumstances do not justify it. Step 7 is especially applicable to long key-on diagnosis, OE queries, programming, flashing, coding, and software updates. Accept a documented N/A when the technician gives a sound reason. Challenge the omission only when the rationale is absent or the case evidence makes the step relevant.\n\nEvidence discipline: Treat documented wiring confirmation, sensor type, scope characteristics, and repeated event correlation as evidence. Do not ask the technician to reconfirm facts already documented. Do not invent platform failure patterns, tune behavior, sensor thresholds, tooth counts, specifications, TSBs, or applicability. Do not reopen unrelated battery, fuel-additive, tune, or maintenance possibilities unless the documented evidence directly connects them to the captured failure. A signal can remain electrically in range yet be diagnostically invalid because its frequency, speed, phase, or rate of change is physically impossible. Do not assume that absence of a component DTC weakens a correlated no-code scope finding. Vehicle age and aftermarket tuning may reduce TSB applicability; do not turn the tune into an unsupported causal theory.\n\nUse a constructive senior-technician coaching tone. Be candid without accusations or alarmist headings. Separate confirmed findings from hypotheses. If authoritative service information is not included, say that a claim needs verification rather than presenting it as fact. Keep the entire review under 900 words and finish every section.';

    const userMessage = 'Review the evidence documented through Step 10. Ignore the completion state of all later steps.\n\n**VEHICLE INFORMATION:**\n- Year/Make/Model: ' + (v.year || 'Unknown') + ' ' + (v.make || 'Unknown') + ' ' + (v.model || 'Unknown') + '\n- VIN: ' + (v.vin || 'Not provided') + '\n- Mileage: ' + (v.mileage || 'Not recorded') + '\n- RO#: ' + (v.roNumber || 'N/A') + '\n\n**STEP 1-10 DOCUMENTATION:**\n- Steps marked complete: ' + completedSteps.length + ' of ' + checkpointSteps.length + '\n- Steps with documentation: ' + stepsWithNotes.length + '\n- Steps with photos: ' + stepsWithImages.length + '\n\n**TECHNICIAN FINDINGS:**\n' + (diagnosticSummary || 'No notes recorded in diagnostic steps.') + '\n\n**PARTS IDENTIFIED:**\n' + partsListText + '\n\nIdentify what is supported, what needs clarification, and the highest-value next tests. Do not comment on later-step completion or workflow ordering.';

    console.log('AI Analysis requested for:', v.year + ' ' + v.make + ' ' + v.model);

    const message = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 2400,
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
app.post(
  '/api/support-request',
  requireOrganizationAuth,
  async (req, res) => {
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
