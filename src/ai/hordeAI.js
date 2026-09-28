// BRUTAL HORDE bot AI: portal önceliği, güvenli revive, hedef seçimi ve doğru ateş zamanlaması.

import { firstFreeDirection, normalizeAngle } from '../core/physics2d.js';
import { fieldPx } from '../core/playfield.js';
import { HORDE_AVOID, getPlayerWeapon } from '../games/hordeConfig.js';
import { createReadOnlyView } from '../core/botView.js';

function distanceSq(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function nearestEnemy(game, bot, maxDistance = Infinity) {
  let target = null;
  let best = maxDistance * maxDistance;
  for (const enemy of game.enemies || []) {
    const d2 = distanceSq(bot.x, bot.y, enemy.x, enemy.y);
    const priority = enemy.type === 'healer' || enemy.type === 'shooter' ? d2 * 0.72 : d2;
    if (priority < best) {
      best = priority;
      target = enemy;
    }
  }
  return target;
}

function steerToward(bot, x, y, stopDistance = 0) {
  const dx = x - bot.x;
  const dy = y - bot.y;
  const distance = Math.hypot(dx, dy) || 1;
  if (distance <= stopDistance) {
    bot.steerX = 0;
    bot.steerY = 0;
    return distance;
  }
  bot.steerX = dx / distance;
  bot.steerY = dy / distance;
  return distance;
}

function aimAt(bot, target) {
  bot.targetAngle = Math.atan2(target.y - bot.y, target.x - bot.x);
  const difference = Math.abs(normalizeAngle(bot.targetAngle - bot.angle));
  bot.isAiming = difference < (bot.slotType === 'bot_god' ? 0.42 : 0.3);
}

/**
 * Bot'lar da motorun tarama politikasını kullanır: yön tıkalıysa açılı ilk
 * boş yön seçilir ve bir süre kilitli kalır. Kararlar düşmanlarınkiyle
 * aynı geometriden geldiği için bot "duvara yapışıp kalma" aynı sınıfta
 * ortadan kalkar. `steerAroundCover` son steering adımını bozmaz, onu döndürür.
 */
function steerAroundCover(game, bot, dt) {
  const desiredX = bot.steerX;
  const desiredY = bot.steerY;
  if (Math.hypot(desiredX, desiredY) < 0.001) {
    bot.avoidTimer = 0;
    return;
  }
  bot.avoidTimer = Math.max(0, (Number(bot.avoidTimer) || 0) - dt);
  if (bot.avoidTimer > 0) {
    bot.steerX = bot.avoidX;
    bot.steerY = bot.avoidY;
    return;
  }
  const probe = bot.radius + fieldPx(game.arena, HORDE_AVOID.probePx);
  const steer = firstFreeDirection(
    bot.x,
    bot.y,
    desiredX,
    desiredY,
    probe,
    game.obstacles,
    bot.radius,
    HORDE_AVOID.fan,
  );
  if (!steer.blocked) return;
  bot.steerX = steer.dirX;
  bot.steerY = steer.dirY;
  bot.avoidX = steer.dirX;
  bot.avoidY = steer.dirY;
  bot.avoidTimer = HORDE_AVOID.commitSeconds;
}

export function updateHordeBotAI(rawGame, bot, dt) {
  const game = createReadOnlyView(rawGame);
  if (!bot?.isAlive || game.state !== 'PLAYING') {
    if (bot) {
      bot.steerX = 0;
      bot.steerY = 0;
      bot.isAiming = false;
    }
    return;
  }

  bot.botCheckTimer = Math.max(0, (Number(bot.botCheckTimer) || 0) - dt);
  bot.botRetarget = Math.max(0, (Number(bot.botRetarget) || 0) - dt);
  if (!Number.isFinite(bot.botStrafeDir) || bot.botStrafeDir === 0) bot.botStrafeDir = Math.random() < 0.5 ? -1 : 1;
  if (bot.botRetarget <= 0) {
    bot.botRetarget = 0.65 + Math.random() * 0.7;
    if (Math.random() < 0.35) bot.botStrafeDir *= -1;
  }

  const target = nearestEnemy(game, bot);
  const targetDistance = target ? Math.hypot(target.x - bot.x, target.y - bot.y) : Infinity;

  const weapon = getPlayerWeapon(bot);
  // Kaçış mesafesi saha ile ölçeklenir: sabit px telefonda sahanın %24'ü,
  // masaüstünde %9.7'si oluyordu — bot telefonda çok daha erken kaçıyordu.
  const dodgeDistance = fieldPx(game.arena, weapon.kind === 'melee' ? 58 : 92);
  if (target && targetDistance < dodgeDistance && bot.dashCooldown <= 0 && bot.dashTimer <= 0) {
    game.triggerDash(bot.index);
  }

  // Mesafe bantları tasarım px'idir ve saha ile ölçeklenir: ham px bırakılınca
  // 387px'lik telefon sahasında "hedefe 150px'den yakın bakma" bandı sahanın
  // %39'u oluyordu — motor tarafında aynı sınıf hata shooter'ı donduruyordu.
  const aimRange = fieldPx(game.arena, 150);
  if (game.portal) {
    const portalDistance = steerToward(bot, game.portal.x, game.portal.y, fieldPx(game.arena, 8));
    if (target && portalDistance < aimRange) aimAt(bot, target);
    else bot.isAiming = false;
    steerAroundCover(game, bot, dt);
    return;
  }

  let tomb = null;
  let tombDistance = Infinity;
  for (const candidate of game.tombs || []) {
    const d2 = distanceSq(bot.x, bot.y, candidate.x, candidate.y);
    if (d2 < tombDistance) {
      tombDistance = d2;
      tomb = candidate;
    }
  }

  const reviveDistance = Math.sqrt(tombDistance);
  const safeToRevive = tomb
    && reviveDistance < fieldPx(game.arena, 330)
    && (!target || targetDistance > fieldPx(game.arena, 105) || reviveDistance < fieldPx(game.arena, 70));
  if (safeToRevive) {
    steerToward(bot, tomb.x, tomb.y, fieldPx(game.arena, 18));
    if (target && targetDistance < fieldPx(game.arena, 260)) aimAt(bot, target);
    else bot.isAiming = false;
    steerAroundCover(game, bot, dt);
    return;
  }

  if (!target) {
    steerToward(bot, game.arena.cx, game.arena.cy, fieldPx(game.arena, 48));
    bot.isAiming = false;
    steerAroundCover(game, bot, dt);
    return;
  }

  const dx = target.x - bot.x;
  const dy = target.y - bot.y;
  const distance = Math.hypot(dx, dy) || 1;
  const nx = dx / distance;
  const ny = dy / distance;
  let mx;
  let my;

  const rangedWeapon = weapon.kind === 'gun';
  const desiredRange = fieldPx(game.arena, weapon.kind === 'melee' ? 58 : weapon.id === 'SHOTGUN' ? 125 : weapon.id === 'SMG' ? 185 : 245);
  if (rangedWeapon && distance < desiredRange * 0.72) {
    mx = -nx * 0.7 - ny * 0.45 * bot.botStrafeDir;
    my = -ny * 0.7 + nx * 0.45 * bot.botStrafeDir;
  } else if (rangedWeapon && distance > desiredRange * 1.2) {
    mx = nx;
    my = ny;
  } else if (!rangedWeapon && distance > desiredRange) {
    mx = nx;
    my = ny;
  } else if (!rangedWeapon && distance < desiredRange * 0.55) {
    mx = -nx * 0.3 - ny * 0.9 * bot.botStrafeDir;
    my = -ny * 0.3 + nx * 0.9 * bot.botStrafeDir;
  } else {
    mx = nx * 0.25 - ny * 0.9 * bot.botStrafeDir;
    my = ny * 0.25 + nx * 0.9 * bot.botStrafeDir;
  }

  const magnitude = Math.hypot(mx, my) || 1;
  bot.steerX = mx / magnitude;
  bot.steerY = my / magnitude;
  steerAroundCover(game, bot, dt);
  aimAt(bot, target);
}
