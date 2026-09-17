// BRUTAL HEIST (Game 05): 2-4 Player Local Party Gold & Vault Stealing
// Weight Physics, Shoulder Tackle Loot Knockout, Vault Banking & Raids, 45s Gold Rush & Bot AI
import {
  playStart,
  playJoin,
  playDashWhoosh,
  playStumble,
  playCoinPickup,
  playCashRegister,
  playVaultAlarm,
  playHeavyImpact,
  playPiggyBreak,
} from './audio.js';
import { renderControlGuide } from './controlGuide.js';

export const HEIST_COLORS = ['#D84727', '#2B5B84', '#D99B26', '#2D6A4F'];
export const HEIST_NAMES = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'];

export class HeistGame {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // States: 'LOBBY', 'PLAYING', 'ROUND_OVER', 'GAME_OVER'
    this.state = 'LOBBY';

    // Arena geometry
    this.arena = {
      cx: 0,
      cy: 0,
      size: 0,
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    };

    // 4 Corner Vaults & 4 Obstacle Pillars
    this.vaults = [];
    this.pillars = [];

    // Slot types: 'empty' | 'human' | 'bot_normal' | 'bot_god'
    this.slotTypes = ['human', 'bot_normal', 'empty', 'empty']; // P1 Human, P2 Normal Bot default

    // Tournament Scoring (Sets)
    this.targetScore = 2; // First to 2 round wins is Champion!
    this.scores = [0, 0, 0, 0];
    this.roundWinner = null;
    this.matchWinner = null;
    this.roundTransitionTimer = 0;

    // Timing
    this.roundTimer = 45.0; // 45 seconds match
    this.goldRushActive = false;
    this.lootSpawnTimer = 1.5;

    // Entities
    this.players = [];
    this.lootItems = [];
    this.particles = [];
    this.floatingTexts = [];
    this.piggyBank = null;
    this.piggySpawned30 = false;
    this.piggySpawned15 = false;

    // Screen Shake (Trauma)
    this.trauma = 0;
    this.lastTime = performance.now();

    // UI Buttons
    this.uiButtons = [];
    this.tackleButtons = [];

    // 4 Corner Floating Virtual Joysticks
    this.joysticks = [
      { id: -1, originX: 0, originY: 0, currX: 0, currY: 0, active: false, angle: 0, force: 0 },
      { id: -1, originX: 0, originY: 0, currX: 0, currY: 0, active: false, angle: 0, force: 0 },
      { id: -1, originX: 0, originY: 0, currX: 0, currY: 0, active: false, angle: 0, force: 0 },
      { id: -1, originX: 0, originY: 0, currX: 0, currY: 0, active: false, angle: 0, force: 0 },
    ];

