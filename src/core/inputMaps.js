// Tek kayıt: 4 slot klavye eşlemesi (P1 WASD+Space, P2 Oklar+Enter,
// P3 IJKL+O, P4 TFGH+B). Motorlar kendi tuş kopyasını tutmaz;
// sadece getSlotKeys(i) üzerinden okur. İkincil eylemler (smoke/dash)
// motor-özel kalır — SECOND_ACTION_KEYS tek kayıt.

export const STANDARD_KEY_SLOTS = [
  { u: 'KeyW', d: 'KeyS', l: 'KeyA', r: 'KeyD', action: 'Space' },
  { u: 'ArrowUp', d: 'ArrowDown', l: 'ArrowLeft', r: 'ArrowRight', action: 'Enter' },
  { u: 'KeyI', d: 'KeyK', l: 'KeyJ', r: 'KeyL', action: 'KeyO' },
  { u: 'KeyT', d: 'KeyG', l: 'KeyF', r: 'KeyH', action: 'KeyB' },
];

// Motor-özel ikinci eylem tuşları (dizi: slot0..slot3)
export const SECOND_ACTION_KEYS = {
  smoke: ['KeyE', 'ShiftRight', 'KeyU', 'KeyV'],
  dash: ['ShiftLeft', 'ShiftRight', 'KeyU', 'KeyR'],
};

export const KEY_LABELS = {
  action: ['SPACE', 'ENTER', 'O', 'B'],
  smoke: ['E', 'R-SHIFT', 'U', 'V'],
  dash: ['L-SHIFT', 'R-SHIFT', 'U', 'R'],
};

// `KeyboardEvent.code` → insan okunur tuş kapağı. Referans metinlerinde ham
// kod ("ArrowLeft", "KeyI") görünüyordu; oyuncu tuş kapağını tanımaz, harfi
// tanır. Bu eşleme `inputMaps`'in kendi kaynağıdır (motorlar/UI kopyalamaz).
const KEY_CAP_LABELS = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ShiftLeft: 'L-SHIFT',
  ShiftRight: 'R-SHIFT',
  ControlLeft: 'L-CTRL',
  ControlRight: 'R-CTRL',
  AltLeft: 'L-ALT',
  AltRight: 'R-ALT',
  Numpad0: 'NUM 0',
  Escape: 'ESC',
  Enter: 'ENTER',
  Space: 'SPACE',
  Tab: 'TAB',
  Backspace: 'BACKSPACE',
};

/** `code` → tuş kapağı etiketi (`KeyI` → `I`, `ArrowLeft` → `←`). */
export function getKeyCapLabel(code) {
  if (!code) return '';
  if (KEY_CAP_LABELS[code]) return KEY_CAP_LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `NUM ${code.slice(6)}`;
  return code;
}

export function getKeyLabel(kind, index) {
  const list = KEY_LABELS[kind];
  return list ? list[index] : '';
}

// Aksiyon alias süper-kümesi (BaseGame bindStandardKeyboard yolu):
// P1 Space|KeyE|ShiftLeft|e · P2 Enter|Numpad0|ControlRight · P3 KeyO|o · P4 KeyB|b
const ACTION_ALIASES = [
  ['Space', 'KeyE', 'ShiftLeft', 'e', 'E'],
  ['Enter', 'Numpad0', 'ControlRight'],
  ['KeyO', 'o', 'O'],
  ['KeyB', 'b', 'B'],
];

export function getSlotKeys(index) {
  return STANDARD_KEY_SLOTS[index] || null;
}

export function getSecondActionKey(kind, index) {
  const list = SECOND_ACTION_KEYS[kind];
  return list ? list[index] : undefined;
}

// code → aksiyon yapan slot (Space→0, Enter→1, KeyO→2, KeyB→3); değilse -1
export function slotForActionCode(code) {
  for (let i = 0; i < STANDARD_KEY_SLOTS.length; i++) {
    if (STANDARD_KEY_SLOTS[i].action === code) return i;
  }
  return -1;
}

// BaseGame.isPlayerActionKey karşılığı (alias süper-kümesi korunur)
export function isSlotActionEvent(e, slotIndex) {
  const aliases = ACTION_ALIASES[slotIndex];
  if (!aliases) return false;
  return aliases.includes(e.code) || aliases.includes(e.key);
}

// code → slot ters harita (keyup yan etkileri: curve/snake/tanks)
// fields: hangi alanlar haritaya girsin (varsayılan: u,d,l,r,action)
export function buildCodeToSlotMap(fields = ['u', 'd', 'l', 'r', 'action']) {
  const map = {};
  STANDARD_KEY_SLOTS.forEach((slot, i) => {
    for (const f of fields) {
      const code = slot[f];
      if (code) map[code] = i;
    }
  });
  return map;
}

// code'un harf karşılığı (KeyW → w): BaseGame/bomb tarzı keys[] kontrolü için
function letterOf(code) {
  return code && code.startsWith('Key') ? code.slice(3).toLowerCase() : null;
}

// BaseGame.getPlayerKeyboardVector gövdesi: code + harf (keys['w']) kontrolü
export function keyboardVectorFrom(keys, slotIndex) {
  let x = 0;
  let y = 0;
  const m = getSlotKeys(slotIndex);
  if (!m) return { x, y };
  const on = (code) => {
    if (keys[code]) return true;
    const letter = letterOf(code);
    return !!(letter && keys[letter]);
  };
  if (on(m.l)) x -= 1;
  if (on(m.r)) x += 1;
  if (on(m.u)) y -= 1;
  if (on(m.d)) y += 1;
  return { x, y };
}

// Motor keyboardInput gövdesi (sadece e.code depolayan keys[] için)
export function readSlotKeys(keys, index) {
  const m = getSlotKeys(index);
  if (!m) return { dx: 0, dy: 0, action: false };
  return {
    dx: (keys[m.r] ? 1 : 0) - (keys[m.l] ? 1 : 0),
    dy: (keys[m.d] ? 1 : 0) - (keys[m.u] ? 1 : 0),
    action: !!keys[m.action],
  };
}
