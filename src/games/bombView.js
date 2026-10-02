// Paylaşılan BOMB dünya snapshot'ı + çizim sınırı (SNAKE/ARCHER deseni).
// Yetkili host, uzak telefon client'larıyla aynı çizim yardımcılarını kullanır;
// client simülasyon/AI import etmez, yalnız salt-okunur draw + snapshot/validator alır.
//
// 2.5D EĞİK SAHNE: dünya çizimi `core/projection2d.js` kamerasından geçer.
// Host ve ONLINE client AYNI `proj`'u arenadan türettiği için sahne birebir
// aynıdır. Derinlik sırası `arenaKit` sahne kuyruğudur (painter's order).

import {
  drawPickup, obstacleBaseY, entitySceneY, sceneDraw,
  drawObstacle25dShadow, drawObstacle25dMass,
} from '../core/arenaKit.js';
import { drawField25d, drawFieldRail, fieldRailBaseY } from '../core/fieldKit.js';

/** Kenar tampon çizim sırası (kuzey/batı arka, güney/doğu ön — taban-y belirler). */
const RAIL_SIDES = /** @type {const} */ (['north', 'west', 'east', 'south']);

/**
 * BOMB harita → 2.5D tema eşlemesi. Host ve ONLINE client AYNI haritayı aynı
 * temaya çevirsin diye tek kaynak burasıdır; client paketteki `mapIndex`ten
 * türetir (`ui/bombWorldView`). Harita sayısından bağımsız: modulo ile döner.
 */
export const BOMB_MAP_THEMES = ['wood', 'marble', 'arcade', 'picnic', 'night'];

/** @param {number} mapIndex */
export function bombThemeForMap(mapIndex) {
  const i = Math.abs(Math.trunc(Number(mapIndex) || 0)) % BOMB_MAP_THEMES.length;
  return BOMB_MAP_THEMES[i];
}

/** Oyuncu öğesi çizimi — paylaşılan kare durumu (kare başına tahsis yok). */
const PLAYER_ST = /** @type {{withFx: boolean, bombTimer: number, bombMaxTime: number, now: number, arena: any, hasViewer: boolean, selfSlot: number, proj: any}} */ ({
  withFx: true, bombTimer: 15, bombMaxTime: 15, now: 0, arena: null, hasViewer: false, selfSlot: -1, proj: null,
});
import { drawGameAvatar25d } from '../core/avatarInGame.js';
import { fxReadAlpha } from '../core/fxKit.js';
import {
  packBlast, isValidBlast, drawBlast, isWorldEntityVisible,
  packFxState, isValidFxState, drawFxRings, drawFxPops, drawSquareParticles,
} from './worldCore.js';
import { renderEntityHUD } from '../ui/hud.js';
import { UI_COLORS } from '../ui/tokens.js';
import { t } from '../i18n.js';

const round1 = (v) => Math.round(Number(v) * 10) / 10;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

function winnerSlot(v) {
  return finite(v?.index) ? v.index : null;
}

