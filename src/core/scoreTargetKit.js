// Kazanç Nesnesi (Score Target) — ORTAK varlık tipi.
//
// Bugün 13 modun 13'ünde de puan ya "birini elemek"ten ya "son kalan olmak"tan
// gelir. Bu tip puanı BAŞKA bir eyleme bağlar: sahanın içinde dolaşan,
// vurulduğunda puan veren hedef. Raundu uzatmaz; uzun raundu DOLU tutar — her
// an için "bir sonraki hamle" vardır.
//
// Sözleşme (AGENTS §3):
// - Durum listesi MOTORDA yaşar (`game.scoreTargets`, `game.scoreTargetTimer`);
//   bu modül yalnız günceller, çizer, paketler. Mantık motora kopyalanmaz.
// - Ölçek daima `fieldRadius`/`fieldSpeed` ile türetilir (ham px yok).
// - Kare başına tahsis yok: nesneler yerinde güncellenir, çizim damgalı
//   `UI_COLORS` anahtarlarını kullanır (bu dosyada renk literali yok).
// - Ağ: `packScoreTargets` düz sayı dizisi döner; hedef başına 6 alan, adet
//   `SCORE_TARGET_TUNING.MAX` ile sınırlı.

import { fieldRadius, fieldSpeed } from './playfield.js';
import { segmentCircleIntersection, segmentAabbIntersection } from './physics2d.js';
import { drawDioramaContactShadow } from './dioramaKit.js';
import { UI_COLORS } from '../ui/tokens.js';

export const SCORE_TARGET_TUNING = Object.freeze({
  MAX: 1,           // aynı anda sahada bulunabilecek hedef
  FIRST_AT: 8,      // sn — raunt başında değil; oyuncular yerleştikten sonra
  LIFE: 12,         // sn — sahada kalma süresi (ömür halkası olarak okunur)
  RESPAWN: 16,      // sn — gittikten sonraki bekleme
  RETRY: 2,         // sn — şerit yerleşemezse sonraki deneme aralığı
  VALUE: 3,         // puan (oyuncu vuruşunun 1-2 puanına karşı açık üstünlük)
  R_BASE: 26,       // tasarım px — gövde yarıçapı
  R_MIN: 0.02,      // aşırı dar portre sahanın altında ezilme tabanı
  SPEED_BASE: 130,  // tasarım px/sn — şerit boyunca çizgisel sürüş
  MARGIN: 0.16,     // lane'ın saha kenarından içe çekiş oranı
  TRIES: 8,         // engelsiz şerit arama denemesi
});

// Paket küçültme: 0.1 hassasiyet görsel için yeterli, byte'ı korur.
const r1 = (v) => Math.round(Number(v) * 10) / 10;

/** Motor kurulumu: her raunt başında çağrılır (`startRound`/`resetMatch`). */
export function resetScoreTargets(game, tuning = SCORE_TARGET_TUNING) {
  game.scoreTargets = [];
  game.scoreTargetTimer = tuning.FIRST_AT;
}

/**
 * Şerit yerleşimi: eksen + sabit koordinat + genlik seçer ve hattın ENGELSİZ
 * olduğunu süpürülmüş testle doğrular. Bloklu şerit, hedefin duvarın içinde
 * gezinmesi demekti — vurulamayan nesne puan vermez.
 */
function pickLane(arena, obstacles, tuning) {
  const marginX = arena.width * tuning.MARGIN;
  const marginY = arena.height * tuning.MARGIN;
  for (let attempt = 0; attempt < tuning.TRIES; attempt += 1) {
    const horizontal = Math.random() < 0.5;
    if (horizontal) {
      const y = arena.top + marginY + Math.random() * Math.max(1, arena.height - marginY * 2);
      const half = Math.max(arena.width * 0.18, arena.width / 2 - marginX);
      const blocked = obstacles.some((o) => segmentAabbIntersection(
        arena.cx - half, y, arena.cx + half, y, o, 0,
      ) !== null);
      if (!blocked) return { axis: 'x', baseX: arena.cx, baseY: y, amp: half };
    } else {
      const x = arena.left + marginX + Math.random() * Math.max(1, arena.width - marginX * 2);
      const half = Math.max(arena.height * 0.18, arena.height / 2 - marginY);
      const blocked = obstacles.some((o) => segmentAabbIntersection(
        x, arena.cy - half, x, arena.cy + half, o, 0,
      ) !== null);
      if (!blocked) return { axis: 'y', baseX: x, baseY: arena.cy, amp: half };
    }
  }
  return null;
}

