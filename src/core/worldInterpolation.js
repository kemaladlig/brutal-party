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

// `swingT` (HORDE bıçak vuruşu ilerlemesi) da düz sayı olduğu için yumuşatılır;
// diğer oyunlarda bu alan yoktur, `finiteNum(undefined)` → null olur ve atlanır.
const TRANSFORM_KEYS = ['x', 'y', 'angle', 'heading', 'x1', 'y1', 'x2', 'y2', 'swingT'];

function blendObject(previous, current, t, options) {
  if (!previous || !current || typeof previous !== 'object' || typeof current !== 'object') {
    return current;
  }
  // Paketlenmiş dizi NESNEYE yayılamaz: `{ ...[x, y] }` → `{ 0: x, 1: y }`.
  // View'lar bu listeleri dizi deseniyle açar (`([x, y]) => ...`), yayılmış
  // girdi `TypeError: is not iterable` atıp client'ı beyaz ekrana düşürüyordu.
  // Eleman şekli `blendObjectList`'te ayrıştırılır; buradaki koruma tek kapıdır.
  if (Array.isArray(current)) return current;

  const output = { ...current };
  for (const key of TRANSFORM_KEYS) {
    const before = finiteNum(previous[key]);
    const after = finiteNum(current[key]);
    if (before === null || after === null) continue;
    output[key] = key === 'angle' || key === 'heading'
      ? lerpAngleRad(before, after, t)
      : lerp(before, after, t);
  }

  // Trail snap: gövdesi her snapshot'ta yay-uzunluğuyla yeniden örneklenen
  // oyun (SNAKE) pakete `snapTrail: true` yazar; indeks-lerp patikada kayıp
  // titreme çizdiği için trail current kareden snap alınır, baş/angle yine
  // yumuşatılır. Bayrak karede taşınır — moda özel dal yok.
  if (!options?.snapTrail) {
    if (Array.isArray(previous.trail) && Array.isArray(current.trail)) {
      output.trail = blendPointArrays(previous.trail, current.trail, t);
    }
    if (Array.isArray(previous.history) && Array.isArray(current.history)) {
      output.history = blendPointArrays(previous.history, current.history, t);
    }
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
    if (kind === 'echoes' && Number.isInteger(entity.owner)) return `owner:${entity.owner}`;
  }
  return `index:${index}`;
}

// Nesne tablosunda PAKETLENMİŞ dizi gelebilir. `walls` iki biçimde gidiyor:
// Hareketli duvarlar NESNE, SNAKE statik duvarları `[x, y, w, h]` dizisi
// (`packRectList`). Bu yüzden eleman şekline bakılır; hangi koordinatların
// yumuşatılacağı oyun adından değil, LİSTE KİMLİĞİNDEN türer (tablo).
const DEFAULT_PACKED_COORDINATES = /** @type {readonly number[]} */ ([0, 1]);
const PACKED_COORDINATES = Object.freeze({
  walls: /** @type {readonly number[]} */ ([0, 1, 2, 3]),
});

// Blend listeleri TEK KAYNAK: saf `blendWorldFrames` ile havuzlu
// `createWorldFrameBlender` aynı listeleri kullanır (sapma olmasın).
const OBJECT_BLEND_KINDS = Object.freeze([
  'players', 'enemies', 'tracers', 'texts', 'ghosts', 'decals',
  'slashes', 'impacts', 'walls', 'waves', 'relics', 'loadoutCrates',
]);
/** @type {readonly (readonly [string, readonly number[]])[]} */
const PACKED_BLEND_KINDS = Object.freeze([
  ['arrows', Object.freeze([0, 1])],
  ['bullets', Object.freeze([0, 1])],
  ['tombs', Object.freeze([0, 1])],
  ['pickups', Object.freeze([0, 1])],
  ['loot', Object.freeze([0, 1])],
  ['steps', Object.freeze([0, 1])],
  ['near', Object.freeze([1, 2, 3, 4, 7])],
]);
const SINGLETON_COORDS = Object.freeze([0, 1]);
const SNAP_TRAIL_OPTIONS = Object.freeze({ snapTrail: true });

