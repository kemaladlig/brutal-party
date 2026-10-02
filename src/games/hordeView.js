// BRUTAL HORDE — host/client ortak dünya snapshot'ı ve çizim sınırı.
// Client bu dosyadan yalnız salt-okunur draw + validation kullanır; simülasyon/AI import etmez.

import { drawObstacle, drawPickup } from '../core/arenaKit.js';
import { drawField, hashFieldSeed } from '../core/fieldKit.js';
import { drawGameAvatar } from '../core/avatarInGame.js';
import { fxReadAlpha } from '../core/fxKit.js';
import { segmentAabbIntersection } from '../core/physics2d.js';
import { drawTabletopIcon } from '../core/tabletopIcons.js';
import { getFireCooldownProgress, getFireFeedbackSnapshot, isValidFireFeedbackSnapshot } from '../core/fireFeedback.js';
import { UI_COLORS, UI_FONTS } from '../ui/tokens.js';
import { t } from '../i18n.js';
import {
  HORDE_UPGRADES,
  getDashCooldown,
  getHordeMap,
  getPlayerWeapon,
  getReloadTime,
} from './hordeConfig.js';
import {
  createWorldSnapshot,
  drawAlphaTexts,
  drawCircleParticles,
  drawFxRings,
  drawFxPops,
  isValidWorldBase,
  isValidFxState,
  packRectList,
  round1,
} from './worldCore.js';

export const HORDE_VIEW_LIMITS = Object.freeze({
  enemies: 28,
  bullets: 64,
  tombs: 4,
  // `PICKUP_MAX` + elite/boss dropları (`PICKUP_MAX + 2`) kadar sığmalı;
  // aksi hâlde ONLINE world packet doğrulaması sahneyi reddeder.
  pickups: 6,
  texts: 8,
  particles: 48,
  obstacles: 16,
  loadoutCrates: 8,
});

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const ENEMY_TYPES = new Set(['chaser', 'shooter', 'tank', 'healer', 'bomb']);

// Sık kullanılan çizim renkleri tek adsta: literal sayısı `rules-lint` K2
// borcunu dosya başına sayıyor, bu yüzden ortak tonlar burada durur.
const GOLD = '#FACC15';
const INK = '#1A1A1A';
const FLASH = '#FFFFFF';
const BLOOD = '#E63946';
const WEAPON_IDS = new Set(['SIDEARM', 'SMG', 'SHOTGUN', 'RIFLE', 'BLADE']);
const MAP_IDS = new Set(['foundry', 'reactor', 'core']);

export function mapHordePlayer(player, tuning = {}) {
  const weapon = getPlayerWeapon(player);
  const maxHp = Math.max(1, Math.round(Number(player.maxHp) || tuning.maxHp || 5));
  const dashCd = Math.max(0.01, getDashCooldown(player, tuning.dashCd ?? 4));
  const magazine = Number.isFinite(weapon.magazine) ? weapon.magazine : -1;
  const ammo = Number.isFinite(weapon.magazine) ? Math.max(0, Math.round(player.ammo ?? weapon.magazine)) : -1;
  const reloadDuration = Math.max(0.01, getReloadTime(player));
  const fireInterval = Math.max(0.01, weapon.fireInterval * (player.fastTimer > 0 ? 0.88 : 1));
  const swingTime = Number.isFinite(weapon.swingTime) ? weapon.swingTime : 0.2;
  return {
    slot: player.index,
    joined: player.isJoined !== false,
    alive: player.isAlive !== false,
    x: round1(player.x || 0),
    y: round1(player.y || 0),
    vx: round1(player.vx || 0),
    vy: round1(player.vy || 0),
    radius: round1(player.radius || 30),
    angle: round1(player.angle || 0),
    color: typeof player.color === 'string' ? player.color : '#D84727',
    hp: Math.max(0, Math.round(Number(player.hp) || 0)),
    hpMax: maxHp,
    dash: round1(1 - clamp01((Number(player.dashCooldown) || 0) / dashCd)),
    dashing: (Number(player.dashTimer) || 0) > 0,
    fireCooldown: round1(getFireCooldownProgress(player, fireInterval)),
    fireFeedback: getFireFeedbackSnapshot(player),
    invuln: (Number(player.invulnTimer) || 0) > 0 || (Number(player.spawnProt) || 0) > 0,
    shield: player.shield === true,
    fast: (Number(player.fastTimer) || 0) > 0,
    triple: (Number(player.tripleTimer) || 0) > 0,
    aiming: player.isAiming === true,
    weapon: WEAPON_IDS.has(weapon.id) ? weapon.id : 'SIDEARM',
    weaponKind: weapon.kind === 'melee' ? 'melee' : 'gun',
    weaponColor: weapon.color,
    weaponBarrel: weapon.barrel,
    ammo,
    magazine,
    reloading: (Number(player.reloadTimer) || 0) > 0,
    reload: round1(1 - clamp01((Number(player.reloadTimer) || 0) / reloadDuration)),
    swing: (Number(player.weaponSwingTimer) || 0) > 0,
    // Bıçak vuruşu animasyon ilerlemesi 0→1 (host canlı timer'dan, istemci
    // 30Hz snapshot alır; worldInterpolation bu alanı yumuşatır).
    swingT: round1(clamp01(1 - (Number(player.weaponSwingTimer) || 0) / swingTime)),
    expression: typeof player.expression === 'string' ? player.expression : 'FOCUS',
    // Gözlerin baktığı yön: `targetAngle` motor zaten nişan/koşu yönü olarak
    // tutuyor. Sadece nişan/koşu yönü anlamlı olduğunda paketlenir; eski
    // paketlerde `undefined` → gözler gövde yönünde kalır.
    lookAngle: Number.isFinite(player.targetAngle)
      ? round1(player.targetAngle)
      : undefined,
  };
}

