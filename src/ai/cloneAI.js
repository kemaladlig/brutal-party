// BRUTAL CLONE AI v2: İleri Düzey Dedektif & Klon Avcısı
// Rol yapma, tapınak koridorlarında akıllı rota bulma (navigasyon),
// şüpheli oyuncu tespiti (hız, ani yön değişimi, depar, görev iptali),
// pusu kurma ve cerrahi omuz atışı (tackle).

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

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

export function updateCloneBotAI(game, bot, dt) {
  if (!bot.aiMemory) {
    bot.aiMemory = {
      state: 'PATROL_TASK',
      currentTask: null,
      taskTimer: 0,
      path: [],
      suspects: {}, // { [id]: { score: number, lastX: number, lastY: number, lastTime: number } }
      reactionTimer: 0.1 + Math.random() * 0.2,
      patrolWaitTimer: 0,
      targetEnemy: null,
    };
  }

  const mem = bot.aiMemory;
  const arena = game.arena;
  const waypoints = getDoorWaypoints(arena);

  // 1. ŞÜPHE TAKİBİ & DEDEKTİFLİK SİSTEMİ (Gerçek oyuncuyu hareketinden ayırt etme)
  // Canlı rakipleri ve etraftaki varlıkları incele
  for (const p of game.players) {
    if (!p.isJoined || !p.isAlive || p.index === bot.index) continue;

    const id = `player_${p.index}`;
    if (!mem.suspects[id]) {
      mem.suspects[id] = { score: 0, lastX: p.x, lastY: p.y, lastSteerX: p.steerX, lastSteerY: p.steerY };
    }

    const s = mem.suspects[id];
    const dist = Math.hypot(p.x - bot.x, p.y - bot.y);
    const movedDist = Math.hypot(p.x - s.lastX, p.y - s.lastY);
    const currentSpeed = movedDist / Math.max(0.01, dt);

    // Kriter A: Hızlı Koşu veya Dash tespiti (NPC'ler max 105 px/s gider)
    if (p.dashTimer > 0) {
      s.score += 80; // Kesin gerçek oyuncu!
    } else if (currentSpeed > 115) {
      s.score += dt * 40;
    }

    // Kriter B: Ani yön değişimleri (İnsan joystick hareketleri)
    const steerMag = Math.hypot(p.steerX, p.steerY);
    const lastSteerMag = Math.hypot(s.lastSteerX, s.lastSteerY);
    if (steerMag > 0.5 && lastSteerMag > 0.5) {
      const dot = p.steerX * s.lastSteerX + p.steerY * s.lastSteerY;
      if (dot < 0.2) {
        // 90 dereceden fazla ani dönüş yaptı
        s.score += dt * 25;
      }
    }

    // Kriter C: Görev tamamlama tespiti
    if (p.taskTimer > 0.8) {
      s.score += dt * 30; // Görev yapan kişi gerçek oyuncu olabilir
    }

    // Yakınsa ve şüphe yüksekse hedef olarak seç
    if (s.score > 35 && dist < 190) {
      mem.targetEnemy = p;
      mem.state = 'STALK_AND_STRIKE';
    }

    s.lastX = p.x;
    s.lastY = p.y;
    s.lastSteerX = p.steerX;
    s.lastSteerY = p.steerY;
    // Zamanla şüphe hafifçe söner
    s.score = Math.max(0, s.score - dt * 2);
  }

  // 2. SAVUNMA / TEHLİKE ANINDA REFLEKS (Birisi üstüme doğru depar atıyorsa)
  for (const enemy of game.players) {
    if (!enemy.isJoined || !enemy.isAlive || enemy.index === bot.index) continue;
    const eDist = Math.hypot(enemy.x - bot.x, enemy.y - bot.y);
    if (eDist < 70 && enemy.dashTimer > 0) {
      // Düşman bana doğru depar atıyor! Karşı depar veya yana kaçış
      if (bot.dashCooldown <= 0 && bot.slowTimer <= 0) {
        bot.angle = Math.atan2(enemy.y - bot.y, enemy.x - bot.x);
        game.attemptTackle(bot);
        return;
      }
    }
  }

  // 3. DAVRANIŞ DURUM MAKİNESİ (State Machine)

  // DURUM A: PUSU & İNFAZ (STALK AND STRIKE)
  if (mem.state === 'STALK_AND_STRIKE' && mem.targetEnemy && mem.targetEnemy.isAlive) {
    const target = mem.targetEnemy;
    const dx = target.x - bot.x;
    const dy = target.y - bot.y;
    const dist = Math.hypot(dx, dy);

    if (dist > 240) {
      // Hedef kaçtı, devriyeye dön
      mem.state = 'PATROL_TASK';
      mem.targetEnemy = null;
    } else {
      // Hedefe doğru yönel
      const aimAngle = Math.atan2(dy, dx);
      bot.angle = aimAngle;
      bot.steerX = Math.cos(aimAngle);
      bot.steerY = Math.sin(aimAngle);

      // Cerrahi vuruş menzili: 45-65px ve açı tutarlıysa TACKLE bas
      if (dist < 60 && bot.dashCooldown <= 0 && bot.slowTimer <= 0) {
        const diff = Math.abs(normalizeAngle(aimAngle - bot.angle));
        if (diff < 0.4) {
          game.attemptTackle(bot);
          mem.state = 'PATROL_TASK';
          mem.targetEnemy = null;
          return;
        }
      }
    }
    return;
  }

  // DURUM B: GÖREV DEVRİYESİ VE ROL YAPMA (PATROL_TASK)
  if (!mem.currentTask) {
    const tasks = game.taskPoints;
    if (tasks && tasks.length) {
      mem.currentTask = tasks[Math.floor(Math.random() * tasks.length)];
    }
  }

  if (mem.currentTask) {
    const task = mem.currentTask;
    const currentZone = getZone(bot.x, bot.y, arena);
    const targetZone = task.id; // 'alchemy' | 'library' | 'treasury' | 'altar'

    // Hedefe doğrudan mesafe
    const distToTask = Math.hypot(task.x - bot.x, task.y - bot.y);

    if (distToTask < 30) {
      // Görev noktasına ulaştı: Sakin durup görev yap / yıldız kazan
      bot.steerX = 0;
      bot.steerY = 0;
      mem.patrolWaitTimer += dt;
      // Hafifçe etrafa bakın (NPC gibi)
      bot.angle += Math.sin(performance.now() / 400) * 0.025;

      if (mem.patrolWaitTimer >= 2.6) {
        // Görev bitti, başka bir göreve git
        mem.patrolWaitTimer = 0;
        const otherTasks = game.taskPoints.filter((tp) => tp.id !== task.id);
        mem.currentTask = otherTasks[Math.floor(Math.random() * otherTasks.length)] || game.taskPoints[0];
      }
      return;
    }

    // Farklı bir odadaysak önce kapı geçiş noktasına git, sonra hedefe
    let moveTargetX = task.x;
    let moveTargetY = task.y;

    if (currentZone !== targetZone) {
      if (currentZone === 'courtyard') {
        // Avludayız, hedefin kapısına git
        const doorKey = `${targetZone}Door`;
        if (waypoints[doorKey]) {
          const door = waypoints[doorKey];
          const distToDoor = Math.hypot(door.x - bot.x, door.y - bot.y);
          if (distToDoor > 25) {
            moveTargetX = door.x;
            moveTargetY = door.y;
          }
        }
      } else {
        // Bir odadayız, önce kendi odamızın kapısından çık
        const myDoorKey = `${currentZone}Door`;
        if (waypoints[myDoorKey]) {
          const myDoor = waypoints[myDoorKey];
          const distToMyDoor = Math.hypot(myDoor.x - bot.x, myDoor.y - bot.y);
          if (distToMyDoor > 25) {
            moveTargetX = myDoor.x;
            moveTargetY = myDoor.y;
          }
        }
      }
    }

    const tDx = moveTargetX - bot.x;
    const tDy = moveTargetY - bot.y;
    const tDist = Math.hypot(tDx, tDy) || 1;

    bot.steerX = tDx / tDist;
    bot.steerY = tDy / tDist;
    bot.angle = Math.atan2(tDy, tDx);

    // Yanından şüpheli bir oyuncu geçerse ve çok yakınsa hızlı karar ver
    if (bot.dashCooldown <= 0 && bot.slowTimer <= 0) {
      for (const enemy of game.players) {
        if (!enemy.isJoined || !enemy.isAlive || enemy.index === bot.index) continue;
        const eDist = Math.hypot(enemy.x - bot.x, enemy.y - bot.y);
        const s = mem.suspects[`player_${enemy.index}`];
        if (eDist < 45 && s && s.score > 20) {
          bot.angle = Math.atan2(enemy.y - bot.y, enemy.x - bot.x);
          game.attemptTackle(bot);
          break;
        }
      }
    }
  }
}
