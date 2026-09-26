// App Shell — uygulama çerçevesinin TEK sahibi.
//
// Sorumlulukları (başka modül bu listener'ları kendisi eklemez):
//   · Görünüm yığını (push/pop) + donanım geri tuşu (history) + Escape
//   · Sol/üst ray'ı registry'den üretir, görünüm başlığını yönetir
//   · Girdi sahipliği: menü açıkken klavye + gamepad ODAK ROUTER'a gider,
//     oyun açıkken motora (inputRouter). İki kaynak birbirini starve etmez.
//   · Dikey rotate gate (yalnız dokunmatik cihazda) + yön kilidi isteği
//   · dvh/safe-area yüzeyi, reduced-motion, görünürlük temizliği
//
// Yeni ekran eklemek için: src/ui/views/ altına dosya + registerView().
// Burada ekran adına özel dallar yazmak yasaktır (AGENTS.md §3, §8).

import { getTabletopIconSvg } from '../core/tabletopIcons.js';
import { isTouchDevice } from './tokens.js';
import { prefersReducedMotion } from './motion.js';
import { toggleAudio, getIsMuted, playMenuTick } from '../audio.js';
import { isFullscreen, toggleFullscreen, onFullscreenChange } from './fullscreen.js';
import { getLang, setLang, onLangChange, t } from '../i18n.js';
import {
  registerView, getView, hasView, listRailViews, setRootView, getRootViewId,
} from './views/registry.js';
import { createFocusRouter } from './focusRouter.js';
import { setShellInputSuspender } from './overlayHost.js';

// ---------------------------------------------------------------------------
// Modül durumu
// ---------------------------------------------------------------------------

let shellEl = null;
let stageEl = null;
let railEl = null;
let gateEl = null;
let router = null;

const stack = [];
let actions = {};
let mounted = false;
let revealed = false;
let inputOwner = 'game';   // 'menu' | 'game'
let platformMode = 'LOCAL';

const gamepadState = { dir: null, confirm: false, page: 0, prev: [] };

// ---------------------------------------------------------------------------
// Girdi sahipliği — menü ile oyun arasındaki üst seviye arbitrasyon
// ---------------------------------------------------------------------------

let inputSuspended = false;

export function setShellInputOwner(owner) {
  inputOwner = owner === 'menu' ? 'menu' : 'game';
  if (inputOwner === 'menu') router?.refresh();
}

/**
 * Overlay açıkken shell dinlemez. `overlayHost.js` bunu kendi çağırır: aksi
 * halde bir modal açıkken ok tuşları arkaya kaçar ve odak diyaloğun dışına
 * çıkar (focus trap'in işini bozuyordu).
 */
function setInputSuspended(value) {
  inputSuspended = !!value;
  if (!inputSuspended && inputOwner === 'menu') router?.refresh({ keep: true });
}

export function setShellPlatformMode(mode) {
  platformMode = mode;
}

// ---------------------------------------------------------------------------
// Görünüm yığını
// ---------------------------------------------------------------------------

function currentView() {
  return stack.length ? stack[stack.length - 1] : null;
}

function applyViewChrome(view) {
  // `chrome: 'cinema'` → sahne tam kaplama (padding yok); yüzen gezinme ve
  // köşe kümesi arka plan görselinin üstünde kalır (Brawl/Wild Rift mantığı).
  shellEl?.classList.toggle('is-cinema', view?.chrome === 'cinema');
  // `chrome: 'none'` → gezinme ve köşe kümesi tamamen kalkar: ekranın kendi
  // üst rayı vardır (lobi), çift gezinme hem yer yer hem anlam olarak tekrar.
  shellEl?.classList.toggle('is-chromeless', view?.chrome === 'none');
}

