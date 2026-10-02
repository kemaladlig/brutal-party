// CROWN world snapshot + client-safe drawing boundary.

import { UI_COLORS, CROWN_COLORS } from '../ui/tokens.js';
import { drawField, hashFieldSeed, drawField25d, drawFieldRail, fieldRailBaseY } from '../core/fieldKit.js';
import {
  createWorldSnapshot, isValidWorldBase, round1, CROWN_PLAYER_RADIUS,
  packFxState, isValidFxState, drawFxRings, drawFxPops, drawCircleParticles,
} from './worldCore.js';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const PLAYER_FALLBACK = CROWN_COLORS;

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

const EMPTY_ARR = Object.freeze([]);

function getBakedPillars(game) {
  if (game._bakedPillars && game._bakedPillarsMapKey === game.selectedMapIndex) {
    return game._bakedPillars;
  }
  game._bakedPillars = packRects(game.pillars);
  game._bakedPillarsMapKey = game.selectedMapIndex;
  return game._bakedPillars;
}

function getBakedConveyors(game) {
  if (game._bakedConveyors && game._bakedConveyorsMapKey === game.selectedMapIndex) {
    return game._bakedConveyors;
  }
  game._bakedConveyors = packRects(game.conveyors);
  game._bakedConveyorsMapKey = game.selectedMapIndex;
  return game._bakedConveyors;
}

function getBakedSpeedPads(game) {
  if (game._bakedSpeedPads && game._bakedSpeedPadsMapKey === game.selectedMapIndex) {
    return game._bakedSpeedPads;
  }
  game._bakedSpeedPads = packRects(game.speedPads);
  game._bakedSpeedPadsMapKey = game.selectedMapIndex;
  return game._bakedSpeedPads;
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
      radius: round1(player.radius || CROWN_PLAYER_RADIUS),
      hasCrown: player.hasCrown === true,
      crownHoldTime: round1(player.crownHoldTime || 0),
      turbo: (Number(player.turboTimer) || 0) > 0,
      slip: (Number(player.slipTimer) || 0) > 0,
    }),
    extras: {
      selfPredict: true,
      timeLeft: Math.max(0, Math.ceil(game.roundTimer || 0)),
      crown: {
        x: round1(game.crown?.x || 0),
        y: round1(game.crown?.y || 0),
        radius: round1(game.crown?.radius || 20),
        carrier: Number.isInteger(game.crown?.carrierIndex) ? game.crown.carrierIndex : null,
      },
      pillars: getBakedPillars(game),
      conveyors: getBakedConveyors(game),
      bumpers: packCircles(game.bumpers),
      hazards: packMovingHazards(game.movingHazards),
      bananas: (game.bananaPeels?.length ? packCircles(game.bananaPeels) : EMPTY_ARR),
      ink: (game.inkPuddles?.length ? packCircles(game.inkPuddles) : EMPTY_ARR),
      speedPads: getBakedSpeedPads(game),
      pickups: (game.pickups?.length ? packPickups(game.pickups) : EMPTY_ARR),
      // FX kanalı (MOTION_PLAN Faz 2b): host FX runtime'ının saf anlık görüntüsü
      // (tanks deseni). Playback canlıyken paket yükü yok sayılır (yedek kanal).
      fx: packFxState(game.fx),
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
      // fx alanı v2 eklentisidir; eski host frames'i yoktur (opsiyonel, v1 uyumu).
      && (candidate.fx === undefined || isValidFxState(candidate.fx))
    ),
  });
}

import { drawTabletopIcon } from '../core/tabletopIcons.js';
import { drawGameAvatar, drawGameAvatar25d } from '../core/avatarInGame.js';
import { fxReadAlpha } from '../core/fxKit.js';
import {
  drawPickup,
  drawObstacle25dShadow,
  drawObstacle25dMass,
  sceneDraw,
  obstacleBaseY,
  entitySceneY,
} from '../core/arenaKit.js';
import { materialFromColor } from '../core/projection2d.js';
import { groundRect, queuePlayers } from '../core/sceneKit.js';
import { renderEntityHUD } from '../ui/hud.js';
import { getUiScale } from '../ui/tokens.js';

const getRect = (r) => (Array.isArray(r) ? { x: r[0], y: r[1], w: r[2], h: r[3] } : r);
const getCircle = (c) => (Array.isArray(c) ? { x: c[0], y: c[1], radius: c[2], pulse: c[3] || 0 } : c);

// CROWN 2.5D teması: haritalar yalnız engel düzeni paylaşır (SNAKE gibi), zemin
// ortaktır → tek sabit tema (host ve ONLINE client AYNI sabiti kullanır; paket
// alanı gerekmez, derleme-zamanı değeridir).
export const CROWN_THEME_25D = 'marble';
// Kenar tamponlarının taban-y sırası: kuzey/batı arkaya, güney/doğu öne.
const RAIL_SIDES = /** @type {const} */ (['north', 'west', 'east', 'south']);

