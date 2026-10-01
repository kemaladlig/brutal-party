// Hareket bütçesi — oyun temposunun sayısal sözleşmesi.
//
// NEDEN VAR: `playfield.js` ölçeğin TEK otoritesi (`unit = size/952`)
// olduğunu söyler ve `fieldSpeed`/`fieldRadius` ile geçilmesini zorunlu
// kılar. Ama "ölçek doğru" demek "tempo doğru" demek DEĞİLDİR, ve tempo için
// hiçbir test yoktu. 14 oyun × 2 ölçü elle tutuluyordu. Kanıt:
// `raceLogic.js` "RACE hala yavaş" yorumu — 190 → 215 tahminle bulundu,
// sonuç yine yavaş, ikinci tur. Ölçüm yoksa çözüm de yok.
//
// İKİ ÖLÇÜ, İKİ FARKLI "yavaş" KANALI:
//
//   A  saha geçiş süresi = 952 / tasarımHızı   (saniye)
//      "dünya büyük, ben küçüğüm" hissi. SNAKE / COLLAPSE yavaştı.
//
//   B  gövde/sn = tasarımHızı / (2 × tasarımYarıçap)
//      "kendi bedenime göre yavağım" hissi. BOMB (2.4) ve CROWN (2.9) yavaştı.
//
//   C  ivme tepkisi = tasarımHız / tasarımİvme   (saniye)
//      RACE'i hiçbir A/B ölçüsü yakalamıyordu (A 4.4, B 5.7 — ikisi de iyi)
//      ama 0 → maks 0.46 s rampası "yavaş" dedirtiyordu.
//
// A ve B birlikte tek bir sıra vermiyor; bu yüzden ikisi de ayrı kilitleniyor.
//
// ÜÇÜNCE KİLİT — ÖLÇEK DEĞİŞMEZLİĞİ. `unit` tasarım değerinin `size/952`
// oranını taşıdığı için, DOĞRU ölçeklenen her büyüklük cihaz px'e bölünüp
// geri tasarım değerine döndüğünde SABİT olmalıdır. Bu test her oyunu 5
// viewport'ta ölçüp tasarım hızının/yarıçapının birebir aynı kaldığını
// doğrular; tek başına ham-px sızıntılarının HEIST (`Math.max(108, …)`) ve
// HORDE (mermi hızı, revive/portal yarıçapı, mermi ömrü) kaynaklı
// regresyonlarını yakalar.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { computePlayfield, fieldSpeed, FIELD_DESIGN, FIELD_TIERS } from '../src/core/playfield.js';
import { damp } from '../src/core/physics2d.js';

const noop = () => {};
const context = new Proxy({
  measureText: () => ({ width: 0 }),
  createLinearGradient: () => ({ addColorStop: noop }),
  createRadialGradient: () => ({ addColorStop: noop }),
}, {
  get(target, key) {
    if (key in target) return target[key];
    return noop;
  },
  set(target, key, value) {
    target[key] = value;
    return true;
  },
});

// Aynı beş viewport `playfieldEngines.test.mjs` ile aynı: iki kompakt yatay
// telefon, bir portre telefon, bir dizüstü, bir TV. unit aralığı ≈ 0.36–1.00.
const VIEWPORTS = [
  [667, 375], [852, 393], [393, 852], [1280, 720], [1920, 1080],
];

// PONG hariç: raket ray üzerinde hareket eder, serbest karakter değildir.
const ENGINES = [
  ['ARCHER', '/src/games/archer.js', 'ArcherGame', 'standard'],
  ['BOMB', '/src/games/bomb.js', 'BombGame', 'standard'],
  ['HEIST', '/src/games/heist.js', 'HeistGame', 'standard'],
  ['CURVE', '/src/games/curve.js', 'CurveGame', 'standard'],
  ['NINJA', '/src/games/ninja.js', 'NinjaGame', 'standard'],
  ['SNAKE', '/src/games/snake.js', 'SnakeGame', 'standard'],
  ['COLLAPSE', '/src/games/collapse.js', 'CollapseGame', 'standard'],
  ['HORDE', '/src/games/horde.js', 'HordeGame', 'roomy'],
  ['CROWN', '/src/games/crown.js', 'CrownGame', 'crown'],
  ['TANKS', '/src/games/tanks.js', 'TanksGame', 'flat'],
  ['ZONE', '/src/games/zone.js', 'ZoneGame', 'standard'],
  ['RACE', '/src/games/race.js', 'RaceGame', 'racing'],
];

