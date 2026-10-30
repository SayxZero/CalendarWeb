// Makes the pictures and videos of the presentation page again, from sources
// kept here. See README.md. Usage:
//
//   node media/make.mjs                everything except new pictures
//   node media/make.mjs art [names]    pictures from prompts/ that are not in art/ yet
//   node media/make.mjs art --force hero
//   node media/make.mjs images         art/ -> site/img
//   node media/make.mjs rec [scenes]   raw takes (.work/rec); restarts the test server
//   node media/make.mjs touches names  draws the touches on phone takes again
//   node media/make.mjs blender [names]  renders (.work/render)
//   node media/make.mjs cut [videos]   takes and renders -> site/video
//   node media/make.mjs sheet [videos] contact sheets of site/video for a look
//   node media/make.mjs serve          the site before the test server, to look at it
//   node media/make.mjs clean          stops whatever is left, the phone back to normal
//
// Nothing here touches the real sync server: the test one has its own port and
// its data in .work/srv, and the phone works in a sandbox (--data-dir).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scenes } from './scenes.mjs';
import { clips, videos } from './videos.mjs';
import {
  MEDIA, RENDER, SITE, WORK, applyTouches, cfg, desk, duration, ensureTools, ffmpeg, freePorts, freshServers, log, phone, run, siteUrl,
} from './lib.mjs';

// ---------------------------------------------------------------- pictures

function codexPicture(name) {
  const prompt = fs.readFileSync(path.join(MEDIA, 'prompts', `${name}.txt`), 'utf8');
  const started = Date.now();
  log(`codex: ${name}`);
  run('cmd', ['/c', 'codex', 'exec', '--skip-git-repo-check', '-m', cfg.codexModel, '--json', prompt.replaceAll('\n', ' ')],
    { input: '', cwd: WORK, timeout: 300000 });
  const base = path.join(os.homedir(), '.codex/generated_images');
  const found = [];
  for (const dir of fs.readdirSync(base)) {
    for (const file of fs.readdirSync(path.join(base, dir))) {
      const full = path.join(base, dir, file);
      if (fs.statSync(full).mtimeMs >= started) found.push(full);
    }
  }
  if (!found.length) throw new Error(`codex drew nothing for ${name}`);
  found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  fs.copyFileSync(found[0], path.join(MEDIA, 'art', `${name}.png`));
}

function stageArt(names, force) {
  const all = fs.readdirSync(path.join(MEDIA, 'prompts')).map((f) => f.replace(/\.txt$/, ''));
  for (const name of names.length ? names : all) {
    if (force || !fs.existsSync(path.join(MEDIA, 'art', `${name}.png`))) codexPicture(name);
  }
}

function stageImages() {
  const art = (name) => path.join(MEDIA, 'art', `${name}.png`);
  const img = path.join(SITE, 'img');
  fs.mkdirSync(path.join(img, 'icons'), { recursive: true });
  fs.mkdirSync(path.join(img, 'space'), { recursive: true });
  // The lower block of the page: the horizon of a planet.
  ffmpeg('-i', art('horizon'), '-q:v', '3', path.join(img, 'space/horizon.jpg'));
  // Three icons drawn on one sheet on a flat green: cut, freed of the green, made square.
  const icons = { android: [100, 255, 290, 490], web: [525, 300, 465, 400], desktop: [1045, 295, 455, 440] };
  for (const [name, [x, y, w, h]] of Object.entries(icons)) {
    const side = Math.max(w, h);
    ffmpeg('-i', art('platforms'), '-vf',
      `crop=${w}:${h}:${x}:${y},colorkey=0x00ff00:0.3:0.12,despill=type=green,format=rgba,` +
      `pad=${side}:${side}:(ow-iw)/2:(oh-ih)/2:color=0x00000000,scale=160:160:flags=lanczos`,
      path.join(img, 'icons', `${name}.png`));
  }
  // The preview in social networks.
  const font = (file) => `C\\:/Windows/Fonts/${file}`;
  ffmpeg('-i', art('og'), '-vf',
    'crop=1536:806:0:109,scale=1200:630:flags=lanczos,' +
    `drawtext=fontfile='${font('segoeuib.ttf')}':text='Космос календарь':fontcolor=white:fontsize=54:x=64:y=256,` +
    `drawtext=fontfile='${font('segoeui.ttf')}':text='Приведите дела в порядок':fontcolor=0xb9d8ec:fontsize=30:x=66:y=328`,
    path.join(img, 'og.png'));
  log('images done');
}

