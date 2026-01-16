#!/bin/bash

# =============================================================================
# Development Start Script
# =============================================================================

echo "🚀 Starting Imagen a Llavero 3D - Development Mode"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found, copying from .env.example..."
    cp .env.example .env
    echo "✅ .env file created. Please review and update if needed."
    echo ""
fi

# Build and start services
echo "🐳 Building and starting Docker services..."
docker compose up --build -d

echo ""
echo "⏳ Waiting for services to be ready..."
sleep 5

# Run health check
if [ -f scripts/health-check.sh ]; then
    bash scripts/health-check.sh
fi

echo ""
echo "✨ Development environment is ready!"
echo ""
echo "🌐 Frontend: http://localhost:3000"
echo "🔌 API: http://localhost:4000"
echo "🏥 Health: http://localhost:4000/health"
echo ""
echo "📝 View logs: docker compose logs -f"
echo "🛑 Stop: docker compose down"
