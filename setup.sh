#!/bin/bash

echo "🚀 DiagFlow V46 - Quick Setup Script"
echo "===================================="
echo ""

# Check if we're in the right directory
if [ ! -f "server.js" ]; then
    echo "❌ Error: server.js not found!"
    echo "Please run this script from your project root directory."
    exit 1
fi

echo "✅ Found server.js"

# Create public directory
echo "📁 Creating public directory..."
mkdir -p public

# Check for index.html
if [ ! -f "public/index.html" ]; then
    echo "⚠️  Warning: public/index.html not found!"
    echo "   Please copy index.html to the public folder."
else
    echo "✅ Found public/index.html"
fi

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

if [ $? -eq 0 ]; then
    echo "✅ Dependencies installed successfully!"
else
    echo "❌ Failed to install dependencies"
    exit 1
fi

# Create necessary directories
echo ""
echo "📂 Creating data directories..."
mkdir -p uploads
mkdir -p jobs
mkdir -p reports
mkdir -p support

echo "✅ Directories created"

# Test the server
echo ""
echo "🧪 Testing server startup..."
echo ""
echo "Starting server in test mode (will stop in 5 seconds)..."
timeout 5s npm start &
sleep 6

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Next Steps:"
echo "=============="
echo ""
echo "1. Start the server locally:"
echo "   npm start"
echo ""
echo "2. Test at: http://localhost:3000"
echo ""
echo "3. Deploy to Railway:"
echo "   git add ."
echo "   git commit -m 'Deploy DiagFlow V46'"
echo "   git push"
echo ""
echo "4. Access at: https://diagflow-production.up.railway.app/"
echo ""
echo "🎉 DiagFlow V46 is ready!"
