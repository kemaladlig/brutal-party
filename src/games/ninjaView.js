// Paylaşılan NINJA dünya snapshot'ı + çizim sınırı (worldCore deseni).
// Yetkili host, uzak telefon client'larıyla aynı çizim yardımcılarını kullanır;
// client simülasyon/AI import etmez, yalnız salt-okunur draw + snapshot/validator alır.
// Notlar:
// - Görünmezlik (alpha<=0.02) rakiplerden gizlenir; yalnız kendi koltuğu (selfSlot)
//   hayalet kontur görür — host'taki `isLocalInputActive` hayaletinin client karşılığı.
// - Uçuşan metinler (SİSTEM 3) pakete GİRER: `fxKit.packFloatingTexts` öğeleri
//   paketler, host `renderFloatingTexts` listeyi İLERLETİR/temizler, client ise
//   paketten gelen donmuş `life` ile SAF çizer (`ui/hud.drawFloatingTextSnapshot`).
//   Konum-geçmişi (afterimage/footstep) yine pakette değil — bu bir bildirim kanalı.
// - Zaman bazlı fx (slash/decals/impacts/alpha) 2 ondalık taşınır (0.07 gecikmeler kırılmasın).

import { drawObstacle } from '../core/arenaKit.js';
import { drawField, hashFieldSeed } from '../core/fieldKit.js';
import { drawGameAvatar, computeAvatarKineticDeformation } from '../core/avatarInGame.js';
import { fxReadAlpha, packFloatingTexts, isValidFloatingTexts } from '../core/fxKit.js';
import { drawStatusChip } from '../core/entityStatus.js';
import {
  round1,
  packRectList,
  createWorldSnapshot,
  isValidWorldBase,
  isWorldEntityVisible,
  packFxState,
  isValidFxState,
  drawFxRings,
  drawFxPops,
  drawCircleParticles,
} from './worldCore.js';

export const NINJA_RADIUS = 36;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const round2 = (v) => Math.round(Number(v) * 100) / 100;
const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

