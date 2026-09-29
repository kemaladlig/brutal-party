// Home — uygulamanın merkezi. Sahne dili (`styles/scene.css` ortak kaynak):
//
//   · Tam kaplama arena, düz sayfa yüzeyi yok
//   · Merkezde oyuncu karakterimiz (canlı avatar) + arkasında ışık konisi
//     (`scene-hero-glow`); altında iki satırlı KİMLİK PLAKASI: nick + platform
//     modu · gövde rengi · yüz. İkinci satır uydurma veri taşımaz — tercih ve
//     avatar profilinden türer.
//   · ÜST SOL: KALDIĞIN YER — en son sahaya geçilen oyunun kapağıyla tek
//     dokunuşta maça döner. Kayıt `preferences.js`'tedir, yazan tek yer
//     `roomFlow.enterStaging`dir.
//   · SAĞ ALT: KOD GİR + ODA KUR + OYNA — giriş çipi solda, iki kart sağda.
//     Oyun modlarını OYNA açar, oda ekranını ODA KUR, koda KOD GİR.
//   · ÜST SAĞ: YÜKLE ve GÜNCELLE — sistem simgelerinin ALTINA hizalı iki çip
//     (eskiden sahnenin ortasında, boşluğun içinde asılıydılar).
//   · ALT SOL: bilgi şeridi (oyun/oyuncu/mod özeti).
//
// Beş eylem de `.scene-btn` ailesinden: aynı geometri, dört ağırlık
// (`gold` / `teal` / `plum` / `chip`). Dikey akış, kart ızgarası ve
// web-sayfası listesi yok. Mod seçimi (TV / ONLINE) oda ekranının işidir.
// Karakter eylemleri (düzenle / rastgele) sahneye ayrı yüzen daireler olarak
// DEĞİL, rozetin `⋮` menüsünden açılır (aynı işi iki yol göstermez; §30).

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
import { mountHeroAvatar } from './heroAvatar.js';
import { createPlayerNameField } from '../playerNameField.js';

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
 * `art` verilirse ikon yerine GERÇEK kapak görseli çizilir (madalyon içinde) —
 * "KALDIĞIN YER" çipi hangi oyuna dönüleceğini renkle anlatır.
 * @param {{id?: string, icon?: string, art?: string, label?: string, sub?: string, weight?: string, at?: string, onClick?: (ev?: any) => void, focus?: string}} opts
 */
