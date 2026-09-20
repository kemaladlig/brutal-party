// Brutal Party — Birleşik Karakter Çizim Motoru (Unified Brutal Avatar Renderer)
// Tüm mini-oyunlarda (BOMB, HEIST, CROWN, COLLAPSE, CLONE, NINJA, LASER, ZONE, vb.)
// ve Karakter Özelleştirme Arayüzünde standart avatar çizimini sağlar.
import { getSlotCustomization } from '../core/customizationManager.js';

/**
 * Tek tip Neo-Brutalist Avatar Çizer
 * @param {CanvasRenderingContext2D} ctx 
 * @param {number} x - Merkez X
 * @param {number} y - Merkez Y
 * @param {number} radius - Avatar yarıçapı
 * @param {Object} options - Özelleştirme ve durum bayrakları
 */
export function drawBrutalAvatar(ctx, x, y, radius, options = {}) {
  const slotIdx = typeof options.slotIndex === 'number' ? options.slotIndex : null;
  const slotData = slotIdx !== null ? getSlotCustomization(slotIdx) : null;

  const color = options.color || slotData?.color || '#D84727';
  const expressionRaw = options.expression || slotData?.expression || 'FOCUS';
  const accessoryRaw = options.accessory !== undefined ? options.accessory : (slotData?.accessory || 'NONE');
  const patternRaw = options.pattern || slotData?.pattern || 'SOLID';

  // İfade normalizasyonu (küçük harf / durum eşleştirmeleri)
  let expression = expressionRaw;
  if (expression === 'normal') expression = slotData?.expression || 'FOCUS';
  else if (expression === 'excited') expression = 'WINK';
  else if (expression === 'panic') expression = 'DERP';
  else if (expression === 'dizzy') expression = 'CYCLOPS';
  else if (expression === 'robot') expression = 'CYBORG';

  // LOD (Level of Detail) Kuralı:
  // r < 12 (Küçük kafa/vücut): Aksesuarlar kaldırılır veya sadeleştirilir
  // r < 16 (Orta ölçek): Desen ve aksesuarlar sadeleştirilir
  const isMicro = radius < 12;
  const pattern = isMicro ? 'SOLID' : patternRaw;
  const accessory = isMicro ? 'NONE' : accessoryRaw;

  const {
    facingAngle = 0,
    isTackling = false,
    isBlinking = false,
    alpha = 1.0,
    scale = 1.0,
    label = '',
    showPointer = false,
    pointerColor = '#FFFFFF',
    borderColor = '#1A1A1A',
    borderWidth = 3,
    shadowOffset = 3,
    blinkProgress = 0, // 0 = açık, 1 = tam kapalı
  } = options;

  if (radius <= 0) return;

  ctx.save();
  ctx.translate(x, y);
  if (scale !== 1.0) ctx.scale(scale, scale);
  if (alpha < 1.0) ctx.globalAlpha = Math.max(0, Math.min(1, ctx.globalAlpha * alpha));

  const r = radius;

  // 1. Zemin Sert Gölge
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.beginPath();
  ctx.arc(shadowOffset, shadowOffset + 1, r, 0, Math.PI * 2);
  ctx.fill();

  // 2. Ana Gövde & Desen (Clipping Mask ile desen sınır taşmasını engeller)
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();

  // Taban rengi
  ctx.fillStyle = color;
  ctx.fillRect(-r - 2, -r - 2, r * 2 + 4, r * 2 + 4);

  // Gövde Deseni
  if (pattern === 'STRIPE') {
    ctx.save();
    ctx.rotate(facingAngle);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(-r, -r * 0.28, r * 2, r * 0.56);
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(-r, -r * 0.08, r * 2, r * 0.16);
    ctx.restore();
  } else if (pattern === 'DUAL') {
    ctx.save();
    ctx.rotate(facingAngle + Math.PI / 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.fillRect(0, -r - 2, r + 2, r * 2 + 4);
    ctx.restore();
  } else if (pattern === 'TARGET') {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = Math.max(2, r * 0.18);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Ninja kukuleta gövde kaplaması
  if (accessory === 'NINJA_COWL') {
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(-r - 2, -r - 2, r * 2 + 4, r * 2 + 4);
    ctx.save();
    ctx.rotate(facingAngle);
    ctx.fillStyle = color;
    ctx.fillRect(-r * 0.2, -r * 0.9, r * 0.4, r * 1.8);
    // Yüz açığı
    ctx.fillStyle = '#FAF7F2';
    ctx.beginPath();
    ctx.ellipse(r * 0.35, 0, r * 0.45, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore(); // Clipping sonu

  // 3. Gövde Dış Çerçevesi (Neo-brutalist kalın kontur)
  ctx.strokeStyle = isTackling ? '#FFDE59' : borderColor;
  ctx.lineWidth = isTackling ? borderWidth * 1.5 : borderWidth;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();

  // 4. İsteğe Bağlı Yön Oku (Directional Pointer)
  if (showPointer) {
    ctx.save();
    ctx.rotate(facingAngle);
    ctx.fillStyle = pointerColor;
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(r + 14, 0);
    ctx.lineTo(r + 3, -6);
    ctx.lineTo(r + 6, 0);
    ctx.lineTo(r + 3, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // 5. Yüz İfadesi & Gözler (Baktığı yöne göre dinamik döner)
  ctx.save();
  ctx.rotate(facingAngle);

  const eyeOffsetX = r * 0.36;
  const eyeSpreadY = r * 0.32;
  const eyeR = Math.max(3, r * 0.24);
  const isEyeClosed = isBlinking || blinkProgress > 0.5;

  if (expression === 'CYCLOPS') {
    // Büyük tek tepegöz
    const cx = r * 0.32;
    const cEyeR = r * 0.42;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(cx, 0, cEyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (!isEyeClosed) {
      ctx.fillStyle = '#1A1A1A';
      ctx.beginPath();
      ctx.arc(cx + 3, 0, cEyeR * 0.46, 0, Math.PI * 2);
      ctx.fill();
      // Parıltı
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(cx + 4.5, -2, cEyeR * 0.16, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx - cEyeR * 0.8, 0);
      ctx.lineTo(cx + cEyeR * 0.8, 0);
      ctx.stroke();
    }
  } else if (expression === 'SHADES') {
    // Neo-brutalist Güneş Gözlüğü
    const gx = r * 0.15;
    const gw = r * 0.95;
    const gh = r * 0.52;
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(gx, -gh / 2, gw * 0.75, gh);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(gx, -gh / 2, gw * 0.75, gh);

    // Beyaz yansıma çizgisi
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(gx + 4, -gh / 4);
    ctx.lineTo(gx + gw * 0.45, gh / 4);
    ctx.stroke();
  } else if (expression === 'CYBORG') {
    // Sayborg Vizörü
    const vx = r * 0.2;
    const vw = r * 0.85;
    const vh = r * 0.36;
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(vx, -vh / 2, vw * 0.75, vh);
    ctx.strokeStyle = '#00F0FF';
    ctx.lineWidth = 2;
    ctx.strokeRect(vx, -vh / 2, vw * 0.75, vh);

    // Lazer diyotu
    ctx.fillStyle = '#FF0055';
    ctx.beginPath();
    ctx.arc(vx + vw * 0.45, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (expression === 'ANGRY') {
    // Çatık kaşlı gözler
    const drawEye = (ey) => {
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(eyeOffsetX, ey, eyeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      if (!isEyeClosed) {
        ctx.fillStyle = '#1A1A1A';
        ctx.beginPath();
        ctx.arc(eyeOffsetX + 2, ey, eyeR * 0.52, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    drawEye(-eyeSpreadY);
    drawEye(eyeSpreadY);

    // Çatık kaşlar
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(eyeOffsetX - eyeR, -eyeSpreadY - 3);
    ctx.lineTo(eyeOffsetX + eyeR + 2, -eyeSpreadY + 2);
    ctx.moveTo(eyeOffsetX - eyeR, eyeSpreadY + 3);
    ctx.lineTo(eyeOffsetX + eyeR + 2, eyeSpreadY - 2);
    ctx.stroke();
  } else if (expression === 'WINK') {
    // Bir göz açık, bir göz kırpan
    // Üst göz açık
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(eyeOffsetX, -eyeSpreadY, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    if (!isEyeClosed) {
      ctx.fillStyle = '#1A1A1A';
      ctx.beginPath();
      ctx.arc(eyeOffsetX + 2, -eyeSpreadY, eyeR * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Alt göz kırpma çizgisi
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(eyeOffsetX, eyeSpreadY, eyeR * 0.9, -0.6, 0.6);
    ctx.stroke();
  } else if (expression === 'DERP') {
    // Şaşkın / Çılgın gözler (biri büyük biri küçük)
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(eyeOffsetX, -eyeSpreadY, eyeR * 1.15, 0, Math.PI * 2);
    ctx.arc(eyeOffsetX + 2, eyeSpreadY, eyeR * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    if (!isEyeClosed) {
      ctx.fillStyle = '#1A1A1A';
      ctx.beginPath();
      ctx.arc(eyeOffsetX + 3, -eyeSpreadY - 2, eyeR * 0.45, 0, Math.PI * 2);
      ctx.arc(eyeOffsetX + 1, eyeSpreadY + 2, eyeR * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // FOCUS / Standart çift göz
    const drawEye = (ey) => {
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(eyeOffsetX, ey, eyeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      if (!isEyeClosed) {
        ctx.fillStyle = '#1A1A1A';
        ctx.beginPath();
        ctx.arc(eyeOffsetX + 2.5, ey, eyeR * 0.48, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(eyeOffsetX + 3.5, ey - 1.5, eyeR * 0.16, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = '#1A1A1A';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(eyeOffsetX - eyeR + 1, ey);
        ctx.lineTo(eyeOffsetX + eyeR - 1, ey);
        ctx.stroke();
      }
    };
    drawEye(-eyeSpreadY);
    drawEye(eyeSpreadY);
  }

  // Haydut göz maskesi
  if (accessory === 'BANDIT_MASK') {
    ctx.fillStyle = '#1A1A1A';
    ctx.beginPath();
    ctx.ellipse(eyeOffsetX, 0, eyeR * 1.5, eyeSpreadY * 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FAF7F2';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Maske içi göz delikleri
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(eyeOffsetX, -eyeSpreadY, eyeR * 0.8, 0, Math.PI * 2);
    ctx.arc(eyeOffsetX, eyeSpreadY, eyeR * 0.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#1A1A1A';
    ctx.beginPath();
    ctx.arc(eyeOffsetX + 2, -eyeSpreadY, eyeR * 0.45, 0, Math.PI * 2);
    ctx.arc(eyeOffsetX + 2, eyeSpreadY, eyeR * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore(); // Yüz dönme sonu

  // 6. Başlık & Aksesuarlar (Dönme açısına göre ayarlanır)
  ctx.save();
  ctx.rotate(facingAngle);

  if (accessory === 'HEADBAND') {
    // Alın bandanası & Arka kuyruk
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(-r * 0.1, -r * 0.95, r * 0.35, r * 1.9);
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 1.8;
    ctx.strokeRect(-r * 0.1, -r * 0.95, r * 0.35, r * 1.9);

    // Arka kurdele kuyrukları
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(-r - 8, -4, 9, 3.5);
    ctx.fillRect(-r - 6, 2, 7, 3.5);
    ctx.strokeRect(-r - 8, -4, 9, 3.5);
    ctx.strokeRect(-r - 6, 2, 7, 3.5);
  } else if (accessory === 'CAP') {
    // Geriye takılmış spor şapkası
    ctx.fillStyle = '#1A1A1A';
    ctx.beginPath();
    ctx.arc(-r * 0.3, 0, r * 0.75, Math.PI * 0.5, Math.PI * 1.5);
    ctx.closePath();
    ctx.fill();

    // Şapka siperliği (arkaya doğru)
    ctx.fillStyle = '#FAF7F2';
    ctx.fillRect(-r - 8, -r * 0.25, 10, r * 0.5);
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 2;
    ctx.strokeRect(-r - 8, -r * 0.25, 10, r * 0.5);
  } else if (accessory === 'HEADPHONES') {
    // DJ Kulaklığı (üst kemer ve yan hoparlör pedleri)
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = Math.max(3, r * 0.2);
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.05, -Math.PI * 0.45, Math.PI * 0.45);
    ctx.stroke();

    // Yan kulaklık pedleri
    const padW = r * 0.35;
    const padH = r * 0.55;
    ctx.fillStyle = '#FFDE59';
    ctx.fillRect(-padW / 2, -r - padH * 0.4, padW, padH);
    ctx.fillRect(-padW / 2, r - padH * 0.6, padW, padH);
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 2;
    ctx.strokeRect(-padW / 2, -r - padH * 0.4, padW, padH);
    ctx.strokeRect(-padW / 2, r - padH * 0.6, padW, padH);
  } else if (accessory === 'HORNS') {
    // Viking / Şeytan Boynuzları
    const drawHorn = (sy) => {
      ctx.fillStyle = '#FFDE59';
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-r * 0.2, sy * r * 0.85);
      ctx.quadraticCurveTo(-r * 0.7, sy * (r + 14), -r * 0.1, sy * (r + 12));
      ctx.quadraticCurveTo(-r * 0.3, sy * (r + 4), 0, sy * r * 0.75);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };
    drawHorn(-1);
    drawHorn(1);
  } else if (accessory === 'MINI_CROWN') {
    // Mini Altın Taç (Tepede)
    ctx.save();
    ctx.translate(-r * 0.2, 0);
    ctx.fillStyle = '#FFD700';
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-6, -r * 0.7);
    ctx.lineTo(-12, -r * 1.3);
    ctx.lineTo(-4, -r * 0.95);
    ctx.lineTo(0, -r * 1.4);
    ctx.lineTo(4, -r * 0.95);
    ctx.lineTo(12, -r * 1.3);
    ctx.lineTo(6, -r * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore(); // Başlık dönme sonu

  // 7. Oyuncu Rozeti (Yazı yerine temiz, saf minimal rozet veya sadece açıkça istenmişse)
  if (label && typeof options.renderTextLabel === 'boolean' && options.renderTextLabel) {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `900 ${Math.max(10, Math.round(r * 0.6))}px "Space Grotesk", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 2.5;
    ctx.strokeText(label, 0, 0);
    ctx.fillText(label, 0, 0);
  }

  ctx.restore();
}
