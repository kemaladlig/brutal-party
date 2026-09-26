// Paylaşılan ZONE dünya snapshot'ı + çizim sınırı (worldCore deseni).
// Yetkili host, uzak telefon client'larıyla aynı çizim yardımcılarını kullanır;
// client simülasyon/AI import etmez, yalnız salt-okunur draw + snapshot/validator alır.
// Not: 64x64 bölge grid'i RLE (run-length) ile taşınır — 4096 hücre yerine ortalama
// yüzlerce [len, owner] çifti; client `territoryLayer` offscreen kanvasını RLE'den yeniden kurar.
// Relic ikonları tek kaynak tabletopIcons registry anahtarıdır (snapshot'ta ikon değil tür gider).

import { drawGameAvatar } from '../core/avatarInGame.js';
import { drawTabletopIcon } from '../core/tabletopIcons.js';
import {
  round1,
  createWorldSnapshot,
  isValidWorldBase,
  isWorldEntityVisible,
} from './worldCore.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const round2 = (v) => Math.round(Number(v) * 100) / 100;
const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

export const ZONE_GRID = 64;

// --- RLE encode/decode (host serialize, client offscreen yeniden kurulum) ---
export function packZoneGridRle(grid, size = ZONE_GRID) {
  const total = size * size;
  const out = [];
  let run = 1;
  let prev = Number(grid?.[0]) || 0;
  for (let i = 1; i <= total; i++) {
    const v = i < total ? (Number(grid[i]) || 0) : null;
    if (v === prev && run < 4096) {
      run++;
    } else {
      out.push(run, prev);
      prev = v;
      run = 1;
    }
  }
  return out;
}

export function unpackZoneGridRle(rle, size = ZONE_GRID) {
  const grid = new Uint8Array(size * size);
  let i = 0;
  for (let k = 0; k + 1 < (rle?.length || 0); k += 2) {
    const len = rle[k];
    const owner = rle[k + 1];
    for (let n = 0; n < len && i < grid.length; n++) grid[i++] = owner;
  }
  return grid;
}

// --- Snapshot serializer (host tarafı, deklaratif extras) ---
export function createZoneWorldPacket(game) {
  if (!game) return null;
  const pct = Array.isArray(game.pct) ? game.pct : [0, 0, 0, 0];
  return createWorldSnapshot(game, {
    mode: 'ZONE',
    mapPlayer: (p) => ({
      slot: p.index,
      joined: p.isJoined !== false,
      alive: p.isAlive !== false,
      x: round1(p.x || 0),
      y: round1(p.y || 0),
      angle: round1(p.heading || 0),
      radius: round1(p.radius || 18),
      home: p.onHomeTurf === true,
      stun: round2(p.stunTimer || 0),
      blink: round2(p.blinkTimer || 0),
      dashProg: (p.dashCooldown || 0) > 0
        ? round2(1 - Math.max(0, Math.min(1, p.dashCooldown / 4.0))) : null,
      relic: (p.relicTimer || 0) > 0,
      pct: Math.round(Number(pct[p.index]) || 0),
      trail: (Array.isArray(p.trail) ? p.trail : []).slice(-64).map((ci) => Number(ci) || 0),
      trailStart: [round1(p.trailStartX || p.x || 0), round1(p.trailStartY || p.y || 0)],
    }),
    extras: {
      field: [round1(game.field?.x || 0), round1(game.field?.y || 0), round1(game.field?.s || 0)],
      cell: round1(game.cell || 0),
      rle: packZoneGridRle(game.grid),
      // Bölge katmanı sadece repaint edildiğinde artar (client 4096 hücreyi her karede değil, versiyon değişince yeniden kurar)
      gridV: Number(game.gridVersion) || 0,
      matchDraw: game.matchDraw === true,
      leader: Number.isInteger(game.leaderIndex) ? game.leaderIndex : -1,
      relics: (Array.isArray(game.relics) ? game.relics : []).slice(0, 2).map((rel) => ({
        x: round1(rel.x), y: round1(rel.y),
        scale: round2(rel.scale ?? 1),
        phase: round2(rel.bobPhase || 0),
        type: rel.type || 'FLASH',
      })),
      waves: (Array.isArray(game.captureWaves) ? game.captureWaves : []).slice(0, 8).map((cw) => ({
        x: round1(cw.x), y: round1(cw.y),
        radius: round1(cw.radius || 0),
        alpha: round2(cw.alpha ?? 1),
        color: typeof cw.color === 'string' ? cw.color : '#2F6A4F',
      })),
      texts: (Array.isArray(game.floatingTexts) ? game.floatingTexts : []).slice(0, 8).map((ft) => ({
        x: round1(ft.x), y: round1(ft.y),
        text: String(ft.text || '').slice(0, 24),
        life: round2(ft.life || 0),
        maxLife: round2(ft.maxLife || 1),
        color: typeof ft.color === 'string' ? ft.color : '#1A1A1A',
      })),
    },
  });
}

