'use client'

import React, { useEffect, useState, Suspense, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment, Grid } from '@react-three/drei'
import * as THREE from 'three'

interface Enhanced3DViewerProps {
  jobId: string
  status?: string
  dominantColors?: string[]
}

interface STLModelData {
  stlData: ArrayBuffer
  color: string
  index: number
}

// Parse STL buffer to geometry - moved outside component for reuse
function parseSTLBuffer(buffer: ArrayBuffer): THREE.BufferGeometry {
  const view = new DataView(buffer)
  const text = new TextDecoder().decode(buffer.slice(0, 80))
  const isAscii = /^solid/i.test(text.trim())
  
  if (isAscii) {
    return parseAsciiSTL(buffer)
  }
  
  // Binary STL format
  const faces = view.getUint32(80, true)
  const vertices: number[] = []
  const normals: number[] = []
  
  for (let i = 0; i < faces; i++) {
    const offset = 84 + i * 50
    
    const nx = view.getFloat32(offset, true)
    const ny = view.getFloat32(offset + 4, true)
    const nz = view.getFloat32(offset + 8, true)
    
    for (let j = 0; j < 3; j++) {
      const vOffset = offset + 12 + j * 12
      vertices.push(
        view.getFloat32(vOffset, true),
        view.getFloat32(vOffset + 4, true),
        view.getFloat32(vOffset + 8, true)
      )
      normals.push(nx, ny, nz)
    }
  }
  
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.computeBoundingBox()
  
  return geometry
}

// ASCII STL parser
function parseAsciiSTL(buffer: ArrayBuffer): THREE.BufferGeometry {
  const text = new TextDecoder().decode(buffer)
  const vertices: number[] = []
  const normals: number[] = []
  
  const vertexPattern = /vertex\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)/g
  const normalPattern = /facet\s+normal\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)/g
  
  let normalMatch
  const normalList: number[][] = []
  while ((normalMatch = normalPattern.exec(text)) !== null) {
    normalList.push([parseFloat(normalMatch[1]), parseFloat(normalMatch[3]), parseFloat(normalMatch[5])])
  }
  
  let vertexMatch
  let facetIndex = 0
  let vertexInFacet = 0
  
  while ((vertexMatch = vertexPattern.exec(text)) !== null) {
    vertices.push(
      parseFloat(vertexMatch[1]),
      parseFloat(vertexMatch[3]),
      parseFloat(vertexMatch[5])
    )
    
    if (normalList[facetIndex]) {
      normals.push(...normalList[facetIndex])
    }
    
    vertexInFacet++
    if (vertexInFacet === 3) {
      vertexInFacet = 0
      facetIndex++
    }
  }
  
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.computeBoundingBox()
  
  return geometry
}

