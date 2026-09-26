import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const noop = () => {};
const gradient = { addColorStop: noop };

/**
 * Dönüşümü de izleyen sahte 2D context. `avatarInGame.test.mjs` kaydından
 * farkı: save/restore yığın derinliği + güncel dönüşüm matrisi tutulur.
 * Böylece "çizim fonksiyonu çağıranın transform'unu kirletiyor mu" sorusu
 * sayısal cevaplanır — menü kartındaki dokunma patlaması bu yüzden kutunun
 * sağ-altına kaymıştı (sızan `translate(cx, cy)`).
 */
function makeTrackingCtx() {
  const mul = (m, t) => [
    m[0] * t[0] + m[2] * t[1],
    m[1] * t[0] + m[3] * t[1],
    m[0] * t[2] + m[2] * t[3],
    m[1] * t[2] + m[3] * t[3],
    m[0] * t[4] + m[2] * t[5] + m[4],
    m[1] * t[4] + m[3] * t[5] + m[5],
  ];
  const ctx = {
    stack: [],
    m: [1, 0, 0, 1, 0, 0],
    underflows: 0,
    calls: [],
    measureText: () => ({ width: 0 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  };
  return new Proxy(ctx, {
    get(target, key) {
      if (key === 'save') return () => { target.stack.push([...target.m]); target.calls.push('save'); };
      if (key === 'restore') {
        return () => {
          target.calls.push('restore');
          const prev = target.stack.pop();
          if (prev) target.m = prev;
          else target.underflows += 1;
        };
      }
      if (key === 'translate') return (x, y) => { target.m = mul(target.m, [1, 0, 0, 1, x, y]); };
      if (key === 'rotate') {
        return (a) => {
          const c = Math.cos(a);
          const s = Math.sin(a);
          target.m = mul(target.m, [c, s, -s, c, 0, 0]);
        };
      }
      if (key === 'scale') return (x, y) => { target.m = mul(target.m, [x, 0, 0, y === undefined ? x : y, 0, 0]); };
      if (key === 'setTransform') {
        return (a, b, c, d, e, f) => {
          if (a !== undefined) target.m = [a, b, c, d, e, f];
          else target.m = [1, 0, 0, 1, 0, 0];
        };
      }
      if (key === 'getTransform') {
        return () => {
          const [a, b, c, d, e, f] = target.m;
          return { a, b, c, d, e, f };
        };
      }
      if (key in target) return target[key];
      return () => { target.calls.push(String(key)); };
    },
    set(target, key, value) { target[key] = value; return true; },
  });
}

let server;
let drawAvatarStage;
let spawnBoingSparks;
let stepSparks;
let drawSparks;
let drawBrutalAvatar;

before(async () => {
  globalThis.window = {
    innerWidth: 1440, innerHeight: 900,
    addEventListener: noop, removeEventListener: noop,
    AudioContext: null, webkitAudioContext: null,
    matchMedia: () => ({ matches: false }),
  };
  globalThis.document = {
    activeElement: null, body: {},
    addEventListener: noop,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ width: 0, height: 0, getContext: () => makeTrackingCtx() }),
  };
  globalThis.localStorage = {
    getItem: () => null, setItem: noop, removeItem: noop,
  };
  server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
  });
  const stage = await server.ssrLoadModule('/src/ui/avatarStage.js');
  drawAvatarStage = stage.drawAvatarStage;
  spawnBoingSparks = stage.spawnBoingSparks;
  stepSparks = stage.stepSparks;
  drawSparks = stage.drawSparks;
  const renderer = await server.ssrLoadModule('/src/ui/characterRenderer.js');
  drawBrutalAvatar = renderer.drawBrutalAvatar;
});

after(async () => { await server?.close(); });

// Deterministik LCG — prob (`?probe=sparks`) ile aynı tohum.
function seededRand(seedStart = 1234567) {
  let seed = seedStart;
  return () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

const W = 200;
const H = 200;
const R = 74; // 200px kutuda %74 gövde
const CX = W / 2;
const CY = H / 2;

function menuFrame(expr = 'FOCUS') {
  const ctx = makeTrackingCtx();
  ctx.setTransform(2, 0, 0, 2, 0, 0); // syncStageCanvas (dpr=2)
  const depthBefore = ctx.stack.length;
  drawAvatarStage(ctx, W, H, R, { color: '#2F6A4F', expression: expr, facingAngle: 0.4 });
  const sparks = spawnBoingSparks(CX, CY, R, '#2F6A4F', seededRand());
  for (let t = 0; t < 0.3; t += 1 / 60) stepSparks(sparks, R, 1 / 60);
  drawSparks(ctx, R, sparks);
  return { ctx, sparks, depthBefore };
}

test('avatar drawing does not leak canvas state into the frame', () => {
  for (const expr of ['FOCUS', 'WINK', 'GRIN', 'SLEEPY']) {
    const { ctx, depthBefore } = menuFrame(expr);
    // Yığın derinliği kare başına sabit kalmalı: sızan her `save`, kare
    // sonunda `restore` ile dengelenir (biriken seviye bellek sızıntısıdır).
    assert.equal(ctx.stack.length, depthBefore, `${expr}: save/restore dengesiz`);
    assert.equal(ctx.underflows, 0, `${expr}: fazla restore var`);
    // Dönüşüm, sync'in kurduğu dpr ölçeğinde kalmalı: sızan translate,
    // patlamayı kutunun sağ-altına (+w/2, +h/2) taşıyordu.
    assert.deepEqual(
      ctx.m.map((v) => Math.round(v * 1000) / 1000),
      [2, 0, 0, 2, 0, 0],
      `${expr}: transform kirlendi`,
    );
  }
});

test('drawBrutalAvatar alone is state-neutral', () => {
  const ctx = makeTrackingCtx();
  drawBrutalAvatar(ctx, 50, 50, 30, {
    color: '#D84727', slotIndex: 0, expression: 'FOCUS', facingAngle: 0.4,
  });
  assert.equal(ctx.stack.length, 0);
  assert.equal(ctx.underflows, 0);
  assert.deepEqual(ctx.m, [1, 0, 0, 1, 0, 0]);
});

test('the touch burst stays centered on its spawn point', () => {
  const { sparks } = menuFrame();
  // t=0.30'da hepsi canlı olmalı (ölü kıvılcım sayılmaz).
  assert.equal(sparks.length, 10);

  // Altın kıvılcımların konum ağırlık merkezi: simetrik doğuş + yerçekimi
  // düşüşü dışında kayma olmamalı. Sınırlar tohum paylı ama cömert:
  // sistematik kayma (örn. sızan translate) r mertebesinde çıkardı.
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const p of sparks) {
    if (p.color !== '#FFD700') continue;
    sx += p.x;
    sy += p.y;
    n += 1;
  }
  assert.equal(n, 5);
  const dx = (sx / n - CX) / R;
  const dy = (sy / n - (CY - R * 0.23)) / R;
  assert.ok(Math.abs(dx) <= 0.4, `yatay kayma ${dx.toFixed(2)}r`);
  assert.ok(dy >= -0.4 && dy <= 0.4, `dikey kayma ${dy.toFixed(2)}r`);
});
