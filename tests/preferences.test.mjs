import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PREFERENCES,
  getPreference,
  normalizePreferences,
  setPreference,
} from '../src/core/preferences.js';
import { motionScale, prefersReducedMotion } from '../src/ui/motion.js';
import { fxGlowEnabled, fxParticleScale, fxTierName } from '../src/core/perfMonitor.js';
import {
  CONTROL_MODE,
  CONTROL_SURFACE,
  resolveControlSurface,
  resolveLocalControlMode,
  shouldShowVirtualControls,
} from '../src/ui/tokens.js';

test('preference normalization clamps and rejects invalid values', () => {
  const result = normalizePreferences({
    version: 99,
    controlSurface: 'unknown',
    audioMuted: 'yes',
    hapticsEnabled: false,
    pongInvert: 'on',
    pongSensitivity: 9,
  });
  assert.equal(result.version, 2);
  assert.equal(result.controlSurface, DEFAULT_PREFERENCES.controlSurface);
  assert.equal(result.audioMuted, DEFAULT_PREFERENCES.audioMuted);
  assert.equal(result.hapticsEnabled, false);
  assert.equal(result.pongInvert, 'on');
  assert.equal(result.pongSensitivity, 1.5);
});

test('preference normalization preserves existing settings while adding layout defaults', () => {
  const result = normalizePreferences({
    version: 1,
    controlSurface: 'tabletop',
    audioMuted: true,
    hapticsEnabled: false,
    pongInvert: 'off',
    pongSensitivity: 1.25,
  });
  assert.equal(result.version, 2);
  assert.equal(result.controlSurface, 'tabletop');
  assert.equal(result.audioMuted, true);
  assert.equal(result.hapticsEnabled, false);
  assert.equal(result.pongInvert, 'off');
  assert.equal(result.pongSensitivity, 1.25);
  assert.deepEqual(result.controllerLayout, {
    version: 1,
    size: 0.85,
    left: { x: 0.16, y: 0.86 },
    right: { x: 0.84, y: 0.86 },
  });
});

test('only the canvas mode draws tabletop corner controls', () => {
  assert.equal(shouldShowVirtualControls({ mode: CONTROL_MODE.CANVAS }), true);
  assert.equal(shouldShowVirtualControls({ mode: CONTROL_MODE.DOM }), false);
  assert.equal(shouldShowVirtualControls({ mode: CONTROL_MODE.NONE }), false);
  assert.equal(shouldShowVirtualControls(), false);
});
test('automatic control surface resolves by touch device and viewport', () => {
  assert.equal(
    resolveControlSurface(CONTROL_SURFACE.AUTO, { touchDevice: true, width: 390, height: 844 }),
    CONTROL_SURFACE.MOBILE,
  );
  assert.equal(
    resolveControlSurface(CONTROL_SURFACE.AUTO, { touchDevice: true, width: 1024, height: 768 }),
    CONTROL_SURFACE.TABLETOP,
  );
  assert.equal(
    resolveControlSurface(CONTROL_SURFACE.AUTO, { touchDevice: false, width: 1440, height: 900 }),
    CONTROL_SURFACE.TABLETOP,
  );
  assert.equal(
    resolveControlSurface(CONTROL_SURFACE.MOBILE, { touchDevice: true, width: 1024, height: 768 }),
    CONTROL_SURFACE.MOBILE,
  );
});

// ---------------------------------------------------------------------------
// Yerel kontrol yüzeyi — regression kilidi.
//
// Bu matris, bildirilen hatanın tam kaynağı: `getEffectiveLocalSurface` ONLINE
// host'ta "birden çok insan koltuğu" sayıyordu (uzak oyuncular da `human`),
// bu yüzden ikinci oyuncu girince DOM yüzeyi kapanıyor, canvas tarafı ise
// ham tercihi okuyup onu da bastırıyordu → host P1 hiçbir kontrolü kalmıyordu.
// Koltuk sayısı artık GİRDİ DEĞİLDİR ve giriş çıkış yüzeyi değiştirmez.
// ---------------------------------------------------------------------------

