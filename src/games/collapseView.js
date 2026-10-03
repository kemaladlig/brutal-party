// Paylaşılan COLLAPSE dünya snapshot'ı + çizim sınırı (worldCore deseni).
// Yetkili host, uzak telefon client'larıyla aynı çizim yardımcılarını kullanır;
// client simülasyon/AI import etmez, yalnız salt-okunur draw + snapshot/validator alır.
// Not: 13x13 grid ham taşınır (169 durum + uyarı sayaçları); pickup ikonları
// tabletopIcons vektörleridir (SUPER_JUMP→chevrons_up, REPAIR_TILES→hammer, BLAST_WAVE→wind).

import { drawGameAvatar } from '../core/avatarInGame.js';
import { fxReadAlpha, packFloatingTexts, isValidFloatingTexts } from '../core/fxKit.js';
import { drawTabletopIcon } from '../core/tabletopIcons.js';
import { drawStatusChip, STATUS_STATE } from '../core/entityStatus.js';
import { drawDioramaShadow, drawDioramaCoin } from '../core/dioramaKit.js';
import { UI_COLORS } from '../ui/tokens.js';
import {
  round1,
  createWorldSnapshot,
  isValidWorldBase,
  isWorldEntityVisible,
  packFxState,
  isValidFxState,
  drawFxRings,
  drawFxPops,
  drawCircleParticles,
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
      vx: round1(p.vx || 0),
      vy: round1(p.vy || 0),
      radius: round1(p.radius || 36),
      jump: round2((p.jumpTimer || 0) > 0 ? (p.jumpTimer || 0) / 0.45 : 0),
      super: (p.superJumpTimer || 0) > 0,
    }),
    extras: {
      selfPredict: true,
      cell: round1(game.cellSize || 0),
      matchDraw: game.matchDraw === true,
      timeLeft: round1(game.roundTime || 0),
      grid: states,
      warn: warn.slice(0, 169),
      falling: (Array.isArray(game.fallingTiles) ? game.fallingTiles : []).slice(0, 12).map((ft) => ({
        x: round1(ft.x), y: round1(ft.y),
        rot: round2(ft.rot || 0),
        scale: round2(ft.scale ?? 1),
        alpha: round2(ft.alpha ?? 1),
        size: round1(ft.size || 20),
        color: typeof ft.colorVariant === 'string' ? ft.colorVariant : UI_COLORS.crownGold,
      })),
      waves: (Array.isArray(game.shockwaves) ? game.shockwaves : []).slice(0, 8).map((sw) => ({
        x: round1(sw.x), y: round1(sw.y),
        radius: round1(sw.radius || 0),
        alpha: round2(sw.alpha ?? 1),
        color: typeof sw.color === 'string' ? sw.color : UI_COLORS.white,
      })),
      pickups: (Array.isArray(game.pickups) ? game.pickups : []).slice(0, 6).map((pu) => ({
        x: round1(pu.x), y: round1(pu.y),
        type: pu.type || 'SUPER_JUMP',
        pulse: round2(pu.pulse || 0),
      })),
      // Yüzen metin (SİSTEM 3): `fxKit.packFloatingTexts` tek kaynak; host
      // ilerletip paketler, client saf çizer (ui/hud.drawFloatingTextSnapshot).
      texts: packFloatingTexts(game.floatingTexts),
      // FX kanalı (MOTION_PLAN Faz 2b): host FX runtime'ının saf anlık görüntüsü
      // (tanks deseni). Playback canlıyken paket yükü yok sayılır (yedek kanal).
      fx: packFxState(game.fx),
    },
  });
}

function isValidCollapsePlayer(p) {
  return typeof p.joined === 'boolean' && typeof p.alive === 'boolean'
    && finite(p.jump) && p.jump >= 0 && p.jump <= 1
    && typeof p.super === 'boolean'
    && (p.vx === undefined || finite(p.vx))
    && (p.vy === undefined || finite(p.vy));
}

function isValidCollapseExtra(frame) {
  if (!finite(frame.cell) || frame.cell <= 0) return false;
  if (typeof frame.matchDraw !== 'boolean' || !finite(frame.timeLeft) || frame.timeLeft < 0) return false;
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
  // fx alanı v2 eklentisidir; eski host frames'i yoktur (opsiyonel, v1 uyumu).
  if (frame.fx !== undefined && !isValidFxState(frame.fx)) return false;
  // texts kanalı da v2 eklentisidir (aynı opsiyonel kural).
  if (!isValidFloatingTexts(frame.texts)) return false;
  return true;
}

// --- Client frame doğrulaması ---
export function isValidCollapseWorldFrame(frame) {
  return isValidWorldBase(frame, 'COLLAPSE', {
    checkPlayer: isValidCollapsePlayer,
    checkExtra: isValidCollapseExtra,
  });
}

