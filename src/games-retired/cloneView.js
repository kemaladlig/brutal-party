// Paylaşılan CLONE dünya snapshot'ı + çizim sınırı (worldCore deseni).
// Yetkili host, uzak telefon client'larıyla aynı çizim yardımcılarını kullanır;
// client simülasyon/AI import etmez, yalnız salt-okunur draw + snapshot/validator alır.
// Not: görev istasyonu ikonları tabletopIcons vektörleridir (snapshot'ta registry anahtarı taşınır,
// ham emoji tel üstüne çıkmaz); geri sayım filigranı host HUD'udur.

import { drawBrutalAvatar } from '../ui/characterRenderer.js';
import { drawTabletopIcon } from '../core/tabletopIcons.js';
import {
  round1,
  packRectList,
  createWorldSnapshot,
  isValidWorldBase,
  drawAlphaTexts,
} from '../games/worldCore.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

export const CLONE_RADIUS = 15;

// İstasyon id → vektör ikon anahtarı (tek kaynak tabletopIcons)
const STATION_ICONS = {
  alchemy: 'flask_conical',
  library: 'scroll',
  treasury: 'gem',
  altar: 'swords',
  fountain: 'landmark',
  statue: 'landmark',
};

// --- Snapshot serializer (host tarafı, deklaratif extras) ---
export function createCloneWorldPacket(game) {
  if (!game) return null;
  return createWorldSnapshot(game, {
    mode: 'CLONE',
    mapPlayer: (p) => ({
      slot: p.index,
      joined: p.isJoined !== false,
      alive: p.isAlive !== false,
      x: round1(p.x || 0),
      y: round1(p.y || 0),
      angle: round1(p.angle || 0),
      dash: (p.dashTimer || 0) > 0,
      slow: (p.slowTimer || 0) > 0,
      task: round1(p.taskTimer || 0),
    }),
    extras: {
      roundTime: round1(game.roundTime || 0),
      matchDraw: game.matchDraw === true,
      stations: (Array.isArray(game.taskPoints) ? game.taskPoints : []).slice(0, 4).map((tp) => ({
        x: round1(tp.x),
        y: round1(tp.y),
        radius: round1(tp.radius || 40),
        color: typeof tp.color === 'string' ? tp.color : '#888888',
        icon: STATION_ICONS[tp.id] || 'landmark',
        name: String(tp.name || '').slice(0, 20),
      })),
      walls: packRectList(game.walls, 24),
      clones: (Array.isArray(game.npcClones) ? game.npcClones : [])
        .filter((c) => c.active !== false)
        .slice(0, 12)
        .map((c) => ({
          owner: c.ownerIndex,
          x: round1(c.x),
          y: round1(c.y),
          angle: round1(c.angle || 0),
          task: round1(c.state === 'TASK' ? (1 - (c.taskWaitTimer || 0) / 4) * 2 : 0),
          color: typeof c.color === 'string' ? c.color : '#888888',
        })),
      texts: (Array.isArray(game.floatingTexts) ? game.floatingTexts : []).slice(0, 8).map((ft) => ({
        x: round1(ft.x),
        y: round1(ft.y),
        text: String(ft.text || '').slice(0, 24),
        alpha: Math.max(0, Math.min(1, Number(ft.alpha ?? ft.life ?? 1) || 0)),
        color: typeof ft.color === 'string' ? ft.color : '#1A1A1A',
      })),
    },
  });
}

function isValidClonePlayer(p) {
  return typeof p.joined === 'boolean' && typeof p.alive === 'boolean'
    && finite(p.angle)
    && typeof p.dash === 'boolean' && typeof p.slow === 'boolean'
    && finite(p.task) && p.task >= 0 && p.task <= 1.5;
}

