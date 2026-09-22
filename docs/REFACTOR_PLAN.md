# REFACTOR PLAN — Oyun Bileşenlerinin Tekrar Kullanılabilir Mimariye Taşınması

> Kullanıcı talebiyle oluşturuldu (AGENTS.md `*.md` yasağının açık istisnası).
> Yaşayan doküman: faz tamamlandıkça bu dosya işaretlenir. Nihai sorumluluk `docs/PROJECT_MAP.md`'dedir.

---

## Kısıtlar (bağlayıcı)

- **Davranış paritesi**: skor/cooldown/süre/protokol değişmez. Tek izinli davranış değişikliği: avatar kişiselleştirmesinin sahaya yansıması.
- Ağ: 8Hz host broadcast + 50ms throttle dokunulmaz; `handleRemoteInput` imzaları korunur.
- `main.js`/`gamepad.js`'e mode-if/else eklenmez; `docs/PROJECT_MAP.md` güncel tutulur.
- **Big-bang yasak**: her faz tek alan → motorlar tek tek → kopya sil → `npm run build` temiz → grep 0 hit → PROJECT_MAP satırı → sonraki faz.
- Doğrulama kapısı: `npm run build` (lint/test scripti yok). `else if (mode ===` main.js'de 0 kalmalı.

## Kapsam kararları (kullanıcı onayı)

