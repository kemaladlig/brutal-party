/**
 * physics2d.js — Shared 2D physics & collision helpers for Brutal Party games.
 * Part of the Phase 3 Architecture Refactor.
 */

/**
 * Clamps player position (and radius) to arena boundary rectangle.
 * @param {Object} p - Entity with x, y (and optional vx, vy)
 * @param {number} r - Entity collision radius
 * @param {Object} arena - Arena object containing left, right, top, bottom
 * @param {Object} [opts] - Options { zeroVelocity: boolean }
 */
export function clampToArena(p, r, arena, opts = {}) {
  const { left, right, top, bottom } = arena;

  if (p.x - r < left) {
    p.x = left + r;
    if (opts.zeroVelocity && p.vx !== undefined) p.vx = 0;
  }
  if (p.x + r > right) {
    p.x = right - r;
    if (opts.zeroVelocity && p.vx !== undefined) p.vx = 0;
  }
  if (p.y - r < top) {
    p.y = top + r;
    if (opts.zeroVelocity && p.vy !== undefined) p.vy = 0;
  }
  if (p.y + r > bottom) {
    p.y = bottom - r;
    if (opts.zeroVelocity && p.vy !== undefined) p.vy = 0;
  }
}

/**
 * Resolves circle entity vs AABB rectangle obstacles collision, applying surface slide.
 * @param {Object} p - Entity with x, y, vx, vy
 * @param {Array<Object>} obstacles - Array of rects { x, y, w, h }
 * @param {number} r - Entity collision radius
 * @param {Object} [opts] - Options { velScale, eject, onPush }
 */
export function resolveAABB(p, obstacles, r, opts = {}) {
  if (!obstacles || !obstacles.length) return;

  for (const obs of obstacles) {
    const closestX = Math.max(obs.x, Math.min(p.x, obs.x + obs.w));
    const closestY = Math.max(obs.y, Math.min(p.y, obs.y + obs.h));

    const dx = p.x - closestX;
    const dy = p.y - closestY;
    const distSq = dx * dx + dy * dy;

    if (distSq < r * r) {
      const dist = Math.sqrt(distSq);
      if (dist > 0.001) {
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = r - dist;
        p.x += nx * overlap;
        p.y += ny * overlap;

        // Slide along obstacle surface if velocity exists
        if (p.vx !== undefined && p.vy !== undefined) {
          const dot = p.vx * nx + p.vy * ny;
          if (dot < 0) {
            p.vx -= dot * nx;
            p.vy -= dot * ny;
          }
        }
      } else {
        // Emergency ejection if inside obstacle center
        p.x += r;
      }
    }
  }
}

/**
 * Checks if a point (x, y) is blocked by any rectangle in obstacles list.
 * @param {number} x - Point X
 * @param {number} y - Point Y
 * @param {Array<Object>} rects - List of obstacle rects { x, y, w, h }
 * @param {number} [pad=0] - Extra padding expanding obstacle rects
 * @returns {boolean} True if point is inside any obstacle
 */
