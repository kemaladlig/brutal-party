// BRUTAL HORDE — host/client ortak dünya snapshot'ı ve çizim sınırı.
// Client bu dosyadan yalnız salt-okunur draw + validation kullanır; simülasyon/AI import etmez.

import { drawObstacle, drawPickup } from '../core/arenaKit.js';
import { drawField, hashFieldSeed } from '../core/fieldKit.js';
import { drawGameAvatar } from '../core/avatarInGame.js';
import { segmentAabbIntersection } from '../core/physics2d.js';
import { isCompactLandscape } from '../core/playfield.js';
import { drawTabletopIcon } from '../core/tabletopIcons.js';
import { getFireCooldownProgress, getFireFeedbackSnapshot, isValidFireFeedbackSnapshot } from '../core/fireFeedback.js';
import { renderSpatialBadge } from '../ui/hud.js';
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
  isValidWorldBase,
  packRectList,
  round1,
} from './worldCore.js';

export const HORDE_VIEW_LIMITS = Object.freeze({
  enemies: 28,
  bullets: 64,
  tombs: 4,
  pickups: 4,
  texts: 8,
  particles: 48,
  obstacles: 16,
  loadoutCrates: 8,
});

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const ENEMY_TYPES = new Set(['chaser', 'shooter', 'tank', 'healer']);
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
  return {
    slot: player.index,
    joined: player.isJoined !== false,
    alive: player.isAlive !== false,
    x: round1(player.x || 0),
    y: round1(player.y || 0),
    radius: round1(player.radius || 15),
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
      color: typeof entry.color === 'string' ? entry.color : '#1A1A1A',
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
    enemies: scene.enemies.map((enemy) => ({
      id: enemy.id,
      x: enemy.x,
      y: enemy.y,
      r: enemy.r,
      angle: enemy.angle,
      hp: enemy.hp,
      maxHp: enemy.maxHp,
      type: enemy.type,
      boss: enemy.boss,
      elite: enemy.elite,
      hit: enemy.hit,
      spawning: enemy.spawning,
      spawnProgress: enemy.spawnProgress,
      telegraph: enemy.telegraph,
      lunging: enemy.lunging,
    })),
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
    extras: packHordeScene(scene),
    particleCap: HORDE_VIEW_LIMITS.particles,
  });
}

function isValidHordePlayer(player) {
  return !!player
    && typeof player.joined === 'boolean'
    && typeof player.alive === 'boolean'
    && finite(player.x) && finite(player.y) && finite(player.angle)
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
    && typeof player.swing === 'boolean';
}

