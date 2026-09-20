// Brutal Party — Karakter Özelleştirme Veri Yöneticisi
// Renkler, yüz ifadeleri, aksesuarlar ve gövde desenleri için tek gerçek kaynak.
// LocalStorage kalıcılığı + 4 slot için varsayılan profiller.

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

// 4 koltuk için varsayılan kimlikler
export const DEFAULT_SLOT_CUSTOMIZATIONS = [
  { color: '#D84727', expression: 'FOCUS', accessory: 'HEADBAND', pattern: 'SOLID' },
  { color: '#1D5D8A', expression: 'SHADES', accessory: 'CAP', pattern: 'STRIPE' },
  { color: '#D99B26', expression: 'ANGRY', accessory: 'HEADPHONES', pattern: 'SOLID' },
  { color: '#2F6A4F', expression: 'WINK', accessory: 'HORNS', pattern: 'DUAL' },
];

const STORAGE_PREFIX = 'brutalparty.avatar.slot_';

export function getSlotCustomization(slotIndex) {
  const safeIdx = Math.max(0, Math.min(3, slotIndex || 0));
  const fallback = DEFAULT_SLOT_CUSTOMIZATIONS[safeIdx];
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${safeIdx}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        color: parsed.color || fallback.color,
        expression: parsed.expression || fallback.expression,
        accessory: parsed.accessory || fallback.accessory,
        pattern: parsed.pattern || fallback.pattern,
      };
    }
  } catch {}
  return { ...fallback };
}

export function saveSlotCustomization(slotIndex, custom) {
  const safeIdx = Math.max(0, Math.min(3, slotIndex || 0));
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${safeIdx}`, JSON.stringify(custom));
    // Özel event yayınla (dinleyen motorlar ve UI hemen güncellensin)
    window.dispatchEvent(new CustomEvent('brutal_customization_changed', {
      detail: { slotIndex: safeIdx, customization: custom }
    }));
  } catch {}
}

export function resetSlotCustomization(slotIndex) {
  const safeIdx = Math.max(0, Math.min(3, slotIndex || 0));
  const def = DEFAULT_SLOT_CUSTOMIZATIONS[safeIdx];
  saveSlotCustomization(safeIdx, def);
  return { ...def };
}
