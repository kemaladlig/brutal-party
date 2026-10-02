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
  if (!exp) return 'FOCUS';
  const upper = String(exp).toUpperCase();
  const aliasMap = {
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
  };
  return aliasMap[upper] || upper;
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
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  // Dash: kanonik `dashing` + tüm motor lehçeleri (BOMB dashTimer/isDashing,
  // ZONE dashTimer/isDashing, NINJA strikeTimer, COLLAPSE jumpTimer, paket `dash`/`strike`).
  const dashing = Boolean(
    p.dashing || o.dashing
    || p.isDashing || o.isDashing
    || (num(p.dashTimer) ?? 0) > 0 || (num(o.dashTimer) ?? 0) > 0
    || (num(p.dash) ?? 0) > 0 || (num(o.dash) ?? 0) > 0
    || (num(p.strikeTimer) ?? 0) > 0 || o.strike === true || p.strike === true
    || (num(p.jumpTimer) ?? 0) > 0,
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
    const sx = num(p.steerX);
    const sy = num(p.steerY);
    const spd = num(p.speed);
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

  const recoil = num(o.recoil) ?? num(p.recoil) ?? 0;

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
    // Karakter kinetiği & 1-kare hit flash
    squashX: kinetic.squashX,
    squashY: kinetic.squashY,
    squashAngle: kinetic.squashAngle,
    hitFlash: isHit,
  });
}
