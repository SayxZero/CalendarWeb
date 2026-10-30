# "One service for all devices": a monitor with the site, a laptop with the
# planner and a phone, all with the same account, with their real recordings on
# the screens (.work/rec/screen-*.mp4, made by "rec devices"). A small satellite
# goes around them on one orbit. Loops without a seam.
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.join(os.environ.get('MEDIA_DIR') or os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'blender'))
import importlib
import common
importlib.reload(common)
from common import *  # noqa: E402,F403

FRAMES = 600

clear_scene()
scene = setup(1280, 800, FRAMES)
cam, aim = camera((0.7, -14.2, 1.0), (0.7, 0, 0.1), lens=50)
backdrop(cam, 40, image_material('sky', os.path.join(ART, 'backdrop.png')))
lights()

devices = [
    monitor_model((-2.05, 1.5, 0.75), (0, 0, math.radians(12)), 'screen-web.mp4'),
    laptop_model((1.05, -1.0, -0.55), (math.radians(14), 0, math.radians(-8)), 'screen-desk.mp4'),
    phone_model((3.72, -2.1, -0.08), (0, math.radians(-3), math.radians(-14)), 'screen-phone.mp4')[0],
]

# Each floats a little, each in its own time.
for index, device in enumerate(devices):
    wave(device, 'location', 2, 0.07, FRAMES, cycles=1, phase=index * 2.1)
    wave(device, 'rotation_euler', 2, math.radians(1.2), FRAMES, cycles=1, phase=index * 1.3)
    linear_fcurves(device)

orbit_with_satellite((0.6, -0.2, 0.3), (math.radians(13), math.radians(-9), 0), 6.2, FRAMES, emission('light blue', LIGHT_BLUE))

# The camera breathes: a little to the side and back.
wave(cam, 'location', 0, 0.45, FRAMES, cycles=1)
wave(cam, 'location', 2, 0.18, FRAMES, cycles=1, phase=1.5)
linear_fcurves(cam)

if wants_render():
    render_video('devices')
