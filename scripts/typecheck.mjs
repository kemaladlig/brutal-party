// Ratchet'li tip denetimi: tsc --checkJs çalıştırır, hataları dosya bazında gruplar.
// Kullanım:
//   node scripts/typecheck.mjs            -> scripts/typecheck-baseline.txt tabanını aşarsa exit 1
//   node scripts/typecheck.mjs --stats    -> dosya bazında tablo + toplam
//   node scripts/typecheck.mjs --max=120  -> eşsiz hata sayısı 120'yi aşarsa exit 1
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const BASELINE_FILE = path.join(ROOT, 'scripts', 'typecheck-baseline.txt');

const args = process.argv.slice(2);
const wantStats = args.includes('--stats');
const maxArg = args.find((a) => a.startsWith('--max='));
let max = maxArg ? Number(maxArg.slice('--max='.length)) : null;
if (max === null && !maxArg) {
  // eşsiz hata sayısı scripts/typecheck-baseline.txt'teki tabanı aşamaz (ratchet)
  max = Number(readFileSync(BASELINE_FILE, 'utf8').trim());
}
if (!Number.isInteger(max) || max < 0) {
  console.error(`typecheck: geçersiz --max/değer: ${maxArg ?? BASELINE_FILE}`);
  process.exit(2);
}

const run = spawnSync(process.execPath, [TSC, '--noEmit', '--checkJs'], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
// Satır biçimi: "path(line,col): error TSxxxx: message" — Windows sürücü harfi iki nokta içerdiğinden desen sondan sıkı eşleşir.
const LINE_RE = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s*(.*)$/;

/** @type {Map<string, Map<string, number>>} file -> dedupKey -> count */
const byFile = new Map();
/** @type {{code: string, message: string, count: number}[]} */
const byCodeMap = new Map();
let parseFailed = false;

for (const raw of out.split(/\r?\n/)) {
  const m = LINE_RE.exec(raw);
  if (!m) {
    if (/\berror\s+TS\d+/.test(raw)) parseFailed = true;
    continue;
  }
  const file = m[1].replace(/\\/g, '/').replace(/^.*?brutal-party\//, '');
  const [, , , , code, message] = m;
  if (!byFile.has(file)) byFile.set(file, new Map());
  const key = `${code}:${message}`;
  const per = byFile.get(file);
  per.set(key, (per.get(key) ?? 0) + 1);
  if (!byCodeMap.has(key)) byCodeMap.set(key, { code, message, count: 0 });
  byCodeMap.get(key).count += 1;
}

let totalLines = 0;
let uniqueErrors = 0;
for (const per of byFile.values()) {
  totalLines += [...per.values()].reduce((a, b) => a + b, 0);
  uniqueErrors += per.size;
}

if (wantStats) {
  const rows = [...byFile.entries()]
    .map(([file, per]) => ({ file, uniq: per.size, all: [...per.values()].reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.uniq - a.uniq || b.all - a.all);
  const w = rows.reduce((m, r) => Math.max(m, r.file.length), 0);
  console.log('dosya'.padEnd(w) + '  eşsiz  toplam');
  for (const r of rows) console.log(r.file.padEnd(w) + String(r.uniq).padStart(7) + String(r.all).padStart(8));
  console.log('-'.repeat(w + 16));
  console.log('TOPLAM'.padEnd(w) + String(uniqueErrors).padStart(7) + String(totalLines).padStart(8));
  console.log('\nhata kodu dağılımı:');
  for (const { code, message, count } of [...byCodeMap.values()].sort((a, b) => b.count - a.count).slice(0, 15)) {
    console.log(`${String(count).padStart(5)}  ${code}: ${message.slice(0, 90)}`);
  }
}

if (parseFailed) {
  console.error('typecheck: çıktı tam çözümlenemedi, ham tsc çıktısı aşağıda:');
  console.error(out);
  process.exit(2);
}

if (max !== null && uniqueErrors > max) {
  console.error(`typecheck: ratchet aşıldı — eşsiz hata ${uniqueErrors} > izin verilen ${max}. Yeni ihlal eklemeyin; düşürmeniz gerekiyor.`);
  process.exit(1);
}

if (uniqueErrors > 0 && !wantStats) {
  console.error(`typecheck: ${uniqueErrors} eşsiz hata (${totalLines} satır). Detay: npm run typecheck -- --stats`);
}
process.exit(0);
