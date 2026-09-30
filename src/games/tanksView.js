// Paylaşılan TANKS dünya snapshot'ı + çizim sınırı (worldCore deseni).
// Yetkili host, uzak telefon client'larıyla aynı çizim yardımcılarını kullanır;
// client simülasyon/AI import etmez, yalnız salt-okunur draw + snapshot/validator alır.
// Not: spawn beacon'ları (2 sn'lik giriş efekti) ile sudden-death hapı host HUD'udur,
// world snapshot'ına girmez — client tankları belirdiği anda görür.

import { drawPickup, drawObstacle } from '../core/arenaKit.js';
import { drawField, hashFieldSeed } from '../core/fieldKit.js';
import { UI_COLORS } from '../ui/tokens.js';
import { drawBrutalAvatar } from '../ui/characterRenderer.js';
import { renderEntityHUD } from '../ui/hud.js';
import {
  round1,
  packRectList,
  createWorldSnapshot,
  isValidWorldBase,
  isWorldEntityVisible,
  drawSquareParticles,
} from './worldCore.js';
import { drawFxRings, drawFxPops } from './worldCore.js';

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
      size: round1(tk.size || 26),
      radius: round1(tk.size || 26),
      driving: tk.isDriving === true,
      muzzle: round1(tk.muzzleFlashTimer || 0),
      hitFlash: round1(tk.hitFlash || 0),
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
      // FX kanalı (MOTION_PLAN Faz 1): host FX runtime'ının saf anlık görüntüsü.
      // Halkalar/pop'lar life'tan türetilir — client kendi saatini yürütmez,
      // 30 Hz snapshot tazelemesi animasyon için yeterlidir (kısa ömürler).
      fx: packFxState(game.fx),
    },
  });
}

