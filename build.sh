#!/bin/bash

# RealtyHRM Build Script
# Builds web distribution for server deployment

set -e

echo "🔨 Building RealtyHRM Web Distribution..."

# Clean previous build
echo "📦 Cleaning previous build..."
rm -rf dist/web
rm -rf .expo

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "📥 Installing dependencies..."
  npm install
fi

# Build web
echo "🌐 Building web application..."
npx expo export --platform web --output-dir dist/web

echo "✅ Build complete!"
echo "📁 Output: dist/web"
echo ""
echo "To serve locally:"
echo "  npx serve dist/web"
echo ""
echo "To deploy:"
echo "  Copy dist/web to your server"
