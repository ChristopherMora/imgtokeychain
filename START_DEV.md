# 🚀 DESARROLLO LOCAL CONFIGURADO

## ✅ TODO LISTO PARA DESARROLLAR

Todas las dependencias están instaladas y configuradas:
- ✅ PostgreSQL corriendo
- ✅ Redis corriendo  
- ✅ OpenSCAD instalado
- ✅ Potrace instalado
- ✅ Sharp dependencies (libvips)
- ✅ Base de datos creada y migrada
- ✅ Variables de entorno configuradas

---

## 🎯 INICIAR DESARROLLO (3 terminales)

### Terminal 1 - API (Backend)
```bash
cd /home/mora/imgtokeychain/services/api
npm run dev
```
**URL:** http://localhost:4000  
**Hot-reload:** ✅ Activado (cambios se aplican al guardar)

---

### Terminal 2 - Worker (Procesamiento)
```bash
cd /home/mora/imgtokeychain/services/worker
npm run dev
```
**Función:** Procesa las imágenes → SVG → STL  
**Hot-reload:** ✅ Activado

---

### Terminal 3 - Frontend (Next.js)
```bash
cd /home/mora/imgtokeychain/frontend
npm run dev
```
**URL:** http://localhost:3000  
**Hot-reload:** ✅ Activado (Fast Refresh)

---

## ⚡ VENTAJAS vs DOCKER

| Aspecto | Docker | Desarrollo Local |
|---------|--------|------------------|
| **Cambios en código** | Requiere rebuild | ⚡ Instantáneo |
| **Hot-reload** | ❌ No funciona bien | ✅ Completo |
| **Debugging** | Difícil | ✅ Fácil |
| **Logs** | Mixtos | ✅ Separados por servicio |
| **Recursos** | Alto uso RAM | 💚 Menos recursos |
| **Velocidad inicial** | Lento (build) | ⚡ Rápido |

---

## 🧪 PROBAR QUE FUNCIONA

### 1. Health Check
```bash
curl http://localhost:4000/health
```
Debe responder:
```json
{
  "status": "ok",
  "timestamp": "2026-01-16...",
  "uptime": 10.5
}
```

### 2. Crear un Job (subir imagen)
```bash
# Crear una imagen de prueba primero
cd /home/mora/imgtokeychain
# (coloca una imagen PNG en examples/)

curl -X POST http://localhost:4000/api/jobs \
  -F "file=@examples/logo.png" \
  -F "widthMm=50" \
  -F "heightMm=50" \
  -F "thicknessMm=3" \
  -F "ringEnabled=true"
```

### 3. Ver el Job
Guarda el ID del paso anterior y consulta:
```bash
curl http://localhost:4000/api/jobs/<JOB_ID>
```

### 4. Abrir Frontend
Abre http://localhost:3000 y prueba subir una imagen.

---

## 📝 WORKFLOW DE DESARROLLO

1. **Hacer cambios** en cualquier archivo
2. **Guardar** (Ctrl+S)
3. **Ver cambios** automáticamente sin reiniciar
4. **Revisar logs** en la terminal correspondiente

### Ejemplos de cambios comunes:

**Cambiar un endpoint del API:**
```typescript
// services/api/src/routes/jobs.ts
router.get('/test', (req, res) => {
  res.json({ message: 'Hola mundo' })
})
// Guarda → Cambio aplicado automáticamente
```

**Cambiar el frontend:**
```tsx
// frontend/src/app/page.tsx
<h1>Mi nuevo título</h1>
// Guarda → Página se recarga automáticamente
```

**Cambiar procesamiento:**
```typescript
// services/worker/src/processors/imageProcessor.ts
// Modifica parámetros → Guarda → Próximo job usa los nuevos valores
```

---

## 🛑 DETENER SERVICIOS

En cada terminal: **Ctrl+C**

---

## 🔄 REINICIAR SERVICIOS

Si algo falla o necesitas reiniciar:

```bash
# Reiniciar PostgreSQL
sudo service postgresql restart

# Reiniciar Redis  
sudo service redis-server restart

# Luego vuelve a levantar API, Worker y Frontend
```

---

## 🐛 TROUBLESHOOTING

### Puerto ocupado
```bash
# Ver qué usa el puerto 4000 (API)
sudo lsof -i :4000
# Matar proceso
kill -9 <PID>
```

### PostgreSQL no conecta
```bash
# Verificar que esté corriendo
sudo service postgresql status

# Iniciar si está detenido
sudo service postgresql start

# Verificar conexión
psql -U imgtokey -d imgtokey_db -h localhost
# Contraseña: imgtokey123
```

### Redis no conecta
```bash
# Verificar
redis-cli ping
# Debe responder: PONG

# Iniciar si está detenido
sudo service redis-server start
```

### Cambios no se aplican
```bash
# Detén el servicio (Ctrl+C)
# Elimina node_modules/.cache si existe
rm -rf node_modules/.cache

# Reinicia
npm run dev
```

### Error con Prisma
```bash
cd services/api
npx prisma generate
npm run dev
```

---

## 📊 MONITOREO EN TIEMPO REAL

### Ver la cola de Redis
```bash
redis-cli
> KEYS *
> LLEN bull:image-processing:wait
> LLEN bull:image-processing:active
> exit
```

### Ver logs de PostgreSQL
```bash
sudo tail -f /var/log/postgresql/postgresql-12-main.log
```

### Ver archivos generados
```bash
# Uploads
ls -lh /home/mora/imgtokeychain/storage/uploads/

# Procesados
ls -lh /home/mora/imgtokeychain/storage/processed/

# STL generados
find storage -name "*.stl" -ls
```

---

## 🎨 ESTRUCTURA DE DESARROLLO

```
/home/mora/imgtokeychain/
├── services/api/          ← Terminal 1
│   └── npm run dev        ← Hot-reload con tsx watch
├── services/worker/       ← Terminal 2  
│   └── npm run dev        ← Hot-reload con tsx watch
└── frontend/              ← Terminal 3
    └── npm run dev        ← Hot-reload con Next.js Fast Refresh
```

---

## 💡 TIPS PARA DESARROLLO

1. **Usa Git** para hacer commits frecuentes
2. **Logs detallados** están en cada terminal
3. **Errors en rojo** son fáciles de identificar
4. **Thunder Client/Postman** para probar API
5. **PostgreSQL extension** en VS Code para ver la DB
6. **Redux DevTools** para debuguear estado (si usas)

---

## 📚 REFERENCIAS

- [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md) - Guía completa
- [README.md](README.md) - Documentación del proyecto
- [TASKS.md](TASKS.md) - Lista de tareas

---

## 🎉 ¡LISTO PARA DESARROLLAR!

Todo está configurado. Solo abre 3 terminales y ejecuta `npm run dev` en cada servicio.

**¡Los cambios se aplicarán automáticamente al guardar!** ⚡

---

Última actualización: 16 de enero de 2026
