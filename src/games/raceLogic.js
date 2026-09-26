// Pure Race tuning and standings math. Kept DOM-free for deterministic tests.

export const RACE_TUNING = Object.freeze({
  targetLaps: 3,
  targetScore: 2,
  roundTime: 90,
  roundTransition: 2.5,
  playerRadius: 19,
  // 190 → 215 (+%13). "RACE hala yavaş" geri bildirimi. Önceki turda dekorları
  // küçülttüğümü sandım; oysa araç hızı hiç değişmemişti — yavaşlık dekor
  // boyutundan değil, tempo değerinden geliyormuş. `propPx` dekoru, bu gövde
  // temposunu; ikisi ayrı ayarlar. İvme de hızla birlikte ölçeklendi ki
  // hızlansa da tepki süresi aynı kalsın.
  baseSpeed: 215,
  baseAcceleration: 470,
  dashSpeed: 365,
  dashAcceleration: 920,
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
