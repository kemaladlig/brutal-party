// BRUTAL RACE: host-authoritative 2-4 player checkpoint racing.
// Three rotating tracks, shared jump/dash hazards, nitro pads, drafting and EMP pulses.

import { BaseMiniGame } from '../core/BaseGame.js';
import { UI_COLORS, UI_FONTS } from '../ui/tokens.js';
import {
  renderUniversalScoreboard,
  renderRoundBanner,
  renderMatchOver,
  renderTopPill,
  renderFloatingTexts,
} from '../ui/hud.js';
import { renderControlGuide } from '../controlGuide.js';
import { drawObstacle } from '../core/arenaKit.js';
import { drawTabletopIcon } from '../core/tabletopIcons.js';
import { clampToArena, distToSegmentSquared, normalizeAngle } from '../core/physics2d.js';
import { computePlayfield, fieldPx, fieldSpeed } from '../core/playfield.js';
import { beginDrawRound, hasMatchResult } from '../core/roundLifecycle.js';
import { createPlayer } from '../core/playerEntity.js';
import { getKeyLabel } from '../core/inputMaps.js';
import { isInputIntent, matchesInputAction } from '../core/inputIntent.js';
import {
  lobbyCenterStartTap,
  lobbyQuadrantTap,
  matchOverRestartTap,
} from '../core/touchFlow.js';
import {
  playDashWhoosh,
  playHeavyImpact,
  playItemPickup,
  playJoin,
  playSlip,
  playStart,
  playWallHit,
} from '../audio.js';
import { t } from '../i18n.js';
import { RaceAI } from '../ai/raceAI.js';
import { RACE_TUNING, getRaceProgress } from './raceLogic.js';
import { createRaceWorldPacket } from './raceView.js';

export const TRACK_PRESETS = ['CIRCUIT', 'ZIGZAG', 'SPIRAL'];

const RACE_NAMES = ['P1', 'P2', 'P3', 'P4'];
const TRACK_NAME_KEYS = {
  CIRCUIT: 'race.trackCircuit',
  ZIGZAG: 'race.trackZigzag',
  SPIRAL: 'race.trackSpiral',
};

// Parkur dekorunun küçülme tabanı. 0 = tam ölçek (eski mutlak px kadar küçülür),
// 1 = hiç küçülmez.
//
// TUNE geçmişi: 0.73 denendi → kullanıcı "propların büyümesi gerekiyordu,
// ilk hali güzeldi" dedi. İlk denemede iki hata birden yapılmıştı: (1) 0.73
// MUTLAK px'e göre çok ağır bir kesintiydi, (2) asıl "yavaşlık" dekor
// boyutundan gelmiyordu — araç hızı hiç değişmemişti, sadece nitro pad'ler
// küçülünce üstlerine binme oranı düşmüştü.
// Şimdi: **0.90** (telefonda eski boyutun %90'ı — "biraz küçülsün" dediği gibi)
// ve araç hızı ayrıca %12 arttı. Bkz. `propPx`, `RACE_TUNING.baseSpeed`.
const PROP_FLOOR = 0.9;

export { normalizeAngle };

export class RaceGame extends BaseMiniGame {
  constructor(canvas) {
    super(canvas);

    this.ai = new RaceAI(this);
    this.targetLaps = RACE_TUNING.targetLaps;
    this.targetScore = RACE_TUNING.targetScore;
    this.roundTimer = RACE_TUNING.roundTime;
    this.roundTransitionTimer = 0;
    this.roundWinner = null;
    this.matchWinner = null;
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.roundId = 0;
    this.tiedRounds = 0;
    this.floatingTexts = [];
    this.currentPreset = TRACK_PRESETS[0];
    this.roundIndex = 0;

    this.arena = {
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      cx: 0,
      cy: 0,
    };

    this.checkpoints = [];
    this.oilSlicks = [];
    this.nitroPads = [];
    this.obstacleSpinners = [];
    this.empPulses = [];
    this.players = [];

    this.initPlayers();
    this.bindStandardKeyboard((slotIndex) => this.triggerDash(slotIndex));
    this.resetMatch();
  }

  getTabletopSchema() {
    return {
      ...this.getCentralTabletopLayout('RACE'),
      actions: [{
        id: 'dash',
        icon: 'zap',
        cooldownField: 'dashCooldown',
        maxCooldown: RACE_TUNING.dashCooldown,
      }],
    };
  }

  handleSlotAction(slotIndex, actionId, isDown) {
    if (!isDown || actionId !== 'dash') return;
    const player = this.players[slotIndex];
    if (!player || player.slotType !== 'human') return;
    this.triggerDash(slotIndex);
  }

  initPlayers() {
    this.players = [0, 1, 2, 3].map((index) => {
      const existing = this.players[index];
      return createPlayer(index, { x: 0, y: 0, angle: -Math.PI / 2 }, {
        existingName: existing?.name,
        defaultNames: RACE_NAMES,
        defaultColors: UI_COLORS.players,
        radius: this.px(RACE_TUNING.playerRadius),
        speed: this.spd(RACE_TUNING.baseSpeed),
        baseSpeed: this.spd(RACE_TUNING.baseSpeed),
        isJoined: this.isSlotJoined(index),
        isAlive: this.isSlotJoined(index),
        slotType: this.slotTypes[index],
        laps: 0,
        nextCheckpoint: 0,
        jumpZ: 0,
        vz: 0,
        isJumping: false,
        nitroBoostTimer: 0,
        nitroPadLocked: false,
        draftingTimer: 0,
        isDrafting: false,
        empDisruptedTimer: 0,
        spinnerHitCooldown: 0,
        wallFeedbackCooldown: 0,
        bumpCooldown: 0,
        lastTapTime: 0,
      });
    });
  }

