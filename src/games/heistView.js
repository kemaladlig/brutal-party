// Paylaşılan HEIST dünya snapshot'ı + çizim sınırı (worldCore deseni).
// Yetkili host, uzak telefon client'larıyla aynı çizim yardımcılarını kullanır;
// client simülasyon/AI import etmez, yalnız salt-okunur draw + snapshot/validator alır.
// Not: loot/gemi ikonları tek kaynak tabletopIcons vektörleridir (ham OS emojisi yok);
// coin yıldızı (★) tüm platformlarda metin render edilen stabil bir gliftir.

import { drawGameAvatar } from '../core/avatarInGame.js';
import { drawTabletopIcon } from '../core/tabletopIcons.js';
import {
  round1,
  packRectList,
  createWorldSnapshot,
  isValidWorldBase,
  isWorldEntityVisible,
} from './worldCore.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

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
      radius: round1(p.radius || 14),
      stumble: round1(p.stumbleTimer || 0),
      tackling: p.isTackling === true,
      carried: Number(p.carriedGold) || 0,
      vault: Number(p.vaultGold) || 0,
      cd: round1(p.tackleCooldown || 0),
    }),
    extras: {
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
export function drawHeistArena(ctx, arena, pillars) {
  const { left, top, right, bottom, width, height, size, cx, cy } = arena;

  ctx.fillStyle = '#FAF7F2';
  ctx.fillRect(left, top, width, height);

  ctx.strokeStyle = '#E8E2D8';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(left + width * 0.12, top + height * 0.12, width * 0.76, height * 0.76);

  ctx.strokeStyle = '#D99B26';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  const bLen = Math.max(16, Math.round(Math.min(width, height) * 0.05));
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

  ctx.fillStyle = '#1A1A1A';
  ctx.fillRect(right, top + 6, 6, height);
  ctx.fillRect(left + 6, bottom, width, 6);
  ctx.strokeStyle = '#1A1A1A';
  ctx.lineWidth = 4;
  ctx.strokeRect(left, top, width, height);

  for (const pil of pillars) {
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(pil.x + 4, pil.y + 4, pil.w, pil.h);
    ctx.fillStyle = '#2B2B28';
    ctx.fillRect(pil.x, pil.y, pil.w, pil.h);
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(pil.x, pil.y, pil.w, pil.h);
    ctx.strokeStyle = '#6E6E66';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pil.x + 2, pil.y + pil.h - 2);
    ctx.lineTo(pil.x + 2, pil.y + 2);
    ctx.lineTo(pil.x + pil.w - 2, pil.y + 2);
    ctx.stroke();
    if (pil.w >= 28 && pil.h >= 28) {
      ctx.strokeStyle = '#3E3E38';
      ctx.lineWidth = 1.5;
      const pad = 6;
      ctx.strokeRect(pil.x + pad, pil.y + pad, pil.w - pad * 2, pil.h - pad * 2);
      ctx.fillStyle = '#D99B26';
      ctx.beginPath();
      ctx.arc(pil.x + pil.w / 2, pil.y + pil.h / 2, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function drawHeistVaults(ctx, vaults, players) {
  const bySlot = new Map((players || []).map((p) => [p.slot ?? p.index, p]));
  for (const v of vaults) {
    const p = bySlot.get(v.playerIndex);
    if (!isWorldEntityVisible(p)) continue;

    const isTop = v.playerIndex === 1 || v.playerIndex === 2;

    ctx.save();
    ctx.fillStyle = 'rgba(217, 155, 38, 0.12)';
    ctx.fillRect(v.x, v.y, v.w, v.h);
    ctx.strokeStyle = p.color || '#D99B26';
    ctx.lineWidth = 3;
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
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.strokeStyle = '#FFF6C9';
          ctx.lineWidth = 1.5;
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

export function drawHeistLoot(ctx, loot) {
  for (const item of loot) {
    ctx.save();
    ctx.translate(item.x, item.y);
    const r = item.radius || 10;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.beginPath();
    ctx.arc(2, 2, r, 0, Math.PI * 2);
    ctx.fill();

    if (item.type === 'DIAMOND') {
      ctx.fillStyle = '#48CAE4';
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#1C1C1A';
      ctx.lineWidth = 2.2;
      ctx.stroke();
      drawTabletopIcon(ctx, 'gem', 0, 1, Math.max(12, r * 1.1), { color: '#FFFFFF' });
    } else if (item.type === 'CROWN') {
      ctx.fillStyle = '#D99B26';
      ctx.fillRect(-12, -8, 24, 16);
      ctx.strokeStyle = '#1C1C1A';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(-12, -8, 24, 16);
      drawTabletopIcon(ctx, 'crown', 0, 1, 16, { color: '#FFFFFF' });
    } else {
      ctx.fillStyle = '#FFDE59';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1C1C1A';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#1C1C1A';
      ctx.font = '900 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('★', 0, 0);
    }

    ctx.restore();
  }
}

export function drawHeistPiggy(ctx, piggy) {
  if (!piggy) return;
  const pig = piggy;

  ctx.save();
  ctx.translate(pig.x, pig.y);

  const squash = 1 + Math.sin((pig.anim || 0) * 8) * 0.08;
  ctx.scale(squash, 1 / squash);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.beginPath();
  ctx.arc(3, 4, pig.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#FFDE59';
  ctx.beginPath();
  ctx.arc(0, 0, pig.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#1C1C1A';
  ctx.stroke();

  ctx.fillStyle = '#D99B26';
  ctx.beginPath();
  ctx.arc(0, 2, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#1C1C1A';
  ctx.fillRect(-6, -14, 12, 3);

  ctx.beginPath();
  ctx.moveTo(-14, -14);
  ctx.lineTo(-6, -20);
  ctx.lineTo(-4, -10);
  ctx.closePath();
  ctx.fillStyle = '#FFDE59';
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
  const pipW = 10;
  const pipH = 5;
  const maxHp = Math.max(1, pig.maxHp || 1);
  const startPipX = pig.x - (maxHp * (pipW + 3)) / 2;
  const pipY = pig.y - pig.radius - 12;
  for (let h = 0; h < maxHp; h++) {
    ctx.fillStyle = h < (pig.hp || 0) ? '#2D6A4F' : '#E63946';
    ctx.fillRect(startPipX + h * (pipW + 3), pipY, pipW, pipH);
    ctx.strokeStyle = '#1C1C1A';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(startPipX + h * (pipW + 3), pipY, pipW, pipH);
  }
  ctx.restore();
}

export function drawHeistPlayers(ctx, players, { withFx = true } = {}) {
  let richestIndex = -1;
  let maxCarried = 2;
  for (const p of players) {
    if (isWorldEntityVisible(p) && (p.carried || 0) > maxCarried) {
      maxCarried = p.carried;
      richestIndex = p.slot ?? p.index;
    }
  }

  for (const player of players) {
    if (!isWorldEntityVisible(player)) continue;
    const radius = player.radius || 14;
    const px = Number.isFinite(player.x) ? player.x : 0;
    const py = Number.isFinite(player.y) ? player.y : 0;

    ctx.save();
    ctx.translate(px, py);

    if (withFx && player.stumble > 0) {
      ctx.translate((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
    }

    if (withFx && (player.slot ?? player.index) === richestIndex) {
      const pulse = Math.sin(performance.now() * 0.01) * 3;
      ctx.strokeStyle = '#FFDE59';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, radius + 10 + pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      drawTabletopIcon(ctx, 'crown', 0, -radius - 32, 22, { color: '#FFDE59' });
    }

    if (withFx && player.tackling) {
      ctx.strokeStyle = '#FFDE59';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, radius + 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.save();
    ctx.rotate(player.angle || 0);
    const coneGrad = ctx.createRadialGradient(0, 0, radius, 0, 0, radius + 36);
    coneGrad.addColorStop(0, `${player.color || '#D99B26'}88`);
    coneGrad.addColorStop(1, `${player.color || '#D99B26'}00`);
    ctx.fillStyle = coneGrad;
    ctx.beginPath();
    ctx.moveTo(radius * 0.8, 0);
    ctx.arc(0, 0, radius + 36, -0.42, 0.42);
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
      borderColor: player.tackling ? '#FFDE59' : '#1C1C1A',
      borderWidth: player.tackling ? 4.5 : 3,
    });

    if (withFx && player.cd > 0) {
      const cdProg = 1.0 - Math.max(0, Math.min(1, player.cd / 3.5));
      ctx.save();
      ctx.strokeStyle = 'rgba(26, 26, 26, 0.45)';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(0, 0, radius + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#FFDE59';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, radius + 5, -Math.PI / 2, -Math.PI / 2 + cdProg * Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

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
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.strokeStyle = '#FFF6C9';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, cy, coinR * 0.55, -Math.PI * 0.7, -Math.PI * 0.2);
        ctx.stroke();
      }
      if (tier === 2) {
        const cy = bagY - 12 - coins * step - 6;
        ctx.fillStyle = '#FFDE59';
        ctx.strokeStyle = '#1C1C1A';
        ctx.lineWidth = 1.5;
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
      ctx.lineWidth = tier >= 1 || isRichest ? 3 : 2;
      ctx.strokeRect(-32, bagY - 9, 64, 22);
      ctx.fillStyle = tier >= 1 || isRichest ? '#FFDE59' : '#FFFFFF';
      ctx.font = '900 13px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${gold} G`, 0, bagY + 2);
    }

    ctx.restore();
  }
}

export function drawHeistTexts(ctx, texts) {
  for (const ft of texts || []) {
    ctx.save();
    const denom = Number(ft.maxLife) || 0;
    ctx.globalAlpha = Math.max(0, denom > 0 ? ft.life / denom : 0);
    ctx.font = '900 13px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(26, 26, 26, 0.9)';
    ctx.lineWidth = 3.5;
    ctx.strokeText(ft.text, ft.x, ft.y);
    ctx.fillStyle = ft.color || '#1C1C1A';
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.restore();
  }
}
