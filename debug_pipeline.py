#!/usr/bin/env python3
"""
Script de diagnóstico para visualizar cada etapa del pipeline de generación de llaveros.
Esto nos ayudará a identificar dónde exactamente se pierde la forma del logo.
"""

import sys
import subprocess
from pathlib import Path

def main():
    if len(sys.argv) < 2:
        print("Uso: python3 debug_pipeline.py <job_id>")
        print("Ejemplo: python3 debug_pipeline.py bd443a47-7624-4fab-b603-2e45f3dfad79")
        sys.exit(1)
    
    job_id = sys.argv[1]
    storage_path = Path("/home/mora/imgtokeychai/storage")
    processed_path = storage_path / "processed"
    
    print(f"🔍 Analizando job: {job_id}\n")
    
    # 1. Verificar imagen original
    uploads = list((storage_path / "uploads").glob("*"))
    if uploads:
        latest_upload = max(uploads, key=lambda p: p.stat().st_mtime)
        print(f"📷 Imagen original: {latest_upload.name}")
        print(f"   Tamaño: {latest_upload.stat().st_size / 1024:.1f} KB")
    
    # 2. Verificar máscara de silueta
    silhouette = processed_path / f"{job_id}_silhouette_mask.pgm"
    if silhouette.exists():
        print(f"\n🎭 Máscara de silueta: ✓")
        print(f"   Tamaño: {silhouette.stat().st_size / 1024:.1f} KB")
    
    # 3. Analizar máscaras de color
    print(f"\n🎨 Máscaras de color:")
    color_masks = sorted(processed_path.glob(f"{job_id}_color*_mask.pgm"))
    
    for mask in color_masks:
        with open(mask, 'rb') as f:
            # Leer header PGM
            magic = f.readline()
            dimensions = f.readline().decode().strip().split()
            width, height = int(dimensions[0]), int(dimensions[1])
            max_val = f.readline()
            data = f.read()
            
            white_pixels = sum(1 for p in data if p > 127)
            total_pixels = width * height
            percent = (white_pixels / total_pixels) * 100
            
            color_idx = mask.stem.split('_')[-2]
            print(f"   {color_idx}: {white_pixels:,} píxeles blancos ({percent:.1f}%) - {mask.stat().st_size / 1024:.0f} KB")
    
    # 4. Analizar SVGs generados
    print(f"\n📐 SVGs generados:")
    svgs = sorted(processed_path.glob(f"{job_id}_color*.svg"))
    
    for svg in svgs:
        with open(svg, 'r') as f:
            content = f.read()
            # Contar paths en el SVG
            path_count = content.count('<path')
            # Buscar transform
            has_transform = 'transform=' in content
            
        color_idx = svg.stem.split('_')[-1]
        print(f"   {color_idx}: {len(content):,} bytes, {path_count} paths, transform={has_transform}")
    
    # 5. Analizar STLs generados
    print(f"\n🔺 STLs generados:")
    stls = sorted(processed_path.glob(f"{job_id}_color*.stl"))
    
    for stl in stls:
        with open(stl, 'r') as f:
            content = f.read(100)
            is_ascii = content.startswith('solid')
        
        if is_ascii:
            with open(stl, 'r') as f:
                content = f.read()
                triangle_count = content.count('vertex') // 3
        else:
            with open(stl, 'rb') as f:
                f.seek(80)
                import struct
                triangle_count = struct.unpack('<I', f.read(4))[0]
        
        color_idx = stl.stem.split('_')[-1]
        size_kb = stl.stat().st_size / 1024
        print(f"   {color_idx}: {size_kb:.1f} KB, {triangle_count:,} triángulos")
    
    # 6. Verificar SCAD scripts si existen
    print(f"\n🔧 Scripts OpenSCAD:")
    scads = sorted((storage_path / "temp").glob(f"{job_id}_color*.scad"))
    
    if scads:
        for scad in scads:
            with open(scad, 'r') as f:
                content = f.read()
            color_idx = scad.stem.split('_')[-1]
            has_offset = 'offset(' in content
            has_scale = 'scale(' in content
            print(f"   {color_idx}: offset={has_offset}, scale={has_scale}")
    else:
        print("   (Scripts SCAD ya fueron eliminados)")
    
    print("\n" + "="*60)
    print("💡 Recomendaciones:")
    print("="*60)
    
    # Analizar si hay problemas
    if color_masks:
        total_white = sum(
            sum(1 for p in open(mask, 'rb').read()[17:] if p > 127)
            for mask in color_masks
        )
        if total_white < 100000:
            print("⚠️  Las máscaras tienen muy pocos píxeles blancos.")
            print("   Problema posible: La segmentación de colores no está capturando bien las formas.")
    
    small_stls = [s for s in stls if s.stat().st_size < 50000]
    if len(small_stls) > len(stls) // 2:
        print("⚠️  Muchos STLs son muy pequeños (< 50KB).")
        print("   Problema posible: El offset está destruyendo la geometría o las máscaras son incorrectas.")
    
    print("\n✅ Para visualizar las máscaras, instala PIL:")
    print("   pip3 install pillow")
    print("   Luego ejecuta: python3 debug_visualize.py " + job_id)

if __name__ == "__main__":
    main()
