"""Qala intro: the red Qk plate drops, slaps flat, kicks up dust and settles with the Q upright.

Needs the plate, saved once from build_sprites.py:

    blender -b -P assets/3d/build_sprites.py -- --icon --only icon_qk_both --samples 1 --size 128 \\
        --out /tmp/qala-intro/sprites --save-blend /tmp/qala-intro/qk.blend

Then, headless. Cycles runs on both Arcs through oneAPI by default (see "Blender on Arc" in the global
CLAUDE.md: the scene is a few hundred MB, far under the B570's 10 GB); `--device b60` or `b570` uses one card,
`--device cpu` the CPU. If a GPU wedges, that file has the recovery playbook. Ray tracing uses Embree's BVH on
the GPU; `--hwrt` turns on oneAPI hardware ray tracing, whose acceleration-structure build stalls for 20+
minutes on the dust volume, for the same pixels.

    blender -b -P assets/3d/build_intro.py -- --previs                  # low-res playblast, contact sheet
    blender -b -P assets/3d/build_intro.py -- --sheet-only              # redo the mp4 and sheet from rendered previs frames
    blender -b -P assets/3d/build_intro.py -- --still 30,62             # frames, full quality
    blender -b -P assets/3d/build_intro.py -- --still 30 --previs-quality   # one frame, previs quality
    blender -b -P assets/3d/build_intro.py                              # every frame, RGBA PNG, resumable

Writes to --out (default /tmp/qala-intro/out): previs.mp4 + contact.png, still_NNNN.png, frames/f_NNNN.png,
and intro.json (timing and where the plate settles in the frame, for the page's HTML wordmark).
Then assets/3d/encode_intro.sh turns frames/ into the shipped videos.

The dust is a Mantaflow gas sim rendered from its OpenVDB cache as a Volume object, plus a particle system of
chalk grains. Its source is the slap itself: a solid proxy of the plate is a moving obstacle that squeezes the air
out from under it across a thin layer of dust laid on the floor at the contact frame (--dust-source slap, the
default; "ring" is the older wall emitter at the rim). Flags, so the look can be tuned without editing:
--dust-res (base grid, 200), --dust-noise (wavelet upres, 2; 0 off), --dust-noise-strength, --dust-noise-size,
--dust-floor (how much dust lies under the plate), --dust-floor-r, --dust-slap (how hard the plate pushes the air),
--dust-sink (dust is heavier than air), --dust-life (fade), --dust-settle (shader fade-out frames), --dust-vorticity, --dust-steps, --dust-density and
--dust-glow (shading), --dust-clip, --dust-wall, --dust-tex-size, --grains, --grain-r, --grain-life, --grain-drag.
A bake at 200 takes about 16 minutes and every run rebakes unless --keep-cache finds a complete cache in --cache;
use it when only the shading or the grains changed. --no-dust skips all of it. Low-resolution bakes do not predict
the full one: the squeeze under the plate gets much more energetic as the grid gets finer, so judge at 200.

Everything is procedural: the plate is keyframed from closed-form motion (fall, edge-first slap, one rubber
hop, Euler's-disk wobble, settle), so timing is art-directed and repeatable. 1 Blender unit = 1 inch.
Rig, outside in: root (translation) > precession Z > tilt X > spin Z > plate. The root height is solved
every key so the lowest point of the plate's profile sits exactly on the floor.
"""

import json
import math
import os
import shutil
import subprocess
import sys

import bpy
import bmesh
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

# ---------------------------------------------------------------------------
# options
args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


BLEND = opt("--blend", "/tmp/qala-intro/qk.blend")
OUT = opt("--out", "/tmp/qala-intro/out")
CACHE = opt("--cache", "/tmp/qala-intro/cache")
STILLS = [int(v) for v in opt("--still").split(",")] if "--still" in args else None
PREVIS = "--previs" in args
LOWQ = PREVIS or "--previs-quality" in args
SAMPLES = int(opt("--samples", 24 if LOWQ else 96))
THREADS = int(opt("--threads", 28))
DEVICE = opt("--device", "gpu")             # gpu: both Arcs (oneAPI), b60 or b570: one card alone, cpu
SHEET_ONLY = "--sheet-only" in args           # rebuild previs.mp4 and contact.png from frames already rendered
NO_DUST = "--no-dust" in args or SHEET_ONLY
FRAME_RANGE = tuple(int(v) for v in opt("--range").split("-")) if "--range" in args else None
HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------------------
# the shot
W, H = 1080, 720
FPS, FRAMES = 30, 96                      # 3.2 s
EL = 50.0                                 # camera pitch down, degrees
LENS, DIST = 100.0, 128.0                 # mm, inches: a long lens, nearly orthographic
PLATE_AT = (0.5, 0.67)                    # where the plate's centre lands in the frame (x, y from top)

