const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads');
}
// Root route - for testing
app.get('/', (req, res) => {
  res.json({ 
    message: 'DiagFlow API is running',
    version: '1.0.0',
    endpoints: [
      'POST /api/jobs',
      'POST /api/images/upload', 
      'POST /api/submit-report'
    ]
  });
});
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

let educationalContent = [{
  id: 1,
  title: "Introduction to React",
  description: "Learn the basics of React framework",
  content: "React is a JavaScript library for building user interfaces...",
  imageUrl: null,
  category: "Programming",
  createdAt: new Date().toISOString()
}];

let nextId = 2;

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Education API is running' });
});

app.get('/api/content', (req, res) => {
  const { category, search } = req.query;
  let filtered = educationalContent;
  if (category) {
    filtered = filtered.filter(item => item.category.toLowerCase() === category.toLowerCase());
  }
  if (search) {
    filtered = filtered.filter(item => item.title.toLowerCase().includes(search.toLowerCase()) || item.description.toLowerCase().includes(search.toLowerCase()));
  }
  res.json({ success: true, count: filtered.length, data: filtered });
});

app.get('/api/content/:id', (req, res) => {
  const content = educationalContent.find(item => item.id === parseInt(req.params.id));
  if (!content) {
    return res.status(404).json({ success: false, message: 'Content not found' });
  }
  res.json({ success: true, data: content });
});

app.post('/api/content', (req, res) => {
  const { title, description, content, category } = req.body;
  if (!title || !description || !content) {
    return res.status(400).json({ success: false, message: 'Title, description, and content are required' });
  }
  const newContent = { id: nextId++, title, description, content, category: category || 'General', imageUrl: null, createdAt: new Date().toISOString() };
  educationalContent.push(newContent);
  res.status(201).json({ success: true, message: 'Content created successfully', data: newContent });
});

app.put('/api/content/:id', (req, res) => {
  const index = educationalContent.findIndex(item => item.id === parseInt(req.params.id));
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Content not found' });
  }
  const { title, description, content, category } = req.body;
  educationalContent[index] = { ...educationalContent[index], ...(title && { title }), ...(description && { description }), ...(content && { content }), ...(category && { category }), updatedAt: new Date().toISOString() };
  res.json({ success: true, message: 'Content updated successfully', data: educationalContent[index] });
});

app.delete('/api/content/:id', (req, res) => {
  const index = educationalContent.findIndex(item => item.id === parseInt(req.params.id));
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Content not found' });
  }
  const deleted = educationalContent.splice(index, 1);
  res.json({ success: true, message: 'Content deleted successfully', data: deleted[0] });
});

app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No image file provided' });
  }
  const imageUrl = req.protocol + '://' + req.get('host') + '/uploads/' + req.file.filename;
  res.json({ success: true, message: 'Image uploaded successfully', data: { filename: req.file.filename, imageUrl: imageUrl } });
});

app.post('/api/content/:id/image', upload.single('image'), (req, res) => {
  const content = educationalContent.find(item => item.id === parseInt(req.params.id));
  if (!content) {
    return res.status(404).json({ success: false, message: 'Content not found' });
  }
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No image file provided' });
  }
  const imageUrl = req.protocol + '://' + req.get('host') + '/uploads/' + req.file.filename;
  content.imageUrl = imageUrl;
  res.json({ success: true, message: 'Image attached to content successfully', data: content });
});

app.get('/api/categories', (req, res) => {
  const categories = [...new Set(educationalContent.map(item => item.category))];
  res.json({ success: true, data: categories });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: err.message || 'Something went wrong!' });
});

app.listen(PORT, () => {
  console.log('Education API server running on port ' + PORT);
  console.log('Access the API at http://localhost:' + PORT + '/api');
});
// In your server.js, add these routes:

// Save diagnostic job
app.post('/api/jobs', (req, res) => {
  const jobData = req.body;
  // Save to database
  res.json({ success: true, jobId: 'generated-id' });
});

// Upload images
app.post('/api/images/upload', upload.single('image'), (req, res) => {
  // Handle file upload
  res.json({ success: true, imageUrl: 'url-to-uploaded-image' });
});

// Submit report to SA
app.post('/api/submit-report', async (req, res) => {
  const { email, reportData } = req.body;
  // Generate PDF and send email
  res.json({ success: true, message: 'Report sent' });
});
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
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
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
    
    // TODO: Save to database
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
    const doc = new PDFDocument({ margin: 50 });
    const pdfPath = `./uploads/report-${Date.now()}.pdf`;
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
    const vehicle = reportData.vehicleInfo;
    doc.fontSize(11);
    if (vehicle.roNumber) doc.text(`RO Number: ${vehicle.roNumber}`);
    if (vehicle.year || vehicle.make || vehicle.model) {
      doc.text(`Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
    }
    if (vehicle.vin) doc.text(`VIN: ${vehicle.vin}`);
    doc.moveDown(2);

    // Progress Summary
    doc.fontSize(16).fillColor('#000').text('Diagnostic Progress', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11);
    doc.text(`Steps Completed: ${reportData.completedSteps} of ${reportData.totalSteps}`);
    doc.text(`Completion Rate: ${Math.round((reportData.completedSteps / reportData.totalSteps) * 100)}%`);
    doc.moveDown(2);

    // Diagnostic Steps
    doc.fontSize(16).fillColor('#000').text('Diagnostic Steps', { underline: true });
    doc.moveDown(0.5);

    reportData.steps.forEach((step, index) => {
      if (step.completed) {
        doc.fontSize(12).fillColor('#059669').text(`✓ Step ${step.id}: ${step.title}`, { continued: false });
        
        if (step.notes) {
          doc.fontSize(10).fillColor('#333').text(`   Notes: ${step.notes}`, { indent: 20 });
        }
        
        if (step.images && step.images.length > 0) {
          doc.fontSize(9).fillColor('#666').text(`   Photos: ${step.images.length} attached`, { indent: 20 });
        }
        
        doc.moveDown(0.5);
      }
    });

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
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: `DiagFlow Diagnostic Report - ${reportData.vehicleInfo.year} ${reportData.vehicleInfo.make} ${reportData.vehicleInfo.model}`,
      html: `
        <h2>DiagFlow Diagnostic Report</h2>
        <p>Please find attached the diagnostic report for:</p>
        <ul>
          <li><strong>Vehicle:</strong> ${reportData.vehicleInfo.year} ${reportData.vehicleInfo.make} ${reportData.vehicleInfo.model}</li>
          ${reportData.vehicleInfo.vin ? `<li><strong>VIN:</strong> ${reportData.vehicleInfo.vin}</li>` : ''}
          ${reportData.vehicleInfo.roNumber ? `<li><strong>RO#:</strong> ${reportData.vehicleInfo.roNumber}</li>` : ''}
          <li><strong>Steps Completed:</strong> ${reportData.completedSteps} of ${reportData.totalSteps}</li>
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
```

## Step 3: Set Environment Variables in Railway

Go to your Railway project → **Variables** tab and add:
```
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
