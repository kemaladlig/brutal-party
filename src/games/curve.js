// BRUTAL CURVE (Game 03): 2-4 Player Local Party Curve Fever with Gaps, Power-Ups & Bot AI
import { playExplosion, playStart, playJoin, playGap, playItemPickup } from '../audio.js';
import { renderControlGuide, renderLobbySeatCard } from '../controlGuide.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { updateCurveBotAI } from '../ai/curveAI.js';

export const CURVE_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
export const CURVE_NAMES = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'];

export class CurveGame extends BaseMiniGame {
  constructor(canvas) {
    super(canvas);

    // Arena dimensions
    this.arena = {
      cx: 0,
      cy: 0,
      size: 0,
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    };

    // Slot types: 'empty' | 'human' | 'bot_normal' | 'bot_god'
    this.slotTypes = ['human', 'bot_normal', 'empty', 'empty']; // P1 Human, P2 Normal Bot default

    // Tournament scores
    this.scores = [0, 0, 0, 0];
    this.targetScore = 5;
    this.roundWinner = null;
    this.matchWinner = null;
    this.roundTransitionTimer = 0;
    this.spawnIntroTimer = 0;

    // Players, Trail Segments, Particles & Pickups
    this.players = [];
    this.segments = [];
    this.particles = [];
    this.pickups = [];
    this.pickupSpawnTimer = 8.0;

    // Touch identifier mapping for corners: corner -> { id, action: 'left' | 'right' }
    this.cornerTouches = [
      { id: -1, action: null },
      { id: -1, action: null },
      { id: -1, action: null },
      { id: -1, action: null },
    ];
  }

  resize(width, height) {
    const marginX = Math.max(12, Math.floor(width * 0.04));
    const marginY = height > width
      ? Math.max(48, Math.floor(height * 0.12))
      : Math.max(32, Math.floor(height * 0.06));
    const arenaW = width - marginX * 2;
    const arenaH = height - marginY * 2;

    this.arena = {
      cx: width / 2,
      cy: height / 2,
      width: arenaW,
      height: arenaH,
      size: Math.min(arenaW, arenaH),
      left: marginX,
      right: marginX + arenaW,
      top: marginY,
      bottom: marginY + arenaH,
    };

    this.initPlayers();
  }

  initPlayers() {
    const { left, right, top, bottom, width, height, size } = this.arena;
    const padding = size * 0.22;

    const spawns = [
      { x: left + padding, y: bottom - padding, angle: -Math.PI * 0.25 }, // P1 Bottom-Left
      { x: left + padding, y: top + padding, angle: Math.PI * 0.25 },          // P2 Top-Left
      { x: right - padding, y: top + padding, angle: Math.PI * 0.75 },   // P3 Top-Right
      { x: right - padding, y: bottom - padding, angle: -Math.PI * 0.75 }, // P4 Bottom-Right
    ];

    this.players = spawns.map((s, i) => {
      return {
        index: i,
        name: CURVE_NAMES[i],
        color: CURVE_COLORS[i],
        x: s.x,
        y: s.y,
        prevX: s.x,
        prevY: s.y,
        angle: s.angle,
        speed: 160,
        turnSpeed: 2.85,
        steer: 0, // -1 (left), 0 (none), +1 (right)
        isAlive: true,
        isJoined: this.isSlotJoined(i),
        slotType: this.slotTypes[i],
        gapTimer: 2.5 + Math.random() * 2.0,
        gapDuration: 0,
        isGap: false,
        ghostTimer: 0,
        turboTimer: 0,
        confusedTimer: 0,
        botCheckTimer: 0,
        botSteer: 0,
        botTurnCommitment: 0,
      };
    });
  }

