#!/bin/bash

# Script de verificación del proyecto

echo "🔍 VERIFICACIÓN DEL PROYECTO - Imagen a Llavero 3D"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 1. Verificar que los servicios estén corriendo
echo "1️⃣  Verificando servicios..."
echo ""

# Frontend
if lsof -ti:3000 > /dev/null 2>&1; then
    echo "   ✅ Frontend (puerto 3000): CORRIENDO"
else
    echo "   ❌ Frontend (puerto 3000): NO RESPONDE"
fi

# API
if lsof -ti:4000 > /dev/null 2>&1; then
    echo "   ✅ API (puerto 4000): CORRIENDO"
else
    echo "   ❌ API (puerto 4000): NO RESPONDE"
fi

# Redis
if lsof -ti:6379 > /dev/null 2>&1; then
    echo "   ✅ Redis (puerto 6379): CORRIENDO"
else
    echo "   ❌ Redis (puerto 6379): NO RESPONDE"
fi

# PostgreSQL
if lsof -ti:5432 > /dev/null 2>&1; then
    echo "   ✅ PostgreSQL (puerto 5432): CORRIENDO"
else
    echo "   ⚠️  PostgreSQL (puerto 5432): NO DETECTADO (normal si usa Docker)"
fi

echo ""
echo "2️⃣  Verificando archivos creados/modificados..."
echo ""

# Archivos nuevos
if [ -f "frontend/src/components/ColorPicker.tsx" ]; then
    echo "   ✅ ColorPicker.tsx: CREADO"
else
    echo "   ❌ ColorPicker.tsx: NO ENCONTRADO"
fi

if [ -f "services/worker/src/processors/regenerate3MF.ts" ]; then
    echo "   ✅ regenerate3MF.ts: CREADO"
else
    echo "   ❌ regenerate3MF.ts: NO ENCONTRADO"
fi

# Documentación
if [ -f "ACTUALIZACION_COLORES_2026.md" ]; then
    echo "   ✅ ACTUALIZACION_COLORES_2026.md: CREADO"
else
    echo "   ❌ ACTUALIZACION_COLORES_2026.md: NO ENCONTRADO"
fi

if [ -f "FEATURE_COLOR_PERSONALIZATION.md" ]; then
    echo "   ✅ FEATURE_COLOR_PERSONALIZATION.md: CREADO"
else
    echo "   ❌ FEATURE_COLOR_PERSONALIZATION.md: NO ENCONTRADO"
fi

if [ -f "RESUMEN_EJECUTIVO.md" ]; then
    echo "   ✅ RESUMEN_EJECUTIVO.md: CREADO"
else
    echo "   ❌ RESUMEN_EJECUTIVO.md: NO ENCONTRADO"
fi

echo ""
echo "3️⃣  Verificando endpoints API..."
echo ""

# Health check
API_URL="http://localhost:4000/api"

# GET /api/jobs (debería retornar error si no hay auth, pero debe responder)
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$API_URL/jobs/test-nonexistent" 2>/dev/null)
if [ "$RESPONSE" = "404" ] || [ "$RESPONSE" = "400" ] || [ "$RESPONSE" = "200" ]; then
    echo "   ✅ API disponible (HTTP $RESPONSE)"
else
    echo "   ❌ API no responde (HTTP $RESPONSE)"
fi

echo ""
echo "4️⃣  Verificando procesos..."
echo ""

# Contar archivos en storage/processed
PROCESSED_FILES=$(find storage/processed -type f 2>/dev/null | wc -l)
echo "   📁 Archivos procesados: $PROCESSED_FILES"

# Verificar logs
if [ -f "logs/frontend.log" ]; then
    echo "   ✅ logs/frontend.log existe"
else
    echo "   ⚠️  logs/frontend.log no existe"
fi

if [ -f "logs/api.log" ]; then
    echo "   ✅ logs/api.log existe"
else
    echo "   ⚠️  logs/api.log no existe"
fi

if [ -f "logs/worker.log" ]; then
    echo "   ✅ logs/worker.log existe"
else
    echo "   ⚠️  logs/worker.log no existe"
fi

echo ""
echo "5️⃣  Comprobaciones rápidas..."
echo ""

# Verificar que node_stl está instalado
if grep -q "node-stl" services/worker/package.json; then
    echo "   ✅ node-stl en package.json"
else
    echo "   ❌ node-stl NO ENCONTRADO en package.json"
fi

# Verificar que stlParser existe
if [ -f "services/worker/src/processors/stlParser.ts" ]; then
    echo "   ✅ stlParser.ts existe"
else
    echo "   ❌ stlParser.ts NO ENCONTRADO"
fi

# Verificar que colorGenerator existe
if [ -f "services/worker/src/processors/colorGenerator.ts" ]; then
    echo "   ✅ colorGenerator.ts existe"
else
    echo "   ❌ colorGenerator.ts NO ENCONTRADO"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ VERIFICACIÓN COMPLETADA"
echo ""
echo "📍 URLs disponibles:"
echo "   - Frontend: http://localhost:3000"
echo "   - API: http://localhost:4000"
echo ""
echo "📝 Ver logs:"
echo "   - tail -f logs/frontend.log"
echo "   - tail -f logs/api.log"
echo "   - tail -f logs/worker.log"
echo ""
echo "🛑 Detener servicios:"
echo "   - bash stop-all.sh"
echo ""
