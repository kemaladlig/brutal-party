// BRUTAL ZONE bot zekâsı: excursion-loop planner.
// paper.io'da iyi oyuncu şunu yapar: base'den UZAĞA açıl (OUT) → yana kayıp
// genişlik al (SWEEP) → eve FARKLI noktadan dön (HOME) = büyük capture.
// Bot da aynısını planlar. Üstüne: HUNT (açık düşman izini kes), FLEE (izim
// tehdit altındaysa acil dönüş), stuck-watchdog (duvar döngüsünden kaçış),
// bot başına kişilik (farklı kadran tercihi → üst üste binmezler).

const PROFILES = {
  bot_normal: {
    risk: 18, excursion: [9, 13], sweep: [5, 8],
    huntR: 9, threatR: 6, think: 0.30, noise: 0.45, repel: 1.0,
  },
  bot_god: {
    risk: 28, excursion: [13, 19], sweep: [7, 11],
    huntR: 15, threatR: 8, think: 0.22, noise: 0.18, repel: 0.6,
  },
};

function bfsPath(game, from, isTarget, maxVisit = 4096) {
  const G = game.gridSize();
  const prev = new Int32Array(G * G).fill(-1);
  const queue = [from];
  prev[from] = from;
  let head = 0;
  let visited = 0;
  while (head < queue.length && visited < maxVisit) {
    const cur = queue[head++];
    visited++;
    if (cur !== from && isTarget(cur)) {
      const path = [];
      let c = cur;
      while (c !== from) {
        path.push(c);
        c = prev[c];
      }
      path.reverse();
      return path;
    }
    const cx = cur % G;
    const cy = (cur / G) | 0;
    if (cx > 0 && prev[cur - 1] === -1) { prev[cur - 1] = cur; queue.push(cur - 1); }
    if (cx < G - 1 && prev[cur + 1] === -1) { prev[cur + 1] = cur; queue.push(cur + 1); }
    if (cy > 0 && prev[cur - G] === -1) { prev[cur - G] = cur; queue.push(cur - G); }
    if (cy < G - 1 && prev[cur + G] === -1) { prev[cur + G] = cur; queue.push(cur + G); }
  }
  return null;
}

// Hücre (hx,hy) merkezli r yarıçaplı kutuda nötr yoğunluğu (0..1)
function neutralDensity(game, hx, hy, r) {
  const G = game.gridSize();
  let neutral = 0;
  let total = 0;
  for (let y = Math.max(0, hy - r); y <= Math.min(G - 1, hy + r); y++) {
    for (let x = Math.max(0, hx - r); x <= Math.min(G - 1, hx + r); x++) {
      total++;
      if (game.ownerAt(y * G + x) === 0) neutral++;
    }
  }
  return total > 0 ? neutral / total : 0;
}

function ensurePlan(game, bot) {
  if (!bot.aiPlan) {
    bot.aiPlan = {
      phase: 'OUT', target: -1, dirX: 0, dirY: 0,
      sweepDx: 0, sweepDy: 0, sweepLeft: 0,
      exitCell: -1, repath: 0,
      trap: false, trapIdx: -1,
    };
  }
  return bot.aiPlan;
}

export function updateZoneBotAI(game, bot, dt) {
  const prof = PROFILES[bot.slotType] || PROFILES.bot_normal;
  const plan = ensurePlan(game, bot);
  const G = game.gridSize();

  const myCell = game.posToCell(bot.x, bot.y);
  if (myCell < 0) {
    bot.aiMoveX = 0; bot.aiMoveY = 0; bot.aiForce = 0;
    return;
  }
  const myTag = bot.index + 1;
  const trailing = bot.trail.length > 0;

  // --- Stuck watchdog: 1.2sn'de yarım hücreden az ilerlediyse planı çöpe at ---
  bot.stuckTimer += dt;
  if (bot.stuckTimer >= 1.2) {
    const moved = Math.hypot(bot.x - bot.stuckX, bot.y - bot.stuckY);
    if (moved < game.cell * 0.5) {
      plan.phase = 'OUT';
      plan.target = -1;
      bot.aiPath = [];
      bot.aiThink = 0; // hemen yeniden düşün
    }
    bot.stuckTimer = 0;
    bot.stuckX = bot.x;
    bot.stuckY = bot.y;
  }

  bot.aiThink -= dt;
  if (bot.aiThink <= 0) {
    bot.aiThink = prof.think;
    think(game, bot, prof, plan, myCell, myTag, trailing);
  }

  steer(game, bot, prof, plan, myCell, myTag, trailing, dt);
}

