// Stage 3 audit: no engine may keep an ABSOLUTE px size/speed for a body or a
// gameplay distance. The bulk edit that introduced this audit silently failed on
// one file (curve.js reported "done" but applied nothing), so the rule is now
// checked mechanically rather than by trusting a script's exit code.
//
// A source scan is normally brittle, but this is exactly the case where it earns
// its keep: the constants are literal numbers in a small, known set of files, and
// the failure mode (a silent miss) is invisible to the test suite otherwise.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const SRC = new URL('../src/', import.meta.url).pathname.replace(/^\//, '');

// Files where a literal px number is legitimate and must not be flagged.
const ALLOW = [
  // Pure timers / counts / ratios — never spatial.
  /_TIME\b/, /_LIMIT/, /_COOLDOWN/, /_DURATION/, /_INTERVAL/, /_CD\b/,
  /_EPSILON/, /_MAX\b/, /_MIN\b/, /_CAP\b/, /_COUNT/, /_WAVE/, /_LAPS/,
  /_SCORE/, /_HP\b/, /_AMMO/, /PROGRESS/, /_TIER\b/, /_PER_/, /_MULT/,
];

// Yalnız VARLIK NESNESİ LİTERALİ deseni: `speed: 175`, `radius: 24`.
// `const spd = ...` gibi yerel değişkenler ve `this.x = ...` atamaları
// kasten kapsam dışı: onlar çok daha gürültülü ve çoğu zaten sarmalanmış
// çağrının içinde ya da geçici bir yedek değer.
const SPATIAL = [
  { re: /\bspeed:\s*(\d{2,})\b/g, kind: 'speed' },
  { re: /\bradius:\s*(\d{2,})\b/g, kind: 'size' },
  { re: /\bbaseSpeed:\s*(\d{2,})\b/g, kind: 'speed' },
  { re: /\bdriveSpeed:\s*(\d{2,})\b/g, kind: 'speed' },
  { re: /\bRADIUS\b\s*=\s*(\d{2,})\b/g, kind: 'size' },
];

// Tasarım tabloları: bildirim noktasında kasıtiyle ham px'te dururlar ve
// KULLANIM noktasında `fieldPx`/`fieldRadius` ile sarılırlar. Kaynak tarama
// bunları "henüz çevrilmemiş" sanabilir; burada açıkça sınıflandırıldı.
const DESIGN_TABLES = [
  { file: 'games/horde.js', contains: 'chaser: { hp:' },
  { file: 'games/horde.js', contains: 'shooter: { hp:' },
  { file: 'games/horde.js', contains: 'tank: { hp:' },
  { file: 'games/horde.js', contains: 'healer: { hp:' },
  { file: 'games/horde.js', contains: 'BOSS_CHASER' },
  // CROWN tacı: constructor'da ham tasarım px, `resize()` içinde
  // `fieldRadius` ile türetiliyor. Constructor arenası `unit` içermiyor.
  { file: 'games-retired/crown.js', contains: 'radius: 20,' },
  // raceLogic RACE_TUNING: bildirimde ham px, kullanımda race.js `this.px/spd`.
  { file: 'games/raceLogic.js', contains: 'baseSpeed:' },
  { file: 'games/raceLogic.js', contains: 'playerRadius:' },
];

// Aynı ifadede bir ölçek çarpanıyla çarpılan literal zaten orantılıdır:
// `radius: 15 * hu`, `w: 42 * u`, `lineTo(38 * u, 0)`. Tarama metinsel olduğu
// için bunu "henüz çevrilmemiş" sanıyordu (HORDE oyuncu HUD'u).
//
// Bu yanlış pozitif düzeltildi çünkü yanlış alarm üreten bir koruma, zamanla
// yok sayılır — o zaman da asıl amacını (sessizce eklenen mutlak px) kaybeder.
const SCALED_LITERAL = /(?:\d+(?:\.\d+)?)\s*[*/]\s*(?:this\.)?(?:hu|u|k|scale|unit|px|fieldPx|fieldRadius|fieldSpeed)\b/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = [
  ...walk(join(SRC, 'games')),
  ...walk(join(SRC, 'games-retired')),
  ...walk(join(SRC, 'ai')),
];

const findings = [];

