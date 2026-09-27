import test from 'node:test';
import assert from 'node:assert/strict';
import { computePlayfield } from '../src/core/playfield.js';
import { buildLayout, LAYOUT_TUNING } from '../src/core/arenaKit.js';
import { discReachability, narrowestPassage } from './helpers/passability.mjs';

const PRESETS = [
  'pillars', 'columns4', 'cross', 'crossfire', 'scatter', 'bunker', 'courtyard', 'split',
];

const PHONE = [852, 393];
const TABLET = [1180, 820];
const DESKTOP = [1920, 1080];
const SQUARE = [900, 900];

// Tasarım yarıçapı (1920x1080 referansı) — motorların `fieldRadius` tabanı.
//
// DEĞERLER MOTORLARDAN BİREBİR ALINIR, elle kopyalanmaz. `minPassage` motorun
// EN BÜYÜK gövdesinden türediği için tabloda da en büyük gövde yazmalı
// (HORDE'de oyuncu 14 değil, tank 30). Motor değiştiğinde bu tablo eskir ve
// test sessizce yanlış şeyi ölçmeye devam eder — o yüzden aşağıdaki
// `design radii mirror the engines` testi bunu kilitliyor.
const BODY_RADIUS = {
  // HORDE tank gövdesi 33 → 42 (gövde okunurluğu ×1.27; oyuncu 15 → 19).
  // Geçiş tabanı en büyük gövdeden türer, dolayısıyla harita seyrelmesi
  // beklenen bir yan etkidir — aşağıdaki test bunu ölçüyor.
  ARCHER: 28, HORDE: 42, BOMB: 36, HEIST: 36, TANKS: 34, LASER: 19, NINJA: 18,
};

// Baseline = pre-change square placement: a synthetic aspect of 1 forces
// spread 1.0 and skips the densify pass.
const baseline = (name, arena) => buildLayout(name, { ...arena, aspect: 1 });