    // Keyboard Controls
    this.keys = {};
    this.initKeyboard();
  }

  initKeyboard() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.key] = true;
      this.keys[e.code] = true;

      // Tackle shortcuts
      if (this.state === 'PLAYING') {
        if (e.code === 'Space') this.triggerTackle(0);
        if (e.code === 'Enter') this.triggerTackle(1);
        if (e.code === 'KeyO' || e.key === 'o' || e.key === 'O') this.triggerTackle(2);
        if (e.code === 'KeyB' || e.key === 'b' || e.key === 'B') this.triggerTackle(3);
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.key] = false;
      this.keys[e.code] = false;
    });
  }

  cycleSlotType(index) {
    if (this.slotTypes[index] === 'empty') {
      this.slotTypes[index] = 'human';
    } else if (this.slotTypes[index] === 'human') {
      this.slotTypes[index] = 'bot_normal';
    } else if (this.slotTypes[index] === 'bot_normal') {
      this.slotTypes[index] = 'bot_god';
    } else {
      this.slotTypes[index] = 'empty';
    }
    playJoin();
  }

  isSlotJoined(index) {
    return this.slotTypes[index] !== 'empty';
  }

  resize(width, height) {
    const marginX = Math.max(12, Math.floor(width * 0.04));
    const marginY = height > width
      ? Math.max(48, Math.floor(height * 0.12))
      : Math.max(32, Math.floor(height * 0.06));
    const arenaW = width - marginX * 2;
    const arenaH = height - marginY * 2;
    const size = Math.min(arenaW, arenaH);

    this.arena = {
      cx: width / 2,
      cy: height / 2,
      width: arenaW,
      height: arenaH,
      size: size,
      left: marginX,
      right: width - marginX,
      top: marginY,
      bottom: height - marginY,
    };

    const { left, right, top, bottom, cx, cy } = this.arena;

    // 4 Corner Vault Zones
    const vW = Math.round(size * 0.18);
    const vH = Math.round(size * 0.18);
    this.vaults = [
      { x: left + 6, y: bottom - vH - 6, w: vW, h: vH, playerIndex: 0 }, // P1: Bottom-Left
      { x: left + 6, y: top + 6, w: vW, h: vH, playerIndex: 1 },        // P2: Top-Left
      { x: right - vW - 6, y: top + 6, w: vW, h: vH, playerIndex: 2 },  // P3: Top-Right
      { x: right - vW - 6, y: bottom - vH - 6, w: vW, h: vH, playerIndex: 3 }, // P4: Bottom-Right
    ];

    // 4 Symmetrical Obstacle Pillars (for cover and strategic ambush)
    const pSize = Math.round(size * 0.11);
    const offset = Math.round(size * 0.22);
    this.pillars = [
      { x: cx - offset - pSize / 2, y: cy - offset - pSize / 2, w: pSize, h: pSize },
      { x: cx + offset - pSize / 2, y: cy - offset - pSize / 2, w: pSize, h: pSize },
      { x: cx - offset - pSize / 2, y: cy + offset - pSize / 2, w: pSize, h: pSize },
      { x: cx + offset - pSize / 2, y: cy + offset - pSize / 2, w: pSize, h: pSize },
    ];

    this.initPlayers();
  }

  initPlayers() {
    const { cx, cy, size } = this.arena;
    const spawnDist = Math.round(size * 0.35);
    const r = Math.max(14, Math.round(size * 0.038));

    const spawns = [
      { x: cx - spawnDist * 0.707, y: cy + spawnDist * 0.707, angle: -Math.PI * 0.25 }, // P1: Bottom-Left
      { x: cx - spawnDist * 0.707, y: cy - spawnDist * 0.707, angle: Math.PI * 0.25 },  // P2: Top-Left
      { x: cx + spawnDist * 0.707, y: cy - spawnDist * 0.707, angle: Math.PI * 0.75 },  // P3: Top-Right
      { x: cx + spawnDist * 0.707, y: cy + spawnDist * 0.707, angle: -Math.PI * 0.75 }, // P4: Bottom-Right
    ];

    this.players = spawns.map((s, i) => {
      return {
        index: i,
        name: HEIST_NAMES[i],
        color: HEIST_COLORS[i],
        x: s.x,
        y: s.y,
        vx: 0,
        vy: 0,
        radius: r,
        facingAngle: 0,
        baseSpeed: 190,
        isAlive: true,
        isJoined: this.isSlotJoined(i),
        slotType: this.slotTypes[i],
        // Banked score in safe vault & carried loot in hands
        vaultGold: 0,
        carriedGold: 0,
        carriedItems: 0,
        carriedWeight: 0,
        // Combat & Tackle
        tackleCooldown: 0,
        tackleTimer: 0,
        isTackling: false,
        stumbleTimer: 0,
        raidTimer: 0, // Timer standing on enemy vault
        raidTarget: -1,
        // Anti-Stuck & Navigation
        lastX: s.x,
        lastY: s.y,
        stuckAccumulator: 0,
        unstuckDuration: 0,
        unstuckAngle: 0,
        aiMoveX: 0,
        aiMoveY: 0,
        aiForce: 0,
        aiState: 'COLLECT', // 'COLLECT', 'BANK', 'AMBUSH', 'RAID'
      };
    });
  }

  resetCurrentGame() {
    this.state = 'LOBBY';
    this.scores = [0, 0, 0, 0];
    this.roundWinner = null;
    this.matchWinner = null;
    this.roundTimer = 45.0;
    this.goldRushActive = false;
    this.lootItems = [];
    this.particles = [];
    this.floatingTexts = [];
    this.trauma = 0;
    this.lastTime = performance.now();
    for (let i = 0; i < 4; i++) {
      if (this.joysticks[i]) {
        this.joysticks[i].active = false;
        this.joysticks[i].id = null;
        this.joysticks[i].force = 0;
      }
    }
    this.initPlayers();
  }

  resetMatch() {
    this.resetCurrentGame();
  }

  reset() {
    this.resetCurrentGame();
  }

  startNewMatch() {
    this.scores = [0, 0, 0, 0];
    this.matchWinner = null;
    this.startNewRound();
  }

  startNewRound() {
    const joined = this.players.filter((p) => p.isJoined);
    if (joined.length < 2) {
      this.state = 'LOBBY';
      return;
    }

    this.state = 'PLAYING';
    this.roundTimer = 45.0;
    this.goldRushActive = false;
    this.roundWinner = null;
    this.roundTransitionTimer = 0;
    this.lootItems = [];
    this.particles = [];
    this.floatingTexts = [];

    // Respawn players & reset vaults for new round
    this.initPlayers();
    for (const p of this.players) {
      p.vaultGold = 0;
      p.carriedGold = 0;
      p.carriedItems = 0;
      p.carriedWeight = 0;
    }

    this.piggyBank = null;
    this.piggySpawned30 = false;
    this.piggySpawned15 = false;

    // Spawn initial wave of central gold
    for (let i = 0; i < 8; i++) {
      this.spawnLootItem('COIN');
    }
    this.spawnLootItem('DIAMOND');

    playStart();
  }

  spawnPiggyBank() {
    const angle = Math.random() * Math.PI * 2;
    const speed = 120;
    this.piggyBank = {
      x: this.arena.cx,
      y: this.arena.cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: 24,
      hp: 3,
      maxHp: 3,
      hitTimer: 0,
      animTime: 0,
    };
    playVaultAlarm();
    this.trauma = 0.4;
    this.addFloatingText(this.arena.cx, this.arena.cy - 40, '🐷 ALTIN KUMBARA GELDİ! OMUZ AT & KIR!', '#FFDE59');
  }

  spawnLootItem(type = 'COIN', customX = null, customY = null) {
    const { cx, cy, size } = this.arena;
    const spawnRadius = size * 0.18;

    let px = customX;
    let py = customY;

    if (px === null || py === null) {
      const angle = Math.random() * Math.PI * 2;
      const d = Math.random() * spawnRadius;
      px = cx + Math.cos(angle) * d;
      py = cy + Math.sin(angle) * d;
    }

    const value = type === 'CROWN' ? 5 : type === 'DIAMOND' ? 3 : 1;
    const weight = type === 'CROWN' ? 3 : type === 'DIAMOND' ? 2 : 1;
    const radius = type === 'CROWN' ? 14 : type === 'DIAMOND' ? 12 : 9;

    this.lootItems.push({
      x: px,
      y: py,
      vx: (Math.random() - 0.5) * 80,
      vy: (Math.random() - 0.5) * 80,
      type: type,
      value: value,
      weight: weight,
      radius: radius,
      bounce: 0.6,
      animTime: Math.random() * 10,
    });
  }

  triggerTackle(playerIndex) {
    const p = this.players[playerIndex];
    if (!p || !p.isAlive || p.tackleCooldown > 0 || p.stumbleTimer > 0) return;

    p.tackleCooldown = 3.5;
    p.tackleTimer = 0.22;
    p.isTackling = true;
    this.trauma = Math.min(1.0, this.trauma + 0.18);

    playDashWhoosh();

    // Spawn dust burst
    const behindAngle = p.facingAngle + Math.PI;
    for (let i = 0; i < 10; i++) {
      this.particles.push({
        x: p.x + Math.cos(behindAngle) * p.radius,
        y: p.y + Math.sin(behindAngle) * p.radius,
        vx: Math.cos(behindAngle + (Math.random() - 0.5) * 0.8) * 80,
        vy: Math.sin(behindAngle + (Math.random() - 0.5) * 0.8) * 80,
        life: 0.28,
        maxLife: 0.4,
        color: '#D5D0C7',
        size: 4 + Math.random() * 3,
      });
    }
  }

  addFloatingText(x, y, text, color = '#FFDE59') {
    this.floatingTexts.push({
      x,
      y,
      text,
      color,
      life: 0.8,
      maxLife: 0.8,
    });
  }

  getCornerQuadrant(point) {
    const { cx, cy } = this.arena;

    if (point.x < cx && point.y >= cy) return 0; // P1
    if (point.x < cx && point.y < cy) return 1;  // P2
    if (point.x >= cx && point.y < cy) return 2; // P3
    return 3; // P4
  }

  onTouchStart(touch) {
    // 1. UI Buttons tap handling
    for (const btn of this.uiButtons) {
      if (
        touch.x >= btn.x &&
        touch.x <= btn.x + btn.w &&
        touch.y >= btn.y &&
        touch.y <= btn.y + btn.h
      ) {
        btn.onClick();
        return;
      }
    }

    // 1.5. Generous Lobby Join fallback (tap anywhere in quadrant)
    if (this.state === 'LOBBY') {
      const q = this.getCornerQuadrant(touch);
      this.cycleSlotType(q);
      return;
    }

    // 2. Tackle button tap handling
    if (this.state === 'PLAYING') {
      for (const tBtn of this.tackleButtons) {
        if (
          touch.x >= tBtn.x - tBtn.w / 2 - 12 &&
          touch.x <= tBtn.x + tBtn.w / 2 + 12 &&
          touch.y >= tBtn.y - tBtn.h / 2 - 12 &&
          touch.y <= tBtn.y + tBtn.h / 2 + 12
        ) {
          this.triggerTackle(tBtn.playerIndex);
          return;
        }
      }
    }

    // 3. Multi-Touch 360° Joystick & Double-Tap Tackle
    if (this.state === 'PLAYING') {
      const q = this.getCornerQuadrant(touch);
      const joy = this.joysticks[q];
      const p = this.players[q];

      if (p && p.isJoined && p.slotType === 'human' && !joy.active) {
        const now = performance.now();
        if (p.lastTapTime && now - p.lastTapTime < 280) {
          this.triggerTackle(q);
        }
        p.lastTapTime = now;

        joy.id = touch.id;
        joy.originX = touch.x;
        joy.originY = touch.y;
        joy.currX = touch.x;
        joy.currY = touch.y;
        joy.active = true;
        joy.angle = 0;
        joy.force = 0;
      }
    }
  }

  onTouchMove(touch) {
    if (this.state !== 'PLAYING') return;

    for (let q = 0; q < 4; q++) {
      const joy = this.joysticks[q];
      if (joy.active && joy.id === touch.id) {
        const dx = touch.x - joy.originX;
        const dy = touch.y - joy.originY;
        const dist = Math.hypot(dx, dy);
        const maxRadius = 48;

        joy.angle = Math.atan2(dy, dx);
        joy.force = Math.min(1.0, dist / maxRadius);

        // Clamp visual joystick knob so it never drifts across boundaries
        if (dist > maxRadius) {
          joy.currX = joy.originX + Math.cos(joy.angle) * maxRadius;
          joy.currY = joy.originY + Math.sin(joy.angle) * maxRadius;
        } else {
          joy.currX = touch.x;
          joy.currY = touch.y;
        }
        break;
      }
    }
  }

  onTouchEnd(touch) {
    for (let q = 0; q < 4; q++) {
      const joy = this.joysticks[q];
      if (joy.active && joy.id === touch.id) {
        joy.active = false;
        joy.id = -1;
        joy.force = 0;
      }
    }
  }

  onTouchesReset() {
    for (const joy of this.joysticks) {
      joy.active = false;
      joy.id = -1;
      joy.force = 0;
    }
  }

  // --- BOT AI BEHAVIORS ---

  updateBotAI(bot, dt) {
    const isGod = bot.slotType === 'bot_god';
    const myVault = this.vaults[bot.index];
    const { left, right, top, bottom, cx, cy } = this.arena;

    let targetX = cx;
    let targetY = cy;

    // Decision Logic: Should I bank my gold or collect more or tackle an enemy?
    const carriedVal = bot.carriedGold;
    const shouldBank = carriedVal >= (isGod ? 4 : 3) || this.roundTimer < 6.0;

    if (shouldBank && myVault) {
      // Navigate to personal vault center
      targetX = myVault.x + myVault.w / 2;
      targetY = myVault.y + myVault.h / 2;
    } else {
      // Find loaded enemies to tackle
      let loadedEnemy = null;
      let maxEnemyLoot = 0;

      for (const other of this.players) {
        if (other.index !== bot.index && other.isJoined && other.carriedGold >= 2) {
          const d = Math.hypot(other.x - bot.x, other.y - bot.y);
          if (other.carriedGold > maxEnemyLoot && d < (isGod ? 240 : 160)) {
            maxEnemyLoot = other.carriedGold;
            loadedEnemy = other;
          }
        }
      }

      if (loadedEnemy && bot.carriedGold <= 2) {
        // Intercept loaded enemy to tackle them!
        targetX = loadedEnemy.x;
        targetY = loadedEnemy.y;
        if (isGod) {
          targetX += loadedEnemy.vx * 0.35;
          targetY += loadedEnemy.vy * 0.35;
        }

        const dEnemy = Math.hypot(targetX - bot.x, targetY - bot.y);
        if (dEnemy < (isGod ? 120 : 90) && bot.tackleCooldown <= 0) {
          this.triggerTackle(bot.index);
        }
      } else {
        // Collect nearest loose loot
        let nearestLoot = null;
        let minDist = Infinity;

        for (const item of this.lootItems) {
          const d = Math.hypot(item.x - bot.x, item.y - bot.y);
          // God bot prioritizes higher value items
          const scoreWeight = isGod ? d / item.value : d;
          if (scoreWeight < minDist) {
            minDist = scoreWeight;
            nearestLoot = item;
          }
        }

        if (nearestLoot) {
          targetX = nearestLoot.x;
          targetY = nearestLoot.y;
        } else if (myVault && bot.carriedGold > 0) {
          targetX = myVault.x + myVault.w / 2;
          targetY = myVault.y + myVault.h / 2;
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

    // Repel from pillars
    for (const pil of this.pillars) {
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

  // --- COLLISION RESOLUTION ---

  resolveCollisions(player) {
    const { left, right, top, bottom } = this.arena;
    const r = player.radius;

    if (player.x - r < left) {
      player.x = left + r;
      player.vx = 0;
    }
    if (player.x + r > right) {
      player.x = right - r;
      player.vx = 0;
    }
    if (player.y - r < top) {
      player.y = top + r;
      player.vy = 0;
    }
    if (player.y + r > bottom) {
      player.y = bottom - r;
      player.vy = 0;
    }

    // Pillars collision
    for (const pil of this.pillars) {
      const closestX = Math.max(pil.x, Math.min(player.x, pil.x + pil.w));
      const closestY = Math.max(pil.y, Math.min(player.y, pil.y + pil.h));

      const dx = player.x - closestX;
      const dy = player.y - closestY;
      const distSq = dx * dx + dy * dy;

      if (distSq < r * r) {
        const dist = Math.sqrt(distSq);
        if (dist > 0.001) {
          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = r - dist;
          player.x += nx * overlap;
          player.y += ny * overlap;

          const dot = player.vx * nx + player.vy * ny;
          if (dot < 0) {
            player.vx -= dot * nx;
            player.vy -= dot * ny;
          }
        } else {
          player.x += r;
        }
      }
    }
  }

  handleRemoteInput(slotIndex, data) {
    const joy = this.joysticks[slotIndex];
    if (!joy) return;

    if (data.action === 'JOYSTICK_MOVE') {
      joy.active = data.force > 0.05;
      joy.angle = data.angle || 0;
      joy.force = data.force || 0;
    } else if (data.action === 'TACKLE') {
      this.triggerTackle(slotIndex);
    }
  }

  update(now) {
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 2.2);
    }

    // Round Over countdown
    if (this.state === 'ROUND_OVER') {
      this.roundTransitionTimer -= dt;
      if (this.roundTransitionTimer <= 0) {
        this.startNewRound();
      }
      return;
    }

    if (this.state !== 'PLAYING') return;

    // Decrement Round Timer
    this.roundTimer -= dt;
    if (this.roundTimer <= 10.0 && !this.goldRushActive) {
      this.goldRushActive = true;
      this.trauma = 0.5;
      this.addFloatingText(this.arena.cx, this.arena.cy - 30, '⚡ ÇILGIN MADEN // GOLD RUSH!', '#FFDE59');
      playVaultAlarm();
      // Drop royal loot
      for (let i = 0; i < 4; i++) this.spawnLootItem('DIAMOND');
      this.spawnLootItem('CROWN');
    }

    if (this.roundTimer <= 0) {
      // Round Complete: Determine winner with most Vault Gold
      let highestGold = -1;
      let winner = null;

      for (const p of this.players) {
        if (!p.isJoined) continue;
        if (p.vaultGold > highestGold) {
          highestGold = p.vaultGold;
          winner = p;
        }
      }

      if (winner) {
        this.roundWinner = winner;
        this.scores[winner.index]++;
        if (this.scores[winner.index] >= this.targetScore) {
          this.state = 'GAME_OVER';
          this.matchWinner = winner;
          return;
        }
      } else {
        this.roundWinner = null;
      }
      this.state = 'ROUND_OVER';
      this.roundTransitionTimer = 2.8;
      return;
    }

    // Spawning central loot
    this.lootSpawnTimer -= dt;
    if (this.lootSpawnTimer <= 0 && this.lootItems.length < 18) {
      const type = Math.random() < 0.2 ? 'DIAMOND' : 'COIN';
      this.spawnLootItem(type);
      this.lootSpawnTimer = this.goldRushActive ? 0.7 : 1.6 + Math.random() * 0.8;
    }

    // Floating text update
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y -= dt * 25;
      ft.life -= dt;
      if (ft.life <= 0) this.floatingTexts.splice(i, 1);
    }

    // Loot physics update
    for (const item of this.lootItems) {
      item.x += item.vx * dt;
      item.y += item.vy * dt;
      item.vx *= 0.94;
      item.vy *= 0.94;
      item.animTime += dt;
    }

    // Update Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const part = this.particles[i];
      part.x += part.vx * dt;
      part.y += part.vy * dt;
      part.life -= dt;
      if (part.life <= 0) this.particles.splice(i, 1);
    }

    // Update Players
    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      if (player.tackleCooldown > 0) player.tackleCooldown -= dt;
      if (player.tackleTimer > 0) {
        player.tackleTimer -= dt;
        if (player.tackleTimer <= 0) player.isTackling = false;
      }
      if (player.stumbleTimer > 0) player.stumbleTimer -= dt;

      // Determine Movement Input
      let inputX = 0;
      let inputY = 0;

      if (player.slotType === 'human') {
        const joy = this.joysticks[player.index];
        if (joy.active && joy.force > 0.05) {
          inputX = Math.cos(joy.angle) * joy.force;
          inputY = Math.sin(joy.angle) * joy.force;
        }

        // Keyboard Fallback
        if (player.index === 0) {
          if (this.keys['KeyA'] || this.keys['a']) inputX -= 1;
          if (this.keys['KeyD'] || this.keys['d']) inputX += 1;
          if (this.keys['KeyW'] || this.keys['w']) inputY -= 1;
          if (this.keys['KeyS'] || this.keys['s']) inputY += 1;
        } else if (player.index === 1) {
          if (this.keys['ArrowLeft']) inputX -= 1;
          if (this.keys['ArrowRight']) inputX += 1;
          if (this.keys['ArrowUp']) inputY -= 1;
          if (this.keys['ArrowDown']) inputY += 1;
        } else if (player.index === 2) {
          if (this.keys['KeyJ'] || this.keys['j']) inputX -= 1;
          if (this.keys['KeyL'] || this.keys['l']) inputX += 1;
          if (this.keys['KeyI'] || this.keys['i']) inputY -= 1;
          if (this.keys['KeyK'] || this.keys['k']) inputY += 1;
        } else if (player.index === 3) {
          if (this.keys['KeyF'] || this.keys['f']) inputX -= 1;
          if (this.keys['KeyH'] || this.keys['h']) inputX += 1;
          if (this.keys['KeyT'] || this.keys['t']) inputY -= 1;
          if (this.keys['KeyG'] || this.keys['g']) inputY += 1;
        }
      } else {
        this.updateBotAI(player, dt);
        inputX = player.aiMoveX || 0;
        inputY = player.aiMoveY || 0;
      }

      // --- GREED WEIGHT CURVE: speed scales down with carried loot ---
      let currentSpeed = Math.max(108, player.baseSpeed - player.carriedWeight * 13);
      if (player.tackleTimer > 0) {
        currentSpeed = 340; // Tackle surge speed!
      }
      if (player.stumbleTimer > 0) {
        currentSpeed *= 0.18; // Stun stumble!
      }

      const inputLen = Math.hypot(inputX, inputY);
      if (inputLen > 0.05) {
        const normX = inputX / inputLen;
        const normY = inputY / inputLen;
        player.vx = normX * currentSpeed;
        player.vy = normY * currentSpeed;
        player.facingAngle = Math.atan2(normY, normX);

        if (player.tackleTimer > 0 && Math.random() < 0.4) {
          this.particles.push({
            x: player.x,
            y: player.y,
            vx: (Math.random() - 0.5) * 40,
            vy: (Math.random() - 0.5) * 40,
            life: 0.2,
            maxLife: 0.2,
            color: '#FFDE59',
            size: 4,
          });
        }
      } else {
        player.vx *= 0.7;
        player.vy *= 0.7;
      }

      player.x += player.vx * dt;
      player.y += player.vy * dt;

      // Arena Bounds & Obstacle Collisions
      this.resolveCollisions(player);

      // --- Interactions ---
      // 1. Central Loot Pickup
      for (let l = this.lootItems.length - 1; l >= 0; l--) {
        const item = this.lootItems[l];
        const dist = Math.hypot(player.x - item.x, player.y - item.y);
        if (dist < player.radius + item.radius) {
          player.carriedGold += item.value;
          player.carriedItems += 1;
          player.carriedWeight += item.weight;

          playCoinPickup();
          this.addFloatingText(item.x, item.y - 12, `+${item.value}`, item.type === 'DIAMOND' ? '#48CAE4' : '#FFDE59');
          this.lootItems.splice(l, 1);
        }
      }

      // --- 2. Banking in Own Corner Vault ---
      const myVault = this.vaults[player.index];
      if (
        myVault &&
        player.x >= myVault.x &&
        player.x <= myVault.x + myVault.w &&
        player.y >= myVault.y &&
        player.y <= myVault.y + myVault.h
      ) {
        if (player.carriedGold > 0) {
          const banked = player.carriedGold;
          player.vaultGold += banked;
          player.carriedGold = 0;
          player.carriedItems = 0;
          player.carriedWeight = 0;

          playCashRegister();
          this.trauma = 0.25;
          this.addFloatingText(myVault.x + myVault.w / 2, myVault.y + myVault.h / 2, `+${banked} 💰 KASALANDI!`, '#FFFFFF');

          // Golden sparkle burst inside vault
          for (let s = 0; s < 18; s++) {
            this.particles.push({
              x: player.x,
              y: player.y,
              vx: (Math.random() - 0.5) * 140,
              vy: (Math.random() - 0.5) * 140,
              life: 0.45,
              maxLife: 0.45,
              color: '#FFDE59',
              size: 4 + Math.random() * 3,
            });
          }
        }
      }

      // --- 3. Vault Raiding (Stealing directly from opponent's vault) ---
      let onEnemyVault = false;
      for (const v of this.vaults) {
        if (v.playerIndex !== player.index) {
          if (
            player.x >= v.x &&
            player.x <= v.x + v.w &&
            player.y >= v.y &&
            player.y <= v.y + v.h
          ) {
            onEnemyVault = true;
            const enemy = this.players[v.playerIndex];
            if (enemy && enemy.vaultGold > 0) {
              player.raidTarget = v.playerIndex;
              player.raidTimer += dt;
              if (player.raidTimer >= 1.0) {
                // Heist Success! Steal 2 gold from enemy vault
                const stolen = Math.min(2, enemy.vaultGold);
                enemy.vaultGold -= stolen;
                player.carriedGold += stolen;
                player.carriedItems += stolen;
                player.carriedWeight += stolen;
                player.raidTimer = 0;

                playVaultAlarm();
                this.trauma = 0.4;
                this.addFloatingText(player.x, player.y - 20, `🚨 ${stolen} ÇALINDI!`, '#D84727');
              }
            }
            break;
          }
        }
      }
      if (!onEnemyVault) {
        player.raidTimer = 0;
        player.raidTarget = -1;
      }
    }

    // --- 4. Shoulder Tackle Collision & Direct Loot Vampirism! ---
    for (let i = 0; i < this.players.length; i++) {
      const p1 = this.players[i];
      if (!p1.isJoined || !p1.isAlive) continue;

      for (let j = i + 1; j < this.players.length; j++) {
        const p2 = this.players[j];
        if (!p2.isJoined || !p2.isAlive) continue;

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.hypot(dx, dy);
        const minDist = p1.radius + p2.radius;

        if (dist < minDist) {
          // Elastic nudge
          const overlap = minDist - dist;
          if (dist > 0.001) {
            const nx = dx / dist;
            const ny = dy / dist;
            p1.x -= nx * overlap * 0.5;
            p1.y -= ny * overlap * 0.5;
            p2.x += nx * overlap * 0.5;
            p2.y += ny * overlap * 0.5;
          }

          // Check if p1 tackled p2 (or vice versa)
          if (p1.isTackling && p2.stumbleTimer <= 0.15) {
            this.executeLootKnockout(p1, p2);
          } else if (p2.isTackling && p1.stumbleTimer <= 0.15) {
            this.executeLootKnockout(p2, p1);
          }
        }
      }
    }
  }

  executeLootKnockout(attacker, victim) {
    playHeavyImpact();
    this.trauma = 0.65;
    victim.stumbleTimer = 0.6;
    attacker.isTackling = false; // hit landed

    // Violent knockback momentum
    const dx = victim.x - attacker.x;
    const dy = victim.y - attacker.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;

    victim.vx = nx * 520;
    victim.vy = ny * 520;

    // 1. Home Vault Defense Check (Is burglar caught in attacker's vault?)
    const attackerVault = this.vaults[attacker.index];
    const isInsideMyVault = attackerVault && (
      victim.x >= attackerVault.x && victim.x <= attackerVault.x + attackerVault.w &&
      victim.y >= attackerVault.y && victim.y <= attackerVault.y + attackerVault.h
    );

    if (isInsideMyVault) {
      playCashRegister();
      playVaultAlarm();
      attacker.vaultGold += 3;
      this.addFloatingText(attacker.x, attacker.y - 30, '🛡️ KASA SAVUNMASI! (+3 BONUS)', '#FFDE59');
    }

    // 2. Direct Vampiric Theft (Loot Siphon)
    if (victim.carriedGold > 0) {
      // Attacker DIRECTLY steals up to 2 coins straight into their bag!
      const stolen = Math.min(2, victim.carriedGold);
      victim.carriedGold -= stolen;
      victim.carriedWeight = Math.max(0, victim.carriedWeight - stolen);

      attacker.carriedGold += stolen;
      attacker.carriedWeight += stolen;

      playCoinPickup();
      this.addFloatingText(attacker.x, attacker.y - 25, `+${stolen} 🪙 ÇALINDI!`, '#FFDE59');
      this.addFloatingText(victim.x, victim.y - 25, `-${stolen} 🪙 SOYULDUN!`, '#D84727');

      // Golden particle beam siphon from victim to attacker
      for (let s = 0; s < 12; s++) {
        this.particles.push({
          x: victim.x,
          y: victim.y,
          vx: -nx * 190 + (Math.random() - 0.5) * 80,
          vy: -ny * 190 + (Math.random() - 0.5) * 80,
          life: 0.45,
          maxLife: 0.45,
          color: '#FFDE59',
          size: 5,
        });
      }

      // Drop the remaining carried loot onto the ground (chaos scramble!)
      const dropRest = victim.carriedGold;
      if (dropRest > 0) {
        victim.carriedGold = 0;
        victim.carriedWeight = 0;
        victim.carriedItems = 0;

        for (let c = 0; c < dropRest; c++) {
          const angle = Math.random() * Math.PI * 2;
          const spd = 80 + Math.random() * 150;
          this.lootItems.push({
            x: victim.x,
            y: victim.y,
            vx: Math.cos(angle) * spd,
            vy: Math.sin(angle) * spd,
            type: 'COIN',
            value: 1,
            weight: 1,
            radius: 9,
            animTime: 0,
          });
        }
        this.addFloatingText(victim.x, victim.y - 45, `💥 ${dropRest} YERE SAÇILDI!`, '#D84727');
      }
    } else if (victim.vaultGold > 0) {
      // Victim has no loose coins, but has banked gold in vault: KNOCK 1 COIN OUT OF VAULT!
      victim.vaultGold -= 1;
      const angle = Math.random() * Math.PI * 2;
      this.lootItems.push({
        x: victim.x,
        y: victim.y,
        vx: Math.cos(angle) * 120,
        vy: Math.sin(angle) * 120,
        type: 'COIN',
        value: 1,
        weight: 1,
        radius: 9,
        animTime: 0,
      });
      playStumble();
      this.addFloatingText(victim.x, victim.y - 25, '💥 KASADAN DÜŞTÜ! (-1 🪙)', '#D84727');
    } else {
      // Victim is completely empty, still get satisfying slam!
      this.addFloatingText(victim.x, victim.y - 25, '💥 GÜÜÜM!', '#FFFFFF');
    }

    // Comic book impact sparks
    for (let p = 0; p < 16; p++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 60 + Math.random() * 160;
      this.particles.push({
        x: (attacker.x + victim.x) / 2,
        y: (attacker.y + victim.y) / 2,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: 0.35,
        maxLife: 0.35,
        color: Math.random() > 0.5 ? '#FFFFFF' : '#FFDE59',
        size: 4 + Math.random() * 3,
      });
    }
  }

  // --- RENDERING PIPELINE ---

  render() {
    const { ctx, canvas } = this;
    ctx.save();

    // Background paper
    ctx.fillStyle = '#F4F0EA';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (this.trauma > 0) {
      const shakeIntensity = this.trauma * this.trauma * 14;
      const offsetX = (Math.random() - 0.5) * 2 * shakeIntensity;
      const offsetY = (Math.random() - 0.5) * 2 * shakeIntensity;
      ctx.translate(offsetX, offsetY);
    }

    this.renderArena(ctx);
    if (this.state !== 'LOBBY') {
      this.renderVaults(ctx);
      this.renderLoot(ctx);
      this.renderPlayers(ctx);
    }
    this.renderParticles(ctx);
    this.renderFloatingTexts(ctx);
    this.renderVirtualJoysticks(ctx);
    this.renderTackleButtons(ctx);

    // Gold Rush border vignette
    if (this.state === 'PLAYING' && this.goldRushActive) {
      const pulseAlpha = 0.18 + Math.sin(performance.now() * 0.012) * 0.1;
      ctx.fillStyle = `rgba(217, 155, 38, ${pulseAlpha})`;
      const edge = 16;
      ctx.fillRect(0, 0, canvas.width, edge);
      ctx.fillRect(0, canvas.height - edge, canvas.width, edge);
      ctx.fillRect(0, 0, edge, canvas.height);
      ctx.fillRect(canvas.width - edge, 0, edge, canvas.height);
    }

    // UI Overlays
    this.uiButtons = [];
    if (this.state === 'LOBBY') {
      renderControlGuide(ctx, this.arena, 'KONTROL // JOYSTICK SÜRÜKLE • ÇİFT DOKUN: OMUZ DARBESİ', [
        'KIRMIZI P1',
        'MAVİ P2',
        'SARI P3',
        'YEŞİL P4',
      ]);
      this.renderLobbyUI(ctx);
    } else if (this.state === 'ROUND_OVER') {
      this.renderRoundOverUI(ctx);
    } else if (this.state === 'GAME_OVER') {
      this.renderGameOverUI(ctx);
    }

    ctx.restore();
  }

  renderArena(ctx) {
    const { left, top, right, bottom, width, height, size, cx, cy } = this.arena;

    // Arena Floor
    ctx.fillStyle = '#FAF7F2';
    ctx.fillRect(left, top, width, height);

    // Central Treasure Pit circle
    ctx.strokeStyle = '#D99B26';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#1C1C1A';
    ctx.font = '800 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚡ HAZİNE ÇUKURU ⚡', cx, cy - size * 0.22 - 10);

    // Outer Border & Cast Iron Drop Shadow
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(right, top + 6, 6, height);
    ctx.fillRect(left + 6, bottom, width, 6);

    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 4;
    ctx.strokeRect(left, top, width, height);

    // Obstacle Pillars
    for (const pil of this.pillars) {
      ctx.fillStyle = '#1A1A1A';
      ctx.fillRect(pil.x + 4, pil.y + 4, pil.w, pil.h);

      ctx.fillStyle = '#2B2B28';
      ctx.fillRect(pil.x, pil.y, pil.w, pil.h);

      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(pil.x, pil.y, pil.w, pil.h);
    }

    // Live Vault Scoreboard Strip at Top
    if (this.state === 'PLAYING' || this.state === 'ROUND_OVER') {
      const joined = this.players.filter((p) => p.isJoined);
      if (joined.length > 0) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const stripW = Math.min(size * 0.94, 440);
        const stripH = 32;
        const stripX = cx - stripW / 2;
        const stripY = top + 12;

        ctx.fillStyle = '#E5E1D8';
        ctx.fillRect(stripX, stripY, stripW, stripH);
        ctx.strokeStyle = '#1C1C1A';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(stripX, stripY, stripW, stripH);

        const scoreSummary = joined
          .map((p) => `${p.name}: ${p.vaultGold}💰`)
          .join('  |  ');

        const timerText = `${Math.max(0, Math.ceil(this.roundTimer))}s`;

        ctx.font = '900 13px "JetBrains Mono", monospace';
        ctx.fillStyle = '#1C1C1A';
        ctx.fillText(`KASALAR // ${scoreSummary} // ⏱️ ${timerText}`, cx, stripY + stripH / 2);
        ctx.restore();
      }
    }
  }

  renderVaults(ctx) {
    for (const v of this.vaults) {
      const p = this.players[v.playerIndex];
      if (!p.isJoined) continue;

      const isTop = v.playerIndex === 1 || v.playerIndex === 2;

      ctx.save();
      // Vault Floor
      ctx.fillStyle = 'rgba(217, 155, 38, 0.12)';
      ctx.fillRect(v.x, v.y, v.w, v.h);

      ctx.strokeStyle = p.color;
      ctx.lineWidth = 3;
      ctx.strokeRect(v.x, v.y, v.w, v.h);

      // Inner vault content with 180° rotation for Top players
      ctx.save();
      ctx.translate(v.x + v.w / 2, v.y + v.h / 2);
      if (isTop) {
        ctx.rotate(Math.PI);
      }

      // Vault Badge
      const badgeW = v.w - 8;
      const badgeH = 20;
      ctx.fillStyle = '#1C1C1A';
      ctx.fillRect(-badgeW / 2, -v.h / 2 + 4, badgeW, badgeH);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '900 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${p.name} KASASI`, 0, -v.h / 2 + 14);

      // Safe Gold Count in Vault
      ctx.fillStyle = '#D99B26';
      ctx.font = '900 22px "Space Grotesk", sans-serif';
      ctx.fillText(`${p.vaultGold}💰`, 0, 8);

      ctx.restore();
      ctx.restore();
    }
  }

  renderLoot(ctx) {
    for (const item of this.lootItems) {
      ctx.save();
      ctx.translate(item.x, item.y);

      // Shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
      ctx.beginPath();
      ctx.arc(2, 2, item.radius, 0, Math.PI * 2);
      ctx.fill();

      if (item.type === 'COIN') {
        // Gold Coin
        ctx.fillStyle = '#FFDE59';
        ctx.beginPath();
        ctx.arc(0, 0, item.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#1C1C1A';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = '#1C1C1A';
        ctx.font = '900 10px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('1', 0, 0);
      } else if (item.type === 'DIAMOND') {
        // Royal Diamond
        ctx.fillStyle = '#48CAE4';
        ctx.beginPath();
        ctx.moveTo(0, -item.radius);
        ctx.lineTo(item.radius, 0);
        ctx.lineTo(0, item.radius);
        ctx.lineTo(-item.radius, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#1C1C1A';
        ctx.lineWidth = 2.2;
        ctx.stroke();

        ctx.fillStyle = '#FFFFFF';
        ctx.font = '900 11px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('3', 0, 0);
      } else if (item.type === 'CROWN') {
        // Heavy Gold Bar
        ctx.fillStyle = '#D99B26';
        ctx.fillRect(-12, -8, 24, 16);
        ctx.strokeStyle = '#1C1C1A';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(-12, -8, 24, 16);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = '900 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('5K', 0, 0);
      }

      ctx.restore();
    }
  }

  renderPiggyBank(ctx) {
    if (!this.piggyBank) return;
    const pig = this.piggyBank;

    ctx.save();
    ctx.translate(pig.x, pig.y);

    // Bouncing squash
    const squash = 1 + Math.sin(pig.animTime * 8) * 0.08;
    ctx.scale(squash, 1 / squash);

    // Drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.arc(3, 4, pig.radius, 0, Math.PI * 2);
    ctx.fill();

    // Golden Body
    ctx.fillStyle = '#FFDE59';
    ctx.beginPath();
    ctx.arc(0, 0, pig.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#1C1C1A';
    ctx.stroke();

    // Piggy Snout
    ctx.fillStyle = '#D99B26';
    ctx.beginPath();
    ctx.arc(0, 2, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Coin slot on back
    ctx.fillStyle = '#1C1C1A';
    ctx.fillRect(-6, -14, 12, 3);

    // Ears
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

    // Health Pips above Piggy
    ctx.save();
    const pipW = 10;
    const pipH = 5;
    const startPipX = pig.x - (pig.maxHp * (pipW + 3)) / 2;
    const pipY = pig.y - pig.radius - 12;

    for (let h = 0; h < pig.maxHp; h++) {
      ctx.fillStyle = h < pig.hp ? '#2D6A4F' : '#E63946';
      ctx.fillRect(startPipX + h * (pipW + 3), pipY, pipW, pipH);
      ctx.strokeStyle = '#1C1C1A';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(startPipX + h * (pipW + 3), pipY, pipW, pipH);
    }
    ctx.restore();
  }

  renderPlayers(ctx) {
    // Find richest player on the board
    let maxCarried = 2;
    let richestIndex = -1;
    for (const p of this.players) {
      if (p.isJoined && p.isAlive && p.carriedGold > maxCarried) {
        maxCarried = p.carriedGold;
        richestIndex = p.index;
      }
    }

    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      ctx.save();
      ctx.translate(player.x, player.y);

      // Stumble Shake
      if (player.stumbleTimer > 0) {
        ctx.translate((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
      }

      // Richest Target Beacon
      if (player.index === richestIndex) {
        const pulse = Math.sin(performance.now() * 0.01) * 3;
        ctx.strokeStyle = '#FFDE59';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(0, 0, player.radius + 10 + pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Crown
        ctx.font = '16px "Space Grotesk", sans-serif';
        ctx.fillText('👑', 0, -player.radius - 32);
      }

      // Tackle Burst Aura
      if (player.isTackling) {
        ctx.strokeStyle = '#FFDE59';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, player.radius + 6, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.beginPath();
      ctx.arc(3, 3, player.radius, 0, Math.PI * 2);
      ctx.fill();

      // Body Circle
      ctx.fillStyle = player.color;
      ctx.beginPath();
      ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = player.isTackling ? '#FFDE59' : '#1C1C1A';
      ctx.lineWidth = 3;
      ctx.stroke();

      // 1. Forward Tactical Light Beam (Flashlight Cone)
      ctx.save();
      ctx.rotate(player.facingAngle);

      const coneGrad = ctx.createRadialGradient(0, 0, player.radius, 0, 0, player.radius + 36);
      coneGrad.addColorStop(0, `${player.color}88`);
      coneGrad.addColorStop(1, `${player.color}00`);
      ctx.fillStyle = coneGrad;
      ctx.beginPath();
      ctx.moveTo(player.radius * 0.8, 0);
      ctx.arc(0, 0, player.radius + 36, -0.42, 0.42);
      ctx.closePath();
      ctx.fill();

      // 2. Prominent Sharp Heading Pointer Arrow (extending beyond body)
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#1C1C1A';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(player.radius + 14, 0);
      ctx.lineTo(player.radius + 2, -6);
      ctx.lineTo(player.radius + 5, 0);
      ctx.lineTo(player.radius + 2, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Player Name
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '800 11px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`P${player.index + 1}`, 0, 0);

      // Carried Loot Bag Badge floating above head
      if (player.carriedGold > 0) {
        const bagY = -player.radius - 16;
        const isRichest = player.index === richestIndex;
        ctx.fillStyle = isRichest ? '#FFDE59' : '#1C1C1A';
        ctx.fillRect(-26, bagY - 9, 52, 18);
        ctx.strokeStyle = isRichest ? '#1C1C1A' : '#FFDE59';
        ctx.lineWidth = 2;
        ctx.strokeRect(-26, bagY - 9, 52, 18);

        ctx.fillStyle = isRichest ? '#1C1C1A' : '#FFDE59';
        ctx.font = '900 11px "JetBrains Mono", monospace';
        ctx.fillText(`${player.carriedGold} 💰`, 0, bagY);
      }

      ctx.restore();
    }
  }

  renderParticles(ctx) {
    for (const part of this.particles) {
      ctx.save();
      const alpha = Math.max(0, part.life / part.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = part.color;
      ctx.fillRect(part.x - part.size / 2, part.y - part.size / 2, part.size, part.size);
      ctx.restore();
    }
  }

  renderFloatingTexts(ctx) {
    for (const ft of this.floatingTexts) {
      ctx.save();
      const alpha = Math.max(0, ft.life / ft.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = ft.color;
      ctx.font = '900 13px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }
  }

  renderVirtualJoysticks(ctx) {
    if (this.state !== 'PLAYING') return;

    const { left, right, top, bottom, width, height } = this.arena;
    const anchors = [
      { x: left + width * 0.14, y: bottom - height * 0.14 },
      { x: left + width * 0.14, y: top + height * 0.14 },
      { x: right - width * 0.14, y: top + height * 0.14 },
      { x: right - width * 0.14, y: bottom - height * 0.14 },
    ];

    for (let q = 0; q < 4; q++) {
      const joy = this.joysticks[q];
      const player = this.players[q];
      if (!player.isJoined || player.slotType !== 'human') continue;

      if (!joy.active) {
        ctx.save();
        ctx.translate(anchors[q].x, anchors[q].y);
        if (q === 1 || q === 2) ctx.rotate(Math.PI);
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = player.color;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(0, 0, 36, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = player.color;
        ctx.font = '800 11px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${player.name.slice(0, 3)} SÜRÜKLE`, 0, 0);
        ctx.restore();
        continue;
      }

      ctx.save();

      ctx.strokeStyle = 'rgba(28, 28, 26, 0.4)';
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(joy.originX, joy.originY, 48, 0, Math.PI * 2);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.fillStyle = player.color;
      ctx.beginPath();
      ctx.arc(joy.currX, joy.currY, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1C1C1A';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.restore();
    }
  }

  renderTackleButtons(ctx) {
    if (this.state !== 'PLAYING') return;

    this.tackleButtons = [];
    const { canvas, arena } = this;
    const btnW = 86;
    const btnH = 36;

    const bottomSpace = canvas.height - arena.bottom;
    const topSpace = arena.top;

    const bottomY = bottomSpace >= 42 ? arena.bottom + 26 : arena.bottom - 22;
    const topY = topSpace >= 42 ? arena.top - 26 : arena.top + 22;

    const positions = [
      { x: arena.left + arena.size * 0.35, y: bottomY },
      { x: arena.left + arena.size * 0.35, y: topY },
      { x: arena.right - arena.size * 0.16, y: topY },
      { x: arena.right - arena.size * 0.16, y: bottomY },
    ];

    for (let i = 0; i < 4; i++) {
      const p = this.players[i];
      if (!p.isJoined || !p.isAlive || p.slotType !== 'human') continue;

      const pos = positions[i];
      const isReady = p.tackleCooldown <= 0;
      const isTackling = p.tackleTimer > 0;

      // Check proximity to enemies or piggy bank
      let targetInRange = false;
      if (this.piggyBank && Math.hypot(this.piggyBank.x - p.x, this.piggyBank.y - p.y) < 140) {
        targetInRange = true;
      } else {
        for (const other of this.players) {
          if (other.index !== i && other.isJoined && other.isAlive) {
            if (Math.hypot(other.x - p.x, other.y - p.y) < 140) {
              targetInRange = true;
              break;
            }
          }
        }
      }

      ctx.save();
      ctx.translate(pos.x, pos.y);
      if (i === 1 || i === 2) {
        ctx.rotate(Math.PI);
      }

      ctx.fillStyle = '#1C1C1A';
      ctx.fillRect(-btnW / 2 + 3, -btnH / 2 + 3, btnW, btnH);

      ctx.fillStyle = isTackling ? '#FFFFFF' : isReady && targetInRange ? '#FFDE59' : isReady ? '#EAE6DD' : '#D5D0C7';
      ctx.fillRect(-btnW / 2, -btnH / 2, btnW, btnH);

      ctx.strokeStyle = isTackling || (isReady && targetInRange) ? '#FFDE59' : '#1C1C1A';
      ctx.lineWidth = isTackling || (isReady && targetInRange) ? 3.5 : 2.5;
      ctx.strokeRect(-btnW / 2, -btnH / 2, btnW, btnH);

      ctx.fillStyle = '#1C1C1A';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (isTackling) {
        ctx.font = '900 13px "Space Grotesk", sans-serif';
        ctx.fillText('💥 HÜCUM!', 0, 0);
      } else if (isReady && targetInRange) {
        ctx.font = '900 13px "Space Grotesk", sans-serif';
        ctx.fillText('⚡ OMUZ AT!', 0, 0);
      } else if (isReady) {
        ctx.font = '800 12px "Space Grotesk", sans-serif';
        ctx.fillText('OMUZ AT', 0, 0);
      } else {
        const remaining = Math.max(0.1, p.tackleCooldown);
        ctx.font = '800 11px "JetBrains Mono", monospace';
        ctx.fillText(`${remaining.toFixed(1)}s`, 0, 0);
      }
      ctx.restore();

      this.tackleButtons.push({
        x: pos.x,
        y: pos.y,
        w: btnW,
        h: btnH,
        playerIndex: i,
      });
    }
  }

  renderLobbyUI(ctx) {
    const { arena } = this;

    const corners = [
      { x: arena.left + 24, y: arena.bottom - 60 },
      { x: arena.left + 24, y: arena.top + 24 },
      { x: arena.right - 184, y: arena.top + 24 },
      { x: arena.right - 184, y: arena.bottom - 60 },
    ];

    for (let i = 0; i < 4; i++) {
      const pos = corners[i];
      const slotType = this.slotTypes[i];
      const p = this.players[i];

      let label = '+ KATIL';
      let bgColor = '#E3DFD5';
      let textColor = '#1C1C1A';

      if (slotType === 'human') {
        label = `✓ ${p.name}`;
        bgColor = p.color;
        textColor = '#FFFFFF';
      } else if (slotType === 'bot_normal') {
        label = `🤖 ${p.name} (BOT)`;
        bgColor = '#3A3A38';
        textColor = '#FAF7F2';
      } else if (slotType === 'bot_god') {
        label = `⚡ ${p.name} (GOD)`;
        bgColor = '#1A1A1A';
        textColor = '#FFDE59';
      }

      const btnW = 160;
      const btnH = 46;

      ctx.save();
      ctx.fillStyle = bgColor;
      ctx.fillRect(pos.x, pos.y, btnW, btnH);
      ctx.strokeStyle = slotType === 'bot_god' ? '#FFDE59' : '#1C1C1A';
      ctx.lineWidth = slotType === 'bot_god' ? 4 : 3;
      ctx.strokeRect(pos.x, pos.y, btnW, btnH);

      ctx.fillStyle = textColor;
      ctx.font = '800 13px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, pos.x + btnW / 2, pos.y + btnH / 2);
      ctx.restore();

      this.uiButtons.push({
        x: pos.x,
        y: pos.y,
        w: btnW,
        h: btnH,
        onClick: () => this.cycleSlotType(i),
      });
    }

    // Center Start Button
    const joined = this.players.filter((p) => p.isJoined);
    if (joined.length >= 2) {
      const btnW = Math.min(220, arena.size * 0.5);
      const btnH = 64;
      const btnX = arena.cx - btnW / 2;
      const btnY = arena.cy - btnH / 2;

      ctx.fillStyle = '#1C1C1A';
      ctx.fillRect(btnX + 6, btnY + 6, btnW, btnH);

      ctx.fillStyle = '#D99B26';
      ctx.fillRect(btnX, btnY, btnW, btnH);

      ctx.strokeStyle = '#1C1C1A';
      ctx.lineWidth = 3;
      ctx.strokeRect(btnX, btnY, btnW, btnH);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '800 24px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('BAŞLAT', arena.cx, arena.cy);

      this.uiButtons.push({
        x: btnX,
        y: btnY,
        w: btnW,
        h: btnH,
        onClick: () => this.startNewMatch(),
      });
    } else {
      ctx.fillStyle = '#1C1C1A';
      ctx.font = '700 16px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('EN AZ 2 OYUNCU GEREKLİ', arena.cx, arena.cy - 12);
      ctx.font = '500 13px "Space Grotesk", sans-serif';
      ctx.fillStyle = '#75726B';
      ctx.fillText('Köşelere dokunarak katılın', arena.cx, arena.cy + 14);
    }
  }

  renderRoundOverUI(ctx) {
    if (!this.roundWinner) return;
    const { arena } = this;
    const bW = Math.min(320, arena.size * 0.85);
    const bH = 86;
    const bX = arena.cx - bW / 2;
    const bY = arena.cy - bH / 2;

    ctx.fillStyle = '#1C1C1A';
    ctx.fillRect(bX + 6, bY + 6, bW, bH);
    ctx.fillStyle = '#FAF7F2';
    ctx.fillRect(bX, bY, bW, bH);
    ctx.strokeStyle = '#1C1C1A';
    ctx.lineWidth = 3;
    ctx.strokeRect(bX, bY, bW, bH);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = this.roundWinner.color;
    ctx.font = '900 20px "Space Grotesk", sans-serif';
    ctx.fillText(`+1 SET: ${this.roundWinner.name}! (${this.roundWinner.vaultGold} 💰)`, arena.cx, arena.cy - 14);

    ctx.fillStyle = '#1C1C1A';
    ctx.font = '800 12px "JetBrains Mono", monospace';
    ctx.fillText(
      `TOPLAM SET: ${this.scores[this.roundWinner.index]} / ${this.targetScore}`,
      arena.cx,
      arena.cy + 16
    );
  }

  renderGameOverUI(ctx) {
    const { arena } = this;
    const boxW = Math.min(320, arena.size * 0.85);
    const boxH = 220;
    const boxX = arena.cx - boxW / 2;
    const boxY = arena.cy - boxH / 2;

    ctx.fillStyle = '#1C1C1A';
    ctx.fillRect(boxX + 8, boxY + 8, boxW, boxH);

    ctx.fillStyle = '#FAF7F2';
    ctx.fillRect(boxX, boxY, boxW, boxH);

    ctx.strokeStyle = '#1C1C1A';
    ctx.lineWidth = 4;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#1C1C1A';
    ctx.font = '800 14px "Space Grotesk", sans-serif';
    ctx.fillText('HAZİNE ŞAMPİYONU! 🏆', arena.cx, boxY + 34);

    if (this.matchWinner) {
      ctx.fillStyle = this.matchWinner.color;
      ctx.font = '900 22px "Space Grotesk", sans-serif';
      ctx.fillText(`${this.matchWinner.color} // KAZANDI`, arena.cx, boxY + 66, boxW - 20);

      ctx.font = '800 12px "JetBrains Mono", monospace';
      this.players.filter((p) => p.isJoined).forEach((p, row) => {
        ctx.fillStyle = p.color;
        ctx.fillText(`${p.color}: ${this.scores[p.index]} SET`, arena.cx, boxY + 94 + row * 17);
      });
    }

    const btnW = 190;
    const btnH = 46;
    const btnX = arena.cx - btnW / 2;
    const btnY = boxY + 154;

    ctx.fillStyle = '#1C1C1A';
    ctx.fillRect(btnX, btnY, btnW, btnH);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 16px "Space Grotesk", sans-serif';
    ctx.fillText('YENİDEN OYNA', arena.cx, btnY + btnH / 2);

    this.uiButtons.push({
      x: btnX,
      y: btnY,
      w: btnW,
      h: btnH,
      onClick: () => {
        this.resetCurrentGame();
      },
    });
  }
}
