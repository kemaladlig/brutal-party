// SUMO görünüm katmanı — HOST ve CLIENT aynı fonksiyonları çağırır (tek kaynak).
//
// Renk discipline (§8): bu dosyada ham renk literali yok; palet `fieldTheme()`
// ve `UI_COLORS` token'larından türer. Platformun kimliği koyu renkten değil
// YÜKSEKLİKTEN gelir: masa koyu, kaldırılmış disk açık, düşen gövde küçülüp
// soluyor — "buradan düşersen yere düşersin" TV mesafesinden okunur.

import { fieldTheme, drawField, hashFieldSeed } from '../core/fieldKit.js';
import { drawGameAvatar } from '../core/avatarInGame.js';
import { drawDioramaContactShadow } from '../core/dioramaKit.js';
import { packFloatingTexts, isValidFloatingTexts, fxReadAlpha } from '../core/fxKit.js';
import {
  round1,
  createWorldSnapshot,
  isValidWorldBase,
  packFxState,
  isValidFxState,
  drawFxRings,
  drawFxPops,
  drawCircleParticles,
} from './worldCore.js';
import { UI_COLORS } from '../ui/tokens.js';

const FALLBACK_R = 34;
const CHARGE_TIME = 0.24;
const FALL_TIME = 0.55;

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
const finite = (v) => Number.isFinite(v);

/** Takım rengi: P1/P2'nin kendi token rengi — yeni renk icat edilmez. */
export function sumoTeamColor(team) {
  return UI_COLORS.players[team === 0 ? 0 : 1];
}

// ── dünya paketi (host → client) ─────────────────────────────────────────────

export function createSumoWorldPacket(game) {
  const ring = game.ring || { cx: 0, cy: 0, r: 0 };
  return createWorldSnapshot(game, {
    mode: 'SUMO',
    mapPlayer: (p) => ({
      slot: p.index,
      joined: p.isJoined !== false,
      alive: p.isAlive !== false,
      x: round1(p.x || 0),
      y: round1(p.y || 0),
      vx: round1(p.vx || 0),
      vy: round1(p.vy || 0),
      radius: round1(p.radius || FALLBACK_R),
      angle: round1(p.angle || 0),
      mass: round1(p.mass || 1),
      team: p.team === 1 ? 1 : 0,
      charge: clamp01((p.chargeTimer || 0) / CHARGE_TIME),
      brace: p.braced === true,
      grabbedBy: Number.isInteger(p.grabbedBy) ? p.grabbedBy : -1,
      escape: clamp01(p.grabMeter),
      fall: clamp01((p.fallTimer || 0) / FALL_TIME),
      out: (p.fallTimer || 0) > 0 || (p.respawnTimer || 0) > 0,
      invuln: round1(p.invuln || 0),
    }),
    extras: {
      ring: [round1(ring.cx), round1(ring.cy), round1(ring.r)],
      takedowns: [
        Math.max(0, Number(game.teamTakedowns?.[0]) || 0),
        Math.max(0, Number(game.teamTakedowns?.[1]) || 0),
      ],
      timeLeft: round1(Math.max(0, Number(game.roundTime) || 0)),
      matchDraw: game.matchDraw === true,
      texts: packFloatingTexts(game.floatingTexts),
      fx: packFxState(game.fx),
    },
    particleCap: 48,
  });
}

export function isValidSumoWorldFrame(frame) {
  if (frame.texts !== undefined && !isValidFloatingTexts(frame.texts)) return false;
  if (frame.fx !== undefined && !isValidFxState(frame.fx)) return false;
  return isValidWorldBase(frame, 'SUMO', {
    maxParticles: 48,
    checkPlayer: (p) => (
      finite(p.vx) && finite(p.vy)
      && finite(p.radius) && p.radius > 0
      && finite(p.angle) && finite(p.mass) && p.mass > 0
      && Number.isInteger(p.team) && (p.team === 0 || p.team === 1)
      && finite(p.charge) && p.charge >= 0 && p.charge <= 1
      && typeof p.brace === 'boolean'
      && Number.isInteger(p.grabbedBy)
      && finite(p.escape) && finite(p.fall)
      && typeof p.out === 'boolean' && finite(p.invuln)
    ),
    checkExtra: (f) => (
      Array.isArray(f.ring) && f.ring.length === 3 && f.ring.every(finite) && f.ring[2] > 0
      && Array.isArray(f.takedowns) && f.takedowns.length === 2
      && f.takedowns.every((v) => Number.isInteger(v) && v >= 0)
      && finite(f.timeLeft) && f.timeLeft >= 0
      && typeof f.matchDraw === 'boolean'
    ),
  });
}

