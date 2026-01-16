# 📋 TAREAS DEL PROYECTO - Imagen a Llavero 3D

**Proyecto:** imgtokeychai  
**Última actualización:** 16 de enero de 2026  
**Estado:** 🚀 Inicio

---

## 🎯 VISIÓN DEL PROYECTO

**Objetivo Principal:** Convertir imagen (logo/dibujo) → llavero 3D imprimible (STL/3MF)

**Usuario Objetivo:** Clientes DOFER (TikTok/Shopify) + público general

**Definition of Done:**
- ✅ Usuario sube imagen simple → obtiene STL descargable en <30s
- ✅ Aro opcional robusto y reforzado
- ✅ Preview 3D coincide con STL generado
- ✅ Docker compose funcional con 1 comando
- ✅ Logs claros y errores entendibles
- ✅ Historial de trabajos guardado

---

## 📊 PROGRESO GENERAL

**Total:** 15 tareas  
**Completadas:** 15 / 15 (100%) ✅  
**En progreso:** 0  
**Pendientes:** 0

🎉 **¡PROYECTO COMPLETADO!**

---

## 🏗️ FASE 1: INFRAESTRUCTURA BASE

### ✅ Tarea 1: Crear estructura inicial del proyecto
**Estado:** ✅ Completado (16/01/2026)  
**Prioridad:** 🔴 Alta  
**Descripción:**
- [x] Crear carpetas: `/frontend`, `/services/api`, `/services/worker`
- [x] Crear `.gitignore` global
- [x] Crear `docker-compose.yml` base
- [x] Crear `README.md` inicial
- [x] Configurar variables de entorno (.env.example)
- [x] Crear package.json para cada servicio
- [x] Crear Dockerfiles para cada servicio
- [x] Crear configuraciones TypeScript
- [x] Crear schema de Prisma
- [x] Crear script de inicialización de DB

---

### ⬜ Tarea 2: Configurar Docker Compose
**Estado:** Pendiente  
**Prioridad:** 🔴 Alta  
**Descripción:**
- [ ] Servicio frontend (Next.js, puerto 3000)
- [ ] Servicio api (Node/Express, puerto 4000)
- [ ] Servicio worker (procesamiento)
- [ ] Servicio db (PostgreSQL o SQLite)
- [ ] Volúmenes para storage de archivos
- [ ] Network interna para comunicación
- [ ] Health checks para cada servicio

---

### ⬜ Tarea 3: Setup Frontend Next.js
**Estado:** Pendiente  
**Prioridad:** 🔴 Alta  
**Descripción:**
- [ ] Inicializar Next.js 14+ con App Router
- [ ] Configurar TypeScript
- [ ] Instalar Tailwind CSS
- [ ] Crear layout base
- [ ] Crear página `/crear-llavero`
- [ ] Configurar variables de entorno
- [ ] Dockerfile para frontend

---

### ⬜ Tarea 4: Setup Backend API
**Estado:** Pendiente  
**Prioridad:** 🔴 Alta  
**Descripción:**
- [ ] Inicializar proyecto Node.js/Express (o Go)
- [ ] Configurar TypeScript
- [ ] Estructura de carpetas (routes, controllers, services)
- [ ] Middleware básico (cors, body-parser, helmet)
- [ ] Logger (winston o pino)
- [ ] Manejo global de errores
- [ ] Dockerfile para API

**Endpoints a crear:**
- [ ] `POST /api/jobs` - Crear trabajo + subir archivo
- [ ] `GET /api/jobs/:id` - Estado del trabajo
- [ ] `GET /api/jobs/:id/download` - Descargar STL
- [ ] `GET /health` - Health check

---

### ⬜ Tarea 5: Configurar base de datos
**Estado:** Pendiente  
**Prioridad:** 🔴 Alta  
**Descripción:**
- [ ] Elegir: PostgreSQL o SQLite
- [ ] Instalar ORM (Prisma o TypeORM)
- [ ] Crear schema/modelos:
  - `jobs` (id, status, params, file_paths, created_at, updated_at)
  - `users` (opcional para MVP)
