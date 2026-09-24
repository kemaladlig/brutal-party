// Pure Race tuning and standings math. Kept DOM-free for deterministic tests.

export const RACE_TUNING = Object.freeze({
  targetLaps: 3,
  targetScore: 2,
  roundTime: 90,
  roundTransition: 2.5,
  playerRadius: 16,
  baseSpeed: 190,
  baseAcceleration: 420,
  dashSpeed: 330,
  dashAcceleration: 850,
  dashDuration: 0.38,
  dashCooldown: 2.8,
  jumpVelocity: 30,
  jumpGravity: 42,
  jumpClearance: 7.5,
  nitroDuration: 0.75,
  empDuration: 1.2,
  empMaxRadius: 130,
  empSpeed: 240,
  progressTieEpsilon: 0.002,
});

export function getSegmentProgress(player, checkpoints) {
  if (!player || !Array.isArray(checkpoints) || checkpoints.length === 0) return 0;
  const target = checkpoints[player.nextCheckpoint];
  if (!target) return 0;

  const previousIndex = (player.nextCheckpoint - 1 + checkpoints.length) % checkpoints.length;
  const previous = checkpoints[previousIndex];
  const segmentLength = Math.hypot(target.x - previous.x, target.y - previous.y);
  if (segmentLength <= 0) return 0;

  const distanceToTarget = Math.hypot(player.x - target.x, player.y - target.y);
  return Math.max(0, Math.min(1, 1 - distanceToTarget / segmentLength));
}

export function getRaceProgress(player, checkpoints) {
  const count = Array.isArray(checkpoints) ? checkpoints.length : 3;
  return (player?.laps || 0) * count
    + (player?.nextCheckpoint || 0)
    + getSegmentProgress(player, checkpoints);
}