// Bütçe, oyun başınadır: türler gerçekten farklı (CURVE imleç, ZONE bölge,
// RACE araç) ve tek bir global aralık hem anlamsız hem de ayarlanabilir
// olmaktan çıkar. Referans: kullanıcının "iyi" dediği ARCHER (A 4.81, B 3.5).
//
// `radius` YAZILMIŞ tasarım yarıçapıdır — HORDE'un okunurluk çarpanı
// UYGULANMADAN önceki değer. Çarpan bilinçli bir takas: orantıyı sabit
// tutarken fiziksel hedefi büyütür, yani ekrandaki oran B'yi yükseltirken
// yazılı tasarım oranını değiştirmez. Bütçe tasarımı ölçtüğü için çarpan
// buraya girmez; uygulamanın doğruluğu E bölümünde ayrıca kilitlenir.
//
//   mode       tier     tasarım hız  yarıçap   A(s)    B(gövde/sn)
// `tier` FIELD_TIERS bandıdır ve bölüm B'de ÖLÇÜLEN tasarım yarıçapına
// karşı doğrulanır — yani buradaki `radius` beyanı ile motorun gerçek
// gövdesi ayrı düşemez. HEIST satırı bundan önce 24 beyan ediyordu,
// motor 36 yazıyordu; bant kilidi bu sürüklenmeyi yakaladı.
const BUDGET = {
  // arena-action (normal gövde): A ~3.5-5.5, B ~2.6-4.0
  CROWN: { tier: 'normal', speed: 250, radius: 36, maxA: 4.2, minB: 3.2 },
  ARCHER: { tier: 'normal', speed: 198, radius: 28, maxA: 5.1, minB: 3.2 },
  HEIST: { tier: 'normal', speed: 190, radius: 36, maxA: 5.3, minB: 2.6 },
  BOMB: { tier: 'normal', speed: 200, radius: 36, maxA: 5.1, minB: 2.6 },
  TANKS: { tier: 'normal', speed: 175, radius: 34, maxA: 5.8, minB: 2.5 },
  ZONE: { tier: 'normal', speed: 190, radius: 36, maxA: 5.1, minB: 2.6 },
  NINJA: { tier: 'normal', speed: 210, radius: 36, maxA: 5.1, minB: 2.6 },
  COLLAPSE: { tier: 'normal', speed: 190, radius: 36, maxA: 5.1, minB: 2.6 },
  HORDE: { tier: 'normal', speed: 168, radius: 30, maxA: 5.9, minB: 2.6 },
  RACE: { tier: 'normal', speed: 215, radius: 34, maxA: 4.6, minB: 3.1 },
  // open: küçük gövde + niş/hızlı türler
  CURVE: { tier: 'open', speed: 185, radius: 18, maxA: 6.3, minB: 4.4 },
  SNAKE: { tier: 'open', speed: 190, radius: 24, maxA: 5.8, minB: 3.6 },
  // cursor / territory / chain: küçük gövde, uzun sahalar — B yüksek olmalı
};

let server;
const loaded = new Map();
// Motor modülleri `import.meta.env` kullandığı için (transitive: supabaseRelay)
// doğrudan Node altında import EDİLEMEZ; Vite SSR üzerinden yüklenirler.
let HORDE_TUNING;
let getPlayerWeapon;
let RACE_TUNING;
let computeGreedSpeed;
let HEIST_GREED;