# the beats, in seconds
T_I = 0.90                                # first contact, front edge first
T_A = T_I + 0.10                          # slapped flat
T_B = T_A + 0.24                          # second contact, after one small rubber hop
T_S = 2.20                                # settled, Q upright
G = 220.0                                 # in/s^2, a touch under real gravity so the drop reads
THETA_I, THETA_B = math.radians(21), math.radians(9)
HOP = 1.1                                 # inches
SPIN = 2 * math.pi * 1.1                  # rad/s before the slap


def sstep(a, b, t):
    u = min(1.0, max(0.0, (t - a) / (b - a)))
    return u * u * (3 - 2 * u)


# ---------------------------------------------------------------------------
# scene: the saved plate, its studio and lights
bpy.ops.wm.open_mainfile(filepath=BLEND)
sc = bpy.context.scene
for fr in [o for o in bpy.data.objects if o.type == "EMPTY" and o.name != "icon_qk_both"]:
    for ch in list(fr.children_recursive):
        bpy.data.objects.remove(ch, do_unlink=True)
    bpy.data.objects.remove(fr, do_unlink=True)
for o in [o for o in bpy.data.objects if o.type == "CAMERA"]:
    bpy.data.objects.remove(o, do_unlink=True)
bpy.data.orphans_purge(do_recursive=True)

plate = bpy.data.objects["icon_qk_both"]
PLATE_T = 2.9                              # PLATES[45] thickness
PLATE_R = 8.85

sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
if DEVICE != "cpu":
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "ONEAPI"
    # Embree's BVH, traversed on the GPU. --hwrt turns on oneAPI hardware ray tracing instead: same pixels, but its
    # acceleration-structure build goes single-threaded on the dust volume's mesh and a still takes 20+ minutes
    prefs.use_oneapirt = "--hwrt" in args
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == "ONEAPI" and (DEVICE == "gpu" or DEVICE.upper() in d.name.upper())
    on = [d.name for d in prefs.devices if d.use]
    assert on, "no oneAPI device enabled (is a GPU wedged? see the B60 playbook in ~/.claude/CLAUDE.md)"
    print("cycles devices:", on)
    sc.cycles.device = "GPU"
    sc.cycles.denoising_use_gpu = True
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
sc.cycles.denoiser = "OPENIMAGEDENOISE"
sc.cycles.max_bounces = 6
sc.render.film_transparent = True
sc.render.use_persistent_data = True
sc.render.threads_mode = "FIXED"
sc.render.threads = THREADS
sc.render.fps = FPS
sc.frame_start, sc.frame_end = 0, FRAMES - 1
sc.render.resolution_x, sc.render.resolution_y = W, H
sc.render.resolution_percentage = 50 if PREVIS else 100
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGBA"
sc.render.image_settings.compression = 15
sc.view_settings.view_transform = "Standard"
sc.render.use_motion_blur = True
sc.render.motion_blur_shutter = 0.5
sc.gravity = (0, 0, -120.0)                # for the chalk grains; inches, not metres
bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"


# The sprite lights were set for a plate standing on its edge. Flat on the floor the top face and the
# long strip lights are far too hot (the red goes salmon), so rebalance, and add a big softbox overhead
# whose job is the soft contact shadow on the page.
for name, k in (("Key", 0.22), ("Fill", 0.2), ("Rim", 0.25), ("Rake", 0.2), ("StripTop", 0.08), ("StripSide", 0.2)):
    bpy.data.lights[name].energy *= k
sb = bpy.data.lights.new("Softbox", "AREA")
sb.energy, sb.size = 4200, 46
sbo = bpy.data.objects.new("Softbox", sb)
sc.collection.objects.link(sbo)
sbo.location = (-6, -10, 52)
sbo.rotation_euler = (Vector((0, 0, 0)) - Vector(sbo.location)).to_track_quat("-Z", "Y").to_euler()


# ---------------------------------------------------------------------------
# the plate's profile, for the floor contact
def profile_pairs():
    pairs = set()
    for ob in plate.children:
        if ob.type != "MESH" or ob.hide_render:
            continue
        for v in ob.data.vertices:
            p = ob.matrix_basis @ v.co
            pairs.add((round(math.hypot(p.x, p.y), 3), round(p.z - PLATE_T / 2, 3)))
    return list(pairs)


PROFILE = profile_pairs()
assert max(r for r, _ in PROFILE) > PLATE_R - 0.01, "plate profile not found"


def zlow(theta):
    """Height of the plate's centre above its lowest point when tilted by theta (front edge down)."""
    s, c = math.sin(theta), math.cos(theta)
    return max(r * s - z * c for r, z in PROFILE)


# ---------------------------------------------------------------------------
# motion, closed form
def hop_h(t):
    """Height of the plate's lowest point above the floor."""
    if t < T_I:
        return 0.5 * G * (T_I - t) ** 2
    if T_A <= t < T_B:
        u = (t - T_A) / (T_B - T_A)
        return HOP * 4 * u * (1 - u)
    return 0.0


