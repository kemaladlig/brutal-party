import { playFireBlocked } from '../audio.js';
import { vibrate } from './haptics.js';
import { markFireBlocked, markFireShot } from './fireFeedback.js';

export function notifyFireBlocked(player, now) {
  if (!markFireBlocked(player, now)) return false;
  playFireBlocked();
  vibrate(8);
  return true;
}

export function notifyFireShot(player, now) {
  return markFireShot(player, now);
}
