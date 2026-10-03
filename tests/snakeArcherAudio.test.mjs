// SNAKE / ARCHER ses ayrımı — jenerik `playExplosion` (0.9 gain'li büyük
// boom) yılan ölümü ve ok isabetine yanlış renk/ton katıyordu. Her olayın
// kendi sessiz bandı var; bu test hem osilatör imzalarının farklı kalmasını
// hem de oyunların doğru fonksiyonları çağırmasını kilitler.
//
//   yılan ölümü  → playSnakePop   (üçgen, kısa, düşük)
//   ok isabeti   → playArrowHit   (üçgen, darbe)
//   ok bırakımı  → playArrowShoot (testere, "pan")
//
// Gain sözleşmesi: üçü de synth fallback'te playExplosion'dan (0.5) daha
// sessiz kalmalı — bunlar "patlama" değil, küçük olay renkleridir.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';

const noop = () => {};

/** Ses çağrılarını + gain tepe değerlerini kaydeden sahte AudioContext. */
function createAudioSpy() {
  const calls = [];
  const gainPeaks = [];
  return {
    calls,
    gainPeaks,
    get last() { return calls[calls.length - 1]; },
    context: {
      currentTime: 0,
      state: 'running',
      sampleRate: 48000,
      destination: {},
      resume: noop,
      createBufferSource: () => ({ buffer: null, connect: noop, start: noop, stop: noop }),
      createBiquadFilter: () => ({
        type: '',
        frequency: { setValueAtTime: noop, exponentialRampToValueAtTime: noop },
        connect: noop,
      }),
      createGain: () => ({
        gain: {
          setValueAtTime: (v) => gainPeaks.push(v),
          exponentialRampToValueAtTime: noop,
        },
        connect: noop,
      }),
      createOscillator() {
        const entry = { type: '', startFrequency: 0, endFrequency: 0, startedAt: 0, stoppedAt: 0 };
        calls.push(entry);
        return {
          get type() { return entry.type; },
          set type(value) { entry.type = value; },
          frequency: {
            setValueAtTime: (value) => { entry.startFrequency = value; },
            exponentialRampToValueAtTime: (value) => { entry.endFrequency = value; },
          },
          connect: noop,
          start: (at) => { entry.startedAt = at; },
          stop: (at) => { entry.stoppedAt = at; },
        };
      },
    },
    count: () => calls.length,
    reset() { calls.length = 0; gainPeaks.length = 0; },
  };
}

let server;
let audio;
let spy;
let snakeSource;
let archerSource;

before(async () => {
  globalThis.window = {
    innerWidth: 800,
    innerHeight: 600,
    addEventListener: noop,
    removeEventListener: noop,
    matchMedia: () => ({ matches: false }),
  };
  globalThis.document = {
    body: {},
    getElementById: () => null,
    querySelector: () => null,
    addEventListener: noop,
  };
  server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
  });
  spy = createAudioSpy();
  globalThis.window.AudioContext = function AudioContextStub() { return spy.context; };
  audio = await server.ssrLoadModule('/src/audio.js');
  snakeSource = readFileSync(new URL('../src/games/snake.js', import.meta.url), 'utf8');
  archerSource = readFileSync(new URL('../src/games/archer.js', import.meta.url), 'utf8');
});

after(async () => {
  await server?.close();
});

function play(name, ...args) {
  spy.reset();
  audio[name](...args);
  return spy.last;
}

test('snake pop, arrow hit and arrow shoot read as different voices', () => {
  const pop = play('playSnakePop');
  const hit = play('playArrowHit');
  const shoot = play('playArrowShoot');

  assert.equal(pop.type, 'triangle');
  assert.ok(pop.startFrequency >= 400, `snake pop tiz-çatlamalı, got ${pop.startFrequency}`);
  assert.ok(pop.stoppedAt - pop.startedAt <= 0.15, 'snake pop kısa olmalı');

  assert.equal(hit.type, 'triangle');
  assert.ok(hit.startFrequency < pop.startFrequency, 'arrow hit daha tok olmalı');
  assert.ok(hit.stoppedAt - hit.startedAt <= 0.15, 'arrow hit kısa olmalı');

  assert.equal(shoot.type, 'sawtooth');
  assert.ok(shoot.stoppedAt - shoot.startedAt <= 0.12, 'arrow shoot "pan" kısa olmalı');

  const signatures = [
    [pop.type, Math.round((pop.stoppedAt - pop.startedAt) * 1000)],
    [hit.type, Math.round((hit.stoppedAt - hit.startedAt) * 1000)],
    [shoot.type, Math.round((shoot.stoppedAt - shoot.startedAt) * 1000)],
  ];
  assert.equal(new Set(signatures.map(String)).size, 3,
    `ses imzaları çakışıyor: ${JSON.stringify(signatures)}`);
});

test('the three are quieter than the old generic explosion', () => {
  spy.reset();
  audio.playExplosion();
  const explosionPeak = Math.max(...spy.gainPeaks);

  for (const name of ['playSnakePop', 'playArrowHit', 'playArrowShoot']) {
    spy.reset();
    audio[name]();
    const peak = Math.max(...spy.gainPeaks);
    assert.ok(peak < explosionPeak,
      `${name} patlamadan sessiz olmalı (peak ${peak} >= ${explosionPeak})`);
  }
});

test('games call the new events, not the generic explosion', () => {
  assert.ok(snakeSource.includes('playSnakePop()'), 'snake ölümü playSnakePop kullanmalı');
  assert.ok(!snakeSource.includes('playExplosion'), 'snake artık playExplosion kullanmamalı');

  assert.ok(archerSource.includes('playArrowHit()'), 'ok isabeti playArrowHit kullanmalı');
  assert.ok(archerSource.includes('playArrowShoot()'), 'ok bırakımı playArrowShoot kullanmalı');
  assert.ok(archerSource.includes('playDrawTension()'), 'yay gerilmesi playDrawTension kullanmalı');
  assert.ok(!archerSource.includes('playExplosion'), 'archer artık playExplosion kullanmamalı');
});
