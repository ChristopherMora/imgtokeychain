import fs from 'fs/promises'
import path from 'path'
import { logger } from '../utils/logger'
import JSZip from 'jszip'
import { gunzipSync } from 'zlib'
import { parseSTL, STLData, calculateBoundingBox } from './stlParser'
import { BAMBU_PROJECT_SETTINGS_TEMPLATE_GZIP_BASE64 } from './bambuProjectSettingsTemplate'

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
    
    logger.info(`[${jobId}] Creating Bambu Studio 3MF with ${colorSTLs.length} colored objects`)
    
    // Parsear todos los STLs para obtener geometría
    const parsedSTLs: Array<{ color: string; data: STLData }> = []
    for (const item of colorSTLs) {
      logger.info(`[${jobId}] Parsing STL: ${item.stlPath}`)
      const stlData = await parseSTL(item.stlPath)
      parsedSTLs.push({ color: item.color, data: stlData })
    }
    
    // Crear el archivo 3MF (es un ZIP compatible con Bambu Studio)
    const zip = new JSZip()
    
    // Centrar geometría para que el build/assemble use offsets correctos (Bambu Studio)
    const allVertices = parsedSTLs.flatMap((item) => item.data.vertices)
    const bounds = calculateBoundingBox(allVertices)
    const center = {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: (bounds.min.z + bounds.max.z) / 2,
    }
    const offsets = {
      x: bounds.size.x / 2,
      y: bounds.size.y / 2,
      z: bounds.size.z / 2,
    }

    const centeredSTLs = parsedSTLs.map(({ color, data }) => ({
      color,
      data: {
        ...data,
        vertices: data.vertices.map((v) => ({
          x: v.x - center.x,
          y: v.y - center.y,
          z: v.z - center.z,
        })),
      },
    }))

    // Crear el archivo de modelo 3D XML en formato Bambu Studio
    const modelXml = createBambu3MFModel(centeredSTLs, jobId, offsets)
    zip.file('3D/3dmodel.model', modelXml)
    
    // Archivos Bambu Studio (Metadata + thumbnails)
    const projectSettings = createBambuProjectSettings(colorSTLs.map((c) => c.color))
    const modelSettings = createBambuModelSettings(centeredSTLs, jobId, offsets)
    const sliceInfo = `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <header>\n    <header_item key="X-BBL-Client-Type" value="slicer"/>\n    <header_item key="X-BBL-Client-Version" value="02.04.00.70"/>\n  </header>\n</config>`
    const filamentSequence = '{"plate_1":{"sequence":[]}}'
    const cutInformation = `<?xml version="1.0" encoding="utf-8"?>\n<objects>\n <object id="1">\n  <cut_id id="0" check_sum="1" connectors_cnt="0"/>\n </object>\n</objects>`
    const blankPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQImWNgYGBgAAAABQABJzQnCgAAAABJRU5ErkJggg==',
      'base64'
    )

    zip.file('Metadata/project_settings.config', projectSettings)
    zip.file('Metadata/model_settings.config', modelSettings)
    zip.file('Metadata/slice_info.config', sliceInfo)
    zip.file('Metadata/filament_sequence.json', filamentSequence)
    zip.file('Metadata/cut_information.xml', cutInformation)
    zip.file('Metadata/plate_1.png', blankPng)
    zip.file('Metadata/plate_1_small.png', blankPng)
    zip.file('Metadata/plate_no_light_1.png', blankPng)
    zip.file('Metadata/top_1.png', blankPng)
    zip.file('Metadata/pick_1.png', blankPng)

    // Crear el archivo de relaciones
    const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
  <Relationship Target="/Metadata/plate_1.png" Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>
  <Relationship Target="/Metadata/plate_1.png" Id="rel-4" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-middle"/>
  <Relationship Target="/Metadata/plate_1_small.png" Id="rel-5" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-small"/>
</Relationships>`
    zip.file('_rels/.rels', relsXml)
    
    // Crear el archivo de Content Types
    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="gcode" ContentType="text/x.gcode"/>
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
 * Crea el archivo de modelo 3D XML en formato Bambu Studio.
 * Estrategia: múltiples objetos (uno por color) para asignar extrusor/filamento en Bambu Studio.
 */
function createBambu3MFModel(
  parsedSTLs: Array<{ color: string; data: STLData }>,
  jobId: string,
  offsets: { x: number; y: number; z: number }
): string {
  const dateStr = new Date().toISOString().slice(0, 10)
  const transform = `1 0 0 0 1 0 0 0 1 128 128 ${offsets.z.toFixed(6)}`

  const objectsXml = parsedSTLs
    .map((item, index) => {
      const objectId = index + 1
      const verticesXml = item.data.vertices
        .map((v) => `      <vertex x="${v.x.toFixed(6)}" y="${v.y.toFixed(6)}" z="${v.z.toFixed(6)}"/>`)
        .join('\n')
      const trianglesXml = item.data.triangles
        .map((t) => `      <triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`)
        .join('\n')

      return `  <object id="${objectId}" type="model" name="Color ${objectId}">
    <mesh>
      <vertices>
${verticesXml}
      </vertices>
      <triangles>
${trianglesXml}
      </triangles>
    </mesh>
  </object>`
    })
    .join('\n')

  const buildItemsXml = parsedSTLs
    .map((_, index) => `  <item objectid="${index + 1}" transform="${transform}" printable="1"/>`)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">
  <metadata name="Application">BambuStudio-02.04.00.70</metadata>
  <metadata name="BambuStudio:3mfVersion">1</metadata>
  <metadata name="CreationDate">${dateStr}</metadata>
  <metadata name="ModificationDate">${dateStr}</metadata>
  <metadata name="Title">Multi-Color Keychain - ${jobId}</metadata>
  <metadata name="Designer">ImgToKeychain</metadata>
  <metadata name="Description">Multi-color 3D model ready for printing on Bambu Lab printer</metadata>
  <resources>
${objectsXml}
  </resources>
  <build>
${buildItemsXml}
  </build>
</model>`
}

