# 🖼️ Imágenes de Prueba

Esta carpeta contiene imágenes de ejemplo para probar el sistema de generación de llaveros 3D.

## ✅ Imágenes Recomendadas

### Características ideales:
- **Formato:** PNG o JPG
- **Fondo:** Transparente (PNG) o blanco sólido
- **Contenido:** Logos simples, íconos, dibujos con líneas claras
- **Tamaño:** Entre 500x500 y 2000x2000 píxeles
- **Peso:** Máximo 5MB
- **Colores:** Alto contraste (preferible blanco y negro o colores sólidos)

### ❌ Evitar:
- Fotografías con muchos detalles
- Imágenes borrosas o de baja resolución
- Fondos complejos o degradados
- Retratos realistas
- Texturas complejas

## 📁 Estructura Sugerida

```
examples/
├── logos/
│   ├── simple-star.png          # Estrella simple
│   ├── circle-logo.png          # Logo circular
│   └── geometric-shape.png      # Forma geométrica
├── icons/
│   ├── heart-icon.png           # Ícono de corazón
│   ├── music-note.png           # Nota musical
│   └── game-controller.png      # Control de juego
└── text/
    ├── initials-ab.png          # Iniciales
    └── simple-word.png          # Palabra simple
```

## 🧪 Cómo Usar

1. Coloca tus imágenes de prueba en esta carpeta
2. Accede a la aplicación en http://localhost:3000
3. Sube una imagen de ejemplo
4. Ajusta los parámetros (tamaño, grosor, aro)
5. Visualiza el preview 3D
6. Descarga el archivo STL

## 🎨 Herramientas para Crear Imágenes de Prueba

- **Vectores:** [Flaticon](https://www.flaticon.com/), [Noun Project](https://thenounproject.com/)
- **Logos:** [LogoMakr](https://logomakr.com/), [Canva](https://www.canva.com/)
- **Edición:** [GIMP](https://www.gimp.org/), [Photopea](https://www.photopea.com/)
- **Quitar fondos:** [Remove.bg](https://www.remove.bg/)

## 📊 Resultados Esperados

| Imagen | Tiempo | Calidad | Notas |
|--------|--------|---------|-------|
| Logo simple | 10-15s | ⭐⭐⭐⭐⭐ | Perfecto |
| Ícono | 10-20s | ⭐⭐⭐⭐⭐ | Excelente |
| Dibujo líneas | 15-25s | ⭐⭐⭐⭐ | Muy bueno |
| Texto | 10-15s | ⭐⭐⭐⭐ | Bueno |
| Foto simple | 20-30s | ⭐⭐⭐ | Aceptable |
| Foto compleja | >30s | ⭐⭐ | No recomendado |

## 🐛 Reporte de Problemas

Si encuentras problemas con alguna imagen específica:
1. Anota el nombre del archivo
2. Captura el error (si hay)
3. Revisa los logs: `docker compose logs worker`
4. Reporta en el issue tracker

---

**Tip:** Empieza con imágenes simples para validar que el sistema funciona correctamente.
