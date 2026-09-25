// BRUTAL HORDE — host/client ortak dünya snapshot'ı ve çizim sınırı.
// Client bu dosyadan yalnız salt-okunur draw + validation kullanır; simülasyon/AI import etmez.

import { drawPickup } from '../core/arenaKit.js';
import { drawGameAvatar } from '../core/avatarInGame.js';
import { drawAlphaTexts, drawCircleParticles, createWorldSnapshot, isValidWorldBase, round1 } from './worldCore.js';
import { t } from '../i18n.js';

export const HORDE_VIEW_LIMITS = Object.freeze({
  enemies: 28,
  bullets: 64,
  tombs: 4,
  pickups: 4,
  texts: 8,
  particles: 48,
});

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const ENEMY_TYPES = new Set(['chaser', 'shooter', 'tank', 'healer']);

export function mapHordePlayer(player, tuning = {}) {
  const maxHp = tuning.maxHp ?? 5;
  const dashCd = tuning.dashCd ?? 4;
  return {
    slot: player.index,
    joined: player.isJoined !== false,
    alive: player.isAlive !== false,
    x: round1(player.x || 0),
    y: round1(player.y || 0),
    angle: round1(player.angle || 0),
    color: typeof player.color === 'string' ? player.color : '#D84727',
    hp: Math.max(0, Math.round(Number(player.hp) || 0)),
    hpMax: Math.max(1, Math.round(Number(maxHp) || 5)),
    dash: round1(1 - clamp01((Number(player.dashCooldown) || 0) / dashCd)),
    dashing: (Number(player.dashTimer) || 0) > 0,
    invuln: (Number(player.invulnTimer) || 0) > 0 || (Number(player.spawnProt) || 0) > 0,
    shield: player.shield === true,
    fast: (Number(player.fastTimer) || 0) > 0,
    triple: (Number(player.tripleTimer) || 0) > 0,
    aiming: player.isAiming === true,
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
      hit: enemy.hitTimer > 0,
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
      progress: round1(clamp01(tomb.timer / 3)),
    })),
    portal: game.portal ? {
      x: round1(game.portal.x),
      y: round1(game.portal.y),
      r: round1(game.portal.radius),
      progress: round1(clamp01(game.portal.timer / 3)),
    } : null,
    pickups: (game.pickups || []).slice(0, HORDE_VIEW_LIMITS.pickups).map((pickup) => ({
      x: round1(pickup.x),
      y: round1(pickup.y),
      type: pickup.type,
      animTime: round1(pickup.animTime || 0),
      size: round1(pickup.size || pickup.radius * 2 || 30),
    })),
    texts: (game.floatingTexts || []).slice(0, HORDE_VIEW_LIMITS.texts).map((entry) => ({
      x: round1(entry.x),
      y: round1(entry.y),
      text: String(entry.text || '').slice(0, 24),
      alpha: round1(clamp01(entry.alpha)),
      color: typeof entry.color === 'string' ? entry.color : '#1A1A1A',
    })),
    round: Math.max(1, Math.round(game.round || 1)),
    wave: Math.max(1, Math.round(game.wave || 1)),
    totalRounds: 3,
    totalWaves: 3,
    enemiesLeft: Math.min(HORDE_VIEW_LIMITS.enemies, Math.max(0, game.enemies?.length || 0)),
    waveTime: Math.max(0, round1(game.waveTimer || 0)),
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
      hit: enemy.hit,
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
    ]),
    tombs: scene.tombs.map((tomb) => [tomb.x, tomb.y, tomb.owner, tomb.progress]),
    portal: scene.portal ? [scene.portal.x, scene.portal.y, scene.portal.r, scene.portal.progress] : null,
    pickups: scene.pickups.map((pickup) => [pickup.x, pickup.y, pickup.type, pickup.animTime, pickup.size]),
    texts: scene.texts,
    round: scene.round,
    wave: scene.wave,
    totalRounds: scene.totalRounds,
    totalWaves: scene.totalWaves,
    enemiesLeft: scene.enemiesLeft,
    waveTime: scene.waveTime,
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
    && typeof player.aiming === 'boolean';
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
    && typeof enemy.boss === 'boolean' && typeof enemy.hit === 'boolean')) return false;

  if (!Array.isArray(frame.bullets) || frame.bullets.length > HORDE_VIEW_LIMITS.bullets) return false;
  if (!frame.bullets.every((bullet) => Array.isArray(bullet) && bullet.length === 8
    && bullet.slice(0, 5).every(finite)
    && (bullet[5] === 0 || bullet[5] === 1)
    && Number.isInteger(bullet[6]) && bullet[6] >= 0
    && finite(bullet[7]))) return false;

  if (!Array.isArray(frame.tombs) || frame.tombs.length > HORDE_VIEW_LIMITS.tombs) return false;
  if (!frame.tombs.every((tomb) => Array.isArray(tomb) && tomb.length === 4
    && finite(tomb[0]) && finite(tomb[1])
    && Number.isInteger(tomb[2]) && tomb[2] >= 0 && tomb[2] <= 3
    && finite(tomb[3]) && tomb[3] >= 0 && tomb[3] <= 1)) return false;

  if (frame.portal !== null) {
    if (!Array.isArray(frame.portal) || frame.portal.length !== 4 || !frame.portal.every(finite)) return false;
    if (frame.portal[2] <= 0 || frame.portal[3] < 0 || frame.portal[3] > 1) return false;
  }

  if (!Array.isArray(frame.pickups) || frame.pickups.length > HORDE_VIEW_LIMITS.pickups) return false;
  if (!frame.pickups.every((pickup) => Array.isArray(pickup) && pickup.length === 5
    && finite(pickup[0]) && finite(pickup[1])
    && ['HEAL', 'SHIELD', 'FAST', 'TRIPLE'].includes(pickup[2])
    && finite(pickup[3]) && finite(pickup[4]) && pickup[4] > 0)) return false;

  if (!Array.isArray(frame.texts) || frame.texts.length > HORDE_VIEW_LIMITS.texts) return false;
  if (!frame.texts.every((entry) => entry && finite(entry.x) && finite(entry.y)
    && typeof entry.text === 'string' && finite(entry.alpha)
    && entry.alpha >= 0 && entry.alpha <= 1 && typeof entry.color === 'string')) return false;

  if (!Number.isInteger(frame.round) || frame.round < 1 || frame.round > 3) return false;
  if (!Number.isInteger(frame.wave) || frame.wave < 1 || frame.wave > 3) return false;
  if (frame.totalRounds !== 3 || frame.totalWaves !== 3) return false;
  if (!Number.isInteger(frame.enemiesLeft) || frame.enemiesLeft < 0 || frame.enemiesLeft > HORDE_VIEW_LIMITS.enemies) return false;
  if (!finite(frame.waveTime) || frame.waveTime < 0 || frame.waveTime > 90.1) return false;
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
    bullets: Array.isArray(frame.bullets) ? frame.bullets.map(([x, y, vx, vy, radius, enemy, id, angle]) => ({
      x, y, vx, vy, radius, enemy: enemy === 1, id, angle,
      color: enemy === 1 ? '#E63946' : '#D84727',
    })) : [],
    tombs: Array.isArray(frame.tombs) ? frame.tombs.map(([x, y, owner, progress]) => ({ x, y, owner, progress })) : [],
    portal: Array.isArray(frame.portal) ? {
      x: frame.portal[0], y: frame.portal[1], r: frame.portal[2], progress: frame.portal[3],
    } : null,
    pickups: Array.isArray(frame.pickups) ? frame.pickups.map(([x, y, type, animTime, size]) => ({ x, y, type, animTime, size })) : [],
    texts: Array.isArray(frame.texts) ? frame.texts : [],
    round: frame.round,
    wave: frame.wave,
    totalRounds: frame.totalRounds,
    totalWaves: frame.totalWaves,
    enemiesLeft: frame.enemiesLeft,
    waveTime: frame.waveTime,
    waveTimedOut: frame.waveTimedOut,
    isBossWave: frame.isBossWave,
    matchResult: frame.matchResult,
  };
}

