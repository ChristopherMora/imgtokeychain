'use client'

import { useState } from 'react'
import ImageUploader from '@/components/ImageUploader'
import ParameterControls from '@/components/ParameterControls'
import Preview2D from '@/components/Preview2D'
import Enhanced3DViewer from '@/components/Enhanced3DViewer'
import JobStatus from '@/components/JobStatus'
import ColorPicker from '@/components/ColorPicker'

export default function CrearLlaveroPage() {
  const [uploadedImage, setUploadedImage] = useState<string | null>(null)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [removeBackgroundEnabled, setRemoveBackgroundEnabled] = useState(true)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<string>('pending')
  const [dominantColors, setDominantColors] = useState<string[]>([])
  const [refreshPreview, setRefreshPreview] = useState(0) // Trigger for refreshing preview
  const [isGenerating, setIsGenerating] = useState(false)
  const [parameters, setParameters] = useState({
    width: 50,
    height: 50,
    thickness: 3,
    ringEnabled: true,
    ringDiameter: 5,
    ringThickness: 2,
    ringPosition: 'top' as 'top' | 'left' | 'right',
    threshold: 180,
    maxColors: 4,
    borderEnabled: false,
    borderThickness: 2,
    reliefEnabled: false,
  })

  const resetJobState = () => {
    setJobId(null)
    setJobStatus('pending')
    setDominantColors([])
    setRefreshPreview(0)
  }

  const handleGenerateKeychain = async () => {
    if (!uploadedFile) {
      return
    }

    setIsGenerating(true)
    setJobStatus('pending')
    
    try {
      const formData = new FormData()
      formData.append('file', uploadedFile)
      formData.append('params', JSON.stringify({
        ...parameters,
        removeBackgroundEnabled,
      }))

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'
      const response = await fetch(`${apiUrl}/jobs`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error('Error al generar llavero')
      }

      const data = await response.json()
      setJobId(data.id)
    } catch (err) {
      console.error('Error generating keychain:', err)
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-primary-600">
            🔑 Crear Llavero 3D
          </h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-2 gap-8">
          {/* Panel Izquierdo - Controles */}
          <div className="space-y-6">
            {/* Upload */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-bold mb-4">1. Subir Imagen</h2>
              <ImageUploader
                showPreview={!jobId}
                onImageUpload={(imageUrl) => {
                  setUploadedImage(imageUrl || null)
                  if (!imageUrl) {
                    setUploadedFile(null)
                    setRemoveBackgroundEnabled(true)
                  }
                  resetJobState()
                }}
                onFileSelected={(file, metadata) => {
                  setUploadedFile(file)
                  setRemoveBackgroundEnabled(metadata.removeBackgroundEnabled)
                  resetJobState()
                }}
              />
            </div>

            {/* Parámetros */}
            {uploadedImage && (
              <div className="bg-white rounded-xl shadow-lg p-6">
                <h2 className="text-xl font-bold mb-4">2. Ajustar Parámetros</h2>
                <ParameterControls
                  parameters={parameters}
                  onChange={setParameters}
                  onGenerate={handleGenerateKeychain}
                  isGenerating={isGenerating}
                />
              </div>
            )}

            {/* Estado del Job */}
            {jobId && (
              <div className="bg-white rounded-xl shadow-lg p-6">
                <h2 className="text-xl font-bold mb-4">3. Estado del Proceso</h2>
                <JobStatus 
                  jobId={jobId} 
                  onStatusChange={setJobStatus}
                  onColorsExtracted={setDominantColors}
                  showDownloads={!(jobStatus === 'COMPLETED' && dominantColors.length > 0)}
                  showColors={!(jobStatus === 'COMPLETED' && dominantColors.length > 0)}
                />
              </div>
            )}

            {/* Color Picker - Personalizar Colores */}
            {jobId && jobStatus === 'COMPLETED' && dominantColors.length > 0 && (
              <div className="bg-white rounded-xl shadow-lg p-6">
                <ColorPicker 
                  jobId={jobId}
                  initialColors={dominantColors}
                  onColorsChange={(newColors) => {
                    setDominantColors(newColors)
                    // Trigger preview refresh
                    setRefreshPreview(prev => prev + 1)
                  }}
                />
              </div>
            )}
          </div>

          {/* Panel Derecho - Preview */}
          <div className="space-y-6">
            {/* Preview 2D */}
            {uploadedImage && jobId && (
              <div className="bg-white rounded-xl shadow-lg p-6">
                <h2 className="text-xl font-bold mb-4">Preview 2D</h2>
                <Preview2D imageUrl={uploadedImage} jobId={jobId || undefined} />
              </div>
            )}

            {/* Enhanced 3D Viewer - MakerWorld Style */}
            {jobId && (
              <div>
                <h2 className="text-xl font-bold mb-4 text-gray-900">Preview 3D</h2>
                <Enhanced3DViewer 
                  jobId={jobId} 
                  status={jobStatus} 
                  dominantColors={dominantColors} 
                  key={`preview-${refreshPreview}`}
                />
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
