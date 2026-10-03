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
import { drawDioramaContactShadow } from './dioramaKit.js';
import { avatarFlinchOffset } from './fieldFlinch.js';
import { rimHex, getSlotAvatar, getAvatarProfile } from './customizationManager.js';
import { UI_COLORS } from '../ui/tokens.js';

/**
 * Sayı ve sonlu ise değeri, değilse `null`. `getKineticState` kare başına
 * avatar başına birkaç kez çağrıldığı için bu yardımcı modül düzeyindedir;
 * eskiden her çağrıda yerel bir closure üretiyordu (§3).
 */
const finiteOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

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
 * İfade takma adları — MODÜL SEVİYESİNDE sabit. Eskiden `normalizeExpression`
 * her çağrıda bu 20 anahtarlı nesneyi yeniden kuruyordu; çağrı kare başına
 * avatar başına birkaç kez olduğu için mobilde sürekli çöp üretiyordu (§3).
 */
const EXPRESSION_ALIASES = Object.freeze({
  ANGRY: 'ANGRY',
  PANIC: 'PANIC',
  EXCITED: 'WINK',
  DIZZY: 'CYCLOPS',
  ROBOT: 'CYBORG',
  WINK: 'WINK',
  SMIRK: 'GRIN',
  DEAD: 'ZOMBIE',
  NORMAL: 'FOCUS',
  FOCUS: 'FOCUS',
  DERP: 'DERP',
  CYCLOPS: 'CYCLOPS',
  HEART: 'HEART',
  STAR: 'STAR',
  SLEEPY: 'SLEEPY',
  ZOMBIE: 'ZOMBIE',
  GRIN: 'GRIN',
  SHADES: 'SHADES',
  CYBORG: 'CYBORG',
});

/**
 * Normalizes expression alias strings (e.g. 'angry' -> 'ANGRY')
 * @param {string} exp - Input expression
 * @returns {string} Normalized expression
 */
export function normalizeExpression(exp) {
  if (!exp) return 'FOCUS';
  const upper = String(exp).toUpperCase();
  return EXPRESSION_ALIASES[upper] || upper;
}

/**
 * Kinetik girdi normalizasyonu (parity sözleşmesi, Faz 0).
 *
 * Sorun: her motor kendi hareket lehçesini konuşuyordu (`steer` vs `vx/vy`,
 * `dash` vs `dashTimer` vs `isDashing` vs `strikeTimer`), merkezi squash
 * yalnız `player.dashing/vx/vy/recoil` okuduğu için 6 motorda ölüydü.
 * Bu fonksiyon ham player'ı tek KineticState'e indirir; görsel sistem
 * ham alan okumaz.
 *
 * @param {Object} player - Oyuncu varlığı
 * @param {Object} [opts] - Paket/override (world packet alanları buradan gelir)
 * @returns {{ dashing: boolean, tackling: boolean, vx: number|null, vy: number|null, recoil: number }}
 */
