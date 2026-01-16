'use client'

import { useState } from 'react'
import ImageUploader from '@/components/ImageUploader'
import ParameterControls from '@/components/ParameterControls'
import Preview2D from '@/components/Preview2D'
import Preview3D from '@/components/Preview3D'
import JobStatus from '@/components/JobStatus'

export default function CrearLlaveroPage() {
  const [uploadedImage, setUploadedImage] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<string>('pending')
  const [dominantColors, setDominantColors] = useState<string[]>([])
  const [parameters, setParameters] = useState({
    width: 50,
    height: 50,
    thickness: 3,
    ringEnabled: true,
    ringDiameter: 5,
    ringThickness: 2,
    ringPosition: 'top' as 'top' | 'left' | 'right',
    threshold: 180,
    borderEnabled: true,
    borderThickness: 2,
    reliefEnabled: false,
  })

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
                onImageUpload={setUploadedImage}
                onJobCreated={setJobId}
              />
            </div>

            {/* Parámetros */}
            {uploadedImage && (
              <div className="bg-white rounded-xl shadow-lg p-6">
                <h2 className="text-xl font-bold mb-4">2. Ajustar Parámetros</h2>
                <ParameterControls
                  parameters={parameters}
                  onChange={setParameters}
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
                />
              </div>
            )}
          </div>

          {/* Panel Derecho - Preview */}
          <div className="space-y-6">
            {/* Preview 2D */}
            {uploadedImage && (
              <div className="bg-white rounded-xl shadow-lg p-6">
                <h2 className="text-xl font-bold mb-4">Preview 2D</h2>
                <Preview2D imageUrl={uploadedImage} />
              </div>
            )}

            {/* Preview 3D */}
            {jobId && (
              <div className="bg-white rounded-xl shadow-lg p-6">
                <h2 className="text-xl font-bold mb-4">Preview 3D</h2>
                <Preview3D jobId={jobId} status={jobStatus} dominantColors={dominantColors} />
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
