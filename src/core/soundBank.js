// Curated Kenney sample bank — the SINGLE source for file-backed SFX.
//
// `src/audio.js` keeps the procedural synth as zero-latency fallback and as
// the Node/test voice (no fetch/decode there). In the browser each `play*`
// first tries its mapped sample here; when the buffer is cached it plays and
// the synth is skipped, otherwise the synth covers the first hit while the
// file loads lazily for the next one.
//
// Paths are site-rooted under `public/sound`. Entries with spaces or
// apostrophes are stored raw — `soundEngine` encodes at fetch time. Only the
// curated subset below is ever fetched (~40 files, ~500 KB); the packs ship
// 400+ files / ~10 MB total and must never be precached wholesale.

/** @typedef {'sfx'|'ui'|'voice'|'music'} SoundBus */

/**
 * @typedef {Object} SoundEntry
 * @property {string[]} files variant pool, first = default
 * @property {SoundBus} bus
 * @property {number} volume 0..1 pre-bus gain
 * @property {number} pitch random detune ratio (0.08 = ±8%)
 * @property {number} throttleMs min gap between two plays of this id
 * @property {number} poly max overlapping voices
 * @property {boolean} preload true = warmed on first gesture
 */

const INTERFACE = '/sound/kenney_interface-sounds/Audio';
const IMPACT = '/sound/kenney_impact-sounds/Audio';
const SCIFI = '/sound/kenney_sci-fi-sounds/Audio';
const VOICE = '/sound/kenney_voiceover-pack-fighter/Audio';
const HIT = '/sound/kenney_music-jingles/Audio/Hit jingles';