// ---------------------------------------------------------------- stages

async function stageRec(names) {
  ensureTools();
  const context = { };
  try {
    for (const name of names.length ? names : Object.keys(scenes)) {
      if (!scenes[name]) throw new Error(`no scene ${name}: ${Object.keys(scenes).join(', ')}`);
      log(`scene ${name}`);
      await scenes[name](context);
    }
  } finally {
    await stageClean();
  }
}

async function stageClean() {
  desk.stop();
  freePorts();
  if (phone.shell('pm', 'path', 'org.calendarplanner.app')) phone.back();
  log('test servers stopped, the phone is back to normal');
}

function stageBlender(names) {
  fs.mkdirSync(RENDER, { recursive: true });
  const all = ['devices', 'hero', 'alarm', 'same-alarms'];
  for (const name of names.length ? names : all) {
    log(`blender: ${name}`);
    clips[name]?.();
    run(cfg.blender, ['-b', '--factory-startup', '-P', path.join(MEDIA, 'blender', `${name}.py`), '--', '--render'],
      { env: { ...process.env, MEDIA_DIR: MEDIA }, timeout: 3 * 3600 * 1000 });
  }
}

function stageCut(names) {
  fs.mkdirSync(path.join(SITE, 'video'), { recursive: true });
  for (const name of names.length ? names : Object.keys(videos)) {
    if (!videos[name]) throw new Error(`no video ${name}: ${Object.keys(videos).join(', ')}`);
    log(`cut ${name}`);
    videos[name]();
    const file = path.join(SITE, 'video', `${name}.mp4`);
    const size = fs.statSync(file).size / 1048576;
    log(`  ${size.toFixed(2)} MB, ${duration(file).toFixed(1)} s`);
    // the poster: a frame from the middle
    ffmpeg('-ss', String(duration(file) * 0.55), '-i', file, '-frames:v', '1', '-q:v', '4', path.join(SITE, 'video', `${name}.jpg`));
  }
}

function stageSheet(names) {
  fs.mkdirSync(path.join(WORK, 'sheets'), { recursive: true });
  for (const name of names.length ? names : Object.keys(videos)) {
    const file = path.join(SITE, 'video', `${name}.mp4`);
    ffmpeg('-i', file, '-vf', `fps=12/${duration(file)},scale=320:-2,tile=4x3`, '-frames:v', '1', path.join(WORK, 'sheets', `${name}.png`));
    log(path.join(WORK, 'sheets', `${name}.png`));
  }
}

async function main() {
  const [stage, ...rest] = process.argv.slice(2);
  const force = rest.includes('--force');
  const names = rest.filter((a) => !a.startsWith('--'));
  switch (stage) {
    case 'art': stageArt(names, force); break;
    case 'images': stageImages(); break;
    case 'rec': await stageRec(names); break;
    case 'touches': for (const name of names) applyTouches(name); break;
    case 'blender': stageBlender(names); break;
    case 'cut': stageCut(names); break;
    case 'sheet': stageSheet(names); break;
    case 'serve':
      ensureTools();
      await freshServers();
      log(`${siteUrl}/  (node media/make.mjs clean to stop)`);
      break;
    case 'clean': await stageClean(); break;
    case undefined:
      stageImages(); await stageRec([]); stageBlender([]); stageCut([]);
      break;
    default: throw new Error(`unknown stage ${stage}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