export function mapHordeScene(game, tuning = {}) {
  return {
    players: (game.players || []).map((player) => mapHordePlayer(player, tuning)),
    enemies: (game.enemies || []).slice(0, HORDE_VIEW_LIMITS.enemies).map((enemy) => ({
      id: enemy.id,
      x: round1(enemy.x),
      y: round1(enemy.y),
      r: round1(enemy.radius),
      angle: round1(enemy.angle),
      hp: Math.max(0, Math.round(enemy.hp || 0)),
      maxHp: Math.max(1, Math.round(enemy.maxHp || 1)),
      type: ENEMY_TYPES.has(enemy.type) ? enemy.type : 'chaser',
      boss: enemy.isBoss === true,
      elite: enemy.elite === true,
      hit: enemy.hitTimer > 0,
      spawning: enemy.spawnDelay > 0,
      spawnProgress: round1(clamp01(1 - (Number(enemy.spawnDelay) || 0) / 0.9)),
      telegraph: enemy.attackTimer < 0.5 && (enemy.type === 'shooter' || enemy.type === 'healer'),
      lunging: enemy.lungeTimer > 0,
      // Bomba fuse ilerlemesi (0..1). Yalnız `type === 'bomb'` anlamlı;
      // eski paketlerde yoktur → `undefined` (istemci tam halka çizer).
      fuse: enemy.type === 'bomb'
        ? round1(clamp01(1 - (Number(enemy.attackTimer) || 0) / Math.max(0.01, Number(enemy.fuseTotal) || 1)))
        : undefined,
    })),
    bullets: (game.projectiles || []).slice(0, HORDE_VIEW_LIMITS.bullets).map((bullet) => ({
      id: bullet.id,
      x: round1(bullet.x),
      y: round1(bullet.y),
      vx: round1(bullet.vx),
      vy: round1(bullet.vy),
      radius: round1(bullet.radius),
      enemy: bullet.isEnemy === true,
      color: typeof bullet.color === 'string' ? bullet.color : '#D84727',
      angle: round1(Math.atan2(bullet.vy, bullet.vx)),
    })),
    tombs: (game.tombs || []).slice(0, HORDE_VIEW_LIMITS.tombs).map((tomb) => ({
      x: round1(tomb.x),
      y: round1(tomb.y),
      owner: tomb.ownerIndex,
      progress: round1(clamp01(tomb.timer / Math.max(0.01, tomb.reviveDuration || 3))),
    })),
    portal: game.portal ? {
      x: round1(game.portal.x),
      y: round1(game.portal.y),
      r: round1(game.portal.radius),
      progress: round1(clamp01(game.portal.timer / 3)),
      side: Math.max(0, Math.min(3, Math.round(game.portal.side || 0))),
    } : null,
    obstacles: (game.obstacles || []).slice(0, HORDE_VIEW_LIMITS.obstacles).map((obstacle) => ({ ...obstacle })),
    pickups: (game.pickups || []).slice(0, HORDE_VIEW_LIMITS.pickups).map((pickup) => ({
      x: round1(pickup.x),
      y: round1(pickup.y),
      type: pickup.type,
      animTime: round1(pickup.animTime || 0),
      size: round1(pickup.size || pickup.radius * 2 || 30),
    })),
    loadoutCrates: (game.loadoutCrates || []).slice(0, HORDE_VIEW_LIMITS.loadoutCrates).map((crate) => ({
      id: crate.id,
      x: round1(crate.x),
      y: round1(crate.y),
      kind: crate.kind === 'upgrade' ? 'upgrade' : 'weapon',
      weaponId: crate.weaponId || null,
      upgradeId: crate.upgradeId || null,
      color: typeof crate.color === 'string' ? crate.color : '#7C3AED',
      claimedBy: Number.isInteger(crate.claimedBy) ? crate.claimedBy : null,
    })),
    texts: (game.floatingTexts || []).slice(0, HORDE_VIEW_LIMITS.texts).map((entry) => ({
      x: round1(entry.x),
      y: round1(entry.y),
      text: String(entry.text || '').slice(0, 24),
      alpha: round1(clamp01(entry.alpha)),
      color: typeof entry.color === 'string' ? entry.color : INK,
    })),
    theme: MAP_IDS.has(game.mapTheme) ? game.mapTheme : getHordeMap(game.round).id,
    phase: game.state || 'LOBBY',
    round: Math.max(1, Math.round(game.round || 1)),
    nextRound: Math.max(1, Math.min(3, Math.round(game.nextRound || game.round || 1))),
    wave: Math.max(1, Math.round(game.wave || 1)),
    totalRounds: 3,
    totalWaves: 3,
    enemiesLeft: Math.min(HORDE_VIEW_LIMITS.enemies, Math.max(0, game.enemies?.length || 0)),
    waveTime: Math.max(0, round1(game.waveTimer || 0)),
    waveBreakTime: Math.max(0, round1(game.waveBreakTimer || 0)),
    roundBreakTime: Math.max(0, round1(game.roundBreakTimer || 0)),
    roundBreakTotal: 15,
    waveTimedOut: game.waveTimedOut === true,
    isBossWave: game.isBossWave === true,
    matchResult: game.matchResult === 'win' || game.matchResult === 'loss' ? game.matchResult : null,
  };
}

function packHordeScene(scene) {
  return {
    // Düşmanlar DİZİ olarak paketlenir (obje değil): 16 alanın JSON anahtar
    // yükü 28 düşmanda ~4.0 KB'ı buluyordu. Sıra `hordeSceneFromFrame` ve
    // `isValidHordeExtra` ile birebir aynı; boolean'lar 0/1.
    // [id, x, y, r, angle, hp, maxHp, type, boss, elite, hit, spawning, spawnProgress, telegraph, lunging, fuse]
    // Son alan (fuse) yalnız bombada anlamlı; eski paketlerde dizi 15 elemanlıdır
    // (v1 uyumu → `undefined`, çizim tam halka varsayar).
    enemies: scene.enemies.map((enemy) => [
      enemy.id,
      enemy.x,
      enemy.y,
      enemy.r,
      enemy.angle,
      enemy.hp,
      enemy.maxHp,
      enemy.type,
      enemy.boss ? 1 : 0,
      enemy.elite ? 1 : 0,
      enemy.hit ? 1 : 0,
      enemy.spawning ? 1 : 0,
      enemy.spawnProgress,
      enemy.telegraph ? 1 : 0,
      enemy.lunging ? 1 : 0,
      ...(enemy.fuse === undefined ? [] : [enemy.fuse]),
    ]),
    bullets: scene.bullets.map((bullet) => [
      bullet.x,
      bullet.y,
      bullet.vx,
      bullet.vy,
      bullet.radius,
      bullet.enemy ? 1 : 0,
      bullet.id,
      bullet.angle,
      bullet.color,
    ]),
    tombs: scene.tombs.map((tomb) => [tomb.x, tomb.y, tomb.owner, tomb.progress]),
    portal: scene.portal ? [scene.portal.x, scene.portal.y, scene.portal.r, scene.portal.progress, scene.portal.side] : null,
    obstacles: packRectList(scene.obstacles, HORDE_VIEW_LIMITS.obstacles),
    pickups: scene.pickups.map((pickup) => [pickup.x, pickup.y, pickup.type, pickup.animTime, pickup.size]),
    loadoutCrates: scene.loadoutCrates,
    texts: scene.texts,
    theme: scene.theme,
    phase: scene.phase,
    round: scene.round,
    nextRound: scene.nextRound,
    wave: scene.wave,
    totalRounds: scene.totalRounds,
    totalWaves: scene.totalWaves,
    enemiesLeft: scene.enemiesLeft,
    waveTime: scene.waveTime,
    waveBreakTime: scene.waveBreakTime,
    roundBreakTime: scene.roundBreakTime,
    roundBreakTotal: scene.roundBreakTotal,
    waveTimedOut: scene.waveTimedOut,
    isBossWave: scene.isBossWave,
    matchResult: scene.matchResult,
  };
}

export function createHordeWorldPacket(game, tuning = {}) {
  if (!game) return null;
  const scene = mapHordeScene(game, tuning);
  return createWorldSnapshot(game, {
    mode: 'HORDE',
    mapPlayer: (player) => scene.players[player.index],
    extras: {
      ...packHordeScene(scene),
      selfPredict: true,
      // NOT: `frame.fx`/`frame.particles` HORDE'da artık paketlenmez. FX esas
      // olarak anlık güvenilir kanaldan (`FX_EVENTS` → `context.fx`, fxLive)
      // gelir; kumanda o mandal açıkken bu iki alanı zaten yok sayar
      // (MOTION_PLAN Faz 2 sapma notu, "kaldırma kararı Parça 4"). Tam baskıda
      // bu ~4 KB/kare × 30 Hz idi. `particles: []` şema uyumu için
      // createWorldSnapshot'tan gelir; `particleCap: 0` içeriğini boşaltır.
    },
    particleCap: 0,
  });
}

