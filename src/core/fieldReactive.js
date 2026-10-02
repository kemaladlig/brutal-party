// Reaktif saha kenarı (docs/ARENA_ELEVATION_PLAN.md Faz 1) — duvar çarpmasının
// ürettiği kinetik esneme, kenar boyunca yayılan enerji dalgası ve darbe
// tozu/kıvılcımı. Statik saha katmanının BİR KEZ pişirilmiş olması yüzünden
// (`fieldKit` offscreen bake) bu tepki oraya giremez; burada yaşar.
//
// Neden motorlardan HİÇBİR kod gerektirmiyor: 12 oyunun tamamı zaten her kare
// `drawField()` çağırıyor ve bu katman blit'in hemen üstüne çizilir. Darbe
// ÜRETİCİ de tek noktadır: `physics2d.clampToArena` — bütün motorların saha
// duvarına temas ettiği yer. Yani "moda özel dal" (§3/§9) yazılmadan 12 oyun
// birden kazanır.
//
// AĞ BÜTCESİ (§6): SIFIR. Durum yalnız çizim yüzeyinde yaşar, paket alanı
// yoktur, `worldView` snapshot'ına girmez. World-view client'ı darbeyi görmez
// (çarpmayı simüle eden yüzey hosttur); bu BİLİNÇLİ bir asimetridir —
// telefonda 2-3 px'lik kenar esnemesi uzaktan okunmaz, buna karşın 30 Hz
// world paketine hiçbir byte eklenmez.
//
// BELLEK (§1 madde 4): sabit boyutlu, önceden tahsis edilmiş havuzlar. Kare
// başına yeni nesne/gradyan/yol YOK. İlerleme `update()` çağrısıyla değil
// `now - stamp` farkıyla türetilir; yani motorun update sırasına hiç girmek
// gerekmez ve boş havuz ctx'ye TEK bir çizim bile yapmaz.
//
// DETERMİNİZM: toz/kıvılcım yönleri `hash01(seed)`'den türer, `Math.random`
// yok — aynı darbe her zaman aynı görünür (beklenmedik "yağma" olmaz).

import { motionScale } from '../ui/motion.js';

/** Eşzamanlı duvar darbesi üst sınırı (havuz taşarsa en eskisi geri döner). */
export const WALL_IMPACT_CAP = 6;
/** Eşzamanlı darbe zerresi (toz + kıvılcım) üst sınırı. */
export const WALL_DEBRIS_CAP = 18;
/**
 * Darbe eşiği (tasarım px/s, normal yöndeki yaklaşma hızı). Yürüyüş ~200-280
 * tasarım px/s olduğu için eşiğin üstünde yalnız DASH/TACKLE/roket gibi
 * yüksek hızlı temaslar geçer; duvara yaslanıp yürümek tepki üretmez.
 */
export const WALL_IMPACT_MIN_SPEED = 300;
/** Bu tasarım px/s'de tepki tam güçte (bir dolu dash). */
const WALL_IMPACT_FULL_SPEED = 520;

// --- tepkinin zaman ve ölçü bütçesi (hepsi `unit` ile çarpılır) ---
const IMPACT_LIFE = 0.34;      // toplam ömür (sn)
const DENT_LIFE = 0.09;        // çarpma noktasındaki elastik dişin ömrü (~5 kare)
const DENT_DEPTH = 7;          // dişin içeri ittiği en fazla derinlik
const DENT_LEN = 26;           // dişin kenar boyunca yarı uzunluğu
const WAVE_SPEED = 620;        // enerji dalgasının kenar boyunca yayılma hızı
const WAVE_LEN = 20;           // dalga parçasının kenar boyunca yarı uzunluğu
const WAVE_DEPTH = 5;          // dalganın içeri ittiği derinlik
const WAVE_COUNT = 3;          // kenarın iki yana kaç parça yayılır
const WAVE_GAP = 0.045;        // parçalar arası gecikme
const DEBRIS_LIFE = 0.36;      // toz/kıvılcım ömrü
const REFRESH_WINDOW = 0.07;   // aynı noktadaki yeni darbe eskisini tazeler
const REFRESH_SPAN = 10;       // "aynı nokta" yarıçapı (cihaz px)

const TAU = Math.PI * 2;

