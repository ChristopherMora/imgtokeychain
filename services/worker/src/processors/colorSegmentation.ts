import sharp from 'sharp'
import path from 'path'
import fs from 'fs/promises'
import { logger } from '../utils/logger'

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
    logger.info(`[${jobId}] Segmenting by HUE ranges within silhouette...`)
    
    // Leer imagen original
    const { data } = await sharp(inputPath)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    
    // Analizar los hues presentes en la silueta
    const hueDistribution: number[] = new Array(360).fill(0)
    const hueSatSum: number[] = new Array(360).fill(0)
    const pixelsByHue: Map<number, { r: number; g: number; b: number; count: number }> = new Map()
    
    for (let i = 0; i < width * height; i++) {
      if (silhouetteMask[i] !== 255) continue
      
      const r = data[i * 3]
      const g = data[i * 3 + 1]
      const b = data[i * 3 + 2]
      
      const { h, s, l } = rgbToHsl(r, g, b)
      
      // Solo considerar píxeles con saturación y luminosidad suficiente
      if (s > 0.15 && l > 0.1 && l < 0.9) {
        const hueIndex = Math.floor(h) % 360
        hueDistribution[hueIndex]++
        hueSatSum[hueIndex] += s
        
        // Guardar color representativo para este hue
        const existing = pixelsByHue.get(hueIndex)
        if (!existing || s > (hueSatSum[hueIndex] / hueDistribution[hueIndex])) {
          pixelsByHue.set(hueIndex, { r, g, b, count: (existing?.count || 0) + 1 })
        }
      }
    }
    
    // Encontrar picos de hue (rangos de colores dominantes)
    const huePeaks: { centerHue: number; count: number; color: string }[] = []
    const HUE_WINDOW = 30 // Agrupar hues en ventanas de 30 grados
    
    for (let center = 0; center < 360; center += HUE_WINDOW) {
      let windowCount = 0
      let maxSat = 0
      let bestColor = { r: 0, g: 0, b: 0 }
      
      for (let h = center; h < center + HUE_WINDOW && h < 360; h++) {
        windowCount += hueDistribution[h]
        const pixel = pixelsByHue.get(h)
        if (pixel && pixel.count > 0) {
          const avgSat = hueSatSum[h] / hueDistribution[h]
          if (avgSat > maxSat) {
            maxSat = avgSat
            bestColor = pixel
          }
        }
      }
      
      if (windowCount > 100) { // Mínimo de píxeles
        const hex = `#${bestColor.r.toString(16).padStart(2, '0')}${bestColor.g.toString(16).padStart(2, '0')}${bestColor.b.toString(16).padStart(2, '0')}`
        huePeaks.push({ centerHue: center, count: windowCount, color: hex })
      }
    }
    
    // Ordenar por cantidad de píxeles
    huePeaks.sort((a, b) => b.count - a.count)
    
    // Tomar los 2-3 colores principales más diferentes entre sí
    const selectedPeaks: typeof huePeaks = []
    for (const peak of huePeaks) {
      if (selectedPeaks.length >= 3) break
      
      const isDifferent = selectedPeaks.every(selected => {
        const hueDiff = Math.min(
          Math.abs(peak.centerHue - selected.centerHue),
          360 - Math.abs(peak.centerHue - selected.centerHue)
        )
        return hueDiff > 40 // Al menos 40 grados de diferencia
      })
      
      if (isDifferent || selectedPeaks.length === 0) {
        selectedPeaks.push(peak)
      }
    }
    
    logger.info(`[${jobId}] Found ${selectedPeaks.length} hue ranges: ${selectedPeaks.map(p => `${p.color} (hue ${p.centerHue}°)`).join(', ')}`)
    
    const masks: { color: string; maskPath: string }[] = []
    
    // Crear máscara para cada rango de hue
    for (let colorIndex = 0; colorIndex < selectedPeaks.length; colorIndex++) {
      const peak = selectedPeaks[colorIndex]
      const maskBuffer = Buffer.alloc(width * height)
      
      let pixelCount = 0
      for (let i = 0; i < width * height; i++) {
        if (silhouetteMask[i] !== 255) {
          maskBuffer[i] = 0
          continue
        }
        
        const r = data[i * 3]
        const g = data[i * 3 + 1]
        const b = data[i * 3 + 2]
        
        const { h, s, l } = rgbToHsl(r, g, b)
        
        // Verificar si el hue está en el rango de este color
        const hueDiff = Math.min(
          Math.abs(h - peak.centerHue),
          360 - Math.abs(h - peak.centerHue)
        )
        
        // Incluir si está dentro del rango y tiene suficiente saturación
        if (hueDiff < HUE_WINDOW && s > 0.1 && l > 0.1 && l < 0.95) {
          maskBuffer[i] = 255
          pixelCount++
        } else {
          maskBuffer[i] = 0
        }
      }
      
      const percentage = (pixelCount / (width * height) * 100).toFixed(2)
      logger.info(`[${jobId}] Hue range ${peak.centerHue}° (${peak.color}): ${pixelCount} pixels (${percentage}%)`)
      
      if (pixelCount > 500) {
        const maskPath = path.join(
          storagePath,
          'processed',
          `${jobId}_color${colorIndex}_mask.pgm`
        )
        
        const TARGET_SIZE = 1000
        const maskImage = sharp(maskBuffer, {
          raw: { width, height, channels: 1 }
        })
        
        const resizedBuffer = await maskImage
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
        
        await fs.writeFile(maskPath, pgmData)
        logger.info(`[${jobId}] Mask created for hue ${peak.centerHue}°: ${pixelCount} pixels`)
        
        masks.push({ color: peak.color, maskPath })
      }
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
