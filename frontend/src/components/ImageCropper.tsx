/* eslint-disable jsx-a11y/alt-text */
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

type CropRect = { x: number; y: number; width: number; height: number }

interface ImageCropperProps {
  src: string
  onCancel: () => void
  onConfirm: (result: { blob: Blob; dataUrl: string }) => void
  onUseOriginal?: () => void
}

const ASPECT_OPTIONS = [
  { label: 'Libre', value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:2', value: 3 / 2 },
  { label: '16:9', value: 16 / 9 },
]

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })

const detectBackgroundColor = (data: Uint8ClampedArray, width: number, height: number) => {
  const sampleSize = Math.max(2, Math.round(Math.min(width, height) * 0.02))
  const samples: number[] = []
  const corners = [
    { x: 0, y: 0 },
    { x: width - sampleSize, y: 0 },
    { x: 0, y: height - sampleSize },
    { x: width - sampleSize, y: height - sampleSize },
  ]

  for (const corner of corners) {
    for (let y = corner.y; y < corner.y + sampleSize; y++) {
      for (let x = corner.x; x < corner.x + sampleSize; x++) {
        if (x < 0 || x >= width || y < 0 || y >= height) continue
        const idx = (y * width + x) * 4
        samples.push(data[idx], data[idx + 1], data[idx + 2])
      }
    }
  }

  let totalR = 0
  let totalG = 0
  let totalB = 0
  const count = samples.length / 3
  for (let i = 0; i < samples.length; i += 3) {
    totalR += samples[i]
    totalG += samples[i + 1]
    totalB += samples[i + 2]
  }
  return {
    r: Math.round(totalR / count),
    g: Math.round(totalG / count),
    b: Math.round(totalB / count),
  }
}

const computeBackgroundTolerance = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  backgroundColor: { r: number; g: number; b: number },
  threshold: number
) => {
  const distances: number[] = []
  const step = Math.max(1, Math.floor(Math.min(width, height) / 100))

  const colorDistance = (idx: number) => {
    const r = data[idx]
    const g = data[idx + 1]
    const b = data[idx + 2]
    return Math.sqrt(
      Math.pow(r - backgroundColor.r, 2) +
        Math.pow(g - backgroundColor.g, 2) +
        Math.pow(b - backgroundColor.b, 2)
    )
  }

  for (let x = 0; x < width; x += step) {
    distances.push(colorDistance((0 * width + x) * 4))
    distances.push(colorDistance(((height - 1) * width + x) * 4))
  }
  for (let y = 0; y < height; y += step) {
    distances.push(colorDistance((y * width + 0) * 4))
    distances.push(colorDistance((y * width + (width - 1)) * 4))
  }

  distances.sort((a, b) => a - b)
  const p90 = distances[Math.floor(distances.length * 0.9)] || 0
  let baseTolerance = Math.round(p90 * 1.1 + 4)

  const normalized = Math.min(1, Math.max(0, (threshold - 100) / 120))
  const sliderFactor = 0.85 + normalized * 0.4
  baseTolerance = Math.round(baseTolerance * sliderFactor)

  return Math.min(60, Math.max(10, baseTolerance))
}

const rgbToHsl = (r: number, g: number, b: number) => {
  r /= 255
  g /= 255
  b /= 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6
        break
      case g:
        h = ((b - r) / d + 2) / 6
        break
      case b:
        h = ((r - g) / d + 4) / 6
        break
      default:
        break
    }
  }

  return { h: h * 360, s, l }
}

const dilateMask = (mask: Uint8Array, width: number, height: number, radius: number) => {
  const output = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      if (mask[idx] === 1) {
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
            output[ny * width + nx] = 1
          }
        }
      }
    }
  }
  return output
}

const erodeMask = (mask: Uint8Array, width: number, height: number, radius: number) => {
  const output = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let keep = 1
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
            keep = 0
            break
          }
          if (mask[ny * width + nx] === 0) {
            keep = 0
            break
          }
        }
        if (!keep) break
      }
      output[y * width + x] = keep
    }
  }
  return output
}

const closeMask = (mask: Uint8Array, width: number, height: number, radius: number) => {
  const dilated = dilateMask(mask, width, height, radius)
  return erodeMask(dilated, width, height, radius)
}

