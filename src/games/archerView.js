// Paylaşılan ARCHER dünya snapshot'ı + çizim sınırı (SNAKE deseni).
// Yetkili host, uzak telefon client'larıyla aynı çizim yardımcılarını kullanır;
// client bu modülden snapshot/validator + salt-okunur draw fonksiyonlarını alır,
// asla simülasyon/AI import etmez.

import { drawObstacle, drawPickup } from '../core/arenaKit.js';
import { drawGameAvatar } from '../core/avatarInGame.js';
import { drawTabletopIcon } from '../core/tabletopIcons.js';
import { isWorldEntityVisible } from './worldCore.js';

const ARCHER_RADIUS = 18;
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
      angle: round1(p.angle || 0),
      charging: !!p.charging,
      charge: round1(p.charge || 0),
      swayPhase: round1(p.swayPhase || 0),
      shield: Number(p.shield) || 0,
      stun: round1(p.stun || 0),
      reload: round1(p.reloadCooldown || 0),
      spawnProt: round1(p.spawnProt || 0),
      turbo: round1(p.turboTimer || 0),
      quickdraw: round1(p.quickdrawTimer || 0),
      multi: Math.max(0, Number(p.multiShots) || 0),
      slip: round1(p.slipTimer || 0),
    })),
    arrows: arrows.map((a) => [
      round1(a.x),
      round1(a.y),
      round1(a.vx),
      round1(a.vy),
      typeof a.color === 'string' ? a.color : FALLBACK,
    ]),
    particles: particles.slice(0, 64).map((pt) => ({
      x: round1(pt.x),
      y: round1(pt.y),
      radius: round1(pt.radius || 1),
      alpha: clamp01(pt.alpha),
      color: typeof pt.color === 'string' ? pt.color : '#1A1A1A',
    })),
    scores: (game.scores || [0, 0, 0, 0]).map((s) => Number(s) || 0),
    roundWinner: winnerSlot(game.roundWinner),
    matchWinner: winnerSlot(game.matchWinner),
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
  if (!frame.arrows.every((a) => Array.isArray(a) && a.length >= 5 && finite(a[0]) && finite(a[1]) && finite(a[2]) && finite(a[3]) && typeof a[4] === 'string')) return false;
  if (!Array.isArray(frame.players) || frame.players.length > 4) return false;
  if (!Array.isArray(frame.particles) || frame.particles.length > 64) return false;
  if (!frame.particles.every((pt) => pt && finite(pt.x) && finite(pt.y) && finite(pt.radius) && finite(pt.alpha) && typeof pt.color === 'string')) return false;
  return frame.players.every((p) => (
    p
    && typeof p.joined === 'boolean' && typeof p.alive === 'boolean'
    && Number.isInteger(p.slot) && p.slot >= 0 && p.slot <= 3
    && finite(p.x) && finite(p.y) && finite(p.angle)
    && finite(p.charge) && finite(p.swayPhase) && finite(p.stun) && finite(p.reload)
    && finite(p.spawnProt) && finite(p.turbo) && finite(p.quickdraw)
    && Number.isInteger(p.multi) && p.multi >= 0 && finite(p.slip)
  ));
}

// --- Ortak çizim yardımcıları (host + client aynı fonksiyonu çağırır) ---
export function drawArcherArena(ctx, arena, obstacles) {
  const { left, top, width, height } = arena;
  ctx.fillStyle = '#E8E5DF';
  ctx.fillRect(left, top, width, height);
  for (const obs of obstacles) drawObstacle(ctx, obs, { variant: 'stone' });
  ctx.strokeStyle = '#1A1A1A';
  ctx.lineWidth = 6;
  ctx.strokeRect(left, top, width, height);
}

export function drawArcherPickups(ctx, pickups) {
  for (const pk of pickups) {
    drawPickup(ctx, { x: pk.x, y: pk.y, type: pk.type, animTime: pk.animTime, radius: pk.size || pk.radius || 15 });
  }
}

export function drawArcherArrows(ctx, arrows) {
  for (const a of arrows) {
    const ang = Math.atan2(a.vy || 0, a.vx || 0);
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(ang);
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(10, 0);
    ctx.stroke();
    ctx.fillStyle = a.color || FALLBACK;
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(6, -5);
    ctx.lineTo(6, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

export function drawArcherPlayers(ctx, players, { showFx = false } = {}) {
  for (const player of players) {
    if (!isWorldEntityVisible(player)) continue;
    const slotIndex = (player.slot ?? player.index) ?? 0;
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle || 0);

    if (showFx && player.charging) {
      const aim = Math.sin(player.swayPhase || 0) * (0.03 + 0.12 * (1 - (player.charge || 0)));
      ctx.save();
      ctx.rotate(aim);
      ctx.strokeStyle = player.charge >= 1 ? '#8B5CF6' : 'rgba(26,26,26,0.35)';
      ctx.lineWidth = player.charge >= 1 ? 3 : 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(ARCHER_RADIUS + 8, 0);
      ctx.lineTo(ARCHER_RADIUS + 60 + (player.charge || 0) * 90, 0);
      ctx.stroke();
      ctx.restore();
    }

    if (showFx) {
      ctx.save();
      ctx.strokeStyle = player.charging ? '#8B5CF6' : 'rgba(26,26,26,0.45)';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(0, 0, ARCHER_RADIUS + 6, -1.1, 1.1);
      ctx.stroke();
      if (player.charging) {
        ctx.fillStyle = '#8B5CF6';
        ctx.beginPath();
        ctx.arc(ARCHER_RADIUS + 6, 0, 3 + (player.charge || 0) * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      if ((player.shield || 0) > 0) {
        ctx.strokeStyle = '#06B6D4';
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.arc(0, 0, ARCHER_RADIUS + 11, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if ((player.spawnProt || 0) > 0) {
        ctx.strokeStyle = '#8B5CF6';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.arc(0, 0, ARCHER_RADIUS + 15, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    const stun = (player.stun || 0) > 0;
    drawGameAvatar(ctx, 0, 0, ARCHER_RADIUS, player, {
      color: stun ? '#9C988F' : (player.color || FALLBACK),
      facingAngle: 0,
      label: `P${slotIndex + 1}`,
      expression: player.charging ? 'angry' : (stun ? 'dizzy' : 'normal'),
      showPointer: true,
      borderColor: '#1A1A1A',
      borderWidth: 2.5,
    });

    const activeEffects = [
      ['zap', player.turbo ?? player.turboTimer],
      ['rotate-cw', player.quickdraw ?? player.quickdrawTimer],
      ['target', player.multi ?? player.multiShots],
      ['wind', player.slip ?? player.slipTimer],
    ].filter(([, value]) => Number(value) > 0);
    activeEffects.forEach(([icon, value], index) => {
      drawTabletopIcon(ctx, icon, (index - (activeEffects.length - 1) / 2) * 16, -ARCHER_RADIUS - 20, 12, {
        color: index % 2 === 0 ? '#D99B26' : '#8B5CF6',
        accentColor: '#D99B26',
        strokeWidth: 2,
      });
    });

    const reload = Number(player.reload) || Number(player.reloadCooldown) || 0;
    if (reload > 0) {
      const cdProg = 1.0 - Math.max(0, Math.min(1, reload / 0.8));
      ctx.save();
      ctx.strokeStyle = 'rgba(26, 26, 26, 0.45)';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(0, 0, ARCHER_RADIUS + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#8B5CF6';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, ARCHER_RADIUS + 5, -Math.PI / 2, -Math.PI / 2 + cdProg * Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }
}

export function drawArcherParticles(ctx, particles) {
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = clamp01(p.alpha);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
