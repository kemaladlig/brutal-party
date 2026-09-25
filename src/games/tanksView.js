// Paylaşılan TANKS dünya snapshot'ı + çizim sınırı (worldCore deseni).
// Yetkili host, uzak telefon client'larıyla aynı çizim yardımcılarını kullanır;
// client simülasyon/AI import etmez, yalnız salt-okunur draw + snapshot/validator alır.
// Not: spawn beacon'ları (2 sn'lik giriş efekti) ile sudden-death hapı host HUD'udur,
// world snapshot'ına girmez — client tankları belirdiği anda görür.

import { drawPickup } from '../core/arenaKit.js';
import { drawBrutalAvatar } from '../ui/characterRenderer.js';
import { renderEntityHUD } from '../ui/hud.js';
import {
  round1,
  packRectList,
  createWorldSnapshot,
  isValidWorldBase,
  isWorldEntityVisible,
} from './worldCore.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// --- Snapshot serializer (host tarafı, deklaratif extras) ---
export function createTanksWorldPacket(game) {
  if (!game) return null;
  return createWorldSnapshot(game, {
    mode: 'TANKS',
    list: game.tanks,
    mapPlayer: (tk) => ({
      slot: tk.index,
      joined: tk.isJoined !== false,
      alive: tk.isAlive !== false,
      x: round1(tk.x || 0),
      y: round1(tk.y || 0),
      angle: round1(tk.angle || 0),
      size: round1(tk.size || 20),
      driving: tk.isDriving === true,
      muzzle: round1(tk.muzzleFlashTimer || 0),
      bot: tk.slotType === 'bot_normal' || tk.slotType === 'bot_god',
      god: tk.slotType === 'bot_god',
      shield: tk.hasShield === true,
      eshield: tk.shield === true,
      stun: (tk.stunTimer || 0) > 0,
      chamber: Math.max(0, Number(tk.chamber ?? tk.maxBullets ?? 2) || 0),
      maxAmmo: Math.max(1, Number(tk.maxBullets) || 2),
      reload: round1(tk.reloadTimer || 0),
      reloadCd: round1(tk.reloadCooldown || 1.1),
      triple: tk.hasTripleShot === true,
    }),
    extras: {
      obstacles: packRectList(game.obstacles, 24),
      bullets: (Array.isArray(game.bullets) ? game.bullets : []).slice(0, 24).map((b, index) => [
        round1(b.x), round1(b.y), round1(b.radius || 4.5), b.owner,
        round1(b.vx || 0), round1(b.vy || 0),
        Number.isInteger(b.id) ? b.id : index + 1,
      ]),
      tracers: (Array.isArray(game.shotTracers) ? game.shotTracers : []).slice(0, 16).map((tr) => ({
        x1: round1(tr.x1),
        y1: round1(tr.y1),
        x2: round1(tr.x2),
        y2: round1(tr.y2),
        life: round1(tr.life || 0),
        color: typeof tr.color === 'string' ? tr.color : '#1A1A1A',
      })),
      crates: (Array.isArray(game.crates) ? game.crates : []).slice(0, 8).map((c) => [
        round1(c.x), round1(c.y), round1(c.size || 22), c.type || 'SHIELD',
      ]),
      suddenDeath: {
        active: game.suddenDeath === true,
        x: round1(game.arena?.cx || 0),
        y: round1(game.arena?.cy || 0),
        radius: round1(game.suddenDeathRadius || 0),
      },
      intro: {
        active: (game.spawnIntroTimer || 0) > 0,
        time: round1(game.spawnIntroTimer || 0),
      },
    },
  });
}

function isValidTanksPlayer(p) {
  return typeof p.joined === 'boolean' && typeof p.alive === 'boolean'
    && finite(p.angle) && finite(p.size)
    && typeof p.driving === 'boolean' && finite(p.muzzle)
    && typeof p.bot === 'boolean' && typeof p.god === 'boolean'
    && typeof p.shield === 'boolean' && typeof p.eshield === 'boolean' && typeof p.stun === 'boolean'
    && Number.isInteger(p.chamber) && Number.isInteger(p.maxAmmo)
    && finite(p.reload) && finite(p.reloadCd) && typeof p.triple === 'boolean';
}

