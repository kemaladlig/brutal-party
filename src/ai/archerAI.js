// Brutal Archery bot zekâsı: mesafe tutma + yay germe zamanlaması + kaçınma.
// Yalnızca game.arena / game.players / game.beginCharge / game.looseArrow kullanır.

const ARCHER_IDEAL_DIST = 240;
const ARCHER_MAX_ENGAGE = 480;

export function updateArcherBotAI(game, bot, dt) {
  bot.botTimer -= dt;

  // Hedef: en yakın katılan rakip
  let target = null;
  let targetDist = Infinity;
  for (const enemy of game.players) {
    if (!enemy.isJoined || !enemy.isAlive || enemy.index === bot.index) continue;
    const d = Math.hypot(enemy.x - bot.x, enemy.y - bot.y);
    if (d < targetDist) {
      targetDist = d;
      target = enemy;
    }
  }

  if (!target) {
    bot.steerX = 0;
    bot.steerY = 0;
    if (bot.charging) game.looseArrow(bot);
    return;
  }

  // Sapma zamanlayıcı: periyodik strafe yönü değiştir
  if (bot.botTimer <= 0) {
    bot.botTimer = 0.6 + Math.random() * 1.2;
    bot.botStrafe = Math.random() < 0.5 ? -1 : 1;
  }

  const dx = target.x - bot.x;
  const dy = target.y - bot.y;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = dx / dist;
  const ny = dy / dist;

  // Mesafe yönetimi: ideale yaklaş, çok yakınsa geri çekil + strafe
  let mx = 0;
  let my = 0;
  if (dist > ARCHER_IDEAL_DIST + 60) {
    mx = nx;
    my = ny;
  } else if (dist < ARCHER_IDEAL_DIST - 60) {
    mx = -nx;
    my = -ny;
  }
  // Strafe (ok yağmurundan kaçınma + açı kovalamaca)
  mx += -ny * bot.botStrafe * 0.7;
  my += nx * bot.botStrafe * 0.7;

  const mag = Math.hypot(mx, my);
  if (mag > 0.15) {
    bot.steerX = mx / mag;
    bot.steerY = my / mag;
    if (!bot.charging) bot.angle = Math.atan2(bot.steerY, bot.steerX);
  } else {
    bot.steerX = 0;
    bot.steerY = 0;
  }

  const aimAt = Math.atan2(dy, dx);
  const angDiff = Math.abs(((aimAt - bot.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);

  if (!bot.charging) {
    // Kabaca nişanlı + menzilde + soğuma bitmişse yayı ger
    if (bot.shotCooldown <= 0 && targetDist < ARCHER_MAX_ENGAGE && angDiff < 0.35) {
      bot.angle = aimAt;
      game.beginCharge(bot);
    }
  } else {
    // Gererken hedefi takip et
    bot.angle = aimAt;
    // Tam gerişte sal, veya dip dibeyken erken sal
    if (bot.charge >= 0.9 || (targetDist < 130 && bot.charge > 0.3)) {
      game.looseArrow(bot);
    } else if (targetDist > ARCHER_MAX_ENGAGE * 1.3) {
      // Hedef kaçtıysa gergiyi iptal et
      bot.charging = false;
      bot.charge = 0;
    }
  }
}
