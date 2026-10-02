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
    ez_back.png                  EZ curl bar: collar, polished shaft and the bends (replaces bar_back and knurl_tile)
    ez_hero.png                  the whole EZ bar, for a picker
    meta.json                    pixel origin of each sprite and the axis vector

`--only ez` renders just the EZ parts (pack them with `pack_sprites.py ... --merge`).
`--icon` instead renders the app icon candidates and stops (see make_icons.py).
`--save-blend PATH` (with `--icon`) also writes a .blend of the Qk icon plate, the one
`build_intro.py` animates. Add `--only icon_qk_both --samples 1 --size 128` to skip the big renders.

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
SAVE_BLEND = args[args.index("--save-blend") + 1] if "--save-blend" in args else None
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
# the EZ curl bar (DECISIONS L13)
# Behind the collar this bar is not a knurled tube, so one sprite (`ez_back`:
# collar, polished shaft, the bends) stands in for `bar_collar` and the knurl
# tiles; the sleeve pieces are the straight bar's. `ez_hero` is the whole bar,
# for a picker. Bends run in the vertical plane, so the low plate camera shows them.
EZ_R = 0.50            # 1" shaft
EZ_FILLET = 0.75       # centre-line bend radius
EZ_HALF = 15.0         # collar face to bar centre
EZ_SLEEVE = 7.5


def ez_profile(back_only):
    """Centre line as (u, rise): u inches back from the collar face, and where the
    bent grip section starts and ends. One block of three steep jogs and two
    shallow runs, back on the axis at the end, like the reference bar. On the
    whole bar the block is centred; for the plate drawing it starts closer to the
    collar so the bends show on a card that only has room for a little shaft."""
    jog, run, up, down = 1.1, 3.6, 1.4, 2.1
    span = 3 * jog + 2 * run
    u0 = 6.0 if back_only else (2 * EZ_HALF - span) / 2
    pts = [(0.0, 0.0), (u0, 0.0)]
    u, y = u0, 0.0
    for i in range(3):
        u, y = u + jog, y + up
        pts.append((u, y))
        if i < 2:
            u, y = u + run, y - down
            pts.append((u, y))
    return pts + [(2 * EZ_HALF, 0.0)], u0, u0 + span


def fillet(pts, r, n=10):
    """Round the corners of a 2D polyline with arcs of radius r."""
    out = [pts[0]]
    for p0, p1, p2 in zip(pts, pts[1:], pts[2:]):
        v1 = Vector((p0[0] - p1[0], p0[1] - p1[1])).normalized()
        v2 = Vector((p2[0] - p1[0], p2[1] - p1[1])).normalized()
        ang = v1.angle(v2)
        if abs(math.pi - ang) < 1e-4:
            out.append(p1)
            continue
        d = r / math.tan(ang / 2)
        c = Vector(p1) + (v1 + v2).normalized() * (r / math.sin(ang / 2))
        a, b = Vector(p1) + v1 * d - c, Vector(p1) + v2 * d - c
        a0 = math.atan2(a.y, a.x)
        da = (math.atan2(b.y, b.x) - a0 + math.pi) % math.tau - math.pi
        out += [(c.x + r * math.cos(a0 + da * k / n), c.y + r * math.sin(a0 + da * k / n)) for k in range(n + 1)]
    out.append(pts[-1])
    return out


