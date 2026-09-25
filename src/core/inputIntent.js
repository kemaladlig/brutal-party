// Canonical input intent projection. Transport packets keep their original
// `action` for engine compatibility, while engines and future adapters can
// consume the stable `intent` field.

function actionIntent(descriptor, action) {
  const match = descriptor?.network?.actions?.find((candidate) => (
    candidate.transportActions || []
  ).includes(action));
  if (!match) return null;
  const phase = /RELEASE|END/.test(action) ? 'release' : 'press';
  return { type: 'action', id: match.id, phase };
}

export function normalizeInputIntent(data, descriptor = null, source = 'network') {
  if (!data || typeof data.action !== 'string') return data;

  let intent;
  switch (data.action) {
    case 'JOYSTICK_MOVE':
    case 'MOVE':
      intent = {
        type: 'move',
        control: 'joystick',
        dx: Number(data.dx) || 0,
        dy: Number(data.dy) || 0,
        angle: Number(data.angle) || 0,
        force: Number(data.force) || 0,
      };
      break;
    case 'PADDLE_MOVE':
      intent = { type: 'position', control: 'slider', position: Number(data.position) || 0 };
      break;
    case 'CURVE_STEER':
    case 'SNAKE_STEER':
      intent = { type: 'steer', control: 'steer', value: Number(data.dir) || 0 };
      break;
    case 'SNAKE_DIR': {
      const angle = Number(data.angle);
      intent = {
        type: 'direction',
        control: 'joystick',
        angle: Number.isFinite(angle) ? angle : null,
        dx: Number(data.dx) || 0,
        dy: Number(data.dy) || 0,
      };
      break;
    }
    case 'TANK_DRIVE':
      intent = { type: 'drive', control: 'pedal', value: data.driving === true };
      break;
    default:
      intent = actionIntent(descriptor, data.action) || {
        type: 'action',
        id: data.action.toLowerCase(),
        phase: 'press',
      };
      break;
  }

  return { ...data, intent: { ...intent, source } };
}

export function isInputIntent(data, type, id = null, phase = null) {
  const intent = data?.intent;
  if (!intent || intent.type !== type) return false;
  if (id !== null && intent.id !== id) return false;
  if (phase !== null && intent.phase !== phase) return false;
  return true;
}

export function matchesInputAction(data, id, fallbackAction, phase = null) {
  if (data?.intent) return isInputIntent(data, 'action', id, phase);
  return data?.action === fallbackAction;
}

export function getInputIntent(data) {
  return data?.intent || null;
}
