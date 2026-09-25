// Transport-neutral gamepad analog adapter. It owns only the 50 ms throttle,
// dead-zone filtering and neutral bookkeeping required by the control budget.

export class GamepadInputAdapter {
  constructor(send, { now = () => performance.now() } = {}) {
    this.send = send;
    this.now = now;
    this.reset();
  }

  reset() {
    this.lastAnalogSent = 0;
    this.lastPaddlePos = null;
    this.lastJoySent = { dx: 0, dy: 0 };
  }

  sendAnalog(data) {
    if (!data || typeof data.action !== 'string') return false;
    const timestamp = this.now();
    const isZero = data.action === 'JOYSTICK_MOVE'
      ? data.force === 0
      : false;

    if (!isZero) {
      if (timestamp - this.lastAnalogSent < 50) return false;
      if (data.action === 'PADDLE_MOVE' && typeof data.position === 'number') {
        if (this.lastPaddlePos !== null && Math.abs(data.position - this.lastPaddlePos) < 0.003) return false;
        this.lastPaddlePos = data.position;
      } else if (data.action === 'JOYSTICK_MOVE') {
        const dx = data.dx || 0;
        const dy = data.dy || 0;
        if (Math.hypot(dx - this.lastJoySent.dx, dy - this.lastJoySent.dy) < 0.02) return false;
        this.lastJoySent = { dx, dy };
      }
    } else {
      this.lastJoySent = { dx: 0, dy: 0 };
    }

    this.lastAnalogSent = timestamp;
    this.send(data);
    return true;
  }
}