def tube(name, pts, mat, parent, z0=0.0):
    """A round bar along a (u, rise) polyline; local z runs outward, so back is -u."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions, cu.bevel_depth, cu.bevel_resolution, cu.use_fill_caps = "3D", EZ_R, 8, True
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for p, (u, y) in zip(sp.points, pts):
        p.co = (0.0, y, z0 - u, 1.0)
    ob = bpy.data.objects.new(name, cu)
    sc.collection.objects.link(ob)
    ob.data.materials.append(mat)
    ob.parent, ob.matrix_parent_inverse = parent, Matrix.Identity(4)
    return ob


def ez_shaft(parent, back_only, z0=0.0):
    grip = principled("Grip", (0.50, 0.52, 0.55), 0.46, 1.0)
    prof, u0, u1 = ez_profile(back_only)
    pts = fillet(prof, EZ_FILLET)
    cut = next(i for i, p in enumerate(pts) if p[0] > u0 - 0.5)       # polished shaft ends a little before the first bend
    far = next(i for i, p in enumerate(pts) if p[0] > u1 + 0.5)
    tube("EzPolishA", pts[:cut + 1], CHROME, parent, z0)
    tube("EzGrip", pts[cut:far], grip, parent, z0)
    tube("EzPolishB", pts[far - 1:], CHROME, parent, z0)


def ez_collar(parent, z0=0.0, flip=False):
    ob = revolve("Collar", [(0.56, -1.0), (1.42, -1.0), (1.54, -0.9), (1.54, -0.55), (1.49, -0.52), (1.49, -0.47), (1.54, -0.44),
                            (1.54, -0.08), (1.46, 0.0), (1.16, 0.0), (1.10, -0.07), (1.02, -0.07), (0.985, 0.0)], CHROME, parent)
    ob.location = (0, 0, z0)
    if flip:
        ob.rotation_euler = (0, math.pi, 0)


def ez_sleeve(parent, z0=0.0, flip=False):
    cap = principled("Cap", (0.02, 0.10, 0.55), 0.35)
    L = EZ_SLEEVE
    for ob in (revolve("Sleeve", [(0.985, 0.0), (0.985, L - 0.10), (0.90, L), (0.84, L), (0.84, L - 0.07), (0.0, L - 0.07)], CHROME, parent),
               revolve("CapDisc", [(0.0, L - 0.05), (0.83, L - 0.05)], cap, parent, steps=64)):
        ob.location = (0, 0, z0)
        if flip:
            ob.rotation_euler = (0, math.pi, 0)


def build_ez_back():
    fr = new_frame("ez_back")
    ez_collar(fr)
    ez_shaft(fr, True)
    return fr


def build_ez_hero():
    fr = new_frame("ez_hero")
    ez_shaft(fr, False, EZ_HALF)
    for z0, flip in ((EZ_HALF, False), (-EZ_HALF, True)):
        ez_collar(fr, z0, flip)
        ez_sleeve(fr, z0, flip)
    return fr


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


def render_wide(name, frames, cam, size, origin):
    """`render` for a canvas wider than tall, with the bar's origin put at pixel `origin`."""
    if ONLY and name not in ONLY and name.split("_")[0] not in ONLY:
        return
    W, H = size
    show(frames)
    cam.data.shift_x = -(origin[0] - W / 2) / max(W, H)
    cam.data.shift_y = (origin[1] - H / 2) / max(W, H)
    sc.render.resolution_x, sc.render.resolution_y = W, H
    bpy.context.view_layer.update()
    sc.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True)
    o = world_to_camera_view(sc, cam, Vector((0, 0, 0)))
    u = world_to_camera_view(sc, cam, Vector((0, -1, 0)))
    meta["sprites"][name] = {
        "file": name + ".png", "size": [W, H],
        "ox": o.x * W, "oy": (1 - o.y) * H,
        "axis": [(u.x - o.x) * W, -(u.y - o.y) * H],
    }
    print("rendered", name)