function renderRail() {
  if (!railEl) return;
  railEl.textContent = '';
  for (const view of listRailViews()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shell-rail-btn';
    btn.dataset.view = view.id;
    btn.dataset.focus = 'rail';
    btn.setAttribute('aria-label', view.rail.label || view.title || view.id);
    // Kısa ekranda etiket gizlenir (ikon rayı): erişilebilir ad + ipucu.
    btn.title = (view.rail.label || view.title || view.id).toUpperCase();
    // Etiket i18n'den gelir ve HER ZAMAN büyük harftir (`t()` çağrısı view
    // modülünde yapılır). `getTabletopIconSvg` yalnız ikon adını bilir.
    btn.innerHTML = `${getTabletopIconSvg(view.rail.icon, { size: 17 })}<span></span>`;
    const label = btn.querySelector('span');
    if (label) label.textContent = (view.rail.label || '').toUpperCase();
    btn.addEventListener('click', () => {
      playMenuTick();
      if (currentView()?.id === view.id) return;
      // Ara adımlardan (oda / lobi) kalıcı hedefe geçerken yığın köke iner:
      // "ODA KUR → lobi → OYUN" yolunda oda ekranı araya girmesin.
      const isPersistent = listRailViews().some((v) => v.id === view.id);
      if (isPersistent) resetToRoot();
      openView(view.id);
    });
    if (view.id === getRootViewId()) btn.classList.add('is-root');
    railEl.appendChild(btn);
  }
}

function syncRailActive() {
  const id = currentView()?.id;
  // Kökteyken ANASAYFA girdisi "buradayım" sinyali verir; ara adımlarda
  // (oda, lobi) hiçbiri işaretli değildir.
  if (!railEl) return;
  railEl.querySelectorAll('.shell-rail-btn').forEach((btn) => {
    const active = btn.dataset.view === id;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-current', active ? 'page' : 'false');
  });
}

// Görünüm düğümü önbelleği: `keepAlive` görünümler bir kez kurulur ve DOM'u
// korunur (canlı canvas'ı / abone düğmeleri olan ekranlar için — Profil, Ayarlar).
// Kalan görünümler her açılışta yeniden kurulur.
const viewNodes = new Map();


function mountView(view) {
  if (view.keepAlive && viewNodes.has(view.id)) {
    const cached = viewNodes.get(view.id);
    cached.classList.remove('shell-view-exit');
    cached.classList.add('shell-view-enter');
    return cached;
  }
  const node = view.build?.({
    actions, t, openView, back,
    // Görünüm içeriğini değiştirdikten sonra odak listesini tazeletmek isteyebilir
    // (ör. kategori filtresi). Router'ı doğrudan bilmeleri gerekmez.
    refreshFocus: () => router?.refresh({ keep: false }),
  }) || document.createElement('div');
  node.classList.add('shell-view');
  node.dataset.view = view.id;
  if (view.keepAlive) viewNodes.set(view.id, node);
  return node;
}

const TRANSITION_MS = 220;

function animateOut(node, done) {
  if (prefersReducedMotion()) { done?.(); return; }
  node.classList.add('shell-view-exit');
  node.classList.remove('shell-view-enter');
  window.setTimeout(() => done?.(), TRANSITION_MS);
}

/**
 * Görünüm DEĞİLKEN: `keepAlive` görünümler DOM'da kalır (canvas + abonelikler
 * yaşamaya devam eder, `data-active="false"` ile görünmez olur), kalanlar silinir.
 * Yığında üstteki görünüm dışında hiçbir şey görünmez — bu invariant her
 * yığın değişiminde korunur, aksi halde `position:absolute` yüzeyler üst üste binerr.
 */
function retireNode(entry) {
  animateOut(entry.node, () => {
    // keepAlive düğümü bu 220 ms içinde yeniden açılmış olabilir (`openView`
    // aynı önbellek düğümünü döndürür) — damga yeni ekranı görünmez yapardı.
    if (currentView()?.node === entry.node) return;
    if (entry.view.keepAlive) {
      entry.node.classList.remove('shell-view-exit');
      entry.node.dataset.active = 'false';
    } else {
      entry.node.remove();
    }
  });
}

function syncViewVisibility() {
  const current = currentView();
  stageEl.querySelectorAll('.shell-view').forEach((node) => {
    if (node === current?.node) node.removeAttribute('data-active');
    else node.dataset.active = 'false';
  });
}

/**
 * Yığında kalan girişin düğümü DOM'dan çıkarılmış olabilir (keepAlive olmayan
 * görünümler açılışta emekli olur). `back()`/`resetToRoot()` ona dönerken
 * yeniden kurmadan bırakırsa sahne boş kalır.
 */
function ensureNode(entry) {
  if (!entry || entry.node.isConnected) return;
  entry.node = mountView(entry.view);
  entry.node.removeAttribute('data-active');
  stageEl.appendChild(entry.node);
}

/**
 * Görünüm aç. `replace` geri tuşu geçmişi eklemez (kök→ekran geçişleri için).
 */