function bounds(nodes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of nodes) {
    const ox = r.mover?.axis === 'x' ? Math.abs(r.mover.amp || 0) : 0;
    const oy = r.mover?.axis === 'y' ? Math.abs(r.mover.amp || 0) : 0;
    const x = r.mover ? (r.mover.baseX ?? r.x) : r.x;
    const y = r.mover ? (r.mover.baseY ?? r.y) : r.y;
    minX = Math.min(minX, x - ox);
    maxX = Math.max(maxX, x + r.w + ox);
    minY = Math.min(minY, y - oy);
    maxY = Math.max(maxY, y + r.h + oy);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

const widthPct = (nodes, arena) => (bounds(nodes).w / arena.width) * 100;

test('a square field reproduces the pre-change layout exactly', () => {
  // Kare sahada yay birebir 1.0 dönmeli: bu, "en-boy duyarlılığı kare
  // düzenleri bozmasın" garantisidir.
  const arena = { ...computePlayfield(SQUARE[0], SQUARE[1], 'standard'), aspect: 1 };
  for (const name of PRESETS) {
    const authored = buildLayout(name, arena);
    const base = baseline(name, arena);
    assert.equal(authored.length, base.length, `${name} count on a square field`);
    authored.forEach((r, i) => {
      assert.equal(r.x, base[i].x, `${name}[${i}].x`);
      assert.equal(r.y, base[i].y, `${name}[${i}].y`);
      assert.equal(r.w, base[i].w, `${name}[${i}].w`);
      assert.equal(r.h, base[i].h, `${name}[${i}].h`);
    });
  }
});

test('block shapes are never distorted by the spread', () => {
  // Yay yalnız KONUMU açar; w/h `size` ile orantılı kalmalı.
  for (const [w, h] of [PHONE, TABLET, DESKTOP]) {
    const arena = computePlayfield(w, h, 'standard');
    for (const name of PRESETS) {
      const base = baseline(name, arena);
      const spread = buildLayout(name, arena);
      for (let i = 0; i < base.length; i += 1) {
        assert.equal(spread[i].w, base[i].w, `${name} @ ${w}x${h} [${i}].w must not scale`);
        assert.equal(spread[i].h, base[i].h, `${name} @ ${w}x${h} [${i}].h must not scale`);
      }
    }
  }
});

test('wide fields fill more of the width than the square layout did', () => {
  for (const [w, h] of [PHONE, TABLET, DESKTOP]) {
    const arena = computePlayfield(w, h, 'standard');
    for (const name of PRESETS) {
      const before = widthPct(baseline(name, arena), arena);
      const after = widthPct(buildLayout(name, arena), arena);
      assert.ok(
        after > before,
        `${name} @ ${w}x${h} should fill more width: ${after.toFixed(0)}% vs ${before.toFixed(0)}%`,
      );
    }
  }
});

test('nothing escapes the field, including mover sweep', () => {
  for (const [w, h] of [PHONE, TABLET, DESKTOP, SQUARE]) {
    const arena = computePlayfield(w, h, 'standard');
    for (const name of PRESETS) {
      for (const r of buildLayout(name, arena)) {
        const ox = r.mover?.axis === 'x' ? Math.abs(r.mover.amp || 0) : 0;
        const oy = r.mover?.axis === 'y' ? Math.abs(r.mover.amp || 0) : 0;
        const x = r.mover ? (r.mover.baseX ?? r.x) : r.x;
        const y = r.mover ? (r.mover.baseY ?? r.y) : r.y;
        const label = `${name} @ ${w}x${h}`;
        assert.ok(x - ox >= arena.left - 0.5, `${label} x ${x - ox} < left ${arena.left}`);
        assert.ok(x + r.w + ox <= arena.right + 0.5, `${label} x right ${x + r.w + ox} > ${arena.right}`);
        assert.ok(y - oy >= arena.top - 0.5, `${label} y ${y - oy} < top ${arena.top}`);
        assert.ok(y + r.h + oy <= arena.bottom + 0.5, `${label} y bottom ${y + r.h + oy} > ${arena.bottom}`);
      }
    }
  }
});

test('movers stay coherent after the spread', () => {
  // updateMovers `r.x = mover.baseX + offset` yapar; yay baseX'i taşımadığı
  // sürece blok bir sonraki karede geri sıçrar.
  const arena = computePlayfield(PHONE[0], PHONE[1], 'standard');
  const nodes = buildLayout('scatter', arena);
  const movers = nodes.filter((r) => r.mover);
  assert.ok(movers.length > 0, 'scatter must have movers');
  for (const r of movers) {
    if (r.mover.axis === 'x') {
      assert.ok(Number.isFinite(r.mover.baseX), 'mover.baseX must be set');
      assert.ok(Math.abs(r.x - r.mover.baseX) < 1e-6, 'r.x must start at mover.baseX');
      const base = baseline('scatter', arena).find((b) => b.mover?.axis === 'x');
      if (base) {
        assert.ok(
          Math.abs(r.mover.amp) >= Math.abs(base.mover.amp) - 1e-6,
          'sweep amplitude must not shrink below the authored sweep',
        );
      }
    } else {
      assert.ok(Number.isFinite(r.mover.baseY), 'mover.baseY must be set');
    }
  }
});

test('relative composition is consistent across devices', () => {
  // Kullanıcı hedefi: "mobilde farklı hissettirmesin". Aynı preset, farklı
  // cihazlarda sahayı yaklaşık aynı ORANDA kaplamalı.
  for (const name of ['pillars', 'columns4', 'bunker', 'scatter']) {
    const ratios = [PHONE, TABLET, DESKTOP].map(([w, h]) => {
      const arena = computePlayfield(w, h, 'standard');
      return widthPct(buildLayout(name, arena), arena);
    });
    const spread = Math.max(...ratios) - Math.min(...ratios);
    assert.ok(spread < 12, `${name} width coverage varies ${spread.toFixed(1)}pp across devices`);
  }
});

test('very wide fields are capped so props cannot pile at the edges', () => {
  const arena = computePlayfield(2400, 500, 'standard');
  assert.ok(arena.aspect > 4, 'fixture should be extremely wide');
  for (const name of PRESETS) {
    for (const r of buildLayout(name, arena)) {
      assert.ok(r.w > 0 && r.h > 0, `${name} must not collapse`);
    }
  }
  // cap görünür olmalı: 21:9 gibi bir oran makul bir tavanı aşmamalı
  const w = 2400, h = 500;
  const spread = 1 + (arena.aspect - LAYOUT_TUNING.designAspect) * LAYOUT_TUNING.spreadGain;
  assert.ok(spread > LAYOUT_TUNING.maxSpread, 'fixture should exceed the cap so it is exercised');
});

test('no two obstacles overlap, at any aspect ratio', () => {
  // Regresyon: `densify` halkası, zaten merkezde duran bloğun (pillars'ın ortadaki
  // küçük karesi) kopyasını yine merkeze koyup üstüne bindiriyordu — ölçülen
  // çakışma alanın %95'iydi. Ayrıca `cross` preset'i KASITLI OLARAK değil,
  // kolların iç ucu merkez kareye girene kadar (%22) tasarım hatasıyla
  // çakışıyordu. Bu test ikisini de kilitler.
  const VIEWPORTS = [PHONE, TABLET, DESKTOP, SQUARE, [2560, 1080], [1024, 768], [2400, 500]];
  for (const [w, h] of VIEWPORTS) {
    const arena = computePlayfield(w, h, 'standard');
    for (const name of PRESETS) {
      const nodes = buildLayout(name, arena);
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          assert.ok(
            !(overlapX > 0 && overlapY > 0),
            `${name} @ ${w}x${h}: #${i} and #${j} overlap by `
            + `${overlapX.toFixed(1)}x${overlapY.toFixed(1)}px`,
          );
        }
      }
    }
  }
});

