# Task List — Üretim Seviyesine Refactor

## Faz A+B — Doğrulama kapısı + TV_CONSOLE state-sync (2026-09-29)

Mimari taramada bulunan iki kritik bulgu. Tespit: `npm run check` yalnız lint + tsc
koşuyordu; 445 test ve 15 oyunluk kalite kapısı **hiçbir yerde otomatik koşmuyordu**,
bu yüzden iki kırmızı test/ihlal fark edilmeden birikmişti.

- [x] A.1 `npm run check` artık zincirli: tsc + undef + tokens + rules + `npm test` + `npm run health` (453 test, exit 0)
- [x] A.2 `.github/workflows/ci.yml` — push/PR'da `check` + `build` + `test:e2e` (elle koşulmaz)
- [x] A.3 CLONE bot kapı yönlendirmesi düzeltildi: `patrolTask` farklı odaya geçerken
      botun **kendi** odasının kapısını seçiyordu; merkezdeki görevler (statue/fountain →
      `courtyard`) için o kapı hiçbir odaya çıkmıyor, bot kapıda salınıyordu. Kapı artık
      daima **hedef** odanın kapısı, merkez için `center`; eşik `CLONE_DOOR_REACHED=40`.
      100 koşu × 2 bot: 0 yıldız alan koşu 0/100 (eskiden 5/60). Test bütçesi 10 sn → 20 sn.
- [x] A.4 Health 5 ihlali kapatıldı: HORDE I6 (mermi konturu `u` ile), CROWN I6 (SERSEM!
      font/kontur ölçekli), CROWN I4 + LASER I4 (view fallback 43/19 px → motorla aynı
      sabit, `worldCore.js` + `worldPacketRadius.test.mjs` kilidi), LASER I3 (klasik harita
      koridoru 43 px < görsel çap 60 px; kollar arası boşluk artık oyuncu çapından türetiliyor).
      Sonuç **15/15, 0 ihlal**. `qualityAuditors.resolveConst` paylaşılan sabitleri de çözüyor.
- [x] B.1 `network.js broadcastHostState` → `{ type:'HOST_STATE_SYNC', ...state }` (düz).
      Önceden `{ type, state:{…}}` kova şekli gönderiyordu; kumanda en-üst-seviye alanları
      okuduğu için **TV_CONSOLE'da** faz uzlaşması, skor şeridi, geri sayım, cooldown
      senkronu ve durum satırı sessizce ölüydü.
- [x] B.2 `core/networkProtocol.normalizeStateSync` tek düzleştirme kapısı (her iki istemci +
      sunucu çağırır): yeni host + eski sunucu, eski host + yeni kumanda/sunucu da çalışır.
- [x] B.3 `roomManager.handleHostBroadcast` düz zarfı yansıtıyor → sunucu `room.gameMode`
      da WS yolunda güncelleniyor (önceden kova içinde kalıyordu).
- [x] B.4 `gamepad.showCountdown(t)` → `showCountdown(seconds)`: parametre i18n `t`'sini
      gölgeliyordu, `seconds === 0` halinde `t('pad.go')` bir sayıyı çağırıp TypeError
      fırlatıyordu. B bu yolu TV_CONSOLE'da erişilebilir kıldığı için B kapsamında kapandı.
- [x] B.5 Kilit testler: `relayProbes` prova 4-6 (düz ulaşım / eski host / iki transport
      eşitliği), `networkProtocol` 3 normalize testi, `worldPacketRadius` sabit eşitliği,
      `botBehavior` kapı-rozeti testi (12 koşu, hepsi puan almalı).

## Faz 0 (yeni) — Raunt/maç akışı tek sahibi ✅ (2026-09-30)

