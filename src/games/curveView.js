// Paylaşılan CURVE dünya snapshot'ı + çizim sınırı (worldCore deseni).
// Yetkili host, uzak telefon client'larıyla aynı çizim yardımcılarını kullanır;
// client simülasyon/AI import etmez, yalnız salt-okunur draw + snapshot/validator alır.
//
// Trail ölçeği: host `this.segments` 24.000'e kadar büyüyebilir (SEG_MAX); 30 Hz JSON
// bunu taşıyamaz. Bu yüzden iki katmanlı sıkıştırma kullanılır:
//   1) `near` — oyuncu başına son N segment (kuantize x1,y1,x2,y2 + 3 bit flag), telefon
//      ekranında gerçekten görülebilen mesafedir ve tam çizilir.
//   2) `field` — eski tüm izlerin 24x24 hücrelik 2-bit sahiplik maskesi (hex kodlanmış).
//      Uzak izler kaba bir çizgi olarak temsil edilir; çarpışma host'ta tam çözünürlükte
//      kalır, yani görsel sadakat düşer ama oyun doğruluğu bozulmaz.

import { drawPickup } from '../core/arenaKit.js';
import {
  round1,
  createWorldSnapshot,
  isValidWorldBase,
  isWorldEntityVisible,
  drawSquareParticles,
  drawAlphaTexts,
} from './worldCore.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

export const CURVE_FIELD_TILES = 24;   // field maskesi 24x24
export const CURVE_NEAR_PER_PLAYER = 220; // oyuncu başına gönderilen yakın segment tavanı
export const CURVE_TOTAL_NEAR_CAP = 900;  // frame başına toplam tavan
export const CURVE_GAP_MASK_TILES = CURVE_FIELD_TILES;

// --- Field maskesi (2 bit/sahip) ---
export function packCurveFieldMask(segments, field) {
  const T = CURVE_FIELD_TILES;
  const tw = (field.s || 1) / T;
  const bits = new Uint8Array(T * T);
  for (const seg of segments) {
    if (seg.isGap) continue;
    const owner = seg.owner;
    if (!Number.isInteger(owner) || owner < 0 || owner > 3) continue;
    const minCX = Math.max(0, Math.min(T - 1, Math.floor((Math.min(seg.x1, seg.x2) - field.x) / tw)));
    const maxCX = Math.max(0, Math.min(T - 1, Math.floor((Math.max(seg.x1, seg.x2) - field.x) / tw)));
    const minCY = Math.max(0, Math.min(T - 1, Math.floor((Math.min(seg.y1, seg.y2) - field.y) / tw)));
    const maxCY = Math.max(0, Math.min(T - 1, Math.floor((Math.max(seg.y1, seg.y2) - field.y) / tw)));
    for (let cy = minCY; cy <= maxCY; cy++) {
      for (let cx = minCX; cx <= maxCX; cx++) bits[cy * T + cx] = owner + 1;
    }
  }
  // 2 bit/hücre → hex başına 4 hücre
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    const v = (bits[i] & 3) | ((bits[i + 1] & 3) << 2) | ((bits[i + 2] & 3) << 4) | ((bits[i + 3] & 3) << 6);
    hex += v.toString(16).padStart(2, '0');
  }
  return hex;
}

export function unpackCurveFieldMask(hex) {
  const T = CURVE_FIELD_TILES;
  const bits = new Uint8Array(T * T);
  for (let i = 0; i < bits.length; i += 4) {
    const byte = parseInt(hex.slice((i / 4) * 2, (i / 4) * 2 + 2), 16) || 0;
    bits[i] = byte & 3;
    bits[i + 1] = (byte >> 2) & 3;
    bits[i + 2] = (byte >> 4) & 3;
    bits[i + 3] = (byte >> 6) & 3;
  }
  return bits;
}

export function packCurveGapMask(segments, field) {
  const T = CURVE_GAP_MASK_TILES;
  const tw = (field.s || 1) / T;
  const bits = new Uint8Array(T * T);
  for (const seg of segments) {
    if (!seg.isGap) continue;
    const minCX = Math.max(0, Math.min(T - 1, Math.floor((Math.min(seg.x1, seg.x2) - field.x) / tw)));
    const maxCX = Math.max(0, Math.min(T - 1, Math.floor((Math.max(seg.x1, seg.x2) - field.x) / tw)));
    const minCY = Math.max(0, Math.min(T - 1, Math.floor((Math.min(seg.y1, seg.y2) - field.y) / tw)));
    const maxCY = Math.max(0, Math.min(T - 1, Math.floor((Math.max(seg.y1, seg.y2) - field.y) / tw)));
    for (let cy = minCY; cy <= maxCY; cy++) {
      for (let cx = minCX; cx <= maxCX; cx++) bits[cy * T + cx] = 1;
    }
  }
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    const value = (bits[i] & 1) | ((bits[i + 1] & 1) << 1) | ((bits[i + 2] & 1) << 2) | ((bits[i + 3] & 1) << 3);
    hex += value.toString(16);
  }
  return hex;
}