function isValidHordePlayer(player) {
  return !!player
    && typeof player.joined === 'boolean'
    && typeof player.alive === 'boolean'
    && finite(player.x) && finite(player.y) && finite(player.angle)
    && (player.vx === undefined || finite(player.vx))
    && (player.vy === undefined || finite(player.vy))
    && typeof player.color === 'string'
    && Number.isInteger(player.hp) && player.hp >= 0
    && Number.isInteger(player.hpMax) && player.hpMax > 0
    && finite(player.dash) && player.dash >= 0 && player.dash <= 1
    && finite(player.fireCooldown) && player.fireCooldown >= 0 && player.fireCooldown <= 1
    && isValidFireFeedbackSnapshot(player.fireFeedback)
    && typeof player.dashing === 'boolean'
    && typeof player.invuln === 'boolean'
    && typeof player.shield === 'boolean'
    && typeof player.fast === 'boolean'
    && typeof player.triple === 'boolean'
    && typeof player.aiming === 'boolean'
    && WEAPON_IDS.has(player.weapon)
    && (player.weaponKind === 'gun' || player.weaponKind === 'melee')
    && typeof player.weaponColor === 'string'
    && typeof player.weaponBarrel === 'string'
    && Number.isInteger(player.ammo) && player.ammo >= -1
    && Number.isInteger(player.magazine) && player.magazine >= -1
    && typeof player.reloading === 'boolean'
    && finite(player.reload) && player.reload >= 0 && player.reload <= 1
    && typeof player.swing === 'boolean'
    // `swingT` yalnız yeni sürümde var; eski host paketi alanı taşımaz (lookAngle
    // kuralı gibi). Varsa 0..1 sınırında olmalı.
    && (player.swingT === undefined || (finite(player.swingT) && player.swingT >= 0 && player.swingT <= 1));
}

function isValidHordeExtra(frame) {
  if (!Array.isArray(frame.enemies) || frame.enemies.length > HORDE_VIEW_LIMITS.enemies) return false;
  // Düşman dizisi 15 (v1) veya 16 (fuse'lı) elemanlı olabilir; eski paket
  // v1 uyumunda kabul edilir.
  if (!frame.enemies.every((enemy) => Array.isArray(enemy) && (enemy.length === 15 || enemy.length === 16)
    && Number.isInteger(enemy[0]) && enemy[0] >= 0
    && finite(enemy[1]) && finite(enemy[2]) && finite(enemy[3]) && enemy[3] > 0
    && finite(enemy[4])
    && Number.isInteger(enemy[5]) && enemy[5] >= 0
    && Number.isInteger(enemy[6]) && enemy[6] > 0
    && ENEMY_TYPES.has(enemy[7])
    && [8, 9, 10, 11, 13, 14].every((i) => enemy[i] === 0 || enemy[i] === 1)
    && finite(enemy[12]) && enemy[12] >= 0 && enemy[12] <= 1
    && (enemy.length === 15
      || (finite(enemy[15]) && enemy[15] >= 0 && enemy[15] <= 1)))) return false;

  if (!Array.isArray(frame.bullets) || frame.bullets.length > HORDE_VIEW_LIMITS.bullets) return false;
  if (!frame.bullets.every((bullet) => Array.isArray(bullet) && bullet.length === 9
    && bullet.slice(0, 5).every(finite)
    && (bullet[5] === 0 || bullet[5] === 1)
    && Number.isInteger(bullet[6]) && bullet[6] >= 0
    && finite(bullet[7])
    && typeof bullet[8] === 'string')) return false;

  if (!Array.isArray(frame.tombs) || frame.tombs.length > HORDE_VIEW_LIMITS.tombs) return false;
  if (!frame.tombs.every((tomb) => Array.isArray(tomb) && tomb.length === 4
    && finite(tomb[0]) && finite(tomb[1])
    && Number.isInteger(tomb[2]) && tomb[2] >= 0 && tomb[2] <= 3
    && finite(tomb[3]) && tomb[3] >= 0 && tomb[3] <= 1)) return false;

  if (frame.portal !== null) {
    if (!Array.isArray(frame.portal) || frame.portal.length !== 5 || !frame.portal.slice(0, 4).every(finite)) return false;
    if (frame.portal[2] <= 0 || frame.portal[3] < 0 || frame.portal[3] > 1) return false;
    if (!Number.isInteger(frame.portal[4]) || frame.portal[4] < 0 || frame.portal[4] > 3) return false;
  }

  if (!Array.isArray(frame.obstacles) || frame.obstacles.length > HORDE_VIEW_LIMITS.obstacles) return false;
  if (!frame.obstacles.every((rect) => Array.isArray(rect) && rect.length === 4 && rect.every(finite))) return false;

  if (!Array.isArray(frame.pickups) || frame.pickups.length > HORDE_VIEW_LIMITS.pickups) return false;
  if (!frame.pickups.every((pickup) => Array.isArray(pickup) && pickup.length === 5
    && finite(pickup[0]) && finite(pickup[1])
    && ['HEAL', 'SHIELD', 'FAST', 'TRIPLE'].includes(pickup[2])
    && finite(pickup[3]) && finite(pickup[4]) && pickup[4] > 0)) return false;

  if (!Array.isArray(frame.loadoutCrates) || frame.loadoutCrates.length > HORDE_VIEW_LIMITS.loadoutCrates) return false;
  if (!frame.loadoutCrates.every((crate) => crate
    && Number.isInteger(crate.id) && crate.id >= 0
    && finite(crate.x) && finite(crate.y)
    && (crate.kind === 'weapon' || crate.kind === 'upgrade')
    && typeof crate.color === 'string'
    && (crate.claimedBy === null || (Number.isInteger(crate.claimedBy) && crate.claimedBy >= 0 && crate.claimedBy <= 3))
    && (crate.kind !== 'weapon' || WEAPON_IDS.has(crate.weaponId))
    && (crate.kind !== 'upgrade' || Boolean(HORDE_UPGRADES[crate.upgradeId])))) return false;

  if (!Array.isArray(frame.texts) || frame.texts.length > HORDE_VIEW_LIMITS.texts) return false;
  if (!frame.texts.every((entry) => entry && finite(entry.x) && finite(entry.y)
    && typeof entry.text === 'string' && finite(entry.alpha)
    && entry.alpha >= 0 && entry.alpha <= 1 && typeof entry.color === 'string')) return false;

  if (!MAP_IDS.has(frame.theme)) return false;
  if (!['LOBBY', 'PLAYING', 'ROUND_PAUSE', 'MATCH_OVER'].includes(frame.phase)) return false;
  if (!Number.isInteger(frame.round) || frame.round < 1 || frame.round > 3) return false;
  if (!Number.isInteger(frame.nextRound) || frame.nextRound < 1 || frame.nextRound > 3) return false;
  if (!Number.isInteger(frame.wave) || frame.wave < 1 || frame.wave > 3) return false;
  if (frame.totalRounds !== 3 || frame.totalWaves !== 3) return false;
  if (!Number.isInteger(frame.enemiesLeft) || frame.enemiesLeft < 0 || frame.enemiesLeft > HORDE_VIEW_LIMITS.enemies) return false;
  if (!finite(frame.waveTime) || frame.waveTime < 0 || frame.waveTime > 90.1) return false;
  if (!finite(frame.waveBreakTime) || frame.waveBreakTime < 0 || frame.waveBreakTime > 3.1) return false;
  if (!finite(frame.roundBreakTime) || frame.roundBreakTime < 0 || frame.roundBreakTime > 15.1) return false;
  if (frame.roundBreakTotal !== 15) return false;
  if (typeof frame.waveTimedOut !== 'boolean' || typeof frame.isBossWave !== 'boolean') return false;
  if (frame.matchResult !== null && frame.matchResult !== 'win' && frame.matchResult !== 'loss') return false;
  // fx alanı v2 eklentisidir; eski host frames'i yoktur (opsiyonel, v1 uyumu).
  if (frame.fx !== undefined && !isValidFxState(frame.fx)) return false;
  return true;
}

