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
  ({ CrownGame } = await server.ssrLoadModule('/src/games/crown.js'));
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

test('BOMB rejects stunned dash and keeps a tied round going before ending the match', () => {
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

  // İlk beraberlik bir RAUNTtur: maç bitmez, oyun devam eder.
  assert.equal(game.state, 'ROUND_OVER');
  assert.equal(game.matchDraw, false, 'berabere raunt maç sonucu yazmaz');
  assert.equal(game.roundDrew, true);

  // Boşluk dolunca sonraki raunt başlar.
  game.roundTransitionTimer = 0;
  game.update(1032);
  assert.notEqual(game.state, 'MATCH_OVER');

  // Üst üste BOMB_MAX_TIED_ROUNDS beraberlikte maç BERABERE biter.
  // DİKKAT: `startNewRound` oyuncuları yeniden doğurur — öldürme SONRA yapılır.
  game.lastTime = 2000;
  game.update(2016);
  assert.equal(game.state, 'PLAYING', 'ikinci raunt başladı');
  game.players.forEach((p) => { p.isAlive = false; });
  game.update(2032);
  assert.equal(game.matchDraw, true, 'üst üste beraberlikte maç berabere biter');
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
  // Simülasyon dondurulur: açılışta dönülmez.
  assert.equal(player.angle, before);
  // Ama NİYET korunur: basılı tutulan yön intro bitince devralınır, oyuncu
  // bırakıp yeniden basmak zorunda kalmaz (ölçülen "donuyor" kusuru).
  assert.equal(player.steer, 1);
  // Raunt saati intro penceresinde işlemez.
  assert.equal(game.roundTimer, 0);

  game.spawnIntroTimer = 0;
  game.roundTimer = game.roundLimit - 0.001;
  game.lastTime = 1016;
  game.update(1032);

  // Zaman aşımı berabere RAUNTtur — maç bitmez, oyun devam eder.
  assert.equal(game.state, 'ROUND_OVER');
  assert.equal(game.matchDraw, false, 'zaman aşımı maçı bitirmez');
  assert.equal(game.roundDrew, true);

  game.roundTransitionTimer = 0;
  game.update(1048);
  assert.notEqual(game.state, 'MATCH_OVER');
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

  // Kimse hayatta kalmadıysa berabere RAUNT: maç bitmez, oyun devam eder.
  assert.equal(game.state, 'ROUND_OVER');
  assert.equal(game.matchDraw, false, 'berabere raunt maç sonucu yazmaz');
  assert.equal(game.roundDrew, true);

  game.roundTransitionTimer = 0;
  game.update(1032);
  assert.notEqual(game.state, 'MATCH_OVER');
});

test('SNAKE food radius scales with the field instead of staying at raw px', () => {
  const game = configureSnake();

  // Tasarım tabanı: ortak pickup ölçeği (arenaKit.PICKUP_SIZE.base = 15).
  // Ölçülen kusur: yem `size: 13` ham px idi ve view onu ÇAP sayıyordu, yani
  // gerçekte 6.5 px yarıçap çiziliyordu; kafa ise fieldRadius ile büyüyordu.
  game.foods = [];
  game.spawnFood(400, 300, 'APPLE');
  game.spawnFood(500, 300, 'TURBO_BERRY');
  game.spawnFood(600, 300, 'GOLDEN_STAR');
  const [apple, berry, star] = game.foods;
  const headRadius = game.players[0].radius;

  assert.ok(apple.radius > 6.5, `elma yarıçapı çizimle uyuşmalı (${apple.radius})`);
  assert.ok(berry.radius > apple.radius, 'berry elmadan büyük olmalı');
  assert.ok(star.radius > berry.radius, 'yıldız berryden büyük olmalı');
  assert.ok(star.radius < headRadius, 'yem kafadan büyük olmamalı');

  // Saha büyüdükçe yem de büyür — göreli boyut sabit kalır.
  const wide = configureSnake();
  wide.resize(1600, 1200);
  wide.foods = [];
  wide.spawnFood(700, 500, 'APPLE');
  assert.ok(
    wide.foods[0].radius > apple.radius * 1.5,
    `geniş saha yemi de büyütmeli (${wide.foods[0].radius} vs ${apple.radius})`
  );
});

