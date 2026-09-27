// Tepki seti — TEK kaynak (istemci + oda sunucusu).
//
// Wire değeri OS emojisi DEĞİL, `tabletopIcons` ikon anahtarıdır (AGENTS §7):
// platforma göre değişen ve deterministik olmayan ham emojiler buraya giremez.
// `normalizeReactionKey` ağdan gelen değeri beyaz listeye indirger; eski
// istemcilerin gönderdiği emojiler takma adla aynı anahtara çevrilir.
//
// `color`, her tepkinin GÖRSEL kimliğidir (dolu çıkartma "sticker" glifi).
// Bu dosya sunucu tarafında da import edildiğinden renkler düz hex veridir;
// tema/UI token'ları değildir. Anahtar uzunluğu sunucudaki eski 8 karakterlik
// kırpma sınırına sığar; yeni anahtar eklerken `REACTION_KEY_MAX` kontrolü
// testte kilitlidir.

export const REACTION_KEY_MAX = 8;

export const REACTIONS = Object.freeze([
  Object.freeze({ key: 'laugh', labelKey: 'react.laugh', color: '#F2759B' }),
  Object.freeze({ key: 'flame', labelKey: 'react.flame', color: '#F2782C' }),
  Object.freeze({ key: 'skull', labelKey: 'react.skull', color: '#9AA5B5' }),
  Object.freeze({ key: 'heart', labelKey: 'react.heart', color: '#E5474F' }),
  Object.freeze({ key: 'star', labelKey: 'react.star', color: '#FFC53D' }),
  Object.freeze({ key: 'crown', labelKey: 'react.crown', color: '#E8A33D' }),
  Object.freeze({ key: 'zap', labelKey: 'react.zap', color: '#3B4EDE' }),
  Object.freeze({ key: 'ghost', labelKey: 'react.ghost', color: '#AA9BF0' }),
  Object.freeze({ key: 'kiss', labelKey: 'react.kiss', color: '#E0486D' }),
  Object.freeze({ key: 'thumbsup', labelKey: 'react.thumbsup', color: '#2FA66E' }),
  Object.freeze({ key: 'cry', labelKey: 'react.cry', color: '#5B8DEF' }),
  Object.freeze({ key: 'sleepy', labelKey: 'react.sleepy', color: '#7D5CE6' }),
]);

export const REACTION_KEYS = Object.freeze(REACTIONS.map((r) => r.key));

const REACTION_SET = new Set(REACTION_KEYS);

// Eski istemci uyumu: ham emojiyi gönderen sürümler aynı ikona düşer.
const LEGACY_ALIASES = Object.freeze({
  '😂': 'laugh',
  '🤣': 'laugh',
  '🔥': 'flame',
  '💀': 'skull',
  '❤️': 'heart',
  '💙': 'heart',
  '⭐': 'star',
  '🌟': 'star',
  '🏆': 'crown',
  '👑': 'crown',
  '⚡': 'zap',
  '😱': 'zap',
  '👻': 'ghost',
  '💋': 'kiss',
  '🥰': 'kiss',
  '👍': 'thumbsup',
  '🙏': 'thumbsup',
  '😢': 'cry',
  '😭': 'cry',
  '😴': 'sleepy',
});

export const DEFAULT_REACTION = 'flame';

export function isReactionKey(value) {
  return typeof value === 'string' && REACTION_SET.has(value);
}

/** Tepkinin çıkartma (sticker) dolgu rengi; bilinmiyorsa null. */
export function reactionColorOf(key) {
  if (typeof key !== 'string') return null;
  return REACTIONS.find((r) => r.key === key)?.color || null;
}

/**
 * Ağdan gelen serbest metni beyaz listeye indirger.
 * Geçersiz/boş değer → null (gönderen taraf düşürür, gönderilmez).
 */
export function normalizeReactionKey(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (REACTION_SET.has(lower)) return lower;
  if (LEGACY_ALIASES[raw]) return LEGACY_ALIASES[raw];
  // Sunucu eskiden 8 karakterde kırpıyordu; varyasyon seçici (skin tone, ZWJ)
  // ve kırpılmış legacy emoji aynı ikona indirgenir.
  if (!/\p{Extended_Pictographic}/u.test(raw)) return null;
  for (const [emoji, key] of Object.entries(LEGACY_ALIASES)) {
    if (raw.startsWith(emoji)) return key;
  }
  return null;
}
