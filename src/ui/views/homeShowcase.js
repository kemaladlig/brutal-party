// Home Showcase — ana menünün canlı vitrini: ufuk boyunca kayan oyun kapakları
// (marquee) + sağ kolondaki FEATURED kart. Tek gerçek VİTRİN İNDEKSİDİR: şerit
// hangi kapağı merkeze bakıyorsa featured kart onu gösterir; iki yüzey ayrı
// durum tutmaz (kaydırma, otomatik dönüş ve dokunma hepsi aynı indeksi besler).
//
// Kapaklar GERÇEK içeriktir (`CARTRIDGES` + `gameArtPath`) — uydurma veri yok.
// Otomatik dönüş `prefers-reduced-motion`/`calmMode` altında susar; şerit yine
// kaydırılabilir ve kapağa dokunmak o oyunla sahaya geçirir (`onLaunch`).
//
// Kaydırma tek mekanizmadır: şerit NATİF bir yatay kaydırıcıdır (`overflow-x`).
// Odak yolcusu (`focusRouter`) `data-h-track` sayesinde odaklanan kapağı kendisi
// merkezler — burada ikinci bir kaydırma motoru yazılmaz.

import { GAME_ORDER, CARTRIDGES, gameArtPath } from '../../core/engineRegistry.js';
import { prefersReducedMotion } from '../motion.js';
import { playMenuPop } from '../../audio.js';

const AUTO_MS = 4800;          // Featured'ın kendiliğinden diğer kapağa geçmesi.
const INTERACT_HOLD_MS = 9000; // Kullanıcı dokunduktan sonra dönüşün susma süresi.

/**
 * @param {{
 *   strip: HTMLElement,
 *   resumeId?: string|null,
 *   onFeatured?: (mode: string) => void,
 *   onLaunch?: (mode: string) => void,
 * }} opts
 * @returns {() => void} temizleyici
 */
