import { PrismaClient } from '@prisma/client'
import path from 'path'
import fs from 'fs/promises'
import sharp from 'sharp'
import { logger } from '../utils/logger'
import { preprocessImage, extractDominantColors } from './imagePreprocessor'
import { imageToSvg } from './svgGenerator'
import { svgToStl } from './stlGenerator'
import { addRing } from './ringGenerator'
import { segmentByColorsWithSilhouette } from './colorSegmentation'
import { generate3MFFromColorSTLs } from './colorGenerator'
import { removeBackground, extractColorsFromForeground } from './backgroundRemover'
import { generateCompositeImage } from './compositeGenerator'
import { dilateMask, removeSmallComponents } from './maskEnhancer'

const prisma = new PrismaClient()

const STORAGE_PATH = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../../storage')
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/

interface JobData {
  jobId: string
  filePath: string
  params: {
    width: number
    height: number
    thickness: number
    ringEnabled: boolean
    ringDiameter: number
    ringThickness: number
    ringPosition: string
    threshold?: number
    maxColors?: number
    removeBackgroundEnabled?: boolean
    borderEnabled?: boolean
    borderThickness?: number
    reliefEnabled?: boolean
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex)
  if (!match) return null
  return {
    r: parseInt(match[1].slice(0, 2), 16),
    g: parseInt(match[1].slice(2, 4), 16),
    b: parseInt(match[1].slice(4, 6), 16),
  }
}

function colorDistance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function normalizeHex(hex: string): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex.toLowerCase()
  return `#${rgb.r.toString(16).padStart(2, '0')}${rgb.g.toString(16).padStart(2, '0')}${rgb.b.toString(16).padStart(2, '0')}`
}

function isDarkHexColor(hex: string): boolean {
  const rgb = hexToRgb(hex)
  if (!rgb) return false
  const luminance = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b
  return luminance < 72
}

function dedupeHexPalette(colors: string[], minDistance = 14): string[] {
  const output: string[] = []
  for (const color of colors) {
    const normalized = normalizeHex(color)
    const rgb = hexToRgb(normalized)
    if (!rgb) continue
    const duplicate = output.some(existing => {
      const existingRgb = hexToRgb(existing)
      if (!existingRgb) return false
      return colorDistance(existingRgb, rgb) < minDistance
    })
    if (!duplicate) output.push(normalized)
  }
  return output
}

