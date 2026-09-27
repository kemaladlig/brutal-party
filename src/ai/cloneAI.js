// BRUTAL CLONE AI v2: İleri Düzey Dedektif & Klon Avcısı
// Rol yapma, tapınak koridorlarında akıllı rota bulma (navigasyon),
// şüpheli oyuncu tespiti (hız, ani yön değişimi, depar, görev iptali),
// pusu kurma ve cerrahi omuz atışı (tackle).

import { createReadOnlyView } from '../core/botView.js';
import { hasClearLine } from '../core/physics2d.js';

// İnsan oyuncu taban hızı (px/sn). Bunun altındaki hareket NPC/bot sayılır.
// Eskiden yorum içinde "115" diye gömülüydü; motor hızı değişince eşik yanlış kalıyordu.
const CLONE_HUMAN_SPEED_FLOOR = 115;
const CLONE_SUSPECT_SCORE = 35;
const CLONE_SUSPECT_RANGE = 190;
const CLONE_STALK_GIVEUP = 240;
const CLONE_TACKLE_MIN = 40;
const CLONE_TACKLE_MAX = 60;
// Botun görev noktasında "varmış" sayılma payı. Sabit 30 px, saha küçükken
// (telefonda görev yarıçapı ~14 px) noktaya 30 px'te durup ödül alamıyordu.
const CLONE_TASK_ARRIVE = 12;

// Tapınak kapı geçiş noktaları (duvarlara takılmadan oda değiştirmek için)
function getDoorWaypoints(arena) {
  const { left, right, top, bottom, width, height, cx, cy } = arena;
  const roomW = width * 0.35;
  const roomH = height * 0.35;
  const doorSize = Math.min(width, height) * 0.14;

  return {
    alchemyDoor: { x: left + roomW - doorSize * 0.5, y: top + roomH + 15 },
    libraryDoor: { x: right - roomW + doorSize * 0.5, y: top + roomH + 15 },
    treasuryDoor: { x: left + roomW - doorSize * 0.5, y: bottom - roomH - 15 },
    altarDoor: { x: right - roomW + doorSize * 0.5, y: bottom - roomH - 15 },
    center: { x: cx, y: cy },
  };
}

// Bir noktanın hangi odada veya merkezde olduğunu bulur
function getZone(x, y, arena) {
  const { left, right, top, bottom, width, height } = arena;
  const roomW = width * 0.35;
  const roomH = height * 0.35;

  if (x < left + roomW && y < top + roomH) return 'alchemy';
  if (x > right - roomW && y < top + roomH) return 'library';
  if (x < left + roomW && y > bottom - roomH) return 'treasury';
  if (x > right - roomW && y > bottom - roomH) return 'altar';
  return 'courtyard';
}

export function updateCloneBotAI(rawGame, bot, dt) {
  const game = createReadOnlyView(rawGame);
  if (!bot.aiMemory) {
    bot.aiMemory = {
      state: 'PATROL_TASK',
      currentTask: null,
      path: [],
      suspects: {}, // { [id]: { score, lastX, lastY, lastSteerX, lastSteerY } }
      patrolWaitTimer: 0,
      targetEnemy: null,
    };
  }

  const mem = bot.aiMemory;

  // Oyunda insan yokken aranacak kimse yok. checkTackleHit slotType'a bakmıyor
  // (clone.js:405) — her katılmış oyuncuyu öldürüyor — ve botlar da dallyabildiği
  // için savunma refleksi dört-bot lobisinde karşılıklı öldürme döngüsüne
  // dönüşüyordu. İnsan yokken bot yalnız görev devriyesi yapar.
  const hasHuman = game.players.some(
    (p) => p.isJoined && p.isAlive && p.slotType === 'human' && p.index !== bot.index
  );
  if (hasHuman) {
    detectSuspects(game, bot, mem, dt);
    if (reactToThreat(game, bot)) return;
    if (mem.state === 'STALK_AND_STRIKE'
        && mem.targetEnemy && mem.targetEnemy.isAlive
        && runStalk(game, bot, mem)) {
      return;
    }
  } else if (mem.state !== 'PATROL_TASK') {
    mem.state = 'PATROL_TASK';
    mem.targetEnemy = null;
  }

  patrolTask(game, bot, mem, dt);
}

