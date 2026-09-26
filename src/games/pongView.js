// PONG world snapshot + client-safe drawing boundary.
// Host simulation stays in Game/Paddle/Ball; the phone only validates and draws this snapshot.

import {
  createWorldSnapshot,
  isValidWorldBase,
  round1,
} from './worldCore.js';
import { drawField } from '../core/fieldKit.js';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function packTrail(trail) {
  return (Array.isArray(trail) ? trail : [])
    .slice(0, 18)
    .map((point) => [round1(point?.x || 0), round1(point?.y || 0), point?.isSmash ? 1 : 0]);
}

function packShockwaves(shockwaves) {
  return (Array.isArray(shockwaves) ? shockwaves : [])
    .slice(0, 16)
    .map((wave) => [
      round1(wave?.x || 0),
      round1(wave?.y || 0),
      round1(wave?.radius || 0),
      round1(wave?.life || 0),
      round1(wave?.maxLife || 0.01),
      typeof wave?.color === 'string' ? wave.color : '#D99B26',
    ]);
}

function packGoals(game) {
  const goals = {};
  for (const side of ['bottom', 'top', 'left', 'right']) {
    const bounds = game.getGoalBounds?.(side);
    if (bounds) goals[side] = [round1(bounds.goalMin), round1(bounds.goalMax)];
  }
  return goals;
}

export function createPongWorldPacket(game) {
  if (!game) return null;
  const paddles = Array.isArray(game.paddles) ? game.paddles : [];
  const ball = game.ball || {};
  const scores = Array.isArray(game.setScores) ? game.setScores : (game.scores || [0, 0, 0, 0]);

  return createWorldSnapshot(game, {
    mode: 'PONG',
    list: paddles,
    mapPlayer: (paddle) => ({
      slot: paddle.index,
      joined: paddle.isJoined !== false,
      alive: paddle.isEliminated !== true,
      x: round1(paddle.coord || 0),
      y: round1(paddle.fixedPerpendicular || 0),
      side: paddle.side || 'bottom',
      axis: paddle.axis || 'horizontal',
      length: round1(paddle.length || 0),
      thickness: round1(paddle.thickness || 0),
      lives: Math.max(0, Math.floor(Number(paddle.lives) || 0)),
      bot: paddle.isBot === true,
      spin: round1(paddle.spinCharge || 0),
    }),
    extras: {
      scores: scores.map((score) => Math.max(0, Number(score) || 0)),
      matchWinner: Number.isInteger(game.winner?.index) ? game.winner.index : null,
      roundId: Number(game.roundId) || 0,
      timeLeft: Math.max(0, Math.ceil((game.roundLimit || 120) - (game.roundPlayTimer || 0))),
      goals: packGoals(game),
      ball: {
        id: 'ball',
        x: round1(ball.x || 0),
        y: round1(ball.y || 0),
        radius: round1(ball.radius || 16),
        spin: round1(ball.spin || 0),
        rally: Math.max(0, Number(ball.rallyCount) || 0),
        smash: ball.isSmash === true,
        dead: ball.isDead === true,
        trail: packTrail(ball.trail),
        shockwaves: packShockwaves(ball.shockwaves),
      },
    },
  });
}

function validPaddle(paddle) {
  return !!paddle
    && ['bottom', 'top', 'left', 'right'].includes(paddle.side)
    && ['horizontal', 'vertical'].includes(paddle.axis)
    && typeof paddle.joined === 'boolean'
    && typeof paddle.alive === 'boolean'
    && typeof paddle.bot === 'boolean'
    && finite(paddle.x)
    && finite(paddle.y)
    && finite(paddle.length) && paddle.length > 0
    && finite(paddle.thickness) && paddle.thickness > 0
    && Number.isInteger(paddle.lives) && paddle.lives >= 0
    && finite(paddle.spin) && paddle.spin >= 0;
}

