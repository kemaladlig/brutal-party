// Shared auto-aim target picker for quick-tap fire on the authoritative host.
// Pure geometry: the engine owns which candidates exist and the range budget.

import { normalizeAngle } from './physics2d.js';

export function angleToTarget(from, target) {
  return normalizeAngle(Math.atan2(target.y - from.y, target.x - from.x));
}

export function findAutoAimTarget(from, candidates, { maxRange = Infinity, valid = null } = {}) {
  let best = null;
  let bestD2 = maxRange * maxRange;
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (valid && !valid(candidate)) continue;
    const dx = candidate.x - from.x;
    const dy = candidate.y - from.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = candidate;
    }
  }
  return best ? { target: best, angle: angleToTarget(from, best) } : null;
}
