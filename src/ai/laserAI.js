// Brutal Laser v2 bot zekâsı: mesafe bandı + strafe yörünge + öngörülü ateş
// + gelen lazerden dash-kaçış + can azken pickup arama.
// Yalnızca game.arena / game.obstacles / game.players / game.lasers /
// game.pickups / game.fireLaser / game.triggerDash kullanır.

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Botun şu anki namlu açısından ateşlenirse birini vurur mu? (sanal sekme simülasyonu)
function simHitsSomeone(game, bot) {
  let simX = bot.x + Math.cos(bot.angle) * 20;
  let simY = bot.y + Math.sin(bot.angle) * 20;
  let simVx = Math.cos(bot.angle);
  let simVy = Math.sin(bot.angle);
  let bounces = 4;
  for (let s = 0; s < 45; s++) {
    simX += simVx * 25;
    simY += simVy * 25;
    if (simX < game.arena.left || simX > game.arena.right) { simVx *= -1; bounces--; }
    if (simY < game.arena.top || simY > game.arena.bottom) { simVy *= -1; bounces--; }
    for (const obs of game.obstacles) {
      if (simX > obs.x && simX < obs.x + obs.w && simY > obs.y && simY < obs.y + obs.h) {
        // Sanal yansımada eksen kabaca seçilir (hızlı kontrol için yeterli)
        simVx *= -1;
        bounces--;
        break;
      }
    }
    if (bounces < 0) return false;
    for (const p of game.players) {
      if (!p.isJoined || !p.isAlive || p.index === bot.index) continue;
      if (p.dashTimer > 0 || p.invulnTimer > 0) continue;
      if (Math.hypot(simX - p.x, simY - p.y) < 24) return true;
    }
  }
  return false;
}

// Üstüme gelen lazer var mı? Varsa kaçış yönünü döndürür.
function incomingLaserDir(game, bot) {
  for (const lz of game.lasers) {
    if (lz.owner === bot.index) continue;
    const dx = bot.x - lz.x;
    const dy = bot.y - lz.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 170 || dist < 1) continue;
    const spd = Math.hypot(lz.vx, lz.vy) || 1;
    const dot = (dx / dist) * (lz.vx / spd) + (dy / dist) * (lz.vy / spd);
    // Lazer bana doğru geliyor (dot < 0) ve ıskalama payı dar
    if (dot < -0.86) return Math.atan2(dy, dx);
  }
  return null;
}

export function updateLaserBotAI(game, bot, dt) {
  bot.botCheckTimer -= dt;
  bot.botRetarget -= dt;

  // --- Hedef seçimi: en yakın canlı düşman (0.6sn'de bir tazele) ---
  let target = null;
  let bestDist = Infinity;
  for (const p of game.players) {
    if (!p.isJoined || !p.isAlive || p.index === bot.index) continue;
    const d = Math.hypot(p.x - bot.x, p.y - bot.y);
    if (d < bestDist) { bestDist = d; target = p; }
  }

  // --- Kaçış: üstüme gelen lazer + dash hazırsa yana kaç ---
  const escapeAngle = incomingLaserDir(game, bot);
  if (escapeAngle !== null && bot.dashCooldown <= 0 && bot.dashTimer <= 0) {
    // Kaçış yönüne dönüp dash bas (i-frame kurtarır)
    bot.targetAngle = escapeAngle;
    const diff = Math.abs(normalizeAngle(escapeAngle - bot.angle));
    if (diff < 0.6) {
      game.triggerDash(bot.index);
      bot.botCheckTimer = 0.5;
    }
    // Dash basılamadıysa bile o yöne koş
    bot.steerX = Math.cos(escapeAngle);
    bot.steerY = Math.sin(escapeAngle);
    return;
  }

  // --- Pickup arama: yakında pickup varsa veya can/kalkan/silah lazımsa yönel ---
  let destX = null; let destY = null;
  if (game.pickups.length > 0) {
    let bestPickup = null;
    let bestScore = -Infinity;
    for (const pk of game.pickups) {
      const d = Math.hypot(pk.x - bot.x, pk.y - bot.y);
      let score = 200 - d;
      if (pk.type === 'HEAL' && bot.hp < 3) score += 300;
      if (pk.type === 'SHIELD' && !bot.shield) score += 250;
      if (pk.type === 'TRIPLE' && bot.tripleTimer <= 0) score += 200;
      if (pk.type === 'FAST' && bot.fastTimer <= 0) score += 150;
      if (score > bestScore) {
        bestScore = score;
        bestPickup = pk;
      }
    }
    if (bestPickup && (bestScore > 100 || (bot.hp < 3 && bestPickup.type === 'HEAL') || (bestPickup.type === 'SHIELD' && !bot.shield))) {
      destX = bestPickup.x; destY = bestPickup.y;
    }
  }

  if (target) {
    const dx = target.x - bot.x;
    const dy = target.y - bot.y;
    const dist = Math.hypot(dx, dy) || 1;

    if (destX === null) {
      // Mesafe bandı: çok yakınsa geri çekil, çok uzaksa yaklaş, ortada strafe
      if (bot.botRetarget <= 0) {
        bot.botRetarget = 0.8 + Math.random() * 0.8;
        if (Math.random() < 0.3) bot.botStrafeDir *= -1;
      }
      let mx; let my;
      if (dist < 170) {
        mx = -dx / dist; my = -dy / dist;
      } else if (dist > 330) {
        mx = dx / dist; my = dy / dist;
      } else {
        // Strafe: hedefe dikey yörünge + hafif yaklaşma
        const px = -dy / dist * bot.botStrafeDir;
        const py = dx / dist * bot.botStrafeDir;
        mx = px * 0.9 + (dx / dist) * 0.25;
        my = py * 0.9 + (dy / dist) * 0.25;
      }
      const m = Math.hypot(mx, my) || 1;
      bot.steerX = mx / m;
      bot.steerY = my / m;
    } else {
      const px = destX - bot.x;
      const py = destY - bot.y;
      const pd = Math.hypot(px, py) || 1;
      bot.steerX = px / pd;
      bot.steerY = py / pd;
    }

    // Nişan: hedefin hareket yönüne hafif öngörü
    const lead = Math.min(0.35, dist / 900);
    const aimX = target.x + (target.steerX || 0) * 220 * lead - bot.x;
    const aimY = target.y + (target.steerY || 0) * 220 * lead - bot.y;
    bot.targetAngle = Math.atan2(aimY, aimX);

    // Ateş: namlu hedefe dönük + simülasyon tutuyorsa (tepki gecikmeli)
    if (bot.cooldown <= 0 && bot.botCheckTimer <= 0) {
      const diff = Math.abs(normalizeAngle(bot.targetAngle - bot.angle));
      if (diff < 0.25) {
        if (simHitsSomeone(game, bot)) {
          game.fireLaser(bot);
          bot.botCheckTimer = 0.5 + Math.random() * 0.5;
        } else {
          bot.botCheckTimer = 0.25;
        }
      }
    }
  } else if (destX !== null) {
    const px = destX - bot.x;
    const py = destY - bot.y;
    const pd = Math.hypot(px, py) || 1;
    bot.steerX = px / pd;
    bot.steerY = py / pd;
  } else {
    // Hedef yok: merkeze doğru süzül
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
  }
}
