// Batch 2 motor testleri: BOMB / CURVE / SNAKE.
// Harness birinci partiyle aynı (Proxy 2D context, sahte window/document, Vite SSR modülü).
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

const canvas = {
  width: 800,
  height: 600,
  getContext: () => context,
};

const FRAME_MS = 16;

let server;
let CurveGame;
let BombGame;
let SnakeGame;
let HeistGame;
let CrownGame;
let ZoneGame;
let getSlotKeys;
let isWorldEntityVisible;

before(async () => {
  globalThis.window = {
    innerWidth: 800,
    innerHeight: 600,
    addEventListener: noop,
    removeEventListener: noop,
    AudioContext: null,
    webkitAudioContext: null,
    matchMedia: () => ({ matches: false }),
  };
  globalThis.document = {
    activeElement: null,
    body: {},
    addEventListener: noop,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  };

  server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
  });
  ({ CurveGame } = await server.ssrLoadModule('/src/games/curve.js'));
  ({ BombGame } = await server.ssrLoadModule('/src/games/bomb.js'));
  ({ SnakeGame } = await server.ssrLoadModule('/src/games/snake.js'));
  ({ HeistGame } = await server.ssrLoadModule('/src/games/heist.js'));
  ({ CrownGame } = await server.ssrLoadModule('/src/games-retired/crown.js'));
  ({ ZoneGame } = await server.ssrLoadModule('/src/games/zone.js'));
  ({ getSlotKeys } = await server.ssrLoadModule('/src/core/inputMaps.js'));
  ({ isWorldEntityVisible } = await server.ssrLoadModule('/src/games/worldCore.js'));
});

after(async () => {
  await server?.close();
});

// INVERT işaret çevrimi ölçülür; gap dokunulmazlığı ve intro bunu bozmasın.
function configureCurve(slotTypes = ['human', 'human', 'human', 'human']) {
  const game = new CurveGame(canvas);
  game.resize(800, 600);
  game.slotTypes = [...slotTypes];
  game.initPlayers();
  game.startRound();
  game.spawnIntroTimer = 0;
  game.lastTime = 1000;
  for (const p of game.players) {
    p.isGap = false;
    p.gapTimer = 99;
    p.gapDuration = 0;
    p.ghostTimer = 0;
    p.confusedTimer = 0;
  }
  return game;
}

function configureBomb() {
  const game = new BombGame(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'human', 'empty', 'empty'];
  game.initPlayers();
  game.startNewMatch();
  game.lastTime = 1000;
  return game;
}

function configureSnake() {
  const game = new SnakeGame(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'human', 'empty', 'empty'];
  game.initPlayers();
  game.startNewMatch();
  game.lastTime = 1000;
  return game;
}

function configureHeist() {
  const game = new HeistGame(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'human', 'empty', 'empty'];
  game.initPlayers();
  game.startNewMatch();
  game.lastTime = 1000;
  return game;
}

function configureCrown() {
  const game = new CrownGame(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'human', 'empty', 'empty'];
  game.initPlayers();
  game.startNewMatch();
  game.lastTime = 1000;
  return game;
}

function configureZone() {
  const game = new ZoneGame(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'human', 'empty', 'empty'];
  game.initPlayers();
  game.startNewRound();
  game.lastTime = 1000;
  return game;
}

// Tek kare ilerlet ve hedef slotun açı deltasını döndür.
function turnAfterFrame(game, slot) {
  const before = game.players[slot].angle;
  game.lastTime = 1000;
  game.update(1000 + FRAME_MS);
  return game.players[slot].angle - before;
}

// Slot + yön verip tek kare dönüşü ölçer: girdi yolu ne olursa olsun aynı kapıdan geçer.
function turnOf(game, slot, dir, { confused = false, via = 'steer' } = {}) {
  const player = game.players[slot];
  player.angle = 0;
  player.steer = 0;
  player.confusedTimer = confused ? 4 : 0;

  if (via === 'steer') {
    game.onSlotSteer(slot, dir);
  } else if (via === 'keyboard') {
    game.keys[getSlotKeys(slot)[dir > 0 ? 'r' : 'l']] = true;
  } else if (via === 'remote') {
    game.handleRemoteInput(slot, { action: 'CURVE_STEER', dir });
  }

  return turnAfterFrame(game, slot);
}

const INPUT_PATHS = ['steer', 'keyboard', 'remote'];

test('world visibility accepts host and snapshot player shapes', () => {
  assert.equal(isWorldEntityVisible({ isJoined: true, isAlive: true }), true);
  assert.equal(isWorldEntityVisible({ isJoined: false, isAlive: true }), false);
  assert.equal(isWorldEntityVisible({ isJoined: true, isAlive: false }), false);
  assert.equal(isWorldEntityVisible({ joined: true, alive: true }), true);
  assert.equal(isWorldEntityVisible({ joined: false, alive: true }), false);
  assert.equal(isWorldEntityVisible({ joined: true, alive: false }), false);
});

