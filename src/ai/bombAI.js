// Brutal Bomb: Smart Bot AI with Whiskers, Raycasting, Waypoint Steering & Anti-Stuck

export function segmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
  const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
  if (Math.abs(denom) < 0.0001) return false;
  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
  const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
  return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
}

export function lineIntersectsRect(x1, y1, x2, y2, rect, pad = 12) {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);

  const rx1 = rect.x - pad;
  const ry1 = rect.y - pad;
  const rx2 = rect.x + rect.w + pad;
  const ry2 = rect.y + rect.h + pad;

  if (maxX < rx1 || minX > rx2 || maxY < ry1 || minY > ry2) {
    return false;
  }

  return (
    segmentsIntersect(x1, y1, x2, y2, rx1, ry1, rx2, ry1) ||
    segmentsIntersect(x1, y1, x2, y2, rx2, ry1, rx2, ry2) ||
    segmentsIntersect(x1, y1, x2, y2, rx2, ry2, rx1, ry2) ||
    segmentsIntersect(x1, y1, x2, y2, rx1, ry2, rx1, ry1)
  );
}

export function checkLineOfSight(game, x1, y1, x2, y2, pad = 12) {
  for (const pil of game.pillars) {
    if (lineIntersectsRect(x1, y1, x2, y2, pil, pad)) {
      return false;
    }
  }
  return true;
}