def tilt(t):
    if t < T_I:
        return THETA_I + math.radians(4) * math.sin(2 * math.pi * 0.9 * (t - T_I))     # a lazy tumble, = THETA_I at contact
    if t < T_A:
        u = (t - T_I) / (T_A - T_I)
        return THETA_I * (1 - u * u)                                                    # the free edge accelerates down: a slap
    if t < T_B:
        u = (t - T_A) / (T_B - T_A)
        return THETA_B * u * u
    if t < T_S:
        tau = (t - T_B) / (T_S - T_B)
        return THETA_B * (1 - tau) ** 1.5
    return 0.0


def prec_rate(t, theta):
    """Euler's disk: the tilt direction circles faster as the tilt dies."""
    if t < T_I:
        return 2 * math.pi * 0.30
    if t < T_B:
        return 2 * math.pi * 0.9
    return 2 * math.pi * min(7.0, 1.0 * math.sqrt(THETA_B / max(theta, 1e-4)))


def spin_rate(t):
    """Net yaw of the plate as seen from above (the Q's turn), not the spin inside the tilt."""
    if t < T_I:
        return SPIN
    tau = min(1.0, max(0.0, (t - T_B) / (T_S - T_B)))
    return SPIN * math.exp(-(t - T_I) / 0.11) + 2 * math.pi * 0.07 * (1 - tau) if t < T_S else 0.0


SUB = 4                                                    # keys per frame; linear between, so blur stays honest
DT = 1.0 / (FPS * SUB)
KEYS = [i * DT for i in range((FRAMES - 1) * SUB + 1)]
THETA = [tilt(t) for t in KEYS]
PHI = [0.0]
for i in range(1, len(KEYS)):
    PHI.append(PHI[-1] + prec_rate(KEYS[i], THETA[i]) * DT)
YAW = [0.0] * len(KEYS)                                    # Psi: integrate backwards so Psi(T_S) = 0, the Q upright
for i in range(len(KEYS) - 2, -1, -1):
    YAW[i] = YAW[i + 1] - spin_rate(KEYS[i + 1]) * DT
SPINNER = [YAW[i] - PHI[i] for i in range(len(KEYS))]     # R = Rz(phi) Rx(theta) Rz(psi); at theta=0 that is Rz(phi + psi) = Rz(yaw)
XPOS = [-3.0 * max(0.0, T_I - t) / T_I for t in KEYS]
ZPOS = [hop_h(t) + zlow(th) for t, th in zip(KEYS, THETA)]

# rig
def empty(name, parent=None):
    e = bpy.data.objects.new(name, None)
    sc.collection.objects.link(e)
    e.parent = parent
    return e


root = empty("DropRoot")
prec = empty("DropPrec", root)
tilter = empty("DropTilt", prec)
spinner = empty("DropSpin", tilter)
plate.parent, plate.matrix_parent_inverse = spinner, Matrix.Identity(4)
plate.rotation_euler = (0, 0, 0)
plate.location = (0, 0, -PLATE_T / 2)
plate.hide_render = False
for ch in plate.children:
    ch.hide_render = ch.type == "MESH" and ch.name.startswith("probe")

for k, t in enumerate(KEYS):
    f = t * FPS
    root.location = (XPOS[k], 0.0, ZPOS[k])
    root.keyframe_insert("location", frame=f)
    prec.rotation_euler = (0, 0, PHI[k])
    prec.keyframe_insert("rotation_euler", index=2, frame=f)
    tilter.rotation_euler = (THETA[k], 0, 0)
    tilter.keyframe_insert("rotation_euler", index=0, frame=f)
    spinner.rotation_euler = (0, 0, SPINNER[k])
    spinner.keyframe_insert("rotation_euler", index=2, frame=f)

# the Q must never turn its blank back to the camera
c_dir = Vector((0, -math.cos(math.radians(EL)), math.sin(math.radians(EL))))
worst = min(
    Vector((math.sin(th) * math.sin(ph), -math.sin(th) * math.cos(ph), math.cos(th))).dot(c_dir)
    for th, ph in zip(THETA, PHI)
)
assert worst > 0.2, f"the back face turns to the camera (n.c = {worst:.2f})"
print(f"face visibility: worst n.c = {worst:.2f}")

# ---------------------------------------------------------------------------
# camera and floor
cd = bpy.data.cameras.new("Intro")
cd.lens, cd.sensor_width, cd.sensor_fit = LENS, 36.0, "HORIZONTAL"
cam = bpy.data.objects.new("Intro", cd)
sc.collection.objects.link(cam)
cam.location = Vector((0, -math.cos(math.radians(EL)), math.sin(math.radians(EL)))) * DIST
cam.rotation_euler = (Vector((0, 0, 0)) - cam.location).to_track_quat("-Z", "Y").to_euler()
sc.camera = cam
bpy.context.view_layer.update()
y0 = world_to_camera_view(sc, cam, Vector((0, 0, 0))).y
cd.shift_y = (y0 - (1 - PLATE_AT[1])) * H / W
cd.shift_x = -(PLATE_AT[0] - 0.5)
bpy.context.view_layer.update()

