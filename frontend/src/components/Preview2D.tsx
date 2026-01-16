'use client'

interface Preview2DProps {
  imageUrl: string
}

export default function Preview2D({ imageUrl }: Preview2DProps) {
  return (
    <div className="relative aspect-square bg-gray-50 rounded-lg overflow-hidden">
      <img
        src={imageUrl}
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
        Vista 2D
      </div>
    </div>
  )
}
