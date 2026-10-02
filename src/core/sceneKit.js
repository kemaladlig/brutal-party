// sceneKit.js — 2.5D sahne yardımcıları (TEK kaynak).
//
// Neden var: 4 dönüşümden (BOMB, SNAKE, HEIST, CROWN) sonra ölçüldü ki aynı
// kalıplar her oyunda elle yazılıyor — zemin dikdörtgeni (quad+strokePoly),
// projeksiyonlu durum rozeti (`proj.proj` + drawStatusChip), yüzen yuvarlak
// token (gölge+silindir+ikon) ve "oyuncu öğesi + paylaşılan durum + kuyruk"
// iskeleti. Bu modül onları tek yere alır.
//
// KURAL (rule of two): buraya yalnız ≥2 gerçek tüketicisi olan yardımcı girer.
// Tek kullanımlık bir çizim, oyunun kendi view dosyasında kalır. Yeni yardımcı
// eklerken önce mevcut iki çağrı yerini göster.

import { UI_COLORS } from '../ui/tokens.js';
import { sceneDraw, entitySceneY } from './arenaKit.js';
import { drawStatusChip } from './entityStatus.js';

/**
 * Zemine projekte edilmiş dikdörtgen bölge (kasa / speed pad / konveyör /
 * kapma alanı). Dolgu + kontur opsiyoneldir; köşe noktalarını döndürür ki
 * çağıran üstüne ok/yazı basabilsin.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} proj
 * @param {{x:number,y:number,w:number,h:number}} rect
 * @param {{fill?:string, stroke?:string, lineWidth?:number, alpha?:number}} [opts]
 * @returns {Array<{x:number,y:number,d:number}>} projekte köşeler (tl,tr,br,bl)
 */
export function groundRect(ctx, proj, rect, opts = {}) {
  const { x, y, w, h } = rect;
  const pts = [
    proj.proj(x, y, 0), proj.proj(x + w, y, 0),
    proj.proj(x + w, y + h, 0), proj.proj(x, y + h, 0),
  ];
  if (opts.fill) {
    ctx.save();
    if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
    proj.quad(ctx, pts[0], pts[1], pts[2], pts[3], opts.fill);
    ctx.restore();
  }
  if (opts.stroke) proj.strokePoly(ctx, pts, opts.stroke, opts.lineWidth || 2, true);
  return pts;
}

/**
 * Projeksiyonlu durum rozeti: `entityStatus.drawStatusChip`'i zeminden `z`
 * kadar yukarıdaki projekte konuma bağlar (kamera ölçeğiyle; SNAKE enerji,
 * HEIST tackle, CROWN tackle aynı çağrı).
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} proj
 * @param {{x:number,y:number,radius:number,z?:number}} anchor
 * @param {any} [chipOpts] drawStatusChip seçenekleri (icon/state/progress/...)
 */
export function chipAt(ctx, proj, anchor, chipOpts = {}) {
  const r = anchor.radius || 0;
  const z = anchor.z == null ? r : anchor.z;
  const sp = proj.proj(anchor.x, anchor.y, z);
  const k = proj.view.scale * sp.d;
  drawStatusChip(ctx, { x: sp.x, y: sp.y, radius: r * k, ...chipOpts });
}

/**
 * 2.5D atış gövdesi (ok / mermi izi): zemine düşen uçuş gölgesi + zeminden
 * `lift` kadar yükseltilmiş projekte şaft. Ucu (ok başı / mermi diski) ÇAĞIRAN
 * çizer — dönen projekte uç noktasını döndürür.
 *
 * Tüketiciler: ARCHER oku, HORDE oyuncu mermisi. `tail`/`head` dünya birimi,
 * `width` ekran px (kamera ölçeğiyle).
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} proj
 * @param {{x:number,y:number,vx:number,vy:number,tail?:number,head?:number,
 *   lift?:number,color?:string,width?:number,shadowAlpha?:number}} p
 * @returns {{x:number,y:number,d:number}} projekte uç noktası (uç çizimi için)
 */
