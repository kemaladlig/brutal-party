// Shared Snake world snapshot + rendering boundary.
// The authoritative game uses the same drawing helpers as remote phone clients.

import { drawBrutalAvatar } from '../ui/characterRenderer.js';

const TRAIL_SPACING = 10;
const MAX_TRAIL_POINTS = 48;

const round1 = (value) => Math.round(Number(value) * 10) / 10;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

function pushUnique(points, x, y, maxPoints) {
  if (points.length >= maxPoints) return;
  const last = points[points.length - 1];
  if (last && Math.hypot(last[0] - x, last[1] - y) < 0.5) return;
  points.push([round1(x), round1(y)]);
}

/**
 * Converts the simulation's frame-rate-dependent segment list into a compact,
 * distance-sampled polyline from tail to head.
 */
export function sampleSnakeTrail(segments, headX, headY, spacing = TRAIL_SPACING, maxPoints = MAX_TRAIL_POINTS) {
  const safeSegments = Array.isArray(segments) ? segments : [];
  const points = [];
  if (!safeSegments.length || !finite(headX) || !finite(headY)) {
    if (finite(headX) && finite(headY)) points.push([round1(headX), round1(headY)]);
    return points;
  }

  const first = safeSegments[0];
  let currentX = finite(first?.x1) ? first.x1 : headX;
  let currentY = finite(first?.y1) ? first.y1 : headY;
  pushUnique(points, currentX, currentY, maxPoints - 1);

  let travelled = 0;
  let nextSample = Math.max(2, spacing);

  for (const segment of safeSegments) {
    const x1 = finite(segment?.x1) ? segment.x1 : currentX;
    const y1 = finite(segment?.y1) ? segment.y1 : currentY;
    const x2 = finite(segment?.x2) ? segment.x2 : x1;
    const y2 = finite(segment?.y2) ? segment.y2 : y1;
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length <= 0.01) {
      currentX = x2;
      currentY = y2;
      continue;
    }

    while (nextSample <= travelled + length && points.length < maxPoints - 1) {
      const ratio = (nextSample - travelled) / length;
      pushUnique(points, x1 + (x2 - x1) * ratio, y1 + (y2 - y1) * ratio, maxPoints - 1);
      nextSample += spacing;
    }

    travelled += length;
    currentX = x2;
    currentY = y2;
  }

  pushUnique(points, headX, headY, maxPoints);

  if (points.length <= maxPoints) return points;
  const sampled = [];
  const step = (points.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    sampled.push(points[Math.round(i * step)]);
  }
  return sampled;
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

  return {
    version: 1,
    mode: 'SNAKE',
    seq: game._worldSeq,
    roundId: Number(game.roundId) || 0,
    gameState: game.state || 'LOBBY',
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
      boost: !!player.isBoost,
      energy: Math.round(player.boostEnergy ?? 100),
      locked: !!player.boostLocked,
      trail: sampleSnakeTrail(player.segments, player.x, player.y),
    })),
    scores: (game.scores || [0, 0, 0, 0]).map((score) => Number(score) || 0),
    roundWinner: winnerSlot(game.roundWinner),
    matchWinner: winnerSlot(game.matchWinner),
  };
}

export function isValidSnakeWorldFrame(frame) {
  if (!frame || frame.action !== 'WORLD_FRAME' || frame.version !== 1 || frame.mode !== 'SNAKE') return false;
  if (!Number.isInteger(frame.seq) || frame.seq < 0) return false;
  if (!Array.isArray(frame.arena) || frame.arena.length !== 4) return false;
  if (!frame.arena.every(finite)) return false;
  if (!Array.isArray(frame.walls) || frame.walls.length > 16) return false;
  if (!frame.walls.every((wall) => Array.isArray(wall) && wall.length === 4 && wall.every(finite))) return false;
  if (!Array.isArray(frame.foods) || frame.foods.length > 32) return false;
  if (!frame.foods.every((food) => Array.isArray(food) && food.length >= 3 && finite(food[0]) && finite(food[1]) && finite(food[3]))) return false;
  if (!Array.isArray(frame.players) || frame.players.length > 4) return false;
  return frame.players.every((player) => (
    player
    && Number.isInteger(player.slot)
    && player.slot >= 0
    && player.slot <= 3
    && finite(player.x)
    && finite(player.y)
    && finite(player.angle)
    && Array.isArray(player.trail)
    && player.trail.length <= MAX_TRAIL_POINTS
    && player.trail.every((point) => Array.isArray(point) && point.length >= 2 && finite(point[0]) && finite(point[1]))
  ));
}

