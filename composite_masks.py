#!/usr/bin/env python3
"""
Script para crear una visualización COMPUESTA de todas las máscaras juntas.
Esto nos mostrará si el problema es la generación de máscaras o el rendering 3D.
"""

from PIL import Image, ImageDraw
import sys

def main():
    if len(sys.argv) < 2:
        print("Uso: python3 composite_masks.py <job_id>")
        sys.exit(1)
    
    job_id = sys.argv[1]
    
    # Colores aproximados del logo PHYSIOMOVE
    colors = [
        (255, 192, 203),  # color0 - rosa claro (dedos)
        (255, 105, 180),  # color1 - rosa oscuro (mano)
        (100, 200, 255),  # color2 - azul claro
        (0, 168, 230),    # color3 - azul (pie)
        (0, 0, 0),        # color4 - negro (runner/texto)
    ]
    
    # Crear imagen compuesta
    composite = Image.new('RGB', (2000, 2000), (255, 255, 255))
    
    print(f"🎨 Generando composición de máscaras para {job_id}...\n")
    
    for i in range(5):
        mask_path = f'/tmp/{job_id}_color{i}_mask.png'
        try:
            mask = Image.open(mask_path).convert('L')
            
            # Crear capa de color
            color_layer = Image.new('RGB', (2000, 2000), colors[i])
            
            # Usar la máscara para componer
            composite.paste(color_layer, (0, 0), mask)
            
            print(f"✓ Añadida capa color{i} ({colors[i]})")
        except:
            print(f"⚠️  No se pudo cargar color{i}")
    
    # Guardar resultado
    output_path = f'/tmp/{job_id}_composite.png'
    composite.save(output_path)
    
    print(f"\n✅ Composición guardada en: {output_path}")
    print(f"   Ábrela con: xdg-open {output_path}")
    print(f"\n💡 Si la composición se ve bien pero el 3D no, el problema está en el pipeline STL/OpenSCAD.")
    print(f"   Si la composición NO se ve bien, el problema está en la segmentación de colores.")

if __name__ == "__main__":
    main()
