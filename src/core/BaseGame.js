// BaseMiniGame: Unified Base Class for All Mini-Game Engines
// Provides common state management, fixed timing, screen trauma/shake, slot helpers & UI tap handling

import { prefersReducedMotion, motionScale } from '../ui/motion.js';

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

    // Interactive UI Rectangles
    this.uiButtons = [];

    // Host modunda main tarafından atanır: LOBBY koltuk tap'leri motora
    // yazmadan önce host'a sorulur (bot ekleme/çıkarma). Lokal oyunda null
    // kalır ve klasik cycleSlotType davranışı çalışır.
    this.onLobbySeatTap = null;

    // Klavye çapraz-konuşma kilidi: main.setGameMode yalnızca aktif motoru
    // açar (E27). Pasif motorda kalan PLAYING + Space gibi ortak tuşlar
    // yanlış oyunda dash/ateş/tap üretmesin diye keydown guard'ları buna bakar.
    this.isLocalInputActive = false;
  }

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
    if (this.slotTypes[index] === 'empty') {
      this.slotTypes[index] = 'human';
    } else if (this.slotTypes[index] === 'human') {
      this.slotTypes[index] = 'bot_normal';
    } else if (this.slotTypes[index] === 'bot_normal') {
      this.slotTypes[index] = 'bot_god';
    } else {
      this.slotTypes[index] = 'empty';
    }
  }

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
}
