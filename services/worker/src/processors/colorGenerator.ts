import fs from 'fs/promises'
import path from 'path'
import { logger } from '../utils/logger'
import JSZip from 'jszip'

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
    
    // Crear el archivo 3MF (es un ZIP)
    const zip = new JSZip()
    
    // Leer todos los STLs y agregarlos al 3MF
    const stlContents: Buffer[] = []
    for (let i = 0; i < colorSTLs.length; i++) {
      const content = await fs.readFile(colorSTLs[i].stlPath)
      stlContents.push(content)
      // Agregar STL al ZIP con nombre único
      zip.file(`3D/object_${i}.stl`, content)
    }
    
    // Crear el archivo de modelo 3D XML con múltiples objetos
    const modelXml = create3MFModelMultiObject(colorSTLs, stlContents)
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
 * Crea el archivo de modelo 3D XML con múltiples objetos coloreados
 */
function create3MFModelMultiObject(
  colorSTLs: { color: string; stlPath: string }[],
  stlContents: Buffer[]
): string {
  // Crear materiales para cada color
  const materialsXml = colorSTLs.map((item, index) => {
    return `      <base name="Color ${index + 1}" displaycolor="${item.color}" />`
  }).join('\n')
  
  // Crear componentes (referencias a STLs externos)
  const componentsXml = colorSTLs.map((item, index) => {
    return `    <object id="${index + 10}" type="model" partnumber="Part${index + 1}">
      <components>
        <component objectid="${index + 100}" transform="1 0 0 0 1 0 0 0 1 0 0 0" />
      </components>
    </object>`
  }).join('\n')
  
  // Crear items en el build (uno por color)
  const buildItemsXml = colorSTLs.map((item, index) => {
    return `    <item objectid="${index + 10}" />`
  }).join('\n')
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
  <metadata name="Title">Multi-Color Keychain</metadata>
  <metadata name="Designer">ImgToKeychain</metadata>
  <metadata name="Description">Multi-color 3D model for printing</metadata>
  <resources>
    <basematerials id="1">
${materialsXml}
    </basematerials>
${componentsXml}
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
