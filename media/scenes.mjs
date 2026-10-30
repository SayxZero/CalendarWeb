// The takes: what is pressed on which device. Every scene starts from a clean
// test server with the planner's own demo records, so that it can be repeated
// after any update. Coordinates are screen pixels: on the PC the planner window
// stands at a known place at 125 %, the phone has 720x1600. When the interface
// moves, these numbers are what changes (README.md, "Если съехали нажатия").
import fs from 'node:fs';
import path from 'node:path';
import {
  MEDIA, RAW, WORK, browser, cfg, desk, ffmpeg, freshAccount, log, meta, password, phone, register, run, siteUrl, sleep, wdrive,
} from './lib.mjs';

const backdrop = path.join(MEDIA, 'art/backdrop.png');

// ------------------------------------------------------------ the PC window
// Points of the left panel, of the toolbar and of the task list.
const P = {
  week: [155, 348], month: [156, 300], agenda: [165, 443], tasks: [158, 491], habits: [168, 586],
  next: [239, 78], today: [600, 78], taskCircle: [1096, 508], habitCircle: [1102, 250],
};
const click = ([x, y]) => `click ${x} ${y}`;

const deskHeader = (pid, region = '0 -40 1600 1000', size = '1280 800') => `pid ${pid}
region ${region}
size ${size}
fps 30
bg ${backdrop}
`;

// ------------------------------------------------------------ the site

const signIn = (login, palette) => `size 1280 800
pointer off
goto ${siteUrl}/app/
eval localStorage.setItem('cosmos.settings', JSON.stringify({paletteId:'${palette}'})); 1
goto ${siteUrl}/app/
wait 600
clicksel input[type=text]
type ${login}
clicksel input[type=password]
type ${password()}
key Enter
wait 2500
`;

const moment = (ms) => new Date(ms).toTimeString().slice(0, 5);

/** An event with an alarm at the given moment, made through the site. */
function alarmEvent(title, at) {
  browser('event', `${signIn('anna', 'sky')}clicktext Создать
wait 800
clicktext Событие
wait 1200
clicksel input[placeholder="Название"]
type ${title}
eval (() => { const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); }; const t = [...document.querySelectorAll('input[type=time]')].filter(e=>e.offsetParent); set(t[0], '${moment(at)}'); set(t[1], '${moment(at + 1800000)}'); return 1; })()
clicksel [title^="Уведомление"]
wait 500
clicktext Сохранить
wait 1000
clicksel [title="Синхронизировать сейчас"]
wait 3500
`);
}

/** The next minute that leaves this much time. */
const minuteAfter = (ms) => Math.ceil((Date.now() + ms) / 60000) * 60000;

