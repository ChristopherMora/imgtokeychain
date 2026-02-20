import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs/promises'
import path from 'path'
import { logger } from '../utils/logger'

const execAsync = promisify(exec)
const STORAGE_PATH = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../../storage')

interface StlParams {
  width: number
  height: number
  thickness: number
  borderEnabled?: boolean
  borderThickness?: number
  reliefEnabled?: boolean
  subtractSvgPaths?: string[]
}

async function getSvgViewBoxSize(svgPath: string): Promise<{ width: number; height: number } | null> {
  try {
    const content = await fs.readFile(svgPath, 'utf-8')
    const svgTagMatch = content.match(/<svg\b[^>]*>/i)
    if (!svgTagMatch) return null
    const viewBoxMatch = svgTagMatch[0].match(/\bviewBox\s*=\s*(['"])([^'"]+)\1/i)
    if (!viewBoxMatch) return null
    const parts = viewBoxMatch[2].trim().split(/[\s,]+/).map(Number)
    if (parts.length < 4 || parts.some(n => Number.isNaN(n))) return null
    return { width: parts[2], height: parts[3] }
  } catch {
    return null
  }
}

export const svgToStl = async (
  svgPath: string,
  jobId: string,
  params: StlParams
): Promise<string> => {
  try {
    logger.info(`[${jobId}] svgToStl called with params:`, JSON.stringify(params))
    
    const outputPath = path.join(STORAGE_PATH, 'processed', `${jobId}.stl`)
    const scadPath = path.join(STORAGE_PATH, 'temp', `${jobId}.scad`)
    
    logger.info(`[${jobId}] Will create SCAD at: ${scadPath}`)
    logger.info(`[${jobId}] Thickness value: ${params.thickness}`)

    const borderEnabled = params.borderEnabled ?? false  // Desactivado por defecto para preservar detalles
    const borderThicknessMm = Math.max(0, params.borderThickness ?? 0.3)
    const reliefEnabled = params.reliefEnabled ?? false
    const subtractSvgPaths = (params.subtractSvgPaths ?? []).filter(Boolean).filter(p => p !== svgPath)
    
    let scadScript: string
    
    // Determinar el size real del SVG usando viewBox (evita asumir 2000x2000)
    const viewBoxSize = await getSvgViewBoxSize(svgPath)
    const vbWidth = viewBoxSize?.width ?? 2000
    const vbHeight = viewBoxSize?.height ?? 2000

    // Escalamos para obtener el tamaño final en mm
    const scaleX = params.width / vbWidth
    const scaleY = params.height / vbHeight

    if (borderEnabled && reliefEnabled) {
      // Modo con borde Y relieve
      const baseThickness = 1
      const reliefHeight = params.thickness - baseThickness
      
      scadScript = `
// Llavero con borde y relieve ${jobId}
union() {
  // Base con borde redondeado (apoya en Z=0)
  linear_extrude(height = ${baseThickness}, center = false)
    offset(r = ${borderThicknessMm})
      scale([${scaleX}, ${scaleY}, 1])
        import("${svgPath}", center = false);

  // Logo en relieve
  translate([0, 0, ${baseThickness}])
    linear_extrude(height = ${reliefHeight}, center = false)
      scale([${scaleX}, ${scaleY}, 1])
        import("${svgPath}", center = false);
}
`
    } else if (borderEnabled) {
      // Solo borde, sin relieve - offset pequeño para suavizar bordes
      scadScript = `
// Llavero con borde ${jobId}
linear_extrude(height = ${params.thickness}, center = false)
  offset(r = ${borderThicknessMm})
    scale([${scaleX}, ${scaleY}, 1])
      import("${svgPath}", center = false);
`
    } else {
      // Sin borde ni relieve (modo original)
      const baseShape2D = subtractSvgPaths.length > 0
        ? `difference() {
    scale([${scaleX}, ${scaleY}, 1])
      import("${svgPath}", center = false);
    union() {
${subtractSvgPaths.map(p => `      scale([${scaleX}, ${scaleY}, 1])\n        import("${p}", center = false);`).join('\n')}
    }
  }`
        : `scale([${scaleX}, ${scaleY}, 1])
    import("${svgPath}", center = false);`
      scadScript = `
// Llavero simple ${jobId}
linear_extrude(height = ${params.thickness}, center = false)
  ${baseShape2D}
`
    }

    await fs.writeFile(scadPath, scadScript)
    logger.info(`OpenSCAD script created: ${scadPath}`)

    // Run OpenSCAD to generate STL (defaults to binary format in this version)
    const command = `openscad -o "${outputPath}" "${scadPath}"`
    
    logger.info(`Running OpenSCAD: ${command}`)
    
    const { stdout, stderr } = await execAsync(command, {
      timeout: parseInt(process.env.WORKER_MAX_JOB_TIME || '30000'),
    })

    if (stderr && !stderr.includes('WARNING')) {
      logger.warn(`OpenSCAD stderr: ${stderr}`)
    }

    // Verify STL was created
    try {
      await fs.access(outputPath)
      logger.info(`STL generated successfully: ${outputPath}`)
    } catch {
      throw new Error('STL file was not created')
    }

    // Cleanup temp SCAD file
    await fs.unlink(scadPath).catch(() => {})

    return outputPath
  } catch (error) {
    logger.error('Error generating STL:', error)
    throw new Error(`Failed to generate STL: ${error}`)
  }
}