# ---------------------------------------------------------------------------
# app icon candidates: `--icon` renders big plate poses and stops (see make_icons.py)
if "--icon" in args:
    COLORS["ember"] = ((0.76, 0.255, 0.047), "white")      # the app's accent, #c2410c
    sc.cycles.samples = SAMPLES if "--samples" in args else max(SAMPLES, 128)
    SIZE = int(args[args.index("--size") + 1]) if "--size" in args else 1400
    PPI = 62.0 * SIZE / 1400                                         # --size only changes pixels, not the framing
    for name, weight, color in (("face_red", 45, "red"), ("face_ember", 45, "ember"), ("face_blue", 45, "blue")):
        fr = build_plate(weight, color)
        render(f"icon_{name}", [fr], make_camera(0.0, 0.0, SIZE / PPI), size=SIZE)
        delete_tree(fr)
    fr = build_plate(55, "red")
    render("icon_oblique_red", [fr], make_camera(38.0, 14.0, SIZE / PPI), size=SIZE)
    delete_tree(fr)
    # a stack from the back: 55 red, 45 blue, 35 yellow
    frs, y = [], 0.0
    for weight, color in ((55, "red"), (45, "blue"), (35, "yellow")):
        fr = build_plate(weight, color)
        fr.location = (0, -y, 0)
        y += PLATES[weight][1]
        frs.append(fr)
    render("icon_stack", frs, make_camera(38.0, 14.0, SIZE / PPI), size=SIZE)
    # the run side: a route laid across an ember plate with the lettering taken off, in white or in
    # the app's run colour (#8e9cf0, the dark theme's --run). "climb" is a wandering GPS trace;
    # "q" is a lap round the hub with a tail leaving it, so the route is the Q of QALA.
    ROUTES = {
        "climb": [(-5.2, -3.6), (-2.2, -4.6), (0.4, -2.4), (3.0, -3.0), (4.6, -0.2), (2.0, 1.8), (4.2, 4.4)],
        "q": [(-5.0, -4.6), (-1.0, -5.2), (3.0, -3.4), (4.4, 0.4), (2.8, 3.8), (-1.4, 4.4), (-4.6, 2.0), (-3.4, -1.6), (1.2, -2.8), (5.6, -5.6)],
    }

    def route_plate(name, shape, rgb):
        fr = build_plate(45, "ember")
        for ch in list(fr.children):
            if ch.name.startswith(("W_", "L_", "Lb_")):       # every letter and number
                bpy.data.objects.remove(ch, do_unlink=True)
        z = PLATES[45][1] + 0.18
        mat = principled("Route", rgb, 0.38)
        pts = ROUTES[shape]
        cu = bpy.data.curves.new("Route", "CURVE")
        cu.dimensions, cu.bevel_depth, cu.bevel_resolution, cu.use_fill_caps, cu.resolution_u = "3D", 0.50, 10, True, 24
        sp = cu.splines.new("BEZIER")
        sp.bezier_points.add(len(pts) - 1)
        for bp, (x, y) in zip(sp.bezier_points, pts):
            bp.co = (x, y, z)
            bp.handle_left_type = bp.handle_right_type = "AUTO"
        ob = bpy.data.objects.new("Route", cu)
        sc.collection.objects.link(ob)
        ob.data.materials.append(mat)
        ob.parent, ob.matrix_parent_inverse = fr, Matrix.Identity(4)
        for (x, y), rad in ((pts[0], 0.66), (pts[-1], 0.92)):   # a small dot to start, a bigger one to finish
            d = revolve("Dot", [(rad * math.sin(a), rad * math.cos(a)) for a in [k * math.pi / 12 for k in range(13)]], mat, fr)
            d.location = (x, y, z)
        render(name, [fr], make_camera(0.0, 0.0, SIZE / PPI), size=SIZE)
        delete_tree(fr)

    # a raised Q on the red plate with the hub in its counter: the glyph is Montserrat Bold,
    # its bowl centred on the hub by measuring the font's own geometry, then scaled so the tail
    # stays on the plate's field
    def q_plate(name):
        fr = build_plate(45, "red", lettering=False)
        T = PLATES[45][1]
        ink = principled("QInk", (0.96, 0.97, 1.0), 0.40)
        q = text("Q", 10.0, (0, 0, T - 0.05), 0, ink, fr, "Q", extrude=0.12)
        q.data.bevel_depth, q.data.bevel_resolution = 0.05, 3
        bpy.context.view_layer.update()
        ev = q.evaluated_get(bpy.context.evaluated_depsgraph_get())
        me = ev.to_mesh()
        pts = [(v.co.x, v.co.y) for v in me.vertices]
        ev.to_mesh_clear()
        ymax, ymin = max(p[1] for p in pts), min(p[1] for p in pts)
        upper = [p for p in pts if p[1] >= ymax - 0.44 * (ymax - ymin)]     # the bowl above its equator: no tail
        xmin, xmax = min(p[0] for p in upper), max(p[0] for p in upper)
        cx, cy = (xmin + xmax) / 2, ymax - (xmax - xmin) / 2
        k = 7.1 / max(math.hypot(x - cx, y - cy) for x, y in pts)
        inner = min(math.hypot(x - cx, y - cy) for x, y in upper) * k
        q.data.size *= k
        q.location = (-cx * k, -cy * k, T - 0.05)
        print("Q glyph: bowl diameter %.2f in, counter radius %.2f in (hub ring is 2.52)" % ((xmax - xmin) * k, inner))
        render(name, [fr], make_camera(0.0, 0.0, SIZE / PPI), size=SIZE)
        delete_tree(fr)

    q_plate("icon_q_red")
    # the plate itself as the Q: its outline gets a tail (the plate is already the O). A tail whose top is
    # flush with the lip fights it for the surface, so it stands a hair proud.
    def slab(name, outline, z0, z1, mat, parent, bevel=0.35):
        """A flat piece from a 2D outline, z0 to z1, with soft edges."""
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        f = bm.faces.new([bm.verts.new((x, y, z0)) for x, y in outline])
        ext = bmesh.ops.extrude_face_region(bm, geom=[f])
        bmesh.ops.translate(bm, vec=(0, 0, z1 - z0), verts=[v for v in ext["geom"] if isinstance(v, bmesh.types.BMVert)])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(name, me)
        sc.collection.objects.link(ob)
        ob.data.materials.append(mat)
        ob.parent, ob.matrix_parent_inverse = parent, Matrix.Identity(4)
        m = ob.modifiers.new("Bevel", "BEVEL")
        m.width, m.segments = bevel, 4
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
        ob.select_set(False)
        return ob

    def stadium(p0, p1, half, n=16):
        ang = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
        pts = [(p1[0] + half * math.cos(ang - math.pi / 2 + math.pi * k / n), p1[1] + half * math.sin(ang - math.pi / 2 + math.pi * k / n)) for k in range(n + 1)]
        return pts + [(p0[0] + half * math.cos(ang + math.pi / 2 + math.pi * k / n), p0[1] + half * math.sin(ang + math.pi / 2 + math.pi * k / n)) for k in range(n + 1)]

    TAIL = (math.cos(-math.pi / 4), math.sin(-math.pi / 4))          # leaves at the lower right

    def at(r):
        return (TAIL[0] * r, TAIL[1] * r)

    def q_shape(name, kind):
        T = PLATES[45][1]
        wide = 1400 / 54.0                                            # a roomier view than the plain plates, for the tail
        if kind == "ring":                                           # a bumper ring: the plate with its middle opened up
            fr = new_frame("ring")
            R, RI = 8.85, 4.5
            rubber = principled("Rubber_red", COLORS["red"][0], 0.52)
            front = [(R, T / 2), (R, T - 0.30), (R - 0.12, T - 0.08), (R - 0.30, T), (7.95, T), (7.90, T - 0.06), (7.82, T - 0.24),
                     (7.62, T - 0.24), (7.54, T - 0.06), (7.46, T - 0.12), (RI + 0.5, T - 0.12), (RI + 0.3, T - 0.04), (RI + 0.12, T - 0.04),
                     (RI, T - 0.2), (RI, T / 2)]
            back = [(r, T - z) for (r, z) in reversed(front)]
            revolve("Body", front + back[1:-1], rubber, fr)
            slab("Tail", stadium(at(5.2), at(10.3), 1.7), 0.0, T + 0.04, rubber, fr)
        else:
            fr = build_plate(45, "red", lettering=False)
            rubber = next(c for c in fr.children if c.name.startswith("Body")).data.materials[0]
            slab("Tail", stadium(at(9.0), at(10.3), 1.7), 0.0, T + 0.04, rubber, fr)      # its inner end hides in the rim
        render(name, [fr], make_camera(0.0, 0.0, wide), size=SIZE)
        delete_tree(fr)

    q_shape("icon_qa_tail", "tail")
    q_shape("icon_qb_ring", "ring")

    # -- round two ---------------------------------------------------------------------------------
    # The ring gets a turned steel core with a small bore, and its tail becomes gym kit. The raised Q
    # gets its counter pulled tight round a steel hub, its tail left as the font draws it.
    def turned_steel(name, rough=0.46):
        """Brushed steel: anisotropic metal whose grain runs round the disc, which is what throws the light and dark
        wedges across a bumper plate's steel centre (a mirror face-on would just reflect the dark horizon)."""
        m = principled(name, (0.90, 0.91, 0.93), rough, 1.0)
        nt = m.node_tree
        b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        tg = nt.nodes.new("ShaderNodeTangent")
        tg.direction_type, tg.axis = "RADIAL", "Z"
        b.inputs["Anisotropic"].default_value = 0.7
        nt.links.new(tg.outputs["Tangent"], b.inputs["Tangent"])
        return m

    def steel_hub(fr, R, B, zt, mat):
        """A flat steel disc, outer radius R, bore B, face at zt, with a small chamfer at the rim and at the bore."""
        prof = [(B, 0.25), (B, zt - 0.05), (B + 0.10, zt), (R - 0.10, zt), (R, zt - 0.08), (R, 0.25)]
        return revolve("Hub", prof, mat, fr)

    def along_tail(ob, r0, zc):
        """Lay a part revolved about its local Z along the tail direction, r0 out from the hub, zc above the plate's back."""
        ob.matrix_basis = Matrix.Translation((TAIL[0] * r0, TAIL[1] * r0, zc)) @ Matrix.Rotation(-math.pi / 4, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "Y")
        return ob

    def cyl(name, rad, length, mat, fr, r0, zc, bevel=0.3):
        b = min(bevel, rad * 0.9, length / 2 - 0.01)
        prof = [(0.0, 0.0), (rad - b, 0.0), (rad, b), (rad, length - b), (rad - b, length), (0.0, length)]
        return along_tail(revolve(name, prof, mat, fr, steps=64), r0, zc)

    def ring_plate(name, tail):
        T = PLATES[45][1]
        fr = new_frame("ring2")
        R, RI, B = 8.85, 4.5, 1.0
        rubber = principled("Rubber_red", COLORS["red"][0], 0.52)
        front = [(R, T / 2), (R, T - 0.30), (R - 0.12, T - 0.08), (R - 0.30, T), (7.95, T), (7.90, T - 0.06), (7.82, T - 0.24),
                 (7.62, T - 0.24), (7.54, T - 0.06), (7.46, T - 0.12), (RI + 0.5, T - 0.12), (RI + 0.3, T - 0.04), (RI + 0.12, T - 0.04),
                 (RI, T - 0.2), (RI, T / 2)]
        back = [(r, T - z) for (r, z) in reversed(front)]
        revolve("Body", front + back[1:-1], rubber, fr)
        steel = turned_steel("Turned")
        steel_hub(fr, RI + 0.08, B, T - 0.10, steel)
        if tail == "dumbbell":
            h, zc = 2.45, T + 1.7
            cyl("HeadA", h, 2.2, rubber, fr, 4.6, zc, 0.4)
            cyl("CollarA", 1.35, 0.5, steel, fr, 6.8, zc, 0.16)
            cyl("Handle", 0.85, 2.4, steel, fr, 7.3, zc, 0.25)
            cyl("CollarB", 1.35, 0.5, steel, fr, 9.7, zc, 0.16)
            cyl("HeadB", h, 2.2, rubber, fr, 10.2, zc, 0.4)
        elif tail == "barbell":
            zc = T + 1.0
            blue = principled("Rubber_blue", COLORS["blue"][0], 0.52)
            cyl("Bar", 0.7, 7.0, steel, fr, 4.8, zc, 0.25)
            cyl("PlateA", 3.7, 1.5, rubber, fr, 7.9, zc, 0.3)
            cyl("PlateB", 2.9, 1.2, blue, fr, 9.4, zc, 0.26)
            cyl("Collar", 1.2, 0.7, steel, fr, 10.6, zc, 0.2)
            cyl("Cap", 0.7, 1.0, steel, fr, 11.3, zc, 0.25)
        elif tail == "plate":
            sm = build_plate(5, "silver", lettering=False)         # a 9 in iron change plate
            sm.location = (TAIL[0] * 8.1, -(T + 0.1), TAIL[1] * 8.1)
            return fr, sm
        return fr, None

    ring_names = {"icon_qc_dumbbell": "dumbbell", "icon_qd_barbell": "barbell", "icon_qe_plate": "plate"}
    for nm, kind in ring_names.items():
        fr, extra = ring_plate(nm, kind)
        render(nm, [fr] + ([extra] if extra else []), make_camera(0.0, 0.0, 1400 / 54.0), size=SIZE)
        delete_tree(fr)
        if extra:
            delete_tree(extra)

    def letter_plate(fr, z, parts, wx=5.0, wsize=1.75, r=5.75, size=3.15, track=0.30):
        """The plate's own lettering as build_plate sets it (45LB each side, QALA on the arc at the top and bottom),
        but each part optional: parts holds any of "w", "t", "b"."""
        ink = principled("InkLetters", (0.93, 0.95, 1.0), 0.42)
        if "w" in parts:
            text("45LB", wsize, (-wx, 0, z), 0, ink, fr, "W_left")
            text("45LB", wsize, (wx, 0, z), math.pi, ink, fr, "W_right")
        if "t" in parts or "b" in parts:
            widths = []
            for ch in "QALA":
                t = text(ch, size, (0, 0, z), 0, ink, fr, "m")
                bpy.context.view_layer.update()
                widths.append(t.dimensions.x)
                bpy.data.objects.remove(t, do_unlink=True)
            ang = math.pi / 2 + ((sum(widths) + track * 3) / r) / 2
            for ch, wd in zip("QALA", widths):
                a = ang - (wd / 2) / r
                if "t" in parts:
                    text(ch, size, (r * math.cos(a), r * math.sin(a), z), a - math.pi / 2, ink, fr, "L_" + ch)
                if "b" in parts:
                    text(ch, size, (-r * math.cos(a), -r * math.sin(a), z), a + math.pi / 2, ink, fr, "Lb_" + ch)
                ang -= (wd + track) / r

    def q_tight(name, ttf, c, lettering="", **lay):
        """The raised Q with its counter drawn in tight round a steel hub of radius c.
        The glyph is measured, then stretched a few percent so its counter is round."""
        T = PLATES[45][1]
        fr = new_frame(name)
        R = PLATES[45][0] / 2
        rubber = principled("Rubber_red", COLORS["red"][0], 0.52)
        front = [(R, T / 2), (R, T - 0.30), (R - 0.12, T - 0.08), (R - 0.30, T), (7.95, T), (7.90, T - 0.06), (7.82, T - 0.24),
                 (7.62, T - 0.24), (7.54, T - 0.06), (7.46, T - 0.12), (BORE_R + 0.02, T - 0.12)]
        back = [(r, T - z) for (r, z) in reversed(front)]
        revolve("Body", front + back[1:-1], rubber, fr)
        ink = principled("QInk", (0.96, 0.97, 1.0), 0.40)
        q = text("Q", 10.0, (0, 0, T - 0.05), 0, ink, fr, "Q", extrude=0.12)
        q.data.font = bpy.data.fonts.load(os.path.join(HERE, ttf))
        q.data.bevel_depth, q.data.bevel_resolution = 0.05, 3
        bpy.context.view_layer.update()
        # the glyph's own contours: the biggest is the outline, the biggest one inside it is the counter
        probe = bpy.data.objects.new("probe", bpy.data.curves.new("probe", "FONT"))
        sc.collection.objects.link(probe)
        probe.data.body, probe.data.font, probe.data.size = "Q", q.data.font, q.data.size
        probe.data.align_x = probe.data.align_y = "CENTER"
        bpy.context.view_layer.objects.active = probe
        probe.select_set(True)
        bpy.ops.object.convert(target="CURVE")
        boxes = []
        for sp in probe.data.splines:
            xs, ys = [bp.co.x for bp in sp.bezier_points], [bp.co.y for bp in sp.bezier_points]
            boxes.append((min(xs), max(xs), min(ys), max(ys)))
        data = probe.data
        bpy.data.objects.remove(probe, do_unlink=True)
        bpy.data.curves.remove(data)
        area_ = lambda bx: (bx[1] - bx[0]) * (bx[3] - bx[2])
        outer = max(boxes, key=area_)
        inner = [bx for bx in boxes if bx is not outer and bx[0] > outer[0] and bx[1] < outer[1] and bx[2] > outer[2] and bx[3] < outer[3]]
        x0, x1, y0, y1 = max(inner, key=area_)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        a, b = (x1 - x0) / 2, (y1 - y0) / 2
        ro = (outer[1] - outer[0]) / 2
        me = q.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
        pts = [(v.co.x, v.co.y) for v in me.vertices]
        q.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh_clear()
        sx, sy = c / a, c / b
        if abs(sx / sy - 1) > 0.08:                                                  # too oval to stretch: keep the shape
            sx = sy = c / min(a, b)
        q.scale = (sx, sy, 1.0)
        q.location = (-cx * sx, -cy * sy, T - 0.05)
        far = max(math.hypot((x - cx) * sx, (y - cy) * sy) for x, y in pts)
        print("%s: counter %.2f x %.2f (aspect %.3f), stretch x%.3f y%.3f, outer bowl r %.2f, tail tip at %.2f in" % (
            name, 2 * a, 2 * b, a / b, sx, sy, ro * sx, far))
        steel_hub(fr, c * 1.08, BORE_R, T - 0.02, turned_steel("Turned"))       # its rim tucks under the glyph
        if lettering:
            letter_plate(fr, T - 0.08, lettering, **lay)
        render(name, [fr], make_camera(0.0, 0.0, SIZE / PPI), size=SIZE)
        if SAVE_BLEND and name == "icon_qk_both":
            os.makedirs(os.path.dirname(os.path.abspath(SAVE_BLEND)), exist_ok=True)
            show([fr])
            bpy.ops.wm.save_as_mainfile(filepath=SAVE_BLEND, copy=True, relative_remap=False)
            print("saved", SAVE_BLEND)
        delete_tree(fr)

    for nm, ttf, c in (("icon_q_mont800", "Montserrat-ExtraBold.ttf", 2.2), ("icon_q_mont800_snug", "Montserrat-ExtraBold.ttf", 1.8)):
        q_tight(nm, ttf, c)
    # Qh with the plate's lettering added back: weights, QALA over the top, both, and all of it.
    # Qk ("both") is the app icon; Qh is what it shrinks to at small sizes (see make_icons.py --ship).
    for nm, parts, lay in (("icon_qi_weights", "w", dict(wx=5.5, wsize=1.5)), ("icon_qj_qala", "t", {}),
                           ("icon_qk_both", "wt", dict(wx=5.5, wsize=1.5)), ("icon_ql_all", "wtb", dict(wx=5.5, wsize=1.5))):
        q_tight(nm, "Montserrat-ExtraBold.ttf", 1.8, parts, **lay)
    route_plate("icon_climb_run", "climb", (0.557, 0.612, 0.941))
    route_plate("icon_q_white", "q", (0.96, 0.97, 1.0))
    route_plate("icon_q_run", "q", (0.557, 0.612, 0.941))
    with open(os.path.join(OUT, "meta_raw.json"), "w") as f:
        json.dump(meta, f, indent=1)
    sys.exit(0)

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

# EZ bar: the straight bar's camera, on a canvas wide enough for 30" of shaft going back
if not ONLY or "ez" in ONLY or "ez_back" in ONLY or "ez_hero" in ONLY:
    EZ_W, EZ_H = 760, 420
    ecam = make_camera(AZ, EL, EZ_W / PX_PER_IN)
    fr = build_ez_back()
    sc.cycles.samples = max(SAMPLES, 192)
    set_lights(["Key", "Fill", "Rim", "Rake"], False)         # as the straight bar's pieces
    render_wide("ez_back", [fr], ecam, (EZ_W, EZ_H), (EZ_W - 100, 300))
    set_lights(["Key", "Fill", "Rim", "Rake"], True)
    delete_tree(fr)
    sc.cycles.samples = SAMPLES
    hcam = make_camera(75.0, 22.0, 900 / 20.0)
    fr = build_ez_hero()
    render_wide("ez_hero", [fr], hcam, (900, 360), (450, 180))
    delete_tree(fr)

with open(os.path.join(OUT, "meta_raw.json"), "w") as f:
    json.dump(meta, f, indent=1)
print("done", len(meta["sprites"]), "sprites")
