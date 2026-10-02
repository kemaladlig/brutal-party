// Paylaşılan HEIST dünya snapshot'ı + çizim sınırı (worldCore deseni).
// Yetkili host, uzak telefon client'larıyla aynı çizim yardımcılarını kullanır;
// client simülasyon/AI import etmez, yalnız salt-okunur draw + snapshot/validator alır.
// Not: loot/gemi ikonları tek kaynak tabletopIcons vektörleridir (ham OS emojisi yok);
// coin yıldızı (★) tüm platformlarda metin render edilen stabil bir gliftir.

import { drawGameAvatar, drawGameAvatar25d } from '../core/avatarInGame.js';
import { fxReadAlpha } from '../core/fxKit.js';
import { drawTabletopIcon } from '../core/tabletopIcons.js';
import {
  drawObstacle,
  drawObstacle25dShadow,
  drawObstacle25dMass,
  sceneDraw,
  obstacleBaseY,
  entitySceneY,
} from '../core/arenaKit.js';
import { drawField, hashFieldSeed, drawField25d, drawFieldRail, fieldRailBaseY } from '../core/fieldKit.js';
import { materialFromColor } from '../core/projection2d.js';
import { drawStatusChip } from '../core/entityStatus.js';
import { groundRect, chipAt, queuePlayers } from '../core/sceneKit.js';
import { UI_COLORS } from '../ui/tokens.js';
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
  drawSquareParticles,
} from './worldCore.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// HEIST 2.5D teması: harita seçimi yok — tek sabit tema (host ve ONLINE client
// AYNI sabiti kullanır; paket alanı gerekmez, derleme-zamanı değeridir).
export const HEIST_THEME_25D = 'wood';
// Kenar tamponlarının taban-y sırası: kuzey/batı arkaya, güney/doğu öne.
const RAIL_SIDES = /** @type {const} */ (['north', 'west', 'east', 'south']);

// --- Snapshot serializer (host tarafı, deklaratif extras) ---
export function createHeistWorldPacket(game) {
  if (!game) return null;
  return createWorldSnapshot(game, {
    mode: 'HEIST',
    mapPlayer: (p) => ({
      slot: p.index,
      joined: p.isJoined !== false,
      alive: p.isAlive !== false,
      x: round1(p.x || 0),
      y: round1(p.y || 0),
      angle: round1(p.facingAngle || 0),
      radius: round1(p.radius),
      stumble: round1(p.stumbleTimer || 0),
      tackling: p.isTackling === true,
      carried: Number(p.carriedGold) || 0,
      vault: Number(p.vaultGold) || 0,
      cd: round1(p.tackleCooldown || 0),
    }),
    extras: {
      selfPredict: true,
      roundTimer: round1(game.roundTimer || 0),
      goldRush: game.goldRushActive === true,
      matchDraw: game.matchDraw === true,
      pillars: packRectList(game.pillars, 8),
      vaults: (Array.isArray(game.vaults) ? game.vaults : []).slice(0, 4).map((v) => [
        round1(v.x), round1(v.y), round1(v.w), round1(v.h), v.playerIndex,
      ]),
      loot: (Array.isArray(game.lootItems) ? game.lootItems : []).slice(0, 24).map((item) => [
        round1(item.x), round1(item.y), round1(item.radius || 10), item.type || 'COIN',
      ]),
      piggy: game.piggyBank ? {
        x: round1(game.piggyBank.x),
        y: round1(game.piggyBank.y),
        radius: round1(game.piggyBank.radius || 18),
        hp: Number(game.piggyBank.hp) || 0,
        maxHp: Number(game.piggyBank.maxHp) || 1,
        anim: round1(game.piggyBank.animTime || 0),
      } : null,
      texts: (Array.isArray(game.floatingTexts) ? game.floatingTexts : []).slice(0, 8).map((ft) => ({
        x: round1(ft.x),
        y: round1(ft.y),
        text: String(ft.text || '').slice(0, 24),
        life: round1(ft.life || 0),
        maxLife: round1(ft.maxLife || 1),
        color: typeof ft.color === 'string' ? ft.color : '#1C1C1A',
      })),
      // FX kanalı (MOTION_PLAN Faz 2b): host FX runtime'ının saf anlık görüntüsü
      // (tanks deseni). Playback canlıyken paket yükü yok sayılır (yedek kanal).
      fx: packFxState(game.fx),
    },
  });
}

function isValidHeistPlayer(p) {
  return typeof p.joined === 'boolean' && typeof p.alive === 'boolean'
    && finite(p.angle) && finite(p.radius)
    && finite(p.stumble) && typeof p.tackling === 'boolean'
    && Number.isInteger(p.carried) && Number.isInteger(p.vault) && finite(p.cd);
}

