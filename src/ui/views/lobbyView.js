// Lobi — TV_CONSOLE / ONLINE host odası. Bir MODAL değil, shell GÖRÜNÜMÜ.
//
// Diziye sadık kalmak için oda markup'ı `index.html`'de kalır ve burada
// **devralınır** (profileView'in `#menu-customize-card'ı devraldığı gibi):
// `initHostLobby` id üzerinden bağlandığı için markup kopyalanmadı, tüm
// bağlantılar ve oda mantığı korundu. Görünüm yalnız oyun KAHRAMANINI ve
// 15 oyunun IZGARA sheet'ini kurar; kabuktan gelen geri/eylem sözleşmesini
// bağlar.
//
// BRAWL STARS / WILD RIFT DÜZENİ (kullanıcı kararı, tam yeniden tasarım):
// ekran ikiye bölünür — solda tek dev OYUN KAHRAMANI (kapak + ad + ipucu,
// swipe'li karusel), sağda koltuk çipleri + tek altın CTA. Oda kodu başlıkta
// tek pil; QR/link/WhatsApp DAVET sheet'inin arkasında (hostLobby.js).
// Kapağa dokunmak 15 oyunun kapak ızgarasını açar; değişim tek
// `setHostGameMode` fonksiyonundan geçer. Hiçbir yerde sayfa kaydırma yok.

import { t, onLangChange } from '../../i18n.js';
import { playMenuTick } from '../../audio.js';
import { CARTRIDGES, GAME_ORDER } from '../../core/engineRegistry.js';
import { getTabletopIconSvg } from '../../core/tabletopIcons.js';
import { getCurrentHostGameMode, setHostGameMode, showLobbySheet, dismissLobbySheet, isLobbyExitSuppressed } from '../hostLobby.js';
import { closeOverlay } from '../overlayHost.js';
import { registerView } from './registry.js';

const ART = (mode) => `/assets/games/${String(mode).toLowerCase()}.jpg`;
const SWIPE_MIN_PX = 44;

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

function stepButton(icon, focusName) {
  const btn = el('button', 'lobby-game-step');
  btn.type = 'button';
  btn.dataset.focus = focusName;
  btn.innerHTML = getTabletopIconSvg(icon, { size: 20, strokeWidth: 2.6 });
  return btn;
}

// Yan kapaklar: kahramanın iki yanında komşu oyunların küçük kapakları.
// Boş yatay alanı doldurur ve dokunmak doğrudan o oyuna geçirir.
function peekButton(focusName) {
  const btn = el('button', 'lobby-game-peek');
  btn.type = 'button';
  btn.dataset.focus = focusName;
  const img = document.createElement('img');
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  btn.append(img);
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    if (!mode) return;
    playMenuTick();
    setHostGameMode(mode);
  });
  return btn;
}

