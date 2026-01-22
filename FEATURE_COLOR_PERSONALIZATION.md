# 🎨 FEATURE: Personalización Interactiva de Colores

## 📸 Lo que el Usuario Verá

```
┌─────────────────────────────────────────────────────────────┐
│  🔑 Crear Llavero 3D                                        │
└─────────────────────────────────────────────────────────────┘

┌──────────────────────┐  ┌──────────────────────┐
│  1. Subir Imagen     │  │  Preview 2D          │
│  [DOFER Logo]    ✓   │  │  [Logo vectorizado]  │
└──────────────────────┘  └──────────────────────┘

┌──────────────────────┐  ┌──────────────────────┐
│  2. Ajustar Parámet. │  │  Preview 3D          │
│  [Sliders...]    ✓   │  │  [Modelo 3D]         │
└──────────────────────┘  └──────────────────────┘

┌──────────────────────┐
│  3. Estado Proceso   │
│  ✅ ¡Completado!     │
│  Job ID: 6ed3c7de... │
│  100% Progreso       │
└──────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  🎨 NUEVO: Personalizar Colores                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Color 1:                      Color 2:                    │
│  ┌──────────────┐              ┌──────────────┐           │
│  │              │              │              │           │
│  │   #0D2850    │              │   #FFB400    │           │
│  │  (Azul)      │              │  (Amarillo)  │           │
│  │              │              │              │           │
│  └──────────────┘              └──────────────┘           │
│  Código: [#0D2850]             Código: [#FFB400]          │
│  [Color Picker]                [Color Picker]             │
│                                                             │
│  [💾 Guardar Colores]  [⚙️ Resetear]  [📥 Descargar]     │
│                                                             │
│  💡 Consejos:                                              │
│  ✓ Escribe hex o usa selector visual                      │
│  ✓ Haz clic en Guardar para aplicar                       │
│  ✓ Descarga el ZIP con 3MF actualizado                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘

```

## 🔄 Flujo de Datos

```
Usuario en Frontend
    │
    ├─ Ve colores detectados
    │
    ├─ Selecciona nuevo color (picker o hex)
    │  📝 Color #0D2850 → #FF0000 (Rojo)
    │
    ├─ Haz clic "Guardar Colores"
    │
    └─► API: PUT /api/jobs/:jobId/colors
            {colors: ["#FF0000", "#FFB400"]}
                │
                ├─ Validar formato hex ✓
                │
                ├─ Actualizar DB con nuevos colores
                │
                └─► BullMQ: Agregar tarea "regenerate-3mf"
                        │
                        └─► Worker: regenerate3MFJob()
                                │
                                ├─ Leer STLs existentes
                                │
                                ├─ Parsear geometría con node-stl
                                │
                                ├─ Generar 3MF con nuevos colores
                                │
                                └─ Actualizar BD ✓
                                        │
                                        └─► Frontend notificado ✓
                                            "✅ Colores actualizados"
                                                │
                                                └─ Usuario descarga ZIP actualizado
```

## 🎯 Endpoints API

### GET /api/jobs/:id/colors
Obtiene los colores actuales de un trabajo

**Respuesta:**
```json
{
  "jobId": "6ed3c7de-29dc-4fbd-98d4-c9217baaabf6",
  "colors": ["#0D2850", "#FFB400"],
  "status": "COMPLETED"
}
```

### PUT /api/jobs/:id/colors
Actualiza los colores y regenera 3MF

**Request:**
```json
{
  "colors": ["#FF0000", "#FFB400"]
}
```

**Respuesta:**
```json
{
  "message": "Colors updated and 3MF regeneration queued",
  "jobId": "6ed3c7de-29dc-4fbd-98d4-c9217baaabf6",
  "colors": ["#FF0000", "#FFB400"]
}
```

## 🧩 Componentes

### ColorPicker.tsx

**Props:**
```typescript
interface ColorPickerProps {
  jobId: string                          // ID del trabajo
  initialColors: string[]                // Colores iniciales
  onColorsChange?: (colors: string[]) => void  // Callback al cambiar
  onDownload?: () => void                // Callback al descargar
}
```

**Características:**
- ✅ Color picker visual HTML5
- ✅ Input de código hex
- ✅ Guardar/resetear colores
- ✅ Descargar ZIP actualizado
- ✅ Mensajes de estado
- ✅ Validación de colores

## 🚀 Testing Manual

### 1. Subir una imagen
```bash
# Abrir http://localhost:3000/crear-llavero
# Seleccionar una imagen PNG/JPG con colores
# Esperar a que se procese
```

### 2. Cambiar colores
```
1. Esperar a "¡Completado!"
2. Ver sección "🎨 Personalizar Colores"
3. Haz clic en el cuadrado de color
4. Selecciona un nuevo color
5. Haz clic en "💾 Guardar Colores"
6. Esperar confirmación "✅ Colores actualizados correctamente"
```

### 3. Descargar
```
1. Haz clic en "📥 Descargar ZIP"
2. Se descargará llavero_[jobId]_multicolor.zip
3. Contiene:
   - 3MF con nuevos colores
   - STLs individuales por color
   - colors.json con hex codes
   - README.txt con instrucciones
```

## 📊 Base de Datos

**Schema Update:** No requiere migración nueva  
**Tabla:** `jobs`  
**Campo:** `dominantColors` (String[]) - Ya existe

## 🔧 Variables de Entorno

```env
# Ya están configuradas en .env.example
REDIS_URL=redis://redis:6379
WORKER_CONCURRENCY=2
STORAGE_PATH=/app/storage
```

## 📝 Logs Esperados

### Worker
```
info: [jobId] Regenerating 3MF with new colors...
info: [jobId] Colors: #FF0000, #FFB400
info: [jobId] 3MF file regenerated successfully
```

### Frontend
```
✅ Colores actualizados correctamente
```

---

## ✅ Checklist de Implementación

- [x] Crear componente ColorPicker
- [x] Integrar en página crear-llavero
- [x] Parser STL implementado (node-stl)
- [x] Generación 3MF con geometría real
- [x] Endpoint PUT para actualizar colores
- [x] Processor de regeneración en worker
- [x] Cola BullMQ para regeneración
- [x] Mensajes de confirmación
- [x] Validación de hex colors
- [x] Descarga de ZIP actualizado
- [x] Tests básicos

---

**Status:** ✅ COMPLETADO Y LISTO PARA PRODUCCIÓN
