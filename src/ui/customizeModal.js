// Brutal Party — Karakter Özelleştirme Modali (Character Customization UI)
// Cihaz-başı TEK profil: sekmeler yok, kullanıcı kendini bir kere belirler.
// Hem Ana Menüden, hem TV lobisinden, hem telefon kumandasından açılır.
import {
  AVATAR_PALETTES,
  AVATAR_EXPRESSIONS,
  AVATAR_ACCESSORIES,
  AVATAR_PATTERNS,
  getAvatarProfile,
  saveAvatarProfile,
  resetAvatarProfile,
} from '../core/customizationManager.js';
import { drawBrutalAvatar } from './characterRenderer.js';
import { showInstallToast } from './toast.js';

let currentCustom = null;
let animFrameId = null;
let onSaveCallback = null;
let previewAngle = 0;
let previewBlinkTimer = 0;
let isPreviewBlinking = false;

export function openCustomizeModal(onSave) {
  onSaveCallback = (typeof onSave === 'function') ? onSave : null;
  currentCustom = getAvatarProfile();

  let modalEl = document.getElementById('customize-modal');
  if (!modalEl) {
    createModalDOM();
    modalEl = document.getElementById('customize-modal');
  }

  modalEl.classList.remove('hidden');
  renderSelectionGrids();
  startPreviewLoop();
}

