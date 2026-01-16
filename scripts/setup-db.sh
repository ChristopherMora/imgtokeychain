#!/bin/bash

# =============================================================================
# Setup Database Script
# =============================================================================

echo "🗄️  Setting up database..."

# Wait for database to be ready
echo "⏳ Waiting for PostgreSQL to be ready..."
until docker compose exec -T db pg_isready -U imgtokey > /dev/null 2>&1; do
    sleep 1
done

echo "✅ Database is ready!"

# Run Prisma migrations
echo "🔄 Running Prisma migrations..."

# API migrations
echo "  📦 API migrations..."
docker compose exec api npx prisma migrate deploy

# Worker migrations (if different)
echo "  📦 Worker migrations..."
docker compose exec worker npx prisma generate

echo ""
echo "✅ Database setup complete!"
