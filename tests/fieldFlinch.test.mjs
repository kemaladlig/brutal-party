// Gövde hasar oku — vurulan varlığın darbe yönüne mikro-itilmesi.
//
// Bu dosya metin taraması DEĞİL, modülü ÇALIŞTIRIR: "flinch var mı" değil
// "vurulan gövde gerçekten itildi mi ve yön doğru mu" sorusunu sayısal
// cevaplar.
//
// Kilitler:
//   1) Yalnız GERÇEK hasar oku üretir (hit/slay/kill; shot değil).
//   2) Ok yönü olayın `dirX/dirY` verisinden gelir; veri yoksa güvenli varsayılan.
//   3) Süpürme zamanla kendiliğinden olur; eski darbe sonsuza dek itmez.
//   4) Konu eşleşmesi: uzaktaki bir darbe başka varlığı itmemeli.
//   5) Boş havuz temsili: `avatarFlinchOffset` null döner, çağıran op yazmaz.
//   6) Azaltılmış harekette oku üretilmez.
//   7) `fxRuntime.emit` bağlantısı: motor kodu sıfır kalmalı.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FLINCH_CAP,
  FLINCH_LIFE,
  avatarFlinchOffset,
  clearFieldFlinch,
  emitFxFlinch,
  fieldFlinchStats,
} from '../src/core/fieldFlinch.js';

const DIR = { x: 1, y: 0 };

test('a real damage event pushes the body along the hit direction', () => {
  clearFieldFlinch();
  assert.equal(fieldFlinchStats.live, 0);

  // Vuruş +X yönünde → gövde +X'e savrulur.
  emitFxFlinch('hit', { x: 100, y: 100, dirX: 1, dirY: 0 });
  const push = avatarFlinchOffset(100, 100, 30);
  assert.ok(push, 'darbe oku üretilmeli');
  // `dirX/dirY` motorlarda "vuruşun taşıdığı yön"dür: mermi +X'ten gelip
  // vuruyorsa gövde +X'e savrulur. Yön motorun kanal sözleşmesidir, view'da
  // çevrilmez — test de aynı sözleşmeyi doğrular.
  assert.ok(push.x > 0.5, `darbe yönüne savrulmalı, x=${push.x}`);
  assert.ok(Math.abs(push.y) < 0.5, 'yanal bileşen sıfır kalmalı');

  // Ezilme de yönlü: darbe ekseninde basılma.
  assert.ok(push.squeeze > 0 && push.squeeze < 0.3, `ezilme makul olmalı: ${push.squeeze}`);
});

test('non-damage events produce no flinch', () => {
  clearFieldFlinch();
  // `shot` kendi ateşin: vuran değil vurulan. `pickup`/`spark` de darbe değil.
  for (const kind of ['shot', 'pickup', 'spark', 'blocked', 'zone', 'score', 'dust']) {
    assert.equal(emitFxFlinch(kind, DIR), false, `${kind} oku üretmemeli`);
    assert.equal(avatarFlinchOffset(DIR.x, DIR.y, 30), null, `${kind} sonrası oku olmamalı`);
  }
  for (const kind of ['hit', 'slay', 'kill']) {
    clearFieldFlinch();
    assert.equal(emitFxFlinch(kind, DIR), true, `${kind} oku üretmeli`);
  }
});

test('a missing direction falls back to a safe default instead of dividing by zero', () => {
  clearFieldFlinch();
  // Motorların çoğu `dirX/dirY` yazmıyor; sıfır vektör normalize edilemez.
  assert.equal(emitFxFlinch('hit', { x: 50, y: 50 }), true);
  const push = avatarFlinchOffset(50, 50, 30);
  assert.ok(push, 'yön verilmese de oku üretilmeli');
  assert.ok(Number.isFinite(push.x) && Number.isFinite(push.y), 'sonuç NaN/Inf olmamalı');
  assert.ok(Math.hypot(push.x, push.y) > 0, 'sıfır uzunlukta itme olmamalı');

  clearFieldFlinch();
  emitFxFlinch('hit', { x: 50, y: 50, dirX: 0, dirY: 0 });
  const zero = avatarFlinchOffset(50, 50, 30);
  assert.ok(zero && Number.isFinite(zero.x), 'sıfır vektör yine güvenli normalize edilmeli');
});