export function getKineticState(player, opts = {}) {
  const p = player || {};
  const o = opts || {};

  // Dash: kanonik `dashing` + tüm motor lehçeleri (BOMB dashTimer/isDashing,
  // ZONE dashTimer/isDashing, NINJA strikeTimer, COLLAPSE jumpTimer, paket `dash`/`strike`).
  const dashing = Boolean(
    p.dashing || o.dashing
    || p.isDashing || o.isDashing
    || (finiteOrNull(p.dashTimer) ?? 0) > 0 || (finiteOrNull(o.dashTimer) ?? 0) > 0
    || (finiteOrNull(p.dash) ?? 0) > 0 || (finiteOrNull(o.dash) ?? 0) > 0
    || (finiteOrNull(p.strikeTimer) ?? 0) > 0 || o.strike === true || p.strike === true
    || (finiteOrNull(p.jumpTimer) ?? 0) > 0,
  );

  // Tackle: kanonik `tackling` + `isTackling` (CROWN/HEIST).
  const tackling = Boolean(p.tackling || o.tackling || p.isTackling || o.isTackling);

  // Hız: önce açık vektör, yoksa steer-türevi (idle-güvenli).
  let vx = o.vx ?? p.vx ?? null;
  let vy = o.vy ?? p.vy ?? null;
  if (typeof vx !== 'number' || typeof vy !== 'number'
    || !Number.isFinite(vx) || !Number.isFinite(vy)) {
    vx = null;
    vy = null;
    const sx = finiteOrNull(p.steerX);
    const sy = finiteOrNull(p.steerY);
    const spd = finiteOrNull(p.speed);
    if (sx !== null && sy !== null && spd !== null) {
      vx = sx * spd;
      vy = sy * spd;
    } else if (typeof p.steer === 'number' && spd !== null
      && typeof (p.angle ?? p.heading) === 'number') {
      // SNAKE/CURVE: sürekli ileri hareket, steer yalnız dönüş.
      const a = p.angle ?? p.heading;
      const boost = p.isBoost ? 1.65 : 1;
      vx = Math.cos(a) * spd * boost;
      vy = Math.sin(a) * spd * boost;
    } else if (p.isDriving && spd !== null && typeof p.angle === 'number') {
      // TANKS: sürüşte gövde hızı, boşta sıfır.
      vx = Math.cos(p.angle) * spd;
      vy = Math.sin(p.angle) * spd;
    }
  }

  const recoil = finiteOrNull(o.recoil) ?? finiteOrNull(p.recoil) ?? 0;

  return { dashing, tackling, vx, vy, recoil };
}

/**
 * Kinetik saat: sunum-alanı decay'leri tek kapıdan (ateş recoil'i).
 * Simülasyon saatini yürütmez, yalnız recoil'i söndürür.
 * @param {Object} player - Oyuncu varlığı
 * @param {number} dt - Saniye
 */
export function tickKinetic(player, dt) {
  if (!player || !(dt > 0)) return;
  if (typeof player.recoil === 'number' && player.recoil > 0) {
    player.recoil = Math.max(0, player.recoil - dt * 3.5);
  }
}

/**
 * Karakter kinetik deformasyonunu (Squash & Stretch) hesaplar.
 *
 * Hızlanırken hareket vektörü boyunca uzama (%10-15), darbede/frenlemede
 * basılma, silah geri tepmesinde (recoil) anlık sıkışma üretir.
 * Yalnız aktif kinetik durum varken değer döndürür; dururken 1.0/null
 * döner (sıfır ek yük, sıfır fazladan canvas çağrısı).
 *
 * @param {Object} player - Oyuncu nesnesi
 * @param {Object} [opts] - Seçenekler
 * @returns {{ squashX: number, squashY: number, squashAngle: number | null }}
 */
export function computeAvatarKineticDeformation(player, opts = {}) {
  if (opts.squashX !== undefined || opts.squashY !== undefined) {
    return {
      squashX: opts.squashX ?? 1.0,
      squashY: opts.squashY ?? 1.0,
      squashAngle: opts.squashAngle ?? opts.facingAngle ?? player.facingAngle ?? player.angle ?? 0,
    };
  }

  const facingAngle = opts.facingAngle !== undefined
    ? opts.facingAngle
    : (player.facingAngle ?? player.angle ?? 0);

  const kinetic = getKineticState(player, opts);

  // 1. Dash / Depar: yön boyunca belirgin uzama, yanlardan basılma
  if (kinetic.dashing) {
    return { squashX: 1.18, squashY: 0.85, squashAngle: facingAngle };
  }

  // 2. Tackle / Omuz darbesi: ileri uzama
  if (kinetic.tackling) {
    return { squashX: 1.14, squashY: 0.88, squashAngle: facingAngle };
  }

  // 3. Hız vektöründen türeyen organik akış (açık vx/vy yoksa steer-türevi)
  const vx = kinetic.vx;
  const vy = kinetic.vy;
  if (typeof vx === 'number' && typeof vy === 'number' && (vx !== 0 || vy !== 0)) {
    const spd = Math.hypot(vx, vy);
    if (spd > 35) {
      const factor = Math.min(0.12, (spd / 350) * 0.10);
      const moveAngle = Math.atan2(vy, vx);
      return {
        squashX: 1 + factor,
        squashY: 1 / (1 + factor),
        squashAngle: moveAngle,
      };
    }
  }

  // 4. Silah geri tepmesi (Recoil): ters yöne anlık sıkışma
  const recoil = kinetic.recoil;
  if (typeof recoil === 'number' && recoil > 0.05) {
    const factor = Math.min(0.15, recoil * 0.15);
    return {
      squashX: 1 - factor,
      squashY: 1 + factor,
      squashAngle: facingAngle,
    };
  }

  return { squashX: 1.0, squashY: 1.0, squashAngle: null };
}

