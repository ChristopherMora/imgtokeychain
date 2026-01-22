import { Worker } from 'bullmq'
import dotenv from 'dotenv'
import { logger } from './utils/logger'
import { processImageJob } from './processors/imageProcessor'
import { regenerate3MFJob } from './processors/regenerate3MF'

dotenv.config()

// Worker for image processing
const imageWorker = new Worker(
  'image-processing',
  async (job) => {
    logger.info(`Processing job ${job.id}`)
    
    try {
      await processImageJob(job.data)
      logger.info(`Job ${job.id} completed successfully`)
    } catch (error) {
      logger.error(`Job ${job.id} failed:`, error)
      throw error
    }
  },
  {
    connection: {
      host: process.env.REDIS_URL?.includes('://') 
        ? new URL(process.env.REDIS_URL).hostname 
        : 'redis',
      port: 6379,
    },
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || '2'),
    limiter: {
      max: 10,
      duration: 1000,
    },
  }
)

// Worker for 3MF regeneration
const regenerate3MFWorker = new Worker(
  'regenerate-3mf',
  async (job) => {
    logger.info(`Regenerating 3MF for job ${job.data.jobId}`)
    
    try {
      await regenerate3MFJob(job.data)
      logger.info(`3MF regeneration for job ${job.data.jobId} completed successfully`)
    } catch (error) {
      logger.error(`3MF regeneration for job ${job.data.jobId} failed:`, error)
      throw error
    }
  },
  {
    connection: {
      host: process.env.REDIS_URL?.includes('://') 
        ? new URL(process.env.REDIS_URL).hostname 
        : 'redis',
      port: 6379,
    },
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || '2'),
    limiter: {
      max: 10,
      duration: 1000,
    },
  }
)

imageWorker.on('completed', (job) => {
  logger.info(`Job ${job.id} has completed`)
})

imageWorker.on('failed', (job, err) => {
  logger.error(`Job ${job?.id} has failed with error: ${err.message}`)
})

regenerate3MFWorker.on('completed', (job) => {
  logger.info(`3MF regeneration for job ${job.data.jobId} has completed`)
})

regenerate3MFWorker.on('failed', (job, err) => {
  logger.error(`3MF regeneration for job ${job?.data.jobId} has failed with error: ${err.message}`)
})

imageWorker.on('error', (err) => {
  logger.error('Image worker error:', err)
})

regenerate3MFWorker.on('error', (err) => {
  logger.error('3MF worker error:', err)
})

logger.info('🔄 Workers started and listening for jobs...')
logger.info(`📊 Concurrency: ${process.env.WORKER_CONCURRENCY || 2}`)

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing workers...')
  await imageWorker.close()
  await regenerate3MFWorker.close()
  process.exit(0)
})

process.on('SIGINT', async () => {
  logger.info('SIGINT received, closing workers...')
  await imageWorker.close()
  await regenerate3MFWorker.close()
  process.exit(0)
})