  // RACE_TUNING hem ZAMAN hem UZAM içeriyor. Zaman değerleri (roundTime,
  // dashCooldown, jumpDuration, empDuration) ÖLÇEKLENMEZ — süre cihazdan
  // bağımsızdır. px / px/s olanlar ise sahayla birlikte ölçeklenir, yoksa
  // telefonda araç sahanın %5'ini kaplar ve saha geçiş süresi değişir.
  // Yanlışlıkla bir zaman değerini ölçeklemek oyunu bozduğu için iki okuyucu
  // ayrıldı.
  px(value) {
    return fieldPx(this.arena, value);
  }

  /**
   * Parkur dekoru için KISILMIŞ ölçek.
   *
   * `px()` tam ölçek (`value * unit`); telefon birim katsayısı ~0.41 olduğu
   * için dekor orada 2.4x küçülüyordu. Kullanıcı "küçülmüş ve çok yavaşlamış,
   * eski hali daha iyi, minimal bir küçültme yeter" dedi.
   *
   * Mekanizma: nitro pad'ler küçülünce üstlerine binme oranı düşüyor, yani
   * oyuncu daha az boost alıyor ve "yavaşladı" hissi çıkıyor. Kullanıcının
   * istediği de tam olarak bu: dekor biraz küçülsün, oynanış temposu geri gelsin.
   *
   * `PROP_FLOOR` telefonda 0.73 oranında tutar (mutlak px'in %73'ü — yani eski
   * görünüme yakın), masaüstünde tam boy verir. GÖVDEDE bu katsayı KULLANILMAZ:
   * gövde şişmesi tam da düzelttiğimiz hata.
   */
  propPx(value) {
    const damped = PROP_FLOOR + (1 - PROP_FLOOR) * (this.arena.unit || 1);
    return value * damped;
  }

  spd(value) {
    return fieldSpeed(this.arena, value);
  }

  // Arena geometry comes from the shared playfield (CSS px). RACE must never
  // read or write canvas.width/height: those are the DPR backing store, owned
  // by main.js — reading them yields device px and writing them wipes the
  // ctx.scale(dpr, dpr) transform, which pins the whole engine to 1x.
  buildArena(width, height) {
    this.arena = computePlayfield(width, height, 'racing');

    this.applyTrackPreset(this.currentPreset);
  }

  applyTrackPreset(presetName) {
    this.currentPreset = TRACK_PRESETS.includes(presetName) ? presetName : TRACK_PRESETS[0];
    const arena = this.arena;
    const checkpointRadius = Math.min(arena.width, arena.height) * 0.1;
    // Parkur dekorları da saha ile birlikte ölçeklenir. Konumlar ve checkpoint
    // yarıçapı zaten oranlıydı; yağ lekeleri, nitro pad'leri ve spinner
    // uzunlukları MUTLAK px'te kalmıştı. Ölçülen şişme (telefon/masaüstü):
    //   yağ lekesi 30px  %3.2 -> %7.8   (2.4x)
    //   nitro pad 42x28  %4.4 -> %7.4   (1.7x)
    //   spinner 110px    %11.6 -> %28.4 (2.4x)  <- en belirgin olan
    // Araç zaten ölçekli olduğu için tutarsızlık "prop'lar büyük" olarak
    // değil "bir şeyler ters" olarak okunuyordu; kullanıcı RACE ölçeğini iyi
    // bulduğu için hata gözden kaçmış.
    //
    // Sonra kullanıcı "küçülmüş ve çok yavaşlamış, eski hali daha iyi, minimal
    // bir küçültme yeter" dedi: tam ölçek (`px`) telefonu 2.4x küçülttü, üstüne
    // nitro pad küçüldüğü için boost'a binme oranı düşüp oyun "yavaşladı".
    // Dekor için `propPx` (kısılmış ölçek) kullanılıyor.
    const px = (v) => this.propPx(v);

    if (this.currentPreset === 'ZIGZAG') {
      this.checkpoints = [
        { id: 0, name: 'CP 1', x: arena.left + arena.width * 0.85, y: arena.top + arena.height * 0.25, radius: checkpointRadius, color: '#FFDE59' },
        { id: 1, name: 'CP 2', x: arena.left + arena.width * 0.15, y: arena.top + arena.height * 0.5, radius: checkpointRadius, color: '#3B82F6' },
        { id: 2, name: 'CP 3', x: arena.left + arena.width * 0.85, y: arena.top + arena.height * 0.85, radius: checkpointRadius, color: '#22C55E' },
      ];
      this.oilSlicks = [
        { x: arena.left + arena.width * 0.5, y: arena.top + arena.height * 0.35, radius: px(30) },
        { x: arena.left + arena.width * 0.5, y: arena.top + arena.height * 0.65, radius: px(30) },
      ];
      this.nitroPads = [
        { x: arena.left + arena.width * 0.2, y: arena.top + arena.height * 0.2, w: px(42), h: px(28), angle: 0 },
        { x: arena.left + arena.width * 0.8, y: arena.top + arena.height * 0.6, w: px(42), h: px(28), angle: Math.PI / 2 },
      ];
      this.obstacleSpinners = [
        { x: arena.left + arena.width * 0.35, y: arena.top + arena.height * 0.35, length: px(110), angle: 0, rotSpeed: 1.5 },
        { x: arena.left + arena.width * 0.65, y: arena.top + arena.height * 0.65, length: px(110), angle: Math.PI / 4, rotSpeed: -1.5 },
      ];
      return;
    }

    if (this.currentPreset === 'SPIRAL') {
      this.checkpoints = [
        { id: 0, name: 'CP 1', x: arena.left + arena.width * 0.5, y: arena.top + arena.height * 0.2, radius: checkpointRadius, color: '#FFDE59' },
        { id: 1, name: 'CP 2', x: arena.left + arena.width * 0.85, y: arena.top + arena.height * 0.75, radius: checkpointRadius, color: '#3B82F6' },
        { id: 2, name: 'CP 3', x: arena.left + arena.width * 0.15, y: arena.top + arena.height * 0.75, radius: checkpointRadius, color: '#22C55E' },
      ];
      this.oilSlicks = [
        { x: arena.left + arena.width * 0.3, y: arena.top + arena.height * 0.45, radius: px(28) },
        { x: arena.left + arena.width * 0.7, y: arena.top + arena.height * 0.45, radius: px(28) },
      ];
      this.nitroPads = [
        { x: arena.left + arena.width * 0.5, y: arena.top + arena.height * 0.85, w: px(45), h: px(28), angle: Math.PI },
      ];
      this.obstacleSpinners = [
        { x: arena.left + arena.width * 0.5, y: arena.top + arena.height * 0.5, length: px(140), angle: 0, rotSpeed: 2 },
      ];
      return;
    }

    this.checkpoints = [
      { id: 0, name: 'CP 1', x: arena.left + arena.width * 0.8, y: arena.top + arena.height * 0.5, radius: checkpointRadius, color: '#FFDE59' },
      { id: 1, name: 'CP 2', x: arena.left + arena.width * 0.25, y: arena.top + arena.height * 0.25, radius: checkpointRadius, color: '#3B82F6' },
      { id: 2, name: 'CP 3', x: arena.left + arena.width * 0.25, y: arena.top + arena.height * 0.75, radius: checkpointRadius, color: '#22C55E' },
    ];
    this.oilSlicks = [
      { x: arena.left + arena.width * 0.55, y: arena.top + arena.height * 0.3, radius: px(26) },
      { x: arena.left + arena.width * 0.55, y: arena.top + arena.height * 0.7, radius: px(26) },
    ];
    this.nitroPads = [
      { x: arena.left + arena.width * 0.8, y: arena.top + arena.height * 0.2, w: px(40), h: px(28), angle: -Math.PI / 4 },
      { x: arena.left + arena.width * 0.45, y: arena.top + arena.height * 0.85, w: px(40), h: px(28), angle: Math.PI },
    ];
    this.obstacleSpinners = [
      { x: arena.left + arena.width * 0.5, y: arena.top + arena.height * 0.5, length: px(110), angle: 0, rotSpeed: 1.2 },
    ];
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
    this.roundTimer = RACE_TUNING.roundTime;
    this.roundTransitionTimer = 0;
    this.currentPreset = TRACK_PRESETS[0];
    this.roundIndex = 0;
    this.floatingTexts = [];
    this.empPulses = [];
    this.uiButtons = [];
    this.buildArena(
      typeof window !== 'undefined' ? window.innerWidth : 800,
      typeof window !== 'undefined' ? window.innerHeight : 600,
    );
    this.initPlayers();
    this.resetRacers();
    this.ai.reset();
    this.onTouchesReset();
  }

