'use client'

import { useEffect, useState, Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment, Grid } from '@react-three/drei'
import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

interface Preview3DProps {
  jobId: string
  status?: string
  dominantColors?: string[]
  originalImage?: string
}

interface MultiSTLModel {
  stlData: ArrayBuffer
  color: string
  index: number
}

interface STLModelProps {
  stlData: ArrayBuffer
  color?: string
  index: number
  onBoundingBox: (index: number, box: THREE.Box3) => void
}

function STLModel({ stlData, color, index, onBoundingBox }: STLModelProps) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null)

  const optimizePreviewGeometry = (geo: THREE.BufferGeometry): THREE.BufferGeometry => {
    const merged = mergeVertices(geo, 1e-4)
    merged.computeVertexNormals()
    merged.computeBoundingBox()
    return merged
  }
  
  // ASCII STL parser
  const parseAsciiSTL = (buffer: ArrayBuffer): THREE.BufferGeometry => {
    const text = new TextDecoder().decode(buffer)
    const vertices: number[] = []
    
    // Match all vertices
    const vertexPattern = /vertex\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)/g
    
    let vertexMatch
    while ((vertexMatch = vertexPattern.exec(text)) !== null) {
      vertices.push(
        parseFloat(vertexMatch[1]),
        parseFloat(vertexMatch[3]),
        parseFloat(vertexMatch[5])
      )
    }
    
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    return optimizePreviewGeometry(geometry)
  }
  
  useEffect(() => {
    // Parse STL (supports both ASCII and binary formats)
    const parseSTL = (buffer: ArrayBuffer): THREE.BufferGeometry => {
      const view = new DataView(buffer)
      const text = new TextDecoder().decode(buffer.slice(0, 80))
      const isAscii = /^solid/i.test(text.trim())
      
      if (isAscii) {
        // Parse ASCII STL
        return parseAsciiSTL(buffer)
      }
      
      // Binary STL format
      const faces = view.getUint32(80, true)
      const vertices: number[] = []
      
      for (let i = 0; i < faces; i++) {
        const offset = 84 + i * 50

        // 3 vertices per face
        for (let j = 0; j < 3; j++) {
          const vOffset = offset + 12 + j * 12
          vertices.push(
            view.getFloat32(vOffset, true),
            view.getFloat32(vOffset + 4, true),
            view.getFloat32(vOffset + 8, true)
          )
        }
      }
      
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
      return optimizePreviewGeometry(geometry)
    }
    
    try {
      const geo = parseSTL(stlData)
      geo.computeBoundingBox()
      if (geo.boundingBox) {
        onBoundingBox(index, geo.boundingBox.clone())
      }
      setGeometry(geo)
    } catch (error) {
      console.error('Error parsing STL:', error)
    }
  }, [stlData, index, onBoundingBox])
  
  if (!geometry) return null
  
  // Usar color recibido por prop o azul por defecto
  const modelColor = color || '#0ea5e9'
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color={modelColor} metalness={0.3} roughness={0.4} />
    </mesh>
  )
}

