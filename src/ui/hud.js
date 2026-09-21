// Oyun-içi HUD helper'ları — tüm motorlarda aynı üst hap, köşe skoru,
// raund bandı ve final kutusu. Davranış (sayaç, skor, state) motora aittir;
// burası sadece çizer. Ölçü/stil kararları src/ui/tokens.js'tedir.

import { UI_COLORS, UI_SIZES, UI_FONTS, uiFont, getUiScale } from './tokens.js';

// Standart üst hap: arena üstünde ortalı.
// Ekran boyutuna (TV / monitör vs telefon) göre orantılı büyür, metin uzunluğuna göre genişler.
// text: '💣 4.2s' gibi durum metni, urgent: kırmızı zemin.
// alpha: oyun alanı çakışmasında hapı soldurmak için.
export function renderTopPill(ctx, { arena, text, urgent = false, alpha = 1, customW = null }) {
  const scale = getUiScale(arena);
  const fontSize = Math.round(15 * scale);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `900 ${fontSize}px ${UI_FONTS.mono}`;
  const measured = ctx.measureText(text).width;

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
// ancak yarı-saydam (alpha) ve saha zemininde çizildiği için oyuncuları ve oyunu asla engellemez.
export function renderArenaWatermarkTimer(ctx, {
  arena,
  text,
  subText = '',
  urgent = false,
  color = null,
  alpha = 0.16,
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
    effAlpha = Math.min(0.32, alpha + 0.10 + pulse * 0.08);
  }
  ctx.globalAlpha = effAlpha;

  // İlerleme halkası (opsiyonel)
  if (typeof ringProgress === 'number' && ringProgress >= 0) {
    const ringR = Math.max(minDim * 0.14, mainFontSize * 0.85);
    ctx.strokeStyle = color || (urgent ? UI_COLORS.danger : UI_COLORS.ink);
    ctx.lineWidth = Math.max(4, Math.round(6 * scale));
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, -Math.PI / 2, -Math.PI / 2 + Math.min(1.0, ringProgress) * Math.PI * 2);
    ctx.stroke();
  }

  // Ana metin (sayaç sayısı veya durum)
  ctx.fillStyle = color || (urgent ? UI_COLORS.danger : UI_COLORS.ink);
  ctx.font = `900 ${mainFontSize}px ${UI_FONTS.mono}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const textY = subText ? cy - subFontSize * 0.7 : cy;
  ctx.fillText(text, cx, textY);

  // Alt bilgi etiketi
  if (subText) {
    ctx.font = `800 ${subFontSize}px ${UI_FONTS.mono}`;
    ctx.letterSpacing = `${Math.round(1.5 * scale)}px`;
    ctx.fillText(subText, cx, textY + mainFontSize * 0.56 + subFontSize * 0.5);
  }

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
  const textMetrics = ctx.measureText(fullText);
  const padX = Math.round(10 * s);
  const padY = Math.round(5 * s);
  const boxW = Math.round(textMetrics.width + padX * 2);
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
export function renderCornerScores(ctx, { arena, entries, entities = [] }) {
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
    const rect = { x: spot.x, y: spot.y, w: cardW, h: cardH };

    // Proximity Ghosting: Eğer herhangi bir oyuncu/top/mermi bu kutunun üstüne/yakınına gelirse
    // kutu transparanlaşır (alpha: 0.22), saha görüşü asla engellenmez. Boşken jilet gibi opaktır (0.95).
    const isNearby = checkProximity(rect, entities, Math.round(35 * scale));
    const cardAlpha = isNearby ? 0.22 : 0.94;
    const shadowOffset = Math.max(2, Math.round(3 * Math.min(1.4, scale)));

    ctx.globalAlpha = cardAlpha;

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

    // Sol Oyuncu Renk Çubuğu (Kimin skoru olduğu 1 saniyede anlaşılır)
    const stripeW = Math.round(7 * scale);
    ctx.fillStyle = entry.color || UI_COLORS.players[i];
    ctx.fillRect(rect.x, rect.y, stripeW, rect.h);

    // İçerik: P1..P4 etiketi + Oyuncu Adı + Skor Sayısı + Lider Tacı
    const scoreVal = parseInt(entry.text, 10);
    const isLeader = highestScore > 0 && scoreVal === highestScore;

    // Koltuk rozeti (P1..P4)
    ctx.fillStyle = UI_COLORS.muted;
    ctx.font = `900 ${Math.round(11 * scale)}px ${UI_FONTS.mono}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`P${i + 1}`, rect.x + stripeW + Math.round(6 * scale), rect.y + rect.h / 2);

    // Eğer liderse taç rozeti
    if (isLeader) {
      ctx.fillStyle = UI_COLORS.gold;
      ctx.font = `${Math.round(13 * scale)}px sans-serif`;
      ctx.fillText('👑', rect.x + stripeW + Math.round(25 * scale), rect.y + rect.h / 2 - 1);
    }

    // Skor (Büyük, Okunaklı Sayı)
    ctx.fillStyle = entry.color || UI_COLORS.ink;
    ctx.font = `900 ${Math.round(18 * scale)}px ${UI_FONTS.mono}`;
    ctx.textAlign = 'right';
    ctx.fillText(entry.text, rect.x + rect.w - Math.round(8 * scale), rect.y + rect.h / 2);
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
}) {
  const scale = getUiScale(arena);

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
    renderCornerScores(ctx, { arena, entries, entities });
    return;
  }

  // 2. ÜST YAYIN ŞERİDİ (Broadcast Bar)
  const barW = Math.min(arena.width * 0.94, Math.round(560 * scale));
  const barH = Math.round(42 * scale);
  const barX = arena.cx - barW / 2;
  const barY = arena.top + Math.round(8 * scale);
  const shadow = Math.max(2, Math.round(3 * scale));

  const isNearby = checkProximity({ x: barX, y: barY, w: barW, h: barH }, entities, 30);
  const barAlpha = isNearby ? 0.25 : 0.96;

  ctx.save();
  ctx.globalAlpha = barAlpha;

  // Sert gölge + Gövde
  ctx.fillStyle = UI_COLORS.ink;
  ctx.fillRect(barX + shadow, barY + shadow, barW, barH);
  ctx.fillStyle = UI_COLORS.card;
  ctx.fillRect(barX, barY, barW, barH);
  ctx.strokeStyle = UI_COLORS.ink;
  ctx.lineWidth = Math.max(2, Math.round(2.5 * scale));
  ctx.strokeRect(barX, barY, barW, barH);

  // Oyuncuları yatay diz
  const activePlayers = players.filter((p, i) => p && (p.isJoined ?? (p.slotType !== 'empty')));
  const count = Math.max(1, activePlayers.length);
  const colW = (barW - Math.round(20 * scale)) / count;

  // Lider skoru bul
  const maxScore = Math.max(...scores.slice(0, 4));

  activePlayers.forEach((p, idx) => {
    const origIdx = p.index ?? idx;
    const score = scores[origIdx] || 0;
    const isLeader = maxScore > 0 && score === maxScore;
    const colX = barX + Math.round(10 * scale) + idx * colW;

    // Oyuncu rengi mini dikey çubuk
    ctx.fillStyle = p.color || UI_COLORS.players[origIdx];
    ctx.fillRect(colX, barY + Math.round(8 * scale), Math.round(4 * scale), barH - Math.round(16 * scale));

    // P1 + İsim
    ctx.fillStyle = UI_COLORS.ink;
    ctx.font = `900 ${Math.round(12 * scale)}px ${UI_FONTS.mono}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const pName = (p.name || `P${origIdx + 1}`).slice(0, 6);
    ctx.fillText(`${pName}`, colX + Math.round(8 * scale), barY + barH / 2);

    // Taç
    if (isLeader) {
      ctx.font = `${Math.round(11 * scale)}px sans-serif`;
      ctx.fillText('👑', colX + Math.round(52 * scale), barY + barH / 2 - 1);
    }

    // Skor
    ctx.fillStyle = p.color || UI_COLORS.ink;
    ctx.font = `900 ${Math.round(16 * scale)}px ${UI_FONTS.mono}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${score}★`, colX + colW - Math.round(8 * scale), barY + barH / 2);
  });

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

  ctx.fillStyle = winnerName ? winnerColor : UI_COLORS.ink;
  ctx.font = uiFont('title', Math.min(1.3, scale));
  ctx.fillText(winnerName ? `${winnerName} KAZANDI!` : 'BERABERE!', arena.cx, boxY + Math.round(68 * scale), boxW - 24);

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
  ctx.fillText('YENİDEN OYNA', arena.cx, btnY + btnH / 2);
  ctx.restore();

  uiButtons.push({ x: btnX, y: btnY, w: btnW, h: btnH, onClick: onRestart });
}
