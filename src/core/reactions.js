// Tepki seti — TEK kaynak (istemci + oda sunucusu).
//
// Tel (wire) değeri OS emojisi DEĞİL, kısa bir anahtar metnidir: ağ katmanı
// ASCII'ye bağlı kalsın diye `emoji` alanında `laugh|flame|…` taşınır.
// EKRANDAKİ karşılığı ise gerçek bir emoji glyph'ıdır (`glyph`) — tepki
// balonunun ve seçicinin insan dilinde okunması için (AGENTS §7 istisnası:
// tepki yüzeyi; bkz. AGENTS.md §7 "Tepki yüzeyi istisnası").
// `color`, glyph'ın çıkartma kimliği: balon kenarı + P etiketi rengi.
//
// `normalizeReactionKey` ağdan gelen serbest değeri beyaz listeye indirger;
// eski istemcilerin gönderdiği emojiler (skin tone/varyasyon seçici dahil)
// takma adla aynı anahtara çevrilir.
//
// Anahtar uzunluğu sunucudaki eski 8 karakterlik kırpma sınırına sığar; yeni
// anahtar eklerken `REACTION_KEY_MAX` kontrolü testte kilitlidir.

export const REACTION_KEY_MAX = 8;

export const REACTIONS = Object.freeze([
  Object.freeze({ key: 'laugh', glyph: '😂', labelKey: 'react.laugh', color: '#F2759B' }),
  Object.freeze({ key: 'flame', glyph: '🔥', labelKey: 'react.flame', color: '#F2782C' }),
  Object.freeze({ key: 'skull', glyph: '💀', labelKey: 'react.skull', color: '#9AA5B5' }),
  Object.freeze({ key: 'heart', glyph: '❤️', labelKey: 'react.heart', color: '#E5474F' }),
  Object.freeze({ key: 'star', glyph: '⭐', labelKey: 'react.star', color: '#FFC53D' }),
  Object.freeze({ key: 'crown', glyph: '👑', labelKey: 'react.crown', color: '#E8A33D' }),
  Object.freeze({ key: 'zap', glyph: '⚡', labelKey: 'react.zap', color: '#3B4EDE' }),
  Object.freeze({ key: 'ghost', glyph: '👻', labelKey: 'react.ghost', color: '#AA9BF0' }),
  Object.freeze({ key: 'kiss', glyph: '💋', labelKey: 'react.kiss', color: '#E0486D' }),
  Object.freeze({ key: 'thumbsup', glyph: '👍', labelKey: 'react.thumbsup', color: '#2FA66E' }),
  Object.freeze({ key: 'cry', glyph: '😢', labelKey: 'react.cry', color: '#5B8DEF' }),
  Object.freeze({ key: 'sleepy', glyph: '😴', labelKey: 'react.sleepy', color: '#7D5CE6' }),
]);

export const REACTION_KEYS = Object.freeze(REACTIONS.map((r) => r.key));

const REACTION_SET = new Set(REACTION_KEYS);
const GLYPHS = new Map(REACTIONS.map((r) => [r.key, r.glyph]));

// Eski istemci uyumu: ham emojiyi gönderen sürümler aynı anahtara düşer.
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

/** Ekrana basılacak gerçek emoji; bilinmiyorsa boş string. */
export function reactionGlyph(key) {
  return GLYPHS.get(key) || '';
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
  // ve kırpılmış legacy emoji aynı anahtara indirgenir.
  if (!/\p{Extended_Pictographic}/u.test(raw)) return null;
  for (const [emoji, key] of Object.entries(LEGACY_ALIASES)) {
    if (raw.startsWith(emoji)) return key;
  }
  return null;
}
