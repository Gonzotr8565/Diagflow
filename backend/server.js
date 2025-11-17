const express = require('express');
const cors = require('cors');
const multer = require('multer');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
// Serve static files (images, etc.)
app.use(express.static('public'));
// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = './uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only image files are allowed!'));
  }
});

// Email configuration
//const transporter = nodemailer.createTransport({
  // Email configuration
console.log('Checking email configuration...');
console.log('EMAIL_USER:', process.env.EMAIL_USER ? 'SET' : 'NOT SET');
console.log('EMAIL_PASS:', process.env.EMAIL_PASS ? 'SET' : 'NOT SET');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'DiagFlow API is running',
    version: '1.0.0',
    endpoints: [
      'POST /api/jobs - Save diagnostic job',
      'POST /api/images/upload - Upload diagnostic images',
      'POST /api/submit-report - Generate PDF and email report'
    ]
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Save diagnostic job
app.post('/api/jobs', (req, res) => {
  try {
    const jobData = req.body;
    console.log('Received job data:', jobData);
    
    const jobId = `job-${Date.now()}`;
    
    res.json({ 
      success: true, 
      jobId: jobId,
      message: 'Job saved successfully'
    });
  } catch (error) {
    console.error('Error saving job:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Upload diagnostic images
app.post('/api/images/upload', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No image file uploaded' 
      });
    }

    const stepId = req.body.stepId;
    console.log(`Image uploaded for step ${stepId}:`, req.file.filename);

    res.json({ 
      success: true, 
      imageUrl: `/uploads/${req.file.filename}`,
      filename: req.file.filename,
      stepId: stepId
    });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Generate PDF from report data
function generatePDF(reportData) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const pdfPath = `./uploads/report-${Date.now()}.pdf`;
      
      // Ensure uploads directory exists
      if (!fs.existsSync('./uploads')) {
        fs.mkdirSync('./uploads', { recursive: true });
      }
      
      const writeStream = fs.createWriteStream(pdfPath);

      doc.pipe(writeStream);

      // Header
      doc.fontSize(24).fillColor('#0066ff').text('DiagFlow Diagnostic Report', { align: 'center' });
      doc.moveDown();
      doc.fontSize(10).fillColor('#666').text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
      doc.moveDown(2);

      // Vehicle Information
      doc.fontSize(16).fillColor('#000').text('Vehicle Information', { underline: true });
      doc.moveDown(0.5);
      const vehicle = reportData.vehicleInfo || {};
      doc.fontSize(11);
      if (vehicle.roNumber) doc.text(`RO Number: ${vehicle.roNumber}`);
      if (vehicle.year || vehicle.make || vehicle.model) {
        doc.text(`Vehicle: ${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`);
      }
      if (vehicle.vin) doc.text(`VIN: ${vehicle.vin}`);
      doc.moveDown(2);

      // Progress Summary
      doc.fontSize(16).fillColor('#000').text('Diagnostic Progress', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(11);
      doc.text(`Steps Completed: ${reportData.completedSteps || 0} of ${reportData.totalSteps || 15}`);
      doc.text(`Completion Rate: ${Math.round(((reportData.completedSteps || 0) / (reportData.totalSteps || 15)) * 100)}%`);
      doc.moveDown(2);

      // Diagnostic Steps
      doc.fontSize(16).fillColor('#000').text('Diagnostic Steps', { underline: true });
      doc.moveDown(0.5);

      if (reportData.steps && Array.isArray(reportData.steps)) {
        reportData.steps.forEach((step) => {
          if (step.completed) {
            doc.fontSize(12).fillColor('#059669').text(`✓ Step ${step.id}: ${step.title}`);
            
            if (step.notes) {
              doc.fontSize(10).fillColor('#333').text(`   Notes: ${step.notes}`, { indent: 20 });
            }
            
            if (step.images && step.images.length > 0) {
              doc.fontSize(9).fillColor('#666').text(`   Photos: ${step.images.length} attached`, { indent: 20 });
            }
            
            doc.moveDown(0.5);
          }
        });
      }

      // Footer
      doc.moveDown(2);
      doc.fontSize(8).fillColor('#999').text('DiagFlow - Professional Diagnostic Workflow System', { align: 'center' });

      doc.end();

      writeStream.on('finish', () => {
        resolve(pdfPath);
      });

      writeStream.on('error', (error) => {
        reject(error);
      });
    } catch (error) {
      reject(error);
    }
  });
}

// Submit report to Service Advisor
app.post('/api/submit-report', async (req, res) => {
  try {
    const { email, reportData } = req.body;
    
    if (!email) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email address is required' 
      });
    }

    console.log('Generating PDF report for:', email);

    // Generate PDF
    const pdfPath = await generatePDF(reportData);
    console.log('PDF generated:', pdfPath);

    // Check if email is configured
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.warn('Email not configured. PDF generated but not sent.');
      return res.json({ 
        success: true, 
        message: 'Report generated (email not configured)',
        pdfPath: pdfPath
      });
    }

    // Send email with PDF attachment
    const vehicle = reportData.vehicleInfo || {};
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: `DiagFlow Diagnostic Report - ${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`,
      html: `
        <h2>DiagFlow Diagnostic Report</h2>
        <p>Please find attached the diagnostic report for:</p>
        <ul>
          <li><strong>Vehicle:</strong> ${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}</li>
          ${vehicle.vin ? `<li><strong>VIN:</strong> ${vehicle.vin}</li>` : ''}
          ${vehicle.roNumber ? `<li><strong>RO#:</strong> ${vehicle.roNumber}</li>` : ''}
          <li><strong>Steps Completed:</strong> ${reportData.completedSteps || 0} of ${reportData.totalSteps || 15}</li>
        </ul>
        <p>This report contains detailed diagnostic findings, technician notes, and photo documentation.</p>
        <hr>
        <p style="font-size: 12px; color: #666;">Generated by DiagFlow - Professional Diagnostic Workflow System</p>
      `,
      attachments: [
        {
          filename: 'diagnostic-report.pdf',
          path: pdfPath
        }
      ]
    };

    await transporter.sendMail(mailOptions);
    console.log('Email sent successfully to:', email);

    // Clean up PDF file after sending
    setTimeout(() => {
      fs.unlink(pdfPath, (err) => {
        if (err) console.error('Error deleting PDF:', err);
      });
    }, 5000);

    res.json({ 
      success: true, 
      message: 'Report sent successfully',
      recipient: email
    });

  } catch (error) {
    console.error('Error submitting report:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Serve uploaded files
app.use('/uploads', express.static('uploads'));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    error: 'Endpoint not found' 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`DiagFlow API server running on port ${PORT}`);
  console.log(`Access the API at http://localhost:${PORT}/api`);
});
