// How raw takes and renders become the files of site/video. Only cutting and
// encoding: nothing here needs a device, so a new cut takes seconds.
import fs from 'node:fs';
import path from 'node:path';
import { RAW, RENDER, SITE, cfg, duration, ffmpeg, meta, run } from './lib.mjs';

const out = (name) => path.join(SITE, 'video', `${name}.mp4`);
const raw = (name) => path.join(RAW, name);

// Screens are flat colours and small text: a high CRF keeps the files small and still reads.
const encode = (crf = 27) => ['-an', '-c:v', 'libx264', '-preset', 'veryslow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];

// A phone take without the status and navigation bars of the system.
const phoneCrop = 'crop=720:1448:0:64';
const FPS = 30;

/** The end of a take stands still for a moment before the loop starts over. */
const hold = (seconds) => `tpad=stop_mode=clone:stop_duration=${seconds}`;

/** Seconds until the picture first changes after a moment: when the planner really reacted. */
function firstChange(file, after) {
  const result = run(cfg.ffmpeg, ['-hide_banner', '-ss', String(after), '-i', file, '-vf', "select='gt(scene,0.0015)',showinfo", '-frames:v', '1', '-f', 'null', '-'],
    { allowFail: true, stdio: ['ignore', 'pipe', 'pipe'], returnStderr: true });
  const found = result.match(/pts_time:([\d.]+)/);
  return found ? after + Number(found[1]) : after;
}

/**
 * The moment of the take when the alarm stands on the screen of the sleeping
 * phone. The lock screen flashes up first for a moment, and after the alarm
 * nothing on the screen moves: the last big change before the press is it.
 */
function phoneWakes(at, phoneStart, dismissed) {
  const first = firstChange(raw('alarm-phone.mp4'), (at - phoneStart) / 1000 - 1);
  const log = run(cfg.ffmpeg, ['-hide_banner', '-ss', String(first), '-to', String((dismissed - phoneStart) / 1000 - 0.8), '-i', raw('alarm-phone.mp4'),
    '-vf', "select='gt(scene,0.02)',showinfo", '-f', 'null', '-'], { allowFail: true, returnStderr: true });
  const changes = [...log.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
  return first + (changes.length ? changes[changes.length - 1] + 0.05 : 0);
}

/** A sleeping phone is black; scrcpy keeps showing the last picture of its lock screen. */
const asleepUntil = (moment) => `drawbox=color=black:t=fill:enable='lt(t,${moment})'`;

export const videos = {
  calendars() {
    ffmpeg('-i', raw('calendars.mp4'), '-vf', `fps=${FPS},${hold(1)}`, ...encode(), out('calendars'));
  },

  // Sped up a quarter: nothing here depends on the pace, and the page has seven of these.
  sharing() {
    const owner = raw('share-owner.mp4'), member = raw('share-member.mp4');
    const first = (duration(owner) - 0.6) / 1.25;
    ffmpeg('-i', owner, '-i', member, '-filter_complex',
      `[0:v]fps=${FPS},trim=start=0.6,setpts=(PTS-STARTPTS)/1.25[a];[1:v]fps=${FPS},trim=start=0.8,setpts=(PTS-STARTPTS)/1.25[b];` +
      `[a][b]xfade=transition=fade:duration=0.5:offset=${first - 0.6}[v]`, '-map', '[v]', ...encode(), out('sharing'));
  },

  devices() {
    ffmpeg('-i', path.join(RENDER, 'devices.mp4'), ...encode(25), out('devices'));
  },

  'task-check'() {
    const { start, opened } = meta.read('taskcheck');
    const tapped = (opened - start) / 1000;
    const end = tapped + 4;
    // The planner takes a moment to draw when it comes forward: that black is cut.
    const log = run(cfg.ffmpeg, ['-hide_banner', '-ss', String(tapped), '-i', raw('taskcheck.mp4'), '-vf', 'blackdetect=d=0.05:pix_th=0.12', '-an', '-f', 'null', '-'],
      { allowFail: true, returnStderr: true });
    const found = log.match(/black_start:([\d.]+) black_end:([\d.]+)/);
    const black = found ? [tapped + Number(found[1]), tapped + Number(found[2])] : [tapped + 1, tapped + 1];
    ffmpeg('-i', raw('taskcheck.mp4'), '-filter_complex',
      `[0:v]split[a][b];[a]trim=start=0.6:end=${black[0]},setpts=PTS-STARTPTS[x];[b]trim=start=${black[1]}:end=${end},setpts=PTS-STARTPTS[y];` +
      `[x][y]concat=n=2:v=1,${phoneCrop},scale=540:-2:flags=lanczos,${hold(0.5)}[v]`, '-map', '[v]', ...encode(), out('task-check'));
  },

  palette() {
    const { start, end } = meta.read('palette');
    ffmpeg('-i', raw('palette.mp4'), '-vf',
      `trim=start=0.5:end=${(end - start) / 1000},setpts=PTS-STARTPTS,${phoneCrop},scale=540:-2:flags=lanczos,${hold(1)}`, ...encode(), out('palette'));
  },

  // Without the ways through the file picker and back to the settings.
  melody() {
    const { start, end, cuts } = meta.read('melody');
    const edges = [0.5, ...cuts.flat().map((moment) => (moment - start) / 1000), (end - start) / 1000];
    const parts = [];
    for (let i = 0; i < edges.length; i += 2) parts.push([edges[i], edges[i + 1]]);
    ffmpeg('-i', raw('melody.mp4'), '-filter_complex',
      `[0:v]split=${parts.length}${parts.map((_, i) => `[s${i}]`).join('')};` +
      parts.map(([from, to], i) => `[s${i}]trim=start=${from}:end=${to},setpts=PTS-STARTPTS[p${i}]`).join(';') + ';' +
      `${parts.map((_, i) => `[p${i}]`).join('')}concat=n=${parts.length}:v=1,${phoneCrop},scale=540:-2:flags=lanczos,${hold(1)}[v]`,
      '-map', '[v]', ...encode(), out('melody'));
  },

  alarm() {
    ffmpeg('-i', path.join(RENDER, 'alarm.mp4'), ...encode(25), out('alarm'));
  },

  'same-alarms'() {
    ffmpeg('-i', path.join(RENDER, 'same-alarms.mp4'), ...encode(25), out('same-alarms'));
  },

  // The request is typed, the answer comes, the file goes into the planner.
  'ai-agent'() {
    const chat = raw('agent-chat.mp4'), site = raw('agent-import.mp4');
    const first = duration(chat);
    ffmpeg('-i', chat, '-i', site, '-filter_complex',
      `[0:v]fps=${FPS}[a];[1:v]fps=${FPS},trim=start=0.6,setpts=PTS-STARTPTS[b];` +
      `[a][b]xfade=transition=fade:duration=0.5:offset=${first - 0.5}[v]`, '-map', '[v]', ...encode(), out('ai-agent'));
  },

  hero() {
    ffmpeg('-i', path.join(RENDER, 'hero.mp4'), ...encode(24), out('hero'));
  },
};

// What the Blender scenes show on their screens, cut from the takes. A scene
// reads <name>.json beside its clips: how long it is and when what happens.
export const clips = {
  alarm() {
    const { at, phoneStart, dismissed } = meta.read('alarm');
    const wakes = phoneWakes(at, phoneStart, dismissed);
    const pressed = (dismissed - phoneStart) / 1000;
    const start = wakes - 2.5;
    const dark = pressed + 0.1;          // the finger lifts, the screen goes out
    const end = dark + 1.5;
    ffmpeg('-i', raw('alarm-phone.mp4'), '-vf',
      `${asleepUntil(wakes)},drawbox=color=black:t=fill:enable='gt(t,${dark})',trim=start=${start}:end=${end},setpts=PTS-STARTPTS`,
      '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', raw('clip-alarm.mp4'));
    meta.write('clip-alarm', {
      frames: Math.round((end - start) * FPS),
      wake: Math.round((wakes - start) * FPS),
      stop: Math.round((pressed - start) * FPS),
    });
  },

  // Both devices on one clock. The wait for the PC to hear about the phone is
  // cut: up to 20 seconds of a ringing window say nothing new.
  'same-alarms'() {
    const { at, phoneStart, deskStart, dismissed, ended } = meta.read('alarm');
    const wakes = phoneWakes(at, phoneStart, dismissed);
    const phoneOffset = (at - phoneStart) / 1000, deskOffset = (at - deskStart) / 1000;
    // Seconds on a common clock: zero is the moment the alarm should ring.
    const stopAt = (dismissed - at) / 1000, endAt = (ended - at) / 1000;
    const first = [-1.5, stopAt + 0.1];
    const second = [Math.max(first[1], endAt - 5), endAt];
    const part = (offset, [from, to]) => `trim=start=${from + offset}:end=${to + offset},setpts=PTS-STARTPTS`;
    const both = (input, offset, before, output) => ffmpeg('-i', input, '-filter_complex',
      `[0:v]fps=${FPS},${before}split[a][b];[a]${part(offset, first)}[x];[b]${part(offset, second)}[y];[x][y]concat=n=2:v=1[v]`,
      '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', output);
    both(raw('alarm-phone.mp4'), phoneOffset, `${asleepUntil(wakes)},`, raw('clip-same-phone.mp4'));
    both(raw('alarm-desk.mp4'), deskOffset, '', raw('clip-same-desk.mp4'));
    const lengthFirst = first[1] - first[0], lengthSecond = second[1] - second[0];
    meta.write('clip-same', {
      frames: Math.round((lengthFirst + lengthSecond) * FPS),
      wake: Math.round((wakes - phoneOffset - first[0]) * FPS),
      stop: Math.round((stopAt - first[0]) * FPS),
    });
  },
};