function sceneButton({ id, icon, art, label, sub, weight, at = '', onClick, focus = 'act' }) {
  const btn = el('button', `scene-btn is-${weight}${at ? ` ${at}` : ''}`);
  btn.type = 'button';
  if (id) btn.id = id;
  btn.dataset.focus = focus;
  btn.tabIndex = -1;
  // Kapak görseli dekoratiftir: oyunun adı `.scene-btn-sub`'da yazıyla durur.
  const medallion = art
    ? `<img class="scene-btn-art" src="${art}" alt="" loading="lazy" decoding="async" />`
    : getTabletopIconSvg(icon, { size: 22, strokeWidth: 2.2 });
  btn.innerHTML = `
    <span class="scene-btn-icon">${medallion}</span>
    <span class="scene-btn-copy">
      <span class="scene-btn-label"></span>
      ${sub ? '<span class="scene-btn-sub"></span>' : ''}
    </span>`;
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

/**
 * Üst boşluğu "canlı" tutan süzülen toz. Salt dekoratif: odak hedefi değil,
 * ekran okuyucuya kapalı, tıklamayı yutmaz. Her nokta kendi gecikme/ölçü
 * sınıfıyla gelir (`home.css`), böylece hareket tek tip değil dağınık okunur.
 * `prefers-reduced-motion` altında `animations.css` küresel kapısı susar.
 */
function skyLayer() {
  const sky = el('div', 'home-sky');
  sky.setAttribute('aria-hidden', 'true');
  for (let i = 1; i <= 7; i += 1) sky.append(el('span', `home-sky-dot is-${i}`));
  return sky;
}

/**
 * Platform modu → sözlük anahtarı soneki (`shell.mode.*`). Bilinmeyen/boş
 * değer "tek cihaz"a düşer: kimlik plakası hiçbir durumda eksik kalmaz.
 * @param {string} [mode]
 * @returns {'local'|'tv'|'online'}
 */
function platformKey(mode) {
  if (mode === 'TV_CONSOLE') return 'tv';
  if (mode === 'ONLINE') return 'online';
  return 'local';
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

/**
 * Rozet menü öğesi: ikon + metin etiketi, ≥44px dokunma hedefi.
 * Tıklama sahneye kabarmaz — karakter zıplamaz.
 */
function badgeMenuItem(icon, labelKey, onPick) {
  const item = el('button', 'home-more-item',
    `<span class="home-more-icon">${getTabletopIconSvg(icon, { size: 18 })}</span>`
    + `<span class="home-more-label"></span>`);
  item.type = 'button';
  item.dataset.focus = 'name';
  item.tabIndex = -1;
  item.dataset.labelKey = labelKey;
  item.querySelector('.home-more-label').textContent = t(labelKey);
  item.setAttribute('aria-label', t(labelKey));
  item.addEventListener('click', (ev) => {
    ev.stopPropagation();
    onPick();
  });
  return item;
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
    const view = el('div', 'scene home-scene');

    view.append(
      el('div', 'scene-backdrop', ''),
      el('div', 'scene-spotlight', ''),
      el('div', 'scene-floor', ''),
      el('div', 'scene-vignette', ''),
    );

    // ── Ortam katmanı: üst boşluk ──
    view.append(skyLayer());

    // ── Merkez: karakter + düzenlenebilir isim ──
    // `is-staged`: karakter arena diskinin üst kenarına oturur (bkz. scene.css).
    // `data-focus`: TV/klavye gezinmesinde karakter bir hedeftir — Enter/OK
    // `el.click()` ile aynı zıplama tepkisini tetikler (focusRouter).
    const stage = el('div', 'scene-hero home-hero is-staged');
    stage.dataset.focus = 'hero';
    stage.tabIndex = -1;
    // Karakterin ARKASINDAKİ ışık konisi. Ana menü kendi zemin görselini
    // kullandığı için sahnenin backdrop katmanları kapalı (`home.css`); koyu
    // gövdeli avatarlar parlak ufukta "delik" gibi okunuyordu. Katman sahne
    // dilinden gelir (`scene.css`), ölçüsü `home.css`'te kahramana bağlanır.
    stage.append(el('div', 'scene-hero-glow', ''));
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
    // Satır 1: isim + `⋮`. Satır 2 (`.home-identity-meta`): platform modu ·
    // gövde rengi · yüz — hepsi mevcut veriden, aşağıdaki `applyTexts` yazar.
    const nameRow = el('div', 'home-identity-row');
    nameRow.append(nameField.el);
    // ── Rozet kuyruğu: üç nokta + YUKARI açılan menü ──
    // Nick (düzenle / rastgele) ve KARAKTER eylemleri (atölye / rastgele avatar)
    // buradadır; menü rozetin ÜSTÜNE açılır (`bottom: 100%`), alta taşmaz.
    // Rozet `.scene-badge` altında olduğu için `heroAvatar` tıklama korumasına
    // girer — karakter zıplamaz.
    const moreBtn = toolButton('menu.more', 'more_vertical', () => {
      playMenuTick();
      const open = moreMenu.classList.toggle('is-open');
      moreBtn.setAttribute('aria-expanded', String(open));
    }, true);
    moreBtn.classList.add('home-more-btn');
    moreBtn.setAttribute('aria-expanded', 'false');
    moreBtn.setAttribute('aria-haspopup', 'menu');
    nameRow.append(moreBtn);
    badge.append(nameRow);
    const meta = el('div', 'home-identity-meta');
    badge.append(meta);
    const moreMenu = el('div', 'home-more-menu');
    moreMenu.setAttribute('role', 'menu');
    const closeMore = () => {
      moreMenu.classList.remove('is-open');
      moreBtn.setAttribute('aria-expanded', 'false');
    };
    const editNameItem = badgeMenuItem('pencil', 'menu.editName', () => {
      playMenuTick();
      closeMore();
      nameField.focusEdit();
    });
    const rerollNameItem = badgeMenuItem('dice', 'menu.rerollName', () => {
      closeMore();
      nameField.reroll();
    });
    // Karakter eylemleri (eski hâlde karakterin yanında YÜZEN iki yuvarlak
    // düğmeydi; dar ekranda YÜKLE/GÜNCELLE çipleriyle çakışıyor ve KARAKTER
    // girdisinin kopyası oluyorlardı — §30). `saveAvatarProfile`
    // `brutal_customization_changed` yayınladığı için kahraman (ve açık profil
    // ekranı) kendiliğinden tazelenir.
    const editCharacterItem = badgeMenuItem('gamepad_2', 'menu.avatarTitle', () => {
      playMenuTick();
      closeMore();
      openView('profile');
    });
    const randomAvatarItem = badgeMenuItem('dice', 'custom.random', () => {
      playMenuPop();
      closeMore();
      saveAvatarProfile(resetAvatarProfile());
    });
    moreMenu.append(editNameItem, rerollNameItem, editCharacterItem, randomAvatarItem);
    badge.append(moreMenu);
    // "Dokun" ipucu: PLAKANIN ÜSTÜNDE tek satır; sahneye ilk dokunuşta kalkar.
    // Plakaya bağlıdır (kahraman KUTUSUNA değil): kutu kareden %40 uzundur,
    // kutuya asıldığında ipucu ekranın tepesine — karakterden kopuk — düşüyor
    // ve kısa ekranda kırpılıyordu. Kalıcı tercih YAZILMAZ; görünüm her
    // açılışta yeniden kurulur.
    const hint = el('div', 'home-boing-hint');
    badge.append(hint);
    stage.append(badge);

    view.append(stage);

    // ── Üst sol: KALDIĞIN YER ──
    // Kayıt `preferences.js`'tedir; TEK yazma yeri `roomFlow.enterStaging`dir
    // (sahaya gerçekten geçilen oyun). Tanınmayan bir mod (silinmiş oyun, eski
    // sürüm kaydı) sessizce çizilmez — çip yalnız `CARTRIDGES`'te varsa doğar.
    const lastMode = getPreference('lastGameMode');
    const lastCart = lastMode ? CARTRIDGES[lastMode] : null;
    const resumeBtn = lastCart ? sceneButton({
      id: 'home-resume', icon: 'play', art: gameArtPath(lastCart.id),
      label: 'shell.home.resume', sub: lastCart.title,
      weight: 'chip', at: 'home-resume', focus: 'act',
      // Katalogla AYNI giriş: tek eylem yolu (`onGameSelect` → sahaya geçiş).
      onClick: () => { playMenuPop(); actions_.onGameSelect?.(lastCart.id); },
    }) : null;
    if (resumeBtn) view.append(resumeBtn);

    // ── Sağ alt: KOD GİR + ODA KUR + OYNA, yan yana ──
    // Üç kardeş kart, üçü de aynı yükseklikte: giriş (cam), oda (turkuaz),
    // oyun (altın). KOD GİR eskiden sağ kenardaydı; oyun akışının girişi
    // olduğu için eylem sırasının EN SOLUNA taşındı.
    const actions = el('div', 'home-actions');

    const joinBtn = sceneButton({
      id: 'home-join', icon: 'message_square', label: 'shell.side.join',
      weight: 'plum', at: 'home-join',
      onClick: () => {
        playMenuTick();
        actions_.openJoin?.('', actions_.getPlatformMode?.() === 'ONLINE' ? 'ONLINE' : 'TV_CONSOLE');
      },
    });

    const roomBtn = sceneButton({
      id: 'home-create-room', icon: 'plus', label: 'shell.room.create', sub: 'shell.room.pick',
      weight: 'teal', at: 'home-room',
      onClick: () => { playMenuPop(); openView('room'); },
    });

    const playBtn = sceneButton({
      id: 'home-play', icon: 'play', label: 'shell.playNow', sub: 'shell.play.pick',
      weight: 'gold', at: 'home-play', focus: 'play',
      onClick: () => { playMenuPop(); openView('games'); },
    });

    actions.append(joinBtn, roomBtn, playBtn);
    view.append(actions);

    // ── Sağ kenar: YÜKLE + GÜNCELLE — eylem çipleri ──
    // Profil kartındaki büyük "Install" satırı buraya taşındı; GÜNCELLE ise
    // üst köşedeki küçük sistem simgeleri arasındaydı — ikisi de ana menüden
    // tek dokunuş, ikinci ekran değil. (KOD GİR de çip ailesindendi, ama oyun
    // akışının girişi olduğu için eylem sırasının en soluna, kart olarak
    // taşındı.)
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
    view.append(sideRail);

    view.append(el('div', 'home-facts', ''));

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
      // KALDIĞIN YER: etiket sözlükten, oyun adı registry'den (kart başlıkları
      // çevrilmez — oyun adı markadır).
      if (resumeBtn) {
        resumeBtn.querySelector('.scene-btn-label').textContent = t('shell.home.resume');
        resumeBtn.setAttribute('aria-label', `${t('shell.home.resume')} — ${lastCart.title}`);
      }
      // Kimlik plakası: platform modu · gövde rengi · yüz. Üçü de mevcut
      // durumdan türer; dil değişiminde yeniden yazılır (palet/yüz adları da
      // sözlükten gelir).
      const profile = getAvatarProfile();
      const palette = findPaletteByHex(profile?.color);
      const modeKey = `shell.mode.${platformKey(actions_.getPlatformMode?.())}`;
      meta.textContent = [
        t(modeKey),
        palette ? paletteName(palette) : '',
        expressionName(profile?.expression),
      ].filter(Boolean).join(' · ');
      // Güncelleme çipi hem dili hem durumu izler: hazırken kenarı/etiketi
      // değişir (`has-update` → home.css nabzı).
      updateBtn.classList.toggle('has-update', isUpdateAvailable());
      set(updateBtn, isUpdateAvailable() ? 'shell.side.updateReady' : 'shell.side.update');
      hint.textContent = t('menu.boing');
      view.querySelector('.home-facts').textContent = t('shell.home.facts');
      moreBtn.setAttribute('aria-label', t('menu.more'));
      moreBtn.title = t('menu.more');
      moreMenu.querySelectorAll('.home-more-item').forEach((item) => {
        const key = item.dataset.labelKey;
        if (!key) return;
        item.querySelector('.home-more-label').textContent = t(key);
        item.setAttribute('aria-label', t(key));
      });
      // Uygulama zaten yüklüyse (standalone) simge hiç gösterilmez.
      updateInstallButtonVisibility();
    }
    applyTexts();
    // Yeni sürüm indiğinde çip anında "hazır"a döner; abonelik görünümden
    // ayrılırken iptal edilir (ölü dinleyici bırakma yok).
    const offUpdate = onUpdateStatusChange(() => applyTexts());

    // Menü açıkken dışarı dokunmak / Escape kapatır — sahneye kabarmaz.
    const onDocPointer = (ev) => {
      if (!moreMenu.classList.contains('is-open')) return;
      if (ev.target instanceof Element && badge.contains(ev.target)) return;
      closeMore();
    };
    const onDocKey = (ev) => {
      if (ev.key === 'Escape') closeMore();
    };
    document.addEventListener('pointerdown', onDocPointer, true);
    document.addEventListener('keydown', onDocKey, true);

    const dispose = mountHeroAvatar(canvas, {
      onPoke: () => hint.classList.add('hidden'),
    });
    // Görünüm her açılışta yeniden kurulduğu için abonelik mutlaka iptal
    // edilir; aksi halde dil değişiminde ölü görünümler de güncellenir.
    const offLang = onLangChange(() => { applyTexts(); nameField.refresh(); });
    view.addEventListener('shell:viewleave', () => {
      dispose();
      nameField.destroy();
      offLang();
      offUpdate();
      document.removeEventListener('pointerdown', onDocPointer, true);
      document.removeEventListener('keydown', onDocKey, true);
    }, { once: true });

    return view;
  },
  onExit({ node }) {
    node.dispatchEvent(new CustomEvent('shell:viewleave'));
  },
});