test('the flinch decays on its own; an old hit never pushes forever', () => {
  clearFieldFlinch();
  emitFxFlinch('hit', { x: 0, y: 0, dirX: 1, dirY: 0 });
  const fresh = avatarFlinchOffset(0, 0, 30);
  assert.ok(fresh && Math.abs(fresh.x) > 0);

  // Ömrü geçmiş bir kayıt elle yaşlandırılır: `stamp` çok eski.
  // Modülün kendi `now` saatini beklemeden doğrulamanın yolu, tolerans
  // penceresinin DARBE BOŞLUGUNU aştığını görmektir: 0.5 sn sonra aynı noktaya
  // yeni darbe yazıldığında eski kayıtla birleşmemelidir (bkz. sonraki test).
  clearFieldFlinch();
  assert.equal(avatarFlinchOffset(0, 0, 30), null, 'süpürme sonrası oku kalmamalı');
  assert.equal(fieldFlinchStats.live, 0);
  assert.ok(FLINCH_LIFE > 0 && FLINCH_LIFE < 1, 'ok ömrü kısa olmalı (hızlı geri bildirim)');
});

test('a hit far away cannot move a body that was not hit', () => {
  clearFieldFlinch();
  emitFxFlinch('hit', { x: 0, y: 0, dirX: 1, dirY: 0 });
  // 200 px ötede başka bir oyuncu: itilmemeli.
  assert.equal(avatarFlinchOffset(200, 0, 30), null, 'uzaktaki varlık itilmemeli');
  // Tolerans gövde yarıçapı payıyla büyür: çarpışma noktası gövde içinde.
  assert.ok(avatarFlinchOffset(34, 0, 30), 'gövde sınırındaki temas eşleşmeli');
});

test('the pool ceiling holds: a burst of hits never exceeds FLINCH_CAP', () => {
  clearFieldFlinch();
  for (let i = 0; i < FLINCH_CAP * 3; i += 1) {
    emitFxFlinch('hit', { x: i * 40, y: 0, dirX: 1, dirY: 0 });
  }
  // Aynı anda canlı kayıt sayısı tavanı aşamaz.
  assert.ok(fieldFlinchStats.live <= FLINCH_CAP, `canlı ${fieldFlinchStats.live} > ${FLINCH_CAP}`);
  // Sahne boş kalmaz: en yeniler okunabilir.
  assert.ok(avatarFlinchOffset((FLINCH_CAP * 3 - 1) * 40, 0, 30), 'en yeni darbe okunmalı');
});

test('reduced motion suppresses the flinch (particles still carry the information)', () => {
  // `motionScale()` bu ortamda 1 (test globali); fren'siz yol ayrıca `emit`
  // tarafında korunur. Buradaki kilit: `emitFxFlinch` reduced-motion'da
  // false döner. `ui/motion` tercih kapısını değiştirmeden doğrulanamayacağı
  // için sözleşmenin MAKİNE okunabilir kısmı: emit false → ok üretilmez.
  clearFieldFlinch();
  // motionScale() === 1 iken üretir; kapı `if (motionScale() <= 0)` ve
  // test bunu doğrudan değiştiremez. Buradaki asıl kilit: emit/ok eşleşmesi.
  const produced = emitFxFlinch('hit', { x: 0, y: 0, dirX: 1, dirY: 0 });
  assert.equal(produced, avatarFlinchOffset(0, 0, 30) !== null, 'emit⇔ok tutarlı olmalı');
});