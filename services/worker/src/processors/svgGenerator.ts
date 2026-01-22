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
    
    // Potrace optimizado para bordes más suaves
    // -s = SVG output
    // -o = output file  
    // -i = invert: trazar áreas BLANCAS (porque nuestras máscaras tienen blanco=logo, negro=fondo)
    // NO usar --tight para mantener el viewBox completo de la máscara (1000x1000)
    // -t 5 = turdsize (eliminar manchas pequeñas)
    // -a 1.0 = alphamax (suavizado de esquinas, 1.0 = balance)
    // -O 0.8 = optimización moderada-alta para suavizar
    const command = `potrace "${imagePath}" -i -s -o "${outputPath}" -t 5 -a 1.0 -O 0.8`
    
    logger.info(`Running potrace: ${command}`)
    
    const { stdout, stderr } = await execAsync(command)
    
    if (stderr) {
      logger.warn(`Potrace stderr: ${stderr}`)
    }
    
    logger.info(`SVG generated successfully: ${outputPath}`)
    
    // Normalizar el SVG para que tenga viewBox 0 0 100 100
    // Esto permite que OpenSCAD lo escale correctamente con los parámetros width/height
    await normalizeSVG(outputPath)
    
    return outputPath
  } catch (error) {
    logger.error('Error generating SVG:', error)
    throw new Error(`Failed to generate SVG: ${error}`)
  }
}

/**
 * Normaliza el SVG generado por Potrace
 * Remueve el transform interno que Potrace agrega y que interfiere con OpenSCAD
 */
async function normalizeSVG(svgPath: string): Promise<void> {
  try {
    const content = await fs.readFile(svgPath, 'utf-8')
    
    // Potrace agrega un <g> con transform que debemos eliminar
    // Ejemplo: <g transform="translate(0,4500) scale(0.1,-0.1)">
    // Este transform interfiere con OpenSCAD
    const normalizedContent = content
      .replace(/<g transform="[^"]*"/g, '<g')
    
    await fs.writeFile(svgPath, normalizedContent)
    logger.info(`SVG normalized (transform removed): ${svgPath}`)
    
  } catch (error) {
    logger.error('Error normalizing SVG:', error)
  }
}

