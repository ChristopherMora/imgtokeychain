import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import { createJob, getJob, downloadJob, downloadJobColors, download3MF, downloadMulticolorZip, getJobColors, updateJobColors, downloadColorSTL } from '../controllers/jobsController'
import { getComposite } from '../controllers/compositeController'
import { validateFile } from '../middleware/validateFile'
import { rateLimiter } from '../middleware/rateLimiter'

const router = Router()

// Multer configuration
const STORAGE_PATH = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../../storage')
const upload = multer({
  dest: path.join(STORAGE_PATH, 'uploads'),
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
router.get('/:id/colors', getJobColors)
router.get('/:id/color/:colorIndex', downloadColorSTL)
router.get('/:id/composite', getComposite)
router.put('/:id/colors', updateJobColors)
router.get('/:id/download', downloadJob)
router.get('/:id/download-colors', downloadJobColors)
router.get('/:id/download-3mf', download3MF)
router.get('/:id/download-multicolor', downloadMulticolorZip)

export default router
