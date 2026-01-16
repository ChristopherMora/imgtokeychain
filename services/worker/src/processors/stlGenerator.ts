import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs/promises'
import path from 'path'
import { logger } from '../utils/logger'

const execAsync = promisify(exec)
const STORAGE_PATH = process.env.STORAGE_PATH || '/app/storage'

interface StlParams {
  width: number
  height: number
  thickness: number
}

export const svgToStl = async (
  svgPath: string,
  jobId: string,
  params: StlParams
): Promise<string> => {
  try {
    const outputPath = path.join(STORAGE_PATH, 'processed', `${jobId}.stl`)
    const scadPath = path.join(STORAGE_PATH, 'temp', `${jobId}.scad`)

    // Create OpenSCAD script
    const scadScript = `
// Generated OpenSCAD script for ${jobId}
linear_extrude(height = ${params.thickness}) {
  scale([${params.width}, ${params.height}, 1]) {
    import("${svgPath}", center = true);
  }
}
`

    await fs.writeFile(scadPath, scadScript)
    logger.info(`OpenSCAD script created: ${scadPath}`)

    // Run OpenSCAD to generate STL
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
