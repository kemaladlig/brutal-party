// Micro-Tanks: Bot AI with Shell Avoidance, Direct Line-of-Sight, Ricochet Calculation & Patrol
import { fieldPx, fieldSpeed } from '../core/playfield.js';

export function normalizeAngle(angle) {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function lineIntersectsRect(x1, y1, x2, y2, r) {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);

  if (maxX < r.x || minX > r.x + r.w || maxY < r.y || minY > r.y + r.h) return false;
  return true;
}

export function hasLineOfSight(game, x1, y1, x2, y2) {
  for (const obs of game.obstacles) {
    if (lineIntersectsRect(x1, y1, x2, y2, obs)) {
      return false;
    }
  }
  return true;
}

export function checkRicochetShot(game, tank, enemies) {
  const dirX = Math.cos(tank.angle);
  const dirY = Math.sin(tank.angle);
  let hitPoint = null;
  let normal = null;
  let shortestDist = 999;

  if (dirX > 0) {
    const d = (game.arena.right - tank.x) / dirX;
    if (d > 0 && d < shortestDist) {
      shortestDist = d;
      hitPoint = { x: game.arena.right, y: tank.y + dirY * d };
      normal = { x: -1, y: 0 };
    }
  } else if (dirX < 0) {
    const d = (game.arena.left - tank.x) / dirX;
    if (d > 0 && d < shortestDist) {
      shortestDist = d;
      hitPoint = { x: game.arena.left, y: tank.y + dirY * d };
      normal = { x: 1, y: 0 };
    }
  }

  if (dirY > 0) {
    const d = (game.arena.bottom - tank.y) / dirY;
    if (d > 0 && d < shortestDist) {
      shortestDist = d;
      hitPoint = { x: tank.x + dirX * d, y: game.arena.bottom };
      normal = { x: 0, y: -1 };
    }
  } else if (dirY < 0) {
    const d = (game.arena.top - tank.y) / dirY;
    if (d > 0 && d < shortestDist) {
      shortestDist = d;
      hitPoint = { x: tank.x + dirX * d, y: game.arena.top };
      normal = { x: 0, y: 1 };
    }
  }

  if (!hitPoint || !normal) return false;
  if (!hasLineOfSight(game, tank.x, tank.y, hitPoint.x, hitPoint.y)) return false;

  const dot = dirX * normal.x + dirY * normal.y;
  const rx = dirX - 2 * dot * normal.x;
  const ry = dirY - 2 * dot * normal.y;

  for (const enemy of enemies) {
    const edx = enemy.x - hitPoint.x;
    const edy = enemy.y - hitPoint.y;
    const angleToEnemy = Math.atan2(edy, edx);
    const rayAngle = Math.atan2(ry, rx);
    if (Math.abs(normalizeAngle(rayAngle - angleToEnemy)) < 0.22) {
      if (hasLineOfSight(game, hitPoint.x, hitPoint.y, enemy.x, enemy.y)) {
        return true;
      }
    }
  }
  return false;
}

// Kademe parametreleri: NORMAL yarışçı-adil, GOD neredeyse yenilmez.
const TIER = {
  bot_normal: {
    dodgeRadius: 80, dodgeDot: 0.75, aimTolerance: 0.30, lead: false,
    aimHold: 0.30, thinkMin: 0.30, thinkMax: 0.60, driveChance: 0.45,
    alignTol: 0.55, panicChance: 0.25, crateSeek: false, focusLeader: false,
    ricochet: false, minShotGap: 0.45,
  },
  bot_god: {
    dodgeRadius: 130, dodgeDot: 0.55, aimTolerance: 0.14, lead: true,
    aimHold: 0.0, thinkMin: 0.12, thinkMax: 0.25, driveChance: 0.65,
    alignTol: 0.15, panicChance: 0.0, crateSeek: true, focusLeader: true,
    ricochet: true, minShotGap: 0.0,
  },
};

const BULLET_SPEED = 440;

