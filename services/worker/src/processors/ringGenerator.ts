import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs/promises'
import path from 'path'
import { logger } from '../utils/logger'

const execAsync = promisify(exec)
const STORAGE_PATH = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../../storage')

interface RingParams {
  diameter: number
  thickness: number
  position: string
}

type StlFormat = 'ascii' | 'binary'

type BoundingBox = {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

function detectStlFormat(buffer: Buffer): StlFormat {
  // Binary STLs can also start with "solid" in the header, so use a stronger heuristic:
  // If we can find ASCII keywords early, treat it as ASCII.
  const head = buffer.slice(0, Math.min(buffer.length, 1024)).toString('ascii')
  if (/^solid\b/i.test(head) && /facet\s+normal/i.test(head) && /vertex\s+/i.test(head)) return 'ascii'
  return 'binary'
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0'
  // Trim noise but keep enough precision for printing
  const s = n.toFixed(6)
  return s.replace(/\.?0+$/, '')
}

function computeBoundingBoxFromAscii(stlText: string): BoundingBox | null {
  const vertexPattern = /vertex\s+([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)/g

  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity

  let match: RegExpExecArray | null
  let vertices = 0
  while ((match = vertexPattern.exec(stlText)) !== null) {
    const x = Number(match[1])
    const y = Number(match[2])
    const z = Number(match[3])
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
    vertices++
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z
  }

  if (vertices === 0) return null
  return { minX, minY, minZ, maxX, maxY, maxZ }
}

function computeBoundingBoxFromBinary(buffer: Buffer): BoundingBox | null {
  if (buffer.length < 84) return null
  const triangleCount = buffer.readUInt32LE(80)
  const triangleDataOffset = 84
  const triangleStride = 50
  const expectedSize = triangleDataOffset + triangleCount * triangleStride
  if (buffer.length < expectedSize) return null

  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity

  for (let i = 0; i < triangleCount; i++) {
    const base = triangleDataOffset + i * triangleStride + 12 // skip normal
    for (let v = 0; v < 3; v++) {
      const x = buffer.readFloatLE(base + v * 12)
      const y = buffer.readFloatLE(base + v * 12 + 4)
      const z = buffer.readFloatLE(base + v * 12 + 8)
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (z < minZ) minZ = z
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      if (z > maxZ) maxZ = z
    }
  }

  if (!Number.isFinite(minX)) return null
  return { minX, minY, minZ, maxX, maxY, maxZ }
}

async function getStlBoundingBox(stlPath: string): Promise<BoundingBox | null> {
  const buffer = await fs.readFile(stlPath)
  const format = detectStlFormat(buffer)
  if (format === 'ascii') return computeBoundingBoxFromAscii(buffer.toString('utf8'))
  return computeBoundingBoxFromBinary(buffer)
}

function extractAsciiFacets(stlText: string): string {
  const facetPattern = /facet\s+normal[\s\S]*?endfacet\s*/gi
  const facets = stlText.match(facetPattern)
  if (!facets || facets.length === 0) return ''
  return facets.join('\n')
}

function binaryToAsciiFacets(buffer: Buffer): string {
  if (buffer.length < 84) return ''
  const triangleCount = buffer.readUInt32LE(80)
  const triangleDataOffset = 84
  const triangleStride = 50
  const expectedSize = triangleDataOffset + triangleCount * triangleStride
  if (buffer.length < expectedSize) return ''

  const blocks: string[] = []
  for (let i = 0; i < triangleCount; i++) {
    const base = triangleDataOffset + i * triangleStride
    const nx = buffer.readFloatLE(base)
    const ny = buffer.readFloatLE(base + 4)
    const nz = buffer.readFloatLE(base + 8)

    const v0x = buffer.readFloatLE(base + 12)
    const v0y = buffer.readFloatLE(base + 16)
    const v0z = buffer.readFloatLE(base + 20)
    const v1x = buffer.readFloatLE(base + 24)
    const v1y = buffer.readFloatLE(base + 28)
    const v1z = buffer.readFloatLE(base + 32)
    const v2x = buffer.readFloatLE(base + 36)
    const v2y = buffer.readFloatLE(base + 40)
    const v2z = buffer.readFloatLE(base + 44)

    blocks.push(
      `  facet normal ${formatNumber(nx)} ${formatNumber(ny)} ${formatNumber(nz)}\n` +
        `    outer loop\n` +
        `      vertex ${formatNumber(v0x)} ${formatNumber(v0y)} ${formatNumber(v0z)}\n` +
        `      vertex ${formatNumber(v1x)} ${formatNumber(v1y)} ${formatNumber(v1z)}\n` +
        `      vertex ${formatNumber(v2x)} ${formatNumber(v2y)} ${formatNumber(v2z)}\n` +
        `    endloop\n` +
        `  endfacet`
    )
  }

  return blocks.join('\n')
}

function stlBufferToAsciiFacets(buffer: Buffer): string {
  const format = detectStlFormat(buffer)
  if (format === 'ascii') return extractAsciiFacets(buffer.toString('utf8'))
  return binaryToAsciiFacets(buffer)
}

export const addRing = async (
  stlPath: string,
  jobId: string,
  params: RingParams
): Promise<string> => {
  try {
    const outputPath = path.join(STORAGE_PATH, 'processed', `${jobId}_with_ring.stl`)
    const ringOnlyPath = path.join(STORAGE_PATH, 'processed', `${jobId}_ring_only.stl`)
    const ringScadPath = path.join(STORAGE_PATH, 'temp', `${jobId}_ring_only.scad`)

    // Compute model bounds to place ring reliably (avoids fixed offsets)
    const bbox = await getStlBoundingBox(stlPath)
    const minX = bbox?.minX ?? 0
    const maxX = bbox?.maxX ?? 50
    const minY = bbox?.minY ?? 0
    const maxY = bbox?.maxY ?? 50
    const minZ = bbox?.minZ ?? 0
    const maxZ = bbox?.maxZ ?? 3

    const ringOuterRadius = params.diameter / 2 + params.thickness
    const OVERLAP_RATIO = 0.35 // 35% of ring radius overlaps the model for a solid connection

    let translateX = (minX + maxX) / 2
    let translateY = maxY + ringOuterRadius * (1 - OVERLAP_RATIO)

    if (params.position === 'left') {
      translateX = minX - ringOuterRadius * (1 - OVERLAP_RATIO)
      translateY = (minY + maxY) / 2
    } else if (params.position === 'right') {
      translateX = maxX + ringOuterRadius * (1 - OVERLAP_RATIO)
      translateY = (minY + maxY) / 2
    }

    // Ensure the ring doesn't go below the build plane (z < 0)
    const translateZ = Math.max((minZ + maxZ) / 2, ringOuterRadius)

    // Generate the ring separately (CGAL union of two complex solids is brittle in OpenSCAD 2019).
    // We'll merge both meshes into one STL by concatenating facets.
    const ringScad = `
// Ring only (merged later) ${jobId}
$fn = 64;

module keyring(inner_diameter, wall, height) {
  difference() {
    cylinder(h = height, d = inner_diameter + (wall * 2), center = true);
    cylinder(h = height + 0.5, d = inner_diameter, center = true);
  }
}

translate([${formatNumber(translateX)}, ${formatNumber(translateY)}, ${formatNumber(translateZ)}]) {
  rotate([90, 0, 0]) {
    keyring(${formatNumber(params.diameter)}, ${formatNumber(params.thickness)}, ${formatNumber(params.thickness)});
  }
}
`

    await fs.writeFile(ringScadPath, ringScad)
    logger.info(`Ring OpenSCAD script created: ${ringScadPath}`)

    const ringCommand = `openscad -o "${ringOnlyPath}" "${ringScadPath}"`
    logger.info(`Running OpenSCAD (ring only): ${ringCommand}`)

    try {
      const { stderr } = await execAsync(ringCommand, {
        timeout: parseInt(process.env.WORKER_MAX_JOB_TIME || '60000'),
      })
      if (stderr) logger.warn(`OpenSCAD ring stderr: ${stderr}`)
    } catch (error: any) {
      logger.warn(`OpenSCAD ring generation failed: ${error?.message || error}`)
      // Fallback: keep original STL (do not fail the job)
      await fs.copyFile(stlPath, outputPath)
      await fs.unlink(ringScadPath).catch(() => {})
      return outputPath
    } finally {
      await fs.unlink(ringScadPath).catch(() => {})
    }

    // Merge original + ring STL into a single ASCII STL (slicer will naturally union overlapping volumes)
    const originalBuffer = await fs.readFile(stlPath)
    const ringBuffer = await fs.readFile(ringOnlyPath)

    const originalFacets = stlBufferToAsciiFacets(originalBuffer)
    const ringFacets = stlBufferToAsciiFacets(ringBuffer)

    if (!originalFacets || !ringFacets) {
      logger.warn(`[${jobId}] Could not extract facets for STL merge, keeping original STL`)
      await fs.copyFile(stlPath, outputPath)
      return outputPath
    }

    const solidName = `${jobId}_with_ring`
    const merged = `solid ${solidName}\n${originalFacets}\n${ringFacets}\nendsolid ${solidName}\n`
    await fs.writeFile(outputPath, merged, 'utf8')

    logger.info(`STL with ring generated (merged facets): ${outputPath}`)

    return outputPath
  } catch (error) {
    logger.error('Error adding ring:', error)
    // Never fail the whole job because of the ring: return original STL.
    const fallbackPath = path.join(STORAGE_PATH, 'processed', `${jobId}_with_ring.stl`)
    await fs.copyFile(stlPath, fallbackPath).catch(() => {})
    return fallbackPath
  }
}
