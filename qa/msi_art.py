"""Generate WiX MSI installer artwork for SignalTeams.

Produces:
  frontend/src-tauri/msi/dialog.bmp  (493x312) — welcome/finish background
  frontend/src-tauri/msi/banner.bmp  (493x58)  — interior dialog header strip
  qa/msi_preview.png                 — contact sheet for eyeballing

WiX text renders dark over the right ~329px of the dialog and over the
banner's left ~430px, so those zones stay light; the left 164px of the
dialog is pure art space (dark panel + gold knot).
"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KNOT = os.path.join(ROOT, "qa", "icon_render", "dark", "signal-knot.png")
OUT = os.path.join(ROOT, "frontend", "src-tauri", "msi")

# SignalTeams palette — obsidian panel, warm paper right side, honey gold accents
OBSIDIAN_TOP = (18, 20, 27)
OBSIDIAN_BOT = (10, 12, 17)
PAPER = (247, 245, 240)
PAPER_EDGE = (238, 235, 228)
GOLD = (212, 175, 55)
GOLD_SOFT = (232, 201, 106)


def vgrad(size, top, bot):
    """Vertical gradient image."""
    w, h = size
    g = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / max(h - 1, 1)
        g.putpixel((0, y), tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    return g.resize((w, h))


def diag_sheen(img, angle_deg=18, alpha=10):
    """Very subtle diagonal sheen lines — gives paper a premium texture."""
    w, h = img.size
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    step = 34
    rad = math.radians(angle_deg)
    dx, dy = math.cos(rad), math.sin(rad)
    diag = int((w + h) * 1.2)
    for i in range(-h, w + h, step):
        x0, y0 = i, 0
        d.line([x0, y0, x0 + dx * diag, y0 + dy * diag], fill=(255, 255, 255, alpha), width=10)
    return Image.alpha_composite(img.convert("RGBA"), overlay)


def glow(diameter, color, peak=90, falloff=1.8):
    """Radial glow sprite."""
    r = diameter // 2
    im = Image.new("RGBA", (diameter, diameter), (0, 0, 0, 0))
    px = im.load()
    for y in range(diameter):
        for x in range(diameter):
            dist = math.hypot(x - r, y - r) / r
            if dist < 1:
                a = int(peak * max(0.0, 1 - dist) ** falloff)
                px[x, y] = (*color, a)
    return im


def scaled_knot(path, height):
    knot = Image.open(path).convert("RGBA")
    w = int(knot.width * height / knot.height)
    return knot.resize((w, height), Image.LANCZOS)


def panel_shadow(width, height, depth=18):
    """Soft shadow strip to the right of the dark panel divider."""
    sh = Image.new("RGBA", (depth, height), (0, 0, 0, 0))
    px = sh.load()
    for x in range(depth):
        a = int(38 * (1 - x / depth) ** 1.6)
        for y in range(height):
            px[x, y] = (20, 20, 24, a)
    return sh


import random


def grain(size, alpha=6, seed=7):
    """Subtle monochrome noise so flat fills don't read as vector-plastic."""
    rnd = random.Random(seed)
    g = Image.new("RGBA", size, (0, 0, 0, 0))
    px = g.load()
    for y in range(size[1]):
        for x in range(size[0]):
            v = rnd.randint(0, alpha * 2)
            c = 255 if v > alpha else 0
            px[x, y] = (c, c, c, abs(v - alpha))
    return g


