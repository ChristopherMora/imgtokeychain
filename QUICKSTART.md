# 🚀 Inicio Rápido

## Prerequisitos
- Docker y Docker Compose instalados
- Git

## Instalación en 3 pasos

### 1️⃣ Clonar y configurar

```bash
git clone https://github.com/tuusuario/imgtokeychai.git
cd imgtokeychai

# Copiar variables de entorno
cp .env.example .env
```

### 2️⃣ Levantar servicios

```bash
# Opción A: Usar script (recomendado)
bash scripts/dev-start.sh

# Opción B: Manual
docker compose up --build -d
```

### 3️⃣ Configurar base de datos

```bash
# Ejecutar migraciones
bash scripts/setup-db.sh

# O manualmente
docker compose exec api npx prisma migrate deploy
```

## ✅ Verificar instalación

```bash
# Health check
bash scripts/health-check.sh

# Ver logs
bash scripts/logs.sh

# Logs de un servicio específico
bash scripts/logs.sh api
```

## 🌐 Acceso

- **Frontend**: http://localhost:3000
- **API**: http://localhost:4000
- **Health**: http://localhost:4000/health

## 🛑 Detener

```bash
# Detener servicios
docker compose down

# Detener y limpiar volúmenes
docker compose down -v

# Limpieza completa
bash scripts/clean.sh
```

## 📝 Comandos útiles

```bash
# Ver logs en tiempo real
docker compose logs -f

# Reiniciar un servicio
docker compose restart api

# Rebuild un servicio
docker compose up --build api

# Entrar a un contenedor
docker compose exec api sh

# Ver estado de servicios
docker compose ps
```

## 🐛 Troubleshooting

### Error: Puerto 3000 ocupado
```bash
# Cambiar puerto en .env
FRONTEND_PORT=3001

# O detener servicio que lo usa
lsof -ti:3000 | xargs kill
```

### Error: Base de datos no conecta
```bash
# Verificar que db esté corriendo
docker compose ps db

# Reiniciar base de datos
docker compose restart db

# Ver logs de db
docker compose logs db
```

### Error: Worker no procesa jobs
```bash
# Ver logs del worker
docker compose logs worker

# Verificar Redis
docker compose exec redis redis-cli ping
```

## 🔄 Desarrollo

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### API
```bash
cd services/api
npm install
npm run dev
```

### Worker
```bash
cd services/worker
npm install
npm run dev
```

## 📦 Estructura de Datos

### Job Status Flow
```
PENDING → PROCESSING → COMPLETED
                     ↘ FAILED
```

### Storage
```
storage/
├── uploads/      # Imágenes originales
├── processed/    # Procesadas + SVG + STL
└── temp/         # Archivos temporales
```

---

**¿Problemas?** Abre un issue en GitHub
