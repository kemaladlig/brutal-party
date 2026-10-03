// Paylaşılan TANKS dünya snapshot'ı + çizim sınırı (worldCore deseni).
// Yetkili host, uzak telefon client'larıyla aynı çizim yardımcılarını kullanır;
// client simülasyon/AI import etmez, yalnız salt-okunur draw + snapshot/validator alır.
// Not: spawn beacon'ları (2 sn'lik giriş efekti) ile sudden-death hapı host HUD'udur,
// world snapshot'ına girmez — client tankları belirdiği anda görür.

import { drawPickup, pushObstaclesToDepth } from '../core/arenaKit.js';
import { beginDepthPass, flushDepthPass, entityDepth, DEPTH_KIND, pushDepthItem } from '../core/depthPass.js';
import { computeAvatarKineticDeformation } from '../core/avatarInGame.js';
import { drawField, hashFieldSeed } from '../core/fieldKit.js';
import { tracerAt } from '../core/fieldLights.js';
import { UI_COLORS } from '../ui/tokens.js';
import { drawBrutalAvatar } from '../ui/characterRenderer.js';
import { renderEntityHUD } from '../ui/hud.js';
import {
  round1,
  packRectList,
  createWorldSnapshot,
  isValidWorldBase,
  isWorldEntityVisible,
  packFxState,
  isValidFxState,
  drawSquareParticles,
} from './worldCore.js';
import { drawFxRings, drawFxPops } from './worldCore.js';
import { fxReadAlpha, packFloatingTexts, isValidFloatingTexts } from '../core/fxKit.js';

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
      vx: round1(tk.vx || 0),
      vy: round1(tk.vy || 0),
      recoil: round1(tk.recoil || 0),
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
      // Yüzen metin (SİSTEM 3): `fxKit.packFloatingTexts` tek kaynak; host
      // ilerletip paketler, client saf çizer.
      texts: packFloatingTexts(game.floatingTexts),
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

/** fxRuntime → paket yükü. Tek kaynak worldCore (re-export; tanks paketi aynı şekli kullanır). */
export { packFxState };

function isValidTanksPlayer(p) {
  return typeof p.joined === 'boolean' && typeof p.alive === 'boolean'
    && finite(p.angle) && finite(p.size)
    && (p.vx === undefined || finite(p.vx))
    && (p.vy === undefined || finite(p.vy))
    && (p.recoil === undefined || (finite(p.recoil) && p.recoil >= 0))
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
  if (frame.fx !== undefined && !isValidFxState(frame.fx)) return false;
  // texts kanalı da v2 eklentisidir (aynı opsiyonel kural).
  if (!isValidFloatingTexts(frame.texts)) return false;
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

  // Engeller havuza yazılır; `drawTanksTanks` sonunda tanklarla birlikte
  // y-sırasında çizilir (2.5D okunabilirlik).
  beginDepthPass();
  pushObstaclesToDepth(obstacles, TANKS_OBSTACLE_OPTS);
}

/** Engel çizim seçenekleri — MODÜL SABİTİ (kare başına tahsis yok). */
const TANKS_OBSTACLE_OPTS = Object.freeze({ theme: 'TANKS' });

function pathRoundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
  }
}