// ── çizim ────────────────────────────────────────────────────────────────────

/** Masa + kaldırılmış güreş platformu (küçülen halka + başlangıç hayaleti). */
export function drawSumoArena(ctx, arena, ring, opts = {}) {
  drawField(ctx, arena, { mode: 'SUMO', seed: hashFieldSeed('SUMO', opts.roundId ?? 0) });
  if (!ring || !(ring.r > 0)) return;

  const palette = fieldTheme(opts.theme ?? 'SUMO');
  const r = ring.r;
  const u = Math.max(0.55, r / 300);
  const rim = Math.max(4, r * 0.075);

  // 1. Platformun masaya düşen temas gölgesi — yüksekliğin tek kanıtı.
  drawDioramaContactShadow(ctx, ring.cx, ring.cy + rim * 1.5, r * 1.06, r * 0.99, { alpha: 0.55 });

  // 2. Kalın yan cephe (extrusion).
  ctx.beginPath();
  ctx.arc(ring.cx, ring.cy + rim, r, 0, Math.PI * 2);
  ctx.fillStyle = palette.floorLow;
  ctx.fill();
  ctx.strokeStyle = palette.edgeInk;
  ctx.lineWidth = Math.max(1.5, 2 * u);
  ctx.stroke();

  // 3. Üst yüzey.
  ctx.beginPath();
  ctx.arc(ring.cx, ring.cy, r, 0, Math.PI * 2);
  ctx.fillStyle = palette.floorHigh;
  ctx.fill();

  // 4. Sol-üst -45° ışık pahı (diorama dili).
  ctx.save();
  ctx.beginPath();
  ctx.arc(ring.cx, ring.cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = UI_COLORS.white;
  ctx.lineWidth = Math.max(3, r * 0.05);
  ctx.beginPath();
  ctx.arc(ring.cx, ring.cy, r - ctx.lineWidth * 0.5, Math.PI * 0.9, Math.PI * 1.75);
  ctx.stroke();
  ctx.restore();

  // 5. İç halka (dohyo) + küçülme öncesi sınırın hayaleti.
  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = Math.max(1.2, 1.6 * u);
  ctx.beginPath();
  ctx.arc(ring.cx, ring.cy, r * 0.52, 0, Math.PI * 2);
  ctx.stroke();
  if (ring.r0 > r * 1.02) {
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.setLineDash([Math.max(4, 6 * u), Math.max(5, 8 * u)]);
    ctx.beginPath();
    ctx.arc(ring.cx, ring.cy, ring.r0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 6. Düşme sınırı: tek net mürekkep çizgisi.
  ctx.strokeStyle = palette.cornerInk;
  ctx.lineWidth = Math.max(2, 2.6 * u);
  ctx.beginPath();
  ctx.arc(ring.cx, ring.cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

// Çizim sırası y'ye göre; kare başına tahsis olmasın diye sabit dizin tamponu.
const DRAW_ORDER = [0, 1, 2, 3];

/** Gövdeler, kenar baskısı halesi, kavrama bağlantısı ve düşme animasyonu. */
export function drawSumoPlayers(ctx, players, opts = {}) {
  const list = Array.isArray(players) ? players : [];
  const n = Math.min(4, list.length);
  const ring = opts.ring || null;
  const now = Number(opts.now) || 0;

  for (let i = 0; i < n; i += 1) DRAW_ORDER[i] = i;
  for (let i = 1; i < n; i += 1) {
    for (let j = i; j > 0; j -= 1) {
      const a = list[DRAW_ORDER[j - 1]];
      const b = list[DRAW_ORDER[j]];
      if ((a?.y || 0) <= (b?.y || 0)) break;
      DRAW_ORDER[j] = DRAW_ORDER[j - 1];
      DRAW_ORDER[j - 1] = j;
    }
  }

  for (let k = 0; k < n; k += 1) {
    const p = list[DRAW_ORDER[k]];
    if (!p || p.isJoined === false) continue;
    const r = p.radius || FALLBACK_R;
    const u = Math.max(0.55, r / FALLBACK_R);
    const fallRatio = clamp01(p.fall ?? (p.fallTimer || 0) / FALL_TIME);
    const falling = fallRatio > 0;
    if (p.out === true && !falling) continue;

    const charge = clamp01(p.charge ?? (p.chargeTimer || 0) / CHARGE_TIME);
    const team = sumoTeamColor(p.team || 0);
    const alpha = (p.invuln || 0) > 0 ? 0.55 + Math.sin(now * 0.02) * 0.12 : 1;

    // Kenar baskısı: halkanın kıyısına yaklaşan gövdenin halesi kalınlaşır.
    if (ring && !falling) {
      const dist = Math.hypot(p.x - ring.cx, p.y - ring.cy);
      const edge = clamp01((dist / ring.r - 0.6) / 0.4);
      if (edge > 0) {
        ctx.save();
        ctx.globalAlpha = 0.25 + edge * 0.45;
        ctx.strokeStyle = team;
        ctx.lineWidth = Math.max(2, (2 + edge * 4) * u);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 1.35, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    drawDioramaContactShadow(ctx, p.x, p.y + r * 0.42,
      r * (falling ? 1.2 - fallRatio * 0.4 : 1.1),
      r * (falling ? 0.5 - fallRatio * 0.18 : 0.46),
      { alpha: falling ? 0.18 : 0.34 });

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(1 - fallRatio * 0.55, 1 - fallRatio * 0.55);
    ctx.globalAlpha = alpha * (1 - fallRatio * 0.5);

    if (charge > 0) {
      const ax = Math.cos(p.angle || 0);
      const ay = Math.sin(p.angle || 0);
      ctx.save();
      ctx.globalAlpha = 0.45 * charge;
      ctx.strokeStyle = p.color || UI_COLORS.inkDark;
      ctx.lineWidth = Math.max(2, 3 * u);
      for (let i = 1; i <= 3; i += 1) {
        const back = r * (0.9 + i * 0.45);
        ctx.beginPath();
        ctx.moveTo(-ax * back, -ay * back);
        ctx.lineTo(-ax * (back + r * 0.35), -ay * (back + r * 0.35));
        ctx.stroke();
      }
      ctx.restore();
    }

    drawGameAvatar(ctx, 0, 0, r, p, {
      color: p.color || UI_COLORS.players[p.index ?? p.slot ?? 0],
      facingAngle: p.angle || 0,
      label: `P${(p.index ?? p.slot ?? 0) + 1}`,
      expression: falling ? 'panic' : (p.braced || charge > 0 ? 'angry' : 'normal'),
      showPointer: true,
      borderWidth: Math.max(2, 2.6 * u),
      now,
      alpha: fxReadAlpha({ isSelf: false, hasViewer: false }),
    });

    // TUT: gövdeyi saran kalın yay.
    if (p.braced) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = UI_COLORS.hudShield;
      ctx.lineWidth = Math.max(3, 4 * u);
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // Kavrama: bağlantı çizgisi + kavrananın kaçış ölçeri.
    const grabberIndex = Number.isInteger(p.grabbedBy) ? p.grabbedBy : -1;
    const grabber = grabberIndex >= 0 ? list[grabberIndex] : null;
    if (grabber && grabber.isJoined !== false) {
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = grabber.color || team;
      ctx.lineWidth = Math.max(2.5, 3.4 * u);
      ctx.beginPath();
      ctx.moveTo(grabber.x, grabber.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      const meter = clamp01(p.escape ?? p.grabMeter);
      if (meter > 0.02) {
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = UI_COLORS.white;
        ctx.lineWidth = Math.max(3, 4 * u);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 1.5, -Math.PI / 2, -Math.PI / 2 + meter * Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

export function drawSumoFxLayer(ctx, layer) {
  drawFxPops(ctx, layer?.pops);
  drawFxRings(ctx, layer?.rings);
  drawCircleParticles(ctx, layer?.particles);
}
