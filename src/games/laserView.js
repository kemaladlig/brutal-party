// Paylaşılan LASER dünya snapshot'ı + çizim sınırı (worldCore deseni).
// Yetkili host, uzak telefon client'larıyla aynı çizim yardımcılarını kullanır;
// client simülasyon/AI import etmez, yalnız salt-okunur draw + snapshot/validator alır.
// Not: nişan önizleme çizgileri host'un saf `traceAim` raycast'inden snapshot'a
// taşınır (client raycast çalıştırmaz); sayaç filigranı host HUD'udur.

import { drawPickup } from '../core/arenaKit.js';
import { drawGameAvatar } from '../core/avatarInGame.js';
import { getFireCooldownProgress, getFireFeedbackForRender, getFireFeedbackSnapshot, isValidFireFeedbackSnapshot } from '../core/fireFeedback.js';
import { renderEntityHUD, renderFireCooldown } from '../ui/hud.js';
import {
  round1,
  packRectList,
  createWorldSnapshot,
  isValidWorldBase,
  isWorldEntityVisible,
} from './worldCore.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const round2 = (v) => Math.round(Number(v) * 100) / 100;
const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

/**
 * Tek-kaynak oyuncu eşlemesi: host render + snapshot aynı fonksiyonu kullanır.
 * @param {array} players - ham host oyuncuları
 * @param {array} lasers - ham host lazerleri (aktif sayımı için)
 * @param {object} tuning - { maxActive, maxAmmo, maxHp, reloadTime, dashCd }
 * @param {function} aimOf - (p) => [{x,y}...] nişan pol çizgisi (host traceAim)
 * @param {boolean} withAim - PLAYING dışı sahnelerde aim çizilmez
 */
export function mapLaserPlayers(players, lasers, tuning = {}, aimOf = null, withAim = false) {
  const t = {
    maxActive: tuning.maxActive ?? 3,
    maxAmmo: tuning.maxAmmo ?? 2,
    maxHp: tuning.maxHp ?? 3,
    reloadTime: tuning.reloadTime ?? 0.9,
    dashCd: tuning.dashCd ?? 4,
    shotInterval: tuning.shotInterval ?? 0.22,
  };
  return (Array.isArray(players) ? players : []).map((p) => {
    let active = 0;
    for (const lz of lasers || []) if (lz.owner === p.index) active++;
    const ready = (p.ammo > 0) && (p.shotCooldown <= 0) && (active < t.maxActive);
    const reloadDuration = (p.fastTimer || 0) > 0 ? t.reloadTime * 0.5 : t.reloadTime;
    return {
      slot: p.index,
      joined: p.isJoined !== false,
      alive: p.isAlive !== false,
      x: round1(p.x || 0),
      y: round1(p.y || 0),
      // Gövde yarıçapı host'ta ölçeklenir ve paketle taşınır.
      radius: round1(p.radius || 19),
      angle: round1(p.angle || 0),
      color: p.color,
      hp: Number(p.hp) || 0,
      hpMax: t.maxHp,
      ammo: Number(p.ammo) || 0,
      ammoMax: t.maxAmmo,
      reload: round2((p.reloadTimer || 0) > 0
        ? Math.max(0, Math.min(1, 1 - (p.reloadTimer || 0) / reloadDuration)) : 1),
      dash: round2(1 - Math.max(0, (p.dashCooldown || 0) / t.dashCd)),
      fireCooldown: round2(getFireCooldownProgress(p, p.fireCooldownMax || t.shotInterval)),
      fireFeedback: getFireFeedbackSnapshot(p),
      shield: p.shield === true,
      triple: (p.tripleTimer || 0) > 0,
      fast: (p.fastTimer || 0) > 0,
      invuln: (p.invulnTimer || 0) > 0,
      respawning: (p.respawnTimer || 0) > 0,
      aiming: p.isAiming === true,
      ready,
      aim: withAim && p.isJoined && p.isAlive && typeof aimOf === 'function'
        ? (aimOf(p) || []).slice(0, 8).map((pt) => [round1(pt.x), round1(pt.y)])
        : [],
    };
  });
}

