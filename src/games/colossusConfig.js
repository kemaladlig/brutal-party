// BRUTAL COLOSSUS — saf oyun tuning sözleşmeleri.
// DOM/Canvas bağımlılığı yoktur; motor, tester ve istatistikler aynı değerleri okur.

import { FIELD_THEMES } from '../core/fieldKit.js';
import { UI_COLORS } from '../ui/tokens.js';

export const COLOSSUS_WEAPONS = Object.freeze({
  RIFLE: Object.freeze({
    id: 'RIFLE',
    nameKey: 'colossus.weaponRifle',
    icon: 'rifle',
    kind: 'gun',
    damage: 3,
    fireInterval: 0.22,
    projectileSpeed: 680,
    range: 650,
    magazine: 24,
    reloadTime: 1.25,
    knockback: 15,
    stagger: 3,
    color: UI_COLORS.colossusRifle,
    barrel: 'rifle',
  }),
  SHOTGUN: Object.freeze({
    id: 'SHOTGUN',
    nameKey: 'colossus.weaponShotgun',
    icon: 'shotgun',
    kind: 'gun',
    damage: 2,
    pellets: 5,
    spread: 0.22,
    fireInterval: 0.68,
    projectileSpeed: 520,
    range: 280,
    magazine: 8,
    reloadTime: 1.45,
    knockback: 65,
    stagger: 9,
    color: UI_COLORS.colossusShotgun,
    barrel: 'shotgun',
  }),
  SNIPER: Object.freeze({
    id: 'SNIPER',
    nameKey: 'colossus.weaponSniper',
    icon: 'crosshair',
    kind: 'gun',
    damage: 12,
    fireInterval: 1.05,
    projectileSpeed: 950,
    range: 850,
    magazine: 5,
    reloadTime: 1.6,
    knockback: 40,
    stagger: 18,
    color: UI_COLORS.colossusSniper,
    barrel: 'sniper',
  }),
  PLASMA: Object.freeze({
    id: 'PLASMA',
    nameKey: 'colossus.weaponPlasma',
    icon: 'zap',
    kind: 'gun',
    damage: 7,
    aoeRadius: 42,
    fireInterval: 0.85,
    projectileSpeed: 460,
    range: 520,
    magazine: 6,
    reloadTime: 1.5,
    knockback: 60,
    stagger: 14,
    color: UI_COLORS.colossusPlasma,
    barrel: 'plasma',
  }),
});

export const COLOSSUS_BOSSES = Object.freeze({
  AEGIS: Object.freeze({
    id: 'AEGIS',
    name: 'AEGIS-01',
    titleKey: 'colossus.bossAegisTitle',
    theme: 'foundry',
    bodyShape: 'mech',
    baseHp: 180,
    hpPerPlayer: 60,
    radius: 84,
    speedP1: 48,
    speedP2: 58,
    speedP3: 75,
    hasShieldPhase: true,
    accentColor: UI_COLORS.colossusRifle,
    parts: Object.freeze([
      { id: 'cannon', nameKey: 'colossus.partCannon', maxHp: 35, angleOffset: -Math.PI / 2, distRatio: 0.65, radius: 22 },
      { id: 'armorPlate', nameKey: 'colossus.partArmor', maxHp: 45, angleOffset: 0, distRatio: 0.72, radius: 24 },
    ]),
  }),
  IGNIS: Object.freeze({
    id: 'IGNIS',
    name: 'IGNIS-V',
    titleKey: 'colossus.bossIgnisTitle',
    theme: 'foundry',
    bodyShape: 'scorpion',
    baseHp: 200,
    hpPerPlayer: 65,
    radius: 78,
    speedP1: 60,
    speedP2: 76,
    speedP3: 94,
    hasShieldPhase: false,
    accentColor: UI_COLORS.colossusIgnis,
    parts: Object.freeze([
      { id: 'stinger', nameKey: 'colossus.partStinger', maxHp: 38, angleOffset: Math.PI, distRatio: 0.88, radius: 22 },
      { id: 'pincers', nameKey: 'colossus.partPincers', maxHp: 34, angleOffset: 0.35, distRatio: 0.74, radius: 24 },
    ]),
  }),
  VOLT: Object.freeze({
    id: 'VOLT',
    name: 'VOLT-OMEGA',
    titleKey: 'colossus.bossVoltTitle',
    theme: 'reactor',
    bodyShape: 'nexus',
    baseHp: 170,
    hpPerPlayer: 55,
    radius: 74,
    speedP1: 52,
    speedP2: 68,
    speedP3: 86,
    hasShieldPhase: false,
    accentColor: UI_COLORS.colossusSniper,
    parts: Object.freeze([
      { id: 'coil', nameKey: 'colossus.partCoil', maxHp: 32, angleOffset: 0, distRatio: 0, radius: 24 },
      { id: 'capacitors', nameKey: 'colossus.partCapacitors', maxHp: 30, angleOffset: Math.PI * 0.5, distRatio: 0.72, radius: 20 },
    ]),
  }),
});

