// BRUTAL COLOSSUS — Tabletop Diorama Çizim & Snapshot Katmanı.
// Host ve Client bu dosyadan salt-okunur render ve snapshot doğrulamasını paylaşır.

import { UI_COLORS } from '../ui/tokens.js';
import { drawField, hashFieldSeed } from '../core/fieldKit.js';
import { drawGameAvatar } from '../core/avatarInGame.js';
import { drawDioramaShadow } from '../core/dioramaKit.js';
import { drawTabletopIcon } from '../core/tabletopIcons.js';
import { t } from '../i18n.js';
import {
  COLOSSUS_PLAYER_RADIUS,
  createWorldSnapshot,
  drawAlphaTexts,
  drawCircleParticles,
  drawFxRings,
  drawFxPops,
  isValidWorldBase,
  isValidFxState,
  packFxState,
  round1,
} from './worldCore.js';
import { COLOSSUS_TUNING, COLOSSUS_WEAPONS, clipRayToCircles } from './colossusConfig.js';

export const COLOSSUS_VIEW_LIMITS = Object.freeze({
  bullets: 64,
  shockwaves: 6,
  lasers: 4,
  mortars: 8,
  pylons: 4,
  particles: 48,
  obstacles: 8,
  tombs: 4,
  texts: 8,
});

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// Sabit renk paleti (token destekli)
const COLOR_INK = '#1A1815';
const COLOR_WHITE = '#FFFFFF';
const COLOR_GOLD = '#FFB020';
const COLOR_RED = '#E11D48';
const COLOR_CYAN = '#38BDF8';
const COLOR_PURPLE = '#A78BFA';
const COLOR_ORANGE = '#F97316';
const COLOR_ARMOR = '#334155';
const COLOR_ARMOR_DARK = '#1E293B';
const COLOR_ARMOR_LIGHT = '#64748B';

export function mapColossusPlayer(player) {
  const weapon = COLOSSUS_WEAPONS[player.weaponId] || COLOSSUS_WEAPONS.RIFLE;
  return {
    slot: player.index,
    joined: player.isJoined !== false,
    alive: player.isAlive !== false,
    x: round1(player.x || 0),
    y: round1(player.y || 0),
    vx: round1(player.vx || 0),
    vy: round1(player.vy || 0),
    radius: round1(player.radius || COLOSSUS_PLAYER_RADIUS),
    angle: round1(player.angle || 0),
    color: typeof player.color === 'string' ? player.color : UI_COLORS.players[player.index] || '#F0483C',
    hp: Math.max(0, Math.round(Number(player.hp) || 0)),
    hpMax: COLOSSUS_TUNING.MAX_HP,
    weaponId: player.weaponId || 'RIFLE',
    ammo: Number.isFinite(player.ammo) ? Math.round(player.ammo) : weapon.magazine,
    magazine: weapon.magazine,
    reloading: (Number(player.reloadTimer) || 0) > 0,
    reloadProgress: Math.min(1, Math.max(0, 1 - (Number(player.reloadTimer) || 0) / (weapon.reloadTime || 1))),
    dashCooldown: round1(player.dashCooldown || 0),
    isDowned: player.isDowned === true,
    reviveProgress: round1(player.reviveProgress || 0),
    invincible: (Number(player.dashTimer) || 0) > 0,
    hurtInvuln: (Number(player.hurtInvuln) || 0) > 0,
    hitFlash: round1(player.hitFlash || 0),
  };
}

export function createColossusWorldPacket(game) {
  if (!game) return null;
  const boss = game.boss || {};
  return createWorldSnapshot(game, {
    mode: 'COLOSSUS',
    mapPlayer: mapColossusPlayer,
    extras: {
      selfPredict: true,
      boss: {
        id: boss.id || 'AEGIS',
        name: boss.name || 'AEGIS-01',
        titleKey: boss.titleKey || 'colossus.bossAegisTitle',
        bodyShape: boss.bodyShape || 'mech',
        accentColor: boss.accentColor || COLOR_CYAN,
        x: round1(boss.x || 0),
        y: round1(boss.y || 0),
        angle: round1(boss.angle || 0),
        radius: round1(boss.radius || COLOSSUS_TUNING.BOSS_RADIUS),
        hp: Math.max(0, round1(boss.hp || 0)),
        maxHp: round1(boss.maxHp || COLOSSUS_TUNING.BASE_HP),
        phase: boss.phase || 1,
        state: boss.state || 'IDLE',
        stagger: round1(boss.stagger || 0),
        targetSlot: Number.isInteger(boss.targetSlot) ? boss.targetSlot : -1,
        hitFlash: round1(boss.hitFlash || 0),
        critFlash: round1(boss.critFlash || 0),
        shielded: boss.shielded === true,
        laserActive: boss.laserActive === true,
        laserLock: boss.laserLock === true,
        chargeLock: boss.chargeLock === true,
        laserProgress: round1(boss.laserProgress || 0),
        laserAngle: round1(Number.isFinite(boss.laserAngle) ? boss.laserAngle : (boss.angle || 0)),
        chargeAngle: round1(Number.isFinite(boss.chargeAngle) ? boss.chargeAngle : (boss.angle || 0)),
        parts: (boss.parts || []).map((part) => ({
          id: part.id,
          nameKey: part.nameKey,
          hp: round1(part.hp),
          maxHp: round1(part.maxHp),
          broken: part.broken === true,
          angleOffset: round1(part.angleOffset || 0),
          distRatio: round1(part.distRatio || 0),
          // Parça yarıçapı oyuncu yarıçapı değil: motor `part.radius` gönderir,
          // 20 en küçük parçanın (capacitors) configured değeridir. Değişken
          // `part` adıyla anılır — `p.radius` oyuncu yarıçapı sanılıp I4
          // sadakat kapısını yanlış pozitifle kırıyordu.
          radius: round1(part.radius || 20),
          hitFlash: round1(part.hitFlash || 0),
        })),
      },
      pylons: (game.pylons || []).map((p) => ({
        id: p.id,
        x: round1(p.x),
        y: round1(p.y),
        hp: round1(p.hp),
        maxHp: round1(p.maxHp),
        radius: round1(p.radius),
        active: p.active !== false,
        hitFlash: round1(p.hitFlash || 0),
      })),
      shockwaves: (game.shockwaves || []).slice(0, COLOSSUS_VIEW_LIMITS.shockwaves).map((s) => ({
        x: round1(s.x),
        y: round1(s.y),
        radius: round1(s.radius),
        maxRadius: round1(s.maxRadius),
        life: round1(s.life),
      })),
      mortars: (game.mortars || []).slice(0, COLOSSUS_VIEW_LIMITS.mortars).map((m) => ({
        x: round1(m.x),
        y: round1(m.y),
        radius: round1(m.radius),
        fuse: round1(m.fuse),
        maxFuse: round1(m.maxFuse),
      })),
      bullets: (game.projectiles || []).slice(0, COLOSSUS_VIEW_LIMITS.bullets).map((b) => ({
        x: round1(b.x),
        y: round1(b.y),
        vx: round1(b.vx),
        vy: round1(b.vy),
        color: b.color || COLOR_CYAN,
        radius: round1(b.radius || 3),
        enemy: b.enemy === true,
      })),
      pillars: (game.pillars || []).map((p) => ({
        x: round1(p.x),
        y: round1(p.y),
        radius: round1(p.radius),
        hp: round1(p.hp),
        maxHp: round1(p.maxHp),
      })),
      texts: (game.floatingTexts || []).slice(0, COLOSSUS_VIEW_LIMITS.texts).map((entry) => ({
        x: round1(entry.x),
        y: round1(entry.y),
        text: String(entry.text || '').slice(0, 20),
        alpha: round1(Math.max(0, Math.min(1, Number(entry.alpha) || 0))),
        color: typeof entry.color === 'string' ? entry.color : COLOR_WHITE,
      })),
      matchOver: game.state === 'VICTORY' || game.state === 'DEFEAT' || game.state === 'MATCH_OVER',
      victory: game.matchResult === 'win' || game.matchResult === 'victory' || game.state === 'VICTORY',
      // Client'in `drawColossusWorld` FX katmanı (halka + patlama) bu state'i
      // okuyor; paketlemeden önce daima null idi, yani renderer ölüydü.
      // Alan diğer oyunlarla AYNI (`packFxState`) — yeni protokol alanı değil.
      fx: packFxState(game.fx),
    },
  });
}

