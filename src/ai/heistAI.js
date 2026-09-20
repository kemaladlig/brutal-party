// Brutal Heist: Bot Robber AI — BANK / EVADE / HUNT / COLLECT state machine.
// Kademe: NORMAL yarışçı-adil (hata yapar), GOD neredeyse yenilmez (önleme + pusu).

function decideState(game, bot, P, myVault) {
  const carried = bot.carriedGold || 0;
  // Tehdit: omuz atmaya hazır, yakın, yüklü düşman
  let threat = null;
  let threatD = Infinity;
  for (const other of game.players) {
    if (other.index === bot.index || !other.isJoined || !other.isAlive) continue;
    if ((other.tackleCooldown || 0) > 1.0) continue;
    const d = Math.hypot(other.x - bot.x, other.y - bot.y);
    if (d < threatD) {
      threatD = d;
      threat = other;
    }
  }
  if (carried >= P.evadeCarry && threat && threatD < P.evadeDist) return 'EVADE';
  if (carried >= P.bankAt || game.roundTimer < P.bankTime) return 'BANK';
  // Avlanabilir zengin düşman var mı? (eli boşken, yakınsa — yoksa ekonomi)
  for (const other of game.players) {
    if (other.index === bot.index || !other.isJoined || !other.isAlive) continue;
    if ((other.carriedGold || 0) >= P.huntMinLoot && carried <= P.huntOwnMax) {
      if (Math.hypot(other.x - bot.x, other.y - bot.y) < P.huntRange) return 'HUNT';
    }
  }
  return 'COLLECT';
}

function decideTarget(game, bot, P, myVault, state) {
  const { cx, cy } = game.arena;
  const vaultC = myVault ? { x: myVault.x + myVault.w / 2, y: myVault.y + myVault.h / 2 } : { x: cx, y: cy };
  if (state === 'BANK') return vaultC;
  if (state === 'EVADE') {
    // Yükle kasaya kaç (kilitli hedef, panik zikzak yok)
    bot.botTgtLock = 0.6;
    return vaultC;
  }
  if (state === 'HUNT') {
    let best = null;
    let bestLoot = P.huntMinLoot - 1;
    for (const other of game.players) {
      if (other.index === bot.index || !other.isJoined || !other.isAlive) continue;
      const d = Math.hypot(other.x - bot.x, other.y - bot.y);
      if ((other.carriedGold || 0) > bestLoot && d < P.huntRange) {
        bestLoot = other.carriedGold;
        best = other;
      }
    }
    if (best) {
      bot.botTE = best.index;
      bot.botTgtLock = bot.slotType === 'bot_god' ? 0.75 : 0.5;
      return { x: best.x, y: best.y };
    }
    return vaultC;
  }
  // COLLECT: değer-ağırlıklı ganimet (god) / en yakın (normal)
  let bestItem = null;
  let bestW = Infinity;
  for (const item of game.lootItems) {
    const d = Math.hypot(item.x - bot.x, item.y - bot.y);
    const w = P.lootValue ? d / (item.value || 1) : d;
    if (w < bestW) {
      bestW = w;
      bestItem = item;
    }
  }
  if (bestItem) return { x: bestItem.x, y: bestItem.y };
  if (myVault && (bot.carriedGold || 0) > 0) return vaultC;
  return { x: cx, y: cy };
}

const TIER = {
  bot_normal: {
    bankAt: 3, bankTime: 6.0, huntRange: 160, huntMinLoot: 2, huntOwnMax: 2, lead: 0, detour: 0.5,
    tackleRange: 90, alignNeed: 0, minGap: 0.5, think: 0.25,
    evadeDist: 110, evadeCarry: 4, mistake: 0.10, lootValue: false,
    stuckLimit: 0.16,
  },
  bot_god: {
    // bankAt normalle aynı: yük hız keser, hırs soygun davetiyesidir
    // tackleRange dalış menziline göre (0.22sn×340 ≈ 75px): uzaktan basmak ıskadır
    // Ekonomi öncelikli: en hızlı toplayıcı + kasacı; av sadece beleş vurgunsa
    bankAt: 3, bankTime: 7.5, huntRange: 150, huntMinLoot: 4, huntOwnMax: 1, lead: 0.35,
    tackleRange: 70, alignNeed: 0.3, minGap: 0.15, think: 0.10,
    evadeDist: 150, evadeCarry: 3, mistake: 0.0, lootValue: true,
    stuckLimit: 0.12, detour: 0.8,
  },
};