test('explicit surface always wins, whatever the match composition', () => {
  // LOCAL, ikinci insan koltuğu doluyken
  assert.deepEqual(
    resolveLocalControlMode({
      isLocalMode: true, isHosting: false, preference: CONTROL_SURFACE.MOBILE, localSlot: 0,
    }),
    { mode: CONTROL_MODE.DOM, localControlSlot: 0 },
  );
  // ONLINE host, uzak oyuncular bağlıyken
  assert.deepEqual(
    resolveLocalControlMode({
      isHosting: true, isLocalHostPlayer: true, preference: CONTROL_SURFACE.MOBILE, localSlot: 0,
    }),
    { mode: CONTROL_MODE.DOM, localControlSlot: 0 },
  );
  assert.deepEqual(
    resolveLocalControlMode({
      isHosting: true, isLocalHostPlayer: true, preference: CONTROL_SURFACE.TABLETOP, localSlot: 0,
    }),
    { mode: CONTROL_MODE.CANVAS, localControlSlot: 0 },
  );
});

test('a device that is not a player gets no local surface', () => {
  // Kumanda ekranı: kendi overlay'ini kullanır, canvas köşesi çizilmez.
  assert.deepEqual(
    resolveLocalControlMode({
      isHosting: true, isLocalHostPlayer: false, preference: CONTROL_SURFACE.TABLETOP,
    }),
    { mode: CONTROL_MODE.NONE, localControlSlot: null },
  );
  // TV_CONSOLE host, lobi düğmesine basmadan seyirci ekranı.
  assert.deepEqual(
    resolveLocalControlMode({
      isHosting: true, isLocalHostPlayer: false, preference: CONTROL_SURFACE.MOBILE,
    }),
    { mode: CONTROL_MODE.NONE, localControlSlot: null },
  );
});

test('TV_CONSOLE host as player gets its own slot, not a shared canvas', () => {
  assert.deepEqual(
    resolveLocalControlMode({
      isHosting: true, isLocalHostPlayer: true, preference: CONTROL_SURFACE.MOBILE, localSlot: 2,
    }),
    { mode: CONTROL_MODE.DOM, localControlSlot: 2 },
  );
});

test('LOCAL without a known slot falls back to the whole canvas', () => {
  assert.deepEqual(
    resolveLocalControlMode({
      isLocalMode: true, isHosting: false, preference: CONTROL_SURFACE.TABLETOP, localSlot: null,
    }),
    { mode: CONTROL_MODE.CANVAS, localControlSlot: null },
  );
});

// ── Faz 4.3 — sakin mod ─────────────────────────────────────────────────────

test('calm mode normalizes as a boolean and defaults off', () => {
  assert.equal(DEFAULT_PREFERENCES.calmMode, false);
  assert.equal(normalizePreferences({}).calmMode, false);
  assert.equal(normalizePreferences({ calmMode: true }).calmMode, true);
  assert.equal(normalizePreferences({ calmMode: 'yes' }).calmMode, false);
});

test('calm mode reduces motion and pins the FX tier to low', () => {
  assert.equal(getPreference('calmMode'), false);
  assert.equal(motionScale(), 1);
  setPreference('calmMode', true);
  try {
    // OS tercihi yokken (node) tek kapı sakin moddur.
    assert.equal(prefersReducedMotion(), true);
    assert.equal(motionScale(), 0);
    // Termal/bateri: etkin kademe low, glow kapalı, partikül ölçeği düşük.
    assert.equal(fxTierName(), 'low');
    assert.equal(fxGlowEnabled(), false);
    assert.equal(fxParticleScale(), 0.4);
  } finally {
    setPreference('calmMode', false);
  }
  assert.equal(motionScale(), 1);
  assert.equal(fxTierName(), 'high');
});