test('every layout leaves the character-sized passages it promises', () => {
  // Regresyon 1 (gözle bulundu): `cross` preset'inin dikey geçişi 10px'e
  // düşüyordu, karakter çapı 44px — yani o yol baştan beri MATEMATİKSEL OLARAK
  // KAPALIYDI. Kolların iç ucu `armT`'den türetilen sabit bir açıklığa
  // konuyordu, oyuncunun boyutuna hiç bakmıyordu.
  //
  // Regresyon 2 (gözle bulundu): `densify` halkası yalnız *çakışmayı* eliyordu.
  // 3px açıklıkla duran bir blok "çakışmaz", süzgeçten geçer — ama o cep
  // içine girilemez. Ölçülen etki: en dar geçiş, halkasız preset'lerde
  // 152-371px iken halka ile 19-68px'e düşüyordu (8 preset'in 7'si).
  //
  // "Çakışma yok" testi ikisini de kaçırır: engeller birbirine binmiyordur,
  // sadece aralarındaki boşluk kullanılamaz durumdaydı.
  const VIEWPORTS = [PHONE, TABLET, DESKTOP, SQUARE, [2560, 1080], [1024, 768], [2400, 500]];
  const GAMES = Object.entries(BODY_RADIUS);
  for (const [w, h] of VIEWPORTS) {
    const arena = computePlayfield(w, h, 'standard');
    const unit = arena.size / 952;
    for (const [game, designRadius] of GAMES) {
      const radius = designRadius * unit;
      const diameter = radius * 2;
      // Motorların kullandığı taban: en büyük gövdeden türetilir.
      const minPassage = radius * 2.4;
      for (const name of PRESETS) {
        const nodes = buildLayout(name, arena, { minPassage });
        const narrowest = narrowestPassage(arena, nodes);
        assert.ok(
          narrowest >= diameter - 0.01,
          `${game} ${name} @ ${w}x${h}: narrowest passage ${Number.isFinite(narrowest) ? narrowest.toFixed(1) : '-'}px `
          + `is narrower than the ${diameter.toFixed(1)}px character diameter`,
        );
        const { reachable } = discReachability(arena, nodes, radius);
        assert.ok(
          reachable,
          `${game} ${name} @ ${w}x${h}: a ${diameter.toFixed(1)}px disc cannot reach the field edge from the centre`,
        );
      }
    }
  }
});

