// tests/qualityGate.test.mjs
// Automated verification of the Quality Gate invariants, including mandatory
// negative tests proving that every gate and scanner turns red when a defect is present.

import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGame, GATE_THRESHOLDS, TUNING_ANCHOR } from '../src/core/qualityGate.js';
import {
  auditViewFidelityInContent,
  auditMotionCuesInContent,
  auditUnscaledGeometryInContent,
} from '../src/core/qualityAuditors.js';

function makeMockGameData(overrides = {}) {
  return {
    mode: 'TEST_GAME',
    desktop: {
      playerPx: 28,
      playerPct: 5.88,
      crossTime: 4.81,
      aspect: 1.71,
      short: 952,
      insets: '34/16/34/16',
    },
    phone: {
      playerPx: 11.5,
      playerPct: 5.88,
      crossTime: 4.81,
      aspect: 2.03,
      short: 391,
      insets: '12/12/12/12',
    },
    corridor: {
      narrowest: 67,
      playerDiameter: 56,
      passable: true,
      reachable: true,
    },
    viewFidelity: {
      ok: true,
      drift: 0,
      detail: 'ok',
    },
    unscaledGeometryCount: 0,
    unscaledMotionCuesCount: 0,
    ...overrides,
  };
}

test('compliant game passes all 7 gates with zero failures', () => {
  const result = evaluateGame(makeMockGameData());
  assert.equal(result.passed, true);
  assert.equal(result.failures.length, 0);
  assert.equal(result.gates.I1.ok, true);
  assert.equal(result.gates.I2.ok, true);
  assert.equal(result.gates.I3.ok, true);
  assert.equal(result.gates.I4.ok, true);
  assert.equal(result.gates.I5.ok, true);
  assert.equal(result.gates.I6.ok, true);
  assert.equal(result.gates.I7.ok, true);
});

// Negative test 1: Scale drift
test('negative: I1 turns red when scale drifts > 1%', () => {
  const mutated = makeMockGameData({
    phone: {
      playerPx: 15,
      playerPct: 7.64, // ~30% drift from 5.88%
      crossTime: 4.81,
      aspect: 2.03,
      short: 391,
    },
  });
  const result = evaluateGame(mutated);
  assert.equal(result.passed, false);
  assert.equal(result.gates.I1.ok, false);
  assert.ok(result.failures.some((f) => f.includes('I1')));
});

// Negative test 1b: Unmeasurable body (B7)
test('negative: I1 turns red when engine exposes no body radius at runtime', () => {
  const mutated = makeMockGameData({
    desktop: { playerPct: null, crossTime: 5.0 },
    phone: { playerPct: null, crossTime: 5.0 },
  });
  const result = evaluateGame(mutated);
  assert.equal(result.passed, false);
  assert.equal(result.gates.I1.ok, false);
});

// Negative test 2: Speed drift
test('negative: I2 turns red when crossing time drifts > 1%', () => {
  const mutated = makeMockGameData({
    phone: {
      playerPx: 11.5,
      playerPct: 5.88,
      crossTime: 6.2, // ~29% slower on phone
      aspect: 2.03,
      short: 391,
    },
  });
  const result = evaluateGame(mutated);
  assert.equal(result.passed, false);
  assert.equal(result.gates.I2.ok, false);
  assert.ok(result.failures.some((f) => f.includes('I2')));
});

// Negative test 3: Corridor passability
test('negative: I3 turns red when corridor is narrower than player diameter', () => {
  const mutated = makeMockGameData({
    corridor: {
      narrowest: 40,
      playerDiameter: 56, // 40/56 = 0.71x < 1.0
      passable: false,
      reachable: false,
    },
  });
  const result = evaluateGame(mutated);
  assert.equal(result.passed, false);
  assert.equal(result.gates.I3.ok, false);
  assert.ok(result.failures.some((f) => f.includes('I3')));
});

// Negative test 4: Scanner - View radius fallback fidelity (I4)
test('scanner negative: auditViewFidelityInContent turns red and fails I4 on fallback mismatch', () => {
  const mockViewCode = `
    export function draw(ctx, player) {
      const r = player.radius || 10;
      ctx.arc(player.x, player.y, r, 0, Math.PI * 2);
    }
  `;
  // Motor yarıçapı 15 iken view fallback 10: 5px sapma
  const fidelity = auditViewFidelityInContent(mockViewCode, 15, 'TEST');
  assert.equal(fidelity.ok, false);
  assert.equal(fidelity.drift, 5);

  const result = evaluateGame(makeMockGameData({ viewFidelity: fidelity }));
  assert.equal(result.passed, false);
  assert.equal(result.gates.I4.ok, false);
  assert.ok(result.failures.some((f) => f.includes('I4')));
});

