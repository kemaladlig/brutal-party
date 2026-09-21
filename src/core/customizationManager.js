// Brutal Party — Karakter Özelleştirme Veri Yöneticisi
// Cihaz-başı TEK profil: kullanıcı kendini bir kere belirler, oturduğu her
// koltukta aynı karakter görünür (kumanda kendi profilini relay ile host'a taşır).
// Renkler, yüz ifadeleri, aksesuarlar ve gövde desenleri için tek gerçek kaynak.

import { safeGet, safeSet, safeRemove } from './safeStorage.js';

export const AVATAR_PALETTES = [
  { id: 'red', name: 'KIRMIZI', hex: '#D84727', border: '#1A1A1A' },
  { id: 'blue', name: 'MAVİ', hex: '#1D5D8A', border: '#1A1A1A' },
  { id: 'yellow', name: 'SARI', hex: '#D99B26', border: '#1A1A1A' },
  { id: 'green', name: 'YEŞİL', hex: '#2F6A4F', border: '#1A1A1A' },
  { id: 'purple', name: 'SİBER MOR', hex: '#7928CA', border: '#1A1A1A' },
  { id: 'orange', name: 'NEON TURUNCU', hex: '#FF5722', border: '#1A1A1A' },
  { id: 'mint', name: 'NANE ZÜMRÜT', hex: '#00B894', border: '#1A1A1A' },
  { id: 'carbon', name: 'KARBON', hex: '#2D3436', border: '#1A1A1A' },
  { id: 'pink', name: 'PUNK PEMBE', hex: '#E84393', border: '#1A1A1A' },
  { id: 'cyan', name: 'BUZ MAVİSİ', hex: '#0984E3', border: '#1A1A1A' },
];

// ── Renk körü güvenli palet (Okabe-Ito, protanopi/deuteranopi dostu) ──
// Kırmızı-yeşil çifti yoktur; ayırt edicilik renk + isim etiketiyle sağlanır.
export const COLORBLIND_PALETTES = [
  { id: 'cb-orange', name: 'TURUNCU', hex: '#E69F00', border: '#1A1A1A' },
  { id: 'cb-sky', name: 'GÖK MAVİSİ', hex: '#56B4E9', border: '#1A1A1A' },
  { id: 'cb-teal', name: 'CAMGÖBEĞİ', hex: '#009E73', border: '#1A1A1A' },
  { id: 'cb-yellow', name: 'AÇIK SARI', hex: '#F0E442', border: '#1A1A1A' },
  { id: 'cb-blue', name: 'KOYU MAVİ', hex: '#0072B2', border: '#1A1A1A' },
  { id: 'cb-vermillion', name: 'KIZIL', hex: '#D55E00', border: '#1A1A1A' },
  { id: 'cb-purple', name: 'LEYLAK', hex: '#CC79A7', border: '#1A1A1A' },
  { id: 'cb-grey', name: 'GRİ', hex: '#999999', border: '#1A1A1A' },
  { id: 'cb-black', name: 'SİYAH', hex: '#222222', border: '#F4F4F0' },
  { id: 'cb-white', name: 'BEYAZ', hex: '#F4F4F0', border: '#1A1A1A' },
];

const COLORBLIND_KEY = 'brutalparty.colorblind';

// Renk körü modu açık mı? (safeStorage: gizli modda oturum içi bellekte yaşar)
export function isColorblindEnabled() {
  return safeGet(COLORBLIND_KEY) === '1';
}

export function setColorblindEnabled(on) {
  safeSet(COLORBLIND_KEY, on ? '1' : '0');
}

// Aktif palet: renk körü modu açıksa Okabe-Ito, değilse klasik.
// Izgaralar + rastgele atamalar buradan beslenir; kayıtlı renkler her iki
// palet birleşiminde de geçerli sayılır (mod değişimi profili bozmaz).
export function getActivePalettes() {
  return isColorblindEnabled() ? COLORBLIND_PALETTES : AVATAR_PALETTES;
}

