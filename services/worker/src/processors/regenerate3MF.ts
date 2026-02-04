import path from 'path'
import fs from 'fs'
import { logger } from '../utils/logger'
import { PrismaClient } from '@prisma/client'
import { generate3MFFromColorSTLs } from './colorGenerator'

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

    // Build color STL objects - we'll create colored versions of the same STL
    const colorSTLs = colors.map((color) => ({
      color,
      stlPath, // Same STL, different colors
    }))

    // Regenerate the 3MF file
    await generate3MFFromColorSTLs(colorSTLs, jobId, STORAGE_PATH)

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
