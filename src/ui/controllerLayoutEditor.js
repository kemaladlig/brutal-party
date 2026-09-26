// Blank-screen controller layout editor. It owns an opaque stage with
// synthetic reference clusters, so the example matches the real mount:
// same normalized profile, same resolver math, side-locked halves.
// The live game DOM is never touched while editing; save persists,
// cancel/reset only affect the draft.

import { escapeHtml } from '../net.js';
import { t, onLangChange } from '../i18n.js';
import { isPersistent } from '../core/safeStorage.js';
import {
  getDefaultControllerLayout,
  normalizeControllerLayout,
  constrainControllerLayout,
  constrainControllerPoint,
  resolveControllerLayout,
  CONTROLLER_SIZE_MIN,
  CONTROLLER_SIZE_MAX,
  CONTROLLER_MIN_TOUCH_TARGET,
} from '../core/controllerLayout.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Reference union sizes at scale=1. They approximate measured mounts
// (joystick base ~150px, action cluster ~110px, PONG track wide/short)
// so the lobby example and the in-game result use the same proportions.
function referenceGroupsForMode(mode) {
  switch (mode) {
    case 'PONG':
      return {
        left: { left: 0, top: 0, right: 230, bottom: 70, width: 230, height: 70 },
        right: { left: 0, top: 0, right: 84, bottom: 84, width: 84, height: 84 },
      };
    case 'CURVE':
    case 'SNAKE':
      return {
        left: { left: 0, top: 0, right: 150, bottom: 72, width: 150, height: 72 },
        right: { left: 0, top: 0, right: 150, bottom: 72, width: 150, height: 72 },
      };
    case 'TANKS':
      return {
        left: { left: 0, top: 0, right: 128, bottom: 128, width: 128, height: 128 },
        right: { left: 0, top: 0, right: 116, bottom: 116, width: 116, height: 116 },
      };
    default:
      return {
        left: { left: 0, top: 0, right: 152, bottom: 152, width: 152, height: 152 },
        right: { left: 0, top: 0, right: 118, bottom: 118, width: 118, height: 118 },
      };
  }
}

function editorMode(manager) {
  const mode = manager?.gameMode && manager.gameMode !== 'LOBBY'
    ? manager.gameMode
    : manager?.selectedHostGame || manager?.gameMode || 'LOBBY';
  return typeof mode === 'string' ? mode : 'LOBBY';
}

