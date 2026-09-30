# MOTION_PLAN — Game Feel & VFX Seferberliği

Hedef: 15 oyunun tamamında "vurucu" geri bildirim (hit-stop, partikül, sarsıntı, haptik,
ses) + mobilde okunabilirliğini koruyan tek sahibi olan bir FX mimarisi.
Yerleşik kurallara tabiidir: host otorite (§2), `src/core` tek kaynak (§4), `fieldRadius`/
`fieldSpeed` ölçeği (§4), token renkları (§8), `npm run check` tek kapı (§11).

Kod taramasının tespit ettiği **mevcut kaldıraçlar** (yeniden yazılmayacak):

| Var olan | Yer | Not |
|---|---|---|
| Trauma² sarsıntı: `addTrauma` / `updateTrauma(dt, 2.2)` / `applyScreenShake` | `BaseGame.js:310-330` | `maxOffset=14` **ham px varsayılanı** — I5/I6 borcu, Faz 1'de kapanır |
| Ateş geri bildirim durum makinesi (shot/blocked/ready, serial, snapshot sözleşmesi) | `core/fireFeedback.js` | Host + kumanda paylaşımı kanıtlanmış model — FX sözleşmesi bu deseni kopyalar |
| Haptik kapısı `vibrate()` + tercih bayrağı | `core/haptics.js` | Desenler dağınık: `fireFeedbackEffects` 8 ms, `tanks` 22 / [40,50,80] — tek tabloya gelir |
| Azaltılmış hareket: `motionScale()`, `pulse()` | `ui/motion.js` | FX'in tamamı bu çarpanla çarpılır |
| Paylaşılan partikül çizici `drawCircleParticles` | `games/worldCore.js:249` | 4 motor + 3 worldView import ediyor — fxKit'in tohumu bu, motor-yönlü kopyalar değil |
| Ses seti (18 `play*`) | `src/audio.js` | Ses eksik değil; **pitch varyasyonu** ve olay→ses eşlemesi eksik |
| Perf ölçer `perfMonitor` | `core/perfMonitor.js` | FX kademe bütçelerinin bağlanacağı yer |
| Tempo/L\* kilitleri | `movementBudget`, `fieldKit` testleri | Juice bu kapıları doğal olarak kırmak ister — bilinen sürtüşme, bkz. Riskler |

---

## Temel kararlar (uygulamadan önce kilitlenecek)

1. **Hit-stop yalnız SUNUMDA.** `BaseGame`'e `presentationTimeScale` eklenir: simülasyon
   `update`'ü durmaz, çizim/animasyon dt'si kısa süreliğine ~0.05×'e iner. Host otoritesi
   (§2) ve `selfPrediction` precedenti ("sunum ≠ simülasyon") bunu gerektirir. Bütçeler:
   isabet 50 ms, öldürme/skor 100 ms, maç-topu 150 ms tavan. `motionScale()===0` → devre dışı.
2. **ONLINE kumandada hit-stop:** world-frame interpolatörünün ÇİZİMİ dondurulur (jitter
   buffer akmaya devam eder), host'un kritik-olay bayrağıyla tetiklenir. Supabase'e düşüşte
   world kanalı olmadığı için (§6 istisnası) FX orada flash+squash gramerine iner — bu
   kabul edilmiş degrade, hata değil.
3. **FX olayı = anlık güvenilir yolculuk.** FX'ler 30 Hz world kanalında TAŞINMAZ (kayıp
   görsel tutarsızlık üretir); mevcut "kritik olaylar anında gider" hızlı yolundan küçük
   paketlerle gider: `{ fx:'hit', slot, x, y, token, power }` (~40 bayt). 8 Hz state-sync'e
   yalnız FX'i yok; her kademede (WS + Supabase) aynı davranır.
4. **Tek ekran-efekti bütçesi (mobil altın kural).** Eşzamanlı en fazla BİR ekran-level
   etki (flash/sarsıntı/vinyet); öncelik sırası: kendi-ölümüm > kendi-skorum > kendi-isabetim
   > diğerleri. Kaybedenler entity-level FX'e iner (flash+squash). Bu olmadan 4 kişili
   free-for-all'da juice çorbası olur ve §8 okunurluk kuralları fiilen ölür.
