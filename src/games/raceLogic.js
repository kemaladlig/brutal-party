// Pure Race tuning and standings math. Kept DOM-free for deterministic tests.

export const RACE_TUNING = Object.freeze({
  targetLaps: 3,
  targetScore: 2,
  roundTime: 90,
  // Raunt boşluğu artık `core/roundLifecycle.ROUND_GAP` tablosundan gelir
  // (`beginRound` varsayılanı); oyun başına ayrı değer tutulmaz.
  // 28 → 34 (FIELD_TIERS §normal bandı üstü, BOMB/CROWN seviyesi).
  // Mobilde araç tok ve heybetli (~23px boy / ~20px kanat) bir arcade mikro-racer
  // haline gelir; ekranda kaybolmaz ve yönü net okunur.
  playerRadius: 34,
  // 190 → 215 → hız 215'te sabit. "RACE hala yavaş" geri bildirimi ikinci kez
  // geldi ve bu sefer ölçüm gösterdi: hız zaten ortalamanın üstündeydi
  // (952/215 = 4.4sn, HORDE 5.6 / ARCHER 4.8). Yavaşlık hızdan değil İVMEDEN
  // geliyordu — 0 → maks 215/470 = 0.46sn, bir kaskad sonrası gaz tepkisi
  // yarım saniye sürüyordu. baseAcceleration 470 → 720 (0 → 0.30sn) ve
  // `dragRate` 3.7 → 2.8 (direksiyondan çekilince yavaşlaması) ile tepki
  // kısaltıldı; dash ivmesi de aynı yarıçap oranını koruyor.
  baseSpeed: 215,
  baseAcceleration: 720,
  dashSpeed: 365,
  dashAcceleration: 1180,
  dashDuration: 0.38,
  dashCooldown: 2.8,
  nitroCooldown: 2.8,
  nitroMaxEnergy: 100,
  nitroDrainRate: 38,
  nitroRechargeRate: 16,
  // Sürükleme katsayısı (1/sn, zaten `Math.exp(-rate*dt)` ile dt-duyarlı).
  // 3.7 → 2.8: gaz bırakıldığında araç eskisi kadar "yapışkan" değil, yani
  // virajdan çıkışta hızı koruyor. Skid sürüklemesi oranı korundu.
  dragRate: 2.8,
  skidDragRate: 1.0,
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
