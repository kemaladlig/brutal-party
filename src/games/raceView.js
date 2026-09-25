// RACE world snapshot + client-safe drawing boundary.
// The phone never imports RaceGame/AI; it only validates and renders snapshots.

import { drawTabletopIcon } from '../core/tabletopIcons.js';
import { UI_COLORS } from '../ui/tokens.js';
import { createWorldSnapshot, isValidWorldBase, round1 } from './worldCore.js';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const PLAYER_FALLBACK = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
const TRACKS = ['CIRCUIT', 'ZIGZAG', 'SPIRAL'];

function packPoints(points, cap = 16) {
  return (Array.isArray(points) ? points : []).slice(0, cap).map((point) => [
    round1(point.x || 0), round1(point.y || 0), round1(point.radius || point.size || 0),
  ]);
}

function packPads(pads) {
  return (Array.isArray(pads) ? pads : []).slice(0, 8).map((pad) => [
    round1(pad.x || 0), round1(pad.y || 0), round1(pad.w || 0), round1(pad.h || 0), round1(pad.angle || 0),
  ]);
}

function packSpinners(spinners) {
  return (Array.isArray(spinners) ? spinners : []).slice(0, 8).map((spinner, index) => ({
    id: index,
    x: round1(spinner.x || 0),
    y: round1(spinner.y || 0),
    length: round1(spinner.length || 0),
    angle: round1(spinner.angle || 0),
  }));
}

function packEmpPulses(pulses) {
  return (Array.isArray(pulses) ? pulses : []).slice(0, 12).map((pulse, index) => ({
    id: `emp-${index}`,
    x: round1(pulse.x || 0),
    y: round1(pulse.y || 0),
    radius: round1(pulse.radius || 0),
    owner: Number.isInteger(pulse.owner) ? pulse.owner : -1,
  }));
}

export function createRaceWorldPacket(game) {
  if (!game) return null;
  return createWorldSnapshot(game, {
    mode: 'RACE',
    mapPlayer: (player) => ({
      slot: player.index,
      joined: player.isJoined !== false,
      alive: player.isAlive !== false,
      x: round1(player.x || 0),
      y: round1(player.y || 0),
      angle: round1(player.angle || 0),
      radius: round1(player.radius || 16),
      jumpZ: round1(player.jumpZ || 0),
      nextCheckpoint: Math.max(0, Number(player.nextCheckpoint) || 0),
      laps: Math.max(0, Number(player.laps) || 0),
      dashing: player.isDashing === true,
      boosting: (Number(player.nitroBoostTimer) || 0) > 0,
      drafting: player.isDrafting === true,
      disrupted: (Number(player.empDisruptedTimer) || 0) > 0,
    }),
    extras: {
      track: TRACKS.includes(game.currentPreset) ? game.currentPreset : TRACKS[0],
      timeLeft: Math.max(0, Math.ceil(game.roundTimer || 0)),
      checkpoints: (Array.isArray(game.checkpoints) ? game.checkpoints : []).slice(0, 8).map((checkpoint) => ({
        id: Number(checkpoint.id) || 0,
        x: round1(checkpoint.x || 0),
        y: round1(checkpoint.y || 0),
        radius: round1(checkpoint.radius || 0),
        color: typeof checkpoint.color === 'string' ? checkpoint.color : '#FFDE59',
        name: typeof checkpoint.name === 'string' ? checkpoint.name : '',
      })),
      oilSlicks: packPoints(game.oilSlicks),
      nitroPads: packPads(game.nitroPads),
      spinners: packSpinners(game.obstacleSpinners),
      empPulses: packEmpPulses(game.empPulses),
    },
  });
}

function validPlayer(player) {
  return !!player
    && typeof player.joined === 'boolean'
    && typeof player.alive === 'boolean'
    && finite(player.x) && finite(player.y)
    && finite(player.angle)
    && finite(player.radius) && player.radius > 0
    && finite(player.jumpZ) && player.jumpZ >= 0
    && Number.isInteger(player.nextCheckpoint) && player.nextCheckpoint >= 0
    && Number.isInteger(player.laps) && player.laps >= 0
    && typeof player.dashing === 'boolean'
    && typeof player.boosting === 'boolean'
    && typeof player.drafting === 'boolean'
    && typeof player.disrupted === 'boolean';
}

