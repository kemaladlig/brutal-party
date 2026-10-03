// Brutal Party — Birleşik Karakter Çizim Motoru (Unified Brutal Avatar Renderer)
// Tüm mini-oyunlarda (BOMB, HEIST, CROWN, COLLAPSE, NINJA, ZONE, vb.)
// ve Karakter Özelleştirme Arayüzünde standart avatar çizimini sağlar.
import { getSlotAvatar, getAvatarProfile, getBotPersona, rimHex } from '../core/customizationManager.js';
import { UI_COLORS } from './tokens.js';

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

  // 1. Sağ-alt yumuşak küre gölgesi — kütle hissi alta aittir, üst yarı
  // düz renkte kalır. Merkez alta-sağa itildi, tok 3B derinlik.
  const shade = ctx.createRadialGradient(r * 0.45, r * 0.50, r * 0.1, 0, 0, r * 1.15);
  shade.addColorStop(0, 'rgba(12, 6, 26, 0.32)');
  shade.addColorStop(0.55, 'rgba(12, 6, 26, 0.14)');
  shade.addColorStop(1, 'rgba(12, 6, 26, 0)');

  // 2. Sol-üst canlı ortam aydınlığı ve speküler yansıma (3B parlak plastik/figür hissi)
  const diffuse = ctx.createRadialGradient(-r * 0.32, -r * 0.36, 0, 0, 0, r * 1.05);
  diffuse.addColorStop(0, 'rgba(255, 255, 255, 0.30)');
  diffuse.addColorStop(0.45, 'rgba(255, 255, 255, 0.10)');
  diffuse.addColorStop(1, 'rgba(255, 255, 255, 0)');

  const entry = { diffuse, shade };
  byRadius.set(key, entry);
  return entry;
}

/**
 * Disk içi alt gölge (ambient occlusion) gradyanı — topu yere oturtan
 * katman.
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
  const g = ctx.createLinearGradient(0, r * 0.38, 0, r);
  g.addColorStop(0, 'rgba(12, 6, 26, 0)');
  g.addColorStop(1, 'rgba(12, 6, 26, 0.32)');
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
 */
// Perf: getAvatarProfile her çağrıda localStorage + JSON.parse yapar.
// Karede 4-16 avatar çizilir; 100ms TTL cache ile 1'e düşer.
let _profileCache = null;
let _profileCacheAt = 0;
function cachedAvatarProfile() {
  const now = performance.now();
  if (_profileCache && now - _profileCacheAt < 100) return _profileCache;
  try { _profileCache = getAvatarProfile(); } catch { _profileCache = null; }
  _profileCacheAt = now;
  return _profileCache;
}