export const AVATAR_EXPRESSIONS = [
  { id: 'FOCUS', name: 'Odaklı', icon: '👀', desc: 'Klasik keskin bakışlar' },
  { id: 'SHADES', name: 'Gözlük', icon: '🕶️', desc: 'Neo-brutalist güneş gözlüğü' },
  { id: 'ANGRY', name: 'Öfkeli', icon: '😠', desc: 'Rekabetçi çatık kaşlar' },
  { id: 'WINK', name: 'Göz Kırp', icon: '😉', desc: 'Neşeli göz kırpma' },
  { id: 'CYBORG', name: 'Sayborg', icon: '🤖', desc: 'Neon siber vizör' },
  { id: 'CYCLOPS', name: 'Tepegöz', icon: '👁️', desc: 'Dev tek göz' },
  { id: 'DERP', name: 'Çılgın', icon: '🤪', desc: 'Eğlenceli şaşkın bakış' },
];

export const AVATAR_ACCESSORIES = [
  { id: 'NONE', name: 'Sade', icon: '⚪', desc: 'Aksesuar yok' },
  { id: 'HEADBAND', name: 'Bandana', icon: '🥋', desc: 'Savaşçı saç bandı' },
  { id: 'CAP', name: 'Şapka', icon: '🧢', desc: 'Geriye takılı sokak şapkası' },
  { id: 'HEADPHONES', name: 'Kulaklık', icon: '🎧', desc: 'DJ stüdyo kulaklığı' },
  { id: 'HORNS', name: 'Boynuz', icon: '😈', desc: 'Viking / Şeytan boynuzları' },
  { id: 'MINI_CROWN', name: 'Mini Taç', icon: '👑', desc: 'Altın asil taç' },
  { id: 'NINJA_COWL', name: 'Ninja', icon: '🥷', desc: 'Karanlık kukuleta' },
  { id: 'BANDIT_MASK', name: 'Maske', icon: '🎭', desc: 'Haydut göz maskesi' },
];

export const AVATAR_PATTERNS = [
  { id: 'SOLID', name: 'Düz', icon: '⬛', desc: 'Saf neo dolgu' },
  { id: 'STRIPE', name: 'Çizgili', icon: '🏁', desc: 'Sportif yarış çizgisi' },
  { id: 'DUAL', name: 'Çift Ton', icon: '🌗', desc: 'İki renkli bölünmüş gövde' },
  { id: 'TARGET', name: 'Hedef', icon: '🎯', desc: 'İç içe halka deseni' },
];

// ── Whitelist kümeleri (relay/sunucu validasyonu + sanitize tek kaynaktan) ──
// Her iki paletin birleşimi: mod değişiminde eski kayıtlı renk geçersiz sayılmaz.
const PALETTE_HEX = new Set([
  ...AVATAR_PALETTES.map((p) => p.hex.toUpperCase()),
  ...COLORBLIND_PALETTES.map((p) => p.hex.toUpperCase()),
]);
const EXPRESSION_IDS = new Set(AVATAR_EXPRESSIONS.map((e) => e.id));
const ACCESSORY_IDS = new Set(AVATAR_ACCESSORIES.map((a) => a.id));
const PATTERN_IDS = new Set(AVATAR_PATTERNS.map((p) => p.id));

// ── Tek profil kalıcılığı ──
const PROFILE_KEY = 'brutalparty.avatar.profile';
const LEGACY_PREFIX = 'brutalparty.avatar.slot_';

function defaultFace() {
  return { expression: 'FOCUS', accessory: 'NONE', pattern: 'SOLID' };
}