async function detectCornerBackgroundColorHex(
  inputPath: string,
  width: number,
  height: number
): Promise<string | null> {
  const { data, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const channels = info.channels
  const sampleSize = Math.max(4, Math.min(32, Math.round(Math.min(width, height) * 0.06)))
  const corners = [
    { x0: 0, y0: 0 },
    { x0: Math.max(0, width - sampleSize), y0: 0 },
    { x0: 0, y0: Math.max(0, height - sampleSize) },
    { x0: Math.max(0, width - sampleSize), y0: Math.max(0, height - sampleSize) },
  ]

  const cornerMeans: { r: number; g: number; b: number }[] = []
  const cornerPixels: { r: number; g: number; b: number }[] = []
  for (const corner of corners) {
    let rAcc = 0
    let gAcc = 0
    let bAcc = 0
    let count = 0
    for (let y = corner.y0; y < corner.y0 + sampleSize && y < height; y++) {
      for (let x = corner.x0; x < corner.x0 + sampleSize && x < width; x++) {
        const idx = (y * width + x) * channels
        const alpha = data[idx + 3]
        if (alpha < 16) continue
        const r = data[idx]
        const g = data[idx + 1]
        const b = data[idx + 2]
        rAcc += r
        gAcc += g
        bAcc += b
        cornerPixels.push({ r, g, b })
        count++
      }
    }
    if (count === 0) continue
    cornerMeans.push({
      r: Math.round(rAcc / count),
      g: Math.round(gAcc / count),
      b: Math.round(bAcc / count),
    })
  }

  if (cornerMeans.length === 0 || cornerPixels.length === 0) return null

  const avg = cornerMeans.reduce(
    (acc, c) => ({ r: acc.r + c.r, g: acc.g + c.g, b: acc.b + c.b }),
    { r: 0, g: 0, b: 0 }
  )
  const mean = {
    r: Math.round(avg.r / cornerMeans.length),
    g: Math.round(avg.g / cornerMeans.length),
    b: Math.round(avg.b / cornerMeans.length),
  }

  let maxSpread = 0
  for (const c of cornerMeans) {
    maxSpread = Math.max(maxSpread, colorDistance(c, mean))
  }
  if (maxSpread <= 24) {
    return normalizeHex(
      `#${mean.r.toString(16).padStart(2, '0')}${mean.g.toString(16).padStart(2, '0')}${mean.b.toString(16).padStart(2, '0')}`
    )
  }

  const bucketStep = 12
  const toBucket = (value: number) => Math.max(0, Math.min(255, Math.round(value / bucketStep) * bucketStep))
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>()

  for (const pixel of cornerPixels) {
    const br = toBucket(pixel.r)
    const bg = toBucket(pixel.g)
    const bb = toBucket(pixel.b)
    const key = `${br},${bg},${bb}`
    const existing = buckets.get(key)
    if (existing) {
      existing.count++
      existing.r += pixel.r
      existing.g += pixel.g
      existing.b += pixel.b
    } else {
      buckets.set(key, { count: 1, r: pixel.r, g: pixel.g, b: pixel.b })
    }
  }

  let bestKey: string | null = null
  let bestCount = 0
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.count > bestCount) {
      bestKey = key
      bestCount = bucket.count
    }
  }
  if (!bestKey) return null

  const bestBucket = buckets.get(bestKey)
  if (!bestBucket) return null

  const dominant = {
    r: Math.round(bestBucket.r / bestBucket.count),
    g: Math.round(bestBucket.g / bestBucket.count),
    b: Math.round(bestBucket.b / bestBucket.count),
  }

  return normalizeHex(
    `#${dominant.r.toString(16).padStart(2, '0')}${dominant.g.toString(16).padStart(2, '0')}${dominant.b.toString(16).padStart(2, '0')}`
  )
}

const computeBackgroundTolerance = (
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  backgroundColor: { r: number; g: number; b: number },
  threshold: number
): number => {
  const distances: number[] = []
  const step = Math.max(1, Math.floor(Math.min(width, height) / 100))

  const colorDistanceAt = (idx: number) => {
    const r = data[idx]
    const g = data[idx + 1]
    const b = data[idx + 2]
    return Math.sqrt(
      Math.pow(r - backgroundColor.r, 2) +
      Math.pow(g - backgroundColor.g, 2) +
      Math.pow(b - backgroundColor.b, 2)
    )
  }

  for (let x = 0; x < width; x += step) {
    distances.push(colorDistanceAt((0 * width + x) * channels))
    distances.push(colorDistanceAt(((height - 1) * width + x) * channels))
  }
  for (let y = 0; y < height; y += step) {
    distances.push(colorDistanceAt((y * width + 0) * channels))
    distances.push(colorDistanceAt((y * width + (width - 1)) * channels))
  }

  distances.sort((a, b) => a - b)
  const p90 = distances[Math.floor(distances.length * 0.9)] || 0
  let baseTolerance = Math.round(p90 * 1.1 + 4)

  const normalized = Math.min(1, Math.max(0, (threshold - 100) / 120))
  const sliderFactor = 0.85 + normalized * 0.4
  baseTolerance = Math.round(baseTolerance * sliderFactor)

  return Math.min(60, Math.max(10, baseTolerance))
}

