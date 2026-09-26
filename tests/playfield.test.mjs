import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computePlayfield,
  resolveInsets,
  fieldPx,
  fieldRadius,
  fieldSpeed,
  FIELD_DESIGN,
  FIELD_PRESETS,
  isCompactLandscape,
} from '../src/core/playfield.js';

// Stage 1 guard: computePlayfield() must reproduce the arena math that every
// engine carried inline before the migration. These are verbatim copies of the
// pre-migration formulas, one per distinct margin shape the codebase used.
// If a preset is retuned, this test is what stops a silent geometry change
// from reaching all 15 engines at once.
//
// Stage 2 deliberately changes ONE case: compact landscape (phone held
// sideways), where a flat 32px vertical margin ate ~16% of a 393px screen.
// So the migration guard is scoped to viewports the compact rule must not
// touch, and the compact rule gets its own explicit tests below.
const UNCHANGED_VIEWPORTS = [
  [393, 852], [412, 915], [360, 640],            // phone portrait
  [1024, 768], [1180, 820], [820, 1180],         // tablet / small desktop
  [1280, 720], [1440, 900], [1920, 1080], [2560, 1440], // TV / desktop
];

const COMPACT_VIEWPORTS = [
  [667, 375], [852, 393], [915, 412], [844, 390], [320, 240],
];

const ALL_VIEWPORTS = [...UNCHANGED_VIEWPORTS, ...COMPACT_VIEWPORTS];

// The compact vertical inset Stage 2 introduced, restated independently.
// Safe-area aware: a device with no notch/home-indicator collapses to the
// wall-stroke floor, a notched one expands to clear the cutout.
const COMPACT_VERTICAL_FLOOR = 3;
const SAFE_AREA_FLOOR = 3;
const COMPACT_MIN_DIM_FRACTION = 0.04;
const NO_SAFE_AREA = { top: 0, right: 0, bottom: 0, left: 0 };
const compactVertical = (h, safe = NO_SAFE_AREA) => Math.max(
  COMPACT_VERTICAL_FLOOR,
  SAFE_AREA_FLOOR + safe.top,
  SAFE_AREA_FLOOR + safe.bottom,
);

function box(left, top, w, h) {
  return {
    left, top,
    w, h,
    right: left + w,
    bottom: top + h,
    cx: left + w / 2,
    cy: top + h / 2,
    size: Math.min(w, h),
  };
}

function insetBox(marginX, marginY, viewW, viewH) {
  const w = viewW - marginX * 2;
  const h = viewH - marginY * 2;
  return {
    left: marginX, top: marginY,
    w, h,
    right: marginX + w,
    bottom: marginY + h,
    cx: viewW / 2,
    cy: viewH / 2,
    size: Math.min(w, h),
  };
}

// archetype → { engines, formula, integral }
// `integral: false` for racing: RACE's margin is a raw fraction of the short
// side, never floored, so its geometry is fractional by design.
const LEGACY = {
  standard: {
    engines: ['PONG', 'ARCHER', 'BOMB', 'HEIST', 'CURVE', 'NINJA', 'SNAKE', 'LASER', 'COLLAPSE', 'CLONE'],
    integral: true,
    formula: (w, h) => insetBox(
      Math.max(12, Math.floor(w * 0.04)),
      h > w ? Math.max(48, Math.floor(h * 0.12)) : Math.max(32, Math.floor(h * 0.06)),
      w, h,
    ),
  },
  roomy: {
    engines: ['HORDE'],
    integral: true,
    formula: (w, h) => {
      const mx = Math.max(16, Math.floor(w * 0.04));
      const my = h > w ? Math.max(54, Math.floor(h * 0.12)) : Math.max(34, Math.floor(h * 0.07));
      return box(mx, my, Math.max(120, w - mx * 2), Math.max(120, h - my * 2));
    },
  },
  crown: {
    engines: ['CROWN'],
    integral: true,
    formula: (w, h) => insetBox(
      Math.max(16, Math.floor(w * 0.04)),
      h > w ? Math.max(48, Math.floor(h * 0.12)) : Math.max(34, Math.floor(h * 0.065)),
      w, h,
    ),
  },
  flat: {
    engines: ['TANKS'],
    integral: true,
    formula: (w, h) => insetBox(
      Math.max(12, Math.floor(w * 0.04)),
      Math.max(32, Math.floor(h * 0.06)),
      w, h,
    ),
  },
  dense: {
    engines: ['ZONE'],
    integral: true,
    formula: (w, h) => insetBox(
      Math.max(8, Math.floor(w * 0.025)),
      h > w ? Math.max(48, Math.floor(h * 0.12)) : Math.max(24, Math.floor(h * 0.045)),
      w, h,
    ),
  },
  racing: {
    engines: ['RACE'],
    integral: false,
    formula: (w, h) => {
      const m = Math.min(w, h) * 0.08;
      return box(m, m + 30, (w - m) - m, (h - m - 20) - (m + 30));
    },
  },
};