// --- Snapshot serializer (host tarafı, deklaratif extras) ---
export function createLaserWorldPacket(game, tuning = {}) {
  if (!game) return null;
  const withAim = game.state === 'PLAYING';
  return createWorldSnapshot(game, {
    mode: 'LASER',
    mapPlayer: (p) => mapLaserPlayers([p], game.lasers, tuning, (pl) => game.traceAim(pl), withAim)[0],
    extras: {
      matchDraw: game.matchDraw === true,
      timeLeft: round1(game.matchTimer || 0),
      obstacles: packRectList(game.obstacles, 16),
      walls: (Array.isArray(game.movingWalls) ? game.movingWalls : []).slice(0, 4).map((mw, index) => ({
        id: Number.isInteger(mw.id) ? mw.id : index + 1,
        x: round1(mw.x), y: round1(mw.y),
        w: round1(mw.w), h: round1(mw.h),
        axis: mw.axis === 'y' ? 'y' : 'x',
        minX: round1(mw.minX ?? mw.x), maxX: round1(mw.maxX ?? mw.x),
        minY: round1(mw.minY ?? mw.y), maxY: round1(mw.maxY ?? mw.y),
      })),
      pickups: (Array.isArray(game.pickups) ? game.pickups : []).slice(0, 8).map((pk) => [
        round1(pk.x), round1(pk.y), pk.type || 'SHIELD', round1(pk.animTime || 0), round1(pk.size || 30),
      ]),
      lasers: (Array.isArray(game.lasers) ? game.lasers : []).slice(0, 12).map((lz, index) => ({
        id: Number.isInteger(lz.id) ? lz.id : index + 1,
        x: round1(lz.x), y: round1(lz.y),
        color: typeof lz.color === 'string' ? lz.color : '#D84727',
        trail: (Array.isArray(lz.history) ? lz.history : []).slice(-12).map((h) => [round1(h.x), round1(h.y)]),
      })),
      texts: (Array.isArray(game.floatingTexts) ? game.floatingTexts : []).slice(0, 8).map((ft) => ({
        x: round1(ft.x), y: round1(ft.y),
        text: String(ft.text || '').slice(0, 24),
        alpha: clamp01(ft.alpha ?? 1),
        color: typeof ft.color === 'string' ? ft.color : '#1A1A1A',
      })),
    },
  });
}

function isValidLaserPlayer(p) {
  return typeof p.joined === 'boolean' && typeof p.alive === 'boolean'
    && finite(p.angle) && Number.isInteger(p.hp) && p.hp >= 0 && Number.isInteger(p.hpMax)
    && Number.isInteger(p.ammo) && p.ammo >= 0 && Number.isInteger(p.ammoMax)
    && finite(p.reload) && p.reload >= 0 && p.reload <= 1
    && finite(p.dash) && p.dash >= 0 && p.dash <= 1
    && finite(p.fireCooldown) && p.fireCooldown >= 0 && p.fireCooldown <= 1
    && isValidFireFeedbackSnapshot(p.fireFeedback)
    && typeof p.shield === 'boolean' && typeof p.triple === 'boolean'
    && typeof p.fast === 'boolean' && typeof p.invuln === 'boolean' && typeof p.respawning === 'boolean'
    && typeof p.aiming === 'boolean' && typeof p.ready === 'boolean'
    && Array.isArray(p.aim) && p.aim.length <= 8
    // radius opsiyoneldir (eski host paketleri) ama varsa pozitif olmalı.
    && (p.radius === undefined || (finite(p.radius) && p.radius > 0))
    && p.aim.every((pt) => Array.isArray(pt) && pt.length === 2 && finite(pt[0]) && finite(pt[1]));
}

