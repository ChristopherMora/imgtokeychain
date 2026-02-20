import sharp from 'sharp'
import path from 'path'
import fs from 'fs/promises'
import { logger } from '../utils/logger'
import { closeMask, removeSmallComponents } from './maskEnhancer'

const STORAGE_PATH = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../../storage')
const DEFAULT_MAX_PROCESSING_DIM = 2000
const MAX_PROCESSING_DIM = (() => {
  const parsed = Number.parseInt(
    process.env.WORKER_MAX_PROCESSING_DIM || String(DEFAULT_MAX_PROCESSING_DIM),
    10
  )
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_PROCESSING_DIM
})()

interface BackgroundRemovalResult {
  // Imagen sin fondo (PNG con transparencia)
  cleanImagePath: string
  // Máscara de silueta (PGM donde blanco = logo, negro = fondo)
  silhouetteMaskPath: string
  // Dimensiones
  width: number
  height: number
}

function getProcessingDimensions(width: number, height: number): { width: number; height: number } {
  const maxDim = Math.max(width, height)
  if (maxDim <= MAX_PROCESSING_DIM) return { width, height }
  const scale = MAX_PROCESSING_DIM / maxDim
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function singleChannelToRgb(mask: Buffer): Buffer {
  const rgb = Buffer.alloc(mask.length * 3)
  for (let i = 0; i < mask.length; i++) {
    const value = mask[i]
    rgb[i * 3] = value
    rgb[i * 3 + 1] = value
    rgb[i * 3 + 2] = value
  }
  return rgb
}

async function resizeBinaryMaskNearest(
  mask: Buffer,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number
): Promise<Buffer> {
  if (srcWidth === dstWidth && srcHeight === dstHeight) {
    return Buffer.from(mask)
  }

  const rgbMask = singleChannelToRgb(mask)
  const resized = await sharp(rgbMask, {
    raw: { width: srcWidth, height: srcHeight, channels: 3 }
  })
    .resize(dstWidth, dstHeight, {
      fit: 'fill',
      kernel: 'nearest',
      background: { r: 0, g: 0, b: 0, alpha: 1 }
    })
    .raw()
    .toBuffer({ resolveWithObject: true })

  const output = Buffer.alloc(dstWidth * dstHeight)
  const channels = resized.info.channels
  for (let i = 0; i < output.length; i++) {
    output[i] = resized.data[i * channels] >= 128 ? 255 : 0
  }
  return output
}

async function writeProcessedArtifacts(
  jobId: string,
  storagePath: string,
  rgbaData: Buffer,
  silhouetteMask: Buffer,
  width: number,
  height: number
): Promise<BackgroundRemovalResult> {
  const processingSize = getProcessingDimensions(width, height)
  const outWidth = processingSize.width
  const outHeight = processingSize.height
  const resized = outWidth !== width || outHeight !== height

  let outputMask = silhouetteMask
  let outputRgba = Buffer.from(rgbaData)

  if (resized) {
    logger.info(
      `[${jobId}] Resizing processing assets from ${width}x${height} to ${outWidth}x${outHeight}`
    )

    outputMask = await resizeBinaryMaskNearest(silhouetteMask, width, height, outWidth, outHeight)

    const resizedImage = await sharp(rgbaData, {
      raw: { width, height, channels: 4 }
    })
      .resize(outWidth, outHeight, {
        fit: 'fill',
        kernel: 'lanczos3',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .raw()
      .toBuffer({ resolveWithObject: true })

    outputRgba = Buffer.from(resizedImage.data)
    for (let i = 0; i < outputMask.length; i++) {
      outputRgba[i * 4 + 3] = outputMask[i]
    }

    const minComponentArea = Math.max(20, Math.round((outWidth * outHeight) * 0.00003))
    outputMask = await closeMask(outputMask, outWidth, outHeight, 1)
    outputMask = removeSmallComponents(outputMask, outWidth, outHeight, minComponentArea)
    for (let i = 0; i < outputMask.length; i++) {
      outputRgba[i * 4 + 3] = outputMask[i]
    }
  }

  const silhouetteMaskPath = path.join(storagePath, 'processed', `${jobId}_silhouette.pgm`)
  const pgmHeader = `P5\n${outWidth} ${outHeight}\n255\n`
  await fs.writeFile(
    silhouetteMaskPath,
    Buffer.concat([Buffer.from(pgmHeader, 'ascii'), outputMask])
  )

  const cleanImagePath = path.join(storagePath, 'processed', `${jobId}_clean.png`)
  await sharp(outputRgba, {
    raw: { width: outWidth, height: outHeight, channels: 4 }
  })
    .png()
    .toFile(cleanImagePath)

  logger.info(`[${jobId}] Silhouette mask saved: ${silhouetteMaskPath}`)
  logger.info(`[${jobId}] Clean image saved: ${cleanImagePath}`)

  return {
    cleanImagePath,
    silhouetteMaskPath,
    width: outWidth,
    height: outHeight
  }
}

/**
 * Remueve el fondo de una imagen detectando el color de las esquinas.
 * Retorna la imagen limpia y una máscara de silueta.
 */
export const removeBackground = async (
  inputPath: string,
  jobId: string,
  storagePath: string = STORAGE_PATH,
  threshold: number = 180
): Promise<BackgroundRemovalResult> => {
  try {
    logger.info(`[${jobId}] Starting background removal...`)
    
    const image = sharp(inputPath)
    const metadata = await image.metadata()
    const { width = 500, height = 500 } = metadata
    const pixelCount = width * height

    // Obtener datos raw (preservar alpha si existe)
    const { data, info } = await image
      .raw()
      .toBuffer({ resolveWithObject: true })
    const channels = info.channels

    // Si el input ya tiene transparencia real, usar el canal alfa como silueta (mucho más preciso)
    if (channels === 4) {
      let transparentPixels = 0
      for (let i = 0; i < pixelCount; i++) {
        if (data[i * 4 + 3] < 250) transparentPixels++
      }

      const transparencyRatio = transparentPixels / pixelCount
      if (transparencyRatio > 0.001) {
        logger.info(`[${jobId}] Detected alpha transparency (${(transparencyRatio * 100).toFixed(2)}%), using alpha as silhouette`)

        const silhouetteMask = Buffer.alloc(pixelCount)
        let foregroundPixels = 0
        for (let i = 0; i < pixelCount; i++) {
          const a = data[i * 4 + 3]
          // Usar umbral >= 128 en vez de > 0 para excluir píxeles "fantasma"
          // del borde anti-aliased que tienen colores corruptos/ambiguos
          if (a >= 128) {
            silhouetteMask[i] = 255
            foregroundPixels++
          } else {
            silhouetteMask[i] = 0
          }
        }

        let cleanedMask = silhouetteMask
        const minComponentArea = Math.max(30, Math.round(pixelCount * 0.00005))
        cleanedMask = Buffer.from(await closeMask(cleanedMask, width, height, 1))
        cleanedMask = Buffer.from(removeSmallComponents(cleanedMask, width, height, minComponentArea))
        const rgbaData = Buffer.alloc(pixelCount * 4)
        for (let i = 0; i < pixelCount; i++) {
          rgbaData[i * 4] = data[i * 4]
          rgbaData[i * 4 + 1] = data[i * 4 + 1]
          rgbaData[i * 4 + 2] = data[i * 4 + 2]
          rgbaData[i * 4 + 3] = cleanedMask[i]
        }

        logger.info(`[${jobId}] Foreground pixels (alpha): ${foregroundPixels} (${(foregroundPixels / pixelCount * 100).toFixed(2)}%)`)
        return writeProcessedArtifacts(jobId, storagePath, rgbaData, cleanedMask, width, height)
      }
    }
    
    // Detectar el color de fondo analizando las 4 esquinas
    const backgroundColor = detectBackgroundColor(data, width, height, channels)
    logger.info(`[${jobId}] Detected background color: RGB(${backgroundColor.r}, ${backgroundColor.g}, ${backgroundColor.b})`)

    const backgroundTolerance = computeBackgroundTolerance(
      data,
      width,
      height,
      channels,
      backgroundColor,
      threshold
    )
    logger.info(`[${jobId}] Background tolerance: ${backgroundTolerance}`)
    
    // Flood-fill desde los bordes para detectar SOLO el fondo conectado a las esquinas.
    // Esto evita eliminar detalles internos que comparten el mismo color del fondo (ej: logo negro sobre fondo negro).
    const BACKGROUND_TOLERANCE = backgroundTolerance
    const background = new Uint8Array(pixelCount) // 1 = background
    const queue = new Int32Array(pixelCount)
    let qh = 0
    let qt = 0

    const colorDistanceAt = (pixelIndex: number): number => {
      const dataIndex = pixelIndex * channels
      const r = data[dataIndex]
      const g = data[dataIndex + 1]
      const b = data[dataIndex + 2]
      return Math.sqrt(
        Math.pow(r - backgroundColor.r, 2) +
        Math.pow(g - backgroundColor.g, 2) +
        Math.pow(b - backgroundColor.b, 2)
      )
    }

    const trySeed = (pixelIndex: number) => {
      if (background[pixelIndex] === 1) return
      if (colorDistanceAt(pixelIndex) > BACKGROUND_TOLERANCE) return
      background[pixelIndex] = 1
      queue[qt++] = pixelIndex
    }

    // Seeds: todos los píxeles del borde que parezcan fondo
    for (let x = 0; x < width; x++) {
      trySeed(x) // top row
      trySeed((height - 1) * width + x) // bottom row
    }
    for (let y = 0; y < height; y++) {
      trySeed(y * width) // left column
      trySeed(y * width + (width - 1)) // right column
    }

    const neighbors = [
      [-1, 0], [1, 0], [0, -1], [0, 1],
      [-1, -1], [1, -1], [-1, 1], [1, 1],
    ] as const

    while (qh < qt) {
      const idx = queue[qh++]
      const x = idx % width
      const y = Math.floor(idx / width)

      for (const [dx, dy] of neighbors) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const nidx = ny * width + nx
        if (background[nidx] === 1) continue
        if (colorDistanceAt(nidx) > BACKGROUND_TOLERANCE) continue
        background[nidx] = 1
        queue[qt++] = nidx
      }
    }

    // Crear máscara de silueta: blanco donde NO es fondo (conectado al borde), negro donde ES fondo
    let silhouetteMask = Buffer.alloc(pixelCount)
    let foregroundPixels = 0
    for (let i = 0; i < pixelCount; i++) {
      if (background[i] === 1) {
        silhouetteMask[i] = 0
      } else {
        silhouetteMask[i] = 255
        foregroundPixels++
      }
    }

    // Si el fondo es muy claro/neutro, limpiar el halo SOLO en el borde externo
    const bgHsl = rgbToHsl(backgroundColor.r, backgroundColor.g, backgroundColor.b)
    const isLightNeutralBg = bgHsl.l > 0.9 && bgHsl.s < 0.12
    if (isLightNeutralBg) {
      const bandRadius = Math.max(1, Math.round(Math.min(width, height) / 500))
      const backgroundBand = new Uint8Array(pixelCount)

      for (let i = 0; i < pixelCount; i++) {
        if (background[i] !== 1) continue
        const x = i % width
        const y = Math.floor(i / width)
        for (let dy = -bandRadius; dy <= bandRadius; dy++) {
          for (let dx = -bandRadius; dx <= bandRadius; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
            backgroundBand[ny * width + nx] = 1
          }
        }
      }

      const normalized = Math.min(1, Math.max(0, (threshold - 100) / 120))
      const lightnessThreshold = 0.78 + normalized * 0.1
      const saturationThreshold = 0.28

      for (let i = 0; i < pixelCount; i++) {
        if (silhouetteMask[i] === 0) continue
        if (backgroundBand[i] !== 1) continue
        const dataIndex = i * channels
        const r = data[dataIndex]
        const g = data[dataIndex + 1]
        const b = data[dataIndex + 2]
        const { s, l } = rgbToHsl(r, g, b)
        if (l > lightnessThreshold && s < saturationThreshold) {
          silhouetteMask[i] = 0
          foregroundPixels--
        }
      }
    }

    // Detectar y eliminar "hoyos" de fondo dentro del logo (ej: P/O/E)
    const holeTolerance = Math.max(6, Math.round(BACKGROUND_TOLERANCE * 0.7))
    const minHoleArea = Math.max(40, Math.round(pixelCount * 0.00005))
    let holesRemoved = 0
    if (holeTolerance > 0) {
      const visited = new Uint8Array(pixelCount)
      const queue = new Int32Array(pixelCount)

      const isBgLike = (pixelIndex: number): boolean => {
        const dataIndex = pixelIndex * channels
        const r = data[dataIndex]
        const g = data[dataIndex + 1]
        const b = data[dataIndex + 2]
        const dist = Math.sqrt(
          Math.pow(r - backgroundColor.r, 2) +
          Math.pow(g - backgroundColor.g, 2) +
          Math.pow(b - backgroundColor.b, 2)
        )
        if (dist > holeTolerance) return false
        if (isLightNeutralBg) {
          const { s, l } = rgbToHsl(r, g, b)
          if (l < 0.75 || s > 0.25) return false
        }
        return true
      }

      for (let i = 0; i < pixelCount; i++) {
        if (silhouetteMask[i] !== 255) continue
        if (visited[i]) continue
        if (!isBgLike(i)) continue

        let qh = 0
        let qt = 0
        queue[qt++] = i
        visited[i] = 1

        let componentSize = 0
        let removeComponent = false
        const componentPixels: number[] = []

        while (qh < qt) {
          const idx = queue[qh++]
          componentSize++

          if (!removeComponent) {
            componentPixels.push(idx)
            if (componentSize >= minHoleArea) {
              removeComponent = true
              for (const pix of componentPixels) silhouetteMask[pix] = 0
              componentPixels.length = 0
            }
          } else {
            silhouetteMask[idx] = 0
          }

          const x = idx % width
          const y = Math.floor(idx / width)
          for (const [dx, dy] of neighbors) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
            const nidx = ny * width + nx
            if (visited[nidx]) continue
            if (silhouetteMask[nidx] !== 255) continue
            if (!isBgLike(nidx)) continue
            visited[nidx] = 1
            queue[qt++] = nidx
          }
        }

        if (removeComponent) {
          holesRemoved += componentSize
        }
      }
    }

    if (holesRemoved > 0) {
      logger.info(`[${jobId}] Removed ${holesRemoved} background-like pixels inside logo (holes)`)
    }

    // Suavizar y limpiar máscara (reduce bordes "masticados" y elimina cuadraditos)
    const minComponentArea = Math.max(30, Math.round(pixelCount * 0.00005))
    silhouetteMask = Buffer.from(await closeMask(silhouetteMask, width, height, 1))
    silhouetteMask = Buffer.from(removeSmallComponents(silhouetteMask, width, height, minComponentArea))
    
    // Recalcular porcentaje después de limpiar
    foregroundPixels = 0
    for (let i = 0; i < pixelCount; i++) {
      if (silhouetteMask[i] === 255) foregroundPixels++
    }
    const foregroundPercentage = (foregroundPixels / (width * height) * 100).toFixed(2)
    logger.info(`[${jobId}] Foreground pixels: ${foregroundPixels} (${foregroundPercentage}%)`)
    
    // Crear imagen RGBA con alpha de la silueta
    const rgbaData = Buffer.alloc(width * height * 4)

    for (let i = 0; i < width * height; i++) {
      const dataIndex = i * channels
      rgbaData[i * 4] = data[dataIndex]         // R
      rgbaData[i * 4 + 1] = data[dataIndex + 1] // G
      rgbaData[i * 4 + 2] = data[dataIndex + 2] // B
      rgbaData[i * 4 + 3] = silhouetteMask[i] // A (de la máscara)
    }

    return writeProcessedArtifacts(jobId, storagePath, rgbaData, silhouetteMask, width, height)
    
  } catch (error) {
    logger.error(`[${jobId}] Error removing background:`, error)
    throw error
  }
}

/**
 * Detecta el color de fondo analizando las esquinas de la imagen.
 */
function detectBackgroundColor(
  data: Buffer,
  width: number,
  height: number,
  channels: number
): { r: number; g: number; b: number } {
  // Muestrear píxeles de las 4 esquinas (área de 20x20)
  const sampleSize = 20
  const samples: { r: number; g: number; b: number }[] = []
  
  // Esquina superior izquierda
  for (let y = 0; y < sampleSize && y < height; y++) {
    for (let x = 0; x < sampleSize && x < width; x++) {
      const idx = (y * width + x) * channels
      samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] })
    }
  }
  
  // Esquina superior derecha
  for (let y = 0; y < sampleSize && y < height; y++) {
    for (let x = width - sampleSize; x < width; x++) {
      if (x >= 0) {
        const idx = (y * width + x) * channels
        samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] })
      }
    }
  }
  
  // Esquina inferior izquierda
  for (let y = height - sampleSize; y < height; y++) {
    if (y >= 0) {
      for (let x = 0; x < sampleSize && x < width; x++) {
        const idx = (y * width + x) * channels
        samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] })
      }
    }
  }
  
  // Esquina inferior derecha
  for (let y = height - sampleSize; y < height; y++) {
    if (y >= 0) {
      for (let x = width - sampleSize; x < width; x++) {
        if (x >= 0) {
          const idx = (y * width + x) * channels
          samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] })
        }
      }
    }
  }
  
  // Calcular promedio
  let totalR = 0, totalG = 0, totalB = 0
  for (const sample of samples) {
    totalR += sample.r
    totalG += sample.g
    totalB += sample.b
  }
  
  return {
    r: Math.round(totalR / samples.length),
    g: Math.round(totalG / samples.length),
    b: Math.round(totalB / samples.length)
  }
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255
  g /= 255
  b /= 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }

  return { h: h * 360, s, l }
}

