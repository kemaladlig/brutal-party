// BRUTAL ARCHERY: 2-4 oyunculu okçuluk arenası — serbest hareket, basılı tutarak
// yay ger, bırakınca ok at. Nişan = bakış yönü + salınım (tam geriş daha stabil).
// Yakın mesafe vuruş 2 puan, uzak vuruş 1 puan. 60sn raundu en çok puanla bitiren
// raundu alır; 2 raund alan şampiyon.
import { getSlotCustomization, getBotPersona } from '../core/customizationManager.js';
import { playExplosion, playStart, playJoin, playItemPickup, playTeleport, playDashWhoosh, playPowerUp } from '../audio.js';
import { t } from '../i18n.js';
import { renderArenaWatermarkTimer } from '../ui/hud.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { updateArcherBotAI } from '../ai/archerAI.js';
import { drawGameAvatar } from '../core/avatarInGame.js';
import { drawObstacle, drawPickup, buildLayout } from '../core/arenaKit.js';
import { readSlotKeys } from '../core/inputMaps.js';
import { lobbyCenterStartTap, lobbyQuadrantTap, matchOverRestartTap } from '../core/touchFlow.js';
import { pointBlocked, updateMovers, clampToArena, resolveAABB } from '../core/physics2d.js';
import { spawnPickup, collectPickups, tickPickupTimers } from '../core/pickupSystem.js';

export const ARCHER_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
export const ARCHER_NAMES = ['P1', 'P2', 'P3', 'P4'];

const ARCHER_RADIUS = 18;
const ARCHER_SPEED = 150;
const ARCHER_CHARGE_TIME = 1.0;
const ARCHER_SHOT_COOLDOWN = 0.8;
const ARCHER_ROUND_TIME = 60;
const ARCHER_CLOSE_DIST = 150;
const ARCHER_ARROW_LIFE = 1.1;
const ARCHER_PICKUP_TYPES = ['TURBO', 'TELEPORT', 'SLIP', 'MULTI', 'QUICKDRAW', 'SHIELD'];

export class ArcherGame extends BaseMiniGame {
  constructor(canvas) {
    super(canvas);
    this.arena = { cx: 0, cy: 0, size: 0, left: 0, right: 0, top: 0, bottom: 0 };
    this.slotTypes = ['human', 'bot_normal', 'empty', 'empty'];
    this.scores = [0, 0, 0, 0];
    this.roundWins = [0, 0, 0, 0];
    this.roundsToWin = 2;
    this.players = [];
    this.arrows = [];
    this.obstacles = [];
    this.particles = [];
    this.roundTime = ARCHER_ROUND_TIME;
    this.roundTimer = ARCHER_ROUND_TIME;
    this.pickups = [];
    this.pickupTimer = 8.0;
    this.mapIndex = 0;
    this.mapTime = 0;
    this.keys = {};
    this.roundTransitionTimer = 0;

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
    this.updateViewport(width, height);
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
    for (const a of this.arrows) this.remapPoint(a, oldArena, this.arena);
  }

  buildMap() {
    this.mapTime = 0;
    const presetNames = ['pillars', 'cross', 'scatter'];
    const name = presetNames[this.mapIndex] || 'pillars';
    this.obstacles = buildLayout(name, this.arena);
  }