export function unpackCurveGapMask(hex) {
  const T = CURVE_GAP_MASK_TILES;
  const bits = new Uint8Array(T * T);
  for (let i = 0; i < bits.length; i += 4) {
    const value = parseInt(hex.slice(i / 4, i / 4 + 1), 16) || 0;
    bits[i] = value & 1;
    bits[i + 1] = (value >> 1) & 1;
    bits[i + 2] = (value >> 2) & 1;
    bits[i + 3] = (value >> 3) & 1;
  }
  return bits;
}

// --- Snapshot serializer ---
export function createCurveWorldPacket(game) {
  if (!game) return null;
  const segments = Array.isArray(game.segments) ? game.segments : [];
  const perPlayer = new Map();
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    const owner = seg.owner;
    if (!Number.isInteger(owner)) continue;
    const list = perPlayer.get(owner) || [];
    if (list.length < CURVE_NEAR_PER_PLAYER) list.push(seg);
    perPlayer.set(owner, list);
  }
  const near = [];
  for (const [owner, list] of perPlayer) {
    for (const seg of list) {
      if (near.length >= CURVE_TOTAL_NEAR_CAP) break;
      near.push([
        owner,
        round1(seg.x1), round1(seg.y1), round1(seg.x2), round1(seg.y2),
        (seg.isGap ? 1 : 0) | (seg.shrink ? 2 : 0) | (seg.thick ? 4 : 0),
      ]);
    }
  }
  const field = game.field || {
    x: game.arena?.left || 0,
    y: game.arena?.top || 0,
    s: game.arena?.size || game.arena?.width || 0,
  };
  return createWorldSnapshot(game, {
    mode: 'CURVE',
    mapPlayer: (p) => ({
      slot: p.index,
      joined: p.isJoined !== false,
      alive: p.isAlive !== false,
      x: round1(p.x || 0),
      y: round1(p.y || 0),
      angle: round1(p.angle || 0),
      shrink: (p.shrinkTimer || 0) > 0,
      thick: (p.thickTimer || 0) > 0,
      ghost: (p.ghostTimer || 0) > 0,
      freeze: (p.freezeTimer || 0) > 0,
      turbo: (p.turboTimer || 0) > 0,
      confused: (p.confusedTimer || 0) > 0,
      confusedTimer: round1(p.confusedTimer || 0),
      gap: p.isGap === true,
      gapTimer: round1(p.gapTimer || 0),
    }),
    extras: {
      near,
      field: packCurveFieldMask(segments, field),
      gaps: packCurveGapMask(segments, field),
      matchDraw: game.matchDraw === true,
      pickups: (Array.isArray(game.pickups) ? game.pickups : []).slice(0, 3).map((item) => ({
        x: round1(item.x), y: round1(item.y),
        size: round1(item.size || 24),
        type: item.type || 'TURBO',
      })),
      texts: (Array.isArray(game.floatingTexts) ? game.floatingTexts : []).slice(0, 6).map((ft) => ({
        x: round1(ft.x), y: round1(ft.y),
        text: String(ft.text || '').slice(0, 24),
        alpha: Math.max(0, Math.min(1, (ft.maxLife ? ft.life / ft.maxLife : 0))),
        color: typeof ft.color === 'string' ? ft.color : '#1A1A1A',
      })),
    },
  });
}

function isValidCurvePlayer(p) {
  return finite(p.angle)
    && ['shrink', 'thick', 'ghost', 'freeze', 'turbo', 'confused', 'gap'].every((k) => typeof p[k] === 'boolean')
    && finite(p.confusedTimer) && finite(p.gapTimer);
}