export function isValidHordeWorldFrame(frame) {
  return isValidWorldBase(frame, 'HORDE', {
    checkPlayer: isValidHordePlayer,
    checkExtra: isValidHordeExtra,
    maxParticles: HORDE_VIEW_LIMITS.particles,
  });
}

export function hordeSceneFromFrame(frame) {
  if (!frame) return null;
  return {
    players: Array.isArray(frame.players) ? frame.players : [],
    enemies: Array.isArray(frame.enemies) ? frame.enemies.map((enemy) => {
      const [id, x, y, r, angle, hp, maxHp, type, boss, elite, hit, spawning, spawnProgress, telegraph, lunging] = enemy;
      return {
        id, x, y, r, angle, hp, maxHp, type,
        boss: boss === 1,
        elite: elite === 1,
        hit: hit === 1,
        spawning: spawning === 1,
        spawnProgress,
        telegraph: telegraph === 1,
        lunging: lunging === 1,
        // 16. alan v2 eklentisi (bomba fuse); v1 paketlerde yok → undefined.
        fuse: enemy.length > 15 ? enemy[15] : undefined,
      };
    }) : [],
    bullets: Array.isArray(frame.bullets) ? frame.bullets.map(([x, y, vx, vy, radius, enemy, id, angle, color]) => ({
      x, y, vx, vy, radius, enemy: enemy === 1, id, angle, color,
    })) : [],
    tombs: Array.isArray(frame.tombs) ? frame.tombs.map(([x, y, owner, progress]) => ({ x, y, owner, progress })) : [],
    portal: Array.isArray(frame.portal) ? {
      x: frame.portal[0], y: frame.portal[1], r: frame.portal[2], progress: frame.portal[3], side: frame.portal[4],
    } : null,
    obstacles: Array.isArray(frame.obstacles) ? frame.obstacles.map(([x, y, w, h]) => ({ x, y, w, h })) : [],
    pickups: Array.isArray(frame.pickups) ? frame.pickups.map(([x, y, type, animTime, size]) => ({ x, y, type, animTime, size })) : [],
    loadoutCrates: Array.isArray(frame.loadoutCrates) ? frame.loadoutCrates : [],
    texts: Array.isArray(frame.texts) ? frame.texts : [],
    theme: frame.theme,
    phase: frame.phase,
    round: frame.round,
    nextRound: frame.nextRound,
    wave: frame.wave,
    totalRounds: frame.totalRounds,
    totalWaves: frame.totalWaves,
    enemiesLeft: frame.enemiesLeft,
    waveTime: frame.waveTime,
    waveBreakTime: frame.waveBreakTime,
    roundBreakTime: frame.roundBreakTime,
    roundBreakTotal: frame.roundBreakTotal,
    waveTimedOut: frame.waveTimedOut,
    isBossWave: frame.isBossWave,
    matchResult: frame.matchResult,
  };
}

function drawSpawnGate(ctx, arena, side, color) {
  const { left, top, right, bottom, cx, cy } = arena;
  const u = arena?.unit ?? (arena?.size ? arena.size / 952 : 1);
  const points = [
    { x: cx, y: top + 5 * u, rotation: 0 },
    { x: right - 5 * u, y: cy, rotation: Math.PI / 2 },
    { x: cx, y: bottom - 5 * u, rotation: Math.PI },
    { x: left + 5 * u, y: cy, rotation: -Math.PI / 2 },
  ][side];
  ctx.save();
  ctx.translate(points.x, points.y);
  ctx.rotate(points.rotation);
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, 5 * u);
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo((i * 13 - 7) * u, 13 * u);
    ctx.lineTo(i * 13 * u, 4 * u);
    ctx.lineTo((i * 13 + 7) * u, 13 * u);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Dört doğuş kapısı statiktir, bu yüzden saha katmanının İÇİNE pişirilir:
 * `marks` imzası arena-içi (0,0)..(w,h) koordinatlarını kullanır.
 */
function hordeFieldMarks(ctx, box, palette) {
  const { width, height, unit, cx, cy } = box;
  for (let side = 0; side < 4; side++) {
    drawSpawnGate(ctx, { left: 0, top: 0, right: width, bottom: height, cx, cy, unit }, side, palette.accent);
  }
}

export function drawHordeArena(ctx, arena, themeId = 'foundry') {
  // Zemin + ızgara + motif + spawn kapıları + duvar: `fieldKit` statik katmanı.
  // Palet `hordeConfig.HORDE_MAPS` → `fieldKit.FIELD_THEMES` zinciriyle gelir;
  // bilinmeyen tema kimliği eski davranış gibi `foundry`'a düşer.
  const theme = MAP_IDS.has(themeId) ? themeId : 'foundry';
  drawField(ctx, arena, {
    mode: 'HORDE',
    theme,
    // Harita değiştikçe dekor değişir (round yerine tema kimliği seed'lenir:
    // aynı haritada üç dalga üst üste aynı saha görünür).
    seed: hashFieldSeed('HORDE', theme),
    marks: hordeFieldMarks,
  });
}

function drawExtractionGate(ctx, portal, now) {
  const rotations = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  const pu = (portal.r || 30) / 30;
  const progress = portal.progress || 0;
  ctx.save();
  ctx.translate(portal.x, portal.y);
  ctx.rotate(rotations[portal.side] || 0);

  const glow = 0.4 + Math.sin(now / 100) * 0.2;
  ctx.globalAlpha = glow;
  
  ctx.fillStyle = '#7C3AED';
  ctx.beginPath();
  ctx.arc(0, 0, portal.r * (0.6 + progress * 0.6), 0, Math.PI * 2);
  ctx.fill();
  
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = Math.max(2, 4 * pu);
  const spin = now / 200 + progress * 15;
  const numRings = 4;
  for (let i = 0; i < numRings; i++) {
    ctx.beginPath();
    const r = portal.r * (0.2 + (i / numRings) * (0.5 + progress * 0.5));
    ctx.arc(0, 0, r, spin + i, spin + i + Math.PI);
    ctx.stroke();
  }
  
  ctx.fillStyle = GOLD;
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(0, 0, portal.r * 0.15 * (1 + progress * 2), 0, Math.PI * 2);
  ctx.fill();
  
  ctx.restore();
}

/**
 * Bomba = zemin telegrafı (katı cisim DEĞİL).
 *
 * Çizim dili kasıtlı olarak düşman siluetinden ayrı: dolu yuvarlak gövde yerine
 * (1) patlama yarıçapını gösteren yarı saydam KIRMIZI ZEMİN alanı,
 * (2) tam dairenin içinde kalan FUSE halkası (altın, saat yönünde azalır),
 * (3) merkezde küçük bomba ikonu — çekirdek görsel, çarpışma yok.
 * Oyuncunun okuması gereken tek bilgi "buradan çık, şu kadar sürem var".
 */
