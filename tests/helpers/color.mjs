// Okunabilirlik ölçümü — PAYLAŞILAN yardımcı (AGENTS.md §4: kopya yok).
//
// İki tüketici var:
//   • `fieldKit.test.mjs`     — zemin rampası ↔ oyuncu renkleri (ΔL* bütçesi)
//   • `obstacleRender.test.mjs` — engel derisi ↔ zemin matı / oyuncu renkleri
//
// Neden yalnız CIE L*: saha içi ayrışma ışık şiddetiyle satın alınıyor. Renk
// farkı ikinci kapıdır (`rgbDistance`) — aynı parlaklıkta ama farklı hue olan
// bir blok oyuncuya karışmaz, o yüzden L* tek başına yanlış alarm üretir.

export function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** `#rrggbb` → CIE L* (0 = siyah, 100 = beyaz). */
export function lstar(hex) {
  const v = parseInt(String(hex).slice(1), 16);
  const Y = 0.2126 * srgbToLinear((v >> 16) & 255)
    + 0.7152 * srgbToLinear((v >> 8) & 255)
    + 0.0722 * srgbToLinear(v & 255);
  return Y > 0.008856 ? 116 * Y ** (1 / 3) - 16 : 903.3 * Y;
}

/** `#rrggbb` → [r, g, b]. */
export function hexToRgb(hex) {
  const v = parseInt(String(hex).slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * İki rengin kanal-uzayı uzaklığı (0–441). Parlaklığı yakın ama tonu ayrı
 * renkleri ayırır — engel derisi ile oyuncu rengi arasındaki kapı budur.
 */
export function rgbDistance(a, b) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}