function think(game, bot, prof, plan, myCell, myTag, trailing) {
  const G = game.gridSize();

  if (plan.phase !== 'HUNT') plan.trap = false;

  // 1a. Tuzak (P1-5, god): FLEE yerine bazen karşı-kesiş kumarı — takipçinin
  // üstüne kır. FLEE'den ÖNCE gelir, yoksa FLEE koşulu tuzağı ezerdi.
  if (bot.slotType === 'bot_god' && trailing
      && bot.trail.length > 8 && bot.trail.length < prof.risk * 0.6
      && Math.random() < 0.3) {
    const hunter = nearestEnemyHead(game, bot, prof.threatR + 3);
    if (hunter) {
      const hc = game.posToCell(hunter.x, hunter.y);
      if (hc >= 0) {
        plan.phase = 'HUNT';
        plan.trap = true;
        plan.trapIdx = hunter.index;
        plan.target = hc;
        bot.aiPath = [];
        return;
      }
    }
  }

  // 1. FLEE: izdeyken düşman kafası tehdidi → acil HOME
  if (trailing && nearestEnemyHead(game, bot, prof.threatR)) {
    plan.phase = 'HOME';
    plan.repath = 0;
    returnHome(game, bot, plan, myCell, myTag);
    return;
  }

  // 2. Risk limiti → HOME
  if (bot.trail.length >= prof.risk) {
    if (plan.phase !== 'HOME') {
      plan.phase = 'HOME';
      plan.repath = 0;
    }
    returnHome(game, bot, plan, myCell, myTag);
    return;
  }

  // 3. HUNT: izim kısayken menzildeki açık düşman izini kes
  if (bot.trail.length < prof.risk * 0.45) {
    const prey = nearestEnemyTrail(game, bot, prof.huntR);
    if (prey >= 0) {
      plan.phase = 'HUNT';
      plan.target = prey;
      bot.aiPath = [];
      return;
    }
  }

  // 4. HOME takibi: yol bittiyse tazele (hedefe varılamadıysa)
  if (plan.phase === 'HOME') {
    if (!trailing) {
      plan.phase = 'OUT';
      plan.target = -1;
      bot.aiPath = [];
      return;
    }
    plan.repath -= prof.think;
    if (plan.repath <= 0 || bot.aiPath.length === 0) {
      returnHome(game, bot, plan, myCell, myTag);
    }
    return;
  }

  // 5. HUNT: tuzak takibi mi, iz avı mı?
  if (plan.phase === 'HUNT') {
    if (plan.trap) {
      // Tuzak hedefi avcının CANLI konumu — iz hücresi değil, takip sürer
      const h = game.players[plan.trapIdx];
      const hd = h && h.isJoined ? Math.hypot(h.x - bot.x, h.y - bot.y) : 1e9;
      if (h && h.isJoined && h.stunTimer <= 0 && hd < game.cell * prof.huntR * 1.5) {
        plan.target = game.posToCell(h.x, h.y);
        bot.aiPath = [];
        return;
      }
      plan.trap = false;
      plan.phase = 'OUT';
      plan.target = -1;
      bot.aiPath = [];
      return;
    }
    const t = plan.target >= 0 ? game.trailOwner[plan.target] : -1;
    if (t >= 0 && t !== bot.index) return; // ava devam
    const fresh = bot.trail.length < prof.risk * 0.45
      ? nearestEnemyTrail(game, bot, prof.huntR)
      : -1;
    if (fresh >= 0) {
      plan.target = fresh;
      bot.aiPath = [];
      return;
    }
    plan.phase = 'OUT';
    plan.target = -1;
    bot.aiPath = [];
  }

  // 6. OUT: hedefe varıldıysa SWEEP'e geç
  if (plan.phase === 'OUT' && plan.target >= 0) {
    const tc = game.cellCenter(plan.target);
    if (Math.hypot(tc.x - bot.x, tc.y - bot.y) < game.cell * 2.5
        || bot.trail.length > prof.risk * 0.55) {
      startSweep(game, bot, prof, plan);
      return;
    }
    return; // yolda, hedef geçerli
  }

  // 7. SWEEP: genişlik dolduysa HOME
  if (plan.phase === 'SWEEP') {
    if (plan.sweepLeft <= 0 || bot.trail.length >= prof.risk * 0.8) {
      plan.phase = 'HOME';
      plan.repath = 0;
      returnHome(game, bot, plan, myCell, myTag);
      return;
    }
    return;
  }

  // 8. Yeni excursion planla
  planExcursion(game, bot, prof, plan, myCell, myTag);
}