test('BOMB/HEIST/CROWN lobby cycles synchronize player entities', () => {
  for (const Game of [BombGame, HeistGame, CrownGame]) {
    const game = new Game(canvas);
    game.resize(800, 600);
    const slot = 2;
    assert.equal(game.slotTypes[slot], 'empty');

    game.cycleSlotType(slot);
    assert.equal(game.players[slot].slotType, 'human');
    assert.equal(game.players[slot].isJoined, true);

    game.cycleSlotType(slot);
    assert.equal(game.players[slot].slotType, 'bot_normal');
    assert.equal(game.players[slot].isJoined, true);

    game.cycleSlotType(slot);
    assert.equal(game.players[slot].slotType, 'bot_god');
    assert.equal(game.players[slot].isJoined, true);

    game.cycleSlotType(slot);
    assert.equal(game.players[slot].slotType, 'empty');
    assert.equal(game.players[slot].isJoined, false);
  }
});

test('CURVE: steer alan her girdi yolu ham niyeti yazar', () => {
  const game = configureCurve();

  game.onSlotSteer(0, 1);
  assert.equal(game.players[0].steer, 1, 'tabletop sağ buton');
  game.onSlotSteer(0, -1);
  assert.equal(game.players[0].steer, -1, 'tabletop sol buton');

  game.players[1].steer = 0;
  game.keys[getSlotKeys(1).r] = true;
  turnAfterFrame(game, 1);
  assert.equal(game.players[1].steer, 1, 'klavye sağ tuşu');

  game.players[2].steer = 0;
  game.handleRemoteInput(2, { action: 'CURVE_STEER', dir: -1 });
  assert.equal(game.players[2].steer, -1, 'uzak kumanda CURVE_STEER');
});

test('CURVE-01: INVERT her girdi yolunda yönü tam olarak bir kez tersler', () => {
  for (const via of INPUT_PATHS) {
    const game = configureCurve();
    const clear = turnOf(game, 0, 1, { via });
    const inverted = turnOf(game, 0, 1, { via, confused: true });

    assert.ok(Math.abs(clear) > 0, `${via}: dönüş üretilmeli`);
    assert.ok(
      Math.sign(clear) !== Math.sign(inverted),
      `${via}: INVERT yönü terslemeli (temiz=${clear.toFixed(5)}, karışık=${inverted.toFixed(5)})`
    );
    assert.ok(
      Math.abs(Math.abs(clear) - Math.abs(inverted)) < 1e-9,
      `${via}: INVERT dönüş hızını değiştirmemeli`
    );
  }
});

test('CURVE-01: yerel ve uzak koltuk INVERT altında aynı işareti üretir', () => {
  const signs = INPUT_PATHS.map((via) => {
    const game = configureCurve();
    return Math.sign(turnOf(game, 0, 1, { via, confused: true }));
  });

  assert.ok(
    signs.every((s) => s === signs[0]),
    `üç girdi yolu da aynı yönde dönmeli, alınan: ${JSON.stringify(signs)}`
  );
});

test('CURVE-01: karışık bot aynalanmaz, dönüşü her zaman AI steer kararını izler', () => {
  const game = configureCurve(['human', 'human', 'bot_god', 'bot_god']);
  const bot = game.players[2];
  bot.confusedTimer = 4.0;

  let checked = 0;
  for (let frame = 1; frame <= 60; frame++) {
    // Bu test yalnızca işaret yönünü doğrular: raunt çökersese simülasyonu canlı tut.
    game.state = 'PLAYING';
    bot.isAlive = true;
    bot.botTurnCommitment = 1;
    bot.botCheckTimer = 1;
    bot.steer = 1;
    const before = bot.angle;
    game.update(1000 + frame * FRAME_MS);
    const delta = bot.angle - before;
    if (Math.abs(delta) < 1e-9) continue;
    checked += 1;
    assert.equal(
      Math.sign(delta),
      Math.sign(bot.steer),
      `frame ${frame}: karışık bot ${bot.steer} steer'ının tersine döndü`
    );
  }
  assert.ok(checked > 20, `bot hiç direksiyon kırmadı, örneklem yetersiz (${checked})`);
});

test('CURVE-01: INVERT süresi bot ve insanlarda geri sayar, kendiliğinden biter', () => {
  const game = configureCurve(['human', 'human', 'bot_normal', 'bot_normal']);
  game.players.forEach((p) => { p.confusedTimer = 4.0; });

  let frame = 0;
  while (game.players[0].confusedTimer > 0 && frame < 1000) {
    frame += 1;
    // Sayaç yalnızca PLAYING işler; raunt çökersenin işaretini ölçme.
    game.state = 'PLAYING';
    for (const p of game.players) p.isAlive = p.isJoined;
    game.update(1000 + frame * FRAME_MS);
  }

  assert.ok(frame > 0 && frame < 1000, 'etki hiç sonlanmadı');
  for (const p of game.players) {
    assert.equal(p.confusedTimer, 0, `slot ${p.index} etkisi temizlenmedi`);
  }
});

