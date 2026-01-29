'use client'

import { useEffect, useState } from 'react'

interface Preview2DProps {
  imageUrl: string
  jobId?: string
}

export default function Preview2D({ imageUrl, jobId }: Preview2DProps) {
  const [compositeUrl, setCompositeUrl] = useState<string | null>(null)
  const [showComposite, setShowComposite] = useState(false)
  
  useEffect(() => {
    if (jobId) {
      // Intentar cargar la imagen compuesta
      const checkComposite = async () => {
        try {
          const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4001'
          const response = await fetch(`${apiUrl}/api/jobs/${jobId}/composite`)
          if (response.ok) {
            const blob = await response.blob()
            const url = URL.createObjectURL(blob)
            setCompositeUrl(url)
            setShowComposite(true)
          }
        } catch (error) {
          console.log('Composite not ready yet')
        }
      }
      
      // Verificar cada 2 segundos
      const interval = setInterval(checkComposite, 2000)
      checkComposite() // Check inmediato
      
      return () => {
        clearInterval(interval)
        if (compositeUrl) URL.revokeObjectURL(compositeUrl)
      }
    }
  }, [jobId])
  
  const displayUrl = showComposite && compositeUrl ? compositeUrl : imageUrl
  
  return (
    <div className="relative">
      <div className="relative aspect-square bg-gray-50 rounded-lg overflow-hidden">
        <img
          src={displayUrl}
          alt="Preview 2D"
          className="w-full h-full object-contain"
        />
        
        {/* Grid de referencia */}
        <div className="absolute inset-0 pointer-events-none">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern
                id="grid"
                width="20"
                height="20"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 20 0 L 0 0 0 20"
                  fill="none"
                  stroke="rgba(0,0,0,0.05)"
                  strokeWidth="0.5"
                />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>

        {/* Info overlay */}
        <div className="absolute bottom-2 right-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
          {showComposite ? 'Segmentación de Colores' : 'Vista 2D'}
        </div>
      </div>
      
      {/* Toggle button si existe composite */}
      {compositeUrl && (
        <div className="mt-2 flex justify-center">
          <button
            onClick={() => setShowComposite(!showComposite)}
            className="text-sm text-blue-600 hover:text-blue-800 underline"
          >
            {showComposite ? 'Ver original' : 'Ver segmentación'}
          </button>
        </div>
      )}
    </div>
  )
}
