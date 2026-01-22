import fs from 'fs/promises'
import { logger } from '../utils/logger'

export interface Vertex {
  x: number
  y: number
  z: number
}

export interface Triangle {
  v1: Vertex
  v2: Vertex
  v3: Vertex
  normal?: Vertex
}

export interface STLData {
  vertices: Vertex[]
  triangles: number[][] // Array de [v1Index, v2Index, v3Index]
  vertexMap: Map<string, number> // Para evitar duplicados
}

/**
 * Parser de archivos STL (binario y ASCII)
 * Extrae vértices y triángulos para generar 3MF
 */
export const parseSTL = async (stlPath: string): Promise<STLData> => {
  try {
    const buffer = await fs.readFile(stlPath)
    
    // Detectar si es binario o ASCII
    const header = buffer.toString('utf8', 0, 5)
    const isBinary = header !== 'solid'
    
    if (isBinary) {
      return parseBinarySTL(buffer)
    } else {
      return parseASCIISTL(buffer.toString('utf8'))
    }
  } catch (error) {
    logger.error('Error parsing STL:', error)
    throw new Error(`Failed to parse STL: ${error}`)
  }
}

/**
 * Parser para STL binario (más común)
 * Formato: Header (80 bytes) + Triangle count (4 bytes) + Triangles
 */
function parseBinarySTL(buffer: Buffer): STLData {
  const vertices: Vertex[] = []
  const triangles: number[][] = []
  const vertexMap = new Map<string, number>()
  
  // Skip header (80 bytes)
  const triangleCount = buffer.readUInt32LE(80)
  
  let offset = 84 // After header and count
  
  for (let i = 0; i < triangleCount; i++) {
    // Skip normal (12 bytes)
    offset += 12
    
    // Read 3 vertices (12 bytes each = 4 bytes per float * 3 coords)
    const v1 = readVertex(buffer, offset)
    const v2 = readVertex(buffer, offset + 12)
    const v3 = readVertex(buffer, offset + 24)
    
    // Add vertices and get indices
    const v1Index = addVertex(v1, vertices, vertexMap)
    const v2Index = addVertex(v2, vertices, vertexMap)
    const v3Index = addVertex(v3, vertices, vertexMap)
    
    triangles.push([v1Index, v2Index, v3Index])
    
    offset += 36 // 3 vertices * 12 bytes
    offset += 2  // Attribute byte count (unused)
  }
  
  logger.info(`Parsed binary STL: ${vertices.length} vertices, ${triangles.length} triangles`)
  
  return { vertices, triangles, vertexMap }
}

/**
 * Parser para STL ASCII (menos común pero más legible)
 */
function parseASCIISTL(content: string): STLData {
  const vertices: Vertex[] = []
  const triangles: number[][] = []
  const vertexMap = new Map<string, number>()
  
  const lines = content.split('\n')
  let currentTriangle: number[] = []
  
  for (const line of lines) {
    const trimmed = line.trim()
    
    if (trimmed.startsWith('vertex')) {
      const parts = trimmed.split(/\s+/)
      const vertex: Vertex = {
        x: parseFloat(parts[1]),
        y: parseFloat(parts[2]),
        z: parseFloat(parts[3])
      }
      
      const index = addVertex(vertex, vertices, vertexMap)
      currentTriangle.push(index)
      
      if (currentTriangle.length === 3) {
        triangles.push([...currentTriangle])
        currentTriangle = []
      }
    }
  }
  
  logger.info(`Parsed ASCII STL: ${vertices.length} vertices, ${triangles.length} triangles`)
  
  return { vertices, triangles, vertexMap }
}

/**
 * Lee un vértice del buffer binario
 */
function readVertex(buffer: Buffer, offset: number): Vertex {
  return {
    x: buffer.readFloatLE(offset),
    y: buffer.readFloatLE(offset + 4),
    z: buffer.readFloatLE(offset + 8)
  }
}

/**
 * Agrega un vértice evitando duplicados
 * Devuelve el índice del vértice
 */
function addVertex(vertex: Vertex, vertices: Vertex[], vertexMap: Map<string, number>): number {
  // Crear key único con precisión limitada para evitar problemas de punto flotante
  const key = `${vertex.x.toFixed(6)},${vertex.y.toFixed(6)},${vertex.z.toFixed(6)}`
  
  const existingIndex = vertexMap.get(key)
  if (existingIndex !== undefined) {
    return existingIndex
  }
  
  const newIndex = vertices.length
  vertices.push(vertex)
  vertexMap.set(key, newIndex)
  return newIndex
}

/**
 * Calcula el bounding box del modelo
 */
export function calculateBoundingBox(vertices: Vertex[]): {
  min: Vertex
  max: Vertex
  size: Vertex
} {
  if (vertices.length === 0) {
    return {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0, y: 0, z: 0 },
      size: { x: 0, y: 0, z: 0 }
    }
  }
  
  const min: Vertex = { ...vertices[0] }
  const max: Vertex = { ...vertices[0] }
  
  for (const v of vertices) {
    min.x = Math.min(min.x, v.x)
    min.y = Math.min(min.y, v.y)
    min.z = Math.min(min.z, v.z)
    max.x = Math.max(max.x, v.x)
    max.y = Math.max(max.y, v.y)
    max.z = Math.max(max.z, v.z)
  }
  
  return {
    min,
    max,
    size: {
      x: max.x - min.x,
      y: max.y - min.y,
      z: max.z - min.z
    }
  }
}
