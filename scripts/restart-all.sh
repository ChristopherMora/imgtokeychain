#!/bin/bash

# Script para reiniciar todos los servicios limpiamente
# Uso: ./scripts/restart-all.sh

set -e

echo "🛑 Deteniendo todos los servicios..."

# Matar todos los procesos de Node relacionados al proyecto
pkill -9 -f "next-server" 2>/dev/null || true
pkill -9 -f "next dev" 2>/dev/null || true
pkill -9 -f "tsx.*worker" 2>/dev/null || true
pkill -9 -f "tsx.*api" 2>/dev/null || true

# Liberar puertos específicos por si acaso
fuser -k 3000/tcp 2>/dev/null || true
fuser -k 3001/tcp 2>/dev/null || true
fuser -k 4001/tcp 2>/dev/null || true

sleep 2

echo "✅ Servicios detenidos"
echo ""
echo "🚀 Iniciando servicios..."

# Limpiar logs anteriores
> /tmp/worker.log
> /tmp/api.log
> /tmp/frontend.log

# Iniciar Worker
cd /home/mora/imgtokeychai/services/worker
npm run dev > /tmp/worker.log 2>&1 &
WORKER_PID=$!
echo "   Worker iniciado (PID: $WORKER_PID)"

sleep 1

# Iniciar API
cd /home/mora/imgtokeychai/services/api
npm run dev > /tmp/api.log 2>&1 &
API_PID=$!
echo "   API iniciado (PID: $API_PID)"

sleep 1

# Iniciar Frontend
cd /home/mora/imgtokeychai/frontend
npm run dev > /tmp/frontend.log 2>&1 &
FRONTEND_PID=$!
echo "   Frontend iniciado (PID: $FRONTEND_PID)"

sleep 3

echo ""
echo "📊 Estado de los servicios:"
echo ""

# Verificar Worker
if tail -3 /tmp/worker.log | grep -q "Worker started"; then
    echo "✅ Worker: Running"
else
    echo "❌ Worker: Error - ver /tmp/worker.log"
fi

# Verificar API
if tail -3 /tmp/api.log | grep -q "API Server running"; then
    API_PORT=$(tail -5 /tmp/api.log | grep -oP "port \K[0-9]+")
    CORS_ORIGIN=$(tail -5 /tmp/api.log | grep -oP "CORS origin: \K.*")
    echo "✅ API: Running on port $API_PORT"
    echo "   CORS: $CORS_ORIGIN"
else
    echo "❌ API: Error - ver /tmp/api.log"
fi

# Verificar Frontend
if tail -3 /tmp/frontend.log | grep -q "Ready"; then
    echo "✅ Frontend: Running on port 3000"
else
    echo "❌ Frontend: Error - ver /tmp/frontend.log"
fi

echo ""
echo "🔗 URLs:"
echo "   Frontend: http://localhost:3000"
echo "   API: http://localhost:4001"
echo ""
echo "📝 Logs:"
echo "   tail -f /tmp/worker.log"
echo "   tail -f /tmp/api.log"
echo "   tail -f /tmp/frontend.log"
echo ""
echo "🛑 Para detener: pkill -9 -f 'next-server|tsx.*worker|tsx.*api'"
