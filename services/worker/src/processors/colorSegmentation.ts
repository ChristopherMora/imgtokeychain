import sharp from 'sharp'
import path from 'path'
import fs from 'fs/promises'
import { logger } from '../utils/logger'
import { optimizeMaskForPotrace } from './maskEnhancer'

/**
 * Convierte RGB a HSL
 */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255
  g /= 255
  b /= 255
  
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }

  return { h: h * 360, s, l }
}

/**
 * Segmenta una imagen por RANGOS DE HUE dentro de una silueta.
 * Esto funciona mucho mejor para logos con gradientes.
 */
export const segmentByColorsWithSilhouette = async (
  inputPath: string,
  colors: string[],
  silhouetteMask: Buffer,
  width: number,
  height: number,
  jobId: string,
  storagePath: string
): Promise<{ color: string; maskPath: string }[]> => {
  try {
    logger.info(`[${jobId}] Segmenting by guided palette within silhouette...`)
    
    // Leer imagen original
    const { data } = await sharp(inputPath)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    // Si vienen colores dominantes, usarlos como guía principal (mucho más fiel que los picos de hue)
    const guidedPalette = colors
      .map(c => hexToRgb(c))
      .filter((c): c is { r: number; g: number; b: number } => !!c)
    
    // Siempre agregamos un slot para "oscuro" (texto/runner) aunque no esté en la paleta
    const masks: { color: string; maskPath: string }[] = []
    const assignments = new Int16Array(width * height).fill(-1)
    const COLOR_TOLERANCE = 70 // distancia perceptual para asignar a un color dado
    const darkIndex = guidedPalette.length // índice reservado para negros

    // Asignar cada pixel dentro de la silueta al color más cercano
    for (let i = 0; i < width * height; i++) {
      if (silhouetteMask[i] !== 255) continue
      const r = data[i * 3]
      const g = data[i * 3 + 1]
      const b = data[i * 3 + 2]
      
      const { s, l } = rgbToHsl(r, g, b)
      // Capturar texto/runner oscuros (independiente de paleta)
      if (l < 0.38 && s < 0.32) {
        assignments[i] = darkIndex
        continue
      }
      
      let bestIdx = -1
      let bestDist = Infinity
      for (let cIdx = 0; cIdx < guidedPalette.length; cIdx++) {
        const c = guidedPalette[cIdx]
        const dist = redmeanDistance(r, g, b, c.r, c.g, c.b)
        if (dist < bestDist) {
          bestDist = dist
          bestIdx = cIdx
        }
      }
      if (bestIdx !== -1 && bestDist < COLOR_TOLERANCE) {
        assignments[i] = bestIdx
      }
    }

    // Construir buffers por color guiado
    const buildMask = async (colorIdx: number, colorHex: string, maskIndex: number, pixels: number[]) => {
      const maskBuffer = Buffer.alloc(width * height)
      for (const pix of pixels) maskBuffer[pix] = 255
      const TARGET_SIZE = 2000
      const maskImage = sharp(maskBuffer, { raw: { width, height, channels: 1 } })
      const resizedBuffer = await maskImage
        .greyscale()
        .resize(TARGET_SIZE, TARGET_SIZE, {
          fit: 'fill',  // ← CRÍTICO: 'fill' mantiene las posiciones relativas entre capas
          kernel: 'nearest', // IMPORTANTE: nearest para mantener bordes definidos en máscaras binarias
          background: { r: 0, g: 0, b: 0, alpha: 1 }
        })
        .threshold(128) // Asegurar que sea puramente binario (blanco/negro)
        .raw()
        .toBuffer({ resolveWithObject: true })
      const pgmHeader = `P5\n${resizedBuffer.info.width} ${resizedBuffer.info.height}\n255\n`
      const pgmData = Buffer.concat([
        Buffer.from(pgmHeader, 'ascii'),
        resizedBuffer.data
      ])
      const maskPath = path.join(
        storagePath,
        'processed',
        `${jobId}_color${maskIndex}_mask.pgm`
      )
      await fs.writeFile(maskPath, pgmData)
      masks.push({ color: colorHex, maskPath })
      logger.info(`[${jobId}] Mask ${maskIndex} (${colorHex}) pixels: ${pixels.length}`)
    }

    // Agrupar píxeles por asignación
    const pixelBuckets: number[][] = Array.from({ length: guidedPalette.length + 1 }, () => [])
    for (let i = 0; i < assignments.length; i++) {
      const idx = assignments[i]
      if (idx >= 0) pixelBuckets[idx].push(i)
    }

    // Construir máscaras de la paleta
    let written = 0
    for (let cIdx = 0; cIdx < guidedPalette.length; cIdx++) {
      const pixels = pixelBuckets[cIdx]
      if (pixels.length < 50) continue
      const hex = colors[cIdx] || '#cccccc'
      await buildMask(cIdx, hex, written, pixels)
      written++
    }

    // Máscara oscura (texto/runner)
    const darkPixels = pixelBuckets[darkIndex]
    if (darkPixels.length > 50) {
      await buildMask(darkIndex, '#000000', written, darkPixels)
      written++
    }
    
    // Si no hay suficientes máscaras, usar la silueta completa como fallback
    if (masks.length === 0) {
      logger.warn(`[${jobId}] No color masks created, using full silhouette`)
      
      const silhouettePath = path.join(storagePath, 'processed', `${jobId}_silhouette.pgm`)
      
      // Redimensionar silueta a 1000x1000
      const TARGET_SIZE = 1000
      const silhouetteImage = sharp(silhouetteMask, {
        raw: { width, height, channels: 1 }
      })
      
      const resizedBuffer = await silhouetteImage
        .greyscale()
        .resize(TARGET_SIZE, TARGET_SIZE, {
          fit: 'fill',
          kernel: 'nearest'
        })
        .raw()
        .toBuffer({ resolveWithObject: true })
      
      const pgmHeader = `P5\n${TARGET_SIZE} ${TARGET_SIZE}\n255\n`
      const pgmData = Buffer.concat([
        Buffer.from(pgmHeader, 'ascii'),
        resizedBuffer.data
      ])
      
      const fallbackPath = path.join(storagePath, 'processed', `${jobId}_color0_mask.pgm`)
      await fs.writeFile(fallbackPath, pgmData)
      
      masks.push({ color: '#3cb4dc', maskPath: fallbackPath })
    }
    
    logger.info(`[${jobId}] Created ${masks.length} hue-based masks`)
    return masks
    
  } catch (error) {
    logger.error(`[${jobId}] Error segmenting by hue:`, error)
    throw error
  }
}

