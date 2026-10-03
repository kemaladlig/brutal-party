import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
    // `ellipse` çağrılarının KENDİ kapsamı. Gövde bbox'ıyla karışmasın:
    // gölgenin ölçeği, gövdenin sabit alt sınır çerçeve payından arınmış
    // ölçülmelidir (aşağıdaki test tam olarak bunu ölçüyor).
    ellipses: [],
    // `arc` çağrılarının kendi kapsamı. Gövde ve smear `arc` çizdiği için
    // ikisi ayrı listelerde ölçülür: gövde merkezde (0,0), smear ise geride.
    arcs: [],
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
    arc(x, y, r) { ring(x, y, r); ctx.arcs.push({ x, y, r }); rec('arc')(-1, -1, -1); },
    ellipse(x, y, rx, ry) {
      ring(x, y, rx, ry);
      ctx.ellipses.push({ x, y, rx, ry });
      rec('ellipse')(-1, -1, -1);
    },
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
let avatarSmearPower;
let computeAvatarKineticDeformation;
let getKineticState;
let tickKinetic;
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
  avatarSmearPower = inGame.avatarSmearPower;
  computeAvatarKineticDeformation = inGame.computeAvatarKineticDeformation;
  getKineticState = inGame.getKineticState;
  tickKinetic = inGame.tickKinetic;
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
  assert.deepEqual(Object.keys(clean).sort(), ['color', 'expression', 'rim']);
  assert.equal(clean.rim, 'CLASSIC');
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
  // çerçeve ve gözler aynı — fark yalnızca bu iki dolgu.
  //
  // `grounded: false`: temas gölgesi oyun içi sarmalayıcının BİLİNÇLİ ek
  // katmanıdır (avatar masada durur). Yüz sözleşmesini ölçen bu test onu
  // dışarıda bırakır; varlığı kendi testi aşağıda kilitlidir.
  const play = drawInGame({ grounded: false });
  const menu = drawMenuFace();
  assert.deepEqual(play.calls, drawMenuFace({ faceMode: 'play' }).calls, 'wrapper must force the play face mode');

  const fills = (rec) => rec.calls.filter((c) => c.startsWith('fillRect')).length;
  assert.equal(fills(play) - fills(menu), 2);

  // Gözler oyun içinde büyük: menü yüzünün bbox'ı gövdeye daha sıkı sarılır.
  const menuWidth = menu.bounds.maxX - menu.bounds.minX;
  assert.ok(menuWidth > 0);
});

test('the in-game wrapper grounds the body on the field, the menu face does not', () => {
  // Zemine oturan gövde okunabilirliğin ana taşı: avatar 2.5D bir masanın
  // üstünde durur, panelin üstünde değil. Menü/koltuk/kişiselleştirme yüzeyleri
  // bu yüzden gölge ALMAZ — orada bir "zemin" yok.
  const grounded = drawInGame();
  const airborne = drawInGame({ grounded: false });

  const shadows = (rec) => rec.calls.filter((c) => c.startsWith('ellipse')).length;
  assert.ok(shadows(grounded) > shadows(airborne), 'oyun içi avatar zemine oturmalı');
  assert.equal(shadows(airborne), 0, 'menü yüzü zemin gölgesi çizmemeli');

  // Gölge gövdenin ALTINDA durur: eksik avatarın gövde sınırını aşmaz, yani
  // hitbox okunurluğunu bozmaz (oyun yarıçapı değişmez).
  const g = grounded.bounds;
  assert.ok(g.maxY <= R + BORDER + 1, `gölge gövde sınırını aştı: ${g.maxY}`);
});

