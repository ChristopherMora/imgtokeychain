import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { logger } from '../utils/logger'

const execAsync = promisify(exec)
const STORAGE_PATH = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../../storage')

export const imageToSvg = async (imagePath: string, jobId: string): Promise<string> => {
  try {
    const outputPath = path.join(STORAGE_PATH, 'processed', `${jobId}.svg`)
    
    // Potrace optimizado para bordes más suaves
    // -s = SVG output
    // -o = output file  
    // --tight = tight bounding box
    // -t 5 = turdsize (eliminar manchas pequeñas)
    // -a 1.0 = alphamax (suavizado de esquinas, 1.0 = balance)
    // -O 0.8 = optimización moderada-alta para suavizar
    // -n = turn policy white (mantener detalles internos)
    const command = `potrace "${imagePath}" -s -o "${outputPath}" --tight -t 5 -a 1.0 -O 0.8 -n`
    
    logger.info(`Running potrace: ${command}`)
    
    const { stdout, stderr } = await execAsync(command)
    
    if (stderr) {
      logger.warn(`Potrace stderr: ${stderr}`)
    }
    
    logger.info(`SVG generated successfully: ${outputPath}`)
    
    return outputPath
  } catch (error) {
    logger.error('Error generating SVG:', error)
    throw new Error(`Failed to generate SVG: ${error}`)
  }
}