function isValidZonePlayer(p) {
  return typeof p.joined === 'boolean' && typeof p.alive === 'boolean'
    && finite(p.angle) && finite(p.radius) && p.radius > 0
    && typeof p.home === 'boolean' && finite(p.stun) && finite(p.blink)
    && (p.dashProg === null || (finite(p.dashProg) && p.dashProg >= 0 && p.dashProg <= 1))
    && typeof p.relic === 'boolean' && Number.isInteger(p.pct) && p.pct >= 0 && p.pct <= 100
    && Array.isArray(p.trail) && p.trail.length <= 64
    && p.trail.every((ci) => Number.isInteger(ci) && ci >= 0 && ci < ZONE_GRID * ZONE_GRID)
    && Array.isArray(p.trailStart) && p.trailStart.length === 2
    && finite(p.trailStart[0]) && finite(p.trailStart[1]);
}

function isValidZoneExtra(frame) {
  if (!Array.isArray(frame.field) || frame.field.length !== 3 || !frame.field.every(finite)) return false;
  if (frame.field[2] <= 0) return false;
  if (!finite(frame.cell) || frame.cell <= 0) return false;
  if (Math.abs(frame.field[2] - frame.cell * ZONE_GRID) > 2.0) return false;
  if (!Array.isArray(frame.rle) || frame.rle.length === 0 || frame.rle.length % 2 !== 0) return false;
  if (frame.rle.length > 4096 * 2) return false;
  if (frame.rle.reduce((sum, value, index) => index % 2 === 0 ? sum + value : sum, 0) !== ZONE_GRID * ZONE_GRID) return false;
  if (!Number.isInteger(frame.gridV) || frame.gridV < 0) return false;
  if (typeof frame.matchDraw !== 'boolean') return false;
  if (!frame.rle.every((v, i) => (i % 2 === 0
    ? Number.isInteger(v) && v > 0 && v <= 4096
    : Number.isInteger(v) && v >= 0 && v <= 4))) return false;
  if (!Number.isInteger(frame.leader) || frame.leader < -1 || frame.leader > 3) return false;
  if (!Array.isArray(frame.relics) || frame.relics.length > 2) return false;
  if (!frame.relics.every((r) => r && finite(r.x) && finite(r.y) && finite(r.scale)
    && finite(r.phase) && (r.type === 'FLASH' || r.type === 'SEISMIC'))) return false;
  if (!Array.isArray(frame.waves) || frame.waves.length > 8) return false;
  if (!frame.waves.every((w) => w && finite(w.x) && finite(w.y) && finite(w.radius)
    && finite(w.alpha) && typeof w.color === 'string')) return false;
  if (!Array.isArray(frame.texts) || frame.texts.length > 8) return false;
  if (!frame.texts.every((ft) => ft && finite(ft.x) && finite(ft.y) && typeof ft.text === 'string'
    && finite(ft.life) && finite(ft.maxLife) && typeof ft.color === 'string')) return false;
  return true;
}

// --- Client frame doğrulaması ---
export function isValidZoneWorldFrame(frame) {
  return isValidWorldBase(frame, 'ZONE', {
    checkPlayer: isValidZonePlayer,
    checkExtra: isValidZoneExtra,
  });
}

// --- Ortak çizim yardımcıları (host + client) ---
// Bölge katmanı: host kendi offscreen canvas'ını (kirli- bayrak cache'li) verir;
// client yoksa ctx başına bir kez üretip RLE'den yeniden kurar.
const TERRITORY_LAYERS = new WeakMap();

