/**
 * Faz 0 ölçümü — gövde büyüklükleri haritası.
 *
 * AMAÇ: "15 oyunun gövde sayısı 3-4 sınıfa indirilebilir mi" sorusunu
 * TAHMİNLE değil ÖLÇÜMLEYE cevaplamak. Girdi: her motoru gerçekten
 * çalıştırıp runtime değerlerini okumak.
 *
 * Neden kaynak taraması değil: bu projede kaynak taraması üç kez yanlış
 * cevap verdi — `pxConstants` regex'i tek haneli 9.5'i kaçırdı, "45 çağrı"
 * sayımı import satırlarını saydı, `buildLayout` çağrı listesi eksikti.
 * Burada motor vite-SSR ile yüklenip `resize` + `startNewMatch` sonrası
 * okunuyor; okunan değer o karede gerçekten kullanılan değerdir.
 *
 * Bu bir ARAÇTIR, motor kodunu değiştirmez. Tek satırlık çıktı:
 *   node scripts/measure-bodies.mjs            (tablo)
 *   node scripts/measure-bodies.mjs --json     (makine-okunur)
 */

import { createServer } from 'vite';
import { buildLayout } from '../src/core/arenaKit.js';
import { discReachability, narrowestPassage } from '../tests/helpers/passability.mjs';

const DESIGN_SHORT = 952;
const VIEWPORTS = { desktop: [1920, 1080], phone: [852, 393] };

const noop = () => {};
const gradient = { addColorStop: noop };

// Motorlar tarayıcı global'lerine dokunuyor (`window.innerWidth`,
// `document.getElementById`, AudioContext…). Testlerdeki gibi asgari stub
// gerekli; yoksa `window is not defined` ile hiçbir motor ölçülemiyor.
globalThis.window = {
  innerWidth: 1920,
  innerHeight: 1080,
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
  createElement: () => ({ width: 0, height: 0, getContext: () => stubContext }),
};

const stubContext = new Proxy({
  measureText: () => ({ width: 0 }),
  createLinearGradient: () => gradient,
  createRadialGradient: () => gradient,
}, {
  get: (t, k) => (k in t ? t[k] : noop),
  set: (t, k, v) => { t[k] = v; return true; },
});

/** Oyuncu gövdesi motora göre farklı yerde taşınır; tek bir okuyucu dener. */
function readPlayer(game) {
  const p = game.players?.[0];
  if (p && Number.isFinite(p.radius)) return { radius: p.radius, source: 'players[0].radius' };
  const tank = game.tanks?.[0];
  if (tank && Number.isFinite(tank.size)) return { radius: tank.size, source: 'tanks[0].size' };
  if (game.ball && Number.isFinite(game.ball.radius)) {
    return { radius: game.ball.radius, source: 'ball.radius' };
  }
  return { radius: null, source: null };
}

/** Oyundaki en büyük "öteki" gövde: düşman, tank, taç, hedef. */
function readLargestOther(game) {
  const enemies = game.enemies || [];
  if (enemies.length) {
    const r = Math.max(...enemies.map((e) => e.radius || 0));
    if (r > 0) return { radius: r, kind: 'enemy' };
  }
  const tanks = game.tanks || [];
  if (tanks.length > 1) {
    const r = Math.max(...tanks.slice(1).map((t) => t.size || 0));
    if (r > 0) return { radius: r, kind: 'tank' };
  }
  if (game.crown && Number.isFinite(game.crown.radius)) {
    return { radius: game.crown.radius, kind: 'crown' };
  }
  return { radius: null, kind: null };
}

/**
 * Sahadaki en büyük engel/aktör — yarıçap değil DİKDÖRTGEN olan engeller de
 * var (`obstacles`: w/h). İlk ölçüm yalnız `radius`/`size` bakıyordu ve
 * neredeyse her oyunda 0 döndürdü; bu bir ölçüm hatasıydı, bulgu değil.
 */
function readSceneMax(game) {
  const pools = [
    game.obstacles, game.pillars, game.pickups, game.crates, game.bumpers,
    game.movingHazards, game.speedPads, game.bananaPeels, game.inkPuddles,
    game.conveyors, game.checkpoints, game.npcClones, game.rooms, game.obstacleSpinners,
  ];
  let max = 0;
  for (const pool of pools) {
    if (!Array.isArray(pool)) continue;
    for (const o of pool) {
      if (Number.isFinite(o.radius)) max = Math.max(max, o.radius);
      if (Number.isFinite(o.size)) max = Math.max(max, o.size);
      if (Number.isFinite(o.w) && Number.isFinite(o.h)) {
        max = Math.max(max, Math.max(o.w, o.h) / 2);
      }
      if (Number.isFinite(o.length)) max = Math.max(max, o.length / 2);
    }
  }
  return max;
}