/**
 * Monotonik saat. `fieldKit` içindeki determinizm yasağı YALNIZ bake katmanı
 * içindeydir; buradaki tepki ağda taşınmayan, çizim yüzeyinde doğan bir
 * sunumdur, bu yüzden duvar saati kullanmak güvenlidir (ve sekme gizliyken
 * donanın tek davranışı "süresi dolmuş çizim"dir).
 */
const clock = (typeof performance !== 'undefined' && typeof performance.now === 'function')
  ? () => performance.now()
  : () => Date.now();

/** tamsayıdan 0..1 — kıymık yönlerinin tek, tekrarlanabilir kaynağı. */
function hash01(n) {
  let x = (n | 0) + 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

/**
 * Tepkinin koyu rengi — `palette.edgeTint` (tema kenar tonu) tam opak, geri
 * kalan gücü `globalAlpha` verir.
 *
 * Neden önbellek: tema başına bir dize, kare başına bir dize DEĞİL. Anahtar
 * RGB üçlüsünün kendisi (ilkel string), yani arama tahsis yapmaz. `palette`
 * alanları ilkel tipte olduğu için (THEME_BASE sözleşmesi) iç içe obje
 * yazılamaz; üçlüden dize kurmak burada, tek yerde olmalı.
 */
const inkCache = new Map();
function reactionInk(palette) {
  const key = String(palette?.edgeTint);
  let ink = inkCache.get(key);
  if (ink === undefined) {
    ink = `rgba(${key}, 1)`;
    inkCache.set(key, ink);
  }
  return ink;
}

// --- havuzlar (bir kez tahsis, sonra yalnız alan yazımı) ---------------------
/** @type {{x:number,y:number,nx:number,ny:number,power:number,unit:number,stamp:number,alive:boolean}[]} */
const impacts = [];
/** @type {{x0:number,y0:number,vx:number,vy:number,size:number,glint:boolean,stamp:number,maxLife:number,alive:boolean}[]} */
const debris = [];

for (let i = 0; i < WALL_IMPACT_CAP; i += 1) {
  impacts.push({ x: 0, y: 0, nx: 1, ny: 0, power: 0, unit: 1, stamp: -Infinity, alive: false });
}
for (let i = 0; i < WALL_DEBRIS_CAP; i += 1) {
  debris.push({ x0: 0, y0: 0, vx: 0, vy: 0, size: 0, glint: false, stamp: -Infinity, maxLife: DEBRIS_LIFE, alive: false });
}

/**
 * Saha duvarına darbe kaydeder. TEK çağıran: `physics2d.clampToArena`.
 *
 * @param {{x:number, y:number, nx:number, ny:number, speed:number, unit?:number}} hit
 *   `x,y` temas noktası (cihaz px, canvas uzayı); `nx,ny` duvara dik ve
 *   SAHANIN İÇİNE bakan eksen hâli (sol duvar → +1, üst duvar → +1).
 *   Eksen hâlinde gelmesi şart: kenar hangi tarafta, teğet hangi eksen
 *   çizilecek tek veriden çıkar.
 * @returns {boolean} kayıt gerçekten açıldıysa true
 */
export function emitWallImpact({ x, y, nx, ny, speed, unit = 1 }) {
  // UCUZ EŞİKLER ÖNCE: `motionScale` tercih deposunu okur, sıcak yolda
  // (clampToArena kare başına onlarca kez) önemsiz bir çağrı olmamalı.
  const u = Number.isFinite(unit) && unit > 0 ? unit : 1;
  const minSpeed = WALL_IMPACT_MIN_SPEED * u;
  if (!Number.isFinite(speed) || speed <= minSpeed) return false;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(nx) || !Number.isFinite(ny)) return false;
  if (motionScale() <= 0) return false;

  const power = Math.max(0, Math.min(1, (speed - minSpeed) / Math.max(1, (WALL_IMPACT_FULL_SPEED - WALL_IMPACT_MIN_SPEED) * u)));
  const now = clock();
  // Eksen HALE: `clampToArena` eksen hâlinde normal üretir (alt duvar → 0,-1).
  // `Math.sign` DEĞİL, terner de DEĞİL: `nx >= 0 ? 1 : -1` sıfırı +1 yapardı ve
  // alt duvar darbesi sol duvar gibi, arenanın DIŞINA taşarak çizilirdi.
  const ax = nx > 0 ? 1 : nx < 0 ? -1 : 0;
  const ay = ny > 0 ? 1 : ny < 0 ? -1 : 0;

  // SPAM FRENİ: aynı kenarda, aynı noktaya çok yakın zamanda gelen ikinci
  // darbe YENİ kayıt açmaz — mevcut olanın gücünü tazeler. Kalabalık bir
  // sürünün duvara yaslanması havuzu şişirip kare maliyetini şişirmemeli.
  for (let i = 0; i < impacts.length; i += 1) {
    const im = impacts[i];
    if (!im.alive) continue;
    if (im.nx === ax && im.ny === ay
      && Math.abs(im.x - x) <= REFRESH_SPAN * u
      && Math.abs(im.y - y) <= REFRESH_SPAN * u
      && now - im.stamp < REFRESH_WINDOW * 1000) {
      im.stamp = now;
      im.power = Math.max(im.power, power);
      return false;
    }
  }

  // Boş yuva yoksa en eskisini geri dönüştür (havuz SABİT boyutlu).
  let slot = impacts[0];
  let slotIndex = 0;
  for (let i = 1; i < impacts.length; i += 1) {
    if (!impacts[i].alive) { slot = impacts[i]; slotIndex = i; break; }
    if (impacts[i].stamp < slot.stamp) { slot = impacts[i]; slotIndex = i; }
  }
  slot.x = x;
  slot.y = y;
  slot.nx = ax;
  slot.ny = ay;
  slot.power = power;
  slot.unit = u;
  slot.stamp = now;
  slot.alive = true;

  spawnDebris(x, y, ax, ay, power, u, now, slotIndex);
  return true;
}

