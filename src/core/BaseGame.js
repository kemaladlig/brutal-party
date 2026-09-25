// BaseMiniGame: Unified Base Class for All Mini-Game Engines
// Provides common state management, fixed timing, screen trauma/shake, slot helpers,
// standardized 4-player local keyboard listeners, multi-touch virtual joysticks & lobby rendering.

import { prefersReducedMotion, motionScale } from '../ui/motion.js';
import { getStandardSeatRects, renderLobbySeatCard, renderLobbyStartButton, getSeatColorDotRect, renderControlGuide } from '../controlGuide.js';
import { getLocalSeatColors, ensureLocalSeatColor, cycleLocalSeatColor, getBotPersona } from './customizationManager.js';
import { resolveSlotName } from './slotManager.js';
import { isSlotActionEvent, keyboardVectorFrom, getKeyLabel } from './inputMaps.js';
import { getQuadrant, roundOverSkipGuard } from './touchFlow.js';
import { UI_COLORS, getDisplayProfile, shouldShowVirtualControls, isTouchDevice } from '../ui/tokens.js';
import { renderAdaptiveScoreboard, renderRoundBanner, renderMatchOver, cleanWinnerName } from '../ui/hud.js';
import { t } from '../i18n.js';
import { drawTabletopIcon } from './tabletopIcons.js';
import {
  AIM_HOLD_TO_FIRE,
  AIM_RELEASE_TO_FIRE,
  getControlDef,
  getTabletopLayout,
  validateControlDef,
} from '../controllers/controlDefs.js';
import {
  claimInputSource as arbitrateInputSource,
  releaseInputSource as arbitrateInputRelease,
} from './inputSource.js';
import { isInputIntent, matchesInputAction } from './inputIntent.js';
import { assertControlDescriptorParity } from './controlDescriptor.js';
import { AimInputState, getAimAction } from './aimInput.js';

const STEER_KEY_HINTS = ['A/D', '←/→', 'J/L', 'F/H'];

export class BaseMiniGame {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // States: 'LOBBY', 'PLAYING', 'ROUND_OVER', 'MATCH_OVER', etc.
    this.state = 'LOBBY';

    // Tournament Scores (P1, P2, P3, P4)
    this.scores = [0, 0, 0, 0];
    this.targetScore = 3;
    this.roundWinner = null;
    this.matchWinner = null;

    // Slot States: 'empty' | 'human' | 'bot_normal' | 'bot_god'
    this.slotTypes = ['human', 'bot_normal', 'empty', 'empty'];

    // Screen Shake / Trauma (0.0 to 1.0)
    this.trauma = 0;

    // Timing
    this.lastTime = performance.now();

    // Interactive UI Rectangles [{ x, y, w, h, onClick }]
    this.uiButtons = [];

    // Host modunda main tarafından atanır: LOBBY koltuk tap'leri motora
    // yazmadan önce host'a sorulur (bot ekleme/çıkarma). Lokal oyunda null
    // kalır ve klasik cycleSlotType davranışı çalışır.
    this.onLobbySeatTap = null;

    // ONLINE host telefonu P1'i kendisi oynar; TV_CONSOLE host varsayılan
    // olarak seyirci ekranıdır, ancak lobi düğmesiyle local P1 oyuncusuna
    // dönüşebilir. Render/input katmanı bu iki rolü ortak kodla ayırır.
    this.suppressVirtualControls = false;
    this.forceVirtualControls = false;
    this.localControlSlot = null;

    // Klavye çapraz-konuşma kilidi: main.setGameMode yalnızca aktif motoru
    // açar (E27). Pasif motorda kalan PLAYING + Space gibi ortak tuşlar
    // yanlış oyunda dash/ateş/tap üretmesin diye keydown guard'ları buna bakar.
    this.isLocalInputActive = false;

    // Shared Local Keyboard Input State
    this.keys = {};
    this._keyboardBound = false;
    this.inputSource = null;
    this._inputSourceKeyboardGuard = (e) => {
      if (!this.isLocalInputActive) return;
      const isControlKey = e.code === 'Space'
        || e.key === ' '
        || e.code === 'Enter'
        || e.code === 'NumpadEnter'
        || e.code.startsWith('Arrow')
        || ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyI', 'KeyJ', 'KeyK', 'KeyL', 'KeyT', 'KeyF', 'KeyG', 'KeyH', 'KeyB', 'KeyO'].includes(e.code);
      if (!isControlKey) return;
      if (this.inputSource === 'touch') {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      this.inputSource = 'keyboard';
    };
    window.addEventListener('keydown', this._inputSourceKeyboardGuard, true);

    // 4 Corner Floating Virtual Joysticks (P1: BL, P2: TL, P3: TR, P4: BR)
    this.joysticks = [
      { id: -1, originX: 0, originY: 0, currX: 0, currY: 0, active: false, angle: 0, force: 0 },
      { id: -1, originX: 0, originY: 0, currX: 0, currY: 0, active: false, angle: 0, force: 0 },
      { id: -1, originX: 0, originY: 0, currX: 0, currY: 0, active: false, angle: 0, force: 0 },
      { id: -1, originX: 0, originY: 0, currX: 0, currY: 0, active: false, angle: 0, force: 0 },
    ];

    // Tabletop Steer (SOL / SAĞ) State tracking
    this.tabletopSteerTouches = new Map();
    this.tabletopSteerState = [0, 0, 0, 0];

    // Tabletop Multi-Touch Action State tracking
    this.tabletopActionTouches = new Map();
    this.tabletopActionState = [{}, {}, {}, {}];

    // Optional secondary analog aim input (MOBA twin-stick games).
    this.tabletopAimTouches = new Map();
    this.tabletopAimState = [null, null, null, null];
    this.aimStates = [0, 1, 2, 3].map(() => new AimInputState());
    this.aimVectors = [0, 1, 2, 3].map(() => ({ dx: 0, dy: 0, angle: 0, force: 0 }));

    // Responsive Viewport (Ayrık HUD & Dokunmatik için ekran sınırları)
    const initW = typeof window !== 'undefined' ? window.innerWidth : 800;
    const initH = typeof window !== 'undefined' ? window.innerHeight : 600;
    this.viewport = {
      left: 0,
      top: 0,
      right: initW,
      bottom: initH,
      width: initW,
      height: initH,
      cx: initW / 2,
      cy: initH / 2,
    };
  }

  updateViewport(w = window.innerWidth, h = window.innerHeight) {
    this.viewport = {
      left: 0,
      top: 0,
      right: w,
      bottom: h,
      width: w,
      height: h,
      cx: w / 2,
      cy: h / 2,
    };
  }

  // ---------------------------------------------------------------------------
  // Slot & Lobby Management
  // ---------------------------------------------------------------------------

  // LOBBY koltuk tap'i: host varsa ona devret (true), yoksa false dön.
  requestLobbySeatTap(index) {
    if (typeof this.onLobbySeatTap === 'function') {
      this.onLobbySeatTap(index);
      return true;
    }
    return false;
  }

  isSlotJoined(index) {
    return this.slotTypes[index] !== 'empty';
  }

  getActivePlayerCount() {
    return this.slotTypes.filter((s) => s !== 'empty').length;
  }

  syncSlotEntity(index, newColor = null) {
    const slotType = this.slotTypes[index];
    const isBot = slotType === 'bot_normal' || slotType === 'bot_god';
    const persona = isBot ? getBotPersona(index, slotType === 'bot_god') : null;
    const color = newColor || persona?.color || null;
    const ent = this.players?.[index] || this.tanks?.[index] || this.paddles?.[index];
    if (ent) {
      ent.name = resolveSlotName(index, slotType);
      ent.slotType = slotType;
      ent.isJoined = slotType !== 'empty';
      if (color) ent.color = color;
    }
    // LOCAL: yeni insan koltuğuna boş renk ata (hook dönmediyse lokaldir)
    if (slotType === 'human' && !this.hideLobbyStartButton) {
      this.applyLocalSeatColor(index, ensureLocalSeatColor(index));
    } else if (color) {
      this.applyLocalSeatColor(index, color);
    }
  }

  cycleSlotType(index) {
    if (this.requestLobbySeatTap(index)) return;
    let newColor = null;
    if (this.slotTypes[index] === 'empty') {
      this.slotTypes[index] = 'human';
    } else if (this.slotTypes[index] === 'human') {
      this.slotTypes[index] = 'bot_normal';
      const persona = getBotPersona(index, false);
      newColor = persona.color;
    } else if (this.slotTypes[index] === 'bot_normal') {
      this.slotTypes[index] = 'bot_god';
      const persona = getBotPersona(index, true);
      newColor = persona.color;
    } else {
      this.slotTypes[index] = 'empty';
    }
    this.syncSlotEntity(index, newColor);
  }