registerView('lobby', {
  title: 'ODA',
  // Lobinin kendi üst rayı var (kapat + oda kodu + davet); kabuk şeridi
  // burada çizilmez — ekran nefes alır, bilgi tekrarı olmaz.
  chrome: 'none',
  // Rayde görünmez: oda ekranından gelen bir EYLEM sonucu açılır. Ray yalnız
  // gezinme hedeflerini listeler (ana menü / oyunlar / profil).
  rail: null,
  // Lobi bir navigasyon basamağı DEĞİLDİR; geri düğmesi doğrudan ana menüye
  // gider (bkz. `appShell.back`). Oda ekranına dönmek "odadan çık" olurdu.
  backToRoot: true,
  // `keepAlive` ŞART: görünüm `index.html`'deki `#tv-host-modal` düğümünü
  // TAŞIR (devralma). Yeniden kurulmaya kalkarsa taşınan kart bir önceki
  // düğümle birlikte silinir ve `hostLobby`'nin tuttuğu referanslar (oda kodu,
  // QR canvas, koltuk düğmeleri) kopuk kalır. Düğüm yaşar, `build` tekrar
  // çağrılmaz.
  keepAlive: true,

  build({ actions }) {
    // İkinci açılış: düğüm hâlâ yaşıyorsa aynısını döndür (idempotent).
    const existing = document.querySelector('.lobby-view');
    if (existing) return existing;

    const view = el('div', 'scene lobby-scene');
    const source = document.getElementById('tv-host-modal');
    if (!source) {
      // iskelet eksikse boş ekran: shell'in kuralı — view her zaman DOM döner.
      const empty = el('div', 'lobby-view-empty', '');
      empty.textContent = t('lobby.missing');
      view.append(empty);
      return view;
    }

    // Modal kabuğunu soy: diyalog ARIA'sı kalkar. İçindeki `.tv-host-card`
    // artık doğrudan ekran yüzeyidir.
    const card = source.querySelector('.tv-host-card') || source;
    source.removeAttribute('role');
    source.removeAttribute('aria-modal');
    source.removeAttribute('aria-labelledby');
    source.removeAttribute('aria-describedby');
    card.classList.add('lobby-card');
    view.append(card);
    // Kabuk DÜĞÜMÜ de gider. Yalnız sınıf kaldırmak yetmiyordu: kabuk
    // `position: fixed` + scrim kalıntısıyla tüm ekranı bulanıklaştırabiliyordu.
    source.remove();

    // Sahne zemini: lobi de ana menüyle aynı arenada oynar.
    view.prepend(
      el('div', 'scene-backdrop', ''),
      el('div', 'scene-spotlight', ''),
      el('div', 'scene-vignette', ''),
    );

    // ── Oyun kahramanı: dev kapak + ad + ipucu (swipe'li tek kart) ──
    const selector = card.querySelector('.host-game-selector');

    const prevBtn = stepButton('arrow_left', 'game-prev');
    const nextBtn = stepButton('arrow_right', 'game-next');
    const peekPrev = peekButton('game-peek-prev');
    const peekNext = peekButton('game-peek-next');

    const cover = document.createElement('img');
    cover.className = 'lobby-game-cover';
    cover.alt = '';
    cover.decoding = 'async';
    const copy = el('div', 'lobby-game-copy');
    const gameName = el('strong', 'lobby-game-name', '');
    const gameHint = el('span', 'lobby-game-hint', '');
    const position = el('span', 'lobby-game-pos', '');
    // Sayaç kopya yığınında: kapağın altında ad → ipucu → "n / 15" tek
    // ortalanmış sütun olur, köşede havada asılı kalmaz.
    copy.append(gameName, gameHint, position);
    // Kapak + ad tek dokunuşluk hedef: ızgara sheet'i buradan açılır.
    const face = el('button', 'lobby-game-face');
    face.type = 'button';
    face.dataset.focus = 'game-face';
    face.append(cover, copy);

    const gridBtn = stepButton('layout_grid', 'game-grid');
    gridBtn.classList.add('lobby-game-grid');
    const stage = el('div', 'lobby-game-stage');
    stage.append(prevBtn, peekPrev, face, peekNext, nextBtn, gridBtn);
    selector?.append(stage);

    // Adım düğmeleri listeyi sarar; sıralama `GAME_ORDER` (registry tek nokta).
    const step = (delta) => {
      const i = GAME_ORDER.indexOf(getCurrentHostGameMode());
      const next = GAME_ORDER[(i + delta + GAME_ORDER.length) % GAME_ORDER.length];
      playMenuTick();
      setHostGameMode(next);
    };
    prevBtn.addEventListener('click', () => step(-1));
    nextBtn.addEventListener('click', () => step(1));

    // ── 15 oyunun kapak ızgarası (kahramana dokununca açılır) ──
    const gridSheet = el('div', 'lobby-sheet lobby-sheet--grid hidden');
    gridSheet.id = 'lobby-grid-sheet';
    gridSheet.setAttribute('role', 'dialog');
    gridSheet.setAttribute('aria-modal', 'true');
    gridSheet.setAttribute('aria-labelledby', 'lobby-grid-title');
    const gridList = el('div', 'lobby-grid-list');
    const gridItems = new Map();
    for (const mode of GAME_ORDER) {
      const cart = CARTRIDGES[mode];
      const item = el('button', 'lobby-grid-item');
      item.type = 'button';
      const img = document.createElement('img');
      img.src = ART(mode);
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      const label = el('span', 'lobby-grid-name', '');
      label.textContent = cart?.title || mode;
      const check = el('span', 'lobby-grid-check', getTabletopIconSvg('check', { size: 12, strokeWidth: 3 }));
      item.append(img, label, check);
      item.addEventListener('click', () => {
        playMenuTick();
        setHostGameMode(mode);
        dismissLobbySheet('lobby-games');
      });
      gridItems.set(mode, item);
      gridList.append(item);
    }
    const gridHead = el('div', 'pause-sheet-head');
    gridHead.innerHTML = `
      <div class="pause-sheet-titles">
        <h3 class="pause-title" id="lobby-grid-title"></h3>
      </div>
      <button class="sheet-close" type="button" data-grid-close></button>
    `;
    gridHead.querySelector('[data-grid-close]').addEventListener('click', () => closeOverlay('lobby-games'));
    const gridCard = el('div', 'lobby-sheet-card is-grid');
    gridCard.append(gridHead, gridList);
    gridSheet.append(gridCard);
    card.append(gridSheet);

    const openGrid = () => showLobbySheet(gridSheet, 'lobby-games');
    gridBtn.addEventListener('click', () => { playMenuTick(); openGrid(); });

    // Yatay swipe: yüzük kadar kaydırma adım sayılır; swipe sonrası doğan
    // click'in ızgarayı açması engellenir.
    let swipeX = null;
    let swipeAt = 0;
    stage.addEventListener('pointerdown', (e) => { swipeX = e.clientX; });
    stage.addEventListener('pointerup', (e) => {
      if (swipeX === null) return;
      const dx = e.clientX - swipeX;
      swipeX = null;
      if (Math.abs(dx) < SWIPE_MIN_PX) return;
      swipeAt = performance.now();
      step(dx < 0 ? 1 : -1);
    });
    stage.addEventListener('pointercancel', () => { swipeX = null; });
    face.addEventListener('click', () => {
      if (performance.now() - swipeAt < 300) return;
      openGrid();
    });

    function paintGame(mode) {
      const cart = CARTRIDGES[mode];
      cover.src = ART(mode);
      cover.classList.remove('is-in');
      // Re-trigger: sınıfın düşmesi için bir kare refix zorunlu.
      void cover.offsetWidth;
      cover.classList.add('is-in');
      gameName.textContent = cart?.title || mode;
      gameHint.textContent = t(cart?.tacticalHintKey || '');
      prevBtn.setAttribute('aria-label', t('host.prevGame'));
      nextBtn.setAttribute('aria-label', t('host.nextGame'));
      gridBtn.setAttribute('aria-label', t('host.allGames'));
      face.setAttribute('aria-label', `${cart?.title || mode} — ${t('host.pickGameHint')}`);
      gridHead.querySelector('#lobby-grid-title').textContent = t('host.pickGame');
      gridHead.querySelector('.sheet-close').innerHTML = getTabletopIconSvg('close', { size: 16, strokeWidth: 2.6 });
      const i = GAME_ORDER.indexOf(mode);
      position.textContent = i < 0 ? '' : `${i + 1} / ${GAME_ORDER.length}`;
      gridItems.forEach((item, key) => item.classList.toggle('is-active', key === mode));
      paintPeeks(i < 0 ? 0 : i);
    }

    // Komşu kapaklar dairesel GAME_ORDER'dan gelir; etiketleri erişilebilir
    // isim olsun (kapakların kendisi görsel, ad kahramanda zaten durur).
    function paintPeeks(i) {
      const n = GAME_ORDER.length;
      for (const [btn, delta] of [[peekPrev, -1], [peekNext, 1]]) {
        const mode = GAME_ORDER[(i + delta + n) % n];
        const img = btn.querySelector('img');
        if (img.dataset.modeKey !== mode) {
          img.src = ART(mode);
          img.dataset.modeKey = mode;
        }
        btn.dataset.mode = mode;
        btn.setAttribute('aria-label', CARTRIDGES[mode]?.title || mode);
      }
    }

    // Tek değişim kaynağı `setHostGameMode`; görünüm olayı dinler.
    const onGame = (e) => paintGame(e.detail?.mode || getCurrentHostGameMode());
    document.addEventListener('lobby:game', onGame);
    paintGame(getCurrentHostGameMode());

    // ── Metinler ──
    function applyTexts() {
      paintGame(getCurrentHostGameMode());
    }
    // keepAlive görünüm: abonelik yaşam boyu — lobi her açılışta aynı düğümü
    // kullanır, temizlik ikinci açılışı ölü bırakırdı.
    onLangChange(applyTexts);

    // Kabuk eylemleri: geri düğmesi odayı kapatır (ana menüye dönmeden önce).
    view.addEventListener('lobby:refresh', () => actions.onLobbyShown?.());
    // `shell:viewleave` HER kapanışta çalışır; düğüm keepAlive olduğundan
    // abonelikler YAŞAR (once/temizlik ikinci lobi açılışını ölü bırakırdı).
    // Oda yalnız GERÇEK çıkışta kapanır: kabuk tuvale indiğinde (`canvas`),
    // başka bir ekran üstüne bindiğinde (`cover`) ya da `hostLobby` lobiyi
    // yalnız GİZLEDİĞİNDE (TO ARENA, düzenleyici kapat) oda yaşamaya devam eder.
    view.addEventListener('shell:viewleave', (e) => {
      closeOverlay('lobby-games');
      const reason = e.detail?.reason;
      if (reason === 'canvas' || reason === 'cover') return;
      if (isLobbyExitSuppressed()) return;
      actions.onLobbyExit?.();
    });

    return view;
  },

  onExit({ node, reason }) {
    node.dispatchEvent(new CustomEvent('shell:viewleave', { detail: { reason } }));
  },
});
