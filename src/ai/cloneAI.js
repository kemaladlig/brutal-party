// Brutal Clone bot zekâsı: rastgele devriye + yakın-menzil omuz (gerçek/kopya
// ayırt etmez — blöfü yiyebilir, tasarım gereği).

export function updateCloneBotAI(game, bot, dt) {
  bot.botCheckTimer -= dt;

  if (bot.botCheckTimer <= 0) {
    bot.botCheckTimer = 0.5 + Math.random();
    bot.botTargetX = game.arena.cx + (Math.random() - 0.5) * game.arena.size * 0.8;
    bot.botTargetY = game.arena.cy + (Math.random() - 0.5) * game.arena.size * 0.8;
  }

  const dx = bot.botTargetX - bot.x;
  const dy = bot.botTargetY - bot.y;
  const dist = Math.hypot(dx, dy);

  if (dist > 10) {
    bot.steerX = dx / dist;
    bot.steerY = dy / dist;
    bot.angle = Math.atan2(dy, dx);
  } else {
    bot.steerX = 0;
    bot.steerY = 0;
  }

  if (bot.dashCooldown <= 0 && bot.slowTimer <= 0) {
    for (const enemy of game.players) {
      if (!enemy.isJoined || !enemy.isAlive || enemy.index === bot.index) continue;

      const targets = [{ x: enemy.x, y: enemy.y }, ...enemy.clones.filter((c) => c.active)];

      for (const t of targets) {
        const tDx = t.x - bot.x;
        const tDy = t.y - bot.y;
        const tDist = Math.hypot(tDx, tDy);

        if (tDist < 80) {
          const angleToTarget = Math.atan2(tDy, tDx);
          const angleDiff = Math.abs(Math.atan2(Math.sin(angleToTarget - bot.angle), Math.cos(angleToTarget - bot.angle)));

          if (angleDiff < 0.5) {
            game.attemptTackle(bot);
            bot.botCheckTimer = 1.0;
            return;
          }
        }
      }
    }
  }
}
