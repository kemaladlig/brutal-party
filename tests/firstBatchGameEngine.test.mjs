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

let server;
let PongGame;
let ArcherGame;
let LaserGame;
let TanksGame;
let physics;
let blendWorldFrames;

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
  };

  server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
  });
  ({ Game: PongGame } = await server.ssrLoadModule('/src/games/game.js'));
  ({ ArcherGame } = await server.ssrLoadModule('/src/games/archer.js'));
  ({ LaserGame } = await server.ssrLoadModule('/src/games/laser.js'));
  ({ TanksGame } = await server.ssrLoadModule('/src/games/tanks.js'));
  physics = await server.ssrLoadModule('/src/core/physics2d.js');
  ({ blendWorldFrames } = await server.ssrLoadModule('/src/ui/gamepadWorldView.js'));
});

after(async () => {
  await server?.close();
});

function configurePong() {
  const game = new PongGame(canvas);
  game.resize(800, 600);
  game.paddles[0].slotType = 'human';
  game.paddles[0].isJoined = true;
  game.paddles[0].isEliminated = false;
  game.paddles[1].slotType = 'human';
  game.paddles[1].isJoined = true;
  game.paddles[1].isEliminated = false;
  return game;
}

function configureArcher() {
  const game = new ArcherGame(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'human', 'empty', 'empty'];
  game.initPlayers();
  return game;
}

function configureLaser() {
  const game = new LaserGame(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'human', 'empty', 'empty'];
  game.initPlayers();
  return game;
}

function configureTanks() {
  const game = new TanksGame(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'bot_normal', 'empty', 'empty'];
  game.initTanks();
  return game;
}

test('swept collision helpers find crossings and stable normals', () => {
  const circle = physics.segmentCircleIntersection(0, 0, 100, 0, 50, 0, 10);
  assert.ok(circle);
  assert.ok(Math.abs(circle.t - 0.4) < 1e-9);

  const left = physics.segmentAabbIntersection(0, 0, 100, 0, { x: 40, y: -10, w: 20, h: 20 });
  const right = physics.segmentAabbIntersection(100, 0, 0, 0, { x: 40, y: -10, w: 20, h: 20 });
  assert.equal(left.nx, -1);
  assert.equal(right.nx, 1);
  assert.equal(physics.getProjectileSubsteps(44, 8), 6);
  assert.equal(physics.getProjectileSubsteps(0, 8), 1);
});

test('tank projectile interpolation follows stable ids', () => {
  const previous = {
    mode: 'TANKS', roundId: 1, gameState: 'PLAYING', players: [], arrows: [],
    bullets: [[0, 0, 4.5, 0, 0, 0, 9]],
  };
  const current = {
    ...previous,
    bullets: [[10, 20, 4.5, 0, 10, 20, 9]],
  };
  const blended = blendWorldFrames(previous, current, 0.5);
  assert.equal(blended.bullets[0][0], 5);
  assert.equal(blended.bullets[0][1], 10);
});

test('PONG stall recovery returns to a neutral lane', () => {
  const game = configurePong();
  game.state = 'PLAYING';
  game.ball.x = 120;
  game.ball.y = 120;
  game.ball.vx = 0;
  game.ball.vy = 0;
  game.stallTimer = 3;
  game.stallX = game.ball.x;
  game.stallY = game.ball.y;
  game.lastRallySeen = game.ball.rallyCount;
  game.rallyStallT = 0;
  game.breakStall(0.016);
  assert.equal(game.ball.x, game.arena.cx);
  assert.equal(game.ball.y, game.arena.cy);
  assert.ok(Math.hypot(game.ball.vx, game.ball.vy) > 0);
  assert.equal(game.stallRecoveryCount, 1);
});

