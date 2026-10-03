// SUMO — motor sözleşmesi ve dövüş kuralları.
//
// Bu mod koleksiyona iki şeyi ilk kez getiriyor: (1) kazanma koşulu "rakibi
// sahadan düşürmek" (can yok), (2) birbirini yenen üç fiil (ÇARP / TUT /
// KAPKALA→FIRLAT). Testler tam olarak o taş-kağıt-makas zincirini ve halka
// durum makinesini ölçer; yoksa mod sessizce "itiş kakış"a dönebilir.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const noop = () => {};
const gradient = { addColorStop: noop };
const context = new Proxy({
  measureText: () => ({ width: 0 }),
  createLinearGradient: () => gradient,
  createRadialGradient: () => gradient,
}, {
  get(target, key) {
    return key in target ? target[key] : noop;
  },
  set(target, key, value) {
    target[key] = value;
    return true;
  },
});

const canvas = { width: 900, height: 600, getContext: () => context };
const STEP = 1000 / 60;

let server;
let SumoGame;
let CARTRIDGES;
let GAME_ORDER;

before(async () => {
  globalThis.window = {
    innerWidth: 900,
    innerHeight: 600,
    addEventListener: noop,
    removeEventListener: noop,
    AudioContext: null,
    webkitAudioContext: null,
    matchMedia: () => ({ matches: false }),
  };
  globalThis.document = {
    activeElement: null,
    body: {},
    addEventListener: noop,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  };
  server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
  });
  ({ SumoGame } = await server.ssrLoadModule('/src/games/sumo.js'));
  ({ CARTRIDGES, GAME_ORDER } = await server.ssrLoadModule('/src/core/engineRegistry.js'));
});

after(async () => {
  await server?.close();
});

function setup(slotTypes = ['human', 'human', 'human', 'human']) {
  const game = new SumoGame(canvas);
  game.resize(900, 600);
  game.slotTypes = slotTypes;
  game.initPlayers();
  game.startNewMatch();
  game.lastTime = 1000;
  return game;
}

function step(game, seconds = 1 / 60) {
  game.update(game.lastTime + seconds * 1000);
}

function run(game, seconds) {
  const steps = Math.max(1, Math.round(seconds * 60));
  for (let i = 0; i < steps; i += 1) {
    step(game);
    if (game.state !== 'PLAYING') return;
  }
}

/** İki gövdeyi sabit hızlarla birbirine bakar. */
function place(game, aIndex, bIndex, gap = 1) {
  const a = game.players[aIndex];
  const b = game.players[bIndex];
  const r = game.ring;
  // Temas payı: çarpış menzili kadar yakına, yoksa hamle yetişmez.
  a.x = r.cx - (a.radius + b.radius + 4) * gap;
  a.y = r.cy;
  b.x = r.cx + (a.radius + b.radius + 4) * gap;
  b.y = r.cy;
  a.vx = 0;
  a.vy = 0;
  b.vx = 0;
  b.vy = 0;
  a.angle = 0;
  b.angle = Math.PI;
  a.invuln = 0;
  b.invuln = 0;
  return { a, b };
}

test('SUMO registry + world packet sözleşmesine uyar', () => {
  assert.ok(GAME_ORDER.includes('SUMO'), 'GAME_ORDER kaydı');
  const cartridge = CARTRIDGES.SUMO;
  assert.ok(cartridge?.schema && cartridge?.worldView && typeof cartridge.load === 'function');
  assert.equal(cartridge.tacticalHintKey, 'hint.sumo');

  const game = setup();
  const frame = game.createWorldPacket();
  assert.equal(frame.mode, 'SUMO');
  assert.equal(frame.players.length, 4);
  for (const p of frame.players) {
    assert.ok(Number.isFinite(p.radius) && p.radius > 0, 'yarıçap paketlenir');
    assert.ok(Number.isFinite(p.mass) && p.mass > 0, 'kütle paketlenir');
    assert.equal(typeof p.brace, 'boolean');
  }
  assert.equal(frame.ring.length, 3);
  assert.ok(frame.ring[2] > 0);
});

test('halkanın dışına çıkan düşer: karşı takım puan alır, halka küçülür, geri doğar', () => {
  const game = setup();
  const p = game.players[0];
  const before = game.teamTakedowns[1];
  const ringBefore = game.ring.r;

  p.x = game.ring.cx + game.ring.r * 1.2;
  p.y = game.ring.cy;
  p.invuln = 0;
  run(game, 0.2);

  assert.equal(p.isAlive, false, 'düşen gövde halkanın dışındayken canlı sayılmaz');
  assert.equal(game.teamTakedowns[1], before + 1, 'karşı takım puanı alır');
  assert.ok(game.ring.r < ringBefore, 'her düşmede platform küçülür');

  run(game, 4);
  assert.equal(p.isAlive, true, 'ceza süresi bitince kendi takımının tarafında döner');
  assert.ok(Math.hypot(p.x - game.ring.cx, p.y - game.ring.cy) < game.ring.r, 'dönüş halka içinde');
});

test('ÇARP hareket halindeki rakibi savuşturur, TUT çarpmayı yutar', () => {
  const game = setup();

  // 1) serbest rakip: büyük savuşturma
  const open = place(game, 0, 1);
  open.a.chargeCooldown = 0;
  game.attemptCharge(open.a);
  run(game, 0.25);
  const knocked = Math.hypot(open.b.vx, open.b.vy);
  assert.ok(knocked > game.scale.moveSpeed * 0.5, `serbest rakip savrulmalı (${knocked})`);

  // 2) köklenmiş rakip: aynı çarpış çok daha az iter, saldıran seker
  const game2 = setup();
  const braced = place(game2, 0, 1);
  // `braceHeld` her kare girdiden yeniden okunur: tuşu basılı tutar gibi yaz.
  game2.keys.Period = true;
  braced.a.chargeCooldown = 0;
  game2.attemptCharge(braced.a);
  run(game2, 0.25);
  const blocked = Math.hypot(braced.b.vx, braced.b.vy);
  assert.ok(blocked < knocked, `TUT, ÇARP'ı yemeli (${blocked} < ${knocked})`);
});

