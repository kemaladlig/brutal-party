// Brutal Snake bot zekâsı: ızgara-sorgulu ışın kaçınma + duvar algılama + yem önceliği.

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

    // Dış Sınırlar
    if (rx <= left + 6 || rx >= right - 6 || ry <= top + 6 || ry >= bottom - 6) {
      return dist;
    }

    // Harita Duvarları
    if (game.walls) {
      for (const w of game.walls) {
        if (rx >= w.x - 4 && rx <= w.x + w.w + 4 && ry >= w.y - 4 && ry <= w.y + w.h + 4) {
          return dist;
        }
      }
    }

    // Kuyruk Segmentleri
    const hit = game.forEachSegmentNear(rx, ry, 8, (seg) => {
      if (seg.isGap) return false;
      if (seg.owner === ownerIndex && curTime - seg.createdAt < 340) {
        return false;
      }
      const minX = Math.min(seg.x1, seg.x2) - 4;
      const maxX = Math.max(seg.x1, seg.x2) + 4;
      const minY = Math.min(seg.y1, seg.y2) - 4;
      const maxY = Math.max(seg.y1, seg.y2) + 4;
      if (rx < minX || rx > maxX || ry < minY || ry > maxY) return false;
      return game.distToSegmentSquared(rx, ry, seg.x1, seg.y1, seg.x2, seg.y2) < 26;
    });
    if (hit) return dist;
  }

  return maxDist;
}

export function updateSnakeBotAI(game, bot, dt) {
  bot.botCheckTimer -= dt;
  if (bot.botCheckTimer > 0) return;
  bot.botCheckTimer = 0.06;

  const now = performance.now();
  const maxDist = 150;

  const frontDist = raycastFreeDistance(game, bot.x, bot.y, bot.angle, maxDist, bot.index, now);
  const leftDist = raycastFreeDistance(game, bot.x, bot.y, bot.angle - 0.55, maxDist, bot.index, now);
  const rightDist = raycastFreeDistance(game, bot.x, bot.y, bot.angle + 0.55, maxDist, bot.index, now);

  let targetSteer = 0;
  let bestScore = -Infinity;
  let targetFood = null;

  // Yem Önceliği: Golden Star > Turbo Berry > Apple
  for (const food of game.foods) {
    const d = Math.hypot(food.x - bot.x, food.y - bot.y);
    let value = 100 - d;
    if (food.type === 'GOLDEN_STAR') value += 80;
    else if (food.type === 'TURBO_BERRY') value += 40;

    if (value > bestScore) {
      bestScore = value;
      targetFood = food;
    }
  }

  if (targetFood && frontDist > 65) {
    const angleToFood = Math.atan2(targetFood.y - bot.y, targetFood.x - bot.x);
    const diff = normalizeAngle(angleToFood - bot.angle);
    if (Math.abs(diff) > 0.15) {
      targetSteer = Math.sign(diff);
    }
  }

  // Acil Kaçınma Manevrası
  if (frontDist < 55) {
    targetSteer = leftDist > rightDist ? -1 : 1;
    bot.isBoost = false;
  } else if (targetFood && bestScore > 40 && frontDist > 90 && !bot.boostLocked && bot.boostEnergy > 30) {
    bot.isBoost = true;
  } else {
    bot.isBoost = false;
  }

  bot.steer = targetSteer;
}
