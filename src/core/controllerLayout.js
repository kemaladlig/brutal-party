// Pure controller layout math. DOM measurement/application lives in the
// controller manager/editor so this module remains testable and side-effect free.

export const CONTROLLER_LAYOUT_VERSION = 1;
export const CONTROLLER_SIZE_MIN = 0.8;
export const CONTROLLER_SIZE_MAX = 1.3;
export const CONTROLLER_MIN_TOUCH_TARGET = 44;

export const DEFAULT_CONTROLLER_LAYOUT = Object.freeze({
  version: CONTROLLER_LAYOUT_VERSION,
  size: 1,
  left: Object.freeze({ x: 0.16, y: 0.86 }),
  right: Object.freeze({ x: 0.84, y: 0.86 }),
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pointOr(value, fallback) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    x: clamp(numberOr(source.x, fallback.x), 0, 1),
    y: clamp(numberOr(source.y, fallback.y), 0, 1),
  };
}

export function normalizeControllerLayout(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    version: CONTROLLER_LAYOUT_VERSION,
    size: Math.round(clamp(
      numberOr(source.size, DEFAULT_CONTROLLER_LAYOUT.size),
      CONTROLLER_SIZE_MIN,
      CONTROLLER_SIZE_MAX,
    ) * 100) / 100,
    left: pointOr(source.left, DEFAULT_CONTROLLER_LAYOUT.left),
    right: pointOr(source.right, DEFAULT_CONTROLLER_LAYOUT.right),
  };
}

function rectOrDefault(value, viewport) {
  const source = value && typeof value === 'object' ? value : {};
  const left = clamp(numberOr(source.left, 0), 0, viewport.width);
  const top = clamp(numberOr(source.top, 0), 0, viewport.height);
  const right = clamp(numberOr(source.right, viewport.width), left, viewport.width);
  const bottom = clamp(numberOr(source.bottom, viewport.height), top, viewport.height);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function placeSide({ desired, group, frame, side, center, centerGap, scale }) {
  const width = group.width * scale;
  const height = group.height * scale;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const desiredCenterX = frame.left + desired.x * frame.width;
  const desiredCenterY = frame.top + desired.y * frame.height;

  let minCenterX = frame.left + halfWidth;
  let maxCenterX = frame.right - halfWidth;
  if (side === 'left') {
    maxCenterX = Math.min(maxCenterX, center - centerGap / 2 - halfWidth);
  } else {
    minCenterX = Math.max(minCenterX, center + centerGap / 2 + halfWidth);
  }

  // Very narrow viewports can make the protected center and 44px targets
  // mathematically incompatible. Fit scale is calculated first; preserving
  // the touch target wins, while the gap is allowed to collapse to zero.
  if (minCenterX > maxCenterX) {
    const midpoint = (minCenterX + maxCenterX) / 2;
    minCenterX = midpoint;
    maxCenterX = midpoint;
  }

  const centerX = clamp(desiredCenterX, minCenterX, maxCenterX);
  const centerY = clamp(
    desiredCenterY,
    frame.top + halfHeight,
    frame.bottom - halfHeight,
  );
  const groupCenterX = group.left + group.width / 2;
  const groupCenterY = group.top + group.height / 2;

  return {
    centerX,
    centerY,
    dx: centerX - groupCenterX,
    dy: centerY - groupCenterY,
    width,
    height,
    scale,
  };
}

/**
 * Resolve a normalized profile against measured target groups.
 *
 * `groups` contains local viewport rects for the visible/hit target union on
 * each side. The returned translations are applied to every target belonging
 * to that side, so a moved hit zone never gets left behind at its old place.
 */
export function resolveControllerLayout(value, {
  viewport = { width: 1, height: 1 },
  safeFrame = null,
  groups = {},
  centerGap = null,
  minTouchTarget = CONTROLLER_MIN_TOUCH_TARGET,
} = {}) {
  const profile = normalizeControllerLayout(value);
  const sizeViewport = {
    width: Math.max(1, numberOr(viewport.width, 1)),
    height: Math.max(1, numberOr(viewport.height, 1)),
  };
  const frame = rectOrDefault(safeFrame, sizeViewport);
  const left = groups.left && groups.left.width > 0
    ? rectOrDefault(groups.left, sizeViewport)
    : null;
  const right = groups.right && groups.right.width > 0
    ? rectOrDefault(groups.right, sizeViewport)
    : null;

  if (!left && !right) {
    return {
      profile,
      scale: profile.size,
      frame,
      center: frame.left + frame.width / 2,
      centerGap: 0,
      sides: {},
    };
  }

  const center = frame.left + frame.width / 2;
  const requestedGap = centerGap === null
    ? Math.max(24, Math.min(120, frame.width * 0.16))
    : Math.max(0, numberOr(centerGap, 0));
  const totalWidth = (left?.width || 0) + (right?.width || 0) + requestedGap;
  const fitScale = totalWidth > 0 ? frame.width / totalWidth : profile.size;
  const minScaleForTouch = Math.max(
    left ? minTouchTarget / left.width : 0,
    right ? minTouchTarget / right.width : 0,
    left ? minTouchTarget / left.height : 0,
    right ? minTouchTarget / right.height : 0,
  );
  const scale = Math.max(minScaleForTouch, Math.min(profile.size, fitScale));
  const availableGap = Math.max(0, frame.width - ((left?.width || 0) + (right?.width || 0)) * scale);
  const effectiveGap = Math.min(requestedGap, availableGap);
  const sides = {};

  if (left) {
    sides.left = placeSide({
      desired: profile.left,
      group: left,
      frame,
      side: 'left',
      center,
      centerGap: effectiveGap,
      scale,
    });
  }
  if (right) {
    sides.right = placeSide({
      desired: profile.right,
      group: right,
      frame,
      side: 'right',
      center,
      centerGap: effectiveGap,
      scale,
    });
  }

  return {
    profile,
    scale,
    frame,
    center,
    centerGap: effectiveGap,
    sides,
  };
}

export function getDefaultControllerLayout() {
  return normalizeControllerLayout(DEFAULT_CONTROLLER_LAYOUT);
}