// --- Snapshot serializer (host tarafı) ---
export function createBombWorldPacket(game) {
  if (!game) return null;
  game._worldSeq = (Number(game._worldSeq) || 0) + 1;
  const arena = game.arena || {};
  const pillars = Array.isArray(game.pillars) ? game.pillars : [];
  const pickups = Array.isArray(game.pickups) ? game.pickups : [];
  const inkPuddles = Array.isArray(game.inkPuddles) ? game.inkPuddles : [];
  const players = Array.isArray(game.players) ? game.players : [];
  const particles = Array.isArray(game.particles) ? game.particles : [];

  return {
    version: 1,
    mode: 'BOMB',
    selfPredict: true,
    seq: game._worldSeq,
    roundId: Number(game.roundId) || 0,
    mapIndex: Number.isInteger(game.selectedMapIndex) ? game.selectedMapIndex : 0,
    gameState: game.state || 'LOBBY',
    carrier: Number.isInteger(game.bombCarrierIndex) ? game.bombCarrierIndex : -1,
    bombTimer: round1(game.bombTimer || 0),
    bombMaxTime: round1(game.bombMaxTime || 1),
    arena: [
      round1(arena.left || 0),
      round1(arena.top || 0),
      round1(arena.right || 0),
      round1(arena.bottom || 0),
    ],
    pillars: pillars.map((p) => [round1(p.x), round1(p.y), round1(p.w), round1(p.h)]),
    pickups: pickups.map((pk) => [
      round1(pk.x),
      round1(pk.y),
      pk.type || 'TURBO',
      round1(pk.animTime || 0),
      round1(pk.radius || pk.size || 15),
    ]),
    ink: inkPuddles.map((ink) => [round1(ink.x), round1(ink.y), round1(ink.radius || 22)]),
    blast: packBlast(game.blast),
    players: players.map((p) => ({
      slot: p.index,
      joined: p.isJoined !== false,
      alive: p.isAlive !== false,
      x: round1(p.x || 0),
      y: round1(p.y || 0),
      angle: round1(p.facingAngle || 0),
      radius: round1(p.radius),
      stumble: round1(p.stumbleTimer || 0),
      immunity: round1(p.immunityTimer || 0),
      dash: round1(p.dashTimer || 0),
      turbo: round1(p.turboTimer || 0),
      slip: round1(p.slipTimer || 0),
      slipAngle: round1(p.slipAngle || 0),
      cd: round1(p.dashCooldown || 0),
      cdMax: round1(p.dashMaxCooldown || 1),
    })),
    particles: particles.slice(0, 64).map((pt) => ({
      x: round1(pt.x),
      y: round1(pt.y),
      size: round1(pt.size || 3),
      life: round1(pt.life || 0),
      maxLife: round1(pt.maxLife || 1),
      color: typeof pt.color === 'string' ? pt.color : UI_COLORS.inkDark,
    })),
    scores: (game.scores || [0, 0, 0, 0]).map((s) => Number(s) || 0),
    matchDraw: game.matchDraw === true,
    roundWinner: winnerSlot(game.roundWinner),
    matchWinner: winnerSlot(game.matchWinner),
    // FX kanalı (MOTION_PLAN Faz 2b): host FX runtime'ının saf anlık görüntüsü
    // (tanks deseni). Playback canlıyken paket yükü yok sayılır (yedek kanal).
    fx: packFxState(game.fx),
  };
}

// --- Client frame doğrulaması ---
export function isValidBombWorldFrame(frame) {
  if (!frame || frame.action !== 'WORLD_FRAME' || frame.version !== 1 || frame.mode !== 'BOMB') return false;
  if (!Number.isInteger(frame.seq) || frame.seq < 0) return false;
  if (!Number.isInteger(frame.roundId) || frame.roundId < 0) return false;
  // mapIndex v1.1 eklentisidir; eski host frames'i yoktur (opsiyonel, v1 uyumu).
  if (frame.mapIndex !== undefined && (!Number.isInteger(frame.mapIndex) || frame.mapIndex < 0 || frame.mapIndex > 31)) return false;
  if (!['LOBBY', 'PLAYING', 'ROUND_PAUSE', 'ROUND_OVER', 'MATCH_OVER', 'OVERTIME'].includes(frame.gameState)) return false;
  if (!Number.isInteger(frame.carrier) || frame.carrier < -1 || frame.carrier > 3) return false;
  if (!Array.isArray(frame.arena) || frame.arena.length !== 4 || !frame.arena.every(finite)) return false;
  if (frame.arena[2] <= frame.arena[0] || frame.arena[3] <= frame.arena[1]) return false;
  if (!Array.isArray(frame.scores) || frame.scores.length > 4 || !frame.scores.every((score) => finite(score) && score >= 0)) return false;
  if (frame.roundWinner !== null && (!Number.isInteger(frame.roundWinner) || frame.roundWinner < 0 || frame.roundWinner > 3)) return false;
  if (frame.matchWinner !== null && (!Number.isInteger(frame.matchWinner) || frame.matchWinner < 0 || frame.matchWinner > 3)) return false;
  if (typeof frame.matchDraw !== 'boolean') return false;
  if (!Array.isArray(frame.pillars) || frame.pillars.length > 16) return false;
  if (!frame.pillars.every((p) => Array.isArray(p) && p.length === 4 && p.every(finite))) return false;
  if (!Array.isArray(frame.pickups) || frame.pickups.length > 12) return false;
  if (!frame.pickups.every((pk) => Array.isArray(pk) && pk.length >= 3 && finite(pk[0]) && finite(pk[1]) && finite(pk[3]) && finite(pk[4]))) return false;
  if (!Array.isArray(frame.ink) || frame.ink.length > 20) return false;
  if (!frame.ink.every((p) => Array.isArray(p) && p.length === 3 && finite(p[0]) && finite(p[1]) && finite(p[2]))) return false;
  if (!isValidBlast(frame.blast ?? null)) return false;
  if (!Array.isArray(frame.players) || frame.players.length > 4) return false;
  if (!Array.isArray(frame.particles) || frame.particles.length > 64) return false;
  if (!frame.particles.every((pt) => pt && finite(pt.x) && finite(pt.y) && finite(pt.size) && finite(pt.life) && finite(pt.maxLife) && typeof pt.color === 'string')) return false;
  // fx alanı v2 eklentisidir; eski host frames'i yoktur (opsiyonel, v1 uyumu).
  if (frame.fx !== undefined && !isValidFxState(frame.fx)) return false;
  return frame.players.every((p) => (
    p
    && typeof p.joined === 'boolean' && typeof p.alive === 'boolean'
    && Number.isInteger(p.slot) && p.slot >= 0 && p.slot <= 3
    && finite(p.x) && finite(p.y) && finite(p.angle) && finite(p.radius)
    && finite(p.stumble) && finite(p.immunity) && finite(p.dash) && finite(p.turbo)
    && finite(p.slip) && finite(p.slipAngle) && finite(p.cd) && finite(p.cdMax)
  ));
}

