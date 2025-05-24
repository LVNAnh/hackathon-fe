#!/bin/bash
# Install dependencies
npm install

# Create dist directory
mkdir -p dist

# Copy files to dist
cp index.html dist/
cp style.css dist/
cp script.js dist/

echo "Build completed successfully"