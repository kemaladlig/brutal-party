// Shared Snake world snapshot + rendering boundary.
// The authoritative game uses the same drawing helpers as remote phone clients.

import { drawGameAvatar, drawGameAvatar25d } from '../core/avatarInGame.js';
import { fxReadAlpha } from '../core/fxKit.js';
import {
  isWorldEntityVisible,
  packFxState,
  packParticles,
  isValidFxState,
  drawFxRings,
  drawFxPops,
  drawCircleParticles,
} from './worldCore.js';
import {
  drawObstacle,
  drawObstacle25dShadow,
  drawObstacle25dMass,
  sceneDraw,
  obstacleBaseY,
  entitySceneY,
} from '../core/arenaKit.js';
import { drawField, hashFieldSeed, drawField25d, drawFieldRail, fieldRailBaseY } from '../core/fieldKit.js';
import { drawTabletopIcon } from '../core/tabletopIcons.js';
import { drawStatusChip, STATUS_STATE } from '../core/entityStatus.js';
import { chipAt, queuePlayers } from '../core/sceneKit.js';
import { shade } from '../core/projection2d.js';
import { UI_COLORS } from '../ui/tokens.js';

const TRAIL_SPACING = 10;
const MAX_TRAIL_POINTS = 48;

// SNAKE 2.5D teması: harita varyasyonları yalnız duvar düzeni paylaşır, zemin
// ortaktır; bu yüzden tek tema. Host ve ONLINE world-view AYNI sabiti kullanır
// (paket alanı gerekmez — değer derleme-zamanı sabitidir).
export const SNAKE_THEME_25D = 'garden';
// Kenar tamponlarının taban-y sırası: kuzey/batı arkaya, güney/doğu öne.
const RAIL_SIDES = /** @type {const} */ (['north', 'west', 'east', 'south']);

const round1 = (value) => Math.round(Number(value) * 10) / 10;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

export function sampleSnakeTrail(segments, headX, headY, spacing = TRAIL_SPACING, maxPoints = MAX_TRAIL_POINTS) {
  const safeSegments = Array.isArray(segments) ? segments : [];
  const cap = Math.max(2, Math.floor(maxPoints));
  if (!safeSegments.length || !finite(headX) || !finite(headY)) {
    return finite(headX) && finite(headY) ? [[round1(headX), round1(headY)]] : [];
  }

  const path = [];
  let totalLength = 0;
  let previousX = finite(safeSegments[0]?.x1) ? safeSegments[0].x1 : headX;
  let previousY = finite(safeSegments[0]?.y1) ? safeSegments[0].y1 : headY;
  path.push({ x: previousX, y: previousY, start: 0, length: 0 });

  for (const segment of safeSegments) {
    const x1 = finite(segment?.x1) ? segment.x1 : previousX;
    const y1 = finite(segment?.y1) ? segment.y1 : previousY;
    const x2 = finite(segment?.x2) ? segment.x2 : x1;
    const y2 = finite(segment?.y2) ? segment.y2 : y1;
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length > 0.01) {
      path.push({ x: x2, y: y2, start: totalLength, length });
      totalLength += length;
    }
    previousX = x2;
    previousY = y2;
  }

  if (totalLength <= 0.01) return [[round1(headX), round1(headY)]];

  const sampleCount = Math.min(cap, Math.max(2, Math.ceil(totalLength / Math.max(2, spacing)) + 1));
  const step = totalLength / (sampleCount - 1);
  const points = [];
  let pathIndex = 1;

  for (let i = 0; i < sampleCount; i += 1) {
    const distance = i === sampleCount - 1 ? totalLength : i * step;
    while (pathIndex < path.length - 1 && path[pathIndex].start < distance) pathIndex += 1;
    const current = path[pathIndex];
    const previous = path[pathIndex - 1] || current;
    const localDistance = Math.max(0, Math.min(current.length, distance - previous.start));
    const ratio = current.length > 0 ? localDistance / current.length : 0;
    points.push([
      round1(previous.x + (current.x - previous.x) * ratio),
      round1(previous.y + (current.y - previous.y) * ratio),
    ]);
  }

  points[0] = [round1(path[0].x), round1(path[0].y)];
  points[points.length - 1] = [round1(headX), round1(headY)];
  return points;
}

function winnerSlot(value) {
  return finite(value?.index) ? value.index : null;
}

