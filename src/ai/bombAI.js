// Brutal Bomb: God-Tier Bot AI — role x phase state machine + slide steering.
//
// Mimari (v4 rewrite):
//   1) ALGI: carrier/rol/faz/pencereler tek yerde okunur.
//   2) KARAR (state machine): her frame TEK niyet (aim noktası). Vektör çorbası yok.
//      CARRIER_HUNT | CARRIER_STUMBLED | GIVER_IMMUNE |
//      FLEER_SAFE | FLEER_THREATENED | FLEER_PANIC
//   3) DASH: planlı aksiyon (nişan + zamanlama + iniş güvenliği).
//   4) DİREKSİYON: engeller itme değil PROJEKSİYON (kayma). Niyet asla sıfırlanmaz.
//   5) TAAHHÜT: hedef/waypoint/köşe kilitleri — jitter yasak.
// Tam adil: hız/cooldown/kural aynı, üstünlük kararda.

export function segmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
  const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
  if (Math.abs(denom) < 0.0001) return false;
  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
  const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
  return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
}

export function lineIntersectsRect(x1, y1, x2, y2, rect, pad = 12) {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);

  const rx1 = rect.x - pad;
  const ry1 = rect.y - pad;
  const rx2 = rect.x + rect.w + pad;
  const ry2 = rect.y + rect.h + pad;

  if (maxX < rx1 || minX > rx2 || maxY < ry1 || minY > ry2) {
    return false;
  }

  return (
    segmentsIntersect(x1, y1, x2, y2, rx1, ry1, rx2, ry1) ||
    segmentsIntersect(x1, y1, x2, y2, rx2, ry1, rx2, ry2) ||
    segmentsIntersect(x1, y1, x2, y2, rx2, ry2, rx1, ry2) ||
    segmentsIntersect(x1, y1, x2, y2, rx1, ry2, rx1, ry1)
  );
}

export function checkLineOfSight(game, x1, y1, x2, y2, pad = 12) {
  for (const pil of game.pillars) {
    if (lineIntersectsRect(x1, y1, x2, y2, pil, pad)) {
      return false;
    }
  }
  return true;
}

// ---------- küçük geometri ----------

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function getMapTuning(game) {
  const idx = game.selectedMapIndex || 0;
  switch (idx) {
    case 1: return { coverMult: 0.85, orbitMult: 0.85, clearanceBonus: 0 };
    case 2: return { coverMult: 1.1, orbitMult: 1.0, clearanceBonus: 6 };
    case 3: return { coverMult: 0.9, orbitMult: 1.1, clearanceBonus: 0 };
    case 4: return { coverMult: 1.0, orbitMult: 0.9, clearanceBonus: 4 };
    default: return { coverMult: 1.0, orbitMult: 1.0, clearanceBonus: 0 };
  }
}

function pointInPillar(game, x, y, pad) {
  for (const pil of game.pillars) {
    if (x > pil.x - pad && x < pil.x + pil.w + pad && y > pil.y - pad && y < pil.y + pil.h + pad) {
      return true;
    }
  }
  return false;
}

function wallTrappedBonus(game, p) {
  const { left, right, top, bottom } = game.arena;
  const dMin = Math.min(p.x - left, right - p.x, p.y - top, bottom - p.y);
  if (dMin < 90) return (90 - dMin) * 0.75;
  return 0;
}

// ---------- faz ----------

function getPhase(game) {
  const t = game.bombTimer || 99;
  if (t < 2.0) return 'DESPERATE';
  if (t <= 4.0) return 'PANIC';
  if (t <= 8.0) return 'PRESSURE';
  return 'ECONOMY';
}

// ---------- hedef tahmini (çift-örneklem, sönümlü, kelepçeli) ----------

