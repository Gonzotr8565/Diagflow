const express = require('express');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'));
        }
    }
});

// =====================================
// SERVE FRONTEND (DiagFlow V46)
// =====================================

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve DiagFlow V46 at root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// =====================================
// API ENDPOINTS
// =====================================

// API Info endpoint
app.get('/api', (req, res) => {
    res.json({
        message: "DiagFlow API v1.0.0",
        version: "1.0.0",
        status: "running",
        endpoints: {
            frontend: "GET / - DiagFlow V46 Web Application",
            jobs: "POST /api/jobs - Save diagnostic job data",
            images: "POST /api/images/upload - Upload diagnostic images",
            report: "POST /api/submit-report - Generate and email PDF report",
            support: "POST /api/support-request - Submit support ticket",
            health: "GET /api/health - Health check"
        }
    });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// =====================================
// SAVE DIAGNOSTIC JOB
// =====================================

app.post('/api/jobs', (req, res) => {
    try {
        const jobData = req.body;
        
        // Validate required fields
        if (!jobData.vehicleInfo) {
            return res.status(400).json({
                success: false,
                error: 'Vehicle information is required'
            });
        }

        // In production, save to database
        // For now, we'll just log and return success
        console.log('📋 Job Data Received:', {
            vehicle: jobData.vehicleInfo,
            completedSteps: jobData.completedSteps?.length || 0,
            notesCount: Object.keys(jobData.stepNotes || {}).length,
            imagesCount: Object.values(jobData.stepImages || {}).reduce((sum, imgs) => sum + imgs.length, 0)
        });

        // Save to file system (temporary - replace with DB in production)
        const jobsDir = path.join(__dirname, 'jobs');
        if (!fs.existsSync(jobsDir)) {
            fs.mkdirSync(jobsDir, { recursive: true });
        }

        const jobId = `JOB-${Date.now()}`;
        const jobFile = path.join(jobsDir, `${jobId}.json`);
        
        fs.writeFileSync(jobFile, JSON.stringify({
            ...jobData,
            jobId,
            savedAt: new Date().toISOString()
        }, null, 2));

        res.json({
            success: true,
            message: 'Job saved successfully',
            jobId: jobId,
            savedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error saving job:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to save job data',
            message: error.message
        });
    }
});

// =====================================
// IMAGE UPLOAD
// =====================================

app.post('/api/images/upload', upload.array('images', 10), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No images uploaded'
            });
        }

        const uploadedFiles = req.files.map(file => ({
            filename: file.filename,
            originalName: file.originalname,
            size: file.size,
            mimetype: file.mimetype,
            path: `/uploads/${file.filename}`,
            uploadedAt: new Date().toISOString()
        }));

        console.log(`📸 Uploaded ${uploadedFiles.length} image(s)`);

        res.json({
            success: true,
            message: `Successfully uploaded ${uploadedFiles.length} image(s)`,
            files: uploadedFiles
        });

    } catch (error) {
        console.error('❌ Error uploading images:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to upload images',
            message: error.message
        });
    }
});

// Serve uploaded images
app.use('/uploads', express.static(uploadsDir));

// =====================================
// SUBMIT REPORT TO SERVICE ADVISOR
// =====================================

app.post('/api/submit-report', async (req, res) => {
    try {
        const { email, reportData } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email address is required'
            });
        }

        if (!reportData) {
            return res.status(400).json({
                success: false,
                error: 'Report data is required'
            });
        }

        // Log the report submission
        console.log('📧 Report Submission:', {
            email,
            vehicle: `${reportData.vehicleInfo?.year} ${reportData.vehicleInfo?.make} ${reportData.vehicleInfo?.model}`,
            completedSteps: reportData.completedSteps,
            totalSteps: reportData.totalSteps
        });

        // Save report data
        const reportsDir = path.join(__dirname, 'reports');
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }

        const reportId = `REPORT-${Date.now()}`;
        const reportFile = path.join(reportsDir, `${reportId}.json`);
        
        fs.writeFileSync(reportFile, JSON.stringify({
            reportId,
            email,
            reportData,
            submittedAt: new Date().toISOString()
        }, null, 2));

        // TODO: In production, integrate with:
        // - PDF generation library (e.g., pdfkit, puppeteer)
        // - Email service (e.g., SendGrid, Nodemailer, AWS SES)
        
        res.json({
            success: true,
            message: `Report generated and will be sent to ${email}`,
            reportId: reportId,
            submittedAt: new Date().toISOString(),
            note: 'PDF generation and email delivery pending integration'
        });

    } catch (error) {
        console.error('❌ Error submitting report:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to submit report',
            message: error.message
        });
    }
});

// =====================================
// SUPPORT REQUEST
// =====================================

app.post('/api/support-request', (req, res) => {
    try {
        const { email, subject, helpType, vehicleInfo, description, timestamp } = req.body;

        if (!helpType || !description) {
            return res.status(400).json({
                success: false,
                error: 'Help type and description are required'
            });
        }

        console.log('🆘 Support Request:', {
            helpType,
            vehicle: vehicleInfo ? `${vehicleInfo.year} ${vehicleInfo.make} ${vehicleInfo.model}` : 'N/A',
            description: description.substring(0, 50) + '...'
        });

        // Save support request
        const supportDir = path.join(__dirname, 'support');
        if (!fs.existsSync(supportDir)) {
            fs.mkdirSync(supportDir, { recursive: true });
        }

        const ticketId = `TICKET-${Date.now()}`;
        const ticketFile = path.join(supportDir, `${ticketId}.json`);
        
        fs.writeFileSync(ticketFile, JSON.stringify({
            ticketId,
            email: email || 'support@diagflow.com',
            subject,
            helpType,
            vehicleInfo,
            description,
            timestamp: timestamp || new Date().toISOString(),
            status: 'open'
        }, null, 2));

        // TODO: In production, send notification email to support team

        res.json({
            success: true,
            message: 'Support request submitted successfully',
            ticketId: ticketId,
            submittedAt: new Date().toISOString(),
            note: 'A Master Technician will contact you within 24 hours'
        });

    } catch (error) {
        console.error('❌ Error submitting support request:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to submit support request',
            message: error.message
        });
    }
});

// =====================================
// ERROR HANDLING
// =====================================

// 404 handler for API routes
app.use('/api/*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'API endpoint not found',
        path: req.path
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('❌ Server Error:', err);
    
    res.status(err.status || 500).json({
        success: false,
        error: err.message || 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

// =====================================
// START SERVER
// =====================================

app.listen(PORT, () => {
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║                                                       ║');
    console.log('║         🚀 DiagFlow V46 Server Running! 🚀          ║');
    console.log('║                                                       ║');
    console.log('╚═══════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`📱 Frontend:  http://localhost:${PORT}/`);
    console.log(`🔌 API Info:  http://localhost:${PORT}/api`);
    console.log(`💚 Health:    http://localhost:${PORT}/api/health`);
    console.log('');
    console.log('📋 API Endpoints:');
    console.log('   POST /api/jobs              - Save diagnostic job');
    console.log('   POST /api/images/upload     - Upload images');
    console.log('   POST /api/submit-report     - Submit report to SA');
    console.log('   POST /api/support-request   - Request expert help');
    console.log('');
    console.log(`⚙️  Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📂 Working Dir: ${__dirname}`);
    console.log('');
    console.log('✅ Server ready to accept connections!');
    console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('👋 SIGTERM received, shutting down gracefully...');
    process.exit(0);
});

module.exports = app;
