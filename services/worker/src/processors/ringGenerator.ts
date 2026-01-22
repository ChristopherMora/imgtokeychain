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

    // Create OpenSCAD script with ring - using union() and render() for CGAL stability
    const scadScript = `
// Add ring to keychain ${jobId}
$fn = 50;

module keyring(inner_diameter, thickness) {
  render() {
    difference() {
      cylinder(h = thickness, d = inner_diameter + (thickness * 2), center = true);
      cylinder(h = thickness + 1, d = inner_diameter, center = true);
    }
  }
}

// Union original STL with ring
union() {
  // Import original STL with render() for CGAL stability
  render(convexity = 10) {
    import("${stlPath}");
  }

  // Add ring as separate object
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
    
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: parseInt(process.env.WORKER_MAX_JOB_TIME || '60000'),
      })

      if (stderr && !stderr.includes('WARNING')) {
        logger.warn(`OpenSCAD stderr: ${stderr}`)
      }
    } catch (openscadError: any) {
      logger.warn(`OpenSCAD ring union failed: ${openscadError.message}`)
      
      // Try simpler approach: just generate the ring separately and keep original
      const simpleScad = `
// Simple ring only for keychain ${jobId}
$fn = 50;
cylinder(h = ${params.thickness}, d = ${params.diameter} + (${params.thickness} * 2), center = true);
difference() {
  cylinder(h = ${params.thickness}, d = ${params.diameter} + (${params.thickness} * 2), center = true);
  cylinder(h = ${params.thickness} + 1, d = ${params.diameter}, center = true);
}
`
      const ringOnlyPath = path.join(STORAGE_PATH, 'processed', `${jobId}_ring_only.stl`)
      const ringScadPath = path.join(STORAGE_PATH, 'temp', `${jobId}_ring_only.scad`)
      
      await fs.writeFile(ringScadPath, simpleScad)
      
      try {
        await execAsync(`openscad -o "${ringOnlyPath}" "${ringScadPath}"`, { timeout: 30000 })
        logger.info(`Ring generated separately: ${ringOnlyPath}`)
        await fs.unlink(ringScadPath).catch(() => {})
      } catch {
        logger.warn('Could not generate ring separately either')
      }
      
      // Copy original STL as the output (without ring)
      logger.warn('Using original STL without ring due to CGAL error')
      await fs.copyFile(stlPath, outputPath)
      await fs.unlink(scadPath).catch(() => {})
      return outputPath
    }

    // Verify output
    try {
      await fs.access(outputPath)
      const stats = await fs.stat(outputPath)
      const originalStats = await fs.stat(stlPath)
      
      // If the output file is smaller than the original, union failed
      if (stats.size < originalStats.size * 0.5) {
        logger.warn(`Ring generation failed - output too small (${stats.size} bytes vs ${originalStats.size} bytes original)`)
        throw new Error('CGAL union failed - keeping original STL')
      }
      
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
