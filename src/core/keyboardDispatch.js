// Tek paylaşılan klavye dispatch'i (Faz 2.2). 11 motorun `initKeyboard`
// gövdesindeki `window.addEventListener` çiftleri ve BaseGame'in capture
// guard'ı buraya indi: uygulama genelinde üç dinleyici vardır, motor başına
// yenisi eklenmez ve motor tahliyesinde abonelik tek satırla bırakılır.
//
// Üç rol ayrıdır, çünkü semantik farklıdır:
//   capture → girdi kaynağı guard'ı. Dokunmatik aktifken gerçek olayda
//             `stopImmediatePropagation` çağırır; bu hem paylaşılan bubble
//             dinleyicisini hem de altındaki UI dinleyicilerini keser —
//             eski davranışın birebir kendisi.
//   down/up → motorun kendi keydown/keyup mantığı, kayıt sırasıyla.
//
// Her rol kendi set'inde hedef bazında tekilleşir: aynı motor ikinci kez
// bağlansa yeni işlev yaratılmaz (sözleşme "bir kez bağla" idi).
//
// Motor sözleşmesi aynı: `initKeyboard()` gövdesi kendi mantığını
// `bindKeyboard(this, { keydown, keyup })` ile verir. Klavye eşlemesi, alias
// süper-kümesi ve tuş kapağı etiketleri `inputMaps`'in kaynağıdır.

const captureHandlers = new Set();
const downHandlers = new Set();
const upHandlers = new Set();
let bound = false;

/** false dönerse olay normal aşamaya inmez. */
function run(handlers, event) {
  // Kopyası: abone, sırasında listeden çıksa bile döngü bozulmaz.
  for (const entry of [...handlers]) {
    if (entry.handler(event) === false) return false;
  }
  return true;
}

function register(set, target, handler) {
  for (const entry of set) {
    if (entry.target === target) return false;
  }
  set.add({ target, handler });
  return true;
}

function ensureBound() {
  if (bound) return;
  bound = true;
  window.addEventListener('keydown', (e) => {
    if (run(captureHandlers, e) === false) e.__brutalKeyboardBlocked = true;
  }, true);
  window.addEventListener('keydown', (e) => {
    if (e.__brutalKeyboardBlocked) return;
    run(downHandlers, e);
  });
  window.addEventListener('keyup', (e) => run(upHandlers, e));
}

/**
 * Motor klavye dinleyicisini paylaşılan dispatch'e bağlar.
 * `keydown` verilmezse yalnız keyup, tersi de geçerlidir.
 */
export function bindKeyboard(target, { keydown = null, keyup = null } = {}) {
  if (keydown) register(downHandlers, target, keydown);
  if (keyup) register(upHandlers, target, keyup);
  ensureBound();
}

/** Girdi kaynağı guard'ı: dokunmatik aktifken klavye içeriğini keser. */
export function bindKeyboardCapture(target, handler) {
  register(captureHandlers, target, handler);
  ensureBound();
}

/** Motorun klavye aboneliğini kaldırır (motor tahliyesinde çağrılır). */
export function unbindKeyboard(target) {
  let removed = 0;
  for (const set of [captureHandlers, downHandlers, upHandlers]) {
    for (const entry of [...set]) {
      if (entry.target === target) {
        set.delete(entry);
        removed++;
      }
    }
  }
  return removed;
}

/** Abone sayısı — teşhis ve testler için. */
export function keyboardSubscriberCount() {
  return downHandlers.size + upHandlers.size;
}