/** Tek hedef üretir; yerleşemezse `false` döner (güncelleyici yeniden dener). */
export function spawnScoreTarget(game, opts = {}) {
  const tuning = opts.tuning || SCORE_TARGET_TUNING;
  const arena = game.arena;
  game.scoreTargets = game.scoreTargets || [];
  if (game.scoreTargets.length >= tuning.MAX) return false;
  if (!arena || !(arena.width > 0) || !(arena.height > 0)) return false;

  const lane = pickLane(arena, Array.isArray(game.obstacles) ? game.obstacles : [], tuning);
  if (!lane) return false;

  // x = base + sin(ω·t)·amp ⇒ çizgisel tepe sürüşü ω·amp. ω oradan türer, böylece
  // uzun ve kısa şeritler aynı okunabilir hızda gezer.
  const linear = fieldSpeed(arena, tuning.SPEED_BASE);
  const amp = Math.max(1, lane.amp);
  game.scoreTargets.push({
    x: lane.baseX,
    y: lane.baseY,
    baseX: lane.baseX,
    baseY: lane.baseY,
    axis: lane.axis,
    amp,
    omega: linear / amp,
    r: fieldRadius(arena, tuning.R_BASE, tuning.R_MIN),
    life: tuning.LIFE,
    value: opts.value || tuning.VALUE,
    color: opts.color || UI_COLORS.gold,
    ink: opts.ink || UI_COLORS.inkDark,
    animTime: 0,
  });
  return true;
}

/**
 * Hareket + ömür + doğuş ritmi. `opts.onExpire(target)` süresiz kaçan hedefin
 * tek çağrılık bildirimidir; motor isterse buradan ses/FX üretir.
 */
export function updateScoreTargets(game, dt, opts = {}) {
  const tuning = opts.tuning || SCORE_TARGET_TUNING;
  game.scoreTargets = game.scoreTargets || [];

  if (game.scoreTargets.length < tuning.MAX) {
    game.scoreTargetTimer = (Number(game.scoreTargetTimer) || 0) - dt;
    if (game.scoreTargetTimer <= 0) {
      game.scoreTargetTimer = spawnScoreTarget(game, opts) ? tuning.FIRST_AT : tuning.RETRY;
    }
  }

  for (let i = game.scoreTargets.length - 1; i >= 0; i -= 1) {
    const t = game.scoreTargets[i];
    t.animTime += dt;
    t.life -= dt;
    if (t.life <= 0) {
      game.scoreTargets.splice(i, 1);
      game.scoreTargetTimer = tuning.RESPAWN;
      if (opts.onExpire) opts.onExpire(t);
      continue;
    }
    const osc = Math.sin(t.animTime * t.omega);
    if (t.axis === 'x') {
      t.x = t.baseX + osc * t.amp;
      t.y = t.baseY;
    } else {
      t.y = t.baseY + osc * t.amp;
      t.x = t.baseX;
    }
  }
}

/**
 * Süpürülmüş isabet: bir karedeki ok yolu (x0,y0)→(x1,y1) hedef gövdesine
 * değiyor mu. Motor bunu engel/oyuncu testleriyle AYNI `t` yarışına sokar;
 * böylece hedef de duvar arkasında vurulamaz.
 */
export function scoreTargetSegmentHit(game, x0, y0, x1, y1, pad = 0) {
  const list = game.scoreTargets;
  if (!Array.isArray(list) || list.length === 0) return null;
  let best = null;
  for (const t of list) {
    const hit = segmentCircleIntersection(x0, y0, x1, y1, t.x, t.y, t.r + pad);
    if (hit && (!best || hit.t < best.t)) best = { target: t, t: hit.t, x: hit.x, y: hit.y };
  }
  return best;
}

/** Puanı ödeyen tek kapı: hedefi kaldırır, sıradaki için sayacı kurar. */
export function claimScoreTarget(game, target, tuning = SCORE_TARGET_TUNING) {
  const list = game.scoreTargets;
  if (Array.isArray(list)) {
    const i = list.indexOf(target);
    if (i >= 0) list.splice(i, 1);
  }
  game.scoreTargetTimer = tuning.RESPAWN;
  return Number(target && target.value) || tuning.VALUE;
}

/** `world` paketi yükü: [[x, y, r, animTime, value, lifeRatio]] */
export function packScoreTargets(list, tuning = SCORE_TARGET_TUNING) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, tuning.MAX).map((t) => [
    r1(t.x),
    r1(t.y),
    r1(t.r),
    r1(t.animTime),
    Math.max(0, Number(t.value) || 0),
    r1(Math.max(0, Math.min(1, (Number(t.life) || 0) / tuning.LIFE))),
  ]);
}