before(async () => {
  globalThis.window = {
    innerWidth: 800,
    innerHeight: 600,
    addEventListener: noop,
    removeEventListener: noop,
    AudioContext: null,
    webkitAudioContext: null,
    matchMedia: () => ({ matches: false }),
    getComputedStyle: () => ({ getPropertyValue: () => '0px' }),
  };
  globalThis.document = {
    activeElement: null,
    body: {},
    addEventListener: noop,
    removeEventListener: noop,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({
      width: 0,
      height: 0,
      style: {},
      setAttribute: noop,
      getContext: () => context,
    }),
    body: { appendChild: noop },
    documentElement: { appendChild: noop },
  };

  server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
  });

  for (const [mode, mod, className] of ENGINES) {
    const m = await server.ssrLoadModule(mod);
    loaded.set(mode, m[className]);
  }

  ({ HORDE_TUNING } = await server.ssrLoadModule('/src/games/horde.js'));
  ({ getPlayerWeapon } = await server.ssrLoadModule('/src/games/hordeConfig.js'));
  ({ RACE_TUNING } = await server.ssrLoadModule('/src/games/raceLogic.js'));
  ({ computeGreedSpeed, HEIST_GREED } = await server.ssrLoadModule('/src/games/heist.js'));
});

after(async () => {
  await server?.close();
});

function makeCanvas() {
  return { width: 1600, height: 1200, style: {}, getContext: () => context };
}

/** Oyunu verilen viewport'ta kurup oyuncu varlığını hazırlar. */
function spawn(mode, w, h) {
  const Ctor = loaded.get(mode);
  const game = new Ctor(makeCanvas());
  game.resize(w, h);
  if (typeof game.initPlayers === 'function') game.initPlayers();
  else if (typeof game.initTanks === 'function') game.initTanks();
  else if (typeof game.resetRacers === 'function') game.resetRacers();
  const player = (game.players || game.tanks || [])[0];
  assert.ok(player, `${mode} produced no player entity at ${w}x${h}`);
  return { game, player };
}

/** Gövde yarıçapı alanı oyun başına değişiyor. TANKS `size` taşır ve `size`
 *  KAREDİR (kenar): çarpışma half = size/2. Yarıçapı yarısıdır — `size`ı
 *  yarıçap saymak tankları yarı boyutta ölçmek (ve bandı kandırmak) demekti. */
function bodyRadius(entity) {
  if (Number.isFinite(entity.radius)) return entity.radius;
  if (Number.isFinite(entity.size)) return entity.size / 2;
  return NaN;
}

/**
 * HORDE'u oyun içine alıp bir oyuncuyu ateşe hazır hâle getirir.
 * `firePlayer` `state === 'PLAYING'` ve `isAlive` ister; ölçüm için gereksiz
 * gürültü (cooldown, reload, ammo, tur bonusları) sıfırlanır.
 */
function hordeReadyToFire(w, h) {
  const { game, player } = spawn('HORDE', w, h);
  game.state = 'PLAYING';
  player.isAlive = true;
  player.weaponId = 'SIDEARM';
  player.ammo = 20;
  player.reloadTimer = 0;
  player.attackCooldown = 0;
  player.tripleTimer = 0;
  player.fastTimer = 0;
  return { game, player };
}

// ---------------------------------------------------------------------------
// A) Saha geçiş süresi ve gövde/sn bütçeleri
// ---------------------------------------------------------------------------

