# Task List — Üretim Seviyesine Refactor

## Faz 0 — Nokta atışı silmeler (sıfır davranış riski)

- [x] 0.1 Referanssız asset'ler silindi (tabletop.jpg + 2 SVG, ~2.05MB) — `8e76a1b`
- [x] 0.2 Ölü i18n anahtarları biçildi (240 anahtar) — `e5d5c1a` (önceki oturum)
- [x] 0.3 Ölü export/metot/alias biçildi (60 tablo-kullanımlı anahtar korundu) — `8e3b14a` (önceki oturum)
- [x] 0.4 Ölü opcode'lar düştü (ARCHER_CHARGE(_END), LASER_AIM/FIRE/RELEASE, HORDE_FIRE/RELEASE, SNAKE_DIR) — `c40095b`
- [ ] 0.5 Ölü metotlar: game.js applyKeyboardControls/isPlayerActive/handleLocalInput, BaseGame ölü dal, archer wrapper
- [ ] 0.6 inputRouter.js sadeleştirme (tek tüketici main.js), inputSource.js → BaseGame inline kararı
- [ ] 0.0 CLONE kararı: "emekli ama oynanabilir" mi, tam kaldırma mı? (kullanıcı kararı)

## Faz 1 — Gölgeleyen kopyaları kapat (~1-2 gün, gerçek bug)

- [ ] 1.1 6× cycleSlotType kopyası → BaseGame + onSeatCycled hook
- [ ] 1.2 5× inline ekran sarsıntısı → applyScreenShake (bake-cache determinizmi)
- [ ] 1.3 bot_god relay paritesi (supabaseRelay tek satır)
- [ ] 1.4 Throttle tek kaynak: throttleSlot() → networkProtocol.js (WS + relay aynı kapı)
- [ ] 1.5 Aim heartbeat 200→250ms sabite + dt tavanları tek değer
- [ ] 1.6 Çift wake-lock → core/wakeLock.js (−40 satır)
- [ ] 1.7 11× ready-quintuple zinciri → slotManager.refreshSlotCard(i)
- [ ] 1.8 samePacket ucuzlat: depth-2 stringify → sürüm/stamp karşılaştırma

## Faz 2 — Katmanlama (~2-3 gün, taşıma; ekleme yok)

- [ ] 2.1 BaseGame ~610 satır tabletop çizimi → core/tabletopRenderer.js
- [ ] 2.2 Klavye listener sızıntısı → inputMaps.js tek paylaşılan dispatch (−14 dinleyici)
- [ ] 2.3 Registry: 14 kopya createEngine iskeleti → makeEngine (−120 satır)
- [ ] 2.4 main.js (2151 satır) → roomFlow.js + core/stateSync.js + hud.js; ~1400 satır hedef
- [ ] 2.5 slotManager DOM boyaması çıkar; _pongInvertManualSet → resetPongInvert()
- [ ] 2.6 Supabase'i ilk yükten at: net.js eager import → online dalında dinamik import

## Faz 3 — Ürün riskleri (karar + küçük kod)

- [ ] 3.1 Global hata gözlemi: onerror/unhandledrejection reporter + 107 bare catch{}'a bağla
- [ ] 3.2 SW sertleştirme: precache allSettled, skipWaiting → onaylı aktivasyon, maskable icon
- [ ] 3.3 CI: node --test glob + tek GitHub Actions (check+test+build)
- [ ] 3.0 ONLINE/CGNAT kararı: (A) TURN ekle | (B) 30Hz world kanalını kaldır (kullanıcı kararı)
- [ ] 3.4 Oda kodu: 4-6 karakter alfanümerik, tek üreteç networkProtocol.js

## Faz 4 — Motor epikentresi: crown + race (~2-3 gün, sonda)

- [ ] 4.1 crown host-render → drawCrownWorld (−640 satır), race → drawRaceWorld (−180)
- [ ] 4.2 crown update() bölünmesi + crownView 30Hz bake'i (paket ~%30 küçülür)
- [ ] 4.3 Renk token'ları: crown 76 hex + worldCore + BaseGame default'ları → tokens.js
- [ ] 4.4 AI ateşduvarı: BotView salt-okunur algı bağlamı (10 AI dosyası)
- [ ] 4.5 Motor tahliyesi: releaseEngine(mode) LRU + bellek baskısı kancası

## Doğrulama (her adımda)

- [ ] `npm run check` temiz
- [ ] `npm test` yeşil
- [ ] Davranış değişikliğinde 3 prova: hazır→lobi bayrakları, koltuk takası, bot görünürlüğü
