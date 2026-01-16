import { PrismaClient } from '@prisma/client'
import path from 'path'
import { logger } from '../utils/logger'
import { preprocessImage, extractDominantColors } from './imagePreprocessor'
import { imageToSvg } from './svgGenerator'
import { svgToStl } from './stlGenerator'
import { addRing } from './ringGenerator'

const prisma = new PrismaClient()

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
  }
}

export const processImageJob = async (data: JobData) => {
  const { jobId, filePath, params } = data
  
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
    
    // Step 1: Preprocess image (remove background, binarize)
    const processedImagePath = await preprocessImage(filePath, jobId)
    await prisma.job.update({
      where: { id: jobId },
      data: { processedImagePath, progress: 30 },
    })
    
    logger.info(`[${jobId}] Image preprocessed: ${processedImagePath}`)

    // Step 2: Convert to SVG
    logger.info(`[${jobId}] Converting to SVG...`)
    const svgPath = await imageToSvg(processedImagePath, jobId)
    await prisma.job.update({
      where: { id: jobId },
      data: { svgPath, progress: 50 },
    })
    
    logger.info(`[${jobId}] SVG generated: ${svgPath}`)

    // Step 3: Generate STL from SVG
    logger.info(`[${jobId}] Generating STL...`)
    let stlPath = await svgToStl(svgPath, jobId, {
      width: params.width,
      height: params.height,
      thickness: params.thickness,
    })
    await prisma.job.update({
      where: { id: jobId },
      data: { stlPath, progress: 70 },
    })
    
    logger.info(`[${jobId}] STL generated: ${stlPath}`)

    // Step 4: Add ring if enabled (optional, continúa sin aro si falla)
    if (params.ringEnabled) {
      logger.info(`[${jobId}] Adding keyring...`)
      try {
        const stlWithRing = await addRing(stlPath, jobId, {
          diameter: params.ringDiameter,
          thickness: params.ringThickness,
          position: params.ringPosition,
        })
        stlPath = stlWithRing
        await prisma.job.update({
          where: { id: jobId },
          data: { stlPath, progress: 90 },
        })
        
        logger.info(`[${jobId}] Keyring added`)
      } catch (error) {
        logger.warn(`[${jobId}] Failed to add ring, continuing without it:`, error)
        // Continuar sin el aro - el STL básico ya está listo
      }
    }

    // Complete job
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        progress: 100,
        completedAt: new Date(),
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