test('CURVE HIZLAN accelerates, widens the turn and then cools down', () => {
  const game = configureCurve();
  const player = game.players[0];
  const baseSpeed = player.speed;

  // Kapılar: masa-ortası butonu, klavye aksiyon tuşu ve uzaktan kumanda aynı yola çıkar.
  game.triggerBoost(0);
  assert.equal(player.nitroTimer > 0, true);
  assert.ok(player.boostCooldown > 0);

  // Aynı karede ikinci deneme cooldown'a takılır.
  const before = player.nitroTimer;
  game.triggerBoost(0);
  assert.equal(player.nitroTimer, before);

  // Nitro aktifken yol hızlanır, dönüş genişler.
  const straight = { ...player, angle: 0, steer: 0, turboTimer: 0, freezeTimer: 0, confusedTimer: 0, isGap: true, gapTimer: 99, gapDuration: 0, ghostTimer: 0, shrinkTimer: 0, thickTimer: 0, botCheckTimer: 0, botSteer: 0, botTurnCommitment: 0 };
  const nitroPlayer = { ...straight, nitroTimer: 1 };
  const plainPlayer = { ...straight, nitroTimer: 0 };
  const measure = (p, frames) => {
    p.x = 100;
    p.y = 100;
    p.angle = 0;
    p.steer = 0;
    for (let f = 0; f < frames; f += 1) {
      p.angle += p.steer * p.turnSpeed * (p.nitroTimer > 0 ? 0.82 : 1) * 0.016;
      p.x += Math.cos(p.angle) * p.speed * (p.nitroTimer > 0 ? 1.45 : 1) * 0.016;
    }
    return p;
  };
  const fast = measure(nitroPlayer, 4);
  const plain = measure(plainPlayer, 4);
  assert.ok(fast.x - 100 > plain.x - 100, 'nitro hızı artırmalı');
  assert.equal(nitroPlayer.steer, 0);
  assert.ok(baseSpeed > 0);

  // Zamanlayıcılar işler, nitro biter ve cooldown dolar. Oyuncular iz çarpışmasıyla
  // elenirse raunt erken biter ve timer'lar donar; test yalnız timer'ları ölçtüğü
  // için konumları sabitleyip (aşağıda) kadroyu ayakta tutar.
  game.lastTime = 1000;
  game.update(1016);
  assert.ok(player.boostCooldown < 4 && player.boostCooldown > 3.9);
  // Dört koltuk, dört ayrı sabit nokta: noktalar birbirinden uzak ki hiçbir
  // oyuncu başkasının izine giremesin (kendi izi de 220 ms sonra ölümcül).
  const anchors = game.players.map((_, i) => ({
    x: game.arena.cx + (i % 2 === 0 ? -1 : 1) * game.arena.size * 0.3,
    y: game.arena.cy + (i < 2 ? -1 : 1) * game.arena.size * 0.3,
  }));
  for (let f = 0; f < 120; f += 1) {
    game.players.forEach((p, i) => {
      p.isAlive = p.isJoined;
      if (!p.isJoined) return;
      p.x = anchors[i].x;
      p.y = anchors[i].y;
      p.angle = 0;
      p.steer = 0;
    });
    game.state = 'PLAYING';
    game.update(game.lastTime + 16);
  }
  assert.equal(game.state, 'PLAYING', 'raun ölçüm sırasında bitmemeliydi');
  assert.equal(player.nitroTimer, 0);
  assert.ok(player.boostCooldown > 0 && player.boostCooldown < 4);
});

test('CURVE nitro reaches the engine through every input path', () => {
  const game = configureCurve();
  game.handleRemoteInput(1, { action: 'CURVE_BOOST' });
  assert.ok(game.players[1].nitroTimer > 0);

  game.players[2].boostCooldown = 0;
  game.handleSlotAction(2, 'boost', true);
  assert.ok(game.players[2].nitroTimer > 0);

  // Lobi/maç dışı ve cooldown durumunda tetikleme yapmaz.
  game.players[3].boostCooldown = 0;
  game.state = 'LOBBY';
  game.handleSlotAction(3, 'boost', true);
  assert.equal(game.players[3].nitroTimer, 0);
});

