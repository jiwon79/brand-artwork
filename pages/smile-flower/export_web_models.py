"""Export light web copies through Blender MCP, preserving the editable scenes.

The flower carries short-range ambient occlusion in COLOR_0. This preserves the
small contact shadows between petals when dozens of instances turn together.
"""
import math
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def activate(obj):
    for other in bpy.context.selected_objects:
        other.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def bake_contact_occlusion(obj):
    mesh = obj.data
    mesh.update()
    tree = BVHTree.FromPolygons([v.co for v in mesh.vertices],
                                [list(p.vertices) for p in mesh.polygons])
    colors = mesh.color_attributes.new(name="Contact occlusion", type="FLOAT_COLOR", domain="POINT")
    mesh.color_attributes.active_color = colors
    samples = 96
    shades = []
    for vertex in mesh.vertices:
        normal = vertex.normal.normalized()
        tangent = normal.cross(Vector((0, 0, 1)))
        if tangent.length < 0.01:
            tangent = normal.cross(Vector((0, 1, 0)))
        tangent.normalize()
        bitangent = normal.cross(tangent)
        origin = vertex.co + normal * 0.001
        blocked = 0.0
        for sample in range(samples):
            radial = math.sqrt((sample + 0.5) / samples)
            angle = sample * math.pi * (3 - math.sqrt(5))
            ray = tangent * (radial * math.cos(angle)) + bitangent * (radial * math.sin(angle)) + normal * math.sqrt(1 - radial * radial)
            hit, _, _, distance = tree.ray_cast(origin, ray, 0.35)
            if hit is not None:
                blocked += 1 - (distance / 0.35) ** 2
        shades.append(1 - 0.5 * blocked / samples)
    neighbors = [set() for _ in mesh.vertices]
    for edge in mesh.edges:
        a, b = edge.vertices
        neighbors[a].add(b)
        neighbors[b].add(a)
    for _ in range(3):
        shades = [0.5 * shades[i] + 0.5 * sum(shades[j] for j in adjacent) / len(adjacent)
                  if adjacent else shades[i] for i, adjacent in enumerate(neighbors)]
    for shade, color in zip(shades, colors.data):
        color.color = (shade, shade, shade, 1)


def procedural_flower(directory, collection):
    namespace = {"__name__": "flower_web_source"}
    source = directory.parent / "create_flower.py"
    exec(compile(source.read_text(), str(source), "exec"), namespace)
    make_petal = namespace["make_petal"]
    namespace["make_petal"] = lambda index, mat, **options: make_petal(
        index, mat, radial_steps=14, angular_steps=72,
        **{key: value for key, value in options.items() if key not in ("radial_steps", "angular_steps")})
    namespace["CORE_RADIAL_STEPS"] = 32
    namespace["CORE_ANGULAR_STEPS"] = 144
    namespace["SCENE_NAME"] = "Flower web export temporary"
    namespace["setup_studio"] = lambda scene: None
    previous_scene = bpy.context.window.scene
    try:
        namespace["build_flower"]()
        scene = bpy.context.scene
        obj = scene.objects["Flower"] if "Flower" in scene.objects else next(o for o in scene.objects if o.type == "MESH")
        collection.objects.link(obj)
        for previous_collection in list(obj.users_collection):
            if previous_collection != collection:
                previous_collection.objects.unlink(obj)
    finally:
        bpy.context.window.scene = previous_scene
        temporary = bpy.data.scenes.get(namespace["SCENE_NAME"])
        if temporary:
            bpy.data.scenes.remove(temporary)
    return obj


def export_web_models(directory):
    directory = Path(directory)
    assert bpy.context.mode == "OBJECT"
    previous_active = bpy.context.view_layer.objects.active
    previous_selected = list(bpy.context.selected_objects)
    collection = bpy.data.collections.new("Web export temporary")
    bpy.context.scene.collection.children.link(collection)
    reports = []
    imported = []
    original_materials = set(bpy.data.materials)
    original_meshes = set(bpy.data.meshes)
    original_curves = set(bpy.data.curves)
    original_libraries = set(bpy.data.libraries)
    try:
        for name, ratio in (("flower", 0.18), ("smiley", 0.6)):
            source_path = directory / (name + ".blend")
            object_name = "Flower" if name == "flower" else "Smiley"
            if name == "flower":
                obj = procedural_flower(directory, collection)
            elif Path(bpy.data.filepath).resolve() == source_path.resolve():
                obj = bpy.data.objects[object_name].copy()
                obj.data = obj.data.copy()
            else:
                with bpy.data.libraries.load(str(source_path), link=False) as (source, target):
                    target.objects = [object_name]
                obj = target.objects[0]
            imported.append(obj)
            if obj.name not in collection.objects:
                collection.objects.link(obj)
            activate(obj)
            if name == "flower":
                bake_contact_occlusion(obj)
            else:
                modifier = obj.modifiers.new("Web silhouette reduction", "DECIMATE")
                modifier.ratio = ratio
                modifier.use_collapse_triangulate = True
                bpy.ops.object.modifier_apply(modifier=modifier.name)
                normal = obj.modifiers.new("Flat face and rounded edges", "WEIGHTED_NORMAL")
                normal.keep_sharp = True
                normal.weight = 50
                bpy.ops.object.modifier_apply(modifier=normal.name)
            bpy.context.view_layer.update()
            obj.data.calc_loop_triangles()
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            report = {"model": name, "triangles": len(obj.data.loop_triangles),
                      "non_manifold_edges": sum(not e.is_manifold for e in bm.edges),
                      "volume": bm.calc_volume(signed=True)}
            bm.free()
            assert report["non_manifold_edges"] == 0 and report["volume"] > 0, report
            activate(obj)
            path = directory / (name + "-web.glb")
            bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True,
                                      use_active_scene=True, export_cameras=False, export_lights=False,
                                      export_vertex_color="ACTIVE", export_all_vertex_colors=False)
            report["bytes"] = path.stat().st_size
            reports.append(report)
    finally:
        for obj in imported:
            mesh = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if mesh.users == 0:
                bpy.data.meshes.remove(mesh)
        bpy.data.collections.remove(collection)
        for mat in set(bpy.data.materials) - original_materials:
            if mat.users == 0:
                bpy.data.materials.remove(mat)
        for mesh in set(bpy.data.meshes) - original_meshes:
            if mesh.users == 0:
                bpy.data.meshes.remove(mesh)
        for curve in set(bpy.data.curves) - original_curves:
            if curve.users == 0:
                bpy.data.curves.remove(curve)
        # Appending the export copy can leave a library reference behind that
        # prevents the editable source file from being saved on the next edit.
        linked_libraries = {item.library for item in bpy.data.user_map() if item.library}
        for library in set(bpy.data.libraries) - original_libraries:
            if library not in linked_libraries:
                bpy.data.libraries.remove(library)
        for obj in previous_selected:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = previous_active
    return reports


if __name__ == "__main__":
    export_web_models(Path(__file__).resolve().parent / "assets")
