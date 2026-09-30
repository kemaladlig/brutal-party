// Shared network input contract for the local WebSocket relay and Supabase relay.
// Keep validation here so ONLINE and TV_CONSOLE cannot drift apart.

import { isFxKind } from './fxKit.js';

const finiteNum = (value) => typeof value === 'number' && Number.isFinite(value);
const validAimMeta = (data) => (
  (data.aimHeld === undefined || typeof data.aimHeld === 'boolean')
  && (data.seq === undefined || (Number.isInteger(data.seq) && data.seq >= 0))
  && (data.tap === undefined || typeof data.tap === 'boolean')
);

/**
 * Validate an input packet before it reaches an authoritative host.
 * This is transport-independent: the same contract is used by the local WS
 * server and the Supabase/WebRTC relay.
 */
export function isValidNetworkInput(data) {
  if (!data || typeof data.action !== 'string') return false;

  switch (data.action) {
    case 'JOYSTICK_MOVE':
      return finiteNum(data.dx) && finiteNum(data.dy)
        && Math.abs(data.dx) <= 1.05 && Math.abs(data.dy) <= 1.05
        && finiteNum(data.angle) && finiteNum(data.force)
        && data.force >= 0 && data.force <= 1.05;

    case 'AIM_MOVE':
      return finiteNum(data.dx) && finiteNum(data.dy)
        && Math.abs(data.dx) <= 1.05 && Math.abs(data.dy) <= 1.05
        && finiteNum(data.angle) && finiteNum(data.force)
        && data.force >= 0 && data.force <= 1.05
        && validAimMeta(data);

    case 'AIM_PRESS':
      return finiteNum(data.dx) && finiteNum(data.dy)
        && Math.abs(data.dx) <= 1.05 && Math.abs(data.dy) <= 1.05
        && finiteNum(data.angle) && finiteNum(data.force)
        && data.force >= 0 && data.force <= 1.05
        && (data.cancelled === undefined || typeof data.cancelled === 'boolean')
        && validAimMeta(data);

    case 'AIM_RELEASE':
      return finiteNum(data.dx) && finiteNum(data.dy)
        && Math.abs(data.dx) <= 1.05 && Math.abs(data.dy) <= 1.05
        && finiteNum(data.angle) && finiteNum(data.force)
        && data.force >= 0 && data.force <= 1.05
        && (data.cancelled === undefined || typeof data.cancelled === 'boolean')
        && validAimMeta(data);

    case 'PADDLE_MOVE':
      return finiteNum(data.position) && data.position >= -0.05 && data.position <= 1.05;

    case 'CURVE_STEER':
    case 'SNAKE_STEER':
      return data.dir === -1 || data.dir === 0 || data.dir === 1;

    case 'TANK_DRIVE':
      return typeof data.driving === 'boolean';

    case 'CURVE_BOOST':
    case 'TANK_FIRE':
    case 'DASH':
    case 'TACKLE':
    case 'SPIN':
    case 'SNAKE_BOOST':
    case 'SNAKE_BOOST_RELEASE':
    case 'NINJA_SMOKE':
      return true;

    case 'SET_NAME':
      return typeof data.name === 'string' && data.name.trim().length > 0;

    case 'SWITCH_SLOT':
      return Number.isInteger(data.targetSlot)
        && data.targetSlot >= 0 && data.targetSlot <= 3;

    case 'AVATAR_UPDATE':
      // Deep sanitization remains the host's responsibility.
      return data.avatar && typeof data.avatar === 'object';

    default:
      return false;
  }
}

// ── STATE_SYNC Paket Sözleşmesi ───────────────────────────────────────────
// Host 8 Hz periyodik durum paketini iki transport üzerinden yollar. İki
// transport da alanları DÜZ gönderir (discriminator en üstte, yük yanında):
//   ONLINE     supabaseRelay.js → { action: 'STATE_SYNC', ...state }
//   TV_CONSOLE network.js      → { type: 'HOST_STATE_SYNC', ...state }
// Kumanda tarafı (`gamepad.handleStateSync`) yalnız en-üst-seviye alanları
// okur; iç içe gömülü kova gönderen bir host o alanları sessizce undefined
// bulur ve faz uzlaşması / skor şeridi / sayaç / cooldown senkronu düşer.
//
// Bu normalize edici iki yönlü güvenlik sağlar: yeni host + eski sunucu,
// eski host (kova şeklinde) + yeni sunucu/kumanda. Yeni şekte paket zaten
// düzdür ve dokunulmadan geçer.