test('PONG never teleports a ball that is still flying', () => {
  // Regresyon: takılma-kırıcı "2.5 sn'de 4 px oynamadı" diye sayıyordu. Sabit
  // 4 px, 1/120 sn adımda 480 px/s'lik GİZLİ bir hız eşiğidir ve servis hızı
  // (startSpeed = baseMinSpeed * 1.30) tam onun 0.1% üstündeydi. Sürtünme
  // topu eşiğin altına düşürüp 2.5 sn sonra UÇAN topu merkeze ışınlıyordu —
  // oyuncunun "top birkaç sekmeden sonra bir kereliğine tuhaf davranıyor"
  // dediği şey buydu. Kırıcı yalnız top hız tabanının altına düşerse çalışmalı.
  for (const [width, height] of [[800, 600], [1280, 720], [1920, 1080], [393, 852]]) {
    const game = configurePong();
    game.resize(width, height);
    game.state = 'PLAYING';
    game.launchBall();

    const step = game.fixedStep;
    let teleports = 0;
    for (let i = 0; i < 120 * 6; i++) {
      // Servis hızından düşen, topu hiç engellemeden uçan bir top.
      game.ball.vx *= game.ball.dragFactor;
      game.ball.vy *= game.ball.dragFactor;
      game.ball.x += game.ball.vx * step;
      game.ball.y += game.ball.vy * step;
      game.lastRallySeen = game.ball.rallyCount;

      const pos = { x: game.ball.x, y: game.ball.y };
      game.breakStall(step);
      if (Math.hypot(game.ball.x - pos.x, game.ball.y - pos.y) > 40) teleports++;
      // saha dışına çıkmasın
      if (game.ball.x < game.arena.left || game.ball.x > game.arena.right
        || game.ball.y < game.arena.top || game.ball.y > game.arena.bottom) {
        game.ball.x = game.arena.cx;
        game.ball.y = game.arena.cy;
      }
    }

    assert.equal(
      teleports,
      0,
      `${width}x${height}: flying ball teleported ${teleports}x in 6s — the stall breaker is firing on a moving ball`,
    );
  }
});

test('PONG stall breaker still recovers a genuinely stopped ball', () => {
  // Yukarıdaki düzeltmenin bedeli: kırıcı hâlâ kendi işini yapıyor mu?
  // Top durduğunda (hız ~0) 2.5 sn sonra nötr servis vermeli.
  for (const [width, height] of [[800, 600], [393, 852]]) {
    const game = configurePong();
    game.resize(width, height);
    game.state = 'PLAYING';
    game.ball.x = 130;
    game.ball.y = 130;
    game.ball.vx = 0;
    game.ball.vy = 0;
    game.stallTimer = 0;
    game.stallX = game.ball.x;
    game.stallY = game.ball.y;
    game.lastRallySeen = game.ball.rallyCount;
    game.rallyStallT = 0;

    for (let i = 0; i < 120 * 2.4; i++) game.breakStall(game.fixedStep);
    assert.equal(game.stallRecoveryCount, 0, `${width}x${height}: fired early`);

    for (let i = 0; i < 120 * 0.4; i++) game.breakStall(game.fixedStep);
    assert.equal(game.stallRecoveryCount, 1, `${width}x${height}: stopped ball was not recovered`);
    assert.ok(Math.hypot(game.ball.vx, game.ball.vy) > 0, 'recovery must put the ball back in play');
  }
});

test('PONG ball stays within reach of the fastest human paddle', () => {
  // Adalet kuralı: top tavan hızında gelirken oyuncu, raketin TAPMAYAN kalan
  // mesafeyi (goalSpan - length) top sahanın bir ucundan diğerine geçerken
  // kapatabilmelidir. Değişmez "cap/paddle" çarpanı bu yüzden sabit bir
  // sayı değil, ölçümle kilitli bir üst sınırdır: çok yüksek çarpan topu
  // yapısal olarak yakalanamaz kılıyordu (1.30x denendi -> raket sahanın
  // yalnızca %77'sini kapsıyordu, kimse köşeden köşeye topu tutamıyordu).
  for (const [width, height] of [[800, 600], [1280, 720], [1920, 1080], [852, 393], [393, 852]]) {
    const game = configurePong();
    game.resize(width, height);

    const ball = game.ball;
    const paddle = game.paddles[0];
    const cap = Math.max(ball.startSpeed, ball.speedCap);
    const travelRange = game.getGoalBounds('bottom').goalSpan - paddle.length;
    const ballCrossTime = game.arena.size / cap;
    const paddleTime = travelRange / ball.paddleSpeed;

    assert.ok(
      paddleTime <= ballCrossTime,
      `${width}x${height}: paddle needs ${paddleTime.toFixed(3)}s to cover ${travelRange.toFixed(0)}px `
      + `but the ball crosses in ${ballCrossTime.toFixed(3)}s — a corner shot becomes uncatchable`,
    );
    // And it must not be trivially easy either: some tension is the point.
    assert.ok(
      cap > ball.paddleSpeed,
      `${width}x${height}: cap (${cap.toFixed(0)}) must exceed paddle speed `
      + `(${ball.paddleSpeed.toFixed(0)}) or the rally has no pressure`,
    );
  }
});