  resetMatch() {
    this.state = 'LOBBY';
    this.scores = [0, 0, 0, 0];
    this.roundWinner = null;
    this.matchWinner = null;
    this.segments = [];
    this.particles = [];
    this.pickups = [];
    this.cornerTouches = [
      { id: -1, action: null },
      { id: -1, action: null },
      { id: -1, action: null },
      { id: -1, action: null },
    ];
    this.trauma = 0;
    this.spawnIntroTimer = 0;
    this.lastTime = performance.now();
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
    this.state = 'PLAYING';
    this.segments = [];
    this.particles = [];
    this.pickups = [];
    this.pickupSpawnTimer = 7.0;
    this.roundWinner = null;
    this.spawnIntroTimer = 1.8;
    playStart();

    const { left, right, top, bottom, size } = this.arena;
    const padding = size * 0.24;

    const spawns = [
      { x: left + padding, y: bottom - padding, angle: -Math.PI * 0.25 },
      { x: left + padding, y: top + padding, angle: Math.PI * 0.25 },
      { x: right - padding, y: top + padding, angle: Math.PI * 0.75 },
      { x: right - padding, y: bottom - padding, angle: -Math.PI * 0.75 },
    ];

    this.players.forEach((p, i) => {
      const s = spawns[i];
      const randomAngleOffset = (Math.random() - 0.5) * 0.4;
      p.x = s.x;
      p.y = s.y;
      p.prevX = s.x;
      p.prevY = s.y;
      p.angle = s.angle + randomAngleOffset;
      p.steer = 0;
      p.slotType = this.slotTypes[i];
      p.isJoined = this.isSlotJoined(i);
      p.isAlive = p.isJoined;
      p.gapTimer = 2.0 + Math.random() * 2.2;
      p.gapDuration = 0;
      p.isGap = false;
      p.ghostTimer = 0;
      p.turboTimer = 0;
      p.confusedTimer = 0;
      p.botCheckTimer = 0;
      p.botSteer = 0;
      p.botTurnCommitment = 0;
    });
  }

  getCornerZone(pos) {
    const { cx, cy } = this.arena;
    const isLeft = pos.x < cx;
    const isTop = pos.y < cy;

    if (isLeft && !isTop) return 0; // P1 Bottom-Left
    if (isLeft && isTop) return 1;  // P2 Top-Left
    if (!isLeft && isTop) return 2; // P3 Top-Right
    return 3;                       // P4 Bottom-Right
  }

  getCornerButtonZones(cornerIndex) {
    const { left, right, top, bottom, size } = this.arena;
    const btnW = Math.max(140, Math.min(240, size * 0.44));
    const btnH = Math.max(56, Math.min(76, size * 0.16));
    const halfW = btnW / 2;

    let bx = left;
    let by = bottom - btnH;

    if (cornerIndex === 1) {
      bx = left;
      by = top;
    } else if (cornerIndex === 2) {
      bx = right - btnW;
      by = top;
    } else if (cornerIndex === 3) {
      bx = right - btnW;
      by = bottom - btnH;
    }

    return {
      leftBtn: { x: bx, y: by, w: halfW, h: btnH },
      rightBtn: { x: bx + halfW, y: by, w: halfW, h: btnH },
      box: { x: bx, y: by, w: btnW, h: btnH },
    };
  }

  determineSteerAction(cornerIndex, touch) {
    const zone = this.getCornerButtonZones(cornerIndex);
    const isTop = cornerIndex === 1 || cornerIndex === 2;
    const midX = zone.box.x + zone.box.w / 2;
    // For top players looking down at the screen, their left is towards +X
    if (isTop) {
      return touch.x >= midX ? 'left' : 'right';
    } else {
      return touch.x < midX ? 'left' : 'right';
    }
  }

  onTouchStart(touch) {
    const { cx, cy } = this.arena;
    const distToCenter = Math.hypot(touch.x - cx, touch.y - cy);

    // 1. Center Start Button (Lobby)
    if (this.state === 'LOBBY') {
      if (distToCenter < 65) {
        const joinedCount = this.slotTypes.filter((s) => s !== 'empty').length;
        if (joinedCount >= 2) {
          this.startNewMatch();
        }
        return;
      }

      const corner = this.getCornerZone(touch);
      if (corner === -1) return;

      this.cycleSlotType(corner);
      if (this.players[corner]) {
        this.players[corner].isJoined = this.isSlotJoined(corner);
        this.players[corner].slotType = this.slotTypes[corner];
      }
      playJoin();
      return;
    }

    // 2. Center Restart Button (Match Over)
    if (this.state === 'MATCH_OVER') {
      if (distToCenter < 75) {
        this.resetMatch();
        playJoin();
      }
      return;
    }

    // 3. Gameplay: Generous quadrant steering controls
    if (this.state === 'PLAYING') {
      const corner = this.getCornerZone(touch);
      if (corner === -1) return;
      const player = this.players[corner];
      if (player && player.isJoined && player.isAlive && player.slotType === 'human') {
        const action = this.determineSteerAction(corner, touch);
        this.cornerTouches[corner] = { id: touch.id, action };
        const steerDir = action === 'left' ? -1 : 1;
        player.steer = player.confusedTimer > 0 ? -steerDir : steerDir;
      }
    }
  }