function isValidCloneExtra(frame) {
  if (!finite(frame.roundTime) || frame.roundTime < 0 || typeof frame.matchDraw !== 'boolean') return false;
  if (!Array.isArray(frame.stations) || frame.stations.length > 4) return false;
  if (!frame.stations.every((s) => s && finite(s.x) && finite(s.y) && finite(s.radius)
    && typeof s.color === 'string' && typeof s.icon === 'string' && typeof s.name === 'string')) return false;
  if (!Array.isArray(frame.walls) || frame.walls.length > 24) return false;
  if (!frame.walls.every((r) => Array.isArray(r) && r.length === 4 && r.every(finite))) return false;
  if (!Array.isArray(frame.clones) || frame.clones.length > 12) return false;
  if (!frame.clones.every((c) => c && Number.isInteger(c.owner) && c.owner >= 0 && c.owner <= 3
    && finite(c.x) && finite(c.y) && finite(c.angle) && finite(c.task)
    && typeof c.color === 'string')) return false;
  if (!Array.isArray(frame.texts) || frame.texts.length > 8) return false;
  if (!frame.texts.every((ft) => ft && finite(ft.x) && finite(ft.y) && typeof ft.text === 'string'
    && finite(ft.alpha) && typeof ft.color === 'string')) return false;
  return true;
}

// --- Client frame doğrulaması ---
export function isValidCloneWorldFrame(frame) {
  return isValidWorldBase(frame, 'CLONE', {
    checkPlayer: isValidClonePlayer,
    checkExtra: isValidCloneExtra,
  });
}

// --- Ortak çizim yardımcıları (host + client) ---
export function drawCloneArena(ctx, arena) {
  const { left, top, right, bottom, width, height, size } = arena;

  ctx.fillStyle = '#E8E5DF';
  ctx.fillRect(left, top, width, height);

  ctx.strokeStyle = '#D5D1C7';
  ctx.lineWidth = 1.5;
  const step = size / 9;
  for (let x = left + step; x < right; x += step) {
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
  }
  for (let y = top + step; y < bottom; y += step) {
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
  }

  ctx.strokeStyle = '#1A1A1A';
  ctx.lineWidth = 6;
  ctx.strokeRect(left, top, width, height);
}

export function drawCloneStations(ctx, stations) {
  for (const t of stations || []) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2);
    ctx.fillStyle = `${t.color}22`;
    ctx.fill();
    ctx.strokeStyle = t.color;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 6]);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(t.x, t.y, 16, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 2;
    ctx.stroke();

    drawTabletopIcon(ctx, t.icon, t.x, t.y, 20, { color: '#1A1A1A' });

    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#1A1A1A';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t.name, t.x, t.y + t.radius + 14);
    ctx.restore();
  }
}

export function drawCloneWalls(ctx, walls) {
  for (const w of walls || []) {
    ctx.fillStyle = '#101010';
    ctx.fillRect(w.x + 3, w.y + 3, w.w, w.h);
    ctx.fillStyle = '#2A2A2A';
    ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.strokeStyle = '#484848';
    ctx.lineWidth = 2;
    ctx.strokeRect(w.x, w.y, w.w, w.h);
  }
}

export function drawCloneCharacter(ctx, x, y, angle, color, { dashing = false, slowed = false, task = 0, withFx = true } = {}) {
  ctx.save();
  ctx.translate(x, y);

  if (withFx && slowed) {
    ctx.translate((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3);
    drawTabletopIcon(ctx, 'sparkles', -14, -22, 13, { color: '#E63946' });
    ctx.fillStyle = '#E63946';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('CEZA', 8, -22);
  }

  if (task > 0) {
    ctx.beginPath();
    ctx.arc(0, 0, CLONE_RADIUS + 7, -Math.PI / 2, -Math.PI / 2 + (task / 1.5) * Math.PI * 2);
    ctx.strokeStyle = '#2F6A4F';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  if (withFx && dashing) {
    ctx.beginPath();
    ctx.arc(0, 0, CLONE_RADIUS + 8, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.globalAlpha = 0.6;
    ctx.fill();
    ctx.globalAlpha = 1.0;
  }

  let exp = 'normal';
  if (slowed) exp = 'dizzy';
  else if (dashing) exp = 'angry';
  else if (task > 0) exp = 'wink';

  drawBrutalAvatar(ctx, 0, 0, CLONE_RADIUS, {
    color,
    facingAngle: angle,
    expression: exp,
    showPointer: true,
    borderColor: '#1A1A1A',
    borderWidth: 2.5,
  });

  ctx.restore();
}

export { drawAlphaTexts as drawCloneTexts };