export function openView(id, { replace = false } = {}) {
  const view = getView(id);
  if (!view) {
    console.warn(`[shell] kayıtsız görünüm: "${id}"`);
    return false;
  }
  const previous = currentView();
  if (previous?.id === id) {
    return true;
  }

  // Oyun/staging sırasında kabuk kapalıyken görünüm açılıyorsa (staging koltuk
  // düzenleyicisi, lobiye dönüş) kabuk katmanı tuvalin ÜSTÜNDE geri gelir.
  // Kök açılmaz — ekran bu görünüme aittir; kapanışta `back()` kabuğu indirir.
  if (!revealed) {
    revealed = true;
    shellEl?.classList.remove('hidden');
    shellEl?.classList.add('is-revealed');
    setShellInputOwner('menu');
    startGamepadPoll();
  }

  try { previous?.onExit?.({ node: previous.node, reason: 'cover' }); } catch (err) { console.error('[shell] onExit', err); }

  const node = mountView(view);
  const entry = { id, view, node };
  stack.push(entry);
  stageEl.appendChild(node);
  // keepAlive düğümü emeklilikten `data-active="false"` ile döner; açılışta
  // kalkmazsa görünmez kalır (syncViewVisibility hiçbir yerden çağrılmıyor).
  node.removeAttribute('data-active');

  if (previous) retireNode(previous);
  if (!prefersReducedMotion()) node.classList.add('shell-view-enter');

  applyViewChrome(view);
  syncRailActive();
  router.refresh({ keep: false });
  if (view.focus !== false) router.focusFirst();
  // Giriş animasyonu bittiğinde yerleşim oturur; odak listesini tazele.
  window.setTimeout(() => router.refresh({ keep: true }), TRANSITION_MS);

  try { view.onEnter?.({ node, actions }); } catch (err) { console.error('[shell] onEnter', err); }

  if (!replace && revealed) {
    try { history.pushState({ shellView: id }, ''); } catch {}
  }
  return true;
}

export function back() {
  const current = stack[stack.length - 1];
  if (!current) return false;
  if (stack.length <= 1) {
    // Tek giriş kök değilse bu görünüm OYUNUN ÜSTÜNDE açılmıştır (staging
    // koltuk düzenleyicisi / lobiye dönüş). Kapat: kabuk iner, ekran tuvale
    // döner. Kök giriş geri gidilemez.
    if (current.id === getRootViewId()) return false;
    stack.pop();
    try { current.view.onExit?.({ node: current.node, reason: 'canvas' }); } catch (err) { console.error('[shell] onExit', err); }
    retireNode(current);
    hideAppShell();
    return true;
  }
  // `backToRoot` görünümü bir NAVİGASYON BASAMAĞI değildir; bir eylemin
  // sonucudur (oda → lobi). Geri düğmesi onu bir üst ekrana değil, doğrudan
  // köke (ana menü) alır — oda ekranına dönmek "odadan çık" anlamına gelirdi.
  if (current.view.backToRoot) {
    resetToRoot();
    return true;
  }
  const popped = stack.pop();
  const previous = stack[stack.length - 1];
  try { popped.view.onExit?.({ node: popped.node, reason: 'pop' }); } catch (err) { console.error('[shell] onExit', err); }
  retireNode(popped);
  ensureNode(previous);
  applyViewChrome(previous.view);
  syncRailActive();
  router.refresh({ keep: false });
  router.focusFirst();
  try { previous.view.onEnter?.({ node: previous.node, actions }); } catch (err) { console.error('[shell] onEnter', err); }
  return true;
}

/**
 * Yığını köke indir. `back()` zincirleme ÇAĞIRILMAZ: `backToRoot` taşıyan bir
 * görünüm `back()` içinde `resetToRoot()` çağırsaydı sonsuz döngü olurdu.
 * Tek seferde tüm üstteki girişler çıkarılır, sonra bir kez render edilir.
 */
export function resetToRoot() {
  while (stack.length > 1) {
    const popped = stack.pop();
    try { popped.view.onExit?.({ node: popped.node, reason: 'root' }); } catch (err) { console.error('[shell] onExit', err); }
    retireNode(popped);
  }
  const root = stack[0];
  if (!root) return;
  ensureNode(root);
  applyViewChrome(root.view);
  syncRailActive();
  router.refresh({ keep: false });
  router.focusFirst();
  try { root.view.onEnter?.({ node: root.node, actions }); } catch (err) { console.error('[shell] onEnter', err); }
}