/**
 * Oyuncunun hızı. Bazı motorlar hızı `startNewMatch` sonrası girdi/bekleme
 * döngüsünde doldurur; yoksa `null` döner ve tablo `—` basar. Sıfırı hız
 * sanmak ölçümü yanlış gösterirdi.
 */
function playerSpeed(game) {
  const p = game.players?.[0];
  if (p && Number.isFinite(p.speed) && p.speed > 0) return p.speed;
  if (game.tanks?.[0] && Number.isFinite(game.tanks[0].speed) && game.tanks[0].speed > 0) {
    return game.tanks[0].speed;
  }
  if (game.ball && Number.isFinite(game.ball.speed) && game.ball.speed > 0) {
    return game.ball.speed;
  }
  return null;
}

/**
 * Koridor geçilebilirliği — yalnız `buildLayout` kullanan motorlarda anlamlı
 * (HORDE / ARCHER / BOMB). Diğerleri kendi haritasını kurar ve kendi
 * geometrisinden sorumludur; onlar için bu ölçüm `null` döner ve `—` basılır.
 * Uydurma sayı üretmektense ölçülemeyeni ölçülemez bırakmak daha doğru.
 */
async function measureCorridor(cartridge, GameClass, stubCtx) {
  try {
    const [w, h] = VIEWPORTS.desktop;
    const canvas = { width: w, height: h, getContext: () => stubCtx };
    const g = new GameClass(canvas);
    g.resize(w, h);
    g.slotTypes = ['human', 'human', 'bot', 'empty'];
    const init = g.initPlayers || g.initTanks || g.initSnakes || g.initZones;
    if (init) init.call(g);
    g.startNewMatch();
    const nodes = g.obstacles || g.pillars;
    if (!Array.isArray(nodes) || !nodes.length) return null;
    const me = readPlayer(g);
    if (!me.radius) return null;
    const narrowest = narrowestPassage(g.arena, nodes);
    const reach = discReachability(g.arena, nodes, me.radius);
    return {
      narrowest: Number.isFinite(narrowest) ? +narrowest.toFixed(0) : null,
      playerDiameter: +(me.radius * 2).toFixed(0),
      passable: narrowest >= me.radius * 2 - 0.5,
      reachable: reach.reachable,
      count: nodes.length,
    };
  } catch {
    return null;
  }
}

async function measure() {
  const server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
  });

  const { CARTRIDGES, GAME_ORDER } = await server.ssrLoadModule('/src/core/engineRegistry.js');
  const { computePlayfield } = await server.ssrLoadModule('/src/core/playfield.js');

  const rows = [];
  for (const mode of GAME_ORDER) {
    const cartridge = CARTRIDGES[mode];
    const GameClass = await cartridge.load();
    const row = { mode, errors: [] };

    for (const [label, [w, h]] of Object.entries(VIEWPORTS)) {
      const canvas = { width: w, height: h, getContext: () => stubContext };
      let game;
      try {
        game = new GameClass(canvas);
        game.resize(w, h);
        game.slotTypes = ['human', 'human', 'bot', 'empty'];
        const init = game.initPlayers || game.initTanks || game.initSnakes || game.initZones;
        if (init) init.call(game);
        game.startNewMatch();
        game.lastTime = 1000;
        // Girdi ver: oyuncu kontrollü yarışçılar (PONG topu, RACE aracı,
        // ZONE/LASER/SNAKE gövdesi) girdi olmadan HIZLANMAZ. 1.5 saniye
        // sürülür: ivmelenen motorlarda 0.32s yeterli değildi, RACE ölçümü
        // "hızlanmanın başındaki" değeri veriyordu (11.7s) — gerçek tempo değil.
        const FRAMES = 94; // ~1.5s @60fps
        for (let i = 0; i < FRAMES; i += 1) {
          game.handleRemoteInput(0, { action: 'JOYSTICK_MOVE', dx: 0.8, dy: 0.2, angle: 0, force: 1 });
          if (typeof game.update === 'function') game.update(1000 + (i + 1) * 16);
        }
      } catch (err) {
        row.errors.push(`${label}: ${err.message}`);
        continue;
      }

      const arena = game.arena;
      const short = arena.size;
      const unit = short / DESIGN_SHORT;
      const me = readPlayer(game);
      const other = readLargestOther(game);
      const speed = playerSpeed(game);

      row[label] = {
        // Preset ADI kaynaktan kazımak yerine kenarlıkların RUNTIME değeri
        // okunuyor: preset'in saha üzerindeki etkisi budur.
        insets: arena.insets ? Object.values(arena.insets).map((v) => +v.toFixed(0)).join('/') : null,
        short: +short.toFixed(1),
        unit: +unit.toFixed(3),
        playerPx: me.radius != null ? +me.radius.toFixed(2) : null,
        playerDesign: me.radius != null ? +(me.radius / unit).toFixed(1) : null,
        playerPct: me.radius != null ? +((me.radius * 2 / short) * 100).toFixed(2) : null,
        playerSource: me.source,
        otherPx: other.radius != null ? +other.radius.toFixed(2) : null,
        otherDesign: other.radius != null ? +(other.radius / unit).toFixed(1) : null,
        otherKind: other.kind,
        ratio: me.radius && other.radius ? +(me.radius / other.radius).toFixed(2) : null,
        sceneMax: +(readSceneMax(game) / unit).toFixed(1),
        speedDesign: speed != null ? +(speed / unit).toFixed(0) : null,
        crossTime: speed ? +((short / speed)).toFixed(2) : null,
        obstacles: (game.obstacles || game.pillars || []).length || null,
      };
    }

    row.corridor = await measureCorridor(cartridge, GameClass, stubContext);
    rows.push(row);
  }

  await server.close();
  return rows;
}

