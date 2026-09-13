"""Build Qala Test v1: renamed Faustina statics with Scala-ward narrower lowercase.

Reads : Faustina-wght.ttf (google/fonts variable, OFL, no reserved name)
Writes: ../QalaTest-Medium.ttf/.woff2, ../QalaTest-Bold.ttf/.woff2 (test fam)
        Faustina-{500,700}-ref.ttf (unmodified reference statics for diffing)

v1 changes: rename + lowercase narrowed halfway from Faustina widths toward
Alegreya (measured Faustina/Alegreya lower ratios: 1.0268 @500, 1.0649 @700).
Caps, figures, and serif cuts untouched.
"""
import os
import string

from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import GlyphCoordinates
from fontTools.varLib.instancer import instantiateVariableFont

SRC = "Faustina-wght.ttf"
FAMILY = "Qala Test"
TARGETS = {
    500: ("Medium", (1 + 1 / 1.0268) / 2),
    700: ("Bold", (1 + 1 / 1.0649) / 2),
}


def hint_count(font):
    n = 0
    glyf = font["glyf"]
    for gname in font.getGlyphOrder():
        g = glyf[gname]
        g.expand(glyf)
        prog = getattr(g, "program", None)
        if prog is not None and getattr(prog, "bytecode", None):
            n += 1
    return n


def narrow_lowercase(font, factor):
    """Scale x of a-z (plus composites built on them) about the origin."""
    glyf = font["glyf"]
    hmtx = font["hmtx"]
    cmap = font.getBestCmap()
    lower = {cmap[ord(c)] for c in string.ascii_lowercase if ord(c) in cmap}
    affected = set()
    for gname in sorted(lower):
        if gname not in glyf:
            continue
        g = glyf[gname]
        g.expand(glyf)
        if g.isComposite():
            continue
        coords, _, _ = g.getCoordinates(glyf)
        g.coordinates = GlyphCoordinates(
            [(int(round(x * factor)), y) for x, y in coords]
        )
        affected.add(gname)
    # Composites referencing narrowed glyphs (fixpoint for nesting).
    # Each composite is scaled exactly once.
    changed = True
    while changed:
        changed = False
        for gname in font.getGlyphOrder():
            if gname in affected:
                continue
            g = glyf[gname]
            g.expand(glyf)
            if not g.isComposite():
                continue
            if any(c.glyphName in affected for c in g.components):
                for c in g.components:
                    c.x = int(round(c.x * factor))
                affected.add(gname)
                changed = True
    for gname in affected:
        adv, lsb = hmtx[gname]
        hmtx[gname] = (int(round(adv * factor)), int(round(lsb * factor)))
    return affected


def rename(font, weight, subfamily):
    name = font["name"]
    name.names = [r for r in name.names if r.nameID not in (1, 2, 3, 4, 6, 16, 17, 18)]
    ps = f"QalaTest-{subfamily}"
    full = f"{FAMILY} {subfamily}"
    old_copyright = name.getDebugName(0) or ""
    for plat, enc, lang in [(3, 1, 0x409), (1, 0, 0)]:
        name.setName(FAMILY, 1, plat, enc, lang)
        name.setName(subfamily, 2, plat, enc, lang)
        name.setName(f"{ps}-v1; test fork of Faustina", 3, plat, enc, lang)
        name.setName(full, 4, plat, enc, lang)
        name.setName(ps, 6, plat, enc, lang)
        name.setName(FAMILY, 16, plat, enc, lang)
        name.setName(subfamily, 17, plat, enc, lang)
        name.setName(
            f"Fork of Faustina for Qala testing. {old_copyright}".strip(),
            0, plat, enc, lang,
        )
    os2 = font["OS/2"]
    os2.usWeightClass = weight
    head = font["head"]
    if weight >= 700:
        head.macStyle |= 0x01
        os2.fsSelection |= 0x20
        os2.fsSelection &= ~0x40
    else:
        head.macStyle &= ~0x01
        os2.fsSelection |= 0x40
        os2.fsSelection &= ~0x20
    os2.fsSelection &= ~0x01  # upright
    if "DSIG" in font:
        del font["DSIG"]  # source signature no longer valid


def main():
    os.makedirs("..", exist_ok=True)
    for weight, (sub, factor) in TARGETS.items():
        print(f"--- {weight} {sub} factor={factor:.5f} ---", flush=True)
        font = instantiateVariableFont(TTFont(SRC), {"wght": weight}, inplace=False)
        print("hinted glyphs:", hint_count(font), flush=True)
        affected = narrow_lowercase(font, factor)
        print("narrowed glyphs:", len(affected), flush=True)
        rename(font, weight, sub)
        font.recalcBBoxes = True
        font.save(f"../QalaTest-{sub}.ttf")
        font.flavor = "woff2"
        font.save(f"../QalaTest-{sub}.woff2")
        ref = instantiateVariableFont(TTFont(SRC), {"wght": weight}, inplace=False)
        ref.save(f"Faustina-{weight}-ref.ttf")
    print("done")


if __name__ == "__main__":
    main()
