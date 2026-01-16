# 🧪 Tests para el API

## Estructura

```
src/__tests__/
├── health.test.ts          # Tests del endpoint de salud
├── validateFile.test.ts    # Tests de validación de archivos
└── jobs.test.ts           # Tests de endpoints de jobs (TODO)
```

## Ejecutar Tests

```bash
# Todos los tests
npm test

# Watch mode
npm run test:watch

# Con coverage
npm run test:coverage
```

## Coverage Esperado

- **Mínimo aceptable:** 70%
- **Objetivo:** 80%+
- **Crítico:** 90%+ en validaciones y middleware

## Tests Implementados

### ✅ Health Check (`health.test.ts`)
- Verifica que el endpoint `/health` responda 200
- Valida estructura de la respuesta
- Verifica timestamp y uptime

### ✅ File Validation (`validateFile.test.ts`)
- Valida formatos permitidos (PNG, JPG, JPEG)
- Rechaza formatos no permitidos
- Valida límite de tamaño (5MB)
- Maneja casos sin archivo

## Tests Pendientes

### ⏳ Jobs Endpoints (`jobs.test.ts`)
- [ ] POST /api/jobs - Crear job con archivo válido
- [ ] POST /api/jobs - Rechazar sin archivo
- [ ] GET /api/jobs/:id - Obtener job existente
- [ ] GET /api/jobs/:id - 404 para job inexistente
- [ ] GET /api/jobs/:id/download - Descargar STL

### ⏳ Error Handler (`errorHandler.test.ts`)
- [ ] Manejo de errores 400
- [ ] Manejo de errores 404
- [ ] Manejo de errores 500
- [ ] Logging de errores

### ⏳ Rate Limiter (`rateLimiter.test.ts`)
- [ ] Permitir requests dentro del límite
- [ ] Bloquear exceso de requests
- [ ] Headers correctos

## Notas

- Los tests usan `supertest` para probar endpoints
- Jest configurado con `ts-jest` para TypeScript
- No se requiere base de datos para estos tests (unit tests)
- Tests de integración requieren Docker (pendiente)

## CI/CD

Agregar a `.github/workflows/test.yml`:

```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm test
```