// --- Snapshot serializer (host tarafı, deklaratif extras) ---
export function createNinjaWorldPacket(game) {
  if (!game) return null;
  return createWorldSnapshot(game, {
    mode: 'NINJA',
    mapPlayer: (p) => ({
      slot: p.index,
      joined: p.isJoined !== false,
      alive: p.isAlive !== false,
      x: round1(p.x || 0),
      y: round1(p.y || 0),
      vx: round1(p.vx || 0),
      vy: round1(p.vy || 0),
      // Yarıçap host'ta sahayla birlikte ölçeklenir ve paketle taşınır; client
      // aynı view'i kullandığı için yeniden ölçeklemez.
      radius: round1(p.radius || 36),
      angle: round1(p.angle || 0),
      alpha: round2(p.alpha ?? 1),
      strike: (p.strikeTimer || 0) > 0,
      strikeProg: (p.strikeCooldown || 0) > 0
        ? round2(1 - Math.min(1, p.strikeCooldown / 1.3)) : null,
      smokeProg: (p.smokeCooldown || 0) > 0
        ? round2(1 - Math.min(1, p.smokeCooldown / 5.0)) : null,
    }),
    extras: {
      selfPredict: true,
      matchDraw: game.matchDraw === true,
      timeLeft: round1(game.roundTime || 0),
      obstacles: packRectList(game.obstacles, 16),
      lanterns: (Array.isArray(game.lanterns) ? game.lanterns : []).slice(0, 6).map((l) => ({
        x: round1(l.x), y: round1(l.y),
        radius: round1(l.radius || 60),
        active: l.active !== false,
      })),
      steps: (Array.isArray(game.footsteps) ? game.footsteps : []).slice(0, 24).map((f) => ([
        round1(f.x), round1(f.y), round2(f.alpha ?? 0.45),
      ])),
      decals: (Array.isArray(game.cutDecals) ? game.cutDecals : []).slice(0, 8).map((cd) => ({
        x: round1(cd.x), y: round1(cd.y),
        angle: round1(cd.angle || 0),
        length: round1(cd.length || 220),
        color: typeof cd.color === 'string' ? cd.color : '#D84727',
        life: round2(cd.life || 0),
        maxLife: round2(cd.maxLife || 0.44),
        maxWidth: round1(cd.maxWidth || 5.5),
      })),
      ghosts: (Array.isArray(game.afterimages) ? game.afterimages : []).slice(0, 12).map((img) => ({
        x: round1(img.x), y: round1(img.y),
        angle: round1(img.angle || 0),
        alpha: round2(img.alpha ?? 0.75),
        color: typeof img.color === 'string' ? img.color : '#888888',
      })),
      slashes: (Array.isArray(game.slashWaves) ? game.slashWaves : []).slice(0, 4).map((sw) => ({
        x: round1(sw.x), y: round1(sw.y),
        angle: round1(sw.angle || 0),
        color: typeof sw.color === 'string' ? sw.color : '#FFFFFF',
        life: round2(sw.life || 0),
        maxLife: round2(sw.maxLife || 0.52),
        maxDist: round1(sw.maxDist || 220),
        outerRadius: round1(sw.outerRadius || 68),
        innerRadius: round1(sw.innerRadius || 22),
        arcSpan: round2(sw.arcSpan || 2.5),
        waves: (Array.isArray(sw.waves) ? sw.waves : []).slice(0, 4).map((w) => ({
          delay: round2(w.delay || 0),
          scale: round2(w.scale ?? 1),
          aura: typeof w.aura === 'string' ? w.aura : '#FFFFFF',
          width: round1(w.width || 3),
        })),
      })),
      impacts: (Array.isArray(game.impactCuts) ? game.impactCuts : []).slice(0, 8).map((ic) => ({
        x: round1(ic.x), y: round1(ic.y),
        angle: round1(ic.angle || 0),
        color: typeof ic.color === 'string' ? ic.color : '#FFFFFF',
        life: round2(ic.life || 0),
        maxLife: round2(ic.maxLife || 0.35),
      })),
      // FX kanalı (MOTION_PLAN Faz 2c): host FX runtime'ının saf anlık görüntüsü.
      // (Eski `fx` partikül dizisi bu anahtarı işgal ediyordu; kanal adı tek
      // konvansiyon olsun diye runtime'a devredildi, v1 partikül yedeği `particles`.)
      // Uyuşan (hit) anının bildirimi: tek kaynak `fxKit.packFloatingTexts`.
      texts: packFloatingTexts(game.floatingTexts),
      fx: packFxState(game.fx),
    },
  });
}

function isValidNinjaPlayer(p) {
  return typeof p.joined === 'boolean' && typeof p.alive === 'boolean'
    && finite(p.angle) && finite(p.alpha) && p.alpha >= 0 && p.alpha <= 1
    && typeof p.strike === 'boolean'
    && (p.vx === undefined || finite(p.vx))
    && (p.vy === undefined || finite(p.vy))
    && (p.strikeProg === null || (finite(p.strikeProg) && p.strikeProg >= 0 && p.strikeProg <= 1))
    && (p.smokeProg === null || (finite(p.smokeProg) && p.smokeProg >= 0 && p.smokeProg <= 1))
    // radius opsiyoneldir (eski host paketleri) ama varsa pozitif olmalı.
    && (p.radius === undefined || (finite(p.radius) && p.radius > 0));
}

