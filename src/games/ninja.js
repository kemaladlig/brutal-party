// BRUTAL NINJA: 2-4 oyunculu gölge avı — durunca görünmez ol, kılıç atılmasıyla
// tek vuruşta ele. Siper kutuları pusuya yatmaya yarar.
import { getSlotCustomization, getBotPersona } from '../core/customizationManager.js';
import { playExplosion, playStart, playJoin, playItemPickup } from '../audio.js';
import { t } from '../i18n.js';
import { renderFloatingTexts } from '../ui/hud.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { bindKeyboard } from '../core/keyboardDispatch.js';
import { updateNinjaBotAI } from '../ai/ninjaAI.js';
import { readSlotKeys, getSecondActionKey } from '../core/inputMaps.js';
import { isInputIntent, matchesInputAction } from '../core/inputIntent.js';
import { TILTED_25D_CAMERA } from '../core/projection2d.js';
import { createTiltedScene } from '../core/tiltedScene.js';
import { lobbyCenterStartTap, lobbyQuadrantTap, matchOverRestartTap } from '../core/touchFlow.js';
import { clampToArena, pointBlocked, resolveAABB, segmentCircleIntersection, segmentAabbIntersection } from '../core/physics2d.js';
import { beginRound, endMatch, tickRoundFlow } from '../core/roundLifecycle.js';
import { computePlayfield, fieldPx, fieldRadius, fieldSpeed } from '../core/playfield.js';
import {
  NINJA_RADIUS,
  createNinjaWorldPacket,
  drawNinjaArena,
  drawNinjaFrame,
  drawNinjaSteps,
  drawNinjaDecals,
  drawNinjaLanterns,
  drawNinjaGhosts,
  drawNinjaPlayers,
  drawNinjaSlashes,
  drawNinjaImpacts,
  drawNinjaFxLayer,
  NINJA_THEME_25D,
} from './ninjaView.js';
import { drawFxFlash } from './worldCore.js';
import { createFxRuntime } from '../core/fxRuntime.js';
import { fxFlashAlpha } from '../core/fxKit.js';

export const NINJA_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
export const NINJA_NAMES = ['P1', 'P2', 'P3', 'P4'];

const NINJA_STRIKE_COOLDOWN = 1.3;
const NINJA_SMOKE_COOLDOWN = 5.0;

export const NINJA_TUNING = {
  STRIKE_COOLDOWN: NINJA_STRIKE_COOLDOWN,
  SMOKE_COOLDOWN: NINJA_SMOKE_COOLDOWN,
  // Yürüyüş ve kılıç hamlesi TASARIM px/s. Kılıç MESAFESİ türetilir
  // (DASH_SPEED × DASH_TIME) ve kesik animasyonu bu mesafeyle birebir aynı
  // uzunlukta doğar: hamle kısa kaldığında animasyon havada asılı kalıyor,
  // hedef menzilden uzaktayken kılıç boşa savruluyordu.
  MOVE_SPEED: 210,
  DASH_SPEED: 820,
  DASH_TIME: 0.30,
  DASH_DIST: 246,
  STRIKE_REACH: 48,   // süpürülen bıçak yarıçapı (tasarım px)
  LANTERN_SLASH: 65,  // fener kesme menzili (tasarım px)
  SLASH_OUTER_R: 68,  // hilal dış yarıçapı
  SLASH_INNER_R: 22,  // hilal iç yarıçapı
};

/**
 * Fenerin GÖVDE yarıçapı (çarpışma/doğuş payı). Işık halesi (`lantern.radius`)
 * değil, gözle görülen çekirdek ölçüsünden türer; sahayla ölçeklenir.
 */
function lanternBodyRadius(arena) {
  return Math.max(10, fieldPx(arena, 16));
}