test('PONG speed curve is steep early then flattens', () => {
  // Eğri biçimi korunuyor mu: ilk 6 vuruş belirgin hızlanmalı, sonrası
  // yumuşak oturmalı (aşırılığı engelleyen kısım). Ölçüm: ilk 6 vuruşun
  // kazancı, sonraki 9 vuruşun kazancından büyük olmalı.
  for (const [width, height] of [[800, 600], [1920, 1080]]) {
    const game = configurePong();
    game.resize(width, height);
    game.ball.reset(game.arena.cx, game.arena.cy);
    game.state = 'PLAYING';

    const paddle = game.paddles[0];
    const speedAfter = (hit) => {
      game.ball.rallyCount = hit;
      game.ball.lastHitPlayer = -1;
      game.ball.isSmash = false;
      paddle.velocity = 0;
      game.ball.x = paddle.coord;
      game.ball.y = paddle.fixedPerpendicular - game.ball.radius - 3;
      game.ball.vx = 0;
      game.ball.vy = game.ball.startSpeed;
      game.ball.resolvePaddleCollision(paddle);
      return Math.hypot(game.ball.vx, game.ball.vy);
    };

    const serve = speedAfter(0);
    const atSix = speedAfter(6);
    const atFifteen = speedAfter(15);

    const earlyGain = atSix - serve;
    const lateGain = atFifteen - atSix;
    assert.ok(
      earlyGain > lateGain,
      `${width}x${height}: first 6 hits gain ${earlyGain.toFixed(0)} px/s but the next 9 gain `
      + `${lateGain.toFixed(0)} — the curve should be steep early and flat late`,
    );

    // Monotonic: never slows down mid-rally, never exceeds the cap.
    let prev = 0;
    const cap = Math.max(game.ball.startSpeed, game.ball.speedCap);
    for (let hit = 0; hit <= 20; hit++) {
      const s = speedAfter(hit);
      assert.ok(s >= prev - 1e-6, `${width}x${height} rally ${hit} slowed down: ${s.toFixed(0)} < ${prev.toFixed(0)}`);
      assert.ok(s <= cap + 1e-6, `${width}x${height} rally ${hit} exceeded cap: ${s.toFixed(0)} > ${cap.toFixed(0)}`);
      prev = s;
    }
  }
});

test('PONG speed rises on every hit across TV-sized viewports', () => {
  for (const [width, height] of [[800, 600], [1920, 1080], [3840, 2160]]) {
    const game = configurePong();
    game.resize(width, height);
    game.ball.reset(game.arena.cx, game.arena.cy);

    let speed = Math.hypot(game.ball.vx, game.ball.vy);
    assert.ok(speed > 0, `${width}x${height} serve should move`);
    assert.ok(speed < game.ball.speedCap * 0.9, `${width}x${height} serve needs acceleration headroom`);

    const paddle = game.paddles[0];
    for (let hit = 0; hit < 6; hit++) {
      game.ball.x = paddle.coord;
      game.ball.y = paddle.fixedPerpendicular - game.ball.radius - 4;
      game.ball.vx = 0;
      game.ball.vy = speed;
      game.ball.resolvePaddleCollision(paddle);

      const nextSpeed = Math.hypot(game.ball.vx, game.ball.vy);
      assert.ok(nextSpeed > speed, `${width}x${height} hit ${hit + 1} should accelerate`);
      speed = nextSpeed;
    }

    assert.ok(speed > Math.hypot(game.ball.startSpeed, 0) * 1.25);
  }
});

test('PONG opening serve heads toward an active paddle', () => {
  const game = configurePong();
  game.launchBall();

  assert.ok(Math.hypot(game.ball.vx, game.ball.vy) > 0);
  assert.ok(
    Math.abs(game.ball.vy) > Math.abs(game.ball.vx) * 2,
    'two-player serve should not start with a lateral wall bounce',
  );
});

