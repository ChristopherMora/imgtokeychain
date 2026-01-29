#!/usr/bin/env python3
"""
Visualizador de máscaras PGM para debugging del pipeline.
Convierte las máscaras PGM a PNG para poder ver qué formas se están capturando.
"""

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("❌ PIL/Pillow no está instalado.")
    print("   Instálalo con: pip3 install pillow")
    sys.exit(1)

def main():
    if len(sys.argv) < 2:
        print("Uso: python3 debug_visualize.py <job_id>")
        sys.exit(1)
    
    job_id = sys.argv[1]
    storage_path = Path("/home/mora/imgtokeychai/storage")
    processed_path = storage_path / "processed"
    output_path = Path("/tmp")
    
    print(f"🎨 Visualizando máscaras para job: {job_id}\n")
    
    # Buscar todas las máscaras de color
    masks = sorted(processed_path.glob(f"{job_id}_color*_mask.pgm"))
    
    if not masks:
        print(f"❌ No se encontraron máscaras para el job {job_id}")
        return
    
    for mask_file in masks:
        with open(mask_file, 'rb') as f:
            # Leer header PGM (P5)
            magic = f.readline().decode().strip()
            if magic != 'P5':
                print(f"⚠️  {mask_file.name} no es un PGM válido (magic={magic})")
                continue
            
            dimensions = f.readline().decode().strip().split()
            width, height = int(dimensions[0]), int(dimensions[1])
            max_val = int(f.readline().decode().strip())
            
            # Leer datos de imagen
            data = f.read()
        
        # Crear imagen desde bytes
        img = Image.frombytes('L', (width, height), data)
        
        # Guardar como PNG
        color_idx = mask_file.stem.split('_')[- 2]  # Extraer "color0", "color1", etc.
        output_file = output_path / f"{job_id}_{color_idx}_mask.png"
        img.save(output_file)
        
        # Calcular estadísticas
        white_pixels = sum(1 for p in data if p > 127)
        total_pixels = width * height
        percent = (white_pixels / total_pixels) * 100
        
        print(f"✓ {color_idx}: {width}x{height}, {white_pixels:,} píxeles ({percent:.1f}%)")
        print(f"  → {output_file}")
    
    print(f"\n📁 Máscaras guardadas en: {output_path}")
    print(f"   Ábrelas con: xdg-open {output_path}/{job_id}_*.png")
    print(f"   O con:      eog {output_path}/{job_id}_*.png")

if __name__ == "__main__":
    main()
