"""Shrinks the PNG screenshots in docs/images (256-colour palette, no dithering).

FASTOCTREE keeps the small coloured icons; MEDIANCUT turns them grey.
"""
import glob
import os

from PIL import Image

here = os.path.dirname(os.path.abspath(__file__))
for path in sorted(glob.glob(os.path.join(here, '..', '..', '..', 'docs', 'images', '*.png'))):
    before = os.path.getsize(path)
    image = Image.open(path).convert('RGB')
    image.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(path, optimize=True)
    print(f'{os.path.basename(path)}: {before // 1024} -> {os.path.getsize(path) // 1024} KB')
