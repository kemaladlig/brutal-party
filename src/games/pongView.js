// PONG world snapshot + client-safe drawing boundary.
// Host simulation stays in Game/Paddle/Ball; the phone only validates and draws this snapshot.

import {
  createWorldSnapshot,
  isValidWorldBase,
  round1,
} from './worldCore.js';

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
        radius: round1(ball.radius || 11),
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

function paddleBounds(paddle) {
  const halfLength = (paddle.length || 0) / 2;
  const halfThickness = (paddle.thickness || 0) / 2;
  if (paddle.axis === 'horizontal') {
    return { x: paddle.x - halfLength, y: paddle.y - halfThickness, w: paddle.length, h: paddle.thickness };
  }
  return { x: paddle.x - halfThickness, y: paddle.y - halfLength, w: paddle.thickness, h: paddle.length };
}

export function drawPongArena(ctx, arena, goals = null) {
  const { left, top, right, bottom } = arena;
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const minDim = Math.min(width, height);
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;

  ctx.fillStyle = '#FAF7F2';
  ctx.fillRect(left, top, width, height);
  const inset = Math.max(12, Math.round(minDim * 0.045));
  ctx.strokeStyle = '#EBE5DA';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(left + inset, top + inset, width - inset * 2, height - inset * 2);

  ctx.strokeStyle = '#F0EAE0';
  ctx.lineWidth = 1;
  const gridStepX = width / 6;
  const gridStepY = height / 6;
  for (let x = left + gridStepX; x < right; x += gridStepX) {
    ctx.beginPath(); ctx.moveTo(x, top + inset); ctx.lineTo(x, bottom - inset); ctx.stroke();
  }
  for (let y = top + gridStepY; y < bottom; y += gridStepY) {
    ctx.beginPath(); ctx.moveTo(left + inset, y); ctx.lineTo(right - inset, y); ctx.stroke();
  }
  ctx.strokeStyle = '#E2DDD2'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, minDim * 0.22), 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#D0CAC0';
  ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, minDim * 0.14), 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#1A1A1A'; ctx.lineWidth = 5;
  ctx.strokeRect(left, top, width, height);

  if (goals) {
    ctx.fillStyle = '#FAF7F2';
    const thickness = 5;
    const drawGap = (side, span) => {
      if (!Array.isArray(span) || span.length !== 2) return;
      if (side === 'bottom') ctx.fillRect(span[0], bottom - thickness, span[1] - span[0], thickness);
      if (side === 'top') ctx.fillRect(span[0], top, span[1] - span[0], thickness);
      if (side === 'left') ctx.fillRect(left, span[0], thickness, span[1] - span[0]);
      if (side === 'right') ctx.fillRect(right - thickness, span[0], thickness, span[1] - span[0]);
    };
    drawGap('bottom', goals.bottom);
    drawGap('top', goals.top);
    drawGap('left', goals.left);
    drawGap('right', goals.right);
  }
}

export function drawPongPaddles(ctx, paddles, arena, colors = []) {
  for (const paddle of paddles || []) {
    const color = colors[paddle.slot] || '#D84727';
    if (!paddle.joined || !paddle.alive) {
      const wall = paddle.side === 'bottom'
        ? { x: arena.left, y: arena.bottom - 20, w: arena.right - arena.left, h: 20 }
        : paddle.side === 'top'
          ? { x: arena.left, y: arena.top, w: arena.right - arena.left, h: 20 }
          : paddle.side === 'left'
            ? { x: arena.left, y: arena.top, w: 20, h: arena.bottom - arena.top }
            : { x: arena.right - 20, y: arena.top, w: 20, h: arena.bottom - arena.top };
      ctx.fillStyle = '#938F86'; ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
      ctx.strokeStyle = '#1A1A1A'; ctx.lineWidth = 3; ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);
      continue;
    }
    const bounds = paddleBounds(paddle);
    ctx.fillStyle = color; ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
    ctx.strokeStyle = '#1A1A1A'; ctx.lineWidth = 3; ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
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
      ctx.strokeStyle = '#D99B26'; ctx.lineWidth = 4;
      ctx.strokeRect(bounds.x - 4, bounds.y - 4, bounds.w + 8, bounds.h + 8);
    }
  }
}

export function drawPongBall(ctx, ball) {
  if (!ball) return;
  for (const [x, y, smash] of ball.trail || []) {
    ctx.globalAlpha = smash ? 0.24 : 0.16;
    ctx.fillStyle = smash ? '#D84727' : '#111111';
    ctx.beginPath(); ctx.arc(x, y, Math.max(1, ball.radius * 0.55), 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (ball.dead) return;
  ctx.fillStyle = Math.abs(ball.spin || 0) > 8 ? '#D99B26' : (ball.smash ? '#D84727' : '#111111');
  ctx.beginPath(); ctx.arc(ball.x, ball.y, Math.max(1, ball.radius), 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#000000'; ctx.lineWidth = 2.5; ctx.stroke();
}

export function drawPongShockwaves(ctx, shockwaves) {
  for (const [x, y, radius, life, maxLife, color] of shockwaves || []) {
    const alpha = clamp(life / Math.max(0.01, maxLife), 0, 1);
    ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, 3 * alpha);
    ctx.beginPath(); ctx.arc(x, y, Math.max(0.1, radius), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
}
