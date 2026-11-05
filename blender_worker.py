# SPDX-License-Identifier: GPL-3.0-or-later
"""Runs inside Blender; every bpy operation stays on its main thread."""
import contextlib
import io
import json
import math
import os
from pathlib import Path
import re
import sys

import bpy
from mathutils import Vector

OUTPUT = Path(sys.argv[sys.argv.index("--") + 1])
os.chdir(OUTPUT)
PREFIX = "FEATHERSCRIPT_RESULT:"


def vector(value):
    if not isinstance(value, list) or len(value) != 3 or any(isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n) for n in value):
        raise ValueError("Location and scale must contain three finite numbers.")
    return value


def label_for(args, fallback):
    label = args.get("name", fallback)
    if not isinstance(label, str) or not label.strip() or len(label) > 128:
        raise ValueError("Object name must contain 1–128 characters.")
    return label.strip()


def surface_options(args, default_color="#A77C5C"):
    color = args.get("color", default_color)
    if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        raise ValueError("Color must be a six-digit hex value like #A77C5C.")
    metallic, roughness = args.get("metallic", 0.0), args.get("roughness", 0.65)
    for name, value in (("Metallic", metallic), ("Roughness", roughness)):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1:
            raise ValueError(f"{name} must be a number from 0 to 1.")
    return color, metallic, roughness


def make_material(name, color, metallic=0, roughness=0.65):
    channels = [int(color[index:index + 2], 16) / 255 for index in (1, 3, 5)]
    # Blender shader colors use linear RGB; hexadecimal palette inputs use sRGB.
    rgb = tuple(channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4 for channel in channels)
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*rgb, 1)
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*rgb, 1)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    return material


def create_model(args):
    model = args.get("model")
    defaults = {"table": ([2.4, 1.4, 1.6], "#9B663E"),
                "chair": ([1.2, 1.2, 2.1], "#9B663E"),
                "building": ([6, 5, 8], "#9BA9BA"),
                "crate": ([1.5, 1.5, 1.5], "#AA8053")}
    if model not in defaults:
        raise ValueError("Choose table, chair, building or crate.")
    dimensions = vector(args.get("dimensions", defaults[model][0]))
    if any(not 0.25 <= item <= 1000 for item in dimensions):
        raise ValueError("Each model dimension must be between 0.25 and 1000.")
    location = vector(args.get("location", [0, 0, 0]))
    if any(abs(item) > 100000 for item in location):
        raise ValueError("Location must be within 100000 units of the origin.")
    label = label_for(args, model.title())
    color, metallic, roughness = surface_options(args, defaults[model][1])
    main = make_material(label + " Surface", color, metallic, roughness)
    detail = make_material(label + " Detail", "#3F5268" if model == "building" else "#534536", 0.25, 0.35)
    root = bpy.data.objects.new(label, None)
    bpy.context.scene.collection.objects.link(root)
    root.empty_display_type = 'CUBE'
    root.empty_display_size = min(dimensions) * 0.15
    root.location = location
    width, depth, height = dimensions
    count = 0

    def box(suffix, xyz, size, material=main):
        nonlocal count
        bpy.ops.mesh.primitive_cube_add(size=1)
        obj = bpy.context.object
        obj.name = f"{label} · {suffix}"
        obj.parent = root
        obj.location = xyz
        obj.scale = size
        obj.data.materials.append(material)
        obj["featherscript_generated"] = True
        count += 1

    if model == "table":
        top = height * 0.09
        leg = min(width, depth) * 0.11
        box("Top", (0, 0, height - top / 2), (width, depth, top))
        for x in (-1, 1):
            for y in (-1, 1):
                box("Leg", (x * (width - leg) * 0.43, y * (depth - leg) * 0.43, (height - top) / 2),
                    (leg, leg, height - top))
    elif model == "chair":
        seat_z = height * 0.48
        thickness = height * 0.085
        leg = min(width, depth) * 0.13
        box("Seat", (0, 0, seat_z), (width, depth, thickness))
        for x in (-1, 1):
            for y in (-1, 1):
                box("Leg", (x * (width - leg) * 0.42, y * (depth - leg) * 0.42,
                            (seat_z - thickness / 2) / 2), (leg, leg, seat_z - thickness / 2))
        box("Backrest", (0, depth / 2 - thickness / 2, (height + seat_z) / 2),
            (width, thickness, height - seat_z), detail)
    elif model == "building":
        roof = height * 0.08
        box("Walls", (0, 0, (height - roof) / 2), (width, depth, height - roof))
        box("Roof", (0, 0, height - roof / 2), (width * 1.06, depth * 1.06, roof), detail)
        floors = min(5, max(1, int(height / 2.6)))
        for floor in range(floors):
            for column in range(3):
                x = (column - 1) * width * 0.30
                z = (floor + 0.6) * (height - roof) / (floors + 0.3)
                box("Window", (x, -depth / 2 - 0.008 * depth, z),
                    (width * 0.18, depth * 0.016, (height - roof) / (floors + 0.3) * 0.48), detail)
    else:
        box("Body", (0, 0, height / 2), (width, depth, height))
        trim = min(width, depth, height) * 0.09
        for x in (-1, 1):
            box("Side Brace", (x * (width / 2 - trim / 2), -depth / 2 - trim / 2, height / 2),
                (trim, trim, height), detail)
        for z in (trim / 2, height - trim / 2):
            box("Front Brace", (0, -depth / 2 - trim / 2, z), (width, trim, trim), detail)
    return {"name": root.name, "model": model, "parts": count, "dimensions": dimensions}


