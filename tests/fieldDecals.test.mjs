// Zemin çatışma izleri regresyon kalkanı (docs/ARENA_ELEVATION_PLAN.md Faz 2).
//
// Bu katmanın sözleşmesi GÖRÜNEL (lekelerin nasıl göründüğü) değil şudur:
//   1) Üretici TEK noktadadır: `FxRuntime.emit`. Motorlarda iz kodu yok.
//   2) Yalnız çatışma olayları iz bırakır; `shot`/`pickup`/`score` zemini kirletmez.
//   3) Havuz SABİT (32) ve halka tampodur; aynı yerdeki aynı imza tek kayıtta
//      birleşir ve YENİ iz açma temposu tavanlıdır — kare-başı duman üreten
//      akışlar (TANKS turbo, SNAKE boost) zemini halıya çeviremez.
//   4) Boş havuz ctx'ye TEK bir çizim yapmaz (bake log eşitliği korunur).
//   5) Süresi dolan iz kendini temizler — motorun `update` sırasına girmek gerekmez.
//   6) Seed (yani raunt) değişimi zemini YUMUŞAK süpürür ve süpürme bitene
//      kadar yeni iz açılmaz.
//   7) Çizim arenanın DIŞINA taşmaz (arena kutusuna kırpma).
//   8) AĞ BÜTCESİ (§6): paket alanı yok, kare başına gradyan/nesne tahsisi yok.

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DECAL_CAP,
  DECAL_SCORCH,
  DECAL_SKID,
  DECAL_SPLAT,
  clearFieldDecals,
  drawFieldDecals,
  emitFxScar,
  fieldDecalStats,
} from '../src/core/fieldDecals.js';
import { drawField, fieldTheme, releaseFieldLayers } from '../src/core/fieldKit.js';
import { createFxRuntime } from '../src/core/fxRuntime.js';
import { clearFieldLights } from '../src/core/fieldLights.js';

const ARENA = Object.freeze({ left: 40, top: 24, width: 800, height: 432, unit: 1 });
const PALETTE = fieldTheme('default');
/** Çizim karesi başına ilerletilen sanal saat adımları. */
const WIPE_MS = 400;

let virtualNow = 10_000;
beforeEach(() => {
  virtualNow = 10_000;
  globalThis.performance.now = () => virtualNow;
  clearFieldDecals();
  clearFieldLights();
});
afterEach(() => {
  delete globalThis.performance.now;
  clearFieldDecals();
  clearFieldLights();
});

/** Çizim çağrılarını VE özellik yazımlarını string olarak sıraya yazan ctx. */
function recorder() {
  const log = [];
  const gradient = { addColorStop: () => {} };
  const target = {
    log,
    measureText: () => ({ width: 0 }),
    // `fieldKit` bake yolu gradyan üretir; iz katmanının kendisi ÜRETMEZ —
    // logda `lin(`/`rad(` görmek Faz 2 sözleşmesinin bozulduğunu söyler.
    createLinearGradient: (...a) => { log.push(`lin(${a.map(fmt).join(',')})`); return gradient; },
    createRadialGradient: (...a) => { log.push(`rad(${a.map(fmt).join(',')})`); return gradient; },
  };
  return new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key];
      return (...args) => { log.push(`${String(key)}(${args.map(fmt).join(',')})`); };
    },
    set(t, key, value) {
      log.push(`${String(key)}=${fmt(value)}`);
      t[key] = value;
      return true;
    },
  });
}

const fmt = (v) => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v));

function draw(seed = 1, arena = ARENA) {
  const ctx = recorder();
  drawFieldDecals(ctx, arena, PALETTE, seed);
  return ctx.log;
}

/** `globalAlpha` yazımlarının listesi — sönümlemeyi piksele bakmadan ölçer. */
const alphas = (log) => log
  .map((entry) => entry.match(/^globalAlpha=([-\d.]+)$/))
  .filter(Boolean)
  .map((m) => Number(m[1]));

