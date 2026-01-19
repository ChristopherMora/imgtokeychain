'use client'

import { useCallback, useState } from 'react'
import { Upload, X } from 'lucide-react'

interface ImageUploaderProps {
  onImageUpload: (imageUrl: string) => void
  onJobCreated: (jobId: string) => void
  onFileSelected?: (file: File) => void
  parameters?: any
}

export default function ImageUploader({ onImageUpload, onJobCreated, onFileSelected, parameters }: ImageUploaderProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const handleFile = async (file: File) => {
    setError(null)

    // Validaciones
    if (!file.type.match(/^image\/(png|jpeg|jpg)$/)) {
      setError('Solo se permiten archivos PNG o JPG')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('El archivo debe ser menor a 5MB')
      return
    }

    // Preview local
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      setPreview(result)
      onImageUpload(result)
    }
    reader.readAsDataURL(file)

    // Guardar archivo para regeneración
    if (onFileSelected) {
      onFileSelected(file)
    }

    // Upload al servidor
    setUploading(true)
    console.log('🔵 Iniciando upload a la API...')
    try {
      const formData = new FormData()
      formData.append('file', file)
      if (parameters) {
        formData.append('params', JSON.stringify(parameters))
      }

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4001/api'
      console.log('🔵 API URL:', apiUrl)
      console.log('🔵 Enviando POST a:', `${apiUrl}/jobs`)
      console.log('🔵 FormData contiene:', {
        hasFile: formData.has('file'),
        hasParams: formData.has('params'),
      })
      
      const response = await fetch(`${apiUrl}/jobs`, {
        method: 'POST',
        body: formData,
        mode: 'cors',
      }).catch(fetchErr => {
        console.error('❌ Fetch falló:', fetchErr)
        throw fetchErr
      })

      console.log('🔵 Response recibido:', response)
      console.log('🔵 Response status:', response.status)
      
      if (!response.ok) {
        throw new Error('Error al subir la imagen')
      }

      const data = await response.json()
      console.log('🔵 Job creado:', data.id)
      onJobCreated(data.id)
    } catch (err) {
      console.error('❌ Error en upload:', err)
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setUploading(false)
      console.log('🔵 Upload finalizado')
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const handleClear = () => {
    setPreview(null)
    setError(null)
    onImageUpload('')
  }

  return (
    <div className="space-y-4">
      {!preview ? (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`
            border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
            transition-colors
            ${isDragging
              ? 'border-primary-500 bg-primary-50'
              : 'border-gray-300 hover:border-primary-400'
            }
          `}
        >
          <input
            type="file"
            id="file-upload"
            className="hidden"
            accept="image/png,image/jpeg,image/jpg"
            onChange={handleFileInput}
            disabled={uploading}
          />
          
          <label htmlFor="file-upload" className="cursor-pointer">
            <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <p className="text-lg font-semibold text-gray-700 mb-2">
              {uploading ? 'Subiendo...' : 'Arrastra tu imagen aquí'}
            </p>
            <p className="text-sm text-gray-500">
              o haz clic para seleccionar
            </p>
            <p className="text-xs text-gray-400 mt-2">
              PNG o JPG (máx. 5MB)
            </p>
          </label>
        </div>
      ) : (
        <div className="relative">
          <img
            src={preview}
            alt="Preview"
            className="w-full h-64 object-contain bg-gray-50 rounded-lg"
          />
          <button
            onClick={handleClear}
            className="absolute top-2 right-2 p-2 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {uploading && (
        <div className="flex items-center justify-center py-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <span className="ml-3 text-gray-600">Procesando...</span>
        </div>
      )}
    </div>
  )
}