fm = bpy.data.meshes.new("Floor")
floor = bpy.data.objects.new("Floor", fm)
sc.collection.objects.link(floor)
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=300)
bm.to_mesh(fm)
bm.free()
floor.is_shadow_catcher = True
fmat = bpy.data.materials.new("FloorBounce")                    # a pale floor lights the plate's underside, so the contact line isn't black
fmat.use_nodes = True
fb = next(n for n in fmat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
fb.inputs["Base Color"].default_value = (0.9, 0.9, 0.9, 1)
fb.inputs["Emission Color"].default_value = (1, 1, 1, 1)
fb.inputs["Emission Strength"].default_value = 0.25
floor.data.materials.append(fmat)

# ---------------------------------------------------------------------------
# dust: a Mantaflow smoke burst, then chalk grains
#
# Scale: ~23 px per inch at the plate. The old look failed on size: a 0.47 inch voxel (11 px) with no noise
# upres gave scalloped blobs, and 0.4 inch grains were 9 px pellets. Now the box is just big enough for the
# cloud (it never passes ~2.2 plate radii), the base grid is finer, wavelet noise doubles it again, the
# volume is sampled cubically, and the grains are specks.
DUST_COLOR = (0.80, 0.74, 0.66)            # a mid warm grey: reads on the light page and the dark one
BURSTS = ((T_I, 2.0), (T_B, 0.8))          # (when, strength): the slap, then the second landing; the texture halves these


def ring_mesh(name, radius, z0, z1, segments=96):
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    sc.collection.objects.link(ob)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=segments, radius1=radius, radius2=radius, depth=z1 - z0)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, (z0 + z1) / 2))
    bm.to_mesh(me)
    bm.free()
    return ob


def volume_material(grid):
    """Principled Volume reading the named grid of the baked VDB (the noise cache calls it density_noise)."""
    m = bpy.data.materials.new("Dust")
    m.use_nodes = True
    m.cycles.volume_interpolation = "CUBIC"                           # linear sampling shows the voxel grid as stair-steps
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    pv = nt.nodes.new("ShaderNodeVolumePrincipled")
    pv.inputs["Color"].default_value = (*DUST_COLOR, 1)
    pv.inputs["Density Attribute"].default_value = grid
    # the last of the cloud settles out: density ramps to nothing over DUST_SETTLE, so the poster frame is clean
    # and the wordmark's slot is clear, without a faster dissolve thinning the cloud in its prime
    fade = nt.nodes.new("ShaderNodeValue")
    fade.outputs[0].default_value = 1.0
    fade.outputs[0].keyframe_insert("default_value", frame=DUST_SETTLE[0])
    fade.outputs[0].default_value = 0.0
    fade.outputs[0].keyframe_insert("default_value", frame=DUST_SETTLE[1])
    dens = nt.nodes.new("ShaderNodeMath")
    dens.operation = "MULTIPLY"
    dens.inputs[0].default_value = DUST_DENSITY
    nt.links.new(fade.outputs[0], dens.inputs[1])
    # and a radial falloff about the plate: whatever reaches the edge of the box thins out to nothing before it
    # gets there, so the cloud's edge is never the box's straight edge (it showed as a rectangle on the dark page)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    xyz = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], xyz.inputs["Vector"])
    x2 = nt.nodes.new("ShaderNodeMath"); x2.operation = "MULTIPLY"
    y2 = nt.nodes.new("ShaderNodeMath"); y2.operation = "MULTIPLY"
    nt.links.new(xyz.outputs["X"], x2.inputs[0]); nt.links.new(xyz.outputs["X"], x2.inputs[1])
    nt.links.new(xyz.outputs["Y"], y2.inputs[0]); nt.links.new(xyz.outputs["Y"], y2.inputs[1])
    r2 = nt.nodes.new("ShaderNodeMath"); r2.operation = "ADD"
    nt.links.new(x2.outputs["Value"], r2.inputs[0]); nt.links.new(y2.outputs["Value"], r2.inputs[1])
    r = nt.nodes.new("ShaderNodeMath"); r.operation = "SQRT"
    nt.links.new(r2.outputs["Value"], r.inputs[0])
    ring = nt.nodes.new("ShaderNodeMapRange")
    ring.interpolation_type = "SMOOTHSTEP"
    ring.inputs["From Min"].default_value, ring.inputs["From Max"].default_value = DUST_FADE
    ring.inputs["To Min"].default_value, ring.inputs["To Max"].default_value = 1.0, 0.0
    nt.links.new(r.outputs["Value"], ring.inputs["Value"])
    dens2 = nt.nodes.new("ShaderNodeMath"); dens2.operation = "MULTIPLY"
    nt.links.new(dens.outputs["Value"], dens2.inputs[0]); nt.links.new(ring.outputs["Result"], dens2.inputs[1])
    nt.links.new(dens2.outputs["Value"], pv.inputs["Density"])
    pv.inputs["Anisotropy"].default_value = 0.35
    pv.inputs["Emission Color"].default_value = (*DUST_COLOR, 1)      # self-lit a little, so shadowed dust stays chalk, not soot
    attr = nt.nodes.new("ShaderNodeAttribute")                        # emission is not scaled by density: do it here, or the whole box glows
    attr.attribute_name = grid
    glow = nt.nodes.new("ShaderNodeMath")
    glow.operation = "MULTIPLY"
    glow.inputs[1].default_value = DUST_GLOW
    nt.links.new(attr.outputs["Fac"], glow.inputs[0])
    glow2 = nt.nodes.new("ShaderNodeMath")
    glow2.operation = "MULTIPLY"
    nt.links.new(glow.outputs["Value"], glow2.inputs[0])
    nt.links.new(fade.outputs[0], glow2.inputs[1])
    glow3 = nt.nodes.new("ShaderNodeMath"); glow3.operation = "MULTIPLY"
    nt.links.new(glow2.outputs["Value"], glow3.inputs[0]); nt.links.new(ring.outputs["Result"], glow3.inputs[1])
    nt.links.new(glow3.outputs["Value"], pv.inputs["Emission Strength"])
    nt.links.new(pv.outputs["Volume"], out.inputs["Volume"])
    return m


