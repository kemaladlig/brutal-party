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
import { approachAngle, normalizeAngle } from '../core/physics2d.js';

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

function beginLaser(boss) {
  boss.state = 'WINDUP_LASER';
  boss.laserActive = false;
  boss.laserLock = false;
  boss.laserTrackTimer = COLOSSUS_TUNING.LASER_TRACK_TIME;
  boss.laserProgress = 0;
  boss.laserAngle = Number.isFinite(boss.laserAngle) ? boss.laserAngle : boss.angle;
  boss.laserCooldown = COLOSSUS_TUNING.LASER_COOLDOWN;
}

function beginStomp(boss) {
  boss.state = 'WINDUP_STOMP';
  boss.stompWindup = COLOSSUS_TUNING.STOMP_WINDUP;
  boss.stompCooldown = COLOSSUS_TUNING.STOMP_COOLDOWN;
}

function beginCharge(boss) {
  boss.state = 'WINDUP_CHARGE';
  boss.chargeWindup = COLOSSUS_TUNING.CHARGE_WINDUP;
  boss.chargeCooldown = COLOSSUS_TUNING.CHARGE_COOLDOWN;
}

function beginMortar(boss) {
  boss.state = 'WINDUP_MORTAR';
  boss.mortarWindup = COLOSSUS_TUNING.MORTAR_WINDUP;
  boss.mortarCooldown = COLOSSUS_TUNING.MORTAR_COOLDOWN;
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
      const aim = Math.atan2(target.y - boss.y, target.x - boss.x);
      // Gövde görünür şekilde izler; hasar açısı ve çizim açısı tek kaynak.
      boss.angle = approachAngle(boss.angle, aim, 3.2 * dt);
      boss.laserAngle = boss.angle;
      boss.laserProgress = clamp01(1 - (boss.laserTrackTimer || 0) / COLOSSUS_TUNING.LASER_TRACK_TIME);
      boss.laserTrackTimer = (boss.laserTrackTimer || 0) - dt;
      if (boss.laserTrackTimer <= 0) {
        boss.state = 'LASER_FIRE';
        boss.laserActive = true;
        boss.laserLock = true;
        boss.laserTimer = COLOSSUS_TUNING.LASER_FIRE_TIME;
        boss.laserAngle = boss.angle;
        boss.laserProgress = 1;
        game.onBossLaserFire?.();
      }
      return;
    }
    case 'LASER_FIRE': {
      boss.vx = 0;
      boss.vy = 0;
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
      const aim = Math.atan2(target.y - boss.y, target.x - boss.x);
      boss.angle = approachAngle(boss.angle, aim, 2.4 * dt);
      boss.chargeAngle = boss.angle;
      boss.chargeWindup = (boss.chargeWindup || 0) - dt;
      if (boss.chargeWindup <= 0) {
        boss.state = 'CHARGE';
        boss.chargeAngle = boss.angle;
        boss.chargeTimer = COLOSSUS_TUNING.CHARGE_DURATION;
        boss.chargeHits = [];
      }
      return;
    }
    case 'CHARGE': {
      boss.chargeTimer = (boss.chargeTimer || 0) - dt;
      boss.vx = Math.cos(boss.chargeAngle) * COLOSSUS_TUNING.CHARGE_SPEED;
      boss.vy = Math.sin(boss.chargeAngle) * COLOSSUS_TUNING.CHARGE_SPEED;
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

  // Faz 2 kalkan: merkeze çekil, havanla alanı döve.
  if (boss.phase === 2 && boss.shielded) {
    const toCenter = Math.atan2(game.arena.cy - boss.y, game.arena.cx - boss.x);
    const speed = boss.speedP2 || COLOSSUS_TUNING.BOSS_SPEED_P2;
    boss.vx = Math.cos(toCenter) * speed * 0.7;
    boss.vy = Math.sin(toCenter) * speed * 0.7;
    if (boss.mortarCooldown <= 0 && !isDisabled(boss, 'MORTAR')) beginMortar(boss);
    return;
  }

  const dToTarget = Math.sqrt(distSq(boss.x, boss.y, target.x, target.y));
  const aligned = Math.abs(angleDiff) < 0.45;

  if (boss.stompCooldown <= 0 && dToTarget < 250 && !isDisabled(boss, 'STOMP')) {
    beginStomp(boss);
    return;
  }
  if (boss.laserCooldown <= 0 && dToTarget > 160 && aligned && !isDisabled(boss, 'LASER')) {
    beginLaser(boss);
    return;
  }
  if (boss.chargeCooldown <= 0 && dToTarget > 250 && aligned && !isDisabled(boss, 'CHARGE')) {
    beginCharge(boss);
    return;
  }
  if (boss.phase >= 2 && boss.mortarCooldown <= 0 && !isDisabled(boss, 'MORTAR')) {
    beginMortar(boss);
    return;
  }

  // Normal takip hareketi.
  const speed = boss.phase === 3
    ? (boss.speedP3 || COLOSSUS_TUNING.BOSS_SPEED_P3)
    : (boss.phase === 2 ? (boss.speedP2 || COLOSSUS_TUNING.BOSS_SPEED_P2) : (boss.speedP1 || COLOSSUS_TUNING.BOSS_SPEED_P1));
  boss.vx = Math.cos(boss.angle) * speed;
  boss.vy = Math.sin(boss.angle) * speed;
}