function isValidCurveExtra(frame) {
  if (!Array.isArray(frame.near) || frame.near.length > CURVE_TOTAL_NEAR_CAP) return false;
  if (!frame.near.every((s) => Array.isArray(s) && s.length === 6
    && Number.isInteger(s[0]) && s[0] >= 0 && s[0] <= 3
    && finite(s[1]) && finite(s[2]) && finite(s[3]) && finite(s[4])
    && Number.isInteger(s[5]) && s[5] >= 0 && s[5] <= 7)) return false;
  const expectedHexLen = (CURVE_FIELD_TILES * CURVE_FIELD_TILES) / 2;
  if (typeof frame.field !== 'string' || frame.field.length !== expectedHexLen) return false;
  if (!/^[0-9a-f]+$/.test(frame.field)) return false;
  if (typeof frame.gaps !== 'string' || frame.gaps.length !== (CURVE_GAP_MASK_TILES * CURVE_GAP_MASK_TILES) / 4) return false;
  if (!/^[0-9a-f]+$/.test(frame.gaps)) return false;
  if (typeof frame.matchDraw !== 'boolean') return false;
  if (!Array.isArray(frame.pickups) || frame.pickups.length > 3) return false;
  if (!frame.pickups.every((p) => p && finite(p.x) && finite(p.y) && finite(p.size) && typeof p.type === 'string')) return false;
  if (!Array.isArray(frame.texts) || frame.texts.length > 6) return false;
  if (!frame.texts.every((ft) => ft && finite(ft.x) && finite(ft.y) && typeof ft.text === 'string'
    && finite(ft.alpha) && typeof ft.color === 'string')) return false;
  return true;
}

export function isValidCurveWorldFrame(frame) {
  return isValidWorldBase(frame, 'CURVE', {
    checkPlayer: isValidCurvePlayer,
    checkExtra: isValidCurveExtra,
  });
}

// --- Ortak çizim yardımcıları (client dünya sahnesi) ---
export function drawCurveFieldMask(ctx, fieldRect, mask, colors, gapMask = null) {
  const T = CURVE_FIELD_TILES;
  const tw = (fieldRect.s || 0) / T;
  if (tw <= 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(4, tw * 0.55);
  ctx.globalAlpha = 0.55;
  for (let cy = 0; cy < T; cy++) {
    for (let cx = 0; cx < T; cx++) {
      const index = cy * T + cx;
      if (gapMask?.[index]) continue;
      const owner = mask[index];
      if (owner === 0) continue;
      const color = colors[owner - 1];
      if (!color) continue;
      // Her hücre için kısa bir çizgi: kaba ama sürekli bir iz hissi verir
      const x = fieldRect.x + (cx + 0.5) * tw;
      const y = fieldRect.y + (cy + 0.5) * tw;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(x - tw * 0.5, y);
      ctx.lineTo(x + tw * 0.5, y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function drawCurveNearSegments(ctx, near, colors) {
  ctx.save();
  ctx.lineCap = 'round';
  for (const s of near) {
    const flags = s[5];
    if (flags & 1) continue; // gap: görsel olarak yok
    ctx.lineWidth = (flags & 4) ? 8.5 : ((flags & 2) ? 2.2 : 4);
    ctx.strokeStyle = colors[s[0]] || '#1A1A1A';
    ctx.beginPath();
    ctx.moveTo(s[1], s[2]);
    ctx.lineTo(s[3], s[4]);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawCurveHeads(ctx, players) {
  for (const p of players) {
    if (!isWorldEntityVisible(p)) continue;
    ctx.save();
    const headRadius = p.shrink ? 3.2 : 5;

    if (p.freeze) {
      ctx.strokeStyle = '#00B4D8';
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 2]);
      ctx.beginPath(); ctx.arc(p.x, p.y, headRadius + 6, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (p.thick) {
      ctx.strokeStyle = '#D99B26';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, headRadius + 4.5, 0, Math.PI * 2); ctx.stroke();
    }
    if (p.ghost) {
      ctx.beginPath(); ctx.arc(p.x, p.y, headRadius + 5, 0, Math.PI * 2);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = '#70E000';
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (p.confused) {
      ctx.beginPath(); ctx.arc(p.x, p.y, headRadius + 7, 0, Math.PI * 2);
      ctx.setLineDash([1, 3]);
      ctx.strokeStyle = '#FF473A';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (p.gapTimer <= 0.4 && !p.gap) {
      ctx.beginPath(); ctx.arc(p.x, p.y, headRadius + 4, 0, Math.PI * 2);
      ctx.strokeStyle = '#D84727';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([2, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.beginPath(); ctx.arc(p.x, p.y, headRadius, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(
      p.x + Math.cos(p.angle || 0) * (headRadius * 0.6),
      p.y + Math.sin(p.angle || 0) * (headRadius * 0.6),
      Math.max(1.2, headRadius * 0.35),
      0, Math.PI * 2,
    );
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.restore();
  }
}

export function drawCurvePickups(ctx, pickups) {
  for (const item of pickups) {
    drawPickup(ctx, { x: item.x, y: item.y, type: item.type, animTime: 0 }, { size: item.size || 24 });
  }
}

export { drawSquareParticles, drawAlphaTexts };
