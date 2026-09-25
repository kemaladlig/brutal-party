// Shared Snake world snapshot + rendering boundary.
// The authoritative game uses the same drawing helpers as remote phone clients.

import { drawBrutalAvatar } from '../ui/characterRenderer.js';

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
    particles: particles.slice(0, 64).map((particle) => ({
      x: round1(particle.x || 0),
      y: round1(particle.y || 0),
      radius: round1(particle.radius || 1),
      alpha: Math.max(0, Math.min(1, Number(particle.alpha) || 0)),
      color: typeof particle.color === 'string' ? particle.color : '#1A1A1A',
    })),
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
    && finite(particle.radius)
    && finite(particle.alpha)
    && typeof particle.color === 'string'
  ))) return false;
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
      avatar: player.avatar || null,
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
