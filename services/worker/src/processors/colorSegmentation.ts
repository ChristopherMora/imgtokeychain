import sharp from 'sharp'
import path from 'path'
import fs from 'fs/promises'
import { logger } from '../utils/logger'
import { optimizeMaskForPotrace, removeSmallComponents, erodeMask, dilateMask } from './maskEnhancer'
import { labelsToMultiLayerSvg } from './svgGenerator'

/**
 * Convierte RGB a HSL
 */
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

function toRgbBufferFromSingleChannel(buffer: Buffer): Buffer {
  const rgb = Buffer.alloc(buffer.length * 3)
  for (let i = 0; i < buffer.length; i++) {
    const value = buffer[i]
    rgb[i * 3] = value
    rgb[i * 3 + 1] = value
    rgb[i * 3 + 2] = value
  }
  return rgb
}

async function resizeSingleChannelNearest(
  buffer: Buffer,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number
): Promise<Buffer> {
  if (srcWidth === dstWidth && srcHeight === dstHeight) return Buffer.from(buffer)

  const rgb = toRgbBufferFromSingleChannel(buffer)
  const resized = await sharp(rgb, {
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
    output[i] = resized.data[i * channels]
  }
  return output
}

async function resizeBinaryMask(
  maskBuffer: Buffer,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
  crispEdges: boolean
): Promise<Buffer> {
  if (srcWidth === dstWidth && srcHeight === dstHeight) return Buffer.from(maskBuffer)

  const rgb = toRgbBufferFromSingleChannel(maskBuffer)
  let image = sharp(rgb, {
    raw: { width: srcWidth, height: srcHeight, channels: 3 }
  }).resize(dstWidth, dstHeight, {
    fit: 'fill',
    kernel: crispEdges ? 'nearest' : 'lanczos3',
    background: { r: 0, g: 0, b: 0, alpha: 1 }
  })

  if (!crispEdges) {
    image = image.blur(0.6).median(3)
  }

  const resized = await image
    .raw()
    .toBuffer({ resolveWithObject: true })

  const output = Buffer.alloc(dstWidth * dstHeight)
  const channels = resized.info.channels
  for (let i = 0; i < output.length; i++) {
    output[i] = resized.data[i * channels] >= 128 ? 255 : 0
  }
  return output
}

function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function isLikelyDarkPixel(
  r: number,
  g: number,
  b: number,
  crispEdges: boolean
): boolean {
  const { s, l } = rgbToHsl(r, g, b)
  const lum = relativeLuminance(r, g, b)
  if (lum < (crispEdges ? 74 : 64)) return true
  if (s < (crispEdges ? 0.14 : 0.12) && l < (crispEdges ? 0.24 : 0.2)) return true
  return (r + g + b) < (crispEdges ? 82 : 72)
}

function fillTinyHoles(
  maskBuffer: Buffer,
  width: number,
  height: number,
  maxHoleArea: number
): Buffer {
  if (maxHoleArea <= 0) return maskBuffer
  const total = width * height
  if (total === 0) return maskBuffer

  const visited = new Uint8Array(total)
  const result = Buffer.from(maskBuffer)
  const queue = new Int32Array(total)
  const neighbors = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
  ] as const

  for (let start = 0; start < total; start++) {
    if (result[start] >= 128 || visited[start] === 1) continue

    let qh = 0
    let qt = 0
    queue[qt++] = start
    visited[start] = 1

    let touchesBoundary = false
    let canFill = true
    const component: number[] = []

    while (qh < qt) {
      const idx = queue[qh++]
      const x = idx % width
      const y = Math.floor(idx / width)

      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
        touchesBoundary = true
        canFill = false
      }

      if (canFill) {
        component.push(idx)
        if (component.length > maxHoleArea) {
          canFill = false
          component.length = 0
        }
      }

      for (const [dx, dy] of neighbors) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const nidx = ny * width + nx
        if (visited[nidx] === 1 || result[nidx] >= 128) continue
        visited[nidx] = 1
        queue[qt++] = nidx
      }
    }

    if (!touchesBoundary && canFill && component.length > 0 && component.length <= maxHoleArea) {
      for (const idx of component) result[idx] = 255
    }
  }

  return result
}

function cleanupSmallLabelIslands(
  labelData: Buffer,
  width: number,
  height: number,
  minArea: number,
  darkLabel: number = -1,
  minAreaDark: number = minArea
): Buffer {
  const total = width * height
  if (total === 0) return labelData

  const result = Buffer.from(labelData)
  const visited = new Uint8Array(total)
  const queue = new Int32Array(total)
  const neighbors = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
  ] as const

  for (let start = 0; start < total; start++) {
    if (visited[start] === 1) continue
    const label = result[start]
    if (label === 0) continue

    let qh = 0
    let qt = 0
    queue[qt++] = start
    visited[start] = 1

    const component: number[] = []
    const borderCounts = new Map<number, number>()

    while (qh < qt) {
      const idx = queue[qh++]
      component.push(idx)
      const x = idx % width
      const y = Math.floor(idx / width)

      for (const [dx, dy] of neighbors) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const nidx = ny * width + nx
        const nLabel = result[nidx]
        if (nLabel === label) {
          if (visited[nidx] === 0) {
            visited[nidx] = 1
            queue[qt++] = nidx
          }
        } else if (nLabel !== 0) {
          borderCounts.set(nLabel, (borderCounts.get(nLabel) || 0) + 1)
        }
      }
    }

    const areaThreshold = label === darkLabel ? minAreaDark : minArea
    if (component.length >= areaThreshold) continue
    if (borderCounts.size === 0) continue

    let replacement = -1
    let bestCount = -1
    for (const [nLabel, count] of borderCounts.entries()) {
      if (count > bestCount) {
        bestCount = count
        replacement = nLabel
      }
    }

    if (replacement > 0 && replacement !== label) {
      for (const idx of component) result[idx] = replacement
    }
  }

  return result
}

/**
 * Segmenta una imagen por RANGOS DE HUE dentro de una silueta.
 * Esto funciona mucho mejor para logos con gradientes.
 */
