import { PrismaClient } from '@prisma/client'
import path from 'path'
import fs from 'fs/promises'
import { logger } from '../utils/logger'
import { preprocessImage, extractDominantColors } from './imagePreprocessor'
import { imageToSvg } from './svgGenerator'
import { svgToStl } from './stlGenerator'
import { addRing } from './ringGenerator'
import { segmentByColorsWithSilhouette } from './colorSegmentation'
import { generate3MFFromColorSTLs } from './colorGenerator'
import { removeBackground, extractColorsFromForeground } from './backgroundRemover'
import { generateCompositeImage } from './compositeGenerator'
import { dilateMask, removeSmallComponents } from './maskEnhancer'

const prisma = new PrismaClient()

const STORAGE_PATH = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../../storage')
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/

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
    maxColors?: number
    borderEnabled?: boolean
    borderThickness?: number
    reliefEnabled?: boolean
  }
}

const createStrokeMask = async (
  jobId: string,
  storagePath: string,
  silhouetteMask: Buffer,
  width: number,
  height: number,
  params: JobData['params']
): Promise<{ color: string; maskPath: string } | null> => {
  const borderThicknessMm = params.borderThickness ?? 0
  if (!params.borderEnabled || borderThicknessMm <= 0) return null

  const pxPerMmX = width / Math.max(1, params.width)
  const pxPerMmY = height / Math.max(1, params.height)
  const strokePx = Math.max(1, Math.min(80, Math.round(borderThicknessMm * ((pxPerMmX + pxPerMmY) / 2))))

  const dilated = await dilateMask(silhouetteMask, width, height, strokePx)
  const ringMask = Buffer.alloc(width * height)

  let strokePixels = 0
  for (let i = 0; i < ringMask.length; i++) {
    if (dilated[i] === 255 && silhouetteMask[i] === 0) {
      ringMask[i] = 255
      strokePixels++
    }
  }

  if (strokePixels < Math.max(80, Math.round(width * height * 0.00005))) {
    logger.info(`[${jobId}] Stroke skipped: not enough pixels (${strokePixels})`)
    return null
  }

  const minComponentArea = Math.max(20, Math.round(width * height * 0.00002))
  const cleanedMask = removeSmallComponents(ringMask, width, height, minComponentArea)

  let cleanedPixels = 0
  for (let i = 0; i < cleanedMask.length; i++) {
    if (cleanedMask[i] === 255) cleanedPixels++
  }
  if (cleanedPixels < Math.max(50, Math.round(width * height * 0.00003))) {
    logger.info(`[${jobId}] Stroke skipped after cleanup: ${cleanedPixels} pixels`)
    return null
  }

  const maskPath = path.join(storagePath, 'processed', `${jobId}_stroke_mask.pgm`)
  const pgmHeader = `P5\n${width} ${height}\n255\n`
  await fs.writeFile(maskPath, Buffer.concat([Buffer.from(pgmHeader, 'ascii'), cleanedMask]))

  logger.info(
    `[${jobId}] Stroke layer created (${borderThicknessMm}mm -> ${strokePx}px): ${cleanedPixels} pixels`
  )
  return { color: '#f5f5f5', maskPath }
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
      STORAGE_PATH,
      params.threshold
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
    const extractedColors = await extractColorsFromForeground(
      cleanImagePath,
      silhouetteMask,
      width,
      height,
      jobId,
      params.maxColors
    )
    const dominantColors = extractedColors
      .map(color => color.trim())
      .filter(color => HEX_COLOR_REGEX.test(color))
    if (dominantColors.length === 0) {
      dominantColors.push('#3cb4dc', '#dc3ca0')
      logger.warn(`[${jobId}] No valid dominant colors extracted, using fallback palette`)
    } else if (dominantColors.length !== extractedColors.length) {
      logger.warn(
        `[${jobId}] Filtered invalid colors from palette. Before: ${extractedColors.join(', ')} | After: ${dominantColors.join(', ')}`
      )
    }
    await prisma.job.update({
      where: { id: jobId },
      data: { dominantColors, progress: 20 },
    })
    logger.info(`[${jobId}] Dominant colors: ${dominantColors.join(', ')}`)
    
    // Step 3: Segment colors WITHIN the silhouette
    logger.info(`[${jobId}] Step 3: Segmenting colors within silhouette...`)
    const colorMasks = await segmentByColorsWithSilhouette(
      cleanImagePath,
      dominantColors,
      silhouetteMask,
      width,
      height,
      jobId,
      STORAGE_PATH
    )

    const strokeMask = await createStrokeMask(
      jobId,
      STORAGE_PATH,
      silhouetteMask,
      width,
      height,
      params
    )
    if (strokeMask) {
      colorMasks.unshift(strokeMask)
    }

    logger.info(`[${jobId}] Created ${colorMasks.length} color masks`)

    // Importante: la segmentación puede agregar/quitar capas (ej: negro para texto/runner),
    // así que persistimos el set final de colores para que API/Frontend descarguen la misma cantidad de STLs.
    const finalColors = colorMasks.map(m => m.color)
    await prisma.job.update({
      where: { id: jobId },
      data: { dominantColors: finalColors },
    })
    
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
    const isMulticolor = colorMasks.length > 1
    
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
        // Importante: NO aplicar borde/offset por capa en multicolor.
        // Eso infla cada región de color y termina "embarrando" el logo (se fusionan y se pierden detalles).
        borderEnabled: isMulticolor ? false : params.borderEnabled,
        borderThickness: isMulticolor ? undefined : params.borderThickness,
        reliefEnabled: isMulticolor ? false : params.reliefEnabled,
      })
      
      colorSTLs.push({ color, stlPath })
      logger.info(`[${jobId}] STL for ${color}: ${stlPath}`)
      
      await prisma.job.update({
        where: { id: jobId },
        data: { progress: Math.round(progressBase + 20) },
      })
    }
    
    // Step 4: Add ring if enabled (to first object only for now)
    let finalStlPath = colorSTLs[0].stlPath
    if (params.ringEnabled) {
      logger.info(`[${jobId}] Adding ring...`)
      finalStlPath = await addRing(finalStlPath, jobId, {
        diameter: params.ringDiameter,
        thickness: params.ringThickness,
        position: params.ringPosition,
      })

      // Asegurar que 3MF/ZIP usen el STL con aro
      colorSTLs[0].stlPath = finalStlPath
    }

    // Step 5: Generate 3MF with all colored objects (incluye aro si aplica)
    logger.info(`[${jobId}] Creating multi-color 3MF...`)
    const mfPath = await generate3MFFromColorSTLs(colorSTLs, jobId, STORAGE_PATH)
    
    await prisma.job.update({
      where: { id: jobId },
      data: { 
        stlPath: finalStlPath, // STL base para preview/descarga
        progress: 70 
      },
    })
    
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
        es: `Este archivo contiene:\n1. Un archivo 3MF multi-color con ${colorSTLs.length} colores/capas (compatible con Bambu Studio)\n2. ${colorSTLs.length} archivos STL individuales (uno por color)\n\nCómo usar:\n- Abre ${jobId}_multicolor.3mf en Bambu Studio o un slicer compatible con 3MF.\n- Si necesitas ajustar colores manualmente, importa los STLs del ZIP y asigna filamentos por pieza.\n- Ajusta configuración de impresora y listo.`,
        en: `This file contains:\n1. A multi-color 3MF with ${colorSTLs.length} colors/layers (Bambu Studio compatible)\n2. ${colorSTLs.length} individual STL files (one per color)\n\nHow to use:\n- Open ${jobId}_multicolor.3mf in Bambu Studio or any 3MF-compatible slicer.\n- If you need manual color control, import the STLs from the ZIP and assign filaments per part.\n- Adjust printer settings and you're ready.`
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