function drawBombTelegraph(ctx, enemy, now) {
  const r = Math.max(6, enemy.r || 40);
  const fuse = Number.isFinite(enemy.fuse) ? clamp01(enemy.fuse) : 1;
  const pulse = 0.5 + Math.sin(now / 90) * 0.5;
  // Son %25'te vurgu: renk kızıllaşır, nabız hızlanır.
  const urgent = fuse < 0.25;
  const lineW = Math.max(2, r * 0.06);

  ctx.save();
  ctx.translate(enemy.x, enemy.y);

  // 1) Zemin alanı: hasarın olduğu yer. Saydam kırmızı dolgu + kesik sınır.
  ctx.globalAlpha = 0.14 + pulse * 0.06;
  ctx.fillStyle = BLOOD;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.75;
  ctx.strokeStyle = BLOOD;
  ctx.lineWidth = lineW;
  ctx.setLineDash([r * 0.22, r * 0.14]);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // 2) Fuse halkası: kalan süre. Saat yönünde azalan altın yay + kalan
  //    süreyi gösteren ince beyaz halka.
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';
  ctx.strokeStyle = urgent ? BLOOD : GOLD;
  ctx.lineWidth = lineW * 1.4;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.82, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fuse);
  ctx.stroke();
  if (fuse > 0.02) {
    ctx.strokeStyle = FLASH;
    ctx.lineWidth = Math.max(1, lineW * 0.5);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 3) Çekirdek: küçük bomba ikonu. Oyuncunun "içinden geçilebilir" okuması
  //    için ikon kasıtlı olarak gövdeden çok daha küçük.
  drawTabletopIcon(ctx, 'bomb', 0, 0, r * 0.42, { color: INK });
  ctx.restore();
}

function drawEnemy(ctx, enemy, withFx, now, obstacles = []) {
  const eu = (enemy.r || 14) / 14;
  if (enemy.spawning) {
    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    ctx.globalAlpha = 0.18 + enemy.spawnProgress * 0.35;
    ctx.strokeStyle = enemy.elite ? GOLD : BLOOD;
    ctx.lineWidth = Math.max(1.5, 4 * eu);
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.arc(0, 0, enemy.r + 10, 0, Math.PI * 2);
    ctx.stroke();
    // Perf: setLineDash([]) kaldırıldı — ctx.restore() zaten durumu geri alır
    ctx.rotate(-now / 500);
    ctx.strokeStyle = FLASH;
    ctx.lineWidth = Math.max(1, 3 * eu);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (enemy.r + 3), Math.sin(a) * (enemy.r + 3));
      ctx.lineTo(Math.cos(a) * (enemy.r + 12), Math.sin(a) * (enemy.r + 12));
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (enemy.telegraph) {
    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    ctx.rotate(enemy.angle || 0);
    ctx.globalAlpha = 0.22 + Math.sin(now / 60) * 0.08;
    ctx.strokeStyle = enemy.type === 'healer' ? '#16A34A' : '#F97316';
    ctx.lineWidth = Math.max(1.5, (enemy.type === 'healer' ? 5 : 3) * eu);
    if (enemy.type === 'healer') {
      ctx.beginPath();
      ctx.arc(0, 0, 48 + Math.sin(now / 80) * 5, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.setLineDash([8, 7]);
      let aimLength = 260;
      const endX = enemy.x + Math.cos(enemy.angle || 0) * aimLength;
      const endY = enemy.y + Math.sin(enemy.angle || 0) * aimLength;
      for (const obstacle of obstacles) {
        const intersection = segmentAabbIntersection(enemy.x, enemy.y, endX, endY, obstacle, 3);
        if (intersection) aimLength = Math.min(aimLength, Math.max(enemy.r, intersection.t * 260));
      }
      ctx.beginPath();
      ctx.moveTo(enemy.r, 0);
      ctx.lineTo(aimLength, 0);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (enemy.type === 'bomb') {
    drawBombTelegraph(ctx, enemy, now);
    return;
  }

  // Can çubuğu ölçeği: `enemy.r`'ye göreli. Mutlak taban (eski `Math.max(20, ...)`
  // ve 10px boşluk) telefonda düşman 9px'e küçülürken çubuğu 20px'te
  // tutuyordu — yani NPC "küçük" algısının bir kısmı çizimden geliyordu.
  const barW = Math.max(enemy.r * 1.5, enemy.r * 0.9);
  const barH = Math.max(2, enemy.r * 0.3);
  const barGap = Math.max(3, enemy.r * 0.55);

  ctx.save();
  ctx.translate(enemy.x, enemy.y);
  ctx.rotate(enemy.angle || 0);
  // Vuruş: gövdeyi saf beyaza boyamak türün rengini ve siluetini birkaç kare
  // tamamen siliyordu — "parladı" değil "kayboldu" okunuyordu. Gövde artık
  // kendi renginde kalır, kontur parlar ve gövde anlık büyür. HP çubuğu
  // aşağıda restore sonrası dünya koordinatlarında çizildiği için bu
  // ölçekten etkilenmez.
  const flinch = enemy.hit && withFx ? 1.12 : 1;
  if (flinch !== 1) ctx.scale(flinch, flinch);
  const fill = enemy.type === 'shooter'
    ? '#7C3AED'
    : enemy.type === 'tank'
      ? '#334155'
      : enemy.type === 'healer'
        ? '#16A34A'
        : BLOOD;
  ctx.fillStyle = fill;
  ctx.strokeStyle = enemy.boss || enemy.elite ? GOLD : INK;
  ctx.lineWidth = Math.max(1.5, (enemy.boss ? 5 : 3) * eu);
  ctx.beginPath();
  if (enemy.type === 'tank') {
    ctx.rect(-enemy.r, -enemy.r, enemy.r * 2, enemy.r * 2);
  } else if (enemy.type === 'healer') {
    ctx.moveTo(0, -enemy.r);
    ctx.lineTo(enemy.r, 0);
    ctx.lineTo(0, enemy.r);
    ctx.lineTo(-enemy.r, 0);
    ctx.closePath();
  } else if (enemy.type === 'shooter') {
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      if (i === 0) ctx.moveTo(Math.cos(a) * enemy.r, Math.sin(a) * enemy.r);
      else ctx.lineTo(Math.cos(a) * enemy.r, Math.sin(a) * enemy.r);
    }
    ctx.closePath();
  } else {
    if (enemy.elite) {
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI) / 5;
        const r2 = i % 2 === 0 ? enemy.r : enemy.r * 0.75;
        if (i === 0) ctx.moveTo(Math.cos(a) * r2, Math.sin(a) * r2);
        else ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
      }
      ctx.closePath();
    } else {
      ctx.arc(0, 0, enemy.r, 0, Math.PI * 2);
    }
  }
  ctx.fill();
  ctx.stroke();
  if (enemy.elite && !enemy.boss) {
    ctx.strokeStyle = '#FFF7A3';
    ctx.lineWidth = Math.max(1, 2 * eu);
    ctx.stroke();
  }
  if (enemy.hit && withFx) {
    ctx.strokeStyle = FLASH;
    ctx.lineWidth = Math.max(2, 4 * eu);
    ctx.stroke();
  }
  if (enemy.lunging) {
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = Math.max(1.5, 4 * eu);
    ctx.beginPath();
    ctx.moveTo(-enemy.r - 10, 0);
    ctx.lineTo(-enemy.r, 0);
    ctx.stroke();
  }
  ctx.fillStyle = FLASH;
  ctx.fillRect(enemy.r * 0.45, -3, enemy.r * 0.55, 6);
  ctx.restore(); // Perf: health bar save/restore kaldırıldı — fillRect bağlamcıksız

  const ratio = clamp01(enemy.hp / enemy.maxHp);
  ctx.fillStyle = INK;
  ctx.fillRect(enemy.x - barW / 2, enemy.y - enemy.r - barGap, barW, barH);
  ctx.fillStyle = enemy.boss || enemy.elite ? GOLD : BLOOD;
  ctx.fillRect(enemy.x - barW / 2, enemy.y - enemy.r - barGap, barW * ratio, barH);
}

