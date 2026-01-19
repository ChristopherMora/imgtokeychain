import { PrismaClient } from '@prisma/client'
import path from 'path'
import fs from 'fs/promises'
import { logger } from '../utils/logger'
import { preprocessImage, extractDominantColors } from './imagePreprocessor'
import { imageToSvg } from './svgGenerator'
import { svgToStl } from './stlGenerator'
import { addRing } from './ringGenerator'
import { segmentByColors } from './colorSegmentation'

const prisma = new PrismaClient()

const STORAGE_PATH = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../../storage')

interface JobData {
  jobId: string
  filePath: string
  params: {
    width: number
    height: number
    thickness: number
    ringEnabled: boolean
    ringDiameter: number
    ringThickness: number
    ringPosition: string
    threshold?: number
    borderEnabled?: boolean
    borderThickness?: number
    reliefEnabled?: boolean
  }
}

export const processImageJob = async (data: JobData) => {
  const { jobId, filePath, params } = data
  
  // DEBUG: Log parámetros recibidos
  logger.info(`[${jobId}] Parámetros recibidos en Worker:`, JSON.stringify(params, null, 2))
  
  try {
    // Update status to processing
    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'PROCESSING', progress: 10 },
    })

    logger.info(`[${jobId}] Starting image preprocessing...`)
    
    // Step 0: Extract dominant colors from original image
    logger.info(`[${jobId}] Extracting dominant colors...`)
    const dominantColors = await extractDominantColors(filePath)
    await prisma.job.update({
      where: { id: jobId },
      data: { dominantColors, progress: 5 },
    })
    logger.info(`[${jobId}] Dominant colors: ${dominantColors.join(', ')}`)
    
    // Step 0.5: Segment image by colors (create masks)
    logger.info(`[${jobId}] Segmenting image by colors...`)
    const colorMasks = await segmentByColors(filePath, dominantColors, jobId, STORAGE_PATH)
    logger.info(`[${jobId}] Created ${colorMasks.length} color masks`)
    
    // Arrays to hold STLs per color
    const colorSTLs: { color: string; stlPath: string }[] = []
    
    // Process each color mask separately
    for (let i = 0; i < colorMasks.length; i++) {
      const { color, maskPath } = colorMasks[i]
      logger.info(`[${jobId}] Processing color ${color}...`)
      logger.info(`[${jobId}] Converting mask to SVG: ${maskPath}`)
      
      // Convert mask to SVG
      const svgPath = await imageToSvg(maskPath, `${jobId}_color${i}`)
      logger.info(`[${jobId}] SVG conversion completed for ${color}`)
      logger.info(`[${jobId}] SVG for ${color}: ${svgPath}`)
      
      // Generate STL from SVG
      const stlPath = await svgToStl(svgPath, `${jobId}_color${i}`, {
        width: params.width,
        height: params.height,
        thickness: params.thickness,
        borderEnabled: params.borderEnabled,
        borderThickness: params.borderThickness,
        reliefEnabled: params.reliefEnabled,
      })
      
      colorSTLs.push({ color, stlPath })
      logger.info(`[${jobId}] STL for ${color}: ${stlPath}`)
    }
    
    await prisma.job.update({
      where: { id: jobId },
      data: { progress: 70 },
    })
    
    // Step 3.5: Generate 3MF with multiple colored objects
    // NOTA: 3MF multi-objeto requiere parsear STLs y convertir a mesh XML nativo
    // Por ahora, ofrecemos los STLs individuales que el usuario puede importar manualmente
    logger.info(`[${jobId}] Multi-color STLs generated successfully`)
    logger.info(`[${jobId}] Generated ${colorSTLs.length} color-separated STL files`)
    
    // Save color configuration file for reference
    const colorConfigPath = path.join(STORAGE_PATH, 'processed', `${jobId}_colors.json`)
    const colorConfig = {
      format: '1.0',
      totalColors: colorSTLs.length,
      colors: colorSTLs.map((item, index) => ({
        id: index + 1,
        hex: item.color,
        name: `Color ${index + 1}`,
        stlFile: path.basename(item.stlPath),
        downloadUrl: `/jobs/${jobId}/download-color/${index}`
      })),
      instructions: {
        es: `Este llavero tiene ${colorSTLs.length} colores separados. Cada color está en un archivo STL individual. Importa todos los STLs en Bambu Studio/PrusaSlicer y asigna el color correspondiente a cada pieza.`,
        en: `This keychain has ${colorSTLs.length} separated colors. Each color is in an individual STL file. Import all STLs into Bambu Studio/PrusaSlicer and assign the corresponding color to each part.`
      },
      files: colorSTLs.map((item, index) => path.basename(item.stlPath))
    }
    await fs.writeFile(colorConfigPath, JSON.stringify(colorConfig, null, 2))
    logger.info(`[${jobId}] Color config saved: ${colorConfigPath}`)
    
    // Use the first STL as the main one for download compatibility
    const stlPath = colorSTLs.length > 0 ? colorSTLs[0].stlPath : ''
    
    // Update final status with multi-color info
    await prisma.job.update({
      where: { id: jobId },
      data: { 
        stlPath, // First color STL for preview
        progress: 90 
      },
    })
    
    logger.info(`[${jobId}] Multi-color processing completed successfully!`)
    logger.info(`[${jobId}] - Main STL (color 1): ${stlPath}`)
    logger.info(`[${jobId}] - Total color STLs: ${colorSTLs.length}`)
    logger.info(`[${jobId}] - Color config: ${colorConfigPath}`)
    
    // Create a ZIP file with all color STLs for easy download
    logger.info(`[${jobId}] Creating ZIP with all color STLs...`)
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    
    // Add all STL files to ZIP
    for (let i = 0; i < colorSTLs.length; i++) {
      const { color, stlPath: colorStlPath } = colorSTLs[i]
      const stlContent = await fs.readFile(colorStlPath)
      const fileName = `color_${i + 1}_${color.replace('#', '')}.stl`
      zip.file(fileName, stlContent)
    }
    
    // Add color JSON to ZIP
    zip.file('colors.json', JSON.stringify(colorConfig, null, 2))
    
    // Add instructions
    const instructions = `INSTRUCCIONES / INSTRUCTIONS

ES:
1. Extrae todos los archivos STL de este ZIP
2. Abre Bambu Studio o PrusaSlicer  
3. Importa TODOS los archivos STL (${colorSTLs.length} archivos)
4. En la lista de objetos, selecciona cada pieza y asigna el color indicado en colors.json
5. Los colores son:
${colorSTLs.map((item, i) => `   - color_${i + 1}_${item.color.replace('#', '')}.stl → ${item.color}`).join('\n')}

EN:
1. Extract all STL files from this ZIP
2. Open Bambu Studio or PrusaSlicer
3. Import ALL STL files (${colorSTLs.length} files)
4. In the object list, select each part and assign the color indicated in colors.json
5. Colors are:
${colorSTLs.map((item, i) => `   - color_${i + 1}_${item.color.replace('#', '')}.stl → ${item.color}`).join('\n')}
`
    zip.file('INSTRUCTIONS.txt', instructions)
    
    // Generate ZIP file
    const zipPath = path.join(STORAGE_PATH, 'processed', `${jobId}_multicolor.zip`)
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })
    await fs.writeFile(zipPath, zipBuffer)
    logger.info(`[${jobId}] Multi-color ZIP created: ${zipPath}`)
    
    // Skip ring generation for now (complex to add to multiple STLs)
    
    // Mark job as completed
    await prisma.job.update({
      where: { id: jobId },
      data: { 
        status: 'COMPLETED',
        progress: 100,
        completedAt: new Date()
      },
    })
    
    logger.info(`[${jobId}] Job completed successfully!`)
    
  } catch (error) {
    logger.error(`[${jobId}] Error processing job:`, error)
    
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      },
    })
    
    throw error
  }
}