  updateMovers(dt) {
    updateMovers(this.obstacles, dt, 'sine');
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
      const custom = getSlotCustomization(i);
      const isBot = this.slotTypes[i] === 'bot_normal' || this.slotTypes[i] === 'bot_god';
      const isGod = this.slotTypes[i] === 'bot_god';
      const persona = isBot ? getBotPersona(i, isGod) : null;
      return {
        index: i,
        name: existing?.name || (isBot ? persona.name : `P${i + 1}`),
        color: isBot ? persona.color : (custom.color || ARCHER_COLORS[i]),
        x: s.x, y: s.y, angle: 0,
        speed: ARCHER_SPEED, steerX: 0, steerY: 0,
        isAlive: true, isJoined: this.isSlotJoined(i), slotType: this.slotTypes[i],
        charging: false, charge: 0, shotCooldown: 0,
        swayPhase: Math.random() * Math.PI * 2,
        stun: 0, spawnProt: 0,
        turboTimer: 0, quickdrawTimer: 0, multiShots: 0, shield: 0, slipTimer: 0,
        botTimer: 0.5, botTargetX: s.x, botTargetY: s.y, botStrafe: 1,
      };
    });
  }

  resetMatch() {
    this.state = 'LOBBY';
    this.scores = [0, 0, 0, 0];
    this.roundWins = [0, 0, 0, 0];
    this.roundWinner = null;
    this.matchWinner = null;
    this.roundTransitionTimer = 0;
    this.arrows = [];
    this.particles = [];
    this.pickups = [];
    this.mapIndex = 0;
    this.buildMap();
    this.initPlayers();
    this.onTouchesReset();
  }

  reset() {
    this.resetMatch();
  }

  startNewMatch() {
    this.scores = [0, 0, 0, 0];
    this.roundWins = [0, 0, 0, 0];
    this.matchWinner = null;
    this.startRound();
  }

  startNewRound() {
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
    this.roundTime = ARCHER_ROUND_TIME;
    this.roundTimer = ARCHER_ROUND_TIME;
    this.arrows = [];
    this.particles = [];
    this.pickups = [];
    this.pickupTimer = 8.0;
    // Raund başına rastgele harita
    this.mapIndex = Math.floor(Math.random() * 3);
    this.buildMap();
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
      player.steerX = 0;
      player.steerY = 0;
      player.charging = false;
      player.charge = 0;
      player.shotCooldown = 0;
      player.stun = 0;
      player.spawnProt = 1.0;
      player.turboTimer = 0;
      player.quickdrawTimer = 0;
      player.multiShots = 0;
      player.shield = 0;
      player.slipTimer = 0;
      player.botTimer = 0.5;
    });
  }

  beginCharge(player) {
    if (this.state !== 'PLAYING') return;
    if (!player.isJoined || !player.isAlive) return;
    if (player.stun > 0 || player.shotCooldown > 0) return;
    player.charging = true;
  }

  looseArrow(player) {
    if (this.state !== 'PLAYING') {
      player.charging = false;
      player.charge = 0;
      return;
    }
    if (!player.charging) return;
    player.charging = false;
    if (!player.isJoined || !player.isAlive || player.stun > 0) {
      player.charge = 0;
      return;
    }
    const charge = player.charge;
    player.charge = 0;
    if (charge < 0.08) return;
    player.shotCooldown = ARCHER_SHOT_COOLDOWN;

    const aim = this.aimAngle(player);
    const speed = 300 + 420 * charge;
    const shots = player.multiShots > 0 ? 3 : 1;
    if (player.multiShots > 0) player.multiShots -= 1;
    for (let s = 0; s < shots; s++) {
      const spread = shots === 1 ? 0 : (s - 1) * 0.16;
      const ang = aim + spread;
      this.arrows.push({
        x: player.x + Math.cos(ang) * (ARCHER_RADIUS + 6),
        y: player.y + Math.sin(ang) * (ARCHER_RADIUS + 6),
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        owner: player.index,
        color: player.color,
        dist: 0,
        life: ARCHER_ARROW_LIFE,
        power: charge,
      });
    }
    playItemPickup();
  }

  aimAngle(player) {
    const wobble = 0.03 + 0.12 * (1 - player.charge);
    return player.angle + Math.sin(player.swayPhase) * wobble;
  }

  spawnHitBurst(x, y, color, big) {
    const n = big ? 20 : 12;
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 60 + Math.random() * 160;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        color: i % 3 === 0 ? '#FFFFFF' : color,
        radius: 2 + Math.random() * 3,
        alpha: 1.0,
        decay: 2.6,
      });
    }
  }

  spawnPickup() {
    spawnPickup(this, {
      types: ARCHER_PICKUP_TYPES,
      max: 2,
      obstacles: this.obstacles,
      pad: 0,
    });
  }

  applyPickup(player, pk) {
    playItemPickup();
    if (pk.type === 'TURBO') {
      player.turboTimer = 3.5;
      playPowerUp();
    } else if (pk.type === 'TELEPORT') {
      const { left, right, top, bottom, size } = this.arena;
      const pad = size * 0.16;
      const corners = [
        { x: left + pad, y: top + pad },
        { x: right - pad, y: top + pad },
        { x: left + pad, y: bottom - pad },
        { x: right - pad, y: bottom - pad },
      ];
      let best = corners[0];
      let bestD = -1;
      for (const c of corners) {
        const d = Math.hypot(c.x - player.x, c.y - player.y);
        if (d > bestD) { bestD = d; best = c; }
      }
      player.x = best.x;
      player.y = best.y;
      playTeleport();
    } else if (pk.type === 'SLIP') {
      player.slipTimer = 0.55;
      playDashWhoosh();
    } else if (pk.type === 'MULTI') {
      player.multiShots += 3;
      playPowerUp();
    } else if (pk.type === 'QUICKDRAW') {
      player.quickdrawTimer = 8.0;
      playPowerUp();
    } else if (pk.type === 'SHIELD') {
      player.shield = 1;
      playPowerUp();
    }
  }

  getTabletopSchema() {
    return {
      joystick: true,
      actions: [
        // keyHint verilmedi: rozet slot başına doğru aksiyon tuşunu gösterir (SPACE/ENTER/O/B)
        { id: 'action', icon: '🏹', holdToCharge: true, chargeField: 'charge' },
      ],
    };
  }

  handleSlotAction(slotIndex, actionId, isDown) {
    const player = this.players[slotIndex];
    if (!player || !player.isJoined || !player.isAlive) return;
    if (actionId === 'action') {
      if (isDown) {
        this.beginCharge(player);
      } else {
        this.looseArrow(player);
      }
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
      if (this.handleUiTap(touch)) return;
      if (this.handleTabletopTouchStart(touch)) return;
    }
  }

  onTouchMove(touch) {
    if (this.state !== 'PLAYING') return;
    this.handleTabletopTouchMove(touch);
  }

  onTouchEnd(touch) {
    this.handleTabletopTouchEnd(touch);
  }

  onTouchesReset() {
    this.resetTabletopTouches();
    this.players.forEach((p) => { p.steerX = 0; p.steerY = 0; p.charging = false; p.charge = 0; });
  }

  pointBlocked(x, y) {
    return pointBlocked(x, y, this.obstacles, 0);
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

    this.roundTime -= dt;
    this.roundTimer = Math.max(0, this.roundTime);
    if (this.roundTime <= 0) {
      this.handleRoundEnd(null);
      return;
    }

    this.updateMovers(dt);

    // Power-up spawn ritmi (bomb gibi: 8-12sn, max 2)
    this.pickupTimer -= dt;
    if (this.pickupTimer <= 0 && this.pickups.length < 2) {
      this.spawnPickup();
      this.pickupTimer = 8.0 + Math.random() * 4.0;
    }
    tickPickupTimers(this, dt);

    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      if (player.shotCooldown > 0) player.shotCooldown -= dt;
      if (player.stun > 0) player.stun -= dt;
      if (player.spawnProt > 0) player.spawnProt -= dt;
      if (player.turboTimer > 0) player.turboTimer -= dt;
      if (player.quickdrawTimer > 0) player.quickdrawTimer -= dt;
      if (player.slipTimer > 0) player.slipTimer -= dt;
      player.swayPhase += dt * (4 + 6 * (1 - player.charge));

      if (player.slotType !== 'human') {
        updateArcherBotAI(this, player, dt);
      } else {
        const ki = this.keyboardInput(player.index);
        const joy = this.joysticks[player.index];
        if (joy && joy.active && joy.force > 0.08) {
          player.steerX = Math.cos(joy.angle) * joy.force;
          player.steerY = Math.sin(joy.angle) * joy.force;
          player.angle = joy.angle;
        } else if (ki.dx !== 0 || ki.dy !== 0) {
          const mag = Math.hypot(ki.dx, ki.dy) || 1;
          player.steerX = ki.dx / mag;
          player.steerY = ki.dy / mag;
          player.angle = Math.atan2(ki.dy, ki.dx);
        } else if (!player.remoteActive) {
          player.steerX = 0;
          player.steerY = 0;
        }

        // Yay: klavye geçiş-temelli (latch) — uzak oyuncunun charging'ini yerel
        // tuş yokken boş frame'de iptal etmez; masa-ortası butonu basılıysa korur
        if (ki.action) {
          if (!player.keyActionLatch) {
            this.beginCharge(player);
            player.keyActionLatch = true;
          }
        } else if (player.keyActionLatch) {
          player.keyActionLatch = false;
          if (!this.tabletopActionState[player.index]?.action) {
            this.looseArrow(player);
          }
        }
      }

      if (player.charging) {
        // QUICKDRAW: 1.2s→0.35s çekiliş
        const chargeTime = player.quickdrawTimer > 0 ? 0.35 : ARCHER_CHARGE_TIME;
        player.charge = Math.min(1, player.charge + dt / chargeTime);
      }

      // Yay gererken yavaş hareket (klasik okçu cezası) · TURBO hızlandırır · SLIP kontrolsüz kaydırır
      const spd = player.stun > 0 ? 0 : player.speed * (player.charging ? 0.45 : 1);
      if (player.stun > 0) {
        // sersemken hareket yok
      } else if (player.slipTimer > 0) {
        const slipSpeed = Math.max(spd, 320) * (player.turboTimer > 0 ? 1.55 : 1);
        player.x += Math.cos(player.angle) * slipSpeed * dt;
        player.y += Math.sin(player.angle) * slipSpeed * dt;
      } else {
        let moveSpd = spd;
        if (player.turboTimer > 0) moveSpd *= 1.55;
        player.x += player.steerX * moveSpd * dt;
        player.y += player.steerY * moveSpd * dt;
      }

      clampToArena(player, ARCHER_RADIUS, this.arena);
      resolveAABB(player, this.obstacles, ARCHER_RADIUS);
    }

    // Oklar
    for (let ai = this.arrows.length - 1; ai >= 0; ai--) {
      const a = this.arrows[ai];
      const step = Math.hypot(a.vx, a.vy) * dt;
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.dist += step;
      a.life -= dt;

      let dead = a.life <= 0;
      dead = dead || a.x < this.arena.left || a.x > this.arena.right || a.y < this.arena.top || a.y > this.arena.bottom;
      if (!dead && this.pointBlocked(a.x, a.y)) {
        this.spawnHitBurst(a.x, a.y, '#9C988F', false);
        dead = true;
      }

      if (!dead) {
        for (const victim of this.players) {
          if (!victim.isJoined || !victim.isAlive || victim.index === a.owner) continue;
          if (victim.spawnProt > 0) continue;
          if (Math.hypot(a.x - victim.x, a.y - victim.y) < ARCHER_RADIUS + 6) {
            // KALKAN bir ok emer: skor/stun yok
            if (victim.shield > 0) {
              victim.shield -= 1;
              this.spawnHitBurst(victim.x, victim.y, '#06B6D4', true);
              playExplosion();
              dead = true;
              break;
            }
            const close = a.dist < ARCHER_CLOSE_DIST;
            const pts = close ? 2 : 1;
            this.scores[a.owner] += pts;
            // Yakın mesafede stun çok kısa (spam kilitlenmesin), uzakta tam stun
            const stunDur = a.dist < 110 ? 0.12 : (close ? 0.3 : 0.8);
            victim.stun = Math.max(victim.stun, stunDur);
            victim.charging = false;
            victim.charge = 0;
            const kx = victim.x - a.x;
            const ky = victim.y - a.y;
            const kd = Math.hypot(kx, ky) || 1;
            victim.x = Math.max(this.arena.left + ARCHER_RADIUS, Math.min(this.arena.right - ARCHER_RADIUS, victim.x + (kx / kd) * 26));
            victim.y = Math.max(this.arena.top + ARCHER_RADIUS, Math.min(this.arena.bottom - ARCHER_RADIUS, victim.y + (ky / kd) * 26));
            this.spawnHitBurst(victim.x, victim.y, victim.color, close);
            this.addTrauma(close ? 0.45 : 0.25);
            playExplosion();
            dead = true;
            break;
          }
        }
      }

      if (dead) this.arrows.splice(ai, 1);
    }

    // Power-up toplama
    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;
      collectPickups(this, player, {
        radiusOf: () => ARCHER_RADIUS,
        onCollect: (g, p, pk) => this.applyPickup(p, pk),
      });
    }

    // Parçacıklar
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.alpha -= p.decay * dt;
      if (p.alpha <= 0) this.particles.splice(i, 1);
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
    } else if (data.action === 'ARCHER_CHARGE') {
      this.beginCharge(player);
    } else if (data.action === 'ARCHER_CHARGE_END') {
      this.looseArrow(player);
    }
  }

  handleRoundEnd(_winner) {
    // 60sn sonu: en çok puanlı raundu alır; beraberlikte raund kimseye yazılmaz
    let best = -1;
    let winners = [];
    this.players.forEach((p, i) => {
      if (!p.isJoined) return;
      if (this.scores[i] > best) {
        best = this.scores[i];
        winners = [p];
      } else if (this.scores[i] === best) {
        winners.push(p);
      }
    });
    const roundWinner = winners.length === 1 ? winners[0] : null;
    this.state = 'ROUND_OVER';
    this.roundWinner = roundWinner;
    this.roundTransitionTimer = 2.5;
    if (roundWinner) {
      this.roundWins[roundWinner.index]++;
      if (this.roundWins[roundWinner.index] >= this.roundsToWin) {
        this.matchWinner = roundWinner;
      }
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

    // Siper blokları (ortak arenaKit)
    for (const obs of this.obstacles) drawObstacle(ctx, obs, { variant: 'stone' });

    // Power-up rozetleri (ortak arenaKit)
    for (const pk of this.pickups) drawPickup(ctx, pk);

    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 6;
    ctx.strokeRect(left, top, width, height);

    // Engellerin üzerinde her zaman net, yüksek görünürlüklü süre sayacı
    if (this.state === 'PLAYING' || this.state === 'ROUND_OVER') {
      const remain = Math.max(0, Math.ceil(this.roundTime));
      renderArenaWatermarkTimer(ctx, {
        arena: this.arena,
        text: `${remain}s`,
        subText: '',
        urgent: remain <= 10,
        alpha: remain <= 10 ? 0.70 : 0.46,
        ringProgress: Math.max(0, remain / ARCHER_ROUND_TIME),
      });
    }

    // Oklar
    for (const a of this.arrows) {
      const ang = Math.atan2(a.vy, a.vx);
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(ang);
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-14, 0);
      ctx.lineTo(10, 0);
      ctx.stroke();
      ctx.fillStyle = a.color;
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(6, -5);
      ctx.lineTo(6, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Oyuncular
    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      ctx.save();
      ctx.translate(player.x, player.y);
      ctx.rotate(player.angle);

      // Nişan çizgisi (yay gerilirken)
      if (player.charging && this.state === 'PLAYING') {
        const aim = Math.sin(player.swayPhase) * (0.03 + 0.12 * (1 - player.charge));
        ctx.save();
        ctx.rotate(aim);
        ctx.strokeStyle = player.charge >= 1 ? '#8B5CF6' : 'rgba(26,26,26,0.35)';
        ctx.lineWidth = player.charge >= 1 ? 3 : 2;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(ARCHER_RADIUS + 8, 0);
        ctx.lineTo(ARCHER_RADIUS + 60 + player.charge * 90, 0);
        ctx.stroke();
        ctx.restore();
      }

      // Yay (gerilme halkası)
      if (this.state === 'PLAYING') {
        ctx.save();
        ctx.strokeStyle = player.charging ? '#8B5CF6' : 'rgba(26,26,26,0.45)';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(0, 0, ARCHER_RADIUS + 6, -1.1, 1.1);
        ctx.stroke();
        if (player.charging) {
          ctx.fillStyle = '#8B5CF6';
          ctx.beginPath();
          ctx.arc(ARCHER_RADIUS + 6, 0, 3 + player.charge * 3, 0, Math.PI * 2);
          ctx.fill();
        }
        // KALKAN halkası
        if (player.shield > 0) {
          ctx.strokeStyle = '#06B6D4';
          ctx.lineWidth = 3;
          ctx.setLineDash([6, 5]);
          ctx.beginPath();
          ctx.arc(0, 0, ARCHER_RADIUS + 11, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.restore();
      }

      drawGameAvatar(ctx, 0, 0, ARCHER_RADIUS, player, {
        color: player.stun > 0 ? '#9C988F' : player.color,
        facingAngle: 0, // already translated and rotated to player.angle
        label: `P${player.index + 1}`,
        expression: player.charging ? 'angry' : (player.stun > 0 ? 'dizzy' : 'normal'),
        showPointer: true,
        borderColor: '#1A1A1A',
        borderWidth: 2.5,
      });

      // Ok Dolum / Yeniden Yükleme ve Sersemleme Cooldown Arkı (Zemin ve okların üstünde her zaman görünür)
      if (player.reloadCooldown > 0) {
        const cdProg = 1.0 - Math.max(0, Math.min(1, player.reloadCooldown / 0.8));
        ctx.save();
        ctx.strokeStyle = 'rgba(26, 26, 26, 0.45)';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(0, 0, ARCHER_RADIUS + 5, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = '#8B5CF6';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, ARCHER_RADIUS + 5, -Math.PI / 2, -Math.PI / 2 + cdProg * Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
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

    this.renderControls(ctx, { extraEntities: this.arrows });
    this.renderHUD(ctx, {
      guideTitle: t('guide.archer'),
      guideEntries: [
        'P1 [WASD/SPACE]',
        'P2 [OKLAR/ENTER]',
        'P3 [IJKL/O]',
        'P4 [TFGH/B]',
      ],
      colors: ARCHER_COLORS,
      accent: '#8B5CF6',
      scoreboardEntities: [...this.players.filter((p) => p.isJoined && p.isAlive), ...this.arrows],
      matchOverHeadline: t('archer.champ'),
      matchOverRows: this.players.filter((p) => p.isJoined).map((p) => ({
        color: p.color,
        text: `${p.name}: ${this.scores[p.index]}★ · ${this.roundWins[p.index]}R`,
      })),
      onSeatChange: (i) => {
        if (this.players[i]) {
          this.players[i].isJoined = this.isSlotJoined(i);
          this.players[i].slotType = this.slotTypes[i];
        }
        playJoin();
      },
    });
    ctx.restore();
  }
}
