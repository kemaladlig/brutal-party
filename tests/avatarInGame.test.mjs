import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const noop = () => {};
const gradient = { addColorStop: noop };

/**
 * Çizim çağrılarını kaydeden sahte 2D context.
 *
 * İki şeyi birden ölçer:
 *   - `calls`: "metot(round1..roundN)" imzaları. AKSESUAR/DESEN KATMANI
 *     imzaya yeni giriş ekler (halo = ayrı `ellipse`+`stroke`, checker = 25
 *     `fillRect`), dolayısıyla "birebir aynı imza" dekorun gerçekten
 *     çizilmediğini kanıtlar.
 *   - `bounds`: çizilen bbox. "Göz büyütme silueti taşırdı mı" sorusunun
 *     sayısal cevabı — yarıçap ve çarpışma bu değere bakarak korunuyor.
 */
function makeRecorder() {
  const ctx = {
    bounds: null,
    calls: [],
    measureText: () => ({ width: 0 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  };
  const q = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : n);
  const grow = (minX, minY, maxX, maxY) => {
    if (!ctx.bounds) ctx.bounds = { minX, minY, maxX, maxY };
    else {
      ctx.bounds.minX = Math.min(ctx.bounds.minX, minX);
      ctx.bounds.minY = Math.min(ctx.bounds.minY, minY);
      ctx.bounds.maxX = Math.max(ctx.bounds.maxX, maxX);
      ctx.bounds.maxY = Math.max(ctx.bounds.maxY, maxY);
    }
  };
  const rec = (name) => (...args) => { ctx.calls.push(`${name}(${args.map(q).join(',')})`); };

  const box = (x, y, w, h) => grow(x, y, x + w, y + h);
  const ring = (x, y, rx, ry = rx) => grow(x - rx, y - ry, x + rx, y + ry);

  Object.assign(ctx, {
    save: rec('save'), restore: rec('restore'), translate: rec('translate'),
    rotate: rec('rotate'), scale: rec('scale'), clip: rec('clip'),
    beginPath: rec('beginPath'), closePath: rec('closePath'),
    fill: rec('fill'), stroke: rec('stroke'),
    moveTo: rec('moveTo'), lineTo: rec('lineTo'),
    quadraticCurveTo: rec('quadraticCurveTo'), bezierCurveTo: rec('bezierCurveTo'),
    arc(x, y, r) { ring(x, y, r); rec('arc')(-1, -1, -1); },
    ellipse(x, y, rx, ry) { ring(x, y, rx, ry); rec('ellipse')(-1, -1, -1); },
    rect(x, y, w, h) { box(x, y, w, h); rec('rect')(-1, -1, -1, -1); },
    roundRect(x, y, w, h) { box(x, y, w, h); rec('roundRect')(-1, -1, -1, -1); },
    fillRect(x, y, w, h) { box(x, y, w, h); rec('fillRect')(-1, -1, -1, -1); },
    strokeRect(x, y, w, h) { box(x, y, w, h); rec('strokeRect')(-1, -1, -1, -1); },
  });
  return ctx;
}

let server;
let drawGameAvatar;
let drawBrutalAvatar;
let blinkState;

const R = 16;
const BORDER = 2.5;
const player = { index: 0, name: 'P1', color: '#D84727', expression: 'FOCUS' };
const NOISE = { label: '', showPointer: false, borderWidth: BORDER, borderColor: '#1A1A1A' };

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

  // Cihaz profili SAHTE bir dekorla dolu: profil fallback'i sahanın
  // görünümünü kirletmesin diye. Oyun içi yol registry/profil okumamalı.
  const store = new Map([[
    'brutalparty.avatar.profile',
    JSON.stringify({ color: '#D84727', expression: 'FOCUS', accessory: 'HALO', pattern: 'CHECKER' }),
  ]]);
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
  });
  // Oyun içindeki GERÇEK yol `drawGameAvatar` (6 parametre). `drawBrutalAvatar`
  // 5 parametre alıyor; altıncıyı geçirmek bayrağı sessizce düşürüyor ve test
  // "düzeltilmiş" gibi davranırdı.
  const inGame = await server.ssrLoadModule('/src/core/avatarInGame.js');
  drawGameAvatar = inGame.drawGameAvatar;
  blinkState = inGame.blinkState;
  const renderer = await server.ssrLoadModule('/src/ui/characterRenderer.js');
  drawBrutalAvatar = renderer.drawBrutalAvatar;
});

