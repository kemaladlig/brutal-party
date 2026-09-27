// Undefined-name lint — "Cannot find name 'X'" sınıfı hataları mekanik olarak
// yakalar.
//
// Neden ayrı bir betik: `tsconfig.json` `checkJs: false` (JSDoc'sız AI
// modülleri tsc'ye binlerce sahte TS2339 üretiyor) ve tam `checkJs` kapısı
// kullanılamaz durumda. `scripts/typecheck.mjs` bir SAYI ratchet'i: eşsiz hata
// sayısı tabanı aşarsa patlar, tek başına azalırsa sessiz geçer. Ama bu proje
// saf JS ve "isim bulunamadı" sınıfı tarayıcıda ancak o özellik yoluna girince
// patlar — o ana kadar "çalışıyor" görünür:
//
//   - `roomFlow.js`: import edilmemiş `getColorClashIndices`, `reportError`,
//     `beginMatchChrome`; SİLİNMİŞ durum bloklarından kalan `stagingMode`,
//     `seatsLocked`, `countdownTimer`, `lastCountdownT`.
//   - `main.js`: `createRoomFlow({ gamepadManager, localGamepadManager,
//     inputRouter })` kendi `const` bildiriminden önce okunuyor → modül yüklenmiyor.
//
// Bu betik tsc'yi `--checkJs` ile çalıştırıp SADECE TS2304/TS2552 satırlarını
// tutar (tip geri bildirimi gürültüsü elenir). `npm run check` in parçasıdır ve
// `npm run typecheck` ratchet'inin YANINDA çalışır: ratchet "daha kötü olma",
// bu "hiç olma" der.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

// Yalnız "tanımı olmayan isim" sınıfı:
//   2304 — Cannot find name 'x'.
//   2552 — Cannot find name 'x'. Did you mean 'y'?
// TS2339 (tip uyumsuzluğu) ve TS2551 bilerek yok sayılır: bu bir isim
// çözümleme denetleyicisidir, tip denetleyicisi değil.
const UNDEF_CODES = new Set(['TS2304', 'TS2552']);

// Windows sürücü harfi iki nokta içerdiğinden desen sondan sıkı eşleşir.
const LINE_RE = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s*(.*)$/;

const run = spawnSync(process.execPath, [TSC, '--noEmit', '--checkJs'], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
const findings = [];
let parseFailed = false;

for (const raw of out.split(/\r?\n/)) {
  const m = LINE_RE.exec(raw);
  if (!m) {
    if (/\berror\s+TS\d+/.test(raw)) parseFailed = true;
    continue;
  }
  const [, file, line, , code, message] = m;
  if (!UNDEF_CODES.has(code)) continue;
  findings.push({
    file: file.replace(/\\/g, '/').replace(/^.*?brutal-party[\\/]/, ''),
    line,
    message,
  });
}

if (parseFailed) {
  console.error('undef-lint: tsc çıktısı tam çözümlenemedi, ham çıktı aşağıda:');
  console.error(out);
  process.exit(2);
}

if (findings.length) {
  console.error('\n  Tanımsız isim — bu sembol çalışma anında ReferenceError verir:\n');
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.message}`);
  }
  console.error(`\n  ${findings.length} tanımsız isim. Düzelt: ya import et, ya da modülün dependency'sinden geçir.\n`);
  process.exit(1);
}

console.log('  undef-lint: isim çözümlemesi temiz.');