  reset() {
    this.resetMatch();
  }

  resetRacers() {
    const arena = this.arena;
    const startX = arena.left + arena.width * 0.2;
    const startY = arena.top + arena.height * 0.75;

    this.players.forEach((player, index) => {
      // Başlangıç ızgarası da orantılı: 32/28px mutlak kalsaydı telefonda
      // dört araç saha yüksekliğinin %15'ini kaplardı ve birbirine binerdi.
      // `px` (tam ölçek) kullanıldı: ızgara bir konum düzenidir, dekor değil —
      // araçlar dekorla birlikte küçülünce yan yana durmaları doğru.
      player.x = startX - (index % 2) * this.px(32);
      player.y = startY + (index - 1.5) * this.px(28);
      player.vx = 0;
      player.vy = 0;
      player.speed = 0;
      player.angle = -Math.PI / 2;
      player.radius = this.px(RACE_TUNING.playerRadius);
      player.laps = 0;
      player.nextCheckpoint = 0;
      player.dashCooldown = 0;
      player.dashTimer = 0;
      player.isDashing = false;
      player.jumpZ = 0;
      player.vz = 0;
      player.isJumping = false;
      player.skidTimer = 0;
      player.nitroBoostTimer = 0;
      player.nitroPadLocked = false;
      player.draftingTimer = 0;
      player.isDrafting = false;
      player.empDisruptedTimer = 0;
      player.spinnerHitCooldown = 0;
      player.wallFeedbackCooldown = 0;
      player.bumpCooldown = 0;
      player.lastTapTime = 0;
      player.isAlive = player.isJoined;
    });

    this.empPulses = [];
  }

  startNewMatch() {
    if (this.getActivePlayerCount() < 2) {
      this.state = 'LOBBY';
      return;
    }
    this.scores = [0, 0, 0, 0];
    this.matchWinner = null;
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.tiedRounds = 0;
    this.roundIndex = 0;
    this.applyTrackPreset(TRACK_PRESETS[0]);
    this.startNewRound();
  }

  startNewRound() {
    if (this.getActivePlayerCount() < 2) {
      this.state = 'LOBBY';
      return;
    }

    if (this.roundIndex > 0) {
      const currentIndex = Math.max(0, TRACK_PRESETS.indexOf(this.currentPreset));
      this.applyTrackPreset(TRACK_PRESETS[(currentIndex + 1) % TRACK_PRESETS.length]);
    }
    this.roundIndex += 1;

    this.state = 'PLAYING';
    this.roundTimer = RACE_TUNING.roundTime;
    this.roundTransitionTimer = 0;
    this.roundWinner = null;
    this.matchWinner = null;
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.roundId += 1;
    this.uiButtons = [];
    this.floatingTexts = [];
    this.resetRacers();
    this.ai.resetRound();
    this.onTouchesReset();
    playStart();
  }

  startRound() {
    this.startNewRound();
  }

  getTrackName() {
    return t(TRACK_NAME_KEYS[this.currentPreset] || TRACK_NAME_KEYS.CIRCUIT);
  }

  getPlayerProgress(player) {
    return getRaceProgress(player, this.checkpoints);
  }

  getProgressFraction(player) {
    const total = Math.max(1, this.targetLaps * Math.max(1, this.checkpoints.length));
    return Math.max(0, Math.min(1, this.getPlayerProgress(player) / total));
  }

