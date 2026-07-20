"""Fixed MoonMold semantic Blender bridge.

This file is selected by the adapter itself. No request field can replace,
extend, or inject Python code.
"""

import argparse
import hashlib
import json
import math
import os
import re
import sys

import bpy
from mathutils import Vector


IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


def scoped(root, path):
    root = os.path.realpath(root)
    resolved = os.path.realpath(path)
    if resolved == root or not resolved.startswith(root + os.sep):
        raise ValueError("path escapes Moon Suite workspace")
    return resolved


def positive(value, name):
    if not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


def identifier(value, name):
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise ValueError(f"{name} is malformed")
    return value


def material_for(material_id):
    name = identifier(material_id, "materialId")
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    digest = hashlib.sha256(name.encode("utf8")).digest()
    material = bpy.data.materials.new(name=name)
    material.diffuse_color = (
        0.25 + digest[0] / 510.0,
        0.25 + digest[1] / 510.0,
        0.25 + digest[2] / 510.0,
        1.0,
    )
    material.roughness = 0.65
    return material


def add_component(component):
    object_id = identifier(component.get("id"), "component.id")
    kind = component.get("kind")
    dimensions = component.get("dimensions", {})
    position = component.get("position", {})
    location = tuple(float(position.get(axis, 0)) / 1000.0 for axis in ("xMm", "yMm", "zMm"))
    if kind == "box":
        width = positive(dimensions.get("widthMm"), "widthMm") / 1000.0
        depth = positive(dimensions.get("depthMm"), "depthMm") / 1000.0
        height = positive(dimensions.get("heightMm"), "heightMm") / 1000.0
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
        obj = bpy.context.object
        obj.dimensions = (width, depth, height)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    elif kind == "cylinder":
        radius = positive(dimensions.get("radiusMm"), "radiusMm") / 1000.0
        height = positive(dimensions.get("heightMm"), "heightMm") / 1000.0
        sides = dimensions.get("sides")
        if not isinstance(sides, int) or sides < 8 or sides > 256:
            raise ValueError("cylinder sides must be 8..256")
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=sides,
            radius=radius,
            depth=height,
            location=location,
        )
        obj = bpy.context.object
    else:
        raise ValueError("only box and cylinder components are supported")
    obj.name = object_id
    obj.data.name = f"{object_id}-mesh"
    obj.data.materials.append(material_for(component.get("materialId")))
    return obj


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def configure_scene(meshes):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 480
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new("MoonMoldEvidenceWorld")
    # Evidence renders optimize for legibility across unknown geometry and
    # materials.  Keep this policy fixture-independent: a neutral environment,
    # balanced three-point lighting, and a visible ground plane make scale and
    # silhouette readable without changing the modeled artifact.
    scene.world.color = (0.09, 0.105, 0.14)
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = 0.7

    corners = []
    for obj in meshes:
        corners.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    minimum = Vector(tuple(min(point[i] for point in corners) for i in range(3)))
    maximum = Vector(tuple(max(point[i] for point in corners) for i in range(3)))
    center = (minimum + maximum) * 0.5
    extent = max((maximum - minimum).length, 4.0)

    floor_z = minimum.z - max(extent * 0.004, 0.01)
    bpy.ops.mesh.primitive_plane_add(
        size=extent * 4.0,
        location=(center.x, center.y, floor_z),
    )
    floor = bpy.context.object
    floor.name = "MoonMoldEvidenceGround"
    ground = bpy.data.materials.new(name="MoonMoldEvidenceGroundMaterial")
    ground.diffuse_color = (0.16, 0.18, 0.22, 1.0)
    ground.roughness = 0.9
    floor.data.materials.append(ground)

    bpy.ops.object.camera_add(location=center + Vector((extent * 1.2, -extent * 1.5, extent * 0.9)))
    camera = bpy.context.object
    camera.name = "MoonMoldEvidenceCamera"
    camera.data.lens = 48
    look_at(camera, center)
    scene.camera = camera

    bpy.ops.object.light_add(type="AREA", location=center + Vector((extent, -extent, extent * 1.6)))
    key = bpy.context.object
    key.name = "MoonMoldKeyLight"
    key.data.energy = 2600
    key.data.shape = "DISK"
    key.data.size = extent
    look_at(key, center)

    bpy.ops.object.light_add(type="AREA", location=center + Vector((-extent, extent * 0.4, extent)))
    fill = bpy.context.object
    fill.name = "MoonMoldFillLight"
    fill.data.energy = 1500
    fill.data.size = extent * 0.8
    look_at(fill, center)

    bpy.ops.object.light_add(type="AREA", location=center + Vector((0, extent, extent * 1.8)))
    rim = bpy.context.object
    rim.name = "MoonMoldRimLight"
    rim.data.energy = 1900
    rim.data.size = extent
    look_at(rim, center)
    return minimum, maximum


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--workspace-root", required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    input_path = scoped(args.workspace_root, args.input)
    output = scoped(args.workspace_root, args.output)
    os.makedirs(output, exist_ok=True)
    with open(input_path, "r", encoding="utf8") as handle:
        plan = json.load(handle)
    if plan.get("schema") != "moonmold-building-plan-v1":
        raise ValueError("unsupported building plan")
    if plan.get("units") != "mm" or plan.get("coordinateFrame") != "z-up-right-handed":
        raise ValueError("live bridge currently requires explicit mm z-up-right-handed input")
    components = plan.get("components")
    if not isinstance(components, list) or len(components) < 2:
        raise ValueError("at least two components are required")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    meshes = [add_component(component) for component in components]
    minimum, maximum = configure_scene(meshes)

    for obj in bpy.context.selected_objects:
        obj.select_set(False)
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]

    blend_path = os.path.join(output, "model.blend")
    glb_path = os.path.join(output, "model.glb")
    stl_path = os.path.join(output, "model.stl")
    render_path = os.path.join(output, "render.png")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path, check_existing=False)
    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        export_format="GLB",
        use_selection=True,
        export_cameras=False,
        export_lights=False,
    )
    bpy.ops.wm.stl_export(
        filepath=stl_path,
        export_selected_objects=True,
        ascii_format=False,
    )
    bpy.context.scene.render.filepath = render_path
    bpy.ops.render.render(write_still=True)
    manifest = {
        "schema": "moonmold-live-blender-bridge-v1",
        "planId": plan["id"],
        "objectIds": sorted(obj.name for obj in meshes),
        "objectCount": len(meshes),
        "boundsMeters": {
            "min": list(minimum),
            "max": list(maximum),
        },
        "units": "m",
        "sourceUnits": "mm",
        "coordinateFrame": "z-up-right-handed",
        "outputs": ["model.blend", "model.glb", "model.stl", "render.png"],
        "physicalEffects": False,
    }
    with open(os.path.join(output, "bridge-manifest.json"), "x", encoding="utf8") as handle:
        json.dump(manifest, handle, sort_keys=True, separators=(",", ":"))
        handle.write("\n")


if __name__ == "__main__":
    main()
