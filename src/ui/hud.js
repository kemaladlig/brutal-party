import {
  UI_COLORS,
  UI_SIZES,
  UI_TEXT,
  UI_FONTS,
  CONTROL_MODE,
  uiFont,
  getUiScale,
} from './tokens.js';
import { t } from '../i18n.js';
import { hasTabletopIcon, drawTabletopIcon } from '../core/tabletopIcons.js';
import { isCompactLandscape, fieldPx } from '../core/playfield.js';
import { drawResultPanel, dimBehindPanel, resultPanelRadius, uiTextScale } from './resultPanel.js';
import { drawGameAvatar } from '../core/avatarInGame.js';
import { drawStatusChip, STATUS_STATE } from '../core/entityStatus.js';
import { scoreEntries } from './scoreModel.js';
import { motionScale } from './motion.js';

function pathRoundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
  }
}

// Standart üst hap: arena üstünde ortalı.
// Ekran boyutuna (TV / monitör vs telefon) göre orantılı büyür, metin uzunluğuna göre genişler.
// text: '💣 4.2s' gibi durum metni, urgent: kırmızı zemin.
// alpha: oyun alanı çakışmasında hapı soldurmak için (varsayılan 0.78 yarı saydam).
/**
 * Üstte ortada bilgi çubuğu.
 *
 * `persistent: true` — oyun boyunca sürekli görünen play-state chrome. Kompakt
 * yatayda (telefon) opak kutu Saha üst payının ~3px olduğu yere oturuyor ve
 * oynanış alanının üstünü kesiyordu (ölçülen ~30px örtüşme). Bilgi çıplak metne
 * düşürülür: kutu/gölge/çerçeve yok, alfa düşük, sola yaslı. Böylece hem
 * "sürekli görünen bar olmasın" kuralı tutulur hem de tur sayacı gibi veri
 * kaybolmaz. `renderControlGuide`'in `duringPlay` davranışıyla aynı mantık.
 *
 * `persistent` verilmezse (varsayılan) çubuk her boyutta çizilir — geçici
 * alarmlar (TANKS sudden death) kompakt yatayda da görünmeli.
 */
export function renderTopPill(ctx, {
  arena, text, urgent = false, alpha = 0.78, customW = null, persistent = false,
}) {
  const scale = getUiScale(arena);

  if (persistent && (arena?.profile?.compactLandscape ?? isCompactLandscape(arena))) {
    const fontPx = Math.max(10, Math.round(13 * scale));
    ctx.save();
    ctx.globalAlpha = Math.min(alpha, 0.62);
    ctx.font = `900 ${fontPx}px ${UI_FONTS.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    // Zeminde okunur: 1px kaydırılmış koyu kopya, sonra metin. Kutu yok.
    //
    // Konum ÜST-ORTA: başlık satırı kenarlarda (skor solda, bilgi sağda)
    // durduğu için kalıcı bilgi ortada kalır, iki yüzey çakışmaz.
    const y = arena.top + Math.max(2, Math.round(3 * scale));
    ctx.fillStyle = UI_COLORS.ink;
    ctx.fillText(text, arena.cx + 1, y + 1);
    ctx.fillStyle = urgent ? UI_COLORS.danger : UI_COLORS.white;
    ctx.fillText(text, arena.cx, y);
    ctx.restore();
    return;
  }

  const fontSize = Math.round(15 * scale);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `900 ${fontSize}px ${UI_FONTS.mono}`;
  const measured = ctx.measureText ? (ctx.measureText(text || '')?.width || 100) : 100;

  const minW = Math.round(136 * scale);
  const pillW = customW ? Math.round(customW * scale) : Math.max(minW, Math.round(measured + 28 * scale));
  const pillH = Math.round(UI_SIZES.pillH * scale);
  const pillX = arena.cx - pillW / 2;
  const pillY = arena.top + Math.round(10 * scale);
  const shadow = Math.max(2, Math.round(3 * Math.min(1.6, scale)));
  const pillR = pillH / 2;

  // Tactile Soft Shadow
  ctx.fillStyle = 'rgba(10, 8, 24, 0.35)';
  pathRoundRect(ctx, pillX, pillY + shadow, pillW, pillH, pillR);
  ctx.fill();

  // Gövde
  ctx.fillStyle = urgent ? UI_COLORS.danger : UI_COLORS.line;
  pathRoundRect(ctx, pillX, pillY, pillW, pillH, pillR);
  ctx.fill();

  // Kenar
  ctx.strokeStyle = urgent ? '#FF6B6B' : 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = Math.max(1.5, Math.round(2 * Math.min(1.5, scale)));
  pathRoundRect(ctx, pillX, pillY, pillW, pillH, pillR);
  ctx.stroke();

  // Metin
  ctx.fillStyle = UI_COLORS.white;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, arena.cx, pillY + pillH / 2);
  ctx.restore();
}

/**
 * Saha-içi kenar sayacı/halkasının yerleşimi (Faz 3.4). Saf ve test edilebilir:
 * `inset` HUD bandını sahanın içinde tutar ve halka yarıçapına bağlıdır —
 * yalnız metin yüksekliğinden türetilirse halka arena üst bandına taşar
 * (bilinen tuzak). Bu fonksiyon tek kaynaktır; `renderArenaWatermarkTimer`
 * buradan okur.
 * @param {{ scale: number, minDim: number, sizeScale?: number }} p
 * @returns {{ mainFontSize: number, subFontSize: number, ringR: number, inset: number }}
 */
export function computeArenaTimerLayout({ scale, minDim, sizeScale = 1 }) {
  const mainFontSize = Math.max(24, Math.min(
    Math.round(78 * (scale / 1.55) * sizeScale),
    Math.floor(minDim * 0.095 * sizeScale),
  ));
  const subFontSize = Math.max(11, Math.min(Math.round(16 * scale), Math.floor(minDim * 0.032)));
  // `inset >= ringR`: halkanın üst kenarı (inset - ringR) arena dışına taşmaz.
  const ringR = Math.max(minDim * 0.10, mainFontSize * 0.85);
  const inset = Math.max(
    fieldPx({ unit: scale }, 26),
    minDim * 0.06 + ringR * 0.55,
  );
  return { mainFontSize, subFontSize, ringR, inset };
}

// Saha ortası büyük filigran sayaç / zamanlayıcı / durum metni.
// TV ve büyük monitörlerde koltuktan rahatça görülecek kadar büyüktür,
// yüksek kontrastlı ve net, ancak saha zemininde çizildiği için oyuncuları ve oyunu engellemez.
export function renderArenaWatermarkTimer(ctx, {
  arena,
  text,
  subText = '',
  urgent = false,
  color = null,
  alpha = 0.45,
  ringProgress = null,
  offsetY = 0,
  placement = 'center',
}) {
  if (!text) return;
  const scale = getUiScale(arena);
  const minDim = Math.min(arena.width, arena.height);

  // Sayacın okunur olması yeterli; ilerlemeyi zaten halka taşıyor. Eski
  // tavan (minDim'in %18'i, masaüstünde ~142px) saha yüksekliğinin %15.6'sını
  // kaplıyordu — kalıcı bir sayaç için gereğinden büyük. Yeni tavan %9.5.
  //
  // 'top'/'bottom' modunda punto küçülür: kenar konumu HUD'ın yoğun olduğu
  // banttır, merkez konumundaki kadar yer kaplamamalı.
  const edgePlacement = placement === 'top' || placement === 'bottom';
  const sizeScale = edgePlacement ? 0.72 : 1;
  // Kenar konumu: HUD'ın yoğun olduğu üst/alt bant. `inset` hem yazıyı hem
  // ilerleme halkasını içeri alır; halka yarıçapı `minDim * 0.10` olduğu için
  // konum kaydırma tek başına yetmez — halka da kenardan içeride kalmalı.
  //
  // Ölçülen hata: ilk sürüm `inset = max(fieldPx(scale,26), minDim*0.11)`
  // idi; 1600x900'de bu 90px çıkıyordu, halka ise 90+ yarıçaplık yüzünden
  // arenanın üst bandındaki engellerin ÜSTÜNE biniyordu. Pay, halka yarıçapı
  // + yazı yüksekliğiyle birlikte hesaplanır (tek kaynak: computeArenaTimerLayout).
  const { mainFontSize, subFontSize, ringR, inset } = computeArenaTimerLayout({ scale, minDim, sizeScale });
  const cx = arena.cx;
  const cy = placement === 'top' ? arena.top + inset
    : placement === 'bottom' ? arena.bottom - inset
      : arena.cy + offsetY;

  ctx.save();

  // Acil durumda (panik) hafif nabız atan opaklık ve kırmızı/altın ton
  let effAlpha = alpha;
  if (urgent) {
    const pulse = (Math.sin(performance.now() * 0.01) + 1) * 0.5;
    effAlpha = Math.min(0.85, alpha + 0.18 + pulse * 0.12);
  }
  ctx.globalAlpha = effAlpha;

  // İlerleme halkası: 12 yönünden (üst) başlar, kalan süreyi temsil ederek saat yönünde azalarak biter
  if (typeof ringProgress === 'number' && Number.isFinite(ringProgress)) {
    const clamped = Math.max(0, Math.min(1.0, ringProgress));

    // Arka plan sabit ray halkası (kontrastlı dış çizgi + iç ray)
    ctx.save();
    ctx.strokeStyle = 'rgba(250, 247, 242, 0.75)';
    ctx.lineWidth = Math.max(5, Math.round(7 * scale));
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = effAlpha * 0.35;
    ctx.strokeStyle = color || (urgent ? UI_COLORS.danger : UI_COLORS.ink);
    ctx.lineWidth = Math.max(3, Math.round(4 * scale));
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Kalan süre arkı
    if (clamped > 0.005) {
      ctx.save();
      // Koyu ve açık zeminlerde her zaman net görünmesi için açık dış çerçeve
      ctx.strokeStyle = 'rgba(250, 247, 242, 0.88)';
      ctx.lineWidth = Math.max(8, Math.round(10 * scale));
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, -Math.PI / 2, -Math.PI / 2 + clamped * Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = color || (urgent ? UI_COLORS.danger : UI_COLORS.ink);
      ctx.lineWidth = Math.max(5, Math.round(7 * scale));
      ctx.stroke();
      ctx.restore();
    }
  }

  // Ana metin (sayaç sayısı veya durum)
  ctx.save();
  ctx.font = `900 ${mainFontSize}px ${UI_FONTS.mono}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const textY = subText ? cy - subFontSize * 0.7 : cy;

  // Kontrastlı dış hat (Duvar veya koyu engellerin üstünden geçerken yazının okunmasını sağlar)
  ctx.strokeStyle = 'rgba(250, 247, 242, 0.90)';
  ctx.lineWidth = Math.max(5, Math.round(7 * scale));
  ctx.lineJoin = 'round';
  ctx.strokeText(text, cx, textY);

  ctx.fillStyle = color || (urgent ? UI_COLORS.danger : UI_COLORS.ink);
  ctx.fillText(text, cx, textY);

  // Alt bilgi etiketi
  if (subText) {
    ctx.font = `800 ${subFontSize}px ${UI_FONTS.mono}`;
    ctx.letterSpacing = `${Math.round(1.5 * scale)}px`;
    ctx.strokeStyle = 'rgba(250, 247, 242, 0.90)';
    ctx.lineWidth = Math.max(3, Math.round(4 * scale));
    ctx.strokeText(subText, cx, textY + mainFontSize * 0.56 + subFontSize * 0.5);
    ctx.fillText(subText, cx, textY + mainFontSize * 0.56 + subFontSize * 0.5);
  }
  ctx.restore();

  ctx.restore();
}

// Bir nesnenin (oyuncu, top, mermi vb.) belirtilen kutunun sınırlarına yaklaşıp yaklaşmadığını denetler.
// Yaklaşma varsa true döner (HUD öğesini saydamlaştırıp arkadaki oyun aksiyonunu görünür kılmak için).
export function checkProximity(rect, entities, threshold = 40) {
  if (!entities || !Array.isArray(entities) || entities.length === 0) return false;
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (!e || typeof e.x !== 'number' || typeof e.y !== 'number') continue;
    const r = e.radius || 18;
    if (
      e.x + r >= rect.x - threshold &&
      e.x - r <= rect.x + rect.w + threshold &&
      e.y + r >= rect.y - threshold &&
      e.y - r <= rect.y + rect.h + threshold
    ) {
      return true;
    }
  }
  return false;
}