for (const [mode] of ENGINES) {
  const budget = BUDGET[mode];

  test(`${mode} field-crossing time stays inside its budget`, () => {
    for (const [w, h] of VIEWPORTS) {
      const { player } = spawn(mode, w, h);
      // Tasarım değerine geri çevir: `unit` tasarım px → cihaz px çarpanıdır,
      // yani cihaz değeri / unit = tasarım değeri. Bu, ölçeğin TAMAMEN
      // düşmesi değildir, bir ham-px sızıntısı TUTULURSA ortaya çıkar.
      const designSpeed = player.speed / unitAt(mode, w, h);
      const crossSeconds = FIELD_DESIGN.shortSide / designSpeed;
      const bodyPerSecond = designSpeed / (budget.radius * 2);

      assert.ok(
        crossSeconds <= budget.maxA,
        `${mode} @ ${w}x${h}: crossing the field takes ${crossSeconds.toFixed(2)}s, `
        + `budget is <= ${budget.maxA}s (design speed ${designSpeed.toFixed(1)} px/s). `
        + 'If this game is intentionally slower, raise maxA deliberately.',
      );
      assert.ok(
        bodyPerSecond >= budget.minB,
        `${mode} @ ${w}x${h}: only ${bodyPerSecond.toFixed(2)} body-lengths/s `
        + `(design ${designSpeed.toFixed(1)} px/s over a ${(budget.radius * 2).toFixed(0)}px body), `
        + `budget is >= ${budget.minB}. A body that is large relative to its speed `
        + 'reads as "slow" even when the raw speed looks healthy.',
      );
    }
  });

  // B) ÖLÇEK DEĞİŞMEZLİĞİ — ham-px sızıntılarının regresyon kilidi.
  test(`${mode} design speed and radius are viewport-independent`, () => {
    const seen = [];
    for (const [w, h] of VIEWPORTS) {
      const { game, player } = spawn(mode, w, h);
      const unit = unitAt(mode, w, h);
      const radius = bodyRadius(player);
      assert.ok(
        Number.isFinite(radius) && radius > 0,
        `${mode} @ ${w}x${h}: player has no usable body radius`,
      );
      seen.push({
        label: `${w}x${h}`,
        speed: player.speed / unit,
        // HORDE gövdeye bilinçli olarak mutlak CSS px tabanı uygular (okunurluk),
        // bu yüzden "beyan edilen çarpan × tasarım" olarak doğrulanır. Diğerleri
        // için tasarım yarıçapı birebir sabittir.
        radius: mode === 'HORDE'
          ? radius / unit / game.bodyScale()
          : radius / unit,
      });
    }
    const first = seen[0];
    for (const sample of seen.slice(1)) {
      assert.ok(
        Math.abs(sample.radius - first.radius) <= 1e-9,
        `${mode}: design radius changes with viewport — ${first.label} `
        + `${first.radius.toFixed(6)} vs ${sample.label} ${sample.radius.toFixed(6)}. `
        + 'A raw-px radius is reaching a fieldRadius call.',
      );
      assert.ok(
        Math.abs(sample.speed - first.speed) <= 1e-9,
        `${mode}: design speed changes with viewport — ${first.label} `
        + `${first.speed.toFixed(6)} vs ${sample.label} ${sample.speed.toFixed(6)}. `
        + 'A raw-px speed is reaching a fieldSpeed call, or a clamp/constant is '
        + 'compared against a device-px value.',
      );
    }
    // TIER band lock (AGENTS §4 / FIELD_TIERS): the MEASURED design radius must
    // sit inside the declared tier band. Body/field ratio — not viewport margins —
    // is what makes a map read as the same size from game to game.
    const tier = FIELD_TIERS[budget.tier];
    assert.ok(
      first.radius >= tier.minDesignRadius - 1e-6 && first.radius <= tier.maxDesignRadius + 1e-6,
      `${mode}: design radius ${first.radius.toFixed(2)}px is outside tier `
      + `'${budget.tier}' [${tier.minDesignRadius}, ${tier.maxDesignRadius}] — `
      + 'switch tier or resize the body deliberately, never silently.',
    );
  });
}

function unitAt(mode, w, h) {
  const [, , , preset] = ENGINES.find(([id]) => id === mode);
  return computePlayfield(w, h, preset).unit;
}

// ---------------------------------------------------------------------------
// C) İvme tepkisi (RACE — A ve B'nin ikisini de geçen tek yavaşlık kanalı)
// ---------------------------------------------------------------------------

test('RACE throttle response is a deliberate, fast-ramp value', () => {
  const ramp = RACE_TUNING.baseSpeed / RACE_TUNING.baseAcceleration;
  assert.ok(
    ramp <= 0.35,
    `RACE takes ${ramp.toFixed(2)}s to reach top speed. This is the third `
    + 'slowness channel: RACE measured FAST on both cross-time (4.4s) and '
    + 'body/s (5.7), so only the acceleration ramp explained "RACE is slow".',
  );
  // Dash ramp keeps a comparable response ratio; a dash that accelerates slower
  // than the base throttle feels like the boost does nothing.
  const dashRamp = RACE_TUNING.dashSpeed / RACE_TUNING.dashAcceleration;
  assert.ok(
    dashRamp <= ramp * 1.2,
    `RACE dash ramp ${dashRamp.toFixed(2)}s is slower than the base ramp `
    + `${ramp.toFixed(2)}s — the boost would feel inert.`,
  );
});