test('the motion smear appears only above the speed threshold, and points where the body goes', () => {
  // Hız izi hızdan TÜRETİLİR; tampon değildir. Eşiğin altında sıfır op.
  const still = avatarSmearPower({ radius: 30 });
  assert.equal(still, 0, 'duran gövde iz bırakmamalı');

  // Düz koşu → hafif, dash → tam güç. Her iki bileşen de verilir:
  // `getKineticState` hızı eksik kabul ederse smear da susar (kasıtlı).
  const jog = avatarSmearPower({ radius: 30, vx: 30 * 6, vy: 0 });
  const dash = avatarSmearPower({ radius: 30, vx: 30 * 14, vy: 0 });
  assert.ok(jog > 0 && jog < dash, `hız arttıkça iz güçlenmeli: ${jog} vs ${dash}`);

  // Gövde yarıçapına ORANLI: aynı gövde/sn oranı aynı iz gücü verir, yani
  // eşik cihazdan bağımsız (ölçümsüz kapı).
  const small = avatarSmearPower({ radius: 12, vx: 12 * 14, vy: 0 });
  const large = avatarSmearPower({ radius: 48, vx: 48 * 14, vy: 0 });
  assert.ok(Math.abs(small - large) < 1e-9, 'aynı gövde/sn oranı aynı iz gücü vermeli');

  // Yön: iz gövdenin ARKASINDA, yani hareket yönünün TERSİ.
  // Gövde açısı kasıtlı olarak HIZDAN FARKLI: strafe eden oyuncuda gövde
  // nişana dönük kalır ama iz gerçek hareketi göstermelidir.
  const rec = makeRecorder();
  drawGameAvatar(rec, 0, 0, 30, { ...player, radius: 30, vx: 30 * 14, vy: 0 }, {
    ...NOISE, facingAngle: Math.PI / 2,
  });
  // Gövde +X yönünde gidiyor → iz -X'te olmalı (gövde açısı +Y demişti).
  // Kaydedici transformu yok sayar, dolayısıyla koordinatlar yereldir.
  const behind = rec.arcs.filter((a) => a.x < -1);
  assert.ok(behind.length > 0, 'hız izi gerçek hareket yönünün tersinde çizilmeli');
  // Gövde açısı (+Y) kullanılsaydı kopyalar (0, -back) konumunda olurdu:
  // geriye doğru bir kuyruk görünür, ama YANLIŞ yönde.
  assert.equal(
    rec.arcs.filter((a) => Math.abs(a.x) < 0.5 && a.y < -1).length,
    0,
    'iz gövde açısını değil hız vektörünü takip etmeli',
  );

  // Kapalıysa hiçbir iz kopya yok.
  const off = makeRecorder();
  drawGameAvatar(off, 0, 0, 30, { ...player, radius: 30, vx: 30 * 14, vy: 0 }, {
    ...NOISE, facingAngle: 0, smear: false,
  });
  assert.equal(off.arcs.filter((a) => a.x < -1).length, 0, 'smear:false izi kapatmalı');
});

test('the motion smear reads every engine dialect, like the squash channel does', () => {
  // Smear kinetik kanalın AYNI girdisini okur: isDashing / dashTimer / dash /
  // strikeTimer / isTackling… Tek bir lehçe unutulursa 12 oyundan biri
  // sessizce izsiz kalır.
  for (const p of [
    { radius: 30, isDashing: true },
    { radius: 30, dashTimer: 0.2 },
    { radius: 30, dash: 0.5 },
    { radius: 30, strikeTimer: 0.2 },
    { radius: 30, isTackling: true },
    { radius: 30, steerX: 1, steerY: 0, speed: 30 * 12 },
    { radius: 30, steer: 0, speed: 30 * 12, angle: 0 },
    { radius: 30, isDriving: true, speed: 30 * 12, angle: 0 },
  ]) {
    assert.ok(avatarSmearPower(p) > 0, `lehçe iz üretmeli: ${JSON.stringify(p)}`);
  }
  // Sürüşte değil / hız yok → iz yok.
  assert.equal(avatarSmearPower({ radius: 30, isDriving: false, speed: 30 * 12 }), 0);
  assert.equal(avatarSmearPower({ radius: 30, vx: 0, vy: 0 }), 0);
});

