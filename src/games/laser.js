// BRUTAL LASER: 2-4 oyunculu seken lazer düellosu — nişan al, sektirerek vur.
// Taretler sabit noktada döner; ateş 0.8sn beklemeli, lazer 4 sekmede söner.

import { playExplosion, playStart, playJoin, playGunshot } from '../audio.js';
import { renderControlGuide, renderLobbySeatCard, getStandardSeatRects, renderLobbyStartButton } from '../controlGuide.js';
import { renderCornerScores, renderRoundBanner, renderMatchOver } from '../ui/hud.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { updateLaserBotAI } from '../ai/laserAI.js';

export const LASER_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
export const LASER_NAMES = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'];

const LASER_KEY_SLOTS_PAIRS = [
  { l: 'KeyA', r: 'KeyD', fire: 'Space' },
  { l: 'ArrowLeft', r: 'ArrowRight', fire: 'Enter' },
  { l: 'KeyJ', r: 'KeyL', fire: 'KeyO' },
  { l: 'KeyF', r: 'KeyH', fire: 'KeyB' },
];

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class LaserGame extends BaseMiniGame {
  constructor(canvas) {
    super(canvas);
    this.arena = { cx: 0, cy: 0, size: 0, left: 0, right: 0, top: 0, bottom: 0 };
    this.slotTypes = ['human', 'bot_normal', 'empty', 'empty'];
    this.scores = [0, 0, 0, 0];
    this.targetScore = 5;
    this.players = [];
    this.lasers = [];
    this.obstacles = [];
    this.keys = {};

    // Köşe dokunmatik: corner -> touch id (nişan sürükleme) + ateş parmağı
    this.cornerTouches = [
      { id: -1 },
      { id: -1 },
      { id: -1 },
      { id: -1 },
    ];
    this.fireTouchIds = [null, null, null, null];
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
    const map = LASER_KEY_SLOTS_PAIRS[index];
    if (!map) return { steer: 0, fire: false };
    const steer = (this.keys[map.r] ? 1 : 0) - (this.keys[map.l] ? 1 : 0);
    return { steer, fire: !!this.keys[map.fire] };
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

    // Maç ortası resize ışınlamaz: geometri yenilenir, varlıklar orantılı taşınır
    if (this.state === 'LOBBY' || !this.players.length) {
      this.initPlayers();
      return;
    }
    for (const p of this.players) this.remapPoint(p, oldArena, this.arena);
    for (const lz of this.lasers) this.remapPoint(lz, oldArena, this.arena);
  }

  buildMap() {
    this.obstacles = [];
    const { cx, cy, size } = this.arena;
    const bw = size * 0.15;
    const bh = size * 0.05;

    // Çarpraz ve zorlu sekme engelleri
    this.obstacles.push(
      { x: cx - bw * 1.5, y: cy - bw, w: bw, h: bh },
      { x: cx + bw * 0.5, y: cy - bw, w: bw, h: bh },
      { x: cx - bw * 1.5, y: cy + bw - bh, w: bw, h: bh },
      { x: cx + bw * 0.5, y: cy + bw - bh, w: bw, h: bh },
      { x: cx - bh / 2, y: cy - bw * 1.5, w: bh, h: bw },
      { x: cx - bh / 2, y: cy + bw * 0.5, w: bh, h: bw }
    );
  }

  initPlayers() {
    this.players = [0, 1, 2, 3].map((i) => {
      // Raunt başı TV isimleri silinmez (CROWN deseni)
      const existing = this.players[i];
      return {
        index: i, name: existing?.name || LASER_NAMES[i], color: LASER_COLORS[i],
        x: 0, y: 0, angle: 0, targetAngle: 0,
        cooldown: 0,
        isAlive: true, isJoined: this.isSlotJoined(i), slotType: this.slotTypes[i],
        botCheckTimer: 0, botTargetAngle: 0, keyFireLatch: false,
      };
    });
    this.initPlayersPositions();
  }

  initPlayersPositions() {
    const { left, right, top, bottom, size } = this.arena;
    const p = size * 0.1;
    const spawns = [
      { x: left + p, y: bottom - p, angle: -Math.PI / 4 },
      { x: left + p, y: top + p, angle: Math.PI / 4 },
      { x: right - p, y: top + p, angle: Math.PI * 0.75 },
      { x: right - p, y: bottom - p, angle: -Math.PI * 0.75 },
    ];
    this.players.forEach((player, i) => {
      player.x = spawns[i].x;
      player.y = spawns[i].y;
      if (this.state === 'LOBBY') {
        player.angle = spawns[i].angle;
        player.targetAngle = spawns[i].angle;
      }
    });
  }

  resetMatch() {
    this.state = 'LOBBY';
    this.scores = [0, 0, 0, 0];
    this.roundWinner = null;
    this.matchWinner = null;
    this.roundTransitionTimer = 0;
    this.lasers = [];
    this.onTouchesReset();
    this.initPlayers();
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
    this.lasers = [];
    this.roundWinner = null;
    this.roundTransitionTimer = 0;
    this.onTouchesReset();
    playStart();
    this.initPlayersPositions();
    this.players.forEach((p) => {
      p.isAlive = p.isJoined;
      p.cooldown = 1.0;
    });
  }

  fireLaser(player) {
    if (this.state !== 'PLAYING') return;
    if (player.cooldown > 0) return;
    player.cooldown = 0.8;
    playGunshot();

    this.lasers.push({
      x: player.x + Math.cos(player.angle) * 20,
      y: player.y + Math.sin(player.angle) * 20,
      vx: Math.cos(player.angle) * 600,
      vy: Math.sin(player.angle) * 600,
      owner: player.index,
      color: player.color,
      bounces: 4,
      history: [],
    });
    this.addTrauma(0.12);
  }

  getCornerZone(pos) {
    const { cx, cy } = this.arena;
    const isLeft = pos.x < cx;
    const isTop = pos.y < cy;
    if (isLeft && !isTop) return 0;
    if (isLeft && isTop) return 1;
    if (!isLeft && isTop) return 2;
    return 3;
  }

  aimPlayerAt(player, x, y) {
    if (!player || !player.isJoined || !player.isAlive || player.slotType !== 'human') return;
    player.targetAngle = Math.atan2(y - player.y, x - player.x);
  }

  onTouchStart(touch) {
    const { cx, cy } = this.arena;
    const distToCenter = Math.hypot(touch.x - cx, touch.y - cy);

    if (this.state === 'LOBBY') {
      if (this.handleUiTap(touch)) return;
      if (distToCenter < 65) {
        const joinedCount = this.slotTypes.filter((s) => s !== 'empty').length;
        if (joinedCount >= 2) this.startNewMatch();
        return;
      }
      const corner = this.getCornerZone(touch);
      this.cycleSlotType(corner);
      if (this.players[corner]) {
        this.players[corner].isJoined = this.isSlotJoined(corner);
        this.players[corner].slotType = this.slotTypes[corner];
      }
      playJoin();
      return;
    }

    if (this.state === 'MATCH_OVER') {
      if (this.handleUiTap(touch)) return;
      if (distToCenter < 75) {
        this.resetMatch();
        playJoin();
      }
      return;
    }

    if (this.state === 'PLAYING') {
      const corner = this.getCornerZone(touch);
      const player = this.players[corner];
      if (!player || !player.isJoined || !player.isAlive || player.slotType !== 'human') return;
      // İkinci parmak aynı köşede = ateş
      if (this.cornerTouches[corner].id !== -1) {
        this.fireTouchIds[corner] = touch.id;
        this.fireLaser(player);
        return;
      }
      this.cornerTouches[corner] = { id: touch.id };
      this.aimPlayerAt(player, touch.x, touch.y);
    }
  }

  onTouchMove(touch) {
    if (this.state !== 'PLAYING') return;
    for (let i = 0; i < 4; i++) {
      if (this.cornerTouches[i] && this.cornerTouches[i].id === touch.id) {
        this.aimPlayerAt(this.players[i], touch.x, touch.y);
        break;
      }
    }
  }

  onTouchEnd(touch) {
    for (let i = 0; i < 4; i++) {
      if (this.cornerTouches[i] && this.cornerTouches[i].id === touch.id) {
        this.cornerTouches[i] = { id: -1 };
      }
      if (this.fireTouchIds[i] === touch.id) {
        this.fireTouchIds[i] = null;
      }
    }
  }

  onTouchesReset() {
    this.cornerTouches = [{ id: -1 }, { id: -1 }, { id: -1 }, { id: -1 }];
    this.fireTouchIds = [null, null, null, null];
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

    // 1. Oyuncu Açı ve Ateş Güncellemesi
    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      if (player.cooldown > 0) player.cooldown -= dt;

      if (player.slotType !== 'human') {
        updateLaserBotAI(this, player, dt);
      } else {
        const ki = this.keyboardInput(player.index);
        if (ki.steer !== 0) {
          player.targetAngle += ki.steer * 5.0 * dt;
        }
        if (ki.fire && !player.keyFireLatch) {
          this.fireLaser(player);
          player.keyFireLatch = true;
        } else if (!ki.fire) {
          player.keyFireLatch = false;
        }
      }

      // Taret yumuşatma: ani fırıldak dönüşü engellenir
      const diff = normalizeAngle(player.targetAngle - player.angle);
      player.angle += diff * Math.min(1.0, dt * 15);
    }

    // 2. Lazer Fiziği (hıza oranlı alt-adım: mermi köşelerden geçmez)
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      const laser = this.lasers[i];
      const steps = Math.max(1, Math.ceil((Math.hypot(laser.vx, laser.vy) * dt) / 5));
      let destroyed = false;

      for (let s = 0; s < steps; s++) {
        const subDt = dt / steps;
        laser.history.push({ x: laser.x, y: laser.y });
        if (laser.history.length > 10) laser.history.shift();

        laser.x += laser.vx * subDt;
        laser.y += laser.vy * subDt;

        // Dış Duvar Sekmeleri
        if (laser.x < this.arena.left || laser.x > this.arena.right) {
          laser.vx *= -1;
          laser.x = Math.max(this.arena.left, Math.min(this.arena.right, laser.x));
          laser.bounces--;
        }
        if (laser.y < this.arena.top || laser.y > this.arena.bottom) {
          laser.vy *= -1;
          laser.y = Math.max(this.arena.top, Math.min(this.arena.bottom, laser.y));
          laser.bounces--;
        }

        // İç Engel Sekmeleri (en sığ yüze göre eksen seçilir)
        for (const obs of this.obstacles) {
          if (laser.x > obs.x && laser.x < obs.x + obs.w && laser.y > obs.y && laser.y < obs.y + obs.h) {
            const dx1 = laser.x - obs.x;
            const dx2 = (obs.x + obs.w) - laser.x;
            const dy1 = laser.y - obs.y;
            const dy2 = (obs.y + obs.h) - laser.y;
            const min = Math.min(dx1, dx2, dy1, dy2);
            if (min === dx1 || min === dx2) laser.vx *= -1;
            else laser.vy *= -1;
            laser.bounces--;
            break;
          }
        }

        if (laser.bounces < 0) {
          destroyed = true;
          break;
        }

        // Rakibi Vurma (kendi lazeri ilk 8 karede affedilir)
        for (const p of this.players) {
          if (!p.isJoined || !p.isAlive) continue;
          if (p.index === laser.owner && laser.history.length < 8) continue;

          if (Math.hypot(laser.x - p.x, laser.y - p.y) < 16) {
            this.eliminatePlayer(p);
            destroyed = true;
            break;
          }
        }
        if (destroyed) break;
      }

      if (destroyed) {
        this.lasers.splice(i, 1);
      }
    }

    const alive = this.players.filter((p) => p.isJoined && p.isAlive);
    if (alive.length <= 1) {
      this.handleRoundEnd(alive.length === 1 ? alive[0] : null);
    }
  }

  eliminatePlayer(player) {
    player.isAlive = false;
    this.addTrauma(0.5);
    playExplosion();

    this.players.forEach((p) => {
      if (p.index !== player.index && p.isJoined && p.isAlive) {
        this.scores[p.index]++;
        if (this.scores[p.index] >= this.targetScore) this.matchWinner = p;
      }
    });
  }

  handleRemoteInput(slotIndex, data) {
    const player = this.players[slotIndex];
    if (!player || !player.isJoined || !player.isAlive) return;

    if (data.action === 'JOYSTICK_MOVE' && data.force > 0.05) {
      const angle = Number.isFinite(data.angle) ? normalizeAngle(data.angle) : player.targetAngle;
      player.targetAngle = angle;
    } else if (data.action === 'TANK_FIRE') {
      this.fireLaser(player);
    }
  }

  handleRoundEnd(winner) {
    this.state = 'ROUND_OVER';
    this.roundWinner = winner;
    if (winner) {
      this.scores[winner.index]++;
      if (this.scores[winner.index] >= this.targetScore) {
        this.state = 'MATCH_OVER';
        this.matchWinner = winner;
        return;
      }
    }
    this.roundTransitionTimer = 2.5;
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

    if (this.state === 'PLAYING' || this.state === 'ROUND_OVER') {
      renderCornerScores(ctx, { arena: this.arena, entries: this.players.map((p) => p.isJoined ? { color: p.color, text: `${this.scores[p.index]}★` } : null) });
    }

    ctx.fillStyle = '#1A1A1A';
    for (const obs of this.obstacles) {
      ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
    }

    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 6;
    ctx.strokeRect(left, top, width, height);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const laser of this.lasers) {
      ctx.lineWidth = 5;
      ctx.strokeStyle = laser.color;
      ctx.beginPath();
      if (laser.history.length > 0) {
        ctx.moveTo(laser.history[0].x, laser.history[0].y);
        for (let i = 1; i < laser.history.length; i++) {
          ctx.lineTo(laser.history[i].x, laser.history[i].y);
        }
      }
      ctx.lineTo(laser.x, laser.y);
      ctx.stroke();

      ctx.fillStyle = '#FFF';
      ctx.beginPath(); ctx.arc(laser.x, laser.y, 3, 0, Math.PI * 2); ctx.fill();
    }

    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      ctx.save();
      ctx.translate(player.x, player.y);
      ctx.rotate(player.angle);

      ctx.fillStyle = player.color;
      ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = '#1A1A1A'; ctx.stroke();

      ctx.fillStyle = player.cooldown > 0 ? '#888' : '#FFF';
      ctx.fillRect(8, -4, 14, 8);
      ctx.strokeRect(8, -4, 14, 8);
      ctx.restore();
    }

    this.uiButtons = [];
    if (this.state === 'LOBBY') {
      renderControlGuide(ctx, this.arena, 'JOYSTICK: NİŞAN AL • AKSİYON: ATEŞ ET • SEKTİREREK VUR', [
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
          playerColor: LASER_COLORS[i],
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
      renderMatchOver(ctx, {
        arena: this.arena,
        uiButtons: this.uiButtons,
        headline: 'LAZER ŞAMPİYONU!',
        winnerName: this.matchWinner ? this.matchWinner.name : '',
        winnerColor: this.matchWinner ? this.matchWinner.color : '#1A1A1A',
        rows: this.players
          .filter((p) => p.isJoined)
          .map((p) => ({ color: p.color, text: `${p.name}: ${this.scores[p.index] || 0}★` })),
        onRestart: () => this.startNewMatch(),
      });
    }
    ctx.restore();
  }
}