// 1. ŞÜPHE TAKİBİ: gerçek oyuncuyu hareketinden ayırt et.
function detectSuspects(game, bot, mem, dt) {
  for (const p of game.players) {
    if (!p.isJoined || !p.isAlive || p.index === bot.index) continue;
    // Yalnız insanlar şüphelidir. Botlar da dallyabildiği için önceki hâlde
    // dash kriteri (+80, tek karede) botları da işaretliyor, botlar birbirini
    // avlayıp görev devriyesini bırakıyordu.
    if (p.slotType !== 'human') continue;

    const id = `player_${p.index}`;
    if (!mem.suspects[id]) {
      mem.suspects[id] = {
        score: 0,
        lastX: p.x, lastY: p.y,
        lastSteerX: p.steerX || 0, lastSteerY: p.steerY || 0,
      };
    }
    const s = mem.suspects[id];
    const dist = Math.hypot(p.x - bot.x, p.y - bot.y);
    const movedDist = Math.hypot(p.x - s.lastX, p.y - s.lastY);
    const currentSpeed = movedDist / Math.max(0.01, dt);

    // Kriter A: Hızlı koşu veya depar tespiti
    if (p.dashTimer > 0) {
      s.score += 80; // Kesin gerçek oyuncu!
    } else if (currentSpeed > CLONE_HUMAN_SPEED_FLOOR) {
      s.score += dt * 40;
    }

    // Kriter B: Ani yön değişimleri (insan joystick hareketleri)
    const steerMag = Math.hypot(p.steerX || 0, p.steerY || 0);
    const lastSteerMag = Math.hypot(s.lastSteerX, s.lastSteerY);
    if (steerMag > 0.5 && lastSteerMag > 0.5) {
      const dot = (p.steerX || 0) * s.lastSteerX + (p.steerY || 0) * s.lastSteerY;
      if (dot < 0.2) s.score += dt * 25; // 90 dereceden fazla ani dönüş
    }

    // Kriter C: Görev tamamlama tespiti
    if (p.taskTimer > 0.8) s.score += dt * 30;

    // Yakınsa ve şüphe yüksekse hedef olarak seç
    if (s.score > CLONE_SUSPECT_SCORE && dist < CLONE_SUSPECT_RANGE) {
      mem.targetEnemy = p;
      mem.state = 'STALK_AND_STRIKE';
    }

    s.lastX = p.x;
    s.lastY = p.y;
    s.lastSteerX = p.steerX || 0;
    s.lastSteerY = p.steerY || 0;
    s.score = Math.max(0, s.score - dt * 2); // zamanla şüphe söner
  }
}

// 2. SAVUNMA REFLEKSİ: birisi üstüme doğru depar atıyorsa karşı depar.
// Duvar arkasındaki bir depar için karşı depar anlamsız (isabet edemez) ve
// cooldown yakıyordu; görüş hattı şart.
function reactToThreat(game, bot) {
  for (const enemy of game.players) {
    if (!enemy.isJoined || !enemy.isAlive || enemy.index === bot.index) continue;
    if (enemy.slotType !== 'human') continue;
    const eDist = Math.hypot(enemy.x - bot.x, enemy.y - bot.y);
    if (eDist < 70 && enemy.dashTimer > 0
        && bot.dashCooldown <= 0 && bot.slowTimer <= 0
        && hasClearLine(bot.x, bot.y, enemy.x, enemy.y, game.walls)) {
      bot.angle = Math.atan2(enemy.y - bot.y, enemy.x - bot.x);
      game.attemptTackle(bot);
      return true;
    }
  }
  return false;
}

// 3. DURUM A: PUSU & İNFAZ. true dönerse bu karede bitti.
function runStalk(game, bot, mem) {
  const target = mem.targetEnemy;
  const dx = target.x - bot.x;
  const dy = target.y - bot.y;
  const dist = Math.hypot(dx, dy);

  if (dist > CLONE_STALK_GIVEUP) {
    mem.state = 'PATROL_TASK';
    mem.targetEnemy = null;
    return false;
  }

  const aimAngle = Math.atan2(dy, dx);
  bot.angle = aimAngle;
  bot.steerX = Math.cos(aimAngle);
  bot.steerY = Math.sin(aimAngle);

  // Cerrahi vuruş: 40-60px ve duvar arkasında değilse.
  // Eski hâli `normalizeAngle(aimAngle - bot.angle) < 0.4` idi ama `bot.angle`
  // iki satır önce `aimAngle`'a atanıyordu — fark daima 0, yani ölü koddu.
  if (dist < CLONE_TACKLE_MAX && dist > CLONE_TACKLE_MIN
      && bot.dashCooldown <= 0 && bot.slowTimer <= 0
      && hasClearLine(bot.x, bot.y, target.x, target.y, game.walls)) {
    game.attemptTackle(bot);
    mem.state = 'PATROL_TASK';
    mem.targetEnemy = null;
    return true;
  }
  return false;
}

