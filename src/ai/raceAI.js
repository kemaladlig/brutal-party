// Brutal Race: AI Bot Logic Controller
// Calculates waypoint tracking, checkpoint navigation, hazard avoidance (oil slicks),
// boost pad targeting, drafting/slipstream alignment, and tactical Nitro/EMP usage.

export class RaceAI {
  constructor(game) {
    this.game = game;
    this.reactionTimer = [0, 0, 0, 0];
  }

  update(dt) {
    for (let i = 0; i < 4; i++) {
      this.reactionTimer[i] = (this.reactionTimer[i] || 0) + dt;
    }
  }

  getBotMovement(slotIndex) {
    const p = this.game.players[slotIndex];
    if (!p || !p.isJoined || !p.isAlive) {
      return { x: 0, y: 0, active: false };
    }

    const isGod = p.slotType === 'bot_god';
    const targetCP = this.game.checkpoints[p.nextCheckpoint];
    if (!targetCP) {
      return { x: 0, y: 0, active: false };
    }

    let targetX = targetCP.x;
    let targetY = targetCP.y;

    if (!isGod) {
      targetX += Math.sin(performance.now() * 0.002 + slotIndex) * 15;
      targetY += Math.cos(performance.now() * 0.002 + slotIndex) * 15;
    }

    // Slipstream Drafting: If trailing behind another racer, align slightly behind them for draft boost
    this.game.players.forEach((other) => {
      if (other.index === p.index || !other.isJoined) return;
      const distToOther = Math.hypot(other.x - p.x, other.y - p.y);
      if (distToOther > 25 && distToOther < 85) {
        // Pull slightly towards other racer's tail for slipstream
        targetX = other.x * 0.4 + targetX * 0.6;
        targetY = other.y * 0.4 + targetY * 0.6;
      }
    });

    // Nitro pad attraction if nearby
    this.game.nitroPads.forEach((pad) => {
      const distToPad = Math.hypot(pad.x - p.x, pad.y - p.y);
      if (distToPad < 110) {
        targetX = pad.x * 0.7 + targetX * 0.3;
        targetY = pad.y * 0.7 + targetY * 0.3;
      }
    });

    let dx = targetX - p.x;
    let dy = targetY - p.y;
    let dist = Math.hypot(dx, dy);

    if (dist < 1) {
      return { x: 0, y: 0, active: false };
    }

    let dirX = dx / dist;
    let dirY = dy / dist;

    // Oil Slick Avoidance
    this.game.oilSlicks.forEach((slick) => {
      const distToSlick = Math.hypot(slick.x - p.x, slick.y - p.y);
      if (distToSlick < slick.radius + 35) {
        const avoidX = p.x - slick.x;
        const avoidY = p.y - slick.y;
        const avoidMag = Math.hypot(avoidX, avoidY);
        if (avoidMag > 0) {
          dirX += (avoidX / avoidMag) * 1.5;
          dirY += (avoidY / avoidMag) * 1.5;
        }
      }
    });

    // Wall Avoidance
    const a = this.game.arena;
    const margin = 40;

    if (p.x - margin < a.left) dirX += 0.8;
    if (p.x + margin > a.right) dirX -= 0.8;
    if (p.y - margin < a.top) dirY += 0.8;
    if (p.y + margin > a.bottom) dirY -= 0.8;

    const mag = Math.hypot(dirX, dirY);
    if (mag > 0) {
      dirX /= mag;
      dirY /= mag;
    }

    // Nitro / EMP Trigger Decision
    const angleToTarget = Math.atan2(dirY, dirX);
    let angleDiff = Math.abs(angleToTarget - p.angle);
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    angleDiff = Math.abs(angleDiff);

    if (dist > 140 && angleDiff < 0.35 && p.dashCooldown <= 0 && p.skidTimer <= 0) {
      if (isGod || Math.random() < 0.02) {
        this.game.triggerDash(slotIndex);
      }
    }

    return {
      x: dirX,
      y: dirY,
      active: true,
      magnitude: 1.0,
    };
  }
}
