// BRUTAL COLOSSUS — saf oyun tuning sözleşmeleri.
// DOM/Canvas bağımlılığı yoktur; motor, tester ve istatistikler aynı değerleri okur.
//
// Tasarım: 1-4 oyunculu KOOPERATİF titan avı. Boss'un silah modülleri
// (parts) kırıldıkça hem saldırıları düşer hem de boss sersemler; takım
// modülleri kırıp açılan pencerede çekirdeği boşaltır. Tüm saldırılar
// okunabilir telegraph'la gelir (WINDUP_* → aktif → toparlanma).

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

// `disables`: modül kırıldığında düşen saldırı. AEGIS'in zırh plakası yalnız
// hasar cezasını kaldırır (saldırı düşürmez) — `armor: true` işaretiyle ayrılır.
export const COLOSSUS_BOSSES = Object.freeze({
  AEGIS: Object.freeze({
    id: 'AEGIS',
    name: 'AEGIS-01',
    titleKey: 'colossus.bossAegisTitle',
    theme: 'foundry',
    bodyShape: 'mech',
    baseHp: 130,
    hpPerPlayer: 45,
    radius: 84,
    speedP1: 44,
    speedP2: 56,
    speedP3: 72,
    hasShieldPhase: true,
    accentColor: UI_COLORS.colossusRifle,
    parts: Object.freeze([
      { id: 'cannon', nameKey: 'colossus.partCannon', maxHp: 34, angleOffset: -Math.PI / 2, distRatio: 0.65, radius: 22, disables: 'MORTAR' },
      { id: 'armorPlate', nameKey: 'colossus.partArmor', maxHp: 42, angleOffset: 0, distRatio: 0.72, radius: 24, armor: true, disables: null },
    ]),
  }),
  IGNIS: Object.freeze({
    id: 'IGNIS',
    name: 'IGNIS-V',
    titleKey: 'colossus.bossIgnisTitle',
    theme: 'foundry',
    bodyShape: 'scorpion',
    baseHp: 145,
    hpPerPlayer: 48,
    radius: 78,
    speedP1: 54,
    speedP2: 68,
    speedP3: 86,
    hasShieldPhase: true,
    accentColor: UI_COLORS.colossusIgnis,
    parts: Object.freeze([
      { id: 'stinger', nameKey: 'colossus.partStinger', maxHp: 36, angleOffset: Math.PI, distRatio: 0.88, radius: 22, disables: 'LASER' },
      { id: 'pincers', nameKey: 'colossus.partPincers', maxHp: 34, angleOffset: 0.35, distRatio: 0.74, radius: 24, disables: 'CHARGE' },
    ]),
  }),
  VOLT: Object.freeze({
    id: 'VOLT',
    name: 'VOLT-OMEGA',
    titleKey: 'colossus.bossVoltTitle',
    theme: 'reactor',
    bodyShape: 'nexus',
    baseHp: 125,
    hpPerPlayer: 44,
    radius: 74,
    speedP1: 48,
    speedP2: 62,
    speedP3: 80,
    hasShieldPhase: true,
    accentColor: UI_COLORS.colossusSniper,
    parts: Object.freeze([
      { id: 'coil', nameKey: 'colossus.partCoil', maxHp: 32, angleOffset: 0, distRatio: 0, radius: 24, disables: 'LASER' },
      { id: 'capacitors', nameKey: 'colossus.partCapacitors', maxHp: 30, angleOffset: Math.PI * 0.5, distRatio: 0.72, radius: 20, disables: 'STOMP' },
    ]),
  }),
});

export const COLOSSUS_TUNING = Object.freeze({
  MAX_HP: 5,
  PLAYER_RADIUS: 30,
  PLAYER_SPEED: 175,
  LEGIBILITY_PX: 12,

  // Boss temel gövde & sağlık
  BOSS_RADIUS: 82,
  BASE_HP: 130,
  HP_PER_EXTRA_PLAYER: 45,
  BOSS_SPEED_P1: 44,
  BOSS_SPEED_P2: 56,
  BOSS_SPEED_P3: 72,
  BOSS_ROTATION_SPEED: 1.5,

  // Aggro: boss hedefini bu süre kilitlemezse her kare döner, sırtına
  // dolanma imkânsızlaşır. Kilit boyunca hedef sabit kalır.
  AGGRO_LOCK: 2.6,

  // Stagger mekaniği (Sersemletme)
  STAGGER_MAX: 100,
  STAGGER_DURATION: 3.4,
  PILLAR_STAGGER_BONUS: 60,

  // Zırh ve zayıf nokta
  ARMOR_DAMAGE_SCALE: 0.18,
  CORE_ARC: Math.PI * 0.6, // ~108 derece arka koni

  // Oyuncu yetenekleri
  DASH_COOLDOWN: 3.2,
  DASH_DURATION: 0.22,
  DASH_SPEED: 470,
  REVIVE_DURATION: 1.8,
  REVIVE_RADIUS: 56,

  // Faz geçiş eşikleri
  PHASE_2_HP_RATIO: 0.65,
  PHASE_3_HP_RATIO: 0.30,

  // Deprem dalgası (Quake)
  STOMP_COOLDOWN: 5.0,
  STOMP_WINDUP: 0.85,
  STOMP_DAMAGE: 1,
  STOMP_RING_SPEED: 300,
  STOMP_MAX_RADIUS: 420,

  // Tarayıcı ışın (Beam Sweep): izle → kilit → ateş
  LASER_COOLDOWN: 6.6,
  LASER_TRACK_TIME: 1.15,
  LASER_LOCK_TIME: 0.35,
  LASER_FIRE_TIME: 0.7,
  LASER_DAMAGE: 1,
  LASER_TICK: 0.35,
  LASER_BEAM_WIDTH: 22,

  // Havan barajı
  MORTAR_COOLDOWN: 6.0,
  MORTAR_WINDUP: 0.5,
  MORTAR_FUSE: 1.5,
  MORTAR_RADIUS: 54,
  MORTAR_DAMAGE: 2,

  // Hücum (Charge)
  CHARGE_COOLDOWN: 7.0,
  CHARGE_WINDUP: 0.85,
  CHARGE_SPEED: 360,
  CHARGE_DURATION: 1.2,
  CHARGE_DAMAGE: 2,
  CHARGE_KNOCKBACK: 320,

  // Pilonlar (Faz 2 kalkanı — her boss)
  PYLON_HP: 32,
  PYLON_RADIUS: 24,

  // Sütunlar (Siperler)
  PILLAR_RADIUS: 34,
  PILLAR_HP: 4,

  // Otomatik şarjör yenileme
  AUTO_RELOAD_DELAY: 2.8,
});

/**
 * Harita ve saha yapılandırması. Her boss faz 2'de 2 pilon açar (kalkan
 * kırma hedefi ortak); sütun yerleşimi boss kimliğine göre değişir.
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
      pylonOffsets: [
        { x: -0.34, y: 0 },
        { x: 0.34, y: 0 },
      ],
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
      pylonOffsets: [
        { x: -0.30, y: 0.12 },
        { x: 0.30, y: 0.12 },
      ],
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
