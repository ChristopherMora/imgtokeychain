import { Worker } from 'bullmq'
import dotenv from 'dotenv'
import { logger } from './utils/logger'
import { processImageJob } from './processors/imageProcessor'

dotenv.config()

const worker = new Worker(
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

worker.on('completed', (job) => {
  logger.info(`Job ${job.id} has completed`)
})

worker.on('failed', (job, err) => {
  logger.error(`Job ${job?.id} has failed with error: ${err.message}`)
})

worker.on('error', (err) => {
  logger.error('Worker error:', err)
})

logger.info('🔄 Worker started and listening for jobs...')
logger.info(`📊 Concurrency: ${process.env.WORKER_CONCURRENCY || 2}`)

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing worker...')
  await worker.close()
  process.exit(0)
})

process.on('SIGINT', async () => {
  logger.info('SIGINT received, closing worker...')
  await worker.close()
  process.exit(0)
})