1. **playerEntity — kademeli çıkarım:** `createPlayer` + `tickEffectTimers` + `clampToArena` yaygın; `resolveAABB` benzeyenlere; full `advancePlayer` sadece bomb/heist (+crown hook'lu, değilse kısmi). Pong/zone/collapse/snake/curve/tanks kendi gövdesinde kalır.
2. **Avatar — mevcut 10 site:** Saha avatarı olan 10 motor düzeltilir; PONG/TANKS/CURVE renk-kimliği olarak kalır.
3. **Lobi kartı — dahil:** 10 hand-rolled `renderStandardLobby` kopyası touchFlow fazında birleştirilir.

## Mevcut durum özeti (kanıt)

| Tekrar | Adet | Örnek |
|---|---|---|
| Klavye slot haritası | ~11 hareket + ~9 action kopyası | `archer.js:19`, `zone.js:1036`, bomb/heist/crown inline |
| getQuadrant ailesi | 12 kopya (4 aile) | `archer.js:338`, `BaseGame.js:227`, `curve.js:285` |
| ROUND_OVER skip gardı | 12 birebir + PONG `roundOverTimer` varyantı; laser'de yok | `archer.js:404` vs `game.js:227` |
| Hand-rolled lobi kartı | 10 motor; sadece 3'ü `renderStandardLobby` kullanıyor | `BaseGame.js:408` |
| resolveCollisions bomb↔heist | **~%99 identik** | `bomb.js:623` ↔ `heist.js:491` |
| push-out archer↔ninja↔clone | ~%98 / ~%90 | `archer.js:604`, `ninja.js:616`, `clone.js:172` |
| pointBlocked | 8+ site (pad varyantlı) | `archer.js:504`, bombAI/snakeAI inline |
| spawn/collect/efekt | 6 spawn + 9 collect kopyası | `bomb.js:522`, `curve.js:666` |
| drawBrutalAvatar opsiyonları | 10 saha site; archer/ninja hardcoded `headband` (lowercase → no-op), clone `slotIndex` unutmuş, expression lowercase normalizasyonu kırık (`angry`→FOCUS) | `archer.js:854`, `clone.js:808` |

**Uyumsuzlar (zor birleşmez, korunur):** PONG (1-D/edge, `getPlayerZoneAt` farklı geometri), ZONE+COLLAPSE (grid), SNAKE/CURVE (lethal, clamp yok), TANKS (axis-slide, hold-drive), CROWN ekstra katmanları (conveyor/bumper/peel).

---

## Faz 0 — Baseline (salt okunur) — [x]

- `npm run build` yeşil başlangıç; `grep "else if (mode ===" src/main.js` = 0.
- Silinecek sembol listesinin baseline'ı alınır.

## Faz 1 — `src/core/inputMaps.js` — [x] ✓

**Rapor (2026-09-22):**
- Taşınan: 13 motor + BaseGame (`archer, collapse, clone, ninja, laser, snake, curve, zone, bomb, heist, crown, tanks, game/pong, BaseGame`).
- Silinen kopyalar: 7 sabit harita (ARCHER/NINJA/COLLAPSE/LASER/CLONE/SNAKE/CURVE) + bomb/heist/crown ~20 satırlık inline hareket blokları + zone `keyboardVector` gövdesi + BaseGame `isPlayerActionKey`/`getPlayerKeyboardVector` gövdeleri + pong spin if/else + tanks literal MOVE/FIRE (~180 satır).
- Grep: eski sabit adlar `src/` içinde 0 (curve `CURVE_KEY_SLOTS` ters haritası `buildCodeToSlotMap`'ten türetilir, kopya değil); `keys['KeyA']` inline 0; `e.code === 'Space'` if/else 0; main.js `else if (mode ===` 0.
- Build: ✓ yeşil.
- Korunan davranış: tanks hold-drive, curve eklemeli steer + keyup reset, archer level-charge, snake boost, pong eksen filtresi, BaseGame alias süper-kümesi, zone `e.repeat` filtresi.
- Kalan: `getSlotKeys` türevi `KEY_HINTS` UI metni snake'te duruyor (döküman/metin, kod kopyası değil).

**Sözleşme:**

```js
export const STANDARD_KEY_SLOTS = [
  { u:'KeyW', d:'KeyS', l:'KeyA', r:'KeyD', action:'Space',      action2:'KeyE' },
  { u:'ArrowUp',…, action:'Enter', action2:'ShiftRight' },
  { u:'KeyI',…, action:'KeyO', action2:'KeyU' },
  { u:'KeyT',…, action:'KeyB', action2:'KeyV' },
];
export function getSlotKeys(i)            // standart {u,d,l,r,action,action2}
export function getSlotActionKeys(i)      // action alias listesi (BaseGame süper-kümesi)
export function keyboardVectorFrom(keys, i) // BaseGame.getPlayerKeyboardVector gövdesinin eve dönüşü
```

**Taşıma sırası:** archer → collapse → clone → ninja → snake (`boost`→action alias) → laser (`fire/dash`→`action/action2`) → zone (`keyboardVector` gövdesi) → bomb/heist/crown inline bloklar → pong (axis filtresi mapper'da kalır) → tanks (set literal `getSlotKeys` türetilir) → curve (`[left,right]` çiftleri `l/r`'den türetilir) → BaseGame (`getPlayerKeyboardVector`/`isPlayerActionKey` inputMaps'i çağırır; `bindStandardKeyboard` aynı kalır).

**Korunacak davranış:** tanks hold-drive+release-fire, curve eklemeli steer, archer level-held charge, snake boost yan etkisi, P1 alias süper-kümesi, `e.repeat` filtrelerinin mevcut hali.

**Sil:** `ARCHER_KEY_SLOTS`, `NINJA_KEY_SLOTS`, `COLLAPSE_KEY_SLOTS`, `LASER_KEY_SLOTS`, `CLONE_KEY_SLOTS_PAIRS`, `SNAKE_KEY_MAPS`, `CURVE_KEY_SLOTS*`, tanks `MOVE_KEYS/FIRE_KEYS`, zone `keyboardVector` gövdesi, bomb/heist/crown inline hareket blokları, tekrar eden `keyboardInput()` gövdeleri.

**Grep hedefi:** eski sabit adları `src/` içinde 0.

## Faz 2 — `src/core/touchFlow.js` + lobi kartı birleştirme — [x] ✓ (2026-09-22)

**Sözleşme:**

```js
export function getQuadrant(arena, x, y)   // tek matematik: 0 BL, 1 TL, 2 TR, 3 BR
export function lobbyQuadrantTap(game, touch, { onSeatChange } = {}) // LOBBY: quadrant → onLobbySeatTap/cycleSlotType + hook
export function roundOverSkipGuard(game, timerField = 'roundTransitionTimer') // ROUND_OVER && t>0 → t=0
export function lobbyCenterStartTap(game, touch, { radius = 65, minJoined = 2 } = {})
export function matchOverRestartTap(game, touch, { onRestart, radius = 75 } = {})
```

- BaseGame: `getCornerQuadrant` → `getQuadrant` delege; `handleRoundOverSkip(timerField)` (PONG `roundOverTimer` geçirir); `renderStandardLobby` → `rotateTop`, `onSeatChange` opsiyonları.
- 2b tamamlandı: archer/ninja/clone/collapse getQuadrant metodu silindi + LOBBY/MATCH_OVER/skip touchFlow'a taşındı; curve/snake/laser getCornerZone silindi; tanks getCornerZone **korundu** (merkez -1 PLAYING'de gerekli) ama skip+center-start taşındı, MATCH_OVER hafif LOBBY dönüşü korunup manuel bırakıldı; bomb/heist/crown/zone skip gardı taşındı (zone MATCH_OVER→resetMatch manuel); PONG skip gardı `roundOverTimer` alanıyla taşındı. Laser'e gard eklenmedi (yoktu).
- 2c **lobi kartı tamamlandı:** archer/ninja/clone/collapse/snake/laser/zone/curve/tanks hand-rolled blokları `renderStandardLobby`'ye taşındı (bomb/heist/crown zaten kullanıyordu). Farklar: `colors` (crown/heist/zone dışı hep X_COLORS), `rotateTop:true`, `onSeatChange` (players/tanks sync + `playJoin`; zone `syncLobbySeat`), laser `customControls` (harita pill), tanks `playerNames` (tank.name≠varsayılan), curve `colors` players'tan. curve/tanks köşe HUD döngüsü `if (LOBBY) return` ile erken çıkar, koltuklar renderLobbyUI'ye geçti. Dead import'lar (renderLobbySeatCard/getStandardSeatRects/getSeatColorDotRect/getLocalSeatColors) 9 motordan silindi.
- **İstisna (belgelendi): PONG** hand-rolled lobi kartı + `getPlayerZoneAt`/`getStandardSeatSize`/rotate kartları korunur (PROJECT_MAP madde 2 touchFlow notu).
- Kalıntı grep: games içinde `renderLobbySeatCard(` = yalnızca PONG; `renderStandardLobby(` = 12 motor; build yeşil.
- PROJECT_MAP: src/core dosya listesine touchFlow girişi + 2c notu eklendi.

## Faz 3 — `src/core/physics2d.js` — [ ]

**Sözleşme:**

```js
export function clampToArena(p, r, arena, { zeroVelocity = false })
export function resolveAABB(p, obs, r, opts)   // mode: 'slide' | 'project' | 'minEdge'; opts: {velScale, eject, onPush}
export function pointBlocked(x, y, rects, pad = 0)
export function updateMovers(rects, dt, style) // 'sine' (archer) | 'pingpong' (laser)
export function distToSegmentSquared(px,py, ax,ay,bx,by)
```

**Taşıma sırası:** bomb+heist tek `resolveCollisions` → `resolveAABB` sarmalayıcı → archer/ninja/clone min-edge + `clampToArena` → laser `collideObstacles` (project+shallowest) + pingpong movers → crown **sadece** pillar iskeleti (velScale=1.4 + slowRing; yoksa yerel) → tanks overlap bool → snake/curve `distToSegmentSquared` → pointBlocked 8+ site (AI dahil).

**Korunur:** pong chamfer/goal, zone/collapse grid, snake/curve lethal semantics, tanks axis-slide, crown bumper/conveyor/peel/hazard, lantern bounce.

## Faz 4 — `src/core/pickupSystem.js` — [ ]

**Sözleşme:**

```js
export function spawnPickup(game, { types, max, interval, size, life, place })
export function collectPickups(game, player, { radiusOf })
export const EFFECTS = { TURBO: (game,p,item)=>{}, … } // kayıt defteri
export function tickPickupTimers(game, dt)
```

- **Kritik:** aynı string farklı davranış — TURBO süresi/hızı motordan (`game.tuning`), SLIP: bomb/crown→ink, archer→self. Davranış değişmez.
- Taşıma: bomb → crown → archer → laser → curve → collapse → tanks (`crates` adapter) → snake (collect/dispatch; spawn yerel) → heist loot **taşınmaz** (skor ganimeti).
- PICKUP_META eksikleri: `HEAL`, `FAST`, `SUPER_JUMP`, `REPAIR_TILES`, `BLAST_WAVE`, `APPLE`.
- Collapse `life` ölü alanı: dokunulmaz, PROJECT_MAP'a not.

## Faz 5 — `arenaKit.js` genişletme: `buildLayout(name, arena)` — [ ]

```js
export function buildLayout(name, arena) // → { rects, movers?, extras? }
```

- PILLARS/CROSS/SCATTER archer'dan (mover `base+amp+speed+phase` korunur).
- Bomb `MAP_PRESETS` + `buildMapPillars` aynı arayüz (`Math.round` preset içinde).
- Laser `klasik/siginak/koridor` (+pingpong `vx/vy/min/max`).
- Ninja/clone statik builder (opsiyonel).
- Tanks normalized→abs scale builder içinde; crown sadece pillar preset.
- Çizim taşıması: tanks/laser/snake/curve/collapse → `drawObstacle`/`drawPickup` (PROJECT_MAP madde 17 açık işi kapanır).

## Faz 6 — `src/core/playerEntity.js` (kademeli) — [ ]

```js
export function createPlayer(i, spawn, opts)
export function tickEffectTimers(p, dt)  // turbo/stun/slip/spawnProt/dashCd/… (alan adları korunur)
export function advancePlayer(p, dt, arena, obstacles, opts) // sadece vx/vy: clamp + resolveAABB + timers
```

- `advancePlayer`: bomb, heist; crown hook'lu (`preIntegrate`/`postClamp`), değilse kısmi.
- Steer ailesi (archer/ninja/clone/collapse/laser): `createPlayer` + `tickEffectTimers` + clamp/resolve çağrıları; integrate yerel.
- Angle/grid (curve/snake/tanks/zone/pong): sadece `createPlayer`; update gövdesi dokunulmaz.
- SpawnProt alan adları korunur (archer `spawnProt`, laser `invulnTimer`, zone `spawnProtect`).
- `existing?.name` isim koruma deseni aynen kalır.

## Faz 7 — `src/core/avatarInGame.js` — [ ]

```js
export function drawGameAvatar(ctx, player, opts) {
  // kaynak: getSlotAvatar(player.index) ?? getAvatarProfile()
  // accessory/pattern profilden; durumsal expression normalize (angry→ANGRY)
  // opts.gameAccessory: crown → 'MINI_CROWN' (override kuralı belgelenir)
  // slotIndex + isBot/slotType her zaman pass; color = player.color üstün
}
```

- 10 site taşınır: archer/ninja `headband` silinir; crown override; clone **`slotIndex` eklenir**; collapse/snake LOD r<12 korunur; bomb/heist/laser/zone.
- PONG/TANKS/CURVE: avatar eklenmez.
- `characterRenderer` expression aliasları (`'angry'/'wink'`) genişletilir — izinli davranış değişikliği parçası.
- OVERRIDE kuralı PROJECT_MAP madde 16/17 altında belgelenir.

---

## Faz sonu raporu şablonu

`Taşınan dosyalar · silinen kopya satır ~adedi · grep sonucu (eski sembol=0) · build durumu · kalan dağıklık/sonraki faza not`

## Nihai doğrulama

1. `npm run build` temiz; main.js'de `else if (mode ===` = 0.
2. Grep süpürmesi: eski semboller `src/` içinde 0.
3. LOCAL manuel prova: (a) ready→lobi flag, (b) koltuk takası isim, (c) bot ekle/çıkar, (d) power-up his, (e) engel çarpışma his, (f) avatar aksesuarı sahada görünüyor.
4. Ağ provası: 1 oyun JOYSTICK_ACTION + hold-release (archer charge önerilir).
5. PROJECT_MAP: dosya listesi + madde 17 + motor tablo notları.

## Risk notları

- Crown pillar opts (velScale 1.4 + slowRing): parity'nin en kırılgan yeri; hazır değilse crown yerel kalır.
- Tanks center dead-zone + hold-drive; curve keyup steer reset: dokunulmaz davranış.
- `slotManager.js` içindeki `else if (currentMode ===` zincirleri AGENTS.md madde 9 kapsamında bilinçli — girilmez.
- AGENTS.md GAME_ORDER 7 yazıyor, registry 13 — dokunulmaz (yalnız PROJECT_MAP esas).

---

## İlerleme günlüğü

| Faz | Durum | Tarih | Not |
|---|---|---|---|
| 0 Baseline | tamamlandı | 2026-09-22 | build yeşil; `else if (mode ===` main.js = 0 |
| 1 inputMaps | tamamlandı | 2026-09-22 | 13 motor + BaseGame taşındı; eski sembol grep=0; build yeşil |
| 2 touchFlow | tamamlandı | 2026-09-22 | touchFlow.js + BaseGame helper'ları; 13 motor skip/quadrant taşıdı; 12 motor lobi kartı renderStandardLobby'ye geçti; kalıntı grep=0 (PONG yalnız); build yeşil |
| 3 physics2d | | | |
| 4 pickupSystem | | | |
| 5 arenaKit layout | | | |
| 6 playerEntity | | | |
| 7 avatarInGame | | | |
