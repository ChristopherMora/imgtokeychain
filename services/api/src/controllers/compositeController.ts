import { Request, Response } from 'express'
import path from 'path'
import fs from 'fs/promises'

const STORAGE_PATH = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../../storage')

export const getComposite = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    
    const compositePath = path.join(STORAGE_PATH, 'processed', `${id}_composite.png`)
    
    // Verificar si existe
    try {
      await fs.access(compositePath)
    } catch {
      return res.status(404).json({ error: 'Composite image not found' })
    }
    
    // Servir la imagen
    res.sendFile(compositePath)
    
  } catch (error) {
    console.error('Error serving composite:', error)
    res.status(500).json({ error: 'Failed to serve composite image' })
  }
}
