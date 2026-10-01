// HORDE ses ayrımı — "düşman mı öldü, ben mi hasar yedim" sorusunun kulakla
// yanıtlanabilir olması. Kalabalıkta üç olay üst üste biniyordu ve hepsi
// `sawtooth` aileden iki farklı sesle (`playExplosion` 120→25,
// `playStumble` 320→75) çalıyordu; oyuncu hangisinin kendisine olduğunu
// ayırt edemiyordu.
//
// Sözleşme (bu test kilitler):
//   kill  → üçgen dalga, tiz/kısa   (ben vurdum)
//   hurt  → kare dalga, bas/uzun    (bana isabet etti)
//   boom  → testere, derin/uzun     (bomba patladı)
//   fuse  → kare dalga, tiz tik     (kaç saniye var)
//
// Uyarı: `hurt` ve `fuse` ikisi de `square`. Ayırıcı paket uzunluğu ve
// yüksekliktir (fuse 0.04 sn kısa tik, hurt 0.23 sn sürekli) — bu yüzden
// eşitlik `type` üzerinden değil `(type, duration)` çifti üzerinden kurulur.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';

const noop = () => {};

/** Ses çağrılarını kaydeden sahte AudioContext. */
function createAudioSpy() {
  const calls = [];
  let shared = null;
  return {
    calls,
    get last() { return calls[calls.length - 1]; },
    context: {
      currentTime: 0,
      state: 'running',
      sampleRate: 48000,
      destination: {},
      resume: noop,
      createBufferSource: () => ({
        buffer: null,
        connect: noop,
        start: noop,
        stop: noop,
      }),
      createBiquadFilter: () => ({
        type: '',
        frequency: { setValueAtTime: noop, exponentialRampToValueAtTime: noop },
        connect: noop,
      }),
      createGain: () => ({
        gain: { setValueAtTime: noop, exponentialRampToValueAtTime: noop },
        connect: noop,
      }),
      createOscillator() {
        const entry = {
          type: '',
          startFrequency: 0,
          endFrequency: 0,
          startedAt: 0,
          stoppedAt: 0,
        };
        calls.push(entry);
        shared = entry;
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
    /** Kaç osilatör çaldı (bazı sesler üçlü akor kullanır). */
    count: () => calls.length,
    reset() { calls.length = 0; },
  };
}

let server;
let audio;
let spy;
let hordeSource;

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
  globalThis.window.webkitAudioContext = globalThis.window.AudioContext;
  audio = await server.ssrLoadModule('/src/audio.js');
  hordeSource = readFileSync(new URL('../src/games/horde.js', import.meta.url), 'utf8');
});

after(async () => {
  await server?.close();
});

function play(name, ...args) {
  spy.reset();
  audio[name](...args);
  return spy.last;
}

test('horde kill, hurt, bomb and fuse read as four different voices', () => {
  const kill = play('playHordeKill');
  const hurt = play('playHordeHurt');
  const boom = play('playHordeBoom');
  const tick = play('playHordeBombTick', 1);

  // Kill tiz ve kısa: kalabalıkta "ben vurdum" işareti, arka planda kaybolmaz.
  assert.equal(kill.type, 'triangle');
  assert.ok(kill.startFrequency >= 600, `kill tiz olmalı, got ${kill.startFrequency}`);
  assert.ok(kill.stoppedAt - kill.startedAt <= 0.12, 'kill kısa olmalı');

  // Hurt bas ve uzun: vurulma duyulmalı, kill'le karışmamalı.
  assert.equal(hurt.type, 'square');
  assert.ok(hurt.startFrequency <= 260, `hurt bas olmalı, got ${hurt.startFrequency}`);
  assert.ok(hurt.stoppedAt - hurt.startedAt >= 0.2, 'hurt sürekli ve uzun olmalı');

  // Boom en derin ve en uzun: saha çapında "bir şey patladı".
  assert.equal(boom.type, 'sawtooth');
  assert.ok(boom.startFrequency <= 120, `boom derin olmalı, got ${boom.startFrequency}`);
  assert.ok(boom.stoppedAt - boom.startedAt >= 0.4, 'boom uzun olmalı');

  // Fuse tik: kısa tetik, kaçış zamanlamasını verir.
  assert.equal(tick.type, 'square');
  assert.ok(tick.stoppedAt - tick.startedAt <= 0.06, 'fuse tiki kısa olmalı');

  // (type, süre) çiftleri tekil olmalı — aksi hâlde "karışıyor" geri bildirimi
  // tam olarak bu eşleşmeyle gelirdi.
  const signatures = [
    [kill.type, Math.round((kill.stoppedAt - kill.startedAt) * 1000)],
    [hurt.type, Math.round((hurt.stoppedAt - hurt.startedAt) * 1000)],
    [boom.type, Math.round((boom.stoppedAt - boom.startedAt) * 1000)],
    [tick.type, Math.round((tick.stoppedAt - tick.startedAt) * 1000)],
  ];
  assert.equal(new Set(signatures.map(String)).size, 4,
    `ses imzaları çakışıyor: ${JSON.stringify(signatures)}`);

  // Aciliyet fuse'u yukarı taşır: son saniyeler daha tiz.
  const calmTick = play('playHordeBombTick', 0);
  assert.ok(play('playHordeBombTick', 1).startFrequency > calmTick.startFrequency,
    'fuse tizi aciliyetle artmalı');
});

test('trash kill sound is throttled, hurt and elite kill are not', () => {
  // Sıradan kill sesi 70 ms'den sık çalınmaz: kalabalıkta saniyede onlarca
  // kill sesi hasar sesini maskeliyordu. Hurt ve elit/boss kill'i HER zaman
  // çalar — onlar bilgi taşır, spam değildir.
  assert.ok(hordeSource.includes('SLAY_SOUND_THROTTLE'), 'kill sesi throttle tanımlı olmalı');
  assert.ok(hordeSource.includes('playHordeKill()'), 'sıradan kill playHordeKill kullanmalı');
  assert.ok(hordeSource.includes('playHordeHurt()'), 'hasar playHordeHurt kullanmalı');
  assert.ok(hordeSource.includes('playHordeBoom()'), 'bomba playHordeBoom kullanmalı');
  assert.ok(!hordeSource.includes('playStumble'),
    'horde artık genel hasar sesi playStumble kullanmamalı (hurt ailesine taşındı)');

  // Throttle uygulaması tek noktada: kill sesi iki kez sorulmaz, elite her seferinde.
  const slayBlock = hordeSource.slice(hordeSource.indexOf('this.spawnFloatingText(enemy.x, enemy.y - enemy.radius'));
  assert.ok(slayBlock.includes('if (eliteKill)'), 'elit/boss kill yolunda olmalı');
  assert.ok(slayBlock.includes('SLAY_SOUND_THROTTLE'), 'sıradan kill throttle içinde olmalı');
});
