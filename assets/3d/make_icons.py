"""Compose app icon candidates and a contact sheet from the `--icon` renders.

    blender -b -P assets/3d/build_sprites.py -- --out /tmp/qala-icons --icon
    python3 assets/3d/make_icons.py /tmp/qala-icons /tmp/qala-icons/out

`--icon --only icon_qc_dumbbell,icon_q_mont800 --samples 24 --size 600` is a quick preview of single renders.

The chosen icon is Qk. `--ship DIR` writes the set the app serves into DIR (apps/web/public/icons):

    python3 assets/3d/make_icons.py /tmp/qala-icons /tmp/qala-icons/out --ship apps/web/public/icons

Up to 96 px the plate carries only the Q (Qh); from 192 px up it is Qk, with QALA over the top and
45LB on each side. At 96 px and under the lettering is specks, and the Q has to carry the icon alone.

`--android RES` writes the Android launcher icon into a res directory (apps/android/app/src/main/res):
an adaptive icon with the lettered Qk as the foreground, the light ground as the background, and a
single-colour Q as the monochrome layer that themed icons (Android 13+) tint. Only `icon_qk_both` is
needed (`blender -b -P assets/3d/build_sprites.py -- --out DIR --icon --only icon_qk_both`):

    python3 assets/3d/make_icons.py /tmp/qala-icons /tmp/qala-icons/out --android apps/android/app/src/main/res

Each candidate is a full-bleed 1024 px square (no rounded corners: the OS masks it),
with the plate scaled so every opaque pixel lies inside the maskable safe zone
(W3C Web App Manifest: a circle at the centre with radius 40% of the icon's
size). The sheet shows each one with that circle drawn on it, then masked as an
Android circle and a rounded square at 192, 96 and 48 px, on a light and a dark
home screen, since that is where an icon has to survive.
"""

import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
SIZE = 1024
SAFE_R = 0.40 * SIZE
LIGHT, INK = (245, 245, 247), (15, 21, 42)          # --bg and --fg of the light theme
RUN = (72, 92, 199)                                 # --run, the colour of running in the app

# key, render, background, label
CANDIDATES = [
    ("A", "icon_face_red", LIGHT, "Red plate, face on, on the light ground"),
    ("B", "icon_face_ember", INK, "Ember plate (the accent), face on, on ink"),
    ("C", "icon_face_blue", INK, "Blue 45 lb plate, face on, on ink"),
    ("D", "icon_oblique_red", INK, "Red plate at an angle, on ink"),
    ("E", "icon_stack", LIGHT, "Three plates stacked, on the light ground"),
    ("F", "icon_q_white", INK, "The route is the Q: a lap round the hub, a tail leaving it (white)"),
    ("G", "icon_face_ember", RUN, "Ember plate on the run colour, no route"),
    ("H", "icon_q_run", INK, "The route is the Q, in the run colour"),
    ("I", "icon_climb_run", INK, "Ember plate with a wandering GPS route, in the run colour"),
    # no ground: just the plate, on a transparent background
    ("Q", "icon_q_red", None, "A raised Q on the red plate, the hub in its middle, transparent background"),
    ("Gp", "icon_face_ember", None, "G without its ground: the ember plate alone, transparent background"),
    ("Qa", "icon_qa_tail", None, "The plate grows a tail: the whole plate, hub and all, with a tail out of its rim"),
    ("Qb", "icon_qb_ring", None, "The plate is the Q: a bumper ring with an open counter, and a tail"),
    # round two: a steel core in the ring, gym kit for a tail; the raised Q drawn in tight round a steel hub
    ("Qc", "icon_qc_dumbbell", None, "Ring with a steel core and a small bore; the tail is a dumbbell"),
    ("Qd", "icon_qd_barbell", None, "Ring with a steel core and a small bore; the tail is a loaded barbell"),
    ("Qe", "icon_qe_plate", None, "Ring with a steel core and a small bore; the tail is a second plate"),
    ("Qf", "icon_q_mont800", None, "Raised Q, Montserrat ExtraBold, its counter tight round a steel hub (the swoop is the font's)"),
    ("Qh", "icon_q_mont800_snug", None, "Raised Q, Montserrat ExtraBold, drawn in even tighter: counter just clear of the bore"),
    # Qh with the plate's own lettering added back
    ("Qi", "icon_qi_weights", None, "Qh with the weight on each side: 45LB"),
    ("Qj", "icon_qj_qala", None, "Qh with QALA on the arc over the top"),
    ("Qk", "icon_qk_both", None, "Qh with QALA over the top and 45LB on each side (the app icon)"),
    ("Ql", "icon_ql_all", None, "Qh with QALA top and bottom as well: the bottom arc runs into the Q's tail"),
]
# sheet file -> candidates on it
SHEETS = {
    "contact-sheet": list("ABCDE"),
    "contact-sheet-run": list("BFHGI"),
    "contact-sheet-q": ["Q", "Gp", "G"],
    "contact-sheet-qshape": ["Qa", "Qb", "Q"],
    "contact-sheet-qring": ["Qb", "Qc", "Qd", "Qe"],
    "contact-sheet-qtight": ["Q", "Qf", "Qh"],
    "contact-sheet-qlettered": ["Qi", "Qj", "Qk", "Ql"],
}
# only what has been rendered: a partial `--icon --only` run makes the candidates it has and the sheets they complete
CANDIDATES = [c for c in CANDIDATES if os.path.exists(os.path.join(src, c[1] + ".png"))]
HAVE = {c[0] for c in CANDIDATES}
SHEETS = {name: keys for name, keys in SHEETS.items() if set(keys) <= HAVE}
FILL = 0.488 * SIZE        # a transparent icon's plate fills the canvas (a 1000 px disc in 1024)