  getLeaderCandidates() {
    const joined = this.players.filter((player) => player.isJoined);
    if (joined.length === 0) return [];

    let bestProgress = -Infinity;
    for (const player of joined) {
      bestProgress = Math.max(bestProgress, this.getPlayerProgress(player));
    }
    return joined.filter((player) => (
      Math.abs(this.getPlayerProgress(player) - bestProgress) <= RACE_TUNING.progressTieEpsilon
    ));
  }

  getLeaderIndex() {
    const leaders = this.getLeaderCandidates();
    return leaders.length === 1 ? leaders[0].index : -1;
  }

  triggerDash(slotIndex) {
    if (this.state !== 'PLAYING') return;
    const player = this.players[slotIndex];
    if (!player || !player.isJoined || !player.isAlive || player.dashCooldown > 0) return;

    player.dashCooldown = RACE_TUNING.dashCooldown;
    player.isDashing = true;
    player.dashTimer = RACE_TUNING.dashDuration;
    player.isJumping = true;
    player.jumpZ = Math.max(0, player.jumpZ);
    player.vz = Math.max(player.vz, this.spd(RACE_TUNING.jumpVelocity));
    this.addTrauma(0.2);
    playDashWhoosh();

    const leaderIndex = this.getLeaderIndex();
    if (leaderIndex >= 0 && leaderIndex !== player.index) {
      this.empPulses.push({
        x: player.x,
        y: player.y,
        radius: this.px(10),
        maxRadius: this.px(RACE_TUNING.empMaxRadius),
        owner: player.index,
      });
      this.spawnFloatingText(player.x, player.y - 22, t('race.empDash'), '#0EA5E9', {
        bg: UI_COLORS.ink,
        pop: true,
      });
      return;
    }

    this.spawnFloatingText(player.x, player.y - 18, t('race.dash'), UI_COLORS.ink, {
      bg: UI_COLORS.turbo,
      pop: true,
    });
  }

  spawnFloatingText(x, y, text, color, options = {}) {
    if (this.floatingTexts.length >= 40) this.floatingTexts.shift();
    this.floatingTexts.push({
      x,
      y,
      text,
      color,
      bg: options.bg || UI_COLORS.card,
      urgent: options.urgent || false,
      pop: options.pop || false,
      maxLife: options.maxLife || 0.85,
      life: 0,
    });
  }

  tickFloatingTexts(dt) {
    for (let index = this.floatingTexts.length - 1; index >= 0; index--) {
      const item = this.floatingTexts[index];
      item.life += dt;
      if (item.life >= item.maxLife) this.floatingTexts.splice(index, 1);
    }
  }

  syncLobbySeat(index) {
    const player = this.players[index];
    if (!player) return;
    player.slotType = this.slotTypes[index];
    player.isJoined = this.isSlotJoined(index);
    player.isAlive = player.isJoined;
  }

  onTouchStart(touch) {
    if (this.state === 'LOBBY') {
      if (this.handleUiTap(touch)) return;
      if (lobbyCenterStartTap(this, touch)) return;
      lobbyQuadrantTap(this, touch, { onSeatChange: (index) => this.syncLobbySeat(index) });
      playJoin();
      return;
    }

    if (this.state === 'ROUND_OVER') {
      this.handleRoundOverSkip();
      return;
    }

    if (this.state === 'MATCH_OVER') {
      if (this.handleUiTap(touch)) return;
      matchOverRestartTap(this, touch, {
        onRestart: () => {
          this.resetMatch();
          playJoin();
        },
      });
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
    this.players.forEach((player) => {
      player.lastTapTime = 0;
    });
  }

  createWorldPacket() {
    return createRaceWorldPacket(this);
  }

  handleRemoteInput(slotIndex, data) {
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 3 || !data) return;
    if (matchesInputAction(data, 'dash', 'DASH')) {
      this.triggerDash(slotIndex);
      return;
    }
    if (!isInputIntent(data, 'move') && data.action !== 'JOYSTICK_MOVE') return;

    if (this.state !== 'PLAYING') {
      this.handleStandardRemoteJoystick(slotIndex, { ...data, force: 0 });
      return;
    }
    this.handleStandardRemoteJoystick(slotIndex, data);
  }

