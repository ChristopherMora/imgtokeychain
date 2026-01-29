import sharp from 'sharp'
import path from 'path'
import fs from 'fs/promises'
import { logger } from '../utils/logger'

interface ColorMask {
  color: string
  maskPath: string
}

/**
 * Genera una imagen compuesta combinando todas las máscaras de color.
 * Esta imagen es útil para debugging y para mostrar un preview 2D del resultado.
 */
export const generateCompositeImage = async (
  colorMasks: ColorMask[],
  jobId: string,
  storagePath: string
): Promise<string> => {
  try {
    logger.info(`[${jobId}] Generating composite image from ${colorMasks.length} masks`)
    
    // Leer todas las máscaras
    const maskBuffers: { color: string; buffer: Buffer; width: number; height: number }[] = []
    
    for (const { color, maskPath } of colorMasks) {
      // Leer el PGM
      const pgmData = await fs.readFile(maskPath)
      
      // Parsear header PGM (P5)
      let offset = 0
      const magic = pgmData.toString('ascii', offset, offset + 2)
      offset = pgmData.indexOf(0x0a, offset) + 1 // Saltar primera línea
      
      const dimensionsLine = pgmData.toString('ascii', offset, pgmData.indexOf(0x0a, offset))
      const [width, height] = dimensionsLine.trim().split(' ').map(Number)
      offset = pgmData.indexOf(0x0a, offset) + 1 // Saltar segunda línea
      
      offset = pgmData.indexOf(0x0a, offset) + 1 // Saltar línea de maxval
      
      const buffer = pgmData.slice(offset)
      
      maskBuffers.push({ color, buffer, width, height })
    }
    
    // Crear imagen base blanca
    const { width, height } = maskBuffers[0]
    const composite = Buffer.alloc(width * height * 3, 255) // RGB blanco
    
    // Aplicar cada máscara con su color
    for (const { color, buffer } of maskBuffers) {
      const rgb = hexToRgb(color)
      
      for (let i = 0; i < buffer.length; i++) {
        if (buffer[i] > 127) { // Píxel blanco en la máscara
          const offset = i * 3
          composite[offset] = rgb.r
          composite[offset + 1] = rgb.g
          composite[offset + 2] = rgb.b
        }
      }
    }
    
    // Guardar como PNG
    const outputPath = path.join(storagePath, 'processed', `${jobId}_composite.png`)
    
    await sharp(composite, {
      raw: { width, height, channels: 3 }
    })
      .png()
      .toFile(outputPath)
    
    logger.info(`[${jobId}] Composite image saved: ${outputPath}`)
    
    return outputPath
    
  } catch (error) {
    logger.error(`[${jobId}] Error generating composite:`, error)
    throw error
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 }
}
