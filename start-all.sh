#!/bin/bash

# Script para iniciar todos los servicios en background
# con manejo de errores y logs

PROJECT_DIR="/home/mora/imgtokeychai"
LOG_DIR="$PROJECT_DIR/logs"

# Crear directorio de logs
mkdir -p "$LOG_DIR"

echo "🚀 Iniciando servicios..."

# Función para verificar si un puerto está en uso
check_port() {
    lsof -ti:$1 > /dev/null 2>&1
    return $?
}

# Limpiar puertos si están en uso
if check_port 4000; then
    echo "⚠️  Puerto 4000 en uso, liberando..."
    lsof -ti:4000 | xargs kill -9 2>/dev/null
    sleep 1
fi

if check_port 3000; then
    echo "⚠️  Puerto 3000 en uso, liberando..."
    lsof -ti:3000 | xargs kill -9 2>/dev/null
    sleep 1
fi

# Iniciar API
echo "📡 Iniciando API en puerto 4000..."
cd "$PROJECT_DIR/services/api"
npm run dev > "$LOG_DIR/api.log" 2>&1 &
API_PID=$!
echo $API_PID > "$LOG_DIR/api.pid"
sleep 3

# Iniciar Worker
echo "👷 Iniciando Worker..."
cd "$PROJECT_DIR/services/worker"
npm run dev > "$LOG_DIR/worker.log" 2>&1 &
WORKER_PID=$!
echo $WORKER_PID > "$LOG_DIR/worker.pid"
sleep 2

# Iniciar Frontend
echo "🎨 Iniciando Frontend en puerto 3000..."
cd "$PROJECT_DIR/frontend"
npm run dev > "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo $FRONTEND_PID > "$LOG_DIR/frontend.pid"
sleep 3

# Verificar servicios
echo ""
echo "✅ Servicios iniciados:"
echo "   API PID: $API_PID"
echo "   Worker PID: $WORKER_PID"
echo "   Frontend PID: $FRONTEND_PID"
echo ""
echo "📝 Logs disponibles en: $LOG_DIR"
echo "   - API: tail -f $LOG_DIR/api.log"
echo "   - Worker: tail -f $LOG_DIR/worker.log"
echo "   - Frontend: tail -f $LOG_DIR/frontend.log"
echo ""
echo "🌐 URLs:"
echo "   - Frontend: http://localhost:3000"
echo "   - API: http://localhost:4000"
echo ""
echo "🛑 Para detener: ./stop-all.sh"
