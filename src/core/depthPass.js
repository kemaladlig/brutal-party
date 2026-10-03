// Sahne DERİNLİK SIRASI (2.5D yaşayan diorama) — engeller, eşyalar ve
// oyuncuları TEK y-sıralı listede çizer.
//
// Sorun: 7 view (BOMB/ARCHER/HEIST/NINJA/SNAKE/TANKS/HORDE) önce TÜM
// engelleri, sonra TÜM oyuncuları çiziyordu. Bir karakter bloğun arkasına
// geçtiğinde bile üstte kalıyordu — yani sahne "yassı bir katman yığını"
// gibi okunuyordu. Brawl Stars / Smash'teki derinlik okunabilirliği tam olarak
// bu eksik olan şeydir.
//
// Çözümün şekli: motorlar kendi çizim listelerini bir havuza YAZAR, sonra
// TEK bir `flush` sırayı y-sırasında çizer. Sıralama görsel katmanıdır; hiçbir
// paket alanı, simülasyon girdisi veya motor dalı gerektirmez (AGENTS §3/§6).
//
// BELLEK (§1 madde 4): sabit havuz. Kare başına nesne tahsisi YOK — slot
// dizileri bir kez ayrılır, karede yalnız ALAN YAZIMI yapılır. View'lar
// `draw`/`opts` olarak MODÜL SEVİYESİ sabitler geçirir; kare içinde
// `() => {}` kapanışı yaratmak yasaktır (kare başına 4-64 yeni fonksiyon =
// 60 Hz'de binlerce nesne).
//
// AĞ BÜTÇESİ (§6): SIFIR alan. Sıralama tamamen çizim yüzeyinde yaşar.
//
// BELİRLEYİCİLİK: aynı `y` için giriş SIRASI korunur (stable insertion) —
// iki varlık tam aynı derinlikteyse hangisinin üstte olduğu oyun tarafından,
// kare içinde belirsiz bir karşılaştırmayla değil, view'ın yazdığı sırayla
// sabittir.

/** Eşzamanlı sahne varlığı tavanı. 4 oyuncu + 16 engel + 12 eşya + yedek. */
export const DEPTH_CAP = 48;

/**
 * Katman kimlikleri. Sayısal: sıralama karşılaştırmasında string karşılaştırması
 * yapmıyoruz, eşitlikte giriş sırası esastır.
 */
export const DEPTH_KIND = Object.freeze({
  OBSTACLE: 0,
  PICKUP: 1,
  PLAYER: 2,
  GROUND: 3,
});

/** Çizim çağrısı — hepsi tek imza: `(ctx, ref, opts)`. */
export const DEPTH_DRAW = Object.freeze({
  OBSTACLE: 'obstacle',
  PICKUP: 'pickup',
  PLAYER: 'player',
});

/** Havuz — bir kez tahsis, sonra yalnız alan yazımı. */
const slots = [];
for (let i = 0; i < DEPTH_CAP; i += 1) {
  slots.push({ y: 0, kind: 0, ref: null, draw: null, opts: null });
}
let count = 0;
/** Taşma sayacı — teşhis/test için; taşmada en eski slot geri dönüşür. */
let overflow = 0;

export const depthPassStats = { count: 0, overflow: 0, flushed: 0 };

/** Kareyi sıfırlar. `flushDepthPass` zaten çağrılıyorsa bu TEK satırdır. */
export function beginDepthPass() {
  count = 0;
  overflow = 0;
  depthPassStats.count = 0;
  depthPassStats.overflow = 0;
  depthPassStats.flushed = 0;
}

/**
 * Bir varlığı havuza yazar.
 *
 * @param {number} y - TABAN derinliği (gövdenin alt kenarı / bloğun alt kenarı)
 * @param {number} kind - `DEPTH_KIND`
 * @param {any} ref - çizilecek veri (obstacle / pickup / player)
 * @param {(ctx: any, ref: any, opts: any) => void} draw - MODÜL SABİTİ olmalı
 * @param {any} opts - MODÜL SABİTİ olmalı
 */
