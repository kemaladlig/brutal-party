// Ortak saha görsel kiti — zemin, ızgara, motif, dekor, duvar bandı TEK yerden.
//
// Neden var: her motor her frame zemin dolgusu + ızgara + duvar konturunu yeniden
// raster ediyordu (HORDE ~40 stroke, PONG ~20, BOMB ~15). World-view client'ları
// bunu 60 Hz interpolasyonla telefonun üzerinde ödüyordu. Burada statik saha
// katmanı bir kez offscreen canvas'a PİŞİRİLİR, frame başına tek `drawImage`
// (GPU blit) yapılır.
//
// AĞ BÜTÇESİ: bu modül HİÇBİR paket alanı eklemez. Katman yalnızca (mode,
// arena kutusu, theme, seed) bilgisinden türer; `mode` ve `roundId` zaten 30 Hz
// world packet'inde vardır, seed onlardan hash'lenir. Bu yüzden host ve client
// aynı dekoru AĞ YOKKEN aynı görür ve `isValid*WorldFrame` doğrulayıcıları
// dokunulmadan kalır.
//
// DETERMİNİZM KURALI: katman içinde `Math.random()`, `Date.now()` ve
// `performance.now()` YASAKTIR. Rastgelelik yalnız `seed`ten türeyen PRNG'den
// gelir; aksi halde her cihaz farklı dekor çizer ve cache her frame geçersiz
// olur.
//
// ÖLÇEK KURALI: ham px yazılmaz; tüm ölçüler `arena.unit` (`playfield.unit`,
// saha içi ölçeğin tek otoritesi) veya `fieldPx`/`fieldRadius` türevleridir.
//
// Renkler burada, `arenaKit.js`'teki `OBSTACLE_STYLES`/`PICKUP_META` gibi, saha
// paleti olarak yaşar: bunlar canvas dünyasının verisi, DOM çözüğü değil.
// Tema kimliği (`accent`) HORDE tarafından da okunduğu için tema sözleşmesi
// `floor/grid/accent/motif` alanlarını korur.

import { FIELD_DESIGN, fieldPx, fieldRadius } from './playfield.js';

// ---------------------------------------------------------------------------
// Tema kayıt defteri
// ---------------------------------------------------------------------------

/**
 * Ortak zemin dili: her tema bu alanların TAMAMINI taşır.
 *
 * KREM BÜTÇESİ (sert kural, `tests/fieldKit.test.mjs` kilitler): tabanın her
 * noktası L* ∈ [80, 97] aralığında kalır ve `floorHigh↔floorLow` farkı ΔL* ≤ 18.
 * Varlıklar `#1A1A1A` konturlu (L* ≈ 10) olduğundan bu bütçe sahanın HER yerinde
 * ~70 puanlık kontrast bırakır. Zemin koyulaştırarak ayrışma ARANMAZ — o iş
 * varlığın altındaki temas gölgesinin işidir (bkz. arenaKit/avatarInGame).
 *
 * SAYISAL ALANLAR: `lightPool`/`wallT`/`seams`/`decals`/`textureAlpha` gibi
 * alanlar ilkel tiptedir. Nested nesne YAZILAMAZ: `HORDE_MAPS` temaları
 * `{...FIELD_THEMES.foundry}` şeklinde SIZ YAYILIMLA türetir (hordeConfig.js),
 * paylaşılan bir alt-nesne üç haritada aynı referansı taşır ve `Object.freeze`
 * onu dondurmaz.
 */
const THEME_BASE = Object.freeze({
  // --- zemin ---
  // ÖLÇÜLMÜŞ KISIT (rebrand'in en önemli bulgusu): krem ailesi o kadar parlak
  // ki İŞIK şiddetiyle derinlik satın alınamaz. P3 sarısı #FFD24A L* = 85.93;
  // tabanı ondan ayıran bütçe ~6 puan. `floorLow` #E6DDCC (L* 88.4) + vignette
  // + duvar gölge bandı sahanın alt yarısında ölçilen zemini L* 85.9'a indirip
  // sarıyla kontrastı SIFIRA düşürdü (kullanıcı "daha iyi iş yapabiliriz" derken
  // bu tuzağın kendisiydi). Bu yüzden rampa ŞIKLIK/kroma ile kurulur, L* ile
  // değil: üst soluk ve soğuğa yakın, alt belirgin sıcak — kroma farkı malzeme
  // ve derinlik okur, L* farkı sarıyı yer.
  //
  // TAVAN: `floorHigh` L* ≤ 97.5 (üstü "bembeyaz"ın ta kendisi), taban L* ≥ 92.5
  // (boyanın +1.5 puanlık gölgeleme payıyla sarının üstünde kalır).
  floor: '#F8F2E7',            // taban krem (orta ton, L* 95.7)
  floorHigh: '#FBF6EC',        // ışık gelen üst bölge (L* 97.0)
  floorEdge: '#F3EBDA',        // orta-üst geçiş durakı (L* 93.3)
  floorLow: '#F2E9D8',         // en alt — aynı parlaklıkta, daha sıcak (L* 92.6)
  lightPool: 0.58,              // 0..1 — üst-sol ışık havuzunun şiddeti
  // Işığın RENGİ. Varsayılan nötr beyaz; tema hue'si verirse havuz o renkle
  // yanar ve saha "boyanmış kâğıt" değil, "içinden ışık geçen bir yüzey"
  // okur. `lightTint`/`edgeTint`/`shadeTint` sayısal değil, rgba metnidir —
  // böylece tema yazarken alpha'yı tek yerde görürsün (THEME_FIELDS sözleşmesi
  // ilkel tiplerle sınırlıdır, nested nesne yazılamaz).
  lightTint: '255, 255, 255',  // ışık havuzunun RGB'si
  lightAlpha: 0.72,             // havuz tepe opaklığı (× lightPool)
  // Vinyet ve duvar gölgesi nötr siyah yerine tema renginde: köşeler soğumak
  // yerine oyunun rengine döner, zemin tek parça krem gibi okunmaz.
  edgeTint: '26, 26, 26',      // vinyet / köşe kararması RGB'si
  shadeTint: '26, 26, 26',     // duvar gölge bandı RGB'si
  grid: 'rgba(26, 26, 26, 0.05)',
  gridStyle: 'dots',           // 'dots' | 'crosshair' | 'court' | 'lines' | 'none'
  frame: 'rgba(26, 26, 26, 0.10)',  // iç çerçeve hairline
  // --- yüzey dokusu (tek seferlik bake, sonra 2 op) ---
  // Varsayılan `speckle`: hiçbir yön/kafes kurmadığı için oyun nesneleriyle
  // anlam çakışması olmayan tek reçete. Yönü olan dokular opt-in.
  texture: 'speckle',          // 'none' | 'weave' | 'speckle' | 'plate' | 'tile'
  textureAlpha: 0.4,           // 0..1 — desenin üstüne bindirilmesi
  seams: 2,                    // 0..4 — tam-genişlik derz çizgisi
  // --- kimlik ---
  accent: '#D84727',
  motif: 'rings',
  corners: 'plate',            // 'plate' | 'crosshair' | 'both' | 'none'
  cornerInk: '#2B2B28',
  // --- tepsi kenarı (SİYAH ÇERÇEVE YOK) ---
  // Kullanıcı raporu: "köşeler simsiyah çerçeve, sert köşeli". Koyu kontur ve
  // kütleli bant kalktı; sahanın sınırı artık üç şeyle okunur: yuvarlatılmış
  // tepsi kesimi, tek ince iç gölge çizgisi ve `paintBackdrop`'un arenanın
  // arkasına düşürdüğü gölge. Yani sınır bilgisi boya şeridinden değil,
  // derinlikten gelir.
  edgeInk: 'rgba(26, 26, 26, 0.16)',      // tepsi iç duvarı
  edgeLight: 'rgba(255, 255, 255, 0.6)',  // pahlı kenarın ışık çizgisi
  trayR: 18,                              // tasarım px; saha ölçeğiyle büyür
  // Sağ/alt iç gölge (ışık sol-üstten). Bu bant zeminden L* yer; alt kenarda
  // zemin rampasıyla AYNI bütçeyi iki kez yememesi için düşük tutulur — 0.15
  // iken sahanın alt bandında P3 sarısıyla ölçülen fark 3.6'ya iniyordu.
  wallShade: 'rgba(26, 26, 26, 0.11)',
  // --- dekor ---
  decal: 'rgba(26, 26, 26, 0.055)',
  decals: 1,                   // 0..2 dekor yoğunluğu çarpanı
  // --- motorun kendi yüzeyi (arenaKit.drawObstacle bu deriyi seçer) ---
  block: 'stone',
  // --- sahanın dışı (paintBackdrop) ---
  // Ekranın tamamını oyunun zemin rengine boğmak yerine derin koyu konsol masası
  // (--surface: #14101F). Böylece ortadaki oyun alanı spot ışığında parlayan bir arena olur.
  backdrop: '#14101F',
  backdropInk: '#0D0A14',
});

/** Tema sözleşmesinin anahtarları — testler bu listeyi enumerate eder. */
export const THEME_FIELDS = Object.freeze(Object.keys(THEME_BASE));

function theme(overrides) {
  return Object.freeze({
    ...THEME_BASE,
    ...overrides,
  });
}

/**
 * `mode` (ya da tema kimliği) → tema. Tanımsız oyunlar ortak krem saha diline
 * düşer; böylece yeni oyun eklemek burada tek satır.
 */
/**
 * `mode` (ya da tema kimliği) → tema. Tanımsız oyunlar ortak krem saha diline
 * düşer; böylece yeni oyun eklemek burada tek satır.
 *
 * OYUN BAŞINA HUE, AYNI PARLAKLIK (kullanıcı kararı: "hâlâ rengi beyaz").
 * Her tema DÖRT zemin durağı taşır ve hepsi CIE L\* ∈ [92.7, 97.3] içinde,
 * aralık ≤ 5 — `tests/fieldKit.test.mjs §8` bunu palette üzerinde zorlar.
 * Neden bu kadar dar: P3 sarısı #FFD24A L\* = 85.9. Tabanı ondan ayıran toplam
 * bütçe ~7 puan. Bu yüzden derinlik L\* ile DEĞİL, hue/kroma ile kurulur:
 * BOMB kiremit, TANKS adaçayı, LASER mavi-gri, HORDE 'core' menekşe — hepsi
 * aynı parlaklıkta, hiçbiri sarıya basmıyor.
 *
 * Sıcak tonlar sistemik olarak koyulaşır (kiremit/amber L\*'ı düşürür):
 * değerler beyaza harmanlanarak bütçeye çekildi, hue korunarak.
 */
