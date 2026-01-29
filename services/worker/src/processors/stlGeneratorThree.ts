/**
 * Generador de STL usando Three.js
 * Reemplaza OpenSCAD para mayor control y confiabilidad
 */

import * as THREE from 'three'
import fs from 'fs/promises'
import path from 'path'
import { logger } from '../utils/logger'
import { XMLParser } from 'fast-xml-parser'

const STORAGE_PATH = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../../storage')

interface StlParams {
  width: number      // mm
  height: number     // mm
  thickness: number  // mm
  borderEnabled?: boolean
  borderThickness?: number
}

/**
 * Parsea un path de SVG y retorna puntos 2D
 */
function parseSVGPath(pathData: string): THREE.Vector2[] {
  const points: THREE.Vector2[] = []
  
  // Comando simple: solo M (moveto) y L (lineto)
  // Para paths más complejos necesitaríamos una librería
  const commands = pathData.match(/[MLHVCSQTAZmlhvcsqtaz][^MLHVCSQTAZmlhvcsqtaz]*/g) || []
  
  let currentX = 0
  let currentY = 0
  
  for (const cmd of commands) {
    const type = cmd[0]
    const coords = cmd.slice(1).trim().split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n))
    
    if (type === 'M' || type === 'm') {
      // Move to
      const isRelative = type === 'm'
      for (let i = 0; i < coords.length; i += 2) {
        currentX = isRelative ? currentX + coords[i] : coords[i]
        currentY = isRelative ? currentY + coords[i + 1] : coords[i + 1]
        points.push(new THREE.Vector2(currentX, currentY))
      }
    } else if (type === 'L' || type === 'l') {
      // Line to
      const isRelative = type === 'l'
      for (let i = 0; i < coords.length; i += 2) {
        currentX = isRelative ? currentX + coords[i] : coords[i]
        currentY = isRelative ? currentY + coords[i + 1] : coords[i + 1]
        points.push(new THREE.Vector2(currentX, currentY))
      }
    } else if (type === 'H' || type === 'h') {
      // Horizontal line
      const isRelative = type === 'h'
      for (const x of coords) {
        currentX = isRelative ? currentX + x : x
        points.push(new THREE.Vector2(currentX, currentY))
      }
    } else if (type === 'V' || type === 'v') {
      // Vertical line
      const isRelative = type === 'v'
      for (const y of coords) {
        currentY = isRelative ? currentY + y : y
        points.push(new THREE.Vector2(currentX, currentY))
      }
    }
    // Ignoramos Z (closepath) y comandos de curvas por simplicidad
  }
  
  return points
}

/**
 * Convierte un SVG a STL usando Three.js
 */
