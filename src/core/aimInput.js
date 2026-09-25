// Canonical twin-stick aim state. Transport adapters only deliver packets;
// the authoritative engine owns one AimInputState per player.

export const AIM_ACTIVE_FORCE = 0.08;

const TAU = Math.PI * 2;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finite(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function normalizeAimAngle(angle, fallback = 0) {
  if (!Number.isFinite(angle)) return fallback;
  let normalized = angle % TAU;
  if (normalized > Math.PI) normalized -= TAU;
  if (normalized < -Math.PI) normalized += TAU;
  return normalized;
}

function packetAction(data) {
  const intent = data?.intent;
  if (intent?.type === 'action' && intent.id === 'aim') {
    if (intent.phase === 'press') return 'AIM_PRESS';
    if (intent.phase === 'release') return 'AIM_RELEASE';
  }
  return data?.action || null;
}

export function getAimAction(data) {
  const action = packetAction(data);
  return action === 'AIM_PRESS' || action === 'AIM_MOVE' || action === 'AIM_RELEASE'
    ? action
    : null;
}

function packetSequence(data) {
  return Number.isInteger(data?.seq) && data.seq >= 0 ? data.seq : null;
}

function makeVector(angle = 0) {
  return { dx: 0, dy: 0, angle, force: 0 };
}

export class AimInputState {
  constructor() {
    this.vector = makeVector();
    this.sources = new Map();
    this.sequenceBySource = new Map();
    this.activeSource = null;
  }

  get held() {
    for (const owner of this.sources.values()) {
      if (owner.held) return true;
    }
    return false;
  }

  get active() {
    return this.held && this.vector.force >= AIM_ACTIVE_FORCE;
  }

  get hasDirection() {
    return this.vector.force >= AIM_ACTIVE_FORCE;
  }

  snapshot() {
    return {
      ...this.vector,
      held: this.held,
      active: this.active,
      hasDirection: this.hasDirection,
    };
  }

  _acceptSequence(source, data) {
    const sequence = packetSequence(data);
    if (sequence === null) return true;
    const previous = this.sequenceBySource.get(source);
    const action = data?.intent?.phase === 'press'
      ? 'AIM_PRESS'
      : data?.intent?.phase === 'release'
        ? 'AIM_RELEASE'
        : data?.action;
    if (previous !== undefined && sequence <= previous) {
      // A reconnect can restart the client sequence while the host still has
      // the old slot. A fresh explicit press is a safe new session boundary;
      // stale moves/releases remain rejected.
      if (sequence < previous && action === 'AIM_PRESS' && !this.held) {
        this.sequenceBySource.set(source, sequence);
        return true;
      }
      return false;
    }
    this.sequenceBySource.set(source, sequence);
    return true;
  }

  _owner(source) {
    if (!this.sources.has(source)) {
      this.sources.set(source, {
        held: false,
        cancelled: false,
        hasDirection: false,
        vector: makeVector(this.vector.angle),
      });
    }
    return this.sources.get(source);
  }

  _setOwnerVector(owner, source, input) {
    const previousAngle = owner.vector?.angle ?? this.vector.angle;
    const force = clamp(finite(input?.force), 0, 1);
    let dx = clamp(finite(input?.dx), -1, 1);
    let dy = clamp(finite(input?.dy), -1, 1);
    const magnitude = Math.hypot(dx, dy);
    if (magnitude > 1) {
      dx /= magnitude;
      dy /= magnitude;
    }

    const hasDirection = force >= AIM_ACTIVE_FORCE && magnitude >= 0.01;
    const angle = hasDirection
      ? normalizeAimAngle(
        Number.isFinite(input?.angle) ? input.angle : Math.atan2(dy, dx),
        previousAngle,
      )
      : previousAngle;

    owner.vector = {
      dx: hasDirection ? dx : 0,
      dy: hasDirection ? dy : 0,
      angle,
      force: hasDirection ? force : 0,
    };
    if (owner.held || hasDirection) this.activeSource = source;
    if (this.activeSource === source) this.vector = { ...owner.vector };
    if (hasDirection) owner.hasDirection = true;
  }

  _clearActiveVector(source) {
    if (this.activeSource !== source) return;
    const next = [...this.sources.entries()].find(([candidate, owner]) => (
      candidate !== source && owner.held
    ));
    this.activeSource = next ? next[0] : null;
    this.vector = next ? { ...next[1].vector } : makeVector(this.vector.angle);
  }

  setVector(input = {}) {
    const owner = this._owner('external');
    owner.held = false;
    owner.cancelled = false;
    owner.hasDirection = false;
    this._setOwnerVector(owner, 'external', input);
    if (!owner.vector.force) this.vector = makeVector(this.vector.angle);
  }

  press(source, input = {}, data = {}) {
    if (!this._acceptSequence(source, data)) {
      return { accepted: false, type: 'stale', previousHeld: this.held, held: this.held };
    }
    const owner = this._owner(source);
    const previousHeld = owner.held;
    owner.held = true;
    owner.cancelled = false;
    if (!previousHeld) owner.hasDirection = false;
    this._setOwnerVector(owner, source, input);
    return {
      accepted: true,
      type: previousHeld ? 'move' : 'press',
      previousHeld,
      held: true,
      active: this.active,
      hasDirection: owner.hasDirection,
      angle: this.vector.angle,
      cancelled: false,
    };
  }

  move(source, input = {}, data = {}) {
    if (!this._acceptSequence(source, data)) {
      return { accepted: false, type: 'stale', previousHeld: this.held, held: this.held };
    }
    const owner = this._owner(source);
    const previousHeld = owner.held;
    const force = clamp(finite(input?.force), 0, 1);
    const magnitude = Math.hypot(finite(input?.dx), finite(input?.dy));
    const recoveredDirection = force >= AIM_ACTIVE_FORCE && magnitude >= 0.01;
    owner.held = previousHeld || data.aimHeld === true || recoveredDirection;
    owner.cancelled = false;
    this._setOwnerVector(owner, source, input);
    return {
      accepted: true,
      type: !previousHeld && owner.held ? 'press' : 'move',
      previousHeld,
      held: owner.held,
      active: this.active,
      hasDirection: owner.hasDirection,
      angle: this.vector.angle,
      cancelled: false,
    };
  }

  release(source, input = {}, data = {}) {
    if (!this._acceptSequence(source, data)) {
      return { accepted: false, type: 'stale', previousHeld: this.held, held: this.held };
    }
    const owner = this._owner(source);
    const previousHeld = owner.held;
    owner.held = false;
    this._setOwnerVector(owner, source, input);
    const hasDirection = owner.hasDirection;
    const angle = this.vector.angle;
    owner.cancelled = data.cancelled === true;
    this._clearActiveVector(source);
    return {
      accepted: true,
      type: 'release',
      previousHeld,
      held: false,
      active: false,
      hasDirection,
      angle,
      cancelled: owner.cancelled,
    };
  }

  clear(source = null, cancelled = true) {
    const sources = source
      ? [source]
      : [...this.sources.keys()];
    const events = [];
    for (const candidate of sources) {
      const owner = this.sources.get(candidate);
      if (!owner || !owner.held) continue;
      owner.held = false;
      owner.cancelled = cancelled;
      events.push({
        type: 'release',
        source: candidate,
        previousHeld: true,
        held: false,
        active: false,
        hasDirection: owner.hasDirection,
        angle: owner.vector.angle,
        cancelled,
      });
      this._clearActiveVector(candidate);
    }
    return events;
  }

  reset() {
    this.vector = makeVector();
    this.sources.clear();
    this.sequenceBySource.clear();
    this.activeSource = null;
  }
}