export const FIELD_THEMES = Object.freeze({
  default: theme({
    accent: '#1D5D8A',
    lightTint: '255, 244, 222',
    edgeTint: '46, 38, 30',
    shadeTint: '46, 38, 30',
  }),

  // PONG — soğuk buz mavisi kort.
  PONG: theme({
    lightTint: '200, 230, 255',
    edgeTint: '20, 60, 140',
    shadeTint: '20, 60, 140',
    floorHigh: '#E8F4FF', floor: '#DAEEFF', floorEdge: '#C8E4FA', floorLow: '#BAD8F5', accent: '#1D4ED8',
    grid: 'rgba(26, 26, 26, 0.055)',
    gridStyle: 'court',
    frame: 'rgba(26, 26, 26, 0.13)',
    motif: 'rings',
    corners: 'both',
    texture: 'tile',
    seams: 3,
  }),

  // BOMB — sıcak mercan/turuncu. Patlama enerjisi.
  BOMB: theme({
    accent: '#C2410C', motif: 'spark',    lightTint: '255, 170, 80',
    edgeTint: '100, 40, 10',
    shadeTint: '100, 40, 10',
    floorHigh: '#FFE2C4', floor: '#FFD4A0', floorEdge: '#FFC488', floorLow: '#FFB874',
    grid: 'rgba(26, 26, 26, 0.06)',
    gridStyle: 'crosshair',
    frame: 'rgba(26, 26, 26, 0.11)',
    decal: 'rgba(43, 43, 40, 0.06)',
    block: 'crate',
    texture: 'weave',
  }),

  // TANKS — çayır yeşili. Savaş meydanı çim.
  TANKS: theme({
    lightTint: '140, 220, 100',
    edgeTint: '30, 80, 30',
    shadeTint: '30, 80, 30',
    floorHigh: '#D4F0C4', floor: '#BEEAAA', floorEdge: '#A8DE90', floorLow: '#94D278', accent: '#3F6212',
    grid: 'rgba(26, 26, 26, 0.065)',
    gridStyle: 'crosshair',
    motif: 'crosshairRings',
    texture: 'speckle',
    block: 'stone',
  }),

  // SNAKE — kehribar/amber. Sıcak ve tatlı.
  SNAKE: theme({
    motif: 'coil',
    lightTint: '255, 220, 80',
    edgeTint: '80, 55, 10',
    shadeTint: '80, 55, 10',
    floorHigh: '#FFF0C0', floor: '#FFE48A', floorEdge: '#FFD660', floorLow: '#FFC840', accent: '#B45309',
    grid: 'rgba(26, 26, 26, 0.06)',
    gridStyle: 'dots',
    texture: 'speckle',
    block: 'stone',
  }),

  // LASER — soğuk mavi-gri, metalik.
  LASER: theme({
    lightTint: '206, 238, 255',
    edgeTint: '18, 40, 52',
    shadeTint: '18, 40, 52',
    floorHigh: '#F5F7F9', floor: '#F2F4F7', floorEdge: '#ECEFF3', floorLow: '#E9EDF1',
    grid: 'rgba(26, 26, 26, 0.06)',
    gridStyle: 'dots',
    accent: '#0E7490',
    motif: 'reactor',
    texture: 'plate',
    block: 'metal',
  }),

  // ZONE — nane yeşili; bölge boyaması zaten renk taşıyor, zemin sakin ama canlı.
  ZONE: theme({
    accent: '#15803D', motif: 'burst',    lightTint: '200, 255, 225',
    edgeTint: '20, 60, 40',
    shadeTint: '20, 60, 40',
    floorHigh: '#E6F6ED', floor: '#D8F0E2', floorEdge: '#C8EAD5', floorLow: '#B8E2C8',
    grid: 'rgba(26, 26, 26, 0.05)',
    gridStyle: 'dots',
    texture: 'speckle',
    block: 'plinth',
  }),

  // HEIST — altın kum. Ganimetçi sıcaklığı.
  HEIST: theme({
    lightTint: '255, 210, 100',
    edgeTint: '90, 60, 10',
    shadeTint: '90, 60, 10',
    floorHigh: '#FFEDC0', floor: '#FFDF90', floorEdge: '#FFD070', floorLow: '#FFBE50',
    grid: 'rgba(26, 26, 26, 0.06)',
    gridStyle: 'crosshair',
    accent: '#D99B26',
    motif: 'vault',
    texture: 'weave',
    block: 'crate',
  }),

  // ARCHER — açık zeytin/yeşil-sarı. Orman av meydanı.
  ARCHER: theme({
    accent: '#3F6212', motif: 'arcs',    lightTint: '180, 230, 80',
    edgeTint: '50, 70, 10',
    shadeTint: '50, 70, 10',
    floorHigh: '#E8F4B0', floor: '#D8EC90', floorEdge: '#C4E070', floorLow: '#B0D450',
    grid: 'rgba(26, 26, 26, 0.06)',
    gridStyle: 'crosshair',
    corners: 'crosshair',
    texture: 'speckle',
    block: 'rock',
  }),

  // NINJA — lavanta. Gece avlusu, mor-gri.
  NINJA: theme({
    lightTint: '180, 140, 255',
    edgeTint: '60, 30, 100',
    shadeTint: '60, 30, 100',
    floorHigh: '#EAE0FA', floor: '#E2D4F6', floorEdge: '#DAC8F2', floorLow: '#D2BCEE',
    grid: 'rgba(26, 26, 26, 0.07)',
    gridStyle: 'dots',
    accent: '#7C3AED',
    motif: 'core',
    corners: 'none',
    texture: 'plate',
    block: 'dark',
  }),

  // CURVE — çelik mavi/periwinkle. Hız pistinin soğuk çizgisi.
  CURVE: theme({
    accent: '#1D4ED8', motif: 'flow',    lightTint: '140, 180, 255',
    edgeTint: '30, 50, 120',
    shadeTint: '30, 50, 120',
    floorHigh: '#E0EEFF', floor: '#CCE2FF', floorEdge: '#B8D6FF', floorLow: '#A6CAFF',
    grid: 'rgba(26, 26, 26, 0.06)',
    gridStyle: 'court',
    texture: 'plate',
    block: 'dark',
  }),

  // RACE — gri asfalt. Pist yüzeyi.
  RACE: theme({
    accent: '#1A1A1A', motif: 'chequer',    lightTint: '220, 220, 220',
    edgeTint: '40, 40, 40',
    shadeTint: '40, 40, 40',
    floorHigh: '#ECECEC', floor: '#DFDFDF', floorEdge: '#D4D4D4', floorLow: '#C9C9C9',
    grid: 'rgba(26, 26, 26, 0.05)',
    gridStyle: 'court',
    texture: 'tile',
    seams: 3,
    block: 'hazard',
  }),

  // CROWN — altın kral. Taht ritmi.
  CROWN: theme({
    lightTint: '255, 215, 80',
    edgeTint: '90, 60, 10',
    shadeTint: '90, 60, 10',
    floorHigh: '#FFF0C0', floor: '#FFE494', floorEdge: '#FFD86E', floorLow: '#FFCC50', accent: '#B45309',
    grid: 'rgba(26, 26, 26, 0.06)',
    gridStyle: 'court',
    motif: 'crown',
    texture: 'tile',
    block: 'plinth',
  }),

  // COLLAPSE — kristal uçurum, indigo/mor taş karo platform.
  COLLAPSE: theme({
    accent: '#6366F1', motif: 'crosshair',    lightTint: '210, 200, 255',
    edgeTint: '30, 20, 60',
    shadeTint: '30, 20, 60',
    floorHigh: '#E8E4F0', floor: '#DDD8E8', floorEdge: '#D3CCDF', floorLow: '#C9C1D6',
    gridStyle: 'dots',
    texture: 'tile',
    block: 'stone',
  }),

  // CLONE — kadim tapınak & mistik kütüphane, zümrüt/teal doku.
  CLONE: theme({
    accent: '#0D9488', motif: 'rings',    lightTint: '160, 240, 220',
    edgeTint: '20, 60, 55',
    shadeTint: '20, 60, 55',
    floorHigh: '#E6F6F2', floor: '#D8F0E8', floorEdge: '#CAEADC', floorLow: '#BCE2D2',
    gridStyle: 'crosshair',
    texture: 'weave',
    block: 'plinth',
  }),

  // HORDE: üç harita teması — `hordeConfig.HORDE_MAPS` bunları sığ yayılımla devralır.
  foundry: theme({
    lightTint: '255, 160, 80',
    edgeTint: '100, 40, 10',
    shadeTint: '100, 40, 10',
    floorHigh: '#FFE0C4', floor: '#FFD0A0', floorEdge: '#FFC080', floorLow: '#FFAC60',
    grid: 'rgba(26, 26, 26, 0.075)',
    gridStyle: 'crosshair',
    accent: '#D84727',
    motif: 'foundry',
    corners: 'none',
    texture: 'plate',
    block: 'crate',
  }),
  reactor: theme({
    lightTint: '100, 220, 240',
    edgeTint: '10, 70, 90',
    shadeTint: '10, 70, 90',
    floorHigh: '#C8F2F8', floor: '#B0EAF6', floorEdge: '#98E0F2', floorLow: '#82D8EE',
    grid: 'rgba(14, 116, 144, 0.10)',
    gridStyle: 'dots',
    accent: '#0891B2',
    motif: 'reactor',
    corners: 'none',
    texture: 'speckle',
    block: 'metal',
  }),
  core: theme({
    lightTint: '180, 120, 255',
    edgeTint: '70, 30, 120',
    shadeTint: '70, 30, 120',
    floorHigh: '#EAD6F6', floor: '#E0CAF0', floorEdge: '#D6BEEA', floorLow: '#CCB2E4',
    grid: 'rgba(91, 33, 182, 0.10)',
    gridStyle: 'dots',
    accent: '#7C3AED',
    motif: 'core',
    corners: 'none',
    texture: 'speckle',
    block: 'dark',
  }),
});