  onTouchMove(touch) {
    if (this.state !== 'PLAYING') return;

    for (let i = 0; i < 4; i++) {
      if (this.cornerTouches[i] && this.cornerTouches[i].id === touch.id) {
        const player = this.players[i];
        if (player && player.isAlive && player.slotType === 'human') {
          const action = this.determineSteerAction(i, touch);
          this.cornerTouches[i].action = action;
          const steerDir = action === 'left' ? -1 : 1;
          player.steer = player.confusedTimer > 0 ? -steerDir : steerDir;
        }
        break;
      }
    }
  }

  onTouchEnd(touch) {
    for (let i = 0; i < 4; i++) {
      if (this.cornerTouches[i] && this.cornerTouches[i].id === touch.id) {
        this.cornerTouches[i] = { id: -1, action: null };
        const player = this.players[i];
        if (player && player.slotType === 'human') {
          player.steer = 0;
        }
        break;
      }
    }
  }

  onTouchesReset() {
    this.cornerTouches = [
      { id: -1, action: null },
      { id: -1, action: null },
      { id: -1, action: null },
      { id: -1, action: null },
    ];
    this.players.forEach((p) => (p.steer = 0));
  }

  spawnPickup() {
    const { left, top, right, bottom } = this.arena;
    const types = ['SCISSORS', 'GHOST', 'TURBO', 'INVERT'];
    const type = types[Math.floor(Math.random() * types.length)];
    const size = 22;

    const px = left + 45 + Math.random() * (right - left - 90);
    const py = top + 45 + Math.random() * (bottom - top - 90);

    this.pickups.push({
      x: px,
      y: py,
      size,
      type,
      life: 14.0,
    });
  }

  addTrauma(amount) {
    this.trauma = Math.min(1.0, this.trauma + amount);
  }

