// BRUTAL BOMB (Game 04): 2-4 Player Local Party Bomb Tag / Saatli Bomba
// 360° Floating Corner Joysticks, Passing Physics, Whiskers & Waypoint Steering, Tackle Dash, 3 Maps & Panic Phase
import { getSlotCustomization } from '../core/customizationManager.js';
import {
  playExplosion,
  playStart,
  playJoin,
  playBombTick,
  playBombPass,
  playTeleport,
  playSlip,
  playItemPickup,
  playDashWhoosh,
  playPanicHeartbeat,
  playStumble,
} from '../audio.js';
import { t } from '../i18n.js';
import { matchesInputAction } from '../core/inputIntent.js';
import { renderArenaWatermarkTimer, renderFloatingTexts } from '../ui/hud.js';
import { getUiScale } from '../ui/tokens.js';
import { pulse } from '../ui/motion.js';

import { BaseMiniGame } from '../core/BaseGame.js';
import { drawTabletopIcon } from '../core/tabletopIcons.js';
import { buildLayout } from '../core/arenaKit.js';
import { hashFieldSeed, paintBackdrop } from '../core/fieldKit.js';
import { updateBombBotAI } from '../ai/bombAI.js';
import { keyboardVectorFrom } from '../core/inputMaps.js';
import { lobbyCenterStartTap, lobbyQuadrantTap, matchOverRestartTap } from '../core/touchFlow.js';
import { clampToArena, damp, resolveAABB } from '../core/physics2d.js';
import { computePlayfield, fieldRadius, fieldSpeed } from '../core/playfield.js';
import { spawnPickup, collectPickups, tickPickupTimers } from '../core/pickupSystem.js';
import { createPlayer, tickEffectTimers, advancePlayer } from '../core/playerEntity.js';
import { beginDrawRound, beginRound, endMatch, roundTimedOut, tickRoundFlow } from '../core/roundLifecycle.js';
import {
  createBombWorldPacket,
  drawBombArena,
  drawBombBlast,
  drawBombInk,
  drawBombPickups,
  drawBombPlayers,
  drawBombFxLayer,
} from './bombView.js';
import { drawFxFlash } from './worldCore.js';
import { createFxRuntime } from '../core/fxRuntime.js';
import { fxFlashAlpha, emitFloatingText } from '../core/fxKit.js';

export const BOMB_COLORS = ['#D84727', '#2B5B84', '#D99B26', '#2D6A4F'];
export const BOMB_NAMES = ['P1', 'P2', 'P3', 'P4'];

// Depar bekleme süresi (sn) — triggerDash, entity HUD ve masa-ortası butonu aynı kaynaktan okur
const BOMB_DASH_COOLDOWN = 2.2;
// Raunt süresi kısaltıldı: ölçülen bekleme 90-120 sn bandındaydı, yani
// gerekçesiz bir raunt en az 1.5 dakika sürüyordu. Partide maç uzunluğu
// = yeniden başlatma sayısıdır; 60-75 sn bandı raunt bitiminde iki oyuncu
// arasındaki kararı anında ikinci maça taşır.
const BOMB_ROUND_LIMIT = 60;
// Üst üste bu kadar beraberlikte maç berabere kapanır.
const BOMB_MAX_TIED_ROUNDS = 2;
// Gövde yarıçapı (1920x1080 referansı). `fieldRadius` tabanı GÖRELİ: mutlak px
// tabanı küçük sahada varlığı şişiriyordu. Alt sınır zaten `minUnit` verir.
const BOMB_RADIUS = 36;

// Hareket bütçesi (tasarım px/sn ve sn). Sahayı geçiş süresi `952 / hız` sn'dir,
// çözünürlükten bağımsız. BOMB gövdesi 36 px — aktif oyunların en büyüğü —
// olduğu için hız, ARCHER'ın (198 / r28) "gövde/sn" değerine yaklaşacak şekilde
// seçildi: 175 → 200 (2.4 → 2.8 gövde/sn). Dash mesafesi 360×0.22 = 79 px
// (%8.3) ile HORDE'ın %11.4'ünün altındaydı; 430×0.26 = 112 px (%11.7) eşitler.
// Süreyi gereğinden az uzatıyoruz: BOMB'ta dash süresince hedefsiz duruyorsun.
const BOMB_TUNING = Object.freeze({
  MOVE_SPEED: 200,
  DASH_SPEED: 430,
  DASH_DURATION: 0.26,
});

export const MAP_PRESETS = [
  { id: 'columns4', name: '01 // 4 SİPER KOLONU' },
  { id: 'bunker', name: '02 // MERKEZ SIĞINAK' },
  { id: 'crossfire', name: '03 // HAÇ & KORİDORLAR' },
  { id: 'courtyard', name: '04 // AVLU & DÖNER SİPER' },
  { id: 'split', name: '05 // İKİLİ BLOK BARİKAT' },
];

