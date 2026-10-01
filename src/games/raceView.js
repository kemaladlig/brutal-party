// RACE world snapshot + client-safe drawing boundary.
// The phone never imports RaceGame/AI; it only validates and renders snapshots.

import { drawTabletopIcon } from '../core/tabletopIcons.js';
import { drawField, hashFieldSeed } from '../core/fieldKit.js';
import { UI_COLORS } from '../ui/tokens.js';
import {
  createWorldSnapshot,
  isValidWorldBase,
  round1,
  packFxState,
  isValidFxState,
  drawFxRings,
  drawFxPops,
  drawCircleParticles,
} from './worldCore.js';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const PLAYER_FALLBACK = UI_COLORS.players;
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
      radius: round1(player.radius || 34),
      jumpZ: round1(player.jumpZ || 0),
      nextCheckpoint: Math.max(0, Number(player.nextCheckpoint) || 0),
      laps: Math.max(0, Number(player.laps) || 0),
      dashing: player.isDashing === true,
      boosting: (Number(player.nitroBoostTimer) || 0) > 0,
      drafting: player.isDrafting === true,
      disrupted: (Number(player.empDisruptedTimer) || 0) > 0,
      nitro: Math.round(player.nitroEnergy ?? 100),
    }),
    extras: {
      track: TRACKS.includes(game.currentPreset) ? game.currentPreset : TRACKS[0],
      timeLeft: Math.max(0, Math.ceil(game.roundTimer || 0)),
      checkpoints: (Array.isArray(game.checkpoints) ? game.checkpoints : []).slice(0, 8).map((checkpoint) => ({
        id: Number(checkpoint.id) || 0,
        x: round1(checkpoint.x || 0),
        y: round1(checkpoint.y || 0),
        radius: round1(checkpoint.radius || 0),
        color: typeof checkpoint.color === 'string' ? checkpoint.color : UI_COLORS.gold,
        name: typeof checkpoint.name === 'string' ? checkpoint.name : '',
      })),
      oilSlicks: packPoints(game.oilSlicks),
      nitroPads: packPads(game.nitroPads),
      spinners: packSpinners(game.obstacleSpinners),
      empPulses: packEmpPulses(game.empPulses),
      // FX kanalı (MOTION_PLAN Faz 2c): host FX runtime'ının saf anlık görüntüsü.
      fx: packFxState(game.fx),
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
    && typeof player.disrupted === 'boolean'
    && (player.nitro === undefined || (finite(player.nitro) && player.nitro >= 0));
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
  // fx alanı v2 eklentisidir; eski host frames'i yoktur (opsiyonel, v1 uyumu).
  if (frame.fx !== undefined && !isValidFxState(frame.fx)) return false;
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

export function drawTrackBase(ctx, arena, opts = {}) {
  drawField(ctx, arena, { mode: 'RACE', seed: hashFieldSeed('RACE', opts.roundId) });
}

function drawRoundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.rect(x, y, w, h);
  }
}

function getTrackRoadWidth(arena) {
  return Math.max(76, Math.min(arena?.width || 400, arena?.height || 400) * 0.22);
}

