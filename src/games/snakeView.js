// Shared Snake world snapshot + rendering boundary.
// The authoritative game uses the same drawing helpers as remote phone clients.

import { drawGameAvatar } from '../core/avatarInGame.js';
import { fxReadAlpha } from '../core/fxKit.js';
import {
  isWorldEntityVisible,
  packFxState,
  packParticles,
  isValidFxState,
  drawFxRings,
  drawFxPops,
  drawCircleParticles,
} from './worldCore.js';
import { drawObstacle } from '../core/arenaKit.js';
import { drawField, hashFieldSeed } from '../core/fieldKit.js';
import { drawTabletopIcon } from '../core/tabletopIcons.js';
import { drawStatusChip, STATUS_STATE } from '../core/entityStatus.js';
import { UI_COLORS } from '../ui/tokens.js';

const TRAIL_SPACING = 10;
const MAX_TRAIL_POINTS = 48;

const round1 = (value) => Math.round(Number(value) * 10) / 10;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

export function sampleSnakeTrail(segments, headX, headY, spacing = TRAIL_SPACING, maxPoints = MAX_TRAIL_POINTS) {
  const safeSegments = Array.isArray(segments) ? segments : [];
  const cap = Math.max(2, Math.floor(maxPoints));
  if (!safeSegments.length || !finite(headX) || !finite(headY)) {
    return finite(headX) && finite(headY) ? [[round1(headX), round1(headY)]] : [];
  }

  const path = [];
  let totalLength = 0;
  let previousX = finite(safeSegments[0]?.x1) ? safeSegments[0].x1 : headX;
  let previousY = finite(safeSegments[0]?.y1) ? safeSegments[0].y1 : headY;
  path.push({ x: previousX, y: previousY, start: 0, length: 0 });

  for (const segment of safeSegments) {
    const x1 = finite(segment?.x1) ? segment.x1 : previousX;
    const y1 = finite(segment?.y1) ? segment.y1 : previousY;
    const x2 = finite(segment?.x2) ? segment.x2 : x1;
    const y2 = finite(segment?.y2) ? segment.y2 : y1;
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length > 0.01) {
      path.push({ x: x2, y: y2, start: totalLength, length });
      totalLength += length;
    }
    previousX = x2;
    previousY = y2;
  }

  if (totalLength <= 0.01) return [[round1(headX), round1(headY)]];

  const sampleCount = Math.min(cap, Math.max(2, Math.ceil(totalLength / Math.max(2, spacing)) + 1));
  const step = totalLength / (sampleCount - 1);
  const points = [];
  let pathIndex = 1;

  for (let i = 0; i < sampleCount; i += 1) {
    const distance = i === sampleCount - 1 ? totalLength : i * step;
    while (pathIndex < path.length - 1 && path[pathIndex].start < distance) pathIndex += 1;
    const current = path[pathIndex];
    const previous = path[pathIndex - 1] || current;
    const localDistance = Math.max(0, Math.min(current.length, distance - previous.start));
    const ratio = current.length > 0 ? localDistance / current.length : 0;
    points.push([
      round1(previous.x + (current.x - previous.x) * ratio),
      round1(previous.y + (current.y - previous.y) * ratio),
    ]);
  }

  points[0] = [round1(path[0].x), round1(path[0].y)];
  points[points.length - 1] = [round1(headX), round1(headY)];
  return points;
}

function winnerSlot(value) {
  return finite(value?.index) ? value.index : null;
}