function predictIntercept(game, bot, target, isGod) {
  const vx = target.vx || 0;
  const vy = target.vy || 0;
  const spd = Math.hypot(vx, vy);
  let damp = 1.0;
  if ((target.stumbleTimer || 0) > 0) damp = 0.2;
  else if ((target.slipTimer || 0) > 0) damp = 0.5;
  else if ((target.immunityTimer || 0) > 0) damp = 0.9;
  const shortLead = (isGod ? 0.35 : 0.25) * damp;
  const longLead = (isGod ? 0.7 : 0.25) * damp;
  const sx = target.x + vx * shortLead;
  const sy = target.y + vy * shortLead;
  const lx = target.x + vx * longLead;
  const ly = target.y + vy * longLead;
  let px = sx * 0.6 + lx * 0.4;
  let py = sy * 0.6 + ly * 0.4;
  if (isGod) {
    const fa = target.facingAngle || 0;
    const cut = Math.min(40, spd * 0.15);
    px += Math.cos(fa) * cut;
    py += Math.sin(fa) * cut;
    const hx = target.x - game.arena.cx;
    const hy = target.y - game.arena.cy;
    const hl = Math.hypot(hx, hy) || 1;
    px += (hx / hl) * 26;
    py += (hy / hl) * 26;
  }
  const m = (bot.radius || 14) + 4;
  const { left, right, top, bottom } = game.arena;
  // Duvar sekme önyargısı (sönümlü + kapaklı): duvara koşan hedef içeride karşılanır
  if (isGod) {
    const shiftCap = 30;
    if (px < left + m) {
      py += Math.min((left + m - px) * 0.4, shiftCap) * Math.sign(vy || 1);
      px = left + m;
    } else if (px > right - m) {
      py += Math.min((px - (right - m)) * 0.4, shiftCap) * Math.sign(vy || 1);
      px = right - m;
    }
    if (py < top + m) {
      px += Math.min((top + m - py) * 0.4, shiftCap) * Math.sign(vx || 1);
      py = top + m;
    } else if (py > bottom - m) {
      px += Math.min((py - (bottom - m)) * 0.4, shiftCap) * Math.sign(vx || 1);
      py = bottom - m;
    }
  }
  px = clamp(px, left + m, right - m);
  py = clamp(py, top + m, bottom - m);
  if (isGod && pointInPillar(game, px, py, 6)) {
    px = clamp(sx, left + m, right - m);
    py = clamp(sy, top + m, bottom - m);
  }
  return { x: px, y: py };
}

// ---------- yakalanabilirlik hedefi (kilitli) ----------

function selectTarget(game, bot, isGod) {
  if ((bot._tgtLock || 0) > 0 && bot._tgtI !== undefined) {
    const cached = game.players[bot._tgtI];
    if (cached && cached.isJoined && cached.isAlive) {
      // Kilitli hedef dokunulmaz olduysa ve başka aday varsa kilidi kır
      if ((cached.immunityTimer || 0) <= 0) return cached;
      let otherExists = false;
      for (const o of game.players) {
        if (o.index !== bot.index && o.index !== cached.index && o.isJoined && o.isAlive && (o.immunityTimer || 0) <= 0) {
          otherExists = true;
          break;
        }
      }
      if (!otherExists) return cached;
    }
  }
  let best = null;
  let bestScore = Infinity;
  let fallback = null;
  let fallbackScore = Infinity;
  for (const other of game.players) {
    if (other.index === bot.index || !other.isJoined || !other.isAlive) continue;
    const d = Math.hypot(other.x - bot.x, other.y - bot.y);
    const trapped = wallTrappedBonus(game, other);
    const stumbleBonus = (other.stumbleTimer || 0) > 0 ? (isGod ? 110 : 80) : 0;
    const escapePenalty = (other.escapeBoostTimer || 0) > 0 ? 40 : 0;
    let crowdBonus = 0;
    if (isGod) {
      for (const third of game.players) {
        if (third.index !== bot.index && third.index !== other.index && third.isJoined && third.isAlive) {
          if (Math.hypot(third.x - other.x, third.y - other.y) < 120) {
            crowdBonus = 20;
            break;
          }
        }
      }
    }
    const score = d - trapped - stumbleBonus - crowdBonus + escapePenalty;
    if ((other.immunityTimer || 0) > 0) {
      if (score < fallbackScore) {
        fallbackScore = score;
        fallback = other;
      }
      continue;
    }
    if (score < bestScore) {
      bestScore = score;
      best = other;
    }
  }
  const chosen = best || fallback;
  if (chosen && isGod) {
    bot._tgtI = chosen.index;
    bot._tgtLock = 0.75;
  } else if (chosen) {
    bot._tgtI = chosen.index;
    bot._tgtLock = 0.5;
  }
  return chosen;
}

// ---------- siper noktası (tehditten pillar arkası) ----------

function shieldPoint(game, bot, threat) {
  const tuning = getMapTuning(game);
  let best = null;
  let bestD = Infinity;
  for (const pil of game.pillars) {
    const cx = pil.x + pil.w / 2;
    const cy = pil.y + pil.h / 2;
    const d = Math.hypot(cx - bot.x, cy - bot.y);
    if (d < bestD) {
      bestD = d;
      best = pil;
    }
  }
  if (!best) return null;
  const cx = best.x + best.w / 2;
  const cy = best.y + best.h / 2;
  const ang = threat
    ? Math.atan2(cy - threat.y, cx - threat.x)
    : Math.atan2(cy - game.arena.cy, cx - game.arena.cx);
  const coverDist = (Math.max(best.w, best.h) * 0.9 + bot.radius) * tuning.coverMult;
  return { x: cx + Math.cos(ang) * coverDist, y: cy + Math.sin(ang) * coverDist };
}