// Negative test 4b: Fail-closed when motor radius cannot be determined
test('scanner negative: auditViewFidelityInContent fails closed when motor radius is null or undefined', () => {
  const mockViewCode = `const r = player.radius || 15;`;
  const fidelity = auditViewFidelityInContent(mockViewCode, null, 'TEST');
  assert.equal(fidelity.ok, false);
  assert.ok(fidelity.detail.includes('fail-closed'));

  const result = evaluateGame(makeMockGameData({ viewFidelity: fidelity }));
  assert.equal(result.passed, false);
  assert.equal(result.gates.I4.ok, false);
});

// Negative test 4c: Fail-closed on unresolvable constant name
test('scanner negative: auditViewFidelityInContent fails closed when constant cannot be resolved', () => {
  const mockViewCode = `const r = player.radius || UNDEFINED_CONSTANT;`;
  const fidelity = auditViewFidelityInContent(mockViewCode, 15, 'TEST');
  assert.equal(fidelity.ok, false);
  assert.ok(fidelity.detail.includes('sabit çözülemedi'));
});

// Negative test 5: Scanner - Unscaled geometry px (I5)
test('scanner negative: auditUnscaledGeometryInContent detects literal borderWidth and fails I5', () => {
  const cleanCode = `
    drawGameAvatar(ctx, x, y, r, p, {
      borderWidth: 2.5 * u,
    });
  `;
  assert.equal(auditUnscaledGeometryInContent(cleanCode), 0);

  const dirtyCode = `
    drawGameAvatar(ctx, x, y, r, p, {
      borderWidth: 2.5,
    });
  `;
  const defectCount = auditUnscaledGeometryInContent(dirtyCode);
  assert.equal(defectCount, 1);

  const result = evaluateGame(makeMockGameData({ unscaledGeometryCount: defectCount }));
  assert.equal(result.passed, false);
  assert.equal(result.gates.I5.ok, false);
  assert.ok(result.failures.some((f) => f.includes('I5')));
});

// Negative test 6: Scanner - Unscaled motion cues / lineWidth (I6)
test('scanner negative: auditMotionCuesInContent detects literal lineWidth and fails I6', () => {
  const cleanCode = `
    ctx.lineWidth = Math.max(1, 2.5 * u);
    ctx.lineWidth = 4 * (arena.unit ?? 1);
  `;
  assert.equal(auditMotionCuesInContent(cleanCode), 0);

  const dirtyCode = `
    ctx.lineWidth = 6;
  `;
  const defectCount = auditMotionCuesInContent(dirtyCode);
  assert.equal(defectCount, 1);

  const result = evaluateGame(makeMockGameData({ unscaledMotionCuesCount: defectCount }));
  assert.equal(result.passed, false);
  assert.equal(result.gates.I6.ok, false);
  assert.ok(result.failures.some((f) => f.includes('I6')));
});

// Negative test 7: Body readability (too small on phone)
test('negative: I7 turns red when player diameter on phone is smaller than 12px for standard games', () => {
  const mutated = makeMockGameData({
    mode: 'TANKS',
    phone: {
      playerPx: 5.0, // diameter = 10px < 12px threshold
      playerPct: 2.5,
      crossTime: 4.81,
      aspect: 2.03,
      short: 391,
    },
  });
  const result = evaluateGame(mutated);
  assert.equal(result.passed, false);
  assert.equal(result.gates.I7.ok, false);
  assert.ok(result.failures.some((f) => f.includes('I7')));
});

// Negative test 7b: CURVE line game threshold (4.5px)
test('I7 threshold rules: CURVE allows 4.5px minimum diameter while failing below 4.5px', () => {
  const passingCurve = makeMockGameData({
    mode: 'CURVE',
    phone: {
      playerPx: 2.4, // diameter = 4.8px >= 4.5px
      playerPct: 1.2,
      crossTime: 4.81,
      aspect: 2.03,
      short: 391,
    },
  });
  const passResult = evaluateGame(passingCurve);
  assert.equal(passResult.gates.I7.ok, true);

  const failingCurve = makeMockGameData({
    mode: 'CURVE',
    phone: {
      playerPx: 2.0, // diameter = 4.0px < 4.5px
      playerPct: 1.0,
      crossTime: 4.81,
      aspect: 2.03,
      short: 391,
    },
  });
  const failResult = evaluateGame(failingCurve);
  assert.equal(failResult.passed, false);
  assert.equal(failResult.gates.I7.ok, false);
});

// Reports do not fail the build
test('reports (I8-I11) capture tuning variance without failing the build', () => {
  const result = evaluateGame(makeMockGameData({
    phone: {
      playerPx: 11.5,
      playerPct: 5.88,
      crossTime: 4.81,
      aspect: 2.53, // Ultrawide or high aspect ratio deviation
      short: 391,
      insets: '16/16/16/16',
    },
  }));
  assert.equal(result.passed, true); // Still passes because I8 is a report
  assert.ok(result.reports.I8.value > 0);
  assert.ok(result.reports.I9.value > 0);
});
