// tests/chromePolicy.test.mjs
//
// Krom politikası kilitleri. AGENTS.md §3 "tek kaynak" ve §8 "yasaklar"
// maddelerinin tarayıcı-çerçevesine düşen kısmı: tam ekran API'sinin, döndürme
// geçidinin ve girdi nötrleme kararının TEK bir sahibi olmalı. Bunlar davranış
// testi değil, KAYNAK taramasıdır — bir sonraki refactor'un kopya bir yol
// açtığında kırmızı yanması içindir (`tests/fieldKit.test.mjs §6` kalıbı).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

function jsFiles(dir = 'src') {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const full = join(ROOT, dir, name);
    if (statSync(full).isDirectory()) out.push(...jsFiles(relative(ROOT, full)));
    else if (name.endsWith('.js')) out.push(relative(ROOT, full).replace(/\\/g, '/'));
  }
  return out;
}

const SRC_JS = jsFiles();
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** Yorum satırlarını atar: taramalar yorumdaki yasak kelimeye takılmamalı. */
function codeOf(rel) {
  return read(rel)
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/*'))
    .join('\n');
}

// Tam ekran API'sinin sahibi. Yorumda geçmesi tarayıcıyı aldatmaz; asıl
// mesele ikinci bir `requestFullscreen` yolunun açılmamasıdır — o yol,
// niyet kaydı (`sessionStorage`) olmadan tarayıcıya gider ve kullanıcının
// "bıraktım" kararını eziper.
const FULLSCREEN_OWNER = 'src/ui/fullscreen.js';

test('only src/ui/fullscreen.js touches the Fullscreen API', () => {
  const offenders = [];
  for (const file of SRC_JS) {
    if (file === FULLSCREEN_OWNER) continue;
    const code = codeOf(file);
    for (const api of ['requestFullscreen(', 'exitFullscreen(', 'webkitRequestFullscreen', 'mozRequestFullScreen', 'msRequestFullscreen']) {
      if (code.includes(api)) offenders.push(`${file}: ${api}`);
    }
  }
  assert.deepEqual(offenders, [], `tam ekran API'si tek sahibi dışına taşmış:\n  ${offenders.join('\n  ')}`);
});

test('there is no second toggleFullscreen implementation', () => {
  // `fullscreen.js` dışındaki dosyalar yalnız İMPORT edip ÇAĞIRABİLİR;
  // kendi sınıflarında/fonksiyonlarında tanımlayamazlar.
  const owners = [];
  for (const file of SRC_JS) {
    const code = codeOf(file);
    if (file !== FULLSCREEN_OWNER && /(^|\s)toggleFullscreen\s*\([^)]*\)\s*\{/.test(code)) owners.push(file);
  }
  assert.deepEqual(owners, [], `kopya toggleFullscreen tanımı: ${owners.join(', ')}`);
  assert.match(codeOf(FULLSCREEN_OWNER), /export function toggleFullscreen/);
});

// AGENTS §7: tek rotate gate kabuğundur. Kumandanın enjekte ettiği ikinci
// gate, kabuğunkiyle (z-index 400) aynı ekranda üst üste iki tam ekran scrim
// üretiyordu ve ölü stil bırakıyordu.
test('exactly one rotate gate exists — the shell owns it', () => {
  const injected = SRC_JS.filter((file) => /['"]rotate-gate['"]/.test(codeOf(file)));
  assert.deepEqual(injected, [], `ikinci bir rotate gate enjekte ediliyor: ${injected.join(', ')}`);
  assert.ok(codeOf('src/ui/appShell.js').includes("'app-rotate-gate'"), 'kabuk geçidi kaybolmuş');
});

// Faz A'nın asıl vaadi: tarayıcı çubuğu kıpırtısı maç ortasında basılı
// dokunuşları düşürmez. `resize` nötrleme YAPMAMALI; nötrleme gerçek
// girdi-kaynağı değişimlerinde (dönüş / arka plan / odak kaybı) KALMALI —
// kilit iki yönlüdür, yoksa "hepsini sil" de geçer sayılırdı.
test('a plain resize never drops live touches', () => {
  const main = codeOf('src/main.js');
  assert.match(main, /window\.addEventListener\('resize',\s*scheduleResize\)/,
    'resize artık doğrudan handler kullanıyor; birleştirme (rAF) kayboldu');

  const body = main.slice(main.indexOf('function scheduleResize()'));
  const scheduleBody = body.slice(0, body.indexOf('\n}') + 2);
  assert.ok(scheduleBody.includes('requestAnimationFrame'), 'kare başına birleştirme kalkmış');
  assert.ok(!scheduleBody.includes('neutralizeTransientInput'),
    'resize yolunda dokunuş nörleniyor — çubuk kıpırtısı basılı joysticki düşürür');
  assert.ok(!main.includes("window.addEventListener('resize', () => {\n  resizeCanvas();"),
    'eski satır içi resize handler geri gelmiş');
});

test('input is still neutralized on the real source-change events', () => {
  const main = codeOf('src/main.js');
  for (const event of ['orientationchange', 'visibilitychange', 'blur']) {
    const at = main.indexOf(`addEventListener('${event}'`);
    assert.ok(at >= 0, `${event} dinleyicisi kaybolmuş`);
    const chunk = main.slice(at, at + 420);
    assert.ok(chunk.includes('neutralizeTransientInput'),
      `${event} artık dokunuşları nötrlemiyor — gerçek girdi kaybı senaryosu açıkta`);
  }
});

// AGENTS §3: cache anahtarı kareye oturur. `paintBackdrop` bir ara 1 px
// hassasiyetle ve w/h'yi hiç kuantumlamadan anahtar üretiyordu; çubuk
// animasyonundaki her ara tam-piksel yükseklik tüm viewport'u yeniden
// pişirip 2 girdili LRU'da ping-pong üretiyordu.
//
// NOT: bu kilidi `src/core/fieldKit.js`'in kendi commit'iyle birlikte
// ekleyeceğiz — dosyada o commit'ten önce başka bir iş akışının yarım
// değişikliği duruyor ve kilit, düzeltme commit'lenmeden yeşil olamaz.
test('backdrop cache key is quantized like the field layer', { skip: 'fieldKit.js düzeltmesi commit edilince açılacak' }, () => {
  const kit = codeOf('src/core/fieldKit.js');
  const at = kit.indexOf('export function paintBackdrop');
  assert.ok(at >= 0, 'paintBackdrop bulunamadı');
  const keyBlock = kit.slice(at, kit.indexOf('].join', at));
  assert.match(keyBlock, /quantize2\(/, 'backdrop anahtarı kuantumlamıyor — her piksel adımı yeniden bake');
  assert.ok(!/Math\.round\(w\)|Math\.round\(h\)/.test(keyBlock),
    'backdrop anahtarında ham 1 px yuvarlama var');
  // Tek kova: saha katmanı da aynı yardımcıyı kullanmalı (iki ayrı eşik
  // ileride yine ayrışır).
  assert.match(kit, /const q = quantize2/, 'saha katmanı ayrı bir kova yazmış');
});
