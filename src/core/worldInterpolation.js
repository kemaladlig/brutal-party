// Snapshot interpolation primitives shared by ONLINE world renderers.
// The host remains authoritative; this module only smooths presentation data.

const finiteNum = (value) => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
);

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

export const lerp = (a, b, t) => a + (b - a) * t;

export function lerpAngleRad(a, b, t) {
  let delta = (b - a) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}

function blendPointArrays(previous, current, t) {
  if (!Array.isArray(current)) return current;
  if (!Array.isArray(previous) || previous.length === 0 || current.length === 0) return current;

  const outputLength = Math.max(previous.length, current.length);
  const output = new Array(outputLength);
  const pointIndex = (length, index) => {
    if (length <= 1 || outputLength <= 1) return 0;
    return Math.round((index / (outputLength - 1)) * (length - 1));
  };

  let changed = false;
  for (let index = 0; index < outputLength; index += 1) {
    const currentPoint = current[pointIndex(current.length, index)];
    const previousPoint = previous[pointIndex(previous.length, index)];
    const currentX = Array.isArray(currentPoint) ? finiteNum(currentPoint[0]) : null;
    const currentY = Array.isArray(currentPoint) ? finiteNum(currentPoint[1]) : null;
    const previousX = Array.isArray(previousPoint) ? finiteNum(previousPoint[0]) : null;
    const previousY = Array.isArray(previousPoint) ? finiteNum(previousPoint[1]) : null;

    if (currentX === null || currentY === null || previousX === null || previousY === null) {
      output[index] = currentPoint;
    } else {
      output[index] = [lerp(previousX, currentX, t), lerp(previousY, currentY, t)];
      changed = true;
    }
  }
  return changed ? output : current;
}

const TRANSFORM_KEYS = ['x', 'y', 'angle', 'heading', 'x1', 'y1', 'x2', 'y2'];

function blendObject(previous, current, t) {
  if (!previous || !current || typeof previous !== 'object' || typeof current !== 'object') {
    return current;
  }

  const output = { ...current };
  for (const key of TRANSFORM_KEYS) {
    const before = finiteNum(previous[key]);
    const after = finiteNum(current[key]);
    if (before === null || after === null) continue;
    output[key] = key === 'angle' || key === 'heading'
      ? lerpAngleRad(before, after, t)
      : lerp(before, after, t);
  }

  if (Array.isArray(previous.trail) && Array.isArray(current.trail)) {
    output.trail = blendPointArrays(previous.trail, current.trail, t);
  }
  if (Array.isArray(previous.history) && Array.isArray(current.history)) {
    output.history = blendPointArrays(previous.history, current.history, t);
  }
  return output;
}

function entityKey(entity, index, kind) {
  if (Array.isArray(entity)) {
    if (kind === 'arrows' && Number.isInteger(entity[5])) return `id:${entity[5]}`;
    if (kind === 'bullets' && Number.isInteger(entity[6])) return `id:${entity[6]}`;
    if (kind === 'tombs' && Number.isInteger(entity[2])) return `id:${entity[2]}`;
    if (kind === 'near' && Number.isInteger(entity[6])) return `id:${entity[6]}`;
    return `index:${index}`;
  }

  if (entity && typeof entity === 'object') {
    if (Number.isInteger(entity.id)) return `id:${entity.id}`;
    if (kind === 'players' && Number.isInteger(entity.slot)) return `slot:${entity.slot}`;
    if (kind === 'clones' && Number.isInteger(entity.owner)) return `owner:${entity.owner}`;
  }
  return `index:${index}`;
}

function blendObjectList(previous, current, t, kind) {
  if (!Array.isArray(current)) return current;
  if (!Array.isArray(previous) || previous.length === 0) return current;

  const previousByKey = new Map();
  previous.forEach((entity, index) => {
    previousByKey.set(entityKey(entity, index, kind), entity);
  });

  return current.map((entity, index) => {
    const key = entityKey(entity, index, kind);
    const before = previousByKey.get(key)
      || (Number.isInteger(entity?.id) ? previous[index] : null);
    return blendObject(before, entity, t);
  });
}

function blendPackedList(previous, current, t, kind, coordinateIndexes = [0, 1]) {
  if (!Array.isArray(current)) return current;
  if (!Array.isArray(previous) || previous.length === 0) return current;

  const previousByKey = new Map();
  previous.forEach((entity, index) => {
    previousByKey.set(entityKey(entity, index, kind), entity);
  });

  return current.map((entity, index) => {
    const key = entityKey(entity, index, kind);
    const before = previousByKey.get(key)
      || (previous.length === current.length ? previous[index] : null);
    if (!Array.isArray(before) || !Array.isArray(entity)) return entity;

    const output = [...entity];
    for (const coordinateIndex of coordinateIndexes) {
      const beforeValue = finiteNum(before[coordinateIndex]);
      const afterValue = finiteNum(entity[coordinateIndex]);
      if (beforeValue !== null && afterValue !== null) {
        output[coordinateIndex] = lerp(beforeValue, afterValue, t);
      }
    }
    return output;
  });
}

