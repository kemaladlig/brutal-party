import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { computePlayfield } from '../src/core/playfield.js';

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

const VIEWPORTS = [
  [667, 375], [852, 393], [393, 852], [1280, 720], [1920, 1080],
];

// mode → [module, exported class, playfield preset]
// The preset column is the contract: it is what makes a retune in playfield.js
// a deliberate, reviewable change instead of 15 independent edits.
const ENGINES = [
  ['PONG', '/src/games/game.js', 'Game', 'standard'],
  ['ARCHER', '/src/games/archer.js', 'ArcherGame', 'standard'],
  ['BOMB', '/src/games/bomb.js', 'BombGame', 'standard'],
  ['HEIST', '/src/games/heist.js', 'HeistGame', 'standard'],
  ['CURVE', '/src/games/curve.js', 'CurveGame', 'standard'],
  ['NINJA', '/src/games/ninja.js', 'NinjaGame', 'standard'],
  ['SNAKE', '/src/games/snake.js', 'SnakeGame', 'standard'],
  ['LASER', '/src/games/laser.js', 'LaserGame', 'standard'],
  ['COLLAPSE', '/src/games/collapse.js', 'CollapseGame', 'standard'],
  ['CLONE', '/src/games-retired/clone.js', 'CloneGame', 'standard'],
  ['HORDE', '/src/games/horde.js', 'HordeGame', 'roomy'],
  ['CROWN', '/src/games-retired/crown.js', 'CrownGame', 'crown'],
  ['TANKS', '/src/games/tanks.js', 'TanksGame', 'flat'],
  ['ZONE', '/src/games/zone.js', 'ZoneGame', 'dense'],
  ['RACE', '/src/games/race.js', 'RaceGame', 'racing'],
];

let server;
const loaded = new Map();

