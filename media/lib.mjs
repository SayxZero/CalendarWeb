// Shared by make.mjs, scenes.mjs and videos.mjs: where things are, how to run
// them, the test servers and the sandboxes of the planner.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MEDIA = path.dirname(fileURLToPath(import.meta.url));
export const WEB = path.dirname(MEDIA);
export const ROOT = path.dirname(WEB);
export const WORK = path.join(MEDIA, '.work');
export const RAW = path.join(WORK, 'rec');
export const RENDER = path.join(WORK, 'render');
export const SITE = path.join(WEB, 'site');

const env = process.env;
export const cfg = {
  ffmpeg: env.MEDIA_FFMPEG || 'D:/ffmpeg/bin/ffmpeg.exe',
  ffprobe: env.MEDIA_FFPROBE || 'D:/ffmpeg/bin/ffprobe.exe',
  adb: env.MEDIA_ADB || 'D:/Android/SDK/platform-tools/adb.exe',
  blender: env.MEDIA_BLENDER || 'D:/Blender/blender.exe',
  qt: env.MEDIA_QT || 'D:/Qt/6.5.3/mingw_64',
  qtTools: env.MEDIA_QT_TOOLS || 'D:/Qt/Tools',
  csc: env.MEDIA_CSC || 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',
  scrcpy: env.MEDIA_SCRCPY || path.join(WORK, 'scrcpy/scrcpy-win64-v5.0.1/scrcpy.exe'),
  server: env.MEDIA_SERVER || path.join(ROOT, 'CalendarServer/build/CalendarServer.exe'),
  planner: env.MEDIA_PLANNER || path.join(ROOT, 'Calendar/release/CalendarPlanner.exe'),
  serverPort: Number(env.MEDIA_SERVER_PORT || 8771),
  sitePort: Number(env.MEDIA_SITE_PORT || 8782),
  codexModel: env.MEDIA_CODEX_MODEL || 'gpt-6-luna',
};
export const serverAddress = `127.0.0.1:${cfg.serverPort}`;
export const siteUrl = `http://127.0.0.1:${cfg.sitePort}`;
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const log = (...args) => console.log(new Date().toTimeString().slice(0, 8), ...args);
const win = (p) => p.replaceAll('/', '\\');

export function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFail) {
    throw new Error(`${path.basename(cmd)} ${args.slice(0, 4).join(' ')}: ${result.status}\n${(result.stderr || '').slice(-1500)}`);
  }
  return (options.returnStderr ? result.stderr : result.stdout) || '';
}

function background(cmd, args, options = {}) {
  return spawn(cmd, args, { stdio: 'ignore', ...options });
}

export const ffmpeg = (...args) => run(cfg.ffmpeg, ['-v', 'error', '-y', ...args]);
export function duration(file) {
  return Number(run(cfg.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).trim());
}

// ---------------------------------------------------------------- helpers

const qtEnv = () => ({ ...process.env, PATH: `${path.join(cfg.qt, 'bin')};${path.join(cfg.qtTools, 'mingw1120_64/bin')};${process.env.PATH}` });

export function ensureTools() {
  fs.mkdirSync(RAW, { recursive: true });
  const wdrive = path.join(WORK, 'wdrive.exe');
  const source = path.join(MEDIA, 'tools/wdrive.cs');
  if (!fs.existsSync(wdrive) || fs.statSync(wdrive).mtimeMs < fs.statSync(source).mtimeMs) {
    run(cfg.csc, ['-nologo', '-optimize', '-r:System.Drawing.dll', `-out:${win(wdrive)}`, win(source)]);
  }
  const seed = path.join(WORK, 'seed-build/seed-account.exe');
  if (!fs.existsSync(seed)) {
    const cmake = path.join(cfg.qtTools, 'CMake_64/bin/cmake.exe');
    const build = path.join(WORK, 'seed-build');
    const environment = { ...qtEnv(), PATH: `${path.join(cfg.qtTools, 'Ninja')};${qtEnv().PATH}` };
    run(cmake, ['-S', path.join(WEB, 'tools/planner-sandbox'), '-B', build, '-G', 'Ninja', `-DCMAKE_PREFIX_PATH=${cfg.qt}`], { env: environment });
    run(cmake, ['--build', build], { env: environment });
  }
  if (!fs.existsSync(cfg.scrcpy)) {
    log(`no scrcpy at ${cfg.scrcpy}: phone scenes will fail, see README.md`);
  }
}

