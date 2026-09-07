"""Create the five-petal reference study through Blender MCP or the Text Editor.

Petals are closed, curved shells with a shared handedness: one edge lifts above
the following petal. A miniature five-petal blue flower is seated in a shallow, solid-backed cup.
The new scene preserves the existing smiley scene. glTF exports only the flower.
Front is -Y in Blender and +Z in glTF, matching smiley.glb.
"""
import math
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

SCENE_NAME = "Flower Study"
PETAL_COUNT = 5
RADIAL_STEPS = 24
ANGULAR_STEPS = 96
OUTER_PETAL_ANGLE = math.radians(8)


def linear_rgb(hex_color):
    srgb = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb)


def material(name, color, roughness, coat, metallic=0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["IOR"].default_value = 1.46
    bsdf.inputs["Coat Weight"].default_value = coat
    bsdf.inputs["Coat Roughness"].default_value = 0.5
    bsdf.inputs["Specular IOR Level"].default_value = 0.125
    mat.diffuse_color = (*color, 1)
    return mat


def activate(obj):
    for other in bpy.context.selected_objects:
        other.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def apply(obj, modifier):
    activate(obj)
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def petal_surface(u, v):
    # A nearly circular blade narrows gently at its hidden attachment point.
    x = 0.50 + 0.50 * u
    y = 0.475 * v * (0.94 + 0.06 * u) + 0.028 * (1 - u)
    # A shallow cup plus a tangential roll creates cyclic overlap without
    # assigning the five petals a visibly stepped stack of global heights.
    # Raise the outer cup while keeping its attachment below the center collar.
    bowl = (0.055 + 0.0325 * (u + 1)) * (u * u + v * v)
    z = 0.035 + bowl + 0.10 * v + 0.03 * u * v - 0.02 * u
    return x, y, z


def make_petal(index, mat, radial_steps=RADIAL_STEPS, angular_steps=ANGULAR_STEPS,
               surface=petal_surface, thickness=0.022, lip=0.008, angle_offset=0):
    angle = math.radians(90 - index * 72) + angle_offset
    c, s = math.cos(angle), math.sin(angle)

    def vertex(u, v):
        x, y, z = surface(u, v)
        return c * x - s * y, s * x + c * y, z

    vertices = [vertex(0, 0)]
    for ring in range(1, radial_steps + 1):
        radius = ring / radial_steps
        for segment in range(angular_steps):
            theta = 2 * math.pi * segment / angular_steps
            vertices.append(vertex(radius * math.cos(theta), radius * math.sin(theta)))
    faces = [(0, 1 + i, 1 + (i + 1) % angular_steps) for i in range(angular_steps)]
    for ring in range(radial_steps - 1):
        a, b = 1 + ring * angular_steps, 1 + (ring + 1) * angular_steps
        for i in range(angular_steps):
            j = (i + 1) % angular_steps
            faces.append((a + i, b + i, b + j, a + j))
    mesh = bpy.data.meshes.new(f"Petal {index + 1} shell")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(f"Petal {index + 1}", mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    shell = obj.modifiers.new("Petal thickness", "SOLIDIFY")
    shell.thickness = thickness
    shell.offset = -1
    apply(obj, shell)
    rim = obj.modifiers.new("Soft petal lip", "BEVEL")
    rim.width = lip
    rim.segments = 3
    rim.limit_method = "ANGLE"
    rim.angle_limit = math.radians(35)
    apply(obj, rim)
    return obj


def ellipsoid(name, location, scale, mat, segments=64, rings=32):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    return obj


def make_center_flower(petal_mat, heart_mat):
    def cup(u, v):
        # The core has five rounded cups, rather than scaled, twisted blades.
        return (0.063 + 0.073 * u, 0.066 * v,
                0.129 + 0.017 * (u * u + v * v) + 0.004 * u + 0.010 * v)

    parts = []
    for index in range(PETAL_COUNT):
        petal = make_petal(index, petal_mat, radial_steps=12, angular_steps=64,
                           surface=cup, thickness=0.006, lip=0.002)
        petal.name = f"Center petal {index + 1}"
        parts.append(petal)
    parts.append(ellipsoid("Center flower heart", (0, 0, 0.136),
                           (0.022, 0.022, 0.012), heart_mat))
    return parts


def closed_mesh(name, vertices, faces, materials, face_materials=None):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    for mat in materials:
        mesh.materials.append(mat)
    if face_materials:
        for polygon, slot in zip(mesh.polygons, face_materials):
            polygon.material_index = slot
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def make_center_cup(rim_mat, inner_mat):
    # A revolved closed section: buried bottom, outer wall, rounded lip, inner
    # wall and a solid floor. The small petals intersect the floor at their bases.
    profile = [(0, 0.065), (0.152, 0.065), (0.159, 0.070),
               (0.162, 0.082), (0.162, 0.151), (0.160, 0.157),
               (0.155, 0.162), (0.146, 0.162), (0.140, 0.157),
               (0.137, 0.148), (0.137, 0.126), (0, 0.126)]
    segments = 96
    vertices, rings, faces, slots = [], [], [], []
    for radius, height in profile:
        ring = []
        for i in range(1 if radius == 0 else segments):
            angle = 2 * math.pi * i / segments
            ring.append(len(vertices))
            vertices.append((radius * math.cos(angle), radius * math.sin(angle), height))
        rings.append(ring)
    for section, (first, second) in enumerate(zip(rings, rings[1:])):
        for i in range(segments):
            j = (i + 1) % segments
            if len(first) == 1:
                faces.append((first[0], second[j], second[i]))
            elif len(second) == 1:
                faces.append((first[i], first[j], second[0]))
            else:
                faces.append((first[i], first[j], second[j], second[i]))
            slots.append(1 if section >= 8 else 0)
    return closed_mesh("Center cup with seated floor", vertices, faces,
                       [rim_mat, inner_mat], slots)


def petal_projector(petals):
    vertices, faces, owners = [], [], []
    for owner, petal in enumerate(petals):
        offset = len(vertices)
        vertices.extend(petal.matrix_world @ v.co for v in petal.data.vertices)
        faces.extend(tuple(offset + i for i in p.vertices) for p in petal.data.polygons)
        owners.extend([owner] * len(petal.data.polygons))
    tree = BVHTree.FromPolygons(vertices, faces)

    def project(x, y):
        hit, _, face, _ = tree.ray_cast(Vector((x, y, 1)), Vector((0, 0, -1)), 2)
        assert hit is not None, "Every inlay point must have a supporting petal"
        return hit.z, owners[face]

    return project


def make_stamen(index, mat, project):
    # XY stays straight and depth follows the supporting petal. The outer
    # petals turn relative to these fixed spokes so no strip crosses a seam.
    angle = math.radians(90 - index * 72)
    c, s = math.cos(angle), math.sin(angle)
    rows, support = [], None
    for step in range(129):
        radius = 0.153 + (0.35 - 0.153) * step / 128
        row = []
        for offset in (-0.004, 0.004):
            x, y = radius * c - offset * s, radius * s + offset * c
            height, owner = project(x, y)
            if support is None:
                support = owner
            assert owner == support, "Adjust the outer petal angle: a stamen crosses a petal seam"
            row.append((x, y, height))
        rows.append(row)
    vertices, faces = [], []
    for row in rows:
        vertices.extend((x, y, z + 0.0006) for x, y, z in row)
        vertices.extend((x, y, z - 0.0015) for x, y, z in row)
    for i in range(len(rows) - 1):
        a, b = 4 * i, 4 * (i + 1)
        faces.extend([(a, a + 1, b + 1, b), (a + 2, b + 2, b + 3, a + 3),
                      (a, b, b + 2, a + 2), (a + 1, a + 3, b + 3, b + 1)])
    last = 4 * (len(rows) - 1)
    faces.extend([(0, 2, 3, 1), (last, last + 1, last + 3, last + 2)])
    obj = closed_mesh(f"Stamen {index + 1} surface inlay", vertices, faces, [mat])
    obj["surface_clearance"] = 0.0006
    obj["embedded_depth"] = 0.0015
    return obj


def look_at(obj):
    obj.rotation_euler = (-obj.location).to_track_quat("-Z", "Y").to_euler()


def setup_studio(scene):
    rig = bpy.data.collections.new("Flower Studio")
    scene.collection.children.link(rig)
    camera_data = bpy.data.cameras.new("Flower Camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 2.55
    camera = bpy.data.objects.new("Flower Camera", camera_data)
    rig.objects.link(camera)
    camera.location = (0, -10, 1.2)
    look_at(camera)
    scene.camera = camera
    for name, location, energy, size, color in (
        ("Flower key", (-3, -4, 5), 550, 3, (1, 0.93, 0.98)),
        ("Flower fill", (4, -2, 1), 110, 4, (0.85, 0.91, 1)),
        ("Flower rim", (1, 1.8, 3), 180, 3, (1, 0.8, 0.91)),
    ):
        data = bpy.data.lights.new(name, "AREA")
        data.energy, data.shape, data.size, data.color = energy, "DISK", size, color
        light = bpy.data.objects.new(name, data)
        rig.objects.link(light)
        light.location = location
        look_at(light)
    world = bpy.data.worlds.new("Flower black studio")
    world.use_nodes = True
    world.node_tree.nodes.get("Background").inputs["Color"].default_value = (0, 0, 0, 1)
    scene.world = world
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.render.resolution_x = scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = 0.35
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                space = area.spaces.active
                space.region_3d.view_location = (0, 0, 0)
                space.region_3d.view_rotation = camera.rotation_euler.to_quaternion()
                space.region_3d.view_distance = 3.0
                space.region_3d.view_perspective = "ORTHO"
                space.overlay.show_overlays = False
                space.shading.type = "MATERIAL"
                space.shading.use_scene_lights = True
                space.shading.use_scene_world = True


def build_flower():
    assert bpy.context.mode == "OBJECT", "Switch to Object Mode first."
    previous = bpy.data.scenes.get(SCENE_NAME)
    if previous:
        # Rebuild only the scene owned by this generator, never the smiley scene.
        assert previous.get("generator") == "create_flower.py", "Scene name belongs to user data"
    # Blender always needs one local scene, including in a standalone file.
    scene = bpy.data.scenes.new(SCENE_NAME + " replacement")
    bpy.context.window.scene = scene
    if previous:
        for obj in list(previous.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.scenes.remove(previous)
    scene.name = SCENE_NAME
    scene["generator"] = "create_flower.py"
    bpy.context.window.scene = scene
    petal_mat = material("Flower · rose porcelain", linear_rgb("#e4aecb"), 0.76, 0)
    collar_mat = material("Flower · pale rim", linear_rgb("#eee4ea"), 0.78, 0)
    blue_mat = material("Flower · blue enamel", linear_rgb("#5486bb"), 0.70, 0)
    heart_mat = material("Flower · ice blue heart", linear_rgb("#a6c4de"), 0.70, 0)
    stamen_mat = material("Flower · silver stamens", linear_rgb("#62576a"), 0.85, 0)
    parts = [make_petal(index, petal_mat, angle_offset=OUTER_PETAL_ANGLE) for index in range(PETAL_COUNT)]
    bpy.context.view_layer.update()
    project = petal_projector(parts)
    # The bottom stays inside the petals around the entire cup circumference.
    assert min(project(0.162 * math.cos(i * math.tau / 96),
                       0.162 * math.sin(i * math.tau / 96))[0] for i in range(96)) > 0.070
    parts.append(make_center_cup(collar_mat, blue_mat))
    center = make_center_flower(blue_mat, heart_mat)
    for part in center:
        bpy.context.view_layer.update()
        depths = [(part.matrix_world @ vertex.co).z for vertex in part.data.vertices]
        assert min(depths) < 0.126 and max(depths) <= 0.163, "Core must sit in the cup floor, below its lip"
    parts.extend(center)
    parts.extend(make_stamen(index, stamen_mat, project) for index in range(PETAL_COUNT))
    for obj in parts:
        for face in obj.data.polygons:
            face.use_smooth = True
    # Join without unioning: the petal overlaps must retain their individual lips.
    activate(parts[0])
    for part in parts:
        part.select_set(True)
    bpy.ops.object.join()
    flower = bpy.context.object
    flower.name = "Flower"
    flower.data.name = "Five outer petals and a miniature five-petal blue flower"
    flower.data.transform(Matrix.Rotation(math.pi / 2, 4, "X"))
    flower["petals"] = PETAL_COUNT
    flower["center_petals"] = PETAL_COUNT
    flower["front_axis"] = "-Y (Blender); +Z (glTF)"
    flower["reference"] = "Five overlapping pink petals, attached radial inlays and a small flower seated in a pale cup"
    setup_studio(scene)
    activate(flower)
    bpy.context.view_layer.update()
    mesh = bmesh.new()
    mesh.from_mesh(flower.data)
    report = {"vertices": len(mesh.verts), "faces": len(mesh.faces),
              "non_manifold_edges": sum(not edge.is_manifold for edge in mesh.edges),
              "loose_vertices": sum(not vertex.link_edges for vertex in mesh.verts),
              "volume": mesh.calc_volume(signed=True), "dimensions": list(flower.dimensions)}
    mesh.free()
    flower.data.calc_loop_triangles()
    report["triangles"] = len(flower.data.loop_triangles)
    assert report["non_manifold_edges"] == 0, report
    assert report["loose_vertices"] == 0 and report["volume"] > 0, report
    return report


def export_flower(directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    activate(bpy.context.scene.objects["Flower"])
    glb_path, blend_path = str(directory / "flower.glb"), str(directory / "flower.blend")
    bpy.ops.export_scene.gltf(filepath=glb_path, export_format="GLB", use_selection=True,
                             export_cameras=False, export_lights=False)
    # Save a normal project with a startup scene and workspace, not a datablock
    # library. Copy mode retains the current project's path and other user scenes.
    bpy.ops.wm.save_as_mainfile(filepath=blend_path, compress=True, copy=True)
    return {"blend": blend_path, "glb": glb_path}


if __name__ == "__main__":
    build_flower()
    export_flower(Path(__file__).resolve().parent / "assets")
