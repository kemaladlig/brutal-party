// scripts/measure-surplus.mjs
// Step 4 measurement: exact surplus space (horizontal & vertical margins outside arena)
// across diverse device viewports.

import { computePlayfield } from '../src/core/playfield.js';

const VIEWPORTS = [
  ['TV 16:9', 1920, 1080],
  ['Desktop 16:10', 1440, 900],
  ['Ultrawide 21:9', 2560, 1080],
  ['Tablet 4:3', 1024, 768],
  ['Tablet 16:10 (Anchor)', 1180, 820],
  ['Phone 19.5:9 (Land)', 852, 393],
  ['Phone 16:9 (Land)', 800, 450],
  ['Phone Portrait', 393, 852],
];

console.log('VIEWPORT'.padEnd(24) + 'EKRAN'.padEnd(12) + 'SAHA'.padEnd(14) + 'SOL/SAĞ'.padEnd(10) + 'ÜST/ALT'.padEnd(10) + 'ARTIK YAN ALAN');
console.log('-'.repeat(80));

for (const [name, w, h] of VIEWPORTS) {
  const pf = computePlayfield(w, h, 'standard');
  const sideMargin = Math.round(pf.left);
  const rightMargin = Math.round(w - pf.right);
  const topMargin = Math.round(pf.top);
  const bottomMargin = Math.round(h - pf.bottom);
  const hasSideSurplus = sideMargin >= 80;
  console.log(
    name.padEnd(24)
    + `${w}×${h}`.padEnd(12)
    + `${Math.round(pf.width)}×${Math.round(pf.height)}`.padEnd(14)
    + `${sideMargin}px`.padEnd(10)
    + `${topMargin}px`.padEnd(10)
    + (hasSideSurplus ? `${sideMargin}px (UYGUN)` : 'YOK (<80px)'),
  );
}
