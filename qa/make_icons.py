# Assemble icon deliverables from Blender render output.
from PIL import Image
import os

ROOT = r"D:\AgentHive"
OUT = os.path.join(ROOT, "qa", "icon_render")
PUB = os.path.join(ROOT, "frontend", "public")
BRAND = os.path.join(PUB, "brand")
os.makedirs(BRAND, exist_ok=True)

still = Image.open(os.path.join(OUT, "dark", "signal-knot.png")).convert("RGBA")

# 1. still -> brand + app icon slots (dark is the canonical app icon)
still.save(os.path.join(BRAND, "knot.png"))
still.resize((192, 192), Image.LANCZOS).save(os.path.join(PUB, "icon-192.png"))
still.resize((512, 512), Image.LANCZOS).save(os.path.join(PUB, "icon-512.png"))

# 2. multi-size .ico for the Tauri desktop build
still.save(os.path.join(ROOT, "frontend", "src-tauri", "icons", "icon.ico"),
           sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64),
                  (128, 128), (256, 256)])

# 3. APNG turntable loops — one per UI theme (48 frames, ~13fps, seamless).
#    knot-loop.png is the default/dark asset; others swap in via [data-theme] CSS.
for theme in ("dark", "obsidian", "light", "daylight"):
    tfr = os.path.join(OUT, theme, "frames")
    frames = [Image.open(os.path.join(tfr, "f_%04d.png" % i)).convert("RGBA")
              for i in range(48)]
    name = "knot-loop.png" if theme == "dark" else f"knot-loop-{theme}.png"
    frames[0].save(os.path.join(BRAND, name),
                   save_all=True, append_images=frames[1:],
                   duration=77, loop=0)
    # themed still for in-app use (badges, future avatars)
    if theme != "dark":
        Image.open(os.path.join(OUT, theme, "signal-knot.png")).convert("RGBA") \
            .resize((256, 256), Image.LANCZOS) \
            .save(os.path.join(BRAND, f"knot-{theme}.png"))

for f in sorted(os.listdir(BRAND)):
    print(f, os.path.getsize(os.path.join(BRAND, f)) // 1024, "KB")
