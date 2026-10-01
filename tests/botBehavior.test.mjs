import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const noop = () => {};
const gradient = { addColorStop: noop };
const context = new Proxy({
  measureText: () => ({ width: 0 }),
  createLinearGradient: () => gradient,
  createRadialGradient: () => gradient,
}, {
  get(target, key) {
    return key in target ? target[key] : noop;
  },
  set(target, key, value) {
    target[key] = value;
    return true;
  },
});

const canvas = { width: 800, height: 600, getContext: () => context };
let server;
let ArcherGame;
let TanksGame;
let PongGame;
let updateArcherBotAI;
let updateNinjaBotAI;
let tankAI;

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
  ({ ArcherGame } = await server.ssrLoadModule('/src/games/archer.js'));
  ({ TanksGame } = await server.ssrLoadModule('/src/games/tanks.js'));
  ({ Game: PongGame } = await server.ssrLoadModule('/src/games/game.js'));
  ({ updateArcherBotAI } = await server.ssrLoadModule('/src/ai/archerAI.js'));
  ({ updateNinjaBotAI } = await server.ssrLoadModule('/src/ai/ninjaAI.js'));
  tankAI = await server.ssrLoadModule('/src/ai/tankAI.js');
});

after(async () => {
  await server?.close();
});

function slots(count, type = 'bot_god') {
  return Array.from({ length: 4 }, (_, i) => (i < count ? type : 'empty'));
}

function step(game, frames) {
  for (let i = 0; i < frames; i++) game.update(1000 + (i + 1) * 16);
}

function archerBots() {
  const game = new ArcherGame(canvas);
  game.resize(800, 600);
  game.slotTypes = slots(2);
  game.initPlayers();
  game.startNewMatch();
  game.state = 'PLAYING';
  return game;
}

// Botları sabit birbirine kilitleyen arena: nişan kapısı ölçülemezse harita
// engelleri sonucu belirliyor ve test rastgele olur.
function archerDuel() {
  const game = archerBots();
  const [bot, target] = game.players;
  game.obstacles = [];
  bot.isJoined = true;
  bot.isAlive = true;
  target.isJoined = true;
  target.isAlive = true;
  bot.x = game.arena.left + 200;
  bot.y = game.arena.cy;
  target.x = game.arena.right - 200;
  target.y = game.arena.cy;
  bot.angle = 0;
  return { game, bot, target };
}

// ---------------------------------------------------------------- ARCHER ----
// Regresyon: eski AI'da hareket vektörü hedefe göre atan(0.7) = 0.61 rad
// sapıyordu, gergi kapısı 0.35 rad istiyordu -> bot HİÇBİR mesafede ok atamıyordu.

test('archer bot reaches the draw gate from every distance band', () => {
  const game = archerBots();
  game.obstacles = []; // nişan kapısını tek başına ölçüyoruz
  const bot = game.players[0];
  const target = game.players[1];
  target.isAlive = true;
  target.isJoined = true;

  for (const dist of [120, 200, 240, 320, 420, 470]) {
    bot.charging = false;
    bot.charge = 0;
    bot.shotCooldown = 0;
    bot.angle = 0;
    target.x = bot.x + dist;
    target.y = bot.y;
    let drew = false;
    for (let i = 0; i < 60; i++) {
      updateArcherBotAI(game, bot, 1 / 60);
      if (bot.charging) { drew = true; break; }
    }
    assert.equal(drew, true, `bot dist=${dist} bandında yay gergileyemedi`);
  }
});

test('archer bot looses arrows down a clear lane', () => {
  const { game, bot, target } = archerDuel();
  let shots = 0;
  // 1.0sn gergi + 0.8sn soğuma = döngü ~1.8sn; 10sn güvenli pay.
  for (let i = 0; i < 640; i++) {
    // Hedefi menzilde tut: bot kaçmaya çalışınca ok atmıyor, test de ölçemiyor.
    target.x = game.arena.right - 200;
    target.y = game.arena.cy;
    const n = game.arrows.length;
    game.update(1000 + (i + 1) * 16);
    if (game.arrows.length > n) shots++;
  }
  assert.ok(shots >= 2, `açık hatta 10sn'de yalnız ${shots} ok çıktı`);
});

test('archer bot does not loose through a blocked lane', () => {
  const { game, bot, target } = archerDuel();
  // Tam önüne, tüm sütunu kapatan duvar.
  game.obstacles = [{
    x: (bot.x + target.x) / 2 - 20, y: game.arena.top,
    w: 40, h: game.arena.size,
  }];
  bot.charging = false;
  bot.charge = 0;
  for (let i = 0; i < 180; i++) updateArcherBotAI(game, bot, 1 / 60);
  assert.equal(bot.charging, false, 'engel arkasına gergi yaptı');
});

// ----------------------------------------------------------------- TANKS ----

test('tank line-of-sight accepts a diagonal shot that passes beside an obstacle', () => {
  const game = { obstacles: [{ x: 300, y: 100, w: 40, h: 40 }] };
  // Işın direğin ~20px altından geçiyor -> gerçekte temiz.
  assert.equal(tankAI.hasLineOfSight(game, 100, 120, 500, 300), true,
    'diyagonal temiz ışın yanlışlıkla engelli sayıldı');
  // Işın direğin içinden geçiyor -> gerçekte kapalı.
  assert.equal(tankAI.hasLineOfSight(game, 100, 120, 500, 120), false,
    'direk içinden geçen ışın temiz sayıldı');
});

