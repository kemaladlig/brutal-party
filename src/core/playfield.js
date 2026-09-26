// Tek kaynak: saha (playfield/arena) geometrisi.
//
// Kenarlık hesabı, arena kutusu ve cihazlar arası ölçek katsayısı (`unit`)
// burada yaşar. Motorlar `resize()` içinde margin/arenaW/arenaH hesaplamaz;
// `computePlayfield()` çağırır. `size` ve `left/top/right/bottom` alanları
// bugünkü `arena` sözleşmesinin birebir aynısıdır, bu yüzden motorlar
// kademeli olarak taşınabilir.
//
// Kenar formülü her preset için aynıdır:
//   left/top  = çözülmüş kenar boşlukları
//   width/h   = (opsiyonel tabanlı) saha boyutu
//   right     = left + width,  bottom = top + height
//   cx/cy     = left + width/2, top + height/2
// Simetrik presetlerde bu, mevcut `width/2` + `marginX` formüllerine tam olarak indirgenir.

import { getDisplayProfile, getSafeAreaInsets } from '../ui/tokens.js';

/** Ölçek referansı: mevcut sabitlerin tune edildiği 1920x1080 masaüstü saha kısa kenarı. */
export const FIELD_DESIGN = Object.freeze({
  shortSide: 952,
  minUnit: 0.3,
  maxUnit: 1.6,
});

/**
 * Kenar boşluğu tarifleri. Her preset saf veridir; motor `if/else` zinciri kurmaz.
 *
 * horizontal / vertical* → `[minPx, oran]`: `max(minPx, floor(eksen * oran))`
 * minDimFraction        → kenarlar kısa kenardan türetilir (RACE); floor uygulanmaz
 * fixed                 → kenara eklenen sabit px (RACE üst/alt bant)
 * minSpan               → arena genişlik/yüksekliğine alt sınır (HORDE)
 */
export const FIELD_PRESETS = Object.freeze({
  // Çoğu motor: 4% yatay, 6% / 12% dikey.
  standard: Object.freeze({
    horizontal: Object.freeze([12, 0.04]),
    verticalLandscape: Object.freeze([32, 0.06]),
    verticalPortrait: Object.freeze([48, 0.12]),
  }),
  // HORDE: daha geniş nefes payı, minimum saha boyutu.
  roomy: Object.freeze({
    horizontal: Object.freeze([16, 0.04]),
    verticalLandscape: Object.freeze([34, 0.07]),
    verticalPortrait: Object.freeze([54, 0.12]),
    minSpan: 120,
  }),
  // CROWN (retired).
  crown: Object.freeze({
    horizontal: Object.freeze([16, 0.04]),
    verticalLandscape: Object.freeze([34, 0.065]),
    verticalPortrait: Object.freeze([48, 0.12]),
  }),
  // TANKS: yön farkı yok, her iki durumda da 6%.
  flat: Object.freeze({
    horizontal: Object.freeze([12, 0.04]),
    verticalLandscape: Object.freeze([32, 0.06]),
    verticalPortrait: Object.freeze([32, 0.06]),
  }),
  // ZONE: sıkışık kenar payı.
  dense: Object.freeze({
    horizontal: Object.freeze([8, 0.025]),
    verticalLandscape: Object.freeze([24, 0.045]),
    verticalPortrait: Object.freeze([48, 0.12]),
  }),
  // RACE: kısa kenardan türetilen simetrik pay + sabit üst/alt bant.
  racing: Object.freeze({
    minDimFraction: 0.08,
    fixed: Object.freeze({ top: 30, right: 0, bottom: 20, left: 0 }),
  }),
});

const DEFAULT_PRESET = 'standard';

function resolvePreset(preset) {
  if (typeof preset === 'string') {
    return FIELD_PRESETS[preset] || FIELD_PRESETS[DEFAULT_PRESET];
  }
  return preset && typeof preset === 'object' ? preset : FIELD_PRESETS[DEFAULT_PRESET];
}

function axisInset(spec, extent) {
  if (!Array.isArray(spec)) return 0;
  return Math.max(spec[0], Math.floor(extent * spec[1]));
}