// Saha Üstü Durum Rozeti (Spatial Badge / Pill):
// Sahadaki durum metinlerini (DONDU, TEHLİKE, SİPER, ATEŞ vb.) çıplak metin yerine
// brutalist sert gölgeli, mat zeminli, yüksek kontrastlı ve okunabilir bir kapsül içinde çizer.
export function renderSpatialBadge(ctx, {
  x,
  y,
  text,
  icon = '',
  color = null,
  bg = null,
  borderColor = null,
  urgent = false,
  alpha = 1.0,
  scale = 1.0,
}) {
  const s = Math.max(0.85, Math.min(1.5, scale));
  // `icon` bir ikon ANAHTARIDIR (örn. 'reload') ve `tabletopIcons`'tan
  // VEKTÖREL çizilir. OS emojisi kullanılmaz — platforma göre değişir ve
  // deterministik değildir. Anahtar bilinmiyorsa eski davranış (metne yapıştır)
  // korunur, yani önceki çağıranlar bozulmaz.
  //
  // `text` boş olabilir: yalnız ikonlu rozet kare bir çipe sığar. Kullanıcı
  // "yazıyı kaldır, sadece ikon kalsın" dedi — metin hem gürültü hem de
  // sahanın üstünü gereksiz kaplıyordu.
  const iconKey = typeof icon === 'string' && hasTabletopIcon(icon) ? icon : null;
  if (!text && !iconKey) return;
  const iconSize = Math.round(13 * s);
  const iconGap = Math.round(4 * s);
  const iconOnly = iconKey && !text;
  const fullText = iconOnly ? '' : (iconKey ? text : (icon ? `${icon} ${text}` : text));

  ctx.save();
  ctx.font = `900 ${Math.round(12 * s)}px ${UI_FONTS.mono}`;
  // İkon-only modda varsayılan 60px genişlik yalnız metin için; kutu yalnız
  // ikonu saracak şekilde ölçülür.
  const textW = iconOnly ? 0 : ((ctx.measureText ? ctx.measureText(fullText)?.width : 0) || 60);
  const padX = Math.round(iconOnly ? 6 * s : 10 * s);
  const padY = Math.round(5 * s);
  const boxW = Math.round(
    iconOnly ? iconSize + padX * 2 : textW + padX * 2 + (iconKey ? iconSize + iconGap : 0),
  );
  const boxH = Math.round((iconOnly ? 20 : 22) * s);
  const boxX = Math.round(x - boxW / 2);
  const boxY = Math.round(y - boxH / 2);
  const shadow = Math.max(2, Math.round(2.5 * s));

  ctx.globalAlpha = alpha;

  // Sert gölge
  ctx.fillStyle = UI_COLORS.ink;
  ctx.fillRect(boxX + shadow, boxY + shadow, boxW, boxH);

  // Gövde
  ctx.fillStyle = bg || (urgent ? UI_COLORS.danger : UI_COLORS.card);
  ctx.fillRect(boxX, boxY, boxW, boxH);

  // Kenarlık
  ctx.strokeStyle = borderColor || UI_COLORS.ink;
  ctx.lineWidth = Math.max(1.5, Math.round(2 * s));
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  // Metin
  ctx.fillStyle = color || (urgent ? UI_COLORS.white : UI_COLORS.ink);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (iconOnly) {
    drawTabletopIcon(ctx, iconKey, x, y + 0.5, iconSize, {
      color: color || UI_COLORS.gold,
    });
  } else if (iconKey) {
    // İkon solda, metin onun sağında — ikisi de kutu içinde ortalanır.
    const groupW = iconSize + iconGap + textW;
    const leftX = x - groupW / 2;
    ctx.textAlign = 'left';
    ctx.fillText(fullText, leftX + iconSize + iconGap, y + 0.5);
    ctx.textAlign = 'center';
    drawTabletopIcon(ctx, iconKey, leftX + iconSize / 2, y + 0.5, iconSize, {
      color: color || (urgent ? UI_COLORS.white : UI_COLORS.ink),
    });
  } else {
    ctx.fillText(fullText, x, y + 0.5);
  }

  ctx.restore();
}

