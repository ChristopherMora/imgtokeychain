import { Request, Response, NextFunction } from 'express'

export const validateFile = (req: Request, res: Response, next: NextFunction) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' })
  }

  // Validate file type
  const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg']
  if (!allowedTypes.includes(req.file.mimetype)) {
    return res.status(400).json({ error: 'Only PNG and JPG files are allowed' })
  }

  // Validate file size
  const maxSize = parseInt(process.env.MAX_FILE_SIZE || '5242880') // 5MB
  if (req.file.size > maxSize) {
    return res.status(400).json({ error: `File size must be less than ${maxSize / 1024 / 1024}MB` })
  }

  next()
}
