# 🚀 Deploy en Dokploy

## Prerequisitos

- Servidor con Dokploy instalado
- Dominio configurado (opcional)
- Acceso SSH al servidor

## Paso 1: Preparar el Servidor

```bash
# Conectar al servidor
ssh user@your-server.com

# Verificar Dokploy está corriendo
docker ps | grep dokploy
```

## Paso 2: Crear Proyecto en Dokploy

1. Accede a Dokploy UI: `http://your-server.com:3000`
2. Crear nuevo proyecto: "imgtokeychai"
3. Tipo: **Docker Compose**

## Paso 3: Configurar Variables de Entorno

En Dokploy, añade estas variables:

```env
NODE_ENV=production
TZ=UTC

# Frontend
NEXT_PUBLIC_API_URL=https://api.yourdomain.com/api
NEXT_PUBLIC_APP_NAME=Imagen a Llavero 3D

# API
API_PORT=4000
API_HOST=0.0.0.0
API_SECRET_KEY=CAMBIAR_POR_SECRETO_SEGURO_RANDOM
CORS_ORIGIN=https://yourdomain.com

# Database
DATABASE_URL=postgresql://imgtokey:PASSWORD_SEGURO@db:5432/imgtokey_db

# Redis
REDIS_URL=redis://redis:6379

# Worker
WORKER_CONCURRENCY=4
WORKER_MAX_JOB_TIME=30000

# Storage
STORAGE_TYPE=local
STORAGE_PATH=/app/storage
MAX_FILE_SIZE=5242880

# Processing
MIN_SIZE_MM=10
MAX_SIZE_MM=100
MIN_THICKNESS_MM=2
MAX_THICKNESS_MM=10

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=20

# Logs
LOG_LEVEL=info
LOG_FORMAT=json

# Security
HELMET_ENABLED=true
```

## Paso 4: Configurar Volúmenes

En Dokploy, configurar volúmenes persistentes:

```yaml
volumes:
  - postgres-data:/var/lib/postgresql/data
  - redis-data:/data
  - ./storage:/app/storage
```

## Paso 5: Configurar Dominio y SSL

### Opción A: Con dominio personalizado

1. En Dokploy, ir a "Domains"
2. Añadir dominio: `imgtokey.yourdomain.com`
3. Habilitar SSL automático (Let's Encrypt)

### Opción B: Sin dominio (IP del servidor)

Acceder vía IP: `http://YOUR_SERVER_IP:3000`

## Paso 6: Deploy

```bash
# En Dokploy UI:
# 1. Click en "Deploy"
# 2. Esperar build (5-10 minutos primera vez)
# 3. Verificar logs

# O desde terminal:
cd /path/to/dokploy/projects/imgtokeychai
docker compose -f docker-compose.prod.yml up -d
```

## Paso 7: Verificar Deployment

```bash
# Health check
curl https://api.yourdomain.com/health

# O con IP
curl http://YOUR_SERVER_IP:4000/health

# Ver logs
docker compose logs -f

# Ver estado
docker compose ps
```

## 🔧 Docker Compose Producción

Crear `docker-compose.prod.yml` (si no existe en Dokploy):

```yaml
version: '3.8'

services:
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    restart: always
    environment:
      - NODE_ENV=production
      - NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
    ports:
      - "3000:3000"
    depends_on:
      - api
    networks:
      - imgtokey-network

  api:
    build:
      context: ./services/api
      dockerfile: Dockerfile
    restart: always
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
    ports:
      - "4000:4000"
    volumes:
      - ./storage:/app/storage
    depends_on:
      - db
      - redis
    networks:
      - imgtokey-network

  worker:
    build:
      context: ./services/worker
      dockerfile: Dockerfile
    restart: always
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
    volumes:
      - ./storage:/app/storage
    depends_on:
      - db
      - redis
    networks:
      - imgtokey-network

  db:
    image: postgres:16-alpine
    restart: always
    environment:
      - POSTGRES_USER=imgtokey
      - POSTGRES_PASSWORD=${DB_PASSWORD}
      - POSTGRES_DB=imgtokey_db
    volumes:
      - postgres-data:/var/lib/postgresql/data
    networks:
      - imgtokey-network

  redis:
    image: redis:7-alpine
    restart: always
    volumes:
      - redis-data:/data
    networks:
      - imgtokey-network

volumes:
  postgres-data:
  redis-data:

networks:
  imgtokey-network:
    driver: bridge
```

## 🔐 Seguridad Post-Deploy

### 1. Cambiar secretos
```bash
# Generar secretos seguros
openssl rand -base64 32

# Actualizar en variables de entorno:
# - API_SECRET_KEY
# - POSTGRES_PASSWORD
```

### 2. Configurar firewall
```bash
# Permitir solo puertos necesarios
ufw allow 22    # SSH
ufw allow 80    # HTTP
ufw allow 443   # HTTPS
ufw allow 3000  # Frontend (si no usas proxy)
ufw enable
```

### 3. Backup automático
```bash
# Crear script de backup
cat > /root/backup-imgtokey.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
docker compose exec -T db pg_dump -U imgtokey imgtokey_db > /backups/imgtokey_${DATE}.sql
find /backups -name "imgtokey_*.sql" -mtime +7 -delete
EOF

chmod +x /root/backup-imgtokey.sh

# Añadir a crontab (diario a las 3am)
echo "0 3 * * * /root/backup-imgtokey.sh" | crontab -
```

## 📊 Monitoreo

### Logs en producción
```bash
# Ver todos los logs
docker compose logs -f --tail=100

# Solo errores
docker compose logs -f | grep ERROR

# Servicio específico
docker compose logs -f api
```

### Métricas
```bash
# Uso de recursos
docker stats

# Estado de servicios
docker compose ps

# Health checks
watch -n 5 'curl -s http://localhost:4000/health | jq'
```

## 🔄 Actualizar en Producción

```bash
# 1. Pull cambios
git pull origin main

# 2. Rebuild
docker compose down
docker compose up --build -d

# 3. Verificar
bash scripts/health-check.sh
```

## 🆘 Rollback

```bash
# Volver a versión anterior
git checkout <commit-hash>
docker compose up --build -d
```

## 📝 Checklist Final

- [ ] Variables de entorno configuradas
- [ ] Secretos cambiados (no usar los de ejemplo)
- [ ] Volúmenes persistentes configurados
- [ ] Dominio y SSL configurados
- [ ] Firewall configurado
- [ ] Backup automático configurado
- [ ] Health check funcionando
- [ ] Frontend accesible
- [ ] API respondiendo
- [ ] Worker procesando jobs
- [ ] Base de datos persistente
- [ ] Logs monitoreados

## 🎉 ¡Deploy Completo!

Tu aplicación está corriendo en:
- Frontend: https://yourdomain.com
- API: https://api.yourdomain.com
- Health: https://api.yourdomain.com/health

---

**Soporte:** Revisa logs con `docker compose logs -f`
