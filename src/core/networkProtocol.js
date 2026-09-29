// Shared network input contract for the local WebSocket relay and Supabase relay.
// Keep validation here so ONLINE and TV_CONSOLE cannot drift apart.

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