function isValidTanksExtra(frame) {
  if (!Array.isArray(frame.obstacles) || frame.obstacles.length > 24) return false;
  if (!frame.obstacles.every((r) => Array.isArray(r) && r.length === 4 && r.every(finite))) return false;
  if (!Array.isArray(frame.bullets) || frame.bullets.length > 24) return false;
  if (!frame.bullets.every((b) => {
    if (!Array.isArray(b) || (b.length !== 4 && b.length !== 7)) return false;
    if (!finite(b[0]) || !finite(b[1]) || !finite(b[2])) return false;
    if (!Number.isInteger(b[3]) || b[3] < 0 || b[3] > 3) return false;
    return b.length === 4 || (finite(b[4]) && finite(b[5]) && Number.isInteger(b[6]) && b[6] >= 0);
  })) return false;
  if (!Array.isArray(frame.tracers) || frame.tracers.length > 16) return false;
  if (!frame.tracers.every((tr) => tr && finite(tr.x1) && finite(tr.y1)
    && finite(tr.x2) && finite(tr.y2) && finite(tr.life) && typeof tr.color === 'string')) return false;
  if (!Array.isArray(frame.crates) || frame.crates.length > 8) return false;
  if (!frame.crates.every((c) => Array.isArray(c) && c.length === 4
    && finite(c[0]) && finite(c[1]) && finite(c[2]) && typeof c[3] === 'string')) return false;
  // v1 frames from pre-Batch 1 clients may omit the new optional overlays.
  if (frame.suddenDeath !== undefined) {
    const sd = frame.suddenDeath;
    if (!sd || typeof sd.active !== 'boolean' || !finite(sd.x) || !finite(sd.y) || !finite(sd.radius) || sd.radius < 0) return false;
  }
  if (frame.intro !== undefined) {
    const intro = frame.intro;
    if (!intro || typeof intro.active !== 'boolean' || !finite(intro.time) || intro.time < 0) return false;
  }
  return true;
}

// --- Client frame doğrulaması ---
export function isValidTanksWorldFrame(frame) {
  return isValidWorldBase(frame, 'TANKS', {
    checkPlayer: isValidTanksPlayer,
    checkExtra: isValidTanksExtra,
  });
}

// --- Ortak çizim yardımcıları (host + client) ---
export function drawTanksArena(ctx, arena, obstacles, suddenDeath = null) {
  const { left, top, right, bottom, width, height, size, cx, cy } = arena;

  ctx.fillStyle = '#FAF7F2';
  ctx.fillRect(left, top, width, height);

  ctx.strokeStyle = '#E5E0D6';
  ctx.lineWidth = 1.5;
  const gridStep = size / 6;
  for (let x = left + gridStep; x < right; x += gridStep) {
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
  }
  for (let y = top + gridStep; y < bottom; y += gridStep) {
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  }

  ctx.strokeStyle = '#DDD7CC';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.15, 0, Math.PI * 2);
  ctx.stroke();

  if (suddenDeath?.active && suddenDeath.radius > 0) {
    ctx.save();
    ctx.fillStyle = 'rgba(216, 71, 39, 0.12)';
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.arc(suddenDeath.x, suddenDeath.y, suddenDeath.radius, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#D84727';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.arc(suddenDeath.x, suddenDeath.y, suddenDeath.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  const bLen = Math.max(16, Math.round(size * 0.05));
  ctx.strokeStyle = '#2B2B28';
  ctx.lineWidth = 3;
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
    ctx.fillStyle = '#2B2B28';
    ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(obs.x, obs.y, obs.w, obs.h);
    ctx.strokeStyle = '#5E5E58';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(obs.x + 2, obs.y + obs.h - 2);
    ctx.lineTo(obs.x + 2, obs.y + 2);
    ctx.lineTo(obs.x + obs.w - 2, obs.y + 2);
    ctx.stroke();
    if (obs.w >= 28 && obs.h >= 28) {
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 2;
      const pad = 6;
      ctx.strokeRect(obs.x + pad, obs.y + pad, obs.w - pad * 2, obs.h - pad * 2);
      ctx.fillStyle = '#D99B26';
      ctx.beginPath();
      ctx.arc(obs.x + obs.w / 2, obs.y + obs.h / 2, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.fillStyle = '#1A1A1A';
  ctx.fillRect(right, top + 6, 6, height);
  ctx.fillRect(left + 6, bottom, width, 6);
  ctx.strokeStyle = '#1A1A1A';
  ctx.lineWidth = 6;
  ctx.strokeRect(left, top, width, height);
}

export function drawTanksBullets(ctx, bullets, ownerColors) {
  for (const b of bullets) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#1A1A1A';
    ctx.fill();
    const ownerColor = ownerColors?.[b.owner];
    if (ownerColor) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = ownerColor;
      ctx.fill();
    }
  }
}

export function drawTanksTracers(ctx, tracers) {
  for (const tracer of tracers || []) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, (tracer.life || 0) / 0.12));
    ctx.strokeStyle = tracer.color || '#1A1A1A';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(tracer.x1, tracer.y1);
    ctx.lineTo(tracer.x2, tracer.y2);
    ctx.stroke();
    ctx.restore();
  }
}