export function createSnakeWorldPacket(game) {
  if (!game) return null;
  game._worldSeq = (Number(game._worldSeq) || 0) + 1;
  const arena = game.arena || {};
  const walls = Array.isArray(game.walls) ? game.walls : [];
  const foods = Array.isArray(game.foods) ? game.foods : [];
  const players = Array.isArray(game.players) ? game.players : [];
  const particles = Array.isArray(game.particles) ? game.particles : [];

  return {
    version: 1,
    mode: 'SNAKE',
    seq: game._worldSeq,
    roundId: Number(game.roundId) || 0,
    gameState: game.state || 'LOBBY',
    // Gövde yay-uzunluğuyla yeniden örneklenir — interpolator trail'i
    // indeks-lerp yerine snap alır (worldInterpolation bayrak okur).
    snapTrail: true,
    arena: [
      round1(arena.left || 0),
      round1(arena.top || 0),
      round1(arena.right || 0),
      round1(arena.bottom || 0),
    ],
    walls: walls.map((wall) => [
      round1(wall.x),
      round1(wall.y),
      round1(wall.w),
      round1(wall.h),
    ]),
    foods: foods.map((food) => [
      round1(food.x),
      round1(food.y),
      food.type || 'APPLE',
      round1(food.size || 13),
    ]),
    players: players.map((player) => ({
      slot: player.index,
      joined: player.isJoined !== false,
      alive: player.isAlive !== false,
      x: round1(player.x || 0),
      y: round1(player.y || 0),
      angle: round1(player.angle || 0),
      radius: round1(player.radius || 24),
      boost: !!player.isBoost,
      energy: Math.round(player.boostEnergy ?? 100),
      locked: !!player.boostLocked,
      trail: sampleSnakeTrail(player.segments, player.x, player.y),
    })),
    particles: packParticles(particles, 64),
    // FX kanalı (MOTION_PLAN Faz 2c): host FX runtime'ının saf anlık görüntüsü.
    fx: packFxState(game.fx),
    scores: (game.scores || [0, 0, 0, 0]).map((score) => Number(score) || 0),
    matchDraw: game.matchDraw === true,
    roundWinner: winnerSlot(game.roundWinner),
    matchWinner: winnerSlot(game.matchWinner),
  };
}

export function isValidSnakeWorldFrame(frame) {
  if (!frame || frame.action !== 'WORLD_FRAME' || frame.version !== 1 || frame.mode !== 'SNAKE') return false;
  if (!Number.isInteger(frame.seq) || frame.seq < 0) return false;
  if (!Number.isInteger(frame.roundId) || frame.roundId < 0) return false;
  if (!['LOBBY', 'PLAYING', 'ROUND_PAUSE', 'ROUND_OVER', 'MATCH_OVER', 'OVERTIME'].includes(frame.gameState)) return false;
  if (!Array.isArray(frame.arena) || frame.arena.length !== 4) return false;
  if (!frame.arena.every(finite)) return false;
  if (frame.arena[2] <= frame.arena[0] || frame.arena[3] <= frame.arena[1]) return false;
  if (!Array.isArray(frame.scores) || frame.scores.length > 4 || !frame.scores.every((score) => finite(score) && score >= 0)) return false;
  if (frame.roundWinner !== null && (!Number.isInteger(frame.roundWinner) || frame.roundWinner < 0 || frame.roundWinner > 3)) return false;
  if (frame.matchWinner !== null && (!Number.isInteger(frame.matchWinner) || frame.matchWinner < 0 || frame.matchWinner > 3)) return false;
  if (typeof frame.matchDraw !== 'boolean') return false;
  if (!Array.isArray(frame.walls) || frame.walls.length > 16) return false;
  if (!frame.walls.every((wall) => Array.isArray(wall) && wall.length === 4 && wall.every(finite))) return false;
  if (!Array.isArray(frame.foods) || frame.foods.length > 32) return false;
  if (!frame.foods.every((food) => Array.isArray(food) && food.length >= 4
    && finite(food[0]) && finite(food[1])
    && ['APPLE', 'GOLDEN_STAR', 'TURBO_BERRY'].includes(food[2])
    && finite(food[3]) && food[3] > 0)) return false;
  if (!Array.isArray(frame.players) || frame.players.length > 4) return false;
  if (!Array.isArray(frame.particles) || frame.particles.length > 64) return false;
  if (!frame.particles.every((particle) => (
    particle
    && finite(particle.x)
    && finite(particle.y)
    && finite(particle.size)
    && finite(particle.life)
    && finite(particle.maxLife)
    && typeof particle.color === 'string'
  ))) return false;
  // fx alanı v2 eklentisidir; eski host frames'i yoktur (opsiyonel, v1 uyumu).
  if (frame.fx !== undefined && !isValidFxState(frame.fx)) return false;
  return frame.players.every((player) => (
    player
    && typeof player.joined === 'boolean' && typeof player.alive === 'boolean'
    && Number.isInteger(player.slot)
    && player.slot >= 0
    && player.slot <= 3
    && finite(player.x)
    && finite(player.y)
    && finite(player.angle)
    && typeof player.boost === 'boolean'
    && finite(player.energy) && player.energy >= 0 && player.energy <= 100
    && typeof player.locked === 'boolean'
    && Array.isArray(player.trail)
    && player.trail.length <= MAX_TRAIL_POINTS
    && player.trail.every((point) => Array.isArray(point) && point.length >= 2 && finite(point[0]) && finite(point[1]))
  ));
}

