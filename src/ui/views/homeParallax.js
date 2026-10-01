// Home Parallax — ana menü katmanlarına sığ bir derinlik hareketi.
//
// Fare/joy-kumanda imleci sahne üzerinde gezinirken `[data-par]` taşıyan
// katmanlar derinlik katsayısı kadar (px cinsinden) kayar; uzaktaki katman az,
// yakındaki çok hareket eder. Yalnız `translate3d` yazılır (GPU), içerik
// ölçeklenmez. Dokunmatik birincil girdi olduğunda parallax YAPILMAZ — yerde
// kendi kendine sürüklenen aurora/turna hareketi zaten yeter; imleç olmayan
// cihazda uydurma bir salla-tela efekti yoktur.
//
// `prefers-reduced-motion`/`calmMode` altında döngü hiç kurulmaz.

import { prefersReducedMotion } from '../motion.js';

const MAX_SHIFT_X = 14;
const MAX_SHIFT_Y = 10;
const EASE = 0.08;

/**
 * @param {HTMLElement} root - `[data-par]` katmanlarını içeren kapsayıcı
 * @returns {() => void} temizleyici
 */
export function mountHomeParallax(root) {
  if (!root || prefersReducedMotion()) return () => {};
  const layers = /** @type {HTMLElement[]} */ (
    Array.from(root.querySelectorAll('[data-par]'))
  ).map((node) => ({
    node,
    depth: Number.parseFloat(node.dataset.par || '1') || 1,
  }));
  if (!layers.length) return () => {};

  let targetX = 0;
  let targetY = 0;
  let x = 0;
  let y = 0;
  let raf = 0;

  const frame = () => {
    x += (targetX - x) * EASE;
    y += (targetY - y) * EASE;
    const settled = Math.abs(targetX - x) < 0.01 && Math.abs(targetY - y) < 0.01;
    if (settled) { x = targetX; y = targetY; }
    for (const { node, depth } of layers) {
      node.style.transform = `translate3d(${(x * MAX_SHIFT_X * depth).toFixed(2)}px, ${(y * MAX_SHIFT_Y * depth).toFixed(2)}px, 0)`;
    }
    raf = settled ? 0 : requestAnimationFrame(frame);
  };

  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

  // Yalnız imleç girdileri: parmağın kendi kaydırması yetmezmiş gibi bir de
  // katman kaydırmak gürültüdür.
  const onPointer = (ev) => {
    if (ev.pointerType === 'touch') return;
    targetX = (ev.clientX / window.innerWidth) * 2 - 1;
    targetY = (ev.clientY / window.innerHeight) * 2 - 1;
    kick();
  };

  window.addEventListener('pointermove', onPointer, { passive: true });
  return () => {
    window.removeEventListener('pointermove', onPointer);
    if (raf) cancelAnimationFrame(raf);
    for (const { node } of layers) node.style.transform = '';
  };
}