export function drawTanksCrates(ctx, crates) {
  for (const crate of crates) {
    drawPickup(ctx, { x: crate.x, y: crate.y, type: crate.type, animTime: 0, radius: (crate.size || 22) / 2 }, { size: crate.size || 22 });
  }
}

function tankAmmoVisual(tank) {
  const max = tank.maxAmmo ?? tank.maxBullets ?? 2;
  const chamber = Math.max(0, Math.min(max, tank.chamber ?? max));
  const reloadLeft = tank.reload ?? tank.reloadTimer ?? 0;
  const reloadTotal = tank.reloadCd ?? tank.reloadCooldown ?? 1.1;
  const isReloading = reloadLeft > 0 && chamber < max;
  const progress = isReloading
    ? Math.max(0, Math.min(1, 1 - reloadLeft / reloadTotal))
    : 0;
  return { readyCount: chamber, progress };
}

/** Şarjör görseli (host tank objesi + world snapshot ikisini de okur; 8 Hz paketle aynı kaynak). */
export function getTankAmmoVisual(tank) {
  return tankAmmoVisual(tank);
}

export function drawTanksTanks(ctx, tanks, { arena = null, withFx = true } = {}) {
  for (const tank of tanks) {
    if (!isWorldEntityVisible(tank)) continue;
    const s = tank.size || 20;

    ctx.save();
    ctx.translate(tank.x, tank.y);
    ctx.rotate(tank.angle || 0);

    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(-s / 2 - 3, -s / 2, 5, s);
    ctx.fillRect(s / 2 - 2, -s / 2, 5, s);

    ctx.fillStyle = tank.color;
    ctx.fillRect(-s / 2 + 2, -s / 2 + 2, s - 4, s - 4);
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(-s / 2 + 2, -s / 2 + 2, s - 4, s - 4);

    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(0, -3.5, s * 0.78, 7);

    ctx.save();
    drawBrutalAvatar(ctx, 0, 0, s * 0.32, {
      color: tank.color,
      slotIndex: tank.slot ?? tank.index,
      slotType: tank.god ? 'bot_god' : tank.bot ? 'bot_normal' : 'human',
      isBot: !!tank.bot,
      isGodBot: !!tank.god,
      facingAngle: 0,
      expression: tank.driving ? 'FOCUS' : 'normal',
      showPointer: false,
      borderWidth: 1.8,
      shadowOffset: 1,
    });
    ctx.restore();

    ctx.restore();

    if (withFx && (tank.muzzle || 0) > 0) {
      ctx.save();
      ctx.translate(tank.x, tank.y);
      ctx.rotate(tank.angle || 0);
      ctx.globalAlpha = Math.max(0, Math.min(1, (tank.muzzle || 0) / 0.12));
      ctx.fillStyle = '#FFDE59';
      ctx.beginPath();
      ctx.moveTo(s * 0.72, 0);
      ctx.lineTo(s * 0.38, -s * 0.2);
      ctx.lineTo(s * 0.38, s * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    if (tank.shield) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(tank.x, tank.y, s * 0.92, 0, Math.PI * 2);
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.restore();
    }

    const v = tankAmmoVisual(tank);
    renderEntityHUD(ctx, {      x: tank.x,
      y: tank.y,
      radius: s,
      color: tank.triple ? '#FFDE59' : tank.color,
      arena,
      ammo: v.readyCount,
      maxAmmo: tank.maxAmmo || 2,
      reloadProgress: v.progress,
      shield: !!tank.eshield,
      stun: !!tank.stun,
    });
  }
}