def trimmed(path):
    im = Image.open(path).convert("RGBA")
    return im.crop(im.getchannel("A").point(lambda a: 255 if a > 6 else 0).getbbox())


def compose(render, bg, radius=SAFE_R * 0.99):
    """The render on a flat ground (or none), scaled so every opaque pixel is within `radius` of the centre."""
    return fit(trimmed(os.path.join(src, render + ".png")), bg, radius)


def fit(spr, bg, radius):
    """`spr` (already trimmed to its bounding box) centred on a SIZE square, scaled so every opaque pixel is
    within `radius` of the centre."""
    # centre by the bounding box, then shrink until every opaque pixel is inside the radius
    a = spr.getchannel("A").point(lambda v: 255 if v > 6 else 0)
    cx, cy = spr.width / 2, spr.height / 2
    far = 0.0
    px = a.load()
    for y in range(0, spr.height, 2):
        for x in range(0, spr.width, 2):
            if px[x, y]:
                far = max(far, ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5)
    k = radius / far
    spr = spr.resize((round(spr.width * k), round(spr.height * k)), Image.LANCZOS)
    canvas = Image.new("RGBA", (SIZE, SIZE), (*bg, 255) if bg else (0, 0, 0, 0))
    pos = ((SIZE - spr.width) // 2, (SIZE - spr.height) // 2)
    if bg == LIGHT:                                   # a soft shadow so it sits on the ground
        sh = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        sh.paste((15, 21, 42, 70), (pos[0], pos[1] + 16), spr.getchannel("A"))
        canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(18)))
    canvas.alpha_composite(spr, pos)
    return canvas


def masked(img, size, shape):
    im = img.resize((size, size), Image.LANCZOS)
    m = Image.new("L", (size * 4, size * 4), 0)
    d = ImageDraw.Draw(m)
    if shape == "circle":
        d.ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    else:
        d.rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=size * 4 * 0.22, fill=255)
    m = m.resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(im, (0, 0), m)
    return out


font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 22)
small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 15)
PAD = 24
ROW_H = 512 + 2 * PAD + 34
PANE_W, PANE_H = 14 + 192 + 14 + 96 + 14 + 48 + 14, 14 + 192 + 14 + 192 + 14
IMAGES, MASKABLE = {}, {}
for key, render, bg, label in CANDIDATES:
    if bg is None:        # fills the canvas for browsers and docks; the twin sits in the safe zone for masks
        IMAGES[key] = compose(render, None, FILL)
        MASKABLE[key] = compose(render, None)
        IMAGES[key].save(os.path.join(dst, f"icon-{key}.png"))
        MASKABLE[key].save(os.path.join(dst, f"icon-{key}-maskable.png"))
    else:
        IMAGES[key] = compose(render, bg)
        IMAGES[key].convert("RGB").save(os.path.join(dst, f"icon-{key}.png"))


