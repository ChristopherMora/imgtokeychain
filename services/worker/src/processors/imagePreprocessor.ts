import sharp from 'sharp'
import path from 'path'
import { logger } from '../utils/logger'

const STORAGE_PATH = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../../storage')

// Extract dominant colors from image
export const extractDominantColors = async (inputPath: string): Promise<string[]> => {
  try {
    const image = sharp(inputPath)
    
    // Resize to larger size for better color sampling and gradient capture
    const { data, info } = await image
      .resize(400, 400, { fit: 'inside' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    
    // Count color frequencies with saturation tracking
    const colorMap = new Map<string, { count: number; saturation: number; hue: number }>()
    const channels = info.channels
    
    for (let i = 0; i < data.length; i += channels) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      
      // Skip very bright colors (near-white backgrounds)
      if (r > 245 && g > 245 && b > 245) continue
      
      // Skip very dark colors (near-black, likely noise/antialiasing)
      if (r < 40 && g < 40 && b < 40) continue
      
      // Quantize with smaller steps (15) for better color variety in gradients
      const rr = Math.min(255, Math.round(r / 15) * 15)
      const gg = Math.min(255, Math.round(g / 15) * 15)
      const bb = Math.min(255, Math.round(b / 15) * 15)
      
      // Calculate saturation and hue for color analysis
      const max = Math.max(rr, gg, bb)
      const min = Math.min(rr, gg, bb)
      const saturation = max === 0 ? 0 : (max - min) / max
      
      // Calculate hue (0-360)
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
    
    // Group colors into distinct hue ranges and pick the most vibrant/frequent from each
    const colorArray = Array.from(colorMap.entries()).map(([color, data]) => ({
      color,
      count: data.count,
      saturation: data.saturation,
      hue: data.hue,
    }))
    
    // Filter out background colors (too frequent) and low-saturation colors
    const totalPixels = colorArray.reduce((sum, c) => sum + c.count, 0)
    
    // Exclude colors that:
    // 1. Take up more than 60% of the image (likely background)
    // 2. Have very low saturation (grays, near-white, near-black)
    // 3. Have very few pixels (< 2% of image)
    const foregroundColors = colorArray.filter(c => {
      const percentage = c.count / totalPixels
      return percentage < 0.6 && percentage > 0.01 && c.saturation > 0.15
    })
    
    // If we don't have at least 2 colors, be less strict
    const colorsToUse = foregroundColors.length >= 2 
      ? foregroundColors 
      : colorArray.filter(c => c.saturation > 0.12 && (c.count / totalPixels) > 0.005)
    
    // Sort by saturation first (most vibrant), then frequency
    colorsToUse.sort((a, b) => {
      const satDiff = b.saturation - a.saturation
      if (Math.abs(satDiff) > 0.15) return satDiff > 0 ? 1 : -1
      return b.count - a.count
    })
    
    // Select diverse colors (avoid similar hues)
    const selectedColors: typeof colorsToUse = []
    for (const color of colorsToUse) {
      if (selectedColors.length >= 2) break  // Limitar a 2 colores principales
      
      // Check if this color is sufficiently different from already selected ones
      const isDifferent = selectedColors.every(selected => {
        const hueDiff = Math.min(
          Math.abs(color.hue - selected.hue),
          360 - Math.abs(color.hue - selected.hue)
        )
        // Requiere diferencia de HUE más grande (45 grados) para evitar variaciones
        return hueDiff > 45 || Math.abs(color.saturation - selected.saturation) > 0.4
      })
      
      if (isDifferent || selectedColors.length === 0) {
        selectedColors.push(color)
      }
    }
    
    const sortedColors = selectedColors.map(({ color }) => {
      const [r, g, b] = color.split(',').map(Number)
      // Ensure we clamp values to 0-255 and format correctly
      const rHex = Math.min(255, Math.max(0, r)).toString(16).padStart(2, '0')
      const gHex = Math.min(255, Math.max(0, g)).toString(16).padStart(2, '0')
      const bHex = Math.min(255, Math.max(0, b)).toString(16).padStart(2, '0')
      return `#${rHex}${gHex}${bHex}`
    })
    
    logger.info(`Extracted ${sortedColors.length} dominant colors: ${sortedColors.join(', ')}`)
    
    // If no colors found, return a default palette
    if (sortedColors.length === 0) {
      logger.warn('No colors extracted, using default blue')
      return ['#0ea5e9']
    }
    
    return sortedColors
  } catch (error) {
    logger.error('Error extracting colors:', error)
    return ['#0ea5e9'] // Default blue if extraction fails
  }
}

export const preprocessImage = async (inputPath: string, jobId: string, threshold: number = 180): Promise<string> => {
  try {
    // Cambio a formato PGM (Portable GrayMap) que Potrace puede leer
    const outputPath = path.join(STORAGE_PATH, 'processed', `${jobId}_processed.pgm`)
    
    // Load image
    const image = sharp(inputPath)
    const metadata = await image.metadata()
    
    logger.info(`Processing image: ${metadata.width}x${metadata.height}`)

    // Process: Capturar logos/imágenes sobre fondo blanco
    const hasAlpha = metadata.hasAlpha
    
    let processedImage = image.resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true })
    
    // Si tiene canal alpha, eliminar transparencia con fondo blanco
    if (hasAlpha) {
      processedImage = processedImage.flatten({ background: '#ffffff' })
    }
    
    // Convertir a blanco y negro: blanco puro = fondo, todo lo demás = objeto
    // Potrace espera: negro = área sólida del objeto, blanco = fondo/hueco
    
    // Estrategia: detectar píxeles que NO son blancos (cualquier color del logo)
    const rawBuffer = await processedImage
      .raw()
      .toBuffer({ resolveWithObject: true })
    
    const { data, info } = rawBuffer
    const width = info.width
    const height = info.height
    const channels = info.channels
    
    // Crear buffer para imagen binaria (blanco/negro)
    const binaryBuffer = Buffer.alloc(width * height)
    
    for (let i = 0; i < data.length; i += channels) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      
      const pixelIndex = Math.floor(i / channels)
      
      // Si el píxel NO es blanco (cualquier color del logo/contenido)
      // Considerar blanco solo si R, G y B están todos por encima del threshold
      if (r < threshold || g < threshold || b < threshold) {
        binaryBuffer[pixelIndex] = 0 // Negro = contenido sólido
      } else {
        binaryBuffer[pixelIndex] = 255 // Blanco = fondo
      }
    }

    // Crear archivo PGM manualmente (formato binario P5)
    const fs = require('fs')
    
    // Formato PGM P5 (binario)
    const header = `P5\n${width} ${height}\n255\n`
    const headerBuffer = Buffer.from(header, 'ascii')
    const pgmBuffer = Buffer.concat([headerBuffer, binaryBuffer])
    
    fs.writeFileSync(outputPath, pgmBuffer)

    logger.info(`Image preprocessed and saved to: ${outputPath}`)
    
    return outputPath
  } catch (error) {
    logger.error('Error preprocessing image:', error)
    throw new Error(`Failed to preprocess image: ${error}`)
  }
}
