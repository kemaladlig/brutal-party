// Small, deterministic input-source arbiter shared by BaseGame and tests.

export function claimInputSource(current, source, { allowAlongside = false } = {}) {
  // Some tabletop controls intentionally combine sources on the same device:
  // WASD movement + a touch aim stick. `allowAlongside` accepts the second
  // source without changing the primary source owner.
  if (allowAlongside) return { accepted: true, current };
  const accepted = !(current && current !== source);
  return {
    accepted,
    current: accepted ? source : current,
  };
}

export function releaseInputSource(current, source = null) {
  if (!source || current === source) return null;
  return current;
}
