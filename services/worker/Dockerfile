FROM node:18-alpine

# Instalar herramientas de procesamiento
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    potrace \
    openscad \
    imagemagick

WORKDIR /app

# Copiar archivos de dependencias
COPY package.json package-lock.json* ./

# Instalar dependencias
RUN npm ci

# Copiar prisma schema
COPY prisma ./prisma

# Generar Prisma Client
RUN npx prisma generate

# Copiar código fuente
COPY . .

# Build TypeScript
RUN npm run build

# Health check básico
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "console.log('Worker running')" || exit 1

# Comando de inicio
CMD ["npm", "start"]