function estimateVelocity(game, t) {
  if (!t.isDriving) return { x: 0, y: 0 };
  // `t.driveSpeed` motor tarafında ZATEN `fieldSpeed` ile ölçeklenmiş —
  // tekrar sarmalamak çift ölçeklerdi. Buradaki sabitler ölçeklenmemişti.
  const spd = t.turboTimer > 0
    ? fieldSpeed(game.arena, 285)
    : (game.roundTimer > 35 ? fieldSpeed(game.arena, 220) : (t.driveSpeed || fieldSpeed(game.arena, 175)));
  return { x: Math.cos(t.angle) * spd, y: Math.sin(t.angle) * spd };
}

function pickTarget(game, tank, enemies, tier) {
  if (tier.focusLeader) {
    let best = null;
    let bestScore = -1;
    let bestDist = Infinity;
    for (const e of enemies) {
      const s = (game.scores && game.scores[e.index]) || 0;
      const d = Math.hypot(e.x - tank.x, e.y - tank.y);
      if (s > bestScore || (s === bestScore && d < bestDist)) {
        best = e;
        bestScore = s;
        bestDist = d;
      }
    }
    if (best) return best;
  }
  let best = enemies[0];
  let bestDist = Infinity;
  for (const e of enemies) {
    const d = Math.hypot(e.x - tank.x, e.y - tank.y);
    if (d < bestDist) {
      best = e;
      bestDist = d;
    }
  }
  return best;
}

