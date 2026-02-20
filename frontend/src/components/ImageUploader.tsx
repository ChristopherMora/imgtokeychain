'use client'

import { useCallback, useState } from 'react'
import { Upload, X } from 'lucide-react'
import ImageCropper from './ImageCropper'

interface ImageUploaderProps {
  onImageUpload: (imageUrl: string) => void
  onFileSelected?: (file: File, metadata: { removeBackgroundEnabled: boolean }) => void
  showPreview?: boolean
}

export default function ImageUploader({ onImageUpload, onFileSelected, showPreview = true }: ImageUploaderProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [pendingImage, setPendingImage] = useState<string | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [showCropper, setShowCropper] = useState(false)

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

    // Preview local para recorte
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      setPendingImage(result)
      setPendingFile(file)
      setShowCropper(true)
    }
    reader.readAsDataURL(file)
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
    e.target.value = ''
  }

  const handleClear = () => {
    setPreview(null)
    setFileName(null)
    setError(null)
    setPendingImage(null)
    setPendingFile(null)
    onImageUpload('')
  }

  const applyFile = (
    file: File,
    dataUrl: string,
    metadata: { removeBackgroundEnabled: boolean }
  ) => {
    setPreview(dataUrl)
    setFileName(file.name)
    onImageUpload(dataUrl)
    if (onFileSelected) onFileSelected(file, metadata)
  }

  const handleUseOriginal = () => {
    if (!pendingImage || !pendingFile) return
    applyFile(pendingFile, pendingImage, { removeBackgroundEnabled: false })
    setShowCropper(false)
  }

  const handleConfirmCrop = (result: {
    blob: Blob
    dataUrl: string
    removeBackgroundEnabled: boolean
  }) => {
    if (!pendingFile) return
    const croppedFile = new File([result.blob], `crop_${pendingFile.name.replace(/\.(png|jpg|jpeg)$/i, '')}.png`, {
      type: 'image/png',
    })
    applyFile(croppedFile, result.dataUrl, { removeBackgroundEnabled: result.removeBackgroundEnabled })
    setShowCropper(false)
  }

  const handleCancelCrop = () => {
    setPendingImage(null)
    setPendingFile(null)
    setShowCropper(false)
  }

  return (
    <div className="space-y-4">
      {showCropper && pendingImage && (
        <ImageCropper
          src={pendingImage}
          onCancel={handleCancelCrop}
          onConfirm={handleConfirmCrop}
          onUseOriginal={handleUseOriginal}
        />
      )}
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
          />
          
          <label htmlFor="file-upload" className="cursor-pointer">
            <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <p className="text-lg font-semibold text-gray-700 mb-2">
              Arrastra tu imagen aquí
            </p>
            <p className="text-sm text-gray-500">
              o haz clic para seleccionar
            </p>
            <p className="text-xs text-gray-400 mt-2">
              PNG o JPG (máx. 5MB)
            </p>
          </label>
        </div>
      ) : showPreview ? (
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
      ) : (
        <div className="flex items-center justify-between gap-3 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
          <div className="text-sm text-gray-700">
            Imagen cargada: <span className="font-medium">{fileName || 'archivo'}</span>
          </div>
          <button
            onClick={handleClear}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-100"
          >
            <X className="h-4 w-4" />
            Cambiar
          </button>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}
    </div>
  )
}
