"""Bake the stationary background for the lifting flow from a graded film frame, in the manner of Nothing OS's Atmosphere effect.

usage: uv run --with numpy --with pillow python bake_rail_bg.py <frame.jpg> <out.jpg> [blur=90] [dim=0.66] [grain=0.018] [sat=1.3] [ribs=0]

Output is 780x1688 (390x844 dp at 2x). blur is a Gaussian sigma in output pixels: 0 keeps the frame sharp (the Today look), about 40 is the
middle of the transition, 90 and up is the finished wash (broad colour, no shapes, fine grain). ribs > 0 adds fluted glass (rejected, kept off).
The frame comes from the already graded today_film.mp4, so the Super 8 warmth carries over.
"""
import sys
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

a_ = sys.argv
src, out = a_[1], a_[2]
blur = float(a_[3]) if len(a_) > 3 else 90.0
dim = float(a_[4]) if len(a_) > 4 else 0.66
grain = float(a_[5]) if len(a_) > 5 else 0.018
sat = float(a_[6]) if len(a_) > 6 else 1.3
ribs = float(a_[7]) if len(a_) > 7 else 0.0
W, H = 780, 1688

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
# The grade is nearly neutral once blurred, so lean the wash toward the warm end the way Atmosphere leans into the picture's own colour.
b = min(blur / 90.0, 1.0)
a = a * np.array([1 + 0.14 * b, 1 + 0.01 * b, 1 - 0.16 * b], dtype=np.float32)

if ribs > 0:
    rib = 60
    x = np.arange(W, dtype=np.float32)
    idx = np.floor(x / rib)
    u = (x - idx * rib) / rib
    sx = np.clip((idx + 0.5) * rib + (u - 0.5) * rib * (1 + 1.4 * ribs), 0, W - 1)
    x0 = np.floor(sx).astype(int)
    x1 = np.minimum(x0 + 1, W - 1)
    f = (sx - x0)[None, :, None]
    a = a[:, x0, :] * (1 - f) + a[:, x1, :] * f
    body = np.clip(np.cos((u - 0.5) * np.pi), 0, 1) ** 0.7
    a = a * (1 - ribs * 0.20 * (1 - body))[None, :, None] + (ribs * 0.075 * np.exp(-(((u - 0.2) / 0.06) ** 2)))[None, :, None]

# Dim for white text, then a vignette and a warm lift, scaled by how far this is from the sharp frame (dim 1 leaves a sharp frame alone).
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
r = np.sqrt(((xx - W / 2) / (W * 0.75)) ** 2 + ((yy - H * 0.42) / (H * 0.7)) ** 2)
k = (1 - dim) / 0.34
lift = np.array([0.045, 0.028, 0.015], dtype=np.float32) * k
a = (a * dim + lift) * (1 - 0.35 * k * np.clip(r, 0, 1) ** 2)[:, :, None]
if grain > 0:
    a = a + np.random.default_rng(7).normal(0, grain, a.shape).astype(np.float32)
Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).save(out, quality=90)
print(out)
