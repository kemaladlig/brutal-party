// Shared in-game controller layout editor. It is mounted into the existing
// gamepad overlay, so remote phones and the LOCAL mobile surface use the same
// editor and the same preference profile.

import { escapeHtml } from '../net.js';
import { t, onLangChange } from '../i18n.js';
import { isPersistent } from '../core/safeStorage.js';
import { getDefaultControllerLayout, normalizeControllerLayout } from '../core/controllerLayout.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function renderPanel(draft) {
  const size = Math.round(draft.size * 100);
  return `
    <section class="controller-layout-editor-panel" role="dialog" aria-modal="true" aria-labelledby="controller-layout-editor-title">
      <div class="controller-layout-editor-heading">
        <div>
          <div class="controller-layout-editor-kicker">${escapeHtml(t('controllerLayout.kicker'))}</div>
          <h2 id="controller-layout-editor-title">${escapeHtml(t('controllerLayout.title'))}</h2>
        </div>
        <button class="controller-layout-close" data-controller-layout-close type="button" aria-label="${escapeHtml(t('controllerLayout.close'))}" title="${escapeHtml(t('controllerLayout.close'))}">×</button>
      </div>
      <p class="controller-layout-editor-hint">${escapeHtml(t('controllerLayout.hint'))}</p>
      <div class="controller-layout-size-row">
        <label for="controller-layout-size">${escapeHtml(t('controllerLayout.size'))}</label>
        <output id="controller-layout-size-value" for="controller-layout-size">${size}%</output>
      </div>
      <input class="controller-layout-size" id="controller-layout-size" type="range" min="80" max="130" step="5" value="${size}" aria-label="${escapeHtml(t('controllerLayout.size'))}" />
      <div class="controller-layout-editor-actions">
        <button class="controller-layout-action secondary" data-controller-layout-reset type="button">${escapeHtml(t('controllerLayout.reset'))}</button>
        <button class="controller-layout-action secondary" data-controller-layout-cancel type="button">${escapeHtml(t('controllerLayout.cancel'))}</button>
        <button class="controller-layout-action primary" data-controller-layout-save type="button">${escapeHtml(t('controllerLayout.save'))}</button>
      </div>
      <div class="controller-layout-storage ${isPersistent() ? 'is-persistent' : 'is-session'}">${escapeHtml(isPersistent() ? t('controllerLayout.storagePersistent') : t('controllerLayout.storageSession'))}</div>
    </section>
  `;
}