export const COLOSSUS_TUNING = Object.freeze({
  MAX_HP: 5,
  PLAYER_RADIUS: 30,
  PLAYER_SPEED: 165,
  LEGIBILITY_PX: 12,

  // Boss temel gövde & sağlık
  BOSS_RADIUS: 82,
  BASE_HP: 160,
  HP_PER_EXTRA_PLAYER: 50,
  BOSS_SPEED_P1: 46,
  BOSS_SPEED_P2: 56,
  BOSS_SPEED_P3: 72,
  BOSS_ROTATION_SPEED: 1.4,

  // Stagger mekaniği (Sersemletme)
  STAGGER_MAX: 100,
  STAGGER_DURATION: 3.6,
  PILLAR_STAGGER_BONUS: 40,

  // Zırh ve zayıf nokta
  ARMOR_DAMAGE_SCALE: 0.15,
  CORE_ARC: Math.PI * 0.55, // ~100 derece arka koni

  // Oyuncu yetenekleri
  DASH_COOLDOWN: 3.5,
  DASH_DURATION: 0.22,
  DASH_SPEED: 460,
  REVIVE_DURATION: 2.0,
  REVIVE_RADIUS: 52,

  // Faz geçiş eşikleri
  PHASE_2_HP_RATIO: 0.65,
  PHASE_3_HP_RATIO: 0.30,

  // Saldırı telegrafları & süreleri
  STOMP_COOLDOWN: 5.5,
  STOMP_WINDUP: 0.85,
  STOMP_DAMAGE: 1,
  STOMP_RING_SPEED: 260,
  STOMP_MAX_RADIUS: 390,

  LASER_COOLDOWN: 6.8,
  LASER_TRACK_TIME: 1.25,
  LASER_LOCK_TIME: 0.35,
  LASER_FIRE_TIME: 0.75,
  LASER_DAMAGE: 2,
  LASER_BEAM_WIDTH: 22,

  MORTAR_COOLDOWN: 5.8,
  MORTAR_FUSE: 1.4,
  MORTAR_RADIUS: 52,
  MORTAR_DAMAGE: 2,

  CHARGE_WINDUP: 0.9,
  CHARGE_SPEED: 320,
  CHARGE_DURATION: 1.3,
  CHARGE_DAMAGE: 2,

  // Pilonlar (Faz 2)
  PYLON_HP: 35,
  PYLON_RADIUS: 24,

  // Sütunlar (Siperler)
  PILLAR_RADIUS: 34,
  PILLAR_HP: 4,

  // Otomatik şarjör yenileme
  AUTO_RELOAD_DELAY: 2.8,
});

/**
 * Harita ve saha yapılandırması
 */
export function getColossusMap(bossId = 'AEGIS') {
  if (bossId === 'VOLT') {
    return {
      id: 'volt_core',
      theme: FIELD_THEMES.reactor,
      pillarOffsets: [
        { x: -0.28, y: -0.25 },
        { x: 0.28, y: -0.25 },
        { x: -0.28, y: 0.25 },
        { x: 0.28, y: 0.25 },
      ],
      pylonOffsets: [],
    };
  }
  if (bossId === 'IGNIS') {
    return {
      id: 'ignis_core',
      theme: FIELD_THEMES.foundry,
      pillarOffsets: [
        { x: -0.32, y: -0.24 },
        { x: 0.32, y: -0.24 },
        { x: 0, y: 0.28 },
      ],
      pylonOffsets: [],
    };
  }
  return {
    id: 'titan_core',
    theme: FIELD_THEMES.foundry,
    pillarOffsets: [
      { x: -0.30, y: -0.28 },
      { x: 0.30, y: -0.28 },
      { x: -0.30, y: 0.28 },
      { x: 0.30, y: 0.28 },
    ],
    pylonOffsets: [
      { x: 0, y: -0.36 },
      { x: 0, y: 0.36 },
    ],
  };
}
