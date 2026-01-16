'use client'

import { useEffect, useState, Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment, Grid } from '@react-three/drei'
import * as THREE from 'three'

interface Preview3DProps {
  jobId: string
  status?: string
  dominantColors?: string[]
}

function STLModel({ stlData, dominantColors }: { stlData: ArrayBuffer; dominantColors?: string[] }) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null)
  
  // ASCII STL parser
  const parseAsciiSTL = (buffer: ArrayBuffer): THREE.BufferGeometry => {
    const text = new TextDecoder().decode(buffer)
    const vertices: number[] = []
    const normals: number[] = []
    
    // Match all vertices and normals
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
      
      // Each facet has 3 vertices, all share the same normal
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
      const normals: number[] = []
      
      for (let i = 0; i < faces; i++) {
        const offset = 84 + i * 50
        
        // Normal
        const nx = view.getFloat32(offset, true)
        const ny = view.getFloat32(offset + 4, true)
        const nz = view.getFloat32(offset + 8, true)
        
        // 3 vertices per face
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
    
    try {
      const geo = parseSTL(stlData)
      setGeometry(geo)
    } catch (error) {
      console.error('Error parsing STL:', error)
    }
  }, [stlData])
  
  if (!geometry) return null
  
  // Center and scale the geometry
  geometry.center()
  geometry.computeBoundingBox()
  const boundingBox = geometry.boundingBox!
  const size = new THREE.Vector3()
  boundingBox.getSize(size)
  const maxDim = Math.max(size.x, size.y, size.z)
  const scale = 3 / maxDim
  
  // Use dominant color or default blue
  const modelColor = dominantColors && dominantColors.length > 0 
    ? dominantColors[0] 
    : '#0ea5e9'
  
  return (
    <mesh geometry={geometry} scale={scale}>
      <meshStandardMaterial color={modelColor} metalness={0.3} roughness={0.4} />
    </mesh>
  )
}

export default function Preview3D({ jobId, status, dominantColors }: Preview3DProps) {
  const [stlData, setStlData] = useState<ArrayBuffer | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Only fetch STL when job is completed
    if (status === 'COMPLETED' || status === 'completed') {
      setLoading(true)
      setError(null)
      
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'
      const url = `${apiUrl}/jobs/${jobId}/download`
      
      console.log('Preview3D: Fetching STL from:', url, 'Status:', status)
      
      fetch(url)
        .then(response => {
          console.log('Preview3D: Response status:', response.status)
          if (!response.ok) {
            throw new Error('STL no disponible')
          }
          return response.arrayBuffer()
        })
        .then(buffer => {
          console.log('Preview3D: STL loaded, size:', buffer.byteLength, 'bytes')
          setStlData(buffer)
          setLoading(false)
        })
        .catch(err => {
          console.error('Preview3D: Error loading STL:', err)
          setError(err.message || 'Error al cargar STL')
          setLoading(false)
        })
    } else if (status === 'FAILED' || status === 'failed') {
      setError('Error en generación')
      setLoading(false)
    } else {
      console.log('Preview3D: Waiting for completion. Current status:', status)
    }
  }, [jobId, status])

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

  if (error || !stlData) {
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

        {/* STL Model */}
        <Suspense fallback={null}>
          <STLModel stlData={stlData} dominantColors={dominantColors} />
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
    </div>
  )
}