export function pointBlocked(x, y, rects, pad = 0) {
  if (!rects) return false;
  for (const r of rects) {
    if (
      x >= r.x - pad &&
      x <= r.x + r.w + pad &&
      y >= r.y - pad &&
      y <= r.y + r.h + pad
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Updates moving obstacles (movers) according to style/harmonic oscillator parameters.
 * @param {Array<Object>} rects - Array of obstacle rects with optional mover object
 * @param {number} dt - Delta time in seconds
 * @param {string} [style='sine'] - 'sine' | 'pingpong'
 */
export function updateMovers(rects, dt, style = 'sine') {
  if (!rects) return;
  for (const r of rects) {
    if (r.mover) {
      const m = r.mover;
      if (style === 'sine') {
        m.phase = (m.phase || 0) + dt * (m.speed || 1);
        const offset = Math.sin(m.phase) * (m.amp || 0);
        if (m.axis === 'x') r.x = (m.baseX || 0) + offset;
        if (m.axis === 'y') r.y = (m.baseY || 0) + offset;
      }
    } else if (r.vx !== undefined || r.vy !== undefined) {
      // Ping-pong style moving walls (e.g., laser.js)
      r.x += (r.vx || 0) * dt;
      r.y += (r.vy || 0) * dt;
      if (r.vx > 0 && r.x >= r.maxX) {
        r.x = r.maxX;
        r.vx *= -1;
      } else if (r.vx < 0 && r.x <= r.minX) {
        r.x = r.minX;
        r.vx *= -1;
      }
      if (r.vy > 0 && r.y >= r.maxY) {
        r.y = r.maxY;
        r.vy *= -1;
      } else if (r.vy < 0 && r.y <= r.minY) {
        r.y = r.minY;
        r.vy *= -1;
      }
    }
  }
}

/**
 * Calculates squared distance from point (px, py) to line segment (ax, ay) -> (bx, by).
 * @returns {number} Distance squared
 */
export function distToSegmentSquared(px, py, ax, ay, bx, by) {
  const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
  if (l2 === 0) return (px - ax) ** 2 + (py - ay) ** 2;
  let t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2;
  t = Math.max(0, Math.min(1, t));
  return (px - (ax + t * (bx - ax))) ** 2 + (py - (ay + t * (by - ay))) ** 2;
}

/**
 * Finds the first point where a segment intersects a circle.
 * The returned t is normalized to [0, 1] along the segment.
 */
export function segmentCircleIntersection(x1, y1, x2, y2, cx, cy, radius) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const fx = x1 - cx;
  const fy = y1 - cy;
  const radiusSq = Math.max(0, radius) ** 2;
  const c = fx * fx + fy * fy - radiusSq;

  if (c <= 0) return { t: 0, x: x1, y: y1 };

  const a = dx * dx + dy * dy;
  if (a <= Number.EPSILON) return null;

  const b = 2 * (fx * dx + fy * dy);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;

  const root = Math.sqrt(discriminant);
  const t1 = (-b - root) / (2 * a);
  const t2 = (-b + root) / (2 * a);
  const t = t1 >= 0 ? t1 : t2;
  if (t < 0 || t > 1) return null;
  return { t, x: x1 + dx * t, y: y1 + dy * t };
}

/**
 * Finds the first point where a segment intersects an axis-aligned rectangle.
 * `pad` expands the rectangle for projectile-radius checks. The returned
 * normal points out of the rectangle at the entry face.
 */
export function segmentAabbIntersection(x1, y1, x2, y2, rect, pad = 0) {
  if (!rect) return null;
  const minX = rect.x - pad;
  const minY = rect.y - pad;
  const maxX = rect.x + rect.w + pad;
  const maxY = rect.y + rect.h + pad;
  const dx = x2 - x1;
  const dy = y2 - y1;
  let tEnter = 0;
  let tExit = 1;
  let nx = 0;
  let ny = 0;

  const testAxis = (start, delta, min, max, axis) => {
    if (Math.abs(delta) <= Number.EPSILON) {
      return start >= min && start <= max;
    }
    let near = (min - start) / delta;
    let far = (max - start) / delta;
    let nearNormal = delta > 0 ? -1 : 1;
    if (near > far) {
      [near, far] = [far, near];
    }
    if (near > tEnter) {
      tEnter = near;
      nx = axis === 'x' ? nearNormal : 0;
      ny = axis === 'y' ? nearNormal : 0;
    }
    tExit = Math.min(tExit, far);
    return tEnter <= tExit;
  };

  if (!testAxis(x1, dx, minX, maxX, 'x')) return null;
  if (!testAxis(y1, dy, minY, maxY, 'y')) return null;

  if (tEnter <= 0) {
    // The segment starts inside the expanded rectangle. Use the face the
    // segment exits through so ricochet normals remain stable.
    const candidates = [];
    if (dx > Number.EPSILON) candidates.push({ t: (maxX - x1) / dx, nx: 1, ny: 0 });
    if (dx < -Number.EPSILON) candidates.push({ t: (minX - x1) / dx, nx: -1, ny: 0 });
    if (dy > Number.EPSILON) candidates.push({ t: (maxY - y1) / dy, nx: 0, ny: 1 });
    if (dy < -Number.EPSILON) candidates.push({ t: (minY - y1) / dy, nx: 0, ny: -1 });
    const exit = candidates.sort((a, b) => a.t - b.t)[0];
    if (exit) {
      nx = exit.nx;
      ny = exit.ny;
    }
    return { t: 0, x: x1, y: y1, nx, ny };
  }

  return {
    t: tEnter,
    x: x1 + dx * tEnter,
    y: y1 + dy * tEnter,
    nx,
    ny,
  };
}

/**
 * Returns a safe number of substeps for a projectile moving `distance` pixels.
 * Keeping the step below the smallest collision diameter avoids endpoint-only
 * misses without changing the host-authoritative simulation contract.
 */
export function getProjectileSubsteps(distance, maxStep = 8) {
  if (!Number.isFinite(distance) || distance <= 0) return 1;
  return Math.max(1, Math.ceil(distance / Math.max(1, maxStep)));
}

/**
 * Wraps an angle to [-PI, PI] without frame-dependent branch drift.
 * @param {number} angle
 * @returns {number}
 */
export function normalizeAngle(angle) {
  let normalized = angle;
  while (normalized > Math.PI) normalized -= Math.PI * 2;
  while (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
}
