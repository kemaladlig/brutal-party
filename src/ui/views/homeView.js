// Home — uygulamanın merkezi; bir ARENA lobisi, düz sayfa değil. Sahne dili
// (`styles/scene.css` ortak kaynak) + Brawl tarzı sahne düzeni:
//
//   · Sol sahne: ÜST SOL'DA dev wordmark (harfler sırayla düşer, üzerinden
//     ışık süpürülür) + altında karakter kendi ışık diskinde durur; ayak
//     altından halka nabzı yayılır. Arka plan, aurora ve vitrin imleçle
//     sığ bir paralaks yapar (`homeParallax.js`).
//   · Ufuk çizgisi: oyun kapağı vitrini (`homeShowcase.js`) yavaşça döner;
//     merkeze bakan kapak FEATURED karttır. KALDIĞIN YER kaydı vitrinin ilk
//     hedefidir — ayrı çip yoktur.
//   · Sağ kolon: FEATURED kartı (tek dokunuşla o oyuna girer) + OYNA (altın)
//     + ODA KUR / KOD GİR ikilisi.
//   · ÜST SAĞ: YÜKLE ve GÜNCELLE çipleri (kabuğun sistem simgeleri altında).
//   · ALT SOL: bilgi şeridi.
//
// Eylemler `.scene-btn` ailesindendir (gold/teal/plum/chip). Kısa ekranda
// kolon alt banta, featured kart üst sola katlanır (`home.css`). Sahne ilk
// açılışta `is-entering` ile kurulur: başlık → karakter → vitrin → kartlar
// sırayla yerine oturur (~1,6 s), sonra sınıf düşer ve idle döngüler kalır.
// Mod seçimi (TV / ONLINE) oda ekranının işidir. Karakter eylemleri rozetin
// `⋮` menüsündedir (aynı işi iki yol göstermez).

import { getTabletopIconSvg } from '../../core/tabletopIcons.js';
import {
  isUpdateAvailable, onUpdateStatusChange, applyUpdate, checkForUpdates,
} from '../../core/updateManager.js';
import {
  resetAvatarProfile, saveAvatarProfile, getAvatarProfile, paletteName,
  expressionName, findPaletteByHex,
} from '../../core/customizationManager.js';
import { CARTRIDGES, gameArtPath } from '../../core/engineRegistry.js';
import { getPreference } from '../../core/preferences.js';
import { t, onLangChange } from '../../i18n.js';
import { playMenuTick, playMenuPop } from '../../audio.js';
import { updateInstallButtonVisibility } from '../toast.js';
import { registerView } from './registry.js';
import { prefersReducedMotion } from '../motion.js';
import { mountHeroAvatar } from './heroAvatar.js';
import { mountHomeShowcase } from './homeShowcase.js';
import { mountHomeParallax } from './homeParallax.js';
import { createPlayerNameField } from '../playerNameField.js';

const ENTER_MS = 1600; // `is-entering` süresi: en geç girdi animasyonunun bitişi.

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

/**
 * Sahne düğmesi: `weight` = 'gold' | 'teal' | 'plum' | 'ghost' | 'chip'.
 * `at` konum/ölçü sınıfı ekler (`home-play`, `home-room`, `home-join`); aile
 * kuralı `.scene-btn` üzerinde kalır, yerleşim `home.css`'te yerelleşir.
 * @param {{id?: string, icon?: string, label?: string, sub?: string, weight?: string, at?: string, onClick?: (ev?: any) => void, focus?: string}} opts
 */
