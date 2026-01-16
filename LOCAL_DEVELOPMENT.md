# 💻 Desarrollo Local - Imagen a Llavero 3D

**Última actualización:** 16 de enero de 2026

## 🎯 Estado Actual del Proyecto

**Progreso:** 11/15 tareas completadas (73%)

### ✅ Completado
- ✅ Estructura del proyecto
- ✅ Docker Compose (5 servicios)
- ✅ Frontend Next.js (5 componentes)
- ✅ Backend API (4 endpoints)
- ✅ Worker con pipeline completo
- ✅ Base de datos con Prisma
- ✅ Documentación (6 archivos)
- ✅ Tests básicos (2 suites)

### ⏳ Pendiente
- ⚠️ Ejecutar migraciones de Prisma (requiere DB)
- ⚠️ Pruebas end-to-end (requiere Docker)
- ⚠️ Deploy en Dokploy

---

## 🚀 Opciones de Desarrollo

### Opción 1: Con Docker (Recomendado)

**Requisitos:**
- Docker Desktop para WSL2
- 4GB RAM disponible
- 10GB espacio en disco

**Pasos:**

```bash
# 1. Instalar Docker Desktop
# Descargar de: https://www.docker.com/products/docker-desktop

# 2. Habilitar integración con WSL2
# En Docker Desktop Settings > Resources > WSL Integration

# 3. Levantar servicios
cd /home/mora/imgtokeychain
docker compose up --build -d

# 4. Ejecutar migraciones
docker compose exec api npx prisma migrate deploy

# 5. Ver logs
docker compose logs -f

# 6. Acceder
# Frontend: http://localhost:3000
# API: http://localhost:4000
```

**Scripts disponibles:**
```bash
bash scripts/dev-start.sh      # Iniciar todo
bash scripts/health-check.sh   # Verificar servicios
bash scripts/logs.sh           # Ver logs
bash scripts/clean.sh          # Limpiar y reiniciar
```

---

### Opción 2: Sin Docker (Desarrollo Local)

**Requisitos:**
- Node.js 18+
- PostgreSQL 14+
- Redis 7+
- OpenSCAD
- Potrace

#### 2.1 Instalar Dependencias del Sistema

```bash
# PostgreSQL
sudo apt update
sudo apt install postgresql postgresql-contrib

# Redis
sudo apt install redis-server

# OpenSCAD (para generación STL)
sudo apt install openscad

# Potrace (para vectorización)
sudo apt install potrace

# Sharp dependencies
sudo apt install libvips-dev
```

#### 2.2 Configurar Base de Datos

```bash
# Iniciar PostgreSQL
sudo service postgresql start

# Crear usuario y base de datos
sudo -u postgres psql
```

```sql
CREATE USER imgtokey WITH PASSWORD 'imgtokey123';
CREATE DATABASE imgtokey_db OWNER imgtokey;
\q
```

#### 2.3 Configurar Redis

```bash
# Iniciar Redis
sudo service redis-server start

# Verificar
redis-cli ping  # Debe responder: PONG
```

#### 2.4 Instalar Dependencias Node.js

```bash
cd /home/mora/imgtokeychain

# API
cd services/api
npm install
npm run prisma:generate
npm run prisma:migrate

# Worker
cd ../worker
npm install

# Frontend
cd ../../frontend
npm install
```

#### 2.5 Ejecutar Servicios Manualmente

**Terminal 1 - API:**
```bash
cd /home/mora/imgtokeychain/services/api
npm run dev
# Escucha en: http://localhost:4000
```

**Terminal 2 - Worker:**
```bash
cd /home/mora/imgtokeychain/services/worker
npm run dev
# Procesa jobs de la cola
```

**Terminal 3 - Frontend:**
```bash
cd /home/mora/imgtokeychain/frontend
npm run dev
# Abre: http://localhost:3000
```

---

### Opción 3: Desarrollo Solo Frontend

Si solo quieres trabajar en la UI sin levantar backend:

```bash
cd frontend
npm run dev
```

**Limitaciones:**
- No se pueden subir imágenes reales
- No hay procesamiento de STL
- Solo diseño y componentes visuales

**Mock data para desarrollo:**
```typescript
// Agregar en src/lib/api.ts
const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK === 'true'

if (MOCK_MODE) {
  return {
    id: 'mock-123',
    status: 'COMPLETED',
    progress: 100,
    // ... datos mock
  }
}
```

---

## 🧪 Ejecutar Tests

```bash
cd services/api

# Instalar dependencias de test (ya instaladas)
npm install

# Ejecutar tests
npm test

# Watch mode (re-ejecuta al guardar)
npm run test:watch

# Con coverage
npm run test:coverage
```

**Tests disponibles:**
- ✅ Health check endpoint
- ✅ Validación de archivos
- ⏳ Jobs endpoints (pendiente)
- ⏳ Error handling (pendiente)