// --- Ortak çizim yardımcıları (host + client, eğik kamera) ---

/**
 * Arena katmanı: eğik saha + kenar tamponları + engel prizmaları + taşıyıcı
 * halkası. `sceneBegin`/`sceneEnd` penceresi içinde çağrılır; gölgeler zemin
 * katmanında hemen, gövdeler derinlik kuyruğunda çizilir.
 * @param {CanvasRenderingContext2D} ctx
 * @param {FieldGeometry|null} arena
 * @param {any[]} pillars
 * @param {{carrier?: any, bombTimer?: number, bombMaxTime?: number, proj: any}} opts
 */
export function drawBombArena(ctx, arena, pillars, { carrier = null, bombTimer = 15, bombMaxTime = 15, proj } = /** @type {any} */ ({})) {
  drawField25d(ctx, proj, arena);

  // Kenar tamponları saha DIŞINDA; taban-y sırası kuzey/batıyı arkaya,
  // güney/doğuyu öne düşürür (oyuncuyu asla örtmezler).
  for (const side of RAIL_SIDES) {
    sceneDraw(ctx, fieldRailBaseY(arena, side), drawFieldRail, proj, { arena, side });
  }

  for (const pil of pillars) {
    // Zemin gölgesi her koşulda en altta; prizma derinlik kuyruğuna girer —
    // arkasındaki oyuncuyu çatı örtsün (2.5D painter's order).
    drawObstacle25dShadow(ctx, proj, pil);
    sceneDraw(ctx, obstacleBaseY(pil), drawObstacle25dMass, proj, pil);
  }

  if (carrier && carrier.alive !== false && Number.isFinite(carrier.x)) {
    const urgency = 1 - Math.max(0, bombTimer / Math.max(1, bombMaxTime));
    const pulse = Math.sin(performance.now() * 0.01) * 4;
    proj.groundRing(
      ctx, carrier.x, carrier.y, carrier.radius + 18 + pulse,
      urgency > 0.6 ? UI_COLORS.crownRed : UI_COLORS.hudAmber, 2.5,
    );
  }
}

// Patlama katmanı host↔client ortak çizimi (worldCore'da yaşar).
export function drawBombBlast(ctx, blast, arena, proj = null) {
  drawBlast(ctx, blast, arena, proj);
}

