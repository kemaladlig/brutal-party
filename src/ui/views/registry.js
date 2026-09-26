// Görünüm kayıt defteri — shell'in tek kayıt noktası (AGENTS.md §3 registry deseni).
//
// Yeni ekran = bir dosya + `registerView()` satırı. `main.js` / `gamepad.js`
// içine ekran adına özel `if/else` zinciri eklemek yasaktır; shell yalnız
// buradaki kayıtları gezer. Aynı desen `engineRegistry.js` ve
// `gamepadSchemas.js` için de geçerlidir.

const views = new Map();
let rootId = 'home';

/**
 * @param {string} id  Görünüm kimliği (URL/geri tuşu bu id ile çalışır).
 * @param {object} view
 *   title     — üst şeritte gösterilen ekran adı.
 *   rail      — sol ray girdisi: { icon, label } | null (rayda görünmez).
 *   build(ctx) — DOM döndürür. ctx: { actions, t, onNavigate }
 *   onEnter / onExit — ekran görünürken / gizlenirken.
 *   focus     — true ise görünüm açılınca odak bu görünüme taşınır.
 */
export function registerView(id, view) {
  if (!id || typeof id !== 'string') return;
  if (views.has(id)) console.warn(`[views] "${id}" zaten kayıtlı — üzerine yazılıyor.`);
  views.set(id, { id, title: '', rail: null, onEnter: null, onExit: null, focus: true, ...view });
}

export function getView(id) {
  return views.get(id) || null;
}

export function hasView(id) {
  return views.has(id);
}

/**
 * Rayda görünecek görünümler. Sıra `rail.order` ile belirlenir (yoksa kayıt
 * sırası): üst şeritte HER ZAMAN üç kalıcı hedef durur — ANASAYFA / OYUN /
 * KARAKTER. Geri düğmesi yerine bu gezinme kullanılır; `rail: null` olan
 * görünümler (oda, lobi) eylem sonucu açılan ara adımlardır.
 */
export function listRailViews() {
  return [...views.values()]
    .filter((v) => v.rail)
    .sort((a, b) => (a.rail.order ?? 99) - (b.rail.order ?? 99));
}

export function setRootView(id) {
  if (views.has(id)) rootId = id;
}

export function getRootViewId() {
  return rootId;
}