def checker(size, cell=16):
    c = Image.new("RGB", (size, size), (250, 250, 250))
    d = ImageDraw.Draw(c)
    for y in range(0, size, cell):
        for x in range(0, size, cell):
            if (x // cell + y // cell) % 2:
                d.rectangle((x, y, x + cell - 1, y + cell - 1), fill=(226, 226, 230))
    return c


def make_sheet(name, keys):
    rows = [c for k in keys for c in CANDIDATES if c[0] == k]
    sheet = Image.new("RGB", (PAD + 512 + PAD + 2 * (PANE_W + PAD), ROW_H * len(rows) + PAD), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    for i, (key, render, bg, label) in enumerate(rows):
        img = IMAGES[key]
        lay(sheet, d, i, key, label, img)
    sheet.save(os.path.join(dst, name + ".png"))


def lay(sheet, d, i, key, label, img):
    y = PAD + i * ROW_H
    d.text((PAD, y), f"{key}   {label}", fill=(15, 21, 42), font=font)
    y += 34
    big = img.resize((512, 512), Image.LANCZOS)
    if key in MASKABLE:
        back = checker(512).convert("RGBA")
        back.alpha_composite(big)
        big = back
    img = MASKABLE.get(key, img)
    guide = ImageDraw.Draw(big)
    guide.ellipse((256 - SAFE_R / 2, 256 - SAFE_R / 2, 256 + SAFE_R / 2, 256 + SAFE_R / 2), outline=(255, 0, 200), width=2)
    sheet.paste(big.convert("RGB"), (PAD, y))
    x = PAD + 512 + PAD
    # on a light and a dark home screen: circle and rounded square at 192, then 96 and 48
    for ground in ((236, 238, 244), (22, 26, 40)):
        pane = Image.new("RGB", (PANE_W, PANE_H), ground)
        px = 14
        for size, shape in ((192, "circle"), (96, "circle"), (48, "circle")):
            ic = masked(img, size, shape)
            pane.paste(ic, (px, 14), ic)
            px += size + 14
        px = 14
        for size, shape in ((192, "square"), (96, "square"), (48, "square")):
            ic = masked(img, size, shape)
            pane.paste(ic, (px, 14 + 192 + 14), ic)
            px += size + 14
        sheet.paste(pane, (x, y))
        x += pane.width + PAD


for name, keys in SHEETS.items():
    make_sheet(name, keys)
print("wrote", len(CANDIDATES), "candidates and", len(SHEETS), "sheets to", dst)


# -- the icon the app ships ----------------------------------------------------------------------
BIG, SMALL = "icon_qk_both", "icon_q_mont800_snug"       # lettered, and the plain Q for small sizes
SMALL_BELOW = 128                                        # px: under this the plate carries only the Q
SHIPPED = (32, 48, 96, 192, 512)


def ship(out):
    """Write the app's icons. Transparent ones fill the canvas (browsers, docks, the install prompt); the
    maskable and iOS ones sit in the safe zone on the app's light ground, since a mask or iOS fills clear pixels."""
    os.makedirs(out, exist_ok=True)
    full = {r: compose(r, None, FILL) for r in (BIG, SMALL)}
    for size in SHIPPED:
        render = SMALL if size < SMALL_BELOW else BIG
        full[render].resize((size, size), Image.LANCZOS).save(os.path.join(out, f"icon-{size}.png"), optimize=True)
        print(f"icon-{size}.png  {'Q only' if render == SMALL else 'lettered'}")
    grounded = compose(BIG, LIGHT).convert("RGB")
    grounded.resize((512, 512), Image.LANCZOS).save(os.path.join(out, "icon-maskable-512.png"), optimize=True)
    grounded.resize((180, 180), Image.LANCZOS).save(os.path.join(out, "apple-touch-icon.png"), optimize=True)
    print("icon-maskable-512.png and apple-touch-icon.png  lettered, on the light ground")


if "--ship" in sys.argv:
    ship(sys.argv[sys.argv.index("--ship") + 1])


# -- the Android launcher icon ---------------------------------------------------------------------
# An adaptive icon is a 108 dp canvas of which the launcher shows a mask-shaped window of about 72 dp, and
# important content has to stay inside the central 66 dp circle (radius 33 dp) so no mask clips it.
ADAPTIVE_DP, ADAPTIVE_SAFE_DP = 108, 66
ANDROID_R = 0.99 * ADAPTIVE_SAFE_DP / 2 / ADAPTIVE_DP * SIZE
DENSITIES = (("mdpi", 1), ("hdpi", 1.5), ("xhdpi", 2), ("xxhdpi", 3), ("xxxhdpi", 4))
GLYPH_FONT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Montserrat-ExtraBold.ttf")


def counter_box(mask):
    """Bounding box of the glyph's counter: the clear pixels the outside can't reach. Found by flooding the
    outside from a corner, so whatever stays clear is enclosed."""
    flooded = mask.copy()
    ImageDraw.floodfill(flooded, (0, 0), 128)
    return flooded.point(lambda v: 255 if v == 0 else 0).getbbox()


def monochrome_q():
    """The Q as a single-colour silhouette (the themed-icon layer), drawn from the same Montserrat ExtraBold glyph
    as the 3D icon and stretched the same way so its counter is round."""
    big = 1600
    f = ImageFont.truetype(GLYPH_FONT, big)
    box = f.getbbox("Q")
    pad = 40
    mask = Image.new("L", (box[2] - box[0] + 2 * pad, box[3] - box[1] + 2 * pad), 0)
    ImageDraw.Draw(mask).text((pad - box[0], pad - box[1]), "Q", font=f, fill=255)
    x0, y0, x1, y1 = counter_box(mask)
    a, b = (x1 - x0) / 2, (y1 - y0) / 2
    if abs(a / b - 1) <= 0.08:            # the 3D Q stretches only a few percent, and keeps the shape past 8%
        mask = mask.resize((round(mask.width * b / a), mask.height), Image.LANCZOS)
    spr = Image.new("RGBA", mask.size, (0, 0, 0, 0))
    spr.putalpha(mask)
    return spr.crop(mask.point(lambda v: 255 if v > 6 else 0).getbbox())


def android(res):
    """Write the adaptive launcher icon into the res directory: foreground and monochrome PNGs at every density,
    the background colour, and the adaptive-icon XML."""
    foreground = compose(BIG, None, ANDROID_R)
    mono = fit(monochrome_q(), None, ANDROID_R)
    for name, scale in DENSITIES:
        px = round(ADAPTIVE_DP * scale)
        d = os.path.join(res, "mipmap-" + name)
        os.makedirs(d, exist_ok=True)
        foreground.resize((px, px), Image.LANCZOS).save(os.path.join(d, "ic_launcher_foreground.png"), optimize=True)
        mono.resize((px, px), Image.LANCZOS).save(os.path.join(d, "ic_launcher_monochrome.png"), optimize=True)
        print(f"mipmap-{name}: {px} px foreground and monochrome")
    os.makedirs(os.path.join(res, "values"), exist_ok=True)
    with open(os.path.join(res, "values", "ic_launcher_background.xml"), "w") as f:
        f.write(f"""<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#{LIGHT[0]:02x}{LIGHT[1]:02x}{LIGHT[2]:02x}</color>
</resources>
""")
    os.makedirs(os.path.join(res, "mipmap-anydpi"), exist_ok=True)
    adaptive = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
"""
    for name in ("ic_launcher", "ic_launcher_round"):       # minSdk 34: no -v26 qualifier, no legacy PNGs
        with open(os.path.join(res, "mipmap-anydpi", name + ".xml"), "w") as f:
            f.write(adaptive)
    print("values/ic_launcher_background.xml, mipmap-anydpi/ic_launcher.xml and ic_launcher_round.xml")


if "--android" in sys.argv:
    android(sys.argv[sys.argv.index("--android") + 1])