// ---------------------------------------------------------------------------
// D) HEIST açgözlülük eğrisi — saf fonksiyon, viewport'tan bağımsız olmalı
// ---------------------------------------------------------------------------

test('HEIST greed floor and step are scaled with the field', () => {
  for (const [w, h] of VIEWPORTS) {
    const arena = computePlayfield(w, h, 'standard');
    const base = fieldSpeed(arena, HEIST_GREED.BASE_SPEED);

    // The regression: a raw 108 floor sits ABOVE `base` on a short field, so
    // the curve can never engage and the player runs faster than designed.
    assert.ok(
      base >= fieldSpeed(arena, HEIST_GREED.MIN_SPEED),
      `HEIST @ ${w}x${h}: design base (${HEIST_GREED.BASE_SPEED}) is below the greed `
      + `floor (${HEIST_GREED.MIN_SPEED}), so the floor would pin the player to a `
      + 'constant speed and the weight curve would never engage.',
    );
    assert.ok(
      Math.abs(computeGreedSpeed(arena, base, 0) - base) <= 1e-9,
      `HEIST @ ${w}x${h}: an empty-handed carrier must move at base speed`,
    );
    assert.ok(
      computeGreedSpeed(arena, base, 6) < base,
      `HEIST @ ${w}x${h}: carrying loot must slow the carrier down`,
    );
  }
});

test('HEIST greed response is identical on every viewport', () => {
  // The response RATIO is the thing that must not drift: a device where the
  // floor pins the speed answers 1.0 forever.
  const ratios = VIEWPORTS.map(([w, h]) => {
    const arena = computePlayfield(w, h, 'standard');
    const base = fieldSpeed(arena, HEIST_GREED.BASE_SPEED);
    return computeGreedSpeed(arena, base, 6) / base;
  });
  for (const [index, ratio] of ratios.entries()) {
    assert.ok(
      Math.abs(ratio - ratios[0]) <= 1e-9,
      `HEIST greed response drifts: ${VIEWPORTS[0].join('x')} ${ratios[0].toFixed(6)} `
      + `vs ${VIEWPORTS[index].join('x')} ${ratio.toFixed(6)}`,
    );
  }
  assert.ok(ratios[0] < 0.95, `HEIST weight has almost no effect (${ratios[0].toFixed(3)})`);
});

// ---------------------------------------------------------------------------
// E) HORDE okunurluk — orantı yetmez, fiziksel hedef de gerekir
// ---------------------------------------------------------------------------

test('HORDE bodies stay legible on small fields without inflating on large ones', () => {
  for (const [w, h] of VIEWPORTS) {
    const { game, player } = spawn('HORDE', w, h);
    const unit = game.arena.unit;
    const boost = game.bodyScale();

    assert.ok(
      boost >= 1,
      `HORDE @ ${w}x${h}: bodyScale is ${boost.toFixed(3)} — the legibility boost `
      + 'must never shrink anything (Math.max(1, …)).',
    );
    assert.ok(
      bodyRadius(player) >= 9,
      `HORDE @ ${w}x${h}: player radius is ${bodyRadius(player).toFixed(1)} CSS px `
      + `(a ${(bodyRadius(player) * 2).toFixed(0)}px target). Proportional scaling keeps `
      + 'the RATIO right but the physical target unusable on a 6" screen.',
    );
    // The boost must be exactly the declared legibility target, not a number
    // that happens to be big enough.
    const expected = Math.max(1, HORDE_TUNING.LEGIBILITY_PX / (HORDE_TUNING.PLAYER_RADIUS * unit));
    assert.ok(
      Math.abs(boost - expected) <= 1e-9,
      `HORDE @ ${w}x${h}: bodyScale ${boost.toFixed(6)} != declared ${expected.toFixed(6)}`,
    );
    assert.ok(
      Math.abs(bodyRadius(player) - HORDE_TUNING.PLAYER_RADIUS * unit * boost) <= 1e-9,
      `HORDE @ ${w}x${h}: player radius is not design × unit × boost`,
    );
  }
});

