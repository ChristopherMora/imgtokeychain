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

    const borderEnabled = params.borderEnabled ?? true
    const borderThickness = params.borderThickness || 2
    const reliefEnabled = params.reliefEnabled ?? false
    
    let scadScript: string
    
    if (borderEnabled && reliefEnabled) {
      // Modo con borde Y relieve
      const baseThickness = 1
      const reliefHeight = params.thickness - baseThickness
      
      scadScript = `
// Llavero con borde y relieve ${jobId}
difference() {
  // Base con borde redondeado
  translate([0, 0, ${baseThickness/2}])
    linear_extrude(height = ${baseThickness}, center = true)
      offset(r = ${borderThickness})
        offset(delta = ${borderThickness})
          scale([${params.width}, ${params.height}, 1])
            import("${svgPath}", center = true);
  
  // Restar logo para hueco
  translate([0, 0, ${baseThickness}])
    linear_extrude(height = ${reliefHeight} + 1)
      scale([${params.width}, ${params.height}, 1])
        import("${svgPath}", center = true);
}

// Logo en relieve
translate([0, 0, ${baseThickness}])
  linear_extrude(height = ${reliefHeight})
    scale([${params.width}, ${params.height}, 1])
      import("${svgPath}", center = true);
`
    } else if (borderEnabled) {
      // Solo borde, sin relieve
      scadScript = `
// Llavero con borde ${jobId}
linear_extrude(height = ${params.thickness}) {
  offset(r = ${borderThickness})
    offset(delta = ${borderThickness})
      scale([${params.width}, ${params.height}, 1])
        import("${svgPath}", center = true);
}
`
    } else {
      // Sin borde ni relieve (modo original)
      scadScript = `
// Llavero simple ${jobId}
linear_extrude(height = ${params.thickness}) {
  scale([${params.width}, ${params.height}, 1]) {
    import("${svgPath}", center = true);
  }
}
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
