// BRUTAL NINJA: 2-4 oyunculu gölge avı — durunca görünmez ol, kılıç atılmasıyla
// tek vuruşta ele. Siper kutuları pusuya yatmaya yarar.

import { playExplosion, playStart, playJoin, playItemPickup } from '../audio.js';
import { renderControlGuide, renderLobbySeatCard, getStandardSeatRects, renderLobbyStartButton } from '../controlGuide.js';
import { renderCornerScores, renderRoundBanner, renderMatchOver } from '../ui/hud.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { updateNinjaBotAI } from '../ai/ninjaAI.js';
import { drawBrutalAvatar } from '../ui/characterRenderer.js';

export const NINJA_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
export const NINJA_NAMES = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'];

const NINJA_KEY_SLOTS = [
  { u: 'KeyW', d: 'KeyS', l: 'KeyA', r: 'KeyD', action: 'Space', smoke: 'KeyE' },
  { u: 'ArrowUp', d: 'ArrowDown', l: 'ArrowLeft', r: 'ArrowRight', action: 'Enter', smoke: 'ShiftRight' },
  { u: 'KeyI', d: 'KeyK', l: 'KeyJ', r: 'KeyL', action: 'KeyO', smoke: 'KeyU' },
  { u: 'KeyT', d: 'KeyG', l: 'KeyF', r: 'KeyH', action: 'KeyB', smoke: 'KeyV' },
];

const NINJA_STRIKE_COOLDOWN = 1.3;
const NINJA_SMOKE_COOLDOWN = 5.0;
const NINJA_RADIUS = 18;

export class NinjaGame extends BaseMiniGame {
  constructor(canvas) {
    super(canvas);
    this.arena = { cx: 0, cy: 0, size: 0, left: 0, right: 0, top: 0, bottom: 0 };
    this.slotTypes = ['human', 'bot_normal', 'empty', 'empty'];
    this.scores = [0, 0, 0, 0];
    this.targetScore = 5;
    this.players = [];
    this.obstacles = [];
    this.lanterns = [];
    this.footsteps = [];
    this.particles = [];
    this.roundTime = 40;
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
    const map = NINJA_KEY_SLOTS[index];
    if (!map) return { dx: 0, dy: 0, action: false, smoke: false };
    const dx = (this.keys[map.r] ? 1 : 0) - (this.keys[map.l] ? 1 : 0);
    const dy = (this.keys[map.d] ? 1 : 0) - (this.keys[map.u] ? 1 : 0);
    return { dx, dy, action: !!this.keys[map.action], smoke: !!this.keys[map.smoke] };
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

    // Maç ortası resize ışınlamaz: geometri yenilenir, oyuncular orantılı taşınır
    if (this.state === 'LOBBY' || !this.players.length) {
      this.initPlayers();
      return;
    }
    for (const p of this.players) this.remapPoint(p, oldArena, this.arena);
  }

