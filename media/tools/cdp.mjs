// cdp.mjs - drives a headless Edge over the DevTools protocol and records the
// page: node cdp.mjs <script.txt> [port]. Script lines (# - comment):
//   size W H [dpr]        viewport
//   goto URL              open a page and wait for it to load
//   wait MS
//   waitfor CSS           until the selector matches (10 s)
//   point X Y [MS]        move the drawn pointer (and the mouse)
//   click X Y | clicksel CSS [dx dy]
//   type TEXT             insertText into the focused element
//   key NAME              Enter, Escape, Tab, Backspace
//   eval JS               result printed
//   record OUT.mp4 [FPS]  screencast until "stop"
//   stop
//   shot OUT.png
//   pointer on|off
//   newtab                a fresh isolated context (another person)
//   choosefile PATH       the next file dialog of the page gets this file
//   save NAME JS          keeps a value; \${NAME} is replaced in the lines below
//   paste TEXT            insertText all at once
//   clicktext TEXT        the last visible button or link with this text
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const scriptFile = process.argv[2];
const port = Number(process.argv[3] || 9333);
const edge = process.env.MEDIA_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ffmpeg = process.env.MEDIA_FFMPEG || 'D:/ffmpeg/bin/ffmpeg.exe';
const profile = path.join(path.dirname(path.resolve(scriptFile)), `edge-profile-${port}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(2).padStart(7), ...a);

let browser = null;
const proc = spawn(edge, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars',
  '--force-color-profile=srgb', '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });

async function versionInfo() {
  for (let i = 0; i < 50; i++) {
    try { return await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(200); }
  }
  throw new Error('no devtools endpoint');
}

class Connection {
  constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.handlers = []; }
  open() {
    return new Promise((resolve, reject) => {
      this.ws.onopen = resolve; this.ws.onerror = reject;
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: ok, reject: bad } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          msg.error ? bad(new Error(JSON.stringify(msg.error))) : ok(msg.result);
        } else if (msg.method) {
          for (const h of this.handlers) h(msg);
        }
      };
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

let conn, session, context;
const page = (method, params) => conn.send(method, params, session);

async function newPage() {
  context = (await conn.send('Target.createBrowserContext', {})).browserContextId;
  const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank', browserContextId: context });
  session = (await conn.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await page('Page.enable');
  await page('Runtime.enable');
  await page('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: dpr, mobile: false });
}

let vw = 1280, vh = 800, dpr = 1;
let px = -1, py = -1, pointerOn = true;

const pointerJs = `(() => {
  let p = document.getElementById('__ptr');
  if (!p) {
    p = document.createElement('div'); p.id = '__ptr';
    p.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:30px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px)';
    p.innerHTML = '<svg width="22" height="30" viewBox="0 0 22 30"><path d="M1 1v22l5.6-5.2 3.9 8.6 3.6-1.6-3.8-8.4h7.4z" fill="#fff" stroke="#1c232b" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(p);
  }
  return p;
})()`;

async function drawPointer(x, y, ripple = false) {
  if (!pointerOn) return;
  await page('Runtime.evaluate', { expression: `(() => { const p = ${pointerJs}; p.style.transform = 'translate(${x}px, ${y}px)';
    ${ripple ? `const r = document.createElement('div');
    r.style.cssText = 'position:fixed;left:${x - 18}px;top:${y - 18}px;width:36px;height:36px;border-radius:50%;border:3px solid rgba(90,170,216,.85);background:rgba(90,170,216,.25);z-index:2147483646;pointer-events:none;transition:transform .45s ease-out, opacity .45s ease-out;transform:scale(.3);opacity:1';
    document.documentElement.appendChild(r); requestAnimationFrame(() => { r.style.transform = 'scale(1.2)'; r.style.opacity = '0'; });
    setTimeout(() => r.remove(), 600);` : ''} })()` });
}

async function move(x, y, ms = 450) {
  const sx = px < 0 ? x : px, sy = py < 0 ? y : py;
  const steps = Math.max(1, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    let t = i / steps; t = t * t * (3 - 2 * t);
    const cx = sx + (x - sx) * t, cy = sy + (y - sy) * t;
    await page('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy });
    await drawPointer(cx, cy);
    await sleep(ms / steps);
  }
  px = x; py = y;
}

async function click(x, y) {
  await move(x, y);
  await sleep(120);
  await drawPointer(x, y, true);
  await page('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(70);
  await page('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function evaluate(expression) {
  const r = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

async function centre(selector) {
  return evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null;
    e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
}

// screencast
let frames = [], recording = null;
async function startRecording(out, fps) {
  frames = [];
  const handler = async (msg) => {
    if (msg.method !== 'Page.screencastFrame' || msg.sessionId !== session) return;
    frames.push({ data: msg.params.data, at: msg.params.metadata.timestamp });
    page('Page.screencastFrameAck', { sessionId: msg.params.sessionId }).catch(() => {});
  };
  conn.handlers.push(handler);
  await page('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: vw * dpr, maxHeight: vh * dpr, everyNthFrame: 1 });
  recording = { out, fps, handler, startedAt: Date.now() / 1000 };
  // a repaint so that the first frame comes at once
  await evaluate('document.body.style.outline = "0px solid transparent"; 1');
}

async function stopRecording() {
  const stoppedAt = Date.now() / 1000;
  await page('Page.stopScreencast');
  conn.handlers = conn.handlers.filter((h) => h !== recording.handler);
  const dir = recording.out.replace(/\.mp4$/, '-frames');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  // Frames come only when the page repaints: each one lasts until the next.
  const list = [];
  frames.forEach((f, i) => {
    const name = `f${String(i).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(dir, name), Buffer.from(f.data, 'base64'));
    const next = i + 1 < frames.length ? frames[i + 1].at : Math.max(f.at + 0.05, f.at + (stoppedAt - frames[frames.length - 1].at));
    list.push(`file '${name}'`, `duration ${Math.max(0.001, next - f.at).toFixed(4)}`);
  });
  if (frames.length) list.push(`file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'`);
  fs.writeFileSync(path.join(dir, 'list.txt'), list.join('\n'));
  await new Promise((resolve, reject) => {
    const ff = spawn(ffmpeg, ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt',
      '-vf', `fps=${recording.fps},scale=${vw * dpr}:${vh * dpr}:flags=lanczos`, '-c:v', 'libx264', '-crf', '16', '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p', path.resolve(recording.out)], { cwd: dir, stdio: 'inherit' });
    ff.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))));
  });
  log(`recorded ${frames.length} frames to ${recording.out}`);
  recording = null;
}