export function pushDepthItem(y, kind, ref, draw, opts) {
  if (count >= DEPTH_CAP) {
    // Taşma: en ESKİ giriş geri döner, yerine yenisi yazılır. Sıralamayı
    // bozmamak için dizi bir kaydırılır — sahne küçük (≤48), taşma zaten
    // sıfır olması gereken bir durum (havuz yetmiyorsa bu görsel bir
    // varsayımdır, sessizce varlık düşürmek daha kötüsü).
    //
    // Yanlış sürüm notu: `count -= 1` sonrası yazmak EN YENİ slotu ezer,
    // yani taşmada en yeni varlık kaybolurdu — oyuncu genelde en yeni
    // yazılan şey olduğu için görsel olarak en pahalı hata.
    for (let i = 1; i < count; i += 1) {
      slots[i - 1].y = slots[i].y;
      slots[i - 1].kind = slots[i].kind;
      slots[i - 1].ref = slots[i].ref;
      slots[i - 1].draw = slots[i].draw;
      slots[i - 1].opts = slots[i].opts;
    }
    overflow += 1;
    depthPassStats.overflow = overflow;
    count -= 1;
  }
  const slot = slots[count];
  slot.y = Number.isFinite(y) ? y : 0;
  slot.kind = kind;
  slot.ref = ref;
  slot.draw = draw;
  slot.opts = opts;
  count += 1;
  depthPassStats.count = count;
}

/**
 * Havuzu y-sırasında çizer ve boşaltır.
 *
 * Sıralama: stable insertion sort. Karşılaştırma tek sayı — `y`'deki `<=`
 * eşitliğinde kaydırma DURUR, yani giriş sırası korunur. 48 elemanlı bir
 * dizide n²/4 ≈ 576 karşılaştırma, sahne başına ~1 µs; `Array.prototype.sort`
 * çağırmak kare başına comparator tahsisi demekti.
 */
export function flushDepthPass(ctx) {
  if (!ctx || count === 0) {
    count = 0;
    return;
  }
  for (let i = 1; i < count; i += 1) {
    const key = slots[i].y;
    const kind = slots[i].kind;
    const ref = slots[i].ref;
    const draw = slots[i].draw;
    const opts = slots[i].opts;
    let j = i - 1;
    while (j >= 0 && slots[j].y > key) {
      slots[j + 1].y = slots[j].y;
      slots[j + 1].kind = slots[j].kind;
      slots[j + 1].ref = slots[j].ref;
      slots[j + 1].draw = slots[j].draw;
      slots[j + 1].opts = slots[j].opts;
      j -= 1;
    }
    slots[j + 1].y = key;
    slots[j + 1].kind = kind;
    slots[j + 1].ref = ref;
    slots[j + 1].draw = draw;
    slots[j + 1].opts = opts;
  }
  for (let i = 0; i < count; i += 1) {
    const slot = slots[i];
    if (typeof slot.draw === 'function') slot.draw(ctx, slot.ref, slot.opts);
  }
  depthPassStats.flushed = count;
  count = 0;
  // Sayaç flush sonrası da havuzu YANSITMALI: teşhis ve testler `count`'i
  // "şu an kaç varlık sırada" diye okur, "son push'tan bu yana kaç tane"
  // diye değil.
  depthPassStats.count = 0;
}

/**
 * Engel için taban derinliği: bloğun ALT kenarı. 2.5D ön cephe aşağı
 * doğru uzandığı için varlık, bloğun tabanı ne kadar aşağıdaysa o kadar önde
 * durmalıdır.
 * @param {{y?: number, h?: number}} obs
 */
export function obstacleDepth(obs) {
  const y = Number(obs?.y);
  const h = Number(obs?.h);
  return (Number.isFinite(y) ? y : 0) + (Number.isFinite(h) ? h : 0);
}

/**
 * Yuvarlak gövde için taban derinliği: merkez + temas gölgesinin oturduğu
 * yer. Gövde yarıçapına ORANlıdır (ham px yazılmaz, AGENTS §3).
 * @param {{y?: number, radius?: number}} entity
 */
export function entityDepth(entity) {
  const y = Number(entity?.y);
  const r = Number(entity?.radius);
  return (Number.isFinite(y) ? y : 0) + (Number.isFinite(r) ? r : 0) * 0.72;
}

/** Oyun/görünüm değişiminde havuzu bırakır (yarım kalmış sahne olmasın). */
export function clearDepthPass() {
  beginDepthPass();
  for (let i = 0; i < slots.length; i += 1) {
    slots[i].ref = null;
    slots[i].draw = null;
    slots[i].opts = null;
  }
}