/** @type {Record<string, SoundEntry>} */
export const SOUND_BANK = {
  // ── UI (tiny, preloaded) ──────────────────────────────────────────────
  'ui.tick': {
    files: [`${INTERFACE}/tick_001.ogg`, `${INTERFACE}/tick_002.ogg`],
    bus: 'ui', volume: 0.5, pitch: 0.06, throttleMs: 30, poly: 3, preload: true,
  },
  'ui.select': {
    files: [`${INTERFACE}/select_001.ogg`, `${INTERFACE}/select_002.ogg`, `${INTERFACE}/select_003.ogg`],
    bus: 'ui', volume: 0.6, pitch: 0.05, throttleMs: 40, poly: 3, preload: true,
  },
  'ui.click': {
    files: [`${INTERFACE}/click_001.ogg`, `${INTERFACE}/click_002.ogg`],
    bus: 'ui', volume: 0.55, pitch: 0.06, throttleMs: 40, poly: 3, preload: true,
  },
  'ui.confirm': {
    files: [`${INTERFACE}/confirmation_001.ogg`, `${INTERFACE}/confirmation_003.ogg`],
    bus: 'ui', volume: 0.65, pitch: 0.04, throttleMs: 80, poly: 2, preload: true,
  },
  'ui.back': {
    files: [`${INTERFACE}/back_001.ogg`],
    bus: 'ui', volume: 0.55, pitch: 0.04, throttleMs: 80, poly: 2, preload: false,
  },
  'ui.error': {
    files: [`${INTERFACE}/error_001.ogg`],
    bus: 'ui', volume: 0.5, pitch: 0.04, throttleMs: 120, poly: 2, preload: false,
  },
  'ui.toggle': {
    files: [`${INTERFACE}/toggle_001.ogg`],
    bus: 'ui', volume: 0.55, pitch: 0.05, throttleMs: 60, poly: 2, preload: false,
  },
  'ui.open': {
    files: [`${INTERFACE}/open_001.ogg`],
    bus: 'ui', volume: 0.6, pitch: 0.05, throttleMs: 80, poly: 2, preload: false,
  },

  // ── Hits & impacts ────────────────────────────────────────────────────
  'hit.punchLight': {
    files: [`${IMPACT}/impactPunch_medium_000.ogg`, `${IMPACT}/impactPunch_medium_001.ogg`, `${IMPACT}/impactPunch_medium_002.ogg`],
    bus: 'sfx', volume: 0.8, pitch: 0.1, throttleMs: 45, poly: 4, preload: true,
  },
  'hit.punchHeavy': {
    files: [`${IMPACT}/impactPunch_heavy_000.ogg`, `${IMPACT}/impactPunch_heavy_001.ogg`],
    bus: 'sfx', volume: 0.9, pitch: 0.08, throttleMs: 60, poly: 3, preload: true,
  },
  'hit.wood': {
    files: [`${IMPACT}/impactWood_medium_000.ogg`, `${IMPACT}/impactWood_medium_001.ogg`],
    bus: 'sfx', volume: 0.8, pitch: 0.1, throttleMs: 50, poly: 3, preload: false,
  },
  'hit.metalLight': {
    files: [`${SCIFI}/impactMetal_000.ogg`, `${SCIFI}/impactMetal_001.ogg`],
    bus: 'sfx', volume: 0.7, pitch: 0.1, throttleMs: 45, poly: 3, preload: false,
  },
  'hit.glass': {
    files: [`${IMPACT}/impactGlass_medium_000.ogg`, `${IMPACT}/impactGlass_medium_001.ogg`],
    bus: 'sfx', volume: 0.8, pitch: 0.1, throttleMs: 80, poly: 3, preload: false,
  },
  'hit.soft': {
    files: [`${IMPACT}/impactSoft_medium_000.ogg`, `${IMPACT}/impactSoft_medium_001.ogg`],
    bus: 'sfx', volume: 0.75, pitch: 0.1, throttleMs: 60, poly: 3, preload: false,
  },

  // ── Shots, booms, movement ────────────────────────────────────────────
  'shot.laserSmall': {
    files: [`${SCIFI}/laserSmall_000.ogg`, `${SCIFI}/laserSmall_001.ogg`, `${SCIFI}/laserSmall_002.ogg`],
    bus: 'sfx', volume: 0.7, pitch: 0.08, throttleMs: 50, poly: 4, preload: true,
  },
  'shot.laserLarge': {
    files: [`${SCIFI}/laserLarge_000.ogg`, `${SCIFI}/laserLarge_001.ogg`],
    bus: 'sfx', volume: 0.85, pitch: 0.07, throttleMs: 70, poly: 3, preload: false,
  },
  'shot.retro': {
    files: [`${SCIFI}/laserRetro_000.ogg`, `${SCIFI}/laserRetro_001.ogg`],
    bus: 'sfx', volume: 0.6, pitch: 0.08, throttleMs: 50, poly: 3, preload: false,
  },
  'boom.crunch': {
    files: [`${SCIFI}/explosionCrunch_000.ogg`, `${SCIFI}/explosionCrunch_001.ogg`],
    bus: 'sfx', volume: 0.9, pitch: 0.07, throttleMs: 90, poly: 3, preload: true,
  },
  'boom.low': {
    files: [`${SCIFI}/lowFrequency_explosion_000.ogg`],
    bus: 'sfx', volume: 0.95, pitch: 0.05, throttleMs: 120, poly: 2, preload: false,
  },
  'move.whoosh': {
    files: [`${SCIFI}/thrusterFire_000.ogg`, `${SCIFI}/forceField_000.ogg`],
    bus: 'sfx', volume: 0.65, pitch: 0.12, throttleMs: 70, poly: 3, preload: false,
  },
  'fx.teleport': {
    files: [`${SCIFI}/forceField_001.ogg`, `${SCIFI}/forceField_002.ogg`],
    bus: 'sfx', volume: 0.7, pitch: 0.1, throttleMs: 80, poly: 3, preload: false,
  },

  // ── Pickups & alarms ──────────────────────────────────────────────────
  'pickup.coin': {
    files: [`${INTERFACE}/pluck_001.ogg`, `${INTERFACE}/pluck_002.ogg`],
    bus: 'sfx', volume: 0.65, pitch: 0.07, throttleMs: 60, poly: 3, preload: false,
  },
  'pickup.power': {
    files: [`${INTERFACE}/confirmation_002.ogg`, `${INTERFACE}/maximize_001.ogg`],
    bus: 'sfx', volume: 0.7, pitch: 0.06, throttleMs: 90, poly: 2, preload: false,
  },
  'tick.bomb': {
    files: [`${INTERFACE}/tick_001.ogg`, `${INTERFACE}/tick_002.ogg`],
    bus: 'sfx', volume: 0.6, pitch: 0.05, throttleMs: 0, poly: 4, preload: false,
  },
  'alarm.vault': {
    files: [`${INTERFACE}/error_005.ogg`],
    bus: 'sfx', volume: 0.65, pitch: 0.04, throttleMs: 150, poly: 2, preload: false,
  },

  // ── Fighter voiceover (lazy, ducked under nothing — single voice) ─────
  'voice.count3': { files: [`${VOICE}/3.ogg`], bus: 'voice', volume: 1, pitch: 0, throttleMs: 0, poly: 1, preload: false },
  'voice.count2': { files: [`${VOICE}/2.ogg`], bus: 'voice', volume: 1, pitch: 0, throttleMs: 0, poly: 1, preload: false },
  'voice.count1': { files: [`${VOICE}/1.ogg`], bus: 'voice', volume: 1, pitch: 0, throttleMs: 0, poly: 1, preload: false },
  'voice.fight': { files: [`${VOICE}/fight.ogg`], bus: 'voice', volume: 1, pitch: 0, throttleMs: 0, poly: 1, preload: false },
  'voice.round1': { files: [`${VOICE}/round_1.ogg`], bus: 'voice', volume: 1, pitch: 0, throttleMs: 0, poly: 1, preload: false },
  'voice.round2': { files: [`${VOICE}/round_2.ogg`], bus: 'voice', volume: 1, pitch: 0, throttleMs: 0, poly: 1, preload: false },
  'voice.round3': { files: [`${VOICE}/round_3.ogg`], bus: 'voice', volume: 1, pitch: 0, throttleMs: 0, poly: 1, preload: false },
  'voice.final': { files: [`${VOICE}/final_round.ogg`], bus: 'voice', volume: 1, pitch: 0, throttleMs: 0, poly: 1, preload: false },
  'voice.ready': { files: [`${VOICE}/ready.ogg`], bus: 'voice', volume: 1, pitch: 0, throttleMs: 0, poly: 1, preload: false },
  'voice.begin': { files: [`${VOICE}/begin.ogg`], bus: 'voice', volume: 1, pitch: 0, throttleMs: 0, poly: 1, preload: false },
  'voice.win': { files: [`${VOICE}/you_win.ogg`, `${VOICE}/winner.ogg`], bus: 'voice', volume: 1, pitch: 0, throttleMs: 0, poly: 1, preload: false },
  'voice.lose': { files: [`${VOICE}/you_lose.ogg`, `${VOICE}/game_over.ogg`], bus: 'voice', volume: 1, pitch: 0, throttleMs: 0, poly: 1, preload: false },
  'voice.sudden': { files: [`${VOICE}/sudden_death.ogg`], bus: 'voice', volume: 1, pitch: 0, throttleMs: 0, poly: 1, preload: false },

  // ── Music jingles (short stingers, not loops) ─────────────────────────
  'jingle.goal': { files: [`${HIT}/jingles_HIT00.ogg`], bus: 'music', volume: 0.8, pitch: 0, throttleMs: 150, poly: 1, preload: false },
  'jingle.start': { files: [`${HIT}/jingles_HIT01.ogg`], bus: 'music', volume: 0.8, pitch: 0, throttleMs: 200, poly: 1, preload: false },
  'jingle.win': { files: [`${HIT}/jingles_HIT08.ogg`], bus: 'music', volume: 0.85, pitch: 0, throttleMs: 300, poly: 1, preload: false },
  'jingle.lose': { files: [`${HIT}/jingles_HIT14.ogg`], bus: 'music', volume: 0.8, pitch: 0, throttleMs: 300, poly: 1, preload: false },
};