/**
 * Oyuncu Bot Yoldaş Yapay Zekası. Roller: medic → pylon avcısı → kiter/flanker.
 * Boss sersemlemişse herkes çekirdeğe koşar.
 */
export function updateColossusBotAI(bot, game, dt) {
  if (!bot.isJoined || !bot.isAlive || bot.isDowned) return;

  const boss = game.boss;
  if (!boss || boss.hp <= 0) return;

  const speed = COLOSSUS_TUNING.PLAYER_SPEED;
  const bossTargetingMe = boss.targetSlot === bot.index;

  // Şok dalgasından depar ile kaç.
  const incomingShockwave = (game.shockwaves || []).find((s) => {
    const d = Math.sqrt(distSq(bot.x, bot.y, s.x, s.y));
    return Math.abs(d - s.radius) < 40;
  });
  if (incomingShockwave && (bot.dashCooldown || 0) <= 0) {
    game.performPlayerDash(bot);
  }

  // Hücum hattındaysak yana kaç.
  if ((boss.state === 'WINDUP_CHARGE' || boss.state === 'CHARGE')) {
    const laneAngle = boss.state === 'CHARGE' ? (boss.chargeAngle || boss.angle) : boss.angle;
    const rel = Math.atan2(bot.y - boss.y, bot.x - boss.x) - laneAngle;
    const perpDist = Math.abs(Math.sin(rel)) * Math.sqrt(distSq(bot.x, bot.y, boss.x, boss.y));
    if (perpDist < boss.radius + bot.radius + 24) {
      const evade = laneAngle + (Math.sin(rel) >= 0 ? -1 : 1) * Math.PI / 2;
      bot.vx = Math.cos(evade) * speed;
      bot.vy = Math.sin(evade) * speed;
      bot.angle = Math.atan2(boss.y - bot.y, boss.x - bot.x);
      return;
    }
  }

  // Medic: düşmüş takım arkadaşını dirilt.
  const downedTeammate = (game.players || []).find(
    (p) => p.isJoined && p.isAlive && p.isDowned && p.index !== bot.index,
  );
  if (downedTeammate && !bossTargetingMe) {
    const angle = Math.atan2(downedTeammate.y - bot.y, downedTeammate.x - bot.x);
    bot.vx = Math.cos(angle) * speed;
    bot.vy = Math.sin(angle) * speed;
    bot.angle = angle;
    return;
  }

  // Faz 2 kalkan: aktif pilonları yık.
  if (boss.phase === 2 && boss.shielded && (game.pylons || []).some((p) => p.active)) {
    const activePylons = game.pylons.filter((p) => p.active);
    const nearestPylon = pickNearest(bot, activePylons);
    const angle = Math.atan2(nearestPylon.y - bot.y, nearestPylon.x - bot.x);
    const dist = Math.sqrt(distSq(bot.x, bot.y, nearestPylon.x, nearestPylon.y));
    if (dist > 170) {
      bot.vx = Math.cos(angle) * speed;
      bot.vy = Math.sin(angle) * speed;
    } else {
      bot.vx = 0;
      bot.vy = 0;
    }
    bot.angle = angle;
    game.firePlayerWeapon(bot);
    return;
  }

  // Sersemlik / zırh kırıldı: çekirdeğe yüklen.
  const armorBroken = (boss.parts || []).find((p) => p.id === 'armorPlate')?.broken === true;
  if (boss.state === 'STAGGER' || armorBroken) {
    const angle = Math.atan2(boss.y - bot.y, boss.x - bot.x);
    const dist = Math.sqrt(distSq(bot.x, bot.y, boss.x, boss.y));
    if (dist > boss.radius + 90) {
      bot.vx = Math.cos(angle) * speed;
      bot.vy = Math.sin(angle) * speed;
    } else {
      bot.vx = 0;
      bot.vy = 0;
    }
    bot.angle = angle;
    game.firePlayerWeapon(bot);
    return;
  }

  if (bossTargetingMe) {
    // Kiter: sütun arkasına kaç, geri dönüp ateş et.
    const nearestPillar = (game.pillars || []).find((p) => p.hp > 0);
    let safeX = game.arena.cx;
    let safeY = game.arena.cy;
    if (nearestPillar) {
      const pAngle = Math.atan2(nearestPillar.y - boss.y, nearestPillar.x - boss.x);
      safeX = nearestPillar.x + Math.cos(pAngle) * (nearestPillar.radius + 30);
      safeY = nearestPillar.y + Math.sin(pAngle) * (nearestPillar.radius + 30);
    } else {
      const away = Math.atan2(bot.y - boss.y, bot.x - boss.x);
      safeX = bot.x + Math.cos(away) * 120;
      safeY = bot.y + Math.sin(away) * 120;
    }
    const moveAngle = Math.atan2(safeY - bot.y, safeX - bot.x);
    bot.vx = Math.cos(moveAngle) * speed;
    bot.vy = Math.sin(moveAngle) * speed;
    bot.angle = Math.atan2(boss.y - bot.y, boss.x - bot.x);
    game.firePlayerWeapon(bot);
    return;
  }

  // Flanker: boss'un arkasına dolan, kırılmamış modülü hedefle.
  const rearAngle = normalizeAngle(boss.angle + Math.PI);
  let flankDist = boss.radius + 140;
  if (bot.weaponId === 'SHOTGUN') flankDist = boss.radius + 80;
  else if (bot.weaponId === 'SNIPER') flankDist = boss.radius + 230;

  const targetX = boss.x + Math.cos(rearAngle) * flankDist;
  const targetY = boss.y + Math.sin(rearAngle) * flankDist;
  const toFlank = Math.sqrt(distSq(bot.x, bot.y, targetX, targetY));
  if (toFlank > 40) {
    const moveAngle = Math.atan2(targetY - bot.y, targetX - bot.x);
    bot.vx = Math.cos(moveAngle) * speed;
    bot.vy = Math.sin(moveAngle) * speed;
  } else {
    bot.vx = 0;
    bot.vy = 0;
  }

  const unbroken = (boss.parts || []).find((p) => !p.broken);
  if (unbroken) {
    const partAngle = boss.angle + unbroken.angleOffset;
    const partDist = boss.radius * unbroken.distRatio;
    const px = boss.x + Math.cos(partAngle) * partDist;
    const py = boss.y + Math.sin(partAngle) * partDist;
    bot.angle = Math.atan2(py - bot.y, px - bot.x);
  } else {
    bot.angle = Math.atan2(boss.y - bot.y, boss.x - bot.x);
  }
  game.firePlayerWeapon(bot);
}