// racing yolunda `h - m - 20` ile `top + (h - top - bottom)` 1 ULP ayrışabilir.
const EPSILON = 1e-9;

for (const [preset, { engines, formula, integral }] of Object.entries(LEGACY)) {
  test(`${preset} playfield matches pre-migration geometry outside compact landscape (${engines.join(', ')})`, () => {
    for (const [w, h] of UNCHANGED_VIEWPORTS) {
      const expected = formula(w, h);
      const actual = computePlayfield(w, h, preset);
      const label = `${preset} @ ${w}x${h}`;

      if (integral) {
        assert.ok(Number.isInteger(expected.left), `${label} fixture should be integral`);
      }
      for (const [key, want] of Object.entries({
        left: expected.left,
        top: expected.top,
        width: expected.w,
        height: expected.h,
      })) {
        if (integral) {
          assert.equal(actual[key], want, `${label} ${key}`);
        } else {
          const delta = Math.abs(actual[key] - want);
          assert.ok(delta <= EPSILON, `${label} ${key}: got ${actual[key]}, want ${want} (Δ${delta})`);
        }
      }

      for (const key of ['right', 'bottom', 'cx', 'cy', 'size']) {
        const delta = Math.abs(actual[key] - expected[key]);
        assert.ok(
          delta <= EPSILON,
          `${label} ${key}: got ${actual[key]}, want ${expected[key]} (Δ${delta})`,
        );
      }
    }
  });
}

test('playfield edges stay consistent with its own box', () => {
  for (const preset of Object.keys(LEGACY)) {
    for (const [w, h] of ALL_VIEWPORTS) {
      const pf = computePlayfield(w, h, preset);
      assert.equal(pf.right - pf.left, pf.width, `${preset} ${w}x${h} right`);
      assert.equal(pf.bottom - pf.top, pf.height, `${preset} ${w}x${h} bottom`);
      assert.equal(pf.size, Math.min(pf.width, pf.height), `${preset} ${w}x${h} size`);
      assert.equal(pf.cx, pf.left + pf.width / 2, `${preset} ${w}x${h} cx`);
      assert.equal(pf.cy, pf.top + pf.height / 2, `${preset} ${w}x${h} cy`);
    }
  }
});

