import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PREFERENCES,
  normalizePreferences,
} from '../src/core/preferences.js';
import {
  CONTROL_SURFACE,
  resolveControlSurface,
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
  assert.equal(result.version, 1);
  assert.equal(result.controlSurface, DEFAULT_PREFERENCES.controlSurface);
  assert.equal(result.audioMuted, DEFAULT_PREFERENCES.audioMuted);
  assert.equal(result.hapticsEnabled, false);
  assert.equal(result.pongInvert, 'on');
  assert.equal(result.pongSensitivity, 1.5);
});

test('explicit control surfaces remain available on non-touch desktop', () => {
  assert.equal(
    shouldShowVirtualControls({
      isHosting: false,
      isTouchDevice: false,
      surface: CONTROL_SURFACE.MOBILE,
    }),
    false,
  );
  assert.equal(
    shouldShowVirtualControls({
      isHosting: false,
      isTouchDevice: false,
      surface: CONTROL_SURFACE.TABLETOP,
    }),
    true,
  );
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
