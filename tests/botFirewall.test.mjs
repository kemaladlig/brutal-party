// Faz 4.4 — AI ateşduvarı: her 13 motor için bot-dolu maçlar salt-okunur
// BotView proxy üzerinden yürütülür. Bir AI, oyun durumuna doğrudan yazmaya
// kalkarsa proxy throw eder ve test kırmızıya döner. (Archer şablonu.)
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

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

const ENGINES = [
  ['PONG', '/src/games/game.js', 'Game'],
  ['ARCHER', '/src/games/archer.js', 'ArcherGame'],
  ['BOMB', '/src/games/bomb.js', 'BombGame'],
  ['HEIST', '/src/games/heist.js', 'HeistGame'],
  ['CURVE', '/src/games/curve.js', 'CurveGame'],
  ['NINJA', '/src/games/ninja.js', 'NinjaGame'],
  ['SNAKE', '/src/games/snake.js', 'SnakeGame'],
  ['COLLAPSE', '/src/games/collapse.js', 'CollapseGame'],
  ['HORDE', '/src/games/horde.js', 'HordeGame'],
  ['CROWN', '/src/games/crown.js', 'CrownGame'],
  ['TANKS', '/src/games/tanks.js', 'TanksGame'],
  ['ZONE', '/src/games/zone.js', 'ZoneGame'],
  ['RACE', '/src/games/race.js', 'RaceGame'],
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
    getComputedStyle: () => ({ getPropertyValue: () => '0px' }),
  };
  globalThis.document = {
    activeElement: null,
    addEventListener: noop,
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
});

after(async () => {
  await server?.close();
});

function makeCanvas() {
  return { width: 1280, height: 720, style: {}, getContext: () => context };
}

function entitiesOf(game) {
  return game.players || game.tanks || [];
}

for (const [mode] of ENGINES) {
  test(`${mode} bot AI never mutates game state through the firewall`, () => {
    const Ctor = loaded.get(mode);
    const game = new Ctor(makeCanvas());
    game.resize(1280, 720);
    // İki kademe birden çalışsın: NORMAL ve GOD karar yollarının ikisi de görülsün.
    game.slotTypes = ['human', 'bot_normal', 'bot_god', 'bot_normal'];
    if (typeof game.initPlayers === 'function') game.initPlayers();
    if (typeof game.initTanks === 'function') game.initTanks();
    if (typeof game.resetRacers === 'function') game.resetRacers();
    if (typeof game.startNewMatch === 'function') game.startNewMatch();

    let t = 1000;
    const step = (frames) => {
      for (let i = 0; i < frames; i++) {
        t += 16;
        game.update(t);
      }
    };

    // Sayaç/tanıtım pencereleri açılsın diye kısa bir ısıtma turu.
    step(120);
    const botSlots = (entitiesOf(game) || [])
      .map((p, i) => (p && p.slotType && p.slotType !== 'human' ? i : -1))
      .filter((i) => i >= 0);
    // Tur yeniden doğuşları varlık nesnelerini YENİLEYEBİLİR: referans değil,
    // slot indeksi üzerinden kare boyu en büyük yer değiştirme izlenir.
    const anchor = botSlots.map((i) => {
      const p = entitiesOf(game)[i];
      return { i, x: p.x, y: p.y, moved: 0 };
    });
    let sawNonFinite = false;
    const watch = () => {
      const list = entitiesOf(game);
      for (const a of anchor) {
        const p = list[a.i];
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
          sawNonFinite = true;
          continue;
        }
        a.moved = Math.max(a.moved, Math.hypot(p.x - a.x, p.y - a.y));
      }
    };
    for (let f = 0; f < 900; f++) {
      t += 16;
      game.update(t);
      watch();
    }

    // Kanıt: AI yolları gerçekten yürüdü (en az bir bot spawn'ından ayrıldı).
    const moved = anchor.some((a) => a.moved > 5);
    assert.ok(moved || !anchor.length, `${mode}: no bot moved — AI path likely never executed (state=${game.state}, bots=${anchor.length})`);
    assert.equal(sawNonFinite, false, `${mode}: bot position went non-finite`);
  });
}