function tilePath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    return;
  }
  ctx.beginPath();
  ctx.rect(x, y, w, h);
}

// Taş levha hissi için silik beşgen derz: collision hep karedir,
// yalnız görsel dokudur.
function etchPentagon(ctx, cx, cy, pr, rotation, style, width) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const px = Math.cos(a) * pr;
    const py = Math.sin(a) * pr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}

// --- Ortak çizim yardımcıları (host + client) ---
export function drawCollapseFalling(ctx, falling) {
  for (const ft of falling || []) {
    ctx.save();
    ctx.globalAlpha = clamp01(ft.alpha ?? 1);
    ctx.translate(ft.x, ft.y);
    ctx.rotate(ft.rot || 0);
    ctx.scale(ft.scale ?? 1, ft.scale ?? 1);
    const s = ft.size || 20;
    const r = s * 0.18;
    ctx.globalAlpha = clamp01(ft.alpha ?? 1) * 0.45;
    ctx.fillStyle = UI_COLORS.pureBlack;
    tilePath(ctx, -s / 2, -s / 2 + Math.max(2, s * 0.1), s, s, r);
    ctx.fill();
    ctx.globalAlpha = clamp01(ft.alpha ?? 1);
    ctx.fillStyle = ft.color || UI_COLORS.crownGold;
    tilePath(ctx, -s / 2, -s / 2, s, s, r);
    ctx.fill();
    ctx.globalAlpha = clamp01(ft.alpha ?? 1) * 0.22;
    ctx.fillStyle = UI_COLORS.white;
    tilePath(ctx, -s / 2 + s * 0.12, -s / 2 + s * 0.1, s * 0.76, s * 0.28, r * 0.7);
    ctx.fill();
    ctx.globalAlpha = clamp01(ft.alpha ?? 1) * 0.18;
    etchPentagon(ctx, 0, s * 0.08, s * 0.22, 0.3, UI_COLORS.pureBlack, Math.max(1, s * 0.04));
    ctx.globalAlpha = clamp01(ft.alpha ?? 1);
    ctx.strokeStyle = UI_COLORS.inkDark;
    ctx.lineWidth = Math.max(1, 2 * (s / 20));
    tilePath(ctx, -s / 2, -s / 2, s, s, r);
    ctx.stroke();
    ctx.restore();
  }
}