test('HORDE enemy shots travel at the declared design speed, not raw pixels', () => {
  // The measured bug: `ENEMY_SHOT_SPEED` was raw px while movement went through
  // fieldSpeed, so on a phone a shot travelled 3.92x the player's speed versus
  // 1.58x on desktop — a 2.5x difficulty spike that read as "everything is too
  // fast". This drives the REAL fire path and measures the spawned projectile;
  // asserting on the `bodySpeed` helper instead would pass even if the helper
  // were never called (verified: that version of the test was green against the
  // un-scaled bug).
  const samples = [];
  for (const [w, h] of VIEWPORTS) {
    const { game } = spawn('HORDE', w, h);
    game.projectiles = [];
    game.fireEnemyProjectile(
      { id: 'probe', x: game.arena.cx, y: game.arena.cy, radius: 10, isBoss: false },
      0, 1, '#000000',
    );
    const shot = game.projectiles[0];
    assert.ok(shot, `HORDE @ ${w}x${h}: no projectile was spawned`);
    const measured = Math.hypot(shot.vx, shot.vy);
    samples.push({
      label: `${w}x${h}`,
      measured,
      expected: game.bodySpeed(HORDE_TUNING.ENEMY_SHOT_SPEED),
    });
  }
  for (const sample of samples) {
    assert.ok(
      Math.abs(sample.measured - sample.expected) <= 1e-9,
      `HORDE @ ${sample.label}: enemy shot moves at ${sample.measured.toFixed(2)} px/s `
      + `but the scaled design speed is ${sample.expected.toFixed(2)} px/s. A raw px `
      + 'constant here is 2.5x too fast on a phone.',
    );
  }
});

test('HORDE player and enemy shots keep the same ratio on every device', () => {
  // Both sides must scale together, so the shot/move RATIO is the invariant.
  // Scaling only the enemy shot would have rebalanced the game instead of
  // fixing the leak.
  const ratios = [];
  for (const [w, h] of VIEWPORTS) {
    const { game, player } = hordeReadyToFire(w, h);

    game.projectiles = [];
    game.fireEnemyProjectile(
      { id: 'probe', x: game.arena.cx, y: game.arena.cy, radius: 10, isBoss: false },
      0, 1, '#000000',
    );
    const enemyShot = Math.hypot(game.projectiles[0].vx, game.projectiles[0].vy);

    game.projectiles = [];
    game.firePlayer(player);
    const playerShot = game.projectiles[0];
    assert.ok(playerShot, `HORDE @ ${w}x${h}: the player did not fire`);

    ratios.push({
      label: `${w}x${h}`,
      enemy: enemyShot / player.speed,
      player: Math.hypot(playerShot.vx, playerShot.vy) / player.speed,
    });
  }
  for (const [index, sample] of ratios.entries()) {
    assert.ok(
      Math.abs(sample.enemy - ratios[0].enemy) <= 1e-9,
      `HORDE enemy-shot/player-speed ratio drifts: ${ratios[0].label} `
      + `${ratios[0].enemy.toFixed(6)} vs ${sample.label} ${sample.enemy.toFixed(6)}`,
    );
    assert.ok(
      Math.abs(sample.player - ratios[0].player) <= 1e-9,
      `HORDE player-shot/player-speed ratio drifts: ${ratios[0].label} `
      + `${ratios[0].player.toFixed(6)} vs ${sample.label} ${sample.player.toFixed(6)}`,
    );
  }
  // 270 / 171 = 1.579 and 520 / 171 = 3.04. The old un-scaled phone values were
  // 3.92 and 7.54.
  assert.ok(
    ratios[0].enemy < 2.0,
    `HORDE enemy shots are ${ratios[0].enemy.toFixed(2)}x player speed`,
  );
  assert.ok(
    ratios[0].player < 4.0,
    `HORDE player shots are ${ratios[0].player.toFixed(2)}x player speed`,
  );
});