// ---------------------------------------------------------------------------
// HIZ İZİ (motion smear)
// ---------------------------------------------------------------------------

/**
 * Hareket hızının gövde yarıçapına oranı — smear eşiği.
 *
 * ÖlçekleMEZ: hem hız hem yarıçap aynı `unit` ile büyüdüğü için oran
 * cihazdan bağımsızdır (AGENTS §3 "ölçekleme" ilkesinin ölçümsüz istisnası).
 * 4.0 gövde/sn = normal koşu; 9.0+ = dash/turbo. Eşiğin altında hiçbir op
 * yazılmaz, yani duran oyuncu ekranda hiçbir iz bırakmaz.
 */
const SMEAR_MIN_RATE = 4.0;
/** Bu oranda iz tam güçte (bir dolu dash). */
const SMEAR_FULL_RATE = 11.0;
/** Aynı anda çizilen hayalet kopya sayısı. */
const SMEAR_COPIES = 3;

/**
 * Hız izi gücü [0,1] — SAF kapı. `getKineticState` ile AYNI hız lehçelerini
 * okur, yani smear motor lehçesinden bağımsızdır (BOMB `dashTimer`, NINJA
 * `strikeTimer`, CROWN `isTackling`… hepsi tek yerden).
 *
 * @param {any} player
 * @param {any} [opts]
 * @returns {number} 0 = eşik altı, (0,1] = tam güç
 */
export function avatarSmearPower(player, opts = {}) {
  const k = getKineticState(player, opts);
  const vx = k.vx;
  const vy = k.vy;
  const r = Number(player?.radius ?? player?.size);
  if (!Number.isFinite(r) || r <= 0) return 0;

  // Hız ORANı. Dash/tackle bayrağı da buraya girer: oyuncu o anda zorunlu
  // olarak hızlıdır ama bazı motorlar (BOMB, NINJA) `vx/vy` yazmayı dash
  // penceresinin tamamında yapmaz. Bayrağı yok saymak o oyunlarda dash'i
  // görünmez kılardı — squash zaten aynı bayrağı okuyor.
  let rate = 0;
  if (Number.isFinite(vx) && Number.isFinite(vy)) rate = Math.hypot(vx, vy) / r;
  if (k.dashing) rate = Math.max(rate, SMEAR_FULL_RATE);
  else if (k.tackling) rate = Math.max(rate, SMEAR_FULL_RATE * 0.8);

  if (rate <= SMEAR_MIN_RATE) return 0;
  const t = Math.min(1, (rate - SMEAR_MIN_RATE) / (SMEAR_FULL_RATE - SMEAR_MIN_RATE));
  return t * t;
}