5. **Olay merdiveni sözleşmesi** — her anlamlı olay en fazla 5 kanaldan beslenir:
   görsel reaksiyon (≤1 kare) → FX burst (150-400 ms ömür, `fieldRadius` ölçekli) →
   travma (yönlü, bütçe tablosundan) → ses (±%5 pitch varyasyonlu) → haptik (desen tablosu).
   Kanal bütçeleri `fxKit.js` içindeki TEK tabloda; motorlar sayı geçmez, olay türü geçirir.

---

## Faz 1 — Çekirdek his primitifleri (~1 hafta)

> **Faz 1 uygulandı (2026-09-30) — iki bilinçli sapmayla:**
> 1. **Hit-stop TEK SAAT modeli:** plandaki "sunum-zaman-ölçeği" yerine host
>    motorunun kare dt'sini geçici yavaşlatır (`fx.tick(rawDt)`). Gerekçe:
>    kumandaların yerel simülasyonu yok — 30 Hz yayınlanan kareyi çiziyorlar.
>    Sunum-side dondurma, kumandada interpolatör dondurma gibi YENİ bir
>    yüzey-davranışı isterdi; tek saat modelinde hit-stop otoriter zamanın
>    parçasıdır ve her yüzey aynı kareyi görür → sapma imkânsız. Etki aynı,
>    risk daha düşük, §2 daha güçlü korunur.
> 2. **Flaş rengi MÜREKKEP (koyu göz kırpımı):** saha krem (#F4F0EA) olduğu
>    için beyaz flaş ölçülen ΔRGB≈3 ile görünmüyordu; koyu göz kırpımı brutalist
>    baskı diline uygun ve ölçülebilir. Çiziciler `fxKit`'te değil `worldCore`da
>    (host↔client ortak-draw konvansiyonu bunu gerektirdi).
>
> Kapılar: check 536/536 · health 15/15 · e2e 6/6 · rules-lint temiz.
> Kilitler: `tests/fxKit.test.mjs` (9) + `tests/tanksFx.test.mjs` (4).
> Piksel kanıtı: kill bölgesi 14400 px'in ~11600'ü değişti; flaş ekran
> köşesini koyulaştırıyor; crop'ta halka+burst+pop net (BOT bandı altında
> kalmayan boş alanda).

