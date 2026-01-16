#!/bin/bash

# =============================================================================
# Clean Script - Remove all generated files and containers
# =============================================================================

echo "🧹 Cleaning up..."

# Stop containers
echo "⏹️  Stopping containers..."
docker compose down

# Remove volumes (optional)
read -p "Remove database and storage volumes? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🗑️  Removing volumes..."
    docker compose down -v
    
    # Clean storage directories
    echo "🗑️  Cleaning storage directories..."
    rm -rf storage/uploads/* storage/processed/* storage/temp/*
    touch storage/uploads/.gitkeep storage/processed/.gitkeep storage/temp/.gitkeep
fi

# Remove node_modules (optional)
read -p "Remove node_modules? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🗑️  Removing node_modules..."
    find . -name "node_modules" -type d -exec rm -rf {} +
    find . -name ".next" -type d -exec rm -rf {} +
    find . -name "dist" -type d -exec rm -rf {} +
fi

echo ""
echo "✅ Cleanup complete!"