export function updateHeistBotAI(game, bot, dt) {
  const P = TIER[bot.slotType] || TIER.bot_normal;
  const myVault = game.vaults[bot.index];
  const { left, right, top, bottom, cx, cy } = game.arena;

  bot.botClock = (bot.botClock || 0) + dt;
  bot.botThinkT = (bot.botThinkT ?? 0) - dt;
  if ((bot.botTgtLock || 0) > 0) bot.botTgtLock -= dt;

  // Düşünme kapısı: kararlar seyrek, yürüyüş her tik (titreme yok)
  const thinking = bot.botThinkT <= 0;
  if (thinking) {
    bot.botThinkT = P.think;
    bot.botState = decideState(game, bot, P, myVault);
  }
  const state = bot.botState || 'COLLECT';

  let targetX = bot.botTX ?? cx;
  let targetY = bot.botTY ?? cy;
  if (thinking || bot.botTgtLock <= 0) {
    const aim = decideTarget(game, bot, P, myVault, state);
    // Normal bazen yanlış ganimete sapar
    if (state === 'COLLECT' && P.mistake > 0 && Math.random() < P.mistake && game.lootItems.length > 1) {
      const alt = game.lootItems[Math.floor(Math.random() * game.lootItems.length)];
      if (alt) {
        aim.x = alt.x;
        aim.y = alt.y;
      }
    }
    targetX = aim.x;
    targetY = aim.y;
    bot.botTX = targetX;
    bot.botTY = targetY;
  }

  // Tackle kararı (god: önleme + hizalanma + bekleme disiplini)
  if (state === 'HUNT' && bot.botTE !== undefined) {
    const e = game.players[bot.botTE];
    if (e && e.isJoined && e.isAlive && bot.tackleCooldown <= 0) {
      let ex = e.x;
      let ey = e.y;
      if (P.lead > 0) {
        ex += (e.vx || 0) * P.lead;
        ey += (e.vy || 0) * P.lead;
      }
      const d = Math.hypot(ex - bot.x, ey - bot.y);
      const gapOk = bot.botClock - (bot.botLastTackle || -99) >= P.minGap;
      let aligned = true;
      if (P.alignNeed > 0) {
        const dirX = (ex - bot.x) / (d || 1);
        const dirY = (ey - bot.y) / (d || 1);
        aligned =
          dirX * Math.cos(bot.facingAngle || 0) + dirY * Math.sin(bot.facingAngle || 0) > P.alignNeed;
      }
      if (d < P.tackleRange && gapOk && aligned) {
        bot.botLastTackle = bot.botClock;
        game.triggerTackle(bot.index);
      }
    }
  }

  // Steering intent
  let moveX = targetX - bot.x;
  let moveY = targetY - bot.y;
  const len = Math.hypot(moveX, moveY);
  if (len > 0.01) {
    moveX /= len;
    moveY /= len;
  }

  // Obstacle & Wall Avoidance
  const r = bot.radius;
  const wallMargin = 60;
  const dLeft = bot.x - (left + r);
  const dRight = right - r - bot.x;
  const dTop = bot.y - (top + r);
  const dBottom = bottom - r - bot.y;

  if (dLeft < wallMargin) moveX = Math.max(0, moveX) + (wallMargin - dLeft) / wallMargin;
  if (dRight < wallMargin) moveX = Math.min(0, moveX) - (wallMargin - dRight) / wallMargin;
  if (dTop < wallMargin) moveY = Math.max(0, moveY) + (wallMargin - dTop) / wallMargin;
  if (dBottom < wallMargin) moveY = Math.min(0, moveY) - (wallMargin - dBottom) / wallMargin;

  // Yüklü kaçış: tehditlerin etrafından dolan (hafif — hız öncelikli)
  if ((bot.carriedGold || 0) >= 2) {
    const w = P.detour ?? 0.5;
    for (const other of game.players) {
      if (other.index === bot.index || !other.isJoined || !other.isAlive) continue;
      const dx = bot.x - other.x;
      const dy = bot.y - other.y;
      const d = Math.hypot(dx, dy);
      const R = 150;
      if (d < R && d > 0.001) {
        const push = ((R - d) / R) * w;
        moveX += (dx / d) * push;
        moveY += (dy / d) * push;
      }
    }
  }

  // Repel from pillars
  for (const pil of game.pillars) {
    const pilCx = pil.x + pil.w / 2;
    const pilCy = pil.y + pil.h / 2;
    const dPil = Math.hypot(bot.x - pilCx, bot.y - pilCy);
    const threshold = Math.max(pil.w, pil.h) * 0.75 + r + 12;
    if (dPil < threshold && dPil > 0.001) {
      const nx = (bot.x - pilCx) / dPil;
      const ny = (bot.y - pilCy) / dPil;
      const push = (threshold - dPil) / threshold;
      moveX += nx * push * 1.8;
      moveY += ny * push * 1.8;
    }
  }

  // Takılma kurtarma: kasa/pilar arasında sıkışırsa rastgele yöne itiş
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

  // Normalize
  const mag = Math.hypot(moveX, moveY);
  if (mag > 0.001) {
    bot.aiMoveX = moveX / mag;
    bot.aiMoveY = moveY / mag;
    bot.aiForce = 1.0;
  } else {
    bot.aiMoveX = 0;
    bot.aiMoveY = 0;
    bot.aiForce = 0;
  }
}
