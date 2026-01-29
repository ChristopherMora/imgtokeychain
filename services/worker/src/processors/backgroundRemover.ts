import sharp from 'sharp'
import path from 'path'
import fs from 'fs/promises'
import { logger } from '../utils/logger'

const STORAGE_PATH = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../../storage')

interface BackgroundRemovalResult {
  // Imagen sin fondo (PNG con transparencia)
  cleanImagePath: string
  // Máscara de silueta (PGM donde blanco = logo, negro = fondo)
  silhouetteMaskPath: string
  // Dimensiones
  width: number
  height: number
}

/**
 * Remueve el fondo de una imagen detectando el color de las esquinas.
 * Retorna la imagen limpia y una máscara de silueta.
 */
export const removeBackground = async (
  inputPath: string,
  jobId: string,
  storagePath: string = STORAGE_PATH
): Promise<BackgroundRemovalResult> => {
  try {
    logger.info(`[${jobId}] Starting background removal...`)
    
    const image = sharp(inputPath)
    const metadata = await image.metadata()
    const { width = 500, height = 500, channels = 3 } = metadata
    
    // Obtener datos raw de la imagen
    const { data } = await image
      .removeAlpha()  // Asegurar 3 canales
      .raw()
      .toBuffer({ resolveWithObject: true })
    
    // Detectar el color de fondo analizando las 4 esquinas
    const backgroundColor = detectBackgroundColor(data, width, height)
    logger.info(`[${jobId}] Detected background color: RGB(${backgroundColor.r}, ${backgroundColor.g}, ${backgroundColor.b})`)
    
    // Crear máscara de silueta: blanco donde NO es fondo, negro donde ES fondo
    const silhouetteMask = Buffer.alloc(width * height)
    let foregroundPixels = 0
    
    // Tolerancia para detectar el fondo (ajustable para gradientes)
    const BACKGROUND_TOLERANCE = 50
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixelIndex = y * width + x
        const dataIndex = pixelIndex * 3
        
        const r = data[dataIndex]
        const g = data[dataIndex + 1]
        const b = data[dataIndex + 2]
        
        // Calcular distancia al color de fondo
        const distance = Math.sqrt(
          Math.pow(r - backgroundColor.r, 2) +
          Math.pow(g - backgroundColor.g, 2) +
          Math.pow(b - backgroundColor.b, 2)
        )
        
        // Si es diferente del fondo → es parte del logo (blanco en la máscara)
        if (distance > BACKGROUND_TOLERANCE) {
          silhouetteMask[pixelIndex] = 255  // Blanco = logo
          foregroundPixels++
        } else {
          silhouetteMask[pixelIndex] = 0    // Negro = fondo
        }
      }
    }
    
    const foregroundPercentage = (foregroundPixels / (width * height) * 100).toFixed(2)
    logger.info(`[${jobId}] Foreground pixels: ${foregroundPixels} (${foregroundPercentage}%)`)
    
    // Guardar máscara de silueta como PGM
    const silhouetteMaskPath = path.join(storagePath, 'processed', `${jobId}_silhouette.pgm`)
    const pgmHeader = `P5\n${width} ${height}\n255\n`
    const pgmData = Buffer.concat([
      Buffer.from(pgmHeader, 'ascii'),
      silhouetteMask
    ])
    await fs.writeFile(silhouetteMaskPath, pgmData)
    logger.info(`[${jobId}] Silhouette mask saved: ${silhouetteMaskPath}`)
    
    // Crear imagen PNG con fondo transparente
    const alphaChannel = Buffer.alloc(width * height)
    for (let i = 0; i < silhouetteMask.length; i++) {
      alphaChannel[i] = silhouetteMask[i]  // Usar la máscara como canal alfa
    }
    
    // Crear imagen RGBA
    const rgbaData = Buffer.alloc(width * height * 4)
    for (let i = 0; i < width * height; i++) {
      rgbaData[i * 4] = data[i * 3]         // R
      rgbaData[i * 4 + 1] = data[i * 3 + 1] // G
      rgbaData[i * 4 + 2] = data[i * 3 + 2] // B
      rgbaData[i * 4 + 3] = silhouetteMask[i] // A (de la máscara)
    }
    
    const cleanImagePath = path.join(storagePath, 'processed', `${jobId}_clean.png`)
    await sharp(rgbaData, {
      raw: {
        width,
        height,
        channels: 4
      }
    })
    .png()
    .toFile(cleanImagePath)
    
    logger.info(`[${jobId}] Clean image saved: ${cleanImagePath}`)
    
    return {
      cleanImagePath,
      silhouetteMaskPath,
      width,
      height
    }
    
  } catch (error) {
    logger.error(`[${jobId}] Error removing background:`, error)
    throw error
  }
}

/**
 * Detecta el color de fondo analizando las esquinas de la imagen.
 */
