import { fieldPx } from '../core/playfield.js';

// Brutal Crown: Bot AI — KING / LOOSE / HUNT state machine.
// Kademe: NORMAL yarışçı-adil (panikler, hata yapar), GOD neredeyse yenilmez
// (kaçış rotası seçer, önünü keser, rakibi tacından eder).

const TIER = {
  bot_normal: {
    think: 0.15, lead: 0, counterRange: 90, tackleRange: 100, tackleClose: 75,
    alignNeed: 0.4, threatRadius: 280, centerFar: 160, mistake: 0.12,
    intercept: false, escapeCheck: false, stuckLimit: 0.16,
    hazardPad: 16, bumperPad: 12,
  },
  bot_god: {
    think: 0.06, lead: 0.32, counterRange: 120, tackleRange: 140, tackleClose: 75,
    alignNeed: 0.4, threatRadius: 320, centerFar: 190, mistake: 0.0,
    intercept: true, escapeCheck: true, stuckLimit: 0.12,
    hazardPad: 22, bumperPad: 16,
  },
};

function freeRay(game, bot, x, y, angle, maxDist) {
  const step = 10;
  let dist = 0;
  const r = bot.radius || 14;
  while (dist < maxDist) {
    dist += step;
    const rx = x + Math.cos(angle) * dist;
    const ry = y + Math.sin(angle) * dist;
    const { left, right, top, bottom } = game.arena;
    if (rx < left + r || rx > right - r || ry < top + r || ry > bottom - r) return dist;
    if (game.pillars) {
      for (const pil of game.pillars) {
        if (rx > pil.x - 6 && rx < pil.x + pil.w + 6 && ry > pil.y - 6 && ry < pil.y + pil.h + 6) {
          return dist;
        }
      }
    }
  }
  return maxDist;
}

function decideCrownTarget(game, bot, P) {
  const { cx, cy } = game.arena;
  const crown = game.crown;
  const hasCrown = bot.hasCrown;
  const out = { x: cx, y: cy, tackle: false };

  if (hasCrown) {
    // --- 1. KRAL: kaçış + rota kalitesi ---
    let closestEnemy = null;
    let minEnemyDist = Infinity;
    let threatVectorX = 0;
    let threatVectorY = 0;

    for (const other of game.players) {
      if (other.index !== bot.index && other.isJoined && other.isAlive) {
        const dx = other.x - bot.x;
        const dy = other.y - bot.y;
        const d = Math.hypot(dx, dy);
        if (d < minEnemyDist) {
          minEnemyDist = d;
          closestEnemy = other;
        }
        // Tehdit yarıçapı saha ile ölçeklenir: sabit 280/320px bir telefon
        // yatayında saha GENİŞLİĞİNİN %35-40'ıydı, yani "uzaktaki oyuncu
        // bile tehdittir" — bot telefonla masaüstünde farklı oynuyordu.
        const threatRadius = fieldPx(game.arena, P.threatRadius);
        if (d < threatRadius && d > 0.1) {
          const weight = (threatRadius - d) / threatRadius;
          threatVectorX -= (dx / d) * weight;
          threatVectorY -= (dy / d) * weight;
        }
      }
    }

    if (closestEnemy && minEnemyDist < P.counterRange) {
      const dot = (closestEnemy.vx * (bot.x - closestEnemy.x) + closestEnemy.vy * (bot.y - closestEnemy.y));
      if (dot > 0 && bot.tackleCooldown <= 0) out.tackle = true;
    }

    const distToCenter = Math.hypot(cx - bot.x, cy - bot.y);
    const centerWeight = distToCenter > fieldPx(game.arena, P.centerFar) ? 0.35 : 0.1;

    let escapeX = threatVectorX + (cx - bot.x) / (distToCenter + 1) * centerWeight;
    let escapeY = threatVectorY + (cy - bot.y) / (distToCenter + 1) * centerWeight;

    // God: iki kaçış adayından yolu açık olanı seç (çıkmaz sokağa girme)
    if (P.escapeCheck && Math.hypot(escapeX, escapeY) > 0.05) {
      const base = Math.atan2(escapeY, escapeX);
      let bestA = base;
      let bestD = -1;
      for (const off of [0, 0.7, -0.7]) {
        const d = freeRay(game, bot, bot.x, bot.y, base + off, 170);
        if (d > bestD) {
          bestD = d;
          bestA = base + off;
        }
      }
      escapeX = Math.cos(bestA);
      escapeY = Math.sin(bestA);
    }

    const escapeLen = Math.hypot(escapeX, escapeY);
    if (escapeLen > 0.01) {
      out.x = bot.x + (escapeX / escapeLen) * 130;
      out.y = bot.y + (escapeY / escapeLen) * 130;
    }
    return out;
  }

  if (crown.carrierIndex === null) {
    // --- 2. TAÇ BOŞTA: kapış + (god) rakibi kes ---
    out.x = crown.x;
    out.y = crown.y;

    if (P.lead > 0 && Math.hypot(crown.vx, crown.vy) > 30) {
      out.x += crown.vx * 0.25;
      out.y += crown.vy * 0.25;
    }

    for (const other of game.players) {
      if (other.index !== bot.index && other.isJoined && other.isAlive) {
        const dOtherCrown = Math.hypot(other.x - crown.x, other.y - crown.y);
        const dBotOther = Math.hypot(other.x - bot.x, other.y - bot.y);
        const dBotCrown = Math.hypot(bot.x - crown.x, bot.y - crown.y);
        // God: taça benden yakınsa rakibi tacından et (intercept)
        if (P.intercept && dOtherCrown < dBotCrown && dBotOther < 150 && bot.tackleCooldown <= 0) {
          out.x = other.x + (other.vx || 0) * 0.2;
          out.y = other.y + (other.vy || 0) * 0.2;
          out.tackle = dBotOther < 135;
          return out;
        }
        if (dOtherCrown < 95 && dBotOther < (P.intercept ? 135 : 95) && bot.tackleCooldown <= 0) {
          out.x = other.x;
          out.y = other.y;
          out.tackle = true;
          return out;
        }
      }
    }
    return out;
  }

  // --- 3. BAŞKASI KRAL: av + önünü kes ---
  const king = game.players[crown.carrierIndex];
  if (king && king.isAlive) {
    out.x = king.x;
    out.y = king.y;
    if (P.lead > 0) {
      out.x += (king.vx || 0) * P.lead;
      out.y += (king.vy || 0) * P.lead;
      // God: kralın önüne geç (kesme noktası)
      const kx = (king.vx || 0);
      const ky = (king.vy || 0);
      const ks = Math.hypot(kx, ky);
      if (ks > 40) {
        out.x += (kx / ks) * 55;
        out.y += (ky / ks) * 55;
      }
    }
    const dKing = Math.hypot(out.x - bot.x, out.y - bot.y);
    if (dKing < P.tackleRange && bot.tackleCooldown <= 0) {
      const dirX = (out.x - bot.x) / (dKing || 1);
      const dirY = (out.y - bot.y) / (dKing || 1);
      const alignment = dirX * bot.inputX + dirY * bot.inputY;
      if (alignment > P.alignNeed || dKing < P.tackleClose) out.tackle = true;
    }
  }
  return out;
}

