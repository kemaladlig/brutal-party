// tests/arenaProfile.test.mjs
// Verification of Step 3.1: Classifier singularity (B5)
// Ensures computePlayfield provides arena.profile and callers make arena-space decisions.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computePlayfield, isCompactLandscape, FIELD_DESIGN } from '../src/core/playfield.js';

test('computePlayfield outputs a complete, frozen arena.profile', () => {
  const arena = computePlayfield(1920, 1080);
  assert.ok(arena.profile, 'arena must have a profile object');
  assert.equal(typeof arena.profile.shortSide, 'number');
  assert.equal(typeof arena.profile.unit, 'number');
  assert.equal(arena.profile.designShort, FIELD_DESIGN.shortSide);
  assert.equal(typeof arena.profile.compactLandscape, 'boolean');
});

test('compactLandscape is false for desktop (1920x1080) and desktop window (900x600)', () => {
  const tv = computePlayfield(1920, 1080);
  assert.equal(tv.profile.compactLandscape, false, '1920x1080 TV is not compact landscape');

  const desktopWindow = computePlayfield(900, 600);
  assert.equal(desktopWindow.profile.compactLandscape, false, '900x600 desktop window is not mobile compact');

  const tablet = computePlayfield(1180, 820);
  assert.equal(tablet.profile.compactLandscape, false, '1180x820 tablet is not compact landscape');
});

test('compactLandscape is true for real phone viewports in landscape', () => {
  const phone1 = computePlayfield(852, 393); // iPhone 15 Pro landscape
  assert.equal(phone1.profile.compactLandscape, true, '852x393 phone must be compact landscape');

  const phone2 = computePlayfield(667, 375); // iPhone SE landscape
  assert.equal(phone2.profile.compactLandscape, true, '667x375 phone must be compact landscape');

  const phone3 = computePlayfield(784, 387);
  assert.equal(phone3.profile.compactLandscape, true, '784x387 phone must be compact landscape');
});

test('compactLandscape is always false in portrait viewports even on phones', () => {
  const portraitPhone = computePlayfield(393, 852);
  assert.equal(portraitPhone.profile.compactLandscape, false, 'portrait is never compact landscape');
});

test('isCompactLandscape accepts an arena object directly', () => {
  const phone = computePlayfield(852, 393);
  const desktop = computePlayfield(1920, 1080);

  assert.equal(isCompactLandscape(phone), true);
  assert.equal(isCompactLandscape(desktop), false);
});

test('40 random viewports maintain finite numbers and valid boolean profiles', () => {
  for (let i = 0; i < 40; i++) {
    const w = 320 + Math.floor(Math.random() * 2200);
    const h = 320 + Math.floor(Math.random() * 1600);
    const arena = computePlayfield(w, h);

    assert.ok(Number.isFinite(arena.profile.shortSide));
    assert.ok(Number.isFinite(arena.profile.unit));
    assert.equal(typeof arena.profile.compactLandscape, 'boolean');
    assert.ok(arena.profile.unit >= FIELD_DESIGN.minUnit);
    assert.ok(arena.profile.unit <= FIELD_DESIGN.maxUnit);
  }
});

// Source scan: verify arena-space callers do NOT pass window dimensions
test('hud.js and hordeView.js do not pass window dimensions to isCompactLandscape', () => {
  const hudSrc = readFileSync('src/ui/hud.js', 'utf8');
  const hordeSrc = readFileSync('src/games/hordeView.js', 'utf8');

  // Negative assertion: neither hud.js nor hordeView.js should contain isCompactLandscape(window...
  const badCall = /isCompactLandscape\s*\(\s*window\./;
  assert.ok(!badCall.test(hudSrc), 'src/ui/hud.js must not pass window to isCompactLandscape');
  assert.ok(!badCall.test(hordeSrc), 'src/games/hordeView.js must not pass window to isCompactLandscape');
});

// Negative test: verify that a line with window.innerWidth would be caught
test('negative: source scanner catches any regression to isCompactLandscape(window.innerWidth, ...)', () => {
  const mockRegression = 'if (isCompactLandscape(window.innerWidth, window.innerHeight)) doSomething();';
  const badCall = /isCompactLandscape\s*\(\s*window\./;
  assert.ok(badCall.test(mockRegression), 'regex must detect window-based isCompactLandscape calls');
});
