// Home — uygulamanın merkezi. Sahne dili (`styles/scene.css` ortak kaynak):
//
//   · Tam kaplama arena, düz sayfa yüzeyi yok
//   · Merkezde oyuncu karakterimiz (canlı avatar) + isim rozeti
//   · SAĞ ALT: ODA KUR + OYNA — iki ana eylem yan yana (ikincil solda, altın
//     sağda). Oyun modlarını OYNA açar, oda ekranını ODA KUR.
//   · SAĞ KENAR: KODLA, altında KURULUM — iki ince eylem
//
// Dört eylem de `.scene-btn` ailesinden: aynı geometri, üç ağırlık. Dikey akış,
// kart ızgarası ve web-sayfası listesi yok. Mod seçimi (TV / ONLINE) oda
// ekranının işidir.

import { getTabletopIconSvg } from '../../core/tabletopIcons.js';
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
 * Sahne düğmesi: `weight` = 'gold' | 'teal' | 'ghost'.
 * `at` konum/ölçü sınıfı ekler (`home-play`, `home-room`, `home-join`); aile
 * kuralı `.scene-btn` üzerinde kalır, yerleşim `home.css`'te yerelleşir.
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

registerView('home', {
  title: 'BRUTAL PARTY',
  // Gezinmenin ilk hedefi (kök). `chrome: 'cinema'` saydam krom: sahne
  // görselinin üstüne biner.
  rail: { icon: 'home', label: 'ANASAYFA', order: 0 },
  chrome: 'cinema',
  build(ctx) {
    const { actions: actions_, openView } = ctx;
    const view = el('div', 'scene home-scene');

    view.append(
      el('div', 'scene-backdrop', ''),
      el('div', 'scene-spotlight', ''),
      el('div', 'scene-floor', ''),
      el('div', 'scene-vignette', ''),
    );

    // ── Merkez: karakter + düzenlenebilir isim ──
    // `is-staged`: karakter arena diskinin üst kenarına oturur (bkz. scene.css).
    const stage = el('div', 'scene-hero home-hero is-staged');
    const canvas = document.createElement('canvas');
    canvas.className = 'scene-hero-canvas home-hero-canvas';
    stage.append(canvas);

    const nameField = createPlayerNameField({
      prefix: 'home-',
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
    badge.append(nameField.el);
    stage.append(badge);
    view.append(stage);

    // ── Sağ alt: ODA KUR + OYNA, yan yana ──
    // İki ana eylem tek bir çift hâlinde: ikincil (teal) solda, ana (altın)
    // sağda. Ayrı köşelere bölünmeleri sahneyi ikiye yapıyordu.
    const actions = el('div', 'home-actions');

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

    actions.append(roomBtn, playBtn);
    view.append(actions);

    // ── Sağ kenar: KODLA, altında KURULUM ──
    // Profil kartındaki büyük "Install" satırı buraya küçük bir simge olarak
    // taşındı: uygulamayı yüklemek ana menüden bir dokunuş, ikinci ekran değil.
    const sideRail = el('div', 'home-side');

    const joinBtn = sceneButton({
      id: 'home-join', icon: 'message_square', label: 'shell.side.join',
      weight: 'ghost', at: 'home-join',
      onClick: () => {
        playMenuTick();
        actions_.openJoin?.('', actions_.getPlatformMode?.() === 'ONLINE' ? 'ONLINE' : 'TV_CONSOLE');
      },
    });

    const installBtn = sceneButton({
      at: 'home-install', weight: 'ghost', focus: 'install',
      icon: 'download', label: 'menu.install',
      onClick: () => playMenuTick(),
    });
    installBtn.dataset.installApp = '';

    sideRail.append(joinBtn, installBtn);
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
      view.querySelector('.home-facts').textContent = t('shell.home.facts');
      // Uygulama zaten yüklüyse (standalone) simge hiç gösterilmez.
      updateInstallButtonVisibility();
    }
    applyTexts();

    const dispose = mountHeroAvatar(canvas);
    // Görünüm her açılışta yeniden kurulduğu için abonelik mutlaka iptal
    // edilir; aksi halde dil değişiminde ölü görünümler de güncellenir.
    const offLang = onLangChange(() => { applyTexts(); nameField.refresh(); });
    view.addEventListener('shell:viewleave', () => {
      dispose();
      nameField.destroy();
      offLang();
    }, { once: true });

    return view;
  },
  onExit({ node }) {
    node.dispatchEvent(new CustomEvent('shell:viewleave'));
  },
});
