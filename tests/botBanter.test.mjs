// Bot tepkileri (banter) — saf karar tablosu + durum-farkı yönetmeni (AGENTS §4:
// karar çekirdekte, motor/AI dosyalarına dokunulmaz).
//
// Bu test iki sözleşmeyi kilitler:
//   §A `pickBotReaction` YALNIZ `reactions.js` beyaz liste anahtarı döndürür
//      (ham emoji/wire değişmez — AGENTS §8/K5).
//   §B Yönetmen raunt/maç/skor geçişini okur, insan koltuğuna tepki yazmaz ve
//      sunucudaki 1 Hz host tepki bütçesini aşmaz (AGENTS §6).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOT_BANTER_COOLDOWN_MS,
  BOT_BANTER_EVENTS,
  botTemper,
  pickBotReaction,
} from '../src/core/botBanter.js';
import { createBotReactionDirector } from '../src/core/botReactionDirector.js';
import { REACTION_KEYS, isReactionKey } from '../src/core/reactions.js';

const EVENTS = Object.values(BOT_BANTER_EVENTS);
const TEMPERS = ['ANGRY', 'GRIN', 'CYBORG', 'FOCUS', 'DERP', 'STAR', '', 'BILINMEYEN'];

/** @param {Record<string, any>} [overrides] */
function makeEngine(overrides = {}) {
  return {
    state: 'PLAYING',
    roundWinner: null,
    matchWinner: null,
    matchDraw: false,
    matchResult: null,
    scores: [0, 0, 0, 0],
    slotTypes: ['human', 'bot_normal', 'bot_god', 'empty'],
    ...overrides,
  };
}

function harness({ enabled = true, rng = () => 0 } = {}) {
  /** @type {Array<{ key: string, slot: number, event: string }>} */
  const out = [];
  const director = createBotReactionDirector({
    isEnabled: () => enabled,
    emit: (key, slot, meta) => out.push({ key, slot, event: meta.event }),
    rng,
  });
  return { director, out };
}

// ── §A karar tablosu ────────────────────────────────────────────────────────
test('A: pickBotReaction her olay/yüz/god kombinasyonunda beyaz liste anahtarı döndürür', () => {
  for (const event of EVENTS) {
    for (const expression of TEMPERS) {
      for (const god of [false, true]) {
        const key = pickBotReaction({ event, expression, god, rng: () => 0 });
        assert.ok(isReactionKey(key), `${event}/${expression}/god=${god} → ${key}`);
        assert.ok(REACTION_KEYS.includes(key));
      }
    }
  }
});

test('A: bilinmeyen olay null döner (gönderen düşürür)', () => {
  assert.equal(pickBotReaction({ event: 'yok-boyle-bir-olay' }), null);
  assert.equal(pickBotReaction({}), null);
});

test('A: god bot maç kaybında ağlamaz, öfkelenir', () => {
  for (let i = 0; i < 300; i += 1) {
    const key = pickBotReaction({
      event: BOT_BANTER_EVENTS.MATCH_LOSS,
      expression: 'GRIN',
      god: true,
    });
    assert.notEqual(key, 'cry');
  }
});

test('A: yüz → kişilik eşlemesi bilinmeyen yüzde stoic olur', () => {
  assert.equal(botTemper('ANGRY'), 'brute');
  assert.equal(botTemper('CYBORG'), 'cold');
  assert.equal(botTemper(undefined), 'stoic');
  assert.equal(botTemper('NE_BILIRIM'), 'stoic');
});

// ── §B yönetmen ────────────────────────────────────────────────────────────
test('B: bot raundu kazanınca kendi koltuğundan tepki yayılır', () => {
  const { director, out } = harness();
  const engine = makeEngine();
  director.tick(engine, 0);
  engine.state = 'ROUND_OVER';
  engine.roundWinner = { index: 1 };
  director.tick(engine, 100);
  assert.equal(out.length, 1);
  assert.equal(out[0].slot, 1);
  assert.equal(out[0].event, BOT_BANTER_EVENTS.ROUND_WIN);
  assert.ok(isReactionKey(out[0].key));
});

test('B: insan kazanınca kaybeden BOT konuşur, insan koltuğu asla', () => {
  const { director, out } = harness();
  const engine = makeEngine();
  director.tick(engine, 0);
  engine.state = 'ROUND_OVER';
  engine.roundWinner = { index: 0 };
  director.tick(engine, 100);
  assert.equal(out.length, 1);
  assert.ok(out[0].slot === 1 || out[0].slot === 2, 'bot koltuğu');
  assert.equal(out[0].event, BOT_BANTER_EVENTS.ROUND_LOSS);
});

