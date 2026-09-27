// Brutal Party — Birleşik Karakter Çizim Motoru (Unified Brutal Avatar Renderer)
// Tüm mini-oyunlarda (BOMB, HEIST, CROWN, COLLAPSE, CLONE, NINJA, LASER, ZONE, vb.)
// ve Karakter Özelleştirme Arayüzünde standart avatar çizimini sağlar.
import { getSlotAvatar, getAvatarProfile, getBotPersona, rimHex } from '../core/customizationManager.js';

/**
 * KARAKTER = DÜZ RENK + YÜZ. Erişuar ve gövde deseni YOK.
 *
 * Siluet her yerde tam yuvarlak: ölçülen çizilen bbox gövdeyle sınırlı
 * (36x37 @ r=16), yarıçap ve çarpışma aynı değeri paylaşıyor. Küresellik
 * diskin İÇİNDE verilir (hacim gradyanları + iç alt gölge) — dışarı taşan
 * geometri yoktur. Karakterin üç özelliği rengi (10 palet + renk körü
 * paleti), yüz ifadesi (12 ifade) ve halka rengi (4 halka); botlar da aynı
 * sözleşme için yalnız isim/renk/yüz taşır (halkaları sabit klasiktir).
 *
 * `faceMode: 'play'` — OYUN İÇİ yüz kipi: gözler büyür (0.24r → 0.30r) ve
 * disk içinde hacim (ışık/gölge) eklenir. Menü/lobi/kumanda önizlemesi
 * varsayılan `full` kipte kalır: aynı yüz, hacim yok. Oyun içi yol
 * (`drawGameAvatar`, src/core/avatarInGame.js) her zaman `play` ister.
 *
 * Canlılık (göz kırpma, bakış kayması) view/oyun tarafında hesaplanıp
 * `blinkProgress` / `lookAngle` ile buraya beslenir; bu modül sadece çizer.
 */
const PLAY_FACE = 'play';

/**
 * Disk içi hacim gradient'leri — ctx'e bağlı oldukları için
 * `ctx -> yarıçap -> gradient` şeklinde saklanır. Karede yeni gradient
 * ÜRETİLMEZ, sadece hazır olan `fillRect` basılır (frame başına allocation
 * yok, iki `fillRect` maliyeti ihmal edilebilir).
 */
const PLAY_FACE_SHADING = new WeakMap();

function playFaceShading(ctx, r) {
  let byRadius = PLAY_FACE_SHADING.get(ctx);
  if (!byRadius) {
    byRadius = new Map();
    PLAY_FACE_SHADING.set(ctx, byRadius);
  }
  // Yarıçapı 0.25px'e yuvarla: yuvarlanmamış `r` her karede yeni kayıt
  // üretirdi ve cache sonsuz büyürdü.
  const key = Math.round(r * 4) / 4;
  const cached = byRadius.get(key);
  if (cached) return cached;

  // 1. Sağ-alt yumuşak küre gölgesi (gövdeye kütle ve derinlik katar)
  const shade = ctx.createRadialGradient(r * 0.30, r * 0.35, r * 0.1, 0, 0, r * 1.05);
  shade.addColorStop(0, 'rgba(12, 6, 26, 0.32)');
  shade.addColorStop(0.6, 'rgba(12, 6, 26, 0.12)');
  shade.addColorStop(1, 'rgba(12, 6, 26, 0)');

  // 2. Sol-üst çok hafif ortam aydınlığı (beyaz leke yapmaz, sadece renk tonunu yumuşatır)
  const diffuse = ctx.createRadialGradient(-r * 0.28, -r * 0.32, 0, 0, 0, r * 1.05);
  diffuse.addColorStop(0, 'rgba(255, 255, 255, 0.14)');
  diffuse.addColorStop(0.5, 'rgba(255, 255, 255, 0.04)');
  diffuse.addColorStop(1, 'rgba(255, 255, 255, 0)');

  const entry = { diffuse, shade };
  byRadius.set(key, entry);
  return entry;
}

/**
 * Disk içi alt gölge (ambient occlusion) gradyanı — topu yere oturtan
 * katman. Dışarı taşan geometriyle (yan duvar bandı) "kâsede top" gibi
 * okunuyordu; bu katman clip'in İÇİNDE kalır, siluet değişmez. `playFaceShading`
 * ile aynı cache deseni: karede yeni gradient üretilmez.
 */
const BODY_AO_CACHE = new WeakMap();

function bodyAoGradient(ctx, r) {
  let byRadius = BODY_AO_CACHE.get(ctx);
  if (!byRadius) {
    byRadius = new Map();
    BODY_AO_CACHE.set(ctx, byRadius);
  }
  const key = Math.round(r * 4) / 4;
  const cached = byRadius.get(key);
  if (cached) return cached;
  const g = ctx.createLinearGradient(0, r * 0.2, 0, r);
  g.addColorStop(0, 'rgba(12, 6, 26, 0)');
  g.addColorStop(1, 'rgba(12, 6, 26, 0.30)');
  byRadius.set(key, g);
  return g;
}