const removeSmallComponents = (mask: Uint8Array, width: number, height: number, minArea: number) => {
  const visited = new Uint8Array(mask.length)
  const stack = new Int32Array(mask.length)
  const neighbors = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
  ] as const

  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 0 || visited[i] === 1) continue
    let top = 0
    stack[top++] = i
    visited[i] = 1
    const component: number[] = []

    while (top > 0) {
      const idx = stack[--top]
      component.push(idx)
      const x = idx % width
      const y = Math.floor(idx / width)
      for (const [dx, dy] of neighbors) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const nidx = ny * width + nx
        if (mask[nidx] === 0 || visited[nidx] === 1) continue
        visited[nidx] = 1
        stack[top++] = nidx
      }
    }

    if (component.length < minArea) {
      for (const idx of component) {
        mask[idx] = 0
      }
    }
  }

  return mask
}

const removeBackgroundFromImageData = (imageData: ImageData, threshold: number) => {
  const { data, width, height } = imageData
  const pixelCount = width * height
  let transparentPixels = 0

  for (let i = 0; i < pixelCount; i++) {
    if (data[i * 4 + 3] < 250) transparentPixels++
  }

  if (transparentPixels / pixelCount > 0.001) {
    return imageData
  }

  const backgroundColor = detectBackgroundColor(data, width, height)
  const tolerance = computeBackgroundTolerance(data, width, height, backgroundColor, threshold)

  const background = new Uint8Array(pixelCount)
  const queue = new Int32Array(pixelCount)
  let qh = 0
  let qt = 0

  const colorDistanceAt = (pixelIndex: number) => {
    const idx = pixelIndex * 4
    const r = data[idx]
    const g = data[idx + 1]
    const b = data[idx + 2]
    return Math.sqrt(
      Math.pow(r - backgroundColor.r, 2) +
        Math.pow(g - backgroundColor.g, 2) +
        Math.pow(b - backgroundColor.b, 2)
    )
  }

  const trySeed = (pixelIndex: number) => {
    if (background[pixelIndex] === 1) return
    if (colorDistanceAt(pixelIndex) > tolerance) return
    background[pixelIndex] = 1
    queue[qt++] = pixelIndex
  }

  for (let x = 0; x < width; x++) {
    trySeed(x)
    trySeed((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    trySeed(y * width)
    trySeed(y * width + (width - 1))
  }

  const neighbors = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
  ] as const

  while (qh < qt) {
    const idx = queue[qh++]
    const x = idx % width
    const y = Math.floor(idx / width)
    for (const [dx, dy] of neighbors) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
      const nidx = ny * width + nx
      if (background[nidx] === 1) continue
      if (colorDistanceAt(nidx) > tolerance) continue
      background[nidx] = 1
      queue[qt++] = nidx
    }
  }

  let mask = new Uint8Array(pixelCount)
  for (let i = 0; i < pixelCount; i++) {
    if (background[i] === 0) mask[i] = 1
  }

  // Eliminar "hoyos" de fondo dentro del logo (ej: P/O/E)
  const bgHsl = rgbToHsl(backgroundColor.r, backgroundColor.g, backgroundColor.b)
  const isLightNeutralBg = bgHsl.l > 0.9 && bgHsl.s < 0.12
  const holeTolerance = Math.max(6, Math.round(tolerance * 0.7))
  const minHoleArea = Math.max(40, Math.round(pixelCount * 0.00005))
  if (holeTolerance > 0) {
    const visited = new Uint8Array(pixelCount)
    const queue = new Int32Array(pixelCount)

    const isBgLike = (pixelIndex: number) => {
      const idx = pixelIndex * 4
      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]
      const dist = Math.sqrt(
        Math.pow(r - backgroundColor.r, 2) +
          Math.pow(g - backgroundColor.g, 2) +
          Math.pow(b - backgroundColor.b, 2)
      )
      if (dist > holeTolerance) return false
      if (isLightNeutralBg) {
        const { s, l } = rgbToHsl(r, g, b)
        if (l < 0.75 || s > 0.25) return false
      }
      return true
    }

    for (let i = 0; i < pixelCount; i++) {
      if (mask[i] !== 1) continue
      if (visited[i]) continue
      if (!isBgLike(i)) continue

      let qh = 0
      let qt = 0
      queue[qt++] = i
      visited[i] = 1

      let componentSize = 0
      let removeComponent = false
      const componentPixels: number[] = []

      while (qh < qt) {
        const idx = queue[qh++]
        componentSize++

        if (!removeComponent) {
          componentPixels.push(idx)
          if (componentSize >= minHoleArea) {
            removeComponent = true
            for (const pix of componentPixels) mask[pix] = 0
            componentPixels.length = 0
          }
        } else {
          mask[idx] = 0
        }

        const x = idx % width
        const y = Math.floor(idx / width)
        for (const [dx, dy] of neighbors) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
          const nidx = ny * width + nx
          if (visited[nidx]) continue
          if (mask[nidx] !== 1) continue
          if (!isBgLike(nidx)) continue
          visited[nidx] = 1
          queue[qt++] = nidx
        }
      }
    }
  }

  const radius = 1
  mask = closeMask(mask, width, height, radius)
  const minArea = Math.max(30, Math.round(pixelCount * 0.00005))
  mask = removeSmallComponents(mask, width, height, minArea)

  const output = new Uint8ClampedArray(data)
  for (let i = 0; i < pixelCount; i++) {
    output[i * 4 + 3] = mask[i] === 1 ? 255 : 0
  }

  return new ImageData(output, width, height)
}