function isValidNinjaExtra(frame) {
  if (typeof frame.matchDraw !== 'boolean' || !finite(frame.timeLeft) || frame.timeLeft < 0) return false;
  // texts kanalı v2 eklentisidir (opsiyonel; eski host paketleri taşımaz).
  if (!isValidFloatingTexts(frame.texts)) return false;
  if (!Array.isArray(frame.obstacles) || frame.obstacles.length > 16) return false;
  if (!frame.obstacles.every((r) => Array.isArray(r) && r.length === 4 && r.every(finite))) return false;
  if (!Array.isArray(frame.lanterns) || frame.lanterns.length > 6) return false;
  if (!frame.lanterns.every((l) => l && finite(l.x) && finite(l.y) && finite(l.radius) && typeof l.active === 'boolean')) return false;
  if (!Array.isArray(frame.steps) || frame.steps.length > 24) return false;
  if (!frame.steps.every((s) => Array.isArray(s) && s.length === 3 && finite(s[0]) && finite(s[1]) && finite(s[2]))) return false;
  if (!Array.isArray(frame.decals) || frame.decals.length > 8) return false;
  if (!frame.decals.every((d) => d && finite(d.x) && finite(d.y) && finite(d.angle) && finite(d.length)
    && typeof d.color === 'string' && finite(d.life) && finite(d.maxLife) && finite(d.maxWidth))) return false;
  if (!Array.isArray(frame.ghosts) || frame.ghosts.length > 12) return false;
  if (!frame.ghosts.every((g) => g && finite(g.x) && finite(g.y) && finite(g.angle) && finite(g.alpha) && typeof g.color === 'string')) return false;
  if (!Array.isArray(frame.slashes) || frame.slashes.length > 4) return false;
  if (!frame.slashes.every((sw) => sw && finite(sw.x) && finite(sw.y) && finite(sw.angle)
    && typeof sw.color === 'string' && finite(sw.life) && finite(sw.maxLife) && finite(sw.maxDist)
    && finite(sw.outerRadius) && finite(sw.innerRadius) && finite(sw.arcSpan)
    && Array.isArray(sw.waves) && sw.waves.length <= 4
    && sw.waves.every((w) => w && finite(w.delay) && finite(w.scale) && typeof w.aura === 'string' && finite(w.width)))) return false;
  if (!Array.isArray(frame.impacts) || frame.impacts.length > 8) return false;
  if (!frame.impacts.every((ic) => ic && finite(ic.x) && finite(ic.y) && finite(ic.angle)
    && typeof ic.color === 'string' && finite(ic.life) && finite(ic.maxLife))) return false;
  return true;
}

// --- Client frame doğrulaması ---
export function isValidNinjaWorldFrame(frame) {
  // fx alanı v2 eklentisidir; eski host frames'i yoktur (opsiyonel, v1 uyumu).
  if (frame.fx !== undefined && !isValidFxState(frame.fx)) return false;
  return isValidWorldBase(frame, 'NINJA', {
    checkPlayer: isValidNinjaPlayer,
    checkExtra: isValidNinjaExtra,
  });
}

/**
 * FX katmanının tek çizim sırası: pop → ring → partikül. Host motoru ve
 * client worldView AYNI fonksiyonu çağırır (host↔client aynı görünüm ilkesi).
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ pops?: any[], rings?: any[], particles?: any[] }} layer
 */
export function drawNinjaFxLayer(ctx, layer) {
  drawFxPops(ctx, layer?.pops);
  drawFxRings(ctx, layer?.rings);
  drawCircleParticles(ctx, layer?.particles);
}

// --- Ortak çizim yardımcıları (host + client) ---
export function drawNinjaArena(ctx, arena, opts = {}) {
  // Statik saha `fieldKit`'te: arduvaz tonlu zemin, plaka dokusu, seeded dekor
  // ve yuvarlatılmış tepsi kesimi. Eskiden düz `#E8E5DF` dolgu + kare konturdu.
  drawField(ctx, arena, { mode: 'NINJA', seed: hashFieldSeed('NINJA', opts.roundId) });
}

export function drawNinjaFrame(ctx, arena, obstacles) {
  // Kenar/artık `drawField`'ın bake'indedir; burada yalnız engel gövdeleri kalır.
  for (const obs of obstacles) drawObstacle(ctx, obs, { theme: 'NINJA' });
}

