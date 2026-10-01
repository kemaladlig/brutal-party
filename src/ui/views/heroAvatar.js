// Hero Avatar — ana menünün merkezindeki CANLI karakter.
//
// Brawl Stars'ın menüsündeki tek özne bizim için oyuncu karakterimizdir.
// Sahne çizimi `avatarStage.js` tek kaynağından gelir (gölge, ölçü, DPR
// senkronu, kıvılcımlar); yaşam makinesi (zıplama, nefes, bakış, ifade
// coşkusu, kaide halkası) `avatarLife.js`'tir — atölye kartıyla aynı fizik.
//
// Etkileşim: sahneye dokun → karakter zıplar, yıldız saçar, halka parlar,
// yüzü STAR olur ve dokunulan noktaya bakar. Üzerine gelince merakla izler.
// TV/klavyede `data-focus` + Enter aynı tepkiyi tetikler (focusRouter
// `el.click()` eder; pointerdown→click çift tetikmesi 250 ms pencereyle
// engellenir). Siluet kuralı: tüm tepkiler yuvarlak daireyi KORUR — yalnız
// konum/yeknesak ölçek/yüz değişir (`avatarLife.js` başlığına bkz.).
//
// Döngü görünürlüğe kendi kendini bağlar: her karede `getClientRects()`
// kontrol edilir, sahne dışındayken rAF durur. `IntersectionObserver`
// KULLANILMAZ — `build()` anında düğüm DOM'a eklenmediği için ilk geçiş
// kaçırılabiliyor (bkz. `start()` notu). `prefers-reduced-motion` altında
// zıplama/salınım yok; ifade + kıvılcım geri bildirimi kalır.

import {
  syncStageCanvas, observeStageCanvas, beginStageFrame, drawAvatarStage, drawSparks,
  stageBodyCenter,
} from '../avatarStage.js';
import { createAvatarLife } from '../avatarLife.js';
import { getAvatarProfile } from '../../core/customizationManager.js';
import { prefersReducedMotion } from '../motion.js';
import { playMenuPop } from '../../audio.js';
import { vibrate } from '../../core/haptics.js';

// `pointerdown` doğal olarak `click` üretir; TV/fare çift zıplamasına karşı
// klik yalnız bu pencere dışında tepki üretir.
const POKE_CLICK_DEDUPE_MS = 250;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ onPoke?: () => void }} [options] - `onPoke` ilk dokunuşta bir kez
 *   çağrılır (ana menü "dokun" ipucunu gizlemek için).
 * @returns {() => void} döngüyü ve dinleyicileri kaldıran temizleyici
 */
export function mountHeroAvatar(canvas, { onPoke = null } = {}) {
  if (!canvas) return () => {};
  let raf = 0;
  let stage = syncStageCanvas(canvas);
  let profile = getAvatarProfile();
  let last = performance.now();
  let lastPokeAt = -Infinity;

  const life = createAvatarLife({ preset: 'home', reducedMotion: prefersReducedMotion });

  // Ölçü değiştiğinde hem ölçüyü tazele hem döngüyü UYANDIR. Bu ikisi
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
    const { w, h, r } = stage;
    const out = life.step(now, dt, r, { expression: profile?.expression || 'FOCUS' });
    const ctx = beginStageFrame(canvas);
    drawAvatarStage(ctx, w, h, r, {
      color: profile?.color,
      expression: out.expression,
      facingAngle: out.facingAngle,
      isBlinking: out.isBlinking,
      scale: out.scale,
    }, out.yOffset, out.shadowScale, out.ringPulse);
    drawSparks(ctx, r, out.sparks);
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
  // değilse döngü durur, görünür olunca kendiliğinden devam eder.
  const isVisible = () => canvas.getClientRects().length > 0;

  // ── Etkileşim ──

  // Gövde merkezi canvas merkezinden farklı olabilir (uzun canvas'ta gövde
  // altta, üstte zıplama gökyüzü vardır): bakış ve kıvılcım gövdeyi hedefler.
  const bodyCenter = () => stageBodyCenter(stage.w, stage.h, stage.r);

  const pokeAt = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    lastPokeAt = performance.now();
    const bc = bodyCenter();
    life.poke({
      x: clientX - rect.left,
      y: clientY - rect.top,
      centerX: bc.cx,
      centerY: bc.cy,
      radius: stage.r,
      color: profile?.color,
    });
    playMenuPop();
    vibrate(30);
    onPoke?.();
  };

  const gazeAt = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const bc = bodyCenter();
    life.gaze(Math.atan2(
      clientY - (rect.top + bc.cy),
      clientX - (rect.left + bc.cx),
    ));
  };

  const onPointerDown = (e) => {
    e.stopPropagation();
    pokeAt(e.clientX, e.clientY);
  };
  const onPointerEnter = (e) => {
    life.hover();
    gazeAt(e.clientX, e.clientY);
  };
  const onPointerMove = (e) => gazeAt(e.clientX, e.clientY);
  // TV/kumanda/klavye yolu: focusRouter `el.click()`'i `[data-focus]` TAŞIYAN
  // öğeye (sahne div'i) vurur — olay çocuk canvas'a İNMEZ. Klick dinleyicisi
  // bu yüzden odak host'unda; canvas'taki pointerdown'la çift tepki 250 ms
  // penceresiyle önlendiği gibi, rozetteki tıklamalar da zıplatma üretmez.
  // Genel `button`/`input` koruması: rozete/menüye yeni bir eylem eklense bile
  // sahneye kabarıp karakteri zıplatamaz (karakter araçları da `⋮` menüsüne
  // taşındı — sahneye yüzen düğme kalmadı).
  const focusHost = canvas.parentElement || canvas;
  const onClick = (e) => {
    if (e.target instanceof Element
      && e.target.closest('.scene-badge, button, input')) return;
    if (performance.now() - lastPokeAt < POKE_CLICK_DEDUPE_MS) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const bc = bodyCenter();
    pokeAt(rect.left + bc.cx, rect.top + bc.cy);
  };

  // TV/klavye bakışı: odak bir eyleme taşındığında karakter O eyleme bakar —
  // imleç yokluğunda "bakış takibi"nin karşılığı odak yolcusunun kendisidir.
  // Olay (`shell:focuschange`) kabuk tarafından GÖRÜNÜM kökünde yayılır.
  const onFocusChange = (ev) => {
    const target = ev instanceof CustomEvent ? ev.detail?.el : null;
    if (!(target instanceof Element)) return;
    if (target === canvas || target.contains(canvas) || canvas.contains(target)) return;
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    gazeAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerenter', onPointerEnter, { passive: true });
  canvas.addEventListener('pointermove', onPointerMove, { passive: true });
  focusHost.addEventListener('click', onClick);
  document.addEventListener('shell:focuschange', onFocusChange);

  start();

  // Profil değişince (atölye) rengi/yüzü tazele.
  const onChanged = () => { profile = getAvatarProfile(); };
  window.addEventListener('brutal_customization_changed', onChanged);

  return () => {
    stop();
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointerenter', onPointerEnter);
    canvas.removeEventListener('pointermove', onPointerMove);
    focusHost.removeEventListener('click', onClick);
    document.removeEventListener('shell:focuschange', onFocusChange);
    window.removeEventListener('brutal_customization_changed', onChanged);
  };
}
