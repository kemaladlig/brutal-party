// Pure slot movement rules shared by the host lobby, phone lobby, and the
// authoritative host gate. The transport still performs its own final check;
// this module only keeps the UI and host orchestration from drifting apart.

export const SLOT_COUNT = 4;

export function isValidSlotIndex(index) {
  return Number.isInteger(index) && index >= 0 && index < SLOT_COUNT;
}

export function isBotSlot(slot) {
  return slot?.kind === 'bot'
    || slot?.kind === 'bot_normal'
    || slot?.kind === 'bot_god'
    || slot?.isBot === true;
}

/**
 * Return a stable reason code when a seat move is not allowed.
 * Empty target seats are valid; an empty source is not a move.
 */
export function getSlotSwapError({
  from,
  to,
  slots = [],
  reservedHostSlot = null,
  locked = false,
  remote = false,
  requireSource = true,
} = {}) {
  if (!isValidSlotIndex(from) || !isValidSlotIndex(to)) return 'range';
  if (from === to) return 'same';
  if (locked) return 'locked';
  if (requireSource && !slots[from]) return 'source';
  if (isBotSlot(slots[from]) || isBotSlot(slots[to])) return 'bot';
  if (remote && (
    (isValidSlotIndex(reservedHostSlot) && to === reservedHostSlot)
    || slots[to]?.isHost === true
  )) return 'host';
  return null;
}

export function canSwapSlots(options = {}) {
  return getSlotSwapError(options) === null;
}