/**
 * Oyuncu silahı — gövde yarıçapına ORANTILI çizilir.
 *
 * İki ayrı ölçek var ve ikisi de gerekli:
 *   `u` — mutlak px'i gövde yarıçapına bağlar (cihaz tutarlılığı).
 *   `REACH` — silahın gövde yarıçapına GÖRE erişimini kısar (görsel denge).
 *
 * Neden ikisi: `u` tek başına yetmiyordu. Tüm geometri 16px gövdeye göre
 * yazılmıştı, yani silah ucu zaten **2 gövde yarıçapı** ötede bitiyordu
 * (13+19=32px). Ölçekleme bu oranı koruyor, yani oyuncunun çizilen
 * yayılımı gövdeden bağımsız olarak 2 kat kalıyordu — "oyuncu büyük"
 * algısının halo bastırıldıktan sonra kalan kaynağı buydu.
 *
 * `REACH` yalnız UZUNLUĞU kısaltır, kalınlığı değil: silah hâlâ okunur ve
 * yön hâlâ belli, ama gövdeyi 2 katına çıkarmıyor. Değer keyfine açıktır.
 */
const WEAPON_REACH = 0.7;

function drawPlayerWeapon(ctx, player) {
  const u = (player.radius || 30) / 30;
  const k = u * WEAPON_REACH;
  ctx.save();
  ctx.rotate(player.angle || 0);
  if (player.weaponKind === 'melee') {
    // Bıçak: geniş etki alanı görselde de okunur — yay yarıçapı silahın
    // menziline orantılı (150), tarama açısı weapon.arc (~3.8 ≈ 218°) ile
    // eşleşir. `swingT` 0→1 iken bıçak -ARC_HALF'ten +ARC_HALF'e keser
    // (`strike`), son %20'de nötral pozisyona toparlanır; böylece vuruş
    // bitince bıçak yerine sıçramaz, sadece kesim izi solar.
    const SWEEP_R = 150 * k;
    const ARC_HALF = 1.9;
    const bladeLen = 44 * k;
    const bladeStart = SWEEP_R - bladeLen;
    const drawBlade = (extraAngle) => {
      ctx.rotate(extraAngle || 0);
      ctx.fillStyle = player.weaponColor;
      ctx.strokeStyle = FLASH;
      ctx.lineWidth = 2 * u;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(bladeStart, -bladeLen * 0.18);
      ctx.lineTo(bladeStart + bladeLen, 0);
      ctx.lineTo(bladeStart, bladeLen * 0.18);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.rotate(-(extraAngle || 0));
    };

    if (player.swing) {
      // `swingT` yalnız yeni sürümde gelir (host canlı timer'dan, istemci 30Hz
      // snapshot + worldInterpolation yumuşatır). Eski hostun gönderdiği boş
      // `swingT`'te statik parlak kesim çizilir — animasyon kırılmaz, donmaz.
      const hasProgress = Number.isFinite(player.swingT);
      const p = hasProgress ? clamp01(player.swingT) : 0.5;
      const strike = Math.min(1, p / 0.8);
      const leading = -ARC_HALF + strike * ARC_HALF * 2;
      const bladeAngle = p <= 0.8 ? leading : ARC_HALF * (1 - (p - 0.8) / 0.2);
      const tail = hasProgress ? 1 - p : 0.85;
      const sweepEnd = hasProgress ? leading : ARC_HALF;

      // Süpürülen sektör dolgusu + renkli yay izi + parlak beyaz kesim çekirdeği.
      ctx.globalAlpha = 0.14 * tail;
      ctx.fillStyle = player.weaponColor;
      ctx.beginPath();
      ctx.moveTo(8 * k, 0);
      ctx.arc(8 * k, 0, SWEEP_R, -ARC_HALF, sweepEnd);
      ctx.closePath();
      ctx.fill();
      ctx.lineCap = 'round';
      ctx.strokeStyle = player.weaponColor;
      ctx.globalAlpha = tail * 0.9;
      ctx.lineWidth = 9 * u;
      ctx.beginPath();
      ctx.arc(8 * k, 0, SWEEP_R, -ARC_HALF, sweepEnd);
      ctx.stroke();
      ctx.strokeStyle = FLASH;
      ctx.globalAlpha = tail;
      ctx.lineWidth = 3 * u;
      ctx.beginPath();
      ctx.arc(8 * k, 0, SWEEP_R, -ARC_HALF, sweepEnd);
      ctx.stroke();
      ctx.globalAlpha = 1;

      drawBlade(hasProgress ? bladeAngle : 0);
    } else {
      drawBlade(0);
    }
  } else {
    if (player.aiming) {
      ctx.strokeStyle = player.weaponColor;
      ctx.lineWidth = 3 * u;
      ctx.beginPath();
      ctx.moveTo(22 * k, 0);
      ctx.lineTo(54 * k, 0);
      ctx.stroke();
    }
    const barrel = player.weaponBarrel;
    const length = (barrel === 'rifle' ? 34 : barrel === 'shotgun' ? 28 : barrel === 'smg' ? 24 : 19) * k;
    const thickness = (barrel === 'shotgun' ? 10 : barrel === 'rifle' ? 6 : 8) * u;
    ctx.fillStyle = player.weaponColor;
    ctx.fillRect(13 * k, -thickness / 2, length, thickness);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2 * u;
    ctx.strokeRect(13 * k, -thickness / 2, length, thickness);
  }
  ctx.restore();
}