const prepareImageWithoutBackgroundRemoval = async (
  filePath: string,
  jobId: string,
  storagePath: string,
  threshold: number = 180
): Promise<{
  cleanImagePath: string
  silhouetteMaskPath: string
  width: number
  height: number
  usedAlphaSilhouette: boolean
  backgroundMask?: Buffer
  backgroundColor?: string
}> => {
  const image = sharp(filePath)
  const metadata = await image.metadata()
  const width = metadata.width ?? 500
  const height = metadata.height ?? 500
  const pixelCount = width * height

  const { data } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  let transparentPixels = 0
  for (let i = 0; i < pixelCount; i++) {
    if (data[i * 4 + 3] < 250) transparentPixels++
  }
  const hasUsefulAlpha = transparentPixels / pixelCount > 0.001

  let silhouetteMask = Buffer.alloc(pixelCount, hasUsefulAlpha ? 0 : 255)
  let usedCornerBackground = false
  let backgroundMask: Buffer | null = null
  let backgroundColor: string | null = null
  if (hasUsefulAlpha) {
    for (let i = 0; i < pixelCount; i++) {
      silhouetteMask[i] = data[i * 4 + 3] >= 128 ? 255 : 0
    }
  } else {
    const sampleSize = Math.max(4, Math.min(32, Math.round(Math.min(width, height) * 0.06)))
    const corners = [
      { x0: 0, y0: 0 },
      { x0: Math.max(0, width - sampleSize), y0: 0 },
      { x0: 0, y0: Math.max(0, height - sampleSize) },
      { x0: Math.max(0, width - sampleSize), y0: Math.max(0, height - sampleSize) },
    ]
    const cornerMeans: { r: number; g: number; b: number }[] = []
    for (const corner of corners) {
      let rAcc = 0
      let gAcc = 0
      let bAcc = 0
      let count = 0
      for (let y = corner.y0; y < corner.y0 + sampleSize && y < height; y++) {
        for (let x = corner.x0; x < corner.x0 + sampleSize && x < width; x++) {
          const idx = (y * width + x) * 4
          rAcc += data[idx]
          gAcc += data[idx + 1]
          bAcc += data[idx + 2]
          count++
        }
      }
      if (count === 0) continue
      cornerMeans.push({
        r: Math.round(rAcc / count),
        g: Math.round(gAcc / count),
        b: Math.round(bAcc / count),
      })
    }

    if (cornerMeans.length > 0) {
      const avg = cornerMeans.reduce(
        (acc, c) => ({ r: acc.r + c.r, g: acc.g + c.g, b: acc.b + c.b }),
        { r: 0, g: 0, b: 0 }
      )
      const mean = {
        r: Math.round(avg.r / cornerMeans.length),
        g: Math.round(avg.g / cornerMeans.length),
        b: Math.round(avg.b / cornerMeans.length),
      }

      let maxSpread = 0
      for (const c of cornerMeans) {
        maxSpread = Math.max(maxSpread, colorDistance(c, mean))
      }

      const lightness = (Math.max(mean.r, mean.g, mean.b) + Math.min(mean.r, mean.g, mean.b)) / 510
      const maxDelta = Math.max(
        Math.abs(mean.r - mean.g),
        Math.abs(mean.r - mean.b),
        Math.abs(mean.g - mean.b)
      )
      const looksNeutralLight = lightness > 0.78 && maxDelta < 28

      if (maxSpread <= 24 && looksNeutralLight) {
        backgroundColor = normalizeHex(
          `#${mean.r.toString(16).padStart(2, '0')}${mean.g.toString(16).padStart(2, '0')}${mean.b.toString(16).padStart(2, '0')}`
        )
        const tolerance = computeBackgroundTolerance(data, width, height, 4, mean, threshold)
        const background = new Uint8Array(pixelCount)
        const queue = new Int32Array(pixelCount)
        let qh = 0
        let qt = 0

        const colorDistanceAt = (pixelIndex: number) => {
          const idx = pixelIndex * 4
          const dr = data[idx] - mean.r
          const dg = data[idx + 1] - mean.g
          const db = data[idx + 2] - mean.b
          return Math.sqrt(dr * dr + dg * dg + db * db)
        }

        const enqueue = (x: number, y: number) => {
          const idx = y * width + x
          if (background[idx] === 1) return
          if (colorDistanceAt(idx) > tolerance) return
          background[idx] = 1
          queue[qt++] = idx
        }

        enqueue(0, 0)
        enqueue(width - 1, 0)
        enqueue(0, height - 1)
        enqueue(width - 1, height - 1)

        while (qh < qt) {
          const idx = queue[qh++]
          const x = idx % width
          const y = Math.floor(idx / width)
          if (x > 0) enqueue(x - 1, y)
          if (x + 1 < width) enqueue(x + 1, y)
          if (y > 0) enqueue(x, y - 1)
          if (y + 1 < height) enqueue(x, y + 1)
        }

        let backgroundPixels = 0
        for (let i = 0; i < background.length; i++) {
          if (background[i] === 1) backgroundPixels++
        }
        const backgroundRatio = backgroundPixels / pixelCount
        if (backgroundRatio > 0.02 && backgroundRatio < 0.9995) {
          const mask = Buffer.alloc(pixelCount)
          for (let i = 0; i < pixelCount; i++) {
            mask[i] = background[i] === 1 ? 255 : 0
          }
          backgroundMask = mask
          usedCornerBackground = true
        }
      }
    }
  }

  const cleanImagePath = path.join(storagePath, 'processed', `${jobId}_clean.png`)
  const silhouetteMaskPath = path.join(storagePath, 'processed', `${jobId}_silhouette.pgm`)

  await sharp(data, { raw: { width, height, channels: 4 } }).png().toFile(cleanImagePath)
  const pgmHeader = `P5\n${width} ${height}\n255\n`
  await fs.writeFile(silhouetteMaskPath, Buffer.concat([Buffer.from(pgmHeader, 'ascii'), silhouetteMask]))

  logger.info(
    `[${jobId}] Background removal skipped by user. Silhouette source: ${
      hasUsefulAlpha ? 'alpha channel' : usedCornerBackground ? 'full image + background mask' : 'full image'
    }`
  )

  return {
    cleanImagePath,
    silhouetteMaskPath,
    width,
    height,
    usedAlphaSilhouette: hasUsefulAlpha,
    backgroundMask: backgroundMask ?? undefined,
    backgroundColor: backgroundColor ?? undefined,
  }
}

