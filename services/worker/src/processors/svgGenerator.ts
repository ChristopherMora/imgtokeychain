import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { logger } from '../utils/logger'

const execAsync = promisify(exec)
const STORAGE_PATH = process.env.STORAGE_PATH || '/app/storage'

export const imageToSvg = async (imagePath: string, jobId: string): Promise<string> => {
  try {
    const outputPath = path.join(STORAGE_PATH, 'processed', `${jobId}.svg`)
    
    // Use potrace with optimized parameters for better quality
    // -s = SVG output
    // -o = output file
    // --tight = tight bounding box
    // -a 1.5 = alphamax (corner threshold, higher = smoother corners)
    // -O 0.2 = optimization tolerance (simplify curves)
    const command = `potrace "${imagePath}" -s -o "${outputPath}" --tight -a 1.5 -O 0.2`
    
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
