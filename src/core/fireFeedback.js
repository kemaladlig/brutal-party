// Shared weapon-fire feedback state. It contains no audio, haptics, or rendering
// dependencies so host and client-only world views can share the same contract.

export const FIRE_FEEDBACK_KIND = Object.freeze({
  BLOCKED: 'blocked',
  READY: 'ready',
  SHOT: 'shot',
});

export const FIRE_FEEDBACK_DURATION = Object.freeze({
  blocked: 180,
  ready: 240,
  shot: 110,
});

const VALID_KINDS = new Set(Object.values(FIRE_FEEDBACK_KIND));

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function clockNow(now) {
  if (Number.isFinite(now)) return now;
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  return Date.now();
}

function createState() {
  return {
    kind: null,
    serial: 0,
    until: 0,
    blocked: false,
  };
}

export function ensureFireFeedback(player) {
  if (!player) return null;
  if (!player.fireFeedback || typeof player.fireFeedback !== 'object') {
    player.fireFeedback = createState();
  }
  const state = player.fireFeedback;
  if (!VALID_KINDS.has(state.kind)) state.kind = null;
  if (!Number.isInteger(state.serial) || state.serial < 0) state.serial = 0;
  if (!Number.isFinite(state.until)) state.until = 0;
  state.blocked = state.blocked === true;
  return state;
}

export function getFireCooldownRemaining(player) {
  if (!player) return 0;
  for (const key of ['shotCooldown', 'attackCooldown', 'reloadCooldown']) {
    const value = Number(player[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

export function getFireCooldownProgress(player, maxCooldown = 0) {
  const max = Number(maxCooldown);
  if (!Number.isFinite(max) || max <= 0) return 1;
  return clamp01(1 - getFireCooldownRemaining(player) / max);
}

export function updateFireFeedback(player, now = clockNow()) {
  const state = ensureFireFeedback(player);
  if (!state) return null;
  const timestamp = clockNow(now);
  const remaining = getFireCooldownRemaining(player);

  if (state.blocked && remaining <= 0) {
    state.blocked = false;
    state.kind = FIRE_FEEDBACK_KIND.READY;
    state.serial += 1;
    state.until = timestamp + FIRE_FEEDBACK_DURATION.ready;
  }

  if (state.kind !== FIRE_FEEDBACK_KIND.BLOCKED && state.until > 0 && timestamp >= state.until) {
    state.kind = null;
  }
  return state;
}

export function markFireBlocked(player, now = clockNow()) {
  const state = updateFireFeedback(player, now);
  if (!state || state.blocked || getFireCooldownRemaining(player) <= 0) return false;
  state.blocked = true;
  state.kind = FIRE_FEEDBACK_KIND.BLOCKED;
  state.serial += 1;
  state.until = clockNow(now) + FIRE_FEEDBACK_DURATION.blocked;
  return true;
}

export function markFireShot(player, now = clockNow()) {
  const state = ensureFireFeedback(player);
  if (!state) return false;
  state.blocked = false;
  state.kind = FIRE_FEEDBACK_KIND.SHOT;
  state.serial += 1;
  state.until = clockNow(now) + FIRE_FEEDBACK_DURATION.shot;
  return true;
}

export function resetFireFeedback(player) {
  if (!player) return;
  player.fireFeedback = createState();
}

export function getFireFeedbackSnapshot(player, now = clockNow()) {
  const state = updateFireFeedback(player, now);
  if (!state) return { kind: null, serial: 0, ttl: 0 };
  const timestamp = clockNow(now);
  return {
    kind: state.kind,
    serial: state.serial,
    ttl: clamp01((state.until - timestamp) / 1000),
  };
}

// Host çizimi ham oyuncu state'ini, client çizimi ise snapshot state'ini verir.
// İki biçimi tek bir görüntüleme sözleşmesine indirger.
export function getFireFeedbackForRender(player, now = clockNow()) {
  const feedback = player?.fireFeedback;
  if (feedback && Number.isFinite(feedback.ttl)) return feedback;
  return getFireFeedbackSnapshot(player, now);
}

export function isValidFireFeedbackSnapshot(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.kind !== null && !VALID_KINDS.has(value.kind)) return false;
  return Number.isInteger(value.serial) && value.serial >= 0
    && Number.isFinite(value.ttl) && value.ttl >= 0 && value.ttl <= 1;
}