export function updateTankBotAI(game, tank, dt) {
  const P = TIER[tank.slotType] || TIER.bot_normal;
  const isGod = tank.slotType === 'bot_god';
  const enemies = game.tanks.filter((t) => t.index !== tank.index && t.isJoined && t.isAlive);
  if (enemies.length === 0) {
    tank.isDriving = false;
    return;
  }

  // 1. Bullet avoidance: mermiye kafa kafaya sürme, yandan kaç
  for (const b of game.bullets) {
    if (b.owner === tank.index) continue;
    const dx = tank.x - b.x;
    const dy = tank.y - b.y;
    const dist = Math.hypot(dx, dy);
    // Kaçış yarıçapı saha ile ölçeklenir: sabit 80/130px telefonda saha
    // kısa kenarının %21/%34'üydü (masaüstü %8.4/%13.7) — bot telefonda
    // neredeyse her mermiyi "yaklaşan tehdit" sanıp kaçıyordu.
    if (dist > fieldPx(game.arena, P.dodgeRadius)) continue;
    const bSpd = Math.hypot(b.vx, b.vy) || 1;
    const dot = (dx * b.vx + dy * b.vy) / (dist * bSpd);
    if (dot < P.dodgeDot) continue;
    // Mermi buruna geliyorsa dur (kafa kafaya sürme), değilse ileri kaç
    const toBullet = Math.atan2(-dy, -dx);
    const headOn = Math.abs(normalizeAngle(tank.angle - toBullet)) < 0.5;
    if (!headOn || Math.random() < P.panicChance) {
      tank.isDriving = !headOn;
    } else {
      tank.isDriving = false;
    }
    return;
  }

  const target = pickTarget(game, tank, enemies, P);

  // 2. Aim & fire: god önleme (leading) atar, normal anlık konuma + bekleyerek
  const canShoot =
    tank.reloadTimer <= 0 &&
    game.bullets.filter((b) => b.owner === tank.index).length < tank.maxBullets;

  tank.botAimHold = tank.botAimHold || 0;
  tank.botLastShot = tank.botLastShot || 0;
  tank.botClock = (tank.botClock || 0) + dt;

  if (canShoot && target) {
    let ax = target.x;
    let ay = target.y;
    if (P.lead) {
      const dist = Math.hypot(ax - tank.x, ay - tank.y);
      // Mermi uçuş süresi: gerçek mermi hızı motor tarafından sahayla
      // birlikte ölçeklenir, öngörü de aynı ölçekte olmalı yoksa bot
      // telefonla masaüstünde farklı nişan alır.
      const flight = dist / fieldSpeed(game.arena, BULLET_SPEED);
      const ev = estimateVelocity(game, target);
      ax += ev.x * flight;
      ay += ev.y * flight;
    }
    const angleToAim = Math.atan2(ay - tank.y, ax - tank.x);
    const angleDiff = Math.abs(normalizeAngle(tank.angle - angleToAim));
    if (angleDiff < P.aimTolerance && hasLineOfSight(game, tank.x, tank.y, ax, ay)) {
      tank.botAimHold += dt;
      const gapOk = tank.botClock - tank.botLastShot >= P.minShotGap;
      if (tank.botAimHold >= P.aimHold && gapOk) {
        tank.botAimHold = 0;
        tank.botLastShot = tank.botClock;
        tank.isDriving = false;
        game.attemptFire(tank);
        return;
      }
    } else {
      tank.botAimHold = 0;
      // God: direkt yoksa sekerek vurmayı dene
      if (P.ricochet && checkRicochetShot(game, tank, enemies)) {
        tank.isDriving = false;
        game.attemptFire(tank);
        return;
      }
    }
  } else {
    tank.botAimHold = 0;
  }

  // 3. Directed movement: hedef noktaya dön-hizalan-sür (botun direksiyonu budur)
  tank.botThinkT = (tank.botThinkT ?? 0) - dt;
  if (tank.botThinkT <= 0 || !tank.botWaypoint) {
    tank.botThinkT = P.thinkMin + Math.random() * (P.thinkMax - P.thinkMin);
    const m = tank.size || 20;
    // God: yakın kasaya git, yoksa merkeze yakın rastgele nokta
    let wx = 0;
    let wy = 0;
    let hasGoal = false;
    if (P.crateSeek && Array.isArray(game.crates) && game.crates.length) {
      let bestC = null;
      let bestD = 260;
      for (const c of game.crates) {
        const d = Math.hypot(c.x - tank.x, c.y - tank.y);
        if (d < bestD) {
          bestD = d;
          bestC = c;
        }
      }
      if (bestC) {
        wx = bestC.x;
        wy = bestC.y;
        hasGoal = true;
      }
    }
    if (!hasGoal) {
      const { left, right, top, bottom } = game.arena;
      wx = left + m + Math.random() * Math.max(1, right - left - m * 2);
      wy = top + m + Math.random() * Math.max(1, bottom - top - m * 2);
    }
    tank.botWaypoint = { x: wx, y: wy };
    tank.botWantsDrive = Math.random() < P.driveChance;
  }

  const wp = tank.botWaypoint;
  const arrived =
    Math.hypot(wp.x - tank.x, wp.y - tank.y) < (tank.size || 20) * 1.2;
  if (arrived) tank.botThinkT = 0;

  // Aktif direksiyon: hedefe en kısa yönden dön (sabit spin'i beklemez).
  // update() içindeki otomatik spin bu kare atlanır (_aiSteered bayrağı).
  const angleToWp = Math.atan2(wp.y - tank.y, wp.x - tank.x);
  const steerDiff = normalizeAngle(angleToWp - tank.angle);
  const turnRate = (tank.rotationSpeed || 2.8) * dt * (isGod ? 1.5 : 1.0);
  tank._aiSteered = false;
  if (!arrived && Math.abs(steerDiff) > 0.06) {
    tank.angle += Math.sign(steerDiff) * Math.min(Math.abs(steerDiff), turnRate);
    tank._aiSteered = true;
  }

  const wpDiff = Math.abs(normalizeAngle(tank.angle - angleToWp));
  const forwardX = tank.x + Math.cos(tank.angle) * 38;
  const forwardY = tank.y + Math.sin(tank.angle) * 38;
  const isWallAhead = game.checkTankCollision(forwardX, forwardY, tank.size / 2);

  if (isWallAhead) {
    // Duvara dayanma: yeni hedef seç, duvara bakmıyorsa yavaşça ilerle
    tank.botThinkT = 0;
    tank.isDriving = Math.abs(steerDiff) < 1.2;
  } else if (wpDiff > P.alignTol || !tank.botWantsDrive) {
    tank.isDriving = false;
  } else {
    tank.isDriving = true;
  }
}