// Tema kimliği büyük/küçük harften bağımsız çözülür: motor `mode` ('BOMB'),
// harita `id` ('foundry') geçiyor; ikisi de aynı kayda gitmeli.
const THEME_INDEX = new Map(
  Object.entries(FIELD_THEMES).map(([id, palette]) => [id.toLowerCase(), palette]),
);

/**
 * Tema kimliği (`foundry` / `BOMB`) ya da doğrudan tema nesnesi çözer.
 *
 * Bilinmeyen anahtar DÜŞÜRÜLÜR ve uyarılır: `floorHighh` gibi bir yazım hatası
 * varsayılanı ezip sessizce görünmez kalmasın.
 */
export function fieldTheme(id, fallback = FIELD_THEMES.default) {
  if (id && typeof id === 'object') {
    const merged = { ...THEME_BASE };
    for (const key of Object.keys(id)) {
      if (THEME_FIELDS.includes(key)) merged[key] = id[key];
      else console.warn(`[fieldKit] bilinmeyen tema alanı yok sayıldı: ${key}`);
    }
    return Object.freeze(merged);
  }
  if (typeof id === 'string') {
    const found = THEME_INDEX.get(id.toLowerCase());
    if (found) return found;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Deterministik seed
// ---------------------------------------------------------------------------

/**
 * (mode, roundId) → uint32 seed. FNV-1a + avalanche; saf tamsayı matematiği
 * olduğu için host ve client BİREBİR aynı seed'i üretir.
 *
 * @param {number|string} [roundId] - sayaç ya da tema kimliği (sayıya çevrilemeyen adlar 0'a katlanır)
 */
export function hashFieldSeed(mode, roundId = 0) {
  const name = String(mode || 'FIELD');
  const round = Math.max(0, Math.floor(Number(roundId) || 0));
  let h = 2166136261 >>> 0;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h = Math.imul(h ^ (round + 0x9e3779b9), 16777619) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

/** mulberry32 — dekor yerleşimi için seed'li PRNG. */
function seededRandom(seed) {
  let t = (Number(seed) || 0) >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), 1 | x);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Merkez motifleri
// ---------------------------------------------------------------------------

/**
 * Motifler düşük kontrastlı (alpha ~0.12) ve oyuncu/pickup renklerinden uzak
 * tutulur: saha okunurluğunu (I7) ve "burada engel var" okumasını bozmaz.
 * Çizim alanı ARENA-İÇİ 0..w / 0..h koordinatlarıdır.
 */
/**
 * Merkez motifinin okunurluk katsayısı.
 *
 * Ölçülen kusur: motifler α 0.11-0.12'de çiziliyordu — zeminden bir tık
 * yukarıda, yani "orada bir şey var" hissi vermek yerine sadece lekeydi.
 * Kullanıcı geri bildirimi ("saha yeterince renkli değil, oyunun ruhu yok")
 * ve 15 oyundan 7'sinin motifsiz olup aynı `rings` fallback'ine düşmesi aynı
 * eksikliğin iki yüzü. Motif artık merkezde kimlik taşıyan bir grafik: 0.26
 * zeminden ayrılır ama oyuncu (P3 sarısı L* 85.9) üstüne binince okunmaz
 * olmaz — motif çizgilerinin etrafı boştur.
 */
const MOTIF_ALPHA = 0.26;

export const FIELD_MOTIFS = Object.freeze({
  none: () => {},

  /** PONG/BOMB: iki konsantrik merkez halkası. */
  rings(ctx, w, h, u, palette) {
    const cx = w / 2;
    const cy = h / 2;
    const min = Math.min(w, h);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(1, 2 * u);
    ctx.strokeStyle = palette.grid;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1, min * 0.22), 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(26, 26, 26, 0.13)';
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1, min * 0.14), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  },

  /** HORDE 'foundry': eşkenar dörtgen + çaprazlar. */
  foundry(ctx, w, h, u, palette) {
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.21;
    ctx.save();
    ctx.globalAlpha = MOTIF_ALPHA;
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = Math.max(1.5, 4 * u);
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.55, cy);
    ctx.lineTo(cx + r * 0.55, cy);
    ctx.moveTo(cx, cy - r * 0.55);
    ctx.lineTo(cx, cy + r * 0.55);
    ctx.stroke();
    ctx.restore();
  },

  /** HORDE 'reactor': iç içe üç kare. */
  reactor(ctx, w, h, u, palette) {
    const cx = w / 2;
    const cy = h / 2;
    const min = Math.min(w, h);
    ctx.save();
    ctx.globalAlpha = MOTIF_ALPHA;
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = Math.max(1.5, 4 * u);
    for (let i = 0; i < 3; i += 1) {
      const r = min * (0.1 + i * 0.065);
      ctx.strokeRect(cx - r, cy - r, r * 2, r * 2);
    }
    ctx.restore();
  },

  /** HORDE 'core': altıgen. */
  core(ctx, w, h, u, palette) {
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.19;
    ctx.save();
    ctx.globalAlpha = MOTIF_ALPHA;
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = Math.max(1.5, 4 * u);
    ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const a = (i * Math.PI) / 3 - Math.PI / 6;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  },

  /** TANKS: merkez halkası + nişan çizgileri (arena atış talimi dili). */
  crosshairRings(ctx, w, h, u, palette) {
    const cx = w / 2;
    const cy = h / 2;
    const min = Math.min(w, h);
    const r = min * 0.16;
    ctx.save();
    ctx.globalAlpha = MOTIF_ALPHA;
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = Math.max(1.5, 3.2 * u);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    const tick = min * 0.045;
    ctx.beginPath();
    ctx.moveTo(cx - r - tick, cy); ctx.lineTo(cx - r + tick, cy);
    ctx.moveTo(cx + r - tick, cy); ctx.lineTo(cx + r + tick, cy);
    ctx.moveTo(cx, cy - r - tick); ctx.lineTo(cx, cy - r + tick);
    ctx.moveTo(cx, cy + r - tick); ctx.lineTo(cx, cy + r + tick);
    ctx.stroke();
    ctx.restore();
  },

  /**
   * BOMB: patlayıcı pati yıldızı — altı noktalı merkez + kesikli halka.
   * Oyunun saat baskısıyla (bombTimer) bir ritim taşıdığı için motif de
   * "tıklayan saat" gibi kırık parçalı: eksik bir çemberden bir parça çalınır.
   */
  spark(ctx, w, h, u, palette) {
    const cx = w / 2;
    const cy = h / 2;
    const min = Math.min(w, h);
    ctx.save();
    ctx.globalAlpha = MOTIF_ALPHA;
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = Math.max(1.5, 3.4 * u);
    ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const a = (i * Math.PI) / 3;
      const x = cx + Math.cos(a) * min * 0.1;
      const y = cy + Math.sin(a) * min * 0.1;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([10 * u, 8 * u]);
    ctx.beginPath();
    ctx.arc(cx, cy, min * 0.2, -0.5, Math.PI * 1.7);
    ctx.stroke();
    ctx.restore();
  },

  /**
   * SNAKE: iç içe kırık baklava — büyüyen halka ritmi. Hayvanın uzamasıyla
   * ölçeklenen tek motif (iç halka ölçek değiştikçe açılır).
   */
  coil(ctx, w, h, u, palette) {
    const cx = w / 2;
    const cy = h / 2;
    const min = Math.min(w, h);
    ctx.save();
    ctx.globalAlpha = MOTIF_ALPHA;
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = Math.max(1.5, 3.2 * u);
    ctx.lineJoin = 'round';
    for (let i = 0; i < 3; i += 1) {
      const r = min * (0.07 + i * 0.065);
      ctx.beginPath();
      for (let k = 0; k < 4; k += 1) {
        const a = (k * Math.PI) / 2 + (i * Math.PI) / 8;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  },

  /**
   * ZONE: merkezden dışa yayılan ışın demeti. Bölge oyunu "alan kapma"
   * olduğu için motif de yayılmayı anlatır — dört eksen çizgisi, köşelere
   * doğru kırpılmış (tam çizgi ızgarayla yarışırdı).
   */
  burst(ctx, w, h, u, palette) {
    const cx = w / 2;
    const cy = h / 2;
    const min = Math.min(w, h);
    ctx.save();
    ctx.globalAlpha = MOTIF_ALPHA;
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = Math.max(1.5, 3 * u);
    ctx.beginPath();
    const inner = min * 0.06;
    const outer = min * 0.23;
    for (let i = 0; i < 8; i += 1) {
      const a = (i * Math.PI) / 4;
      const x0 = cx + Math.cos(a) * inner;
      const y0 = cy + Math.sin(a) * inner;
      const x1 = cx + Math.cos(a) * outer;
      const y1 = cy + Math.sin(a) * outer;
      if (i % 2 === 0) {
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
      } else {
        ctx.moveTo(x1 * 0.82 + cx * 0.18, y1 * 0.82 + cy * 0.18);
        ctx.lineTo(x1, y1);
      }
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  },

  /**
   * ARCHER: nişan yayları — merkezden açılan iki eşit yay ve ok ekseni.
   * (TANKS'in `crosshairRings`'i nişan DIŞI nişangâh dilidir; ARCHER'inki
   * yayın uçlarına nişanlanan atış dilidir — aynı motif iki kez kullanılmaz.)
   */
  arcs(ctx, w, h, u, palette) {
    const cx = w / 2;
    const cy = h / 2;
    const min = Math.min(w, h);
    ctx.save();
    ctx.globalAlpha = MOTIF_ALPHA;
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = Math.max(1.5, 3.2 * u);
    for (const r of [min * 0.13, min * 0.21]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 4, Math.PI / 4);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 1.25);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx, cy - min * 0.26);
    ctx.lineTo(cx, cy + min * 0.26);
    ctx.stroke();
    ctx.restore();
  },

  /**
   * CURVE: eğri akış izi — merkezden iki S kıvrımlı şerit. Izgaranın okuduğu
   * yön hareketindir; motif de aynı şekilde yönü verir ama merkezde.
   */
  flow(ctx, w, h, u, palette) {
    const cx = w / 2;
    const cy = h / 2;
    const min = Math.min(w, h);
    ctx.save();
    ctx.globalAlpha = MOTIF_ALPHA;
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = Math.max(1.5, 3.4 * u);
    ctx.lineCap = 'round';
    for (const off of [-min * 0.06, min * 0.06]) {
      ctx.beginPath();
      ctx.moveTo(cx - min * 0.24, cy + off);
      ctx.quadraticCurveTo(cx - min * 0.08, cy - off * 2.1, cx, cy + off);
      ctx.quadraticCurveTo(cx + min * 0.08, cy + off * 2.1, cx + min * 0.24, cy - off);
      ctx.stroke();
    }
    ctx.restore();
  },

  /**
   * RACE: start/finish çizgisi — merkezde dama tahtası bandı (kendi çizgileri
   * pistte ayrıca var; buradaki motif pist YOLUNU değil BAŞLANGIÇ ritmini verir
   * ve iki yarıyı eşit ısıtır).
   */
  chequer(ctx, w, h, u, palette) {
    const cx = w / 2;
    const cy = h / 2;
    const min = Math.min(w, h);
    const cell = Math.max(2, min * 0.028);
    const cols = 8;
    const rows = 3;
    const bandW = cell * cols;
    const bandH = cell * rows;
    ctx.save();
    ctx.globalAlpha = MOTIF_ALPHA;
    ctx.fillStyle = palette.accent;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if ((r + c) % 2 !== 0) continue;
        ctx.fillRect(cx - bandW / 2 + c * cell, cy - bandH / 2 + r * cell, cell, cell);
      }
    }
    ctx.restore();
  },

  /**
   * HEIST: kesikli altın merkez halkası. Motorun eski sahnesindeki tek
   * anlamlı merkez işareti buydu (ganimet bölgesi); motif olarak bake'e girer,
   * böylece kare başına `setLineDash` + arc maliyeti kalmaz.
   */
  vault(ctx, w, h, u, palette) {
    const cx = w / 2;
    const cy = h / 2;
    ctx.save();
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = Math.max(1.5, 2.5 * u);
    ctx.setLineDash([6 * u, 6 * u]);
    ctx.beginPath();
    ctx.arc(cx, cy, Math.min(w, h) * 0.22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  },

  /** CROWN: merkez yayı üzerinde üç küçük elmas (taht ritmi). */
  crown(ctx, w, h, u, palette) {
    const cx = w / 2;
    const cy = h / 2;
    const min = Math.min(w, h);
    const r = min * 0.035;
    ctx.save();
    ctx.globalAlpha = MOTIF_ALPHA;
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = Math.max(1.5, 3 * u);
    ctx.beginPath();
    for (let i = 0; i < 3; i += 1) {
      const x = cx + (i - 1) * r * 3.4;
      const y = cy + (i === 1 ? -r * 1.2 : r * 0.6);
      ctx.moveTo(x, y - r); ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
      ctx.closePath();
    }
    ctx.stroke();
    ctx.restore();
  },
});

