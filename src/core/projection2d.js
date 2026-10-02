// 2.5D PROJEKSİYON ÇEKİRDEĞİ — saf Canvas eğik kamera.
//
// Dünya yine bir düzlemdir (x = doğu, y = güney/derinlik, z = yükseklik).
// Görünen eğik kamera iki kuraldan doğar:
//   • y ekseni TILT ile sıkışır        → kameranın yere eğik bakışı
//   • yükseklik (z) ekranda YUKARI taşar → prizma/silindir hacmi
// `PERSP` (derinliğe göre yatay genişleme) opsiyoneldir; varsayılan 0, yani
// paralel/aksonometrik izdüşüm — ufuk noktası yok, daha basit ters projeksiyon.
//
// Derinlik sıralaması çağıranın işidir (taban-y'ye göre painter's order; bkz.
// `core/arenaKit.sceneDraw`). Bu modül yalnız geometri üretir; renkleri
// `ui/tokens.js` sözlüğünden alır (K2), kare başına tahsis yapmaz.
//
// SİMÜLASYONA DOKUNMAZ: `computePlayfield`/`fieldSpeed`/çarpışma tepeden bakış
// (x, y) uzayında kalır; burası yalnız çizim/sunum dönüşümüdür. Tek istisna
// `unproject` — eğik kamerada ekran→zemin eşlemesi (gelecekteki giriş
// vuruları için); BOMB oyun içi girdisi joystick vektörü olduğu için kullanmaz.

import { UI_COLORS } from '../ui/tokens.js';
import { FIELD_DESIGN } from './playfield.js';
import { fieldTexture } from './fieldTextures.js';

export const TILT = 0.720;     // y sıkışması = sin(kamera yükseklik açısı) (≈46°: daha eğik/izometrik bakış)
export const PERSP = 0;        // sahte perspektif KAPALI (paralel/aksonometrik; ters projeksiyon sadeleşir)

/**
 * 2.5D oyunların kamera sunumu (host↔client TEK kaynak).
 *
 * Proje varsayılanı `TILT` (0.72 ≈ 46°) kullanılır: eğik/izometrik okunuş
 * korunur — prizma cepheleri ve ray ekstrüzyonu görünür kalır. Daha tepeden
 * bir açı (örn. 0.92) `fit` ölçeğini küçültüp zemini neredeyse tam boya
 * getirdiği için 2.5D etkiyi ikiye katlayarak söndürür (önce zemin
 * sıkışması gider, sonra yükseklikler küçülür) ve sahne tepeden bakışa
 * döner; dikey dolgu için açı yükseltilmez. İki taraf da bu sabiti
 * kullanmazsa sahne kayar.
 */
export const TILTED_25D_CAMERA = Object.freeze({
  snake: Object.freeze({ tilt: 0.72, extraW: 40 }),
  bomb: Object.freeze({ tilt: 0.72, extraW: 40 }),
  heist: Object.freeze({ tilt: 0.72, extraW: 40 }),
  crown: Object.freeze({ tilt: 0.72, extraW: 40 }),
  archer: Object.freeze({ tilt: 0.72, extraW: 40 }),
  horde: Object.freeze({ tilt: 0.72, extraW: 40 }),
  collapse: Object.freeze({ tilt: 0.72, extraW: 40 }),
  zone: Object.freeze({ tilt: 0.72, extraW: 40 }),
  curve: Object.freeze({ tilt: 0.72, extraW: 40 }),
  ninja: Object.freeze({ tilt: 0.72, extraW: 40 }),
  tanks: Object.freeze({ tilt: 0.72, extraW: 40 }),
  pong: Object.freeze({ tilt: 0.72, extraW: 40 }),
});

/**
 * @typedef {{top: string, front: string, side: string, tex?: any, texAlpha?: number, texOx?: number, texOy?: number}} Material  — `tex` isteğe bağlı DOKU bindirmesidir (desen/pattern değil: `createPattern` kare başına yasaktır)
 * @typedef {{x: number, y: number, d: number}} ScreenPt
 * @typedef {{width: number, height: number}} Viewport
 * @typedef {{left: number, top: number, right: number, bottom: number, cx: number, cy: number, width: number, height: number, size: number}} Arena
 * @typedef {{
 *   view: { w: number, h: number, scale: number, ox: number, oy: number },
 *   cam: { x: number, y: number },
 *   railW: number,
 *   railH: number,
 *   tilt: number,
 *   persp: number,
 *   obstacleHeightScale: number,
 *   theme: any,
 *   themeName: string,
 *   fit: (viewport: Viewport, arena: Arena, opts?: { extraW?: number, extraH?: number, yBias?: number, theme?: string }) => { railW: number, railH: number },
 *   proj: (x: number, y: number, z?: number) => ScreenPt,
 *   unproject: (sx: number, sy: number) => { x: number, y: number },
 *   quad: (ctx: CanvasRenderingContext2D, a: ScreenPt, b: ScreenPt, c: ScreenPt, d: ScreenPt, fill?: string) => void,
 *   strokePoly: (ctx: CanvasRenderingContext2D, pts: ScreenPt[], color: string, width: number, close?: boolean) => void,
 *   contactPatch: (ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, alpha?: number, color?: string) => void,
 *   groundEllipse: (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, alpha?: number) => void,
 *   groundRing: (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, width: number) => void,
 *   drawPrism: (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, d: number, h: number, pal: Material, lineW?: number) => void,
 *   drawCylinder: (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, h: number, pal: Material) => void,
 *   drawSphere: (ctx: CanvasRenderingContext2D, x: number, y: number, z: number, r: number, pal: Material) => void,
 * }} Projector
 */

