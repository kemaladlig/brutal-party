// Tepki seti — TEK kaynak (istemci + oda sunucusu).
//
// Wire değeri OS emojisi DEĞİL, `tabletopIcons` ikon anahtarıdır (AGENTS §7):
// platforma göre değişen ve deterministik olmayan ham emojiler buraya giremez.
// `normalizeReactionKey` ağdan gelen değeri beyaz listeye indirger; eski
// istemcilerin gönderdiği emojiler takma adla aynı anahtara çevrilir.
//
// Anahtar uzunluğu sunucudaki eski 8 karakterlik kırpma sınırına sığar; yeni
// anahtar eklerken `REACTION_KEY_MAX` kontrolü testte kilitlidir.

export const REACTION_KEY_MAX = 8;

export const REACTIONS = Object.freeze([
  Object.freeze({ key: 'laugh', labelKey: 'react.laugh' }),
  Object.freeze({ key: 'flame', labelKey: 'react.flame' }),
  Object.freeze({ key: 'skull', labelKey: 'react.skull' }),
  Object.freeze({ key: 'heart', labelKey: 'react.heart' }),
  Object.freeze({ key: 'star', labelKey: 'react.star' }),
  Object.freeze({ key: 'crown', labelKey: 'react.crown' }),
  Object.freeze({ key: 'zap', labelKey: 'react.zap' }),
  Object.freeze({ key: 'ghost', labelKey: 'react.ghost' }),
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
});

export const DEFAULT_REACTION = 'flame';

export function isReactionKey(value) {
  return typeof value === 'string' && REACTION_SET.has(value);
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
