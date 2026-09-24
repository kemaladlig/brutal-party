// Brutal Race bot decisions: checkpoint pursuit, draft alignment, nitro targeting,
// oil/spinner avoidance and rate-limited dash usage.

import { distToSegmentSquared, normalizeAngle } from '../core/physics2d.js';

const DECISION_MIN = 0.35;
const DECISION_MAX = 0.6;

export class RaceAI {
  constructor(game) {
    this.game = game;
    this.elapsed = 0;
    this.decisionTimer = [0, 0, 0, 0];
    this.reset();
  }

  reset() {
    this.elapsed = 0;
    this.resetRound();
  }

  resetRound() {
    this.decisionTimer = [0.18, 0.28, 0.38, 0.48];
  }

  update(dt) {
    this.elapsed += dt;
    for (let index = 0; index < this.decisionTimer.length; index++) {
      this.decisionTimer[index] = Math.max(0, this.decisionTimer[index] - dt);
    }
  }

  getBotMovement(slotIndex) {
    const player = this.game.players[slotIndex];
    if (!player || !player.isJoined || !player.isAlive) {
      return { x: 0, y: 0, active: false, magnitude: 0 };
    }

    const targetCheckpoint = this.game.checkpoints[player.nextCheckpoint];
    if (!targetCheckpoint) return { x: 0, y: 0, active: false, magnitude: 0 };

    const isGod = player.slotType === 'bot_god';
    let targetX = targetCheckpoint.x;
    let targetY = targetCheckpoint.y;
    if (!isGod) {
      targetX += Math.sin(this.elapsed * 2 + slotIndex) * 15;
      targetY += Math.cos(this.elapsed * 2 + slotIndex) * 15;
    }

    const playerProgress = this.game.getPlayerProgress(player);
    for (const other of this.game.players) {
      if (other.index === player.index || !other.isJoined) continue;
      if (this.game.getPlayerProgress(other) <= playerProgress + 0.05) continue;
      const distance = Math.hypot(other.x - player.x, other.y - player.y);
      if (distance <= 25 || distance >= 85) continue;
      targetX = other.x * 0.4 + targetX * 0.6;
      targetY = other.y * 0.4 + targetY * 0.6;
    }

    const checkpointAngle = Math.atan2(targetY - player.y, targetX - player.x);
    for (const pad of this.game.nitroPads) {
      const dx = pad.x - player.x;
      const dy = pad.y - player.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= 1 || distance >= 105) continue;
      const angleToPad = Math.atan2(dy, dx);
      if (Math.abs(normalizeAngle(angleToPad - checkpointAngle)) > 0.9) continue;
      targetX = pad.x * 0.72 + targetX * 0.28;
      targetY = pad.y * 0.72 + targetY * 0.28;
    }

    let directionX = targetX - player.x;
    let directionY = targetY - player.y;
    const targetDistance = Math.hypot(directionX, directionY);
    if (targetDistance < 1) return { x: 0, y: 0, active: false, magnitude: 0 };
    directionX /= targetDistance;
    directionY /= targetDistance;

    for (const slick of this.game.oilSlicks) {
      const distance = Math.hypot(slick.x - player.x, slick.y - player.y);
      if (distance >= slick.radius + 35) continue;
      const avoidX = player.x - slick.x;
      const avoidY = player.y - slick.y;
      const avoidMagnitude = Math.hypot(avoidX, avoidY);
      if (avoidMagnitude <= 0) continue;
      directionX += (avoidX / avoidMagnitude) * 1.5;
      directionY += (avoidY / avoidMagnitude) * 1.5;
    }

    for (const spinner of this.game.obstacleSpinners) {
      const halfLength = spinner.length / 2;
      const endAx = spinner.x - Math.cos(spinner.angle) * halfLength;
      const endAy = spinner.y - Math.sin(spinner.angle) * halfLength;
      const endBx = spinner.x + Math.cos(spinner.angle) * halfLength;
      const endBy = spinner.y + Math.sin(spinner.angle) * halfLength;
      const closestX = (endAx + endBx) / 2;
      const closestY = (endAy + endBy) / 2;
      const distanceSquared = distToSegmentSquared(
        player.x,
        player.y,
        endAx,
        endAy,
        endBx,
        endBy,
      );
      if (distanceSquared >= 48 * 48) continue;
      const avoidX = player.x - closestX;
      const avoidY = player.y - closestY;
      const avoidMagnitude = Math.hypot(avoidX, avoidY) || 1;
      directionX += (avoidX / avoidMagnitude) * 2.2;
      directionY += (avoidY / avoidMagnitude) * 2.2;
    }

    const arena = this.game.arena;
    const margin = 40;
    if (player.x - margin < arena.left) directionX += 0.8;
    if (player.x + margin > arena.right) directionX -= 0.8;
    if (player.y - margin < arena.top) directionY += 0.8;
    if (player.y + margin > arena.bottom) directionY -= 0.8;

    const magnitude = Math.hypot(directionX, directionY);
    if (magnitude > 0) {
      directionX /= magnitude;
      directionY /= magnitude;
    }

    if (this.decisionTimer[slotIndex] <= 0) {
      this.decisionTimer[slotIndex] = DECISION_MIN + Math.random() * (DECISION_MAX - DECISION_MIN);
      const targetAngle = Math.atan2(directionY, directionX);
      const aligned = Math.abs(normalizeAngle(targetAngle - player.angle)) < 0.35;
      const canDash = player.dashCooldown <= 0
        && player.skidTimer <= 0
        && player.empDisruptedTimer <= 0;
      if (targetDistance > 140 && aligned && canDash && (isGod || Math.random() < 0.22)) {
        this.game.triggerDash(slotIndex);
      }
    }

    return {
      x: directionX,
      y: directionY,
      active: true,
      magnitude: 1,
    };
  }
}
