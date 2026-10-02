/**
 * avatarInGame.js — Unified wrapper for drawing character avatars in games.
 * Part of Phase 7 Architecture Refactor.
 *
 * OYUN İÇİ AVATAR SÖZLEŞMESİ
 * Sahadaki karakter dekor değil, birimdir. Buradan geçen her avatar:
 *   - düz renk + seçilebilir halka + disk İÇİ hacim (sol üst ışık / sağ alt gölge)
 *   - büyütülmüş gözler, oyun durumundan gelen yüz ifadesi
 *   - koltuk fazına kaydırılmış göz kırpma
 *   - ASLA aksesuar / gövde deseni taşımaz
 * Aksesuar ve desen yalnız `drawBrutalAvatar`'ın doğrudan çağıranlarında
 * (lobi koltuk kartı, kişiselleştirme, kumanda önizlemesi) yaşar.
 */

import { drawBrutalAvatar } from '../ui/characterRenderer.js';
import { rimHex } from './customizationManager.js';
import { UI_COLORS } from '../ui/tokens.js';
import { materialFromColor, shade } from './projection2d.js';

/**
 * Gövde rengin krem sahada (L* ~94) okunması için: açık gövde renginde
 * çerçeve daima koyuya çekilir. P3 (SARI #D84727 üstü) gövdesi 1.19:1 ile
 * kayboluyordu; çerçeve rengi zaten koyuydysa sorun yok. Görünürlük eşiği
 * WCAG grafik ~3:1'den gevşek tutulur: gövde-çerçeve kararının amacı
 * "siluet tanınsın", çerçeve krem zemine karşı ayrışıyor zaten.
 */
