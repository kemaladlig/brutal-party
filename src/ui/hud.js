import {
  UI_COLORS,
  UI_SIZES,
  UI_FONTS,
  uiFont,
  getUiScale,
  getDisplayProfile,
  shouldShowVirtualControls,
} from './tokens.js';
import { t } from '../i18n.js';

// Standart üst hap: arena üstünde ortalı.
// Ekran boyutuna (TV / monitör vs telefon) göre orantılı büyür, metin uzunluğuna göre genişler.
// text: '💣 4.2s' gibi durum metni, urgent: kırmızı zemin.
// alpha: oyun alanı çakışmasında hapı soldurmak için (varsayılan 0.78 yarı saydam).
export function renderTopPill(ctx, { arena, text, urgent = false, alpha = 0.78, customW = null }) {
  const scale = getUiScale(arena);
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

  // Sert Neo-brutalist gölge
  ctx.fillStyle = UI_COLORS.ink;
  ctx.fillRect(pillX + shadow, pillY + shadow, pillW, pillH);

  // Gövde
  ctx.fillStyle = urgent ? UI_COLORS.danger : UI_COLORS.line;
  ctx.fillRect(pillX, pillY, pillW, pillH);

  // Kenar
  ctx.strokeStyle = UI_COLORS.ink;
  ctx.lineWidth = Math.max(2.5, Math.round(2.5 * Math.min(1.5, scale)));
  ctx.strokeRect(pillX, pillY, pillW, pillH);

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

  // Büyük ekranda (TV/monitör) 72px - 140px, telefonda 38px - 54px
  const mainFontSize = Math.max(38, Math.min(Math.round(120 * (scale / 1.55)), Math.floor(minDim * 0.18)));
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
    const ringR = Math.max(minDim * 0.14, mainFontSize * 0.85);
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
  if (!text) return;
  const s = Math.max(0.85, Math.min(1.5, scale));
  const fullText = icon ? `${icon} ${text}` : text;

  ctx.save();
  ctx.font = `900 ${Math.round(12 * s)}px ${UI_FONTS.mono}`;
  const textW = (ctx.measureText ? ctx.measureText(fullText)?.width : 0) || 60;
  const padX = Math.round(10 * s);
  const padY = Math.round(5 * s);
  const boxW = Math.round(textW + padX * 2);
  const boxH = Math.round(22 * s);
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
  ctx.fillText(fullText, x, y + 0.5);

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

// Skor tablosuna geçici göz atma (Peek) durumu
let peekScoreboardUntil = 0;
let lastPeekButtonRect = null;

export function triggerScoreboardPeek(durationMs = 2800) {
  peekScoreboardUntil = performance.now() + durationMs;
}

export function isScoreboardPeeking() {
  return performance.now() < peekScoreboardUntil;
}

// Dokunma/tıklama koordinatının Peek butonuna isabet edip etmediğini kontrol eder
export function checkScoreboardPeekTap(touch) {
  if (!lastPeekButtonRect || !touch) return false;
  const pad = 10;
  if (
    touch.x >= lastPeekButtonRect.x - pad &&
    touch.x <= lastPeekButtonRect.x + lastPeekButtonRect.w + pad &&
    touch.y >= lastPeekButtonRect.y - pad &&
    touch.y <= lastPeekButtonRect.y + lastPeekButtonRect.h + pad
  ) {
    triggerScoreboardPeek(2800);
    return true;
  }
  return false;
}

// Mobilde oyun esnasında sahayı 1 piksel bile işgal etmeyen Sınır Duvarı Mikro-İmleri (Top Rail Micro-Tally)
export function renderArenaRailTally(ctx, { arena, players = [], scores = [0, 0, 0, 0], uiButtons = null }) {
  const activePlayers = players.filter((p, i) => p && (p.isJoined ?? (p.slotType !== 'empty')));
  const count = activePlayers.length;
  if (count === 0) return;

  const scale = getUiScale(arena);
  const maxScore = Math.max(...scores.slice(0, 4));

  const itemW = Math.round(42 * scale);
  const gap = Math.round(5 * scale);
  const totalW = count * itemW + (count - 1) * gap;
  const startX = arena.cx - totalW / 2;
  const barH = Math.round(17 * scale);
  const barY = arena.top - barH / 2; // Tam üst duvar sınır çizgisinin ortasına oturur (oyun alanını işgal etmez)

  ctx.save();
  ctx.globalAlpha = 0.88;

  activePlayers.forEach((p, idx) => {
    const origIdx = p.index ?? idx;
    const score = scores[origIdx] || 0;
    const isLeader = maxScore > 0 && score === maxScore;
    const x = startX + idx * (itemW + gap);
    const y = barY;

    // Mini koyu zemin kapsülü
    ctx.fillStyle = 'rgba(20, 20, 18, 0.85)';
    ctx.fillRect(x, y, itemW, barH);
    ctx.strokeStyle = p.color || UI_COLORS.players[origIdx];
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x, y, itemW, barH);

    // Renk noktası
    ctx.fillStyle = p.color || UI_COLORS.players[origIdx];
    ctx.beginPath();
    ctx.arc(x + 5.5 * scale, y + barH / 2, 2.5 * scale, 0, Math.PI * 2);
    ctx.fill();

    // Skor sayısı (küçük ekranda okunur boy)
    ctx.fillStyle = isLeader ? UI_COLORS.gold : '#FFFFFF';
    ctx.font = `900 ${Math.round(10.5 * scale)}px ${UI_FONTS.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${score}${isLeader ? '★' : ''}`, x + itemW / 2 + 3 * scale, y + barH / 2 + 0.5);
  });

  // Sağ üst dış boşlukta dokunulabilir Peek (Göz At) Çipi
  const peekW = Math.round(40 * scale);
  const peekH = Math.round(24 * scale);
  const peekX = Math.min(arena.right - peekW, (arena.cx + totalW / 2) + 12);
  const peekY = Math.max(4, arena.top - peekH - 3);

  lastPeekButtonRect = { x: peekX, y: peekY, w: peekW, h: peekH };

  ctx.fillStyle = 'rgba(24, 24, 22, 0.65)';
  ctx.fillRect(peekX, peekY, peekW, peekH);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(peekX, peekY, peekW, peekH);

  ctx.font = `${Math.round(11 * scale)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🏆', peekX + peekW / 2, peekY + peekH / 2);

  if (uiButtons && Array.isArray(uiButtons)) {
    uiButtons.push({
      x: peekX,
      y: peekY,
      w: peekW,
      h: peekH,
      onClick: () => triggerScoreboardPeek(2800),
    });
  }

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
// Ekran ve kontrol moduna göre en ergonomik düzeni dinamik seçer.
// - Mobilde oyun esnasında saha zeminini %100 temiz tutar, sadece üst duvara gömülü mikro-çentik çizer.
// - Raunt/maç sonunda veya peek butonuna dokunulduğunda tam boy kutlama kartı açılır.
// - TV veya PC modunda: Yayın şeridini sahanın üst dış marjına veya sınırına çizer.
export function renderAdaptiveScoreboard(ctx, {
  arena,
  players = [],
  scores = [0, 0, 0, 0],
  targetScore = 3,
  entities = [],
  forceLayout = null, // 'corners' | 'top-bar' | null (otomatik)
  isHosting = false,
  timeRemaining = null,
  isRoundOver = false,
  state = null,
  uiButtons = null,
}) {
  const profile = getDisplayProfile(arena);
  const roundOver = Boolean(isRoundOver || state === 'ROUND_OVER' || state === 'MATCH_OVER' || state === 'ROUND_PAUSE');
  const peeking = isScoreboardPeeking();

  // Mobilde oyun esnasında (ve peek aktif değilse):
  // Sahada oynanabilir alanı %100 temiz ve ferah bırak; sadece üst duvar sınır mikro-çentiğini ve peek çipini çiz.
  if (profile.type === 'MOBILE' && !roundOver && !peeking) {
    renderArenaRailTally(ctx, { arena, players, scores, uiButtons });
    return;
  }

  let layout = forceLayout;
  if (!layout) {
    const controlsActive = shouldShowVirtualControls({ isHosting });
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
export function renderFireCooldown(ctx, {
  x,
  y,
  radius = 16,
  progress = null,
  feedback = null,
  color = UI_COLORS.gold,
}) {
  const normalized = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 1;
  const ttl = feedback && Number.isFinite(feedback.ttl)
    ? Math.max(0, Math.min(1, feedback.ttl))
    : 0;
  const hasProgress = Number.isFinite(progress) && normalized < 0.999;
  if (!hasProgress && ttl <= 0) return;

  const ringR = radius + 10;
  ctx.save();
  if (hasProgress) {
    ctx.strokeStyle = UI_COLORS.cooldownTrack;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, ringR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = color || UI_COLORS.gold;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(x, y, ringR, -Math.PI / 2, -Math.PI / 2 + normalized * Math.PI * 2);
    ctx.stroke();
  }

  if (ttl > 0 && feedback?.kind === 'blocked') {
    ctx.globalAlpha = 0.35 + ttl * 0.65;
    ctx.strokeStyle = UI_COLORS.danger;
    ctx.lineWidth = 4 + ttl * 2;
    ctx.beginPath();
    ctx.arc(x, y, ringR + 2, 0, Math.PI * 2);
    ctx.stroke();
  } else if (ttl > 0 && feedback?.kind === 'ready') {
    ctx.globalAlpha = 0.45 + ttl * 0.55;
    ctx.strokeStyle = UI_COLORS.gold;
    ctx.lineWidth = 3 + ttl * 3;
    ctx.beginPath();
    ctx.arc(x, y, ringR + 2, 0, Math.PI * 2);
    ctx.stroke();
  } else if (ttl > 0 && feedback?.kind === 'shot') {
    ctx.globalAlpha = ttl * 0.8;
    ctx.strokeStyle = color || UI_COLORS.white;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, ringR + 1, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
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
}) {
  const s = Math.max(0.75, Math.min(1.4, scale));
  const now = performance.now();

  ctx.save();

  // 1. Kalkan Balonu & Dönen Uydu
  if (shield) {
    const shieldR = radius + Math.round(9 * s);
    ctx.save();
    ctx.strokeStyle = UI_COLORS.shield || '#0EA5E9';
    ctx.lineWidth = Math.max(2, Math.round(2.5 * s));
    ctx.fillStyle = UI_COLORS.shieldBg || 'rgba(14, 165, 233, 0.18)';
    ctx.beginPath();
    ctx.arc(x, y, shieldR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const sAng = (now / 1000) * 3.2;
    ctx.fillStyle = '#38BDF8';
    ctx.beginPath();
    ctx.arc(x + Math.cos(sAng) * shieldR, y + Math.sin(sAng) * shieldR, 3.5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 2. Yetenek / Dash / Cooldown Çemberi (Varlık etrafında yüksek kontrastlı ark)
  if (cooldownProgress !== null && cooldownProgress !== undefined) {
    const ringR = radius + Math.round(4.5 * s);
    const prog = Math.max(0, Math.min(1.0, cooldownProgress));

    ctx.save();
    if (prog >= 1.0 || prog <= 0.001) {
      // Tam hazır: Çift stroke (koyu taban + parlak beyaz üst) — açık kağıt zeminde de görünür
      ctx.strokeStyle = 'rgba(26, 26, 26, 0.9)';
      ctx.lineWidth = Math.max(4, Math.round(4.5 * s));
      ctx.beginPath();
      ctx.arc(x, y, ringR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.lineWidth = Math.max(2, Math.round(2.5 * s));
      ctx.beginPath();
      ctx.arc(x, y, ringR, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // Doluyor: Koyu zemin rayı + renkli dolum yayı
      ctx.strokeStyle = UI_COLORS.cooldownTrack || 'rgba(26, 26, 26, 0.28)';
      ctx.lineWidth = Math.max(2.5, Math.round(3 * s));
      ctx.beginPath();
      ctx.arc(x, y, ringR, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = color || UI_COLORS.white;
      ctx.lineWidth = Math.max(2.5, Math.round(3 * s));
      ctx.beginPath();
      ctx.arc(x, y, ringR, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 3. Sersemleme / Daze Yıldızları
  if (stun) {
    ctx.save();
    const starTime = now / 320;
    for (let k = 0; k < 3; k++) {
      const ang = starTime + (k * Math.PI * 2) / 3;
      const sx = x + Math.cos(ang) * (radius + 7 * s);
      const sy = (y - radius * 0.3) + Math.sin(ang) * (4 * s);
      ctx.fillStyle = UI_COLORS.gold || '#D99B26';
      ctx.font = `900 ${Math.round(11 * s)}px ${UI_FONTS.mono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('★', sx, sy);
    }
    ctx.restore();
  }

  // 4. Başüstü Göstergeleri: Cephane (Ammo) ve Can (HP)
  const hasHp = typeof hp === 'number' && typeof maxHp === 'number' && maxHp > 0;
  const hasAmmo = typeof ammo === 'number' && typeof maxAmmo === 'number' && maxAmmo > 0;

  if (hasHp || hasAmmo) {
    // Tavan / Kenar çakışma koruması (Edge Clamping / Flipping)
    const totalOverheadH = (hasHp ? 12 * s : 0) + (hasAmmo ? 15 * s : 0);
    let flipBelow = false;
    if (arena && (y - radius - totalOverheadH < (arena.top || 0) + 10 * s)) {
      flipBelow = true;
    }

    let currentAnchorY = flipBelow
      ? y + radius + Math.round(10 * s)
      : y - radius - Math.round(8 * s);

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
        ctx.fillStyle = h < hp ? color : (UI_COLORS.disabled || '#E5E0D6');
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
      ctx.fillStyle = UI_COLORS.ammoFrame || '#141416';
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.strokeStyle = UI_COLORS.ink;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(boxX, boxY, boxW, boxH);

      for (let a = 0; a < maxAmmo; a++) {
        const bx = boxX + padX + a * (bulletW + bulletGap);
        const by = boxY + padY;
        const isReady = a < ammo;
        const isReloading = a === ammo && ammo < maxAmmo && reloadProgress > 0;

        // Fişek yuvası arka planı
        ctx.fillStyle = UI_COLORS.ammoEmpty || '#26262B';
        ctx.fillRect(bx, by, bulletW, bulletH);

        if (isReady) {
          // Dolu fişek: Oyuncu rengi + beyaz uç parıltısı
          ctx.fillStyle = color;
          ctx.fillRect(bx, by, bulletW, bulletH);
          ctx.fillStyle = UI_COLORS.white;
          ctx.fillRect(bx + bulletW - Math.round(3 * s), by + 1, Math.round(2.5 * s), bulletH - 2);
        } else if (isReloading) {
          // Doluyor: Altın sarısı dolum ilerlemesi
          ctx.fillStyle = UI_COLORS.ammoReloading || '#FACC15';
          ctx.fillRect(bx, by, Math.round(bulletW * Math.min(1.0, reloadProgress)), bulletH);
        }

        ctx.strokeStyle = UI_COLORS.ink;
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, bulletW, bulletH);
      }
      ctx.restore();
    }
  }

  // 5. İsteğe Bağlı Etiket (P1, P2 vb.)
  if (label) {
    ctx.save();
    ctx.font = `900 ${Math.round(10 * s)}px ${UI_FONTS.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = UI_COLORS.outlineContrast || 'rgba(250, 247, 242, 0.92)';
    ctx.lineWidth = 3;
    ctx.strokeText(label, x, y + radius + Math.round(8 * s));
    ctx.fillStyle = color;
    ctx.fillText(label, x, y + radius + Math.round(8 * s));
    ctx.restore();
  }

  ctx.restore();
}

// Standart raund bandı: başlık + alt bilgi.
// TV ve büyük monitörlerde orantılı genişler.
export function renderRoundBanner(ctx, { arena, title, titleColor, sub = '' }) {
  const scale = getUiScale(arena);
  const boxW = Math.min(Math.round(440 * scale), arena.width * 0.88);
  const boxH = Math.round(80 * Math.min(1.4, scale));
  const boxX = arena.cx - boxW / 2;
  const boxY = arena.cy - boxH / 2;
  const shadow = Math.max(3, Math.round(5 * Math.min(1.4, scale)));

  ctx.save();
  ctx.fillStyle = UI_COLORS.ink;
  ctx.fillRect(boxX + shadow, boxY + shadow, boxW, boxH);
  ctx.fillStyle = UI_COLORS.card;
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.strokeStyle = UI_COLORS.ink;
  ctx.lineWidth = Math.max(3, Math.round(3.5 * Math.min(1.3, scale)));
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = titleColor;
  ctx.font = uiFont('button', Math.min(1.35, scale));
  ctx.fillText(title, arena.cx, sub ? boxY + boxH * 0.38 : boxY + boxH / 2, boxW - 24);

  if (sub) {
    ctx.fillStyle = UI_COLORS.muted;
    ctx.font = uiFont('monoBody', Math.min(1.3, scale));
    ctx.fillText(sub, arena.cx, boxY + boxH * 0.72, boxW - 24);
  }
  ctx.restore();
}

export function cleanWinnerName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.replace(/^P[1-4]\s*[•·\-–—]\s*/i, '').trim();
}

// Standart final kutusu: başlık + kazanan + skor listesi + çalışan 'YENİDEN OYNA' butonu.
export function renderMatchOver(ctx, {
  arena, uiButtons, headline, winnerName = '', winnerColor = UI_COLORS.ink, rows = [], onRestart,
}) {
  const scale = getUiScale(arena);
  const boxW = Math.min(Math.round(460 * scale), Math.min(arena.width, arena.height) * 0.90);
  const boxH = Math.round(230 * Math.min(1.35, scale));
  const boxX = arena.cx - boxW / 2;
  const boxY = arena.cy - boxH / 2;
  const shadow = Math.max(4, Math.round(6 * Math.min(1.4, scale)));

  ctx.save();
  ctx.fillStyle = UI_COLORS.ink;
  ctx.fillRect(boxX + shadow, boxY + shadow, boxW, boxH);
  ctx.fillStyle = UI_COLORS.card;
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.strokeStyle = UI_COLORS.ink;
  ctx.lineWidth = Math.max(3.5, Math.round(4 * Math.min(1.3, scale)));
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = UI_COLORS.ink;
  ctx.font = uiFont('body', Math.min(1.3, scale));
  ctx.fillText(headline, arena.cx, boxY + Math.round(30 * scale));

  const cleanWinner = cleanWinnerName(winnerName);
  ctx.fillStyle = cleanWinner ? winnerColor : UI_COLORS.ink;
  ctx.font = uiFont('title', Math.min(1.3, scale));
  ctx.fillText(cleanWinner ? `${cleanWinner} KAZANDI!` : 'BERABERE!', arena.cx, boxY + Math.round(68 * scale), boxW - 24);

  ctx.font = uiFont('monoBody', Math.min(1.2, scale));
  const rowStep = Math.round(18 * Math.min(1.3, scale));
  rows.forEach((row, i) => {
    ctx.fillStyle = row.color;
    ctx.fillText(row.text, arena.cx, boxY + Math.round(96 * scale) + i * rowStep, boxW - 24);
  });

  const btnW = Math.round(UI_SIZES.finalBtnW * Math.min(1.35, scale));
  const btnH = Math.round(UI_SIZES.finalBtnH * Math.min(1.3, scale));
  const btnX = arena.cx - btnW / 2;
  const btnY = boxY + boxH - btnH - Math.round(18 * scale);

  ctx.fillStyle = UI_COLORS.ink;
  ctx.fillRect(btnX, btnY, btnW, btnH);
  ctx.fillStyle = UI_COLORS.white;
  ctx.font = uiFont('buttonSmall', Math.min(1.3, scale));
  ctx.fillText(t('canvas.playAgain'), arena.cx, btnY + btnH / 2);
  ctx.restore();

  uiButtons.push({ x: btnX, y: btnY, w: btnW, h: btnH, onClick: onRestart });
}
