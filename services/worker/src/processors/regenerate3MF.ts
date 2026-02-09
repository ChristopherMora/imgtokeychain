import path from 'path'
import fs from 'fs'
import { logger } from '../utils/logger'
import { PrismaClient } from '@prisma/client'
import { generate3MFFromColorSTLs } from './colorGenerator'
import { generateCompositeImage } from './compositeGenerator'
import JSZip from 'jszip'

const prisma = new PrismaClient()

/**
 * Regenerate 3MF file with new colors
 */
export const regenerate3MFJob = async (data: {
  jobId: string
  colors: string[]
  stlPath: string
}) => {
  const { jobId, colors, stlPath } = data
  
  try {
    logger.info(`[${jobId}] Starting 3MF regeneration with new colors...`)
    logger.info(`[${jobId}] Colors: ${colors.join(', ')}`)
    logger.info(`[${jobId}] STL Path: ${stlPath}`)

    // Check if STL exists
    if (!fs.existsSync(stlPath)) throw new Error(`STL file not found: ${stlPath}`)

    // Get storage path from environment
    const STORAGE_PATH = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../../storage')
    const processedDir = path.join(STORAGE_PATH, 'processed')

    // Build color STL objects using the already-generated per-color STLs when available.
    const ringOnFirstLayer = path.basename(stlPath).includes('_with_ring')
    const colorSTLs = colors.map((color, index) => {
      const candidate = path.join(processedDir, `${jobId}_color${index}.stl`)
      const useCandidate = fs.existsSync(candidate) && !(index === 0 && ringOnFirstLayer)
      return {
        color,
        stlPath: useCandidate ? candidate : stlPath,
      }
    })

    // Regenerate the 3MF file
    const mfPath = await generate3MFFromColorSTLs(colorSTLs, jobId, STORAGE_PATH)

    // Regenerar preview 2D con nuevos colores si existen máscaras
    try {
      const maskEntries = colors.map((color, index) => ({
        color,
        maskPath: path.join(processedDir, `${jobId}_color${index}_mask.pgm`),
      }))
      const existingMasks = maskEntries.filter(entry => fs.existsSync(entry.maskPath))
      if (existingMasks.length === colors.length) {
        await generateCompositeImage(existingMasks, jobId, STORAGE_PATH)
      } else {
        logger.warn(`[${jobId}] Composite not regenerated: missing ${colors.length - existingMasks.length} mask(s)`)
      }
    } catch (error) {
      logger.warn(`[${jobId}] Failed to regenerate composite preview:`, error)
    }

    // Regenerate the multi-color ZIP so downloads always include the latest 3MF/colors.
    const zipPath = path.join(processedDir, `${jobId}_multicolor.zip`)
    const zip = new JSZip()

    for (let i = 0; i < colorSTLs.length; i++) {
      const { color, stlPath: layerStlPath } = colorSTLs[i]
      if (!fs.existsSync(layerStlPath)) continue
      const stlContent = fs.readFileSync(layerStlPath)
      const fileName = `color_${i + 1}_${color.replace('#', '')}.stl`
      zip.file(fileName, stlContent)
    }

    const mfContent = fs.readFileSync(mfPath)
    zip.file(`${jobId}_multicolor.3mf`, mfContent)

    const colorConfig = {
      version: '1.0',
      jobId,
      totalColors: colors.length,
      colors: colors.map((hex, index) => ({
        id: index + 1,
        hex,
        name: `Color ${index + 1}`,
        stlFile: `color_${index + 1}_${hex.replace('#', '')}.stl`,
      })),
      files: {
        threemf: `${jobId}_multicolor.3mf`,
        stls: colors.map((hex, i) => `color_${i + 1}_${hex.replace('#', '')}.stl`),
      },
      instructions: {
        es: `Este archivo contiene un 3MF multi-color (compatible con Bambu Studio) y ${colors.length} STLs (uno por color).\n\nPara usar:\n- Abre el 3MF en Bambu Studio o un slicer compatible con 3MF.\n- Si necesitas ajustar colores manualmente, importa los STLs y asigna filamentos por pieza.`,
      },
    }

    zip.file('colors.json', JSON.stringify(colorConfig, null, 2))
    zip.file('README.txt', colorConfig.instructions.es)

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })
    fs.writeFileSync(zipPath, zipBuffer)

    logger.info(`[${jobId}] 3MF file regenerated successfully`)

    // Update job in database
    await prisma.job.update({
      where: { id: jobId },
      data: {
        dominantColors: colors,
        updatedAt: new Date(),
      },
    })

    logger.info(`[${jobId}] Job updated with new colors`)
  } catch (error) {
    logger.error(`[${jobId}] Error regenerating 3MF:`, error)
    
    // Update job status to reflect error
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        errorMessage: `Error regenerating 3MF: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
    }).catch(err => logger.error(`Failed to update job status: ${err}`))

    throw error
  }
}