/** 2.5D palet sözlüğü (tokens'tan). Motorlar mat/tray/mürekkep renklerini buradan alır. */
export const ARENA25D = UI_COLORS.arena25d;
const A = ARENA25D;
const THEMES = UI_COLORS.arena25dThemes;

export const DEFAULT_THEME_25D = 'wood';

/** İsimle tema çöz; bilinmeyen isim ahşap temasına düşer. */
export function theme25d(name) {
  return THEMES[name] || THEMES[DEFAULT_THEME_25D];
}

/** Renk → prizma/silindir malzemesi (gövde figürü, engel, tampon). */
export function materialFromColor(hex) {
  const base = (typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex)) ? hex : A.mat25d;
  return { top: shade(base, 0.18), front: base, side: shade(base, -0.22) };
}

/** Renk tonu uyarlama: `pct > 0` beyaza, `pct < 0` siyaha doğru. */
export function shade(hex, pct) {
  const s = String(hex || '');
  if (!/^#[0-9a-f]{6}$/i.test(s)) return s;
  const n = parseInt(s.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const t = pct < 0 ? 0 : 255;
  const p = Math.abs(pct);
  r = Math.round((t - r) * p + r);
  g = Math.round((t - g) * p + g);
  b = Math.round((t - b) * p + b);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Kenar tamponı malzemesi (kuzey/güney/doğu/batı). */
export function railMaterial(theme, side) {
  const rails = (theme && theme.rails) || A.rail25d;
  return rails[side] || rails.north;
}

/**
 * Malzeme dokusunu bir dikdörtgene KARO KARO basar (doğal ölçek korunur).
 *
 * Neden tek gerilmiş `drawImage` değil: 48 px'lik damga 200 px'lik bir duvara
 * gerilince damar çizgileri bulanık bir gradyana dönüşür — doku okunmaz,
 * "yumuşak ton" olur (gözle doğrulandı: karo öncesi çarşafta ahşap damarı
 * yerine düz bir geçiş görünüyordu). Karo doğal ölçekte kaldığı için karo
 * sayısı blok boyutuyla artar; tavan aşılırsa tek gerilmiş blit'e düşülür:
 * zayıf ama ucuz ve SABİT maliyetli.
 *
 * Çağıran KIRPMAYI açar (karolar dikdörtgenin dışına taşar). `drawImage`
 * sayılmaz; döngü op bütçesini değil yalnız blit sayısını etkiler.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Material} pal
 * @param {number} x @param {number} y @param {number} w @param {number} h
 */
const MATERIAL_TILE_MAX = 16;
export function paintMaterialTexture(ctx, pal, x, y, w, h) {
  const tex = pal && pal.tex;
  if (!tex || !(w > 0 && h > 0)) return;
  const alpha = Number.isFinite(pal.texAlpha) ? pal.texAlpha : 0.16;
  if (!(alpha > 0)) return;
  // Karo, GÖRÜNTÜNÜN CİHAZ pikselinde 1:1 kalsın: DPR'li ekranda 48 px'lik
  // damgayı 48 CSS px'e basmak onu 2x BÜYÜTÜR (doku bulanır). CTM ölçeği
  // yoksa (test ctx'i) 1'e düşülür.
  let ctm = 1;
  try {
    if (typeof ctx.getTransform === 'function') {
      const m = ctx.getTransform();
      if (m && Number.isFinite(Number(m.a)) && Number(m.a) > 0) ctm = Number(m.a);
    }
  } catch { ctm = 1; }
  const size = (Number(tex.width) || 48) / ctm;
  const ox = (((pal.texOx || 0) % size) + size) % size;
  const oy = (((pal.texOy || 0) % size) + size) % size;
  ctx.save();
  ctx.globalAlpha = alpha;
  const cols = Math.ceil((w + ox) / size);
  const rows = Math.ceil((h + oy) / size);
  if (cols * rows > MATERIAL_TILE_MAX) {
    ctx.drawImage(tex, x, y, w, h);
  } else {
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        ctx.drawImage(tex, x - ox + c * size, y - oy + r * size, size, size);
      }
    }
  }
  ctx.restore();
}

/** @returns {Projector} */
/**
 * Eğik kamera üretir. `opts.tilt` derinlik sıkışması (= sin(kamera yükseklik
 * açısı)), `opts.persp` sahte perspektif gücüdür. Verilmezse modül
 * varsayılanları (`TILT`/`PERSP`). Açı bir sunum tercihidir; simülasyona
 * dokunmaz, host↔client aynı değeri kurarsa sahne eşleşir.
 * @param {{ tilt?: number, persp?: number, obstacleHeightScale?: number }} [opts]
 */
export function createProjector(opts = {}) {
  const view = { w: 1, h: 1, scale: 1, ox: 0, oy: 0 };
  const cam = { x: 0, y: 0 };
  /** @type {Projector} */
  const P = /** @type {any} */ ({
    view, cam, railW: 28, railH: 26,
    tilt: Number.isFinite(opts.tilt) ? Number(opts.tilt) : TILT,
    persp: Number.isFinite(opts.persp) ? Number(opts.persp) : PERSP,
    obstacleHeightScale: Number.isFinite(opts.obstacleHeightScale) ? Number(opts.obstacleHeightScale) : 1,
    theme: theme25d(DEFAULT_THEME_25D), themeName: DEFAULT_THEME_25D,
  });

  /**
   * @param {{ width?: number, height?: number }} viewport
   * @param {any} arena
   * @param {{ extraW?: number, extraH?: number, yBias?: number, theme?: string }} [opts]
   */
  function fit(viewport, arena, { extraW = 80, extraH = 80, yBias = 0, theme } = {}) {
    const railW = Math.max(14, Math.min(42, (Number(arena.size) || 480) * 0.05));
    const railH = railW * 0.95;
    P.railW = railW;
    P.railH = railH;
    if (theme) {
      P.themeName = theme;
      P.theme = theme25d(theme);
    }
    view.w = Math.max(1, Number(viewport.width) || 1);
    view.h = Math.max(1, Number(viewport.height) || 1);
    cam.x = arena.cx;
    cam.y = arena.cy;
    // Perspektif güneyde genişletir: en geniş en-boy güney kenarında oluşur.
    const southD = 1 + (arena.height / 2) * P.persp;
    const projW = arena.width * southD + railW * 2 + extraW;
    const projH = arena.height * P.tilt + railW * 2 + railH + extraH;
    view.scale = Math.min(view.w / projW, view.h / projH);
    view.ox = view.w / 2;
    view.oy = view.h / 2 + yBias * view.scale;
    return { railW, railH };
  }

  /** Dünya (x, y, z) → ekran. `z` ekranda yukarıdır. */
  function proj(x, y, z = 0) {
    const d = 1 + (y - cam.y) * P.persp;
    return {
      x: view.ox + (x - cam.x) * view.scale * d,
      y: view.oy + (y - cam.y) * view.scale * P.tilt * d - z * view.scale * d,
      d,
    };
  }

  /** Ekran (sx, sy) → zemin düzlemi (z=0). `proj`'ın tersi. */
  function unproject(sx, sy) {
    const dx = sx - view.ox;
    const dy = sy - view.oy;
    // dy = k·scale·tilt·(1 + k·persp),  k = y - cy  →  ikinci derece.
    const qa = view.scale * P.tilt * P.persp;
    const qb = view.scale * P.tilt;
    const k = qa === 0 ? dy / qb
      : (-qb + Math.sqrt(Math.max(0, qb * qb + 4 * qa * dy))) / (2 * qa);
    const d = 1 + k * P.persp;
    return { x: cam.x + (d === 0 ? 0 : dx / (view.scale * d)), y: cam.y + k };
  }

  function quad(ctx, a, b, c, d, fill) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
  }

  function strokePoly(ctx, pts, color, width, close = true) {
    if (!pts.length) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
    if (close) ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function contactPatch(ctx, x, y, rx, ry, alpha = 1, color = A.shadow25d) {
    const p = proj(x, y, 0);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rx * view.scale * p.d, ry * view.scale * p.d * P.tilt, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function groundEllipse(ctx, x, y, r, fill, alpha = 1) {
    const p = proj(x, y, 0);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r * view.scale * p.d, r * view.scale * p.d * P.tilt, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function groundRing(ctx, x, y, r, color, width) {
    const p = proj(x, y, 0);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r * view.scale * p.d, r * view.scale * p.d * P.tilt, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }


  /**
   * Kalıplanmış vinil prizma — oblique (tepeden-sığ) kameranın engel/tampon gövdesi.
   *
   * SİLUET DİKDÖRTGENDİR, altıgen değil: `PERSP = 0` olduğu için ekran x'i yalnız
   * dünya x'inden gelir; x'i sabit bir yüz ekranda SIFIR genişliktedir, yani yan
   * yüz hiç görünmez. Görünen iki yüz (ayak izi = çatı, artı ön duvar) ekseni
   * hizalı iki dikdörtgendir ve birleşimleri de bir dikdörtgendir.
   *
   * Eski çizim üç yüzü de ayrı konturluyordu: çatı/duvar dikdörtgenlerinin çakışan
   * kenarları çift mürekkep, "yan yüz" ise bloğun içinde duran sahte bir dikey
   * çizgi bırakıyordu (klip-art imzası) — üstelik o çizginin sağda mı solda mı
   * duracağı engelin `cam.x`'e göre konumuna bağlıydı, yani aynı blok sahada başka
   * yerde farklı çiziliyordu. Yeni düzen: iki düz dolgu + TEK siluet konturu;
   * yüz ayrımı mürekkeple değil tonla kurulur (çatı açık, duvar orta, birleşim koyu).
   *
   * `lineW` TASARIM px'idir (ekran px'i değil): içeride `view.scale · d` ile
   * ölçeklenir. Sabit ekran kalınlığı küçük saha ölçeğinde mürekkebi şişiriyordu;
   * kenar tamponları da (raylar) aynı çağrıyı kullandığı için düzeltme ikisini
   * tutarlı kılar.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x @param {number} y @param {number} w @param {number} d derinlik
   * @param {number} h görsel yükseklik (z; çarpışmaya dokunmaz)
   * @param {Material} pal
   * @param {number} [lineW] tasarım px cinsinden mürekkep kalınlığı
   */
  function drawPrism(ctx, x, y, w, d, h, pal, lineW = 2.5) {
    const s = view.scale;
    const tl = proj(x, y, h);           // çatı sol-arka = siluet üst-sol
    const br = proj(x + w, y, h);       // çatı sağ-arka
    const fl = proj(x, y + d, h);       // çatı sol-ön = birleşim çizgisi
    const bl = proj(x, y + d, 0);       // ön duvar sol-taban = siluet alt-sol

    const left = tl.x;
    const right = br.x;
    const top = tl.y;
    const mid = fl.y;
    const bottom = bl.y;
    const wide = right - left;
    if (!(wide > 0 && bottom > top)) return;

    const ink = Math.max(1, lineW * s * tl.d);
    ctx.globalAlpha = 1;

    // 1. Ön duvar (orta ton) — ayak izinin altına, izleyiciye doğru sarkar.
    ctx.fillStyle = pal.front;
    ctx.fillRect(left, mid, wide, bottom - mid);

    // 2. Çatı (ışık yüzü) — ayak izinin kendisi.
    ctx.fillStyle = pal.top;
    ctx.fillRect(left, top, wide, mid - top);

    // 3. Birleşim ocağı: çatı ön kenarı duvara gölge düşürür (yüz ayrımı).
    ctx.globalAlpha = 0.26;
    ctx.fillStyle = pal.side;
    ctx.fillRect(left, mid, wide, Math.max(1, ink * 0.8));

    // 4. Zemin AO: duvarın tabanı kararır, blok yere oturur.
    const ao = Math.max(1.5, (bottom - mid) * 0.4);
    ctx.globalAlpha = 0.38;
    ctx.fillRect(left, bottom - ao, wide, ao);
    ctx.globalAlpha = 1;

    // 5. Malzeme dokusu (varsa) — siluete KIRPILARAK, doğal ölçekte karo karo.
    if (pal.tex) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, wide, bottom - top);
      ctx.clip();
      paintMaterialTexture(ctx, pal, left, top, wide, bottom - top);
      ctx.restore();
    }

    // 6. Çatı ön kenarı pah ışıltısı (kalıplanmış vinil kenar).
    ctx.beginPath();
    ctx.moveTo(left + 3 * s, mid - 2 * s);
    ctx.lineTo(right - 3 * s, mid - 2 * s);
    ctx.strokeStyle = A.gloss25d;
    ctx.lineWidth = Math.max(1, 2.2 * s * tl.d);
    ctx.stroke();

    // 7. TEK siluet konturu — iç kenarlar tonun işi, mürekkebin değil.
    ctx.strokeStyle = A.ink25d;
    ctx.lineWidth = ink;
    ctx.strokeRect(left, top, wide, bottom - top);
  }

  function drawCylinder(ctx, x, y, r, h, pal) {
    const base = proj(x, y, 0);
    const top = proj(x, y, h);
    const rx = r * view.scale * base.d;
    const ry = rx * P.tilt;
    if (!(rx > 0)) return;
    const ink = Math.max(1, 2.6 * view.scale * base.d);

    // 1. Gövde (orta ton) — taban elipsinin yalnız izleyiciye bakan alt yayı.
    ctx.beginPath();
    ctx.moveTo(base.x - rx, top.y);
    ctx.lineTo(base.x - rx, base.y);
    ctx.ellipse(base.x, base.y, rx, ry, 0, Math.PI, 0, true);
    ctx.lineTo(base.x + rx, top.y);
    ctx.closePath();
    ctx.fillStyle = pal.front;
    ctx.fill();

    // 2. Malzeme dokusu gövdeye KIRPILIR; `clip` yolu tüketmez, bu yüzden
    //    aşağıdaki kontur aynı yolu yeniden kurmadan basılabilir.
    if (pal.tex) {
      ctx.save();
      ctx.clip();
      paintMaterialTexture(ctx, pal, base.x - rx, top.y, rx * 2, base.y - top.y);
      ctx.restore();
    }

    // 3. Gövde konturu — tabla konturuyla AYNI (ölçekli) kalınlıkta.
    ctx.strokeStyle = A.ink25d;
    ctx.lineWidth = ink;
    ctx.stroke();

    // 4. Dikey ışık şeridi (hacim) — silindiri "kolon" yapan okuma.
    ctx.beginPath();
    ctx.moveTo(base.x + rx * 0.35, top.y);
    ctx.lineTo(base.x + rx * 0.35, base.y - ry * 0.2);
    ctx.strokeStyle = pal.side;
    ctx.lineWidth = rx * 0.45;
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 5. Tabla (ışık yüzü) + konturu.
    ctx.beginPath();
    ctx.ellipse(top.x, top.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = pal.top;
    ctx.fill();
    ctx.strokeStyle = A.ink25d;
    ctx.lineWidth = ink;
    ctx.stroke();
  }

  /**
   * Projekte küre: gövde/oyuncak topu. Yaklaşık-tepeden bakış bir küreyi
   * daireye indirger; "top" okuması YALNIZ ışıktan gelir. Bu yüzden katmanlı
   * kurulum: konumlu highlight + güçlü terminatör (alt-sağ koyu), taban AO,
   * karşı kenarda ince rim ışığı ve yumuşak speküler leke. Kontur incedir:
   * kalın eşit daire çizgisi küreyi düz sticker'a çeviriyordu.
   */
  function drawSphere(ctx, x, y, z, r, pal) {
    const p = proj(x, y, z);
    const rr = r * view.scale * p.d;
    if (!(rr > 0)) return;
    const hx = p.x - rr * 0.36;
    const hy = p.y - rr * 0.40;
    const deep = shade(pal.front, -0.42);

    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
    ctx.clip();

    // 1) Gövde hacmi: ışık sol-üstte, terminatör sağ-altta.
    const g = ctx.createRadialGradient(hx, hy, rr * 0.06, p.x, p.y, rr * 1.02);
    g.addColorStop(0, pal.top);
    g.addColorStop(0.40, pal.front);
    g.addColorStop(0.82, pal.side);
    g.addColorStop(1, deep);
    ctx.fillStyle = g;
    ctx.fillRect(p.x - rr - 1, p.y - rr - 1, rr * 2 + 2, rr * 2 + 2);

    // 2) Taban AO: alt çeyrek içten kararır, top yere oturur.
    const ao = ctx.createLinearGradient(0, p.y + rr * 0.34, 0, p.y + rr);
    ao.addColorStop(0, A.clear25d);
    ao.addColorStop(1, A.shadow25d);
    ctx.fillStyle = ao;
    ctx.fillRect(p.x - rr - 1, p.y + rr * 0.34, rr * 2 + 2, rr * 0.66 + 1);

    // 3) Rim ışığı: ışıktan uzağa bakan kenarda ince açık yay.
    ctx.beginPath();
    ctx.arc(p.x, p.y, rr * 0.93, Math.PI * 0.95, Math.PI * 1.72);
    ctx.strokeStyle = pal.top;
    ctx.globalAlpha = ctx.globalAlpha * 0.4;
    ctx.lineWidth = Math.max(1, rr * 0.10);
    ctx.stroke();

    // 4) Speküler parıltı: highlight noktasında yumuşak beyaz leke.
    const spec = ctx.createRadialGradient(hx, hy, 0, hx, hy, rr * 0.5);
    spec.addColorStop(0, A.gloss25d);
    spec.addColorStop(1, A.clear25d);
    ctx.fillStyle = spec;
    ctx.fillRect(p.x - rr - 1, p.y - rr - 1, rr * 2 + 2, rr * 2 + 2);

    ctx.restore(); // clip sonu

    // Kontur: kürenin kendi ink çizgisi (ince).
    ctx.beginPath();
    ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
    ctx.strokeStyle = A.ink25d;
    ctx.lineWidth = Math.max(1.2, rr * 0.045);
    ctx.stroke();
  }

  P.fit = fit;
  P.proj = proj;
  P.unproject = unproject;
  P.quad = quad;
  P.strokePoly = strokePoly;
  P.contactPatch = contactPatch;
  P.groundEllipse = groundEllipse;
  P.groundRing = groundRing;
  P.drawPrism = drawPrism;
  P.drawCylinder = drawCylinder;
  P.drawSphere = drawSphere;

  return P;
}

/** Masa zemini + vinyet (arenanın dışı) — ekran uzayında. Tema verilirse onun renkleri. */
// Malzeme desenleri — tema adına göre masa/mat yüzeyi (tek kaynak).
export const TABLE_PATTERN = {
  wood: 'wood', marble: 'veins', arcade: 'grid', picnic: 'wood', night: 'grid', garden: 'wood',
};
export const MAT_PATTERN = {
  wood: 'weave', marble: 'veins', arcade: 'grid', picnic: 'grass', night: 'grid', garden: 'grass',
};

// Gerçek doku (varsa) tema başına; yüklenmemişse prosedürel desene düşülür.
export const TABLE_TEXTURE = {
  wood: 'wood', marble: 'stone', arcade: 'metal', picnic: 'wood', night: 'metal', garden: 'wood',
};
export const MAT_TEXTURE = {
  wood: 'felt', marble: 'stone', arcade: 'metal', picnic: 'grass', night: 'metal', garden: 'grass',
};

/**
 * Kare başına `createPattern` pahalıdır (1024² görüntüden desen kurar). Pattern
 * CTM'den bağımsızdır, o yüzden ctx başına görüntü→pattern önbelleğe alınır ve
 * her karede yeniden kullanılır. WeakMap: ctx GC olunca kayıt da gider.
 * @type {WeakMap<CanvasRenderingContext2D, Map<any, CanvasPattern|null>>}
 */
const patternCache = new WeakMap();

function cachedPattern(ctx, img) {
  if (!ctx.createPattern) return null;
  let byImage = patternCache.get(ctx);
  if (!byImage) {
    byImage = new Map();
    patternCache.set(ctx, byImage);
  }
  let pat = byImage.get(img);
  if (pat === undefined) {
    pat = ctx.createPattern(img, 'repeat') || null;
    byImage.set(img, pat);
  }
  return pat;
}

/**
 * Ekran-uzayı döşeli doku: `view`'i kaplar, ardından `tint` ile
 * (`globalCompositeOperation='color'`) temaya renklendirilir. `tilePx`
 * döşeme kenarının ekran genişliği; `yScale` yatay düzlemin `tilt` sıkışması
 * (masa da yere paralel → damar eğimle perspektiflenir, tepeden bakış hissi gider).
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} img
 * @param {{w:number,h:number}} view
 * @param {string} tint
 * @param {number} tilePx
 * @param {number} [yScale]
 */
function paintTiledTexture(ctx, img, view, tint, tilePx, yScale = 1) {
  const tile = Math.max(64, tilePx);
  const k = tile / img.width;
  const pat = cachedPattern(ctx, img);
  if (!pat) return;
  ctx.save();
  ctx.scale(k, k * yScale);
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, view.w / k, view.h / (k * yScale));
  ctx.globalCompositeOperation = 'color';
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, view.w / k, view.h / (k * yScale));
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

/**
 * Dünya-uzayı döşeli doku: `(x0,y0)-(x1,y1)` dünya dörtgenini `proj` ile ekrana
 * taşır, dokuyu `tileWorld` dünya biriminde döşer, ardından `tint` ile
 * renklendirir. `persp = 0` (aksonometrik) varsayımına dayanır.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} img
 * @param {any} proj
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {string} tint
 * @param {number} tileWorld
 */
export function paintTiledTextureWorld(ctx, img, proj, x0, y0, x1, y1, tint, tileWorld, z = 0) {
  const origin = proj.proj(x0, y0, z);
  const s = proj.view.scale;
  const k = Math.max(1e-3, tileWorld / img.width);
  const pat = cachedPattern(ctx, img);
  if (!pat) return;
  const uw = (x1 - x0) / k;
  const vh = (y1 - y0) / k;
  ctx.save();
  ctx.translate(origin.x, origin.y);
  ctx.transform(s * k, 0, 0, s * proj.tilt * k, 0, 0);
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, uw, vh);
  ctx.globalCompositeOperation = 'color';
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, uw, vh);
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