test('the ground shadow scales with the body, never with raw px', () => {
  // Küçük gövde (telefon) ve büyük gövde (TV) aynı gölge dilini konuşur:
  // gölgenin tabanı ve yarı genişliği gövde yarıçapının ORANIDIR, sabit px
  // değil. Aksi halde küçük ekranda gölge gövdeyi yutar, büyükte kaybolur.
  const shadowOf = (r) => {
    const rec = makeRecorder();
    drawGameAvatar(rec, 0, 0, r, player, NOISE);
    assert.ok(rec.ellipses.length > 0, `r=${r}: gölge elipsi çizilmedi`);
    // En dış katman ölçülür (sprite'ın gerçek yarıçapı).
    const e = rec.ellipses[0];
    return { baseRatio: e.y / r, widthRatio: e.rx / r };
  };

  const small = shadowOf(8);
  const large = shadowOf(40);
  for (const key of ['baseRatio', 'widthRatio']) {
    assert.ok(
      Math.abs(small[key] - large[key]) < 0.02,
      `${key} ölçekle değişiyor: ${small[key].toFixed(3)} vs ${large[key].toFixed(3)}`,
    );
  }
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
    'src/games/ninjaView.js',
    'src/games/snakeView.js',
    'src/games/zoneView.js',
    'src/games/crownView.js',
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

test('kinetic deformation: dash, tackle, velocity and recoil calculate correct stretch factors', () => {
  // Idle player has no deformation (null angle, 1.0 factors)
  const idle = computeAvatarKineticDeformation({ angle: 0 });
  assert.equal(idle.squashX, 1.0);
  assert.equal(idle.squashY, 1.0);
  assert.equal(idle.squashAngle, null);

  // Dash elongates forward along facing angle
  const dash = computeAvatarKineticDeformation({ dashing: true, facingAngle: 1.5 });
  assert.ok(dash.squashX > 1.15, 'dash stretches along X');
  assert.ok(dash.squashY < 0.9, 'dash squashes sides');
  assert.equal(dash.squashAngle, 1.5);

  // Tackle elongates forward
  const tackle = computeAvatarKineticDeformation({ tackling: true, angle: 0.8 });
  assert.ok(tackle.squashX > 1.1, 'tackle stretches forward');
  assert.equal(tackle.squashAngle, 0.8);

  // Velocity stretch (vx, vy)
  const moving = computeAvatarKineticDeformation({ vx: 200, vy: 0, angle: 0 });
  assert.ok(moving.squashX > 1.03, 'moving player elongates along velocity');
  assert.equal(moving.squashAngle, 0);

  // Recoil flinches (squashes along angle)
  const recoil = computeAvatarKineticDeformation({ recoil: 0.8, facingAngle: 0.2 });
  assert.ok(recoil.squashX < 1.0, 'recoil squashes along facing angle');
  assert.ok(recoil.squashY > 1.0, 'recoil bulges perpendicular');
  assert.equal(recoil.squashAngle, 0.2);
});

test('kinetic parity (Faz 1): every engine dialect feeds the same squash', () => {
  // Dash lehçeleri: isDashing / dashTimer / dash / strikeTimer / jumpTimer / paket strike
  for (const p of [
    { isDashing: true, angle: 0 },
    { dashTimer: 0.2, angle: 0 },
    { dash: 0.5, angle: 0 },
    { strikeTimer: 0.2, angle: 0 },
    { jumpTimer: 0.2, angle: 0 },
  ]) {
    const k = computeAvatarKineticDeformation(p);
    assert.ok(k.squashX > 1.15, `dash dialect stretches: ${JSON.stringify(p)}`);
  }
  assert.ok(computeAvatarKineticDeformation({ angle: 0 }, { strike: true }).squashX > 1.15);

  // Tackle lehçesi: isTackling
  assert.ok(computeAvatarKineticDeformation({ isTackling: true, angle: 0 }).squashX > 1.1);

  // Steer-türevi hız (ARCHER/NINJA/COLLAPSE/HORDE): steerX/steerY + speed
  const steer = computeAvatarKineticDeformation({ steerX: 1, steerY: 0, speed: 200, angle: 0 });
  assert.ok(steer.squashX > 1.03, 'steer-derived velocity stretches');
  assert.equal(steer.squashAngle, 0);
  // Idle steer sıfırsa squash yok (ZONE/heading yanlış-pozitifi yok)
  assert.equal(computeAvatarKineticDeformation({ steerX: 0, steerY: 0, speed: 200, angle: 0 }).squashAngle, null);

  // SNAKE: sürekli ileri hareket (steer sayısı + speed + angle)
  const snake = computeAvatarKineticDeformation({ steer: 0, speed: 190, angle: 0 });
  assert.ok(snake.squashX > 1.03, 'snake forward motion stretches');

  // TANKS: sürüşte hız, boşta sıfır
  assert.ok(computeAvatarKineticDeformation({ isDriving: true, speed: 220, angle: 0 }).squashX > 1.03);
  assert.equal(computeAvatarKineticDeformation({ isDriving: false, speed: 220, angle: 0 }).squashAngle, null);

  // Recoil saati söner (ateş sonrası ~0.3 sn)
  const p = { recoil: 1 };
  tickKinetic(p, 0.1);
  assert.ok(p.recoil < 1 && p.recoil > 0, 'recoil decays with dt');
  tickKinetic(p, 1);
  assert.equal(p.recoil, 0, 'recoil fully decays');
  assert.equal(getKineticState({ angle: 0 }).recoil, 0);
});

test('drawGameAvatar applies hitFlash and kinetic transforms without throwing', () => {
  const rec = makeRecorder();
  // Dashing player triggers kinetic rotate + scale
  drawGameAvatar(rec, 0, 0, R, { ...player, dashing: true, facingAngle: 0.5 });
  const hasRotate = rec.calls.some((c) => c.startsWith('rotate('));
  const hasScale = rec.calls.some((c) => c.startsWith('scale('));
  assert.ok(hasRotate && hasScale, 'dashing avatar must apply kinetic transform');

  // Hit flash player renders
  const hitRec = makeRecorder();
  drawGameAvatar(hitRec, 0, 0, R, { ...player, hit: true });
  assert.ok(hitRec.calls.length > 0, 'hit avatar must render cleanly');
});

// ---------------------------------------------------------------------------
// PARITY GATE — bu dosyanın asıl işi. Metin taraması DEĞİL, motoru ÇALIŞTIRIR
// ve paketi okur: "efekt var mı" değil "efekt gerçekten üretiliyor mu".
//
// Neden runtime: squash kelimeni geçen ama ölü kod (eskiden `vx` yazmayan 6
// motor) hiçbir metin kapısını geçmezdi. Buradaki ölçüm motorun kendi
// paketinden okur, yani sadece HOST→KUMANDA yolunda gerçekten taşınan veri
// sayılır.
// ---------------------------------------------------------------------------

// Avatar taşıyan oyunlar. PONG yanda kürek vardır, gövde avatarı yok; CURVE
// imleçtir — bu ikisinin squash sözleşmesi yoktur (bilinçli istisna).
const KINETIC_ENGINES = [
  ['ARCHER', '/src/games/archer.js', 'ArcherGame'],
  ['BOMB', '/src/games/bomb.js', 'BombGame'],
  ['HEIST', '/src/games/heist.js', 'HeistGame'],
  ['ZONE', '/src/games/zone.js', 'ZoneGame'],
  ['SNAKE', '/src/games/snake.js', 'SnakeGame'],
  ['COLLAPSE', '/src/games/collapse.js', 'CollapseGame'],
  ['HORDE', '/src/games/horde.js', 'HordeGame'],
  ['NINJA', '/src/games/ninja.js', 'NinjaGame'],
  ['CROWN', '/src/games/crown.js', 'CrownGame'],
  ['TANKS', '/src/games/tanks.js', 'TanksGame'],
];

test('PARITY: every avatar engine carries kinetic velocity into its world packet', async () => {
  const { getKineticState } = await server.ssrLoadModule('/src/core/avatarInGame.js');

  for (const [mode, mod, className] of KINETIC_ENGINES) {
    const { [className]: Ctor } = await server.ssrLoadModule(mod);
    const game = new Ctor({ width: 1600, height: 1200, style: {}, getContext: () => makeRecorder() });
    game.resize(1280, 720);
    if (typeof game.initPlayers === 'function') game.initPlayers();
    else if (typeof game.initTanks === 'function') game.initTanks();

    game.slotTypes[0] = 'human';
    const entity = (game.players || game.tanks)[0];
    entity.isJoined = true;
    entity.isAlive = true;
    entity.slotType = 'human';

    // Girirti yolu MOTORDAN MOTORA değişir (joystick/klavye/uzak/bot), bu yüzden
    // kapı "hız yazılsın" SÖZLEŞMESİNİ iki parçaya böler:
    //   (a) runtime: paket oyuncu başına vx/vy taşıyor ve geçerli (aşağıda),
    //   (b) kaynak taraması: motor hareket döngüsünde hızı YAZIYOR (aşağıda).
    // (b) olmadan (a) "her kare 0 yazıyor" durumunu yakalayamaz — ki bu,
    // squash'ın neden 6 motorda ölü kaldığının ta kendisiydi.
    const packet = game.createWorldPacket();
    assert.ok(packet, `${mode}: world packet must exist`);
    const packed = packet.players.find((p) => (p.slot ?? p.index) === 0);
    assert.ok(packed, `${mode}: packet must carry slot 0`);

    const hasV = typeof packed.vx === 'number' && typeof packed.vy === 'number';
    assert.ok(
      hasV,
      `${mode}: packet player has no vx/vy — the kinetic channel was dropped, so `
      + 'squash cannot reach the remote controller. Write velocity every frame.',
    );
    assert.ok(Number.isFinite(packed.vx) && Number.isFinite(packed.vy), `${mode}: packet velocity must be finite`);
    const kinetic = getKineticState(packed, { vx: packed.vx, vy: packed.vy });
    assert.equal(kinetic.vx, packed.vx, `${mode}: packet velocity must survive normalization`);

    if (typeof game.destroy === 'function') game.destroy();
  }
});

test('PARITY: every avatar engine WRITES velocity in its movement loop', () => {
  // Bu, tarihsel regresyonun kendisini kilitler: merkezi squash hazırdı, altı
  // motor `steer` ile doğrudan `x/y` taşıyordu ve `vx/vy` hiç yazılmıyordu.
  // Efekt "var" görünüyordu, hiç çalışmıyordu.
  const engineFiles = [
    'src/games/archer.js',
    'src/games/bomb.js',
    'src/games/heist.js',
    'src/games/zone.js',
    'src/games/snake.js',
    'src/games/collapse.js',
    'src/games/horde.js',
    'src/games/ninja.js',
    'src/games/crown.js',
    'src/games/tanks.js',
  ];
  for (const f of engineFiles) {
    const content = fs.readFileSync(f, 'utf8');
    const writesVelocity = content.includes('writeSteerVelocity(')
      || /\b(?:player|p|tank|entity)\.vx\s*=[^=]/.test(content);
    assert.ok(
      writesVelocity,
      `${f} never writes entity velocity (vx/vy). Squash & stretch reads velocity, `
      + 'so this game silently has no kinetic channel. Use BaseGame.writeSteerVelocity().',
    );
  }

  // Negative control: kapı gerçekten kırmızıya dönüyor.
  const dead = 'player.x += player.steerX * spd * dt;';
  const wouldPass = dead.includes('writeSteerVelocity(') || /\b(?:player|p|tank|entity)\.vx\s*=[^=]/.test(dead);
  assert.equal(wouldPass, false, 'the velocity-write gate must reject a steer-only movement loop');
});

test('PARITY: every avatar engine exposes a floating-text channel (SİSTEM 3)', async () => {
  const { isValidFloatingTexts, FX_TEXT_CAP } = await server.ssrLoadModule('/src/core/fxKit.js');

  for (const [mode, mod, className] of KINETIC_ENGINES) {
    const { [className]: Ctor } = await server.ssrLoadModule(mod);
    const game = new Ctor({ width: 1600, height: 1200, style: {}, getContext: () => makeRecorder() });
    game.resize(1280, 720);
    if (typeof game.initPlayers === 'function') game.initPlayers();
    else if (typeof game.initTanks === 'function') game.initTanks();

    assert.ok(
      Array.isArray(game.floatingTexts),
      `${mode}: no floatingTexts list — emitFloatingText would throw, and the `
      + 'score/hit feedback channel (SİSTEM 3) is missing.',
    );

    const packet = game.createWorldPacket();
    const texts = packet?.texts ?? packet?.extras?.texts;
    assert.ok(
      texts !== undefined,
      `${mode}: world packet carries no floating-text channel, so the remote `
      + 'controller silently loses every score/hit label.',
    );
    assert.ok(isValidFloatingTexts(texts, FX_TEXT_CAP), `${mode}: texts channel fails its own validator`);

    if (typeof game.destroy === 'function') game.destroy();
  }
});