test('HORDE bullet lifetime is a device-independent duration', () => {
  // `life: weapon.range / speed` put a 1/unit term into a duration: on a phone
  // SIDEARM bullets lived 2.2s instead of 0.885s and their 460px range covered
  // a 384px field twice over. The lifetime must be the pure design ratio.
  for (const [w, h] of VIEWPORTS) {
    const { game, player } = hordeReadyToFire(w, h);
    const weapon = getPlayerWeapon(player);
    game.projectiles = [];
    game.firePlayer(player);
    const shot = game.projectiles[0];
    assert.ok(shot, `HORDE @ ${w}x${h}: the player did not fire`);
    const expectedLife = weapon.range / weapon.projectileSpeed;
    assert.ok(
      Math.abs(shot.life - expectedLife) <= 1e-9,
      `HORDE @ ${w}x${h}: bullet lives ${shot.life.toFixed(3)}s, design says `
      + `${expectedLife.toFixed(3)}s. Dividing a design range by a DEVICE speed `
      + 'leaks a 1/unit factor into a duration.',
    );
  }
});

test('HORDE revive, portal and crate radii are field-relative', () => {
  // These were raw px, so on a phone the revive ring and portal covered 11% of
  // the field versus 4.6% on desktop — reviving and extracting were 2.5x too
  // easy while bullets were 2.5x too fast.
  for (const [w, h] of VIEWPORTS) {
    const { game } = spawn('HORDE', w, h);
    game.portal = game.createExtractionGate();
    for (const [name, design] of [
      ['REVIVE_RADIUS', HORDE_TUNING.REVIVE_RADIUS],
      ['PORTAL_RADIUS', HORDE_TUNING.PORTAL_RADIUS],
      ['LOADOUT_RADIUS', HORDE_TUNING.LOADOUT_RADIUS],
    ]) {
      const fraction = game.bodyPx(design) / game.arena.size;
      const designFraction = (design * game.bodyScale()) / FIELD_DESIGN.shortSide;
      assert.ok(
        Math.abs(fraction - designFraction) <= 1e-9,
        `HORDE @ ${w}x${h}: ${name} covers ${(fraction * 100).toFixed(1)}% of the `
        + `field, design says ${(designFraction * 100).toFixed(1)}%`,
      );
      // Sanity: nothing may claim more than a tenth of the field.
      assert.ok(
        fraction < 0.1,
        `HORDE @ ${w}x${h}: ${name} swallows ${(fraction * 100).toFixed(1)}% of the field`,
      );
    }
    assert.ok(
      game.portal.radius > 0
      && Math.abs(game.portal.radius - game.bodyPx(HORDE_TUNING.PORTAL_RADIUS)) <= 1e-9,
      `HORDE @ ${w}x${h}: the spawned portal is not scaled with the field`,
    );
  }
});

// ---------------------------------------------------------------------------
// F) Sönüm katsayıları kare hızından bağımsız olmalı
// ---------------------------------------------------------------------------

test('damp reproduces the authored 60 Hz strength at any frame rate', () => {
  // 0.96 per frame: ~8.6%/s at 60 Hz but ~29%/s at 30 Hz. The same hazard would
  // then last twice as long on a slow device. `damp` pins the 60 Hz feel.
  for (const perFrame of [0.7, 0.82, 0.94, 0.96, 0.97]) {
    const oneSecond = damp(perFrame, 1);
    const at60 = Math.pow(perFrame, 60);
    assert.ok(
      Math.abs(oneSecond - at60) <= 1e-12,
      `damp(${perFrame}, 1) = ${oneSecond} != ${at60}`,
    );
    // Sixty 60 Hz frames must equal one second of damping.
    let stepped = 1;
    for (let i = 0; i < 60; i += 1) stepped *= damp(perFrame, 1 / 60);
    assert.ok(
      Math.abs(stepped - at60) <= 1e-9,
      `damp(${perFrame}, 1/60) x60 = ${stepped} != ${at60}`,
    );
  }
  // And a 30 fps device must land on the same per-second total.
  const thirty = damp(0.96, 1 / 30);
  let stepped30 = 1;
  for (let i = 0; i < 30; i += 1) stepped30 *= thirty;
  assert.ok(
    Math.abs(stepped30 - Math.pow(0.96, 60)) <= 1e-9,
    `30 fps total ${stepped30} != 60 fps total ${Math.pow(0.96, 60)}`,
  );
  assert.equal(damp(0.96, 0), 1, 'damp must be a no-op for a zero timestep');
});
