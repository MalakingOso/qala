"""Qala plate and bar sprites, rendered in Blender.

Run headless:

    blender -b -P assets/3d/build_sprites.py -- --out /tmp/qala-sprites

It builds a competition bumper plate, the bar and a studio from scratch (1
Blender unit = 1 inch), then renders transparent PNG sprites with one
orthographic camera, so any sprite can be placed on the bar by translating it
along the bar's axis on screen:

    plate_<weight>_<color>.png   one plate, back face centre on the origin
    face_<weight>_<color>.png    the same plate nearly face on (small chips)
    sleeve.png                   the 16.25" sleeve and end cap, from the collar
    bar_back.png                 collar and the shaft behind it
    knurl_tile.png               a window of knurled shaft that tiles along the axis
    meta.json                    pixel origin of each sprite and the axis vector

Everything is real geometry: the plate profile (raised lip, recessed groove,
lower field, raised hub ring), raised lettering, steel insert, polished
sleeve. Lettering is Montserrat Bold (OFL), included beside this file.
"""

import json
import math
import os
import sys

import bmesh
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

# ---------------------------------------------------------------------------
# options
args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = args[args.index("--out") + 1] if "--out" in args else "/tmp/qala-sprites"
ONLY = set(args[args.index("--only") + 1].split(",")) if "--only" in args else None
SAMPLES = int(args[args.index("--samples") + 1]) if "--samples" in args else 96
HERE = os.path.dirname(os.path.abspath(__file__))
FONT_PATH = os.path.join(HERE, "Montserrat-Bold.ttf")
os.makedirs(OUT, exist_ok=True)

PX_PER_IN = 24            # sprite scale
CANVAS = 480              # px; 20" of view
AZ, EL = 52.0, 12.0       # camera azimuth from the plate's normal, and elevation
SLEEVE_LEN = 16.25
BORE_R = 1.0              # 2" bore

# name -> (sRGB colour, ink)
COLORS = {
    "red": ((0.82, 0.19, 0.17), "white"),
    "blue": ((0.14, 0.36, 0.80), "white"),
    "yellow": ((0.95, 0.74, 0.07), "white"),
    "green": ((0.13, 0.62, 0.33), "white"),
    "white": ((0.93, 0.94, 0.96), "dark"),
    "charcoal": ((0.17, 0.18, 0.22), "white"),
    "silver": ((0.72, 0.75, 0.79), "dark"),
}
# weight -> (diameter in, thickness in, bumper?)
PLATES = {
    55: (17.7, 3.3, True),
    45: (17.7, 2.9, True),
    35: (17.7, 2.3, True),
    25: (17.7, 1.67, True),
    10: (17.7, 0.94, True),
    5: (9.0, 0.75, False),
    2.5: (6.5, 0.6, False),
    1.25: (5.0, 0.5, False),
}


