// Small, deterministic input-source arbiter shared by BaseGame and tests.

export function claimInputSource(current, source) {
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
