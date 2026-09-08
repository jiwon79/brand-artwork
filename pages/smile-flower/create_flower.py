"""Create the five-petal reference study through Blender MCP or the Text Editor.

Petals are closed, curved shells with a shared handedness: one edge lifts above
the following petal. A six-lobed rosette is recessed into the solid center insert.
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
CENTER_LOBES = 6
RADIAL_STEPS = 24
ANGULAR_STEPS = 96
CORE_RADIAL_STEPS = 48
CORE_ANGULAR_STEPS = 192
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
    bsdf.inputs["Specular IOR Level"].default_value = 0.175
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


def core_surface(radius, angle):
    # One continuous molded face. Its six-lobed pocket has rounded shoulders
    # with a small circular boss rising above the engraved face.
    # Overlapping circular lobes keep the leaf ends round rather than star-like.
    boundaries = []
    for index in range(CENTER_LOBES):
        delta = angle - math.pi / 2 - index * math.tau / CENTER_LOBES
        discriminant = 0.039 ** 2 - (0.067 * math.sin(delta)) ** 2
        if discriminant >= 0 and math.cos(delta) > 0:
            boundaries.append(0.067 * math.cos(delta) + math.sqrt(discriminant))
    largest = max(boundaries)
    outline = largest + 0.004 * math.log(sum(math.exp((r - largest) / 0.004) for r in boundaries))
    shoulder = min(1, max(0, (1 - radius / outline) / 0.28))
    shoulder = shoulder * shoulder * (3 - 2 * shoulder)
    lobes = 0.8 + 0.2 * math.cos(CENTER_LOBES * (angle - math.pi / 2))
    well = 0.2 + 0.8 * (1 - math.exp(-(radius / 0.035) ** 2)) * lobes
    recess = 0.151 - 0.034 * shoulder * well
    boss_blend = min(1, max(0, (0.029 - radius) / 0.009))
    boss_blend = boss_blend * boss_blend * (3 - 2 * boss_blend)
    boss_top = 0.165 - 0.0015 * (min(radius, 0.020) / 0.020) ** 2
    return recess * (1 - boss_blend) + boss_top * boss_blend


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


def make_center_cup(rim_mat, inner_mat, boss_mat):
    # The buried bottom, cylindrical wall, pale lip and engraved colored face
    # belong to one closed mesh; there are no separate small petals or rings.
    profile = [(0, 0.065), (0.152, 0.065), (0.159, 0.070),
               (0.162, 0.082), (0.162, 0.151), (0.160, 0.157),
               (0.155, 0.162), (0.146, 0.162), (0.140, 0.157),
               (0.137, 0.151)]
    segments = CORE_ANGULAR_STEPS
    vertices, rings, faces, slots = [], [], [], []
    for radius, height in profile:
        ring = []
        for i in range(1 if radius == 0 else segments):
            angle = 2 * math.pi * i / segments
            ring.append(len(vertices))
            vertices.append((radius * math.cos(angle), radius * math.sin(angle), height))
        rings.append(ring)
    cap_radii = sorted({0.137 * step / CORE_RADIAL_STEPS for step in range(CORE_RADIAL_STEPS)}
                       | {0.020, 0.024, 0.029}, reverse=True)
    for radius in cap_radii:
        ring = []
        for i in range(1 if radius == 0 else segments):
            angle = math.tau * i / segments
            ring.append(len(vertices))
            vertices.append((radius * math.cos(angle), radius * math.sin(angle),
                             core_surface(radius, angle)))
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
            boss_face = section >= 9 and max(math.hypot(vertices[v][0], vertices[v][1])
                                             for v in faces[-1]) <= 0.020001
            slots.append(2 if boss_face else 1 if section >= 8 else 0)
    for index in range(CENTER_LOBES):
        angle = math.pi / 2 + index * math.tau / CENTER_LOBES
        assert core_surface(0.075, angle) < 0.125
        assert core_surface(0.09, angle + math.pi / CENTER_LOBES) == 0.151
    assert all(z >= 0.065 for _, _, z in vertices), "The engraving must retain a solid back"
    assert core_surface(0, 0) > 0.162, "The round boss must rise above the rim"
    return closed_mesh("Solid center with six recessed petals and a raised round boss", vertices, faces,
                       [rim_mat, inner_mat, boss_mat], slots)


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
        radius = 0.153 + (0.30 - 0.153) * step / 128
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
    # The detached terminal dot follows the same petal, with a visible gap.
    dot_start = len(vertices)
    dot_points = [(0, 0)] + [(0.0065 * math.cos(i * math.tau / 32),
                             0.0065 * math.sin(i * math.tau / 32)) for i in range(32)]
    for relief in (0.0006, -0.0015):
        for dx, dy in dot_points:
            x, y = 0.35 * c + dx, 0.35 * s + dy
            height, owner = project(x, y)
            assert owner == support, "The terminal dot must remain on its supporting petal"
            vertices.append((x, y, height + relief))
    for i in range(32):
        a, b = dot_start + 1 + i, dot_start + 1 + (i + 1) % 32
        faces.extend([(dot_start, a, b), (dot_start + 33, b + 33, a + 33),
                      (a, a + 33, b + 33, b)])
    obj = closed_mesh(f"Stamen {index + 1} line and terminal dot", vertices, faces, [mat])
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
    petal_mat = material("Flower · rose porcelain", linear_rgb("#e4aecb"), 0.72, 0)
    collar_mat = material("Flower · pale rim", linear_rgb("#eee4ea"), 0.78, 0)
    blue_mat = material("Flower · blue enamel", linear_rgb("#5486bb"), 0.72, 0)
    boss_mat = material("Flower · raised center", linear_rgb("#bfd0df"), 0.72, 0)
    stamen_mat = material("Flower · silver stamens", linear_rgb("#62576a"), 0.85, 0)
    parts = [make_petal(index, petal_mat, angle_offset=OUTER_PETAL_ANGLE) for index in range(PETAL_COUNT)]
    bpy.context.view_layer.update()
    project = petal_projector(parts)
    # The bottom stays inside the petals around the entire cup circumference.
    assert min(project(0.162 * math.cos(i * math.tau / 96),
                       0.162 * math.sin(i * math.tau / 96))[0] for i in range(96)) > 0.070
    parts.append(make_center_cup(collar_mat, blue_mat, boss_mat))
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
    flower.data.name = "Five outer petals and a six-lobed engraved center"
    flower.data.transform(Matrix.Rotation(math.pi / 2, 4, "X"))
    flower["petals"] = PETAL_COUNT
    flower["center_petals"] = CENTER_LOBES
    flower["center_structure"] = "Six-lobed recess with an integrated raised circular boss"
    flower["front_axis"] = "-Y (Blender); +Z (glTF)"
    flower["reference"] = "Five matte plastic petals, attached radial inlays and six recessed petals inside a pale cylindrical rim"
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
                             use_active_scene=True, export_cameras=False, export_lights=False)
    # Save a normal project with a startup scene and workspace, not a datablock
    # library. Copy mode retains the current project's path and other user scenes.
    bpy.ops.wm.save_as_mainfile(filepath=blend_path, compress=True, copy=True)
    return {"blend": blend_path, "glb": glb_path}


if __name__ == "__main__":
    build_flower()
    export_flower(Path(__file__).resolve().parent / "assets")