function planExcursion(game, bot, prof, plan, myCell, myTag) {
  const G = game.gridSize();
  const m = 4; // duvar payı (hücre)
  // Kişilik: her bot farklı kadranı tercih eder (üst üste binme önlenir)
  const bias = (bot.index * Math.PI) / 2 + (bot.slotType === 'bot_god' ? 0.35 : 0);
  let bestScore = -Infinity;
  let best = null;
  const dist = prof.excursion[0] + Math.random() * (prof.excursion[1] - prof.excursion[0]);

  for (let k = 0; k < 10; k++) {
    const ang = (k / 10) * Math.PI * 2 + Math.random() * 0.3;
    const px = bot.x + Math.cos(ang) * dist * game.cell;
    const py = bot.y + Math.sin(ang) * dist * game.cell;
    const tc = game.posToCell(px, py);
    if (tc < 0) continue;
    const cx = tc % G;
    const cy = (tc / G) | 0;
    if (cx < m || cy < m || cx >= G - m || cy >= G - m) continue; // duvar dibini hedefleme
    if (game.ownerAt(tc) === myTag) continue; // evden eve gitme
    const density = neutralDensity(game, cx, cy, 5);
    // Düşman kafasından uzaklık bonusu
    let enemyDist = 1e9;
    for (const p of game.players) {
      if (!p || !p.isJoined || p.index === bot.index) continue;
      const d = Math.hypot(p.x - px, p.y - py);
      if (d < enemyDist) enemyDist = d;
    }
    const enemyBonus = Math.min(1, enemyDist / (game.cell * 18));
    // Kişilik yönü bonusu
    let dirBonus = Math.cos(ang - bias) * 0.15;
    const score = density * 2.0 + enemyBonus * 0.8 + dirBonus + Math.random() * 0.3;
    if (score > bestScore) {
      bestScore = score;
      best = { target: tc, ang };
    }
  }

  if (!best) {
    // Gidecek yer yok (harita dolu): en yakın düşman toprağa gir
    const foe = nearestFoeLand(game, bot, myCell, myTag);
    if (foe >= 0) {
      plan.phase = 'OUT';
      plan.target = foe;
      plan.dirX = 0; plan.dirY = 0;
      plan.exitCell = myCell;
      bot.aiPath = [];
      return;
    }
    // Tamamen sıkıştıysa: yerinde bekleme, merkeze yürü
    plan.phase = 'OUT';
    plan.target = ((G / 2) | 0) * G + ((G / 2) | 0);
    plan.dirX = 0; plan.dirY = 0;
    plan.exitCell = myCell;
    bot.aiPath = [];
    return;
  }

  plan.phase = 'OUT';
  plan.target = best.target;
  plan.dirX = Math.cos(best.ang);
  plan.dirY = Math.sin(best.ang);
  plan.exitCell = myCell;
  bot.aiPath = [];
}

