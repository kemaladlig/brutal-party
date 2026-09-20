// BRUTAL COLLAPSE: 2-4 oyunculu çöken zemin — ayakta kal, zıplayarak boşluk
// geç, sona kalan raundu alır. Basılan kare 0.8sn sonra çöker.

import { playExplosion, playStart, playJoin, playItemPickup } from '../audio.js';
import { renderControlGuide, renderLobbySeatCard, getStandardSeatRects, renderLobbyStartButton } from '../controlGuide.js';
import { renderCornerScores, renderRoundBanner, renderMatchOver } from '../ui/hud.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { updateCollapseBotAI } from '../ai/collapseAI.js';

export const COLLAPSE_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
export const COLLAPSE_NAMES = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'];

const COLLAPSE_KEY_SLOTS = [
  { u: 'KeyW', d: 'KeyS', l: 'KeyA', r: 'KeyD', action: 'Space' },
  { u: 'ArrowUp', d: 'ArrowDown', l: 'ArrowLeft', r: 'ArrowRight', action: 'Enter' },
  { u: 'KeyI', d: 'KeyK', l: 'KeyJ', r: 'KeyL', action: 'KeyO' },
  { u: 'KeyT', d: 'KeyG', l: 'KeyF', r: 'KeyH', action: 'KeyB' },
];

const COLLAPSE_JUMP_COOLDOWN = 1.8;

export class CollapseGame extends BaseMiniGame {
  constructor(canvas) {
    super(canvas);
    this.arena = { cx: 0, cy: 0, size: 0, left: 0, right: 0, top: 0, bottom: 0 };
    this.slotTypes = ['human', 'bot_normal', 'empty', 'empty'];
    this.scores = [0, 0, 0, 0];
    this.targetScore = 5;
    this.players = [];
    this.particles = [];

    // Izgara: 0 sağlam, 1 uyarı (çöküyor), 2 boşluk
    this.gridCOLS = 13;
    this.gridROWS = 13;
    this.grid = [];
    this.cellSize = 0;
    this.offsetX = 0;
    this.offsetY = 0;

    this.keys = {};
    this.roundTransitionTimer = 0;
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
    const map = COLLAPSE_KEY_SLOTS[index];
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

    // Izgara metrikleri güncellenir, kare durumlarına dokunulmaz
    this.cellSize = this.arena.size / this.gridCOLS;
    this.offsetX = this.arena.cx - (this.gridCOLS * this.cellSize) / 2;
    this.offsetY = this.arena.cy - (this.gridROWS * this.cellSize) / 2;

    if (this.state === 'LOBBY' || !this.players.length) {
      this.initPlayers();
      this.buildGrid();
    } else {
      // Maç içinde sadece remap (ızgara indeks tabanlı, taşınmaz)
      for (const p of this.players) this.remapPoint(p, oldArena, this.arena);
    }
  }

  buildGrid() {
    this.grid = [];
    for (let r = 0; r < this.gridROWS; r++) {
      const row = [];
      for (let c = 0; c < this.gridCOLS; c++) {
        // Köşeler en baştan boş: organik arena hissi
        const isCorner = (r === 0 && c === 0) || (r === 0 && c === this.gridCOLS - 1) || (r === this.gridROWS - 1 && c === 0) || (r === this.gridROWS - 1 && c === this.gridCOLS - 1);
        row.push({ state: isCorner ? 2 : 0, timer: 0 });
      }
      this.grid.push(row);
    }
  }