// Telefon yatayda dikey payı sabit 32px yerine cihazın GÜVENLİ ALANINDAN
// türetiriz. Gerekçe: kumanda kuşağı (`gamepad.css` landscape bloğu) yalnızca
// sol-alt/sağ-alt KÖŞELERİ kaplar, orta bant serbest; sabit 32px kısa ekranda
// dikeyin ~%16'sını boşa yiyordu.
//
// Yatay çentik 47-59px (iPhone 15 Pro / Pro Max) ve mevcut 34px yatay
// tahmininden GENİŞTİR. Güvenli alan hesaba katılmazsa oyuncular çentik
// altında doğar/oynar. Dikeyde home indicator ~21px yiyor.
//
// DİKKAT: sadece YATAY. Portrait'taki büyük pay (12%) döndürme istemi ve
// portre kontrol yığınını temizlediği için korunmalıdır.
//
// *_FLOOR: duvar çizgisi (lineWidth 3-4) arena kenarına yaslanır; tam sıfır
// payda yarısı ekran dışına taşar ve "duvar yok" gibi görünür.
const COMPACT_VERTICAL_FLOOR = 3;
const SAFE_AREA_FLOOR = 3;
// RACE kısa kenardan türetilen pay kullanır; telefonda %8 + sabit 30/20 bant
// yüksekliğin %29'unu yiyordu. Kompakt modda pay yarıya iner, sabit bantlar
// (track/HUD çerçevesi) yerinde kalır.
const COMPACT_MIN_DIM_FRACTION = 0.04;

function isCompactViewport(width, height) {
  // getDisplayProfile MOBILE'ı `minDim < 540` ile belirler. YATAY = genişlik >
  // yükseklik (portrait'ın tersi; `verticalPortrait` seçimi de bu yönde çalışır).
  return width > height && getDisplayProfile(width, height).type === 'MOBILE';
}

/**
 * UI yerleşimi ve alan payı kararları:
 * arena verilirse `arena.profile.compactLandscape` (alan-uzayı kararı).
 * genişlik/yükseklik verilirse geriye uyumlu cihaz sınıfı sorgusu.
 */
export function isCompactLandscape(arenaOrWidth, height) {
  if (arenaOrWidth && typeof arenaOrWidth === 'object') {
    if (arenaOrWidth.profile?.compactLandscape !== undefined) {
      return arenaOrWidth.profile.compactLandscape;
    }
    const w = arenaOrWidth.width || 0;
    const h = arenaOrWidth.height || 0;
    const s = arenaOrWidth.size || Math.min(w, h);
    return w > h && (s / FIELD_DESIGN.shortSide) < 0.50;
  }
  return isCompactViewport(arenaOrWidth, height);
}

const ZERO_INSETS = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/**
 * Kenar boşluklarını çözer. Saf fonksiyon: `safe` ve `compact` dışarıdan
 * verilebilir, böylece çentik/home-indicator senaryoları DOM olmadan
 * test edilebilir.
 *
 * @param {number} width
 * @param {number} height
 * @param {object} spec - FIELD_PRESETS girdisi
 * @param {{top:number,right:number,bottom:number,left:number}} [safe]
 * @param {boolean} [compact]
 */