/**
 * Fener için ENGELE DEĞMEYEN bir doğuş noktası seçer.
 *
 * Ölçülen kusur: geri doğan fener `arena.cx, cy`'ye konuyordu — ama merkez
 * sütunu tam orayı kapsıyor. Fener engelin İÇİNDE kalıyor, çarpışma kodu
 * yalnız hızı çevirdiği için dışarı çıkamıyor ve merkezde titriyordu; oyuncu
 * kılıç menziline de giremediği için fener ölümsüzleşiyordu.
 *
 * Rastgele denemeler çoğu saha için yeter; yoğun saha yedeği dış halkada
 * açılı tarama yapar. Son çare olarak sol-üst köşe boşluğu döner (asla
 * engelin merkezine düşmemek, konumun güzel olmasından önceliklidir).
 */
function findOpenLanternSpot(arena, obstacles, clearance) {
  const minX = arena.left + clearance;
  const maxX = arena.right - clearance;
  const minY = arena.top + clearance;
  const maxY = arena.bottom - clearance;
  if (maxX > minX && maxY > minY) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = minX + Math.random() * (maxX - minX);
      const y = minY + Math.random() * (maxY - minY);
      if (!pointBlocked(x, y, obstacles, clearance)) return { x, y };
    }
  }
  const ring = arena.size * 0.4;
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2;
    const x = Math.max(minX, Math.min(maxX, arena.cx + Math.cos(ang) * ring));
    const y = Math.max(minY, Math.min(maxY, arena.cy + Math.sin(ang) * ring));
    if (!pointBlocked(x, y, obstacles, clearance)) return { x, y };
  }
  return { x: minX, y: minY };
}

export class NinjaGame extends BaseMiniGame {
  constructor(canvas) {
    super(canvas);
    this.arena = { cx: 0, cy: 0, size: 0, left: 0, right: 0, top: 0, bottom: 0 };
    // 2.5D sahne zarfı: kamera arena+viewport+sabit temadan sığdırılır; ONLINE
    // client AYNI sabitle aynı sahneyi kurar (sahne birebir eşleşir).
    this.scene = createTiltedScene({ camera: TILTED_25D_CAMERA.ninja });
    this.proj = this.scene.proj;
    this.slotTypes = ['human', 'bot_normal', 'empty', 'empty'];
    this.scores = [0, 0, 0, 0];
    // Maç hedefi ve raunt süresi — kısaltma (ninja.js).
// Gerekçe: parti oyununda maç uzunluğu = yeniden başlatma sayısı. Ölçülen
// durum: hedefler 2-5 arası dağınıktı ve bir kısmı 5'ti (NINJA/
// SNAKE/COLLAPSE/CURVE); ilk açılışta 5 hedef, dakikalar süren bir maç
// demek, yani oyuncu iki dakika içinde 'tekrar oynayalım' demiyor.
// Kural: çoğu oyun 2 hedefte biter (ilk-iki kuralı — bir parti turunda
// kazanan çabuk bellenir, maç tekrarına yer kalır). LOSER'a özgü
// süreler korunur: HORDE kill/süre oyunudur, onda hedef 2
// olmak turu anlamsız kılardı.
this.targetScore = 2;
    this.players = [];
    this.obstacles = [];
    this.lanterns = [];
    this.footsteps = [];
    // FX runtime (MOTION_PLAN Faz 2c): kesik/duman/fener kırığı olaylarının tek sahibi.
    this.fx = createFxRuntime({
      arenaProvider: () => this.arena,
      traumaSink: (amount, dirX, dirY) => this.addDirectionalTrauma(amount, dirX, dirY),
    });
    /** @type {any[]} */ this.particles = this.fx.particles;
    this.slashWaves = [];
    this.afterimages = [];
    this.cutDecals = [];
    this.impactCuts = [];
    this.floatingTexts = [];
    this.roundTime = 45;
    this.roundId = 0;
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.tiedRounds = 0;
    this.keys = {};
    this.roundTransitionTimer = 0;

    this.initKeyboard();
  }

