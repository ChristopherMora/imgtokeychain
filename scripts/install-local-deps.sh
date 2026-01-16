#!/bin/bash

# =============================================================================
# Script de Instalación para Desarrollo Local (sin Docker)
# =============================================================================

set -e  # Exit on error

echo "🚀 Instalando dependencias para desarrollo local..."
echo ""

# =============================================================================
# 1. PostgreSQL
# =============================================================================
echo "📦 Instalando PostgreSQL..."
sudo apt update
sudo apt install -y postgresql postgresql-contrib

# Iniciar PostgreSQL
sudo service postgresql start

echo "✅ PostgreSQL instalado"
echo ""

# =============================================================================
# 2. Redis
# =============================================================================
echo "📦 Instalando Redis..."
sudo apt install -y redis-server

# Iniciar Redis
sudo service redis-server start

echo "✅ Redis instalado"
echo ""

# =============================================================================
# 3. Herramientas de procesamiento de imágenes
# =============================================================================
echo "📦 Instalando OpenSCAD..."
sudo apt install -y openscad

echo "📦 Instalando Potrace..."
sudo apt install -y potrace

echo "📦 Instalando dependencias de Sharp..."
sudo apt install -y libvips-dev

echo "✅ Herramientas de procesamiento instaladas"
echo ""

# =============================================================================
# 4. Configurar PostgreSQL
# =============================================================================
echo "🔧 Configurando base de datos..."

# Crear usuario y base de datos
sudo -u postgres psql <<EOF
-- Crear usuario (si no existe)
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_user WHERE usename = 'imgtokey') THEN
    CREATE USER imgtokey WITH PASSWORD 'imgtokey123';
  END IF;
END
\$\$;

-- Crear base de datos (si no existe)
SELECT 'CREATE DATABASE imgtokey_db OWNER imgtokey'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'imgtokey_db')\gexec

-- Dar permisos
GRANT ALL PRIVILEGES ON DATABASE imgtokey_db TO imgtokey;

\q
EOF

echo "✅ Base de datos configurada"
echo ""

# =============================================================================
# 5. Verificar instalaciones
# =============================================================================
echo "🔍 Verificando instalaciones..."
echo ""

# PostgreSQL
if sudo service postgresql status > /dev/null 2>&1; then
  echo "✅ PostgreSQL corriendo"
else
  echo "❌ PostgreSQL NO está corriendo"
fi

# Redis
if redis-cli ping > /dev/null 2>&1; then
  echo "✅ Redis corriendo (responde PONG)"
else
  echo "❌ Redis NO está corriendo"
fi

# OpenSCAD
if command -v openscad &> /dev/null; then
  echo "✅ OpenSCAD instalado: $(openscad --version 2>&1 | head -1)"
else
  echo "❌ OpenSCAD NO encontrado"
fi

# Potrace
if command -v potrace &> /dev/null; then
  echo "✅ Potrace instalado: $(potrace --version 2>&1 | head -1)"
else
  echo "❌ Potrace NO encontrado"
fi

echo ""
echo "🎉 Instalación completada!"
echo ""
echo "📝 Próximos pasos:"
echo "   1. cd /home/mora/imgtokeychain/services/api"
echo "   2. npm run prisma:migrate"
echo "   3. Seguir instrucciones en LOCAL_DEVELOPMENT.md"
echo ""
