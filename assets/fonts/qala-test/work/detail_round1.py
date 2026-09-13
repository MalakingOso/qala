"""Detail round 1: unify serif wedge angles to ~15deg (cap-H standard) on n/l/a Bold.

Reads : ../QalaTest-Bold.ttf (v1)
Writes: ../QalaTestV2-Bold.ttf/.woff2 (family 'Qala Test V2')
        overlay-round1.png (before/after overlays + title-size strips)

All moves are y-only on on-curve corner points: advances, side bearings,
and x-bounds are provably untouched. Stem-edge points never move.
"""
import math

from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import GlyphCoordinates
from PIL import Image, ImageDraw, ImageFont

SRC = "../QalaTest-Bold.ttf"
DST = "../QalaTestV2-Bold.ttf"
DST_WOFF2 = "../QalaTestV2-Bold.woff2"

# glyph -> {point index: new y}
MOVES = {
    "n": {1: 49, 4: 430, 16: 49, 19: 52, 29: 52},
    "l": {1: 49, 4: 624, 9: 51},
    "a": {35: 61},
}
# wedge segments (corner idx, stem-side idx) for angle reporting
WEDGES = {
    "n": [(1, 2), (3, 4), (15, 16), (19, 20), (28, 29)],
    "l": [(1, 2), (3, 4), (8, 9)],
    "a": [(34, 35)],
}


def angle(p, q):
    return math.degrees(math.atan2(abs(q[1] - p[1]), abs(q[0] - p[0])))


def main():
    font = TTFont(SRC)
    glyf = font["glyf"]
    hmtx = font["hmtx"]
    adv_before = {g: hmtx[g] for g in font.getGlyphOrder()}

    for gname, moves in MOVES.items():
        g = glyf[gname]
        g.expand(glyf)
        coords, _, flags = g.getCoordinates(glyf)
        coords = list(coords)
        for idx, new_y in moves.items():
            assert flags[idx] & 1, f"{gname}[{idx}] is off-curve, abort"
            x, y = coords[idx]
            print(f"{gname}[{idx}]: ({x:.1f},{y:.1f}) -> ({x:.1f},{new_y})")
            coords[idx] = (x, new_y)
        g.coordinates = GlyphCoordinates(coords)

    for gname, segs in WEDGES.items():
        coords, _, _ = glyf[gname].getCoordinates(glyf)
        ref = TTFont(SRC)["glyf"][gname].getCoordinates(TTFont(SRC)["glyf"])[0]
        for c, s in segs:
            b = angle(ref[c], ref[s])
            a = angle(coords[c], coords[s])
            print(f"wedge {gname}[{c}->{s}]: {b:.1f}deg -> {a:.1f}deg")

    # Integrity: advances identical, only demo glyphs changed.
    for gname in font.getGlyphOrder():
        assert hmtx[gname] == adv_before[gname], f"advance moved: {gname}"
    src_font = TTFont(SRC)
    src_glyf = src_font["glyf"]
    changed = []
    for gname in font.getGlyphOrder():
        g = glyf[gname]
        if g.isComposite():
            # Composites must keep their own assembly; base changes flow through.
            now = [(c.glyphName, c.x, c.y) for c in g.components]
            was = [(c.glyphName, c.x, c.y)
                   for c in src_glyf[gname].components]
            assert now == was, f"composite assembly changed: {gname}"
            continue
        a = list(g.getCoordinates(glyf)[0])
        b = list(src_glyf[gname].getCoordinates(src_glyf)[0])
        if a != b:
            changed.append(gname)
    assert sorted(changed) == ["a", "l", "n"], f"unexpected changes: {changed}"
    print("integrity OK: advances fixed, composites intact, only a/l/n changed")

    name = font["name"]
    name.names = [r for r in name.names if r.nameID not in (1, 2, 3, 4, 6, 16, 17)]
    for plat, enc, lang in [(3, 1, 0x409), (1, 0, 0)]:
        name.setName("Qala Test V2", 1, plat, enc, lang)
        name.setName("Bold", 2, plat, enc, lang)
        name.setName("QalaTestV2-Bold-round1; test fork of Faustina",
                     3, plat, enc, lang)
        name.setName("Qala Test V2 Bold", 4, plat, enc, lang)
        name.setName("QalaTestV2-Bold", 6, plat, enc, lang)
        name.setName("Qala Test V2", 16, plat, enc, lang)
        name.setName("Bold", 17, plat, enc, lang)
    font.recalcBBoxes = True
    font.save(DST)
    font.flavor = "woff2"
    font.save(DST_WOFF2)

    # Combined overlay figure: big before(red)/after(black) + 28/17px strips.
    chars = ["n", "H", "a", "l"]
    W, big, strip_h = 4 * 230 + 40, 200, 130
    img = Image.new("RGB", (W, big + strip_h + 70), "white")
    d = ImageDraw.Draw(img)
    lab = ImageFont.load_default()
    f_big_old = ImageFont.truetype(SRC, 170)
    f_big_new = ImageFont.truetype(DST, 170)
    for i, ch in enumerate(chars):
        x = 20 + i * 230
        d.text((x, 8), f"{ch}  v1 red / v2 black", font=lab, fill=(0, 0, 0))
        d.text((x + 20, 200), ch, font=f_big_old, fill=(255, 0, 0), anchor="ls")
        d.text((x + 20, 200), ch, font=f_big_new, fill=(0, 0, 0), anchor="ls")
        for j, px in enumerate((28, 17)):
            y = 235 + j * 55
            fo = ImageFont.truetype(SRC, px)
            fn = ImageFont.truetype(DST, px)
            d.text((x, y), "v1", font=lab, fill=(150, 150, 150))
            d.text((x + 25, y + 30), ch, font=fo, fill=(0, 0, 0), anchor="ls")
            d.text((x + 120, y), "v2", font=lab, fill=(150, 150, 150))
            d.text((x + 145, y + 30), ch, font=fn, fill=(0, 0, 0), anchor="ls")
    img.save("overlay-round1.png")
    print("wrote overlay-round1.png")


if __name__ == "__main__":
    main()
