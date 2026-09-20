// Engine Registry: yeni oyun eklemek için tek kayıt noktası.
//
// Bir motoru kaydetmek yeterli — main.js'teki tüm zincirler (lookup, resize,
// reset, broadcast paketi, oyun döngüsü, menü kartları) bu haritadan okunur.
// Yeni oyun eklerken main.js'e zincir eklenmez, sadece 1 registerEngine çağrısı.
//
// Entry sözleşmesi:
//   game    — motor instance'ı (BaseMiniGame türevi)
//   reset() — moda girerken/maç sıfırlarken çağrılır (mevcut reset* metotları)
//   onEnter(now) / onResume(now) — lastTime düzeltmeleri (fizik sıçramasını önler)
//   start() — sayaç sonrası çalıştırma (mevcut start davranışı birebir korunur)
//   packet() — host state paketi için oyuna özel alanlar { scores, ... }

export const GAME_ORDER = ['PONG', 'TANKS', 'CURVE', 'BOMB', 'HEIST', 'DUEL', 'CROWN', 'ZONE', 'SNAKE', 'LASER', 'CLONE'];

const registry = {};

export function registerEngine(mode, entry) {
  registry[mode] = entry;
}

export function getEngine(mode) {
  return registry[mode] || null;
}

export function getEngineGame(mode) {
  return registry[mode]?.game || null;
}

export function forEachEngine(cb) {
  for (const mode of GAME_ORDER) {
    if (registry[mode]) cb(mode, registry[mode]);
  }
}
