"""Qala equipment renders: the foam roller, the Theragun and the treadmill.

Run headless:

    blender -b -P assets/3d/build_gear.py -- --out /tmp/qala-gear [--only roller,theragun,treadmill] [--samples 96]

Each object is built from scratch in code (1 Blender unit = 1 inch), from the
owner's own product photos, and rendered once from a three-quarter view into a
transparent PNG with its own orthographic camera fitted to its bounding box.
`pack_gear.py` trims and shrinks them into `apps/web/public/gear/`.

These are looks-like models: the shape, proportions, colours and the features
that make each one read as itself (the roller's raised grid blocks and lime core,
the Theragun's triangle handle and ball head, the treadmill's leaning uprights
and tablet). Brand names and logos are left off, as the QALA plates did with
the bar maker's.

The studio is the plates' (bright sky, hard horizon, dark floor), copied rather
than shared so that touching this file can never change a plate render.
"""

import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = args[args.index("--out") + 1] if "--out" in args else "/tmp/qala-gear"
ONLY = set(args[args.index("--only") + 1].split(",")) if "--only" in args else None
SAMPLES = int(args[args.index("--samples") + 1]) if "--samples" in args else 96
SIZE = 768
os.makedirs(OUT, exist_ok=True)


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
sc.render.resolution_x = sc.render.resolution_y = SIZE
sc.render.resolution_percentage = 100
sc.view_settings.view_transform = "Standard"

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
els[0].position, els[0].color = 0.20, (0.10, 0.10, 0.12, 1)
els[1].position, els[1].color = 0.95, (0.92, 0.94, 0.98, 1)
els.new(0.47).color = (0.10, 0.10, 0.12, 1)
els.new(0.55).color = (0.42, 0.44, 0.50, 1)
els.new(0.72).color = (0.78, 0.80, 0.86, 1)
bg.inputs["Strength"].default_value = 0.95
nt.links.new(cr.outputs["Color"], bg.inputs["Color"])
nt.links.new(bg.outputs["Background"], out.inputs["Surface"])