export class BombGame extends BaseMiniGame {
  constructor(canvas) {
    super(canvas);

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

    // Arena Maps & Obstacles
    this.selectedMapIndex = 0;
    this.pillars = [];

    // Slot types: 'empty' | 'human' | 'bot_normal' | 'bot_god'
    this.slotTypes = ['human', 'bot_normal', 'empty', 'empty']; // P1 Human, P2 Normal Bot default

    // Set Tournament Scoring
    // Maç hedefi ve raunt süresi — kısaltma (bomb.js).
// Gerekçe: parti oyununda maç uzunluğu = yeniden başlatma sayısı. Ölçülen
// durum: hedefler 2-5 arası dağınıktı ve bir kısmı 5'ti (NINJA/SNAKE/
// COLLAPSE/CURVE); ilk açılışta 5 hedef, dakikalar süren bir maç
// demek, yani oyuncu iki dakika içinde 'tekrar oynayalım' demiyor.
// Kural: çoğu oyun 2 hedefte biter (ilk-iki kuralı — bir parti turunda
// kazanan çabuk bellenir, maç tekrarına yer kalır). LOSER'a özgü
// süreler korunur: HORDE kill/süre oyunudur, onda hedef 2
// olmak turu anlamsız kılardı.
this.targetScore = 2;
    this.tiedRounds = 0;
    this.scores = [0, 0, 0, 0];
    this.roundWinner = null;
    this.matchWinner = null;
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.roundId = 0;
    this.roundTimer = 0;
    this.roundLimit = BOMB_ROUND_LIMIT;
    this.roundTransitionTimer = 0;

    // Entities & Mechanics
    this.players = [];
    this.bombCarrierIndex = -1;
    this.bombTimer = 15.0;
    this.bombMaxTime = 15.0;
    this.passCooldown = 0;
    this.lastTickTime = 0;
    this.lastHeartbeatTime = 0;

    // Tactical Pickups & Obstacles
    this.pickups = [];
    this.pickupSpawnTimer = 6.0;
    this.inkPuddles = [];
    this.floatingTexts = [];
    // FX runtime (MOTION_PLAN Faz 2b): partikül/ring/pop/hit-stop tek sahibi;
    // `this.particles` worldCore konvansiyonu için alias'tır.
    this.fx = createFxRuntime({
      arenaProvider: () => this.arena,
      traumaSink: (amount, dirX, dirY) => this.addDirectionalTrauma(amount, dirX, dirY),
    });
    /** @type {any[]} */ this.particles = this.fx.particles;
    // Aktif patlama katmanı (null = patlama yok). Pakete `blast` olarak gider.
    this.blast = null;

    // Screen Shake (Trauma)
    this.trauma = 0;
    this.lastTime = performance.now();

    // UI Buttons
    this.uiButtons = [];

    // 4 Corner Floating Virtual Joysticks (P1: BL, P2: TL, P3: TR, P4: BR)
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

  getTabletopSchema() {
    return {
      ...this.getCentralTabletopLayout('BOMB'),
      actions: [
        {
          id: 'dash',
          icon: '⚡',
          color: '#FFDE59',
          cooldownField: 'dashCooldown',
          cooldownMaxField: 'dashMaxCooldown',
          maxCooldown: BOMB_DASH_COOLDOWN,
        },
      ],
    };
  }

  handleSlotAction(slotIndex, actionId, isDown) {
    if (!isDown) return;
    if (actionId === 'dash') {
      this.triggerDash(slotIndex);
    }
  }

  initKeyboard() {
    this.bindStandardKeyboard((slot) => {
      this.triggerDash(slot);
    });
  }

  createWorldPacket() {
    return createBombWorldPacket(this);
  }

  onSeatCycled() {
    playJoin();
  }

  cycleMap() {
    this.selectedMapIndex = (this.selectedMapIndex + 1) % MAP_PRESETS.length;
    // Lobide elle seçilen harita bir sonraki rauntta korunur (oto-döndürme ezmez)
    this.mapPickedInLobby = true;
    this.buildMapPillars();
    playJoin();
  }

  isSlotJoined(index) {
    return this.slotTypes[index] !== 'empty';
  }

  resize(width, height) {
    this.updateViewport(width, height);
    const oldArena = { ...this.arena };

    this.arena = computePlayfield(width, height, 'standard');

    this.buildMapPillars();
    // Maç ortası resize raundu sıfırlamasın
    if (this.state === 'LOBBY' || !this.players.length) {
      this.initPlayers();
      return;
    }
    for (const p of this.players) {
      this.remapPoint(p, oldArena, this.arena);
      clampToArena(p, p.radius, this.arena, { zeroVelocity: true });
      resolveAABB(p, this.pillars, p.radius);
      p.vx = 0; p.vy = 0;
      p.lastX = p.x; p.lastY = p.y;
    }
    for (const item of this.pickups) {
      this.remapPoint(item, oldArena, this.arena);
      clampToArena(item, item.radius || item.size || 15, this.arena);
    }
    for (const ink of this.inkPuddles) {
      this.remapPoint(ink, oldArena, this.arena);
      clampToArena(ink, ink.radius || 22, this.arena);
    }
    // Biriken partiküller ESKİ arena ölçeğindeydi; yeni unit ile karışmasın.
    this.fx.clear();
  }

  buildMapPillars() {
    const preset = MAP_PRESETS[this.selectedMapIndex];
    const layoutName = preset ? preset.id : 'pillars';
    // Geçiş tabanı oyuncu çapından türer (gövde için kullanılan tasarım
    // yarıçapı). BOMB'un gövdesi en büyüğü (36px) olduğu için en geniş geçişi
    // de o talep eder: sabit taban saha küçüldüğünde koridorları geçilemez
    // bırakıyordu.
    this.pillars = buildLayout(layoutName, this.arena, {
      minPassage: fieldRadius(this.arena, BOMB_RADIUS, 0.028) * 2.4,
    });
  }

  initPlayers() {
    const { cx, cy, size } = this.arena;
    const spawnDist = Math.round(size * 0.36);
    // Tasarım px (1920x1080 referansı). fieldRadius tabanı GÖRELİ: mutlak px
    // tabanı küçük sahada varlığı şişiriyordu.
    const r = fieldRadius(this.arena, BOMB_RADIUS, 0.028);

    const spawns = [
      { x: cx - spawnDist * 0.707, y: cy + spawnDist * 0.707 }, // P1: Bottom-Left
      { x: cx - spawnDist * 0.707, y: cy - spawnDist * 0.707 }, // P2: Top-Left
      { x: cx + spawnDist * 0.707, y: cy - spawnDist * 0.707 }, // P3: Top-Right
      { x: cx + spawnDist * 0.707, y: cy + spawnDist * 0.707 }, // P4: Bottom-Right
    ];

    this.players = spawns.map((s, i) => {
      const existing = this.players[i];
      return createPlayer(i, s, {
        existingName: existing?.name,
        defaultNames: BOMB_NAMES,
        defaultColors: BOMB_COLORS,
        radius: r,
        // Gövde ve HIZ birlikte ölçeklenir: saha küçülürken gövde de
        // küçülür, hız de küçülür, böylece sahanı geçiş süresi sabit kalır
        // (masaüstünde 952/200 = 4.8sn, telefonda 387/79 = 4.9sn). Hız
        // ölçeklenmezse oyun küçük ekranda ağırlaşırdı.
        speed: fieldSpeed(this.arena, BOMB_TUNING.MOVE_SPEED),
        isJoined: this.isSlotJoined(i),
        slotType: this.slotTypes[i],
        stepCycle: 0,
        lastX: s.x,
        lastY: s.y,
        stuckAccumulator: 0,
        unstuckDuration: 0,
        unstuckAngle: 0,
        aiMoveX: 0,
        aiMoveY: 0,
        aiForce: 0,
      });
    });
  }

  resetCurrentGame() {
    this.state = 'LOBBY';
    this.scores = [0, 0, 0, 0];
    this.roundWinner = null;
    this.matchWinner = null;
    this.matchDraw = false;
    this.tiedRounds = 0;
    this.roundDrew = false;
    this.roundResolutionReason = null;
    this.roundId = 0;
    this.roundTimer = 0;
    this.bombCarrierIndex = -1;
    this.pickups = [];
    this.inkPuddles = [];
    this.floatingTexts = [];
    this.fx.clear();
    this.blast = null;
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
    this.matchDraw = false;
    this.tiedRounds = 0;
    this.roundResolutionReason = null;
    this.startNewRound();
  }

  startNewRound() {
    const joined = this.players.filter((p) => p.isJoined);
    if (joined.length < 2) {
      this.state = 'LOBBY';
      return;
    }

    // Lobide seçilmediyse haritayı rastgele seç; seçildiyse kullanıcının seçimi kalır
    if (!this.mapPickedInLobby) {
      this.selectedMapIndex = Math.floor(Math.random() * MAP_PRESETS.length);
    }
    this.mapPickedInLobby = false;
    this.buildMapPillars();

    this.state = 'PLAYING';
    this.roundWinner = null;
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.roundId += 1;
    this.roundTimer = 0;
    this.roundTransitionTimer = 0;
    this.pickups = [];
    this.inkPuddles = [];
    this.floatingTexts = [];
    this.fx.clear();
    this.blast = null;

    // Respawn players at corner positions
    this.initPlayers();

    // Pick random player to hold initial ticking bomb
    const randomIndex = Math.floor(Math.random() * joined.length);
    this.bombCarrierIndex = joined[randomIndex].index;
    this.bombTimer = 15.0;
    this.bombMaxTime = 15.0;
    this.passCooldown = 1.0;
    this.lastTickTime = performance.now();
    this.lastHeartbeatTime = performance.now();

    playStart();
  }

  triggerDash(playerIndex) {
    // Lobi/maç-sonunda kumandadan depar tetiklenemez (uzak girdi kapısı)
    if (this.state !== 'PLAYING') return;
    const p = this.players[playerIndex];
    if (!p || !p.isAlive || p.dashCooldown > 0 || p.slipTimer > 0 || p.stumbleTimer > 0) return;

    p.dashCooldown = BOMB_DASH_COOLDOWN;
    p.dashMaxCooldown = BOMB_DASH_COOLDOWN;
    p.dashTimer = BOMB_TUNING.DASH_DURATION;
    p.isDashing = true;
    // Depar: dust bulutu (haptiksiz ortam olayı; whoosh sesi eşlik eder).
    this.fx.emit('dust', { x: p.x, y: p.y, color: p.color });

    playDashWhoosh();
  }

  transferBomb(toPlayerIndex) {
    if (this.passCooldown > 0) return;
    if (toPlayerIndex === this.bombCarrierIndex) return;

    const prevCarrierIndex = this.bombCarrierIndex;
    const prevCarrier = this.players[prevCarrierIndex];
    const newCarrier = this.players[toPlayerIndex];

    if (!newCarrier || newCarrier.immunityTimer > 0) return;

    this.bombCarrierIndex = toPlayerIndex;
    this.passCooldown = 1.6; // Solid window before another pass can occur
    // Bomba devri: hit olayı (burst + halka + yönlü travma + haptik).
    this.fx.emit('hit', {
      x: newCarrier.x, y: newCarrier.y, color: newCarrier.color,
      dirX: prevCarrier ? newCarrier.x - prevCarrier.x : 0,
      dirY: prevCarrier ? newCarrier.y - prevCarrier.y : 0,
      slot: toPlayerIndex,
      haptic: newCarrier.slotType === 'human',
    });

    playBombPass();
    playStumble();

    // 1. Stumble Shock Delay on Receiver: heavily stunned/slowed for 0.6s!
    newCarrier.stumbleTimer = 0.6;

    // 2. Escaper Sprint & Immunity on Giver: guarantees head start to flee!
    if (prevCarrier) {
      prevCarrier.escapeBoostTimer = 1.2; // +35% escape sprint
      prevCarrier.immunityTimer = 1.6;    // immune to bomb for 1.6s
    }

    // 3. Kinetic separation: physically push runners apart by 32px
    if (prevCarrier) {
      const dx = newCarrier.x - prevCarrier.x;
      const dy = newCarrier.y - prevCarrier.y;
      const d = Math.hypot(dx, dy) || 1;
      const pushDist = 32;
      newCarrier.x += (dx / d) * pushDist;
      newCarrier.y += (dy / d) * pushDist;
      prevCarrier.x -= (dx / d) * pushDist;
      prevCarrier.y -= (dy / d) * pushDist;
      this.resolveCollisions(newCarrier);
      this.resolveCollisions(prevCarrier);
    }
  }

  explodeCarrier() {
    const carrier = this.players[this.bombCarrierIndex];
    if (!carrier || !carrier.isAlive) return;

    carrier.isAlive = false;
    // Patlama anının okunur metni (SİSTEM 3): kim patlattı, net.
    emitFloatingText(this.floatingTexts, {
      x: carrier.x,
      y: carrier.y - (carrier.radius || 36) - 12,
      text: 'PATLADI!',
      color: carrier.color,
      urgent: true,
    });
    // Patlama: kill olayı (burst + halka + pop + hit-stop + flaş + travma tek profilden).
    // Patlama katmanı (`this.blast` → drawBlast) mekanik görseldir, korunur.
    this.fx.emit('kill', {
      x: carrier.x, y: carrier.y, color: carrier.color,
      size: carrier.radius || 36, angle: 0, slot: carrier.index,
      haptic: carrier.slotType === 'human',
    });
    playExplosion();

    // Patlama katmanı: is yüzüğü + şok halkaları + çekirdek parlama
    // (worldCore.drawBlast). Aynı çizim telefon world-view'da da görünür.
    this.blast = { x: carrier.x, y: carrier.y, t: 0, max: 0.6 };

    const alive = this.players.filter((p) => p.isJoined && p.isAlive);

    if (alive.length <= 1) {
      this.resolveLoneSurvivor(alive);
    } else {
      // Multiple players still alive: pick survivor for next bomb
      const nextIndex = Math.floor(Math.random() * alive.length);
      this.bombCarrierIndex = alive[nextIndex].index;
      this.bombTimer = Math.max(9.0, 15.0 - (4 - alive.length) * 2.0);
      this.bombMaxTime = this.bombTimer;
      this.passCooldown = 1.2;
    }
  }

  // Tek katılımcı kalınca raunt hemen biter (patlama beklenmez)
  resolveLoneSurvivor(alive) {
    const remaining = alive || this.players.filter((p) => p.isJoined && p.isAlive);
    if (remaining.length > 1 || this.state !== 'PLAYING') return false;
    if (remaining.length === 0) return this.finishTiedRound('no-survivor');
    const survivor = remaining[0];
    this.tiedRounds = 0;
    this.roundWinner = survivor;
    this.scores[survivor.index]++;
    // Yüzen metin (SİSTEM 3): hayatta kalanın puanı yerinde okunur.
    emitFloatingText(this.floatingTexts, {
      x: survivor.x,
      y: survivor.y - (survivor.radius || 36) - 12,
      text: '+1',
      color: survivor.color,
    });
    if (this.scores[survivor.index] >= this.targetScore) {
      endMatch(this, survivor, 'target-score');
      return true;
    }
    beginRound(this, survivor, 'lone-survivor');
    return true;
  }

  // Berabere raunt: puan verilmez, oyun devam eder. Üst üste BOMB_MAX_TIED_ROUNDS
  // beraberlikte maç berabere biter — berabere raunt artık maçı bitirmediği için
  // bu sayaç çıkmaz döngüyü keser (bkz. core/roundLifecycle.beginDrawRound).
  finishTiedRound(reason = 'tie') {
    this.tiedRounds += 1;
    if (this.tiedRounds >= BOMB_MAX_TIED_ROUNDS) {
      endMatch(this, null, reason);
      return true;
    }
    beginDrawRound(this, reason);
    return true;
  }

  spawnPickup() {
    spawnPickup(this, {
      types: ['TURBO', 'TELEPORT', 'SLIP'],
      max: 2,
      obstacles: this.pillars,
    });
  }

  onTouchStart(touch) {
    // 1. UI Buttons tap handling (yalnızca Lobi ve Maç Sonu ekranlarında)
    if (this.state === 'LOBBY' || this.state === 'MATCH_OVER') {
      if (this.handleUiTap(touch)) return;
    }

    // MATCH_OVER: kartın DIŞINDA dokunma = yeniden başlat (ortak kısayol).
    // Ölçülen kusur: bu dallar yalnız `handleUiTap` çalıştırıp geçiyordu,
    // yani maç sonunda ekrana dokunmak HİÇBİR ŞEY yapmıyordu — oyuncu
    // 'tekrar oynayalım' diyebilmek için yol yoktu. `matchOverRestartTap`
    // kartın içine dokunmayı yutar (yanlışlıkla yeniden başlatmayı önler).
    if (this.state === 'MATCH_OVER') {
      matchOverRestartTap(this, touch, { onRestart: () => this.startNewMatch() });
      return;
    }

    if (this.handleRoundOverSkip()) return;

    // 1.5. Generous Lobby Join fallback (tap anywhere in quadrant)
    if (this.state === 'LOBBY') {
      if (lobbyCenterStartTap(this, touch)) return;
      lobbyQuadrantTap(this, touch);
      return;
    }

    // 2. Tabletop butonları + joystick (tek merkezden, BaseGame)
    if (this.state === 'PLAYING') {
      this.handleTabletopTouchStart(touch);
    }
  }

  onTouchMove(touch) {
    if (this.state !== 'PLAYING') return;
    this.handleTabletopTouchMove(touch);
  }

  handleRemoteInput(slotIndex, data) {
    this.handleStandardRemoteJoystick(slotIndex, data, (slot, d) => {
      if (matchesInputAction(d, 'dash', 'DASH')) {
        this.triggerDash(slot);
      }
    });
  }

  onTouchEnd(touch) {
    this.handleTabletopTouchEnd(touch);
  }

  onTouchesReset() {
    this.resetTabletopTouches();
  }

  // --- SMART BOT AI (Delegated to src/ai/bombAI.js) ---
  updateBotAI(bot, dt) {
    updateBombBotAI(this, bot, dt);
  }

  // --- COLLISION RESOLUTION ---

  resolveCollisions(player) {
    clampToArena(player, player.radius, this.arena, { zeroVelocity: true });
    resolveAABB(player, this.pillars, player.radius);
  }

  update(now) {
    const rawDt = this.clampDt(now, this.lastTime);
    this.lastTime = now;
    // Hit-stop TEK SAAT: host karesi yavaşlar, kumanda aynı kareyi görür (§2).
    const dt = this.fx.tick(rawDt);

    this.updateTrauma(dt);
    this.fx.update(dt);

    // Raunt/maç geçişi ortak akışta (core/roundLifecycle): süre, sonraki rauntu
    // başlatma ve MATCH_OVER kararı motorun değil çekirdeğin işidir.
    if (tickRoundFlow(this, dt)) return;

    if (this.state !== 'PLAYING') return;

    this.roundTimer += dt;
    if (roundTimedOut(this.roundTimer, this.roundLimit)) {
      // Zaman aşımı bir BERABERE RAUNTtur, maç sonu değil: kimse puan almaz.
      // Oyuncu kalmadıysa maç da kapanır (yoksa sonsuz çıkmaz döngüsü olur).
      if (this.players.some((p) => p.isJoined)) this.finishTiedRound('timeout');
      else endMatch(this, null, 'timeout');
      return;
    }

    // Taşıyıcı ayrıldıysa/öldüyse bomba canlı birine geçer; kimse kalmadıysa bitir
    const activeCarrier = this.players[this.bombCarrierIndex];
    if (!activeCarrier || !activeCarrier.isJoined || !activeCarrier.isAlive) {
      const alive = this.players.filter((p) => p.isJoined && p.isAlive);
      if (alive.length <= 1) {
        this.resolveLoneSurvivor(alive);
        return;
      }
      const nextIndex = Math.floor(Math.random() * alive.length);
      this.bombCarrierIndex = alive[nextIndex].index;
      this.bombTimer = Math.max(9.0, 15.0 - (4 - alive.length) * 2.0);
      this.bombMaxTime = this.bombTimer;
      this.passCooldown = 1.2;
    }

    // Tek katılımcı kontrolü (ayrılma patlamayı beklemez)
    if (this.resolveLoneSurvivor()) return;

    // Decrement Bomb Timer & Audio
    this.bombTimer -= dt;
    if (this.passCooldown > 0) {
      this.passCooldown -= dt;
    }

    const urgency = 1.0 - Math.max(0, this.bombTimer / this.bombMaxTime);
    const isPanic = this.bombTimer <= 4.0;

    // Ticking audio interval
    const tickInterval = isPanic
      ? 0.1
      : urgency > 0.65
      ? 0.22
      : urgency > 0.4
      ? 0.45
      : 1.0;

    if (now - this.lastTickTime > tickInterval * 1000) {
      playBombTick(urgency);
      this.lastTickTime = now;
    }

    // Panic Phase Heartbeat audio
    if (isPanic && now - this.lastHeartbeatTime > 900) {
      playPanicHeartbeat();
      this.lastHeartbeatTime = now;
    }

    // Bomb Detonation!
    if (this.bombTimer <= 0) {
      this.explodeCarrier();
      return;
    }

    // Spawning Pickups & Timers
    this.pickupSpawnTimer -= dt;
    if (this.pickupSpawnTimer <= 0 && this.pickups.length < 2) {
      this.spawnPickup();
      this.pickupSpawnTimer = 8.0 + Math.random() * 4.0;
    }

    tickPickupTimers(this, dt);

    // Update Ink Puddles
    for (let i = this.inkPuddles.length - 1; i >= 0; i--) {
      const p = this.inkPuddles[i];
      p.duration -= dt;
      if (p.duration <= 0) {
        this.inkPuddles.splice(i, 1);
      }
    }

    // Patlama katmanı ömrü (0.6 sn): şok halkaları + çekirdek parlama
    if (this.blast) {
      this.blast.t += dt;
      if (this.blast.t >= this.blast.max) this.blast = null;
    }

    // Update Players
    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      const isCarrier = player.index === this.bombCarrierIndex;

      // Status timers
      if (player.turboTimer > 0) player.turboTimer -= dt;
      if (player.dashCooldown > 0) player.dashCooldown -= dt;
      if (player.dashTimer > 0) {
        player.dashTimer -= dt;
        if (player.dashTimer <= 0) player.isDashing = false;
      }
      if (player.stumbleTimer > 0) player.stumbleTimer -= dt;
      if (player.immunityTimer > 0) player.immunityTimer -= dt;
      if (player.escapeBoostTimer > 0) player.escapeBoostTimer -= dt;
      if (player.slipTimer > 0) {
        player.slipTimer -= dt;
        player.slipAngle += dt * 16.0;
      }

      // Determine Movement Intent (dx, dy)
      let inputX = 0;
      let inputY = 0;

      if (player.slotType === 'human') {
        const joy = this.joysticks[player.index];
        if (joy.active && joy.force > 0.05) {
          inputX = Math.cos(joy.angle) * joy.force;
          inputY = Math.sin(joy.angle) * joy.force;
        }

        // Keyboard Fallback
        const kb = keyboardVectorFrom(this.keys, player.index);
        inputX += kb.x;
        inputY += kb.y;
      } else {
        // Smart Bot AI (Whiskers, Waypoints & Wall Tangent Slide)
        this.updateBotAI(player, dt);
        inputX = player.aiMoveX || 0;
        inputY = player.aiMoveY || 0;
      }

      // Speed modifiers
      let currentSpeed = player.speed;
      if (isCarrier) {
        currentSpeed *= 1.16; // Bomb carrier is faster to keep chases tense
      }
      if (player.turboTimer > 0) {
        currentSpeed *= 1.55;
      }
      if (player.escapeBoostTimer > 0) {
        currentSpeed *= 1.35; // Escaper burst sprint!
      }
      if (player.dashTimer > 0) {
        currentSpeed = fieldSpeed(this.arena, BOMB_TUNING.DASH_SPEED); // Supersonic dash speed!
      }
      if (player.stumbleTimer > 0) {
        currentSpeed *= 0.15; // Receiver stumble delay: heavily slowed down for 0.6s!
      }

      if (player.slipTimer > 0) {
        // Low traction while slipping. `damp` keeps the authored 60 Hz strength:
        // a bare `*= 0.96` per frame was ~8.6%/s at 60 fps but ~29%/s at 30 fps,
        // so the same 1.3 s hazard froze you twice as long on a slow device.
        const slipDrag = damp(0.96, dt);
        player.vx *= slipDrag;
        player.vy *= slipDrag;
      } else {
        const inputLen = Math.hypot(inputX, inputY);
        if (inputLen > 0.05) {
          const normX = inputX / inputLen;
          const normY = inputY / inputLen;
          player.vx = normX * currentSpeed;
          player.vy = normY * currentSpeed;
          player.facingAngle = Math.atan2(normY, normX);
          player.stepCycle += dt * 14;

          // Motion trails
          if ((player.turboTimer > 0 || player.dashTimer > 0) && Math.random() < 0.5) {
            this.fx.emit('spark', { x: player.x, y: player.y, color: player.color });
          }
        } else {
          const idleDrag = damp(0.7, dt);
          player.vx *= idleDrag;
          player.vy *= idleDrag;
        }
      }

      // Position update & wall collisions
      player.x += player.vx * dt;
      player.y += player.vy * dt;
      this.resolveCollisions(player);

      // Ink Puddles interaction
      for (const puddle of this.inkPuddles) {
        const dPuddle = Math.hypot(player.x - puddle.x, player.y - puddle.y);
        if (dPuddle < player.radius + puddle.radius * 0.75 && player.slipTimer <= 0) {
          player.slipTimer = 1.3;
          playSlip();
          break;
        }
      }

      // Pickups interaction (efektler pickupSystem'de; FX burada: toplama olayı)
      const pickupBefore = this.pickups.length;
      collectPickups(this, player);
      if (this.pickups.length < pickupBefore) {
        this.fx.emit('pickup', {
          x: player.x, y: player.y, color: player.color, slot: player.index,
          haptic: player.slotType === 'human',
        });
      }
    }

    // Carrier vs Opponents Collision & Bomb Transfer!
    const carrier = this.players[this.bombCarrierIndex];
    if (carrier && carrier.isAlive) {
      for (const opponent of this.players) {
        if (
          opponent.index !== carrier.index &&
          opponent.isJoined &&
          opponent.isAlive
        ) {
          const dx = opponent.x - carrier.x;
          const dy = opponent.y - carrier.y;
          const dist = Math.hypot(dx, dy);
          const minDist = carrier.radius + opponent.radius;

          if (dist < minDist) {
            // Elastic separation
            const overlap = minDist - dist;
            if (dist > 0.001) {
              const nx = dx / dist;
              const ny = dy / dist;
              carrier.x -= nx * overlap * 0.5;
              carrier.y -= ny * overlap * 0.5;
              opponent.x += nx * overlap * 0.5;
              opponent.y += ny * overlap * 0.5;
            }

            // Transfer the bomb (only if cooldown expired and opponent is not immune)!
            if (this.passCooldown <= 0 && opponent.immunityTimer <= 0) {
              this.transferBomb(opponent.index);
            }
          }
        }
      }
    }
  }