// ---------------------------------------------------------------------------
// 1-2. Üretici eşlemesi
// ---------------------------------------------------------------------------
test('combat events open the signature the plan names for them', () => {
  emitFxScar('kill', { x: 300, y: 200 }, 1);
  assert.equal(fieldDecalStats.scorch, 0, 'sayaç yalnız çizim karesinde güncellenir');
  draw();
  assert.equal(fieldDecalStats.scorch, 1, 'kill → patlama isi');

  clearFieldDecals();
  emitFxScar('hit', { x: 300, y: 200, color: '#FF473A' }, 1);
  draw();
  assert.equal(fieldDecalStats.splat, 1, 'hit → boya sıçraması');

  clearFieldDecals();
  emitFxScar('slay', { x: 300, y: 200, color: '#8B5CF6' }, 1);
  draw();
  assert.equal(fieldDecalStats.splat, 1, 'slay → boya sıçraması');

  clearFieldDecals();
  emitFxScar('dust', { x: 300, y: 200 }, 1);
  draw();
  assert.equal(fieldDecalStats.skid, 1, 'dust (dash/tackle) → patinaj çizgisi');
});

test('non-combat events never touch the floor', () => {
  for (const kind of ['shot', 'pickup', 'score', 'blocked', 'spark', 'zone']) {
    assert.equal(emitFxScar(kind, { x: 300, y: 200 }, 1), false, `${kind} iz açmamalı`);
  }
  assert.equal(emitFxScar('kill', { x: Number.NaN, y: 200 }, 1), false, 'bozuk koordinat');
  assert.equal(emitFxScar('kill', {}, 1), false, 'olay yükü yok');
  assert.deepEqual(draw(), [], 'boş havuz ctx\'ye dokunmamalı');
});

test('the runtime itself is the single producer', () => {
  // Motorların hiçbiri `fieldDecals` import etmez; çatışma olayı zaten
  // `FxRuntime.emit`'ten geçer. Bu prova o bağlantının kopmadığını kilitler.
  const fx = createFxRuntime({ arenaProvider: () => ({ unit: 1 }) });
  fx.emit('kill', { x: 400, y: 200, color: '#FFD24A', size: 36 });
  virtualNow += 150;
  fx.emit('hit', { x: 520, y: 300, color: '#1D5D8A', dirX: 1, dirY: 0 });
  virtualNow += 150;
  fx.emit('dust', { x: 200, y: 120 });
  virtualNow += 150;
  fx.emit('shot', { x: 100, y: 100 });
  draw();
  assert.equal(fieldDecalStats.scorch, 1);
  assert.equal(fieldDecalStats.splat, 1);
  assert.equal(fieldDecalStats.skid, 1);
  assert.equal(fieldDecalStats.live, 3);
});

// ---------------------------------------------------------------------------
// 3. Sabit havuz, spam ve tempo freni
// ---------------------------------------------------------------------------
test('the pool never exceeds its cap: the oldest scar is recycled', () => {
  // `DECAL_CAP + 1` iz, yuvalarından geniş. 150 ms'lik adımlar tempo frenini
  // (140 ms) aşar ve hepsi is ömrünün (5.2 sn) içinde kalır → son kayıt en
  // eskiyi ezmek ZORUNDA kalır.
  for (let i = 0; i < DECAL_CAP + 1; i += 1) {
    assert.equal(emitFxScar('kill', { x: 70 + (i % 8) * 90, y: 60 + Math.floor(i / 8) * 80 }, 1), true,
      `iz ${i} açılmalı`);
    virtualNow += 150;
  }
  draw();
  assert.equal(fieldDecalStats.live, DECAL_CAP, `havuz ${fieldDecalStats.live}`);
});

