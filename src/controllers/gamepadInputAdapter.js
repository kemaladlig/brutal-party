// Transport-neutral gamepad analog adapter. It owns only the analog throttle,
// dead-zone filtering and neutral bookkeeping required by the control budget.

// Analog akış throttle'ı (kumanda → host). AGENTS §6 bütçesi 50 ms'ti; host
// zaten 33 ms'te ikinci kez kısıyordu, yani 50 ms tek bağlayıcı kısıttı ve
// yönü ~2-3 karede bir güncelliyordu. 40 ms (25 Hz) sunucu kapısının üstünde
// kalır (paket düşmez) ve gerçek girdi gecikmesini ~10 ms kısar.
export const ANALOG_THROTTLE_MS = 40;

export class GamepadInputAdapter {
  /**
   * @param {(data: any) => void} send
   * @param {{ now?: () => number, throttleMs?: number, schedule?: ((fn: () => void, ms: number) => any) | null, cancel?: ((id: any) => void) | null }} [opts]
   *   `throttleMs` uzak kumanda bütçesidir (AGENTS §6). LOCAL tek cihazda ağ
   *   yoktur; 0 verilerek analog akış anında motora bırakılır (yön ~25 Hz'e
   *   kısılıp "girdi geç geliyor" hissi yaratmasın).
   */
  constructor(send, { now = () => performance.now(), throttleMs = ANALOG_THROTTLE_MS, schedule = null, cancel = null } = {}) {
    this.send = send;
    this.now = now;
    this.throttleMs = throttleMs;
    this.schedule = typeof schedule === 'function' ? schedule : null;
    this.cancel = typeof cancel === 'function' ? cancel : null;
    this.pendingByAction = {};
    this.timersByAction = {};
    this.reset();
  }

  _cancelPending(action) {
    const timer = this.timersByAction?.[action];
    if (timer !== undefined && timer !== null) {
      try { this.cancel?.(timer); } catch {}
    }
    if (this.timersByAction) delete this.timersByAction[action];
    if (this.pendingByAction) delete this.pendingByAction[action];
  }

  reset() {
    if (this.timersByAction) {
      for (const action of Object.keys(this.timersByAction)) {
        this._cancelPending(action);
      }
    }
    this.pendingByAction = {};
    this.timersByAction = {};
    this.lastSentByAction = {};
    this.lastPaddlePos = null;
    this.lastJoySent = { dx: 0, dy: 0 };
    this.lastAimSent = { dx: 0, dy: 0 };
  }

  resetAction(action) {
    this._cancelPending(action);
    delete this.lastSentByAction[action];
    if (action === 'AIM_MOVE') this.lastAimSent = { dx: 0, dy: 0 };
    if (action === 'JOYSTICK_MOVE') this.lastJoySent = { dx: 0, dy: 0 };
    if (action === 'PADDLE_MOVE') this.lastPaddlePos = null;
  }

  flushAction(action) {
    if (this.timersByAction) delete this.timersByAction[action];
    const pending = this.pendingByAction?.[action];
    if (!pending) return false;
    delete this.pendingByAction[action];
    return this.sendAnalog(pending);
  }

  flushPending() {
    let flushed = false;
    for (const action of Object.keys(this.pendingByAction || {})) {
      if (this.flushAction(action)) flushed = true;
    }
    return flushed;
  }

  sendAnalog(data, { keepalive = false } = {}) {
    if (!data || typeof data.action !== 'string') return false;
    const timestamp = this.now();
    const isZero = (data.action === 'JOYSTICK_MOVE' || data.action === 'AIM_MOVE')
      ? data.force === 0
      : false;

    if (!isZero) {
      // Twin-stick: sol ve sağ analog ayrı bütçe kullanır, yoksa yürürken
      // nişan paketleri birbirini düşürür.
      if (!keepalive) {
        const lastSent = this.lastSentByAction[data.action] || 0;
        const elapsed = timestamp - lastSent;
        if (elapsed < this.throttleMs) {
          this.pendingByAction[data.action] = data;
          if (this.schedule && this.timersByAction[data.action] === undefined) {
            const waitMs = Math.max(1, Math.ceil(this.throttleMs - elapsed));
            this.timersByAction[data.action] = this.schedule(() => this.flushAction(data.action), waitMs);
          }
          return false;
        }
      }
      if (data.action === 'PADDLE_MOVE' && typeof data.position === 'number') {
        if (!keepalive && this.lastPaddlePos !== null && Math.abs(data.position - this.lastPaddlePos) < 0.003) {
          this._cancelPending(data.action);
          return false;
        }
        this.lastPaddlePos = data.position;
      } else if (data.action === 'JOYSTICK_MOVE') {
        const dx = data.dx || 0;
        const dy = data.dy || 0;
        if (!keepalive && Math.hypot(dx - this.lastJoySent.dx, dy - this.lastJoySent.dy) < 0.02) {
          this._cancelPending(data.action);
          return false;
        }
        this.lastJoySent = { dx, dy };
      } else if (data.action === 'AIM_MOVE') {
        const dx = data.dx || 0;
        const dy = data.dy || 0;
        if (!keepalive && data.aimHeld !== true && Math.hypot(dx - this.lastAimSent.dx, dy - this.lastAimSent.dy) < 0.005) {
          this._cancelPending(data.action);
          return false;
        }
        this.lastAimSent = { dx, dy };
      }
    } else if (data.action === 'JOYSTICK_MOVE') {
      this.lastJoySent = { dx: 0, dy: 0 };
    } else if (data.action === 'AIM_MOVE') {
      this.lastAimSent = { dx: 0, dy: 0 };
    }

    this._cancelPending(data.action);
    if (isZero) delete this.lastSentByAction[data.action];
    else this.lastSentByAction[data.action] = timestamp;
    this.send(data);
    return true;
  }
}