export function closeCustomizeModal() {
  const modalEl = document.getElementById('customize-modal');
  if (modalEl) modalEl.classList.add('hidden');
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
      <div class="customize-card">
        <div class="customize-header">
          <div class="customize-header-left">
            <span class="customize-badge">🎭 AVATAR ATÖLYESİ</span>
            <h2 class="customize-title">KARAKTERİN</h2>
          </div>
          <button class="customize-close-btn" id="btn-close-customize" type="button" aria-label="Kapat">✕</button>
        </div>

        <div class="customize-body">
          <!-- Sol: 60 FPS Canlı Avatar Önizleme Tuvali -->
          <div class="customize-preview-box">
            <div class="preview-stage" id="customize-preview-stage">
              <canvas id="customize-preview-canvas" width="220" height="220"></canvas>
            </div>
            <div class="preview-tip">Döndürmek için parmağınızı / fareyi kaydırın</div>
            <div class="preview-actions">
              <button id="btn-reset-customize" class="btn-reset-customize" type="button">↺ RASTGELE KARAKTER</button>
            </div>
          </div>

          <!-- Sağ: Özelleştirme Seçenekleri Izgarası -->
          <div class="customize-options-scroll">
            <!-- 1. Renk Seçimi -->
            <div class="custom-section">
              <div class="custom-section-title">🎨 GÖVDE RENGİ</div>
              <div class="palette-grid" id="grid-palettes"></div>
            </div>

            <!-- 2. Yüz İfadesi -->
            <div class="custom-section">
              <div class="custom-section-title">👀 YÜZ VE BAKIŞ</div>
              <div class="chips-grid" id="grid-expressions"></div>
            </div>

            <!-- 3. Başlık & Aksesuar -->
            <div class="custom-section">
              <div class="custom-section-title">🧢 BAŞLIK VE AKSESUAR</div>
              <div class="chips-grid" id="grid-accessories"></div>
            </div>

            <!-- 4. Gövde Deseni -->
            <div class="custom-section">
              <div class="custom-section-title">🏁 GÖVDE DESENİ</div>
              <div class="chips-grid" id="grid-patterns"></div>
            </div>
          </div>
        </div>

        <div class="customize-footer">
          <button class="btn-save-customize" id="btn-save-customize" type="button">✓ KAYDET VE TAMAMLA</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);

  // Olay Dinleyicileri
  document.getElementById('btn-close-customize')?.addEventListener('click', closeCustomizeModal);
  document.getElementById('customize-backdrop')?.addEventListener('click', closeCustomizeModal);

  document.getElementById('btn-save-customize')?.addEventListener('click', () => {
    if (currentCustom) {
      saveAvatarProfile(currentCustom);
    }
    showInstallToast('✓ Karakterin kaydedildi!');
    closeCustomizeModal();
  });

  document.getElementById('btn-reset-customize')?.addEventListener('click', () => {
    currentCustom = resetAvatarProfile();
    renderSelectionGrids();
    showInstallToast('🎲 Rastgele karakter üretildi.');
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
    palGrid.innerHTML = AVATAR_PALETTES.map((p) => {
      const isSelected = currentCustom.color.toLowerCase() === p.hex.toLowerCase();
      return `
        <button class="color-swatch-btn ${isSelected ? 'selected' : ''}" data-hex="${p.hex}" style="background-color: ${p.hex}" title="${p.name}" type="button">
          ${isSelected ? '<span class="swatch-check">✓</span>' : ''}
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
          <span class="chip-icon">${exp.icon}</span>
          <span class="chip-title">${exp.name}</span>
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

  // 3. Aksesuarlar
  const accGrid = document.getElementById('grid-accessories');
  if (accGrid) {
    accGrid.innerHTML = AVATAR_ACCESSORIES.map((acc) => {
      const isSelected = currentCustom.accessory === acc.id;
      return `
        <button class="custom-chip-btn ${isSelected ? 'selected' : ''}" data-id="${acc.id}" type="button">
          <span class="chip-icon">${acc.icon}</span>
          <span class="chip-title">${acc.name}</span>
        </button>
      `;
    }).join('');

    accGrid.onclick = (e) => {
      const btn = e.target.closest('.custom-chip-btn');
      if (!btn) return;
      currentCustom.accessory = btn.dataset.id;
      saveAvatarProfile(currentCustom);
      renderSelectionGrids();
    };
  }

  // 4. Desenler
  const patGrid = document.getElementById('grid-patterns');
  if (patGrid) {
    patGrid.innerHTML = AVATAR_PATTERNS.map((pat) => {
      const isSelected = currentCustom.pattern === pat.id;
      return `
        <button class="custom-chip-btn ${isSelected ? 'selected' : ''}" data-id="${pat.id}" type="button">
          <span class="chip-icon">${pat.icon}</span>
          <span class="chip-title">${pat.name}</span>
        </button>
      `;
    }).join('');

    patGrid.onclick = (e) => {
      const btn = e.target.closest('.custom-chip-btn');
      if (!btn) return;
      currentCustom.pattern = btn.dataset.id;
      saveAvatarProfile(currentCustom);
      renderSelectionGrids();
    };
  }
}

function startPreviewLoop() {
  if (animFrameId) cancelAnimationFrame(animFrameId);

  const canvas = document.getElementById('customize-preview-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

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

    // Temizle
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const bounce = Math.sin(now * 0.004) * 4;

    // Avatar Çizimi (yazısız önizleme)
    if (currentCustom) {
      drawBrutalAvatar(ctx, cx, cy + bounce, 56, {
        color: currentCustom.color,
        expression: currentCustom.expression,
        accessory: currentCustom.accessory,
        pattern: currentCustom.pattern,
        facingAngle: previewAngle,
        isBlinking: isPreviewBlinking,
        showPips: false,
        showPointer: false,
        borderWidth: 4,
        shadowOffset: 5,
      });
    }

    const modalEl = document.getElementById('customize-modal');
    if (modalEl && !modalEl.classList.contains('hidden')) {
      animFrameId = requestAnimationFrame(loop);
    }
  };

  animFrameId = requestAnimationFrame(loop);
}

// ── Ana Menü Karakter Kartı Canlı Önizleme & Orkestrasyonu ──
let menuAnimFrameId = null;
let menuAvatarAngle = 0;
let menuBlinkTimer = 0;
let isMenuBlinking = false;

export function initMenuAvatarCard() {
  const cardEl = document.getElementById('menu-customize-card');
  const canvasEl = document.getElementById('menu-avatar-canvas');
  if (!canvasEl) return;

  const updateCardDetails = () => {
    const custom = getAvatarProfile();
    const colorObj = AVATAR_PALETTES.find((p) => p.hex.toLowerCase() === (custom.color || '').toLowerCase()) || { name: 'ÖZEL', hex: custom.color };
    const expObj = AVATAR_EXPRESSIONS.find((e) => e.id === custom.expression) || { name: 'Odaklı', icon: '👀' };
    const accObj = AVATAR_ACCESSORIES.find((a) => a.id === custom.accessory) || { name: 'Sade', icon: '⚪' };

    const colorPill = document.getElementById('menu-avatar-color-pill');
    if (colorPill) {
      colorPill.textContent = colorObj.name;
      colorPill.style.backgroundColor = custom.color;
      colorPill.style.color = '#FFFFFF';
    }

    const expPill = document.getElementById('menu-avatar-exp-pill');
    if (expPill) {
      expPill.textContent = `${expObj.icon} ${expObj.name}`;
    }

    const accPill = document.getElementById('menu-avatar-acc-pill');
    if (accPill) {
      accPill.textContent = `${accObj.icon} ${accObj.name}`;
    }
  };

  updateCardDetails();

  // Customization değiştiğinde kartı anında tazele
  window.addEventListener('brutal_customization_changed', () => {
    updateCardDetails();
  });

  // Tıklama ile modal açılışı
  cardEl?.addEventListener('click', (e) => {
    // Eğer doğrudan bir butona basılmadıysa da tüm karta tıklamayı destekle
    openCustomizeModal();
  });

  // 60 FPS Canlı Menü Önizleme Döngüsü
  const ctx = canvasEl.getContext('2d');
  let lastTime = performance.now();

  const menuLoop = (now) => {
    const dt = Math.min(0.08, (now - lastTime) / 1000);
    lastTime = now;

    // Göz kırpma
    menuBlinkTimer += dt;
    if (menuBlinkTimer > 3.0) {
      isMenuBlinking = true;
      if (menuBlinkTimer > 3.25) {
        isMenuBlinking = false;
        menuBlinkTimer = 0;
      }
    }

    // Yavaş salınım
    menuAvatarAngle += dt * 0.35;

    // Canvas temizleme
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

    const cx = canvasEl.width / 2;
    const cy = canvasEl.height / 2;
    const bounce = Math.sin(now * 0.0035) * 3;

    const custom = getAvatarProfile();
    drawBrutalAvatar(ctx, cx, cy + bounce, 36, {
      color: custom.color,
      expression: custom.expression,
      accessory: custom.accessory,
      pattern: custom.pattern,
      facingAngle: menuAvatarAngle,
      isBlinking: isMenuBlinking,
      showPips: false,
      showPointer: false,
      borderWidth: 3,
      shadowOffset: 4,
    });

    const menuOverlay = document.getElementById('menu-overlay');
    if (menuOverlay && !menuOverlay.classList.contains('hidden')) {
      menuAnimFrameId = requestAnimationFrame(menuLoop);
    } else {
      menuAnimFrameId = null;
    }
  };

  if (!menuAnimFrameId) {
    menuAnimFrameId = requestAnimationFrame(menuLoop);
  }

  // Menü tekrar açıldığında döngüyü yeniden başlatmak için observer
  const menuOverlay = document.getElementById('menu-overlay');
  if (menuOverlay) {
    const observer = new MutationObserver(() => {
      if (!menuOverlay.classList.contains('hidden') && !menuAnimFrameId) {
        lastTime = performance.now();
        menuAnimFrameId = requestAnimationFrame(menuLoop);
      }
    });
    observer.observe(menuOverlay, { attributes: true, attributeFilter: ['class'] });
  }
}