function drawHordePlayers(ctx, players, { withFx = true, now = 0, selfSlot = -1 } = {}) {
  // 3.3 okunurluk hiyerarşisi: tek görür varsa kendi avatarın T1, diğerleri T3
  // (−%25); α yalnız fxKit'ten gelir.
  const hasViewer = Number.isInteger(selfSlot) && selfSlot >= 0;
  const blink = Math.floor(now / 120) % 2 === 0;
  for (const player of players) {
    if (!player.joined || !player.alive) continue;
    if (withFx && player.invuln && blink) continue;

    // Oyuncu gövdesi ve çevresi `player.radius`'e bağlıdır. Sabit 15px idi:
    // telefonda çarpışma yarıçapı 8.9px'e düşerken gövde 15px'te kalıyordu,
    // yani çizilen oyuncu sahanın %1.7 katı büyüktü. Tasarım referansı artık
    // FIELD_TIERS §normal gövdeyle birebir: 30px.
    const R = player.radius || 30;
    const u = R / 30;

    ctx.save();
    ctx.translate(player.x, player.y);
    if (player.dashing) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = player.color;
      ctx.beginPath();
      ctx.arc(-18 * u, 0, 14 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (player.shield) {
      ctx.strokeStyle = '#06B6D4';
      ctx.lineWidth = 4 * u;
      ctx.fillStyle = 'rgba(6, 182, 212, 0.18)';
      ctx.beginPath();
      ctx.arc(0, 0, 22 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    drawPlayerWeapon(ctx, player);
    drawGameAvatar(ctx, 0, 0, R, {
      ...player,
      index: player.slot,
      facingAngle: player.angle,
      color: player.color,
    }, {
      facingAngle: player.angle,
      expression: player.hp <= 1 ? 'PANIC' : player.fast || player.triple ? 'EXCITED' : player.expression,
      label: '',
      showPointer: false,
      // Horde kalabalık saha: gözler `targetAngle`'e bakar (nişan alırken hedefe,
      // boşta koşarken gittiği yöne) — kalabalıkta "kimin nereye baktığı" tek
      // bakışta okunur. Gövde `angle`'da kalır, bakış gövdeden bağımsızdır.
      lookAngle: player.lookAngle,
      now,
      alpha: fxReadAlpha({ isSelf: hasViewer && (player.slot ?? player.index) === selfSlot, hasViewer }),
    });
    ctx.restore();

    // Oyuncu üstü durum yığını da gövde yarıçapına bağlıdır: mutlak px'ler
    // tasarım boyutunda doğruydu ama telefonda gövdeyi 5.7px'e düşerken
    // HUD 15-32px'de kalıyordu (yayılım gövdenin ~3.2 katı). `hu` tasarım
    // yarıçapına (14) oran olduğu için masaüstü ölçü BİREBİR korunur, yalnız
    // küçük sahada küçülür.
    // HUD ölçeği gövde yarıçapına bağlıdır, ama TABBAN tabanı vardır:
    // saf oran telefonda (gövde 11px) plakayı 9px metinli bir kutuya
    // indiriyor, rakam okunmuyordu. `Math.max(1, …)` masaüstünde tam 1'dir
    // (hiçbir şeyi şişirmez), telefonda HUD'u okunur tabana çeker.
    drawHordeVitals(ctx, player, Math.max(1, R / 14));
  }
}

/**
 * Oyuncu üstü durum yığını: kalp (can) + şarjör plakası (cephane).
 *
 * Ölçülen iki okunabilirlik hatası ve çözümleri:
 *
 *  1) CAN: 5×4px renkli dikdörtgenler (`fillRect` pips) "kaç canım kaldı"
 *     sorusunu yanıtlamıyordu — oyuncu sadece "bir şeyler kısaldı" diye
 *     görüyordu. Yerine KALP ikonu: dolu = can, boş = kayıp (`hudEmpty`
 *     kontur). Sembol zaten "can" demek; saymaya gerek yok.
 *  2) CEPHANE: soyut bir dolum çubuğu "kaç mermi kaldı" sorusunu yanıtlamıyor,
 *     ayrıca "bar ne kadar azaldı" tahmini gerektiriyordu. Yerine koyu plaka
 *     + şarjör ikonu + RAKAM (`18/20`). Sayı doğrudan cevaptır, ikon "neden
 *     o sayı" der, plaka zemeni krem sahada 9:1+ kontrast verir.
 *     Doldurma sırasında plaka altın bir dolum çubuğuna dönüşür.
 *
 * Yakın dövüş (BLADE) cephanesizdir: şarjör plakası çizilmez, yığın yalnız
 * kalp kalır — olmayan bir sayı göstermek, "neden mermim yok" sorusunu
 * üretiyordu.
 */
function drawHordeVitals(ctx, player, hu) {
  const isGun = player.weaponKind === 'gun';
  const reloading = isGun && player.reloading;
  const hasMag = isGun && player.magazine > 0;
  const dry = hasMag && player.ammo <= 0;
  const low = hasMag && !reloading && player.ammo > 0
    && player.ammo <= Math.max(1, Math.round(player.magazine * 0.25));

  const isDamaged = player.hp < player.hpMax;
  const isShootingOrLow = hasMag && (reloading || dry || low || (player.ammo < player.magazine));

  // Transient Görünürlük: Can ve cephane tamken başüstünü tamamen temiz tut.
  if (!isDamaged && !isShootingOrLow) {
    return;
  }

  // Kompakt diegetic ölçüler: gövde genişliğini aşmayan zarif oranlar.
  const plateW = Math.round(32 * hu);
  const plateH = Math.round(14 * hu);
  const heartSize = Math.round(7.5 * hu);
  const heartGap = Math.max(1, Math.round(2 * hu));
  const stackGap = Math.max(2, Math.round(3 * hu));
  const stackH = (isShootingOrLow ? plateH : 0)
    + (isDamaged ? heartSize : 0)
    + (isShootingOrLow && isDamaged ? stackGap : 0);

  const stackTop = player.y - (player.radius || 30) - 4 * hu - stackH;
  let curY = stackTop;

  // 1. Cephane Plakası: Yalnız atış yapılmışken, cephane azken veya dolumdayken
  if (isShootingOrLow) {
    const x = player.x - plateW / 2;
    const y = curY;

    ctx.fillStyle = UI_COLORS.hudPlate;
    ctx.fillRect(x, y, plateW, plateH);
    if (reloading || low) {
      ctx.strokeStyle = reloading ? GOLD : BLOOD;
      ctx.lineWidth = Math.max(1, 1.5 * hu);
      ctx.strokeRect(x - 0.5, y - 0.5, plateW + 1, plateH + 1);
    }

    const iconSize = 10 * hu;
    const iconX = x + plateH * 0.5;
    const iconY = y + plateH / 2;
    if (reloading) {
      const spin = (typeof performance !== 'undefined' ? performance.now() : 0) / 120;
      ctx.save();
      ctx.translate(iconX, iconY);
      ctx.rotate(spin);
      drawTabletopIcon(ctx, 'reload', 0, 0, iconSize, { color: GOLD });
      ctx.restore();
    } else {
      drawTabletopIcon(ctx, 'ammo', iconX, iconY, iconSize, {
        color: dry || low ? GOLD : UI_COLORS.hudPlateInk,
      });
    }

    if (!reloading) {
      ctx.font = `900 ${Math.round(10 * hu)}px ${UI_FONTS.mono}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = dry || low ? GOLD : UI_COLORS.hudPlateInk;
      ctx.fillText(hasMag ? `${player.ammo}` : '--', x + plateW - 4 * hu, iconY);
    }

    if (reloading) {
      const barH = 2.5 * hu;
      const barY = y + plateH - barH;
      ctx.fillStyle = UI_COLORS.hudDim;
      ctx.fillRect(x, barY, plateW, barH);
      ctx.fillStyle = GOLD;
      ctx.fillRect(x, barY, plateW * clamp01(player.reload), barH);
    }

    curY += plateH + stackGap;
  }

  // 2. Can (Kalpler): Yalnız hasar alındığında görünür
  if (isDamaged) {
    const totalW = player.hpMax * heartSize + (player.hpMax - 1) * heartGap;
    const startX = player.x - totalW / 2;
    const heartY = curY + heartSize / 2;
    for (let i = 0; i < player.hpMax; i++) {
      const filled = i < player.hp;
      drawTabletopIcon(ctx, 'heart', startX + i * (heartSize + heartGap) + heartSize / 2, heartY, heartSize, {
        color: filled ? player.color : UI_COLORS.hudEmpty,
      });
    }
  }
}

function drawLoadoutCrate(ctx, crate, now) {
  const claimed = crate.claimedBy !== null;
  const pulse = 1 + Math.sin(now / 240 + crate.id) * 0.05;
  ctx.save();
  ctx.translate(crate.x, crate.y);
  ctx.scale(pulse, pulse);
  ctx.globalAlpha = claimed ? 0.32 : 1;
  ctx.fillStyle = INK;
  ctx.fillRect(-24, -24, 52, 52);
  const cu = 1;
  ctx.fillStyle = '#FAF7F2';
  ctx.fillRect(-27, -27, 50, 50);
  ctx.strokeStyle = crate.color;
  ctx.lineWidth = Math.max(2, 5 * cu);
  ctx.strokeRect(-27, -27, 50, 50);
  ctx.fillStyle = crate.color;
  ctx.fillRect(-22, -22, 40, 8);

  if (crate.kind === 'upgrade') {
    const meta = HORDE_UPGRADES[crate.upgradeId];
    drawTabletopIcon(ctx, meta?.icon || 'sparkles', -2, 1, 28, { color: crate.color, accentColor: crate.color });
  } else if (crate.weaponId === 'BLADE') {
    ctx.strokeStyle = crate.color;
    ctx.lineWidth = Math.max(2, 7 * cu);
    ctx.beginPath();
    ctx.moveTo(-14, 14); ctx.lineTo(15, -15);
    ctx.stroke();
    ctx.strokeStyle = FLASH;
    ctx.lineWidth = Math.max(1, 2 * cu);
    ctx.stroke();
  } else {
    const rifle = crate.weaponId === 'RIFLE';
    const shotgun = crate.weaponId === 'SHOTGUN';
    ctx.fillStyle = crate.color;
    ctx.fillRect(-16, -4, rifle ? 38 : shotgun ? 31 : 25, shotgun ? 10 : 8);
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, 3 * cu);
    ctx.strokeRect(-16, -4, rifle ? 38 : shotgun ? 31 : 25, shotgun ? 10 : 8);
  }

  if (claimed) {
    ctx.fillStyle = crate.color;
    ctx.beginPath();
    ctx.arc(18, 18, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = '900 8px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = INK;
  ctx.fillText(
    t(crate.kind === 'weapon' ? `horde.weapon.${crate.weaponId}` : `horde.upgrade.${crate.upgradeId}`),
    0,
    31,
  );
  ctx.restore();
}

export function drawHordeWorld(ctx, arena, scene, { withFx = true, now = typeof performance !== 'undefined' ? performance.now() : 0, selfSlot = -1 } = {}) {
  drawHordeArena(ctx, arena, scene.theme);

  for (const obstacle of scene.obstacles || []) {
    // Deri artık MOTORDA SEÇİLMİYOR: harita teması `FIELD_THEMES[*].block`
    // üzerinden gelir (foundry→crate, reactor→metal, core→dark).
    drawObstacle(ctx, obstacle, { theme: scene.theme });
  }

  if (scene.portal) drawExtractionGate(ctx, scene.portal, now);
  for (const crate of scene.loadoutCrates || []) drawLoadoutCrate(ctx, crate, now);
  for (const pickup of scene.pickups || []) drawPickup(ctx, pickup, { size: pickup.size });

  const u = arena?.unit ?? (arena?.size ? arena.size / 952 : 1);
  for (const tomb of scene.tombs || []) {
    ctx.save();
    ctx.translate(tomb.x, tomb.y);
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(0, 0, 15 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = FLASH;
    ctx.lineWidth = Math.max(1, 3 * u);
    ctx.beginPath();
    ctx.moveTo(-6 * u, 0); ctx.lineTo(6 * u, 0);
    ctx.moveTo(0, -6 * u); ctx.lineTo(0, 6 * u);
    ctx.stroke();
    ctx.strokeStyle = '#2ECC71';
    ctx.lineWidth = Math.max(1.5, 5 * u);
    ctx.beginPath();
    ctx.arc(0, 0, 21 * u, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp01(tomb.progress));
    ctx.stroke();
    ctx.restore();
  }

  // Perf: tüm mermiler tek save/restore ile çizilir (64+ state push/pop kaldırıldı)
  const bullets = scene.bullets;
  if (bullets && bullets.length > 0) {
    ctx.save();
    ctx.lineCap = 'round';
    for (const bullet of bullets) {
      if (bullet.enemy) {
        ctx.fillStyle = bullet.color || BLOOD;
        ctx.strokeStyle = FLASH;
        // Mermi konturu saha ölçeğiyle büyür (I6): sabit 1.5 px telefonda
        // kalın flaşı yok ediyordu. Taban 1 px — ince ekranda kaybolmasın.
        ctx.lineWidth = Math.max(1, 1.5 * u);
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, Math.max(3, bullet.radius) + 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.strokeStyle = bullet.color || '#D84727';
        ctx.lineWidth = Math.max(3, bullet.radius);
        ctx.beginPath();
        ctx.moveTo(bullet.x, bullet.y);
        ctx.lineTo(bullet.x - bullet.vx * 0.025, bullet.y - bullet.vy * 0.025);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  for (const enemy of scene.enemies || []) drawEnemy(ctx, enemy, withFx, now, scene.obstacles || []);
  drawHordePlayers(ctx, scene.players || [], { withFx, now, selfSlot });
  drawAlphaTexts(ctx, scene.texts || [], { size: 15, outline: true });
}

export function drawHordeFxLayer(ctx, layer) {
  drawFxPops(ctx, layer?.pops);
  drawFxRings(ctx, layer?.rings);
  drawCircleParticles(ctx, layer?.particles);
}

// Maç başlığı verisi (host + world-view istemcisi ortak): tur/dalga + sayaç.
// Çizim `ui/hud.renderMatchHeader`'dadır; bu dosya yalnız metni üretir.
export function hordeHeaderStatus(source = {}) {
  const state = source.state || source.phase || 'PLAYING';
  const inArmory = state === 'ROUND_PAUSE';
  const round = Math.max(1, Math.round(source.round || 1));
  const wave = Math.max(1, Math.round(source.wave || 1));
  const totalRounds = Math.max(1, Math.round(source.totalRounds || 3));
  const totalWaves = Math.max(1, Math.round(source.totalWaves || 3));
  const hasPortal = source.hasPortal ?? source.portal != null;
  const label = inArmory
    ? t('horde.armory')
    : source.isBossWave
      ? t('horde.bossWave')
      : t('horde.progress', round, totalRounds, wave, totalWaves);
  const sub = inArmory
    ? t('horde.armoryTimer', Math.ceil(Number(source.roundBreakTime) || 0))
    : hasPortal
      ? t('horde.portalReady')
      : Number(source.waveBreakTime) > 0
        ? t('horde.nextWave', Math.ceil(Number(source.waveBreakTime) || 0))
        : '';
  return {
    text: sub ? `${label} • ${sub}` : label,
    tone: source.isBossWave ? 'boss' : (inArmory || hasPortal ? 'armory' : null),
  };
}
