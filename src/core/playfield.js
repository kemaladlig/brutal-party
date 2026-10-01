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
 * Harita-ölçeği standartı — oyun başına keyfi ölçek yerine 3 katman.
 * "Harita ne kadar büyük görünüyor" hissi margin'den değil GÖVDE/SAHA
 * oranından gelir (unit varyasyonu ±%7 iken gövde oranı 4 kat geziniyordu).
 * Bantlar 952px referans sahasında YAZILMIŞ tasarım yarıçapıdır; ölçüm
 * kilidi `movementBudget.test.mjs` bölüm B'dedir (her motorun gerçek
 * tasarım yarıçapı atandığı bantta kalmak zorundadır).
 *
 *   normal    beğenilen arena-action grubu (BOMB/HEIST/CROWN/ARCHER/TANKS/
 *             ZONE/NINJA/COLLAPSE/HORDE)
 *   open      küçük gövde + hızlı/niş oyunlar (SNAKE/CURVE)
 *   far       imleç ve görev oyunları (şu an kullanıcısız — bant yerinde durur)
 *
 * Bantlar arası boşluk (16–18, 24–28) kasıtlıdır: sınır sürüklemesi
 * yerine bilinçli tier geçişi yapılsın. İSTİSNALAR: PONG (raydaki raket,
 * serbest gövde değil).
 */
export const FIELD_TIERS = Object.freeze({
  normal: Object.freeze({ minDesignRadius: 28, maxDesignRadius: 36 }),
  open: Object.freeze({ minDesignRadius: 18, maxDesignRadius: 24 }),
  far: Object.freeze({ minDesignRadius: 9, maxDesignRadius: 16 }),
});

/**
 * Kenar boşluğu tarifleri. Her preset saf veridir; motor `if/else` zinciri kurmaz.
 *
 * horizontal / vertical* → `[minPx, oran]`: `max(minPx, floor(eksen * oran))`
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
  // CROWN.
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

function isCompactViewport(width, height) {
  // getDisplayProfile MOBILE'ı `minDim < 540` ile belirler. YATAY = genişlik >
  // yükseklik (portrait'ın tersi; `verticalPortrait` seçimi de bu yönde çalışır).
  return width > height && getDisplayProfile(width, height).type === 'MOBILE';
}

/**
 * UI yerleşimi ve alan payı kararları:
 * arena verilirse `arena.profile.compactLandscape` — payları veren kararın
 * ta kendisi, yani sahne ile HUD aynı eşeğe bakar.
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
 * @param {FieldPresetSpec} spec - FIELD_PRESETS girdisi
 * @param {{top:number,right:number,bottom:number,left:number}} [safe]
 * @param {boolean} [compact]
 */
export function resolveInsets(width, height, spec, safe = ZERO_INSETS, compact = isCompactViewport(width, height)) {
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
 *   insets: { top: number, right: number, bottom: number, left: number },
 *   profile: any
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
    // SAHTE-İKİLİK DÜZELTMESİ: paylar viewport kısa kenarıyla tam-bleed'e
    // geçiyor (`compact`, yukarıda), oysa bu alan arena boyutuna bakıyordu.
    // Yatay yükseklik [476,540) bandındayken arena.top 3 px olduğu hâlde
    // `compactLandscape` false kalıyor ve kontrol kılavuzu sahanın İÇİNE
    // 28 px şerit çiziyordu (AGENTS §8 yasağı). Tek karar, tek kaynak:
    // kompaktlık payı veren yerdir.
    compactLandscape: compact,
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