export function createSnakeWorldPacket(game) {
  if (!game) return null;
  game._worldSeq = (Number(game._worldSeq) || 0) + 1;
  const arena = game.arena || {};
  const walls = Array.isArray(game.walls) ? game.walls : [];
  const foods = Array.isArray(game.foods) ? game.foods : [];
  const players = Array.isArray(game.players) ? game.players : [];
  const particles = Array.isArray(game.particles) ? game.particles : [];

  return {
    version: 1,
    mode: 'SNAKE',
    seq: game._worldSeq,
    roundId: Number(game.roundId) || 0,
    gameState: game.state || 'LOBBY',
    // Gövde yay-uzunluğuyla yeniden örneklenir — interpolator trail'i
    // indeks-lerp yerine snap alır (worldInterpolation bayrak okur).
    snapTrail: true,
    arena: [
      round1(arena.left || 0),
      round1(arena.top || 0),
      round1(arena.right || 0),
      round1(arena.bottom || 0),
    ],
    walls: walls.map((wall) => [
      round1(wall.x),
      round1(wall.y),
      round1(wall.w),
      round1(wall.h),
    ]),
    foods: foods.map((food) => [
      round1(food.x),
      round1(food.y),
      food.type || 'APPLE',
      round1(food.size || 13),
    ]),
    players: players.map((player) => ({
      slot: player.index,
      joined: player.isJoined !== false,
      alive: player.isAlive !== false,
      x: round1(player.x || 0),
      y: round1(player.y || 0),
      angle: round1(player.angle || 0),
      radius: round1(player.radius || 24),
      boost: !!player.isBoost,
      energy: Math.round(player.boostEnergy ?? 100),
      locked: !!player.boostLocked,
      trail: sampleSnakeTrail(player.segments, player.x, player.y),
    })),
    particles: packParticles(particles, 64),
    // FX kanalı (MOTION_PLAN Faz 2c): host FX runtime'ının saf anlık görüntüsü.
    fx: packFxState(game.fx),
    scores: (game.scores || [0, 0, 0, 0]).map((score) => Number(score) || 0),
    matchDraw: game.matchDraw === true,
    roundWinner: winnerSlot(game.roundWinner),
    matchWinner: winnerSlot(game.matchWinner),
  };
}

export function isValidSnakeWorldFrame(frame) {
  if (!frame || frame.action !== 'WORLD_FRAME' || frame.version !== 1 || frame.mode !== 'SNAKE') return false;
  if (!Number.isInteger(frame.seq) || frame.seq < 0) return false;
  if (!Number.isInteger(frame.roundId) || frame.roundId < 0) return false;
  if (!['LOBBY', 'PLAYING', 'ROUND_PAUSE', 'ROUND_OVER', 'MATCH_OVER', 'OVERTIME'].includes(frame.gameState)) return false;
  if (!Array.isArray(frame.arena) || frame.arena.length !== 4) return false;
  if (!frame.arena.every(finite)) return false;
  if (frame.arena[2] <= frame.arena[0] || frame.arena[3] <= frame.arena[1]) return false;
  if (!Array.isArray(frame.scores) || frame.scores.length > 4 || !frame.scores.every((score) => finite(score) && score >= 0)) return false;
  if (frame.roundWinner !== null && (!Number.isInteger(frame.roundWinner) || frame.roundWinner < 0 || frame.roundWinner > 3)) return false;
  if (frame.matchWinner !== null && (!Number.isInteger(frame.matchWinner) || frame.matchWinner < 0 || frame.matchWinner > 3)) return false;
  if (typeof frame.matchDraw !== 'boolean') return false;
  if (!Array.isArray(frame.walls) || frame.walls.length > 16) return false;
  if (!frame.walls.every((wall) => Array.isArray(wall) && wall.length === 4 && wall.every(finite))) return false;
  if (!Array.isArray(frame.foods) || frame.foods.length > 32) return false;
  if (!frame.foods.every((food) => Array.isArray(food) && food.length >= 4
    && finite(food[0]) && finite(food[1])
    && ['APPLE', 'GOLDEN_STAR', 'TURBO_BERRY'].includes(food[2])
    && finite(food[3]) && food[3] > 0)) return false;
  if (!Array.isArray(frame.players) || frame.players.length > 4) return false;
  if (!Array.isArray(frame.particles) || frame.particles.length > 64) return false;
  if (!frame.particles.every((particle) => (
    particle
    && finite(particle.x)
    && finite(particle.y)
    && finite(particle.size)
    && finite(particle.life)
    && finite(particle.maxLife)
    && typeof particle.color === 'string'
  ))) return false;
  // fx alanı v2 eklentisidir; eski host frames'i yoktur (opsiyonel, v1 uyumu).
  if (frame.fx !== undefined && !isValidFxState(frame.fx)) return false;
  return frame.players.every((player) => (
    player
    && typeof player.joined === 'boolean' && typeof player.alive === 'boolean'
    && Number.isInteger(player.slot)
    && player.slot >= 0
    && player.slot <= 3
    && finite(player.x)
    && finite(player.y)
    && finite(player.angle)
    && typeof player.boost === 'boolean'
    && finite(player.energy) && player.energy >= 0 && player.energy <= 100
    && typeof player.locked === 'boolean'
    && Array.isArray(player.trail)
    && player.trail.length <= MAX_TRAIL_POINTS
    && player.trail.every((point) => Array.isArray(point) && point.length >= 2 && finite(point[0]) && finite(point[1]))
  ));
}

