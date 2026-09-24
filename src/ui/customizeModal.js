// Brutal Party — Karakter Özelleştirme Modali (Character Customization UI)
// Cihaz-başı TEK profil: sekmeler yok, kullanıcı kendini bir kere belirler.
// Hem Ana Menüden, hem TV lobisinden, hem telefon kumandasından açılır.
import {
  getActivePalettes,
  AVATAR_EXPRESSIONS,
  AVATAR_ACCESSORIES,
  AVATAR_PATTERNS,
  getAvatarProfile,
  saveAvatarProfile,
  resetAvatarProfile,
  paletteName,
  expressionName,
  accessoryName,
  patternName,
} from '../core/customizationManager.js';
import { t, onLangChange } from '../i18n.js';
import { safeGet, safeSet } from '../core/safeStorage.js';
import { drawBrutalAvatar } from './characterRenderer.js';
import { showInstallToast } from './toast.js';
import { getStoredPlayerName, storePlayerName, cleanPlayerName, generateNick } from '../net.js';
import { playMenuPop, playMenuTick } from '../audio.js';

let currentCustom = null;
let animFrameId = null;
let onSaveCallback = null;
let previewAngle = 0;
let previewBlinkTimer = 0;
let isPreviewBlinking = false;
const TAB_KEY = 'brutalparty.avatar.tab';
const TAB_IDS = ['color', 'face', 'acc', 'pattern'];
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
}