// Rastgele karakter zarı: renk dışı tüm yüz öğelerini listelerden seçer.
// (reset butonu + ilk kurulum fallback'i kullanır; kayıtlı profillere dokunmaz.)
function randomFace() {
  const pick = (arr) => arr[(Math.random() * arr.length) | 0].id;
  return {
    expression: pick(AVATAR_EXPRESSIONS),
    accessory: pick(AVATAR_ACCESSORIES),
    pattern: pick(AVATAR_PATTERNS),
  };
}

export function randomAvatarColor(excludeHexes = []) {
  const taken = new Set((excludeHexes || []).map((h) => String(h || '').toUpperCase()));
  const palettes = getActivePalettes();
  const free = palettes.filter((p) => !taken.has(p.hex.toUpperCase()));
  const pool = free.length > 0 ? free : palettes;
  return pool[Math.floor(Math.random() * pool.length)].hex;
}

// Eski 4-slot kayıtlarından tek profile migrasyon (bir kez).
function migrateLegacyProfile() {
  try {
    if (safeGet(PROFILE_KEY)) return;
    const raw = safeGet(`${LEGACY_PREFIX}0`);
    if (raw) {
      const parsed = JSON.parse(raw);
      const clean = sanitizeAvatar(parsed, { keepColor: true });
      safeSet(PROFILE_KEY, JSON.stringify(clean));
    }
  } catch {}
  for (let i = 0; i < 4; i++) safeRemove(`${LEGACY_PREFIX}${i}`);
}

// Bu cihazın tek karakter profili. İlk açılışta rastgele renk üretilir —
// her yeni cihaz farklı renkle gelir, herkes varsayılan kırmızıda buluşmaz.
export function getAvatarProfile() {
  migrateLegacyProfile();
  const fallback = { color: randomAvatarColor(), ...randomFace() };
  try {
    const raw = safeGet(PROFILE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return sanitizeAvatar(parsed, { keepColor: true, fallbackColor: fallback.color });
    }
    safeSet(PROFILE_KEY, JSON.stringify(fallback));
  } catch {}
  return { ...fallback };
}

export function saveAvatarProfile(profile) {
  const clean = sanitizeAvatar(profile, { keepColor: true });
  safeSet(PROFILE_KEY, JSON.stringify(clean));
  try {
    window.dispatchEvent(new CustomEvent('brutal_customization_changed', {
      detail: { customization: clean },
    }));
  } catch {}
  return clean;
}

export function resetAvatarProfile() {
  const def = { color: randomAvatarColor(), ...randomFace() };
  return saveAvatarProfile(def);
}

// ── Validasyon / sanitizasyon (istemci + relay + sunucu ortak) ──
// Bozuk/kötü niyetli avatar hosta ulaşmadan temizlenir; sonuç her zaman geçerlidir.
export function sanitizeAvatar(input, opts = {}) {
  const src = (input && typeof input === 'object') ? input : {};
  const rawColor = String(src.color || '').toUpperCase();
  // Kanonik hex: önce aktif palette, yoksa diğer palette ara (mod değişimi
  // kayıtlı rengi bozmaz; iki palet de whitelist'tedir).
  const known = [...AVATAR_PALETTES, ...COLORBLIND_PALETTES]
    .find((p) => p.hex.toUpperCase() === rawColor);
  const color = known
    ? known.hex
    : (opts.keepColor && PALETTE_HEX.has(String(opts.fallbackColor || '').toUpperCase())
      ? opts.fallbackColor
      : randomAvatarColor());
  const expression = EXPRESSION_IDS.has(src.expression) ? src.expression : 'FOCUS';
  const accessory = ACCESSORY_IDS.has(src.accessory) ? src.accessory : 'NONE';
  const pattern = PATTERN_IDS.has(src.pattern) ? src.pattern : 'SOLID';
  return { color, expression, accessory, pattern };
}

export function isPaletteHex(hex) {
  return PALETTE_HEX.has(String(hex || '').toUpperCase());
}