test('continuous dust (turbo/boost) does not carpet the floor', () => {
  // TANKS turbo dumanı ve SNAKE egzozu KARE BAŞINA olay üretir. Tempo freni
  // olmasa zemin halıya döner ve 32 yuvanın tamamı tek tankın izleriyle dolar.
  for (let frame = 0; frame < 60; frame += 1) {
    emitFxScar('dust', { x: 80 + frame * 11, y: 100 + (frame % 5) * 40 }, 1);
  }
  draw();
  assert.equal(fieldDecalStats.skid, 1, 'aynı karede tek yeni iz');

  for (let frame = 0; frame < 60; frame += 1) {
    emitFxScar('dust', { x: 80 + frame * 11, y: 300 + (frame % 3) * 40 }, 1);
    virtualNow += 16; // ~60 fps
  }
  draw();
  assert.ok(fieldDecalStats.skid <= 8, `1 sn'de en fazla ~7 iz, ${fieldDecalStats.skid}`);
});

test('repeated hits on one spot refresh instead of eating the pool', () => {
  for (let i = 0; i < 40; i += 1) {
    emitFxScar('hit', { x: 300, y: 200, color: '#FF473A' }, 1);
    virtualNow += 10;
  }
  draw();
  assert.equal(fieldDecalStats.splat, 1, 'aynı yerdeki vuruşlar tek lekede birleşir');
  // Farklı imzalar birbirini yemez: isi aynı yerde olsa da ayrı kayıttır.
  emitFxScar('kill', { x: 300, y: 200 }, 1);
  draw();
  assert.equal(fieldDecalStats.scorch, 1);
  assert.equal(fieldDecalStats.splat, 1);
});

// ---------------------------------------------------------------------------
// 4-5. Çizim sözleşmesi
// ---------------------------------------------------------------------------
test('an empty pool draws nothing at all', () => {
  assert.deepEqual(draw(), [], 'temsil yok: statik katman logu bozulmamalı');
});

test('scars expire on their own clock, without an update tick', () => {
  emitFxScar('dust', { x: 300, y: 200 }, 1);
  assert.ok(draw().length > 0);
  virtualNow += 3_100; // SKID_LIFE üstü
  assert.deepEqual(draw(), [], 'süresi dolan iz kendini kapatır');
  assert.equal(fieldDecalStats.live, 0);

  // İs daha uzun yaşar (plan: 4-6 sn), patinaj daha kısa.
  clearFieldDecals();
  emitFxScar('kill', { x: 300, y: 200 }, 1);
  virtualNow += 3_100;
  assert.equal(fieldDecalStats.live, 0, 'sayaç çizimle tazelenir');
  draw();
  assert.equal(fieldDecalStats.live, 1, 'is 3 sn\'de hâlâ sahada');
  virtualNow += 2_400;
  draw();
  assert.equal(fieldDecalStats.live, 0, 'is 5.5 sn\'de sönmeli');
});

test('the signature draws its own geometry', () => {
  clearFieldDecals();
  emitFxScar('kill', { x: 300, y: 200 }, 1);
  let log = draw();
  assert.ok(log.some((entry) => entry.startsWith('ellipse(')), 'is lekesi elips loblarla çizilir');
  assert.ok(log.some((entry) => entry === 'fill()'), 'loblar tek fill ile biter');

  clearFieldDecals();
  emitFxScar('dust', { x: 300, y: 200, dirX: 1, dirY: 0 }, 1);
  log = draw();
  assert.ok(log.filter((entry) => entry.startsWith('moveTo(')).length === 2, 'patinaj çift çizgidir');
  assert.ok(log.some((entry) => entry === 'stroke()'));
});

test('drawing the same frame twice is idempotent (no state, no allocation)', () => {
  emitFxScar('kill', { x: 300, y: 200, size: 40 }, 1);
  virtualNow += 150;
  emitFxScar('hit', { x: 460, y: 320, color: '#FF473A' }, 1);
  virtualNow += 600;
  assert.deepEqual(draw(), draw(), 'aynı kare iki kez çizilirse log birebir aynı olmalı');
});