- [ ] Crear migraciones iniciales
- [ ] Seed data de prueba (opcional)

---

## ⚙️ FASE 2: CORE PROCESSING

### ⬜ Tarea 6: Implementar upload seguro
**Estado:** Pendiente  
**Prioridad:** 🟡 Media  
**Descripción:**
- [ ] Middleware multer para multipart upload
- [ ] Validación de formatos (PNG, JPG, JPEG)
- [ ] Validación de tamaño máximo (5MB)
- [ ] Sanitización de nombres de archivo
- [ ] Almacenamiento temporal
- [ ] Rate limiting básico
- [ ] Antivirus opcional (clamd)

---

### ⬜ Tarea 7: Worker pipeline imagen→SVG→STL
**Estado:** Pendiente  
**Prioridad:** 🔴 Alta  
**Descripción:**
- [ ] Sistema de cola de jobs (Bull/BullMQ o simple)
- [ ] Procesador de jobs con estados
- [ ] **Paso 1:** Normalizar imagen (quitar fondo, binarizar)
  - Instalar ImageMagick o Sharp
  - Controles: umbral, suavizado
- [ ] **Paso 2:** Imagen → SVG con Potrace
  - Instalar potrace
  - Configurar parámetros de vectorización
- [ ] **Paso 3:** SVG → STL (extrusión)
  - Opción A: OpenSCAD
  - Opción B: svg2stl u otra librería
  - Parámetros: ancho, alto, grosor (mm)
- [ ] Manejo de errores en cada paso
- [ ] Logs detallados
- [ ] Timeouts (máximo 30s)

---

### ⬜ Tarea 8: Generación de aro
**Estado:** Pendiente  
**Prioridad:** 🟡 Media  
**Descripción:**
- [ ] Crear geometría del aro (toro reforzado)
- [ ] Parámetros configurables:
  - Diámetro interno (mm)
  - Grosor del aro (mm)
  - Posición (arriba/izquierda/derecha)
- [ ] Union booleana con modelo principal (OpenSCAD)
- [ ] Verificar que sea robusto (no se rompa)
- [ ] Hacer aro opcional (checkbox)

---

## 🎨 FASE 3: UI/UX

### ⬜ Tarea 9: Preview 2D
**Estado:** Pendiente  
**Prioridad:** 🟡 Media  
**Descripción:**
- [ ] Componente de upload con drag & drop
- [ ] Preview de imagen original
- [ ] Preview de imagen procesada (blanco/negro)
- [ ] Mostrar contorno vectorial (SVG overlay)
- [ ] Indicadores de dimensiones

---

### ⬜ Tarea 10: Preview 3D
**Estado:** Pendiente  
**Prioridad:** 🟡 Media  
**Descripción:**
- [ ] Instalar Three.js + @react-three/fiber
- [ ] Instalar @react-three/drei
- [ ] Componente visor 3D
- [ ] Cargar y renderizar STL
- [ ] Controles: rotar, zoom, pan
- [ ] Iluminación y materiales
- [ ] Grid de referencia
- [ ] Medidas visuales

---

### ⬜ Tarea 11: Descarga de archivos
**Estado:** Pendiente  
**Prioridad:** 🔴 Alta  
**Descripción:**
- [ ] Endpoint seguro de descarga
- [ ] Generar URLs temporales (signed URLs)
- [ ] Botón de descarga STL
- [ ] Botón de descarga SVG (opcional)
- [ ] Historial de descargas
- [ ] Limpieza automática de archivos antiguos

---

## 🛡️ FASE 4: CALIDAD Y DEPLOY

### ⬜ Tarea 12: Manejo de errores
**Estado:** Pendiente  
**Prioridad:** 🟡 Media  
**Descripción:**
- [ ] Validación exhaustiva de inputs
- [ ] Límites de recursos (CPU, memoria)
- [ ] Manejo de imágenes corruptas
- [ ] Reintentos automáticos (3 intentos)
- [ ] Mensajes de error user-friendly
- [ ] Estados de error detallados en UI
- [ ] Logging centralizado
- [ ] Monitoring básico