def volume_object():
    """The baked cache as a Volume object: Cycles samples the sparse VDB directly, which is faster than meshing the
    domain's dense grid, and a fresh process can read the noise files (the domain only reads them after baking)."""
    sub, grid = ("noise", "density_noise") if DUST_NOISE > 0 else ("data", "density")
    vol = bpy.data.volumes.new("DustVol")
    vol.filepath = os.path.join(CACHE, sub, f"fluid_{sub}_0000.vdb")
    vol.is_sequence = True
    vol.frame_start, vol.frame_duration, vol.frame_offset = 0, FRAMES, 0
    vol.sequence_mode = "CLIP"
    vol.render.clipping = DUST_CLIP
    vol.materials.append(volume_material(grid))
    ob = bpy.data.objects.new("DustVol", vol)
    sc.collection.objects.link(ob)
    h = 2 * max(DOMAIN) / DUST_RES / max(1, DUST_NOISE) / 2           # half a voxel: the file puts cell centres on integer indices
    ob.location = (-DOMAIN[0] + h, -DOMAIN[1] + h, h)                 # the files are in the domain's index space, from its min corner
    return ob


def build_dust():
    # the smoke domain: floor at z=0 (collision border), open sides and top so the ring just leaves
    dm = bpy.data.meshes.new("DustDomain")
    dom = bpy.data.objects.new("DustDomain", dm)
    sc.collection.objects.link(dom)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    bm.to_mesh(dm)
    bm.free()
    dom.location, dom.scale = (0, 0, DOMAIN[2]), DOMAIN
    mod = dom.modifiers.new("Fluid", "FLUID")
    mod.fluid_type = "DOMAIN"
    ds = mod.domain_settings
    ds.domain_type = "GAS"
    ds.resolution_max = DUST_RES
    ds.cache_type = "ALL"                                      # bake_all: here the modular bake_noise operator writes empty files
    ds.cache_frame_start, ds.cache_frame_end = 0, FRAMES - 1
    ds.cache_data_format = ds.cache_noise_format = "OPENVDB"
    ds.clipping = 1e-4                                         # voxels below this are not written to the cache
    ds.use_collision_border_bottom = True
    for side in ("front", "back", "left", "right", "top"):
        setattr(ds, f"use_collision_border_{side}", False)
    ds.use_adaptive_timesteps = True                           # the front moves several voxels a frame: more substeps or it smears
    ds.timesteps_max = DUST_STEPS
    ds.use_noise = DUST_NOISE > 0                              # wavelet turbulence: detail finer than the base grid, same motion
    if DUST_NOISE > 0:
        ds.noise_scale = DUST_NOISE                            # the upres factor
        ds.noise_strength = DUST_NOISE_STRENGTH
        ds.noise_pos_scale = DUST_NOISE_SIZE
        ds.noise_time_anim = 0.2
    ds.vorticity = DUST_VORTICITY
    ds.alpha, ds.beta = -DUST_SINK, 0.0                        # dust is not hot and heavier than air: it sinks a little, never plumes
    assert abs(ds.alpha + DUST_SINK) < 1e-4, f"alpha clamped to {ds.alpha}"
    ds.use_dissolve_smoke = True
    ds.use_dissolve_smoke_log = True                           # exponential fade: thin dust thins further instead of vanishing in steps
    ds.dissolve_speed = DUST_LIFE
    # last, on purpose: setting most domain properties runs an update that deletes the cache on disk for the
    # directory set at that moment, so a fresh process would wipe the previous run's bake if this came first
    ds.cache_directory = CACHE
    dom.display_type = "WIRE"
    dom.hide_render = True                                     # the baked files render through volume_object(), not the domain

    tex = bpy.data.textures.new("DustBreakup", "CLOUDS")      # breaks the emission up so the front is uneven, not one halo
    tex.noise_scale = DUST_TEX_SIZE
    tex.noise_depth = 3
    tex.intensity, tex.contrast = 1.0, 1.2

    def flow(ob, bursts, speed=0.0):
        fmod = ob.modifiers.new("Fluid", "FLUID")
        fmod.fluid_type = "FLOW"
        fs = fmod.flow_settings
        fs.flow_type, fs.flow_behavior, fs.flow_source = "SMOKE", "INFLOW", "MESH"
        fs.surface_distance = DUST_WALL
        fs.use_initial_velocity = speed > 0
        fs.velocity_normal = speed
        fs.velocity_random = DUST_SPEED_RANDOM if speed > 0 else 0.0
        fs.smoke_color = DUST_COLOR
        fs.use_texture = True
        fs.noise_texture = tex
        fs.texture_map_type = "AUTO"
        fs.texture_size = 1.0
        fs.use_inflow = False
        fs.keyframe_insert("use_inflow", frame=0)
        fs.density = 0.0
        fs.keyframe_insert("density", frame=0)
        for f0, frames, strength in bursts:
            fs.use_inflow = True
            fs.density = strength
            fs.keyframe_insert("use_inflow", frame=f0)
            fs.keyframe_insert("density", frame=f0)
            fs.use_inflow = False
            fs.keyframe_insert("use_inflow", frame=f0 + frames)
        ob.display_type = "WIRE"
        ob.hide_render = True

    if DUST_SOURCE == "ring":
        # a thin, low wall just outside the plate's rim, blowing outward at the slap and the second landing
        flow(ring_mesh("DustRing", PLATE_R + 0.5, 0.05, 0.55),
             [(round(when * FPS) - 1, 3, strength) for when, strength in BURSTS], speed=DUST_SPEED)
    else:
        # dust lying on the floor under and around the plate, laid down a frame before contact, and a solid proxy
        # of the plate as a moving obstacle: the slap squeezes the air out from under it and that blows the dust
        dm2 = bpy.data.meshes.new("DustFloor")
        disc = bpy.data.objects.new("DustFloor", dm2)
        sc.collection.objects.link(disc)
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=96, radius1=DUST_FLOOR_R, radius2=DUST_FLOOR_R, depth=0.3)
        bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, 0.15))
        bm.to_mesh(dm2)
        bm.free()
        flow(disc, [(round(T_I * FPS), 1, DUST_FLOOR)])       # laid down at the contact frame, under the plate, so it is never seen lying there
        pm = bpy.data.meshes.new("DustPlate")
        proxy = bpy.data.objects.new("DustPlate", pm)
        sc.collection.objects.link(proxy)
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=96, radius1=PLATE_R, radius2=PLATE_R, depth=PLATE_T)
        bm.to_mesh(pm)
        bm.free()
        proxy.parent = spinner                                  # same rig as the plate: z in [-T/2, T/2] about the spinner
        emod = proxy.modifiers.new("Fluid", "FLUID")
        emod.fluid_type = "EFFECTOR"
        es = emod.effector_settings
        es.effector_type = "COLLISION"
        es.use_effector = True
        es.surface_distance = 0.25
        es.subframes = 3
        es.velocity_factor = DUST_SLAP                          # how hard the plate's motion pushes the air
        proxy.display_type = "WIRE"
        proxy.hide_render = True

    # chalk grains: thousands of specks thrown outward and up from the same wall, falling on the floor
    src = ring_mesh("GrainSrc", PLATE_R + 0.2, 0.2, 1.0, segments=48)
    gm = bpy.data.meshes.new("Grain")
    g = bpy.data.objects.new("Grain", gm)
    sc.collection.objects.link(g)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=GRAIN_R)
    bm.to_mesh(gm)
    bm.free()
    gmat = principled_grain()
    g.data.materials.append(gmat)
    g.hide_render = True
    g.location = (0, 0, -50)
    src.modifiers.new("Grains", "PARTICLE_SYSTEM")
    ps = src.particle_systems[0].settings
    ps.count = GRAINS
    ps.frame_start, ps.frame_end = round(T_I * FPS), round(T_I * FPS) + 2
    ps.lifetime, ps.lifetime_random = GRAIN_LIFE, 0.5
    ps.emit_from = "FACE"
    ps.normal_factor = 70.0
    ps.object_align_factor = (0.0, 0.0, 55.0)
    ps.factor_random = 45.0
    ps.drag_factor = GRAIN_DRAG
    ps.effector_weights.gravity = 0.5
    ps.render_type, ps.instance_object = "OBJECT", g
    ps.particle_size, ps.size_random = 1.0, 0.8
    src.show_instancer_for_render = False                    # the grains render, the emitter wall does not
    bpy.context.view_layer.update()
    return dom


