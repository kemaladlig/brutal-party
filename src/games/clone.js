// BRUTAL CLONE: 2-4 oyunculu sahtekar avı — 2 gecikmeli kopyanla gez,
// omuz atarak gerçeği bul. Sahteye vurursan 2.5sn yavaşlarsın.

import { playExplosion, playStart, playJoin, playItemPickup } from '../audio.js';
import { renderControlGuide, renderLobbySeatCard, getStandardSeatRects, renderLobbyStartButton } from '../controlGuide.js';
import { renderCornerScores, renderRoundBanner, renderMatchOver } from '../ui/hud.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { updateCloneBotAI } from '../ai/cloneAI.js';

export const CLONE_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
export const CLONE_NAMES = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'];

// Lokal klavye: Hareket + Omuz Atma (P1 WASD+Space, P2 Oklar+Enter, P3 IJKL+O, P4 TFGH+B)
const CLONE_KEY_SLOTS_PAIRS = [
  { u: 'KeyW', d: 'KeyS', l: 'KeyA', r: 'KeyD', action: 'Space' },
  { u: 'ArrowUp', d: 'ArrowDown', l: 'ArrowLeft', r: 'ArrowRight', action: 'Enter' },
  { u: 'KeyI', d: 'KeyK', l: 'KeyJ', r: 'KeyL', action: 'KeyO' },
  { u: 'KeyT', d: 'KeyG', l: 'KeyF', r: 'KeyH', action: 'KeyB' },
];

const CLONE_DASH_COOLDOWN = 1.5;

export class CloneGame extends BaseMiniGame {
  constructor(canvas) {
    super(canvas);
    this.arena = { cx: 0, cy: 0, size: 0, left: 0, right: 0, top: 0, bottom: 0 };
    this.slotTypes = ['human', 'bot_normal', 'empty', 'empty'];
    this.scores = [0, 0, 0, 0];
    this.targetScore = 5;
    this.players = [];
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
    const map = CLONE_KEY_SLOTS_PAIRS[index];
    if (!map) return { dx: 0, dy: 0, action: false };
    const dx = (this.keys[map.r] ? 1 : 0) - (this.keys[map.l] ? 1 : 0);
    const dy = (this.keys[map.d] ? 1 : 0) - (this.keys[map.u] ? 1 : 0);
    return { dx, dy, action: !!this.keys[map.action] };
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

    if (this.state === 'LOBBY' || !this.players.length) {
      this.initPlayers();
    } else {
      // Maç içinde sadece remap, initPlayers yasak
      for (const p of this.players) {
        this.remapPoint(p, oldArena, this.arena);
        for (const c of p.clones) this.remapPoint(c, oldArena, this.arena);
        for (const h of p.history) this.remapPoint(h, oldArena, this.arena);
      }
    }
  }

  initPlayers() {
    const { left, right, top, bottom, size } = this.arena;
    const p = size * 0.15;
    const spawns = [
      { x: left + p, y: bottom - p, angle: -Math.PI / 4 },
      { x: left + p, y: top + p, angle: Math.PI / 4 },
      { x: right - p, y: top + p, angle: Math.PI * 0.75 },
      { x: right - p, y: bottom - p, angle: -Math.PI * 0.75 },
    ];

    this.players = spawns.map((s, i) => {
      // Raunt başı TV isimleri silinmez (CROWN deseni)
      const existing = this.players[i];
      return {
        index: i,
        name: existing?.name || CLONE_NAMES[i],
        color: CLONE_COLORS[i],
        x: s.x, y: s.y, angle: s.angle,
        speed: 150, steerX: 0, steerY: 0,
        isAlive: true, isJoined: this.isSlotJoined(i), slotType: this.slotTypes[i],
        history: [],
        clones: [
          { x: s.x, y: s.y, angle: s.angle, delay: 600, active: true },
          { x: s.x, y: s.y, angle: s.angle, delay: 1200, active: true },
        ],
        dashTimer: 0, dashCooldown: 0, slowTimer: 0,
        botTargetX: 0, botTargetY: 0, botCheckTimer: 0,
        keyActionLatch: false,
      };
    });
  }