function isValidHeistExtra(frame) {
  if (!finite(frame.roundTimer) || typeof frame.goldRush !== 'boolean' || typeof frame.matchDraw !== 'boolean') return false;
  if (!Array.isArray(frame.pillars) || frame.pillars.length > 8) return false;
  if (!frame.pillars.every((r) => Array.isArray(r) && r.length === 4 && r.every(finite))) return false;
  if (!Array.isArray(frame.vaults) || frame.vaults.length > 4) return false;
  if (!frame.vaults.every((v) => Array.isArray(v) && v.length === 5
    && finite(v[0]) && finite(v[1]) && finite(v[2]) && finite(v[3])
    && Number.isInteger(v[4]) && v[4] >= 0 && v[4] <= 3)) return false;
  if (!Array.isArray(frame.loot) || frame.loot.length > 24) return false;
  if (!frame.loot.every((l) => Array.isArray(l) && l.length === 4
    && finite(l[0]) && finite(l[1]) && finite(l[2]) && typeof l[3] === 'string')) return false;
  const pig = frame.piggy;
  if (pig !== null && !(pig && finite(pig.x) && finite(pig.y) && finite(pig.radius)
    && Number.isInteger(pig.hp) && Number.isInteger(pig.maxHp) && finite(pig.anim))) return false;
  if (!Array.isArray(frame.texts) || frame.texts.length > 8) return false;
  if (!frame.texts.every((ft) => ft && finite(ft.x) && finite(ft.y) && typeof ft.text === 'string'
    && finite(ft.life) && finite(ft.maxLife) && typeof ft.color === 'string')) return false;
  // fx alanı v2 eklentisidir; eski host frames'i yoktur (opsiyonel, v1 uyumu).
  if (frame.fx !== undefined && !isValidFxState(frame.fx)) return false;
  return true;
}

// --- Client frame doğrulaması ---
export function isValidHeistWorldFrame(frame) {
  return isValidWorldBase(frame, 'HEIST', {
    checkPlayer: isValidHeistPlayer,
    checkExtra: isValidHeistExtra,
  });
}

// --- Ortak çizim yardımcıları (host + client) ---
/**
 * HEIST'e özgü STATİK işaret — bake'in içine girer.
 *
 * Modül seviyesinde sabit fonksiyon olmak ZORUNDA: `drawField` cache anahtarı
 * `marks`'i taşımaz. Köşe plakaları ve kesikli merkez halkası artık sırasıyla
 * `fieldKit`'in `corners: 'plate'` dili ve `vault` motifidir — burada tekrarlanmaz.
 */
function heistFieldMarks(ctx, pf, palette) {
  const { width: w, height: h, unit: u } = pf;
  ctx.strokeStyle = palette.frame;
  ctx.lineWidth = Math.max(1, 1.5 * u);
  ctx.strokeRect(w * 0.12, h * 0.12, w * 0.76, h * 0.76);
}

export function drawHeistArena(ctx, arena, pillars, opts = {}) {
  const proj = opts.proj || null;
  if (proj) {
    // 2.5D eğik saha: masa zemini `drawField25d` içinde boyanır (çağıran
    // `paintBackdrop` çizmez). Kenar tamponları ve engel prizmaları DERİNLİK
    // kuyruğuna girer (çağıran `sceneBegin`/`sceneEnd` penceresi açar); engel
    // temas gölgeleri zeminde kalır.
    drawField25d(ctx, proj, arena);
    for (const side of RAIL_SIDES) {
      sceneDraw(ctx, fieldRailBaseY(arena, side), drawFieldRail, proj, { arena, side });
    }
    for (const pil of pillars) {
      drawObstacle25dShadow(ctx, proj, pil);
      sceneDraw(ctx, obstacleBaseY(pil), drawObstacle25dMass, proj, pil);
    }
    return;
  }
  // Statik saha `fieldKit`'te: ılık kum tonlu zemin, dokuma dokusu, kesikli altın
  // merkez halkası, iç sınır kutusu, köşe plakaları ve yuvarlatılmış tepsi
  // kesimi. Eskiden bunun tamamı HER FRAME raster ediliyordu.
  drawField(ctx, arena, {
    mode: 'HEIST',
    seed: hashFieldSeed('HEIST', opts.roundId),
    marks: heistFieldMarks,
  });

  for (const pil of pillars) {
    drawObstacle(ctx, pil, { theme: 'HEIST' });
  }
}