test('the densify ring adds blocks but never drops below the passage floor', () => {
  // Aynı sözleşmenin kaynak tarafı.
  //
  // "Halka hiçbir açıklığı daraltmaz" iddiası YANLIŞTIR ve ölçümle çürütüldü:
  // engel eklemek kaçınılmaz olarak bazı cepleri küçültür (ölçülen: pillars
  // 152px -> 91px). Doğru değişmez daha zayıf ama doğrudur — halka (a) engel
  // sayısını artırır, saha seyrek kalmasın, (b) GARANTİ EDİLEN TABANIN altına
  // düşmez. (b) asıl sözleşmedir: `minPassage` sözünü tutmak.
  //
  // Referans "halkasız seyrelmiş" settir, kare tabanı DEĞİL: seyrelme de konum
  // açıklıklarını değiştirdiği için kare ile karşılaştırmak iki farklı etkiyi
  // birbirine karıştırır. Halkayı bastırmanın temiz yolu: sahanın onlarca katı
  // bir `minPassage` vermek — her aday elenir, sonuç preset'in kendi hâlidir.
  for (const [w, h] of [DESKTOP, PHONE, TABLET, [2560, 1080]]) {
    const arena = computePlayfield(w, h, 'standard');
    for (const name of PRESETS) {
      const minPassage = 22 * (arena.size / 952) * 2.4;
      const spreadOnly = buildLayout(name, arena, { minPassage: arena.size * 10 });
      const full = buildLayout(name, arena, { minPassage });
      assert.ok(
        full.length >= spreadOnly.length,
        `${name} @ ${w}x${h}: densify reduced the layout `
        + `(${spreadOnly.length} -> ${full.length} blocks)`,
      );
      // `cross` kolları tam olarak `centreHalf + minPassage` konumuna yerleşir,
      // yani geçiş tabana EŞİT çıkar (ölçülen fark -1.4e-14, saf float epsiyonu).
      assert.ok(
        narrowestPassage(arena, full) >= minPassage - 0.01,
        `${name} @ ${w}x${h}: densify left a ${narrowestPassage(arena, full).toFixed(1)}px `
        + `passage below the ${minPassage.toFixed(1)}px floor`,
      );
    }
  }
});

test('the design radius table mirrors the engines', async () => {
  // `BODY_RADIUS` yukarıda elle yazıldı ve bir kez zaten bayatladı: ARCHER 22'ye
  // çıkarken tabloda 22 kalmıştı, test eski değeri doğrulamaya devam ediyordu.
  // Böyle bir kopya sessizdir — bu yüzden kaynaktan okunup karşılaştırılıyor.
  const read = async (file, re) => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    const m = src.match(re);
    assert.ok(m, `could not read ${re} from ${file}`);
    return Number(m[1]);
  };

  assert.equal(
    await read('../src/games/archer.js', /ARCHER_RADIUS = (\d+(?:\.\d+)?)/),
    BODY_RADIUS.ARCHER,
    'ARCHER_RADIUS changed — update BODY_RADIUS in this file',
  );

  const hordeSrc = (await import('node:fs')).readFileSync(
    new URL('../src/games/horde.js', import.meta.url), 'utf8',
  );
  const block = hordeSrc.match(/const ENEMY_BASE = Object\.freeze\(\{([\s\S]*?)\}\);/);
  assert.ok(block, 'ENEMY_BASE table not found in horde.js');
  const radii = [...block[1].matchAll(/radius: (\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  assert.ok(radii.length > 0, 'ENEMY_BASE has no radius entries');
  assert.equal(
    Math.max(...radii),
    BODY_RADIUS.HORDE,
    'the largest HORDE body changed — BODY_RADIUS must track the tank, not the player',
  );
});

test('an empty field yields no obstacles', () => {
  for (const name of PRESETS) {
    assert.deepEqual(buildLayout(name, { cx: 0, cy: 0, size: 0 }), [], name);
  }
});

// ---------------------------------------------------------------------------
// Obstacle material (Faz 2) — skins, relief, and the zero-allocation rule
// ---------------------------------------------------------------------------

const { OBSTACLE_STYLES, obstacleStyle, obstacleMass, drawObstacle } = await import(
  '../src/core/arenaKit.js'
);
const { FIELD_THEMES } = await import('../src/core/fieldKit.js');

/** A ctx that fails loudly on the two things that cost GC pressure per frame. */
function strictRecorder() {
  const log = [];
  const bomb = (name) => { throw new Error(`drawObstacle allocated ${name} per frame`); };
  const target = {
    log,
    createLinearGradient: () => bomb('createLinearGradient'),
    createRadialGradient: () => bomb('createRadialGradient'),
    createPattern: () => bomb('createPattern'),
  };
  return new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key];
      return (...args) => { log.push(`${String(key)}(${args.map((a) => (typeof a === 'number' ? Math.round(a * 100) / 100 : String(a))).join(',')})`); };
    },
    set(t, key, value) { t[key] = value; return true; },
  });
}

