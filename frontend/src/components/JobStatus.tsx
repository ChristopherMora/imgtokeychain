'use client'

import { useEffect, useState } from 'react'
import { CheckCircle, Clock, AlertCircle, Download } from 'lucide-react'

interface JobStatusProps {
  jobId: string
  onStatusChange?: (status: string) => void
  onColorsExtracted?: (colors: string[]) => void
}

interface Job {
  id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number
  errorMessage?: string
  stlPath?: string
  dominantColors?: string[]
}

export default function JobStatus({ jobId, onStatusChange, onColorsExtracted }: JobStatusProps) {
  const [job, setJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(true)
  const [colors, setColors] = useState<string[]>([])

  useEffect(() => {
    if (!jobId) return

    const fetchStatus = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'
        const response = await fetch(`${apiUrl}/jobs/${jobId}`)
        
        if (response.ok) {
          const data = await response.json()
          // Normalizar status a minúsculas para consistencia
          const normalizedJob = {
            ...data,
            status: data.status.toLowerCase()
          }
          setJob(normalizedJob)
          
          // Update local colors state
          if (data.dominantColors && data.dominantColors.length > 0) {
            setColors(data.dominantColors)
          }
          
          // Notify parent of status change
          if (onStatusChange && data.status) {
            onStatusChange(data.status.toUpperCase())
          }
          
          // Notify parent of colors if extracted
          if (onColorsExtracted && data.dominantColors && data.dominantColors.length > 0) {
            onColorsExtracted(data.dominantColors)
          }
        }
      } catch (error) {
        console.error('Error fetching job status:', error)
      } finally {
        setLoading(false)
      }
    }

    // Fetch inicial
    fetchStatus()

    // Poll cada 2 segundos mientras no esté completado
    const interval = setInterval(() => {
      fetchStatus()
    }, 2000)

    return () => clearInterval(interval)
  }, [jobId, onStatusChange, onColorsExtracted])

  if (loading) {
    return <div className="text-center text-gray-600">Cargando...</div>
  }

  if (!job) {
    return <div className="text-center text-red-600">No se pudo cargar el estado</div>
  }

  const getStatusIcon = () => {
    switch (job.status) {
      case 'pending':
        return <Clock className="h-6 w-6 text-yellow-500 animate-pulse" />
      case 'processing':
        return <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500" />
      case 'completed':
        return <CheckCircle className="h-6 w-6 text-green-500" />
      case 'failed':
        return <AlertCircle className="h-6 w-6 text-red-500" />
    }
  }

  const getStatusText = () => {
    switch (job.status) {
      case 'pending':
        return 'En cola...'
      case 'processing':
        return 'Procesando...'
      case 'completed':
        return '¡Completado!'
      case 'failed':
        return 'Error'
    }
  }

  return (
    <div className="space-y-4">
      {/* Estado */}
      <div className="flex items-center gap-3">
        {getStatusIcon()}
        <div className="flex-1">
          <p className="font-semibold">{getStatusText()}</p>
          <p className="text-sm text-gray-500">Job ID: {jobId.slice(0, 8)}</p>
        </div>
      </div>

      {/* Barra de progreso */}
      <div className="space-y-1">
        <div className="flex justify-between text-sm text-gray-600">
          <span>Progreso</span>
          <span>{job.progress}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
          <div
            className="bg-primary-600 h-full transition-all duration-300 ease-out"
            style={{ width: `${job.progress}%` }}
          />
        </div>
      </div>

      {/* Colores detectados */}
      {colors.length > 0 && (
        <div className="p-3 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border border-purple-200">
          <div className="font-semibold text-sm text-gray-700 mb-2">
            🎨 Colores detectados ({colors.length}):
          </div>
          <div className="flex flex-wrap gap-2">
            {colors.map((color, index) => (
              <div key={index} className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-md shadow-sm border border-gray-200">
                <div
                  className="w-6 h-6 rounded border-2 border-gray-300 shadow-sm"
                  style={{ backgroundColor: color }}
                  title={color}
                />
                <span className="text-xs font-mono text-gray-600">{color}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error message */}
      {job.status === 'failed' && job.errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
          {job.errorMessage}
        </div>
      )}

      {/* Botón de descarga */}
      {job.status === 'completed' && (
        <div className="space-y-2">
          <a
            href={`${process.env.NEXT_PUBLIC_API_URL}/jobs/${jobId}/download-multicolor`}
            download={`llavero_multicolor_${jobId}.zip`}
            className="flex items-center justify-center gap-2 w-full py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg font-semibold hover:from-purple-700 hover:to-pink-700 transition-all shadow-lg"
          >
            <Download className="h-5 w-5" />
            🎨 Descargar Llavero Multi-Color (ZIP)
          </a>
          
          <div className="text-xs text-gray-700 mt-2 p-3 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border border-purple-200">
            <div className="font-bold mb-1">📦 Contenido del ZIP:</div>
            <ul className="list-disc list-inside space-y-1 text-gray-600">
              <li>Archivo 3MF listo para Bambu Studio/PrusaSlicer</li>
              <li>{colors.length} archivos STL (uno por color detectado)</li>
              <li>colors.json con códigos hex de cada color</li>
              <li>README.txt con guía de uso</li>
            </ul>
            <div className="mt-2 text-gray-600">
              <strong>Cómo usar:</strong> Abre el archivo .3mf en tu slicer - los colores ya están asignados automáticamente. Alternativamente, importa los STL individuales del ZIP.
            </div>
          </div>
          
          <a
            href={`${process.env.NEXT_PUBLIC_API_URL}/jobs/${jobId}/download`}
            download={`llavero_${jobId}.stl`}
            className="flex items-center justify-center gap-2 w-full py-2 bg-gray-600 text-white rounded-lg font-medium hover:bg-gray-700 transition-colors text-sm"
          >
            <Download className="h-4 w-4" />
            Descargar Solo Color Principal (STL)
          </a>
        </div>
      )}
    </div>
  )
}
