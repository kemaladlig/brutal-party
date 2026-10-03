// Paylaşılan ARCHER dünya snapshot'ı + çizim sınırı (SNAKE deseni).
// Yetkili host, uzak telefon client'larıyla aynı çizim yardımcılarını kullanır;
// client bu modülden snapshot/validator + salt-okunur draw fonksiyonlarını alır,
// asla simülasyon/AI import etmez.

import { drawPickup, pushObstaclesToDepth } from '../core/arenaKit.js';
import { beginDepthPass, flushDepthPass, entityDepth, DEPTH_KIND, pushDepthItem } from '../core/depthPass.js';
import { drawField, hashFieldSeed } from '../core/fieldKit.js';
import { tracerAt } from '../core/fieldLights.js';
import { drawGameAvatar, computeAvatarKineticDeformation } from '../core/avatarInGame.js';
import { fxReadAlpha, packFloatingTexts, isValidFloatingTexts } from '../core/fxKit.js';
import { drawTabletopIcon } from '../core/tabletopIcons.js';
import { getFireCooldownProgress, getFireFeedbackForRender, getFireFeedbackSnapshot, isValidFireFeedbackSnapshot } from '../core/fireFeedback.js';
import { renderFireCooldown } from '../ui/hud.js';
import { UI_COLORS } from '../ui/tokens.js';
import {
  isWorldEntityVisible,
  packFxState,
  isValidFxState,
  drawFxRings,
  drawFxPops,
  drawCircleParticles,
} from './worldCore.js';

const ARCHER_RADIUS = 28;
const FALLBACK = '#D84727';

const round1 = (v) => Math.round(Number(v) * 10) / 10;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

function winnerSlot(v) {
  return finite(v?.index) ? v.index : null;
}