def principled_grain():
    m = bpy.data.materials.new("Chalk")
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*GRAIN_COLOR, 1)
    b.inputs["Roughness"].default_value = 0.95
    return m


def cache_complete():
    """True when the cache already holds every data frame (and noise frame, if noise is on)."""
    def full(sub):
        d = os.path.join(CACHE, sub)
        return os.path.isdir(d) and len([f for f in os.listdir(d) if f.endswith((".vdb", ".uni"))]) >= FRAMES
    return full("data") and (DUST_NOISE == 0 or full("noise"))


def bake_dust(dom):
    ds = dom.modifiers["Fluid"].domain_settings
    if KEEP_CACHE and cache_complete():
        # trust the cache on disk: the modular cache reads whatever frames are there
        print("dust: reusing the cache in", CACHE)
        return
    shutil.rmtree(CACHE, ignore_errors=True)
    os.makedirs(CACHE, exist_ok=True)
    bpy.context.view_layer.objects.active = dom
    with bpy.context.temp_override(active_object=dom, object=dom):
        bpy.ops.fluid.bake_all()
    if DUST_NOISE > 0:
        assert ds.has_cache_baked_noise, "noise bake did not take"
        big = os.path.getsize(os.path.join(CACHE, "noise", f"fluid_noise_{round(T_I * FPS) + 3:04d}.vdb"))
        assert big > 20000, f"noise cache looks empty ({big} bytes at the slap)"
    assert cache_complete(), f"dust cache incomplete in {CACHE}"
    print("dust baked to", CACHE)