function isValidLaserExtra(frame) {
  if (typeof frame.matchDraw !== 'boolean' || !finite(frame.timeLeft) || frame.timeLeft < 0) return false;
  if (!Array.isArray(frame.obstacles) || frame.obstacles.length > 16) return false;
  if (!frame.obstacles.every((r) => Array.isArray(r) && r.length === 4 && r.every(finite))) return false;
  if (!Array.isArray(frame.walls) || frame.walls.length > 4) return false;
  if (!frame.walls.every((w) => w && (w.id === undefined || (Number.isInteger(w.id) && w.id >= 0))
    && finite(w.x) && finite(w.y) && finite(w.w) && finite(w.h)
    && (w.axis === 'x' || w.axis === 'y')
    && finite(w.minX) && finite(w.maxX) && finite(w.minY) && finite(w.maxY))) return false;
  if (!Array.isArray(frame.pickups) || frame.pickups.length > 8) return false;
  if (!frame.pickups.every((pk) => Array.isArray(pk) && pk.length === 5
    && finite(pk[0]) && finite(pk[1]) && typeof pk[2] === 'string' && finite(pk[3]) && finite(pk[4]))) return false;
  if (!Array.isArray(frame.lasers) || frame.lasers.length > 12) return false;
  if (!frame.lasers.every((lz) => lz && (lz.id === undefined || (Number.isInteger(lz.id) && lz.id >= 0))
    && finite(lz.x) && finite(lz.y) && typeof lz.color === 'string'
    && Array.isArray(lz.trail) && lz.trail.length <= 12
    && lz.trail.every((h) => Array.isArray(h) && h.length === 2 && finite(h[0]) && finite(h[1])))) return false;
  if (!Array.isArray(frame.texts) || frame.texts.length > 8) return false;
  if (!frame.texts.every((ft) => ft && finite(ft.x) && finite(ft.y) && typeof ft.text === 'string'
    && finite(ft.alpha) && typeof ft.color === 'string')) return false;
  return true;
}

// --- Client frame doğrulaması ---
export function isValidLaserWorldFrame(frame) {
  return isValidWorldBase(frame, 'LASER', {
    checkPlayer: isValidLaserPlayer,
    checkExtra: isValidLaserExtra,
  });
}

// --- Ortak çizim yardımcıları (host + client) ---
export function drawLaserArena(ctx, arena, obstacles, walls) {
  const { left, top, right, bottom, width, height } = arena;
  const u = arena?.unit ?? (width ? width / 952 : 1);

  ctx.fillStyle = '#FAF7F2';
  ctx.fillRect(left, top, width, height);

  ctx.strokeStyle = '#E8E2D8';
  ctx.lineWidth = Math.max(1, 1.5 * u);
  ctx.strokeRect(left + width * 0.12, top + height * 0.12, width * 0.76, height * 0.76);

  const bLen = Math.max(16, Math.round(Math.min(width, height) * 0.05));
  ctx.strokeStyle = '#2B2B28';
  ctx.lineWidth = Math.max(1.5, 3 * u);
  const cornerPlates = [
    [[left, top + bLen], [left, top], [left + bLen, top]],
    [[right - bLen, top], [right, top], [right, top + bLen]],
    [[left, bottom - bLen], [left, bottom], [left + bLen, bottom]],
    [[right - bLen, bottom], [right, bottom], [right, bottom - bLen]],
  ];
  for (const [[x1, y1], [x2, y2], [x3, y3]] of cornerPlates) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.stroke();
  }

  for (const obs of obstacles) {
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(obs.x + 4, obs.y + 4, obs.w, obs.h);
    ctx.fillStyle = '#262624';
    ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = Math.max(1.5, 2.5 * u);
    ctx.strokeRect(obs.x, obs.y, obs.w, obs.h);
    ctx.strokeStyle = '#5A5A52';
    ctx.lineWidth = Math.max(1, 1.5 * u);
    ctx.beginPath();
    ctx.moveTo(obs.x + 2, obs.y + obs.h - 2);
    ctx.lineTo(obs.x + 2, obs.y + 2);
    ctx.lineTo(obs.x + obs.w - 2, obs.y + 2);
    ctx.stroke();
    if (obs.w >= 28 && obs.h >= 28) {
      ctx.strokeStyle = '#3A3A34';
      ctx.lineWidth = Math.max(1, 1.5 * u);
      ctx.beginPath();
      ctx.moveTo(obs.x + 6, obs.y + 6);
      ctx.lineTo(obs.x + obs.w - 6, obs.y + obs.h - 6);
      ctx.moveTo(obs.x + obs.w - 6, obs.y + 6);
      ctx.lineTo(obs.x + 6, obs.y + obs.h - 6);
      ctx.stroke();
    }
  }

  for (const mw of walls) {
    ctx.save();
    ctx.strokeStyle = 'rgba(26, 26, 26, 0.22)';
    ctx.lineWidth = Math.max(1, 2 * u);
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    if (mw.axis === 'y') {
      const midX = mw.x + mw.w / 2;
      ctx.moveTo(midX, mw.minY);
      ctx.lineTo(midX, mw.maxY + mw.h);
    } else {
      const midY = mw.y + mw.h / 2;
      ctx.moveTo(mw.minX, midY);
      ctx.lineTo(mw.maxX + mw.w, midY);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#262626';
    ctx.fillRect(mw.x, mw.y, mw.w, mw.h);
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = Math.max(1, 2 * u);
    ctx.strokeRect(mw.x, mw.y, mw.w, mw.h);
    ctx.fillStyle = '#EAB308';
    if (mw.axis === 'y') {
      ctx.fillRect(mw.x + 2, mw.y + mw.h * 0.3, mw.w - 4, mw.h * 0.4);
    } else {
      ctx.fillRect(mw.x + mw.w * 0.3, mw.y + 2, mw.w * 0.4, mw.h - 4);
    }
    ctx.restore();
  }

  ctx.strokeStyle = '#1A1A1A';
  ctx.lineWidth = Math.max(2, 6 * u);
  ctx.strokeRect(left, top, width, height);
}