export function mountHomeShowcase({ strip, resumeId = null, onFeatured = null, onLaunch = null }) {
  const ids = GAME_ORDER.filter((id) => CARTRIDGES[id]);
  if (!strip || !ids.length) return () => {};

  const items = new Map();
  const frag = document.createDocumentFragment();
  for (const id of ids) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'home-marquee-item';
    btn.dataset.focus = 'act';
    btn.tabIndex = -1;
    btn.dataset.mode = id;
    btn.setAttribute('aria-label', CARTRIDGES[id].title);
    btn.innerHTML = `<img class="home-marquee-art" src="${gameArtPath(id)}" alt="" loading="lazy" decoding="async" />`;
    items.set(id, btn);
    frag.append(btn);
  }
  strip.append(frag);

  const reduced = prefersReducedMotion();
  // Dikkat noktası: CSS'ten (`--mq-focus`) okunur — odak oranı, şerit boşlukları
  // ve şeridin HUD'dan kaçış mesafesi home.css'te aynı breakpoint'lerde yaşadığı
  // için iki kaynak birlikte sürüklenir (telefon yatay: kahraman ortada → .74;
  // tablet: FEATURED kart sağda → .86; geniş ekran ≈ merkez). Önbellek resize'da
  // düşer; cihaz dönerse sonraki çağrıda yeniden ölçülür.
  let ratioCache = 0;
  const focusRatio = () => {
    if (!ratioCache) {
      ratioCache = parseFloat(getComputedStyle(strip).getPropertyValue('--mq-focus')) || 0.5;
    }
    return ratioCache;
  };
  const onResize = () => { ratioCache = 0; };
  window.addEventListener('resize', onResize, { passive: true });
  let current = '';
  let holdUntil = 0;
  let scrollRaf = 0;
  let timer = 0;

  const setFeatured = (id) => {
    if (!id || id === current) return;
    items.get(current)?.classList.remove('is-featured');
    current = id;
    items.get(id)?.classList.add('is-featured');
    onFeatured?.(id);
  };

  const centerOn = (id, smooth = true) => {
    const el = items.get(id);
    if (!el) return;
    strip.scrollTo({
      left: Math.max(0, el.offsetLeft - (strip.clientWidth * focusRatio() - el.offsetWidth / 2)),
      behavior: smooth && !reduced ? 'smooth' : 'auto',
    });
    setFeatured(id);
  };

  // Hangi kapak odak noktasında? — kaydırmada odağa en yakın öğe featured olur.
  const syncFromScroll = () => {
    const mid = strip.scrollLeft + strip.clientWidth * focusRatio();
    let best = '';
    let bestDist = Infinity;
    for (const [id, el] of items) {
      const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid);
      if (d < bestDist) { bestDist = d; best = id; }
    }
    setFeatured(best);
  };

  const onScroll = () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; syncFromScroll(); });
  };

  // Kullanıcı etkileşimi (dokunma/hover/odak) otomatik dönüşü susturur:
  // vitrin incelenirken arkasından kayması gürültüdür.
  const hold = () => { holdUntil = performance.now() + INTERACT_HOLD_MS; };

  const onClick = (ev) => {
    const btn = ev.target instanceof Element ? ev.target.closest('.home-marquee-item') : null;
    if (!btn?.dataset.mode) return;
    playMenuPop();
    centerOn(btn.dataset.mode);
    onLaunch?.(btn.dataset.mode);
  };

  strip.addEventListener('scroll', onScroll, { passive: true });
  strip.addEventListener('click', onClick);
  strip.addEventListener('pointerdown', hold, { passive: true });
  strip.addEventListener('pointerenter', hold, { passive: true });
  strip.addEventListener('focusin', hold);

  // Fare tekeri → yatay kaydırma: şeridin dikey kaydıracağı bir şey yok,
  // teker vitrinin doğal gezinme aracı olur (keşfedilebilirlik). Trackpad
  // zaten yatay delta üretir — ona dokunulmaz.
  const onWheel = (ev) => {
    if (!ev.deltaY || Math.abs(ev.deltaX) >= Math.abs(ev.deltaY)) return;
    strip.scrollLeft += ev.deltaMode === 1 ? ev.deltaY * 18 : ev.deltaY;
    hold();
    ev.preventDefault();
  };
  strip.addEventListener('wheel', onWheel, { passive: false });

  // Otomatik dönüş bir ZAMANLAYICIDIR, animasyon değil; hareket `scrollTo`'nun
  // smooth kaydırmasıdır ve azaltılmış harekette hiç kurulmaz.
  const tick = () => {
    if (performance.now() < holdUntil || strip.matches(':hover, :focus-within')) return;
    const i = Math.max(0, ids.indexOf(current));
    centerOn(ids[(i + 1) % ids.length]);
  };

  // İlk kurulum: düğüm `build()` anında DOM'da değildir — ölçü oturana kadar
  // birkaç kare beklenir (`heroAvatar` deseni); başlangıç kapağı KAYIT varsa
  // odur (KALDIĞIN YER vitrine emildi), değilse ilk oyundur.
  let settleRaf = 0;
  let settleTries = 0;
  const settle = () => {
    if (!strip.clientWidth && settleTries++ < 60) {
      settleRaf = requestAnimationFrame(settle);
      return;
    }
    centerOn(resumeId && items.has(resumeId) ? resumeId : ids[0], false);
    if (!reduced) timer = window.setInterval(tick, AUTO_MS);
  };
  settleRaf = requestAnimationFrame(settle);

  return () => {
    if (timer) clearInterval(timer);
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    if (settleRaf) cancelAnimationFrame(settleRaf);
    strip.removeEventListener('scroll', onScroll);
    strip.removeEventListener('click', onClick);
    strip.removeEventListener('pointerdown', hold);
    strip.removeEventListener('pointerenter', hold);
    strip.removeEventListener('focusin', hold);
    strip.removeEventListener('wheel', onWheel);
    window.removeEventListener('resize', onResize);
  };
}
