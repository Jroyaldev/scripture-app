#!/usr/bin/env python3
"""Process Pericope brand assets from ~/Desktop/Pericope Assets into site/assets/brand.

The source renders sit on a textured off-white (~249) background, so every
step measures the background level per image instead of assuming 255.

Outputs (all trimmed to content, PNG):
  brand-icon.png        primary icon, white bg (archival)
  brand-lockup.png      horizontal lockup, white bg (archival)
  brand-app-icon.png    app icon squircle, white bg (archival)
  brand-mono.png        monochrome mark, white bg (archival)
  mark.png              black mark on transparency (light backgrounds)
  mark-white.png        white mark on transparency (dark backgrounds)
  lockup.png            full lockup (black + gold) on transparency
  app-icon.png          squircle with transparent corners (favicon, tiles)
  favicon-32.png        32x32 favicon
  apple-touch-icon.png  180x180 squircle, opaque
"""
import os
import numpy as np
from PIL import Image

SRC = os.path.expanduser("~/Desktop/Pericope Assets")
OUT = "assets/brand"
os.makedirs(OUT, exist_ok=True)

ICON = os.path.join(SRC, "ChatGPT Image Jul 18, 2026, 06_13_49 PM (1).png")
LOCKUP = os.path.join(SRC, "ChatGPT Image Jul 18, 2026, 06_13_49 PM (2).png")
APP = os.path.join(SRC, "ChatGPT Image Jul 18, 2026, 06_13_49 PM (3).png")
MONO = os.path.join(SRC, "ChatGPT Image Jul 18, 2026, 06_13_49 PM (4).png")


def load(p):
    return np.asarray(Image.open(p).convert("RGB"), dtype=np.float32)


def bg_level(arr):
    """Median per-channel value of the outer border ring."""
    ring = np.concatenate([
        arr[:20].reshape(-1, 3), arr[-20:].reshape(-1, 3),
        arr[:, :20].reshape(-1, 3), arr[:, -20:].reshape(-1, 3),
    ])
    return np.median(ring, axis=0)  # ~249


def content_bbox(arr, bg, delta=28):
    """Bounding box of pixels clearly darker than the background."""
    mask = np.any(arr < (bg - delta), axis=-1)
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return None
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def crop(arr, bbox, pad=0):
    x0, y0, x1, y1 = bbox
    x0 = max(0, x0 - pad); y0 = max(0, y0 - pad)
    x1 = min(arr.shape[1], x1 + pad); y1 = min(arr.shape[0], y1 + pad)
    return arr[y0:y1, x0:x1]


def unblend(arr, bg):
    """Treat each pixel as foreground composited over the measured background.

    coverage a = (bg - min_channel) / bg, then recover fg. Background pixels
    land at a=0 (fully transparent); black and saturated gold stay opaque.
    """
    bg_s = float(bg.mean())
    mn = arr.min(axis=-1)
    a = np.clip((bg_s - mn) / 255.0, 0, 1)
    # Anything within noise of the background is fully transparent.
    a[(bg_s - mn) < 14] = 0
    a_safe = np.clip(a, 1e-4, 1.0)[..., None]
    fg = np.clip((arr - (1.0 - a_safe) * bg) / a_safe, 0, 255)
    return fg, (a * 255.0).astype(np.uint8)


def to_rgba(fg, alpha):
    out = np.zeros((*alpha.shape, 4), dtype=np.uint8)
    out[..., :3] = fg.astype(np.uint8)
    out[..., 3] = alpha
    return Image.fromarray(out, "RGBA")


def save(img, name):
    path = os.path.join(OUT, name)
    img.save(path, optimize=True)
    print(f"  {name:24s} {img.size[0]}x{img.size[1]}")


for src, name in [(ICON, "brand-icon.png"), (LOCKUP, "brand-lockup.png"),
                  (APP, "brand-app-icon.png"), (MONO, "brand-mono.png")]:
    arr = load(src)
    bg = bg_level(arr)
    bbox = content_bbox(arr, bg)
    img = Image.fromarray(crop(arr, bbox).astype(np.uint8), "RGB")
    save(img, name)

mono = load(MONO)
bg = bg_level(mono)
fg, alpha = unblend(crop(mono, content_bbox(mono, bg)), bg)
save(to_rgba(fg, alpha), "mark.png")
save(to_rgba(np.full_like(fg, 250), alpha), "mark-white.png")

lk = load(LOCKUP)
bg = bg_level(lk)
fg, alpha = unblend(crop(lk, content_bbox(lk, bg)), bg)
save(to_rgba(fg, alpha), "lockup.png")

app = load(APP)
bg = bg_level(app)
app_c = crop(app, content_bbox(app, bg))
# Exterior = near-background pixels connected to the border (iterative flood).
near_bg = np.all(app_c > (bg - 14), axis=-1)
exterior = np.zeros(near_bg.shape, dtype=bool)
exterior[0, :] = near_bg[0, :]; exterior[-1, :] = near_bg[-1, :]
exterior[:, 0] = near_bg[:, 0]; exterior[:, -1] = near_bg[:, -1]
while True:
    grown = exterior.copy()
    grown[1:, :] |= exterior[:-1, :]
    grown[:-1, :] |= exterior[1:, :]
    grown[:, 1:] |= exterior[:, :-1]
    grown[:, :-1] |= exterior[:, 1:]
    grown &= near_bg
    if grown.sum() == exterior.sum():
        break
    exterior = grown
alpha = np.where(exterior, 0, 255).astype(np.uint8)
# Feather: near-bg pixels not reached by the flood get partial alpha.
edge = near_bg & ~exterior
cov = np.clip((bg[0] - app_c.min(axis=-1)) * 6.0, 0, 255)
alpha[edge] = cov[edge].astype(np.uint8)
app_img = to_rgba(app_c, alpha)
save(app_img, "app-icon.png")

side = max(app_img.size)
sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
sq.paste(app_img, ((side - app_img.size[0]) // 2, (side - app_img.size[1]) // 2), app_img)
save(sq.resize((32, 32), Image.LANCZOS), "favicon-32.png")
opaque = Image.new("RGB", app_img.size, (255, 255, 255))
opaque.paste(app_img, (0, 0), app_img)
save(opaque.resize((180, 180), Image.LANCZOS), "apple-touch-icon.png")