// ---------------------------------------------------------------------------
// 6. Raunt temizliği
// ---------------------------------------------------------------------------
test('a round change (seed) softly sweeps the floor and blocks new scars', () => {
  emitFxScar('kill', { x: 300, y: 200 }, 1);
  virtualNow += 400;
  const before = alphas(draw(1));
  assert.ok(before.length > 0);

  // Yeni raunt: süpürme ilk karede AÇILIR (o kare henüz tam güçte), sonra
  // `now - wipeStamp` farkıyla söner — update sırası yok.
  virtualNow += 1;
  assert.equal(alphas(draw(2)).length, before.length, 'süpürme çizim şeklini değiştirmez');
  virtualNow += WIPE_MS / 2;
  const mid = alphas(draw(2));
  assert.equal(mid.length, before.length);
  for (let i = 0; i < mid.length; i += 1) {
    assert.ok(Math.abs(mid[i] - before[i] * 0.5) < 1e-3, `süpürme alfası ${mid[i]} ≠ ${before[i] * 0.5}`);
  }

  // Yeni rauntun ilk karelerinde iz açılmaz — zemin tertemiz başlamalı.
  assert.equal(emitFxScar('kill', { x: 500, y: 300 }, 1), false, 'süpürme sırasında üretim kapalı');

  // Süpürme biter: havuz kapanır, ctx'e tek çizim kalmaz, üretim açılır.
  virtualNow += WIPE_MS;
  assert.deepEqual(draw(2), [], 'süpürme bitince havuz tamamen boşalır');
  assert.equal(emitFxScar('kill', { x: 500, y: 300 }, 1), true, 'yeni raunt temiz üretir');
  draw(2);
  assert.equal(fieldDecalStats.scorch, 1);
});

test('the first observed seed never triggers a sweep', () => {
  emitFxScar('kill', { x: 300, y: 200 }, 1);
  virtualNow += 400;
  const log = draw(7);
  assert.ok(log.length > 0);
  assert.equal(emitFxScar('hit', { x: 320, y: 210 }, 1), true, 'süpürme yoktu');
});

test('a seed that never repeats keeps the floor clean, not frozen', () => {
  // REGRESYON: süpürme "seed değişti" olayına bağlı; seed HER kare değişirse
  // (yanlış bir anahtar) zemin hiç iz tutmaz. Beklenen: stabil seed ⇒ iz kalıcı.
  emitFxScar('kill', { x: 300, y: 200 }, 1);
  for (let frame = 0; frame < 30; frame += 1) {
    virtualNow += 16;
    draw(3);
  }
  assert.equal(fieldDecalStats.scorch, 1);
});

// ---------------------------------------------------------------------------
// 7. Kırpma ve dayanıklılık
// ---------------------------------------------------------------------------
test('scars are clipped to the arena box, so nothing leaks into the surround', () => {
  for (let i = 0; i < 12; i += 1) {
    emitFxScar(i % 2 ? 'kill' : 'hit', {
      x: ARENA.left + 20 + i * 60,
      y: ARENA.top + ARENA.height - 6,
    }, 1);
    virtualNow += 150;   // tempo freninin üstünde: 12 ayrı iz açılmalı
  }
  assert.equal(fieldDecalStats.live, 0, 'sayaç çizimle tazelenir');
  const log = draw();
  assert.ok(log.length > 0);
  const rectAt = log.indexOf(`rect(${ARENA.left},${ARENA.top},${ARENA.width},${ARENA.height})`);
  assert.ok(rectAt >= 0, `arena kutusu kırpılmıyor: ${log.slice(0, 8).join(' | ')}`);
  assert.equal(log[rectAt + 1], 'clip()', 'rect hemen clip() izlemeli');
  assert.equal(log.at(-1), 'restore()', 'kırpma kapanmalı (save/restore dengesi)');
  assert.equal(log.filter((entry) => entry === 'save()').length, log.filter((entry) => entry === 'restore()').length,
    'her save kapanır — dış kırpma save\'i + iz başına bir save');
});