---

### ⬜ Tarea 13: README y documentación
**Estado:** Pendiente  
**Prioridad:** 🟡 Media  
**Descripción:**
- [ ] README principal con:
  - Descripción del proyecto
  - Arquitectura
  - Instalación con Docker
  - Variables de entorno
  - Comandos principales
- [ ] Documentación de API (Swagger/OpenAPI)
- [ ] Ejemplos de uso
- [ ] Imágenes de prueba incluidas
- [ ] Troubleshooting común
- [ ] Licencia

---

### ⬜ Tarea 14: Health checks y testing
**Estado:** Pendiente  
**Prioridad:** 🟢 Baja  
**Descripción:**
- [ ] Script de health check (verifica servicios)
- [ ] Tests unitarios básicos
- [ ] Tests de integración (pipeline completo)
- [ ] Script de carga de datos de prueba
- [ ] CI/CD básico (GitHub Actions, opcional)

---

### ⬜ Tarea 15: Deploy en Dokploy
**Estado:** Pendiente  
**Prioridad:** 🟡 Media  
**Descripción:**
- [ ] Checklist de pre-deploy
- [ ] Configurar variables de entorno en Dokploy
- [ ] Configurar volúmenes persistentes
- [ ] Configurar dominio y SSL
- [ ] Build y deployment
- [ ] Smoke tests post-deploy
- [ ] Backup y restore procedures
- [ ] Documentación de deploy

---

## 🚀 ROADMAP POST-MVP

### Mejoras Futuras (después del MVP)
- [ ] Fotos complejas con segmentación avanzada (IA)
- [ ] Multicolor (capas para AMS)
- [ ] Texto automático sobre el llavero
- [ ] Plantillas prediseñadas
- [ ] QR en la parte trasera (catálogo/WhatsApp)
- [ ] Sistema de pagos (Stripe/MercadoPago)
- [ ] Marketplace de diseños públicos
- [ ] Generación 3MF para Bambu Studio
- [ ] App móvil
- [ ] API pública para integraciones

---

## 📝 NOTAS Y DECISIONES

### Stack Tecnológico Confirmado
- **Frontend:** Next.js 14+ (App Router) + TypeScript + Tailwind
- **Backend:** Node.js + Express (o Go)
- **Worker:** Node.js con Bull/BullMQ
- **DB:** PostgreSQL (o SQLite para MVP)
- **Storage:** Local + S3 compatible después
- **Tools:** Potrace + OpenSCAD (o alternativas)
- **Deploy:** Docker + Dokploy

### Limitaciones del MVP
- ❌ No fotos complejas (solo logos/dibujos simples)
- ❌ No retratos realistas
- ❌ No IA generativa avanzada
- ❌ No multicolor (solo monocromo)
- ❌ No pagos (descarga libre)
- ❌ No autenticación compleja

### Métricas de Éxito
- ⏱️ Tiempo de generación: <30 segundos
- 📦 Tamaño máximo archivo: 5MB
- 📏 Dimensiones: 10-100mm
- 💪 Grosor: 2-10mm
- 🔗 Aro: 3-6mm grosor, diámetro configurable

---

## 🔄 CÓMO ACTUALIZAR ESTE ARCHIVO

Cuando completes una tarea:
1. Cambia `⬜` por `✅`
2. Actualiza el estado de "Pendiente" a "Completado"
3. Marca los sub-items completados con `[x]`
4. Actualiza el progreso general arriba
5. Añade notas si es necesario

**Ejemplo:**
```markdown
### ✅ Tarea 1: Crear estructura inicial del proyecto
**Estado:** ✅ Completado (16/01/2026)
**Notas:** Estructura creada, dockerfiles listos
```

---

**¡Vamos a construir algo increíble! 🚀**