export const scenes = {
  // Calendars, tasks and habits on the PC.
  async calendars() {
    await freshAccount();
    const pid = desk.pid;
    wdrive('calendars', `${deskHeader(pid)}pointer off
${click(P.week)}
wait 700
${click(P.week)}
wait 1200
pointer on
point 700 500 0
record ${path.join(RAW, 'calendars.mp4')}
wait 1500
${click(P.next)}
wait 1600
${click(P.month)}
wait 2000
${click(P.tasks)}
wait 1800
${click(P.taskCircle)}
wait 1800
${click(P.habits)}
wait 1400
${click(P.habitCircle)}
wait 1800
stop
`);
  },

  // One person shares a calendar on the site, another one takes it by the link.
  async sharing() {
    await freshAccount();
    desk.stop();
    await register('olga', 'Ольга');
    browser('sharing', `${signIn('anna', 'sky')}clicksel [title="Вперёд"]
wait 800
pointer on
point 700 420 0
record ${path.join(RAW, 'share-owner.mp4')} 30
wait 1200
click 254 728
wait 1300
click 340 418
wait 1500
clicktext Открыть доступ другим
wait 2200
clicktext Создать ссылку
wait 2600
eval document.querySelector('.link-box')?.scrollIntoView({behavior:'smooth', block:'center'}); 1
wait 1200
clicktext Копировать
wait 1800
stop
save LINK document.querySelector('.link-box input').value
newtab
${signIn('olga', 'slate')}clicksel [title="Вперёд"]
wait 800
pointer on
point 640 420 0
record ${path.join(RAW, 'share-member.mp4')} 30
wait 1200
clicktext Календарь по ссылке
wait 1200
clicksel input[placeholder="Ссылка на календарь"]
paste \${LINK}
wait 500
clicktext Открыть
wait 1800
clicktext Добавить
wait 4500
stop
`);
  },

  // Someone is reading the site on the phone when the reminder to look at the
  // list comes over it; the bubble leads to the list.
  async taskcheck() {
    const anna = await freshAccount();
    desk.stop();
    // The grid of the check starts at "reset": its moment comes in a minute.
    const fire = Date.now() + 60000;
    const reset = new Date(fire - 15 * 60000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19);
    await phone.start(anna, { taskCheck: { mode: 1, reset } });
    phone.shell('input', 'keyevent', 'KEYCODE_HOME');
    await sleep(800);
    phone.shell('am', 'start', '-a', 'android.intent.action.VIEW', '-d', `http://127.0.0.1:${cfg.sitePort}/?r=${Date.now()}`, '-p', 'com.android.chrome');
    await sleep(7000);
    // A first small scroll, before the take: it sends the address bar of the browser away.
    phone.swipe(360, 1150, 360, 950, 500);
    await sleep(1200);
    while (Date.now() < fire - 12000) await sleep(200);
    const take = phone.record('taskcheck', 40);
    const start = await take.started;
    await sleep(1500);
    // Reading on, a screen at a time, until the bubble is there.
    let scrolls = 0;
    while (!phone.shell('dumpsys', 'notification').includes('id=9001') && Date.now() < fire + 25000) {
      if (scrolls < 3 && Date.now() > start + 2000 * (scrolls + 1)) {
        phone.swipe(360, 1150, 360, 760, 700);
        scrolls++;
      }
      await sleep(500);
    }
    await sleep(5000);
    phone.tap(635, 614);      // the bubble
    const opened = Date.now();
    await sleep(4000);
    meta.write('taskcheck', { start, opened });
    await take.finish();
  },

  // The palette of the planner on the phone, from the menu to the month in new colours.
  async palette() {
    const anna = await freshAccount();
    desk.stop();
    await phone.start(anna);
    phone.swipe(360, 1150, 360, 392, 1500);
    await sleep(1000);
    const take = phone.record('palette', 36);
    const start = await take.started;
    await sleep(1800);
    phone.tap(56, 118);       // menu
    await sleep(1500);
    phone.tap(170, 1323);     // settings
    await sleep(2200);
    phone.tap(200, 1214);     // choose a palette
    await sleep(2500);
    phone.tap(400, 1233);     // the pink one
    await sleep(3000);
    phone.swipe(360, 1340, 360, 1000, 900);
    await sleep(1200);
    phone.tap(400, 1219);     // the green one
    await sleep(3000);
    phone.swipe(360, 1340, 360, 1000, 900);
    await sleep(1200);
    phone.tap(400, 1327);     // the dark green one
    await sleep(3000);
    phone.tap(56, 120);       // out of the palettes
    await sleep(1500);
    phone.tap(56, 120);       // out of the settings
    await sleep(2500);
    meta.write('palette', { start, end: Date.now() });
    await take.finish();
  },

  // A melody of one's own: a file from the phone goes into the planner and onto
  // the alarm. The system's file picker shows everything in the downloads of this
  // phone, so the tune has a folder of its own and the way there is cut out.
  async melody() {
    const anna = await freshAccount();
    desk.stop();
    const tune = path.join(WORK, 'tune.m4a');
    const folderName = 'Мелодии', fileName = 'Утренняя мелодия.m4a';
    const onPhone = `/sdcard/Download/${folderName}/${fileName}`;
    // Quiet: choosing it plays it through the alarm channel.
    ffmpeg('-f', 'lavfi', '-i', "aevalsrc='0.04*sin(2*PI*(440+110*floor(mod(t*2,4)))*t)*exp(-3*mod(t,0.5))':s=44100:d=24", '-c:a', 'aac', '-b:a', '64k', tune);
    const scan = () => phone.shell(`content call --uri content://media/external/file --method scan_file --arg "${onPhone}"`);
    phone.shell(`mkdir -p "/sdcard/Download/${folderName}"`);
    phone.push(tune, '/sdcard/Download/tune.m4a');
    phone.shell(`mv /sdcard/Download/tune.m4a "${onPhone}"`);
    scan();
    const screenText = () => {
      phone.shell('uiautomator', 'dump', '/sdcard/ui.xml');
      const xml = phone.shell('cat', '/sdcard/ui.xml');
      phone.shell('rm', '/sdcard/ui.xml');
      return xml;
    };
    const center = (xml, text) => {
      const found = xml.match(new RegExp(`text="${text}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`));
      return found ? [(Number(found[1]) + Number(found[3])) >> 1, (Number(found[2]) + Number(found[4])) >> 1] : null;
    };
    const toAlarmSection = async () => {
      phone.tap(56, 118);     // menu
      await sleep(1500);
      phone.tap(170, 1323);   // settings
      await sleep(2200);
      phone.swipe(360, 1340, 360, 340, 1500);
      await sleep(1500);
      phone.swipe(360, 1340, 360, 340, 1500);
      await sleep(1500);
    };
    try {
      await phone.start(anna);
      const take = phone.record('melody', 50);
      const start = await take.started;
      await sleep(1500);
      await toAlarmSection();
      phone.tap(300, 985);    // the melodies of the account
      await sleep(2500);
      phone.tap(360, 1308);   // add
      const adding = Date.now();
      await sleep(3000);
      // Wherever the picker opened, to the folder of the tune.
      let screen = screenText();
      if (!center(screen, fileName)) {
        if (!center(screen, folderName)) {
          phone.tap(114, 210);   // the first step of its path
          await sleep(2500);
          screen = screenText();
        }
        const folder = center(screen, folderName);
        if (!folder) throw new Error('no folder of the tune in the file picker');
        phone.tap(...folder);
        await sleep(2500);
        screen = screenText();
      }
      const file = center(screen, fileName);
      if (!file) throw new Error('no tune in the file picker');
      const picking = Date.now();
      await sleep(1500);
      phone.tap(file[0], file[1] - 150);
      await sleep(5000);      // the list says it is there, and for how many devices
      phone.tap(56, 120);     // out of the melodies: this goes back to the month
      const closing = Date.now();
      await sleep(1500);
      await toAlarmSection();
      const again = Date.now();
      await sleep(800);
      phone.tap(300, 845);    // the melody of the alarm
      await sleep(2000);
      phone.tap(360, 1038);   // this one
      await sleep(1500);
      phone.tap(616, 1262);   // ok
      await sleep(3500);
      meta.write('melody', { start, end: Date.now(), cuts: [[adding + 200, picking], [closing + 200, again]] });
      await take.finish();
    } finally {
      phone.shell(`rm -rf "/sdcard/Download/${folderName}"`);
      scan();
    }
  },

  // One alarm on a sleeping phone and on the PC, switched off on the phone.
  async alarm() {
    const anna = await freshAccount();
    const at = minuteAfter(85000);
    alarmEvent('Встреча с заказчиком', at);
    log(`the alarm rings at ${moment(at)}`);
    const pid = await desk.start(anna);
    await phone.start(anna);
    while (Date.now() < at - 24000) await sleep(200);
    // The take starts first: a sleeping phone sends no frames to start it with.
    const take = phone.record('alarm-phone', 24 + 8 + 30);
    const phoneStart = await take.started;
    // Asleep: the alarm wakes it up, which is what the video is about.
    phone.shell('input', 'keyevent', 'KEYCODE_SLEEP');
    const stamp = path.join(RAW, 'alarm-desk.stamp');
    while (Date.now() < at - 9000) await sleep(200);
    const deskTake = wdrive('alarm-desk', `pid ${pid}
region 80 10 1440 838
size 1440 838
fps 30
pointer off
record ${path.join(RAW, 'alarm-desk.mp4')}
stamp ${stamp}
waitshown 577 40000
waitgone 577 34000
wait 2500
stop
`, { wait: false });
    while (Date.now() < at + 8000) await sleep(200);
    phone.shot(path.join(RAW, 'alarm-ringing.png'));
    // A press held for a moment: the screen goes away the instant it is let go.
    phone.swipe(360, 1110, 360, 1110, 450);
    const dismissed = Date.now();
    await sleep(1200);
    // Back through the lock screen to the sandbox: the stop goes out from there.
    phone.shell('input', 'keyevent', 'KEYCODE_WAKEUP');
    phone.swipe(360, 1300, 360, 400, 250);
    await sleep(500);
    phone.front();
    const opened = Date.now();
    await new Promise((resolve) => deskTake.on('exit', resolve));
    const ended = Date.now();
    await take.finish();
    meta.write('alarm', { at, phoneStart, dismissed, opened, ended, deskStart: Number(fs.readFileSync(stamp, 'utf8')) });
    log(`the PC stopped ${((ended - 2500 - dismissed) / 1000).toFixed(0)} s after the phone`);
  },

  // Asking an agent: a real Codex writes a real file, its words are shown on a
  // plain chat page, and the site imports that file.
  async agent() {
    await freshAccount();
    desk.stop();
    const dir = path.join(WORK, 'agent');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const request = 'Составь мой план на следующую неделю: в понедельник в 9:30 зубной, во вторник в 19:00 бассейн, ' +
      'в среду в 12:00 обед с Сергеем, в пятницу в 18:00 поход в театр. Сохрани его файлом plan.ics, название календаря — Планы.';
    // The date and the shape of the answer are for the agent, the page shows the request.
    run('cmd', ['/c', 'codex', 'exec', '--skip-git-repo-check', '--color', 'never', '-s', 'workspace-write', '-m', cfg.codexModel,
      '-o', 'reply.txt', `Сегодня ${today}. ${request} В ответе одной фразой скажи, сколько встреч ты записал, без ссылок.`],
    { cwd: dir, input: '', timeout: 300000 });
    const ics = path.join(dir, 'plan.ics');
    if (!fs.existsSync(ics)) throw new Error('the agent wrote no plan.ics');
    const reply = fs.readFileSync(path.join(dir, 'reply.txt'), 'utf8').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*]/g, '').replace(/\s+/g, ' ').trim();
    log(`the agent: ${reply}`);
    const page = `file:///${path.join(MEDIA, 'agent/index.html').replaceAll('\\', '/')}`;
    browser('agent-chat', `size 1280 800
pointer off
goto ${page}
wait 500
pointer on
point 900 620 0
record ${path.join(RAW, 'agent-chat.mp4')} 30
wait 900
clicksel textarea
wait 300
typefast 16 ${request}
wait 700
clicksel #send
wait 2200
eval reply(${JSON.stringify(reply)}, 'plan.ics'); 1
wait 4500
stop
`);
    browser('agent-import', `${signIn('anna', 'sky')}clicksel [title="Вперёд"]
wait 800
pointer on
point 700 420 0
record ${path.join(RAW, 'agent-import.mp4')} 30
wait 1200
click 254 728
wait 1200
choosefile ${ics}
clicktext Импорт ICS
wait 3000
clicktext Закрыть
wait 3000
stop
`);
  },

  // The same account on three devices, for the screens of the Blender scene.
  async devices() {
    const anna = await freshAccount();
    const pid = desk.pid;
    wdrive('devices-desk', `pid ${pid}
region 80 10 1440 838
size 1440 838
fps 30
pointer off
${click(P.month)}
wait 800
${click(P.next)}
wait 1200
pointer on
point 700 832 0
record ${path.join(RAW, 'screen-desk.mp4')}
wait 4000
${click(P.tasks)}
wait 5500
${click(P.agenda)}
wait 5500
${click(P.month)}
wait 3000
stop
`);
    desk.stop();
    browser('devices-web', `${signIn('anna', 'sky')}clicksel [title="Вперёд"]
wait 800
pointer on
point 700 420 0
record ${path.join(RAW, 'screen-web.mp4')} 30
wait 3000
clicktext Неделя
wait 4500
clicktext Задачи
wait 4500
clicktext Месяц
wait 4000
stop
`);
    await phone.start(anna);
    phone.swipe(360, 1150, 360, 392, 1500);
    await sleep(1000);
    // Unhurried: this one is small on the screen, and every step has to be seen.
    const take = phone.record('screen-phone', 20);
    await take.started;
    await sleep(4000);
    phone.tap(56, 118);       // menu
    await sleep(2000);
    phone.tap(120, 800);      // tasks
    await sleep(5500);
    phone.tap(56, 118);
    await sleep(2000);
    phone.tap(120, 430);      // month
    await take.finish();
  },
};
