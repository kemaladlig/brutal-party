// rules-lint — AGENTS.md yasaklarının makine bekçisi (token-lint ile aynı iskelet).
// Her kural AGENTS.md § numarası taşır; ihlal `dosya:satır [Kx §n] mesaj` olarak
// basılır ve exit 1 verir. MEVCUT borç scripts/rules-lint-baseline.json'da
// dosya+kural bazında sayı olarak dondurulur: yeni ihlal = sayının aşılması.
// Tabanı bilinçli düşürmek için: node scripts/rules-lint.mjs --update
//
//   K1 §3  main.js/gamepad.js içinde `mode ===` dalı (mod özel mount yasak).
//   K2 §8  src/**/*.js içinde ham renk literali (tokens.js sözlük istisnası).
//   K3 §4  oyun yüzeyinde `canvas.width/height` ATAMASI (DPR main.js'in;
//          windowChrome istisna). Offscreen bake'ler mevcut borçta donduruk.
//   K4 §3  engineRegistry CARTRIDGES: her kayıt zorunlu metot setine sahip mi.
//   K5 §8  reactions.js dışında ham OS emojisi (§8 tek istisna tepki yüzeyi).
//   K6 §10 GAME_ORDER'daki her oyun docs/PROJECT_MAP.md satırında geçiyor mu.
//   K7 §4  src/games/** içinde ham partikül üretimi/çizimi yasak (ortak çizici
//          worldCore.js hariç): `particles.push(` ve partikül döngüsünden
//          sonraki 12 satır içinde `ctx.arc(`. Motorlar FX'i yalnız fxRuntime
//          üzerinden üretir, çizerken worldCore/drawFx katmanını kullanır.
//
// Kural notu: @ts-ignore/baseline kaçışı yasak değildir ama her taban düşüşü
// geri dönüşü olmayan bir kayıt değildir — dosya silinse de sayı kalır.

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const BASELINE_FILE = join(ROOT, 'scripts', 'rules-lint-baseline.json');
const UPDATE = process.argv.includes('--update');

const walk = (dir, ext, out = []) => {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, ext, out);
    else if (e.endsWith(ext)) out.push(full);
  }
  return out;
};
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');

// ---------------------------------------------------------------------------
// Kural tanımları: fn(file, source) -> [{line, msg}]
// ---------------------------------------------------------------------------

const K1_FILES = ['src/main.js', 'src/gamepad.js'];
const K1_RE = /\b(?:currentMode|roomFlow\.getCurrentMode\(\)|getActiveGameMode\(\)|\bmode\b)\s*===\s*'[A-Z][A-Z_]*'/g;

const HEX_RE = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?!\/)|\b(?:rgba?|hsla?)\(\s*\d+\s*,\s*\d+\s*,\s*\d+/g;
const K2_EXEMPT = new Set(['src/ui/tokens.js', 'src/styles/tokens.css']);
// Motor paletleri AGENTS.md §8'in sözlük dışı tek meşru alanıdır: saha içi
// renkler token'a değil motorun kendi renk uyumuna bağlıdır. Borç baseline'da.
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => `${p1}${m.replace(/\/\/[^\n]*/, (c) => ' '.repeat(c.length))}`);

const K3_EXEMPT = new Set(['src/main.js', 'src/ui/windowChrome.js']);
const K3_RE = /\b(?:\w*[cC]anvas\w*|canvas)\s*\.\s*(?:width|height)\s*=(?!=)/g;

const K5_EXEMPT = new Set(['src/core/reactions.js']);
// OS emoji blokları — box drawing/math/oklar (§8 yasağı kapsamı dışı) hariç.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F000}-\u{1F0FF}\u{1F900}-\u{1F9FF}]/u;

// CARTRIDGES kayıtlarının zorunlu alanları (makeEngine/reset/start/packet'i
// sarmalar; motor sözleşmesi §3 motorda, kural burada yalnız kayıt bütünlüğü).
// `hudTag` çıktı: telefon durum şeridi skor/etiket taşımıyor (tek skor yüzeyi
// taç peek'i), tüketici kalmadı.
const REQUIRED_CARTRIDGE_METHODS = ['id', 'title', 'color', 'schema', 'load', 'createEngine'];

