import sharp from 'sharp'
import path from 'path'
import fs from 'fs/promises'
import { logger } from '../utils/logger'

/**
 * Segmenta una imagen por colores dominantes
 * Crea una máscara binaria (PGM) por cada color
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
        
        // Calcular distancia al color objetivo (tolerancia)
        const distance = Math.sqrt(
          Math.pow(r - targetColor.r, 2) +
          Math.pow(g - targetColor.g, 2) +
          Math.pow(b - targetColor.b, 2)
        )
        
        // Si está cerca del color objetivo (tolerancia de 40), marcar como blanco
        const pixelIndex = Math.floor(i / channels)
        if (distance < 40) {
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
        
        // Crear archivo PGM (P5 = binario grayscale)
        const pgmHeader = `P5\n${width} ${height}\n255\n`
        const pgmData = Buffer.concat([
          Buffer.from(pgmHeader, 'ascii'),
          maskBuffer
        ])
        
        await fs.writeFile(maskPath, pgmData)
        
        logger.info(`[${jobId}] Mask created for ${colors[colorIndex]}: ${pixelCount} pixels`)
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
