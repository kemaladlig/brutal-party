// BRUTAL HORDE — host/client ortak dünya snapshot'ı ve çizim sınırı.
// Client bu dosyadan yalnız salt-okunur draw + validation kullanır; simülasyon/AI import etmez.

import { drawObstacle } from '../core/arenaKit.js';
import { drawField, hashFieldSeed } from '../core/fieldKit.js';
import { computeAvatarKineticDeformation, drawGameAvatar } from '../core/avatarInGame.js';
import { fxReadAlpha } from '../core/fxKit.js';
import { segmentAabbIntersection } from '../core/physics2d.js';
import { drawTabletopIcon } from '../core/tabletopIcons.js';
import { getFireCooldownProgress, getFireFeedbackSnapshot, isValidFireFeedbackSnapshot } from '../core/fireFeedback.js';
import { drawDioramaShadow } from '../core/dioramaKit.js';
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
  const progress = clamp01(portal.progress || 0);
  const R = (portal.r || 30) * 1.35;
  ctx.save();
  ctx.translate(portal.x, portal.y);
  ctx.rotate(rotations[portal.side] || 0);

  ctx.fillStyle = '#7C3AED';
  ctx.save();
  ctx.globalAlpha = 0.2 + Math.sin(now / 240) * 0.05;
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const glow = 0.42 + Math.sin(now / 130) * 0.1 + progress * 0.2;
  ctx.save();
  ctx.globalAlpha = Math.max(0.2, Math.min(0.75, glow));
  ctx.beginPath();
  ctx.arc(0, 0, R * (0.62 + progress * 0.4), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2, 5 * pu);
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.98, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = Math.max(2, 4 * pu);
  ctx.lineCap = 'round';
  const spin = now / 320 + progress * 12;
  for (let i = 0; i < 3; i++) {
    const r = R * (0.78 - i * 0.16);
    ctx.beginPath();
    ctx.arc(0, 0, r, spin + i * 2.1, spin + i * 2.1 + Math.PI * 1.2);
    ctx.stroke();
  }
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = FLASH;
  ctx.lineWidth = Math.max(1.2, 2 * pu);
  ctx.lineCap = 'round';
  const back = -now / 420;
  for (let i = 0; i < 3; i++) {
    const r = R * (0.7 - i * 0.16);
    ctx.beginPath();
    ctx.arc(0, 0, r, back + i * 2.1, back + i * 2.1 + Math.PI * 0.7);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.fillStyle = FLASH;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.2, 1.8 * pu);
  const chevR = R * 1.08;
  const chevS = Math.max(3, 7 * pu);
  const bob = Math.sin(now / 180) * 2 * pu;
  for (const fx of [-1, 0, 1]) {
    const cx = fx * chevS * 2.2;
    const cy = -chevR + bob;
    ctx.beginPath();
    ctx.moveTo(cx - chevS, cy);
    ctx.lineTo(cx, cy + chevS);
    ctx.lineTo(cx + chevS, cy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = INK;
  ctx.globalAlpha = 0.65;
  ctx.lineWidth = Math.max(2, 5 * pu);
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.42, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = FLASH;
  ctx.lineWidth = Math.max(1.5, 3 * pu);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.42, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.restore();

  ctx.fillStyle = GOLD;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.16 * (1 + progress * 1.6), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = FLASH;
  ctx.beginPath();
  ctx.arc(-R * 0.03, -R * 0.04, R * 0.06 * (1 + progress), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

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

function traceTankHull(ctx, r) {
  const c = r * 0.38;
  ctx.beginPath();
  ctx.moveTo(-r + c, -r);
  ctx.lineTo(r - c, -r);
  ctx.arcTo(r, -r, r, -r + c, c);
  ctx.lineTo(r, r - c);
  ctx.arcTo(r, r, r - c, r, c);
  ctx.lineTo(-r + c, r);
  ctx.arcTo(-r, r, -r, r - c, c);
  ctx.lineTo(-r, -r + c);
  ctx.arcTo(-r, -r, -r + c, -r, c);
  ctx.closePath();
}

function traceHexHull(ctx, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function traceDiamondHull(ctx, r) {
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r, 0);
  ctx.lineTo(0, r);
  ctx.lineTo(-r, 0);
  ctx.closePath();
}

function paintEnemyVolume(ctx, r) {
  ctx.save();
  ctx.globalAlpha = 0.26;
  ctx.fillStyle = FLASH;
  ctx.beginPath();
  ctx.ellipse(-r * 0.28, -r * 0.34, r * 0.42, r * 0.24, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(r * 0.05, r * 0.48, r * 0.62, r * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawEnemyBackSpikes(ctx, r, eu) {
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, 2 * eu);
  ctx.lineJoin = 'round';
  for (const oy of [-0.62, 0, 0.62]) {
    const bx = -r * 0.86;
    const by = r * oy;
    const tipX = -r * 1.28;
    ctx.beginPath();
    ctx.moveTo(bx, by - r * 0.16);
    ctx.lineTo(tipX, by);
    ctx.lineTo(bx, by + r * 0.16);
    ctx.closePath();
    ctx.fill();
  }
}

function drawChaserFace(ctx, r, eu) {
  const eyeR = r * 0.21;
  const eyeX = r * 0.28;
  const eyeY = r * 0.30;
  for (const side of [-1, 1]) {
    const ey = eyeY * side;
    ctx.fillStyle = UI_COLORS.faceWhite;
    ctx.beginPath();
    ctx.arc(eyeX, ey, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = UI_COLORS.faceInk;
    ctx.lineWidth = Math.max(1, 1.6 * eu);
    ctx.stroke();
    ctx.fillStyle = UI_COLORS.faceInk;
    ctx.beginPath();
    ctx.arc(eyeX + eyeR * 0.28, ey, eyeR * 0.48, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = UI_COLORS.faceWhite;
    ctx.beginPath();
    ctx.arc(eyeX + eyeR * 0.42, ey - eyeR * 0.22, eyeR * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.2, 2.4 * eu);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(eyeX - eyeR * 1.1, -eyeY - eyeR * 1.15);
  ctx.lineTo(eyeX + eyeR * 0.9, -eyeY - eyeR * 0.45);
  ctx.moveTo(eyeX - eyeR * 1.1, eyeY + eyeR * 1.15);
  ctx.lineTo(eyeX + eyeR * 0.9, eyeY + eyeR * 0.45);
  ctx.stroke();
  ctx.lineCap = 'butt';
  const mx = r * 0.58;
  const mw = r * 0.20;
  const mh = r * 0.20;
  ctx.fillStyle = UI_COLORS.mouthDark;
  ctx.beginPath();
  ctx.ellipse(mx, 0, mw, mh, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = FLASH;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(mx - mw * 0.55, side * mh * 0.85);
    ctx.lineTo(mx - mw * 0.15, side * mh * 0.85);
    ctx.lineTo(mx - mw * 0.35, side * mh * 0.25);
    ctx.closePath();
    ctx.fill();
  }
}

function drawShooterFace(ctx, r, eu, isEliteOrBoss) {
  const barrelLen = r * 0.62;
  const barrelThick = Math.max(2, r * 0.24);
  ctx.fillStyle = INK;
  ctx.fillRect(r * 0.52, -barrelThick / 2, barrelLen, barrelThick);
  ctx.fillStyle = isEliteOrBoss ? GOLD : FLASH;
  ctx.fillRect(r * 0.52 + barrelLen - Math.max(2, r * 0.12), -barrelThick / 2, Math.max(2, r * 0.12), barrelThick);
  const visorW = r * 0.52;
  const visorH = Math.max(3, r * 0.30);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(r * 0.08, 0, visorW / 2, visorH / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  const lensR = Math.max(2, r * 0.11);
  for (const side of [-1, 1]) {
    ctx.fillStyle = isEliteOrBoss ? GOLD : FLASH;
    ctx.beginPath();
    ctx.arc(r * 0.14, side * r * 0.13, lensR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(r * 0.17, side * r * 0.13, lensR * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, 2 * eu);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-r * 0.55, -r * 0.42);
  ctx.lineTo(-r * 0.30, -r * 0.52);
  ctx.moveTo(-r * 0.55, r * 0.42);
  ctx.lineTo(-r * 0.30, r * 0.52);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

function drawTankFace(ctx, r, eu, isEliteOrBoss, hpRatio) {
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, 2 * eu);
  ctx.beginPath();
  ctx.moveTo(-r * 0.78, -r * 0.34);
  ctx.lineTo(r * 0.78, -r * 0.34);
  ctx.moveTo(-r * 0.78, r * 0.34);
  ctx.lineTo(r * 0.78, r * 0.34);
  ctx.stroke();
  ctx.restore();
  const rivetR = Math.max(1.2, r * 0.07);
  ctx.fillStyle = FLASH;
  for (const rx of [-0.62, 0.62]) {
    for (const ry of [-0.62, 0.62]) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(r * rx, r * ry, rivetR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  const slitW = r * 0.62;
  const slitH = Math.max(3, r * 0.30);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(r * 0.12, 0, slitW / 2, slitH / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  const eyeR = Math.max(2, r * 0.10);
  for (const side of [-1, 1]) {
    ctx.fillStyle = isEliteOrBoss ? GOLD : FLASH;
    ctx.beginPath();
    ctx.arc(r * 0.18, side * r * 0.13, eyeR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, 1.8 * eu);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = -1; i <= 1; i++) {
    ctx.moveTo(r * 0.42 + i * r * 0.12, r * 0.34);
    ctx.lineTo(r * 0.42 + i * r * 0.12, r * 0.52);
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
  if (hpRatio < 0.5) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, 1.6 * eu);
    ctx.beginPath();
    ctx.moveTo(-r * 0.55, -r * 0.62);
    ctx.lineTo(-r * 0.25, -r * 0.30);
    ctx.lineTo(-r * 0.45, -r * 0.05);
    ctx.stroke();
  }
}

function drawHealerFace(ctx, r, eu) {
  const eyeR = r * 0.18;
  const eyeX = r * 0.22;
  const eyeY = r * 0.28;
  for (const side of [-1, 1]) {
    ctx.fillStyle = UI_COLORS.faceWhite;
    ctx.beginPath();
    ctx.arc(eyeX, side * eyeY, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = UI_COLORS.faceInk;
    ctx.lineWidth = Math.max(1, 1.5 * eu);
    ctx.stroke();
    ctx.fillStyle = UI_COLORS.faceInk;
    ctx.beginPath();
    ctx.arc(eyeX + eyeR * 0.22, side * eyeY, eyeR * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = UI_COLORS.faceWhite;
    ctx.beginPath();
    ctx.arc(eyeX + eyeR * 0.34, side * eyeY - eyeR * 0.2, eyeR * 0.13, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = UI_COLORS.faceInk;
  ctx.lineWidth = Math.max(1, 1.6 * eu);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(r * 0.42, 0, r * 0.16, -0.9, 0.9);
  ctx.stroke();
  ctx.lineCap = 'butt';
  const arm = r * 0.30;
  const thick = Math.max(2, r * 0.13);
  ctx.save();
  ctx.translate(-r * 0.42, 0);
  ctx.fillStyle = UI_COLORS.faceWhite;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, 1.5 * eu);
  ctx.fillRect(-arm / 2, -thick / 2, arm, thick);
  ctx.strokeRect(-arm / 2, -thick / 2, arm, thick);
  ctx.fillRect(-thick / 2, -arm / 2, thick, arm);
  ctx.strokeRect(-thick / 2, -arm / 2, thick, arm);
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

  // Zemin Temas Gölgesi (Diorama Ground Shadow)
  drawDioramaShadow(ctx, enemy.x, enemy.y, enemy.r, {
    u: eu,
    aspect: 0.55,
    alpha: enemy.boss ? 0.36 : (enemy.elite ? 0.28 : 0.20),
  });

  ctx.save();
  ctx.translate(enemy.x, enemy.y);
  ctx.rotate(enemy.angle || 0);
  // Vuruş: gövdeyi saf beyaza boyamak türün rengini ve silueti siliyordu.
  // Gövde kendi renginde kalır, kontur parlar ve gövde anlık büyür.
  const flinch = enemy.hit && withFx ? 1.12 : 1;
  if (flinch !== 1) ctx.scale(flinch, flinch);
  const fill = enemy.type === 'shooter'
    ? '#7C3AED'
    : enemy.type === 'tank'
      ? '#334155'
      : enemy.type === 'healer'
        ? '#16A34A'
        : BLOOD;
  const isEliteOrBoss = enemy.boss || enemy.elite;
  const hpRatio = clamp01(enemy.hp / enemy.maxHp);
  if (enemy.type === 'chaser') drawEnemyBackSpikes(ctx, enemy.r, eu);
  ctx.fillStyle = fill;
  ctx.strokeStyle = isEliteOrBoss ? GOLD : INK;
  ctx.lineWidth = Math.max(1.5, (enemy.boss ? 5 : 3) * eu);
  ctx.lineJoin = 'round';
  if (enemy.type === 'tank') {
    traceTankHull(ctx, enemy.r);
  } else if (enemy.type === 'healer') {
    traceDiamondHull(ctx, enemy.r);
  } else if (enemy.type === 'shooter') {
    traceHexHull(ctx, enemy.r);
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, enemy.r, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
  paintEnemyVolume(ctx, enemy.r);
  if (enemy.type === 'chaser') {
    drawChaserFace(ctx, enemy.r, eu);
  } else if (enemy.type === 'shooter') {
    drawShooterFace(ctx, enemy.r, eu, isEliteOrBoss);
  } else if (enemy.type === 'tank') {
    drawTankFace(ctx, enemy.r, eu, isEliteOrBoss, hpRatio);
  } else if (enemy.type === 'healer') {
    drawHealerFace(ctx, enemy.r, eu);
  }
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
  ctx.restore();
  if (enemy.boss) {
    const crownW = enemy.r * 0.92;
    const crownH = Math.max(4, enemy.r * 0.42);
    const crownY = enemy.y - enemy.r - barGap - barH - crownH;
    ctx.save();
    ctx.translate(enemy.x, crownY);
    const bob = Math.sin(now / 300) * Math.max(1, enemy.r * 0.04);
    ctx.translate(0, bob);
    ctx.fillStyle = GOLD;
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.2, 2.4 * eu);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-crownW / 2, 0);
    ctx.lineTo(-crownW / 2, -crownH * 0.55);
    ctx.lineTo(-crownW * 0.25, -crownH * 0.15);
    ctx.lineTo(0, -crownH);
    ctx.lineTo(crownW * 0.25, -crownH * 0.15);
    ctx.lineTo(crownW / 2, -crownH * 0.55);
    ctx.lineTo(crownW / 2, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = FLASH;
    ctx.beginPath();
    ctx.arc(0, -crownH, Math.max(1.5, crownH * 0.14), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

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
    const R = player.radius || 30;
    const barrel = player.weaponBarrel;
    const isRifle = barrel === 'rifle';
    const isShotgun = barrel === 'shotgun';
    const isSmg = barrel === 'smg';
    const gunLen = R * (isRifle ? 1.45 : isShotgun ? 0.9 : isSmg ? 1.05 : 0.95);
    const gunThick = R * (isShotgun ? 0.42 : isRifle ? 0.22 : isSmg ? 0.28 : 0.26);
    const baseX = R * 0.35;
    const tipX = baseX + gunLen;
    if (player.aiming) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = player.weaponColor;
      ctx.lineWidth = Math.max(1.5, 2.5 * u);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tipX, 0);
      ctx.lineTo(tipX + R * 0.9, 0);
      ctx.stroke();
      ctx.restore();
    }
    ctx.lineJoin = 'round';
    ctx.fillStyle = INK;
    ctx.fillRect(baseX - 2 * u, -gunThick / 2 - 2 * u, gunLen + 4 * u, gunThick + 4 * u);
    ctx.fillStyle = player.weaponColor;
    ctx.fillRect(baseX, -gunThick / 2, gunLen, gunThick);
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, 1.6 * u);
    ctx.strokeRect(baseX, -gunThick / 2, gunLen, gunThick);
    if (isShotgun) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1, 1.4 * u);
      ctx.beginPath();
      ctx.moveTo(baseX + gunLen * 0.15, 0);
      ctx.lineTo(baseX + gunLen * 0.95, 0);
      ctx.stroke();
    } else if (isRifle) {
      ctx.fillStyle = INK;
      ctx.fillRect(baseX + gunLen * 0.45, -gunThick / 2 - 3.5 * u, 7 * u, 3.5 * u);
      ctx.fillStyle = FLASH;
      ctx.fillRect(tipX - 2 * u, -gunThick / 2 + 1 * u, 2 * u, gunThick - 2 * u);
    } else if (isSmg) {
      ctx.fillStyle = INK;
      ctx.fillRect(baseX + gunLen * 0.35, gunThick / 2, 6 * u, 5 * u);
    } else {
      ctx.fillStyle = FLASH;
      ctx.beginPath();
      ctx.arc(baseX + gunLen * 0.72, 0, Math.max(1.2, gunThick * 0.16), 0, Math.PI * 2);
      ctx.fill();
    }
    const justFired = typeof player.fireCooldown === 'number' && player.fireCooldown < 0.45;
    if (player.aiming || justFired) {
      ctx.save();
      ctx.globalAlpha = justFired ? 0.95 : 0.55;
      ctx.fillStyle = FLASH;
      ctx.beginPath();
      ctx.arc(tipX + 1 * u, 0, Math.max(2, gunThick * 0.42), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = justFired ? 0.5 : 0.25;
      ctx.fillStyle = player.weaponColor;
      ctx.beginPath();
      ctx.arc(tipX + 1 * u, 0, Math.max(3, gunThick * 0.8), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
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
    // Horde twin-stick: squash hareket yönüne bakarsa nişan yönünden ayrılıp
    // gövde yandan basılmış gibi duruyordu. Diğer modlarda ikisi aynı yön,
    // burada ayrı. Büyüklük aynı dil, açı hep namluya kilitli.
    const rawSquash = computeAvatarKineticDeformation(
      { ...player, facingAngle: player.angle, angle: player.angle },
      { facingAngle: player.angle },
    );
    const tame = 0.18;
    const squashX = 1 + (rawSquash.squashX - 1) * tame;
    const squashY = 1 + (rawSquash.squashY - 1) * tame;
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
      // Horde twin-stick: tam squash nişan okumasını bozuyordu, sıfırlamak
      // hissi öldürüyordu. Diğer modlarla aynı dil, dozu kısık, açı namluda.
      squashX,
      squashY,
      squashAngle: player.angle || 0,
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

function hordePickupStyle(type) {
  if (type === 'HEAL') return { bg: UI_COLORS.success, ink: UI_COLORS.faceWhite, icon: 'heart' };
  if (type === 'SHIELD') return { bg: UI_COLORS.hudShield, ink: UI_COLORS.faceWhite, icon: 'shield' };
  if (type === 'FAST') return { bg: UI_COLORS.gold, ink: UI_COLORS.ink, icon: 'zap' };
  return { bg: UI_COLORS.danger, ink: UI_COLORS.faceWhite, icon: 'flame' };
}

function drawHordePickup(ctx, pickup, u) {
  const half = Math.max(10 * u, (pickup.size || 30) / 2);
  const style = hordePickupStyle(pickup.type);
  const t = Number(pickup.animTime || 0);
  const pulse = 1 + Math.sin(t * 5.2) * 0.05;
  const hover = (Math.sin(t * 4.1) + 1) / 2;
  ctx.save();
  ctx.translate(pickup.x, pickup.y);
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = style.bg;
  ctx.beginPath();
  ctx.ellipse(0, half * 0.42, half * 1.25, half * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.translate(0, -hover * half * 0.18);
  ctx.scale(pulse, pulse);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(0, half * 0.1, half, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = style.bg;
  ctx.beginPath();
  ctx.arc(0, 0, half * 0.92, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = FLASH;
  ctx.beginPath();
  ctx.ellipse(-half * 0.28, -half * 0.34, half * 0.4, half * 0.22, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.5, half * 0.12);
  ctx.beginPath();
  ctx.arc(0, 0, half * 0.92, 0, Math.PI * 2);
  ctx.stroke();
  if (pickup.type === 'HEAL') {
    const arm = half * 0.62;
    const thick = Math.max(2, half * 0.26);
    ctx.fillStyle = style.ink;
    ctx.fillRect(-arm / 2, -thick / 2, arm, thick);
    ctx.fillRect(-thick / 2, -arm / 2, thick, arm);
  } else {
    drawTabletopIcon(ctx, style.icon, 0, 0, Math.round(half * 1.05), { color: style.ink });
  }
  ctx.restore();
}

function drawLoadoutCrate(ctx, crate, now, arena) {
  const claimed = crate.claimedBy !== null;
  const u = arena?.unit ?? (arena?.size ? arena.size / 952 : 1);
  const half = Math.max(20, 30 * u);
  const pulse = 1 + Math.sin(now / 240 + (crate.id || 0)) * 0.04;
  ctx.save();
  ctx.translate(crate.x, crate.y);
  if (!claimed) {
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = crate.color;
    ctx.beginPath();
    ctx.arc(0, 0, half * 1.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.scale(pulse, pulse);
  ctx.globalAlpha = claimed ? 0.35 : 1;
  ctx.fillStyle = INK;
  ctx.fillRect(-half - 3 * u, -half - 3 * u, (half + 3 * u) * 2, (half + 3 * u) * 2);
  ctx.fillStyle = UI_COLORS.crownPaperLight;
  ctx.fillRect(-half, -half, half * 2, half * 2);
  ctx.strokeStyle = crate.color;
  ctx.lineWidth = Math.max(2, 4 * u);
  ctx.strokeRect(-half, -half, half * 2, half * 2);
  ctx.fillStyle = crate.color;
  ctx.fillRect(-half, -half, half * 2, Math.max(3, 7 * u));

  if (crate.kind === 'upgrade') {
    const meta = HORDE_UPGRADES[crate.upgradeId];
    drawTabletopIcon(ctx, meta?.icon || 'sparkles', 0, half * 0.18, Math.round(half * 0.95), { color: crate.color, accentColor: crate.color });
  } else if (crate.weaponId === 'BLADE') {
    ctx.strokeStyle = crate.color;
    ctx.lineWidth = Math.max(2, 6 * u);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-half * 0.5, half * 0.5); ctx.lineTo(half * 0.55, -half * 0.55);
    ctx.stroke();
    ctx.strokeStyle = FLASH;
    ctx.lineWidth = Math.max(1, 1.8 * u);
    ctx.stroke();
    ctx.lineCap = 'butt';
  } else {
    const rifle = crate.weaponId === 'RIFLE';
    const shotgun = crate.weaponId === 'SHOTGUN';
    const w = half * (rifle ? 1.25 : shotgun ? 1.05 : 0.9);
    const h = Math.max(3, half * (shotgun ? 0.34 : 0.26));
    ctx.fillStyle = INK;
    ctx.fillRect(-w / 2 - 1.5 * u, -h / 2 - 1.5 * u + half * 0.15, w + 3 * u, h + 3 * u);
    ctx.fillStyle = crate.color;
    ctx.fillRect(-w / 2, -h / 2 + half * 0.15, w, h);
    ctx.fillStyle = FLASH;
    ctx.fillRect(w / 2 - 3 * u, -h / 2 + half * 0.15, 3 * u, h);
  }

  if (claimed) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = crate.color;
    ctx.beginPath();
    ctx.arc(half * 0.72, half * 0.72, Math.max(3, 4.5 * u), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = FLASH;
    ctx.lineWidth = Math.max(1.2, 1.8 * u);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(half * 0.72 - 2.4 * u, half * 0.72);
    ctx.lineTo(half * 0.72 - 0.4 * u, half * 0.72 + 2 * u);
    ctx.lineTo(half * 0.72 + 2.6 * u, half * 0.72 - 2.2 * u);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
  const fs = Math.max(9, Math.round(11 * u));
  ctx.font = '900 ' + fs + 'px ' + UI_FONTS.mono;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = INK;
  ctx.fillText(
    t(crate.kind === 'weapon' ? `horde.weapon.${crate.weaponId}` : `horde.upgrade.${crate.upgradeId}`),
    0,
    half + 5 * u,
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
  const u = arena?.unit ?? (arena?.size ? arena.size / 952 : 1);
  for (const crate of scene.loadoutCrates || []) drawLoadoutCrate(ctx, crate, now, arena);
  for (const pickup of scene.pickups || []) drawHordePickup(ctx, pickup, u);

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
        const er = Math.max(3, bullet.radius) + 1;
        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = bullet.color || BLOOD;
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, er + 3.5 * u, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = bullet.color || BLOOD;
        ctx.strokeStyle = FLASH;
        // Mermi konturu saha ölçeğiyle büyür (I6): sabit 1.5 px telefonda
        // kalın flaşı yok ediyordu. Taban 1 px — ince ekranda kaybolmasın.
        ctx.lineWidth = Math.max(1, 1.5 * u);
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, er, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, Math.max(1.2, er * 0.38), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = FLASH;
        ctx.beginPath();
        ctx.arc(bullet.x - er * 0.25, bullet.y - er * 0.28, Math.max(1, er * 0.22), 0, Math.PI * 2);
        ctx.fill();
      } else {
        const tailX = bullet.x - bullet.vx * 0.035;
        const tailY = bullet.y - bullet.vy * 0.035;
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = bullet.color || BLOOD;
        ctx.lineWidth = Math.max(3, bullet.radius) * 2.1;
        ctx.beginPath();
        ctx.moveTo(bullet.x, bullet.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = bullet.color || BLOOD;
        ctx.lineWidth = Math.max(3, bullet.radius);
        ctx.beginPath();
        ctx.moveTo(bullet.x, bullet.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();
        ctx.strokeStyle = FLASH;
        ctx.lineWidth = Math.max(1.2, Math.max(3, bullet.radius) * 0.45);
        ctx.beginPath();
        ctx.moveTo(bullet.x, bullet.y);
        ctx.lineTo(bullet.x - (bullet.x - tailX) * 0.45, bullet.y - (bullet.y - tailY) * 0.45);
        ctx.stroke();
        ctx.fillStyle = FLASH;
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, Math.max(1.4, bullet.radius * 0.5), 0, Math.PI * 2);
        ctx.fill();
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
