// Routes normalized local/network input to the active authoritative engine.
// Transport adapters stay unaware of engine instances and mode orchestration.

import { normalizeInputIntent } from './inputIntent.js';

export class InputIntentRouter {
  constructor({ getDescriptor, getEngine } = {}) {
    this.getDescriptor = getDescriptor;
    this.getEngine = getEngine;
  }

  normalize(data, source = 'network') {
    return normalizeInputIntent(data, this.getDescriptor?.(), source);
  }

  dispatch(slotIndex, data, source = 'network') {
    const engine = this.getEngine?.();
    if (!engine || typeof engine.handleRemoteInput !== 'function') return false;
    engine.handleRemoteInput(slotIndex, this.normalize(data, source));
    return true;
  }
}
