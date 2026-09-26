// Hero Avatar — ana menünün merkezindeki canlı karakter.
//
// Brawl Stars'ın menüsündeki tek özne bizim için oyuncu karakterimizdir; bu
// yüzden profil kartındaki sahne mantığını yeniden kullanmak yerine küçük ve
// bağımsız bir bileşen yazıyoruz. Sahne çizimi `avatarStage.js` tek kaynağından
// gelir (gölge, ölçü, DPR senkronu); buradaki tek ek iş idle bob + göz kırpma.
//
// Döngü görünürlüğe kendi kendini bağlar: her karede `getClientRects()`
// kontrol edilir, sahne dışındayken rAF durur. `IntersectionObserver` KULLANILMAZ
// — `build()` anında düğüm DOM'a eklenmediği için ilk geçiş kaçırılabiliyor
// (bkz. `start()` notu). `prefers-reduced-motion` altında hareketsiz durur.

import {
  syncStageCanvas, observeStageCanvas, beginStageFrame, drawAvatarStage,
} from '../avatarStage.js';
import { blinkState } from '../../core/avatarInGame.js';
import { getAvatarProfile } from '../../core/customizationManager.js';
import { prefersReducedMotion } from '../motion.js';

const IDLE_PERIOD = 4200;

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {() => void} döngüyü durduran temizleyici
 */
export function mountHeroAvatar(canvas) {
  if (!canvas) return () => {};
  let raf = 0;
  let stage = syncStageCanvas(canvas);
  let profile = getAvatarProfile();
  let last = performance.now();
  let bob = 0;

  // Ölçüm değiştiğinde hem ölçüyü tazele hem döngüyü UYANDIR. Bu ikisi
  // birlikte şart: `build()` anında düğüm DOM'da olmadığı için ilk ölçüm
  // 0'a düşer ve küçük bir avatarla 1×1 bitmap'e çizilir. Düğüm eklendikten
  // sonra `ResizeObserver` gerçek ölçüyü bildirir; o noktada döngü durmuş
  // olabileceği için yeniden başlatılır.
  observeStageCanvas(canvas, () => {
    stage = syncStageCanvas(canvas);
    start();
  });

  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const still = prefersReducedMotion();
    // Periyodik hafif salınım — sahne canlı hissetsin, oyuncu oynamasın.
    bob = still ? 0 : Math.sin(now / 780) * stage.r * 0.035;

    const blink = blinkState(now, 0);
    const { w, h, r } = stage;
    const ctx = beginStageFrame(canvas);
    drawAvatarStage(ctx, w, h, r, {
      color: profile?.color,
      expression: profile?.expression || 'FOCUS',
      facingAngle: Math.sin(now / 1600) * 0.12,
      isBlinking: blink,
    }, -bob);
    ctx.restore();

    // Sahne dışındayken rAF durur; `mountHeroAvatar` yeniden çağrıldığında
    // ya da görünürlük geri döndüğünde `start()` ile devam eder.
    if (!isVisible()) {
      raf = 0;
      return;
    }

    raf = requestAnimationFrame(frame);
  };

  const start = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  const stop = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };

  // Görünürlük kapısı tek mekanizma: döngü KENDİSİ durur.
  //
  // IntersectionObserver burada güvenilir değil: `mountHeroAvatar` view'in
  // `build()` sırasında çağrılıyor, yani düğüm henüz DOM'a eklenmemiş
  // durumda. İlk `isIntersecting` geçişi kabuk `hidden` iken `false` gelirse
  // döngü hiç başlamıyor ve sahne boş kalıyor (belirti: avatar yok).
  // Gözlemci yerine her karede ucuz bir `getClientRects()` kontrolü: görünür
  // değilse döngü durur, görünür olur muzdanan kendiliğinden devam eder.
  const isVisible = () => canvas.getClientRects().length > 0;

  start();

  // Profil değişince (atölye) rengi/yüzü tazele.
  const onChanged = () => { profile = getAvatarProfile(); };
  window.addEventListener('brutal_customization_changed', onChanged);

  return () => {
    stop();
    window.removeEventListener('brutal_customization_changed', onChanged);
  };
}

export { IDLE_PERIOD };