export function openControllerLayoutEditor(manager) {
  let root = null;
  let draft = normalizeControllerLayout(manager.getControllerLayout());
  let isOpen = false;
  let dragging = null;
  let lastFocus = null;
  let unsubscribeLanguage = null;

  const getMetrics = () => manager.getControllerLayoutMetrics(draft);

  const updatePreview = () => {
    if (!isOpen) return null;
    const metrics = manager.previewControllerLayout(draft);
    if (!metrics || !root) return metrics;
    const safe = metrics.safeFrameAbsolute;
    const playfield = root.querySelector('.controller-layout-playfield');
    if (playfield && safe) {
      const gap = Math.max(0, metrics.centerGap);
      playfield.style.left = `${metrics.rootRect.left + metrics.center - gap / 2}px`;
      playfield.style.width = `${gap}px`;
      playfield.style.top = `${safe.top}px`;
      playfield.style.height = `${safe.height}px`;
    }
    for (const side of ['left', 'right']) {
      const handle = root.querySelector(`[data-controller-layout-handle="${side}"]`);
      const result = metrics.sides[side];
      if (!handle || !result) continue;
      handle.style.left = `${metrics.rootRect.left + result.centerX}px`;
      handle.style.top = `${metrics.rootRect.top + result.centerY}px`;
    }
    return metrics;
  };

  const setDraftFromPointer = (side, clientX, clientY) => {
    const metrics = getMetrics();
    if (!metrics?.safeFrameAbsolute) return;
    const safe = metrics.safeFrameAbsolute;
    const width = Math.max(1, safe.right - safe.left);
    const height = Math.max(1, safe.bottom - safe.top);
    draft[side] = {
      x: clamp((clientX - safe.left) / width, 0, 1),
      y: clamp((clientY - safe.top) / height, 0, 1),
    };
    updatePreview();
  };

  const endDrag = () => {
    dragging = null;
    root?.classList.remove('is-dragging');
  };

  const onPointerMove = (event) => {
    if (!dragging) return;
    event.preventDefault();
    setDraftFromPointer(dragging, event.clientX, event.clientY);
  };

  const onPointerUp = () => endDrag();

  const render = () => {
    if (!root) return;
    root.innerHTML = `
      <div class="controller-layout-playfield" aria-hidden="true"></div>
      <button class="controller-layout-handle" data-controller-layout-handle="left" type="button" aria-label="${escapeHtml(t('controllerLayout.left'))}" title="${escapeHtml(t('controllerLayout.left'))}">${escapeHtml(t('controllerLayout.leftShort'))}</button>
      <button class="controller-layout-handle" data-controller-layout-handle="right" type="button" aria-label="${escapeHtml(t('controllerLayout.right'))}" title="${escapeHtml(t('controllerLayout.right'))}">${escapeHtml(t('controllerLayout.rightShort'))}</button>
      ${renderPanel(draft)}
    `;
    root.querySelector('[data-controller-layout-size]')?.addEventListener('input', (event) => {
      draft.size = clamp(Number(event.currentTarget.value) / 100, 0.8, 1.3);
      const output = root.querySelector('#controller-layout-size-value');
      if (output) output.value = `${Math.round(draft.size * 100)}%`;
      updatePreview();
    });
    root.querySelector('[data-controller-layout-save]')?.addEventListener('click', () => close({ save: true }));
    root.querySelector('[data-controller-layout-cancel]')?.addEventListener('click', () => close({ save: false }));
    root.querySelector('[data-controller-layout-close]')?.addEventListener('click', () => close({ save: false }));
    root.querySelector('[data-controller-layout-reset]')?.addEventListener('click', () => {
      draft = getDefaultControllerLayout();
      const size = root.querySelector('#controller-layout-size');
      const output = root.querySelector('#controller-layout-size-value');
      if (size) size.value = String(Math.round(draft.size * 100));
      if (output) output.value = `${Math.round(draft.size * 100)}%`;
      updatePreview();
    });
    root.querySelectorAll('[data-controller-layout-handle]').forEach((handle) => {
      handle.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        dragging = handle.dataset.controllerLayoutHandle;
        root.classList.add('is-dragging');
        handle.setPointerCapture?.(event.pointerId);
        setDraftFromPointer(dragging, event.clientX, event.clientY);
      });
      handle.addEventListener('keydown', (event) => {
        const side = handle.dataset.controllerLayoutHandle;
        const step = event.shiftKey ? 0.1 : 0.02;
        const current = draft[side];
        if (event.key === 'ArrowLeft') current.x = clamp(current.x - step, 0, 1);
        else if (event.key === 'ArrowRight') current.x = clamp(current.x + step, 0, 1);
        else if (event.key === 'ArrowUp') current.y = clamp(current.y - step, 0, 1);
        else if (event.key === 'ArrowDown') current.y = clamp(current.y + step, 0, 1);
        else return;
        event.preventDefault();
        updatePreview();
      });
    });
  };

  const open = () => {
    if (isOpen) return;
    isOpen = true;
    draft = normalizeControllerLayout(manager.getControllerLayout());
    lastFocus = document.activeElement;
    if (!root || !root.isConnected) {
      root = document.createElement('div');
      root.className = 'controller-layout-editor';
      root.id = 'controller-layout-editor';
      manager.overlay.appendChild(root);
    }
    root.hidden = false;
    manager.overlay.classList.add('controller-layout-editing');
    render();
    manager.setInputBlocked(true);
    updatePreview();
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    unsubscribeLanguage = onLangChange(() => {
      if (isOpen) {
        render();
        updatePreview();
      }
    });
    root.querySelector('[data-controller-layout-size]')?.focus();
  };

  const close = ({ save = false } = {}) => {
    if (!isOpen) return;
    isOpen = false;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    unsubscribeLanguage?.();
    unsubscribeLanguage = null;
    if (save) manager.saveControllerLayout(draft);
    else manager.previewControllerLayout(manager.getControllerLayout());
    manager.setInputBlocked(false);
    manager.overlay.classList.remove('controller-layout-editing');
    if (root) root.hidden = true;
    if (lastFocus?.isConnected) lastFocus.focus?.();
  };

  const onKeyDown = (event) => {
    if (!isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close({ save: false });
    }
  };
  document.addEventListener('keydown', onKeyDown);

  return {
    get isOpen() { return isOpen; },
    open,
    close,
    refresh() {
      if (isOpen) {
        render();
        updatePreview();
      }
    },
    destroy() {
      close({ save: false });
      root?.remove();
      document.removeEventListener('keydown', onKeyDown);
    },
  };
}