// ---------------------------------------------------------------------------
// Statik katmanın çizimi (arena-içi 0..w / 0..h koordinatları)
// ---------------------------------------------------------------------------

/**
 * Saha içi ölçeğin okunması.
 *
 * PARITY SÖZLEŞMESİ: `computePlayfield` `unit`'i `[minUnit, maxUnit]` aralığına
 * KIRPAR (playfield.js). World-view arenaları bu alanı hiç taşımadan gelir
 * (ör. `ui/tanksWorldView.js` yalnız kutu üretir). Kırpılmamış `size/952` yedeği
 * telefon yatayında eşik altına düştüğü için AYNI cache anahtarı host'ta ve
 * kumanda telefonunda farklı geometri çizerdi. Yedek de kırpılır.
 *
 * World view'ları da bu fonksiyonu kullanmalıdır: `size / 952` yazmak
 * kırpmanın altına düşer ve host/client arasında iz kalınlığı ayrışır
 * (bkz. `ui/curveWorldView.js`).
 */
export function arenaUnit(arena) {
  const u = Number(arena?.unit);
  if (Number.isFinite(u) && u > 0) return clampUnit(u);
  const size = Number(arena?.size) || Math.min(arena?.width || 0, arena?.height || 0);
  return size > 0 ? clampUnit(size / FIELD_DESIGN.shortSide) : 1;
}

function clampUnit(u) {
  return Math.min(FIELD_DESIGN.maxUnit, Math.max(FIELD_DESIGN.minUnit, u));
}

// ---------------------------------------------------------------------------
// Zemin tabanı — düz dolgu değil, ışık alan bir yüzey
// ---------------------------------------------------------------------------

/** Işık yönü sabitleri: `wallShade` bantlarıyla AYNI (sol-üstten gelir). */
const LIGHT_X = 0.34;
const LIGHT_Y = 0.28;
const TRANSPARENT_WHITE = 'rgba(255, 255, 255, 0)';

/**
 * Tema RGB'sinden rgba metni üretir. Tema alanları ilkel (string/number)
 * tutulduğu için (nested nesne yazılamaz) gradyan durakları burada birleşir —
 * gradyan çağrısının içinde `palette.lightTint.split(',')` yazmak üç ayrı yerde
 * tekrar ederdi. Geçersiz/eksik RGB güvenle beyaza düşer (görsel hata üretmez).
 */
function rgba(tint, alpha) {
  const parts = String(tint || '255, 255, 255').split(',').map((v) => v.trim());
  const [r, g, b] = parts.length === 3 ? parts : ['255', '255', '255'];
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Tabanı çizer. Arena-içi 0..w / 0..h koordinatlarındadır ve BİR KERE çağrılır:
 * hem katmanın kendisi hem de `paintPatches` (kapı boşluğu yamaları) bu fonksiyonu
 * kullanır, böylece yama arkasındaki gradyanla BİREBİR eşleşir — eskiden yama
 * düz `palette.floor` olduğu için her kapı ağzında görünür dikiş bırakıyordu.
 */
function paintFloorBase(ctx, w, h, u, palette) {
  const high = palette.floorHigh || palette.floor;
  const low = palette.floorLow || palette.floorEdge || palette.floor;

  // 1. opak taban — sonraki her şey bunun üstüne bindirilir.
  ctx.fillStyle = palette.floor;
  ctx.fillRect(0, 0, w, h);

  // 2. üst aydınlanma (ışık üstten geldiği için sahanın üst yarısı daha canlı).
  const topH = Math.max(1, h * 0.55);
  const top = ctx.createLinearGradient(0, 0, 0, topH);
  top.addColorStop(0, high);
  top.addColorStop(1, TRANSPARENT_WHITE);
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, w, topH);

  // 3. alt derinleşme — "bembeyaz" hissinin asıl panzehiri: taban altta belirgin
  //    koyulaşır, yani sahada bir ufuk yönü vardır.
  const lowFrom = h * 0.42;
  const deep = ctx.createLinearGradient(0, lowFrom, 0, h);
  deep.addColorStop(0, TRANSPARENT_WHITE);
  deep.addColorStop(1, low);
  ctx.fillStyle = deep;
  ctx.fillRect(0, lowFrom, w, h - lowFrom);

  // 4. ışık havuzu — radyal, sol-üstte. `fieldPx` kullanılmaz: konum ve yarıçap
  //    sahanın kendisiyle orantılı, dolayısıyla ölçekten bağımsızdır.
  const pool = Number(palette.lightPool);
  if (pool > 0) {
    const px = w * LIGHT_X;
    const py = h * LIGHT_Y;
    const r = Math.max(1, Math.hypot(w, h) * 0.78);
    const glow = ctx.createRadialGradient(px, py, 0, px, py, r);
    glow.addColorStop(0, rgba(palette.lightTint, (palette.lightAlpha * Math.min(1, pool)).toFixed(3)));
    glow.addColorStop(1, TRANSPARENT_WHITE);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  }

  // 5. sol duvardan sekme gölgesi — sağ/alt bantlarıyla birlikte çerçeveyi
  //    "üstüne bindirilmiş bir dikdörtgen" olmaktan çıkarıp sahayı kuşatır.
  const bounce = Math.max(fieldPx({ unit: u }, 10), Math.min(w, h) * 0.05);
  const left = ctx.createLinearGradient(0, 0, bounce, 0);
  left.addColorStop(0, 'rgba(26, 26, 26, 0.045)');
  left.addColorStop(1, 'rgba(26, 26, 26, 0)');
  ctx.fillStyle = left;
  ctx.fillRect(0, 0, bounce, h);
}

// ---------------------------------------------------------------------------
// Yüzey dokusu — küçük bir tile bir kez üretilir, desene çevrilip katmana serilir
// ---------------------------------------------------------------------------

/**
 * Tile kenarı TASARIM px'i (CSS px) cinsindendir: tam sayı user-space tekrarı,
 * desen kaynağının arena kökenine hizalanmasını garanti eder ve kırıklı
 * kenar-ızgarası artefaktını üretmez.
 *
 * PERİYOT BÜYÜK TUTULUR (32px): 24px'de desen ızgara çizgileriyle üst üste
 * binip "kareli kâğıt" okuması verdi — yani dokunun çözmek için geldiği düzlüğü
 * artırdı. Kafes seyreldikçe yüzey, sıklaştıkça desen olur.
 *
 * KONTRAST TAVANI: hiçbir fırça izi effective α > 0.05 üretemez (reçete α ×
 * `textureAlpha`). Dekorun alt sınırı 0.055, ızgaranın 0.05 — dokunun üstünde
 * olursa oyun nesnesiyle karıştırılacak ikinci bir çizgi katmanı olur.
 */