/**
 * Çarpma noktasından içeri savrulan 2-3 zerre: gri taş tozu + parlak kıvılcım.
 * Sayı güçle artar; yön ve boyut yalnız DARBENİN KENDİSİNDEN türer (x, y,
 * yuva indeksi) — global bir sayaç olsaydı aynı darbe ikinci kez üretildiğinde
 * farklı kıymıklar çıkar ve katar test edilemez hale gelirdi.
 */
function spawnDebris(x, y, ax, ay, power, u, now, slotIndex) {
  const base = (Math.round(x) * 73856093) ^ (Math.round(y) * 19349663) ^ (slotIndex * 83492791);
  const count = Math.round(2 + power);
  for (let k = 0; k < count; k += 1) {
    const seed = (base + Math.imul(k + 1, 2654435761)) | 0;
    let slot = debris[0];
    for (let i = 1; i < debris.length; i += 1) {
      if (!debris[i].alive) { slot = debris[i]; break; }
      if (debris[i].stamp < slot.stamp) slot = debris[i];
    }
    // Normalin içe bakan tarafına ±1.1 radye yayılım: hiçbir zerre duvarın
    // DIŞINA kaçamaz, yani tepki arenanın dışına taşmaz.
    const heading = Math.atan2(ay, ax) + (hash01(seed * 2 + 1) * 2 - 1) * 1.1;
    const speed = (70 + hash01(seed * 7 + 3) * 130) * u * (0.45 + 0.55 * power);
    slot.x0 = x;
    slot.y0 = y;
    slot.vx = Math.cos(heading) * speed;
    slot.vy = Math.sin(heading) * speed;
    slot.glint = hash01(seed * 5 + 11) < 0.4;
    slot.size = (slot.glint ? 2.4 : 3.4) * u * (0.7 + 0.6 * power);
    slot.stamp = now;
    slot.alive = true;
  }
}

/** Havuzları boşaltır — oyun değişimi / katman serbest bırakma. */
export function clearFieldReactive() {
  for (let i = 0; i < impacts.length; i += 1) impacts[i].alive = false;
  for (let i = 0; i < debris.length; i += 1) debris[i].alive = false;
}

/** Tanılama: canlı darbe/zerre sayısı (testler ve perf ölçümü). */
export const fieldReactiveStats = { impacts: 0, debris: 0 };