export function drawSnakeArena(ctx, arena, walls, opts = {}) {
  const proj = opts.proj || null;
  if (proj) {
    // 2.5D eğik saha: masa zemini `drawField25d` içinde boyanır (çağıran
    // `paintBackdrop` çizmez). Kenar tamponları ve engel prizmaları DERİNLİK
    // kuyruğuna girer (çağıran `sceneBegin`/`sceneEnd` penceresi açar); engel
    // temas gölgeleri zeminde kalır.
    drawField25d(ctx, proj, arena);
    for (const side of RAIL_SIDES) {
      sceneDraw(ctx, fieldRailBaseY(arena, side), drawFieldRail, proj, { arena, side });
    }
    for (const wall of walls) {
      drawObstacle25dShadow(ctx, proj, wall);
      sceneDraw(ctx, obstacleBaseY(wall), drawObstacle25dMass, proj, wall);
    }
    return;
  }
  // Tepeden bakış (dönüştürülmemiş yol): kehribar tonlu bake + düz engel.
  drawField(ctx, arena, { mode: 'SNAKE', seed: hashFieldSeed('SNAKE', opts.roundId) });
  for (const wall of walls) drawObstacle(ctx, wall, { theme: 'SNAKE' });
}

/** Tek yem çizimi — sahne kuyruğu öğesi (2.5D'de zemine projekte). */
function drawSnakeFoodItem(ctx, s) {
  const { food, now, proj } = s;
  const pulse = 1 + Math.sin(now / 220 + (food.pulse || 0)) * 0.08;
  const baseR = ((food.size || 13) / 2) * pulse;
  let cx = food.x;
  let cy = food.y;
  let radius = baseR;
  if (proj) {
    const sp = proj.proj(food.x, food.y, 0);
    radius = baseR * proj.view.scale * sp.d;
    cx = sp.x;
    cy = sp.y;
  }
  const u = radius / 6.5;
  ctx.fillStyle = 'rgba(26, 26, 26, 0.25)';
  ctx.beginPath();
  ctx.arc(cx + 2, cy + 2, radius, 0, Math.PI * 2);
  ctx.fill();

  if (food.type === 'GOLDEN_STAR') {
    ctx.fillStyle = '#FFDE59';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 2.5 * u;
    ctx.stroke();
    drawTabletopIcon(ctx, 'star', cx, cy, radius * 1.3, { color: '#1A1A1A' });
  } else if (food.type === 'TURBO_BERRY') {
    ctx.fillStyle = '#A259FF';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 2.5 * u;
    ctx.stroke();
    drawTabletopIcon(ctx, 'zap', cx, cy, radius * 1.3, { color: '#FFDE59' });
  } else {
    ctx.fillStyle = UI_COLORS.crownRed;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 2 * u;
    ctx.stroke();
    ctx.fillStyle = '#FFF';
    ctx.beginPath();
    ctx.arc(cx - radius * 0.35, cy - radius * 0.35, radius * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2F6A4F';
    ctx.lineWidth = 2 * u;
    ctx.beginPath();
    ctx.moveTo(cx, cy - radius);
    ctx.lineTo(cx + 2, cy - radius - 3);
    ctx.stroke();
  }
}

export function drawSnakeFoods(ctx, foods, now = 0, proj = null) {
  for (const food of foods) {
    const half = (food.size || 13) / 2;
    sceneDraw(ctx, entitySceneY(food.y, half), drawSnakeFoodItem, { food, now, proj }, null);
  }
}

/**
 * Gövde noktalarını ekran uzayına çevirir (tek kaynak). 2.5D'de her nokta
 * projekte edilir; tepeden bakışta kimlik dönüşümü. Gövde çizimi (silüet,
 * silindir taraması, bant deseni) hep bu listeyi kullanır.
 */
function snakeScreenPoints(player, proj) {
  const mapPoint = (x, y) => (proj ? proj.proj(x, y, 0) : { x, y });
  const out = [];
  if (Array.isArray(player.trail) && player.trail.length) {
    for (const point of player.trail) out.push(mapPoint(point[0], point[1]));
  } else if (Array.isArray(player.segments) && player.segments.length) {
    out.push(mapPoint(player.segments[0].x1, player.segments[0].y1));
    for (const segment of player.segments) out.push(mapPoint(segment.x2, segment.y2));
  }
  return out;
}

function traceSnakePath(ctx, player, proj) {
  const pts = snakeScreenPoints(player, proj);
  ctx.beginPath();
  if (!pts.length) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
}

/** Tek oyuncu (yılan) çizimi — sahne kuyruğu öğesi. Gövde zeminde, kafa küre. */
function drawSnakePlayerItem(ctx, player, st) {
  const {
    hasViewer, selfSlot, proj, now = 0,
  } = st;
  const headRadius = player.radius || 24;
  const u = headRadius / 24;
  // 2.5D: gövde kalınlığı konumları kamera derinliğiyle ölçeklenir.
  const k = proj ? proj.view.scale * proj.proj(player.x, player.y, 0).d : 1;
  const alpha = fxReadAlpha({
    isSelf: hasViewer && (player.slot ?? player.index) === selfSlot,
    hasViewer,
  });

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const bodyColor = player.color || UI_COLORS.crownRed;

  // Gövde = projekte edilmiş SİLİNDİR (düz şerit değil). Eşmerkezli taramalar
  // (silüet → taban → alt gölge → üst ışık → spekül) boru hacmi verir; hafif
  // yukarı kaydırılan ışık şeritleri silindirin tepesini işaretler. Ardından
  // gövde boyunca çapraz bantlar (yılan pulu hissi) çizilir.
  const bodyPass = (widthU, offsetU, color) => {
    ctx.save();
    ctx.translate(0, offsetU * u * k);
    ctx.lineWidth = widthU * u * k;
    ctx.strokeStyle = color;
    traceSnakePath(ctx, player, proj);
    ctx.stroke();
    ctx.restore();
  };

  bodyPass(23, 0, '#1A1A1A');                    // silüet
  bodyPass(19, 0, bodyColor);                    // taban
  bodyPass(17, 2.1, shade(bodyColor, -0.22));    // alt gölge (aşağı kaydır)
  bodyPass(9, -3.0, shade(bodyColor, 0.30));     // üst ışık
  bodyPass(3.4, -4.2, shade(bodyColor, 0.58));   // spekül

  // Bant deseni: gövde boyunca ~dört noktada bir çapraz pul bandı.
  const bodyPts = snakeScreenPoints(player, proj);
  if (bodyPts.length > 5) {
    ctx.save();
    ctx.strokeStyle = shade(bodyColor, -0.45);
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 2.2 * u * k;
    ctx.lineCap = 'round';
    const half = 8.6 * u * k;
    for (let i = 2; i < bodyPts.length - 1; i += 4) {
      const a = bodyPts[i - 1];
      const b = bodyPts[i + 1];
      const p = bodyPts[i];
      let tx = b.x - a.x;
      let ty = b.y - a.y;
      const len = Math.hypot(tx, ty) || 1;
      tx /= len;
      ty /= len;
      const nx = -ty;
      const ny = tx;
      ctx.beginPath();
      ctx.moveTo(p.x + nx * half, p.y + ny * half);
      ctx.lineTo(p.x - nx * half, p.y - ny * half);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (player.isBoost || player.boost) {
    // Boost halesi altın dolgu 1.19:1 ile görünmezdi — koyu altın, aynı geometri.
    if (proj) {
      proj.groundRing(ctx, player.x, player.y, headRadius + 4 * u, UI_COLORS.hudAmber, Math.max(3, 8 * u * k));
    } else {
      ctx.fillStyle = UI_COLORS.hudAmber;
      ctx.beginPath();
      ctx.arc(player.x, player.y, headRadius + 4 * u, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const expression = player.isBoost || player.boost
    ? 'excited'
    : (player.boostLocked || player.locked ? 'panic' : 'normal');

  if (proj) {
    // 2.5D: kafa tek projekte küre (BOMB ile aynı karakter dili).
    drawGameAvatar25d(ctx, proj, player, {
      x: player.x,
      y: player.y,
      radius: headRadius,
      color: player.color || UI_COLORS.crownRed,
      facingAngle: player.angle,
      label: `P${(player.slot ?? player.index ?? 0) + 1}`,
      expression,
      alpha,
    });
  } else {
    drawGameAvatar(ctx, player.x, player.y, headRadius, player, {
      color: player.color || UI_COLORS.crownRed,
      avatar: player.avatar || null,
      slotIndex: player.slot ?? player.index ?? 0,
      facingAngle: player.angle,
      label: `P${(player.slot ?? player.index ?? 0) + 1}`,
      expression,
      showPointer: true,
      borderWidth: 2.5 * u,
      shadowOffset: 2,
      alpha,
    });
  }

  // Çatal dil kafanın ÖNÜNDE (avatarın üstüne, yön tarafında): periyodik
  // animasyonlu flick — `now` tabanlı olduğu için host+client aynı ritmi
  // yakın verir (kozmetik §6); oyun içi `tongueTimer` (yem yiyince) tam açar.
  const flickPhase = (now + (player.index ?? 0) * 470) % 1900;
  let tongueExt = flickPhase < 340 ? Math.sin((flickPhase / 340) * Math.PI) : 0;
  if (finite(player.tongueTimer) && player.tongueTimer < 0.4) tongueExt = 1;
  if (tongueExt > 0.02) {
    const baseR = headRadius * 0.9;
    const len = (headRadius * 0.55 + 4 * u) * tongueExt;
    const cosA = Math.cos(player.angle);
    const sinA = Math.sin(player.angle);
    const tipX = player.x + cosA * (baseR + len);
    const tipY = player.y + sinA * (baseR + len);
    const z = headRadius * 0.35;
    const toScreen = (x, y) => (proj ? proj.proj(x, y, z) : { x, y });
    const root = toScreen(player.x + cosA * baseR, player.y + sinA * baseR);
    const tip = toScreen(tipX, tipY);
    const prong = len * 0.55;
    const left = toScreen(tipX + Math.cos(player.angle + 0.6) * prong, tipY + Math.sin(player.angle + 0.6) * prong);
    const right = toScreen(tipX + Math.cos(player.angle - 0.6) * prong, tipY + Math.sin(player.angle - 0.6) * prong);
    ctx.strokeStyle = UI_COLORS.crownRed;
    ctx.lineWidth = Math.max(1.5, 1.8 * u * k);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(root.x, root.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(left.x, left.y);
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(right.x, right.y);
    ctx.stroke();
  }

  // Boost enerjisi: ince çember (altın yay 1.19:1) yerine rozet.
  // Kilitliyken BLOKE, doluyorken dolum barı. Kaynak 0-100 arası sayı.
  const energy = player.boostEnergy ?? player.energy ?? 100;
  if (energy < 98) {
    const locked = !!(player.boostLocked || player.locked);
    const icon = 'zap';
    const state = locked ? STATUS_STATE.BLOCKED : STATUS_STATE.CHARGING;
    const progress = Math.max(0, Math.min(1, energy / 100));
    if (proj) {
      chipAt(ctx, proj, { x: player.x, y: player.y, radius: headRadius }, {
        scale: u, icon, state, progress,
      });
    } else {
      drawStatusChip(ctx, {
        x: player.x, y: player.y, radius: headRadius, scale: u, icon, state, progress,
      });
    }
  }
}

/** Kare-geneli oyuncu durumu (kare başına tahsis yok; oyuncuya özel veri `player`da). */
const SNAKE_PLAYER_ST = {
  now: 0, hasViewer: false, selfSlot: -1, proj: null,
};

export function drawSnakePlayers(ctx, players, now = 0, selfSlot = -1, proj = null) {
  // 3.3 okunurluk hiyerarşisi: tek görür varsa kendi avatarın T1, diğerleri T3
  // (−%25); α yalnız fxKit'ten gelir, motor kendi α'sını uydurmaz.
  const st = SNAKE_PLAYER_ST;
  st.now = now;
  st.selfSlot = selfSlot;
  st.hasViewer = Number.isInteger(selfSlot) && selfSlot >= 0;
  st.proj = proj;
  queuePlayers(ctx, players, {
    state: st,
    drawItem: drawSnakePlayerItem,
    radiusOf: (player) => player.radius || 24,
    visible: isWorldEntityVisible,
  });
}

/**
 * FX katmanının tek çizim sırası: pop → ring → partikül. Host motoru ve
 * client worldView AYNI fonksiyonu çağırır (host↔client aynı görünüm ilkesi).
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ pops?: any[], rings?: any[], particles?: any[] }} layer
 */
export function drawSnakeFxLayer(ctx, layer, proj = null) {
  drawFxPops(ctx, layer?.pops, proj);
  drawFxRings(ctx, layer?.rings, proj);
  drawCircleParticles(ctx, layer?.particles, proj);
}