export function resolveInsets(width, height, spec, safe = ZERO_INSETS, compact = isCompactViewport(width, height)) {
  const fixed = spec.fixed || {};
  const minDimFraction = compact && spec.minDimFraction > 0
    ? COMPACT_MIN_DIM_FRACTION
    : spec.minDimFraction;

  if (minDimFraction > 0) {
    const base = Math.min(width, height) * minDimFraction;
    return {
      left: base + (fixed.left || 0),
      right: base + (fixed.right || 0),
      top: base + (fixed.top || 0),
      bottom: base + (fixed.bottom || 0),
    };
  }

  if (!compact) {
    // Güvenli alan yalnız kompakt yatayda anlamlı. Masaüstü/tablet/portrait
    // preset payında kalır ve çentik sorgusu onlarda hiç yapılmaz.
    const presetX = axisInset(spec.horizontal, width);
    const presetY = axisInset(
      height > width ? spec.verticalPortrait : spec.verticalLandscape,
      height,
    );
    return { left: presetX, right: presetX, top: presetY, bottom: presetY };
  }

  // --- kompakt yatay -------------------------------------------------------
  // Yatay: preset payı + çentik. Hangisi büyükse o geçerli.
  const marginX = Math.max(
    axisInset(spec.horizontal, width),
    SAFE_AREA_FLOOR + safe.left,
    SAFE_AREA_FLOOR + safe.right,
  );
  // Dikey kenar AYRI hesaplanır: home indicator yalnız ALT'tadır, üstte
  // notch yoktur. Tek simetrik marj kullanmak ~21px gereksiz kaybettirirdi.
  return {
    left: marginX,
    right: marginX,
    top: Math.max(COMPACT_VERTICAL_FLOOR, SAFE_AREA_FLOOR + safe.top),
    bottom: Math.max(COMPACT_VERTICAL_FLOOR, SAFE_AREA_FLOOR + safe.bottom),
  };
}

/**
 * Kenar boşluklarından saha kutusu + ölçek katsayısı üretir.
 *
 * @param {number} width - CSS px ekran genişliği (canvas.width DEĞİL)
 * @param {number} height - CSS px ekran yüksekliği
 * @param {string|object} [preset] - FIELD_PRESETS anahtarı veya özel tarif
 * @returns {{
 *   left: number, top: number, right: number, bottom: number,
 *   width: number, height: number, cx: number, cy: number,
 *   size: number, aspect: number, unit: number,
 *   insets: { top: number, right: number, bottom: number, left: number }
 * }}
 */
export function computePlayfield(width, height, preset = DEFAULT_PRESET) {
  const spec = resolvePreset(preset);
  const compact = isCompactViewport(width, height);
  // Güvenli alan yalnız kompakt yatayda anlamlı: masaüstünde zaten 0, ve
  // notch sorgusunu her resize'da çalıştırmaya gerek yok.
  const insets = resolveInsets(
    width,
    height,
    spec,
    compact ? getSafeAreaInsets() : ZERO_INSETS,
    compact,
  );

  const minSpan = spec.minSpan || 0;
  const fieldWidth = Math.max(minSpan, width - insets.left - insets.right);
  const fieldHeight = Math.max(minSpan, height - insets.top - insets.bottom);
  const size = Math.min(fieldWidth, fieldHeight);
  const unit = Math.max(
    FIELD_DESIGN.minUnit,
    Math.min(FIELD_DESIGN.maxUnit, size / FIELD_DESIGN.shortSide),
  );
  const profile = Object.freeze({
    shortSide: size,
    unit,
    designShort: FIELD_DESIGN.shortSide,
    compactLandscape: width > height && (size / FIELD_DESIGN.shortSide) < 0.50,
  });

  return {
    left: insets.left,
    top: insets.top,
    width: fieldWidth,
    height: fieldHeight,
    right: insets.left + fieldWidth,
    bottom: insets.top + fieldHeight,
    cx: insets.left + fieldWidth / 2,
    cy: insets.top + fieldHeight / 2,
    size,
    aspect: fieldWidth / fieldHeight,
    unit,
    insets,
    profile,
  };
}

/** Tasarım px → cihaz px. Sahayla birlikte orantılı büyür/küçülür. */
export function fieldPx(playfield, designPx) {
  return designPx * playfield.unit;
}

/**
 * Tasarım px → cihaz px, göreli tabanlı. Taban mutlak px DEĞİLDİR; küçük
 * saha varlığın şişmesini, büyük saha ezilmesini engeller.
 */
export function fieldRadius(playfield, designPx, minFraction = 0) {
  const scaled = designPx * playfield.unit;
  return Math.max(scaled, playfield.size * minFraction);
}

/** Tasarım px/s → cihaz px/s. Gövde küçülürken oyun hissi dekorduğu gibi kalır. */
export function fieldSpeed(playfield, designSpeed) {
  return designSpeed * playfield.unit;
}