// Alınmış renkler dışında rastgele boş renk (lobi hızlı atama + yeni katılım).
export function pickFreeColor(takenHexes = []) {
  return randomAvatarColor(takenHexes);
}

// 4 koltukluk renk dizisindeki çakışan indisler (boş koltuklar atlanır).
// Sert engel + ⚠️ uyarısı bu kümeye bakar.
export function findDuplicateColorIndices(colors4) {
  const seen = new Map();
  const dups = new Set();
  (colors4 || []).forEach((c, i) => {
    if (!c) return;
    const key = String(c).toUpperCase();
    if (seen.has(key)) {
      dups.add(seen.get(key));
      dups.add(i);
    } else {
      seen.set(key, i);
    }
  });
  return dups;
}

// ── LOCAL koltuk renkleri (tek cihaz, kalıcı) ──
// Tek cihazda 4 koltuk aynı cihaz profilini paylaşır; ayırt edicilik için her
// koltuğun display rengi ayrı tutulur. Relay modlarını etkilemez.
const LOCAL_SEAT_KEY = 'brutalparty.local.seatColors';

function readLocalSeatColors() {
  try {
    const raw = safeGet(LOCAL_SEAT_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return [0, 1, 2, 3].map((i) => (
          typeof arr[i] === 'string' && PALETTE_HEX.has(arr[i].toUpperCase()) ? arr[i].toUpperCase() : null
        ));
      }
    }
  } catch {}
  return [null, null, null, null];
}

let localSeatCache = null;

export function getLocalSeatColors() {
  if (!localSeatCache) localSeatCache = readLocalSeatColors();
  return [...localSeatCache];
}

export function setLocalSeatColor(slotIndex, hex) {
  if (slotIndex < 0 || slotIndex > 3 || !isPaletteHex(hex)) return null;
  if (!localSeatCache) localSeatCache = readLocalSeatColors();
  localSeatCache[slotIndex] = String(hex).toUpperCase();
  safeSet(LOCAL_SEAT_KEY, JSON.stringify(localSeatCache));
  return localSeatCache[slotIndex];
}

// Palet sırasında diğer koltukların almadığı ilk boş renk (deterministik tur).
export function nextFreeLocalColor(slotIndex) {
  if (!localSeatCache) localSeatCache = readLocalSeatColors();
  const taken = new Set(
    localSeatCache.filter((c, i) => c && i !== slotIndex).map((c) => c.toUpperCase())
  );
  const palettes = getActivePalettes();
  const free = palettes.find((p) => !taken.has(p.hex.toUpperCase()));
  return (free || palettes[slotIndex % palettes.length]).hex;
}

// Kayıt defterine LOCAL avatarını yaz (yüz = cihaz profili, renk = koltuk rengi).
export function applyLocalSeatToRegistry(slotIndex, hex) {
  let profile = null;
  try { profile = getAvatarProfile(); } catch { profile = defaultFace(); }
  setSlotAvatar(slotIndex, { ...(profile || {}), color: hex });
}

// Rengi yoksa ata (koltuk insan olduğunda çağrılır); her zaman geçerli hex döner.
export function ensureLocalSeatColor(slotIndex) {
  if (!localSeatCache) localSeatCache = readLocalSeatColors();
  let hex = localSeatCache[slotIndex];
  if (!hex || !isPaletteHex(hex)) {
    hex = nextFreeLocalColor(slotIndex);
    setLocalSeatColor(slotIndex, hex);
  }
  applyLocalSeatToRegistry(slotIndex, hex);
  return hex;
}