/** Client frame doğrulaması (motor validator'ının `targets` dalı). */
export function isValidScoreTargetFrame(list, tuning = SCORE_TARGET_TUNING) {
  return Array.isArray(list) && list.length <= tuning.MAX && list.every((row) => (
    Array.isArray(row) && row.length === 6
    && row.every((v) => Number.isFinite(v))
    && row[2] > 0 && row[4] >= 0 && row[5] >= 0 && row[5] <= 1
  ));
}

/**
 * 2.5D hedefin TEK gövdesi: yerde temas gölgesi + kalın alt cephe + beyaz iç
 * halka + merkez göz + ömür halkası + üst-sol speküler pah (`arenaKit` dili).
 * Alanlar düz parametre gelir: host motor nesnesinden, client paket
 * satırından çağırır — ikisi de tahsassız BİREBİR aynı pikselleri üretir.
 */
export function drawScoreTargetFields(ctx, x, y, r, animTime, lifeRatio, color, ink) {
  const radius = Number(r) || 20;
  const u = Math.max(0.6, radius / 14);
  const time = Number(animTime) || 0;
  const ratio = Math.max(0, Math.min(1, Number(lifeRatio) || 0));
  // Doğuşta 0.35 sn'lik yumuşak geliş (ani "pat" yok, AGENTS §8).
  const appear = Math.min(1, time / 0.35);
  const pulse = 1 + Math.sin(time * 4.6) * 0.05 * appear;
  const hover = (Math.sin(time * 3.4) + 1) / 2;
  const fill = color || UI_COLORS.gold;
  const line = ink || UI_COLORS.inkDark;

  ctx.save();
  ctx.globalAlpha = appear;
  drawDioramaContactShadow(ctx, x, y + 5 * u, radius * (0.95 - hover * 0.1), radius * 0.42, {
    alpha: 0.4 - hover * 0.1,
  });

  ctx.translate(x, y - hover * 3 * u);
  ctx.scale(pulse, pulse);

  ctx.beginPath();
  ctx.arc(0, 2.2 * u, radius, 0, Math.PI * 2);
  ctx.fillStyle = line;
  ctx.globalAlpha = appear * 0.5;
  ctx.fill();
  ctx.globalAlpha = appear;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.66, 0, Math.PI * 2);
  ctx.fillStyle = UI_COLORS.white;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = line;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, 0, radius - 1.2 * u, Math.PI * 0.85, Math.PI * 1.85);
  ctx.strokeStyle = UI_COLORS.white;
  ctx.globalAlpha = appear * 0.7;
  ctx.lineWidth = Math.max(1.2, 1.6 * u);
  ctx.stroke();
  ctx.globalAlpha = appear;

  // Ömür halkası: "bu hedef ne kadar sonra gidiyor" — metin yok, halka var.
  if (ratio > 0 && ratio < 1) {
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.3, -Math.PI / 2, -Math.PI / 2 + ratio * Math.PI * 2);
    ctx.strokeStyle = fill;
    ctx.lineWidth = Math.max(2, 2.8 * u);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.strokeStyle = line;
  ctx.lineWidth = Math.max(1.8, 2.2 * u);
  ctx.stroke();

  ctx.restore();
}

/** Host tarafı: motor nesnesinden çizer. */
export function drawScoreTarget(ctx, t, tuning = SCORE_TARGET_TUNING) {
  drawScoreTargetFields(
    ctx, t.x, t.y, t.r, t.animTime,
    Math.max(0, Math.min(1, (Number(t.life) || 0) / tuning.LIFE)),
    t.color, t.ink,
  );
}

export function drawScoreTargets(ctx, list, tuning = SCORE_TARGET_TUNING) {
  if (!Array.isArray(list)) return;
  for (let i = 0; i < list.length; i += 1) drawScoreTarget(ctx, list[i], tuning);
}

/**
 * Client tarafı: TEK paket satırından çizer
 * ([x, y, r, animTime, value, lifeRatio]); nesne dönüştürme yok.
 */
export function drawScoreTargetRow(ctx, row) {
  if (!Array.isArray(row)) return;
  drawScoreTargetFields(ctx, row[0], row[1], row[2], row[3], row[5], UI_COLORS.gold, UI_COLORS.inkDark);
}

export function drawScoreTargetRows(ctx, rows) {
  if (!Array.isArray(rows)) return;
  for (let i = 0; i < rows.length; i += 1) drawScoreTargetRow(ctx, rows[i]);
}