function startSweep(game, bot, prof, plan) {
  // İlerleme yönüne dik iki yönden nötrü bol olanı seç
  const G = game.gridSize();
  const fx = plan.dirX;
  const fy = plan.dirY;
  const len = Math.hypot(fx, fy) || 1;
  const nx = fx / len;
  const ny = fy / len;
  // Dik adaylar
  const cands = [
    { dx: -ny, dy: nx },
    { dx: ny, dy: -nx },
  ];
  let best = cands[0];
  let bestD = -1;
  for (const c of cands) {
    const px = bot.x + c.dx * game.cell * 6;
    const py = bot.y + c.dy * game.cell * 6;
    const tc = game.posToCell(px, py);
    let d = 0;
    if (tc >= 0) d = neutralDensity(game, tc % G, (tc / G) | 0, 4);
    if (d > bestD) { bestD = d; best = c; }
  }
  plan.phase = 'SWEEP';
  plan.sweepDx = best.dx;
  plan.sweepDy = best.dy;
  plan.sweepLeft = prof.sweep[0] + Math.random() * (prof.sweep[1] - prof.sweep[0]);
}

function returnHome(game, bot, plan, myCell, myTag) {
  if (game.ownerAt(myCell) === myTag) {
    bot.aiPath = [];
    return;
  }
  const path = bfsPath(game, myCell, (c) => game.ownerAt(c) === myTag, 4096);
  if (path && path.length > 0) {
    bot.aiPath = path.slice(0, 48);
    plan.repath = 0.6;
  } else {
    bot.aiPath = [];
    plan.repath = 0.4;
  }
}

function steer(game, bot, prof, plan, myCell, myTag, trailing, dt) {
  // Hedef noktayı belirle
  let tx = null;
  let ty = null;
  if (plan.phase === 'HOME' && bot.aiPath.length > 0) {
    const wp = game.cellCenter(bot.aiPath[0]);
    if (Math.hypot(wp.x - bot.x, wp.y - bot.y) < game.cell * 0.8) {
      bot.aiPath.shift();
    }
    if (bot.aiPath.length > 0) {
      const nxt = game.cellCenter(bot.aiPath[0]);
      tx = nxt.x; ty = nxt.y;
    }
  }
  if (tx === null) {
    if (plan.phase === 'SWEEP') {
      const look = game.cell * 4;
      tx = bot.x + plan.sweepDx * look;
      ty = bot.y + plan.sweepDy * look;
      // SWEEP ilerlemesi: hücre cinsinden kabaca takip
      plan.sweepLeft -= (game.cell * 7.5 * dt) / game.cell;
    } else if (plan.target >= 0) {
      const c = game.cellCenter(plan.target);
      tx = c.x; ty = c.y;
    }
  }
  if (tx === null) {
    bot.aiMoveX = Math.cos(bot.heading);
    bot.aiMoveY = Math.sin(bot.heading);
    bot.aiForce = 0.7;
    return;
  }

  let dx = tx - bot.x;
  let dy = ty - bot.y;

  // Duvar lookahead: 2.5 hücre ötesi duvarsa sertçe içe kır
  const f = game.field;
  const m = game.cell * 2.5;
  const px = bot.x + Math.sign(dx) * game.cell * 2.5;
  const py = bot.y + Math.sign(dy) * game.cell * 2.5;
  let wallPush = 0;
  if (px < f.x + m) { dx += (f.x + m - px) * 4; wallPush++; }
  if (px > f.x + f.s - m) { dx -= (px - (f.x + f.s - m)) * 4; wallPush++; }
  if (py < f.y + m) { dy += (f.y + m - py) * 4; wallPush++; }
  if (py > f.y + f.s - m) { dy -= (py - (f.y + f.s - m)) * 4; wallPush++; }

  // Düşman itmesi (HUNT'ta hedefe odaklan, itme zayıf)
  const hunting = plan.phase === 'HUNT';
  const repelR = game.cell * (hunting ? 2.5 : 4.5);
  for (const p of game.players) {
    if (!p || !p.isJoined || p.index === bot.index || p.stunTimer > 0) continue;
    const ddx = bot.x - p.x;
    const ddy = bot.y - p.y;
    const d = Math.hypot(ddx, ddy);
    if (d > 0.01 && d < repelR) {
      const w = (1 - d / repelR) * prof.repel * (hunting ? 0.4 : 1.4);
      dx += (ddx / d) * game.cell * w * 3;
      dy += (ddy / d) * game.cell * w * 3;
    }
  }

  // Organik sapma
  dx += (Math.random() - 0.5) * prof.noise * game.cell;
  dy += (Math.random() - 0.5) * prof.noise * game.cell;

  const len = Math.hypot(dx, dy) || 1;
  bot.aiMoveX = dx / len;
  bot.aiMoveY = dy / len;
  bot.aiForce = 1;
  void wallPush;
}