function detectBackgroundColor(
  data: Buffer,
  width: number,
  height: number
): { r: number; g: number; b: number } {
  // Muestrear píxeles de las 4 esquinas (área de 20x20)
  const sampleSize = 20
  const samples: { r: number; g: number; b: number }[] = []
  
  // Esquina superior izquierda
  for (let y = 0; y < sampleSize && y < height; y++) {
    for (let x = 0; x < sampleSize && x < width; x++) {
      const idx = (y * width + x) * 3
      samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] })
    }
  }
  
  // Esquina superior derecha
  for (let y = 0; y < sampleSize && y < height; y++) {
    for (let x = width - sampleSize; x < width; x++) {
      if (x >= 0) {
        const idx = (y * width + x) * 3
        samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] })
      }
    }
  }
  
  // Esquina inferior izquierda
  for (let y = height - sampleSize; y < height; y++) {
    if (y >= 0) {
      for (let x = 0; x < sampleSize && x < width; x++) {
        const idx = (y * width + x) * 3
        samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] })
      }
    }
  }
  
  // Esquina inferior derecha
  for (let y = height - sampleSize; y < height; y++) {
    if (y >= 0) {
      for (let x = width - sampleSize; x < width; x++) {
        if (x >= 0) {
          const idx = (y * width + x) * 3
          samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] })
        }
      }
    }
  }
  
  // Calcular promedio
  let totalR = 0, totalG = 0, totalB = 0
  for (const sample of samples) {
    totalR += sample.r
    totalG += sample.g
    totalB += sample.b
  }
  
  return {
    r: Math.round(totalR / samples.length),
    g: Math.round(totalG / samples.length),
    b: Math.round(totalB / samples.length)
  }
}

/**
 * Extrae colores dominantes SOLO de los píxeles del logo (no del fondo).
 */
export const extractColorsFromForeground = async (
  inputPath: string,
  silhouetteMask: Buffer,
  width: number,
  height: number,
  jobId: string
): Promise<string[]> => {
  try {
    logger.info(`[${jobId}] Extracting colors from foreground only...`)
    
    const { data } = await sharp(inputPath)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    
    // Contar colores solo en píxeles del logo (donde silhouetteMask = 255)
    const colorMap = new Map<string, { count: number; saturation: number; hue: number }>()
    
    for (let i = 0; i < width * height; i++) {
      // Solo procesar píxeles del logo
      if (silhouetteMask[i] !== 255) continue
      
      const r = data[i * 3]
      const g = data[i * 3 + 1]
      const b = data[i * 3 + 2]
      
      // Cuantizar con pasos de 25 para agrupar colores similares
      const rr = Math.round(r / 25) * 25
      const gg = Math.round(g / 25) * 25
      const bb = Math.round(b / 25) * 25
      
      // Calcular saturación y hue
      const max = Math.max(rr, gg, bb)
      const min = Math.min(rr, gg, bb)
      const saturation = max === 0 ? 0 : (max - min) / max
      
      let hue = 0
      if (max !== min) {
        const delta = max - min
        if (max === rr) {
          hue = ((gg - bb) / delta + (gg < bb ? 6 : 0)) * 60
        } else if (max === gg) {
          hue = ((bb - rr) / delta + 2) * 60
        } else {
          hue = ((rr - gg) / delta + 4) * 60
        }
      }
      
      const colorKey = `${rr},${gg},${bb}`
      const existing = colorMap.get(colorKey) || { count: 0, saturation, hue }
      colorMap.set(colorKey, {
        count: existing.count + 1,
        saturation,
        hue,
      })
    }
    
    // Separar colores saturados de colores oscuros/grises
    const saturatedColors = Array.from(colorMap.entries())
      .map(([color, data]) => ({ color, ...data }))
      .filter(c => c.saturation > 0.1)  // Colores con saturación
      .sort((a, b) => b.count - a.count)
    
    const darkColors = Array.from(colorMap.entries())
      .map(([color, data]) => ({ color, ...data }))
      .filter(c => c.saturation <= 0.3)  // Grises, negros (baja saturación)
      .sort((a, b) => b.count - a.count)
    
    logger.info(`[${jobId}] Found ${saturatedColors.length} saturated colors and ${darkColors.length} dark/gray colors in foreground`)
    
    // Seleccionar colores diversos (diferentes hues) de los saturados
    const selectedColors: typeof saturatedColors = []
    for (const color of saturatedColors) {
      if (selectedColors.length >= 3) break  // Máximo 3 colores saturados
      
      // Verificar que sea diferente de los ya seleccionados
      const isDifferent = selectedColors.every(selected => {
        const hueDiff = Math.min(
          Math.abs(color.hue - selected.hue),
          360 - Math.abs(color.hue - selected.hue)
        )
        return hueDiff > 30  // Mínimo 30 grados de diferencia
      })
      
      if (isDifferent || selectedColors.length === 0) {
        selectedColors.push(color)
      }
    }
    
    // Agregar el color oscuro más común si existe y tiene suficientes píxeles
    if (darkColors.length > 0 && darkColors[0].count > 100) {
      selectedColors.push(darkColors[0])
      logger.info(`[${jobId}] Added dark/gray color: ${darkColors[0].color} (${darkColors[0].count} pixels)`)
    }
    
    // Convertir a hex
    const hexColors = selectedColors.map(({ color }) => {
      const [r, g, b] = color.split(',').map(Number)
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
    })
    
    logger.info(`[${jobId}] Selected foreground colors: ${hexColors.join(', ')}`)
    
    return hexColors.length > 0 ? hexColors : ['#3cb4dc', '#dc3ca0']  // Fallback
    
  } catch (error) {
    logger.error(`[${jobId}] Error extracting foreground colors:`, error)
    return ['#3cb4dc', '#dc3ca0']  // Fallback
  }
}
