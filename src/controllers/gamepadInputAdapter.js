// Transport-neutral gamepad analog adapter. It owns only the analog throttle,
// dead-zone filtering and neutral bookkeeping required by the control budget.

// Analog akış throttle'ı (kumanda → host). AGENTS §6 bütçesi 50 ms'ti; host
// zaten 33 ms'te ikinci kez kısıyordu, yani 50 ms tek bağlayıcı kısıttı ve
// yönü ~2-3 karede bir güncelliyordu. 40 ms (25 Hz) sunucu kapısının üstünde
// kalır (paket düşmez) ve gerçek girdi gecikmesini ~10 ms kısar.
export const ANALOG_THROTTLE_MS = 40;

export class GamepadInputAdapter {
  constructor(send, { now = () => performance.now() } = {}) {
    this.send = send;
    this.now = now;
    this.reset();
  }

  reset() {
    this.lastSentByAction = {};
    this.lastPaddlePos = null;
    this.lastJoySent = { dx: 0, dy: 0 };
    this.lastAimSent = { dx: 0, dy: 0 };
  }

  resetAction(action) {
    delete this.lastSentByAction[action];
    if (action === 'AIM_MOVE') this.lastAimSent = { dx: 0, dy: 0 };
    if (action === 'JOYSTICK_MOVE') this.lastJoySent = { dx: 0, dy: 0 };
    if (action === 'PADDLE_MOVE') this.lastPaddlePos = null;
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
        if (timestamp - lastSent < ANALOG_THROTTLE_MS) return false;
      }
      if (data.action === 'PADDLE_MOVE' && typeof data.position === 'number') {
        if (!keepalive && this.lastPaddlePos !== null && Math.abs(data.position - this.lastPaddlePos) < 0.003) return false;
        this.lastPaddlePos = data.position;
      } else if (data.action === 'JOYSTICK_MOVE') {
        const dx = data.dx || 0;
        const dy = data.dy || 0;
        if (!keepalive && Math.hypot(dx - this.lastJoySent.dx, dy - this.lastJoySent.dy) < 0.02) return false;
        this.lastJoySent = { dx, dy };
      } else if (data.action === 'AIM_MOVE') {
        const dx = data.dx || 0;
        const dy = data.dy || 0;
        if (!keepalive && data.aimHeld !== true && Math.hypot(dx - this.lastAimSent.dx, dy - this.lastAimSent.dy) < 0.005) return false;
        this.lastAimSent = { dx, dy };
      }
    } else if (data.action === 'JOYSTICK_MOVE') {
      this.lastJoySent = { dx: 0, dy: 0 };
    } else if (data.action === 'AIM_MOVE') {
      this.lastAimSent = { dx: 0, dy: 0 };
    }

    if (isZero) delete this.lastSentByAction[data.action];
    else this.lastSentByAction[data.action] = timestamp;
    this.send(data);
    return true;
  }
}