// Noktaya dokununca: sıradaki boş renge geçir (persist + registry).
export function cycleLocalSeatColor(slotIndex) {
  if (!localSeatCache) localSeatCache = readLocalSeatColors();
  const taken = new Set(
    localSeatCache.filter((c, i) => c && i !== slotIndex).map((c) => c.toUpperCase())
  );
  const current = (localSeatCache[slotIndex] || '').toUpperCase();
  const palettes = getActivePalettes();
  let startIdx = palettes.findIndex((p) => p.hex.toUpperCase() === current);
  for (let step = 1; step <= palettes.length; step++) {
    const cand = palettes[(startIdx + step) % palettes.length];
    if (!taken.has(cand.hex.toUpperCase())) {
      setLocalSeatColor(slotIndex, cand.hex);
      applyLocalSeatToRegistry(slotIndex, cand.hex);
      return cand.hex;
    }
  }
  return localSeatCache[slotIndex];
}

// LOCAL oturum girişi: kayıtlı renkleri deftere yükle, renksizleri profile düşür.
export function loadLocalSeatColors() {
  if (!localSeatCache) localSeatCache = readLocalSeatColors();
  for (let i = 0; i < 4; i++) {
    if (localSeatCache[i]) applyLocalSeatToRegistry(i, localSeatCache[i]);
    else clearSlotAvatar(i);
  }
}

// LOCAL lobi/hükmen insan koltukları: renksiz kalanlara boş renk ata.
export function ensureLocalSeatColorsForTypes(slotTypes) {
  if (!Array.isArray(slotTypes)) return;
  const isHumanLike = (t) => !!t && !['empty', 'bot', 'bot_normal', 'bot_god'].includes(t);
  for (let i = 0; i < 4; i++) {
    if (isHumanLike(slotTypes[i])) ensureLocalSeatColor(i);
  }
}

// ── Koltuk avatar kayıt defteri (bellek içi, host tarafı) ──
// TV host: relay'den gelen her koltuğun avatarı burada durur; renderer buradan okur.
// LOCAL modda kayıt boştur → renderer cihaz profiline düşer (4 koltuk aynı yüz,
// renk+pip+koltuk pozisyonu ayırt eder; renk engeli LOCAL'de uygulanmaz).
const slotAvatarRegistry = [null, null, null, null];

export function setSlotAvatar(slotIndex, avatar) {
  if (slotIndex < 0 || slotIndex > 3) return;
  slotAvatarRegistry[slotIndex] = avatar ? { ...avatar } : null;
  try {
    window.dispatchEvent(new CustomEvent('brutal_slot_avatar_changed', {
      detail: { slotIndex },
    }));
  } catch {}
}

export function getSlotAvatar(slotIndex) {
  if (slotIndex < 0 || slotIndex > 3) return null;
  return slotAvatarRegistry[slotIndex];
}

export function clearSlotAvatar(slotIndex) {
  setSlotAvatar(slotIndex, null);
}

// ── Geriye uyumluluk: koltuk-bazlı okuma artık cihaz profiline + kayıt defterine düşer ──
export function getSlotCustomization(slotIndex) {
  const safeIdx = Math.max(0, Math.min(3, slotIndex || 0));
  return getSlotAvatar(safeIdx) || getAvatarProfile();
}

export function saveSlotCustomization(slotIndex, custom) {
  const safeIdx = Math.max(0, Math.min(3, slotIndex || 0));
  const clean = sanitizeAvatar(custom, { keepColor: true });
  setSlotAvatar(safeIdx, clean);
  return clean;
}

export function resetSlotCustomization(slotIndex) {
  const safeIdx = Math.max(0, Math.min(3, slotIndex || 0));
  const clean = { color: randomAvatarColor(), ...randomFace() };
  setSlotAvatar(safeIdx, clean);
  return { ...clean };
}

// Koltuk display renkleri üzerinden çakışma hesabı (hostPlayerSlots benzeri
// {name,isReady,kind,avatar,displayColor} dizisi alır).
export function findSlotColorDuplicates(slots4) {
  const colors = (slots4 || []).map((s) => {
    if (!s || s.kind === 'bot' || s.kind === 'bot_god') return null;
    return s.displayColor || s.avatar?.color || s.color || null;
  });
  return findDuplicateColorIndices(colors);
}