export const wdrivePath = () => path.join(WORK, 'wdrive.exe');

/** Runs a wdrive script given as text. */
export function wdrive(name, text, { wait = true } = {}) {
  const file = path.join(WORK, `${name}.wdrive.txt`);
  fs.writeFileSync(file, text);
  if (wait) return run(wdrivePath(), ['run', file]);
  return spawn(wdrivePath(), ['run', file], { stdio: 'ignore' });
}

/** Runs a browser script (tools/cdp.mjs) given as text. */
export function browser(name, text) {
  const file = path.join(WORK, `${name}.cdp.txt`);
  fs.writeFileSync(file, text);
  const out = run(process.execPath, [path.join(MEDIA, 'tools/cdp.mjs'), file, '9333'],
    { env: { ...process.env, MEDIA_FFMPEG: cfg.ffmpeg } });
  for (const line of out.split('\n')) if (/no text|no element|recorded/.test(line)) log(line.trim());
  return out;
}

// ---------------------------------------------------------------- test accounts

let serverProcess = null, siteProcess = null;
export const password = () => {
  const file = path.join(WORK, 'test-password.txt');
  if (!fs.existsSync(file)) fs.writeFileSync(file, `Media-${Math.random().toString(36).slice(2)}${Date.now() % 100000}`);
  return fs.readFileSync(file, 'utf8');
};

async function api(route, body, token) {
  const response = await fetch(`http://${serverAddress}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${route}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

export async function register(login, displayName) {
  const data = await api('/api/register', { login, password: password(), displayName, device: 'media' });
  return { login, token: data.token, id: String(data.user?.id ?? data.id ?? '') };
}

export async function recordsOn(token) {
  return (await api('/api/sync', { since: 0, device: 'media', changes: [] }, token)).changes?.length || 0;
}

export function freePorts() {
  // only what this tool started earlier: both listen on its own ports
  const out = run('netstat', ['-ano'], { allowFail: true });
  for (const line of out.split('\n')) {
    const m = line.match(/127\.0\.0\.1:(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
    if (m && [cfg.serverPort, cfg.sitePort].includes(Number(m[1]))) {
      run('taskkill', ['/PID', m[2], '/F'], { allowFail: true });
    }
  }
}

/** The test server with an empty base, the site in front of it. */
export async function freshServers() {
  freePorts();
  await sleep(500);
  try {
    fs.rmSync(path.join(WORK, 'desk'), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch { /* someone's current folder: old sandboxes stay until the next time */ }
  const data = path.join(WORK, 'srv');
  fs.rmSync(data, { recursive: true, force: true });
  fs.mkdirSync(data, { recursive: true });
  serverProcess = background(cfg.server, ['-p', String(cfg.serverPort), '--host', '127.0.0.1', '-d', data], { env: qtEnv(), detached: true });
  serverProcess.unref();
  const webServer = path.join(WORK, 'webbin/CalendarWebServer.exe');
  const sources = path.join(ROOT, 'CalendarWebServer/src/CalendarWebServer');
  const stale = () => !fs.existsSync(webServer) || fs.readdirSync(sources).some((f) => f.endsWith('.cs')
    && fs.statSync(path.join(sources, f)).mtimeMs > fs.statSync(webServer).mtimeMs);
  if (stale()) {
    run('dotnet', ['build', path.join(ROOT, 'CalendarWebServer/src/CalendarWebServer/CalendarWebServer.csproj'),
      '-c', 'Release', '-v', 'quiet', '-nologo', '-o', path.join(WORK, 'webbin')], { env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' } });
  }
  fs.mkdirSync(path.join(WORK, 'site-data'), { recursive: true });
  // The card of Android on the page wants a file. This one is the test build, for this site only.
  const version = (fs.readFileSync(path.join(ROOT, 'Calendar/CMakeLists.txt'), 'utf8').match(/VERSION (\d+\.\d+\.\d+)/g) || []).pop()?.split(' ')[1];
  const apk = path.join(ROOT, 'Calendar/release/CalendarPlanner-signed.apk');
  const target = path.join(WORK, 'site-data', `CosmosCalendar-${version}.apk`);
  if (version && fs.existsSync(apk) && !fs.existsSync(target)) fs.copyFileSync(apk, target);
  siteProcess = background(webServer, ['--host', '127.0.0.1', '-p', String(cfg.sitePort), '-u', serverAddress,
    '-w', SITE, '-d', path.join(WORK, 'site-data')], { detached: true });
  siteProcess.unref();
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://${serverAddress}/api/ping`)).ok && (await fetch(`${siteUrl}/app/`)).ok) return;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('the test servers did not start');
}

