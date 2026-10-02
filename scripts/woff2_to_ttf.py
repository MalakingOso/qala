"""Convert woff2 fonts to plain TrueType, for Android (it loads TTF or OTF, not woff2).

    uv run --with fonttools --with brotli scripts/woff2_to_ttf.py assets/fonts/DMMono-Regular.woff2 assets/fonts/DMMono-Medium.woff2

Each INPUT.woff2 is written next to itself as INPUT.ttf (or into --out DIR). The conversion only
changes the container: the glyph data and layout tables are decoded from the woff2 transform
and written back unchanged, and the name table is left alone. DM Mono's OFL header declares no
Reserved Font Name, so the format change needs no rename (read DMMono-OFL.txt before reusing
this on another family).
"""

import os
import sys

from fontTools.ttLib import TTFont

args = sys.argv[1:]
out_dir = None
if "--out" in args:
    i = args.index("--out")
    out_dir = args[i + 1]
    del args[i : i + 2]
if not args:
    sys.exit(__doc__)

for src in args:
    if not src.endswith(".woff2"):
        sys.exit(f"{src}: expected a .woff2 file")
    dst = os.path.splitext(src)[0] + ".ttf"
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        dst = os.path.join(out_dir, os.path.basename(dst))
    font = TTFont(src)
    font.flavor = None
    font.save(dst)
    print(f"{src} -> {dst} ({os.path.getsize(dst):,} bytes)")
