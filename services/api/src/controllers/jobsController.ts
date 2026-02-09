import { Request, Response, NextFunction } from 'express'
import { PrismaClient } from '@prisma/client'
import { Queue } from 'bullmq'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import fs from 'fs'
import { logger } from '../utils/logger'

const prisma = new PrismaClient()
const jobQueue = new Queue('image-processing', {
  connection: {
    host: process.env.REDIS_URL?.includes('://') 
      ? new URL(process.env.REDIS_URL).hostname 
      : 'redis',
    port: 6379,
  }
})

export const createJob = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' })
    }

    // Parse parameters
    const params = req.body.params ? JSON.parse(req.body.params) : {}
    
    console.log('Received params:', params) // DEBUG
    
    const {
      width = 50,
      height = 50,
      thickness = 3,
      ringEnabled = true,
      ringDiameter = 5,
      ringThickness = 2,
      ringPosition = 'top',
      threshold = 180,
      maxColors = 4,
      borderEnabled = false,
      borderThickness = 2,
      reliefEnabled = false,
    } = params

    // Create job in database
    const job = await prisma.job.create({
      data: {
        originalFilename: req.file.originalname,
        fileSize: req.file.size,
        widthMm: width,
        heightMm: height,
        thicknessMm: thickness,
        ringEnabled,
        ringDiameterMm: ringDiameter,
        ringThicknessMm: ringThickness,
        ringPosition,
        inputPath: req.file.path,
        status: 'PENDING',
        progress: 0,
      },
    })

    // Add to queue
    await jobQueue.add('process-image', {
      jobId: job.id,
      filePath: req.file.path,
      params: {
        width,
        height,
        thickness,
        ringEnabled,
        ringDiameter,
        ringThickness,
        ringPosition,
        threshold,
        maxColors,
        borderEnabled,
        borderThickness,
        reliefEnabled,
      },
    })

    logger.info(`Job created: ${job.id}`)

    res.status(201).json({
      id: job.id,
      status: job.status,
      progress: job.progress,
      createdAt: job.createdAt,
    })
  } catch (error) {
    logger.error('Error creating job:', error)
    next(error)
  }
}

export const getJob = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id

    const job = await prisma.job.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        progress: true,
        errorMessage: true,
        stlPath: true,
        svgPath: true,
        processedImagePath: true,
        dominantColors: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
      },
    })

    if (!job) {
      return res.status(404).json({ error: 'Job not found' })
    }

    res.json(job)
  } catch (error) {
    logger.error('Error getting job:', error)
    next(error)
  }
}

export const downloadJob = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id

    logger.info(`Download requested for job: ${id}`)

    const job = await prisma.job.findUnique({
      where: { id },
      select: {
        status: true,
        stlPath: true,
        originalFilename: true,
      },
    })

    if (!job) {
      logger.error(`Job not found: ${id}`)
      return res.status(404).json({ error: 'Job not found' })
    }

    if (job.status !== 'COMPLETED') {
      logger.error(`Job not completed yet: ${id}, status: ${job.status}`)
      return res.status(400).json({ error: `Job not completed yet. Status: ${job.status}` })
    }

    if (!job.stlPath) {
      logger.error(`No STL path for job: ${id}`)
      return res.status(404).json({ error: 'STL file not generated' })
    }

    logger.info(`Checking STL file: ${job.stlPath}`)
    
    if (!fs.existsSync(job.stlPath)) {
      logger.error(`STL file not found on disk: ${job.stlPath}`)
      return res.status(404).json({ error: `STL file not found: ${job.stlPath}` })
    }

    const originalName = Array.isArray(job.originalFilename) ? job.originalFilename[0] : job.originalFilename
    const filename = path.basename(originalName, path.extname(originalName))
    
    logger.info(`Downloading: ${job.stlPath} as ${filename}.stl`)
    
    // Set headers explicitly for binary download
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.stl"`)
    res.setHeader('Content-Length', fs.statSync(job.stlPath).size)
    
    // Stream the file
    const fileStream = fs.createReadStream(job.stlPath)
    fileStream.pipe(res)
    
    fileStream.on('error', (error) => {
      logger.error(`Error streaming file: ${error}`)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error downloading file' })
      }
    })
  } catch (error) {
    logger.error('Error downloading job:', error)
    next(error)
  }
}
export const downloadJobColors = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    logger.info(`Download colors requested for job: ${id}`)

    const job = await prisma.job.findUnique({
      where: { id },
    })

    if (!job) {
      return res.status(404).json({ error: 'Job not found' })
    }

    if (job.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Job not completed yet' })
    }

    if (!job.stlPath) {
      return res.status(404).json({ error: 'STL file not generated' })
    }

    // Ruta del archivo de colores (mismo nombre que el STL pero con _colors.json)
    const colorPath = job.stlPath.replace('.stl', '_colors.json')
    
    if (!fs.existsSync(colorPath)) {
      logger.error(`Color file not found: ${colorPath}`)
      return res.status(404).json({ error: 'Color configuration file not found' })
    }

    logger.info(`Downloading colors: ${colorPath}`)
    
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', `attachment; filename="colors_${id}.json"`)
    
    const fileStream = fs.createReadStream(colorPath)
    fileStream.pipe(res)
    
    fileStream.on('error', (error) => {
      logger.error(`Error streaming color file: ${error}`)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error downloading color file' })
      }
    })
  } catch (error) {
    logger.error('Error downloading colors:', error)
    next(error)
  }
}