const createStrokeMask = async (
  jobId: string,
  storagePath: string,
  silhouetteMask: Buffer,
  width: number,
  height: number,
  params: JobData['params']
): Promise<{ color: string; maskPath: string } | null> => {
  const borderThicknessMm = params.borderThickness ?? 0
  if (!params.borderEnabled || borderThicknessMm <= 0) return null

  const pxPerMmX = width / Math.max(1, params.width)
  const pxPerMmY = height / Math.max(1, params.height)
  const strokePx = Math.max(1, Math.min(80, Math.round(borderThicknessMm * ((pxPerMmX + pxPerMmY) / 2))))

  const dilated = await dilateMask(silhouetteMask, width, height, strokePx)
  const ringMask = Buffer.alloc(width * height)

  let strokePixels = 0
  for (let i = 0; i < ringMask.length; i++) {
    if (dilated[i] === 255 && silhouetteMask[i] === 0) {
      ringMask[i] = 255
      strokePixels++
    }
  }

  if (strokePixels < Math.max(80, Math.round(width * height * 0.00005))) {
    logger.info(`[${jobId}] Stroke skipped: not enough pixels (${strokePixels})`)
    return null
  }

  const minComponentArea = Math.max(20, Math.round(width * height * 0.00002))
  const cleanedMask = removeSmallComponents(ringMask, width, height, minComponentArea)

  let cleanedPixels = 0
  for (let i = 0; i < cleanedMask.length; i++) {
    if (cleanedMask[i] === 255) cleanedPixels++
  }
  if (cleanedPixels < Math.max(50, Math.round(width * height * 0.00003))) {
    logger.info(`[${jobId}] Stroke skipped after cleanup: ${cleanedPixels} pixels`)
    return null
  }

  const maskPath = path.join(storagePath, 'processed', `${jobId}_stroke_mask.pgm`)
  const pgmHeader = `P5\n${width} ${height}\n255\n`
  await fs.writeFile(maskPath, Buffer.concat([Buffer.from(pgmHeader, 'ascii'), cleanedMask]))

  logger.info(
    `[${jobId}] Stroke layer created (${borderThicknessMm}mm -> ${strokePx}px): ${cleanedPixels} pixels`
  )
  return { color: '#f5f5f5', maskPath }
}