/**
 * STATE_SYNC paketini tek şekle indirger (her zaman düz yük).
 * @param {any} msg - ham taşıma zarfı
 * @returns {any} tüketiciye verilecek düz paket
 */
export function normalizeStateSync(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
  const { state, ...outer } = msg;
  if (!state || typeof state !== 'object' || Array.isArray(state)) return msg;
  // Yalnız STATE_SYNC kovaları açılır. Motor HUD'ının `state` alanı bir
  // string'dir (stateSync.js `state` alanını bilerek göndermez) ve burada
  // nesne kontrolü sayesinde zaten eleniyor; `phase`/`gameMode` yoksa dokunma.
  if (!('phase' in state) && !('gameMode' in state)) return msg;
  return { ...state, ...outer };
}

// ── FX olay paketi sözleşmesi (MOTION_PLAN 2.2) ─────────────────────────────
// FX olayları 30 Hz world kanalında TAŞINMAZ (unreliable kayıp = görsel
// tutarsızlık) ve 8 Hz STATE_SYNC'e girmez. Giderdiği yol: kritik olayların
// "anında gider" hızlı yolu — her iki transport'ta AYNI düz şema:
//   TV_CONSOLE network.js       → { type: 'HOST_FX', events: [...] }
//   ONLINE   supabaseRelay.js   → { action: 'FX_EVENTS', events: [...] }
// Olay biçimi: { fx, token, x, y, u, power, slot?, color?, dirX?, dirY?,
//                angle?, size?, ringRadius? } — kapalı FX kümesi (fxKit).
// `token` oturum sayaçlıdır: kumanda yinelenen/eski olayı atar.

/** Tek partideki olay üst sınırı (anlık yol bütçesi). */
export const FX_EVENT_BATCH_CAP = 24;

/**
 * Tek FX olayı doğrulaması (taşıma bağımsız). @param {any} e
 * @returns {boolean}
 */
export function isValidFxEvent(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return false;
  if (typeof e.fx !== 'string' || !isFxKind(e.fx)) return false;
  if (!Number.isInteger(e.token) || e.token <= 0) return false;
  if (!finiteNum(e.x) || !finiteNum(e.y)) return false;
  if (!finiteNum(e.u) || e.u <= 0 || e.u > 20) return false;
  if (!finiteNum(e.power) || e.power < 0 || e.power > 1) return false;
  if (e.slot !== undefined && !(Number.isInteger(e.slot) && e.slot >= 0 && e.slot <= 3)) return false;
  if (e.color !== undefined && !(typeof e.color === 'string' && e.color.length > 0 && e.color.length <= 32)) return false;
  for (const k of ['dirX', 'dirY', 'angle', 'size', 'ringRadius']) {
    if (e[k] !== undefined && !finiteNum(e[k])) return false;
  }
  return true;
}

/**
 * FX olayı kaydını kablosuz biçimine damgalar (yalnız beyaz-liste alanlar).
 * Damgasız kayıt girişi kabul edilir; `token` burada basılır.
 * @param {any} rec
 * @param {number} token
 * @returns {Record<string, any> | null}
 */
export function toFxWireEvent(rec, token) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
  if (typeof rec.fx !== 'string' || !isFxKind(rec.fx)) return null;
  if (!Number.isInteger(token) || token <= 0) return null;
  /** @type {Record<string, any>} */
  const out = {
    fx: rec.fx,
    token,
    x: Number(rec.x),
    y: Number(rec.y),
    u: Number(rec.u),
    power: Number(rec.power),
  };
  if (rec.slot !== undefined) out.slot = rec.slot;
  if (rec.color !== undefined) out.color = rec.color;
  for (const k of ['dirX', 'dirY', 'angle', 'size', 'ringRadius']) {
    if (rec[k] !== undefined) out[k] = rec[k];
  }
  return isValidFxEvent(out) ? out : null;
}

