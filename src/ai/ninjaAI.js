// Brutal Ninja bot zekâsı: MOVE/HIDE durum makinesi + yakın-menzil kılıç.
// Yalnızca game.arena / game.players / game.attemptStrike kullanır.

export function updateNinjaBotAI(game, bot, dt) {
  bot.botTimer -= dt;

  // Durum makinesi: MOVE (yürü) -> HIDE (dur ve görünmez ol)
  if (bot.botTimer <= 0) {
    if (bot.botState === 'MOVE') {
      bot.botState = 'HIDE';
      bot.botTimer = 1.5 + Math.random() * 2.0;
      bot.steerX = 0;
      bot.steerY = 0;
    } else {
      bot.botState = 'MOVE';
      bot.botTimer = 0.5 + Math.random() * 1.5;
      bot.botTargetX = game.arena.cx + (Math.random() - 0.5) * game.arena.size * 0.8;
      bot.botTargetY = game.arena.cy + (Math.random() - 0.5) * game.arena.size * 0.8;
    }
  }

  if (bot.botState === 'MOVE') {
    const dx = bot.botTargetX - bot.x;
    const dy = bot.botTargetY - bot.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 10) {
      bot.steerX = dx / dist;
      bot.steerY = dy / dist;
      bot.angle = Math.atan2(dy, dx);
    } else {
      bot.steerX = 0; bot.steerY = 0;
    }
  }

  // Tehlike veya fener ışığı durumunda sis bombası
  if (bot.smokeCooldown <= 0 && (bot.inLight || Math.random() < 0.05)) {
    for (const enemy of game.players) {
      if (!enemy.isJoined || !enemy.isAlive || enemy.index === bot.index) continue;
      if (Math.hypot(enemy.x - bot.x, enemy.y - bot.y) < 110) {
        game.attemptSmoke(bot);
        bot.botState = 'MOVE';
        bot.botTimer = 1.0;
        bot.botTargetX = game.arena.cx + (Math.random() - 0.5) * game.arena.size * 0.7;
        bot.botTargetY = game.arena.cy + (Math.random() - 0.5) * game.arena.size * 0.7;
        break;
      }
    }
  }

  // Işık altındaysa ve fener yakınsa feneri kes
  if (bot.strikeCooldown <= 0 && bot.inLight && game.lanterns) {
    for (const lantern of game.lanterns) {
      if (!lantern.active) continue;
      const lDist = Math.hypot(lantern.x - bot.x, lantern.y - bot.y);
      if (lDist < 60) {
        bot.angle = Math.atan2(lantern.y - bot.y, lantern.x - bot.x);
        bot.steerX = Math.cos(bot.angle);
        bot.steerY = Math.sin(bot.angle);
        game.attemptStrike(bot);
        break;
      }
    }
  }

  // Tehdit/av algılama: 100px içinde ve (görünür veya 55px dibinde) ise saldır
  if (bot.strikeCooldown <= 0) {
    for (const enemy of game.players) {
      if (!enemy.isJoined || !enemy.isAlive || enemy.index === bot.index) continue;

      const tDx = enemy.x - bot.x;
      const tDy = enemy.y - bot.y;
      const tDist = Math.hypot(tDx, tDy);

      if (tDist < 105 && (enemy.alpha > 0.25 || tDist < 55)) {
        bot.angle = Math.atan2(tDy, tDx);
        bot.steerX = Math.cos(bot.angle);
        bot.steerY = Math.sin(bot.angle);
        game.attemptStrike(bot);

        bot.botState = 'HIDE';
        bot.botTimer = 2.0;
        break;
      }
    }
  }
}
