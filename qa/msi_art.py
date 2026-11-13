"""Generate WiX MSI installer artwork for SignalHive.

Produces:
  frontend/src-tauri/msi/dialog.bmp    (493x312)   — welcome/finish background
  frontend/src-tauri/msi/banner.bmp    (493x58)    — interior dialog header strip
  frontend/src-tauri/msi/dialog_2x.bmp (986x624)   — HiDPI source (WiX scales to fit)
  frontend/src-tauri/msi/banner_2x.bmp (986x116)
  qa/msi_preview.png                    — contact sheet for eyeballing

WiX text renders dark over the right ~329px of the dialog and over the
banner's left ~430px, so those zones stay light; the left 164px of the
dialog is pure art space (dark panel + gold knot). Everything is drawn at
the requested scale so 2x assets carry real detail, not interpolated blur.
"""
import math
import os
import random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KNOT = os.path.join(ROOT, "qa", "icon_render", "dark", "signal-knot.png")
OUT = os.path.join(ROOT, "frontend", "src-tauri", "msi")

# SignalHive palette — obsidian panel, warm paper right side, honey gold accents
OBSIDIAN_TOP = (18, 20, 27)
OBSIDIAN_BOT = (10, 12, 17)
PAPER = (249, 247, 243)
PAPER_EDGE = (236, 232, 224)
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


def diag_sheen(img, s, angle_deg=18, alpha=10):
    """Very subtle diagonal sheen lines — gives paper a premium texture."""
    w, h = img.size
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    step = 34 * s
    rad = math.radians(angle_deg)
    dx, dy = math.cos(rad), math.sin(rad)
    diag = int((w + h) * 1.2)
    for i in range(-h, w + h, step):
        d.line([i, 0, i + dx * diag, dy * diag], fill=(255, 255, 255, alpha), width=10 * s)
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


def panel_shadow(height, depth=18):
    """Soft shadow strip to the right of the dark panel divider."""
    sh = Image.new("RGBA", (depth, height), (0, 0, 0, 0))
    px = sh.load()
    for x in range(depth):
        a = int(38 * (1 - x / depth) ** 1.6)
        for y in range(height):
            px[x, y] = (20, 20, 24, a)
    return sh


