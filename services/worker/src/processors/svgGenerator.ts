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
    
    // -u aumenta la cuantización (más precisión en coordenadas), útil para texto/líneas finas
    const command = `potrace "${imagePath}" -i -s -o "${outputPath}" -t 2 -a 0.0 -O 0.2 -u 50 -n`
    
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

    // Potrace genera width/height en "pt" (puntos). OpenSCAD respeta esas unidades físicas,
    // lo que produce modelos a escala incorrecta. Reescribimos el <svg> para que:
    // - width/height usen "mm"
    // - el tamaño físico sea igual al viewBox (1 unidad = 1mm antes de escalado en OpenSCAD)
    const svgTagMatch = content.match(/<svg\b[^>]*>/i)
    if (!svgTagMatch) {
      logger.warn(`Could not find <svg> tag in: ${svgPath}`)
      return
    }

    const svgTag = svgTagMatch[0]
    const viewBoxMatch = svgTag.match(/\bviewBox\s*=\s*(['"])([^'"]+)\1/i)
    if (!viewBoxMatch) {
      logger.warn(`Could not find viewBox in SVG: ${svgPath}`)
      return
    }

    const viewBoxParts = viewBoxMatch[2].trim().split(/[\s,]+/).map(Number)
    if (viewBoxParts.length < 4 || viewBoxParts.some(n => Number.isNaN(n))) {
      logger.warn(`Invalid viewBox in SVG: ${svgPath}`)
      return
    }

    const vbWidth = viewBoxParts[2]
    const vbHeight = viewBoxParts[3]

    const formatNumber = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/0+$/, '').replace(/\.$/, ''))
    const replaceOrInsertAttr = (tag: string, attr: string, value: string) => {
      if (new RegExp(`\\b${attr}\\s*=`, 'i').test(tag)) {
        return tag.replace(new RegExp(`\\b${attr}\\s*=\\s*(['\"]).*?\\1`, 'i'), `${attr}="${value}"`)
      }
      return tag.replace(/>$/, ` ${attr}="${value}">`)
    }

    let newSvgTag = svgTag
    newSvgTag = replaceOrInsertAttr(newSvgTag, 'width', `${formatNumber(vbWidth)}mm`)
    newSvgTag = replaceOrInsertAttr(newSvgTag, 'height', `${formatNumber(vbHeight)}mm`)

    if (newSvgTag !== svgTag) {
      content = content.replace(svgTag, newSvgTag)
    }

    // Insert an invisible reference rectangle to keep a stable frame (helps alignment across layers)
    const referenceRect = `<rect x="0" y="0" width="${formatNumber(vbWidth)}" height="${formatNumber(vbHeight)}" fill="none" stroke="none" opacity="0"/>`

    const gIndex = content.indexOf('<g')
    if (gIndex >= 0) {
      const tagEnd = content.indexOf('>', gIndex)
      if (tagEnd >= 0) {
        const insertPoint = tagEnd + 1
        if (!content.includes('<rect x="0" y="0"') && !content.includes(referenceRect)) {
          content = content.slice(0, insertPoint) + '\n' + referenceRect + content.slice(insertPoint)
        }
      }
    }

    await fs.writeFile(svgPath, content, 'utf-8')
    logger.info(`SVG normalized (mm units + reference frame): ${svgPath}`)
    
  } catch (error) {
    logger.error('Error normalizing SVG:', error)
  }
}
