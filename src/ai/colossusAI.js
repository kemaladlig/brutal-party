// BRUTAL COLOSSUS — Boss ve Bot Yoldaş Yapay Zekası.
// Yalnız simülasyon motoru tarafından çağrılır.
//
// Boss durum makinesi (telegraph → aktif → toparlanma):
//   IDLE → WINDUP_STOMP   → (triggerStomp)      → IDLE
//        → WINDUP_LASER   → LASER_FIRE          → IDLE
//        → WINDUP_CHARGE  → CHARGE              → IDLE
//        → WINDUP_MORTAR  → (triggerMortarBarrage) → IDLE
//   Herhangi bir saldırı sırasında boss köklenir (vx/vy = 0) → takıma
//   sırtına dolanma penceresi açılır. Kırılan modül ilgili saldırıyı
//   kalıcı kapatır (`part.disables`).

import { COLOSSUS_TUNING } from '../games/colossusConfig.js';
import { approachAngle, normalizeAngle, segmentCircleIntersection } from '../core/physics2d.js';
import { fieldRadius, fieldSpeed } from '../core/playfield.js';

function distSq(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

function isDisabled(boss, attack) {
  return (boss.parts || []).some((part) => part.broken && part.disables === attack);
}

function pickNearest(from, players) {
  let best = null;
  let bestDist = Infinity;
  for (const player of players) {
    const d = distSq(from.x, from.y, player.x, player.y);
    if (d < bestDist) {
      bestDist = d;
      best = player;
    }
  }
  return best;
}

function setBotSteer(bot, angle) {
  bot.steerX = Math.cos(angle);
  bot.steerY = Math.sin(angle);
}

function stopBotSteer(bot) {
  bot.steerX = 0;
  bot.steerY = 0;
}

function firstBlockingPillar(x1, y1, x2, y2, pillars) {
  let closest = null;
  let bestT = Infinity;
  for (const pillar of pillars || []) {
    if (!pillar || pillar.hp <= 0) continue;
    const hit = segmentCircleIntersection(x1, y1, x2, y2, pillar.x, pillar.y, pillar.radius);
    if (hit && hit.t < bestT) {
      bestT = hit.t;
      closest = pillar;
    }
  }
  return closest;
}

function aimAndFireWithLos(bot, game, tx, ty) {
  const blocker = firstBlockingPillar(bot.x, bot.y, tx, ty, game.pillars);
  if (blocker) {
    const toTarget = Math.atan2(ty - bot.y, tx - bot.x);
    const toPillar = Math.atan2(blocker.y - bot.y, blocker.x - bot.x);
    const side = normalizeAngle(toTarget - toPillar) >= 0 ? 1 : -1;
    setBotSteer(bot, toTarget + side * (Math.PI / 2));
    bot.angle = toTarget;
    return;
  }
  bot.angle = Math.atan2(ty - bot.y, tx - bot.x);
  game.firePlayerWeapon(bot);
}

function beginLaser(boss) {
  boss.state = 'WINDUP_LASER';
  boss.laserActive = false;
  boss.laserLock = false;
  boss.laserTrackTimer = COLOSSUS_TUNING.LASER_TRACK_TIME;
  boss.laserLockTimer = COLOSSUS_TUNING.LASER_LOCK_TIME;
  boss.laserProgress = 0;
  boss.laserAngle = Number.isFinite(boss.laserAngle) ? boss.laserAngle : boss.angle;
  boss.laserCooldown = COLOSSUS_TUNING.LASER_COOLDOWN * (boss.id === 'VOLT' ? 0.85 : 1);
}

function beginStomp(boss) {
  boss.state = 'WINDUP_STOMP';
  boss.stompWindup = COLOSSUS_TUNING.STOMP_WINDUP;
  boss.stompCooldown = COLOSSUS_TUNING.STOMP_COOLDOWN * (boss.id === 'VOLT' ? 0.85 : 1);
}

function beginCharge(boss) {
  boss.state = 'WINDUP_CHARGE';
  boss.chargeWindup = COLOSSUS_TUNING.CHARGE_WINDUP;
  boss.chargeLock = false;
  boss.chargeCooldown = COLOSSUS_TUNING.CHARGE_COOLDOWN * (boss.id === 'IGNIS' ? 0.85 : 1);
}

function beginMortar(boss) {
  boss.state = 'WINDUP_MORTAR';
  boss.mortarWindup = COLOSSUS_TUNING.MORTAR_WINDUP;
  boss.mortarCooldown = COLOSSUS_TUNING.MORTAR_COOLDOWN * (boss.id === 'IGNIS' ? 0.85 : 1);
}

/**
 * Boss Yapay Zeka Döngüsü. `boss.state` hem telegraph hem sersemlik durumunu
 * taşır (görsel katman bunu tek kaynaktan okur).
 */
export function updateBossAI(boss, game, dt) {
  if (!boss || boss.hp <= 0) return;

  // Sersemleme: hiçbir eylem yok, gövde tamamen durur.
  if (boss.state === 'STAGGER') {
    boss.staggerTimer = Math.max(0, (boss.staggerTimer || 0) - dt);
    boss.vx = 0;
    boss.vy = 0;
    if (boss.staggerTimer <= 0) {
      boss.state = 'IDLE';
      boss.stagger = 0;
    }
    return;
  }

  boss.stompCooldown = Math.max(0, (boss.stompCooldown || 0) - dt);
  boss.laserCooldown = Math.max(0, (boss.laserCooldown || 0) - dt);
  boss.mortarCooldown = Math.max(0, (boss.mortarCooldown || 0) - dt);
  boss.chargeCooldown = Math.max(0, (boss.chargeCooldown || 0) - dt);
  boss.aggroLock = Math.max(0, (boss.aggroLock || 0) - dt);

  const activePlayers = (game.players || []).filter((p) => p.isJoined && p.isAlive && !p.isDowned);
  if (activePlayers.length === 0) {
    boss.vx = 0;
    boss.vy = 0;
    return;
  }

  // Hedef kilidi: kilit bitene kadar aynı oyuncuyu kovalar.
  let target = activePlayers.find((p) => p.index === boss.targetSlot);
  if (!target || boss.aggroLock <= 0) {
    target = pickNearest(boss, activePlayers);
    if (target) {
      boss.targetSlot = target.index;
      boss.aggroLock = COLOSSUS_TUNING.AGGRO_LOCK;
    }
  }
  if (!target) return;

  // ── Aktif saldırı durumları: boss köklenir ────────────────────────────────
  switch (boss.state) {
    case 'WINDUP_STOMP': {
      boss.vx = 0;
      boss.vy = 0;
      boss.stompWindup = (boss.stompWindup || 0) - dt;
      if (boss.stompWindup <= 0) {
        game.triggerStomp();
        boss.state = 'IDLE';
      }
      return;
    }
    case 'WINDUP_LASER': {
      boss.vx = 0;
      boss.vy = 0;
      if ((boss.laserTrackTimer || 0) > 0) {
        const aim = Math.atan2(target.y - boss.y, target.x - boss.x);
        const trackRate = boss.id === 'VOLT' ? 3.2 : 2.6;
        boss.angle = approachAngle(boss.angle, aim, trackRate * dt);
        boss.laserAngle = boss.angle;
        boss.laserLock = false;
        boss.laserTrackTimer = Math.max(0, (boss.laserTrackTimer || 0) - dt);
        boss.laserProgress = clamp01(1 - boss.laserTrackTimer / COLOSSUS_TUNING.LASER_TRACK_TIME) * 0.78;
        if (boss.laserTrackTimer <= 0) {
          boss.laserLock = true;
          boss.laserLockTimer = COLOSSUS_TUNING.LASER_LOCK_TIME;
        }
      } else {
        // Kilitli uyarı penceresi: ışın açısı sabitlenir, kaçış penceresi açılır.
        boss.laserLock = true;
        boss.laserLockTimer = Math.max(0, (boss.laserLockTimer || 0) - dt);
        boss.laserProgress = 0.78 + 0.22 * clamp01(1 - boss.laserLockTimer / COLOSSUS_TUNING.LASER_LOCK_TIME);
        if (boss.laserLockTimer <= 0) {
          boss.state = 'LASER_FIRE';
          boss.laserActive = true;
          boss.laserTimer = COLOSSUS_TUNING.LASER_FIRE_TIME;
          boss.laserAngle = boss.angle;
          boss.laserProgress = 1;
          game.onBossLaserFire?.();
        }
      }
      return;
    }
    case 'LASER_FIRE': {
      boss.vx = 0;
      boss.vy = 0;
      if (boss.id === 'IGNIS') {
        const aim = Math.atan2(target.y - boss.y, target.x - boss.x);
        boss.laserAngle = approachAngle(boss.laserAngle, aim, 0.36 * dt);
        boss.angle = boss.laserAngle;
      }
      boss.laserTimer = (boss.laserTimer || 0) - dt;
      if (boss.laserTimer <= 0) {
        boss.laserActive = false;
        boss.laserLock = false;
        boss.state = 'IDLE';
      }
      return;
    }
    case 'WINDUP_CHARGE': {
      boss.vx = 0;
      boss.vy = 0;
      boss.chargeWindup = (boss.chargeWindup || 0) - dt;
      if (boss.chargeWindup > COLOSSUS_TUNING.CHARGE_LOCK_TIME) {
        const aim = Math.atan2(target.y - boss.y, target.x - boss.x);
        boss.angle = approachAngle(boss.angle, aim, 2.4 * dt);
        boss.chargeAngle = boss.angle;
        boss.chargeLock = false;
      } else {
        boss.chargeLock = true;
      }
      if (boss.chargeWindup <= 0) {
        boss.state = 'CHARGE';
        boss.chargeLock = false;
        boss.chargeAngle = boss.angle;
        boss.chargeTimer = COLOSSUS_TUNING.CHARGE_DURATION;
        boss.chargeHits = [];
      }
      return;
    }
    case 'CHARGE': {
      const chargeSpeed = fieldSpeed(game.arena, COLOSSUS_TUNING.CHARGE_SPEED);
      boss.chargeTimer = (boss.chargeTimer || 0) - dt;
      boss.vx = Math.cos(boss.chargeAngle) * chargeSpeed;
      boss.vy = Math.sin(boss.chargeAngle) * chargeSpeed;
      if (boss.chargeTimer <= 0) {
        boss.state = 'IDLE';
        boss.vx = 0;
        boss.vy = 0;
      }
      return;
    }
    case 'WINDUP_MORTAR': {
      boss.vx = 0;
      boss.vy = 0;
      boss.mortarWindup = (boss.mortarWindup || 0) - dt;
      if (boss.mortarWindup <= 0) {
        game.triggerMortarBarrage(activePlayers);
        boss.state = 'IDLE';
      }
      return;
    }
    default:
      break;
  }

  // ── Serbest: hedefe dön ───────────────────────────────────────────────────
  const targetAngle = Math.atan2(target.y - boss.y, target.x - boss.x);
  const rotSpeed = COLOSSUS_TUNING.BOSS_ROTATION_SPEED * (boss.phase === 3 ? 1.35 : 1);
  boss.angle = approachAngle(boss.angle, targetAngle, rotSpeed * dt);
  const angleDiff = normalizeAngle(targetAngle - boss.angle);

  // Faz 2 kalkan: merkeze çekil, havanla ya da ikincil saldırıyla alanı döv.
  if (boss.phase === 2 && boss.shielded) {
    const toCenter = Math.atan2(game.arena.cy - boss.y, game.arena.cx - boss.x);
    const speed = fieldSpeed(game.arena, boss.speedP2 || COLOSSUS_TUNING.BOSS_SPEED_P2);
    boss.vx = Math.cos(toCenter) * speed * 0.7;
    boss.vy = Math.sin(toCenter) * speed * 0.7;
    const dToTarget = Math.sqrt(distSq(boss.x, boss.y, target.x, target.y));
    if (boss.mortarCooldown <= 0 && !isDisabled(boss, 'MORTAR')) {
      beginMortar(boss);
    } else if (isDisabled(boss, 'MORTAR')) {
      if (boss.stompCooldown <= 0 && dToTarget < fieldRadius(game.arena, 230) && !isDisabled(boss, 'STOMP')) {
        beginStomp(boss);
      } else if (boss.laserCooldown <= 0 && Math.abs(angleDiff) < 0.5 && !isDisabled(boss, 'LASER')) {
        beginLaser(boss);
      }
    }
    return;
  }

  const dToTarget = Math.sqrt(distSq(boss.x, boss.y, target.x, target.y));
  const aligned = Math.abs(angleDiff) < 0.45;
  const stompRange = fieldRadius(game.arena, 240);
  const laserMinRange = fieldRadius(game.arena, 160);
  const chargeMinRange = fieldRadius(game.arena, 240);

  if (boss.stompCooldown <= 0 && dToTarget < stompRange && !isDisabled(boss, 'STOMP')) {
    beginStomp(boss);
    return;
  }
  if (boss.laserCooldown <= 0 && dToTarget > laserMinRange && aligned && !isDisabled(boss, 'LASER')) {
    beginLaser(boss);
    return;
  }
  if (boss.chargeCooldown <= 0 && dToTarget > chargeMinRange && aligned && !isDisabled(boss, 'CHARGE')) {
    beginCharge(boss);
    return;
  }
  if (boss.phase >= 2 && boss.mortarCooldown <= 0 && !isDisabled(boss, 'MORTAR')) {
    beginMortar(boss);
    return;
  }

  // Normal takip hareketi.
  const baseSpeed = boss.phase === 3
    ? (boss.speedP3 || COLOSSUS_TUNING.BOSS_SPEED_P3)
    : (boss.phase === 2 ? (boss.speedP2 || COLOSSUS_TUNING.BOSS_SPEED_P2) : (boss.speedP1 || COLOSSUS_TUNING.BOSS_SPEED_P1));
  const speed = fieldSpeed(game.arena, baseSpeed);
  boss.vx = Math.cos(boss.angle) * speed;
  boss.vy = Math.sin(boss.angle) * speed;
}

/**
 * Oyuncu Bot Yoldaş Yapay Zekası. Roller: kaçış → medic → pylon avcısı → kiter/flanker.
 * Boss sersemlemişse herkes çekirdeğe yüklenir. Hareketler `steerX/Y` üzerinden
 * motorun `stepArcadeVelocity` döngüsüyle akar.
 */
export function updateColossusBotAI(bot, game, dt) {
  if (!bot.isJoined || !bot.isAlive || bot.isDowned) return;

  const boss = game.boss;
  if (!boss || boss.hp <= 0) {
    stopBotSteer(bot);
    return;
  }

  const arena = game.arena;
  const bossTargetingMe = boss.targetSlot === bot.index;

  // 1. Şok dalgasından depar ile kaç.
  const shockPad = fieldRadius(arena, 45);
  const incomingShockwave = (game.shockwaves || []).find((s) => {
    const d = Math.sqrt(distSq(bot.x, bot.y, s.x, s.y));
    return Math.abs(d - s.radius) < shockPad;
  });
  if (incomingShockwave && (bot.dashCooldown || 0) <= 0) {
    game.performPlayerDash(bot);
  }

  // 2. Havan tehlike çemberinden hemen çık.
  const mortarPad = fieldRadius(arena, 18);
  for (const m of game.mortars || []) {
    const d = Math.sqrt(distSq(bot.x, bot.y, m.x, m.y));
    if (d < m.radius + bot.radius + mortarPad) {
      const away = d > 0.001 ? Math.atan2(bot.y - m.y, bot.x - m.x) : 0;
      setBotSteer(bot, away);
      if (m.fuse < 0.35 && (bot.dashCooldown || 0) <= 0) {
        game.performPlayerDash(bot);
      }
      bot.angle = Math.atan2(boss.y - bot.y, boss.x - bot.x);
      return;
    }
  }

  // 3. Tarayıcı ışın hattındaysak dikine kaç.
  if (boss.state === 'WINDUP_LASER' || boss.state === 'LASER_FIRE') {
    const laneAngle = Number.isFinite(boss.laserAngle) ? boss.laserAngle : boss.angle;
    const dx = bot.x - boss.x;
    const dy = bot.y - boss.y;
    const forward = dx * Math.cos(laneAngle) + dy * Math.sin(laneAngle);
    const beamHalf = fieldRadius(arena, COLOSSUS_TUNING.LASER_BEAM_WIDTH * 0.5);
    if (forward > boss.radius * 0.4) {
      const signedPerp = -Math.sin(laneAngle) * dx + Math.cos(laneAngle) * dy;
      if (Math.abs(signedPerp) < beamHalf + bot.radius + fieldRadius(arena, 26)) {
        const evade = laneAngle + (signedPerp >= 0 ? 1 : -1) * (Math.PI / 2);
        setBotSteer(bot, evade);
        if ((boss.laserLock || boss.laserActive) && (bot.dashCooldown || 0) <= 0) {
          game.performPlayerDash(bot);
        }
        bot.angle = Math.atan2(boss.y - bot.y, boss.x - bot.x);
        return;
      }
    }
  }

  // 4. Hücum hattındaysak yana kaç.
  if (boss.state === 'WINDUP_CHARGE' || boss.state === 'CHARGE') {
    const laneAngle = boss.state === 'CHARGE' ? (boss.chargeAngle || boss.angle) : boss.angle;
    const rel = Math.atan2(bot.y - boss.y, bot.x - boss.x) - laneAngle;
    const perpDist = Math.abs(Math.sin(rel)) * Math.sqrt(distSq(bot.x, bot.y, boss.x, boss.y));
    if (perpDist < boss.radius + bot.radius + fieldRadius(arena, 26)) {
      const evade = laneAngle + (Math.sin(rel) >= 0 ? -1 : 1) * (Math.PI / 2);
      setBotSteer(bot, evade);
      bot.angle = Math.atan2(boss.y - bot.y, boss.x - bot.x);
      return;
    }
  }

  // 5. Medic: düşmüş takım arkadaşını dirilt.
  const downedTeammate = (game.players || []).find(
    (p) => p.isJoined && p.isAlive && p.isDowned && p.index !== bot.index,
  );
  if (downedTeammate && !bossTargetingMe) {
    const dDown = Math.sqrt(distSq(downedTeammate.x, downedTeammate.y, bot.x, bot.y));
    const revStop = fieldRadius(arena, COLOSSUS_TUNING.REVIVE_RADIUS) * 0.45;
    const angle = Math.atan2(downedTeammate.y - bot.y, downedTeammate.x - bot.x);
    if (dDown > revStop) {
      setBotSteer(bot, angle);
    } else {
      stopBotSteer(bot);
    }
    bot.angle = Math.atan2(boss.y - bot.y, boss.x - bot.x);
    return;
  }

  // 6. Faz 2 kalkan: aktif pilonları yık.
  if (boss.phase === 2 && boss.shielded && (game.pylons || []).some((p) => p.active)) {
    const activePylons = game.pylons.filter((p) => p.active);
    const nearestPylon = pickNearest(bot, activePylons);
    const angle = Math.atan2(nearestPylon.y - bot.y, nearestPylon.x - bot.x);
    const dist = Math.sqrt(distSq(bot.x, bot.y, nearestPylon.x, nearestPylon.y));
    if (dist > fieldRadius(arena, 190)) {
      setBotSteer(bot, angle);
    } else {
      stopBotSteer(bot);
    }
    aimAndFireWithLos(bot, game, nearestPylon.x, nearestPylon.y);
    return;
  }

  // 7. Sersemlik / zırh kırıldı: çekirdeğe yüklen.
  const armorBroken = (boss.parts || []).find((p) => p.id === 'armorPlate')?.broken === true;
  if (boss.state === 'STAGGER' || armorBroken) {
    const angle = Math.atan2(boss.y - bot.y, boss.x - bot.x);
    const dist = Math.sqrt(distSq(bot.x, bot.y, boss.x, boss.y));
    if (dist > boss.radius + fieldRadius(arena, 110)) {
      setBotSteer(bot, angle);
    } else {
      stopBotSteer(bot);
    }
    aimAndFireWithLos(bot, game, boss.x, boss.y);
    return;
  }

  if (bossTargetingMe) {
    // Kiter: canlı sütun arkasına kaç, sütun yoksa dış dairede dön.
    const nearestPillar = (game.pillars || []).find((p) => p.hp > 0);
    let safeX = arena.cx;
    let safeY = arena.cy;
    if (nearestPillar) {
      const pAngle = Math.atan2(nearestPillar.y - boss.y, nearestPillar.x - boss.x);
      safeX = nearestPillar.x + Math.cos(pAngle) * (nearestPillar.radius + bot.radius + fieldRadius(arena, 26));
      safeY = nearestPillar.y + Math.sin(pAngle) * (nearestPillar.radius + bot.radius + fieldRadius(arena, 26));
    } else {
      const away = Math.atan2(bot.y - boss.y, bot.x - boss.x);
      safeX = bot.x + Math.cos(away + 0.5) * fieldRadius(arena, 130);
      safeY = bot.y + Math.sin(away + 0.5) * fieldRadius(arena, 130);
    }
    const moveAngle = Math.atan2(safeY - bot.y, safeX - bot.x);
    setBotSteer(bot, moveAngle);
    aimAndFireWithLos(bot, game, boss.x, boss.y);
    return;
  }

  // 8. Flanker: boss'un arkasına dolan, kırılmamış modülü hedefle.
  const rearAngle = normalizeAngle(boss.angle + Math.PI);
  let flankOffset = 140;
  if (bot.weaponId === 'SHOTGUN') flankOffset = 80;
  else if (bot.weaponId === 'SNIPER') flankOffset = 220;
  const flankDist = boss.radius + fieldRadius(arena, flankOffset);

  const targetX = boss.x + Math.cos(rearAngle) * flankDist;
  const targetY = boss.y + Math.sin(rearAngle) * flankDist;
  const toFlank = Math.sqrt(distSq(bot.x, bot.y, targetX, targetY));
  if (toFlank > fieldRadius(arena, 36)) {
    setBotSteer(bot, Math.atan2(targetY - bot.y, targetX - bot.x));
  } else {
    stopBotSteer(bot);
  }

  const unbroken = (boss.parts || []).find((p) => !p.broken);
  if (unbroken) {
    const partAngle = boss.angle + unbroken.angleOffset;
    const partDist = boss.radius * unbroken.distRatio;
    const px = boss.x + Math.cos(partAngle) * partDist;
    const py = boss.y + Math.sin(partAngle) * partDist;
    aimAndFireWithLos(bot, game, px, py);
  } else {
    aimAndFireWithLos(bot, game, boss.x, boss.y);
  }
}
