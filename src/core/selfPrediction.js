// Presentation-only self-avatar prediction for ONLINE world view.
//
// The host stays authoritative: this module produces NO gameplay state and
// never advances the simulation. It only advances the local player's DRAWN
// position between authoritative snapshots so the player's own thumb movement
// shows up without waiting for a full round trip.
//
// Direction comes from the LIVE local input (so turns read instantly); speed
// magnitude is OBSERVED from consecutive snapshots (so no per-game tuning
// constant is duplicated here). Games opt in by writing `selfPredict: true`
// into their world packet — absent that flag this module is a no-op.

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

// Kaç px/s tavanı: bozuk/atlama sonrası tek karelik sıçramanın hız tahminini
// sonsuza çekmesini engeller. Gerçek oyun hızları bunun çok altındadır.
const MAX_SPEED_PX_S = 2200;
const MIN_DT_S = 0.008;
const MAX_DT_S = 0.2;
const SPEED_EMA = 0.3;
// Tahmin ufku üst sınırı: bundan uzun ileri sarma duvara/köşeye taşırır.
const MAX_HORIZON_S = 0.2;

export function createSelfPredictor() {
  return {
    speed: 0,
    hasPrev: false,
    prevX: 0,
    prevY: 0,
    prevT: 0,
  };
}

function selfPlayer(frame, selfSlot) {
  if (!Array.isArray(frame?.players)) return null;
  for (const player of frame.players) {
    if (player && player.slot === selfSlot) return player;
  }
  return null;
}

/**
 * Feed a freshly accepted authoritative frame; updates the observed speed.
 * @param {ReturnType<typeof createSelfPredictor>} state caller-owned predictor
 * @param {any} frame newest accepted world frame
 * @param {number} selfSlot local player slot
 * @param {number} receivedAt local receive time (ms)
 */
export function observeSelfFrame(state, frame, selfSlot, receivedAt) {
  const player = selfPlayer(frame, selfSlot);
  if (!player || !finite(player.x) || !finite(player.y)) {
    state.hasPrev = false;
    state.speed = 0;
    return;
  }
  // `sentAt` host monotonic clock'undadır; fark (dt) iki cihazda da gerçek
  // zamandır. Yoksa yerel varış zamanına düşeriz (eski istemci uyumu).
  const t = finite(frame.sentAt) ? frame.sentAt : receivedAt;
  if (state.hasPrev) {
    const dt = (t - state.prevT) / 1000;
    if (dt >= MIN_DT_S && dt <= MAX_DT_S) {
      const inst = Math.min(Math.hypot(player.x - state.prevX, player.y - state.prevY) / dt, MAX_SPEED_PX_S);
      state.speed = state.speed === 0 ? inst : state.speed * (1 - SPEED_EMA) + inst * SPEED_EMA;
    }
  }
  state.hasPrev = true;
  state.prevX = player.x;
  state.prevY = player.y;
  state.prevT = t;
}

/**
 * Return a copy of `frame` whose local player is drawn at a predicted position.
 * Returns `frame` unchanged when prediction does not apply, so callers can use
 * the result unconditionally.
 * @param {ReturnType<typeof createSelfPredictor>} state caller-owned predictor
 * @param {any} frame presented (possibly interpolated) world frame
 * @param {number} selfSlot local player slot
 * @param {{dx?: number, dy?: number, force?: number}|null} input live local move input
 * @param {number} horizonSeconds how far ahead to advance (s)
 */
export function applySelfPrediction(state, frame, selfSlot, input, horizonSeconds) {
  if (!frame || frame.selfPredict !== true) return frame;
  const force = finite(input?.force) ? input.force : 0;
  const dx = finite(input?.dx) ? input.dx : 0;
  const dy = finite(input?.dy) ? input.dy : 0;
  const dirLength = Math.hypot(dx, dy);
  if (force <= 0 || dirLength <= 0.001 || state.speed <= 0) return frame;

  const horizon = finite(horizonSeconds) ? Math.max(0, Math.min(MAX_HORIZON_S, horizonSeconds)) : 0;
  if (horizon <= 0) return frame;

  const player = selfPlayer(frame, selfSlot);
  if (!player || !finite(player.x) || !finite(player.y)) return frame;

  const step = state.speed * Math.min(1, force) * horizon;
  let nx = player.x + (dx / dirLength) * step;
  let ny = player.y + (dy / dirLength) * step;

  const arena = frame.arena;
  if (Array.isArray(arena) && arena.length === 4) {
    const pad = finite(player.radius) ? player.radius : 0;
    nx = Math.max(arena[0] + pad, Math.min(arena[2] - pad, nx));
    ny = Math.max(arena[1] + pad, Math.min(arena[3] - pad, ny));
  }

  const players = frame.players.map((candidate) => (
    candidate === player ? { ...candidate, x: nx, y: ny } : candidate
  ));
  return { ...frame, players };
}