/**
 * Belli bir görünümü aç: zaten o ekrandaysak **dokunmaz** (mevcut düğüm ve
 * abonelikler korunur). `hostLobby` odası her güncellendiğinde bunu çağırır;
 * ekran zaten açıksa yeniden kurulmamalıdır.
 */
export function revealView(id) {
  if (currentView()?.id === id) {
    return true;
  }
  return openView(id);
}

/** Belli bir görünümü yığından çıkarır (yoksa no-op). */
export function closeView(id) {
  if (currentView()?.id !== id) {
    return false;
  }
  return back();
}

// ---------------------------------------------------------------------------
// Dikey rotate gate — app geneli landscape kilit
// ---------------------------------------------------------------------------

function isPortrait() {
  return window.innerHeight > window.innerWidth;
}

function shouldGate() {
  // Yalnız dokunmatik cihazda: masaüstünde dar pencere sadece yeniden akıtır.
  return isTouchDevice() && isPortrait();
}

export function updateRotateGate() {
  if (!gateEl) return;
  const blocked = shouldGate();
  gateEl.classList.toggle('hidden', !blocked);
  gateEl.setAttribute('aria-hidden', String(!blocked));
}

/** Maç başında yön kilidi iste. iOS'ta lock API yok — gate yönlendirmeye düşer. */
export async function lockLandscape() {
  const orientation = window.screen?.orientation;
  if (!orientation?.lock) return false;
  try {
    await orientation.lock('landscape');
    return true;
  } catch {
    return false;
  }
}

export function unlockOrientation() {
  try { window.screen?.orientation?.unlock?.(); } catch {}
}

// ---------------------------------------------------------------------------
// Klavye + gamepad → odak router (yalnız menü sahibiyken)
// ---------------------------------------------------------------------------

const KEY_DIRECTIONS = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
};

function onKeyDown(e) {
  if (inputSuspended || inputOwner !== 'menu' || !revealed || !router) return;
  const target = e.target;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

  const dir = KEY_DIRECTIONS[e.key];
  if (dir) { e.preventDefault(); router.move(dir); playMenuTick(); return; }
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.activate(); return; }
  if (e.key === 'PageDown' || e.key === 'PageUp') {
    e.preventDefault();
    router.page(e.key === 'PageDown' ? 1 : -1);
    return;
  }
  if (e.key === 'Escape' && back()) e.preventDefault();
}

// Gamepad D-pad + analog eksen → aynı yön API'si. 250ms tekrar sınırı.
const PAD = { repeat: 250, threshold: 0.5 };

function pollGamepad() {
  if (inputSuspended || inputOwner !== 'menu' || !revealed) return;
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
  const pads = navigator.getGamepads();
  const now = performance.now();
  let dir = null;
  let confirm = false;
  let page = 0;

  for (const pad of pads) {
    if (!pad) continue;
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    if (ax <= -PAD.threshold) dir = 'left';
    else if (ax >= PAD.threshold) dir = 'right';
    else if (ay <= -PAD.threshold) dir = 'up';
    else if (ay >= PAD.threshold) dir = 'down';
    if (pad.buttons[14]?.pressed) dir = 'left';
    if (pad.buttons[15]?.pressed) dir = 'right';
    if (pad.buttons[12]?.pressed) dir = 'up';
    if (pad.buttons[13]?.pressed) dir = 'down';
    if (pad.buttons[0]?.pressed) confirm = true;
    if (pad.buttons[1]?.pressed) page = -1;
    if (pad.buttons[2]?.pressed) page = 1;
    if (dir) break;
  }

  if (dir !== gamepadState.dir) {
    gamepadState.dir = dir;
    gamepadState.prev[0] = 0;
    if (dir) { router?.move(dir); playMenuTick(); }
  } else if (dir && now - (gamepadState.prev[0] || 0) > PAD.repeat) {
    gamepadState.prev[0] = now;
    router?.move(dir);
  }

  if (confirm && !gamepadState.confirm) { gamepadState.confirm = true; router?.activate(); }
  else if (!confirm) gamepadState.confirm = false;

  if (page !== gamepadState.page) { gamepadState.page = page; if (page) router?.page(page); }
}

// Gamepad yoklama zamanlayıcısı TEK örnektir: kabuk her açılışta (menü ya da
// oyun üstündeki lobi) yeniden kurulmaz.
let gamepadPollTimer = null;
function startGamepadPoll() {
  if (gamepadPollTimer != null) return;
  gamepadPollTimer = window.setInterval(pollGamepad, 100);
}