export const segmentByColorsWithSilhouette = async (
  inputPath: string,
  colors: string[],
  silhouetteMask: Buffer,
  width: number,
  height: number,
  jobId: string,
  storagePath: string,
  backgroundMask?: Buffer,
  backgroundColor?: string
): Promise<{ color: string; maskPath: string; svgPath?: string; layers?: { color: string; svgPath: string }[] }[]> => {
  try {
    logger.info(`[${jobId}] Segmenting by guided palette within silhouette...`)
    
    const crispEdges = colors.length <= 6
    const vectorMode = crispEdges && colors.length <= 6
    const strictVectorMode = vectorMode && process.env.WORKER_VECTOR_STRICT !== '0'

    // Leer los colores RGB ORIGINALES sin compositar alpha.
    // flatten() y removeAlpha() corrompen los colores de píxeles semi-transparentes
    // del borde (ej: negro con alpha=150 → gris que matchea rosa en vez de negro).
    // Al leer raw RGBA, los canales R,G,B conservan el color real independientemente del alpha.
    let imageReader = sharp(inputPath)
    if (!crispEdges) {
      imageReader = imageReader.median(2)
    }
    const rawResult = await imageReader
      .raw()
      .toBuffer({ resolveWithObject: true })
    const rawChannels = rawResult.info.channels
    // Extraer buffer RGB puro (3 canales) para que el resto del código use data[i*3]
    let data: Buffer
    if (rawChannels === 3) {
      data = rawResult.data
    } else {
      const totalPixels = width * height
      data = Buffer.alloc(totalPixels * 3)
      for (let i = 0; i < totalPixels; i++) {
        data[i * 3] = rawResult.data[i * rawChannels]
        data[i * 3 + 1] = rawResult.data[i * rawChannels + 1]
        data[i * 3 + 2] = rawResult.data[i * rawChannels + 2]
      }
    }

    // Si vienen colores dominantes, usarlos como guía principal (mucho más fiel que los picos de hue)
    const guidedPalette = colors
      .map(c => hexToRgb(c))
      .filter((c): c is { r: number; g: number; b: number } => !!c)

    const normalizeHexString = (value?: string) => {
      if (!value) return ''
      const trimmed = value.trim().toLowerCase()
      return trimmed.startsWith('#') ? trimmed : `#${trimmed}`
    }
    const normalizedBackground = normalizeHexString(backgroundColor)
    const backgroundIndex =
      backgroundMask && normalizedBackground
        ? colors.findIndex(c => normalizeHexString(c) === normalizedBackground)
        : -1
    const isBackground = (i: number) =>
      backgroundIndex >= 0 && backgroundMask ? backgroundMask[i] === 255 : false

    // Cuantización opcional para logos crisp.
    // Por defecto queda DESACTIVADA porque en muchos logos con texto negro
    // termina metiendo contaminación (gris/anti-alias se mapea a rosa/cian).
    const useCrispQuantization = crispEdges && (process.env.WORKER_CRISP_QUANTIZE === '1')
    if (useCrispQuantization) {
      const paletteTarget = Math.max(2, Math.min(colors.length, 10))
      const quantized = await sharp(inputPath)
        .ensureAlpha()
        .png({ palette: true, colors: paletteTarget, dither: 0 })
        .raw()
        .toBuffer({ resolveWithObject: true })
      if (quantized.info.width === width && quantized.info.height === height) {
        const qChannels = quantized.info.channels
        const qData = Buffer.alloc(width * height * 3)
        for (let i = 0; i < width * height; i++) {
          qData[i * 3] = quantized.data[i * qChannels]
          qData[i * 3 + 1] = quantized.data[i * qChannels + 1]
          qData[i * 3 + 2] = quantized.data[i * qChannels + 2]
        }
        data = qData
      }
    }
    
    const masks: { color: string; maskPath: string; svgPath?: string; layers?: { color: string; svgPath: string }[] }[] = []
    let vectorSvg: { svgPath: string; layers: { color: string; svgPath: string }[] } | null = null
    const assignments = new Int16Array(width * height).fill(-1)
    const initialLabels = new Int16Array(width * height).fill(-1)
    const bestDistances = new Float32Array(width * height).fill(1e9)

    if (backgroundIndex >= 0 && backgroundMask) {
      for (let i = 0; i < assignments.length; i++) {
        if (backgroundMask[i] === 255) {
          assignments[i] = backgroundIndex
          initialLabels[i] = backgroundIndex
          bestDistances[i] = 0
        }
      }
    }

    // Slot "oscuro" (texto/runner): si la paleta ya incluye un negro/gris muy oscuro, reutilizarlo.
    // Esto evita crear una capa extra que no está en `dominantColors` (y rompe el preview/descarga por índice).
    const existingDarkIndex = guidedPalette.findIndex(c => {
      const { s, l } = rgbToHsl(c.r, c.g, c.b)
      return l < 0.2 && s < 0.25
    })
    const usesExtraDarkSlot = existingDarkIndex === -1
    const darkIndex = usesExtraDarkSlot ? guidedPalette.length : existingDarkIndex

    let workingMask: Buffer = silhouetteMask
    if (rawChannels === 4) {
      // Refina silueta con alpha real para evitar contaminar bordes con RGB de fondo transparente.
      const refined = Buffer.from(silhouetteMask)
      for (let i = 0; i < width * height; i++) {
        if (rawResult.data[i * rawChannels + 3] < 128) refined[i] = 0
      }
      workingMask = refined
    }

    const neighbors = [
      [-1, 0], [1, 0], [0, -1], [0, 1],
      [-1, -1], [1, -1], [-1, 1], [1, 1],
    ] as const

    // Crear una banda de borde usando una versión erosionada
    let interiorMask = workingMask
    if (width * height > 120_000) {
      interiorMask = await erodeMask(workingMask, width, height, 1)
      let interiorCount = 0
      let silhouetteCount = 0
      for (let i = 0; i < workingMask.length; i++) {
        if (workingMask[i] === 255 && !isBackground(i)) silhouetteCount++
        if (interiorMask[i] === 255 && !isBackground(i)) interiorCount++
      }
      if (interiorCount < silhouetteCount * 0.65) {
        interiorMask = workingMask
      }
    }

    const boundaryBand = new Uint8Array(width * height)
    if (interiorMask !== workingMask) {
      for (let i = 0; i < workingMask.length; i++) {
        if (workingMask[i] === 255 && interiorMask[i] === 0 && !isBackground(i)) boundaryBand[i] = 1
      }
    } else {
      for (let i = 0; i < workingMask.length; i++) {
        if (workingMask[i] !== 255 || isBackground(i)) continue
        const x = i % width
        const y = Math.floor(i / width)
        for (const [dx, dy] of neighbors) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
          const nidx = ny * width + nx
          if (workingMask[nidx] === 0 || isBackground(nidx)) {
            boundaryBand[i] = 1
            break
          }
        }
      }
    }

    // Para evitar halos por anti‑alias en el borde, podemos omitir el borde en la asignación
    // y rellenarlo después desde el interior (solo si hay suficiente interior).
    let silhouetteCount = 0
    let boundaryCount = 0
    for (let i = 0; i < workingMask.length; i++) {
      if (workingMask[i] === 255 && !isBackground(i)) silhouetteCount++
      if (boundaryBand[i] === 1 && !isBackground(i)) boundaryCount++
    }
    const interiorCount = Math.max(0, silhouetteCount - boundaryCount)
    // En logos "crisp" NO saltamos borde:
    // rellenar por mayoría introduce halos/contaminación.
    // En esos casos preferimos clasificar por color real del píxel.
    const skipBoundaryInAssignment = !crispEdges && interiorCount >= Math.max(200, Math.round(silhouetteCount * 0.45))

    if (skipBoundaryInAssignment) {
      const expandedBoundary = new Uint8Array(boundaryBand)
      const edgeRadius = crispEdges ? 1 : 0
      if (edgeRadius > 0) {
        for (let i = 0; i < boundaryBand.length; i++) {
          if (boundaryBand[i] !== 1) continue
          const x = i % width
          const y = Math.floor(i / width)
          for (let dy = -edgeRadius; dy <= edgeRadius; dy++) {
            for (let dx = -edgeRadius; dx <= edgeRadius; dx++) {
              const nx = x + dx
              const ny = y + dy
              if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
              const nidx = ny * width + nx
              if (workingMask[nidx] === 255 && !isBackground(nidx)) expandedBoundary[nidx] = 1
            }
          }
        }
      }
      boundaryBand.set(expandedBoundary)
    }

    const forcedDarkMask = new Uint8Array(width * height)
    if (crispEdges && darkIndex >= 0 && !strictVectorMode) {
      let forcedCount = 0
      for (let i = 0; i < width * height; i++) {
        if (workingMask[i] !== 255 || isBackground(i)) continue
        const r = data[i * 3]
        const g = data[i * 3 + 1]
        const b = data[i * 3 + 2]
        const { s, l } = rgbToHsl(r, g, b)
        const luminance = relativeLuminance(r, g, b)
        if (luminance < 78 || (s < 0.16 && l < 0.3)) {
          forcedDarkMask[i] = 1
          forcedCount++
        }
      }

      if (forcedCount > 0) {
        const darkSeed = Buffer.alloc(width * height)
        for (let i = 0; i < forcedDarkMask.length; i++) {
          darkSeed[i] = forcedDarkMask[i] === 1 ? 255 : 0
        }
        const dilated = await dilateMask(darkSeed, width, height, 1)
        for (let i = 0; i < dilated.length; i++) {
          if (dilated[i] !== 255) continue
          if (workingMask[i] !== 255 || isBackground(i)) continue
          const r = data[i * 3]
          const g = data[i * 3 + 1]
          const b = data[i * 3 + 2]
          const { s, l } = rgbToHsl(r, g, b)
          const luminance = relativeLuminance(r, g, b)
          if (s < 0.26 && l < 0.45 && luminance < 125) {
            forcedDarkMask[i] = 1
          }
        }
      }
    }

    const classifyPixel = (pixelIndex: number): number => {
      const r = data[pixelIndex * 3]
      const g = data[pixelIndex * 3 + 1]
      const b = data[pixelIndex * 3 + 2]
      const { s, l } = rgbToHsl(r, g, b)
      const luminance = relativeLuminance(r, g, b)

      if (isLikelyDarkPixel(r, g, b, crispEdges)) {
        bestDistances[pixelIndex] = 0
        return darkIndex
      }
      // Lock extra para negros/antialias de texto en logos crisp:
      // píxeles poco saturados y medios-oscuros deben quedarse en la capa oscura
      // en vez de contaminar rosa/cian.
      if (crispEdges && darkIndex >= 0) {
        const neutralDark =
          (s < 0.18 && luminance < 190) ||
          (s < 0.24 && luminance < 155) ||
          (luminance < 105)
        if (neutralDark) {
          bestDistances[pixelIndex] = 0
          return darkIndex
        }
      }

      if (guidedPalette.length === 0) return darkIndex

      let bestIdx = -1
      let bestDist = Infinity
      for (let cIdx = 0; cIdx < guidedPalette.length; cIdx++) {
        if (backgroundIndex >= 0 && cIdx === backgroundIndex) continue
        const c = guidedPalette[cIdx]
        let dist = redmeanDistance(r, g, b, c.r, c.g, c.b)
        if (cIdx === darkIndex) {
          const darkPenalty = crispEdges ? (s * 88 + l * 36) : (s * 90 + l * 40)
          dist += darkPenalty
        }
        if (dist < bestDist) {
          bestDist = dist
          bestIdx = cIdx
        }
      }

      if (usesExtraDarkSlot && darkIndex >= guidedPalette.length) {
        let darkDist = redmeanDistance(r, g, b, 0, 0, 0)
        const darkPenalty = crispEdges ? (s * 88 + l * 36) : (s * 90 + l * 40)
        darkDist += darkPenalty
        if (darkDist < bestDist) {
          bestDist = darkDist
          bestIdx = darkIndex
        }
      }

      if (bestIdx < 0) {
        bestDistances[pixelIndex] = 0
        return darkIndex
      }

      bestDistances[pixelIndex] = bestDist
      return bestIdx
    }

    // Asignar cada pixel dentro de la silueta al color más cercano.
    // En modo vector ya se asignó arriba; aquí solo si no es vectorMode.
    if (!vectorMode) {
      for (let i = 0; i < width * height; i++) {
        if (workingMask[i] !== 255 || isBackground(i)) continue
        if (forcedDarkMask[i] === 1) {
          initialLabels[i] = darkIndex
          assignments[i] = darkIndex
          bestDistances[i] = 0
          continue
        }
        const label = classifyPixel(i)
        initialLabels[i] = label
        if (crispEdges) {
          assignments[i] = label
          continue
        }
        if (skipBoundaryInAssignment && boundaryBand[i] === 1) continue
        assignments[i] = label
      }
    }

    // Propagación por semillas (solo no-crisp y no vector): en logos crisp introduce contaminación.
    if (!crispEdges && !vectorMode) {
      const seedThreshold = 20
      const queue = new Int32Array(assignments.length)
      let qh = 0
      let qt = 0

      for (let i = 0; i < assignments.length; i++) {
        if (workingMask[i] !== 255 || isBackground(i)) continue
        if (bestDistances[i] <= seedThreshold && initialLabels[i] >= 0) {
          assignments[i] = initialLabels[i]
          queue[qt++] = i
        } else {
          assignments[i] = -1
        }
      }

      if (qt === 0) {
        assignments.set(initialLabels)
      } else {
        while (qh < qt) {
          const idx = queue[qh++]
          const x = idx % width
          const y = Math.floor(idx / width)
          for (const [dx, dy] of neighbors) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
            const nidx = ny * width + nx
            if (workingMask[nidx] !== 255 || isBackground(nidx)) continue
            if (assignments[nidx] >= 0) continue
            const targetLabel = assignments[idx]
            const initialLabel = initialLabels[nidx]
            if (initialLabel === targetLabel) {
              assignments[nidx] = targetLabel
              queue[qt++] = nidx
              continue
            }

            // Solo permitir que el negro se propague a píxeles realmente oscuros/desaturados.
            if (targetLabel === darkIndex) {
              const r = data[nidx * 3]
              const g = data[nidx * 3 + 1]
              const b = data[nidx * 3 + 2]
              const { s, l } = rgbToHsl(r, g, b)
              if (s <= 0.25 && l <= 0.55) {
                assignments[nidx] = targetLabel
                queue[qt++] = nidx
              }
            }
          }
        }

        // Rellenar huecos restantes con el label inicial
        for (let i = 0; i < assignments.length; i++) {
          if (workingMask[i] !== 255 || isBackground(i)) continue
          if (assignments[i] >= 0) continue
          assignments[i] = initialLabels[i]
        }

        // No dejar que la propagacion sobrescriba pixeles con color confiable.
        const preserveThreshold = seedThreshold + 6
        for (let i = 0; i < assignments.length; i++) {
          if (workingMask[i] !== 255 || isBackground(i)) continue
          if (bestDistances[i] <= preserveThreshold) {
            assignments[i] = initialLabels[i]
          }
        }
      }
    }

    // Expandir ligeramente la capa oscura para absorber el anti‑aliasing de textos/contornos
    // En logos con pocos colores (crispEdges), esto puede engrosar bordes y generar halos.
    if (!crispEdges && darkIndex >= 0) {
      const darkPixels: number[] = []
      for (let i = 0; i < assignments.length; i++) {
        if (assignments[i] === darkIndex && !isBackground(i)) darkPixels.push(i)
      }

      const minDarkPixels = Math.max(80, Math.round(width * height * 0.0002))
      if (darkPixels.length >= minDarkPixels) {
        const expanded = new Uint8Array(width * height)
        const maxDim = Math.max(width, height)
        const radius = maxDim > 1200 ? 2 : 1

        for (const idx of darkPixels) {
          const x = idx % width
          const y = Math.floor(idx / width)
          for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
              const nx = x + dx
              const ny = y + dy
              if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
              const nidx = ny * width + nx
              expanded[nidx] = 1
            }
          }
        }

        for (let i = 0; i < expanded.length; i++) {
          if (expanded[i] === 1 && workingMask[i] === 255 && !isBackground(i)) {
            assignments[i] = darkIndex
          }
        }
      }
    }

    // Captura de anti-alias oscuro solo en no-crisp; en logos crisp produce halos/contaminación.
    if (!crispEdges && darkIndex >= 0) {
      const darkSeed = Buffer.alloc(width * height)
      let darkSeedCount = 0
      for (let i = 0; i < assignments.length; i++) {
        if (assignments[i] === darkIndex && !isBackground(i)) {
          darkSeed[i] = 255
          darkSeedCount++
        }
      }
      const minDarkSeeds = Math.max(40, Math.round(width * height * 0.00015))
      if (darkSeedCount >= minDarkSeeds) {
        const dilated = await dilateMask(darkSeed, width, height, 1)
        for (let i = 0; i < dilated.length; i++) {
          if (dilated[i] !== 255) continue
          if (assignments[i] === darkIndex || isBackground(i)) continue
          const r = data[i * 3]
          const g = data[i * 3 + 1]
          const b = data[i * 3 + 2]
          const { s, l } = rgbToHsl(r, g, b)
          if (s <= 0.28 && l <= 0.65) {
            assignments[i] = darkIndex
          }
        }
      }
    }

    // Limpieza adicional para logos crisp: reetiquetar píxeles de baja confianza por mayoría local
    // (solo si no se uso propagación por semillas)
    if (!crispEdges) {
      const threshold1 = 28
      const radius1 = 2
      const next = new Int16Array(assignments)
      for (let i = 0; i < assignments.length; i++) {
        if (workingMask[i] !== 255 || isBackground(i)) continue
        if (bestDistances[i] <= threshold1) continue
        const x = i % width
        const y = Math.floor(i / width)
        const counts = new Map<number, number>()
        for (let dy = -radius1; dy <= radius1; dy++) {
          for (let dx = -radius1; dx <= radius1; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
            const nidx = ny * width + nx
            if (workingMask[nidx] !== 255 || isBackground(nidx)) continue
            const label = assignments[nidx]
            if (label >= 0 && bestDistances[nidx] < threshold1) {
              counts.set(label, (counts.get(label) || 0) + 1)
            }
          }
        }
        if (counts.size === 0) continue
        let bestLabel = -1
        let bestCount = -1
        for (const [label, count] of counts.entries()) {
          if (count > bestCount) {
            bestCount = count
            bestLabel = label
          }
        }
        if (bestLabel >= 0 && bestCount >= 3) {
          next[i] = bestLabel
          bestDistances[i] = threshold1 - 1
        }
      }
      assignments.set(next)

      // Pase 2: solo bordes, tolera vecinos con distancia un poco mayor
      const threshold2 = 34
      const radius2 = 1
      const next2 = new Int16Array(assignments)
      for (let i = 0; i < assignments.length; i++) {
        if (workingMask[i] !== 255 || isBackground(i)) continue
        if (boundaryBand[i] !== 1) continue
        if (bestDistances[i] <= threshold2) continue
        const x = i % width
        const y = Math.floor(i / width)
        const counts = new Map<number, number>()
        for (let dy = -radius2; dy <= radius2; dy++) {
          for (let dx = -radius2; dx <= radius2; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
            const nidx = ny * width + nx
            if (workingMask[nidx] !== 255 || isBackground(nidx)) continue
            const label = assignments[nidx]
            if (label >= 0) counts.set(label, (counts.get(label) || 0) + 1)
          }
        }
        if (counts.size === 0) continue
        let bestLabel = -1
        let bestCount = -1
        for (const [label, count] of counts.entries()) {
          if (count > bestCount) {
            bestCount = count
            bestLabel = label
          }
        }
        if (bestLabel >= 0 && bestCount >= 4) {
          next2[i] = bestLabel
          bestDistances[i] = threshold1 - 2
        }
      }
      assignments.set(next2)
    }

    // Pase extra eliminado (ya cubierto por los dos pases crisp anteriores)

    // Rellenar píxeles del borde externo que NO fueron asignados (assignments=-1)
    // Solo rellenar huecos, NO sobrescribir asignaciones correctas que ya tienen color real.
    const radius = Math.max(1, Math.round(Math.max(width, height) / 1200))
    const boundaryConfidence = crispEdges ? 22 : 18
    for (let i = 0; i < boundaryBand.length; i++) {
      if (boundaryBand[i] !== 1) continue
      if (assignments[i] >= 0 || isBackground(i)) continue  // Ya tiene asignación correcta, no sobrescribir
      if (bestDistances[i] <= boundaryConfidence && initialLabels[i] >= 0) {
        assignments[i] = initialLabels[i]
        continue
      }
      if (crispEdges) {
        assignments[i] = classifyPixel(i)
      } else {
        const x = i % width
        const y = Math.floor(i / width)
        const counts = new Map<number, number>()
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
            const nidx = ny * width + nx
            if (isBackground(nidx)) continue
            const a = assignments[nidx]
            if (a >= 0) {
              counts.set(a, (counts.get(a) || 0) + 1)
            }
          }
        }
        if (counts.size > 0) {
          let bestIdx = -1
          let bestCount = -1
          for (const [idx, count] of counts.entries()) {
            if (count > bestCount) {
              bestCount = count
              bestIdx = idx
            }
          }
          if (bestIdx >= 0) assignments[i] = bestIdx
        } else {
          assignments[i] = classifyPixel(i)
        }
      }
    }

    // Fallback global: si quedó algún pixel de silueta sin etiqueta, asignarlo por mayoría vecina.
    // Evita micro-huecos que luego aparecen como "mordidas" en el 3D.
    const fallbackConfidence = crispEdges ? 20 : 16
    for (let i = 0; i < assignments.length; i++) {
      if (workingMask[i] !== 255 || isBackground(i)) continue
      if (assignments[i] >= 0) continue
      if (bestDistances[i] <= fallbackConfidence && initialLabels[i] >= 0) {
        assignments[i] = initialLabels[i]
        continue
      }
      if (crispEdges) {
        assignments[i] = classifyPixel(i)
      } else {
        const x = i % width
        const y = Math.floor(i / width)
        const counts = new Map<number, number>()
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
            const nidx = ny * width + nx
            if (isBackground(nidx)) continue
            const label = assignments[nidx]
            if (label >= 0) counts.set(label, (counts.get(label) || 0) + 1)
          }
        }
        if (counts.size > 0) {
          let bestLabel = -1
          let bestCount = -1
          for (const [label, count] of counts.entries()) {
            if (count > bestCount) {
              bestCount = count
              bestLabel = label
            }
          }
          if (bestLabel >= 0) assignments[i] = bestLabel
        } else {
          assignments[i] = classifyPixel(i)
        }
      }
    }

    // Refinamiento crisp para negro real:
    // - prioriza negro en bordes anti-alias cercanos a núcleo oscuro (evita halos rosa/cian)
    // - pero evita que negro invada zonas vivas (azul/rosa) fuera del halo
    if (crispEdges && darkIndex >= 0 && existingDarkIndex >= 0 && !strictVectorMode) {
      const darkColor = guidedPalette[darkIndex]
      const darkCore = Buffer.alloc(width * height)

      for (let i = 0; i < width * height; i++) {
        if (workingMask[i] !== 255 || isBackground(i)) continue
        const r = data[i * 3]
        const g = data[i * 3 + 1]
        const b = data[i * 3 + 2]
        const { s, l } = rgbToHsl(r, g, b)
        const lum = relativeLuminance(r, g, b)
        if (forcedDarkMask[i] === 1 || lum < 70 || (s < 0.12 && l < 0.2)) {
          darkCore[i] = 255
        }
      }

      const darkHalo = await dilateMask(darkCore, width, height, 2)
      let movedToDark = 0
      let movedFromDark = 0

      for (let i = 0; i < assignments.length; i++) {
        if (workingMask[i] !== 255 || isBackground(i)) continue
        const currentIdx = assignments[i]
        if (currentIdx < 0) continue

        const r = data[i * 3]
        const g = data[i * 3 + 1]
        const b = data[i * 3 + 2]
        const { s, l } = rgbToHsl(r, g, b)
        const lum = relativeLuminance(r, g, b)

        const distDark = redmeanDistance(r, g, b, darkColor.r, darkColor.g, darkColor.b)
        let bestNonDarkIdx = -1
        let bestNonDarkDist = Infinity
        for (let cIdx = 0; cIdx < guidedPalette.length; cIdx++) {
          if (cIdx === darkIndex || cIdx === backgroundIndex) continue
          const c = guidedPalette[cIdx]
          const dist = redmeanDistance(r, g, b, c.r, c.g, c.b)
          if (dist < bestNonDarkDist) {
            bestNonDarkDist = dist
            bestNonDarkIdx = cIdx
          }
        }

        if (currentIdx !== darkIndex) {
          if (bestNonDarkIdx < 0) continue
          const inDarkHalo = darkHalo[i] === 255
          const currentColor = currentIdx >= 0 && currentIdx < guidedPalette.length
            ? guidedPalette[currentIdx]
            : null
          const currentDist = currentColor
            ? redmeanDistance(r, g, b, currentColor.r, currentColor.g, currentColor.b)
            : bestNonDarkDist
          const shouldBeDark =
            (s < 0.28 && lum < 170) ||
            (inDarkHalo && s < 0.68 && lum < 235 && distDark <= bestNonDarkDist + 95) ||
            (inDarkHalo && s < 0.72 && lum < 238 && distDark <= currentDist + 26) ||
            (s < 0.24 && lum < 170 && distDark <= bestNonDarkDist + 34) ||
            (s < 0.3 && lum < 178 && distDark <= bestNonDarkDist + 42) ||
            (lum < 92 && distDark <= bestNonDarkDist + 40) ||
            (distDark + 14 < bestNonDarkDist && lum < 165)
          if (shouldBeDark) {
            assignments[i] = darkIndex
            bestDistances[i] = Math.min(bestDistances[i], distDark)
            movedToDark++
          }
          continue
        }

        if (bestNonDarkIdx < 0) continue
        const outsideDarkHalo = darkHalo[i] === 0
        const isVeryVividColor = s > 0.78 && l > 0.45 && lum > 170
        const preserveAsDark = isLikelyDarkPixel(r, g, b, crispEdges) || (s < 0.2 && lum < 185)
        if (!preserveAsDark && outsideDarkHalo && isVeryVividColor && bestNonDarkDist + 32 < distDark) {
          assignments[i] = bestNonDarkIdx
          bestDistances[i] = Math.min(bestDistances[i], bestNonDarkDist)
          movedFromDark++
        }
      }

      logger.info(
        `[${jobId}] Crisp dark refinement moved ${movedToDark} to dark and ${movedFromDark} from dark`
      )
    }

    // Limpieza de contaminación en borde para logos crisp:
    // reetiqueta píxeles pastel/ambiguos del borde por mayoría local no-oscura.
    if (crispEdges && !strictVectorMode) {
      const next = new Int16Array(assignments)
      let movedByEdgeVote = 0

      for (let i = 0; i < assignments.length; i++) {
        if (workingMask[i] !== 255 || isBackground(i)) continue
        if (boundaryBand[i] !== 1) continue
        const current = assignments[i]
        if (current < 0 || current === darkIndex || current === backgroundIndex) continue
        if (current >= guidedPalette.length) continue

        const r = data[i * 3]
        const g = data[i * 3 + 1]
        const b = data[i * 3 + 2]
        const { s } = rgbToHsl(r, g, b)
        const lum = relativeLuminance(r, g, b)

        // Solo anti-alias/pastel del borde
        if (!(s < 0.52 && lum > 105)) continue

        const x = i % width
        const y = Math.floor(i / width)
        const counts = new Map<number, number>()

        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
            const nidx = ny * width + nx
            if (workingMask[nidx] !== 255 || isBackground(nidx)) continue
            const label = assignments[nidx]
            if (label < 0 || label === darkIndex || label === backgroundIndex) continue
            if (label >= guidedPalette.length) continue
            counts.set(label, (counts.get(label) || 0) + 1)
          }
        }

        if (counts.size === 0) continue
        const sameCount = counts.get(current) || 0
        let bestLabel = current
        let bestCount = sameCount
        for (const [label, count] of counts.entries()) {
          if (count > bestCount) {
            bestCount = count
            bestLabel = label
          }
        }
        if (bestLabel === current || bestCount < 8 || sameCount > 4) continue

        const currentColor = guidedPalette[current]
        const bestColor = guidedPalette[bestLabel]
        if (!currentColor || !bestColor) continue

        const currentDist = redmeanDistance(r, g, b, currentColor.r, currentColor.g, currentColor.b)
        const bestDist = redmeanDistance(r, g, b, bestColor.r, bestColor.g, bestColor.b)
        if (bestDist <= currentDist + 24) {
          next[i] = bestLabel
          movedByEdgeVote++
        }
      }

      if (movedByEdgeVote > 0) {
        assignments.set(next)
        logger.info(`[${jobId}] Crisp edge vote reassigned ${movedByEdgeVote} boundary pixels`)
      }
    }

    let keepExtraDarkLayer = usesExtraDarkSlot
    if (usesExtraDarkSlot && darkIndex >= 0) {
      let darkPixels = 0
      for (let i = 0; i < assignments.length; i++) {
        if (assignments[i] === darkIndex && !isBackground(i)) darkPixels++
      }

      const darkRatio = darkPixels / Math.max(1, silhouetteCount)
      const minDarkPixels = crispEdges
        ? Math.max(50, Math.round(silhouetteCount * 0.0003))
        : Math.max(40, Math.round(silhouetteCount * 0.002))
      keepExtraDarkLayer = darkPixels >= minDarkPixels

      if (!keepExtraDarkLayer && guidedPalette.length > 0) {
        for (let i = 0; i < assignments.length; i++) {
          if (assignments[i] !== darkIndex || isBackground(i)) continue
          let bestIdx = 0
          let bestDist = Infinity
          const r = data[i * 3]
          const g = data[i * 3 + 1]
          const b = data[i * 3 + 2]
          for (let cIdx = 0; cIdx < guidedPalette.length; cIdx++) {
            const c = guidedPalette[cIdx]
            const dist = redmeanDistance(r, g, b, c.r, c.g, c.b)
            if (dist < bestDist) {
              bestDist = dist
              bestIdx = cIdx
            }
          }
          assignments[i] = bestIdx
        }
        logger.info(
          `[${jobId}] Ignoring extra dark layer (noise): ${darkPixels} pixels (${(darkRatio * 100).toFixed(2)}%)`
        )
      }
    }

    // Limpiar islotes mínimos por color para evitar "chispas" de color (ej. bordes rosados sueltos).
    const labelCount = guidedPalette.length + (usesExtraDarkSlot ? 1 : 0)
    const minIslandArea = crispEdges
      ? Math.max(12, Math.round(width * height * 0.00001))
      : Math.max(10, Math.round(width * height * 0.000008))
    const minIslandAreaCrispNonDark = Math.max(50, Math.round(width * height * 0.00005))
    const minIslandAreaCrispDark = Math.max(10, Math.round(width * height * 0.000008))
    if (labelCount > 1) {
      const visited = new Uint8Array(assignments.length)
      const queue = new Int32Array(assignments.length)
      for (let start = 0; start < assignments.length; start++) {
        if (workingMask[start] !== 255 || isBackground(start)) continue
        if (visited[start] === 1) continue
        const label = assignments[start]
        if (label < 0) continue

        let qh = 0
        let qt = 0
        queue[qt++] = start
        visited[start] = 1
        const component: number[] = []
        const borderCounts = new Map<number, number>()

        while (qh < qt) {
          const idx = queue[qh++]
          component.push(idx)
          const x = idx % width
          const y = Math.floor(idx / width)

          for (const [dx, dy] of neighbors) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
            const nidx = ny * width + nx
            if (workingMask[nidx] !== 255 || isBackground(nidx)) continue
            const nLabel = assignments[nidx]
            if (nLabel === label) {
              if (visited[nidx] === 0) {
                visited[nidx] = 1
                queue[qt++] = nidx
              }
            } else if (nLabel >= 0) {
              borderCounts.set(nLabel, (borderCounts.get(nLabel) || 0) + 1)
            }
          }
        }

        const isDarkComponent = darkIndex >= 0 && label === darkIndex
        const componentMinArea = crispEdges
          ? (isDarkComponent ? minIslandAreaCrispDark : minIslandAreaCrispNonDark)
          : minIslandArea
        if (component.length >= componentMinArea) continue
        let replacement = -1
        let bestCount = -1
        for (const [nLabel, count] of borderCounts.entries()) {
          if (count > bestCount) {
            bestCount = count
            replacement = nLabel
          }
        }
        if (replacement >= 0 && replacement !== label) {
          for (const idx of component) assignments[idx] = replacement
        }
      }
    }

    // Suavizado de etiquetas SOLO en los bordes entre colores
    const labelBoundary = new Uint8Array(width * height)
    for (let i = 0; i < assignments.length; i++) {
      if (workingMask[i] !== 255 || isBackground(i)) continue
      const current = assignments[i]
      if (current < 0) continue
      const x = i % width
      const y = Math.floor(i / width)
      for (const [dx, dy] of neighbors) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const nidx = ny * width + nx
        const other = isBackground(nidx) ? -1 : assignments[nidx]
        if (other >= 0 && other !== current) {
          labelBoundary[i] = 1
          break
        }
      }
    }

    const smoothIterations = crispEdges ? 0 : 1
    for (let iter = 0; iter < smoothIterations; iter++) {
      const next = new Int16Array(assignments)
      for (let i = 0; i < labelBoundary.length; i++) {
        if (labelBoundary[i] !== 1) continue
        if (workingMask[i] !== 255 || isBackground(i)) continue
        const x = i % width
        const y = Math.floor(i / width)
        const counts = new Map<number, number>()
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
            const nidx = ny * width + nx
            const a = isBackground(nidx) ? -1 : assignments[nidx]
            if (a >= 0) counts.set(a, (counts.get(a) || 0) + 1)
          }
        }
        if (counts.size > 0) {
          let bestIdx = -1
          let bestCount = -1
          for (const [idx, count] of counts.entries()) {
            if (count > bestCount) {
              bestCount = count
              bestIdx = idx
            }
          }
          if (bestIdx >= 0 && bestCount >= 5) next[i] = bestIdx
        }
      }
      assignments.set(next)
    }

    const TARGET_MAX_SIZE = 2200
    const crispMinSize = Math.max(1400, Number(process.env.WORKER_CRISP_MIN_SIZE ?? '2000'))
    const TARGET_MIN_SIZE = crispEdges ? crispMinSize : 1000
    const maxDim = Math.max(width, height)
    let scale = 1
    if (maxDim > TARGET_MAX_SIZE) {
      scale = TARGET_MAX_SIZE / maxDim
    } else if (maxDim < TARGET_MIN_SIZE) {
      scale = TARGET_MIN_SIZE / maxDim
      scale = Math.min(3, scale)
    }
    const targetWidth = Math.max(1, Math.round(width * scale))
    const targetHeight = Math.max(1, Math.round(height * scale))

    // Construir buffers por color guiado
    const buildMask = async (colorIdx: number, colorHex: string, maskIndex: number, pixels: number[]) => {
      let maskBuffer: Buffer = Buffer.alloc(width * height)
      for (const pix of pixels) maskBuffer[pix] = 255

      // Limpieza de máscara para evitar "speckles" (ruido) que Potrace convierte en miles de islitas
      // y luego se ven como puntitos/ruido en el 3D.
      // Nota: hacemos la limpieza ANTES del resize para mantener el costo bajo.
      const MAX_OPTIMIZE_PIXELS = 1_200_000
      if (width * height <= MAX_OPTIMIZE_PIXELS) {
        maskBuffer = await optimizeMaskForPotrace(maskBuffer, width, height, jobId)
      }

      // Eliminar componentes minúsculos (cuadritos/ruido)
      const minArea = Math.max(20, Math.round(width * height * 0.00002))
      maskBuffer = removeSmallComponents(maskBuffer, width, height, minArea)
      const resizedBuffer = await resizeBinaryMask(
        maskBuffer,
        width,
        height,
        targetWidth,
        targetHeight,
        crispEdges
      )
      const pgmHeader = `P5\n${targetWidth} ${targetHeight}\n255\n`
      const pgmData = Buffer.concat([
        Buffer.from(pgmHeader, 'ascii'),
        resizedBuffer
      ])
      const maskPath = path.join(
        storagePath,
        'processed',
        `${jobId}_color${maskIndex}_mask.pgm`
      )
      await fs.writeFile(maskPath, pgmData)
      masks.push({ color: colorHex, maskPath })
      logger.info(`[${jobId}] Mask ${maskIndex} (${colorHex}) pixels: ${pixels.length}`)
    }

    // Agrupar píxeles por asignación
    const bucketCount = guidedPalette.length + (usesExtraDarkSlot ? 1 : 0)
    const pixelBuckets: number[][] = Array.from({ length: bucketCount }, () => [])
    for (let i = 0; i < assignments.length; i++) {
      const idx = assignments[i]
      if (idx >= 0) pixelBuckets[idx].push(i)
    }

    // Para logos con pocos colores, crear máscaras desde un label map redimensionado
    // Esto evita solapamientos o huecos entre máscaras al redimensionar cada color por separado.
    if (crispEdges) {
      const labelBuffer = Buffer.alloc(width * height)
      for (let i = 0; i < assignments.length; i++) {
        const idx = assignments[i]
        if (idx >= 0) labelBuffer[i] = idx + 1
      }

      let labelData: Buffer
      let outWidth = width
      let outHeight = height

      if (targetWidth !== width || targetHeight !== height) {
        labelData = await resizeSingleChannelNearest(
          labelBuffer,
          width,
          height,
          targetWidth,
          targetHeight
        )
        outWidth = targetWidth
        outHeight = targetHeight
      } else {
        labelData = Buffer.from(labelBuffer)
      }

      const canUseDarkLabelCleanup =
        darkIndex >= 0 &&
        darkIndex < bucketCount &&
        (keepExtraDarkLayer || !usesExtraDarkSlot)
      if (canUseDarkLabelCleanup && !strictVectorMode) {
        const darkLabel = darkIndex + 1
        const nextLabels = Buffer.from(labelData)
        let movedToDarkByNeighborhood = 0

        for (let i = 0; i < labelData.length; i++) {
          const current = labelData[i]
          if (current === 0 || current === darkLabel) continue

          const x = i % outWidth
          const y = Math.floor(i / outWidth)
          let darkNeighbors = 0
          let sameNeighbors = 0
          let solidNeighbors = 0

          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const nx = x + dx
              const ny = y + dy
              if (nx < 0 || nx >= outWidth || ny < 0 || ny >= outHeight) continue
              const nidx = ny * outWidth + nx
              const nLabel = labelData[nidx]
              if (nLabel === 0) continue
              solidNeighbors++
              if (nLabel === darkLabel) darkNeighbors++
              if (nLabel === current) sameNeighbors++
            }
          }

          if (solidNeighbors >= 10 && darkNeighbors >= 14 && sameNeighbors <= 6) {
            nextLabels[i] = darkLabel
            movedToDarkByNeighborhood++
          }
        }

        if (movedToDarkByNeighborhood > 0) {
          labelData = nextLabels
          logger.info(
            `[${jobId}] Crisp neighborhood dark cleanup moved ${movedToDarkByNeighborhood} pixels to dark`
          )
        }
      }

      const canUseDark = darkIndex >= 0 && darkIndex < bucketCount && (keepExtraDarkLayer || !usesExtraDarkSlot)
      const aggressiveDarkCleanup = process.env.WORKER_AGGRESSIVE_DARK_CLEANUP === '1'
      const nonDarkIslandArea = strictVectorMode
        ? Math.max(8, Math.round(outWidth * outHeight * 0.000004))
        : Math.max(36, Math.round(outWidth * outHeight * 0.00002))
      const darkIslandArea = strictVectorMode
        ? Math.max(4, Math.round(outWidth * outHeight * 0.000002))
        : Math.max(10, Math.round(outWidth * outHeight * 0.000005))
      const darkLabel = canUseDark ? darkIndex + 1 : -1
      labelData = cleanupSmallLabelIslands(
        labelData,
        outWidth,
        outHeight,
        nonDarkIslandArea,
        darkLabel,
        darkIslandArea
      )

      let resizedRgb: { data: Buffer; info: sharp.OutputInfo } | null = null
      if (crispEdges && canUseDark) {
        resizedRgb = await sharp(inputPath)
          .resize(outWidth, outHeight, { fit: 'fill', kernel: 'lanczos3' })
          .raw()
          .toBuffer({ resolveWithObject: true })
      }

      // Override oscuro en resolución final (antes de construir máscaras):
      // reduce contaminación rosa/cian en bordes negros anti-alias.
      if (aggressiveDarkCleanup && crispEdges && canUseDark && resizedRgb && existingDarkIndex >= 0 && !strictVectorMode) {
        const rgbData = resizedRgb.data
        const rgbChannels = resizedRgb.info.channels
        const darkColor = guidedPalette[darkIndex]
        const darkLabel = darkIndex + 1
        const darkCore = Buffer.alloc(labelData.length)
        for (let i = 0; i < labelData.length; i++) {
          if (labelData[i] !== darkLabel) continue
          const idx = i * rgbChannels
          const r = rgbData[idx]
          const g = rgbData[idx + 1]
          const b = rgbData[idx + 2]
          const { s, l } = rgbToHsl(r, g, b)
          const lum = relativeLuminance(r, g, b)
          if (lum < 74 || (s < 0.16 && l < 0.24)) darkCore[i] = 255
        }
        const darkHalo = await dilateMask(darkCore, outWidth, outHeight, 3)
        let movedToDark = 0

        for (let i = 0; i < labelData.length; i++) {
          const current = labelData[i]
          if (current === 0 || current === darkLabel) continue
          if (backgroundIndex >= 0 && current === backgroundIndex + 1) continue

          const idx = i * rgbChannels
          const r = rgbData[idx]
          const g = rgbData[idx + 1]
          const b = rgbData[idx + 2]
          const { s, l } = rgbToHsl(r, g, b)
          const lum = relativeLuminance(r, g, b)
          const currentIdx = current - 1
          const currentColor =
            currentIdx >= 0 && currentIdx < guidedPalette.length
              ? guidedPalette[currentIdx]
              : null

          let bestNonDarkDist = Infinity
          for (let cIdx = 0; cIdx < guidedPalette.length; cIdx++) {
            if (cIdx === darkIndex || cIdx === backgroundIndex) continue
            const c = guidedPalette[cIdx]
            const dist = redmeanDistance(r, g, b, c.r, c.g, c.b)
            if (dist < bestNonDarkDist) bestNonDarkDist = dist
          }
          const distDark = redmeanDistance(r, g, b, darkColor.r, darkColor.g, darkColor.b)
          const inDarkHalo = darkHalo[i] === 255
          const currentDist = currentColor
            ? redmeanDistance(r, g, b, currentColor.r, currentColor.g, currentColor.b)
            : bestNonDarkDist

          const shouldBeDark =
            (lum < 104 && s < 0.48) ||
            (s < 0.16 && lum < 210 && distDark <= bestNonDarkDist + 60) ||
            (s < 0.24 && lum < 232 && distDark <= bestNonDarkDist + 72) ||
            (inDarkHalo && s < 0.68 && lum < 235 && distDark <= bestNonDarkDist + 96) ||
            (inDarkHalo && s < 0.72 && lum < 238 && distDark <= currentDist + 26) ||
            (s < 0.3 && lum < 185) ||
            (s < 0.22 && l < 0.78 && distDark <= bestNonDarkDist + 42) ||
            (distDark + 10 < bestNonDarkDist)

          if (shouldBeDark) {
            labelData[i] = darkLabel
            movedToDark++
          }
        }

        if (movedToDark > 0) {
          logger.info(`[${jobId}] Crisp final dark override moved ${movedToDark} pixels to dark`)
        }
      }

      const targetPixels = outWidth * outHeight
      const maskBuffers: Buffer[] = Array.from({ length: bucketCount }, () => Buffer.alloc(targetPixels))
      const counts = new Array(bucketCount).fill(0)

      for (let i = 0; i < targetPixels; i++) {
        const label = labelData[i]
        if (label > 0 && label - 1 < bucketCount) {
          const bucket = label - 1
          maskBuffers[bucket][i] = 255
          counts[bucket]++
        }
      }

      // Refinamiento conservador del oscuro:
      // - evita que el negro invada colores vivos
      // - pero mantiene negro en contornos/texto donde realmente hay señal oscura.
      const shouldRefineDarkLock =
        aggressiveDarkCleanup &&
        crispEdges &&
        canUseDark &&
        counts[darkIndex] > 0 &&
        resizedRgb &&
        existingDarkIndex === -1 &&
        !strictVectorMode
      if (shouldRefineDarkLock && resizedRgb) {
        const rgbData = resizedRgb.data
        const rgbChannels = resizedRgb.info.channels
        const darkMask = maskBuffers[darkIndex]
        const darkColor =
          darkIndex >= 0 && darkIndex < guidedPalette.length
            ? guidedPalette[darkIndex]
            : { r: 0, g: 0, b: 0 }

        const darkCore = Buffer.alloc(targetPixels)
        for (let i = 0; i < targetPixels; i++) {
          if (darkMask[i] !== 255) continue
          const idx = i * rgbChannels
          const r = rgbData[idx]
          const g = rgbData[idx + 1]
          const b = rgbData[idx + 2]
          const { s, l } = rgbToHsl(r, g, b)
          const lum = relativeLuminance(r, g, b)
          if (lum < 70 || (s < 0.12 && l < 0.22)) {
            darkCore[i] = 255
          }
        }
        const darkNeighborhood = await dilateMask(darkCore, outWidth, outHeight, 1)

        const nearestNonDark = (r: number, g: number, b: number) => {
          let bestIdx = -1
          let bestDist = Infinity
          for (let cIdx = 0; cIdx < guidedPalette.length; cIdx++) {
            if (cIdx === darkIndex || cIdx === backgroundIndex) continue
            const c = guidedPalette[cIdx]
            const dist = redmeanDistance(r, g, b, c.r, c.g, c.b)
            if (dist < bestDist) {
              bestDist = dist
              bestIdx = cIdx
            }
          }
          return { bestIdx, bestDist }
        }

        let movedFromDark = 0
        let movedToDark = 0
        for (let i = 0; i < targetPixels; i++) {
          if (backgroundIndex >= 0 && maskBuffers[backgroundIndex]?.[i] === 255) continue
          const idx = i * rgbChannels
          const r = rgbData[idx]
          const g = rgbData[idx + 1]
          const b = rgbData[idx + 2]
          const { s, l } = rgbToHsl(r, g, b)
          const lum = relativeLuminance(r, g, b)
          const darkDist = redmeanDistance(r, g, b, darkColor.r, darkColor.g, darkColor.b)
          const { bestIdx, bestDist } = nearestNonDark(r, g, b)
          const darkLikely =
            isLikelyDarkPixel(r, g, b, true) ||
            (lum < 118 && s < 0.22 && l < 0.42)
          const nearDarkCore = darkNeighborhood[i] === 255

          if (darkMask[i] === 255) {
            if (!darkLikely && !nearDarkCore && bestIdx >= 0 && bestDist + 10 < darkDist) {
              darkMask[i] = 0
              maskBuffers[bestIdx][i] = 255
              counts[darkIndex]--
              counts[bestIdx]++
              movedFromDark++
            }
            continue
          }

          if (bestIdx < 0) continue
          if (darkLikely && nearDarkCore && darkDist <= bestDist + 16) {
            maskBuffers[bestIdx][i] = 0
            darkMask[i] = 255
            counts[bestIdx]--
            counts[darkIndex]++
            movedToDark++
          }
        }

        logger.info(`[${jobId}] Dark lock refinement moved ${movedFromDark} from dark and ${movedToDark} to dark`)
      }

      // Dominancia oscura de borde:
      // expande 1px el negro en zonas no-vivas para eliminar halo rosa/cian junto a trazos negros.
      if (
        aggressiveDarkCleanup &&
        crispEdges &&
        canUseDark &&
        resizedRgb &&
        existingDarkIndex >= 0 &&
        counts[darkIndex] > 0 &&
        !strictVectorMode
      ) {
        const rgbData = resizedRgb.data
        const rgbChannels = resizedRgb.info.channels
        const darkMask = maskBuffers[darkIndex]
        const darkExpanded = await dilateMask(darkMask, outWidth, outHeight, 2)
        let movedToDarkEdge = 0

        for (let i = 0; i < targetPixels; i++) {
          if (darkExpanded[i] !== 255) continue
          const label = labelData[i]
          if (label === 0) continue
          if (backgroundIndex >= 0 && label === backgroundIndex + 1) continue

          const idx = i * rgbChannels
          const r = rgbData[idx]
          const g = rgbData[idx + 1]
          const b = rgbData[idx + 2]
          const { s } = rgbToHsl(r, g, b)
          const lum = relativeLuminance(r, g, b)

          // Solo anti-alias / borde tenue
          if (!(lum < 220 && s < 0.72)) continue

          // Debe tocar negro real (núcleo), no solo halo expandido,
          // para no invadir interiores de letras/figuras.
          const x = i % outWidth
          const y = Math.floor(i / outWidth)
          let touchesDarkCore = false
          for (let dy = -1; dy <= 1 && !touchesDarkCore; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue
              const nx = x + dx
              const ny = y + dy
              if (nx < 0 || nx >= outWidth || ny < 0 || ny >= outHeight) continue
              const nidx = ny * outWidth + nx
              if (darkMask[nidx] === 255) {
                touchesDarkCore = true
                break
              }
            }
          }
          if (!touchesDarkCore) continue

          if (darkMask[i] !== 255) {
            darkMask[i] = 255
            counts[darkIndex]++
            movedToDarkEdge++
          }

          for (let cIdx = 0; cIdx < guidedPalette.length; cIdx++) {
            if (cIdx === darkIndex || cIdx === backgroundIndex) continue
            if (maskBuffers[cIdx][i] === 255) {
              maskBuffers[cIdx][i] = 0
              counts[cIdx] = Math.max(0, counts[cIdx] - 1)
            }
          }
        }

        if (movedToDarkEdge > 0) {
          logger.info(`[${jobId}] Crisp dark edge dominance moved ${movedToDarkEdge} pixels to dark`)
        }
      }

      // Pase extra de limpieza en halo oscuro:
      // si un píxel no-oscuro cae en vecindad inmediata del negro y es poco saturado,
      // se reasigna a negro para eliminar contaminación rosa/cian en contornos de texto.
      if (
        aggressiveDarkCleanup &&
        crispEdges &&
        canUseDark &&
        resizedRgb &&
        counts[darkIndex] > 0 &&
        existingDarkIndex >= 0 &&
        !strictVectorMode
      ) {
        const rgbData = resizedRgb.data
        const rgbChannels = resizedRgb.info.channels
        const darkMask = maskBuffers[darkIndex]
        const darkNeighborhood = await dilateMask(darkMask, outWidth, outHeight, 1)
        let movedByDarkHaloCleanup = 0

        for (let i = 0; i < targetPixels; i++) {
          if (darkNeighborhood[i] !== 255) continue
          if (darkMask[i] === 255) continue
          const label = labelData[i]
          if (label === 0) continue
          if (backgroundIndex >= 0 && label === backgroundIndex + 1) continue

          const idx = i * rgbChannels
          const r = rgbData[idx]
          const g = rgbData[idx + 1]
          const b = rgbData[idx + 2]
          const { s } = rgbToHsl(r, g, b)
          const lum = relativeLuminance(r, g, b)

          if (!(s < 0.56 && lum < 232)) continue

          let moved = false
          for (let cIdx = 0; cIdx < guidedPalette.length; cIdx++) {
            if (cIdx === darkIndex || cIdx === backgroundIndex) continue
            if (maskBuffers[cIdx][i] === 255) {
              maskBuffers[cIdx][i] = 0
              counts[cIdx] = Math.max(0, counts[cIdx] - 1)
              moved = true
            }
          }
          if (!moved) continue

          darkMask[i] = 255
          counts[darkIndex]++
          movedByDarkHaloCleanup++
        }

        if (movedByDarkHaloCleanup > 0) {
          logger.info(`[${jobId}] Crisp dark halo cleanup moved ${movedByDarkHaloCleanup} pixels to dark`)
        }
      }

      const writeMask = async (colorHex: string, maskIndex: number, maskBuffer: Buffer, pixels: number) => {
        let cleaned = maskBuffer
        if (crispEdges) {
          const holeArea = Math.max(2, Math.round(targetPixels * 0.0000015))
          const holeFilled = fillTinyHoles(maskBuffer, outWidth, outHeight, holeArea)
          const minArea = Math.max(6, Math.round(targetPixels * 0.0000015))
          cleaned = removeSmallComponents(holeFilled, outWidth, outHeight, minArea)
        } else {
          const rgb = hexToRgb(colorHex)
          const hsl = rgb ? rgbToHsl(rgb.r, rgb.g, rgb.b) : { h: 0, s: 0, l: 1 }
          const isDark = hsl.l < 0.2 && hsl.s < 0.25
          const holeArea = isDark
            ? Math.max(4, Math.round(targetPixels * 0.000006))
            : Math.max(3, Math.round(targetPixels * 0.000003))
          const holeFilled = fillTinyHoles(maskBuffer, outWidth, outHeight, holeArea)
          const minArea = isDark
            ? Math.max(8, Math.round(targetPixels * 0.00001))
            : Math.max(8, Math.round(targetPixels * 0.00002))
          cleaned = removeSmallComponents(holeFilled, outWidth, outHeight, minArea)
        }
        const pgmHeader = `P5\n${outWidth} ${outHeight}\n255\n`
        const pgmData = Buffer.concat([
          Buffer.from(pgmHeader, 'ascii'),
          cleaned
        ])
        const maskPath = path.join(
          storagePath,
          'processed',
          `${jobId}_color${maskIndex}_mask.pgm`
        )
        await fs.writeFile(maskPath, pgmData)
        masks.push({ color: colorHex, maskPath })
        logger.info(`[${jobId}] Mask ${maskIndex} (${colorHex}) pixels: ${pixels}`)
      }

      let written = 0
      const exportBucketToLabel = new Int16Array(bucketCount).fill(0)
      const exportColors: string[] = []
      let nextExportLabel = 1
      for (let cIdx = 0; cIdx < guidedPalette.length; cIdx++) {
        if (backgroundIndex >= 0 && cIdx === backgroundIndex) continue
        if (counts[cIdx] < 50) continue
        const hex = colors[cIdx] || '#cccccc'
        await writeMask(hex, written, maskBuffers[cIdx], counts[cIdx])
        exportBucketToLabel[cIdx] = nextExportLabel++
        exportColors.push(hex)
        written++
      }

      if (usesExtraDarkSlot && keepExtraDarkLayer) {
        const darkPixels = counts[darkIndex] || 0
        if (darkPixels > 50) {
          await writeMask('#000000', written, maskBuffers[darkIndex], darkPixels)
          exportBucketToLabel[darkIndex] = nextExportLabel++
          exportColors.push('#000000')
          written++
        }
      }

      if (exportColors.length > 0) {
        try {
          const exportLabelData = Buffer.alloc(targetPixels)
          for (let i = 0; i < targetPixels; i++) {
            const label = labelData[i]
            if (label === 0) continue
            const bucket = label - 1
            if (bucket < 0 || bucket >= exportBucketToLabel.length) continue
            const mapped = exportBucketToLabel[bucket]
            if (mapped > 0) exportLabelData[i] = mapped
          }

          const exportLabelPath = path.join(storagePath, 'processed', `${jobId}_vector_labels.pgm`)
          const exportHeader = `P5\n${outWidth} ${outHeight}\n255\n`
          await fs.writeFile(exportLabelPath, Buffer.concat([Buffer.from(exportHeader, 'ascii'), exportLabelData]))

          vectorSvg = await labelsToMultiLayerSvg(exportLabelPath, exportColors, jobId)
          await fs.rm(exportLabelPath, { force: true })
          logger.info(`[${jobId}] Vector multi-layer SVG generated (${vectorSvg.layers.length} layers)`)
        } catch (vectorError) {
          logger.warn(`[${jobId}] Could not generate vector multi-layer SVG, falling back to per-mask SVG: ${vectorError}`)
        }
      }
    } else {
    // Construir máscaras de la paleta
    let written = 0
    for (let cIdx = 0; cIdx < guidedPalette.length; cIdx++) {
      if (backgroundIndex >= 0 && cIdx === backgroundIndex) continue
      const pixels = pixelBuckets[cIdx]
      if (pixels.length < 50) continue
      const hex = colors[cIdx] || '#cccccc'
      await buildMask(cIdx, hex, written, pixels)
      written++
    }

    // Máscara oscura (texto/runner) SOLO si agregamos slot extra
    if (usesExtraDarkSlot && keepExtraDarkLayer) {
      const darkPixels = pixelBuckets[darkIndex]
      if (darkPixels.length > 50) {
        await buildMask(darkIndex, '#000000', written, darkPixels)
        written++
      }
    }
    }

    // Si generamos SVG multicapa, asociarlo a todas las capas para extrusión vectorial posterior.
    // Debe aplicarse tanto en modo crisp como en fallback no-crisp.
    if (vectorSvg) {
      for (const m of masks) {
        m.svgPath = vectorSvg.svgPath
        m.layers = vectorSvg.layers
      }
    }
    
    // Si no hay suficientes máscaras, usar la silueta completa como fallback
    if (masks.length === 0) {
      logger.warn(`[${jobId}] No color masks created, using full silhouette`)
      
      const silhouettePath = path.join(storagePath, 'processed', `${jobId}_silhouette.pgm`)
      
      // Redimensionar silueta manteniendo proporción
      const FALLBACK_TARGET = 1000
      const fallbackScale = Math.max(width, height) > 0 ? FALLBACK_TARGET / Math.max(width, height) : 1
      const fallbackWidth = Math.max(1, Math.round(width * fallbackScale))
      const fallbackHeight = Math.max(1, Math.round(height * fallbackScale))
      const resizedBuffer = await resizeBinaryMask(
        silhouetteMask,
        width,
        height,
        fallbackWidth,
        fallbackHeight,
        true
      )
      
      const pgmHeader = `P5\n${fallbackWidth} ${fallbackHeight}\n255\n`
      const pgmData = Buffer.concat([
        Buffer.from(pgmHeader, 'ascii'),
        resizedBuffer
      ])
      
      const fallbackPath = path.join(storagePath, 'processed', `${jobId}_color0_mask.pgm`)
      await fs.writeFile(fallbackPath, pgmData)
      
      masks.push({ color: '#3cb4dc', maskPath: fallbackPath })
    }
    
    logger.info(`[${jobId}] Created ${masks.length} hue-based masks`)
    return masks
    
  } catch (error) {
    logger.error(`[${jobId}] Error segmenting by hue:`, error)
    throw error
  }
}

