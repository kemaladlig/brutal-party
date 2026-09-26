import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const noop = () => {};
const gradient = { addColorStop: noop };

/**
 * Çizim çağrılarını kaydeden sahte 2D context. `arc`/`ellipse` için merkezden
 * yarıçap çıkarılır, böylece "en üstte neresi çizildi" sayısal izlenebilir.
 */
function makeRecorder() {
  // Kayıt durumu ctx hedefinin ÜSTÜNDE tutulur: proxy `get` trap'i `key in
  // target` ile döndürüyor, dışarıdaki bir değişken hedefte olmadığı için
  // dışarıdan okunamıyordu (minY bir fonksiyon döndürüyordu).
  const ctx = {
    minY: Infinity,
    calls: 0,
    measureText: () => ({ width: 0 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  };
  const note = (y) => {
    if (typeof y === 'number' && Number.isFinite(y) && y < ctx.minY) ctx.minY = y;
  };
  Object.assign(ctx, {
    arc(_x, cy, r) { note(cy - r); },
    ellipse(_x, cy, _rx, ry) { note(cy - ry); },
    rect(_x, y, _w, h) { note(y); },
    roundRect(_x, y, _w, h) { note(y); },
    fillRect(_x, y, _w, h) { note(y); },
    strokeRect(_x, y, _w, h) { note(y); },
    moveTo(_x, y) { note(y); },
    lineTo(_x, y) { note(y); },
    quadraticCurveTo(_cx, cy, _x, y) { note(cy); note(y); },
    bezierCurveTo(c1y, c2y, _ex, ey) { note(c1y); note(c2y); note(ey); },
  });
  return new Proxy(ctx, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args) => { note(args[1]); target.calls += 1; };
    },
    set(target, key, value) { target[key] = value; return true; },
  });
}

let server;
let drawGameAvatar;
let SILHOUETTE_OVERFLOW;

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
    createElement: () => ({ width: 0, height: 0, getContext: () => makeRecorder() }),
  };
  server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
  });
  const mod = await server.ssrLoadModule('/src/ui/characterRenderer.js');
  SILHOUETTE_OVERFLOW = mod.SILHOUETTE_OVERFLOW;
  // `drawGameAvatar` kullanılıyor, `drawBrutalAvatar` değil: oyun içindeki gerçek
  // yol bu. İkisi imzayla ayrılıyor —
  //   drawBrutalAvatar(ctx, x, y, radius, options)            -> 5 parametre
  //   drawGameAvatar(ctx, x, y, radius, player, opts)         -> 6 parametre
  // Altıncı parametreyi `drawBrutalAvatar`'a geçirmek bayrağı sessizce
  // düşürüyor ve test "düzeltilmiş" gibi davranıyordu.
  const inGame = await server.ssrLoadModule('/src/core/avatarInGame.js');
  drawGameAvatar = inGame.drawGameAvatar;
});

after(async () => { await server?.close(); });

const R = 16;
const player = { index: 0, name: 'P1', color: '#D84727', expression: 'FOCUS' };

function topEdge(accessory, opts = {}) {
  const rec = makeRecorder();
  // Aksesuar `opts` üzerinden geçmeli: `drawGameAvatar` `player.accessory`'ı
  // okumuyor, okuyan yer `drawBrutalAvatar`'ın profil/registry fallback'i —
  // SSR'de o da NONE'a düşüyor ve test sessizce hiçbir şey ölçmezdi.
  drawGameAvatar(rec, 0, 0, R, player, {
    label: '', showPointer: false, accessory, ...opts,
  });
  return rec.minY;
}

test('the silhouette overflow list holds only halo and wings', () => {
  // Liste kasıtlı olarak MİNİMAL. Ölçülen çizilen bbox (yarıçap 16):
  //   gövde 36x37 · HALO 36x45 · WINGS 49x40 · BOLT/CROWN/COWL 36x37
  // Yani listede olmayan bir aksesuarın gövdeyi taşımadığı ÖLÇÜLMÜŞTÜR; liste
  // genişletilirse kimliğin gereksiz kısmı da bastırılır.
  assert.deepEqual([...SILHOUETTE_OVERFLOW].sort(), ['HALO', 'WINGS']);
});

test('the halo pushes the drawn silhouette above the body', () => {
  const plain = topEdge('NONE');
  const halo = topEdge('HALO');
  assert.ok(
    halo < plain - 1,
    `HALO should reach higher than the bare body (plain ${plain}, halo ${halo})`,
  );
  // Gövde yarıçapı 16; halo -16'nın belirgin üstüne çıkıyor.
  assert.ok(halo < -R * 1.2, `halo top ${halo} should exceed -${R * 1.2}`);
});

test('compactSilhouette removes the overflow and leaves the body untouched', () => {
  const plain = topEdge('NONE');
  const compactedHalo = topEdge('HALO', { compactSilhouette: true });
  const compactedWings = topEdge('WINGS', { compactSilhouette: true });

  // Bastırılan avatar, aksesuarsız gövdeyle AYNI yükseklikte çizilmeli —
  // bastırmak gövdeyi küçültmemeli, sadece taşan katmanı kaldırmalı.
  assert.ok(
    Math.abs(compactedHalo - plain) < 1.5,
    `compact HALO (${compactedHalo}) should match the bare body (${plain})`,
  );
  assert.ok(
    Math.abs(compactedWings - plain) < 1.5,
    `compact WINGS (${compactedWings}) should match the bare body (${plain})`,
  );
});

test('compactSilhouette keeps accessories that stay inside the body', () => {
  // BOLT/CROWN/COWL gövde sınırları içinde — bastırılırsa kimlik boşa gider.
  for (const accessory of ['BOLT', 'CROWN', 'NINJA_COWL', 'ANTENNA']) {
    const normal = topEdge(accessory);
    const compacted = topEdge(accessory, { compactSilhouette: true });
    assert.ok(
      Math.abs(normal - compacted) < 0.001,
      `${accessory} should be untouched by compactSilhouette (${normal} -> ${compacted})`,
    );
  }
});

test('compactSilhouette is opt-in: without it nothing changes', () => {
  const normal = topEdge('HALO');
  const explicitNone = topEdge('NONE');
  assert.ok(normal < explicitNone - 1, 'sanity: the halo really does extend upward');
  // Bayrak verilmediğinde halo çizilmeye devam etmeli.
  assert.ok(normal < -R * 1.2, `unflagged halo (${normal}) should still overflow`);
});