export function drawLaserPickups(ctx, pickups) {
  for (const pk of pickups) {
    const size = pk.size || 30;
    drawPickup(ctx, { x: pk.x, y: pk.y, type: pk.type, animTime: pk.animTime ?? pk.anim ?? 0, radius: size / 2 }, { size });
  }
}

export function drawLaserAims(ctx, players) {
  ctx.save();
  for (const player of players) {
    if (!isWorldEntityVisible(player)) continue;
    const pts = player.aim || [];
    if (pts.length === 0) continue;
    const u = (player.radius || 19) / 19;
    ctx.strokeStyle = player.color;
    if (player.aiming) {
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = Math.max(1.5, 3.5 * u);
      ctx.setLineDash([8, 4]);
    } else {
      ctx.globalAlpha = player.ready ? 0.55 : 0.3;
      ctx.lineWidth = Math.max(1, (player.ready ? 2.2 : 1.6) * u);
      ctx.setLineDash(player.ready ? [6, 4] : [2, 6]);
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (pts.length > 1) {
      ctx.fillStyle = player.color;
      for (let i = 1; i < pts.length - 1; i++) {
        ctx.beginPath(); ctx.arc(pts[i][0], pts[i][1], player.aiming ? 4.5 * u : 3 * u, 0, Math.PI * 2); ctx.fill();
      }
      if (player.aiming) {
        const endPt = pts[pts.length - 1];
        ctx.strokeStyle = '#1A1A1A';
        ctx.lineWidth = Math.max(1.5, 3.5 * u);
        ctx.beginPath();
        ctx.arc(endPt[0], endPt[1], 5 * u, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = Math.max(1, 1.5 * u);
        ctx.beginPath();
        ctx.arc(endPt[0], endPt[1], 5 * u, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

export function drawLaserShots(ctx, lasers) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const laser of lasers || []) {
    ctx.lineWidth = Math.max(2, 5 * (laser.radius ? laser.radius / 3 : 1));
    ctx.strokeStyle = laser.color;
    ctx.beginPath();
    const trail = laser.trail || [];
    if (trail.length > 0) {
      ctx.moveTo(trail[0][0], trail[0][1]);
      for (let i = 1; i < trail.length; i++) ctx.lineTo(trail[i][0], trail[i][1]);
    }
    ctx.lineTo(laser.x, laser.y);
    ctx.stroke();
    ctx.fillStyle = '#FFF';
    ctx.beginPath(); ctx.arc(laser.x, laser.y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = Math.max(1, 1.5 * (laser.radius ? laser.radius / 3 : 1));
    ctx.stroke();
  }
}

export function drawLaserPlayers(ctx, players, { arena = null, withFx = true } = {}) {
  const blink = Math.floor(performance.now() / 120) % 2 === 0;
  for (const player of players) {
    if (!isWorldEntityVisible(player)) continue;
    if (withFx && player.invuln && !player.respawning && blink) continue;

    // Gövde yarıçapı host'ta ölçeklenir ve paketle gelir; bu view host VE
    // kumanda client'ı tarafından ortak kullanıldığı için yeniden ölçeklenmez.
    // Tasarım referansı 19px: R=19'da değerler bugünküyle aynıdır.
    const R = player.radius || 19;
    const u = R / 19;
    const uMin = (v) => Math.max(1, v * u);

    ctx.save();
    ctx.translate(player.x, player.y);

    if (player.shield) {
      ctx.save();
      ctx.strokeStyle = '#0EA5E9';
      ctx.lineWidth = uMin(2.5);
      ctx.fillStyle = 'rgba(14, 165, 233, 0.18)';
      ctx.beginPath(); ctx.arc(0, 0, R + 5 * u, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (withFx) {
        const sAng = (performance.now() / 1000) * 3;
        ctx.fillStyle = '#38BDF8';
        ctx.beginPath(); ctx.arc(Math.cos(sAng) * (R + 5 * u), Math.sin(sAng) * (R + 5 * u), uMin(3.5), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    if (player.dash >= 1) {
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = uMin(5);
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = uMin(2.5);
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.lineWidth = uMin(3);
      ctx.strokeStyle = 'rgba(26, 26, 26, 0.25)';
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = player.color;
      ctx.beginPath(); ctx.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + clamp01(player.dash) * Math.PI * 2); ctx.stroke();
    }

    let barrelColor = '#FFFFFF';
    if (player.triple) barrelColor = '#F97316';
    else if (player.fast) barrelColor = '#FFDE59';
    else if (!player.ready) barrelColor = '#525252';

    ctx.save();
    ctx.rotate(player.angle || 0);
    ctx.fillStyle = barrelColor;
    ctx.fillRect(8 * u, -4 * u, 14 * u, 8 * u);
    ctx.lineWidth = uMin(2); ctx.strokeStyle = '#1A1A1A';
    ctx.strokeRect(8 * u, -4 * u, 14 * u, 8 * u);
    if (player.ready) {
      ctx.fillStyle = player.triple ? '#F97316' : (player.fast ? '#FFDE59' : '#00F0FF');
      ctx.beginPath(); ctx.arc(22 * u, 0, 3 * u, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    let currentExp = 'normal';
    if (player.invuln) currentExp = 'dizzy';
    else if (player.triple || player.fast) currentExp = 'excited';
    else if (player.hp === 1) currentExp = 'panic';

    drawGameAvatar(ctx, 0, 0, R * 0.74, player, {
      color: player.color,
      slotIndex: player.slot ?? player.index,
      facingAngle: player.angle || 0,
      label: `P${(player.slot ?? player.index ?? 0) + 1}`,
      expression: currentExp,
      showPointer: false,
      borderWidth: uMin(3),
      shadowOffset: 2 * u,
    });

    ctx.restore();

    const bulletColor = player.triple ? '#FB923C' : (player.fast ? '#FACC15' : player.color);
    renderEntityHUD(ctx, {
      x: player.x,
      y: player.y,
      radius: R,
      color: bulletColor,
      arena,
      hp: player.hp,
      maxHp: player.hpMax,
      ammo: player.ammo,
      maxAmmo: player.ammoMax,
      reloadProgress: player.reload,
      cooldownProgress: player.dash,
    });
    renderFireCooldown(ctx, {
      x: player.x,
      y: player.y,
      radius: R,
      progress: player.fireCooldown,
      feedback: getFireFeedbackForRender(player),
      color: bulletColor,
    });
  }
}