test('BOMB resolves zero survivors as a match draw and rejects stunned dash', () => {
  const game = configureBomb();
  assert.equal(game.roundId, 1);

  const player = game.players[0];
  player.dashCooldown = 0;
  player.slipTimer = 0;
  player.stumbleTimer = 1;
  game.triggerDash(0);
  assert.equal(player.dashTimer, 0);

  game.players.forEach((p) => { p.isAlive = false; });
  game.state = 'PLAYING';
  game.lastTime = 1000;
  game.update(1016);
  assert.equal(game.state, 'ROUND_OVER');
  assert.equal(game.matchDraw, true);

  game.roundTransitionTimer = 0;
  game.update(1032);
  assert.equal(game.state, 'MATCH_OVER');
});

test('CURVE gates spawn input and resolves timeout as a draw', () => {
  const game = configureCurve();
  const player = game.players[0];
  game.spawnIntroTimer = 1;
  const before = player.angle;
  player.steer = 1;
  game.lastTime = 1000;
  game.update(1016);
  assert.equal(player.angle, before);
  assert.equal(player.steer, 0);

  game.spawnIntroTimer = 0;
  game.roundTimer = game.roundLimit - 0.001;
  game.lastTime = 1016;
  game.update(1032);
  assert.equal(game.state, 'ROUND_OVER');
  assert.equal(game.matchDraw, true);
});

test('SNAKE separates food score, sweeps wall collision, and resolves zero survivors', () => {
  const game = configureSnake();
  const player = game.players[0];
  player.x = 400;
  player.y = 300;
  player.angle = 0;
  player.segments = [];
  game.foods = [];
  game.spawnFood(400, 300, 'GOLDEN_STAR');
  const scoreBefore = game.scores[0];
  game.lastTime = 1000;
  game.update(1016);
  assert.equal(game.scores[0], scoreBefore);
  assert.equal(player.foodCount, 3);

  game.startRound();
  game.walls = [{ x: 106, y: 290, w: 30, h: 20 }];
  const p0 = game.players[0];
  p0.x = 100;
  p0.y = 300;
  p0.angle = 0;
  p0.segments = [];
  game.lastTime = 920;
  game.update(1000);
  assert.equal(p0.isAlive, false);

  game.players.forEach((p) => { p.isAlive = false; });
  game.state = 'PLAYING';
  game.lastTime = 1000;
  game.update(1016);
  assert.equal(game.state, 'ROUND_OVER');
  assert.equal(game.matchDraw, true);
});

test('HEIST terminates an empty match and advances round ids', () => {
  const game = configureHeist();
  assert.equal(game.roundId, 1);
  game.players.forEach((p) => { p.isJoined = false; });
  game.state = 'PLAYING';
  game.lastTime = 1000;
  game.update(1016);
  assert.equal(game.state, 'ROUND_OVER');
  assert.equal(game.matchDraw, true);
});

test('CROWN resets dropped hold time and resolves timeout', () => {
  const game = configureCrown();
  const player = game.players[0];
  game.crown.carrierIndex = null;
  player.hasCrown = false;
  player.crownHoldTime = 10;
  game.crown.x = player.x;
  game.crown.y = player.y;
  game.crown.pickupCooldown = 0;
  game.lastTime = 1000;
  game.update(1016);
  assert.equal(player.hasCrown, true);
  assert.equal(player.crownHoldTime, 0);

  game.crown.carrierIndex = null;
  player.hasCrown = false;
  game.roundTimer = 0;
  game.lastTime = 1016;
  game.update(1032);
  assert.equal(game.state, 'ROUND_OVER');
});

test('ZONE bounty BFS reaches vertically adjacent territory', () => {
  const game = configureZone();
  game.grid.fill(0);
  const victimCell = 22 * 64 + 22;
  game.grid[victimCell] = 2;
  const start = game.cellCenter(22 * 64 + 20);
  game.players[0].x = start.x;
  game.players[0].y = start.y;
  const awarded = game.awardKillBounty(1, 0);
  assert.ok(awarded > 0);
  assert.equal(game.grid[victimCell], 1);
});

test('ZONE resolves equal timeout without awarding the first index', () => {
  const game = configureZone();
  game.pct = [30, 30, 0, 0];
  game.lastCaptureBy = -1;
  game.roundTimer = 0;
  game.lastTime = 1000;
  game.update(1016);
  assert.equal(game.state, 'ROUND_OVER');
  assert.equal(game.roundWinner, null);
  assert.equal(game.tiedRounds, 1);
});
