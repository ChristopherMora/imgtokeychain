import { Router } from 'express'
import multer from 'multer'
import { createJob, getJob, downloadJob } from '../controllers/jobsController'
import { validateFile } from '../middleware/validateFile'
import { rateLimiter } from '../middleware/rateLimiter'

const router = Router()

// Multer configuration
const upload = multer({
  dest: '/app/storage/uploads',
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '5242880'), // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.match(/^image\/(png|jpeg|jpg)$/)) {
      cb(null, true)
    } else {
      cb(new Error('Only PNG and JPG files are allowed'))
    }
  },
})

// Routes
router.post('/', rateLimiter, upload.single('file'), validateFile, createJob)
router.get('/:id', getJob)
router.get('/:id/download', downloadJob)

export default router