test('playfield insets are positive and sum to the excluded area', () => {
  for (const preset of Object.keys(LEGACY)) {
    for (const [w, h] of ALL_VIEWPORTS) {
      const pf = computePlayfield(w, h, preset);
      const { top, right, bottom, left } = pf.insets;
      for (const [side, value] of Object.entries({ top, right, bottom, left })) {
        assert.ok(value >= 0, `${preset} ${w}x${h} ${side} inset must not be negative`);
      }
      // HORDE clamps the field to a 120px minimum span, so the sum can exceed
      // the viewport; everywhere else the excluded area is exactly the insets.
      if (preset !== 'roomy') {
        const excluded = left + right + (bottom - top);
        assert.ok(excluded <= w + h, `${preset} ${w}x${h} insets exceed the viewport`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Stage 2: compact landscape reclaims vertical space on phones
// ---------------------------------------------------------------------------

test('compact landscape uses the reduced vertical inset on every inset preset', () => {
  for (const preset of ['standard', 'roomy', 'crown', 'flat', 'dense']) {
    for (const [w, h] of COMPACT_VIEWPORTS) {
      const pf = computePlayfield(w, h, preset);
      const want = compactVertical(h);
      assert.equal(pf.insets.top, want, `${preset} @ ${w}x${h} top inset`);
      assert.equal(pf.insets.bottom, want, `${preset} @ ${w}x${h} bottom inset`);
      assert.equal(pf.height, h - want * 2, `${preset} @ ${w}x${h} field height`);
    }
  }
});

// Without a safe area the field runs to the screen edges vertically; the floor
// is only there so the arena's 3-4px wall stroke is not half-clipped.
// (Horizontal coverage is intentionally lower — the side walls stay put.)
test('compact landscape without a notch uses essentially the full height', () => {
  for (const [w, h] of COMPACT_VIEWPORTS) {
    const pf = computePlayfield(w, h, 'standard');
    const verticalCoverage = pf.height / h;
    assert.ok(verticalCoverage > 0.97, `${w}x${h} uses only ${(verticalCoverage * 100).toFixed(1)}% of the height`);
  }
});

test('a landscape notch widens the horizontal inset past the preset margin', () => {
  // iPhone 15 Pro / Pro Max report 47-59px in landscape, which is WIDER than
  // the 34px preset margin. Ignoring it puts players under the cutout.
  const notch = { top: 0, right: 0, bottom: 21, left: 47 };
  const [w, h] = [852, 393];
  const preset = 'standard';
  const withoutNotch = computePlayfield(w, h, preset);
  const withNotch = resolveInsets(w, h, FIELD_PRESETS.standard, notch, true);

  assert.ok(withNotch.left >= 47, `notch inset ${withNotch.left} must clear 47px`);
  assert.ok(withNotch.left > withoutNotch.left, 'notch must widen the field');
  assert.equal(withNotch.left, withNotch.right, 'left/right insets stay symmetric');
});

test('the home indicator widens only the bottom inset, not the top', () => {
  const safe = { top: 0, right: 0, bottom: 21, left: 0 };
  const insets = resolveInsets(852, 393, FIELD_PRESETS.standard, safe, true);
  assert.ok(insets.bottom >= 21, `bottom inset ${insets.bottom} must clear the home indicator`);
  assert.equal(insets.top, COMPACT_VERTICAL_FLOOR, 'no notch on top -> floor only');
});

test('safe area is ignored outside compact landscape', () => {
  // Desktop, tablet and portrait must not be pushed around by phone insets.
  const safe = { top: 59, right: 59, bottom: 34, left: 59 };
  for (const [w, h] of [[1920, 1080], [1280, 720], [1180, 820], [393, 852]]) {
    const insets = resolveInsets(w, h, FIELD_PRESETS.standard, safe, false);
    const legacy = LEGACY.standard.formula(w, h);
    // `legacy.top` is the margin; `legacy.bottom` is the resulting edge.
    assert.equal(insets.left, legacy.left, `${w}x${h} left must be preset-only`);
    assert.equal(insets.top, legacy.top, `${w}x${h} top must be preset-only`);
    assert.equal(insets.bottom, legacy.top, `${w}x${h} bottom must be preset-only`);
  }
});

test('RACE compacts its min-dimension margin but keeps its fixed HUD bands', () => {
  for (const [w, h] of COMPACT_VIEWPORTS) {
    const pf = computePlayfield(w, h, 'racing');
    const base = Math.min(w, h) * COMPACT_MIN_DIM_FRACTION;
    // `insets` are the reserved bands; `top`/`bottom` are the resulting EDGE
    // coordinates. Different quantities — don't conflate them.
    assert.ok(Math.abs(pf.insets.left - base) <= EPSILON, `racing @ ${w}x${h} left inset`);
    assert.ok(Math.abs(pf.insets.top - (base + 30)) <= EPSILON, `racing @ ${w}x${h} top inset`);
    assert.ok(Math.abs(pf.insets.bottom - (base + 20)) <= EPSILON, `racing @ ${w}x${h} bottom inset`);
    // The 30/20px bands anchor RACE's top pill and bottom chrome; only the
    // percentage margin shrinks. RACE's field is anchored to the viewport
    // origin, so the edges sit exactly at the reserved bands.
    assert.ok(Math.abs(pf.top - pf.insets.top) <= EPSILON, `racing @ ${w}x${h} top edge`);
    assert.ok(Math.abs(pf.bottom - (h - pf.insets.bottom)) <= EPSILON, `racing @ ${w}x${h} bottom edge`);
  }

  // and it must still be a net gain over the pre-Stage-2 8% margin
  for (const [w, h] of COMPACT_VIEWPORTS) {
    const before = LEGACY.racing.formula(w, h);
    const after = computePlayfield(w, h, 'racing');
    assert.ok(after.height > before.h, `racing @ ${w}x${h} should gain height`);
  }
});

test('compact landscape reclaims real height versus the old flat margin', () => {
  // The whole point of Stage 2: a phone in landscape must get a taller field
  // than it did before. Lock the direction and a conservative floor.
  for (const [preset, def] of Object.entries(LEGACY)) {
    if (preset === 'racing') continue;
    for (const [w, h] of COMPACT_VIEWPORTS) {
      const before = def.formula(w, h);
      const after = computePlayfield(w, h, preset);
      assert.ok(
        after.height > before.h,
        `${preset} @ ${w}x${h} should be taller: ${after.height} vs ${before.h}`,
      );
      const gain = (after.height - before.h) / before.h;
      assert.ok(gain >= 0.05, `${preset} @ ${w}x${h} only gained ${(gain * 100).toFixed(1)}%`);
    }
  }
});

test('compact landscape leaves the horizontal inset alone', () => {
  // Vertical is the win; the side walls are part of the visual language and
  // widening the field further would over-stretch a 2:1+ arena.
  for (const [w, h] of COMPACT_VIEWPORTS) {
    for (const preset of ['standard', 'roomy', 'crown', 'flat', 'dense']) {
      const pf = computePlayfield(w, h, preset);
      const want = LEGACY[preset].formula(w, h);
      assert.equal(pf.left, want.left, `${preset} @ ${w}x${h} left inset must not change`);
      assert.equal(pf.width, want.w, `${preset} @ ${w}x${h} width must not change`);
    }
  }
});

test('portrait keeps its large vertical margin even on a phone', () => {
  // The portrait margin is what clears the rotate prompt and the portrait
  // control stack. Losing it would regress that flow, so it is guarded here.
  // TANKS is excluded from the 48px floor: `flat` never had a portrait branch
  // (`max(32, 6%)` in both orientations), so demanding 48 would invent a
  // guarantee the engine never made.
  for (const [w, h] of [[393, 852], [412, 915], [360, 640]]) {
    for (const preset of ['standard', 'roomy', 'crown', 'flat', 'dense']) {
      const pf = computePlayfield(w, h, preset);
      const want = LEGACY[preset].formula(w, h);
      assert.equal(pf.top, want.top, `${preset} @ ${w}x${h} portrait top`);
      assert.equal(pf.height, want.h, `${preset} @ ${w}x${h} portrait height`);
      if (preset !== 'flat') {
        assert.ok(pf.top >= 48, `${preset} @ ${w}x${h} portrait needs its 48px floor`);
      }
    }
  }
});

test('desktop, tablet and TV insets are untouched by the compact rule', () => {
  for (const [w, h] of [[1024, 768], [1180, 820], [1280, 720], [1440, 900], [1920, 1080], [2560, 1440]]) {
    for (const [preset, def] of Object.entries(LEGACY)) {
      const before = def.formula(w, h);
      const after = computePlayfield(w, h, preset);
      assert.equal(after.top, before.top, `${preset} @ ${w}x${h} top`);
      assert.equal(after.height, before.h, `${preset} @ ${w}x${h} height`);
      assert.equal(after.width, before.w, `${preset} @ ${w}x${h} width`);
    }
  }
});

test('isCompactLandscape classifies phone landscape only', () => {
  for (const [w, h] of COMPACT_VIEWPORTS) {
    assert.equal(isCompactLandscape(w, h), true, `${w}x${h} should be compact landscape`);
  }
  for (const [w, h] of UNCHANGED_VIEWPORTS) {
    assert.equal(isCompactLandscape(w, h), false, `${w}x${h} must not be compact landscape`);
  }
  // Rotation flips the answer, which is the whole point of the predicate.
  assert.equal(isCompactLandscape(852, 393), true);
  assert.equal(isCompactLandscape(393, 852), false);
});

test('unit is 1.0 at the desktop design reference and scales with the field', () => {
  const reference = computePlayfield(1920, 1080, 'standard');
  assert.equal(reference.size, FIELD_DESIGN.shortSide);
  assert.equal(reference.unit, 1);

  const phone = computePlayfield(852, 393, 'standard');
  assert.ok(phone.unit < 0.5, `phone unit ${phone.unit} should be well under half`);
  assert.ok(phone.aspect > 2, `phone aspect ${phone.aspect} should be wide`);

  const huge = computePlayfield(5120, 2880, 'standard');
  assert.ok(huge.unit <= FIELD_DESIGN.maxUnit, 'unit must stay clamped at the top');
  const tiny = computePlayfield(160, 120, 'standard');
  assert.ok(tiny.unit >= FIELD_DESIGN.minUnit, 'unit must stay clamped at the bottom');
});

test('field helpers scale with the field and keep proportional ratios', () => {
  const reference = computePlayfield(1920, 1080, 'standard');
  const phone = computePlayfield(852, 393, 'standard');
  const ratio = phone.unit / reference.unit;

  assert.ok(Math.abs(fieldPx(phone, 100) - 100 * ratio) < EPSILON);
  assert.ok(Math.abs(fieldSpeed(phone, 200) - 200 * ratio) < EPSILON);

  // 36 design px is 3.78% of the 952px reference field, so a 3% floor must not
  // bind at the reference: a phone gets a strictly proportional body.
  const design = 36;
  assert.ok(Math.abs(fieldRadius(reference, design, 0.03) - design) < EPSILON);
  assert.ok(Math.abs(fieldRadius(phone, design, 0.03) - design * ratio) < EPSILON);
});

test('minUnit stops a degenerate field from scaling entities into nothing', () => {
  // 320x200 is far below any real device, but embedded webviews and split
  // screen get close. It IS compact landscape, so it exercises the Stage 2
  // inset too. unit must not follow size all the way down.
  const tiny = computePlayfield(320, 200, 'standard');
  assert.ok(tiny.size < 200, `expected a degenerate field, got ${tiny.size}`);
  assert.equal(tiny.unit, FIELD_DESIGN.minUnit);

  // The smallest realistic phone landscape must NOT be clamped — otherwise the
  // clamp would silently change phone geometry.
  for (const [w, h] of [[667, 375], [852, 393], [915, 412]]) {
    const phone = computePlayfield(w, h, 'standard');
    assert.ok(
      phone.unit > FIELD_DESIGN.minUnit,
      `${w}x${h} is a real phone and must scale proportionally (unit ${phone.unit})`,
    );
  }
});

test('fieldRadius floor is relative, so it scales with the field not the device', () => {
  const design = 36;
  // Above the share that minUnit already guarantees, so the floor is the
  // binding constraint here.
  const floor = 0.2;
  const tiny = computePlayfield(320, 200, 'standard');
  const tinyRadius = fieldRadius(tiny, design, floor);
  assert.ok(
    Math.abs(tinyRadius - tiny.size * floor) < EPSILON,
    `floor should bind: got ${tinyRadius}`,
  );

  // A phone-sized field at the same design radius is proportionally larger:
  // the floor is a share of the field, never an absolute pixel count.
  const phone = computePlayfield(852, 393, 'standard');
  assert.ok(fieldRadius(phone, design, floor) > tinyRadius);
  assert.ok(
    Math.abs(fieldRadius(phone, design, floor) - phone.size * floor) < EPSILON,
  );
});
