# AGENTS.md — AI Agent Çalışma Kuralları

Bu dosya her oturumda yüklenir: yalnız sözleşmeler, bütçeler, yasaklar. Gerekçe/hikâye yok.
Detay `docs/PROJECT_MAP.md`'dedir — tamamını dump etme, `grep` ile ilgili bölümü oku. Yapı/protokol/motor değişince iki dosyayı da güncelle.

---

## 1. Yığın & Modlar

- Vanilla HTML5 + CSS3 + ES Modules, Canvas, Vite, PWA (`public/manifest.webmanifest`, `sw.js`).
- Üç mod: `LOCAL` (ağ yok) · `TV_CONSOLE` (TV host + telefon kumanda, lokal WS) · `ONLINE` (P1 telefonu host; Supabase keşif + WebRTC).
- Ağ seçici `src/net.js` → TV_CONSOLE `src/network.js`, ONLINE `src/supabaseRelay.js`.
- Supabase anahtarları build'e `.env`'den gelir (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_PUBLIC_URL`). Koda gömme, commit'leme.

## 2. Yetki (değiştirilemez)

- Host tek yetkilidir (TV_CONSOLE'da TV, ONLINE'da P1 telefonu). Simülasyon yalnız host'ta.
- Kumandalar yalnız input gönderir (`(x,y)` / buton). Motorda ağ kodu, kumandada simülasyon yok.
- Uzak girdi yalnız `handleRemoteInput(slotIndex, data)` üzerinden. Yayın bütçesi §6'dadır.

## 3. Engine Registry — tek kayıt noktası

- `src/core/engineRegistry.js` → `GAME_ORDER` (15 oyun, liste dosyadadır) + `CARTRIDGES.MOD` bloğu (`load/createEngine/reset/onEnter/onResume/start/packet`, world-view oyunlarında `worldPacket/worldView`).
- `main.js` / `gamepad.js` içine `else if (mode === ...)` veya moda özel mount dalı yasak. Yeni oyun = registry kaydı + şema; çekirdek dosyaya dokunulmaz.
- Retired motorlar `src/games-retired/`'dedir; çıkarmak = bayrağı sil + `src/games/`'e taşı + `GAME_ORDER`'de retired arkasına al + PROJECT_MAP güncelle.
- Motor sözleşmesi: `resetMatch/reset`, `startNewMatch`, `startNewRound`, `update`, `render`, `resize(w,h)`, `handleRemoteInput`. `resize` CSS px alır, `computePlayfield` ile arena kurar.
- LOCAL sözleşmesi: her motor tek cihazda tam oynanır — canvas LOBBY (4 köşe kart + `▶ MAÇI BAŞLAT`), 4 slot klavye (P1 WASD+Space, P2 Oklar+Enter, P3 IJKL+O, P4 TFGH+B), 4 köşe dokunmatik joystick, `renderControlGuide` çağrısı.
- LOBBY tap: önce `onLobbySeatTap(index)` hook'u; yoksa ve `isHosting` ise `cycleSlotType`, değilse hiçbir şey.

## 4. `src/core/` tek kaynaktır — kopyalama yok

Motorlar ortak mantığı `import` eder, yeniden yazmaz: `networkProtocol`, `inputMaps`, `touchFlow`, `physics2d`, `playfield`, `roundLifecycle`, `pickupSystem`, `arenaKit`, `fieldKit`, `playerEntity`, `avatarInGame`, `tabletopIcons`, `tabletopRenderer`, `preferences`, `haptics`, `inputSource`, `controlDescriptor`, `inputIntent`, `aimInput`, `autoAim`, `botView`, `fireFeedback`, `inputRouter`, `gamepadInputAdapter`, `physicalGamepadAdapter`, `gamepadShell`, `reactions`, `ui/reactionLayer`, `ui/reactionPicker`, `ui/settings/{actions,schema,row,panel,sheet}`. API detayı dosyadadır.
- **Ayarların tek yüzeyi `src/ui/settings/`dir.** Eylem kaydı (`settingsActions`) → satır tanımı (`settingsSchema`) → satır DOM'u (`settingsRow`) → sekmeli panel (`settingsPanel`) → overlay kabuğu (`settingsSheet`). Ana menü, lobi ve duraklatma AYNI sheet'i açar; pause yalnız `quick: true` işaretli satırları kendi sheetine gömer. Yeni ayar = şemaya satır + actions'a eylem. Bir yüzeye kendi `getElementById` anahtarı, kendi `addEventListener` gövdesi veya ikinci bir "hızlı ayar" ızgarası YAZILMAZ.
- Motor sözleşmesinin TİP karşılığı tek kaynaktır: `src/types/minigame.d.ts` (MiniGameEngine/MiniGameArena/MiniGameEntity — global bildirim, runtime'da değer üretmez) + `src/types/geometry.d.ts` (FieldGeometry/FieldPalette/QualityMeasurement/WorldFrame). Yeni motor alanı/hook'u önce buraya yazılır; BaseGame sözleşme alanlarını kurucuda `@type` ile bildirir, prototip hook'ları `contractHook()` ile çağrılır.
- Zaman ölçeği: kare-başı çarpan yerine `damp()` / zaman tabanlı ifade kullan (`main.js` sabit adımlı değildir, `dt = min(dt, 0.05)`).
- Ölçek: hareket `fieldSpeed`, uzamsal her şey `fieldRadius`/`fieldPx`'ten geçer; ham px yasak. `canvas.width/height` okunmaz/yazılmaz (DPR `main.js`'indir).
- Harita-ölçeği hissi gövde/saha oranıdır: her motor `FIELD_TIERS` bandındandır (`normal` 28–36 · `open` 18–24 · `far` 9–16 tasarım px, 952 referans). Bant kilidi ölçülen değerle `movementBudget.test.mjs §B`'dedir; tier geçişi bilinçli yapılır, sessiz sürüklenmez (PONG hariç).
- Zemin/çevre yalnız `drawField` + `paintBackdrop` ile çizilir; motor kendi zemin/grid/duvar/viewport dolgusu yazmaz.
- Tempo ve zemin-L\* bütçeleri testle kilitlidir (`tests/movementBudget.test.mjs`, `tests/fieldKit.test.mjs §8`) — sayıları buraya kopyalama, teste bak.
- `tap` yalnız telefon üreticisinden gelir, state türetmez. Basılı-tut yön girdisi 250 ms keepalive taşır (`STEER_KEEPALIVE_MS`).
- Avatar sahada daima `faceMode: 'play'`, tam yuvarlak siluet; aksesuar/desen yok.

## 5. Slot Modeli

- TV: `hostPlayerSlots[i] = { name, isReady, kind }`, `kind ∈ 'human'|'bot'`. TV host varsayılan koltukta değil; düğmeyle P1 olur. ONLINE host P1'e rezerve, uzaklar P2-P4.
- Tek gerçek relay snapshot'ıdır (`players[]`); çakışırsa relay kazanır. WS ve Supabase `SLOTS_UPDATE` şeması aynıdır (`slotIndex, name, color, kind, isReady, isHost` + `reservedHostSlot`).
- İsimler `toUpperCase()`, ≤12 karakter. Bot hedef/kaynak olamaz, sayaçta koltuklar kilitli (`seatsLocked`). Bot ekleme varsayılan kapalı.
- `GAME_STARTED` ve `RETURNED_TO_LOBBY`'de hazır bayrağı iki tarafta da sıfırlanır. Oda kodu 4 karakterli alfanümerik (O, 0, I, 1 hariç).

## 6. Ağ Bütçesi

- Host → kumanda 8 Hz (125 ms) + dirty-check; kritik olaylar anında. ONLINE world-view 30 Hz unreliable `world` kanalı (Supabase'e düşmez); client jitter buffer + 60 Hz+ rAF, interpolasyon extrapolation yapmaz, sınırda snap.
- Kumanda → host 50 ms throttle + ölübant; `AIM_PRESS/RELEASE`, `DASH/TACKLE/ateş` throttle dışı. Sağ aim 250 ms keepalive.
- Ping 15 sn, watchdog 30 sn.

## 7. Oda Akışı

`Lobi (modal) → SAHAYA GEÇ (staging) → 3-2-1 sayaç (kilitli) → oyun → LOBİYE DÖN (oda kapanmaz)`. Modal açıkken canvas tap motora düşmez; staging'de düşer.

## 8. UI Kuralları (özet)

- Renk sözlüğü `src/styles/tokens.css` + `src/ui/tokens.js` (birlikte güncellenir). `src/**/*.css`'te ham renk literali ve tanımsız `var()` yasak (`scripts/token-lint.mjs`). Koyu yüzey + krem saha (`data-theme="field"`); kenar `--edge`, doygun dolgu yazısı `--on-accent`.
- Overlay tek sahip `src/ui/overlayHost.js` (`openOverlay/closeOverlay`). Modal `src/ui/` altındadır; görünüm `src/ui/views/` + `registerView` ile eklenir, `main.js`/`gamepad.js`'e ekran dalı yazılmaz.
- **Ayar/duraklatma yüzeylerinde başlık şeridi YOKTUR** (rozet + ad ~68px, yatay telefonun %20'si; hiçbir seçim taşımıyordu). Ayarlarda sekme şeridi başlığın yerini tutar (`tabStrip.js`, `.settings-tabs`), erişilebilir ad `role="dialog"` `aria-label`ındadır; duraklatmada tek satır `.pause-head` (oyun adı + dişli + kapat).
- **Düz panel dili**: satır kendi kutusu değildir — kenarlık/gölge/ikon çerçevesi yok, satırlar arası tek tel ayraç (`--n-200`). Panel merkezde ve genişliği sınırlıdır (`min(520px, 100%)`), tam satır genişliğine yayılmaz. **Yükseklik SABİTTİR**: sekme değişince şeritler zıplamaz. Satır ≥44px, sekme başına ≤5 satır, gövde kaydırmaya muhtaç değildir.
- Erişilemeyen ayar satır ÇİZMEZ (`available()` → `hidden`); "kullanılamıyor" düğmesi bırakılmaz.
- Kabuk `src/ui/appShell.js`: view stack, geri/Escape, rotate gate, üç yüzen gezinme (ANASAYFA/OYUNLAR/KARAKTER). Üst şerit/bant/geri düğmesi yasak. Sayfa akışı yasak (dikey scroll yalnız lobi/ayar panelinde).
- Sahne dili `src/styles/scene.css` + `.scene-btn` (`is-gold/is-teal/is-ghost`); sahneye ikinci panel/başlık/kart çerçevesi yok.
- Sonuç yüzeyi `src/ui/resultPanel.js` + `hud.js layoutMatchOverCard` (içerikten türeyen kart, sabit yükseklik yok, ≥44 px buton). Satırlar deklaratif `matchOverRows`; rütbe yalnız `score` varsa basılır.
- **Saha skoru TEK yüzeydir**: `tabletopRenderer.renderStandardScoreboard` → `hud.js renderAdaptiveScoreboard` (sanal kontroller ekrandaysa üst şerit, yoksa köşe rozetleri). İkinci yüzey yasak — sahanın sol üstündeki mikro sayaç çipi (Top Rail Tally) ve "göz at" düğmesi kaldırıldı. Yalnız DOLU koltuklar çizilir ve "dolu" kararı `game.slotTypes`'ten gelir (motorun `isJoined` aynası değil); motor kendi skorbordunu `renderHUD`'un dışında çizmez.
- İkon tek kaynak `src/core/tabletopIcons.js` + `iconSlots.js` (`data-icon`); kumanda aksiyonu ikon-only. Ham OS emojisi yasak — tek istisna tepki yüzeyi (`reactions.js` → glyph + `reactionGlyph`, tel değeri ASCII anahtar).
- Twin-stick'te aksiyon butonu aim zone'un ÇOCUĞUDUR; `aimController` butondan/kümeden gelen olayı yok sayar. Buton kendi `preventDefault`'u ile bunu kesmez (pointer/touch ayrı olay aileleri) → yok sayım zone tarafında zorunlu.
- Motion `src/ui/motion.js` + tokenlar; `transform`/`opacity` dışı animasyon yok, `prefers-reduced-motion`'a uyulur.

## 9. Yasaklar

- Çekirdeğe moda/ekrana özel dal; `src/core` mantığını motora kopyalama; `drawField`/`paintBackdrop` dışı zemin/çevre çizimi; state'i iki yerde tutma; kumandada simülasyon / motorda ağ kodu; ham renk/emoji (tepki glifi hariç); ikinci overlay/sekme/ikon/tepki uygulaması; gereksiz `*.md`.
- Okuma: hedefe `grep` ile git, mimari gerektiriyorsa tam dosya oku; bundle/lock/log'u bağlama dökme.

## 10. Yeni Oyun (özet)

`src/games/[oyun].js` (sözleşme + lokal lobi/klavye/joystick/rehber) + `src/ai/[oyun]AI.js` + registry kaydı + `gamepadSchemas.js` şeması + `index.html` bento/çip/önizleme + `public/assets/games/[oyun].webp` (maddedeki formül, 1:1) + PROJECT_MAP satırı. Detay PROJECT_MAP §6'dadır.

## 11. Doğrulama

- `npm run check` ve `npm run build` temiz. Davranış değişikliğinde 3 prova: hazır→lobi bayrakları, koltuk takasında TV+kumanda isimleri, bot ekle/çıkar görünürlüğü.
- `npm run check` artık `tsc --checkJs` (tsconfig `checkJs: true` — 55k satırın tamamı denetlenir) + `check:undef` + `check:tokens` + `check:rules` taşır. Yeni tip hatası = check kırık; istatistik: `npm run typecheck -- --stats`, ratchet tabanı `scripts/typecheck-baseline.txt`.
- `scripts/rules-lint.mjs` (K1–K6, AGENTS.md § haritalı) yeni ihlalde exit 1; mevcut borç `scripts/rules-lint-baseline.json`'da dosya+kural sayısıyla dondurulmuştur — borcu ancak azaltırken güncelle (`--update`).
- Motor/akış değişikliğinde `npm run test:e2e` (Playwright, `tests-e2e/`): `engine-smoke.spec.js` tüm GAME_ORDER motorlarını registry'den yükleyip LOBBY→PLAYING 240 kare sürer; `control-surface.spec.js` yerel kontrol yüzeyi seçimini doğrular. §11'in 3 provası `tests/relayProbes.test.mjs`'te protokol seviyesinde otomatik. @ts-ignore/@ts-nocheck politikası: @ts-ignore yasak, @ts-nocheck yalnız `sebep — tarih` yorumuyla.
- Push yalnız kullanıcı isterse.