function drawTrackPath(ctx, checkpoints, arena) {
  if (!Array.isArray(checkpoints) || checkpoints.length < 3) return;
  const u = arena?.unit || 1;
  const roadWidth = getTrackRoadWidth(arena);
  const n = checkpoints.length;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const traceTrack = () => {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const p0 = checkpoints[(i - 1 + n) % n];
      const p1 = checkpoints[i];
      const p2 = checkpoints[(i + 1) % n];
      const p3 = checkpoints[(i + 2) % n];

      // Catmull-Rom spline'dan yumuşak kübik bezier kontrol noktaları
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      if (i === 0) ctx.moveTo(p1.x, p1.y);
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
    ctx.closePath();
  };

  // 1. Yol tabanı yumuşak gölgesi (zeminden tatlı ayrışma)
  traceTrack();
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.strokeStyle = UI_COLORS.hudPlate;
  ctx.lineWidth = roadWidth + 14 * u;
  ctx.stroke();
  ctx.restore();

  // 2. Kırmızı ve Beyaz Yarış Bordürleri (Racing Kerbs)
  const kerbWidth = roadWidth + 8 * u;
  traceTrack();
  ctx.strokeStyle = UI_COLORS.danger;
  ctx.lineWidth = kerbWidth;
  ctx.setLineDash([14 * u, 14 * u]);
  ctx.stroke();

  traceTrack();
  ctx.strokeStyle = UI_COLORS.card;
  ctx.lineWidth = kerbWidth;
  ctx.lineDashOffset = 14 * u;
  ctx.setLineDash([14 * u, 14 * u]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;

  // 3. Ana Koyu Asfalt Yarış Yolu (Geniş ve sınırları belirgin)
  traceTrack();
  ctx.strokeStyle = UI_COLORS.hudPlate;
  ctx.lineWidth = roadWidth;
  ctx.stroke();

  // 4. İç Yarış Şeridi / Yol Dokusu
  traceTrack();
  ctx.strokeStyle = UI_COLORS.ink;
  ctx.lineWidth = Math.max(16, roadWidth - 8 * u);
  ctx.stroke();

  // 5. Pist Kenar Çizgileri
  traceTrack();
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = UI_COLORS.card;
  ctx.lineWidth = Math.max(1.5, 2 * u);
  ctx.stroke();
  ctx.restore();

  // 6. Orta Kesikli Yarış İzi (Racing Line)
  traceTrack();
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = UI_COLORS.gold;
  ctx.lineWidth = Math.max(1.8, 2.2 * u);
  ctx.setLineDash([12 * u, 10 * u]);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

function drawOilSlicks(ctx, oilSlicks) {
  for (const slick of oilSlicks || []) {
    const x = Array.isArray(slick) ? slick[0] : slick.x;
    const y = Array.isArray(slick) ? slick[1] : slick.y;
    const radius = Array.isArray(slick) ? slick[2] : slick.radius;
    const u = radius / 30;
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = UI_COLORS.hudPlate;
    ctx.beginPath(); ctx.arc(x, y, Math.max(1, radius), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = UI_COLORS.turbo; ctx.lineWidth = 2 * u; ctx.stroke();
    ctx.restore();
  }
}

function drawNitroPad(ctx, pad, now) {
  const x = Array.isArray(pad) ? pad[0] : pad.x;
  const y = Array.isArray(pad) ? pad[1] : pad.y;
  const width = Array.isArray(pad) ? pad[2] : pad.w;
  const height = Array.isArray(pad) ? pad[3] : pad.h;
  const angle = Array.isArray(pad) ? pad[4] : pad.angle;
  const pulse = 1 + Math.sin(now * 0.006) * 0.04;
  const u = Math.min(width, height) / 28;
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.scale(pulse, pulse);
  ctx.fillStyle = UI_COLORS.ink; ctx.fillRect(-width / 2 + 4 * u, -height / 2 + 4 * u, width, height);
  ctx.fillStyle = UI_COLORS.turbo; ctx.fillRect(-width / 2, -height / 2, width, height);
  ctx.strokeStyle = UI_COLORS.ink; ctx.lineWidth = 2.5 * u; ctx.strokeRect(-width / 2, -height / 2, width, height);
  drawTabletopIcon(ctx, 'zap', 0, 0, Math.min(width, height) * 0.62, { color: UI_COLORS.ink, strokeWidth: 2.4 * u });
  ctx.restore();
}

function drawSpinner(ctx, spinner) {
  const u = (spinner.length || 110) / 110;
  ctx.save(); ctx.translate(spinner.x, spinner.y); ctx.rotate(spinner.angle);
  ctx.fillStyle = UI_COLORS.ink; ctx.fillRect(-spinner.length / 2 + 3 * u, -5 * u, spinner.length, 16 * u);
  ctx.fillStyle = UI_COLORS.hudEmpty; ctx.fillRect(-spinner.length / 2, -8 * u, spinner.length, 16 * u);
  ctx.strokeStyle = UI_COLORS.ink; ctx.lineWidth = 2.5 * u; ctx.strokeRect(-spinner.length / 2, -8 * u, spinner.length, 16 * u);
  ctx.fillStyle = UI_COLORS.ink; ctx.beginPath(); ctx.arc(0, 0, 8 * u, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}

function drawCheckpoint(ctx, checkpoint, allCheckpoints = [], players = [], colors = [], now = 0, arena = null) {
  const u = arena?.unit || 1;
  const roadWidth = getTrackRoadWidth(arena);
  const halfW = roadWidth * 0.52;

  // Parkurun bu checkpoint'teki teğeti ve yola dik kapı açısı
  const checkpoints = Array.isArray(allCheckpoints) && allCheckpoints.length >= 3 ? allCheckpoints : [checkpoint];
  const index = checkpoints.findIndex((cp) => cp.id === checkpoint.id);
  const n = checkpoints.length;
  const prev = checkpoints[(index - 1 + n) % n];
  const next = checkpoints[(index + 1) % n];
  const trackAngle = Math.atan2(next.y - prev.y, next.x - prev.x);
  const gateAngle = trackAngle + Math.PI / 2;

  ctx.save();
  ctx.translate(checkpoint.x, checkpoint.y);
  ctx.rotate(gateAngle);

  const isFinish = (checkpoint.id === 0);
  const color = checkpoint.color || (isFinish ? UI_COLORS.gold : UI_COLORS.hudShield);

  // Aktif oyuncular ve hedef kontrolü
  const activePlayers = (players || []).filter((p) => (p.joined ?? p.isJoined) !== false && (p.alive ?? p.isAlive) !== false);
  const hasAnyTarget = activePlayers.some((p) => p.nextCheckpoint === checkpoint.id);

  // 1. Asfalt Üzeri Yarış Kapısı Çizgisi (-halfW to +halfW)
  if (isFinish) {
    // START / FINISH: Damalı Bayrak Deseni (Checkered Strip)
    const squareSize = 8 * u;
    const count = Math.ceil((halfW * 2) / squareSize);
    const startX = -halfW;
    for (let row = 0; row < 2; row++) {
      const y = (row - 1) * squareSize;
      for (let col = 0; col < count; col++) {
        const x = startX + col * squareSize;
        ctx.fillStyle = (row + col) % 2 === 0 ? UI_COLORS.card : UI_COLORS.hudPlate;
        ctx.fillRect(x, y, squareSize, squareSize);
      }
    }
    // Altın neon çerçeve
    ctx.strokeStyle = UI_COLORS.gold;
    ctx.lineWidth = 2 * u;
    ctx.strokeRect(-halfW, -squareSize, halfW * 2, squareSize * 2);
  } else {
    // Ara Checkpoint: Işıklı Lazer Çizgisi
    const pulse = 0.7 + Math.sin(now * 0.008 + checkpoint.id) * 0.3;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = (hasAnyTarget ? 5 : 3.5) * u;
    ctx.globalAlpha = hasAnyTarget ? pulse : 0.65;
    ctx.beginPath();
    ctx.moveTo(-halfW, 0);
    ctx.lineTo(halfW, 0);
    ctx.stroke();

    // Yol üzeri yönlendirici oklar (akış yönünde -y eksenine bakar)
    if (hasAnyTarget) {
      const chevCount = 3;
      const spacing = halfW / (chevCount + 1);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.75 * pulse;
      for (let c = -chevCount; c <= chevCount; c++) {
        if (c === 0) continue;
        const cx = c * spacing;
        ctx.beginPath();
        ctx.moveTo(cx, -6 * u);
        ctx.lineTo(cx - 5 * u, 2 * u);
        ctx.lineTo(cx - 5 * u, 5 * u);
        ctx.lineTo(cx, -1 * u);
        ctx.lineTo(cx + 5 * u, 5 * u);
        ctx.lineTo(cx + 5 * u, 2 * u);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // 2. Yol Kenarlarında Işıklı Pilonlar / Kuleler (-halfW ve +halfW)
  const beaconR = 6.5 * u;
  [-halfW, halfW].forEach((bx) => {
    ctx.fillStyle = UI_COLORS.hudPlate;
    ctx.fillRect(bx - 3.5 * u, -10 * u, 7 * u, 20 * u);
    ctx.strokeStyle = UI_COLORS.ink;
    ctx.lineWidth = 1.2 * u;
    ctx.strokeRect(bx - 3.5 * u, -10 * u, 7 * u, 20 * u);

    // Parlak neon kubbe
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(bx, 0, beaconR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = UI_COLORS.card;
    ctx.lineWidth = 1.4 * u;
    ctx.stroke();
  });

  // 3. Işıklı Rozet + Geçiş Durum Lambaları ("geçtiysen oranın ışığı yanar")
  const badgeW = 76 * u;
  const badgeH = 22 * u;
  ctx.save();
  ctx.globalAlpha = 0.94;
  ctx.fillStyle = UI_COLORS.hudPlate;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8 * u;
  ctx.beginPath();
  drawRoundRect(ctx, -badgeW / 2, -badgeH / 2, badgeW, badgeH, 4 * u);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Rozet başlığı
  const label = isFinish ? 'FINISH' : `CP ${checkpoint.id + 1}`;
  ctx.fillStyle = UI_COLORS.card;
  ctx.font = `900 ${Math.round(8.5 * u)}px "JetBrains Mono", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 0, -4 * u);

  // 4 Oyuncu LED lambası: o oyuncu geçtiyse ışığı parlak neon yanar!
  const ledCount = Math.max(2, activePlayers.length || 4);
  const ledSpacing = 12 * u;
  const ledStartX = -((ledCount - 1) * ledSpacing) / 2;
  const ledY = 5 * u;
  const ledR = 2.8 * u;

  for (let slot = 0; slot < ledCount; slot++) {
    const lx = ledStartX + slot * ledSpacing;
    const p = activePlayers.find((cand) => (cand.slot ?? cand.index ?? 0) === slot);
    const pColor = colors[slot] || PLAYER_FALLBACK[slot] || UI_COLORS.danger;

    const hasPassed = p ? (
      checkpoint.id === 0
        ? p.nextCheckpoint !== 0
        : (p.nextCheckpoint > checkpoint.id || p.nextCheckpoint === 0)
    ) : false;

    if (hasPassed) {
      // GEÇİLDİ: Parlak neon lamba yanar!
      ctx.save();
      ctx.fillStyle = pColor;
      ctx.shadowColor = pColor;
      ctx.shadowBlur = 8 * u;
      ctx.beginPath();
      ctx.arc(lx, ledY, ledR * 1.25, 0, Math.PI * 2);
      ctx.fill();

      // Beyaz sıcak çekirdek
      ctx.fillStyle = UI_COLORS.card;
      ctx.beginPath();
      ctx.arc(lx, ledY, ledR * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      // HENÜZ GEÇİLMEDİ: Sönük koyu yuva
      ctx.fillStyle = UI_COLORS.hudEmpty;
      ctx.beginPath();
      ctx.arc(lx, ledY, ledR, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.strokeStyle = p ? pColor : UI_COLORS.card;
      ctx.lineWidth = 1 * u;
      ctx.stroke();
      ctx.restore();
    }
  }

  ctx.restore();
}

function drawEmpPulses(ctx, pulses) {
  for (const pulse of pulses || []) {
    const u = Math.max(0.1, pulse.radius) / 130;
    ctx.save(); ctx.strokeStyle = UI_COLORS.hudShield; ctx.lineWidth = 4 * u;
    ctx.beginPath(); ctx.arc(pulse.x, pulse.y, Math.max(0.1, pulse.radius), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
}

function drawPlayer(ctx, player, color, checkpoints) {
  const r = Math.max(4, player.radius || 34);
  const u = r / 34;
  const jumpOffsetY = -(player.jumpZ || 0) * 0.8 * u;
  const shadowScale = Math.max(0.68, 1 - (player.jumpZ || 0) * 0.018);

  // 1. Zemin Araç Gölgesi (Araba silueti şeklinde)
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.scale(shadowScale, shadowScale);
  ctx.rotate(player.angle);
  ctx.save();
  ctx.globalAlpha = player.jumpZ > 1 ? 0.22 : 0.35;
  ctx.fillStyle = UI_COLORS.hudPlate;
  ctx.beginPath();
  drawRoundRect(ctx, -0.85 * r, -0.75 * r, 1.85 * r, 1.5 * r, 6 * u);
  ctx.fill();
  ctx.restore();
  ctx.restore();

  // Hava koridoru (drafting) çizgisi
  const isDrafting = player.drafting ?? player.isDrafting;
  if (isDrafting) {
    ctx.save();
    ctx.strokeStyle = UI_COLORS.hudShield;
    ctx.lineWidth = Math.max(1.8, 2.2 * u);
    ctx.beginPath();
    ctx.moveTo(player.x, player.y + jumpOffsetY);
    ctx.lineTo(player.x - Math.cos(player.angle) * 38 * u, player.y + jumpOffsetY - Math.sin(player.angle) * 38 * u);
    ctx.stroke();
    ctx.restore();
  }

  const jumpScale = 1 + Math.min(0.38, (player.jumpZ || 0) * 0.035);
  ctx.save();
  ctx.translate(player.x, player.y + jumpOffsetY);
  ctx.scale(jumpScale, jumpScale);
  ctx.rotate(player.angle);

  const isDashing = player.dashing ?? player.isDashing;
  const isBoosting = player.boosting ?? ((player.nitroBoostTimer || 0) > 0);

  // 2. Nitro / Dash Çift Egzoz Roket Alevi
  if (isDashing || isBoosting) {
    const flicker = 0.85 + Math.sin(performance.now() * 0.04) * 0.25;
    const flameLen = (isDashing ? 1.6 : 1.3) * r * flicker;

    [-0.28 * r, 0.28 * r].forEach((fy) => {
      // Dış altın alev
      ctx.fillStyle = UI_COLORS.gold;
      ctx.beginPath();
      ctx.moveTo(-0.85 * r, fy - 0.22 * r);
      ctx.lineTo(-0.85 * r - flameLen, fy);
      ctx.lineTo(-0.85 * r, fy + 0.22 * r);
      ctx.closePath();
      ctx.fill();

      // İç sıcak turkuaz/beyaz çekirdek
      ctx.fillStyle = UI_COLORS.hudShieldDot;
      ctx.beginPath();
      ctx.moveTo(-0.85 * r, fy - 0.11 * r);
      ctx.lineTo(-0.85 * r - flameLen * 0.65, fy);
      ctx.lineTo(-0.85 * r, fy + 0.11 * r);
      ctx.closePath();
      ctx.fill();
    });
  }

  // EMP bozulma halkası
  const isDisrupted = player.disrupted ?? ((player.empDisruptedTimer || 0) > 0);
  if (isDisrupted) {
    ctx.strokeStyle = UI_COLORS.hudShield;
    ctx.lineWidth = Math.max(2, 3 * u);
    ctx.beginPath();
    ctx.arc(0, 0, 1.2 * r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 3. 4 Tok Lastik (Chunky Black Racing Tires)
  const drawTire = (tx, ty, tw, th) => {
    ctx.fillStyle = UI_COLORS.hudPlate;
    ctx.beginPath();
    drawRoundRect(ctx, tx, ty, tw, th, 3 * u);
    ctx.fill();
    ctx.strokeStyle = UI_COLORS.ink;
    ctx.lineWidth = 1.2 * u;
    ctx.stroke();
    // Metal jant
    ctx.fillStyle = UI_COLORS.hudEmpty;
    ctx.fillRect(tx + tw * 0.25, ty + th * 0.3, tw * 0.5, th * 0.4);
  };
  // Ön lastikler
  drawTire(0.3 * r, -0.92 * r, 0.54 * r, 0.28 * r);
  drawTire(0.3 * r, 0.64 * r, 0.54 * r, 0.28 * r);
  // Arka lastikler (daha geniş, tutuş sağlayan)
  drawTire(-0.8 * r, -0.96 * r, 0.6 * r, 0.34 * r);
  drawTire(-0.8 * r, 0.62 * r, 0.6 * r, 0.34 * r);

  // 4. Arka Rüzgarlık Kanat Ayakları ve Bıçağı (Spoiler Wing)
  ctx.strokeStyle = UI_COLORS.hudPlate;
  ctx.lineWidth = 2.5 * u;
  ctx.beginPath();
  ctx.moveTo(-0.55 * r, -0.32 * r);
  ctx.lineTo(-0.88 * r, -0.36 * r);
  ctx.moveTo(-0.55 * r, 0.32 * r);
  ctx.lineTo(-0.88 * r, 0.36 * r);
  ctx.stroke();

  // Rüzgarlık kanat bıçağı
  ctx.fillStyle = color;
  ctx.beginPath();
  drawRoundRect(ctx, -0.95 * r, -0.84 * r, 0.2 * r, 1.68 * r, 3 * u);
  ctx.fill();
  ctx.strokeStyle = UI_COLORS.ink;
  ctx.lineWidth = 1.8 * u;
  ctx.stroke();

  // 5. Ana Yarış Arabası Kaportası (Aerodinamik Yarış Şasisi)
  ctx.fillStyle = color;
  ctx.beginPath();
  // Ön burun kanadı
  ctx.moveTo(1.12 * r, 0);
  // Sağ ön çamurluk
  ctx.quadraticCurveTo(1.02 * r, 0.45 * r, 0.68 * r, 0.56 * r);
  // Sağ hava girişi (sidepod)
  ctx.lineTo(0.12 * r, 0.54 * r);
  ctx.lineTo(-0.18 * r, 0.66 * r);
  // Sağ arka tekerlek üstü kalça
  ctx.lineTo(-0.62 * r, 0.68 * r);
  // Arka tampon ve difüzör
  ctx.lineTo(-0.8 * r, 0.38 * r);
  ctx.lineTo(-0.76 * r, 0);
  ctx.lineTo(-0.8 * r, -0.38 * r);
  // Sol arka tekerlek üstü
  ctx.lineTo(-0.62 * r, -0.68 * r);
  ctx.lineTo(-0.18 * r, -0.66 * r);
  // Sol hava girişi
  ctx.lineTo(0.12 * r, -0.54 * r);
  // Sol ön çamurluk ve buruna dönüş
  ctx.quadraticCurveTo(1.02 * r, -0.45 * r, 1.12 * r, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = UI_COLORS.ink;
  ctx.lineWidth = Math.max(1.8, 2.5 * u);
  ctx.stroke();

  // 6. Yarış Şeridi (Merkezi açık şerit)
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = UI_COLORS.card;
  ctx.fillRect(-0.65 * r, -0.12 * r, 1.65 * r, 0.24 * r);
  ctx.restore();

  // 7. Kokpit & Koyu Ön Cam
  ctx.fillStyle = UI_COLORS.hudPlate;
  ctx.beginPath();
  ctx.ellipse(0.08 * r, 0, 0.42 * r, 0.28 * r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = UI_COLORS.ink;
  ctx.lineWidth = 1.5 * u;
  ctx.stroke();

  // Ön cam yansıma pırıltısı
  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = UI_COLORS.card;
  ctx.beginPath();
  ctx.ellipse(0.18 * r, -0.09 * r, 0.18 * r, 0.08 * r, -Math.PI / 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Pilot Kaskı
  ctx.fillStyle = UI_COLORS.card;
  ctx.beginPath();
  ctx.arc(-0.02 * r, 0, 0.18 * r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = UI_COLORS.ink;
  ctx.lineWidth = 1.2 * u;
  ctx.stroke();
  // Kask vizörü
  ctx.fillStyle = UI_COLORS.hudPlate;
  ctx.fillRect(0.02 * r, -0.11 * r, 0.08 * r, 0.22 * r);

  // 8. Ön Xenon Farlar ve Arka Stop Lambaları
  ctx.fillStyle = UI_COLORS.paperWarm;
  ctx.fillRect(0.85 * r, -0.42 * r, 0.14 * r, 0.12 * r);
  ctx.fillRect(0.85 * r, 0.3 * r, 0.14 * r, 0.12 * r);
  ctx.fillStyle = UI_COLORS.danger;
  ctx.fillRect(-0.76 * r, -0.38 * r, 0.08 * r, 0.14 * r);
  ctx.fillRect(-0.76 * r, 0.24 * r, 0.08 * r, 0.14 * r);

  ctx.restore();

  // Hedef Checkpoint Yön Oku
  const target = checkpoints?.[player.nextCheckpoint];
  if (target) {
    const arrowAngle = Math.atan2(target.y - player.y, target.x - player.x);
    const arrowDist = 1.55 * r;
    ctx.save();
    ctx.translate(player.x + Math.cos(arrowAngle) * arrowDist, player.y + Math.sin(arrowAngle) * arrowDist + jumpOffsetY);
    ctx.rotate(arrowAngle);
    ctx.fillStyle = target.color || UI_COLORS.gold;
    ctx.beginPath();
    ctx.moveTo(7 * u, 0);
    ctx.lineTo(-5 * u, -5 * u);
    ctx.lineTo(-5 * u, 5 * u);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = UI_COLORS.ink;
    ctx.lineWidth = 1.2 * u;
    ctx.stroke();
    ctx.restore();
  }

  // Koltuk pip noktaları (P1=1, P2=2 ...)
  const slot = player.slot ?? player.index ?? 0;
  const pipCount = slot + 1;
  const pipSpacing = Math.max(3.5, 5 * u);
  const startX = player.x - ((pipCount - 1) * pipSpacing) / 2;
  for (let index = 0; index < pipCount; index += 1) {
    ctx.beginPath();
    ctx.arc(startX + index * pipSpacing, player.y + jumpOffsetY, Math.max(1.5, 2.2 * u), 0, Math.PI * 2);
    ctx.fillStyle = UI_COLORS.card;
    ctx.fill();
    ctx.strokeStyle = UI_COLORS.ink;
    ctx.lineWidth = Math.max(0.8, 1 * u);
    ctx.stroke();
  }

  // Mini Nitro Bar (Enerji azaldığında aracın hemen altında zarifçe belirir)
  const nitroEnergy = player.nitro ?? player.nitroEnergy ?? 100;
  if (nitroEnergy < 98) {
    const barW = 28 * u;
    const barH = 3.5 * u;
    const barX = player.x - barW / 2;
    const barY = player.y + 1.25 * r + jumpOffsetY;

    ctx.save();
    ctx.fillStyle = UI_COLORS.hudPlate;
    ctx.beginPath();
    drawRoundRect(ctx, barX - 1 * u, barY - 1 * u, barW + 2 * u, barH + 2 * u, 2 * u);
    ctx.fill();

    const fillW = Math.max(0, (nitroEnergy / 100) * barW);
    ctx.fillStyle = nitroEnergy < 20 ? UI_COLORS.danger : UI_COLORS.gold;
    ctx.beginPath();
    drawRoundRect(ctx, barX, barY, fillW, barH, 1.5 * u);
    ctx.fill();
    ctx.restore();
  }
}

export function drawRaceWorld(ctx, frame, arena, colors = [], now = performance.now(), opts = {}) {
  drawTrackBase(ctx, arena, opts);
  drawTrackPath(ctx, frame.checkpoints, arena);
  drawEmpPulses(ctx, frame.empPulses);
  drawOilSlicks(ctx, frame.oilSlicks);
  for (const pad of frame.nitroPads || []) drawNitroPad(ctx, pad, now);
  const spinners = frame.spinners || frame.obstacleSpinners || [];
  for (const spinner of spinners) drawSpinner(ctx, spinner);
  for (const checkpoint of frame.checkpoints || []) {
    drawCheckpoint(ctx, checkpoint, frame.checkpoints, frame.players, colors, now, arena);
  }
  for (const player of frame.players || []) {
    const isJoined = player.joined ?? player.isJoined;
    const isAlive = player.alive ?? player.isAlive;
    const slot = player.slot ?? player.index ?? 0;
    if (isJoined && isAlive) drawPlayer(ctx, player, colors[slot] || PLAYER_FALLBACK[slot] || PLAYER_FALLBACK[0], frame.checkpoints);
  }
}

/**
 * FX katmanının tek çizim sırası: pop → ring → partikül. Host motoru ve
 * client worldView AYNI fonksiyonu çağırır (host↔client aynı görünüm ilkesi).
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ pops?: any[], rings?: any[], particles?: any[] }} layer
 */
export function drawRaceFxLayer(ctx, layer) {
  drawFxPops(ctx, layer?.pops);
  drawFxRings(ctx, layer?.rings);
  drawCircleParticles(ctx, layer?.particles);
}