export function drawSnakeArena(ctx, arena, walls) {
  const { left, top, width, height } = arena;
  ctx.fillStyle = '#FAF7F2';
  ctx.fillRect(left, top, width, height);

  ctx.strokeStyle = '#EBE7DF';
  ctx.lineWidth = 1;
  const step = 36;
  ctx.beginPath();
  for (let x = left + step; x < left + width; x += step) {
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + height);
  }
  for (let y = top + step; y < top + height; y += step) {
    ctx.moveTo(left, y);
    ctx.lineTo(left + width, y);
  }
  ctx.stroke();

  for (const wall of walls) {
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(wall.x + 4, wall.y + 4, wall.w, wall.h);
    ctx.fillStyle = '#E8E4DA';
    ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 3;
    ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);

    ctx.save();
    ctx.beginPath();
    ctx.rect(wall.x, wall.y, wall.w, wall.h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(26, 26, 26, 0.12)';
    ctx.lineWidth = 4;
    for (let ox = -wall.h; ox < wall.w + wall.h; ox += 14) {
      ctx.beginPath();
      ctx.moveTo(wall.x + ox, wall.y);
      ctx.lineTo(wall.x + ox + wall.h, wall.y + wall.h);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.strokeStyle = '#1A1A1A';
  ctx.lineWidth = 6;
  ctx.strokeRect(left, top, width, height);
}

export function drawSnakeFoods(ctx, foods, now = 0) {
  for (const food of foods) {
    const pulse = 1 + Math.sin(now / 220 + (food.pulse || 0)) * 0.08;
    const radius = ((food.size || 13) / 2) * pulse;
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
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '900 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('★', food.x, food.y);
    } else if (food.type === 'TURBO_BERRY') {
      ctx.fillStyle = '#A259FF';
      ctx.beginPath();
      ctx.arc(food.x, food.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = '#FFDE59';
      ctx.font = '900 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⚡', food.x, food.y);
    } else {
      ctx.fillStyle = '#D84727';
      ctx.beginPath();
      ctx.arc(food.x, food.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#FFF';
      ctx.beginPath();
      ctx.arc(food.x - radius * 0.35, food.y - radius * 0.35, radius * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#2F6A4F';
      ctx.lineWidth = 2;
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

export function drawSnakePlayers(ctx, players, now = 0) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const player of players) {
    if (player.isJoined === false || player.joined === false || player.isAlive === false || player.alive === false) continue;

    ctx.lineWidth = 14;
    ctx.strokeStyle = '#1A1A1A';
    traceSnakePath(ctx, player);
    ctx.stroke();

    ctx.lineWidth = 9;
    ctx.strokeStyle = player.color || '#D84727';
    traceSnakePath(ctx, player);
    ctx.stroke();

    const headRadius = player.isBoost || player.boost ? 10 : 8.5;
    if (player.isBoost || player.boost) {
      ctx.fillStyle = '#FFDE59';
      ctx.beginPath();
      ctx.arc(player.x, player.y, headRadius + 4, 0, Math.PI * 2);
      ctx.fill();
    }

    if (finite(player.tongueTimer) && player.tongueTimer < 0.4) {
      const tongueLength = 9;
      const tongueX = player.x + Math.cos(player.angle) * (headRadius + tongueLength);
      const tongueY = player.y + Math.sin(player.angle) * (headRadius + tongueLength);
      ctx.strokeStyle = '#D84727';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(player.x + Math.cos(player.angle) * headRadius, player.y + Math.sin(player.angle) * headRadius);
      ctx.lineTo(tongueX, tongueY);
      ctx.stroke();
    }

    const expression = player.isBoost || player.boost
      ? 'excited'
      : (player.boostLocked || player.locked ? 'panic' : 'normal');

    drawBrutalAvatar(ctx, player.x, player.y, headRadius, {
      color: player.color || '#D84727',
      slotIndex: player.slot ?? player.index ?? 0,
      facingAngle: player.angle,
      label: `P${(player.slot ?? player.index ?? 0) + 1}`,
      expression,
      showPointer: true,
      borderColor: '#1A1A1A',
      borderWidth: 2.5,
      shadowOffset: 2,
    });

    const energy = player.boostEnergy ?? player.energy ?? 100;
    if (energy < 98) {
      const arcRadius = headRadius + 6;
      ctx.strokeStyle = 'rgba(26, 26, 26, 0.45)';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(player.x, player.y, arcRadius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = (player.boostLocked || player.locked) ? '#D84727' : '#FFDE59';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(player.x, player.y, arcRadius, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * (energy / 100)));
      ctx.stroke();
    }
  }
}

export function drawSnakeParticles(ctx, particles) {
  for (const particle of particles) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, particle.alpha));
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
