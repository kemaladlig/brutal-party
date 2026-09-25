import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONTROLLER_LAYOUT,
  normalizeControllerLayout,
  resolveControllerLayout,
} from '../src/core/controllerLayout.js';

function rect(left, top, width, height) {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

test('controller layout normalization clamps size and normalized positions', () => {
  const result = normalizeControllerLayout({
    version: 99,
    size: 9,
    left: { x: -2, y: 3 },
    right: { x: Number.NaN, y: 0.4 },
  });
  assert.equal(result.version, DEFAULT_CONTROLLER_LAYOUT.version);
  assert.equal(result.size, 1.3);
  assert.deepEqual(result.left, { x: 0, y: 1 });
  assert.deepEqual(result.right, { x: DEFAULT_CONTROLLER_LAYOUT.right.x, y: 0.4 });
});

test('controller layout keeps both groups inside the safe frame', () => {
  const result = resolveControllerLayout(
    { size: 1, left: { x: 0, y: 0 }, right: { x: 1, y: 1 } },
    {
      viewport: { width: 390, height: 300 },
      safeFrame: rect(16, 40, 358, 220),
      groups: {
        left: rect(0, 100, 100, 100),
        right: rect(290, 100, 100, 100),
      },
      centerGap: 80,
    },
  );

  assert.ok(result.sides.left);
  assert.ok(result.sides.right);
  assert.ok(result.sides.left.centerX - result.sides.left.width / 2 >= result.frame.left - 0.001);
  assert.ok(result.sides.right.centerX + result.sides.right.width / 2 <= result.frame.right + 0.001);
  assert.ok(result.sides.left.centerY - result.sides.left.height / 2 >= result.frame.top - 0.001);
  assert.ok(result.sides.right.centerY + result.sides.right.height / 2 <= result.frame.bottom + 0.001);
});

test('controller layout preserves a central gap and never overlaps groups', () => {
  const result = resolveControllerLayout(
    { size: 1, left: { x: 0.8, y: 0.5 }, right: { x: 0.2, y: 0.5 } },
    {
      viewport: { width: 800, height: 400 },
      safeFrame: rect(0, 0, 800, 400),
      groups: {
        left: rect(20, 150, 100, 100),
        right: rect(680, 150, 100, 100),
      },
      centerGap: 100,
    },
  );

  assert.ok(result.sides.left.centerX + result.sides.left.width / 2 <= result.sides.right.centerX - result.sides.right.width / 2);
  assert.ok(result.centerGap >= 0);
});

test('controller layout returns a responsive fit scale for narrow viewports', () => {
  const result = resolveControllerLayout(
    { size: 1.3, left: { x: 0.1, y: 0.9 }, right: { x: 0.9, y: 0.9 } },
    {
      viewport: { width: 320, height: 180 },
      safeFrame: rect(0, 0, 320, 180),
      groups: {
        left: rect(0, 20, 150, 150),
        right: rect(170, 20, 150, 150),
      },
    },
  );

  assert.ok(result.scale < 1.3);
  assert.ok(result.scale > 0);
  assert.ok(result.sides.left.width >= 44);
  assert.ok(result.sides.right.width >= 44);
});