/** 2.5D kasa bölgesi: zemine projekte edilmiş alan + isim/altın billboard'u. */
function drawHeistVault25d(ctx, proj, v, p) {
  const gold = Number(p.vault) || 0;
  const vu = (v.w || 80) / 80;
  groundRect(ctx, proj, v, { fill: UI_COLORS.crownGold, alpha: 0.14 });
  if (gold > 0) {
    // Altınla dolan kasa hissi: dolgu yoğunluğu banka sayısıyla artar.
    groundRect(ctx, proj, v, { fill: UI_COLORS.crownGold, alpha: Math.min(0.3, 0.08 + gold * 0.012) });
  }
  groundRect(ctx, proj, v, { stroke: p.color || UI_COLORS.crownGold, lineWidth: Math.max(1.5, 3 * vu) });

  // Billboard: isim plakası + altın sayısı (projekte merkez, ekran-sabit ölçek).
  const c = proj.proj(v.x + v.w / 2, v.y + v.h / 2, 0);
  const k = proj.view.scale * c.d;
  const badgeW = Math.max(24, (v.w - 8) * k);
  const badgeH = Math.max(14, 28 * k);
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.fillStyle = UI_COLORS.inkDark;
  ctx.fillRect(-badgeW / 2, -badgeH * 1.15, badgeW, badgeH);
  ctx.fillStyle = UI_COLORS.white;
  ctx.font = `900 ${Math.max(9, Math.round(14 * k))}px "Space Grotesk", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${p.name || ''}`, 0, -badgeH * 0.65);
  const numSize = Math.max(16, Math.min(40, Math.floor((v.w || 80) * 0.3)) * k);
  ctx.font = `900 ${Math.round(numSize)}px "Space Grotesk", sans-serif`;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = UI_COLORS.inkDark;
  ctx.lineWidth = Math.max(2, 4 * k);
  ctx.strokeText(`${gold}`, 0, badgeH * 0.2);
  ctx.fillStyle = UI_COLORS.crownGold;
  ctx.fillText(`${gold}`, 0, badgeH * 0.2);
  ctx.restore();
}