test('KAPKALA köklenmiş rakibi kaldırır; ÇARP onu fırlatır; çalkalayan kaçar', () => {
  const game = setup();
  const { a, b } = place(game, 0, 1);
  game.keys.Period = true;
  a.chargeCooldown = 0;
  // Üzerine yürü: kavrama temasla olur (girdi her karede tuştan okunur).
  game.keys.KeyD = true;
  run(game, 0.8);

  assert.equal(a.grabbing, b.index, 'köklenmiş rakip kaldırılmalı');
  assert.equal(b.grabbedBy, a.index);

  a.angle = 0;
  a.chargeCooldown = 0;
  game.attemptCharge(a);
  step(game);
  assert.equal(a.grabbing, -1, 'fırlatma kavramayı bitirir');
  assert.equal(b.grabbedBy, -1);
  assert.ok(b.vx > game.scale.moveSpeed, 'fırlatılan gövde hızlı gitmeli');

  // Kaçış: kavranan oyuncu çalkalarsa kendiliğinden çıkar.
  const game2 = setup();
  const pair = place(game2, 0, 1);
  game2.keys.Period = true;
  game2.keys.KeyD = true;
  pair.a.chargeCooldown = 0;
  run(game2, 0.8);
  assert.equal(pair.a.grabbing, pair.b.index);
  game2.keys.KeyD = false;
  // Çalkalama: kavranan rakip ok tuşlarıyla sağa sola koşar.
  for (let i = 0; i < 150; i += 1) {
    game2.keys.ArrowLeft = i % 2 === 0;
    game2.keys.ArrowRight = i % 2 === 1;
    game2.keys.ArrowUp = i % 4 < 2;
    game2.keys.ArrowDown = i % 4 >= 2;
    step(game2);
    if (pair.b.grabbedBy < 0) break;
  }
  assert.equal(pair.b.grabbedBy, -1, 'çalkalama kavramayı kırar');
  assert.equal(pair.a.grabbing, -1);
});

test('raunt çok düşüren takıma yazılır; üç raunt alan maçı alır', () => {
  const game = setup();
  // Düşürme döngüsü: düşen gövde ceza süresinin sonunda geri doğar, o yüzden
  // her turda ancak yeniden halka dışına bırakılabilir.
  const dropAgain = (index, times) => {
    for (let i = 0; i < times; i += 1) {
      const victim = game.players[index];
      let guard = 0;
      while ((!victim.isAlive || victim.invuln > 0) && guard < 400 && game.state === 'PLAYING') {
        step(game);
        guard += 1;
      }
      victim.invuln = 0;
      victim.x = game.ring.cx + game.ring.r * 1.3;
      victim.y = game.ring.cy;
      step(game);
    }
  };
  dropAgain(1, 5);
  assert.ok(game.teamTakedowns[0] >= 5, `rakip takım düşürme sayacı (${game.teamTakedowns[0]})`);
  assert.equal(game.state, 'ROUND_OVER');
  assert.equal(game.scores[0] + game.scores[2], 2, 'kazanan takımın iki üyesi de raunt puanını alır');

  for (let round = 0; round < 2; round += 1) {
    game.startRound();
    dropAgain(1, 5);
  }
  assert.equal(game.state, 'MATCH_OVER', '3 raunt alan maç biter');
  assert.ok(game.matchWinner && game.matchWinner.team === 0);
});

test('uzak girdi yalnız fiil kapılarından girer, yön dışı paket işlenmez', () => {
  const game = setup(['human', 'human', 'empty', 'empty']);
  const p = game.players[0];
  p.moveX = 0;
  p.moveY = 0;

  game.handleRemoteInput(0, { action: 'JOYSTICK_MOVE', dx: 1, dy: 0, angle: 0, force: 0.9 });
  assert.ok(Math.abs(p.moveX) > 0.5, 'joystick yönü yazılır');
  assert.equal(p.angle, 0);

  p.chargeCooldown = 0;
  game.handleRemoteInput(0, { action: 'SUMO_CHARGE' });
  assert.ok(p.chargeTimer > 0, 'ÇARP aksiyonu hamleyi başlatır');

  game.handleRemoteInput(0, { action: 'SUMO_BRACE' });
  assert.equal(p.braceHeld, true, 'TUT basılı');
  game.handleRemoteInput(0, { action: 'SUMO_BRACE_RELEASE' });
  assert.equal(p.braceHeld, false, 'TUT bırakıldı');

  const before = { x: p.x, y: p.y, charge: p.chargeCooldown };
  game.handleRemoteInput(0, { action: 'NOPE_WHAT' });
  assert.equal(p.x, before.x);
  assert.equal(p.chargeCooldown, before.charge);
});

test('boş koltuklar botla dolar ve botlar halkanın içinde kalır', () => {
  const game = setup(['human', 'bot_normal', 'bot_god', 'empty']);
  run(game, 12);
  for (const p of game.players) {
    if (!p.isJoined) continue;
    if (p.fallTimer > 0 || p.respawnTimer > 0) continue;
    const dist = Math.hypot(p.x - game.ring.cx, p.y - game.ring.cy);
    assert.ok(dist <= game.ring.r * 1.35, `bot kenar güvenliği (${p.index}: ${Math.round(dist)}/${Math.round(game.ring.r)})`);
  }
  assert.ok(game.players[1].slotType === 'bot_normal');
});
