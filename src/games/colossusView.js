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
  drawCircleParticles,
  drawFxRings,
  drawFxPops,
  isValidWorldBase,
  isValidFxState,
  packFxState,
  round1,
} from './worldCore.js';
import { COLOSSUS_TUNING, COLOSSUS_WEAPONS } from './colossusConfig.js';

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
  };
}

export function createColossusWorldPacket(game) {
  if (!game) return null;
  const boss = game.boss || {};
  return createWorldSnapshot(game, {
    mode: 'COLOSSUS',
    mapPlayer: mapColossusPlayer,
    extras: {
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
        laserProgress: round1(boss.laserProgress || 0),
        parts: (boss.parts || []).map((p) => ({
          id: p.id,
          nameKey: p.nameKey,
          hp: round1(p.hp),
          maxHp: round1(p.maxHp),
          broken: p.broken === true,
          angleOffset: round1(p.angleOffset || 0),
          distRatio: round1(p.distRatio || 0),
          radius: round1(p.radius || 20),
          hitFlash: round1(p.hitFlash || 0),
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
    players: Array.isArray(frame.players) ? frame.players : [],
    particles: Array.isArray(frame.particles) ? frame.particles : [],
    fx: isValidFxState(frame.fx) ? frame.fx : null,
    victory: frame.victory === true,
    matchOver: frame.matchOver === true,
  };
}

/**
 * 2.5D Boss Çizimi (AEGIS-01 / The Colossus)
 */
function drawBoss(ctx, boss, arena, now = 0, u = 1) {
  const { x, y, angle, radius, hp, maxHp, phase, state, stagger, hitFlash, critFlash, shielded, laserActive, targetSlot, bodyShape = 'mech', parts = [] } = boss;
  if (!finite(x) || !finite(y) || radius <= 0 || !finite(hp) || hp <= 0) return;

  const isStaggered = state === 'STAGGER';
  const corePulse = Math.sin(now * 0.008) * 0.15 + 0.85;

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
      const anim = Math.sin(now * 0.012 + leg.phase) * (isStaggered ? 1 : 6);
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
        ctx.fillRect(-6, -6, 12, 12);
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
      const anim = Math.sin(now * 0.01 + leg.phaseOffset) * (isStaggered ? 2 : 8);
      ctx.translate(leg.x + anim * 0.5, leg.y + anim * 0.3 * leg.flipY);
      ctx.beginPath();
      ctx.roundRect(-radius * 0.22, -radius * 0.14, radius * 0.44, radius * 0.28, 6);
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
    const coreColor = phase === 3 ? COLOR_ORANGE : (phase === 2 ? COLOR_PURPLE : COLOR_CYAN);
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

  // Kırık Parça Kıvılcımları
  for (const part of parts) {
    if (!part.broken) continue;
    const px = Math.cos(part.angleOffset) * (radius * part.distRatio);
    const py = Math.sin(part.angleOffset) * (radius * part.distRatio);
    ctx.save();
    ctx.translate(px, py);
    ctx.strokeStyle = COLOR_GOLD;
    ctx.lineWidth = Math.max(1, 2 * u);
    const sparkAng = (now * 0.02 + part.angleOffset) % (Math.PI * 2);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(sparkAng) * 9, Math.sin(sparkAng) * 9);
    ctx.stroke();
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
      ctx.arc(Math.cos(spAng) * spDist, Math.sin(spAng) * spDist, 4, 0, Math.PI * 2);
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

  // 8. Lazer Işını (Aktifken dünya uzayında çizilir)
  if (laserActive) {
    ctx.save();
    const beamLen = 900;
    const lx = x + Math.cos(angle) * (radius * 0.7);
    const ly = y + Math.sin(angle) * (radius * 0.7);
    const endX = lx + Math.cos(angle) * beamLen;
    const endY = ly + Math.sin(angle) * beamLen;

    // Dış akkor
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
    ctx.lineWidth = Math.max(1, COLOSSUS_TUNING.LASER_BEAM_WIDTH * 1.8 * u);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    // İç parlak ışın
    ctx.strokeStyle = COLOR_WHITE;
    ctx.lineWidth = Math.max(1, COLOSSUS_TUNING.LASER_BEAM_WIDTH * 0.55 * u);
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.restore();
  } else if (!isStaggered && targetSlot >= 0) {
    // Tehdit lazeri (Hedef çizgisi)
    ctx.save();
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.35)';
    ctx.lineWidth = Math.max(1, 1.5 * u);
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    const lx = x + Math.cos(angle) * (radius * 0.7);
    const ly = y + Math.sin(angle) * (radius * 0.7);
    ctx.moveTo(lx, ly);
    ctx.lineTo(lx + Math.cos(angle) * 700, ly + Math.sin(angle) * 700);
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
    ctx.lineWidth = 1;
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
 * Mermiler (Bullets)
 */
function drawBullets(ctx, bullets) {
  for (const b of bullets) {
    const { x, y, color, radius } = b;
    if (!finite(x) || !finite(y)) continue;

    ctx.save();
    ctx.fillStyle = color || COLOR_CYAN;
    ctx.beginPath();
    ctx.arc(x, y, radius || 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/**
 * Oyuncu Varlıkları & Diriltme Halkaları
 */
function drawPlayers(ctx, players, arena, now = 0, u = 1) {
  for (const p of players) {
    if (!p.joined || !finite(p.x) || !finite(p.y)) continue;

    const { x, y, radius, angle, color, hp, hpMax, isDowned, reviveProgress, invincible } = p;

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
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(t('colossus.help') || 'SOS', x, y + 4);
    } else {
      // Canlı oyuncu
      if (invincible) {
        ctx.strokeStyle = COLOR_WHITE;
        ctx.lineWidth = Math.max(1, 3 * u);
        ctx.beginPath();
        ctx.arc(x, y, radius * 1.25, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Standart Tabletop Avatarı
      drawGameAvatar(ctx, x, y, radius, {
        color,
        angle,
      }, {
        faceMode: 'play',
      });

      // Silah Namlusu
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = COLOR_ARMOR_DARK;
      ctx.fillRect(radius * 0.6, -radius * 0.16, radius * 0.7, radius * 0.32);
      ctx.restore();

      // Karakter altı mini can pips
      const pipW = 6;
      const pipGap = 3;
      const totalW = hpMax * pipW + (hpMax - 1) * pipGap;
      const startX = x - totalW / 2;
      const pipY = y + radius + 8;

      for (let i = 0; i < hpMax; i++) {
        ctx.fillStyle = i < hp ? '#22C55E' : '#475569';
        ctx.fillRect(startX + i * (pipW + pipGap), pipY, pipW, 3);
      }
    }
    ctx.restore();
  }
}

/**
 * Faz etiketinin TEK kaynağı: sahnede başlık, client'da skorbordu satırı.
 * (Eski gömülü İngilizce yedekler locale ile ayrışmıştı; kopyalar burada.)
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
  const barW = Math.min(arena.width * 0.68, 540);
  const barH = 14;
  const barX = arena.cx - barW / 2;
  const barY = arena.top + 28;

  const isStaggered = state === 'STAGGER';
  const hpRatio = Math.max(0, Math.min(1, hp / (maxHp || 1)));
  const staggerRatio = Math.max(0, Math.min(1, stagger / COLOSSUS_TUNING.STAGGER_MAX));

  ctx.save();
  // Boss Başlığı
  ctx.fillStyle = COLOR_WHITE;
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${boss.name || 'AEGIS-01'} — ${colossusPhaseLabel(phase)}`, arena.cx, barY - 8);

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
  const stagH = 5;
  const stagY = barY + barH + 4;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
  ctx.fillRect(barX, stagY, barW, stagH);

  ctx.fillStyle = isStaggered ? COLOR_WHITE : COLOR_GOLD;
  ctx.fillRect(barX, stagY, barW * (isStaggered ? 1 : staggerRatio), stagH);

  if (isStaggered) {
    ctx.fillStyle = COLOR_GOLD;
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t('colossus.staggered'), arena.cx, stagY + 16);
  }

  // Parça Durum Rozetleri
  const parts = boss.parts || [];
  if (parts.length > 0) {
    const chipY = stagY + (isStaggered ? 28 : 14);
    const chipW = 105;
    const totalChipsW = parts.length * chipW + (parts.length - 1) * 8;
    const startChipX = arena.cx - totalChipsW / 2;

    parts.forEach((p, idx) => {
      const cx = startChipX + idx * (chipW + 8);
      const isBroken = p.broken;
      const partName = t(p.nameKey) || p.id;

      ctx.fillStyle = COLOR_ARMOR_DARK;
      ctx.fillRect(cx, chipY, chipW, 16);
      ctx.strokeStyle = isBroken ? COLOR_RED : (p.hitFlash > 0 ? COLOR_WHITE : COLOR_ARMOR_LIGHT);
      ctx.lineWidth = 1;
      ctx.strokeRect(cx, chipY, chipW, 16);

      ctx.font = 'bold 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isBroken ? COLOR_RED : (p.hitFlash > 0 ? COLOR_WHITE : COLOR_CYAN);
      const statusText = isBroken ? `${partName}: [${t('colossus.destroyed') || 'İMHA'}]` : `${partName}: %${Math.round((p.hp / (p.maxHp || 1)) * 100)}`;
      ctx.fillText(statusText, cx + chipW / 2, chipY + 8);
    });
  }
  ctx.restore();
}

/**
 * Ana Çizim Giriş Noktası
 */
export function drawColossusWorld(ctx, arena, scene, options = {}) {
  const now = options.now || performance.now();
  const u = (arena && arena.unit) || 1;

  // 0. Zemin: statik saha TEK kaynaktan (`fieldKit`), diğer 12 oyunla aynı
  //    yerleşim (AGENTS §3). Bu çağrı YOKTU — masa tablası hiç çizilmiyordu,
  //    oyun boş koyu bir dikdörtgen içinde oynanıyordu.
  drawField(ctx, arena, { mode: 'COLOSSUS', seed: hashFieldSeed('COLOSSUS', options.roundId) });

  if (scene.phase === 'LOBBY') {
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

  // 5. Boss
  drawBoss(ctx, scene.boss, arena, now, u);

  // 6. Oyuncular
  drawPlayers(ctx, scene.players, arena, now, u);

  // 7. Mermiler
  drawBullets(ctx, scene.bullets);

  // 8. Partiküller & FX
  if (scene.particles?.length) {
    drawCircleParticles(ctx, scene.particles);
  }
  if (scene.fx) {
    drawFxRings(ctx, scene.fx.rings);
    drawFxPops(ctx, scene.fx.pops);
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
