# -*- coding: utf-8 -*-
"""產生 PWA 圖示：圓角漸層底 + 一個字（GLYPH）。App 改名時改 GLYPH 重跑：python tools/make_icons.py"""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
GLYPH = "分"                          # 追分計劃
os.makedirs(OUT, exist_ok=True)
FONT = "C:/Windows/Fonts/msjhbd.ttc"   # 微軟正黑體 Bold
A = (15, 157, 128)    # accent
B = (10, 120, 98)     # accent-deep


def grad(size):
    im = Image.new("RGB", (size, size))
    d = ImageDraw.Draw(im)
    for y in range(size):
        t = y / max(1, size - 1)
        d.line([(0, y), (size, y)],
               fill=(int(A[0] + (B[0] - A[0]) * t),
                     int(A[1] + (B[1] - A[1]) * t),
                     int(A[2] + (B[2] - A[2]) * t)))
    return im


def glyph(im, size, scale=0.58):
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(FONT, int(size * scale))
    bb = d.textbbox((0, 0), GLYPH, font=f)
    d.text(((size - (bb[2] - bb[0])) / 2 - bb[0],
            (size - (bb[3] - bb[1])) / 2 - bb[1]),
           GLYPH, font=f, fill=(255, 255, 255))
    return im


def rounded(im, size, r_ratio=0.22):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1],
                                           radius=int(size * r_ratio), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)
    return out


for s in (192, 512):
    rounded(glyph(grad(s), s), s).save(os.path.join(OUT, "icon-%d.png" % s))

# maskable：安全區內縮，四角填滿不裁圓角
m = glyph(grad(512), 512, scale=0.42).convert("RGBA")
m.save(os.path.join(OUT, "icon-maskable.png"))

# apple-touch-icon：iOS 自己裁圓角，要方形不透明
glyph(grad(180), 180).convert("RGB").save(os.path.join(OUT, "apple-touch-icon.png"))

print("OK ->", sorted(os.listdir(OUT)))