// --- Snapshot serializer (host tarafı) ---
export function createArcherWorldPacket(game) {
  if (!game) return null;
  game._worldSeq = (Number(game._worldSeq) || 0) + 1;
  const arena = game.arena || {};
  const obstacles = Array.isArray(game.obstacles) ? game.obstacles : [];
  const pickups = Array.isArray(game.pickups) ? game.pickups : [];
  const players = Array.isArray(game.players) ? game.players : [];
  const arrows = Array.isArray(game.arrows) ? game.arrows : [];
  const particles = Array.isArray(game.particles) ? game.particles : [];

  return {
    version: 1,
    mode: 'ARCHER',
    selfPredict: true,
    seq: game._worldSeq,
    roundId: Number(game.roundId) || 0,
    gameState: game.state || 'LOBBY',
    arena: [
      round1(arena.left || 0),
      round1(arena.top || 0),
      round1(arena.right || 0),
      round1(arena.bottom || 0),
    ],
    obstacles: obstacles.map((o) => [round1(o.x), round1(o.y), round1(o.w), round1(o.h)]),
    pickups: pickups.map((pk) => [
      round1(pk.x),
      round1(pk.y),
      pk.type || 'TURBO',
      round1(pk.animTime || 0),
      round1(pk.radius || pk.size || 15),
    ]),
    players: players.map((p) => ({
      slot: p.index,
      joined: p.isJoined !== false,
      alive: p.isAlive !== false,
      x: round1(p.x || 0),
      y: round1(p.y || 0),
      // Kinetik parity (Faz 1): açık hız + recoil taşınır, uzak client
      // aynı squash'ı görür. Ölçekli cihaz px'tir, round1 yeter.
      vx: round1(p.vx || 0),
      vy: round1(p.vy || 0),
      recoil: round1(p.recoil || 0),
      // Yarıçap host'ta hesaplanır (sahayla ölçeklenir) ve paketle taşınır;
      // client aynı view çizimini kullandığı için yeniden ölçeklemez.
      radius: round1(p.radius || ARCHER_RADIUS),
      angle: round1(p.angle || 0),
      charging: !!p.charging,
      charge: round1(p.charge || 0),
      swayPhase: round1(p.swayPhase || 0),
      shield: Number(p.shield) || 0,
      stun: round1(p.stun || 0),
      reload: round1(p.shotCooldown ?? p.reloadCooldown ?? 0),
      fireCooldown: round1(getFireCooldownProgress(p, p.fireCooldownMax || 0.8)),
      fireFeedback: getFireFeedbackSnapshot(p),
      spawnProt: round1(p.spawnProt || 0),
      turbo: round1(p.turboTimer || 0),
      quickdraw: round1(p.quickdrawTimer || 0),
      multi: Math.max(0, Number(p.multiShots) || 0),
      slip: round1(p.slipTimer || 0),
    })),
    // Yüzen metin (SİSTEM 3): `fxKit.packFloatingTexts` tek kaynak; host
    // ilerletip paketler, client saf çizer.
    texts: packFloatingTexts(game.floatingTexts),
    arrows: arrows.map((a, index) => [
      round1(a.x),
      round1(a.y),
      round1(a.vx),
      round1(a.vy),
      typeof a.color === 'string' ? a.color : FALLBACK,
      Number.isInteger(a.id) ? a.id : index + 1,
    ]),
    particles: particles.slice(0, 64).map((pt) => ({
      x: round1(pt.x),
      y: round1(pt.y),
      radius: round1(pt.size ?? pt.radius ?? 3),
      alpha: clamp01((pt.life ?? pt.alpha ?? 0) / (pt.maxLife ?? 1)),
      color: typeof pt.color === 'string' ? pt.color : '#1A1A1A',
    })),
    // FX kanalı (MOTION_PLAN Faz 2a): host FX runtime'ının saf anlık görüntüsü
    // (tanks deseni). Playback canlıyken paket yükü yok sayılır (yedek kanal).
    fx: packFxState(game.fx),
    scores: (game.scores || [0, 0, 0, 0]).map((s) => Number(s) || 0),
    roundWinner: winnerSlot(game.roundWinner),
    matchWinner: winnerSlot(game.matchWinner),
    // `archerWorldView` MATCH_OVER başlığını bundan seçer; paketle
    // taşınmadığı için berabere maç "ŞAMPİYON" olarak basılıyordu.
    matchDraw: game.matchDraw === true,
  };
}

