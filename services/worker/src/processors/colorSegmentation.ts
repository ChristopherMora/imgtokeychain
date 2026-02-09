import sharp from 'sharp'
import path from 'path'
import fs from 'fs/promises'
import { logger } from '../utils/logger'
import { optimizeMaskForPotrace, removeSmallComponents, erodeMask, dilateMask } from './maskEnhancer'

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
  storagePath: string
): Promise<{ color: string; maskPath: string }[]> => {
  try {
    logger.info(`[${jobId}] Segmenting by guided palette within silhouette...`)
    
    const crispEdges = colors.length <= 6

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
    
    const masks: { color: string; maskPath: string }[] = []
    const assignments = new Int16Array(width * height).fill(-1)

    // Slot "oscuro" (texto/runner): si la paleta ya incluye un negro/gris muy oscuro, reutilizarlo.
    // Esto evita crear una capa extra que no está en `dominantColors` (y rompe el preview/descarga por índice).
    const existingDarkIndex = guidedPalette.findIndex(c => {
      const { s, l } = rgbToHsl(c.r, c.g, c.b)
      return l < 0.2 && s < 0.25
    })
    const usesExtraDarkSlot = existingDarkIndex === -1
    const darkIndex = usesExtraDarkSlot ? guidedPalette.length : existingDarkIndex

    const workingMask = silhouetteMask

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
        if (workingMask[i] === 255) silhouetteCount++
        if (interiorMask[i] === 255) interiorCount++
      }
      if (interiorCount < silhouetteCount * 0.65) {
        interiorMask = workingMask
      }
    }

    const boundaryBand = new Uint8Array(width * height)
    if (interiorMask !== workingMask) {
      for (let i = 0; i < workingMask.length; i++) {
        if (workingMask[i] === 255 && interiorMask[i] === 0) boundaryBand[i] = 1
      }
    } else {
      for (let i = 0; i < workingMask.length; i++) {
        if (workingMask[i] !== 255) continue
        const x = i % width
        const y = Math.floor(i / width)
        for (const [dx, dy] of neighbors) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
          const nidx = ny * width + nx
          if (workingMask[nidx] === 0) {
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
      if (workingMask[i] === 255) silhouetteCount++
      if (boundaryBand[i] === 1) boundaryCount++
    }
    const interiorCount = Math.max(0, silhouetteCount - boundaryCount)
    const skipBoundaryInAssignment = interiorCount >= Math.max(200, Math.round(silhouetteCount * 0.45))

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
              if (workingMask[nidx] === 255) expandedBoundary[nidx] = 1
            }
          }
        }
      }
      boundaryBand.set(expandedBoundary)
    }

    const classifyPixel = (pixelIndex: number): number => {
      const r = data[pixelIndex * 3]
      const g = data[pixelIndex * 3 + 1]
      const b = data[pixelIndex * 3 + 2]
      const { s, l } = rgbToHsl(r, g, b)

      const darkness = r + g + b
      const isLowSat = s < 0.22
      const isAbsoluteDark = l < 0.12 || darkness < 75
      const isDarkGray = isLowSat && l < 0.45 && darkness < 220
      if (isAbsoluteDark || isDarkGray) return darkIndex

      if (guidedPalette.length === 0) return darkIndex

      let bestIdx = 0
      let bestDist = Infinity
      for (let cIdx = 0; cIdx < guidedPalette.length; cIdx++) {
        const c = guidedPalette[cIdx]
        const dist = redmeanDistance(r, g, b, c.r, c.g, c.b)
        if (dist < bestDist) {
          bestDist = dist
          bestIdx = cIdx
        }
      }
      return bestIdx
    }

    // Asignar cada pixel dentro de la silueta al color más cercano.
    // Usamos workingMask (silueta completa) para que TODOS los píxeles se asignen
    // por su color real, incluyendo bordes y features finos (texto, líneas).
    for (let i = 0; i < width * height; i++) {
      if (workingMask[i] !== 255) continue
      if (skipBoundaryInAssignment && boundaryBand[i] === 1) continue
      assignments[i] = classifyPixel(i)
    }

    // Expandir ligeramente la capa oscura para absorber el anti‑aliasing de textos/contornos
    // En logos con pocos colores (crispEdges), esto puede engrosar bordes y generar halos.
    if (!crispEdges && darkIndex >= 0) {
      const darkPixels: number[] = []
      for (let i = 0; i < assignments.length; i++) {
        if (assignments[i] === darkIndex) darkPixels.push(i)
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
          if (expanded[i] === 1 && workingMask[i] === 255) {
            assignments[i] = darkIndex
          }
        }
      }
    }

    // Rellenar píxeles del borde externo que NO fueron asignados (assignments=-1)
    // Solo rellenar huecos, NO sobrescribir asignaciones correctas que ya tienen color real.
    const radius = Math.max(1, Math.round(Math.max(width, height) / 1200))
    for (let i = 0; i < boundaryBand.length; i++) {
      if (boundaryBand[i] !== 1) continue
      if (assignments[i] >= 0) continue  // Ya tiene asignación correcta, no sobrescribir
      const x = i % width
      const y = Math.floor(i / width)
      const counts = new Map<number, number>()
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
          const nidx = ny * width + nx
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

    // Fallback global: si quedó algún pixel de silueta sin etiqueta, asignarlo por mayoría vecina.
    // Evita micro-huecos que luego aparecen como "mordidas" en el 3D.
    for (let i = 0; i < assignments.length; i++) {
      if (workingMask[i] !== 255) continue
      if (assignments[i] >= 0) continue
      const x = i % width
      const y = Math.floor(i / width)
      const counts = new Map<number, number>()
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
          const nidx = ny * width + nx
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

    let keepExtraDarkLayer = usesExtraDarkSlot
    if (usesExtraDarkSlot && darkIndex >= 0) {
      let darkPixels = 0
      for (let i = 0; i < assignments.length; i++) {
        if (assignments[i] === darkIndex) darkPixels++
      }

      const darkRatio = darkPixels / Math.max(1, silhouetteCount)
      const minDarkPixels = Math.max(120, Math.round(silhouetteCount * 0.008))
      keepExtraDarkLayer = darkPixels >= minDarkPixels

      if (!keepExtraDarkLayer && guidedPalette.length > 0) {
        for (let i = 0; i < assignments.length; i++) {
          if (assignments[i] !== darkIndex) continue
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
      ? Math.max(6, Math.round(width * height * 0.000004))
      : Math.max(10, Math.round(width * height * 0.000008))
    if (labelCount > 1) {
      const visited = new Uint8Array(assignments.length)
      const queue = new Int32Array(assignments.length)
      for (let start = 0; start < assignments.length; start++) {
        if (workingMask[start] !== 255) continue
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
            if (workingMask[nidx] !== 255) continue
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

        if (component.length >= minIslandArea) continue
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
      if (workingMask[i] !== 255) continue
      const current = assignments[i]
      if (current < 0) continue
      const x = i % width
      const y = Math.floor(i / width)
      for (const [dx, dy] of neighbors) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const nidx = ny * width + nx
        const other = assignments[nidx]
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
        if (workingMask[i] !== 255) continue
        const x = i % width
        const y = Math.floor(i / width)
        const counts = new Map<number, number>()
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
            const nidx = ny * width + nx
            const a = assignments[nidx]
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

    const TARGET_SIZE = 2000
    const maxDim = Math.max(width, height)
    const scale = maxDim > TARGET_SIZE ? TARGET_SIZE / maxDim : 1
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

      // === FIX: Prevenir que Potrace expanda máscaras de color sobre zonas oscuras ===
      // Potrace suaviza curvas al vectorizar, lo que hace que la máscara rosa (la más grande)
      // invada las zonas de texto/contornos negros. Solución:
      // 1. Dilatar la máscara oscura 2px para crear una "zona de reserva"
      // 2. Substraer esa zona de todas las máscaras no-oscuras
      const darkPixels = darkIndex >= 0 && darkIndex < bucketCount ? counts[darkIndex] : 0
      const darkRatio = darkPixels / Math.max(1, targetPixels)
      const shouldApplyDarkReserve =
        darkPixels > Math.max(100, Math.round(targetPixels * 0.002)) &&
        darkRatio < 0.35 &&
        (keepExtraDarkLayer || !usesExtraDarkSlot)

      if (shouldApplyDarkReserve && darkIndex >= 0 && darkIndex < bucketCount) {
        const dilatedDark = await dilateMask(maskBuffers[darkIndex], outWidth, outHeight, 1)
        for (let bIdx = 0; bIdx < bucketCount; bIdx++) {
          if (bIdx === darkIndex) continue
          for (let i = 0; i < targetPixels; i++) {
            if (dilatedDark[i] === 255) {
              if (maskBuffers[bIdx][i] === 255) {
                maskBuffers[bIdx][i] = 0
                counts[bIdx]--
              }
            }
          }
        }
        logger.info(
          `[${jobId}] Reserved dark regions for crisp masks (${darkPixels} px, ${(darkRatio * 100).toFixed(2)}%)`
        )
      }

      const writeMask = async (colorHex: string, maskIndex: number, maskBuffer: Buffer, pixels: number) => {
        const minArea = Math.max(8, Math.round(targetPixels * 0.000004))
        const cleaned = removeSmallComponents(maskBuffer, outWidth, outHeight, minArea)
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
      for (let cIdx = 0; cIdx < guidedPalette.length; cIdx++) {
        if (counts[cIdx] < 50) continue
        const hex = colors[cIdx] || '#cccccc'
        await writeMask(hex, written, maskBuffers[cIdx], counts[cIdx])
        written++
      }

      if (usesExtraDarkSlot && keepExtraDarkLayer) {
        const darkPixels = counts[darkIndex] || 0
        if (darkPixels > 50) {
          await writeMask('#000000', written, maskBuffers[darkIndex], darkPixels)
          written++
        }
      }
    } else {
    // Construir máscaras de la paleta
    let written = 0
    for (let cIdx = 0; cIdx < guidedPalette.length; cIdx++) {
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
