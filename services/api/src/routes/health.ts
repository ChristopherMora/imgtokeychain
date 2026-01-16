import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { Queue } from 'bullmq'
import Redis from 'ioredis'

const router = Router()
const prisma = new PrismaClient()

// Redis connection for health check
const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379', {
  maxRetriesPerRequest: null,
})

// Jobs queue
const jobQueue = new Queue('image-processing', {
  connection: {
    host: process.env.REDIS_URL?.includes('://') 
      ? new URL(process.env.REDIS_URL).hostname 
      : 'redis',
    port: 6379,
  }
})

router.get('/', async (req, res) => {
  try {
    // Check database
    await prisma.$queryRaw`SELECT 1`
    
    // Check Redis
    await redis.ping()
    
    // Check queue
    const queueHealth = await jobQueue.getJobCounts()

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        redis: 'connected',
        queue: {
          active: queueHealth.active,
          waiting: queueHealth.waiting,
          completed: queueHealth.completed,
          failed: queueHealth.failed,
        }
      }
    })
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

export default router