export function drawSnakeArena(ctx, arena, walls, opts = {}) {
  // Statik saha `fieldKit`'te: kehribar tonlu zemin, tanecik dokusu, seeded
  // dekor ve yuvarlatılmış tepsi kesimi. Eskiden burada düz `#FAF7F2` dolgu +
  // kare-değişkenli el-ile ızgara döngüsü + siyah `strokeRect` vardı; hepsi
  // artık bake'te, frame başına tek blit.
  drawField(ctx, arena, { mode: 'SNAKE', seed: hashFieldSeed('SNAKE', opts.roundId) });
  for (const wall of walls) drawObstacle(ctx, wall, { theme: 'SNAKE' });
}

export function drawSnakeFoods(ctx, foods, now = 0) {
  for (const food of foods) {
    const pulse = 1 + Math.sin(now / 220 + (food.pulse || 0)) * 0.08;
    const radius = ((food.size || 13) / 2) * pulse;
    const u = radius / 6.5;
    ctx.fillStyle = 'rgba(26, 26, 26, 0.25)';
    ctx.beginPath();
    ctx.arc(food.x + 2, food.y + 2, radius, 0, Math.PI * 2);
    ctx.fill();

    if (food.type === 'GOLDEN_STAR') {
      ctx.fillStyle = '#FFDE59';
      ctx.beginPath();
      ctx.arc(food.x, food.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 2.5 * u;
      ctx.stroke();
      drawTabletopIcon(ctx, 'star', food.x, food.y, radius * 1.3, { color: '#1A1A1A' });
    } else if (food.type === 'TURBO_BERRY') {
      ctx.fillStyle = '#A259FF';
      ctx.beginPath();
      ctx.arc(food.x, food.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 2.5 * u;
      ctx.stroke();
      drawTabletopIcon(ctx, 'zap', food.x, food.y, radius * 1.3, { color: '#FFDE59' });
    } else {
      ctx.fillStyle = '#D84727';
      ctx.beginPath();
      ctx.arc(food.x, food.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 2 * u;
      ctx.stroke();
      ctx.fillStyle = '#FFF';
      ctx.beginPath();
      ctx.arc(food.x - radius * 0.35, food.y - radius * 0.35, radius * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#2F6A4F';
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.moveTo(food.x, food.y - radius);
      ctx.lineTo(food.x + 2, food.y - radius - 3);
      ctx.stroke();
    }
  }
}

function traceSnakePath(ctx, player) {
  ctx.beginPath();
  if (Array.isArray(player.trail)) {
    if (player.trail.length) {
      ctx.moveTo(player.trail[0][0], player.trail[0][1]);
      for (let i = 1; i < player.trail.length; i++) {
        ctx.lineTo(player.trail[i][0], player.trail[i][1]);
      }
    }
  } else if (Array.isArray(player.segments) && player.segments.length) {
    ctx.moveTo(player.segments[0].x1, player.segments[0].y1);
    for (const segment of player.segments) ctx.lineTo(segment.x2, segment.y2);
  }
}

export function drawSnakePlayers(ctx, players, now = 0, selfSlot = -1) {
  // 3.3 okunurluk hiyerarşisi: tek görür varsa kendi avatarın T1, diğerleri T3
  // (−%25); α yalnız fxKit'ten gelir, motor kendi α'sını uydurmaz.
  const hasViewer = Number.isInteger(selfSlot) && selfSlot >= 0;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const player of players) {
    if (!isWorldEntityVisible(player)) continue;

    const headRadius = player.radius || 24;
    const u = headRadius / 24;

    // Gövde kalınlığı kafa çapının ~%46/%31'i — kafa büyürken oranın
    // incelmemesi için taban 14/9'dan 22/15'e çıkarıldı (2026-09 akort).
    ctx.lineWidth = 22 * u;
    ctx.strokeStyle = '#1A1A1A';
    traceSnakePath(ctx, player);
    ctx.stroke();

    ctx.lineWidth = 15 * u;
    ctx.strokeStyle = player.color || '#D84727';
    traceSnakePath(ctx, player);
    ctx.stroke();

    if (player.isBoost || player.boost) {
      // Boost halesi altın dolgu 1.19:1 ile görünmezdi — koyu altın, aynı geometri.
      ctx.fillStyle = UI_COLORS.hudAmber;
      ctx.beginPath();
      ctx.arc(player.x, player.y, headRadius + 4 * u, 0, Math.PI * 2);
      ctx.fill();
    }

    if (finite(player.tongueTimer) && player.tongueTimer < 0.4) {
      const tongueLength = 9 * u;
      const tongueX = player.x + Math.cos(player.angle) * (headRadius + tongueLength);
      const tongueY = player.y + Math.sin(player.angle) * (headRadius + tongueLength);
      ctx.strokeStyle = '#D84727';
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.moveTo(player.x + Math.cos(player.angle) * headRadius, player.y + Math.sin(player.angle) * headRadius);
      ctx.lineTo(tongueX, tongueY);
      ctx.stroke();
    }

    const expression = player.isBoost || player.boost
      ? 'excited'
      : (player.boostLocked || player.locked ? 'panic' : 'normal');

    drawGameAvatar(ctx, player.x, player.y, headRadius, player, {
      color: player.color || '#D84727',
      avatar: player.avatar || null,
      slotIndex: player.slot ?? player.index ?? 0,
      facingAngle: player.angle,
      label: `P${(player.slot ?? player.index ?? 0) + 1}`,
      expression,
      showPointer: true,
      borderWidth: 2.5 * u,
      shadowOffset: 2,
      alpha: fxReadAlpha({ isSelf: hasViewer && (player.slot ?? player.index) === selfSlot, hasViewer }),
    });

    // Boost enerjisi: ince çember (altın yay 1.19:1) yerine rozet.
    // Kilitliyken BLOKE, doluyorken dolum barı. Kaynak 0-100 arası sayı.
    const energy = player.boostEnergy ?? player.energy ?? 100;
    if (energy < 98) {
      const locked = !!(player.boostLocked || player.locked);
      drawStatusChip(ctx, {
        x: player.x,
        y: player.y,
        radius: headRadius,
        scale: u,
        icon: 'zap',
        state: locked ? STATUS_STATE.BLOCKED : STATUS_STATE.CHARGING,
        progress: Math.max(0, Math.min(1, energy / 100)),
      });
    }
  }
}

/**
 * FX katmanının tek çizim sırası: pop → ring → partikül. Host motoru ve
 * client worldView AYNI fonksiyonu çağırır (host↔client aynı görünüm ilkesi).
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ pops?: any[], rings?: any[], particles?: any[] }} layer
 */
export function drawSnakeFxLayer(ctx, layer) {
  drawFxPops(ctx, layer?.pops);
  drawFxRings(ctx, layer?.rings);
  drawCircleParticles(ctx, layer?.particles);
}
