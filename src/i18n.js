// Brutal Party — i18n (TR/EN).
// Tek sözlük, iki dil: UI metinleri anahtar üzerinden okunur (t('pause.resume')).
// - Dil tercihi safeStorage'da saklanır (varsayılan 'tr').
// - TR her zaman eksiksizdir; EN'de eksik anahtar TR'ye düşer + console uyarısı
//   verir (boş buton asla çizilmez).
// - Statik HTML: data-i18n="anahtar" + applyI18nToDOM() (yalnızca yapraksız
//   metin öğelerinde kullanın — textContent yazar).
// - Dinamik etiketler (pause toggle vb.) dile abone olur: onLangChange().
import { safeGet, safeSet } from './core/safeStorage.js';
import { getTabletopIconSvg } from './core/tabletopIcons.js';

export const LANGS = ['tr', 'en'];
const LANG_KEY = 'brutalparty.lang';

let lang = safeGet(LANG_KEY) === 'en' ? 'en' : 'tr';
const listeners = new Set();

export function getLang() {
  return lang;
}

export function setLang(next) {
  if (next !== 'tr' && next !== 'en') return;
  if (next === lang) return;
  lang = next;
  safeSet(LANG_KEY, next);
  applyI18nToDOM();
  // Anlık kopya üzerinden dağıt: `Set.forEach` dağıtım sırasında eklenen
  // girdileri de gezdiği için, dinleyicisi içinde yeniden abone olan biri
  // (örn. kendini rebuild eden bir görünüm) tek `setLang` çağrısını sonsuz
  // döngüye sokup sekmeyi kilitliyordu. Yeni eklenenler bir sonraki
  // değişimde çalışır.
  [...listeners].forEach((fn) => {
    try { fn(lang); } catch {}
  });
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

import { TR } from './locales/tr.js';
import { EN } from './locales/en.js';

export const STRINGS = { tr: TR, en: EN };

// Basit {0} interpolasyonu: t('toast.swapped', a, b)
// `{icon:ad}` token'ı canvas tüketicilerinden temizlenir (fillText SVG
// çizemez); DOM tüketicileri tIcon() ile ikonu vektör span'a çevirir.
const ICON_TOKEN_RE = /\{icon:([a-z0-9_]+)\}/g;

export function t(key, ...args) {
  const dict = STRINGS[lang] || TR;
  let v = dict[key];
  if (v == null && lang !== 'tr') {
    v = TR[key];
    if (v != null) console.warn(`[i18n] missing EN key, TR fallback: ${key}`);
  }
  if (v == null) {
    console.warn(`[i18n] missing key: ${key}`);
    return key;
  }
  if (args.length > 0) {
    v = String(v).replace(/\{(\d+)\}/g, (_, i) => (args[Number(i)] ?? ''));
  }
  return v.replace(ICON_TOKEN_RE, '').trim();
}

// DOM etiketi: t() + {icon:ad} token'ını inline SVG ile değiştirir.
// (AGENTS.md §7: DOM UI'a ham OS emojisi yok; ikonlar tabletopIcons'tan.)
export function tIcon(key, ...args) {
  const dict = STRINGS[lang] || TR;
  let v = dict[key];
  if (v == null && lang !== 'tr') {
    v = TR[key];
    if (v != null) console.warn(`[i18n] missing EN key, TR fallback: ${key}`);
  }
  if (v == null) return key;
  if (args.length > 0) {
    v = String(v).replace(/\{(\d+)\}/g, (_, i) => (args[Number(i)] ?? ''));
  }
  return v.replace(ICON_TOKEN_RE, (_, icon) => getTabletopIconSvg(icon, { size: 14 }));
}

export function applyI18nToDOM(root) {
  try {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    scope.querySelectorAll('[data-i18n-ph]').forEach((el) => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
    });
    scope.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
      if (el.hasAttribute('title')) el.setAttribute('title', t(el.getAttribute('data-i18n-aria')));
    });
  } catch {}
}