function sceneButton({ id, icon, label, sub, weight, at = '', onClick, focus = 'act' }) {
  const btn = el('button', `scene-btn is-${weight}${at ? ` ${at}` : ''}`);
  btn.type = 'button';
  if (id) btn.id = id;
  btn.dataset.focus = focus;
  btn.tabIndex = -1;
  btn.innerHTML = `
    <span class="scene-btn-icon">${getTabletopIconSvg(icon, { size: 22, strokeWidth: 2.2 })}</span>
    <span class="scene-btn-copy">
      <span class="scene-btn-label"></span>
      ${sub ? '<span class="scene-btn-sub"></span>' : ''}
    </span>`;
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

/**
 * Marka kilidi: ikon + BRUTAL / PARTY iki satır; harfler `--i` sırasıyla
 * cascade düşer, kelimenin üzerinden periyodik ışık süpürmesi geçer.
 * Ana menüde kabuğun köşe çipi gizlenir (home.css `:has` kuralı) — bu kilit
 * markanın kendisidir; gezinme erişilebilir adı ray'daki ANASAYFA'dadır.
 */
function wordmark() {
  const wrap = el('div', 'home-wordmark');
  wrap.setAttribute('aria-hidden', 'true');
  const mark = el('img', 'home-wm-mark');
  mark.src = '/icon.svg';
  mark.alt = '';
  mark.width = 72;
  mark.height = 72;
  mark.decoding = 'async';
  const stack = el('div', 'home-wm-stack');
  let i = 0;
  for (const [word, isGold] of [['BRUTAL', false], ['PARTY', true]]) {
    const line = el('div', `home-wm-line${isGold ? ' is-gold' : ''}`);
    for (const ch of String(word)) {
      const letter = el('span', 'home-wm-letter', ch);
      letter.style.setProperty('--i', String(i));
      i += 1;
      line.append(letter);
    }
    stack.append(line);
  }
  wrap.append(mark, stack);
  return wrap;
}

/**
 * Üst boşluğu "canlı" tutan renk katmanı: üç dev aurora blob'u kendi
 * ritimlerinde sürüklenir; imleç parallaxı `[data-par] ile üstüne biner.
 * Salt dekoratif: odak hedefi değil, ekran okuyucuya kapalı, tıklamayı yutmaz.
 */
function auroraLayer() {
  const layer = el('div', 'home-aurora');
  layer.setAttribute('aria-hidden', 'true');
  layer.dataset.par = '1.4';
  for (const kind of ['is-a', 'is-b', 'is-c']) layer.append(el('span', `home-aurora-blob ${kind}`));
  return layer;
}

/**
 * Süzülen toz. Salt dekoratif; her nokta kendi gecikme/ölçü sınıfıyla gelir
 * (`home.css`), böylece hareket tek tip değil dağınık okunur.
 * `prefers-reduced-motion` altında `animations.css` küresel kapısı susar.
 */
function skyLayer() {
  const sky = el('div', 'home-sky');
  sky.setAttribute('aria-hidden', 'true');
  for (let i = 1; i <= 7; i += 1) sky.append(el('span', `home-sky-dot is-${i}`));
  return sky;
}

/**
 * Karakter aracı: yuvarlak cam düğme (kabuğun sistem simgesi geometrisi).
 * İkon-only olduğu için erişilebilir ad + ipucu zorunlu (AGENTS.md §8).
 * Tıklama sahneye kabarmaz — karakter zıplamaz.
 * @param {string} labelKey
 * @param {string} icon
 * @param {() => void} onClick
 * @param {boolean} [small] - rozet ici (30px) surum
 */
function toolButton(labelKey, icon, onClick, small = false) {
  const btn = el('button', small ? 'home-name-action' : 'home-tool',
    getTabletopIconSvg(icon, { size: small ? 16 : 20 }));
  btn.type = 'button';
  btn.dataset.focus = small ? 'name' : 'act';
  btn.tabIndex = -1;
  btn.setAttribute('aria-label', t(labelKey));
  btn.title = t(labelKey);
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    onClick();
  });
  return btn;
}

