// BRUTAL NINJA: 2-4 oyunculu gölge avı — durunca görünmez ol, kılıç atılmasıyla
// tek vuruşta ele. Siper kutuları pusuya yatmaya yarar.
import { getSlotCustomization, getBotPersona } from '../core/customizationManager.js';
import { playExplosion, playStart, playJoin, playItemPickup } from '../audio.js';
import { t } from '../i18n.js';
import { renderFloatingTexts } from '../ui/hud.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { drawObstacle } from '../core/arenaKit.js';
import { updateNinjaBotAI } from '../ai/ninjaAI.js';
import { drawGameAvatar } from '../core/avatarInGame.js';
import { readSlotKeys, getSecondActionKey } from '../core/inputMaps.js';
import { lobbyCenterStartTap, lobbyQuadrantTap, matchOverRestartTap } from '../core/touchFlow.js';
import { clampToArena, resolveAABB } from '../core/physics2d.js';

export const NINJA_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
export const NINJA_NAMES = ['P1', 'P2', 'P3', 'P4'];

const NINJA_STRIKE_COOLDOWN = 1.3;
const NINJA_SMOKE_COOLDOWN = 5.0;
const NINJA_RADIUS = 18;

export const NINJA_TUNING = {
  STRIKE_COOLDOWN: NINJA_STRIKE_COOLDOWN,
  SMOKE_COOLDOWN: NINJA_SMOKE_COOLDOWN,
};

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
    this.slashWaves = [];
    this.afterimages = [];
    this.cutDecals = [];
    this.impactCuts = [];
    this.floatingTexts = [];
    this.roundTime = 40;
    this.keys = {};
    this.roundTransitionTimer = 0;

    this.initKeyboard();
  }

  getTabletopSchema() {
    return {
      joystick: true,
      actions: [
        {
          id: 'action',
          icon: '🗡️',
          label: 'ATIL',
          cooldownField: 'strikeCooldown',
          maxCooldown: NINJA_STRIKE_COOLDOWN,
        },
        {
          id: 'smoke',
          icon: '💨',
          label: 'SİS',
          color: '#6366F1',
          cooldownField: 'smokeCooldown',
          maxCooldown: NINJA_SMOKE_COOLDOWN,
        },
      ],
    };
  }

  handleSlotAction(slotIndex, actionId, isDown) {
    if (!isDown) return;
    const player = this.players[slotIndex];
    if (!player || !player.isJoined || !player.isAlive || player.slotType !== 'human') return;
    if (actionId === 'action') {
      this.attemptStrike(player);
    } else if (actionId === 'smoke') {
      this.attemptSmoke(player);
    }
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
    const base = readSlotKeys(this.keys, index);
    return { ...base, smoke: !!this.keys[getSecondActionKey('smoke', index)] };
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

    const lanternSpeed = Math.max(55, size * 0.12);
    const startAngles = [Math.PI * 0.22, Math.PI * 0.78, Math.PI * 1.45];
    const startPositions = [
      { x: cx - size * 0.22, y: cy - size * 0.18 },
      { x: cx + size * 0.22, y: cy + size * 0.18 },
      { x: cx, y: cy - size * 0.28 },
    ];
    for (let i = 0; i < 3; i++) {
      const ang = startAngles[i];
      const spd = lanternSpeed * (0.85 + Math.random() * 0.3);
      this.lanterns.push({
        x: startPositions[i].x,
        y: startPositions[i].y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        radius: bw * 0.95,
        active: true,
        respawnTimer: 0,
      });
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
      const existing = this.players[i];
      const custom = getSlotCustomization(i);
      const isBot = this.slotTypes[i] === 'bot_normal' || this.slotTypes[i] === 'bot_god';
      const isGod = this.slotTypes[i] === 'bot_god';
      const persona = isBot ? getBotPersona(i, isGod) : null;
      return {
        index: i,
        name: existing?.name || (isBot ? persona.name : `P${i + 1}`),
        color: isBot ? persona.color : (custom.color || NINJA_COLORS[i]),
        x: s.x, y: s.y, angle: 0,
        speed: 145, steerX: 0, steerY: 0,
        isAlive: true, isJoined: this.isSlotJoined(i), slotType: this.slotTypes[i],
        alpha: 1.0, hideTimer: 0, inLight: false,
        strikeTimer: 0, strikeCooldown: 0,
        smokeTimer: 0, smokeCooldown: 0,
        afterimageSpawnTimer: 0,
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
    this.slashWaves = [];
    this.afterimages = [];
    this.cutDecals = [];
    this.impactCuts = [];
    this.floatingTexts = [];
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
    this.slashWaves = [];
    this.afterimages = [];
    this.cutDecals = [];
    this.impactCuts = [];
    this.floatingTexts = [];
    this.footsteps = [];
    if (this.lanterns) {
      this.lanterns.forEach((l) => {
        l.active = true;
        l.respawnTimer = 0;
      });
    }
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
      player.afterimageSpawnTimer = 0;
      player.steerX = 0;
      player.steerY = 0;
      player.botState = 'HIDE';
      player.botTimer = 0.5;
    });
  }

  attemptStrike(player) {
    if (this.state !== 'PLAYING' || !player.isAlive) return;
    if (player.strikeCooldown <= 0) {
      player.strikeTimer = 0.28;
      player.strikeCooldown = NINJA_STRIKE_COOLDOWN;
      player.alpha = 1.0;
      player.hideTimer = 0;
      playItemPickup();
      this.addTrauma(0.3);

      // 1. Dalga dalga yayılan çok katmanlı kesik şok dalgaları (Multi-stage Dimensional Crescent Slashes)
      this.slashWaves.push({
        x: player.x,
        y: player.y,
        angle: player.angle,
        color: player.color,
        playerIndex: player.index,
        life: 0,
        maxLife: 0.52,
        dist: 0,
        maxDist: 220,
        outerRadius: 68,
        innerRadius: 22,
        arcSpan: Math.PI * 0.82,
        waves: [
          { delay: 0.0, spd: 540, color: '#FFFFFF', aura: player.color, scale: 1.0, width: 4.5 },
          { delay: 0.07, spd: 430, color: player.color, aura: '#FFFFFF', scale: 0.85, width: 3.2 },
          { delay: 0.14, spd: 330, color: 'rgba(255, 255, 255, 0.8)', aura: player.color, scale: 0.7, width: 2.2 },
        ],
      });

      // 2. Zemin Boyutsal Kesik İzi (Ground Slash Fissure Decal - Baştan uca çekilip küçülen anime kesik izi)
      this.cutDecals.push({
        x: player.x,
        y: player.y,
        angle: player.angle,
        length: 220,
        color: player.color,
        life: 0,
        maxLife: 0.44,
        maxWidth: 5.5,
      });

      // 3. Yüksek Hızlı Yönlü Bıçak Kıvılcımları & Parıltılar
      this.spawnSlashSparks(player.x, player.y, player.angle, player.color);

      // 4. İlk gölge klon izi
      this.spawnAfterimage(player);

      // Kılıç savururken menzildeki feneri anında kes
      if (this.lanterns) {
        for (const lantern of this.lanterns) {
          if (!lantern.active) continue;
          if (Math.hypot(player.x - lantern.x, player.y - lantern.y) < 65) {
            lantern.active = false;
            lantern.respawnTimer = 7.0;
            this.addTrauma(0.35);
            playExplosion();
            this.spawnLanternBreak(lantern.x, lantern.y);
            this.impactCuts.push({
              x: lantern.x,
              y: lantern.y,
              angle: player.angle,
              color: player.color,
              life: 0,
              maxLife: 0.35,
            });
          }
        }
      }
    }
  }

  attemptSmoke(player) {
    if (this.state !== 'PLAYING' || !player.isAlive) return;
    if (player.smokeCooldown <= 0) {
      player.smokeCooldown = NINJA_SMOKE_COOLDOWN;
      player.smokeTimer = 2.4;
      player.alpha = 0.0;
      player.hideTimer = 1.2;
      playExplosion();
      this.spawnSmoke(player.x, player.y, player.color, 36);
      this.addTrauma(0.22);
    }
  }

  spawnAfterimage(player) {
    this.afterimages.push({
      x: player.x,
      y: player.y,
      angle: player.angle,
      color: player.color,
      index: player.index,
      alpha: 0.75,
      decay: 3.6,
    });
  }

  spawnSmoke(x, y, color, count = 30) {
    // 1. Duman şok dalgası halkası
    this.particles.push({
      type: 'shockRing',
      x, y,
      radius: 8,
      maxRadius: 48,
      color: color,
      alpha: 0.9,
      decay: 2.5,
    });

    // 2. Girdaplı duman bulutları ve parçacıkları
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 20 + Math.random() * 110;
      this.particles.push({
        type: 'smoke',
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        color: i % 3 === 0 ? color : (i % 2 === 0 ? '#1A1A1A' : '#444444'),
        radius: 6 + Math.random() * 9,
        alpha: 0.95,
        decay: 1.2 + Math.random() * 0.8,
      });
    }
  }

  spawnSlashSparks(x, y, angle, color) {
    // İleriye doğru 18 adet keskin jilet kıvılcımı
    for (let i = 0; i < 18; i++) {
      const pAngle = angle + (Math.random() - 0.5) * 1.4;
      const spd = 120 + Math.random() * 220;
      this.particles.push({
        type: 'spark',
        x: x + Math.cos(angle) * 16,
        y: y + Math.sin(angle) * 16,
        vx: Math.cos(pAngle) * spd,
        vy: Math.sin(pAngle) * spd,
        color: i % 2 === 0 ? '#FFFFFF' : color,
        radius: 2 + Math.random() * 2.5,
        alpha: 1.0,
        decay: 3.5 + Math.random() * 1.5,
      });
    }
  }

  spawnLanternBreak(x, y) {
    for (let i = 0; i < 22; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 80 + Math.random() * 180;
      this.particles.push({
        type: 'shard',
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        color: i % 3 === 0 ? '#1A1A1A' : (i % 2 === 0 ? '#FFD700' : '#E63946'),
        radius: 3 + Math.random() * 3.5,
        alpha: 1.0,
        decay: 2.2,
      });
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
      this.handleTabletopTouchStart(touch);
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

    // Ayak izleri
    for (let i = this.footsteps.length - 1; i >= 0; i--) {
      const f = this.footsteps[i];
      f.alpha -= dt * 1.1;
      if (f.alpha <= 0) this.footsteps.splice(i, 1);
    }

    // Gölge klon izleri (Afterimages)
    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      const img = this.afterimages[i];
      img.alpha -= img.decay * dt;
      if (img.alpha <= 0) this.afterimages.splice(i, 1);
    }

    // Zemin kesik çizgileri (Cut Decals - Baştan uca çekilerek küçülen anime kesik izi)
    for (let i = this.cutDecals.length - 1; i >= 0; i--) {
      const cd = this.cutDecals[i];
      cd.life += dt;
      if (cd.life >= cd.maxLife) this.cutDecals.splice(i, 1);
    }

    // Çarpışma kesik patlamaları (Impact Cuts)
    for (let i = this.impactCuts.length - 1; i >= 0; i--) {
      const ic = this.impactCuts[i];
      ic.life += dt;
      if (ic.life >= ic.maxLife) this.impactCuts.splice(i, 1);
    }

    // Dalga dalga kesik animasyonları (Slash Waves)
    for (let i = this.slashWaves.length - 1; i >= 0; i--) {
      const sw = this.slashWaves[i];
      sw.life += dt;
      const prog = Math.min(1.0, sw.life / sw.maxLife);
      sw.dist = (1 - Math.pow(1 - prog, 2.5)) * sw.maxDist;

      // İlerleme sırasında hafif mikro kıvılcımlar
      if (Math.random() < 0.35 && prog < 0.7) {
        const curX = sw.x + Math.cos(sw.angle) * sw.dist;
        const curY = sw.y + Math.sin(sw.angle) * sw.dist;
        const pAng = sw.angle + (Math.random() - 0.5) * 1.2;
        this.particles.push({
          type: 'spark',
          x: curX,
          y: curY,
          vx: Math.cos(pAng) * (70 + Math.random() * 90),
          vy: Math.sin(pAng) * (70 + Math.random() * 90),
          color: sw.color,
          radius: 1.8,
          alpha: 0.9,
          decay: 4.5,
        });
      }

      if (sw.life >= sw.maxLife) this.slashWaves.splice(i, 1);
    }

    if (this.state === 'ROUND_OVER') {
      this.roundTransitionTimer -= dt;
      if (this.roundTransitionTimer <= 0) {
        this.matchWinner ? this.state = 'MATCH_OVER' : this.startRound();
      }
      return;
    }

    if (this.state !== 'PLAYING') return;

    // Fizik Tabanlı Seken Fenerler
    for (const lantern of this.lanterns) {
      if (!lantern.active) {
        lantern.respawnTimer -= dt;
        if (lantern.respawnTimer <= 0) {
          lantern.active = true;
          lantern.x = this.arena.cx;
          lantern.y = this.arena.cy;
          const ang = Math.random() * Math.PI * 2;
          const spd = Math.max(55, this.arena.size * 0.12);
          lantern.vx = Math.cos(ang) * spd;
          lantern.vy = Math.sin(ang) * spd;
        }
        continue;
      }

      lantern.x += lantern.vx * dt;
      lantern.y += lantern.vy * dt;

      // Arena duvar sekmesi
      if (lantern.x < this.arena.left + 8) {
        lantern.x = this.arena.left + 8;
        lantern.vx = Math.abs(lantern.vx);
      } else if (lantern.x > this.arena.right - 8) {
        lantern.x = this.arena.right - 8;
        lantern.vx = -Math.abs(lantern.vx);
      }
      if (lantern.y < this.arena.top + 8) {
        lantern.y = this.arena.top + 8;
        lantern.vy = Math.abs(lantern.vy);
      } else if (lantern.y > this.arena.bottom - 8) {
        lantern.y = this.arena.bottom - 8;
        lantern.vy = -Math.abs(lantern.vy);
      }

      // Engel sekmesi
      for (const obs of this.obstacles) {
        if (lantern.x > obs.x - 6 && lantern.x < obs.x + obs.w + 6 &&
            lantern.y > obs.y - 6 && lantern.y < obs.y + obs.h + 6) {
          const dx1 = lantern.x - obs.x;
          const dx2 = (obs.x + obs.w) - lantern.x;
          const dy1 = lantern.y - obs.y;
          const dy2 = (obs.y + obs.h) - lantern.y;
          const minD = Math.min(dx1, dx2, dy1, dy2);
          if (minD === dx1 || minD === dx2) lantern.vx *= -1;
          else lantern.vy *= -1;
          const angNoise = (Math.random() - 0.5) * 0.25;
          const curAng = Math.atan2(lantern.vy, lantern.vx) + angNoise;
          const spd = Math.hypot(lantern.vx, lantern.vy);
          lantern.vx = Math.cos(curAng) * spd;
          lantern.vy = Math.sin(curAng) * spd;
          break;
        }
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
          // Klavye bırakıldı: sadece kendi yazdığını siler (uzak/dokunmatik korunur)
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

      // Fener ışığı kontrolü
      let inLight = false;
      for (const lantern of this.lanterns) {
        if (!lantern.active) continue;
        if (Math.hypot(player.x - lantern.x, player.y - lantern.y) < lantern.radius) {
          inLight = true;
          break;
        }
      }
      player.inLight = inLight;

      const isMoving = player.steerX !== 0 || player.steerY !== 0 || player.strikeTimer > 0;

      // Dash sırasında gölge klon bırakma (Afterimages)
      if (player.strikeTimer > 0) {
        player.afterimageSpawnTimer = (player.afterimageSpawnTimer || 0) + dt;
        if (player.afterimageSpawnTimer > 0.04) {
          player.afterimageSpawnTimer = 0;
          this.spawnAfterimage(player);
        }
      }

      // Görünmezlik
      if (player.smokeTimer > 0) {
        player.smokeTimer -= dt;
        player.alpha = 0.0;
      } else if (inLight) {
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

      const spd = player.strikeTimer > 0 ? 780 : player.speed;

      if (player.strikeTimer <= 0) {
        player.x += player.steerX * spd * dt;
        player.y += player.steerY * spd * dt;
      } else {
        player.x += Math.cos(player.angle) * spd * dt;
        player.y += Math.sin(player.angle) * spd * dt;
      }

      clampToArena(player, NINJA_RADIUS, this.arena);
      const prevX = player.x;
      const prevY = player.y;
      resolveAABB(player, this.obstacles, NINJA_RADIUS);
      if (player.strikeTimer > 0 && (player.x !== prevX || player.y !== prevY)) {
        player.strikeTimer = 0;
      }
    }

    // Kılıç isabeti & Eleme
    for (const attacker of this.players) {
      if (!attacker.isJoined || !attacker.isAlive || attacker.strikeTimer <= 0) continue;

      for (const victim of this.players) {
        if (!victim.isJoined || !victim.isAlive || victim.index === attacker.index) continue;

        if (Math.hypot(attacker.x - victim.x, attacker.y - victim.y) < 48) {
          victim.isAlive = false;
          attacker.strikeTimer = 0;
          this.scores[attacker.index]++;
          this.addTrauma(0.55);
          playExplosion();

          // Çapraz X kesik patlaması
          this.impactCuts.push({
            x: victim.x,
            y: victim.y,
            angle: attacker.angle,
            color: attacker.color,
            life: 0,
            maxLife: 0.45,
          });

          this.spawnSmoke(victim.x, victim.y, victim.color, 32);
          this.spawnSlashSparks(victim.x, victim.y, attacker.angle, attacker.color);

          this.floatingTexts.push({
            x: victim.x,
            y: victim.y - 20,
            text: `⚔️ ${attacker.name} +1★`,
            color: attacker.color,
            bg: '#141416',
            pop: true,
            maxLife: 1.0,
          });

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
      if (p.type === 'shockRing') {
        p.radius += dt * 90;
        p.alpha -= p.decay * dt;
      } else {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.alpha -= p.decay * dt;
      }
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
    const now = performance.now();
    ctx.save();

    ctx.fillStyle = '#D6D3CD';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.applyScreenShake(ctx);

    const { left, top, width, height } = this.arena;
    ctx.fillStyle = '#E8E5DF';
    ctx.fillRect(left, top, width, height);

    // Ayak izleri
    for (const f of this.footsteps) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, f.alpha));
      ctx.fillStyle = '#9C988F';
      ctx.beginPath();
      ctx.arc(f.x, f.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Zemin Kesik Hatları (Ground Slash Fissure - Baştan uca çekilen / küçülen pürüzsüz enerji jileti)
    for (const cd of this.cutDecals) {
      const prog = Math.min(1.0, cd.life / cd.maxLife);
      // Uç noktası hızla öne fırlar (0.07 saniyede tam boya ulaşır)
      const headProg = Math.min(1.0, cd.life / 0.07);
      const headDist = (1 - Math.pow(1 - headProg, 2.5)) * cd.length;
      // Başlangıç noktası (kuyruk) arkadan öne doğru çekilerek küçülür (baştan uca toplanma)
      const tailProg = Math.max(0, Math.min(1.0, Math.pow(prog, 1.25)));
      const tailDist = tailProg * cd.length;

      if (tailDist >= headDist - 1) continue;

      const segLen = headDist - tailDist;
      const midDist = (tailDist + headDist) * 0.5;
      const fadeAlpha = 1.0 - Math.pow(prog, 1.8);
      const halfWidth = (cd.maxWidth * 0.5) * (1 - prog * 0.4) * Math.min(1.0, segLen / 30);

      ctx.save();
      ctx.translate(cd.x, cd.y);
      ctx.rotate(cd.angle);

      // 1. Dış Enerji Parıltısı (Soft blade aura glow)
      ctx.globalAlpha = fadeAlpha * 0.35;
      ctx.fillStyle = cd.color;
      ctx.beginPath();
      ctx.moveTo(tailDist, 0);
      ctx.lineTo(midDist, -halfWidth * 2.4);
      ctx.lineTo(headDist, 0);
      ctx.lineTo(midDist, halfWidth * 2.4);
      ctx.closePath();
      ctx.fill();

      // 2. Ana Katana Kesik Gövdesi (Tapered Energy Blade Polygon - Keskin elmas/iğne geometrisi)
      ctx.globalAlpha = fadeAlpha * 0.9;
      const bladeGrad = ctx.createLinearGradient(tailDist, 0, headDist, 0);
      bladeGrad.addColorStop(0, cd.color);
      bladeGrad.addColorStop(0.5, '#FFFFFF');
      bladeGrad.addColorStop(1, cd.color);
      ctx.fillStyle = bladeGrad;

      ctx.beginPath();
      ctx.moveTo(tailDist, 0);
      ctx.lineTo(midDist, -halfWidth);
      ctx.lineTo(headDist, 0);
      ctx.lineTo(midDist, halfWidth);
      ctx.closePath();
      ctx.fill();

      // 3. Parlak Beyaz Jilet Çekirdeği (Ultra-sharp Neon Laser Core)
      ctx.globalAlpha = fadeAlpha;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = Math.max(1.0, halfWidth * 0.7);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tailDist + 2, 0);
      ctx.lineTo(headDist - 1, 0);
      ctx.stroke();

      // 4. Uç Parıltı Yıldızı (Leading Glint)
      if (prog < 0.6) {
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(headDist, 0, Math.max(1.5, 3.5 * (1 - prog)), 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    // Fenerler ve Aydınlatma Alanı
    for (const lantern of this.lanterns) {
      if (!lantern.active) {
        ctx.save();
        ctx.fillStyle = '#2A2A2A';
        ctx.fillRect(lantern.x - 9, lantern.y - 9, 18, 18);
        ctx.strokeStyle = '#555555';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(lantern.x - 9, lantern.y - 9, 18, 18);

        const emberPulse = (Math.sin(now / 160) + 1) * 0.5;
        ctx.fillStyle = `rgba(230, 57, 70, ${0.4 + emberPulse * 0.5})`;
        ctx.beginPath();
        ctx.arc(lantern.x, lantern.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        continue;
      }

      ctx.save();
      const grad = ctx.createRadialGradient(lantern.x, lantern.y, 10, lantern.x, lantern.y, lantern.radius);
      grad.addColorStop(0, 'rgba(255, 215, 0, 0.28)');
      grad.addColorStop(0.7, 'rgba(255, 215, 0, 0.12)');
      grad.addColorStop(1, 'rgba(255, 215, 0, 0.0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(lantern.x, lantern.y, lantern.radius, 0, Math.PI * 2);
      ctx.fill();

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

    // Tapınak Siper Blokları
    for (const obs of this.obstacles) drawObstacle(ctx, obs, { variant: 'dark' });

    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 6;
    ctx.strokeRect(left, top, width, height);

    // Gölge Klon İzleri (Afterimages)
    for (const img of this.afterimages) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, img.alpha * 0.7));
      ctx.translate(img.x, img.y);
      ctx.rotate(img.angle);

      // Koyu siluet ninja
      ctx.fillStyle = '#1A1A1A';
      ctx.beginPath();
      ctx.arc(0, 0, NINJA_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = img.color;
      ctx.lineWidth = 2.0;
      ctx.stroke();

      // Klon parlama göz çizgisi
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(NINJA_RADIUS * 0.2, -3, 6, 2);
      ctx.fillRect(NINJA_RADIUS * 0.2, 1, 6, 2);

      ctx.restore();
    }

    // Oyuncular (Görünmezlik alphası ile)
    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      if (player.alpha <= 0.02) {
        if (player.slotType === 'human' && this.isLocalInputActive) {
          ctx.save();
          ctx.globalAlpha = 0.35;
          ctx.strokeStyle = player.color;
          ctx.lineWidth = 2;
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.arc(player.x, player.y, NINJA_RADIUS + 2, 0, Math.PI * 2);
          ctx.stroke();

          // Kendi ninjasının merkez göz odağı
          ctx.fillStyle = player.color;
          ctx.beginPath();
          ctx.arc(player.x, player.y, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        continue;
      }

      ctx.save();
      ctx.globalAlpha = player.alpha;
      ctx.translate(player.x, player.y);
      ctx.rotate(player.angle);

      drawGameAvatar(ctx, 0, 0, NINJA_RADIUS, player, {
        facingAngle: 0,
        expression: player.strikeTimer > 0 ? 'angry' : 'normal',
        borderColor: '#1A1A1A',
        borderWidth: 2.5,
      });

      // Saldırı (Katana Slash) ve Duman Bombası Cooldown Göstergeleri (Sahada her zaman net görünür)
      if (player.isAlive) {
        // 1. Katana Slash Cooldown Arkı
        if (player.strikeCooldown > 0) {
          const maxCd = NINJA_TUNING.STRIKE_COOLDOWN;
          const prog = 1.0 - Math.max(0, Math.min(1, player.strikeCooldown / maxCd));
          ctx.save();
          // Arka plan koyu ray
          ctx.strokeStyle = 'rgba(20, 20, 22, 0.4)';
          ctx.lineWidth = 3.5;
          ctx.beginPath();
          ctx.arc(0, 0, NINJA_RADIUS + 4, 0, Math.PI * 2);
          ctx.stroke();
          // Dolum arkı
          ctx.strokeStyle = '#F59E0B';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(0, 0, NINJA_RADIUS + 4, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        // 2. Duman Bombası Cooldown Arkı (Eğer beklemedeyse dış halka)
        if (player.smokeCooldown > 0) {
          const maxCd = NINJA_TUNING.SMOKE_COOLDOWN;
          const prog = 1.0 - Math.max(0, Math.min(1, player.smokeCooldown / maxCd));
          ctx.save();
          ctx.strokeStyle = 'rgba(100, 100, 110, 0.3)';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(0, 0, NINJA_RADIUS + 8, 0, Math.PI * 2);
          ctx.stroke();

          ctx.strokeStyle = '#A855F7';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(0, 0, NINJA_RADIUS + 8, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }

      ctx.restore();
    }

    // =========================================================================
    // GELİŞMİŞ BOYUTSAL DALGA DALGA KESİK ANİMASYONU (Dimensional Slash Waves)
    // =========================================================================
    for (const sw of this.slashWaves) {
      const prog = Math.min(1.0, sw.life / sw.maxLife);
      const fadeAlpha = Math.max(0, 1.0 - Math.pow(prog, 1.6));

      ctx.save();
      ctx.translate(sw.x, sw.y);
      ctx.rotate(sw.angle);

      // Her alt-dalga sırayla ve gecikmeli olarak öne doğru patlar
      for (let w = 0; w < sw.waves.length; w++) {
        const wave = sw.waves[w];
        if (sw.life < wave.delay) continue;

        const waveAge = sw.life - wave.delay;
        const waveProg = Math.min(1.0, waveAge / (sw.maxLife - wave.delay));
        const waveDist = (1 - Math.pow(1 - waveProg, 2.8)) * (sw.maxDist + w * 12);
        const waveRadius = sw.outerRadius * wave.scale * (0.8 + waveProg * 0.4);
        const innerRadius = sw.innerRadius * wave.scale;
        const arcSpread = sw.arcSpan * (1.1 - waveProg * 0.25);
        const startAng = -arcSpread / 2;
        const endAng = arcSpread / 2;
        const currentAlpha = fadeAlpha * (1.0 - waveProg * 0.45);

        ctx.save();
        ctx.translate(waveDist, 0);

        // 1. Rüzgar / Enerji Yayılım Koni Dalgası (Translucent Sonic Wind Cone)
        ctx.globalAlpha = currentAlpha * 0.22;
        ctx.fillStyle = wave.aura;
        ctx.beginPath();
        ctx.arc(0, 0, waveRadius + 8, startAng * 1.15, endAng * 1.15, false);
        ctx.arc(0, 0, Math.max(4, innerRadius - 6), endAng * 1.15, startAng * 1.15, true);
        ctx.closePath();
        ctx.fill();

        // 2. Hilal Şeklinde Keskin Bıçak Gövdesi (Crescent Blade Body)
        ctx.globalAlpha = currentAlpha * 0.95;
        const crescentGrad = ctx.createLinearGradient(0, -waveRadius, 0, waveRadius);
        crescentGrad.addColorStop(0, wave.aura);
        crescentGrad.addColorStop(0.5, '#FFFFFF');
        crescentGrad.addColorStop(1, wave.aura);
        ctx.fillStyle = crescentGrad;

        ctx.beginPath();
        ctx.arc(0, 0, waveRadius, startAng, endAng, false);
        ctx.arc(0, 0, innerRadius, endAng, startAng, true);
        ctx.closePath();
        ctx.fill();

        // 3. Neo-brutalist Koyu Dış Sınır
        ctx.strokeStyle = '#141416';
        ctx.lineWidth = wave.width + 1.5;
        ctx.stroke();

        // 4. Parlak Jilet Kenarı (Razor-Sharp Blade Edge)
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = wave.width;
        ctx.beginPath();
        ctx.arc(0, 0, waveRadius - 1, startAng, endAng, false);
        ctx.stroke();

        // 5. İki Uçtaki Katana Parıltı Yıldızları (Tip Sparkle Glints)
        const tip1X = Math.cos(startAng) * waveRadius;
        const tip1Y = Math.sin(startAng) * waveRadius;
        const tip2X = Math.cos(endAng) * waveRadius;
        const tip2Y = Math.sin(endAng) * waveRadius;

        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath(); ctx.arc(tip1X, tip1Y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(tip2X, tip2Y, 4, 0, Math.PI * 2); ctx.fill();

        ctx.strokeStyle = '#141416';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(tip1X, tip1Y, 4, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(tip2X, tip2Y, 4, 0, Math.PI * 2); ctx.stroke();

        ctx.restore();
      }

      ctx.restore();
    }

    // İsabet Kesik Patlamaları (Impact Cuts)
    for (const ic of this.impactCuts) {
      const p = ic.life / ic.maxLife;
      const alpha = 1.0 - p;
      const span = (1 - Math.pow(1 - p, 2)) * 36;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.translate(ic.x, ic.y);
      ctx.rotate(ic.angle);

      // Çapraz X Kesiği
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(-span, -span * 0.6); ctx.lineTo(span, span * 0.6);
      ctx.moveTo(-span * 0.6, span); ctx.lineTo(span * 0.6, -span);
      ctx.stroke();

      ctx.strokeStyle = ic.color;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(-span, -span * 0.6); ctx.lineTo(span, span * 0.6);
      ctx.moveTo(-span * 0.6, span); ctx.lineTo(span * 0.6, -span);
      ctx.stroke();
      ctx.restore();
    }

    // Parçacıklar (Duman / Kıvılcım / Şok Halkası)
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
      if (p.type === 'shockRing') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Havaya süzülen metin bildirimleri (+1★, KILIÇ ATIL, vb.)
    renderFloatingTexts(ctx, this.floatingTexts, 0.016);

    // =========================================================================
    // ARAYÜZDE SKİLL KULLANIMI VE DURUM GÖSTERGELERİ (HUD & ON-SCREEN CONTROLS)
    // =========================================================================
    if (this.state === 'PLAYING') {
      this.renderControls(ctx);
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

    this.renderHUD(ctx, {
      guideTitle: t('guide.ninja'),
      guideEntries: [
        'P1 [WASD/SPACE/E]',
        'P2 [OKLAR/ENTER/R-SHIFT]',
        'P3 [IJKL/O/U]',
        'P4 [TFGH/B/V]',
      ],
      colors: NINJA_COLORS,
      accent: '#D84727',
      matchOverHeadline: t('ninja.champ'),
      matchOverRows: this.players
        .filter((p) => p.isJoined)
        .map((p) => ({ color: p.color, text: `${p.name}: ${this.scores[p.index]}★` })),
      onRestart: () => this.startNewMatch(),
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
