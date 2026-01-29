import { PrismaClient } from '@prisma/client'
import path from 'path'
import fs from 'fs/promises'
import { logger } from '../utils/logger'
import { preprocessImage, extractDominantColors } from './imagePreprocessor'
import { imageToSvg } from './svgGenerator'
import { svgToStl } from './stlGenerator'
import { svgToStlThree } from './stlGeneratorThree'
import { addRing } from './ringGenerator'
import { segmentByColorsWithSilhouette } from './colorSegmentation'
import { generate3MFFromColorSTLs } from './colorGenerator'
import { removeBackground, extractColorsFromForeground } from './backgroundRemover'
import { generateCompositeImage } from './compositeGenerator'

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
    
    // === NUEVO ENFOQUE: Primero remover el fondo ===
    
    // Step 1: Remove background and create silhouette mask
    logger.info(`[${jobId}] Step 1: Removing background...`)
    const { cleanImagePath, silhouetteMaskPath, width, height } = await removeBackground(
      filePath,
      jobId,
      STORAGE_PATH
    )
    
    // Leer la máscara de silueta para usarla en la extracción de colores
    const silhouetteMaskData = await fs.readFile(silhouetteMaskPath)
    // Extraer solo los datos binarios (saltar el header PGM)
    const headerEnd = silhouetteMaskData.indexOf(0x0a, silhouetteMaskData.indexOf(0x0a, 3) + 1) + 1
    const silhouetteMask = silhouetteMaskData.slice(headerEnd)
    
    await prisma.job.update({
      where: { id: jobId },
      data: { progress: 15 },
    })
    
    // Step 2: Extract dominant colors from FOREGROUND ONLY
    logger.info(`[${jobId}] Step 2: Extracting colors from foreground...`)
    const dominantColors = await extractColorsFromForeground(
      filePath,
      silhouetteMask,
      width,
      height,
      jobId
    )
    await prisma.job.update({
      where: { id: jobId },
      data: { dominantColors, progress: 20 },
    })
    logger.info(`[${jobId}] Dominant colors: ${dominantColors.join(', ')}`)
    
    // Step 3: Segment colors WITHIN the silhouette
    logger.info(`[${jobId}] Step 3: Segmenting colors within silhouette...`)
    const colorMasks = await segmentByColorsWithSilhouette(
      filePath,
      dominantColors,
      silhouetteMask,
      width,
      height,
      jobId,
      STORAGE_PATH
    )
    logger.info(`[${jobId}] Created ${colorMasks.length} color masks`)
    
    if (colorMasks.length === 0) {
      throw new Error('No colors detected in image. Try adjusting the threshold.')
    }
    
    // Generar imagen compuesta para preview 2D
    logger.info(`[${jobId}] Generating composite preview image...`)
    await generateCompositeImage(colorMasks, jobId, STORAGE_PATH)
    
    await prisma.job.update({
      where: { id: jobId },
      data: { progress: 20 },
    })
    
    // Arrays to hold STLs per color
    const colorSTLs: { color: string; stlPath: string }[] = []
    
    // Step 3: Process each color mask separately
    for (let i = 0; i < colorMasks.length; i++) {
      const { color, maskPath } = colorMasks[i]
      const progressBase = 20 + (i * 40 / colorMasks.length)
      
      logger.info(`[${jobId}] Processing color ${i + 1}/${colorMasks.length}: ${color}`)
      
      // Convert mask to SVG
      const svgPath = await imageToSvg(maskPath, `${jobId}_color${i}`)
      await prisma.job.update({
        where: { id: jobId },
        data: { progress: Math.round(progressBase + 10) },
      })
      
      // Generate STL from SVG using OpenSCAD (probado y confiable)
      logger.info(`[${jobId}] Generating STL with OpenSCAD for color ${i}`)
      const stlPath = await svgToStl(svgPath, `${jobId}_color${i}`, {
        width: params.width,
        height: params.height,
        thickness: params.thickness,
        borderEnabled: params.borderEnabled,
        borderThickness: params.borderThickness,
      })
      
      colorSTLs.push({ color, stlPath })
      logger.info(`[${jobId}] STL for ${color}: ${stlPath}`)
      
      await prisma.job.update({
        where: { id: jobId },
        data: { progress: Math.round(progressBase + 20) },
      })
    }
    
    // Step 4: Generate 3MF with all colored objects
    logger.info(`[${jobId}] Creating multi-color 3MF...`)
    const mfPath = await generate3MFFromColorSTLs(colorSTLs, jobId, STORAGE_PATH)
    
    await prisma.job.update({
      where: { id: jobId },
      data: { 
        stlPath: colorSTLs[0].stlPath, // First STL for preview
        progress: 70 
      },
    })
    
    // Step 5: Add ring if enabled (to first object only for now)
    let finalStlPath = colorSTLs[0].stlPath
    if (params.ringEnabled) {
      logger.info(`[${jobId}] Adding ring...`)
      finalStlPath = await addRing(colorSTLs[0].stlPath, jobId, {
        diameter: params.ringDiameter,
        thickness: params.ringThickness,
        position: params.ringPosition,
      })
      await prisma.job.update({
        where: { id: jobId },
        data: { stlPath: finalStlPath },
      })
    }
    
    // Step 6: Create ZIP with all color STLs for manual use
    logger.info(`[${jobId}] Creating ZIP with individual STLs...`)
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    
    // Add all STL files
    for (let i = 0; i < colorSTLs.length; i++) {
      const { color, stlPath } = colorSTLs[i]
      const stlContent = await fs.readFile(stlPath)
      const fileName = `color_${i + 1}_${color.replace('#', '')}.stl`
      zip.file(fileName, stlContent)
    }
    
    // Add 3MF file
    const mfContent = await fs.readFile(mfPath)
    zip.file(`${jobId}_multicolor.3mf`, mfContent)
    
    // Add color configuration JSON
    const colorConfig = {
      version: '1.0',
      jobId,
      totalColors: colorSTLs.length,
      colors: colorSTLs.map((item, index) => ({
        id: index + 1,
        hex: item.color,
        name: `Color ${index + 1}`,
        stlFile: `color_${index + 1}_${item.color.replace('#', '')}.stl`
      })),
      files: {
        threemf: `${jobId}_multicolor.3mf`,
        stls: colorSTLs.map((item, i) => `color_${i + 1}_${item.color.replace('#', '')}.stl`)
      },
      instructions: {
        es: `Este archivo contiene:\n1. Un archivo 3MF listo para Bambu Studio/PrusaSlicer con ${colorSTLs.length} colores\n2. ${colorSTLs.length} archivos STL individuales por si necesitas importarlos manualmente\n\nPara usar el 3MF:\n- Abre ${jobId}_multicolor.3mf en tu slicer\n- Los colores ya están asignados\n- Ajusta configuración de impresora y listo`,
        en: `This file contains:\n1. A 3MF file ready for Bambu Studio/PrusaSlicer with ${colorSTLs.length} colors\n2. ${colorSTLs.length} individual STL files in case you need to import them manually\n\nTo use the 3MF:\n- Open ${jobId}_multicolor.3mf in your slicer\n- Colors are already assigned\n- Adjust printer settings and you're ready`
      }
    }
    
    zip.file('colors.json', JSON.stringify(colorConfig, null, 2))
    zip.file('README.txt', `${colorConfig.instructions.es}\n\n---\n\n${colorConfig.instructions.en}`)
    
    // Generate ZIP
    const zipPath = path.join(STORAGE_PATH, 'processed', `${jobId}_multicolor.zip`)
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })
    await fs.writeFile(zipPath, zipBuffer)
    logger.info(`[${jobId}] Multi-color ZIP created: ${zipPath}`)
    
    await prisma.job.update({
      where: { id: jobId },
      data: { progress: 90 },
    })
    
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