// ---------------------------------------------------------------------------
// Üst şerit eylemleri
// ---------------------------------------------------------------------------

function iconButton({ id, label, icon, onClick, pressed = false }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = id;
  btn.className = 'shell-icon-btn';
  btn.dataset.focus = 'nav';
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.innerHTML = getTabletopIconSvg(icon, { size: 18 });
  btn.setAttribute('aria-pressed', String(pressed));
  btn.addEventListener('click', () => { playMenuTick(); onClick(btn); });
  return btn;
}

function mountNavActions() {
  const host = shellEl?.querySelector('#shell-nav-actions');
  if (!host) return;
  host.textContent = '';

  const soundBtn = iconButton({
    id: 'shell-sound', label: t('menu.sound'), icon: getIsMuted() ? 'volume_x' : 'volume_2',
    pressed: !getIsMuted(),
    onClick: (btn) => {
      const muted = toggleAudio();
      btn.innerHTML = getTabletopIconSvg(muted ? 'volume_x' : 'volume_2', { size: 18 });
      btn.setAttribute('aria-pressed', String(!muted));
    },
  });
  const langBtn = iconButton({
    id: 'shell-lang', label: getLang() === 'tr' ? 'English' : 'Türkçe', icon: 'globe',
    onClick: (btn) => {
      const next = getLang() === 'tr' ? 'en' : 'tr';
      setLang(next);
      btn.querySelector('span')?.remove();
    },
  });
  const fsBtn = iconButton({
    id: 'shell-fullscreen', label: t('menu.fullscreen'), icon: isFullscreen() ? 'minimize_2' : 'maximize_2',
    pressed: isFullscreen(),
    onClick: (btn) => {
      toggleFullscreen();
      const active = isFullscreen();
      btn.innerHTML = getTabletopIconSvg(active ? 'minimize_2' : 'maximize_2', { size: 18 });
      btn.setAttribute('aria-pressed', String(active));
    },
  });
  const settingsBtn = iconButton({
    id: 'shell-settings', label: t('menu.settings'), icon: 'settings',
    onClick: () => actions.openSettings?.(),
  });

  host.append(soundBtn, langBtn, fsBtn, settingsBtn);
  onFullscreenChange((active) => {
    fsBtn.innerHTML = getTabletopIconSvg(active ? 'minimize_2' : 'maximize_2', { size: 18 });
    fsBtn.setAttribute('aria-pressed', String(active));
  });
  onLangChange(() => mountNavActions());
}

// ---------------------------------------------------------------------------
// Mount / reveal
// ---------------------------------------------------------------------------

function buildRailShell() {
  if (!shellEl) return;
  // Üst şerit ve bant YOK (kullanıcı kararı): solda SADECE üç kalıcı hedef
  // (ANASAYFA / OYUNLAR / KARAKTER) DİKEY ORTADA alt alta yüzer; marka (ikon
  // + oyun adı) SOL ÜSTTE yüzer, sistem simgeleri (ses/dil/tam ekran/ayarlar)
  // sağ üst köşede TEK SATIRDA yüzer (platform rozeti kaldırıldı).
  // Geri düğmesi YOK: "nereye girdiysem ana menüye dön" işi gezinmenin ilk
  // girdisinin işidir. Escape / donanım geri tuşu ve tarayıcı history'si
  // yine `back()` çalıştırır.
  shellEl.innerHTML = `
    <nav id="shell-rail" class="shell-rail" aria-label="Ana menü"></nav>
    <main id="shell-stage" class="shell-stage" tabindex="-1"></main>
    <button id="shell-home" class="shell-brand" type="button" data-focus="chrome" aria-label="Ana sayfa" title="Ana sayfa">
      <img class="shell-brand-mark" src="/icon.svg" alt="" width="34" height="34" />
      <span class="shell-brand-name">BRUTAL <b>PARTY</b></span>
    </button>
    <div class="shell-corner">
      <div id="shell-nav-actions" class="shell-nav-actions"></div>
    </div>
  `;

  stageEl = shellEl.querySelector('#shell-stage');
  railEl = shellEl.querySelector('#shell-rail');

  // Marka düğmesi yığını köke indirir — gezinmenin ANASAYFA girdisiyle aynı
  // iş; her ikisi de odada olduğunda odayı kapatır (lobi `onLobbyExit`).
  shellEl.querySelector('#shell-home')?.addEventListener('click', () => {
    playMenuTick();
    goHome();
  });
}

