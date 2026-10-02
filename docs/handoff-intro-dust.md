# Handoff: make the intro's impact dust look real

Qala's landing page opens with a Blender-rendered video: the red Qk bumper plate drops spinning, slaps flat, hops once, wobbles like an Euler's disk and settles with the Q upright. Dust kicks up at the impact. The plate, camera and timing are in good shape. The dust is not. The grains are far too big and the smoke reads as lumpy blobs instead of fine powder. Your job is the dust only.

Look at `docs/handoff-intro-dust/current-light-dark.mp4` (the whole clip, light page left, dark page right) and `docs/handoff-intro-dust/current-dust-1to1.png` (1:1 crops of frames 31, 34, 40 and 50 on both pages) before reading further.

## Outcome (2026-10-02)

Done, with a different source than the plan below. The dust is now driven by the slap itself: a solid proxy of the
plate follows the rig as a Mantaflow collision effector, and a thin layer of dust is laid on the floor under the
plate at the contact frame, so the air squeezed out from under the plate blows it. That gives the fast thin sheet,
the uneven front and the asymmetry (the back edge lands last, so the puff is strongest there) for free; the faster
ring emitter gave a scalloped halo instead. Review sheets are in `/tmp/qala-intro/review/` (light page left, dark
page right); `new-*` in this folder are the shipped pass.

What changed in `build_intro.py`:

- Box 60 x 60 x 16 in centred on the plate, base grid 272 (0.22 in voxel), wavelet noise upres 2 at strength 0.7,
  cubic volume interpolation, log dissolve (speed 9), a little negative buoyancy so dust sinks instead of pluming.
  The first pass used a 44 in box and the slap threw dust into its walls: on the dark page the cloud showed as a
  rectangle with straight sides from frame 55 on. Two guards now: the wider box, and a radial falloff in the
  shader (`--dust-fade`, full at 20 in, gone at 28 in) so the cloud's edge can never be the box's edge.
- A shader-side settle (`--dust-settle`, density ramps to zero over frames 68 to 84) clears the last thin haze so
  the poster frame and the wordmark's slot are clean, without a faster dissolve thinning the cloud in its prime.
- The cache is rendered as a Volume object reading the `density_noise` grid of the VDB files, not through the
  domain. That is what made `--keep-cache` work and stills take 5 s.
- Grains: 4500 at radius 0.055 in, darker and warmer, more drag, shorter life.
- Default `--dust-source slap`; `ring` keeps the old wall emitter for comparison.

Blender facts that cost most of the day, kept here because they are not in any manual:

- Setting most domain properties runs an update that deletes the cache on disk for the directory set at that
  moment. `cache_directory` must be set last or each fresh process wipes the previous bake.
- Headless `bake_noise()` with the Modular cache writes empty noise files (3 KB each). `cache_type = "ALL"` plus
  `bake_all()` writes real ones. A fresh process reads the data cache from disk but never the noise cache, hence
  the Volume object.
- oneAPI hardware ray tracing stalls 20+ minutes building its acceleration structure over the dust volume (one
  Embree thread, 27 waiting). Embree on the GPU renders the same pixels in about 5 s a frame; `--hwrt` turns the
  hardware path back on if a future driver fixes it.
- Low-resolution bakes do not predict res 200: the squeeze under the plate gets far more energetic on a finer grid.
  Bake at 200 (about 12 to 16 minutes) before judging anything.

A res-272 cache is about 3 GB and `/tmp` is a 31 GB tmpfs that fills with old passes: clear superseded caches before a
bake. The shipped bake hit the quota writing frame 85; frames 0 to 84 are intact and 85 to 95 were replaced with
copies of frame 0's empty grids, which is what they render as anyway because the settle fade is zero from 84.