  // --- RENDERING PIPELINE ---

  render() {
    const { ctx } = this;
    ctx.save();

    // Sahanın dışı: arenanın etrafındaki masa. `fieldKit` tek sahibi — düz krem
    // dolgu "bembeyaz ekran" hissinin en az yarısıydı. Sarsıntıdan etkilenmez.
    paintBackdrop(ctx, this.viewport, this.arena, { mode: 'BOMB' });

    // Screen Shake (Trauma)
    this.applyScreenShake(ctx, 16);

    // Arena sahnesi ortak bombView draw'larından gelir (host↔client aynı).
    const carrierP = this.players[this.bombCarrierIndex];
    drawBombArena(ctx, this.arena, this.pillars, {
      carrier: carrierP && carrierP.isAlive
        ? { x: carrierP.x, y: carrierP.y, radius: carrierP.radius, alive: true }
        : null,
      bombTimer: this.bombTimer,
      bombMaxTime: this.bombMaxTime,
      // Dekor raunt başına değişsin; seed `(BOMB, roundId)`'den deterministik
      // türer, yani client paket almadan aynı saha dekorunu üretir.
      seed: hashFieldSeed('BOMB', this.roundId),
    });
    drawBombInk(ctx, this.inkPuddles);
    drawBombPickups(ctx, this.pickups);
    drawBombPlayers(ctx, this.players.map((p) => ({
      ...p,
      carrier: p.index === this.bombCarrierIndex,
      stumble: p.stumbleTimer, immunity: p.immunityTimer,
      dash: p.dashTimer, turbo: p.turboTimer,
      slip: p.slipTimer, slipAngle: p.slipAngle,
      cd: p.dashCooldown, cdMax: p.dashMaxCooldown,
      angle: p.facingAngle,
    })), {
      bombTimer: this.bombTimer,
      bombMaxTime: this.bombMaxTime,
      withFx: this.state === 'PLAYING',
      now: this.lastTime,
      arena: this.arena,
      selfSlot: this.localControlSlot ?? -1,
    });
    drawBombBlast(ctx, this.blast, this.arena);
    // FX katmanı ortak bombView draw'ından gelir (host↔client aynı).
    drawBombFxLayer(ctx, { pops: this.fx.pops, rings: this.fx.rings, particles: this.particles });
    // Yüzen metin (SİSTEM 3): patlama/skor bildirimi; FX katmanının üstünde.
    renderFloatingTexts(ctx, this.floatingTexts, 0.016);
    this.renderControls(ctx);

    // Host HUD: bomba geri sayımı (world-view client'ı kendi HUD'unu kullanır).
    // Skorbord `renderHUD`'un işidir — motorun kendi `renderAdaptiveScoreboard`
    // çağrısı ikinci bir kopya çiziyordu (aynı kartlar iki kez).
    if (this.state === 'PLAYING' || this.state === 'ROUND_OVER') {
      const remain = Math.max(0, this.bombTimer);
      const isPanic = remain <= 4.0;
      const carrierP2 = this.bombCarrierIndex !== null ? this.players[this.bombCarrierIndex] : null;
      renderArenaWatermarkTimer(ctx, {
        arena: this.arena,
        text: `${remain.toFixed(1)}s`,
        subText: '',
        urgent: isPanic,
        color: isPanic ? '#D84727' : (carrierP2 ? carrierP2.color : null),
        alpha: isPanic ? 0.72 : 0.50,
        ringProgress: Math.max(0, remain / this.bombMaxTime),
        // Sayaç oyun alanının ÜSTÜNDEDİR. Ölçülen kusur: merkez konumunda
        // devasa sayı bir oyuncunun üstüne biniyordu (BOMB ekran görüntüsünde
        // '10.5s' doğrudan P1'in üstündeydi) — merkez, oyunun olduğu yerdir.
        placement: 'top',
      });
    }

    // Panic Phase Red Border Vignette (Last 4 Seconds)
    if (this.state === 'PLAYING' && this.bombTimer <= 4.0) {
      const pulseAlpha = pulse(0.18, 0.12, 0.015);
      ctx.fillStyle = `rgba(216, 71, 39, ${pulseAlpha})`;
      // Arena kenar şeritleri (CSS pikseli; canvas.width device-px olur, kullanılmaz)
      const { left, top, width, height, right, bottom } = this.arena;
      const edge = 16;
      ctx.fillRect(left, top - edge, width, edge);
      ctx.fillRect(left, bottom, width, edge);
      ctx.fillRect(left - edge, top - edge, edge, height + edge * 2);
      ctx.fillRect(right, top - edge, edge, height + edge * 2);
    }

    this.renderHUD(ctx, {
      guideTitle: t('guide.bomb'),
      guideEntries: [
        'P1 [WASD/SPACE]',
        'P2 [OKLAR/ENTER]',
        'P3 [IJKL/O]',
        'P4 [TFGH/B]',
      ],
      colors: BOMB_COLORS,
      playerNames: BOMB_NAMES,
      accent: '#D84727',
      scoreboardEntities: this.players.filter((p) => p.isJoined),
      roundBannerTitle: this.roundWinner ? `+1 SET: ${this.roundWinner.name}!` : null,
      roundBannerColor: this.roundWinner?.color,
      roundBannerSub: this.roundWinner ? `TOPLAM SET: ${this.scores[this.roundWinner.index]} / ${this.targetScore}` : '',
      matchOverHeadline: this.matchDraw ? t('game.draw') : t('game.champWon'),
      matchOverRows: this.matchWinner
        ? this.players
            .filter((p) => p.isJoined)
            .map((p) => ({ color: p.color, name: p.name, value: `${this.scores[p.index] || 0}★`, score: this.scores[p.index] || 0 }))
        : [],
      // Maç sonu "tekrar oyna" hedefi: `startNewMatch`, `resetMatch` DEĞİL.
// Ölçülen tutarsızlık: 15 motorun 11'i `resetMatch()` çağırıyordu — o da
// motoru LOBBY'ye döndürür, yani skor silinir ve 3-2-1 sayacı baştan
// kurulur. Maç bittikten sonra tekrar oynamak isteyen oyuncu için en
// pahalı 10 saniye. `startNewMatch` aynı yerde sıfırlar ama DOĞRUDAN
// oynanabilir duruma geçer. Lobiye dönmek kartın ikinci eylemi olarak
// zaten var (`requestReturnToLobby`), yani hiçbir yol kaybolmaz.
onRestart: () => this.startNewMatch(),
      customControls: (c) => {
        const { arena } = this;
        const mapBtnW = Math.min(220, arena.size * 0.52);
        const mapBtnH = 36;
        const mapBtnX = arena.cx - mapBtnW / 2;
        const mapBtnY = arena.cy - 72;
        const r = Math.min(10, mapBtnH * 0.28);
        c.save();
        c.fillStyle = 'rgba(20, 16, 31, 0.22)';
        if (c.roundRect) {
          c.beginPath();
          c.roundRect(mapBtnX, mapBtnY + 3, mapBtnW, mapBtnH, r);
          c.fill();
        } else {
          c.fillRect(mapBtnX, mapBtnY + 3, mapBtnW, mapBtnH);
        }
        c.fillStyle = '#FFFFFF';
        if (c.roundRect) {
          c.beginPath();
          c.roundRect(mapBtnX, mapBtnY, mapBtnW, mapBtnH, r);
          c.fill();
        } else {
          c.fillRect(mapBtnX, mapBtnY, mapBtnW, mapBtnH);
        }
        c.strokeStyle = '#1C1C1A';
        c.lineWidth = Math.max(1.5, 2.5 * (arena?.unit ?? 1));
        if (c.roundRect) {
          c.beginPath();
          c.roundRect(mapBtnX, mapBtnY, mapBtnW, mapBtnH, r);
          c.stroke();
        } else {
          c.strokeRect(mapBtnX, mapBtnY, mapBtnW, mapBtnH);
        }

        drawTabletopIcon(c, 'landmark', mapBtnX + 22, mapBtnY + mapBtnH / 2, 16, { color: '#1C1C1A' });
        c.fillStyle = '#1C1C1A';
        c.font = '800 12px "JetBrains Mono", monospace';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(`${MAP_PRESETS[this.selectedMapIndex].name} ▾`, arena.cx + 8, mapBtnY + mapBtnH / 2);
        c.restore();

        this.uiButtons.push({
          x: mapBtnX,
          y: mapBtnY,
          w: mapBtnW,
          h: mapBtnH,
          onClick: () => this.cycleMap(),
        });
      },
    });

    ctx.restore();

    // Kill flaşı sahne transformunun DIŞINDA: tam ekranı kaplar (tanks deseni).
    const flashAlpha = fxFlashAlpha(this.fx.flash, this.fx.flashPeak);
    if (flashAlpha > 0) drawFxFlash(ctx, this.viewport.width, this.viewport.height, flashAlpha);
  }

}