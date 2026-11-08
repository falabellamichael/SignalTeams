"""SignalTeams knot emblem — continuous trefoil knot, honey-gold, transparent bg.
Renders: 1x 1024 still + 48-frame Z-turntable loop (seamless: frame 49 == frame 1).
Run: blender -b --factory-startup -P qa/blender_icon.py
"""
import bpy
import math
import os

ROOT = r"D:\AgentHive"
OUT = os.path.join(ROOT, "qa", "icon_render")
FRAMES = os.path.join(OUT, "frames")
os.makedirs(FRAMES, exist_ok=True)

# ---- clean scene ---------------------------------------------------------
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for c in (bpy.data.curves, bpy.data.meshes, bpy.data.materials,
          bpy.data.cameras, bpy.data.lights):
    for x in list(c):
        c.remove(x)

# ---- knot: (2,3) torus knot = trefoil, one continuous tube ----------------
p, q, R, r, N = 2, 3, 2.0, 0.9, 512
cu = bpy.data.curves.new("knot", "CURVE")
cu.dimensions = "3D"
cu.resolution_u = 12
cu.bevel_depth = 0.30
cu.bevel_resolution = 5
sp = cu.splines.new("POLY")
sp.points.add(N - 1)
for i in range(N):
    t = 2.0 * math.pi * i / N
    x = (R + r * math.cos(q * t)) * math.cos(p * t)
    y = (R + r * math.cos(q * t)) * math.sin(p * t)
    z = r * math.sin(q * t)
    sp.points[i].co = (x, y, z, 1.0)
sp.use_cyclic_u = True
knot = bpy.data.objects.new("knot", cu)
bpy.context.collection.objects.link(knot)

# ---- material: honey-gold metal with a warm emission core -----------------
m = bpy.data.materials.new("honey")
m.use_nodes = True
bsdf = m.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.85, 0.45, 0.08, 1.0)
bsdf.inputs["Metallic"].default_value = 0.9
bsdf.inputs["Roughness"].default_value = 0.22
try:
    bsdf.inputs["Emission Color"].default_value = (1.0, 0.55, 0.12, 1.0)
    bsdf.inputs["Emission Strength"].default_value = 0.25
except KeyError:
    bsdf.inputs["Emission"].default_value = (1.0, 0.55, 0.12, 1.0)
    bsdf.inputs["Emission Strength"].default_value = 0.25
knot.data.materials.append(m)

# ---- lighting rig ----------------------------------------------------------
def area(name, loc, energy, size, color):
    li = bpy.data.lights.new(name, "AREA")
    li.energy = energy
    li.shape = "DISK"
    li.size = size
    li.color = color
    o = bpy.data.objects.new(name, li)
    o.location = loc
    d = -o.location.to_3d() if False else (bpy.context.scene.cursor.location - o.location)
    o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(o)
    return o

LIGHTS = {
    "key":  area("key",  (4.5, -4.5, 7.0), 900, 5.0, (1.0, 0.85, 0.62)),
    "rim":  area("rim",  (-5.0, 3.0, 5.0), 1100, 4.0, (0.45, 0.60, 1.0)),
    "fill": area("fill", (0.0, 5.5, -3.0), 500, 6.0, (1.0, 0.70, 0.40)),
}

# ---- glowing core ("the signal") in the knot's void ------------------------
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.55, segments=48, ring_count=32,
                                     location=(0, 0, 0))
core = bpy.context.object
core.name = "core"
cm = bpy.data.materials.new("core")
cm.use_nodes = True
cb = cm.node_tree.nodes["Principled BSDF"]
cb.inputs["Base Color"].default_value = (1.0, 0.72, 0.25, 1.0)
cb.inputs["Roughness"].default_value = 0.35
try:
    cb.inputs["Emission Color"].default_value = (1.0, 0.60, 0.15, 1.0)
    cb.inputs["Emission Strength"].default_value = 6.0
except KeyError:
    cb.inputs["Emission"].default_value = (1.0, 0.60, 0.15, 1.0)
    cb.inputs["Emission Strength"].default_value = 6.0
core.data.materials.append(cm)

# world: near-black ambient, transparent film
w = bpy.data.worlds.new("w") if not bpy.data.worlds else bpy.data.worlds[0]
bpy.context.scene.world = w
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.012, 0.015, 0.025, 1.0)
w.node_tree.nodes["Background"].inputs[1].default_value = 0.35

# ---- camera: ortho, slightly elevated for depth ----------------------------
cam = bpy.data.cameras.new("cam")
cam.type = "ORTHO"
cam.ortho_scale = 7.4
co = bpy.data.objects.new("cam", cam)
co.location = (7.0, -9.5, 7.0)
d = (bpy.context.scene.cursor.location - co.location)
co.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
bpy.context.collection.objects.link(co)
bpy.context.scene.camera = co

# ---- auto-center: shift camera so the knot's projected centroid sits at 0.5
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector
bpy.context.view_layer.update()
pts = [Vector(sp.points[i].co[:3]) for i in range(0, N, 8)]
pts.append(Vector((0.0, 0.0, 0.0)))  # core
xs, ys = [], []
for v in pts:
    ndc = world_to_camera_view(bpy.context.scene, co, v)
    xs.append(ndc.x)
    ys.append(ndc.y)
