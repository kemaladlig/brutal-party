// BRUTAL COLOSSUS — saf oyun tuning sözleşmeleri.
// DOM/Canvas bağımlılığı yoktur; motor, tester ve istatistikler aynı değerleri okur.

import { FIELD_THEMES } from '../core/fieldKit.js';

export const COLOSSUS_WEAPONS = Object.freeze({
  RIFLE: Object.freeze({
    id: 'RIFLE',
    kind: 'gun',
    damage: 3,
    fireInterval: 0.22,
    projectileSpeed: 680,
    range: 650,
    magazine: 24,
    reloadTime: 1.25,
    knockback: 15,
    stagger: 3,
    color: '#38BDF8',
    barrel: 'rifle',
  }),
  SHOTGUN: Object.freeze({
    id: 'SHOTGUN',
    kind: 'gun',
    damage: 2,
    pellets: 5,
    spread: 0.22,
    fireInterval: 0.68,
    projectileSpeed: 520,
    range: 260,
    magazine: 8,
    reloadTime: 1.45,
    knockback: 65,
    stagger: 9,
    color: '#F97316',
    barrel: 'shotgun',
  }),
  BLADE: Object.freeze({
    id: 'BLADE',
    kind: 'melee',
    damage: 8,
    fireInterval: 0.44,
    range: 150,
    arc: 3.4,
    magazine: Infinity,
    reloadTime: 0,
    knockback: 120,
    stagger: 18,
    swingTime: 0.22,
    color: '#A78BFA',
    barrel: 'blade',
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
export function getColossusMap() {
  return {
    id: 'titan_core',
    theme: FIELD_THEMES.foundry || FIELD_THEMES.reactor,
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
