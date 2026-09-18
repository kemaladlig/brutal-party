// Micro-Tanks: Bot AI with Shell Avoidance, Direct Line-of-Sight, Ricochet Calculation & Patrol

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

export function updateTankBotAI(game, tank, dt) {
  const isGod = tank.slotType === 'bot_god';
  const enemies = game.tanks.filter((t) => t.index !== tank.index && t.isJoined && t.isAlive);
  if (enemies.length === 0) {
    tank.isDriving = false;
    return;
  }

  // 1. Bullet avoidance reflex
  let mustDodge = false;
  for (const b of game.bullets) {
    if (b.owner === tank.index) continue;
    const dx = tank.x - b.x;
    const dy = tank.y - b.y;
    const dist = Math.hypot(dx, dy);

    if (dist < (isGod ? 120 : 80)) {
      const dot = (dx * b.vx + dy * b.vy) / (dist * Math.hypot(b.vx, b.vy) || 1);
      if (dot > 0.65) {
        mustDodge = true;
        break;
      }
    }
  }

  if (mustDodge) {
    tank.isDriving = true;
    return;
  }

  // 2. Aim and Fire Decision
  const canShoot =
    tank.reloadTimer <= 0 &&
    game.bullets.filter((b) => b.owner === tank.index).length < tank.maxBullets;

  if (canShoot) {
    let shouldFire = false;

    // A. Direct Line of Sight test
    for (const enemy of enemies) {
      const angleToEnemy = Math.atan2(enemy.y - tank.y, enemy.x - tank.x);
      const angleDiff = Math.abs(normalizeAngle(tank.angle - angleToEnemy));

      const tolerance = isGod ? 0.16 : 0.26;
      if (angleDiff < tolerance) {
        if (hasLineOfSight(game, tank.x, tank.y, enemy.x, enemy.y)) {
          shouldFire = true;
          break;
        }
      }
    }

    // B. If God Mode and no direct shot, check 1-bounce trick ricochet!
    if (!shouldFire && isGod) {
      shouldFire = checkRicochetShot(game, tank, enemies);
    }

    if (shouldFire) {
      tank.isDriving = false;
      game.attemptFire(tank);
      return;
    }
  }

  // 3. Movement / Patrol decision
  tank.botPatrolTimer = (tank.botPatrolTimer || 0) - dt;
  if (tank.botPatrolTimer <= 0) {
    tank.botPatrolTimer = 1.0 + Math.random() * 1.5;
    tank.botWantsDrive = Math.random() < (isGod ? 0.65 : 0.45);
  }

  const forwardX = tank.x + Math.cos(tank.angle) * 38;
  const forwardY = tank.y + Math.sin(tank.angle) * 38;
  const isWallAhead = game.checkTankCollision(forwardX, forwardY, tank.size / 2);

  if (isWallAhead) {
    tank.isDriving = false;
  } else {
    tank.isDriving = Boolean(tank.botWantsDrive);
  }
}
