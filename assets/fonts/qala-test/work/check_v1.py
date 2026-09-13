"""Validate Qala Test v1: names, weights, width targets, cmap, woff2, render smoke."""
import string

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

TARGETS = [
    (500, "Medium", (1 + 1 / 1.0268) / 2),
    (700, "Bold", (1 + 1 / 1.0649) / 2),
]


def mean_width(path, chars):
    f = TTFont(path)
    gs = f.getGlyphSet()
    cmap = f.getBestCmap()
    return sum(gs[cmap[ord(c)]].width for c in chars) / len(chars)


def dark_pixels(path, text="Lower body 245"):
    font = ImageFont.truetype(path, 64)
    img = Image.new("L", (900, 100), 255)
    ImageDraw.Draw(img).text((10, 10), text, font=font, fill=0)
    return sum(1 for p in img.getdata() if p < 128)


for weight, sub, target in TARGETS:
    src = f"Faustina-{weight}-ref.ttf"
    test = f"../QalaTest-{sub}.ttf"
    rl = mean_width(test, string.ascii_lowercase) / mean_width(
        src, string.ascii_lowercase
    )
    ru = mean_width(test, string.ascii_uppercase) / mean_width(
        src, string.ascii_uppercase
    )
    print(f"{sub}: lower ratio {rl:.5f} (target {target:.5f})  "
          f"upper ratio {ru:.5f} (expect ~1.0)")
    assert abs(rl - target) < 0.003, "lowercase width off target"
    assert abs(ru - 1.0) < 0.003, "caps moved unexpectedly"
    a, b = TTFont(src), TTFont(test)
    assert a["maxp"].numGlyphs == b["maxp"].numGlyphs, "glyph count changed"
    assert set(a.getBestCmap()) == set(b.getBestCmap()), "cmap changed"
    assert b["name"].getDebugName(1) == "Qala Test"
    assert b["name"].getDebugName(6) == f"QalaTest-{sub}"
    assert b["OS/2"].usWeightClass == weight
    w = TTFont(f"../QalaTest-{sub}.woff2")
    assert w["maxp"].numGlyphs == b["maxp"].numGlyphs, "woff2 glyph mismatch"
    ps, pt = dark_pixels(src), dark_pixels(test)
    print(f"  render dark pixels: source={ps} test={pt}")
    assert ps > 1000 and pt > 1000, "blank render"
print("ALL CHECKS PASSED")