def export_glb(args):
    value = args.get("path")
    if not isinstance(value, str):
        raise ValueError("Enter an absolute .glb path.")
    target = Path(value).expanduser()
    if not target.is_absolute() or target.suffix.lower() != ".glb" or not target.parent.is_dir():
        raise ValueError("Enter an absolute .glb path inside an existing folder.")
    generated_only = args.get("generated_only", True)
    if not isinstance(generated_only, bool):
        raise ValueError("generated_only must be true or false.")
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH' and
              (not generated_only or obj.get("featherscript_generated", False))]
    if not meshes:
        raise ValueError("No meshes to export. Generate a model or use generated_only=false.")
    # Exporting the selection avoids exporting Blender's default camera/light/cube.
    previous_selected = [obj for obj in bpy.context.selected_objects]
    previous_active = bpy.context.view_layer.objects.active
    with target.open("xb"):
        pass
    try:
        bpy.ops.object.select_all(action='DESELECT')
        for obj in meshes:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        outcome = bpy.ops.export_scene.gltf(filepath=str(target), export_format='GLB', use_selection=True)
        if 'FINISHED' not in outcome or target.stat().st_size < 12:
            raise RuntimeError("Blender did not produce a valid GLB file.")
    except Exception:
        target.unlink(missing_ok=True)
        raise
    finally:
        bpy.ops.object.select_all(action='DESELECT')
        for obj in previous_selected:
            if obj.name in bpy.data.objects:
                obj.select_set(True)
        if previous_active and previous_active.name in bpy.data.objects:
            bpy.context.view_layer.objects.active = previous_active
    return {"exported": str(target), "meshes": len(meshes), "bytes": target.stat().st_size}