function validBall(ball) {
  return !!ball
    && ball.id === 'ball'
    && finite(ball.x)
    && finite(ball.y)
    && finite(ball.radius) && ball.radius > 0
    && finite(ball.spin)
    && Number.isInteger(ball.rally) && ball.rally >= 0
    && typeof ball.smash === 'boolean'
    && typeof ball.dead === 'boolean'
    && Array.isArray(ball.trail) && ball.trail.length <= 18
    && ball.trail.every((point) => Array.isArray(point) && point.length === 3
      && finite(point[0]) && finite(point[1]) && (point[2] === 0 || point[2] === 1))
    && Array.isArray(ball.shockwaves) && ball.shockwaves.length <= 16
    && ball.shockwaves.every((wave) => Array.isArray(wave) && wave.length === 6
      && wave.slice(0, 5).every(finite) && typeof wave[5] === 'string');
}

function validGoals(goals) {
  if (goals === undefined) return true;
  if (!goals || typeof goals !== 'object') return false;
  return Object.values(goals).every((span) => Array.isArray(span)
    && span.length === 2 && span.every(finite) && span[1] > span[0]);
}

export function isValidPongWorldFrame(frame) {
  return isValidWorldBase(frame, 'PONG', {
    checkPlayer: validPaddle,
    checkExtra: (candidate) => validBall(candidate.ball) && validGoals(candidate.goals),
  });
}

// ---------------------------------------------------------------------------
// Kapı boşlukları — host ve client aynı saha dilini paylaşsın diye burada.
// ---------------------------------------------------------------------------

/**
 * Dört kapının saha kenarındaki açıklıklarını, duvarın kesileceği dikdörtgen
 * listeye çevirir. Saha katmanı bunları YAMA olarak pişirir: önce zemin rengi
 * yeniden basılır, sonra içeri doğru hafif gölge eklenir — düz leke yerine
 * "çukur kapı" okunur.
 *
 * @param {object} arena - { left, top, right, bottom }
 * @param {object|null} goals - { top|bottom|left|right: [min, max] }
 * @returns {Array<{x:number,y:number,w:number,h:number}>}
 */
export function pongGoalPatches(arena, goals) {
  if (!goals) return [];
  const { left, top, right, bottom } = arena;
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const minDim = Math.min(width, height);
  const u = arena?.unit ?? (minDim / 952);
  const thickness = Math.max(2, 5 * u);
  const patches = [];

  for (const side of ['bottom', 'top', 'left', 'right']) {
    const span = goals[side];
    if (!Array.isArray(span) || span.length !== 2) continue;
    const [from, to] = span;
    if (!finite(from) || !finite(to) || to <= from) continue;
    if (side === 'bottom') patches.push({ x: from, y: bottom - thickness, w: to - from, h: thickness });
    if (side === 'top') patches.push({ x: from, y: top, w: to - from, h: thickness });
    if (side === 'left') patches.push({ x: left, y: from, w: thickness, h: to - from });
    if (side === 'right') patches.push({ x: right - thickness, y: from, w: thickness, h: to - from });
  }
  return patches;
}

/** Kapı aralıkları değişirse katman yeniden pişirilsin diye cache varyantı. */
export function pongGoalVariant(goals) {
  if (!goals) return 'nog';
  return ['top', 'bottom', 'left', 'right']
    .map((side) => (Array.isArray(goals[side]) ? `${side[0]}${Math.round(goals[side][0])}-${Math.round(goals[side][1])}` : ''))
    .join(',');
}

function paddleBounds(paddle) {
  const halfLength = (paddle.length || 0) / 2;
  const halfThickness = (paddle.thickness || 0) / 2;
  if (paddle.axis === 'horizontal') {
    return { x: paddle.x - halfLength, y: paddle.y - halfThickness, w: paddle.length, h: paddle.thickness };
  }
  return { x: paddle.x - halfThickness, y: paddle.y - halfLength, w: paddle.thickness, h: paddle.length };
}