/**
 * Tek tip Neo-Brutalist Avatar Çizer
 * @param {CanvasRenderingContext2D} ctx 
 * @param {number} x - Merkez X
 * @param {number} y - Merkez Y
 * @param {number} radius - Avatar yarıçapı
 * @param {Object} options - Özelleştirme ve durum bayrakları
 */export function drawBrutalAvatar(ctx, x, y, radius, options = {}) {  const slotIdx = typeof options.slotIndex === 'number' ? options.slotIndex : null;
  const isBot = options.isBot || options.slotType === 'bot_normal' || options.slotType === 'bot_god';
  const isGod = options.isGodBot || options.slotType === 'bot_god';

  const botPersona = (isBot && slotIdx !== null) ? getBotPersona(slotIdx, isGod) : null;
  const registeredAvatar = slotIdx !== null ? getSlotAvatar(slotIdx) : null;
  const profileFallback = (() => { try { return getAvatarProfile(); } catch { return null; } })();

  // Koltuk avatarı: bot persona → host kayıt defteri (relay) → cihaz profili (LOCAL/fallback).
  // Renk kimlik değildir; display rengi (options.color) her zaman kazanır.
  const avatarOpt = options.avatar
    || (isBot ? botPersona : null)
    || registeredAvatar
    || profileFallback
    || null;

  const color = options.color || (isBot ? botPersona?.color : null) || avatarOpt?.color || profileFallback?.color || '#D84727';
  const expressionRaw = options.expression || (isBot ? botPersona?.expression : null) || avatarOpt?.expression || profileFallback?.expression || 'FOCUS';

  // İfade normalizasyonu (küçük harf / durum eşleştirmeleri)
  let expression = expressionRaw;
  if (expression === 'normal') expression = (isBot ? botPersona?.expression : null) || avatarOpt?.expression || profileFallback?.expression || 'FOCUS';
  else if (expression === 'excited') expression = 'WINK';
  else if (expression === 'panic') expression = 'DERP';
  else if (expression === 'dizzy') expression = 'CYCLOPS';
  else if (expression === 'robot') expression = 'CYBORG';

  // LOD (Level of Detail) Kuralı:
  // r < 5 (Aşırı küçük): Detaylar sadeleştirilir (göz çizimi hariç her şey düz)
  // r >= 5 (Collapse, Snake, Tanks vb.): Gözler orantılı çizilir
  const isMicro = radius < 5;
  // Oyun içi kip gözleri büyütür ve hacim ekler; menü kipi (`full`) yalnız
  // göz çizer. İkisi de dekor taşımaz — dekor artık yok.
  const isPlayFace = options.faceMode === PLAY_FACE;

  const {
    facingAngle = 0,
    isTackling = false,
    isBlinking = false,
    alpha = 1.0,
    scale = 1.0,
    label = '',
    showPointer = false,
    pointerColor = '#FFFFFF',
    borderColor = null,
    borderWidth = 3,
    shadowOffset = 3,
    blinkProgress = 0, // 0 = açık, 1 = tam kapalı
    lookAngle = null, // gözlerin baktığı yön (mutlak radyan); null = yön okunur
  } = options;

  if (radius <= 0) return;

  // Halka: çağıran açık renk vermediyse (oyun-durumu sinyali) avatarın halka
  // seçimidir. Bot personaları sabit klasiktir — kimlikleri değişmez.
  const ringHex = isBot
    ? '#1A1A1A'
    : rimHex(options.rim || avatarOpt?.rim || profileFallback?.rim);
  const ringColor = borderColor || ringHex;

  ctx.save();
  ctx.translate(x, y);
  if (scale !== 1.0) ctx.scale(scale, scale);
  if (alpha < 1.0) ctx.globalAlpha = Math.max(0, Math.min(1, ctx.globalAlpha * alpha));

  const r = radius;

  // 1. Zemin temas gölgesi — yere oturan basık elips. Daire gölge gövdeyi
  // "yüzen sticker" gibi gösteriyordu; elips temas hissi verir.
  ctx.save();
  ctx.translate(shadowOffset, r + Math.max(2, r * 0.12));
  ctx.scale(1, 0.32);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 1b. Gövde (clip: hacim katmanı daire sınırını geçemesin)
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();

  // Taban rengi
  ctx.fillStyle = color;
  ctx.fillRect(-r - 2, -r - 2, r * 2 + 4, r * 2 + 4);

  // Hacim: 2.5D küresel katmanlar (gölge + aydınlanma + speküler parıltı + rim)
  // Oyun içi kip (`play`) ve menü sahnesi (`volume`) bunu ister;
  // ikisi de clip'in İÇİNDE bittiği için siluet değişmez — düz sticker yerine 3D top gibi okur.
  if ((isPlayFace || options.volume) && !isMicro) {
    const { diffuse, shade } = playFaceShading(ctx, r);
    ctx.fillStyle = shade;
    ctx.fillRect(-r - 2, -r - 2, r * 2 + 4, r * 2 + 4);
    ctx.fillStyle = diffuse;
    ctx.fillRect(-r - 2, -r - 2, r * 2 + 4, r * 2 + 4);
  }

  // Alt gölge (ambient occlusion): diskin alt üçte biri içten kararır,
  // top yere oturur. Her kipte aynıdır — menü/saha farkı yalnız `play`/`volume`
  // hacmidir, bu katman ortaktır.
  if (!isMicro) {
    ctx.fillStyle = bodyAoGradient(ctx, r);
    ctx.fillRect(-r - 2, -r - 2, r * 2 + 4, r * 2 + 4);
  }

  ctx.restore(); // Clipping sonu

  // 2. Gövde Dış Çerçevesi (Neo-brutalist kalın kontur)
  ctx.strokeStyle = isTackling ? '#FFDE59' : ringColor;
  ctx.lineWidth = isTackling ? borderWidth * 1.5 : borderWidth;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();

  // 2a. Halka dış tanımı: açık halka (beyaz) açık zeminde — önizleme platosu,
  // krem saha — kayboluyordu. Koyu halkada görünmez, maliyeti tek arc yayımı,
  // mikroda piksel çamuru olmasın diye kapalı.
  if (!isMicro) {
    const hair = Math.max(1, r * 0.02);
    ctx.strokeStyle = 'rgba(26, 26, 26, 0.55)';
    ctx.lineWidth = hair;
    ctx.beginPath();
    ctx.arc(0, 0, r + borderWidth / 2 + hair / 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 3. İsteğe Bağlı Yön Oku (Directional Pointer)
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
  //
  // `lookAngle` verildiğinde göz grubu gövde yönünden ayrı olarak kayar: gövde
  // `facingAngle`'de kalırken gözler baktıkları yöne döner (HEIST'te tackle
  // yönü koşu yönünden farklıdır, ARCHER'da nişan yönü yürüme yönü değildir).
  // Kayma 0.22 rad ile sınırlı — tam yön dönmesi "gövde yanlış bakıyor" gibi
  // okunuyordu ve 0.22 üstü yön okuma çizgisiyle çelişiyordu. `lookAngle`
  // yoksa gözler gövdeyle birlikte döner (eski davranış).
  let glance = 0;
  if (isPlayFace && Number.isFinite(lookAngle)) {
    const delta = ((lookAngle - facingAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    glance = Math.max(-0.22, Math.min(0.22, delta * 0.45));
  }

  ctx.save();
  ctx.rotate(facingAngle + glance);

  // Oyun içi gözler menü avatarından büyük: saha 4-8px yarıçapta okunduğu
  // için 0.24r gözler kaybolup düz renkli bir daire dönüyordu. 0.30r'de
  // göz kenarı 0.34²+0.30² → 0.75r içinde kalır, daire sınırı aşılmaz.
  const eyeOffsetX = r * (isPlayFace ? 0.34 : 0.36);
  const eyeSpreadY = r * (isPlayFace ? 0.30 : 0.32);
  const eyeR = Math.max(3, r * (isPlayFace ? 0.30 : 0.24));
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
    // Neo-brutalist güneş gözlüğü: iki gözün üstünde İKİ yuvarlak cam + köprü
    // + şakak kolu. (Eski tek bar bakış ekseni boyunca uzanıp gövdeyi kesiyordu.)
    const lensR = eyeR * 1.3;
    const drawLens = (ey) => {
      ctx.fillStyle = '#1A1A1A';
      ctx.beginPath();
      ctx.arc(eyeOffsetX, ey, lensR, 0, Math.PI * 2);
      ctx.fill();
      // Açık gövdede kaybolmasın diye ince beyaz çerçeve (mikroda çamur olur).
      if (!isMicro) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = Math.max(1, r * 0.03);
        ctx.stroke();
      }
    };
    drawLens(-eyeSpreadY);
    drawLens(eyeSpreadY);

    if (!isMicro) {
      // Köprü: camların iç kenarları arası kısa hat (gömülüyse görünmez, zararsız).
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = Math.max(1.5, r * 0.06);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(eyeOffsetX, -eyeSpreadY + lensR * 0.75);
      ctx.lineTo(eyeOffsetX, eyeSpreadY - lensR * 0.75);
      // Şakak kolları: cam dışından gövde kenarına.
      ctx.moveTo(eyeOffsetX - lensR * 0.85, -eyeSpreadY);
      ctx.lineTo(eyeOffsetX - lensR * 0.85 - r * 0.3, -eyeSpreadY);
      ctx.moveTo(eyeOffsetX - lensR * 0.85, eyeSpreadY);
      ctx.lineTo(eyeOffsetX - lensR * 0.85 - r * 0.3, eyeSpreadY);
      ctx.stroke();
      ctx.lineCap = 'butt';

      // Üst camda beyaz parıltı.
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath();
      ctx.arc(eyeOffsetX - lensR * 0.3, -eyeSpreadY - lensR * 0.35, Math.max(1, lensR * 0.22), 0, Math.PI * 2);
      ctx.fill();
    }
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
    // Neşeli göz kırpma: bir göz açık ve iri, diğeri ∩ kemer.
    // `isEyeClosed` evrensel kırpma karesidir — o karede açık göz de çizgi olur;
    // yoksa ifade "sürekli kırpıyor" gibi okunurdu.
    const openR = eyeR * 1.1;
    if (!isEyeClosed) {
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(eyeOffsetX, -eyeSpreadY, openR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      ctx.fillStyle = '#1A1A1A';
      ctx.beginPath();
      ctx.arc(eyeOffsetX + 2, -eyeSpreadY, openR * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(eyeOffsetX + 3, -eyeSpreadY - 1.5, openR * 0.16, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(eyeOffsetX - openR + 1, -eyeSpreadY);
      ctx.lineTo(eyeOffsetX + openR - 1, -eyeSpreadY);
      ctx.stroke();
    }

    // Kırpan göz: neşeli ∩ kemer (kırpma karesinde bile kemer kalır — kimliktir).
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(eyeOffsetX, eyeSpreadY + eyeR * 0.35, eyeR * 0.85, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
    ctx.lineCap = 'butt';
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
      // 2.5D Göz derinlik gölgesi
      ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
      ctx.beginPath();
      ctx.arc(eyeOffsetX + 1.2, ey + 1.6, eyeR, 0, Math.PI * 2);
      ctx.fill();

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
      }
    };
    drawEye(-eyeSpreadY);
    drawEye(eyeSpreadY);
    // Sırıtış (GRIN) — gözlerin önünde değil, yüzün ön köşesinde duran beyaz sırıtış.
    // Gözler x≈0.64r'de biter; ağız 0.66r..0.70r'den başlayıp ~0.88r'de biter.
    const mx = r * (isPlayFace ? 0.70 : 0.66);
    const mw = r * 0.20;
    const mh = r * 0.22;

    // Ağız yolu (iç kavis ve dış kavis)
    const traceMouth = () => {
      ctx.beginPath();
      ctx.moveTo(mx, -mh);
      ctx.quadraticCurveTo(mx + mw, 0, mx, mh);
      ctx.quadraticCurveTo(mx + mw * 0.30, 0, mx, -mh);
      ctx.closePath();
    };

    // Sırıtış (GRIN) — bembeyaz diş: ağız dolgusu beyaz, diş aralıkları gövde
    // rengiyle açılır, SİYAH ÇİZGİ YOK (dış kontur dahil).
    ctx.fillStyle = '#FFFFFF';
    traceMouth();
    ctx.fill();

    // Diş aralıkları (Y ekseni boyunca 4 diş): gövde rengi hatlar.
    ctx.save();
    traceMouth();
    ctx.clip();

    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, r * 0.045);

    ctx.beginPath();
    for (const ty of [-mh * 0.46, 0, mh * 0.46]) {
      ctx.moveTo(mx - 1, ty);
      ctx.lineTo(mx + mw * 1.2, ty);
    }
    ctx.stroke();

    ctx.restore();
  } else {
    // FOCUS / Standart çift göz
    const drawEye = (ey) => {
      // 2.5D Göz derinlik gölgesi
      ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
      ctx.beginPath();
      ctx.arc(eyeOffsetX + 1.2, ey + 1.6, eyeR, 0, Math.PI * 2);
      ctx.fill();

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

  ctx.restore(); // Yüz dönme sonu

  // Dış save (translate) iadesi: bu `restore` olmadan çağıran karede
  // `translate(cx, cy)` SIZAR ve aynı karede sonra çizilen her şey
  // (menü kartındaki dokunma patlaması gibi) merkezin sağ-altına kayar.
  // Ölçülen vaka: `?probe=sparks` patlama ağırlık merkezini
  // (+56.6, +150.7)px (kutunun yarısı kadar) kaymış buldu; transform
  // dökümü `1,0,0,1,160,160` gösteriyordu.
  ctx.restore();
}