Checked against "Done means" on the shipped frames: at 1:1 on frames 31, 40 and 50 the dust is soft wisps and
specks with no voxel steps, columns or box edges (alpha ramps over 40 to 80 px at the cloud's sides at frames 55 to
75), the first half second is a thin sheet along the floor, the cloud is a faint trace at 78 and gone by 84 on both
pages (no extra alpha outside the plate against the poster frame), nothing lies on the floor before contact (a
small patch under the plate's edge shows at frame 27 only), the plate is unchanged against the previous render at
frame 95 (mean difference 0.37/255, rim-edge sampling noise only) and `intro.json` is byte-identical. Camera,
lights and timing untouched. Shipped sizes at CRF 18/30: dark H.264 864 KB, light 824 KB, AV1 299 KB and 124 KB, lossless posters 110 KB and 154 KB (loaded only under reduced motion or a refused autoplay).
Still unverified, as flagged below: that two bakes of the same scene come out identical. The cache behind the
shipped frames is `/tmp/qala-intro/cache-final2`; a fresh bake may differ in the fine detail.

## Where everything is

All of it is in `assets/3d/` and uncommitted. `build_intro.py` is the scene: it opens `/tmp/qala-intro/qk.blend` (the plate, saved by `build_sprites.py --icon --only icon_qk_both --samples 1 --size 128 --out /tmp/qala-intro/sprites --save-blend /tmp/qala-intro/qk.blend`; regenerate it if /tmp was cleared), keys the plate procedurally, then builds the dust in `build_dust()` (line ~342), `volume_material()` (~321) and `bake_dust()` (~437). `encode_intro.sh` turns the rendered PNG frames into the shipped H.264, AV1 and WebP files in `apps/web/src/shared/intro/`.

The dust today is two things. A Mantaflow gas domain with a thin ring-shaped flow object just outside the plate's rim, blowing outward, fired at the slap (frame 27) and weakly again at the second landing (frame 37). And a legacy particle system of 320 grains instanced from an icosphere, thrown outward and up from the same ring.

Run it like this. Add `--previs-quality` for a half-res 24 spp frame, and leave it off to judge detail, because 1:1 judgement needs the real 1080x720.

    blender -b -P assets/3d/build_intro.py -- --still 31,40,50          # stills to /tmp/qala-intro/out/still_NNNN.png
    blender -b -P assets/3d/build_intro.py                              # all 96 frames to /tmp/qala-intro/out/frames/
    assets/3d/encode_intro.sh /tmp/qala-intro/out/frames                # writes the web files

Every run re-bakes the smoke first (about 55 s at resolution 144), then a still takes 7 to 14 s. The full 96 frames took about 20 minutes. Dust parameters are CLI flags (`--dust-density`, `--dust-speed`, `--dust-res`, `--dust-vorticity`, `--dust-life`, `--dust-glow`) so you can iterate without editing.

## What's wrong, with numbers

Scale first: one Blender unit is one inch, and the frame shows about 46 inches across 1080 px, so roughly 23 px per inch at the plate.

The grains are `GRAIN_R = 0.2` (line 453), a 0.4 inch icosphere, which is a 9 to 10 px pellet. At 320 of them, bright against the dark page, they read as confetti. Real chalk or floor dust at this distance is sub-pixel to two pixels.

The smoke domain is 68 x 56 x 26 inches at `resolution_max` 144 with noise off (`ds.use_noise = False`), so a voxel is 68/144, about 0.47 inch, or 11 px. That is the lumpy scalloping around the ring and the vertical "columns" on the far side in frames 40 to 66. Nothing in the picture is smaller than a voxel because no noise upres is applied and the volume is sampled with the default linear interpolation.

The motion is also too uniform. The ring is a smooth wall emitting evenly, so the cloud is an even halo hugging the plate instead of a fast thin sheet along the floor with a rolled, curling leading edge that thins out and lifts.

## What others do

I found no open Blender script that builds exactly this, and most of the good material is paid courses, so the evidence is technique docs and course descriptions, not code to copy.

Blender's gas noise is Wavelet Turbulence ([Kim et al. 2008](http://www.cs.cornell.edu/~tedkim/WTURB/)). The [5.0 manual's Noise page](https://docs.blender.org/manual/en/5.0/physics/fluid/type/domain/gas/noise.html) says it adds finer detail on top of the base solve without changing the overall motion, that Upres Factor and Resolution Divisions are not interchangeable, and that a low base resolution with a high upres gives pyroclastic-looking detail. Its Bake Noise step only exists with the Modular cache type, which this script does not use (it uses `"ALL"`).

The [Material Settings page](https://docs.blender.org/manual/en/latest/render/cycles/material_settings.html) describes the volume Interpolation option: Linear for thin volumes, Cubic for smoother, higher-quality sampling at a cost. Our script never sets it. The Blender tracker threads on blocky Mantaflow volumes in Cycles ([T101484](https://developer.blender.org/T101484), [T75276](https://developer.blender.org/T75276)) point the same way: cubic interpolation, a lower density multiplier (a high one exposes voxels), higher base resolution. I only read search summaries of those two.

[Miika's note on removing smoke blockiness](https://miikahweb.com/en/blog/2013/05/10/getting-rid-of-smoke-blockiness) is about the old smoke solver's "Full Sample" option, so only its lesson transfers: detail has to come from the source and the high-res pass, not from shader tricks. The [Volume Displace modifier](https://www.blendernation.com/2020/10/14/new-volume-displace-modifier/) is a second route to fine detail, noise-displacing a VDB, but it works on Volume objects, so it means exporting the cache as OpenVDB and loading it back.

For the look itself, the Houdini reference is [fxphd's Impact-Based Dust Volumetrics](https://blog.fxphd.com/details/600/) (description only, it is a paid course): source the emission from the impact, then add curl-noise turbulence and small micro-solver passes for detail, and keep the simulation resolution modest. The one Blender thread on this exact effect, [a dust wave after an impact](https://blenderartists.org/t/not-able-to-create-dust-wave-from-blender-mantaflow/1463608), recommends a donut-shaped emitter, which is what we already have; its other advice is stylised keyframe tricks.

## What I would do, in this order

My opinion is to stay with the volume sim and fix resolution first, because that is where most of the unreal look comes from. The numbers below are starting points I have not tuned.

1. **Shrink the box and raise the resolution.** The dust never travels past roughly 2.2 plate radii (about 20 inches). A domain of about 44 x 44 x 14 inches centred on the plate (`dom.location` is currently offset 6 inches in y, drop that) at resolution 200 gives a 0.22 inch voxel (5 px). Bake time grows roughly with the fourth power of resolution, so expect a few minutes.
2. **Turn on noise.** Switch `ds.cache_type` to `"MODULAR"`, call `bpy.ops.fluid.bake_data()` and then `bpy.ops.fluid.bake_noise()`, set `ds.use_noise = True` with an upres factor of 2 or 3, and tune strength and scale until the finest wisps are 2 to 3 px. Check the property names with the blender MCP's `bpy_api_lookup` before relying on them.
3. **Set the dust material's volume interpolation to cubic** and keep density modest (the script uses 4.0; try 1.5 to 3 once the voxels are smaller). Keep the density-scaled emission glow in `volume_material()`: Principled Volume emission is not multiplied by density, so without that Math node the whole box glows and whites out the plate.
4. **Make the grains tiny and many.** Try radius 0.03 to 0.06 inch (under 1.5 px), 4,000 to 8,000 of them, more size randomness, a warmer and darker material than the near-white it renders as, shorter life and more drag. If they still read as confetti against the dark page, cut the count rather than growing them.
5. **Shape the source.** Modulate the ring's emission with a noise texture on the flow object (FluidFlowSettings has texture options, verify names) so the front breaks up unevenly, keep the wall thin and low so the first second is a fast flat sheet, and let vorticity (now 0.08) or the noise do the curling at the leading edge. A second, weaker and slower puff that lifts is fine.
6. **Check it on both pages.** The render is transparent and gets composited over `#f5f5f7` and `#0b1020`. Dust that looks right on one can vanish or glow on the other.

## Constraints

Leave the plate motion, camera, lights and 96 frames at 30 fps alone unless something forces your hand. The impact is at frame 27, the second landing at 37, the settle at 66. The last frame becomes the poster image, so the dust has to be fully gone well before frame 95 (today a faint trace of the ring is still visible on the dark page at frame 95). The page's "Qala." wordmark sits over the area just above the plate (frame y roughly 0.22 to 0.42 of the height, x 0.26 to 0.74), so late dust should not linger there.

Each MP4 is about 330 KB now and the target is 1 MB or less. Fine noise compresses badly, so if a file bloats, lower the quality (`CRF_H264`, `CRF_AV1` in the encode script) before blurring the dust.

Rendering uses both Arc GPUs through oneAPI with hardware ray tracing (`--device gpu`, the default). That needed `intel-level-zero-gpu-raytracing`, which is now installed, and is described in the "Blender on Arc" section of `~/.claude/CLAUDE.md`. The B60 also serves Beamer's `llama-beamer.service`, so use `--device b570` if you want to stay off it, and read the wedge playbook in that file if a card drops out. Don't use `sleep` chains to wait on the render; run it in the background.

I have not checked that two bakes of the same scene come out identical. A render killed and resumed re-bakes, so render in one go.

## Done means

At 1:1 on frames 31, 40 and 50, on both pages, nothing in the dust is bigger than about 3 px, no voxel stair-stepping or vertical columns are visible, the grains are specks and not pellets, the first half second reads as a thin fast sheet along the floor, the cloud is fully gone by frame 85, and the plate looks exactly as it does now.

Out of scope: the page component, `LandingPage`, CSS, Playwright checks and the DECISIONS and DESIGN rows. Those come after the dust is signed off. (Done the same day: `shared/intro/IntroHero.tsx` on the landing page, U26 and DESIGN 7.17.)