export default function Preview3D({ jobId, status, dominantColors }: Preview3DProps) {
  const [stlModels, setStlModels] = useState<MultiSTLModel[]>([])
  const [boundingBoxes, setBoundingBoxes] = useState<Record<number, THREE.Box3>>({})
  const [groupScale, setGroupScale] = useState(1)
  const [groupCenter, setGroupCenter] = useState<THREE.Vector3>(new THREE.Vector3(0, 0, 0))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (stlModels.length === 0) {
      setBoundingBoxes({})
      setGroupScale(1)
      setGroupCenter(new THREE.Vector3(0, 0, 0))
      return
    }
    setBoundingBoxes({})
  }, [stlModels])

  const handleBoundingBox = (index: number, box: THREE.Box3) => {
    setBoundingBoxes(prev => {
      const next = { ...prev, [index]: box }
      return next
    })
  }

  useEffect(() => {
    if (stlModels.length === 0) return
    if (Object.keys(boundingBoxes).length < stlModels.length) return

    const union = new THREE.Box3()
    let initialized = false
    for (const model of stlModels) {
      const box = boundingBoxes[model.index]
      if (!box) continue
      if (!initialized) {
        union.copy(box)
        initialized = true
      } else {
        union.union(box)
      }
    }
    if (!initialized) return

    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    union.getSize(size)
    union.getCenter(center)
    const maxDim = Math.max(size.x, size.y, size.z, 1e-6)
    setGroupScale(3 / maxDim)
    setGroupCenter(center)
  }, [boundingBoxes, stlModels])

  useEffect(() => {
    // Only fetch STL when job is completed
    if (status === 'COMPLETED' || status === 'completed') {
      setLoading(true)
      setError(null)
      
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'
      
      // Check if we have multiple colors
      const hasMultipleColors = dominantColors && dominantColors.length > 1
      
      if (hasMultipleColors) {
        // Load all color STLs
        const loadPromises = dominantColors!.map((color, index) => {
          const url = `${apiUrl}/jobs/${jobId}/color/${index}`
          return fetch(url)
            .then(response => {
              if (!response.ok) throw new Error(`Color ${index} STL not available`)
              return response.arrayBuffer()
            })
            .then(buffer => ({ stlData: buffer, color, index }))
            .catch(err => {
              console.warn(`Preview3D: Could not load color ${index}:`, err)
              // Return null on error, we'll filter it out
              return null
            })
        })
        
        Promise.all(loadPromises)
          .then(models => {
            // Filter out null models (failed downloads)
            const validModels = models.filter((m): m is MultiSTLModel => m !== null)
            
            if (validModels.length === 0) {
              // If all color STLs failed, fall back to main STL
              console.warn('Preview3D: All color STLs failed, falling back to main STL')
              loadMainSTL()
            } else {
              console.log(`Preview3D: Loaded ${validModels.length} color STLs`)
              setStlModels(validModels)
              setLoading(false)
            }
          })
          .catch(err => {
            console.error('Preview3D: Error loading color STLs, falling back to main:', err)
            // Fallback to main STL
            loadMainSTL()
          })
      } else {
        // Load single main STL
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
          const mainColor = dominantColors && dominantColors.length > 0 
            ? dominantColors[0] 
            : '#0ea5e9'
          setStlModels([{ stlData: buffer, color: mainColor, index: 0 }])
          setLoading(false)
        })
        .catch(err => {
          console.error('Preview3D: Error loading STL:', err)
          setError(err.message || 'Error al cargar STL')
          setLoading(false)
        })
    }
  }, [jobId, status, dominantColors])

  if (loading || status === 'PROCESSING' || status === 'PENDING' || status === 'processing' || status === 'pending') {
    return (
      <div className="aspect-square bg-gray-900 rounded-lg flex items-center justify-center">
        <div className="text-white text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p>Generando modelo 3D...</p>
        </div>
      </div>
    )
  }

  if (error || stlModels.length === 0) {
    return (
      <div className="aspect-square bg-gray-900 rounded-lg flex items-center justify-center">
        <div className="text-white text-center">
          <div className="text-4xl mb-4">📦</div>
          <p>{error || 'Preview no disponible'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="aspect-square bg-gray-900 rounded-lg overflow-hidden relative">
      <Canvas camera={{ position: [0, 0, 5], fov: 50 }}>
        {/* Iluminación */}
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1} />
        <pointLight position={[-10, -10, -5]} intensity={0.5} />

        {/* Multiple STL Models */}
        <Suspense fallback={null}>
          <group scale={[groupScale, groupScale, groupScale]}>
            <group position={[-groupCenter.x, -groupCenter.y, -groupCenter.z]}>
              {stlModels.map((model) => (
                <STLModel 
                  key={model.index}
                  stlData={model.stlData}
                  color={model.color}
                  index={model.index}
                  onBoundingBox={handleBoundingBox}
                />
              ))}
            </group>
          </group>
        </Suspense>

        {/* Grid */}
        <Grid
          args={[10, 10]}
          cellSize={0.5}
          cellThickness={0.5}
          cellColor="#6b7280"
          sectionSize={1}
          sectionThickness={1}
          sectionColor="#9ca3af"
          fadeDistance={25}
          fadeStrength={1}
          followCamera={false}
        />

        {/* Controles */}
        <OrbitControls
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          minDistance={2}
          maxDistance={10}
        />

        {/* Environment */}
        <Environment preset="studio" />
      </Canvas>

      {/* Controles overlay */}
      <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
        🖱️ Click y arrastra para rotar • Scroll para zoom
      </div>
      
      {stlModels.length > 1 && (
        <div className="absolute top-2 right-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
          🎨 {stlModels.length} colores
        </div>
      )}
    </div>
  )
}