// --- Client frame doğrulaması ---
export function isValidArcherWorldFrame(frame) {
  if (!frame || frame.action !== 'WORLD_FRAME' || frame.version !== 1 || frame.mode !== 'ARCHER') return false;
  if (!Number.isInteger(frame.seq) || frame.seq < 0) return false;
  if (!Number.isInteger(frame.roundId) || frame.roundId < 0) return false;
  if (!['LOBBY', 'PLAYING', 'ROUND_PAUSE', 'ROUND_OVER', 'MATCH_OVER', 'OVERTIME'].includes(frame.gameState)) return false;
  if (!Array.isArray(frame.arena) || frame.arena.length !== 4 || !frame.arena.every(finite)) return false;
  if (frame.arena[2] <= frame.arena[0] || frame.arena[3] <= frame.arena[1]) return false;
  if (!Array.isArray(frame.scores) || frame.scores.length > 4 || !frame.scores.every((score) => finite(score) && score >= 0)) return false;
  if (frame.roundWinner !== null && (!Number.isInteger(frame.roundWinner) || frame.roundWinner < 0 || frame.roundWinner > 3)) return false;
  if (frame.matchWinner !== null && (!Number.isInteger(frame.matchWinner) || frame.matchWinner < 0 || frame.matchWinner > 3)) return false;
  if (!Array.isArray(frame.obstacles) || frame.obstacles.length > 16) return false;
  if (!frame.obstacles.every((o) => Array.isArray(o) && o.length === 4 && o.every(finite))) return false;
  if (!Array.isArray(frame.pickups) || frame.pickups.length > 12) return false;
  if (!frame.pickups.every((pk) => Array.isArray(pk) && pk.length >= 3 && finite(pk[0]) && finite(pk[1]) && finite(pk[3]) && finite(pk[4]))) return false;
  if (!Array.isArray(frame.arrows) || frame.arrows.length > 64) return false;
  if (!frame.arrows.every((a) => Array.isArray(a)
    && (a.length === 5 || (a.length === 6 && Number.isInteger(a[5]) && a[5] >= 0))
    && finite(a[0]) && finite(a[1]) && finite(a[2]) && finite(a[3]) && typeof a[4] === 'string')) return false;
  if (!Array.isArray(frame.players) || frame.players.length > 4) return false;
  if (!Array.isArray(frame.particles) || frame.particles.length > 64) return false;
  if (!frame.particles.every((pt) => pt && finite(pt.x) && finite(pt.y) && finite(pt.radius) && finite(pt.alpha) && typeof pt.color === 'string')) return false;
  // fx alanı v2 eklentisidir; eski host frames'i yoktur (opsiyonel, v1 uyumu).
  if (frame.fx !== undefined && !isValidFxState(frame.fx)) return false;
  // texts kanalı da v2 eklentisidir (aynı opsiyonel kural).
  if (!isValidFloatingTexts(frame.texts)) return false;
  return frame.players.every((p) => (
    p
    && typeof p.joined === 'boolean' && typeof p.alive === 'boolean'
    && Number.isInteger(p.slot) && p.slot >= 0 && p.slot <= 3
    && finite(p.x) && finite(p.y) && finite(p.angle)
    // radius opsiyoneldir (eski host paketleri) ama varsa pozitif olmalı.
    && (p.radius === undefined || (finite(p.radius) && p.radius > 0))
    // Kinetik alanlar v2 eklentisidir; eski host frames'i yoktur (opsiyonel).
    && (p.vx === undefined || finite(p.vx))
    && (p.vy === undefined || finite(p.vy))
    && (p.recoil === undefined || (finite(p.recoil) && p.recoil >= 0))
    && finite(p.charge) && finite(p.swayPhase) && finite(p.stun) && finite(p.reload)
    && finite(p.fireCooldown) && p.fireCooldown >= 0 && p.fireCooldown <= 1
    && isValidFireFeedbackSnapshot(p.fireFeedback)
    && finite(p.spawnProt) && finite(p.turbo) && finite(p.quickdraw)
    && Number.isInteger(p.multi) && p.multi >= 0 && finite(p.slip)
  ));
}

// --- Ortak çizim yardımcıları (host + client aynı fonksiyonu çağırır) ---
/** Engel çizim seçenekleri — MODÜL SABİTİ (kare başına tahsis yok). */
const ARCHER_OBSTACLE_OPTS = Object.freeze({ theme: 'ARCHER' });

export function drawArcherArena(ctx, arena, obstacles, opts = {}) {
  // Statik saha tek kaynaktan: zemin tonu, dokusu, derzi, seeded dekoru ve
  // yuvarlatılmış tepsi kesimi `fieldKit`'te pişirilir, frame başına tek blit.
  // Eskiden burada düz `#E8E5DF` dolgu + kare siyah `strokeRect` vardı.
  drawField(ctx, arena, { mode: 'ARCHER', seed: hashFieldSeed('ARCHER', opts.roundId) });
  // Engeller havuza yazılır; `drawArcherPlayers` sonunda oyuncularla birlikte
  // y-sırasında çizilir.
  beginDepthPass();
  pushObstaclesToDepth(obstacles, ARCHER_OBSTACLE_OPTS);
}

export function drawArcherPickups(ctx, pickups) {
  for (const pk of pickups) {
    drawPickup(ctx, { x: pk.x, y: pk.y, type: pk.type, animTime: pk.animTime, radius: pk.size || pk.radius || 15 });
  }
}

