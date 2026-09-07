"""Create the five-petal reference study through Blender MCP or the Text Editor.

Petals are closed, curved shells with a shared handedness: one edge lifts above
the following petal. A miniature five-petal blue flower sits inside a pale collar.
The new scene preserves the existing smiley scene. glTF exports only the flower.
Front is -Y in Blender and +Z in glTF, matching smiley.glb.
"""
import math
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

SCENE_NAME = "Flower Study"
PETAL_COUNT = 5
RADIAL_STEPS = 24
ANGULAR_STEPS = 96


def material(name, color, roughness, coat, metallic=0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["IOR"].default_value = 1.46
    bsdf.inputs["Coat Weight"].default_value = coat
    bsdf.inputs["Coat Roughness"].default_value = 0.19
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
    z = 0.035 + 0.055 * (u * u + v * v) + 0.12 * v + 0.04 * u * v - 0.02 * u
    return x, y, z


def make_petal(index, mat, radial_steps=RADIAL_STEPS, angular_steps=ANGULAR_STEPS):
    angle = math.radians(90 - index * 72)
    c, s = math.cos(angle), math.sin(angle)

    def vertex(u, v):
        x, y, z = petal_surface(u, v)
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
    shell.thickness = 0.022
    shell.offset = -1
    apply(obj, shell)
    rim = obj.modifiers.new("Soft petal lip", "BEVEL")
    rim.width = 0.008
    rim.segments = 3
    rim.limit_method = "ANGLE"
    rim.angle_limit = math.radians(35)
    apply(obj, rim)
    return obj


def ellipsoid(name, location, scale, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    return obj


def make_center_flower(petal_mat, heart_mat):
    parts = []
    for index in range(PETAL_COUNT):
        petal = make_petal(index, petal_mat, radial_steps=12, angular_steps=64)
        petal.name = f"Center petal {index + 1}"
        # Keep five curled blades legible inside the collar. The added depth
        # separates the overlapping lips while retaining a shallow rosette.
        petal.scale = (0.14, 0.14, 0.22)
        petal.location.z = 0.135
        activate(petal)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        parts.append(petal)
    parts.append(ellipsoid("Center flower heart", (0, 0, 0.169),
                           (0.024, 0.024, 0.018), heart_mat))
    return parts


def make_stamen(index, mat):
    angle = math.radians(90 - index * 72 + 12)
    curve = bpy.data.curves.new(f"Stamen {index + 1}", "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 12
    curve.bevel_depth = 0.006
    curve.bevel_resolution = 3
    curve.use_fill_caps = True
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(2)
    for point, radius, offset, height in zip(
        spline.bezier_points, (0.16, 0.245, 0.34), (0, 0.02, 0.025), (0.108, 0.09, 0.075)
    ):
        point.co = (radius * math.cos(angle) - offset * math.sin(angle),
                    radius * math.sin(angle) + offset * math.cos(angle), height)
        point.handle_left_type = point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(curve.name, curve)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    activate(obj)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    # Curve conversion duplicates cap vertices; weld the coincident rings.
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    bmesh.ops.remove_doubles(mesh, verts=list(mesh.verts), dist=0.00001)
    bmesh.ops.recalc_face_normals(mesh, faces=list(mesh.faces))
    mesh.to_mesh(obj.data)
    mesh.free()
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
        for obj in list(previous.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.scenes.remove(previous)
    scene = bpy.data.scenes.new(SCENE_NAME)
    scene["generator"] = "create_flower.py"
    bpy.context.window.scene = scene
    petal_mat = material("Flower · rose porcelain", (0.88, 0.31, 0.57), 0.34, 0.20)
    collar_mat = material("Flower · pale rim", (0.82, 0.66, 0.78), 0.28, 0.25)
    blue_mat = material("Flower · blue enamel", (0.015, 0.14, 0.48), 0.16, 0.65, metallic=0.35)
    heart_mat = material("Flower · ice blue heart", (0.18, 0.49, 0.8), 0.21, 0.5, metallic=0.25)
    parts = [make_petal(index, petal_mat) for index in range(PETAL_COUNT)]
    bpy.ops.mesh.primitive_torus_add(major_radius=0.15, minor_radius=0.018,
                                  major_segments=96, minor_segments=16, location=(0, 0, 0.13))
    collar = bpy.context.object
    collar.name = "Center collar"
    collar.data.materials.append(collar_mat)
    parts.append(collar)
    parts.extend(make_center_flower(blue_mat, heart_mat))
    parts.extend(make_stamen(index, collar_mat) for index in range(PETAL_COUNT))
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
    flower["reference"] = "Five overlapping pink petals, pale collar and a miniature blue flower"
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