// ---------------------------------------------------------------- sandboxes

const iniCommon = (taskCheck) => `
[ui]
paletteId=sky

[taskCheck]
mode=${taskCheck?.mode ?? 0}
intervalMinutes=15
daytimeOnly=false
sound=false
${taskCheck?.reset ? `reset=${taskCheck.reset}\nlast=${taskCheck.reset}\n` : ''}
[alarm]
melody=none
`;

function seedSandbox(folder, account, taskCheck) {
  fs.rmSync(folder, { recursive: true, force: true, maxRetries: 20, retryDelay: 300 });
  fs.mkdirSync(folder, { recursive: true });
  run(path.join(WORK, 'seed-build/seed-account.exe'), [folder, serverAddress, account.login, account.token, account.id], { env: qtEnv() });
  fs.appendFileSync(path.join(folder, 'settings.ini'), iniCommon(taskCheck));
}

let deskProcess = null;
export const desk = {
  /** The planner on this PC, window at a known place, no sound: 125 %, so that it reads in a small video. */
  async start(account, { demo = false, taskCheck } = {}) {
    desk.stop();
    // A new folder each time: Windows may hold the old one a moment after the process is gone.
    const folder = path.join(WORK, 'desk', `${account.login}-${Date.now()}`);
    seedSandbox(folder, account, taskCheck);
    deskProcess = background(cfg.planner, ['--data-dir', folder, ...(demo ? ['--demo'] : [])],
      { env: { ...process.env, QT_SCALE_FACTOR: '1.25' }, detached: true });
    deskProcess.unref();
    await sleep(4000);
    wdrive('place', `pid ${deskProcess.pid}\nwaitwin\nplace 73 10 1454 845\n`);
    await sleep(1200);
    return deskProcess.pid;
  },
  stop() {
    if (deskProcess) run('taskkill', ['/PID', String(deskProcess.pid), '/F'], { allowFail: true });
    deskProcess = null;
  },
  get pid() { return deskProcess?.pid; },
};

const SANDBOX = '/sdcard/Android/data/org.calendarplanner.app/files/testdb';
const APP = 'org.calendarplanner.app/org.qtproject.qt.android.bindings.QtActivity';
const adbEnv = { ...process.env, MSYS_NO_PATHCONV: '1' };
const adb = (...args) => run(cfg.adb, args, { env: adbEnv, allowFail: true });

let touches = [];