  getTabletopSchema() {
    return {
      ...this.getCentralTabletopLayout('NINJA'),
      actions: [
        {
          id: 'strike',
          icon: '🗡️',
          cooldownField: 'strikeCooldown',
          maxCooldown: NINJA_STRIKE_COOLDOWN,
        },
        {
          id: 'smoke',
          icon: '💨',
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
    if (actionId === 'strike') {
      this.attemptStrike(player);
    } else if (actionId === 'smoke') {
      this.attemptSmoke(player);
    }
  }

  createWorldPacket() {
    return createNinjaWorldPacket(this);
  }

  initKeyboard() {
    bindKeyboard(this, {
      keydown: (e) => {
        if (!this.isLocalInputActive) return;
        this.keys[e.code] = true;
      },
      keyup: (e) => {
        this.keys[e.code] = false;
      },
    });
  }

  keyboardInput(index) {
    const base = readSlotKeys(this.keys, index);
    return { ...base, smoke: !!this.keys[getSecondActionKey('smoke', index)] };
  }

  resize(width, height) {
    this.updateViewport(width, height);
    const oldArena = { ...this.arena };
    const activeLanterns = this.lanterns.map((lantern) => ({ ...lantern }));

    this.arena = computePlayfield(width, height, 'standard');

    this.buildMap();
    // Arena değişti: eski koordinatlı FX atılır.
    this.fx.clear();

    if (this.state === 'LOBBY' || !this.players.length) {
      this.initPlayers();
      return;
    }
    if (activeLanterns.length > 0) {
      this.lanterns = activeLanterns.map((lantern) => {
        const mapped = { ...lantern };
        this.remapPoint(mapped, oldArena, this.arena);
        clampToArena(mapped, mapped.radius || 8, this.arena);
        return mapped;
      });
    }
    for (const p of this.players) {
      p.botTargetX = this.arena.cx;
      p.botTargetY = this.arena.cy;
      this.remapPoint(p, oldArena, this.arena);
      clampToArena(p, p.radius, this.arena);
      resolveAABB(p, this.obstacles, p.radius);
    }
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

    const lanternSpeed = fieldSpeed(this.arena, 114);
    const bodyR = lanternBodyRadius(this.arena);
    this.lanternBodyR = bodyR;
    const clearance = bodyR + fieldPx(this.arena, 6);
    const startAngles = [Math.PI * 0.22, Math.PI * 0.78, Math.PI * 1.45];
    for (let i = 0; i < 3; i++) {
      const ang = startAngles[i];
      const spd = lanternSpeed * (0.85 + Math.random() * 0.3);
      const spot = findOpenLanternSpot(this.arena, this.obstacles, clearance);
      this.lanterns.push({
        x: spot.x,
        y: spot.y,
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
        // Yarıçap sabit DEĞİLDİR: motor sahayla birlikte ölçekler, view
        // `player.radius` okur, world packet taşır (ARCHER ile aynı desen).
        radius: fieldRadius(this.arena, NINJA_RADIUS, 0),
        speed: fieldSpeed(this.arena, NINJA_TUNING.MOVE_SPEED), steerX: 0, steerY: 0,
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
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.roundId = 0;
    this.tiedRounds = 0;
    this.roundTime = 45;
    this.roundTransitionTimer = 0;
    this.fx.clear();
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
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.tiedRounds = 0;
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
    this.matchWinner = null;
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.roundId += 1;
    this.roundTransitionTimer = 0;
    this.roundTime = 45;
    this.fx.clear();
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

  finishRound(winner, reason = 'elimination', awardPoint = false) {
    if (this.state !== 'PLAYING') return;
    if (winner) {
      this.roundWinner = winner;
      this.tiedRounds = 0;
      if (awardPoint) this.scores[winner.index] += 1;
      if (this.scores[winner.index] >= this.targetScore) this.matchWinner = winner;
      beginRound(this, winner, reason);
      return;
    }

    this.tiedRounds += 1;
    if (!this.players.some((p) => p.isJoined) || this.tiedRounds >= 2) {
      endMatch(this, null, reason);
      return;
    }
    beginRound(this, null, reason);
  }

  resolveTimeout() {
    const alive = this.players.filter((p) => p.isJoined && p.isAlive);
    if (alive.length === 1) this.finishRound(alive[0], 'timeout', true);
    else this.finishRound(null, 'timeout');
  }

  attemptStrike(player) {
    if (this.state !== 'PLAYING' || !player.isJoined || !player.isAlive) return;
    if (player.strikeCooldown <= 0) {
      const unit = this.arena.unit;
      // Animasyon menzili = kılıç mesafesi. Hamle `fieldSpeed × DASH_TIME`
      // kadar yol alır; kesik de tam olarak o kadar uzanır.
      const dashDist = fieldPx(this.arena, NINJA_TUNING.DASH_DIST);
      player.strikeTimer = NINJA_TUNING.DASH_TIME;
      player.strikeCooldown = NINJA_STRIKE_COOLDOWN;
      player.alpha = 1.0;
      player.hideTimer = 0;
      playItemPickup();
      // Kılıç savuruşu: `hit` olayı (yönlü travma + halka) — eski 0.3 travma
      // profilin 0.2 tavanına indi, karşılığında hit-stop + halka geldi.
      this.fx.emit('hit', {
        x: player.x, y: player.y, color: player.color,
        dirX: Math.cos(player.angle), dirY: Math.sin(player.angle),
        slot: player.index, haptic: player.slotType === 'human',
      });

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
        maxDist: dashDist,
        outerRadius: fieldPx(this.arena, NINJA_TUNING.SLASH_OUTER_R),
        innerRadius: fieldPx(this.arena, NINJA_TUNING.SLASH_INNER_R),
        arcSpan: Math.PI * 0.82,
        waves: [
          { delay: 0.0, spd: 540, color: '#FFFFFF', aura: player.color, scale: 1.0, width: 4.5 * unit },
          { delay: 0.07, spd: 430, color: player.color, aura: '#FFFFFF', scale: 0.85, width: 3.2 * unit },
          { delay: 0.14, spd: 330, color: 'rgba(255, 255, 255, 0.8)', aura: player.color, scale: 0.7, width: 2.2 * unit },
        ],
      });

      // 2. Zemin Boyutsal Kesik İzi (Ground Slash Fissure Decal - Baştan uca çekilip küçülen anime kesik izi)
      this.cutDecals.push({
        x: player.x,
        y: player.y,
        angle: player.angle,
        length: dashDist,
        color: player.color,
        life: 0,
        maxLife: 0.44,
        maxWidth: 5.5 * unit,
      });

      // 3. Yüksek Hızlı Yönlü Bıçak Kıvılcımları & Parıltılar
      this.spawnSlashSparks(player.x, player.y, player.angle, player.color);

      // 4. İlk gölge klon izi
      this.spawnAfterimage(player);

      // Kılıç savururken menzildeki feneri anında kes
      if (this.lanterns) {
        const lanternReach = fieldPx(this.arena, NINJA_TUNING.LANTERN_SLASH);
        for (const lantern of this.lanterns) {
          if (!lantern.active) continue;
          if (Math.hypot(player.x - lantern.x, player.y - lantern.y) < lanternReach) {
            lantern.active = false;
            lantern.respawnTimer = 7.0;
            // Fener kırığı: `kill` olayı (fener ölür — ekran seviyesi an).
            this.fx.emit('kill', {
              x: lantern.x, y: lantern.y, color: '#FFD700', size: lantern.radius || 60,
              slot: player.index, haptic: player.slotType === 'human',
            });
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
      // Duman: `zone` olayı (halka + travma) — eski 0.22 → profil 0.16.
      this.fx.emit('zone', {
        x: player.x, y: player.y, color: player.color,
        slot: player.index, haptic: player.slotType === 'human',
      });
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

  // Duman: profil `zone` (halka) + `dust` (bulut) çifti — eski 36 parçacıklı
  // girdap artık kademeli (fxParticleScale) burst üretir.
  spawnSmoke(x, y, color, count = 30) {
    this.fx.emit('dust', { x, y, color });
  }

  spawnSlashSparks(x, y, angle, color) {
    // İleriye doğru keskin jilet kıvılcımı: `spark` (yönlü burst).
    this.fx.emit('spark', {
      x: x + Math.cos(angle) * 16,
      y: y + Math.sin(angle) * 16,
      color,
      dirX: Math.cos(angle), dirY: Math.sin(angle),
    });
  }

  spawnLanternBreak(x, y) {
    // Parça kırılması: `spark` + `dust` (kırık cam hissi).
    this.fx.emit('spark', { x, y, color: '#FFD700' });
    this.fx.emit('dust', { x, y, color: '#1A1A1A' });
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
      matchOverRestartTap(this, touch, { onRestart: () => { this.startNewMatch(); playJoin(); } });
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
    const rawDt = this.clampDt(now, this.lastTime);
    this.lastTime = now;
    // Hit-stop TEK SAAT: host karesi yavaşlar, kumanda aynı kareyi görür (§2).
    const dt = this.fx.tick(rawDt);
    this.updateTrauma(dt);
    this.fx.update(dt);

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

      // İlerleme sırasında hafif mikro kıvılcımlar (`spark` olayı)
      if (Math.random() < 0.35 && prog < 0.7) {
        const curX = sw.x + Math.cos(sw.angle) * sw.dist;
        const curY = sw.y + Math.sin(sw.angle) * sw.dist;
        this.fx.emit('spark', {
          x: curX,
          y: curY,
          color: sw.color,
          dirX: Math.cos(sw.angle), dirY: Math.sin(sw.angle),
        });
      }

      if (sw.life >= sw.maxLife) this.slashWaves.splice(i, 1);
    }

    if (tickRoundFlow(this, dt)) return;

    if (this.state !== 'PLAYING') return;

    // Fizik Tabanlı Seken Fenerler
    const lanternBodyR = this.lanternBodyR || lanternBodyRadius(this.arena);
    const wallPad = lanternBodyR + fieldPx(this.arena, 6);
    for (const lantern of this.lanterns) {
      if (!lantern.active) {
        lantern.respawnTimer -= dt;
        if (lantern.respawnTimer <= 0) {
          lantern.active = true;
          // Engelin içine değil, AÇIK bir noktaya doğ (merkez sütunu değil).
          const spot = findOpenLanternSpot(
            this.arena,
            this.obstacles,
            lanternBodyR + fieldPx(this.arena, 6),
          );
          lantern.x = spot.x;
          lantern.y = spot.y;
          const ang = Math.random() * Math.PI * 2;
          const spd = fieldSpeed(this.arena, 114);
          lantern.vx = Math.cos(ang) * spd;
          lantern.vy = Math.sin(ang) * spd;
        }
        continue;
      }

      lantern.x += lantern.vx * dt;
      lantern.y += lantern.vy * dt;

      // Arena duvar sekmesi (pay gövde yarıçapıyla ölçeklenir).
      if (lantern.x < this.arena.left + wallPad) {
        lantern.x = this.arena.left + wallPad;
        lantern.vx = Math.abs(lantern.vx);
      } else if (lantern.x > this.arena.right - wallPad) {
        lantern.x = this.arena.right - wallPad;
        lantern.vx = -Math.abs(lantern.vx);
      }
      if (lantern.y < this.arena.top + wallPad) {
        lantern.y = this.arena.top + wallPad;
        lantern.vy = Math.abs(lantern.vy);
      } else if (lantern.y > this.arena.bottom - wallPad) {
        lantern.y = this.arena.bottom - wallPad;
        lantern.vy = -Math.abs(lantern.vy);
      }

      // Engel sekmesi: feneri önce dışarı TAŞI, sonra normal boyunca yansıt.
      // Eski kod yalnız hızı çeviriyordu; fener engelin içinde kalınca her
      // karede yön değiştirip kilitleniyordu ("engelde hapsolan ışık").
      for (const obs of this.obstacles) {
        const closestX = Math.max(obs.x, Math.min(lantern.x, obs.x + obs.w));
        const closestY = Math.max(obs.y, Math.min(lantern.y, obs.y + obs.h));
        let nx = lantern.x - closestX;
        let ny = lantern.y - closestY;
        let dist = Math.hypot(nx, ny);
        if (dist >= lanternBodyR) continue;

        if (dist > 0.001) {
          nx /= dist;
          ny /= dist;
          const push = lanternBodyR - dist;
          lantern.x += nx * push;
          lantern.y += ny * push;
        } else {
          // Merkez engelin İÇİNDE: en yakın yüzden dışarı it.
          const dx1 = lantern.x - obs.x;
          const dx2 = (obs.x + obs.w) - lantern.x;
          const dy1 = lantern.y - obs.y;
          const dy2 = (obs.y + obs.h) - lantern.y;
          const minD = Math.min(dx1, dx2, dy1, dy2);
          if (minD === dx1) { nx = -1; ny = 0; lantern.x = obs.x - lanternBodyR; }
          else if (minD === dx2) { nx = 1; ny = 0; lantern.x = obs.x + obs.w + lanternBodyR; }
          else if (minD === dy1) { nx = 0; ny = -1; lantern.y = obs.y - lanternBodyR; }
          else { nx = 0; ny = 1; lantern.y = obs.y + obs.h + lanternBodyR; }
        }

        // Normal boyunca yansı (yalnız içeri giren bileşen çevrilir).
        const dot = lantern.vx * nx + lantern.vy * ny;
        if (dot < 0) {
          lantern.vx -= 2 * dot * nx;
          lantern.vy -= 2 * dot * ny;
        }
        // Sekme açısına hafif gürültü + hızı koru.
        const angNoise = (Math.random() - 0.5) * 0.25;
        const curAng = Math.atan2(lantern.vy, lantern.vx) + angNoise;
        const spd = Math.hypot(lantern.vx, lantern.vy) || fieldSpeed(this.arena, 114);
        lantern.vx = Math.cos(curAng) * spd;
        lantern.vy = Math.sin(curAng) * spd;
        break;
      }
    }

    this.roundTime = Math.max(0, this.roundTime - dt);
    if (this.roundTime <= 0) {
      this.resolveTimeout();
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

      const prevX = player.x;
      const prevY = player.y;
      player.prevX = prevX;
      player.prevY = prevY;
      const spd = player.strikeTimer > 0
        ? fieldSpeed(this.arena, NINJA_TUNING.DASH_SPEED)
        : player.speed;

      if (player.strikeTimer <= 0) {
        player.x += player.steerX * spd * dt;
        player.y += player.steerY * spd * dt;
      } else {
        player.x += Math.cos(player.angle) * spd * dt;
        player.y += Math.sin(player.angle) * spd * dt;
      }

      clampToArena(player, player.radius, this.arena);
      const postX = player.x;
      const postY = player.y;
      resolveAABB(player, this.obstacles, player.radius);
      if (player.strikeTimer > 0 && (player.x !== postX || player.y !== postY)) {
        player.strikeTimer = 0;
      }
    }

    // Kılıç isabeti & Eleme
    const strikeReach = fieldPx(this.arena, NINJA_TUNING.STRIKE_REACH);
    for (const attacker of this.players) {
      if (!attacker.isJoined || !attacker.isAlive || attacker.strikeTimer <= 0) continue;

      for (const victim of this.players) {
        if (!victim.isJoined || !victim.isAlive || victim.index === attacker.index) continue;

        const hit = segmentCircleIntersection(attacker.prevX ?? attacker.x, attacker.prevY ?? attacker.y, attacker.x, attacker.y, victim.x, victim.y, strikeReach);
        const blocked = hit && this.obstacles.some((obs) => segmentAabbIntersection(attacker.prevX ?? attacker.x, attacker.prevY ?? attacker.y, hit.x, hit.y, obs));
        if (hit && !blocked) {
          victim.isAlive = false;
          attacker.strikeTimer = 0;
          this.scores[attacker.index]++;
          // Eleme: `kill` olayı (ekran seviyesi an) — travma 0.55 → 0.4 tavanı.
          this.fx.emit('kill', {
            x: victim.x, y: victim.y, color: victim.color, size: NINJA_RADIUS,
            angle: attacker.angle,
            dirX: victim.x - attacker.x, dirY: victim.y - attacker.y,
            slot: victim.index, haptic: victim.slotType === 'human',
          });
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
            text: `${attacker.name} +1★`,
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
    if (this.state !== 'PLAYING') {
      player.steerX = 0;
      player.steerY = 0;
      player.remoteActive = false;
      return;
    }

    if (isInputIntent(data, 'move') || data.action === 'JOYSTICK_MOVE' || data.action === 'MOVE') {
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
    } else if (matchesInputAction(data, 'strike', 'DASH') || data.action === 'STRIKE') {
      this.attemptStrike(player);
    } else if (matchesInputAction(data, 'smoke', 'NINJA_SMOKE')) {
      this.attemptSmoke(player);
    }
  }

  handleRoundEnd(winner) {
    this.finishRound(winner, 'elimination', false);
  }

  render() {
    const { ctx } = this;
    const now = performance.now();
    ctx.save();

    // 2.5D sahne zarfı: masa zemini `drawField25d` içinde boyanır (paintBackdrop
    // çizilmez). Tema sabittir; ONLINE client aynı sabitle aynı sahneyi kurar.
    this.scene.open(ctx, {
      viewport: this.viewport,
      arena: this.arena,
      theme: NINJA_THEME_25D,
    });
    this.applyScreenShake(ctx);

    // Arena sahnesi ortak ninjaView draw'larından gelir (host↔client aynı).
    const withFx = this.state === 'PLAYING';
    drawNinjaArena(ctx, this.arena, { roundId: this.roundId, proj: this.proj });
    drawNinjaSteps(ctx, this.footsteps, this.proj);

    drawNinjaDecals(ctx, this.cutDecals, this.proj);
    drawNinjaLanterns(ctx, this.lanterns, now, this.proj);
    drawNinjaFrame(ctx, this.arena, this.obstacles, this.proj);

    drawNinjaGhosts(ctx, this.afterimages, this.proj);

    // Oyuncular (görünmezlik: yerel girişte tüm insanlara hayalet, client'ta yalnız selfSlot)
    const ghostSlots = this.isLocalInputActive
      ? this.players.filter((p) => p.slotType === 'human').map((p) => p.index)
      : [];
    drawNinjaPlayers(ctx, this.players.map((p) => ({
      ...p,
      slot: p.index,
      strike: (p.strikeTimer || 0) > 0,
      strikeProg: (p.strikeCooldown || 0) > 0
        ? 1 - Math.min(1, p.strikeCooldown / NINJA_TUNING.STRIKE_COOLDOWN) : null,
      smokeProg: (p.smokeCooldown || 0) > 0
        ? 1 - Math.min(1, p.smokeCooldown / NINJA_TUNING.SMOKE_COOLDOWN) : null,
    })), { ghostSlots, withFx, now: this.lastTime, selfSlot: this.localControlSlot ?? -1, proj: this.proj });

    drawNinjaSlashes(ctx, this.slashWaves, this.arena, this.proj);
    drawNinjaImpacts(ctx, this.impactCuts, this.proj);
    // FX katmanı ortak ninjaView draw'ından gelir (host↔client aynı).
    drawNinjaFxLayer(ctx, { pops: this.fx.pops, rings: this.fx.rings, particles: this.particles }, this.proj);
    this.scene.close(ctx);

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
        .map((p) => ({ color: p.color, name: p.name, value: `${this.scores[p.index]}★`, score: this.scores[p.index] })),
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

    // Eleme flaşı sahne transformunun DIŞINDA: tam ekranı kaplar.
    const flashAlpha = fxFlashAlpha(this.fx.flash, this.fx.flashPeak);
    if (flashAlpha > 0) drawFxFlash(ctx, this.viewport.width, this.viewport.height, flashAlpha);
  }
}
