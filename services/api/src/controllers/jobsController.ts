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
    
    const {
      width = 50,
      height = 50,
      thickness = 3,
      ringEnabled = true,
      ringDiameter = 5,
      ringThickness = 2,
      ringPosition = 'top',
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
