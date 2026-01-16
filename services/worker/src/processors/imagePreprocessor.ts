import sharp from 'sharp'
import path from 'path'
import { logger } from '../utils/logger'

const STORAGE_PATH = process.env.STORAGE_PATH || '/app/storage'

export const preprocessImage = async (inputPath: string, jobId: string): Promise<string> => {
  try {
    // Cambio a formato PGM (Portable GrayMap) que Potrace puede leer
    const outputPath = path.join(STORAGE_PATH, 'processed', `${jobId}_processed.pgm`)
    
    // Load image
    const image = sharp(inputPath)
    const metadata = await image.metadata()
    
    logger.info(`Processing image: ${metadata.width}x${metadata.height}`)

    // Process: Mejorado con blur para eliminar ruido, mejor contraste
    const buffer = await image
      .resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true }) // Limitar tamaño para mejor rendimiento
      .greyscale()
      .blur(0.5) // Blur ligero para eliminar ruido y suavizar bordes
      .normalize() // Maximizar contraste
      .linear(1.2, -(128 * 0.2)) // Aumentar contraste (gamma adjustment)
      .threshold(parseInt(process.env.IMAGE_THRESHOLD || '180')) // Threshold ajustable, default 180
      .negate() // Invertir: potrace espera negro = objeto, blanco = fondo
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
