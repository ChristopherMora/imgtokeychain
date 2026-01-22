import fs from 'fs/promises'
import path from 'path'
import { logger } from '../utils/logger'
import JSZip from 'jszip'
import { parseSTL, STLData, calculateBoundingBox } from './stlParser'

/**
 * Genera un 3MF multi-objeto desde múltiples STLs coloreados
 */
export const generate3MFFromColorSTLs = async (
  colorSTLs: { color: string; stlPath: string }[],
  jobId: string,
  storagePath: string
): Promise<string> => {
  try {
    const outputPath = path.join(storagePath, 'processed', `${jobId}.3mf`)
    
    logger.info(`[${jobId}] Creating 3MF with ${colorSTLs.length} colored objects`)
    
    // Parsear todos los STLs para obtener geometría
    const parsedSTLs: Array<{ color: string; data: STLData }> = []
    for (const item of colorSTLs) {
      logger.info(`[${jobId}] Parsing STL: ${item.stlPath}`)
      const stlData = await parseSTL(item.stlPath)
      parsedSTLs.push({ color: item.color, data: stlData })
    }
    
    // Crear el archivo 3MF (es un ZIP)
    const zip = new JSZip()
    
    // Crear el archivo de modelo 3D XML con múltiples objetos y geometría real
    const modelXml = create3MFModelMultiObject(parsedSTLs, jobId)
    zip.file('3D/3dmodel.model', modelXml)
    
    // Crear el archivo de relaciones
    const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`
    zip.file('_rels/.rels', relsXml)
    
    // Crear el archivo de Content Types
    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
  <Default Extension="stl" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel" />
</Types>`
    zip.file('[Content_Types].xml', contentTypesXml)
    
    // Generar el archivo 3MF
    const buffer = await zip.generateAsync({ type: 'nodebuffer' })
    await fs.writeFile(outputPath, buffer)
    
    logger.info(`[${jobId}] Multi-color 3MF created: ${outputPath}`)
    return outputPath
    
  } catch (error) {
    logger.error(`[${jobId}] Error creating multi-color 3MF:`, error)
    throw error
  }
}

/**
 * Crea el archivo de modelo 3D XML con múltiples objetos coloreados (uno por color)
 * Esto es lo que Bambu Studio espera - múltiples objetos, cada uno con su color asignado
 */
function create3MFModelMultiObject(
  parsedSTLs: Array<{ color: string; data: STLData }>,
  jobId: string
): string {
  // Crear un objeto por cada color
  const objectsXml = parsedSTLs.map((item, colorIndex) => {
    const { data } = item
    const { vertices, triangles } = data
    
    // Generar vértices XML
    const verticesXml = vertices.map(v => 
      `          <vertex x="${v.x.toFixed(6)}" y="${v.y.toFixed(6)}" z="${v.z.toFixed(6)}" />`
    ).join('\n')
    
    // Generar triángulos XML (referencing vertex indices directly)
    const trianglesXml = triangles.map(tri => 
      `          <triangle v1="${tri[0]}" v2="${tri[1]}" v3="${tri[2]}" />`
    ).join('\n')
    
    return `    <object id="${colorIndex + 2}" type="model" name="Color_${colorIndex + 1}">
      <mesh>
        <vertices>
${verticesXml}
        </vertices>
        <triangles>
${trianglesXml}
        </triangles>
      </mesh>
    </object>`
  }).join('\n')
  
  // Crear references a los objetos en el build
  const buildItemsXml = parsedSTLs.map((item, colorIndex) => 
    `    <item objectid="${colorIndex + 2}" />`
  ).join('\n')
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" 
  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" 
  xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"
  xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/02">
  <metadata name="Title">Multi-Color Keychain - ${jobId}</metadata>
  <metadata name="Designer">ImgToKeychain</metadata>
  <metadata name="Description">Multi-color 3D model ready for printing on Bambu Lab printer</metadata>
  <metadata name="Application">ImgToKeychain v1.0</metadata>
  <resources>
${objectsXml}
  </resources>
  <build>
${buildItemsXml}
  </build>
</model>`
}

/**
 * Convierte un archivo STL a formato 3MF con información de color
 * El formato 3MF es un formato de impresión 3D que soporta colores
 */
export const stlTo3mf = async (
  stlPath: string,
  jobId: string,
  dominantColors: string[],
  storagePath: string
): Promise<string> => {
  try {
    const outputPath = path.join(storagePath, 'processed', `${jobId}.3mf`)
    
    // Leer el archivo STL
    const stlContent = await fs.readFile(stlPath)
    
    // Crear el archivo 3MF (es un ZIP con estructura específica)
    const zip = new JSZip()
    
    // Agregar el modelo 3D directamente como 3dmodel.model (no como STL)
    const modelXml = create3MFModel(dominantColors, stlPath)
    zip.file('3D/3dmodel.model', modelXml)
    
    // Crear el archivo de relaciones
    const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`
    zip.file('_rels/.rels', relsXml)
    
    // Crear el archivo de Content Types
    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>`
    zip.file('[Content_Types].xml', contentTypesXml)
    
    // Generar el archivo 3MF
    const buffer = await zip.generateAsync({ type: 'nodebuffer' })
    await fs.writeFile(outputPath, buffer)
    
    logger.info(`3MF file created with colors: ${outputPath}`)
    return outputPath
    
  } catch (error) {
    logger.error(`Error creating 3MF file: ${error}`)
    throw error
  }
}

/**
 * Crea el archivo de modelo 3D XML con materiales de color
 */
function create3MFModel(colors: string[], stlPath: string): string {
  // Crear materiales para cada color
  const materialsXml = colors.map((color, index) => {
    return `      <base name="Color ${index + 1}" displaycolor="${color}" />`
  }).join('\n')
  
  // Nota: En un 3MF real, necesitaríamos parsear el STL y convertir
  // los triángulos a XML. Por ahora, generamos un modelo simple
  // que los slicers puedan abrir y aplicar colores manualmente
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
  <metadata name="Title">Llavero 3D</metadata>
  <metadata name="Designer">ImgToKeychain</metadata>
  <metadata name="Description">Modelo generado con colores sugeridos para impresión multicolor</metadata>
  <resources>
    <basematerials id="1">
${materialsXml}
    </basematerials>
    <object id="2" type="model">
      <mesh>
        <vertices>
          <!-- Geometría simplificada - importar STL en slicer para obtener modelo completo -->
          <vertex x="0" y="0" z="0" />
          <vertex x="1" y="0" z="0" />
          <vertex x="0" y="1" z="0" />
        </vertices>
        <triangles>
          <triangle v1="0" v2="1" v3="2" pid="1" p1="0" />
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="2" />
  </build>
</model>`
}

/**
 * Convierte color hex a formato RGB para 3MF
 */
function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return '#808080'
  
  const r = parseInt(result[1], 16)
  const g = parseInt(result[2], 16)
  const b = parseInt(result[3], 16)
  
  return `#${result[1]}${result[2]}${result[3]}`
}
