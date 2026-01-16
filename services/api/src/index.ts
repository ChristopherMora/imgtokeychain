import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import dotenv from 'dotenv'
import jobsRouter from './routes/jobs'
import healthRouter from './routes/health'
import { errorHandler } from './middleware/errorHandler'
import { logger } from './utils/logger'
import { setupStorage } from './utils/storage'

dotenv.config()

const app = express()
const PORT = process.env.API_PORT || 4000

// Middleware
app.use(helmet())
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
}))
app.use(morgan('combined', {
  stream: { write: (message) => logger.info(message.trim()) }
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Setup storage directories
setupStorage()

// Routes
app.use('/health', healthRouter)
app.use('/api/jobs', jobsRouter)

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// Error handler
app.use(errorHandler)

// Start server
app.listen(PORT, () => {
  logger.info(`🚀 API Server running on port ${PORT}`)
  logger.info(`📝 Environment: ${process.env.NODE_ENV}`)
  logger.info(`🔗 CORS origin: ${process.env.CORS_ORIGIN}`)
})

export default app
