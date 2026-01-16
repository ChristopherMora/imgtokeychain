'use client'

interface ParameterControlsProps {
  parameters: {
    width: number
    height: number
    thickness: number
    ringEnabled: boolean
    ringDiameter: number
    ringThickness: number
    ringPosition: 'top' | 'left' | 'right'
    threshold?: number
    borderEnabled?: boolean
    borderThickness?: number
    reliefEnabled?: boolean
  }
  onChange: (params: any) => void
}

export default function ParameterControls({ parameters, onChange }: ParameterControlsProps) {
  const updateParam = (key: string, value: any) => {
    onChange({ ...parameters, [key]: value })
  }

  return (
    <div className="space-y-6">
      {/* Dimensiones */}
      <div>
        <h3 className="font-semibold mb-3 text-gray-700">Dimensiones (mm)</h3>
        
        <div className="space-y-3">
          <div>
            <label className="flex justify-between text-sm mb-1">
              <span>Ancho</span>
              <span className="font-mono text-primary-600">{parameters.width}mm</span>
            </label>
            <input
              type="range"
              min="10"
              max="100"
              value={parameters.width}
              onChange={(e) => updateParam('width', Number(e.target.value))}
              className="w-full"
            />
          </div>

          <div>
            <label className="flex justify-between text-sm mb-1">
              <span>Alto</span>
              <span className="font-mono text-primary-600">{parameters.height}mm</span>
            </label>
            <input
              type="range"
              min="10"
              max="100"
              value={parameters.height}
              onChange={(e) => updateParam('height', Number(e.target.value))}
              className="w-full"
            />
          </div>

          <div>
            <label className="flex justify-between text-sm mb-1">
              <span>Grosor</span>
              <span className="font-mono text-primary-600">{parameters.thickness}mm</span>
            </label>
            <input
              type="range"
              min="2"
              max="10"
              step="0.5"
              value={parameters.thickness}
              onChange={(e) => updateParam('thickness', Number(e.target.value))}
              className="w-full"
            />
          </div>
        </div>
      </div>

      {/* Calidad de Imagen */}
      <div>
        <h3 className="font-semibold mb-3 text-gray-700">Calidad de Imagen</h3>
        
        <div>
          <label className="flex justify-between text-sm mb-1">
            <span>Umbral de detección</span>
            <span className="font-mono text-primary-600">{parameters.threshold || 180}</span>
          </label>
          <input
            type="range"
            min="100"
            max="220"
            step="5"
            value={parameters.threshold || 180}
            onChange={(e) => updateParam('threshold', Number(e.target.value))}
            className="w-full"
          />
          <p className="text-xs text-gray-500 mt-1">
            Menor = más detalle (puede incluir ruido) • Mayor = más limpio (puede perder detalle)
          </p>
        </div>
      </div>

      {/* Borde del Llavero */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-700">Borde Marco</h3>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={parameters.borderEnabled ?? true}
              onChange={(e) => updateParam('borderEnabled', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
          </label>
        </div>

        {(parameters.borderEnabled ?? true) && (
          <div className="pl-4 border-l-2 border-primary-200">
            <label className="flex justify-between text-sm mb-1">
              <span>Grosor del borde</span>
              <span className="font-mono text-primary-600">{parameters.borderThickness || 2}mm</span>
            </label>
            <input
              type="range"
              min="1"
              max="5"
              step="0.5"
              value={parameters.borderThickness || 2}
              onChange={(e) => updateParam('borderThickness', Number(e.target.value))}
              className="w-full"
            />
            <p className="text-xs text-gray-500 mt-1">
              Borde alrededor del logo para darle forma de llavero
            </p>
          </div>
        )}
      </div>

      {/* Relieve 3D */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-700">Relieve 3D</h3>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={parameters.reliefEnabled ?? false}
              onChange={(e) => updateParam('reliefEnabled', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
          </label>
        </div>
        
        {parameters.reliefEnabled && (
          <div className="pl-4 border-l-2 border-primary-200">
            <p className="text-xs text-gray-500">
              El logo sobresaldrá sobre una base plana
            </p>
          </div>
        )}
      </div>

      {/* Aro */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-700">Aro para Llavero</h3>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={parameters.ringEnabled}
              onChange={(e) => updateParam('ringEnabled', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
          </label>
        </div>

        {parameters.ringEnabled && (
          <div className="space-y-3 pl-4 border-l-2 border-primary-200">
            <div>
              <label className="flex justify-between text-sm mb-1">
                <span>Diámetro</span>
                <span className="font-mono text-primary-600">{parameters.ringDiameter}mm</span>
              </label>
              <input
                type="range"
                min="3"
                max="8"
                step="0.5"
                value={parameters.ringDiameter}
                onChange={(e) => updateParam('ringDiameter', Number(e.target.value))}
                className="w-full"
              />
            </div>

            <div>
              <label className="flex justify-between text-sm mb-1">
                <span>Grosor del aro</span>
                <span className="font-mono text-primary-600">{parameters.ringThickness}mm</span>
              </label>
              <input
                type="range"
                min="1"
                max="4"
                step="0.5"
                value={parameters.ringThickness}
                onChange={(e) => updateParam('ringThickness', Number(e.target.value))}
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-sm mb-2">Posición</label>
              <div className="grid grid-cols-3 gap-2">
                {(['top', 'left', 'right'] as const).map((pos) => (
                  <button
                    key={pos}
                    onClick={() => updateParam('ringPosition', pos)}
                    className={`
                      px-3 py-2 rounded-lg font-medium text-sm transition-colors
                      ${parameters.ringPosition === pos
                        ? 'bg-primary-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }
                    `}
                  >
                    {pos === 'top' ? 'Arriba' : pos === 'left' ? 'Izq.' : 'Der.'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Botón Generar */}
      <button
        className="w-full py-3 bg-primary-600 text-white rounded-lg font-semibold hover:bg-primary-700 transition-colors shadow-lg"
      >
        🚀 Generar Llavero 3D
      </button>
    </div>
  )
}