const rows = await measure();
const asJson = process.argv.includes('--json');
const d = (r, k) => (r.desktop?.[k] ?? r.phone?.[k] ?? null);
const f = (v, w2 = 5, p = 1) => (v == null ? '—'.padStart(w2) : v.toFixed(p).padStart(w2));

if (asJson) {
  console.log(JSON.stringify(rows, null, 1));
} else {
  const head = 'OYUN'.padEnd(9) + 'gövde'.padStart(6) + 'oran%'.padStart(7)
    + 'enBüyük'.padStart(9) + 'o/ö'.padStart(6) + 'sahadaki'.padStart(9)
    + 'geçişMasa'.padStart(10) + 'geçişTel'.padStart(9) + 'oran'.padStart(6)
    + 'koridor'.padStart(10) + 'geçilir';
  console.log(head);
  console.log('-'.repeat(head.length + 8));
  for (const r of rows) {
    const c = r.corridor;
    const corr = c ? `${f(c.narrowest, 0)}/${f(c.playerDiameter, 0)}` : '—';
    const pass = c ? (c.passable && c.reachable ? 'evet' : 'HAYIR') : '—';
    // Cihaz bağımsızlık kanıtı: saha kısa kenarı ÷ hız her iki cihazda
    // AYNI olmalı. Sütunlar ayrı ayrı değil, FARK olarak da gösteriliyor.
    const tD = r.desktop?.crossTime ?? null;
    const tP = r.phone?.crossTime ?? null;
    const drift = tD != null && tP != null ? Math.abs(tD - tP) / tD : null;
    console.log(
      r.mode.padEnd(9)
      + f(d(r, 'playerDesign'), 6, 0)
      + f(d(r, 'playerPct'), 7, 2)
      + f(d(r, 'otherDesign'), 9, 0)
      + f(d(r, 'ratio'), 6, 2)
      + f(d(r, 'sceneMax'), 9, 0)
      + f(tD, 10, 2)
      + f(tP, 9, 2)
      + f(drift == null ? null : drift * 100, 6, 2)
      + corr.padStart(10)
      + '  ' + pass,
    );
    for (const e of r.errors) console.log(`  ! ${r.mode}: ${e}`);
  }
  console.log('\ngeçişMasa/Tel = saha kısa kenarı ÷ oyuncu hızı (saniye). `oran` sütunu '
    + 'ikisi arasındaki FARKın yüzdesi: 0.00 ise geçiş süresi cihazdan bağımsız '
    + 'demektir. Diğer sütunlar: gövde=tasarım px · oran%=gövde çapı/saha kısa kenar · '
    + 'enBüyük=oyundaki en büyük öteki gövde · o/ö=oyuncu/oBüyük · sahadaki=en büyük engel · '
    + 'koridor=en dar geçiş/oyuncu çapı (yalnız buildLayout kullananlarda).');
  console.log('`—` = o ölçüm o oyun için ölçülemedi (motor gövdeyi başka yerde '
    + 'taşıyor / hız girdi döngüsünde doluyor). Uydurma sayı basılmadı.');
}
