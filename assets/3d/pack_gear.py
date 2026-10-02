"""Trim and shrink the equipment renders from build_gear.py into WebP.

    python3 assets/3d/pack_gear.py /tmp/qala-gear apps/web/public/gear apps/web/src/shared/gearSprites.json

Each render is cropped to its visible pixels and scaled so its long edge is
LONG px (about three times the largest size the app shows it at, for sharp
phone screens). The JSON lists each file with its width and height, which
`shared/gear.tsx` uses to size the image before it loads.
"""

import json
import os
import sys

from PIL import Image

src, dst, meta_out = sys.argv[1:4]
LONG = 360
os.makedirs(dst, exist_ok=True)
raw = json.load(open(os.path.join(src, "meta_raw.json")))
out, total = {}, 0
for name in sorted(raw):
    im = Image.open(os.path.join(src, raw[name]["file"])).convert("RGBA")
    box = im.getchannel("A").point(lambda a: 255 if a > 6 else 0).getbbox()
    im = im.crop((max(0, box[0] - 2), max(0, box[1] - 2), min(im.width, box[2] + 2), min(im.height, box[3] + 2)))
    k = LONG / max(im.size)
    im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    path = os.path.join(dst, name + ".webp")
    im.save(path, "WEBP", quality=90, method=6)
    total += os.path.getsize(path)
    out[name] = {"file": name + ".webp", "w": im.width, "h": im.height}
json.dump(out, open(meta_out, "w"), indent=1)
print(f"{len(out)} sprites, {total / 1024:.0f} KB total")
