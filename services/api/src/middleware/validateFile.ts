import { Request, Response, NextFunction } from 'express'
import fs from 'fs'

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_MAGIC = [0xff, 0xd8, 0xff]

async function readMagicBytes(filePath: string, count: number): Promise<Buffer> {
  const fileHandle = await fs.promises.open(filePath, 'r')
  const buf = Buffer.alloc(count)
  await fileHandle.read(buf, 0, count, 0)
  await fileHandle.close()
  return buf
}

function hasValidMagicBytes(buf: Buffer, mimetype: string): boolean {
  if (mimetype === 'image/png' || mimetype === 'image/PNG') {
    return PNG_MAGIC.every((byte, i) => buf[i] === byte)
  }
  if (mimetype === 'image/jpeg' || mimetype === 'image/jpg') {
    return JPEG_MAGIC.every((byte, i) => buf[i] === byte)
  }
  return false
}

export const validateFile = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' })
  }

  // Validate declared MIME type
  const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg']
  if (!allowedTypes.includes(req.file.mimetype)) {
    await fs.promises.unlink(req.file.path).catch(() => {})
    return res.status(400).json({ error: 'Only PNG and JPG files are allowed' })
  }

  // Validate file size
  const maxSize = parseInt(process.env.MAX_FILE_SIZE || '5242880') // 5MB
  if (req.file.size > maxSize) {
    await fs.promises.unlink(req.file.path).catch(() => {})
    return res.status(400).json({ error: `File size must be less than ${maxSize / 1024 / 1024}MB` })
  }

  // Validate magic bytes to prevent MIME type spoofing
  try {
    const buf = await readMagicBytes(req.file.path, 8)
    if (!hasValidMagicBytes(buf, req.file.mimetype)) {
      await fs.promises.unlink(req.file.path).catch(() => {})
      return res.status(400).json({ error: 'File content does not match declared type' })
    }
  } catch {
    await fs.promises.unlink(req.file.path).catch(() => {})
    return res.status(400).json({ error: 'Could not validate file' })
  }

  next()
}