export function drawArcherArrows(ctx, arrows, arena = null) {
  const u = arena?.unit ?? 1;
  for (const a of arrows) {
    tracerAt(a.x, a.y);
    const ang = Math.atan2(a.vy || 0, a.vx || 0);
    const speed = Math.hypot(a.vx || 0, a.vy || 0);
    const arrowColor = a.color || FALLBACK;
    ctx.save();

    // 1. Zemine düşen uçuş gölgesi (havada süzülme hissi, derin diorama yüksekliği)
    ctx.save();
    ctx.translate(a.x + 2.5 * u, a.y + 4.5 * u);
    ctx.rotate(ang);
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = UI_COLORS.inkDark;
    ctx.lineWidth = 3.5 * u;
    ctx.beginPath();
    ctx.moveTo(-16, 0);
    ctx.lineTo(8, 0);
    ctx.stroke();
    // Fletching gölgesi
    ctx.beginPath();
    ctx.moveTo(-16, -3);
    ctx.lineTo(-9, 0);
    ctx.lineTo(-16, 3);
    ctx.stroke();
    // Ok ucu gölgesi
    ctx.fillStyle = UI_COLORS.inkDark;
    ctx.beginPath();
    ctx.moveTo(17, 0);
    ctx.lineTo(7, -5.5);
    ctx.lineTo(7, 5.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 2. Okun kendisi
    ctx.translate(a.x, a.y);
    ctx.rotate(ang);

    // Hava akımı / hız izi (micro wind streaks)
    if (speed > 5) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = UI_COLORS.white;
      ctx.lineWidth = 1.2 * u;
      ctx.beginPath();
      ctx.moveTo(-18, -4);
      ctx.lineTo(-30, -4);
      ctx.moveTo(-18, 4);
      ctx.lineTo(-30, 4);
      ctx.stroke();
      ctx.restore();
    }

    // Ahşap Gövde (dış koyu hat + iç sıcak ahşap lifi)
    ctx.strokeStyle = UI_COLORS.lineDark;
    ctx.lineWidth = 4 * u;
    ctx.beginPath();
    ctx.moveTo(-15, 0);
    ctx.lineTo(9, 0);
    ctx.stroke();

    ctx.strokeStyle = UI_COLORS.paperWarm;
    ctx.lineWidth = 2 * u;
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(8, 0);
    ctx.stroke();

    // Fletching (Kuyruk tüyleri - oyuncu renginde, açılı kanatlar)
    ctx.save();
    ctx.fillStyle = arrowColor;
    ctx.strokeStyle = UI_COLORS.lineDark;
    ctx.lineWidth = 1.5 * u;
    // Üst tüy kanadı
    ctx.beginPath();
    ctx.moveTo(-15, 0);
    ctx.lineTo(-16, -5.5);
    ctx.lineTo(-8, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Alt tüy kanadı
    ctx.beginPath();
    ctx.moveTo(-15, 0);
    ctx.lineTo(-16, 5.5);
    ctx.lineTo(-8, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Çelik Keski Ok Ucu (Beveled Steel Arrowhead)
    // Alt gölge yüzeyi (-45° ışıkta alt taraf koyu)
    ctx.fillStyle = UI_COLORS.inkDark;
    ctx.beginPath();
    ctx.moveTo(17, 0);
    ctx.lineTo(7, 6);
    ctx.lineTo(8, 0);
    ctx.closePath();
    ctx.fill();

    // Üst aydınlık yüzeyi (ışığı alan çelik üst yüz)
    ctx.fillStyle = arrowColor;
    ctx.beginPath();
    ctx.moveTo(17, 0);
    ctx.lineTo(7, -6);
    ctx.lineTo(8, 0);
    ctx.closePath();
    ctx.fill();

    // Dış kontur
    ctx.strokeStyle = UI_COLORS.lineDark;
    ctx.lineWidth = 1.8 * u;
    ctx.beginPath();
    ctx.moveTo(17, 0);
    ctx.lineTo(7, -6);
    ctx.lineTo(8, 0);
    ctx.lineTo(7, 6);
    ctx.closePath();
    ctx.stroke();

    // Ok ucundaki parlak nokta & sırt çizgisi (speküler ışıltı)
    ctx.strokeStyle = UI_COLORS.white;
    ctx.lineWidth = 1.2 * u;
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(16, 0);
    ctx.stroke();

    ctx.fillStyle = UI_COLORS.white;
    ctx.beginPath();
    ctx.arc(16, 0, Math.max(1, 1.3 * u), 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

/**
 * Nişan sallanması — çizilen nişan çizgisi ile gözlerin baktığı yön aynı
 * değeri kullanmalı, yoksa "gözler başka yere bakıyor" ayrışması çıkıyor.
 * Sim tarafındaki `ArcherGame.aimAngle` ile AYNI formül: tam gerilişte (charge=1)
 * salınım sıfırdır, ok tam bakış yönüne gider.
 */
function archerAimSway(player) {
  const charge = clamp01(player.charge);
  return Math.sin(player.swayPhase || 0) * (0.15 * (1 - charge));
}

/**
 * Tek oyuncunun tüm çizimi — derinlik geçişinin "çiz" geri çağrısı.
 * MODÜL SEVİYESİ olmalıdır: kare başına `() => {}` kapanışı tahsistir.
 */
function drawArcherPlayerEntity(ctx, player, opts) {
  const { showFx, now, arena, hasViewer, selfSlot } = opts;
    const slotIndex = (player.slot ?? player.index) ?? 0;
    // Yarıçap host tarafında hesaplanır ve world packet ile gelir; bu view
    // host VE kumanda client'ı tarafından ORTAK kullanıldığı için burada
    // ikinci kez ölçeklenmemeli. `fitWorld` zaten dünya uzayını client
    // canvas'ına sığdırır. Fallback yalnız eski paketler içindir.
    const R = player.radius || ARCHER_RADIUS;
    const u = arena?.unit ?? (R / ARCHER_RADIUS);
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle || 0);

    if (showFx && player.charging) {
      ctx.save();
      ctx.rotate(archerAimSway(player));
      // Hazır yay `#8B5CF6` 3.77:1, doluyorken 0.35 alfa 2.17:1. Koyu
      // taban eklenince ikisi de krem zeminde okunur.
      ctx.strokeStyle = player.charge >= 1 ? UI_COLORS.hudCharge : UI_COLORS.hudDim;
      ctx.lineWidth = Math.max(2, (player.charge >= 1 ? 4 : 2.5) * u);
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(R + 8, 0);
      ctx.lineTo(R + 60 + (player.charge || 0) * 90, 0);
      ctx.stroke();
      ctx.restore();
    }

    if (showFx) {
      ctx.save();
      // Şarj yayı gövde etrafında bir yay olarak kalır (nişan geometrisi),
      // ama tabanı koyu: doluyorken 2.17:1'lik ince gri çizgi kremde yoktu.
      ctx.strokeStyle = player.charging ? UI_COLORS.hudCharge : UI_COLORS.hudDim;
      ctx.lineWidth = 3.5 * u;
      ctx.beginPath();
      ctx.arc(0, 0, R + 6, -1.1, 1.1);
      ctx.stroke();
      if (player.charging) {
        ctx.fillStyle = UI_COLORS.hudCharge;
        ctx.beginPath();
        ctx.arc(R + 6, 0, 3 + (player.charge || 0) * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      if ((player.shield || 0) > 0) {
        ctx.strokeStyle = UI_COLORS.hudShield;
        ctx.lineWidth = 3 * u;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.arc(0, 0, R + 11, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if ((player.spawnProt || 0) > 0) {
        ctx.strokeStyle = UI_COLORS.hudCharge;
        ctx.lineWidth = 3 * u;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.arc(0, 0, R + 15, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    const stun = (player.stun || 0) > 0;
    // Kinetik dünya uzayında hesaplanır, gövde `angle` ile döndüğü için
    // squash açısı yerele çevrilir (dünya - gövde). Çevirmesizde strafe
    // (hareket ≠ bakış) iki kez dönerdi.
    const worldK = computeAvatarKineticDeformation(player, {});
    const localSquashAngle = worldK.squashAngle === null
      ? null
      : worldK.squashAngle - (player.angle || 0);
    drawGameAvatar(ctx, 0, 0, R, player, {
      color: stun ? '#9C988F' : (player.color || FALLBACK),
      facingAngle: 0,
      squashX: worldK.squashX,
      squashY: worldK.squashY,
      squashAngle: localSquashAngle,
      label: `P${slotIndex + 1}`,
      expression: player.charging ? 'angry' : (stun ? 'dizzy' : 'normal'),
      showPointer: true,
      borderWidth: 2.5 * u,
      // Dönüş view seviyesinde yapıldığı için avatarın yerel yüzü sabit;
      // bakış da YEREL uzayda verilir (gövde dönüşüne eklenir, üstüne binmez).
      lookAngle: player.charge > 0 ? archerAimSway(player) : undefined,
      now,
      alpha: fxReadAlpha({ isSelf: hasViewer && slotIndex === selfSlot, hasViewer }),
    });

    const activeEffects = [
      ['zap', player.turbo ?? player.turboTimer],
      ['rotate-cw', player.quickdraw ?? player.quickdrawTimer],
      ['target', player.multi ?? player.multiShots],
      ['wind', player.slip ?? player.slipTimer],
    ].filter(([, value]) => Number(value) > 0);
    activeEffects.forEach(([icon, value], index) => {
      drawTabletopIcon(ctx, icon, (index - (activeEffects.length - 1) / 2) * 16, -R - 20, 12, {
        color: index % 2 === 0 ? UI_COLORS.hudAmber : UI_COLORS.hudCharge,
        accentColor: UI_COLORS.hudAmber,
        strokeWidth: 2,
      });
    });

    ctx.restore();

    const progress = Number.isFinite(player.fireCooldown)
      ? player.fireCooldown
      : getFireCooldownProgress(player, player.fireCooldownMax || 0.8);
    const feedback = getFireFeedbackForRender(player);
    renderFireCooldown(ctx, {
      x: player.x,
      y: player.y,
      radius: R,
      progress,
      feedback,
      arena,
      icon: 'zap',
    });
}

/** Derinlik geçişinin kare seviyesindeki seçenekleri — MODÜL SABİTİ. */
const ARCHER_PLAYER_OPTS = {
  showFx: false,
  now: 0,
  arena: null,
  hasViewer: false,
  selfSlot: -1,
};

export function drawArcherPlayers(ctx, players, { showFx = false, now = 0, arena = null, selfSlot = -1 } = {}) {
  // 3.3: tek görür varsa kendi avatarın T1 (tam), diğerleri T3 (−%25). α fxKit'ten okunur.
  ARCHER_PLAYER_OPTS.showFx = showFx;
  ARCHER_PLAYER_OPTS.now = now;
  ARCHER_PLAYER_OPTS.arena = arena;
  ARCHER_PLAYER_OPTS.hasViewer = Number.isInteger(selfSlot) && selfSlot >= 0;
  ARCHER_PLAYER_OPTS.selfSlot = selfSlot;

  for (const player of players) {
    if (!isWorldEntityVisible(player)) continue;
    pushDepthItem(entityDepth(player), DEPTH_KIND.PLAYER, player, drawArcherPlayerEntity, ARCHER_PLAYER_OPTS);
  }

  // Engeller + oyuncular TEK y-sırasında çizilir.
  flushDepthPass(ctx);
}

/**
 * FX katmanının tek çizim sırası: pop → ring → partikül. Host motoru ve
 * client worldView AYNI fonksiyonu çağırır (tanks deseni).
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ pops?: any[], rings?: any[], particles?: any[] }} layer
 */
export function drawArcherFxLayer(ctx, layer) {
  drawFxPops(ctx, layer?.pops);
  drawFxRings(ctx, layer?.rings);
  drawCircleParticles(ctx, layer?.particles);
}
