# Shared by the scenes: everything is built by code, so that a new look or a new
# recording needs no saved .blend. Colours are flat (emission) wherever possible:
# the page has no gradients, and the videos should not bring them.
#
# Run by make.mjs:   blender -b --factory-startup -P devices.py -- --render
# Or in an open Blender (MCP, Text Editor): exec(open(path).read()) with MEDIA_DIR set.
import math
import os
import sys

import bpy

MEDIA = os.environ.get('MEDIA_DIR') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(MEDIA, 'art')
RAW = os.path.join(MEDIA, '.work', 'rec')
RENDER = os.path.join(MEDIA, '.work', 'render')

BLUE = '#1d77a8'
LIGHT_BLUE = '#7fbbe0'
DEEP = '#0d141c'
WHITE = '#f4f7fa'
METAL = '#2a3440'
METAL_LIGHT = '#3a4654'


def linear(value):
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def rgba(color):
    color = color.lstrip('#')
    return tuple(linear(int(color[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for collection in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights, bpy.data.curves, bpy.data.images):
        for item in list(collection):
            if item.users == 0:
                collection.remove(item)


def setup(width, height, frames, fps=30):
    scene = bpy.context.scene
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.fps = fps
    scene.frame_start = 1
    scene.frame_end = frames
    scene.frame_set(1)
    try:
        scene.render.engine = 'BLENDER_EEVEE'
    except TypeError as error:
        print(error)
    scene.eevee.taa_render_samples = 32
    # Exact colours: without this, Filmic turns #1d77a8 into something else.
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    world = bpy.data.worlds.new('space')
    world.use_nodes = True
    next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND').inputs[0].default_value = rgba(DEEP)
    scene.world = world
    return scene


def emission(name, color):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    light = nodes.new('ShaderNodeEmission')
    light.inputs[0].default_value = rgba(color)
    material.node_tree.links.new(light.outputs[0], out.inputs[0])
    return material


def solid(name, color, roughness=0.45, metallic=0.2):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = next(n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    shader.inputs['Base Color'].default_value = rgba(color)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metallic
    return material


def image_material(name, file, movie=False, frames=0):
    """A flat picture or a looping recording, exactly as it was recorded."""
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    light = nodes.new('ShaderNodeEmission')
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(file)
    tex.extension = 'CLIP'
    if movie:
        tex.image.source = 'MOVIE'
        tex.image_user.frame_duration = frames
        tex.image_user.frame_start = 1
        tex.image_user.frame_offset = 0
        tex.image_user.use_cyclic = True
        tex.image_user.use_auto_refresh = True
    links = material.node_tree.links
    links.new(tex.outputs['Color'], light.inputs[0])
    links.new(light.outputs[0], out.inputs[0])
    return material


def box(name, size, location=(0, 0, 0), material=None, bevel=0.0, parent=None, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        modifier = obj.modifiers.new('round', 'BEVEL')
        modifier.width = bevel
        modifier.segments = 8
        modifier.limit_method = 'ANGLE'
    if material:
        obj.data.materials.append(material)
    if parent:
        obj.parent = parent
    return obj


def plane(name, width, height, location=(0, 0, 0), material=None, parent=None, rotation=(math.pi / 2, 0, 0), corner=0.0):
    """Faces -Y by default, towards a camera standing in front of the scene."""
    bpy.ops.mesh.primitive_plane_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (width, height, 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if corner:
        modifier = obj.modifiers.new('round', 'BEVEL')
        modifier.affect = 'VERTICES'
        modifier.width = corner
        modifier.segments = 10
    if material:
        obj.data.materials.append(material)
    if parent:
        obj.parent = parent
    return obj


def ring(name, major, minor, material, location=(0, 0, 0), rotation=(0, 0, 0), parent=None, flatten=1.0):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=192, minor_segments=8,
                                     location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale[2] = flatten
    obj.data.materials.append(material)
    if parent:
        obj.parent = parent
    return obj


def empty(name, location=(0, 0, 0)):
    bpy.ops.object.empty_add(location=location)
    obj = bpy.context.object
    obj.name = name
    return obj


def camera(location, target, lens=50):
    bpy.ops.object.camera_add(location=location)
    cam = bpy.context.object
    cam.data.lens = lens
    aim = empty('aim', target)
    track = cam.constraints.new('TRACK_TO')
    track.target = aim
    track.track_axis = 'TRACK_NEGATIVE_Z'
    track.up_axis = 'UP_Y'
    bpy.context.scene.camera = cam
    return cam, aim


def backdrop(cam, distance, material):
    """The picture of the sky, fixed to the camera and filling its frame."""
    scene = bpy.context.scene
    aspect = scene.render.resolution_x / scene.render.resolution_y
    width = distance * cam.data.sensor_width / cam.data.lens
    height = width / aspect
    # the picture is 3:2, the frame is wider or narrower: cover it
    if width / height > 1.5:
        height = width / 1.5
    else:
        width = height * 1.5
    obj = plane('sky', width, height, location=(0, 0, -distance), material=material, rotation=(0, 0, 0))
    obj.parent = cam
    return obj


def wave(obj, path, index, amplitude, frames, cycles=1, phase=0.0):
    """A value going around and back to where it started: the video loops."""
    base = getattr(obj, path)[index]
    for frame in range(1, frames + 2, 5):
        value = base + amplitude * math.sin(2 * math.pi * cycles * (frame - 1) / frames + phase)
        getattr(obj, path)[index] = value
        obj.keyframe_insert(data_path=path, index=index, frame=frame)
    getattr(obj, path)[index] = base


def linear_fcurves(obj):
    if obj.animation_data and obj.animation_data.action:
        for curve in obj.animation_data.action.fcurves:
            for key in curve.keyframe_points:
                key.interpolation = 'LINEAR'


def clip_frames(file):
    clip = bpy.data.images.load(os.path.join(RAW, file))
    clip.source = 'MOVIE'
    count = clip.frame_duration
    bpy.data.images.remove(clip)
    return max(count, 1)


def screen_material(name, file):
    return image_material(name, os.path.join(RAW, file), movie=True, frames=clip_frames(file))


def lights():
    """Soft light for the bodies; the screens are emission and do not care."""
    bpy.ops.object.light_add(type='SUN', location=(4, -8, 8), rotation=(math.radians(55), 0, math.radians(20)))
    bpy.context.object.data.energy = 2.2
    bpy.ops.object.light_add(type='SUN', location=(-5, -6, 2), rotation=(math.radians(80), 0, math.radians(-40)))
    bpy.context.object.data.energy = 0.8


def monitor_model(location, rotation, file, width=4.6):
    body, edge = solid('monitor body', METAL), solid('monitor edge', METAL_LIGHT, roughness=0.35, metallic=0.5)
    root = empty('monitor', location)
    height = width * 800 / 1280
    box('monitor case', (width + 0.16, 0.12, height + 0.16), material=body, bevel=0.05, parent=root)
    plane('monitor screen', width, height, location=(0, -0.0605, 0), parent=root, material=screen_material('site', file))
    box('neck', (0.3, 0.1, 0.9), location=(0, 0.08, -height / 2 - 0.45), material=edge, parent=root)
    box('foot', (1.5, 0.7, 0.07), location=(0, 0.05, -height / 2 - 0.9), material=edge, bevel=0.03, parent=root)
    root.rotation_euler = rotation
    return root


def laptop_model(location, rotation, file, width=3.5):
    body, edge = solid('laptop body', METAL), solid('laptop edge', METAL_LIGHT, roughness=0.35, metallic=0.5)
    dark = emission('keys', '#0b1117')
    root = empty('laptop', location)
    k = width / 3.5
    height = width * 838 / 1440
    lid = empty('lid', (0, 0.72 * k, 0.03 * k))
    lid.parent = root
    lid.rotation_euler = (math.radians(-8), 0, 0)
    box('lid case', (width + 0.14, 0.06, height + 0.14), location=(0, 0, height / 2 + 0.07), material=body, bevel=0.03, parent=lid)
    plane('laptop screen', width, height, location=(0, -0.0305, height / 2 + 0.07), parent=lid, material=screen_material('planner', file))
    box('base', (width + 0.14, 1.5 * k, 0.07), material=edge, bevel=0.03, parent=root)
    box('keys', (width - 0.3, 0.72 * k, 0.01), location=(0, 0.18 * k, 0.038), material=dark, parent=root)
    box('pad', (0.9 * k, 0.42 * k, 0.006), location=(0, -0.47 * k, 0.037), material=body, parent=root)
    root.rotation_euler = rotation
    return root


def phone_model(location, rotation, file, height=2.5):
    """Returns the phone and the part of it that shakes, so that floating and vibrating do not fight."""
    body = solid('phone body', METAL)
    root = empty('phone', location)
    root.rotation_euler = rotation
    shaker = empty('shaker')
    shaker.parent = root
    width = height * 720 / 1600
    k = height / 2.5
    box('phone case', (width + 0.1 * k, 0.07 * k, height + 0.1 * k), material=body, bevel=0.035 * k, parent=shaker)
    plane('phone screen', width, height, location=(0, -0.0355 * k, 0), parent=shaker, corner=0.05 * k,
          material=screen_material('phone', file))
    return root, shaker


BUZZ_ON = 30     # frames of one buzz
BUZZ_OFF = 15    # frames of the pause after it
BUZZ_SWING = 10  # frames of one swing there and back


def bursts(start, stop):
    return [(begin, min(begin + BUZZ_ON, stop)) for begin in range(start, stop, BUZZ_ON + BUZZ_OFF)]


def vibrate(shaker, start, stop, degrees=3.5):
    """The buzz of a phone: it rocks around its own centre, in the plane of the screen."""
    def key(frame, angle):
        shaker.rotation_euler[1] = angle
        shaker.keyframe_insert(data_path='rotation_euler', index=1, frame=frame)
    key(1, 0)
    for begin, end in bursts(start, stop):
        key(begin, 0)
        for frame in range(begin + 1, end):
            # Eases in and out: a swing that starts at full tilt would look like a jerk.
            ease = min(1, (frame - begin) / 4, (begin + BUZZ_ON - frame) / 4)
            key(frame, math.radians(degrees) * ease * math.sin(2 * math.pi * (frame - begin) / BUZZ_SWING))
        key(end, 0)
    linear_fcurves(shaker)


def arc(name, radius, thickness, sweep, side, material, parent):
    """A flat arc with round ends around the origin, to the right of it or (side -1) to the left."""
    half = thickness / 2
    points = []
    def line(r, angles):
        points.extend((side * r * math.cos(a), 0, r * math.sin(a)) for a in angles)
    def cap(end, angles):
        center = (radius * math.cos(end), radius * math.sin(end))
        points.extend((side * (center[0] + half * math.cos(a)), 0, center[1] + half * math.sin(a)) for a in angles)
    steps = 32
    along = [-sweep + 2 * sweep * i / steps for i in range(steps + 1)]
    line(radius + half, along)
    cap(sweep, [sweep + math.pi * i / 8 for i in range(1, 8)])
    line(radius - half, reversed(along))
    cap(-sweep, [-sweep + math.pi + math.pi * i / 8 for i in range(1, 8)])
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(points, [], [list(range(len(points)))])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.data.materials.append(material)
    return obj


def fading_emission(name, color):
    """A flat colour with a strength from 0 to 1; returns the material and the input to animate."""
    material = emission(name, color)
    material.blend_method = 'BLEND'
    material.shadow_method = 'NONE'
    nodes = material.node_tree.nodes
    out = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL')
    light = next(n for n in nodes if n.type == 'EMISSION')
    mix = nodes.new('ShaderNodeMixShader')
    links = material.node_tree.links
    links.new(nodes.new('ShaderNodeBsdfTransparent').outputs[0], mix.inputs[1])
    links.new(light.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], out.inputs[0])
    return material, mix.inputs[0]


def vibration_lines(root, height, start, stop, color=LIGHT_BLUE):
    """Two arcs on each side of a ringing phone, the way a buzz is drawn. They hold
    still while the phone rocks, and only show during a buzz: inner first, then outer."""
    edge = height * 720 / 1600 / 2 + 0.05 * height / 2.5
    for side in (-1, 1):
        for index, (radius, sweep) in enumerate(((edge * 1.6, 32), (edge * 2.0, 37))):
            material, strength = fading_emission(f'buzz line {side} {index}', color)
            obj = arc(f'buzz line {side} {index}', radius, edge * 0.11, math.radians(sweep), side, material, root)
            def key(frame, value):
                strength.default_value = value
                strength.keyframe_insert(data_path='default_value', frame=frame)
            key(1, 0)
            for begin, end in bursts(start, stop):
                shown = begin + index * 5
                obj.scale = (0.93, 0.93, 0.93)
                obj.keyframe_insert(data_path='scale', frame=begin)
                obj.scale = (1.03, 1.03, 1.03)
                obj.keyframe_insert(data_path='scale', frame=end)
                key(shown, 0)
                if end == begin + BUZZ_ON:
                    key(shown + 4, 1)
                    key(end - 4, 1)
                elif end > shown + 4:
                    key(shown + 4, 1)
                    key(end - 1, 1)
                key(end, 0)
            linear_fcurves(obj)
            action = material.node_tree.animation_data.action
            for curve in action.fcurves:
                for point in curve.keyframe_points:
                    point.interpolation = 'LINEAR'


def orbit_with_satellite(location, rotation, radius, frames, material):
    system = empty('system', location)
    system.rotation_euler = rotation
    ring('orbit', radius, 0.012, material, parent=system)
    carrier = empty('carrier')
    carrier.parent = system
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=0.11, location=(radius, 0, 0))
    dot = bpy.context.object
    dot.name = 'satellite'
    dot.data.materials.append(material)
    dot.parent = carrier
    carrier.rotation_euler[2] = 0
    carrier.keyframe_insert(data_path='rotation_euler', index=2, frame=1)
    carrier.rotation_euler[2] = 2 * math.pi
    carrier.keyframe_insert(data_path='rotation_euler', index=2, frame=frames + 1)
    linear_fcurves(carrier)
    return system


def read_clip_info(name):
    import json
    with open(os.path.join(RAW, name + '.json'), encoding='utf-8') as file:
        return json.load(file)


def render_video(name):
    """Frames into a lossless-ish MP4 of .work/render; make.mjs cuts the final file."""
    scene = bpy.context.scene
    os.makedirs(RENDER, exist_ok=True)
    scene.render.filepath = os.path.join(RENDER, name + '.mp4')
    scene.render.image_settings.file_format = 'FFMPEG'
    scene.render.ffmpeg.format = 'MPEG4'
    scene.render.ffmpeg.codec = 'H264'
    scene.render.ffmpeg.constant_rate_factor = 'HIGH'
    scene.render.ffmpeg.ffmpeg_preset = 'GOOD'
    scene.render.use_file_extension = False
    bpy.ops.render.render(animation=True)


def wants_render():
    return '--render' in sys.argv