  // Canlı motor varlığına LOCAL koltuk rengini yaz (players/tanks/paddles).
  applyLocalSeatColor(index, hex) {
    if (!hex) return;
    const p = this.players?.[index] || this.tanks?.[index] || this.paddles?.[index];
    if (p) p.color = hex;
    if (Array.isArray(this.playerColors)) this.playerColors[index] = hex;
  }

  // LOCAL lobi renk noktası: sıradaki boş renge geçir.
  cycleLocalSeat(index) {
    if (this.hideLobbyStartButton) return;
    if (this.requestLobbySeatTap(index)) return;
    this.applyLocalSeatColor(index, cycleLocalSeatColor(index));
  }

  // ---------------------------------------------------------------------------
  // Screen Shake & Motion
  // ---------------------------------------------------------------------------

  addTrauma(amount) {
    // Azaltılmış harekette sarsıntı birikmez (motionScale 0)
    this.trauma = Math.min(1.0, this.trauma + amount * motionScale());
  }

  updateTrauma(dt, decayRate = 2.2) {
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * decayRate);
    }
  }

  applyScreenShake(ctx, maxOffset = 14) {
    if (prefersReducedMotion()) return;
    if (this.trauma > 0) {
      const shakeIntensity = this.trauma * this.trauma * maxOffset;
      const offsetX = (Math.random() - 0.5) * 2 * shakeIntensity;
      const offsetY = (Math.random() - 0.5) * 2 * shakeIntensity;
      ctx.translate(offsetX, offsetY);
    }
  }

  // Resize'da canlı varlığı orantılı taşı: eski arenadaki göreli konum
  // yeni arenaya yazılır (raunt sıfırlanmaz, ölü dirilmez, skor korunur).
  // Yalnızca LOBBY'de tam kurulum yapılır; maç ortası hep remap'tir.
  remapPoint(p, oldArena, newArena) {
    if (!p || !oldArena || !newArena) return;
    const rx = oldArena.width > 0 ? (p.x - oldArena.left) / oldArena.width : 0.5;
    const ry = oldArena.height > 0 ? (p.y - oldArena.top) / oldArena.height : 0.5;
    p.x = newArena.left + Math.max(0, Math.min(1, rx)) * newArena.width;
    p.y = newArena.top + Math.max(0, Math.min(1, ry)) * newArena.height;
  }

  // ---------------------------------------------------------------------------
  // Local Keyboard Input (4 Slots: WASD, Arrows, IJKL, TFGH)
  // ---------------------------------------------------------------------------

  claimInputSource(source, options = {}) {
    const allowAlongside = source === 'touch'
      && !!options.point
      && this.isTabletopAimPoint(options.point);
    const result = arbitrateInputSource(this.inputSource, source, { allowAlongside });
    this.inputSource = result.current;
    return result.accepted;
  }

  releaseInputSource(source = null) {
    this.inputSource = arbitrateInputRelease(this.inputSource, source);
  }

  resetInputSource() {
    this.inputSource = null;
  }

  bindStandardKeyboard(onPlayerAction = null) {
    if (this._keyboardBound) return;
    this._keyboardBound = true;

    window.addEventListener('keydown', (e) => {
      if (!this.isLocalInputActive) return;
      const isControlKey = e.code === 'Space'
        || e.key === ' '
        || e.code.startsWith('Arrow')
        || ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyI', 'KeyJ', 'KeyK', 'KeyL', 'KeyT', 'KeyF', 'KeyG', 'KeyH', 'KeyB'].includes(e.code);
      if (isControlKey && !this.claimInputSource('keyboard')) return;

      // Blur any focused DOM element (like bento menu buttons) to avoid accidental click invocation via Space
      if (document.activeElement && document.activeElement !== document.body && document.activeElement !== this.canvas) {
        try { document.activeElement.blur(); } catch {}
      }

      // Prevent default scrolling / button triggering on game control keys
      if (e.code === 'Space' || e.key === ' ' || e.code.startsWith('Arrow') || e.code === 'Tab') {
        e.preventDefault();
      }

      this.keys[e.key] = true;
      if (e.key) this.keys[e.key.toLowerCase()] = true;
      this.keys[e.code] = true;

      if (this.state === 'PLAYING' && typeof onPlayerAction === 'function') {
        for (let i = 0; i < 4; i++) {
          if (this.isPlayerActionKey(e, i)) {
            onPlayerAction(i, e);
          }
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.key] = false;
      if (e.key) this.keys[e.key.toLowerCase()] = false;
      this.keys[e.code] = false;
    });
  }

  isPlayerActionKey(e, slotIndex) {
    return isSlotActionEvent(e, slotIndex);
  }

  getPlayerKeyboardVector(slotIndex) {
    if (!this.isLocalInputActive || (this.inputSource && this.inputSource !== 'keyboard')) return { x: 0, y: 0 };
    return keyboardVectorFrom(this.keys, slotIndex);
  }

  // ---------------------------------------------------------------------------
  // Multi-Touch Virtual Joysticks (4 Corners)
  // ---------------------------------------------------------------------------

  getCornerQuadrant(point) {
    const arena = this.arena ?? { cx: this.canvas.width / 2, cy: this.canvas.height / 2 };
    return getQuadrant(arena, point.x, point.y);
  }

  // ROUND_OVER tap-to-skip gardı (touchFlow tek kayıt; PONG 'roundOverTimer' verir)
  handleRoundOverSkip(timerField = 'roundTransitionTimer') {
    return roundOverSkipGuard(this, timerField);
  }

  handleStandardJoystickTouchStart(touch, onDoubleTapAction = null) {
    if (!this.claimInputSource('touch')) return false;
    const q = this.getCornerQuadrant(touch);
    const joy = this.joysticks[q];
    const p = this.players?.[q];

    if (p && p.isJoined && p.slotType === 'human' && !joy.active) {
      const now = performance.now();
      if (p.lastTapTime && now - p.lastTapTime < 280 && typeof onDoubleTapAction === 'function') {
        onDoubleTapAction(q);
      }
      p.lastTapTime = now;

      joy.id = touch.id;
      joy.originX = touch.x;
      joy.originY = touch.y;
      joy.currX = touch.x;
      joy.currY = touch.y;
      joy.active = true;
      joy.angle = 0;
      joy.force = 0;
      return true;
    }
    return false;
  }

  handleStandardJoystickTouchMove(touch, maxRadius = 48) {
    for (let q = 0; q < 4; q++) {
      const joy = this.joysticks[q];
      if (joy.active && joy.id === touch.id) {
        const dx = touch.x - joy.originX;
        const dy = touch.y - joy.originY;
        const dist = Math.hypot(dx, dy);

        joy.angle = Math.atan2(dy, dx);
        joy.force = Math.min(1.0, dist / maxRadius);

        if (dist > maxRadius) {
          joy.currX = joy.originX + Math.cos(joy.angle) * maxRadius;
          joy.currY = joy.originY + Math.sin(joy.angle) * maxRadius;
        } else {
          joy.currX = touch.x;
          joy.currY = touch.y;
        }
        return true;
      }
    }
    return false;
  }

  handleStandardJoystickTouchEnd(touch) {
    for (let q = 0; q < 4; q++) {
      const joy = this.joysticks[q];
      if (joy.active && joy.id === touch.id) {
        joy.active = false;
        joy.id = -1;
        joy.force = 0;
        if (!this.joysticks.some((candidate) => candidate.active)) this.releaseInputSource('touch');
        return true;
      }
    }
    return false;
  }

  resetStandardJoysticks() {
    for (const joy of this.joysticks) {
      joy.active = false;
      joy.id = -1;
      joy.force = 0;
    }
    this.releaseInputSource('touch');
  }

  // ---------------------------------------------------------------------------
  // Tabletop Universal Layout & Schema
  // ---------------------------------------------------------------------------

  getTabletopSchema() {
    return {
      joystick: true,
      actions: [],
    };
  }

  // Merkezi sözleşme köprüsü: motor kendi şemasını bildirir, yapı
  // `controlDefs.js` ile parite denetiminden geçer (sol + max 2 sağ).
  // Yeni oyunlar `getTabletopLayout(MOD)` çıktısını doğrudan dönebilir.
  getCentralTabletopLayout(mode) {
    return getTabletopLayout(mode);
  }

  assertTabletopParity(mode) {
    try {
      const schema = this.getTabletopSchema();
      const result = assertControlDescriptorParity(mode, schema);
      if (!result.ok) {
        console.warn(`[controlDescriptor] ${mode}: ${result.reason}`);
        return false;
      }
      const actualIds = (schema.actions || []).map((action) => action.id);
      const expectedIds = result.descriptor.tabletop.actions.map((action) => action.id);
      const actualLeft = schema.steer ? 'steer' : schema.joystick ? 'joystick' : null;
      if (actualIds.join('|') !== expectedIds.join('|')
        || actualLeft !== result.descriptor.tabletop.left
        || !!schema.aim !== !!result.descriptor.tabletop.aim
        || schema.aimMode !== result.descriptor.tabletop.aimMode) {
        console.warn(`[controlDescriptor] ${mode}: engine tabletop schema differs from registry`);
        return false;
      }
      return validateControlDef(mode, schema);
    } catch { return true; }
  }

  _syncAimState(slotIndex) {
    const state = this.aimStates?.[slotIndex];
    if (!state) return;
    const vector = { ...state.vector };
    this.aimVectors[slotIndex] = vector;
    this.tabletopAimState[slotIndex] = state.snapshot();
  }

  getAimState(slotIndex) {
    return this.aimStates?.[slotIndex] || null;
  }

  getAimMode() {
    return getControlDef(this.controlMode)?.aimMode || null;
  }

  isReleaseToFireAim() {
    return this.getAimMode() === AIM_RELEASE_TO_FIRE;
  }

  isHoldToFireAim() {
    return this.getAimMode() === AIM_HOLD_TO_FIRE;
  }

  setAimVector(slotIndex, input = {}) {
    const state = this.getAimState(slotIndex);
    if (!state) return null;
    state.setVector(input);
    this._syncAimState(slotIndex);
    if (typeof this.onSlotAim === 'function') this.onSlotAim(slotIndex, input);
    return state.snapshot();
  }

  getAimVector(slotIndex) {
    const vector = this.aimStates?.[slotIndex]?.vector;
    return vector ? { ...vector } : { dx: 0, dy: 0, angle: 0, force: 0 };
  }

  handleSlotAim(slotIndex, input = {}, options = {}) {
    const state = this.getAimState(slotIndex);
    if (!state) return null;
    const source = options.source || input.intent?.source || 'touch';
    const event = state.move(source, input, input);
    this._syncAimState(slotIndex);
    if (event.accepted && event.type === 'press') {
      this.onSlotAimHold?.(slotIndex, true, { ...event, source });
    }
    if (typeof this.onSlotAim === 'function') this.onSlotAim(slotIndex, input);
    return event;
  }

  handleSlotAimStart(slotIndex, input = {}, options = {}) {
    const state = this.getAimState(slotIndex);
    if (!state) return null;
    const source = options.source || input.intent?.source || 'touch';
    const event = state.press(source, input, input);
    this._syncAimState(slotIndex);
    if (event.accepted && !event.previousHeld) {
      this.onSlotAimHold?.(slotIndex, true, { ...event, source });
    }
    if (typeof this.onSlotAim === 'function') this.onSlotAim(slotIndex, input);
    return event;
  }

  handleSlotAimEnd(slotIndex, input = {}, options = {}) {
    const state = this.getAimState(slotIndex);
    if (!state) return null;
    const source = options.source || input.intent?.source || 'touch';
    const event = state.release(source, input, {
      ...input,
      cancelled: options.cancelled === true,
    });
    this._syncAimState(slotIndex);
    if (event.accepted && event.previousHeld) {
      this.onSlotAimHold?.(slotIndex, false, { ...event, source });
    }
    if (typeof this.onSlotAim === 'function') this.onSlotAim(slotIndex, input);
    return event;
  }

  clearAimInput(slotIndex, source = null, cancelled = true) {
    const state = this.getAimState(slotIndex);
    if (!state) return [];
    const events = state.clear(source, cancelled);
    this._syncAimState(slotIndex);
    for (const event of events) {
      this.onSlotAimHold?.(slotIndex, false, { ...event, source: event.source });
    }
    return events;
  }

  resetAimInput(slotIndex) {
    const state = this.getAimState(slotIndex);
    if (!state) return;
    const events = state.clear(null, true);
    for (const event of events) {
      this.onSlotAimHold?.(slotIndex, false, { ...event, source: event.source });
    }
    state.reset();
    this._syncAimState(slotIndex);
  }

  resetAimInputs() {
    for (let i = 0; i < this.aimStates.length; i++) this.resetAimInput(i);
  }

  applyAimLifecycleInput(slotIndex, data, onPress, onRelease) {
    const action = getAimAction(data);
    if (action !== 'AIM_PRESS' && action !== 'AIM_RELEASE') return false;
    const source = data.intent?.source || 'network';
    const event = action === 'AIM_PRESS'
      ? this.handleSlotAimStart(slotIndex, data, { source })
      : this.handleSlotAimEnd(slotIndex, data, {
        source,
        cancelled: data.cancelled === true,
      });
    if (event?.accepted && typeof this.onSlotAimHold !== 'function') {
      if (action === 'AIM_PRESS' && !event.previousHeld) onPress?.(slotIndex, data, event);
      if (action === 'AIM_RELEASE' && event.previousHeld) onRelease?.(slotIndex, event);
    }
    return true;
  }

  isTabletopAimPoint(touch) {
    if (!touch || !['PLAYING', 'ROUND_PAUSE'].includes(this.state)) return false;
    const schema = this.getTabletopSchema();
    if (!schema?.aim || !shouldShowVirtualControls({
      isHosting: !!this.suppressVirtualControls,
      force: !!this.forceVirtualControls,
    })) return false;
    const players = this.getEntitiesList();
    const corners = this.getTabletopControlCorners();
    for (let i = 0; i < 4; i++) {
      if (this.localControlSlot !== null && i !== this.localControlSlot) continue;
      const player = players?.[i];
      if (!player || !player.isJoined || player.isAlive === false || player.slotType !== 'human') continue;
      const box = corners[i]?.aimBox;
      if (box && touch.x >= box.x && touch.x <= box.x + box.w
        && touch.y >= box.y && touch.y <= box.y + box.h) return true;
    }
    return false;
  }

  getTabletopAimVector(aimBox, x, y) {
    if (!aimBox) return { dx: 0, dy: 0, angle: 0, force: 0 };
    const dx = x - aimBox.cx;
    const dy = y - aimBox.cy;
    const distance = Math.hypot(dx, dy);
    const radius = Math.max(1, aimBox.r || aimBox.w / 2);
    const force = distance < radius * 0.08 ? 0 : Math.min(1, distance / radius);
    return {
      dx: distance > 0 ? (dx / distance) * force : 0,
      dy: distance > 0 ? (dy / distance) * force : 0,
      angle: distance > 0 ? Math.atan2(dy, dx) : 0,
      force,
    };
  }

  handleSlotSteer(slotIndex, dir) {
    if (typeof this.onSlotSteer === 'function') {
      this.onSlotSteer(slotIndex, dir);
    } else if (this.players?.[slotIndex]) {
      this.players[slotIndex].steer = dir;
    }
  }

  handleSlotAction(slotIndex, actionId, isDown) {
    if (typeof this.onSlotAction === 'function') {
      this.onSlotAction(slotIndex, actionId, isDown);
    }
  }

  handleTabletopTouchStart(touch) {
    if (!['PLAYING', 'ROUND_PAUSE'].includes(this.state)) return false;
    if (!this.claimInputSource('touch', { point: touch })) return false;
    const schema = this.getTabletopSchema();
    const players = this.getEntitiesList();

    // 1. Masa-ortası Dokunmatik Kontrolleri (Steer ve Action butonları)
    if (shouldShowVirtualControls({ isHosting: !!this.suppressVirtualControls, force: !!this.forceVirtualControls })) {
      const corners = this.getTabletopControlCorners();
      for (let i = 0; i < 4; i++) {
        if (this.localControlSlot !== null && i !== this.localControlSlot) continue;
        const p = players?.[i];
        if (!p || !p.isJoined || p.isAlive === false || p.slotType !== 'human') continue;
        const corner = corners[i];

        if (schema.aim && corner.aimBox) {
          const aimBox = corner.aimBox;
          if (touch.x >= aimBox.x && touch.x <= aimBox.x + aimBox.w
            && touch.y >= aimBox.y && touch.y <= aimBox.y + aimBox.h) {
            const vector = this.getTabletopAimVector(aimBox, touch.x, touch.y);
            this.tabletopAimTouches.set(touch.id, { slotIndex: i, vector });
            this.handleSlotAimStart(i, vector, { source: 'touch' });
            return true;
          }
        }

        // A. Steer Butonları (SOL / SAĞ)
        if (schema.steer && corner.steerButtons) {
          for (const sBtn of corner.steerButtons) {
            if (
              touch.x >= sBtn.x &&
              touch.x <= sBtn.x + sBtn.w &&
              touch.y >= sBtn.y &&
              touch.y <= sBtn.y + sBtn.h
            ) {
              this.tabletopSteerTouches.set(touch.id, { slotIndex: i, dir: sBtn.dir });
              this.tabletopSteerState[i] = sBtn.dir;
              this.handleSlotSteer(i, sBtn.dir);
              return true;
            }
          }
        }

        // B. Action Butonları
        if (corner.actionButtons) {
          for (const btn of corner.actionButtons) {
            if (
              touch.x >= btn.x &&
              touch.x <= btn.x + btn.w &&
              touch.y >= btn.y &&
              touch.y <= btn.y + btn.h
            ) {
              this.tabletopActionTouches.set(touch.id, { slotIndex: i, actionId: btn.id });
              if (!this.tabletopActionState[i]) this.tabletopActionState[i] = {};
              this.tabletopActionState[i][btn.id] = true;
              this.handleSlotAction(i, btn.id, true);
              return true;
            }
          }
        }
      }
    }

    // 2. Joystick dokunması (steer modunda joystick kapalıdır)
    if (schema.joystick !== false && !schema.steer) {
      return this.handleStandardJoystickTouchStart(touch);
    }
    return false;
  }

  handleTabletopTouchMove(touch) {
    if (this.tabletopAimTouches.has(touch.id)) {
      const info = this.tabletopAimTouches.get(touch.id);
      const corner = this.getTabletopControlCorners()[info.slotIndex];
      if (corner?.aimBox) {
        const vector = this.getTabletopAimVector(corner.aimBox, touch.x, touch.y);
        info.vector = vector;
        this.handleSlotAim(info.slotIndex, vector, { source: 'touch' });
      }
      return true;
    }
    if (this.tabletopSteerTouches.has(touch.id)) {
      const info = this.tabletopSteerTouches.get(touch.id);
      const corners = this.getTabletopControlCorners();
      const corner = corners[info.slotIndex];
      if (corner && corner.steerButtons) {
        let newDir = 0;
        for (const sBtn of corner.steerButtons) {
          if (
            touch.x >= sBtn.x &&
            touch.x <= sBtn.x + sBtn.w &&
            touch.y >= sBtn.y &&
            touch.y <= sBtn.y + sBtn.h
          ) {
            newDir = sBtn.dir;
            break;
          }
        }
        if (info.dir !== newDir) {
          info.dir = newDir;
          this.tabletopSteerState[info.slotIndex] = newDir;
          this.handleSlotSteer(info.slotIndex, newDir);
        }
      }
      return true;
    }
    if (this.tabletopActionTouches.has(touch.id)) {
      return true;
    }
    return this.handleStandardJoystickTouchMove(touch);
  }

  _releaseTouchSourceIfIdle() {
    if (this.tabletopSteerTouches.size === 0
      && this.tabletopActionTouches.size === 0
      && this.tabletopAimTouches.size === 0
      && !this.joysticks.some((joy) => joy.active)) {
      this.releaseInputSource('touch');
    }
  }

  handleTabletopTouchEnd(touch) {
    if (this.tabletopAimTouches.has(touch.id)) {
      const info = this.tabletopAimTouches.get(touch.id);
      this.tabletopAimTouches.delete(touch.id);
      this.handleSlotAimEnd(info.slotIndex, info.vector || {}, {
        source: 'touch',
        cancelled: false,
      });
      this._releaseTouchSourceIfIdle();
      return true;
    }
    if (this.tabletopSteerTouches.has(touch.id)) {
      const info = this.tabletopSteerTouches.get(touch.id);
      this.tabletopSteerTouches.delete(touch.id);
      let remainingDir = 0;
      for (const other of this.tabletopSteerTouches.values()) {
        if (other.slotIndex === info.slotIndex) {
          remainingDir = other.dir;
          break;
        }
      }
      this.tabletopSteerState[info.slotIndex] = remainingDir;
      this.handleSlotSteer(info.slotIndex, remainingDir);
      this._releaseTouchSourceIfIdle();
      return true;
    }
    if (this.tabletopActionTouches.has(touch.id)) {
      const info = this.tabletopActionTouches.get(touch.id);
      this.tabletopActionTouches.delete(touch.id);
      if (this.tabletopActionState[info.slotIndex]) {
        this.tabletopActionState[info.slotIndex][info.actionId] = false;
      }
      this.handleSlotAction(info.slotIndex, info.actionId, false);
      this._releaseTouchSourceIfIdle();
      return true;
    }
    return this.handleStandardJoystickTouchEnd(touch);
  }

  resetTabletopTouches() {
    for (const info of this.tabletopSteerTouches.values()) {
      this.handleSlotSteer(info.slotIndex, 0);
    }
    this.tabletopSteerTouches.clear();
    this.tabletopSteerState = [0, 0, 0, 0];

    for (const [touchId, info] of this.tabletopActionTouches.entries()) {
      if (this.tabletopActionState[info.slotIndex]) {
        this.tabletopActionState[info.slotIndex][info.actionId] = false;
      }
      this.handleSlotAction(info.slotIndex, info.actionId, false);
    }
    this.tabletopActionTouches.clear();
    this.tabletopActionState = [{}, {}, {}, {}];
    for (const info of this.tabletopAimTouches.values()) {
      this.handleSlotAimEnd(info.slotIndex, info.vector || {}, {
        source: 'touch',
        cancelled: true,
      });
    }
    this.tabletopAimTouches.clear();
    this.tabletopAimState = [null, null, null, null];
    this.resetAimInputs();
    this.resetStandardJoysticks();
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
  }

  getEntitiesList() {
    return this.players || this.tanks || this.paddles || this.curves || this.snakes || [];
  }

  // Varlıkların belirtilen noktaya olan yakınlığını denetler (Proximity Ghosting)
  checkEntityProximity(pointX, pointY, threshold = 80, extraEntities = []) {
    const list = this.getEntitiesList();
    const all = Array.isArray(extraEntities) && extraEntities.length > 0
      ? [...list, ...extraEntities]
      : list;
    const threshSq = threshold * threshold;

    for (const e of all) {
      if (!e) continue;
      if (e.isJoined === false || e.isAlive === false) continue;
      let ex = e.x;
      let ey = e.y;
      if (typeof ex !== 'number' && typeof e.coord === 'number') {
        ex = e.fixedPerpendicular ?? e.x ?? 0;
        ey = e.coord;
        if (e.side === 'top' || e.side === 'bottom') {
          ex = e.coord;
          ey = e.fixedPerpendicular ?? e.y ?? 0;
        }
      }
      if (typeof ex !== 'number' || typeof ey !== 'number') continue;
      const dx = ex - pointX;
      const dy = ey - pointY;
      if (dx * dx + dy * dy <= threshSq) {
        return true;
      }
    }
    return false;
  }

  getTabletopControlCorners() {
    const vp = (this.viewport && this.viewport.width > 0)
      ? this.viewport
      : { width: window.innerWidth, height: window.innerHeight };
    const w = vp.width || window.innerWidth;
    const h = vp.height || window.innerHeight;
    const profile = getDisplayProfile(this.arena || { width: w, height: h });
    const padX = Math.max(16, Math.round(26 * profile.baseUnit));
    const padY = Math.max(16, Math.round(26 * profile.baseUnit));

    const schema = this.getTabletopSchema();
    const actions = schema?.actions || [];
    // Merkezi sözleşme: sağda en fazla 2 aksiyon (controlDefs.MAX_TABLETOP_ACTIONS).
    // Uyarı-only: davranış değişmez, yeni oyunlar şemayı buna göre kurar.
    if (actions.length > 2) {
      console.warn('[tabletop] sağ aksiyon sayısı 2 sınırını aşıyor');
    }

    if (schema.steer) {
      const steerBtnW = Math.max(72, Math.round(72 * profile.baseUnit));
      const steerBtnH = Math.max(46, Math.round(50 * profile.baseUnit));
      const steerGap = Math.max(6, Math.round(8 * profile.baseUnit));
      const actBtnW = Math.max(54, Math.round(56 * profile.baseUnit));
      const actGap = Math.max(8, Math.round(10 * profile.baseUnit));

      const totalSteerW = steerBtnW * 2 + steerGap;
      const totalClusterW = totalSteerW + (actions.length > 0 ? (actGap + actions.length * actBtnW + (actions.length - 1) * actGap) : 0);

      return [0, 1, 2, 3].map((cornerIndex) => {
        const isTop = cornerIndex === 1 || cornerIndex === 2;
        const isRight = cornerIndex === 2 || cornerIndex === 3;
        const rotation = isTop ? Math.PI : 0;

        const boxX = isRight ? (w - padX - totalClusterW) : padX;
        const boxY = isTop ? padY : (h - padY - steerBtnH);

        // Steer Butonları (SOL ve SAĞ)
        // Alt oyuncular (P1, P4, rotation 0): SOL buton solda, SAĞ buton sağda.
        // Üst oyuncular (P2, P3, rotation Math.PI): 180° ters yüz oturan oyuncunun sol eli
        // ekranın +X yönüne baktığından SOL butonu ekranın sağına eşlenir.
        let leftX, rightX;
        if (!isTop) {
          leftX = boxX;
          rightX = boxX + steerBtnW + steerGap;
        } else {
          leftX = boxX + totalClusterW - steerBtnW;
          rightX = boxX + totalClusterW - (steerBtnW * 2 + steerGap);
        }

        const leftBtn = {
          id: 'steer_left',
          dir: -1,
          label: schema.leftLabel || '◀',
          keyHint: STEER_KEY_HINTS[cornerIndex]?.split('/')[0] || 'A',
          x: leftX,
          y: boxY,
          w: steerBtnW,
          h: steerBtnH,
          cx: leftX + steerBtnW / 2,
          cy: boxY + steerBtnH / 2,
          rotation,
        };

        const rightBtn = {
          id: 'steer_right',
          dir: 1,
          label: schema.rightLabel || '▶',
          keyHint: STEER_KEY_HINTS[cornerIndex]?.split('/')[1] || 'D',
          x: rightX,
          y: boxY,
          w: steerBtnW,
          h: steerBtnH,
          cx: rightX + steerBtnW / 2,
          cy: boxY + steerBtnH / 2,
          rotation,
        };

        // Action Butonları (Snake Boost vb.)
        const actionButtons = [];
        for (let idx = 0; idx < actions.length; idx++) {
          const act = actions[idx];
          let bx;
          if (!isTop) {
            bx = boxX + totalSteerW + actGap + idx * (actBtnW + actGap);
          } else {
            bx = boxX + idx * (actBtnW + actGap);
          }
          actionButtons.push({
            id: act.id,
            x: bx,
            y: boxY,
            w: actBtnW,
            h: steerBtnH,
            cx: bx + actBtnW / 2,
            cy: boxY + steerBtnH / 2,
            rotation,
            schema: act,
          });
        }

        return {
          index: cornerIndex,
          rotation,
          isSteer: true,
          box: {
            x: boxX,
            y: boxY,
            w: totalClusterW,
            h: steerBtnH,
            cx: boxX + totalClusterW / 2,
            cy: boxY + steerBtnH / 2,
          },
          steerButtons: [leftBtn, rightBtn],
          actionButtons,
        };
      });
    }

    const baseR = Math.round(44 * profile.baseUnit);
    const btnW = Math.round(56 * profile.baseUnit);
    const btnH = Math.round(50 * profile.baseUnit);
    const gap = Math.round(14 * profile.baseUnit);
    const aimR = Math.round(36 * profile.baseUnit);
    const aimGap = Math.round(12 * profile.baseUnit);

    // Helper to generate action button rects for a given corner
    const makeActionButtons = (cornerIndex, joyX, joyY, rotation) => {
      const btns = [];
      for (let idx = 0; idx < actions.length; idx++) {
        const act = actions[idx];
        let bx, by;
        const actionOffset = baseR + gap + (schema.aim ? aimR * 2 + aimGap : 0);
        if (cornerIndex === 0 || cornerIndex === 1) {
          // Sol taraf oyuncuları: Butonlar joystick/aim'in SAĞINDA
          bx = joyX + actionOffset + idx * (btnW + gap);
          by = joyY - btnH / 2;
        } else {
          // Sağ taraf oyuncuları: Butonlar joystick/aim'in SOLUNDA
          bx = joyX - actionOffset - btnW - idx * (btnW + gap);
          by = joyY - btnH / 2;
        }
        btns.push({
          id: act.id,
          x: bx,
          y: by,
          w: btnW,
          h: btnH,
          cx: bx + btnW / 2,
          cy: by + btnH / 2,
          rotation,
          schema: act,
        });
      }
      return btns;
    };

    const joyP1X = padX + baseR;
    const joyP1Y = h - padY - baseR;
    const joyP2X = padX + baseR;
    const joyP2Y = padY + baseR;
    const joyP3X = w - padX - baseR;
    const joyP3Y = padY + baseR;
    const joyP4X = w - padX - baseR;
    const joyP4Y = h - padY - baseR;
    const aimBoxFor = (cornerIndex, joyX, joyY) => {
      if (!schema.aim) return null;
      const cx = cornerIndex === 0 || cornerIndex === 1
        ? joyX + baseR + aimGap + aimR
        : joyX - baseR - aimGap - aimR;
      return { x: cx - aimR, y: joyY - aimR, w: aimR * 2, h: aimR * 2, cx, cy: joyY, r: aimR };
    };
    const aimExtraW = schema.aim ? aimR * 2 + aimGap : 0;

    return [
      {
        index: 0,
        x: joyP1X,
        y: joyP1Y,
        baseR,
        rotation: 0,
        box: {
          x: joyP1X - baseR,
          y: joyP1Y - baseR,
          w: baseR * 2 + aimExtraW + (actions.length > 0 ? (gap + actions.length * (btnW + gap)) : 0),
          h: baseR * 2,
          cx: joyP1X,
          cy: joyP1Y,
        },
        actionButtons: makeActionButtons(0, joyP1X, joyP1Y, 0),
        aimBox: aimBoxFor(0, joyP1X, joyP1Y),
      },
      {
        index: 1,
        x: joyP2X,
        y: joyP2Y,
        baseR,
        rotation: Math.PI,
        box: {
          x: joyP2X - baseR,
          y: joyP2Y - baseR,
          w: baseR * 2 + aimExtraW + (actions.length > 0 ? (gap + actions.length * (btnW + gap)) : 0),
          h: baseR * 2,
          cx: joyP2X,
          cy: joyP2Y,
        },
        actionButtons: makeActionButtons(1, joyP2X, joyP2Y, Math.PI),
        aimBox: aimBoxFor(1, joyP2X, joyP2Y),
      },
      {
        index: 2,
        x: joyP3X,
        y: joyP3Y,
        baseR,
        rotation: Math.PI,
        box: {
          x: joyP3X - baseR - aimExtraW - (actions.length > 0 ? (gap + actions.length * (btnW + gap)) : 0),
          y: joyP3Y - baseR,
          w: baseR * 2 + aimExtraW + (actions.length > 0 ? (gap + actions.length * (btnW + gap)) : 0),
          h: baseR * 2,
          cx: joyP3X,
          cy: joyP3Y,
        },
        actionButtons: makeActionButtons(2, joyP3X, joyP3Y, Math.PI),
        aimBox: aimBoxFor(2, joyP3X, joyP3Y),
      },
      {
        index: 3,
        x: joyP4X,
        y: joyP4Y,
        baseR,
        rotation: 0,
        box: {
          x: joyP4X - baseR - aimExtraW - (actions.length > 0 ? (gap + actions.length * (btnW + gap)) : 0),
          y: joyP4Y - baseR,
          w: baseR * 2 + aimExtraW + (actions.length > 0 ? (gap + actions.length * (btnW + gap)) : 0),
          h: baseR * 2,
          cx: joyP4X,
          cy: joyP4Y,
        },
        actionButtons: makeActionButtons(3, joyP4X, joyP4Y, 0),
        aimBox: aimBoxFor(3, joyP4X, joyP4Y),
      },
    ];
  }

  getControlAlpha(value, active = false, near = false) {
    if (!isTouchDevice()) return value;
    if (near) return Math.min(value, 0.12);
    return Math.min(value, active ? 0.4 : 0.22);
  }

  renderControls(ctx, { players = this.getEntitiesList(), extraEntities = [] } = {}) {
    if (this.state !== 'PLAYING' && this.state !== 'ROUND_PAUSE') return;
    if (!shouldShowVirtualControls({ isHosting: !!this.suppressVirtualControls, force: !!this.forceVirtualControls })) {
      return;
    }

    const profile = getDisplayProfile(this.arena);
    const baseR = Math.round(44 * profile.baseUnit);
    const knobR = Math.round(19 * profile.baseUnit);
    const corners = this.getTabletopControlCorners();
    const schema = this.getTabletopSchema();

    for (let i = 0; i < 4; i++) {
      if (this.localControlSlot !== null && i !== this.localControlSlot) continue;
      const p = players?.[i];
      if (!p || !p.isJoined || p.isAlive === false || p.slotType !== 'human') {
        continue;
      }
      const corner = corners[i];
      const playerColor = p.color || UI_COLORS.primary || '#D84727';

      // 1. DİREKSİYON (SOL / SAĞ) BUTONLARI ÇİZİMİ
      if (schema.steer && corner.steerButtons) {
        const isNear = this.checkEntityProximity(corner.box.cx, corner.box.cy, corner.box.w * 0.7, extraEntities);

        // A. OYUNCU İSİM VE KLAVYE ÇİPİ (Üst Bilgi Rozeti)
        const chipText = `${p.name || resolveSlotName(i)} [${STEER_KEY_HINTS[i]}]`;
        ctx.save();
        ctx.font = '900 11px "JetBrains Mono", monospace';
        const textMetrics = ctx.measureText(chipText);
        const chipW = Math.max(80, textMetrics.width + 20);
        const chipH = 18;
        const isTop = corner.rotation !== 0;
        const chipCx = corner.box.cx;
        const chipCy = isTop ? (corner.box.y + corner.box.h + chipH / 2 + 5) : (corner.box.y - chipH / 2 - 5);

        ctx.translate(chipCx, chipCy);
        if (corner.rotation) ctx.rotate(corner.rotation);
        ctx.globalAlpha = this.getControlAlpha(isNear ? 0.20 : 0.85, false, isNear);

        // Çip gölgesi ve gövdesi
        ctx.fillStyle = '#141416';
        ctx.fillRect(-chipW / 2 + 2, -chipH / 2 + 2, chipW, chipH);
        ctx.fillStyle = '#FAF7F2';
        ctx.fillRect(-chipW / 2, -chipH / 2, chipW, chipH);
        ctx.strokeStyle = '#1A1A1A';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-chipW / 2, -chipH / 2, chipW, chipH);

        // Slot renk noktası
        ctx.fillStyle = playerColor;
        ctx.beginPath();
        ctx.arc(-chipW / 2 + 8, 0, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#1A1A1A';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Çip metni
        ctx.fillStyle = '#1A1A1A';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(chipText, -chipW / 2 + 15, 0.5);
        ctx.restore();

        // B. DİREKSİYON BUTONLARI (SOL & SAĞ)
        for (const sBtn of corner.steerButtons) {
          const isPressed = this.tabletopSteerState[i] === sBtn.dir;
          const kb = keyboardVectorFrom(this.keys, i);
          const kbActive = (sBtn.dir < 0 && kb.x < 0) || (sBtn.dir > 0 && kb.x > 0);
          const active = isPressed || kbActive;

          ctx.save();
          ctx.globalAlpha = this.getControlAlpha(isNear ? 0.20 : (active ? 0.98 : 0.75), active, isNear);
          ctx.translate(sBtn.cx, sBtn.cy);
          if (sBtn.rotation) ctx.rotate(sBtn.rotation);

          const halfW = sBtn.w / 2;
          const halfH = sBtn.h / 2;
          const shadow = active ? 1 : 3;
          const offset = active ? 2 : 0;

          // Sert Brutalist Gölge
          ctx.fillStyle = '#141416';
          ctx.fillRect(-halfW + shadow, -halfH + shadow, sBtn.w, sBtn.h);

          // Buton Gövdesi
          ctx.fillStyle = active ? `${playerColor}33` : '#FAF7F2';
          ctx.fillRect(-halfW + offset, -halfH + offset, sBtn.w, sBtn.h);

          // Kenarlık
          ctx.strokeStyle = active ? playerColor : '#1A1A1A';
          ctx.lineWidth = active ? 2.5 : 2;
          ctx.strokeRect(-halfW + offset, -halfH + offset, sBtn.w, sBtn.h);

          // Vektör Direksiyon İkonu (◀ / ▶)
          const steerIconColor = active ? playerColor : '#1A1A1A';
          drawTabletopIcon(ctx, sBtn.label || sBtn.id, offset, offset + 1, 24, {
            color: steerIconColor,
            accentColor: playerColor,
          });

          // Klavye İpucu Rozeti ([A], [D] vb.)
          if (sBtn.keyHint) {
            ctx.fillStyle = 'rgba(20, 20, 22, 0.85)';
            const badgeW = Math.max(16, sBtn.keyHint.length * 6 + 6);
            ctx.fillRect(-halfW + offset + 2, -halfH + offset + 2, badgeW, 10);
            ctx.font = '900 7.5px monospace';
            ctx.fillStyle = '#FFFFFF';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(sBtn.keyHint, -halfW + offset + 2 + badgeW / 2, -halfH + offset + 7);
          }

          ctx.restore();
        }
      } else if (schema.joystick !== false) {
        // 2. STANDART JOYSTICK ÇİZİMİ
        const joy = this.joysticks[i];
        if (joy.active) {
          const isNear = this.checkEntityProximity(joy.currX, joy.currY, baseR * 2.2, extraEntities) ||
                         this.checkEntityProximity(joy.originX, joy.originY, baseR * 2.2, extraEntities);

          ctx.save();
          ctx.globalAlpha = this.getControlAlpha(isNear ? 0.20 : 0.95, true, isNear);

          // Dış kontrast halka
          ctx.strokeStyle = UI_COLORS.outlineContrast || 'rgba(250, 247, 242, 0.9)';
          ctx.lineWidth = Math.max(3, Math.round(4.5 * profile.baseUnit));
          ctx.beginPath();
          ctx.arc(joy.originX, joy.originY, baseR, 0, Math.PI * 2);
          ctx.stroke();

          ctx.strokeStyle = UI_COLORS.ink || '#1A1A1A';
          ctx.lineWidth = Math.max(2, Math.round(2.5 * profile.baseUnit));
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(joy.originX, joy.originY, baseR, 0, Math.PI * 2);
          ctx.stroke();

          // Topuz (Knob)
          ctx.setLineDash([]);
          ctx.fillStyle = playerColor;
          ctx.beginPath();
          ctx.arc(joy.currX, joy.currY, knobR, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = UI_COLORS.ink || '#1A1A1A';
          ctx.lineWidth = Math.max(2, Math.round(2.5 * profile.baseUnit));
          ctx.stroke();
          ctx.restore();
        } else {
          // Dinlenme pedi (Masa-ortası ekran köşesi rehberi)
          const isNear = this.checkEntityProximity(corner.x, corner.y, baseR * 2.2, extraEntities);

          ctx.save();
          ctx.translate(corner.x, corner.y);
          if (corner.rotation) ctx.rotate(corner.rotation);
          ctx.globalAlpha = this.getControlAlpha(isNear ? 0.15 : 0.40, false, isNear);

          ctx.strokeStyle = playerColor;
          ctx.lineWidth = Math.max(2, Math.round(2.5 * profile.baseUnit));
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(0, 0, baseR, 0, Math.PI * 2);
          ctx.stroke();

          ctx.fillStyle = playerColor;
          ctx.font = '900 13px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`P${i + 1}`, 0, 0);
          ctx.restore();
        }
      }

      if (schema.aim && corner.aimBox) {
        const aim = this.getAimVector(i);
        const aimR = corner.aimBox.r || corner.aimBox.w / 2;
        const isAimNear = this.checkEntityProximity(corner.aimBox.cx, corner.aimBox.cy, aimR * 2.2, extraEntities);
        ctx.save();
        ctx.globalAlpha = this.getControlAlpha(isAimNear ? 0.15 : (aim.force > 0.05 ? 0.95 : 0.42), aim.force > 0.05, isAimNear);
        ctx.strokeStyle = playerColor;
        ctx.lineWidth = Math.max(2, Math.round(2.5 * profile.baseUnit));
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(corner.aimBox.cx, corner.aimBox.cy, aimR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        const knobDistance = aimR * 0.58 * aim.force;
        ctx.fillStyle = playerColor;
        ctx.beginPath();
        ctx.arc(
          corner.aimBox.cx + Math.cos(aim.angle || 0) * knobDistance,
          corner.aimBox.cy + Math.sin(aim.angle || 0) * knobDistance,
          Math.max(8, knobR * 0.72),
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.strokeStyle = UI_COLORS.ink || '#1A1A1A';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }

      // 2. STANDART AKSİYON BUTONLARI ÇİZİMİ
      if (corner.actionButtons && corner.actionButtons.length > 0) {
        for (const btn of corner.actionButtons) {
          const act = btn.schema;
          const isPressed = !!this.tabletopActionState[i]?.[btn.id];
          const isNear = this.checkEntityProximity(btn.cx, btn.cy, btn.w * 1.2, extraEntities);

          // Cooldown kontrolü (maxCooldown statik, cooldownMaxField varlık başına okunur)
          let cooldown = 0;
          let maxCooldown = act.maxCooldown || 1.0;
          let isReady = true;
          if (act.cooldownField && typeof p[act.cooldownField] === 'number') {
            cooldown = Math.max(0, p[act.cooldownField]);
            const perEntityMax = act.cooldownMaxField ? p[act.cooldownMaxField] : undefined;
            if (typeof perEntityMax === 'number' && perEntityMax > 0) {
              maxCooldown = perEntityMax;
            }
            isReady = cooldown <= 0;
          }
          // Hazırlık koşulu ayrı alandan okunabilir (ör. tanks şarjör sayacı:
          // dolum sürerken bile fişek varsa buton hazırdır)
          if (act.readyField && typeof p[act.readyField] === 'number') {
            isReady = p[act.readyField] > 0;
          }

          // Charge (yay gerilme vb.) kontrolü
          let chargeRatio = 0;
          if (act.holdToCharge) {
            const cVal = p[act.chargeField || 'charge'];
            const mVal = p[act.maxChargeField || 'maxCharge'] || 1.0;
            if (typeof cVal === 'number') {
              chargeRatio = Math.max(0, Math.min(1, cVal / mVal));
            } else if (p.charging || p.isAiming) {
              chargeRatio = 0.5;
            }
          }

          // Cooldown hazır olma (Ready pulse) takibi
          this._cooldownTracker = this._cooldownTracker || {};
          this._readyPulseTracker = this._readyPulseTracker || {};
          const pulseKey = `${i}_${btn.id}`;
          const prevCooldown = this._cooldownTracker[pulseKey] ?? 0;
          if (prevCooldown > 0 && cooldown <= 0 && isReady) {
            this._readyPulseTracker[pulseKey] = performance.now();
          }
          this._cooldownTracker[pulseKey] = cooldown;

          ctx.save();
          ctx.globalAlpha = this.getControlAlpha(isNear ? 0.20 : (isPressed ? 0.95 : 0.70), isPressed, isNear);
          ctx.translate(btn.cx, btn.cy);
          if (btn.rotation) ctx.rotate(btn.rotation);

          const halfW = btn.w / 2;
          const halfH = btn.h / 2;
          const shadow = isPressed ? 1 : 3;
          const offset = isPressed ? 2 : 0;

          // Sert Brutalist Gölge
          ctx.fillStyle = '#141416';
          ctx.fillRect(-halfW + shadow, -halfH + shadow, btn.w, btn.h);

          // Buton Gövdesi
          ctx.fillStyle = isReady ? (isPressed ? '#E0DFDC' : '#FAF7F2') : '#2A2A2E';
          ctx.fillRect(-halfW + offset, -halfH + offset, btn.w, btn.h);

          // Cooldown Dolum Maskesi (Aşağıdan yukarıya kararır)
          if (!isReady && maxCooldown > 0) {
            const frac = Math.max(0, Math.min(1, cooldown / maxCooldown));
            ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
            ctx.fillRect(-halfW + offset, halfH + offset - btn.h * frac, btn.w, btn.h * frac);
          }

          // Charge Barı (Sarı altın yay gerilme dolumu)
          if (chargeRatio > 0) {
            ctx.fillStyle = 'rgba(255, 222, 89, 0.55)';
            ctx.fillRect(-halfW + offset, halfH + offset - btn.h * chargeRatio, btn.w, btn.h * chargeRatio);
          }

          // Kenarlık
          ctx.strokeStyle = isReady ? playerColor : '#555555';
          ctx.lineWidth = isReady ? 2.5 : 1.5;
          ctx.strokeRect(-halfW + offset, -halfH + offset, btn.w, btn.h);

          // Yetenek Doldu "Ready!" Vurgusu (Tactile shockwave ring)
          const pulseStart = this._readyPulseTracker[pulseKey] || 0;
          const pulseAge = performance.now() - pulseStart;
          if (pulseAge < 400) {
            const pNorm = pulseAge / 400;
            const expand = Math.round(pNorm * 9);
            ctx.save();
            ctx.strokeStyle = playerColor;
            ctx.lineWidth = Math.max(1.5, 3.5 * (1 - pNorm));
            ctx.globalAlpha = (1 - pNorm) * 0.9;
            ctx.strokeRect(-halfW + offset - expand, -halfH + offset - expand, btn.w + expand * 2, btn.h + expand * 2);
            ctx.restore();
          }

          // Vektör Arcade İkon Çizimi (Brutalist net geometri, dinamik renk)
          const iconColor = isReady ? (isPressed ? playerColor : '#141416') : 'rgba(250, 247, 242, 0.40)';
          const iconY = cooldown > 0 ? (offset - 4) : (offset + 1);
          const iconKey = act.id === 'action' ? (act.icon || act.id) : (act.id || act.icon);
          drawTabletopIcon(ctx, iconKey, offset, iconY, 24, {
            color: iconColor,
            isReady,
            accentColor: playerColor,
          });

          if (!isReady && cooldown > 0) {
            ctx.font = '900 11px "JetBrains Mono", monospace';
            ctx.fillStyle = '#F59E0B';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${cooldown.toFixed(1)}s`, offset, halfH + offset - 8);
          }

          // Klavye İpucu Rozeti (slot başına doğru tuş; statik keyHint önceliklidir)
          const keyHintKind = act.id === 'smoke' ? 'smoke' : act.id === 'dash' ? 'dash' : 'action';
          const keyHint = act.keyHint || getKeyLabel(keyHintKind, i);
          if (keyHint) {
            ctx.fillStyle = 'rgba(20, 20, 22, 0.85)';
            const badgeW = Math.max(22, keyHint.length * 6 + 6);
            ctx.fillRect(-halfW + offset + 2, -halfH + offset + 2, badgeW, 10);
            ctx.font = '900 7.5px monospace';
            ctx.fillStyle = '#FFFFFF';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(keyHint, -halfW + offset + 2 + badgeW / 2, -halfH + offset + 7);
          }

          ctx.restore();
        }
      }
    }
  }

  renderStandardJoysticks(ctx, players = this.players) {
    this.renderControls(ctx, { players });
  }

  // Resolves combined input intent from both virtual touch joystick and local keyboard
  getPlayerMovementVector(slotIndex) {
    const p = this.players?.[slotIndex];
    if (!p || !p.isJoined || !p.isAlive) return { x: 0, y: 0, active: false };

    let inputX = 0;
    let inputY = 0;
    let active = false;

    if (p.slotType === 'human') {
      const joy = this.joysticks?.[slotIndex];
      if (joy && joy.active && joy.force > 0.05) {
        inputX = Math.cos(joy.angle) * joy.force;
        inputY = Math.sin(joy.angle) * joy.force;
        active = true;
      }

      const kb = this.getPlayerKeyboardVector(slotIndex);
      if (kb.x !== 0 || kb.y !== 0) {
        inputX += kb.x;
        inputY += kb.y;
        active = true;
      }
    }

    const mag = Math.hypot(inputX, inputY);
    if (mag > 1) {
      inputX /= mag;
      inputY /= mag;
    }

    return { x: inputX, y: inputY, active, magnitude: Math.min(1, mag) };
  }

  // ---------------------------------------------------------------------------
  // Remote Input Handling
  // ---------------------------------------------------------------------------

  handleStandardRemoteJoystick(slotIndex, data, onAction = null) {
    const joy = this.joysticks?.[slotIndex];
    if (!joy) return;
    const player = this.players?.[slotIndex];

    if (isInputIntent(data, 'move') || data.action === 'JOYSTICK_MOVE') {
      if (player && (!player.isJoined || !player.isAlive)) return;
      const force = Number.isFinite(data.force) ? Math.max(0, Math.min(1, data.force)) : 0;
      joy.active = force > 0.05;
      joy.angle = Number.isFinite(data.angle) ? data.angle : 0;
      joy.force = force;
    } else if (typeof onAction === 'function') {
      onAction(slotIndex, data);
    }
  }

  // ---------------------------------------------------------------------------
  // Dual-Input Bridge (Faz 2): uzak + lokal girdi tek applySlotInput'ta birleşir.
  // input = { vector: {x, y} } (sürekli) | { action: 'ID', isDown } (discrete)
  //         | { steer: -1|0|1 } (direksiyon) | motora özel alanlar (position…).
  // Sürekli hareket poll ile okunur (getPlayerMovementVector / motor içi);
  // bu köprü discrete aksiyonları ve harici vektör enjeksiyonunu tekleştirir.
  // ---------------------------------------------------------------------------

  applySlotInput(slotIndex, input = {}) {
    if (!input) return;
    if (input.vector) {
      const joy = this.joysticks?.[slotIndex];
      if (joy) {
        const vx = Number(input.vector.x) || 0;
        const vy = Number(input.vector.y) || 0;
        const mag = Math.hypot(vx, vy);
        joy.active = mag > 0.05;
        joy.angle = Math.atan2(vy, vx);
        joy.force = Math.max(0, Math.min(1, mag));
      }
    }
    const aimSource = input.intent?.source || 'local';
    if (matchesInputAction(input, 'aim', 'AIM_PRESS', 'press')) {
      this.handleSlotAimStart(slotIndex, input.aim || input, { source: aimSource });
    } else if (matchesInputAction(input, 'aim', 'AIM_RELEASE', 'release')) {
      this.handleSlotAimEnd(slotIndex, input.aim || input, {
        source: aimSource,
        cancelled: input.cancelled === true,
      });
    }
    if (input.aim || input.action === 'AIM_MOVE') {
      this.handleSlotAim(slotIndex, input.aim || input, { source: aimSource });
    }
    if (typeof input.steer === 'number') {
      this.handleSlotSteer(slotIndex, input.steer);
    }
    if (typeof input.action === 'string') {
      this.handleSlotAction(slotIndex, input.action, input.isDown !== false);
    }
  }

  // Lokal klavye/dokunmatik discrete girdileri için giriş noktası.
  handleLocalInput(slotIndex, data = {}) {
    if (!this.claimInputSource('touch')) return;
    this.applySlotInput(slotIndex, data);
  }

  // Varsayılan uzak girdi: JOYSTICK_MOVE vektöre, discrete aksiyonlar
  // applySlotInput'a düşer. 15 motorun tamamı bunu override eder.
  handleRemoteInput(slotIndex, data = {}) {
    if (!data || typeof data.action !== 'string') return;
    if (this.applyAimLifecycleInput(slotIndex, data)) return;
    if (isInputIntent(data, 'aim') || data.action === 'AIM_MOVE') {
      this.handleSlotAim(slotIndex, data, { source: data.intent?.source || 'network' });
      return;
    }
    if (isInputIntent(data, 'move') || data.action === 'JOYSTICK_MOVE') {
      const force = Number.isFinite(data.force) ? Math.max(0, Math.min(1, data.force)) : 0;
      const angle = Number.isFinite(data.angle) ? data.angle : 0;
      this.applySlotInput(slotIndex, {
        vector: { x: Math.cos(angle) * force, y: Math.sin(angle) * force },
      });
      return;
    }
    this.applySlotInput(slotIndex, { action: data.action, isDown: true });
  }

  // ---------------------------------------------------------------------------
  // Interactive UI & Canvas Lobby Rendering
  // ---------------------------------------------------------------------------

  handleUiTap(pos) {
    for (const btn of this.uiButtons) {
      if (
        pos.x >= btn.x &&
        pos.x <= btn.x + btn.w &&
        pos.y >= btn.y &&
        pos.y <= btn.y + btn.h
      ) {
        btn.onClick?.();
        return true;
      }
    }
    return false;
  }

  renderStandardScoreboard(ctx, { targetScore = this.targetScore || 3, entities = null } = {}) {
    const playersList = this.getEntitiesList();
    const activeEntities = entities || playersList.filter((p) => p && p.isJoined && (p.isAlive !== false));
    renderAdaptiveScoreboard(ctx, {
      arena: this.arena,
      players: playersList,
      scores: this.scores || this.setScores || [0, 0, 0, 0],
      targetScore,
      entities: activeEntities,
      isHosting: !!this.hideLobbyStartButton,
      state: this.state,
      uiButtons: this.uiButtons,
    });
  }

  renderStandardRoundBanner(ctx, { title = null, titleColor = null, sub = '' } = {}) {
    const cleanWinner = this.roundWinner ? cleanWinnerName(this.roundWinner.name || '') : '';
    const defTitle = cleanWinner ? `${cleanWinner} KAZANDI!` : (t('game.draw') || 'BERABERE!');
    const defColor = this.roundWinner?.color || UI_COLORS.ink || '#1A1A1A';
    renderRoundBanner(ctx, {
      arena: this.arena,
      title: title || defTitle,
      titleColor: titleColor || defColor,
      sub,
    });
  }

  renderStandardMatchOver(ctx, { headline = null, rows = null, onRestart = () => this.startNewMatch() } = {}) {
    const playersList = this.getEntitiesList();
    const cleanWinner = this.matchWinner ? cleanWinnerName(this.matchWinner.name || '') : '';
    const defRows = rows || playersList
      .filter((p) => p && p.isJoined)
      .map((p) => ({
        color: p.color || UI_COLORS.ink,
        text: `${p.name}: ${this.scores?.[p.index] ?? this.setScores?.[p.index] ?? 0}★`,
      }));

    renderMatchOver(ctx, {
      arena: this.arena,
      uiButtons: this.uiButtons,
      headline: headline || t('canvas.champ') || 'ŞAMPİYON',
      winnerName: cleanWinner,
      winnerColor: this.matchWinner?.color || UI_COLORS.ink || '#1A1A1A',
      rows: defRows,
      onRestart,
    });
  }

  renderStandardLobby(ctx, {
    arena = this.arena,
    dockRect = null,
    colors = [],
    playerNames = [],
    onStart = () => this.startNewMatch(),
    accent = '#D84727',
    customControls = null,
    rotateTop = false,
    onSeatChange = null,
  } = {}) {
    const bounds = dockRect || ((this.viewport && this.viewport.width > 0) ? this.viewport : arena);
    const corners = getStandardSeatRects(arena, undefined, bounds);
    const localMode = !this.hideLobbyStartButton;
    const localColors = localMode ? getLocalSeatColors() : null;

    for (let i = 0; i < 4; i++) {
      const pos = corners[i];
      const slotType = this.slotTypes[i];
      const p = this.players?.[i] || this.tanks?.[i] || this.paddles?.[i] || this.curves?.[i] || this.snakes?.[i];
      const name = p ? (p.name || '') : (playerNames[i] || '');
      const color = colors[i] || '#D84727';
      const isTop = i === 1 || i === 2;

      renderLobbySeatCard(ctx, {
        x: pos.x,
        y: pos.y,
        w: pos.w,
        h: pos.h,
        slotIndex: i,
        slotType: slotType,
        playerName: name,
        playerColor: color,
        rotation: rotateTop && isTop ? Math.PI : 0,
        seatColor: localMode ? (localColors[i] || color) : null,
        showColorDot: localMode,
      });

      // Nokta önce: tap dispatch ilk eşleşmede durur, nokta kartın içindedir.
      if (localMode) {
        const dot = getSeatColorDotRect(pos);
        this.uiButtons.push({
          x: dot.x,
          y: dot.y,
          w: dot.w,
          h: dot.h,
          onClick: () => this.cycleLocalSeat(i),
        });
      }

      this.uiButtons.push({
        x: pos.x,
        y: pos.y,
        w: pos.w,
        h: pos.h,
        onClick: () => {
          this.cycleSlotType(i);
          if (typeof onSeatChange === 'function') onSeatChange(i);
        },
      });
    }

    if (typeof customControls === 'function') {
      customControls(ctx);
    }

    const joinedCount = this.getActivePlayerCount();
    renderLobbyStartButton(ctx, {
      arena,
      uiButtons: this.uiButtons,
      joinedCount,
      accent,
      minJoined: this.minPlayersToStart || 2,
      onStart,
      centerYOffset: customControls ? 18 : 0,
      hidden: !!this.hideLobbyStartButton,
    });
  }

  renderHUD(ctx, options = {}) {
    this.uiButtons = [];

    const {
      guideTitle = '',
      guideEntries = null,
      colors = this.playerColors || [],
      playerNames = [],
      accent = '#D84727',
      onStart = () => this.startNewMatch(),
      rotateTop = true,
      onSeatChange = null,
      customControls = null,
      customHud = null,
      showScoreboard = true,
      targetScore = this.targetScore || 3,
      scoreboardEntities = null,
      roundBannerTitle = null,
      roundBannerColor = null,
      roundBannerSub = '',
      matchOverHeadline = null,
      matchOverRows = null,
      onRestart = () => this.startNewMatch(),
      dockToViewport = true,
    } = options;

    const bounds = (dockToViewport && this.viewport && this.viewport.width > 0) ? this.viewport : this.arena;

    if (this.state === 'LOBBY') {
      if (guideTitle && guideEntries) {
        renderControlGuide(ctx, this.arena, guideTitle, guideEntries);
      }
      if (typeof options.customLobby === 'function') {
        options.customLobby(ctx);
      } else {
        this.renderStandardLobby(ctx, {
          arena: this.arena,
          dockRect: bounds,
          colors,
          playerNames,
          accent,
          onStart,
          rotateTop,
          onSeatChange,
          customControls,
        });
      }
    } else if (this.state === 'ROUND_OVER') {
      if (showScoreboard) {
        this.renderStandardScoreboard(ctx, { targetScore, entities: scoreboardEntities });
      }
      this.renderStandardRoundBanner(ctx, {
        title: roundBannerTitle,
        titleColor: roundBannerColor,
        sub: roundBannerSub,
      });
    } else if (this.state === 'MATCH_OVER') {
      if (showScoreboard) {
        this.renderStandardScoreboard(ctx, { targetScore, entities: scoreboardEntities });
      }
      this.renderStandardMatchOver(ctx, {
        headline: matchOverHeadline,
        rows: matchOverRows,
        onRestart,
      });
    } else if (this.state === 'PLAYING' || this.state === 'ROUND_PAUSE') {
      if (showScoreboard) {
        this.renderStandardScoreboard(ctx, { targetScore, entities: scoreboardEntities });
      }
    }

    if (typeof customHud === 'function') {
      customHud(ctx);
    }
  }
}
