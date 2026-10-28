// Alarm sounds. The planner carries no sound files and synthesises its tunes
// (app/tones.cpp); the site plays the same names with the Web Audio API, and a
// melody of the account ("melody:<id>") from the record itself.

export const TONES = [
  { id: 'classic', title: 'Классический звонок' },
  { id: 'chime', title: 'Колокольчики' },
  { id: 'soft', title: 'Мягкая мелодия' },
  { id: 'rise', title: 'Нарастающая гамма' },
  { id: 'beep', title: 'Электронный писк' },
];

const MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', webm: 'audio/webm' };

export function mimeOf(format) {
  return MIME[(format || '').toLowerCase()] || 'audio/mpeg';
}

/** A human name for a melody setting. */
export function melodyTitle(value, store) {
  if (!value) return 'Как в настройках';
  if (value === 'none') return 'Без звука';
  if (value.startsWith('tone:')) return TONES.find((t) => t.id === value.slice(5))?.title || 'Классический звонок';
  if (value.startsWith('melody:')) return store?.melody(value.slice(7))?.title || 'Мелодия';
  return 'Мелодия другого устройства';
}

/** One cycle of a tune: [frequency, start, length, type] notes, seconds. */
function pattern(id) {
  switch (id) {
    case 'chime':
      return { cycle: 2.4, notes: [[1046.5, 0, 0.9, 'sine'], [1318.5, 0.3, 0.9, 'sine'], [1568, 0.6, 1.2, 'sine']] };
    case 'soft':
      return { cycle: 3.2, notes: [[523.25, 0, 0.6, 'triangle'], [659.25, 0.6, 0.6, 'triangle'], [783.99, 1.2, 0.6, 'triangle'], [659.25, 1.8, 0.9, 'triangle']] };
    case 'rise':
      return { cycle: 2.6, notes: [523.25, 587.33, 659.25, 698.46, 783.99, 880, 987.77, 1046.5].map((f, i) => [f, i * 0.25, 0.22, 'square']) };
    case 'beep':
      return { cycle: 1.2, notes: [[1000, 0, 0.12, 'square'], [1000, 0.2, 0.12, 'square'], [1000, 0.4, 0.12, 'square']] };
    default:
      return { cycle: 1.6, notes: [[880, 0, 0.14, 'square'], [660, 0.16, 0.14, 'square'], [880, 0.32, 0.14, 'square'], [660, 0.48, 0.14, 'square']] };
  }
}

export class Player {
  constructor() {
    this.context = null;
    this.timer = 0;
    this.audio = null;
    this.gain = null;
    this.stopTimer = 0;
  }

  ensureContext() {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) return null;
    if (!this.context) this.context = new Context();
    if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    return this.context;
  }

  /**
   * Plays @p value ("tone:classic", "melody:<id>", "none"). @p loop repeats it
   * until stop(); @p rising starts quiet and reaches full volume in 30 s;
   * @p seconds stops it on its own.
   */
  play(value, { store = null, loop = true, rising = false, seconds = 0 } = {}) {
    this.stop();
    if (value === 'none') return;
    if (value?.startsWith('melody:')) {
      const melody = store?.melody(value.slice(7));
      if (melody) {
        this.audio = new Audio(`data:${mimeOf(melody.format)};base64,${melody.data}`);
        this.audio.loop = loop;
        this.audio.volume = rising ? 0.1 : 1;
        this.audio.play().catch(() => {});
        if (rising) this.rise((v) => { if (this.audio) this.audio.volume = v; });
        if (seconds) this.stopTimer = setTimeout(() => this.stop(), seconds * 1000);
        return;
      }
      value = 'tone:classic';
    }
    const context = this.ensureContext();
    if (!context) return;
    const tune = pattern((value || 'tone:classic').replace('tone:', ''));
    this.gain = context.createGain();
    this.gain.gain.value = rising ? 0.1 : 0.6;
    this.gain.connect(context.destination);
    const schedule = (at) => {
      for (const [frequency, start, length, type] of tune.notes) {
        const osc = context.createOscillator();
        const env = context.createGain();
        osc.type = type;
        osc.frequency.value = frequency;
        env.gain.setValueAtTime(0.0001, at + start);
        env.gain.exponentialRampToValueAtTime(0.5, at + start + 0.01);
        env.gain.exponentialRampToValueAtTime(0.0001, at + start + length);
        osc.connect(env).connect(this.gain);
        osc.start(at + start);
        osc.stop(at + start + length + 0.05);
      }
    };
    let next = context.currentTime + 0.05;
    schedule(next);
    if (loop) {
      this.timer = setInterval(() => {
        while (next < context.currentTime + 0.5) {
          next += tune.cycle;
          schedule(next);
        }
      }, 200);
    }
    if (rising) this.rise((v) => { if (this.gain) this.gain.gain.value = v * 0.6; });
    if (seconds) this.stopTimer = setTimeout(() => this.stop(), seconds * 1000);
  }

  rise(apply) {
    const started = Date.now();
    this.riseTimer = setInterval(() => {
      const share = Math.min(1, 0.1 + (0.9 * (Date.now() - started)) / 30000);
      apply(share);
      if (share >= 1) clearInterval(this.riseTimer);
    }, 500);
  }

  stop() {
    clearInterval(this.timer);
    clearInterval(this.riseTimer);
    clearTimeout(this.stopTimer);
    this.timer = 0;
    if (this.gain) {
      try { this.gain.disconnect(); } catch { /* already gone */ }
      this.gain = null;
    }
    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }
  }
}

/**
 * A melody file made fit for the account: the planner keeps two minutes at
 * most (Melody::maxSeconds()). A short file goes as it is; a longer one is
 * decoded and its first two minutes written as WAV 22 050 Hz mono, as the
 * planner does on Android when it cannot cut the file without re-encoding.
 */
export async function prepareMelody(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = (file.name.split('.').pop() || 'mp3').toLowerCase();
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  let duration = 0;
  let decoded = null;
  if (Context) {
    const context = new Context();
    try {
      decoded = await context.decodeAudioData(bytes.slice().buffer);
      duration = decoded.duration;
    } catch {
      decoded = null;
    } finally {
      context.close?.();
    }
  }
  if (!decoded) throw new Error('Браузер не смог прочитать этот файл как звук');
  if (duration <= 120 && MIME[format]) {
    return { format, durationMs: Math.round(duration * 1000), data: toBase64(bytes) };
  }
  const rate = 22050;
  const seconds = Math.min(120, duration);
  const offline = new OfflineAudioContext(1, Math.ceil(seconds * rate), rate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0, 0, seconds);
  const rendered = await offline.startRendering();
  return { format: 'wav', durationMs: Math.round(seconds * 1000), data: toBase64(wav(rendered.getChannelData(0), rate)) };
}

function wav(samples, rate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset, s) => [...s].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; ++i) {
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