function computeBackgroundTolerance(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  backgroundColor: { r: number; g: number; b: number },
  threshold: number
): number {
  const distances: number[] = []
  const step = Math.max(1, Math.floor(Math.min(width, height) / 100))

  const colorDistance = (idx: number) => {
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
    distances.push(colorDistance((0 * width + x) * channels))
    distances.push(colorDistance(((height - 1) * width + x) * channels))
  }
  for (let y = 0; y < height; y += step) {
    distances.push(colorDistance((y * width + 0) * channels))
    distances.push(colorDistance((y * width + (width - 1)) * channels))
  }

  distances.sort((a, b) => a - b)
  const p90 = distances[Math.floor(distances.length * 0.9)] || 0
  let baseTolerance = Math.round(p90 * 1.1 + 4)

  const normalized = Math.min(1, Math.max(0, (threshold - 100) / 120))
  const sliderFactor = 0.85 + normalized * 0.4 // 0.85..1.25
  baseTolerance = Math.round(baseTolerance * sliderFactor)

  return Math.min(60, Math.max(10, baseTolerance))
}

function redmeanDistance(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number
): number {
  const rMean = (r1 + r2) / 2
  const dR = r1 - r2
  const dG = g1 - g2
  const dB = b1 - b2
  return Math.sqrt(
    (2 + rMean / 256) * dR * dR +
    4 * dG * dG +
    (2 + (255 - rMean) / 256) * dB * dB
  )
}