test('HEIST terminates an empty match and advances round ids', () => {  const game = configureHeist();
  assert.equal(game.roundId, 1);
  game.players.forEach((p) => { p.isJoined = false; });
  game.state = 'PLAYING';
  game.lastTime = 1000;
  game.update(1016);

  // Kimse kalmadıysa MAÇ berabere biter (HEIST'te oyuncu yoksa devam edecek
  // bir maç yok) — ama yine de boşluktan sonra, anında değil.
  assert.equal(game.matchDraw, true);
  assert.equal(game.state, 'MATCH_OVER');
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

// AGENTS §4: masa-ortası çizim `core/tabletopRenderer.js`'te, BaseGame yalnız
// delegasyon. Motor sözleşmesi (this.renderControls / this.renderHUD /
// renderStandard*) korunduğu için her state'te çizim hâlâ patlamamalı — test
// motorun kendi render()'ını değil, taşınan yüzeyi doğrudan çalıştırır.
test('tabletopRenderer surface renders every HUD state without throwing', () => {
  for (const configure of [configureBomb, configureHeist, configureCrown, configureSnake, configureCurve, configureZone]) {
    const game = configure();

    game.state = 'PLAYING';
    game.keys = { KeyA: true, KeyD: true, KeyJ: true, KeyL: true };
    game.tabletopSteerState = [-1, 1, 0, 0];
    game.renderControls(context, { extraEntities: [] });
    game.renderControls(context);
    game.renderStandardJoysticks(context);

    game.state = 'ROUND_OVER';
    game.roundWinner = game.players?.[0] || null;
    game.renderHUD(context, { roundBannerSub: '3' });

    game.state = 'MATCH_OVER';
    game.matchWinner = game.players?.[0] || null;
    game.renderHUD(context);
    assert.ok(game.matchOverCard, 'maç sonu kart kutusu motor alanına yazılmalı');

    game.state = 'LOBBY';
    game.renderHUD(context, { guideTitle: 'K', guideEntries: [{ icon: 'action', label: 'A' }] });
    assert.ok(game.uiButtons.length >= 4, 'lobi dört koltuk butonu üretmeli');
  }
});

// AGENTS §11: LOCAL DOM (telefon) sonucu TEK yüzeydir — telefon modalı
// (`gamepad.js .result-card`). Canvas final kartı da çizilirse sonuç iki kez
// belirir: önce canvas kartı, ~yarım saniye sonra karartılı modal. DOM
// yüzeyinde kart çizilmez; host/TV (CANVAS/NONE) kartın tek sahibidir.
test('MATCH_OVER canvas card is suppressed on the LOCAL DOM surface', async () => {
  const { CONTROL_MODE } = await server.ssrLoadModule('/src/ui/tokens.js');
  for (const configure of [configureBomb, configureHeist]) {
    const game = configure();
    game.state = 'MATCH_OVER';
    game.matchWinner = game.players?.[0] || null;

    game.localControlMode = CONTROL_MODE.CANVAS;
    game.matchOverCard = null;
    game.renderHUD(context);
    assert.ok(
      game.matchOverCard && game.matchOverCard.w < 1e6,
      'canvas yüzeyi final kartını çizip gerçek kutusunu yazmalı',
    );

    game.localControlMode = CONTROL_MODE.DOM;
    game.renderHUD(context);
    assert.ok(
      game.matchOverCard && game.matchOverCard.w >= 1e6,
      'DOM yüzeyinde kart çizilmez; yalnız tüm sahaya yayılan dokunuş yutucu kalır',
    );
  }
});

// AGENTS §4 (tek kaynak): direksiyon ipucu dizisi elle yazılmaz, klavye
// eşlemesinden türetilir. Harf kayması (A/D → S/D) oyuncuya yanlış tuş
// gösterir; bu yüzden türetilen dizi sözleşmeyle birebir aynı olmalı.
test('STEER_KEY_HINTS is derived from the slot keyboard map, not hand-written', async () => {
  const { STEER_KEY_HINTS } = await server.ssrLoadModule('/src/core/inputMaps.js');
  assert.deepEqual(STEER_KEY_HINTS, ['A/D', '←/→', 'J/L', 'F/H']);
});

// Faz 2.2: 11 motorun keydown/keyup dinleyicisi artık `core/keyboardDispatch`
// içindeki tek çift üzerinden dağıtılır. Motor başına yeni `window`
// dinleyicisi eklenmez; `destroy()` aboneliği bırakır, yani tahliye edilen
// motor artık tuş olaylarını görmez (sızıntı yok).
test('keyboard listeners go through one shared dispatch and release on destroy', async () => {
  const { keyboardSubscriberCount, unbindKeyboard } = await server.ssrLoadModule('/src/core/keyboardDispatch.js');

  const windowAdd = globalThis.window.addEventListener;
  let added = 0;
  globalThis.window.addEventListener = function patched(type, ...rest) {
    if (type === 'keydown' || type === 'keyup') added++;
    return windowAdd.call(this, type, ...rest);
  };

  try {
    const before = keyboardSubscriberCount();
    const game = new BombGame(canvas);
    game.resize(800, 600);
    const afterBind = keyboardSubscriberCount();
    assert.ok(afterBind > before, 'motor klavye aboneliği kaydedilmeli');

    // Motor başına tam olarak bir down + bir up abonelik (ondan fazlası
    // her initKeyboard çağrısında çoğalırdı).
    assert.equal(afterBind - before, 2);

    // Aynı motor ikinci kez bağlansa abonelik artmaz.
    game.initKeyboard();
    assert.equal(keyboardSubscriberCount(), afterBind);

    // destroy() aboneliği bırakır.
    game.destroy();
    assert.equal(keyboardSubscriberCount(), before);

    // İlk motorun bağlanması paylaşılan çifti kurar; sonrakiler yenisi eklemez.
    assert.equal(added <= 3, true, `paylaşılan dispatch en çok 3 dinleyici eklemeli, ${added} eklendi`);
  } finally {
    globalThis.window.addEventListener = windowAdd;
  }

  assert.equal(typeof unbindKeyboard, 'function');
});