test('tank ricochet check includes obstacle faces, not only arena walls', () => {
  const arena = { left: 0, right: 600, top: 0, bottom: 400 };
  const tank = { x: 100, y: 200, angle: -0.2, isJoined: true, isAlive: true, index: 1 };
  const enemy = { x: 200, y: 120, isJoined: true, isAlive: true, index: 2 };
  const obstacle = { x: 300, y: 150, w: 20, h: 40 };

  // Duvar versiyonu: yansıma yukarı-sola gider, duvardan ulaşılamaz -> false.
  assert.equal(tankAI.checkRicochetShot({ arena, obstacles: [] }, tank, [enemy]), false);
  // Engel versiyonu: aynı hat, ama secme yüzeyi engel -> true.
  assert.equal(tankAI.checkRicochetShot({ arena, obstacles: [obstacle] }, tank, [enemy]), true,
    'engel yüzeyinden seken atış hesaba katılmadı');
});

test('tank bot shoots when it has a clear line to a visible target', () => {
  const game = new TanksGame(canvas);
  game.resize(800, 600);
  game.slotTypes = slots(2);
  game.initTanks();
  game.startNewMatch();
  game.state = 'PLAYING';

  const bot = game.tanks[0];
  const enemy = game.tanks[1];
  for (const t of [bot, enemy]) {
    t.isAlive = true;
    t.isJoined = true;
  }
  bot.reloadTimer = 0;
  bot.botAimHold = 0;
  bot.botLastShot = 0;
  bot.botClock = 0;

  game.obstacles = [];
  game.bullets = [];
  bot.x = game.arena.left + 80;
  bot.y = game.arena.cy;
  enemy.x = game.arena.right - 80;
  enemy.y = game.arena.cy;
  bot.angle = 0;

  const before = game.bullets.length;
  for (let i = 0; i < 260 && game.bullets.length === before; i++) {
    game.update(1000 + (i + 1) * 16);
  }
  assert.ok(game.bullets.length > before, 'tank bot açık hatta bile ateş etmedi');
});

// ------------------------------------------------------------------ PONG ----

test('normal pong bot moves fast enough to reach the ball it tracks', () => {
  const game = new PongGame(canvas);
  game.resize(800, 600);
  game.slotTypes = ['bot_normal', 'bot_god', 'empty', 'empty'];
  // PONG'da initPlayers yok: paddle kendi slotType/isJoined'unu taşır,
  // lobide slot döngüsüyle kurulur. Test aynı durumu doğrudan kurar.
  game.paddles.forEach((p, i) => {
    p.slotType = game.slotTypes[i];
    p.isJoined = game.slotTypes[i] !== 'empty';
  });
  game.startNewMatch();
  game.state = 'PLAYING';

  const paddle = game.paddles.find((p) => p.isJoined && p.slotType === 'bot_normal');
  assert.ok(paddle, 'normal bot paddle bulunamadı');
  const { arena, ball } = game;
  const arenaRef = Math.min(arena.width, arena.height);

  // Top tavan hızında ve raketin ters ucuna gidiyor. Bot toptan yavaşsa asla yetişemez.
  const ballSpeed = arenaRef * 1.5;
  ball.x = arena.left + arenaRef * 0.2;
  ball.y = paddle.maxCoord;
  ball.vx = ballSpeed;
  ball.vy = ballSpeed * 0.4;
  ball.isDead = false;
  paddle.coord = paddle.minCoord;
  paddle.botErrorOffset = 0;

  const span = paddle.maxCoord - paddle.minCoord;
  const startCoord = paddle.coord;
  step(game, 30); // 0.5 sn
  const travelled = paddle.coord - startCoord;
  assert.ok(travelled > 0, 'bot topa doğru hiç hareket etmedi');
  assert.ok(travelled > span * 0.25,
    `bot 0.5sn'de raket uzunluğunun %${((travelled / span) * 100).toFixed(0)}'ini kat etti (max hız yetersiz)`);
});

// ----------------------------------------------------------------- NINJA ----

test('ninja bot strikes the nearest visible target and skips blocked ones', () => {
  const game = {
    arena: { cx: 0, cy: 0, size: 800, left: -400, right: 400, top: -400, bottom: 400 },
    players: [],
    obstacles: [{ x: -10, y: -300, w: 20, h: 290 }], // y=-300..-10 arası duvar
    lanterns: [],
    attemptStrike: () => { game.strikes = (game.strikes || 0) + 1; },
    attemptSmoke: () => {},
  };
  const bot = {
    index: 0, x: 0, y: 0, angle: 0,
    steerX: 0, steerY: 0, botState: 'HIDE', botTimer: 99,
    botTargetX: 0, botTargetY: 0,
    strikeCooldown: 0, smokeCooldown: 0, inLight: false, alpha: 1,
  };
  // index 1 daha YAKIN ama duvar arkasında; index 2 uzak ama açık.
  game.players = [
    { index: 1, x: 30, y: -150, isJoined: true, isAlive: true, alpha: 1 },
    { index: 2, x: 60, y: 0, isJoined: true, isAlive: true, alpha: 1 },
  ];

  updateNinjaBotAI(game, bot, 1 / 60);
  assert.equal(game.strikes, 1, 'bot görüş hattı olmayan hedefe vurdu');
  assert.ok(Math.abs(bot.angle) < 0.01, `bot yanlış hedefe döndü (angle=${bot.angle})`);
});