test('PONG has explicit last-standing and abort resolution', () => {
  const game = configurePong();
  game.paddles[0].isEliminated = true;
  game.resolveRound(1, 'last-standing');
  assert.equal(game.state, 'ROUND_OVER');
  assert.equal(game.roundWinner, game.paddles[1]);
  assert.equal(game.setScores[1], 1);

  game.state = 'PLAYING';
  game.paddles.forEach((paddle) => { paddle.isJoined = false; paddle.isEliminated = false; });
  game.abortMatch();
  assert.equal(game.state, 'LOBBY');
  assert.equal(game.roundResolutionReason, 'abort');
  assert.deepEqual(game.setScores, [0, 0, 0, 0]);
});

test('ARCHER aim stick charges and release fires without a charge action', () => {
  const game = configureArcher();
  game.startNewMatch();
  const player = game.players[0];
  game.handleRemoteInput(0, { action: 'AIM_PRESS', dx: 1, dy: 0, angle: 0, force: 1 });
  assert.equal(player.charging, true);
  player.charge = 0.5;
  game.handleRemoteInput(0, { action: 'AIM_RELEASE', dx: 1, dy: 0, angle: 0, force: 1 });
  assert.equal(player.charging, false);
  assert.equal(game.arrows.length, 1);

  player.shotCooldown = 0;
  game.handleRemoteInput(0, { action: 'AIM_PRESS', dx: 1, dy: 0, angle: 0, force: 1 });
  player.charge = 0.5;
  game.handleRemoteInput(0, { action: 'AIM_RELEASE', dx: 1, dy: 0, angle: 0, force: 0, cancelled: true });
  assert.equal(player.charging, false);
  assert.equal(game.arrows.length, 1);
});

test('ARCHER blocked shot gives one cooldown feedback episode and a ready pulse', () => {
  const game = configureArcher();
  game.startNewMatch();
  const player = game.players[0];
  player.shotCooldown = 0.8;
  game.handleRemoteInput(0, { action: 'AIM_PRESS', dx: 1, dy: 0, angle: 0, force: 1 });
  assert.equal(player.fireFeedback.kind, 'blocked');
  const serial = player.fireFeedback.serial;
  game.handleRemoteInput(0, { action: 'AIM_PRESS', dx: 1, dy: 0, angle: 0, force: 1 });
  assert.equal(player.fireFeedback.serial, serial);

  player.shotCooldown = 0;
  game.update(1016);
  assert.equal(player.fireFeedback.kind, 'ready');
});

test('ARCHER neutral quick tap does not fire or fake a shot', () => {
  const game = configureArcher();
  game.startNewMatch();
  const player = game.players[0];
  game.handleRemoteInput(0, { action: 'AIM_PRESS', dx: 0, dy: 0, angle: 0, force: 0 });
  player.charge = 0.5;
  game.handleRemoteInput(0, { action: 'AIM_RELEASE', dx: 0, dy: 0, angle: 0, force: 0 });
  assert.equal(game.arrows.length, 0);
});

test('ARCHER quick tap auto-aims at the nearest rival with a guaranteed charge', () => {
  const game = configureArcher();
  game.startNewMatch();
  const shooter = game.players[0];
  const rival = game.players[1];
  shooter.x = 200;
  shooter.y = 300;
  shooter.angle = Math.PI;
  shooter.shotCooldown = 0;
  rival.spawnProt = 0;
  rival.shield = 0;
  rival.x = 200;
  rival.y = 100;
  game.handleRemoteInput(0, { action: 'AIM_PRESS', dx: 0, dy: 0, angle: Math.PI, force: 0, seq: 1 });
  game.handleRemoteInput(0, { action: 'AIM_RELEASE', dx: 0, dy: 0, angle: Math.PI, force: 0, seq: 2, tap: true });
  assert.equal(game.arrows.length, 1);
  assert.ok(Math.abs(Math.atan2(game.arrows[0].vy, game.arrows[0].vx) + Math.PI / 2) < 0.25);
  assert.ok(Math.hypot(game.arrows[0].vx, game.arrows[0].vy) > 0);
});