export function drawBombInk(ctx, puddles, proj = null) {
  for (const puddle of puddles) {
    if (proj) {
      // 2.5D: mürekkep zemine yayılır — projekte elips.
      proj.groundEllipse(ctx, puddle.x, puddle.y, puddle.radius, UI_COLORS.inkDark, 0.82);
      proj.groundEllipse(ctx, puddle.x - 6, puddle.y - 4, puddle.radius * 0.4, UI_COLORS.crownStoneDarker, 0.5);
      continue;
    }
    ctx.save();
    ctx.fillStyle = UI_COLORS.inkDark;
    ctx.beginPath();
    ctx.arc(puddle.x, puddle.y, puddle.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = UI_COLORS.crownStoneDarker;
    ctx.beginPath();
    ctx.arc(puddle.x - 6, puddle.y - 4, puddle.radius * 0.4, 0, Math.PI * 2);
    ctx.arc(puddle.x + 8, puddle.y + 5, puddle.radius * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** Statik pickup öğesi — sahne kuyruğu için (eğik rozet). */
function drawBombPickupItem(ctx, proj, pk) {
  drawPickup(
    ctx,
    { x: pk.x, y: pk.y, type: pk.type, animTime: pk.animTime, radius: pk.size || pk.radius || 15 },
    { proj },
  );
}

export function drawBombPickups(ctx, pickups, proj = null) {
  for (const pk of pickups) {
    const half = (pk.size || pk.radius || 15) / 2;
    sceneDraw(ctx, entitySceneY(pk.y, half), drawBombPickupItem, proj, pk);
  }
}

/**
 * Statik oyuncu öğesi — sahne kuyruğu kare başına closure üretmesin diye.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} player
 * @param {typeof PLAYER_ST} st
 */
function drawBombPlayerItem(ctx, player, st) {
  const {
    withFx, bombTimer, bombMaxTime, now, arena, hasViewer, selfSlot, proj,
  } = st;
  const radius = player.radius || 36;
  const u = radius / 36;
  // 2.5D OYUNCAK FİGÜR: gövde projekte silindir, baş billboard yüz. Taban
  // gölgesi + hacim, figürü engellerin yanına oturtur. `u` dünya referansı,
  // `k` kamera ölçeği; `uMin` taban 1px.
  const base = proj ? proj.proj(player.x, player.y, 0) : { x: player.x, y: player.y, d: 1 };
  const k = proj ? proj.view.scale * base.d : 1;
  const uMin = (v) => Math.max(1, v * u * k);

  let currentExp = 'normal';
  const isCarrier = player.carrier === true;
  if (isCarrier) currentExp = 'panic';
  else if (player.stumble > 0) currentExp = 'dizzy';
  else if (player.dash > 0) currentExp = 'angry';
  else if (player.turbo > 0) currentExp = 'wink';

  // Sersem titremesi figürü dünya uzayında sarsar (gövde de titresin).
  const shake = withFx && player.stumble > 0;
  const jx = shake ? (Math.random() - 0.5) * 6 * u : 0;
  const jy = shake ? (Math.random() - 0.5) * 6 * u : 0;

  const figure = drawGameAvatar25d(ctx, proj, player, {
    x: player.x + jx,
    y: player.y + jy,
    radius,
    facingAngle: player.angle,
    expression: currentExp,
    // Dash vurgusu BEYAZDI — krem zeminde 1.10:1, görünmez.
    borderColor: player.dash > 0 ? UI_COLORS.hudAmber : (player.rimColor || UI_COLORS.lineDark),
    borderWidth: uMin(player.dash > 0 ? 4.5 : 3),
    // Bomba taşıyıcısı kaçarken gözleri kaçış yönüne bakar: baş `angle`
    // ile döner, bakış `vx/vy`'den türetilir.
    lookAngle: (player.vx || player.vy) ? Math.atan2(player.vy || 0, player.vx || 0) : undefined,
    slipAngle: withFx && player.slip > 0 ? player.slipAngle : 0,
    now,
    alpha: fxReadAlpha({ isSelf: hasViewer && (player.slot ?? player.index) === selfSlot, hasViewer }),
  });

  // Krom çapaları: halkalar gövde çevresi, yıldız/rozet baş hizası.
  const tx = figure.torsoX;
  const ty = figure.torsoY;
  const tr = figure.torsoR;
  const hx = figure.headX;
  const hy = figure.headY;
  const hr = figure.headR;

  ctx.save();

  if (shake) {
    ctx.save();
    const dazeAngle = performance.now() * 0.008;
    const starR = hr + 8 * u * k;
    // Sersem yıldızları + halka + yazı: altın 1.19:1 ile görünmezdi.
    ctx.fillStyle = UI_COLORS.hudAmber;
    for (let s = 0; s < 3; s++) {
      const a = dazeAngle + (s * Math.PI * 2) / 3;
      const sx = hx + Math.cos(a) * starR;
      const sy = hy + Math.sin(a) * (starR * 0.4) - hr - 10 * u * k;
      const ss = 6 * u * k;
      ctx.fillRect(sx - ss / 2, sy - ss / 2, ss, ss);
    }
    ctx.strokeStyle = UI_COLORS.inkDark;
    ctx.lineWidth = uMin(5.5);
    ctx.setLineDash([5 * u * k, 5 * u * k]);
    ctx.beginPath();
    ctx.ellipse(tx, ty, tr + 6 * u * k, (tr + 6 * u * k) * 0.62, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = UI_COLORS.hudAmber;
    ctx.lineWidth = uMin(3.5);
    ctx.beginPath();
    ctx.ellipse(tx, ty, tr + 6 * u * k, (tr + 6 * u * k) * 0.62, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = UI_COLORS.hudAmber;
    ctx.font = `900 ${uMin(10)}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = UI_COLORS.inkDark;
    ctx.lineWidth = uMin(3);
    ctx.strokeText('SERSEM!', hx, figure.topY - 12 * u * k);
    ctx.fillText('SERSEM!', hx, figure.topY - 12 * u * k);
    ctx.restore();
  }

  if (withFx && player.immunity > 0) {
    ctx.save();
    ctx.strokeStyle = UI_COLORS.crownGreen;
    ctx.lineWidth = uMin(2.5);
    ctx.setLineDash([4 * u * k, 4 * u * k]);
    ctx.beginPath();
    ctx.ellipse(tx, ty, tr + 7 * u * k, (tr + 7 * u * k) * 0.62, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = UI_COLORS.crownGreen;
    ctx.font = `900 ${uMin(10)}px "Space Grotesk", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(t('bomb.safe'), hx, figure.topY - 6 * u * k);
    ctx.restore();
  }

  if (withFx && isCarrier) {
    const urgency = 1 - Math.max(0, bombTimer / Math.max(1, bombMaxTime));
    const pulseSpeed = 1 + urgency * 4;
    const pulseR = tr + (8 + Math.sin(performance.now() * 0.015 * pulseSpeed) * 4) * u * k;
    // Kritik nabız altın 1.19:1 ile görünmezdi.
    ctx.strokeStyle = urgency > 0.7 ? UI_COLORS.hudAmber : UI_COLORS.crownRed;
    ctx.lineWidth = uMin(urgency > 0.7 ? 4 : 3);
    ctx.beginPath();
    ctx.ellipse(tx, ty, pulseR, pulseR * 0.62, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  const bombCdProg = withFx && player.cd > 0
    ? 1.0 - Math.max(0, Math.min(1, player.cd / Math.max(1, player.cdMax)))
    : null;
  const bombStun = withFx && player.stumble > 0;

  if (isCarrier) {
    const bombY = figure.topY - 16 * u * k;
    ctx.fillStyle = UI_COLORS.lineDark;
    ctx.beginPath();
    ctx.arc(hx, bombY, 11 * u * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = UI_COLORS.crownPaperLight;
    ctx.lineWidth = 1.5 * u * k;
    ctx.stroke();
    ctx.strokeStyle = UI_COLORS.crownRed;
    ctx.lineWidth = 2.5 * u * k;
    ctx.beginPath();
    ctx.moveTo(hx, bombY - 10 * u * k);
    ctx.quadraticCurveTo(hx + 6 * u * k, bombY - 16 * u * k, hx + 4 * u * k, bombY - 20 * u * k);
    ctx.stroke();
    ctx.fillStyle = Math.random() > 0.5 ? UI_COLORS.hudAmber : UI_COLORS.crownRed;
    ctx.beginPath();
    ctx.arc(hx + 4 * u * k, bombY - 20 * u * k, 3.5 * u * k, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  if (bombCdProg !== null || bombStun) {
    renderEntityHUD(ctx, {
      x: tx,
      y: ty,
      radius: tr,
      color: UI_COLORS.hudAmber,
      arena,
      cooldownProgress: bombCdProg,
      stun: bombStun,
    });
  }
}

export function drawBombPlayers(ctx, players, { bombTimer = 15, bombMaxTime = 15, withFx = true, now = 0, arena = null, selfSlot = -1, proj = null } = {}) {
  const st = PLAYER_ST;
  st.withFx = withFx;
  st.bombTimer = bombTimer;
  st.bombMaxTime = bombMaxTime;
  st.now = now;
  st.arena = arena;
  st.selfSlot = selfSlot;
  st.proj = proj;
  // 3.3: tek görür varsa kendi avatarın T1, diğerleri T3 (−%25); α fxKit'ten.
  st.hasViewer = Number.isInteger(selfSlot) && selfSlot >= 0;
  for (const player of players) {
    if (!isWorldEntityVisible(player)) continue;
    // Derinlik anahtarı ayak tabanı — blok prizmalarıyla aynı ölçekte sıralanır.
    sceneDraw(ctx, entitySceneY(player.y, player.radius || 36), drawBombPlayerItem, player, st);
  }
}

/**
 * FX katmanının tek çizim sırası: pop → ring → partikül. Host motoru ve
 * client worldView AYNI fonksiyonu çağırır (tanks deseni); `proj` verilirse
 * eğik kameraya projekte edilir.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ pops?: any[], rings?: any[], particles?: any[] }} layer
 * @param {any} [proj]
 */
export function drawBombFxLayer(ctx, layer, proj = null) {
  drawFxPops(ctx, layer?.pops, proj);
  drawFxRings(ctx, layer?.rings, proj);
  drawSquareParticles(ctx, layer?.particles, proj);
}