// 4. DURUM B: GÖREV DEVRİYESİ VE ROL YAPMA
function patrolTask(game, bot, mem, dt) {
  const arena = game.arena;
  const waypoints = getDoorWaypoints(arena);

  if (!mem.currentTask) {
    const tasks = game.taskPoints;
    if (tasks && tasks.length) {
      mem.currentTask = tasks[Math.floor(Math.random() * tasks.length)];
    }
  }
  if (!mem.currentTask) {
    bot.steerX = 0;
    bot.steerY = 0;
    return;
  }

  const task = mem.currentTask;
  const currentZone = getZone(bot.x, bot.y, arena);
  const targetZone = task.id; // 'alchemy' | 'library' | 'treasury' | 'altar'
  const distToTask = Math.hypot(task.x - bot.x, task.y - bot.y);
  // Puan almak için noktanın kendi yarıçapına girmesi gerekiyor (clone.js:570);
  // o yarıçaptan büyük bir sabitle "vardı" dersek bot hiç puan kazanamaz.
  // Puan almak için noktanın kendi yarıçapına girmesi gerekiyor (clone.js:570);
  // o yarıçaptan büyük bir sabitle "vardı" dersek bot hiç puan kazanamaz.
  // Yüzde 60: oyuncu da aynı yarıçapı kullanıyor, bot hem daha kolay hem daha
  // zor görev almamalı.
  const arriveAt = Math.max(CLONE_TASK_ARRIVE, (task.radius || 0) * 0.6);

  if (distToTask < arriveAt) {
    // Görev noktasına ulaştı: dur, görevi yap, yıldız kazan
    bot.steerX = 0;
    bot.steerY = 0;
    mem.patrolWaitTimer += dt;
    bot.angle += Math.sin(performance.now() / 400) * 0.025; // NPC gibi etrafa bakın

    if (mem.patrolWaitTimer >= 2.6) {
      mem.patrolWaitTimer = 0;
      const others = game.taskPoints.filter((tp) => tp.id !== task.id);
      mem.currentTask = others.length
        ? others[Math.floor(Math.random() * others.length)]
        : game.taskPoints[0];
    }
    return;
  }

  // Farklı bir odadaysak önce kapı geçiş noktasına git, sonra hedefe
  let moveTargetX = task.x;
  let moveTargetY = task.y;
  if (currentZone !== targetZone) {
    const key = currentZone === 'courtyard' ? `${targetZone}Door` : `${currentZone}Door`;
    const door = waypoints[key];
    if (door && Math.hypot(door.x - bot.x, door.y - bot.y) > 25) {
      moveTargetX = door.x;
      moveTargetY = door.y;
    }
  }

  let tDx = moveTargetX - bot.x;
  let tDy = moveTargetY - bot.y;
  const tDist = Math.hypot(tDx, tDy) || 1;
  let dirX = tDx / tDist;
  let dirY = tDy / tDist;

  // İçeri giren bileşeni sıfırla, paraleli güçlendir (kayma). Doğrudan hedefe
  // yürümek botu duvara yapıştırıyordu: 12 duvarlı tapınakta hedefe giden düz
  // bir segment neredeyse her zaman duvardan geçiyor, bot yerinde sallanıyor ve
  // hiç görev puanı kazanamıyordu.
  const r = bot.radius || 16;
  for (const wall of game.walls || []) {
    const cx = wall.x + wall.w / 2;
    const cy = wall.y + wall.h / 2;
    const dW = Math.hypot(bot.x - cx, bot.y - cy);
    const reach = Math.max(wall.w, wall.h) * 0.6 + r + 14;
    if (dW >= reach || dW < 0.001) continue;
    const nx = (bot.x - cx) / dW;
    const ny = (bot.y - cy) / dW;
    const into = dirX * nx + dirY * ny;
    if (into < 0) {
      dirX -= nx * into * 0.9;
      dirY -= ny * into * 0.9;
    }
    if (dW < r + 18) {
      dirX += nx * 0.5;
      dirY += ny * 0.5;
    }
  }

  const steerLen = Math.hypot(dirX, dirY) || 1;
  dirX /= steerLen;
  dirY /= steerLen;
  bot.steerX = dirX;
  bot.steerY = dirY;
  bot.angle = Math.atan2(dirY, dirX);

  // Yanından şüpheli insan geçerse ve çok yakınsa hızlı karar ver
  if (bot.dashCooldown <= 0 && bot.slowTimer <= 0) {
    for (const enemy of game.players) {
      if (!enemy.isJoined || !enemy.isAlive || enemy.index === bot.index) continue;
      if (enemy.slotType !== 'human') continue;
      const s = mem.suspects[`player_${enemy.index}`];
      const eDist = Math.hypot(enemy.x - bot.x, enemy.y - bot.y);
      if (s && s.score > 20 && eDist < 45
          && hasClearLine(bot.x, bot.y, enemy.x, enemy.y, game.walls)) {
        bot.angle = Math.atan2(enemy.y - bot.y, enemy.x - bot.x);
        game.attemptTackle(bot);
        return;
      }
    }
  }
}
