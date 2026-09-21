// Brutal Pong: Bot AI (Normal & God Mode) — matador vuruşu, gölgeleme, iniş tahmini.
// Karar motoru buradadır; Paddle varlığı (çizim/fizik) src/games/paddle.js'tedir.

export function updatePongBotAI(game, paddle, dt) {
  const ball = game.ball;
  if (!ball || ball.isDead) return;

  const arena = game.arena;
  const isHorizontal = paddle.axis === 'horizontal';

  // Check if ball is heading towards this paddle + distance to paddle line
  let isHeadingTowards = false;
  let distToBall = Infinity;

  if (paddle.side === 'bottom') {
    isHeadingTowards = ball.vy > 0;
    distToBall = Math.abs(paddle.fixedPerpendicular - ball.y);
  } else if (paddle.side === 'top') {
    isHeadingTowards = ball.vy < 0;
    distToBall = Math.abs(paddle.fixedPerpendicular - ball.y);
  } else if (paddle.side === 'left') {
    isHeadingTowards = ball.vx < 0;
    distToBall = Math.abs(paddle.fixedPerpendicular - ball.x);
  } else if (paddle.side === 'right') {
    isHeadingTowards = ball.vx > 0;
    distToBall = Math.abs(paddle.fixedPerpendicular - ball.x);
  }

  let desiredCoord = (paddle.minCoord + paddle.maxCoord) / 2;

  if (!Number.isFinite(desiredCoord)) {
    desiredCoord = (paddle.minCoord + paddle.maxCoord) / 2;
  }

  if (paddle.isGodBot) {
    // ⚡ GOD MODE BOT: matador vuruşu + gölgeleme + derin tahmin
    // 🌀 Gerideyken nadir falso kurma: top başkasına giderken açar
    if (!isHeadingTowards && paddle.lives === 1 && paddle.spinCharge <= 0) {
      if (Math.random() < dt * 0.3) game.triggerSpin(paddle.index);
    }
    if (isHeadingTowards) {
      const predicted = predictPongLanding(paddle, ball, arena);

      // ⚡ MATADOR EDGE SMASH: son 0.35 sn'de raketin %42 dış noktasıyla
      // karşılar, topa gidiş yönünün tersine felaket açı kazandırır.
      const ballSpd = Math.hypot(ball.vx, ball.vy) || 1;
      const timeToImpact = distToBall / ballSpd;

      if (distToBall < 250 && timeToImpact < 0.35) {
        const crossVelocity = isHorizontal ? ball.vx : ball.vy;
        const edgeDirection = crossVelocity > 0 ? -1 : 1;
        const edgeOffset = (paddle.length * 0.42) * edgeDirection;
        desiredCoord = predicted + edgeOffset;
      } else {
        // Fake-out: merkezde karşılayacakmış gibi dur
        desiredCoord = predicted;
      }
    } else {
      // 🛡️ TACTICAL SHADOWING: merkeze dönmek yerine topu gölgele
      desiredCoord = isHorizontal ? ball.x : ball.y;
    }

    if (!Number.isFinite(desiredCoord)) {
      desiredCoord = (paddle.minCoord + paddle.maxCoord) / 2;
    }

    // God hızı: arena + ralli ölçekli, tavan kapaklı (ışınlanma yok)
    const arenaRef = Math.min(game.arena.width || 400, game.arena.height || 400);
    const godSpeed = Math.min(
      arenaRef * 4.0,
      arenaRef * 2.8 + (game.ball ? game.ball.rallyCount : 0) * arenaRef * 0.05
    );
    const maxMove = godSpeed * dt;
    const curCoord = Number.isFinite(paddle.coord) ? paddle.coord : (paddle.minCoord + paddle.maxCoord) / 2;
    const diff = desiredCoord - curCoord;
    paddle.coord = curCoord + Math.sign(diff) * Math.min(Math.abs(diff), maxMove);
    paddle.targetCoord = Math.max(paddle.minCoord, Math.min(paddle.maxCoord, paddle.coord));

  } else {
    // 🤖 NORMAL BOT: Human-like latency, soft tracking, occasional misses
    paddle.botErrorTimer -= dt;
    if (paddle.botErrorTimer <= 0) {
      paddle.botErrorOffset = (Math.random() - 0.5) * 32;
      paddle.botErrorTimer = 0.4 + Math.random() * 0.3;
    }

    if (isHeadingTowards) {
      // Track current ball position with slight error
      const ballPos = isHorizontal ? ball.x : ball.y;
      desiredCoord = ballPos + paddle.botErrorOffset;
    } else {
      desiredCoord = (paddle.minCoord + paddle.maxCoord) / 2;
    }

    if (!Number.isFinite(desiredCoord)) {
      desiredCoord = (paddle.minCoord + paddle.maxCoord) / 2;
    }

    // Normal Bot moves at human-relative speed
    const arenaRef = Math.min(game.arena.width || 400, game.arena.height || 400);
    const maxMove = arenaRef * 0.85 * dt;
    const curCoord = Number.isFinite(paddle.coord) ? paddle.coord : (paddle.minCoord + paddle.maxCoord) / 2;
    const diff = desiredCoord - curCoord;
    paddle.coord = curCoord + Math.sign(diff) * Math.min(Math.abs(diff), maxMove);
    paddle.targetCoord = Math.max(paddle.minCoord, Math.min(paddle.maxCoord, paddle.coord));
  }
}

export function predictPongLanding(paddle, ball, arena) {
  const fallback = (paddle.minCoord + paddle.maxCoord) / 2;
  if (!ball || !Number.isFinite(ball.x) || !Number.isFinite(ball.y) ||
      !Number.isFinite(ball.vx) || !Number.isFinite(ball.vy)) {
    return fallback;
  }

  // 🔮 GOD-TIER GEOMETRIC PREDICTION: ~6.6 sn'lik sekme simülasyonu
  let simX = ball.x;
  let simY = ball.y;
  let simVx = ball.vx;
  let simVy = ball.vy;

  const isHorizontal = paddle.axis === 'horizontal';
  const targetPerp = paddle.fixedPerpendicular;
  const dtSim = 1 / 120;
  const maxSteps = 800;

  for (let step = 0; step < maxSteps; step++) {
    simX += simVx * dtSim;
    simY += simVy * dtSim;

    // Bounce off lateral walls
    if (isHorizontal) {
      if (simX <= arena.left + ball.radius) {
        simVx = Math.abs(simVx);
        simX = arena.left + ball.radius;
      } else if (simX >= arena.right - ball.radius) {
        simVx = -Math.abs(simVx);
        simX = arena.right - ball.radius;
      }

      // Check arrival at horizontal paddle line
      if (paddle.side === 'bottom' && simY >= targetPerp) return Number.isFinite(simX) ? simX : fallback;
      if (paddle.side === 'top' && simY <= targetPerp) return Number.isFinite(simX) ? simX : fallback;
    } else {
      if (simY <= arena.top + ball.radius) {
        simVy = Math.abs(simVy);
        simY = arena.top + ball.radius;
      } else if (simY >= arena.bottom - ball.radius) {
        simVy = -Math.abs(simVy);
        simY = arena.bottom - ball.radius;
      }

      if (paddle.side === 'left' && simX <= targetPerp) return Number.isFinite(simY) ? simY : fallback;
      if (paddle.side === 'right' && simX >= targetPerp) return Number.isFinite(simY) ? simY : fallback;
    }
  }

  const res = isHorizontal ? simX : simY;
  return Number.isFinite(res) ? res : fallback;
}