test('every obstacle skin carries the full palette and a legal detail hook', () => {
  for (const [id, style] of Object.entries(OBSTACLE_STYLES)) {
    for (const key of ['top', 'fill', 'bevel', 'edge', 'shadow']) {
      assert.equal(typeof style[key], 'string', `${id}.${key} missing`);
    }
    assert.ok(style.detail === null || typeof style.detail === 'function',
      `${id}.detail must be a function or null — no if/else chain grows in drawObstacle`);
  }
  // The three legacy ids must survive: seven engines pass them explicitly.
  for (const id of ['stone', 'dark', 'crate']) {
    assert.ok(OBSTACLE_STYLES[id], `${id} is referenced by engines and may not be removed`);
  }
});

test('skin resolution: explicit variant wins, then the theme, then stone', () => {
  assert.equal(obstacleStyle({ variant: 'crate' }), OBSTACLE_STYLES.crate);
  assert.equal(obstacleStyle({}), OBSTACLE_STYLES.stone, 'no hint at all falls back to stone');
  assert.equal(obstacleStyle({ variant: 'YOK' }), OBSTACLE_STYLES.stone);
  // Theme-driven: the engine picks no hex, it forwards the same theme it gave
  // drawField. `variant` still overrides so nothing that passes one breaks.
  assert.equal(obstacleStyle({ theme: 'foundry' }), OBSTACLE_STYLES[FIELD_THEMES.foundry.block]);
  assert.equal(obstacleStyle({ theme: 'reactor' }), OBSTACLE_STYLES.metal);
  assert.equal(obstacleStyle({ theme: 'reactor', variant: 'dark' }), OBSTACLE_STYLES.dark);
  assert.equal(obstacleStyle({ theme: FIELD_THEMES.core }), OBSTACLE_STYLES[FIELD_THEMES.core.block]);
  // Resolution must not allocate: it returns the registry's own reference.
  assert.equal(obstacleStyle({ theme: 'reactor' }), obstacleStyle({ theme: 'reactor' }));
});

test('obstacle relief is deterministic and survives world-packet rounding', () => {
  const obs = { x: 412.37, y: 260.91, w: 96, h: 64 };
  const m = obstacleMass(obs);
  assert.ok(m >= 0 && m < 1, `mass must be in [0,1), got ${m}`);
  assert.equal(obstacleMass({ ...obs }), m, 'pure function of the rect');
  // World packets round coordinates to 0.1 (worldCore.round1). Bucketing to 4px
  // means host floats and client-rounded values must agree.
  assert.equal(obstacleMass({ ...obs, x: 412.4, y: 260.9 }), m, '0.1px packet rounding may not flip the bucket');
  assert.notEqual(obstacleMass({ ...obs, x: 900, y: 260.91 }), m, 'different blocks differ');
  // Relief must not move the silhouette: same rect, same drawn bounds.
  const a = strictRecorder();
  const b = strictRecorder();
  drawObstacle(a, { x: 100, y: 100, w: 96, h: 64 }, { variant: 'stone' });
  drawObstacle(b, { x: 100, y: 100, w: 96, h: 64 }, { variant: 'crate' });
  assert.ok(a.log.length > 0 && b.log.length > 0);
});

test('drawObstacle allocates nothing per frame and stays within its op budget', () => {
  for (const variant of Object.keys(OBSTACLE_STYLES)) {
    const ctx = strictRecorder();
    drawObstacle(ctx, { x: 120, y: 80, w: 96, h: 72 }, { variant });
    // save/restore/clip/beginPath are state bookkeeping, not raster work.
    const raster = ctx.log.filter((e) => /^(fill|stroke|fillRect|strokeRect|ellipse|moveTo|lineTo|arc)\(/.test(e));
    assert.ok(raster.length <= 26, `${variant}: ${raster.length} raster/path ops (budget 26)`);
    assert.ok(!ctx.log.some((e) => e.includes('Gradient')), `${variant} must not build gradients`);
  }
  // Degenerate rects are skipped instead of throwing.
  const ctx = strictRecorder();
  drawObstacle(ctx, { x: 0, y: 0, w: 0, h: 0 }, {});
  assert.equal(ctx.log.length, 0);
});
