// BRUTAL HORDE — host/client ortak dünya snapshot'ı ve çizim sınırı.
// Client bu dosyadan yalnız salt-okunur draw + validation kullanır; simülasyon/AI import etmez.

import { drawObstacle, drawPickup } from '../core/arenaKit.js';
import { drawGameAvatar } from '../core/avatarInGame.js';
import { segmentAabbIntersection } from '../core/physics2d.js';
import { drawTabletopIcon } from '../core/tabletopIcons.js';
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
  return {
    slot: player.index,
    joined: player.isJoined !== false,
    alive: player.isAlive !== false,
    x: round1(player.x || 0),
    y: round1(player.y || 0),
    angle: round1(player.angle || 0),
    color: typeof player.color === 'string' ? player.color : '#D84727',
    hp: Math.max(0, Math.round(Number(player.hp) || 0)),
    hpMax: maxHp,
    dash: round1(1 - clamp01((Number(player.dashCooldown) || 0) / dashCd)),
    dashing: (Number(player.dashTimer) || 0) > 0,
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
    accessory: typeof player.accessory === 'string' ? player.accessory : 'NONE',
    pattern: typeof player.pattern === 'string' ? player.pattern : 'SOLID',
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
  const points = [
    { x: cx, y: top + 5, rotation: 0 },
    { x: right - 5, y: cy, rotation: Math.PI / 2 },
    { x: cx, y: bottom - 5, rotation: Math.PI },
    { x: left + 5, y: cy, rotation: -Math.PI / 2 },
  ][side];
  ctx.save();
  ctx.translate(points.x, points.y);
  ctx.rotate(points.rotation);
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 13 - 7, 13);
    ctx.lineTo(i * 13, 4);
    ctx.lineTo(i * 13 + 7, 13);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawHordeArena(ctx, arena, themeId = 'foundry', now = 0) {
  const theme = MAP_IDS.has(themeId) ? getHordeMap({ round: themeId === 'foundry' ? 1 : themeId === 'reactor' ? 2 : 3 }) : getHordeMap(1);
  const { left, top, right, bottom, width, height } = arena;
  ctx.save();
  ctx.fillStyle = theme.floor;
  ctx.fillRect(left, top, width, height);

  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  const cell = Math.max(34, Math.round(Math.min(width, height) / 11));
  for (let x = left + cell; x < right; x += cell) {
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
  }
  for (let y = top + cell; y < bottom; y += cell) {
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  }

  const inset = Math.min(width, height) * 0.055;
  ctx.strokeStyle = 'rgba(26, 26, 26, 0.14)';
  ctx.lineWidth = 3;
  ctx.strokeRect(left + inset, top + inset, width - inset * 2, height - inset * 2);

  ctx.save();
  ctx.translate(arena.cx, arena.cy);
  ctx.strokeStyle = theme.accent;
  ctx.globalAlpha = 0.12;
  ctx.lineWidth = 4;
  if (theme.motif === 'foundry') {
    const r = Math.min(width, height) * 0.21;
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r * 0.55, 0); ctx.lineTo(r * 0.55, 0);
    ctx.moveTo(0, -r * 0.55); ctx.lineTo(0, r * 0.55);
    ctx.stroke();
  } else if (theme.motif === 'reactor') {
    for (let i = 0; i < 3; i++) {
      const r = Math.min(width, height) * (0.10 + i * 0.065);
      ctx.strokeRect(-r, -r, r * 2, r * 2);
    }
  } else {
    const r = Math.min(width, height) * 0.19;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3 - Math.PI / 6;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();

  for (let side = 0; side < 4; side++) drawSpawnGate(ctx, arena, side, theme.accent);

  ctx.strokeStyle = '#1A1A1A';
  ctx.lineWidth = 7;
  ctx.strokeRect(left, top, width, height);
  ctx.restore();
}