/**
 * Función legacy para compatibilidad
 */
export const segmentByColors = async (
  inputPath: string,
  colors: string[],
  jobId: string,
  storagePath: string
): Promise<{ color: string; maskPath: string }[]> => {
  try {
    logger.info(`[${jobId}] Segmenting image into ${colors.length} color regions...`)
    
    // Leer imagen original
    const image = sharp(inputPath)
    const { data, info } = await image
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    
    const width = info.width
    const height = info.height
    const channels = info.channels
    
    const masks: { color: string; maskPath: string }[] = []
    
    // Crear una máscara por cada color
    for (let colorIndex = 0; colorIndex < colors.length; colorIndex++) {
      const targetColor = hexToRgb(colors[colorIndex])
      if (!targetColor) continue
      
      // Crear buffer para la máscara (blanco donde coincide el color, negro donde no)
      const maskBuffer = Buffer.alloc(width * height)
      
      let pixelCount = 0
      for (let i = 0; i < data.length; i += channels) {
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        
        // Calcular distancia perceptual al color objetivo usando "redmean"
        // Fórmula mejorada que considera la sensibilidad del ojo humano
        // https://en.wikipedia.org/wiki/Color_difference#sRGB
        const rMean = (r + targetColor.r) / 2
        const deltaR = r - targetColor.r
        const deltaG = g - targetColor.g
        const deltaB = b - targetColor.b
        
        const distance = Math.sqrt(
          (2 + rMean / 256) * deltaR * deltaR +
          4 * deltaG * deltaG +
          (2 + (255 - rMean) / 256) * deltaB * deltaB
        )
        
        // Tolerancia aumentada para capturar gradientes y antialiasing
        // Los logos modernos tienen suavizado que crea píxeles intermedios
        const pixelIndex = Math.floor(i / channels)
        if (distance < 100) {  // Aumentado de 60 a 100
          maskBuffer[pixelIndex] = 255 // Blanco
          pixelCount++
        } else {
          maskBuffer[pixelIndex] = 0 // Negro
        }
      }
      
      // Si la máscara tiene suficientes píxeles (al menos 1% de la imagen)
      if (pixelCount > (width * height) * 0.01) {
        // Guardar máscara como PGM (requerido por Potrace)
        const maskPath = path.join(
          storagePath,
          'processed',
          `${jobId}_color${colorIndex}_mask.pgm`
        )
        
        // IMPORTANTE: SIEMPRE redimensionar a 1000x1000 para mantener consistencia
        // Esto asegura que Potrace genere SVGs con coordenadas predecibles
        // Máscara: 255 (blanco) = logo, 0 (negro) = fondo
        // Potrace con -i trazará las áreas BLANCAS (el logo)
        const TARGET_SIZE = 1000
        
        // Crear imagen Sharp desde el buffer original
        const maskImage = sharp(maskBuffer, {
          raw: {
            width: width,
            height: height,
            channels: 1
          }
        })
        
        // Redimensionar A CUADRADO (forzar dimensiones) para mantener consistencia
        // Esto evita problemas con proporciones extrañas en SVG/STL
        // IMPORTANTE: usar kernel 'nearest' para imágenes binarias (blanco/negro)
        // lanczos3 no funciona bien con raw buffers de 1 canal
        const resizedBuffer = await maskImage
          .greyscale()  // Asegurar que se procesa como escala de grises
          .resize(TARGET_SIZE, TARGET_SIZE, {
            fit: 'fill',  // Forzar el tamaño exacto (puede distorsionar)
            kernel: 'nearest'  // Vecino más cercano para imágenes binarias
          })
          .raw()
          .toBuffer({ resolveWithObject: true })
        
        // Crear PGM con dimensiones cuadradas
        const newWidth = resizedBuffer.info.width
        const newHeight = resizedBuffer.info.height
        const pgmHeader = `P5\n${newWidth} ${newHeight}\n255\n`
        const pgmData = Buffer.concat([
          Buffer.from(pgmHeader, 'ascii'),
          resizedBuffer.data
        ])
        
        await fs.writeFile(maskPath, pgmData)
        logger.info(`[${jobId}] Mask created for ${colors[colorIndex]}: ${pixelCount} pixels, resized to ${newWidth}x${newHeight}`)
        
        masks.push({ color: colors[colorIndex], maskPath })
      } else {
        logger.warn(`[${jobId}] Skipping ${colors[colorIndex]}: too few pixels`)
      }
    }
    
    logger.info(`[${jobId}] Created ${masks.length} color masks`)
    return masks
    
  } catch (error) {
    logger.error(`[${jobId}] Error segmenting by colors:`, error)
    throw error
  }
}

/**
 * Convierte color hex a RGB
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null
}

// Distancia perceptual (redmean) para comparar colores
function redmeanDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const rMean = (r1 + r2) / 2
  const dR = r1 - r2
  const dG = g1 - g2
  const dB = b1 - b2
  return Math.sqrt(((2 + rMean / 256) * dR * dR) + (4 * dG * dG) + ((2 + (255 - rMean) / 256) * dB * dB))
}