cx = (min(xs) + max(xs)) / 2.0
cy = (min(ys) + max(ys)) / 2.0
right = co.matrix_world.to_quaternion() @ Vector((1, 0, 0))
up = co.matrix_world.to_quaternion() @ Vector((0, 1, 0))
co.location += right * ((cx - 0.5) * cam.ortho_scale)
co.location += up * ((cy - 0.5) * cam.ortho_scale)

# ---- render setup ----------------------------------------------------------
sc = bpy.context.scene
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"):
    try:
        sc.render.engine = eng
        break
    except TypeError:
        continue
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGBA"
sc.render.film_transparent = True
try:
    sc.eevee.taa_render_samples = 32
except Exception:
    pass
try:
    sc.view_settings.look = "AgX - Medium High Contrast"
except Exception:
    pass

# ---- per-theme palettes — the emblem retunes to match each UI theme -------
THEMES = {
    "dark": {      # Tokyo Night — honey gold, warm key + cool rim (original)
        "base": (0.85, 0.45, 0.08), "metal": 0.90, "rough": 0.22,
        "emit": (1.0, 0.55, 0.12), "emit_s": 0.25,
        "core": (1.0, 0.72, 0.25), "core_emit": (1.0, 0.60, 0.15), "core_s": 6.0,
        "key": (1.0, 0.85, 0.62), "rim": (0.45, 0.60, 1.0), "fill": (1.0, 0.70, 0.40),
        "amb": (0.012, 0.015, 0.025), "amb_s": 0.35,
    },
    "obsidian": {  # pure black/grey — brushed platinum, icy white core
        "base": (0.55, 0.56, 0.62), "metal": 1.0, "rough": 0.16,
        "emit": (0.62, 0.68, 0.82), "emit_s": 0.15,
        "core": (0.85, 0.88, 0.95), "core_emit": (0.72, 0.80, 1.0), "core_s": 5.0,
        "key": (0.95, 0.96, 1.0), "rim": (0.45, 0.60, 1.0), "fill": (0.70, 0.74, 0.82),
        "amb": (0.012, 0.013, 0.016), "amb_s": 0.30,
    },
    "light": {     # warm paper — deep antique bronze so it reads on white
        "base": (0.40, 0.24, 0.06), "metal": 0.80, "rough": 0.30,
        "emit": (0.55, 0.30, 0.05), "emit_s": 0.20,
        "core": (0.85, 0.50, 0.12), "core_emit": (0.80, 0.42, 0.06), "core_s": 4.0,
        "key": (1.0, 0.90, 0.70), "rim": (0.55, 0.55, 0.75), "fill": (1.0, 0.80, 0.55),
        "amb": (0.05, 0.045, 0.035), "amb_s": 0.55,
    },
    "daylight": {  # crisp slate — saturated amber, gentle rim
        "base": (0.80, 0.36, 0.03), "metal": 0.75, "rough": 0.26,
        "emit": (0.90, 0.45, 0.05), "emit_s": 0.20,
        "core": (1.0, 0.60, 0.15), "core_emit": (0.95, 0.50, 0.08), "core_s": 5.0,
        "key": (1.0, 0.93, 0.80), "rim": (0.40, 0.55, 0.95), "fill": (1.0, 0.75, 0.45),
        "amb": (0.04, 0.04, 0.05), "amb_s": 0.50,
    },
}


def _emit_input(node):
    return node.inputs["Emission Color"] if "Emission Color" in node.inputs \
        else node.inputs["Emission"]


def apply_theme(P):
    bsdf.inputs["Base Color"].default_value = (*P["base"], 1.0)
    bsdf.inputs["Metallic"].default_value = P["metal"]
    bsdf.inputs["Roughness"].default_value = P["rough"]
    _emit_input(bsdf).default_value = (*P["emit"], 1.0)
    bsdf.inputs["Emission Strength"].default_value = P["emit_s"]
    cb.inputs["Base Color"].default_value = (*P["core"], 1.0)
    _emit_input(cb).default_value = (*P["core_emit"], 1.0)
    cb.inputs["Emission Strength"].default_value = P["core_s"]
    LIGHTS["key"].data.color = P["key"]
    LIGHTS["rim"].data.color = P["rim"]
    LIGHTS["fill"].data.color = P["fill"]
    w.node_tree.nodes["Background"].inputs[0].default_value = (*P["amb"], 1.0)
    w.node_tree.nodes["Background"].inputs[1].default_value = P["amb_s"]


for theme, P in THEMES.items():
    apply_theme(P)
    tdir = os.path.join(OUT, theme)
    tfr = os.path.join(tdir, "frames")
    os.makedirs(tfr, exist_ok=True)

    sc.render.resolution_x = sc.render.resolution_y = 1024
    sc.render.resolution_percentage = 100
    sc.render.filepath = os.path.join(tdir, "signal-knot.png")
    knot.rotation_euler = (0, 0, 0)
    bpy.ops.render.render(write_still=True)
    print("STILL", theme)

    sc.render.resolution_x = sc.render.resolution_y = 256
    for f in range(48):
        knot.rotation_euler.z = 2.0 * math.pi * f / 48.0
        sc.render.filepath = os.path.join(tfr, "f_%04d.png" % f)
        bpy.ops.render.render(write_still=True)
    print("LOOP", theme)

print("DONE", OUT)