/**
 * Oturum sayaçlı damga üreticisi (host tarafı, stateSync.flushFxEvents).
 * @returns {(records: any[]) => any[]}
 */
export function createFxStamp() {
  let token = 0;
  return (records) => {
    const out = [];
    for (const rec of Array.isArray(records) ? records : []) {
      const wire = toFxWireEvent(rec, (token += 1));
      if (wire) out.push(wire);
    }
    return out;
  };
}

/**
 * Yinelenen/eski olay süzgeci (kumanda tarafı). Token oturum sayaçlı olduğu
 * için eşit/küçük token ATLANIR; `reset` yeni oyun/mount'ta çağrılır.
 * @returns {((events: any[]) => any[]) & { reset: () => void }}
 */
export function createFxEventFilter() {
  let lastToken = 0;
  /** @type {any} */
  const filter = (events) => {
    const out = [];
    for (const e of Array.isArray(events) ? events : []) {
      if (!isValidFxEvent(e) || e.token <= lastToken) continue;
      lastToken = e.token;
      out.push(e);
    }
    return out;
  };
  filter.reset = () => { lastToken = 0; };
  return filter;
}

/**
 * FX olayı zarfını tek şekle indirger: `{events:[...]}` yükü ya da tek olaylık
 * `{fx:'hit', ...}` zarfı normalize edilir; şema dışı olaylar DÜŞÜRÜLÜR
 * (güvenilir yol yinelenirse token süzgeci ayrıca temizler).
 * @param {any} msg - ham taşıma zarfı
 * @returns {any[] | null} doğrulanmış olay listesi; şema dışı zarfta null
 */
export function normalizeFxEvents(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
  let raw = null;
  if (Array.isArray(msg.events)) raw = msg.events;
  else if (typeof msg.fx === 'string') raw = [msg];
  if (!raw || raw.length === 0 || raw.length > FX_EVENT_BATCH_CAP) return null;
  const out = [];
  for (const e of raw) {
    if (!isValidFxEvent(e)) continue;
    out.push({
      fx: e.fx,
      token: e.token,
      x: e.x,
      y: e.y,
      u: e.u,
      power: e.power,
      ...(e.slot !== undefined ? { slot: e.slot } : {}),
      ...(e.color !== undefined ? { color: e.color } : {}),
      ...(e.dirX !== undefined ? { dirX: e.dirX, dirY: e.dirY } : {}),
      ...(e.angle !== undefined ? { angle: e.angle } : {}),
      ...(e.size !== undefined ? { size: e.size } : {}),
      ...(e.ringRadius !== undefined ? { ringRadius: e.ringRadius } : {}),
    });
  }
  return out.length ? out : null;
}

// ── Oda Kodu Sözleşmesi: 3 haneli sayı (000-999). Az kişi, hızlı giriş. ──
/**
 * 3 haneli sayısal oda kodu üretir (benzersizlik çağrıcıda: RoomManager kayıtlı
 * kodla çakışanı eleyip yeniden dener).
 * @returns {string}
 */
export function generateRoomCode() {
  return String(Math.floor(Math.random() * 1000)).padStart(3, '0');
}

/**
 * Oda kodunu temizler ve büyük harfe çevirir.
 * @param {any} code
 * @returns {string}
 */
export function normalizeRoomCode(code) {
  return (code ?? '').toString().trim().toUpperCase();
}

/**
 * Oda kodunun geçerli uzunlukta (3-6 karakter) ve alfanümerik olduğunu doğrular.
 * @param {any} code
 * @returns {boolean}
 */
export function isValidRoomCode(code) {
  if (typeof code !== 'string' && typeof code !== 'number') return false;
  const clean = normalizeRoomCode(code);
  return clean.length >= 3 && clean.length <= 6 && /^[A-Z0-9]+$/.test(clean);
}
