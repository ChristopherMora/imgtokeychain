#!/bin/bash

# =============================================================================
# Script para iniciar todos los servicios en modo desarrollo local
# Con hot-reload automático (los cambios se aplican al guardar)
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🚀 Iniciando servicios en modo desarrollo local..."
echo "📁 Directorio: $PROJECT_DIR"
echo ""

# =============================================================================
# Verificar dependencias
# =============================================================================
echo "🔍 Verificando dependencias..."

# PostgreSQL
if ! sudo service postgresql status > /dev/null 2>&1; then
  echo "⚠️  PostgreSQL no está corriendo. Iniciando..."
  sudo service postgresql start
fi

# Redis
if ! redis-cli ping > /dev/null 2>&1; then
  echo "⚠️  Redis no está corriendo. Iniciando..."
  sudo service redis-server start
fi

# Verificar node_modules
if [ ! -d "$PROJECT_DIR/services/api/node_modules" ]; then
  echo "❌ Dependencias del API no instaladas. Ejecuta:"
  echo "   cd services/api && npm install"
  exit 1
fi

if [ ! -d "$PROJECT_DIR/services/worker/node_modules" ]; then
  echo "❌ Dependencias del Worker no instaladas. Ejecuta:"
  echo "   cd services/worker && npm install"
  exit 1
fi

if [ ! -d "$PROJECT_DIR/frontend/node_modules" ]; then
  echo "❌ Dependencias del Frontend no instaladas. Ejecuta:"
  echo "   cd frontend && npm install"
  exit 1
fi

echo "✅ Dependencias verificadas"
echo ""

# =============================================================================
# Información
# =============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🎯 MODO DESARROLLO LOCAL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  ✨ Hot-reload activado: Los cambios se aplican automáticamente"
echo ""
echo "  📂 Servicios a iniciar:"
echo "     • Frontend:  http://localhost:3000"
echo "     • API:       http://localhost:4000"
echo "     • Worker:    Procesamiento en background"
echo ""
echo "  📝 Abrir en 3 terminales separadas:"
echo ""
echo "     Terminal 1 - API:"
echo "     $ cd $PROJECT_DIR/services/api"
echo "     $ npm run dev"
echo ""
echo "     Terminal 2 - Worker:"
echo "     $ cd $PROJECT_DIR/services/worker"
echo "     $ npm run dev"
echo ""
echo "     Terminal 3 - Frontend:"
echo "     $ cd $PROJECT_DIR/frontend"
echo "     $ npm run dev"
echo ""
echo "  ⚡ Beneficios vs Docker:"
echo "     • Cambios instantáneos (sin rebuild)"
echo "     • Logs en tiempo real"
echo "     • Debug más fácil"
echo "     • Menos uso de recursos"
echo ""
echo "  🛑 Para detener: Ctrl+C en cada terminal"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# =============================================================================
# Preguntar si quiere abrir terminales automáticamente
# =============================================================================
read -p "¿Quieres abrir las 3 terminales automáticamente? (y/N): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo "🚀 Abriendo terminales..."
  
  # Nota: Esto funciona en algunas terminales de Linux
  # Si no funciona, ejecuta los comandos manualmente
  
  # Terminal 1 - API
  gnome-terminal --tab --title="API" --working-directory="$PROJECT_DIR/services/api" -- bash -c "npm run dev; exec bash" 2>/dev/null || \
  xterm -T "API" -e "cd $PROJECT_DIR/services/api && npm run dev; bash" 2>/dev/null &
  
  sleep 2
  
  # Terminal 2 - Worker
  gnome-terminal --tab --title="Worker" --working-directory="$PROJECT_DIR/services/worker" -- bash -c "npm run dev; exec bash" 2>/dev/null || \
  xterm -T "Worker" -e "cd $PROJECT_DIR/services/worker && npm run dev; bash" 2>/dev/null &
  
  sleep 2
  
  # Terminal 3 - Frontend
  gnome-terminal --tab --title="Frontend" --working-directory="$PROJECT_DIR/frontend" -- bash -c "npm run dev; exec bash" 2>/dev/null || \
  xterm -T "Frontend" -e "cd $PROJECT_DIR/frontend && npm run dev; bash" 2>/dev/null &
  
  echo "✅ Terminales abiertas"
  echo "   Si no se abrieron automáticamente, ejecuta los comandos manualmente"
else
  echo "📋 Copia y pega estos comandos en 3 terminales:"
  echo ""
  echo "# Terminal 1"
  echo "cd $PROJECT_DIR/services/api && npm run dev"
  echo ""
  echo "# Terminal 2"
  echo "cd $PROJECT_DIR/services/worker && npm run dev"
  echo ""
  echo "# Terminal 3"
  echo "cd $PROJECT_DIR/frontend && npm run dev"
fi

echo ""
echo "✨ Listo! Desarrolla libremente, los cambios se aplicarán automáticamente"