export const processImageJob = async (data: JobData) => {
  const { jobId, filePath, params } = data
  
  // DEBUG: Log parámetros recibidos
  logger.info(`[${jobId}] Parámetros recibidos en Worker:`, JSON.stringify(params, null, 2))
  
  try {
    // Update status to processing
    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'PROCESSING', progress: 10 },
    })

    logger.info(`[${jobId}] Starting image preprocessing...`)
    
    // Step 1: Create clean image + silhouette mask
    const shouldRemoveBackground = params.removeBackgroundEnabled !== false
    logger.info(`[${jobId}] Step 1: ${shouldRemoveBackground ? 'Removing background' : 'Keeping original background'}...`)
    const bgRemovalResult = shouldRemoveBackground
      ? await removeBackground(
          filePath,
          jobId,
          STORAGE_PATH,
          params.threshold
        )
      : await prepareImageWithoutBackgroundRemoval(filePath, jobId, STORAGE_PATH, params.threshold)
    const { cleanImagePath, silhouetteMaskPath, width, height } = bgRemovalResult
    const preparedResult = !shouldRemoveBackground
      ? (bgRemovalResult as Awaited<ReturnType<typeof prepareImageWithoutBackgroundRemoval>>)
      : null
    const usedAlphaSilhouette = preparedResult?.usedAlphaSilhouette ?? false
    const backgroundMask: Buffer | undefined = preparedResult?.backgroundMask
    const backgroundColor: string | undefined = preparedResult?.backgroundColor
    
    // Leer la máscara de silueta para usarla en la extracción de colores
    const silhouetteMaskData = await fs.readFile(silhouetteMaskPath)
    // Extraer solo los datos binarios (saltar el header PGM)
    const headerEnd = silhouetteMaskData.indexOf(0x0a, silhouetteMaskData.indexOf(0x0a, 3) + 1) + 1
    const silhouetteMask = silhouetteMaskData.slice(headerEnd)
    
    await prisma.job.update({
      where: { id: jobId },
      data: { progress: 15 },
    })
    
    // Step 2: Extract dominant colors from FOREGROUND ONLY
    logger.info(`[${jobId}] Step 2: Extracting colors from foreground...`)
    let foregroundMask = silhouetteMask
    if (backgroundMask) {
      const fg = Buffer.from(silhouetteMask)
      for (let i = 0; i < fg.length; i++) {
        if (backgroundMask[i] === 255) fg[i] = 0
      }
      foregroundMask = fg
    }
    const extractedColors = await extractColorsFromForeground(
      cleanImagePath,
      foregroundMask,
      width,
      height,
      jobId,
      params.maxColors
    )
    const targetMaxColors = Math.min(10, Math.max(1, Math.round(params.maxColors || 4)))
    let dominantColors = extractedColors
      .map(color => color.trim())
      .filter(color => HEX_COLOR_REGEX.test(color))
    dominantColors = dedupeHexPalette(dominantColors)
    dominantColors = dominantColors.slice(0, targetMaxColors)
    if (dominantColors.length === 0) {
      dominantColors.push('#3cb4dc', '#dc3ca0')
      logger.warn(`[${jobId}] No valid dominant colors extracted, using fallback palette`)
    } else if (dominantColors.length !== extractedColors.length) {
      logger.warn(
        `[${jobId}] Filtered invalid colors from palette. Before: ${extractedColors.join(', ')} | After: ${dominantColors.join(', ')}`
      )
    }
    if (backgroundMask && backgroundColor && HEX_COLOR_REGEX.test(backgroundColor)) {
      if (!dominantColors.includes(backgroundColor)) {
        dominantColors.push(backgroundColor)
      }
    }
    await prisma.job.update({
      where: { id: jobId },
      data: { dominantColors, progress: 20 },
    })
    logger.info(`[${jobId}] Dominant colors: ${dominantColors.join(', ')}`)
    
    // Step 3: Segment colors WITHIN the silhouette
    logger.info(`[${jobId}] Step 3: Segmenting colors within silhouette...`)
    const colorMasks = await segmentByColorsWithSilhouette(
      cleanImagePath,
      dominantColors,
      silhouetteMask,
      width,
      height,
      jobId,
      STORAGE_PATH,
      backgroundMask,
      backgroundColor
    )

    const strokeMask = await createStrokeMask(
      jobId,
      STORAGE_PATH,
      silhouetteMask,
      width,
      height,
      params
    )
    if (strokeMask) {
      colorMasks.unshift(strokeMask)
    }

    logger.info(`[${jobId}] Created ${colorMasks.length} color masks`)

    // Importante: la segmentación puede agregar/quitar capas (ej: negro para texto/runner),
    // así que persistimos el set final de colores para que API/Frontend descarguen la misma cantidad de STLs.
    const finalColors = colorMasks.map(m => m.color)
    await prisma.job.update({
      where: { id: jobId },
      data: { dominantColors: finalColors },
    })
    
    if (colorMasks.length === 0) {
      throw new Error('No colors detected in image. Try adjusting the threshold.')
    }
    
    // Generar imagen compuesta para preview 2D
    logger.info(`[${jobId}] Generating composite preview image...`)
    await generateCompositeImage(colorMasks, jobId, STORAGE_PATH)
    
    await prisma.job.update({
      where: { id: jobId },
      data: { progress: 20 },
    })
    
    // Arrays to hold STLs per color
    const colorSTLs: { color: string; stlPath: string }[] = []
    const isMulticolor = colorMasks.length > 1
    
    // Step 3: Process each color mask separately
    const vectorMask = colorMasks.find(m => m.svgPath && m.layers && m.layers.length)
    const useVector = Boolean(vectorMask && vectorMask.layers && vectorMask.layers.length)
    const vectorLayersByColor = new Map<string, { color: string; svgPath: string }>()
    const darkVectorLayerPaths: string[] = []
    const canIndexFallback =
      useVector &&
      Boolean(vectorMask?.layers && vectorMask.layers.length === colorMasks.length)
    if (useVector && vectorMask?.layers) {
      for (const layer of vectorMask.layers) {
        vectorLayersByColor.set(normalizeHex(layer.color), layer)
        if (isDarkHexColor(layer.color)) {
          darkVectorLayerPaths.push(layer.svgPath)
        }
      }
    }
    for (let i = 0; i < colorMasks.length; i++) {
      const { color, maskPath, svgPath, layers } = colorMasks[i]
      const progressBase = 20 + (i * 40 / colorMasks.length)
      
      logger.info(`[${jobId}] Processing color ${i + 1}/${colorMasks.length}: ${color}`)
      
      // Convertir a SVG: si hay vector multicapa, priorizar capa por color para evitar desalineaciones por índice.
      let svgToUse = svgPath
      if (useVector && vectorMask?.layers) {
        const byColor = vectorLayersByColor.get(normalizeHex(color))
        const byIndex = canIndexFallback ? (layers && layers[i] ? layers[i] : vectorMask.layers[i]) : undefined
        const selectedLayer = byColor || byIndex
        if (selectedLayer?.svgPath) {
          svgToUse = selectedLayer.svgPath
        }
      }
      if (!svgToUse) {
        svgToUse = await imageToSvg(maskPath, `${jobId}_color${i}`)
      }

      let subtractSvgPaths: string[] | undefined
      if (useVector && darkVectorLayerPaths.length > 0 && !isDarkHexColor(color)) {
        const unique = new Set(darkVectorLayerPaths)
        if (svgToUse) unique.delete(svgToUse)
        const list = [...unique]
        if (list.length > 0) {
          subtractSvgPaths = list
        }
      }
      await prisma.job.update({
        where: { id: jobId },
        data: { progress: Math.round(progressBase + 10) },
      })
      
      // Generate STL from SVG using OpenSCAD (probado y confiable)
      logger.info(`[${jobId}] Generating STL with OpenSCAD for color ${i}`)
      const stlPath = await svgToStl(svgToUse!, `${jobId}_color${i}`, {
        width: params.width,
        height: params.height,
        thickness: params.thickness,
        // En modo vector (multicolor) desactivamos stroke/relieve para respetar contornos exactos
        borderEnabled: useVector ? false : (isMulticolor ? false : params.borderEnabled),
        borderThickness: useVector ? undefined : (isMulticolor ? undefined : params.borderThickness),
        reliefEnabled: useVector ? false : (isMulticolor ? false : params.reliefEnabled),
        subtractSvgPaths,
      })
      
      colorSTLs.push({ color, stlPath })
      logger.info(`[${jobId}] STL for ${color}: ${stlPath}`)
      
      await prisma.job.update({
        where: { id: jobId },
        data: { progress: Math.round(progressBase + 20) },
      })
    }
    
    // Step 4: Add ring if enabled (to first object only for now)
    let finalStlPath = colorSTLs[0].stlPath
    if (params.ringEnabled) {
      logger.info(`[${jobId}] Adding ring...`)
      finalStlPath = await addRing(finalStlPath, jobId, {
        diameter: params.ringDiameter,
        thickness: params.ringThickness,
        position: params.ringPosition,
      })

      // Asegurar que 3MF/ZIP usen el STL con aro
      colorSTLs[0].stlPath = finalStlPath
    }

    // Step 5: Generate 3MF with all colored objects (incluye aro si aplica)
    logger.info(`[${jobId}] Creating multi-color 3MF...`)
    const mfPath = await generate3MFFromColorSTLs(colorSTLs, jobId, STORAGE_PATH)
    
    await prisma.job.update({
      where: { id: jobId },
      data: { 
        stlPath: finalStlPath, // STL base para preview/descarga
        progress: 70 
      },
    })
    
    // Step 6: Create ZIP with all color STLs for manual use
    logger.info(`[${jobId}] Creating ZIP with individual STLs...`)
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    
    // Add all STL files
    for (let i = 0; i < colorSTLs.length; i++) {
      const { color, stlPath } = colorSTLs[i]
      const stlContent = await fs.readFile(stlPath)
      const fileName = `color_${i + 1}_${color.replace('#', '')}.stl`
      zip.file(fileName, stlContent)
    }
    
    // Add 3MF file
    const mfContent = await fs.readFile(mfPath)
    zip.file(`${jobId}_multicolor.3mf`, mfContent)
    
    // Add color configuration JSON
    const colorConfig = {
      version: '1.0',
      jobId,
      totalColors: colorSTLs.length,
      colors: colorSTLs.map((item, index) => ({
        id: index + 1,
        hex: item.color,
        name: `Color ${index + 1}`,
        stlFile: `color_${index + 1}_${item.color.replace('#', '')}.stl`
      })),
      files: {
        threemf: `${jobId}_multicolor.3mf`,
        stls: colorSTLs.map((item, i) => `color_${i + 1}_${item.color.replace('#', '')}.stl`)
      },
      instructions: {
        es: `Este archivo contiene:\n1. Un archivo 3MF multi-color con ${colorSTLs.length} colores/capas (compatible con Bambu Studio)\n2. ${colorSTLs.length} archivos STL individuales (uno por color)\n\nCómo usar:\n- Abre ${jobId}_multicolor.3mf en Bambu Studio o un slicer compatible con 3MF.\n- Si necesitas ajustar colores manualmente, importa los STLs del ZIP y asigna filamentos por pieza.\n- Ajusta configuración de impresora y listo.`,
        en: `This file contains:\n1. A multi-color 3MF with ${colorSTLs.length} colors/layers (Bambu Studio compatible)\n2. ${colorSTLs.length} individual STL files (one per color)\n\nHow to use:\n- Open ${jobId}_multicolor.3mf in Bambu Studio or any 3MF-compatible slicer.\n- If you need manual color control, import the STLs from the ZIP and assign filaments per part.\n- Adjust printer settings and you're ready.`
      }
    }
    
    zip.file('colors.json', JSON.stringify(colorConfig, null, 2))
    zip.file('README.txt', `${colorConfig.instructions.es}\n\n---\n\n${colorConfig.instructions.en}`)
    
    // Generate ZIP
    const zipPath = path.join(STORAGE_PATH, 'processed', `${jobId}_multicolor.zip`)
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })
    await fs.writeFile(zipPath, zipBuffer)
    logger.info(`[${jobId}] Multi-color ZIP created: ${zipPath}`)
    
    await prisma.job.update({
      where: { id: jobId },
      data: { progress: 90 },
    })
    
    // Mark job as completed
    await prisma.job.update({
      where: { id: jobId },
      data: { 
        status: 'COMPLETED',
        progress: 100,
        completedAt: new Date()
      },
    })
    
    logger.info(`[${jobId}] Job completed successfully!`)
    
  } catch (error) {
    logger.error(`[${jobId}] Error processing job:`, error)
    
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      },
    })
    
    throw error
  }
}