function decideCrownTackle(game, bot, P) {
  // Kilitli hedef yürürken menzil kapısı (kısa karar, her tik)
  if (bot.tackleCooldown > 0) return false;
  for (const other of game.players) {
    if (other.index !== bot.index && other.isJoined && other.isAlive) {
      if (Math.hypot(other.x - bot.x, other.y - bot.y) < 70) return true;
    }
  }
  return false;
}

export function updateCrownBotAI(game, bot, dt) {
  const P = TIER[bot.slotType] || TIER.bot_normal;
  const { left, right, top, bottom, cx, cy } = game.arena;
  const crown = game.crown;

  bot.botThinkT = (bot.botThinkT ?? 0) - dt;
  const thinking = bot.botThinkT <= 0;
  if (thinking) bot.botThinkT = P.think;

  // Kilitli hedef yürüyüşte korunur (titreme yok)
  let targetX = bot.botTX ?? cx;
  let targetY = bot.botTY ?? cy;
  let wantTackle = false;

  const hasCrown = bot.hasCrown;

  if (thinking || targetX === undefined) {
    const aim = decideCrownTarget(game, bot, P);
    targetX = aim.x;
    targetY = aim.y;
    wantTackle = aim.tackle;
    bot.botTX = targetX;
    bot.botTY = targetY;
    bot.botTackle = wantTackle;
  } else {
    wantTackle = !!bot.botTackle;
    // Canlı tackle kapısı her tik açık (bekleme kaçmaz)
    const live = decideCrownTackle(game, bot, P);
    if (live) wantTackle = true;
  }

  // Normal panik yalpalama: nadiren kaçış vektörünü tersler (kısa süreli)
  if (P.mistake > 0) {
    bot.botWobbleT = (bot.botWobbleT || 0) - dt;
    if (bot.botWobbleT <= 0 && Math.random() < P.mistake * dt * 10) {
      bot.botWobbleT = 0.25;
    }
  }

  // Steering intent
  let moveX = targetX - bot.x;
  let moveY = targetY - bot.y;
  if ((bot.botWobbleT || 0) > 0 && !hasCrown) {
    moveX = -moveX;
    moveY = -moveY;
  }
  const len = Math.hypot(moveX, moveY);
  if (len > 0.01) {
    moveX /= len;
    moveY /= len;
  }

  // Wall Avoidance
  const r = bot.radius;
  const wallMargin = 55;
  const dLeft = bot.x - (left + r);
  const dRight = right - r - bot.x;
  const dTop = bot.y - (top + r);
  const dBottom = bottom - r - bot.y;

  if (dLeft < wallMargin) moveX = Math.max(0, moveX) + (wallMargin - dLeft) / wallMargin;
  if (dRight < wallMargin) moveX = Math.min(0, moveX) - (wallMargin - dRight) / wallMargin;
  if (dTop < wallMargin) moveY = Math.max(0, moveY) + (wallMargin - dTop) / wallMargin;
  if (dBottom < wallMargin) moveY = Math.min(0, moveY) - (wallMargin - dBottom) / wallMargin;

  // Repel from Pillars & Barricades
  if (game.pillars) {
    for (const pil of game.pillars) {
      const pilCx = pil.x + pil.w / 2;
      const pilCy = pil.y + pil.h / 2;
      const dPil = Math.hypot(bot.x - pilCx, bot.y - pilCy);
      const threshold = Math.max(pil.w, pil.h) * 0.7 + r + 16;
      if (dPil < threshold && dPil > 0.001) {
        const nx = (bot.x - pilCx) / dPil;
        const ny = (bot.y - pilCy) / dPil;
        const push = (threshold - dPil) / threshold;
        moveX += nx * push * 2.2;
        moveY += ny * push * 2.2;
      }
    }
  }

  // Repel from Moving Hazards
  if (game.movingHazards) {
    for (const h of game.movingHazards) {
      const dH = Math.hypot(bot.x - h.x, bot.y - h.y);
      const safeRadius = h.radius + r + P.hazardPad;
      if (dH < safeRadius && dH > 0.001) {
        const nx = (bot.x - h.x) / dH;
        const ny = (bot.y - h.y) / dH;
        const push = (safeRadius - dH) / safeRadius;
        moveX += nx * push * 2.0;
        moveY += ny * push * 2.0;
      }
    }
  }

  // Avoid Banana Peels 🍌 (normal dar payla bazen kayar — eğlencesi orada)
  if (game.bananaPeels) {
    for (const b of game.bananaPeels) {
      const dB = Math.hypot(bot.x - b.x, bot.y - b.y);
      const safeRadius = b.radius + r + (bot.slotType === 'bot_god' ? 18 : 10);
      if (dB < safeRadius && dB > 0.001) {
        const nx = (bot.x - b.x) / dB;
        const ny = (bot.y - b.y) / dB;
        const push = (safeRadius - dB) / safeRadius;
        moveX += nx * push * 1.8;
        moveY += ny * push * 1.8;
      }
    }
  }

  // Avoid Bouncy Bumpers if not tackling
  if (game.bumpers && !wantTackle) {
    for (const b of game.bumpers) {
      const dB = Math.hypot(bot.x - b.x, bot.y - b.y);
      const safeRadius = b.radius + r + P.bumperPad;
      if (dB < safeRadius && dB > 0.001) {
        const nx = (bot.x - b.x) / dB;
        const ny = (bot.y - b.y) / dB;
        const push = (safeRadius - dB) / safeRadius;
        moveX += nx * push * 1.4;
        moveY += ny * push * 1.4;
      }
    }
  }

  // Takılma kurtarma: piston/mantar arasında sıkışırsa rastgele yöne itiş
  const frameMove = Math.hypot(bot.x - (bot.lastX ?? bot.x), bot.y - (bot.lastY ?? bot.y));
  bot.lastX = bot.x;
  bot.lastY = bot.y;
  if (frameMove < 20 * dt) {
    bot.stuckAccumulator = (bot.stuckAccumulator || 0) + dt;
  } else {
    bot.stuckAccumulator = Math.max(0, (bot.stuckAccumulator || 0) - dt * 2.5);
  }
  if (bot.stuckAccumulator > P.stuckLimit) {
    const a = Math.random() * Math.PI * 2;
    moveX = Math.cos(a) * 1.5;
    moveY = Math.sin(a) * 1.5;
    bot.stuckAccumulator = 0;
    bot.botThinkT = 0;
  }

  // Final normalize
  const finalLen = Math.hypot(moveX, moveY);
  if (finalLen > 0.01) {
    bot.inputX = moveX / finalLen;
    bot.inputY = moveY / finalLen;
  } else {
    bot.inputX = 0;
    bot.inputY = 0;
  }

  // Trigger tackle action
  if (wantTackle && bot.tackleCooldown <= 0) {
    game.triggerTackle(bot.index);
  }
}
