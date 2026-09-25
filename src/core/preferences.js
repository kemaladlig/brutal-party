// Versioned, device-local preference store. All UI/gamepad/audio preferences
// pass through this module so storage failures and migrations stay in one place.

import { safeGet, safeSet } from './safeStorage.js';
import {
  DEFAULT_CONTROLLER_LAYOUT,
  normalizeControllerLayout,
} from './controllerLayout.js';

export {
  CONTROLLER_LAYOUT_VERSION,
  CONTROLLER_SIZE_MAX,
  CONTROLLER_SIZE_MIN,
  DEFAULT_CONTROLLER_LAYOUT,
  normalizeControllerLayout,
} from './controllerLayout.js';

export const PREFERENCES_VERSION = 2;
export const PREFERENCES_STORAGE_KEY = 'brutalparty.preferences.v2';
export const LEGACY_PREFERENCES_STORAGE_KEYS = Object.freeze([
  'brutalparty.preferences.v1',
]);

export const DEFAULT_PREFERENCES = Object.freeze({
  version: PREFERENCES_VERSION,
  controlSurface: 'auto',
  audioMuted: false,
  hapticsEnabled: true,
  pongInvert: 'auto',
  pongSensitivity: 1,
  controllerLayout: DEFAULT_CONTROLLER_LAYOUT,
});

const listeners = new Set();
let cachedPreferences = null;

const CONTROL_SURFACE_VALUES = new Set(['auto', 'mobile', 'tabletop']);
const PONG_INVERT_VALUES = new Set(['auto', 'on', 'off']);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function normalizePreferences(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const sensitivity = Number(source.pongSensitivity);
  return {
    version: PREFERENCES_VERSION,
    controlSurface: CONTROL_SURFACE_VALUES.has(source.controlSurface)
      ? source.controlSurface
      : DEFAULT_PREFERENCES.controlSurface,
    audioMuted: typeof source.audioMuted === 'boolean'
      ? source.audioMuted
      : DEFAULT_PREFERENCES.audioMuted,
    hapticsEnabled: typeof source.hapticsEnabled === 'boolean'
      ? source.hapticsEnabled
      : DEFAULT_PREFERENCES.hapticsEnabled,
    pongInvert: PONG_INVERT_VALUES.has(source.pongInvert)
      ? source.pongInvert
      : DEFAULT_PREFERENCES.pongInvert,
    pongSensitivity: Number.isFinite(sensitivity)
      ? Math.round(clamp(sensitivity, 0.5, 1.5) * 100) / 100
      : DEFAULT_PREFERENCES.pongSensitivity,
    controllerLayout: normalizeControllerLayout(source.controllerLayout),
  };
}

function readLegacyControlSurface() {
  const current = safeGet('bp_control_surface');
  if (current === 'mobile' || current === 'tabletop') return current;
  const legacy = safeGet('bp_virtual_controls');
  if (legacy === 'off') return 'tabletop';
  if (legacy === 'on' || legacy === 'auto') return 'mobile';
  return null;
}

function parseStoredPreferences(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function readStoredPreferences() {
  const current = parseStoredPreferences(safeGet(PREFERENCES_STORAGE_KEY));
  if (current) return current;

  for (const key of LEGACY_PREFERENCES_STORAGE_KEYS) {
    const legacy = parseStoredPreferences(safeGet(key));
    if (legacy) return legacy;
  }

  const legacySurface = readLegacyControlSurface();
  return legacySurface ? { controlSurface: legacySurface } : {};
}

function loadPreferences() {
  if (cachedPreferences) return cachedPreferences;

  // v1 and older records are normalized in place, preserving all known fields.
  // Unknown/invalid records are also normalized rather than discarded.
  cachedPreferences = normalizePreferences(readStoredPreferences());
  safeSet(PREFERENCES_STORAGE_KEY, JSON.stringify(cachedPreferences));
  return cachedPreferences;
}

export function getPreferences() {
  const current = loadPreferences();
  return {
    ...current,
    controllerLayout: normalizeControllerLayout(current.controllerLayout),
  };
}

export function getPreference(key) {
  if (key === 'controllerLayout') return normalizeControllerLayout(loadPreferences().controllerLayout);
  return loadPreferences()[key];
}

export function setPreference(key, value) {
  const current = loadPreferences();
  const next = normalizePreferences({ ...current, [key]: value });
  cachedPreferences = next;
  safeSet(PREFERENCES_STORAGE_KEY, JSON.stringify(next));
  for (const listener of listeners) {
    try { listener({ ...next, controllerLayout: normalizeControllerLayout(next.controllerLayout) }); } catch {}
  }
  return {
    ...next,
    controllerLayout: normalizeControllerLayout(next.controllerLayout),
  };
}

export function getControllerLayout() {
  return getPreference('controllerLayout');
}

export function setControllerLayout(value) {
  return setPreference('controllerLayout', normalizeControllerLayout(value));
}

export function subscribePreferences(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}
