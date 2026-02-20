import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs/promises'
import { logger } from '../utils/logger'

export type SvgLayer = { color: string; svgPath: string }
export type MultiLayerSvg = { svgPath: string; layers: SvgLayer[] }

const execAsync = promisify(exec)
const STORAGE_PATH = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../../storage')

// Genera un SVG monocapa (binario) desde una máscara PGM.
export const imageToSvg = async (imagePath: string, jobId: string): Promise<string> => {
  try {
    const outputPath = path.join(STORAGE_PATH, 'processed', `${jobId}.svg`)

    // vtracer en Node requiere soporte sólido de módulos .wasm.
    // Lo dejamos opcional (off por defecto) para evitar fallos intermitentes.
    const useVtracer = (process.env.USE_VTRACER ?? '0') === '1'
    if (useVtracer) {
      try {
        await imageToSvgWithVtracer(imagePath, outputPath)
        await normalizeSVG(outputPath)
        logger.info(`SVG generated successfully with vtracer: ${outputPath}`)
        return outputPath
      } catch (error) {
        logger.warn(`vtracer failed, falling back to potrace: ${error}`)
      }
    }

    const turdSize = Math.max(0, Number(process.env.POTRACE_TURD_SIZE ?? '3'))
    const alphaMax = Math.min(1.333, Math.max(0, Number(process.env.POTRACE_ALPHA_MAX ?? '1.0')))
    const optTolerance = Math.max(0, Number(process.env.POTRACE_OPT_TOLERANCE ?? '0.65'))
    const unit = Math.max(1, Number(process.env.POTRACE_UNIT ?? '4'))

    const command = `potrace "${imagePath}" -i -s -o "${outputPath}" -t ${turdSize} -a ${alphaMax} -O ${optTolerance} -u ${unit}`
    logger.info(`Running potrace: ${command}`)
    const { stderr } = await execAsync(command)
    if (stderr) logger.warn(`Potrace stderr: ${stderr}`)
    logger.info(`SVG generated successfully with high detail: ${outputPath}`)
    await normalizeSVG(outputPath)
    return outputPath
  } catch (error) {
    logger.error('Error generating SVG:', error)
    throw new Error(`Failed to generate SVG: ${error}`)
  }
}