  update(now) {
    const dt = Math.max(0, Math.min((now - this.lastTime) / 1000, 0.08));
    this.lastTime = now;
    this.updateTrauma(dt);

    if (this.state === 'LOBBY' || this.state === 'MATCH_OVER') return;

    this.tickFloatingTexts(dt);
    if (this.state === 'ROUND_OVER') {
      this.roundTransitionTimer = Math.max(0, this.roundTransitionTimer - dt);
      if (this.roundTransitionTimer <= 0) {
        if (hasMatchResult(this)) this.state = 'MATCH_OVER';
        else this.startNewRound();
      }
      return;
    }
    if (this.state !== 'PLAYING') return;

    this.roundTimer = Math.max(0, this.roundTimer - dt);
    this.obstacleSpinners.forEach((spinner) => {
      spinner.angle += spinner.rotSpeed * dt;
    });

    for (let index = this.empPulses.length - 1; index >= 0; index--) {
      const pulse = this.empPulses[index];
      pulse.radius += this.px(RACE_TUNING.empSpeed) * dt;

      for (const target of this.players) {
        if (!target.isJoined || target.index === pulse.owner) continue;
        const distance = Math.hypot(target.x - pulse.x, target.y - pulse.y);
        const insideRing = distance <= pulse.radius && distance >= pulse.radius - 30;
        if (insideRing && target.empDisruptedTimer <= 0 && target.jumpZ < this.px(RACE_TUNING.jumpClearance)) {
          target.empDisruptedTimer = RACE_TUNING.empDuration;
          this.addTrauma(0.2);
          this.spawnFloatingText(target.x, target.y - 18, t('race.empHit'), '#0EA5E9', {
            bg: UI_COLORS.card,
            urgent: true,
          });
        }
      }

      if (pulse.radius >= pulse.maxRadius) this.empPulses.splice(index, 1);
    }

    this.ai.update(dt);
    const finishers = [];

    for (let index = 0; index < this.players.length; index++) {
      const player = this.players[index];
      if (!player.isJoined || !player.isAlive) continue;

      player.dashCooldown = Math.max(0, player.dashCooldown - dt);
      player.dashTimer = Math.max(0, player.dashTimer - dt);
      if (player.dashTimer <= 0) player.isDashing = false;
      player.skidTimer = Math.max(0, player.skidTimer - dt);
      player.nitroBoostTimer = Math.max(0, player.nitroBoostTimer - dt);
      player.empDisruptedTimer = Math.max(0, player.empDisruptedTimer - dt);
      player.spinnerHitCooldown = Math.max(0, player.spinnerHitCooldown - dt);
      player.wallFeedbackCooldown = Math.max(0, player.wallFeedbackCooldown - dt);
      player.bumpCooldown = Math.max(0, player.bumpCooldown - dt);

      if (player.isJumping || player.jumpZ > 0) {
        player.jumpZ += player.vz * dt;
        player.vz -= this.spd(RACE_TUNING.jumpGravity) * dt;
        if (player.jumpZ <= 0) {
          player.jumpZ = 0;
          player.vz = 0;
          player.isJumping = false;
        }
      }

      player.isDrafting = false;
      for (const other of this.players) {
        if (other.index === player.index || !other.isJoined) continue;
        const dx = other.x - player.x;
        const dy = other.y - player.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= 20 || distance >= 90) continue;

        const angleToOther = Math.atan2(dy, dx);
        if (Math.abs(normalizeAngle(angleToOther - player.angle)) < 0.4 && other.speed > 50) {
          player.isDrafting = true;
          player.draftingTimer += dt;
        }
      }
      if (!player.isDrafting) player.draftingTimer = Math.max(0, player.draftingTimer - dt * 2);

      let moveVec = { x: 0, y: 0, active: false, magnitude: 0 };
      if (player.slotType === 'human') {
        moveVec = this.getPlayerMovementVector(index);
      } else if (player.slotType === 'bot_normal' || player.slotType === 'bot_god') {
        moveVec = this.ai.getBotMovement(index);
      }

      let maxSpeed = this.spd(RACE_TUNING.baseSpeed);
      let acceleration = this.spd(RACE_TUNING.baseAcceleration);
      let dragRate = 3.7;
      if (player.isDashing || player.nitroBoostTimer > 0) {
        maxSpeed = this.spd(RACE_TUNING.dashSpeed);
        acceleration = this.spd(RACE_TUNING.dashAcceleration);
      }
      if (player.isDrafting && player.draftingTimer > 0.4) {
        maxSpeed *= 1.25;
        acceleration *= 1.3;
      }
      if (player.skidTimer > 0 && player.jumpZ < this.px(RACE_TUNING.jumpClearance)) {
        maxSpeed *= 0.6;
        acceleration *= 0.4;
        dragRate = 1.2;
        player.angle += (index % 2 === 0 ? 4 : -4) * dt;
      }
      if (player.empDisruptedTimer > 0) {
        maxSpeed *= 0.45;
        acceleration *= 0.3;
      }

      if (moveVec.active && player.skidTimer <= 0 && player.empDisruptedTimer <= 0) {
        const targetAngle = Math.atan2(moveVec.y, moveVec.x);
        const angleDiff = normalizeAngle(targetAngle - player.angle);
        player.angle += angleDiff * Math.min(1, dt * 10);
        const throttle = 0.35 + 0.65 * (moveVec.magnitude ?? 1);
        player.vx += Math.cos(player.angle) * acceleration * throttle * dt;
        player.vy += Math.sin(player.angle) * acceleration * throttle * dt;
      }

      const drag = Math.exp(-dragRate * dt);
      player.vx *= drag;
      player.vy *= drag;
      const currentSpeed = Math.hypot(player.vx, player.vy);
      if (currentSpeed > maxSpeed && currentSpeed > 0) {
        player.vx = (player.vx / currentSpeed) * maxSpeed;
        player.vy = (player.vy / currentSpeed) * maxSpeed;
      }
      player.speed = Math.hypot(player.vx, player.vy);

      const intendedX = player.x + player.vx * dt;
      const intendedY = player.y + player.vy * dt;
      player.x = intendedX;
      player.y = intendedY;
      clampToArena(player, player.radius, this.arena);

      const hitWallX = player.x !== intendedX;
      const hitWallY = player.y !== intendedY;
      if (hitWallX) player.vx = (intendedX < player.x ? 1 : -1) * Math.abs(player.vx) * (player.isJumping ? 1.4 : 0.5);
      if (hitWallY) player.vy = (intendedY < player.y ? 1 : -1) * Math.abs(player.vy) * (player.isJumping ? 1.4 : 0.5);

      if ((hitWallX || hitWallY) && player.isJumping) {
        if (player.speed > 20) player.angle = Math.atan2(player.vy, player.vx);
        if (player.wallFeedbackCooldown <= 0) {
          player.wallFeedbackCooldown = 0.65;
          this.addTrauma(0.25);
          this.spawnFloatingText(player.x, player.y - 18, t('race.wallBounce'), UI_COLORS.ink, {
            bg: UI_COLORS.turbo,
            pop: true,
          });
          playWallHit();
        }
      }

      if (player.jumpZ < this.px(RACE_TUNING.jumpClearance)) {
        for (const slick of this.oilSlicks) {
          const distance = Math.hypot(player.x - slick.x, player.y - slick.y);
          if (distance < slick.radius + player.radius && player.skidTimer <= 0) {
            player.skidTimer = 0.8;
            this.addTrauma(0.15);
            this.spawnFloatingText(player.x, player.y - 15, t('race.skid'), UI_COLORS.ink, {
              bg: UI_COLORS.turbo,
            });
            playSlip();
          }
        }
      }

      let padUnderfoot = false;
      for (const pad of this.nitroPads) {
        const dx = player.x - pad.x;
        const dy = player.y - pad.y;
        const cos = Math.cos(pad.angle);
        const sin = Math.sin(pad.angle);
        const localX = dx * cos + dy * sin;
        const localY = -dx * sin + dy * cos;
        const inside = Math.abs(localX) <= pad.w / 2 + player.radius
          && Math.abs(localY) <= pad.h / 2 + player.radius;
        if (!inside) continue;

        padUnderfoot = true;
        if (player.nitroBoostTimer > 0 || player.nitroPadLocked) continue;

        const boostSpeed = this.spd(RACE_TUNING.dashSpeed);
        const speed = Math.hypot(player.vx, player.vy);
        if (speed < boostSpeed) {
          // Boost along the racer's own heading — the pad's fixed angle may
          // oppose the racing line depending on approach direction.
          const dirX = speed > 1 ? player.vx / speed : Math.cos(player.angle);
          const dirY = speed > 1 ? player.vy / speed : Math.sin(player.angle);
          player.vx = dirX * boostSpeed;
          player.vy = dirY * boostSpeed;
        }
        player.nitroBoostTimer = RACE_TUNING.nitroDuration;
        player.nitroPadLocked = true;
        this.addTrauma(0.2);
        this.spawnFloatingText(player.x, player.y - 15, t('race.nitro'), UI_COLORS.ink, {
          bg: UI_COLORS.turbo,
          pop: true,
        });
        playItemPickup();
      }
      // Re-arm only after the racer fully leaves every pad box, so a
      // wall-bounce back onto the same pad can't relaunch them in a loop.
      if (!padUnderfoot) player.nitroPadLocked = false;

      if (player.jumpZ < this.px(RACE_TUNING.jumpClearance)) {
        for (const spinner of this.obstacleSpinners) {
          const halfLength = spinner.length / 2;
          const endAx = spinner.x - Math.cos(spinner.angle) * halfLength;
          const endAy = spinner.y - Math.sin(spinner.angle) * halfLength;
          const endBx = spinner.x + Math.cos(spinner.angle) * halfLength;
          const endBy = spinner.y + Math.sin(spinner.angle) * halfLength;
          const distanceSquared = distToSegmentSquared(
            player.x,
            player.y,
            endAx,
            endAy,
            endBx,
            endBy,
          );
          const hitRadius = player.radius + 8;
          if (distanceSquared >= hitRadius * hitRadius || player.spinnerHitCooldown > 0) continue;

          player.spinnerHitCooldown = 0.65;
          const distance = Math.sqrt(distanceSquared);
          const pushAngle = distance > 0.001
            ? Math.atan2(player.y - (endAy + endBy) / 2, player.x - (endAx + endBx) / 2)
            : spinner.angle + Math.PI / 2;
          player.vx = Math.cos(pushAngle) * 220;
          player.vy = Math.sin(pushAngle) * 220;
          this.addTrauma(0.25);
          this.spawnFloatingText(player.x, player.y - 15, t('race.spinnerHit'), UI_COLORS.danger, {
            bg: UI_COLORS.card,
            urgent: true,
          });
          playHeavyImpact();
        }
      }

      const targetCheckpoint = this.checkpoints[player.nextCheckpoint];
      if (targetCheckpoint) {
        const distance = Math.hypot(player.x - targetCheckpoint.x, player.y - targetCheckpoint.y);
        if (distance < targetCheckpoint.radius + player.radius) {
          const checkpointName = targetCheckpoint.name;
          player.nextCheckpoint = (player.nextCheckpoint + 1) % this.checkpoints.length;

          if (player.nextCheckpoint === 0) {
            player.laps += 1;
            this.spawnFloatingText(
              player.x,
              player.y - 20,
              t('race.lap', player.laps, this.targetLaps),
              player.color,
              { bg: UI_COLORS.card, pop: true },
            );
            if (player.laps >= this.targetLaps) finishers.push(player);
          } else {
            this.spawnFloatingText(
              player.x,
              player.y - 18,
              t('race.checkpoint', checkpointName),
              targetCheckpoint.color,
              { bg: UI_COLORS.ink },
            );
          }
        }
      }
    }