def run(name, args):
    scene = bpy.context.scene
    if name == "get_scene_info":
        return {"scene": scene.name, "file": bpy.data.filepath, "objects": [
            {"name": obj.name, "type": obj.type, "location": list(obj.location), "scale": list(obj.scale), "animated": bool(obj.animation_data and obj.animation_data.action)}
            for obj in scene.objects], "headless": bpy.app.background, "frame": scene.frame_current, "frame_end": scene.frame_end, "fps": scene.render.fps}
    if name == "generate_3d":
        primitive = args.get("primitive")
        operations = {"cube": bpy.ops.mesh.primitive_cube_add, "sphere": bpy.ops.mesh.primitive_uv_sphere_add,
                      "cylinder": bpy.ops.mesh.primitive_cylinder_add, "cone": bpy.ops.mesh.primitive_cone_add,
                      "torus": bpy.ops.mesh.primitive_torus_add, "plane": bpy.ops.mesh.primitive_plane_add}
        if primitive not in operations:
            raise ValueError("Choose cube, sphere, cylinder, cone, torus or plane.")
        location = vector(args.get("location", [0, 0, 0]))
        scale = vector(args.get("scale", [1, 1, 1]))
        label = label_for(args, primitive.title())
        surface = surface_options(args, "#B1BDC9")
        operations[primitive](location=location)
        obj = bpy.context.object
        obj.name, obj.scale = label, scale
        if any(key in args for key in ("color", "metallic", "roughness")):
            obj.data.materials.append(make_material(label + " Surface", *surface))
        obj["featherscript_generated"] = True
        return {"name": obj.name, "type": obj.type}
    if name == "create_model":
        return create_model(args)
    if name == "export_glb":
        return export_glb(args)
    if name == "animate_object":
        obj = bpy.data.objects.get(args.get("name", ""))
        if obj is None:
            raise ValueError("Object not found. Inspect get_scene_info first.")
        frame = args.get("frame")
        if isinstance(frame, bool) or not isinstance(frame, int) or not 1 <= frame <= 10000:
            raise ValueError("Frame must be an integer from 1 to 10000.")
        channels = {key: vector(args[key]) for key in ("location", "rotation", "scale") if key in args}
        if not channels:
            raise ValueError("Supply at least one transform channel.")
        for key, value in channels.items():
            data_path = "rotation_euler" if key == "rotation" else key
            if key == "rotation":
                obj.rotation_mode = "XYZ"
            setattr(obj, data_path, value)
            obj.keyframe_insert(data_path=data_path, frame=frame)
        scene.frame_end = max(scene.frame_end, frame)
        scene.frame_set(frame)
        return {"animated": obj.name, "frame": frame, "channels": list(channels)}
    if name == "save_scene":
        value = args.get("path")
        if not isinstance(value, str):
            raise ValueError("Enter an absolute .blend path.")
        target = Path(value).expanduser()
        if not target.is_absolute() or target.suffix.lower() != ".blend" or not target.parent.is_dir():
            raise ValueError("Enter an absolute .blend path inside an existing folder.")
        # Reserve the name atomically to avoid overwriting an existing project.
        with target.open("xb"):
            pass
        previous_versions = bpy.context.preferences.filepaths.save_version
        try:
            bpy.context.preferences.filepaths.save_version = 0
            bpy.ops.wm.save_as_mainfile(filepath=str(target), check_existing=False)
        except Exception:
            if target.stat().st_size == 0:
                target.unlink()
            raise
        finally:
            bpy.context.preferences.filepaths.save_version = previous_versions
        return {"saved": str(target)}
    if name == "execute_blender_code":
        code = args.get("code")
        if not isinstance(code, str) or len(code) > 100000:
            raise ValueError("Code must be a string of at most 100000 characters.")
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            exec(compile(code, "<featherscript>", "exec"), {"bpy": bpy})
        return {"output": output.getvalue()[-20000:]}
    if name == "look":
        size = args.get("resolution", 256)
        if isinstance(size, bool) or not isinstance(size, int) or not 64 <= size <= 1024:
            raise ValueError("Resolution must be an integer from 64 to 1024.")
        if scene.camera is None:
            data = bpy.data.cameras.new("FeatherScript Camera")
            camera = bpy.data.objects.new("FeatherScript Camera", data)
            scene.collection.objects.link(camera)
            camera.location = (7, -7, 5)
            camera.rotation_euler = (Vector((0, 0, 0)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
            scene.camera = camera
        old = (scene.render.engine, scene.render.resolution_x, scene.render.resolution_y,
               scene.render.resolution_percentage, scene.render.filepath, scene.render.image_settings.file_format,
               scene.cycles.samples, scene.cycles.device)
        try:
            scene.render.engine = "CYCLES"
            scene.cycles.device, scene.cycles.samples = "CPU", 4
            scene.render.resolution_x = scene.render.resolution_y = size
            scene.render.resolution_percentage = 100
            scene.render.image_settings.file_format = "PNG"
            scene.render.filepath = "preview.png"
            bpy.ops.render.render(write_still=False)
            bpy.data.images["Render Result"].save_render(filepath=str(OUTPUT / "preview.png"), scene=scene)
        finally:
            (scene.render.engine, scene.render.resolution_x, scene.render.resolution_y,
             scene.render.resolution_percentage, scene.render.filepath, scene.render.image_settings.file_format,
             scene.cycles.samples, scene.cycles.device) = old
        return {"rendered": True}
    raise ValueError("Unknown tool.")


print(PREFIX + json.dumps({"ready": True, "version": bpy.app.version_string}), flush=True)

for line in sys.stdin:
    try:
        request = json.loads(line)
        result = run(request["tool"], request["arguments"])
    except Exception as error:
        result = {"error": str(error)}
    print(PREFIX + json.dumps(result, ensure_ascii=False), flush=True)
