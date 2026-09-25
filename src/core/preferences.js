// Versioned, device-local preference store. All UI/gamepad/audio preferences
// pass through this module so storage failures and migrations stay in one place.

import { safeGet, safeSet } from './safeStorage.js';

export const PREFERENCES_VERSION = 1;
export const PREFERENCES_STORAGE_KEY = 'brutalparty.preferences.v1';

export const DEFAULT_PREFERENCES = Object.freeze({
  version: PREFERENCES_VERSION,
  controlSurface: 'auto',
  audioMuted: false,
  hapticsEnabled: true,
  pongInvert: 'auto',
  pongSensitivity: 1,
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

function loadPreferences() {
  if (cachedPreferences) return cachedPreferences;

  let parsed = null;
  try {
    parsed = JSON.parse(safeGet(PREFERENCES_STORAGE_KEY) || 'null');
  } catch {
    parsed = null;
  }

  if (!parsed || parsed.version !== PREFERENCES_VERSION) {
    const legacySurface = readLegacyControlSurface();
    parsed = legacySurface ? { controlSurface: legacySurface } : {};
  }

  cachedPreferences = normalizePreferences(parsed);
  safeSet(PREFERENCES_STORAGE_KEY, JSON.stringify(cachedPreferences));
  return cachedPreferences;
}

export function getPreferences() {
  return { ...loadPreferences() };
}

export function getPreference(key) {
  return loadPreferences()[key];
}

export function setPreference(key, value) {
  const current = loadPreferences();
  const next = normalizePreferences({ ...current, [key]: value });
  cachedPreferences = next;
  safeSet(PREFERENCES_STORAGE_KEY, JSON.stringify(next));
  for (const listener of listeners) {
    try { listener(next); } catch {}
  }
  return { ...next };
}

export function subscribePreferences(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}