function blendSingleton(previous, current, t) {
  if (Array.isArray(previous) && Array.isArray(current)) {
    const output = [...current];
    for (const index of [0, 1]) {
      const before = finiteNum(previous[index]);
      const after = finiteNum(current[index]);
      if (before !== null && after !== null) output[index] = lerp(before, after, t);
    }
    return output;
  }
  return blendObject(previous, current, t);
}

export function canBlendWorldFrames(previous, current) {
  if (!previous || !current) return false;
  if (previous.version !== current.version) return false;
  if (previous.mode !== current.mode) return false;
  if (previous.roundId !== current.roundId) return false;
  if (previous.gameState !== current.gameState) return false;
  if (previous.hostId && current.hostId && previous.hostId !== current.hostId) return false;
  return true;
}

/**
 * Blend presentation fields between two authoritative snapshots.
 * Discrete state always comes from `current`; no gameplay state is simulated.
 */
export function blendWorldFrames(previous, current, t) {
  if (!previous || !current) return current;
  const alpha = clamp01(t);
  if (alpha <= 0) return previous;
  if (alpha >= 1) return current;
  if (!canBlendWorldFrames(previous, current)) return current;

  const output = { ...current };
  const previousSentAt = finiteNum(previous.sentAt);
  const currentSentAt = finiteNum(current.sentAt);
  if (previousSentAt !== null && currentSentAt !== null) {
    output.sentAt = lerp(previousSentAt, currentSentAt, alpha);
  }

  // Stable object entities: players, enemies, NPCs, projectiles, and effects.
  for (const kind of [
    'players',
    'enemies',
    'clones',
    'lasers',
    'tracers',
    'texts',
    'ghosts',
    'decals',
    'slashes',
    'impacts',
    'walls',
    'waves',
    'relics',
    'loadoutCrates',
  ]) {
    if (Array.isArray(previous[kind]) && Array.isArray(current[kind])) {
      output[kind] = blendObjectList(previous[kind], current[kind], alpha, kind);
    }
  }

  // Packed entity arrays. New entities stay at their authoritative position;
  // entities that disappear from the next snapshot are never extrapolated.
  for (const [kind, coordinateIndexes] of [
    ['arrows', [0, 1]],
    ['bullets', [0, 1]],
    ['tombs', [0, 1]],
    ['pickups', [0, 1]],
    ['loot', [0, 1]],
    ['steps', [0, 1]],
    ['near', [1, 2, 3, 4, 7]],
  ]) {
    if (Array.isArray(previous[kind]) && Array.isArray(current[kind])) {
      output[kind] = blendPackedList(
        previous[kind],
        current[kind],
        alpha,
        kind,
        coordinateIndexes,
      );
    }
  }

  if (previous.piggy !== undefined || current.piggy !== undefined) {
    output.piggy = blendSingleton(previous.piggy, current.piggy, alpha);
  }
  if (previous.portal !== undefined || current.portal !== undefined) {
    output.portal = blendSingleton(previous.portal, current.portal, alpha);
  }

  return output;
}

/**
 * Select a delayed presentation sample from a receive-time ordered buffer.
 * The caller owns the buffer; this helper never mutates or extrapolates it.
 */
function sampleTime(sample) {
  return finiteNum(sample?.playbackAt) ?? finiteNum(sample?.receivedAt) ?? 0;
}

export function selectBufferedWorldFrame(
  samples,
  playhead,
  maxGapMs = 100,
  blender = blendWorldFrames,
) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  if (samples.length === 1) {
    return { frame: samples[0].frame, alpha: 0, before: null, after: samples[0] };
  }

  const first = samples[0];
  const firstTime = sampleTime(first);
  if (playhead <= firstTime) {
    return { frame: first.frame, alpha: 0, before: null, after: first };
  }

  for (let index = 1; index < samples.length; index += 1) {
    const before = samples[index - 1];
    const after = samples[index];
    const beforeTime = sampleTime(before);
    const afterTime = sampleTime(after);
    if (playhead > afterTime) continue;

    const span = afterTime - beforeTime;
    if (span <= 0) return { frame: after.frame, alpha: 1, before, after };
    const alpha = clamp01((playhead - beforeTime) / span);
    if (span > maxGapMs) {
      const frame = alpha <= 0.5 ? before.frame : after.frame;
      return { frame, alpha: alpha <= 0.5 ? 0 : 1, before, after };
    }
    return {
      frame: blender(before.frame, after.frame, alpha),
      alpha,
      before,
      after,
    };
  }

  const last = samples[samples.length - 1];
  return {
    frame: last.frame,
    alpha: 1,
    before: samples[samples.length - 2],
    after: last,
  };
}
