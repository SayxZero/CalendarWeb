// What a reminder looks like when it comes: a browser notification (or a
// toast, when they are not allowed) for a quiet one, and a screen with sound
// for an alarm clock - «Отложить» and «Выключить», as the planner's
// AlarmWindow. Switched off here, it stays off on every device.

import { h, icon, toast } from './dom.js';
import { settings } from './settings.js';
import { Player } from '../core/tones.js';
import { hhmm } from '../model/dates.js';

export class AlarmUi {
  constructor(app, service) {
    this.app = app;
    this.service = service;
    this.player = new Player();
    this.ringing = null;
    this.timeout = 0;
    this.syncTimer = 0;
    // Unlocks sound: browsers let a page play only after the user touched it.
    const unlock = () => {
      this.player.ensureContext();
      document.removeEventListener('pointerdown', unlock, true);
    };
    document.addEventListener('pointerdown', unlock, true);
    app.store.subscribe((kinds) => {
      if (this.ringing && kinds.has('alarmstop') && app.store.isAlarmStopped(this.ringing.hit.key)) {
        this.dismiss(false);
        toast('Будильник выключен на другом устройстве');
      }
    });
  }

  notify(hit) {
    if (!settings.get('notificationsEnabled')) return;
    const body = [hit.subtitle, hit.kind === 'reminder' ? '' : ''].filter(Boolean).join('\n');
    if (globalThis.Notification && Notification.permission === 'granted') {
      try {
        const note = new Notification(hit.title, { body, tag: hit.key, icon: 'img/logo.svg' });
        note.onclick = () => {
          window.focus();
          this.open(hit);
          note.close();
        };
        return;
      } catch {
        // Some browsers want a service worker for notifications; a toast then.
      }
    }
    toast(`${hit.title}${hit.subtitle ? ' · ' + hit.subtitle : ''}`, { action: 'Открыть', onAction: () => this.open(hit), timeout: 10000 });
  }

  open(hit) {
    const store = this.app.store;
    if (hit.kind === 'task' && store.task(hit.itemId)) this.app.openTask(store.task(hit.itemId));
    else if (hit.kind === 'event') {
      const occurrence = store.occurrencesOn(hit.happensAt.slice(0, 10)).find((o) => o.event.id === hit.itemId);
      if (occurrence) this.app.openOccurrence(occurrence);
    } else if (hit.kind === 'reminder') this.app.go('reminders');
  }

  ring(hit) {
    if (this.ringing) this.dismiss(false);
    const record = hit.record || {};
    const melody = record.alarmMelody || settings.get('alarmMelody');
    const snoozeMinutes = record.snoozeMinutes || settings.get('snoozeMinutes');
    const limit = record.snoozeLimit ?? 3;
    this.player.play(melody, { store: this.app.store, loop: true, rising: settings.get('alarmRisingVolume') });
    const canSnooze = this.service.canSnooze(hit, limit);
    const card = h('div', { class: 'alarm', attrs: { role: 'alertdialog' } }, h('div', { class: 'alarm-card' },
      h('div', { class: 'muted' }, icon('alarm'), ' Будильник'),
      h('div', { class: 'clock' }, hhmm(hit.snoozedFrom || hit.fireAt)),
      h('div', { class: 'what' }, hit.title),
      hit.subtitle ? h('div', { class: 'muted' }, hit.subtitle) : null,
      h('div', { class: 'actions' },
        canSnooze ? h('button', { class: 'btn', on: { click: () => {
          this.service.snooze(hit, snoozeMinutes, limit);
          this.dismiss(false);
          toast(`Отложено на ${snoozeMinutes} мин`);
        } } }, `Отложить на ${snoozeMinutes} мин`) : null,
        h('button', { class: 'btn primary', on: { click: () => this.dismiss(true) } }, 'Выключить'))));
    document.body.append(card);
    this.ringing = { hit, card };
    this.notify({ ...hit, title: `⏰ ${hit.title}` });
    // An alarm nobody answers stops by itself; the ones elsewhere are asked
    // about every 20 seconds while it rings, not every 15 minutes.
    this.timeout = setTimeout(() => this.dismiss(false), settings.get('alarmDurationMinutes') * 60000);
    this.syncTimer = setInterval(() => this.app.sync?.syncNow(), 20000);
  }

  /** @p stopped: «Выключить» - written down for the other devices. */
  dismiss(stopped) {
    if (!this.ringing) return;
    const { hit, card } = this.ringing;
    this.ringing = null;
    clearTimeout(this.timeout);
    clearInterval(this.syncTimer);
    this.player.stop();
    card.remove();
    if (stopped) {
      this.app.store.stopAlarm(hit.key, hit.itemId, hit.snoozedFrom || hit.fireAt);
      this.app.sync?.syncNow();
    }
  }
}
