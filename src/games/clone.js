// BRUTAL CLONE: RPG Dedektiflik & Klon Avı
// Gerçek oyuncular, tapınakta görev yapan NPC klon kalabalığının arasına karışır.
// Rol yap, görevleri tamamla veya şüphelendiğin rakibe omuz atıp infaz et!
import { getSlotCustomization, getBotPersona } from '../core/customizationManager.js';
import { playExplosion, playStart, playJoin, playItemPickup } from '../audio.js';
import { renderControlGuide } from '../controlGuide.js';
import { t } from '../i18n.js';
import { renderAdaptiveScoreboard, renderRoundBanner, renderMatchOver } from '../ui/hud.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { updateCloneBotAI } from '../ai/cloneAI.js';
import { drawBrutalAvatar } from '../ui/characterRenderer.js';
import { readSlotKeys } from '../core/inputMaps.js';
import { getQuadrant, lobbyCenterStartTap, lobbyQuadrantTap, matchOverRestartTap } from '../core/touchFlow.js';
import { clampToArena, resolveAABB } from '../core/physics2d.js';

export const CLONE_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
export const CLONE_NAMES = ['P1', 'P2', 'P3', 'P4'];

const CLONE_DASH_COOLDOWN = 1.6;
const CLONE_RADIUS = 15;

export class CloneGame extends BaseMiniGame {
  constructor(canvas) {
    super(canvas);
    this.arena = { cx: 0, cy: 0, size: 0, left: 0, right: 0, top: 0, bottom: 0 };
    this.slotTypes = ['human', 'bot_normal', 'empty', 'empty'];
    this.scores = [0, 0, 0, 0];
    this.targetScore = 5;
    this.players = [];
    this.walls = [];
    this.taskPoints = [];
    this.npcClones = [];
    this.particles = [];
    this.floatingTexts = [];
    this.roundTime = 60;
    this.keys = {};
    this.roundTransitionTimer = 0;

    // Lokal dokunmatik: köşe başına yüzen joystick durumu
    this.touches = [
      { active: false, cx: 0, cy: 0, jx: 0, jy: 0, id: -1, actionId: -1 },
      { active: false, cx: 0, cy: 0, jx: 0, jy: 0, id: -1, actionId: -1 },
      { active: false, cx: 0, cy: 0, jx: 0, jy: 0, id: -1, actionId: -1 },
      { active: false, cx: 0, cy: 0, jx: 0, jy: 0, id: -1, actionId: -1 },
    ];

    this.initKeyboard();
  }

  initKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (!this.isLocalInputActive) return;
      this.keys[e.code] = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
  }

  keyboardInput(index) {
    return readSlotKeys(this.keys, index);
  }

  resize(width, height) {
    const oldArena = { ...this.arena };
    const marginX = Math.max(12, Math.floor(width * 0.04));
    const marginY = height > width ? Math.max(48, Math.floor(height * 0.12)) : Math.max(32, Math.floor(height * 0.06));
    const arenaW = width - marginX * 2;
    const arenaH = height - marginY * 2;

    this.arena = {
      cx: width / 2, cy: height / 2, width: arenaW, height: arenaH,
      size: Math.min(arenaW, arenaH), left: marginX, right: marginX + arenaW,
      top: marginY, bottom: marginY + arenaH,
    };

    this.buildMap();

    if (this.state === 'LOBBY' || !this.players.length) {
      this.initPlayers();
    } else {
      for (const p of this.players) this.remapPoint(p, oldArena, this.arena);
      for (const c of this.npcClones) this.remapPoint(c, oldArena, this.arena);
    }
  }

  buildMap() {
    this.walls = [];
    this.taskPoints = [];
    const { left, right, top, bottom, width, height, cx, cy } = this.arena;
    const wallThick = 14;

    // 4 köşe tapınak odası (kapı açıklıkları olan L-duvarlar)
    const roomW = width * 0.35;
    const roomH = height * 0.35;
    const doorSize = Math.min(width, height) * 0.14;

    // Sol Üst Oda: 🧪 SİMYA ODASI
    this.walls.push(
      { x: left, y: top + roomH, w: roomW - doorSize, h: wallThick },
      { x: left + roomW, y: top, w: wallThick, h: roomH - doorSize }
    );

    // Sağ Üst Oda: 📜 KÜTÜPHANE / ARŞİV
    this.walls.push(
      { x: right - roomW + doorSize, y: top + roomH, w: roomW - doorSize, h: wallThick },
      { x: right - roomW, y: top, w: wallThick, h: roomH - doorSize }
    );

    // Sol Alt Oda: 💎 HAZİNE ODASI
    this.walls.push(
      { x: left, y: bottom - roomH, w: roomW - doorSize, h: wallThick },
      { x: left + roomW, y: bottom - roomH + doorSize, w: wallThick, h: roomH - doorSize }
    );

    // Sağ Alt Oda: ⚔️ KUTSAL SUNAK
    this.walls.push(
      { x: right - roomW + doorSize, y: bottom - roomH, w: roomW - doorSize, h: wallThick },
      { x: right - roomW, y: bottom - roomH + doorSize, w: wallThick, h: roomH - doorSize }
    );

    // Merkez Avlu Sütunları
    const pillar = Math.min(width, height) * 0.08;
    const offset = Math.min(width, height) * 0.16;
    this.walls.push(
      { x: cx - offset - pillar / 2, y: cy - offset - pillar / 2, w: pillar, h: pillar },
      { x: cx + offset - pillar / 2, y: cy - offset - pillar / 2, w: pillar, h: pillar },
      { x: cx - offset - pillar / 2, y: cy + offset - pillar / 2, w: pillar, h: pillar },
      { x: cx + offset - pillar / 2, y: cy + offset - pillar / 2, w: pillar, h: pillar }
    );

    // 6 aday görev noktası: 4 köşe oda + 2 avlu merkez noktası
    const avluOffset = Math.min(width, height) * 0.22;
    const allCandidates = [
      { id: 'alchemy',  name: 'SİMYA KAZANI',   icon: '🧪', color: '#8A2BE2', x: left  + roomW * 0.45, y: top    + roomH * 0.45, radius: 40 },
      { id: 'library',  name: 'KÜTÜPHANE',       icon: '📜', color: '#D99B26', x: right - roomW * 0.45, y: top    + roomH * 0.45, radius: 40 },
      { id: 'treasury', name: 'HAZİNE SANDIĞI',  icon: '💎', color: '#1D5D8A', x: left  + roomW * 0.45, y: bottom - roomH * 0.45, radius: 40 },
      { id: 'altar',    name: 'KUTSAL SUNAK',     icon: '⚔️', color: '#D84727', x: right - roomW * 0.45, y: bottom - roomH * 0.45, radius: 40 },
      { id: 'fountain', name: 'ÇEŞME',            icon: '⛲', color: '#2F6A4F', x: cx, y: cy - avluOffset, radius: 38 },
      { id: 'statue',   name: 'HEYKEL',           icon: '🗿', color: '#888888', x: cx, y: cy + avluOffset, radius: 38 },
    ];

    // Her raunt rastgele 3 tanesi seçilir (Fisher-Yates shuffle, ilk 3 al)
    const shuffled = [...allCandidates];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    this.taskPoints = shuffled.slice(0, 3);

    // Her görev noktası için kaç kez tamamlandığı takibini başlat
    for (const tp of this.taskPoints) {
      tp.completions = 0; // raunt içi sıfırlama
    }
  }

  resolveWallCollision(entity, radius = CLONE_RADIUS) {
    clampToArena(entity, radius, this.arena);
    resolveAABB(entity, this.walls, radius);
  }

  initPlayers() {
    const { cx, cy, size } = this.arena;
    const p = size * 0.22;
    const spawns = [
      { x: cx - p, y: cy + p, angle: -Math.PI / 4 },
      { x: cx - p, y: cy - p, angle: Math.PI / 4 },
      { x: cx + p, y: cy - p, angle: Math.PI * 0.75 },
      { x: cx + p, y: cy + p, angle: -Math.PI * 0.75 },
    ];

    this.players = spawns.map((s, i) => {
      const existing = this.players[i];
      const custom = getSlotCustomization(i);
      const isBot = this.slotTypes[i] === 'bot_normal' || this.slotTypes[i] === 'bot_god';
      const isGod = this.slotTypes[i] === 'bot_god';
      const persona = isBot ? getBotPersona(i, isGod) : null;
      return {
        index: i,
        name: existing?.name || (isBot ? persona.name : `P${i + 1}`),
        color: isBot ? persona.color : (custom.color || CLONE_COLORS[i]),
        x: s.x, y: s.y, angle: s.angle,
        speed: 135, steerX: 0, steerY: 0,
        isAlive: true, isJoined: this.isSlotJoined(i), slotType: this.slotTypes[i],
        dashTimer: 0, dashCooldown: 0, slowTimer: 0,
        taskTimer: 0, currentTaskId: null,
        botTargetX: 0, botTargetY: 0, botCheckTimer: 0,
        keyActionLatch: false,
      };
    });

    this.initNpcClones();
  }

  initNpcClones() {
    this.npcClones = [];
    const joined = this.players.filter((p) => p.isJoined);
    if (!joined.length) return;

    // Her katılan oyuncu için 3 adet bağımsız dolaşan RPG klonu
    for (const p of joined) {
      for (let k = 0; k < 3; k++) {
        const t = this.taskPoints[(p.index + k) % this.taskPoints.length] || this.taskPoints[0];
        const angle = Math.random() * Math.PI * 2;
        const dist = 30 + Math.random() * 80;
        this.npcClones.push({
          ownerIndex: p.index,
          color: p.color,
          x: this.arena.cx + Math.cos(angle) * dist,
          y: this.arena.cy + Math.sin(angle) * dist,
          angle: Math.random() * Math.PI * 2,
          speed: 80 + Math.random() * 25,
          steerX: 0,
          steerY: 0,
          state: 'WALK',
          targetTask: t,
          taskWaitTimer: 1.5 + Math.random() * 2.0,
          active: true,
        });
      }
    }
  }

  resetMatch() {
    this.state = 'LOBBY';
    this.scores = [0, 0, 0, 0];
    this.roundWinner = null;
    this.matchWinner = null;
    this.roundTransitionTimer = 0;
    this.particles = [];
    this.floatingTexts = [];
    this.initPlayers();
    this.onTouchesReset();
  }

  reset() {
    this.resetMatch();
  }

  startNewMatch() {
    this.scores = [0, 0, 0, 0];
    this.matchWinner = null;
    this.startRound();
  }

  startRound() {
    const joined = this.players.filter((p) => p.isJoined);
    if (joined.length < 2) {
      this.state = 'LOBBY';
      return;
    }
    this.state = 'PLAYING';
    this.roundWinner = null;
    this.roundTransitionTimer = 0;
    this.roundTime = 60;
    this.particles = [];
    this.floatingTexts = [];
    this.onTouchesReset();
    playStart();

    const { cx, cy, size } = this.arena;
    const p = size * 0.22;
    const spawns = [
      { x: cx - p, y: cy + p, angle: -Math.PI / 4 },
      { x: cx - p, y: cy - p, angle: Math.PI / 4 },
      { x: cx + p, y: cy - p, angle: Math.PI * 0.75 },
      { x: cx + p, y: cy + p, angle: -Math.PI * 0.75 },
    ];

    this.players.forEach((player, i) => {
      player.x = spawns[i].x;
      player.y = spawns[i].y;
      player.angle = spawns[i].angle;
      player.isAlive = player.isJoined;
      player.dashTimer = 0;
      player.dashCooldown = 0;
      player.slowTimer = 0;
      player.steerX = 0;
      player.steerY = 0;
      player.taskTimer = 0;
      player.currentTaskId = null;
    });

    this.initNpcClones();
  }

  attemptTackle(player) {
    if (this.state !== 'PLAYING') return;
    if (player.dashCooldown <= 0 && player.slowTimer <= 0) {
      player.dashTimer = 0.22;
      player.dashCooldown = CLONE_DASH_COOLDOWN;
      playItemPickup();
      this.checkTackleHit(player);
    }
  }

  checkTackleHit(attacker) {
    const hitRadius = 34;

    // 1. Önce diğer canlı gerçek oyunculara bak
    for (const victim of this.players) {
      if (!victim.isJoined || !victim.isAlive || victim.index === attacker.index) continue;

      if (Math.hypot(attacker.x - victim.x, attacker.y - victim.y) < hitRadius) {
        victim.isAlive = false;
        attacker.dashTimer = 0;
        this.scores[attacker.index] += 2;
        this.addTrauma(0.5);
        playExplosion();
        this.spawnBurst(victim.x, victim.y, victim.color);
        this.spawnFloatingText(victim.x, victim.y - 18, t('clone.real'), '#2F6A4F');

        if (this.scores[attacker.index] >= this.targetScore) {
          this.matchWinner = attacker;
        }
        this.checkAlive();
        return;
      }
    }

    // 2. Eğer gerçek oyuncu değilse, NPC klonlara bak
    for (const clone of this.npcClones) {
      if (!clone.active) continue;

      if (Math.hypot(attacker.x - clone.x, attacker.y - clone.y) < hitRadius) {
        clone.active = false;
        attacker.dashTimer = 0;
        attacker.slowTimer = 2.5; // Ceza!
        this.addTrauma(0.25);
        playExplosion();
        this.spawnGlitch(clone.x, clone.y, clone.color);
        this.spawnFloatingText(attacker.x, attacker.y - 18, '⚡ MASUM KLON! (CEZA)', '#E63946');
        return;
      }
    }
  }

  checkAlive() {
    const alive = this.players.filter((p) => p.isJoined && p.isAlive);
    if (alive.length <= 1) {
      this.handleRoundEnd(alive.length === 1 ? alive[0] : null);
    }
  }

  onTouchStart(touch) {
    if (this.handleRoundOverSkip()) return;

    if (this.state === 'LOBBY') {
      if (this.handleUiTap(touch)) return;
      if (lobbyCenterStartTap(this, touch)) return;
      lobbyQuadrantTap(this, touch, {
        onSeatChange: (q) => {
          if (this.players[q]) {
            this.players[q].isJoined = this.isSlotJoined(q);
            this.players[q].slotType = this.slotTypes[q];
          }
        },
      });
      playJoin();
      return;
    }

    if (this.state === 'MATCH_OVER') {
      if (this.handleUiTap(touch)) return;
      matchOverRestartTap(this, touch, { onRestart: () => { this.resetMatch(); playJoin(); } });
      return;
    }

    if (this.state === 'PLAYING') {
      const q = getQuadrant(this.arena, touch.x, touch.y);
      const player = this.players[q];
      if (!player || !player.isJoined || !player.isAlive || player.slotType !== 'human') return;

      const t = this.touches[q];
      // Kadranın dış çeyreği action (omuz), içi joystick
      const isRightSide = (q === 0 || q === 1)
        ? (touch.x > this.arena.left + this.arena.width / 4)
        : (touch.x > this.arena.right - this.arena.width / 4);

      if (isRightSide && t.actionId === -1) {
        t.actionId = touch.id;
        this.attemptTackle(player);
      } else if (!isRightSide && t.id === -1) {
        t.active = true;
        t.id = touch.id;
        t.cx = touch.x;
        t.cy = touch.y;
        t.jx = touch.x;
        t.jy = touch.y;
      }
    }
  }

  onTouchMove(touch) {
    if (this.state !== 'PLAYING') return;
    for (let i = 0; i < 4; i++) {
      const t = this.touches[i];
      if (t.active && t.id === touch.id) {
        t.jx = touch.x;
        t.jy = touch.y;
        const player = this.players[i];
        if (player && player.isAlive && player.slotType === 'human') {
          const dx = t.jx - t.cx;
          const dy = t.jy - t.cy;
          const dist = Math.hypot(dx, dy);
          if (dist > 10) {
            player.steerX = dx / dist;
            player.steerY = dy / dist;
            player.angle = Math.atan2(dy, dx);
          }
        }
      }
    }
  }

  onTouchEnd(touch) {
    for (let i = 0; i < 4; i++) {
      const t = this.touches[i];
      if (t.id === touch.id) {
        t.active = false;
        t.id = -1;
        const player = this.players[i];
        if (player && player.slotType === 'human') {
          player.steerX = 0;
          player.steerY = 0;
        }
      }
      if (t.actionId === touch.id) {
        t.actionId = -1;
      }
    }
  }

  onTouchesReset() {
    this.touches.forEach((t) => { t.active = false; t.id = -1; t.actionId = -1; });
    this.players.forEach((p) => { p.steerX = 0; p.steerY = 0; });
  }

  update(now) {
    const dt = Math.min((now - this.lastTime) / 1000, 0.08);
    this.lastTime = now;

    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 2.2);
    }

    if (this.state === 'ROUND_OVER') {
      this.roundTransitionTimer -= dt;
      if (this.roundTransitionTimer <= 0) {
        this.matchWinner ? this.state = 'MATCH_OVER' : this.startRound();
      }
      return;
    }

    if (this.state !== 'PLAYING') return;

    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      if (player.dashCooldown > 0) player.dashCooldown -= dt;
      if (player.dashTimer > 0) player.dashTimer -= dt;
      if (player.slowTimer > 0) player.slowTimer -= dt;

      if (player.slotType !== 'human') {
        updateCloneBotAI(this, player, dt);
      } else {
        const ki = this.keyboardInput(player.index);
        if (ki.dx !== 0 || ki.dy !== 0) {
          const mag = Math.hypot(ki.dx, ki.dy) || 1;
          player.steerX = ki.dx / mag;
          player.steerY = ki.dy / mag;
          player.angle = Math.atan2(ki.dy, ki.dx);
          player.keyHeld = true;
        } else if (player.keyHeld) {
          player.keyHeld = false;
          if (!this.touches[player.index].active && !player.remoteActive) {
            player.steerX = 0;
            player.steerY = 0;
          }
        } else if (!this.touches[player.index].active && !player.remoteActive) {
          player.steerX = 0;
          player.steerY = 0;
        }

        if (ki.action && !player.keyActionLatch) {
          this.attemptTackle(player);
          player.keyActionLatch = true;
        } else if (!ki.action) {
          player.keyActionLatch = false;
        }
      }

      // Hız hesaplama
      let currentSpeed = player.speed;
      if (player.dashTimer > 0) currentSpeed = 460;
      else if (player.slowTimer > 0) currentSpeed = 55;

      if (player.dashTimer <= 0) {
        player.x += player.steerX * currentSpeed * dt;
        player.y += player.steerY * currentSpeed * dt;
      } else {
        player.x += Math.cos(player.angle) * currentSpeed * dt;
        player.y += Math.sin(player.angle) * currentSpeed * dt;
        this.checkTackleHit(player);
      }

      // Duvar çarpışması (AABB slide)
      this.resolveWallCollision(player, CLONE_RADIUS);

      // RPG Görev Alanı Etkileşimi (Rol yapma & Görev tamamlama)
      let insideAnyTask = false;
      for (const t of this.taskPoints) {
        const distToTask = Math.hypot(player.x - t.x, player.y - t.y);
        if (distToTask < t.radius) {
          insideAnyTask = true;
          player.currentTaskId = t.id;
          // Eğer sakin duruyorsa görev ilerler (1.5sn - daha dinamik tempo)
          const isStationary = Math.hypot(player.steerX, player.steerY) < 0.2;
          if (isStationary && player.dashTimer <= 0 && player.slowTimer <= 0) {
            player.taskTimer += dt;
            if (player.taskTimer >= 1.5) {
              // Görev başarıyla tamamlandı!
              player.taskTimer = 0;
              t.completions = (t.completions || 0) + 1;
              this.scores[player.index]++;
              playItemPickup();
              this.spawnBurst(t.x, t.y, t.color);
              const compText = t.completions >= 2 ? ` (${t.completions}x ✓)` : '';
              this.spawnFloatingText(player.x, player.y - 20, `${t.icon} ${t.name} +1★${compText}`, '#2F6A4F');
              if (this.scores[player.index] >= this.targetScore) {
                this.matchWinner = player;
                this.handleRoundEnd(player);
                return;
              }
            }
          }
          break;
        }
      }
      if (!insideAnyTask) {
        player.taskTimer = Math.max(0, player.taskTimer - dt * 2.0);
        if (player.taskTimer === 0) player.currentTaskId = null;
      }
    }

    // NPC Klon Yapay Zekası & Hareketi
    const { left, right, top, bottom, width, height } = this.arena;
    const roomW = width * 0.35;
    const roomH = height * 0.35;
    const doorSize = Math.min(width, height) * 0.14;
    const doorWaypoints = {
      alchemy:  { x: left  + roomW - doorSize * 0.5, y: top    + roomH + 15 },
      library:  { x: right - roomW + doorSize * 0.5, y: top    + roomH + 15 },
      treasury: { x: left  + roomW - doorSize * 0.5, y: bottom - roomH - 15 },
      altar:    { x: right - roomW + doorSize * 0.5, y: bottom - roomH - 15 },
      fountain: null, // avlu içi — doğrudan git
      statue:   null, // avlu içi — doğrudan git
    };

    const getEntityZone = (x, y) => {
      if (x < left + roomW && y < top + roomH) return 'alchemy';
      if (x > right - roomW && y < top + roomH) return 'library';
      if (x < left + roomW && y > bottom - roomH) return 'treasury';
      if (x > right - roomW && y > bottom - roomH) return 'altar';
      return 'courtyard';
    };

    for (const clone of this.npcClones) {
      if (!clone.active) continue;

      if (clone.state === 'WALK') {
        let targetX = clone.targetTask.x;
        let targetY = clone.targetTask.y;
        const curZone = getEntityZone(clone.x, clone.y);
        const tgtZone = clone.targetTask.id;

        if (curZone !== tgtZone) {
          if (curZone === 'courtyard' && doorWaypoints[tgtZone]) {
            const dw = doorWaypoints[tgtZone];
            if (Math.hypot(dw.x - clone.x, dw.y - clone.y) > 25) {
              targetX = dw.x;
              targetY = dw.y;
            }
          } else if (curZone !== 'courtyard' && doorWaypoints[curZone]) {
            const dw = doorWaypoints[curZone];
            if (Math.hypot(dw.x - clone.x, dw.y - clone.y) > 25) {
              targetX = dw.x;
              targetY = dw.y;
            }
          }
        }

        const dx = targetX - clone.x;
        const dy = targetY - clone.y;
        const dist = Math.hypot(dx, dy) || 1;

        if (Math.hypot(clone.targetTask.x - clone.x, clone.targetTask.y - clone.y) < 28) {
          // İstasyonuna vardı, rol yapmaya başla
          clone.state = 'TASK';
          clone.taskWaitTimer = 2.2 + Math.random() * 2.5;
          clone.steerX = 0;
          clone.steerY = 0;
        } else {
          clone.steerX = dx / dist;
          clone.steerY = dy / dist;
          clone.angle = Math.atan2(dy, dx);
          clone.x += clone.steerX * clone.speed * dt;
          clone.y += clone.steerY * clone.speed * dt;
          this.resolveWallCollision(clone, CLONE_RADIUS);
        }
      } else if (clone.state === 'TASK') {
        // Görev alanında durup bekler, hafifçe sağa sola bakar
        clone.angle += Math.sin(now / 500) * 0.02;
        clone.taskWaitTimer -= dt;
        if (clone.taskWaitTimer <= 0) {
          // Başka bir göreve doğru yola çık
          const otherTasks = this.taskPoints.filter((tp) => tp.id !== clone.targetTask.id);
          clone.targetTask = otherTasks[Math.floor(Math.random() * otherTasks.length)] || this.taskPoints[0];
          clone.state = 'WALK';
        }
      }
    }

    // Parçacıklar
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.alpha -= p.decay * dt;
      if (p.alpha <= 0) this.particles.splice(i, 1);
    }

    // Uçuşan metinler
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y += ft.vy * dt;
      ft.alpha -= ft.decay * dt;
      if (ft.alpha <= 0) this.floatingTexts.splice(i, 1);
    }

    this.roundTime -= dt;
    if (this.roundTime <= 0) {
      const alivePlayers = this.players.filter((p) => p.isJoined && p.isAlive);
      this.handleRoundEnd(alivePlayers.length === 1 ? alivePlayers[0] : null);
      return;
    }

    this.checkAlive();
  }

  spawnBurst(x, y, color) {
    for (let i = 0; i < 22; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 40 + Math.random() * 110;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        color: i % 2 === 0 ? color : '#1A1A1A',
        radius: 3 + Math.random() * 3.5,
        alpha: 1.0,
        decay: 1.7,
      });
    }
  }

  spawnGlitch(x, y, color) {
    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 25 + Math.random() * 80;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        color: '#E63946',
        radius: 2.5 + Math.random() * 2.5,
        alpha: 1.0,
        decay: 2.2,
      });
    }
  }

  spawnFloatingText(x, y, text, color) {
    this.floatingTexts.push({
      x, y,
      text,
      color,
      vy: -35,
      alpha: 1.0,
      decay: 1.1,
    });
  }

  handleRemoteInput(slotIndex, data) {
    const player = this.players[slotIndex];
    if (!player || !player.isJoined || !player.isAlive) return;

    if (data.action === 'JOYSTICK_MOVE' || data.action === 'MOVE') {
      const force = Number.isFinite(data.force) ? data.force : Math.hypot(data.dx || 0, data.dy || 0);
      if (force > 0.05) {
        player.steerX = Number.isFinite(data.dx) ? Math.max(-1, Math.min(1, data.dx)) : 0;
        player.steerY = Number.isFinite(data.dy) ? Math.max(-1, Math.min(1, data.dy)) : 0;
        if (Number.isFinite(data.angle)) {
          player.angle = data.angle;
        } else if (player.steerX !== 0 || player.steerY !== 0) {
          player.angle = Math.atan2(player.steerY, player.steerX);
        }
        player.remoteActive = true;
      } else {
        player.steerX = 0;
        player.steerY = 0;
        player.remoteActive = false;
      }
    } else if (data.action === 'TACKLE' || data.action === 'DASH') {
      this.attemptTackle(player);
    }
  }

  handleRoundEnd(winner) {
    this.state = 'ROUND_OVER';
    this.roundWinner = winner;
    this.roundTransitionTimer = 2.5;
    if (winner && this.scores[winner.index] >= this.targetScore) {
      this.matchWinner = winner;
    }
  }

  drawCharacter(ctx, x, y, angle, color, isDashing, isSlowed, taskProgress = 0) {
    ctx.save();
    ctx.translate(x, y);

    // Yavaşlık / sersemlik titremesi & dönen yıldızlar
    if (isSlowed) {
      ctx.translate((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3);
      ctx.fillStyle = '#E63946';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('💫 CEZA', 0, -22);
    }

    // Görev yaparken dolum barı / rün halkası (görev eşiği 1.5sn)
    if (taskProgress > 0) {
      ctx.beginPath();
      ctx.arc(0, 0, CLONE_RADIUS + 7, -Math.PI / 2, -Math.PI / 2 + (taskProgress / 1.5) * Math.PI * 2);
      ctx.strokeStyle = '#2F6A4F';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Atılma halesi
    if (isDashing) {
      ctx.beginPath();
      ctx.arc(0, 0, CLONE_RADIUS + 8, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.globalAlpha = 0.6;
      ctx.fill();
      ctx.globalAlpha = 1.0;
    }

    let exp = 'normal';
    if (isSlowed) exp = 'dizzy';
    else if (isDashing) exp = 'angry';
    else if (taskProgress > 0) exp = 'wink';

    drawBrutalAvatar(ctx, 0, 0, CLONE_RADIUS, {
      color: color,
      facingAngle: angle,
      expression: exp,
      showPointer: true,
      borderColor: '#1A1A1A',
      borderWidth: 2.5,
    });

    ctx.restore();
  }

  render() {
    const { ctx, canvas } = this;
    ctx.save();
    ctx.fillStyle = '#151515';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.applyScreenShake(ctx);

    const { left, top, width, height } = this.arena;

    // Tapınak Taş Zemini
    ctx.fillStyle = '#E8E5DF';
    ctx.fillRect(left, top, width, height);

    // Taş zemin karoları
    ctx.strokeStyle = '#D5D1C7';
    ctx.lineWidth = 1.5;
    const step = this.arena.size / 9;
    for (let x = left + step; x < this.arena.right; x += step) {
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, this.arena.bottom); ctx.stroke();
    }
    for (let y = top + step; y < this.arena.bottom; y += step) {
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(this.arena.right, y); ctx.stroke();
    }

    // 4 Görev İstasyonu (Rün çemberleri & semboller)
    for (const t of this.taskPoints) {
      ctx.save();
      // Dış rün çemberi
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2);
      ctx.fillStyle = `${t.color}22`;
      ctx.fill();
      ctx.strokeStyle = t.color;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 6]);
      ctx.stroke();

      // İç simge ve zemin
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(t.x, t.y, 16, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.icon, t.x, t.y);

      // İstasyon etiketi
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#1A1A1A';
      ctx.fillText(t.name, t.x, t.y + t.radius + 14);
      ctx.restore();
    }

    // Harita Duvarları ve Sütunları
    for (const w of this.walls) {
      // Duvar gölgesi
      ctx.fillStyle = '#101010';
      ctx.fillRect(w.x + 3, w.y + 3, w.w, w.h);

      // Duvar ana gövdesi
      ctx.fillStyle = '#2A2A2A';
      ctx.fillRect(w.x, w.y, w.w, w.h);

      // Duvar üst vurgusu
      ctx.strokeStyle = '#484848';
      ctx.lineWidth = 2;
      ctx.strokeRect(w.x, w.y, w.w, w.h);
    }

    // Dış arena çerçevesi
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 6;
    ctx.strokeRect(left, top, width, height);

    // Skorlar (Proximity Ghosting)
    if (this.state === 'PLAYING' || this.state === 'ROUND_OVER') {
      const activeEntities = [
        ...this.players.filter((p) => p.isJoined),
        ...this.npcClones.filter((c) => c.active),
      ];
      renderAdaptiveScoreboard(ctx, {
        arena: this.arena,
        players: this.players,
        scores: this.scores,
        entities: activeEntities,
        isHosting: !!this.hideLobbyStartButton,
        state: this.state,
      });
    }

    // NPC Klonları çiz (tamamen oyuncularla aynı model)
    for (const c of this.npcClones) {
      if (!c.active) continue;
      this.drawCharacter(ctx, c.x, c.y, c.angle, c.color, false, false, c.state === 'TASK' ? (1 - c.taskWaitTimer / 4) * 2 : 0);
    }

    // Gerçek Oyuncuları çiz
    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;
      this.drawCharacter(
        ctx,
        player.x,
        player.y,
        player.angle,
        player.color,
        player.dashTimer > 0,
        player.slowTimer > 0,
        player.taskTimer
      );
    }

    // Parçacıklar
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Uçuşan metinler
    for (const ft of this.floatingTexts) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, ft.alpha));
      ctx.font = 'bold 15px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }

    // Geri sayım filigranı (son 15 saniye)
    if (this.state === 'PLAYING' && this.roundTime <= 15) {
      ctx.save();
      ctx.font = 'bold 36px monospace';
      ctx.fillStyle = this.roundTime <= 5 ? '#E63946' : 'rgba(26,26,26,0.3)';
      ctx.textAlign = 'center';
      ctx.fillText(Math.ceil(this.roundTime), this.arena.cx, this.arena.top + 45);
      ctx.restore();
    }

    // Lokal dokunmatik joystick göstergesi
    if (this.state === 'PLAYING' && this.isLocalInputActive) {
      for (let i = 0; i < 4; i++) {
        const t = this.touches[i];
        if (t.active) {
          ctx.beginPath(); ctx.arc(t.cx, t.cy, 30, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 3; ctx.stroke();
          ctx.beginPath(); ctx.arc(t.jx, t.jy, 15, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fill();
        }
      }
    }

    this.uiButtons = [];
    if (this.state === 'LOBBY') {
      renderControlGuide(ctx, this.arena, t('guide.clone'), [
        'P1 [WASD/SPACE]',
        'P2 [OKLAR/ENTER]',
        'P3 [IJKL/O]',
        'P4 [TFGH/B]',
      ]);
      this.renderStandardLobby(ctx, {
        arena: this.arena,
        colors: CLONE_COLORS,
        accent: '#D84727',
        onStart: () => this.startNewMatch(),
        rotateTop: true,
        onSeatChange: (i) => {
          if (this.players[i]) {
            this.players[i].isJoined = this.isSlotJoined(i);
            this.players[i].slotType = this.slotTypes[i];
          }
          playJoin();
        },
      });
    } else if (this.state === 'ROUND_OVER') {
      renderRoundBanner(ctx, { arena: this.arena, title: this.roundWinner ? t('game.roundOver') : t('game.draw'), titleColor: this.roundWinner ? this.roundWinner.color : '#1A1A1A' });
    } else if (this.state === 'MATCH_OVER') {
      renderMatchOver(ctx, { arena: this.arena, uiButtons: this.uiButtons, headline: t('clone.champ'), winnerName: this.matchWinner ? this.matchWinner.name : '', winnerColor: this.matchWinner ? this.matchWinner.color : '#1A1A1A', rows: this.players.filter((p) => p.isJoined).map((p) => ({ color: p.color, text: `${p.name}: ${this.scores[p.index]}★` })), onRestart: () => this.startNewMatch() });
    }
    ctx.restore();
  }
}
