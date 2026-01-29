import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs/promises'
import { logger } from '../utils/logger'

const execAsync = promisify(exec)
const STORAGE_PATH = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../../storage')

export const imageToSvg = async (imagePath: string, jobId: string): Promise<string> => {
  try {
    const outputPath = path.join(STORAGE_PATH, 'processed', `${jobId}.svg`)
    
    const command = `potrace "${imagePath}" -i -s -o "${outputPath}" -t 2 -a 0.0 -O 0.2 -n`
    
    logger.info(`Running potrace with HIGH DETAIL settings: ${command}`)
    
    const { stdout, stderr } = await execAsync(command)
    
    if (stderr) {
      logger.warn(`Potrace stderr: ${stderr}`)
    }
    
    logger.info(`SVG generated successfully with high detail: ${outputPath}`)
    
    await normalizeSVG(outputPath)
    
    return outputPath
  } catch (error) {
    logger.error('Error generating SVG:', error)
    throw new Error(`Failed to generate SVG: ${error}`)
  }
}

async function normalizeSVG(svgPath: string): Promise<void> {
  try {
    let content = await fs.readFile(svgPath, 'utf-8')
    
    const referenceRect = '<rect x="0" y="0" width="2000" height="2000" fill="none" stroke="none" opacity="0"/>'
    
    const insertPoint = content.indexOf('>', content.indexOf('<g')) + 1
    if (insertPoint > 0) {
      content = content.slice(0, insertPoint) + '\n' + referenceRect + content.slice(insertPoint)
      await fs.writeFile(svgPath, content, 'utf-8')
      logger.info(`SVG normalized with reference frame: ${svgPath}`)
    } else {
      logger.warn(`Could not find insertion point in SVG: ${svgPath}`)
    }
    
  } catch (error) {
    logger.error('Error normalizing SVG:', error)
  }
}