function applyTabVisibility() {
  document.querySelectorAll('.customize-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === activeTab);
  });
  document.querySelectorAll('.custom-section[data-section]').forEach((sec) => {
    sec.classList.toggle('hidden', sec.dataset.section !== activeTab);
  });
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
            <span class="customize-badge" data-i18n="custom.badge">${t('custom.badge')}</span>
            <h2 class="customize-title" data-i18n="custom.title">${t('custom.title')}</h2>
          </div>
          <button class="customize-close-btn" id="btn-close-customize" type="button" aria-label="${t('pause.close')}">✕</button>
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
              <button class="customize-tab" data-tab="acc" type="button" data-i18n="custom.tabAcc">${t('custom.tabAcc')}</button>
              <button class="customize-tab" data-tab="pattern" type="button" data-i18n="custom.tabPattern">${t('custom.tabPattern')}</button>
            </div>

            <!-- 1. Renk Seçimi -->
            <div class="custom-section" data-section="color">
              <div class="palette-grid" id="grid-palettes"></div>
            </div>

            <!-- 2. Yüz İfadesi -->
            <div class="custom-section hidden" data-section="face">
              <div class="chips-grid" id="grid-expressions"></div>
            </div>

            <!-- 3. Başlık & Aksesuar -->
            <div class="custom-section hidden" data-section="acc">
              <div class="chips-grid" id="grid-accessories"></div>
            </div>

            <!-- 4. Gövde Deseni -->
            <div class="custom-section hidden" data-section="pattern">
              <div class="chips-grid" id="grid-patterns"></div>
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

  // 3. Aksesuarlar
  const accGrid = document.getElementById('grid-accessories');
  if (accGrid) {
    accGrid.innerHTML = AVATAR_ACCESSORIES.map((acc) => {
      const isSelected = currentCustom.accessory === acc.id;
      return `
        <button class="custom-chip-btn ${isSelected ? 'selected' : ''}" data-id="${acc.id}" type="button">
          <span class="chip-icon">${acc.icon}</span>
          <span class="chip-title">${accessoryName(acc.id, acc.name)}</span>
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
          <span class="chip-title">${patternName(pat.id, pat.name)}</span>
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
      drawBrutalAvatar(ctx, cx, cy + bounce, 50, {
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
let currentAvatarAngle = 0;
let menuBlinkTimer = 0;
let isMenuBlinking = false;

// Fizik ve mikro-etkileşim durumları (sıfır GC, GPU dostu)
let pointerTargetAngle = 0;
let hasActivePointer = false;
let lastPointerTime = 0;

let jumpY = 0;
let jumpVy = 0;
let squashX = 1;
let squashY = 1;
let excitedTimer = 0;
const sparks = [];

export function initMenuAvatarCard() {
  const cardEl = document.getElementById('menu-customize-card');
  const stageEl = document.getElementById('menu-avatar-stage');
  const canvasEl = document.getElementById('menu-avatar-canvas');
  if (!canvasEl) return;

  // Karttaki kullanıcı adı ve kuşanılan eşyalar (menü her açıldığında ve özelleştirme bitince tazelenir)
  const updateCardName = () => {
    const nameEl = document.getElementById('menu-avatar-name');
    if (nameEl) {
      try {
        nameEl.textContent = getStoredPlayerName() || 'OYUNCU';
      } catch {
        nameEl.textContent = 'OYUNCU';
      }
    }

    const equippedEl = document.getElementById('menu-avatar-equipped');
    if (equippedEl) {
      const prof = getAvatarProfile();
      const expr = expressionName(prof?.expression || 'FOCUS', 'Odaklı');
      const acc = prof?.accessory && prof.accessory !== 'NONE' ? accessoryName(prof.accessory, '') : null;
      const pat = prof?.pattern && prof.pattern !== 'SOLID' ? patternName(prof.pattern, '') : null;

      let chips = `<span class="equipped-chip expr-chip">👀 ${expr}</span>`;
      if (acc) {
        chips += `<span class="equipped-chip acc-chip">✨ ${acc}</span>`;
      }
      if (pat) {
        chips += `<span class="equipped-chip pat-chip">🏁 ${pat}</span>`;
      }
      equippedEl.innerHTML = chips;
    }
  };
  updateCardName();

  const viewRow = document.getElementById('menu-name-view-row');
  const editBtn = document.getElementById('btn-edit-menu-name');
  const rerollBtn = document.getElementById('btn-reroll-menu-name');
  const inputRow = document.getElementById('menu-name-input-row');
  const nameInput = document.getElementById('input-menu-name');

  const closeNameEdit = () => {
    inputRow?.classList.add('hidden');
    viewRow?.classList.remove('hidden');
  };

  const saveMenuName = () => {
    const raw = (nameInput?.value || '').trim();
    const clean = raw ? cleanPlayerName(raw) : (getStoredPlayerName() || ensureStoredNick());
    storePlayerName(clean);
    updateCardName();
    closeNameEdit();
  };

  inputRow?.addEventListener('click', (e) => e.stopPropagation());

  editBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    try {
      if (nameInput) nameInput.value = getStoredPlayerName() || '';
    } catch {}
    viewRow?.classList.add('hidden');
    inputRow?.classList.remove('hidden');
    nameInput?.focus();
    nameInput?.select();
  });

  rerollBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    try {
      const cur = getStoredPlayerName() || '';
      const nick = generateNick(cur);
      storePlayerName(nick);
    } catch {}
    updateCardName();
    closeNameEdit();
    showInstallToast(t('custom.nickReady'));
  });

  document.getElementById('btn-save-menu-name')?.addEventListener('click', (e) => {
    e.stopPropagation();
    saveMenuName();
  });

  nameInput?.addEventListener('click', (e) => e.stopPropagation());
  nameInput?.addEventListener('input', (e) => {
    e.target.value = (e.target.value || '').toUpperCase();
  });
  nameInput?.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') saveMenuName();
    else if (e.key === 'Escape') closeNameEdit();
  });

  // Karakteri zıplatma & kıvılcım saçma tetikleyicisi (oyuncu dokununca canlı tepki)
  const triggerAvatarBoing = () => {
    jumpVy = -240;
    squashX = 0.88;
    squashY = 1.15;
    excitedTimer = 0.8;
    playMenuPop();

    // 8-12 adet neşeli neo-brutalist kıvılcım parçacığı
    const prof = getAvatarProfile();
    const cx = canvasEl.width / 2;
    const cy = canvasEl.height / 2;
    for (let i = 0; i < 10; i++) {
      const ang = (Math.PI * 2 * i) / 10 + (Math.random() - 0.5) * 0.4;
      const spd = 65 + Math.random() * 95;
      sparks.push({
        x: cx,
        y: cy - 10,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 45,
        color: i % 2 === 0 ? (prof?.color || '#D84727') : '#FFD700',
        size: 3 + Math.random() * 3.5,
        shape: i % 3 === 0 ? 'star' : (i % 3 === 1 ? 'cross' : 'square'),
        life: 1.0,
        decay: 1.6 + Math.random() * 0.8,
      });
    }
  };

  // Sahneye dokunulduğunda doğrudan zıplat ve tatmin edici geri bildirim ver
  stageEl?.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    triggerAvatarBoing();
  });

  // Sahne üzerine gelindiğinde meraklı ve neşeli tepki ver (dokunma daveti animasyonu)
  stageEl?.addEventListener('pointerenter', () => {
    excitedTimer = 0.8;
    squashX = 0.92;
    squashY = 1.08;
  });

  // Kart gövdesine dokunulduğunda açık isim düzenlemesi varsa kapat
  cardEl?.addEventListener('click', (e) => {
    // Tıklanan eleman butonlar veya input değilse ve isim düzenleme açıksa kapat
    const target = e.target;
    if (target && target.closest && (target.closest('.hero-custom-btn') || target.closest('.menu-name-input-row') || target.closest('.menu-name-icon-btn'))) {
      return;
    }
    if (inputRow && !inputRow.classList.contains('hidden')) {
      closeNameEdit();
    }
  });


  // İmleç / Dokunmatik Takibi (Karakter ekrandaki kullanıcıyı merakla izler)
  const handlePointerTrack = (clientX, clientY) => {
    const rect = canvasEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    pointerTargetAngle = Math.atan2(clientY - cy, clientX - cx);
    hasActivePointer = true;
    lastPointerTime = performance.now();
  };

  window.addEventListener('pointermove', (e) => {
    handlePointerTrack(e.clientX, e.clientY);
  }, { passive: true });

  // 60-120 FPS Canlı Menü Önizleme & Fizik Döngüsü
  const ctx = canvasEl.getContext('2d');
  let lastTime = performance.now();
  let cachedProfile = getAvatarProfile();

  window.addEventListener('brutal_customization_changed', (e) => {
    cachedProfile = e.detail?.customization || getAvatarProfile();
    updateCardName();
  });

  let idleHopTimer = 0;

  const menuLoop = (now) => {
    const dt = Math.min(0.06, (now - lastTime) / 1000);
    lastTime = now;

    // Göz kırpma döngüsü
    menuBlinkTimer += dt;
    if (menuBlinkTimer > 2.8) {
      isMenuBlinking = true;
      if (menuBlinkTimer > 3.05) {
        isMenuBlinking = false;
        menuBlinkTimer = 0;
      }
    }

    if (excitedTimer > 0) {
      excitedTimer -= dt;
    }

    // Periyodik neşeli mini zıplama ve göz kırpma (kullanıcıya canlı ve dokunulabilir olduğunu hissettirir)
    idleHopTimer += dt;
    if (idleHopTimer > 4.8 && jumpY === 0 && jumpVy === 0) {
      idleHopTimer = 0;
      jumpVy = -190;
      squashX = 0.94;
      squashY = 1.06;
      excitedTimer = 0.6;
    }

    // İmleç hareketsizliği kontrolü (>2.2 sn ise doğal etrafa bakınma modu)
    if (hasActivePointer && now - lastPointerTime > 2200) {
      hasActivePointer = false;
    }

    // Hedef bakış açısı: imleç varsa oraya bak, yoksa hafif canlı etrafa bakınma
    let desiredAngle;
    if (hasActivePointer) {
      desiredAngle = pointerTargetAngle;
    } else {
      // Doğal etrafa bakınma: yumuşak sinüs salınımı
      desiredAngle = Math.sin(now * 0.0014) * 0.42;
    }

    // En kısa açısal interpolasyon (wrap-around destekli)
    let angleDiff = desiredAngle - currentAvatarAngle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    currentAvatarAngle += angleDiff * Math.min(1, dt * 7.5);

    // Dikey Zıplama Fiziği (Boing & Yerçekimi)
    if (jumpY < 0 || jumpVy !== 0) {
      jumpVy += 820 * dt; // Yerçekimi
      jumpY += jumpVy * dt;
      if (jumpY >= 0) {
        jumpY = 0;
        jumpVy = 0;
        // Yere inme ezilmesi (landing squash)
        squashX = 1.18;
        squashY = 0.82;
      } else {
        // Havadayken uzama (air stretch)
        squashX = 0.94;
        squashY = 1.08;
      }
    } else {
      // Squash'ın normale dönmesi
      squashX += (1 - squashX) * Math.min(1, dt * 10);
      squashY += (1 - squashY) * Math.min(1, dt * 10);
    }

    // Canvas temizleme
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

    const cx = canvasEl.width / 2;
    const cy = canvasEl.height / 2;

    // Organik nefes alma ritmi
    const breath = Math.sin(now * 0.0035);
    const breatheBounce = breath * 2.2;
    const avatarY = cy + jumpY + breatheBounce;

    // 1. Zemin İzometrik Kaide / Gölge Diski (Karakteri sahneye oturtur)
    const shadowScale = Math.max(0.4, 1 + jumpY / 130);
    ctx.save();
    ctx.fillStyle = 'rgba(26, 26, 26, 0.16)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 48, 36 * shadowScale, 11 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();

    // Kaide hedef halkası (reticle ring)
    ctx.strokeStyle = 'rgba(26, 26, 26, 0.15)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.ellipse(cx, cy + 48, 42, 13, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // 2. Avatar Çizimi (Squash & Stretch orantılı)
    const custom = cachedProfile || getAvatarProfile();
    const finalExpression = excitedTimer > 0 ? 'WINK' : custom.expression;
    const combinedScale = ((squashX + squashY) / 2) * (1 + breath * 0.02);

    drawBrutalAvatar(ctx, cx, avatarY - 2, 44, {
      color: custom.color,
      expression: finalExpression,
      accessory: custom.accessory,
      pattern: custom.pattern,
      facingAngle: currentAvatarAngle,
      isBlinking: isMenuBlinking,
      scale: combinedScale,
      showPips: false,
      showPointer: false,
      borderWidth: 3.5,
      shadowOffset: 4,
    });

    // 3. Kıvılcım / Yıldız Parçacıkları (Boing efekti)
    if (sparks.length > 0) {
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 220 * dt; // Parçacık yerçekimi
        p.life -= p.decay * dt;

        if (p.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.strokeStyle = '#1A1A1A';
        ctx.lineWidth = 1;

        if (p.shape === 'star') {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else if (p.shape === 'cross') {
          const s = p.size;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(p.x - s, p.y);
          ctx.lineTo(p.x + s, p.y);
          ctx.moveTo(p.x, p.y - s);
          ctx.lineTo(p.x, p.y + s);
          ctx.stroke();
        } else {
          ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
          ctx.strokeRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
        ctx.restore();
      }
    }

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

  // Menü tekrar açıldığında döngüyü yeniden başlatmak + ismi tazelemek için observer
  const menuOverlay = document.getElementById('menu-overlay');
  if (menuOverlay) {
    const observer = new MutationObserver(() => {
      if (!menuOverlay.classList.contains('hidden')) {
        updateCardName();
        cachedProfile = getAvatarProfile();
        if (!menuAnimFrameId) {
          lastTime = performance.now();
          menuAnimFrameId = requestAnimationFrame(menuLoop);
        }
      }
    });
    observer.observe(menuOverlay, { attributes: true, attributeFilter: ['class'] });
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