---

## 📁 Estructura de Archivos Importantes

```
/home/mora/imgtokeychain/
├── .env                          # Variables de entorno (creado)
├── .env.example                  # Template
├── docker-compose.yml            # Configuración Docker
│
├── frontend/                     # ✅ Completo
│   ├── src/app/
│   │   ├── page.tsx             # Landing page
│   │   └── crear-llavero/       # Página principal
│   └── src/components/          # 5 componentes
│
├── services/api/                 # ✅ Completo
│   ├── src/
│   │   ├── index.ts             # Servidor Express
│   │   ├── routes/              # Health + Jobs
│   │   ├── controllers/         # Lógica de negocio
│   │   ├── middleware/          # Validaciones
│   │   └── __tests__/           # Tests (nuevo)
│   └── prisma/
│       └── schema.prisma        # Modelos DB
│
├── services/worker/              # ✅ Completo
│   └── src/
│       ├── index.ts             # Worker BullMQ
│       └── processors/          # Pipeline completo
│
├── examples/                     # 📁 Nuevo
│   └── README.md                # Guía de imágenes de prueba
│
└── scripts/                      # ✅ Completo
    ├── dev-start.sh             # Iniciar con Docker
    ├── health-check.sh          # Verificar servicios
    ├── logs.sh                  # Ver logs
    ├── clean.sh                 # Limpiar Docker
    └── setup-db.sh              # Configurar DB
```

---

## 🐛 Troubleshooting

### Error: "Cannot connect to PostgreSQL"

```bash
# Verificar que PostgreSQL está corriendo
sudo service postgresql status

# Verificar conexión
psql -U imgtokey -d imgtokey_db -h localhost
```

### Error: "Cannot connect to Redis"

```bash
# Verificar Redis
sudo service redis-server status
redis-cli ping

# Reiniciar si es necesario
sudo service redis-server restart
```

### Error: "OpenSCAD not found"

```bash
# Instalar OpenSCAD
sudo apt install openscad

# Verificar instalación
which openscad
openscad --version
```

### Error: "Module not found"

```bash
# Reinstalar dependencias
cd services/api  # o worker/frontend
rm -rf node_modules package-lock.json
npm install
```

### Puertos ya en uso

```bash
# Verificar qué usa el puerto
sudo lsof -i :3000  # Frontend
sudo lsof -i :4000  # API
sudo lsof -i :5432  # PostgreSQL
sudo lsof -i :6379  # Redis

# Matar proceso
kill -9 <PID>

# O cambiar puerto en .env
```

---

## 📊 Verificar que Todo Funciona

### 1. Health Check

```bash
curl http://localhost:4000/health
```

Respuesta esperada:
```json
{
  "status": "ok",
  "timestamp": "2026-01-16T...",
  "uptime": 123.45
}
```

### 2. Subir Imagen de Prueba

```bash
curl -X POST http://localhost:4000/api/jobs \
  -F "file=@examples/logo.png" \
  -F "widthMm=50" \
  -F "heightMm=50" \
  -F "thicknessMm=3"
```

### 3. Verificar Estado del Job

```bash
curl http://localhost:4000/api/jobs/<JOB_ID>
```

### 4. Ver Logs del Worker

```bash
# Con Docker
docker compose logs worker -f

# Sin Docker
# Ver terminal donde corre npm run dev
```

---

## 🎯 Próximos Pasos

1. **Instalar Docker Desktop** (recomendado)
   - Más fácil y completo
   - Incluye todas las dependencias
   - Un solo comando para levantar todo

2. **O configurar entorno local**
   - Más control
   - Desarrollo más rápido (sin rebuild)
   - Requiere más configuración inicial

3. **Añadir imágenes de prueba**
   - Logos simples PNG en `examples/`
   - Probar el flujo completo

4. **Completar tests**
   - Tests de integración
   - Tests del pipeline completo

5. **Deploy en Dokploy**
   - Seguir guía en `DEPLOY.md`
   - Configurar dominio y SSL

---

## 📚 Recursos Adicionales

- [README.md](README.md) - Documentación principal
- [QUICKSTART.md](QUICKSTART.md) - Inicio rápido con Docker
- [DEPLOY.md](DEPLOY.md) - Guía de deployment
- [TASKS.md](TASKS.md) - Lista de tareas actualizada
- [examples/README.md](examples/README.md) - Guía de imágenes

---

## 💡 Tips

- Empieza con imágenes simples (logos, íconos)
- Usa el preview 3D para validar antes de generar
- Los logs del worker son muy detallados
- El procesamiento toma 10-30 segundos
- Puedes ver la cola en Redis con `redis-cli`

---

**¿Necesitas ayuda?** Abre un issue en el repositorio o revisa los logs con `bash scripts/logs.sh`