Oyun akışı taraması: 15 oyunun **üç ayrı** raunt modeli vardı — 13 oyun
`ROUND_OVER` + elle seçilmiş boşluk (1.8–2.8 s), PONG `ROUND_PAUSE` (0.9 s ölü
top), HORDE `ROUND_PAUSE` **armory** (tek iyi tasarım, 15 oyundan 1'inde).
Her motor aynı 6 satırlık geçiş bloğunu kopyalamış, `roundLifecycle` yalnız
`beginDrawRound`/`hasMatchResult` ile BERABERE dalına sahipti — kazanma dalı
hiçbir yerde ortaklaşmamıştı.

- [x] 0.5 `core/roundLifecycle` tek sahibe dönüştü: `ROUND_GAP` tempo tablosu
      (WIN 2.6 / DRAW 1.6 / MATCH_END 2.6), `beginRound` + `beginDrawRound` +
      `endMatch` üreticileri, `tickRoundFlow` tek geçiş bloğu.
- [x] 0.6 `setRoundTimer` + `roundTimerField`: PONG `roundOverTimer`, geri kalanı
      `roundTransitionTimer` — alan adı tek kapıdan çözülür (motor içine yazılmaz).
- [x] 0.7 13 motorun kopyası silindi; her `update()` artık
      `if (tickRoundFlow(this, dt)) return;` yazıyor. RACE'in `RACE_TUNING.roundTransition`
      ve 8 farklı sabit süre silindi.
- [x] 0.8 **Maç sonu artık ANINDA değil**: son raunttan sonra da maç sonu boşluğu
      var, boşluk bitince MATCH_OVER. Önce 8 oyun `MATCH_OVER`'a doğrudan atlıyordu
      (kazanan bant görünmeden kart açılıyordu), 5 oyunda 1.8–2.0 s, 2 oyunda
      hiç boşluk yoktu. Artık 15/15 aynı ölçü.
- [x] 0.9 `tests/roundLifecycle.test.mjs` (15 test): davranış + **kilit** —
      hiçbir motor kendi geçiş sayacını indiremiyor, `ROUND_OVER` okuyan her
      motor `tickRoundFlow` çağırıyor. Geri dönüşü kapatır.
- Doğrulama: `npm run check` 516/516 + health 15/15 · `npm run test:e2e` 6/6
  (engine-smoke tüm 15 motoru 240 kare döndürüyor). PROJECT_MAP §1 + §5.17b.

**Bilinmeyen risk (bilinçli):** giris nötrleme bu fazda YAPILMADI. Raunt
geçişinde `neutralizeSlotInput` çağırmak LOCAL'de basılı-tutulan joystick'i
sıfırlar (oyuncu parmağını kaldırana kadar yön gitmiyor) — mevcut davranıştan
daha kötü. Kopan kumanda zaten watchdog + 250 ms keepalive ile nötrleşiyor.
Aday: `ROUND_INTRO` durumu (Faz 1) ile birlikte, gerçek bir hazırlık vakti varken.

## Faz C — Sunucu güvenliği (sıradaki iş, ~1.5 gün)

Taramada bulunan açık sunucu riskleri. Hiçbiri dokunulmadı, liste kayıt altında.

- [ ] C.1 WS `maxPayload` + `perMessageDeflate: false` + `verifyClient` Origin kontrolü
      (hem `server/index.js` hem `server/vitePluginWs.js`)
- [ ] C.2 `RoomManager.rooms` TTL + tavan; `createRoom` eski odayı temizlesin
      (`roomManager.js:87` `hostWs.roomCode` üzerine yazıyor, `handleDisconnect:739`
      yalnız son kodu siliyor → önceki oda kalıcı sızıntı). `generateRoomCode` retry cap.
- [ ] C.3 `JOIN_ROOM`/`HOST_CREATE_ROOM` rate limit + deneme sayacı/ban (923k kod uzayı)
- [ ] C.4 `getRoom` → `isValidRoomCode` kullan; normalizasyon 4 kopyadan `networkProtocol`'a
- [ ] C.5 `handleHostBroadcast` beyaz liste doğrulaması
- [ ] C.6 `supabaseRelay.js:1177` `channel.send(...)` await + catch (şu an yutuluyor)
- [ ] C.7 Statik sunucu başlıkları (CSP, X-Content-Type-Options, X-Frame-Options) + 404 fallback

## Faz 0 — Nokta atışı silmeler (sıfır davranış riski)

- [x] 0.1 Referanssız asset'ler silindi (tabletop.jpg + 2 SVG, ~2.05MB) — `8e76a1b`
- [x] 0.2 Ölü i18n anahtarları biçildi (240 anahtar) — `e5d5c1a` (önceki oturum)
- [x] 0.3 Ölü export/metot/alias biçildi (60 tablo-kullanımlı anahtar korundu) — `8e3b14a` (önceki oturum)
- [x] 0.4 Ölü opcode'lar düştü (ARCHER_CHARGE(_END), LASER_AIM/FIRE/RELEASE, HORDE_FIRE/RELEASE, SNAKE_DIR) — `c40095b`
- [x] 0.5 Ölü metotlar (game.js vb.) önceki oturumda biçildi — `8e3b14a`; kalan yok (grep doğrulandı)
- [x] 0.6 inputRouter/inputSource kararı: KORUNDU (inputRouter tek tüketici ama `tests/inputIntent.test.mjs` kilitli saf katman; inputSource BaseGame'de aktif kullanım)
- [x] 0.0 CLONE kararı: Geri gelsin (aktif oyunlar arasına eklenecek).

## Faz 1 — Gölgeleyen kopyaları kapat (~1-2 gün, gerçek bug)

- [x] 1.1 6× cycleSlotType kopyası → BaseGame + onSeatCycled hook (crown bot-renk bug'i kapanır) — `c9db3ab`, tam test 388/388
- [x] 1.2 5× inline ekran sarsıntısı → applyScreenShake (game/bomb/heist/curve/tanks) — `613d21b`, tam test 388/388
- [x] 1.3 bot_god relay paritesi (supabaseRelay getSlots, WS ile aynı `p.kind`) — `442575b`
- [x] 1.4 Throttle tek kaynak: relay'deki 50ms/ölübant kopyası silindi (adaptör tek kapı, −45 satır)
- [x] 1.5 Aim heartbeat 200→250ms (`CONTROL_KEEPALIVE_MS` tek sabit, 3 tüketici) + dt tavanları `clampDt` (11 motor 0.05; crown/tanks/PONG bilinçli farklı)
- [x] 1.6 Çift wake-lock → `core/wakeLock.js` (main.js + gamepad.js tek modül)
- [x] 1.7 `refreshSlotCard(i)` + `refreshAllHostSlots` tekilleşti; `refreshHostSlotCards` kopyası silindi; 7 saf yeniden-boyama noktası bağlandı
- [x] 1.8 `samePacket` (ölü kod) kirli-kontrol arayüzüne bağlandı — 125ms'lik tam JSON.stringify kalktı

## Faz 2 — Katmanlama (~2-3 gün, taşıma; ekleme yok)

- [x] 2.1 BaseGame ~610 satır tabletop çizimi → core/tabletopRenderer.js (BaseGame 1866→1302 satır, 7 delegasyon; `STEER_KEY_HINTS` artık inputMaps'ten türetiliyor; render smoke testi eklendi) — check ✓, test 383/383 ✓, build ✓
- [x] 2.2 Klavye listener sızıntısı → `core/keyboardDispatch.js` tek paylaşılan dispatch (11 motorun `initKeyboard` gövdesi indi, 3 pencere dinleyicisi; `BaseGame.destroy()` aboneliği bırakır) — test 384/384
- [x] 2.3 Registry: 15 kopya `createEngine` iskeleti → `makeEngine` (621→523 satır, yalnız `packet` oyun-özeli) — bundle 446→444 kB
- [x] 2.4 main.js (2151 satır) → oda akışı + chrome çıkarma; hedef ~1400 (main.js 772 satıra indi)
  - [x] Yayın bloğu → `core/stateSync.js` (8 Hz state + 30 Hz world, `samePacket`; 4 getter, DOM'suz) — main.js 2129→2059
  - [x] Oda akışı (`openHostLobby`/`executeJoin`/koltuk/sayaç) → `core/roomFlow.js` ve chrome → `ui/windowChrome.js` çıkarıldı.
- [x] 2.5 slotManager DOM boyaması → `ui/slotCardView.js` (189→51 satır gövde) + `resetPongInvert()` (main.js özel alana dokunmuyor) — sahte DOM testi eklendi
- [x] 2.6 Supabase ilk yükten at: `net.js` eager import → `ensureActiveNetwork()` dinamik import (LOCAL/TV_CONSOLE 227 kB SDK indirmiyor; ana chunk 444.6→413.9 kB)

## Faz 3 — Ürün riskleri (karar + küçük kod)

- [x] 3.1 Global hata gözlemi: onerror/unhandledrejection reporter (`src/core/errorReporter.js`) + bare catch{} blokları bağlandı
- [x] 3.2 SW sertleştirme: precache allSettled, skipWaiting → onaylı aktivasyon, maskable icon, sağ üst bar ve ayarlar modalına "Güncellemeleri Kontrol Et" butonu (`src/core/updateManager.js`)
- [x] 3.3 Test glob: node --test glob (`package.json` güncellendi). GitHub Actions ci.yml sonradan kaldırıldı — doğrulama lokal (`npm run check`).
- [x] 3.0 ONLINE/CGNAT kararı: 30Hz world kanalını kaldır.
- [x] 3.4 Oda kodu: tek üreteç networkProtocol.js, 3 haneli sayı; doğrulayıcı eski 4 karakterli kodlar için 3-6 kabul eder (tests/networkProtocol.test.mjs ile kilitli)

## Faz 4 — Motor epikentresi: crown + race (~2-3 gün, sonda)

- [x] 4.1 crown host-render → drawCrownWorld (−522 satır), race → drawRaceWorld (−210 satır)
- [x] 4.2 crown update() bölünmesi + crownView 30Hz bake'i (paket ~%30 küçülür)
- [x] 4.3 Renk token'ları: crown 76 hex + worldCore + BaseGame default'ları → tokens.js
- [x] 4.4 AI ateşduvarı (KAPATILDI — yeni BotView sınıfı port edilmedi): mevcut `core/botView.js` salt-okunur proxy'si 15/15 AI giriş noktasına bağlandı (archer şablonu: `rawGame` → `createReadOnlyView`; tüm kimlik kıyasları zaten `index` tabanlı). `tests/botFirewall.test.mjs` her motor için 3 botlu ~15 sn maç yürütür; proxy ihlali throw eder. Tam test 421/421.
- [x] 4.5 Motor tahliyesi (KAPATILDI — LRU kurulmadı): ES modül önbelleği boşaltılamaz, LRU yalnız örnek tutardı. Yerine tek-koltuk: `releaseEngine`/`releaseAllExcept` (engineRegistry) — mod değişiminde aktif olmayan örnekler `BaseGame.destroy()` ile yıkılır; hover ön-yükleme yalnız modül ısıtır (`isEngineWarm` toast kapısı); teşhis: `getLoadedModes()`.

## Doğrulama (her adımda)

- [x] `npm run check` temiz — 2026-09-27 ✓ (token-lint: 215 token, ham literal yok)
- [x] `npm test` yeşil — 2026-09-27 ✓ 421/421 (Faz 4 kapanışı; önceki: 406/406)
- [ ] Davranış değişikliğinde 3 prova (elle, cihazda): hazır→lobi bayrakları, koltuk takası, bot görünürlüğü