after(async () => { await server?.close(); });

function drawInGame(opts = {}, p = player) {
  const rec = makeRecorder();
  drawGameAvatar(rec, 0, 0, R, p, { ...NOISE, ...opts });
  return rec;
}

function drawMenuFace(opts = {}) {
  const rec = makeRecorder();
  drawBrutalAvatar(rec, 0, 0, R, {
    color: player.color, slotIndex: 0, expression: 'FOCUS',
    label: '', showPointer: false, borderWidth: BORDER, borderColor: '#1A1A1A',
    ...opts,
  });
  return rec;
}

test('in-game avatar ignores every accessory, even the saved device profile', () => {
  // Profil HALO + CHECKER ile dolu (yukarıya bkz). Erişim yolu üç katman:
  // çağıranın opts'i, player alanı ve cihaz profili — üçü de gövdeyi değiştiremez.
  const plain = drawInGame();
  for (const accessory of ['NONE', 'HALO', 'WINGS', 'HEADBAND', 'CAP', 'HEADPHONES', 'HORNS',
    'MINI_CROWN', 'BONE', 'TOP_HAT', 'ANTENNA', 'HALO', 'BEANIE', 'BANDIT_MASK', 'NINJA_COWL']) {
    const viaOpts = drawInGame({ accessory });
    assert.deepEqual(viaOpts.calls, plain.calls, `opts.accessory=${accessory} changed the drawing`);
    const viaPlayer = drawInGame({}, { ...player, accessory });
    assert.deepEqual(viaPlayer.calls, plain.calls, `player.accessory=${accessory} changed the drawing`);
  }
  // Menü yolu AYNI profile'da dekoru çizmeye devam ediyor (kimlik lobiyle yaşıyor).
  const menu = drawMenuFace();
  assert.ok(menu.calls.length > plain.calls.length, 'menu face should still draw the profile accessory');
});

test('in-game avatar ignores every body pattern', () => {
  const plain = drawInGame();
  for (const pattern of ['SOLID', 'STRIPE', 'DUAL', 'TARGET', 'CHECKER', 'DOTS', 'BOLT', 'RIBBON']) {
    const viaOpts = drawInGame({ pattern });
    assert.deepEqual(viaOpts.calls, plain.calls, `opts.pattern=${pattern} changed the drawing`);
    const viaPlayer = drawInGame({}, { ...player, pattern });
    assert.deepEqual(viaPlayer.calls, plain.calls, `player.pattern=${pattern} changed the drawing`);
  }
});

test('the bigger in-game eyes stay inside the circle', () => {
  // Gözler 0.24r -> 0.30r büyüdü; kazanç bedeli siluete taşmak olurdu. Sınır:
  // çizilen bbox gövde + çerçeve'yi aşamaz (ölçülen 36x37 gövde, r=16'da).
  const expressions = ['FOCUS', 'ANGRY', 'WINK', 'DERP', 'CYCLOPS', 'HEART', 'STAR',
    'SLEEPY', 'ZOMBIE', 'GRIN', 'SHADES', 'CYBORG', 'PANIC'];
  const limit = R * 2 + BORDER * 2 + 1;
  for (const expression of expressions) {
    for (const lookAngle of [undefined, Math.PI / 2, -Math.PI / 2, Math.PI, 0.4]) {
      const { bounds } = drawInGame({ expression, lookAngle, facingAngle: 0.9 });
      const w = bounds.maxX - bounds.minX;
      const h = bounds.maxY - bounds.minY;
      assert.ok(w <= limit, `${expression} width ${w.toFixed(2)} exceeds ${limit}`);
      assert.ok(h <= limit, `${expression} height ${h.toFixed(2)} exceeds ${limit}`);
    }
  }
});