/**
 * Procedural synth name → sample id. Missing keys intentionally fall back to
 * pure synth (heartbeat, fakeout crow have no acoustic match in the packs).
 * @type {Record<string, string>}
 */
export const SYNTH_TO_SAMPLE = {
  playPaddleHit: 'hit.punchLight',
  playWallHit: 'hit.metalLight',
  playGoal: 'jingle.goal',
  playJoin: 'ui.confirm',
  playStart: 'jingle.start',
  playShoot: 'shot.laserSmall',
  playRicochet: 'hit.metalLight',
  playExplosion: 'boom.crunch',
  playDryFire: 'ui.error',
  playFireBlocked: 'ui.error',
  playPowerUp: 'pickup.power',
  playSonicBoom: 'shot.laserLarge',
  playGap: 'shot.retro',
  playItemPickup: 'pickup.coin',
  playBombTick: 'tick.bomb',
  playBombPass: 'move.whoosh',
  playTeleport: 'fx.teleport',
  playSlip: 'hit.soft',
  playDashWhoosh: 'move.whoosh',
  playStumble: 'hit.soft',
  playCoinPickup: 'pickup.coin',
  playCashRegister: 'pickup.power',
  playVaultAlarm: 'alarm.vault',
  playGunshot: 'shot.laserLarge',
  playDrawTension: 'ui.tick',
  playHeavyImpact: 'hit.punchHeavy',
  playPiggyBreak: 'hit.glass',
  playMenuTick: 'ui.tick',
  playMenuPop: 'ui.select',
  playHordeKill: 'hit.punchLight',
  playHordeHurt: 'hit.punchHeavy',
  playHordeBombTick: 'tick.bomb',
  playHordeBoom: 'boom.low',
};

/** Ids warmed on the first user gesture (small + frequent). @type {string[]} */
export const PRELOAD_IDS = Object.entries(SOUND_BANK)
  .filter(([, e]) => e.preload)
  .map(([id]) => id);
