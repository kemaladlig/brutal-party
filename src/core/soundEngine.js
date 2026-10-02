// Sample playback engine — the runtime half of the sound system.
//
// `soundBank.js` owns WHAT plays; this module owns HOW: one shared
// AudioContext, four bus gains (sfx/ui/voice/music → master), buffer cache
// with in-flight dedup, per-id throttle + polyphony caps, random pitch for
// pool variants, and autoplay-unlock on first gesture.
//
// Contract with `src/audio.js`: `tryPlaySample(id)` is synchronous and
// returns true only when a buffer was actually scheduled. False means "play
// the procedural synth instead" — which is also the Node/test path (no
// fetch, no decode → always false, synth signatures stay intact).

import { SOUND_BANK, PRELOAD_IDS } from './soundBank.js';
import { getPreference } from './preferences.js';

/** @typedef {import('./soundBank.js').SoundBus} SoundBus */

let ctx = null;
/** @type {Record<SoundBus, GainNode | null>} */
let busGains = { sfx: null, ui: null, voice: null, music: null };
let masterGain = null;
/** @type {Map<string, AudioBuffer | null>} */
const bufferCache = new Map();
/** @type {Map<string, Promise<AudioBuffer | null>>} */
const inflight = new Map();
/** @type {Map<string, number>} */
const lastPlayAt = new Map();
/** @type {Map<string, number>} */
const activeVoices = new Map();
let unlockBound = false;
let criticalWarmed = false;

/** Bus base levels (master volume + mute applied on top). */
const BUS_LEVEL = { sfx: 0.9, ui: 0.7, voice: 1.0, music: 0.6 };

function canUseAudio() {
  return typeof window !== 'undefined'
    && !!(window.AudioContext || window.webkitAudioContext);
}

function isMuted() {
  try { return getPreference('audioMuted') === true; } catch { return false; }
}

function masterVolume() {
  try {
    const v = Number(getPreference('audioVolume'));
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.85;
  } catch { return 0.85; }
}

function voiceEnabled() {
  try { return getPreference('audioVoice') !== false; } catch { return true; }
}

/** Shared context, created lazily inside a user gesture when possible. */
export function ensureContext() {
  if (!canUseAudio()) return null;
  if (isMuted()) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch { return null; }
    masterGain = ctx.createGain();
    masterGain.gain.value = masterVolume();
    masterGain.connect(ctx.destination);
    for (const bus of /** @type {SoundBus[]} */ (['sfx', 'ui', 'voice', 'music'])) {
      const g = ctx.createGain();
      g.gain.value = BUS_LEVEL[bus];
      g.connect(masterGain);
      busGains[bus] = g;
    }
  }
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {});
  if (masterGain) masterGain.gain.value = masterVolume();
  return ctx;
}

function pickFile(entry) {
  const files = entry.files;
  if (files.length === 1) return files[0];
  return files[(Math.random() * files.length) | 0];
}

function loadBuffer(url) {
  const hit = bufferCache.get(url);
  if (hit !== undefined) return Promise.resolve(hit);
  const pending = inflight.get(url);
  if (pending) return pending;
  const p = (async () => {
    try {
      const res = await fetch(encodeURI(url));
      if (!res.ok) return null;
      const raw = await res.arrayBuffer();
      const ac = ensureContext();
      if (!ac) return null;
      const buf = await new Promise((resolve) => {
        try {
          const maybe = ac.decodeAudioData(raw, resolve, () => resolve(null));
          if (maybe && typeof maybe.then === 'function') {
            maybe.then(resolve, () => resolve(null));
          }
        } catch { resolve(null); }
      });
      const out = /** @type {AudioBuffer | null} */ (buf || null);
      bufferCache.set(url, out);
      return out;
    } catch {
      bufferCache.set(url, null);
      return null;
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, p);
  return p;
}

/** Warm a list of ids in the background (fire-and-forget). @param {string[]} ids */
export function preloadSamples(ids) {
  if (!canUseAudio() || isMuted()) return;
  for (const id of ids) {
    const entry = SOUND_BANK[id];
    if (!entry) continue;
    for (const f of entry.files) void loadBuffer(f);
  }
}

function warmCritical() {
  if (criticalWarmed) return;
  criticalWarmed = true;
  // Idle-warm so the first tap (unlock gesture) stays silent-fast.
  const run = () => preloadSamples(PRELOAD_IDS);
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run);
  else setTimeout(run, 800);
}

/** Bind one-time autoplay unlock + critical warm. Safe to call repeatedly. */
export function bindUnlock() {
  if (unlockBound || typeof window === 'undefined') return;
  unlockBound = true;
  const unlock = () => {
    if (isMuted()) return;
    ensureContext();
    warmCritical();
  };
  for (const evt of ['pointerdown', 'keydown', 'touchend']) {
    window.addEventListener(evt, unlock, { passive: true });
  }
}

/**
 * Try to schedule a bank sample. Returns true when audible (or intentionally
 * throttled/suppressed — caller must then SKIP its synth so tests of the
 * synth path in Node still observe oscillators while browsers hear one hit).
 * @param {string} id
 * @param {{ volume?: number }} [opts]
 */
export function tryPlaySample(id, opts = {}) {
  const entry = SOUND_BANK[id];
  if (!entry) return false;
  if (isMuted()) return true; // muted: suppress synth too
  if (entry.bus === 'voice' && !voiceEnabled()) return true;
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const last = lastPlayAt.get(id) || 0;
  if (entry.throttleMs > 0 && now - last < entry.throttleMs) return true;
  const active = activeVoices.get(id) || 0;
  if (active >= entry.poly) return true;
  const ac = ensureContext();
  if (!ac || !busGains[entry.bus] || !masterGain) return false;
  const url = pickFile(entry);
  const buf = bufferCache.get(url);
  if (buf === undefined) {
    // First touch: fetch for next time, let the synth cover this hit.
    void loadBuffer(url);
    return false;
  }
  if (!buf) return false; // failed before: synth covers it
  try {
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = entry.pitch > 0
      ? 1 + (Math.random() * 2 - 1) * entry.pitch
      : 1;
    const g = ac.createGain();
    const v = entry.volume * (Number.isFinite(opts.volume) ? Number(opts.volume) : 1);
    g.gain.value = Math.min(1.2, Math.max(0.001, v));
    src.connect(g);
    g.connect(busGains[entry.bus]);
    lastPlayAt.set(id, now);
    activeVoices.set(id, active + 1);
    src.onended = () => {
      activeVoices.set(id, Math.max(0, (activeVoices.get(id) || 1) - 1));
      try { src.disconnect(); g.disconnect(); } catch {}
    };
    src.start();
    return true;
  } catch {
    return false;
  }
}

/** Apply persisted mute/volume to the live graph (called after toggles). */
export function syncEnginePrefs() {
  if (!ctx || !masterGain) return;
  if (isMuted()) {
    try { void ctx.suspend(); } catch {}
    return;
  }
  try { void ctx.resume().catch(() => {}); } catch {}
  masterGain.gain.value = masterVolume();
}

/** Test/diagnostic hook: how many buffers are cached. */
export function cachedBufferCount() {
  let n = 0;
  for (const v of bufferCache.values()) if (v) n += 1;
  return n;
}