export function drawHeistVaults(ctx, vaults, players, proj = null) {
  const bySlot = new Map((players || []).map((p) => [p.slot ?? p.index, p]));
  for (const v of vaults) {
    const p = bySlot.get(v.playerIndex);
    if (!isWorldEntityVisible(p)) continue;

    if (proj) {
      // 2.5D: kasa zeminde projekte alan; billboard ekran-okunur kalır.
      drawHeistVault25d(ctx, proj, v, p);
      continue;
    }

    const isTop = v.playerIndex === 1 || v.playerIndex === 2;
    const vu = (v.w || 80) / 80;

    ctx.save();
    ctx.fillStyle = 'rgba(217, 155, 38, 0.12)';
    ctx.fillRect(v.x, v.y, v.w, v.h);
    ctx.strokeStyle = p.color || '#D99B26';
    ctx.lineWidth = Math.max(1.5, 3 * vu);
    ctx.strokeRect(v.x, v.y, v.w, v.h);

    ctx.save();
    ctx.translate(v.x + v.w / 2, v.y + v.h / 2);
    if (isTop) ctx.rotate(Math.PI);

    const badgeW = v.w - 8;
    const badgeH = 28;
    ctx.fillStyle = '#1C1C1A';
    ctx.fillRect(-badgeW / 2, -v.h / 2 + 4, badgeW, badgeH);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 14px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${p.name || ''}`, 0, -v.h / 2 + 18);

    const vaultGold = Number(p.vault) || 0;
    if (v.h >= 80) {
      if (vaultGold >= 6) {
        ctx.globalAlpha = Math.min(0.3, 0.1 + vaultGold * 0.012);
        ctx.fillStyle = '#FFDE59';
        ctx.fillRect(-v.w / 2 + 4, -v.h / 2 + 26, v.w - 8, v.h - 34);
        ctx.globalAlpha = 1;
      }
      const rows = [6, 5, 4];
      const iw = (v.w - 24) / 6;
      const ih = 11;
      let drawn = 0;
      const target = Math.min(15, vaultGold);
      for (let r = 0; r < rows.length && drawn < target; r++) {
        const count = Math.min(rows[r], target - drawn);
        const rowW = count * iw;
        for (let c = 0; c < count; c++) {
          const ix = -rowW / 2 + c * iw;
          const iy = v.h / 2 - 8 - ih - r * (ih + 3);
          ctx.fillStyle = '#FFDE59';
          ctx.beginPath();
          ctx.moveTo(ix + 1, iy + ih);
          ctx.lineTo(ix + 3, iy);
          ctx.lineTo(ix + iw - 3, iy);
          ctx.lineTo(ix + iw - 1, iy + ih);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#1C1C1A';
          ctx.lineWidth = Math.max(1, 1.5 * vu);
          ctx.stroke();
          ctx.strokeStyle = '#FFF6C9';
          ctx.lineWidth = Math.max(1, 1.5 * vu);
          ctx.beginPath();
          ctx.moveTo(ix + 4, iy + 3);
          ctx.lineTo(ix + iw - 4, iy + 3);
          ctx.stroke();
          drawn++;
        }
      }
    }

    const numSize = Math.max(18, Math.min(34, Math.floor(v.w * 0.27)));
    ctx.fillStyle = '#1C1C1A';
    ctx.font = `900 ${numSize}px "Space Grotesk", sans-serif`;
    ctx.fillText(`${vaultGold}`, 0, v.h >= 80 ? -6 : 8);

    ctx.restore();
    ctx.restore();
  }
}

/** Tek ganimet öğesi — 2.5D'de zeminden yüzen rozet (projekte + kamera ölçeği). */
function drawHeistLootItem25d(ctx, s) {
  const { proj, item } = s;
  const r0 = item.radius || 10;
  const sp = proj.proj(item.x, item.y, r0);
  const k = proj.view.scale * sp.d;
  const r = r0 * k;
  const lu = Math.max(0.5, r / 10);
  ctx.save();
  ctx.translate(sp.x, sp.y);

  ctx.globalAlpha = 0.25;
  ctx.fillStyle = UI_COLORS.inkDark;
  ctx.beginPath();
  ctx.arc(2 * lu, 2 * lu, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  if (item.type === 'CROWN') {
    ctx.fillStyle = UI_COLORS.crownGold;
    ctx.fillRect(-12 * lu, -8 * lu, 24 * lu, 16 * lu);
    ctx.strokeStyle = UI_COLORS.inkDark;
    ctx.lineWidth = Math.max(1, 2.5 * lu);
    ctx.strokeRect(-12 * lu, -8 * lu, 24 * lu, 16 * lu);
    drawTabletopIcon(ctx, 'crown', 0, 0, 16 * lu, { color: UI_COLORS.white });
  } else if (item.type === 'DIAMOND' || item.type === 'RUBY') {
    ctx.fillStyle = item.type === 'DIAMOND' ? UI_COLORS.crownTeleport : UI_COLORS.heistPiggy;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = UI_COLORS.lineDark;
    ctx.lineWidth = Math.max(1, 2.2 * lu);
    ctx.stroke();
    drawTabletopIcon(ctx, 'gem', 0, lu, Math.max(12, r * 1.1), { color: UI_COLORS.white });
  } else {
    ctx.fillStyle = UI_COLORS.crownGold;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = UI_COLORS.inkDark;
    ctx.lineWidth = Math.max(1, 2 * lu);
    ctx.stroke();
    drawTabletopIcon(ctx, 'star', 0, 0, Math.max(10, r * 1.3), { color: UI_COLORS.inkDark });
  }
  ctx.restore();
}

export function drawHeistLoot(ctx, loot, proj = null) {
  if (proj) {
    // 2.5D: zemin öğesi — taban-y sırasına girer ki oyuncu/engel önüne geçsin.
    for (const item of loot) {
      sceneDraw(ctx, entitySceneY(item.y, item.radius || 10), drawHeistLootItem25d, { proj, item });
    }
    return;
  }
  for (const item of loot) {
    ctx.save();
    ctx.translate(item.x, item.y);
    const r = item.radius || 10;
    const lu = r / 10;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.beginPath();
    ctx.arc(2, 2, r, 0, Math.PI * 2);
    ctx.fill();

    if (item.type === 'DIAMOND') {
      ctx.fillStyle = UI_COLORS.crownTeleport;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = UI_COLORS.lineDark;
      ctx.lineWidth = Math.max(1, 2.2 * lu);
      ctx.stroke();
      drawTabletopIcon(ctx, 'gem', 0, 1, Math.max(12, r * 1.1), { color: UI_COLORS.white });
    } else if (item.type === 'RUBY') {
      ctx.fillStyle = UI_COLORS.heistPiggy;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = UI_COLORS.lineDark;
      ctx.lineWidth = Math.max(1, 2.2 * lu);
      ctx.stroke();
      drawTabletopIcon(ctx, 'gem', 0, 1, Math.max(12, r * 1.1), { color: UI_COLORS.white });
    } else if (item.type === 'CROWN') {
      ctx.fillStyle = '#D99B26';
      ctx.fillRect(-12, -8, 24, 16);
      ctx.strokeStyle = '#1C1C1A';
      ctx.lineWidth = Math.max(1, 2.5 * lu);
      ctx.strokeRect(-12, -8, 24, 16);
      drawTabletopIcon(ctx, 'crown', 0, 1, 16, { color: '#FFFFFF' });
    } else {
      ctx.fillStyle = '#FFDE59';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1C1C1A';
      ctx.lineWidth = Math.max(1, 2 * lu);
      ctx.stroke();
      drawTabletopIcon(ctx, 'star', 0, 0, Math.max(10, r * 1.3), { color: '#1C1C1A' });
    }

    ctx.restore();
  }
}

/** 2.5D kumbara: projekte silindir gövde + üstte para yuvası billboard'u. */
function drawHeistPiggy25d(ctx, proj, pig) {
  const r = pig.radius || 18;
  const squash = 1 + Math.sin((pig.anim || 0) * 8) * 0.08;
  const h = r * 1.5 * squash;
  proj.contactPatch(ctx, pig.x, pig.y, r * 1.05, r * 0.5, 0.32);
  proj.drawCylinder(ctx, pig.x, pig.y, r, h, materialFromColor(UI_COLORS.heistPiggy));

  const top = proj.proj(pig.x, pig.y, h);
  const k = proj.view.scale * top.d;
  ctx.save();
  ctx.translate(top.x, top.y);
  ctx.fillStyle = UI_COLORS.crownGold;
  ctx.beginPath();
  ctx.ellipse(0, 0, 9 * k, 5 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = UI_COLORS.inkDark;
  ctx.fillRect(-4 * k, -1 * k, 8 * k, 2 * k);
  ctx.restore();

  const maxHp = Math.max(1, pig.maxHp || 1);
  if (maxHp <= 1) {
    // Tek vuruş kimliği: can pip'i yok, nabız gibi atan bonus halkası var.
    const pulse = 1 + Math.sin((pig.anim || 0) * 6) * 0.12;
    proj.groundRing(ctx, pig.x, pig.y, (r + 8) * pulse, UI_COLORS.heistPiggy, Math.max(2, 3));
    return;
  }
  const pipW = 10 * k;
  const pipH = 5 * k;
  const startPipX = top.x - (maxHp * (pipW + 3 * k)) / 2;
  const pipY = top.y - r * k - 14 * k;
  for (let i = 0; i < maxHp; i++) {
    const px = startPipX + i * (pipW + 3 * k);
    ctx.fillStyle = i < (pig.hp || 0) ? UI_COLORS.crownGreen : UI_COLORS.crownRed;
    ctx.fillRect(px, pipY, pipW, pipH);
    ctx.strokeStyle = UI_COLORS.inkDark;
    ctx.lineWidth = Math.max(1, 1.5 * k);
    ctx.strokeRect(px, pipY, pipW, pipH);
  }
}

export function drawHeistPiggy(ctx, piggy, proj = null) {
  if (!piggy) return;
  const pig = piggy;

  if (proj) {
    drawHeistPiggy25d(ctx, proj, pig);
    return;
  }

  ctx.save();
  ctx.translate(pig.x, pig.y);

  const squash = 1 + Math.sin((pig.anim || 0) * 8) * 0.08;
  ctx.scale(squash, 1 / squash);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.beginPath();
  ctx.arc(3, 4, pig.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = UI_COLORS.heistPiggy;
  ctx.beginPath();
  ctx.arc(0, 0, pig.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, 3 * ((pig.radius || 18) / 18));
  ctx.strokeStyle = UI_COLORS.lineDark;
  ctx.stroke();

  ctx.fillStyle = UI_COLORS.crownGold;
  ctx.beginPath();
  ctx.arc(0, 2, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = UI_COLORS.lineDark;
  ctx.fillRect(-6, -14, 12, 3);

  ctx.beginPath();
  ctx.moveTo(-14, -14);
  ctx.lineTo(-6, -20);
  ctx.lineTo(-4, -10);
  ctx.closePath();
  ctx.fillStyle = UI_COLORS.heistPiggy;
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(14, -14);
  ctx.lineTo(6, -20);
  ctx.lineTo(4, -10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.restore();

  ctx.save();
  const maxHp = Math.max(1, pig.maxHp || 1);
  if (maxHp <= 1) {
    // Tek vuruş kimliği: can pip'i yok, nabız gibi atan bonus halkası var.
    const pulse = 1 + Math.sin((pig.anim || 0) * 6) * 0.12;
    ctx.strokeStyle = UI_COLORS.heistPiggy;
    ctx.lineWidth = Math.max(2, 3 * ((pig.radius || 18) / 18));
    ctx.beginPath();
    ctx.arc(pig.x, pig.y, (pig.radius + 8) * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const pipW = 10;
  const pipH = 5;
  const startPipX = pig.x - (maxHp * (pipW + 3)) / 2;
  const pipY = pig.y - pig.radius - 12;
  for (let h = 0; h < maxHp; h++) {
    ctx.fillStyle = h < (pig.hp || 0) ? '#2D6A4F' : '#E63946';
    ctx.fillRect(startPipX + h * (pipW + 3), pipY, pipW, pipH);
    ctx.strokeStyle = '#1C1C1A';
    ctx.lineWidth = Math.max(1, 1.5 * ((pig.radius || 18) / 18));
    ctx.strokeRect(startPipX + h * (pipW + 3), pipY, pipW, pipH);
  }
  ctx.restore();
}

/**
 * Kare-geneli sabitler (kare başına tahsis yok). Oyuncuya özel veri `player`
 * nesnesinde taşınır; bu nesne yalnız sahne boyunca sabit kalan alanları tutar
 * (BOMB `PLAYER_ST` deseni).
 */
const HEIST_PLAYER_ST = {
  withFx: true, now: 0, arena: null, selfSlot: -1, hasViewer: false, richestIndex: -1, proj: null,
};

/** Tek oyuncu — 2.5D sahne kuyruğu öğesi (küre avatar + zemin halkaları + çuval). */
function drawHeistPlayer25d(ctx, player, st) {
  const {
    withFx, now, selfSlot, hasViewer, richestIndex, proj,
  } = st;
  const radius = player.radius || 36;
  const slot = player.slot ?? player.index;
  const u = radius / 36;
  const k = proj.view.scale * proj.proj(player.x, player.y, 0).d;

  // En-zengin halkası + tackle halkası: zemine projekte (koyu taban + altın üst).
  if (withFx && slot === richestIndex) {
    const pulse = Math.sin(performance.now() * 0.01) * 3;
    proj.groundRing(ctx, player.x, player.y, radius + 10 * u + pulse, UI_COLORS.hudAmber, Math.max(2, 3 * u * k));
  }
  if (withFx && player.tackling) {
    proj.groundRing(ctx, player.x, player.y, radius + 6 * u, UI_COLORS.hudAmber, Math.max(2, 4 * u * k));

    // Tackle yön konisi: zemine projekte edilmiş kama (üstten bakıştaki
    // radyal gradyanın 2.5D karşılığı — yön bilgisi korunur).
    const aim = player.angle || 0;
    const r0 = radius * 0.8;
    const r1 = radius + 36 * u;
    const apex = proj.proj(player.x + Math.cos(aim) * r0, player.y + Math.sin(aim) * r0, 0);
    const c0 = proj.proj(player.x + Math.cos(aim - 0.42) * r1, player.y + Math.sin(aim - 0.42) * r1, 0);
    const c1 = proj.proj(player.x + Math.cos(aim + 0.42) * r1, player.y + Math.sin(aim + 0.42) * r1, 0);
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = player.color || UI_COLORS.crownGold;
    ctx.beginPath();
    ctx.moveTo(apex.x, apex.y);
    ctx.lineTo(c0.x, c0.y);
    ctx.lineTo(c1.x, c1.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  let currentExp = 'normal';
  if (player.stumble > 0) currentExp = 'dizzy';
  else if (player.tackling) currentExp = 'angry';
  else if ((player.carried || 0) >= 5) currentExp = 'excited';
  else if ((player.carried || 0) > 0) currentExp = 'wink';

  const figure = drawGameAvatar25d(ctx, proj, player, {
    x: player.x,
    y: player.y,
    radius,
    color: player.color || UI_COLORS.crownGold,
    facingAngle: player.angle || 0,
    expression: currentExp,
    borderColor: player.tackling ? UI_COLORS.hudAmber : (player.rimColor || UI_COLORS.lineDark),
    borderWidth: Math.max(1.5, (player.tackling ? 4.5 : 3) * u * k),
    lookAngle: (player.vx || player.vy) && !player.tackling
      ? Math.atan2(player.vy || 0, player.vx || 0)
      : undefined,
    now,
    alpha: fxReadAlpha({ isSelf: hasViewer && slot === selfSlot, hasViewer }),
  });

  // Sırt çuvalı: baş üstüne billboard (ekran-okunur ölçek, kamera derinliğiyle).
  if ((player.carried || 0) > 0) {
    const gold = player.carried;
    const tier = gold >= 10 ? 2 : gold >= 5 ? 1 : 0;
    const bagY = figure.topY - 14 * u * k;
    const coins = Math.min(8, gold);
    const coinR = (tier === 2 ? 8.5 : 7.5) * u * k;
    const step = coinR * 1.25;
    if (withFx && tier >= 1) {
      ctx.save();
      ctx.globalAlpha = tier === 2 ? 0.35 : 0.22;
      ctx.fillStyle = UI_COLORS.crownGold;
      ctx.beginPath();
      ctx.arc(figure.headX, bagY - 20 * u * k, figure.headR + 16 + tier * 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    for (let c = 0; c < coins; c++) {
      const cy = bagY - 12 * u * k - c * step;
      ctx.fillStyle = UI_COLORS.crownGold;
      ctx.beginPath();
      ctx.arc(figure.headX, cy, coinR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = UI_COLORS.inkDark;
      ctx.lineWidth = Math.max(1, 2 * u * k);
      ctx.stroke();
    }
    const plateW = 64 * u * k;
    const plateH = 22 * u * k;
    ctx.fillStyle = UI_COLORS.inkDark;
    ctx.fillRect(figure.headX - plateW / 2, bagY - plateH / 2, plateW, plateH);
    ctx.strokeStyle = tier >= 1 ? UI_COLORS.crownGold : UI_COLORS.white;
    ctx.lineWidth = Math.max(1.5, 2.5 * u * k);
    ctx.strokeRect(figure.headX - plateW / 2, bagY - plateH / 2, plateW, plateH);
    ctx.fillStyle = tier >= 1 ? UI_COLORS.crownGold : UI_COLORS.white;
    ctx.font = `900 ${Math.max(10, Math.round(13 * u * k))}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${gold} G`, figure.headX, bagY);
  }

  const cdProg = withFx && player.cd > 0
    ? 1.0 - Math.max(0, Math.min(1, player.cd / 3.5))
    : null;
  if (cdProg !== null) {
    chipAt(ctx, proj, { x: player.x, y: player.y, radius }, {
      scale: u,
      icon: 'zap',
      progress: cdProg,
      remaining: Math.max(0, player.cd),
    });
  }
}

export function drawHeistPlayers(ctx, players, { withFx = true, now = 0, arena = null, selfSlot = -1, proj = null } = {}) {
  // 3.3: tek görür varsa kendi avatarın T1, diğerleri T3 (−%25); α fxKit'ten.
  const hasViewer = Number.isInteger(selfSlot) && selfSlot >= 0;
  let richestIndex = -1;
  let maxCarried = 2;
  for (const p of players) {
    if (isWorldEntityVisible(p) && (p.carried || 0) > maxCarried) {
      maxCarried = p.carried;
      richestIndex = p.slot ?? p.index;
    }
  }

  if (proj) {
    // 2.5D: oyuncular derinlik kuyruğunda (engel/kumbara ile sıralanırlar).
    const st = HEIST_PLAYER_ST;
    st.withFx = withFx;
    st.now = now;
    st.selfSlot = selfSlot;
    st.hasViewer = hasViewer;
    st.richestIndex = richestIndex;
    st.proj = proj;
    queuePlayers(ctx, players, {
      state: st,
      drawItem: drawHeistPlayer25d,
      radiusOf: (player) => player.radius || 36,
      visible: isWorldEntityVisible,
    });
    return;
  }

  for (const player of players) {
    if (!isWorldEntityVisible(player)) continue;
    const radius = player.radius || 36;
    const px = Number.isFinite(player.x) ? player.x : 0;
    const py = Number.isFinite(player.y) ? player.y : 0;

    ctx.save();
    ctx.translate(px, py);

    if (withFx && player.stumble > 0) {
      ctx.translate((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
    }

    const u = radius / 36;
    if (withFx && (player.slot ?? player.index) === richestIndex) {
      const pulse = Math.sin(performance.now() * 0.01) * 3;
      // En-zengin halkası: altın 1.19:1 ile görünmezdi. Koyu taban + altın üst.
      ctx.strokeStyle = UI_COLORS.hudInkOutline;
      ctx.lineWidth = Math.max(2.5, 4.5 * u);
      ctx.setLineDash([4 * u, 4 * u]);
      ctx.beginPath();
      ctx.arc(0, 0, radius + 10 * u + pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = UI_COLORS.hudAmber;
      ctx.lineWidth = Math.max(1.5, 2.5 * u);
      ctx.beginPath();
      ctx.arc(0, 0, radius + 10 * u + pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // Taç ikonu çıplak altın da görünmezdi — koyu disk üstünde.
      ctx.fillStyle = UI_COLORS.hudPlate;
      ctx.beginPath();
      ctx.arc(0, -radius - 32 * u, 14 * u, 0, Math.PI * 2);
      ctx.fill();
      drawTabletopIcon(ctx, 'crown', 0, -radius - 32 * u, 22 * u, { color: UI_COLORS.hudAmber });
    }

    if (withFx && player.tackling) {
      ctx.strokeStyle = UI_COLORS.hudInkOutline;
      ctx.lineWidth = Math.max(3, 6 * u);
      ctx.beginPath();
      ctx.arc(0, 0, radius + 6 * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = UI_COLORS.hudAmber;
      ctx.lineWidth = Math.max(2, 4 * u);
      ctx.beginPath();
      ctx.arc(0, 0, radius + 6 * u, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.save();
    ctx.rotate(player.angle || 0);
    const coneGrad = ctx.createRadialGradient(0, 0, radius, 0, 0, radius + 36 * u);
    coneGrad.addColorStop(0, `${player.color || '#D99B26'}88`);
    coneGrad.addColorStop(1, `${player.color || '#D99B26'}00`);
    ctx.fillStyle = coneGrad;
    ctx.beginPath();
    ctx.moveTo(radius * 0.8, 0);
    ctx.arc(0, 0, radius + 36 * u, -0.42, 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    let currentExp = 'normal';
    if (player.stumble > 0) currentExp = 'dizzy';
    else if (player.tackling) currentExp = 'angry';
    else if ((player.carried || 0) >= 5) currentExp = 'excited';
    else if ((player.carried || 0) > 0) currentExp = 'wink';

    drawGameAvatar(ctx, 0, 0, radius, player, {
      facingAngle: player.angle || 0,
      expression: currentExp,
      borderColor: player.tackling ? '#FFDE59' : (player.rimColor || '#1C1C1A'),
      borderWidth: Math.max(1.5, (player.tackling ? 4.5 : 3) * u),
      // Kaçarken gözler koşu yönüne bakar; tackle'da gövde yönü zaten hedefe
      // döndüğü için bakış gövdeyle birlikte döner.
      lookAngle: (player.vx || player.vy) && !player.tackling
        ? Math.atan2(player.vy || 0, player.vx || 0)
        : undefined,
      now,
      alpha: fxReadAlpha({ isSelf: hasViewer && (player.slot ?? player.index) === selfSlot, hasViewer }),
    });

    // Tackle cooldown rozeti dünya koordinatında çizilir (aşağıda, restore
    // sonrası) — çerçeve öteleme + döndürme taşımaz, üst üste binme yok.
    const heistCdProg = withFx && player.cd > 0
      ? 1.0 - Math.max(0, Math.min(1, player.cd / 3.5))
      : null;

    if ((player.carried || 0) > 0) {
      const bagY = -radius - 12;
      const isRichest = (player.slot ?? player.index) === richestIndex;
      const gold = player.carried;
      const tier = gold >= 10 ? 2 : gold >= 5 ? 1 : 0;
      const coins = Math.min(8, gold);
      const coinR = tier === 2 ? 8.5 : 7.5;
      const step = coinR * 1.25;
      if (withFx && tier >= 1) {
        ctx.globalAlpha = tier === 2 ? 0.35 : 0.22;
        ctx.fillStyle = '#FFDE59';
        ctx.beginPath();
        ctx.arc(0, bagY - 20, radius + 16 + tier * 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      for (let c = 0; c < coins; c++) {
        const cy = bagY - 12 - c * step;
        ctx.fillStyle = '#FFDE59';
        ctx.beginPath();
        ctx.arc(0, cy, coinR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#1C1C1A';
        ctx.lineWidth = Math.max(1, 2 * (coinR / 7.5));
        ctx.stroke();
        ctx.strokeStyle = '#FFF6C9';
        ctx.lineWidth = Math.max(1, 1.5 * (coinR / 7.5));
        ctx.beginPath();
        ctx.arc(0, cy, coinR * 0.55, -Math.PI * 0.7, -Math.PI * 0.2);
        ctx.stroke();
      }
      if (tier === 2) {
        const cy = bagY - 12 - coins * step - 6;
        ctx.fillStyle = '#FFDE59';
        ctx.strokeStyle = '#1C1C1A';
        ctx.lineWidth = Math.max(1, 1.5 * (coinR / 7.5));
        ctx.beginPath();
        ctx.moveTo(-10, cy + 6);
        ctx.lineTo(-10, cy);
        ctx.lineTo(-5, cy + 3);
        ctx.lineTo(0, cy - 2);
        ctx.lineTo(5, cy + 3);
        ctx.lineTo(10, cy);
        ctx.lineTo(10, cy + 6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = '#1C1C1A';
      ctx.fillRect(-32, bagY - 9, 64, 22);
      ctx.strokeStyle = tier >= 1 || isRichest ? '#FFDE59' : '#FFFFFF';
      ctx.lineWidth = Math.max(1.5, (tier >= 1 || isRichest ? 3 : 2) * u);
      ctx.strokeRect(-32, bagY - 9, 64, 22);
      ctx.fillStyle = tier >= 1 || isRichest ? '#FFDE59' : '#FFFFFF';
      ctx.font = '900 13px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${gold} G`, 0, bagY + 2);
    }

    ctx.restore();

    if (heistCdProg !== null) {
      // Tackle cooldown: ince çember (altın yay 1.19:1) yerine rozet.
      drawStatusChip(ctx, {
        x: px,
        y: py,
        radius,
        arena,
        scale: u,
        icon: 'zap',
        progress: heistCdProg,
        remaining: Math.max(0, player.cd),
      });
    }
  }
}

