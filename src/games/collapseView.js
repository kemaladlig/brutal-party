// Paylaşılan COLLAPSE dünya snapshot'ı + çizim sınırı (worldCore deseni).
// Yetkili host, uzak telefon client'larıyla aynı çizim yardımcılarını kullanır;
// client simülasyon/AI import etmez, yalnız salt-okunur draw + snapshot/validator alır.
// Not: 13x13 grid ham taşınır (169 durum + uyarı sayaçları); pickup ikonları
// tabletopIcons vektörleridir (SUPER_JUMP→chevrons_up, REPAIR_TILES→hammer, BLAST_WAVE→wind).

import { drawBrutalAvatar } from '../ui/characterRenderer.js';
import { drawTabletopIcon } from '../core/tabletopIcons.js';
import {
  round1,
  createWorldSnapshot,
  isValidWorldBase,
} from './worldCore.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const round2 = (v) => Math.round(Number(v) * 100) / 100;
const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

export const COLLAPSE_COLS = 13;
export const COLLAPSE_ROWS = 13;

const PICKUP_ICONS = {
  SUPER_JUMP: 'chevrons_up',
  REPAIR_TILES: 'hammer',
  BLAST_WAVE: 'wind',
};

// --- Snapshot serializer (host tarafı, deklaratif extras) ---
export function createCollapseWorldPacket(game) {
  if (!game) return null;
  const grid = Array.isArray(game.grid) ? game.grid : [];
  const states = [];
  const warn = [];
  for (let r = 0; r < COLLAPSE_ROWS; r++) {
    for (let c = 0; c < COLLAPSE_COLS; c++) {
      const tile = grid[r]?.[c];
      const state = tile && (tile.state === 1 || tile.state === 2) ? tile.state : 0;
      states.push(state);
      if (state === 1) warn.push([r * COLLAPSE_COLS + c, round2(tile.timer || 0)]);
    }
  }
  return createWorldSnapshot(game, {
    mode: 'COLLAPSE',
    mapPlayer: (p) => ({
      slot: p.index,
      joined: p.isJoined !== false,
      alive: p.isAlive !== false,
      x: round1(p.x || 0),
      y: round1(p.y || 0),
      jump: round2((p.jumpTimer || 0) > 0 ? (p.jumpTimer || 0) / 0.45 : 0),
      super: (p.superJumpTimer || 0) > 0,
    }),
    extras: {
      cell: round1(game.cellSize || 0),
      grid: states,
      warn: warn.slice(0, 169),
      falling: (Array.isArray(game.fallingTiles) ? game.fallingTiles : []).slice(0, 12).map((ft) => ({
        x: round1(ft.x), y: round1(ft.y),
        rot: round2(ft.rot || 0),
        scale: round2(ft.scale ?? 1),
        alpha: round2(ft.alpha ?? 1),
        size: round1(ft.size || 20),
        color: typeof ft.colorVariant === 'string' ? ft.colorVariant : '#D99B26',
      })),
      waves: (Array.isArray(game.shockwaves) ? game.shockwaves : []).slice(0, 8).map((sw) => ({
        x: round1(sw.x), y: round1(sw.y),
        radius: round1(sw.radius || 0),
        alpha: round2(sw.alpha ?? 1),
        color: typeof sw.color === 'string' ? sw.color : '#FFFFFF',
      })),
      pickups: (Array.isArray(game.pickups) ? game.pickups : []).slice(0, 6).map((pu) => ({
        x: round1(pu.x), y: round1(pu.y),
        type: pu.type || 'SUPER_JUMP',
        pulse: round2(pu.pulse || 0),
      })),
    },
  });
}

function isValidCollapsePlayer(p) {
  return finite(p.jump) && typeof p.super === 'boolean';
}

function isValidCollapseExtra(frame) {
  if (!finite(frame.cell) || frame.cell <= 0) return false;
  if (!Array.isArray(frame.grid) || frame.grid.length !== COLLAPSE_COLS * COLLAPSE_ROWS) return false;
  if (!frame.grid.every((s) => s === 0 || s === 1 || s === 2)) return false;
  if (!Array.isArray(frame.warn) || frame.warn.length > 169) return false;
  if (!frame.warn.every((w) => Array.isArray(w) && w.length === 2
    && Number.isInteger(w[0]) && w[0] >= 0 && w[0] < 169 && finite(w[1]))) return false;
  if (!Array.isArray(frame.falling) || frame.falling.length > 12) return false;
  if (!frame.falling.every((ft) => ft && finite(ft.x) && finite(ft.y) && finite(ft.rot)
    && finite(ft.scale) && finite(ft.alpha) && finite(ft.size) && typeof ft.color === 'string')) return false;
  if (!Array.isArray(frame.waves) || frame.waves.length > 8) return false;
  if (!frame.waves.every((sw) => sw && finite(sw.x) && finite(sw.y) && finite(sw.radius)
    && finite(sw.alpha) && typeof sw.color === 'string')) return false;
  if (!Array.isArray(frame.pickups) || frame.pickups.length > 6) return false;
  if (!frame.pickups.every((pu) => pu && finite(pu.x) && finite(pu.y)
    && typeof pu.type === 'string' && finite(pu.pulse))) return false;
  return true;
}

// --- Client frame doğrulaması ---
export function isValidCollapseWorldFrame(frame) {
  return isValidWorldBase(frame, 'COLLAPSE', {
    checkPlayer: isValidCollapsePlayer,
    checkExtra: isValidCollapseExtra,
  });
}

