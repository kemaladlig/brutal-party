// Brutal Crown: Bot AI (Crown Hunter & King Evasion)
// Implements aggressive tackling, predictive interception, evasive parkour routing, wall & pillar navigation.

export function updateCrownBotAI(game, bot, dt) {
  const isGod = bot.slotType === 'bot_god';
  const { left, right, top, bottom, cx, cy } = game.arena;
  const crown = game.crown;

  let targetX = cx;
  let targetY = cy;
  let wantTackle = false;

  const hasCrown = bot.hasCrown;

  if (hasCrown) {
    // --- 1. BOT IS KING: EVASION & SURVIVAL ---
    let closestEnemy = null;
    let minEnemyDist = Infinity;
    let threatVectorX = 0;
    let threatVectorY = 0;

    for (const other of game.players) {
      if (other.index !== bot.index && other.isJoined && other.isAlive) {
        const dx = other.x - bot.x;
        const dy = other.y - bot.y;
        const d = Math.hypot(dx, dy);
        if (d < minEnemyDist) {
          minEnemyDist = d;
          closestEnemy = other;
        }
        if (d < 280 && d > 0.1) {
          const weight = (280 - d) / 280;
          threatVectorX -= (dx / d) * weight;
          threatVectorY -= (dy / d) * weight;
        }
      }
    }

    if (closestEnemy && minEnemyDist < (isGod ? 120 : 90)) {
      // Counter-tackle in emergency if enemy is charging directly
      const dot = (closestEnemy.vx * (bot.x - closestEnemy.x) + closestEnemy.vy * (bot.y - closestEnemy.y));
      if (dot > 0 && bot.tackleCooldown <= 0) {
        wantTackle = true;
      }
    }

    // Default evasive target: Move towards arena center if near walls, or follow threat escape
    const distToCenter = Math.hypot(cx - bot.x, cy - bot.y);
    const centerWeight = distToCenter > 160 ? 0.35 : 0.1;

    let escapeX = threatVectorX + (cx - bot.x) / (distToCenter + 1) * centerWeight;
    let escapeY = threatVectorY + (cy - bot.y) / (distToCenter + 1) * centerWeight;

    const escapeLen = Math.hypot(escapeX, escapeY);
    if (escapeLen > 0.01) {
      targetX = bot.x + (escapeX / escapeLen) * 130;
      targetY = bot.y + (escapeY / escapeLen) * 130;
    } else {
      targetX = cx;
      targetY = cy;
    }
  } else if (crown.carrierIndex === null) {
    // --- 2. CROWN IS LOOSE: RUSH TO GRAB ---
    targetX = crown.x;
    targetY = crown.y;

    if (isGod && Math.hypot(crown.vx, crown.vy) > 30) {
      targetX += crown.vx * 0.25;
      targetY += crown.vy * 0.25;
    }

    // If opponent is also close to crown, tackle them to clear path!
    for (const other of game.players) {
      if (other.index !== bot.index && other.isJoined && other.isAlive) {
        const dOtherCrown = Math.hypot(other.x - crown.x, other.y - crown.y);
        const dBotOther = Math.hypot(other.x - bot.x, other.y - bot.y);
        if (dOtherCrown < 95 && dBotOther < (isGod ? 135 : 95) && bot.tackleCooldown <= 0) {
          targetX = other.x;
          targetY = other.y;
          wantTackle = true;
          break;
        }
      }
    }
  } else {
    // --- 3. ANOTHER PLAYER HAS CROWN: HUNT & TACKLE ---
    const king = game.players[crown.carrierIndex];
    if (king && king.isAlive) {
      targetX = king.x;
      targetY = king.y;

      if (isGod) {
        targetX += king.vx * 0.32;
        targetY += king.vy * 0.32;
      }

      const dKing = Math.hypot(targetX - bot.x, targetY - bot.y);
      if (dKing < (isGod ? 140 : 100) && bot.tackleCooldown <= 0) {
        const dirX = (targetX - bot.x) / (dKing || 1);
        const dirY = (targetY - bot.y) / (dKing || 1);
        const alignment = dirX * bot.inputX + dirY * bot.inputY;
        if (alignment > 0.4 || dKing < 75) {
          wantTackle = true;
        }
      }
    }
  }

  // Steering intent
  let moveX = targetX - bot.x;
  let moveY = targetY - bot.y;
  const len = Math.hypot(moveX, moveY);
  if (len > 0.01) {
    moveX /= len;
    moveY /= len;
  }

  // Wall Avoidance
  const r = bot.radius;
  const wallMargin = 55;
  const dLeft = bot.x - (left + r);
  const dRight = right - r - bot.x;
  const dTop = bot.y - (top + r);
  const dBottom = bottom - r - bot.y;

  if (dLeft < wallMargin) moveX = Math.max(0, moveX) + (wallMargin - dLeft) / wallMargin;
  if (dRight < wallMargin) moveX = Math.min(0, moveX) - (wallMargin - dRight) / wallMargin;
  if (dTop < wallMargin) moveY = Math.max(0, moveY) + (wallMargin - dTop) / wallMargin;
  if (dBottom < wallMargin) moveY = Math.min(0, moveY) - (wallMargin - dBottom) / wallMargin;

  // Repel from Pillars & Barricades
  if (game.pillars) {
    for (const pil of game.pillars) {
      const pilCx = pil.x + pil.w / 2;
      const pilCy = pil.y + pil.h / 2;
      const dPil = Math.hypot(bot.x - pilCx, bot.y - pilCy);
      const threshold = Math.max(pil.w, pil.h) * 0.7 + r + 16;
      if (dPil < threshold && dPil > 0.001) {
        const nx = (bot.x - pilCx) / dPil;
        const ny = (bot.y - pilCy) / dPil;
        const push = (threshold - dPil) / threshold;
        moveX += nx * push * 2.2;
        moveY += ny * push * 2.2;
      }
    }
  }

  // Repel from Moving Hazards
  if (game.movingHazards) {
    for (const h of game.movingHazards) {
      const dH = Math.hypot(bot.x - h.x, bot.y - h.y);
      const safeRadius = h.radius + r + 16;
      if (dH < safeRadius && dH > 0.001) {
        const nx = (bot.x - h.x) / dH;
        const ny = (bot.y - h.y) / dH;
        const push = (safeRadius - dH) / safeRadius;
        moveX += nx * push * 2.0;
        moveY += ny * push * 2.0;
      }
    }
  }

  // Avoid Banana Peels 🍌
  if (game.bananaPeels) {
    for (const b of game.bananaPeels) {
      const dB = Math.hypot(bot.x - b.x, bot.y - b.y);
      const safeRadius = b.radius + r + 18;
      if (dB < safeRadius && dB > 0.001) {
        const nx = (bot.x - b.x) / dB;
        const ny = (bot.y - b.y) / dB;
        const push = (safeRadius - dB) / safeRadius;
        moveX += nx * push * 1.8;
        moveY += ny * push * 1.8;
      }
    }
  }

  // Avoid Bouncy Bumpers if not tackling
  if (game.bumpers && !wantTackle) {
    for (const b of game.bumpers) {
      const dB = Math.hypot(bot.x - b.x, bot.y - b.y);
      const safeRadius = b.radius + r + 12;
      if (dB < safeRadius && dB > 0.001) {
        const nx = (bot.x - b.x) / dB;
        const ny = (bot.y - b.y) / dB;
        const push = (safeRadius - dB) / safeRadius;
        moveX += nx * push * 1.4;
        moveY += ny * push * 1.4;
      }
    }
  }

  // Final normalize
  const finalLen = Math.hypot(moveX, moveY);
  if (finalLen > 0.01) {
    bot.inputX = moveX / finalLen;
    bot.inputY = moveY / finalLen;
  } else {
    bot.inputX = 0;
    bot.inputY = 0;
  }

  // Trigger tackle action
  if (wantTackle && bot.tackleCooldown <= 0) {
    game.triggerTackle(bot.index);
  }
}