// Multi-layer 3D model that shares same scale/center for all layers
function MultiLayerModel({ models }: { models: STLModelData[] }) {
  const [geometries, setGeometries] = useState<{ geo: THREE.BufferGeometry; color: string; index: number }[]>([])
  const [globalScale, setGlobalScale] = useState(1)
  const [globalCenter, setGlobalCenter] = useState<THREE.Vector3>(new THREE.Vector3())
  
  useEffect(() => {
    if (models.length === 0) return
    
    try {
      // Parse all STLs
      const parsedGeos = models.map(model => ({
        geo: parseSTLBuffer(model.stlData),
        color: model.color,
        index: model.index
      }))
      
      // Calculate global bounding box across ALL layers
      const globalBox = new THREE.Box3()
      parsedGeos.forEach(({ geo }) => {
        geo.computeBoundingBox()
        if (geo.boundingBox) {
          globalBox.union(geo.boundingBox)
        }
      })
      
      // Calculate center and scale from global bounds
      const center = new THREE.Vector3()
      globalBox.getCenter(center)
      
      const size = new THREE.Vector3()
      globalBox.getSize(size)
      const maxDim = Math.max(size.x, size.y, size.z)
      const scale = 3 / maxDim
      
      setGlobalCenter(center)
      setGlobalScale(scale)
      setGeometries(parsedGeos)
      
    } catch (error) {
      console.error('Error parsing STLs:', error)
    }
  }, [models])
  
  if (geometries.length === 0) return null
  
  // Sort geometries by index to ensure consistent layer order
  const sortedGeometries = [...geometries].sort((a, b) => a.index - b.index)
  
  return (
    // NO centrar - las geometrías ya tienen las posiciones correctas relativas
    <group scale={globalScale} position={[-globalCenter.x * globalScale, -globalCenter.y * globalScale, 0]}>
      {sortedGeometries.map(({ geo, color, index }, arrayIndex) => (
        <mesh 
          key={index} 
          geometry={geo}
          position={[0, 0, 0]}
          renderOrder={arrayIndex}
        >
          <meshStandardMaterial 
            color={color || '#0ea5e9'} 
            metalness={0.2} 
            roughness={0.5}
            side={THREE.DoubleSide}
            polygonOffset
            polygonOffsetFactor={-1 - arrayIndex}
            polygonOffsetUnits={-1 - arrayIndex}
          />
        </mesh>
      ))}
    </group>
  )
}