export function drawHeistTexts(ctx, texts, proj = null) {
  for (const ft of texts || []) {
    ctx.save();
    const denom = Number(ft.maxLife) || 0;
    ctx.globalAlpha = Math.max(0, denom > 0 ? ft.life / denom : 0);
    // 2.5D: metin projekte konuma taşınır, ölçek kamera derinliğinden.
    const pos = proj ? proj.proj(ft.x, ft.y, 0) : { x: ft.x, y: ft.y };
    const k = proj ? proj.view.scale * pos.d : 1;
    ctx.font = `900 ${Math.max(10, Math.round(13 * k))}px "Space Grotesk", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(26, 26, 26, 0.9)';
    ctx.lineWidth = Math.max(1.5, 3.5 * k);
    ctx.strokeText(ft.text, pos.x, pos.y);
    ctx.fillStyle = ft.color || '#1C1C1A';
    ctx.fillText(ft.text, pos.x, pos.y);
    ctx.restore();
  }
}

/**
 * FX katmanının tek çizim sırası: pop → ring → partikül. Host motoru ve
 * client worldView AYNI fonksiyonu çağırır (tanks deseni). `proj` verilirse
 * eğik kameraya projekte edilir.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ pops?: any[], rings?: any[], particles?: any[] }} layer
 * @param {any} [proj]
 */
export function drawHeistFxLayer(ctx, layer, proj = null) {
  drawFxPops(ctx, layer?.pops, proj);
  drawFxRings(ctx, layer?.rings, proj);
  drawSquareParticles(ctx, layer?.particles, proj);
}