const TILE_DESIGN = 32;
const TILE_MIN = 20;
const TILE_MAX = 80;
const MAX_TILE_ENTRIES = 8;

/** Doku reçeteleri. Hepsi SİMSİK olmak zorundadır (bkz. yorumlar). */
const TILE_RECIPES = Object.freeze({
  /**
   * Kumaş dokusu: tek yönde seyrek atki + dikine kısa atımlar. Köşeden köşeye
   * ÇAPRAZ YOK — tam çapraz, tile'landığında gözle görülür bir elmas kafes
   * kuruyor ve ızgarayla savaşıyor.
   */
  weave(t, side) {
    const line = Math.max(1, side * 0.045);
    t.strokeStyle = 'rgba(26, 26, 26, 0.055)';
    t.lineWidth = line;
    t.beginPath();
    t.moveTo(0, side); t.lineTo(side, 0);
    t.stroke();
    t.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    t.lineWidth = line;
    t.beginPath();
    t.moveTo(0, side * 0.5); t.lineTo(side * 0.5, 0);
    t.moveTo(side * 0.5, side); t.lineTo(side, side * 0.5);
    t.stroke();
  },

  /**
   * Plaka: tek yönde çok seyrek tarama. Paralel çizgiler tile kenarında
   * birbirine tam kapanır (periyot side/2), dolayısıyla simsiiktir.
   */
  plate(t, side) {
    t.strokeStyle = 'rgba(26, 26, 26, 0.04)';
    t.lineWidth = Math.max(1, side * 0.035);
    const half = side / 2;
    t.beginPath();
    t.moveTo(0, 0); t.lineTo(side, side);
    t.moveTo(0, half); t.lineTo(half, side);
    t.moveTo(half, 0); t.lineTo(side, half);
    t.stroke();
  },

  /**
   * Kâğıt taneciği: tam-sayı alt-ızgarada hash'li noktalar. Noktalar kenara
   * DEĞMEZ (içeride kalır), dolayısıyla tekrar sınırı yoktur — simsiik.
   * Varsayılan doku budur: hiçbir yön/kafes kurmaz, bu yüzden hiçbir oyun
   * nesnesiyle anlam çakışması yaşamaz.
   */
  speckle(t, side) {
    const cells = 8;
    const step = side / cells;
    const dot = Math.max(1, step * 0.3);
    t.fillStyle = 'rgba(26, 26, 26, 0.06)';
    for (let gy = 0; gy < cells; gy += 1) {
      for (let gx = 0; gx < cells; gx += 1) {
        if (!hashBit(gx, gy, side)) continue;
        t.fillRect(gx * step + step * 0.3, gy * step + step * 0.3, dot, dot);
      }
    }
  },

  /** Döşeme derzi: sağ+alt kenarda 1px-varı oyuk. Kenarlar birleşince ızgara olur. */
  tile(t, side) {
    const grout = Math.max(1, side * 0.045);
    t.fillStyle = 'rgba(26, 26, 26, 0.06)';
    t.fillRect(side - grout, 0, grout, side);
    t.fillRect(0, side - grout, side, grout);
    t.fillStyle = 'rgba(255, 255, 255, 0.45)';
    t.fillRect(side - grout * 2, 0, grout, side);
    t.fillRect(0, side - grout * 2, side, grout);
  },
});

/** `speckle` için deterministik bit — seed/gürültü yok, yalnız tam sayı hash. */
function hashBit(gx, gy, side) {
  let h = Math.imul(gx + 1, 374761393) ^ Math.imul(gy + 1, 668265263) ^ Math.imul(side, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h >>> 24) & 7) > 3;
}

const tileCache = new Map();

/**
 * Doku tile'ını döndürür (yoksa `null`). Tile'lar `side` (tam sayı CSS px)
 * cinsinden anahtarlanır, yani DPR/ölçek değişse bile AYNI bitmap yeniden
 * kullanılır — en fazla 8 tile ≈ 0.16 MB.
 *
 * Tile kendi canvas'ına çizilir: bu, katmanın çizim logunun cache isabet/hata
 * durumunda BİREBİR aynı kalmasını sağlar (koskoca desen katman ctx'ine
 * çizilseydi ikinci frame'de log kısalırdı).
 */
function textureTile(palette, u) {
  const name = String(palette.texture || '');
  const recipe = TILE_RECIPES[name];
  if (!recipe) return null;
  const side = Math.max(TILE_MIN, Math.min(TILE_MAX, Math.round(TILE_DESIGN * u)));
  const key = `${name}|${side}`;
  const hit = tileCache.get(key);
  if (hit) {
    tileCache.delete(key);
    tileCache.set(key, hit);
    return hit.canvas;
  }
  const canvas = createLayerCanvas();
  if (!canvas) return null;
  canvas.width = side;
  canvas.height = side;
  canvas.__fieldRole = 'tile';
  const t = canvas.getContext('2d');
  if (!t) return null;
  recipe(t, side);
  fieldLayerStats.tiles += 1;
  tileCache.set(key, { canvas });
  while (tileCache.size > MAX_TILE_ENTRIES) {
    const oldest = tileCache.keys().next().value;
    const entry = tileCache.get(oldest);
    if (entry?.canvas) {
      entry.canvas.width = 0;
      entry.canvas.height = 0;
    }
    tileCache.delete(oldest);
  }
  return canvas;
}

