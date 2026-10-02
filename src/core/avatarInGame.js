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
import { shade } from './projection2d.js';

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
  const handCol = shade(bodyColor, -0.12);
  // Penguen paleti: gaga ve ayaklar turuncu (oyuncu renginden bağımsız).
  const footCol = UI_COLORS.hudAmber;

  // Kayma/sıçrama: figür merkez çevresinde döner (krom çağıranda kalır).
  if (opts.slipAngle) {
    ctx.translate(center.x, center.y);
    ctx.rotate(opts.slipAngle);
    ctx.translate(-center.x, -center.y);
  }

  // Gövde elipsi — uzuv örtüşmesi de bunun içinde kalır.
  const bw = screenR * 0.94;
  const bh = screenR * 1.06;

  // --- UZUVLAR (yan eksende, bakışa dik) --------------------------------
  // Kol/bacak YAN eksene (`s3` = bakışın 90° yanı) yayılır, bakış yönüne DEĞİL:
  // karşıdan bakışta kollar simetrik sol-sağda, yana bakışta biri önde biri
  // arkada kalır. Eski `f3` yayılımı kolları 360° fırıldak gibi döndürüyordu.
  const s3 = { x: -f3.y, y: f3.x, z: 0 };
  // Kameraya göre yön: +1 tam karşı (güneye bakış), -1 tam arka (kuzeye bakış).
  const faceCam = Math.sin(phi);
  const sideCam = Math.abs(Math.cos(phi));
  // Arkadan bakışta uzuvlar gövdeye toplanır ( silhouette dışına taşmaz ).
  const tuck = 1 - Math.max(0, -faceCam) * 0.45;
  const spread = (lat, z) => ({
    x: x + s3.x * lat * sphereR * tuck,
    y: y + s3.y * lat * sphereR * tuck,
    z,
  });
  const mid3 = (a, b) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  });
  // Gövde elipsine giren mi? `proj` z'yi de lateral ölçekle indirdiği için
  // `screenR` biriminde karşılaştırma anlamlı.
  const insideBody = (p) => {
    const dx = (p.x - center.x) / bw;
    const dy = (p.y - center.y) / bh;
    return dx * dx + dy * dy <= 1;
  };

  const limbSegs = [];
  const pushSeg = (p0, c, p2, color, width, tip) => {
    const m = c ? mid3(c, p2) : mid3(p0, p2);
  limbSegs.push({
      p0, c, p2, color, width, tip,
      behind: camOf({ x: m.x - x, y: m.y - y, z: m.z - ballZ }) < 0 && insideBody(padPt(m)),
    });
  };
  // Kuadratik yayı `PARTS` eşit aralıklı alt-yayına böl. Alt-yay denkliği
  // ANALİTİKTİR (B(a) + (b-a)/2·B'(a) kontrol noktası), yani birleştirilen
  // parçalar özgün eğriyi BİREBİR çizer — yuvarlatma hatası yok. Her parça
  // kendi derinliğiyle sınıflandırıldığı için gövdenin önü/arkası geçişi
  // parça sınırında değil, geçişin olduğu yerde olur.
  const PARTS = 4;
  const pushArc = (p0, c, p2, color, width, tip) => {
    const at = (t) => ({
      x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * c.x + t * t * p2.x,
      y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * c.y + t * t * p2.y,
      z: (1 - t) * (1 - t) * p0.z + 2 * (1 - t) * t * c.z + t * t * p2.z,
    });
    const slopeAt = (t) => ({
      x: 2 * (1 - t) * (c.x - p0.x) + 2 * t * (p2.x - c.x),
      y: 2 * (1 - t) * (c.y - p0.y) + 2 * t * (p2.y - c.y),
      z: 2 * (1 - t) * (c.z - p0.z) + 2 * t * (p2.z - c.z),
    });
    for (let i = 0; i < PARTS; i += 1) {
      const a = i / PARTS;
      const b = (i + 1) / PARTS;
      const A = at(a);
      const D = slopeAt(a);
      pushSeg(
        A,
        { x: A.x + D.x * (b - a) / 2, y: A.y + D.y * (b - a) / 2, z: A.z + D.z * (b - a) / 2 },
        at(b),
        color, width, i === PARTS - 1 ? tip : null,
      );
    }
  };
  // Gövde iki katmana böler: arka uzuvlar altına, öndekiler üstüne. Arka
  // parça AYRI bir renk almaz — yalnız gizlenir. İki sebeple: (1) herhangi bir
  // solukluk/koyuluk ikiliği, geçişin olduğu yerde parça sınırında görünür bir
  // dikiş bırakır (ölçüldü: φ=0'da bacağın 3/4'ü soluk + 1/4'ü dolu); (2) gövde
  // zaten kendi hacim gradyanıyla gölgeli, arkadaki uzuvun gölgesiyle yarışmak
  // onu daha da gürültülü kılardı. Okunurluğu taşıyan şey konum, renk değil.
  const drawSegs = (behind) => {
    ctx.globalAlpha = alpha;
    for (const S of limbSegs) {
      if (S.behind !== behind) continue;
      const p0 = padPt(S.p0);
      const p2 = padPt(S.p2);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      if (S.c) {
        const pc = padPt(S.c);
        ctx.quadraticCurveTo(pc.x, pc.y, p2.x, p2.y);
      } else {
        ctx.lineTo(p2.x, p2.y);
      }
      ctx.strokeStyle = S.color;
      ctx.lineWidth = S.width;
      ctx.lineCap = 'round';
      ctx.stroke();
      if (S.tip === 'foot') {
        // Ayak: küçük turuncu palet (penguen).
        ctx.beginPath();
        ctx.ellipse(p2.x, p2.y + limbW * 0.2, limbW * 0.95, limbW * 0.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = footCol;
        ctx.fill();
        ctx.strokeStyle = UI_COLORS.inkDark;
        ctx.lineWidth = Math.max(1, limbW * 0.2);
        ctx.stroke();
      }
    }
  };

  const footLift = sphereR * 0.30;
  // Adım: bacaklar bakış yönünde (`f3`) öne-arkaya nöbetleşir, kollar ters
  // fazda sallanır — yandan bakışta gerçek yürüme profili okunur.
  const fwdOf = (amount, z) => ({
    x: x + f3.x * amount * sphereR + s3.x * 0,
    y: y + f3.y * amount * sphereR,
    z,
  });
  const addFwd = (p, amount) => ({
    x: p.x + f3.x * amount * sphereR,
    y: p.y + f3.y * amount * sphereR,
    z: p.z,
  });
  for (const side of [-1, 1]) {
    const stepFwd = moving ? side * stride * 0.30 : 0;
    const footZ = moving ? Math.max(0, side * stride) * footLift : 0;
    const hip = spread(side * 0.34, ballZ - sphereR * 0.30 + bob * 0.3);
    const footBase = spread(side * 0.52, footZ);
    const foot = addFwd(footBase, stepFwd);
    pushArc(hip, mid3(hip, foot), foot, shade(bodyColor, -0.12), limbW * 0.8, 'foot');
  }
  for (const side of [-1, 1]) {
    const liftArm = swing * side * sphereR * 0.12;
    // Kollar da hafif öne-arkaya: yürümede karşıt kol-bacak, boşta simetrik.
    const armFwd = moving ? -side * stride * 0.22 : sideCam * side * 0.06;
    const shoulder = addFwd(spread(side * 0.78, ballZ + sphereR * 0.36 + liftArm), armFwd * 0.5);
    const elbow = addFwd(spread(side * 1.06, ballZ + sphereR * 0.02 + liftArm), armFwd);
    const hand = addFwd(spread(side * 0.98, ballZ - sphereR * 0.46 + liftArm), armFwd * 1.2);
    pushArc(shoulder, elbow, hand, handCol, limbW * 1.15, 'hand');
  }

  // Arka uzuvlar gövdenin altında çizilir (gövde onları örter).

  drawSegs(true);

  // --- GÖVDE: PENGUEN SİLUETİ -------------------------------------------
  // Küre yerine dikey oval gövde + karın; hacim gradyan + konturdan gelir.
  // Gövde, kürenin yarıçapıyla AYNI ölçektedir → normal tabanlı göz/uzuv
  // çapaları değişmez; ifade, kol ve bacak sistemi aynen korunur.
  const bodyGrad = ctx.createLinearGradient(center.x, center.y - bh, center.x, center.y + bh);
  bodyGrad.addColorStop(0, shade(bodyColor, 0.20));
  bodyGrad.addColorStop(0.55, bodyColor);
  bodyGrad.addColorStop(1, shade(bodyColor, -0.28));
  ctx.beginPath();
  ctx.ellipse(center.x, center.y, bw, bh, 0, 0, Math.PI * 2);
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.lineWidth = Math.max(2, screenR * 0.08);
  ctx.strokeStyle = shade(bodyColor, -0.45);
  ctx.stroke();

  // Karın (belly): oyuncu renginin açık tonu — kimlik korunur.
  ctx.beginPath();
  ctx.ellipse(center.x, center.y + bh * 0.22, bw * 0.60, bh * 0.58, 0, 0, Math.PI * 2);
  ctx.fillStyle = shade(bodyColor, 0.80);
  ctx.fill();
  ctx.strokeStyle = shade(bodyColor, -0.30);
  ctx.lineWidth = Math.max(1, screenR * 0.035);
  ctx.stroke();

  // Önde kalan uzuvlar gövdenin ÜSTÜNDE çizilir.
  drawSegs(false);
  ctx.lineCap = 'butt';

  // --- YÜZ (yön duyarlı: karşı/yana/profil, arkada gizli) -----------------
  // Karşıdan: iki göz simetrik. Yana: yüz yana kayar, uzak göz ezilir.
  // Arkadan (`faceCam < -0.45`): yüz çizilmez, ense tüyü çizilir.
  const FACE_SHIFT = 0.34;
  const isBackView = faceCam < -0.45;
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

  if (isBackView) {
    // Ense: yüz yok, yalnız arka tüy çizgisi — "arkası dönük" okunur.
    ctx.save();
    ctx.strokeStyle = shade(bodyColor, -0.30);
    ctx.lineWidth = Math.max(1.5, screenR * 0.045);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(center.x - screenR * 0.18, center.y - screenR * 0.25);
    ctx.quadraticCurveTo(center.x, center.y - screenR * 0.45, center.x + screenR * 0.18, center.y - screenR * 0.25);
    ctx.stroke();
    ctx.restore();
  } else if (exp === 'cyclops') {
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

  // GAGA: hacimli koni — taban gölge + turuncu gövde + üst ışık çizgisi.
  // Yana bakışta profile döner, arkadan bakışta gizlenir.
  if (!isBackView) {
    const beakN = pad(fwd, upT, -0.40);
    const bc = spherePt(beakN, -sphereR * 0.06);
    const bwv = Math.max(3.5, screenR * 0.17);
    const sideLean = Math.cos(phi) * sideCam;
    const tipX = bc.x + sideLean * bwv * 0.9;
    const tipY = bc.y + bwv * 1.15;
    // Taban gölge (ağız altı): koniyi zeminden koparır.
    ctx.beginPath();
    ctx.ellipse(bc.x, bc.y + bwv * 0.55, bwv * 1.05, bwv * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(26, 26, 26, 0.22)';
    ctx.fill();
    // Konik gövde.
    const beakGrad = ctx.createLinearGradient(bc.x - bwv, bc.y, bc.x + bwv, tipY);
    beakGrad.addColorStop(0, shade(footCol, 0.25));
    beakGrad.addColorStop(0.5, footCol);
    beakGrad.addColorStop(1, shade(footCol, -0.25));
    ctx.beginPath();
    ctx.moveTo(bc.x - bwv, bc.y - bwv * 0.45);
    ctx.lineTo(bc.x + bwv, bc.y - bwv * 0.45);
    ctx.lineTo(tipX, tipY);
    ctx.closePath();
    ctx.fillStyle = beakGrad;
    ctx.fill();
    ctx.strokeStyle = UI_COLORS.inkDark;
    ctx.lineWidth = Math.max(1, screenR * 0.035);
    ctx.stroke();
    // Üst ışık çizgisi: 2B üçgen hissini kırar.
    ctx.beginPath();
    ctx.moveTo(bc.x - bwv * 0.55, bc.y - bwv * 0.28);
    ctx.lineTo(tipX - sideLean * bwv * 0.2, tipY - bwv * 0.35);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.lineWidth = Math.max(1, screenR * 0.022);
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';
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
