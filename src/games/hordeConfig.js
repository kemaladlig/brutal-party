// BRUTAL HORDE — saf oyun tuning sözleşmeleri.
// DOM/Canvas bağımlılığı yoktur; motor, testler ve istatistikler aynı değerleri okur.

export const HORDE_WEAPONS = Object.freeze({
  SIDEARM: Object.freeze({
    id: 'SIDEARM',
    kind: 'gun',
    damage: 1,
    fireInterval: 0.28,
    pellets: 1,
    spread: 0.025,
    projectileSpeed: 520,
    range: 460,
    magazine: 12,
    reloadTime: 1.05,
    knockback: 35,
    pierce: 0,
    color: '#D84727',
    barrel: 'sidearm',
  }),
  SMG: Object.freeze({
    id: 'SMG',
    kind: 'gun',
    damage: 1,
    fireInterval: 0.105,
    pellets: 1,
    spread: 0.075,
    projectileSpeed: 560,
    range: 340,
    magazine: 32,
    reloadTime: 1.35,
    knockback: 22,
    pierce: 0,
    color: '#FACC15',
    barrel: 'smg',
  }),
  SHOTGUN: Object.freeze({
    id: 'SHOTGUN',
    kind: 'gun',
    damage: 1,
    fireInterval: 0.72,
    pellets: 6,
    spread: 0.22,
    projectileSpeed: 430,
    range: 230,
    magazine: 6,
    reloadTime: 1.7,
    knockback: 110,
    pierce: 0,
    color: '#F97316',
    barrel: 'shotgun',
  }),
  RIFLE: Object.freeze({
    id: 'RIFLE',
    kind: 'gun',
    damage: 3,
    fireInterval: 0.58,
    pellets: 1,
    spread: 0.012,
    projectileSpeed: 760,
    range: 760,
    magazine: 5,
    reloadTime: 1.55,
    knockback: 70,
    pierce: 1,
    color: '#38BDF8',
    barrel: 'rifle',
  }),
  BLADE: Object.freeze({
    id: 'BLADE',
    kind: 'melee',
    damage: 4,
    fireInterval: 0.48,
    range: 78,
    arc: 1.45,
    magazine: Infinity,
    reloadTime: 0,
    knockback: 150,
    color: '#A78BFA',
    barrel: 'blade',
  }),
});

export const HORDE_ARMORY_WEAPONS = Object.freeze(['SMG', 'SHOTGUN', 'RIFLE', 'BLADE']);

export const HORDE_UPGRADES = Object.freeze({
  ARMOR: Object.freeze({ id: 'ARMOR', icon: 'shield', color: '#0891B2' }),
  QUICK_RELOAD: Object.freeze({ id: 'QUICK_RELOAD', icon: 'rotate_cw', color: '#CA8A04' }),
  SERVO: Object.freeze({ id: 'SERVO', icon: 'zap', color: '#D84727' }),
  FIELD_MEDIC: Object.freeze({ id: 'FIELD_MEDIC', icon: 'sparkles', color: '#2D6A4F' }),
  MAGNET: Object.freeze({ id: 'MAGNET', icon: 'target', color: '#7C3AED' }),
});

export const HORDE_UPGRADE_IDS = Object.freeze(Object.keys(HORDE_UPGRADES));

export const HORDE_MAPS = Object.freeze([
  Object.freeze({
    id: 'foundry',
    layout: 'pillars',
    nameKey: 'horde.map.foundry',
    floor: '#F1EEE7',
    grid: 'rgba(26, 26, 26, 0.075)',
    accent: '#D84727',
    motif: 'foundry',
  }),
  Object.freeze({
    id: 'reactor',
    layout: 'crossfire',
    nameKey: 'horde.map.reactor',
    floor: '#E9F1F3',
    grid: 'rgba(14, 116, 144, 0.10)',
    accent: '#0891B2',
    motif: 'reactor',
  }),
  Object.freeze({
    id: 'core',
    layout: 'courtyard',
    nameKey: 'horde.map.core',
    floor: '#EEEAF5',
    grid: 'rgba(91, 33, 182, 0.10)',
    accent: '#7C3AED',
    motif: 'core',
  }),
]);

export function getHordeMap(round) {
  return HORDE_MAPS[Math.max(0, Math.min(HORDE_MAPS.length - 1, (Number(round) || 1) - 1))];
}

export function getPlayerWeapon(player) {
  return HORDE_WEAPONS[player?.weaponId] || HORDE_WEAPONS.SIDEARM;
}

function upgradeCount(player, id) {
  return Math.max(0, Number(player?.upgrades?.[id]) || 0);
}

export function getReloadTime(player) {
  const weapon = getPlayerWeapon(player);
  if (!Number.isFinite(weapon.reloadTime)) return 0;
  return weapon.reloadTime * Math.pow(0.78, upgradeCount(player, 'QUICK_RELOAD'));
}

export function getDashCooldown(player, baseCooldown) {
  return baseCooldown * Math.pow(0.8, upgradeCount(player, 'SERVO'));
}

export function getReviveDuration(player, baseDuration) {
  return baseDuration * Math.pow(0.75, upgradeCount(player, 'FIELD_MEDIC'));
}

export function getPickupMagnet(player) {
  return 1 + 0.5 * upgradeCount(player, 'MAGNET');
}