export const download3MF = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    logger.info(`Download 3MF requested for job: ${id}`)

    const job = await prisma.job.findUnique({
      where: { id },
    })

    if (!job) {
      return res.status(404).json({ error: 'Job not found' })
    }

    if (job.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Job not completed yet' })
    }

    if (!job.stlPath) {
      return res.status(404).json({ error: 'STL file not generated' })
    }

    // Ruta del archivo 3MF
    const storagePath = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../../storage')
    const mfPath = path.join(storagePath, 'processed', `${id}.3mf`)
    
    if (!fs.existsSync(mfPath)) {
      logger.error(`3MF file not found: ${mfPath}`)
      return res.status(404).json({ error: '3MF file not available. Download STL instead.' })
    }

    const originalName = Array.isArray(job.originalFilename) ? job.originalFilename[0] : job.originalFilename
    const filename = path.basename(originalName, path.extname(originalName))
    
    logger.info(`Downloading 3MF: ${mfPath} as ${filename}.3mf`)
    
    res.setHeader('Content-Type', 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.3mf"`)
    res.setHeader('Content-Length', fs.statSync(mfPath).size)
    
    const fileStream = fs.createReadStream(mfPath)
    fileStream.pipe(res)
    
    fileStream.on('error', (error) => {
      logger.error(`Error streaming 3MF file: ${error}`)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error downloading 3MF file' })
      }
    })
  } catch (error) {
    logger.error('Error downloading 3MF:', error)
    next(error)
  }
}

export const downloadMulticolorZip = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id

    logger.info(`Multi-color ZIP download requested for job: ${id}`)

    const job = await prisma.job.findUnique({
      where: { id },
      select: {
        status: true,
        stlPath: true,
        originalFilename: true,
      },
    })

    if (!job) {
      return res.status(404).json({ error: 'Job not found' })
    }

    if (job.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Job not completed yet' })
    }

    if (!job.stlPath) {
      return res.status(404).json({ error: 'STL files not generated' })
    }

    // Path to the multi-color ZIP file
    const zipPath = path.join(path.dirname(job.stlPath), `${id}_multicolor.zip`)
    
    if (!fs.existsSync(zipPath)) {
      logger.error(`Multi-color ZIP not found: ${zipPath}`)
      return res.status(404).json({ error: 'Multi-color ZIP file not available' })
    }

    const originalName = Array.isArray(job.originalFilename) ? job.originalFilename[0] : job.originalFilename
    const filename = path.basename(originalName, path.extname(originalName))
    
    logger.info(`Downloading multi-color ZIP: ${zipPath} as ${filename}_multicolor.zip`)
    
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}_multicolor.zip"`)
    res.setHeader('Content-Length', fs.statSync(zipPath).size)
    
    const fileStream = fs.createReadStream(zipPath)
    fileStream.pipe(res)
    
    fileStream.on('error', (error) => {
      logger.error(`Error streaming multi-color ZIP: ${error}`)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error downloading multi-color ZIP' })
      }
    })
  } catch (error) {
    logger.error('Error downloading multi-color ZIP:', error)
    next(error)
  }
}