/**
 * Función legacy para compatibilidad
 */
export const segmentByColors = async (
  inputPath: string,
  colors: string[],
  jobId: string,
  storagePath: string
): Promise<{ color: string; maskPath: string }[]> => {
  try {
    logger.info(`[${jobId}] Segmenting image into ${colors.length} color regions...`)
    
    // Leer imagen original
    const image = sharp(inputPath)
    const { data, info } = await image
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    
    const width = info.width
    const height = info.height
    const channels = info.channels
    
    const masks: { color: string; maskPath: string }[] = []
    
    // Crear una máscara por cada color
    for (let colorIndex = 0; colorIndex < colors.length; colorIndex++) {
      const targetColor = hexToRgb(colors[colorIndex])
      if (!targetColor) continue
      
      // Crear buffer para la máscara (blanco donde coincide el color, negro donde no)
      const maskBuffer = Buffer.alloc(width * height)
      
      let pixelCount = 0
      for (let i = 0; i < data.length; i += channels) {
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        
        // Calcular distancia perceptual al color objetivo usando "redmean"
        // Fórmula mejorada que considera la sensibilidad del ojo humano
        // https://en.wikipedia.org/wiki/Color_difference#sRGB
        const rMean = (r + targetColor.r) / 2
        const deltaR = r - targetColor.r
        const deltaG = g - targetColor.g
        const deltaB = b - targetColor.b
        
        const distance = Math.sqrt(
          (2 + rMean / 256) * deltaR * deltaR +
          4 * deltaG * deltaG +
          (2 + (255 - rMean) / 256) * deltaB * deltaB
        )
        
        // Tolerancia aumentada para capturar gradientes y antialiasing
        // Los logos modernos tienen suavizado que crea píxeles intermedios
        const pixelIndex = Math.floor(i / channels)
        if (distance < 100) {  // Aumentado de 60 a 100
          maskBuffer[pixelIndex] = 255 // Blanco
          pixelCount++
        } else {
          maskBuffer[pixelIndex] = 0 // Negro
        }
      }
      
      // Si la máscara tiene suficientes píxeles (al menos 1% de la imagen)
      if (pixelCount > (width * height) * 0.01) {
        // Guardar máscara como PGM (requerido por Potrace)
        const maskPath = path.join(
          storagePath,
          'processed',
          `${jobId}_color${colorIndex}_mask.pgm`
        )
        
        // IMPORTANTE: SIEMPRE redimensionar a 1000x1000 para mantener consistencia
        // Esto asegura que Potrace genere SVGs con coordenadas predecibles
        // Máscara: 255 (blanco) = logo, 0 (negro) = fondo
        // Potrace con -i trazará las áreas BLANCAS (el logo)
        const TARGET_SIZE = 1000
        
        // Crear imagen Sharp desde el buffer original
        const maskImage = sharp(maskBuffer, {
          raw: {
            width: width,
            height: height,
            channels: 1
          }
        })
        
        // Redimensionar A CUADRADO (forzar dimensiones) para mantener consistencia
        // Esto evita problemas con proporciones extrañas en SVG/STL
        // IMPORTANTE: usar kernel 'nearest' para imágenes binarias (blanco/negro)
        // lanczos3 no funciona bien con raw buffers de 1 canal
        const resizedBuffer = await maskImage
          .greyscale()  // Asegurar que se procesa como escala de grises
          .resize(TARGET_SIZE, TARGET_SIZE, {
            fit: 'fill',  // Forzar el tamaño exacto (puede distorsionar)
            kernel: 'nearest'  // Vecino más cercano para imágenes binarias
          })
          .raw()
          .toBuffer({ resolveWithObject: true })
        
        // Crear PGM con dimensiones cuadradas
        const newWidth = resizedBuffer.info.width
        const newHeight = resizedBuffer.info.height
        const pgmHeader = `P5\n${newWidth} ${newHeight}\n255\n`
        const pgmData = Buffer.concat([
          Buffer.from(pgmHeader, 'ascii'),
          resizedBuffer.data
        ])
        
        await fs.writeFile(maskPath, pgmData)
        logger.info(`[${jobId}] Mask created for ${colors[colorIndex]}: ${pixelCount} pixels, resized to ${newWidth}x${newHeight}`)
        
        masks.push({ color: colors[colorIndex], maskPath })
      } else {
        logger.warn(`[${jobId}] Skipping ${colors[colorIndex]}: too few pixels`)
      }
    }
    
    logger.info(`[${jobId}] Created ${masks.length} color masks`)
    return masks
    
  } catch (error) {
    logger.error(`[${jobId}] Error segmenting by colors:`, error)
    throw error
  }
}

/**
 * Convierte color hex a RGB
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null
}

// Distancia perceptual (redmean) para comparar colores
function redmeanDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const rMean = (r1 + r2) / 2
  const dR = r1 - r2
  const dG = g1 - g2
  const dB = b1 - b2
  return Math.sqrt(((2 + rMean / 256) * dR * dR) + (4 * dG * dG) + ((2 + (255 - rMean) / 256) * dB * dB))
}