registerView('home', {
  title: 'BRUTAL PARTY',
  // Gezinmenin ilk hedefi (kök). `chrome: 'cinema'` saydam krom: sahne
  // görselinin üstüne biner.
  rail: { icon: 'home', label: 'ANASAYFA', order: 0 },
  chrome: 'cinema',
  // Açılışta HİÇBİR öğe odaklanmaz: odak halkası yalnız kullanıcı bir yön
  // tuşuna bastığında başlar (`appShell.focusViewInitial`, `focus: false`).
  focus: false,
  build(ctx) {
    const { actions: actions_, openView } = ctx;
    const view = el('div', 'scene home-scene is-entering');

    // ── Atmosfer katmanları (arkadan öne) ──
    const bg = el('div', 'home-bg');
    bg.setAttribute('aria-hidden', 'true');
    bg.dataset.par = '0.35';
    view.append(
      bg,
      auroraLayer(),
      el('div', 'scene-vignette', ''),
      skyLayer(),
    );

    // ── Ufuk vitrini: oyun kapakları (featured'ın kaynağı) ──
    // Parallax YOK: şerit kendi kayar; imleç sürüklemesi kapaklarda titreme
    // okunuyordu. Katman sabit durur, hareket yalnız kaydırmadandır.
    const marquee = el('div', 'home-marquee');
    marquee.dataset.hTrack = '';
    view.append(marquee);

    // ── Sol sahne: karakter + ışık diski + kimlik plakası ──
    // `is-staged`: karakter arena diskinin üst kenarına oturur (bkz. scene.css).
    // `data-focus`: TV/klavye gezinmesinde karakter bir hedeftir — Enter/OK
    // `el.click()` ile aynı zıplama tepkisini tetikler (focusRouter).
    const stage = el('div', 'scene-hero home-hero is-staged');
    stage.dataset.focus = 'hero';
    stage.tabIndex = -1;
    // Ayak altından yayılan halka nabzı: arenanın kalp atışı. Salt dekoratif;
    // hareket yalnız `scale`/`opacity` (`home.css`).
    stage.append(
      el('div', 'scene-hero-glow', ''),
      el('span', 'home-pulse', ''),
      el('span', 'home-pulse is-2', ''),
    );
    const canvas = document.createElement('canvas');
    canvas.className = 'scene-hero-canvas home-hero-canvas';
    stage.append(canvas);

    const nameField = createPlayerNameField({
      prefix: 'home-',
      // Kalem/zar rozette çizilmez — üç nokta menüsünden tetiklenir.
      showActions: false,
      ids: {
        viewRow: 'home-name-view',
        name: 'home-name',
        edit: 'home-name-edit',
        reroll: 'home-name-reroll',
        inputRow: 'home-name-input-row',
        input: 'home-name-input',
        save: 'home-name-save',
      },
    });
    const badge = el('div', 'scene-badge home-identity');
    // Satır 1: isim + simge şeridi. Satır 2 (`.home-identity-meta`): renk
    // örneği · gövde rengi · yüz — hepsi mevcut veriden, `applyTexts` yazar.
    const nameRow = el('div', 'home-identity-row');
    nameRow.append(nameField.el);
    // ── Rozet kuyruğu: kompakt simge şeridi (III — açılır menü yerine) ──
    // İki eylem: kurşun kalem (adı düzenle) + tek zar (isim VE karakteri
    // birlikte yeniler). Menü hiç açılmaz → dar ekranda taşma sorunu
    // kökünden yok; her eylem erişilebilir adlı tek satırlık düğmedir.
    // Rozet `.scene-badge` altında olduğu için `heroAvatar` tıklama
    // korumasına girer — karakter zıplamaz. Zar `saveAvatarProfile`
    // `brutal_customization_changed` yayınladığı için kahraman (ve açık profil
    // ekranı) kendiliğinden tazelenir.
    const tools = el('div', 'home-identity-tools');
    const editNameBtn = toolButton('menu.editName', 'pencil', () => {
      playMenuTick();
      nameField.focusEdit();
    }, true);
    const rerollAllBtn = toolButton('menu.rerollAll', 'dice', () => {
      playMenuPop();
      nameField.reroll();
      saveAvatarProfile(resetAvatarProfile());
    }, true);
    const toolLabels = /** @type {const} */ ([
      [editNameBtn, 'menu.editName'],
      [rerollAllBtn, 'menu.rerollAll'],
    ]);
    tools.append(editNameBtn, rerollAllBtn);
    nameRow.append(tools);
    badge.append(nameRow);
    const meta = el('div', 'home-identity-meta');
    badge.append(meta);
    // "Dokun" ipucu: PLAKANIN ÜSTÜNDE tek satır; sahneye ilk dokunuşta kalkar.
    // Plakaya bağlıdır (kahraman KUTUSUNA değil): kutu kareden %40 uzundur,
    // kutuya asıldığında ipucu ekranın tepesine — karakterden kopuk — düşüyor
    // ve kısa ekranda kırpılıyordu. Kalıcı tercih YAZILMAZ; görünüm her
    // açılışta yeniden kurulur.
    const hint = el('div', 'home-boing-hint');
    badge.append(hint);
    stage.append(badge);

    view.append(stage, wordmark());

    // ── FEATURED kartı: vitrinin merkeze bakan kapağı, tek dokunuşla maça ──
    // KALDIĞIN YER çipi buraya emildi: kayıt varsa vitrin o oyunla açılır ve
    // overline "KALDIĞIN YER" olur. Kart tek yüzeidir; oyun adı markadır,
    // çevrilmez.
    const featured = el('button', 'home-featured');
    featured.type = 'button';
    featured.dataset.focus = 'act';
    featured.tabIndex = -1;
    featured.innerHTML = `
      <img class="home-featured-art" alt="" decoding="async" />
      <span class="home-featured-copy">
        <span class="home-featured-text">
          <span class="home-featured-overline"></span>
          <span class="home-featured-title"></span>
        </span>
        <span class="home-featured-go">${getTabletopIconSvg('play', { size: 18, strokeWidth: 2.4 })}</span>
      </span>`;
    const featuredArt = featured.querySelector('.home-featured-art');
    const featuredOverline = featured.querySelector('.home-featured-overline');
    const featuredTitle = featured.querySelector('.home-featured-title');

    // ── Sağ kolon: OYNA (altın) + ODA KUR / KOD GİR ikilisi ──
    const rail = el('div', 'home-rail');

    const playBtn = sceneButton({
      id: 'home-play', icon: 'play', label: 'shell.playNow', sub: 'shell.play.pick',
      weight: 'gold', at: 'home-play', focus: 'play',
      onClick: () => { playMenuPop(); openView('games'); },
    });

    const duo = el('div', 'home-rail-duo');
    const roomBtn = sceneButton({
      id: 'home-create-room', icon: 'plus', label: 'shell.room.create', sub: 'shell.room.pick',
      weight: 'teal', at: 'home-room',
      onClick: () => { playMenuPop(); openView('room'); },
    });
    const joinBtn = sceneButton({
      id: 'home-join', icon: 'message_square', label: 'shell.side.join',
      weight: 'plum', at: 'home-join',
      onClick: () => {
        playMenuTick();
        actions_.openJoin?.('', actions_.getPlatformMode?.() === 'ONLINE' ? 'ONLINE' : 'TV_CONSOLE');
      },
    });
    duo.append(joinBtn, roomBtn);
    rail.append(playBtn, duo);
    view.append(featured, rail);

    // ── Sağ kenar: YÜKLE + GÜNCELLE — sistem işleri köşesi ──
    // Çipler kabuğun sistem simgelerinin (ses / dil / tam ekran) ALTINA
    // hizalanır. YÜKLE yalnız uygulama yüklenebilir durumdayken görünür
    // (`toast.js` `.hidden`).
    const sideRail = el('div', 'home-side');

    const installBtn = sceneButton({
      at: 'home-install', weight: 'chip', focus: 'install',
      icon: 'download', label: 'menu.install',
      onClick: () => playMenuTick(),
    });
    installBtn.dataset.installApp = '';

    const updateBtn = sceneButton({
      id: 'home-update', icon: 'reload', label: 'shell.side.update',
      weight: 'chip', at: 'home-update',
      onClick: () => {
        playMenuTick();
        if (isUpdateAvailable()) applyUpdate();
        else checkForUpdates();
      },
    });
    sideRail.append(installBtn, updateBtn);
    view.append(sideRail, el('div', 'home-facts', ''));

    // ── Vitrin + parallax ──
    // KALDIĞIN YER kaydı artık ayrı çip değil, vitrinin BAŞLANGIÇ kapağıdır.
    // Tanınmayan bir mod (silinmiş oyun, eski sürüm kaydı) sessizce yoksayılır.
    const lastMode = getPreference('lastGameMode');
    const resumeId = lastMode && CARTRIDGES[lastMode] ? lastMode : null;
    let featuredId = '';
    let swapTimer = 0;

    // Featured geçişi ÇAPRAZ SÖNER: önce 160ms'de eski içerik solar+kayar,
    // sonra yenisi boyanıp geri gelir. Tek katman, transform/opacity dışı
    // hareket yok; azaltılmış harekette anında değişir. Aynı id (dil
    // değişimi) solmadan tazelenir — metin titremez.
    const paintFeatured = (id) => {
      const cart = CARTRIDGES[id];
      if (!cart) return;
      featuredId = id;
      featuredArt.src = gameArtPath(id);
      featuredTitle.textContent = cart.title;
      const overKey = id === resumeId ? 'shell.home.resume' : 'shell.home.featured';
      featuredOverline.textContent = t(overKey);
      featured.setAttribute('aria-label', `${t(overKey)} — ${cart.title}`);
      featured.classList.toggle('is-resume', id === resumeId);
    };
    const applyFeatured = (id) => {
      if (!CARTRIDGES[id] || id === featuredId) {
        if (CARTRIDGES[id]) paintFeatured(id);
        return;
      }
      if (prefersReducedMotion() || !featuredId) {
        paintFeatured(id);
        return;
      }
      featured.classList.add('is-swap');
      window.clearTimeout(swapTimer);
      swapTimer = window.setTimeout(() => {
        paintFeatured(id);
        requestAnimationFrame(() => featured.classList.remove('is-swap'));
      }, 170);
    };
    const disposeShowcase = mountHomeShowcase({
      strip: marquee,
      resumeId,
      onFeatured: applyFeatured,
      onLaunch: (id) => actions_.onGameSelect?.(id),
    });
    featured.addEventListener('click', () => {
      if (!featuredId) return;
      playMenuPop();
      actions_.onGameSelect?.(featuredId);
    });
    const disposeParallax = mountHomeParallax(view);

    // Giriş koreografisi tek sınıftır: CSS `is-entering` altındaki girdi
    // animasyonları `both` ile kilitli tutulur; süre bitince sınıf düşer ve
    // `translate` gibi temel değerler (hover'lar) geri serbest kalır.
    const enterTimer = window.setTimeout(() => view.classList.remove('is-entering'), ENTER_MS);

    // ── Metinler ──
    function applyTexts() {
      const set = (btn, key, subKey) => {
        btn.querySelector('.scene-btn-label').textContent = t(key);
        if (subKey) btn.querySelector('.scene-btn-sub').textContent = t(subKey);
        btn.setAttribute('aria-label', subKey ? `${t(key)} — ${t(subKey)}` : t(key));
      };
      set(roomBtn, 'shell.room.create', 'shell.room.pick');
      set(playBtn, 'shell.playNow', 'shell.play.pick');
      set(joinBtn, 'shell.side.join');
      set(installBtn, 'menu.install');
      // Kimlik plakası: renk örneği · gövde rengi · yüz. Mod etiketi çıktı —
      // plaka karakterin kartvizitidir, bağlantının değil. Swatch profili dolduran
      // gerçek renkle boyanır (tek kaynak profil); adlar dil değişiminde tazelenir.
      const profile = getAvatarProfile();
      const palette = findPaletteByHex(profile?.color);
      meta.textContent = '';
      const swatch = el('span', 'home-identity-swatch');
      swatch.setAttribute('aria-hidden', 'true');
      if (profile?.color) swatch.style.background = profile.color;
      const metaText = el('span', 'home-identity-text');
      metaText.textContent = [
        palette ? paletteName(palette) : '',
        expressionName(profile?.expression),
      ].filter(Boolean).join(' · ');
      meta.append(swatch, metaText);
      // Güncelleme çipi hem dili hem durumu izler: hazırken kenarı/etiketi
      // değişir (`has-update` → home.css nabzı).
      updateBtn.classList.toggle('has-update', isUpdateAvailable());
      set(updateBtn, isUpdateAvailable() ? 'shell.side.updateReady' : 'shell.side.update');
      hint.textContent = t('menu.boing');
      view.querySelector('.home-facts').textContent = t('shell.home.facts');
      // Simge şeridi etiketleri dili izler (erişilebilir ad + ipucu).
      for (const [btn, key] of toolLabels) {
        btn.setAttribute('aria-label', t(key));
        btn.title = t(key);
      }
      // Featured kartın overline'ı dili izler (oyun adı markadır, çevrilmez).
      if (featuredId) applyFeatured(featuredId);
      // Uygulama zaten yüklüyse (standalone) simge hiç gösterilmez.
      updateInstallButtonVisibility();
    }
    applyTexts();
    // Yeni sürüm indiğinde çip anında "hazır"a döner; abonelik görünümden
    // ayrılırken iptal edilir (ölü dinleyici bırakma yok).
    const offUpdate = onUpdateStatusChange(() => applyTexts());

    const dispose = mountHeroAvatar(canvas, {
      onPoke: () => hint.classList.add('hidden'),
    });
    // Görünüm her açılışta yeniden kurulduğu için abonelik mutlaka iptal
    // edilir; aksi halde dil değişiminde ölü görünümler de güncellenir.
    const offLang = onLangChange(() => { applyTexts(); nameField.refresh(); });
    view.addEventListener('shell:viewleave', () => {
      clearTimeout(enterTimer);
      dispose();
      disposeShowcase();
      disposeParallax();
      nameField.destroy();
      offLang();
      offUpdate();
    }, { once: true });

    return view;
  },
  onExit({ node }) {
    node.dispatchEvent(new CustomEvent('shell:viewleave'));
  },
});