/** Deseni sahaya serer: iki op — pattern üret + tek dolgu. */
function paintTexture(ctx, w, h, u, palette) {
  const alpha = Number(palette.textureAlpha);
  if (!(alpha > 0)) return;
  const tile = textureTile(palette, u);
  if (!tile || typeof ctx.createPattern !== 'function') return;
  // `pattern.setTransform(...)` KULLANILMAZ: desenin kökeni user-space orijinine
  // (arena köşesine) bağlıdır, dolayısıyla zaten hizalıdır.
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/**
 * Tam-genişlik derz çizgileri: bir zemini "kâğıt"tan "döşenmiş yüzey"e çeviren
 * en ucuz tek değişiklik. Konumlar `seed`'den türer ve kaba bir yarı-saha
 * ızgarasına yuvarlanır, böylece raunt değiştince derzler kaymaz — yalnızca
 * yer değiştirir.
 */
function paintSeams(ctx, w, h, u, palette, seed) {
  const count = Math.round(Number(palette.seams) || 0);
  if (!(count > 0)) return;
  const rng = seededRandom(seed ^ 0x5bf03635);
  ctx.save();
  ctx.strokeStyle = 'rgba(26, 26, 26, 0.05)';
  ctx.lineWidth = Math.max(1, 1.2 * u);
  ctx.beginPath();
  for (let i = 0; i < Math.min(4, count); i += 1) {
    const frac = 0.25 + rng() * 0.5;
    if (rng() < 0.5) {
      const x = Math.round(w * frac);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    } else {
      const y = Math.round(h * frac);
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function paintCorners(ctx, w, h, u, palette, inset, edge) {
  const style = palette.corners;
  if (style === 'none') return;
  const min = Math.min(w, h);

  if (style === 'crosshair' || style === 'both') {
    const spots = [
      [inset, inset],
      [w - inset, inset],
      [inset, h - inset],
      [w - inset, h - inset],
    ];
    const len = fieldRadius({ size: min, unit: u }, 20, 0.012);
    ctx.save();
    ctx.strokeStyle = 'rgba(26, 26, 26, 0.18)';
    ctx.lineWidth = Math.max(1, 1.5 * u);
    ctx.beginPath();
    for (const [x, y] of spots) {
      ctx.moveTo(x - len, y);
      ctx.lineTo(x + len, y);
      ctx.moveTo(x, y - len);
      ctx.lineTo(x, y + len);
    }
    ctx.stroke();
    ctx.restore();
  }

  if (style !== 'plate' && style !== 'both') return;

  // 'plate': köşelerde L plakaları (sahanın fiziksel kenar dilini güçlendirir).
  // Duvar konturuyla kaynaşmaması için tam köşeden değil, `edge` kadar içeriden
  // başlar.
  const bLen = Math.max(fieldPx({ unit: u }, 16), min * 0.05);
  const reach = Math.max(2, edge);
  ctx.save();
  ctx.strokeStyle = palette.cornerInk;
  ctx.lineWidth = Math.max(1.5, 3 * u);
  ctx.beginPath();
  ctx.moveTo(0, reach + bLen); ctx.lineTo(0, reach); ctx.lineTo(reach + bLen, reach);
  ctx.moveTo(w - reach - bLen, reach); ctx.lineTo(w - reach, reach); ctx.lineTo(w - reach, reach + bLen);
  ctx.moveTo(0, h - reach - bLen); ctx.lineTo(0, h - reach); ctx.lineTo(reach + bLen, h - reach);
  ctx.moveTo(w - reach - bLen, h - reach); ctx.lineTo(w - reach, h - reach); ctx.lineTo(w - reach, h - reach - bLen);
  ctx.stroke();
  ctx.restore();
}

function paintDecals(ctx, w, h, u, palette, seed) {
  const intensity = Number(palette.decals);
  if (!(intensity > 0)) return;
  const min = Math.min(w, h);
  if (min < 40) return;

  // Alan arttıkça çoğalan ama sınırlı sayı; küçük `unit`'te (kompakt telefon
  // yatay) azalır — ince çizgi/karma 900px'de alias olur ve gövdeyi yorar.
  let count = Math.round((min * min) / 26000) * intensity;
  if (u < 0.5) count = Math.round(count * 0.6);
  if (u < 0.35) count = Math.round(count * 0.4);
  count = Math.max(0, Math.min(40, count));
  if (count === 0) return;

  const rng = seededRandom(seed);
  const margin = min * 0.07;
  const spanX = w - margin * 2;
  const spanY = h - margin * 2;
  const band = min * 0.12;
  const pf = { size: min, unit: u };

  // Kenar-ağırlıklı yerleşim: dekorun ~%45'i dış banda düşer. Orası hem
  // vignette'in koyulaştığı hem de düz dolgunun en belli şekilde "hiçbir şey
  // yapmadığı" yer; merkez ise temiz kalır — varlıklar orada yaşıyor ve
  // hareketli bir leke oyun nesnesiyle karıştırılır.
  const place = () => {
    if (rng() >= 0.45) return [margin + rng() * spanX, margin + rng() * spanY];
    const edge = rng();
    if (edge < 0.25) return [rng() * w, rng() * band];
    if (edge < 0.5) return [rng() * w, h - rng() * band];
    if (edge < 0.75) return [rng() * band, rng() * h];
    return [w - rng() * band, rng() * h];
  };

  ctx.save();
  for (let i = 0; i < count; i += 1) {
    const [x, y] = place();
    const roll = rng();
    ctx.globalAlpha = 0.6 + rng() * 0.4;
    ctx.strokeStyle = palette.decal;
    ctx.fillStyle = palette.decal;

    if (roll < 0.34) {
      // çizik
      const len = fieldRadius(pf, 26, 0.02) * (0.6 + rng() * 0.9);
      const a = rng() * Math.PI;
      ctx.lineWidth = Math.max(1, 1.4 * u);
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(a) * len * 0.5, y - Math.sin(a) * len * 0.5);
      ctx.lineTo(x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5);
      ctx.stroke();
    } else if (roll < 0.62) {
      // leke
      const r = fieldRadius(pf, 30, 0.018) * (0.25 + rng() * 0.7);
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.5 + rng() * 0.5), rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    } else if (roll < 0.8) {
      // yay
      const r = fieldRadius(pf, 70, 0.05) * (0.5 + rng() * 0.8);
      const start = rng() * Math.PI * 2;
      ctx.lineWidth = Math.max(1, 1.2 * u);
      ctx.beginPath();
      ctx.arc(x, y, r, start, start + 0.7 + rng() * 1.1);
      ctx.stroke();
    } else if (roll < 0.92) {
      // çentik kümesi — darbe izi; dört minik kare, hepsi tam sayıya yaslanır
      const s = Math.max(1, fieldPx(pf, 2));
      for (let k = 0; k < 4; k += 1) {
        ctx.fillRect(Math.round(x + (k % 2) * s * 2), Math.round(y + Math.floor(k / 2) * s * 2), s, s);
      }
      rng();
    } else {
      // sürtme halkası
      const r = fieldRadius(pf, 34, 0.024) * (0.5 + rng() * 0.8);
      ctx.lineWidth = Math.max(1, 1.6 * u);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * Tepsi köşe yarıçapı: saha ölçeğiyle büyür (telefonda ~7px, TV'de ~22px).
 * KESİM, iç gölge çizgisi ve `paintBackdrop`'un arkaya düşürdüğü gölge AYNI
 * yarıçapı kullanır — farklıysa köşe iki ayrı silüet gibi okunur.
 */
function trayRadius(u, palette) {
  return Math.max(4, Math.min(26, fieldPx({ unit: u }, Number(palette.trayR) || 18)));
}

/**
 * Path'e yuvarlak dikdörtgen ALT-yolu EKLER (`beginPath` çağırmaz) — halkayı tek
 * path'te iki dikdörtgenle kurup `fill('evenodd')` verebilmek için şart.
 * `roundRect` yoksa düz dikdörtgene düşer: görsel köşeli olur ama çökmez.
 */
function appendRoundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return true;
  }
  ctx.rect(x, y, w, h);
  return false;
}

/**
 * Tepsi kenarı: siyah çerçevenin yerine geçer.
 *
 * Koyu bant ve kontur kalktı. Sınır artık üç bedelsiz ipucuyla okunur: katmanın
 * yuvarlatılmış kesimi (aşağıda clip), tek ince iç gölge çizgisi ve
 * paintBackdrop'un arenanın arkasına düşürdüğü gölge. Üst/sol ışık çizgisi
 * pahlı kenar hissini tamamlar — ışık yönü wallShade bantlarıyla aynıdır.
 *
 * ÖNEMLİ: çarpışma hâlâ DİKDÖRTGEN. Yuvarlatılmış köşede bir varlık kenarı
 * yarıçap kadar aşabilir; bu yüzden yarıçap saha ölçeğiyle sınırlıdır
 * (telefonda ~7px) ve köşeyi okuyan oyunlar (PONG) plakalarını korur.
 */
function paintTrayEdge(ctx, w, h, u, palette, r) {
  const lw = Math.max(1.5, 2.4 * u);
  ctx.save();

  // İç gölge çizgisi — tepsi duvarı. Çizgi kenarın YARISINA oturur, kesimin
  // dışına taşmaz.
  ctx.strokeStyle = palette.edgeInk;
  ctx.lineWidth = lw;
  ctx.beginPath();
  appendRoundRect(ctx, lw / 2, lw / 2, Math.max(1, w - lw), Math.max(1, h - lw), Math.max(1, r - lw / 2));
  ctx.stroke();

  // Işık çizgisi — pahlı kenar. Birkaç px içeride, çok daha ince.
  ctx.strokeStyle = palette.edgeLight;
  ctx.lineWidth = Math.max(1, 1.2 * u);
  ctx.beginPath();
  appendRoundRect(ctx, lw * 1.6, lw * 1.6, Math.max(1, w - lw * 3.2), Math.max(1, h - lw * 3.2), Math.max(1, r - lw * 1.6));
  ctx.stroke();

  ctx.restore();
}
/**
 * Sahanın dışına taşan statik parçaların üstünü temizler: kapı boşluğu gibi.
 * Duvar konturu bilerek SONRA çizilir, böylece yama saha kenarındaki duvarı da
 * keser — yani kapı gerçekten sahnede bir açıklık olur.
 */
function paintPatches(ctx, w, h, u, palette, patches) {
  if (!Array.isArray(patches) || patches.length === 0) return;
  for (const patch of patches) {
    if (!patch) continue;
    const x = Number(patch.x);
    const y = Number(patch.y);
    const pw = Number(patch.w);
    const ph = Number(patch.h);
    if (![x, y, pw, ph].every(Number.isFinite) || pw <= 0 || ph <= 0) continue;

    // Zemin BÜTÜN sahaya göre tanımlı gradyanlarla türer; yamayı kırpıp aynı
    // tabanı çizmek, düz `palette.floor` dolguyla kalan dikişi tamamen siler.
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, pw, ph);
    ctx.clip();
    paintFloorBase(ctx, w, h, u, palette);
    paintTexture(ctx, w, h, u, palette);
    ctx.restore();

    // Yamaya hafif bir iç gölge: düz leke yerine "çukur kapı" hissi.
    const depth = Math.max(fieldPx({ unit: u }, 6), Math.min(pw, ph) * 0.55);
    const toRight = Math.abs(x + pw - w) < 1;
    const toLeft = Math.abs(x) < 1;
    const toBottom = Math.abs(y + ph - h) < 1;
    const toTop = Math.abs(y) < 1;
    if (!(toRight || toLeft || toBottom || toTop)) continue;

    const grad = toRight
      ? ctx.createLinearGradient(x + pw - depth, 0, x + pw, 0)
      : toLeft
        ? ctx.createLinearGradient(x, 0, x + depth, 0)
        : toBottom
          ? ctx.createLinearGradient(0, y + ph - depth, 0, y + ph)
          : ctx.createLinearGradient(0, y, 0, y + depth);
    grad.addColorStop(0, 'rgba(26, 26, 26, 0)');
    grad.addColorStop(1, palette.wallShade);
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, pw, ph);
  }
}

/**
 * Oyun alanının kort / ızgara dili:
 * Düz ve tekdüze kareli defter ızgarası yerine, oyunun türüne özgü taktiksel ve spor çizgileri.
 * 'court' (spor kortu / hava hokeyi) | 'crosshair' (taktiksel hedefleme) | 'dots' (siber arcade) | 'lines' (klasik)
 */
function paintFieldGrid(ctx, w, h, u, inset, palette) {
  const style = palette.gridStyle || 'dots';
  if (style === 'none') return;
  const min = Math.min(w, h);

  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = Math.max(1, 1 * u);

  if (style === 'court') {
    // Spor / Hava Hokeyi Kortu (PONG / CURVE / RACE / CROWN):
    // Düz defter çizgisi yerine temiz iç kort sınırı, orta saha kesimi ve santra çemberi
    const cx = w / 2;
    const cy = h / 2;
    const courtInset = inset + Math.max(fieldPx({ unit: u }, 6), min * 0.025);
    const cr = Math.max(fieldPx({ unit: u }, 10), min * 0.04);

    ctx.beginPath();
    appendRoundRect(ctx, courtInset, courtInset, Math.max(1, w - courtInset * 2), Math.max(1, h - courtInset * 2), cr);
    if (w >= h) {
      ctx.moveTo(cx, courtInset);
      ctx.lineTo(cx, h - courtInset);
    } else {
      ctx.moveTo(courtInset, cy);
      ctx.lineTo(w - courtInset, cy);
    }
    const circleR = Math.max(fieldPx({ unit: u }, 20), min * 0.15);
    ctx.moveTo(cx + circleR, cy);
    ctx.arc(cx, cy, circleR, 0, Math.PI * 2);
    ctx.stroke();

  } else if (style === 'crosshair') {
    // Taktiksel Savaş Meydanı (TANKS / ARCHER / BOMB / HEIST):
    // Defter çizgileri yerine seyrek taktiksel nişangah artıları (+)
    const step = Math.max(fieldPx({ unit: u }, 54), min / 7);
    const arm = Math.max(fieldPx({ unit: u }, 3.5), 2.5 * u);
    ctx.beginPath();
    for (let x = inset + step; x < w - inset; x += step) {
      for (let y = inset + step; y < h - inset; y += step) {
        ctx.moveTo(x - arm, y);
        ctx.lineTo(x + arm, y);
        ctx.moveTo(x, y - arm);
        ctx.lineTo(x, y + arm);
      }
    }
    ctx.stroke();

  } else if (style === 'dots') {
    // Siber Arcade / Dot Matrix (SNAKE / LASER / ZONE / NINJA):
    // Kesişimlerde minik şık noktacıklar
    const step = Math.max(fieldPx({ unit: u }, 44), min / 8);
    const dot = Math.max(1, 1.2 * u);
    ctx.beginPath();
    for (let x = inset + step; x < w - inset; x += step) {
      for (let y = inset + step; y < h - inset; y += step) {
        ctx.moveTo(x - dot, y);
        ctx.lineTo(x + dot, y);
        ctx.moveTo(x, y - dot);
        ctx.lineTo(x, y + dot);
      }
    }
    ctx.stroke();

  } else {
    // Klasik hatlar
    const cell = Math.max(fieldPx({ unit: u }, 36), min / 11);
    ctx.beginPath();
    for (let x = inset + cell; x < w - inset; x += cell) {
      ctx.moveTo(x, inset);
      ctx.lineTo(x, h - inset);
    }
    for (let y = inset + cell; y < h - inset; y += cell) {
      ctx.moveTo(inset, y);
      ctx.lineTo(w - inset, y);
    }
    ctx.stroke();
  }
}

/**
 * Statik saha katmanının TAMAMINI çizer. Koordinat alanı arena içidir
 * (0,0)..(w,h): hem offscreen bake hem de DOM'suz doğrudan çizim yolu aynı
 * kodu kullanır.
 *
 * KARE BAŞINA MALİYET SIFIR: bu fonksiyon yalnızca bake sırasında çağrılır,
 * sonrasındaki her frame tek bir `drawImage` blit'tir. Görsel ağırlık bilinçli
 * olarak BURAYA konur — kare çizim yoluna değil.
 *
 * ÇİZİM SIRA SÖZLEŞMESİ (testler bunu kilitler): yuvarlatılmış kesim → zemin
 * tabanı → doku → derz → ızgara → iç çerçeve → motif → dekor → köşeler →
 * vignette → iç gölge bantları → **tepsi kenarı** → yamalar → marks. Tepsi
 * kenarından sonra hiçbir şey kenara stroke çekmez; yamalar ve `marks` bilerek
 * istisnadır (kapı ağzı kenar çizgisini kesmek ZORUNDADIR).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {FieldGeometry} arena - { width, height } (arena içi çizim için yeterli)
 * @param {FieldPalette} palette - `fieldTheme()` çıktısı
 * @param {{seed?: number, marks?: any, patches?: any}} opts
 */
export function paintFieldLayer(ctx, arena, palette, { seed = 1, marks = null, patches = null } = /** @type {{seed?: number, marks?: any, patches?: any}} */ ({})) {
  const w = Math.max(1, Number(arena?.width) || 0);
  const h = Math.max(1, Number(arena?.height) || 0);
  const u = arenaUnit(arena);
  const min = Math.min(w, h);
  const inset = Math.max(fieldPx({ unit: u }, 12), min * 0.045);
  // Koyu çerçeve kalktı. Kenar bilgisi üç bedelsiz ipucundan gelir: yuvarlatılmış
  // kesim, tek ince iç gölge çizgisi ve arenanın arkasına düşen gölge
  // (`paintBackdrop`). `edgePad` gölge bantlarını kesimin üstüne bindirmez.
  const rTray = trayRadius(u, palette);
  const edgePad = Math.max(1, 1.2 * u);

  ctx.save();
  ctx.beginPath();
  appendRoundRect(ctx, 0, 0, w, h, rTray);
  ctx.clip();

  // 1-3. Zemin yüzeyi: çok-duraklı taban + ışık havuzu, tek seferlik doku
  //      deseni ve tam-genişlik derzler.
  paintFloorBase(ctx, w, h, u, palette);
  paintTexture(ctx, w, h, u, palette);
  paintSeams(ctx, w, h, u, palette, seed);

  // 4. Kort / Izgara işaretleri (oyun diline özgü: kort çizgisi, taktiksel artılar veya dot matrix)
  paintFieldGrid(ctx, w, h, u, inset, palette);

  // 5. İç çerçeve hairline
  ctx.strokeStyle = palette.frame;
  ctx.lineWidth = Math.max(1, 1.5 * u);
  ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);

  // 6. Merkez motifi
  const motif = FIELD_MOTIFS[palette.motif] || FIELD_MOTIFS.rings;
  motif(ctx, w, h, u, palette);

  // 7. Seed'li dekor (yalnız bu katmanda, yalnız seed'den)
  paintDecals(ctx, w, h, u, palette, seed);

  // 8. Köşe işaretleri — tepsi kenar çizgisinin hemen içinden başlarlar.
  paintCorners(ctx, w, h, u, palette, inset, edgePad * 2);

  // 9. Vignette — tek radyal gradyan. Vinyet ve duvar gölge bandı zeminden
  //    ~1.5 L* yer; `THEME_BASE` başlığındaki taban L* ≥ 92.5 bütçesi bunu sayar.
  const cx = w / 2;
  const cy = h / 2;
  const outerR = Math.max(1, Math.hypot(cx, cy));
  const vig = ctx.createRadialGradient(cx, cy, outerR * 0.42, cx, cy, outerR);
  vig.addColorStop(0, rgba(palette.edgeTint, 0));
  vig.addColorStop(1, rgba(palette.edgeTint, 0.1));
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);

  // 10. İç gölge: sağ + alt — gölge duvarın üstüne değil, yanındaki zemine
  //     düşer. Işık sol-üstten gelir. Koyu çerçeve kalktıktan sonra bu bant
  //     sahanın "bir tepsi içinde" olduğunu okutan ana ipucudur.
  const band = Math.max(fieldPx({ unit: u }, 8), min * 0.055);
  const floorRight = w - edgePad;
  const rightShade = ctx.createLinearGradient(floorRight - band, 0, floorRight, 0);
  rightShade.addColorStop(0, 'rgba(26, 26, 26, 0)');
  rightShade.addColorStop(1, palette.wallShade);
  ctx.fillStyle = rightShade;
  ctx.fillRect(floorRight - band, edgePad, band, Math.max(1, h - edgePad * 2));
  const floorBottom = h - edgePad;
  const bottomShade = ctx.createLinearGradient(0, floorBottom - band, 0, floorBottom);
  bottomShade.addColorStop(0, 'rgba(26, 26, 26, 0)');
  bottomShade.addColorStop(1, palette.wallShade);
  ctx.fillStyle = bottomShade;
  ctx.fillRect(edgePad, floorBottom - band, Math.max(1, w - edgePad * 2), band);

  // 11. Tepsi kenarı (iç gölge çizgisi + pahlı ışık çizgisi) — siyah çerçevenin
  //     yerine geçer. Sahanın SON kenar çizgisi budur; sonrasında hiçbir şey
  //     kenara stroke çekmez (yamalar ve marks bilerek istisnadır).
  paintTrayEdge(ctx, w, h, u, palette, rTray);

  // 12. Yama (kapı boşluğu vb.) — tepsi kenarının üstüne, yani açıklık kenar
  //     çizgisini gerçekten keser.
  paintPatches(ctx, w, h, u, palette, patches);

  // 13. Oyunun kendi statik işaretleri (PONG halkaları, HORDE spawn kapıları)
  if (typeof marks === 'function') {
    ctx.save();
    marks(ctx, { width: w, height: h, unit: u, cx, cy, min }, palette);
    ctx.restore();
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Sahanın DİŞI — arenayı bir masada yanan yüzey gibi oturtan arka plan
// ---------------------------------------------------------------------------

/**
 * Katman anahtarları için tek kuantum kovası. Sahayı yeniden pişirmeyi
 * tetiklemeyen en ince adımdır: 2 px, alt-piksel sürüklenmeyi yutar.
 */
const quantize2 = (v) => Math.round(v / 2) * 2;

/**
 * Düzgün (düşük frekanslı) bir görüntü olduğu için ~3× düşük örneklemeyi kaldırır:
 * bütçe saha katmanının üçte biri.
 */
const MAX_BACKDROP_PIXELS = 600_000;
const MAX_BACKDROP_ENTRIES = 2;
const backdropCache = new Map();

/**
 * Arenanın çevresini boyar. "Bembeyaz ekran" hissinin en az yarısı sahanın
 * kendisi değil, etrafındaki dev düz krem kenar boşluğudur (13 motorda 23 ayrı
 * ham `fillRect` çağır noktası). Bedava: katman bir kez pişirilir, frame başına
 * tek blit.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {FieldGeometry} viewport - { width, height } (tüm canvas)
 * @param {FieldGeometry} arena    - playfield kutusu (ışık ve gölge bundan türer)
 * @param {{mode?: string, theme?: any}} [opts]
 */
export function paintBackdrop(ctx, viewport, arena, opts = {}) {
  if (!ctx || !viewport || !arena) return;
  const w = Math.max(1, Number(viewport.width) || 0);
  const h = Math.max(1, Number(viewport.height) || 0);
  const box = {
    left: Number(arena?.left) || 0,
    top: Number(arena?.top) || 0,
    width: Math.max(1, Number(arena?.width) || 0),
    height: Math.max(1, Number(arena?.height) || 0),
  };
  if (w <= 0 || h <= 0) return;

  const palette = fieldTheme(opts.theme ?? opts.mode);
  // Anahtar saha katmanıyla AYNI kareye oturur (2 px): alt-piksel sürüklenme ve
  // tarayıcı çubuğunun açılıp kapanması her ara tam-piksel yükseklik için tüm
  // viewport'u yeniden pişirmesin. Katman blit'te w×h'ye gerildiği için
  // düşük frekanslı bu görüntüde fark yoktur.
  const key = [
    palette.backdrop, quantize2(w), quantize2(h),
    quantize2(box.left), quantize2(box.top),
    quantize2(box.width), quantize2(box.height),
  ].join('|');

  const hit = backdropCache.get(key);
  if (hit) {
    backdropCache.delete(key);
    backdropCache.set(key, hit); // LRU
    ctx.drawImage(hit.canvas, 0, 0, w, h);
    return;
  }

  const layer = createLayerCanvas();
  if (!layer) {
    paintBackdropLayer(ctx, w, h, box, palette);
    return;
  }
  const scale = Math.max(0.5, Math.min(1, Math.sqrt(MAX_BACKDROP_PIXELS / Math.max(1, w * h))));
  layer.width = Math.max(1, Math.round(w * scale));
  layer.height = Math.max(1, Math.round(h * scale));
  layer.__fieldRole = 'backdrop';
  const lctx = layer.getContext('2d');
  if (!lctx) {
    paintBackdropLayer(ctx, w, h, box, palette);
    return;
  }
  lctx.setTransform(scale, 0, 0, scale, 0, 0);
  paintBackdropLayer(lctx, w, h, box, palette);
  fieldLayerStats.backdrops += 1;

  backdropCache.set(key, { canvas: layer });
  while (backdropCache.size > MAX_BACKDROP_ENTRIES) {
    const oldest = backdropCache.keys().next().value;
    const entry = backdropCache.get(oldest);
    if (entry?.canvas) {
      entry.canvas.width = 0;
      entry.canvas.height = 0;
    }
    backdropCache.delete(oldest);
  }
  ctx.drawImage(layer, 0, 0, w, h);
}

/** Arka plan katmanının kendisi: viewport koordinatları (0,0)..(w,h). */
function paintBackdropLayer(ctx, w, h, box, palette) {
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const glowR = Math.max(1, Math.hypot(w, h) * 0.62);
  const u = arenaUnit({ width: box.width, height: box.height });

  ctx.fillStyle = palette.backdrop;
  ctx.fillRect(0, 0, w, h);

  // 1. Arenanın merkezinden dışa düşen hafif ambiyans ışıltısı (tema renginde yumuşak halo)
  const pool = ctx.createRadialGradient(cx, cy, Math.max(1, glowR * 0.15), cx, cy, glowR * 0.7);
  pool.addColorStop(0, rgba(palette.lightTint, 0.15));
  pool.addColorStop(0.5, rgba(palette.lightTint, 0.04));
  pool.addColorStop(1, rgba(palette.edgeTint, 0));
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, w, h);

  // 2. Köşe kararması — masaüstü derinliği.
  const vig = ctx.createRadialGradient(cx, cy, glowR * 0.45, cx, cy, glowR);
  vig.addColorStop(0, rgba(palette.edgeTint, 0));
  vig.addColorStop(1, rgba(palette.edgeTint, 0.5));
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);

  // 3. Arenanın geriye düşen gölgesi: tepsinin arkasına düşen katmanlı derinlik gölgeleri.
  const r = trayRadius(u, palette);
  const shadowRing = (dx, dy, lw, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    appendRoundRect(ctx, box.left + dx, box.top + dy, box.width, box.height, r);
    ctx.stroke();
  };
  shadowRing(0, 2 * u, Math.max(2, 4 * u), rgba(palette.edgeTint, 0.35));
  shadowRing(2 * u, 5 * u, Math.max(2, 8 * u), rgba(palette.edgeTint, 0.22));
  shadowRing(4 * u, 10 * u, Math.max(3, 14 * u), rgba(palette.edgeTint, 0.12));
}

