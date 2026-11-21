#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["numpy", "pillow"]
# ///
"""Bake the stationary background of the lifting flow (DECISIONS S49) from Today's film, in the manner of Nothing OS's Atmosphere effect.

usage: apps/android/scripts/bake-flow-backdrop.py            (needs uv and ffmpeg; uv fetches numpy and pillow)
           writes res/drawable-nodpi/flow_wash.webp and flow_mid.webp from the 16 s frame of res/raw/today_film.mp4
       apps/android/scripts/bake-flow-backdrop.py <frame.jpg> <out.webp> [blur] [dim] [grain] [sat]
           one image, by hand

The film is already graded, so its Super 8 warmth carries over.
  flow_wash.webp  blur 90, dim .66, no grain: the finished wash behind Warm-up, Workout and Rest. Broad colour, no shapes.
  flow_mid.webp   blur 40, dim .8: the middle of Today's hand-over, which the shell fades in over the sharp film before it swaps screens.
Output is 780x1688 (390x844 dp at 2x). blur is a Gaussian sigma in output pixels: 0 keeps the frame sharp. Grain is not baked: the app draws it
at run time with the tile Today's film already builds, so each image stays small. Run this again after swapping the footage with grade-today-film.sh.
"""
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

W, H = 780, 1688
RES = Path(__file__).resolve().parent.parent / "app/src/main/res"


def bake(src, out, blur=90.0, dim=0.66, grain=0.0, sat=1.3):
    im = Image.open(src).convert("RGB")
    s = max(W / im.width, H / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    l, t = (im.width - W) // 2, (im.height - H) // 2
    im = im.crop((l, t, l + W, t + H))
    if blur > 0:
        # Blur on a reflected canvas so the edges do not fade to black.
        pad = int(blur * 2)
        big = Image.fromarray(np.pad(np.asarray(im), ((pad, pad), (pad, pad), (0, 0)), mode="reflect"))
        big = big.filter(ImageFilter.GaussianBlur(blur))
        im = big.crop((pad, pad, pad + W, pad + H))
        im = ImageEnhance.Color(im).enhance(sat)
    a = np.asarray(im).astype(np.float32) / 255
    # The grade is nearly neutral once blurred, so lean the wash toward the warm end, the way Atmosphere leans into the picture's own colour.
    b = min(blur / 90.0, 1.0)
    a = a * np.array([1 + 0.14 * b, 1 + 0.01 * b, 1 - 0.16 * b], dtype=np.float32)
    # Dim for white text, then a vignette and a warm lift, scaled by how far this is from the sharp frame (dim 1 leaves a sharp frame alone).
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    r = np.sqrt(((xx - W / 2) / (W * 0.75)) ** 2 + ((yy - H * 0.42) / (H * 0.7)) ** 2)
    k = (1 - dim) / 0.34
    lift = np.array([0.045, 0.028, 0.015], dtype=np.float32) * k
    a = (a * dim + lift) * (1 - 0.35 * k * np.clip(r, 0, 1) ** 2)[:, :, None]
    if grain > 0:
        a = a + np.random.default_rng(7).normal(0, grain, a.shape).astype(np.float32)
    Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).save(out, quality=82, method=6)
    print(out, Path(out).stat().st_size, "bytes")


if len(sys.argv) > 2:
    a = sys.argv
    bake(a[1], a[2], *(float(x) for x in a[3:7]))
else:
    with tempfile.TemporaryDirectory() as tmp:
        frame = Path(tmp) / "frame.png"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "16", "-i", str(RES / "raw/today_film.mp4"), "-frames:v", "1", str(frame)], check=True)
        bake(frame, RES / "drawable-nodpi/flow_wash.webp", blur=90, dim=0.66)
        bake(frame, RES / "drawable-nodpi/flow_mid.webp", blur=40, dim=0.8)