  update(now) {
    const dt = Math.min((now - this.lastTime) / 1000, 0.08);
    this.lastTime = now;

    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 2.2);
    }

    if (this.spawnIntroTimer > 0) {
      this.spawnIntroTimer = Math.max(0, this.spawnIntroTimer - dt);
    }

    if (this.state === 'ROUND_OVER') {
      this.roundTransitionTimer -= dt;
      if (this.roundTransitionTimer <= 0) {
        if (this.matchWinner) {
          this.state = 'MATCH_OVER';
        } else {
          this.startRound();
        }
      }
    }

    if (this.state === 'PLAYING') {
      // Pickups timer
      this.pickupSpawnTimer -= dt;
      if (this.pickupSpawnTimer <= 0 && this.pickups.length < 2) {
        this.spawnPickup();
        this.pickupSpawnTimer = 9.0 + Math.random() * 4.0;
      }

      // Update pickups
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        this.pickups[i].life -= dt;
        if (this.pickups[i].life <= 0) {
          this.pickups.splice(i, 1);
        }
      }

      // Update Players
      for (const player of this.players) {
        if (!player.isJoined || !player.isAlive) continue;

        // Timers
        if (player.ghostTimer > 0) player.ghostTimer = Math.max(0, player.ghostTimer - dt);
        if (player.turboTimer > 0) player.turboTimer = Math.max(0, player.turboTimer - dt);
        if (player.confusedTimer > 0) player.confusedTimer = Math.max(0, player.confusedTimer - dt);

        // Gap Cycle Management
        if (player.isGap) {
          player.gapDuration -= dt;
          if (player.gapDuration <= 0) {
            player.isGap = false;
            player.gapTimer = 2.4 + Math.random() * 2.2;
          }
        } else {
          player.gapTimer -= dt;
          if (player.gapTimer <= 0) {
            player.isGap = true;
            player.gapDuration = 0.16; // ~25px gap
            playGap();
          }
        }

        // Run AI Controller
        if (player.slotType !== 'human') {
          this.updateBotAI(player, dt);
        }

        // Steer & Movement
        const currentTurn = player.turnSpeed * (player.confusedTimer > 0 ? -1 : 1);
        player.angle += player.steer * currentTurn * dt;

        const currentSpeed = player.turboTimer > 0 ? player.speed * 1.5 : player.speed;
        player.prevX = player.x;
        player.prevY = player.y;
        player.x += Math.cos(player.angle) * currentSpeed * dt;
        player.y += Math.sin(player.angle) * currentSpeed * dt;

        // Record Trail Segment
        this.segments.push({
          x1: player.prevX,
          y1: player.prevY,
          x2: player.x,
          y2: player.y,
          isGap: player.isGap,
          owner: player.index,
          color: player.color,
          createdAt: performance.now(),
        });

        // Check Pickup Collision
        for (let pIdx = this.pickups.length - 1; pIdx >= 0; pIdx--) {
          const item = this.pickups[pIdx];
          if (Math.hypot(player.x - item.x, player.y - item.y) < item.size * 0.8 + 4) {
            this.applyPickup(player, item);
            this.pickups.splice(pIdx, 1);
            break;
          }
        }

        // Check Collision with Arena Walls & Trails
        if (this.checkCollision(player)) {
          this.eliminatePlayer(player);
        }
      }

      // Check Round End Condition
      const alivePlayers = this.players.filter((p) => p.isJoined && p.isAlive);
      if (alivePlayers.length <= 1) {
        this.handleRoundEnd(alivePlayers.length === 1 ? alivePlayers[0] : null);
      }
    }

    // Update Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  applyPickup(player, item) {
    playItemPickup();
    this.addTrauma(0.12);

    if (item.type === 'SCISSORS') {
      const mySegs = this.segments.filter((s) => s.owner === player.index);
      const toRemove = Math.floor(mySegs.length * 0.7);
      let removed = 0;
      for (let i = 0; i < this.segments.length; i++) {
        if (this.segments[i].owner === player.index) {
          this.segments.splice(i, 1);
          i--;
          removed++;
          if (removed >= toRemove) break;
        }
      }
    } else if (item.type === 'GHOST') {
      player.ghostTimer = 3.5;
    } else if (item.type === 'TURBO') {
      player.turboTimer = 4.0;
    } else if (item.type === 'INVERT') {
      this.players.forEach((p) => {
        if (p.index !== player.index && p.isJoined && p.isAlive) {
          p.confusedTimer = 3.5;
        }
      });
    }
  }

  checkCollision(player) {
    if (player.ghostTimer > 0) return false;

    const { left, right, top, bottom } = this.arena;
    const r = 3;

    // 1. Boundary Wall Collision
    if (player.x - r <= left || player.x + r >= right || player.y - r <= top || player.y + r >= bottom) {
      return true;
    }

    if (player.isGap) return false;

    // 2. Line Segment Collision
    const px = player.x;
    const py = player.y;
    const now = performance.now();

    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      if (seg.isGap) continue;

      if (seg.owner === player.index && now - seg.createdAt < 220) {
        continue;
      }

      const minX = Math.min(seg.x1, seg.x2) - r;
      const maxX = Math.max(seg.x1, seg.x2) + r;
      const minY = Math.min(seg.y1, seg.y2) - r;
      const maxY = Math.max(seg.y1, seg.y2) + r;

      if (px < minX || px > maxX || py < minY || py > maxY) continue;

      const distSq = this.distToSegmentSquared(px, py, seg.x1, seg.y1, seg.x2, seg.y2);
      if (distSq <= (r + 1.8) * (r + 1.8)) {
        return true;
      }
    }

    return false;
  }

  distToSegmentSquared(px, py, vx, vy, wx, wy) {
    const l2 = (wx - vx) * (wx - vx) + (wy - vy) * (wy - vy);
    if (l2 === 0) return (px - vx) * (px - vx) + (py - vy) * (py - vy);
    let t = ((px - vx) * (wx - vx) + (py - vy) * (wy - vy)) / l2;
    t = Math.max(0, Math.min(1, t));
    const projX = vx + t * (wx - vx);
    const projY = vy + t * (wy - vy);
    return (px - projX) * (px - projX) + (py - projY) * (py - projY);
  }

  eliminatePlayer(player) {
    player.isAlive = false;
    this.addTrauma(0.35);
    playExplosion();

    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 140;
      this.particles.push({
        x: player.x,
        y: player.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.55,
        maxLife: 0.55,
        size: 3 + Math.random() * 4,
        color: Math.random() > 0.3 ? player.color : '#1A1A1A',
      });
    }

    if (player.slotType === 'human' && typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([40, 50, 70]);
    }

    this.players.forEach((p) => {
      if (p.index !== player.index && p.isJoined && p.isAlive) {
        this.scores[p.index]++;
        if (this.scores[p.index] >= this.targetScore) {
          this.matchWinner = p;
        }
      }
    });
  }

  handleRemoteInput(slotIndex, data) {
    const player = this.players[slotIndex];
    if (!player || !player.isJoined || !player.isAlive) return;
    if (data.action === 'CURVE_STEER') {
      player.steer = data.dir || 0;
    }
  }

  handleRoundEnd(winner) {
    this.state = 'ROUND_OVER';
    this.roundWinner = winner;
    this.roundTransitionTimer = 2.2;
  }

  updateBotAI(bot, dt) {
    updateCurveBotAI(this, bot, dt);
  }

  render() {
    const { ctx, canvas } = this;
    ctx.save();

    // Background paper
    ctx.fillStyle = '#F4F4F0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (this.trauma > 0) {
      const shake = this.trauma * this.trauma * 16;
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    const { left, top, width, height, size, right, bottom, cx, cy } = this.arena;

    ctx.fillStyle = '#FAF7F2';
    ctx.fillRect(left, top, width, height);

    // 4 Köşede Standart Yüksek Görünürlüklü Oyuncu Skorları
    if (this.state === 'PLAYING') {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const scoreSize = Math.max(32, Math.min(52, Math.floor(Math.min(width, height) * 0.08)));

      const cornerOffsets = [
        { x: left + width * 0.11, y: bottom - height * 0.11 },
        { x: left + width * 0.11, y: top + height * 0.11 },
        { x: right - width * 0.11, y: top + height * 0.11 },
        { x: right - width * 0.11, y: bottom - height * 0.11 },
      ];
      this.players.forEach((p, i) => {
        if (!p.isJoined) return;
        const pos = cornerOffsets[i];
        ctx.save();
        ctx.fillStyle = p.color;
        ctx.globalAlpha = 0.85;
        ctx.font = `900 ${scoreSize}px "Space Grotesk", sans-serif`;
        ctx.fillText(`${this.scores[i] || 0}★`, pos.x, pos.y);
        ctx.restore();
      });

      ctx.restore();
    }

    ctx.strokeStyle = '#E2DDD4';
    ctx.lineWidth = 1.5;
    const gridStep = size / 6;
    for (let x = left + gridStep; x < right; x += gridStep) {
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
    for (let y = top + gridStep; y < bottom; y += gridStep) {
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }

    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 6;
    ctx.strokeRect(left, top, width, height);

    // Trail Segments
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (const seg of this.segments) {
      if (seg.isGap) continue;
      ctx.strokeStyle = seg.color;
      ctx.beginPath();
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
      ctx.stroke();
    }

    // Pickups
    for (const item of this.pickups) {
      ctx.save();
      const s = item.size;
      ctx.fillStyle = '#1A1A1A';
      ctx.fillRect(item.x - s / 2 + 2, item.y - s / 2 + 2, s, s);
      ctx.fillStyle = '#FAF7F2';
      ctx.fillRect(item.x - s / 2, item.y - s / 2, s, s);
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 2;
      ctx.strokeRect(item.x - s / 2, item.y - s / 2, s, s);

      ctx.fillStyle = '#1A1A1A';
      ctx.font = '900 15px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const icon =
        item.type === 'SCISSORS'
          ? '✂️'
          : item.type === 'GHOST'
          ? '👻'
          : item.type === 'TURBO'
          ? '⚡'
          : '🌀';
      ctx.fillText(icon, item.x, item.y);
      ctx.restore();
    }

    // Particles
    for (const p of this.particles) {
      const alpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      ctx.globalAlpha = 1.0;
    }

    // Heads
    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      ctx.save();
      ctx.beginPath();
      ctx.arc(player.x, player.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = player.color;
      ctx.fill();
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 2;
      ctx.stroke();

      if (player.ghostTimer > 0) {
        ctx.beginPath();
        ctx.arc(player.x, player.y, 10, 0, Math.PI * 2);
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = '#1A1A1A';
        ctx.stroke();
      }

      // Gap Warning Halo (0.4s before gap opens)
      if (player.gapTimer <= 0.4 && !player.isGap) {
        ctx.beginPath();
        ctx.arc(player.x, player.y, 9, 0, Math.PI * 2);
        ctx.strokeStyle = '#D84727';
        ctx.lineWidth = 1.8;
        ctx.setLineDash([2, 2]);
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(
        player.x + Math.cos(player.angle) * 3,
        player.y + Math.sin(player.angle) * 3,
        1.8,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.restore();
    }

    this.renderCornerControls(ctx);

    if (this.state === 'PLAYING' && this.spawnIntroTimer > 0) {
      this.renderSpawnBeacons(ctx);
    }

    if (this.state === 'LOBBY') {
      renderControlGuide(ctx, this.arena, 'KÖŞEDEKİ SOL VE SAĞ BUTONLAR', [
        'P1 KIRMIZI',
        'P2 MAVİ',
        'P3 SARI',
        'P4 YEŞİL',
      ]);
      this.renderLobbyUI(ctx);
    } else if (this.state === 'ROUND_OVER') {
      this.renderRoundBanner(ctx);
    } else if (this.state === 'MATCH_OVER') {
      this.renderMatchOverUI(ctx);
    }

    ctx.restore();
  }

  renderCornerControls(ctx) {
    for (let i = 0; i < 4; i++) {
      const player = this.players[i];
      const zones = this.getCornerButtonZones(i);
      const isJoined = this.isSlotJoined(i);
      const isTop = i === 1 || i === 2;

      ctx.save();
      // Rotate 180° for Top players so buttons and text face that player
      const cx = zones.box.x + zones.box.w / 2;
      const cy = zones.box.y + zones.box.h / 2;
      ctx.translate(cx, cy);
      if (isTop) {
        ctx.rotate(Math.PI);
      }

      const halfW = zones.box.w / 2;
      const halfH = zones.box.h / 2;

      let numLabel = `${i + 1}`;
      let subLabel = '';
      let isJoinedSeat = player.slotType === 'human';
      let isBotSeat = player.slotType === 'bot_normal' || player.slotType === 'bot_god';

      if (isJoinedSeat) {
        subLabel = player.name || '';
      } else if (isBotSeat) {
        subLabel = '🤖';
      }

      if (this.state === 'LOBBY') {
        renderLobbySeatCard(ctx, {
          x: -halfW,
          y: -halfH,
          w: zones.box.w,
          h: zones.box.h,
          slotIndex: i,
          slotType: player.slotType,
          playerName: player.name || '',
          playerColor: player.color,
          rotation: 0,
        });

      } else if (isJoined && player.slotType === 'human' && player.isAlive) {
        const touching = this.cornerTouches[i] || { id: -1, action: null };

        // Player Name Header
        ctx.fillStyle = player.color;
        ctx.font = '900 12px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(player.name, 0, -halfH - 4);

        const leftActive = touching.action === 'left';
        ctx.fillStyle = leftActive ? player.color : '#FFFFFF';
        ctx.fillRect(-halfW, -halfH, halfW, zones.box.h);
        ctx.strokeStyle = '#1A1A1A';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(-halfW, -halfH, halfW, zones.box.h);

        ctx.fillStyle = leftActive ? '#FFFFFF' : '#1A1A1A';
        ctx.font = '900 14px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('◄ SOL', -halfW / 2, 0);

        const rightActive = touching.action === 'right';
        ctx.fillStyle = rightActive ? player.color : '#FFFFFF';
        ctx.fillRect(0, -halfH, halfW, zones.box.h);
        ctx.strokeRect(0, -halfH, halfW, zones.box.h);

        ctx.fillStyle = rightActive ? '#FFFFFF' : '#1A1A1A';
        ctx.fillText('SAĞ ►', halfW / 2, 0);

      } else if (this.state === 'PLAYING' && isJoined) {
        ctx.globalAlpha = 0.42;
        ctx.strokeStyle = player.color;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(-halfW, -halfH, zones.box.w, zones.box.h);
        ctx.setLineDash([]);
        ctx.fillStyle = player.color;
        ctx.font = '800 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${player.name} [BOT]`, 0, 0);
      }
      ctx.restore();
    }
  }

  renderSpawnBeacons(ctx) {
    const progress = this.spawnIntroTimer / 1.8;

    this.players.forEach((p) => {
      if (!p.isJoined || !p.isAlive) return;

      ctx.save();
      const ringR = 14 + (1 - progress) * 24;
      ctx.beginPath();
      ctx.arc(p.x, p.y, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = Math.min(1.0, progress * 1.5);
      ctx.stroke();

      const tagW = 75;
      const tagH = 20;
      ctx.fillStyle = '#1A1A1A';
      ctx.fillRect(p.x - tagW / 2 + 2, p.y - 32 + 2, tagW, tagH);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - tagW / 2, p.y - 32, tagW, tagH);
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(p.x - tagW / 2, p.y - 32, tagW, tagH);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '900 10px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const role = p.slotType === 'bot_god' ? '⚡GOD' : p.slotType === 'bot_normal' ? '🤖BOT' : 'P' + (p.index + 1);
      ctx.fillText(`${role} // ${p.name}`, p.x, p.y - 22);
      ctx.restore();
    });
  }

  renderLobbyUI(ctx) {
    const { cx, cy } = this.arena;
    const joinedCount = this.slotTypes.filter((s) => s !== 'empty').length;

    const btnW = Math.min(220, this.arena.width * 0.45);
    const btnH = 60;
    const btnX = cx - btnW / 2;
    const btnY = cy - btnH / 2;

    ctx.save();
    // Solid Shadow
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(btnX + 5, btnY + 5, btnW, btnH);

    // Button Face
    ctx.fillStyle = joinedCount >= 2 ? '#D84727' : '#E5E0D6';
    ctx.fillRect(btnX, btnY, btnW, btnH);

    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 3;
    ctx.strokeRect(btnX, btnY, btnW, btnH);

    ctx.fillStyle = joinedCount >= 2 ? '#FFFFFF' : '#75726B';
    ctx.font = joinedCount >= 2 ? '900 20px "Space Grotesk", sans-serif' : '800 13px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(joinedCount >= 2 ? '▶ MAÇI BAŞLAT' : '2 KİŞİ GEREKİYOR', cx, cy);
    ctx.restore();
  }

  renderRoundBanner(ctx) {
    const { cx, cy, size } = this.arena;
    const boxW = Math.min(260, size * 0.7);
    const boxH = 64;

    ctx.save();
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(cx - boxW / 2 + 5, cy - boxH / 2 + 5, boxW, boxH);

    ctx.fillStyle = '#FAF7F2';
    ctx.fillRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH);
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 3;
    ctx.strokeRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (this.roundWinner) {
      ctx.fillStyle = this.roundWinner.color;
      ctx.font = '900 20px "Space Grotesk", sans-serif';
      ctx.fillText(`${this.roundWinner.name} KAZANDI!`, cx, cy);
    } else {
      ctx.fillStyle = '#1A1A1A';
      ctx.font = '900 18px "Space Grotesk", sans-serif';
      ctx.fillText('BERABERE!', cx, cy);
    }
    ctx.restore();
  }

  renderMatchOverUI(ctx) {
    const { cx, cy, size } = this.arena;
    const boxW = Math.min(300, size * 0.85);
    const boxH = 220;
    const boxX = cx - boxW / 2;
    const boxY = cy - boxH / 2;

    ctx.save();
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(boxX + 6, boxY + 6, boxW, boxH);

    ctx.fillStyle = '#FAF7F2';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 4;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#1A1A1A';
    ctx.font = '800 13px "Space Grotesk", sans-serif';
    ctx.fillText('ÇİZGİ ŞAMPİYONU', cx, boxY + 32);

    if (this.matchWinner) {
      ctx.fillStyle = this.matchWinner.color;
      ctx.font = '900 24px "Space Grotesk", sans-serif';
      ctx.fillText(`${this.matchWinner.name} KAZANDI!`, cx, boxY + 68, boxW - 20);
    }

    ctx.font = '800 12px "JetBrains Mono", monospace';
    this.players.filter((player) => player.isJoined).forEach((player, row) => {
      ctx.fillStyle = player.color;
      ctx.fillText(`${player.name}: ${this.scores[player.index] || 0}★`, cx, boxY + 96 + row * 18);
    });

    const btnW = 180;
    const btnH = 42;
    const btnX = cx - btnW / 2;
    const btnY = boxY + 154;

    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(btnX, btnY, btnW, btnH);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 15px "Space Grotesk", sans-serif';
    ctx.fillText('YENİDEN OYNA', cx, btnY + btnH / 2);
    ctx.restore();
  }
}