test('B: masada bot yoksa hiç tepki yayılmaz', () => {
  const { director, out } = harness();
  const engine = makeEngine({ slotTypes: ['human', 'human', 'human', 'human'] });
  director.tick(engine, 0);
  engine.state = 'MATCH_OVER';
  engine.matchWinner = { index: 0 };
  director.tick(engine, 100);
  assert.equal(out.length, 0);
});

test('B: sunucu 1 Hz host bütçesi — cooldown içinde ikinci balon yok', () => {
  const { director, out } = harness();
  const engine = makeEngine();
  director.tick(engine, 1000);
  engine.state = 'ROUND_OVER';
  engine.roundWinner = { index: 1 };
  director.tick(engine, 1100);
  assert.equal(out.length, 1);
  // Aynı bot 1.1 sn sonra tekrar kazanıyor: bot tabanı (3.8 sn) henüz dolmadı.
  engine.state = 'PLAYING';
  director.tick(engine, 1200);
  engine.state = 'ROUND_OVER';
  director.tick(engine, 1300);
  assert.equal(out.length, 1, 'cooldown içinde ikinci balon yok');
  // Taban dolunca yeniden konuşur.
  engine.state = 'PLAYING';
  director.tick(engine, 6000);
  engine.state = 'ROUND_OVER';
  director.tick(engine, 6100);
  assert.equal(out.length, 2);
});

test('B: maç sonu kritik olay bot tabanını delip geçer', () => {
  const { director, out } = harness();
  const engine = makeEngine();
  director.tick(engine, 1000);
  engine.state = 'MATCH_OVER';
  engine.matchWinner = { index: 1 };
  director.tick(engine, 1100);
  assert.equal(out.length, 1);
  assert.equal(out[0].event, BOT_BANTER_EVENTS.MATCH_WIN);
  assert.ok(1100 - 1000 < BOT_BANTER_COOLDOWN_MS.bot, 'kritik giriş anında geçti');
});

test('B: co-op (HORDE) maç sonucu takım tepkisi üretir', () => {
  const { director, out } = harness();
  const engine = makeEngine({ matchResult: 'win', matchWinner: null });
  director.tick(engine, 0);
  engine.state = 'MATCH_OVER';
  director.tick(engine, 100);
  assert.ok(out.length >= 1);
  assert.equal(out[0].event, BOT_BANTER_EVENTS.MATCH_WIN);
});

test('B: oyun içi sayı artışı bot adına SCORED üretir', () => {
  const { director, out } = harness();
  const engine = makeEngine();
  director.tick(engine, 0);
  engine.scores = [0, 1, 0, 0];
  director.tick(engine, 100);
  assert.equal(out.length, 1);
  assert.equal(out[0].slot, 1);
  assert.equal(out[0].event, BOT_BANTER_EVENTS.SCORED);
});

test('B: ayar kapalıyken yönetmen susar', () => {
  const { director, out } = harness({ enabled: false });
  const engine = makeEngine();
  director.tick(engine, 0);
  engine.state = 'ROUND_OVER';
  engine.roundWinner = { index: 1 };
  director.tick(engine, 100);
  assert.equal(out.length, 0);
});

test('B: motor değişiminde geçmiş fark sıfırlanır (hayalet balon yok)', () => {
  const { director, out } = harness();
  const first = makeEngine();
  director.tick(first, 0);
  first.state = 'ROUND_OVER';
  first.roundWinner = { index: 1 };
  // Motor değişti: ilk kare yalnız taban kurar.
  const second = makeEngine({ state: 'ROUND_OVER', roundWinner: { index: 1 } });
  director.tick(second, 100);
  assert.equal(out.length, 0);
  second.state = 'PLAYING';
  director.tick(second, 200);
  second.state = 'ROUND_OVER';
  director.tick(second, 300);
  assert.equal(out.length, 1);
});

test('B: lobiye dönüş cooldown sayaçlarını temizler', () => {
  const { director, out } = harness();
  const engine = makeEngine();
  director.tick(engine, 0);
  engine.state = 'ROUND_OVER';
  engine.roundWinner = { index: 1 };
  director.tick(engine, 100);
  assert.equal(out.length, 1);
  engine.state = 'LOBBY';
  director.tick(engine, 200);
  engine.state = 'PLAYING';
  director.tick(engine, 300);
  engine.state = 'ROUND_OVER';
  director.tick(engine, 400);
  assert.equal(out.length, 2, 'yeni maç cooldown devralmaz');
});
