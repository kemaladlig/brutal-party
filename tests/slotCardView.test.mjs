// Host lobi koltuk kartı boyaması (Faz 2.5): DOM boyaması slotManager'dan
// `ui/slotCardView.js`'e taşındı. Bu dosya sahte bir DOM kurup kartın
// metin/sınıf/rozet/sayaç çıktısını doğrular; test harness'ları genelde
// `getElementById: () => null` döndürüp boyama yolunu hiç çalıştırmıyor.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';

class FakeClassList {
  constructor() {
    this.set = new Set();
  }
  add(...names) {
    for (const n of names) this.set.add(n);
  }
  remove(...names) {
    for (const n of names) this.set.delete(n);
  }
  toggle(name, on) {
    if (on) this.set.add(name);
    else this.set.delete(name);
  }
  contains(name) {
    return this.set.has(name);
  }
}

class FakeEl {
  constructor(id) {
    this.id = id;
    this.classList = new FakeClassList();
    this.textContent = '';
    this.children = [];
    this.width = 68;
    this.height = 68;
    this.dataset = {};
  }

  querySelector(selector) {
    const cls = selector.replace(/^\./, '');
    return this.findByClass(cls);
  }

  findByClass(cls) {
    for (const child of this.children) {
      const names = String(child.className || '').split(/\s+/);
      if (names.includes(cls)) return child;
      const nested = child.findByClass?.(cls);
      if (nested) return nested;
    }
    return null;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  getContext() {
    // Çip çizimi yalnız "hangi ctx çağrıları yapıldı" sorusunu sormak için
    // kaydedilir; avatar çizimi karakterRenderer'ın işidir.
    this.ctxCalls = [];
    const self = this;
    return new Proxy({
      clearRect: () => self.ctxCalls.push('clearRect'),
      setLineDash: () => self.ctxCalls.push('setLineDash'),
      beginPath: () => self.ctxCalls.push('beginPath'),
      arc: () => self.ctxCalls.push('arc'),
      stroke: () => self.ctxCalls.push('stroke'),
    }, {
      get(target, key) {
        if (key in target) return target[key];
        return () => self.ctxCalls.push(String(key));
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    });
  }
}

function child(parent, className) {
  const el = new FakeEl(`${parent.id}-${className}`);
  el.className = className;
  parent.appendChild(el);
  return el;
}

const byId = new Map();
const botButtons = new Map();

before(() => {
  for (let i = 1; i <= 4; i++) {
    const slot = new FakeEl(`slot-p${i}`);
    child(slot, 'slot-name');
    byId.set(`slot-p${i}`, slot);
    byId.set(`ready-tag-p${i}`, new FakeEl(`ready-tag-p${i}`));
    byId.set(`slot-canvas-p${i}`, new FakeEl(`slot-canvas-p${i}`));

    const btn = new FakeEl(`slot-bot-btn-${i}`);
    btn.dataset.slot = String(i - 1);
    child(btn, 'slot-bot-label');
    botButtons.set(i - 1, btn);
  }
  byId.set('lobby-ready-counter', new FakeEl('lobby-ready-counter'));

  globalThis.document = {
    getElementById: (id) => byId.get(id) || null,
    querySelector: (sel) => {
      const m = sel.match(/^\.slot-bot-btn\[data-slot="(\d+)"\]$/);
      return m ? botButtons.get(Number(m[1])) : null;
    },
    createElement: () => new FakeEl('created'),
  };
});

const { paintSlotAvatar, paintSlotCard, paintReadyCounter, paintColorClashBadges, hasSlotCard } =
  await import('../src/ui/slotCardView.js');
const { t } = await import('../src/i18n.js');

const slot = (i) => byId.get(`slot-p${i + 1}`);
const tag = (i) => byId.get(`ready-tag-p${i + 1}`);
const name = (i) => slot(i).querySelector('.slot-name');
const botBtn = (i) => botButtons.get(i);
const counter = () => byId.get('lobby-ready-counter');

test('an empty seat is dashed, unconnected, and offers +BOT when the setting is on', () => {
  assert.equal(hasSlotCard(0), true);
  const canvas = byId.get('slot-canvas-p1');
  paintSlotAvatar(0, { isConnected: false, kind: 'human', entry: null });
  paintSlotCard(0, null, { botsEnabled: true });

  // Boş koltuk: temizlenir ve kesikli daire çizilir (avatar değil).
  assert.deepEqual(canvas.ctxCalls.slice(0, 2), ['clearRect', 'setLineDash']);
  assert.equal(canvas.ctxCalls.includes('arc'), true);
  assert.equal(slot(0).classList.contains('connected'), false);
  assert.equal(name(0).textContent, t('pause.empty'));
  assert.equal(tag(0).textContent, '');
  assert.equal(botBtn(0).classList.contains('hidden'), false);
  assert.equal(botBtn(0).querySelector('.slot-bot-label').textContent, t('host.addBot'));
});

test('a ready human shows the ready badge and never a bot button', () => {
  paintSlotCard(1, { name: 'HOST', isReady: true, kind: 'human' }, { botsEnabled: true });

  assert.equal(slot(1).classList.contains('connected'), true);
  assert.equal(slot(1).classList.contains('ready'), true);
  assert.equal(slot(1).classList.contains('is-bot'), false);
  assert.equal(name(1).textContent, 'HOST');
  assert.equal(tag(1).textContent, t('lobby.ready'));
  assert.equal(botBtn(1).classList.contains('hidden'), true);

  paintSlotCard(1, { name: 'HOST', isReady: false, kind: 'human' }, { botsEnabled: true });
  assert.equal(slot(1).classList.contains('ready'), false);
  assert.equal(tag(1).textContent, t('lobby.wait'));
});

test('bots carry their persona tag and the remove button, and never count as ready', () => {
  paintSlotCard(2, { name: '', isReady: true, kind: 'bot' }, { botsEnabled: true });
  assert.equal(slot(2).classList.contains('is-bot'), true);
  assert.equal(slot(2).classList.contains('ready'), false);
  assert.notEqual(name(2).textContent, '');
  assert.notEqual(tag(2).textContent, '');
  assert.equal(botBtn(2).classList.contains('hidden'), false);
  assert.equal(botBtn(2).querySelector('.slot-bot-label').textContent, t('host.removeBot'));

  paintSlotCard(2, { name: '', isReady: true, kind: 'bot_god' }, { botsEnabled: true });
  assert.equal(slot(2).classList.contains('is-bot-god'), true);
  assert.equal(slot(2).classList.contains('is-bot'), true);
});

test('the ready counter ignores bots and separates connected from ready humans', () => {
  paintReadyCounter([null, null, null, null]);
  assert.equal(counter().textContent, t('lobby.waiting'));

  paintReadyCounter([
    { kind: 'human', isReady: true },
    { kind: 'human', isReady: false },
    { kind: 'bot', isReady: true },
    null,
  ]);
  assert.equal(counter().textContent, t('lobby.connected', 2, 1));

  paintReadyCounter([
    { kind: 'human', isReady: true },
    { kind: 'human', isReady: true },
    null,
    null,
  ]);
  assert.equal(counter().textContent, t('lobby.readyToStart', 2, 2));
});

test('color clash badges are created once and cleared when the clash is gone', () => {
  paintColorClashBadges([0, 2]);
  assert.equal(slot(0).classList.contains('color-clash'), true);
  assert.equal(slot(1).classList.contains('color-clash'), false);
  const warn = slot(0).querySelector('.slot-clash-tag');
  assert.ok(warn, 'çakışma rozeti oluşturulmalı');
  assert.equal(warn.textContent, t('lobby.clash'));

  paintColorClashBadges([2]);
  assert.equal(slot(0).classList.contains('color-clash'), false);
  assert.equal(slot(0).querySelector('.slot-clash-tag').textContent, '');
});
