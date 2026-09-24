// Brutal Horde bot AI: target nearest enemy, revive friends, move to portal

export function updateHordeBotAI(game, bot, dt) {
  bot.botCheckTimer -= dt;
  bot.botRetarget -= dt;

  // 1. Check if we need to move to a portal (Wave Complete)
  if (game.portal) {
    const px = game.portal.x - bot.x;
    const py = game.portal.y - bot.y;
    const pd = Math.hypot(px, py) || 1;
    if (pd > 10) {
      bot.steerX = px / pd;
      bot.steerY = py / pd;
    } else {
      bot.steerX = 0;
      bot.steerY = 0;
    }
    bot.isAiming = false;
    return;
  }

  // 2. Check if we need to revive a teammate (Tombstones)
  let bestTomb = null;
  let tombDist = Infinity;
  for (const tomb of game.tombs) {
    const d = Math.hypot(tomb.x - bot.x, tomb.y - bot.y);
    if (d < tombDist) {
      tombDist = d;
      bestTomb = tomb;
    }
  }

  if (bestTomb && tombDist < 300) {
    // Move to revive
    const px = bestTomb.x - bot.x;
    const py = bestTomb.y - bot.y;
    const pd = Math.hypot(px, py) || 1;
    if (pd > 20) {
      bot.steerX = px / pd;
      bot.steerY = py / pd;
    } else {
      bot.steerX = 0;
      bot.steerY = 0;
    }

    // Check if enemies are nearby while reviving to shoot back
    let closeEnemy = null;
    let ceDist = Infinity;
    for (const e of game.enemies) {
      const d = Math.hypot(e.x - bot.x, e.y - bot.y);
      if (d < ceDist) { ceDist = d; closeEnemy = e; }
    }

    if (closeEnemy && ceDist < 300) {
      const aimX = closeEnemy.x - bot.x;
      const aimY = closeEnemy.y - bot.y;
      bot.targetAngle = Math.atan2(aimY, aimX);

      let diff = bot.targetAngle - bot.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const absDiff = Math.abs(diff);

      bot.isAiming = absDiff < 0.35;
      if (absDiff < 0.25 && bot.attackCooldown <= 0 && bot.botCheckTimer <= 0) {
        // Attack
        game.projectiles.push({
          x: bot.x, y: bot.y,
          vx: Math.cos(bot.angle) * 400, vy: Math.sin(bot.angle) * 400,
          radius: 8, damage: 1, life: 1.5, isEnemy: false, color: bot.color
        });
        bot.attackCooldown = 0.3;
        bot.botCheckTimer = 0.4;
      }
    } else {
      bot.isAiming = false;
    }
    return; // Don't do other actions while reviving
  }

  // 3. Combat mode: Target nearest enemy
  let target = null;
  let bestDist = Infinity;
  for (const e of game.enemies) {
    const d = Math.hypot(e.x - bot.x, e.y - bot.y);
    if (d < bestDist) { bestDist = d; target = e; }
  }

  if (target) {
    const dx = target.x - bot.x;
    const dy = target.y - bot.y;
    const dist = Math.hypot(dx, dy) || 1;

    // Move: keep distance or approach
    if (bot.botRetarget <= 0) {
      bot.botRetarget = 0.8 + Math.random() * 0.8;
      if (Math.random() < 0.3) bot.botStrafeDir *= -1;
    }

    let mx, my;
    if (dist < 150) {
      mx = -dx / dist; my = -dy / dist; // Back off
    } else if (dist > 250) {
      mx = dx / dist; my = dy / dist; // Approach
    } else {
      // Strafe
      const px = -dy / dist * bot.botStrafeDir;
      const py = dx / dist * bot.botStrafeDir;
      mx = px * 0.9 + (dx / dist) * 0.25;
      my = py * 0.9 + (dy / dist) * 0.25;
    }

    const m = Math.hypot(mx, my) || 1;
    bot.steerX = mx / m;
    bot.steerY = my / m;

    // Aim and shoot
    bot.targetAngle = Math.atan2(dy, dx);

    let diff = bot.targetAngle - bot.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const absDiff = Math.abs(diff);

    bot.isAiming = absDiff < 0.35;

    if (absDiff < 0.25 && bot.attackCooldown <= 0 && bot.botCheckTimer <= 0) {
      game.projectiles.push({
        x: bot.x, y: bot.y,
        vx: Math.cos(bot.angle) * 400, vy: Math.sin(bot.angle) * 400,
        radius: 8, damage: 1, life: 1.5, isEnemy: false, color: bot.color
      });
      bot.attackCooldown = 0.3;
      bot.botCheckTimer = 0.4 + Math.random() * 0.4;
    }

    // Dodge mechanics
    if (bot.dashCooldown <= 0 && bot.dashTimer <= 0) {
      // Very simple dash if enemy is too close
      if (dist < 80) {
        bot.dashCooldown = 4.0;
        bot.dashTimer = 0.25;
      }
    }
  } else {
    // Wander to center if no targets
    const px = game.arena.cx - bot.x;
    const py = game.arena.cy - bot.y;
    const pd = Math.hypot(px, py) || 1;
    if (pd > 60) {
      bot.steerX = px / pd;
      bot.steerY = py / pd;
    } else {
      bot.steerX = 0;
      bot.steerY = 0;
    }
    bot.isAiming = false;
  }
}
