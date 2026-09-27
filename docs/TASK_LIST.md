# Task List — Üretim Seviyesine Refactor

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
- [x] 3.3 CI: node --test glob (`package.json` güncellendi) + tek GitHub Actions (.github/workflows/ci.yml)
- [x] 3.0 ONLINE/CGNAT kararı: 30Hz world kanalını kaldır.
- [x] 3.4 Oda kodu: tek üreteç networkProtocol.js, daima 4 karakter (O, 0, I, 1 hariç 31 karakterlik alfabe); doğrulayıcı eski 3 haneli kodlar için 3-6 kabul eder (tests/networkProtocol.test.mjs ile kilitli)

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