before(async () => {
  globalThis.window = {
    innerWidth: 800,
    innerHeight: 600,
    addEventListener: noop,
    removeEventListener: noop,
    AudioContext: null,
    webkitAudioContext: null,
    matchMedia: () => ({ matches: false }),
    // No safe-area insets: this is a desktop-shaped test environment, and
    // playfield only consults the probe on compact landscape anyway.
    getComputedStyle: () => ({ getPropertyValue: () => '0px' }),
  };
  globalThis.document = {
    activeElement: null,
    body: {},
    addEventListener: noop,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    // ZONE keeps a territory cache on an offscreen canvas; playfield's
    // safe-area probe appends a hidden div.
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
});

after(async () => {
  await server?.close();
});

// A canvas whose backing store is DPR-scaled, exactly like main.js produces.
// Any engine that reads or writes canvas.width/height shows up here.
function makeCanvas(dpr) {
  return {
    width: Math.floor(800 * dpr),
    height: Math.floor(600 * dpr),
    style: {},
    getContext: () => context,
  };
}

for (const [mode, , , preset] of ENGINES) {
  test(`${mode} derives its arena from the shared playfield (${preset})`, () => {
    const Ctor = loaded.get(mode);
    const canvas = makeCanvas(2);
    const game = new Ctor(canvas);

    for (const [w, h] of VIEWPORTS) {
      game.resize(w, h);
      const expected = computePlayfield(w, h, preset);
      const label = `${mode} @ ${w}x${h}`;

      for (const key of ['left', 'top', 'width', 'height', 'size', 'aspect', 'unit']) {
        const delta = Math.abs(game.arena[key] - expected[key]);
        assert.ok(delta <= 1e-9, `${label} ${key}: got ${game.arena[key]}, want ${expected[key]}`);
      }
      assert.equal(game.arena.right - game.arena.left, game.arena.width, `${label} right`);
      assert.equal(game.arena.bottom - game.arena.top, game.arena.height, `${label} bottom`);
    }
  });

  test(`${mode} never touches the DPR backing store`, () => {
    const Ctor = loaded.get(mode);
    const dpr = 3;
    const canvas = makeCanvas(dpr);
    const backingWidth = canvas.width;
    const backingHeight = canvas.height;
    const game = new Ctor(canvas);

    for (const [w, h] of VIEWPORTS) {
      game.resize(w, h);
      // main.js owns canvas sizing; an engine that assigns to it destroys the
      // ctx.scale(dpr, dpr) transform and renders at 1x forever.
      assert.equal(canvas.width, backingWidth, `${mode} wrote canvas.width at ${w}x${h}`);
      assert.equal(canvas.height, backingHeight, `${mode} wrote canvas.height at ${w}x${h}`);
    }
  });

  test(`${mode} keeps entities inside the field across a mid-match resize`, () => {
    const Ctor = loaded.get(mode);
    const canvas = makeCanvas(2);
    const game = new Ctor(canvas);

    // Entities live on different collections per engine; ZONE's playable area
    // is a centred square rather than the whole arena rect.
    const list = () => game.players || game.tanks || [];
    const bounds = () => {
      if (game.field) {
        const f = game.field;
        return { left: f.x, right: f.x + f.s, top: f.y, bottom: f.y + f.s };
      }
      const a = game.arena;
      return { left: a.left, right: a.right, top: a.top, bottom: a.bottom };
    };

    game.resize(1920, 1080);
    game.slotTypes = ['human', 'bot_normal', 'bot_normal', 'bot_normal'];
    if (typeof game.initPlayers === 'function') game.initPlayers();
    if (typeof game.initTanks === 'function') game.initTanks();
    if (typeof game.resetRacers === 'function') game.resetRacers();

    // LOBBY resize re-seeds spawn points; PLAYING takes the remap branch, which
    // is the path that has to keep entities on the field.
    game.state = 'PLAYING';

    for (let seed = 0; seed < list().length; seed += 1) {
      const live = list()[seed];
      if (!live) continue;
      const wide = game.arena;
      live.x = wide.left + wide.width * (seed % 2 ? 0.97 : 0.03);
      live.y = wide.top + wide.height * 0.5;

      game.resize(667, 375);

      // initPlayers()/initTanks() may swap in fresh entity objects, so read the
      // engine's current entity for this slot rather than the pre-resize ref.
      const after = list()[seed];
      if (!after) continue;
      const b = bounds();
      assert.ok(
        after.x >= b.left - 0.5 && after.x <= b.right + 0.5,
        `${mode} slot ${seed} x ${after.x} escaped [${b.left}, ${b.right}]`,
      );
      assert.ok(
        after.y >= b.top - 0.5 && after.y <= b.bottom + 0.5,
        `${mode} slot ${seed} y ${after.y} escaped [${b.top}, ${b.bottom}]`,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Stage 3: entity scale invariants
// ---------------------------------------------------------------------------
// Kullanıcı hedefi: "mobilde farklı hissettirmesin". Bunun ölçülebilir
// karşılığı iki tanedir:
//   1) Gövde, saha kısa kenarına göre SABİT bir oran işgal eder.
//   2) Sahayı geçiş süresi (`size / speed`) cihazdan BAĞIMSIZ kalır.
// İkincisi olmadan küçülen gövdelerde oyun ağırlaşır ("sluggish"), ki bu tam
// olarak hissedilen farklılıktır.
//
// Bazı motorlarda GÖRELİ taban kasıtlıdır (HORDE nişan oyunu, PONG topu):
// taban orantıyı yukarı iter. Bu yüzden "fazla şişik" bir üst sınır konur;
// mutlak px tabanının yarattığı ~3x sapma bu sınırı kırardı.

const DESKTOP_VP = [1920, 1080];
const PHONE_VP = [852, 393];

function bodyOf(game) {
  const list = game.players || game.tanks;
  if (!Array.isArray(list) || !list.length) return null;
  const e = list[0];
  if (!e) return null;
  const radius = e.radius ?? e.size;
  if (!Number.isFinite(radius) || radius <= 0) return null;
  const speed = e.speed ?? e.driveSpeed ?? e.baseSpeed;
  return {
    radius,
    speed: Number.isFinite(speed) && speed > 0 ? speed : null,
  };
}

const scaleReport = [];

for (const [mode, , , preset] of ENGINES) {
  test(`${mode} body and speed scale with the field, not the device`, () => {
    const Ctor = loaded.get(mode);
    const canvas = makeCanvas(2);

    const sample = (vp) => {
      const game = new Ctor(canvas);
      game.resize(vp[0], vp[1]);
      game.slotTypes = ['human', 'bot_normal', 'bot_normal', 'bot_normal'];
      if (typeof game.initPlayers === 'function') game.initPlayers();
      if (typeof game.initTanks === 'function') game.initTanks();
      if (typeof game.resetRacers === 'function') game.resetRacers();
      return { body: bodyOf(game), size: game.arena.size };
    };

    const desk = sample(DESKTOP_VP);
    const phone = sample(PHONE_VP);
    if (!desk.body || !phone.body) {
      // Engine exposes no scalable body (e.g. grid-based); nothing to assert.
      return;
    }

    const deskFootprint = desk.body.radius / desk.size;
    const phoneFootprint = phone.body.radius / phone.size;
    scaleReport.push({
      mode,
      deskFootprint,
      phoneFootprint,
      ratio: phoneFootprint / deskFootprint,
    });

    // 1) Relative footprint must not balloon. 1.6x allows documented relative
    //    floors while catching the old absolute-px floors (HORDE was 3x).
    assert.ok(
      phoneFootprint <= deskFootprint * 1.6,
      `${mode} body is ${(phoneFootprint / deskFootprint).toFixed(2)}x bigger relative to the field on a phone `
      + `(${deskFootprint * 100}% -> ${phoneFootprint * 100}%)`,
    );

    // 2) Crossing time must be device independent (speed is scaled too).
    if (desk.body.speed && phone.body.speed) {
      const deskCross = desk.size / desk.body.speed;
      const phoneCross = phone.size / phone.body.speed;
      const drift = Math.abs(phoneCross - deskCross) / deskCross;
      assert.ok(
        drift < 0.3,
        `${mode} crossing time drifts ${(drift * 100).toFixed(0)}% across devices `
        + `(desktop ${deskCross.toFixed(2)}s, phone ${phoneCross.toFixed(2)}s)`,
      );
    }
  });
}

// Engine'ler gövde yarıçapını iki farklı yerde tutuyor. Yeni düzende
// oyuncu NESNESİNDE `radius` alanı olan motorlar ölçeklenebilir; olmayanlar
// yarıçapı view/sabit olarak taşıyor ve AYRI ele alınmalı (aşağıya bak).
// ARCHER ve NINJA bu listeye girdi, sonra motor+view+packet üçlüsüyle
// çevrildi ve listeden çıkarıldı — `no engine is silently missing` testi
// bunu zorlar.
const NO_BODY_RADIUS = new Set(['PONG']);

test('scale report covers every engine that exposes a body radius', () => {
  // Diagnostic surface: prints the actual per-engine ratios so a regression is
  // visible in CI logs without having to add a failing assertion.
  const sorted = [...scaleReport].sort((a, b) => b.ratio - a.ratio);
  console.log('  body footprint (radius / field short side), desktop -> phone:');
  for (const row of sorted) {
    console.log(
      `    ${row.mode.padEnd(9)} ${(row.deskFootprint * 100).toFixed(2)}% -> ${(row.phoneFootprint * 100).toFixed(2)}%`
      + `  (${row.ratio.toFixed(2)}x)`,
    );
  }

  // Every engine must be accounted for: either it reports a body, or it is on
  // the explicit not-yet-converted list. If someone adds `radius` to an engine
  // today, this fails and forces the list to be updated.
  const reported = new Set(scaleReport.map((r) => r.mode));
  for (const [mode] of ENGINES) {
    if (!reported.has(mode)) {
      assert.ok(
        NO_BODY_RADIUS.has(mode),
        `${mode} reports no body radius but is not on NO_BODY_RADIUS — update the list`,
      );
    }
  }
  assert.ok(reported.size >= 7, `expected at least 7 scalable bodies, got ${reported.size}`);
});

test('no engine is silently missing from the scale accounting', () => {
  // A stale NO_BODY_RADIUS entry means we stopped tracking an engine.
  const reported = new Set(scaleReport.map((r) => r.mode));
  for (const mode of NO_BODY_RADIUS) {
    assert.ok(
      !reported.has(mode),
      `${mode} is on NO_BODY_RADIUS but DOES report a body radius — remove it from the list`,
    );
  }
});

test('every registered engine is covered by this suite', () => {
  assert.equal(loaded.size, 15, 'all 15 engines should load');
  for (const [mode, , , preset] of ENGINES) {
    assert.ok(loaded.get(mode), `${mode} failed to load`);
    assert.ok(preset, `${mode} has no declared preset`);
  }
});