/**
 * Gövdenin arkasına yönlü hız izi basar — dash/turbo ANINDA okunan tek ipucu.
 *
 * Neden gerekli: squash & stretch gövdeyi ESNETİR ama nereye gittiğini
 * söylemez. Krem zeminde 12 oyunun hiçbirinde kinetik bir hareket izi yoktu;
 * oyuncu "aniden oradaydı" gibi okunuyordu. NINJA'nın afterimage'i bunu
 * kanıtlamıştı zaten (o oyunda çalışıyordu), sadece merkezileştirilmemişti.
 *
 * YÖN HIZ VECTÖRÜDÜR, gövde açısı DEĞİL: strafe eden bir oyuncuda gövde
 * nişana dönük kalır ama hız yana gider — iz gerçek hareketi göstermelidir.
 * Bayrağa dayalı (dash/tackle) durumda hız vektörü yoksa gövde açısına
 * düşülür, çünkü o oyunlarda gövde zaten hareket yönüne dönüktür.
 *
 * SÜREKLİLİK YOKTUR: iz hızdan türetilir ve aynı karede aynı hızdan aynı
 * sonucu verir — yani bir "geçmiş tamponu" DEĞİLDİR. Bu bilinçli: tampon
 * kareler arası state taşırdığı için host↔client aynı görünmezdi (kumanda
 * world-view'ı 30 Hz snapshot ile çiziyor). Türetilmiş iz iki yüzeyde de
 * BİREBİR aynıdır ve pakete tek byte eklemez.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @param {number} power 0..1 — `avatarSmearPower` çıktısı
 * @param {string} color gövde rengi (iz onun soluk kopyasıdır)
 * @param {number|null} angle hareket açısı (radyan) ya da `null`
 */