// ---------- panik köşesi (en uzak + en tenha, kilitli) ----------

function panicCorner(game, bot, threat) {
  const { left, right, top, bottom } = game.arena;
  const pad = 60;
  if ((bot._cornerLock || 0) > 0 && bot._cornerI !== undefined) {
    const corners = [
      { x: left + pad, y: top + pad },
      { x: right - pad, y: top + pad },
      { x: left + pad, y: bottom - pad },
      { x: right - pad, y: bottom - pad },
    ];
    return corners[bot._cornerI] || corners[0];
  }
  const corners = [
    { x: left + pad, y: top + pad },
    { x: right - pad, y: top + pad },
    { x: left + pad, y: bottom - pad },
    { x: right - pad, y: bottom - pad },
  ];
  let farC = 0;
  let farScore = -Infinity;
  for (let i = 0; i < corners.length; i++) {
    const c = corners[i];
    const dCarrier = Math.hypot(c.x - threat.x, c.y - threat.y);
    let crowd = 0;
    for (const other of game.players) {
      if (other.index === bot.index || !other.isJoined || !other.isAlive) continue;
      if (Math.hypot(other.x - c.x, other.y - c.y) < 130) crowd += 90;
    }
    const score = dCarrier - crowd;
    if (score > farScore) {
      farScore = score;
      farC = i;
    }
  }
  bot._cornerI = farC;
  bot._cornerLock = 1.0;
  return corners[farC];
}

// ---------- dash iniş güvenliği ----------

function landingClear(game, bot, angle) {
  const step = 85;
  const lx = bot.x + Math.cos(angle) * step;
  const ly = bot.y + Math.sin(angle) * step;
  const m = (bot.radius || 14) + 6;
  const { left, right, top, bottom } = game.arena;
  if (lx < left + m || lx > right - m || ly < top + m || ly > bottom - m) return false;
  if (pointInPillar(game, lx, ly, 10)) return false;
  // Mürekkebe dash'lenmez (inişte kayıp ölmek yok)
  if (game.inkPuddles) {
    for (const puddle of game.inkPuddles) {
      if (Math.hypot(lx - puddle.x, ly - puddle.y) < puddle.radius + (bot.radius || 14) * 0.6) {
        return false;
      }
    }
  }
  return true;
}