export function drawTanksBullets(ctx, bullets, ownerColors) {
  for (const b of bullets) {
    tracerAt(b.x, b.y);
    const ownerColor = ownerColors?.[b.owner] || UI_COLORS.crownGold;
    const hasVelocity = (b.vx !== undefined && b.vy !== undefined && (b.vx !== 0 || b.vy !== 0));
    const speed = hasVelocity ? Math.hypot(b.vx, b.vy) : 0;
    const angle = hasVelocity ? Math.atan2(b.vy, b.vx) : 0;
    const r = Math.max(3.5, b.radius || 4.5);

    ctx.save();
    ctx.translate(b.x, b.y);

    if (hasVelocity && speed > 5) {
      ctx.rotate(angle);

      // 1. Zemine düşen hız gölgesi (hafif aşağıda & arkaya uzanan gölge)
      ctx.save();
      ctx.globalAlpha = 0.20;
      ctx.fillStyle = UI_COLORS.inkDark;
      const shadowTail = Math.min(28, r * 4.5);
      pathRoundRect(ctx, -shadowTail, 1.5, shadowTail + r, r * 1.6, r * 0.8);
      ctx.fill();
      ctx.restore();

      // 2. Işık hüzmesi kuyruğu (luminescent beam trail)
      const tailLen = Math.min(38, Math.max(20, r * 5.0));
      const beamGrad = ctx.createLinearGradient(-tailLen, 0, r * 0.5, 0);
      beamGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      beamGrad.addColorStop(0.35, ownerColor);
      beamGrad.addColorStop(1, ownerColor);

      // Dış ışıma konisi (energy glow cone)
      ctx.save();
      ctx.globalAlpha = 0.70;
      ctx.fillStyle = beamGrad;
      ctx.beginPath();
      ctx.moveTo(r * 1.1, 0);
      ctx.lineTo(-tailLen, -r * 0.65);
      ctx.lineTo(-tailLen, r * 0.65);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // İç parlak beyaz akkor lazer hüzmesi (hyper-bright white core beam)
      const coreGrad = ctx.createLinearGradient(-tailLen * 0.75, 0, r * 0.3, 0);
      coreGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
      coreGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.75)');
      coreGrad.addColorStop(1, 'rgba(255, 255, 255, 0.98)');

      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.moveTo(r * 0.8, 0);
      ctx.lineTo(-tailLen * 0.7, -r * 0.28);
      ctx.lineTo(-tailLen * 0.7, r * 0.28);
      ctx.closePath();
      ctx.fill();

      // 3. Mermi Enerji Kapsülü (Aerodynamic Plasma Slug Head)
      // Dış neon halka / aura
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = ownerColor;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Koyu brutalist dış kabuk
      ctx.fillStyle = UI_COLORS.inkDark;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.25, r * 0.95, 0, 0, Math.PI * 2);
      ctx.fill();

      // Renkli enerji çekirdeği
      ctx.fillStyle = ownerColor;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.95, r * 0.70, 0, 0, Math.PI * 2);
      ctx.fill();

      // Beyaz sıcak akkor iç parıltı
      ctx.fillStyle = UI_COLORS.white;
      ctx.beginPath();
      ctx.ellipse(r * 0.2, 0, r * 0.55, r * 0.38, 0, 0, Math.PI * 2);
      ctx.fill();

    } else {
      // Hız bilinmiyorsa dairesel plazma küresi
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = UI_COLORS.inkDark;
      ctx.beginPath();
      ctx.arc(1.2, 2, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = UI_COLORS.inkDark;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = ownerColor;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = UI_COLORS.white;
      ctx.beginPath();
      ctx.arc(-r * 0.2, -r * 0.2, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
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

/** Derinlik geçişinin kare seviyesindeki seçenekleri — MODÜL SABİTİ. */
const TANKS_TANK_OPTS = { arena: null, withFx: true, hasViewer: false, selfSlot: -1 };

export function drawTanksTanks(ctx, tanks, { arena = null, withFx = true, selfSlot = -1 } = {}) {
  // 3.3 okunurluk: tek görür varsa (ONLINE kumanda selfSlot / LOCAL tek koltuk) kendi
  // tankın T1 (tam opak), diğer oyuncular T3 (−%25). Paylaşılan TV'de görür yok → dim yok.
  TANKS_TANK_OPTS.arena = arena;
  TANKS_TANK_OPTS.withFx = withFx;
  TANKS_TANK_OPTS.hasViewer = Number.isInteger(selfSlot) && selfSlot >= 0;
  TANKS_TANK_OPTS.selfSlot = selfSlot;

  for (const tank of tanks) {
    if (!isWorldEntityVisible(tank)) continue;
    pushDepthItem(entityDepth({ y: tank.y, radius: tank.size || 20 }), DEPTH_KIND.PLAYER, tank, drawTanksTankEntity, TANKS_TANK_OPTS);
  }

  // Engeller + tanklar TEK y-sırasında çizilir.
  flushDepthPass(ctx);
}

/**
 * Tek tankın tüm çizimi — derinlik geçişinin "çiz" geri çağrısı.
 * MODÜL SEVİYESİ olmalıdır (kare başına kapanış = tahsis).
 */
function drawTanksTankEntity(ctx, tank, opts) {
  const { arena, withFx, hasViewer, selfSlot } = opts;
  {
    const s = tank.size || 20;
    const u = arena?.unit ?? (s / 40);
    // HIT kanalı (fxKit 'hit'): isabet alan tank 1.10→1.00 pop + mürekkep
    // kontur parlama; hitFlashTimer motor yazar, client snapshot'tan okur.
    const hitT = Math.max(0, Math.min(1, (tank.hitFlash || 0) / 0.12));
    const pop = 1 + 0.10 * hitT;

    ctx.save();
    const tierA = fxReadAlpha({ isSelf: hasViewer && (tank.slot ?? tank.index) === selfSlot, hasViewer });
    if (tierA < 1) ctx.globalAlpha *= tierA;
    ctx.translate(tank.x, tank.y);
    ctx.rotate(tank.angle || 0);
    ctx.scale(pop, pop);

    // ── 1. Alt Şasi Gölgesi ──────────────────────────────────────
    ctx.save();
    ctx.globalAlpha = 0.26;
    ctx.fillStyle = UI_COLORS.inkDark;
    pathRoundRect(ctx, -s * 0.54 + 2, -s * 0.50 + 3, s * 1.08, s * 1.00, 4 * u);
    ctx.fill();
    ctx.restore();

    // ── 2. Paletler (Tracks/Treads - İki yanda: -Y ve +Y) ─────────
    const trackW = s * 1.12;
    const trackH = s * 0.24;
    const trackR = 3.5 * u;
    const isDriving = !!tank.driving;
    const treadStep = s * 0.22;
    const treadShift = isDriving ? (Date.now() * 0.02) % treadStep : 0;

    // Üst (sol) palet (-Y tarafı)
    ctx.fillStyle = UI_COLORS.inkDark;
    pathRoundRect(ctx, -trackW / 2, -s * 0.52, trackW, trackH, trackR);
    ctx.fill();
    ctx.strokeStyle = UI_COLORS.lineDark;
    ctx.lineWidth = 1.6 * u;
    ctx.stroke();

    // Alt (sağ) palet (+Y tarafı)
    pathRoundRect(ctx, -trackW / 2, s * 0.52 - trackH, trackW, trackH, trackR);
    ctx.fill();
    ctx.stroke();

    // Palet dişleri / tekerlek segmentleri
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1.4 * u;
    for (let tx = -trackW / 2 + 3 + treadShift; tx < trackW / 2 - 3; tx += treadStep) {
      // Üst palet dişi
      ctx.beginPath();
      ctx.moveTo(tx, -s * 0.52 + 1);
      ctx.lineTo(tx, -s * 0.52 + trackH - 1);
      ctx.stroke();

      // Alt palet dişi
      ctx.beginPath();
      ctx.moveTo(tx, s * 0.52 - trackH + 1);
      ctx.lineTo(tx, s * 0.52 - 1);
      ctx.stroke();
    }
    ctx.restore();

    // ── 3. Şasi ve Zırh Gövdesi (Armored Hull) ─────────────────────
    const hullL = s * 0.88;
    const hullW = s * 0.72;
    const hullR = 4 * u;

    // Koyu brutalist alt şasi
    ctx.fillStyle = UI_COLORS.inkDark;
    pathRoundRect(ctx, -hullL / 2, -hullW / 2, hullL, hullW, hullR);
    ctx.fill();

    // Oyuncu renginde üst zırh plakası
    ctx.fillStyle = tank.color;
    pathRoundRect(ctx, -hullL / 2 + 2 * u, -hullW / 2 + 2 * u, hullL - 4 * u, hullW - 4 * u, hullR - 1 * u);
    ctx.fill();

    ctx.strokeStyle = UI_COLORS.inkDark;
    ctx.lineWidth = 2.4 * u;
    ctx.stroke();

    // Ön zırh pahı (Front Glacis Plate - +X yönü)
    ctx.fillStyle = UI_COLORS.inkDark;
    ctx.beginPath();
    ctx.moveTo(hullL / 2 - 2 * u, -hullW * 0.35);
    ctx.lineTo(hullL / 2 + 3 * u, 0);
    ctx.lineTo(hullL / 2 - 2 * u, hullW * 0.35);
    ctx.closePath();
    ctx.fill();

    // Arka motor havalandırma ızgarası (-X yönü)
    ctx.save();
    ctx.strokeStyle = UI_COLORS.inkDark;
    ctx.lineWidth = 1.8 * u;
    const rearX = -hullL / 2 + 5 * u;
    ctx.beginPath();
    ctx.moveTo(rearX, -hullW * 0.28);
    ctx.lineTo(rearX, hullW * 0.28);
    ctx.moveTo(rearX + 4 * u, -hullW * 0.22);
    ctx.lineTo(rearX + 4 * u, hullW * 0.22);
    ctx.stroke();
    ctx.restore();

    // Hit Flash vurgusu
    if (hitT > 0) {
      ctx.save();
      ctx.globalAlpha = hitT * 0.9;
      ctx.strokeStyle = UI_COLORS.white;
      ctx.lineWidth = 3.5 * u;
      pathRoundRect(ctx, -hullL / 2 + 2 * u, -hullW / 2 + 2 * u, hullL - 4 * u, hullW - 4 * u, hullR - 1 * u);
      ctx.stroke();
      ctx.restore();
    }

    // ── 4. Taret Platformu & Ağır Top Namlusu ──────────────────────
    const barrelLen = s * 0.86;
    const barrelW = Math.max(5, s * 0.20);

    // Namlu kalkanı (Gun Mantlet / Kundak tabanı)
    ctx.fillStyle = UI_COLORS.inkDark;
    pathRoundRect(ctx, s * 0.08, -barrelW * 0.9, s * 0.24, barrelW * 1.8, 2 * u);
    ctx.fill();

    // Namlu borusu (Cannon Barrel)
    ctx.fillStyle = UI_COLORS.inkDark;
    ctx.fillRect(s * 0.16, -barrelW / 2, barrelLen - s * 0.16, barrelW);

    // Namlu üstü açık metalik vurgu şeridi
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = UI_COLORS.white;
    ctx.fillRect(s * 0.20, -barrelW * 0.25, barrelLen - s * 0.30, barrelW * 0.5);
    ctx.restore();

    // Namlu ucu alev gizleyen / fren (Muzzle Brake)
    ctx.fillStyle = UI_COLORS.inkDark;
    ctx.fillRect(barrelLen - 2 * u, -barrelW * 0.75, 4.5 * u, barrelW * 1.5);
    ctx.strokeStyle = UI_COLORS.lineDark;
    ctx.lineWidth = 1 * u;
    ctx.strokeRect(barrelLen - 2 * u, -barrelW * 0.75, 4.5 * u, barrelW * 1.5);

    // Taret çember tabanı (Turret Ring)
    ctx.fillStyle = UI_COLORS.inkDark;
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.38, 0, Math.PI * 2);
    ctx.fill();

    // ── 5. Komutan Figürü (Mini Brutal Avatar) ─────────────────────
    // İSTİSNA (Adım 3.5): TANKS'ta avatar tankın kendisi DEĞİL, şasi üzerine
    // yerleşen mini komutan figürüdür (s*0.30). Bu figürde disk hacmi/büyük gözler
    // yerine şasi üstü rozet ölçeğinde brutal avatar çizilir.
    ctx.save();
    // Taret kapağı bileziği
    ctx.fillStyle = tank.color;
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = UI_COLORS.inkDark;
    ctx.lineWidth = 1.8 * u;
    ctx.stroke();

    drawBrutalAvatar(ctx, 0, 0, s * 0.30, {
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
      // Kinetik parity (Faz 1): sürüş/recoil komutan figüründe de okunur.
      // Gövde paleti sabit kalır (çarpışma silueti değişmez), juice yalnız
      // figürde — sunum katmanı, simülasyon değil. Dünya açısı yerele çevrilir
      // (gövde `angle` ile dönüyor).
      ...(() => {
        const k = computeAvatarKineticDeformation(tank, {});
        if (k.squashAngle === null) return {};
        return { squashX: k.squashX, squashY: k.squashY, squashAngle: k.squashAngle - (tank.angle || 0) };
      })(),
    });
    ctx.restore();

    ctx.restore();

    // ── 6. Muzzle Flash Ateş Parıltısı ──────────────────────────
    if (withFx && (tank.muzzle || 0) > 0) {
      ctx.save();
      ctx.translate(tank.x, tank.y);
      ctx.rotate(tank.angle || 0);
      const flashAlpha = Math.max(0, Math.min(1, (tank.muzzle || 0) / 0.12));
      ctx.globalAlpha = flashAlpha;

      const flashX = barrelLen + 4 * u;
      // Dış sarı patlama yıldızı
      ctx.fillStyle = '#FFDE59';
      ctx.beginPath();
      ctx.moveTo(flashX + s * 0.42, 0);
      ctx.lineTo(flashX + s * 0.14, -s * 0.22);
      ctx.lineTo(flashX + s * 0.20, -s * 0.08);
      ctx.lineTo(flashX, -s * 0.26);
      ctx.lineTo(flashX + s * 0.06, 0);
      ctx.lineTo(flashX, s * 0.26);
      ctx.lineTo(flashX + s * 0.20, s * 0.08);
      ctx.lineTo(flashX + s * 0.14, s * 0.22);
      ctx.closePath();
      ctx.fill();

      // İç sıcak akkor beyaz çekirdek
      ctx.fillStyle = UI_COLORS.white;
      ctx.beginPath();
      ctx.arc(flashX + s * 0.10, 0, s * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (tank.shield) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(tank.x, tank.y, s * 0.92, 0, Math.PI * 2);
      ctx.strokeStyle = UI_COLORS.inkDark;
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
