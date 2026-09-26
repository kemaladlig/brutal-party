// Brutal Party — Karakter Özelleştirme Modali (Character Customization UI)
// Cihaz-başı TEK profil: renk + yüz ifadesi. Erişuar ve gövde deseni YOK
// (sahada da, menüde de; siluet daima tam yuvarlak).
// Hem Ana Menüden, hem TV lobisinden, hem telefon kumandasından açılır.
import {
  getActivePalettes,
  AVATAR_EXPRESSIONS,
  getAvatarProfile,
  saveAvatarProfile,
  resetAvatarProfile,
  paletteName,
  expressionName,
} from '../core/customizationManager.js';
import { openOverlay, closeOverlay } from './overlayHost.js';
import { t, onLangChange } from '../i18n.js';
import { safeGet, safeSet } from '../core/safeStorage.js';
import { syncStageCanvas, drawAvatarStage, observeStageCanvas, beginStageFrame, drawSparks } from './avatarStage.js';
import { createAvatarLife } from './avatarLife.js';
import { prefersReducedMotion } from './motion.js';
import { showInstallToast } from './toast.js';
import { getStoredPlayerName, storePlayerName, cleanPlayerName, generateNick } from '../net.js';
import { playMenuPop, playMenuTick } from '../audio.js';
import { getTabletopIconSvg } from '../core/tabletopIcons.js';

let currentCustom = null;
let animFrameId = null;
let onSaveCallback = null;
let previewAngle = 0;
let previewBlinkTimer = 0;
let isPreviewBlinking = false;
const TAB_KEY = 'brutalparty.avatar.tab';
const TAB_IDS = ['color', 'face'];
let activeTab = 'color';

function loadActiveTab() {
  try {
    const raw = safeGet(TAB_KEY);
    if (TAB_IDS.includes(raw)) activeTab = raw;
  } catch {}
  return activeTab;
}

function setActiveTab(tabId) {
  if (!TAB_IDS.includes(tabId)) return;
  activeTab = tabId;
  try { safeSet(TAB_KEY, tabId); } catch {}
  applyTabVisibility();
  requestAnimationFrame(resetCustomizeScroll);
}

function applyTabVisibility() {
  document.querySelectorAll('.customize-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === activeTab);
  });
  document.querySelectorAll('.custom-section[data-section]').forEach((sec) => {
    sec.classList.toggle('hidden', sec.dataset.section !== activeTab);
  });
}

function resetCustomizeScroll() {
  const body = document.querySelector('.customize-body');
  const options = document.querySelector('.customize-options-scroll');
  if (body) body.scrollTop = 0;
  if (options) options.scrollTop = 0;
}

export function openCustomizeModal(onSave) {
  onSaveCallback = (typeof onSave === 'function') ? onSave : null;
  currentCustom = getAvatarProfile();

  let modalEl = document.getElementById('customize-modal');
  if (!modalEl) {
    createModalDOM();
    modalEl = document.getElementById('customize-modal');
  }

  modalEl.classList.remove('hidden');
  loadActiveTab();
  applyTabVisibility();
  renderSelectionGrids();
  requestAnimationFrame(resetCustomizeScroll);
  startPreviewLoop();
  openOverlay('customize', { el: modalEl, onClose: closeCustomizeModal });
}

export function closeCustomizeModal() {
  const modalEl = document.getElementById('customize-modal');
  if (modalEl) modalEl.classList.add('hidden');
  closeOverlay('customize');
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  if (typeof onSaveCallback === 'function') {
    try {
      onSaveCallback(currentCustom);
    } catch {}
    onSaveCallback = null;
  }
}

