// Brutal Archery bot zekâsı: mesafe tutma + yay germe zamanlaması + kaçınma.
// Yalnızca game.arena / game.players / game.beginCharge / game.looseArrow kullanır.

import { segmentAabbIntersection, normalizeAngle, approachAngle } from '../core/physics2d.js';
import { createReadOnlyView } from '../core/botView.js';

function hasShotLane(game, bot, target) {
  return !(game.obstacles || []).some((obstacle) => (
    segmentAabbIntersection(bot.x, bot.y, target.x, target.y, obstacle, 0) !== null
  ));
}

const ARCHER_IDEAL_DIST = 240;
const ARCHER_MAX_ENGAGE = 480;

// Yüz dönüş hızı (rad/sn). Bot insan gibi hedefe döner; anlık snap yerine
// sınırlı hız kullanılır, yoksa nişan almak bedava olur.
const ARCHER_TURN_RATE = 7.0;
// Yay geriliyken nişan takibi hızlanır (tel ucundaki ok hâlâ isabet eder).
const ARCHER_CHARGE_TURN_RATE = 11.0;
// Salma kapısı: namlu hedeften bu kadar sapıyorsa ok boşa gider, gergiyi tut.
const ARCHER_RELEASE_TOLERANCE = 0.2;

export function updateArcherBotAI(rawGame, bot, dt) {
  const game = createReadOnlyView(rawGame);
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
  } else {
    bot.steerX = 0;
    bot.steerY = 0;
  }

  // Yüz (angle) HAREKET YÖNÜ DEĞİL, HEDEF YÖNÜDÜR. Strafe vektörü buraya
  // yazılırsa namlu hedefe hiçbir mesafede kilitlenemez (atan(0.7)=0.61 rad
  // sapma, gergi kapısı 0.35 rad) ve bot hiç ok atmaz.
  const aimAt = Math.atan2(dy, dx);
  const turnRate = bot.charging ? ARCHER_CHARGE_TURN_RATE : ARCHER_TURN_RATE;
  bot.angle = approachAngle(bot.angle, aimAt, turnRate * dt);
  const angDiff = Math.abs(normalizeAngle(aimAt - bot.angle));

  const laneClear = hasShotLane(game, bot, target);
  if (!bot.charging) {
    // Kabaca nişanlı + menzilde + soğuma bitmişse yayı ger
    if (laneClear && bot.shotCooldown <= 0 && targetDist < ARCHER_MAX_ENGAGE && angDiff < 0.35) {
      bot.angle = aimAt;
      game.beginCharge(bot);
    }
  } else {
    // Tam gerişte sal, veya dip dibeyken erken sal
    if (laneClear && angDiff < ARCHER_RELEASE_TOLERANCE
        && (bot.charge >= 0.9 || (targetDist < 130 && bot.charge > 0.3))) {
      game.looseArrow(bot);
    } else if (!laneClear || targetDist > ARCHER_MAX_ENGAGE * 1.3) {
      // Hedef kaçtıysa veya engel araya girdiyse gergiyi iptal et
      bot.charging = false;
      bot.charge = 0;
    }
  }
}
