#!/bin/bash

# Script para detener todos los servicios

PROJECT_DIR="/home/mora/imgtokeychain"
LOG_DIR="$PROJECT_DIR/logs"

echo "🛑 Deteniendo servicios..."

# Detener por PIDs guardados
if [ -f "$LOG_DIR/api.pid" ]; then
    API_PID=$(cat "$LOG_DIR/api.pid")
    if ps -p $API_PID > /dev/null 2>&1; then
        kill $API_PID 2>/dev/null
        echo "   ✓ API detenido (PID: $API_PID)"
    fi
    rm "$LOG_DIR/api.pid"
fi

if [ -f "$LOG_DIR/worker.pid" ]; then
    WORKER_PID=$(cat "$LOG_DIR/worker.pid")
    if ps -p $WORKER_PID > /dev/null 2>&1; then
        kill $WORKER_PID 2>/dev/null
        echo "   ✓ Worker detenido (PID: $WORKER_PID)"
    fi
    rm "$LOG_DIR/worker.pid"
fi

if [ -f "$LOG_DIR/frontend.pid" ]; then
    FRONTEND_PID=$(cat "$LOG_DIR/frontend.pid")
    if ps -p $FRONTEND_PID > /dev/null 2>&1; then
        kill $FRONTEND_PID 2>/dev/null
        echo "   ✓ Frontend detenido (PID: $FRONTEND_PID)"
    fi
    rm "$LOG_DIR/frontend.pid"
fi

# Limpieza adicional por si acaso
pkill -f "tsx watch" 2>/dev/null
pkill -f "next dev" 2>/dev/null

echo "✅ Todos los servicios detenidos"
