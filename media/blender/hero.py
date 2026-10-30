# The top of the page: a planet with a ring, and sheets of a calendar going
# around it on a thin orbit, over the sky drawn by ChatGPT (art/backdrop.png).
# The middle of the frame stays empty for the title. Loops without a seam: the
# six sheets are alike, and each takes the place of the next in one loop.
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.join(os.environ.get('MEDIA_DIR') or os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'blender'))
import importlib
import common
importlib.reload(common)
from common import *  # noqa: E402,F403

FRAMES = 360
SHEETS = 6

clear_scene()
scene = setup(1600, 900, FRAMES)
cam, aim = camera((0, -20, 0), (0, 0, 0), lens=50)
backdrop(cam, 40, image_material('sky', os.path.join(ART, 'backdrop.png')))

blue = emission('blue', BLUE)
light_blue = emission('light blue', LIGHT_BLUE)
paper = emission('paper', WHITE)
header = emission('header', '#1f79c9')
cell = emission('cell', '#b9cad8')

# All of it leans, as in the picture for social networks: to the right of the
# title, which stands in the middle of the frame.
centre = empty('system', (5.45, 0, 0.75))
centre.rotation_euler = (math.radians(20), math.radians(-20), 0)

bpy.ops.mesh.primitive_uv_sphere_add(segments=128, ring_count=64, radius=1.38, location=centre.location)
planet = bpy.context.object
planet.name = 'planet'
planet.data.materials.append(blue)
bpy.ops.object.shade_smooth()

band = ring('ring', 2.15, 0.3, light_blue, parent=centre, flatten=0.03)
orbit = ring('orbit', 3.05, 0.012, light_blue, parent=centre)

# The sheets: their holder turns by a sixth of a circle in one loop.
spin = empty('spin')
spin.parent = centre
for i in range(SHEETS):
    angle = 2 * math.pi * i / SHEETS
    x, y = 3.05 * math.cos(angle), 3.05 * math.sin(angle)
    pivot = empty(f'sheet {i}', (x, y, 0))
    pivot.parent = spin
    # Standing up to the camera, whatever the lean of the system.
    constraint = pivot.constraints.new('COPY_ROTATION')
    constraint.target = cam
    pivot.scale = (0.82, 0.82, 0.82)
    plane(f'paper {i}', 0.74, 0.66, location=(0, 0, 0.12), material=paper, parent=pivot, rotation=(0, 0, 0), corner=0.05)
    plane(f'top {i}', 0.74, 0.17, location=(0, 0.245, 0.122), material=header, parent=pivot, rotation=(0, 0, 0))
    for row in range(3):
        for column in range(4):
            plane(f'cell {i} {row} {column}', 0.09, 0.08,
                  location=(-0.21 + column * 0.14, 0.09 - row * 0.13, 0.122), material=cell, parent=pivot, rotation=(0, 0, 0))
    for side in (-1, 1):
        plane(f'clip {i} {side}', 0.05, 0.12, location=(side * 0.17, 0.335, 0.124), material=paper, parent=pivot, rotation=(0, 0, 0))

spin.rotation_euler[2] = 0
spin.keyframe_insert(data_path='rotation_euler', index=2, frame=1)
spin.rotation_euler[2] = 2 * math.pi / SHEETS
spin.keyframe_insert(data_path='rotation_euler', index=2, frame=FRAMES + 1)
linear_fcurves(spin)

if wants_render():
    render_video('hero')
