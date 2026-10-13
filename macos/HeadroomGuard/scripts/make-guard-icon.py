#!/usr/bin/env python3
"""Draws the Headroom Guard app icon (shield with a pulse line) and writes Resources/AppIcon.icns.
Requires Pillow: python3 -m pip install pillow"""
import os
from PIL import Image, ImageDraw, ImageFilter

S = 1024
here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, "..", "Resources", "AppIcon.icns")


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

# macOS-style rounded square with a vertical navy gradient.
pad, radius = 100, 185
grad = Image.new("RGBA", (S, S))
gd = ImageDraw.Draw(grad)
for y in range(S):
    gd.line([(0, y), (S, y)], fill=lerp((28, 38, 66), (10, 14, 28), y / S) + (255,))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([pad, pad, S - pad, S - pad], radius, fill=255)
shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle([pad, pad + 14, S - pad, S - pad + 14], radius, fill=(0, 0, 0, 110))
img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(18)))
img.paste(grad, (0, 0), mask)

# Shield.
cx, top, bottom, half = S // 2, 250, 800, 230
shield = [(cx, top), (cx + half, top + 70), (cx + half, 500), (cx + half - 40, 620), (cx, bottom),
          (cx - half + 40, 620), (cx - half, 500), (cx - half, top + 70)]
glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(glow).polygon(shield, fill=(239, 68, 68, 150))
img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(28)))
d = ImageDraw.Draw(img)
d.polygon(shield, fill=(239, 68, 68, 255))
inner = [(x + (cx - x) * 0.12, y + (560 - y) * 0.12) for x, y in shield]
d.polygon(inner, fill=(185, 28, 28, 255))

# Pulse line across the shield: data leaving.
pulse = [(cx - 170, 520), (cx - 70, 520), (cx - 30, 420), (cx + 20, 610), (cx + 60, 480), (cx + 90, 520), (cx + 170, 520)]
d.line(pulse, fill=(255, 255, 255, 255), width=34, joint="curve")
for p in (pulse[0], pulse[-1]):
    d.ellipse([p[0] - 17, p[1] - 17, p[0] + 17, p[1] + 17], fill=(255, 255, 255, 255))

img.save(out, sizes=[(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)])
img.resize((256, 256), Image.LANCZOS).save(os.path.join(here, "..", "Resources", "AppIcon-preview.png"))
print("wrote", os.path.normpath(out))
