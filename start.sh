#!/bin/bash
echo "Starting from directory: $(pwd)"
echo "Contents of current directory:"
ls -la
echo "Contents of dist directory:"
ls -la dist/ || echo "dist directory not found"
echo "Looking for index.js file:"
find . -name "index.js" -type f
echo "Starting Node.js application..."
node dist/index.js