test('scars outside the current arena box are dropped, not drawn', () => {
  emitFxScar('kill', { x: 300, y: 200 }, 1);
  draw();
  assert.equal(fieldDecalStats.live, 1);
  // Resize: arena küçüldü, iz artık sahanın dışında.
  draw(1, { left: 350, top: 30, width: 100, height: 100, unit: 1 });
  assert.equal(fieldDecalStats.live, 0);
});

test('degenerate arenas and null contexts never throw', () => {
  emitFxScar('kill', { x: 300, y: 200 }, 1);
  const ctx = recorder();
  assert.doesNotThrow(() => drawFieldDecals(ctx, null, PALETTE, 1));
  assert.doesNotThrow(() => drawFieldDecals(null, ARENA, PALETTE, 1));
  assert.doesNotThrow(() => drawFieldDecals(ctx, { left: 0, top: 0, width: 0, height: 0 }, PALETTE, 1));
  assert.doesNotThrow(() => emitFxScar('kill', { x: 300, y: 200 }, Number.NaN));
});

test('sizes scale with `unit`, never with raw pixels', () => {
  const small = { ...ARENA, unit: 0.4 };
  clearFieldDecals();
  emitFxScar('kill', { x: 300, y: 200, size: 40 }, 0.4);
  const scaled = draw(1, small).filter((entry) => entry.startsWith('ellipse('));
  clearFieldDecals();
  emitFxScar('kill', { x: 300, y: 200, size: 40 }, 1);
  const full = draw(1).filter((entry) => entry.startsWith('ellipse('));
  assert.ok(scaled.length > 0 && full.length > 0);
  const radius = (entry) => Number(entry.match(/ellipse\([-\d.]+,[-\d.]+,([-\d.]+)/)?.[1] ?? 0);
  assert.ok(radius(scaled[0]) < radius(full[0]), 'küçük sahada iz de küçük olmalı');
});

// ---------------------------------------------------------------------------
// 8. Ağ bütçesi, tahsis ve determinizm
// ---------------------------------------------------------------------------
test('the scar layer is not networked and allocates nothing per frame', () => {
  const source = readFileSync(join(process.cwd(), 'src/core/fieldDecals.js'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
  for (const forbidden of [
    'Math.random', 'new Date(', 'fetch', 'WebSocket', 'supabase', 'postMessage',
    'createRadialGradient', 'createLinearGradient', 'Path2D', 'shadowBlur', 'getImageData',
  ]) {
    assert.equal(source.includes(forbidden), false, `fieldDecals ${forbidden} kullanmamalı`);
  }
  // `Date.now` YALNIZ `performance.now` olmayan ortam için saat YEDEĞİDİR
  // (`fieldReactive` ile aynı üç satır) — bake determinizmini bozan şey duvar
  // saati değil, rastgelelik ve ağdır.
  // Ham renk literali yasak (§8): renk olaydan gelir, yoklukta tema mürekkebi.
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(source), false, 'fieldDecals ham renk literali taşımamalı');
  emitFxScar('kill', { x: 300, y: 200 }, 1);
  assert.equal(draw().some((entry) => entry.startsWith('rad(') || entry.startsWith('lin(')), false,
    'kare başına gradyan tahsisi yasak');
});

test('the same event leaves the same scar twice', () => {
  emitFxScar('kill', { x: 300, y: 200, size: 44 }, 1);
  const first = draw();
  clearFieldDecals();
  emitFxScar('kill', { x: 300, y: 200, size: 44 }, 1);
  assert.deepEqual(draw(), first, 'aynı olay aynı lekeyi bırakmalı (hash, sayaç değil)');

  clearFieldDecals();
  emitFxScar('hit', { x: 300, y: 200, dirX: 1, dirY: 0 }, 1);
  const oriented = draw();
  clearFieldDecals();
  emitFxScar('hit', { x: 300, y: 200, dirX: 1, dirY: 0 }, 1);
  assert.deepEqual(draw(), oriented, 'yön verilmiş iz de yinelenebilir olmalı');
});

test('signature kinds are distinguishable in the pool', () => {
  // İmza sabitleri `drawFieldDecals`'ın dallanmasını belirler; karıştırsa
  // testler yukarıda "yanlış imza çizildi" diye patlar. Küçük bir çapraz kontrol:
  emitFxScar('kill', { x: 100, y: 100 }, 1);
  virtualNow += 150;
  emitFxScar('dust', { x: 700, y: 400 }, 1);
  virtualNow += 150;
  emitFxScar('hit', { x: 400, y: 250 }, 1);
  assert.deepEqual([DECAL_SCORCH, DECAL_SKID, DECAL_SPLAT], [0, 1, 2]);
  draw();
  assert.equal(fieldDecalStats.live, 3);
  assert.equal(fieldDecalStats.scorch + fieldDecalStats.skid + fieldDecalStats.splat, 3);
});

// ---------------------------------------------------------------------------
// 9. Sahaya bağlantı (tüketici)
// ---------------------------------------------------------------------------
test('fieldKit.drawField paints the scar layer over the baked blit', () => {
  // İz katmanının 12 oyuna ulaşması tek bir yere bağlı: `drawField`. Boş
  // havuzda blit logu TEK satırdır — bake eşitliği oradan da doğrulanır.
  const created = installCanvasStub();
  const ctx = recorder();
  const opts = { mode: 'BOMB', seed: 11 };
  drawField(ctx, ARENA, opts);
  const blitAt = ctx.log.findIndex((entry) => entry.startsWith('drawImage('));
  assert.ok(blitAt >= 0, 'saha katmanı blit edilmeli');
  // Boş havuzda iz katmanı hiç op üretmez; logda kalabilecek tek şey Faz 3'ün
  // sabit tepe projektörü damgasıdır (spot renkleri/ellipse/iz yoktur).
  const extra = ctx.log.slice(blitAt + 1);
  assert.ok(!extra.some((e) => e.startsWith('ellipse(') || e.startsWith('arc(')),
    `boş havuzda iz kalıntısı olmamalı: ${JSON.stringify(extra)}`);
  assert.ok(extra.every((e) => /^(save|beginPath|rect|clip|drawImage|restore|globalAlpha)/.test(e)),
    `blit sonrası yalnız ışık katmanının sabit damgası kalmalı: ${JSON.stringify(extra)}`);

  emitFxScar('kill', { x: 300, y: 200, size: 40 }, 1);
  virtualNow += 60;
  const mark = ctx.log.length;
  drawField(ctx, ARENA, opts);
  const log = ctx.log.slice(mark + 1);
  assert.ok(log.includes(`rect(${ARENA.left},${ARENA.top},${ARENA.width},${ARENA.height})`),
    'iz katmanı arena kutusuna kırpılmalı');
  assert.ok(log.some((entry) => entry.startsWith('ellipse(')), 'is lekesi çizilmeli');
  assert.ok(!log.some((entry) => entry.startsWith('lin(') || entry.startsWith('rad(')),
    'iz katmanı kare başına gradyan tahsis etmez');
  assert.equal(created.filter((canvas) => canvas.__fieldRole === 'layer').length, 1,
    'katman yeniden pişirilmemeli');
  delete globalThis.document;
  releaseFieldLayers();
});

/** `document.createElement('canvas')` taklidi — `fieldKit` bake yolu için. */
function installCanvasStub() {
  const created = [];
  globalThis.document = {
    createElement: () => {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => {
          const ctx = recorder();
          canvas.ctx = ctx;
          return ctx;
        },
      };
      created.push(canvas);
      return canvas;
    },
  };
  return created;
}