  buildMap() {
    this.obstacles = [];
    this.lanterns = [];
    const { cx, cy, size } = this.arena;
    const bw = size * 0.18;

    // Pusu kurmalık 4 ana tapınak sütunu + merkez siper
    this.obstacles.push(
      { x: cx - bw * 1.3 - bw / 2, y: cy - bw * 0.9 - bw / 2, w: bw, h: bw },
      { x: cx + bw * 1.3 - bw / 2, y: cy - bw * 0.9 - bw / 2, w: bw, h: bw },
      { x: cx - bw * 1.3 - bw / 2, y: cy + bw * 0.9 - bw / 2, w: bw, h: bw },
      { x: cx + bw * 1.3 - bw / 2, y: cy + bw * 0.9 - bw / 2, w: bw, h: bw },
      { x: cx - bw * 0.35, y: cy - bw * 0.35, w: bw * 0.7, h: bw * 0.7 }
    );

    // 2 adet dinamik devriye gezen ışık feneri (ışık konisi sürekli sahayı tarar)
    this.lanterns.push(
      {
        baseX: cx,
        baseY: cy - bw * 1.05,
        x: cx,
        y: cy - bw * 1.05,
        radius: bw * 0.95,
        speed: 1.15,
        phase: 0,
        rangeX: bw * 1.55,
        rangeY: bw * 0.35,
      },
      {
        baseX: cx,
        baseY: cy + bw * 1.05,
        x: cx,
        y: cy + bw * 1.05,
        radius: bw * 0.95,
        speed: 1.3,
        phase: Math.PI,
        rangeX: bw * 1.55,
        rangeY: bw * 0.35,
      }
    );
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
        index: i, name: existing?.name || NINJA_NAMES[i], color: NINJA_COLORS[i],
        x: s.x, y: s.y, angle: 0,
        speed: 145, steerX: 0, steerY: 0,
        isAlive: true, isJoined: this.isSlotJoined(i), slotType: this.slotTypes[i],
        alpha: 1.0, hideTimer: 0, inLight: false,
        strikeTimer: 0, strikeCooldown: 0,
        smokeTimer: 0, smokeCooldown: 0,
        botState: 'HIDE', botTimer: 0.5, botTargetX: s.x, botTargetY: s.y,
        keyActionLatch: false, keySmokeLatch: false,
      };
    });
  }

  resetMatch() {
    this.state = 'LOBBY';
    this.scores = [0, 0, 0, 0];
    this.roundWinner = null;
    this.matchWinner = null;
    this.roundTransitionTimer = 0;
    this.particles = [];
    this.footsteps = [];
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
    this.roundTime = 45;
    this.particles = [];
    this.footsteps = [];
    this.onTouchesReset();
    playStart();

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
      player.alpha = 1.0;
      player.hideTimer = 0;
      player.inLight = false;
      player.strikeTimer = 0;
      player.strikeCooldown = 0;
      player.smokeTimer = 0;
      player.smokeCooldown = 0;
      player.steerX = 0;
      player.steerY = 0;
      player.botState = 'HIDE';
      player.botTimer = 0.5;
    });
  }

  attemptStrike(player) {
    if (this.state !== 'PLAYING') return;
    if (player.strikeCooldown <= 0) {
      player.strikeTimer = 0.22;
      player.strikeCooldown = NINJA_STRIKE_COOLDOWN;
      player.alpha = 1.0;
      player.hideTimer = 0;
      playItemPickup();
      this.spawnSlashTrail(player.x, player.y, player.angle, player.color);
    }
  }

  attemptSmoke(player) {
    if (this.state !== 'PLAYING') return;
    if (player.smokeCooldown <= 0) {
      player.smokeCooldown = NINJA_SMOKE_COOLDOWN;
      player.smokeTimer = 2.2;
      player.alpha = 0.0;
      player.hideTimer = 1.0;
      playExplosion();
      this.spawnSmoke(player.x, player.y, '#333333', 35);
      this.addTrauma(0.18);
    }
  }

  spawnSmoke(x, y, color) {
    for (let i = 0; i < 22; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 20 + Math.random() * 90;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        color: i % 2 === 0 ? color : '#333333',
        radius: 4 + Math.random() * 5,
        alpha: 0.9,
        decay: 1.6,
      });
    }
  }

  spawnSlashTrail(x, y, angle, color) {
    for (let i = 0; i < 10; i++) {
      const pAngle = angle + (Math.random() - 0.5) * 0.8;
      const spd = 70 + Math.random() * 110;
      this.particles.push({
        x: x + Math.cos(angle) * 12,
        y: y + Math.sin(angle) * 12,
        vx: Math.cos(pAngle) * spd,
        vy: Math.sin(pAngle) * spd,
        color: '#FFFFFF',
        radius: 2 + Math.random() * 2,
        alpha: 1.0,
        decay: 3.5,
      });
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
        this.attemptStrike(player);
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
          player.angle = Math.atan2(dy, dx);
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

  spawnFootstep(x, y) {
    if (this.footsteps.length > 40) this.footsteps.shift();
    this.footsteps.push({ x, y, alpha: 0.45 });
  }

  update(now) {
    const dt = Math.min((now - this.lastTime) / 1000, 0.08);
    this.lastTime = now;

    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 2.2);
    }

    // Ayak izleri güncellemesi
    for (let i = this.footsteps.length - 1; i >= 0; i--) {
      const f = this.footsteps[i];
      f.alpha -= dt * 1.1;
      if (f.alpha <= 0) this.footsteps.splice(i, 1);
    }

    if (this.state === 'ROUND_OVER') {
      this.roundTransitionTimer -= dt;
      if (this.roundTransitionTimer <= 0) {
        this.matchWinner ? this.state = 'MATCH_OVER' : this.startRound();
      }
      return;
    }

    if (this.state !== 'PLAYING') return;

    // Hareketli Devriye Fenerleri: Işık konisi sahada yumuşakça devriye gezer
    const timeSec = now / 1000;
    for (const lantern of this.lanterns) {
      if (lantern.baseX !== undefined) {
        lantern.x = lantern.baseX + Math.sin(timeSec * lantern.speed + lantern.phase) * lantern.rangeX;
        lantern.y = lantern.baseY + Math.cos(timeSec * lantern.speed * 1.4 + lantern.phase) * lantern.rangeY;
      }
    }

    this.roundTime -= dt;
    if (this.roundTime <= 0) {
      const alivePlayers = this.players.filter((p) => p.isJoined && p.isAlive);
      this.handleRoundEnd(alivePlayers.length === 1 ? alivePlayers[0] : null);
      return;
    }

    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      if (player.strikeCooldown > 0) player.strikeCooldown -= dt;
      if (player.strikeTimer > 0) player.strikeTimer -= dt;
      if (player.smokeCooldown > 0) player.smokeCooldown -= dt;

      if (player.slotType !== 'human') {
        updateNinjaBotAI(this, player, dt);
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
          this.attemptStrike(player);
          player.keyActionLatch = true;
        } else if (!ki.action) {
          player.keyActionLatch = false;
        }

        if (ki.smoke && !player.keySmokeLatch) {
          this.attemptSmoke(player);
          player.keySmokeLatch = true;
        } else if (!ki.smoke) {
          player.keySmokeLatch = false;
        }
      }

      // Fener ışık kontrolü
      let inLight = false;
      for (const lantern of this.lanterns) {
        if (Math.hypot(player.x - lantern.x, player.y - lantern.y) < lantern.radius) {
          inLight = true;
          break;
        }
      }
      player.inLight = inLight;

      const isMoving = player.steerX !== 0 || player.steerY !== 0 || player.strikeTimer > 0;

      // Görünmezlik: Durunca TAM 0.0'a iner (TAM GÖRÜNMEZLİK!)
      if (player.smokeTimer > 0) {
        player.smokeTimer -= dt;
        player.alpha = 0.0;
      } else if (inLight) {
        // Fener ışığında ninja ifşa olur
        player.alpha = Math.min(1.0, player.alpha + dt * 6.0);
        player.hideTimer = 0;
      } else if (isMoving) {
        player.hideTimer = 0;
        player.alpha = Math.min(1.0, player.alpha + dt * 4.5);
        if (Math.random() < 0.22) {
          this.spawnFootstep(player.x, player.y);
        }
      } else {
        player.hideTimer += dt;
        if (player.hideTimer > 0.2) {
          player.alpha = Math.max(0.0, player.alpha - dt * 3.5);
        }
      }

      const spd = player.strikeTimer > 0 ? 600 : player.speed;

      if (player.strikeTimer <= 0) {
        player.x += player.steerX * spd * dt;
        player.y += player.steerY * spd * dt;
      } else {
        player.x += Math.cos(player.angle) * spd * dt;
        player.y += Math.sin(player.angle) * spd * dt;
      }

      const r = NINJA_RADIUS;
      player.x = Math.max(this.arena.left + r, Math.min(this.arena.right - r, player.x));
      player.y = Math.max(this.arena.top + r, Math.min(this.arena.bottom - r, player.y));

      // Siper kutuları
      for (const obs of this.obstacles) {
        const minX = obs.x - r;
        const maxX = obs.x + obs.w + r;
        const minY = obs.y - r;
        const maxY = obs.y + obs.h + r;

        if (player.x > minX && player.x < maxX && player.y > minY && player.y < maxY) {
          const dists = [
            Math.abs(player.x - minX), Math.abs(player.x - maxX),
            Math.abs(player.y - minY), Math.abs(player.y - maxY),
          ];
          const minD = Math.min(...dists);
          if (minD === dists[0]) player.x = minX;
          else if (minD === dists[1]) player.x = maxX;
          else if (minD === dists[2]) player.y = minY;
          else player.y = maxY;

          if (player.strikeTimer > 0) player.strikeTimer = 0;
        }
      }
    }

    // Kılıç isabeti: atılan + 38px içindekini eler
    for (const attacker of this.players) {
      if (!attacker.isJoined || !attacker.isAlive || attacker.strikeTimer <= 0) continue;

      for (const victim of this.players) {
        if (!victim.isJoined || !victim.isAlive || victim.index === attacker.index) continue;

        if (Math.hypot(attacker.x - victim.x, attacker.y - victim.y) < 38) {
          victim.isAlive = false;
          attacker.strikeTimer = 0;
          this.scores[attacker.index]++;
          this.addTrauma(0.45);
          playExplosion();
          this.spawnSmoke(victim.x, victim.y, victim.color, 28);
          if (this.scores[attacker.index] >= this.targetScore) {
            this.matchWinner = attacker;
          }
          break;
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
    } else if (data.action === 'DASH' || data.action === 'STRIKE') {
      this.attemptStrike(player);
    } else if (data.action === 'NINJA_SMOKE') {
      this.attemptSmoke(player);
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

  render() {
    const { ctx, canvas } = this;
    ctx.save();

    ctx.fillStyle = '#D6D3CD';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.applyScreenShake(ctx);

    const { left, top, width, height } = this.arena;
    ctx.fillStyle = '#E8E5DF';
    ctx.fillRect(left, top, width, height);

    // Ayak izleri (karanlıkta ninjanın yönünü ele verir)
    for (const f of this.footsteps) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, f.alpha));
      ctx.fillStyle = '#9C988F';
      ctx.beginPath();
      ctx.arc(f.x, f.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Fenerler ve Aydınlatma Alanı
    for (const lantern of this.lanterns) {
      // Işık halesi (fenerin aydınlattığı bölge: sarı transparan)
      ctx.save();
      const grad = ctx.createRadialGradient(lantern.x, lantern.y, 10, lantern.x, lantern.y, lantern.radius);
      grad.addColorStop(0, 'rgba(255, 215, 0, 0.28)');
      grad.addColorStop(0.7, 'rgba(255, 215, 0, 0.12)');
      grad.addColorStop(1, 'rgba(255, 215, 0, 0.0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(lantern.x, lantern.y, lantern.radius, 0, Math.PI * 2);
      ctx.fill();

      // İnce altın halka sınırı
      ctx.strokeStyle = 'rgba(217, 155, 38, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();

      // Fener kaidesi (🏮)
      ctx.fillStyle = '#1A1A1A';
      ctx.fillRect(lantern.x - 11, lantern.y - 11, 22, 22);
      ctx.fillStyle = '#FFD700';
      ctx.beginPath();
      ctx.arc(lantern.x, lantern.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (this.state === 'PLAYING' || this.state === 'ROUND_OVER') {
      renderCornerScores(ctx, { arena: this.arena, entries: this.players.map((p) => p.isJoined ? { color: p.color, text: `${this.scores[p.index]}★` } : null) });
    }

    // Siper kutuları (Tapınak taşları)
    ctx.fillStyle = '#1A1A1A';
    for (const obs of this.obstacles) {
      ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
      ctx.strokeStyle = '#3A3A3A';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(obs.x + 4, obs.y + 4, obs.w - 8, obs.h - 8);
    }

    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 6;
    ctx.strokeRect(left, top, width, height);

    // Oyuncular (Görünmezlik alphası ile)
    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      // Tamamen görünmezken (alpha === 0):
      // Yalnızca lokal ekranda oynayan kendi ninjasını hafifçe görsün (zen odak noktası)
      if (player.alpha <= 0.02) {
        if (player.slotType === 'human' && this.isLocalInputActive) {
          ctx.save();
          ctx.globalAlpha = 0.22;
          ctx.strokeStyle = player.color;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.arc(player.x, player.y, NINJA_RADIUS, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        continue;
      }

      ctx.save();
      ctx.globalAlpha = player.alpha;
      ctx.translate(player.x, player.y);
      ctx.rotate(player.angle);

      // Kılıç savurma efekti (Slash arc)
      if (player.strikeTimer > 0) {
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(0, 0, 36, -0.7, 0.7);
        ctx.lineTo(12, 0);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = '#1A1A1A';
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      drawBrutalAvatar(ctx, 0, 0, NINJA_RADIUS, {
        color: player.color,
        slotIndex: player.index,
        facingAngle: 0, // already translated and rotated to player.angle
        label: `P${player.index + 1}`,
        expression: player.strikeTimer > 0 ? 'angry' : 'normal',
        accessory: 'headband',
        showPointer: true,
        borderColor: '#1A1A1A',
        borderWidth: 2.5,
      });

      ctx.restore();
    }

    // Parçacıklar (Duman / Darbe)
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Geri sayım filigranı
    if (this.state === 'PLAYING' && this.roundTime <= 15) {
      ctx.save();
      ctx.font = 'bold 36px monospace';
      ctx.fillStyle = this.roundTime <= 5 ? '#E63946' : 'rgba(26,26,26,0.3)';
      ctx.textAlign = 'center';
      ctx.fillText(Math.ceil(this.roundTime), this.arena.cx, this.arena.top + 45);
      ctx.restore();
    }

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
      renderControlGuide(ctx, this.arena, 'JOYSTICK: HAREKET ET • DUR VE GÖRÜNMEZ OL • AKSİYON: KILIÇ ÇEK', [
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
          playerColor: NINJA_COLORS[i],
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
      renderRoundBanner(ctx, { arena: this.arena, title: this.roundWinner ? `${this.roundWinner.name} KAZANDI!` : 'BERABERE!', titleColor: this.roundWinner ? this.roundWinner.color : '#1A1A1A' });
    } else if (this.state === 'MATCH_OVER') {
      renderMatchOver(ctx, { arena: this.arena, uiButtons: this.uiButtons, headline: 'GÖLGE ŞAMPİYONU', winnerName: this.matchWinner ? this.matchWinner.name : '', winnerColor: this.matchWinner ? this.matchWinner.color : '#1A1A1A', rows: this.players.filter((p) => p.isJoined).map((p) => ({ color: p.color, text: `${p.name}: ${this.scores[p.index]}★` })), onRestart: () => this.startNewMatch() });
    }
    ctx.restore();
  }
}