export function drawBrutalAvatar(ctx, x, y, radius, options = {}) {  const slotIdx = typeof options.slotIndex === 'number' ? options.slotIndex : null;
  const isBot = options.isBot || options.slotType === 'bot_normal' || options.slotType === 'bot_god';
  const isGod = options.isGodBot || options.slotType === 'bot_god';

  const botPersona = (isBot && slotIdx !== null) ? getBotPersona(slotIdx, isGod) : null;
  const registeredAvatar = slotIdx !== null ? getSlotAvatar(slotIdx) : null;
  const profileFallback = cachedAvatarProfile();

  // Koltuk avatarı: bot persona → host kayıt defteri (relay) → cihaz profili (LOCAL/fallback).
  // Renk kimlik değildir; display rengi (options.color) her zaman kazanır.
  const avatarOpt = options.avatar
    || (isBot ? botPersona : null)
    || registeredAvatar
    || profileFallback
    || null;

  const color = options.color || (isBot ? botPersona?.color : null) || avatarOpt?.color || profileFallback?.color || '#D84727';
  const expressionRaw = options.expression || (isBot ? botPersona?.expression : null) || avatarOpt?.expression || profileFallback?.expression || 'FOCUS';

  // İfade normalizasyonu (küçük harf / durum eşleştirmeleri — büyük/küçük duyarsız)
  // avatarInGame.normalizeExpression zaten kanonik ID verir; burası doğrudan
  // gelen küçük harf / eski takma adları da aynı kapıdan geçirir.
  let expression = String(expressionRaw || 'FOCUS').toUpperCase();
  if (expression === 'NORMAL') expression = (isBot ? botPersona?.expression : null) || avatarOpt?.expression || profileFallback?.expression || 'FOCUS';
  else if (expression === 'EXCITED') expression = 'WINK';
  else if (expression === 'PANIC') expression = 'PANIC';
  else if (expression === 'DIZZY') expression = 'CYCLOPS';
  else if (expression === 'ROBOT') expression = 'CYBORG';
  else if (expression === 'SMIRK') expression = 'GRIN';
  else if (expression === 'DEAD') expression = 'ZOMBIE';
  if (typeof expression !== 'string' || !expression) expression = 'FOCUS';
  else expression = String(expression).toUpperCase();

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
    pointerColor = UI_COLORS.faceWhite,
    borderColor = null,
    borderWidth = 3,
    shadowOffset = 3,
    blinkProgress = 0, // 0 = açık, 1 = tam kapalı
    lookAngle = null, // gözlerin baktığı yön (mutlak radyan); null = yön okunur
    squashX = 1.0,
    squashY = 1.0,
    squashAngle = null,
    hitFlash = false,
  } = options;

  if (radius <= 0) return;

  // Halka: çağıran açık renk vermediyse (oyun-durumu sinyali) avatarın halka
  // seçimidir. Bot personaları sabit klasiktir — kimlikleri değişmez.
  const ringHex = isBot
    ? UI_COLORS.inkDark
    : rimHex(options.rim || avatarOpt?.rim || profileFallback?.rim);
  const ringColor = borderColor || ringHex;

  ctx.save();
  ctx.translate(x, y);
  if (scale !== 1.0) ctx.scale(scale, scale);
  if (alpha < 1.0) ctx.globalAlpha = Math.max(0, Math.min(1, ctx.globalAlpha * alpha));

  // Karakter Kinetiği (Squash & Stretch): hareket yönünde elastik uzama,
  // darbede basılma. Yalnız aktifken çağrılır (idle iken kayıtlı çağrı değişmez).
  const hasSquash = (squashX !== 1.0 || squashY !== 1.0) && typeof squashAngle === 'number';
  if (hasSquash) {
    ctx.rotate(squashAngle);
    ctx.scale(squashX, squashY);
    ctx.rotate(-squashAngle);
  }

  const r = radius;

  // 1. Zemin temas gölgesi kaldırıldı (Kullanıcı isteği üzerine iptal edildi)

  // 1b. Gövde (clip: hacim katmanı daire sınırını geçemesin)
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();

  // Taban rengi (1-kare beyaz vuruş parıltısı)
  ctx.fillStyle = hitFlash ? UI_COLORS.white : color;
  ctx.fillRect(-r - 2, -r - 2, r * 2 + 4, r * 2 + 4);

  // Hacim: 2.5D küresel katmanlar (gölge + aydınlanma + speküler parıltı + rim)
  // Oyun içi kip (`play`) ve menü sahnesi (`volume`) bunu ister;
  // ikisi de clip'in İÇİNDE bittiği için siluet değişmez — düz sticker yerine 3D top gibi okur.
  if (!hitFlash && (isPlayFace || options.volume) && !isMicro) {
    const { diffuse, shade } = playFaceShading(ctx, r);
    ctx.fillStyle = shade;
    ctx.fillRect(-r - 2, -r - 2, r * 2 + 4, r * 2 + 4);
    ctx.fillStyle = diffuse;
    ctx.fillRect(-r - 2, -r - 2, r * 2 + 4, r * 2 + 4);
  }

  // Alt gölge (ambient occlusion): yalnız alt çeyrek içten kararır,
  // top yere oturur. Üst yarı düz renkte kalır. Her kipte aynıdır.
  if (!hitFlash && !isMicro) {
    ctx.fillStyle = bodyAoGradient(ctx, r);
    ctx.fillRect(-r - 2, -r - 2, r * 2 + 4, r * 2 + 4);
  }

  ctx.restore(); // Clipping sonu

  // 2. Gövde Dış Çerçevesi (Neo-brutalist kalın kontur)
  ctx.strokeStyle = hitFlash ? UI_COLORS.white : (isTackling ? '#FFDE59' : ringColor);
  ctx.lineWidth = isTackling ? borderWidth * 1.5 : borderWidth;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();

  // 2a. Halka dış tanımı: açık halka krem sahada kaybolmasın diye ince
  // tutulur — kalın koyu çizgi üst kenarda is gibi okunuyordu.
  if (!isMicro) {
    const hair = Math.max(1, r * 0.02);
    ctx.strokeStyle = 'rgba(26, 26, 26, 0.28)';
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
    ctx.strokeStyle = UI_COLORS.inkDark;
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
    ctx.fillStyle = UI_COLORS.faceWhite;
    ctx.beginPath();
    ctx.arc(cx, 0, cEyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = UI_COLORS.inkDark;
    ctx.lineWidth = 2;
    ctx.stroke();

    if (!isEyeClosed) {
      ctx.fillStyle = UI_COLORS.inkDark;
      ctx.beginPath();
      ctx.arc(cx + 3, 0, cEyeR * 0.46, 0, Math.PI * 2);
      ctx.fill();
      // Parıltı
      ctx.fillStyle = UI_COLORS.faceWhite;
      ctx.beginPath();
      ctx.arc(cx + 4.5, -2, cEyeR * 0.16, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = UI_COLORS.inkDark;
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
      ctx.fillStyle = UI_COLORS.inkDark;
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
      ctx.strokeStyle = UI_COLORS.inkDark;
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
    ctx.fillStyle = UI_COLORS.inkDark;
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
      ctx.fillStyle = UI_COLORS.faceWhite;
      ctx.beginPath();
      ctx.arc(eyeOffsetX, ey, eyeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = UI_COLORS.inkDark;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      if (!isEyeClosed) {
        ctx.fillStyle = UI_COLORS.inkDark;
        ctx.beginPath();
        ctx.arc(eyeOffsetX + 2, ey, eyeR * 0.52, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    drawEye(-eyeSpreadY);
    drawEye(eyeSpreadY);

    // Çatık kaşlar
    ctx.strokeStyle = UI_COLORS.inkDark;
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
      ctx.fillStyle = UI_COLORS.faceWhite;
      ctx.beginPath();
      ctx.arc(eyeOffsetX, -eyeSpreadY, openR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = UI_COLORS.inkDark;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      ctx.fillStyle = UI_COLORS.inkDark;
      ctx.beginPath();
      ctx.arc(eyeOffsetX + 2, -eyeSpreadY, openR * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = UI_COLORS.faceWhite;
      ctx.beginPath();
      ctx.arc(eyeOffsetX + 3, -eyeSpreadY - 1.5, openR * 0.16, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = UI_COLORS.inkDark;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(eyeOffsetX - openR + 1, -eyeSpreadY);
      ctx.lineTo(eyeOffsetX + openR - 1, -eyeSpreadY);
      ctx.stroke();
    }

    // Kırpan göz: neşeli ∩ kemer (kırpma karesinde bile kemer kalır — kimliktir).
    ctx.strokeStyle = UI_COLORS.inkDark;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(eyeOffsetX, eyeSpreadY + eyeR * 0.35, eyeR * 0.85, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
    ctx.lineCap = 'butt';
  } else if (expression === 'DERP') {
    // Şaşkın / Çılgın gözler (biri büyük biri küçük)
    ctx.fillStyle = UI_COLORS.faceWhite;
    ctx.beginPath();
    ctx.arc(eyeOffsetX, -eyeSpreadY, eyeR * 1.15, 0, Math.PI * 2);
    ctx.arc(eyeOffsetX + 2, eyeSpreadY, eyeR * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = UI_COLORS.inkDark;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    if (!isEyeClosed) {
      ctx.fillStyle = UI_COLORS.inkDark;
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
      ctx.strokeStyle = UI_COLORS.inkDark;
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
      ctx.strokeStyle = UI_COLORS.inkDark;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(eyeOffsetX - eyeR, -eyeSpreadY);
      ctx.lineTo(eyeOffsetX + eyeR, -eyeSpreadY);
      ctx.moveTo(eyeOffsetX - eyeR, eyeSpreadY);
      ctx.lineTo(eyeOffsetX + eyeR, eyeSpreadY);
      ctx.stroke();
    }
  } else if (expression === 'STAR') {
    // Mutlu kısık gözler (heyecan): iki göz neşeli ∩ kemer — yıldız
    // dolgular uzaktan çamur okunuyordu, kapalı göz temiz durur.
    ctx.strokeStyle = UI_COLORS.inkDark;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (const ey of [-eyeSpreadY, eyeSpreadY]) {
      ctx.beginPath();
      ctx.arc(eyeOffsetX, ey + eyeR * 0.35, eyeR * 0.85, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  } else if (expression === 'SLEEPY') {
    // Yarım kapalı uykulu gözler + Z damlası
    ctx.strokeStyle = UI_COLORS.inkDark;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(eyeOffsetX, -eyeSpreadY, eyeR, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(eyeOffsetX, eyeSpreadY, eyeR, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    if (!isEyeClosed) {
      ctx.fillStyle = UI_COLORS.inkDark;
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
      ctx.strokeStyle = UI_COLORS.inkDark;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      if (!isEyeClosed) {
        ctx.fillStyle = '#2F6A4F';
        ctx.beginPath();
        ctx.arc(eyeOffsetX + 1, ey, eyeR * 0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = UI_COLORS.inkDark;
        ctx.beginPath();
        ctx.arc(eyeOffsetX + 1.5, ey + 0.5, eyeR * 0.18, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = UI_COLORS.inkDark;
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

      ctx.fillStyle = UI_COLORS.faceWhite;
      ctx.beginPath();
      ctx.arc(eyeOffsetX, ey, eyeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = UI_COLORS.inkDark;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      if (!isEyeClosed) {
        ctx.fillStyle = UI_COLORS.inkDark;
        ctx.beginPath();
        ctx.arc(eyeOffsetX + 2.5, ey, eyeR * 0.48, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = UI_COLORS.faceWhite;
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
    ctx.fillStyle = UI_COLORS.faceWhite;
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
  } else if (expression === 'PANIC') {
    // Panik: iri açılmış gözler + küçük bebek — vuruş anı FOCUS ile karışıyordu.
    const drawPanicEye = (ey) => {
      ctx.fillStyle = UI_COLORS.faceWhite;
      ctx.beginPath();
      ctx.arc(eyeOffsetX, ey, eyeR * 1.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = UI_COLORS.faceInk;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      if (!isEyeClosed) {
        ctx.fillStyle = UI_COLORS.faceInk;
        ctx.beginPath();
        ctx.arc(eyeOffsetX + 1.5, ey, eyeR * 0.34, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = UI_COLORS.faceWhite;
        ctx.beginPath();
        ctx.arc(eyeOffsetX + 2.4, ey - 1.6, eyeR * 0.13, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = UI_COLORS.faceInk;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(eyeOffsetX - eyeR, ey);
        ctx.lineTo(eyeOffsetX + eyeR, ey);
        ctx.stroke();
      }
    };
    drawPanicEye(-eyeSpreadY);
    drawPanicEye(eyeSpreadY);
  } else if (expression === 'SAD') {
    // Üzgün: sarkık üst kapak + tek gözyaşı damlası
    const drawSadEye = (ey) => {
      ctx.fillStyle = UI_COLORS.faceWhite;
      ctx.beginPath();
      ctx.arc(eyeOffsetX, ey, eyeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = UI_COLORS.inkDark;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      if (!isEyeClosed) {
        ctx.fillStyle = UI_COLORS.inkDark;
        ctx.beginPath();
        ctx.arc(eyeOffsetX + 2, ey + eyeR * 0.28, eyeR * 0.42, 0, Math.PI * 2);
        ctx.fill();
      }
      // Sarkık üst kapak (içe eğik)
      ctx.strokeStyle = UI_COLORS.inkDark;
      ctx.lineWidth = Math.max(1.6, r * 0.05);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(eyeOffsetX - eyeR * 0.9, ey - eyeR * 0.85);
      ctx.lineTo(eyeOffsetX + eyeR * 0.9, ey - eyeR * 0.35);
      ctx.stroke();
      ctx.lineCap = 'butt';
    };
    drawSadEye(-eyeSpreadY);
    drawSadEye(eyeSpreadY);
    if (!isEyeClosed) {
      const tx = eyeOffsetX + eyeR * 0.1;
      const ty = -eyeSpreadY + eyeR * 1.15;
      const tr = Math.max(1.6, eyeR * 0.26);
      ctx.fillStyle = UI_COLORS.faceTear;
      ctx.beginPath();
      ctx.moveTo(tx, ty - tr * 1.5);
      ctx.quadraticCurveTo(tx + tr, ty + tr * 0.3, tx, ty + tr);
      ctx.quadraticCurveTo(tx - tr, ty + tr * 0.3, tx, ty - tr * 1.5);
      ctx.fill();
    }
  } else if (expression === 'COOL') {
    // Havalı: yarı kapaklı iki göz (kendinden emin), kalkık tek kaş, yan sırıtış.
    const drawCoolEye = (ey) => {
      ctx.fillStyle = UI_COLORS.lidShade;
      ctx.beginPath();
      ctx.arc(eyeOffsetX + 1.2, ey + 1.6, eyeR * 1.05, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = UI_COLORS.faceWhite;
      ctx.beginPath();
      ctx.arc(eyeOffsetX, ey, eyeR * 1.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = UI_COLORS.faceInk;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      if (!isEyeClosed) {
        // Bebek hafif aşağı bakar: umursamaz, yarı kapaklı bakış.
        ctx.fillStyle = UI_COLORS.faceInk;
        ctx.beginPath();
        ctx.arc(eyeOffsetX + 1.6, ey + eyeR * 0.3, eyeR * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = UI_COLORS.faceWhite;
        ctx.beginPath();
        ctx.arc(eyeOffsetX + 2.4, ey + eyeR * 0.06, eyeR * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }

      // Ağır üst kapak: gözü yarıdan kapatan kalın, hafif eğik hat.
      ctx.strokeStyle = UI_COLORS.faceInk;
      ctx.lineWidth = Math.max(2.2, r * 0.075);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(eyeOffsetX - eyeR * 1.05, ey - eyeR * 0.34);
      ctx.quadraticCurveTo(eyeOffsetX, ey - eyeR * 0.98, eyeOffsetX + eyeR * 1.05, ey - eyeR * 0.30);
      ctx.stroke();
      ctx.lineCap = 'butt';
    };
    drawCoolEye(-eyeSpreadY);
    drawCoolEye(eyeSpreadY);

    // Kalkık tek kaş — "havalı" imzası.
    ctx.strokeStyle = UI_COLORS.faceInk;
    ctx.lineWidth = Math.max(2.2, r * 0.07);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(eyeOffsetX - eyeR * 1.15, -eyeSpreadY - eyeR * 0.95);
    ctx.lineTo(eyeOffsetX + eyeR * 0.95, -eyeSpreadY - eyeR * 1.55);
    ctx.stroke();
    ctx.lineCap = 'butt';
  } else if (expression === 'XP') {
    // Ölü: iki çarpı göz
    const drawCross = (ey) => {
      const s = eyeR * 0.85;
      ctx.strokeStyle = UI_COLORS.inkDark;
      ctx.lineWidth = Math.max(2.2, r * 0.07);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(eyeOffsetX - s, ey - s);
      ctx.lineTo(eyeOffsetX + s, ey + s);
      ctx.moveTo(eyeOffsetX + s, ey - s);
      ctx.lineTo(eyeOffsetX - s, ey + s);
      ctx.stroke();
      ctx.lineCap = 'butt';
    };
    drawCross(-eyeSpreadY);
    drawCross(eyeSpreadY);
  } else if (expression === 'DOLLAR') {
    // Zengin: iri altın akçe gözler ($ kabartmalı) + parıltı
    const drawCoin = (ey) => {
      ctx.fillStyle = UI_COLORS.hatYellow;
      ctx.beginPath();
      ctx.arc(eyeOffsetX, ey, eyeR * 1.06, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = UI_COLORS.hatGoldDark;
      ctx.lineWidth = Math.max(1.8, r * 0.055);
      ctx.stroke();
      // İç çerçeve
      ctx.beginPath();
      ctx.arc(eyeOffsetX, ey, eyeR * 0.82, 0, Math.PI * 2);
      ctx.stroke();

      // $ kabartması
      const s = eyeR * 0.62;
      ctx.strokeStyle = UI_COLORS.faceInk;
      ctx.lineWidth = Math.max(1.8, eyeR * 0.3);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(eyeOffsetX, ey - s * 1.25);
      ctx.lineTo(eyeOffsetX, ey + s * 1.25);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(eyeOffsetX, ey - s * 0.42, s * 0.42, Math.PI * 0.12, Math.PI * 1.15);
      ctx.arc(eyeOffsetX, ey + s * 0.42, s * 0.42, Math.PI * 1.12, Math.PI * 2.18);
      ctx.stroke();
      ctx.lineCap = 'butt';

      // Parıltı
      ctx.fillStyle = UI_COLORS.faceWhite;
      ctx.beginPath();
      ctx.arc(eyeOffsetX - eyeR * 0.36, ey - eyeR * 0.44, eyeR * 0.2, 0, Math.PI * 2);
      ctx.fill();
    };
    drawCoin(-eyeSpreadY);
    drawCoin(eyeSpreadY);
  } else if (expression === 'PIRATE') {
    // Korsan: açık göz + kalkık kaş, dikişli deri göz bandı ve arkaya giden kayış.
    // Açık göz
    ctx.fillStyle = UI_COLORS.faceWhite;
    ctx.beginPath();
    ctx.arc(eyeOffsetX, -eyeSpreadY, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = UI_COLORS.faceInk;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    if (!isEyeClosed) {
      ctx.fillStyle = UI_COLORS.faceInk;
      ctx.beginPath();
      ctx.arc(eyeOffsetX + 2.5, -eyeSpreadY, eyeR * 0.48, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = UI_COLORS.faceWhite;
      ctx.beginPath();
      ctx.arc(eyeOffsetX + 3.4, -eyeSpreadY - 1.4, eyeR * 0.15, 0, Math.PI * 2);
      ctx.fill();
    }
    // Kalkık kaş (sert bakış)
    ctx.strokeStyle = UI_COLORS.faceInk;
    ctx.lineWidth = Math.max(2.2, r * 0.07);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(eyeOffsetX - eyeR * 1.1, -eyeSpreadY - eyeR * 1.0);
    ctx.lineTo(eyeOffsetX + eyeR * 0.95, -eyeSpreadY - eyeR * 1.5);
    ctx.stroke();
    ctx.lineCap = 'butt';

    // Kayış: bandı başın arkasına bağlayan tek çapraz hat (patch altında kalır)
    ctx.strokeStyle = UI_COLORS.faceInk;
    ctx.lineWidth = Math.max(2.4, r * 0.075);
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(-r * 0.68, -r * 0.42);
    ctx.lineTo(r * 0.56, r * 0.64);
    ctx.stroke();

    // Dikişli deri göz bandı (yamuk yastık)
    const px = eyeOffsetX;
    const py = eyeSpreadY;
    const pr = eyeR * 1.15;
    ctx.fillStyle = UI_COLORS.inkDark;
    ctx.strokeStyle = UI_COLORS.faceInk;
    ctx.lineWidth = Math.max(1.6, r * 0.05);
    ctx.beginPath();
    ctx.moveTo(px - pr, py - pr * 0.5);
    ctx.quadraticCurveTo(px, py - pr * 1.15, px + pr, py - pr * 0.65);
    ctx.lineTo(px + pr * 0.85, py + pr * 0.75);
    ctx.quadraticCurveTo(px, py + pr * 1.1, px - pr, py + pr * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Dikişler
    ctx.strokeStyle = UI_COLORS.hatMetal;
    ctx.lineWidth = Math.max(1.1, r * 0.032);
    ctx.lineCap = 'round';
    for (const [sx, sy, ex, ey2] of [
      [px - pr * 0.55, py - pr * 0.92, px - pr * 0.62, py - pr * 0.55],
      [px + pr * 0.10, py - pr * 1.05, px + pr * 0.18, py - pr * 0.68],
      [px - pr * 0.60, py + pr * 0.95, px - pr * 0.68, py + pr * 0.58],
      [px + pr * 0.05, py + pr * 1.02, px + pr * 0.14, py + pr * 0.66],
    ]) {
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey2);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  } else if (expression === 'NERD') {
    // İnek: yuvarlak çerçeveli gözlükler
    const frameR = eyeR * 1.2;
    const drawNerdEye = (ey) => {
      ctx.fillStyle = UI_COLORS.faceWhite;
      ctx.beginPath();
      ctx.arc(eyeOffsetX, ey, eyeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = UI_COLORS.inkDark;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      if (!isEyeClosed) {
        ctx.fillStyle = UI_COLORS.inkDark;
        ctx.beginPath();
        ctx.arc(eyeOffsetX + 2.5, ey, eyeR * 0.46, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = UI_COLORS.hatInk;
      ctx.lineWidth = Math.max(2, r * 0.06);
      ctx.beginPath();
      ctx.arc(eyeOffsetX, ey, frameR, 0, Math.PI * 2);
      ctx.stroke();
    };
    drawNerdEye(-eyeSpreadY);
    drawNerdEye(eyeSpreadY);
    ctx.strokeStyle = UI_COLORS.hatInk;
    ctx.lineWidth = Math.max(2, r * 0.06);
    ctx.beginPath();
    ctx.moveTo(eyeOffsetX, -eyeSpreadY + frameR);
    ctx.lineTo(eyeOffsetX, eyeSpreadY - frameR);
    ctx.stroke();
  } else if (expression === 'CAT') {
    // Kedi: yeşil irisli iri gözler, dikey yarık bebek ve öne uzanan bıyıklar.
    const drawCatEye = (ey) => {
      ctx.fillStyle = UI_COLORS.faceWhite;
      ctx.beginPath();
      ctx.ellipse(eyeOffsetX, ey, eyeR * 0.98, eyeR * 1.08, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = UI_COLORS.faceInk;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      if (!isEyeClosed) {
        // Yeşil iris + dikey yarık bebek + parıltı
        ctx.fillStyle = UI_COLORS.hatEmerald;
        ctx.beginPath();
        ctx.ellipse(eyeOffsetX + 1, ey, eyeR * 0.62, eyeR * 0.78, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = UI_COLORS.faceInk;
        ctx.beginPath();
        ctx.ellipse(eyeOffsetX + 1, ey, eyeR * 0.17, eyeR * 0.62, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = UI_COLORS.faceWhite;
        ctx.beginPath();
        ctx.arc(eyeOffsetX - eyeR * 0.12, ey - eyeR * 0.42, eyeR * 0.15, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = UI_COLORS.faceInk;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(eyeOffsetX - eyeR * 0.9, ey);
        ctx.lineTo(eyeOffsetX + eyeR * 0.9, ey);
        ctx.stroke();
      }
    };
    drawCatEye(-eyeSpreadY);
    drawCatEye(eyeSpreadY);

    // Bıyıklar: öne doğru üçer ince kıl
    ctx.strokeStyle = 'rgba(26, 26, 26, 0.55)';
    ctx.lineWidth = Math.max(1, r * 0.028);
    ctx.lineCap = 'round';
    const wx = r * 0.50;
    for (const dy of [-0.5, -0.1, 0.3]) {
      ctx.beginPath();
      ctx.moveTo(wx, dy * eyeR);
      ctx.lineTo(r * 0.88, dy * eyeR * 1.9);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  } else if (expression === 'SHY') {
    // Utangaç: yana-aşağı kaçan bakış, ağır üst kapak ve yoğun allık.
    const drawShyEye = (ey) => {
      ctx.fillStyle = UI_COLORS.faceWhite;
      ctx.beginPath();
      ctx.arc(eyeOffsetX, ey, eyeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = UI_COLORS.faceInk;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      if (!isEyeClosed) {
        // Bebek içe (burna) ve aşağı kaçar.
        ctx.fillStyle = UI_COLORS.faceInk;
        ctx.beginPath();
        ctx.arc(eyeOffsetX - eyeR * 0.18, ey + eyeR * 0.34, eyeR * 0.44, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = UI_COLORS.faceWhite;
        ctx.beginPath();
        ctx.arc(eyeOffsetX - eyeR * 0.08, ey + eyeR * 0.16, eyeR * 0.13, 0, Math.PI * 2);
        ctx.fill();
      }
      // Ağır üst kapak (utançla öne düşer).
      ctx.strokeStyle = UI_COLORS.faceInk;
      ctx.lineWidth = Math.max(2, r * 0.06);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(eyeOffsetX - eyeR * 1.0, ey - eyeR * 0.5);
      ctx.quadraticCurveTo(eyeOffsetX, ey - eyeR * 0.95, eyeOffsetX + eyeR * 1.0, ey - eyeR * 0.55);
      ctx.stroke();
      ctx.lineCap = 'butt';
    };
    drawShyEye(-eyeSpreadY);
    drawShyEye(eyeSpreadY);
  } else if (expression === 'GLAM') {
    // Işıltı: iri mor irisli gözler, uzun üst kirpikler ve yıldız parıltısı.
    const drawGlamEye = (ey) => {
      ctx.fillStyle = UI_COLORS.lidShade;
      ctx.beginPath();
      ctx.arc(eyeOffsetX + 1.2, ey + 1.6, eyeR * 1.08, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = UI_COLORS.faceWhite;
      ctx.beginPath();
      ctx.arc(eyeOffsetX, ey, eyeR * 1.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = UI_COLORS.faceInk;
      ctx.lineWidth = Math.max(1.6, r * 0.05);
      ctx.stroke();

      if (!isEyeClosed) {
        // Mor iris + bebek + çift parıltı
        ctx.fillStyle = UI_COLORS.hatPurple;
        ctx.beginPath();
        ctx.arc(eyeOffsetX + 1.4, ey, eyeR * 0.72, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = UI_COLORS.faceInk;
        ctx.beginPath();
        ctx.arc(eyeOffsetX + 1.4, ey, eyeR * 0.32, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = UI_COLORS.faceWhite;
        ctx.beginPath();
        ctx.arc(eyeOffsetX - eyeR * 0.1, ey - eyeR * 0.42, eyeR * 0.24, 0, Math.PI * 2);
        ctx.arc(eyeOffsetX + eyeR * 0.62, ey + eyeR * 0.4, eyeR * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }

      // Uzun üst kirpikler: üst (-Y) kenardan dışa uzanan üç kıl.
      ctx.strokeStyle = UI_COLORS.faceInk;
      ctx.lineWidth = Math.max(1.6, r * 0.052);
      ctx.lineCap = 'round';
      for (const a of [-2.15, -1.6, -1.05]) {
        const bx = eyeOffsetX + Math.cos(a) * eyeR * 1.02;
        const by = ey + Math.sin(a) * eyeR * 1.02;
        const tx = eyeOffsetX + Math.cos(a) * (eyeR + r * 0.22);
        const ty = ey + Math.sin(a) * (eyeR + r * 0.22);
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
    };
    drawGlamEye(-eyeSpreadY);
    drawGlamEye(eyeSpreadY);

    // Yıldız parıltısı — "ışıltı" imzası (ışıltı yüzde dört köşeli ışık).
    const sx = eyeOffsetX - eyeR * 0.2;
    const sy = -eyeSpreadY - eyeR * 1.75;
    const sr = Math.max(2.4, eyeR * 0.5);
    ctx.fillStyle = UI_COLORS.hatGold;
    ctx.beginPath();
    ctx.moveTo(sx, sy - sr);
    ctx.lineTo(sx + sr * 0.26, sy - sr * 0.26);
    ctx.lineTo(sx + sr, sy);
    ctx.lineTo(sx + sr * 0.26, sy + sr * 0.26);
    ctx.lineTo(sx, sy + sr);
    ctx.lineTo(sx - sr * 0.26, sy + sr * 0.26);
    ctx.lineTo(sx - sr, sy);
    ctx.lineTo(sx - sr * 0.26, sy - sr * 0.26);
    ctx.closePath();
    ctx.fill();
  } else if (expression === 'KISS') {
    // Öpücük: yumuşak iri gözler (dudaklar ağız katmanında)
    const drawKissEye = (ey) => {
      ctx.fillStyle = UI_COLORS.faceWhite;
      ctx.beginPath();
      ctx.arc(eyeOffsetX, ey, eyeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = UI_COLORS.faceInk;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      if (!isEyeClosed) {
        ctx.fillStyle = UI_COLORS.faceInk;
        ctx.beginPath();
        ctx.arc(eyeOffsetX + 2.5, ey, eyeR * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = UI_COLORS.faceWhite;
        ctx.beginPath();
        ctx.arc(eyeOffsetX + 3.5, ey - 1.5, eyeR * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    drawKissEye(-eyeSpreadY);
    drawKissEye(eyeSpreadY);
  } else {
    // FOCUS / Standart çift göz
    const drawEye = (ey) => {
      // 2.5D Göz derinlik gölgesi
      ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
      ctx.beginPath();
      ctx.arc(eyeOffsetX + 1.2, ey + 1.6, eyeR, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = UI_COLORS.faceWhite;
      ctx.beginPath();
      ctx.arc(eyeOffsetX, ey, eyeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = UI_COLORS.inkDark;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      if (!isEyeClosed) {
        ctx.fillStyle = UI_COLORS.inkDark;
        ctx.beginPath();
        ctx.arc(eyeOffsetX + 2.5, ey, eyeR * 0.48, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = UI_COLORS.faceWhite;
        ctx.beginPath();
        ctx.arc(eyeOffsetX + 3.5, ey - 1.5, eyeR * 0.16, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = UI_COLORS.inkDark;
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

  // 5b. Birleşik ağız + allık — tek kaynak, tüm ifadeler burada kapanır.
  // GRIN kendi diş ağzını çizer, ANGRY kendi kaşını çizer; kalanlar burada.
  // Mikro boyda atlanır, fillRect yok, rotate yok, hepsi siluet içinde.
  if (!isMicro) {
    const mx = r * 0.58;
    const ml = Math.max(1.5, r * 0.11);
    const mw = Math.max(1.5, r * 0.10);
    const mouthLineW = Math.max(1.2, r * 0.055);
    // --- Ağız ---
    if (expression !== 'GRIN') {
      if (expression === 'PANIC') {
        ctx.fillStyle = UI_COLORS.mouthDark;
        ctx.beginPath();
        ctx.ellipse(mx, 0, Math.max(1.2, r * 0.09), Math.max(1.8, r * 0.16), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = UI_COLORS.tongue;
        ctx.beginPath();
        ctx.ellipse(mx + r * 0.03, r * 0.06, Math.max(0.8, r * 0.045), Math.max(0.8, r * 0.06), 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (expression === 'DERP' || expression === 'SLEEPY') {
        ctx.fillStyle = UI_COLORS.mouthDark;
        ctx.beginPath();
        ctx.ellipse(mx, 0, Math.max(1, r * 0.07), Math.max(1.2, r * 0.11), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = UI_COLORS.tongue;
        ctx.beginPath();
        ctx.ellipse(mx + r * 0.02, r * 0.04, Math.max(0.7, r * 0.032), Math.max(0.7, r * 0.05), 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (expression === 'WINK' || expression === 'HEART' || expression === 'STAR' || expression === 'SHY' || expression === 'GLAM') {
        ctx.strokeStyle = UI_COLORS.faceInk;
        ctx.lineWidth = expression === 'STAR' ? Math.max(1.6, r * 0.07) : mouthLineW;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(mx, -ml * 1.2);
        ctx.quadraticCurveTo(mx + mw, 0, mx, ml * 1.2);
        ctx.stroke();
        ctx.lineCap = 'butt';
      } else if (expression === 'ZOMBIE') {
        ctx.strokeStyle = UI_COLORS.faceInk;
        ctx.lineWidth = mouthLineW;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(mx, -ml);
        ctx.lineTo(mx + mw * 0.6, -ml * 0.3);
        ctx.lineTo(mx, ml * 0.3);
        ctx.lineTo(mx + mw * 0.6, ml);
        ctx.stroke();
        ctx.lineCap = 'butt';
      } else if (expression === 'SHADES') {
        ctx.strokeStyle = UI_COLORS.faceInk;
        ctx.lineWidth = mouthLineW;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(mx, -ml * 0.6);
        ctx.lineTo(mx + mw * 0.5, ml * 0.9);
        ctx.stroke();
        ctx.lineCap = 'butt';
      } else if (expression === 'SAD') {
        // Üzgün ağız: ters kavis
        ctx.strokeStyle = UI_COLORS.faceInk;
        ctx.lineWidth = mouthLineW;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(mx + r * 0.06, ml * 1.5, ml * 1.15, Math.PI * 1.2, Math.PI * 1.8);
        ctx.stroke();
        ctx.lineCap = 'butt';
      } else if (expression === 'COOL' || expression === 'PIRATE') {
        // Kendinden emin yan sırıtış
        ctx.strokeStyle = UI_COLORS.faceInk;
        ctx.lineWidth = mouthLineW;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(mx - ml * 0.2, -ml * 0.5);
        ctx.lineTo(mx + mw * 0.7, ml * 0.9);
        ctx.stroke();
        ctx.lineCap = 'butt';
      } else if (expression === 'CAT') {
        // Kedi ağzı (küçük "w")
        ctx.strokeStyle = UI_COLORS.faceInk;
        ctx.lineWidth = mouthLineW;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(mx - ml * 0.4, -ml * 0.2);
        ctx.quadraticCurveTo(mx - ml * 0.1, -ml * 0.8, mx + ml * 0.1, -ml * 0.2);
        ctx.quadraticCurveTo(mx + ml * 0.3, ml * 0.4, mx + ml * 0.6, -ml * 0.2);
        ctx.stroke();
        ctx.lineCap = 'butt';
      } else if (expression === 'XP' || expression === 'DOLLAR') {
        // Şaşkın küçük "o" ağız
        ctx.fillStyle = UI_COLORS.mouthDark;
        ctx.beginPath();
        ctx.ellipse(mx, 0, Math.max(1, r * 0.06), Math.max(1.2, r * 0.09), 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (expression === 'KISS') {
        // Öpücük: büzülmüş dudaklar (orta çizgiyle ikiye ayrık)
        ctx.fillStyle = UI_COLORS.heartPink;
        ctx.strokeStyle = UI_COLORS.faceInk;
        ctx.lineWidth = Math.max(1.2, r * 0.03);
        ctx.beginPath();
        ctx.ellipse(mx, 0, Math.max(1.4, r * 0.10), Math.max(1, r * 0.07), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(mx - r * 0.06, 0);
        ctx.lineTo(mx + r * 0.06, 0);
        ctx.stroke();
      } else {
        // FOCUS / CYCLOPS / CYBORG / ANGRY / SLEEPY çizgisi — sakin, kısa, dikey profil.
        ctx.strokeStyle = UI_COLORS.faceInk;
        ctx.lineWidth = mouthLineW;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(mx, -ml);
        ctx.lineTo(mx + r * 0.02, ml);
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
    }
    // --- Allık (sıcak ifadelerde yanak ısısı) ---
    if (expression === 'HEART' || expression === 'STAR' || expression === 'WINK' || expression === 'GRIN'
      || expression === 'SHY' || expression === 'KISS' || expression === 'GLAM') {
      const shy = expression === 'SHY';
      const br = Math.max(1.2, eyeR * (shy ? 0.62 : 0.42));
      const bxBlush = eyeOffsetX - eyeR * (shy ? 1.25 : 1.1);
      const byBlush = eyeSpreadY + eyeR * (shy ? 0.55 : 0.75);
      ctx.fillStyle = UI_COLORS.blush;
      ctx.beginPath();
      ctx.arc(bxBlush, -byBlush, br, 0, Math.PI * 2);
      ctx.arc(bxBlush, byBlush, br, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore(); // Yüz dönme sonu

  // 5c. İç rim ışığı — sol-üst hilal, topu ışıktan okutur. Clip dışı değil,
  // gövde çemberinin içinde, stroke ile; fillRect sayımına dokunmaz.
  // globalAlpha YOK: sahte ctx kayıtlarında save/restore yığını çalışmaz ve
  // sızan alpha final kartı testini bozar; yarı saydamlık token rengindedir.
  if (!isMicro && (isPlayFace || options.volume)) {
    ctx.strokeStyle = UI_COLORS.rimLight;
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.8, Math.PI * 1.05, Math.PI * 1.55);
    ctx.stroke();
  }

  // 6. Ba\u015f s\u00fcs\u00fc (HEADWEAR) \u2014 disk d\u0131\u015f\u0131nda, hitbox'tan ba\u011f\u0131ms\u0131z.
  // `facingAngle`'le d\u00f6ner: karakter ne y\u00f6ne bakarsa \u015fapka da o y\u00f6ne e\u011filir.
  // Mikro boyda ve isBot'ta atlan\u0131r (saha ikonografi kalabal\u0131\u011fl\u0131\u011f\u0131 \u00f6nler).
  const headwearId = String(
    options.headwear
    || options.avatar?.headwear
    || avatarOpt?.headwear
    || (slotIdx !== null ? registeredAvatar?.headwear : null)
    || profileFallback?.headwear
    || ''
  ).toUpperCase();
  if (!isMicro && !isBot && headwearId && headwearId !== 'NONE') {
    drawHeadwear(ctx, r, facingAngle, headwearId, color);
  }

  // D\u0131\u015f save (translate) iadesi: bu `restore` olmadan \u00e7a\u011f\u0131ran karede
  // `translate(cx, cy)` SIZAR ve ayn\u0131 karede sonra \u00e7izilen her \u015fey
  // (men\u00fc kart\u0131ndaki dokunma patlamas\u0131 gibi) merkezin sa\u011f-alt\u0131na kayar.
  // \u00d6l\u00e7\u00fclen vaka: `?probe=sparks` patlama a\u011f\u0131rl\u0131k merkezini
  // (+56.6, +150.7)px (kutunun yar\u0131s\u0131 kadar) kaym\u0131\u015f buldu; transform
  // d\u00f6k\u00fcm\u00fc `1,0,0,1,160,160` g\u00f6steriyordu.
  ctx.restore();
}

/**
 * Ba\u015f s\u00fcs\u00fc \u00e7izer. Avatar merkezi (0,0)'dad\u0131r; disk tepesi (-r, 0) y\u00f6n\u00fcnde
 * (facingAngle'a d\u00f6nd\u00fcr\u00fcl\u00fcr). Hitbox etkisi yok \u2014 clip yok, fill sadece disk \u00fcst\u00fcnde.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} r - avatar yar\u0131\u00e7ap\u0131
 * @param {number} facingAngle - g\u00f6vde bak\u0131\u015f a\u00e7\u0131s\u0131 (radyan)
 * @param {string} id - AVATAR_HEADWEAR id'si
 * @param {string} bodyColor - g\u00f6vde rengi (baz\u0131 \u015fapkalar rengi uyumlu kullan\u0131r)
 */
function drawHeadwear(ctx, r, facingAngle, id, bodyColor) {
  ctx.save();
  // Gözlerin tam zıttına (kafanın arkası / baş tepesi) yerleştir:
  // facingAngle = gözlerin baktığı yön (-X)
  // facingAngle + Math.PI = başın arkası/tepesi (+X)
  // Orijin avatarın MERKEZİNDE (0,0) kalır; aksesuarlar başın tacı üzerinde
  // (0.42r..0.62r) başlar ve çemberin kenarından görkemli şekilde taşar (1.25r..1.38r).
  ctx.rotate(facingAngle + Math.PI);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (id === 'CROWN') {
    // ── İmparatorluk Altın Tacı (Görkemli 5 tepeli kral tacı) ──
    const baseX = r * 0.52;
    const baseW = r * 0.58;

    // 1. Kadife iç astar (Başın üstüne oturan kemerli kubbe)
    ctx.fillStyle = UI_COLORS.hatVelvet;
    ctx.beginPath();
    ctx.ellipse(baseX + r * 0.12, 0, r * 0.22, baseW * 0.85, 0, -Math.PI / 2, Math.PI / 2);
    ctx.fill();

    // 2. Altın taç gövdesi — 5 sivri uçlu görkemli siluet
    ctx.fillStyle = UI_COLORS.hatGold;
    ctx.strokeStyle = UI_COLORS.hatInk;
    ctx.lineWidth = Math.max(1.8, r * 0.065);
    ctx.beginPath();
    // Taban kavisi
    ctx.moveTo(baseX, -baseW);
    // Sol dış tepe
    ctx.lineTo(r * 0.85, -baseW);
    ctx.lineTo(r * 0.68, -baseW * 0.65);
    // Sol orta tepe
    ctx.lineTo(r * 1.05, -baseW * 0.35);
    ctx.lineTo(r * 0.78, -baseW * 0.16);
    // Görkemli dev orta tepe
    ctx.lineTo(r * 1.28, 0);
    // Sağ orta tepe
    ctx.lineTo(r * 0.78, baseW * 0.16);
    ctx.lineTo(r * 1.05, baseW * 0.35);
    ctx.lineTo(r * 0.68, baseW * 0.65);
    // Sağ dış tepe
    ctx.lineTo(r * 0.85, baseW);
    ctx.lineTo(baseX, baseW);
    // Taban kavisini kapat
    ctx.quadraticCurveTo(baseX + r * 0.10, 0, baseX, -baseW);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 3. Altın gölge açısı (3D karikatür hacmi — sağ yarı)
    ctx.fillStyle = UI_COLORS.hatGoldDark;
    ctx.beginPath();
    ctx.moveTo(baseX + r * 0.10, 0);
    ctx.lineTo(r * 1.28, 0);
    ctx.lineTo(r * 0.78, baseW * 0.16);
    ctx.lineTo(r * 1.05, baseW * 0.35);
    ctx.lineTo(r * 0.68, baseW * 0.65);
    ctx.lineTo(r * 0.85, baseW);
    ctx.lineTo(baseX, baseW);
    ctx.quadraticCurveTo(baseX + r * 0.10, baseW * 0.5, baseX + r * 0.10, 0);
    ctx.closePath();
    ctx.fill();

    // 4. Değerli Mücevherler (Faceted Gems)
    // Orta tepe: Parlak Yakut (Ruby Diamond)
    const gemR = Math.max(2.4, r * 0.105);
    ctx.fillStyle = UI_COLORS.hatGem;
    ctx.strokeStyle = UI_COLORS.hatInk;
    ctx.lineWidth = Math.max(1.2, r * 0.035);
    ctx.beginPath();
    ctx.moveTo(r * 1.14, 0);
    ctx.lineTo(r * 1.00, -gemR);
    ctx.lineTo(r * 0.86, 0);
    ctx.lineTo(r * 1.00, gemR);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Yakut parıltısı
    ctx.fillStyle = UI_COLORS.hatShine;
    ctx.beginPath();
    ctx.arc(r * 1.05, -gemR * 0.3, gemR * 0.28, 0, Math.PI * 2);
    ctx.fill();

    // Yan tepeler: Zümrüt (Emerald) ve Safir (Sapphire)
    const sideGemR = Math.max(2.0, r * 0.08);
    ctx.fillStyle = UI_COLORS.hatEmerald;
    ctx.beginPath();
    ctx.arc(r * 0.90, -baseW * 0.35, sideGemR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = UI_COLORS.hatSapphire;
    ctx.beginPath();
    ctx.arc(r * 0.90, baseW * 0.35, sideGemR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 5. Taç kaidesi incileri (Base Pearls)
    ctx.fillStyle = UI_COLORS.hatShine;
    for (const py of [-baseW * 0.55, 0, baseW * 0.55]) {
      const px = py === 0 ? baseX + r * 0.12 : baseX + r * 0.05;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(1.6, r * 0.06), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

  } else if (id === 'PARTY_HAT') {
    // ── Çılgın Parti Şapkası (Kafaya oturan neon çizgili külah) ──
    const baseX = r * 0.44;
    const hw = r * 0.48;
    const tipX = r * 1.34;
    const tipY = hw * 0.20;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(baseX, -hw);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(baseX, hw);
    ctx.quadraticCurveTo(baseX + r * 0.10, 0, baseX, -hw);
    ctx.closePath();

    ctx.fillStyle = UI_COLORS.hatOrange;
    ctx.fill();
    ctx.clip();

    // Neon şeritler
    const spanX = tipX - baseX;
    const stripes = [
      { t0: 0.18, t1: 0.36, color: UI_COLORS.hatYellow },
      { t0: 0.48, t1: 0.64, color: UI_COLORS.hatCyan },
      { t0: 0.74, t1: 0.88, color: UI_COLORS.hatPurple },
    ];
    for (const s of stripes) {
      ctx.fillStyle = s.color;
      const x0 = baseX + spanX * s.t0;
      const x1 = baseX + spanX * s.t1;
      ctx.beginPath();
      ctx.moveTo(x0, -hw * 1.6);
      ctx.lineTo(x1, -hw * 1.6);
      ctx.lineTo(x1, hw * 1.6);
      ctx.lineTo(x0, hw * 1.6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.strokeStyle = UI_COLORS.hatInk;
    ctx.lineWidth = Math.max(1.8, r * 0.06);
    ctx.beginPath();
    ctx.moveTo(baseX, -hw);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(baseX, hw);
    ctx.quadraticCurveTo(baseX + r * 0.10, 0, baseX, -hw);
    ctx.closePath();
    ctx.stroke();

    // Pofuduk altın pom-pom kümesi
    const pomR = Math.max(2.8, r * 0.13);
    ctx.fillStyle = UI_COLORS.hatYellow;
    ctx.strokeStyle = UI_COLORS.hatInk;
    ctx.lineWidth = Math.max(1.2, r * 0.035);
    const puffs = [
      [tipX, tipY],
      [tipX + pomR * 0.55, tipY - pomR * 0.38],
      [tipX + pomR * 0.55, tipY + pomR * 0.38],
      [tipX + pomR * 0.85, tipY],
    ];
    for (const [px, py] of puffs) {
      ctx.beginPath();
      ctx.arc(px, py, pomR * 0.65, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = UI_COLORS.hatShine;
    ctx.beginPath();
    ctx.arc(tipX + pomR * 0.32, tipY - pomR * 0.18, pomR * 0.24, 0, Math.PI * 2);
    ctx.fill();

  } else if (id === 'WIZARD') {
    // ── Başbüyücü Şapkası (Geniş kenarlıklı kıvrık şapka) ──
    const brimX = r * 0.58;
    const brimW = r * 0.76;
    const brimH = r * 0.25;
    const coneEndX = r * 1.36;
    const coneEndY = brimW * 0.40;

    // 1. Geniş Koyu Kenarlık (Brim) — başın üstüne oturan elips
    ctx.fillStyle = UI_COLORS.hatPurpleDark;
    ctx.strokeStyle = UI_COLORS.hatInk;
    ctx.lineWidth = Math.max(1.8, r * 0.065);
    ctx.beginPath();
    ctx.ellipse(brimX, 0, brimH, brimW, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 2. Kıvrık Büyücü Konisi
    ctx.fillStyle = UI_COLORS.hatPurple;
    ctx.beginPath();
    ctx.moveTo(brimX - brimH * 0.3, -brimW * 0.55);
    ctx.bezierCurveTo(brimX + r * 0.40, -brimW * 0.35, brimX + r * 0.65, -brimW * 0.08, brimX + r * 0.75, brimW * 0.20);
    ctx.lineTo(coneEndX, coneEndY);
    ctx.lineTo(coneEndX - r * 0.20, coneEndY - brimW * 0.34);
    ctx.bezierCurveTo(brimX + r * 0.52, brimW * 0.10, brimX + r * 0.28, brimW * 0.35, brimX - brimH * 0.3, brimW * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 3. Altın Kemer & Toka
    ctx.fillStyle = UI_COLORS.hatGold;
    ctx.strokeStyle = UI_COLORS.hatInk;
    ctx.lineWidth = Math.max(1.4, r * 0.04);
    ctx.beginPath();
    ctx.rect(brimX - brimH * 0.15, -brimW * 0.42, r * 0.15, brimW * 0.84);
    ctx.fill();
    ctx.stroke();
    // Kare altın toka
    const bSize = Math.max(3.5, r * 0.17);
    ctx.fillStyle = UI_COLORS.hatYellow;
    ctx.fillRect(brimX - brimH * 0.2, -bSize / 2, bSize, bSize);
    ctx.strokeRect(brimX - brimH * 0.2, -bSize / 2, bSize, bSize);
    ctx.fillStyle = UI_COLORS.hatInk;
    ctx.fillRect(brimX - brimH * 0.2 + bSize * 0.25, -bSize * 0.25, bSize * 0.5, bSize * 0.5);

    // 4. Parıldayan Altın Hilal ve Yıldızlar
    ctx.fillStyle = UI_COLORS.hatYellow;
    const mx = brimX + r * 0.38;
    const my = -brimW * 0.08;
    const mr = Math.max(2.4, r * 0.11);
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.arc(mx + mr * 0.45, my - mr * 0.25, mr * 0.85, 0, Math.PI * 2, true);
    ctx.fill();

    const sx = brimX + r * 0.60;
    const sy = brimW * 0.09;
    const sr = Math.max(1.6, r * 0.075);
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();

  } else if (id === 'HALO') {
    // ── Kutsal Melek Halesi (Kafanın üstünde parıldayan süzülen halka) ──
    const hx = r * 0.88;
    const hrY = r * 0.68;
    const hrX = r * 0.26;

    ctx.save();
    // Altın ışıma aurası
    ctx.strokeStyle = UI_COLORS.hatHaloAura;
    ctx.lineWidth = Math.max(4.5, r * 0.22);
    ctx.beginPath();
    ctx.ellipse(hx, 0, hrX, hrY, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Altın halka gövdesi
    ctx.strokeStyle = UI_COLORS.hatGold;
    ctx.lineWidth = Math.max(2.4, r * 0.10);
    ctx.beginPath();
    ctx.ellipse(hx, 0, hrX, hrY, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Beyaz speküler çekirdek
    ctx.strokeStyle = UI_COLORS.hatShine;
    ctx.lineWidth = Math.max(1, r * 0.04);
    ctx.beginPath();
    ctx.ellipse(hx, 0, hrX, hrY, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Kutsal 4 köşeli parlama yıldızları
    const drawSparkle = (sx, sy, size) => {
      ctx.fillStyle = UI_COLORS.hatShine;
      ctx.beginPath();
      ctx.moveTo(sx, sy - size);
      ctx.quadraticCurveTo(sx, sy, sx + size, sy);
      ctx.quadraticCurveTo(sx, sy, sx, sy + size);
      ctx.quadraticCurveTo(sx, sy, sx - size, sy);
      ctx.quadraticCurveTo(sx, sy, sx - size, sy);
      ctx.fill();
    };
    drawSparkle(hx - hrX * 0.2, -hrY * 0.85, Math.max(2.6, r * 0.12));
    drawSparkle(hx + hrX * 0.3, hrY * 0.85, Math.max(2.2, r * 0.10));
    ctx.restore();

  } else if (id === 'HORNS') {
    // ── Volkanik Şeytan Boynuzları (Kafadan filizlenen kıvrık boynuzlar) ──
    const drawHorn = (sign) => {
      const rootX = r * 0.42;
      const rootY = sign * r * 0.45;
      const midX = r * 0.82;
      const midY = sign * r * 0.88;
      const tipX = r * 1.25;
      const tipY = sign * r * 0.68;
      const baseW = r * 0.22;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(rootX, rootY - sign * baseW * 0.5);
      ctx.bezierCurveTo(midX * 0.7, midY, midX * 1.1, midY * 1.05, tipX, tipY);
      ctx.bezierCurveTo(midX * 0.9, midY * 0.80, rootX + r * 0.16, rootY + sign * baseW * 0.4, rootX, rootY + sign * baseW * 0.5);
      ctx.closePath();

      ctx.fillStyle = UI_COLORS.hatRed;
      ctx.fill();
      ctx.clip();

      // Kök: obsidyen koyuluğu
      ctx.fillStyle = UI_COLORS.hatObsidian;
      ctx.fillRect(rootX - r * 0.2, rootY - baseW * 2, r * 0.32, baseW * 4);

      // Uç: akkor alev gradyanı
      ctx.fillStyle = UI_COLORS.hatOrange;
      ctx.beginPath();
      ctx.arc(tipX, tipY, r * 0.38, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = UI_COLORS.hatYellow;
      ctx.beginPath();
      ctx.arc(tipX, tipY, r * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Dış vuruş konturu
      ctx.strokeStyle = UI_COLORS.hatInk;
      ctx.lineWidth = Math.max(1.8, r * 0.065);
      ctx.beginPath();
      ctx.moveTo(rootX, rootY - sign * baseW * 0.5);
      ctx.bezierCurveTo(midX * 0.7, midY, midX * 1.1, midY * 1.05, tipX, tipY);
      ctx.bezierCurveTo(midX * 0.9, midY * 0.80, rootX + r * 0.16, rootY + sign * baseW * 0.4, rootX, rootY + sign * baseW * 0.5);
      ctx.closePath();
      ctx.stroke();

      // Boğum çizgisi
      ctx.strokeStyle = UI_COLORS.hatInk;
      ctx.lineWidth = Math.max(1.2, r * 0.045);
      ctx.beginPath();
      ctx.moveTo(midX * 0.85, midY * 0.82);
      ctx.lineTo(midX * 0.95, midY * 0.95);
      ctx.stroke();
    };

    drawHorn(-1);
    drawHorn(1);

  } else if (id === 'BOW') {
    // ── Şirin Anime/Arcade Kurdelesi (Başın arkasına takılı toka/kurdele) ──
    const knotX = r * 0.62;
    const knotR = Math.max(3.0, r * 0.14);
    const loopW = r * 0.68;
    const loopH = r * 0.36;

    // Kuyruklar
    const drawTail = (sign) => {
      ctx.fillStyle = UI_COLORS.hatPinkDark;
      ctx.strokeStyle = UI_COLORS.hatInk;
      ctx.lineWidth = Math.max(1.6, r * 0.055);
      ctx.beginPath();
      ctx.moveTo(knotX, sign * knotR * 0.5);
      ctx.lineTo(knotX + r * 0.48, sign * loopW * 0.55);
      ctx.lineTo(knotX + r * 0.36, sign * loopW * 0.40);
      ctx.lineTo(knotX + r * 0.46, sign * loopW * 0.24);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };
    drawTail(-1);
    drawTail(1);

    // Kanatlar (Loops)
    const drawLoop = (sign) => {
      ctx.fillStyle = UI_COLORS.hatGem;
      ctx.strokeStyle = UI_COLORS.hatInk;
      ctx.lineWidth = Math.max(1.8, r * 0.065);
      ctx.beginPath();
      ctx.moveTo(knotX, 0);
      ctx.bezierCurveTo(knotX + r * 0.14, sign * loopW * 0.45, knotX + r * 0.42, sign * loopW * 0.95, knotX + r * 0.20, sign * loopW);
      ctx.bezierCurveTo(knotX - r * 0.05, sign * loopW * 0.95, knotX - r * 0.12, sign * loopW * 0.45, knotX, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = UI_COLORS.hatPinkDark;
      ctx.beginPath();
      ctx.arc(knotX + r * 0.12, sign * loopW * 0.65, loopH * 0.45, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = UI_COLORS.hatPinkLight;
      ctx.beginPath();
      ctx.ellipse(knotX + r * 0.24, sign * loopW * 0.55, loopH * 0.20, loopW * 0.22, sign * 0.3, 0, Math.PI * 2);
      ctx.fill();
    };
    drawLoop(-1);
    drawLoop(1);

    // Orta Düğüm (Knot)
    ctx.fillStyle = UI_COLORS.hatPinkKnot;
    ctx.strokeStyle = UI_COLORS.hatInk;
    ctx.lineWidth = Math.max(1.6, r * 0.055);
    ctx.beginPath();
    ctx.arc(knotX, 0, knotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = UI_COLORS.hatShine;
    ctx.beginPath();
    ctx.arc(knotX - knotR * 0.25, -knotR * 0.25, knotR * 0.35, 0, Math.PI * 2);
    ctx.fill();

  } else if (id === 'MOHAWK') {
    // ── Siber Punk Neon Dikenleri (Başın sırtı boyunca uzanan ibik) ──
    const spikeBases = [0.28, 0.46, 0.64, 0.82, 0.98];
    const spikeTips  = [0.60, 0.90, 1.24, 1.36, 1.38];
    const spikeWidths = [0.16, 0.21, 0.26, 0.23, 0.18];

    for (let i = 0; i < 5; i++) {
      const bx = spikeBases[i] * r;
      const tx = spikeTips[i] * r;
      const sw = spikeWidths[i] * r;

      ctx.fillStyle = UI_COLORS.hatRed;
      ctx.strokeStyle = UI_COLORS.hatInk;
      ctx.lineWidth = Math.max(1.8, r * 0.06);
      ctx.beginPath();
      ctx.moveTo(bx, -sw);
      ctx.lineTo(tx, 0);
      ctx.lineTo(bx, sw);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Neon alev uçları
      ctx.fillStyle = UI_COLORS.hatYellow;
      ctx.beginPath();
      const midX = bx + (tx - bx) * 0.45;
      ctx.moveTo(midX, -sw * 0.42);
      ctx.lineTo(tx, 0);
      ctx.lineTo(midX, sw * 0.42);
      ctx.closePath();
      ctx.fill();

      // Parlak beyaz vurgu çizgisi
      ctx.strokeStyle = UI_COLORS.hatShine;
      ctx.lineWidth = Math.max(1, r * 0.03);
      ctx.beginPath();
      ctx.moveTo(bx + (tx - bx) * 0.55, 0);
      ctx.lineTo(bx + (tx - bx) * 0.90, 0);
      ctx.stroke();
    }

  } else if (id === 'TOP_HAT') {
    // ── Zarif Silindir Şapka (yüksek gövde + kırmızı şerit) ──
    const brimX = r * 0.52;
    const brimH = r * 0.20;
    const brimW = r * 0.78;
    const topX = r * 1.44;
    const half = r * 0.36;

    ctx.fillStyle = UI_COLORS.hatObsidian;
    ctx.strokeStyle = UI_COLORS.hatInk;
    ctx.lineWidth = Math.max(1.8, r * 0.06);
    // Silindir gövde
    ctx.beginPath();
    ctx.moveTo(brimX - r * 0.06, -half);
    ctx.lineTo(topX, -half);
    ctx.lineTo(topX, half);
    ctx.lineTo(brimX - r * 0.06, half);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Üst kapak elipsi (3D hacim)
    ctx.fillStyle = UI_COLORS.hatInk;
    ctx.beginPath();
    ctx.ellipse(topX, 0, r * 0.13, half, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Kırmızı şerit
    ctx.fillStyle = UI_COLORS.hatGem;
    ctx.beginPath();
    ctx.rect(brimX + r * 0.04, -half, r * 0.14, half * 2);
    ctx.fill();
    // Kenarlık (brim)
    ctx.fillStyle = UI_COLORS.hatObsidian;
    ctx.beginPath();
    ctx.ellipse(brimX - r * 0.06, 0, brimH, brimW, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

  } else if (id === 'CAP') {
    // ── Spor Kasket (kubbe + öne uzanan siper) ──
    const domeX = r * 0.20;
    const domeR = r * 0.80;
    ctx.fillStyle = UI_COLORS.hatSapphire;
    ctx.strokeStyle = UI_COLORS.hatInk;
    ctx.lineWidth = Math.max(1.8, r * 0.06);
    // Kubbe (üst yarı)
    ctx.beginPath();
    ctx.ellipse(domeX, 0, domeR, domeR * 0.92, 0, -Math.PI / 2, Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Siper (gözlerin önüne, -X)
    ctx.beginPath();
    ctx.ellipse(-r * 0.32, 0, r * 0.60, r * 0.40, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Dikiş çizgisi
    ctx.strokeStyle = UI_COLORS.hatHaloGlow;
    ctx.lineWidth = Math.max(1, r * 0.035);
    ctx.beginPath();
    ctx.moveTo(domeX, -domeR * 0.55);
    ctx.quadraticCurveTo(domeX + r * 0.26, 0, domeX, domeR * 0.55);
    ctx.stroke();
    // Tepe düğmesi
    ctx.fillStyle = UI_COLORS.hatSapphire;
    ctx.strokeStyle = UI_COLORS.hatInk;
    ctx.lineWidth = Math.max(1.4, r * 0.05);
    ctx.beginPath();
    ctx.arc(domeX + domeR * 0.55, 0, Math.max(1.8, r * 0.07), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

  } else if (id === 'COWBOY') {
    // ── Kovboy Şapkası (geniş kenar + kıvrık taç) ──
    const brimX = r * 0.40;
    const brimH = r * 0.30;
    const brimW = r * 0.98;
    const crown = r * 0.68;
    ctx.fillStyle = UI_COLORS.hatGoldDark;
    ctx.strokeStyle = UI_COLORS.hatInk;
    ctx.lineWidth = Math.max(1.8, r * 0.06);
    // Geniş kenar
    ctx.beginPath();
    ctx.ellipse(brimX, 0, brimH, brimW, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Taç
    ctx.beginPath();
    ctx.moveTo(brimX - r * 0.05, -crown);
    ctx.lineTo(brimX + r * 0.60, -crown * 0.72);
    ctx.lineTo(brimX + r * 0.64, 0);
    ctx.lineTo(brimX + r * 0.60, crown * 0.72);
    ctx.lineTo(brimX - r * 0.05, crown);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Kemer bandı
    ctx.fillStyle = UI_COLORS.hatRed;
    ctx.beginPath();
    ctx.rect(brimX + r * 0.06, -crown * 0.9, r * 0.12, crown * 1.8);
    ctx.fill();

  } else if (id === 'VIKING') {
    // ── Viking Miğferi (metal kubbe + kıvrık boynuzlar) ──
    const domeX = r * 0.40;
    const domeR = r * 0.60;
    ctx.fillStyle = UI_COLORS.hatMetal;
    ctx.strokeStyle = UI_COLORS.hatInk;
    ctx.lineWidth = Math.max(1.8, r * 0.06);
    ctx.beginPath();
    ctx.ellipse(domeX, 0, domeR * 0.9, domeR, 0, -Math.PI / 2, Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Burun koruyucu (gözlerin arasına inen metal şerit)
    ctx.beginPath();
    ctx.moveTo(domeX - r * 0.08, -r * 0.14);
    ctx.lineTo(-r * 0.18, 0);
    ctx.lineTo(domeX - r * 0.08, r * 0.14);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Boynuzlar
    const drawVikingHorn = (sign) => {
      const rootX = r * 0.42;
      const rootY = sign * r * 0.55;
      ctx.fillStyle = UI_COLORS.hatBone;
      ctx.strokeStyle = UI_COLORS.hatInk;
      ctx.lineWidth = Math.max(1.6, r * 0.05);
      ctx.beginPath();
      ctx.moveTo(rootX, rootY - sign * r * 0.10);
      ctx.quadraticCurveTo(r * 0.85, rootY + sign * r * 0.15, r * 0.96, sign * r * 1.05);
      ctx.quadraticCurveTo(r * 0.68, rootY + sign * r * 0.10, rootX, rootY + sign * r * 0.10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };
    drawVikingHorn(-1);
    drawVikingHorn(1);

  } else if (id === 'HEADBAND') {
    // ── Bandana (alın bandı + arkada uçuşan kuyruklar) ──
    const bandX = r * 0.34;
    ctx.fillStyle = UI_COLORS.hatRed;
    ctx.strokeStyle = UI_COLORS.hatInk;
    ctx.lineWidth = Math.max(1.6, r * 0.05);
    const drawBandTail = (sign) => {
      ctx.beginPath();
      ctx.moveTo(bandX + r * 0.10, sign * r * 0.30);
      ctx.quadraticCurveTo(r * 1.18, sign * r * 0.55, r * 1.32, sign * r * 0.95);
      ctx.quadraticCurveTo(r * 1.02, sign * r * 0.72, bandX + r * 0.10, sign * r * 0.48);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };
    drawBandTail(-1);
    drawBandTail(1);
    // Bant
    ctx.beginPath();
    ctx.ellipse(bandX, 0, r * 0.16, r * 0.66, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Düğüm
    ctx.beginPath();
    ctx.arc(bandX + r * 0.22, 0, Math.max(2, r * 0.12), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

  } else if (id === 'FLOWER') {
    // ── Yanak Çiçeği (başın yanında altı yapraklı çiçek) ──
    const fx = r * 0.74;
    const fy = -r * 0.54;
    const petal = Math.max(2.6, r * 0.15);
    ctx.fillStyle = UI_COLORS.hatPinkLight;
    ctx.strokeStyle = UI_COLORS.hatInk;
    ctx.lineWidth = Math.max(1.2, r * 0.035);
    for (let i = 0; i < 6; i += 1) {
      const a = (i * Math.PI) / 3;
      ctx.beginPath();
      ctx.ellipse(
        fx + Math.cos(a) * petal,
        fy + Math.sin(a) * petal,
        petal * 0.62, petal * 0.42, a, 0, Math.PI * 2,
      );
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = UI_COLORS.hatYellow;
    ctx.beginPath();
    ctx.arc(fx, fy, petal * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

  } else if (id === 'ANTENNA') {
    // ── Böcek Antenleri (iki ince dal + parlayan uçlar) ──
    const drawAntenna = (sign) => {
      const bx = r * 0.52;
      const by = sign * r * 0.28;
      const tx = r * 1.08;
      const ty = sign * r * 0.60;
      ctx.strokeStyle = UI_COLORS.hatInk;
      ctx.lineWidth = Math.max(1.8, r * 0.055);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo((bx + tx) / 2, by + sign * r * 0.28, tx, ty);
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = sign < 0 ? UI_COLORS.hatCyan : UI_COLORS.hatGem;
      ctx.beginPath();
      ctx.arc(tx, ty, Math.max(2.4, r * 0.13), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };
    drawAntenna(-1);
    drawAntenna(1);

  } else if (id === 'BEANIE') {
    // ── Kışlık Bere (kubbeli örgü + kıvrık kenar + pom-pom) ──
    const domeX = r * 0.34;
    const domeR = r * 0.72;
    ctx.fillStyle = UI_COLORS.hatPurple;
    ctx.strokeStyle = UI_COLORS.hatInk;
    ctx.lineWidth = Math.max(1.8, r * 0.06);
    ctx.beginPath();
    ctx.ellipse(domeX, 0, domeR * 0.95, domeR, 0, -Math.PI / 2, Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Kıvrık kenar
    ctx.fillStyle = UI_COLORS.hatPurpleDark;
    ctx.beginPath();
    ctx.ellipse(domeX - r * 0.08, 0, r * 0.15, r * 0.74, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Dikey örgü çizgileri
    ctx.strokeStyle = UI_COLORS.rimLight;
    ctx.lineWidth = Math.max(1, r * 0.03);
    for (const t of [-0.55, -0.18, 0.18, 0.55]) {
      ctx.beginPath();
      ctx.moveTo(domeX - r * 0.02, domeR * t * 0.85);
      ctx.quadraticCurveTo(domeX + domeR * 0.5, domeR * t, domeX - r * 0.02, domeR * t * 0.2);
      ctx.stroke();
    }
    // Pom-pom
    ctx.fillStyle = UI_COLORS.hatShine;
    ctx.strokeStyle = UI_COLORS.hatInk;
    ctx.lineWidth = Math.max(1.4, r * 0.05);
    ctx.beginPath();
    ctx.arc(domeX + domeR * 0.55, 0, Math.max(2.6, r * 0.16), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

  } else if (id === 'CAT_EARS') {
    // ── Kedi Kulakları: baş bandı + iki yana açılan pembe içli üçgen kulaklar ──
    // Baş bandı (kulak diplerini tacın arkasında birleştirir).
    ctx.strokeStyle = UI_COLORS.hatInk;
    ctx.lineWidth = Math.max(2.2, r * 0.14);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.55, -Math.PI * 0.62, Math.PI * 0.62);
    ctx.stroke();
    ctx.strokeStyle = UI_COLORS.hatObsidian;
    ctx.lineWidth = Math.max(1.2, r * 0.09);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.55, -Math.PI * 0.62, Math.PI * 0.62);
    ctx.stroke();

    const drawCatEar = (sign) => {
      // Dış kulak: geniş tabanlı, dışa bakan yuvarlak uçlu üçgen.
      ctx.fillStyle = UI_COLORS.hatObsidian;
      ctx.strokeStyle = UI_COLORS.hatInk;
      ctx.lineWidth = Math.max(1.8, r * 0.06);
      ctx.beginPath();
      ctx.moveTo(r * 0.12, sign * r * 0.36);
      ctx.lineTo(r * 0.70, sign * r * 0.42);
      ctx.quadraticCurveTo(r * 0.64, sign * r * 0.88, r * 0.50, sign * r * 1.16);
      ctx.quadraticCurveTo(r * 0.40, sign * r * 1.24, r * 0.34, sign * r * 1.06);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // İç kulak (pembe üçgen)
      ctx.fillStyle = UI_COLORS.hatPinkDark;
      ctx.beginPath();
      ctx.moveTo(r * 0.28, sign * r * 0.48);
      ctx.lineTo(r * 0.58, sign * r * 0.52);
      ctx.quadraticCurveTo(r * 0.52, sign * r * 0.82, r * 0.44, sign * r * 1.00);
      ctx.quadraticCurveTo(r * 0.38, sign * r * 0.82, r * 0.28, sign * r * 0.48);
      ctx.closePath();
      ctx.fill();
    };
    drawCatEar(-1);
    drawCatEar(1);

  } else if (id === 'BUNNY_EARS') {
    // ── Tavşan Kulakları (pembe içli iki uzun kulak) ──
    const drawBunnyEar = (sign) => {
      const ex = r * 0.86;
      const ey = sign * r * 0.40;
      ctx.save();
      ctx.fillStyle = UI_COLORS.faceWhite;
      ctx.strokeStyle = UI_COLORS.hatInk;
      ctx.lineWidth = Math.max(1.6, r * 0.05);
      ctx.beginPath();
      ctx.ellipse(ex, ey, r * 0.62, r * 0.23, sign * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = UI_COLORS.hatPinkLight;
      ctx.beginPath();
      ctx.ellipse(ex, ey, r * 0.44, r * 0.12, sign * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    drawBunnyEar(-1);
    drawBunnyEar(1);

  } else if (id === 'PIGTAILS') {
    // ── İkiz Topuz (baş arkası saç bandı + iki yandan topuz) ──
    const hairColor = UI_COLORS.hatObsidian;
    ctx.fillStyle = hairColor;
    ctx.strokeStyle = UI_COLORS.hatInk;
    ctx.lineWidth = Math.max(1.8, r * 0.06);
    ctx.beginPath();
    ctx.ellipse(r * 0.30, 0, r * 0.20, r * 0.70, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const drawBun = (sign) => {
      const bx = r * 0.60;
      const by = sign * r * 0.88;
      ctx.fillStyle = hairColor;
      ctx.beginPath();
      ctx.arc(bx, by, r * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = UI_COLORS.hatHaloGlow;
      ctx.beginPath();
      ctx.arc(bx - r * 0.10, by - r * 0.10, r * 0.09, 0, Math.PI * 2);
      ctx.fill();
    };
    drawBun(-1);
    drawBun(1);

  } else if (id === 'PROPELLER') {
    // ── Pervane Şapka (renkli başlık + döner pervane) ──
    const domeX = r * 0.34;
    const domeR = r * 0.70;
    ctx.fillStyle = UI_COLORS.hatCyan;
    ctx.strokeStyle = UI_COLORS.hatInk;
    ctx.lineWidth = Math.max(1.8, r * 0.06);
    ctx.beginPath();
    ctx.ellipse(domeX, 0, domeR * 0.95, domeR, 0, -Math.PI / 2, Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Kırmızı şerit
    ctx.fillStyle = UI_COLORS.hatRed;
    ctx.beginPath();
    ctx.ellipse(domeX - r * 0.06, 0, r * 0.12, domeR, 0, 0, Math.PI * 2);
    ctx.fill();
    // Mil + pervane kanatları
    const hubX = domeX + domeR * 0.95 + r * 0.30;
    ctx.strokeStyle = UI_COLORS.hatInk;
    ctx.lineWidth = Math.max(1.4, r * 0.05);
    ctx.beginPath();
    ctx.moveTo(domeX + domeR * 0.95, 0);
    ctx.lineTo(hubX, 0);
    ctx.stroke();
    ctx.fillStyle = UI_COLORS.hatYellow;
    ctx.beginPath();
    ctx.ellipse(hubX, 0, r * 0.14, r * 0.40, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(hubX, 0, r * 0.40, r * 0.14, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = UI_COLORS.hatShine;
    ctx.beginPath();
    ctx.arc(hubX, 0, r * 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

  } else if (id === 'PIRATE_HAT') {
    // ── Korsan Şapkası (siyah üç köşeli kenar + kurukafa amblemi) ──
    const baseX = r * 0.44;
    const crown = r * 0.60;
    const spread = r * 1.12;
    ctx.fillStyle = UI_COLORS.hatObsidian;
    ctx.strokeStyle = UI_COLORS.hatInk;
    ctx.lineWidth = Math.max(1.8, r * 0.06);
    ctx.beginPath();
    ctx.moveTo(baseX - r * 0.05, -spread);
    ctx.lineTo(r * 1.00, -crown * 0.5);
    ctx.lineTo(r * 1.00, crown * 0.5);
    ctx.lineTo(baseX - r * 0.05, spread);
    ctx.quadraticCurveTo(r * 0.16, 0, baseX - r * 0.05, -spread);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Kurukafa amblemi
    const sx = r * 0.74;
    const sr = Math.max(2.2, r * 0.13);
    ctx.fillStyle = UI_COLORS.hatShine;
    ctx.beginPath();
    ctx.arc(sx, 0, sr, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = UI_COLORS.hatInk;
    ctx.beginPath();
    ctx.arc(sx - sr * 0.34, -sr * 0.12, sr * 0.22, 0, Math.PI * 2);
    ctx.arc(sx + sr * 0.34, -sr * 0.12, sr * 0.22, 0, Math.PI * 2);
    ctx.fill();

  } else if (id === 'GRAD_CAP') {
    // ── Mezuniyet Kepi (kubbeli taban + kare tahta + püskül) ──
    const baseX = r * 0.30;
    const board = r * 0.78;
    ctx.fillStyle = UI_COLORS.hatObsidian;
    ctx.strokeStyle = UI_COLORS.hatInk;
    ctx.lineWidth = Math.max(1.6, r * 0.05);
    // Kubbeli taban (kafaya oturur)
    ctx.beginPath();
    ctx.ellipse(baseX, 0, r * 0.22, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Kare tahta (elmas görünüm)
    ctx.beginPath();
    ctx.moveTo(baseX + r * 0.55, 0);
    ctx.lineTo(baseX + r * 0.10, -board * 0.5);
    ctx.lineTo(baseX - r * 0.55, 0);
    ctx.lineTo(baseX + r * 0.10, board * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Püskül
    const kx = baseX + r * 0.10;
    ctx.fillStyle = UI_COLORS.hatGold;
    ctx.beginPath();
    ctx.arc(kx, 0, Math.max(1.6, r * 0.07), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = UI_COLORS.hatGold;
    ctx.lineWidth = Math.max(1.2, r * 0.04);
    ctx.beginPath();
    ctx.moveTo(kx, 0);
    ctx.quadraticCurveTo(baseX + r * 0.70, r * 0.30, baseX + r * 0.50, board * 0.70);
    ctx.stroke();

  } else if (id === 'SANTA') {
    // ── Noel Şapkası (kıvrık kırmızı külah + pofuduk kenar ve ponpon) ──
    const baseX = r * 0.42;
    const hw = r * 0.52;
    const tipX = r * 1.18;
    const tipY = -r * 0.32;
    ctx.fillStyle = UI_COLORS.hatRed;
    ctx.strokeStyle = UI_COLORS.hatInk;
    ctx.lineWidth = Math.max(1.8, r * 0.06);
    ctx.beginPath();
    ctx.moveTo(baseX, -hw);
    ctx.quadraticCurveTo(r * 0.90, -hw * 0.7, tipX, tipY);
    ctx.quadraticCurveTo(r * 0.95, hw * 0.9, baseX, hw);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Pofuduk beyaz kenar
    const puffR = Math.max(3.4, r * 0.20);
    ctx.fillStyle = UI_COLORS.faceWhite;
    ctx.beginPath();
    ctx.ellipse(baseX - r * 0.02, 0, r * 0.16, hw * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    for (const py of [-hw * 0.75, 0, hw * 0.75]) {
      ctx.beginPath();
      ctx.arc(baseX + r * 0.02, py, puffR * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Ponpon
    ctx.beginPath();
    ctx.arc(tipX, tipY, puffR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

  } else if (id === 'CHEF_HAT') {
    // ── Aşçı Şapkası (alın bandı + pofuduk bulut tepe) ──
    const baseX = r * 0.34;
    const half = r * 0.42;
    const bandH = r * 0.14;
    ctx.fillStyle = UI_COLORS.faceWhite;
    ctx.strokeStyle = UI_COLORS.hatInk;
    ctx.lineWidth = Math.max(1.6, r * 0.05);
    ctx.beginPath();
    ctx.ellipse(baseX, 0, bandH, half, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const cloudR = r * 0.30;
    for (const [cx, cy] of [
      [baseX + r * 0.30, -half * 0.55],
      [baseX + r * 0.50, 0],
      [baseX + r * 0.30, half * 0.55],
      [baseX + r * 0.62, -half * 0.25],
      [baseX + r * 0.62, half * 0.25],
    ]) {
      ctx.beginPath();
      ctx.arc(cx, cy, cloudR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  ctx.restore();
}