async function main() {
  const info = await versionInfo();
  conn = new Connection(info.webSocketDebuggerUrl);
  await conn.open();
  await newPage();
  const lines = fs.readFileSync(scriptFile, 'utf8').split(/\r?\n/);
  const vars = {};
  for (const raw of lines) {
    const line = raw.trim().replace(/\$\{(\w+)\}/g, (_, k) => vars[k] ?? '');
    if (!line || line.startsWith('#')) continue;
    const [cmd, ...rest] = line.split(' ');
    const arg = rest.join(' ');
    log(line.length > 120 ? line.slice(0, 120) + '…' : line);
    switch (cmd) {
      case 'size': [vw, vh] = [Number(rest[0]), Number(rest[1])]; dpr = Number(rest[2] || 1);
        await page('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: dpr, mobile: false }); break;
      case 'goto': {
        const loaded = new Promise((resolve) => { const h = (m) => { if (m.method === 'Page.loadEventFired' && m.sessionId === session) { conn.handlers = conn.handlers.filter((x) => x !== h); resolve(); } }; conn.handlers.push(h); });
        await page('Page.navigate', { url: arg }); await loaded; await sleep(300);
        if (px >= 0) await drawPointer(px, py);
        break;
      }
      case 'wait': await sleep(Number(arg)); break;
      case 'waitfor': {
        for (let i = 0; i < 100 && !(await evaluate(`!!document.querySelector(${JSON.stringify(arg)})`)); i++) await sleep(100);
        break;
      }
      case 'point': await move(Number(rest[0]), Number(rest[1]), Number(rest[2] || 450)); break;
      case 'click': await click(Number(rest[0]), Number(rest[1])); break;
      case 'clicksel': {
        const at = await centre(arg);
        if (!at) { log('no element', arg); break; }
        await click(at[0], at[1]); break;
      }
      case 'type':
        for (const ch of arg) { await page('Input.insertText', { text: ch }); await sleep(45); }
        break;
      case 'typefast':    // typefast MS TEXT: a long text, by letters but quicker than a person
        for (const ch of rest.slice(1).join(' ')) { await page('Input.insertText', { text: ch }); await sleep(Number(rest[0])); }
        break;
      case 'key': {
        const keys = { Enter: [13, '\r'], Escape: [27, ''], Tab: [9, ''], Backspace: [8, ''] };
        const [code, text] = keys[arg];
        await page('Input.dispatchKeyEvent', { type: 'keyDown', key: arg, code: arg, windowsVirtualKeyCode: code, text });
        await page('Input.dispatchKeyEvent', { type: 'keyUp', key: arg, code: arg, windowsVirtualKeyCode: code });
        break;
      }
      case 'eval': log('=>', JSON.stringify(await evaluate(arg))); break;
      case 'save': vars[rest[0]] = String(await evaluate(rest.slice(1).join(' '))); log('=>', vars[rest[0]].slice(0, 80)); break;
      case 'paste': await page('Input.insertText', { text: arg }); break;
      case 'clicktext': {
        // the last visible button (or link) with this text: dialogs come last in the page
        const at = await evaluate(`(() => { const all = [...document.querySelectorAll('button, a, [role=button], label')]
          .filter((e) => e.offsetParent && e.textContent.trim().includes(${JSON.stringify(arg)}));
          const e = all[all.length - 1]; if (!e) return null; e.scrollIntoView({ block: 'nearest' });
          const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
        if (!at) { log('no text', arg); break; }
        await click(at[0], at[1]); break;
      }
      case 'record': await startRecording(rest[0], Number(rest[1] || 30)); break;
      case 'stop': await stopRecording(); break;
      case 'shot': {
        const r = await page('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(arg, Buffer.from(r.data, 'base64')); break;
      }
      case 'pointer': pointerOn = rest[0] === 'on';
        if (!pointerOn) await evaluate(`document.getElementById('__ptr')?.remove(); 1`);
        break;
      case 'newtab': await newPage(); px = py = -1; break;
      case 'choosefile': {
        await page('Page.setInterceptFileChooserDialog', { enabled: true });
        const handler = async (m) => {
          if (m.method !== 'Page.fileChooserOpened' || m.sessionId !== session) return;
          conn.handlers = conn.handlers.filter((x) => x !== handler);
          await page('DOM.setFileInputFiles', { files: [path.resolve(arg)], backendNodeId: m.params.backendNodeId });
        };
        conn.handlers.push(handler);
        break;
      }
      default: log('unknown', cmd);
    }
  }
  if (recording) await stopRecording();
}

main().then(() => { proc.kill(); process.exit(0); }, (e) => { console.error(e); proc.kill(); process.exit(1); });