function drawMotionSmear(ctx, x, y, radius, power, color, angle) {
  if (!(power > 0) || !(radius > 0)) return;
  if (!Number.isFinite(angle)) return;
  // İzin uzunluğu: gövde çapının bir oranı. Ham px değil, gövdeyle birlikte
  // büyür/küçülür.
  const reach = radius * 1.15 * power;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  ctx.save();
  for (let i = 1; i <= SMEAR_COPIES; i += 1) {
    // Kopyalar gövdeden uzaklaştıkça söner ve küçülür — tek bir yönde
    // eriyen çizgi değil, hızın yönünü okutan bir kuyruk.
    const t = i / (SMEAR_COPIES + 1);
    const back = radius * 0.34 * t + reach * t;
    const shrink = 1 - t * 0.22;
    ctx.globalAlpha = power * 0.24 * (1 - t * 0.72);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x - cos * back, y - sin * back, radius * shrink, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Hareket açısı: hız vektörü varsa o, yoksa gövde açısı.
 * @returns {number|null} radyan, ya da yön bilgisi yoksa `null`
 */
function avatarMotionAngle(player, opts) {
  const k = getKineticState(player, opts);
  if (Number.isFinite(k.vx) && Number.isFinite(k.vy) && (k.vx !== 0 || k.vy !== 0)) {
    return Math.atan2(k.vy, k.vx);
  }
  const facing = opts.facingAngle !== undefined ? opts.facingAngle : (player?.facingAngle ?? player?.angle);
  return Number.isFinite(facing) ? facing : null;
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

  const isHit = Boolean(
    opts.hitFlash
    || opts.hit
    || player.hit
    || (typeof player.hitTimer === 'number' && player.hitTimer > 0)
    || (typeof player.flashTimer === 'number' && player.flashTimer > 0)
  );

  const expression = normalizeExpression(
    opts.expression
    || (isHit ? 'PANIC' : null)
    || player.expression
  );

  // Karakter Kinetiği (Squash & Stretch)
  const kinetic = computeAvatarKineticDeformation(player, opts);

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

  // ZEMİN TEMASI — oyuncunun masada DURDUĞUNU okutan katman.
  //
  // Neden burada: `characterRenderer` menusel önizlemeler, koltuk kartları ve
  // kişiselleştirme ekranı da besler; orada bir temas gölgesi yanlış olurdu
  // (karakter bir zemine değil, bir panele oturur). Sahadaki gövde ise aynı
  // panel değildir. Bu yüzden gölge OYUN İÇİ sarmalayıcıda doğar: 12 motorun
  // tamamı `drawGameAvatar` çağırıyor, dolayısıyla motor kodu SIFIR kalır
  // (AGENTS §3/§9) ve iki yüzey (host canvas / kumanda world-view) aynı
  // görünür.
  //
  // ÖLÇEK: her sayı gövde yarıçapının ORANIDIR — ham px yazılmaz (§3). Küre
  // masada `drop` kadar alçalır, gölge orada basılır.
  if (opts.grounded !== false && radius > 0) {
    drawDioramaContactShadow(ctx, x, y, radius * 0.92, radius * 0.3, {
      alpha: 0.62 * (typeof opts.alpha === 'number' ? opts.alpha : 1),
      drop: radius * 0.72 + (opts.groundDrop || 0),
    });
  }

  // HIZ İZİ — gölgenin ÜSTÜNDE, gövdenin ALTINDA. Zemin gölgesi masada kalır,
  // iz havada gövdeyi takip eder; ikisi bu yüzden üst üste binmez.
  if (opts.smear !== false) {
    const smearPower = opts.smearPower ?? avatarSmearPower(player, opts);
    drawMotionSmear(ctx, x, y, radius, smearPower, bodyColor, avatarMotionAngle(player, opts));
  }

  // HASAR OKU — vurulan gövde darbenin geldiği yöne mikro-itilir ve o yönde
  // hafifçe ezilir. Kaynak `fxRuntime.emit('hit'|'slay'|'kill')` → `fieldFlinch`
  // (aynı disiplin: motor kodu sıfır, paket alanı sıfır).
  //
  // Uygulama: itme, gövdeye ÇİZİM KOORDİNATI olarak verilir. Ayrı bir
  // `ctx.translate` + yeniden çizim deseni yerine — `drawBrutalAvatar` zaten
  // `(x, y)` ile konumlanıyor, fazladan save/restore ve ikinci bir gövde
  // geçişi kazandırırdı. Gölge ve hız izi kasıtlı olarak İTİLMEZ: zemin
  // gölgesi masada sabit kalır (yerinden oynamayan gölge doğru), iz ise
  // hareketin kendisine aittir.
  const flinch = opts.flinch === false
    ? null
    : (opts.flinchOffset ?? avatarFlinchOffset(x, y, radius));
  const drawX = x + (flinch ? flinch.x : 0);
  const drawY = y + (flinch ? flinch.y : 0);
  // Darbe yönündeki ezilme kinetik deformasyonla ÇARPILIR (çarpma yönünde
  // basılma). Mevcut kinetik önceliği bozmaz: kuvveti `Math.max` alır.
  const kineticX = flinch ? Math.max(kinetic.squashX, 1 - flinch.squeeze) : kinetic.squashX;
  const kineticY = flinch ? Math.min(kinetic.squashY, 1 + flinch.squeeze) : kinetic.squashY;

  const headwear = opts.headwear !== undefined
    ? opts.headwear
    : (player.headwear
      || player.avatar?.headwear
      || (slotIndex !== null ? getSlotAvatar(slotIndex)?.headwear : null)
      || getAvatarProfile()?.headwear
      || 'NONE');

  drawBrutalAvatar(ctx, drawX, drawY, radius, {
    color: bodyColor,
    slotIndex,
    facingAngle: opts.facingAngle !== undefined ? opts.facingAngle : player.facingAngle || player.angle || 0,
    label: opts.label !== undefined ? opts.label : defaultLabel,
    expression: expression,
    headwear,
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
    // Karakter kinetiği, hasar oku ezilmesi & 1-kare hit flash
    squashX: kineticX,
    squashY: kineticY,
    squashAngle: kinetic.squashAngle,
    hitFlash: isHit,
  });
}