def make_dialog(path):
    W, H, PANEL = 493, 312, 164
    img = Image.new("RGBA", (W, H))

    # right side — warm paper with faint sheen
    right = vgrad((W - PANEL, H), PAPER, PAPER_EDGE)
    right = diag_sheen(right, angle_deg=24, alpha=7)
    img.paste(right.convert("RGB"), (PANEL, 0))

    # faint watermark knot bottom-right on the paper
    wm = scaled_knot(KNOT, 150)
    wm_alpha = wm.getchannel("A").point(lambda a: int(a * 0.065))
    wm.putalpha(wm_alpha)
    img.alpha_composite(wm, (W - wm.width - 22, H - wm.height - 18))

    # left art panel — obsidian gradient with a whisper of grain
    panel = vgrad((PANEL, H), OBSIDIAN_TOP, OBSIDIAN_BOT).convert("RGBA")
    panel.alpha_composite(grain((PANEL, H), alpha=7))

    # top vignette for depth
    vig = Image.new("RGBA", (PANEL, 70), (0, 0, 0, 0))
    vpx = vig.load()
    for y in range(70):
        a = int(60 * (1 - y / 70) ** 1.5)
        for x in range(PANEL):
            vpx[x, y] = (0, 0, 0, a)
    panel.alpha_composite(vig, (0, 0))

    # warm gold radial glow behind knot
    g = glow(230, GOLD, peak=105, falloff=2.0)
    panel.alpha_composite(g, ((PANEL - g.width) // 2, 60))

    # the knot, centered in the upper half of the panel
    knot = scaled_knot(KNOT, 128)
    panel.alpha_composite(knot, ((PANEL - knot.width) // 2, 74))

    # serif wordmark + tagline
    d = ImageDraw.Draw(panel)
    wm = ImageFont.truetype("C:/Windows/Fonts/georgia.ttf", 19)
    tag = ImageFont.truetype("C:/Windows/Fonts/georgia.ttf", 10)
    text = "SignalTeams"
    tw = d.textlength(text, font=wm)
    d.text(((PANEL - tw) / 2, 216), text, font=wm, fill=(*GOLD_SOFT, 255))
    tagline = "your crew's agents"
    ttw = d.textlength(tagline, font=tag)
    d.text(((PANEL - ttw) / 2, 240), tagline, font=tag, fill=(*GOLD, 160))

    # tiny gold dot-grid motif along the panel bottom + version tag
    for row in range(3):
        for col in range(8):
            x = 58 + col * 12
            y = 268 + row * 12
            a = 150 - row * 45
            d.ellipse([x, y, x + 2, y + 2], fill=(*GOLD, max(a, 30)))
    vf = ImageFont.truetype("C:/Windows/Fonts/consola.ttf" if os.path.exists(
        "C:/Windows/Fonts/consola.ttf") else "C:/Windows/Fonts/georgia.ttf", 10)
    d.text((14, H - 20), "v1.0.0", font=vf, fill=(*GOLD, 110))

    # hairline gold divider + soft shadow onto the paper, plus a quiet
    # baseline rule on the paper side echoing the banner strip
    d.line([(PANEL - 1, 0), (PANEL - 1, H)], fill=(*GOLD, 140), width=1)
    img.alpha_composite(panel, (0, 0))
    img.alpha_composite(panel_shadow(PANEL, H), (PANEL, 0))
    base = ImageDraw.Draw(img)
    for x in range(PANEL, W):
        t = (x - PANEL) / (W - PANEL)
        base.line([(x, H - 1), (x, H - 1)], fill=(*GOLD, int(90 * (0.4 + 0.6 * t))))

    img.convert("RGB").save(path, "BMP")


def make_banner(path):
    W, H = 493, 58
    img = vgrad((W, H), PAPER, PAPER_EDGE).convert("RGBA")
    img = diag_sheen(img, angle_deg=24, alpha=6)

    # soft knot + glow on the right end (outside the title text zone)
    g = glow(100, GOLD, peak=70, falloff=1.8)
    img.alpha_composite(g, (W - 96, (H - g.height) // 2 + 4))
    knot = scaled_knot(KNOT, 54)
    img.alpha_composite(knot, (W - 84, 2))

    # hairline gold rule along the bottom edge
    d = ImageDraw.Draw(img)
    for x in range(W):
        t = x / W
        a = int(150 * (0.35 + 0.65 * t))
        d.line([(x, H - 1), (x, H - 1)], fill=(*GOLD, a))

    img.convert("RGB").save(path, "BMP")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    dlg = os.path.join(OUT, "dialog.bmp")
    ban = os.path.join(OUT, "banner.bmp")
    make_dialog(dlg)
    make_banner(ban)

    # 2x variants — if WiX stretches to the control, HiDPI renders stay crisp
    Image.open(dlg).resize((986, 624), Image.LANCZOS).save(os.path.join(OUT, "dialog_2x.bmp"), "BMP")
    Image.open(ban).resize((986, 116), Image.LANCZOS).save(os.path.join(OUT, "banner_2x.bmp"), "BMP")

    # contact-sheet preview
    d_im = Image.open(dlg)
    b_im = Image.open(ban)
    sheet = Image.new("RGB", (max(d_im.width, b_im.width) + 4, d_im.height + b_im.height + 12), (40, 40, 44))
    sheet.paste(d_im, (2, 2))
    sheet.paste(b_im, (2, d_im.height + 8))
    sheet.save(os.path.join(ROOT, "qa", "msi_preview.png"))
    print("wrote", dlg, ban, "+ preview")