export function drawCrownArena(ctx, arena, opts = {}) {
  const proj = opts.proj || null;
  if (proj) {
    // 2.5D eğik saha: masa zemini `drawField25d` içinde boyanır; kenar
    // tamponları derinlik kuyruğuna girer (çağıran zarf penceresi açar).
    drawField25d(ctx, proj, arena);
    for (const side of RAIL_SIDES) {
      sceneDraw(ctx, fieldRailBaseY(arena, side), drawFieldRail, proj, { arena, side });
    }
    return;
  }
  drawField(ctx, arena, { mode: 'CROWN', seed: hashFieldSeed('CROWN', opts.roundId) });
}

export function drawSpeedPad(ctx, spRaw, arena, proj = null) {
  const sp = getRect(spRaw);
  const u = arena?.unit || 1;
  if (proj) {
    // 2.5D: zemine projekte alan + ekran-okunur şerit oku.
    groundRect(ctx, proj, sp, {
      fill: UI_COLORS.crownHazard, stroke: UI_COLORS.crownGold, lineWidth: Math.max(1, 2.5 * u),
    });
    const c = proj.proj(sp.x + sp.w / 2, sp.y + sp.h / 2, 0);
    const k = proj.view.scale * c.d;
    const chevron = (sp.dirX ?? 1) > 0 ? '▶▶' : (sp.dirX < 0 ? '◀◀' : ((sp.dirY ?? 0) > 0 ? '▼▼' : '▲▲'));
    ctx.save();
    ctx.fillStyle = UI_COLORS.crownSpark;
    ctx.font = `900 ${Math.max(9, Math.round(13 * k))}px "Space Grotesk", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(chevron, c.x, c.y);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.fillStyle = UI_COLORS.inkDark;
  ctx.fillRect(sp.x + 3, sp.y + 3, sp.w, sp.h);

  ctx.fillStyle = UI_COLORS.crownHazard;
  ctx.fillRect(sp.x, sp.y, sp.w, sp.h);
  ctx.strokeStyle = UI_COLORS.crownGold;
  ctx.lineWidth = Math.max(1, 2.5 * u);
  ctx.strokeRect(sp.x, sp.y, sp.w, sp.h);

  ctx.fillStyle = UI_COLORS.crownSpark;
  ctx.font = '900 13px "Space Grotesk", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const chevron = (sp.dirX ?? 1) > 0 ? '▶▶' : (sp.dirX < 0 ? '◀◀' : ((sp.dirY ?? 0) > 0 ? '▼▼' : '▲▲'));
  ctx.fillText(chevron, sp.x + sp.w / 2, sp.y + sp.h / 2);
  ctx.restore();
}

export function drawConveyor(ctx, cRaw, arena, proj = null) {
  const c = getRect(cRaw);
  const u = arena?.unit || 1;
  if (proj) {
    // 2.5D: zemine projekte bant + projekte kayan oklar.
    groundRect(ctx, proj, c, {
      fill: UI_COLORS.crownHazard, stroke: UI_COLORS.inkDark, lineWidth: Math.max(1, 2.5 * u),
    });
    const ctr = proj.proj(c.x + c.w / 2, c.y + c.h / 2, 0);
    const k = proj.view.scale * ctr.d;
    const spacing = 42;
    const dirX = c.dirX ?? 1;
    const dirY = c.dirY ?? 0;
    const arrowChar = dirX > 0 ? '▶' : (dirX < 0 ? '◀' : (dirY > 0 ? '▼' : '▲'));
    ctx.save();
    ctx.fillStyle = UI_COLORS.crownGold;
    ctx.font = `900 ${Math.max(9, Math.round(13 * k))}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (dirX !== 0) {
      const offset = ((c.animOffset || 0) * (dirX > 0 ? 1 : -1)) % spacing;
      for (let x = c.x + offset - spacing; x < c.x + c.w + spacing; x += spacing) {
        const p = proj.proj(x, c.y + c.h / 2, 0);
        ctx.fillText(arrowChar, p.x, p.y);
      }
    } else {
      const offset = ((c.animOffset || 0) * (dirY > 0 ? 1 : -1)) % spacing;
      for (let y = c.y + offset - spacing; y < c.y + c.h + spacing; y += spacing) {
        const p = proj.proj(c.x + c.w / 2, y, 0);
        ctx.fillText(arrowChar, p.x, p.y);
      }
    }
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.fillStyle = UI_COLORS.inkDark;
  ctx.fillRect(c.x + 3, c.y + 3, c.w, c.h);

  ctx.fillStyle = UI_COLORS.crownHazard;
  ctx.fillRect(c.x, c.y, c.w, c.h);
  ctx.strokeStyle = UI_COLORS.inkDark;
  ctx.lineWidth = Math.max(1, 2.5 * u);
  ctx.strokeRect(c.x, c.y, c.w, c.h);

  ctx.save();
  ctx.beginPath();
  ctx.rect(c.x, c.y, c.w, c.h);
  ctx.clip();

  ctx.fillStyle = UI_COLORS.crownGold;
  ctx.font = '900 13px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const spacing = 42;
  const dirX = c.dirX ?? 1;
  const dirY = c.dirY ?? 0;
  const arrowChar = dirX > 0 ? '▶' : (dirX < 0 ? '◀' : (dirY > 0 ? '▼' : '▲'));
  if (dirX !== 0) {
    const offset = ((c.animOffset || 0) * (dirX > 0 ? 1 : -1)) % spacing;
    const startX = c.x + offset - spacing;
    for (let x = startX; x < c.x + c.w + spacing; x += spacing) {
      ctx.fillText(arrowChar, x, c.y + c.h / 2);
    }
  } else {
    const offset = ((c.animOffset || 0) * (dirY > 0 ? 1 : -1)) % spacing;
    const startY = c.y + offset - spacing;
    for (let y = startY; y < c.y + c.h + spacing; y += spacing) {
      ctx.fillText(arrowChar, c.x + c.w / 2, y);
    }
  }
  ctx.restore();
  ctx.restore();
}

export function drawMovingHazardTrack(ctx, h, arena, proj = null) {
  if (!h || h.minPos === undefined || h.maxPos === undefined) return;
  const u = arena?.unit || 1;
  if (proj) {
    const a = h.axis === 'x' ? proj.proj(h.minPos, h.y, 0) : proj.proj(h.x, h.minPos, 0);
    const b = h.axis === 'x' ? proj.proj(h.maxPos, h.y, 0) : proj.proj(h.x, h.maxPos, 0);
    ctx.save();
    ctx.strokeStyle = UI_COLORS.crownPillarBorder;
    ctx.lineWidth = Math.max(1, 6 * u);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = UI_COLORS.crownPillarEdge;
    ctx.lineWidth = Math.max(1, 2 * u);
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.strokeStyle = UI_COLORS.crownPillarBorder;
  ctx.lineWidth = Math.max(1, 6 * u);
  ctx.beginPath();
  if (h.axis === 'x') {
    ctx.moveTo(h.minPos, h.y);
    ctx.lineTo(h.maxPos, h.y);
  } else {
    ctx.moveTo(h.x, h.minPos);
    ctx.lineTo(h.x, h.maxPos);
  }
  ctx.stroke();

  ctx.strokeStyle = UI_COLORS.crownPillarEdge;
  ctx.lineWidth = Math.max(1, 2 * u);
  ctx.setLineDash([6, 6]);
  ctx.stroke();
  ctx.restore();
}

export function drawPillar(ctx, pilRaw, arena) {
  const pil = getRect(pilRaw);
  const u = arena?.unit || 1;
  ctx.save();
  ctx.fillStyle = 'rgba(47, 106, 79, 0.16)';
  ctx.fillRect(pil.x - 8, pil.y - 8, pil.w + 16, pil.h + 16);

  ctx.fillStyle = UI_COLORS.inkDark;
  ctx.fillRect(pil.x + 5, pil.y + 5, pil.w, pil.h);

  ctx.fillStyle = UI_COLORS.crownStone;
  ctx.fillRect(pil.x, pil.y, pil.w, pil.h);

  ctx.strokeStyle = UI_COLORS.inkDark;
  ctx.lineWidth = Math.max(1, 3 * u);
  ctx.strokeRect(pil.x, pil.y, pil.w, pil.h);

  ctx.strokeStyle = UI_COLORS.crownConveyorLine;
  ctx.lineWidth = Math.max(1, 1.5 * u);
  ctx.beginPath();
  ctx.moveTo(pil.x + 2, pil.y + pil.h - 2);
  ctx.lineTo(pil.x + 2, pil.y + 2);
  ctx.lineTo(pil.x + pil.w - 2, pil.y + 2);
  ctx.stroke();

  ctx.strokeStyle = UI_COLORS.crownConveyorArrow;
  ctx.lineWidth = Math.max(1, 1.5 * u);
  ctx.beginPath();
  ctx.moveTo(pil.x + 4, pil.y + 4);
  ctx.lineTo(pil.x + pil.w - 4, pil.y + pil.h - 4);
  ctx.moveTo(pil.x + pil.w - 4, pil.y + 4);
  ctx.lineTo(pil.x + 4, pil.y + pil.h - 4);
  ctx.stroke();

  ctx.fillStyle = UI_COLORS.crownGold;
  ctx.beginPath();
  ctx.arc(pil.x + pil.w / 2, pil.y + pil.h / 2, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawBumper(ctx, bRaw, arena) {
  const b = getCircle(bRaw);
  const r = b.radius;
  const u = arena?.unit || 1;
  ctx.save();

  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.beginPath();
  ctx.arc(b.x + 3, b.y + 4, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = (b.pulse > 0.1) ? UI_COLORS.white : UI_COLORS.crownRed;
  ctx.beginPath();
  ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = UI_COLORS.inkDark;
  ctx.lineWidth = Math.max(1, 3 * u);
  ctx.stroke();

  ctx.fillStyle = (b.pulse > 0.1) ? UI_COLORS.crownSpark : UI_COLORS.crownAmber;
  ctx.beginPath();
  ctx.arc(b.x, b.y, r * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = UI_COLORS.inkDark;
  ctx.lineWidth = Math.max(1, 2 * u);
  ctx.stroke();

  ctx.fillStyle = UI_COLORS.inkDark;
  ctx.font = '900 13px "Space Grotesk", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('★', b.x, b.y);

  if (b.pulse > 0.1) {
    ctx.strokeStyle = `rgba(255, 222, 89, ${b.pulse})`;
    ctx.lineWidth = 3 * b.pulse;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r + (1 - b.pulse) * 16, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawMovingHazard(ctx, h, arena) {
  const r = h.radius;
  const u = arena?.unit || 1;
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.arc(h.x + 4, h.y + 4, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = (h.pulse > 0.1) ? UI_COLORS.white : UI_COLORS.crownGold;
  ctx.beginPath();
  ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = UI_COLORS.inkDark;
  ctx.lineWidth = Math.max(1, 3.5 * u);
  ctx.stroke();

  ctx.fillStyle = UI_COLORS.inkDark;
  ctx.beginPath();
  ctx.arc(h.x, h.y, r * 0.58, 0, Math.PI * 2);
  ctx.fill();

  drawTabletopIcon(ctx, 'zap', h.x, h.y, 13, { color: UI_COLORS.crownSpark });
  ctx.restore();
}

export function drawBananaPeel(ctx, bRaw, proj = null) {
  const b = getCircle(bRaw);
  if (proj) {
    // 2.5D: zemine gölge + hafif yüzen ikon (projekte).
    proj.groundEllipse(ctx, b.x, b.y, 18, UI_COLORS.inkDark, 0.32);
    const p = proj.proj(b.x, b.y, 12);
    const k = proj.view.scale * p.d;
    drawTabletopIcon(ctx, 'banana', p.x, p.y, Math.max(16, 30 * k), { color: UI_COLORS.crownSpark });
    return;
  }
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.beginPath();
  ctx.ellipse(b.x + 2, b.y + 4, 14, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  drawTabletopIcon(ctx, 'banana', b.x, b.y, 22, { color: UI_COLORS.crownSpark });
  ctx.restore();
}

export function drawInkPuddle(ctx, inkRaw, proj = null) {
  const ink = getCircle(inkRaw);
  if (proj) {
    // 2.5D: mürekkep zemine yayılır — projekte elipsler.
    proj.groundEllipse(ctx, ink.x, ink.y, ink.radius, UI_COLORS.inkDark, 1);
    proj.groundEllipse(ctx, ink.x - 6, ink.y - 4, ink.radius * 0.4, UI_COLORS.crownStoneDarker, 1);
    return;
  }
  ctx.save();
  ctx.fillStyle = UI_COLORS.inkDark;
  ctx.beginPath();
  ctx.arc(ink.x, ink.y, ink.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = UI_COLORS.crownStoneDarker;
  ctx.beginPath();
  ctx.arc(ink.x - 6, ink.y - 4, ink.radius * 0.4, 0, Math.PI * 2);
  ctx.arc(ink.x + 8, ink.y + 5, ink.radius * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawCrown(ctx, x, y, scale = 1.0, isLoose = false, arena = null, floatAnim = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  const u = arena?.unit || 1;
  if (isLoose) {
    const pulseR = 26 + Math.sin(floatAnim) * 4;
    ctx.strokeStyle = 'rgba(217, 155, 38, 0.45)';
    ctx.lineWidth = Math.max(1, 2.5 * u);
    ctx.beginPath();
    ctx.arc(0, 0, pulseR, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, 10, 16, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = UI_COLORS.crownAmber;
  ctx.strokeStyle = UI_COLORS.inkDark;
  ctx.lineWidth = Math.max(1, 2.5 * u);

  ctx.beginPath();
  ctx.moveTo(-16, 6);
  ctx.lineTo(-18, -8);
  ctx.lineTo(-8, -2);
  ctx.lineTo(0, -14);
  ctx.lineTo(8, -2);
  ctx.lineTo(18, -8);
  ctx.lineTo(16, 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = UI_COLORS.crownSpark;
  ctx.beginPath();
  ctx.rect(-15, 2, 30, 4);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = UI_COLORS.crownRed;
  ctx.beginPath();
  ctx.arc(0, -7, 3.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = UI_COLORS.crownForest;
  ctx.beginPath();
  ctx.arc(-11, -3, 2.5, 0, Math.PI * 2);
  ctx.arc(11, -3, 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

export function drawCrownPlayer(ctx, p, color, arena, lastTime, targetCrownTime = 15.0, selfSlot = -1) {
  ctx.save();
  const { x, y, radius: r } = p;
  const facingAngle = p.facingAngle ?? 0;
  const u = arena?.unit || 1;

  if (p.slipTimer > 0) {
    ctx.translate(x, y);
    ctx.rotate(p.slipAngle || 0);
    ctx.translate(-x, -y);
  }

  if (p.stumbleTimer > 0) {
    ctx.save();
    const dazeAngle = (lastTime || performance.now()) * 0.008;
    const starR = r + 14;
    for (let s = 0; s < 3; s++) {
      const a = dazeAngle + (s * Math.PI * 2) / 3;
      const sx = x + Math.cos(a) * starR;
      const sy = y + Math.sin(a) * (starR * 0.4) - r - 10;
      drawTabletopIcon(ctx, 'sparkles', sx, sy, 14, { color: UI_COLORS.hudAmber });
    }

    ctx.strokeStyle = UI_COLORS.hudAmber;
    ctx.lineWidth = Math.max(1.5, 3.5 * u);
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(x, y, r + 7, 0, Math.PI * 2);
    ctx.stroke();

    // "SERSEM!" altın dolgu kontursuz 2.16:1 idi — koyu kontur + koyu altın.
    // (`bombView.js` zaten bu deseni kullanıyordu; iki oyun aynı dili konuşur.)
    // Font ve kontur `u` ile ölçeklenir: sabit 13 px / 3 px telefonda okunmaz
    // kalıyordu (I6). En az 1 px taban, ince ekranda çizgi kaybolmasın.
    const textU = Math.max(1, u);
    ctx.font = `900 ${Math.max(9, 13 * textU)}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = UI_COLORS.hudInkOutline;
    ctx.lineWidth = 3 * textU;
    ctx.strokeText('SERSEM!', x + 10, y - r - 26);
    ctx.fillStyle = UI_COLORS.hudAmber;
    ctx.fillText('SERSEM!', x + 10, y - r - 26);
    drawTabletopIcon(ctx, 'flame', x - 28, y - r - 26, 13, { color: UI_COLORS.hudAmber });
    ctx.restore();
  }

  if (p.hasCrown) {
    ctx.fillStyle = 'rgba(217, 155, 38, 0.2)';
    ctx.beginPath();
    ctx.arc(x, y, r * 1.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = UI_COLORS.hudAmber;
    ctx.lineWidth = Math.max(1.5, 3 * u);
    ctx.stroke();
  }

  let currentExp = 'normal';
  if (p.stumbleTimer > 0) currentExp = 'dizzy';
  else if (p.isTackling) currentExp = 'angry';
  else if (p.hasCrown) currentExp = 'excited';

  drawGameAvatar(ctx, x, y, r, p, {
    facingAngle,
    expression: currentExp,
    // Tackle vurgusu BEYAZDI — krem zeminde 1.10:1, görünmez. Koyu altın 4.91:1.
    borderColor: p.isTackling ? UI_COLORS.hudAmber : (p.rimColor || UI_COLORS.inkDark),
    borderWidth: p.isTackling ? 4.5 : 3,
    now: lastTime || performance.now(),
    alpha: fxReadAlpha({ isSelf: selfSlot >= 0 && (p.slot ?? p.index) === selfSlot, hasViewer: selfSlot >= 0 }),
  });

  const isAlive = p.alive ?? p.isAlive ?? true;
  if (isAlive && (p.tackleCooldown !== undefined || p.stumbleTimer !== undefined)) {
    const cdRatio = (p.tackleCooldown || 0) > 0
      ? 1.0 - Math.max(0, Math.min(1, p.tackleCooldown / 2.0))
      : 1.0;
    renderEntityHUD(ctx, {
      x,
      y,
      radius: r,
      color: UI_COLORS.crownGold,
      arena,
      cooldownProgress: (p.tackleCooldown || 0) > 0 ? cdRatio : null,
      stun: (p.stumbleTimer || 0) > 0,
    });
  }

  if (p.hasCrown) {
    const holdTime = p.crownHoldTime || 0;
    const progress = Math.min(1.0, holdTime / targetCrownTime);
    const remain = Math.max(0, targetCrownTime - holdTime);
    const urgent = remain <= 5.0;

    // Taç tutma yayı: KAZANMA ilerlemesi, hazır göstergesi değil — geometri
    // kalır, renkler okunur koyuya çekilir (ray 2.45:1, altın yay 2.16:1).
    ctx.strokeStyle = UI_COLORS.hudDim;
    ctx.lineWidth = Math.max(1, 8 * u);
    ctx.beginPath();
    ctx.arc(x, y, r + 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = urgent ? UI_COLORS.crownRed : UI_COLORS.hudAmber;
    ctx.lineWidth = Math.max(1, 8 * u);
    ctx.beginPath();
    ctx.arc(x, y, r + 9, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    ctx.stroke();

    const bScale = Math.min(1.4, getUiScale(arena));
    const badgeW = Math.round(72 * bScale);
    const badgeH = Math.round(22 * bScale);
    const badgeY = y - r - Math.round(32 * bScale);
    ctx.fillStyle = urgent ? UI_COLORS.crownRed : UI_COLORS.crownGold;
    ctx.fillRect(x - badgeW / 2, badgeY, badgeW, badgeH);
    ctx.strokeStyle = UI_COLORS.inkDark;
    ctx.lineWidth = Math.max(2, Math.round(2 * bScale));
    ctx.strokeRect(x - badgeW / 2, badgeY, badgeW, badgeH);
    // Rozet metni BEYAZDI: altın dolgu üstünde 2.42:1 (`--on-accent` kuralı
    // ihlali). Koyu mürekkep altında 7.18, kırmızıda 4.85. Taç ikonu da
    // dolgusuyla AYNI renkti — yani görünmezdi; o da koyuya çekildi.
    ctx.fillStyle = UI_COLORS.inkDark;
    ctx.font = `900 ${Math.round(12 * bScale)}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${remain.toFixed(1)}s`, x + 10, badgeY + badgeH / 2);
    drawTabletopIcon(ctx, 'crown', x - 30, badgeY + badgeH / 2, 13, { color: UI_COLORS.inkDark });
  }

  ctx.restore();
}

/** 2.5D bumper: projekte silindir + yıldız ikonu (derinlik kuyruğu öğesi). */
function drawBumper25d(ctx, s) {
  const { b, proj } = s;
  const r = b.radius;
  proj.contactPatch(ctx, b.x, b.y, r * 1.1, r * 0.55, 0.3);
  proj.drawCylinder(ctx, b.x, b.y, r, r * 0.9, materialFromColor(b.pulse > 0.1 ? UI_COLORS.white : UI_COLORS.crownRed));
  const top = proj.proj(b.x, b.y, r * 0.9);
  const k = proj.view.scale * top.d;
  drawTabletopIcon(ctx, 'star', top.x, top.y, Math.max(10, r * 1.1 * k), { color: UI_COLORS.inkDark });
  if (b.pulse > 0.1) {
    proj.groundRing(ctx, b.x, b.y, r + (1 - b.pulse) * 16, UI_COLORS.crownSpark, Math.max(2, 3 * b.pulse));
  }
}

/** 2.5D hareketli tuzak: projekte silindir + zap ikonu. */
function drawMovingHazard25d(ctx, s) {
  const { h, proj } = s;
  const r = h.radius;
  proj.contactPatch(ctx, h.x, h.y, r * 1.1, r * 0.55, 0.35);
  proj.drawCylinder(ctx, h.x, h.y, r, r * 0.9, materialFromColor(h.pulse > 0.1 ? UI_COLORS.white : UI_COLORS.crownGold));
  const top = proj.proj(h.x, h.y, r * 0.9);
  const k = proj.view.scale * top.d;
  drawTabletopIcon(ctx, 'zap', top.x, top.y, Math.max(10, 13 * (1 + k * 0.2)), { color: UI_COLORS.crownSpark });
}

/** 2.5D serbest taç: zeminden yüzen, kamera ölçekli token (kuyruk öğesi). */
function drawCrownToken25d(ctx, s) {
  const { crown, proj, floatAnim, scale, arena } = s;
  const p = proj.proj(crown.x, crown.y, crown.radius || 20);
  const k = proj.view.scale * p.d;
  drawCrown(ctx, p.x, p.y, scale * k, true, arena, floatAnim);
}

/** 2.5D taç taşıyıcı rozeti — oyuncu öğesinin üstüne asılır (kuyruk içinde). */
function drawCarriedCrown25d(ctx, s) {
  const { p, proj, floatAnim, arena } = s;
  const cScale = 0.95 + Math.sin(floatAnim * 1.5) * 0.05;
  const cp = proj.proj(p.x, p.y, (p.radius || CROWN_PLAYER_RADIUS) * 2.2);
  const k = proj.view.scale * cp.d;
  drawCrown(ctx, cp.x, cp.y, cScale * k, false, arena, floatAnim);
}

/** Tek oyuncu — 2.5D (küre avatar + zemine projekte taç/sersem halkaları + rozet). */
function drawCrownPlayer25d(ctx, p, color, arena, lastTime, targetCrownTime, selfSlot, proj) {
  const r = p.radius || CROWN_PLAYER_RADIUS;
  const u = arena?.unit || 1;
  const k = proj.view.scale * proj.proj(p.x, p.y, 0).d;
  const hasViewer = selfSlot >= 0;

  if (p.hasCrown || p.stumbleTimer > 0) {
    const ringR = p.hasCrown ? r * 1.55 : r + 7;
    proj.groundRing(ctx, p.x, p.y, ringR, UI_COLORS.hudAmber, Math.max(2, 3 * u * k));
  }

  let currentExp = 'normal';
  if (p.stumbleTimer > 0) currentExp = 'dizzy';
  else if (p.isTackling) currentExp = 'angry';
  else if (p.hasCrown) currentExp = 'excited';

  const figure = drawGameAvatar25d(ctx, proj, p, {
    x: p.x,
    y: p.y,
    radius: r,
    color,
    facingAngle: p.facingAngle ?? 0,
    expression: currentExp,
    borderColor: p.isTackling ? UI_COLORS.hudAmber : (p.rimColor || UI_COLORS.inkDark),
    borderWidth: Math.max(1.5, (p.isTackling ? 4.5 : 3) * k),
    now: lastTime || performance.now(),
    alpha: fxReadAlpha({ isSelf: hasViewer && (p.slot ?? p.index) === selfSlot, hasViewer }),
  });

  if (p.stumbleTimer > 0) {
    ctx.save();
    ctx.font = `900 ${Math.max(9, Math.round(13 * k))}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = UI_COLORS.hudInkOutline;
    ctx.lineWidth = Math.max(2, 3 * k);
    ctx.strokeText('SERSEM!', figure.headX, figure.topY - 20 * k);
    ctx.fillStyle = UI_COLORS.hudAmber;
    ctx.fillText('SERSEM!', figure.headX, figure.topY - 20 * k);
    ctx.restore();
  }

  const isAlive = p.alive ?? p.isAlive ?? true;
  if (isAlive && (p.tackleCooldown !== undefined || p.stumbleTimer !== undefined)) {
    const cdRatio = (p.tackleCooldown || 0) > 0
      ? 1.0 - Math.max(0, Math.min(1, p.tackleCooldown / 2.0))
      : null;
    const chip = proj.proj(p.x, p.y, r);
    renderEntityHUD(ctx, {
      x: chip.x,
      y: chip.y,
      radius: r * k,
      color: UI_COLORS.crownGold,
      cooldownProgress: cdRatio,
      stun: (p.stumbleTimer || 0) > 0,
    });
  }

  if (p.hasCrown) {
    const holdTime = p.crownHoldTime || 0;
    const remain = Math.max(0, targetCrownTime - holdTime);
    const urgent = remain <= 5.0;
    // Kazanma ilerlemesi: 2.5D'de tam zemin halkası (renk aciliyeti taşır).
    proj.groundRing(ctx, p.x, p.y, r + 9, urgent ? UI_COLORS.crownRed : UI_COLORS.hudAmber, Math.max(2, 8 * u * k));

    const bScale = Math.min(1.4, getUiScale(arena)) * k;
    const badgeW = Math.round(72 * bScale);
    const badgeH = Math.round(22 * bScale);
    const badgeY = figure.topY - Math.round(30 * bScale);
    ctx.save();
    ctx.fillStyle = urgent ? UI_COLORS.crownRed : UI_COLORS.crownGold;
    ctx.fillRect(figure.headX - badgeW / 2, badgeY, badgeW, badgeH);
    ctx.strokeStyle = UI_COLORS.inkDark;
    ctx.lineWidth = Math.max(2, Math.round(2 * bScale));
    ctx.strokeRect(figure.headX - badgeW / 2, badgeY, badgeW, badgeH);
    ctx.fillStyle = UI_COLORS.inkDark;
    ctx.font = `900 ${Math.round(12 * bScale)}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${remain.toFixed(1)}s`, figure.headX, badgeY + badgeH / 2);
    ctx.restore();
  }
}

/** Kare-geneli oyuncu durumu (kare başına tahsis yok; oyuncuya özel veri `p`de). */
const CROWN_PLAYER_ST = {
  arena: null, lastTime: 0, targetCrownTime: 15, selfSlot: -1, proj: null, floatAnim: 0,
};

/** Kuyruk öğesi: oyuncu + (varsa) taşıdığı taç rozeti. `p.color` önceden atanır. */
function drawCrownPlayerItem25d(ctx, p, st) {
  const {
    arena, lastTime, targetCrownTime, selfSlot, proj, floatAnim,
  } = st;
  drawCrownPlayer25d(ctx, p, p.color, arena, lastTime, targetCrownTime, selfSlot, proj);
  if (p.hasCrown) drawCarriedCrown25d(ctx, { p, proj, floatAnim, arena });
}

export function drawCrownWorld(ctx, frameOrGame, arena, colors = [], lastTime = performance.now(), targetCrownTime = 15.0, selfSlot = -1, opts = {}) {
  const proj = opts.proj || null;

  const speedPads = frameOrGame.speedPads || [];
  const conveyors = frameOrGame.conveyors || [];
  const movingHazards = frameOrGame.movingHazards || frameOrGame.hazards || [];
  const pillars = frameOrGame.pillars || [];
  const bumpers = frameOrGame.bumpers || [];
  const bananaPeels = frameOrGame.bananaPeels || frameOrGame.bananas || [];
  const inkPuddles = frameOrGame.inkPuddles || frameOrGame.ink || [];
  const pickups = frameOrGame.pickups || [];
  const crown = frameOrGame.crown;
  const players = frameOrGame.players || [];
  const floatAnim = crown?.floatAnim ?? ((lastTime || 0) * 0.003);
  const carrier = crown?.carrier ?? crown?.carrierIndex;
  const isLoose = carrier === null || carrier === undefined;

  drawCrownArena(ctx, arena, { ...opts, proj });

  // Zemin katmanı (kuyruğa girmeden, varlıkların altında).
  for (const sp of speedPads) drawSpeedPad(ctx, sp, arena, proj);
  for (const c of conveyors) drawConveyor(ctx, c, arena, proj);
  for (const h of movingHazards) drawMovingHazardTrack(ctx, h, arena, proj);

  if (proj) {
    // 2.5D: engel/sütun, bumper, tuzak ve oyuncular taban-Y derinlik kuyruğunda;
    // zemin decalleri (muz/mürekkep) ve rozetler kuyruk dışında kalır.
    for (const pil of pillars) {
      const r = getRect(pil);
      drawObstacle25dShadow(ctx, proj, r);
      sceneDraw(ctx, obstacleBaseY(r), drawObstacle25dMass, proj, r);
    }
    for (const b of bumpers) {
      const bc = getCircle(b);
      sceneDraw(ctx, entitySceneY(bc.y, bc.radius), drawBumper25d, { b: bc, proj });
    }
    for (const h of movingHazards) {
      sceneDraw(ctx, entitySceneY(h.y, h.radius), drawMovingHazard25d, { h, proj });
    }
    for (const b of bananaPeels) drawBananaPeel(ctx, b, proj);
    for (const ink of inkPuddles) drawInkPuddle(ctx, ink, proj);
    for (const pk of pickups) {
      if (Array.isArray(pk)) drawPickup(ctx, { x: pk[0], y: pk[1], type: pk[3] }, { size: pk[2], proj });
      else drawPickup(ctx, pk, { proj });
    }
    if (crown && isLoose) {
      const scale = 1.0 + Math.sin(floatAnim) * 0.12;
      sceneDraw(ctx, entitySceneY(crown.y, crown.radius || 20), drawCrownToken25d, {
        crown, proj, floatAnim, scale, arena,
      });
    }
    // Oyuncular: zenginleştirilmiş kopya + ortak kuyruk iskeleti (sceneKit).
    const scenePlayers = players
      .filter((p) => (p.joined ?? p.isJoined) !== false && (p.alive ?? p.isAlive) !== false)
      .map((p) => {
        const slot = p.slot ?? p.index ?? 0;
        return { ...p, color: colors[slot] || p.color || PLAYER_FALLBACK[slot] || PLAYER_FALLBACK[0] };
      });
    const st = CROWN_PLAYER_ST;
    st.arena = arena;
    st.lastTime = lastTime;
    st.targetCrownTime = targetCrownTime;
    st.selfSlot = selfSlot;
    st.proj = proj;
    st.floatAnim = floatAnim;
    queuePlayers(ctx, scenePlayers, {
      state: st,
      drawItem: drawCrownPlayerItem25d,
      radiusOf: (p) => p.radius || CROWN_PLAYER_RADIUS,
    });
    return;
  }

  // --- Tepeden bakış (dönüştürülmemiş yol) ---
  for (const pil of pillars) drawPillar(ctx, pil, arena);
  for (const b of bumpers) drawBumper(ctx, b, arena);
  for (const h of movingHazards) drawMovingHazard(ctx, h, arena);
  for (const b of bananaPeels) drawBananaPeel(ctx, b);
  for (const ink of inkPuddles) drawInkPuddle(ctx, ink);
  for (const pk of pickups) {
    if (Array.isArray(pk)) {
      drawPickup(ctx, { x: pk[0], y: pk[1], type: pk[3] }, { size: pk[2] });
    } else {
      drawPickup(ctx, pk);
    }
  }
  if (crown && isLoose) {
    const scale = 1.0 + Math.sin(floatAnim) * 0.12;
    drawCrown(ctx, crown.x, crown.y, scale, true, arena, floatAnim);
  }
  for (const p of players) {
    const isJoined = p.joined ?? p.isJoined;
    const isAlive = p.alive ?? p.isAlive;
    if (isJoined === false || isAlive === false) continue;
    const slot = p.slot ?? p.index ?? 0;
    const playerColor = colors[slot] || p.color || PLAYER_FALLBACK[slot] || PLAYER_FALLBACK[0];
    drawCrownPlayer(ctx, p, playerColor, arena, lastTime, targetCrownTime, selfSlot);

    if (p.hasCrown) {
      const cScale = 0.95 + Math.sin(floatAnim * 1.5) * 0.05;
      drawCrown(ctx, p.x, p.y - (p.radius || 36) - 8, cScale, false, arena, floatAnim);
    }
  }
}

/**
 * FX katmanının tek çizim sırası: pop → ring → partikül. Host motoru ve
 * client worldView AYNI fonksiyonu çağırır (tanks deseni). `proj` verilirse
 * eğik kameraya projekte edilir.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ pops?: any[], rings?: any[], particles?: any[] }} layer
 * @param {any} [proj]
 */
export function drawCrownFxLayer(ctx, layer, proj = null) {
  drawFxPops(ctx, layer?.pops, proj);
  drawFxRings(ctx, layer?.rings, proj);
  drawCircleParticles(ctx, layer?.particles, proj);
}

