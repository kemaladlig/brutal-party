// Brutal Laser bot zekâsı: sanal-mermi sekme simülasyonu + hedef tarama.
// Yalnızca game.arena / game.obstacles / game.players / game.fireLaser kullanır.

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function updateLaserBotAI(game, bot, dt) {
  bot.botCheckTimer -= dt;

  if (bot.botCheckTimer <= 0) {
    bot.botCheckTimer = 0.4 + Math.random() * 0.6;
    // Rastgele bir hedefe doğru yavaşça tara
    bot.botTargetAngle = bot.targetAngle + (Math.random() - 0.5) * Math.PI * 1.5;
  }

  const diff = normalizeAngle(bot.botTargetAngle - bot.targetAngle);
  bot.targetAngle += diff * dt * 3.0;

  // Saniyede ~12 kez sanal mermi göndererek önünü kontrol et
  if (bot.cooldown <= 0 && Math.random() < 0.2) {
    let simX = bot.x;
    let simY = bot.y;
    let simVx = Math.cos(bot.angle);
    let simVy = Math.sin(bot.angle);
    let bounces = 4;
    let hitSomeone = false;

    for (let s = 0; s < 45; s++) {
      simX += simVx * 25;
      simY += simVy * 25;

      if (simX < game.arena.left || simX > game.arena.right) { simVx *= -1; bounces--; }
      if (simY < game.arena.top || simY > game.arena.bottom) { simVy *= -1; bounces--; }

      for (const obs of game.obstacles) {
        if (simX > obs.x && simX < obs.x + obs.w && simY > obs.y && simY < obs.y + obs.h) {
          bounces--;
          break;
        }
      }
      if (bounces < 0) break;

      for (const p of game.players) {
        if (!p.isJoined || !p.isAlive || p.index === bot.index) continue;
        if (Math.hypot(simX - p.x, simY - p.y) < 22) {
          hitSomeone = true;
          break;
        }
      }
      if (hitSomeone) break;
    }

    if (hitSomeone) {
      game.fireLaser(bot);
      bot.botCheckTimer = 0.8;
    }
  }
}
