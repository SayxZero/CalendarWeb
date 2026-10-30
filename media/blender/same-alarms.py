# One alarm on a laptop and on a phone: both ring, it is switched off on the
# phone, and the laptop goes quiet. The screens are the real takes on one clock
# (.work/rec/clip-same-*.mp4, the times in clip-same.json).
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.join(os.environ.get('MEDIA_DIR') or os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'blender'))
import importlib
import common
importlib.reload(common)
from common import *  # noqa: E402,F403

info = read_clip_info('clip-same')
FRAMES = info['frames']

clear_scene()
scene = setup(1280, 800, FRAMES)
cam, aim = camera((0.8, -12.3, 1.0), (0.8, 0, 0.15), lens=50)
backdrop(cam, 40, image_material('sky', os.path.join(ART, 'backdrop.png')))
lights()
light_blue = emission('light blue', LIGHT_BLUE)

laptop = laptop_model((-1.1, 0.2, -1.05), (math.radians(14), 0, math.radians(9)), 'clip-same-desk.mp4', width=4.7)
phone, shaker = phone_model((3.05, -1.1, 0.1), (math.radians(4), math.radians(-5), math.radians(-13)), 'clip-same-phone.mp4', height=3.2)
vibrate(shaker, info['wake'] - 15, info['stop'])
vibration_lines(phone, 3.2, info['wake'] - 15, info['stop'])

orbit_with_satellite((0.5, 0, 0.1), (math.radians(13), math.radians(-9), 0), 5.6, FRAMES, light_blue)

for index, device in enumerate((laptop, phone)):
    wave(device, 'location', 2, 0.05, FRAMES, cycles=1, phase=index * 2.1)
    linear_fcurves(device)
wave(cam, 'location', 0, 0.3, FRAMES, cycles=1)
linear_fcurves(cam)

if wants_render():
    render_video('same-alarms')