// ---------------------------------------------------------------------------
// Offscreen bake + cache
// ---------------------------------------------------------------------------

// Perf: offscreen katman belleği daraltıldı — 2D oyunda 1.5x bake yeterli,
// mobilde ~%25 daha az GPU bellek baskısı ve daha hızlı bake.
const MAX_LAYER_SCALE = 1.5;
const MAX_LAYER_PIXELS = 1_800_000;
const MAX_LAYER_ENTRIES = 2;

const layerCache = new Map();

/**
 * Canvas'ın efektif ölçeği (DPR × world-view `fitWorld` ölçeği). Blit 1:1
 * olsun diye katman tam bu çözünürlükte pişirilir. `getTransform` desteklemeyen
 * ya da sahte ctx'lerde 1'e düşer.
 */
function layerScale(ctx, arena) {
  let scale = 1;
  try {
    if (typeof ctx?.getTransform === 'function') {
      const matrix = ctx.getTransform();
      const a = matrix && Number(matrix.a);
      if (Number.isFinite(a) && a > 0) scale = a;
    }
  } catch {
    scale = 1;
  }
  scale = Math.min(scale, MAX_LAYER_SCALE);
  const area = Math.max(1, arena.width * arena.height) * scale * scale;
  if (area > MAX_LAYER_PIXELS) scale *= Math.sqrt(MAX_LAYER_PIXELS / area);
  return Math.max(0.5, scale);
}