export const svgToStlThree = async (
  svgPath: string,
  jobId: string,
  params: StlParams
): Promise<string> => {
  try {
    logger.info(`[${jobId}] svgToStlThree: Starting conversion`)
    logger.info(`[${jobId}] SVG: ${svgPath}`)
    logger.info(`[${jobId}] Params: ${JSON.stringify(params)}`)

    // Leer el contenido SVG
    const svgContent = await fs.readFile(svgPath, 'utf-8')
    
    // Parsear el SVG con fast-xml-parser
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_'
    })
    
    const svgData = parser.parse(svgContent)
    
    if (!svgData.svg) {
      throw new Error('Invalid SVG format')
    }
    
    // Extraer viewBox
    const viewBox = svgData.svg['@_viewBox']?.split(' ').map(parseFloat) || [0, 0, 100, 100]
    const [vbX, vbY, vbWidth, vbHeight] = viewBox
    
    logger.info(`[${jobId}] ViewBox: ${viewBox.join(' ')}`)
    
    // Extraer paths
    const gElement = svgData.svg.g
    if (!gElement) {
      throw new Error('No <g> element found in SVG')
    }
    
    const paths = Array.isArray(gElement.path) ? gElement.path : [gElement.path]
    
    if (!paths || paths.length === 0) {
      throw new Error('No paths found in SVG')
    }

    logger.info(`[${jobId}] Found ${paths.length} paths in SVG`)

    // Crear geometrías para cada path
    const geometries: THREE.BufferGeometry[] = []
    
    for (const pathEl of paths) {
      const pathData = pathEl['@_d']
      if (!pathData) continue
      
      try {
        const points = parseSVGPath(pathData)
        
        if (points.length < 3) continue
        
        // Crear shape desde los puntos
        const shape = new THREE.Shape(points)
        
        // Extrusión
        const extrudeSettings: THREE.ExtrudeGeometryOptions = {
          depth: params.thickness,
          bevelEnabled: false,
        }
        
        const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings)
        geometries.push(geometry)
      } catch (err) {
        logger.warn(`[${jobId}] Skipped path: ${err}`)
      }
    }

    if (geometries.length === 0) {
      throw new Error('No valid geometry created from SVG paths')
    }

    logger.info(`[${jobId}] Created ${geometries.length} geometries`)

    // Merge todas las geometrías
    const mergedGeometry = mergeGeometries(geometries)
    
    // Calcular bounding box
    mergedGeometry.computeBoundingBox()
    const box = mergedGeometry.boundingBox!
    const size = new THREE.Vector3()
    box.getSize(size)
    const center = new THREE.Vector3()
    box.getCenter(center)

    logger.info(`[${jobId}] Original size: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`)

    // Centrar
    mergedGeometry.translate(-center.x, -center.y, -center.z)

    // Calcular escala para ajustar a las dimensiones solicitadas
    const scaleX = params.width / size.x
    const scaleY = params.height / size.y
    const scale = Math.min(scaleX, scaleY)

    mergedGeometry.scale(scale, -scale, 1) // Y invertido por coordenadas SVG

    logger.info(`[${jobId}] Applied scale: ${scale.toFixed(4)}`)

    // Generar contenido STL ASCII
    const stlContent = generateSTLContent(mergedGeometry, jobId)
    
    // Guardar el archivo
    const outputPath = path.join(STORAGE_PATH, 'processed', `${jobId}.stl`)
    await fs.writeFile(outputPath, stlContent)
    
    logger.info(`[${jobId}] STL saved: ${outputPath}`)
    
    // Limpiar geometrías
    geometries.forEach(g => g.dispose())
    mergedGeometry.dispose()

    return outputPath
  } catch (error) {
    logger.error(`[${jobId}] Error in svgToStlThree:`, error)
    throw error
  }
}

/**
 * Merge múltiples geometrías en una
 */
function mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  
  for (const geometry of geometries) {
    const posAttr = geometry.getAttribute('position')
    const normAttr = geometry.getAttribute('normal')
    
    if (posAttr) {
      for (let i = 0; i < posAttr.count; i++) {
        positions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i))
      }
    }
    
    if (normAttr) {
      for (let i = 0; i < normAttr.count; i++) {
        normals.push(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i))
      }
    }
  }
  
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  
  return merged
}

/**
 * Genera contenido de archivo STL ASCII
 */
function generateSTLContent(geometry: THREE.BufferGeometry, name: string): string {
  const positions = geometry.getAttribute('position')
  const normals = geometry.getAttribute('normal')
  
  if (!positions) {
    throw new Error('Geometry has no positions')
  }
  
  const lines: string[] = [`solid ${name}`]
  
  // Cada triángulo tiene 3 vértices
  const numTriangles = Math.floor(positions.count / 3)
  
  for (let i = 0; i < numTriangles; i++) {
    const baseIndex = i * 3
    
    // Normal (usar la del primer vértice del triángulo)
    let nx = 0, ny = 0, nz = 1
    if (normals) {
      nx = normals.getX(baseIndex)
      ny = normals.getY(baseIndex)
      nz = normals.getZ(baseIndex)
    }
    
    lines.push(`  facet normal ${nx} ${ny} ${nz}`)
    lines.push('    outer loop')
    
    for (let j = 0; j < 3; j++) {
      const idx = baseIndex + j
      const x = positions.getX(idx)
      const y = positions.getY(idx)
      const z = positions.getZ(idx)
      lines.push(`      vertex ${x} ${y} ${z}`)
    }
    
    lines.push('    endloop')
    lines.push('  endfacet')
  }
  
  lines.push(`endsolid ${name}`)
  
  return lines.join('\n')
}

export default svgToStlThree