export function updateBombBotAI(game, bot, dt) {
  const carrier = game.players[game.bombCarrierIndex];
  const isCarrier = bot.index === game.bombCarrierIndex;
  const isGod = bot.slotType === 'bot_god';
  const { left, right, top, bottom, cx, cy } = game.arena;

  let moveX = 0;
  let moveY = 0;

  // --- 1. CHASE OR FLEE CORE INTENT ---
  if (isCarrier) {
    let nearestOpponent = null;
    let minDist = Infinity;

    for (const other of game.players) {
      if (other.index !== bot.index && other.isJoined && other.isAlive) {
        const d = Math.hypot(other.x - bot.x, other.y - bot.y);
        if (d < minDist) {
          minDist = d;
          nearestOpponent = other;
        }
      }
    }

    if (nearestOpponent) {
      let targetX = nearestOpponent.x;
      let targetY = nearestOpponent.y;

      if (isGod) {
        targetX += nearestOpponent.vx * 0.4;
        targetY += nearestOpponent.vy * 0.4;
      }

      if (minDist < (isGod ? 135 : 100) && bot.dashCooldown <= 0) {
        const toTargetAngle = Math.atan2(targetY - bot.y, targetX - bot.x);
        const angleDiff = Math.abs(bot.facingAngle - toTargetAngle);
        if (angleDiff < 0.6) {
          game.triggerDash(bot.index);
        }
      }

      // Waypoint bypass
      let blockingPillar = null;
      for (const pil of game.pillars) {
        if (lineIntersectsRect(bot.x, bot.y, targetX, targetY, pil, bot.radius + 10)) {
          blockingPillar = pil;
          break;
        }
      }

      if (blockingPillar) {
        const clearance = bot.radius + 18;
        const corners = [
          { x: blockingPillar.x - clearance, y: blockingPillar.y - clearance },
          { x: blockingPillar.x + blockingPillar.w + clearance, y: blockingPillar.y - clearance },
          { x: blockingPillar.x + blockingPillar.w + clearance, y: blockingPillar.y + blockingPillar.h + clearance },
          { x: blockingPillar.x - clearance, y: blockingPillar.y + blockingPillar.h + clearance },
        ];

        let bestCorner = null;
        let bestTotalDist = Infinity;

        for (const c of corners) {
          if (checkLineOfSight(game, bot.x, bot.y, c.x, c.y, 4)) {
            const dTotal = Math.hypot(c.x - bot.x, c.y - bot.y) + Math.hypot(targetX - c.x, targetY - c.y);
            if (dTotal < bestTotalDist) {
              bestTotalDist = dTotal;
              bestCorner = c;
            }
          }
        }

        if (bestCorner) {
          targetX = bestCorner.x;
          targetY = bestCorner.y;
        }
      }

      const angle = Math.atan2(targetY - bot.y, targetX - bot.x);
      moveX = Math.cos(angle);
      moveY = Math.sin(angle);
    }
  } else {
    // FLEE MODE
    if (carrier && carrier.isAlive) {
      const dx = bot.x - carrier.x;
      const dy = bot.y - carrier.y;
      const distToCarrier = Math.hypot(dx, dy);

      if (distToCarrier < (isGod ? 95 : 75) && bot.dashCooldown <= 0) {
        game.triggerDash(bot.index);
      }

      if (distToCarrier > 0.001) {
        moveX = dx / distToCarrier;
        moveY = dy / distToCarrier;
      }

      let bestPillar = null;
      let bestDist = Infinity;

      for (const pil of game.pillars) {
        const pilCx = pil.x + pil.w / 2;
        const pilCy = pil.y + pil.h / 2;
        const d = Math.hypot(pilCx - bot.x, pilCy - bot.y);
        if (d < bestDist) {
          bestDist = d;
          bestPillar = pil;
        }
      }

      if (bestPillar && distToCarrier < 260) {
        const pilCx = bestPillar.x + bestPillar.w / 2;
        const pilCy = bestPillar.y + bestPillar.h / 2;
        const carrierToPilAngle = Math.atan2(pilCy - carrier.y, pilCx - carrier.x);
        const coverDist = Math.max(bestPillar.w, bestPillar.h) * 0.9 + bot.radius;
        const coverX = pilCx + Math.cos(carrierToPilAngle) * coverDist;
        const coverY = pilCy + Math.sin(carrierToPilAngle) * coverDist;

        const toCoverX = coverX - bot.x;
        const toCoverY = coverY - bot.y;
        const distCover = Math.hypot(toCoverX, toCoverY);

        if (distCover > 12) {
          const weight = isGod ? 1.6 : 1.1;
          moveX += (toCoverX / distCover) * weight;
          moveY += (toCoverY / distCover) * weight;
        }
      }

      if (game.pickups.length > 0 && distToCarrier > 90) {
        const pickup = game.pickups[0];
        const dPick = Math.hypot(pickup.x - bot.x, pickup.y - bot.y);
        if (dPick < (isGod ? 180 : 100)) {
          moveX += ((pickup.x - bot.x) / dPick) * 1.3;
          moveY += ((pickup.y - bot.y) / dPick) * 1.3;
        }
      }
    }
  }

  // --- 2. DYNAMIC WALL TANGENT DEFLECTION & CORNER ESCAPE ---
  const r = bot.radius;
  const wallMargin = 72;
  const dLeft = bot.x - (left + r);
  const dRight = right - r - bot.x;
  const dTop = bot.y - (top + r);
  const dBottom = bottom - r - bot.y;

  const nearLeft = dLeft < wallMargin;
  const nearRight = dRight < wallMargin;
  const nearTop = dTop < wallMargin;
  const nearBottom = dBottom < wallMargin;

  const cornerWalls = (nearLeft ? 1 : 0) + (nearRight ? 1 : 0) + (nearTop ? 1 : 0) + (nearBottom ? 1 : 0);
  if (cornerWalls >= 2) {
    const toCenterX = cx - bot.x;
    const toCenterY = cy - bot.y;
    const distCenter = Math.hypot(toCenterX, toCenterY);
    if (distCenter > 1) {
      moveX = (toCenterX / distCenter) * 1.6;
      moveY = (toCenterY / distCenter) * 1.6;
    }
  } else {
    if (nearLeft) {
      const push = (wallMargin - dLeft) / wallMargin;
      moveX = Math.max(0, moveX) + push * 1.5;
      if (Math.abs(moveY) < 0.25) moveY = (bot.y < cy ? -1 : 1) * 0.9;
    }
    if (nearRight) {
      const push = (wallMargin - dRight) / wallMargin;
      moveX = Math.min(0, moveX) - push * 1.5;
      if (Math.abs(moveY) < 0.25) moveY = (bot.y < cy ? -1 : 1) * 0.9;
    }
    if (nearTop) {
      const push = (wallMargin - dTop) / wallMargin;
      moveY = Math.max(0, moveY) + push * 1.5;
      if (Math.abs(moveX) < 0.25) moveX = (bot.x < cx ? -1 : 1) * 0.9;
    }
    if (nearBottom) {
      const push = (wallMargin - dBottom) / wallMargin;
      moveY = Math.min(0, moveY) - push * 1.5;
      if (Math.abs(moveX) < 0.25) moveX = (bot.x < cx ? -1 : 1) * 0.9;
    }
  }

  // --- 3. PILLAR WHISKER DEFLECTION ---
  for (const pil of game.pillars) {
    const pilCx = pil.x + pil.w / 2;
    const pilCy = pil.y + pil.h / 2;
    const dPil = Math.hypot(bot.x - pilCx, bot.y - pilCy);
    const pilThreshold = Math.max(pil.w, pil.h) * 0.75 + r + 15;

    if (dPil < pilThreshold && dPil > 0.001) {
      const nx = (bot.x - pilCx) / dPil;
      const ny = (bot.y - pilCy) / dPil;
      const push = (pilThreshold - dPil) / pilThreshold;
      moveX += nx * push * 1.8;
      moveY += ny * push * 1.8;
    }
  }

  // --- 4. INK PUDDLES AVOIDANCE ---
  for (const puddle of game.inkPuddles) {
    const dPuddle = Math.hypot(bot.x - puddle.x, bot.y - puddle.y);
    if (dPuddle < puddle.radius + 35 && dPuddle > 0.01) {
      const avoidW = isGod ? 2.4 : 1.2;
      moveX += ((bot.x - puddle.x) / dPuddle) * avoidW;
      moveY += ((bot.y - puddle.y) / dPuddle) * avoidW;
    }
  }

  // --- 5. ANTI-STUCK WATCHDOG ---
  const frameMove = Math.hypot(bot.x - bot.lastX, bot.y - bot.lastY);
  bot.lastX = bot.x;
  bot.lastY = bot.y;

  if (frameMove < 20 * dt) {
    bot.stuckAccumulator = (bot.stuckAccumulator || 0) + dt;
  } else {
    bot.stuckAccumulator = Math.max(0, (bot.stuckAccumulator || 0) - dt * 2.5);
  }

  if (bot.stuckAccumulator > 0.16) {
    bot.unstuckDuration = 0.38;
    const angleToCenter = Math.atan2(cy - bot.y, cx - bot.x);
    bot.unstuckAngle = angleToCenter + (Math.random() > 0.5 ? 0.7 : -0.7);
    bot.stuckAccumulator = 0;
  }

  if (bot.unstuckDuration > 0) {
    bot.unstuckDuration -= dt;
    moveX = Math.cos(bot.unstuckAngle) * 1.5;
    moveY = Math.sin(bot.unstuckAngle) * 1.5;
  }

  const mag = Math.hypot(moveX, moveY);
  if (mag > 0.001) {
    bot.aiMoveX = moveX / mag;
    bot.aiMoveY = moveY / mag;
    bot.aiForce = 1.0;
  } else {
    bot.aiMoveX = 0;
    bot.aiMoveY = 0;
    bot.aiForce = 0;
  }
}
