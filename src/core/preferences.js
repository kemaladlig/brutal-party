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
  // Sample layer levels (hidden prefs — no settings row yet, GENERAL budget
  // is full; the mute switch stays the single visible control).
  audioVolume: 0.85,
  audioVoice: true,
  hapticsEnabled: false,
  pongInvert: 'auto',
  pongSensitivity: 1,
  controllerLayout: DEFAULT_CONTROLLER_LAYOUT,
  // "Sakin mod" (Faz 4.3): OS `prefers-reduced-motion` gibi davranır (hareket
  // kısılır) + FX kademesi low'a sabitlenir → uzun oturumda termal/bateri
  // dostu. Tek okuma noktaları: `motion.js` ve `perfMonitor.js`.
  calmMode: false,
  // Bot tepkileri (banter): botların raunt/maç sonucunda emoji göndermesi.
  // Varsayılan AÇIK — parti oyunu; kapatmak isteyen ayardan kapatır. Kararı
  // `core/botReactionDirector.js` bu tercih üzerinden okur.
  botReactions: true,
  // Ana menünün "KALDIĞIN YER" girişi: en son SAHAYA GEÇİLEN oyun modu. Kayıt
  // yeri burada TEKTİR (`roomFlow.enterStaging` yazar, `homeView` okur); mod
  // kimliği `CARTRIDGES` anahtarıdır ama doğrulama registry'ye bırakılır —
  // preferences çekirdeği oyun listesini bilmez (döngüsüz kalır).
  lastGameMode: null,
  lastPlayedAt: 0,
});

const listeners = new Set();
let cachedPreferences = null;

const CONTROL_SURFACE_VALUES = new Set(['auto', 'mobile', 'tabletop']);
const PONG_INVERT_VALUES = new Set(['auto', 'on', 'off']);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function normalizePreferences(value = {}) {
  const source = /** @type {Record<string, any>} */ (value && typeof value === 'object' ? value : {});
  const sensitivity = Number(source.pongSensitivity);
  return {
    version: PREFERENCES_VERSION,
    controlSurface: CONTROL_SURFACE_VALUES.has(source.controlSurface)
      ? source.controlSurface
      : DEFAULT_PREFERENCES.controlSurface,
    audioMuted: typeof source.audioMuted === 'boolean'
      ? source.audioMuted
      : DEFAULT_PREFERENCES.audioMuted,
    audioVolume: Number.isFinite(Number(source.audioVolume))
      ? Math.min(1, Math.max(0, Number(source.audioVolume)))
      : DEFAULT_PREFERENCES.audioVolume,
    audioVoice: typeof source.audioVoice === 'boolean'
      ? source.audioVoice
      : DEFAULT_PREFERENCES.audioVoice,
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
    calmMode: typeof source.calmMode === 'boolean'
      ? source.calmMode
      : DEFAULT_PREFERENCES.calmMode,
    botReactions: typeof source.botReactions === 'boolean'
      ? source.botReactions
      : DEFAULT_PREFERENCES.botReactions,
    // Mod kimliği yalnız boş olmayan bir dizedir; tanınmayan bir mod (silinmiş
    // oyun / eski sürüm kaydı) burada DEĞİL, okuyan tarafta `CARTRIDGES` ile
    // elenir — kayıt bozuk olsa bile menü çizilebilir kalır.
    lastGameMode: typeof source.lastGameMode === 'string' && source.lastGameMode
      ? source.lastGameMode
      : DEFAULT_PREFERENCES.lastGameMode,
    lastPlayedAt: Number.isFinite(Number(source.lastPlayedAt))
      ? Math.max(0, Math.trunc(Number(source.lastPlayedAt)))
      : DEFAULT_PREFERENCES.lastPlayedAt,
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