/**
 * Get dominant colors for a job
 */
export const getJobColors = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id

    const job = await prisma.job.findUnique({
      where: { id },
      select: {
        id: true,
        dominantColors: true,
        status: true
      }
    })

    if (!job) {
      return res.status(404).json({ error: 'Job not found' })
    }

    res.json({
      jobId: job.id,
      colors: job.dominantColors || [],
      status: job.status
    })
  } catch (error) {
    logger.error('Error getting job colors:', error)
    next(error)
  }
}

/**
 * Update dominant colors for a job and regenerate 3MF
 */
export const updateJobColors = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    const { colors } = req.body

    if (!Array.isArray(colors) || colors.length === 0) {
      return res.status(400).json({ error: 'Colors array is required' })
    }

    // Validate hex colors
    const hexPattern = /^#[0-9A-Fa-f]{6}$/
    for (const color of colors) {
      if (!hexPattern.test(color)) {
        return res.status(400).json({ error: `Invalid hex color: ${color}` })
      }
    }

    const job = await prisma.job.findUnique({
      where: { id }
    })

    if (!job) {
      return res.status(404).json({ error: 'Job not found' })
    }

    if (job.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Job must be completed to update colors' })
    }

    // Update colors in database
    await prisma.job.update({
      where: { id },
      data: { dominantColors: colors }
    })

    // Add regeneration task to queue
    logger.info(`[${id}] Adding 3MF regeneration task to queue...`)
    await jobQueue.add('regenerate-3mf', {
      jobId: id,
      colors: colors,
      stlPath: job.stlPath,
    })

    res.json({
      message: 'Colors updated and 3MF regeneration queued',
      jobId: id,
      colors
    })
  } catch (error) {
    logger.error('Error updating job colors:', error)
    next(error)
  }
}

/**
 * Download individual color STL for preview
 */
export const downloadColorSTL = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    const colorIndexParam = Array.isArray(req.params.colorIndex) ? req.params.colorIndex[0] : req.params.colorIndex
    const index = parseInt(colorIndexParam, 10)

    logger.info(`Download color STL ${index} requested for job: ${id}`)

    const job = await prisma.job.findUnique({
      where: { id },
      select: {
        status: true,
        dominantColors: true,
        originalFilename: true,
      },
    })

    if (!job) {
      return res.status(404).json({ error: 'Job not found' })
    }

    if (job.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Job not completed yet' })
    }

    if (!job.dominantColors || index < 0 || index >= job.dominantColors.length) {
      return res.status(404).json({ error: `Color ${index} not found` })
    }

    // Construct the color STL file path
    const color = job.dominantColors[index]
    const colorSTLPath = path.join(
      path.dirname(job.originalFilename || ''),
      `${id}_color${index}.stl`
    )

    // Check if file exists - if not, try alternative path
    let stlPath = colorSTLPath
    const storagePath = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../../storage')
    const altPath = path.join(storagePath, 'processed', `${id}_color${index}.stl`)
    
    if (!fs.existsSync(stlPath) && fs.existsSync(altPath)) {
      stlPath = altPath
    }

    if (!fs.existsSync(stlPath)) {
      logger.error(`Color STL not found: ${stlPath}`)
      return res.status(404).json({ error: `Color ${index} STL file not found` })
    }

    const originalName = Array.isArray(job.originalFilename) ? job.originalFilename[0] : job.originalFilename
    const filename = path.basename(originalName, path.extname(originalName))
    
    logger.info(`Downloading color STL: ${stlPath}`)
    
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}_color${index}.stl"`)
    res.setHeader('Content-Length', fs.statSync(stlPath).size)
    
    const fileStream = fs.createReadStream(stlPath)
    fileStream.pipe(res)
    
    fileStream.on('error', (error) => {
      logger.error(`Error streaming color STL: ${error}`)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error downloading color STL' })
      }
    })
  } catch (error) {
    logger.error('Error downloading color STL:', error)
    next(error)
  }
}
