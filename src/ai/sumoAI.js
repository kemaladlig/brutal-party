// SUMO bot zekâsı. Yalnız salt-okunur oyun görünümü + motorun kendi fiil
// kapılarını kullanır (game.attemptCharge / player.moveX/angle/braceHeld).
//
// İki arketip birden tek politikada: KENAR GÜVENLİĞİ her şeyin önünde gelir
// (halkadan düşen bot aptal görünür), sonra baskı, sonra kavrama/fırlatma.

import { createReadOnlyView } from '../core/botView.js';
import { normalizeAngle, approachAngle } from '../core/physics2d.js';

const TIER = {
  bot_normal: {
    edgePanic: 0.74,   // yarıçapın bu oranını geçerse merkeze kaçır
    engage: 300,
    align: 0.42,
    turn: 5.2,
    think: 0.34,
    strafeChance: 0.55,
    braceWill: 0.35,   // gelen çarpmayı karşılama olasılığı
    throwAlign: 0.5,
    lead: 0,
  },
  bot_god: {
    edgePanic: 0.62,
    engage: 380,
    align: 0.22,
    turn: 7.4,
    think: 0.18,
    strafeChance: 0.85,
    braceWill: 0.8,
    throwAlign: 0.22,
    lead: 0.45,
  },
};

function nearestEnemy(game, bot) {
  let best = null;
  let bestDist = Infinity;
  for (const p of game.players) {
    if (!p.isJoined || !p.isAlive || p.index === bot.index) continue;
    if ((p.fallTimer || 0) > 0 || (p.respawnTimer || 0) > 0) continue;
    if (p.team === bot.team) continue;
    const d = Math.hypot(p.x - bot.x, p.y - bot.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return { enemy: best, dist: bestDist };
}

/** Kenar güvenliği: dışa kaçan hızı söndüren merkeze dönüş vektörü. */
function edgeSafety(game, bot) {
  const ring = game.ring;
  if (!ring || !(ring.r > 0)) return null;
  const dx = bot.x - ring.cx;
  const dy = bot.y - ring.cy;
  const dist = Math.hypot(dx, dy);
  if (dist < ring.r * 0.55) return null;
  return { x: -dx / (dist || 1), y: -dy / (dist || 1), urgency: Math.min(1, (dist / ring.r - 0.5) / 0.5) };
}

export function updateSumoBotAI(rawGame, bot, dt) {
  const game = createReadOnlyView(rawGame);
  const tier = TIER[bot.slotType] || TIER.bot_normal;

  bot.aiTimer = (bot.aiTimer || 0) - dt;
  if (bot.aiTimer <= 0) {
    bot.aiTimer = tier.think * (0.6 + Math.random() * 0.8);
    bot.strafe = Math.random() < tier.strafeChance ? (Math.random() < 0.5 ? -1 : 1) : 0;
    bot.willBrace = Math.random() < tier.braceWill;
  }

  // Elindekini fırlat: en yakın boşluğa (halkanın dışına) nişan al.
  if (bot.grabbing >= 0) {
    const ring = game.ring;
    const away = Math.atan2(bot.y - ring.cy, bot.x - ring.cx);
    bot.angle = approachAngle(bot.angle, away, tier.turn * dt);
    bot.moveX = Math.cos(away);
    bot.moveY = Math.sin(away);
    bot.braceHeld = false;
    if (Math.abs(normalizeAngle(away - bot.angle)) < tier.throwAlign) game.attemptCharge(bot);
    return;
  }

  const safety = edgeSafety(game, bot);
  const { enemy, dist } = nearestEnemy(game, bot);

  // Üzerimize gelen bir çarpış var mı? (yakın + bize doğru + hamle halinde)
  let incoming = false;
  if (enemy && dist < game.scale.chargeSpeed * 0.5) {
    const towardX = (bot.x - enemy.x) / (dist || 1);
    const towardY = (bot.y - enemy.y) / (dist || 1);
    incoming = (enemy.vx * towardX + enemy.vy * towardY) > game.scale.moveSpeed * 0.6;
  }

  if (safety && (safety.urgency > 0.45 || !enemy)) {
    // Önce halkada kalmak: merkeze dön, gerekirse köklen.
    bot.moveX = safety.x;
    bot.moveY = safety.y;
    bot.angle = Math.atan2(safety.y, safety.x);
    bot.braceHeld = bot.willBrace && incoming && safety.urgency > 0.6;
    return;
  }

  if (!enemy) {
    bot.moveX = 0;
    bot.moveY = 0;
    bot.braceHeld = false;
    return;
  }

  // Köklenme kararı: gelen çarpmayı karşıla (çarp → tut kazanır).
  if (incoming && bot.willBrace && (!safety || safety.urgency < 0.5)) {
    bot.braceHeld = true;
    bot.moveX = 0;
    bot.moveY = 0;
    return;
  }
  bot.braceHeld = false;

  const dx = enemy.x - bot.x;
  const dy = enemy.y - bot.y;
  // Öngörü: kaçan rakibin gideceği yere nişan al (yalnız god için pay).
  const aimX = dx + enemy.vx * tier.lead * 0.2;
  const aimY = dy + enemy.vy * tier.lead * 0.2;
  const aimAngle = Math.atan2(aimY, aimX);

  // Mesafe yönetimi: yaklaş, çok yakınsa yan dön (kapkala menzilini koru).
  let mx = 0;
  let my = 0;
  if (dist > game.scale.moveSpeed * 0.9) {
    mx = aimX / (Math.hypot(aimX, aimY) || 1);
    my = aimY / (Math.hypot(aimX, aimY) || 1);
  } else {
    mx = -aimY / (dist || 1);
    my = aimX / (dist || 1);
  }
  if (bot.strafe) {
    mx += (-my) * bot.strafe * 0.6;
    my += (mx) * bot.strafe * 0.6;
  }
  const mag = Math.hypot(mx, my) || 1;
  bot.moveX = mx / mag;
  bot.moveY = my / mag;

  bot.angle = approachAngle(bot.angle, aimAngle, tier.turn * dt);
  const angDiff = Math.abs(normalizeAngle(aimAngle - bot.angle));

  // ÇARP: hiza + menzil + soğuma.
  if (angDiff < tier.align && dist < tier.engage && bot.chargeCooldown <= 0 && !bot.braced) {
    bot.angle = aimAngle;
    game.attemptCharge(bot);
  }
}
