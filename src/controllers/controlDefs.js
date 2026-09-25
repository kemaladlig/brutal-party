// Merkezi Kontrol Tanımları — tek kontrol gerçeği.
//
// Telefon kumandası (`gamepadSchemas.js`) ve masa-ortası canvas
// (`BaseGame.getTabletopSchema()`) aynı yapıyı tarif eder:
//   sol: 'joystick' | 'steer' | 'slider' | 'pedal'
//   sağ: en fazla 2 discrete aksiyon
//
// Etiket/renk/cooldown gibi sunum detayları burada tutulmaz —
// onlar `gamepadSchemas.js` (i18n) ve motor şemalarındadır.
// Bu dosya yalnız yapısal sözleşmeyi + yön politikasını verir.

export const MAX_TABLETOP_ACTIONS = 2;

export const CONTROL_DEFS = {
  PONG: { left: 'slider', right: ['spin'] },
  TANKS: { left: 'pedal', right: ['fire'] },
  CURVE: { left: 'steer', right: [] },
  BOMB: { left: 'joystick', right: ['dash'] },
  HEIST: { left: 'joystick', right: ['tackle'] },
  ARCHER: { left: 'joystick', right: ['charge'] },
  CROWN: { left: 'joystick', right: ['tackle'] },
  ZONE: { left: 'joystick', right: ['dash'] },
  SNAKE: { left: 'steer', right: ['boost'] },
  LASER: { left: 'joystick', right: ['fire', 'dash'] },
  CLONE: { left: 'joystick', right: ['tackle'] },
  COLLAPSE: { left: 'joystick', right: ['jump'] },
  NINJA: { left: 'joystick', right: ['strike', 'smoke'] },
  HORDE: { left: 'joystick', right: ['fire', 'dash'] },
  RACE: { left: 'joystick', right: ['dash'] },
};

// Oyun her zaman yatay oynanır; lobi portrait kalabilir.
export const LANDSCAPE_FIRST_MODES = new Set(Object.keys(CONTROL_DEFS));

export function getControlDef(mode) {
  return CONTROL_DEFS[mode] || null;
}

// Merkezi tabletop yerleşimi: YÜZEY FARKINA DİKKAT — telefon ile masa-ortası
// birebir aynı değildir (PONG telefonda slider, masada steer; TANKS telefonda
// pedal, masada joystick). Bu harita masa-ortası gerçeğini verir.
// Motorlar oyuna özgü detayları (ikon/cooldown) kendi şemasında tutar;
// yapı (sol tip + sağ max 2) burayla parite denetiminden geçer.
const TABLETOP_LEFT = {
  PONG: 'steer',
  TANKS: 'joystick',
  CURVE: 'steer',
  BOMB: 'joystick',
  HEIST: 'joystick',
  ARCHER: 'joystick',
  CROWN: 'joystick',
  ZONE: 'joystick',
  SNAKE: 'steer',
  LASER: 'joystick',
  CLONE: 'joystick',
  COLLAPSE: 'joystick',
  NINJA: 'joystick',
  HORDE: 'joystick',
  RACE: 'joystick',
};

export function getTabletopLayout(mode) {
  const def = getControlDef(mode);
  if (!def) return null;
  const left = TABLETOP_LEFT[mode] || 'joystick';
  if (left === 'steer') return { steer: true, actions: def.right.map((id) => ({ id })) };
  return { joystick: true, actions: def.right.map((id) => ({ id })) };
}

export function validateControlDef(mode, schema) {
  const actions = schema?.actions || [];
  if (actions.length > MAX_TABLETOP_ACTIONS) {
    console.warn(`[controlDefs] ${mode}: sağ aksiyon ${actions.length} > ${MAX_TABLETOP_ACTIONS}`);
    return false;
  }
  return true;
}

// Sekme kapanışı / mount sökümünde host'ta latch kalmasın diye gönderilen
// nötr paket: sol kontrole göre tek kaynaktan. PONG slider latch tutmaz → null.
const NEUTRAL_INPUTS = {
  TANKS: { action: 'TANK_DRIVE', driving: false },
  CURVE: { action: 'CURVE_STEER', dir: 0 },
  SNAKE: { action: 'SNAKE_STEER', dir: 0 },
};

export function getNeutralInput(mode) {
  if (mode === 'PONG') return null;
  if (NEUTRAL_INPUTS[mode]) return { ...NEUTRAL_INPUTS[mode] };
  if (getControlDef(mode)) return { action: 'JOYSTICK_MOVE', dx: 0, dy: 0, angle: 0, force: 0 };
  return null;
}