/** Tek bir paketlenmiş girdiyi yumuşatır; dizi olmayan taraflar korunur. */
function blendPackedEntry(before, entity, t, coordinateIndexes) {
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
}

function blendObjectList(previous, current, t, kind, options) {
  if (!Array.isArray(current)) return current;
  if (!Array.isArray(previous) || previous.length === 0) return current;

  const previousByKey = new Map();
  previous.forEach((entity, index) => {
    previousByKey.set(entityKey(entity, index, kind), entity);
  });
  const packedIndexes = PACKED_COORDINATES[kind] || DEFAULT_PACKED_COORDINATES;

  return current.map((entity, index) => {
    const key = entityKey(entity, index, kind);
    const before = previousByKey.get(key)
      || (Number.isInteger(entity?.id) ? previous[index] : null);
    if (Array.isArray(entity)) return blendPackedEntry(before, entity, t, packedIndexes);
    return blendObject(before, entity, t, options);
  });
}

function blendPackedList(previous, current, t, kind, coordinateIndexes = DEFAULT_PACKED_COORDINATES) {
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
    return blendPackedEntry(before, entity, t, coordinateIndexes);
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
  // Trail anlami kareden okunur (`snapTrail`) — oyun adı değil.
  // `walls` burada iki biçimde bulunabilir (bkz. `blendObjectList`); eleman
  // yönlendirmesi şekle bakar, tablo oyun adına göre dallanmaz.
  const blendOptions = current.snapTrail === true ? SNAP_TRAIL_OPTIONS : undefined;
  for (let i = 0; i < OBJECT_BLEND_KINDS.length; i += 1) {
    const kind = OBJECT_BLEND_KINDS[i];
    if (Array.isArray(previous[kind]) && Array.isArray(current[kind])) {
      output[kind] = blendObjectList(previous[kind], current[kind], alpha, kind, blendOptions);
    }
  }

  // Packed entity arrays. New entities stay at their authoritative position;
  // entities that disappear from the next snapshot are never extrapolated.
  for (let i = 0; i < PACKED_BLEND_KINDS.length; i += 1) {
    const kind = PACKED_BLEND_KINDS[i][0];
    const coordinateIndexes = PACKED_BLEND_KINDS[i][1];
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
 * Kaynak-saati hizalama: host'un monotonik `sentAt` + ofset → oynatma zamanı.
 *
 * `sourceOffset` YUMUŞATILMIŞ bir ofset olmalıdır. En yeni karenin ham ofseti
 * (`receivedAt - sentAt`) her karede tüm zaman çizelgesini kaydırır; playhead
 * düzgün ilerlerken örneklemeleri ileri-geri sıçratır ve dünya titrer. Yumuşatılmış
 * ofset (client'ta `stats.sourceClockOffsetMs`) aynı kareleri aynı yere koyar.
 *
 * @param {ReadonlyArray<{ sentAt?: number | null }>} samples jitter buffer örnekleri
 * @param {number} sourceOffset `receivedAt - sentAt` (yumuşatılmış)
 * @returns {Array<{ sentAt?: number | null, playbackAt: number }>}
 */
export function alignSourceClock(samples, sourceOffset) {
  if (!Array.isArray(samples) || !Number.isFinite(sourceOffset)) return Array.isArray(samples) ? samples : [];
  return samples.map((sample) => ({
    ...sample,
    playbackAt: (finiteNum(sample?.sentAt) ?? 0) + sourceOffset,
  }));
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

// ---------------------------------------------------------------------------
// Havuzlu (tahsisiz) sunum blenderi — kumanda 60 Hz çizim yolu
// ---------------------------------------------------------------------------
// `blendWorldFrames` saftır ve her karede yeni nesne/dizi tahsis eder (test
// sözleşmesi). Bu, ONLINE kumanda telefonunun her çizim karesinde GC baskısı
// demekti. `createWorldFrameBlender` AYNI değerleri üretir; fark yalnız hedef
// nesnelerin/dizilerin kareler arasında yeniden kullanılmasıdır. Girdi kareleri
// jitter buffer'da kaldığı için asla mutasyona uğratılmaz: havuzun sahibi
// olmadığı bir dizi/nesne yerinde yazılmaz (sahiplik WeakSet'lerle izlenir).

const ownedObjects = new WeakSet();
const ownedArrays = new WeakSet();
const ownedLists = new WeakSet();
const entityMeta = new WeakMap();

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// `piggy`/`portal` yüzey senkronundan SONRA atanır; bu yüzden anahtar defterine
// (meta.keys) sonradan girmeleri gerekir, yoksa bir sonraki karede current'da
// bulunmayan bayat bir `piggy: undefined` çıktıda kalır (saf sürüm bırakmaz).
const SINGLETON_KEYS = ['piggy', 'portal'];

/** `out`'ta olup meta defterinde olmayan tekil anahtarları deftere ekler. */
function reconcileOptionalKeys(out, meta) {
  for (let i = 0; i < SINGLETON_KEYS.length; i += 1) {
    const key = SINGLETON_KEYS[i];
    if (!hasOwn(out, key)) continue;
    if (!meta.keys) meta.keys = [];
    if (meta.keys.indexOf(key) < 0) meta.keys.push(key);
  }
  if (meta.keys) meta.len = meta.keys.length;
}

function pointIndexFor(length, index, outputLength) {
  if (length <= 1 || outputLength <= 1) return 0;
  return Math.round((index / (outputLength - 1)) * (length - 1));
}

/** `container[kind]` alanını sahibi olduğumuz bir diziye indirger. */
function ensureOwnedList(container, kind) {
  let list = container[kind];
  if (!Array.isArray(list) || !ownedLists.has(list)) {
    list = [];
    ownedLists.add(list);
    container[kind] = list;
  }
  return list;
}

function pooledMeta(obj) {
  let meta = entityMeta.get(obj);
  if (!meta) {
    meta = { keys: null, len: -1, trail: null, history: null };
    entityMeta.set(obj, meta);
  }
  return meta;
}

/**
 * `target` yüzeyini `source` ile eşitler: tüm `source` anahtarlarını kopyalar,
 * `source`'ta olmayan eski anahtarları siler. Anahtar listesi `meta`'da tutulur;
 * şekil değişmediği sürece tahsis yoktur.
 */
function syncSurface(target, source, meta) {
  let count = 0;
  for (const key in source) {
    if (!hasOwn(source, key)) continue;
    target[key] = source[key];
    count += 1;
  }
  const keys = meta.keys;
  if (keys) {
    let stale = false;
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (!(key in source)) {
        if (hasOwn(target, key)) delete target[key];
        stale = true;
      }
    }
    if (!stale && count === meta.len) return;
  }
  meta.keys = Object.keys(source);
  meta.len = meta.keys.length;
}

function blendPointsPooled(meta, slot, previous, current, t) {
  if (!Array.isArray(current) || previous.length === 0 || current.length === 0) return current;
  const outputLength = Math.max(previous.length, current.length);
  let out = meta[slot];
  if (!Array.isArray(out) || !ownedArrays.has(out)) {
    out = [];
    ownedArrays.add(out);
    meta[slot] = out;
  }
  const currentLength = current.length;
  const previousLength = previous.length;
  let changed = false;
  for (let index = 0; index < outputLength; index += 1) {
    const currentPoint = current[pointIndexFor(currentLength, index, outputLength)];
    const previousPoint = previous[pointIndexFor(previousLength, index, outputLength)];
    const currentX = Array.isArray(currentPoint) ? finiteNum(currentPoint[0]) : null;
    const currentY = Array.isArray(currentPoint) ? finiteNum(currentPoint[1]) : null;
    const previousX = Array.isArray(previousPoint) ? finiteNum(previousPoint[0]) : null;
    const previousY = Array.isArray(previousPoint) ? finiteNum(previousPoint[1]) : null;
    if (currentX === null || currentY === null || previousX === null || previousY === null) {
      out[index] = currentPoint;
    } else {
      let point = out[index];
      if (!ownedArrays.has(point)) {
        point = [0, 0];
        ownedArrays.add(point);
        out[index] = point;
      }
      point[0] = lerp(previousX, currentX, t);
      point[1] = lerp(previousY, currentY, t);
      changed = true;
    }
  }
  out.length = outputLength;
  return changed ? out : current;
}

function blendObjectEntityPooled(outObj, previous, current, t, options) {
  if (
    !previous || !current
    || typeof previous !== 'object' || typeof current !== 'object'
    || Array.isArray(current)
  ) {
    return current;
  }
  const meta = pooledMeta(outObj);
  syncSurface(outObj, current, meta);
  for (let i = 0; i < TRANSFORM_KEYS.length; i += 1) {
    const key = TRANSFORM_KEYS[i];
    const before = finiteNum(previous[key]);
    const after = finiteNum(current[key]);
    if (before === null || after === null) continue;
    outObj[key] = (key === 'angle' || key === 'heading')
      ? lerpAngleRad(before, after, t)
      : lerp(before, after, t);
  }
  if (!options || options.snapTrail !== true) {
    if (Array.isArray(previous.trail) && Array.isArray(current.trail)) {
      outObj.trail = blendPointsPooled(meta, 'trail', previous.trail, current.trail, t);
    }
    if (Array.isArray(previous.history) && Array.isArray(current.history)) {
      outObj.history = blendPointsPooled(meta, 'history', previous.history, current.history, t);
    }
  }
  return outObj;
}

function blendPackedEntryPooled(list, index, before, entity, t, coordinateIndexes) {
  if (!Array.isArray(before) || !Array.isArray(entity)) return entity;
  let out = list[index];
  if (!ownedArrays.has(out)) {
    out = [];
    ownedArrays.add(out);
  }
  const length = entity.length;
  for (let i = 0; i < length; i += 1) out[i] = entity[i];
  out.length = length;
  for (let i = 0; i < coordinateIndexes.length; i += 1) {
    const coordinateIndex = coordinateIndexes[i];
    const beforeValue = finiteNum(before[coordinateIndex]);
    const afterValue = finiteNum(entity[coordinateIndex]);
    if (beforeValue !== null && afterValue !== null) {
      out[coordinateIndex] = lerp(beforeValue, afterValue, t);
    }
  }
  return out;
}

function blendObjectListPooled(out, kind, previous, current, t, options, previousByKey) {
  if (!Array.isArray(previous) || previous.length === 0) return current;
  previousByKey.clear();
  for (let i = 0; i < previous.length; i += 1) {
    previousByKey.set(entityKey(previous[i], i, kind), previous[i]);
  }
  const list = ensureOwnedList(out, kind);
  const packedIndexes = PACKED_COORDINATES[kind] || DEFAULT_PACKED_COORDINATES;
  for (let index = 0; index < current.length; index += 1) {
    const entity = current[index];
    const key = entityKey(entity, index, kind);
    const before = previousByKey.get(key)
      || (entity && Number.isInteger(entity.id) ? previous[index] : null);
    if (Array.isArray(entity)) {
      list[index] = blendPackedEntryPooled(list, index, before, entity, t, packedIndexes);
    } else {
      let slot = list[index];
      if (!ownedObjects.has(slot)) {
        slot = {};
        ownedObjects.add(slot);
      }
      list[index] = blendObjectEntityPooled(slot, before, entity, t, options);
    }
  }
  list.length = current.length;
  return list;
}

function blendPackedListPooled(out, kind, previous, current, t, coordinateIndexes, previousByKey) {
  if (!Array.isArray(previous) || previous.length === 0) return current;
  previousByKey.clear();
  for (let i = 0; i < previous.length; i += 1) {
    previousByKey.set(entityKey(previous[i], i, kind), previous[i]);
  }
  const list = ensureOwnedList(out, kind);
  for (let index = 0; index < current.length; index += 1) {
    const entity = current[index];
    const key = entityKey(entity, index, kind);
    const before = previousByKey.get(key)
      || (previous.length === current.length ? previous[index] : null);
    list[index] = blendPackedEntryPooled(list, index, before, entity, t, coordinateIndexes);
  }
  list.length = current.length;
  return list;
}

function blendSingletonPooled(slotName, previous, current, t, singletons, singletonObjects) {
  if (Array.isArray(previous) && Array.isArray(current)) {
    let out = singletons[slotName];
    if (!Array.isArray(out) || !ownedArrays.has(out)) {
      out = [];
      ownedArrays.add(out);
      singletons[slotName] = out;
    }
    for (let i = 0; i < current.length; i += 1) out[i] = current[i];
    out.length = current.length;
    for (let i = 0; i < SINGLETON_COORDS.length; i += 1) {
      const index = SINGLETON_COORDS[i];
      const before = finiteNum(previous[index]);
      const after = finiteNum(current[index]);
      if (before !== null && after !== null) out[index] = lerp(before, after, t);
    }
    return out;
  }
  let outObj = singletonObjects[slotName];
  if (!ownedObjects.has(outObj)) {
    outObj = {};
    ownedObjects.add(outObj);
    singletonObjects[slotName] = outObj;
  }
  return blendObjectEntityPooled(outObj, previous, current, t);
}

/**
 * Havuzlu, sunum-only `blendWorldFrames` eşdeğeri üretir. Dönen fonksiyon
 * birebir aynı DEĞERLERİ üretir; tek fark kare başına tahsisin kalkmasıdır.
 * Girdi kareleri mutasyona uğramaz (sahiplik `ownedObjects`/`ownedArrays`/
 * `ownedLists` ile doğrulanır). `blendWorldFrames` saf referans olarak kalır.
 *
 * @returns {(previous: any, current: any, t: number) => any}
 */
export function createWorldFrameBlender() {
  const out = {};
  const meta = { keys: null, len: -1 };
  const previousByKey = new Map();
  const singletons = { piggy: null, portal: null };
  const singletonObjects = { piggy: null, portal: null };

  return function blendPooled(previous, current, t) {
    if (!previous || !current) return current;
    const alpha = clamp01(t);
    if (alpha <= 0) return previous;
    if (alpha >= 1) return current;
    if (!canBlendWorldFrames(previous, current)) return current;

    reconcileOptionalKeys(out, meta);
    syncSurface(out, current, meta);
    const previousSentAt = finiteNum(previous.sentAt);
    const currentSentAt = finiteNum(current.sentAt);
    if (previousSentAt !== null && currentSentAt !== null) {
      out.sentAt = lerp(previousSentAt, currentSentAt, alpha);
    }

    const blendOptions = current.snapTrail === true ? SNAP_TRAIL_OPTIONS : undefined;
    for (let i = 0; i < OBJECT_BLEND_KINDS.length; i += 1) {
      const kind = OBJECT_BLEND_KINDS[i];
      if (Array.isArray(previous[kind]) && Array.isArray(current[kind])) {
        out[kind] = blendObjectListPooled(
          out, kind, previous[kind], current[kind], alpha, blendOptions, previousByKey,
        );
      }
    }
    for (let i = 0; i < PACKED_BLEND_KINDS.length; i += 1) {
      const kind = PACKED_BLEND_KINDS[i][0];
      const coordinates = PACKED_BLEND_KINDS[i][1];
      if (Array.isArray(previous[kind]) && Array.isArray(current[kind])) {
        out[kind] = blendPackedListPooled(
          out, kind, previous[kind], current[kind], alpha, coordinates, previousByKey,
        );
      }
    }
    if (previous.piggy !== undefined || current.piggy !== undefined) {
      out.piggy = blendSingletonPooled('piggy', previous.piggy, current.piggy, alpha, singletons, singletonObjects);
    }
    if (previous.portal !== undefined || current.portal !== undefined) {
      out.portal = blendSingletonPooled('portal', previous.portal, current.portal, alpha, singletons, singletonObjects);
    }
    return out;
  };
}
