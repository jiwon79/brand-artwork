"""Build the single resin smiley study in Blender.

Run this file in Blender's Text Editor, or execute its source through Blender MCP.
The main entry point writes the model to the adjacent assets directory.

The mesh faces -Y in Blender (+Z after glTF export). Dimensions are 2 x 0.28 x 2.
Only the default/test mesh names and an earlier Smiley study may be replaced.
"""
import math
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

RADIUS = 1.0
DEPTH = 0.28
EYE_WIDTH = 0.135
EYE_HEIGHT = 0.74
EYE_SPACING = 0.54
MOUTH_RADIUS = 0.685
MOUTH_WIDTH = 0.035
MODEL_NAME = "Smiley"


def activate(obj):
    for other in bpy.context.selected_objects:
        other.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def apply(obj, modifier):
    activate(obj)
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def capsule(cx, cy, width, height, steps=20):
    radius = width / 2
    straight = height / 2 - radius
    return [
        (cx + radius * math.cos(a), cy + straight + radius * math.sin(a))
        for a in [math.pi * i / steps for i in range(steps + 1)]
    ] + [
        (cx + radius * math.cos(a), cy - straight + radius * math.sin(a))
        for a in [math.pi + math.pi * i / steps for i in range(steps + 1)]
    ]


def extruded_outline(name, points, depth=0.8):
    # Counterclockwise points give outward-facing prism walls.
    area = sum(
        a[0] * b[1] - b[0] * a[1]
        for a, b in zip(points, points[1:] + points[:1])
    )
    if area < 0:
        points = points[::-1]
    n = len(points)
    vertices = [(x, y, z) for z in (-depth / 2, depth / 2) for x, y in points]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    faces.extend((i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    cutter = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(cutter)
    return cutter


def subtract(body, cutter):
    modifier = body.modifiers.new("Cut " + cutter.name, "BOOLEAN")
    modifier.operation = "DIFFERENCE"
    modifier.solver = "EXACT"
    modifier.object = cutter
    apply(body, modifier)
    mesh = cutter.data
    bpy.data.objects.remove(cutter, do_unlink=True)
    if mesh.users == 0:
        bpy.data.meshes.remove(mesh)


def smile_outline():
    start, end = math.radians(198), math.radians(342)
    half = MOUTH_WIDTH / 2
    angles = [start + (end - start) * i / 112 for i in range(113)]
    # The two arcs form a thin, genuinely open smile slot.
    return [
        ((MOUTH_RADIUS + half) * math.cos(a), 0.10 + (MOUTH_RADIUS + half) * math.sin(a))
        for a in angles
    ] + [
        ((MOUTH_RADIUS - half) * math.cos(a), 0.10 + (MOUTH_RADIUS - half) * math.sin(a))
        for a in reversed(angles)
    ]


def resin_material():
    material = bpy.data.materials.get("Pink resin") or bpy.data.materials.new("Pink resin")
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.95, 0.25, 0.62, 1)
    bsdf.inputs["Roughness"].default_value = 0.28
    bsdf.inputs["Metallic"].default_value = 0
    bsdf.inputs["IOR"].default_value = 1.46
    bsdf.inputs["Coat Weight"].default_value = 0.24
    bsdf.inputs["Coat Roughness"].default_value = 0.22
    material.diffuse_color = (0.95, 0.25, 0.62, 1)
    return material


def look_at(obj, target=(0, 0, 0)):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def area_light(collection, name, location, power, size, color):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = power
    data.shape = "DISK"
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    obj.location = location
    look_at(obj)
    return obj


def setup_studio(scene):
    rig_name = "Smiley Studio"
    previous = bpy.data.collections.get(rig_name)
    if previous is not None:
        for obj in list(previous.objects):
            data = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if data.users == 0:
                if isinstance(data, bpy.types.Light):
                    bpy.data.lights.remove(data)
                elif isinstance(data, bpy.types.Camera):
                    bpy.data.cameras.remove(data)
        bpy.data.collections.remove(previous)
    rig = bpy.data.collections.new(rig_name)
    scene.collection.children.link(rig)

    # Replace only Blender's original camera/light, preserving any user-named rig.
    for name, object_type in (("Camera", "CAMERA"), ("Light", "LIGHT")):
        obj = scene.objects.get(name)
        if obj is not None and obj.type == object_type:
            data = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if data.users == 0:
                if object_type == "CAMERA":
                    bpy.data.cameras.remove(data)
                else:
                    bpy.data.lights.remove(data)

    camera_data = bpy.data.cameras.new("Smiley Camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 2.75
    camera_data.lens = 70
    camera = bpy.data.objects.new("Smiley Camera", camera_data)
    rig.objects.link(camera)
    camera.location = (0, -10, 2.2)
    look_at(camera)
    scene.camera = camera
    area_light(rig, "Key softbox", (-3, -4, 5), 600, 4.0, (1, 0.94, 0.98))
    area_light(rig, "Fill softbox", (4, -2, 1), 130, 4.0, (0.85, 0.91, 1))
    area_light(rig, "Edge softbox", (1, 1.8, 3), 180, 3.0, (1, 0.8, 0.91))

    world = bpy.data.worlds.get("Smiley black studio") or bpy.data.worlds.new("Smiley black studio")
    world.use_nodes = True
    nodes = world.node_tree.nodes
    nodes.clear()
    ambient = nodes.new("ShaderNodeBackground")
    ambient.inputs["Color"].default_value = (0.08, 0.09, 0.12, 1)
    ambient.inputs["Strength"].default_value = 0.35
    black = nodes.new("ShaderNodeBackground")
    black.inputs["Color"].default_value = (0, 0, 0, 1)
    light_path = nodes.new("ShaderNodeLightPath")
    mix = nodes.new("ShaderNodeMixShader")
    output = nodes.new("ShaderNodeOutputWorld")
    links = world.node_tree.links
    links.new(light_path.outputs["Is Camera Ray"], mix.inputs[0])
    links.new(ambient.outputs[0], mix.inputs[1])
    links.new(black.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], output.inputs["Surface"])
    scene.world = world
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 64
    scene.cycles.preview_samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 800
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = 0.35
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                space = area.spaces.active
                space.region_3d.view_location = (0, 0, 0)
                space.region_3d.view_rotation = camera.rotation_euler.to_quaternion()
                space.region_3d.view_distance = 3.3
                space.region_3d.view_perspective = "ORTHO"
                space.overlay.show_overlays = False
                space.shading.type = "MATERIAL"
                space.shading.use_scene_lights = True
                space.shading.use_scene_world = True


def inspect_mesh(body):
    bm = bmesh.new()
    bm.from_mesh(body.data)
    report = {
        "vertices": len(bm.verts),
        "faces": len(bm.faces),
        "non_manifold_edges": sum(not edge.is_manifold for edge in bm.edges),
        "loose_vertices": sum(not vert.link_edges for vert in bm.verts),
        "volume": bm.calc_volume(signed=True),
    }
    bm.free()
    body.data.calc_loop_triangles()
    report["triangles"] = len(body.data.loop_triangles)
    report["dimensions"] = list(body.dimensions)
    assert report["non_manifold_edges"] == 0, report
    assert report["volume"] > 0, report
    return report


def build_smiley():
    assert bpy.context.mode == "OBJECT", "Switch to Object Mode first."
    scene = bpy.context.scene
    mesh_names = [obj.name for obj in scene.objects if obj.type == "MESH"]
    unexpected = set(mesh_names) - {"Cube", "Sphere", MODEL_NAME}
    assert not unexpected, "Keep user meshes intact: " + str(unexpected)
    bpy.ops.ed.undo_push(message="Before smiley study")
    for name in mesh_names:
        obj = scene.objects[name]
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)

    bpy.ops.mesh.primitive_cylinder_add(vertices=192, radius=RADIUS, depth=DEPTH, end_fill_type="NGON", location=(0, 0, 0))
    body = bpy.context.object
    body.name = MODEL_NAME
    body.data.name = "Smiley mesh"
    rim = body.modifiers.new("Rounded outer rim", "BEVEL")
    rim.width = 0.045
    rim.segments = 6
    rim.limit_method = "ANGLE"
    apply(body, rim)

    for x, name in ((-EYE_SPACING / 2, "Left eye"), (EYE_SPACING / 2, "Right eye")):
        subtract(body, extruded_outline(name, capsule(x, 0.255, EYE_WIDTH, EYE_HEIGHT)))
    subtract(body, extruded_outline("Smile", smile_outline()))

    for angle, name in ((198, "Left smile corner"), (342, "Right smile corner")):
        a = math.radians(angle)
        cx, cy = MOUTH_RADIUS * math.cos(a), 0.10 + MOUTH_RADIUS * math.sin(a)
        # Short horizontal cheek marks meet the open arc at each endpoint.
        subtract(body, extruded_outline(name, [
            (cx - 0.053, cy - 0.009), (cx + 0.053, cy - 0.009),
            (cx + 0.053, cy + 0.009), (cx - 0.053, cy + 0.009),
        ]))

    lips = body.modifiers.new("Soft cut edges", "BEVEL")
    lips.width = 0.007
    lips.segments = 3
    lips.limit_method = "ANGLE"
    lips.angle_limit = math.radians(35)
    lips.use_clamp_overlap = True
    apply(body, lips)
    for face in body.data.polygons:
        face.use_smooth = True
    normals = body.modifiers.new("Face normals", "WEIGHTED_NORMAL")
    normals.keep_sharp = True
    normals.weight = 50
    apply(body, normals)
    body.data.transform(Matrix.Rotation(math.pi / 2, 4, "X"))
    body.data.materials.clear()
    body.data.materials.append(resin_material())
    body["reference"] = "Single pink smiley puck from the supplied flower/smiley flip animation"
    body["front_axis"] = "-Y (Blender); +Z (glTF)"
    body["eye_openings"] = "Two rounded slots cut through the full thickness"
    body["mouth_opening"] = "Thin U-shaped through-cut with short terminal cheek marks"
    setup_studio(scene)
    activate(body)
    bpy.context.view_layer.update()
    report = inspect_mesh(body)
    report["mesh_objects"] = [o.name for o in scene.objects if o.type == "MESH"]
    bpy.ops.ed.undo_push(message="Smiley study")
    return report


def export_smiley(directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    body = bpy.data.objects[MODEL_NAME]
    activate(body)
    glb_path = str(directory / "smiley.glb")
    blend_path = str(directory / "smiley.blend")
    bpy.ops.export_scene.gltf(filepath=glb_path, export_format="GLB", use_selection=True, export_cameras=False, export_lights=False)
    bpy.ops.wm.save_as_mainfile(filepath=blend_path, compress=True)
    return {"blend": blend_path, "glb": glb_path}


if __name__ == "__main__":
    build_smiley()
    export_smiley(Path(__file__).resolve().parent / "assets")