/**
 * Çarpma noktasındaki kenarı çizer: önce 1-2 kare içinde girip geri dönen
 * elastik katlama (koyu bir katlanmış kama + kenarındaki ışık çizgisi), sonra
 * kenarın iki yana doğru sönen enerji dalgası. Hepsi arena-içi ofsetlerdir;
 * dışarı taşma olmaz.
 *
 * KOYU NEDEN: zemin krem (L* 92-97) ve rim zaten beyaza yakın. Beyaz bir vuruş
 * zeminde kaybolur; koyu bir kıvrım okunur. Bu yüzden tepki dgeInk
 * (α 0.16 — zeminde effectively görünmez) değil, temanın dgeTint'inden
 * türeyen tam siyah bir taban + globalAlpha ile sönümlemedir.
 */
function paintImpact(ctx, im, age, palette) {
  // KENAR BELİRLEME: baskın eksen. `emitWallImpact` kaydı zaten eksen hâline
  // getiriyor, ama burada ikinci kez çözüyoruz — savunma derinliği: çapraz ya da
  // bozuk bir normal gelirse bile çizim arenanın dışına (yanlış eksende)
  // çıkamaz, yalnız baskın kenara oturur.
  const ax = Math.abs(im.nx);
  const ay = Math.abs(im.ny);
  const vertical = ax >= ay;                    // sol/sağ duvar
  const inward = (vertical ? im.nx : im.ny) < 0 ? -1 : 1;
  const edge = vertical ? im.x : im.y;
  const t = vertical ? im.y : im.x;
  const u = im.unit;

  ctx.save();
  ctx.lineCap = 'round';

  // 1) Elastik katlama — kenar içeri doğru katlanır (yamuk yelpaze) ve geri
  //    düzelir. Uzunluğu açılırken derinliği söner: vuruş "esneyip" görünür.
  const dentT = age / DENT_LIFE;
  if (dentT < 1) {
    const depth = DENT_DEPTH * u * im.power * Math.sin(Math.PI * dentT);
    const half = DENT_LEN * u * (0.45 + 0.55 * dentT);
    ctx.globalAlpha = (1 - dentT) * 0.5;
    ctx.fillStyle = reactionInk(palette);
    ctx.beginPath();
    appendImpactFold(ctx, vertical, edge, inward, t, half, depth);
    ctx.fill();

    // Katlanan kenarın ışık çizgisi: koyu kamanın üstünde tek parlak kenar —
    // "burada bir malzeme eğildi" okumasının asıl ipucu.
    ctx.globalAlpha = (1 - dentT) * 0.75;
    ctx.strokeStyle = palette.edgeLight;
    ctx.lineWidth = Math.max(1, 1.6 * u);
    ctx.beginPath();
    appendImpactSegment(ctx, vertical, edge, inward, t, depth, half * 0.45);
    ctx.stroke();
  }

  // 2) Enerji dalgası — kenar boyunca iki yana, sönerek.
  for (let k = 0; k < WAVE_COUNT; k += 1) {
    const waveAge = age - k * WAVE_GAP;
    if (waveAge <= 0 || waveAge >= IMPACT_LIFE) continue;
    const fade = 1 - waveAge / IMPACT_LIFE;
    const pulse = Math.sin(Math.PI * Math.min(1, waveAge / DENT_LIFE));
    const depth = pulse * WAVE_DEPTH * u * im.power * fade;
    const reach = WAVE_SPEED * u * waveAge;
    ctx.globalAlpha = fade * 0.32;
    ctx.strokeStyle = reactionInk(palette);
    ctx.lineWidth = Math.max(1, 2.4 * u);
    ctx.beginPath();
    appendImpactSegment(ctx, vertical, edge, inward, t - reach, depth, WAVE_LEN * u * 0.5);
    appendImpactSegment(ctx, vertical, edge, inward, t + reach, depth, WAVE_LEN * u * 0.5);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Kenarın içeri katlanmış dört köşeli yelpazesi: kenarda geniş, içeride dar.
 * `fill` ile çizildiği için ince bir stroke'a göre üçte bir piksel kalınlıkta
 * bile okunur.
 */
function appendImpactFold(ctx, vertical, edge, inward, t, half, depth) {
  const pos = edge + inward * depth;
  const inner = half * 0.45;
  if (vertical) {
    ctx.moveTo(edge, t - half);
    ctx.lineTo(pos, t - inner);
    ctx.lineTo(pos, t + inner);
    ctx.lineTo(edge, t + half);
  } else {
    ctx.moveTo(t - half, edge);
    ctx.lineTo(t - inner, pos);
    ctx.lineTo(t + inner, pos);
    ctx.lineTo(t + half, edge);
  }
  ctx.closePath();
}

/** Kenara paralel, içeri `depth` kadar itilmiş tek parça (moveTo/lineTo). */
function appendImpactSegment(ctx, vertical, edge, inward, t, depth, halfLen) {
  const pos = edge + inward * depth;
  if (vertical) {
    ctx.moveTo(pos, t - halfLen);
    ctx.lineTo(pos, t + halfLen);
  } else {
    ctx.moveTo(t - halfLen, pos);
    ctx.lineTo(t + halfLen, pos);
  }
}

/**
 * Reaktif kenar katmanını arena uzayında çizer. `fieldKit.drawField` statik
 * blit'inin hemen ardından çağırır — varlıkların ALTINDA kalır.
 *
 * BOŞ HAVUZ TEMSİLİ YOK: ctx'ye hiç dokunmadan döner, yani "aynı seed ⇒ aynı
 * katman" log-karşılaştırması bozulmaz.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {FieldGeometry} box arena kutusu (yalnız varlık kontrolü)
 * @param {FieldPalette} palette `fieldTheme()` çıktısı
 */
export function drawFieldReactive(ctx, box, palette) {
  if (!ctx || !box) return;
  const now = clock();
  const left = Number(box.left) || 0;
  const top = Number(box.top) || 0;
  const right = left + (Number(box.width) || 0);
  const bottom = top + (Number(box.height) || 0);

  // SÜPÜRME: süresi dolmuş kayıtları kapat, kalanları say. Yenisi doğmadıysa
  // ctx'ye hiç dokunulmadan dönülür (boş havuz = temsili yok).
  let liveImpacts = 0;
  for (let i = 0; i < impacts.length; i += 1) {
    const im = impacts[i];
    if (!im.alive) continue;
    const age = (now - im.stamp) / 1000;
    // Arena kutusu resize ile değişmiş olabilir; eski koordinattaki darbe
    // yeni arenanın kenarında değildir, çizilmez (ömür zaten 0.34 sn).
    if (age < 0 || age >= IMPACT_LIFE
      || im.x < left - 1 || im.x > right + 1 || im.y < top - 1 || im.y > bottom + 1) {
      im.alive = false;
      continue;
    }
    liveImpacts += 1;
  }
  let liveDebris = 0;
  for (let i = 0; i < debris.length; i += 1) {
    const d = debris[i];
    if (!d.alive) continue;
    const age = (now - d.stamp) / 1000;
    if (age < 0 || age >= d.maxLife) { d.alive = false; continue; }
    liveDebris += 1;
  }
  fieldReactiveStats.impacts = liveImpacts;
  fieldReactiveStats.debris = liveDebris;
  if (liveImpacts === 0 && liveDebris === 0) return;

  // KIRPMA: darbe hep duvarın ÜSTÜNDE doğar ve içe doğru açılır, ama toz
  // teğet yönde yürürken komşu duvarın DIŞINA taşabilir (özellikle köşeye
  // yakın darbelerde). Arena kutusuna kırpmak bunu ucuz ve kesin çözer: tepki
  // asla saha dışı zemine, tepsi kenarının üstüne taşmaz. Kırpma yalnız
  // tepki varken (≤0.34 sn) aktiftir, boş havuzda maliyet sıfırdır.
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
  ctx.clip();

  for (let i = 0; i < impacts.length; i += 1) {
    if (impacts[i].alive) paintImpact(ctx, impacts[i], (now - impacts[i].stamp) / 1000, palette);
  }

  for (let i = 0; i < debris.length; i += 1) {
    const d = debris[i];
    if (!d.alive) continue;
    const age = (now - d.stamp) / 1000;
    const k = age / d.maxLife;
    // Sürükleme kapalı biçimi: yol = v·t·(1 - k/2). Karesel değil, tek çarpma
    // var, duraklayan bir kıymık okunuyor.
    const travel = age * (1 - 0.5 * k);
    ctx.globalAlpha = (1 - k) * (d.glint ? 0.9 : 0.62);
    ctx.fillStyle = d.glint ? palette.edgeLight : reactionInk(palette);
    ctx.beginPath();
    ctx.arc(d.x0 + d.vx * travel, d.y0 + d.vy * travel, Math.max(0.5, d.size * (1 - 0.4 * k)), 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}