function angleDiff(a, b) {
  let d = Math.abs(a - b);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

// ---------- direksiyon: kayma projektörü (niyet korunur) ----------

function steer(game, bot, dx, dy, damp) {
  const { left, right, top, bottom, cx, cy } = game.arena;
  const r = bot.radius || 14;
  const wallMargin = 72;
  const k = damp !== undefined ? damp : 1.0;

  // Duvar: içeri giren bileşeni sıfırla, paraleli güçlendir (kayma)
  if (bot.x - left - r < wallMargin && dx < 0) {
    dx = 0;
    dy *= 1.15;
    if (Math.abs(dy) < 0.25) dy = (bot.y < cy ? -1 : 1) * 0.9;
  }
  if (right - r - bot.x < wallMargin && dx > 0) {
    dx = 0;
    dy *= 1.15;
    if (Math.abs(dy) < 0.25) dy = (bot.y < cy ? -1 : 1) * 0.9;
  }
  if (bot.y - top - r < wallMargin && dy < 0) {
    dy = 0;
    dx *= 1.15;
    if (Math.abs(dx) < 0.25) dx = (bot.x < cx ? -1 : 1) * 0.9;
  }
  if (bottom - r - bot.y < wallMargin && dy > 0) {
    dy = 0;
    dx *= 1.15;
    if (Math.abs(dx) < 0.25) dx = (bot.x < cx ? -1 : 1) * 0.9;
  }

  // Pillar: içeri giren bileşeni çıkar (kayma), çok dipte hafif dışarı
  for (const pil of game.pillars) {
    const pilCx = pil.x + pil.w / 2;
    const pilCy = pil.y + pil.h / 2;
    const dPil = Math.hypot(bot.x - pilCx, bot.y - pilCy);
    const threshold = Math.max(pil.w, pil.h) * 0.75 + r + 15;
    if (dPil < threshold && dPil > 0.001) {
      const nx = (bot.x - pilCx) / dPil;
      const ny = (bot.y - pilCy) / dPil;
      const into = dx * nx + dy * ny;
      if (into < 0) {
        const keep = 0.85 * k;
        dx -= nx * into * keep;
        dy -= ny * into * keep;
      }
      if (dPil < r + 20) {
        dx += nx * 0.4 * k;
        dy += ny * 0.4 * k;
      }
    }
  }

  // Mürekkep: önüne çıkacaksa yana kır (tek ayar, toplama değil)
  for (const puddle of game.inkPuddles) {
    const px = bot.x + dx * 50;
    const py = bot.y + dy * 50;
    const dNext = Math.hypot(px - puddle.x, py - puddle.y);
    if (dNext < puddle.radius + r * 0.6) {
      const spaceL = bot.x - left;
      const spaceR = right - bot.x;
      const s = spaceL + (bot.y - top) > spaceR + (bottom - bot.y) ? 1 : -1;
      const nx = -dy * s;
      const ny = dx * s;
      const w = (bot.slotType === 'bot_god' ? 1.2 : 0.8) * k;
      dx += nx * w;
      dy += ny * w;
      break;
    }
  }

  return [dx, dy];
}

// ---------- yol: aim noktası engelliyse kilitli köşeye ----------

function routeAroundPillars(game, bot, aimX, aimY, isGod, panic) {
  for (const pil of game.pillars) {
    if (lineIntersectsRect(bot.x, bot.y, aimX, aimY, pil, bot.radius + 10)) {
      // Kilitli köşe hâlâ görüşteyse koru
      if (isGod && (bot._wpLock || 0) > 0 && bot._wpX !== undefined) {
        if (checkLineOfSight(game, bot.x, bot.y, bot._wpX, bot._wpY, 4)) {
          return { x: bot._wpX, y: bot._wpY, blocked: true };
        }
      }
      const mapTune = getMapTuning(game);
      const clearance = bot.radius + (isGod && panic ? 10 : 18) + mapTune.clearanceBonus;
      const corners = [
        { x: pil.x - clearance, y: pil.y - clearance },
        { x: pil.x + pil.w + clearance, y: pil.y - clearance },
        { x: pil.x + pil.w + clearance, y: pil.y + pil.h + clearance },
        { x: pil.x - clearance, y: pil.y + pil.h + clearance },
      ];
      let bestCorner = null;
      let bestTotal = Infinity;
      for (const c of corners) {
        if (checkLineOfSight(game, bot.x, bot.y, c.x, c.y, 4)) {
          const tot = Math.hypot(c.x - bot.x, c.y - bot.y) + Math.hypot(aimX - c.x, aimY - c.y);
          if (tot < bestTotal) {
            bestTotal = tot;
            bestCorner = c;
          }
        }
      }
      if (bestCorner) {
        if (isGod) {
          bot._wpX = bestCorner.x;
          bot._wpY = bestCorner.y;
          bot._wpLock = 0.4;
        }
        return { x: bestCorner.x, y: bestCorner.y, blocked: true };
      }
      return { x: aimX, y: aimY, blocked: true };
    }
  }
  if ((bot._wpLock || 0) <= 0) bot._wpX = undefined;
  return { x: aimX, y: aimY, blocked: false };
}

// ============================================================
// ANA FONKSİYON
// ============================================================

export function updateBombBotAI(game, bot, dt) {
  const carrier = game.players[game.bombCarrierIndex];
  const isCarrier = bot.index === game.bombCarrierIndex;
  const isGod = bot.slotType === 'bot_god';
  const phase = getPhase(game);
  const panic = phase === 'PANIC' || phase === 'DESPERATE';
  const desperate = phase === 'DESPERATE' && isCarrier;
  const { left, right, top, bottom, cx, cy } = game.arena;

  // Kilit sayaçları
  if ((bot._tgtLock || 0) > 0) bot._tgtLock -= dt;
  if ((bot._wpLock || 0) > 0) bot._wpLock -= dt;
  if ((bot._cornerLock || 0) > 0) bot._cornerLock -= dt;
  if ((bot._dodgeLock || 0) > 0) bot._dodgeLock -= dt;

  bot._dbgPhase = phase;

  // Carrier hareketsizliği (kaçanlar korkmasın)
  let carrierStill = false;
  if (!isCarrier && carrier && carrier.isAlive) {
    const cspd = Math.hypot(carrier.vx || 0, carrier.vy || 0);
    if (cspd < 25) bot._stillT = (bot._stillT || 0) + dt;
    else bot._stillT = 0;
    carrierStill = (bot._stillT || 0) > 1.0;
  } else {
    bot._stillT = 0;
  }

  // ---------- STATE SEÇİMİ ----------
  let state = 'FLEER_SAFE';
  let target = null;
  let distToCarrier = Infinity;
  if (carrier && carrier.isAlive) {
    distToCarrier = Math.hypot(carrier.x - bot.x, carrier.y - bot.y);
  }

  if (isCarrier) {
    state = (isGod && (bot.stumbleTimer || 0) > 0.15) ? 'CARRIER_STUMBLED' : 'CARRIER_HUNT';
    if (state === 'CARRIER_HUNT') target = selectTarget(game, bot, isGod);
    else target = selectTarget(game, bot, isGod); // kaplumbağa da hedefe yürür
  } else if (isGod && (bot.immunityTimer || 0) > 0.3) {
    state = 'GIVER_IMMUNE';
  } else if (!carrier || !carrier.isAlive) {
    state = 'FLEER_SAFE';
  } else if (panic || distToCarrier < 140) {
    state = 'FLEER_PANIC';
  } else if (distToCarrier < 300) {
    state = 'FLEER_THREATENED';
  } else {
    state = 'FLEER_SAFE';
  }
  bot._dbgState = state;

  // ---------- NİYET (tek aim noktası) ----------
  let aimX = bot.x;
  let aimY = bot.y;
  let chasePressure = 1.0; // direksiyon sönümü: lunge'da itmeler yarıya
  let wantDashCheck = null;

  if (state === 'CARRIER_HUNT' || state === 'CARRIER_STUMBLED') {
    const opp = target;
    if (!opp) {
      aimX = cx;
      aimY = cy;
    } else if (state === 'CARRIER_STUMBLED') {
      // Sersem: hedefe doğru sipere yürü (bekleme yok)
      const cover = shieldPoint(game, bot, opp);
      if (cover) {
        aimX = (cover.x + opp.x) / 2;
        aimY = (cover.y + opp.y) / 2;
      } else {
        aimX = opp.x;
        aimY = opp.y;
      }
      chasePressure = 0.8;
    } else {
      const predicted = predictIntercept(game, bot, opp, isGod);
      bot._chaseX = predicted.x;
      bot._chaseY = predicted.y;
      aimX = predicted.x;
      aimY = predicted.y;
      const minDist = Math.hypot(opp.x - bot.x, opp.y - bot.y);
      if (isGod && minDist < 120) chasePressure = panic ? 2.5 : 2.0;

      // passCooldown: yüze koşma, açı kes
      if (isGod && (game.passCooldown || 0) > 0.4 && !desperate) {
        const a = Math.atan2(aimY - bot.y, aimX - bot.x);
        aimX = bot.x + Math.cos(a) * 100 - Math.sin(a) * 50;
        aimY = bot.y + Math.sin(a) * 100 + Math.cos(a) * 50;
      }

      // TURBO yemleme: rakip turbo'ya koşuyorsa ve önce biz varırsak önünü kes
      // (TELEPORT/SLIP'e dokunma: taşıyıcıya kendini ışınlatmak/ayağına mürekkep zarar)
      let intercepted = false;
      if (isGod && game.pickups.length > 0 && (game.passCooldown || 0) <= 0.4) {
        const botSpd = Math.max(120, Math.hypot(bot.vx || 0, bot.vy || 0));
        const oppSpd = Math.max(120, Math.hypot(opp.vx || 0, opp.vy || 0));
        for (const pk of game.pickups) {
          if (pk.type !== 'TURBO') continue;
          const oppToItem = Math.hypot(pk.x - opp.x, pk.y - opp.y);
          if (oppToItem > 150) continue;
          const botToItem = Math.hypot(pk.x - bot.x, pk.y - bot.y);
          const toItemDot =
            (pk.x - opp.x) * (opp.vx || 0) + (pk.y - opp.y) * (opp.vy || 0);
          if (toItemDot <= 0) continue; // rakip eşyaya gitmiyor
          if (botToItem / botSpd > (oppToItem / oppSpd) * 1.1) continue; // geç kalırız
          if (!checkLineOfSight(game, bot.x, bot.y, pk.x, pk.y, 6)) continue;
          aimX = pk.x;
          aimY = pk.y;
          chasePressure = Math.max(chasePressure, 2.0);
          intercepted = true;
          break;
        }
      }

      // TURBO: yol üstündeyse sap
      if (!intercepted && game.pickups.length > 0) {
        let boost = null;
        let boostD = Infinity;
        for (const pk of game.pickups) {
          if (pk.type !== 'TURBO') continue;
          const dPk = Math.hypot(pk.x - bot.x, pk.y - bot.y);
          const range = isGod ? 200 : 120;
          if (dPk < range && dPk < boostD) {
            boostD = dPk;
            boost = pk;
          }
        }
        const want = (game.passCooldown || 0) > 0.4 ? minDist * 0.9 : minDist * 0.6;
        if (boost && boostD < want) {
          aimX = aimX * 0.7 + boost.x * 0.3;
          aimY = aimY * 0.7 + boost.y * 0.3;
        }
      }

      // Dash planı (tek yer)
      wantDashCheck = () => {
        if ((game.passCooldown || 0) > 0.4 && !desperate) return; // biriktir
        if (opp.immunityTimer > 0) return;
        const d = Math.hypot(opp.x - bot.x, opp.y - bot.y);
        if (d < 45) return; // temas an meselesi, biriktir
        let range = isGod ? (panic ? 170 : 135) : 110;
        if (isGod && (opp.dashCooldown || 0) > 0.5) range += 25;
        if (isGod && (bot.turboTimer || 0) > 0) range += 20;
        if (isGod && Math.hypot(opp.vx || 0, opp.vy || 0) < 25) range += 15;
        if (phase === 'ECONOMY' && d > 115) return; // ekonomide savurma
        if (d > range) return;
        if (bot.dashCooldown > 0 || (bot.slipTimer || 0) > 0) return;
        const ta = Math.atan2(aimY - bot.y, aimX - bot.x);
        const preGate = isGod ? 0.7 : 0.5;
        const tol = isGod ? 0.9 : 0.6;
        if (angleDiff(bot.facingAngle, ta) > preGate) return;
        if (angleDiff(bot.facingAngle, ta) >= tol) return;
        if (!checkLineOfSight(game, bot.x, bot.y, aimX, aimY, 6)) return;
        if (!landingClear(game, bot, ta)) return;
        game.triggerDash(bot.index);
      };
    }
  } else if (state === 'GIVER_IMMUNE') {
    // Dokunulmaz + boost: bedava pencereyi eşyaya çevir
    let greedy = null;
    let greedyD = Infinity;
    for (const pk of game.pickups) {
      const dPk = Math.hypot(pk.x - bot.x, pk.y - bot.y);
      if (dPk < greedyD && dPk < 280) {
        greedyD = dPk;
        greedy = pk;
      }
    }
    if (greedy) {
      aimX = greedy.x;
      aimY = greedy.y;
    } else {
      aimX = cx;
      aimY = cy;
    }
    chasePressure = 1.0;
  } else if (state === 'FLEER_SAFE') {
    // Ekonomi devriyesi: carrier'dan uzak eşya, yoksa merkez
    let bestPk = null;
    let bestScore = Infinity;
    for (const pk of game.pickups) {
      const dPick = Math.hypot(pk.x - bot.x, pk.y - bot.y);
      if (dPick > 320) continue;
      let mult = 1.0;
      if (pk.type === 'TELEPORT') mult = isGod ? 1.4 : 1.6; // ekonomide teleport değersiz
      else if (pk.type === 'TURBO') mult = isGod ? 0.8 : 1.0;
      else mult = 2.0;
      let penalty = 0;
      if (carrier && carrier.isAlive && Math.hypot(pk.x - carrier.x, pk.y - carrier.y) < 150) penalty = 150;
      const s = dPick * mult + penalty;
      if (s < bestScore) {
        bestScore = s;
        bestPk = pk;
      }
    }
    if (bestPk) {
      aimX = bestPk.x;
      aimY = bestPk.y;
    } else {
      const mdl = Math.hypot(cx - bot.x, cy - bot.y);
      if (mdl > 80) {
        aimX = cx;
        aimY = cy;
      } else {
        // Canlı devir: minik daire (ölü gibi durma)
        bot._wanderA = (bot._wanderA || 0) + dt * 0.8;
        aimX = bot.x + Math.cos(bot._wanderA) * 60;
        aimY = bot.y + Math.sin(bot._wanderA) * 60;
      }
    }
    chasePressure = 1.0;
  } else if (state === 'FLEER_THREATENED' || state === 'FLEER_PANIC') {
    const cLead = isGod ? 0.4 : 0;
    const cFx = carrier.x + (carrier.vx || 0) * cLead;
    const cFy = carrier.y + (carrier.vy || 0) * cLead;

    if (state === 'FLEER_PANIC' && !carrierStill) {
      // TELEPORT kap veya tenha köşe (DESPERATE'ta haritanın öbür ucu bile koşulur)
      const desperateFlee = phase === 'DESPERATE';
      let tele = null;
      let teleD = Infinity;
      const sense = desperateFlee ? Infinity : isGod ? 260 : 130;
      for (const pk of game.pickups) {
        if (pk.type !== 'TELEPORT') continue;
        const dPick = Math.hypot(pk.x - bot.x, pk.y - bot.y);
        if (dPick < teleD && dPick < sense) {
          teleD = dPick;
          tele = pk;
        }
      }
      const grabDist = phase === 'PANIC' || phase === 'DESPERATE' ? 170 : 140;
      if (tele && (desperateFlee || distToCarrier < grabDist + 60)) {
        aimX = tele.x;
        aimY = tele.y;
      } else {
        const corner = isGod ? panicCorner(game, bot, carrier) : null;
        if (corner && distToCarrier < 160) {
          aimX = corner.x;
          aimY = corner.y;
        } else {
          const dx = bot.x - cFx;
          const dy = bot.y - cFy;
          const dl = Math.hypot(dx, dy) || 1;
          aimX = bot.x + (dx / dl) * 120;
          aimY = bot.y + (dy / dl) * 120;
        }
      }
    } else if (carrierStill) {
      // Duran carrier'dan korkma: eşyaya çık
      let greedy = null;
      let greedyD = Infinity;
      for (const pk of game.pickups) {
        const dPk = Math.hypot(pk.x - bot.x, pk.y - bot.y);
        if (dPk < greedyD && dPk < 300) {
          greedyD = dPk;
          greedy = pk;
        }
      }
      if (greedy) {
        aimX = greedy.x;
        aimY = greedy.y;
      } else {
        aimX = cx;
        aimY = cy;
      }
    } else if (distToCarrier < 160) {
      // Yakın: kalkan arkasına (niyet değişimi, harman yok)
      const shield = shieldPoint(game, bot, carrier);
      if (shield) {
        aimX = shield.x;
        aimY = shield.y;
      } else {
        const dx = bot.x - cFx;
        const dy = bot.y - cFy;
        const dl = Math.hypot(dx, dy) || 1;
        aimX = bot.x + (dx / dl) * 120;
        aimY = bot.y + (dy / dl) * 120;
      }
    } else {
      // Orta mesafe: uzaklaş + orbit (bait okumalı)
      const tune = getMapTuning(game);
      let ox = bot.x - cFx;
      let oy = bot.y - cFy;
      const ol = Math.hypot(ox, oy) || 1;
      ox /= ol;
      oy /= ol;
      let orbitW = isGod ? 0.7 * tune.orbitMult : 0.3;
      if (isGod) {
        if ((carrier.dashCooldown || 0) <= 0 && distToCarrier < 170) orbitW = 1.0 * tune.orbitMult;
        else if ((carrier.dashCooldown || 0) > 1.2) orbitW = 0.45 * tune.orbitMult;
      }
      const spaceScore = bot.x - left + (bot.y - top) - (right - bot.x) - (bottom - bot.y);
      const s = spaceScore > 0 ? 1 : -1;
      const dirX = ox + -oy * s * orbitW;
      const dirY = oy + ox * s * orbitW;
      aimX = bot.x + dirX * 120;
      aimY = bot.y + dirY * 120;

      // Tehdit altındayken yoldaki TURBO/SLIP tuzağı
      if (isGod && distToCarrier > 90) {
        let pk = null;
        let pkScore = Infinity;
        for (const p of game.pickups) {
          const dPick = Math.hypot(p.x - bot.x, p.y - bot.y);
          if (dPick > 180) continue;
          let mult = 1.0;
          if (p.type === 'TURBO') mult = distToCarrier < 170 ? 0.65 : 0.8;
          else if (p.type === 'SLIP') mult = distToCarrier < 150 && dPick < 160 ? 0.7 : 1.6;
          else if (p.type === 'TELEPORT') mult = 0.9;
          const sc = dPick * mult;
          if (sc < pkScore) {
            pkScore = sc;
            pk = p;
          }
        }
        if (pk) {
          aimX = aimX * 0.55 + pk.x * 0.45;
          aimY = aimY * 0.55 + pk.y * 0.45;
        }
      }
    }

    // Matador: carrier hamleye kalktıysa yana kaç (yön kilitli, titreme yok;
    // dash asla bakılmayan yöne basılmaz)
    wantDashCheck = () => {
      if (bot.dashCooldown > 0 || (bot.slipTimer || 0) > 0) return;
      if (isGod && carrier.isDashing && distToCarrier < 190) {
        // closing: negatif = carrier üstümüze kapanıyor (değişken tanımı gereği)
        const closing =
          -((bot.x - carrier.x) * (carrier.vx || 0) + (bot.y - carrier.y) * (carrier.vy || 0)) /
          (distToCarrier || 1);
        if (closing < -60) {
          if ((bot._dodgeLock || 0) <= 0) {
            const spaceA = bot.x - left + (bot.y - top);
            const spaceB = right - bot.x + (bottom - bot.y);
            bot._dodgeSide = spaceA > spaceB ? 1 : -1;
            bot._dodgeLock = 0.35;
          }
          const baseA = Math.atan2(bot.y - carrier.y, bot.x - carrier.x);
          const dodgeA = baseA + bot._dodgeSide * (Math.PI / 2) * 0.7;
          aimX = bot.x + Math.cos(dodgeA) * 110;
          aimY = bot.y + Math.sin(dodgeA) * 110;
          if (
            angleDiff(bot.facingAngle, dodgeA) < 0.9 &&
            landingClear(game, bot, bot.facingAngle)
          ) {
            const lx = bot.x + Math.cos(bot.facingAngle) * 85;
            const ly = bot.y + Math.sin(bot.facingAngle) * 85;
            if (Math.hypot(lx - carrier.x, ly - carrier.y) >= distToCarrier - 30) {
              game.triggerDash(bot.index);
            }
          }
          return;
        }
      }
      const range = isGod ? 95 : 75;
      if (distToCarrier > range) return;
      const closing =
        -((bot.x - carrier.x) * (carrier.vx || 0) + (bot.y - carrier.y) * (carrier.vy || 0)) /
        (distToCarrier || 1);
      if (!(closing > -20 || distToCarrier < 70)) return;
      const ta = Math.atan2(aimY - bot.y, aimX - bot.x);
      if (!landingClear(game, bot, bot.facingAngle)) return;
      // İniş carrier'a yaklaşmamalı
      const lx = bot.x + Math.cos(bot.facingAngle) * 85;
      const ly = bot.y + Math.sin(bot.facingAngle) * 85;
      const landD = Math.hypot(lx - carrier.x, ly - carrier.y);
      if (landD < distToCarrier - 30) return;
      void ta;
      game.triggerDash(bot.index);
    };
    chasePressure = 1.0;
  }

  // ---------- YOL + DASH ----------
  const routed = routeAroundPillars(game, bot, aimX, aimY, isGod, panic);
  aimX = routed.x;
  aimY = routed.y;
  if (routed.blocked && (state === 'CARRIER_HUNT' || state === 'CARRIER_STUMBLED')) {
    chasePressure = Math.max(chasePressure, 1.5);
  }

  if (wantDashCheck) {
    try {
      wantDashCheck();
    } catch (e) {
      /* dash opsiyonel, yürüyüşü öldürmesin */
    }
  }

  // ---------- YÜRÜYÜŞ ----------
  let moveX = 0;
  let moveY = 0;
  const toAimX = aimX - bot.x;
  const toAimY = aimY - bot.y;
  const toAimL = Math.hypot(toAimX, toAimY);
  if (toAimL > 12) {
    let dx = toAimX / toAimL;
    let dy = toAimY / toAimL;
    // Lunge baskısı: niyet büyür, direksiyon sönümü küçülür
    if (chasePressure > 1.0) {
      dx *= chasePressure;
      dy *= chasePressure;
    }
    const damp = chasePressure > 1.0 || desperate ? 0.5 : 1.0;
    const steered = steer(game, bot, dx, dy, damp);
    moveX = steered[0];
    moveY = steered[1];

    // Ayrışma (kaçanlar): en yakın dosta hafif itiş — tek kaynak
    if (!isCarrier && isGod) {
      let ndx = 0;
      let ndy = 0;
      let nd = Infinity;
      for (const other of game.players) {
        if (other.index === bot.index) continue;
        if (carrier && other.index === carrier.index) continue;
        if (!other.isJoined || !other.isAlive) continue;
        const ddx = bot.x - other.x;
        const ddy = bot.y - other.y;
        const dd = Math.hypot(ddx, ddy);
        if (dd < nd) {
          nd = dd;
          ndx = ddx;
          ndy = ddy;
        }
      }
      if (nd < 70 && nd > 0.01) {
        const shove = nd < 50 ? 1.2 : 0.7;
        moveX += (ndx / nd) * shove;
        moveY += (ndy / nd) * shove;
      }
    }
  }

  // ---------- TAKILMA KURTARMA (role göre) ----------
  const frameMove = Math.hypot(bot.x - bot.lastX, bot.y - bot.lastY);
  bot.lastX = bot.x;
  bot.lastY = bot.y;
  if (frameMove < 20 * dt) {
    bot.stuckAccumulator = (bot.stuckAccumulator || 0) + dt;
  } else {
    bot.stuckAccumulator = Math.max(0, (bot.stuckAccumulator || 0) - dt * 2.5);
  }
  const stuckLimit = isGod ? 0.12 : 0.16;
  if (bot.stuckAccumulator > stuckLimit) {
    bot.unstuckDuration = isGod ? 0.45 : 0.38;
    let baseAngle;
    if (!isCarrier && carrier && carrier.isAlive) {
      baseAngle = Math.atan2(bot.y - carrier.y, bot.x - carrier.x);
    } else if (isCarrier && isGod && bot._chaseX !== undefined) {
      baseAngle = Math.atan2(bot._chaseY - bot.y, bot._chaseX - bot.x);
    } else {
      baseAngle = Math.atan2(cy - bot.y, cx - bot.x);
    }
    bot.unstuckAngle = baseAngle + (Math.random() > 0.5 ? 0.7 : -0.7);
    bot.stuckAccumulator = 0;
  }
  if (bot.unstuckDuration > 0) {
    bot.unstuckDuration -= dt;
    moveX = Math.cos(bot.unstuckAngle) * 1.5;
    moveY = Math.sin(bot.unstuckAngle) * 1.5;
  }

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
