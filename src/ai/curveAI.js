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

    // Hit trail
    for (let i = 0; i < game.segments.length; i++) {
      const seg = game.segments[i];
      if (seg.isGap) continue;

      // Ignore bot's own recent trail segments (created within the last 380ms)
      if (seg.owner === ownerIndex && curTime - seg.createdAt < 380) {
        continue;
      }

      const minX = Math.min(seg.x1, seg.x2) - 4;
      const maxX = Math.max(seg.x1, seg.x2) + 4;
      const minY = Math.min(seg.y1, seg.y2) - 4;
      const maxY = Math.max(seg.y1, seg.y2) + 4;
      if (rx < minX || rx > maxX || ry < minY || ry > maxY) continue;

      const dSq = game.distToSegmentSquared(rx, ry, seg.x1, seg.y1, seg.x2, seg.y2);
      if (dSq < 24) {
        return dist;
      }
    }
  }

  return maxDist;
}

export function updateCurveBotAI(game, bot, dt) {
  const isGod = bot.slotType === 'bot_god';

  if (bot.botTurnCommitment > 0) {
    bot.botTurnCommitment -= dt;
  }

  bot.botCheckTimer -= dt;
  if (bot.botCheckTimer > 0 && bot.botTurnCommitment > 0) {
    return;
  }
  bot.botCheckTimer = isGod ? 0.035 : 0.07;

  const maxDist = isGod ? 180 : 130;
  const now = performance.now();

  // 1. Raycast straight ahead
  const frontDist = raycastFreeDistance(game, bot.x, bot.y, bot.angle, maxDist, bot.index, now);

  // 2. Sample left and right rays
  const leftAngles = isGod ? [-0.28, -0.60, -0.92] : [-0.35, -0.75];
  const rightAngles = isGod ? [0.28, 0.60, 0.92] : [0.35, 0.75];

  let leftScore = 0;
  for (const dTheta of leftAngles) {
    leftScore += raycastFreeDistance(game, bot.x, bot.y, bot.angle + dTheta, maxDist, bot.index, now);
  }

  let rightScore = 0;
  for (const dTheta of rightAngles) {
    rightScore += raycastFreeDistance(game, bot.x, bot.y, bot.angle + dTheta, maxDist, bot.index, now);
  }

  // Safety threshold distance before needing an evasion turn
  const safetyLimit = isGod ? 95 : 75;

  if (frontDist > safetyLimit) {
    // Forward path is open - GO STRAIGHT by default!
    if (bot.botTurnCommitment <= 0) {
      bot.steer = 0;

      // Tactical centering & pickup seeking when in open space
      const distToCenter = Math.hypot(game.arena.cx - bot.x, game.arena.cy - bot.y);
      const thresholdCenter = game.arena.size * (isGod ? 0.36 : 0.42);

      if (distToCenter > thresholdCenter) {
        const angleToCenter = Math.atan2(game.arena.cy - bot.y, game.arena.cx - bot.x);
        const diff = normalizeAngle(angleToCenter - bot.angle);
        if (Math.abs(diff) > 0.35) {
          bot.steer = Math.sign(diff);
          bot.botTurnCommitment = 0.16;
        }
      } else if (isGod) {
        // God Bot seeks pickups
        for (const item of game.pickups) {
          const dItem = Math.hypot(item.x - bot.x, item.y - bot.y);
          if (dItem < 130) {
            const angleToItem = Math.atan2(item.y - bot.y, item.x - bot.x);
            const diff = normalizeAngle(angleToItem - bot.angle);
            if (Math.abs(diff) > 0.15) {
              bot.steer = Math.sign(diff);
              bot.botTurnCommitment = 0.12;
            }
            break;
          }
        }
      }
    }
  } else {
    // Obstacle ahead: hard turn towards the side with more open space
    if (leftScore > rightScore + 10) {
      bot.steer = -1;
      bot.botTurnCommitment = isGod ? 0.22 : 0.30;
    } else if (rightScore > leftScore + 10) {
      bot.steer = 1;
      bot.botTurnCommitment = isGod ? 0.22 : 0.30;
    } else {
      // Equal or close: keep current steer if turning, else pick randomly
      if (bot.steer === 0) {
        bot.steer = Math.random() > 0.5 ? 1 : -1;
      }
      bot.botTurnCommitment = 0.20;
    }
  }
}