/**
 * Extrae colores dominantes SOLO de los píxeles del logo (no del fondo).
 */
export const extractColorsFromForeground = async (
  inputPath: string,
  silhouetteMask: Buffer,
  width: number,
  height: number,
  jobId: string,
  maxColors: number = 4
): Promise<string[]> => {
  try {
    logger.info(`[${jobId}] Extracting colors from foreground only...`)
    const targetMaxColors = Math.min(10, Math.max(1, Math.round(maxColors || 4)))
    
    // Leer colores RGB ORIGINALES sin compositar alpha.
    // flatten/removeAlpha corrompen colores de píxeles semi-transparentes del borde
    // (ej: negro alpha=150 → gris que matchea rosa). Los canales RGB raw conservan
    // el color real del píxel independientemente de su transparencia.
    const rawResult = await sharp(inputPath)
      .raw()
      .toBuffer({ resolveWithObject: true })
    const rawChannels = rawResult.info.channels
    let data: Buffer
    const totalPixels = width * height
    if (rawChannels === 3) {
      data = rawResult.data
    } else {
      data = Buffer.alloc(totalPixels * 3)
      for (let i = 0; i < totalPixels; i++) {
        data[i * 3] = rawResult.data[i * rawChannels]
        data[i * 3 + 1] = rawResult.data[i * rawChannels + 1]
        data[i * 3 + 2] = rawResult.data[i * rawChannels + 2]
      }
    }
    
    // Contar colores solo en píxeles del logo (donde silhouetteMask = 255)
    const colorMap = new Map<string, { count: number; saturation: number; hue: number; lightness: number }>()
    let foregroundPixels = 0
    
    // Paso de cuantización: agrupar colores similares en buckets.
    // Nota: Math.round(255/16)*16 = 256, por eso clamp a 255 para no generar hex inválidos.
    const quantStep = 16
    const quantizeChannel = (value: number) => Math.max(0, Math.min(255, Math.round(value / quantStep) * quantStep))
    
    for (let i = 0; i < width * height; i++) {
      // Solo procesar píxeles del logo
      if (silhouetteMask[i] !== 255) continue
      if (rawChannels === 4 && rawResult.data[i * rawChannels + 3] < 128) continue
      foregroundPixels++
      
      const r = data[i * 3]
      const g = data[i * 3 + 1]
      const b = data[i * 3 + 2]
      
      // Cuantizar según cantidad de colores solicitados
      const rr = quantizeChannel(r)
      const gg = quantizeChannel(g)
      const bb = quantizeChannel(b)
      
      // Calcular saturación y hue
      const max = Math.max(rr, gg, bb)
      const min = Math.min(rr, gg, bb)
      const saturation = max === 0 ? 0 : (max - min) / max
      const lightness = (max + min) / 2 / 255
      
      let hue = 0
      if (max !== min) {
        const delta = max - min
        if (max === rr) {
          hue = ((gg - bb) / delta + (gg < bb ? 6 : 0)) * 60
        } else if (max === gg) {
          hue = ((bb - rr) / delta + 2) * 60
        } else {
          hue = ((rr - gg) / delta + 4) * 60
        }
      }
      
      const colorKey = `${rr},${gg},${bb}`
      const existing = colorMap.get(colorKey) || { count: 0, saturation, hue, lightness }
      colorMap.set(colorKey, {
        count: existing.count + 1,
        saturation: existing.saturation,
        hue: existing.hue,
        lightness: existing.lightness,
      })
    }
    
    // Separar colores saturados de colores oscuros/grises
    const saturatedColors = Array.from(colorMap.entries())
      .map(([color, data]) => ({ color, ...data }))
      .filter(c => c.saturation > 0.1)  // Colores con saturación
      .sort((a, b) => b.count - a.count)
    
    const darkColors = Array.from(colorMap.entries())
      .map(([color, data]) => ({ color, ...data }))
      .filter(c => c.saturation <= 0.3)  // Grises, negros (baja saturación)
      .sort((a, b) => b.count - a.count)
    
    logger.info(`[${jobId}] Found ${saturatedColors.length} saturated colors and ${darkColors.length} dark/gray colors in foreground`)
    
    // Seleccionar colores diversos (diferentes hues) de los saturados
    const selectedColors: typeof saturatedColors = []

    // Filtrar colores "accidentales" (anti-aliasing / compresión) que generan capas punteadas.
    // Regla: ignorar colores saturados MUY oscuros si no ocupan una fracción significativa del foreground.
    const MIN_SATURATED_FRACTION =
      targetMaxColors <= 3 ? 0.003 : targetMaxColors <= 5 ? 0.008 : 0.02 // 0.3%–2%
    const MIN_DARK_SATURATED_FRACTION = targetMaxColors >= 6 ? 0.04 : 0.08 // 4%–8% si además es muy oscuro
    const VERY_DARK_LIGHTNESS = 0.12

    const saturatedCandidates = saturatedColors.filter(c => {
      if (foregroundPixels <= 0) return false
      if (c.count < foregroundPixels * MIN_SATURATED_FRACTION) return false
      const isVeryDark = c.lightness < VERY_DARK_LIGHTNESS
      if (isVeryDark && c.count < foregroundPixels * MIN_DARK_SATURATED_FRACTION) return false
      return true
    })

    const saturatedPool = saturatedCandidates.length > 0 ? saturatedCandidates : saturatedColors

    // Si hay negros/grises relevantes, reservar 1 slot para ellos (texto/contornos),
    // para evitar que la segmentación cree una capa extra fuera del límite.
    const darkCandidate = darkColors.find(c => c.lightness < 0.35) || null
    const darkFraction = darkCandidate && foregroundPixels > 0 ? darkCandidate.count / foregroundPixels : 0
    const minDarkFraction = targetMaxColors <= 3 ? 0.01 : 0.006
    const hasUsefulDark =
      !!darkCandidate &&
      darkCandidate.count > 40 &&
      darkFraction >= minDarkFraction
    const maxSaturated = Math.max(0, Math.min(8, targetMaxColors - (hasUsefulDark ? 1 : 0)))

    for (const color of saturatedPool) {
      if (selectedColors.length >= maxSaturated) break
      
      // Verificar que sea diferente de los ya seleccionados
      const isDifferent = selectedColors.every(selected => {
        const hueDiff = Math.min(
          Math.abs(color.hue - selected.hue),
          360 - Math.abs(color.hue - selected.hue)
        )
        return hueDiff > 30  // Mínimo 30 grados de diferencia
      })
      
      if (isDifferent || selectedColors.length === 0) {
        selectedColors.push(color)
      }
    }

    // Agregar el color oscuro más común si existe y tiene suficientes píxeles
    if (hasUsefulDark && selectedColors.length < targetMaxColors && darkCandidate) {
      selectedColors.push(darkCandidate)
      logger.info(`[${jobId}] Added dark/gray color: ${darkCandidate.color} (${darkCandidate.count} pixels)`)
    }

    // Fusionar colores casi idénticos para evitar capas duplicadas (ej: varios azules muy cercanos).
    const mergeDistance = targetMaxColors <= 4 ? 26 : 20
    const mergedColors: typeof selectedColors = []
    const byArea = [...selectedColors].sort((a, b) => b.count - a.count)
    for (const color of byArea) {
      const [r, g, b] = color.color.split(',').map(Number)
      const isNearExisting = mergedColors.some(existing => {
        const [er, eg, eb] = existing.color.split(',').map(Number)
        return redmeanDistance(r, g, b, er, eg, eb) < mergeDistance
      })
      if (!isNearExisting) {
        mergedColors.push(color)
      }
    }
    
    // Convertir a hex
    const hexColors = mergedColors.map(({ color }) => {
      const [r, g, b] = color.split(',').map(Number)
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
    })
    
    logger.info(`[${jobId}] Selected foreground colors (${hexColors.length}/${targetMaxColors}): ${hexColors.join(', ')}`)
    
    return hexColors.length > 0 ? hexColors : ['#3cb4dc', '#dc3ca0']  // Fallback
    
  } catch (error) {
    logger.error(`[${jobId}] Error extracting foreground colors:`, error)
    return ['#3cb4dc', '#dc3ca0']  // Fallback
  }
}