function createBambuProjectSettings(colors: string[]): string {
  const normalizeHex = (hex: string): string => {
    const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
    return match ? `#${match[1].toUpperCase()}` : '#808080'
  }

  const normalized = colors.map(normalizeHex)
  const templateJson = gunzipSync(Buffer.from(BAMBU_PROJECT_SETTINGS_TEMPLATE_GZIP_BASE64, 'base64')).toString('utf8')
  const config = JSON.parse(templateJson)
  const count = normalized.length

  const resizeArray = (value: unknown, fallback: string) => {
    if (!Array.isArray(value)) return Array(count).fill(fallback)
    const result = [...value]
    if (result.length === 0) return Array(count).fill(fallback)
    if (result.length > count) return result.slice(0, count)
    while (result.length < count) result.push(result[result.length - 1])
    return result
  }

  for (const key of Object.keys(config)) {
    if (key.startsWith('filament_') && Array.isArray(config[key])) {
      config[key] = resizeArray(config[key], config[key][0] ?? '0')
    }
  }

  if (Array.isArray(config.default_filament_colour)) {
    config.default_filament_colour = resizeArray(config.default_filament_colour, '')
  }

  if (Array.isArray(config.filament_type)) {
    config.filament_type = normalized.map(() => config.filament_type[0] ?? 'PLA')
  }
  if (Array.isArray(config.filament_ids)) {
    config.filament_ids = normalized.map(() => config.filament_ids[0] ?? 'GFL95')
  }
  if (Array.isArray(config.filament_vendor)) {
    config.filament_vendor = normalized.map(() => config.filament_vendor[0] ?? 'Generic')
  }
  if (Array.isArray(config.filament_settings_id)) {
    config.filament_settings_id = normalized.map(() => config.filament_settings_id[0] ?? 'Generic PLA')
  }
  config.filament_colour = normalized
  config.filament_multi_colour = normalized
  config.filament_colour_type = normalized.map(() => '1')
  config.filament_map = normalized.map((_, index) => String(index + 1))
  if (Array.isArray(config.filament_self_index)) {
    config.filament_self_index = normalized.map((_, index) => String(index))
  }
  if (Array.isArray(config.filament_printable)) {
    config.filament_printable = normalized.map(() => '3')
  }

  return JSON.stringify(config, null, 4)
}

function createBambuModelSettings(
  parsedSTLs: Array<{ color: string; data: STLData }>,
  jobId: string,
  offsets: { x: number; y: number; z: number }
): string {
  const offsetX = offsets.x.toFixed(6)
  const offsetY = offsets.y.toFixed(6)
  const offsetZ = offsets.z.toFixed(6)
  const transform = `1 0 0 0 1 0 0 0 1 128 128 ${offsetZ}`

  const objectsXml = parsedSTLs
    .map((item, index) => {
      const objectId = index + 1
      const faceCount = item.data.triangles.length
      return `  <object id="${objectId}">
    <metadata key="name" value="Color ${objectId}"/>
    <metadata key="extruder" value="${objectId}"/>
    <metadata face_count="${faceCount}"/>
    <part id="1" subtype="normal_part">
      <metadata key="name" value="Color ${objectId}"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
      <metadata key="source_file" value="${jobId}_multicolor.3mf"/>
      <metadata key="source_object_id" value="0"/>
      <metadata key="source_volume_id" value="0"/>
      <metadata key="source_offset_x" value="${offsetX}"/>
      <metadata key="source_offset_y" value="${offsetY}"/>
      <metadata key="source_offset_z" value="${offsetZ}"/>
      <mesh_stat face_count="${faceCount}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>
    </part>
  </object>`
    })
    .join('\n')

  const modelInstancesXml = parsedSTLs
    .map((_, index) => {
      const objectId = index + 1
      return `    <model_instance>
      <metadata key="object_id" value="${objectId}"/>
      <metadata key="instance_id" value="${index}"/>
      <metadata key="identify_id" value="${80 + objectId}"/>
    </model_instance>`
    })
    .join('\n')

  const assembleXml = parsedSTLs
    .map((_, index) => {
      const objectId = index + 1
      return `   <assemble_item object_id="${objectId}" instance_id="${index}" transform="${transform}" offset="0 0 0" />`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<config>
${objectsXml}
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value=""/>
    <metadata key="locked" value="false"/>
    <metadata key="filament_map_mode" value="Auto For Flush"/>
    <metadata key="thumbnail_file" value="Metadata/plate_1.png"/>
    <metadata key="thumbnail_no_light_file" value="Metadata/plate_no_light_1.png"/>
    <metadata key="top_file" value="Metadata/top_1.png"/>
    <metadata key="pick_file" value="Metadata/pick_1.png"/>
${modelInstancesXml}
  </plate>
  <assemble>
${assembleXml}
  </assemble>
</config>`
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
    return `      <m:base name="Color ${index + 1}" displaycolor="${color}" />`
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
    <m:basematerials id="1">
${materialsXml}
    </m:basematerials>
    <object id="2" type="model">
      <mesh>
        <vertices>
          <!-- Geometría simplificada - importar STL en slicer para obtener modelo completo -->
          <vertex x="0" y="0" z="0" />
          <vertex x="1" y="0" z="0" />
          <vertex x="0" y="1" z="0" />
        </vertices>
        <triangles>
          <triangle v1="0" v2="1" v3="2" pid="1" p1="0" p2="0" p3="0" />
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