  initPlayers() {
    const p = this.arena.size * 0.25;
    const spawns = [
      { x: this.arena.cx - p, y: this.arena.cy + p },
      { x: this.arena.cx - p, y: this.arena.cy - p },
      { x: this.arena.cx + p, y: this.arena.cy - p },
      { x: this.arena.cx + p, y: this.arena.cy + p },
    ];

    this.players = spawns.map((s, i) => {
      // Raunt başı TV isimleri silinmez (CROWN deseni)
      const existing = this.players[i];
      return {
        index: i, name: existing?.name || COLLAPSE_NAMES[i], color: COLLAPSE_COLORS[i],
        x: s.x, y: s.y, angle: 0,
        speed: 120, steerX: 0, steerY: 0,
        isAlive: true, isJoined: this.isSlotJoined(i), slotType: this.slotTypes[i],
        jumpTimer: 0, jumpCooldown: 0,
        botCheckTimer: 0, keyActionLatch: false,
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
    this.buildGrid();
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
    this.buildGrid();

    const p = this.arena.size * 0.25;
    const spawns = [
      { x: this.arena.cx - p, y: this.arena.cy + p },
      { x: this.arena.cx - p, y: this.arena.cy - p },
      { x: this.arena.cx + p, y: this.arena.cy - p },
      { x: this.arena.cx + p, y: this.arena.cy + p },
    ];

    this.players.forEach((player, i) => {
      player.x = spawns[i].x;
      player.y = spawns[i].y;
      player.isAlive = player.isJoined;
      player.jumpTimer = 0;
      player.jumpCooldown = 0;
      player.steerX = 0;
      player.steerY = 0;
    });
  }

  attemptJump(player) {
    // Lobi/maç-sonunda kumandadan zıplama tetiklenemez (uzak girdi kapısı)
    if (this.state !== 'PLAYING') return;
    if (player.jumpCooldown <= 0) {
      player.jumpTimer = 0.45;
      player.jumpCooldown = COLLAPSE_JUMP_COOLDOWN;
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
      const isRightSide = (q === 0 || q === 1)
        ? (touch.x > this.arena.left + this.arena.width / 4)
        : (touch.x > this.arena.right - this.arena.width / 4);

      if (isRightSide && t.actionId === -1) {
        t.actionId = touch.id;
        this.attemptJump(player);
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
        const dx = t.jx - t.cx;
        const dy = t.jy - t.cy;
        const dist = Math.hypot(dx, dy);
        const player = this.players[i];
        if (player && player.isAlive && player.slotType === 'human' && dist > 10) {
          player.steerX = dx / dist;
          player.steerY = dy / dist;
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
        if (this.players[i] && this.players[i].slotType === 'human') {
          this.players[i].steerX = 0;
          this.players[i].steerY = 0;
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

    // Izgara zamanlayıcıları: uyarı süresi dolan kare boşluğa düşer
    for (let r = 0; r < this.gridROWS; r++) {
      for (let c = 0; c < this.gridCOLS; c++) {
        const tile = this.grid[r][c];
        if (tile.state === 1) {
          tile.timer -= dt;
          if (tile.timer <= 0) {
            tile.state = 2;
            const cx = this.offsetX + (c + 0.5) * this.cellSize;
            const cy = this.offsetY + (r + 0.5) * this.cellSize;
            this.spawnCrumble(cx, cy);
          }
        }
      }
    }

    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      if (player.jumpCooldown > 0) player.jumpCooldown -= dt;
      if (player.jumpTimer > 0) player.jumpTimer -= dt;

      if (player.slotType !== 'human') {
        updateCollapseBotAI(this, player, dt);
      } else {
        const ki = this.keyboardInput(player.index);
        if (ki.dx !== 0 || ki.dy !== 0) {
          const mag = Math.hypot(ki.dx, ki.dy) || 1;
          player.steerX = ki.dx / mag;
          player.steerY = ki.dy / mag;
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
          this.attemptJump(player);
          player.keyActionLatch = true;
        } else if (!ki.action) {
          player.keyActionLatch = false;
        }
      }

      // Havada %80 hızlı, yön değiştirilemez (kasıtlı risk)
      const spd = player.jumpTimer > 0 ? player.speed * 1.8 : player.speed;
      player.x += player.steerX * spd * dt;
      player.y += player.steerY * spd * dt;

      // Zemin etkileşimi (sadece yerdeyken; zıplarken bağışık)
      if (player.jumpTimer <= 0) {
        const cx = Math.floor((player.x - this.offsetX) / this.cellSize);
        const cy = Math.floor((player.y - this.offsetY) / this.cellSize);

        if (cx < 0 || cx >= this.gridCOLS || cy < 0 || cy >= this.gridROWS || this.grid[cy][cx].state === 2) {
          this.eliminatePlayer(player);
          continue;
        }

        if (this.grid[cy][cx].state === 0) {
          this.grid[cy][cx].state = 1;
          this.grid[cy][cx].timer = 0.8;
        }
      }
    }

    // İtme: havadakiler itişe katılmaz
    for (let i = 0; i < this.players.length; i++) {
      const p1 = this.players[i];
      if (!p1.isJoined || !p1.isAlive || p1.jumpTimer > 0) continue;

      for (let j = i + 1; j < this.players.length; j++) {
        const p2 = this.players[j];
        if (!p2.isJoined || !p2.isAlive || p2.jumpTimer > 0) continue;

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.hypot(dx, dy);
        const minDist = 18;

        if (dist < minDist && dist > 0.1) {
          const overlap = minDist - dist;
          const nx = dx / dist;
          const ny = dy / dist;
          p1.x -= nx * overlap * 0.5;
          p1.y -= ny * overlap * 0.5;
          p2.x += nx * overlap * 0.5;
          p2.y += ny * overlap * 0.5;
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

    const alive = this.players.filter((p) => p.isJoined && p.isAlive);
    if (alive.length <= 1) {
      this.handleRoundEnd(alive.length === 1 ? alive[0] : null);
    }
  }

  spawnCrumble(x, y) {
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 20 + Math.random() * 50;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd + 30, // yerçekimi etkisi
        color: '#D99B26',
        radius: 2 + Math.random() * 2,
        alpha: 1.0,
        decay: 2.0,
      });
    }
  }

  spawnVoidDust(x, y, color) {
    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 30 + Math.random() * 80;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        color: i % 2 === 0 ? color : '#FAF7F2',
        radius: 3 + Math.random() * 3,
        alpha: 1.0,
        decay: 1.8,
      });
    }
  }

  eliminatePlayer(player) {
    player.isAlive = false;
    this.addTrauma(0.45);
    playExplosion();
    this.spawnVoidDust(player.x, player.y, player.color);
  }

  handleRemoteInput(slotIndex, data) {
    const player = this.players[slotIndex];
    if (!player || !player.isJoined || !player.isAlive) return;

    if (data.action === 'JOYSTICK_MOVE' || data.action === 'MOVE') {
      const force = Number.isFinite(data.force) ? data.force : Math.hypot(data.dx || 0, data.dy || 0);
      if (force > 0.08) {
        if (Number.isFinite(data.angle)) {
          player.steerX = Math.cos(data.angle);
          player.steerY = Math.sin(data.angle);
        } else {
          const dx = Number.isFinite(data.dx) ? data.dx : 0;
          const dy = Number.isFinite(data.dy) ? data.dy : 0;
          const mag = Math.hypot(dx, dy) || 1;
          player.steerX = dx / mag;
          player.steerY = dy / mag;
        }
        player.remoteActive = true;
      } else {
        player.steerX = 0;
        player.steerY = 0;
        player.remoteActive = false;
      }
    } else if (data.action === 'DASH' || data.action === 'JUMP') {
      this.attemptJump(player);
    }
  }

  handleRoundEnd(winner) {
    this.state = 'ROUND_OVER';
    this.roundWinner = winner;
    this.roundTransitionTimer = 2.5;
    if (winner) {
      this.scores[winner.index]++;
      if (this.scores[winner.index] >= this.targetScore) {
        this.matchWinner = winner;
      }
    }
  }

  render() {
    const { ctx, canvas } = this;
    ctx.save();

    // Arka plan boşluk rengi (koyu)
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.applyScreenShake(ctx);

    if (this.state === 'PLAYING' || this.state === 'ROUND_OVER') {
      renderCornerScores(ctx, { arena: this.arena, entries: this.players.map((p) => p.isJoined ? { color: p.color, text: `${this.scores[p.index]}★` } : null) });
    }

    // Izgara zemini
    for (let r = 0; r < this.gridROWS; r++) {
      for (let c = 0; c < this.gridCOLS; c++) {
        const tile = this.grid[r][c];
        if (tile.state === 2) continue;

        const tx = this.offsetX + c * this.cellSize;
        const ty = this.offsetY + r * this.cellSize;
        const padding = 1.5;

        let wobbleX = 0, wobbleY = 0;
        if (tile.state === 0) {
          ctx.fillStyle = '#FAF7F2';
        } else {
          // Uyarı: sarıdan kırmızıya + çatlama titremesi
          const ratio = Math.max(0, Math.min(1, tile.timer / 0.8));
          ctx.fillStyle = `rgb(255, ${Math.floor(ratio * 200)}, 50)`;
          wobbleX = (Math.random() - 0.5) * 2.5;
          wobbleY = (Math.random() - 0.5) * 2.5;
        }

        ctx.fillRect(tx + padding + wobbleX, ty + padding + wobbleY, this.cellSize - padding * 2, this.cellSize - padding * 2);

        if (tile.state === 1) {
          ctx.strokeStyle = 'rgba(26,26,26,0.7)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(tx + padding + wobbleX + 3, ty + padding + wobbleY + 3);
          ctx.lineTo(tx + this.cellSize * 0.5 + wobbleX, ty + this.cellSize * 0.55 + wobbleY);
          ctx.lineTo(tx + this.cellSize - padding - 3 + wobbleX, ty + this.cellSize - padding - 3 + wobbleY);
          ctx.stroke();
        }
      }
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

    // Oyuncular (zıplayan büyür + gölgelenir)
    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      const isJumping = player.jumpTimer > 0;
      const scale = isJumping ? 1.4 : 1.0;
      const shadowOffset = isJumping ? 10 : 2;

      ctx.save();
      ctx.translate(player.x, player.y);

      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath(); ctx.arc(shadowOffset, shadowOffset, 9 * scale, 0, Math.PI * 2); ctx.fill();

      ctx.scale(scale, scale);
      ctx.fillStyle = player.color;
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#1A1A1A'; ctx.stroke();

      ctx.restore();
    }

    // Lokal dokunmatik joystick göstergesi
    if (this.state === 'PLAYING' && this.isLocalInputActive) {
      for (let i = 0; i < 4; i++) {
        const t = this.touches[i];
        if (t.active) {
          ctx.beginPath(); ctx.arc(t.cx, t.cy, 30, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 3; ctx.stroke();
          ctx.beginPath(); ctx.arc(t.jx, t.jy, 15, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fill();
        }
      }
    }

    this.uiButtons = [];
    if (this.state === 'LOBBY') {
      renderControlGuide(ctx, this.arena, 'JOYSTICK: HAREKET ET • AKSİYON: ZIPLA • DÜŞEN ZEMİNLERE DİKKAT', [
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
          playerColor: COLLAPSE_COLORS[i],
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
      renderRoundBanner(ctx, { arena: this.arena, title: this.roundWinner ? `${this.roundWinner.name} KAZANDI!` : 'BERABERE!', titleColor: this.roundWinner ? this.roundWinner.color : '#FFFFFF' });
    } else if (this.state === 'MATCH_OVER') {
      renderMatchOver(ctx, { arena: this.arena, uiButtons: this.uiButtons, headline: 'ÇÖKÜŞ ŞAMPİYONU', winnerName: this.matchWinner ? this.matchWinner.name : '', winnerColor: this.matchWinner ? this.matchWinner.color : '#FFFFFF', rows: this.players.filter((p) => p.isJoined).map((p) => ({ color: p.color, text: `${p.name}: ${this.scores[p.index]}★` })), onRestart: () => this.startNewMatch() });
    }
    ctx.restore();
  }
}
