import fs from 'fs'
import path from 'path'
import { logger } from './logger'

const STORAGE_PATH = process.env.STORAGE_PATH || '/app/storage'

export const setupStorage = () => {
  const directories = [
    path.join(STORAGE_PATH, 'uploads'),
    path.join(STORAGE_PATH, 'processed'),
    path.join(STORAGE_PATH, 'temp'),
  ]

  directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
      logger.info(`Created directory: ${dir}`)
    }
  })
}

export const getStoragePath = (type: 'uploads' | 'processed' | 'temp', filename: string) => {
  return path.join(STORAGE_PATH, type, filename)
}