/**
 * Cache anahtarı arena kutusunu 2 CSS px'e kuantlar.
 *
 * Neden: telefonda URL-bar'ı kaybolması ve döndürme jesti saha kutusunu alt-piksel
 * kaydırır. Eski 0.1 px hassasiyeti her karede YENİ anahtar üretiyordu — yani
 * hareket sırasında kare başına bir bake. Katman artık pahalıya pişildiği için bu
 * başına bir takılma olurdu; 2 px görsel olarak görünmez, anahtarı ise kararlı kılar.
 */
function layerKey({ mode, themeId, seed, arena, scale, variant }) {
  const q = quantize2;
  return [
    mode,
    themeId,
    seed,
    q(arena.left),
    q(arena.top),
    q(arena.width),
    q(arena.height),
    scale.toFixed(2),
    variant,
  ].join('|');
}

function createLayerCanvas() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  try {
    const canvas = document.createElement('canvas');
    return typeof canvas?.getContext === 'function' ? canvas : null;
  } catch {
    return null;
  }
}

function evictIfNeeded() {
  while (layerCache.size > MAX_LAYER_ENTRIES) {
    const oldest = layerCache.keys().next().value;
    const entry = layerCache.get(oldest);
    // Backing store'u serbest bırak (mobil bellek).
    if (entry?.canvas) {
      entry.canvas.width = 0;
      entry.canvas.height = 0;
    }
    layerCache.delete(oldest);
  }
}

/** Bake sayaçları — testler ve performans ölçümü için (çizim yolunu değiştirmez). */
export const fieldLayerStats = { bakes: 0, blits: 0, fallbacks: 0, tiles: 0, backdrops: 0 };

/**
 * Sahayı çizer: geçerli bir offscreen katman varsa tek `drawImage`, yoksa
 * katmanı bake edip blit eder; canvas oluşturulamıyorsa (DOM'suz test/SSR)
 * doğrudan çizime düşer — görsel aynı, maliyet eskisi kadardır.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {FieldGeometry} arena - playfield çıktısı (left/top/right/bottom/unit)
 * @param {{mode?: string, theme?: any, seed?: number, marks?: any, patches?: any, variant?: any}} [opts]
 *
 * `marks` bir oyun başına SABİT fonksiyon olmalıdır (modül seviyesinde tanımlanır):
 * cache anahtarı `marks`'i içermez, çünkü aynı `mode` için her frame aynı statik
 * işaretleri bekleriz. Oyununa özgü veriye bağlı katmanlar `variant` ile
 * anahtarlanır (PONG'un kapı boşlukları böyle).
 */
export function drawField(ctx, arena, opts = {}) {
  if (!ctx || !arena) return;
  const width = Number(arena.width) || (Number(arena.right) - Number(arena.left)) || 0;
  const height = Number(arena.height) || (Number(arena.bottom) - Number(arena.top)) || 0;
  if (width <= 0 || height <= 0) return;

  const box = {
    left: Number(arena.left) || 0,
    top: Number(arena.top) || 0,
    width,
    height,
    unit: arenaUnit(arena),
    size: Number(arena.size) || Math.min(width, height),
  };

  const mode = String(opts.mode || 'FIELD');
  const themeId = typeof opts.theme === 'string' ? opts.theme : mode;
  const palette = fieldTheme(opts.theme ?? mode);
  const seed = Number.isFinite(opts.seed) ? (Number(opts.seed) >>> 0) : hashFieldSeed(mode, 0);
  const scale = layerScale(ctx, box);
  const variant = opts.variant || '';
  const key = layerKey({ mode, themeId, seed, arena: box, scale, variant });

  const cached = layerCache.get(key);
  if (cached) {
    layerCache.delete(key);
    layerCache.set(key, cached); // LRU: kullanılan entry sona gider
    fieldLayerStats.blits += 1;
    ctx.drawImage(cached.canvas, box.left, box.top, box.width, box.height);
    return;
  }

  const layer = createLayerCanvas();
  if (!layer) {
    fieldLayerStats.fallbacks += 1;
    ctx.save();
    ctx.translate(box.left, box.top);
    paintFieldLayer(ctx, box, palette, { seed, marks: opts.marks, patches: opts.patches });
    ctx.restore();
    return;
  }

  layer.width = Math.max(1, Math.round(width * scale));
  layer.height = Math.max(1, Math.round(height * scale));
  layer.__fieldRole = 'layer';
  const lctx = layer.getContext('2d');
  if (!lctx) {
    fieldLayerStats.fallbacks += 1;
    ctx.save();
    ctx.translate(box.left, box.top);
    paintFieldLayer(ctx, box, palette, { seed, marks: opts.marks, patches: opts.patches });
    ctx.restore();
    return;
  }

  lctx.setTransform(scale, 0, 0, scale, 0, 0);
  paintFieldLayer(lctx, box, palette, { seed, marks: opts.marks, patches: opts.patches });
  fieldLayerStats.bakes += 1;

  layerCache.set(key, { canvas: layer });
  evictIfNeeded();
  ctx.drawImage(layer, box.left, box.top, box.width, box.height);
}

/** Oyun değişimi / bellek baskısı: tüm bake'leri serbest bırakır. */
export function releaseFieldLayers() {
  for (const entry of layerCache.values()) {
    if (entry?.canvas) {
      entry.canvas.width = 0;
      entry.canvas.height = 0;
    }
  }
  layerCache.clear();
  releaseCaches(tileCache);
  releaseCaches(backdropCache);
}

function releaseCaches(cache) {
  for (const entry of cache.values()) {
    if (entry?.canvas) {
      entry.canvas.width = 0;
      entry.canvas.height = 0;
    }
  }
  cache.clear();
}