// Genera un SVG multicapa coloreado a partir de un label map (PGM con valores 0..N).
export const labelsToMultiLayerSvg = async (
  labelPgmPath: string,
  colors: string[],
  jobId: string
): Promise<MultiLayerSvg> => {
  const outputPath = path.join(STORAGE_PATH, 'processed', `${jobId}_multicolor.svg`)
  const { width, height, data } = await readPgm(labelPgmPath)

  const layers: SvgLayer[] = []
  const paths: string[] = []
  const tempMasks: string[] = []

  const labelCount = colors.length
  for (let label = 1; label <= labelCount; label++) {
    // Construir bitmap binario de este label
    const bin = Buffer.alloc(width * height)
    let labelPixels = 0
    for (let i = 0; i < data.length; i++) {
      if (data[i] === label) {
        bin[i] = 255
        labelPixels++
      }
    }
    if (labelPixels < 40) {
      continue
    }

    // Guardar PGM temporal
    const pgmHeader = `P5\n${width} ${height}\n255\n`
    const pgmData = Buffer.concat([Buffer.from(pgmHeader, 'ascii'), bin])
    const tmpMask = path.join(STORAGE_PATH, 'processed', `${jobId}_tmp_${label}.pgm`)
    await fs.writeFile(tmpMask, pgmData)
    tempMasks.push(tmpMask)

    // Vectorizar con potrace
    const layerSvg = path.join(STORAGE_PATH, 'processed', `${jobId}_tmp_${label}.svg`)
    const defaultTurd = Math.max(2, Math.min(12, Math.round(labelPixels * 0.00001)))
    const turdSize = Math.max(0, Number(process.env.POTRACE_LAYER_TURD_SIZE ?? String(defaultTurd)))
    const alphaMax = Math.min(1.333, Math.max(0, Number(process.env.POTRACE_LAYER_ALPHA_MAX ?? '1.2')))
    const optTolerance = Math.max(0, Number(process.env.POTRACE_LAYER_OPT_TOLERANCE ?? '0.35'))
    const unit = Math.max(1, Number(process.env.POTRACE_LAYER_UNIT ?? '1'))
    const command = `potrace "${tmpMask}" -i -s -o "${layerSvg}" -t ${turdSize} -a ${alphaMax} -O ${optTolerance} -u ${unit}`
    await execAsync(command)
    await normalizeSVG(layerSvg)

    const svgContent = await fs.readFile(layerSvg, 'utf-8')
    const pathMatches = [...svgContent.matchAll(/<path\b[^>]*>/gi)]
    if (pathMatches.length === 0) continue
    const color = colors[label - 1] || '#cccccc'
    layers.push({ color, svgPath: layerSvg })
    for (const m of pathMatches) {
      let tag = m[0]
      if (/\bfill\s*=/.test(tag)) {
        tag = tag.replace(/\bfill\s*=\s*(['"]).*?\1/i, `fill="${color}"`)
      } else {
        tag = tag.replace(/\/?>$/, ` fill="${color}"$&`)
      }
      paths.push(tag)
    }
  }

  const viewBox = `0 0 ${width} ${height}`
  const svg = `<?xml version="1.0" standalone="no"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}">\n${paths.join('\n')}\n</svg>`
  await fs.writeFile(outputPath, svg, 'utf-8')
  await normalizeSVG(outputPath)

  for (const tempMask of tempMasks) {
    await fs.rm(tempMask, { force: true })
  }

  return { svgPath: outputPath, layers }
}

const readPgm = async (imagePath: string): Promise<{ width: number; height: number; data: Buffer }> => {
  const pgmData = await fs.readFile(imagePath)
  let offset = 0
  const nextLine = () => {
    const end = pgmData.indexOf(0x0a, offset)
    const line = pgmData.toString('ascii', offset, end)
    offset = end + 1
    return line.trim()
  }
  const magic = nextLine()
  if (!magic.startsWith('P5')) throw new Error('Invalid PGM format')
  let dims = nextLine()
  while (dims.startsWith('#') || dims === '') dims = nextLine()
  const [width, height] = dims.split(/\s+/).map(Number)
  let maxval = nextLine()
  while (maxval.startsWith('#') || maxval === '') maxval = nextLine()
  const data = pgmData.slice(offset)
  return { width, height, data }
}

const imageToSvgWithVtracer = async (imagePath: string, outputPath: string): Promise<void> => {
  const { width, height, data } = await readPgm(imagePath)
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const isOn = data[i] > 127
    const value = isOn ? 0 : 255
    const idx = i * 4
    rgba[idx] = value
    rgba[idx + 1] = value
    rgba[idx + 2] = value
    rgba[idx + 3] = 255
  }

const { BinaryImageConverter } = (await import('vectortracer')) as typeof import('vectortracer')
  const converterOptions = {
    debug: false,
    mode: 'spline' as const,
    cornerThreshold: 0.2,
    lengthThreshold: 1,
    maxIterations: 10,
    spliceThreshold: 2,
    filterSpeckle: 6,
    pathPrecision: 3,
  }
  const options = {
    invert: false,
    pathFill: '#000000',
    backgroundColor: 'none',
    attributes: '',
    scale: 1,
  }

  const converter = new BinaryImageConverter({ data: rgba, width, height } as any, converterOptions, options)
  converter.init()
  let done = false
  let guard = 0
  while (!done && guard < 200000) {
    done = converter.tick()
    guard++
  }
  if (!done) {
    converter.free()
    throw new Error('vtracer did not finish')
  }
  const svg = converter.getResult()
  converter.free()
  await fs.writeFile(outputPath, svg, 'utf-8')
}

async function normalizeSVG(svgPath: string): Promise<void> {
  try {
    let content = await fs.readFile(svgPath, 'utf-8')

    // Potrace genera width/height en "pt" (puntos). OpenSCAD respeta esas unidades físicas,
    // lo que produce modelos a escala incorrecta. Reescribimos el <svg> para que:
    // - width/height usen "mm"
    // - el tamaño físico sea igual al viewBox (1 unidad = 1mm antes de escalado en OpenSCAD)
    const svgTagMatch = content.match(/<svg\b[^>]*>/i)
    if (!svgTagMatch) {
      logger.warn(`Could not find <svg> tag in: ${svgPath}`)
      return
    }

    const svgTag = svgTagMatch[0]
    const viewBoxMatch = svgTag.match(/\bviewBox\s*=\s*(['"])([^'"]+)\1/i)
    if (!viewBoxMatch) {
      logger.warn(`Could not find viewBox in SVG: ${svgPath}`)
      return
    }

    const viewBoxParts = viewBoxMatch[2].trim().split(/[\s,]+/).map(Number)
    if (viewBoxParts.length < 4 || viewBoxParts.some(n => Number.isNaN(n))) {
      logger.warn(`Invalid viewBox in SVG: ${svgPath}`)
      return
    }

    const vbWidth = viewBoxParts[2]
    const vbHeight = viewBoxParts[3]

    const formatNumber = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/0+$/, '').replace(/\.$/, ''))
    const replaceOrInsertAttr = (tag: string, attr: string, value: string) => {
      if (new RegExp(`\\b${attr}\\s*=`, 'i').test(tag)) {
        return tag.replace(new RegExp(`\\b${attr}\\s*=\\s*(['\"]).*?\\1`, 'i'), `${attr}="${value}"`)
      }
      return tag.replace(/>$/, ` ${attr}="${value}">`)
    }

    let newSvgTag = svgTag
    newSvgTag = replaceOrInsertAttr(newSvgTag, 'width', `${formatNumber(vbWidth)}mm`)
    newSvgTag = replaceOrInsertAttr(newSvgTag, 'height', `${formatNumber(vbHeight)}mm`)

    if (newSvgTag !== svgTag) {
      content = content.replace(svgTag, newSvgTag)
    }

    await fs.writeFile(svgPath, content, 'utf-8')
    logger.info(`SVG normalized (mm units): ${svgPath}`)
    
  } catch (error) {
    logger.error('Error normalizing SVG:', error)
  }
}