// Havaya süzülen metinleri çizer ve temizler (+1★, HASAR, BLOKE! vb.)
export function renderFloatingTexts(ctx, list, dt = 0.016) {
  if (!list || list.length === 0) return;
  ctx.save();
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i];
    item.life = (item.life || 0) + dt;
    const maxLife = item.maxLife || 0.85;
    if (item.life >= maxLife) {
      list.splice(i, 1);
      continue;
    }
    const progress = item.life / maxLife;
    const currentY = item.y - progress * (item.dist || 36);
    const alpha = 1.0 - Math.pow(progress, 2);

    renderSpatialBadge(ctx, {
      x: item.x,
      y: currentY,
      text: item.text,
      icon: item.icon || '',
      color: item.color || UI_COLORS.ink,
      bg: item.bg || UI_COLORS.white,
      urgent: item.urgent || false,
      alpha: Math.max(0, alpha),
      scale: 1.0 + (item.pop ? (1 - progress) * 0.3 : 0),
    });
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Maç Başlığı (Match Header) — TEK skor + durum yüzeyi
// ---------------------------------------------------------------------------
// Yapı: skor daima SOLDA, küçük bilgi (tur/dalga/süre) varsa SAĞDA. Oyunlar
// buraya yalnız veri verir (statusText/statusTone); çizim kararı çekirdeğindir.
// Kompakt telefonda kutu YOKTUR: zemin üstünde beyaz metin + koyu kontur.
// Masaüstünde uygulama temasında kart (krem zemin, mürekkep kenar, sert gölge).
// Skor önceliklidir: satır daralırsa bilgi budanır.
// Skor satırları tek modelden gelir (`scoreModel.js`): koltuk seçimi ve lider
// kuralı host canvas'ı ile kumanda peek'i arasında paylaşılır.
function headerToneColor(tone) {
  if (tone === 'urgent' || tone === 'boss') return UI_COLORS.danger;
  if (tone === 'armory') return UI_COLORS.hudCharge;
  return UI_COLORS.white;
}

