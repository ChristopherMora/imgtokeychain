import sharp from 'sharp'
import path from 'path'
import { logger } from '../utils/logger'

const STORAGE_PATH = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../../storage')

// Extract dominant colors from image
export const extractDominantColors = async (inputPath: string): Promise<string[]> => {
  try {
    const image = sharp(inputPath)
    
    // Resize to medium size for better color sampling
    const { data, info } = await image
      .resize(200, 200, { fit: 'inside' })
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
      
      // Quantize with smaller steps (20) for better color variety, and clamp to 0-255
      const rr = Math.min(255, Math.round(r / 20) * 20)
      const gg = Math.min(255, Math.round(g / 20) * 20)
      const bb = Math.min(255, Math.round(b / 20) * 20)
      
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
    
    // Filter out low-saturation colors if we have enough saturated ones
    const saturatedColors = colorArray.filter(c => c.saturation > 0.2)
    const colorsToUse = saturatedColors.length >= 3 ? saturatedColors : colorArray
    
    // Sort by saturation first (most vibrant), then frequency
    colorsToUse.sort((a, b) => {
      const satDiff = b.saturation - a.saturation
      if (Math.abs(satDiff) > 0.15) return satDiff > 0 ? 1 : -1
      return b.count - a.count
    })
    
    // Select diverse colors (avoid similar hues)
    const selectedColors: typeof colorsToUse = []
    for (const color of colorsToUse) {
      if (selectedColors.length >= 5) break
      
      // Check if this color is sufficiently different from already selected ones
      const isDifferent = selectedColors.every(selected => {
        const hueDiff = Math.min(
          Math.abs(color.hue - selected.hue),
          360 - Math.abs(color.hue - selected.hue)
        )
        return hueDiff > 30 || Math.abs(color.saturation - selected.saturation) > 0.3
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

export const preprocessImage = async (inputPath: string, jobId: string): Promise<string> => {
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
    const buffer = await processedImage
      .greyscale()
      .linear(1.5, -50) // Aumentar contraste
      .threshold(240) // Solo blanco puro (>240) se vuelve blanco, resto negro
      // NO negate - queremos que los colores del logo se vuelvan negros (sólidos)
      .median(2) // Limpiar ruido
      .raw()
      .toBuffer({ resolveWithObject: true })

    // Crear archivo PGM manualmente (formato binario P5)
    const { data, info } = buffer
    const fs = require('fs')
    
    // Formato PGM P5 (binario)
    const header = `P5\n${info.width} ${info.height}\n255\n`
    const headerBuffer = Buffer.from(header, 'ascii')
    const pgmBuffer = Buffer.concat([headerBuffer, data])
    
    fs.writeFileSync(outputPath, pgmBuffer)

    logger.info(`Image preprocessed and saved to: ${outputPath}`)
    
    return outputPath
  } catch (error) {
    logger.error('Error preprocessing image:', error)
    throw new Error(`Failed to preprocess image: ${error}`)
  }
}