export function drawNinjaSteps(ctx, steps) {
  for (const { x, y, alpha } of steps || []) {
    ctx.save();
    ctx.globalAlpha = clamp01(alpha);
    ctx.fillStyle = '#9C988F';
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export function drawNinjaDecals(ctx, decals) {
  for (const cd of decals || []) {
    const maxLife = Math.max(0.001, cd.maxLife || 0.44);
    const prog = Math.min(1.0, (cd.life || 0) / maxLife);
    const headProg = Math.min(1.0, (cd.life || 0) / 0.07);
    const headDist = (1 - Math.pow(1 - headProg, 2.5)) * cd.length;
    const tailProg = Math.max(0, Math.min(1.0, Math.pow(prog, 1.25)));
    const tailDist = tailProg * cd.length;
    if (tailDist >= headDist - 1) continue;

    const segLen = headDist - tailDist;
    const midDist = (tailDist + headDist) * 0.5;
    const fadeAlpha = 1.0 - Math.pow(prog, 1.8);
    const halfWidth = (cd.maxWidth * 0.5) * (1 - prog * 0.4) * Math.min(1.0, segLen / 30);

    ctx.save();
    ctx.translate(cd.x, cd.y);
    ctx.rotate(cd.angle);

    ctx.globalAlpha = fadeAlpha * 0.35;
    ctx.fillStyle = cd.color;
    ctx.beginPath();
    ctx.moveTo(tailDist, 0);
    ctx.lineTo(midDist, -halfWidth * 2.4);
    ctx.lineTo(headDist, 0);
    ctx.lineTo(midDist, halfWidth * 2.4);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = fadeAlpha * 0.9;
    const bladeGrad = ctx.createLinearGradient(tailDist, 0, headDist, 0);
    bladeGrad.addColorStop(0, cd.color);
    bladeGrad.addColorStop(0.5, '#FFFFFF');
    bladeGrad.addColorStop(1, cd.color);
    ctx.fillStyle = bladeGrad;
    ctx.beginPath();
    ctx.moveTo(tailDist, 0);
    ctx.lineTo(midDist, -halfWidth);
    ctx.lineTo(headDist, 0);
    ctx.lineTo(midDist, halfWidth);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = fadeAlpha;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = Math.max(1.0, halfWidth * 0.7);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tailDist + 2, 0);
    ctx.lineTo(headDist - 1, 0);
    ctx.stroke();

    if (prog < 0.6) {
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(headDist, 0, Math.max(1.5, 3.5 * (1 - prog)), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

export function drawNinjaLanterns(ctx, lanterns, now = 0) {
  for (const lantern of lanterns || []) {
    const lu = (lantern.radius || 60) / 60;
    if (!lantern.active) {
      ctx.save();
      ctx.fillStyle = '#2A2A2A';
      ctx.fillRect(lantern.x - 9, lantern.y - 9, 18, 18);
      ctx.strokeStyle = '#555555';
      ctx.lineWidth = Math.max(1, 1.5 * lu);
      ctx.strokeRect(lantern.x - 9, lantern.y - 9, 18, 18);
      const emberPulse = (Math.sin(now / 160) + 1) * 0.5;
      ctx.fillStyle = `rgba(230, 57, 70, ${0.4 + emberPulse * 0.5})`;
      ctx.beginPath();
      ctx.arc(lantern.x, lantern.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      continue;
    }

    ctx.save();
    const grad = ctx.createRadialGradient(lantern.x, lantern.y, 10, lantern.x, lantern.y, lantern.radius);
    grad.addColorStop(0, 'rgba(255, 215, 0, 0.28)');
    grad.addColorStop(0.7, 'rgba(255, 215, 0, 0.12)');
    grad.addColorStop(1, 'rgba(255, 215, 0, 0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(lantern.x, lantern.y, lantern.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(217, 155, 38, 0.35)';
    ctx.lineWidth = Math.max(1, 1.5 * lu);
    ctx.setLineDash([4, 4]);
    ctx.stroke();

    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(lantern.x - 11, lantern.y - 11, 22, 22);
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.arc(lantern.x, lantern.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export function drawNinjaGhosts(ctx, ghosts) {
  for (const img of ghosts || []) {
    // Host ve kumanda client'ı bu view'i ORTAK kullanır; yarıçap host'ta
    // ölçeklenip paketle gelir, burada ikinci kez ölçeklenmez.
    const R = img.radius || NINJA_RADIUS;
    const u = R / NINJA_RADIUS;
    ctx.save();
    ctx.globalAlpha = clamp01((img.alpha || 0) * 0.7);
    ctx.translate(img.x, img.y);
    ctx.rotate(img.angle);
    ctx.fillStyle = '#1A1A1A';
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = img.color;
    ctx.lineWidth = Math.max(1, 2.0 * u);
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(R * 0.2, -3, 6, 2);
    ctx.fillRect(R * 0.2, 1, 6, 2);
    ctx.restore();
  }
}

function drawNinjaSelfGhost(ctx, player) {
  const R = player.radius || NINJA_RADIUS;
  const u = R / NINJA_RADIUS;
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = player.color;
  ctx.lineWidth = Math.max(1, 2 * u);
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.arc(player.x, player.y, R + 2 * u, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = player.color;
  ctx.beginPath();
  ctx.arc(player.x, player.y, 3 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawNinjaPlayers(ctx, players, { ghostSlots = [], withFx = true, now = 0, selfSlot = -1 } = {}) {
  // 3.3: tek görür varsa kendi avatarın T1, diğerleri T3 (−%25). opts.alpha görünmezlik
  // α'sı (aşağıda ctx.globalAlpha=player.alpha) ile ÇARPILIR — compose olur.
  const hasViewer = Number.isInteger(selfSlot) && selfSlot >= 0;
  const ghosts = new Set(Array.isArray(ghostSlots) ? ghostSlots : []);
  for (const player of players) {
    if (!isWorldEntityVisible(player)) continue;

    if ((player.alpha ?? 1) <= 0.02) {
      if (ghosts.has(player.slot ?? player.index)) drawNinjaSelfGhost(ctx, player);
      continue;
    }

    ctx.save();
    ctx.globalAlpha = clamp01(player.alpha ?? 1);
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle || 0);
    const R = player.radius || NINJA_RADIUS;
    const u = R / NINJA_RADIUS;

    // Kinetik dünya uzayında hesaplanır, gövde döndüğü için yerele çevrilir
    // (ARCHER ile aynı desen).
    const worldK = computeAvatarKineticDeformation(player, {});
    const localSquashAngle = worldK.squashAngle === null
      ? null
      : worldK.squashAngle - (player.angle || 0);

    drawGameAvatar(ctx, 0, 0, R, player, {
      facingAngle: 0,
      squashX: worldK.squashX,
      squashY: worldK.squashY,
      squashAngle: localSquashAngle,
      expression: player.strike ? 'angry' : 'normal',
      borderWidth: Math.max(1.5, 2.5 * u),
      // Dönüş view seviyesinde (`ctx.rotate(player.angle)`) yapıldığı için
      // avatarın yerel yüzü sabit; bakış da yerel uzayda kalmalı, yoksa
      // dönen çerçeveyle birlikte iki kez dönerdi. Ninja'da gövde yönü zaten
      // hedefe döndüğü için ayrı bakış hedefi yok.
      now,
      alpha: fxReadAlpha({ isSelf: hasViewer && (player.slot ?? player.index) === selfSlot, hasViewer }),
    });

    ctx.restore();

    // Vuruş + duman göstergeleri: İKİ İNCE ÇEMBER yerine iki rozet.
    // Eskisi gövde etrafında R+4/R+8 yarıçapında 1.5-3.5px yaylardı; ray
    // 1.50:1, vuruş yayı 1.91:1 ile krem zeminde okunmuyordu. İkon ayrımı:
    // kılıç = vuruş, hayalet = duman.
    // DÖNÜŞ DIŞINDA: üstteki çerçeve `player.angle` ile dönüyor; rozet dünya
    // koordinatında çizilir, yoksa oyuncu döndükçe yörüngede gezerdi.
    const hasStrike = player.strikeProg !== null && player.strikeProg !== undefined;
    const hasSmoke = player.smokeProg !== null && player.smokeProg !== undefined;
    const chipCount = (hasStrike ? 1 : 0) + (hasSmoke ? 1 : 0);
    let chipIndex = 0;
    if (hasStrike) {
      drawStatusChip(ctx, {
        x: player.x,
        y: player.y,
        radius: R,
        scale: u,
        icon: 'sword',
        progress: clamp01(player.strikeProg),
        index: chipIndex,
        count: chipCount,
      });
      chipIndex += 1;
    }
    if (hasSmoke) {
      drawStatusChip(ctx, {
        x: player.x,
        y: player.y,
        radius: R,
        scale: u,
        icon: 'ghost',
        progress: clamp01(player.smokeProg),
        index: chipIndex,
        count: chipCount,
      });
    }
  }
}

export function drawNinjaSlashes(ctx, slashes, arena = null) {
  // Sahadan gelen ölçek: dalga başına 12 px'lik kademe, aura genişliği ve
  // uç boncuğu HAM px idi — telefonda (unit ~0.5) hamle 123 px'e düşerken
  // animasyon 147 px'e uzanıyor, yani kılıç "havada" kalıyordu.
  const u = arena?.unit ?? (arena?.size ? arena.size / 952 : 1);
  for (const sw of slashes || []) {
    const maxLife = Math.max(0.001, sw.maxLife || 0.52);
    const prog = Math.min(1.0, (sw.life || 0) / maxLife);
    const fadeAlpha = Math.max(0, 1.0 - Math.pow(prog, 1.6));

    ctx.save();
    ctx.translate(sw.x, sw.y);
    ctx.rotate(sw.angle);

    for (let w = 0; w < (sw.waves || []).length; w++) {
      const wave = sw.waves[w];
      if ((sw.life || 0) < wave.delay) continue;
      const waveAge = (sw.life || 0) - wave.delay;
      const waveProg = Math.min(1.0, waveAge / (maxLife - wave.delay));
      const waveDist = (1 - Math.pow(1 - waveProg, 2.8)) * (sw.maxDist + w * 12 * u);
      const waveRadius = sw.outerRadius * wave.scale * (0.8 + waveProg * 0.4);
      const innerRadius = sw.innerRadius * wave.scale;
      const arcSpread = sw.arcSpan * (1.1 - waveProg * 0.25);
      const startAng = -arcSpread / 2;
      const endAng = arcSpread / 2;
      const currentAlpha = fadeAlpha * (1.0 - waveProg * 0.45);
      const tipR = Math.max(1.5, 4 * u);

      ctx.save();
      ctx.translate(waveDist, 0);

      ctx.globalAlpha = currentAlpha * 0.22;
      ctx.fillStyle = wave.aura;
      ctx.beginPath();
      ctx.arc(0, 0, waveRadius + 8 * u, startAng * 1.15, endAng * 1.15, false);
      ctx.arc(0, 0, Math.max(4 * u, innerRadius - 6 * u), endAng * 1.15, startAng * 1.15, true);
      ctx.closePath();
      ctx.fill();

      ctx.globalAlpha = currentAlpha * 0.95;
      const crescentGrad = ctx.createLinearGradient(0, -waveRadius, 0, waveRadius);
      crescentGrad.addColorStop(0, wave.aura);
      crescentGrad.addColorStop(0.5, '#FFFFFF');
      crescentGrad.addColorStop(1, wave.aura);
      ctx.fillStyle = crescentGrad;
      ctx.beginPath();
      ctx.arc(0, 0, waveRadius, startAng, endAng, false);
      ctx.arc(0, 0, innerRadius, endAng, startAng, true);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = '#141416';
      ctx.lineWidth = wave.width + 1.5 * u;
      ctx.stroke();

      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = wave.width;
      ctx.beginPath();
      ctx.arc(0, 0, waveRadius - 1, startAng, endAng, false);
      ctx.stroke();

      const tip1X = Math.cos(startAng) * waveRadius;
      const tip1Y = Math.sin(startAng) * waveRadius;
      const tip2X = Math.cos(endAng) * waveRadius;
      const tip2Y = Math.sin(endAng) * waveRadius;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath(); ctx.arc(tip1X, tip1Y, tipR, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(tip2X, tip2Y, tipR, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#141416';
      ctx.lineWidth = Math.max(1, 1.5 * (wave.scale ?? 1) * u);
      ctx.beginPath(); ctx.arc(tip1X, tip1Y, tipR, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(tip2X, tip2Y, tipR, 0, Math.PI * 2); ctx.stroke();

      ctx.restore();
    }

    ctx.restore();
  }
}

export function drawNinjaImpacts(ctx, impacts) {
  for (const ic of impacts || []) {
    const maxLife = Math.max(0.001, ic.maxLife || 0.35);
    const p = (ic.life || 0) / maxLife;
    const alpha = 1.0 - p;
    const span = (1 - Math.pow(1 - p, 2)) * 36;
    const u = span / 36;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.translate(ic.x, ic.y);
    ctx.rotate(ic.angle);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = Math.max(1.5, 3.5 * u);
    ctx.beginPath();
    ctx.moveTo(-span, -span * 0.6); ctx.lineTo(span, span * 0.6);
    ctx.moveTo(-span * 0.6, span); ctx.lineTo(span * 0.6, -span);
    ctx.stroke();
    ctx.strokeStyle = ic.color;
    ctx.lineWidth = Math.max(1, 2.0 * u);
    ctx.beginPath();
    ctx.moveTo(-span, -span * 0.6); ctx.lineTo(span, span * 0.6);
    ctx.moveTo(-span * 0.6, span); ctx.lineTo(span * 0.6, -span);
    ctx.stroke();
    ctx.restore();
  }
}