function validPointArray(value, cap) {
  return Array.isArray(value) && value.length <= cap && value.every((point) => (
    Array.isArray(point) && point.length === 3 && point.slice(0, 2).every(finite) && finite(point[2]) && point[2] >= 0
  ));
}

function validSpinners(value) {
  return Array.isArray(value) && value.length <= 8 && value.every((spinner) => (
    spinner && Number.isInteger(spinner.id)
    && finite(spinner.x) && finite(spinner.y)
    && finite(spinner.length) && spinner.length > 0
    && finite(spinner.angle)
  ));
}

function validEmpPulses(value) {
  return Array.isArray(value) && value.length <= 12 && value.every((pulse) => (
    pulse && typeof pulse.id === 'string'
    && finite(pulse.x) && finite(pulse.y)
    && finite(pulse.radius) && pulse.radius >= 0
    && Number.isInteger(pulse.owner) && pulse.owner >= -1 && pulse.owner <= 3
  ));
}

export function isValidRaceWorldFrame(frame) {
  return isValidWorldBase(frame, 'RACE', {
    checkPlayer: validPlayer,
    checkExtra: (candidate) => (
      TRACKS.includes(candidate.track)
      && finite(candidate.timeLeft) && candidate.timeLeft >= 0
      && Array.isArray(candidate.checkpoints) && candidate.checkpoints.length <= 8
      && candidate.checkpoints.every((checkpoint) => (
        checkpoint && Number.isInteger(checkpoint.id) && checkpoint.id >= 0
        && finite(checkpoint.x) && finite(checkpoint.y)
        && finite(checkpoint.radius) && checkpoint.radius >= 0
        && typeof checkpoint.color === 'string' && typeof checkpoint.name === 'string'
      ))
      && validPointArray(candidate.oilSlicks, 16)
      && Array.isArray(candidate.nitroPads) && candidate.nitroPads.length <= 8
      && candidate.nitroPads.every((pad) => Array.isArray(pad) && pad.length === 5 && pad.every(finite))
      && validSpinners(candidate.spinners)
      && validEmpPulses(candidate.empPulses)
    ),
  });
}

function drawTrackBase(ctx, arena) {
  const { left, top, right, bottom } = arena;
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  ctx.fillStyle = '#FAF7F2'; ctx.fillRect(left, top, width, height);
  ctx.strokeStyle = 'rgba(26, 26, 26, 0.06)'; ctx.lineWidth = 1;
  for (let x = left; x < right; x += 40) { ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); }
  for (let y = top; y < bottom; y += 40) { ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); }
  ctx.strokeStyle = UI_COLORS.ink; ctx.lineWidth = 4; ctx.strokeRect(left, top, width, height);
}

