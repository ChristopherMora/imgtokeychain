'use client'

import { useState, useEffect } from 'react'
import { Palette, RotateCcw, Download, Loader } from 'lucide-react'

interface ColorPickerProps {
  jobId: string
  initialColors: string[]
  onColorsChange?: (colors: string[]) => void
  onDownload?: () => void
}

export default function ColorPicker({ jobId, initialColors, onColorsChange, onDownload }: ColorPickerProps) {
  const [colors, setColors] = useState<string[]>(initialColors)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // Actualizar colores cuando cambien los iniciales
  useEffect(() => {
    setColors(initialColors)
  }, [initialColors])

  const handleColorChange = (index: number, newColor: string) => {
    const updatedColors = [...colors]
    updatedColors[index] = newColor
    setColors(updatedColors)
  }

  const handleSaveColors = async () => {
    setIsSaving(true)
    setMessage(null)
    
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'
      const response = await fetch(`${apiUrl}/jobs/${jobId}/colors`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ colors }),
      })

      if (!response.ok) {
        throw new Error('Error al actualizar colores')
      }

      const data = await response.json()
      setMessage({ type: 'success', text: '✅ Colores actualizados correctamente' })
      
      // Notificar al componente padre
      if (onColorsChange) {
        onColorsChange(colors)
      }

      // Limpiar mensaje después de 3 segundos
      setTimeout(() => setMessage(null), 3000)
    } catch (error) {
      console.error('Error saving colors:', error)
      setMessage({ type: 'error', text: '❌ Error al guardar los colores' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleResetColors = () => {
    setColors(initialColors)
  }

  const handleDownload3MF = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'
      const response = await fetch(`${apiUrl}/jobs/${jobId}/download-multicolor`)
      
      if (!response.ok) {
        throw new Error('Error al descargar archivo')
      }

      // Crear un blob y descargar
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `llavero_${jobId}_multicolor.zip`)
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)

      if (onDownload) {
        onDownload()
      }
    } catch (error) {
      console.error('Error downloading:', error)
      setMessage({ type: 'error', text: '❌ Error al descargar el archivo' })
    }
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg border-2 border-purple-200 p-6">
        {/* Encabezado */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-purple-200 rounded-lg">
            <Palette className="h-6 w-6 text-purple-700" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-800">🎨 Personalizar Colores</h2>
            <p className="text-sm text-gray-600">Ajusta los colores de tu llavero antes de imprimir</p>
          </div>
        </div>

        {/* Mensaje de estado */}
        {message && (
          <div
            className={`mb-4 p-3 rounded-lg text-sm font-medium ${
              message.type === 'success'
                ? 'bg-green-100 text-green-800 border border-green-300'
                : 'bg-red-100 text-red-800 border border-red-300'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Grid de colores */}
        <div className="space-y-4 mb-6">
          {colors.map((color, index) => (
            <div
              key={index}
              className="flex items-center gap-4 p-4 bg-white rounded-lg border border-gray-200 hover:border-purple-400 transition-colors"
            >
              {/* Vista previa del color */}
              <div className="flex-shrink-0">
                <div className="text-sm font-semibold text-gray-600 mb-2">
                  Color {index + 1}
                </div>
                <div
                  className="w-16 h-16 rounded-lg border-4 border-gray-300 shadow-md transition-transform hover:scale-105"
                  style={{ backgroundColor: color }}
                  title={color}
                />
              </div>

              {/* Información del color */}
              <div className="flex-grow">
                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Código Hex
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={color}
                      onChange={(e) => handleColorChange(index, e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-200"
                      placeholder="#000000"
                    />
                  </div>
                </div>

                {/* Color Picker HTML5 */}
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Selector Visual
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => handleColorChange(index, e.target.value)}
                    className="h-10 w-20 rounded cursor-pointer border border-gray-300"
                  />
                  <span className="text-xs text-gray-500">Haz clic para cambiar</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Botones de acción */}
        <div className="space-y-3">
          <button
            onClick={handleSaveColors}
            disabled={isSaving}
            className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold py-3 px-4 rounded-lg hover:from-purple-700 hover:to-pink-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isSaving ? (
              <>
                <Loader className="h-5 w-5 animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                💾 Guardar Colores
              </>
            )}
          </button>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={handleResetColors}
              className="bg-gray-200 text-gray-800 font-medium py-2 px-4 rounded-lg hover:bg-gray-300 transition-colors flex items-center justify-center gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Restaurar
            </button>

            <button
              onClick={handleDownload3MF}
              className="bg-gradient-to-r from-blue-600 to-cyan-600 text-white font-medium py-2 px-4 rounded-lg hover:from-blue-700 hover:to-cyan-700 transition-all flex items-center justify-center gap-2"
            >
              <Download className="h-4 w-4" />
              Descargar ZIP
            </button>
          </div>
        </div>

        {/* Información útil */}
        <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <h3 className="font-semibold text-blue-900 mb-2">💡 Consejos:</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>✓ Escribe el código hex directamente (ej: #FF5733)</li>
            <li>✓ O usa el selector visual de colores</li>
            <li>✓ Haz clic en "Guardar Colores" para aplicar cambios</li>
            <li>✓ Descarga el ZIP con tu 3MF actualizado</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