function renderPanel(draft) {
  const size = Math.round(draft.size * 100);
  const pos = (p) => `${Math.round(p.x * 100)}% · ${Math.round(p.y * 100)}%`;
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
      <input class="controller-layout-size" id="controller-layout-size" type="range" min="${Math.round(CONTROLLER_SIZE_MIN * 100)}" max="${Math.round(CONTROLLER_SIZE_MAX * 100)}" step="5" value="${size}" aria-label="${escapeHtml(t('controllerLayout.size'))}" />
      <div class="controller-layout-pos" id="controller-layout-pos">SOL ${pos(draft.left)} &nbsp;•&nbsp; SAĞ ${pos(draft.right)}</div>
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
  let stageEl = null;
  let draft = constrainControllerLayout(manager.getControllerLayout());
  let refGroups = referenceGroupsForMode(editorMode(manager));
  let lastStageRect = null;
  let isOpen = false;
  let dragging = null;
  let lastFocus = null;
  let unsubscribeLanguage = null;
  let onResize = null;

  const measureStage = () => {
    if (!stageEl?.isConnected) return null;
    const rect = stageEl.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return null;
    lastStageRect = rect;
    return rect;
  };

  const resolveDraft = () => {
    const rect = measureStage() || lastStageRect;
    if (!rect) return null;
    const viewport = { width: rect.width, height: rect.height };
    const pad = 12;
    const safeFrame = { left: pad, top: 8, right: rect.width - pad, bottom: rect.height - pad };
    return resolveControllerLayout(draft, {
      viewport,
      safeFrame,
      groups: refGroups,
      minTouchTarget: CONTROLLER_MIN_TOUCH_TARGET,
    });
  };

  const updatePreview = () => {
    if (!isOpen || !root) return null;
    const rect = measureStage() || lastStageRect;
    if (!rect) return null;
    const metrics = resolveDraft();
    if (!metrics) return null;

    const safeBox = root.querySelector('.controller-layout-safe');
    if (safeBox) {
      safeBox.style.left = `${metrics.frame.left}px`;
      safeBox.style.top = `${metrics.frame.top}px`;
      safeBox.style.width = `${Math.max(0, metrics.frame.right - metrics.frame.left)}px`;
      safeBox.style.height = `${Math.max(0, metrics.frame.bottom - metrics.frame.top)}px`;
    }
    const gap = root.querySelector('.controller-layout-center-gap');
    if (gap) {
      const w = Math.max(0, metrics.centerGap);
      gap.style.left = `${metrics.center - w / 2}px`;
      gap.style.top = `${metrics.frame.top}px`;
      gap.style.width = `${w}px`;
      gap.style.height = `${Math.max(0, metrics.frame.bottom - metrics.frame.top)}px`;
    }
    for (const side of ['left', 'right']) {
      const result = metrics.sides[side];
      const ghost = root.querySelector(`[data-controller-layout-ghost="${side}"]`);
      const handle = root.querySelector(`[data-controller-layout-handle="${side}"]`);
      if (result && ghost) {
        ghost.style.left = `${result.centerX - result.width / 2}px`;
        ghost.style.top = `${result.centerY - result.height / 2}px`;
        ghost.style.width = `${result.width}px`;
        ghost.style.height = `${result.height}px`;
      }
      if (result && handle) {
        handle.style.left = `${result.centerX}px`;
        handle.style.top = `${result.centerY}px`;
      }
    }
    const badge = root.querySelector('.controller-layout-mode-badge');
    if (badge) {
      const capped = metrics.scale < draft.size - 0.005;
      badge.textContent = `${editorMode(manager)} · ${Math.round(metrics.scale * 100)}%${capped ? ' (sığdırıldı)' : ''}`;
    }
    const pos = root.querySelector('#controller-layout-pos');
    if (pos) {
      pos.textContent = `SOL ${Math.round(draft.left.x * 100)}% · ${Math.round(draft.left.y * 100)}% • SAĞ ${Math.round(draft.right.x * 100)}% · ${Math.round(draft.right.y * 100)}%`;
    }
    const output = root.querySelector('#controller-layout-size-value');
    if (output && document.activeElement?.id !== 'controller-layout-size') {
      output.value = `${Math.round(draft.size * 100)}%`;
    }
    return metrics;
  };

  const setDraftFromPointer = (side, clientX, clientY) => {
    const rect = measureStage() || lastStageRect;
    if (!rect) return;
    const pad = 12;
    const frameW = Math.max(1, rect.width - pad * 2);
    const frameH = Math.max(1, rect.height - 8 - pad);
    const nx = (clientX - rect.left - pad) / frameW;
    const ny = (clientY - rect.top - 8) / frameH;
    draft[side] = constrainControllerPoint(side, { x: nx, y: ny });
    updatePreview();
  };

  const nudgeDraft = (side, dx, dy) => {
    const cur = draft[side];
    draft[side] = constrainControllerPoint(side, { x: cur.x + dx, y: cur.y + dy });
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

  const bindStage = () => {
    stageEl = root.querySelector('.controller-layout-stage');
    // Tap on empty stage moves the nearest handle — fast placement,
    // still side-locked so left never crosses to the right half.
    stageEl?.addEventListener('pointerdown', (event) => {
      if (event.target.closest('[data-controller-layout-handle]')) return;
      const rect = stageEl.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const side = x < rect.width / 2 ? 'left' : 'right';
      setDraftFromPointer(side, event.clientX, event.clientY);
    });
  };

  const render = () => {
    if (!root) return;
    const mode = editorMode(manager);
    root.innerHTML = `
      <div class="controller-layout-stage" aria-hidden="false">
        <div class="controller-layout-safe" aria-hidden="true"></div>
        <div class="controller-layout-center-gap" aria-hidden="true"></div>
        <div class="controller-layout-midline" aria-hidden="true"></div>
        <div class="controller-layout-ghost is-left" data-controller-layout-ghost="left" aria-hidden="true"><span>SOL</span></div>
        <div class="controller-layout-ghost is-right" data-controller-layout-ghost="right" aria-hidden="true"><span>SAĞ</span></div>
        <button class="controller-layout-handle" data-controller-layout-handle="left" type="button" aria-label="${escapeHtml(t('controllerLayout.left'))}" title="${escapeHtml(t('controllerLayout.left'))}">${escapeHtml(t('controllerLayout.leftShort'))}</button>
        <button class="controller-layout-handle" data-controller-layout-handle="right" type="button" aria-label="${escapeHtml(t('controllerLayout.right'))}" title="${escapeHtml(t('controllerLayout.right'))}">${escapeHtml(t('controllerLayout.rightShort'))}</button>
        <div class="controller-layout-mode-badge" aria-hidden="true">${escapeHtml(mode)}</div>
      </div>
      ${renderPanel(draft)}
    `;
    bindStage();

    const sizeInput = root.querySelector('#controller-layout-size');
    sizeInput?.addEventListener('input', (event) => {
      draft.size = Math.round(clamp(
        Number(event.currentTarget.value) / 100,
        CONTROLLER_SIZE_MIN,
        CONTROLLER_SIZE_MAX,
      ) * 100) / 100;
      const output = root.querySelector('#controller-layout-size-value');
      if (output) output.value = `${Math.round(draft.size * 100)}%`;
      updatePreview();
    });
    sizeInput?.addEventListener('change', () => {
      draft = constrainControllerLayout(draft);
      updatePreview();
    });
    root.querySelector('[data-controller-layout-save]')?.addEventListener('click', () => close({ save: true }));
    root.querySelector('[data-controller-layout-cancel]')?.addEventListener('click', () => close({ save: false }));
    root.querySelector('[data-controller-layout-close]')?.addEventListener('click', () => close({ save: false }));
    root.querySelector('[data-controller-layout-reset]')?.addEventListener('click', () => {
      draft = constrainControllerLayout(getDefaultControllerLayout());
      const size = root.querySelector('#controller-layout-size');
      const output = root.querySelector('#controller-layout-size-value');
      if (size) size.value = String(Math.round(draft.size * 100));
      if (output) output.value = `${Math.round(draft.size * 100)}%`;
      updatePreview();
    });
    root.querySelectorAll('[data-controller-layout-handle]').forEach((handle) => {
      handle.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        dragging = handle.dataset.controllerLayoutHandle;
        root.classList.add('is-dragging');
        try { handle.setPointerCapture?.(event.pointerId); } catch {}
        setDraftFromPointer(dragging, event.clientX, event.clientY);
      });
      handle.addEventListener('keydown', (event) => {
        const side = handle.dataset.controllerLayoutHandle;
        const step = event.shiftKey ? 0.1 : 0.02;
        if (event.key === 'ArrowLeft') nudgeDraft(side, -step, 0);
        else if (event.key === 'ArrowRight') nudgeDraft(side, step, 0);
        else if (event.key === 'ArrowUp') nudgeDraft(side, 0, -step);
        else if (event.key === 'ArrowDown') nudgeDraft(side, 0, step);
        else return;
        event.preventDefault();
      });
    });
  };

  const open = () => {
    if (isOpen) return;
    isOpen = true;
    draft = constrainControllerLayout(normalizeControllerLayout(manager.getControllerLayout()));
    refGroups = referenceGroupsForMode(editorMode(manager));
    lastFocus = document.activeElement;
    if (!root || !root.isConnected) {
      root = document.createElement('div');
      root.className = 'controller-layout-editor';
      root.id = 'controller-layout-editor';
      manager.overlay.appendChild(root);
    }
    root.hidden = false;
    manager.overlay.classList.add('controller-layout-editing');
    // Never mutate the live mount while the blank stage is open.
    try { manager.clearControllerLayoutPreview?.(); } catch {}
    render();
    manager.setInputBlocked(true);
    updatePreview();
    requestAnimationFrame(() => updatePreview());
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    onResize = () => updatePreview();
    window.addEventListener('resize', onResize, { passive: true });
    unsubscribeLanguage = onLangChange(() => {
      if (isOpen) {
        render();
        updatePreview();
      }
    });
    root.querySelector('#controller-layout-size')?.focus({ preventScroll: true });
  };

  const close = ({ save = false } = {}) => {
    if (!isOpen) return;
    isOpen = false;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    if (onResize) window.removeEventListener('resize', onResize);
    onResize = null;
    unsubscribeLanguage?.();
    unsubscribeLanguage = null;
    if (save) {
      draft = constrainControllerLayout(draft);
      manager.saveControllerLayout(draft);
    } else {
      try { manager.clearControllerLayoutPreview?.(); } catch {}
    }
    manager.setInputBlocked(false);
    manager.overlay.classList.remove('controller-layout-editing');
    if (root) root.hidden = true;
    if (lastFocus?.isConnected) lastFocus.focus?.({ preventScroll: true });
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
        refGroups = referenceGroupsForMode(editorMode(manager));
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
