// Brutal Party — Birleşik Karakter Çizim Motoru (Unified Brutal Avatar Renderer)
// Tüm mini-oyunlarda (BOMB, HEIST, CROWN, COLLAPSE, CLONE, NINJA, LASER, ZONE, vb.)
// ve Karakter Özelleştirme Arayüzünde standart avatar çizimini sağlar.
import { getSlotAvatar, getAvatarProfile } from '../core/customizationManager.js';

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
  // Koltuk avatarı: host kayıt defteri (relay) → cihaz profili (LOCAL/fallback).
  // Renk kimlik değildir; display rengi (options.color) her zaman kazanır.
  const avatarOpt = options.avatar
    || (slotIdx !== null ? getSlotAvatar(slotIdx) : null)
    || null;
  const profileFallback = (() => { try { return getAvatarProfile(); } catch { return null; } })();

  const isBot = options.isBot || options.slotType === 'bot_normal' || options.slotType === 'bot_god';
  const color = options.color || avatarOpt?.color || profileFallback?.color || '#D84727';
  const expressionRaw = options.expression || avatarOpt?.expression || profileFallback?.expression || 'FOCUS';
  const accessoryRaw = options.accessory !== undefined ? options.accessory : (avatarOpt?.accessory || profileFallback?.accessory || 'NONE');
  const patternRaw = options.pattern || avatarOpt?.pattern || profileFallback?.pattern || 'SOLID';

  // İfade normalizasyonu (küçük harf / durum eşleştirmeleri)
  let expression = expressionRaw;
  if (expression === 'normal') expression = avatarOpt?.expression || profileFallback?.expression || 'FOCUS';
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

  // 1b. Arka katman aksesuarları (gövdenin arkasında çizilir)
  if (accessory === 'WINGS') {
    ctx.save();
    ctx.rotate(facingAngle);
    const drawWing = (sy) => {
      ctx.fillStyle = '#FAF7F2';
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-r * 0.2, sy * r * 0.35);
      ctx.quadraticCurveTo(-r * 1.5, sy * (r + 16), -r * 1.8, sy * r * 0.2);
      ctx.quadraticCurveTo(-r * 1.1, sy * r * 0.55, -r * 0.3, sy * r * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Tüy detayı
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, sy * r * 0.3);
      ctx.quadraticCurveTo(-r * 1.2, sy * r * 0.5, -r * 1.45, sy * r * 0.15);
      ctx.stroke();
    };
    drawWing(-1);
    drawWing(1);
    ctx.restore();
  }

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
  } else if (pattern === 'CHECKER') {
    // Satranç daması: iki sıra kare, gövde merkezine hizalı
    const cell = Math.max(4, r * 0.42);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    for (let cyi = -2; cyi <= 2; cyi++) {
      for (let cxi = -2; cxi <= 2; cxi++) {
        if ((cxi + cyi) % 2 === 0) {
          ctx.fillRect(cxi * cell - cell / 2, cyi * cell - cell / 2, cell, cell);
        }
      }
    }
    ctx.fillStyle = 'rgba(26, 26, 26, 0.35)';
    for (let cyi = -2; cyi <= 2; cyi++) {
      for (let cxi = -2; cxi <= 2; cxi++) {
        if ((cxi + cyi) % 2 !== 0) {
          ctx.fillRect(cxi * cell - cell / 2, cyi * cell - cell / 2, cell, cell);
        }
      }
    }
  } else if (pattern === 'DOTS') {
    const dr = Math.max(1.8, r * 0.14);
    const gap = dr * 3.2;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.strokeStyle = 'rgba(26, 26, 26, 0.4)';
    ctx.lineWidth = 1;
    for (let row = -3; row <= 3; row++) {
      for (let col = -3; col <= 3; col++) {
        const px = col * gap + (row % 2 ? gap / 2 : 0);
        const py = row * gap * 0.9;
        ctx.beginPath();
        ctx.arc(px, py, dr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  } else if (pattern === 'BOLT') {
    // Enerjik yıldırım: gövde boyunca sarı şimşek
    ctx.save();
    ctx.rotate(facingAngle);
    ctx.fillStyle = '#FFDE59';
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(r * 0.15, -r * 0.95);
    ctx.lineTo(-r * 0.45, r * 0.05);
    ctx.lineTo(-r * 0.05, r * 0.05);
    ctx.lineTo(-r * 0.3, r * 0.95);
    ctx.lineTo(r * 0.5, -r * 0.15);
    ctx.lineTo(r * 0.05, -r * 0.15);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  } else if (pattern === 'RIBBON') {
    // Çapraz festen şerit (iki bant, kesişim ortası)
    ctx.save();
    ctx.rotate(facingAngle + Math.PI / 4);
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 1.4;
    ctx.fillRect(-r * 1.4, -r * 0.2, r * 2.8, r * 0.4);
    ctx.strokeRect(-r * 1.4, -r * 0.2, r * 2.8, r * 0.4);
    ctx.restore();
    ctx.save();
    ctx.rotate(facingAngle - Math.PI / 4);
    ctx.fillStyle = 'rgba(26, 26, 26, 0.55)';
    ctx.fillRect(-r * 1.4, -r * 0.14, r * 2.8, r * 0.28);
    ctx.restore();
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
  } else if (expression === 'HEART') {
    // Kalp şeklinde gözler (aşık)
    const drawHeart = (ey) => {
      const hr = eyeR * 1.25;
      ctx.fillStyle = '#FF3B6B';
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(eyeOffsetX, ey + hr * 0.85);
      ctx.bezierCurveTo(eyeOffsetX - hr * 1.3, ey, eyeOffsetX - hr * 0.55, ey - hr * 0.95, eyeOffsetX, ey - hr * 0.25);
      ctx.bezierCurveTo(eyeOffsetX + hr * 0.55, ey - hr * 0.95, eyeOffsetX + hr * 1.3, ey, eyeOffsetX, ey + hr * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (!isEyeClosed) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.beginPath();
        ctx.arc(eyeOffsetX - hr * 0.35, ey - hr * 0.3, hr * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    if (!isEyeClosed) {
      drawHeart(-eyeSpreadY);
      drawHeart(eyeSpreadY);
    } else {
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(eyeOffsetX - eyeR, -eyeSpreadY);
      ctx.lineTo(eyeOffsetX + eyeR, -eyeSpreadY);
      ctx.moveTo(eyeOffsetX - eyeR, eyeSpreadY);
      ctx.lineTo(eyeOffsetX + eyeR, eyeSpreadY);
      ctx.stroke();
    }
  } else if (expression === 'STAR') {
    // Yıldız gözler (heyecan)
    const drawStar = (ey, sr) => {
      ctx.fillStyle = '#FFDE59';
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const a1 = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
        const a2 = a1 + Math.PI / 5;
        ctx.lineTo(eyeOffsetX + Math.cos(a1) * sr, ey + Math.sin(a1) * sr);
        ctx.lineTo(eyeOffsetX + Math.cos(a2) * sr * 0.45, ey + Math.sin(a2) * sr * 0.45);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };
    if (!isEyeClosed) {
      drawStar(-eyeSpreadY, eyeR * 1.3);
      drawStar(eyeSpreadY, eyeR * 1.3);
    } else {
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(eyeOffsetX - eyeR, -eyeSpreadY);
      ctx.lineTo(eyeOffsetX + eyeR, -eyeSpreadY);
      ctx.moveTo(eyeOffsetX - eyeR, eyeSpreadY);
      ctx.lineTo(eyeOffsetX + eyeR, eyeSpreadY);
      ctx.stroke();
    }
  } else if (expression === 'SLEEPY') {
    // Yarım kapalı uykulu gözler + Z damlası
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(eyeOffsetX, -eyeSpreadY, eyeR, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(eyeOffsetX, eyeSpreadY, eyeR, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    if (!isEyeClosed) {
      ctx.fillStyle = '#1A1A1A';
      ctx.beginPath();
      ctx.arc(eyeOffsetX + eyeR * 0.1, -eyeSpreadY + eyeR * 0.4, eyeR * 0.28, 0, Math.PI * 2);
      ctx.arc(eyeOffsetX + eyeR * 0.1, eyeSpreadY + eyeR * 0.4, eyeR * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
    // Uyku "Z" (yazı değil: çizgi yolu)
    ctx.save();
    ctx.strokeStyle = 'rgba(26, 26, 26, 0.75)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    const zx = eyeOffsetX + r * 0.72;
    const zy = -eyeSpreadY - r * 0.55;
    const zw = Math.max(5, r * 0.26);
    ctx.beginPath();
    ctx.moveTo(zx - zw / 2, zy - zw / 2);
    ctx.lineTo(zx + zw / 2, zy - zw / 2);
    ctx.lineTo(zx - zw / 2, zy + zw / 2);
    ctx.lineTo(zx + zw / 2, zy + zw / 2);
    ctx.stroke();
    ctx.restore();
  } else if (expression === 'ZOMBIE') {
    // Donuk zombi gözler (solmuş iris + çentikli kaş)
    const drawZombieEye = (ey) => {
      ctx.fillStyle = '#DDF5DD';
      ctx.beginPath();
      ctx.arc(eyeOffsetX, ey, eyeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 1.8;
      ctx.stroke();
      if (!isEyeClosed) {
        ctx.fillStyle = '#2F6A4F';
        ctx.beginPath();
        ctx.arc(eyeOffsetX + 1, ey, eyeR * 0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1A1A1A';
        ctx.beginPath();
        ctx.arc(eyeOffsetX + 1.5, ey + 0.5, eyeR * 0.18, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = '#1A1A1A';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(eyeOffsetX - eyeR + 1, ey);
        ctx.lineTo(eyeOffsetX + eyeR - 1, ey);
        ctx.stroke();
      }
    };
    drawZombieEye(-eyeSpreadY);
    drawZombieEye(eyeSpreadY);
    // Yatay dikiş izleri
    ctx.strokeStyle = 'rgba(26, 26, 26, 0.65)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(eyeOffsetX - eyeR * 1.4, -eyeSpreadY - eyeR * 1.6);
    ctx.lineTo(eyeOffsetX + eyeR * 0.6, -eyeSpreadY - eyeR * 1.6);
    ctx.stroke();
  } else if (expression === 'GRIN') {
    // Geniş sırıtış: standart gözler + dişli ağız
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
      }
    };
    drawEye(-eyeSpreadY);
    drawEye(eyeSpreadY);
    // Sırıtış — gözler x≤0.60r'de biter; ağız 0.58r'de başlar (gözlerin hemen
    // önünde), ±y'e açılır, +x'e 0.68r'ye kadar şişer; dişler üst dudakta.
    const mx = r * 0.58;
    const mw = r * 0.2;
    const mh = r * 0.17;
    ctx.fillStyle = '#1A1A1A';
    ctx.beginPath();
    ctx.moveTo(mx, -mh);
    ctx.quadraticCurveTo(mx + mw, 0, mx, mh);
    ctx.quadraticCurveTo(mx + mw * 0.5, 0, mx, -mh);
    ctx.closePath();
    ctx.fill();
    // Dişler (ağız yolu kırpmasıyla taşma yok)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(mx, -mh);
    ctx.quadraticCurveTo(mx + mw, 0, mx, mh);
    ctx.quadraticCurveTo(mx + mw * 0.5, 0, mx, -mh);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(mx - r * 0.02, -mh - 1, mw + r * 0.04, r * 0.12);
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(mx + mw * 0.35, -mh - 1);
    ctx.lineTo(mx + mw * 0.35, -mh + r * 0.12);
    ctx.moveTo(mx + mw * 0.65, -mh - 1);
    ctx.lineTo(mx + mw * 0.65, -mh + r * 0.12);
    ctx.stroke();
    ctx.restore();
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
    // Altın taç: başın üstüne oturur (bant -0.86r..-0.64r, gözler -0.56r'de
    // biter — çakışma yok), uçlar yalnız 0.16r taşar; genişlik baş siluetine uygun.
    ctx.save();
    ctx.translate(-r * 0.05, 0);
    const cw = r * 0.78;
    const bandTop = -r * 0.86;
    const bandH = r * 0.22;
    const midTop = -r * 1.16;
    const sideTop = -r * 1.0;
    ctx.fillStyle = '#FFD700';
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-cw, bandTop);
    ctx.lineTo(-cw * 0.78, sideTop);
    ctx.lineTo(-cw * 0.38, bandTop + r * 0.05);
    ctx.lineTo(0, midTop);
    ctx.lineTo(cw * 0.38, bandTop + r * 0.05);
    ctx.lineTo(cw * 0.78, sideTop);
    ctx.lineTo(cw, bandTop);
    ctx.lineTo(cw, bandTop + bandH);
    ctx.lineTo(-cw, bandTop + bandH);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Işık parlaması (orta dişten bandaya)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-cw * 0.7, bandTop + 2.5);
    ctx.lineTo(0, midTop + 3);
    ctx.lineTo(cw * 0.7, bandTop + 2.5);
    ctx.stroke();
    // Alt bant vurgusu
    ctx.strokeStyle = 'rgba(26, 26, 26, 0.45)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-cw + 2, bandTop + bandH - 2);
    ctx.lineTo(cw - 2, bandTop + bandH - 2);
    ctx.stroke();
    // Taşlar
    const jewel = (jx, col) => {
      ctx.fillStyle = col;
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(jx, bandTop + bandH * 0.5, Math.max(1.8, bandH * 0.34), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Parıltı
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.beginPath();
      ctx.arc(jx - 0.8, bandTop + bandH * 0.5 - 1, Math.max(0.7, bandH * 0.1), 0, Math.PI * 2);
      ctx.fill();
    };
    jewel(0, '#FF0055');
    jewel(-cw * 0.52, '#0984E3');
    jewel(cw * 0.52, '#0984E3');
    ctx.restore();
  } else if (accessory === 'BONE') {
    // Korsan kafa kemiği: başın tepesine oturur (-0.95r), gözleri geçmez
    ctx.save();
    ctx.translate(-r * 0.15, -r * 0.95);
    ctx.rotate(-0.35);
    ctx.fillStyle = '#FAF7F2';
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 1.6;
    const bw = r * 1.1;
    const bh = r * 0.28;
    ctx.beginPath();
    ctx.rect(-bw / 2, -bh / 2, bw, bh);
    ctx.fill();
    ctx.stroke();
    // Kemik uçları (ikişer top)
    const boneEnd = (sx) => {
      ctx.beginPath();
      ctx.arc(sx * bw / 2, -bh * 0.45, bh * 0.55, 0, Math.PI * 2);
      ctx.arc(sx * bw / 2, bh * 0.45, bh * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };
    boneEnd(-1);
    boneEnd(1);
    ctx.restore();
  } else if (accessory === 'TOP_HAT') {
    // Silindir şapka: siper gözlerin (üst göz tepe -0.56r) üstünde kalır,
    // külâh -1.50r'ye kadar (önizlemelere sığar)
    ctx.save();
    ctx.translate(-r * 0.1, 0);
    // Siper
    ctx.fillStyle = '#1A1A1A';
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.78, r * 0.92, r * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FAF7F2';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Külâh
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(-r * 0.5, -r * 1.5, r, r * 0.8);
    ctx.strokeStyle = '#FAF7F2';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-r * 0.5, -r * 1.5, r, r * 0.8);
    // Kırmızı şerit (külâh tabanı, siperin hemen üstünde)
    ctx.fillStyle = '#D84727';
    ctx.fillRect(-r * 0.5, -r * 0.98, r, r * 0.16);
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(-r * 0.5, -r * 0.98, r, r * 0.16);
    ctx.restore();
  } else if (accessory === 'ANTENNA') {
    // Uzaylı anten: taban başa gömülür, top ~-1.40r'de biter
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = Math.max(2, r * 0.12);
    ctx.beginPath();
    ctx.moveTo(-r * 0.08, -r * 0.6);
    ctx.quadraticCurveTo(r * 0.3, -r * 1.1, r * 0.52, -r * 1.16);
    ctx.stroke();
    ctx.fillStyle = '#00F0FF';
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(r * 0.56, -r * 1.22, Math.max(3.5, r * 0.18), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Parıltı
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(r * 0.61, -r * 1.27, Math.max(1.2, r * 0.06), 0, Math.PI * 2);
    ctx.fill();
  } else if (accessory === 'HALO') {
    // Altın hale: baş kenarının (-1.0r) hemen üstünde yüzer (~-1.54r tepe)
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = Math.max(3, r * 0.16);
    ctx.beginPath();
    ctx.ellipse(-r * 0.05, -r * 1.26, r * 0.65, r * 0.2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(-r * 0.05, -r * 1.26, r * 0.65, r * 0.2, 0, 0, Math.PI * 2);
    ctx.stroke();
    // İç parlaklık
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(-r * 0.05, -r * 1.26, r * 0.5, r * 0.12, 0, Math.PI * 1.05, Math.PI * 1.75);
    ctx.stroke();
  } else if (accessory === 'BEANIE') {
    // Bere: başın üstünde yatay kubbe (göz üstü -0.60r'de biter) + kıvrım
    // bandı aşağı iner, dikey şerit yok; ponpon tepede.
    ctx.fillStyle = '#1D5D8A';
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(-r * 0.1, -r * 0.76, r * 0.72, Math.PI, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Fileto kıvrımı (kubbenin alt kenarı, gözlerin üstünde)
    ctx.fillStyle = '#FAF7F2';
    ctx.fillRect(-r * 0.88, -r * 0.76, r * 1.56, r * 0.16);
    ctx.strokeRect(-r * 0.88, -r * 0.76, r * 1.56, r * 0.16);
    // Ponpon (kubbe tepesi -1.48r → merkez -1.40r, tepe ~-1.55r)
    ctx.fillStyle = '#FAF7F2';
    ctx.beginPath();
    ctx.arc(-r * 0.1, -r * 1.4, Math.max(3, r * 0.15), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore(); // Başlık dönme sonu

  // 7. Yazısız koltuk kimliği: koltuk numarası kadar pip noktası (P1=●, P4=●●●●).
  // Saha içi yazı YASAKTIR — kimlik renk + pip + koltuk/köşe pozisyonudur.
  // `label` parametresi artık çizilmez (ölü parametre, motorlardan temizlenecek).
  if (slotIdx !== null && !isBot && options.showPips !== false) {
    const n = Math.max(1, Math.min(4, slotIdx + 1));
    const pr = Math.max(1.6, r * 0.10);
    const gap = pr * 2.7;
    const totalW = (n - 1) * gap;
    const py = r + pr + 3;
    for (let k = 0; k < n; k++) {
      const px = -totalW / 2 + k * gap;
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fillStyle = '#1A1A1A';
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.stroke();
    }
  }

  ctx.restore();
}