/** Deterministik 0..1 hash — `Math.random` yasak (host↔client + fieldKit kuralı). */
/** @param {number} n */
function h01(n) {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 2246822507);
  x = Math.imul(x ^ (x >>> 13), 3266489917);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/**
 * Yüzey dokusu: `map` ile ekrana taşınan dünya-uzayı çizgileri. Kırpma (clip)
 * çağıranın işidir; tüm renkler parametre (`lo`/`hi`) gelir, literal yok.
 * @param {CanvasRenderingContext2D} ctx
 * @param {'wood'|'veins'|'grid'|'weave'|'grass'} kind
 * @param {number} bx0
 * @param {number} by0
 * @param {number} bx1
 * @param {number} by1
 * @param {(x: number, y: number) => { x: number, y: number }} map
 * @param {number} unit
 * @param {string} lo
 * @param {string} hi
 */
export function paintSurfacePattern(ctx, kind, bx0, by0, bx1, by1, map, unit, lo, hi) {
  const w = bx1 - bx0;
  const hh = by1 - by0;
  if (!(w > 0) || !(hh > 0) || !(unit > 0)) return;
  const M = map;
  ctx.save();
  ctx.lineCap = 'round';
  const line = (/** @type {{x:number,y:number}} */ a, /** @type {{x:number,y:number}} */ b) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };  if (kind === 'grid') {
    const s = unit * 1.6;
    ctx.strokeStyle = lo;
    ctx.lineWidth = Math.max(1, unit * 0.06);
    for (let x = bx0; x <= bx1 + 0.5; x += s) line(M(x, by0), M(x, by1));
    for (let y = by0; y <= by1 + 0.5; y += s) line(M(bx0, y), M(bx1, y));
    ctx.strokeStyle = hi;
    ctx.lineWidth = Math.max(1, unit * 0.1);
    for (let x = bx0; x <= bx1 + 0.5; x += s * 2) {
      for (let y = by0; y <= by1 + 0.5; y += s * 2) line(M(x - s * 0.06, y), M(x + s * 0.06, y));
    }
  } else if (kind === 'weave') {
    const s = unit * 0.9;
    ctx.strokeStyle = lo;
    ctx.lineWidth = Math.max(1, unit * 0.05);
    for (let x = bx0 - hh; x <= bx1 + 0.5; x += s) line(M(x, by0), M(x + hh, by1));
    ctx.strokeStyle = hi;
    for (let x = bx0; x <= bx1 + hh + 0.5; x += s) line(M(x, by0), M(x - hh, by1));
  } else if (kind === 'grass') {
    const s = unit * 2.0;
    ctx.strokeStyle = lo;
    ctx.lineWidth = Math.max(1, unit * 0.08);
    let i = 0;
    for (let x = bx0; x <= bx1 + 0.5; x += s) {
      for (let y = by0; y <= by1 + 0.5; y += s) {
        const px = x + (h01(i * 3 + 1) - 0.5) * s;
        const py = y + (h01(i * 3 + 2) - 0.5) * s;
        const lean = (h01(i * 3 + 3) - 0.5) * unit * 0.7;
        line(M(px, py), M(px + lean, py - unit));
        i += 1;
      }
    }
  } else if (kind === 'veins') {
    ctx.strokeStyle = lo;
    ctx.lineWidth = Math.max(1, unit * 0.1);
    for (let v = 0; v < 6; v += 1) {
      const y0 = by0 + hh * (0.14 + 0.14 * v);
      ctx.beginPath();
      for (let k = 0; k <= 6; k += 1) {
        const x = bx0 + (w * k) / 6;
        const yy = y0 + Math.sin(x * 0.02 + v * 1.7) * hh * 0.05;
        const p = M(x, yy);
        if (k === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
  } else {
    const s = unit * 1.1;
    ctx.strokeStyle = lo;
    ctx.lineWidth = Math.max(1, unit * 0.06);
    for (let y = by0; y <= by1 + 0.5; y += s) {
      ctx.beginPath();
      for (let k = 0; k <= 12; k += 1) {
        const x = bx0 + (w * k) / 12;
        const yy = y + Math.sin(x * 0.03 + y * 0.01) * unit * 0.45 + Math.sin(x * 0.11 + y) * unit * 0.12;
        const p = M(x, yy);
        if (k === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = hi;
    ctx.lineWidth = Math.max(1, unit * 0.07);
    for (let kn = 0; kn < 3; kn += 1) {
      const p = M(bx0 + w * (0.2 + 0.32 * kn), by0 + hh * (0.22 + 0.34 * h01(kn + 7)));
      const rr = unit * (1.0 + h01(kn + 3) * 0.7);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, rr, rr * 0.55, 0.35, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function paintTable25d(ctx, view, theme, name = DEFAULT_THEME_25D, tilt = TILT) {
  const t = theme || A;
  const table = t.table || A.table25d;
  ctx.fillStyle = table;
  ctx.fillRect(0, 0, view.w, view.h);
  const minDim = Math.min(view.w, view.h);

  // Yüzey: gerçek doku varsa döşenip temaya renklendirilir; yoksa prosedürel.
  const img = fieldTexture(TABLE_TEXTURE[name]);
  const drawKey = (/** @type {number} */ a) => {
    const key = ctx.createRadialGradient(
      view.w * 0.33, view.h * 0.2, minDim * 0.08,
      view.w * 0.33, view.h * 0.2, Math.max(view.w, view.h) * 0.9,
    );
    key.addColorStop(0, shade(table, 0.16));
    key.addColorStop(1, A.clear25d);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = key;
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.restore();
  };
  if (img) {
    paintTiledTexture(ctx, img, view, table, minDim * 0.85, tilt);
    drawKey(0.4);
  } else {
    drawKey(1);
    const ident = (x, y) => ({ x, y });
    // Masa deseninde de KARE IZGARA YOK: 'grid' deseni (arcade/night) oyuncak
    // masasında "defter" okunduğu için ahşap damara indirilir.
    const tableKind = TABLE_PATTERN[name] === 'grid' ? 'wood' : (TABLE_PATTERN[name] || 'wood');
    paintSurfacePattern(ctx, tableKind,
      0, 0, view.w, view.h, ident, minDim * 0.05, shade(table, -0.18), shade(table, 0.14));
  }

  // Vinyet: kenarları toplar, odağı sahaya çeker.
  const g = ctx.createRadialGradient(
    view.w / 2, view.h / 2, minDim * 0.3,
    view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.75,
  );
  g.addColorStop(0, t.vigTop || A.tableVignetteTop25d);
  g.addColorStop(1, t.vigEdge || A.tableVignetteEdge25d);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, view.w, view.h);
}

/**
 * Ham arena dikdörtgenini ([left, top, right, bottom]) tam FieldGeometry'ye
 * çevirir. ONLINE client host ile AYNI `unit`'i türetsin diye formül tek
 * kaynaktır (`computePlayfield` ile aynı); iki yerde yazılırsa HUD/adım kayar.
 * @param {number[]} rect
 */
export function arenaFromRect(rect) {
  const left = Number(rect?.[0]) || 0;
  const top = Number(rect?.[1]) || 0;
  const right = Number(rect?.[2]) || 0;
  const bottom = Number(rect?.[3]) || 0;
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const size = Math.min(width, height);
  const unit = Math.max(
    FIELD_DESIGN.minUnit,
    Math.min(FIELD_DESIGN.maxUnit, size / FIELD_DESIGN.shortSide),
  );
  return {
    left, top, right, bottom, width, height, size, unit,
    cx: (left + right) / 2,
    cy: (top + bottom) / 2,
    aspect: width / height,
  };
}

/**
 * Eğik sahne yardımcısı (TEK kaynak): projector kur + viewport/arena'ya sığdır
 * + temayı bağla. Host render'ı ve ONLINE world-view AYNI girdileri verirse
 * sahne birebir eşleşir; oyun-başına kablolama buraya iner.
 *
 * `proj` verilirse yeni tahsis yapılmaz (host kalıcı instance'ını yeniden
 * kullanır); verilmezse taze üretilir (client kare-başı).
 * `opts.tilt` projector'ın derinlik sıkışmasını (kamera açısı) ayarlar;
 * `opts.extraW`/`extraH`/`yBias` fit'in nefes payıdır. Host ve client AYNI
 * opts'u geçmezse kamera kayar.
 * @param {{width:number,height:number}} viewport
 * @param {any} arena
 * @param {string} theme
 * @param {ReturnType<typeof createProjector>} [proj]
 * @param {{tilt?:number,extraW?:number,extraH?:number,yBias?:number}} [opts]
 */
export function makeTiltedProjector(viewport, arena, theme, proj = createProjector(), opts = {}) {
  const { tilt, extraW, extraH, yBias } = opts;
  if (typeof tilt === 'number' && Number.isFinite(tilt)) proj.tilt = tilt;
  proj.fit(viewport, arena, { theme, extraW, extraH, yBias });
  return proj;
}

