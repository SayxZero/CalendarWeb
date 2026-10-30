# The alarm: a phone with its screen off, it starts to shake, the screen lights
# up with the real alarm, a finger switches it off (.work/rec/clip-alarm.mp4, the
# real take with its touch; the times are in clip-alarm.json).
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.join(os.environ.get('MEDIA_DIR') or os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'blender'))
import importlib
import common
importlib.reload(common)
from common import *  # noqa: E402,F403

info = read_clip_info('clip-alarm')
FRAMES = info['frames']

clear_scene()
scene = setup(1280, 800, FRAMES)
cam, aim = camera((0, -9.4, 0.5), (0, 0, 0), lens=50)
backdrop(cam, 40, image_material('sky', os.path.join(ART, 'backdrop.png')))
lights()

ROTATION = (math.radians(6), math.radians(-9), math.radians(-13))
root, shaker = phone_model((0, 0, 0), ROTATION, 'clip-alarm.mp4', height=3.0)
vibrate(shaker, info['wake'] - 15, info['stop'])
vibration_lines(root, 3.0, info['wake'] - 15, info['stop'])

# The camera comes a little closer as it rings.
cam.location = (-0.35, -9.8, 0.65)
cam.keyframe_insert(data_path='location', frame=1)
cam.location = (0.3, -8.9, 0.3)
cam.keyframe_insert(data_path='location', frame=FRAMES)
wave(root, 'location', 2, 0.03, FRAMES, cycles=1)
linear_fcurves(root)

if wants_render():
    render_video('alarm')
