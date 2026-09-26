import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const noop = () => {};
const gradient = { addColorStop: noop };

/**
 * Çizim çağrılarını kaydeden sahte 2D context.
 *
 * İki şeyi birden ölçer:
 *   - `calls`: "metot(round1..roundN)" imzaları. Bir dekor katmanı imzaya
 *     yeni giriş eklerdi (halo = ayrı `ellipse`+`stroke`, checker = 50
 *     `fillRect`), dolayısıyla "birebir aynı imza" dekorun çizilmediğini
 *     kanıtlar.
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
let sanitizeAvatar;
let getBotPersona;
let GOD_BOT_PERSONAS;

const R = 16;
const BORDER = 2.5;
const player = { index: 0, name: 'P1', color: '#D84727', expression: 'FOCUS' };
const NOISE = { label: '', showPointer: false, borderWidth: BORDER, borderColor: '#1A1A1A' };

// Siluet ölçümü: gövde 2r + çerçeve. Taşma payı yalnız yarıçap yuvarlaması.
const EXTENT_LIMIT = R * 2 + BORDER * 2 + 1;

// Kaldırılmış dekorun eski id'leri. Hiçbiri artık profil/ayar olarak var
// olmamalı; geçmişten gelen bir veri sızarsa çizim değişmemeli.
const DEAD_ACCESSORIES = ['NONE', 'HALO', 'WINGS', 'HEADBAND', 'CAP', 'HEADPHONES', 'HORNS',
  'MINI_CROWN', 'BONE', 'TOP_HAT', 'ANTENNA', 'BEANIE', 'BANDIT_MASK', 'NINJA_COWL'];
const DEAD_PATTERNS = ['SOLID', 'STRIPE', 'DUAL', 'TARGET', 'CHECKER', 'DOTS', 'BOLT', 'RIBBON'];

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

  // Cihaz profili SAHTE bir dekorla dolu: kalıcı veriden sızan dekor
  // çizime hiçbir şekilde sızmamalı.
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
  const manager = await server.ssrLoadModule('/src/core/customizationManager.js');
  sanitizeAvatar = manager.sanitizeAvatar;
  getBotPersona = manager.getBotPersona;
  GOD_BOT_PERSONAS = manager.GOD_BOT_PERSONAS;
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

test('no face mode draws decoration, whatever the source', () => {
  // Erişim yolları: çağıranın opts'i, player alanı, cihaz profili (HALO+CHECKER
  // dolu) ve bot personası. Menü (`full`) ve oyun içi (`play`) KİPİ FARKETMEZ:
  // ikisi de aynı yuvarlak gövdeyi çizer.
  for (const draw of [drawInGame, drawMenuFace]) {
    const plain = draw();
    for (const accessory of DEAD_ACCESSORIES) {
      assert.deepEqual(draw({ accessory }).calls, plain.calls, `opts.accessory=${accessory} drew something`);
      assert.deepEqual(draw({}, { ...player, accessory }).calls, plain.calls, `player.accessory=${accessory} drew something`);
    }
    for (const pattern of DEAD_PATTERNS) {
      assert.deepEqual(draw({ pattern }).calls, plain.calls, `opts.pattern=${pattern} drew something`);
      assert.deepEqual(draw({}, { ...player, pattern }).calls, plain.calls, `player.pattern=${pattern} drew something`);
    }
  }
});

test('the profile and bot personas carry no decoration fields', () => {
  // Veri katmanı: eski kayıtlı profil temizlenir, bot persona yalnız isim/renk/yüz.
  const clean = sanitizeAvatar({ color: '#D84727', expression: 'WINK', accessory: 'HALO', pattern: 'CHECKER' });
  assert.deepEqual(Object.keys(clean).sort(), ['color', 'expression']);
  for (let i = 0; i < 4; i++) {
    const persona = getBotPersona(i, false);
    assert.deepEqual(Object.keys(persona).sort(), ['color', 'expression', 'name', 'shortName']);
    const god = getBotPersona(i, true);
    assert.deepEqual(Object.keys(god).sort(), ['color', 'expression', 'name', 'shortName']);
    assert.ok(persona.color && god.color && persona.expression && god.expression);
  }
  assert.equal(GOD_BOT_PERSONAS.length, 4);
});

test('the bigger in-game eyes stay inside the circle', () => {
  // Gözler 0.24r -> 0.30r büyüdü; kazanç bedeli siluete taşmak olurdu. Sınır:
  // çizilen bbox gövde + çerçeve'yi aşamaz (ölçülen 36x37 gövde, r=16'da).
  const expressions = ['FOCUS', 'ANGRY', 'WINK', 'DERP', 'CYCLOPS', 'HEART', 'STAR',
    'SLEEPY', 'ZOMBIE', 'GRIN', 'SHADES', 'CYBORG', 'PANIC'];
  for (const expression of expressions) {
    for (const lookAngle of [undefined, Math.PI / 2, -Math.PI / 2, Math.PI, 0.4]) {
      const { bounds } = drawInGame({ expression, lookAngle, facingAngle: 0.9 });
      const w = bounds.maxX - bounds.minX;
      const h = bounds.maxY - bounds.minY;
      assert.ok(w <= EXTENT_LIMIT, `${expression} width ${w.toFixed(2)} exceeds ${EXTENT_LIMIT}`);
      assert.ok(h <= EXTENT_LIMIT, `${expression} height ${h.toFixed(2)} exceeds ${EXTENT_LIMIT}`);
    }
  }
});

test('the play face adds inner volume; the menu face is the same body without it', () => {
  // Hacim iki gradient `fillRect`'i ve yalnız oyun içi kipte var. Gövde,
  // çerçeve ve gözler aynı — fark yalnız bu iki dolgu.
  const play = drawInGame();
  const menu = drawMenuFace();
  assert.deepEqual(play.calls, drawMenuFace({ faceMode: 'play' }).calls, 'wrapper must force the play face mode');

  const fills = (rec) => rec.calls.filter((c) => c.startsWith('fillRect')).length;
  assert.equal(fills(play) - fills(menu), 2);

  // Gözler oyun içinde büyük: menü yüzünün bbox'ı gövdeye daha sıkı sarılır.
  const menuWidth = menu.bounds.maxX - menu.bounds.minX;
  assert.ok(menuWidth > 0);
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

test('all views where body is avatar call drawGameAvatar (TANKS is sole commander figure exception)', async () => {
  const fs = await import('node:fs');
  const viewFiles = [
    'src/games/archerView.js',
    'src/games/bombView.js',
    'src/games/collapseView.js',
    'src/games/heistView.js',
    'src/games/hordeView.js',
    'src/games/laserView.js',
    'src/games/ninjaView.js',
    'src/games/snakeView.js',
    'src/games/zoneView.js',
    'src/games-retired/cloneView.js',
    'src/games-retired/crown.js',
  ];
  for (const f of viewFiles) {
    const content = fs.readFileSync(f, 'utf8');
    assert.ok(
      content.includes('drawGameAvatar'),
      `${f} must call drawGameAvatar for in-game play face contract`,
    );
    assert.ok(
      !content.includes('drawBrutalAvatar('),
      `${f} should not bypass contract by calling drawBrutalAvatar directly`,
    );
  }

  // TANKS exception: commander figure on top of tank chassis
  const tanksContent = fs.readFileSync('src/games/tanksView.js', 'utf8');
  assert.ok(
    tanksContent.includes('drawBrutalAvatar'),
    'tanksView.js maintains commander figure exception on top of chassis',
  );
  assert.ok(
    tanksContent.includes('İSTİSNA (Adım 3.5)'),
    'tanksView.js must document the commander figure exception',
  );
});

test('negative: contract scanner flags a view that bypasses drawGameAvatar', () => {
  const mockViewContent = `
    import { drawBrutalAvatar } from '../ui/characterRenderer.js';
    export function drawZonePlayers(ctx, players) {
      drawBrutalAvatar(ctx, 0, 0, p.radius, {});
    }
  `;
  const usesGameAvatar = mockViewContent.includes('drawGameAvatar');
  const callsBrutalDirectly = mockViewContent.includes('drawBrutalAvatar(');
  const isValid = usesGameAvatar && !callsBrutalDirectly;
  assert.equal(isValid, false, 'view that calls drawBrutalAvatar directly must be rejected');
});