/** fxRuntime → paket yükü. Kapanlar view bütçesiyle sınırlıdır. */
export function packFxState(fx) {
  if (!fx) return { rings: [], pops: [], flash: 0, flashPeak: 0 };
  const rings = (Array.isArray(fx.rings) ? fx.rings : []).slice(0, 8).map((r) => [
    round1(r.x), round1(r.y), round1(r.r0), round1(r.r1), round1(r.life), round1(r.maxLife), round1(r.width),
    typeof r.color === 'string' ? r.color : UI_COLORS.inkDark,
  ]);
  const pops = (Array.isArray(fx.pops) ? fx.pops : []).slice(0, 6).map((p) => [
    round1(p.x), round1(p.y), round1(p.size), round1(p.angle || 0), round1(p.life), round1(p.maxLife),
    typeof p.color === 'string' ? p.color : UI_COLORS.inkDark,
  ]);
  return {
    rings,
    pops,
    flash: round1(fx.flash || 0),
    flashPeak: round1(fx.flashPeak || 0.06),
  };
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
  // fx alanı v2 eklentisidir; eski host frames'i yoktur (opsiyonel, v1 uyumu).
  if (frame.fx !== undefined) {
    const fx = frame.fx;
    if (!fx || !Array.isArray(fx.rings) || fx.rings.length > 8) return false;
    if (!fx.rings.every((r) => Array.isArray(r) && r.length === 8 && r.slice(0, 7).every(finite) && typeof r[7] === 'string')) return false;
    if (!Array.isArray(fx.pops) || fx.pops.length > 6) return false;
    if (!fx.pops.every((p) => Array.isArray(p) && p.length === 7 && p.slice(0, 6).every(finite) && typeof p[6] === 'string')) return false;
    if (!finite(fx.flash) || !finite(fx.flashPeak)) return false;
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

/**
 * FX katmanının tek çizim sırası: pop → ring → partikül. Host motoru ve
 * client worldView AYNI fonksiyonu çağırır (host↔client aynı görünüm ilkesi).
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ pops?: any[], rings?: any[], particles?: any[] }} layer
 */
export function drawTanksFxLayer(ctx, layer) {
  drawFxPops(ctx, layer?.pops);
  drawFxRings(ctx, layer?.rings);
  drawSquareParticles(ctx, layer?.particles);
}
export function drawTanksArena(ctx, arena, obstacles, suddenDeath = null, opts = {}) {
  // Statik saha `fieldKit`'te: adaçayı tonlu zemin, tanecik dokusu, merkez
  // halkası, köşe plakaları, seeded dekor ve yuvarlatılmış tepsi kesimi.
  // Eskiden burada ~12 ızgara stroke'u + 2 gölge bandı + kare `strokeRect`
  // HER FRAME yeniden raster ediliyordu; hepsi artık bir kez pişip blit olur.
  drawField(ctx, arena, { mode: 'TANKS', seed: hashFieldSeed('TANKS', opts.roundId) });

  // Sudden Death CANLI: yarıçap her frame küçülüyor, yani oyun durumu — bake
  // edilemez. Zaten world packet'inde `{active,x,y,radius}` olarak taşınıyor.
  const { left, top, width, height } = arena;
  const u = arena?.unit ?? 1;
  if (suddenDeath?.active && suddenDeath.radius > 0) {
    ctx.save();
    ctx.fillStyle = 'rgba(216, 71, 39, 0.12)';
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.arc(suddenDeath.x, suddenDeath.y, suddenDeath.radius, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#D84727';
    ctx.lineWidth = 3 * u;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.arc(suddenDeath.x, suddenDeath.y, suddenDeath.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  for (const obs of obstacles) {
    drawObstacle(ctx, obs, { theme: 'TANKS' });
  }
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

export function drawTanksTracers(ctx, tracers, arena = null) {
  const u = arena?.unit ?? 1;
  for (const tracer of tracers || []) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, (tracer.life || 0) / 0.12));
    ctx.strokeStyle = tracer.color || '#1A1A1A';
    ctx.lineWidth = 3 * u;
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
    const u = arena?.unit ?? (s / 40);
    // HIT kanalı (fxKit 'hit'): isabet alan tank 1.10→1.00 pop + mürekkep
    // kontur parlama; hitFlashTimer motor yazar, client snapshot'tan okur.
    const hitT = Math.max(0, Math.min(1, (tank.hitFlash || 0) / 0.12));
    const pop = 1 + 0.10 * hitT;

    ctx.save();
    ctx.translate(tank.x, tank.y);
    ctx.rotate(tank.angle || 0);
    ctx.scale(pop, pop);

    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(-s / 2 - 3, -s / 2, 5, s);
    ctx.fillRect(s / 2 - 2, -s / 2, 5, s);

    ctx.fillStyle = tank.color;
    ctx.fillRect(-s / 2 + 2, -s / 2 + 2, s - 4, s - 4);
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 2.5 * u;
    ctx.strokeRect(-s / 2 + 2, -s / 2 + 2, s - 4, s - 4);
    if (hitT > 0) {
      ctx.save();
      ctx.globalAlpha = hitT * 0.9;
      ctx.strokeStyle = UI_COLORS.white;
      ctx.lineWidth = 3.5 * u;
      ctx.strokeRect(-s / 2 + 2, -s / 2 + 2, s - 4, s - 4);
      ctx.restore();
    }

    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(0, -3.5, s * 0.78, 7);

    ctx.save();
    // İSTİSNA (Adım 3.5): TANKS'ta avatar tankın kendisi DEĞİL, şasi üzerine
    // yerleşen mini komutan figürüdür (s*0.32). Bu figürde disk hacmi/büyük gözler
    // yerine şasi üstü rozet ölçeğinde brutal avatar çizilir.
    drawBrutalAvatar(ctx, 0, 0, s * 0.32, {
      color: tank.color,
      slotIndex: tank.slot ?? tank.index,
      slotType: tank.god ? 'bot_god' : tank.bot ? 'bot_normal' : 'human',
      isBot: !!tank.bot,
      isGodBot: !!tank.god,
      facingAngle: 0,
      expression: tank.driving ? 'FOCUS' : 'normal',
      showPointer: false,
      borderWidth: 1.8 * u,
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
      ctx.lineWidth = 2.5 * u;
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
