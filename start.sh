#!/bin/bash
echo "=== RENDER DEBUGGING SCRIPT ==="
echo "Current working directory: $(pwd)"
echo "Full path: $(realpath .)"
echo ""
echo "Contents of root directory:"
ls -la
echo ""
echo "Looking for dist directory:"
if [ -d "dist" ]; then
    echo "✅ dist directory found"
    echo "Contents of dist directory:"
    ls -la dist/
    echo ""
    if [ -f "dist/index.js" ]; then
        echo "✅ dist/index.js found"
        echo "File size: $(stat -f%z dist/index.js 2>/dev/null || stat -c%s dist/index.js) bytes"
        echo ""
        echo "Starting Node.js application..."
        exec node dist/index.js
    else
        echo "❌ dist/index.js NOT FOUND"
        echo "Searching for index.js files..."
        find . -name "index.js" -type f
        exit 1
    fi
else
    echo "❌ dist directory NOT FOUND"
    echo "Available directories:"
    ls -la | grep "^d"
    exit 1
fi