export function drawCollapseGrid(ctx, arena, cell, states, warn, { withFx = true, now = 0 } = {}) {
  const cols = COLLAPSE_COLS;
  const rows = COLLAPSE_ROWS;
  const cellSize = cell;
  const offsetX = arena.cx - (cols * cellSize) / 2;
  const offsetY = arena.cy - (rows * cellSize) / 2;
  // Uyarı sayısı küçüktür; ara `map` dizisi üretmeden doğrudan Map'e al —
  // kare başına 169 karoluk ızgarada bu tahsis gereksiz GC baskısıydı.
  const warnByIdx = warn && warn.length ? new Map(warn) : null;
  const padding = Math.max(1.5, cellSize * 0.05);
  const depth = Math.max(2, cellSize * 0.11);
  const radius = cellSize * 0.18;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const state = states[idx];
      const tx = offsetX + c * cellSize;
      const ty = offsetY + r * cellSize;
      const tw = cellSize - padding * 2;
      const th = cellSize - padding * 2;

      if (state === 2) {
        // Çökmüş karo: derin uçurum / chasm oklüzyonu
        ctx.save();
        ctx.fillStyle = UI_COLORS.pureBlack;
        ctx.globalAlpha = 0.48;
        tilePath(ctx, tx + padding, ty + padding, tw, th, radius * 0.4);
        ctx.fill();
        ctx.restore();
        continue;
      }

      let wobbleX = 0, wobbleY = 0, scaleAdd = 0;
      let ratio = 1;
      if (state === 1) {
        const timer = warnByIdx?.get(idx) ?? 0.85;
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
      ctx.translate(-tw / 2, -th / 2);

      const u = arena?.unit ?? (cellSize ? cellSize / 40 : 1);
      // Derinlik: alttan taşan koyu levha gövdesi.
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = UI_COLORS.pureBlack;
      tilePath(ctx, 0, depth, tw, th, radius);
      ctx.fill();
      ctx.globalAlpha = 1;

      if (state === 0) {
        const toneShift = ((r * 7 + c * 13) % 18) - 9;
        const baseL = 248 + toneShift;
        ctx.fillStyle = `rgb(${baseL}, ${baseL - 3}, ${baseL - 8})`;
        tilePath(ctx, 0, 0, tw, th, radius);
        ctx.fill();
        // Üst ışık: taş levha parlaklığı.
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = UI_COLORS.white;
        tilePath(ctx, tw * 0.1, th * 0.08, tw * 0.8, th * 0.26, radius * 0.6);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = UI_COLORS.crownStone;
        ctx.lineWidth = Math.max(1, 1.5 * u);
        tilePath(ctx, 0, 0, tw, th, radius);
        ctx.stroke();
        ctx.globalAlpha = 0.16;
        etchPentagon(
          ctx, tw / 2, th * 0.58, Math.min(tw, th) * 0.24,
          ((r * 7 + c * 13) % 5) * 0.12 - 0.2,
          UI_COLORS.inkDark, Math.max(1, 1.2 * u),
        );
        ctx.globalAlpha = 1;
      } else {
        const rr = 255;
        const gg = Math.floor(154 * ratio + 26 * (1 - ratio));
        ctx.fillStyle = `rgb(${rr}, ${gg}, 0)`;
        tilePath(ctx, 0, 0, tw, th, radius);
        ctx.fill();
        ctx.globalAlpha = 0.55;
        const hl = Math.floor(220 * ratio + 100);
        ctx.fillStyle = `rgb(${rr}, ${hl}, 60)`;
        tilePath(ctx, tw * 0.1, th * 0.08, tw * 0.8, th * 0.3, radius * 0.6);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = ratio > 0.5 ? UI_COLORS.accent : UI_COLORS.danger;
        ctx.lineWidth = Math.max(1, 2 * u);
        tilePath(ctx, 0, 0, tw, th, radius);
        ctx.stroke();
        ctx.globalAlpha = 0.35;
        etchPentagon(
          ctx, tw / 2, th * 0.58, Math.min(tw, th) * 0.24,
          ((r * 7 + c * 13) % 5) * 0.12 - 0.2,
          UI_COLORS.danger, Math.max(1, 1.4 * u),
        );
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
  }
}

export function drawCollapseWaves(ctx, waves) {
  for (const sw of waves || []) {
    ctx.save();
    ctx.globalAlpha = clamp01(sw.alpha ?? 1);
    ctx.strokeStyle = sw.color || UI_COLORS.white;
    ctx.lineWidth = Math.max(1.5, 3.5 * ((sw.radius || 20) / 20));
    ctx.beginPath();
    ctx.arc(sw.x, sw.y, sw.radius || 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * FX katmanının tek çizim sırası: pop → ring → partikül. Host motoru ve
 * client worldView AYNI fonksiyonu çağırır (tanks deseni).
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ pops?: any[], rings?: any[], particles?: any[] }} layer
 */
export function drawCollapseFxLayer(ctx, layer) {
  drawFxPops(ctx, layer?.pops);
  drawFxRings(ctx, layer?.rings);
  drawCircleParticles(ctx, layer?.particles);
}

export function drawCollapsePickups(ctx, pickups, now = 0) {
  for (const pu of pickups || []) {
    const pulse = 1 + Math.sin(now / 200 + (pu.pulse || 0)) * 0.08;
    const r = 13 * pulse;
    const u = r / 13;
    const hoverY = Math.sin(now / 180 + pu.x * 0.05) * 3 * u;
    const icon = PICKUP_ICONS[pu.type] || 'wind';
    const color = pu.type === 'SUPER_JUMP' ? UI_COLORS.turbo : (pu.type === 'REPAIR_TILES' ? UI_COLORS.crownGreen : UI_COLORS.crownBlue);

    drawDioramaCoin(ctx, pu.x, pu.y, r, {
      u,
      hoverY,
      color,
      icon,
      iconColor: UI_COLORS.inkDark,
    });
  }
}

// Slot başına son bakış yönü: client paketinde angle yok, vx/vy sıfırken
// yüz merkeze kilitlenmesin. Modül düzeyi sabit dizi, kare başına tahsis yok.
const COLLAPSE_LAST_FACING = [0, 0, 0, 0];

function collapseWarnTimer(warn, idx) {
  if (!warn) return 0.85;
  for (let k = 0; k < warn.length; k++) {
    const w = warn[k];
    if (w && w[0] === idx) return w[1];
  }
  return 0.85;
}

export function drawCollapsePlayers(ctx, players, { selfSlot = -1, gridStates = null, warn = null, cell = 0, offsetX = 0, offsetY = 0 } = {}) {
  // 3.3 okunurluk hiyerarşisi: tek görür varsa kendi avatarın T1, diğerleri T3
  // (−%25); α yalnız fxKit'ten gelir.
  const hasViewer = Number.isInteger(selfSlot) && selfSlot >= 0;
  const hasGrid = Array.isArray(gridStates) && gridStates.length === COLLAPSE_COLS * COLLAPSE_ROWS && cell > 0;
  for (const player of players) {
    if (!isWorldEntityVisible(player)) continue;

    // Host `jumpTimer`, paket `jump` taşır — ikisini de okur.
    let rawJump = 0;
    if (Number.isFinite(player.jump)) rawJump = player.jump;
    else if ((player.jumpTimer || 0) > 0) rawJump = player.jumpTimer / 0.45;
    const jumpProgress = clamp01(rawJump);
    const isJumping = jumpProgress > 0;
    const jumpHeight = isJumping ? Math.sin(jumpProgress * Math.PI) * 16 : 0;
    const scale = 1.0 + (jumpHeight / 16) * 0.45;

    // 1. Zemin temas/uçuş gölgesi (Zıplama yüksekliğiyle gerçekçi diorama gölgesi)
    drawDioramaShadow(ctx, player.x, player.y, 14, { u: 1, height: jumpHeight, aspect: 0.55 });

    ctx.save();

    ctx.translate(player.x, player.y - jumpHeight);
    ctx.scale(scale, scale);

    const radius = player.radius || 36;
    const u = radius / 18;

    // `super` rozeti aşağıda, restore sonrası dünya koordinatında çizilir
    // (buradaki öteleme + zıplama ölçeği taşınır/ölçeklenir, taşmaz).
    // Host `superJumpTimer`, paket `super` taşır.
    const superActive = !!player.super || (player.superJumpTimer || 0) > 0;

    // Bakış: host `angle`, paket `vx/vy` — boşta son yön korunur.
    const slot = player.slot ?? player.index ?? 0;
    let facing = 0;
    let hasFacing = false;
    if (Number.isFinite(player.facingAngle)) {
      facing = player.facingAngle;
      hasFacing = true;
    } else if (Number.isFinite(player.angle)) {
      facing = player.angle;
      hasFacing = true;
    }
    const vx = player.vx;
    const vy = player.vy;
    if (Number.isFinite(vx) && Number.isFinite(vy)) {
      const spdSq = vx * vx + vy * vy;
      if (spdSq > 1225) {
        facing = Math.atan2(vy, vx);
        hasFacing = true;
        if (slot >= 0 && slot < 4) COLLAPSE_LAST_FACING[slot] = facing;
      }
    }
    if (!hasFacing || ((player.steerX || 0) * (player.steerX || 0) + (player.steerY || 0) * (player.steerY || 0)) > 0.0225) {
      const sx = player.steerX || 0;
      const sy = player.steerY || 0;
      if (sx * sx + sy * sy > 0.0225) {
        facing = Math.atan2(sy, sx);
        hasFacing = true;
        if (slot >= 0 && slot < 4) COLLAPSE_LAST_FACING[slot] = facing;
      }
    }
    if (!hasFacing && slot >= 0 && slot < 4) facing = COLLAPSE_LAST_FACING[slot] || 0;

    // Yüz: zıplama > süper > çöken zeminde panik/kızgın > sakin.
    // Grid zaten pakette var, ek alan yok (client-side juice).
    let expression = 'normal';
    if (isJumping) expression = 'excited';
    else if (superActive) expression = 'wink';
    else if (hasGrid) {
      const tc = Math.floor((player.x - offsetX) / cell);
      const tr = Math.floor((player.y - offsetY) / cell);
      if (tc >= 0 && tc < COLLAPSE_COLS && tr >= 0 && tr < COLLAPSE_ROWS) {
        const idx = tr * COLLAPSE_COLS + tc;
        if (gridStates[idx] === 1) {
          expression = collapseWarnTimer(warn, idx) < 0.4 ? 'panic' : 'angry';
        }
      }
    }

    drawGameAvatar(ctx, 0, 0, radius, player, {
      color: player.color,
      slotIndex: player.slot ?? player.index,
      label: `P${(player.slot ?? player.index ?? 0) + 1}`,
      expression,
      facingAngle: facing,
      showPointer: false,
      borderWidth: Math.max(1.5, 2.5 * u),
      shadowOffset: Math.max(1, 2 * u),
      // Zıplama sırasında gövde yerden ayrılır; gölge zeminle aradaki mesafeyi
      // takip etmeli. O teması bir satır üstte `drawDioramaShadow` zaten
      // `jumpHeight` ile çiziyor, merkezî gölge ikinci bir tabak basardı.
      grounded: false,
      alpha: fxReadAlpha({ isSelf: hasViewer && (player.slot ?? player.index) === selfSlot, hasViewer }),
    });

    ctx.restore();

    if (superActive) {
      // Süper zıplama: çift altın ince çember (1.18:1) yerine rozet.
      drawStatusChip(ctx, {
        x: player.x,
        y: player.y,
        radius,
        scale: u * 0.5,
        icon: 'zap',
        state: STATUS_STATE.READY,
      });
    }
  }
}