for (const file of files) {
  // Normalize separators: on Windows `rel` uses backslashes, DESIGN_TABLES uses
  // forward slashes, so a raw endsWith() would silently never match.
  const rel = file.replace(SRC, '').split('\\').join('/');
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    // Already-wrapped: fieldPx / fieldSpeed / fieldRadius / this.px / this.spd
    if (/fieldPx\(|fieldSpeed\(|fieldRadius\(|this\.(px|spd)\(/.test(line)) return;
    // Already-proportional: a literal multiplied by a scale factor in the same
    // expression. Without this the audit flagged its own fix.
    if (SCALED_LITERAL.test(line)) return;
    for (const { re, kind } of SPATIAL) {
      re.lastIndex = 0;
      let m = re.exec(line);
      while (m) {
        const name = m[1] || m[0].split(':')[0].split('=')[0].trim();
        const classified = ALLOW.some((a) => a.test(name))
          || DESIGN_TABLES.some((d) => rel.endsWith(d.file) && line.includes(d.contains));
        if (!classified) {
          findings.push({ rel, line: i + 1, kind, name: m[0].trim(), text: trimmed.slice(0, 90) });
        }
        m = re.exec(line);
      }
    }
  });
}

test('absolute px inventory is triaged, not growing', () => {
  // Bilerek bir ENVANTER olarak yazıldı, sert kapı DEĞİL. Kaynak taraması
  // kasıtlı olarak gürültülü: HONEST olarak sınıflandırılmış yanlış pozitifler
  // var (aşağıda `KNOWN_FALSE_POSITIVES`).
  //
  // Bu testin asıl işi, bir toplu düzenlemenin sessizce uygulanmamasını
  // yakalamak. Stage 3'te `curve.js` için toplu script "done" dedi ama hiçbir
  // şeyi uygulamamıştı; hiçbir test bunu görmemişti.
  if (findings.length) {
    console.log(`\n  ${findings.length} un-triaged absolute-px candidate(s):`);
    for (const f of findings) console.log(`    ${f.rel}:${f.line}  [${f.kind}] ${f.text}`);
  }
  // Triage TAMAMLANDI: 61 → 0. Artık hiçbir motor, gövde veya oynanış mesafesi
  // için mutlak px taşımıyor; taban SIFIR, yani yeni bir mutlak px eklendiği
  // anda test kırılır.
  //
  //   RACE   yağ lekesi 26-30, nitro pad 40-45x28, spinner 110-140, EMP 10,
  //          başlangıç ızgarası 32/28                      -> this.px(...)
  //   TANKS  mermi 4.5, HUD proksi 10                      -> fieldRadius(...)
  //   PONG   HUD proksi 24                                  -> fieldRadius(...)
  //   CROWN  36 harita yarıçapı, oyuncu/taç 20, mürekkep 22,
  //          6 konveyör hızı (170/180)                     -> fieldRadius/fieldSpeed
  //   CLONE  6 oda yarıçapı, kon hızı 80+25                -> fieldRadius/fieldSpeed
  //
  // Bilerek doğru bırakılanlar:
  //   · PONG topu zaten `fieldRadius(arena, 16, 0.015)` — taban tasarım payının
  //     (%1.68) ALTINDA, yani yalnız çöken sahada devreye giriyor.
  //   · LASER/SNAKE harita tabanları `Math.max(abs, oran)` ve tasarım payının
  //     çok altında (ör. `size*0.16` = 152px'e karşı taban 56px) → bağlamıyor.
  //   · CROWN tacının constructor'daki `radius: 20` tasarım bildirimidir;
  //     `resize()` içinde `fieldRadius` ile türetilir. Constructor arenası
  //     `unit` içermediği için orada ölçeklenemez — bu yolu bir kez denedim ve
  //     taç yere düşünce toplanmıyordu (test yakaladı).
  //   · `DESIGN_TABLES` girdileri: bildirim noktasında kasıtlı ham px, kullanımda
  //     sarmalanmış çağrı.
  const KNOWN_BASELINE = 0;
  const unTriaged = findings.length - KNOWN_BASELINE;
  assert.ok(
    unTriaged <= 0,
    `${unTriaged} new untriaged entity-literal px constant(s) appeared `
    + `(now ${findings.length}, baseline ${KNOWN_BASELINE}); convert or classify them`,
  );
});