export function renderMatchHeader(ctx, {
  arena,
  players = [],
  scores = [0, 0, 0, 0],
  statusText = '',
  statusTone = null,
  entities = [],
  controlMode = /** @type {string} */ (CONTROL_MODE.NONE),
  isRoundOver = false,
  state = null,
}) {
  const seated = scoreEntries({ players, scores });
  let status = (statusText ?? '').toString().trim();
  if (seated.length === 0 && !status) return;
  const roundOver = Boolean(isRoundOver || state === 'ROUND_OVER' || state === 'MATCH_OVER' || state === 'ROUND_PAUSE');
  const scale = getUiScale(arena);
  const compact = controlMode === CONTROL_MODE.DOM
    || controlMode === CONTROL_MODE.CANVAS
    || isCompactLandscape(arena);

  if (compact) {
    // Kutusuz tek satır: solda skor, sağda bilgi. Okunurluk konturdan gelir.
    const fontPx = Math.max(14, Math.round(15 * scale));
    const y = arena.top + Math.max(2, Math.round(3 * scale));
    const padX = Math.round(8 * scale);
    const segGap = Math.round(12 * scale);
    const colGap = Math.round(14 * scale);
    ctx.save();
    ctx.font = `900 ${fontPx}px ${UI_FONTS.mono}`;
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    const maxW = Math.max(0, arena.width - padX * 2);
    const segs = seated.map((e) => {
      return { text: `P${e.index + 1} ${e.score}★`, leader: e.leader };
    });
    const segW = segs.map((s) => (ctx.measureText ? ctx.measureText(s.text)?.width || 0 : 0));
    const scoresW = segW.reduce((a, w) => a + w, 0) + segGap * Math.max(0, segs.length - 1);
    if (status) {
      const room = Math.max(0, maxW - scoresW - colGap);
      status = clipTextTo(ctx, status, room);
    }
    const statusW = status && ctx.measureText ? (ctx.measureText(status)?.width || 0) : 0;
    ctx.strokeStyle = UI_COLORS.hudInkOutline;
    ctx.lineWidth = Math.max(2.5, Math.round(3 * scale));
    let x = arena.left + padX;
    ctx.textAlign = 'left';
    segs.forEach((s, k) => {
      ctx.strokeText(s.text, x, y);
      ctx.fillStyle = s.leader ? UI_COLORS.gold : UI_COLORS.white;
      ctx.fillText(s.text, x, y);
      x += (segW[k] || 0) + segGap;
    });
    if (status && scoresW + colGap + statusW <= maxW + 1) {
      const sx = arena.right - padX;
      ctx.textAlign = 'right';
      ctx.strokeText(status, sx, y);
      ctx.fillStyle = headerToneColor(statusTone);
      ctx.fillText(status, sx, y);
    }
    ctx.restore();
    return;
  }

  // Temalı kart: tek bar, solda skor, sağda bilgi.
  const namePx = Math.round(12 * scale);
  const scorePx = Math.round(15 * scale);
  const statusPx = Math.round(12 * scale);
  const cPadX = Math.round(12 * scale);
  const dotR = Math.max(3, Math.round(4 * scale));
  const cSegGap = Math.round(14 * scale);
  const divGap = status ? Math.round(12 * scale) : 0;
  ctx.save();
  ctx.font = `900 ${namePx}px ${UI_FONTS.mono}`;
  const labelW = seated.map((e) => {
    const short = e.name.toUpperCase().slice(0, 5);
    return ctx.measureText ? (ctx.measureText(`P${e.index + 1} ${short}`)?.width || 0) : 0;
  });
  ctx.font = `900 ${scorePx}px ${UI_FONTS.mono}`;
  const valueW = seated.map((e) => {
    const v = `${e.score}★`;
    return ctx.measureText ? (ctx.measureText(v)?.width || 0) : 0;
  });
  ctx.font = `900 ${statusPx}px ${UI_FONTS.mono}`;
  let rightW = status && ctx.measureText ? (ctx.measureText(status)?.width || 0) : 0;
  const dotSpan = dotR * 2 + Math.round(5 * scale);
  const leftW = seated.reduce((a, e, k) => a + dotSpan + (labelW[k] || 0) + Math.round(6 * scale) + (valueW[k] || 0), 0)
    + cSegGap * Math.max(0, seated.length - 1);
  const barH = Math.round((roundOver ? 40 : 32) * scale);
  let barW = Math.min(arena.width * 0.94, leftW + (status ? divGap * 2 + 1 + rightW : 0) + cPadX * 2);
  barW = Math.max(barW, Math.min(arena.width * 0.94, leftW + cPadX * 2));
  if (status && leftW + divGap * 2 + 1 + rightW + cPadX * 2 > barW) {
    const room = Math.max(0, barW - cPadX * 2 - leftW - divGap * 2 - 1);
    status = clipTextTo(ctx, status, room);
    rightW = ctx.measureText ? (ctx.measureText(status)?.width || 0) : 0;
  }
  const barX = arena.cx - barW / 2;
  const topMargin = arena.top;
  const barY = topMargin >= barH + 4 ? arena.top - barH - 3 : arena.top + Math.round(4 * scale);

  const isNearby = checkProximity({ x: barX, y: barY, w: barW, h: barH }, entities, 35);
  // Yakın varlıkta bar sönükleşir ki oyunu örtmesin — ama 0.25'te mürekkep
  // yazı sahaya karışıp okunmaz oluyordu (zemin rengine göre değişen okunurluk).
  // Taban 0.85: bar yarı saydam kalır, skor/durum okunur kalır.
  const barAlpha = roundOver ? 1.0 : isNearby ? 0.85 : 1.0;
  ctx.globalAlpha = barAlpha;
  const shadow = Math.max(2, Math.round(3 * scale));
  ctx.fillStyle = UI_COLORS.ink;
  ctx.fillRect(barX + shadow, barY + shadow, barW, barH);
  ctx.fillStyle = UI_COLORS.card;
  ctx.fillRect(barX, barY, barW, barH);
  ctx.strokeStyle = UI_COLORS.ink;
  ctx.lineWidth = Math.max(2, Math.round(2 * scale));
  ctx.strokeRect(barX, barY, barW, barH);

  const midY = barY + barH / 2;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  let cx = barX + cPadX;
  ctx.textAlign = 'left';
  seated.forEach((e, k) => {
    const v = e.score;
    const leader = e.leader;
    ctx.beginPath();
    ctx.arc(cx + dotR, midY, dotR, 0, Math.PI * 2);
    ctx.fillStyle = e.color;
    ctx.fill();
    ctx.strokeStyle = UI_COLORS.ink;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    cx += dotSpan;
    const short = e.name.toUpperCase().slice(0, 5);
    const label = `P${e.index + 1} ${short}`;
    ctx.font = `900 ${namePx}px ${UI_FONTS.mono}`;
    ctx.fillStyle = UI_COLORS.ink;
    ctx.fillText(label, cx, midY);
    cx += (labelW[k] || 0) + Math.round(6 * scale);
    const value = `${v}★`;
    ctx.font = `900 ${scorePx}px ${UI_FONTS.mono}`;
    if (leader) {
      ctx.strokeStyle = UI_COLORS.ink;
      ctx.lineWidth = Math.max(1.5, Math.round(2 * scale));
      ctx.strokeText(value, cx, midY);
      ctx.fillStyle = UI_COLORS.gold;
    } else {
      ctx.fillStyle = UI_COLORS.ink;
    }
    ctx.fillText(value, cx, midY);
    cx += (valueW[k] || 0) + cSegGap;
  });
  if (status) {
    cx -= cSegGap;
    ctx.strokeStyle = UI_COLORS.faint;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + divGap, barY + Math.round(7 * scale));
    ctx.lineTo(cx + divGap, barY + barH - Math.round(7 * scale));
    ctx.stroke();
    ctx.font = `900 ${statusPx}px ${UI_FONTS.mono}`;
    ctx.textAlign = 'right';
    // Tonlu durum (boss/urgent/armory) krem kartta tek başına zayıf kalabiliyor;
    // lider skorunda olduğu gibi koyu konturla okunur kılınır.
    if (statusTone) {
      ctx.strokeStyle = UI_COLORS.ink;
      ctx.lineWidth = Math.max(1.5, Math.round(2 * scale));
      ctx.strokeText(status, barX + barW - cPadX, midY);
    }
    ctx.fillStyle = statusTone ? headerToneColor(statusTone) : UI_COLORS.ink;
    ctx.fillText(status, barX + barW - cPadX, midY);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Uyarlanabilir Skor Paneli (Adaptive Scoreboard)
// ---------------------------------------------------------------------------
// TEK skor + durum yüzeyi: `renderMatchHeader` (skor solda, bilgi sağda).
// Kompakt telefonda kutusuz metin, masaüstünde temalı kart. Ayrı köşe
// rozetleri ve yarı saydam füme bar kaldırıldı.
export function renderAdaptiveScoreboard(ctx, {
  arena,
  players = [],
  scores = [0, 0, 0, 0],
  targetScore = 3, // imza uyumu için tutulur; hedef kartta gösterilmez
  entities = [],
  controlMode = /** @type {string} */ (CONTROL_MODE.NONE),
  statusText = '',
  statusTone = null,
  isRoundOver = false,
  state = null,
}) {
  renderMatchHeader(ctx, {
    arena,
    players,
    scores,
    statusText,
    statusTone,
    entities,
    controlMode,
    isRoundOver,
    state,
  });
}

// ---------------------------------------------------------------------------
// Merkezi Varlık HUD (Entity Overhead Status System)
// ---------------------------------------------------------------------------

/**
 * Ateş/doldurma göstergesi — `core/entityStatus` rozetine delegasyon.
 *
 * ESKİDEN burada `radius + 10` yarıçapında 3px'lik bir halka vardı; krem
 * zeminde `cooldownTrack` (0.28 alfa) 1.78:1 ve altın yay 1.18:1 ile
 * görünmüyordu. Üç ayrı fonksiyon (bu, `renderEntityHUD`'ın yetenek halkası,
 * `laserView`'un dash halkası) aynı karakterin etrafını üç ayrı ince çemberle
 * çiziyordu. Artık tek geometri, tek yer: koyu plaka + ikon.
 */
export function renderFireCooldown(ctx, {
  x,
  y,
  radius = 16,
  progress = null,
  feedback = null,
  arena = null,
  icon = 'zap',
  index = 0,
  count = 1,
}) {
  const normalized = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 1;
  const ttl = feedback && Number.isFinite(feedback.ttl)
    ? Math.max(0, Math.min(1, feedback.ttl))
    : 0;
  const kind = feedback?.kind ?? null;
  const hasProgress = Number.isFinite(progress) && normalized < 0.999;

  // Hiçbir şey görünecekse çizme (cooldown yok, geri bildirim yok).
  if (!hasProgress && ttl <= 0) return;

  // Atış anı: yalnız kısa bir parlama, kalıcı durum değil.
  if (kind === 'shot' && ttl > 0) {
    ctx.save();
    ctx.globalAlpha = ttl * 0.9;
    drawStatusChip(ctx, { x, y, radius, arena, icon, state: STATUS_STATE.READY, index, count });
    ctx.restore();
    return;
  }

  const state = kind === 'blocked'
    ? STATUS_STATE.BLOCKED
    : (hasProgress ? STATUS_STATE.CHARGING : STATUS_STATE.READY);

  drawStatusChip(ctx, {
    x,
    y,
    radius,
    arena,
    icon,
    state,
    progress: hasProgress ? normalized : 1,
    remaining: hasProgress ? (1 - normalized) * 4 : 0,
    index,
    count,
  });
}

// Tüm oyun motorlarında (Tanks, Laser, Bomb, Crown vb.) oyuncunun/tankın üstünde
// veya etrafında cephane, can, yetenek dolum arkı, kalkan ve sersemleme gösterir.
// - Kenar Koruma (Edge Clamping): Karakter arena tavanına yaklaştığında göstergeler
//   otomatik olarak alta döner (flip), tavan veya duvar arkasında kaybolmaz.
// - Neo-Brutalist Yüksek Kontrast: Açık ve koyu zeminlerde %100 okunur siyah kutu + krem kontur.
export function renderEntityHUD(ctx, {
  x,
  y,
  radius = 16,
  color = UI_COLORS.ink,
  arena = null,
  scale = 1.0,
  hp = null,
  maxHp = null,
  ammo = null,
  maxAmmo = null,
  reloadProgress = 0,
  cooldownProgress = null, // null: yok/pasif; 0..1: doluyor; >= 1: hazır parıltı
  shield = false,
  stun = false,
  label = '',
  chipIndex = 0, // aynı karakterde ikinci bir rozet varsa (ateş + yetenek) yatay dizilim
  chipCount = 1,
}) {
  const s = Math.max(0.75, Math.min(1.4, scale));
  const now = performance.now();

  ctx.save();

  // 1. Kalkan Balonu & Dönen Uydu
  //
  // Geometri durum halesi olarak kalıyor; renk okunur koyuya çevrildi
  // (`#0EA5E9` krem zeminde 2.30:1, `#38BDF8` 1.91:1 — ikisi de görünmez).
  // Uydu noktası halkanın üstünde oturduğu için halkanın kontrastlığından
  // ayrı, açık bir ton taşır.
  if (shield) {
    const shieldR = radius + Math.round(9 * s);
    ctx.save();
    ctx.strokeStyle = UI_COLORS.hudShield;
    ctx.lineWidth = Math.max(2, Math.round(2.5 * s));
    ctx.fillStyle = UI_COLORS.hudShieldFill;
    ctx.beginPath();
    ctx.arc(x, y, shieldR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const sAng = (now / 1000) * 3.2;
    ctx.fillStyle = UI_COLORS.hudShieldDot;
    ctx.beginPath();
    ctx.arc(x + Math.cos(sAng) * shieldR, y + Math.sin(sAng) * shieldR, 3.5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 2. Sersemleme / Daze Yıldızları
  if (stun) {
    ctx.save();
    const starTime = now / 320;
    for (let k = 0; k < 3; k++) {
      const ang = starTime + (k * Math.PI * 2) / 3;
      const sx = x + Math.cos(ang) * (radius + 7 * s);
      const sy = (y - radius * 0.3) + Math.sin(ang) * (4 * s);
      // Koyu kontur: altın yıldız krem zeminde 1.18:1 ile görünmüyordu.
      ctx.font = `900 ${Math.round(11 * s)}px ${UI_FONTS.mono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(2, Math.round(2.5 * s));
      ctx.lineJoin = 'round';
      ctx.strokeStyle = UI_COLORS.hudInkOutline;
      ctx.strokeText('★', sx, sy);
      ctx.fillStyle = UI_COLORS.gold;
      ctx.fillText('★', sx, sy);
    }
    ctx.restore();
  }

  // 3. Başüstü Yığını: Yetenek rozeti → Can → Cephane.
  //
  // Üçü de aynı dikey sütunda, tek `flipBelow` kararıyla aynı yöne döner.
  // Daha önce yetenek göstergesi karakterin ETRAFINDA ayrı bir çemberdi;
  // cephane başüstüydü. Aynı bilgi iki ayrı yer, iki ayrı geometri.
  const hasHp = typeof hp === 'number' && typeof maxHp === 'number' && maxHp > 0;
  const hasAmmo = typeof ammo === 'number' && typeof maxAmmo === 'number' && maxAmmo > 0;
  const hasCooldown = cooldownProgress !== null && cooldownProgress !== undefined;

  if (hasHp || hasAmmo || hasCooldown) {
    // Tavan / Kenar çakışma koruması (Edge Clamping / Flipping)
    const totalOverheadH = (hasCooldown ? 20 * s : 0)
      + (hasHp ? 12 * s : 0)
      + (hasAmmo ? 15 * s : 0);
    let flipBelow = false;
    if (arena && (y - radius - totalOverheadH < (arena.top || 0) + 10 * s)) {
      flipBelow = true;
    }

    let currentAnchorY = flipBelow
      ? y + radius + Math.round(10 * s)
      : y - radius - Math.round(8 * s);

    // A. Yetenek / Dash hazır rozeti (`core/entityStatus` — tek geometri)
    if (hasCooldown) {
      const prog = Math.max(0, Math.min(1.0, cooldownProgress));
      const chipBox = drawStatusChip(ctx, {
        x,
        y,
        radius,
        arena,
        scale: s,
        icon: 'zap',
        state: prog >= 0.999 ? STATUS_STATE.READY : STATUS_STATE.CHARGING,
        progress: prog,
        remaining: prog < 0.999 ? (1 - prog) * 3 : 0,
        anchorY: currentAnchorY,
        index: chipIndex,
        count: chipCount,
      });
      if (chipBox) {
        currentAnchorY = flipBelow
          ? currentAnchorY + chipBox.h + Math.round(4 * s)
          : currentAnchorY - chipBox.h - Math.round(4 * s);
      }
    }

    // Yatay eksende ekran dışına taşmayı önle
    let anchorX = x;
    if (arena) {
      const minX = (arena.left || 0) + Math.round(32 * s);
      const maxX = (arena.right || 800) - Math.round(32 * s);
      anchorX = Math.max(minX, Math.min(maxX, anchorX));
    }

    // A. Can (HP Pip'leri)
    if (hasHp) {
      const pw = Math.round(7 * s);
      const gap = Math.round(3 * s);
      const totalW = maxHp * pw + (maxHp - 1) * gap;
      const startX = anchorX - totalW / 2;
      const hpY = flipBelow ? currentAnchorY + Math.round(5 * s) : currentAnchorY - Math.round(5 * s);

      ctx.save();
      for (let h = 0; h < maxHp; h++) {
        const cx = startX + h * (pw + gap) + pw / 2;
        // Boş pip `disabled` (#E5DCC9) krem zeminde 1.13:1 — görünmez.
        // `hudEmpty` 5.6:1: dolu ile boş pip artık ayrışıyor.
        ctx.fillStyle = h < hp ? color : UI_COLORS.hudEmpty;
        ctx.strokeStyle = UI_COLORS.ink;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, hpY, pw / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();

      currentAnchorY = flipBelow ? currentAnchorY + Math.round(14 * s) : currentAnchorY - Math.round(14 * s);
    }

    // B. Mermi / Cephane Kutusu (Ammo Cartridges Box)
    if (hasAmmo) {
      const bulletW = Math.round(12 * s);
      const bulletH = Math.round(7 * s);
      const bulletGap = Math.round(3 * s);
      const totalBulletsW = maxAmmo * bulletW + (maxAmmo - 1) * bulletGap;
      const padX = Math.round(4 * s);
      const padY = Math.round(2.5 * s);
      const boxW = totalBulletsW + padX * 2;
      const boxH = bulletH + padY * 2;
      const boxX = Math.round(anchorX - boxW / 2);
      const boxY = Math.round(flipBelow ? currentAnchorY : currentAnchorY - boxH);

      ctx.save();
      // Koyu koruyucu çerçeve + kenarlık
      ctx.fillStyle = UI_COLORS.ammoFrame;
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.strokeStyle = UI_COLORS.ink;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(boxX, boxY, boxW, boxH);

      for (let a = 0; a < maxAmmo; a++) {
        const bx = boxX + padX + a * (bulletW + bulletGap);
        const by = boxY + padY;
        const isReady = a < ammo;
        const isReloading = a === ammo && ammo < maxAmmo && reloadProgress > 0;

        // Fişek yuvası arka planı. `ammoEmpty` çerçeveyle 1.23:1 idi —
        // boş yuva dolu yuvadan ayırt edilemiyordu. `hudEmpty` 5.6:1.
        ctx.fillStyle = UI_COLORS.hudEmpty;
        ctx.fillRect(bx, by, bulletW, bulletH);

        if (isReady) {
          // Dolu fişek: Oyuncu rengi + beyaz uç parıltısı
          ctx.fillStyle = color;
          ctx.fillRect(bx, by, bulletW, bulletH);
          ctx.fillStyle = UI_COLORS.white;
          ctx.fillRect(bx + bulletW - Math.round(3 * s), by + 1, Math.round(2.5 * s), bulletH - 2);
        } else if (isReloading) {
          // Doluyor: altın dolum ilerlemesi — koyu çerçeve üstünde 9.7:1
          ctx.fillStyle = UI_COLORS.ammoReloading;
          ctx.fillRect(bx, by, Math.round(bulletW * Math.min(1.0, reloadProgress)), bulletH);
        }

        ctx.strokeStyle = UI_COLORS.ink;
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, bulletW, bulletH);
      }
      ctx.restore();
    }
  }

  // 4. İsteğe Bağlı Etiket (P1, P2 vb.)
  if (label) {
    ctx.save();
    ctx.font = `900 ${Math.round(10 * s)}px ${UI_FONTS.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Kontur KOYU olmalı: `outlineContrast` beyaz, krem zeminde 1.10:1 —
    // yani kontur hiç iş görmüyordu ve açık renkli oyuncu etiketleri
    // (P3 1.28:1) zeminde kayboluyordu.
    ctx.strokeStyle = UI_COLORS.hudInkOutline;
    ctx.lineWidth = 3;
    ctx.strokeText(label, x, y + radius + Math.round(8 * s));
    ctx.fillStyle = color;
    ctx.fillText(label, x, y + radius + Math.round(8 * s));
    ctx.restore();
  }

  ctx.restore();
}

/**
 * Giriş sonu "tick-zıplatma" eğrisi (Faz 3.6). `enter` 0→1 ilerlerken sonuç
 * kartı yerine oturur; son dilimde skor değeri kısa bir zıplama yapıp oturur —
 * kazanma anı "bitti" değil "oldu" hissi verir. Kart dili/ölçüsü DEĞİŞMEZ,
 * yalnız metin ölçeği oynar. Azaltılmış harekette (motion 0) sabit 1.
 * Saf ve test edilebilir.
 * @param {number} enter 0..1 (MATCH_OVER girişinden bu yana)
 * @param {number} [motion] motionScale()
 * @returns {number} ölçek çarpanı (≥1)
 */
export function tickPopScale(enter, motion = 1) {
  if (!(motion > 0)) return 1;
  const t = Math.max(0, Math.min(1, Number(enter) || 0));
  if (t <= 0.55 || t >= 1) return 1;
  const phase = (t - 0.55) / 0.45;
  return 1 + 0.14 * Math.sin(Math.PI * phase);
}

/**
 * Raunt geri sayımı tik-zıplatması (Faz 3.6): her tam saniye düşüşünde sayı
 * kısa bir zıplama yapar. Kalan sürenin ondalık kısmı yeni tikte ~1 → sayı
 * taze; sıfıra indikçe nabız söner. Azaltılmış harekette sabit 1.
 * @param {number} countdown kalan saniye
 * @param {number} [motion] motionScale()
 * @returns {number} ölçek çarpanı (≥1)
 */
export function roundTickPop(countdown, motion = 1) {
  if (!(motion > 0)) return 1;
  const left = Math.max(0, Number(countdown) || 0);
  if (left <= 0) return 1;
  const frac = left - Math.floor(left);
  return 1 + 0.14 * frac;
}

// Standart raund bandı: başlık + alt bilgi. Final kartıyla aynı paneli paylaşır
// — tur sonu ile maç sonu iki farklı dilde konuşmaz.
export function renderRoundBanner(ctx, { arena, title, titleColor, sub = '', countdown = 0 }) {
  const ts = uiTextScale(getUiScale(arena));
  const boxW = Math.min(Math.round(440 * ts), arena.width * 0.88);
  const boxH = Math.round((sub ? 88 : 68) * ts);
  const box = { x: arena.cx - boxW / 2, y: arena.cy - boxH / 2, w: boxW, h: boxH };

  ctx.save();
  drawResultPanel(ctx, box, ts);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = titleColor || UI_COLORS.resultInk;
  ctx.font = uiFont('button', ts);
  ctx.fillText(title, arena.cx, sub ? box.y + boxH * 0.38 : box.y + boxH / 2, boxW - Math.round(28 * ts));

  if (sub) {
    ctx.fillStyle = UI_COLORS.resultMuted;
    ctx.font = uiFont('monoBody', ts);
    ctx.fillText(sub, arena.cx, box.y + boxH * 0.72, boxW - Math.round(28 * ts));
  }

  // Raunt boşluğu geri sayımı — "bam diye başladı"nın panzehiri. Sayı yalnız
  // bilgi değil, SİNYAL: oyuncu bir sonraki rauntun ne zaman geldiğini görürse
  // geçiş ani hissedilmez ve tepki için payı olduğunu anlar.
  //
  // Sağ alta yaslanır: başlık ve alt metnin düzenine dokunmaz, dolayısıyla
  // hiçbir motorun kutu hesabı değişmez. Eriyen bir ilerleme çubuğu daha şık
  // olurdu ama başlangıç toplamını istemek 15 motora yeni bir alan demekti —
  // bu kazanç için o bedel ödenmedi.
  //
  // Kuma saati ikonu dili taşımaz ve kumanda yüzeyindeki rozetle aynı anlamı
  // taşır; çıplak "3" yerine neyin sayıldığını kendi söyler.
  const left = Math.max(0, Number(countdown) || 0);
  if (left > 0) {
    const label = String(Math.ceil(left));
    const size = Math.round(16 * ts);
    ctx.font = uiFont('monoBody', ts);
    const textW = ctx.measureText(label).width;
    const gap = Math.round(5 * ts);
    const totalW = size + gap + textW;
    const right = box.x + box.w - Math.round(16 * ts);
    const baseY = box.y + box.h - Math.round(14 * ts);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = UI_COLORS.resultGold;
    if (hasTabletopIcon('hourglass')) {
      drawTabletopIcon(ctx, 'hourglass', right - totalW + size / 2, baseY, size, {
        color: UI_COLORS.resultGold,
      });
    }
    // Tik-zıplatma: sayı her düştüğünde kısa bir zıplama (kart dili değişmez).
    const pop = roundTickPop(left, motionScale());
    if (pop !== 1) {
      ctx.save();
      ctx.translate(right - textW / 2, baseY);
      ctx.scale(pop, pop);
      ctx.fillText(label, -textW / 2, 0);
      ctx.restore();
    } else {
      ctx.fillText(label, right - textW, baseY);
    }
  }
  ctx.restore();
}

export function cleanWinnerName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.replace(/^P[1-4]\s*[•·\-–—]\s*/i, '').trim();
}

// Final kartı düzeni: kartın yüksekliği İÇERİKTEN türer. Eskiden 230 tasarım
// px'te sabitti; telefonda 4 satır ile buton arasında ölçülen boşluk 8 px'e
// iniyor ve beşinci satır butonun üstüne biniyordu. Tek sütunlu hâli de yatay
// telefonda arena yüksekliğinin %48'ini yiyordu (masaüstünde %38) — küçük
// ekranda kart daha da baskındı.
//
// Geniş yüzeyde (en-boy ≥ `finalSplitAspect`) kart iki sütuna bölünür: solda
// kazanan, sağda sıralama ve eylemler. Telefon kumandasındaki tam ekran sonucun
// yatay kadrajıyla aynı karar, böylece iki yüzey aynı şeyi anlatır.
//
// Saf fonksiyondur (çizim yok): `tests/matchOverLayout.test.mjs` bu sözleşmeyi
// telefon yatayından TV'ye kadar kilitler.
export function layoutMatchOverCard(arena, { rowCount = 0, actionCount = 1 } = {}) {
  const S = UI_SIZES;
  const split = arena.width / (arena.height || 1) >= S.finalSplitAspect;
  const maxH = arena.height * S.finalMaxHeightFraction;

  // tek geçiş: birim ölçek → tüm kutular. Doğal yükseklik sahayı aşarsa aynı
  // hesap bir kez daha, küçültülmüş ölçekle kurulur (kart asla taşmaz).
  const build = (ts) => {
    const u = (v) => Math.round(v * ts);
    const pad = u(S.finalPad);
    const rowH = u(S.finalRowH);
    const rowGap = u(S.finalRowGap);
    const sectionGap = u(S.finalSectionGap);
    const labelH = u(S.finalLabelH);
    const nameH = u(S.finalNameH);
    const nameGap = u(S.finalLabelNameGap);
    const heroR = u(split ? S.finalHeroRSplit : S.finalHeroR);
    const btnGap = u(S.finalBtnGap);
    const btnH = Math.max(S.finalBtnHMin, u(S.finalBtnTall)); // 44 px: dokunma tabanı

    const cardW = Math.min(
      u(split ? S.finalCardWSplit : S.finalCardW),
      arena.width * S.finalMaxWidthFraction,
    );
    const innerW = cardW - pad * 2;
    const colGap = split ? u(S.finalColGap) : 0;
    const leadW = split ? Math.min(innerW * S.finalLeadShare, u(S.finalLeadMaxW)) : innerW;
    const boardW = split ? innerW - leadW - colGap : innerW;

    // İki eylem yan yana `finalBtnMinW`'in altına düşecekse alt alta geçer:
    // dokunma hedefinin genişliği yüksekliğinden ödünç alınamaz.
    const sideBySide = actionCount < 2
      || (boardW - btnGap * (actionCount - 1)) / actionCount >= S.finalBtnMinW;
    const btnW = sideBySide ? (boardW - btnGap * (actionCount - 1)) / actionCount : boardW;
    const actionsH = actionCount <= 0 ? 0
      : (sideBySide ? btnH : actionCount * btnH + (actionCount - 1) * btnGap);

    const rowsH = rowCount <= 0 ? 0 : rowCount * rowH + (rowCount - 1) * rowGap;
    const boardH = rowsH + (rowsH && actionsH ? sectionGap : 0) + actionsH;
    // Kazanan bloğu: geniş yüzeyde avatar ÜSTTE, ad ALTTA — ad sütunun tüm
    // genişliğini kullanır (yan yana koyunca 12 karakterlik isim 568 px'lik
    // yatay telefona sığmıyordu). Dar yüzeyde avatar ve ad aynı satırda.
    const leadH = split
      ? labelH + nameGap + heroR * 2 + nameGap + nameH
      : labelH + nameGap + Math.max(heroR * 2, nameH);

    const naturalH = pad + (split ? Math.max(leadH, boardH) : leadH + sectionGap + boardH) + pad;
    const cardH = Math.min(naturalH, maxH);

    const x = arena.cx - cardW / 2;
    const y = arena.cy - cardH / 2;
    const bandH = cardH - pad * 2;
    const leadX = x + pad;
    const boardX = split ? leadX + leadW + colGap : x + pad;
    // Sütunlar kendi bandında dikeyde ortalanır: kısa kalan sütun ortada, uzun
    // olan bant boyunca yayılır.
    const leadTop = y + pad + Math.max(0, (bandH - leadH) / 2);
    const boardTop = y + pad + Math.max(0, (bandH - boardH) / 2);

    const hero = {
      cx: leadX + heroR,
      cy: split
        ? leadTop + labelH + nameGap + heroR
        : leadTop + labelH + nameGap + Math.max(heroR, nameH / 2),
      r: heroR,
    };
    const name = split
      ? { x: leadX, y: hero.cy + heroR + nameGap, w: leadW, h: nameH }
      : {
        x: hero.cx + heroR + nameGap,
        y: hero.cy - nameH / 2,
        w: Math.max(0, leadW - heroR * 2 - nameGap),
        h: nameH,
      };

    const rows = [];
    for (let i = 0; i < rowCount; i++) {
      rows.push({ x: boardX, y: boardTop + i * (rowH + rowGap), w: boardW, h: rowH });
    }
    const actionsTop = boardTop + rowsH + (rowsH && actionsH ? sectionGap : 0);
    const actions = [];
    for (let i = 0; i < actionCount; i++) {
      actions.push(sideBySide
        ? { x: boardX + i * (btnW + btnGap), y: actionsTop, w: btnW, h: btnH }
        : { x: boardX, y: actionsTop + i * (btnH + btnGap), w: boardW, h: btnH });
    }

    const box = { x, y, w: cardW, h: cardH };
    return {
      ts,
      split,
      naturalH,
      ...box,
      pad,
      radius: resultPanelRadius(box),
      label: { x: leadX, y: leadTop, w: leadW, h: labelH },
      name,
      hero,
      rows,
      actions,
    };
  };

  const first = build(uiTextScale(getUiScale(arena)));
  if (first.naturalH <= maxH) return first;
  return build(uiTextScale(getUiScale(arena)) * (maxH / first.naturalH));
}

// Canvas `fillText(text, x, y, maxWidth)` sığmayan metni KICIRTIK yapar
// (glifler incelir, okunmaz). Son çare olarak sonlu karakterle budarız.
function clipTextTo(ctx, text, maxWidth) {
  if (!text || maxWidth <= 0 || ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, Math.max(1, lo))}…`;
}

// Ölçeği yazı sığana kadar geri çeker, tabanın altına inmez; hâlâ taşarsa
// `clipTextTo` budar. Dönen değer ardından kullanılacak `uiFont` ölçeğidir.
function fontScaleFor(ctx, role, ts, text, maxWidth) {
  const minPx = Math.max(12, UI_TEXT[role][1] * ts * UI_SIZES.finalTextMinRatio);
  let scale = ts;
  ctx.font = uiFont(role, scale);
  if (!text || maxWidth <= 0 || ctx.measureText(text).width <= maxWidth) return scale;
  while (scale * UI_TEXT[role][1] > minPx) {
    scale *= 0.94;
    ctx.font = uiFont(role, scale);
    if (ctx.measureText(text).width <= maxWidth) return scale;
  }
  ctx.font = uiFont(role, scale);
  return scale;
}

// Standart final kartı. `rows` yapılandırılmıştır: `{ color, name, value }` —
// motorlar kopya metin yerine veri verir, biçimi bu kart bir kere kurar.
// Kazananın avatarı `winnerEntity`'den gelir (koltuk aksesuarı/ifadesi dahil),
// böylece ödül anı oyuncunun kendi karakteriyle kutlanır.
export function renderMatchOver(ctx, {
  arena,
  uiButtons = null,
  headline,
  winnerName = '',
  winnerColor = UI_COLORS.resultGold,
  winnerEntity = null,
  rows = [],
  onRestart = null,
  onLobby = null,
  viewport = null,
  enter = 1,
}) {
  /** @type {any[]} */
  const entries = rows.slice(0, 4).map((row) => ({
    color: row.color || UI_COLORS.resultInk,
    name: String(row.name ?? ''),
    value: row.value === undefined || row.value === null ? '' : String(row.value),
    // `score` sıralama anahtarıdır: motor veri verir, kart rütbeyi kendisi
    // çözer. Verilmediğinde rütbe sütunu çizilmez — koltuk sırasıyla üretilen
    // satırlara "1" yazmak sıralamayı uydurmak olurdu.
    score: Number.isFinite(row.score) ? row.score : null,
  }));
  // Rütbeyi kart çözer: her satır sayısal puanını taşıyorsa listeyi ona göre
  // dizer ve numaralandırır. Taşımayan listede sıra motora aittir ve uydurma
  // bir "1" basılmaz.
  if (entries.length > 0 && entries.every((entry) => entry.score !== null)) {
    entries.sort((a, b) => b.score - a.score);
    entries.forEach((entry, i) => { entry.rank = i + 1; });
  } else {
    entries.forEach((entry) => { entry.rank = null; });
  }
  if (entries.length > 0 && entries.every((entry) => entry.score !== null)) {
    entries.sort((a, b) => b.score - a.score);
    entries.forEach((entry, i) => { entry.rank = i + 1; });
  }
  const actions = [];
  if (typeof onRestart === 'function') actions.push({ label: t('canvas.playAgain'), kind: 'primary', onClick: onRestart });
  if (typeof onLobby === 'function') actions.push({ label: t('pad.toLobby'), kind: 'secondary', onClick: onLobby });

  const g = layoutMatchOverCard(arena, { rowCount: entries.length, actionCount: actions.length });
  const cleanWinner = cleanWinnerName(winnerName);
  // Berabere: kazanan adı yoktur, motorun etiketi büyük söze iner — ikiz
  // "BERABERE! BERABERE!" çizmemek için.
  const labelText = cleanWinner ? String(headline || '').toUpperCase() : '';
  const heroText = cleanWinner || String(headline || t('game.draw')).toUpperCase();
  const inset = Math.round(6 * g.ts);

  // Giriş yumuşaması: final kartı ani "pat" diye gelmesin (AGENTS §8). `enter`
  // MATCH_OVER'a girişten bu yana geçen süreden türetilir; varsayılan 1 =
  // animasyonsuz (tek kare çizen testler/durumlar etkilenmez). Kart komple
  // solar + birkaç px aşağıdan kayar; karartma da onunla birlikte gelir.
  const enterEase = enter >= 1 ? 1 : enter <= 0 ? 0 : 1 - Math.pow(1 - enter, 3);
  ctx.save();
  if (enterEase < 1) {
    ctx.globalAlpha = enterEase;
    ctx.translate(0, Math.round((1 - enterEase) * 14 * g.ts));
  }
  dimBehindPanel(ctx, viewport && viewport.width > 0 ? viewport : arena);
  drawResultPanel(ctx, { x: g.x, y: g.y, w: g.w, h: g.h }, g.ts, g.radius);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  ctx.font = uiFont('finalLabel', g.ts);
  ctx.fillStyle = UI_COLORS.resultMuted;
  ctx.fillText(clipTextTo(ctx, labelText, g.label.w), g.label.x, g.label.y + g.label.h / 2);

  if (cleanWinner) {
    drawGameAvatar(ctx, g.hero.cx, g.hero.cy, g.hero.r, winnerEntity || {
      name: cleanWinner,
      color: winnerColor,
      index: 0,
    }, { label: '', color: winnerColor, borderColor: winnerColor });

    const heroScale = fontScaleFor(ctx, 'finalHero', g.ts, cleanWinner, g.name.w);
    ctx.font = uiFont('finalHero', heroScale);
    ctx.fillStyle = UI_COLORS.resultGold;
    ctx.fillText(clipTextTo(ctx, cleanWinner, g.name.w), g.name.x, g.name.y + g.name.h / 2);
  } else {
    const heroScale = fontScaleFor(ctx, 'finalHero', g.ts, heroText, g.w - g.pad * 2);
    ctx.font = uiFont('finalHero', heroScale);
    ctx.fillStyle = UI_COLORS.resultInk;
    ctx.fillText(clipTextTo(ctx, heroText, g.w - g.pad * 2), g.label.x, g.hero.cy);
  }

  // Sıralama: saydam satır pill'leri — rütbe, renk noktası, isim solda, puan sağda.
  const showRank = entries.length > 0 && entries.every((entry) => Number.isInteger(entry.rank));
  const rankW = showRank ? Math.round(20 * g.ts) : 0;
  entries.forEach((entry, i) => {
    const row = g.rows[i];
    ctx.fillStyle = UI_COLORS.resultRow;
    pathRoundRect(ctx, row.x, row.y, row.w, row.h, Math.round(row.h * 0.32));
    ctx.fill();

    const cy = row.y + row.h / 2;
    if (showRank) {
      ctx.font = uiFont('monoLabel', g.ts);
      ctx.fillStyle = UI_COLORS.resultMuted;
      ctx.fillText(String(entry.rank), row.x + inset, cy);
    }

    const dotR = Math.max(4, Math.round(6 * g.ts));
    const dotX = row.x + inset + rankW + dotR;
    ctx.beginPath();
    ctx.arc(dotX, cy, dotR, 0, Math.PI * 2);
    ctx.fillStyle = entry.color;
    ctx.fill();

    const nameX = dotX + dotR + Math.round(9 * g.ts);
    const valueX = row.x + row.w - inset;
    ctx.font = uiFont('finalRowValue', g.ts);
    const valueW = entry.value ? ctx.measureText(entry.value).width : 0;

    const nameMax = Math.max(0, valueX - valueW - Math.round(12 * g.ts) - nameX);
    ctx.font = uiFont('finalRow', g.ts);
    ctx.fillStyle = UI_COLORS.resultInk;
    ctx.fillText(clipTextTo(ctx, entry.name, nameMax), nameX, cy);

    if (entry.value) {
      ctx.textAlign = 'right';
      ctx.font = uiFont('finalRowValue', g.ts);
      ctx.fillStyle = UI_COLORS.resultGold;
      // Kazananın skoru kart yerine otururken kısa bir tick-zıplatma yapar
      // (Faz 3.6). Yalnız sıralamanın tepesindeki satır; başka satır oynamaz.
      const pop = showRank && entry.rank === 1 ? tickPopScale(enter, motionScale()) : 1;
      if (pop !== 1) {
        ctx.save();
        ctx.translate(valueX - valueW / 2, cy);
        ctx.scale(pop, pop);
        ctx.fillText(entry.value, valueW / 2, 0);
        ctx.restore();
      } else {
        ctx.fillText(entry.value, valueX, cy);
      }
      ctx.textAlign = 'left';
    }
  });

  // Eylemler: birincil altın, ikincil yeşil — kumanda sonuç ekranıyla aynı dil.
  actions.forEach((action, i) => {
    const btn = g.actions[i];
    ctx.fillStyle = action.kind === 'primary' ? UI_COLORS.gold : UI_COLORS.success;
    pathRoundRect(ctx, btn.x, btn.y, btn.w, btn.h, Math.round(btn.h * 0.30));
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.font = uiFont('buttonSmall', g.ts);
    ctx.fillStyle = UI_COLORS.onAccent;
    ctx.fillText(clipTextTo(ctx, action.label, btn.w - Math.round(14 * g.ts)), btn.x + btn.w / 2, btn.y + btn.h / 2);
    ctx.textAlign = 'left';

    uiButtons?.push({ x: btn.x, y: btn.y, w: btn.w, h: btn.h, onClick: action.onClick });
  });

  ctx.restore();

  // Kart kutusu dışarı verilir: "kartın boşluğuna dokunmak yeniden
  // başlatmasın" gardi bunu okur (`touchFlow.matchOverRestartTap`).
  return { x: g.x, y: g.y, w: g.w, h: g.h };
}