DUST_DENSITY = float(opt("--dust-density", 5.0))
DUST_GLOW = float(opt("--dust-glow", 0.35))
DUST_SOURCE = opt("--dust-source", "slap")              # slap: the plate blows dust off the floor; ring: a wall emitter at the rim
DUST_FLOOR_R = float(opt("--dust-floor-r", PLATE_R - 0.5))   # the dust layer's radius: under the plate, hidden until the slap
DUST_FLOOR = float(opt("--dust-floor", 0.7))            # how much dust lies there (the texture halves it on average)
DUST_SLAP = float(opt("--dust-slap", 0.6))              # effector velocity factor
DUST_SINK = float(opt("--dust-sink", 0.4))              # negative density buoyancy
DUST_SPEED = float(opt("--dust-speed", 75.0))
DUST_SPEED_RANDOM = float(opt("--dust-speed-random", 0.7))
DUST_RES = int(opt("--dust-res", 272))                  # on the box's long side: 60 in / 272 = 0.22 in voxels
DUST_NOISE = int(opt("--dust-noise", 2))                # wavelet noise upres factor, 0 turns it off
DUST_NOISE_STRENGTH = float(opt("--dust-noise-strength", 0.7))
DUST_NOISE_SIZE = float(opt("--dust-noise-size", 2.0))
DUST_STEPS = int(opt("--dust-steps", 10))
DUST_VORTICITY = float(opt("--dust-vorticity", 0.15))
DUST_SETTLE = tuple(int(v) for v in opt("--dust-settle", "68-84").split("-"))   # shader fade-out frames
DUST_LIFE = int(opt("--dust-life", 9))                  # log dissolve: density falls by 1/this per frame
DUST_WALL = float(opt("--dust-wall", 0.45))             # flow surface distance: how thick the emitting wall is
DUST_CLIP = float(opt("--dust-clip", 0.005))            # density below this is not rendered at all
DUST_TEX_SIZE = float(opt("--dust-tex-size", 2.5))
KEEP_CACHE = "--keep-cache" in args                     # reuse a complete cache instead of rebaking
DOMAIN = (30.0, 30.0, 8.0)                 # half-extents of the smoke box, centred on the plate: the slap throws dust ~25 in
DUST_FADE = tuple(float(v) for v in opt("--dust-fade", "20-28").split("-"))   # radial shader falloff, inches: full, gone
GRAINS = int(opt("--grains", 4500))
GRAIN_R = float(opt("--grain-r", 0.055))
GRAIN_LIFE = int(opt("--grain-life", 40))
GRAIN_DRAG = float(opt("--grain-drag", 0.8))
GRAIN_COLOR = (0.55, 0.48, 0.40)
if not NO_DUST:
    bake_dust(build_dust())
    volume_object()


# ---------------------------------------------------------------------------
# where things land in the frame, for the page
def px(p):
    v = world_to_camera_view(sc, cam, Vector(p))
    return [round(v.x, 4), round(1 - v.y, 4)]