function drawOilSlicks(ctx, oilSlicks) {
  for (const [x, y, radius] of oilSlicks || []) {
    ctx.save(); ctx.fillStyle = 'rgba(26, 26, 26, 0.75)';
    ctx.beginPath(); ctx.arc(x, y, Math.max(1, radius), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = UI_COLORS.turbo; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
  }
}

function drawNitroPad(ctx, pad, now) {
  const [x, y, width, height, angle] = pad;
  const pulse = 1 + Math.sin(now * 0.006) * 0.04;
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.scale(pulse, pulse);
  ctx.fillStyle = UI_COLORS.ink; ctx.fillRect(-width / 2 + 4, -height / 2 + 4, width, height);
  ctx.fillStyle = UI_COLORS.turbo; ctx.fillRect(-width / 2, -height / 2, width, height);
  ctx.strokeStyle = UI_COLORS.ink; ctx.lineWidth = 2.5; ctx.strokeRect(-width / 2, -height / 2, width, height);
  drawTabletopIcon(ctx, 'zap', 0, 0, Math.min(width, height) * 0.62, { color: UI_COLORS.ink, strokeWidth: 2.4 });
  ctx.restore();
}

function drawSpinner(ctx, spinner) {
  ctx.save(); ctx.translate(spinner.x, spinner.y); ctx.rotate(spinner.angle);
  ctx.fillStyle = UI_COLORS.ink; ctx.fillRect(-spinner.length / 2 + 3, -5, spinner.length, 16);
  ctx.fillStyle = '#575750'; ctx.fillRect(-spinner.length / 2, -8, spinner.length, 16);
  ctx.strokeStyle = UI_COLORS.ink; ctx.lineWidth = 2.5; ctx.strokeRect(-spinner.length / 2, -8, spinner.length, 16);
  ctx.fillStyle = UI_COLORS.ink; ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}

function drawCheckpoint(ctx, checkpoint) {
  ctx.save(); ctx.fillStyle = checkpoint.color; ctx.globalAlpha = 0.25;
  ctx.beginPath(); ctx.arc(checkpoint.x, checkpoint.y, checkpoint.radius, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.85; ctx.strokeStyle = checkpoint.color; ctx.lineWidth = 3; ctx.setLineDash([6, 4]); ctx.stroke();
  ctx.setLineDash([]); ctx.fillStyle = UI_COLORS.ink; ctx.font = '900 16px "JetBrains Mono", monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(checkpoint.name, checkpoint.x, checkpoint.y); ctx.restore();
}

function drawEmpPulses(ctx, pulses) {
  for (const pulse of pulses || []) {
    ctx.save(); ctx.strokeStyle = '#0EA5E9'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(pulse.x, pulse.y, Math.max(0.1, pulse.radius), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
}

function drawPlayer(ctx, player, color, checkpoints) {
  const jumpOffsetY = -(player.jumpZ || 0) * 0.8;
  const shadowScale = Math.max(0.68, 1 - (player.jumpZ || 0) * 0.018);
  ctx.save(); ctx.translate(player.x, player.y); ctx.scale(shadowScale, shadowScale);
  ctx.fillStyle = player.jumpZ > 1 ? 'rgba(26, 26, 26, 0.25)' : 'rgba(26, 26, 26, 0.16)';
  ctx.beginPath(); ctx.ellipse(0, 0, 15, 8, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();

  if (player.drafting) {
    ctx.save(); ctx.strokeStyle = '#38BDF8'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(player.x, player.y + jumpOffsetY);
    ctx.lineTo(player.x - Math.cos(player.angle) * 35, player.y + jumpOffsetY - Math.sin(player.angle) * 35);
    ctx.stroke(); ctx.restore();
  }
  const jumpScale = 1 + Math.min(0.38, (player.jumpZ || 0) * 0.035);
  ctx.save(); ctx.translate(player.x, player.y + jumpOffsetY); ctx.scale(jumpScale, jumpScale); ctx.rotate(player.angle);
  if (player.dashing || player.boosting) { ctx.fillStyle = UI_COLORS.turbo; ctx.fillRect(-28, -8, 14, 16); }
  if (player.disrupted) { ctx.strokeStyle = '#0EA5E9'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.stroke(); }
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-12, -10); ctx.lineTo(-8, 0); ctx.lineTo(-12, 10); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = UI_COLORS.ink; ctx.lineWidth = 2.5; ctx.stroke(); ctx.restore();

  const target = checkpoints?.[player.nextCheckpoint];
  if (target) {
    const arrowAngle = Math.atan2(target.y - player.y, target.x - player.x);
    ctx.save(); ctx.translate(player.x + Math.cos(arrowAngle) * 26, player.y + Math.sin(arrowAngle) * 26 + jumpOffsetY); ctx.rotate(arrowAngle);
    ctx.fillStyle = target.color; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  const pipCount = player.slot + 1;
  const startX = player.x - ((pipCount - 1) * 5) / 2;
  for (let index = 0; index < pipCount; index += 1) {
    ctx.beginPath(); ctx.arc(startX + index * 5, player.y + jumpOffsetY, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = UI_COLORS.card; ctx.fill(); ctx.strokeStyle = UI_COLORS.ink; ctx.lineWidth = 1; ctx.stroke();
  }
}

export function drawRaceWorld(ctx, frame, arena, colors = [], now = performance.now()) {
  drawTrackBase(ctx, arena);
  drawEmpPulses(ctx, frame.empPulses);
  drawOilSlicks(ctx, frame.oilSlicks);
  for (const pad of frame.nitroPads || []) drawNitroPad(ctx, pad, now);
  for (const spinner of frame.spinners || []) drawSpinner(ctx, spinner);
  for (const checkpoint of frame.checkpoints || []) drawCheckpoint(ctx, checkpoint);
  for (const player of frame.players || []) {
    if (player.joined && player.alive) drawPlayer(ctx, player, colors[player.slot] || PLAYER_FALLBACK[player.slot] || PLAYER_FALLBACK[0], frame.checkpoints);
  }
}