export function projectile25d(ctx, proj, p) {
  const ang = Math.atan2(p.vy || 0, p.vx || 0);
  const hx = Math.cos(ang);
  const hy = Math.sin(ang);
  const tail = p.tail ?? 14;
  const head = p.head ?? 16;
  const lift = p.lift ?? 12;
  const k = proj.view.scale;
  const width = Math.max(1, (p.width ?? 4) * k);

  // 1. Zemine düşen uçuş gölgesi (havada süzülme hissi).
  const sTail = proj.proj(p.x - hx * tail, p.y - hy * tail, 0);
  const sHead = proj.proj(p.x + hx * head, p.y + hy * head, 0);
  ctx.save();
  ctx.globalAlpha = p.shadowAlpha ?? 0.25;
  ctx.strokeStyle = UI_COLORS.inkDark;
  ctx.lineWidth = Math.max(1, width * 0.85);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sTail.x, sTail.y);
  ctx.lineTo(sHead.x, sHead.y);
  ctx.stroke();
  ctx.restore();

  // 2. Gövde (yükseltilmiş).
  const tTail = proj.proj(p.x - hx * tail, p.y - hy * tail, lift);
  const tHead = proj.proj(p.x + hx * head, p.y + hy * head, lift);
  ctx.save();
  ctx.strokeStyle = p.color || UI_COLORS.inkDark;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tTail.x, tTail.y);
  ctx.lineTo(tHead.x, tHead.y);
  ctx.stroke();
  ctx.restore();
  return tHead;
}

/**
 * Zemin uzayı: `proj` paralel (persp=0) olduğundan z=0 düzlemi SAF AFİN bir
 * eşlemedir (`ekran = O + (scale·x, scale·tilt·y)`). `draw(ctx)` gövdesi ham
 * DÜNYA koordinatlarıyla çizilir ve zemine oturur — düz zemin katmanları
 * (kapı/telegraf/mezar/işaret) için her şeyi elle projekte etmeye gerek yok.
 *
 * Tüketiciler: HORDE zemin katmanları; ZONE/COLLAPSE grid katmanı (planlı).
 * DİKKAT: yalnız z=0 (yer) içindir — yüksekliği olan gövdeler `billboard`.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} proj
 * @param {(ctx: CanvasRenderingContext2D) => void} draw
 */
export function groundSpace(ctx, proj, draw) {
  const o = proj.proj(0, 0, 0);
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.scale(proj.view.scale, proj.view.scale * proj.tilt);
  draw(ctx);
  ctx.restore();
}

/**
 * Oyuncu öğelerini derinlik kuyruğuna dizer (TEK iskelet). Oyuncuya özel veri
 * `player` nesnesinde taşınır; `state` yalnız sahne boyunca SABİT kalan
 * alanları tutar (kare başına tahsis yok — BOMB `PLAYER_ST` deseni).
 *
 * DİKKAT: `state` tek örnektir ve kuyruk çizimi `sceneEnd`'de olduğu için
 * çağıran onu her oyuncu için MUTASYONA UĞRATMAMALI — yalnız kare-geneli
 * alanlar (proj, arena, withFx, now, ...) burada durur; oyuncuya özel her şey
 * `player`dan okunur.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} players
 * @param {{state:any, drawItem:(ctx:any, player:any, state:any)=>void,
 *   radiusOf?:(p:any)=>number, visible?:(p:any)=>boolean}} opts
 */
export function queuePlayers(ctx, players, opts) {
  const {
    state, drawItem, radiusOf, visible,
  } = opts;
  for (const player of players) {
    if (visible && !visible(player)) continue;
    const r = radiusOf ? radiusOf(player) : (player.radius || 36);
    sceneDraw(ctx, entitySceneY(player.y, r), drawItem, player, state);
  }
}