- [x] 1.1 `src/core/fxKit.js`: kapalı olay kümesi `shot | hit | kill | pickup | score |
      blocked | spark | dust | zone` (ölüm pop'u `kill` içinde gömülü); olay → kanal
      bütçe tablosu; tek ekran-efekti kuralı (yalnız kill flaş basar — testli);
      `FX_PROFILES` bütçe tavanları testle kilitli (trauma ≤0.4, hit-stop ≤150 ms,
      burst ≤18). Çiziciler `worldCore.drawFxRings/drawFxPops/drawFxFlash`.
- [x] 1.2 `src/core/fxRuntime.js`: havuzlu partikül/ring/pop player, kap
      aşımında en-eski-düşer, `fieldRadius`/`unit` ölçekli; motor `this.particles`
      alias'ı korur (worldCore pack/draw sözleşmesi bozulmadı — kademeli geçiş).
- [x] 1.3 Entity hit-look: `hitFlash` zamanlayıcısı + `drawTanksTanks` pop
      (1.10→1.00) + beyaz kontur parlaması; snapshot alanı opsiyonel (v1 uyumu).
- [x] 1.4 Hit-stop: `fx.tick()` tek saat (sapma #1 yukarıda); `advanceHitStop`
      saf fonksiyon, zaman-dürüstlüğü testli.
- [x] 1.5 Travma bütçe tablosu + YÖNLÜ sarsıntı: `BaseGame.addDirectionalTrauma`
      + itki-ağırlıklı `applyScreenShake` (itki yokken eski jitter — geriye
      uyumlu); TANKS ofseti `fieldRadius(arena,16)` (I5 borcu kapandı).
- [x] 1.6 Haptik desen tablosu: `FX_HAPTIC` fxKit'te (haptics.js kapısı altında);
      TANKS'ın dağınık `vibrate(22)`/`vibrate([40,50,80])` çağrıları silindi.
- [ ] 1.7 Ses: `playHit`-tarzı sarmalayıcı + ±%5 pitch jitter (KALDI — Faz 1.5'e
      ertelendi; mevcut `play*` seti kullanımda, davranış doğru).
- [x] 1.8 `tests/fxKit.test.mjs` + `tests/tanksFx.test.mjs`: kapalı küme, kaplar,
      hit-stop dürüstlüğü, ROUND_OVER'da FX akışı, WORLD_FRAME fx yükü şeması,
      v1-geri-uyum, dönüştürülmüş motorda ham partikül yasağı (kilit).

**Çıkış kanıtı:** TANKS uçtan uca dönüştürüldü (shot/hit/kill/pickup/spark/dust/zone
olayları; kendi partikül/metot gövdeleri silindi, API kabukları korundu).

## Faz 2 — Port ağları ve taşıma (~1 hafta)

- [x] 2.1 15 motor FX olayı üretmeye geçer; motor-içi partikül state/kopyaları silinir
      (horde/archer/curve/bombView vb. — `drawCircleParticles` import'ları fxKit'e bağlanır).
      Kural: motor `ctx`'e FX için hiçbir şey yazmaz; ağ motoru FX'i üretmez, motoru çizmez.
      (15/15 bitti 2026-09-30: son motor CURVE wave (d) ile kapandı — `src/games/**`'te
      `particles.push(` sıfır, K7 borcu 17→0, `rules-lint-baseline.json` K7 boş.)
- [x] 2.2 ONLINE: FX olayları anlık güvenilir yola eklendi (WS + Supabase aynı düz şema:
      `{ type: 'HOST_FX', events }` / `{ action: 'FX_EVENTS', events }`);
      `networkProtocol` normalize edici (`isValidFxEvent`/`normalizeFxEvents`/`createFxStamp`/
      `createFxEventFilter`); kumanda playback (`gamepadWorldView.acceptFx` + `fxLive` mandalı).
      Kilit: `tests/fxEvents.test.mjs`.
- [x] 2.3 Kademe bütçeleri `perfMonitor`'a bağlandı: lazy-boot cihaz metriğinden low/mid/high
      (partikül ×0.4/×0.7/×1.0, glow katmanı low'da kapalı); 20 ms üstü kare-süresi 30 kare
      sürerse bir kademe düşer. Tek okuma noktası `fxRuntime.emit` (`count` çarpanı).
- [x] 2.4 TV_CONSOLE: sarsıntı/flash TV'de kalır (zaten host), kumandaya yalnız haptik +
      buton pop'u düşer — §2 gereği kumanda simülasyonsuz kalır. (Bitti 2026-09-30: karar
      `fxKit.fxPadFeedback(events, playerIndex, hasWorldView)` saf fonksiyonunda tek kaynak —
      world-view YOKSA kendi olayında haptik + `.fx-pop` buton scale-pop'u (~100 ms, Faz 3.5
      grameri, transform-only, reduced-motion'da kapalı); world-view VARSA FX'i zaten çizer,
      pop YOK (çift geri bildirim olmaz). `gamepad.handleFxEvents` bu kararı uygular,
      simülasyon üretmez. Kilit: `tests/fxKit.test.mjs` 2.4 bloğu.)
- [x] 2.5 Dönüşüm dalgaları: (a) tanks+horde+laser+archer (ateşli, en çok isabet) →
      (b) crown/bomb/clone/collapse/heist (etkileşimli) → (c) pong/snake/ball/race/zone/ninja/
      game (düşük olay sıklığı, dokunuş-minimum). Her dalga sonunda `npm run check`.
      ((a) bitti 2026-09-30: tanks (Faz 1) + horde+laser+archer — shot/hit/kill/pickup/spark/
      dust olayı, `draw*FxLayer` ortak çizimi, `fxLive` playback mandalı, `fx` paket
      yükü (v1 uyumlu opsiyonel); kilit `tests/fxKit.test.mjs` 4 motora genişledi.)
      ((b) bitti 2026-09-30: crown+bomb+clone+collapse+heist — olay merdiveni oyuna göre:
      clone tackle-kill/hit+pickup, collapse dust/hit/kill, heist dust/spark/pickup/score/
      hit/zone, bomb dust/spark/pickup/hit/kill/score, crown dust/spark/pickup/hit/score
      (travma lavabosuz — ZERO CAMERA SHAKE korunur); `packFxState`/`isValidFxState`
      worldCore'da tek kaynak (tanksView re-export); kilit 9 motora genişledi.)
      ((c) bitti 2026-09-30: pong(game/ball)+snake+race+zone+ninja — düşük olay sıklığı:
      spark/hit/kill/dust/score, `draw*FxLayer` ortak çizimi, `fxLive` playback, `fx` paket
      yükü; ball/game/race'te tekrarlanan ham hex'ler `UI_COLORS` token'larına bağlandı
      (K2 tabanı düşürüldü). Kapılar: rules temiz · test 543/543 · health 15/15. Commit 6c817b5.
      NOT: 15. motor CURVE bu dalgada yok — 2.1 kapsamında ayrı iş, `curve.js` hâlâ K7 borcu.)
      ((d) 2026-09-30: CURVE — nitro/pickup `zone`+`pickup`, bomba patlaması ve kesilme `kill`,
      eski `vibrate([40,50,70])` koltuk bazlı `haptic`e; `curveView` `drawCurveFxLayer` +
      `fx` yükü; `curve.js`/`zone.js` ölü `addTrauma` override'ları silindi. K7 borcu 17 → 0:
      `scripts/rules-lint-baseline.json` içinde `K7` boşaltıldı, artık HER K7 ihlali gate'i
      kırar. Kapılar: rules temiz · test 543/543 · health 15/15 · e2e 6/6.)
- [x] 2.6 `rules-lint` K7 kilidi: `src/games/**` içinde `particles.push(` ve partikül
      döngüsünden sonraki 12 satır içinde `ctx.arc(` yasak (ortak çizici `worldCore.js` hariç).
      Borç `scripts/rules-lint-baseline.json`'da donduruldu; `npm run check` kilitler.

> **Faz 2 sapma notu (Parça 1):** plandaki "çizen-interpolatör donması" TEK SAAT modeliyle
> ikame edildi — hit-stop host karesini yavaşlatır, kumanda ayrı donma bütçesi bilmez
> (Faz 1 sapması 1 yerinde duruyor). `frame.fx`/`frame.particles` v1 yedeği olarak duruyor:
> `fxLive` mandalı açıkken yok sayılır, olay yoksa çizilir. Kaldırma kararı Parça 4'e.

**Çıkış kanıtı:** `engine-smoke` 15 motor × 240 kare yeşil; `relayProbes` §11 provası yeşil;
gerçek Android düşük-ucuz cihazda 60 fps yakalama (perfMonitor çıktısı kanıt).
> **Durum (2026-09-30):** kod tarafı tamam — `npm run check` yeşil (tsc + undef + tokens +
> rules + test 545/545 + health 15/15) · `npm run build` yeşil · `npm run test:e2e` 6/6
> (engine-smoke CURVE dahil 15 motor × 240 kare + relayProbes/control-surface/perf-overlay).
> **Kalan tek kanıt: gerçek düşük-ucuz Android'de 60 fps ölçümü** (kullanıcı testi, agent yapamaz).

## Faz 3 — Okunurluk ve hiyerarşi (~1 hafta, Faz 2 ile kısmen paralel)

- [x] 3.1 Siluet: avatar dış halkasına 1.5-2 px koyu rim + %8 yer-gölgesi (slot rengi
      HALKADA kalır, çekirdek şekil/nişan okunur) — `avatarInGame`/`tabletopRenderer`'da tek.
      (Çözüm 2026-09-30, kod DEĞİŞMEDİ — niyet zaten karşılanmış: `characterRenderer` koyu hairline
      rim (`rgba(26,26,26,.28)`) + 2.5D hacim + halkada slot rengiyle çekirdek şekil/nişan okunur.
      Literal 1.5-2 px kalın rim ve %8 yer-gölgesi, kullanıcının ÖNCEKİ açık kararıyla reddedilmişti
      (satır 175 "yer-gölgesi kullanıcı isteği üzerine iptal", satır 214 "kalın koyu çizgi is gibi
      okunuyordu") → varsayım politikası gereği sessizce tersine çevrilmedi. Kullanıcı "gölge/rim
      ekle" derse kullanıcı onayıyla uygulanır.)
- [x] 3.2 I7 dürüstlüğü: 12 px taban `qualityGate` anchor'u (852×393) yerine gerçek en
      küçük hedef cihazda (SE yatay) ölçülür; rapor I8-I11'e kademe-farkı satırı eklenir.
      (Bitti 2026-09-30 / `9e2b56c`: I7 artık SE 667×375'te ölçülür — `npm run health`
      satırı "I7 artık EN KÜÇÜK cihazda (SE 667x375) ölçülür" der; RACE/CLONE gövdeleri
      büyütüldü, I12 kademe-farkı raporu eklendi.)
- [x] 3.3 Üç kademe hiyerarşi (fxKit hakemiyle zorunlu): T1 kendi avatarın+nişan hattın
      (tam opak, tam juice) · T2 aktif tehdit (mermi/kenar — parlak ama flash-seviyesi değil)
      · T3 diğer oyuncular + ambiyans (α −%25). Motorlar α'yı kendisi uydurmaz.
      (Bitti 2026-09-30: TEK hakem `fxKit.fxReadAlpha({isSelf,isThreat,hasViewer})` / `fxTierAlpha`
      (T1=1·T2=1·T3=0.75). 12 motor kablolu — selfSlot (engine `localControlSlot` / world-view
      `context.selfSlot`) → tier α; paylaşılan TV'de tek-görür yok → dim YOK. α `drawGameAvatar`
      opts.alpha ile View'ın kendi globalAlpha'sıyla compose olur. curve/pong/race N/A (drawGameAvatar
      yok). Kilit: `tests/readabilityTierWiring.test.mjs` (12 oyun) + `tests/fxKit.test.mjs` 3.3 bloğu.)
- [x] 3.4 HUD bandı ↔ oyun alanı dokunmazlığı geniş viewport'ta yeniden doğrulanır
      (inset metin yüksekliğinden değil halka yarıçapından türemeli — bilinen tuzak).
- [x] 3.5 Kumanda buton geri bildirimi SADECE 90-110 ms scale-pop; ripple/glow yok.
      `gamepadShell`/şema tarafında tek desen. (Bitti 2026-09-30: oyun-içi aksiyon butonlarında
      ripple/glow YOK — geri bildirim scale tabanlı (`:active` transform) + 2.4 `.fx-pop` (100 ms).
      `cd-ready-pop` 300 ms + `brightness()` glow → **100 ms saf scale-pop**'a indirildi (glow kaldırıldı,
      reduced-motion'da kapalı). Lobby-seat/ready-toggle/layout-editor glow'ları birer SEÇİM durumu
      göstergesi, buton-geri-bildirimi değil → 3.5 kapsamı dışında bırakıldı. Tek gramer: 90-110 ms scale-pop.)
- [x] 3.6 Sonuç/raunt bantlarındaki mevcut `enter` animasyonlarına (260 ms) FX final
      kareleri eklenir: kazanma anı → skor sayacı tick-zıplatması; mevcut kart dili bozulmaz.

**Çıkış kanıtı:** 4 kişilik kaos anında yan yana ekran görüntüleri (küçük telefon + TV):
her avatar tanınır, HUD üstünde hiçbir şey uçuşmaz, T3 solukluğu ölçülür.

## Faz 4 — Ayarlama ve kalıcılık (sürekli, Faz 3 sonrası)

- [x] 4.1 Oyun-özel travma/FX tabloları yalnız `CARTRIDGES` kayıt alanlarında tutulur
      (motor gövdesinde sayı yok); playtest turu başına bir oyun ince ayar. (Denetim 2026-09-30:
      motorlar yalnız kapalı `FX_KIND` olayı yayar (`this.fx.emit('kill', {...})`); travma/partikül/
      flaş bütçeleri TEK kaynak `fxKit FX_PROFILES`'ta — motor gövdesinde bütçe sabiti YOK. Kilit:
      `tests/fxOwnership.test.mjs` (kapalı küme + bütçe-alanı yasağı). "İnce ayar" sürekli bir
      playtest işidir; sayı değişince yalnız `fxKit`'e yazılır, motora değil.)
- [x] 4.2 Tempo/L\* kilitleriyle sürtüşme POLİTİKASI: juice bir kapıyı kırarsa kapı mı
      haksız değişim mi önce kararlaştırılır; eşik genişletme AGENTS güncellemesiyle VE
      kullanıcı onayıyla yapılır — sessiz eşik kaydırma yasak. (AGENTS §11'e politika satırı eklendi.)
- [x] 4.3 Termal/bateri: uzun oturumda low kademeye inişin playbook'u; `prefers-reduced-
      motion` kadar "sakin mod" tercihi de ayar şemasında satır olur (§8: şema+actions).
- [x] 4.4 PROJECT_MAP'e "FX olayları ve bütçeleri" bölümü + AGENTS §8'e tek satır:
      "FX yalnız `fxKit` olayından doğar; motor/çekirdek partikül state'i tutmaz."

> **4.3 playbook (termal/bateri, uzun oturum):**
> 1. **Otomatik iniş** — `perfMonitor`: boot'ta cihaz metriği (`cores`/`deviceMemory`) ilk
>    kademeyi seçer (≤2 çekirdek veya ≤2 GB → `low`; ≥8 çekirdek & ≥3 GB → `high`; arası `mid`).
>    Çalışırken kare süresi 20 ms üstünde **30 ardışık kare** sürerse kademe bir basamak iner
>    (`high→mid→low`); düzelince yükselmez (histerezis: tekrar ısınmayı önler).
> 2. **Low'da ne olur** — `fxParticleScale` 0.4, `fxGlowEnabled` false (aura katmanı kapanır).
>    Travma/sarsıntı bütçesine DOKUNMAZ; o `motionScale` kapısındadır (§8).
> 3. **Kullanıcı kapısı** — "Sakin mod" (Ayarlar → SİSTEM) hareketi kısar (`motionScale` 0) +
>    kademeyi `low`'a **sabitler**; kapatınca otomatik kademe geri gelir. Tek okuma noktaları:
>    `motion.js` + `perfMonitor.js`; ayrı bir "sakin" çizim yolu YOKTUR.
> 4. **İzleme** — `?perf` / `bp.perf=1` → `perfOverlay`; etkin kademe `fxTierName()` ("low" sakin
>    modda da doğru raporlanır).

## Riskler ve bilinçli tercihler

- **Hit-stop ağ yanılsaması:** sunumda donma host hareketini 50-100 ms geriden gösterir —
  world-channel'ın zaten yaptığı jitter-buffer gecikmesi içinde kalır; kabul edildi.
  Alternatif (kumandada hiç donma yok) yalnız flash+squash grameri demektir; Faz 2.2'de
  tek satırla anahtarlanır.
- **Juice vs kilitler:** `movementBudget`/`fieldKit` testleri juice'un doğal düşmanıdır;
  politikası 4.2'de. FX sayıları token/test kopyası olarak değil `fxKit` tablosundan okunur.
- **Kapsam enflasyonu:** sprite atlas / shader / audio engine YOK — prosedürel canvas bu
  ölçekte doğru mimaridir. İllüstratif karakter gelirse yeniden değerlendirilir.
- **Eski dosyadan devralınan:** sunucu güvenliği (eski TASK_LIST Faz C) bu planın dışında,
  açık iş olarak `git show HEAD:docs/TASK_LIST.md` içinde duruyor.

## Doğrulama (her fazda)

- `npm run check` (tsc + undef + tokens + rules + test + health) — her PR/commit
- `npm run test:e2e` — Faz 2 portlarında zorunlu
- §11 3 prova davranış değişiminde; `fxKit`/`fxBudget` testleri yeni kilitler
- **TEK AÇIK İŞ (kullanıcı tarafı):** Gerçek cihaz — düşük-ucuz Android (kademe düşüşü)
  + küçük telefon yatay (I7, okunurluk). Agent bu ölçümü yapamaz; tüm fazlar kapandıktan
  sonra kalan tek kanıt budur.
