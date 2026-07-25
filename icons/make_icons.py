#!/usr/bin/env python3
"""Generate PWA / home-screen icons for SquirrelSplit.
Renders the squirrel emoji on an Alpha Gamma Delta red->green rounded tile.
Falls back to a drawn acorn monogram if the emoji font can't be rasterized.
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
RED = (163, 25, 46)       # AGD red
BUFF = (243, 233, 208)    # AGD buff / cream
GREEN = (46, 125, 81)     # AGD green

EMOJI_FONT = "/System/Library/Fonts/Apple Color Emoji.ttc"
# Apple Color Emoji only rasterizes at fixed strike sizes; 160 is valid on macOS.
STRIKE = 160


def rounded_bg(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = int(size * 0.22)
    # vertical AGD red -> green gradient
    top = Image.new("RGBA", (1, size))
    for y in range(size):
        t = y / max(1, size - 1)
        r = int(RED[0] + (GREEN[0] - RED[0]) * t)
        g = int(RED[1] + (GREEN[1] - RED[1]) * t)
        b = int(RED[2] + (GREEN[2] - RED[2]) * t)
        top.putpixel((0, y), (r, g, b, 255))
    grad = top.resize((size, size))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size, size], radius=radius, fill=255)
    img.paste(grad, (0, 0), mask)
    # buff inner ring
    inset = int(size * 0.10)
    d.rounded_rectangle(
        [inset, inset, size - inset, size - inset],
        radius=int(radius * 0.7), outline=BUFF, width=max(2, size // 48),
    )
    return img


def draw_acorn(img):
    """Fallback mark: a simple buff acorn."""
    size = img.size[0]
    d = ImageDraw.Draw(img)
    cx = size // 2
    # nut body
    d.ellipse([cx - size * 0.20, size * 0.42, cx + size * 0.20, size * 0.80], fill=BUFF)
    # cap
    d.rounded_rectangle(
        [cx - size * 0.24, size * 0.34, cx + size * 0.24, size * 0.50],
        radius=int(size * 0.06), fill=(120, 72, 40),
    )
    # stem
    d.rectangle([cx - size * 0.02, size * 0.26, cx + size * 0.02, size * 0.36], fill=(120, 72, 40))


def render(size):
    img = rounded_bg(size)
    placed = False
    try:
        font = ImageFont.truetype(EMOJI_FONT, STRIKE)
        em = Image.new("RGBA", (STRIKE * 2, STRIKE * 2), (0, 0, 0, 0))
        ImageDraw.Draw(em).text((STRIKE, STRIKE), "\U0001F43F",
                                font=font, embedded_color=True, anchor="mm")
        bbox = em.getbbox()
        if bbox:
            em = em.crop(bbox)
            target = int(size * 0.60)
            ratio = target / max(em.size)
            em = em.resize((int(em.size[0] * ratio), int(em.size[1] * ratio)))
            img.alpha_composite(em, ((size - em.size[0]) // 2, (size - em.size[1]) // 2))
            placed = True
    except Exception as e:  # noqa
        print("emoji render failed:", e)
    if not placed:
        draw_acorn(img)
    return img


for s in (192, 512):
    render(s).save(os.path.join(HERE, f"icon-{s}.png"))
# iOS home-screen icon (no transparency; iOS ignores alpha and adds its own mask)
apple = render(180).convert("RGB")
apple.save(os.path.join(HERE, "apple-touch-icon.png"))
print("icons written:", os.listdir(HERE))
