// Paylaşılan BOMB dünya snapshot'ı + çizim sınırı (SNAKE/ARCHER deseni).
// Yetkili host, uzak telefon client'larıyla aynı çizim yardımcılarını kullanır;
// client simülasyon/AI import etmez, yalnız salt-okunur draw + snapshot/validator alır.

import { drawPickup, drawObstacle } from '../core/arenaKit.js';
import { drawField } from '../core/fieldKit.js';
import { drawGameAvatar } from '../core/avatarInGame.js';
import { packBlast, isValidBlast, drawBlast, isWorldEntityVisible } from './worldCore.js';
import { renderEntityHUD } from '../ui/hud.js';
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
    seq: game._worldSeq,
    roundId: Number(game.roundId) || 0,
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
      color: typeof pt.color === 'string' ? pt.color : '#1A1A1A',
    })),
    scores: (game.scores || [0, 0, 0, 0]).map((s) => Number(s) || 0),
    matchDraw: game.matchDraw === true,
    roundWinner: winnerSlot(game.roundWinner),
    matchWinner: winnerSlot(game.matchWinner),
  };
}

// --- Client frame doğrulaması ---
export function isValidBombWorldFrame(frame) {
  if (!frame || frame.action !== 'WORLD_FRAME' || frame.version !== 1 || frame.mode !== 'BOMB') return false;
  if (!Number.isInteger(frame.seq) || frame.seq < 0) return false;
  if (!Number.isInteger(frame.roundId) || frame.roundId < 0) return false;
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
  return frame.players.every((p) => (
    p
    && typeof p.joined === 'boolean' && typeof p.alive === 'boolean'
    && Number.isInteger(p.slot) && p.slot >= 0 && p.slot <= 3
    && finite(p.x) && finite(p.y) && finite(p.angle) && finite(p.radius)
    && finite(p.stumble) && finite(p.immunity) && finite(p.dash) && finite(p.turbo)
    && finite(p.slip) && finite(p.slipAngle) && finite(p.cd) && finite(p.cdMax)
  ));
}

// --- Ortak çizim yardımcıları (host + client) ---
export function drawBombArena(ctx, arena, pillars, { carrier = null, bombTimer = 15, bombMaxTime = 15, seed } = {}) {
  // Statik saha katmanı (zemin gradyanı + ızgara + merkez halkaları + köşe
  // plakaları + dekor + duvar) `fieldKit` tarafından bir kez pişirilip blit
  // edilir; paket alanı eklenmez, seed `(BOMB, roundId)`'den türer.
  drawField(ctx, arena, { mode: 'BOMB', seed });

  // Taşıyıcı halkası canlı olduğu için statik katmanın DIŞINDA kalır.
  const u = arena?.unit ?? 1;

  for (const pil of pillars) {
    drawObstacle(ctx, pil, { variant: 'crate' });
  }

  if (carrier && carrier.alive !== false && Number.isFinite(carrier.x)) {
    ctx.save();
    const urgency = 1 - Math.max(0, bombTimer / Math.max(1, bombMaxTime));
    const ringRadius = carrier.radius + 18 + Math.sin(performance.now() * 0.01) * 4;
    ctx.strokeStyle = urgency > 0.6 ? '#D84727' : '#D99B26';
    ctx.lineWidth = 2.5 * u;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(carrier.x, carrier.y, ringRadius, 0, Math.PI * 2);
    ctx.stroke();
    const chLen = 8;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(carrier.x - ringRadius - chLen, carrier.y);
    ctx.lineTo(carrier.x - ringRadius + 2, carrier.y);
    ctx.moveTo(carrier.x + ringRadius - 2, carrier.y);
    ctx.lineTo(carrier.x + ringRadius + chLen, carrier.y);
    ctx.moveTo(carrier.x, carrier.y - ringRadius - chLen);
    ctx.lineTo(carrier.x, carrier.y - ringRadius + 2);
    ctx.moveTo(carrier.x, carrier.y + ringRadius - 2);
    ctx.lineTo(carrier.x, carrier.y + ringRadius + chLen);
    ctx.stroke();
    ctx.restore();
  }
}

// Patlama katmanı host↔client ortak çizimi (worldCore'da yaşar).
export function drawBombBlast(ctx, blast, arena) {
  drawBlast(ctx, blast, arena);
}