export function isValidColossusWorldFrame(frame) {
  if (!isValidWorldBase(frame, 'COLOSSUS', {
    maxPlayers: 4,
  })) return false;

  if (!frame.boss || typeof frame.boss !== 'object') return false;
  if (!finite(frame.boss.x) || !finite(frame.boss.y) || !finite(frame.boss.hp)) return false;
  if (frame.texts !== undefined) {
    if (!Array.isArray(frame.texts) || frame.texts.length > COLOSSUS_VIEW_LIMITS.texts) return false;
    if (!frame.texts.every((entry) => entry && finite(entry.x) && finite(entry.y) && typeof entry.text === 'string')) return false;
  }
  return true;
}

export function colossusSceneFromFrame(frame) {
  return {
    phase: frame.gameState,
    boss: frame.boss ? {
      ...frame.boss,
      parts: Array.isArray(frame.boss.parts) ? frame.boss.parts : [],
    } : {},
    pylons: (frame.pylons || []).map((p) => ({
      x: p.x,
      y: p.y,
      radius: p.radius,
      hp: p.hp,
      maxHp: p.maxHp,
      active: p.active,
      hitFlash: p.hitFlash || 0,
    })),
    shockwaves: Array.isArray(frame.shockwaves) ? frame.shockwaves : [],
    mortars: Array.isArray(frame.mortars) ? frame.mortars : [],
    bullets: Array.isArray(frame.bullets) ? frame.bullets : [],
    pillars: Array.isArray(frame.pillars) ? frame.pillars : [],
    texts: Array.isArray(frame.texts) ? frame.texts : [],
    players: Array.isArray(frame.players) ? frame.players : [],
    particles: Array.isArray(frame.particles) ? frame.particles : [],
    fx: isValidFxState(frame.fx) ? frame.fx : null,
    victory: frame.victory === true,
    matchOver: frame.matchOver === true,
  };
}

function unpackFxRings(rings) {
  if (!Array.isArray(rings)) return [];
  return rings.map((r) => (Array.isArray(r)
    ? { x: r[0], y: r[1], r0: r[2], r1: r[3], life: r[4], maxLife: r[5], width: r[6], color: r[7] }
    : r));
}

function unpackFxPops(pops) {
  if (!Array.isArray(pops)) return [];
  return pops.map((p) => (Array.isArray(p)
    ? { x: p[0], y: p[1], size: p[2], angle: p[3], life: p[4], maxLife: p[5], color: p[6] }
    : p));
}