def lights(scale):
    """The plates' key, fill, rim and rake lights, moved out and scaled up with the object."""
    for o in [o for o in bpy.data.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(o, do_unlink=True)
    for name, loc, size, energy in (
        ("Key", (-18, -22, 20), 16, 3800),
        ("Fill", (22, -20, 6), 14, 1800),
        ("Rim", (0, 14, 16), 10, 2200),
        ("RimL", (-22, 12, 12), 9, 2600),       # edge light behind the object, so black reads on the dark theme
        ("Rake", (-40, -14, 2), 6, 5200),
    ):
        d = bpy.data.lights.new(name, "AREA")
        d.energy, d.size = energy * scale * scale, size * scale
        o = bpy.data.objects.new(name, d)
        sc.collection.objects.link(o)
        o.location = Vector(loc) * scale
        o.rotation_euler = (Vector((0, 0, 0)) - o.location).to_track_quat("-Z", "Y").to_euler()


def principled(name, base, rough, metallic=0.0, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*lin(base), 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metallic
    if emit:
        b.inputs["Emission Color"].default_value = (*lin(emit[0]), 1)
        b.inputs["Emission Strength"].default_value = emit[1]
    return m


def link(ob, mat, parent):
    sc.collection.objects.link(ob)
    if mat:
        ob.data.materials.append(mat)
    ob.parent, ob.matrix_parent_inverse = parent, Matrix.Identity(4)
    return ob


def smooth(ob, angle=32):
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    ob.select_set(False)


def root(name, rot=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    sc.collection.objects.link(e)
    e.rotation_euler = rot
    return e


def delete_tree(fr):
    for ch in list(fr.children):
        data = ch.data.name if ch.data is not None else None
        kind = bpy.data.meshes if ch.type == "MESH" else bpy.data.curves
        bpy.data.objects.remove(ch, do_unlink=True)
        if data is not None and data in kind and kind[data].users == 0:
            kind.remove(kind[data])
    bpy.data.objects.remove(fr, do_unlink=True)


def revolve(name, prof, mat, parent, steps=128, ang=32):
    """Spin a (radius, z) profile round local Z."""
    me = bpy.data.meshes.new(name)
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
    ob = link(bpy.data.objects.new(name, me), mat, parent)
    smooth(ob, ang)
    return ob


def box(name, size, loc, mat, parent, rot=(0, 0, 0), bevel=0.3, seg=3):
    """A rounded box; the size goes into the vertices so the bevel is in true inches."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me), mat, parent)
    ob.location, ob.rotation_euler = loc, [math.radians(a) for a in rot]
    m = ob.modifiers.new("Bevel", "BEVEL")
    m.width, m.segments, m.limit_method = bevel, seg, "ANGLE"
    smooth(ob, 40)
    return ob


def arc_block(name, z0, z1, r0, r1, a0, a1, mat, parent, bevel=0.07):
    """A solid section of a ring, from angle a0 to a1 round local Z, soft-edged."""
    n = max(2, int((a1 - a0) / 0.1))
    corners = ((r0, z0), (r1, z0), (r1, z1), (r0, z1))
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = []
    for k in range(n + 1):
        a = a0 + (a1 - a0) * k / n
        rings.append([bm.verts.new((r * math.cos(a), r * math.sin(a), z)) for r, z in corners])
    for k in range(n):
        for j in range(4):
            bm.faces.new((rings[k][j], rings[k][(j + 1) % 4], rings[k + 1][(j + 1) % 4], rings[k + 1][j]))
    bm.faces.new(rings[0])
    bm.faces.new(rings[-1][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me), mat, parent)
    m = ob.modifiers.new("Bevel", "BEVEL")
    m.width, m.segments = bevel, 2
    smooth(ob, 50)
    return ob


def fillet(pts, rs, n=12):
    """Round the corners of a 2D polyline, one radius per interior corner."""
    out = [pts[0]]
    for (p0, p1, p2), r in zip(zip(pts, pts[1:], pts[2:]), rs):
        v1 = Vector((p0[0] - p1[0], p0[1] - p1[1])).normalized()
        v2 = Vector((p2[0] - p1[0], p2[1] - p1[1])).normalized()
        ang = v1.angle(v2)
        d = r / math.tan(ang / 2)
        c = Vector(p1) + (v1 + v2).normalized() * (r / math.sin(ang / 2))
        a, b = Vector(p1) + v1 * d - c, Vector(p1) + v2 * d - c
        a0 = math.atan2(a.y, a.x)
        da = (math.atan2(b.y, b.x) - a0 + math.pi) % math.tau - math.pi
        out += [(c.x + r * math.cos(a0 + da * k / n), c.y + r * math.sin(a0 + da * k / n)) for k in range(n + 1)]
    out.append(pts[-1])
    return out


def camera(az, el, objs):
    """An orthographic camera at (az, el), its frame fitted round the objects' bounding boxes."""
    for o in [o for o in bpy.data.objects if o.type == "CAMERA"]:
        bpy.data.objects.remove(o, do_unlink=True)
    a, e = math.radians(az), math.radians(el)
    cd = bpy.data.cameras.new("Gear")
    cd.type = "ORTHO"
    cam = bpy.data.objects.new("Gear", cd)
    sc.collection.objects.link(cam)
    cam.location = Vector((-math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * 400
    cam.rotation_euler = (Vector((0, 0, 0)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    inv = cam.matrix_world.inverted()
    xs, ys = [], []
    for ob in objs:
        ev = ob.evaluated_get(dg)
        for c in ev.bound_box:
            p = inv @ (ob.matrix_world @ Vector(c))
            xs.append(p.x)
            ys.append(p.y)
    ext = max(max(xs) - min(xs), max(ys) - min(ys)) * 1.06
    cd.ortho_scale = ext
    cd.shift_x, cd.shift_y = (max(xs) + min(xs)) / 2 / ext, (max(ys) + min(ys)) / 2 / ext
    return cam


meta = {}


def render(name, fr, az, el, scale):
    lights(scale)
    camera(az, el, [c for c in fr.children if c.type in {"MESH", "CURVE"}])
    sc.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True)
    meta[name] = {"file": name + ".png", "size": SIZE}
    print("rendered", name)


def wanted(name):
    return not ONLY or name in ONLY


# ---------------------------------------------------------------------------
# foam roller: a 13 x 5.5 inch black grid roller with a lime core, the lime end toward the viewer.
# Built along local Z, then turned so Z is world X.
def build_roller():
    fr = root("roller", (0, math.radians(90), 0))
    L = 6.5
    foam = principled("Foam", (0.085, 0.085, 0.095), 0.62)
    lime = principled("Core", (0.72, 0.89, 0.06), 0.42)
    RB, RT = 2.45, 2.75                                          # groove floor, raised tops

    def ring(z0, z1, c=0.07):
        return [(RB, z0), (RT - c, z0), (RT, z0 + c), (RT, z1 - c), (RT - c, z1), (RB, z1)]

    revolve("Floor", [(0, -L), (RB, -L), (RB, L - 0.5), (0, L - 0.5)], foam, fr)
    revolve("EndLeft", ring(-L, -L + 0.4) + [(0, -L + 0.4)], foam, fr)
    revolve("EndRight", [(2.40, L - 0.4), (RT - 0.07, L - 0.4), (RT, L - 0.33), (RT, L - 0.07), (RT - 0.07, L),
                         (2.38, L), (2.30, L - 0.07), (2.30, L - 0.3)], foam, fr)
    revolve("Core", [(0, L - 0.32), (2.30, L - 0.32)], lime, fr)
    revolve("CoreRim", [(2.30, L - 0.32), (2.30, L - 0.30), (1.95, L - 0.30)], foam, fr)
    # raised rings: the narrow ridges, from the left end to the right
    for z0, z1 in [(-5.9, -5.6), (-5.35, -5.05), (-4.8, -4.5),
                   (-2.7, -2.4), (-2.15, -1.85), (-1.6, -1.3), (-1.05, -0.75), (-0.5, -0.2),
                   (3.15, 3.45), (3.7, 4.0), (4.25, 4.55), (4.8, 5.1), (5.35, 5.65)]:
        revolve("Ridge", ring(z0, z1), foam, fr, steps=96)
    # the big grid blocks, round the circumference with gaps between them
    for z0, z1, count, gap in [(-4.25, -3.0, 8, 0.13), (-0.0, 2.95, 7, 0.14)]:
        span = math.tau / count
        for i in range(count):
            arc_block("Block", z0, z1, RB - 0.02, RT, i * span + gap / 2, (i + 1) * span - gap / 2, foam, fr)
    return fr


# ---------------------------------------------------------------------------
# Theragun: a rounded-triangle handle, a round motor boss at the top right, a stem and a ball head.
# Measured off the photo at 58 px to the inch; X right, Z up, the face toward -Y.
def build_theragun():
    fr = root("theragun")
    body = principled("Body", (0.085, 0.29, 0.42), 0.50)
    dark = principled("Head", (0.075, 0.07, 0.085), 0.50)
    rod = principled("Rod", (0.03, 0.03, 0.035), 0.35, 0.8)

    def pt(px, py):
        return ((px - 225) / 58, -(py - 190) / 58)

    A, B, C = pt(32, 91), pt(146, 299), pt(365, 91)
    tri = fillet([A, B, C, A, B], [0.80, 0.80, 1.05])      # corners B, C, A
    ring = tri[1:-1]
    cu = bpy.data.curves.new("Handle", "CURVE")
    cu.dimensions, cu.bevel_depth, cu.bevel_resolution, cu.use_fill_caps = "3D", 0.50, 10, False
    s = cu.splines.new("POLY")
    s.points.add(len(ring) - 1)
    for p, (x, z) in zip(s.points, ring):
        p.co = (x, 0.0, z, 1.0)
    s.use_cyclic_u = True
    h = link(bpy.data.objects.new("Handle", cu), body, fr)
    h.scale = (1.0, 1.4, 1.0)                              # a deeper section than it is wide
    # the motor boss: a short cylinder facing the viewer, a hair proud of the handle
    cx, cz = pt(338, 138)
    boss = revolve("Boss", [(0, 0.88), (0.80, 0.88), (0.86, 0.83), (0.89, 0.83), (0.95, 0.76), (0.95, -0.60), (0, -0.60)], body, fr)
    boss.location, boss.rotation_euler = (cx, 0, cz), (math.radians(90), 0, 0)
    # stem
    sx, _ = pt(362, 0)
    stem = revolve("Stem", [(0, 1.2), (0.47, 1.2), (0.47, -1.18), (0.40, -1.30), (0, -1.33)], body, fr)
    stem.location = (sx, 0, pt(0, 215)[1])
    # rod and ball head
    top = pt(0, 288)[1]
    revolve("Rod", [(0, top + 0.1), (0.13, top + 0.1), (0.13, top - 0.45), (0, top - 0.45)], rod, fr).location = (sx, 0, 0)
    ball = revolve("Ball", [(0, -2.16), (0.62, -2.16), (0.70, -2.20), (0.78, -2.50), (0.76, -2.75), (0.62, -3.10), (0.35, -3.30), (0, -3.34)],
                   dark, fr)
    ball.location = (sx, 0, 0)
    return fr


# ---------------------------------------------------------------------------
# treadmill: a black belt deck on rails, a motor hood at the front and two uprights
# leaning back to a console with a tablet. Inches; X across, Y along the belt (front +Y), Z up.
def build_treadmill():
    fr = root("treadmill")
    plastic = principled("Plastic", (0.10, 0.10, 0.115), 0.34)
    frame = principled("Frame", (0.14, 0.14, 0.16), 0.30, 0.5)
    belt = principled("Belt", (0.04, 0.04, 0.045), 0.78)
    rubber = principled("Rubber", (0.05, 0.05, 0.055), 0.85)
    glass = principled("Glass", (0.012, 0.014, 0.02), 0.07, 0.0, emit=((0.05, 0.22, 0.34), 0.55))
    # the deck: belt, side rails, rear cap
    box("Belt", (22, 60, 1.6), (0, -1, 8.2), belt, fr, bevel=0.4)
    for sx in (-1, 1):
        box("Rail", (6.5, 66, 6.0), (sx * 15.2, 0, 7.0), plastic, fr, bevel=1.1, seg=4)
    box("RearCap", (36, 4.5, 6.5), (0, -33.5, 6.6), plastic, fr, bevel=1.5, seg=4)
    box("RearRoller", (22.5, 2.2, 3.4), (0, -31.8, 8.6), frame, fr, bevel=0.9)
    # the motor hood
    box("Hood", (36.5, 17, 12), (0, 31, 10.5), plastic, fr, bevel=2.2, seg=5)
    box("HoodTop", (30, 12, 4), (0, 29, 16.2), plastic, fr, rot=(-14, 0, 0), bevel=1.4, seg=4)
    # feet
    for fx, fy in ((-14, -30), (14, -30), (-14, 33), (14, 33)):
        box("Foot", (6, 6, 3.2), (fx, fy, 1.6), rubber, fr, bevel=1.0)
    # uprights, leaning back toward the lifter
    for sx in (-1, 1):
        box("Upright", (3.6, 6.2, 52), (sx * 18.6, 29.5, 38), frame, fr, rot=(14, 0, 0), bevel=1.2, seg=4)
    # handrails run back from the uprights, a crossbar and the console between the tops
    for sx in (-1, 1):
        box("Rail2", (2.6, 30, 2.6), (sx * 19.2, 15.5, 50), frame, fr, bevel=1.1, seg=4)
        box("RailPost", (2.9, 2.9, 43), (sx * 19.2, 0.6, 30.5), frame, fr, bevel=1.2, seg=4)
    box("Console", (34, 8, 6.5), (0, 22.5, 62), plastic, fr, rot=(-14, 0, 0), bevel=2.0, seg=5)
    # the tablet: a bezel and a lit glass face, tilted back
    box("Bezel", (28, 2.4, 17), (0, 21.3, 73.5), plastic, fr, rot=(-20, 0, 0), bevel=0.9)
    box("Screen", (26.4, 0.4, 15.4), (0, 20.2, 73.6), glass, fr, rot=(-20, 0, 0), bevel=0.15, seg=2)
    return fr


# ---------------------------------------------------------------------------
if wanted("roller"):
    fr = build_roller()
    render("roller", fr, -35.0, 15.0, 1.0)
    delete_tree(fr)
if wanted("theragun"):
    fr = build_theragun()
    render("theragun", fr, -12.0, 9.0, 1.0)
    delete_tree(fr)
if wanted("treadmill"):
    fr = build_treadmill()
    render("treadmill", fr, 38.0, 16.0, 3.4)
    delete_tree(fr)

with open(os.path.join(OUT, "meta_raw.json"), "w") as f:
    json.dump(meta, f, indent=1)
print("done", len(meta), "renders")
