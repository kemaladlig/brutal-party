// BaseMiniGame: Unified Base Class for All Mini-Game Engines
// Provides common state management, fixed timing, screen trauma/shake, slot helpers,
// standardized 4-player local keyboard listeners, multi-touch virtual joysticks & lobby rendering.

import { prefersReducedMotion, motionScale } from '../ui/motion.js';
import { getStandardSeatRects, renderLobbySeatCard, renderLobbyStartButton, getSeatColorDotRect } from '../controlGuide.js';
import { getLocalSeatColors, ensureLocalSeatColor, cycleLocalSeatColor, getBotPersona } from './customizationManager.js';
import { resolveSlotName } from './slotManager.js';
import { isSlotActionEvent, keyboardVectorFrom } from './inputMaps.js';
import { getQuadrant, roundOverSkipGuard } from './touchFlow.js';
import { UI_COLORS, getDisplayProfile, shouldShowVirtualControls } from '../ui/tokens.js';

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

    // Klavye çapraz-konuşma kilidi: main.setGameMode yalnızca aktif motoru
    // açar (E27). Pasif motorda kalan PLAYING + Space gibi ortak tuşlar
    // yanlış oyunda dash/ateş/tap üretmesin diye keydown guard'ları buna bakar.
    this.isLocalInputActive = false;

    // Shared Local Keyboard Input State
    this.keys = {};
    this._keyboardBound = false;

    // 4 Corner Floating Virtual Joysticks (P1: BL, P2: TL, P3: TR, P4: BR)
    this.joysticks = [
      { id: -1, originX: 0, originY: 0, currX: 0, currY: 0, active: false, angle: 0, force: 0 },
      { id: -1, originX: 0, originY: 0, currX: 0, currY: 0, active: false, angle: 0, force: 0 },
      { id: -1, originX: 0, originY: 0, currX: 0, currY: 0, active: false, angle: 0, force: 0 },
      { id: -1, originX: 0, originY: 0, currX: 0, currY: 0, active: false, angle: 0, force: 0 },
    ];
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
    const newName = resolveSlotName(index, this.slotTypes[index]);
    const ent = this.players?.[index] || this.tanks?.[index] || this.paddles?.[index];
    if (ent) {
      ent.name = newName;
      ent.slotType = this.slotTypes[index];
      ent.isJoined = this.slotTypes[index] !== 'empty';
      if (newColor) ent.color = newColor;
    }
    // LOCAL: yeni insan koltuğuna boş renk ata (hook dönmediyse lokaldir)
    if (this.slotTypes[index] === 'human' && !this.hideLobbyStartButton) {
      this.applyLocalSeatColor(index, ensureLocalSeatColor(index));
    } else if (newColor) {
      this.applyLocalSeatColor(index, newColor);
    }
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

  bindStandardKeyboard(onPlayerAction = null) {
    if (this._keyboardBound) return;
    this._keyboardBound = true;

    window.addEventListener('keydown', (e) => {
      if (!this.isLocalInputActive) return;

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
    if (!this.isLocalInputActive) return { x: 0, y: 0 };
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
  }

  onTouchMove(touch) {
    if (this.state !== 'PLAYING') return;
    this.handleStandardJoystickTouchMove(touch);
  }

  onTouchEnd(touch) {
    this.handleStandardJoystickTouchEnd(touch);
  }

  onTouchesReset() {
    this.resetStandardJoysticks();
  }

  renderStandardJoysticks(ctx, players = this.players) {
    if (this.state !== 'PLAYING') return;
    if (!shouldShowVirtualControls({ isHosting: !!this.hideLobbyStartButton })) {
      return;
    }

    const profile = getDisplayProfile(this.arena);
    const baseR = Math.round(44 * profile.baseUnit);
    const knobR = Math.round(19 * profile.baseUnit);

    for (let i = 0; i < 4; i++) {
      const joy = this.joysticks[i];
      const player = players?.[i];
      if (!joy.active || !player || !player.isJoined || !player.isAlive || player.slotType !== 'human') {
        continue;
      }

      ctx.save();
      // Yüksek kontrastlı dış halka (açık kontur + koyu kesikli çizgi)
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
      ctx.fillStyle = player.color || '#D84727';
      ctx.beginPath();
      ctx.arc(joy.currX, joy.currY, knobR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = UI_COLORS.ink || '#1A1A1A';
      ctx.lineWidth = Math.max(2, Math.round(2.5 * profile.baseUnit));
      ctx.stroke();
      ctx.restore();
    }
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

    if (data.action === 'JOYSTICK_MOVE') {
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

  renderStandardLobby(ctx, {
    arena = this.arena,
    colors = [],
    playerNames = [],
    onStart = () => this.startNewMatch(),
    accent = '#D84727',
    customControls = null,
    rotateTop = false,
    onSeatChange = null,
  } = {}) {
    const corners = getStandardSeatRects(arena);
    const localMode = !this.hideLobbyStartButton;
    const localColors = localMode ? getLocalSeatColors() : null;

    for (let i = 0; i < 4; i++) {
      const pos = corners[i];
      const slotType = this.slotTypes[i];
      const p = this.players?.[i];
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
      onStart,
      centerYOffset: customControls ? 18 : 0,
      hidden: !!this.hideLobbyStartButton,
    });
  }
}