  resetMatch() {
    this.state = 'LOBBY';
    this.scores = [0, 0, 0, 0];
    this.roundWinner = null;
    this.matchWinner = null;
    this.roundTransitionTimer = 0;
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
    this.onTouchesReset();
    playStart();

    const { left, right, top, bottom, size } = this.arena;
    const p = size * 0.15;
    const spawns = [
      { x: left + p, y: bottom - p, angle: -Math.PI / 4 },
      { x: left + p, y: top + p, angle: Math.PI / 4 },
      { x: right - p, y: top + p, angle: Math.PI * 0.75 },
      { x: right - p, y: bottom - p, angle: -Math.PI * 0.75 },
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
      player.history = [];
      player.clones = [
        { x: player.x, y: player.y, angle: player.angle, delay: 600, active: true },
        { x: player.x, y: player.y, angle: player.angle, delay: 1200, active: true },
      ];
    });
  }

  attemptTackle(player) {
    // Lobi/maç-sonunda kumandadan omuz tetiklenemez (uzak girdi kapısı)
    if (this.state !== 'PLAYING') return;
    if (player.dashCooldown <= 0 && player.slowTimer <= 0) {
      player.dashTimer = 0.25;
      player.dashCooldown = CLONE_DASH_COOLDOWN;
      playItemPickup();
    }
  }

  getQuadrant(x, y) {
    const { cx, cy } = this.arena;
    if (x < cx && y >= cy) return 0;
    if (x < cx && y < cy) return 1;
    if (x >= cx && y < cy) return 2;
    return 3;
  }

  onTouchStart(touch) {
    if (this.state === 'LOBBY') {
      if (this.handleUiTap(touch)) return;
      if (Math.hypot(touch.x - this.arena.cx, touch.y - this.arena.cy) < 65) {
        if (this.slotTypes.filter((s) => s !== 'empty').length >= 2) this.startNewMatch();
        return;
      }
      const q = this.getQuadrant(touch.x, touch.y);
      this.cycleSlotType(q);
      if (this.players[q]) {
        this.players[q].isJoined = this.isSlotJoined(q);
        this.players[q].slotType = this.slotTypes[q];
      }
      playJoin();
      return;
    }

    if (this.state === 'MATCH_OVER') {
      if (this.handleUiTap(touch)) return;
      if (Math.hypot(touch.x - this.arena.cx, touch.y - this.arena.cy) < 75) {
        this.resetMatch();
        playJoin();
      }
      return;
    }

    if (this.state === 'PLAYING') {
      const q = this.getQuadrant(touch.x, touch.y);
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

      // Hareket hızı: atılma 480, slow cezası 60, normal 150
      let currentSpeed = player.speed;
      if (player.dashTimer > 0) currentSpeed = 480;
      else if (player.slowTimer > 0) currentSpeed = 60;

      if (player.dashTimer <= 0) {
        player.x += player.steerX * currentSpeed * dt;
        player.y += player.steerY * currentSpeed * dt;
      } else {
        player.x += Math.cos(player.angle) * currentSpeed * dt;
        player.y += Math.sin(player.angle) * currentSpeed * dt;
      }

      // Duvar sınırları (kayarak çarpma)
      const r = 12;
      player.x = Math.max(this.arena.left + r, Math.min(this.arena.right - r, player.x));
      player.y = Math.max(this.arena.top + r, Math.min(this.arena.bottom - r, player.y));

      // Geçmişi kaydet (kopyalar 0.6sn + 1.2sn geriden oynatır)
      player.history.push({ x: player.x, y: player.y, angle: player.angle, time: now });

      // 1.5sn'den eski kareler gereksiz
      while (player.history.length > 0 && now - player.history[0].time > 1500) {
        player.history.shift();
      }

      // Kopyaları geçmişten oynat
      for (const clone of player.clones) {
        if (!clone.active) continue;
        const targetTime = now - clone.delay;

        let bestFrame = player.history[0];
        for (let i = player.history.length - 1; i >= 0; i--) {
          if (player.history[i].time <= targetTime) {
            bestFrame = player.history[i];
            break;
          }
        }

        if (bestFrame) {
          clone.x = bestFrame.x;
          clone.y = bestFrame.y;
          clone.angle = bestFrame.angle;
        }
      }
    }

    // Çarpışma: atılan omuz gerçeğe değerse skor, sahteye değerse slow
    for (const attacker of this.players) {
      if (!attacker.isJoined || !attacker.isAlive || attacker.dashTimer <= 0) continue;

      for (const victim of this.players) {
        if (!victim.isJoined || !victim.isAlive || victim.index === attacker.index) continue;

        const hitRadius = 24;

        if (Math.hypot(attacker.x - victim.x, attacker.y - victim.y) < hitRadius) {
          victim.isAlive = false;
          attacker.dashTimer = 0;
          this.scores[attacker.index]++;
          this.addTrauma(0.5);
          playExplosion();

          if (this.scores[attacker.index] >= this.targetScore) {
            this.matchWinner = attacker;
          }
          break;
        }

        for (const clone of victim.clones) {
          if (!clone.active) continue;
          if (Math.hypot(attacker.x - clone.x, attacker.y - clone.y) < hitRadius) {
            clone.active = false;
            attacker.dashTimer = 0;
            attacker.slowTimer = 2.5;
            this.addTrauma(0.2);
            playExplosion();
            break;
          }
        }
      }
    }

    const alive = this.players.filter((p) => p.isJoined && p.isAlive);
    if (alive.length <= 1) {
      this.handleRoundEnd(alive.length === 1 ? alive[0] : null);
    }
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
    } else if (data.action === 'TACKLE') {
      this.attemptTackle(player);
    }
  }

  handleRoundEnd(winner) {
    this.state = 'ROUND_OVER';
    this.roundWinner = winner;
    this.roundTransitionTimer = 2.5;
    // Skor yalnızca adam eleyince yazılır (hayatta kalma puanı yok)
    if (winner && this.scores[winner.index] >= this.targetScore) {
      this.matchWinner = winner;
    }
  }

  drawCharacter(ctx, x, y, angle, color, isDashing, isSlowed) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // Yavaşlık titremesi
    if (isSlowed) {
      ctx.translate((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
      ctx.globalAlpha = 0.7;
    }

    // Atılma halesi
    if (isDashing) {
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.globalAlpha = 0.5;
      ctx.fill();
      ctx.globalAlpha = 1.0;
    }

    // Gövde
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#1A1A1A'; ctx.stroke();

    // Yön işareti
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(4, -6, 8, 12);

    ctx.restore();
  }

  render() {
    const { ctx, canvas } = this;
    ctx.save();
    ctx.fillStyle = '#F4F4F0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.applyScreenShake(ctx);

    const { left, top, width, height } = this.arena;
    ctx.fillStyle = '#FAF7F2';
    ctx.fillRect(left, top, width, height);

    // Izgara zemini
    ctx.strokeStyle = '#E2DDD4';
    ctx.lineWidth = 1.5;
    const step = this.arena.size / 8;
    for (let x = left + step; x < this.arena.right; x += step) {
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, this.arena.bottom); ctx.stroke();
    }
    for (let y = top + step; y < this.arena.bottom; y += step) {
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(this.arena.right, y); ctx.stroke();
    }

    if (this.state === 'PLAYING' || this.state === 'ROUND_OVER') {
      renderCornerScores(ctx, { arena: this.arena, entries: this.players.map((p) => p.isJoined ? { color: p.color, text: `${this.scores[p.index]}★` } : null) });
    }

    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 6;
    ctx.strokeRect(left, top, width, height);

    // Oyuncular ve tıpatıp kopyaları (blöf: görsel fark yok)
    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      for (const clone of player.clones) {
        if (clone.active) {
          this.drawCharacter(ctx, clone.x, clone.y, clone.angle, player.color, false, false);
        }
      }
      this.drawCharacter(ctx, player.x, player.y, player.angle, player.color, player.dashTimer > 0, player.slowTimer > 0);
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
      renderControlGuide(ctx, this.arena, 'JOYSTICK: HAREKET ET • AKSİYON: OMUZ AT • SAHTELERE DİKKAT', [
        'P1 KIRMIZI',
        'P2 MAVİ',
        'P3 SARI',
        'P4 YEŞİL',
      ]);
      const seatRects = getStandardSeatRects(this.arena);
      for (let i = 0; i < 4; i++) {
        const rect = seatRects[i];
        const isTop = i === 1 || i === 2;
        renderLobbySeatCard(ctx, {
          x: rect.x,
          y: rect.y,
          w: rect.w,
          h: rect.h,
          slotIndex: i,
          slotType: this.players[i]?.slotType || this.slotTypes[i],
          playerName: this.players[i]?.name || '',
          playerColor: CLONE_COLORS[i],
          rotation: isTop ? Math.PI : 0,
        });
        this.uiButtons.push({
          x: rect.x, y: rect.y, w: rect.w, h: rect.h,
          onClick: () => {
            this.cycleSlotType(i);
            if (this.players[i]) {
              this.players[i].isJoined = this.isSlotJoined(i);
              this.players[i].slotType = this.slotTypes[i];
            }
            playJoin();
          },
        });
      }
      const joinedCount = this.slotTypes.filter((s) => s !== 'empty').length;
      renderLobbyStartButton(ctx, { arena: this.arena, uiButtons: this.uiButtons, joinedCount, accent: '#D84727', onStart: () => this.startNewMatch(), hidden: !!this.hideLobbyStartButton });
    } else if (this.state === 'ROUND_OVER') {
      renderRoundBanner(ctx, { arena: this.arena, title: this.roundWinner ? 'TUR BİTTİ' : 'BERABERE!', titleColor: this.roundWinner ? this.roundWinner.color : '#1A1A1A' });
    } else if (this.state === 'MATCH_OVER') {
      renderMatchOver(ctx, { arena: this.arena, uiButtons: this.uiButtons, headline: 'SAHTEKAR ŞAMPİYONU', winnerName: this.matchWinner ? this.matchWinner.name : '', winnerColor: this.matchWinner ? this.matchWinner.color : '#1A1A1A', rows: this.players.filter((p) => p.isJoined).map((p) => ({ color: p.color, text: `${p.name}: ${this.scores[p.index]}★` })), onRestart: () => this.startNewMatch() });
    }
    ctx.restore();
  }
}
