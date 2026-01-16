# 📁 Estructura del Proyecto

```
imgtokeychai/
│
├── 📄 .env                      # Variables de entorno (desarrollo)
├── 📄 .env.example              # Template de variables de entorno
├── 📄 .gitignore                # Archivos ignorados por git
├── 📄 README.md                 # Documentación principal
├── 📄 TASKS.md                  # Lista de tareas del proyecto
├── 📄 docker-compose.yml        # Orquestación de servicios Docker
│
├── 📂 frontend/                 # Aplicación Next.js
│   ├── 📄 .dockerignore
│   ├── 📄 Dockerfile            # Build de contenedor frontend
│   ├── 📄 next.config.js        # Configuración Next.js
│   ├── 📄 package.json          # Dependencias frontend
│   ├── 📄 postcss.config.js     # PostCSS config
│   ├── 📄 tailwind.config.js    # Tailwind CSS config
│   ├── 📄 tsconfig.json         # TypeScript config
│   └── 📂 src/                  # (por crear en siguiente tarea)
│       ├── 📂 app/              # App Router de Next.js
│       ├── 📂 components/       # Componentes React
│       └── 📂 lib/              # Utilidades y helpers
│
├── 📂 services/                 # Microservicios backend
│   │
│   ├── 📂 api/                  # API REST con Express
│   │   ├── 📄 .dockerignore
│   │   ├── 📄 Dockerfile        # Build de contenedor API
│   │   ├── 📄 package.json      # Dependencias API
│   │   ├── 📄 tsconfig.json     # TypeScript config
│   │   ├── 📂 prisma/
│   │   │   └── 📄 schema.prisma # Schema de base de datos
│   │   └── 📂 src/              # (por crear en siguiente tarea)
│   │       ├── 📂 routes/       # Rutas de API
│   │       ├── 📂 controllers/  # Controladores
│   │       ├── 📂 services/     # Lógica de negocio
│   │       ├── 📂 middleware/   # Middleware Express
│   │       └── 📄 index.ts      # Entry point
│   │
│   └── 📂 worker/               # Worker de procesamiento
│       ├── 📄 .dockerignore
│       ├── 📄 Dockerfile        # Build de contenedor worker
│       ├── 📄 package.json      # Dependencias worker
│       ├── 📄 tsconfig.json     # TypeScript config
│       ├── 📂 prisma/
│       │   └── 📄 schema.prisma # Schema compartido
│       └── 📂 src/              # (por crear en siguiente tarea)
│           ├── 📂 processors/   # Procesadores de imagen
│           ├── 📂 generators/   # Generadores STL
│           └── 📄 index.ts      # Entry point del worker
│
├── 📂 db/                       # Base de datos
│   └── 📄 init.sql              # Script de inicialización
│
└── 📂 storage/                  # Almacenamiento de archivos
    ├── 📄 .gitkeep
    ├── 📂 uploads/              # (creado por Docker)
    ├── 📂 processed/            # (creado por Docker)
    └── 📂 temp/                 # (creado por Docker)
```

## 🎯 Servicios Docker

| Servicio | Puerto | Descripción |
|----------|--------|-------------|
| **frontend** | 3000 | Next.js UI con preview 3D |
| **api** | 4000 | Express REST API |
| **worker** | - | Procesador de jobs (interno) |
| **db** | 5432 | PostgreSQL database |
| **redis** | 6379 | Cola de jobs y cache |

## ✅ Estado Actual

**Tarea 1 completada:**
- ✅ Estructura de carpetas creada
- ✅ Archivos de configuración listos
- ✅ Docker Compose configurado
- ✅ Variables de entorno definidas
- ✅ Package.json de todos los servicios
- ✅ Dockerfiles optimizados
- ✅ TypeScript configurado
- ✅ Prisma schema definido
- ✅ README y documentación inicial

**Próximo paso:** Tarea 3 - Setup Frontend Next.js (crear estructura de src/)
