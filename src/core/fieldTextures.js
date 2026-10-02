// 2.5D yüzey dokuları — saf SUNUM katmanı.
//
// Ağ paketine hiçbir alan eklemez; host ve ONLINE client aynı origin'den
// (`/assets/textures/*.webp`) yükler. Yüklenene kadar çağıran prosedürel dokuya
// düşer (`fieldTexture` null döner) — pop/donma olmaz.
//
// NODE TESTLERİ: `fieldKit`/`projection2d` bu modülü import eder ama `Image`
// yoktur; `loadFieldTextures` yalnız tarayıcıda (main.js) çağrılır, o yüzden
// `fieldTexture` testlerde her zaman null → prosedürel yol denenir.
//
// LİSANS: dosyalar ambientCG (CC0) türevidir; ayrıntı `public/assets/textures/CREDITS.md`.

const SOURCES = {
  wood: '/assets/textures/wood.webp',
  felt: '/assets/textures/felt.webp',
  grass: '/assets/textures/grass.webp',
  stone: '/assets/textures/stone.webp',
  metal: '/assets/textures/metal.webp',
};

/** @type {Record<string, HTMLImageElement>} */
const images = {};
/** @type {Record<string, boolean>} */
const ready = {};
let started = false;
// Doku yüklenince artar; çağıranlar (ör. 2.5D zemin bake'i) bunu cache anahtarına
// katarak dokusuz pişmiş katmanı otomatik geçersiz kılar.
let generation = 0;

/** Uygulama başında bir kez çağrılır (main.js). */
export function loadFieldTextures() {
  if (started || typeof Image === 'undefined') return;
  started = true;
  for (const name of Object.keys(SOURCES)) {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { ready[name] = true; generation += 1; };
    img.onerror = () => { ready[name] = false; generation += 1; };
    img.src = SOURCES[name];
    images[name] = img;
  }
}

/**
 * Yüklendiyse görüntü, aksi halde null (çağıran prosedürel yola düşer).
 * @param {string} name
 * @returns {HTMLImageElement|null}
 */
export function fieldTexture(name) {
  return ready[name] ? images[name] : null;
}

/** Yükleme nesli: bir doku yüklenince/başarısız olunca artar. */
export function fieldTextureGeneration() {
  return generation;
}
