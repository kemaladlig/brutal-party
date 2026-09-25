// Central device haptic gate. Game engines and the phone controller all use
// this helper so the persisted preference applies consistently.

import { getPreference } from './preferences.js';

export function vibrate(pattern) {
  if (!getPreference('hapticsEnabled')) return false;
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
      return true;
    }
  } catch {}
  return false;
}
