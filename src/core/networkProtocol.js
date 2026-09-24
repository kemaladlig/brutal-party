// Shared network input contract for the local WebSocket relay and Supabase relay.
// Keep validation here so ONLINE and TV_CONSOLE cannot drift apart.

const finiteNum = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Validate an input packet before it reaches an authoritative host.
 * This is transport-independent: the same contract is used by the local WS
 * server and the Supabase/WebRTC relay.
 */
export function isValidNetworkInput(data) {
  if (!data || typeof data.action !== 'string') return false;

  switch (data.action) {
    case 'JOYSTICK_MOVE':
      return finiteNum(data.dx) && finiteNum(data.dy)
        && Math.abs(data.dx) <= 1.05 && Math.abs(data.dy) <= 1.05
        && finiteNum(data.angle) && finiteNum(data.force)
        && data.force >= 0 && data.force <= 1.05;

    case 'PADDLE_MOVE':
      return finiteNum(data.position) && data.position >= -0.05 && data.position <= 1.05;

    case 'CURVE_STEER':
    case 'SNAKE_STEER':
      return data.dir === -1 || data.dir === 0 || data.dir === 1;

    case 'SNAKE_DIR':
      return finiteNum(data.angle)
        || (finiteNum(data.dx) && finiteNum(data.dy));

    case 'TANK_DRIVE':
      return typeof data.driving === 'boolean';

    case 'TANK_FIRE':
    case 'DASH':
    case 'TACKLE':
    case 'SPIN':
    case 'SNAKE_BOOST':
    case 'SNAKE_BOOST_RELEASE':
    case 'ARCHER_CHARGE':
    case 'ARCHER_CHARGE_END':
    case 'LASER_AIM':
    case 'LASER_FIRE':
    case 'LASER_FIRE_RELEASE':
    case 'NINJA_SMOKE':
      return true;

    case 'SET_NAME':
      return typeof data.name === 'string' && data.name.trim().length > 0;

    case 'SWITCH_SLOT':
      return Number.isInteger(data.targetSlot)
        && data.targetSlot >= 0 && data.targetSlot <= 3;

    case 'AVATAR_UPDATE':
      // Deep sanitization remains the host's responsibility.
      return data.avatar && typeof data.avatar === 'object';

    default:
      return false;
  }
}