test('LASER quick tap fires once toward the nearest rival without dragging', () => {
  const game = configureLaser();
  game.startNewMatch();
  const shooter = game.players[0];
  const rival = game.players[1];
  shooter.x = 200;
  shooter.y = 300;
  shooter.angle = Math.PI;
  shooter.targetAngle = Math.PI;
  shooter.shotCooldown = 0;
  rival.x = 200;
  rival.y = 100;
  game.handleRemoteInput(0, { action: 'AIM_PRESS', dx: 0, dy: 0, angle: Math.PI, force: 0, seq: 1 });
  game.handleRemoteInput(0, { action: 'AIM_RELEASE', dx: 0, dy: 0, angle: Math.PI, force: 0, seq: 2, tap: true });
  assert.equal(game.lasers.length, 1);
  assert.ok(Math.abs(Math.atan2(game.lasers[0].vy, game.lasers[0].vx) + Math.PI / 2) < 1e-6);
});

test('ARCHER round ids advance and repeated ties end as a draw', () => {
  const game = configureArcher();
  game.startNewMatch();
  assert.equal(game.roundId, 1);
  assert.equal(game.createWorldPacket().roundId, 1);

  game.scores = [2, 2, 0, 0];
  game.roundHits = [0, 0, 0, 0];
  game.handleRoundEnd();
  assert.equal(game.state, 'ROUND_OVER');
  assert.equal(game.tieRounds, 1);

  game.startRound();
  game.scores = [3, 3, 0, 0];
  game.roundHits = [0, 0, 0, 0];
  game.handleRoundEnd();
  // Maç sonu artık ANINDA değil: ortak akış bir boşluk bırakır, boşluk
  // dolunca `tickRoundFlow` MATCH_OVER'a geçer. "Bam diye" kart açılmayı bu
  // yüzden her motor aynı ölçüde geciktirir.
  assert.equal(game.state, 'ROUND_OVER');
  assert.equal(game.matchDraw, true);
  assert.equal(game.matchWinner, null);
  assert.ok(game.roundTransitionTimer > 0, 'maç sonu boşluğu birikiyor');

  game.roundTransitionTimer = 0;
  game.update(16);
  assert.equal(game.state, 'MATCH_OVER');
  assert.equal(game.matchDraw, true);
  assert.equal(game.matchWinner, null);
});

test('ARCHER registers a fast arrow crossing a player', () => {
  const game = configureArcher();
  game.startNewMatch();
  game.state = 'PLAYING';
  game.obstacles = [];
  game.players[0].isJoined = true;
  game.players[0].isAlive = true;
  game.players[0].x = 100;
  game.players[0].y = 300;
  game.players[1].isJoined = true;
  game.players[1].isAlive = true;
  game.players[1].spawnProt = 0;
  game.players[1].x = 300;
  game.players[1].y = 300;
  game.players[1].shield = 0;
  game.arrows = [{
    x: 250,
    y: 300,
    vx: 720,
    vy: 0,
    owner: 0,
    color: '#D84727',
    dist: 0,
    life: 1.1,
    power: 1,
  }];
  game.lastTime = 0;
  game.update(80);
  assert.ok(game.scores[0] > 0);
  assert.equal(game.arrows.length, 0);
});

test('TANKS gates spawn actions, advances round ids, and resolves timeout', () => {
  const game = configureTanks();
  game.startNewMatch();
  assert.equal(game.roundId, 1);
  assert.equal(game.createWorldPacket().roundId, 1);
  assert.equal(game.spawnIntroTimer, 2);
  const before = game.bullets.length;
  game.attemptFire(game.tanks[0]);
  assert.equal(game.bullets.length, before);

  game.spawnIntroTimer = 0;
  game.attemptFire(game.tanks[0]);
  assert.ok(game.bullets.length > before);

  game.roundTimer = 90;
  game.suddenDeath = false;
  game.spawnIntroTimer = 0;
  game.lastTime = 0;
  game.update(16);
  // Zaman aşımı artık maç sonudur (TANKS'ta beraberlik puan getirmez), ama
  // doğrudan değil: ortak akış bir maç sonu boşluğu bırakır.
  assert.equal(game.state, 'ROUND_OVER');
  assert.equal(game.matchDraw, true);
  game.roundTransitionTimer = 0;
  game.update(32);
  assert.equal(game.state, 'MATCH_OVER');
});