function scanK1(file, src) {
  if (!K1_FILES.includes(rel(file))) return [];
  const hits = [];
  src.split('\n').forEach((line, i) => {
    if (K1_RE.test(line)) hits.push({ line: i + 1, msg: 'mode === dalı (yeni oyun = registry kaydı, §3)' });
    K1_RE.lastIndex = 0;
  });
  return hits;
}

function scanK2(file, srcRaw) {
  const r = rel(file);
  if (K2_EXEMPT.has(r)) return [];
  const src = stripComments(srcRaw);
  const hits = [];
  src.split('\n').forEach((line, i) => {
    const m = line.match(HEX_RE);
    if (m) hits.push({ line: i + 1, msg: `ham renk literali ${m[0]} — token/parametre kullan (§8)` });
  });
  return hits;
}

function scanK3(file, srcRaw) {
  const r = rel(file);
  if (K3_EXEMPT.has(r)) return [];
  const src = stripComments(srcRaw);
  const hits = [];
  src.split('\n').forEach((line, i) => {
    if (K3_RE.test(line)) hits.push({ line: i + 1, msg: 'canvas.width/height ataması — DPR yalnız main.js (§4)' });
    K3_RE.lastIndex = 0;
  });
  return hits;
}

function scanK4(_file, src) {
  const hits = [];
  // CARTRIDGES blokları: `MODE: { ... }` — her kayıt zorunlu metot setini taşır.
  const blockRe = /^ {2}([A-Z][A-Z0-9_]*)\s*:\s*\{/gm;
  let m;
  while ((m = blockRe.exec(src))) {
    const mode = m[1];
    const start = m.index;
    // blok sonu: TAM iki girintili kapanış (daha derin nested `}` sayılmaz)
    const rest = src.slice(start);
    const closeIdx = rest.search(/^ {2}\},?$/m);
    if (closeIdx < 0) continue;
    const block = rest.slice(0, closeIdx);
    for (const method of REQUIRED_CARTRIDGE_METHODS) {
      if (!new RegExp(`(^|\\s)${method}\\s*[:(]`).test(block) && !new RegExp(`(^|\\s)${method}\\s*=`).test(block)) {
        hits.push({ line: src.slice(0, start).split('\n').length, msg: `CARTRIDGES.${mode} eksik metot: ${method} (§3)` });
      }
    }
    // aim sözleşmesi: world-view oyunları worldPacket taşır; diğerleri zorunlu değil.
  }
  return hits;
}

function scanK5(file, srcRaw) {
  const r = rel(file);
  if (K5_EXEMPT.has(r)) return [];
  const src = stripComments(srcRaw);
  const hits = [];
  src.split('\n').forEach((line, i) => {
    const m = line.match(EMOJI_RE);
    if (m) hits.push({ line: i + 1, msg: `ham emoji "${m[0]}" — tabletopIcons kullan (§8)` });
  });
  return hits;
}

function scanK6(_file, src) {
  const hits = [];
  const orderMatch = src.match(/GAME_ORDER\s*=\s*\[([\s\S]*?)\]/);
  if (!orderMatch) return [{ line: 1, msg: 'GAME_ORDER bulunamadı (§3)' }];
  const mapPath = join(ROOT, 'docs', 'PROJECT_MAP.md');
  const map = existsSync(mapPath) ? readFileSync(mapPath, 'utf8').toUpperCase() : '';
  if (!map) return [{ line: 1, msg: 'docs/PROJECT_MAP.md okunamadı (§10)' }];
  const names = [...orderMatch[1].matchAll(/'([A-Z0-9_]+)'|([a-z][a-z0-9_]*)\b/g)].map((x) => (x[1] || x[2] || '').toUpperCase()).filter(Boolean);
  for (const name of names) {
    if (!map.includes(name)) hits.push({ line: 1, msg: `PROJECT_MAP satırı yok: ${name} (§10)` });
  }
  return hits;
}

