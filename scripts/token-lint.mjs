// Token lint — ham renk literali sızıntısını ve tanımsız var() referansını
// mekanik olarak yakalar.
//
// Rebrand (Brawl diline geçiş) sırasında palet `src/styles/tokens.css` +
// `src/ui/tokens.js` çiftinde yaşıyor. 762 ham hex'i gözle bulup değiştirmek
// kırılgan; bu betik iki kuralı test edilebilir hale getirir (AGENTS.md'de de
// yazılı):
//
//   1. Ham hex sızıntısı — src/ altındaki .css'lerde, tokens.css hariç.
//      İzinli: alpha maskesi ve saf siyah gölge için #000 / #000000.
//   2. Tanımsız var(--x) — tanımı olmayan referans bildirimi sessizce
//      geçersizleştirir; ekranda kırık özellik olarak görünür. Bu kontrol
//      sweep sonrası en pahalı hata sınıfını yakalıyor (bkz. --radius-brutal).
//
// Geçerli sayılan var() referansları:
//   - tokens.css'te tanımlı token
//   - herhangi bir .css'te yerel `--x:` olarak tanımlı (bileşen kapsamı)
//   - fallback'li: var(--x, <yedek>)
//   - JS'ten setProperty ile runtime atanan (kontrol düzeni, şema ölçüleri)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const DICTIONARY = join('src', 'styles', 'tokens.css');

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
// `rgb()`/`rgba()`/`hsl()` de ham renk literalidir; yalnız `transparent`,
// `currentColor` ve saydam siyah (maske/gölge) istisnadır.
const FUNC_COLOR = /\b(?:rgba?|hsla?)\(/g;
// İsimlendirilmiş renk anahtar kelimeleri de ham renktir: `color: black`
// yazmak, sözlüğü atlamakla aynı şeydir ve koyu temada görünmez metin
// üretir (butonların UA `buttontext` siyahı bu sınıftan bir örnekti).
const NAMED = /:\s*(?:black|white|red|green|blue|gray|grey|silver|maroon|purple|fuchsia|olive|lime|aqua|teal|navy|orange|pink|brown|gold|beige|ivory|crimson|indigo|violet)\s*(?=[;!])/g;
const ALLOW = new Set(['#000', '#000000']);
const FUNC_ALLOW = [/^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0(?:\.\d+)?\s*\)$/i];
const DECL = /(--[a-z0-9-]+)\s*:/gi;
const SET_PROPERTY = /setProperty\(\s*['"](--[a-z0-9-]+)['"]/g;
const VAR = /var\(\s*(--[a-z0-9-]+)\s*(,[^)]*)?\)/g;

function walk(dir, ext, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, ext, out);
    else if (entry.endsWith(ext)) out.push(full);
  }
  return out;
}

const cssFiles = walk(SRC, '.css');
const jsFiles = walk(SRC, '.js');

// Sözlük + yerel tanımlar birleşik "bilinen token" kümesi.
const known = new Set(
  [...readFileSync(join(ROOT, DICTIONARY), 'utf8').matchAll(DECL)].map((m) => m[1]),
);
for (const file of cssFiles) {
  for (const m of readFileSync(file, 'utf8').matchAll(DECL)) known.add(m[1]);
}
// Runtime atananlar (controllerLayout, gamepadSchemas...) yalnız JS'te görünür.
for (const file of jsFiles) {
  for (const m of readFileSync(file, 'utf8').matchAll(SET_PROPERTY)) known.add(m[1]);
}

const violations = [];
const undefinedRefs = [];

for (const file of cssFiles) {
  if (file.endsWith(DICTIONARY)) continue;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const match of line.match(HEX) || []) {
      if (ALLOW.has(match.toLowerCase())) continue;
      violations.push(`${relative(ROOT, file).replace(/\\/g, '/')}:${i + 1}  ${match}  ${line.trim()}`);
    }
    for (const m of line.matchAll(FUNC_COLOR)) {
      // Çağrının tamamını al: kapanış parantezi olmadan argümanları temizlemek gerekir.
      const start = m.index;
      const raw = line.slice(start, line.indexOf(')', start) + 1);
      if (FUNC_ALLOW.some((re) => re.test(raw))) continue;
      violations.push(`${relative(ROOT, file).replace(/\\/g, '/')}:${i + 1}  ${raw}  ${line.trim()}`);
    }
    for (const m of line.matchAll(NAMED)) {
      violations.push(`${relative(ROOT, file).replace(/\\/g, '/')}:${i + 1}  ${m[1]}  ${line.trim()}`);
    }
    // `String.match` /g capture grubu değil tam eşleşme döndürür; var() için matchAll.
    for (const m of line.matchAll(VAR)) {
      if (m[2]) continue;               // fallback'li — tanım şart değil
      if (known.has(m[1])) continue;
      undefinedRefs.push(`${relative(ROOT, file).replace(/\\/g, '/')}:${i + 1}  ${m[1]}  ${line.trim()}`);
    }
  });
}

if (violations.length) {
  console.error(`Token lint: ${violations.length} ham renk literal(i) — hepsi ${DICTIONARY} sözlüğüne taşınmalı:\n`);
  console.error(violations.join('\n'));
}

if (undefinedRefs.length) {
  const unique = new Map();
  for (const line of undefinedRefs) {
    const name = line.trim().split(/\s+/)[1];
    if (!unique.has(name)) unique.set(name, line);
  }
  console.error(`Token lint: ${undefinedRefs.length} tanımsız var() referansı (${unique.size} farklı):\n`);
  console.error([...unique.values()].join('\n'));
}

if (violations.length || undefinedRefs.length) process.exit(1);

console.log(`Token lint: temiz — ham literal yok, ${known.size} token biliniyor, tüm var() referansları çözülüyor.`);