function relativeLuminance(hex) {
  const s = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  const chan = (h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(s.slice(0, 2)) + 0.7152 * chan(s.slice(2, 4)) + 0.0722 * chan(s.slice(4, 6));
}

/** Açık gövdeye her zaman koyu çerçeve: `#FFFFFF` çerçeve krem zeminde 1.10:1. */
function darkFrameForLightBody(bodyColor) {
  const L = relativeLuminance(bodyColor);
  if (L === null) return false;
  // L* ~0.82'e (ör. #F4F2E8 0.89) kadar açık gövde: zıt koyu çerçeve şart.
  return L >= 0.6;
}

/**
 * Göz kırpma ritmi. Menü önizlemesinden (sabit 3.2s) ayrı: oyun içi hızlı ve
 * kısa — sahada uzun kapalı göz, oyuncunun "baktı mı" sorusunu uzatıyordu.
 * Süreler `drawBrutalAvatar`'ın opt-in `blinkProgress` değerine gider; yüz
 * dalları yalnız `> 0.5`'e baktığı için 0/1 durumları yeterli.
 */
const BLINK_PERIOD_MS = 2600;
const BLINK_CLOSED_MS = 110;

/**
 * Belirli bir koltuk için kırpma durumu.
 * @param {number} now - performance.now() tabanlı zaman (ms)
 * @param {number} slotIndex - Koltuk (faz kaydırması için)
 * @returns {number} 0 = açık, 1 = kapalı
 */
export function blinkState(now, slotIndex = 0) {
  if (!Number.isFinite(now)) return 0;
  // Koltuk başına 0.31 ofset: dört oyuncu asla senkr kırpmıyor, "bütün saha
  // birden kırpıp kırpmıyor" gibi mekanik bir görüntü oluşuyordu.
  const phase = ((now / 1000 + slotIndex * 0.31) % (BLINK_PERIOD_MS / 1000)) / (BLINK_PERIOD_MS / 1000);
  return phase > 1 - (BLINK_CLOSED_MS / BLINK_PERIOD_MS) ? 1 : 0;
}

/**
 * Normalizes expression alias strings (e.g. 'angry' -> 'ANGRY')
 * @param {string} exp - Input expression
 * @returns {string} Normalized expression
 */
export function normalizeExpression(exp) {
  if (!exp) return 'NORMAL';
  const upper = exp.toUpperCase();
  const aliasMap = {
    ANGRY: 'ANGRY',
    PANIC: 'PANIC',
    EXCITED: 'EXCITED',
    DIZZY: 'DIZZY',
    WINK: 'WINK',
    SMIRK: 'SMIRK',
    DEAD: 'DEAD',
    NORMAL: 'NORMAL',
  };
  return aliasMap[upper] || upper;
}

/**
 * Draws character avatar for in-game entities.
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} x - Center X
 * @param {number} y - Center Y
 * @param {number} radius - Avatar radius
 * @param {Object} player - Player entity object
 * @param {Object} [opts] - Overrides and rendering options
 */
export function drawGameAvatar(ctx, x, y, radius, player, opts = {}) {
  const defaultNames = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'];
  const isDefaultName = !player.name || defaultNames.some((d) => player.name.startsWith(d));
  const customName = (player.name && !isDefaultName)
    ? ` • ${player.name.slice(0, 6)}`
    : '';
  const slotIndex = player.index !== undefined ? player.index : 0;
  const defaultLabel = `P${slotIndex + 1}${customName}`;

  const expression = normalizeExpression(opts.expression || player.expression);

  // Avatar kromu yarıçapla ölçeklenir. Sabit 3px çerçeve, masaüstündeki 36px
  // bir avatarın yarıçapının %8'i iken telefondaki 12px avatarın %25'idir —
  // yani küçük ekranda varlığın silueti kromla yiyordu, "iri ve bulanık"
  // hissi tam olarak buradan geliyordu. `radius * 0.12` her boyutta aynı görsel
  // oranı verir; taban, çok küçük avatarın çerçevesiz kaybolmaması için.
  const borderWidth = opts.borderWidth
    ?? Math.max(1.2, Number(radius) * 0.12);

  // Açık gövde renginde çerçeveyi koyuya sabitle. Tür sinyal fonksiyonları
  // (tackle/dash vurgusu) çerçeveyi bilerek AÇIK renge çekebilir (`opts.borderColor`).
  // O çağrılar OPTS.ILE geldiğinden önceliği korur; açık gövde kuralı yalnız
  // çerçevesiz/fallback yola dokunur. Açık gövde + açık çerçeve (11:1'lik
  // fail) böylece sadece bilinçli vurguda yaşar.
  const bodyColor = opts.color || player.color;
  const forceDark = darkFrameForLightBody(bodyColor);
  const darkFrame = UI_COLORS.inkDark;
  const resolvedBorder = opts.borderColor
    || (forceDark ? darkFrame
      : (player.rimColor
        || rimHex(player.avatar?.rim, null)
        || rimHex(opts.avatar?.rim, null)
        || darkFrame));

  drawBrutalAvatar(ctx, x, y, radius, {
    color: bodyColor,
    slotIndex,
    facingAngle: opts.facingAngle !== undefined ? opts.facingAngle : player.facingAngle || player.angle || 0,
    label: opts.label !== undefined ? opts.label : defaultLabel,
    expression: expression,
    // Saha içi kip: dekor katmanları kapalı, gözler büyük, disk içi hacim var.
    faceMode: 'play',
    lookAngle: opts.lookAngle,
    // `now` view/oyun tarafından verilir; yoksa kırpma donuk kalır (deterministik
    // test/harness yolu zaman bağımlı olmaz).
    blinkProgress: opts.isBlinking ? 1 : blinkState(opts.now, slotIndex),
    showPointer: opts.showPointer !== undefined ? opts.showPointer : true,
    borderColor: resolvedBorder,
    borderWidth,
    // 3.3 okunurluk kademesi: çağıran `fxReadAlpha` ile hesapladığı α'yı geçirir;
    // drawBrutalAvatar bunu ctx.globalAlpha ile ÇARPAR (kendi başına dim uydurmaz).
    alpha: opts.alpha,
    // Yüz-yalnız: gövde diski/konturu çizilmez (2.5D küre avatarı çağırır).
    faceOnly: opts.faceOnly,
  });
}

/**
 * 2.5D eğik sahne avatarı: "oyuncak topu" — karakter TEK bir projekte KÜRE.
 * Merkezi yerde durur (z = yarıçap); küre hacmi + projekte temas gölgesi
 * karakteri zemine oturtur.
 *
 * HER ŞEY 3B ÇAPALI: gözler kürenin baktığı yönüne, kollar/ayaklar ise yerel
 * eksenlerdeki (f = bakış, s = sağ yan, u = yukarı) 3B noktalara çapalanır ve
 * mevcut kamerayla projekte edilir. Böylece top yana dönerken uzak göz/uzuv
 * küçülür ve arkada kalır, çaprazda gözler birbirine yaklaşır, ön-arka sırası
 * gerçek derinlikten gelir. Ekran-uzayı "açı hilesi" yoktur.
 *
 * Uzuvlar TEK EKLEMLİ: omuz→dirsek→pati ve kalça→diz→ayak; `player.vx/vy`
 * hızıyla nöbetleşe adımlar, küre de adım ritminde hafifçe seker. Yüz ifadeleri
 * (focus/derp-çılgın/cyclops-tepegöz/angry/wink) 3B göz geometrisiyle çizilir.
 * Yaklaşık-tepeden bakışta uzuv okunurluğu kamera eğimine bağlıdır (bkz. AGENTS §4).
 *
 * Yalnız 2.5D yol (BOMB, host + ONLINE client) çağırır; diğer oyunlar
 * `drawGameAvatar` ile düz yolda kalır. Krom (halkalar, bomba rozeti) çağıranın
 * işidir; dönen metrikler oradan konumlanır (tek parça olduğu için `torso*` ve
 * `head*` aynı küre merkezini/yarıçapını verir).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} proj - `core/projection2d.createProjector()` örneği
 * @param {Object} player - Player entity (renk/yüz/koltuk alanları)
 * @param {Object} [opts] - `{ x, y, radius, ...drawGameAvatar opts, slipAngle }`
 * @returns {{headX:number, headY:number, headR:number, torsoX:number, torsoY:number, torsoR:number, topY:number, k:number}}
 */
export function drawGameAvatar25d(ctx, proj, player, opts = {}) {
  const r = Number(opts.radius) || 36;
  const x = Number(opts.x) || 0;
  const y = Number(opts.y) || 0;
  const bodyColor = opts.color || player.color || UI_COLORS.inkDark;

  // Tek küre: yarıçapı çarpışma yarıçapına çok yakın; merkez z = yarıçap.
  const sphereR = r * 0.95;
  const ground = proj.proj(x, y, 0);
  const k = proj.view.scale * ground.d;
  const screenR = sphereR * k;

  // Yürüme fazı: hız varsa adımlar nöbetleşir, küre hafifçe seker.
  const nowMs = Number(opts.now) || 0;
  const moving = Math.hypot(Number(player.vx) || 0, Number(player.vy) || 0) > 0.5;
  const phase = (nowMs / 1000) * 9;
  const bob = moving ? Math.abs(Math.sin(phase)) * screenR * 0.10 : 0;
  const ballZ = sphereR + bob;
  const center = proj.proj(x, y, ballZ);

  // --- 3B çapa çerçevesi -------------------------------------------------
  // Karakter küresinin yerel eksenleri: f = baktığı yön (yatay), u = dünya
  // yukarısı. Yüz ve (kamera) eksenine oturan gözler bu 3B yönlere çapalanır;
  // kamera yönü `nCam` projeksiyonun derinlik eksenidir.
  const phi = Number(opts.facingAngle) || 0;
  const f3 = { x: Math.cos(phi), y: Math.sin(phi), z: 0 };
  const u3 = { x: 0, y: 0, z: 1 };
  // Kameraya doğru birim vektör (projeksiyonda derinlik ekseni = (0, 1, 1)).
  const TC = Math.SQRT1_2;
  const nCam = { x: 0, y: TC, z: TC };
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const norm3 = (px, py, pz) => {
    const m = Math.hypot(px, py, pz) || 1;
    return { x: px / m, y: py / m, z: pz / m };
  };
  const camOf = (n) => n.y * TC + n.z * TC;
  const tangentAt = (n, ref) => {
    const d = dot(n, ref);
    return norm3(ref.x - n.x * d, ref.y - n.y * d, ref.z - n.z * d);
  };
  const pad = (n, ref, amount) => norm3(
    n.x + ref.x * amount, n.y + ref.y * amount, n.z + ref.z * amount,
  );
  const worldOf = (n, extra = 0) => {
    const rad = sphereR + extra;
    return { x: x + rad * n.x, y: y + rad * n.y, z: ballZ + rad * n.z };
  };
  const padPt = (p) => proj.proj(p.x, p.y, p.z);
  const spherePt = (n, extra = 0) => padPt(worldOf(n, extra));

  const alpha = opts.alpha === undefined ? 1 : Number(opts.alpha);
  ctx.save();
  ctx.globalAlpha = alpha;

  // Zemine oturma gölgesi: ışık sol-üstten → gölge güney-doğuya kayar/kısalır.
  proj.contactPatch(ctx, x + r * 0.16, y + r * 0.12, r * 1.0, r * 0.62, 0.30);

  const slot = player.index ?? player.slot ?? 0;
  const stride = moving ? Math.sin(phase) : 0;
  const idle = Math.sin((nowMs / 1000) * 2 + slot) * 0.3;
  const swing = moving ? stride : idle;
  const limbW = Math.max(3, screenR * 0.22);
  const handCol = shade(bodyColor, -0.10);
  const footCol = shade(bodyColor, -0.22);

  // Kayma/sıçrama: figür merkez çevresinde döner (krom çağıranda kalır).
  if (opts.slipAngle) {
    ctx.translate(center.x, center.y);
    ctx.rotate(opts.slipAngle);
    ctx.translate(-center.x, -center.y);
  }

  // --- UZUVLAR (tek parça, ekran eksenine çapalı) ------------------------
  // Uzuvlar gövde eksenine değil EKRAN eksenine çapalanır: top hangi yöne
  // dönerse dönsün kollar/ayaklar daima görsel yanlarda kalır. Böylece yan
  // görünüşte uzuv kameraya doğru uzanıp "aşağı sarkmaz".
  // Kol: kalın, hafif dışa bükümlü tek parça; el ucu yuvarlak kapak (palet yok).
  // Bacak: boru gibi kalın tek parça; ucu yuvarlak (basit ayak, palet yok).
  const footLift = sphereR * 0.30;
  const legGeom = (side) => ({
    hip: { x: x + side * sphereR * 0.34, y: y, z: ballZ - sphereR * 0.30 + bob * 0.3 },
    foot: {
      x: x + side * sphereR * 0.56,
      y: y,
      z: moving ? Math.max(0, side * stride) * footLift : 0,
    },
  });
  const drawLeg = (L) => {
    const ph = padPt(L.hip);
    const pf = padPt(L.foot);
    ctx.beginPath();
    ctx.moveTo(ph.x, ph.y);
    ctx.lineTo(pf.x, pf.y);
    ctx.strokeStyle = footCol;
    ctx.lineWidth = limbW * 1.1;
    ctx.lineCap = 'round';
    ctx.stroke();
  };
  const legs = [legGeom(-1), legGeom(1)];

  const armGeom = (side) => {
    const liftArm = swing * side * sphereR * 0.12;
    return {
      shoulder: { x: x + side * sphereR * 0.78, y: y, z: ballZ + sphereR * 0.36 + liftArm },
      mid: { x: x + side * sphereR * 1.06, y: y, z: ballZ + sphereR * 0.02 + liftArm },
      hand: { x: x + side * sphereR * 0.98, y: y, z: ballZ - sphereR * 0.46 + liftArm },
    };
  };
  const drawArm = (A) => {
    const ps = padPt(A.shoulder);
    const pm = padPt(A.mid);
    const ph = padPt(A.hand);
    ctx.beginPath();
    ctx.moveTo(ps.x, ps.y);
    ctx.quadraticCurveTo(pm.x, pm.y, ph.x, ph.y);
    ctx.strokeStyle = handCol;
    ctx.lineWidth = limbW * 1.15;
    ctx.lineCap = 'round';
    ctx.stroke();
  };
  const arms = [armGeom(-1), armGeom(1)];

  // Bacaklar kürenin arkasında, kollar önünde.
  for (const L of legs) drawLeg(L);

  proj.drawSphere(ctx, x, y, ballZ, sphereR, materialFromColor(bodyColor));

  for (const A of arms) drawArm(A);
  ctx.lineCap = 'butt';

  // --- YÜZ (kameraya oturan gözler + hafif yön eğilimi) -------------------
  // Referans gibi yüz DAİMA kameraya bakar (yoksa tepeden bakışta topun
  // kenarına/arkasına kaçar). Bakış yönü yalnızca yüzü hafifçe iter ve göz
  // bebeğini çevirir; gözler ekran-yatayında kalır, böylece her açıda okunur.
  const FACE_SHIFT = 0.20;
  const eyeFrac = 0.30;
  const eyeScreen = screenR * eyeFrac;
  const tH = { x: 1, y: 0, z: 0 };
  const tDown = tangentAt(nCam, { x: 0, y: 1, z: 0 });
  const shift = {
    x: (f3.x * tH.x + f3.y * tDown.x) * FACE_SHIFT,
    y: (f3.x * tH.y + f3.y * tDown.y) * FACE_SHIFT,
    z: (f3.x * tH.z + f3.y * tDown.z) * FACE_SHIFT,
  };
  const fwd = norm3(nCam.x + shift.x, nCam.y + shift.y, nCam.z + shift.z);
  const right = tangentAt(fwd, tH);
  const upT = tangentAt(fwd, u3);

  const eyeFrame = (n, es) => {
    const c = spherePt(n);
    const bR = tangentAt(n, right);
    const pR = padPt(worldOf(pad(n, bR, 0.10)));
    const squash = Math.max(0.26, Math.min(1, camOf(n)));
    const rx = es * squash;
    const ry = es;
    const rot = Math.atan2(pR.y - c.y, pR.x - c.x);
    const lt = Math.abs(dot(n, f3)) > 0.97 ? upT : tangentAt(n, f3);
    const pL = padPt(worldOf(pad(n, lt, 0.10)));
    const lookAng = Math.atan2(pL.y - c.y, pL.x - c.x);
    return { c, rx, ry, face: camOf(n), rot, lookAng };
  };

  const drawEye = (n, o = {}) => {
    const fr = eyeFrame(n, eyeScreen * (o.size ?? 1));
    if (fr.face <= 0.02 || fr.rx < 0.6 || fr.ry < 0.6) return;
    const thin = Math.max(1, Math.min(fr.rx, fr.ry) * 0.20);
    ctx.save();
    ctx.translate(fr.c.x, fr.c.y);
    ctx.rotate(fr.rot);
    if (o.arc) {
      ctx.beginPath();
      ctx.arc(0, fr.ry * 0.35, fr.rx * 0.85, Math.PI * 1.08, Math.PI * 1.92);
      ctx.strokeStyle = UI_COLORS.inkDark;
      ctx.lineWidth = Math.max(1.6, thin * 1.3);
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.beginPath();
    ctx.ellipse(0, 0, fr.rx, fr.ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = UI_COLORS.white;
    ctx.fill();
    ctx.strokeStyle = UI_COLORS.inkDark;
    ctx.lineWidth = thin;
    ctx.stroke();
    if (o.closed) {
      ctx.beginPath();
      ctx.moveTo(-fr.rx * 0.82, 0);
      ctx.lineTo(fr.rx * 0.82, 0);
      ctx.strokeStyle = UI_COLORS.inkDark;
      ctx.lineWidth = Math.max(1.4, thin * 1.2);
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
      return;
    }
    const local = fr.lookAng - fr.rot;
    const off = Math.min(fr.rx, fr.ry) * 0.30;
    const px = Math.cos(local) * off;
    const py = Math.sin(local) * off;
    const pr = Math.min(fr.rx, fr.ry) * (o.pupil ?? 0.5);
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fillStyle = UI_COLORS.inkDark;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px - pr * 0.35, py - pr * 0.4, pr * 0.34, 0, Math.PI * 2);
    ctx.fillStyle = UI_COLORS.white;
    ctx.fill();
    if (o.brow) {
      ctx.beginPath();
      ctx.moveTo(-fr.rx * 0.9, -fr.ry - fr.ry * 0.55);
      ctx.lineTo(fr.rx * 0.9, -fr.ry - fr.ry * 0.05);
      ctx.strokeStyle = UI_COLORS.inkDark;
      ctx.lineWidth = Math.max(1.6, thin * 1.3);
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    ctx.restore();
  };

  const expRaw = String(opts.expression || player.expression || 'focus').toLowerCase();
  const exp = expRaw === 'panic' ? 'derp'
    : expRaw === 'dizzy' ? 'cyclops'
      : expRaw === 'angry' ? 'angry'
        : (expRaw === 'wink' || expRaw === 'excited') ? 'wink'
          : 'focus';
  const closed = opts.isBlinking === true || blinkState(nowMs, slot) > 0.5;
  const eyeL = pad(fwd, right, -0.38);
  const eyeR = pad(fwd, right, 0.38);

  if (exp === 'cyclops') {
    drawEye(fwd, { pupil: 0.46, closed, size: 1.4 });
  } else if (exp === 'derp') {
    drawEye(eyeL, { pupil: 0.44, closed, size: 1.1 });
    drawEye(eyeR, { pupil: 0.44, closed, size: 0.72 });
  } else if (exp === 'angry') {
    drawEye(eyeL, { pupil: 0.5, closed, brow: true });
    drawEye(eyeR, { pupil: 0.5, closed, brow: true });
  } else if (exp === 'wink') {
    drawEye(eyeL, { pupil: 0.48, closed, size: 1.05 });
    drawEye(eyeR, { arc: true });
  } else {
    drawEye(eyeL, { pupil: 0.5, closed });
    drawEye(eyeR, { pupil: 0.5, closed });
  }

  ctx.restore();

  return {
    headX: center.x,
    headY: center.y,
    headR: screenR,
    torsoX: center.x,
    torsoY: center.y,
    torsoR: screenR,
    topY: center.y - screenR,
    k: proj.view.scale * center.d,
  };
}
