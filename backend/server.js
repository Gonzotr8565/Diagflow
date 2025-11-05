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
