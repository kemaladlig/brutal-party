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
import { isCompactLandscape } from '../core/playfield.js';
import { drawResultPanel, dimBehindPanel, resultPanelRadius, uiTextScale } from './resultPanel.js';
import { drawGameAvatar } from '../core/avatarInGame.js';
import { drawStatusChip, STATUS_STATE } from '../core/entityStatus.js';

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
    // Konum ÜST-ORTA: köşeler `renderCornerScores`'un dört rozetine ait
    // (ölçüldü: 10 viewport'ta kartlar birbirine ve saha dışına taşmıyor).
    // Sola yaslamak P2 çipiyle çakışıyordu — kapatılan çubuğun yerine
    // yeni bir çakışma bırakmak olurdu.
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
}) {
  if (!text) return;
  const scale = getUiScale(arena);
  const minDim = Math.min(arena.width, arena.height);

  // Sayacın okunur olması yeterli; ilerlemeyi zaten halka taşıyor. Eski
  // tavan (minDim'in %18'i, masaüstünde ~142px) saha yüksekliğinin %15.6'sını
  // kaplıyordu — kalıcı bir sayaç için gereğinden büyük. Yeni tavan %9.5.
  const mainFontSize = Math.max(30, Math.min(Math.round(78 * (scale / 1.55)), Math.floor(minDim * 0.095)));
  const subFontSize = Math.max(11, Math.min(Math.round(16 * scale), Math.floor(minDim * 0.032)));

  const cx = arena.cx;
  const cy = arena.cy + offsetY;

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
    const ringR = Math.max(minDim * 0.10, mainFontSize * 0.85);
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

// Kurumsal SaaS & Broadcast Seviyesinde Standart Köşe Skorları:
// 4 köşede yüksek kontrastlı, TV'den okunacak büyüklükte, lider tacı 👑 ve
// yakınına oyuncu/top geldiğinde dinamik olarak saydamlaşan (Proximity Ghosting) brutalist rozetler.
export function renderCornerScores(ctx, { arena, entries, entities = [], isRoundOver = false }) {
  const { left, right, top, bottom, width, height } = arena;
  const scale = getUiScale(arena);

  // TV / Monitörde rahat okunur boyut (Genişlik: ~105-135px, Yükseklik: ~34-44px)
  const cardW = Math.round(Math.min(width * 0.22, 120 * scale));
  const cardH = Math.round(Math.min(height * 0.08, 38 * scale));
  const inset = Math.round(14 * scale);

  // 4 köşe kutu alanları [P1 sol-alt, P2 sol-üst, P3 sağ-üst, P4 sağ-alt]
  const spots = [
    { x: left + inset, y: bottom - cardH - inset, alignLeft: true },
    { x: left + inset, y: top + inset, alignLeft: true },
    { x: right - cardW - inset, y: top + inset, alignLeft: false },
    { x: right - cardW - inset, y: bottom - cardH - inset, alignLeft: false },
  ];

  // Lider skoru bul
  let highestScore = -1;
  entries.forEach((e) => {
    if (!e || typeof e.text !== 'string') return;
    const num = parseInt(e.text, 10);
    if (!isNaN(num) && num > highestScore) highestScore = num;
  });

  ctx.save();

  entries.forEach((entry, i) => {
    if (!entry) return;
    const spot = spots[i];
    if (!spot) return;
    const rect = { x: spot.x, y: spot.y, w: cardW, h: cardH };

    // Proximity Ghosting: Eğer herhangi bir oyuncu/top/mermi bu kutunun üstüne/yakınına gelirse
    // kutu saydamlaşır (alpha: 0.25), saha görüşü engellenmez. Boşken okunabilir koyu karttır (0.72);
    // açık kağıt zeminlerde beyaz metnin kaybolmaması için taban yüksek tutulur.
    const isNearby = checkProximity(rect, entities, Math.round(35 * scale));
    const cardAlpha = isRoundOver ? 1.0 : isNearby ? 0.25 : 0.72;

    ctx.globalAlpha = cardAlpha;

    if (isRoundOver) {
      const shadowOffset = Math.max(2, Math.round(3 * Math.min(1.4, scale)));
      // Sert Brutalist Gölge
      ctx.fillStyle = UI_COLORS.ink;
      ctx.fillRect(rect.x + shadowOffset, rect.y + shadowOffset, rect.w, rect.h);

      // Kart Gövdesi (Krem)
      ctx.fillStyle = UI_COLORS.card;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

      // Dış Kenarlık
      ctx.strokeStyle = UI_COLORS.ink;
      ctx.lineWidth = Math.max(2, Math.round(2.5 * Math.min(1.4, scale)));
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    } else {
      // Oyun esnasında: Koyu Füme Kapsül (açık zeminde beyaz metin okunur, aksiyon alttan seçilir)
      ctx.fillStyle = 'rgba(24, 24, 22, 0.62)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    }

    // Sol Oyuncu Renk Çubuğu (Kimin skoru olduğu 1 saniyede anlaşılır)
    const stripeW = Math.round(7 * scale);
    ctx.fillStyle = entry.color || UI_COLORS.players[i];
    ctx.fillRect(rect.x, rect.y, stripeW, rect.h);

    // İçerik: koltuk rozeti (P1..P4) + kısa oyuncu adı + skor sayısı + lider yıldızı
    const scoreVal = parseInt(entry.text, 10);
    const isLeader = highestScore > 0 && scoreVal === highestScore;
    const midY = rect.y + rect.h / 2;

    // Skor genişliğini önce ölç (etiket çakışmasın)
    const scoreFont = `900 ${Math.round(18 * scale)}px ${UI_FONTS.mono}`;
    ctx.font = scoreFont;
    const scoreW = ctx.measureText ? (ctx.measureText(entry.text)?.width || 40) : 40;
    const scoreRightX = rect.x + rect.w - Math.round(8 * scale);
    const scoreLeftX = scoreRightX - scoreW;

    // Lider yıldızı: skorun hemen solunda (etikete taşmaz)
    let starZone = 0;
    if (isLeader) {
      ctx.font = `900 ${Math.round(12 * scale)}px ${UI_FONTS.mono}`;
      const starW = ctx.measureText ? (ctx.measureText('★')?.width || 12) : 12;
      starZone = starW + Math.round(8 * scale);
      ctx.fillStyle = UI_COLORS.gold;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText('★', scoreLeftX - Math.round(4 * scale), midY);
    }

    // Koltuk rozeti + kısa isim (P1 AHMET); taşarsa yoğunlaşır, skora taşmaz
    const labelX = rect.x + stripeW + Math.round(6 * scale);
    const labelMaxW = Math.max(24, scoreLeftX - starZone - Math.round(4 * scale) - labelX);
    const shortName = (entry.name || '').toString().toUpperCase().slice(0, 7);
    const labelText = shortName ? `P${i + 1} ${shortName}` : `P${i + 1}`;
    ctx.font = `900 ${Math.round(11 * scale)}px ${UI_FONTS.mono}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    if (!isRoundOver) {
      // Açık zeminlerde okunurluk için koyu kontur
      ctx.strokeStyle = 'rgba(26, 26, 26, 0.9)';
      ctx.lineWidth = Math.max(1.5, Math.round(2 * scale));
      ctx.strokeText(labelText, labelX, midY, labelMaxW);
    }
    ctx.fillStyle = isRoundOver ? UI_COLORS.muted : 'rgba(255, 255, 255, 0.92)';
    ctx.fillText(labelText, labelX, midY, labelMaxW);

    // Skor (Büyük, Okunaklı Sayı + koyu kontur)
    ctx.font = scoreFont;
    ctx.textAlign = 'right';
    if (!isRoundOver) {
      ctx.strokeStyle = 'rgba(26, 26, 26, 0.9)';
      ctx.lineWidth = Math.max(2, Math.round(3 * scale));
      ctx.strokeText(entry.text, scoreRightX, midY);
    }
    ctx.fillStyle = isRoundOver ? (entry.color || UI_COLORS.ink) : '#FFFFFF';
    ctx.fillText(entry.text, scoreRightX, midY);
  });

  ctx.restore();
}

// Evrensel Skor Paneli (Universal Scoreboard):
// 'corners' (saha içi 4 köşe sabitlenmiş rozetler) veya 'top-bar' (üst yayın şeridi) düzenlerini destekler.
// Geliştirici dostudur; tek parametreyle istenen yerleşim anında değiştirilebilir.
export function renderUniversalScoreboard(ctx, {
  arena,
  players = [],
  scores = [0, 0, 0, 0],
  targetScore = 3,
  entities = [],
  layout = 'corners', // 'corners' | 'top-bar'
  timeRemaining = null,
  isRoundOver = false,
  state = null,
}) {
  const scale = getUiScale(arena);
  const roundOver = Boolean(isRoundOver || state === 'ROUND_OVER' || state === 'MATCH_OVER' || state === 'ROUND_PAUSE');

  // 1. KÖŞE DÜZENİ (Saha İçi Sabitlenmiş + Proximity Ghosting)
  if (layout === 'corners') {
    const entries = [0, 1, 2, 3].map((idx) => {
      const p = players[idx];
      const isJoined = p ? (p.isJoined ?? (p.slotType !== 'empty')) : false;
      if (!isJoined) return null;
      return {
        color: p.color || UI_COLORS.players[idx],
        text: `${scores[idx] || 0}★`,
        name: p.name || `P${idx + 1}`,
      };
    });
    renderCornerScores(ctx, { arena, entries, entities, isRoundOver: roundOver });
    return;
  }

  // 2. ÜST YAYIN ŞERİDİ (Broadcast Bar)
  // Oyun esnasında: İnce, alçak profilli, yarı saydam füme kapsül (duvar hissi vermez, zemin görünür).
  // Raunt sonunda: Geniş, opak, sert gölgeli kutlama kartı.
  const activePlayers = players.filter((p, i) => p && (p.isJoined ?? (p.slotType !== 'empty')));
  const count = Math.max(1, activePlayers.length);

  const barW = Math.min(arena.width * 0.94, Math.round((roundOver ? 560 : 440) * scale));
  const barH = Math.round((roundOver ? 40 : 25) * scale);
  const barX = arena.cx - barW / 2;

  // Akıllı Marj Yerleşimi: Arena üstünde dış boşluk varsa sahanın DIŞINA yerleştirilir (sahaya sıfır temas!)
  const topMargin = arena.top;
  let barY;
  if (topMargin >= barH + 4) {
    barY = arena.top - barH - 3;
  } else {
    barY = arena.top + Math.round((roundOver ? 4 : 1) * scale);
  }

  const isNearby = checkProximity({ x: barX, y: barY, w: barW, h: barH }, entities, 35);
  // Oyun sırasında okunabilir taban (0.72), aksiyon yaklaşınca 0.25'e iner — skor kaybolmaz.
  const barAlpha = roundOver ? 1.0 : isNearby ? 0.25 : 0.72;

  ctx.save();
  ctx.globalAlpha = barAlpha;

  if (roundOver) {
    const shadow = Math.max(2, Math.round(3 * scale));
    ctx.fillStyle = UI_COLORS.ink;
    ctx.fillRect(barX + shadow, barY + shadow, barW, barH);
    ctx.fillStyle = UI_COLORS.card;
    ctx.fillRect(barX, barY, barW, barH);
    ctx.strokeStyle = UI_COLORS.ink;
    ctx.lineWidth = Math.max(2, Math.round(2.5 * scale));
    ctx.strokeRect(barX, barY, barW, barH);
  } else {
    // Koyu füme cam kapsül (açık zeminde beyaz metin okunur)
    ctx.fillStyle = 'rgba(24, 24, 22, 0.62)';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(barX, barY, barW, barH);
  }

  // Oyuncuları yatay diz
  const colW = (barW - Math.round(16 * scale)) / count;
  const maxScore = Math.max(...scores.slice(0, 4));

  activePlayers.forEach((p, idx) => {
    const origIdx = p.index ?? idx;
    const score = scores[origIdx] || 0;
    const isLeader = maxScore > 0 && score === maxScore;
    const colX = barX + Math.round(8 * scale) + idx * colW;

    // Oyuncu rengi mini dikey çubuk
    const stripeW = Math.max(3, Math.round((roundOver ? 5 : 3.5) * scale));
    const stripeH = barH - Math.round((roundOver ? 14 : 8) * scale);
    ctx.fillStyle = p.color || UI_COLORS.players[origIdx];
    ctx.fillRect(colX, barY + (barH - stripeH) / 2, stripeW, stripeH);

    // P1 + İsim (açık zeminde okunurluk için koyu kontur)
    const pName = (p.name || `P${origIdx + 1}`).slice(0, 5);
    const nameX = colX + stripeW + Math.round(5 * scale);
    ctx.font = `900 ${Math.round((roundOver ? 12 : 10.5) * scale)}px ${UI_FONTS.mono}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    if (!roundOver) {
      ctx.strokeStyle = 'rgba(26, 26, 26, 0.9)';
      ctx.lineWidth = Math.max(1.5, Math.round(2 * scale));
      ctx.strokeText(`${pName}`, nameX, barY + barH / 2);
    }
    ctx.fillStyle = roundOver ? UI_COLORS.ink : '#FFFFFF';
    ctx.fillText(`${pName}`, nameX, barY + barH / 2);

    // Taç / Yıldız
    if (isLeader) {
      ctx.fillStyle = UI_COLORS.gold;
      ctx.font = `900 ${Math.round((roundOver ? 12 : 10) * scale)}px ${UI_FONTS.mono}`;
      ctx.fillText('★', colX + stripeW + Math.round((roundOver ? 46 : 38) * scale), barY + barH / 2);
    }

    // Skor (açık zeminde okunurluk için koyu kontur)
    const scoreX = colX + colW - Math.round(6 * scale);
    ctx.font = `900 ${Math.round((roundOver ? 16 : 12.5) * scale)}px ${UI_FONTS.mono}`;
    ctx.textAlign = 'right';
    if (!roundOver) {
      ctx.strokeStyle = 'rgba(26, 26, 26, 0.9)';
      ctx.lineWidth = Math.max(2, Math.round(2.5 * scale));
      ctx.strokeText(`${score}★`, scoreX, barY + barH / 2);
    }
    ctx.fillStyle = roundOver ? (p.color || UI_COLORS.ink) : '#FFFFFF';
    ctx.fillText(`${score}★`, scoreX, barY + barH / 2);
  });

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Uyarlanabilir Skor Paneli (Adaptive Scoreboard)
// ---------------------------------------------------------------------------
// Ekran ve kontrol moduna göre en ergonomik düzeni seçer. TEK skor yüzeyi
// vardır: sanal kontroller ekrandaysa üst şerit (parmak çakışmasını önler),
// yoksa dört köşe rozeti. Sahanın sol üstüne ayrı bir mikro sayım çipi
// (Top Rail Tally) ve onun "göz at" düğmesi KALDIRILDI: aynı skoru
// ikinci bir yüzeyde tekrarlıyor, dolu/boş koltuk ayrımı yoktu ve
// kullanıcı isteğiyle saha içinden çıktı.
export function renderAdaptiveScoreboard(ctx, {
  arena,
  players = [],
  scores = [0, 0, 0, 0],
  targetScore = 3,
  entities = [],
  forceLayout = null, // 'corners' | 'top-bar' | null (otomatik)
  controlMode = /** @type {string} */ (CONTROL_MODE.NONE),
  timeRemaining = null,
  isRoundOver = false,
  state = null,
}) {
  const roundOver = Boolean(isRoundOver || state === 'ROUND_OVER' || state === 'MATCH_OVER' || state === 'ROUND_PAUSE');

  let layout = forceLayout;
  if (!layout) {
    // DOM kumandası da sahayı kapatıyor: ikisi de üst şeride taşar.
    const controlsActive = controlMode === CONTROL_MODE.DOM
      || controlMode === CONTROL_MODE.CANVAS;
    // Sanal kontroller ekrandaysa parmak çakışmasını önlemek için daima top-bar
    layout = controlsActive ? 'top-bar' : 'corners';
  }

  renderUniversalScoreboard(ctx, {
    arena,
    players,
    scores,
    targetScore,
    entities,
    layout,
    timeRemaining,
    isRoundOver: roundOver,
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
    ctx.fillText(label, right - textW, baseY);
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
  uiButtons,
  headline,
  winnerName = '',
  winnerColor = UI_COLORS.resultGold,
  winnerEntity = null,
  rows = [],
  onRestart,
  onLobby = null,
  viewport = null,
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

  ctx.save();
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
      ctx.fillText(entry.value, valueX, cy);
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