function drawExtractionGate(ctx, portal, now) {
  const rotations = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  ctx.save();
  ctx.translate(portal.x, portal.y);
  ctx.rotate(rotations[portal.side] || 0);
  const pulse = 0.22 + Math.sin(now / 180) * 0.06;
  ctx.globalAlpha = pulse;
  ctx.fillStyle = '#7C3AED';
  ctx.fillRect(-portal.r, -portal.r * 0.62, portal.r * 2, portal.r * 1.24);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#1A1A1A';
  ctx.lineWidth = 7;
  ctx.strokeRect(-portal.r, -portal.r * 0.62, portal.r * 2, portal.r * 1.24);
  ctx.strokeStyle = '#FACC15';
  ctx.lineWidth = 7;
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
  if (enemy.spawning) {
    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    ctx.globalAlpha = 0.18 + enemy.spawnProgress * 0.35;
    ctx.strokeStyle = enemy.elite ? '#FACC15' : '#E63946';
    ctx.lineWidth = 4;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.arc(0, 0, enemy.r + 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.rotate(-now / 500);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 3;
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
    ctx.lineWidth = enemy.type === 'healer' ? 5 : 3;
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
  ctx.lineWidth = enemy.boss ? 5 : 3;
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
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  if (enemy.lunging) {
    ctx.strokeStyle = '#FACC15';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-enemy.r - 10, 0);
    ctx.lineTo(-enemy.r, 0);
    ctx.stroke();
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(enemy.r * 0.45, -3, enemy.r * 0.55, 6);
  ctx.restore();

  const barW = Math.max(20, enemy.r * 1.5);
  const ratio = clamp01(enemy.hp / enemy.maxHp);
  ctx.save();
  ctx.fillStyle = '#1A1A1A';
  ctx.fillRect(enemy.x - barW / 2, enemy.y - enemy.r - 10, barW, 5);
  ctx.fillStyle = enemy.boss || enemy.elite ? '#FACC15' : '#E63946';
  ctx.fillRect(enemy.x - barW / 2, enemy.y - enemy.r - 10, barW * ratio, 5);
  ctx.restore();
}

function drawPlayerWeapon(ctx, player) {
  ctx.save();
  ctx.rotate(player.angle || 0);
  if (player.weaponKind === 'melee') {
    if (player.swing) {
      ctx.strokeStyle = player.weaponColor;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(10, 0, 54, -0.8, 0.8);
      ctx.stroke();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(38, 0);
    ctx.stroke();
  } else {
    if (player.aiming) {
      ctx.strokeStyle = player.weaponColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(22, 0);
      ctx.lineTo(54, 0);
      ctx.stroke();
    }
    const barrel = player.weaponBarrel;
    const length = barrel === 'rifle' ? 34 : barrel === 'shotgun' ? 28 : barrel === 'smg' ? 24 : 19;
    const thickness = barrel === 'shotgun' ? 10 : barrel === 'rifle' ? 6 : 8;
    ctx.fillStyle = player.weaponColor;
    ctx.fillRect(13, -thickness / 2, length, thickness);
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 2;
    ctx.strokeRect(13, -thickness / 2, length, thickness);
  }
  ctx.restore();
}

function drawHordePlayers(ctx, players, { withFx = true, now = 0 } = {}) {
  const blink = Math.floor(now / 120) % 2 === 0;
  for (const player of players) {
    if (!player.joined || !player.alive) continue;
    if (withFx && player.invuln && blink) continue;

    ctx.save();
    ctx.translate(player.x, player.y);
    if (player.dashing) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = player.color;
      ctx.beginPath();
      ctx.arc(-18, 0, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (player.shield) {
      ctx.strokeStyle = '#06B6D4';
      ctx.lineWidth = 4;
      ctx.fillStyle = 'rgba(6, 182, 212, 0.18)';
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    drawPlayerWeapon(ctx, player);
    drawGameAvatar(ctx, 0, 0, 15, {
      ...player,
      index: player.slot,
      facingAngle: player.angle,
      color: player.color,
    }, {
      facingAngle: player.angle,
      expression: player.hp <= 1 ? 'PANIC' : player.fast || player.triple ? 'EXCITED' : player.expression,
      label: '',
      showPointer: false,
    });
    ctx.restore();

    const pipW = 5;
    const pipGap = 3;
    const totalW = player.hpMax * pipW + (player.hpMax - 1) * pipGap;
    const startX = player.x - totalW / 2;
    for (let i = 0; i < player.hpMax; i++) {
      ctx.fillStyle = i < player.hp ? player.color : 'rgba(26, 26, 26, 0.22)';
      ctx.fillRect(startX + i * (pipW + pipGap), player.y - 27, pipW, 4);
    }

    if (player.weaponKind === 'gun') {
      const barW = 32;
      const x = player.x - barW / 2;
      const y = player.y + 24;
      ctx.fillStyle = 'rgba(26, 26, 26, 0.35)';
      ctx.fillRect(x, y, barW, 4);
      if (player.reloading) {
        ctx.fillStyle = '#FACC15';
        ctx.fillRect(x, y, barW * clamp01(player.reload), 4);
      } else {
        const ratio = player.magazine > 0 ? clamp01(player.ammo / player.magazine) : 0;
        ctx.fillStyle = player.weaponColor;
        ctx.fillRect(x, y, barW * ratio, 4);
      }
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
  ctx.fillStyle = '#FAF7F2';
  ctx.fillRect(-27, -27, 50, 50);
  ctx.strokeStyle = crate.color;
  ctx.lineWidth = 5;
  ctx.strokeRect(-27, -27, 50, 50);
  ctx.fillStyle = crate.color;
  ctx.fillRect(-22, -22, 40, 8);

  if (crate.kind === 'upgrade') {
    const meta = HORDE_UPGRADES[crate.upgradeId];
    drawTabletopIcon(ctx, meta?.icon || 'sparkles', -2, 1, 28, { color: crate.color, accentColor: crate.color });
  } else if (crate.weaponId === 'BLADE') {
    ctx.strokeStyle = crate.color;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(-14, 14); ctx.lineTo(15, -15);
    ctx.stroke();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
    const rifle = crate.weaponId === 'RIFLE';
    const shotgun = crate.weaponId === 'SHOTGUN';
    ctx.fillStyle = crate.color;
    ctx.fillRect(-16, -4, rifle ? 38 : shotgun ? 31 : 25, shotgun ? 10 : 8);
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 3;
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
  drawHordeArena(ctx, arena, scene.theme, now);

  for (const obstacle of scene.obstacles || []) {
    drawObstacle(ctx, obstacle, { variant: scene.theme === 'reactor' ? 'dark' : scene.theme === 'core' ? 'stone' : 'crate' });
  }

  if (scene.portal) drawExtractionGate(ctx, scene.portal, now);
  for (const crate of scene.loadoutCrates || []) drawLoadoutCrate(ctx, crate, now);
  for (const pickup of scene.pickups || []) drawPickup(ctx, pickup, { size: pickup.size });

  for (const tomb of scene.tombs || []) {
    ctx.save();
    ctx.translate(tomb.x, tomb.y);
    ctx.fillStyle = '#1A1A1A';
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-6, 0); ctx.lineTo(6, 0);
    ctx.moveTo(0, -6); ctx.lineTo(0, 6);
    ctx.stroke();
    ctx.strokeStyle = '#2ECC71';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, 21, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp01(tomb.progress));
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
  const w = Math.min(arena.width * 0.72, 430);
  const h = sub ? 58 : 44;
  const x = arena.cx - w / 2;
  const y = arena.top + 14;

  ctx.save();
  ctx.fillStyle = '#1A1A1A';
  ctx.fillRect(x + 4, y + 4, w, h);
  ctx.fillStyle = inArmory ? '#7C3AED' : scene.portal ? '#7C3AED' : scene.isBossWave ? '#B91C1C' : '#1A1A1A';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 14px "Space Grotesk", sans-serif';
  ctx.fillText(label, arena.cx, y + (sub ? 19 : h / 2));
  if (sub) {
    ctx.font = '800 11px "JetBrains Mono", monospace';
    ctx.fillText(sub, arena.cx, y + 41);
  }
  ctx.restore();
}