function getTerritoryLayer(ctx) {
  let layer = TERRITORY_LAYERS.get(ctx);
  if (!layer) {
    const canvas = document.createElement('canvas');
    canvas.width = ZONE_GRID;
    canvas.height = ZONE_GRID;
    layer = { canvas, ctx: canvas.getContext('2d'), stamp: null };
    TERRITORY_LAYERS.set(ctx, layer);
  }
  return layer;
}

function paintTerritory(layer, grid, colors, stamp) {
  if (layer.stamp === stamp) return;
  layer.ctx.clearRect(0, 0, ZONE_GRID, ZONE_GRID);
  for (let i = 0; i < grid.length; i++) {
    const o = grid[i];
    if (o === 0) continue;
    layer.ctx.fillStyle = colors[o - 1] || '#888888';
    layer.ctx.fillRect(i % ZONE_GRID, (i / ZONE_GRID) | 0, 1, 1);
  }
  layer.stamp = stamp;
}

export function drawZoneField(ctx, field, cell, grid, colors, players, relics, nowSec = 0, layerCanvas = null, stamp = 0) {
  const [x, y, s] = field;
  if (s <= 0) return;

  const layer = layerCanvas
    ? { canvas: layerCanvas, ctx: null, stamp }
    : getTerritoryLayer(ctx);
  if (layerCanvas) {
    if (stamp !== 0) layer.stamp = stamp;
  } else {
    paintTerritory(layer, grid, colors, stamp);
  }

  ctx.fillStyle = '#EFEAE0';
  ctx.fillRect(x, y, s, s);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(layer.canvas, x, y, s, s);
  ctx.imageSmoothingEnabled = true;

  ctx.strokeStyle = 'rgba(26,26,26,0.08)';
  const u = s / 952;
  ctx.lineWidth = 1 * u;
  const step = s / 8;
  ctx.beginPath();
  for (let i = 1; i < 8; i++) {
    ctx.moveTo(x + i * step, y);
    ctx.lineTo(x + i * step, y + s);
    ctx.moveTo(x, y + i * step);
    ctx.lineTo(x + s, y + i * step);
  }
  ctx.stroke();

  const bLen = Math.max(16, Math.round(s * 0.05));
  ctx.strokeStyle = '#2B2B28';
  ctx.lineWidth = 3 * u;
  const cornerPlates = [
    [[x, y + bLen], [x, y], [x + bLen, y]],
    [[x + s - bLen, y], [x + s, y], [x + s, y + bLen]],
    [[x, y + s - bLen], [x, y + s], [x + bLen, y + s]],
    [[x + s - bLen, y + s], [x + s, y + s], [x + s, y + s - bLen]],
  ];
  for (const [[x1, y1], [x2, y2], [x3, y3]] of cornerPlates) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.stroke();
  }

  // Relic kristalleri (ikon tek kaynak vektör)
  for (const rel of relics) {
    const bob = Math.sin(nowSec * 4 + rel.phase) * 4;
    const rx = rel.x;
    const ry = rel.y + bob;
    const rSize = cell * 1.6 * rel.scale;
    const color = rel.type === 'FLASH' ? '#FFD122' : '#FF473A';

    ctx.save();
    ctx.translate(rx, ry);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(0, 10 - bob * 0.5, rSize * 0.7, rSize * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    const pulse = 0.5 + 0.5 * Math.sin(nowSec * 6 + rel.phase);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.4 + 0.3 * pulse;
    ctx.lineWidth = 2.5 * u;
    ctx.strokeRect(-rSize * 0.65, -rSize * 0.65, rSize * 1.3, rSize * 1.3);

    ctx.globalAlpha = 1.0;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -rSize);
    ctx.lineTo(rSize, 0);
    ctx.lineTo(0, rSize);
    ctx.lineTo(-rSize, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#1C1C1A';
    ctx.lineWidth = 2.5 * u;
    ctx.stroke();

    drawTabletopIcon(ctx, rel.type === 'FLASH' ? 'zap' : 'flame', 0, 1, Math.max(12, rSize * 0.8), { color: '#1C1C1A' });
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // Açık izler: risk renklendirmesi + tehlike şeridi
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const p of players) {
    if (!isWorldEntityVisible(p) || (p.trail?.length || 0) === 0) continue;
    const trailLen = p.trail.length;
    const isRiskWarn = trailLen >= 15;
    const isHazard = trailLen >= 22;
    const cellCenter = (ci) => ({ x: x + ((ci % ZONE_GRID) + 0.5) * cell, y: y + (((ci / ZONE_GRID) | 0) + 0.5) * cell });

    ctx.save();
    if (isRiskWarn) {
      ctx.strokeStyle = isHazard ? '#D84727' : p.color;
      ctx.lineWidth = cell * (isHazard ? 1.25 : 1.05);
      ctx.globalAlpha = isHazard ? (0.6 + 0.4 * Math.sin(nowSec * 16)) : 0.4;
      ctx.beginPath();
      ctx.moveTo(p.trailStart[0], p.trailStart[1]);
      for (const ci of p.trail) {
        const c = cellCenter(ci);
        ctx.lineTo(c.x, c.y);
      }
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = cell * 0.95;
    if (isHazard) {
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = -(nowSec * 32) % 14;
    }
    ctx.beginPath();
    ctx.moveTo(p.trailStart[0], p.trailStart[1]);
    for (const ci of p.trail) {
      const c = cellCenter(ci);
      ctx.lineTo(c.x, c.y);
    }
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.restore();
  }

  // Dış çerçeve + sert gölge
  ctx.fillStyle = '#1A1A1A';
  ctx.fillRect(x + s, y + 6, 6, s);
  ctx.fillRect(x + 6, y + s, s, 6);
  ctx.strokeStyle = '#1A1A1A';
  ctx.lineWidth = 5 * (s / 952);
  ctx.strokeRect(x, y, s, s);
}

export function drawZonePlayers(ctx, players, { cell = 0, leaderIndex = -1, withFx = true } = {}) {
  for (const p of players) {
    if (!isWorldEntityVisible(p)) continue;
    if (withFx && p.stun > 0 && Math.floor(p.blink / 0.15) % 2 === 0) continue;

    const u = (p.radius || 18) / 18;
    ctx.save();
    ctx.translate(p.x, p.y);

    if (withFx && p.home && p.stun <= 0) {
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.arc(0, 0, p.radius + 3.5 * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }

    if (withFx && p.slot === leaderIndex && p.pct > 0) {
      drawTabletopIcon(ctx, 'crown', 0, -p.radius - 26, 20, { color: '#FFDE59' });
    }

    let currentExp = 'normal';
    if (p.stun > 0) currentExp = 'dizzy';
    else if ((p.trail?.length || 0) >= 22) currentExp = 'panic';
    else if (p.relic) currentExp = 'excited';

    drawGameAvatar(ctx, 0, 0, p.radius, p, {
      color: p.color,
      slotIndex: p.slot ?? p.index,
      facingAngle: p.angle,
      label: `P${(p.slot ?? p.index ?? 0) + 1}`,
      expression: currentExp,
      showPointer: true,
      borderColor: p.stun > 0 ? '#48CAE4' : '#1C1C1A',
      borderWidth: 3 * u,
    });

    if (p.dashProg !== null && p.dashProg !== undefined) {
      ctx.save();
      ctx.strokeStyle = 'rgba(26, 26, 26, 0.45)';
      ctx.lineWidth = 3.5 * u;
      ctx.beginPath();
      ctx.arc(0, 0, p.radius + 5 * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#FFDE59';
      ctx.lineWidth = 3 * u;
      ctx.beginPath();
      ctx.arc(0, 0, p.radius + 5 * u, -Math.PI / 2, -Math.PI / 2 + clamp01(p.dashProg) * Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const label = `P${(p.slot ?? p.index ?? 0) + 1} • %${p.pct ?? 0}`;
    ctx.font = '900 11px "Space Grotesk", sans-serif';
    const tw = (ctx.measureText(label).width || 40) + 12;
    ctx.fillStyle = '#1C1C1A';
    ctx.fillRect(-tw / 2, p.radius + 6, tw, 18);
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, p.radius + 15);

    ctx.restore();
  }
}

export function drawZoneWaves(ctx, waves, cell) {
  for (const cw of waves || []) {
    ctx.save();
    ctx.strokeStyle = cw.color;
    ctx.globalAlpha = clamp01(cw.alpha ?? 1);
    ctx.lineWidth = Math.max(2, cell * 0.45 * clamp01(cw.alpha ?? 1));
    ctx.beginPath();
    ctx.arc(cw.x, cw.y, cw.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

