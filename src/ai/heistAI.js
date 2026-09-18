// Brutal Heist: Bot Robber AI (Vault Banking, Target Loot Seeking & Tactical Tackle)

export function updateHeistBotAI(game, bot, dt) {
  const isGod = bot.slotType === 'bot_god';
  const myVault = game.vaults[bot.index];
  const { left, right, top, bottom, cx, cy } = game.arena;

  let targetX = cx;
  let targetY = cy;

  // Decision Logic: Should I bank my gold or collect more or tackle an enemy?
  const carriedVal = bot.carriedGold;
  const shouldBank = carriedVal >= (isGod ? 4 : 3) || game.roundTimer < 6.0;

  if (shouldBank && myVault) {
    targetX = myVault.x + myVault.w / 2;
    targetY = myVault.y + myVault.h / 2;
  } else {
    // Find loaded enemies to tackle
    let loadedEnemy = null;
    let maxEnemyLoot = 0;

    for (const other of game.players) {
      if (other.index !== bot.index && other.isJoined && other.carriedGold >= 2) {
        const d = Math.hypot(other.x - bot.x, other.y - bot.y);
        if (other.carriedGold > maxEnemyLoot && d < (isGod ? 240 : 160)) {
          maxEnemyLoot = other.carriedGold;
          loadedEnemy = other;
        }
      }
    }

    if (loadedEnemy && bot.carriedGold <= 2) {
      targetX = loadedEnemy.x;
      targetY = loadedEnemy.y;
      if (isGod) {
        targetX += loadedEnemy.vx * 0.35;
        targetY += loadedEnemy.vy * 0.35;
      }

      const dEnemy = Math.hypot(targetX - bot.x, targetY - bot.y);
      if (dEnemy < (isGod ? 120 : 90) && bot.tackleCooldown <= 0) {
        game.triggerTackle(bot.index);
      }
    } else {
      // Collect nearest loose loot
      let nearestLoot = null;
      let minDist = Infinity;

      for (const item of game.lootItems) {
        const d = Math.hypot(item.x - bot.x, item.y - bot.y);
        const scoreWeight = isGod ? d / item.value : d;
        if (scoreWeight < minDist) {
          minDist = scoreWeight;
          nearestLoot = item;
        }
      }

      if (nearestLoot) {
        targetX = nearestLoot.x;
        targetY = nearestLoot.y;
      } else if (myVault && bot.carriedGold > 0) {
        targetX = myVault.x + myVault.w / 2;
        targetY = myVault.y + myVault.h / 2;
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

  // Obstacle & Wall Avoidance
  const r = bot.radius;
  const wallMargin = 60;
  const dLeft = bot.x - (left + r);
  const dRight = right - r - bot.x;
  const dTop = bot.y - (top + r);
  const dBottom = bottom - r - bot.y;

  if (dLeft < wallMargin) moveX = Math.max(0, moveX) + (wallMargin - dLeft) / wallMargin;
  if (dRight < wallMargin) moveX = Math.min(0, moveX) - (wallMargin - dRight) / wallMargin;
  if (dTop < wallMargin) moveY = Math.max(0, moveY) + (wallMargin - dTop) / wallMargin;
  if (dBottom < wallMargin) moveY = Math.min(0, moveY) - (wallMargin - dBottom) / wallMargin;

  // Repel from pillars
  for (const pil of game.pillars) {
    const pilCx = pil.x + pil.w / 2;
    const pilCy = pil.y + pil.h / 2;
    const dPil = Math.hypot(bot.x - pilCx, bot.y - pilCy);
    const threshold = Math.max(pil.w, pil.h) * 0.75 + r + 12;
    if (dPil < threshold && dPil > 0.001) {
      const nx = (bot.x - pilCx) / dPil;
      const ny = (bot.y - pilCy) / dPil;
      const push = (threshold - dPil) / threshold;
      moveX += nx * push * 1.8;
      moveY += ny * push * 1.8;
    }
  }

  // Normalize
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