function createModalDOM() {
  const modalHtml = `
    <div id="customize-modal" class="customize-modal hidden">
      <div class="customize-backdrop" id="customize-backdrop"></div>
      <div class="customize-card" role="dialog" aria-modal="true" aria-labelledby="customize-title">
        <div class="customize-header">
          <div class="customize-header-left">
            <span class="customize-badge" data-i18n="custom.badge">${t('custom.badge')}</span>
            <h2 class="customize-title" id="customize-title" data-i18n="custom.title">${t('custom.title')}</h2>
          </div>
          <button class="customize-close-btn" id="btn-close-customize" type="button" aria-label="${t('pause.close')}">${getTabletopIconSvg('close', { size: 18 })}</button>
        </div>

        <div class="customize-body">
          <!-- Sol: 60 FPS Canlı Avatar Önizleme Tuvali -->
          <div class="customize-preview-box">
            <div class="preview-stage" id="customize-preview-stage">
              <canvas id="customize-preview-canvas" width="220" height="220"></canvas>
            </div>
            <div class="preview-tip" data-i18n="custom.tip">${t('custom.tip')}</div>
            <div class="preview-actions">
              <button id="btn-reset-customize" class="btn-reset-customize" type="button" data-i18n="custom.random">${t('custom.random')}</button>
            </div>
          </div>

          <!-- Sağ: Özelleştirme Seçenekleri (sekmeli) -->
          <div class="customize-options-scroll">
            <div class="customize-tabs" role="tablist">
              <button class="customize-tab active" data-tab="color" type="button" data-i18n="custom.tabColor">${t('custom.tabColor')}</button>
              <button class="customize-tab" data-tab="face" type="button" data-i18n="custom.tabFace">${t('custom.tabFace')}</button>
            </div>

            <!-- 1. Renk Seçimi -->
            <div class="custom-section" data-section="color">
              <div class="palette-grid" id="grid-palettes"></div>
            </div>

            <!-- 2. Yüz İfadesi -->
            <div class="custom-section hidden" data-section="face">
              <div class="chips-grid" id="grid-expressions"></div>
            </div>
          </div>
        </div>

        <div class="customize-footer">
          <button class="btn-save-customize" id="btn-save-customize" type="button" data-i18n="custom.save">${t('custom.save')}</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);

  // Olay Dinleyicileri
  document.getElementById('btn-close-customize')?.addEventListener('click', closeCustomizeModal);
  document.getElementById('customize-backdrop')?.addEventListener('click', closeCustomizeModal);

  // Sekme çubuğu
  document.querySelector('.customize-tabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.customize-tab');
    if (!btn) return;
    setActiveTab(btn.dataset.tab);
  });

  document.getElementById('btn-save-customize')?.addEventListener('click', () => {
    if (currentCustom) {
      saveAvatarProfile(currentCustom);
    }
    showInstallToast(t('custom.saved'));
    closeCustomizeModal();
  });

  document.getElementById('btn-reset-customize')?.addEventListener('click', () => {
    currentCustom = resetAvatarProfile();
    renderSelectionGrids();
    showInstallToast(t('custom.diced'));
  });

  // ESC ile kapatma
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modalEl = document.getElementById('customize-modal');
      if (modalEl && !modalEl.classList.contains('hidden')) {
        closeCustomizeModal();
      }
    }
  });

  // Önizleme tuvali mouse/touch yön takibi (Canvas'a güvenli bağlı)
  const stage = document.getElementById('customize-preview-stage');
  let isDragging = false;
  let startX = 0;

  const onDown = (clientX) => {
    if (typeof clientX !== 'number') return;
    isDragging = true;
    startX = clientX;
  };

  const onMove = (clientX) => {
    if (!isDragging || typeof clientX !== 'number') return;
    const dx = clientX - startX;
    startX = clientX;
    previewAngle += dx * 0.025;
  };

  const onUp = () => { isDragging = false; };

  if (stage) {
    stage.addEventListener('mousedown', (e) => onDown(e.clientX));
    stage.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches[0]) onDown(e.touches[0].clientX);
    }, { passive: true });
  }

  window.addEventListener('mousemove', (e) => {
    if (isDragging) onMove(e.clientX);
  });
  window.addEventListener('mouseup', onUp);

  window.addEventListener('touchmove', (e) => {
    if (isDragging && e.touches && e.touches[0]) {
      onMove(e.touches[0].clientX);
    }
  }, { passive: true });
  window.addEventListener('touchend', onUp, { passive: true });
  window.addEventListener('touchcancel', onUp, { passive: true });
}

function renderSelectionGrids() {
  if (!currentCustom) return;

  // 1. Renkler
  const palGrid = document.getElementById('grid-palettes');
  if (palGrid) {
    palGrid.innerHTML = getActivePalettes().map((p) => {
      const isSelected = currentCustom.color.toLowerCase() === p.hex.toLowerCase();
      return `
        <button class="color-swatch-btn ${isSelected ? 'selected' : ''}" data-hex="${p.hex}" style="background-color: ${p.hex}" title="${paletteName(p)}" type="button">
          ${isSelected ? `<span class="swatch-check">${getTabletopIconSvg('check', { size: 13, strokeWidth: 3 })}</span>` : ''}
        </button>
      `;
    }).join('');

    palGrid.onclick = (e) => {
      const btn = e.target.closest('.color-swatch-btn');
      if (!btn) return;
      currentCustom.color = btn.dataset.hex;
      saveAvatarProfile(currentCustom);
      renderSelectionGrids();
    };
  }

  // 2. İfadeler
  const expGrid = document.getElementById('grid-expressions');
  if (expGrid) {
    expGrid.innerHTML = AVATAR_EXPRESSIONS.map((exp) => {
      const isSelected = currentCustom.expression === exp.id;
      return `
        <button class="custom-chip-btn ${isSelected ? 'selected' : ''}" data-id="${exp.id}" type="button">
          <span class="chip-icon">${getTabletopIconSvg(exp.icon, { size: 18 })}</span>
          <span class="chip-title">${expressionName(exp.id, exp.name)}</span>
        </button>
      `;
    }).join('');

    expGrid.onclick = (e) => {
      const btn = e.target.closest('.custom-chip-btn');
      if (!btn) return;
      currentCustom.expression = btn.dataset.id;
      saveAvatarProfile(currentCustom);
      renderSelectionGrids();
    };
  }
}

function startPreviewLoop() {
  if (animFrameId) cancelAnimationFrame(animFrameId);

  const canvas = document.getElementById('customize-preview-canvas');
  if (!canvas) return;

  // Ölçü yalnız kutu değiştiğinde tazelenir; her karede `getBoundingClientRect`
  // çağırmak layout zorlar. `ResizeObserver` modal açılıp kapandığında da
  // tetiklenir (gizliyken ölçü 0 gelir — bkz. `observeStageCanvas`).
  let stage = syncStageCanvas(canvas);
  observeStageCanvas(canvas, () => { stage = syncStageCanvas(canvas); });

  let lastTime = performance.now();

  const loop = (now) => {
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;

    // Göz kırpma döngüsü
    previewBlinkTimer += dt;
    if (previewBlinkTimer > 3.2) {
      isPreviewBlinking = true;
      if (previewBlinkTimer > 3.4) {
        isPreviewBlinking = false;
        previewBlinkTimer = 0;
      }
    }

    // Yavaş otomatik salınım
    previewAngle += dt * 0.45;

    const { w, h, r } = stage;
    const ctx = beginStageFrame(canvas);

    // Avatar Çizimi (yazısız önizleme)
    if (currentCustom) {
      drawAvatarStage(ctx, w, h, r, {
        color: currentCustom.color,
        expression: currentCustom.expression,
        facingAngle: previewAngle,
        isBlinking: isPreviewBlinking,
      }, Math.sin(now * 0.004) * r * 0.08);
    }

    const modalEl = document.getElementById('customize-modal');
    // Kare kutusu: çizimden sızan klip/dönüşüm kare sonunda düşer.
    ctx.restore();
    if (modalEl && !modalEl.classList.contains('hidden')) {
      animFrameId = requestAnimationFrame(loop);
    }
  };

  animFrameId = requestAnimationFrame(loop);
}

// ── Ana Menü Karakter Kartı Canlı Önizleme & Orkestrasyonu ──
// Kartın yaşamı (zıplama/bakış/ifade/kıvılcım) `avatarLife.js` makinesinin
// `modal` preset'idir — ana menü kahramanıyla birebir aynı fizik, sayılar
// preset'te yaşar; burada kopyalanmaz.
let menuAnimFrameId = null;
// Pencere-imleci aboneliği her görünüm inşasında yenisiyle DEĞİŞTİRİLİR.
let detachCardGaze = null;

/**
 * Profil kartını bağlar. Tüm sorgular `root` içinde yapılır: kart markup'ı
 * app shell'in Profil görünümüne taşındı, `document` geneli arama hem kırılgan
 * hem de başka bir görünümde aynı id'yi bulma riski taşıyordu.
 * @param {ParentNode} root — Kartın bulunduğu kapsayıcı.
 */
export function initMenuAvatarCard(root = document) {
  const cardEl = root.querySelector('#menu-customize-card');
  const stageEl = root.querySelector('#menu-avatar-stage');
  const canvasEl = root.querySelector('#menu-avatar-canvas');
  if (!canvasEl) return;

  // Kartın yaşam makinesi — heroAvatar ile aynı fabrika, `modal` preset'i.
  const life = createAvatarLife({ preset: 'modal', reducedMotion: prefersReducedMotion });

  // Karttaki kullanıcı adı ve kuşanılan eşyalar (menü her açıldığında ve özelleştirme bitince tazelenir)
  const updateCardName = () => {
    const nameEl = root.querySelector('#menu-avatar-name');
    if (nameEl) {
      try {
        nameEl.textContent = getStoredPlayerName() || 'OYUNCU';
      } catch {
        nameEl.textContent = 'OYUNCU';
      }
    }

    const equippedEl = root.querySelector('#menu-avatar-equipped');
    if (equippedEl) {
      const prof = getAvatarProfile();
      const exprId = prof?.expression || 'FOCUS';
      const exprDef = AVATAR_EXPRESSIONS.find((e) => e.id === exprId);
      const expr = expressionName(exprId, 'Odaklı');
      // Karakterin tek özellikleri renk ve yüz: "kuşanılan" tek çip yüz ifadesi.
      // İkon `tabletopIcons`'tan gelir ve İFADENİN KENDİ ikonudur (AGENTS.md §7:
      // ham OS emojisi yasak; tüm çipleri 'eye' çizmek de aynı hata).
      equippedEl.innerHTML = `<span class="equipped-chip expr-chip">${getTabletopIconSvg(exprDef?.icon || 'eye', { size: 13 })}<span>${expr}</span></span>`;
    }
  };
  updateCardName();

  const viewRow = root.querySelector('#menu-name-view-row');

  // İsim düzenleme artık `playerNameField.js`in işi (ana menü rozeti de aynı
  // bileşeni kullanıyor). Burada yalnız "kart görünürlüğü değişti" anında
  // alanı tazelemek kalır; kendi kalem/zar/input bağlantılarımızı TUTMAYIZ.
  const closeNameEdit = () => {
    root.querySelector('#menu-name-input-row')?.classList.add('hidden');
    viewRow?.classList.remove('hidden');
  };

  // Karakteri zıplatma & kıvılcım saçma tepkisi — fizik `avatarLife.js`'te.
  // İtki, hız ve parçacık ölçüleri yarıçapa oranlıdır (bkz. `avatarStage.js`):
  // kutular 68–148px arası değiştiği için sabit px her boyutta farklı hissettirir.
  const boingAt = (clientX, clientY) => {
    const rect = canvasEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const custom = cachedProfile || getAvatarProfile();
    life.poke({
      x: clientX - rect.left,
      y: clientY - rect.top,
      centerX: rect.width / 2,
      centerY: rect.height / 2,
      radius: stage.r,
      color: custom?.color,
    });
    playMenuPop();
  };

  // Sahneye dokunulduğunda doğrudan zıplat ve tatmin edici geri bildirim ver
  stageEl?.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    boingAt(e.clientX, e.clientY);
  });

  // Sahne üzerine gelindiğinde meraklı ve neşeli tepki ver (dokunma daveti animasyonu)
  stageEl?.addEventListener('pointerenter', () => {
    life.hover();
  });

  // Kart gövdesine dokunulduğunda açık isim düzenlemesi varsa kapat
  cardEl?.addEventListener('click', (e) => {
    // Tıklanan eleman butonlar veya input değilse ve isim düzenleme açıksa kapat
    const target = e.target;
    if (target && target.closest && (target.closest('.hero-custom-btn') || target.closest('.menu-name-input-row') || target.closest('.menu-name-icon-btn'))) {
      return;
    }
    // `inputRow` modül-değişkeni app-shell refactor'ünde silinmişti ama bu
    // handler onu okumaya devam ediyordu: kartın boş bölgesine her tık
    // `ReferenceError` fırlatıp kapatmayı engelliyordu. Canlı sorgu.
    const inputRow = root.querySelector('#menu-name-input-row');
    if (inputRow && !inputRow.classList.contains('hidden')) {
      closeNameEdit();
    }
  });


  // İmleç / Dokunmatik Takibi (Karakter ekrandaki kullanıcıyı merakla izler) —
  // bakış hedefi ve hareketsizlik TTL'si yaşam makinesinin içinde (`gazeHold`).
  // Kart her görünüm inşasında yeniden bağlanır: önceki pencere aboneliği
  // kaldırılmaz her ölü kart imleci beslemeye devam ederdi — gerçek sızıntı.
  const onWindowPointer = (e) => {
    const rect = canvasEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    life.gaze(Math.atan2(
      e.clientY - (rect.top + rect.height / 2),
      e.clientX - (rect.left + rect.width / 2),
    ));
  };
  detachCardGaze?.();
  window.addEventListener('pointermove', onWindowPointer, { passive: true });
  detachCardGaze = () => window.removeEventListener('pointermove', onWindowPointer);

  // 60-120 FPS Canlı Menü Önizleme & Fizik Döngüsü
  // Ölçü yalnız kutu değiştiğinde tazelenir: menü gizliyken `initMenuAvatarCard`
  // çalışıyor ve 0×0 ölçüyor; `ResizeObserver` menü açıldığında yeniden ölçer
  // (bkz. `observeStageCanvas`).
  let stage = syncStageCanvas(canvasEl);
  observeStageCanvas(canvasEl, () => { stage = syncStageCanvas(canvasEl); });
  let lastTime = performance.now();
  let cachedProfile = getAvatarProfile();

  window.addEventListener('brutal_customization_changed', (e) => {
    cachedProfile = e.detail?.customization || getAvatarProfile();
    updateCardName();
  });

  const menuLoop = (now) => {
    const dt = Math.min(0.06, (now - lastTime) / 1000);
    lastTime = now;

    // Yaşam makinesi: göz kırpma, periyodik mini hop, bakış (imleç/salınım),
    // zıplama fiziği, nefes, ifade coşkusu, halka parıltısı ve kıvılcım
    // ilerletme — hepsi `avatarLife.js`'te. Siluet daima tam yuvarlak:
    // makine yalnız konum + yeknesak ölçek üretir.
    const custom = cachedProfile || getAvatarProfile();
    const { w, h, r } = stage;
    const out = life.step(now, dt, r, { expression: custom.expression });

    // Canvas temizleme + ölçü (bkz. `syncStageCanvas` / `beginStageCanvas`)
    const ctx = beginStageFrame(canvasEl);

    drawAvatarStage(ctx, w, h, r, {
      color: custom.color,
      expression: out.expression,
      facingAngle: out.facingAngle,
      isBlinking: out.isBlinking,
      scale: out.scale,
    }, out.yOffset, out.shadowScale, out.ringPulse);

    // Kıvılcım / Yıldız Parçacıkları (Boing efekti) — `avatarStage.js` tek kaynak.
    drawSparks(ctx, r, life.sparks);

    // Kare kutusu: çizimden sızan klip/dönüşüm kare sonunda düşer.
    ctx.restore();

    // Görünürlük kapısı döngünün İÇİNDE: kart sahne dışındayken rAF durur.
    // Kart artık app shell'in Profil görünümünde olduğu için `#menu-overlay`a
    // bağlamak yanlış olurdu; kapı doğrudan kartın kendi görünürlüğünden okunur.
    if (cardEl && !cardEl.getClientRects().length) {
      menuAnimFrameId = null;
      return;
    }
    menuAnimFrameId = requestAnimationFrame(menuLoop);
  };

  const isCardVisible = () => !cardEl || cardEl.getClientRects().length > 0;

  const startLoop = () => {
    if (menuAnimFrameId) return;
    lastTime = performance.now();
    menuAnimFrameId = requestAnimationFrame(menuLoop);
  };

  // İlk kare hemen çizilir: gözlemci düğüm DOM'a EKLENMEDEN kurulduğu için
  // ilk `isIntersecting` geçişi kaçabilir ve sahne boş kalırdı.
  if (isCardVisible()) {
    cachedProfile = getAvatarProfile();
    startLoop();
  }

  // Görünürlük geçişleri: sahneye girince başlat (döngü zaten içeride durur).
  if (typeof IntersectionObserver === 'function' && cardEl) {
    new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      updateCardName();
      cachedProfile = getAvatarProfile();
      startLoop();
    }).observe(cardEl);
  }
  // Dil değişiminde açık customize modalının ızgaraları anında yenilenir
  onLangChange(() => {
    updateCardName();
    const modalEl = document.getElementById('customize-modal');
    if (modalEl && !modalEl.classList.contains('hidden') && currentCustom) {
      renderSelectionGrids();
    }
  });
}

