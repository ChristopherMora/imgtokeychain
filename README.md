# 🔑 Imagen a Llavero 3D

Aplicación web para convertir imágenes (logos, diseños) en archivos STL 3D imprimibles como llaveros.

## 🚀 Características

- **Conversión automática**: Sube una imagen PNG/JPG y obtén un archivo STL 3D
- **Procesamiento inteligente**: Pipeline optimizado con Sharp, Potrace y OpenSCAD
- **Personalización completa**: Ajusta dimensiones, grosor, umbral de detección
- **Aro para llavero**: Opción de agregar argolla configurable (diámetro, grosor, posición)
- **Preview 3D en tiempo real**: Visualiza el modelo antes de descargar
- **Arquitectura escalable**: Microservicios con cola de trabajos asíncrona

## 🏗️ Arquitectura

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│  Frontend   │─────▶│  API Rest   │─────▶│   Worker    │
│  Next.js    │      │  Express    │      │   BullMQ    │
└─────────────┘      └─────────────┘      └─────────────┘
                            │                     │
                            ▼                     ▼
                     ┌─────────────┐      ┌─────────────┐
                     │ PostgreSQL  │      │    Redis    │
                     └─────────────┘      └─────────────┘
```

### Pipeline de Procesamiento

1. **Upload** → Imagen original (PNG/JPG)
2. **Preprocessing** → Sharp: resize, blur, contrast, threshold → PGM
3. **Vectorización** → Potrace: PGM → SVG (curvas suavizadas)
4. **Extrusión 3D** → OpenSCAD: SVG → STL
5. **Ring Generation** → OpenSCAD: STL + Torus → STL final

## 📦 Stack Tecnológico

**Frontend:**
- Next.js 14 (App Router)
- React 18 + TypeScript
- Tailwind CSS
- Three.js (@react-three/fiber, drei)
- Axios

**Backend:**
- Node.js 18 + Express
- Prisma ORM + PostgreSQL
- BullMQ + Redis
- Winston (logging)
- Helmet, CORS, rate limiting

**Worker:**
- Sharp 0.33.5 (procesamiento de imágenes)
- Potrace 2.1.8 (vectorización)
- OpenSCAD (modelado 3D)

**Infraestructura:**
- Docker + Docker Compose
- PostgreSQL 16
- Redis 7

## 🛠️ Instalación y Uso

### Requisitos Previos

- Docker y Docker Compose
- Node.js 18+ (solo para desarrollo local)

### Instalación con Docker (Producción)

```bash
# Clonar repositorio
git clone https://github.com/ChristopherMora/imgtokeychain.git
cd imgtokeychain

# Copiar variables de entorno
cp .env.example .env

# Construir y levantar servicios
docker compose build
docker compose up -d

# Verificar que todos los servicios estén corriendo
docker compose ps
```

La aplicación estará disponible en:
- Frontend: http://localhost:3000
- API: http://localhost:4000
- PostgreSQL: localhost:5432
- Redis: localhost:6379

### Desarrollo Local

```bash
# Instalar dependencias del frontend
cd frontend
npm install
npm run dev  # Puerto 3001 (si 3000 está ocupado)

# En otra terminal, levantar solo servicios de backend
docker compose up -d api worker db redis
```

## 🎨 Uso

1. Accede a `http://localhost:3000/crear-llavero`
2. Sube una imagen (PNG/JPG, máx 5MB)
3. Ajusta parámetros:
   - **Dimensiones**: ancho, alto, grosor
   - **Umbral**: control de detalle vs ruido (100-220)
   - **Aro**: activa/desactiva, configura diámetro, grosor y posición
4. Click en "Generar Llavero 3D"
5. Espera el procesamiento (progreso en tiempo real)
6. Preview 3D muestra el resultado
7. Descarga el archivo STL

## 📊 Configuración

Variables de entorno principales (`.env`):

```env
# API
API_PORT=4000
NODE_ENV=production
CORS_ORIGIN=http://localhost:3000

# Database
DATABASE_URL=postgresql://imgtokey:imgtokey123@db:5432/imgtokeychai

# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# Worker
WORKER_CONCURRENCY=2
WORKER_MAX_JOB_TIME=120000  # 2 minutos
IMAGE_THRESHOLD=180  # Umbral por defecto

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:4000/api
```

## 🏃 Comandos Útiles

```bash
# Ver logs
docker compose logs -f worker    # Logs del procesamiento
docker compose logs -f api       # Logs de la API
docker compose logs -f frontend  # Logs del frontend

# Reiniciar servicios
docker compose restart worker
docker compose restart api

# Reconstruir después de cambios de código
docker compose build worker
docker compose up -d worker

# Acceder a la base de datos
docker compose exec db psql -U imgtokey imgtokeychai

# Limpiar todo
docker compose down -v
```

## 📁 Estructura del Proyecto

```
imgtokeychai/
├── frontend/              # Next.js frontend
│   ├── src/
│   │   ├── app/          # App Router pages
│   │   └── components/   # React components
│   ├── Dockerfile
│   └── package.json
├── services/
│   ├── api/              # Express API
│   │   ├── src/
│   │   │   ├── controllers/
│   │   │   ├── routes/
│   │   │   └── middleware/
│   │   ├── prisma/
│   │   ├── Dockerfile
│   │   └── package.json
│   └── worker/           # BullMQ Worker
│       ├── src/
│       │   └── processors/  # Pipeline steps
│       ├── Dockerfile
│       └── package.json
├── storage/              # Archivos generados
│   ├── uploads/          # Imágenes originales
│   ├── processed/        # PGM, SVG, STL
│   └── temp/             # OpenSCAD scripts
├── docker-compose.yml
├── .env
└── README.md
```

## 🔧 Troubleshooting

### El worker no procesa trabajos

```bash
# Verificar que Redis esté accesible
docker compose exec worker npm run test:redis

# Ver logs detallados
docker compose logs worker --tail=100
```

### Error "Job not found"

El job puede haber expirado. Los trabajos se limpian después de completarse.

### Preview 3D no carga

1. Verifica que el job esté al 100%
2. Abre la consola del navegador (F12) y busca errores
3. Verifica que la API responda: `curl http://localhost:4000/api/jobs/{jobId}/download`

### Imagen distorsionada

Ajusta el umbral de detección:
- **Valor bajo (100-150)**: Más detalle pero más ruido
- **Valor medio (160-180)**: Balance recomendado
- **Valor alto (190-220)**: Más limpio pero puede perder detalle

## 📝 Mejoras Futuras

- [ ] Soporte para múltiples formatos (WebP, TIFF)
- [ ] Simplificación de malla (decimation) para archivos más pequeños
- [ ] Preview SVG antes de generar STL
- [ ] Caché de resultados
- [ ] Batch processing de múltiples imágenes
- [ ] Exportar configuraciones como presets
- [ ] Integración con servicios de impresión 3D

## 📄 Licencia

MIT License - Ver archivo LICENSE para más detalles

## 👤 Autor

Christopher Mora
- GitHub: [@ChristopherMora](https://github.com/ChristopherMora)

## 🙏 Agradecimientos

- Sharp - Procesamiento de imágenes de alto rendimiento
- Potrace - Trazado de bitmaps
- OpenSCAD - Modelado 3D programático
- Three.js - Visualización 3D en el navegador