// --- Ortak çizim yardımcıları (host + client) ---
export function drawCollapseFalling(ctx, falling) {
  for (const ft of falling || []) {
    ctx.save();
    ctx.globalAlpha = clamp01(ft.alpha ?? 1);
    ctx.translate(ft.x, ft.y);
    ctx.rotate(ft.rot || 0);
    ctx.scale(ft.scale ?? 1, ft.scale ?? 1);
    ctx.fillStyle = ft.color || '#D99B26';
    ctx.fillRect(-ft.size / 2, -ft.size / 2, ft.size, ft.size);
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 2;
    ctx.strokeRect(-ft.size / 2, -ft.size / 2, ft.size, ft.size);
    ctx.restore();
  }
}

export function drawCollapseGrid(ctx, arena, cell, states, warn, { withFx = true, now = 0 } = {}) {
  const cols = COLLAPSE_COLS;
  const rows = COLLAPSE_ROWS;
  const cellSize = cell;
  const offsetX = arena.cx - (cols * cellSize) / 2;
  const offsetY = arena.cy - (rows * cellSize) / 2;
  const warnByIdx = new Map((warn || []).map(([idx, timer]) => [idx, timer]));
  const padding = 1.5;
  const bevel = 4;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const state = states[idx];
      if (state === 2) continue;

      const tx = offsetX + c * cellSize;
      const ty = offsetY + r * cellSize;
      const tw = cellSize - padding * 2;
      const th = cellSize - padding * 2;

      let wobbleX = 0, wobbleY = 0, scaleAdd = 0;
      let ratio = 1;
      if (state === 1) {
        const timer = warnByIdx.get(idx) ?? 0.85;
        ratio = Math.max(0, Math.min(1, timer / 0.85));
        if (withFx) {
          wobbleX = (Math.random() - 0.5) * 5;
          wobbleY = (Math.random() - 0.5) * 5;
          scaleAdd = Math.sin(now / 80 + r + c) * 0.045 * ratio;
        }
      }

      const bx = tx + padding + wobbleX;
      const by = ty + padding + wobbleY;
      const scl = 1 + scaleAdd;
      const ox = bx + tw / 2;
      const oy = by + th / 2;

      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(scl, scl);
      ctx.fillStyle = '#0B0B0B';
      ctx.fillRect(-tw / 2, -th / 2 + bevel, tw, th);

      if (state === 0) {
        const toneShift = ((r * 7 + c * 13) % 18) - 9;
        const baseL = 248 + toneShift;
        ctx.fillStyle = `rgb(${baseL}, ${baseL - 3}, ${baseL - 8})`;
        ctx.fillRect(-tw / 2, -th / 2, tw, th);
        ctx.strokeStyle = '#2B2B2B';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-tw / 2, -th / 2, tw, th);
      } else {
        const rr = 255;
        const gg = Math.floor(154 * ratio + 26 * (1 - ratio));
        ctx.fillStyle = `rgb(${rr}, ${gg}, 0)`;
        ctx.fillRect(-tw / 2, -th / 2, tw, th);
        ctx.fillStyle = `rgba(255, ${Math.floor(220 * ratio + 100)}, 60, 0.55)`;
        ctx.fillRect(-tw / 2, -th / 2, tw, th * 0.35);
        ctx.strokeStyle = ratio > 0.5 ? '#C84A00' : '#991200';
        ctx.lineWidth = 2;
        ctx.strokeRect(-tw / 2, -th / 2, tw, th);
      }
      ctx.restore();
    }
  }
}

export function drawCollapseWaves(ctx, waves) {
  for (const sw of waves || []) {
    ctx.save();
    ctx.globalAlpha = clamp01(sw.alpha ?? 1);
    ctx.strokeStyle = sw.color || '#FFFFFF';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(sw.x, sw.y, sw.radius || 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

export function drawCollapsePickups(ctx, pickups, now = 0) {
  for (const pu of pickups || []) {
    const pulse = 1 + Math.sin(now / 200 + (pu.pulse || 0)) * 0.12;
    const r = 13 * pulse;

    ctx.save();
    ctx.translate(pu.x, pu.y);

    ctx.strokeStyle = pu.type === 'SUPER_JUMP' ? '#FFDE59' : (pu.type === 'REPAIR_TILES' ? '#2F6A4F' : '#1D5D8A');
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, r + 4, 0, Math.PI * 2); ctx.stroke();

    ctx.fillStyle = '#FAF7F2';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1A1A1A'; ctx.lineWidth = 2; ctx.stroke();

    drawTabletopIcon(ctx, PICKUP_ICONS[pu.type] || 'wind', 0, 0, 18, { color: '#1A1A1A' });

    ctx.restore();
  }
}

export function drawCollapsePlayers(ctx, players) {
  for (const player of players) {
    if (player.joined === false || player.alive === false) continue;

    const jumpProgress = clamp01(player.jump || 0);
    const isJumping = jumpProgress > 0;
    const jumpHeight = isJumping ? Math.sin(jumpProgress * Math.PI) * 16 : 0;
    const scale = 1.0 + (jumpHeight / 16) * 0.45;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.arc(player.x, player.y + 4, Math.max(4, 9 - jumpHeight * 0.3), 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(player.x, player.y - jumpHeight);
    ctx.scale(scale, scale);

    if (player.super) {
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 4.5;
      ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#FFDE59';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.stroke();
    }

    drawBrutalAvatar(ctx, 0, 0, 9.5, {
      color: player.color,
      slotIndex: player.slot ?? player.index,
      label: `P${(player.slot ?? player.index ?? 0) + 1}`,
      expression: isJumping ? 'excited' : (player.super ? 'wink' : 'normal'),
      showPointer: false,
      borderWidth: 2.5,
      shadowOffset: 2,
    });

    ctx.restore();
  }
}