/** Yığını ana menüye indir; ara adımda oda açıksa kapat. */
export function goHome() {
  if (currentView()?.id === getRootViewId()) { resetToRoot(); return; }
  resetToRoot();
}

/**
 * @param {object} opts
 *   actions   — main.js'in sahip olduğu eylemler (openHostLobby, openJoinModal,
 *               onGameSelect, setGameMode...). Shell yalnız çağırır, bilmez.
 *   platformMode — başlangıç platform modu.
 */
export function mountAppShell({ actions: injectedActions = {}, platformMode: mode = 'LOCAL' } = {}) {
  if (mounted) return;
  actions = injectedActions;
  platformMode = mode;

  shellEl = document.getElementById('app-shell');
  gateEl = document.getElementById('app-rotate-gate');
  if (!shellEl) {
    console.warn('[shell] #app-shell bulunamadı — index.html iskeleti eksik.');
    return;
  }
  if (gateEl) {
    gateEl.innerHTML = `
      <div class="rotate-gate-card" role="status">
        <span class="rotate-gate-icon" aria-hidden="true">${getTabletopIconSvg('rotate_cw', { size: 40 })}</span>
        <strong>${t('shell.rotateTitle') || 'CİHAZINI YAN ÇEVİR'}</strong>
        <span>${t('shell.rotateHint') || 'Bu oyun yatay ekranda oynanır.'}</span>
      </div>
    `;
  }

  buildRailShell();
  renderRail();
  mountNavActions();

  router = createFocusRouter({
    // Yalnız EN ÜSTTEKİ görünüm odaklanabilir: alttakiler geçiş animasyonunda
    // görünür duruyor, kapsam onları dışarıda bırakır.
    getScope: () => currentView()?.node,
    // Görünümler odak değişimini dinleyebilsin diye olay olarak yeniden yayıyoruz
    // (ör. oyun seçiminde önizleme paneli). Olay GÖRÜNÜM düğümünde doğar ve
    // bubbling ile görünümün kendi dinleyicisine ulaşır; router'ı bilmeleri gerekmez.
    onFocusChange: (el, i) => {
      const node = currentView()?.node;
      if (!node) return;
      node.dispatchEvent(new CustomEvent('shell:focuschange', {
        bubbles: true,
        detail: { el, index: i },
      }));
    },
  });

  document.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('resize', updateRotateGate, { passive: true });
  window.addEventListener('orientationchange', updateRotateGate, { passive: true });
  window.addEventListener('popstate', () => { if (revealed) back(); });
  updateRotateGate();
  mounted = true;
}

/** Shell'i görünür yap ve kök görünümü aç. */
export function revealAppShell() {
  if (!mounted || revealed) return;
  revealed = true;
  shellEl?.classList.remove('hidden');
  shellEl?.classList.add('is-revealed');
  setShellInputOwner('menu');
  openView(getRootViewId(), { replace: true });
  window.setTimeout(() => router?.refresh({ keep: false }), 60);
  startGamepadPoll();
}

export function hideAppShell() {
  if (!revealed) return;
  revealed = false;
  setShellInputOwner('game');
  shellEl?.classList.add('hidden');
  shellEl?.classList.remove('is-revealed');
  // Yığın emekliye ayrılır: `keepAlive` düğümler DOM'da GÖRÜNMEZ kalır (canlı
  // canvas / abonelikler yaşamaya devam eder), diğerleri sökülür ve bir
  // sonraki `openView`'da yeniden kurulur. `onExit` BİLİNÇLİ çağrılmaz: oyuna
  // giriş lobiden "çıkış" değildir — oda yaşamaya devam eder.
  while (stack.length) retireNode(stack.pop());
}

export function isAppShellRevealed() {
  return revealed;
}

export function getShellStackIds() {
  return stack.map((entry) => entry.id);
}

// Görünümler kayıt noktasından gelir; modül yüklenince root belirlenir.
setRootView('home');

// Overlay açıldığında shell girdiyi bırakır (tek yönlü bağımlılık: shell,
// overlayHost'u bilmez; overlayHost shell'a haber verir).
setShellInputSuspender(setInputSuspended);

export { registerView, getView, hasView };
