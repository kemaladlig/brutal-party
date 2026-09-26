// AvatarLife deterministiklik testleri — yaşam makinesi saf zaman tabanlıdır:
// aynı poke geometrisi + aynı (now, dt) dizisi → aynı kare çıktıları. Canvas
// stub'larına ihtiyaç duymaz; modül zinciri (`avatarStage` → `characterRenderer`
// → `tokens`) yüzünden vite-SSR yükleyicisi `avatarStage.test.mjs` ile aynı.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const noop = () => {};

let server;
let createAvatarLife;

before(async () => {
  globalThis.window = {
    innerWidth: 1440, innerHeight: 900,
    addEventListener: noop, removeEventListener: noop,
    AudioContext: null, webkitAudioContext: null,
    matchMedia: () => ({ matches: false }),
  };
  globalThis.document = {
    activeElement: null, body: {},
    addEventListener: noop, removeEventListener: noop,
    getElementById: () => null,
    querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({ width: 0, height: 0, getContext: () => ({}) }),
  };
  globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
  server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
  });
  createAvatarLife = (await server.ssrLoadModule('/src/ui/avatarLife.js')).createAvatarLife;
});

after(async () => { await server?.close(); });

const R = 50;
const FRAME = 1 / 60;
const T0 = 10_000;
const POK = { x: R, y: 0, centerX: R, centerY: R, radius: R, color: '#F0483C' };
const BASE = { expression: 'FOCUS' };

const scalarFrame = (out) => ({
  yOffset: out.yOffset,
  shadowScale: out.shadowScale,
  scale: out.scale,
  facingAngle: out.facingAngle,
  isBlinking: out.isBlinking,
  expression: out.expression,
  ringPulse: out.ringPulse,
});

test('poke jumps: shadow lifts off ground, STAR face, sparks, ring pulse', () => {
  const life = createAvatarLife({ preset: 'home' });
  life.poke(POK);
  const first = scalarFrame(life.step(T0 + 16, FRAME, R, BASE));
  // Zıplama kanıtı: gölge ölçeği 1'den küçülmeli (yOffset nefes ten yalnızca
  // ~0.1r iner; gölge sadece jumpY ile ölçeklenir).
  assert.ok(first.shadowScale < 1, `gölge küçülmedi: ${first.shadowScale}`);
  assert.equal(first.expression, 'STAR');
  assert.equal(life.sparks.length, 10);
  assert.ok(first.ringPulse > 0.9);

  // Tepe yüksekliği ≈ impulse²/(2·g) = 1.8²/8.4 = 0.386r → gölge ≈ 0.79.
  let minShadow = 1;
  for (let t = T0 + 32; t < T0 + 1000; t += FRAME * 1000) {
    minShadow = Math.min(minShadow, life.step(t, FRAME, R, BASE).shadowScale);
  }
  assert.ok(minShadow > 0.5 && minShadow < 0.9, `tepe gölgesi ${minShadow}`);
});

test('jump lands within ~1s and every envelope returns to rest', () => {
  const life = createAvatarLife({ preset: 'home' });
  life.poke(POK);
  let out = null;
  for (let t = T0; t < T0 + 1200; t += FRAME * 1000) out = life.step(t, FRAME, R, BASE);
  assert.equal(out.shadowScale, 1);          // zeminde
  assert.equal(out.expression, 'FOCUS');      // coşku 0.9 sn'de bitti
  assert.equal(out.ringPulse, 0);
  assert.equal(life.sparks.length, 0);        // kıvılcımlar söndü
});

test('reduced motion: no jump/breath/hop, but full non-visual feedback', () => {
  const life = createAvatarLife({ preset: 'home', reducedMotion: () => true });
  life.poke(POK);
  let out = null;
  // 8 sn'lik pencere idle hop periyodunu (7.5 sn) de kapsar — hiç kıpırdamamalı.
  for (let t = T0; t < T0 + 8000; t += FRAME * 1000) {
    out = scalarFrame(life.step(t, FRAME, R, BASE));
    assert.equal(out.yOffset, 0, `hareketsiz modda zıplama: ${out.yOffset}`);
    assert.equal(out.scale, 1, `hareketsiz modda ölçek: ${out.scale}`);
    assert.equal(out.shadowScale, 1, `hareketsiz modda gölge oynadı: ${out.shadowScale}`);
  }
  assert.equal(out.expression, 'FOCUS'); // coşku zarfı 0.9 sn — 8 sn sonra sönük
  assert.equal(out.ringPulse, 0);
  assert.equal(life.sparks.length, 0);
  // Dokunma anında görsel geri bildirim DURUYOR (hareketsizlik = tepkisizlik değil):
  const life2 = createAvatarLife({ preset: 'home', reducedMotion: () => true });
  life2.poke(POK);
  const fresh = life2.step(T0 + 16, FRAME, R, BASE);
  assert.equal(fresh.expression, 'STAR');
  assert.equal(life2.sparks.length, 10);
  assert.ok(fresh.ringPulse > 0);
});

test('gaze lerps toward target then relaxes to idle sway', () => {
  const life = createAvatarLife({ preset: 'home' });
  life.gaze(1.0);
  let angle = 0;
  for (let t = T0; t < T0 + 500; t += FRAME * 1000) angle = life.step(t, FRAME, R, BASE).facingAngle;
  assert.ok(angle > 0.3 && angle < 1.0, `bakış hedefe yaklaşmadı: ${angle}`);
  // gazeHold (1.4 sn) bitince doğal salınıma döner (|açı| ≤ swayAmp + taşım).
  for (let t = T0 + 500; t < T0 + 4000; t += FRAME * 1000) angle = life.step(t, FRAME, R, BASE).facingAngle;
  assert.ok(Math.abs(angle) <= 0.2, `salınım genliği aşıldı: ${angle}`);
});

test('identical pokes produce identical frame streams (determinism)', () => {
  const a = createAvatarLife({ preset: 'modal' });
  const b = createAvatarLife({ preset: 'modal' });
  a.poke(POK);
  b.poke(POK);
  for (let t = T0; t < T0 + 600; t += FRAME * 1000) {
    assert.deepEqual(scalarFrame(a.step(t, FRAME, R, BASE)), scalarFrame(b.step(t, FRAME, R, BASE)));
  }
});