/** A touch as it looks on a take: it appears, grows a little and fades. */
function touchAssets() {
  const clip = path.join(WORK, 'touch.mov'), dot = path.join(WORK, 'touch-dot.png');
  if (fs.existsSync(clip) && fs.existsSync(dot)) return { clip, dot };
  // A blue fill for light screens, a white rim for dark ones and for blue buttons.
  const look = (radius, fade) => {
    const rim = `gt(hypot(X-65,Y-65),(${radius})-5)`;
    return `format=rgba,geq=r='if(${rim},255,90)':g='if(${rim},255,170)':b='if(${rim},255,216)':a='clip((${radius})-hypot(X-65,Y-65),0,1)*(${fade})*if(${rim},245,170)'`;
  };
  ffmpeg('-f', 'lavfi', '-i', 'color=c=black@0:s=130x130:r=30:d=0.5', '-vf', look('34+24*T/0.5', '1-T/0.5'), '-c:v', 'png', clip);
  ffmpeg('-f', 'lavfi', '-i', 'color=c=black@0:s=130x130:r=30:d=0.04', '-vf', look('34', '1'), '-frames:v', '1', '-update', '1', dot);
  return { clip, dot };
}

/** <name>.raw.mp4 and its noted touches -> <name>.mp4, 30 frames a second, exactly as long as the take. */
export function applyTouches(name) {
  const { start, seconds, touches: list } = JSON.parse(fs.readFileSync(path.join(RAW, `${name}.touches.json`), 'utf8'));
  const { clip, dot } = touchAssets();
  const inputs = ['-i', path.join(RAW, `${name}.raw.mp4`)];
  // Asleep or standing still, the phone sends no frames: the picture is held to the end.
  const chain = [`[0:v]fps=30,tpad=stop_mode=clone:stop_duration=${Math.ceil(seconds) + 5},trim=duration=${seconds}[b0]`];
  list.forEach((touch, i) => {
    const at = Math.max(0, (touch.at - start) / 1000).toFixed(3);
    const n = i + 1;
    if (touch.x2 === undefined) {
      inputs.push('-i', clip);
      chain.push(`[${n}:v]setpts=PTS+${at}/TB[t${n}];[b${i}][t${n}]overlay=x=${touch.x - 65}:y=${touch.y - 65}:eof_action=pass[b${n}]`);
    } else {
      const d = (touch.ms / 1000).toFixed(3);
      inputs.push('-loop', '1', '-i', dot);
      const along = (from, to) => `${from - 65}+(${to - from})*(t-${at})/${d}`;
      chain.push(`[b${i}][${n}:v]overlay=x='${along(touch.x, touch.x2)}':y='${along(touch.y, touch.y2)}':enable='between(t,${at},${at}+${d})':shortest=1[b${n}]`);
    }
  });
  ffmpeg(...inputs, '-filter_complex', chain.join(';'), '-map', `[b${list.length}]`, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p',
    path.join(RAW, `${name}.mp4`));
}