test('the in-game face adds inner volume without growing the silhouette', () => {
  // Hacim iki gradient `fillRect`'i: hepsi clip içinde, dışarı taşan katman yok.
  const withVolume = drawInGame();
  const menuFace = drawMenuFace({ faceMode: 'play' });
  assert.deepEqual(withVolume.calls, menuFace.calls, 'wrapper must force the play face mode');

  // Hacim yalnız oyun içi kipte var: `full` kipte (menü/lobi) iki `fillRect` eksik.
  // Profilde CHECKER/HALO dolu olduğu için taban değerleri AÇIKÇA sabitlenir.
  const fills = (rec) => rec.calls.filter((c) => c.startsWith('fillRect')).length;
  const menuPlain = drawMenuFace({ accessory: 'NONE', pattern: 'SOLID' });
  assert.equal(fills(withVolume) - fills(menuPlain), 2);
});

test('blink closes the eyes and is offset per slot', () => {
  // Kırpma verilen `now`'dan türetilir → test deterministik.
  const closed = (now, slot = 0) => blinkState(now, slot) === 1;
  const period = 2600;

  // Bir periyot içinde slot hem kırpar hem açık kalır.
  let sawClosed = false;
  let sawOpen = false;
  for (let t = 0; t < period; t += 10) {
    if (closed(t, 0)) sawClosed = true; else sawOpen = true;
  }
  assert.ok(sawClosed && sawOpen, 'a slot must both blink and stay open within one period');

  // Faz kaydırması: aynı anda slot 0 kapalıyken slot 1 açık olmalı.
  const phaseShifted = [...Array(period / 10).keys()]
    .map((i) => i * 10)
    .filter((t) => closed(t, 0) && !closed(t, 1));
  assert.ok(phaseShifted.length > 0, 'slots must not blink in sync');
});

test('the look angle moves the eyes without turning the body', () => {
  const forward = drawInGame({ facingAngle: 0, lookAngle: undefined });
  const left = drawInGame({ facingAngle: 0, lookAngle: Math.PI / 2 });
  const right = drawInGame({ facingAngle: 0, lookAngle: -Math.PI / 2 });
  assert.notDeepEqual(left.calls, right.calls, 'gaze should differ per side');

  // Gövde dönüşü yerinde kalır: dönüş SAYISI aynı, sadece yüz grubunun açısı
  // değişir. Gövdeyle birlikte dönseydi tüm `rotate` imzaları kayar ve avatar
  // "baktığı yöne bakan bir yüz" olmaktan çıkardı.
  const rotates = (rec) => rec.calls.filter((c) => c.startsWith('rotate'));
  assert.equal(rotates(left).length, rotates(forward).length);
  assert.notDeepEqual(rotates(left), rotates(forward), 'the face group should rotate');
  // Kayma 0.22 rad ile sınırlı: yön okuma çizgisiyle çelişmemeli.
  const faceAngle = Number(rotates(left).at(-1).slice(7, -1));
  assert.ok(Math.abs(faceAngle) <= 0.23, `gaze shift ${faceAngle} exceeds the 0.22 rad clamp`);
});

test('menu face mode is unchanged by the in-game contract', () => {
  // `full` kip (lobi, kişiselleştirme, kumanda önizlemesi) dekor çizmeye devam eder.
  const full = drawMenuFace({ accessory: 'MINI_CROWN', pattern: 'RIBBON' });
  const plain = drawMenuFace({ accessory: 'NONE', pattern: 'SOLID' });
  assert.notDeepEqual(full.calls, plain.calls, 'menu face must keep accessory/pattern rendering');
});
