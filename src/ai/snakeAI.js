// Brutal Snake bot zekâsı: ızgara-sorgulu ışın kaçınma + yem kovalama.
// Curve'ün raycast'i buraya uymaz (game.segments düz dizisini okur;
// SNAKE'te izler oyuncu başınadır) — o yüzden ızgara tabanlı yerel sürüm.

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function raycastFreeDistance(game, startX, startY, angle, maxDist, ownerIndex, now) {
  const { left, right, top, bottom } = game.arena;
  const step = 6;
  let dist = 0;
  const curTime = now || performance.now();

  while (dist < maxDist) {
    dist += step;
    const rx = startX + Math.cos(angle) * dist;
    const ry = startY + Math.sin(angle) * dist;

    if (rx <= left + 5 || rx >= right - 5 || ry <= top + 5 || ry >= bottom - 5) {
      return dist;
    }

    const hit = game.forEachSegmentNear(rx, ry, 8, (seg) => {
      if (seg.isGap) return false;
      if (seg.owner === ownerIndex && curTime - seg.createdAt < 380) {
        return false;
      }
      const minX = Math.min(seg.x1, seg.x2) - 4;
      const maxX = Math.max(seg.x1, seg.x2) + 4;
      const minY = Math.min(seg.y1, seg.y2) - 4;
      const maxY = Math.max(seg.y1, seg.y2) + 4;
      if (rx < minX || rx > maxX || ry < minY || ry > maxY) return false;
      return game.distToSegmentSquared(rx, ry, seg.x1, seg.y1, seg.x2, seg.y2) < 24;
    });
    if (hit) return dist;
  }

  return maxDist;
}

export function updateSnakeBotAI(game, bot, dt) {
  bot.botCheckTimer -= dt;
  if (bot.botCheckTimer > 0) return;
  bot.botCheckTimer = 0.08;

  const now = performance.now();
  const maxDist = 140;

  const frontDist = raycastFreeDistance(game, bot.x, bot.y, bot.angle, maxDist, bot.index, now);
  const leftDist = raycastFreeDistance(game, bot.x, bot.y, bot.angle - 0.6, maxDist, bot.index, now);
  const rightDist = raycastFreeDistance(game, bot.x, bot.y, bot.angle + 0.6, maxDist, bot.index, now);

  let targetSteer = 0;
  let bestDist = Infinity;
  let targetFood = null;

  for (const food of game.foods) {
    const d = Math.hypot(food.x - bot.x, food.y - bot.y);
    if (d < bestDist) {
      bestDist = d;
      targetFood = food;
    }
  }

  if (targetFood && frontDist > 60) {
    const angleToFood = Math.atan2(targetFood.y - bot.y, targetFood.x - bot.x);
    const diff = normalizeAngle(angleToFood - bot.angle);
    if (Math.abs(diff) > 0.2) {
      targetSteer = Math.sign(diff);
    }
  }

  if (frontDist < 50) {
    targetSteer = leftDist > rightDist ? -1 : 1;
    bot.isBoost = false;
  } else if (targetFood && bestDist < 100 && frontDist > 80) {
    bot.isBoost = true;
  } else {
    bot.isBoost = false;
  }

  bot.steer = targetSteer;
}
