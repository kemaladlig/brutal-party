// CROWN world snapshot + client-safe drawing boundary for the retired-but-playable cartridge.

import { UI_COLORS } from '../ui/tokens.js';
import { createWorldSnapshot, isValidWorldBase, round1 } from './worldCore.js';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const PLAYER_FALLBACK = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];

function packRects(list, cap = 24) {
  return (Array.isArray(list) ? list : []).slice(0, cap).map((rect) => [
    round1(rect.x || 0), round1(rect.y || 0), round1(rect.w || 0), round1(rect.h || 0),
  ]);
}

function packCircles(list, cap = 24) {
  return (Array.isArray(list) ? list : []).slice(0, cap).map((circle) => [
    round1(circle.x || 0), round1(circle.y || 0), round1(circle.radius || 0), round1(circle.pulse || 0),
  ]);
}

function packMovingHazards(list) {
  return (Array.isArray(list) ? list : []).slice(0, 12).map((hazard, index) => ({
    id: index,
    x: round1(hazard.x || 0),
    y: round1(hazard.y || 0),
    radius: round1(hazard.radius || 0),
    pos: round1(hazard.pos || 0),
  }));
}

function packPickups(list) {
  return (Array.isArray(list) ? list : []).slice(0, 8).map((pickup) => [
    round1(pickup.x || 0), round1(pickup.y || 0), round1(pickup.size || 18),
    typeof pickup.type === 'string' ? pickup.type : 'TURBO',
  ]);
}

export function createCrownWorldPacket(game) {
  if (!game) return null;
  return createWorldSnapshot(game, {
    mode: 'CROWN',
    mapPlayer: (player) => ({
      slot: player.index,
      joined: player.isJoined !== false,
      alive: player.isAlive !== false,
      x: round1(player.x || 0),
      y: round1(player.y || 0),
      radius: round1(player.radius || 18),
      hasCrown: player.hasCrown === true,
      crownHoldTime: round1(player.crownHoldTime || 0),
      turbo: (Number(player.turboTimer) || 0) > 0,
      slip: (Number(player.slipTimer) || 0) > 0,
    }),
    extras: {
      timeLeft: Math.max(0, Math.ceil(game.roundTimer || 0)),
      crown: {
        x: round1(game.crown?.x || 0),
        y: round1(game.crown?.y || 0),
        radius: round1(game.crown?.radius || 20),
        carrier: Number.isInteger(game.crown?.carrierIndex) ? game.crown.carrierIndex : null,
      },
      pillars: packRects(game.pillars),
      conveyors: packRects(game.conveyors),
      bumpers: packCircles(game.bumpers),
      hazards: packMovingHazards(game.movingHazards),
      bananas: packCircles(game.bananaPeels),
      ink: packCircles(game.inkPuddles),
      speedPads: packRects(game.speedPads),
      pickups: packPickups(game.pickups),
    },
  });
}

function validPlayer(player) {
  return !!player
    && typeof player.joined === 'boolean'
    && typeof player.alive === 'boolean'
    && finite(player.x) && finite(player.y)
    && finite(player.radius) && player.radius > 0
    && typeof player.hasCrown === 'boolean'
    && finite(player.crownHoldTime) && player.crownHoldTime >= 0
    && typeof player.turbo === 'boolean'
    && typeof player.slip === 'boolean';
}

function validRectList(value, cap) {
  return Array.isArray(value) && value.length <= cap && value.every((rect) => (
    Array.isArray(rect) && rect.length === 4 && rect.every(finite) && rect[2] >= 0 && rect[3] >= 0
  ));
}

function validCircleList(value, cap) {
  return Array.isArray(value) && value.length <= cap && value.every((circle) => (
    Array.isArray(circle) && circle.length === 4 && circle.every(finite) && circle[2] >= 0 && circle[3] >= 0
  ));
}

export function isValidCrownWorldFrame(frame) {
  return isValidWorldBase(frame, 'CROWN', {
    checkPlayer: validPlayer,
    checkExtra: (candidate) => (
      finite(candidate.timeLeft) && candidate.timeLeft >= 0
      && candidate.crown
      && finite(candidate.crown.x) && finite(candidate.crown.y)
      && finite(candidate.crown.radius) && candidate.crown.radius > 0
      && (candidate.crown.carrier === null
        || (Number.isInteger(candidate.crown.carrier) && candidate.crown.carrier >= 0 && candidate.crown.carrier <= 3))
      && validRectList(candidate.pillars, 24)
      && validRectList(candidate.conveyors, 12)
      && validCircleList(candidate.bumpers, 24)
      && validCircleList(candidate.bananas, 24)
      && validCircleList(candidate.ink, 24)
      && validRectList(candidate.speedPads, 12)
      && Array.isArray(candidate.hazards) && candidate.hazards.length <= 12
      && candidate.hazards.every((hazard) => hazard
        && Number.isInteger(hazard.id)
        && finite(hazard.x) && finite(hazard.y)
        && finite(hazard.radius) && hazard.radius > 0
        && finite(hazard.pos))
      && Array.isArray(candidate.pickups) && candidate.pickups.length <= 8
      && candidate.pickups.every((pickup) => Array.isArray(pickup) && pickup.length === 4
        && pickup.slice(0, 3).every(finite) && pickup[2] > 0
        && typeof pickup[3] === 'string')
    ),
  });
}

