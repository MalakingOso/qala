"""Trim, compress and index the sprites rendered by build_sprites.py.

    python3 assets/3d/pack_sprites.py /tmp/qala-sprites apps/web/public/plates apps/web/src/shared/plateSprites.json

Add `--merge` to add only the `ez_` sprites of an `--only ez` render to the existing JSON and
folder, leaving every plate entry as it is.

Plates and faces are cropped to their visible pixels and saved as WebP. The
bar is cut into pieces the app can lengthen or shorten, since a polished tube
lit evenly looks the same all along its length:

    bar_collar.webp    collar, and the last stretch of smooth shaft
    knurl_tile.webp    a two-inch window of knurled shaft, repeated going back
    sleeve_tile.webp   a two-inch window of sleeve, repeated going out
    sleeve_end.webp    the last seven inches of sleeve with its end cap, in one piece

Every sprite records `ox, oy`: where the bar's axis point it is anchored on
sits inside the cropped image. A sprite is placed by putting that point at
`origin + u * axis` on screen, `u` being inches along the bar from the collar
face toward the viewer and `axis` the screen vector, in sprite pixels, of one
inch. Sleeve and knurl pieces are placed at any `u` and repeated every
`tile_in` inches.
"""

import json
import math
import os
import sys

from PIL import Image

args = [a for a in sys.argv[1:] if not a.startswith("--")]
MERGE = "--merge" in sys.argv     # add the EZ-bar sprites to the existing JSON instead of rebuilding it
src, dst, meta_out = args
os.makedirs(dst, exist_ok=True)
raw = json.load(open(os.path.join(src, "meta_raw.json")))
S = raw["sprites"]
SLEEVE_LEN = 16.25
TILE_IN, END_IN = 2.0, 7.0

if MERGE:
    out = json.load(open(meta_out))
    AX, AY = out["axis"]
    S = {k: v for k, v in S.items() if k.startswith("ez_")}
    if "ez_back" in S:   # the drawing places it with the plates' axis, so it must be the same camera
        assert all(abs(a - b) < 0.01 for a, b in zip(S["ez_back"]["axis"], (AX, AY))), "ez_back axis differs from the plates'"
else:
    ref = next(v for k, v in S.items() if k.startswith("plate_"))
    AX, AY = ref["axis"]
    out = {"px_per_in": raw["px_per_in"], "axis": [round(AX, 3), round(AY, 3)], "tile_in": TILE_IN, "end_in": END_IN,
           "sleeve_len": SLEEVE_LEN, "face_px_per_in": None, "sprites": {}}
total = 0


def alpha_box(im, thr=6):
    return im.getchannel("A").point(lambda a: 255 if a > thr else 0).getbbox()


def save(name, im, ox, oy, **extra):
    global total
    fname = name + ".webp"
    im.save(os.path.join(dst, fname), "WEBP", quality=90, method=6)
    total += os.path.getsize(os.path.join(dst, fname))
    out["sprites"][name] = {"file": fname, "w": im.width, "h": im.height, "ox": round(ox, 2), "oy": round(oy, 2), **extra}


def open_raw(name):
    s = S[name]
    return Image.open(os.path.join(src, s["file"])).convert("RGBA"), s


def window(raw_name, name, u0, u1, **extra):
    """Crop the columns of a render between axis positions u0 and u1 (inches)."""
    im, s = open_raw(raw_name)
    x0 = round(s["ox"] + u0 * AX)
    x1 = im.width if u1 is None else round(s["ox"] + u1 * AX)
    col = im.crop((x0, 0, x1, im.height))
    box = alpha_box(col)
    y0, y1 = box[1], box[3]
    c = col.crop((0, y0, col.width, y1))
    ox = s["ox"] + u0 * AX - x0
    oy = s["oy"] + u0 * AY - y0
    save(name, c, ox, oy, **extra)


for name, s in sorted(S.items()):
    if name in {"sleeve", "bar_back", "knurl_tile"}:
        continue
    im, _ = open_raw(name)
    box = alpha_box(im)
    if box is None:
        print("empty:", name)
        continue
    box = (max(0, box[0] - 1), max(0, box[1] - 1), min(im.width, box[2] + 1), min(im.height, box[3] + 1))
    save(name, im.crop(box), s["ox"] - box[0], s["oy"] - box[1])
    if name.startswith("face_"):
        out["face_px_per_in"] = s["size"] / 19.0

if "bar_back" in S:
    im, s = open_raw("bar_back")
    # collar and the smooth shaft behind it: from u = -7 to the collar face
    x0 = math.floor(s["ox"] - 7.0 * AX)
    x1 = math.ceil(s["ox"] + 0.4 * AX)
    c = im.crop((x0, 0, x1, im.height))
    b = alpha_box(c)
    c = c.crop((0, b[1], c.width, b[3]))
    save("bar_collar", c, s["ox"] - x0, s["oy"] - b[1])
if "knurl_tile" in S:
    window("knurl_tile", "knurl_tile", -12.0, -12.0 + TILE_IN + 0.02)
if "sleeve" in S:
    window("sleeve", "sleeve_tile", 6.0, 6.0 + TILE_IN + 0.02)
    window("sleeve", "sleeve_end", SLEEVE_LEN - END_IN, None)  # to the image edge: the cap rim reaches past the axis point

json.dump(out, open(meta_out, "w"), indent=1)
json.dump(out, open(os.path.join(dst, "meta.json"), "w"), indent=1)
print(f"{len(out['sprites'])} sprites, {total / 1024:.0f} KB total, axis {out['axis']}")