const generateBackgroundRemovedPreview = async (src: string, threshold: number) => {
  const img = await loadImage(src)
  const maxSize = 1000
  const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight))
  const width = Math.max(1, Math.round(img.naturalWidth * scale))
  const height = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return src
  ctx.drawImage(img, 0, 0, width, height)
  const imageData = ctx.getImageData(0, 0, width, height)
  const processed = removeBackgroundFromImageData(imageData, threshold)
  ctx.putImageData(processed, 0, 0)
  return canvas.toDataURL('image/png')
}

export default function ImageCropper({ src, onCancel, onConfirm, onUseOriginal }: ImageCropperProps) {
  const imgRef = useRef<HTMLImageElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const originalImageRef = useRef<HTMLImageElement | null>(null)
  const [originalSize, setOriginalSize] = useState<{ width: number; height: number } | null>(null)
  const [imageRect, setImageRect] = useState<{
    width: number
    height: number
    offsetX: number
    offsetY: number
  } | null>(null)
  const [crop, setCrop] = useState<CropRect | null>(null)
  const [aspect, setAspect] = useState<number | null>(null)
  const [removeBgEnabled, setRemoveBgEnabled] = useState(false)
  const [removeBgThreshold, setRemoveBgThreshold] = useState(180)
  const [isRemovingBg, setIsRemovingBg] = useState(false)
  const [previewSrc, setPreviewSrc] = useState<string>(src)
  const [drag, setDrag] = useState<{
    type: 'move' | 'resize'
    startX: number
    startY: number
    startCrop: CropRect
  } | null>(null)

  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      originalImageRef.current = img
      setOriginalSize({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.src = src
  }, [src])

  const measureImage = () => {
    if (!imgRef.current || !containerRef.current) return
    const rect = imgRef.current.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const containerRect = containerRef.current.getBoundingClientRect()
    const offsetX = rect.left - containerRect.left
    const offsetY = rect.top - containerRect.top
    setImageRect({ width: rect.width, height: rect.height, offsetX, offsetY })
    if (!crop) {
      const pad = Math.min(rect.width, rect.height) * 0.02
      setCrop({
        x: pad,
        y: pad,
        width: rect.width - pad * 2,
        height: rect.height - pad * 2,
      })
    }
  }

  useEffect(() => {
    const handleResize = () => measureImage()
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [src, crop])

  const clampedCrop = useMemo(() => {
    if (!crop || !imageRect) return crop
    const minSize = Math.max(40, Math.round(Math.min(imageRect.width, imageRect.height) * 0.1))
    const width = Math.min(Math.max(crop.width, minSize), imageRect.width - crop.x)
    const height = Math.min(Math.max(crop.height, minSize), imageRect.height - crop.y)
    const x = Math.min(Math.max(0, crop.x), imageRect.width - width)
    const y = Math.min(Math.max(0, crop.y), imageRect.height - height)
    return { x, y, width, height }
  }, [crop, imageRect])

  useEffect(() => {
    if (!drag || !imageRect || !clampedCrop) return

    const handleMove = (e: MouseEvent) => {
      e.preventDefault()
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY

      if (drag.type === 'move') {
        const x = drag.startCrop.x + dx
        const y = drag.startCrop.y + dy
        setCrop({
          ...drag.startCrop,
          x: Math.min(Math.max(0, x), imageRect.width - drag.startCrop.width),
          y: Math.min(Math.max(0, y), imageRect.height - drag.startCrop.height),
        })
      } else {
        const minSize = Math.max(40, Math.round(Math.min(imageRect.width, imageRect.height) * 0.1))
        let width = Math.min(Math.max(drag.startCrop.width + dx, minSize), imageRect.width - drag.startCrop.x)
        let height = Math.min(Math.max(drag.startCrop.height + dy, minSize), imageRect.height - drag.startCrop.y)

        if (aspect) {
          height = width / aspect
          if (drag.startCrop.y + height > imageRect.height) {
            height = imageRect.height - drag.startCrop.y
            width = height * aspect
          }
        }

        setCrop({
          ...drag.startCrop,
          width,
          height,
        })
      }
    }

    const handleUp = () => setDrag(null)
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [drag, aspect, imageRect, clampedCrop])

  const handleConfirm = async () => {
    if (!clampedCrop || !imageRect || !originalImageRef.current || !originalSize) return
    const img = originalImageRef.current
    const scaleX = originalSize.width / imageRect.width
    const scaleY = originalSize.height / imageRect.height
    const cropX = clampedCrop.x * scaleX
    const cropY = clampedCrop.y * scaleY
    const cropW = clampedCrop.width * scaleX
    const cropH = clampedCrop.height * scaleY

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(cropW))
    canvas.height = Math.max(1, Math.round(cropH))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height)

    if (removeBgEnabled) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const processed = removeBackgroundFromImageData(imageData, removeBgThreshold)
      ctx.putImageData(processed, 0, 0)
    }

    canvas.toBlob((blob) => {
      if (!blob) return
      const dataUrl = canvas.toDataURL('image/png')
      onConfirm({ blob, dataUrl })
    }, 'image/png')
  }

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!removeBgEnabled) {
        setPreviewSrc(src)
        return
      }
      setIsRemovingBg(true)
      try {
        const preview = await generateBackgroundRemovedPreview(src, removeBgThreshold)
        if (!cancelled) setPreviewSrc(preview)
      } catch {
        if (!cancelled) setPreviewSrc(src)
      } finally {
        if (!cancelled) setIsRemovingBg(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [removeBgEnabled, removeBgThreshold, src])

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Recorte manual</h3>
            <p className="text-sm text-gray-500">Ajusta el encuadre para eliminar fondo y halos</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={aspect ?? 'free'}
              onChange={(e) => setAspect(e.target.value === 'free' ? null : Number(e.target.value))}
              className="text-sm border border-gray-300 rounded-md px-2 py-1"
            >
              {ASPECT_OPTIONS.map((opt) => (
                <option key={opt.label} value={opt.value ?? 'free'}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                if (!imageRect) return
                setCrop({ x: 0, y: 0, width: imageRect.width, height: imageRect.height })
              }}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-100"
            >
              Ajustar a imagen
            </button>
            {onUseOriginal && (
              <button
                onClick={onUseOriginal}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-100"
              >
                Usar original
              </button>
            )}
          </div>
        </div>

        <div className="p-6">
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={removeBgEnabled}
                onChange={(e) => setRemoveBgEnabled(e.target.checked)}
              />
              Quitar fondo (beta)
            </label>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span>Intensidad</span>
              <input
                type="range"
                min={120}
                max={240}
                step={5}
                value={removeBgThreshold}
                onChange={(e) => setRemoveBgThreshold(Number(e.target.value))}
                disabled={!removeBgEnabled}
              />
              <span className="w-10 text-right">{removeBgThreshold}</span>
            </div>
            {isRemovingBg && (
              <span className="text-xs text-gray-500">Procesando fondo…</span>
            )}
            <span className="text-xs text-gray-500">
              La transparencia se ve como tablero gris
            </span>
          </div>
          <div ref={containerRef} className="relative w-full max-h-[70vh] flex justify-center">
            {imageRect && (
              <div
                className="absolute"
                style={{
                  left: imageRect.offsetX,
                  top: imageRect.offsetY,
                  width: imageRect.width,
                  height: imageRect.height,
                  backgroundImage:
                    'linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)',
                  backgroundSize: '16px 16px',
                  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
                  borderRadius: 6,
                }}
              />
            )}
            <img
              ref={imgRef}
              src={previewSrc}
              onLoad={measureImage}
              className="max-h-[70vh] object-contain relative z-10"
            />

            {imageRect && clampedCrop && (
              <div
                className="absolute"
                style={{
                  left: imageRect.offsetX + clampedCrop.x,
                  top: imageRect.offsetY + clampedCrop.y,
                  width: clampedCrop.width,
                  height: clampedCrop.height,
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
                  border: '2px solid #22c55e',
                  cursor: drag?.type === 'move' ? 'grabbing' : 'grab',
                }}
                onMouseDown={(e) => {
                  e.preventDefault()
                  setDrag({
                    type: 'move',
                    startX: e.clientX,
                    startY: e.clientY,
                    startCrop: clampedCrop,
                  })
                }}
              >
                <div
                  className="absolute right-0 bottom-0 w-4 h-4 bg-green-500 border border-white"
                  style={{ transform: 'translate(50%, 50%)', cursor: 'nwse-resize' }}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setDrag({
                      type: 'resize',
                      startX: e.clientX,
                      startY: e.clientY,
                      startCrop: clampedCrop,
                    })
                  }}
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-gray-50">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-100"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700"
          >
            Confirmar recorte
          </button>
        </div>
      </div>
    </div>
  )
}