function drawRect(ctx, rect, fill) {
  const [x, y, width, height] = rect;
  ctx.fillStyle = fill; ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = UI_COLORS.ink; ctx.lineWidth = 2.5; ctx.strokeRect(x, y, width, height);
}

function drawCircle(ctx, circle, fill) {
  const [x, y, radius] = circle;
  ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, Math.max(1, radius), 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = UI_COLORS.ink; ctx.lineWidth = 2.5; ctx.stroke();
}

function drawCrownArena(ctx, frame, arena) {
  const { left, top, right, bottom } = arena;
  const width = right - left;
  const height = bottom - top;
  ctx.fillStyle = '#FAF7F2'; ctx.fillRect(left, top, width, height);
  ctx.strokeStyle = 'rgba(26, 26, 26, 0.07)'; ctx.lineWidth = 1;
  const step = Math.max(32, Math.min(50, Math.min(width, height) / 8));
  for (let x = left; x < right; x += step) { ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); }
  for (let y = top; y < bottom; y += step) { ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); }
  for (const rect of frame.pillars || []) drawRect(ctx, rect, '#2B2B28');
  for (const rect of frame.conveyors || []) drawRect(ctx, rect, '#3B82F6');
  for (const rect of frame.speedPads || []) drawRect(ctx, rect, UI_COLORS.turbo);
  ctx.strokeStyle = UI_COLORS.ink; ctx.lineWidth = 5; ctx.strokeRect(left, top, width, height);
}

function drawCrown(ctx, crown, players) {
  if (!crown) return;
  if (crown.carrier === null) drawCircle(ctx, [crown.x, crown.y, crown.radius], '#FFD700');
  const carrier = players?.find((player) => player.slot === crown.carrier);
  if (!carrier) return;
  ctx.save(); ctx.fillStyle = '#FFD700'; ctx.strokeStyle = '#1A1A1A'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(carrier.x, carrier.y - carrier.radius - 6);
  ctx.lineTo(carrier.x - 10, carrier.y - carrier.radius - 20);
  ctx.lineTo(carrier.x - 3, carrier.y - carrier.radius - 15);
  ctx.lineTo(carrier.x, carrier.y - carrier.radius - 24);
  ctx.lineTo(carrier.x + 3, carrier.y - carrier.radius - 15);
  ctx.lineTo(carrier.x + 10, carrier.y - carrier.radius - 20);
  ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
}

function drawPlayer(ctx, player, color) {
  if (!player.joined || !player.alive) return;
  drawCircle(ctx, [player.x, player.y, player.radius], color);
  if (player.turbo) {
    ctx.strokeStyle = UI_COLORS.turbo; ctx.lineWidth = 3; ctx.beginPath();
    ctx.arc(player.x, player.y, player.radius + 5, 0, Math.PI * 2); ctx.stroke();
  }
}

export function drawCrownWorld(ctx, frame, arena, colors = []) {
  drawCrownArena(ctx, frame, arena);
  for (const circle of frame.bumpers || []) drawCircle(ctx, circle, '#3B82F6');
  for (const hazard of frame.hazards || []) drawCircle(ctx, [hazard.x, hazard.y, hazard.radius], '#D99B26');
  for (const circle of frame.bananas || []) drawCircle(ctx, circle, '#FFD700');
  for (const circle of frame.ink || []) drawCircle(ctx, circle, 'rgba(26,26,26,0.7)');
  for (const [x, y, size, type] of frame.pickups || []) {
    drawCircle(ctx, [x, y, size / 2], type === 'TELEPORT' ? '#8B5CF6' : type === 'SLIP' ? '#D99B26' : '#22C55E');
  }
  for (const player of frame.players || []) drawPlayer(ctx, player, colors[player.slot] || PLAYER_FALLBACK[player.slot] || PLAYER_FALLBACK[0]);
  drawCrown(ctx, frame.crown, frame.players);
}