function STLModel({ stlData, color, index }: { stlData: ArrayBuffer; color?: string; index: number }) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null)
  
  useEffect(() => {
    try {
      const geo = parseSTLBuffer(stlData)
      setGeometry(geo)
    } catch (error) {
      console.error('Error parsing STL:', error)
    }
  }, [stlData])
  
  if (!geometry) return null
  
  geometry.center()
  geometry.computeBoundingBox()
  const boundingBox = geometry.boundingBox!
  const size = new THREE.Vector3()
  boundingBox.getSize(size)
  const maxDim = Math.max(size.x, size.y, size.z)
  const scale = 3 / maxDim
  
  const modelColor = color || '#0ea5e9'
  return (
    <mesh geometry={geometry} scale={scale}>
      <meshStandardMaterial 
        color={modelColor} 
        metalness={0.2} 
        roughness={0.5}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

export default function Enhanced3DViewer({ jobId, status, dominantColors }: Enhanced3DViewerProps) {
  const [stlModels, setStlModels] = useState<STLModelData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load STLs only once when status changes to COMPLETED
  // Using a ref to track if we've already loaded
  const hasLoadedRef = useRef(false)
  
  useEffect(() => {
    // Reset on new job
    if (status !== 'COMPLETED' && status !== 'completed') {
      hasLoadedRef.current = false
    }
    
    if ((status === 'COMPLETED' || status === 'completed') && !hasLoadedRef.current) {
      hasLoadedRef.current = true
      setLoading(true)
      setError(null)
      
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'
      
      const hasMultipleColors = dominantColors && dominantColors.length > 1
      
      if (hasMultipleColors) {
        const loadPromises = dominantColors!.map((color, index) => {
          const url = `${apiUrl}/jobs/${jobId}/color/${index}`
          return fetch(url)
            .then(response => {
              if (!response.ok) throw new Error(`Color ${index} STL not available`)
              return response.arrayBuffer()
            })
            .then(buffer => ({ stlData: buffer, color, index }))
            .catch(err => {
              console.warn(`Could not load color ${index}:`, err)
              return null
            })
        })
        
        Promise.all(loadPromises)
          .then(models => {
            const validModels = models.filter((m): m is STLModelData => m !== null)
            
            if (validModels.length === 0) {
              loadMainSTL()
            } else {
              setStlModels(validModels)
              setLoading(false)
            }
          })
          .catch(err => {
            console.error('Error loading color STLs:', err)
            loadMainSTL()
          })
      } else {
        loadMainSTL()
      }
    } else if (status === 'FAILED' || status === 'failed') {
      setError('Error en generación')
      setLoading(false)
    }
    
    function loadMainSTL() {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'
      const url = `${apiUrl}/jobs/${jobId}/download`
      
      fetch(url)
        .then(response => {
          if (!response.ok) throw new Error('STL no disponible')
          return response.arrayBuffer()
        })
        .then(buffer => {
          const mainColor = (dominantColors && dominantColors[0]) || '#0ea5e9'
          setStlModels([{ stlData: buffer, color: mainColor, index: 0 }])
          setLoading(false)
        })
        .catch(err => {
          console.error('Error loading STL:', err)
          setError(err.message || 'Error al cargar STL')
          setLoading(false)
        })
    }
  }, [jobId, status, dominantColors]) // Removed colorMapping to prevent infinite loop

  if (loading || ['PROCESSING', 'PENDING', 'processing', 'pending'].includes(status || '')) {
    return (
      <div className="aspect-square bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl flex items-center justify-center shadow-2xl">
        <div className="text-white text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-500 mx-auto mb-4"></div>
          <p className="text-lg font-medium">Generando modelo 3D...</p>
          <p className="text-sm text-gray-400 mt-2">Esto puede tomar unos segundos</p>
        </div>
      </div>
    )
  }

  if (error || stlModels.length === 0) {
    return (
      <div className="aspect-square bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl flex items-center justify-center shadow-2xl">
        <div className="text-white text-center">
          <div className="text-6xl mb-4">📦</div>
          <p className="text-lg">{error || 'Preview no disponible'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Main 3D Viewer */}
      <div className="aspect-square bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-xl overflow-hidden relative shadow-2xl border border-gray-700">
        <Canvas 
          camera={{ position: [0, 2, 5], fov: 50 }}
          shadows
        >
          {/* Lighting setup - similar to MakerWorld */}
          <ambientLight intensity={0.6} />
          <directionalLight 
            position={[10, 10, 5]} 
            intensity={1.2} 
            castShadow
            shadow-mapSize={[1024, 1024]}
          />
          <directionalLight position={[-10, 5, -5]} intensity={0.5} />
          <pointLight position={[0, -5, 0]} intensity={0.3} />

          <Suspense fallback={null}>
            {stlModels.length > 1 ? (
              <MultiLayerModel models={stlModels} />
            ) : (
              stlModels.map((model) => (
                <STLModel 
                  key={model.index}
                  stlData={model.stlData}
                  color={model.color}
                  index={model.index}
                />
              ))
            )}
          </Suspense>

          {/* Grid - matching MakerWorld style */}
          <Grid
            args={[20, 20]}
            cellSize={0.5}
            cellThickness={0.6}
            cellColor="#3f3f46"
            sectionSize={2}
            sectionThickness={1}
            sectionColor="#52525b"
            fadeDistance={30}
            fadeStrength={1}
            followCamera={false}
            position={[0, -1.5, 0]}
          />

          {/* Smooth orbit controls */}
          <OrbitControls
            enablePan={true}
            enableZoom={true}
            enableRotate={true}
            minDistance={2}
            maxDistance={10}
            enableDamping={true}
            dampingFactor={0.05}
            rotateSpeed={0.5}
          />

          {/* Professional studio environment */}
          <Environment preset="city" />
        </Canvas>

        {/* Overlay controls */}
        <div className="absolute bottom-4 left-4 bg-black/70 backdrop-blur-sm text-white text-sm px-3 py-2 rounded-lg">
          <div className="flex items-center gap-2">
            <span className="text-xl">🖱️</span>
            <span>Arrastra para rotar • Scroll para zoom</span>
          </div>
        </div>
        
        {stlModels.length > 1 && (
          <div className="absolute top-4 right-4 bg-blue-600/90 backdrop-blur-sm text-white text-sm px-3 py-2 rounded-lg font-medium">
            🎨 {stlModels.length} colores detectados
          </div>
        )}
      </div>
    </div>
  )
}
