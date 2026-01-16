#!/bin/bash

# =============================================================================
# Health Check Script - Imagen a Llavero 3D
# =============================================================================

set -e

echo "🏥 Checking system health..."
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Docker
echo "🐳 Checking Docker..."
if command -v docker &> /dev/null; then
    echo -e "${GREEN}✓${NC} Docker is installed"
else
    echo -e "${RED}✗${NC} Docker is not installed"
    exit 1
fi

# Check Docker Compose
echo "🐳 Checking Docker Compose..."
if docker compose version &> /dev/null; then
    echo -e "${GREEN}✓${NC} Docker Compose is available"
else
    echo -e "${RED}✗${NC} Docker Compose is not available"
    exit 1
fi

# Check if services are running
echo ""
echo "📦 Checking services..."

services=("frontend" "api" "worker" "db" "redis")
for service in "${services[@]}"; do
    if docker compose ps | grep -q "imgtokey-${service}.*Up"; then
        echo -e "${GREEN}✓${NC} ${service} is running"
    else
        echo -e "${RED}✗${NC} ${service} is not running"
    fi
done

# Check API health endpoint
echo ""
echo "🔍 Checking API health endpoint..."
if curl -s -f http://localhost:4000/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} API health endpoint is responding"
    curl -s http://localhost:4000/health | jq '.' 2>/dev/null || true
else
    echo -e "${RED}✗${NC} API health endpoint is not responding"
fi

# Check frontend
echo ""
echo "🌐 Checking frontend..."
if curl -s -f http://localhost:3000 > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Frontend is accessible"
else
    echo -e "${YELLOW}⚠${NC} Frontend is not accessible"
fi

# Check storage directories
echo ""
echo "📁 Checking storage directories..."
if [ -d "./storage/uploads" ] && [ -d "./storage/processed" ] && [ -d "./storage/temp" ]; then
    echo -e "${GREEN}✓${NC} Storage directories exist"
else
    echo -e "${YELLOW}⚠${NC} Some storage directories are missing"
fi

echo ""
echo "✅ Health check complete!"