def make_dialog(path, s=1):
    W, H, PANEL = 493 * s, 312 * s, 164 * s
    img = Image.new("RGBA", (W, H))

    # right side — warm paper with faint sheen
    right = vgrad((W - PANEL, H), PAPER, PAPER_EDGE)
    right = diag_sheen(right, s, angle_deg=24, alpha=7)
    img.paste(right.convert("RGB"), (PANEL, 0))

    # faint watermark knot bottom-right on the paper
    wm = scaled_knot(KNOT, 150 * s)
    wm_alpha = wm.getchannel("A").point(lambda a: int(a * 0.065))
    wm.putalpha(wm_alpha)
    img.alpha_composite(wm, (W - wm.width - 22 * s, H - wm.height - 18 * s))

    # left art panel — obsidian gradient with a whisper of grain
    panel = vgrad((PANEL, H), OBSIDIAN_TOP, OBSIDIAN_BOT).convert("RGBA")
    panel.alpha_composite(grain((PANEL, H), alpha=7))

    # top vignette for depth
    vig_h = 70 * s
    vig = Image.new("RGBA", (PANEL, vig_h), (0, 0, 0, 0))
    vpx = vig.load()
    for y in range(vig_h):
        a = int(60 * (1 - y / vig_h) ** 1.5)
        for x in range(PANEL):
            vpx[x, y] = (0, 0, 0, a)
    panel.alpha_composite(vig, (0, 0))

    # warm gold radial glow behind knot
    g = glow(230 * s, GOLD, peak=105, falloff=2.0)
    panel.alpha_composite(g, ((PANEL - g.width) // 2, 60 * s))

    # the knot, centered in the upper half of the panel
    knot = scaled_knot(KNOT, 128 * s)
    panel.alpha_composite(knot, ((PANEL - knot.width) // 2, 74 * s))

    # serif wordmark + tagline
    d = ImageDraw.Draw(panel)
    wm_f = ImageFont.truetype("C:/Windows/Fonts/georgia.ttf", 19 * s)
    tag_f = ImageFont.truetype("C:/Windows/Fonts/georgiai.ttf", 10 * s)
    text = "SignalHive"
    tw = d.textlength(text, font=wm_f)
    d.text(((PANEL - tw) / 2, 216 * s), text, font=wm_f, fill=(*GOLD_SOFT, 255))
    tagline = "your crew's agents"
    ttw = d.textlength(tagline, font=tag_f)
    d.text(((PANEL - ttw) / 2, 242 * s), tagline, font=tag_f, fill=(*GOLD, 170))

    # tiny gold dot-grid motif along the panel bottom + version tag
    for row in range(3):
        for col in range(8):
            x = 58 * s + col * 12 * s
            y = 268 * s + row * 12 * s
            a = 150 - row * 45
            d.ellipse([x, y, x + 2 * s, y + 2 * s], fill=(*GOLD, max(a, 30)))
    vf = ImageFont.truetype("C:/Windows/Fonts/consola.ttf" if os.path.exists(
        "C:/Windows/Fonts/consola.ttf") else "C:/Windows/Fonts/georgia.ttf", 10 * s)
    d.text((14 * s, H - 20 * s), "v1.0.0", font=vf, fill=(*GOLD, 110))

    # hairline gold divider + soft shadow onto the paper, plus a quiet
    # baseline rule on the paper side echoing the banner strip
    d.line([(PANEL - 1, 0), (PANEL - 1, H)], fill=(*GOLD, 140), width=s)
    img.alpha_composite(panel, (0, 0))
    img.alpha_composite(panel_shadow(H, depth=18 * s), (PANEL, 0))
    base = ImageDraw.Draw(img)
    for x in range(PANEL, W):
        t = (x - PANEL) / (W - PANEL)
        base.line([(x, H - s), (x, H - s)], fill=(*GOLD, int(90 * (0.4 + 0.6 * t))), width=s)

    img.convert("RGB").save(path, "BMP")


def make_banner(path, s=1):
    W, H = 493 * s, 58 * s
    img = vgrad((W, H), PAPER, PAPER_EDGE).convert("RGBA")
    img = diag_sheen(img, s, angle_deg=24, alpha=6)

    # soft knot + glow on the right end (outside the title text zone)
    g = glow(100 * s, GOLD, peak=70, falloff=1.8)
    img.alpha_composite(g, (W - 96 * s, (H - g.height) // 2 + 4 * s))
    knot = scaled_knot(KNOT, 54 * s)
    img.alpha_composite(knot, (W - 84 * s, 2 * s))

    # hairline gold rule along the bottom edge
    d = ImageDraw.Draw(img)
    for x in range(W):
        t = x / W
        a = int(150 * (0.35 + 0.65 * t))
        d.line([(x, H - s), (x, H - s)], fill=(*GOLD, a), width=s)

    img.convert("RGB").save(path, "BMP")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    make_dialog(os.path.join(OUT, "dialog.bmp"), s=1)
    make_banner(os.path.join(OUT, "banner.bmp"), s=1)
    make_dialog(os.path.join(OUT, "dialog_2x.bmp"), s=2)
    make_banner(os.path.join(OUT, "banner_2x.bmp"), s=2)

    # contact-sheet preview (1x only, it's the same composition)
    d_im = Image.open(os.path.join(OUT, "dialog.bmp"))
    b_im = Image.open(os.path.join(OUT, "banner.bmp"))
    sheet = Image.new("RGB", (max(d_im.width, b_im.width) + 4, d_im.height + b_im.height + 12), (40, 40, 44))
    sheet.paste(d_im, (2, 2))
    sheet.paste(b_im, (2, d_im.height + 8))
    sheet.save(os.path.join(ROOT, "qa", "msi_preview.png"))
    print("wrote 1x + 2x bitmaps + preview")
