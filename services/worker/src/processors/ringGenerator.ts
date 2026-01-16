import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs/promises'
import path from 'path'
import { logger } from '../utils/logger'

const execAsync = promisify(exec)
const STORAGE_PATH = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../../storage')

interface RingParams {
  diameter: number
  thickness: number
  position: string
}

export const addRing = async (
  stlPath: string,
  jobId: string,
  params: RingParams
): Promise<string> => {
  try {
    const outputPath = path.join(STORAGE_PATH, 'processed', `${jobId}_with_ring.stl`)
    const scadPath = path.join(STORAGE_PATH, 'temp', `${jobId}_ring.scad`)

    // Calculate ring position offset
    let translateX = 0
    let translateY = 0
    
    switch (params.position) {
      case 'top':
        translateY = 30 // Adjust based on model size
        break
      case 'left':
        translateX = -30
        break
      case 'right':
        translateX = 30
        break
    }

    // Create OpenSCAD script with ring
    const scadScript = `
// Add ring to keychain ${jobId}

module keyring(inner_diameter, thickness) {
  difference() {
    cylinder(h = thickness, d = inner_diameter + (thickness * 2), center = true, $fn = 50);
    cylinder(h = thickness + 1, d = inner_diameter, center = true, $fn = 50);
  }
}

union() {
  // Import original STL
  import("${stlPath}", convexity = 3);
  
  // Add ring
  translate([${translateX}, ${translateY}, 0]) {
    rotate([90, 0, 0]) {
      keyring(${params.diameter}, ${params.thickness});
    }
  }
}
`

    await fs.writeFile(scadPath, scadScript)
    logger.info(`Ring OpenSCAD script created: ${scadPath}`)

    // Run OpenSCAD (defaults to binary format in this version)
    const command = `openscad -o "${outputPath}" "${scadPath}"`
    
    logger.info(`Running OpenSCAD with ring: ${command}`)
    
    const { stdout, stderr } = await execAsync(command, {
      timeout: parseInt(process.env.WORKER_MAX_JOB_TIME || '30000'),
    })

    if (stderr && !stderr.includes('WARNING')) {
      logger.warn(`OpenSCAD stderr: ${stderr}`)
    }

    // Verify output
    try {
      await fs.access(outputPath)
      logger.info(`STL with ring generated: ${outputPath}`)
    } catch {
      throw new Error('STL with ring was not created')
    }

    // Cleanup
    await fs.unlink(scadPath).catch(() => {})

    return outputPath
  } catch (error) {
    logger.error('Error adding ring:', error)
    throw new Error(`Failed to add ring: ${error}`)
  }
}
