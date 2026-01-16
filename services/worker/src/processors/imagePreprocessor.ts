import sharp from 'sharp'
import path from 'path'
import { logger } from '../utils/logger'

const STORAGE_PATH = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../../storage')

// Extract dominant colors from image
export const extractDominantColors = async (inputPath: string): Promise<string[]> => {
  try {
    const image = sharp(inputPath)
    
    // Resize to small size for faster processing
    const { data, info } = await image
      .resize(100, 100, { fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true })
    
    // Count color frequencies
    const colorMap = new Map<string, number>()
    const channels = info.channels
    
    for (let i = 0; i < data.length; i += channels) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      
      // Skip near-white colors (background)
      if (r > 240 && g > 240 && b > 240) continue
      
      // Round to nearest 16 to group similar colors
      const rr = Math.round(r / 16) * 16
      const gg = Math.round(g / 16) * 16
      const bb = Math.round(b / 16) * 16
      
      const colorKey = `${rr},${gg},${bb}`
      colorMap.set(colorKey, (colorMap.get(colorKey) || 0) + 1)
    }
    
    // Sort by frequency and get top 5 colors
    const sortedColors = Array.from(colorMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([color]) => {
        const [r, g, b] = color.split(',').map(Number)
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
      })
    
    logger.info(`Extracted ${sortedColors.length} dominant colors: ${sortedColors.join(', ')}`)
    
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