export function drawHordeArena(ctx, arena) {
  const { left, top, right, bottom, width, height } = arena;
  ctx.save();
  ctx.fillStyle = '#F4F4F0';
  ctx.fillRect(left, top, width, height);

  ctx.strokeStyle = 'rgba(26, 26, 26, 0.08)';
  ctx.lineWidth = 1;
  const cell = Math.max(36, Math.round(Math.min(width, height) / 10));
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

  ctx.strokeStyle = '#1A1A1A';
  ctx.lineWidth = 7;
  ctx.strokeRect(left, top, width, height);

  const pulse = 0.18 + Math.sin((typeof performance !== 'undefined' ? performance.now() : 0) / 280) * 0.05;
  ctx.fillStyle = `rgba(217, 71, 39, ${pulse})`;
  ctx.beginPath();
  ctx.arc(arena.cx, arena.cy, Math.min(width, height) * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(217, 71, 39, 0.45)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

function drawEnemy(ctx, enemy, withFx) {
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
  ctx.strokeStyle = enemy.boss ? '#FACC15' : '#1A1A1A';
  ctx.lineWidth = enemy.boss ? 5 : 3;
  ctx.beginPath();
  if (enemy.type === 'tank') {
    const r = enemy.r;
    ctx.rect(-r, -r, r * 2, r * 2);
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

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(enemy.r * 0.45, -3, enemy.r * 0.55, 6);
  ctx.restore();

  const barW = Math.max(20, enemy.r * 1.5);
  const ratio = clamp01(enemy.hp / enemy.maxHp);
  ctx.save();
  ctx.fillStyle = '#1A1A1A';
  ctx.fillRect(enemy.x - barW / 2, enemy.y - enemy.r - 10, barW, 5);
  ctx.fillStyle = enemy.boss ? '#FACC15' : '#E63946';
  ctx.fillRect(enemy.x - barW / 2, enemy.y - enemy.r - 10, barW * ratio, 5);
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

    ctx.save();
    ctx.rotate(player.angle || 0);
    if (player.aiming) {
      ctx.strokeStyle = player.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(34, 0);
      ctx.stroke();
    }
    ctx.fillStyle = player.color;
    ctx.fillRect(13, -4, 18, 8);
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 2;
    ctx.strokeRect(13, -4, 18, 8);
    ctx.restore();

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
      ctx.fillRect(startX + i * (pipW + pipGap), player.y - 25, pipW, 4);
    }
  }
}

export function drawHordeWorld(ctx, arena, scene, { withFx = true, now = typeof performance !== 'undefined' ? performance.now() : 0 } = {}) {
  drawHordeArena(ctx, arena);

  if (scene.portal) {
    const portal = scene.portal;
    ctx.save();
    ctx.globalAlpha = 0.28 + Math.sin(now / 180) * 0.08;
    ctx.fillStyle = '#7C3AED';
    ctx.beginPath();
    ctx.arc(portal.x, portal.y, portal.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#4C1D95';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = '#FACC15';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(portal.x, portal.y, portal.r * 0.72, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp01(portal.progress));
    ctx.stroke();
    ctx.restore();
  }

  for (const pickup of scene.pickups || []) {
    drawPickup(ctx, pickup, { size: pickup.size });
  }

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

  for (const enemy of scene.enemies || []) drawEnemy(ctx, enemy, withFx);
  drawHordePlayers(ctx, scene.players || [], { withFx, now });
  drawAlphaTexts(ctx, scene.texts || [], { size: 15, outline: true });
}

export function drawHordeParticles(ctx, particles) {
  drawCircleParticles(ctx, particles);
}

export function drawHordeStatus(ctx, arena, scene) {
  const label = scene.isBossWave
    ? t('horde.bossWave')
    : t('horde.progress', scene.round, scene.totalRounds, scene.wave, scene.totalWaves);
  const enemies = scene.portal ? t('horde.portalReady') : t('horde.enemiesLeft', scene.enemiesLeft);
  const w = Math.min(arena.width * 0.72, 430);
  const h = scene.portal ? 58 : 44;
  const x = arena.cx - w / 2;
  const y = arena.top + 14;

  ctx.save();
  ctx.fillStyle = '#1A1A1A';
  ctx.fillRect(x + 4, y + 4, w, h);
  ctx.fillStyle = scene.portal ? '#7C3AED' : (scene.isBossWave ? '#B91C1C' : '#1A1A1A');
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 14px "Space Grotesk", sans-serif';
  ctx.fillText(label, arena.cx, y + (scene.portal ? 19 : h / 2));
  if (scene.portal) {
    ctx.font = '800 11px "JetBrains Mono", monospace';
    ctx.fillText(enemies, arena.cx, y + 41);
  }
  ctx.restore();
}