sc.frame_set(FRAMES - 1)
q = bpy.data.objects.get("Q")
q_up = (q.matrix_world.to_3x3() @ Vector((0, 1, 0))).normalized()
a, b = px((0, 0, 0)), px(tuple(q_up * 5))
assert abs(b[0] - a[0]) < 0.004 and b[1] < a[1], f"the Q is not upright on screen: {a} -> {b}"
meta = {
    "fps": FPS, "frames": FRAMES, "size": [W, H],
    "impact_frame": round(T_I * FPS), "slap_frame": round(T_A * FPS), "settle_frame": round(T_S * FPS),
    "impact_s": T_I, "settle_s": T_S,
    "plate": {
        "centre": px((0, 0, 0)),
        "top": px((0, PLATE_R, 0)), "bottom": px((0, -PLATE_R, PLATE_T)),
        "left": px((-PLATE_R, 0, PLATE_T / 2)), "right": px((PLATE_R, 0, PLATE_T / 2)),
    },
}
os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, "intro.json"), "w") as fh:
    json.dump(meta, fh, indent=1)
print("settle at", meta["plate"])


# ---------------------------------------------------------------------------
# render
def render_frames(folder, lo, hi):
    os.makedirs(folder, exist_ok=True)
    sc.render.use_overwrite = False
    sc.render.use_placeholder = True
    sc.render.filepath = os.path.join(folder, "f_")
    sc.frame_start, sc.frame_end = lo, hi
    bpy.ops.render.render(animation=True)


def render_stills(frames):
    at = -1
    for n in sorted(frames):
        for f in range(at + 1, n + 1):                     # step so particles simulate in order
            sc.frame_set(f)
        at = n
        sc.render.filepath = os.path.join(OUT, f"still_{n:04d}.png")
        bpy.ops.render.render(write_still=True)


def previs_outputs(folder):
    """previs.mp4 (light and dark page side by side) and contact.png (the beats, with the wordmark's slot boxed)."""
    pw, ph = W // 2, H // 2
    run = lambda cmd: subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    src = os.path.join(folder, "f_%04d.png")
    run(["ffmpeg", "-y", "-framerate", str(FPS), "-i", src, "-f", "lavfi", "-i", f"color=c=0xf5f5f7:s={pw}x{ph}:r={FPS}",
         "-f", "lavfi", "-i", f"color=c=0x0b1020:s={pw}x{ph}:r={FPS}", "-filter_complex",
         "[0:v]split[a][b];[1:v][a]overlay=shortest=1[l];[2:v][b]overlay=shortest=1[d];[l][d]hstack,format=yuv420p",
         "-c:v", "libx264", "-crf", "20", "-movflags", "+faststart", os.path.join(OUT, "previs.mp4")])
    beats = [("drop", 20), ("impact", round(T_I * FPS)), ("slap", round(T_A * FPS) + 1), ("hop", round((T_A + T_B) * FPS / 2)),
             ("wobble", 46), ("wobble late", 58), ("settled", round(T_S * FPS)), ("end + name", FRAMES - 1)]
    top = meta["plate"]["top"][1]
    box_h, gap = 0.2, 0.035
    bx, by = int(pw * 0.26), int(ph * (top - gap - box_h))
    font = os.path.join(HERE, "Montserrat-Bold.ttf")
    cmd = ["ffmpeg", "-y"]
    for _, f in beats:
        cmd += ["-i", os.path.join(folder, f"f_{f:04d}.png")]
    cmd += ["-f", "lavfi", "-i", f"color=c=0xf5f5f7:s={pw}x{ph}"]
    n = len(beats)
    parts = [f"[{n}:v]split={n}" + "".join(f"[b{i}]" for i in range(n))]
    for i, (label, f) in enumerate(beats):
        box = f",drawbox=x={bx}:y={by}:w={int(pw * 0.48)}:h={int(ph * box_h)}:color=0xc2410c@0.9:t=2" if i == n - 1 else ""
        parts.append(f"[b{i}][{i}:v]overlay=format=auto:shortest=1{box},"
                     f"drawtext=fontfile={font}:text='{f}  {label}':x=10:y=10:fontsize=18:fontcolor=0x0f152a[v{i}]")
    parts.append("".join(f"[v{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=0,tile=4x2")
    cmd += ["-filter_complex", ";".join(parts), "-frames:v", "1", os.path.join(OUT, "contact.png")]
    run(cmd)
    print("wrote", os.path.join(OUT, "previs.mp4"), "and contact.png")


if STILLS is not None:
    render_stills(STILLS)
elif PREVIS or SHEET_ONLY:
    folder = os.path.join(OUT, "previs")
    if not SHEET_ONLY:
        shutil.rmtree(folder, ignore_errors=True)
        render_frames(folder, *(FRAME_RANGE or (0, FRAMES - 1)))
    previs_outputs(folder)
else:
    render_frames(os.path.join(OUT, "frames"), *(FRAME_RANGE or (0, FRAMES - 1)))
