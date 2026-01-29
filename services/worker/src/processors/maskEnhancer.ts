import sharp from 'sharp'
import { logger } from '../utils/logger'

/**
 * Mejora máscaras PGM para mejor vectorización con Potrace
 * 
 * Aplica:
 * 1. Erosión para eliminar ruido
 * 2. Dilatación para recuperar forma
 * 3. Detección de bordes para contornos limpios
 * 4. Threshold adaptivo
 */
export async function enhanceMask(
  maskBuffer: Buffer,
  width: number,
  height: number,
  jobId: string
): Promise<Buffer> {
  try {
    logger.info(`[${jobId}] Enhancing mask (${width}x${height})...`)
    
    // Step 1: Erosión (eliminar píxeles aislados/ruido)
    const eroded = await erode(maskBuffer, width, height, 2)
    
    // Step 2: Dilatación (recuperar forma)
    const dilated = await dilate(eroded, width, height, 3)
    
    // Step 3: Threshold para limpiar valores intermedios
    const thresholded = await threshold(dilated, 128)
    
    logger.info(`[${jobId}] Mask enhanced successfully`)
    
    return thresholded
  } catch (error) {
    logger.error(`[${jobId}] Error enhancing mask:`, error)
    return maskBuffer // Return original on error
  }
}

/**
 * Erosión morfológica - elimina píxeles en los bordes
 */
async function erode(buffer: Buffer, width: number, height: number, iterations: number = 1): Promise<Buffer> {
  let current = Buffer.from(buffer)
  
  for (let iter = 0; iter < iterations; iter++) {
    const result = Buffer.alloc(width * height)
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x
        
        // Si el píxel es negro, mantenerlo negro
        if (current[idx] === 0) {
          result[idx] = 0
          continue
        }
        
        // Verificar vecindad 3x3
        let allWhite = true
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const ny = y + dy
            
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nidx = ny * width + nx
              if (current[nidx] === 0) {
                allWhite = false
                break
              }
            }
          }
          if (!allWhite) break
        }
        
        result[idx] = allWhite ? 255 : 0
      }
    }
    
    current = result
  }
  
  return current
}

/**
 * Dilatación morfológica - expande píxeles blancos
 */
async function dilate(buffer: Buffer, width: number, height: number, iterations: number = 1): Promise<Buffer> {
  let current = Buffer.from(buffer)
  
  for (let iter = 0; iter < iterations; iter++) {
    const result = Buffer.alloc(width * height)
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x
        
        // Si el píxel es blanco, mantenerlo blanco
        if (current[idx] === 255) {
          result[idx] = 255
          continue
        }
        
        // Verificar vecindad 3x3 - si hay algún blanco, expandir
        let hasWhite = false
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const ny = y + dy
            
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nidx = ny * width + nx
              if (current[nidx] === 255) {
                hasWhite = true
                break
              }
            }
          }
          if (hasWhite) break
        }
        
        result[idx] = hasWhite ? 255 : 0
      }
    }
    
    current = result
  }
  
  return current
}

/**
 * Threshold binario simple
 */
async function threshold(buffer: Buffer, thresholdValue: number = 128): Promise<Buffer> {
  const result = Buffer.alloc(buffer.length)
  
  for (let i = 0; i < buffer.length; i++) {
    result[i] = buffer[i] >= thresholdValue ? 255 : 0
  }
  
  return result
}

/**
 * Detección de contornos usando operador Sobel
 */
export async function detectEdges(
  buffer: Buffer,
  width: number,
  height: number
): Promise<Buffer> {
  const result = Buffer.alloc(width * height)
  
  // Sobel kernels
  const sobelX = [
    [-1, 0, 1],
    [-2, 0, 2],
    [-1, 0, 1]
  ]
  
  const sobelY = [
    [-1, -2, -1],
    [0, 0, 0],
    [1, 2, 1]
  ]
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let gx = 0
      let gy = 0
      
      // Aplicar kernels de Sobel
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = (y + ky) * width + (x + kx)
          const pixel = buffer[idx]
          
          gx += pixel * sobelX[ky + 1][kx + 1]
          gy += pixel * sobelY[ky + 1][kx + 1]
        }
      }
      
      // Magnitud del gradiente
      const magnitude = Math.sqrt(gx * gx + gy * gy)
      const idx = y * width + x
      
      // Threshold para detectar bordes
      result[idx] = magnitude > 100 ? 255 : 0
    }
  }
  
  return result
}

/**
 * Aplica un filtro de mediana para eliminar ruido sal y pimienta
 */
export async function medianFilter(
  buffer: Buffer,
  width: number,
  height: number,
  windowSize: number = 3
): Promise<Buffer> {
  const result = Buffer.alloc(width * height)
  const half = Math.floor(windowSize / 2)
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const values: number[] = []
      
      // Recolectar valores en la ventana
      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          const nx = x + dx
          const ny = y + dy
          
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const idx = ny * width + nx
            values.push(buffer[idx])
          }
        }
      }
      
      // Ordenar y tomar la mediana
      values.sort((a, b) => a - b)
      const median = values[Math.floor(values.length / 2)]
      
      const idx = y * width + x
      result[idx] = median
    }
  }
  
  return result
}

/**
 * Combina múltiples técnicas para obtener una máscara limpia y vectorizable
 * NOTA: Reducida la erosión para preservar detalles finos como texto
 */
export async function optimizeMaskForPotrace(
  maskBuffer: Buffer,
  width: number,
  height: number,
  jobId: string
): Promise<Buffer> {
  logger.info(`[${jobId}] Optimizing mask for Potrace...`)
  
  try {
    // 1. Filtro de mediana para eliminar ruido salt-and-pepper
    const denoised = await medianFilter(maskBuffer, width, height, 3)
    
    // 2. Threshold para binarizar limpiamente
    const binarized = await threshold(denoised, 128)
    
    // 3. Dilatación mínima solo para conectar píxeles adyacentes
    const dilated = await dilate(binarized, width, height, 1)
    
    logger.info(`[${jobId}] Mask optimization complete (text-preserving mode)`)
    
    return dilated
  } catch (error) {
    logger.error(`[${jobId}] Error optimizing mask:`, error)
    return maskBuffer
  }
}
