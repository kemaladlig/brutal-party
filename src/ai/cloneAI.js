// Brutal Clone RPG bot zekâsı:
// Görev istasyonlarına gidip görev yapar (rol yapar),
// etrafında şüpheli koşan veya görev alanına yaklaşan karakterlere pusu kurup omuz atar.

export function updateCloneBotAI(game, bot, dt) {
  bot.botCheckTimer -= dt;

  // Hedef görev noktası belirleme
  if (!bot.botTargetTask || bot.botCheckTimer <= 0) {
    bot.botCheckTimer = 3.0 + Math.random() * 2.0;
    const tasks = game.taskPoints;
    if (tasks && tasks.length) {
      bot.botTargetTask = tasks[Math.floor(Math.random() * tasks.length)];
    }
  }

  if (bot.botTargetTask) {
    const dx = bot.botTargetTask.x - bot.x;
    const dy = bot.botTargetTask.y - bot.y;
    const dist = Math.hypot(dx, dy);

    if (dist > 25) {
      bot.steerX = dx / dist;
      bot.steerY = dy / dist;
      bot.angle = Math.atan2(dy, dx);
    } else {
      // Görev alanında sakin durup rol yapma
      bot.steerX = 0;
      bot.steerY = 0;
    }
  }

  // Tehdit algılama & infaz: 75px menzilde şüpheli veya yakın hedef
  if (bot.dashCooldown <= 0 && bot.slowTimer <= 0) {
    // 1. Canlı gerçek rakipler
    for (const enemy of game.players) {
      if (!enemy.isJoined || !enemy.isAlive || enemy.index === bot.index) continue;

      const tDx = enemy.x - bot.x;
      const tDy = enemy.y - bot.y;
      const tDist = Math.hypot(tDx, tDy);

      // Yakın veya koşan düşman
      if (tDist < 75) {
        bot.angle = Math.atan2(tDy, tDx);
        bot.steerX = Math.cos(bot.angle);
        bot.steerY = Math.sin(bot.angle);
        game.attemptTackle(bot);
        bot.botCheckTimer = 1.5;
        return;
      }
    }

    // 2. Klonlara yanlışlıkla saldırma ihtimali (insansı hata)
    if (Math.random() < 0.03) {
      for (const clone of game.npcClones) {
        if (!clone.active || clone.ownerIndex === bot.index) continue;
        const cDist = Math.hypot(clone.x - bot.x, clone.y - bot.y);
        if (cDist < 60) {
          bot.angle = Math.atan2(clone.y - bot.y, clone.x - bot.x);
          bot.steerX = Math.cos(bot.angle);
          bot.steerY = Math.sin(bot.angle);
          game.attemptTackle(bot);
          bot.botCheckTimer = 2.0;
          return;
        }
      }
    }
  }
}
