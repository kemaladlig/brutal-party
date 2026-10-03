// BRUTAL COLOSSUS — Boss ve Bot Yoldaş Yapay Zekası.
// Yalnız simülasyon motoru tarafından çağrılır.

import { COLOSSUS_TUNING } from '../games/colossusConfig.js';
import { normalizeAngle } from '../core/physics2d.js';

function distSq(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * Boss Yapay Zeka Döngüsü
 */
export function updateBossAI(boss, game, dt) {
  if (!boss || boss.hp <= 0) return;

  // Sersemleme durumunda hiçbir eylem yapmaz
  if (boss.state === 'STAGGER') {
    boss.staggerTimer = Math.max(0, (boss.staggerTimer || 0) - dt);
    if (boss.staggerTimer <= 0) {
      boss.state = 'IDLE';
      boss.stagger = 0;
    }
    return;
  }

  // Canlı oyuncuları bul
  const activePlayers = (game.players || []).filter((p) => p.isJoined && p.isAlive && !p.isDowned);
  if (activePlayers.length === 0) return;

  // 1. Hedef Belirleme (Aggro Seçimi)
  let target = activePlayers.find((p) => p.index === boss.targetSlot);
  if (!target || Math.random() < 0.02) {
    // En yakın veya en çok hasar veren oyuncuyu seç
    let bestDist = Infinity;
    for (const p of activePlayers) {
      const d = distSq(boss.x, boss.y, p.x, p.y);
      if (d < bestDist) {
        bestDist = d;
        target = p;
      }
    }
    if (target) boss.targetSlot = target.index;
  }

  if (!target) return;

  // 2. Hedefe Doğru Yönelme (Smooth Rotation)
  const targetAngle = Math.atan2(target.y - boss.y, target.x - boss.x);
  let angleDiff = normalizeAngle(targetAngle - boss.angle);
  const rotSpeed = COLOSSUS_TUNING.BOSS_ROTATION_SPEED * (boss.phase === 3 ? 1.35 : 1.0);
  boss.angle = normalizeAngle(boss.angle + Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), rotSpeed * dt));

  // 3. Durum Makinesi & Saldırılar
  boss.stompCooldown = Math.max(0, (boss.stompCooldown || 0) - dt);
  boss.laserCooldown = Math.max(0, (boss.laserCooldown || 0) - dt);
  boss.mortarCooldown = Math.max(0, (boss.mortarCooldown || 0) - dt);
  boss.chargeCooldown = Math.max(0, (boss.chargeCooldown || 0) - dt);

  const dToTarget = Math.sqrt(distSq(boss.x, boss.y, target.x, target.y));

  // Lazer saldırısı aktifse
  if (boss.laserActive) {
    boss.laserTimer = (boss.laserTimer || 0) - dt;
    if (boss.laserTimer <= 0) {
      boss.laserActive = false;
      boss.state = 'IDLE';
    }
    return;
  }

  // Faz 2: Kalkan ve Pilonlar
  if (boss.phase === 2 && boss.shielded) {
    const toCenterAngle = Math.atan2(game.arena.cy - boss.y, game.arena.cx - boss.x);
    boss.vx = Math.cos(toCenterAngle) * (COLOSSUS_TUNING.BOSS_SPEED_P2 * 0.7);
    boss.vy = Math.sin(toCenterAngle) * (COLOSSUS_TUNING.BOSS_SPEED_P2 * 0.7);

    const cannonBroken = boss.parts?.find((p) => p.id === 'cannon')?.broken;
    if (boss.mortarCooldown <= 0 && !cannonBroken) {
      game.triggerMortarBarrage(activePlayers);
      boss.mortarCooldown = COLOSSUS_TUNING.MORTAR_COOLDOWN;
    }
    return;
  }

  // Hücum (Charge)
  if (boss.state === 'CHARGE') {
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

  // Boss Türüne Özel Saldırılar
  if (boss.id === 'IGNIS') {
    const stingerBroken = boss.parts?.find((p) => p.id === 'stinger')?.broken;
    const pincersBroken = boss.parts?.find((p) => p.id === 'pincers')?.broken;

    if (boss.stompCooldown <= 0 && dToTarget < 260) {
      game.triggerStomp();
      boss.stompCooldown = 4.2;
    } else if (boss.laserCooldown <= 0 && !stingerBroken && dToTarget > 150) {
      game.triggerLaser();
      boss.laserCooldown = 5.2;
    } else if (boss.chargeCooldown <= 0 && !pincersBroken && dToTarget > 220 && Math.abs(angleDiff) < 0.35) {
      boss.state = 'CHARGE';
      boss.chargeAngle = boss.angle;
      boss.chargeTimer = 1.1;
      boss.chargeCooldown = 5.5;
    } else {
      const speed = boss.phase === 3 ? (boss.speedP3 || 94) : (boss.phase === 2 ? (boss.speedP2 || 76) : (boss.speedP1 || 60));
      boss.vx = Math.cos(boss.angle) * speed;
      boss.vy = Math.sin(boss.angle) * speed;
    }
    return;
  }

  if (boss.id === 'VOLT') {
    const coilBroken = boss.parts?.find((p) => p.id === 'coil')?.broken;
    const capBroken = boss.parts?.find((p) => p.id === 'capacitors')?.broken;

    if (boss.stompCooldown <= 0 && !capBroken && dToTarget < 250) {
      game.triggerStomp();
      boss.stompCooldown = 4.5;
    } else if (boss.laserCooldown <= 0 && !coilBroken && dToTarget > 160) {
      game.triggerLaser();
      boss.laserCooldown = 5.0;
    } else if (boss.chargeCooldown <= 0 && dToTarget < 150) {
      boss.vx = -Math.cos(boss.angle) * 350;
      boss.vy = -Math.sin(boss.angle) * 350;
      boss.chargeCooldown = 4.0;
    } else {
      const speed = boss.phase === 3 ? (boss.speedP3 || 86) : (boss.phase === 2 ? (boss.speedP2 || 68) : (boss.speedP1 || 52));
      boss.vx = Math.cos(boss.angle) * speed;
      boss.vy = Math.sin(boss.angle) * speed;
    }
    return;
  }

  // Standart AEGIS-01 Davranışı
  const cannonBroken = boss.parts?.find((p) => p.id === 'cannon')?.broken;
  if (boss.stompCooldown <= 0 && dToTarget < 280) {
    // Deprem Dalgası (Stomp)
    game.triggerStomp();
    boss.stompCooldown = COLOSSUS_TUNING.STOMP_COOLDOWN;
  } else if (boss.laserCooldown <= 0 && dToTarget > 180) {
    // Lazer Süpürmesi
    game.triggerLaser();
    boss.laserCooldown = COLOSSUS_TUNING.LASER_COOLDOWN;
  } else if (boss.phase === 3 && boss.mortarCooldown <= 0 && !cannonBroken) {
    // Faz 3 Havan Topu
    game.triggerMortarBarrage(activePlayers);
    boss.mortarCooldown = COLOSSUS_TUNING.MORTAR_COOLDOWN * 0.75;
  } else if (boss.chargeCooldown <= 0 && dToTarget > 250 && Math.abs(angleDiff) < 0.3) {
    // Hücum Başlat
    boss.state = 'CHARGE';
    boss.chargeAngle = boss.angle;
    boss.chargeTimer = COLOSSUS_TUNING.CHARGE_DURATION;
    boss.chargeCooldown = 7.0;
  } else {
    // Normal Takip Hareketi
    const speed = boss.phase === 3
      ? COLOSSUS_TUNING.BOSS_SPEED_P3
      : (boss.phase === 2 ? COLOSSUS_TUNING.BOSS_SPEED_P2 : COLOSSUS_TUNING.BOSS_SPEED_P1);

    boss.vx = Math.cos(boss.angle) * speed;
    boss.vy = Math.sin(boss.angle) * speed;
  }
}