export function drawPongArena(ctx, arena, goals = null, { seed } = {}) {
  // Statik saha katmanı `fieldKit` tarafından pişirilir: zemin gradyanı, ızgara,
  // iç çerçeve, iki merkez halkası, köşe plakaları + nişanlar, dekor, duvar.
  // Kapı boşlukları `pongGoalPatches` ile yama olarak katmanın İÇİne girer.
  drawField(ctx, arena, {
    mode: 'PONG',
    seed,
    patches: pongGoalPatches(arena, goals),
    variant: pongGoalVariant(goals),
  });
}

export function drawPongPaddles(ctx, paddles, arena, colors = []) {
  const u = arena?.unit ?? 1;
  for (const paddle of paddles || []) {
    const color = colors[paddle.slot] || '#D84727';
    if (!paddle.joined || !paddle.alive) {
      const wall = paddle.side === 'bottom'
        ? { x: arena.left, y: arena.bottom - 20 * u, w: arena.right - arena.left, h: 20 * u }
        : paddle.side === 'top'
          ? { x: arena.left, y: arena.top, w: arena.right - arena.left, h: 20 * u }
          : paddle.side === 'left'
            ? { x: arena.left, y: arena.top, w: 20 * u, h: arena.bottom - arena.top }
            : { x: arena.right - 20 * u, y: arena.top, w: 20 * u, h: arena.bottom - arena.top };
      ctx.fillStyle = '#938F86'; ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
      ctx.strokeStyle = '#1A1A1A'; ctx.lineWidth = 3 * u; ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);
      continue;
    }
    const bounds = paddleBounds(paddle);
    ctx.fillStyle = color; ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
    ctx.strokeStyle = '#1A1A1A'; ctx.lineWidth = 3 * u; ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
    if (paddle.lives > 0) {
      ctx.fillStyle = color;
      ctx.font = '900 14px "JetBrains Mono", monospace';
      ctx.textAlign = paddle.axis === 'horizontal' ? 'left' : 'center';
      ctx.textBaseline = paddle.axis === 'horizontal' ? 'middle' : 'top';
      const label = '● '.repeat(Math.min(3, paddle.lives)).trim();
      if (paddle.axis === 'horizontal') ctx.fillText(label, bounds.x + bounds.w + 8, paddle.y);
      else ctx.fillText(label, paddle.x, bounds.y + bounds.h + 6);
    }
    if (paddle.spin > 0) {
      ctx.strokeStyle = '#D99B26'; ctx.lineWidth = 4 * u;
      ctx.strokeRect(bounds.x - 4 * u, bounds.y - 4 * u, bounds.w + 8 * u, bounds.h + 8 * u);
    }
  }
}

export function drawPongBall(ctx, ball) {
  if (!ball) return;
  const u = (ball.radius || 16) / 16;
  for (const [x, y, smash] of ball.trail || []) {
    ctx.globalAlpha = smash ? 0.24 : 0.16;
    ctx.fillStyle = smash ? '#D84727' : '#111111';
    ctx.beginPath(); ctx.arc(x, y, Math.max(1, ball.radius * 0.55), 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (ball.dead) return;
  ctx.fillStyle = Math.abs(ball.spin || 0) > 8 ? '#D99B26' : (ball.smash ? '#D84727' : '#111111');
  ctx.beginPath(); ctx.arc(ball.x, ball.y, Math.max(1, ball.radius), 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#000000'; ctx.lineWidth = 2.5 * u; ctx.stroke();
}

export function drawPongShockwaves(ctx, shockwaves) {
  for (const [x, y, radius, life, maxLife, color] of shockwaves || []) {
    const alpha = clamp(life / Math.max(0.01, maxLife), 0, 1);
    ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, 3 * alpha);
    ctx.beginPath(); ctx.arc(x, y, Math.max(0.1, radius), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
}