// Hücre uzaklığıyla tehdit: izdeyken izin son 14 hücresi + konumumu koru
function nearestEnemyHead(game, bot, rangeCells) {
  const rangePx = rangeCells * game.cell;
  const guardPts = [{ x: bot.x, y: bot.y }];
  for (let i = Math.max(0, bot.trail.length - 14); i < bot.trail.length; i++) {
    guardPts.push(game.cellCenter(bot.trail[i]));
  }
  for (const p of game.players) {
    if (!p || !p.isJoined || p.index === bot.index || p.stunTimer > 0) continue;
    for (const g of guardPts) {
      if (Math.hypot(p.x - g.x, p.y - g.y) < rangePx) return p;
    }
  }
  return null;
}

// Menzildeki en yakın açık düşman izi hücresi
function nearestEnemyTrail(game, bot, rangeCells) {
  const G = game.gridSize();
  const rangePx = rangeCells * game.cell;
  const rangeSq = rangePx * rangePx;
  const bx = bot.x;
  const by = bot.y;
  let best = -1;
  let bestSq = rangeSq;
  const f = game.field;
  const x0 = Math.max(0, Math.floor((bx - rangePx - f.x) / game.cell));
  const x1 = Math.min(G - 1, Math.ceil((bx + rangePx - f.x) / game.cell));
  const y0 = Math.max(0, Math.floor((by - rangePx - f.y) / game.cell));
  const y1 = Math.min(G - 1, Math.ceil((by + rangePx - f.y) / game.cell));
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const ci = cy * G + cx;
      const t = game.trailOwner[ci];
      if (t < 0 || t === bot.index) continue;
      const px = f.x + (cx + 0.5) * game.cell;
      const py = f.y + (cy + 0.5) * game.cell;
      const dSq = (px - bx) * (px - bx) + (py - by) * (py - by);
      if (dSq < bestSq) {
        bestSq = dSq;
        best = ci;
      }
    }
  }
  return best;
}

function nearestFoeLand(game, bot, from, myTag) {
  const G = game.gridSize();
  const seen = new Uint8Array(G * G);
  const queue = [from];
  seen[from] = 1;
  let head = 0;
  let visited = 0;
  while (head < queue.length && visited < 3000) {
    const cur = queue[head++];
    visited++;
    if (cur !== from) {
      const o = game.ownerAt(cur);
      if (o !== 0 && o !== myTag) return cur;
    }
    const cx = cur % G;
    const cy = (cur / G) | 0;
    if (cx > 0 && !seen[cur - 1]) { seen[cur - 1] = 1; queue.push(cur - 1); }
    if (cx < G - 1 && !seen[cur + 1]) { seen[cur + 1] = 1; queue.push(cur + 1); }
    if (cy > 0 && !seen[cur - G]) { seen[cur - G] = 1; queue.push(cur - G); }
    if (cy < G - 1 && !seen[cur + G]) { seen[cur + G] = 1; queue.push(cur + G); }
  }
  return -1;
}
