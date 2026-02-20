import fs from 'fs/promises'
import path from 'path'
import sharp from 'sharp'
import { segmentByColorsWithSilhouette } from './src/processors/colorSegmentation'

function parsePgm(buffer: Buffer): { width: number; height: number; data: Buffer } {
  let offset = 0
  const nextLine = () => {
    const end = buffer.indexOf(0x0a, offset)
    const line = buffer.toString('ascii', offset, end).trim()
    offset = end + 1
    return line
  }
  const magic = nextLine()
  if (!magic.startsWith('P5')) throw new Error('invalid pgm')
  let dims = nextLine()
  while (dims.startsWith('#') || dims === '') dims = nextLine()
  const [width, height] = dims.split(/\s+/).map(Number)
  let max = nextLine()
  while (max.startsWith('#') || max === '') max = nextLine()
  return { width, height, data: buffer.slice(offset) }
}

async function readPgm(file: string) {
  return parsePgm(await fs.readFile(file))
}

async function main() {
  const base = '5af6ee3c-52d7-4b70-aeca-35b1f97e65f9'
  const storagePath = '/home/mora/imgtokeychain/storage'
  const cleanPath = path.join(storagePath, 'processed', `${base}_clean.png`)
  const silPath = path.join(storagePath, 'processed', `${base}_silhouette.pgm`)
  const sil = await readPgm(silPath)

  const jobId = `debug_${Date.now()}`
  const masks = await segmentByColorsWithSilhouette(
    cleanPath,
    ['#40c0e0', '#e090c0', '#101010'],
    sil.data,
    sil.width,
    sil.height,
    jobId,
    storagePath,
  )

  console.log('jobId', jobId)
  console.log('masks', masks.map(m => m.color))

  for (let i = 0; i < masks.length; i++) {
    const p = masks[i].maskPath
    const pgm = await readPgm(p)
    let white = 0
    for (let j = 0; j < pgm.data.length; j++) if (pgm.data[j] > 127) white++
    console.log(i, masks[i].color, 'pixels', white)
    const pngPath = p.replace('.pgm', '_dbg.png')
    await sharp(pgm.data, { raw: { width: pgm.width, height: pgm.height, channels: 1 } }).png().toFile(pngPath)
  }

  const labelPath = path.join(storagePath, 'processed', `${jobId}_labels.pgm`)
  const label = await readPgm(labelPath)
  const resized = await sharp(cleanPath).resize(label.width, label.height, { fit: 'fill', kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const ch = resized.info.channels
  let pinkOnDarkish = 0
  let pinkTotal = 0
  for (let i = 0; i < label.data.length; i++) {
    const lab = label.data[i]
    if (lab !== 2) continue
    pinkTotal++
    const idx = i * ch
    const r = resized.data[idx]
    const g = resized.data[idx + 1]
    const b = resized.data[idx + 2]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const sat = max - min
    if (lum < 120 || (sat < 35 && lum < 150)) pinkOnDarkish++
  }
  console.log({ pinkTotal, pinkOnDarkish, pinkOnDarkishPct: ((pinkOnDarkish / Math.max(1, pinkTotal)) * 100).toFixed(2) })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