const K7_EXEMPT = new Set(['src/games/worldCore.js']);
const K7_LOOP_RE = /for\s*\(.*\bof\b.*particles/;

function scanK7(file, src) {
  const r = rel(file);
  if (!r.startsWith('src/games/') || K7_EXEMPT.has(r)) return [];
  const hits = [];
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (line.includes('particles.push(')) {
      hits.push({ line: i + 1, msg: 'ham partikul uretimi — fxRuntime.emit kullan (§4)' });
    }
  });
  lines.forEach((line, i) => {
    if (!K7_LOOP_RE.test(line)) return;
    K7_LOOP_RE.lastIndex = 0;
    for (let j = i + 1; j <= Math.min(lines.length - 1, i + 12); j += 1) {
      if (lines[j].includes('ctx.arc(')) {
        hits.push({ line: i + 1, msg: 'ham partikul cizimi — worldCore/drawFx katmani kullan (§4)' });
        break;
      }
    }
    K7_LOOP_RE.lastIndex = 0;
  });
  return hits;
}

const SCANS = [
  { id: 'K1', files: () => K1_FILES.map((f) => join(ROOT, f)), fn: scanK1 },
  { id: 'K2', files: () => walk(SRC, '.js'), fn: scanK2 },
  { id: 'K3', files: () => walk(SRC, '.js'), fn: scanK3 },
  { id: 'K4', files: () => [join(ROOT, 'src', 'core', 'engineRegistry.js')], fn: scanK4 },
  { id: 'K5', files: () => walk(SRC, '.js'), fn: scanK5 },
  { id: 'K6', files: () => [join(ROOT, 'src', 'core', 'engineRegistry.js')], fn: scanK6 },
  { id: 'K7', files: () => walk(join(SRC, 'games'), '.js'), fn: scanK7 },
];

// ---------------------------------------------------------------------------
// Çalıştırma + baseline
// ---------------------------------------------------------------------------

/** @type {Record<string, Record<string, number>>} ruleId -> relPath -> sayı */
let baseline = {};
if (existsSync(BASELINE_FILE)) {
  try { baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')); } catch { baseline = {}; }
}

const current = {};
const newViolations = [];
for (const scan of SCANS) {
  current[scan.id] = {};
  for (const file of scan.files()) {
    let src;
    try { src = readFileSync(file, 'utf8'); } catch { continue; }
    const hits = scan.fn(file, src);
    if (!hits.length) continue;
    const r = rel(file);
    current[scan.id][r] = (current[scan.id][r] || 0) + hits.length;
    const allowed = baseline?.[scan.id]?.[r] || 0;
    if (hits.length > allowed) {
      // eşik aşımı: tamamını değil, fazlasını bildir; satırlar yine de gösterilir.
      for (const h of hits) newViolations.push({ rule: scan.id, file: r, line: h.line, msg: h.msg, allowed, got: hits.length });
    }
  }
}

if (UPDATE || !existsSync(BASELINE_FILE)) {
  writeFileSync(BASELINE_FILE, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`rules-lint: ${UPDATE ? 'taban güncellendi' : 'taban ilk kez yazılıyor (mevcut borç donduruldu)'} (${Object.entries(current).map(([k, v]) => `${k}:${Object.values(v).reduce((a, b) => a + b, 0)}`).join(' ')})`);
  process.exit(0);
}

let failed = false;
for (const v of newViolations) {
  console.error(`${v.file}:${v.line} [${v.rule}] ${v.msg} (dosyada ${v.got}, izinli ${v.allowed})`);
  failed = true;
}
if (failed) {
  console.error('\nrules-lint: AGENTS.md yasağı ihlal edildi. Yeni iş için tabanı düşürmek = borcu azaltmak; artırmak yasak.');
  process.exit(1);
}
console.log('rules-lint: temiz — K1–K7 AGENTS.md yasaklarında yeni ihlal yok.');