export function drawBombInk(ctx, puddles) {
  for (const puddle of puddles) {
    ctx.save();
    ctx.fillStyle = '#1A1A1A';
    ctx.beginPath();
    ctx.arc(puddle.x, puddle.y, puddle.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#333330';
    ctx.beginPath();
    ctx.arc(puddle.x - 6, puddle.y - 4, puddle.radius * 0.4, 0, Math.PI * 2);
    ctx.arc(puddle.x + 8, puddle.y + 5, puddle.radius * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export function drawBombPickups(ctx, pickups) {
  for (const pk of pickups) {
    drawPickup(ctx, { x: pk.x, y: pk.y, type: pk.type, animTime: pk.animTime, radius: pk.size || pk.radius || 15 });
  }
}

export function drawBombPlayers(ctx, players, { bombTimer = 15, bombMaxTime = 15, withFx = true, now = 0 } = {}) {
  for (const player of players) {
    if (!isWorldEntityVisible(player)) continue;
    const radius = player.radius || 36;
    // Efekt kromu yarıçapla ölçeklenir. Sabit px'ler telefonda (yarıçap
    // ~15px) halkaları gövdenin 1.4-1.8 katına, durum yazısını gövde
    // çapının %69'una ve metni 2.8 gövde yüksekliği kadar uzağa itiyordu.
    // `u`, masaüstü referans yarıçapı 36px'e göre normalize ölçektir: u=1
    // olduğunda değerler bugünküyle aynıdır.
    const u = radius / 36;
    const uMin = (v) => Math.max(1, v * u);
    ctx.save();
    ctx.translate(player.x, player.y);

    if (withFx && player.slip > 0) ctx.rotate(player.slipAngle);

    if (withFx && player.stumble > 0) {
      ctx.translate((Math.random() - 0.5) * 6 * u, (Math.random() - 0.5) * 6 * u);
      ctx.save();
      const dazeAngle = performance.now() * 0.008;
      const starR = radius + 14;
      ctx.fillStyle = '#FFDE59';
      for (let s = 0; s < 3; s++) {
        const a = dazeAngle + (s * Math.PI * 2) / 3;
        const sx = Math.cos(a) * starR;
        const sy = Math.sin(a) * (starR * 0.4) - radius - 10;
        ctx.fillRect(sx - 3, sy - 3, 6, 6);
      }
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = uMin(5.5);
      ctx.setLineDash([5 * u, 5 * u]);
      ctx.beginPath();
      ctx.arc(0, 0, radius + 6 * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#FFDE59';
      ctx.lineWidth = uMin(3.5);
      ctx.beginPath();
      ctx.arc(0, 0, radius + 6 * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#FFDE59';
      ctx.font = `900 ${uMin(10)}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(26, 26, 26, 0.9)';
      ctx.lineWidth = uMin(3);
      ctx.strokeText('SERSEM!', 0, -radius - 26 * u);
      ctx.fillText('SERSEM!', 0, -radius - 26 * u);
      ctx.restore();
    }

    if (withFx && player.immunity > 0) {
      ctx.save();
      ctx.strokeStyle = '#2D6A4F';
      ctx.lineWidth = uMin(2.5);
      ctx.setLineDash([4 * u, 4 * u]);
      ctx.beginPath();
      ctx.arc(0, 0, radius + 7 * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#2D6A4F';
      ctx.font = `900 ${uMin(10)}px "Space Grotesk", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(t('bomb.safe'), 0, -radius - 12 * u);
      ctx.restore();
    }

    const isCarrier = player.carrier === true;
    if (withFx && isCarrier) {
      const urgency = 1 - Math.max(0, bombTimer / Math.max(1, bombMaxTime));
      const pulseSpeed = 1 + urgency * 4;
      const pulseR = radius + 8 * u + Math.sin(performance.now() * 0.015 * pulseSpeed) * 4 * u;
      ctx.strokeStyle = urgency > 0.7 ? '#FFDE59' : '#D84727';
      ctx.lineWidth = uMin(urgency > 0.7 ? 4 : 3);
      ctx.beginPath();
      ctx.arc(0, 0, pulseR, 0, Math.PI * 2);
      ctx.stroke();
    }

    let currentExp = 'normal';
    if (isCarrier) currentExp = 'panic';
    else if (player.stumble > 0) currentExp = 'dizzy';
    else if (player.dash > 0) currentExp = 'angry';
    else if (player.turbo > 0) currentExp = 'wink';

    drawGameAvatar(ctx, 0, 0, radius, player, {
      facingAngle: player.angle,
      expression: currentExp,
      borderColor: player.dash > 0 ? '#FFFFFF' : '#1C1C1A',
      borderWidth: uMin(player.dash > 0 ? 4.5 : 3),
      // Bomba taşıyıcısı kaçarken gözleri kaçış yönüne bakar: gövde `angle`
      // ile döner, bakış `vx/vy`'den türetilir.
      lookAngle: (player.vx || player.vy) ? Math.atan2(player.vy || 0, player.vx || 0) : undefined,
      now,
    });

    if (withFx) {
      const cdProg = player.cd > 0
        ? 1.0 - Math.max(0, Math.min(1, player.cd / Math.max(1, player.cdMax)))
        : 1.0;
      renderEntityHUD(ctx, {
        x: 0,
        y: 0,
        radius,
        color: '#FFDE59',
        cooldownProgress: player.cd > 0 ? cdProg : null,
        stun: player.stumble > 0,
      });
    }

    if (isCarrier) {
      const bombY = -radius - 18;
      ctx.fillStyle = '#1C1C1A';
      ctx.beginPath();
      ctx.arc(0, bombY, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FAF7F2';
      ctx.lineWidth = 1.5 * u;
      ctx.stroke();
      ctx.strokeStyle = '#D84727';
      ctx.lineWidth = 2.5 * u;
      ctx.beginPath();
      ctx.moveTo(0, bombY - 10);
      ctx.quadraticCurveTo(6, bombY - 16, 4, bombY - 20);
      ctx.stroke();
      ctx.fillStyle = Math.random() > 0.5 ? '#FFDE59' : '#D84727';
      ctx.beginPath();
      ctx.arc(4, bombY - 20, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

export function drawBombParticles(ctx, particles) {
  for (const part of particles) {
    ctx.save();
    ctx.globalAlpha = clamp01(part.maxLife > 0 ? part.life / part.maxLife : 0);
    ctx.fillStyle = part.color;
    ctx.fillRect(part.x - part.size / 2, part.y - part.size / 2, part.size, part.size);
    ctx.restore();
  }
}