export const phone = {
  shell: (...args) => adb('shell', ...args),
  push: (from, to) => adb('push', from, to),
  // The system draws no finger in a recording: every touch is noted, and
  // applyTouches() puts it on the take.
  tap(x, y) {
    const result = adb('shell', 'input', 'tap', String(x), String(y));
    touches.push({ at: Date.now() - 60, x, y });
    return result;
  },
  swipe(x1, y1, x2, y2, ms) {
    const began = Date.now();
    const result = adb('shell', 'input', 'swipe', String(x1), String(y1), String(x2), String(y2), String(ms));
    touches.push({ at: Math.max(began, Date.now() - ms - 60), x: x1, y: y1, x2, y2, ms });
    return result;
  },
  /** Back to the sandbox: never through recents, which start the planner without its argument. */
  front: () => adb('shell', `am start -n ${APP} -e applicationArguments '--data-dir ${SANDBOX}'`),
  async start(account, { taskCheck } = {}) {
    adb('wait-for-device');
    adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
    await sleep(800);
    // HOME first: a force-stopped planner in front is restarted by the system with no arguments
    adb('shell', 'am', 'force-stop', 'org.calendarplanner.app');
    adb('shell', 'rm', '-rf', SANDBOX);
    adb('shell', 'mkdir', '-p', SANDBOX);
    const folder = path.join(WORK, 'phone-seed');
    seedSandbox(folder, account, taskCheck);
    adb('push', path.join(folder, 'settings.ini'), `${SANDBOX}/settings.ini`);
    adb('reverse', `tcp:${cfg.serverPort}`, `tcp:${cfg.serverPort}`);
    adb('reverse', `tcp:${cfg.sitePort}`, `tcp:${cfg.sitePort}`);
    phone.front();
    await sleep(7000);
  },
  /**
   * A take of a known length. scrcpy finishes its file only by itself: killed
   * from outside it loses the last seconds, so it gets a limit, and whatever
   * is longer than needed is cut later.
   */
  record(name, seconds) {
    const file = path.join(RAW, `${name}.raw.mp4`);
    for (const old of [file, path.join(RAW, `${name}.mp4`)]) {
      try {
        fs.rmSync(old, { force: true, maxRetries: 5, retryDelay: 300 });
      } catch (error) {
        throw new Error(`${old} is held by another program: close the Blender scene that shows it (${error.code})`);
      }
    }
    touches = [];
    const child = spawn(cfg.scrcpy, ['--no-window', '--no-audio', '--no-control', '--video-bit-rate=10M',
      '--max-fps=30', `--time-limit=${Math.ceil(seconds)}`, `--record=${file}`],
    { env: { ...process.env, ADB: win(cfg.adb) }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', () => {});
    child.stderr.on('data', () => {});
    // The moment of the first frame: the file gets its first bytes then. What
    // scrcpy prints reaches a pipe only when it exits, so it says nothing.
    const started = new Promise((resolve) => {
      const limit = Date.now() + 20000;
      const poll = setInterval(() => {
        let size = 0;
        try { size = fs.statSync(file).size; } catch { /* not yet */ }
        if (size > 0 || Date.now() > limit) {
          clearInterval(poll);
          resolve(Date.now());
        }
      }, 25);
    });
    const ended = new Promise((resolve) => child.on('exit', resolve));
    return {
      started,
      ended,
      /** Waits for the end of the take and puts the touches on it. */
      async finish() {
        await ended;
        fs.writeFileSync(path.join(RAW, `${name}.touches.json`), JSON.stringify({ start: await started, seconds, touches }, null, 1));
        applyTouches(name);
      },
    };
  },
  now: () => Number(adb('shell', 'date', '+%s').trim()) * 1000,
  shot: (file) => fs.writeFileSync(file, spawnSync(cfg.adb, ['exec-out', 'screencap', '-p'], { maxBuffer: 1 << 26 }).stdout),
  back() {
    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
    adb('shell', 'am', 'force-stop', 'org.calendarplanner.app');
    adb('shell', 'rm', '-rf', SANDBOX);
    adb('reverse', '--remove', `tcp:${cfg.serverPort}`);
    adb('reverse', '--remove', `tcp:${cfg.sitePort}`);
    adb('shell', 'am', 'start', '-n', APP);   // gives back its widgets and alarm plan
  },
};

export const meta = {
  write(name, data) { fs.writeFileSync(path.join(RAW, `${name}.json`), JSON.stringify(data, null, 1)); },
  read(name) { return JSON.parse(fs.readFileSync(path.join(RAW, `${name}.json`), 'utf8')); },
};

/** A clean base with the planner's own demo records in the account of anna. */
export async function freshAccount() {
  await freshServers();
  const anna = await register('anna', 'Анна');
  await desk.start(anna, { demo: true });
  for (let i = 0; i < 60 && (await recordsOn(anna.token)) < 10; i++) await sleep(500);
  log(`anna has ${await recordsOn(anna.token)} records`);
  return anna;
}