/**
 * Oyuncu Bot Yoldaş Yapay Zekası (Bot Companions)
 */
export function updateColossusBotAI(bot, game, dt) {
  if (!bot.isJoined || !bot.isAlive || bot.isDowned) return;

  const boss = game.boss;
  if (!boss || boss.hp <= 0) return;

  // 1. Düşmüş Takım Arkadaşı Var mı? (Medic Önceliği)
  const downedTeammate = (game.players || []).find(
    (p) => p.isJoined && p.isAlive && p.isDowned && p.index !== bot.index
  );

  const isBossTargetingMe = boss.targetSlot === bot.index;
  const dToBoss = Math.sqrt(distSq(bot.x, bot.y, boss.x, boss.y));

  // Yakındaki şok dalgalarından kaçma (Dash Guard)
  const incomingShockwave = (game.shockwaves || []).find((s) => {
    const d = Math.sqrt(distSq(bot.x, bot.y, s.x, s.y));
    return Math.abs(d - s.radius) < 40;
  });

  if (incomingShockwave && (bot.dashCooldown || 0) <= 0) {
    // Şok dalgasının üzerinden atla
    game.performPlayerDash(bot);
  }

  // Rol Seçimi
  if (downedTeammate && !isBossTargetingMe) {
    // MEDIC: Takım arkadaşını kurtar
    const toDownedAngle = Math.atan2(downedTeammate.y - bot.y, downedTeammate.x - bot.x);
    bot.vx = Math.cos(toDownedAngle) * COLOSSUS_TUNING.PLAYER_SPEED;
    bot.vy = Math.sin(toDownedAngle) * COLOSSUS_TUNING.PLAYER_SPEED;
    bot.angle = toDownedAngle;
    return;
  }

  // 1.5. Faz 2 Pilon Yok Etme Önceliği (Boss Kalkanlıysa)
  if (boss.phase === 2 && boss.shielded && (game.pylons || []).some((p) => p.active)) {
    const activePylons = game.pylons.filter((p) => p.active);
    let nearestPylon = activePylons[0];
    let minPDist = distSq(bot.x, bot.y, nearestPylon.x, nearestPylon.y);
    for (const p of activePylons) {
      const pd = distSq(bot.x, bot.y, p.x, p.y);
      if (pd < minPDist) {
        minPDist = pd;
        nearestPylon = p;
      }
    }

    const pylonAngle = Math.atan2(nearestPylon.y - bot.y, nearestPylon.x - bot.x);
    const pylonDist = Math.sqrt(minPDist);

    if (pylonDist > 160) {
      bot.vx = Math.cos(pylonAngle) * COLOSSUS_TUNING.PLAYER_SPEED;
      bot.vy = Math.sin(pylonAngle) * COLOSSUS_TUNING.PLAYER_SPEED;
    } else {
      bot.vx = 0;
      bot.vy = 0;
    }
    bot.angle = pylonAngle;
    game.firePlayerWeapon(bot);
    return;
  }

  if (isBossTargetingMe) {
    // KITER: Boss beni kovalıyor — geri çekil ve en yakın sütunun arkasına geç
    let safeX = game.arena.cx;
    let safeY = game.arena.cy;

    // Boss ile arama sütun sokmaya çalış
    const nearestPillar = (game.pillars || []).find((p) => p.hp > 0);
    if (nearestPillar) {
      const pAngle = Math.atan2(nearestPillar.y - boss.y, nearestPillar.x - boss.x);
      safeX = nearestPillar.x + Math.cos(pAngle) * (nearestPillar.radius + 30);
      safeY = nearestPillar.y + Math.sin(pAngle) * (nearestPillar.radius + 30);
    } else {
      // Boss'un ters yönüne kaç
      const awayAngle = Math.atan2(bot.y - boss.y, bot.x - boss.x);
      safeX = bot.x + Math.cos(awayAngle) * 100;
      safeY = bot.y + Math.sin(awayAngle) * 100;
    }

    const moveAngle = Math.atan2(safeY - bot.y, safeX - bot.x);
    bot.vx = Math.cos(moveAngle) * COLOSSUS_TUNING.PLAYER_SPEED;
    bot.vy = Math.sin(moveAngle) * COLOSSUS_TUNING.PLAYER_SPEED;

    // Geriye dönüp ateş et
    bot.angle = Math.atan2(boss.y - bot.y, boss.x - bot.x);
    if (dToBoss > 120 && Math.random() < 0.6) {
      game.firePlayerWeapon(bot);
    }
  } else {
    // FLANKER: Boss başkasına odaklı — arkasındaki zayıf noktaya dolan!
    const rearAngle = normalizeAngle(boss.angle + Math.PI);
    let flankDist = boss.radius + 140;
    if (bot.weaponId === 'SHOTGUN') flankDist = boss.radius + 70;
    else if (bot.weaponId === 'SNIPER') flankDist = boss.radius + 220;

    const targetFlankX = boss.x + Math.cos(rearAngle) * flankDist;
    const targetFlankY = boss.y + Math.sin(rearAngle) * flankDist;

    const toFlankDist = Math.sqrt(distSq(bot.x, bot.y, targetFlankX, targetFlankY));

    if (toFlankDist > 40) {
      const moveAngle = Math.atan2(targetFlankY - bot.y, targetFlankX - bot.x);
      bot.vx = Math.cos(moveAngle) * COLOSSUS_TUNING.PLAYER_SPEED;
      bot.vy = Math.sin(moveAngle) * COLOSSUS_TUNING.PLAYER_SPEED;
    } else {
      bot.vx = 0;
      bot.vy = 0;
    }

    // Kırılmamış bir parça varsa ona, yoksa çekirdeğe nişan al
    const unbrokenPart = (boss.parts || []).find((p) => !p.broken);
    if (unbrokenPart) {
      const partAngle = boss.angle + unbrokenPart.angleOffset;
      const partDist = boss.radius * unbrokenPart.distRatio;
      const targetPx = boss.x + Math.cos(partAngle) * partDist;
      const targetPy = boss.y + Math.sin(partAngle) * partDist;
      bot.angle = Math.atan2(targetPy - bot.y, targetPx - bot.x);
    } else {
      bot.angle = Math.atan2(boss.y - bot.y, boss.x - bot.x);
    }
    game.firePlayerWeapon(bot);
  }
}