def lin(c):
    return [(v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c]


# ---------------------------------------------------------------------------
# scene
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.unit_settings.system = "NONE"
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
sc.render.film_transparent = True
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGBA"
sc.render.resolution_x = sc.render.resolution_y = CANVAS
sc.render.resolution_percentage = 100
sc.view_settings.view_transform = "Standard"

font = bpy.data.fonts.load(FONT_PATH)

# studio: bright sky, hard horizon, dark floor (what makes chrome read as chrome)
w = bpy.data.worlds.new("Studio")
sc.world = w
w.use_nodes = True
nt = w.node_tree
nt.nodes.clear()
N = nt.nodes.new
tc, sp, mp, cr = N("ShaderNodeTexCoord"), N("ShaderNodeSeparateXYZ"), N("ShaderNodeMapRange"), N("ShaderNodeValToRGB")
bg, out = N("ShaderNodeBackground"), N("ShaderNodeOutputWorld")
nt.links.new(tc.outputs["Object"], sp.inputs["Vector"])
nt.links.new(sp.outputs["Z"], mp.inputs["Value"])
mp.inputs["From Min"].default_value, mp.inputs["From Max"].default_value = -1.0, 1.0
nt.links.new(mp.outputs["Result"], cr.inputs["Fac"])
els = cr.color_ramp.elements
els[0].position, els[0].color = 0.20, (0.10, 0.10, 0.12, 1)       # floor
els[1].position, els[1].color = 0.95, (0.92, 0.94, 0.98, 1)       # sky
els.new(0.47).color = (0.10, 0.10, 0.12, 1)                       # horizon line, dark
els.new(0.55).color = (0.42, 0.44, 0.50, 1)
els.new(0.72).color = (0.78, 0.80, 0.86, 1)
bg.inputs["Strength"].default_value = 0.95
nt.links.new(cr.outputs["Color"], bg.inputs["Color"])
nt.links.new(bg.outputs["Background"], out.inputs["Surface"])


def set_lights(names, on):
    for n in names:
        bpy.data.objects[n].hide_render = not on


def area(name, loc, size, energy, size_y=None):
    d = bpy.data.lights.new(name, "AREA")
    d.energy, d.size = energy, size
    if size_y:
        d.shape, d.size_y = "RECTANGLE", size_y
    o = bpy.data.objects.new(name, d)
    sc.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()


area("Key", (-18, -22, 20), 16, 3800)
area("Fill", (22, -20, 6), 14, 1800)
area("Rim", (0, 14, 16), 10, 2200)
area("Rake", (-40, -14, 2), 6, 5200)
# long strips along the bar's axis (world Y): the thin bright streaks on polished tubes
area("StripTop", (-12, 0, 26), 2.4, 16000, size_y=70)
area("StripSide", (-34, 0, 8), 1.4, 9000, size_y=70)


def make_camera(az, el, scale):
    for o in [o for o in bpy.data.objects if o.type == "CAMERA"]:
        bpy.data.objects.remove(o, do_unlink=True)
    az, el = math.radians(az), math.radians(el)
    cd = bpy.data.cameras.new("Sprite")
    cd.type, cd.ortho_scale = "ORTHO", scale
    cam = bpy.data.objects.new("Sprite", cd)
    sc.collection.objects.link(cam)
    cam.location = Vector((-math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))) * 80
    cam.rotation_euler = (Vector((0, 0, 0)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    return cam


# ---------------------------------------------------------------------------
# geometry helpers
def revolve(name, prof, mat, parent, steps=160, smooth=32):
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    sc.collection.objects.link(ob)
    bm = bmesh.new()
    vs = [bm.verts.new((r, 0, z)) for r, z in prof]
    for a, c in zip(vs, vs[1:]):
        bm.edges.new((a, c))
    bmesh.ops.spin(bm, geom=list(bm.verts) + list(bm.edges), cent=(0, 0, 0), axis=(0, 0, 1),
                   angle=math.tau, steps=steps, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth))
    ob.select_set(False)
    ob.data.materials.append(mat)
    ob.parent, ob.matrix_parent_inverse = parent, Matrix.Identity(4)
    return ob


def principled(name, base, rough, metallic=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*lin(base), 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metallic
    return m


def text(body, size, loc, rot, mat, parent, name, extrude=0.055):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body, cu.font, cu.size = body, font, size
    cu.align_x = cu.align_y = "CENTER"
    cu.extrude, cu.bevel_depth, cu.bevel_resolution = extrude, 0.014, 2
    ob = bpy.data.objects.new(name, cu)
    sc.collection.objects.link(ob)
    ob.data.materials.append(mat)
    ob.parent, ob.matrix_parent_inverse = parent, Matrix.Identity(4)
    ob.location, ob.rotation_euler = loc, (0, 0, rot)
    return ob


STEEL = principled("Steel", (0.80, 0.82, 0.85), 0.22, 1.0)
CHROME = principled("Chrome", (0.93, 0.94, 0.96), 0.11, 1.0)


def delete_tree(frame):
    """Remove a frame and everything parented to it (and the data they own)."""
    for ch in list(frame.children):
        data = ch.data
        bpy.data.objects.remove(ch, do_unlink=True)
        if data is not None and data.users == 0:
            (bpy.data.meshes if isinstance(data, bpy.types.Mesh) else bpy.data.curves).remove(data)
    bpy.data.objects.remove(frame, do_unlink=True)


def new_frame(name):
    """An empty turned so a part's local +Z (outward, toward the viewer) is world -Y."""
    e = bpy.data.objects.new(name, None)
    sc.collection.objects.link(e)
    e.rotation_euler = (math.radians(90), 0, 0)
    return e


# ---------------------------------------------------------------------------
# a plate
def build_plate(weight, color, lettering=True):
    dia, T, bumper = PLATES[weight]
    R = dia / 2
    rgb, ink = COLORS[color]
    frame = new_frame(f"plate_{weight}_{color}")
    rubber = principled(f"Rubber_{color}", rgb, 0.52 if bumper else 0.38, 0.0 if bumper else 0.55)
    if bumper:
        front = [
            (R, T / 2), (R, T - 0.30), (R - 0.12, T - 0.08), (R - 0.30, T),           # rounded outer corner
            (7.95, T),                                                                  # outer lip band (highest)
            (7.90, T - 0.06), (7.82, T - 0.24), (7.62, T - 0.24),                       # recessed groove (deepest)
            (7.54, T - 0.06), (7.46, T - 0.12),                                         # down onto the field
            (2.60, T - 0.12),                                                           # middle field (lower than the lip)
            (2.52, T - 0.04), (2.40, T - 0.02), (1.70, T - 0.02),                       # raised ring round the hub
            (1.62, T - 0.08), (BORE_R + 0.02, T - 0.08),
        ]
    else:  # plain iron change plate
        front = [(R, T / 2), (R, T - 0.12), (R - 0.14, T), (BORE_R + 0.5, T), (BORE_R + 0.42, T - 0.05), (BORE_R + 0.02, T - 0.05)]
    back = [(r, T - z) for (r, z) in reversed(front)]
    prof = front + back[1:-1] + [back[-1]]
    prof = [p for i, p in enumerate(prof) if i == 0 or p != prof[i - 1]]
    revolve("Body", prof, rubber, frame)
    if bumper:
        revolve("Insert", [(BORE_R, 0.25), (BORE_R, T - 0.06), (BORE_R + 0.08, T), (1.52, T), (1.64, T - 0.07), (1.64, 0.25)],
                STEEL, frame)
        inkmat = principled("Ink", (0.93, 0.95, 1.0) if ink == "white" else (0.06, 0.08, 0.13), 0.42)
        z = T - 0.12 + 0.04
        if not lettering:
            return frame
        label = f"{weight:g}LB"
        text(label, 1.75, (-5.0, 0, z), 0, inkmat, frame, "W_left")
        text(label, 1.75, (5.0, 0, z), math.pi, inkmat, frame, "W_right")
        # QALA along an arc, tops of the letters outward; the bottom copy is turned 180 degrees
        r, size, track = 5.75, 3.15, 0.30
        widths = []
        for ch in "QALA":
            t = text(ch, size, (0, 0, z), 0, inkmat, frame, "m")
            bpy.context.view_layer.update()
            widths.append(t.dimensions.x)
            bpy.data.objects.remove(t, do_unlink=True)
        ang = math.pi / 2 + ((sum(widths) + track * 3) / r) / 2
        for ch, wd in zip("QALA", widths):
            a = ang - (wd / 2) / r
            text(ch, size, (r * math.cos(a), r * math.sin(a), z), a - math.pi / 2, inkmat, frame, "L_" + ch)
            text(ch, size, (-r * math.cos(a), -r * math.sin(a), z), a + math.pi / 2, inkmat, frame, "Lb_" + ch)
            ang -= (wd + track) / r
    elif lettering:
        inkmat = principled("InkSmall", (0.93, 0.95, 1.0) if ink == "white" else (0.06, 0.08, 0.13), 0.42)
        text(f"{weight:g}", min(1.5, R * 0.34), (-(BORE_R + R) / 2 + 0.05, 0, T + 0.0), 0, inkmat, frame, "W_small", 0.03)
    return frame


# ---------------------------------------------------------------------------
# the bar
def build_bar():
    knurl = principled("Knurl", (0.42, 0.43, 0.46), 0.40, 1.0)
    nt = knurl.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tc, nz, bp = nt.nodes.new("ShaderNodeTexCoord"), nt.nodes.new("ShaderNodeTexNoise"), nt.nodes.new("ShaderNodeBump")
    nz.inputs["Scale"].default_value, nz.inputs["Detail"].default_value = 420, 6
    bp.inputs["Strength"].default_value = 0.0
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    nt.links.new(nz.outputs["Fac"], bp.inputs["Height"])
    nt.links.new(bp.outputs["Normal"], b.inputs["Normal"])
    cap = principled("Cap", (0.02, 0.10, 0.55), 0.35)
    white = principled("CapInk", (0.95, 0.96, 1.0), 0.4)

    back = new_frame("bar_back")
    revolve("ShaftSmooth", [(0.55, -6.0), (0.55, -1.0)], CHROME, back)
    revolve("ShaftKnurl", [(0.55, -26.0), (0.55, -6.0)], knurl, back)
    revolve("Collar", [(0.56, -1.0), (1.42, -1.0), (1.54, -0.9), (1.54, -0.55), (1.49, -0.52), (1.49, -0.47), (1.54, -0.44),
                       (1.54, -0.08), (1.46, 0.0), (1.16, 0.0), (1.10, -0.07), (1.02, -0.07), (0.985, 0.0)], CHROME, back)

    sleeve = new_frame("sleeve")
    L = SLEEVE_LEN
    revolve("Sleeve", [(0.985, 0.0), (0.985, L - 0.10), (0.90, L), (0.84, L), (0.84, L - 0.07), (0.0, L - 0.07)], CHROME, sleeve)
    revolve("CapDisc", [(0.0, L - 0.05), (0.83, L - 0.05)], cap, sleeve, steps=64)
    text("QALA", 0.30, (0, 0.16, L - 0.035), 0, white, sleeve, "CapText1", 0.006)
    text("28MM   45LB", 0.115, (0, -0.13, L - 0.035), 0, white, sleeve, "CapText2", 0.006)

    tile = new_frame("knurl_tile")
    revolve("KnurlLong", [(0.55, -60.0), (0.55, 20.0)], knurl, tile)
    return back, sleeve, tile


# ---------------------------------------------------------------------------
# rendering
meta = {"px_per_in": PX_PER_IN, "canvas": CANVAS, "sprites": {}}


def show(frames):
    for fr in bpy.data.objects:
        if fr.type in {"EMPTY"}:
            vis = fr in frames
            fr.hide_render = not vis
            for ch in fr.children:
                ch.hide_render = not vis


def render(name, frames, cam, shift=(0.0, 0.0), size=CANVAS):
    if ONLY and name not in ONLY and name.split("_")[0] not in ONLY:
        return
    show(frames)
    cam.data.shift_x, cam.data.shift_y = shift
    sc.render.resolution_x = sc.render.resolution_y = size
    bpy.context.view_layer.update()
    sc.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True)
    o = world_to_camera_view(sc, cam, Vector((0, 0, 0)))
    u = world_to_camera_view(sc, cam, Vector((0, -1, 0)))
    meta["sprites"][name] = {
        "file": name + ".png", "size": size,
        "ox": o.x * size, "oy": (1 - o.y) * size,
        "axis": [(u.x - o.x) * size, -(u.y - o.y) * size],     # px per inch, outward
    }
    print("rendered", name)


cam = make_camera(AZ, EL, CANVAS / PX_PER_IN)
back, sleeve, tile = build_bar()

for weight in PLATES:
    colors = list(COLORS) if PLATES[weight][2] else ["charcoal", "silver"]
    for color in colors:
        fr = build_plate(weight, color)
        render(f"plate_{weight:g}_{color}", [fr], cam)
        delete_tree(fr)

# bar parts: shift the view so each sits in frame (more samples: mirrors are noisy)
# lit only by the studio and the long strips along the bar, so a tube looks the
# same everywhere along its length and its strips tile without seams
sc.cycles.samples = max(SAMPLES, 192)
set_lights(["Key", "Fill", "Rim", "Rake"], False)
render("sleeve", [sleeve], cam, shift=(0.40, 0.0))
render("bar_back", [back], cam, shift=(-0.40, 0.0))
render("knurl_tile", [tile], cam, shift=(0.0, 0.0))
set_lights(["Key", "Fill", "Rim", "Rake"], True)

sc.cycles.samples = SAMPLES
# nearly face-on plates for the small chips (the same sprite, from the front)
fcam = make_camera(6.0, 4.0, 19.0)
for weight in PLATES:
    colors = list(COLORS) if PLATES[weight][2] else ["charcoal", "silver"]
    for color in colors:
        fr = build_plate(weight, color, lettering=False)
        render(f"face_{weight:g}_{color}", [fr], fcam, size=192)
        delete_tree(fr)

with open(os.path.join(OUT, "meta_raw.json"), "w") as f:
    json.dump(meta, f, indent=1)
print("done", len(meta["sprites"]), "sprites")