function drawBossWeakCore(ctx, radius, coreColor, corePulse, u = 1) {
  ctx.save();
  ctx.translate(-radius * 0.65, 0);
  ctx.fillStyle = COLOR_ARMOR_DARK;
  ctx.fillRect(-radius * 0.15, -radius * 0.45, radius * 0.12, radius * 0.9);

  const coreRadius = radius * 0.32 * corePulse;
  const grad = ctx.createRadialGradient(0, 0, coreRadius * 0.1, 0, 0, coreRadius);
  grad.addColorStop(0, COLOR_WHITE);
  grad.addColorStop(0.4, coreColor);
  grad.addColorStop(1, COLOR_ARMOR_DARK);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, coreRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = coreColor;
  ctx.lineWidth = Math.max(1, 2.5 * u);
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * 2.5D Boss Çizimi (AEGIS-01 / IGNIS-V / VOLT-OMEGA)
 */
function drawBoss(ctx, boss, arena, now = 0, u = 1, pillars = []) {
  const {
    x, y, angle, radius, hp, maxHp, phase, state, stagger, hitFlash, critFlash,
    shielded, laserActive, laserLock, chargeLock, targetSlot, bodyShape = 'mech',
    parts = [], laserAngle, chargeAngle, laserProgress,
  } = boss;
  if (!finite(x) || !finite(y) || radius <= 0 || !finite(hp) || hp <= 0) return;

  const beamAngle = finite(laserAngle) ? laserAngle : angle;
  const chargeAim = finite(chargeAngle) ? chargeAngle : angle;
  const isWindingLaser = state === 'WINDUP_LASER';
  const isWindingCharge = state === 'WINDUP_CHARGE';
  const isWindingStomp = state === 'WINDUP_STOMP';

  const isStaggered = state === 'STAGGER';
  const corePulse = Math.sin(now * 0.008) * 0.15 + 0.85;
  const coreColor = phase === 3 ? COLOR_ORANGE : (phase === 2 ? COLOR_PURPLE : COLOR_CYAN);

  ctx.save();
  ctx.translate(x, y);

  // 1. Zemin Gölgesi (Contact AO + Drop Shadow)
  ctx.save();
  ctx.fillStyle = COLOR_ARMOR_DARK;
  ctx.beginPath();
  ctx.ellipse(0, radius * 0.15, radius * 1.15, radius * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 2. Boss Rotasyonu
  ctx.rotate(angle);

  // 3. Gövde Çizimi (bodyShape'e göre)
  if (bodyShape === 'scorpion') {
    // IGNIS-V (Lav Akrebi)
    const legPositions = [
      { x: -radius * 0.4, y: -radius * 0.75, flipY: -1, phase: 0 },
      { x: 0, y: -radius * 0.85, flipY: -1, phase: Math.PI * 0.5 },
      { x: radius * 0.4, y: -radius * 0.75, flipY: -1, phase: Math.PI },
      { x: -radius * 0.4, y: radius * 0.75, flipY: 1, phase: Math.PI },
      { x: 0, y: radius * 0.85, flipY: 1, phase: Math.PI * 1.5 },
      { x: radius * 0.4, y: radius * 0.75, flipY: 1, phase: 0 },
    ];
    ctx.fillStyle = COLOR_ARMOR_DARK;
    ctx.strokeStyle = COLOR_RED;
    ctx.lineWidth = Math.max(1, 2.5 * u);
    for (const leg of legPositions) {
      ctx.save();
      const anim = Math.sin(now * 0.012 + leg.phase) * (isStaggered ? 1 : 6 * u);
      ctx.translate(leg.x, leg.y + anim * leg.flipY);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(radius * 0.2, leg.flipY * radius * 0.3);
      ctx.stroke();
      ctx.restore();
    }

    // Parçalar: Kıskaçlar (Ön)
    const pincersBroken = parts.find((p) => p.id === 'pincers')?.broken;
    ctx.save();
    ctx.fillStyle = pincersBroken ? COLOR_ARMOR_DARK : COLOR_RED;
    ctx.strokeStyle = pincersBroken ? COLOR_ARMOR_LIGHT : COLOR_ORANGE;
    ctx.lineWidth = Math.max(1, 2 * u);
    for (const flip of [-1, 1]) {
      ctx.save();
      ctx.translate(radius * 0.7, flip * radius * 0.4);
      if (pincersBroken) {
        ctx.fillRect(-6 * u, -6 * u, 12 * u, 12 * u);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, radius * 0.22, flip > 0 ? 0 : -Math.PI * 0.5, flip > 0 ? Math.PI * 0.5 : 0);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();

    // Akrep Gövdesi (Segmentli Zırh)
    ctx.save();
    ctx.fillStyle = critFlash > 0 ? COLOR_GOLD : (hitFlash > 0 ? COLOR_WHITE : (isStaggered ? COLOR_ARMOR_DARK : COLOR_ARMOR));
    ctx.strokeStyle = COLOR_RED;
    ctx.lineWidth = Math.max(1, 3 * u);
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 0.75, radius * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Arka Zayıf Nokta (Scorpion için de belirgin)
    drawBossWeakCore(ctx, radius * 0.92, coreColor, corePulse, u);

    // Akrep Kuyruğu & İğne
    const stingerBroken = parts.find((p) => p.id === 'stinger')?.broken;
    ctx.save();
    ctx.translate(-radius * 0.5, 0);
    ctx.strokeStyle = stingerBroken ? COLOR_ARMOR_LIGHT : COLOR_RED;
    ctx.lineWidth = Math.max(1, 4 * u);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-radius * 0.4, -radius * 0.3, -radius * 0.4, 0);
    ctx.stroke();
    if (!stingerBroken) {
      ctx.fillStyle = COLOR_ORANGE;
      ctx.beginPath();
      ctx.arc(-radius * 0.4, 0, radius * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.restore();

  } else if (bodyShape === 'nexus') {
    // VOLT-OMEGA (Fırtına Çekirdeği)
    const coilBroken = parts.find((p) => p.id === 'coil')?.broken;
    const capBroken = parts.find((p) => p.id === 'capacitors')?.broken;

    // Dönen Manyetik Halkalar (Gyros)
    ctx.save();
    ctx.strokeStyle = capBroken ? COLOR_ARMOR_LIGHT : COLOR_PURPLE;
    ctx.lineWidth = Math.max(1, 2.5 * u);
    for (let rIdx = 0; rIdx < 2; rIdx++) {
      ctx.save();
      ctx.rotate((rIdx === 0 ? 1 : -1) * now * 0.003);
      ctx.beginPath();
      ctx.ellipse(0, 0, radius * 0.9, radius * 0.4, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Bobin ve Çekirdek
    ctx.fillStyle = critFlash > 0 ? COLOR_GOLD : (hitFlash > 0 ? COLOR_WHITE : (isStaggered ? COLOR_ARMOR_DARK : COLOR_ARMOR));
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = coilBroken ? COLOR_ARMOR_LIGHT : COLOR_CYAN;
    ctx.lineWidth = Math.max(1, 3 * u);
    ctx.stroke();

    // İç Plazma
    const coreGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, radius * 0.35);
    coreGrad.addColorStop(0, COLOR_WHITE);
    coreGrad.addColorStop(0.5, coilBroken ? COLOR_ARMOR_LIGHT : COLOR_PURPLE);
    coreGrad.addColorStop(1, COLOR_ARMOR_DARK);
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.35, 0, Math.PI * 2);
    ctx.fill();

    // Arka Zayıf Nokta Çekirdeği
    drawBossWeakCore(ctx, radius * 0.85, coreColor, corePulse, u);
    ctx.restore();

  } else {
    // MECH (AEGIS-01 Kuşatma Devi)
    const armorBroken = parts.find((p) => p.id === 'armorPlate')?.broken;
    const cannonBroken = parts.find((p) => p.id === 'cannon')?.broken;

    // Bacaklar
    const legPositions = [
      { x: -radius * 0.7, y: -radius * 0.8, flipY: -1, phaseOffset: 0 },
      { x: radius * 0.6, y: -radius * 0.8, flipY: -1, phaseOffset: Math.PI },
      { x: -radius * 0.7, y: radius * 0.8, flipY: 1, phaseOffset: Math.PI },
      { x: radius * 0.6, y: radius * 0.8, flipY: 1, phaseOffset: 0 },
    ];

    ctx.fillStyle = COLOR_ARMOR_DARK;
    ctx.strokeStyle = COLOR_ARMOR_LIGHT;
    ctx.lineWidth = Math.max(1, 3 * u);

    for (const leg of legPositions) {
      ctx.save();
      const anim = Math.sin(now * 0.01 + leg.phaseOffset) * (isStaggered ? 2 * u : 8 * u);
      ctx.translate(leg.x + anim * 0.5, leg.y + anim * 0.3 * leg.flipY);
      ctx.beginPath();
      ctx.roundRect(-radius * 0.22, -radius * 0.14, radius * 0.44, radius * 0.28, 6 * u);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = COLOR_ARMOR;
      ctx.beginPath();
      ctx.arc(0, radius * 0.05 * leg.flipY, radius * 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Omuz Topu (Cannon)
    ctx.save();
    ctx.translate(0, -radius * 0.65);
    ctx.fillStyle = cannonBroken ? COLOR_ARMOR_DARK : COLOR_ARMOR;
    ctx.fillRect(-radius * 0.15, -radius * 0.1, radius * 0.45, radius * 0.2);
    ctx.strokeStyle = cannonBroken ? COLOR_RED : COLOR_ARMOR_LIGHT;
    ctx.lineWidth = Math.max(1, 2 * u);
    ctx.strokeRect(-radius * 0.15, -radius * 0.1, radius * 0.45, radius * 0.2);
    ctx.restore();

    // Ana Zırh Gövdesi
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(radius * 0.95, 0);
    ctx.lineTo(radius * 0.3, -radius * 0.85);
    ctx.lineTo(-radius * 0.75, -radius * 0.75);
    ctx.lineTo(-radius * 0.9, 0);
    ctx.lineTo(-radius * 0.75, radius * 0.75);
    ctx.lineTo(radius * 0.3, radius * 0.85);
    ctx.closePath();

    if (critFlash > 0) {
      ctx.fillStyle = COLOR_GOLD;
    } else if (hitFlash > 0) {
      ctx.fillStyle = COLOR_WHITE;
    } else {
      ctx.fillStyle = isStaggered ? COLOR_ARMOR_LIGHT : COLOR_ARMOR;
    }
    ctx.fill();

    // Zırh Pahı (Ön zırh kırıldıysa kırmızı çizgi)
    ctx.strokeStyle = armorBroken ? COLOR_RED : (isStaggered ? COLOR_ARMOR_LIGHT : (phase === 3 ? COLOR_ORANGE : COLOR_ARMOR_LIGHT));
    ctx.lineWidth = Math.max(1, 4 * u);
    ctx.stroke();
    ctx.restore();

    // Arka Zayıf Nokta (Vulnerable Core)
    drawBossWeakCore(ctx, radius, coreColor, corePulse, u);
  }

  // Kırılabilir Modül Halkaları & Kırık Kıvılcımları (Tüm bosslarda)
  for (const part of parts) {
    const px = Math.cos(part.angleOffset) * (radius * part.distRatio);
    const py = Math.sin(part.angleOffset) * (radius * part.distRatio);
    ctx.save();
    ctx.translate(px, py);
    if (!part.broken) {
      const nodeR = Math.max(7 * u, (part.radius || 22) * (radius / 76) * 0.52);
      const pRatio = Math.max(0, Math.min(1, (part.hp || 0) / (part.maxHp || 1)));
      ctx.globalAlpha = part.hitFlash > 0 ? 0.95 : 0.75;
      ctx.strokeStyle = part.hitFlash > 0 ? COLOR_WHITE : COLOR_GOLD;
      ctx.lineWidth = Math.max(1, 2.2 * u);
      ctx.beginPath();
      ctx.arc(0, 0, nodeR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pRatio);
      ctx.stroke();
      ctx.globalAlpha = part.hitFlash > 0 ? 0.55 : 0.22;
      ctx.fillStyle = part.hitFlash > 0 ? COLOR_WHITE : COLOR_GOLD;
      ctx.beginPath();
      ctx.arc(0, 0, nodeR * 0.45, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = COLOR_GOLD;
      ctx.lineWidth = Math.max(1, 2 * u);
      const sparkAng = (now * 0.02 + part.angleOffset) % (Math.PI * 2);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(sparkAng) * 9 * u, Math.sin(sparkAng) * 9 * u);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 5. Ön Hedefleme Optiği (Eye Reticle / Aiming Laser)
  ctx.save();
  ctx.translate(radius * 0.7, 0);
  ctx.fillStyle = COLOR_RED;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = COLOR_WHITE;
  ctx.lineWidth = Math.max(1, 1.5 * u);
  ctx.stroke();
  ctx.restore();

  // 6. Sersemleme / Kıvılcım (Stagger FX)
  if (isStaggered) {
    ctx.save();
    ctx.strokeStyle = COLOR_GOLD;
    ctx.lineWidth = Math.max(1, 2 * u);
    for (let i = 0; i < 4; i++) {
      const spAng = now * 0.015 + i * (Math.PI / 2);
      const spDist = radius * (0.4 + Math.sin(now * 0.02 + i) * 0.2);
      ctx.beginPath();
      ctx.arc(Math.cos(spAng) * spDist, Math.sin(spAng) * spDist, 4 * u, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 7. Enerji Kalkanı (Phase 2 Forcefield Dome)
  if (shielded) {
    ctx.save();
    const shieldPulse = Math.sin(now * 0.007) * 0.08 + 0.92;
    const sRadius = radius * 1.35 * shieldPulse;
    ctx.strokeStyle = COLOR_PURPLE;
    ctx.lineWidth = Math.max(1, 3.5 * u);
    ctx.beginPath();
    ctx.arc(0, 0, sRadius, 0, Math.PI * 2);
    ctx.stroke();

    for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) {
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * sRadius * 0.4, Math.sin(a) * sRadius * 0.4);
      ctx.lineTo(Math.cos(a) * sRadius, Math.sin(a) * sRadius);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.restore(); // Boss koordinat sistemi çıkışı

  // 8. Telegraf & Işın katmanı (dünya uzayı; sütunlara kırpılır).
  const lx = x + Math.cos(beamAngle) * (radius * 0.7);
  const ly = y + Math.sin(beamAngle) * (radius * 0.7);

  if (isWindingCharge) {
    const arenaSpan = arena?.size || Math.min(arena?.width || 820, arena?.height || 820) || 820;
    const lane = Math.min(arenaSpan * 0.92, COLOSSUS_TUNING.CHARGE_SPEED * u * COLOSSUS_TUNING.CHARGE_DURATION);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(chargeAim);
    ctx.globalAlpha = chargeLock ? 0.30 : (0.14 + Math.sin(now * 0.02) * 0.05);
    ctx.fillStyle = COLOR_RED;
    const laneH = radius * 0.95;
    ctx.fillRect(radius * 0.4, -laneH / 2, lane, laneH);
    ctx.globalAlpha = chargeLock ? 0.95 : 0.75;
    ctx.strokeStyle = chargeLock ? COLOR_GOLD : COLOR_RED;
    ctx.lineWidth = Math.max(1, (chargeLock ? 3 : 2) * u);
    ctx.setLineDash(chargeLock ? [] : [10 * u, 8 * u]);
    ctx.strokeRect(radius * 0.4, -laneH / 2, lane, laneH);
    ctx.restore();
  }

  if (isWindingStomp) {
    ctx.save();
    const pulse = 1 + Math.sin(now * 0.02) * 0.12;
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = COLOR_ORANGE;
    ctx.lineWidth = Math.max(1, 3 * u);
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.5 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(x, y, radius * 2.1 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  const rawMaxLen = Math.hypot(arena?.width || 900, arena?.height || 900) * 1.4;
  const beamLen = clipRayToCircles(lx, ly, beamAngle, rawMaxLen, pillars);
  const bx = lx + Math.cos(beamAngle) * beamLen;
  const by = ly + Math.sin(beamAngle) * beamLen;

  if (laserActive) {
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = COLOR_RED;
    ctx.lineWidth = Math.max(1, COLOSSUS_TUNING.LASER_BEAM_WIDTH * 1.8 * u);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = COLOR_WHITE;
    ctx.lineWidth = Math.max(1, COLOSSUS_TUNING.LASER_BEAM_WIDTH * 0.55 * u);
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(bx, by);
    ctx.stroke();
    if (beamLen < rawMaxLen) {
      ctx.fillStyle = COLOR_GOLD;
      ctx.beginPath();
      ctx.arc(bx, by, 10 * u, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  } else if (isWindingLaser) {
    const lockT = Math.max(0, Math.min(1, Number(laserProgress) || 0));
    ctx.save();
    if (laserLock) {
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = COLOR_RED;
      ctx.lineWidth = Math.max(1.5, (4.2 + Math.sin(now * 0.04) * 1.2) * u);
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = COLOR_WHITE;
      ctx.lineWidth = Math.max(1, 1.5 * u);
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(bx, by);
      ctx.stroke();
    } else {
      ctx.globalAlpha = 0.25 + lockT * 0.5;
      ctx.strokeStyle = COLOR_RED;
      ctx.lineWidth = Math.max(1, (1.5 + lockT * 2.2) * u);
      ctx.setLineDash([8 * u, 6 * u]);
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.restore();
  } else if (!isStaggered && targetSlot >= 0) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = COLOR_RED;
    ctx.lineWidth = Math.max(1, 1.5 * u);
    ctx.setLineDash([6 * u, 6 * u]);
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Taş Sütunlar (2.5D Siperler)
 */
function drawPillars(ctx, pillars, u = 1) {
  for (const pillar of pillars) {
    const { x, y, radius, hp, maxHp } = pillar;
    if (!finite(x) || !finite(y) || radius <= 0) continue;

    const hpRatio = Math.max(0, hp / (maxHp || 1));

    ctx.save();
    // Alt gölge
    ctx.fillStyle = 'rgba(15, 23, 42, 0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + radius * 0.25, radius * 1.1, radius * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Sütun gövdesi (Ön cephe)
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.arc(x, y + 6, radius, 0, Math.PI * 2);
    ctx.fill();

    // Üst yüzey (2.5D Bevel)
    ctx.fillStyle = hpRatio < 0.4 ? '#94A3B8' : '#CBD5E1';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = Math.max(1, 2.5 * u);
    ctx.stroke();

    // Çatlak izleri (hasar aldıysa)
    if (hpRatio < 0.75) {
      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = Math.max(1, 1.5 * u);
      ctx.beginPath();
      ctx.moveTo(x - radius * 0.4, y - radius * 0.3);
      ctx.lineTo(x + radius * 0.1, y + radius * 0.2);
      ctx.lineTo(x + radius * 0.5, y - radius * 0.1);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/**
 * Pilonlar (Faz 2 Güç Kaynakları)
 */
function drawPylons(ctx, pylons, boss, now = 0, u = 1) {
  for (const pylon of pylons) {
    const { x, y, radius, hp, maxHp, active, hitFlash } = pylon;
    if (!active || !finite(x) || !finite(y)) continue;

    ctx.save();
    // Taban halkası
    ctx.fillStyle = 'rgba(167, 139, 250, 0.25)';
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.3, 0, Math.PI * 2);
    ctx.fill();

    // Pilon direği (Vuruş flaşı ile aydınlanır)
    ctx.fillStyle = hitFlash > 0 ? COLOR_WHITE : '#1E1B4B';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hitFlash > 0 ? COLOR_WHITE : COLOR_PURPLE;
    ctx.lineWidth = Math.max(1, 3 * u);
    ctx.stroke();

    // Enerji Küresi (Üstte süzülen plazma)
    const floatY = Math.sin(now * 0.008 + x) * 5;
    const orbGrad = ctx.createRadialGradient(x, y + floatY, 2, x, y + floatY, radius * 0.7);
    orbGrad.addColorStop(0, COLOR_WHITE);
    orbGrad.addColorStop(0.5, hitFlash > 0 ? COLOR_WHITE : COLOR_PURPLE);
    orbGrad.addColorStop(1, 'rgba(167, 139, 250, 0)');
    ctx.fillStyle = orbGrad;
    ctx.beginPath();
    ctx.arc(x, y + floatY, radius * 0.7, 0, Math.PI * 2);
    ctx.fill();

    // Pilon Can Çubuğu (HP Bar)
    const barW = Math.max(28, radius * 2.2);
    const barH = Math.max(4, 5 * u);
    const barX = x - barW / 2;
    const barY = y - radius - 16 * u;
    const hpRatio = Math.max(0, Math.min(1, (hp || 0) / (maxHp || 1)));

    ctx.fillStyle = COLOR_ARMOR_DARK;
    ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
    ctx.fillStyle = hitFlash > 0 ? COLOR_WHITE : COLOR_PURPLE;
    ctx.fillRect(barX, barY, barW * hpRatio, barH);
    ctx.strokeStyle = COLOR_PURPLE;
    ctx.lineWidth = Math.max(1, 1.5 * u);
    ctx.strokeRect(barX - 1, barY - 1, barW + 2, barH + 2);

    // Boss'a giden elektrik bağı (Tether arc)
    if (boss && boss.shielded) {
      ctx.strokeStyle = 'rgba(192, 132, 252, 0.7)';
      ctx.lineWidth = Math.max(1, 2.5 * u);
      ctx.beginPath();
      ctx.moveTo(x, y + floatY);

      // Zikzaklı elektrik kıvılcımı
      const midX = (x + boss.x) / 2 + (Math.random() - 0.5) * 20;
      const midY = (y + floatY + boss.y) / 2 + (Math.random() - 0.5) * 20;
      ctx.lineTo(midX, midY);
      ctx.lineTo(boss.x, boss.y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/**
 * Şok Dalgaları (Quake Rings)
 */
function drawShockwaves(ctx, shockwaves, u = 1) {
  for (const s of shockwaves) {
    const { x, y, radius, maxRadius } = s;
    if (!finite(x) || !finite(y) || radius <= 0) continue;

    const alpha = Math.max(0, 1 - radius / (maxRadius || 390));
    ctx.save();
    ctx.strokeStyle = `rgba(239, 68, 68, ${alpha * 0.85})`;
    ctx.lineWidth = Math.max(1, 4.5 * u);
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();

    // İç hafif dolgu
    ctx.fillStyle = `rgba(239, 68, 68, ${alpha * 0.12})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/**
 * Havan Topu Hedef Halkaları (Mortar Decals)
 */
function drawMortars(ctx, mortars, u = 1) {
  for (const m of mortars) {
    const { x, y, radius, fuse, maxFuse } = m;
    if (!finite(x) || !finite(y) || radius <= 0) continue;

    const progress = Math.max(0, Math.min(1, 1 - fuse / (maxFuse || 1.4)));
    ctx.save();
    // Tehlike çemberi tabanı
    ctx.fillStyle = 'rgba(239, 68, 68, 0.16)';
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.65)';
    ctx.lineWidth = Math.max(1, 2 * u);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Geri sayım radyal dilimi (Ticking sector)
    ctx.fillStyle = 'rgba(239, 68, 68, 0.45)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, radius, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    ctx.closePath();
    ctx.fill();

    // Merkez hedefleme artı işareti
    ctx.strokeStyle = COLOR_RED;
    ctx.lineWidth = Math.max(1, 2 * u);
    ctx.beginPath();
    ctx.moveTo(x - 8, y);
    ctx.lineTo(x + 8, y);
    ctx.moveTo(x, y - 8);
    ctx.lineTo(x, y + 8);
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Mermiler (Bullets — krem zeminde yönlü izli okunabilir siluet)
 */
function drawBullets(ctx, bullets, u = 1) {
  for (const b of bullets) {
    const { x, y, vx = 0, vy = 0, color, radius } = b;
    if (!finite(x) || !finite(y)) continue;

    const r = Math.max(2.5, radius || 3.5 * u);
    const spd = Math.hypot(vx, vy);
    ctx.save();
    if (spd > 1) {
      const nx = vx / spd;
      const ny = vy / spd;
      const tail = r * 2.5;
      ctx.lineCap = 'round';
      ctx.strokeStyle = COLOR_INK;
      ctx.lineWidth = Math.max(2, r * 1.9 + 0.5 * u);
      ctx.beginPath();
      ctx.moveTo(x - nx * tail, y - ny * tail);
      ctx.lineTo(x + nx * r * 0.5, y + ny * r * 0.5);
      ctx.stroke();

      ctx.strokeStyle = color || COLOR_CYAN;
      ctx.lineWidth = Math.max(1.5, r * 1.2 + 0.3 * u);
      ctx.beginPath();
      ctx.moveTo(x - nx * tail * 0.85, y - ny * tail * 0.85);
      ctx.lineTo(x + nx * r * 0.4, y + ny * r * 0.4);
      ctx.stroke();

      ctx.fillStyle = COLOR_WHITE;
      ctx.beginPath();
      ctx.arc(x + nx * r * 0.2, y + ny * r * 0.2, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = COLOR_INK;
      ctx.beginPath();
      ctx.arc(x, y, r + 1.2 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color || COLOR_CYAN;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/**
 * Oyuncu Varlıkları & Diriltme Halkaları
 */
function drawPlayers(ctx, players, arena, now = 0, u = 1) {
  for (const p of players) {
    if (!p.joined || !finite(p.x) || !finite(p.y)) continue;

    const {
      x, y, vx = 0, vy = 0, radius, angle, color, hp, hpMax,
      weaponId, ammo = 0, magazine = 1, reloading = false, reloadProgress = 0,
      isDowned, reviveProgress, invincible, hurtInvuln = false, hitFlash = 0,
    } = p;

    ctx.save();
    if (isDowned) {
      // Düşmüş oyuncu (Downed Tomb State)
      ctx.fillStyle = 'rgba(15, 23, 42, 0.4)';
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#94A3B8';
      ctx.lineWidth = Math.max(1, 3 * u);
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.8, 0, Math.PI * 2);
      ctx.stroke();

      // Kurtarma İlerleme Çemberi (Revive radial ring)
      if (reviveProgress > 0) {
        ctx.strokeStyle = COLOR_GOLD;
        ctx.lineWidth = Math.max(1, 5 * u);
        ctx.beginPath();
        ctx.arc(x, y, radius * 1.3, -Math.PI / 2, -Math.PI / 2 + reviveProgress * Math.PI * 2);
        ctx.stroke();
      }

      // Yardım ikonu / metni
      ctx.fillStyle = COLOR_WHITE;
      ctx.font = `bold ${Math.round(Math.max(10, 12 * u))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(t('colossus.help') || 'SOS', x, y + 4 * u);
    } else {
      // Canlı oyuncu
      if (hurtInvuln && Math.floor(now / 80) % 2 === 1) {
        ctx.globalAlpha = 0.55;
      }
      if (invincible) {
        ctx.strokeStyle = COLOR_WHITE;
        ctx.lineWidth = Math.max(1, 3 * u);
        ctx.beginPath();
        ctx.arc(x, y, radius * 1.28, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Standart Tabletop Avatarı (tam kinetik kanal + smear + flinch + hitFlash)
      drawGameAvatar(ctx, x, y, radius, {
        color,
        angle,
        vx,
        vy,
        hitFlash,
        slot: p.slot,
        isDashing: invincible,
      }, {
        faceMode: 'play',
        now,
      });

      // Silah Namlusu (türe özgü siluet)
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = COLOR_ARMOR_DARK;
      ctx.strokeStyle = COLOR_INK;
      ctx.lineWidth = Math.max(1, 1.5 * u);
      if (weaponId === 'SNIPER') {
        ctx.fillRect(radius * 0.58, -radius * 0.11, radius * 1.05, radius * 0.22);
        ctx.strokeRect(radius * 0.58, -radius * 0.11, radius * 1.05, radius * 0.22);
        ctx.fillStyle = COLOR_PURPLE;
        ctx.fillRect(radius * 0.65, -radius * 0.17, radius * 0.3, radius * 0.12);
      } else if (weaponId === 'SHOTGUN') {
        ctx.fillRect(radius * 0.55, -radius * 0.23, radius * 0.58, radius * 0.46);
        ctx.strokeRect(radius * 0.55, -radius * 0.23, radius * 0.58, radius * 0.46);
        ctx.fillStyle = COLOR_ORANGE;
        ctx.fillRect(radius * 0.92, -radius * 0.23, radius * 0.14, radius * 0.46);
      } else if (weaponId === 'PLASMA') {
        ctx.fillRect(radius * 0.55, -radius * 0.20, radius * 0.64, radius * 0.40);
        ctx.strokeRect(radius * 0.55, -radius * 0.20, radius * 0.64, radius * 0.40);
        ctx.fillStyle = UI_COLORS.colossusPlasma;
        ctx.beginPath();
        ctx.arc(radius * 1.15, 0, radius * 0.15, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(radius * 0.58, -radius * 0.15, radius * 0.74, radius * 0.30);
        ctx.strokeRect(radius * 0.58, -radius * 0.15, radius * 0.74, radius * 0.30);
      }
      ctx.restore();

      // Yeniden doldurma yay halkası
      if (reloading) {
        ctx.strokeStyle = COLOR_GOLD;
        ctx.lineWidth = Math.max(1.5, 3 * u);
        ctx.beginPath();
        ctx.arc(x, y, radius * 1.24, -Math.PI / 2, -Math.PI / 2 + reloadProgress * Math.PI * 2);
        ctx.stroke();
      }

      // Karakter altı mini can pips + şarjör çubuğu
      const pipW = Math.max(4, 6 * u);
      const pipH = Math.max(2.5, 3.2 * u);
      const pipGap = Math.max(2, 3 * u);
      const totalW = hpMax * pipW + (hpMax - 1) * pipGap;
      const startX = x - totalW / 2;
      const pipY = y + radius + Math.max(5, 7 * u);

      for (let i = 0; i < hpMax; i++) {
        ctx.fillStyle = i < hp ? '#22C55E' : '#475569';
        ctx.fillRect(startX + i * (pipW + pipGap), pipY, pipW, pipH);
      }

      const ammoH = Math.max(2, 2.6 * u);
      const ammoY = pipY + pipH + Math.max(2, 2.5 * u);
      const ammoRatio = reloading
        ? reloadProgress
        : Math.max(0, Math.min(1, ammo / Math.max(1, magazine)));
      const lowAmmo = !reloading && ammo <= Math.max(1, Math.round(magazine * 0.25));
      ctx.fillStyle = COLOR_ARMOR_DARK;
      ctx.fillRect(startX, ammoY, totalW, ammoH);
      ctx.fillStyle = reloading ? COLOR_GOLD : (lowAmmo ? COLOR_RED : COLOR_CYAN);
      ctx.fillRect(startX, ammoY, totalW * ammoRatio, ammoH);
    }
    ctx.restore();
  }
}

/**
 * Faz etiketinin TEK kaynağı: sahnede başlık, client'da skorbordu satırı.
 * @param {number} phase
 * @returns {string}
 */
function colossusPhaseLabel(phase) {
  return phase === 3 ? t('colossus.phase3') : (phase === 2 ? t('colossus.phase2') : t('colossus.phase1'));
}

/**
 * Üst Ekran Boss Sağlık & Sersemleme HUD'u
 */
function drawBossHud(ctx, boss, arena, u = 1) {
  if (!boss || !finite(boss.hp) || boss.hp <= 0 || !boss.maxHp) return;

  const { hp, maxHp, phase, state, stagger } = boss;
  const barW = Math.min(arena.width * 0.64, 520 * u);
  const barH = Math.max(10, 14 * u);
  const barX = arena.cx - barW / 2;
  const barY = arena.top + Math.max(40, 44 * u);

  const isStaggered = state === 'STAGGER';
  const hpRatio = Math.max(0, Math.min(1, hp / (maxHp || 1)));
  const staggerRatio = Math.max(0, Math.min(1, stagger / COLOSSUS_TUNING.STAGGER_MAX));

  ctx.save();
  // Boss Başlığı + okunabilir koyu rozet zemini
  const titleText = `${boss.name || 'AEGIS-01'} — ${colossusPhaseLabel(phase)}`;
  const titleFontPx = Math.round(Math.max(10, 12 * u));
  ctx.font = `bold ${titleFontPx}px system-ui, sans-serif`;
  const textW = ctx.measureText ? (ctx.measureText(titleText)?.width || barW * 0.55) : barW * 0.55;
  const tagW = Math.min(barW, textW + 18 * u);
  const tagH = Math.max(16, 18 * u);
  const tagY = barY - tagH - 4 * u;
  ctx.fillStyle = COLOR_ARMOR_DARK;
  ctx.fillRect(arena.cx - tagW / 2, tagY, tagW, tagH);
  ctx.strokeStyle = COLOR_INK;
  ctx.lineWidth = Math.max(1, 1.5 * u);
  ctx.strokeRect(arena.cx - tagW / 2, tagY, tagW, tagH);

  ctx.fillStyle = COLOR_WHITE;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(titleText, arena.cx, tagY + tagH / 2);

  // HP Bar Arka Planı
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);

  // HP Dolgusu (Faz rengine göre)
  const hpColor = phase === 3 ? COLOR_RED : (phase === 2 ? COLOR_PURPLE : COLOR_CYAN);
  ctx.fillStyle = hpColor;
  ctx.fillRect(barX, barY, barW * hpRatio, barH);

  // HP Çerçevesi
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = Math.max(1, 2 * u);
  ctx.strokeRect(barX, barY, barW, barH);

  // Faz İşaretçileri (%65 ve %30 sınırları)
  ctx.strokeStyle = COLOR_WHITE;
  ctx.lineWidth = Math.max(1, 1.5 * u);
  const p2X = barX + barW * COLOSSUS_TUNING.PHASE_2_HP_RATIO;
  const p3X = barX + barW * COLOSSUS_TUNING.PHASE_3_HP_RATIO;
  ctx.beginPath();
  ctx.moveTo(p2X, barY);
  ctx.lineTo(p2X, barY + barH);
  ctx.moveTo(p3X, barY);
  ctx.lineTo(p3X, barY + barH);
  ctx.stroke();

  // Sersemleme (Stagger) Barı (HP barının hemen altında)
  const stagH = Math.max(4, 5 * u);
  const stagY = barY + barH + 3 * u;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
  ctx.fillRect(barX, stagY, barW, stagH);

  ctx.fillStyle = isStaggered ? COLOR_WHITE : COLOR_GOLD;
  ctx.fillRect(barX, stagY, barW * (isStaggered ? 1 : staggerRatio), stagH);

  if (isStaggered) {
    ctx.fillStyle = COLOR_GOLD;
    ctx.font = `bold ${Math.round(Math.max(9, 10 * u))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(t('colossus.staggered'), arena.cx, stagY + 14 * u);
  }

  // Parça Durum Rozetleri (uyarlanabilir genişlik)
  const parts = boss.parts || [];
  if (parts.length > 0) {
    const chipGap = Math.max(4, 8 * u);
    const chipH = Math.max(14, 16 * u);
    const chipY = stagY + (isStaggered ? 24 * u : 10 * u);
    const chipW = Math.min(Math.max(88, 114 * u), (arena.width * 0.85 - chipGap * (parts.length - 1)) / parts.length);
    const totalChipsW = parts.length * chipW + (parts.length - 1) * chipGap;
    const startChipX = arena.cx - totalChipsW / 2;

    parts.forEach((p, idx) => {
      const cx = startChipX + idx * (chipW + chipGap);
      const isBroken = p.broken;
      const partName = t(p.nameKey) || p.id;

      ctx.fillStyle = COLOR_ARMOR_DARK;
      ctx.fillRect(cx, chipY, chipW, chipH);
      ctx.strokeStyle = isBroken ? COLOR_RED : (p.hitFlash > 0 ? COLOR_WHITE : COLOR_ARMOR_LIGHT);
      ctx.lineWidth = Math.max(1, 1.5 * u);
      ctx.strokeRect(cx, chipY, chipW, chipH);

      ctx.font = `bold ${Math.round(Math.max(8, 9 * u))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isBroken ? COLOR_RED : (p.hitFlash > 0 ? COLOR_WHITE : COLOR_CYAN);
      const statusText = isBroken ? `${partName}: [${t('colossus.destroyed') || 'IMHA'}]` : `${partName}: %${Math.round((p.hp / (p.maxHp || 1)) * 100)}`;
      ctx.fillText(statusText, cx + chipW / 2, chipY + chipH / 2);
    });
  }
  ctx.restore();
}

/**
 * Ana Çizim Giriş Noktası
 */
export function drawColossusWorld(ctx, arena, scene, options = {}) {
  const now = options.now || performance.now();
  const joinedPlayer = (scene.players || []).find((p) => p && p.joined !== false && finite(p.radius) && p.radius > 0);
  const u = (arena && finite(arena.unit) && arena.unit > 0)
    ? arena.unit
    : (joinedPlayer ? joinedPlayer.radius / COLOSSUS_PLAYER_RADIUS : Math.max(0.45, Math.min(arena?.width || 820, arena?.height || 820) / 820));

  drawField(ctx, arena, { mode: 'COLOSSUS', seed: hashFieldSeed('COLOSSUS', options.roundId) });

  const phase = scene.phase || scene.gameState;
  if (phase === 'LOBBY') {
    return;
  }

  // 1. Zemin Sütunları
  drawPillars(ctx, scene.pillars, u);

  // 2. Faz 2 Pilonları
  drawPylons(ctx, scene.pylons, scene.boss, now, u);

  // 3. Şok Dalgaları
  drawShockwaves(ctx, scene.shockwaves, u);

  // 4. Havan Topu İkazları
  drawMortars(ctx, scene.mortars, u);

  // 5. Boss (lazer sütunlara kırpılır)
  drawBoss(ctx, scene.boss, arena, now, u, scene.pillars);

  // 6. Oyuncular
  drawPlayers(ctx, scene.players, arena, now, u);

  // 7. Mermiler
  drawBullets(ctx, scene.bullets, u);

  // 7.5 Hasar / durum yüzen yazıları (host↔client aynı görsel)
  if (scene.texts?.length) {
    drawAlphaTexts(ctx, scene.texts, { size: Math.max(12, Math.round(15 * u)), outline: true });
  }

  // 8. Partiküller & FX (tuple snapshot'ları drawFxRings/Pops nesnesine açılır)
  const fxSource = options.fxOverride || scene.fx;
  const particles = options.fxOverride?.particles || scene.particles;
  if (particles?.length) {
    drawCircleParticles(ctx, particles);
  }
  if (fxSource) {
    drawFxRings(ctx, unpackFxRings(fxSource.rings));
    drawFxPops(ctx, unpackFxPops(fxSource.pops));
  }

  // 9. Boss HUD
  drawBossHud(ctx, scene.boss, arena, u);
}

/**
 * Client skorbordu durumu — `hordeHeaderStatus` ile aynı sözleşme
 * (`{ text, tone }`); ton değerleri `hud.headerToneColor` ile uyumludur.
 * Boss HP çubuğu sahne içinde çizildiği için burada YALNIZCA faz/sersemleme
 * etiketi taşınır (ikinci bir HP çubuğu değil).
 * @param {{boss?: {hp?: number, phase?: number, state?: string, shielded?: boolean}}} [scene]
 * @returns {{text: string, tone: string|null}}
 */
export function colossusHeaderStatus(scene = {}) {
  const boss = scene.boss || {};
  if (!boss || !finite(boss.hp) || boss.hp <= 0) {
    return { text: '', tone: null };
  }
  const phase = Number(boss.phase) || 1;
  const staggered = boss.state === 'STAGGER';
  if (staggered) {
    return { text: t('colossus.staggered'), tone: 'urgent' };
  }
  if (phase === 2 && boss.shielded) {
    return { text: t('colossus.phase2Objective'), tone: 'urgent' };
  }
  return {
    text: colossusPhaseLabel(phase),
    tone: phase >= 2 ? 'boss' : null,
  };
}