    if (finishers.length > 0) {
      this.endRound(finishers.length === 1 ? finishers[0] : null);
      return;
    }

    this.resolvePlayerCollisions();
    if (this.roundTimer <= 0) this.finishOnTime();
  }

  resolvePlayerCollisions() {
    const minimumDistance = this.px(RACE_TUNING.playerRadius) * 2;
    for (let firstIndex = 0; firstIndex < this.players.length; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < this.players.length; secondIndex++) {
        const first = this.players[firstIndex];
        const second = this.players[secondIndex];
        if (!first.isJoined || !second.isJoined) continue;

        const dx = second.x - first.x;
        const dy = second.y - first.y;
        const distance = Math.hypot(dx, dy);
        if (distance >= minimumDistance) continue;

        const normalX = distance > 0.001 ? dx / distance : firstIndex % 2 === 0 ? 1 : -1;
        const normalY = distance > 0.001 ? dy / distance : 0;
        const overlap = (minimumDistance - distance) / 2;
        first.x -= normalX * overlap;
        first.y -= normalY * overlap;
        second.x += normalX * overlap;
        second.y += normalY * overlap;

        const firstVx = first.vx;
        const firstVy = first.vy;
        first.vx = second.vx * 0.8 - normalX * 40;
        first.vy = second.vy * 0.8 - normalY * 40;
        second.vx = firstVx * 0.8 + normalX * 40;
        second.vy = firstVy * 0.8 + normalY * 40;

        if (first.bumpCooldown <= 0 || second.bumpCooldown <= 0) {
          first.bumpCooldown = 0.15;
          second.bumpCooldown = 0.15;
          this.addTrauma(0.1);
          playWallHit();
        }
        clampToArena(first, first.radius || this.px(RACE_TUNING.playerRadius), this.arena);
        clampToArena(second, second.radius || this.px(RACE_TUNING.playerRadius), this.arena);
      }
    }
  }

  finishOnTime() {
    const leaders = this.getLeaderCandidates();
    this.endRound(leaders.length === 1 ? leaders[0] : null, 'timeout');
  }

  endRound(winner, reason = 'finish') {
    if (this.state !== 'PLAYING') return;
    this.roundWinner = winner || null;
    this.roundResolutionReason = reason;
    this.uiButtons = [];

    if (winner) {
      this.tiedRounds = 0;
      this.matchDraw = false;
      this.scores[winner.index] += 1;
      this.addTrauma(0.5);
      playItemPickup();
      if (this.scores[winner.index] >= this.targetScore) {
        this.matchWinner = winner;
        this.state = 'MATCH_OVER';
        return;
      }
    } else {
      this.tiedRounds += 1;
      if (!this.players.some((p) => p.isJoined) || this.tiedRounds >= 2) {
        beginDrawRound(this, reason, 1.6);
        return;
      }
    }

    this.state = 'ROUND_OVER';
    this.roundTransitionTimer = RACE_TUNING.roundTransition;
  }

  drawNitroPad(ctx, pad) {
    const pulse = 1 + Math.sin(performance.now() * 0.006) * 0.04;
    ctx.save();
    ctx.translate(pad.x, pad.y);
    ctx.rotate(pad.angle);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = UI_COLORS.ink;
    ctx.fillRect(-pad.w / 2 + 4, -pad.h / 2 + 4, pad.w, pad.h);
    ctx.fillStyle = UI_COLORS.turbo;
    ctx.fillRect(-pad.w / 2, -pad.h / 2, pad.w, pad.h);
    ctx.strokeStyle = UI_COLORS.ink;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(-pad.w / 2, -pad.h / 2, pad.w, pad.h);
    drawTabletopIcon(ctx, 'zap', 0, 0, Math.min(pad.w, pad.h) * 0.62, {
      color: UI_COLORS.ink,
      strokeWidth: 2.4,
    });
    ctx.restore();
  }

  drawPlayer(ctx, player) {
    const jumpOffsetY = -player.jumpZ * 0.8;
    const shadowScale = Math.max(0.68, 1 - player.jumpZ * 0.018);

    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.scale(shadowScale, shadowScale);
    ctx.fillStyle = player.jumpZ > 1 ? 'rgba(26, 26, 26, 0.25)' : 'rgba(26, 26, 26, 0.16)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 15, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (player.isDrafting) {
      ctx.save();
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(player.x, player.y + jumpOffsetY);
      ctx.lineTo(
        player.x - Math.cos(player.angle) * 35,
        player.y + jumpOffsetY - Math.sin(player.angle) * 35,
      );
      ctx.stroke();
      ctx.restore();
    }

    const jumpScale = 1 + Math.min(0.38, player.jumpZ * 0.035);
    ctx.save();
    ctx.translate(player.x, player.y + jumpOffsetY);
    ctx.scale(jumpScale, jumpScale);
    ctx.rotate(player.angle);

    if (player.isDashing || player.nitroBoostTimer > 0) {
      ctx.fillStyle = UI_COLORS.turbo;
      ctx.fillRect(-28, -8, 14, 16);
    }
    if (player.empDisruptedTimer > 0) {
      ctx.strokeStyle = '#0EA5E9';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-12, -10);
    ctx.lineTo(-8, 0);
    ctx.lineTo(-12, 10);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = UI_COLORS.ink;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();

    const pipCount = player.index + 1;
    const pipSpacing = 5;
    const startX = player.x - ((pipCount - 1) * pipSpacing) / 2;
    for (let pipIndex = 0; pipIndex < pipCount; pipIndex++) {
      ctx.beginPath();
      ctx.arc(startX + pipIndex * pipSpacing, player.y + jumpOffsetY, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = UI_COLORS.card;
      ctx.fill();
      ctx.strokeStyle = UI_COLORS.ink;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    const targetCheckpoint = this.checkpoints[player.nextCheckpoint];
    if (targetCheckpoint && this.state === 'PLAYING') {
      const arrowAngle = Math.atan2(targetCheckpoint.y - player.y, targetCheckpoint.x - player.x);
      ctx.save();
      ctx.translate(
        player.x + Math.cos(arrowAngle) * 26,
        player.y + Math.sin(arrowAngle) * 26 + jumpOffsetY,
      );
      ctx.rotate(arrowAngle);
      ctx.fillStyle = targetCheckpoint.color;
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(-4, -4);
      ctx.lineTo(-4, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  render() {
    const ctx = this.ctx;
    const width = this.viewport.width;
    const height = this.viewport.height;

    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = UI_COLORS.paperOutside || UI_COLORS.paper;
    ctx.fillRect(0, 0, width, height);
    this.applyScreenShake(ctx);

    if (this.state === 'LOBBY') {
      this.uiButtons = [];
      this.renderStandardLobby(ctx, {
        arena: this.arena,
        accent: UI_COLORS.turbo,
        customControls: (customCtx) => {
          customCtx.save();
          customCtx.fillStyle = UI_COLORS.ink;
          customCtx.font = `900 16px ${UI_FONTS.mono}`;
          customCtx.textAlign = 'center';
          customCtx.fillText(`BRUTAL RACE // ${this.getTrackName()}`, this.arena.cx, this.arena.top + 28);
          customCtx.restore();
        },
      });
      ctx.restore();
      return;
    }

    const arena = this.arena;
    ctx.fillStyle = UI_COLORS.paperWarm;
    ctx.fillRect(arena.left, arena.top, arena.width, arena.height);
    ctx.strokeStyle = UI_COLORS.ink;
    ctx.lineWidth = 4;
    ctx.strokeRect(arena.left, arena.top, arena.width, arena.height);

    ctx.strokeStyle = 'rgba(26, 26, 26, 0.06)';
    ctx.lineWidth = 1;
    for (let x = arena.left; x < arena.right; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, arena.top);
      ctx.lineTo(x, arena.bottom);
      ctx.stroke();
    }
    for (let y = arena.top; y < arena.bottom; y += 40) {
      ctx.beginPath();
      ctx.moveTo(arena.left, y);
      ctx.lineTo(arena.right, y);
      ctx.stroke();
    }

    for (const pulse of this.empPulses) {
      ctx.save();
      ctx.strokeStyle = '#0EA5E9';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(pulse.x, pulse.y, pulse.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    for (const slick of this.oilSlicks) {
      ctx.save();
      ctx.fillStyle = 'rgba(26, 26, 26, 0.75)';
      ctx.beginPath();
      ctx.arc(slick.x, slick.y, slick.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = UI_COLORS.turbo;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    this.nitroPads.forEach((pad) => this.drawNitroPad(ctx, pad));
    for (const spinner of this.obstacleSpinners) {
      ctx.save();
      ctx.translate(spinner.x, spinner.y);
      ctx.rotate(spinner.angle);
      drawObstacle(ctx, { x: -spinner.length / 2, y: -8, w: spinner.length, h: 16 }, { variant: 'stone' });
      ctx.fillStyle = UI_COLORS.ink;
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    for (const checkpoint of this.checkpoints) {
      ctx.save();
      ctx.fillStyle = checkpoint.color;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(checkpoint.x, checkpoint.y, checkpoint.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = checkpoint.color;
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = UI_COLORS.ink;
      ctx.font = `900 16px ${UI_FONTS.mono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(checkpoint.name, checkpoint.x, checkpoint.y);
      ctx.restore();
    }

    if (this.state === 'PLAYING') {
      renderTopPill(ctx, {
        arena,
        text: t('race.hud', this.getTrackName(), Math.ceil(this.roundTimer)),
        urgent: this.roundTimer <= 15,
        customW: 210,
        // Tur sayacı oyun boyunca görünür: kalıcı play-state chrome. Kompakt
        // yatayda opak çubuk sahanın üst payına (3px) oturup oynanış alanını
        // kapatıyordu; çubuk yerine çıplak metne düşer.
        persistent: true,
      });
    }

    for (const player of this.players) {
      if (player.isJoined && player.isAlive) this.drawPlayer(ctx, player);
    }

    renderFloatingTexts(ctx, this.floatingTexts, 0);
    this.renderStandardJoysticks(ctx);

    const hudPlayers = this.players.map((player) => ({
      index: player.index,
      name: player.name,
      color: player.color,
      isJoined: player.isJoined,
      slotType: player.slotType,
    }));
    renderUniversalScoreboard(ctx, {
      arena,
      players: hudPlayers,
      scores: this.scores,
      targetScore: this.targetScore,
      entities: this.players,
      layout: 'corners',
      state: this.state,
    });

    if (this.state === 'PLAYING') {
      // Telefon yatayda bu şerit sahanın üstünü kalıcı kapatıyordu; bilgi
      // tek butonun açtığı menüde. Masaüstü/tablete değişiklik yok.
      renderControlGuide(ctx, arena, t('guide.race'), [
        t(
          'guide.raceKeys',
          getKeyLabel('action', 0),
          getKeyLabel('action', 1),
          getKeyLabel('action', 2),
          getKeyLabel('action', 3),
        ),
      ], { duringPlay: true });
    }

    if (this.state === 'ROUND_OVER') {
      this.uiButtons = [];
      const title = this.roundWinner
        ? t('game.won', this.roundWinner.name)
        : t('game.draw');
      renderRoundBanner(ctx, {
        arena,
        title,
        titleColor: this.roundWinner?.color || UI_COLORS.ink,
        sub: t('race.roundGoal', this.targetScore),
      });
    } else if (this.state === 'MATCH_OVER') {
      this.uiButtons = [];
      const rows = this.players.filter((player) => player.isJoined).map((player) => ({
        text: t('race.scoreRow', player.name, this.scores[player.index]),
        color: player.color,
      }));
      renderMatchOver(ctx, {
        arena,
        uiButtons: this.uiButtons,
        headline: this.matchDraw ? t('game.draw') : t('game.champWon'),
        winnerName: this.matchWinner?.name || '',
        winnerColor: this.matchWinner?.color || UI_COLORS.ink,
        rows,
        onRestart: () => {
          this.resetMatch();
          playJoin();
        },
      });
    }

    ctx.restore();
  }

  resize(width, height) {
    this.updateViewport(width, height);
    const oldArena = { ...this.arena };
    const oldSpinnerAngles = this.obstacleSpinners.map((spinner) => spinner.angle);
    this.buildArena(width, height);
    this.obstacleSpinners.forEach((spinner, index) => {
      if (typeof oldSpinnerAngles[index] === 'number') spinner.angle = oldSpinnerAngles[index];
    });

    if (this.state === 'LOBBY' || this.players.length === 0) {
      this.resetRacers();
    } else {
      const oldSize = Math.min(oldArena.width || 0, oldArena.height || 0);
      const newSize = Math.min(this.arena.width || 0, this.arena.height || 0);
      const pulseScale = oldSize > 0 ? newSize / oldSize : 1;
      this.players.forEach((player) => {
        this.remapPoint(player, oldArena, this.arena);
        clampToArena(player, player.radius || this.px(RACE_TUNING.playerRadius), this.arena, { zeroVelocity: true });
      });
      this.empPulses.forEach((pulse) => {
        this.remapPoint(pulse, oldArena, this.arena);
        pulse.radius *= pulseScale;
        clampToArena(pulse, 0, this.arena);
      });
      this.floatingTexts.forEach((item) => this.remapPoint(item, oldArena, this.arena));
    }
    this.onTouchesReset();
  }
}
