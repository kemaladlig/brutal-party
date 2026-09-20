// Brutal Curve: Bot AI (Raycasting, Avoidance & Strategic Steering)

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function raycastFreeDistance(game, startX, startY, angle, maxDist, ownerIndex, now) {
  const { left, right, top, bottom } = game.arena;
  const step = 6;
  let dist = 0;
  const curTime = now || performance.now();

  while (dist < maxDist) {
    dist += step;
    const rx = startX + Math.cos(angle) * dist;
    const ry = startY + Math.sin(angle) * dist;

    // Hit wall
    if (rx <= left + 5 || rx >= right - 5 || ry <= top + 5 || ry >= bottom - 5) {
      return dist;
    }

    // Hit trail (ızgara adayları — kural aynı)
    const hit = game.forEachSegmentNear(rx, ry, 8, (seg) => {
      if (seg.isGap) return false;

      // Ignore bot's own recent trail segments (created within the last 380ms)
      if (seg.owner === ownerIndex && curTime - seg.createdAt < 380) {
        return false;
      }

      const minX = Math.min(seg.x1, seg.x2) - 4;
      const maxX = Math.max(seg.x1, seg.x2) + 4;
      const minY = Math.min(seg.y1, seg.y2) - 4;
      const maxY = Math.max(seg.y1, seg.y2) + 4;
      if (rx < minX || rx > maxX || ry < minY || ry > maxY) return false;

      const dSq = game.distToSegmentSquared(rx, ry, seg.x1, seg.y1, seg.x2, seg.y2);
      return dSq < 24;
    });
    if (hit) return dist;
  }

  return maxDist;
}

// Kademe parametreleri: NORMAL yarışçı-adil (hata yapar), GOD neredeyse yenilmez.
const TIER = {
  bot_normal: {
    think: 0.09, maxDist: 120, rays: [0.35, 0.75], safety: 70,
    commitTurn: 0.30, commitStraight: 0.20, centerTol: 0.35,
    centerRange: 0.42, mistake: 0.08, gapThread: false, deadEndCheck: false,
    pickupRange: 0, pickupTol: 0.15,
  },
  bot_god: {
    think: 0.03, maxDist: 200, rays: [0.28, 0.60, 0.92], safety: 100,
    commitTurn: 0.22, commitStraight: 0.20, centerTol: 0.35,
    centerRange: 0.36, mistake: 0.0, gapThread: true, deadEndCheck: true,
    pickupRange: 220, pickupTol: 0.12,
  },
};

export function updateCurveBotAI(game, bot, dt) {
  const P = TIER[bot.slotType] || TIER.bot_normal;

  if (bot.botTurnCommitment > 0) {
    bot.botTurnCommitment -= dt;
  }

  bot.botCheckTimer -= dt;
  if (bot.botCheckTimer > 0 && bot.botTurnCommitment > 0) {
    return;
  }
  bot.botCheckTimer = P.think;

  const now = performance.now();
  const leftAngles = P.rays.map((r) => -r);
  const rightAngles = [...P.rays];

  // 1. Raycast straight ahead
  const frontDist = raycastFreeDistance(game, bot.x, bot.y, bot.angle, P.maxDist, bot.index, now);

  // 2. Sample left and right rays
  let leftScore = 0;
  for (const dTheta of leftAngles) {
    leftScore += raycastFreeDistance(game, bot.x, bot.y, bot.angle + dTheta, P.maxDist, bot.index, now);
  }

  let rightScore = 0;
  for (const dTheta of rightAngles) {
    rightScore += raycastFreeDistance(game, bot.x, bot.y, bot.angle + dTheta, P.maxDist, bot.index, now);
  }

  if (frontDist > P.safety) {
    // Forward path is open - GO STRAIGHT by default!
    if (bot.botTurnCommitment <= 0) {
      bot.steer = 0;

      // Tactical centering & pickup seeking when in open space
      const distToCenter = Math.hypot(game.arena.cx - bot.x, game.arena.cy - bot.y);
      const thresholdCenter = game.arena.size * P.centerRange;

      if (distToCenter > thresholdCenter) {
        const angleToCenter = Math.atan2(game.arena.cy - bot.y, game.arena.cx - bot.x);
        const diff = normalizeAngle(angleToCenter - bot.angle);
        if (Math.abs(diff) > P.centerTol) {
          bot.steer = Math.sign(diff);
          bot.botTurnCommitment = 0.16;
        }
      } else if (P.pickupRange > 0 && Array.isArray(game.pickups)) {
        // Deliberate pickup routing (god): en yakın makul hedefe yönel
        let best = null;
        let bestD = P.pickupRange;
        for (const item of game.pickups) {
          const dItem = Math.hypot(item.x - bot.x, item.y - bot.y);
          if (dItem < bestD) {
            bestD = dItem;
            best = item;
          }
        }
        if (best) {
          const angleToItem = Math.atan2(best.y - bot.y, best.x - bot.x);
          const diff = normalizeAngle(angleToItem - bot.angle);
          if (Math.abs(diff) > P.pickupTol) {
            bot.steer = Math.sign(diff);
            bot.botTurnCommitment = 0.12;
          }
        }
      }
    }
  } else {
    // Obstacle ahead: önce delik-dikiş (god) — iz boşluğundan geç
    let threaded = false;
    if (P.gapThread) {
      let bestAngle = 0;
      let bestDist = frontDist;
      for (let a = -0.9; a <= 0.901; a += 0.15) {
        const d = raycastFreeDistance(game, bot.x, bot.y, bot.angle + a, 140, bot.index, now);
        if (d > bestDist + 25) {
          bestDist = d;
          bestAngle = a;
        }
      }
      if (bestAngle !== 0) {
        bot.steer = Math.sign(bestAngle);
        bot.botTurnCommitment = 0.14;
        threaded = true;
      }
    }
    if (!threaded) {
      // Geniş tarafa sert dön (normal bazen yanlış tarafı seçer)
      const goLeft = leftScore > rightScore + 10;
      const goRight = rightScore > leftScore + 10;
      if ((goLeft || goRight) && Math.random() < P.mistake) {
        bot.steer = goLeft ? 1 : -1;
      } else if (goLeft) {
        bot.steer = -1;
      } else if (goRight) {
        bot.steer = 1;
      } else if (bot.steer === 0) {
        bot.steer = Math.random() > 0.5 ? 1 : -1;
      }
      bot.botTurnCommitment = P.commitTurn;
    }
    // Çıkmaz sokak kontrolü (god): seçilen yön kapalıysa tersine dön
    if (P.deadEndCheck && bot.steer !== 0) {
      const check = raycastFreeDistance(
        game, bot.x, bot.y, bot.angle + bot.steer * 1.2, P.maxDist, bot.index, now
      );
      if (check < 55) {
        bot.steer = -bot.steer;
        bot.botTurnCommitment = 0.22;
      }
    }
  }
}