function isValidHordeExtra(frame) {
  if (!Array.isArray(frame.enemies) || frame.enemies.length > HORDE_VIEW_LIMITS.enemies) return false;
  if (!frame.enemies.every((enemy) => enemy
    && Number.isInteger(enemy.id) && enemy.id >= 0
    && finite(enemy.x) && finite(enemy.y) && finite(enemy.r) && enemy.r > 0
    && finite(enemy.angle)
    && Number.isInteger(enemy.hp) && enemy.hp >= 0
    && Number.isInteger(enemy.maxHp) && enemy.maxHp > 0
    && ENEMY_TYPES.has(enemy.type)
    && typeof enemy.boss === 'boolean'
    && typeof enemy.elite === 'boolean'
    && typeof enemy.hit === 'boolean'
    && typeof enemy.spawning === 'boolean'
    && finite(enemy.spawnProgress) && enemy.spawnProgress >= 0 && enemy.spawnProgress <= 1
    && typeof enemy.telegraph === 'boolean'
    && typeof enemy.lunging === 'boolean')) return false;

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
    enemies: Array.isArray(frame.enemies) ? frame.enemies : [],
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
  ctx.save();
  ctx.translate(portal.x, portal.y);
  ctx.rotate(rotations[portal.side] || 0);
  const pulse = 0.22 + Math.sin(now / 180) * 0.06;
  ctx.globalAlpha = pulse;
  ctx.fillStyle = '#7C3AED';
  ctx.fillRect(-portal.r, -portal.r * 0.62, portal.r * 2, portal.r * 1.24);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#1A1A1A';
  ctx.lineWidth = Math.max(2, 7 * pu);
  ctx.strokeRect(-portal.r, -portal.r * 0.62, portal.r * 2, portal.r * 1.24);
  ctx.strokeStyle = '#FACC15';
  ctx.lineWidth = Math.max(2, 7 * pu);
  ctx.beginPath();
  ctx.moveTo(-portal.r * 0.75, portal.r * 0.42);
  ctx.lineTo(portal.r * 0.75, portal.r * 0.42);
  ctx.stroke();
  ctx.fillStyle = '#FACC15';
  ctx.beginPath();
  ctx.moveTo(0, portal.r * 0.05);
  ctx.lineTo(-12, portal.r * 0.3);
  ctx.lineTo(12, portal.r * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawEnemy(ctx, enemy, withFx, now, obstacles = []) {
  const eu = (enemy.r || 14) / 14;
  if (enemy.spawning) {
    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    ctx.globalAlpha = 0.18 + enemy.spawnProgress * 0.35;
    ctx.strokeStyle = enemy.elite ? '#FACC15' : '#E63946';
    ctx.lineWidth = Math.max(1.5, 4 * eu);
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.arc(0, 0, enemy.r + 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.rotate(-now / 500);
    ctx.strokeStyle = '#FFFFFF';
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

  // Can çubuğu ölçeği: `enemy.r`'ye göreli. Mutlak taban (eski `Math.max(20, ...)`
  // ve 10px boşluk) telefonda düşman 9px'e küçülürken çubuğu 20px'te
  // tutuyordu — yani NPC "küçük" algısının bir kısmı çizimden geliyordu.
  const barW = Math.max(enemy.r * 1.5, enemy.r * 0.9);
  const barH = Math.max(2, enemy.r * 0.3);
  const barGap = Math.max(3, enemy.r * 0.55);

  ctx.save();
  ctx.translate(enemy.x, enemy.y);
  ctx.rotate(enemy.angle || 0);
  const fill = enemy.type === 'shooter'
    ? '#7C3AED'
    : enemy.type === 'tank'
      ? '#334155'
      : enemy.type === 'healer'
        ? '#16A34A'
        : '#E63946';
  ctx.fillStyle = enemy.hit && withFx ? '#FFFFFF' : fill;
  ctx.strokeStyle = enemy.boss || enemy.elite ? '#FACC15' : '#1A1A1A';
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
  } else {
    ctx.arc(0, 0, enemy.r, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
  if (enemy.elite && !enemy.boss) {
    ctx.strokeStyle = '#FFF7A3';
    ctx.lineWidth = Math.max(1, 2 * eu);
    ctx.stroke();
  }
  if (enemy.lunging) {
    ctx.strokeStyle = '#FACC15';
    ctx.lineWidth = Math.max(1.5, 4 * eu);
    ctx.beginPath();
    ctx.moveTo(-enemy.r - 10, 0);
    ctx.lineTo(-enemy.r, 0);
    ctx.stroke();
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(enemy.r * 0.45, -3, enemy.r * 0.55, 6);
  ctx.restore();

  const ratio = clamp01(enemy.hp / enemy.maxHp);
  ctx.save();
  ctx.fillStyle = '#1A1A1A';
  ctx.fillRect(enemy.x - barW / 2, enemy.y - enemy.r - barGap, barW, barH);
  ctx.fillStyle = enemy.boss || enemy.elite ? '#FACC15' : '#E63946';
  ctx.fillRect(enemy.x - barW / 2, enemy.y - enemy.r - barGap, barW * ratio, barH);
  ctx.restore();
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
  const u = (player.radius || 15) / 16;
  const k = u * WEAPON_REACH;
  ctx.save();
  ctx.rotate(player.angle || 0);
  if (player.weaponKind === 'melee') {
    if (player.swing) {
      ctx.strokeStyle = player.weaponColor;
      ctx.lineWidth = 8 * u;
      ctx.beginPath();
      ctx.arc(10 * k, 0, 54 * k, -0.8, 0.8);
      ctx.stroke();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.5 * u;
      ctx.stroke();
    }
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 5 * u;
    ctx.beginPath();
    ctx.moveTo(12 * k, 0);
    ctx.lineTo(38 * k, 0);
    ctx.stroke();
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
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 2 * u;
    ctx.strokeRect(13 * k, -thickness / 2, length, thickness);
  }
  ctx.restore();
}

function drawHordePlayers(ctx, players, { withFx = true, now = 0 } = {}) {
  const blink = Math.floor(now / 120) % 2 === 0;
  for (const player of players) {
    if (!player.joined || !player.alive) continue;
    if (withFx && player.invuln && blink) continue;

    // Oyuncu gövdesi ve çevresi `player.radius`'e bağlıdır. Sabit 15px idi:
    // telefonda çarpışma yarıçapı 8.9px'e düşerken gövde 15px'te kalıyordu,
    // yani çizilen oyuncu sahanın %1.7 katı büyüktü. "Biz büyüğüz" hissinin
    // ölçülebilir kaynağı buydu — yarıçap sabitleri doğruydu, çizim değil.
    const R = player.radius || 15;
    const u = R / 16;

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
    });
    ctx.restore();

    // Oyuncu çevresindeki HUD da gövde yarıçapına bağlıdır. Mutlak px'ler
    // tasarım boyutunda doğruydu ama telefonda şişiyordu: cooldown halkası 15px
    // sabit (gövde 5.7px), can pips'leri 27px YUKARIDA (4.7× gövde yarıçapı),
    // cephane çubuğu 32×24px (5.6×). Üçü birden oyuncunun çizilen yayılımını
    // gövdenin ~3.2 katına çıkarıyordu — düşman can çubuğundaki aynı hatanın
    // oyuncu tarafındaki hali. `u` tasarım yarıçapına (14) oran olduğu için
    // masaüstü tasarım BİREBİR korunur, sadece küçük sahada küçülür.
    const hu = R / 14;

    // Yuvarlak cooldown halkası KALDIRILDI. Kullanıcı geri bildirimi: "mermi
    // sıkarken karakterin etrafında yuvarlak olmasın, tepesinde azalan bar
    // olabilir". Halka ne olduğunu söylemiyordu; aşağıdaki şarjör barı hem
    // cephane hem bekleme durumunu tek bakışta okutuyor ve gövdeyi kapatmıyor.
    // `renderFireCooldown` yalnız oyun içi kalır; ARCHER/LASER kendi halkasını
    // kullanmaya devam ediyor.

    const pipW = 5 * hu;
    const pipGap = 3 * hu;
    const totalW = player.hpMax * pipW + (player.hpMax - 1) * pipGap;
    const startX = player.x - totalW / 2;
    for (let i = 0; i < player.hpMax; i++) {
      ctx.fillStyle = i < player.hp ? player.color : 'rgba(26, 26, 26, 0.22)';
      ctx.fillRect(startX + i * (pipW + pipGap), player.y - 27 * hu, pipW, 4 * hu);
    }

    if (player.weaponKind === 'gun') {
      // Şarjör göstergesi TEPEDE, can pip'larının ÜSTÜNDE. Eskisi gövdenin
      // altındaydı ve yuvarlak cooldown halkasıyla birlikte "ne olduğu belirsiz
      // iki çubuk" bırakıyordu. Dikey yığın (gövde yukarıdan aşağı):
      //   rozet (yalnız cephane bittiyse) → şarjör barı → can pip'ları
      const barW = 32 * hu;
      const x = player.x - barW / 2;
      const y = player.y - 36 * hu;
      const barH = 5 * hu;
      const ratio = player.magazine > 0 ? clamp01(player.ammo / player.magazine) : 0;
      const reloading = player.reloadTimer > 0;

      ctx.fillStyle = 'rgba(26, 26, 26, 0.45)';
      ctx.fillRect(x, y, barW, barH);
      // Dolduran kısım: doluyken silah rengi, doldurma sırasında altın.
      // Azalan çubuk = şarjör azalıyor; dolan çubuk = yeniden dolduruluyor.
      ctx.fillStyle = reloading ? '#FACC15' : (player.weaponColor || '#D99B26');
      ctx.fillRect(x, y, barW * (reloading ? clamp01(player.reload) : ratio), barH);
      // Son mermilerde uyarı: iki mermiden az kalınca kenarlık kırmızıya döner.
      if (!reloading && player.magazine > 0 && player.ammo > 0 && player.ammo <= 2) {
        ctx.strokeStyle = '#E63946';
        ctx.lineWidth = Math.max(1, 1.5 * hu);
        ctx.strokeRect(x - 0.5, y - 0.5, barW + 1, barH + 1);
      }
    }

    // Cephanesizken yalnız döngü ikonu — metin yok.
    //
    // Ölçülen iki hata: (1) "CEPHANE BİTTİ" yazısı sahanın üstünü boşa
    // kaplıyordu, ikon zaten anlamı taşıyor. (2) Sarı ikon (#FACC15) açık
    // krem gövde üstünde (#FAF7F2) — kontrast YOK, ikon görünmüyordu. Artık
    // koyu zemin + sarı ikon: ters çevirmekten başka yol yok, çünkü sarı
    // açık zeminde her zaman kaybolur.
    const dry = player.weaponKind === 'gun'
      && (player.reloadTimer > 0 || (player.magazine > 0 && player.ammo <= 0));
    if (dry) {
      renderSpatialBadge(ctx, {
        x: player.x,
        y: player.y - 46 * hu,
        icon: 'reload',
        text: '',
        bg: '#1A1A1A',
        borderColor: '#FACC15',
        color: '#FACC15',
        scale: Math.max(0.9, hu * 1.25),
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
  ctx.fillStyle = '#1A1A1A';
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
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = Math.max(1, 2 * cu);
    ctx.stroke();
  } else {
    const rifle = crate.weaponId === 'RIFLE';
    const shotgun = crate.weaponId === 'SHOTGUN';
    ctx.fillStyle = crate.color;
    ctx.fillRect(-16, -4, rifle ? 38 : shotgun ? 31 : 25, shotgun ? 10 : 8);
    ctx.strokeStyle = '#1A1A1A';
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
  ctx.fillStyle = '#1A1A1A';
  ctx.fillText(
    t(crate.kind === 'weapon' ? `horde.weapon.${crate.weaponId}` : `horde.upgrade.${crate.upgradeId}`),
    0,
    31,
  );
  ctx.restore();
}

export function drawHordeWorld(ctx, arena, scene, { withFx = true, now = typeof performance !== 'undefined' ? performance.now() : 0 } = {}) {
  drawHordeArena(ctx, arena, scene.theme);

  for (const obstacle of scene.obstacles || []) {
    drawObstacle(ctx, obstacle, { variant: scene.theme === 'reactor' ? 'dark' : scene.theme === 'core' ? 'stone' : 'crate' });
  }

  if (scene.portal) drawExtractionGate(ctx, scene.portal, now);
  for (const crate of scene.loadoutCrates || []) drawLoadoutCrate(ctx, crate, now);
  for (const pickup of scene.pickups || []) drawPickup(ctx, pickup, { size: pickup.size });

  const u = arena?.unit ?? (arena?.size ? arena.size / 952 : 1);
  for (const tomb of scene.tombs || []) {
    ctx.save();
    ctx.translate(tomb.x, tomb.y);
    ctx.fillStyle = '#1A1A1A';
    ctx.beginPath();
    ctx.arc(0, 0, 15 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
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

  for (const bullet of scene.bullets || []) {
    ctx.save();
    ctx.strokeStyle = bullet.color || (bullet.enemy ? '#E63946' : '#D84727');
    ctx.lineWidth = Math.max(3, bullet.radius);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(bullet.x, bullet.y);
    ctx.lineTo(bullet.x - bullet.vx * 0.025, bullet.y - bullet.vy * 0.025);
    ctx.stroke();
    ctx.restore();
  }

  for (const enemy of scene.enemies || []) drawEnemy(ctx, enemy, withFx, now, scene.obstacles || []);
  drawHordePlayers(ctx, scene.players || [], { withFx, now });
  drawAlphaTexts(ctx, scene.texts || [], { size: 15, outline: true });
}

export function drawHordeParticles(ctx, particles) {
  drawCircleParticles(ctx, particles);
}

export function drawHordeStatus(ctx, arena, scene) {
  const inArmory = scene.phase === 'ROUND_PAUSE';
  const mapName = t(`horde.map.${scene.theme}`);
  const label = inArmory
    ? `${t('horde.armory')} • ${mapName}`
    : scene.isBossWave
      ? `${t('horde.bossWave')} • ${mapName}`
      : `${t('horde.progress', scene.round, scene.totalRounds, scene.wave, scene.totalWaves)} • ${mapName}`;
  const sub = inArmory
    ? t('horde.armoryTimer', Math.ceil(scene.roundBreakTime))
    : scene.portal
      ? t('horde.portalReady')
      : scene.waveBreakTime > 0
        ? t('horde.nextWave', Math.ceil(scene.waveBreakTime))
        : '';
  // Yerleşim: masaüstü/tablette üst-ortada banner (geniş ekranda yer ucuz).
  // Kompakt yatayda (telefon) saha üst payı ~3px olduğu için ortada bir opak
  // bant oynanış alanının üstünü kesiyordu; sola yaslanıp daraltılıyor.
  // `window` yoksa (SSR, world-view packet testleri bu view'ı render eder)
  // kompakt sayılmaz — çizim kodu varlığa bağımlı olmamalı.
  const compact = !!(arena?.profile?.compactLandscape ?? isCompactLandscape(arena));
  // Chip ölçeği saha kısa kenarına bağlıdır: mutlak 44/58px yükseklik
  // telefonda saha yüksekliğinin %11'i idi, %4.7'ye indi.
  const u = (arena.size || 952) / 952;
  const labelFont = `900 ${Math.max(9, Math.round(14 * u))}px "Space Grotesk", sans-serif`;
  const subFont = `800 ${Math.max(7, Math.round(11 * u))}px "JetBrains Mono", monospace`;

  // Kutu İÇERİĞİNE GÖRE genişler. Sabit taban genişlik metni taşırıyordu:
  // telefonda kutu 122px, metin ~150px — metin kutudan taşıp sol duvarın
  // üstünde kesiliyordu. Ölçüm tabanı aşarsa kutu büyür, saha genişliğini
  // aşarsa kırpılır.
  ctx.save();
  ctx.font = labelFont;
  const labelW = ctx.measureText(label).width;
  ctx.font = subFont;
  const subW = sub ? ctx.measureText(sub).width : 0;
  const padX = 16 * u;
  const baseW = Math.min(arena.width * (compact ? 0.42 : 0.72), (compact ? 300 : 430) * u);
  const w = Math.max(baseW, Math.min(arena.width - 16 * u, Math.max(labelW, subW) + padX));
  const h = (sub ? 58 : 44) * u;
  const x = compact ? arena.left + 8 * u : arena.cx - w / 2;
  const y = arena.top + 8 * u;

  ctx.fillStyle = '#1A1A1A';
  ctx.fillRect(x + 4 * u, y + 4 * u, w, h);
  ctx.fillStyle = inArmory ? '#7C3AED' : scene.portal ? '#7C3AED' : scene.isBossWave ? '#B91C1C' : '#1A1A1A';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2.5 * u;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Metin KUTUNUN kendi merkezine hizalanır, sahanın değil. Kompakt yatayda kutu
  // sola yaslanır ama metin `arena.cx`'e göre kalırsa kutudan taşıp sol duvarın
  // üstüne biner (ölçülen görsel kusur).
  const textCx = x + w / 2;
  ctx.font = labelFont;
  ctx.fillText(label, textCx, y + (sub ? 19 * u : h / 2));
  if (sub) {
    ctx.font = subFont;
    ctx.fillText(sub, textCx, y + 41 * u);
  }
  ctx.restore();
}
