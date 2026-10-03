# BRUTAL PARTY — Gameplay Fun Backlog (audit, 2026-10-03)

DURUM: **salt analiz — hiçbir dosya değişmedi.** 13 motorun tamamı + `src/core/` ortak katman okundu.
`[V]` = ben kodu okuyup doğruladım. `[A]` = alt agent raporu, satır numarası verilmiş ama yeniden doğrulanmalı.
Uygulama ajanı: her maddeyi yazılı sınırlar içinde (AGENTS.md §2/§3/§4/§6) uygula; `[A]` işaretli maddede önce satırı kontrol et.

> **KULLANICI ÖNCELİĞİ (2026-10-03, bu dosyanın üstünden geçer):**
> 1. **S2 (elenen oyuncu) ve S3'teki "rauntu kısalt" yaklaşımı İPTAL.** "Ölen zaten beklesin, raunt kısa."
>    Genel kural: **rauntları kısaltmak yok; maçları daha uzun ve daha zengin yapmak var.**
> 2. Mevcut sistemler "aşağı yukarı çalışıyor" → **var olanı yeniden bağlama fikri düşük değerli.**
>    İstenen: **YENİ mekanik, YENİ NESNE, YENİ şey.** → **§7 (bu dosyanın sonundaki yeni içerik bölümü) asıl listedir.**
> 3. Bug'lar ayrıca ele alındı ve düzeltildi: **§8 (bug kayıt listesi)**.
> 4. `[A]` işaretli "ölü kod" iddialarının bir kısmı **yanlış çıktı** — düzeltildi, bkz. §8 tablo dibi.

---

## 0. Neden bu sıralama

Oyunların çoğu "kötü çizilmiş" değil; **aynı üç yapısal boşluğu** 13 kez tekrarlıyor:

1. **Maç berabere bitiyor.** Kazananı olmayan sonuç, parti oyununda en kötü sonuç.
2. **Eleneen çocuk 30–75 saniye hiçbir şey yapmadan bakıyor.**
3. **Önde olan oyuncu oynamayı bırakınca oyun onu durduramıyor** (camp = optimal strateji).

Bunlar mod-başına dekorasyonla değil, `src/core/`'da tek primitifle çözülür. §1 bunun listesi. Sonra mod-bazında "eksik fiil" (§2) geliyor: bazı modlarda oyuncunun bir kolu/parmağı boşa duruyor (TANKS nişan, BOMB fırlatma).

---

## 1. SİSTEMİK — önce bunlar (tek düzeltme, çok mod)

### S1. `Berabere = maç sonu` — 9 modda kazanan olmadan bitiyor `[V]`
- PONG: 120 sn dolunca `finishAsDraw()` → `endMatch(this, null,'timeout')` (`src/games/game.js:571-576`). 2-2 skorda maç berabere.
- TANKS: 90 sn'de 1+ tank hayattaysa `endMatchInGap(...,'no-survivor')` (`src/games/tanks.js:946-957`, `1005-1013`) → **raunt değil MAÇ** berabere.
- CURVE / BOMB / SNAKE / COLLAPSE / CROWN / HEIST / ZONE / ARCHER: `MAX_TIED_ROUNDS = 2` → üst üste 2 berabere raunt maçı bitiriyor (örn. `bomb.js:59,520-528`, `curve.js:45,884-892`, `archer.js:855-858`).
- Neden böyle: hiçbirinde **sudden death / overtime** yolu yok. Tek istisna TANKS'un halkası (`tanks.js:839-981`).
- **Çözüm (tek yer):** `src/core/roundLifecycle.js` içine `beginSuddenDeath(game)` — 2. beraberlikte maçı bitirmek yerine: kronometre kapanır, ilk puanı/eleme-olayı alan raundu alır, beraberlik bitmezse tek-eleme. Zaten **bütün view validator'ları `'OVERTIME'` gameState'ini kabul ediyor** (`archerView.js:129`, `bombView.js:110`, `snakeView.js:155`, `collapseView.js` vb.) → protokol/uyumluluk riski yok, sadece kimse o duruma geçmiyor.
- Kısıt: `world` paketine yeni alan yok; `gameState` enum'unda zaten mevcut. Pad şeridinde `hud.js` tek kelime + renk ("UZATMA") — AGENTS §5, kullanıcı kuralı: açıklama metni yok.

### S2. Eleme sonrası kilitlenme — 7 modda ölüm = izleme `[V]`
- `isAlive = false` satırları: `bomb.js:457`, `collapse.js:800`, `curve.js:833`, `ninja.js:886`, `snake.js:762`, `tanks.js:986`, `horde.js:1701`.
- Ortak katmanda **respawn/revive primitifi YOK** (`playerEntity.js` sadece `invulnTimer/spawnProt` alanı veriyor). Sadece HORDE (`horde.js:1720-1737` mezar) ve COLOSSUS (`colossus.js:490-505` canlandırma) kendisi yazmış.
- Raunt tavanları: NINJA 45 sn, CROWN 45 sn, HEIST 45 sn, COLLAPSE 60 sn, BOMB 60 sn, CURVE 75 sn, SNAKE 75 sn, ZONE 90 sn. Erken ölen → ~60 sn pasif. 4 kişilik koltukta bu, parti oyununun ölümü.
- **Çözüm A (ucuz, hemen):** raunt tavanını dinamik kısalt — hayatta kalan sayısı 2'ye düşünce kalan süre 0.5× hızla aksın (tek satır `tickRoundFlow` içinde, ağ alanı gerektirmez).
- **Çözüm B (asıl eğlence):** ortak `outButArmed` primitifi — elenen oyuncu **tek seferlik** sahayı etkileyen bir hamle yapar (motor kendi temas etti: BOMB'a yeni taşıyıcı atama, COLLAPSE'a "deprem", SNAKE/CURVE'a rakip yoluna kısa engeller, NINJA'ya 1 sn'lik "bağırma" reveal). UI: köşede tek chip + tap-to-cycle, **modal yok** (kullanıcı kuralı).
- Kısıt: kumanda simülasyon yapmaz (§6.3) → eylem yalnız `handleRemoteInput(slot, {action:'REVENGE'}) olarak gider, kararı host simüle eder. Paket bütçesi: tek bool/int, dirty-check 8 Hz'de zaten bedava.

### S3. Lider donması / camp-optimal modlar — 6 mod `[V kısmen]`
Doğrulanmış kanıtlar:
- ZONE: lider kendi türfinde durursa **kesilecek trail'i yok** → saat tükenene kadar dokunulamaz (`zone.js` kural seti; `TRAIL_CAP = 1500` `[A]` `zone.js:85` — 90 sn × 12,8 kare/sn ≈ 1,1k kare yürünür, tavana hiç ulaşılmaz → anti-turtle güvenlik devre dışı).
- HEIST: bankacı `carriedGold = 0` → ağırlık cezası yok, tam hız 190 (`heist.js:78-87`, `753-777`) → lider hiç kovalanmıyor.
- NINJA: hareket etmezsen görünmezsin, reveal sadece hareket/saldırıda (`ninja.js:837-843`) → bekleme optimal.
- COLLAPSE: center-hug + push öldürmüyor (`collapse.js:500-503` push, eleme sadece `:718-720` delik/off-grid) → hiçbir şey yapmadan hayatta kalma.
- CURVE: 75 sn'lik beraberlik kimseye puan vermiyor, 2 beraberlik maçı bitiriyor → pasif çizgi var (`curve.js:884-892`).
- BOMB: taşıyıcı ×1,16 hızlı (`bomb.js:746-762`) ve temas tek transfer yolu (`:818-851`) → herkes kaçarsa fitil 60 sn'de beraberlik.
- **Çözüm:** var olan iki primitifi core'a taşı ve moda bağla:
  - **Stall-breaker** (PONG'ta yazılı, işliyor): `game.js:686-741` — ilerleme yoksa nesneyi merkezle. BOMB/ZONE/HEIST/CROWN'a "hareketsizlik dedektörü" olarak genelleştir.
  - **Kapanan halka** (TANKS'ta yazılı, işliyor): `tanks.js:839-981` — COLLAPSE/HEIST/NINJA/CROWN için hazır çözüm; ölçek `minDim` üzerinden.
- **Yapma:** sahte "rubber-band" (geri düşmana gizli hız) — 4 koltukta hemen fark edilir, güveni kırar. Bunun yerine **nesnel zorlama** (halka, decay, hedef işaretlemesi).

### S4. Geri dönüş mekaniği sıfır, botlar lideri bazen görmüyor `[V]`
- HEIST botları HUNT kararında **yalnız `carriedGold` okuyor** (`src/ai/heistAI.js:23`, `:45-46`) → bankmış gerçek lideri kovalamıyorlar, endgame satılıyor.
- CROWN botları lideri kovalıyor (`crownAI.js` HUNTER), ZONE'da underdog'a motor tarafında yardım var (`zone.js:1126`, `:771-774`) → **tutarsız**. Mod-bazına gömülü yerine tek politika.
- Hiçbir modda skor/geri-düşme çarpanı yok (escalation = sadece zaman/halka).
- **Çözüm:** `src/ai/` ortak `leaderPressurePolicy(game, bot)` (skor liderini hedefle; `vaultGold`/`pct`/`crownHoldTime` dahil) + tek `catchUpScale` (host tarafı; örnek: son 15 sn'de sondaki oyuncunun pickup/rota bonusu). Paket değişikliği yok.
- EK (aynı yerden ucuz): TANKS `focusLeader` god botları lideri püskürtüyor ama **geri düşene yardım yok** (`tankAI.js:127-141`) — politikayı tek yere taşırsan iki taraf da düzelir.

### S5. Zaten yazılmış olan `climaxLevel` 5 modda hiç tetiklenmiyor `[V]`
- `roundLifecycle.js:270-296` climax nabzı/vinyeti `roundLimit` **veya ölüm** istiyor. ARCHER, CROWN, SNAKE, COLLAPSE, NINJA `roundLimit` tanımlamıyor (bazılarında ölüm de yok) → ortak doruk efekti bu modlarda ölü kod.
- **Çözüm:** her motora `roundLimit` ver (ARCHER 60, CROWN 45, SNAKE 75, COLLAPSE 60, NINJA 45) → efekt bedava gelir. 1 satırlık işler, görünürlük açısından en yüksek oran.

### S6. Ham piksel kuralları: aynı oyun telefonda masaüstünden farklı oynanıyor `[V]`
- AGENTS §3 "Ham piksel yazılmaz" ihlali ve **adalet sorunu**:
  - ARCHER: `ARCHER_CLOSE_DIST = 150` (`archer.js:62`), stun eşikleri 110, knockback 26 raw px (`archer.js:748-749`), AI mesafeleri 240/480/130 (`archerAI.js:13-14`) → `unit` 0.3–1.6 arası (`playfield.js:19-23`) olduğu için telefonda neredeyse **her isabet 2 puan**, masaüstünde 2 puan zor ulaşılır. Aynı vuruş farklı değer.
  - CURVE: kafa yarıçapı/hız `unit`-ölçekli ama çarpışma yarıçapları, BOMB yarıçapı 70 px ve grid hücresi 48 px raw (`curve.js:789`, `:812-814` vs `:494`, `:35`).
  - NINJA: `NINJA_RADIUS` (36) fx ölçeğinde literal kullanılıyor (`ninja.js:891`).
  - BOMB: dash 430 absolute (`bomb.js:71-74`).
- **Çözüm:** bu eşikleri `fieldRadius()/fieldSpeed()/bodyPx()`'e taşı (motorda hazır yardımcı var). Görsel değil **davranışsal** düzeltme → §7.3 kapısı (tam `npm run check`) gerekir.

### S7. Ortak katmanda olmayan, parti oyununda isteyen 3 şey `[A]`
- **Vuruş geri bildirimi katmanı:** çekirdekte damage-number modeli yok, `emitFloatingText` (`fxKit.js:375`) sadece serbest string; **hitmarker / kill-attribution / streak-combo** primitifi yok. (PONG'da `floatingTexts` hiç yok, ARCHER'da `kill` eventi hiç emission'lmıyor.)
- **Müzik/escalation:** `audio.js` döngü/müzik katmanı ve gerilim tırmanışı içermiyor (sadecek tek atımlık SFX + voice/jingle). ZONE/BOMB/NINJA'da "son 10 sn" sesli olarak hiç yükselmiyor.
- **Yıkılabilir zemin kaydı:** COLLAPSE'ın grid'i ile TANKS'un sabit AABB'leri ayrı dünyalar; ortak "tile/state haritası" olmadığı için hazard eklemek isteyen her motor baştan yazıyor.
Bunlar §1'den sonra, **tek seferlik core işi** olarak değerlendirilmeli (motorlara kopyala-yapıştır yasak, §6.2).

---

## 2. MOD MODA "EKSİK FİİL" (en yüksek tek-öneri değeri)

Her satır: **eksik olan → kanıt → neden eğlenceli → maliyet.**

| Mod | Eksik olan (bunu ekle) | Kanıt | Neden tam oturur |
|---|---|---|---|
| **TANKS** | **Ayri taret nişanı + hareket ederken ateş.** Şu an namlu gövde = otomatik 2,8 rad/sn dönüyor, yön koltuğa göre sabit ve hiç yeniden rollenmiyor. | `tanks.js:475-476` (`rotationSpeed 2.8`, `spinDirection = i%2`), `:922` tek açı; **nişan importu yok**. Hâlbuki `BaseGame.setAimVector` `:671`, `handleSlotAimStart` `:700`, remote aim `:1438` jenerik ve hazır. | Telefonda joystick var ama oyun onu kullanmıyor; tek beceri "ne zaman bırakacaksın"a indirgenmiş. Ayri taret = nişan, blöf, köşe-topu aynı anda gelir. En yüksek eğlence/maliyet oranı. |
| **BOMB** | **Fırlatma (throw).** Bomba yalnız vücut temasıyla geçiyor; dosya başlığı "Passing Physics" diyor ama fırlatma fiili yok. | `bomb.js:405-416` `transferBomb` tek yol, `:818-851` temas döngüsü; `throw` yok. | Hot-potato'da "uzaklaştırma" fiilinin olmaması oyunun gerilimini düzleştirir: taşıyıcıya yapışan kazanıyor. Şarj + yön (aim API hazır) + saçılma = anında kitle-panik anı. Ek bonus: S3'un stall-breaker'ı ile "kaçarak berabere" kapanır. |
| **ARCHER** | **Raunt başına skor sıfırlama (bu bir bug).** | `startRound()` `archer.js:240-296` `this.scores`'ı **sıfırlamıyor**; skor puanı vuruşta artıyor `:734`; raunt kazananı `this.scores` üzerinden seçiliyor `:829-836`; `roundWins` ayrı tutuluyor `:849`. | 2. raunt bağımsız bir müsabaka değil — 1. rauntu alan tekrar kazanıyor. Tek satır (`this.scores = [0,0,0,0]` startRound'a) + skor tablosunda "bu raunt" ayrımı. Önce bunu yap, sonra geri kalan ARCHER işlerini. |
| **ARCHER** | `tap-fire` bedava: tap = garantili 0,5 şarj + en yakın insana auto-aim. | `archer.js:474-478`, `autoAim.js:10-25` (sadece `slotType==='human'` hedef). | Tek parmakla "her yere tap" geçerli strateji → nişan becerisi değersizleşiyor. Şarj tabanlı hasar kademeli yap ya da tap'i düşük isabet cezasıyla bağla. |
| **CROWN** | **Sıradan temas tacı düşürmesin** (yalnız tackle/koşa-koşa temas düşürsün) + harita randomizasyonu. | `crown.js:1255-1265` "taçlıya değen düşürür" (dash şart değil); `selectedMapIndex` default 0 ve otomatik randomize yok (`:51-57` preset'ler duruyor). | 2 sn cooldown'lu tackle'ın değeri kalmıyor: yürüyüp dokunmak aynı işi yapıyor. Ayrıca hep aynı harita → 3. rauntta ezber. |
| **ZONE** | **Lider erozyonu:** öndeki oyuncunun türfü kendi kendine geri çözünür ya da kesilemezse bile "hedeften kaçış" bedeli olur. `TRAIL_CAP`'i erişilebilir değere çek. | `zone.js:85` `TRAIL_CAP=1500` `[A]` (90 sn'de max ~1,1k kare); kesim kuralı sadece trail'e bağlı (`:876`, `:1036`), `awardKillBounty` `:687` | Şu an %38'de durup beklemek kazanıyor; bu, oyunun bütün kovalamacasını iptal ediyor. İzleyici için "kesilebilir lider" görünür kılınmalı (tek ikon, AGENTS §5). |
| **HEIST** | **Botlar bankmış lideri avlasın** (`vaultGold` oku) + baskın 1 sn yerine riskli/rakamlı olsun. | `heistAI.js:23`, `:45-46` sadece `carriedGold`; raid `heist.js:791-810` (≥1,0 sn kontested). | Yağma oyununda en zengin adamı kimse kovalamıyor = son 15 sn ölü. Bot avı + ev-turfü bonusunun azaltılması tek pakette çözülür. `carriedItems` ölü alan (`:740`, `:799`) temizlenir. |
| **NINJA** | **Görünmezliğin bir bedeli/ölçüsü olsun** (smoke sayacı, "ne kadar sessiz kalırsan o kadar tespit" ya da hareketsizken yavaş reveal). | `ninja.js:837-843` (durmak = fade-out, hareket = fade-in), fenerler `:256`, `:486` | Şu an "olduğun yerde bekle" oyunun kazanma yolu; 45 sn bağırma olmadan berabere bitiyor. Ayrıca tek sabit harita (`:234-240`) — 5 obstacle, varyant yok. |
| **COLLAPSE** | **Kozmetik düşen blokları gerçek tehlike yap** + push'un öldürme yolunu aç (stomp rakibin altındaki karo kırar). | `collapse.js:612-627` bloklar "spinning 3D" ama kozmetik `[A]`; stomp yalnız itiyor `:500-503`; eleme sadece delik/off-grid `:718-720`; botlar hiç stomp yapmıyor (`collapseAI.js`) | "Kimse kimseyi sahadan itemez" → rauntlar timeout tie ile bitiyor (S1'e gidiyor). Düşen bloklar zaten çiziliyor; onlara fizik vermek hazır görselle gelen en büyük oynanış farkı. |
| **SNAKE** | **Kill kredisi + uzunluk skorun parçası olsun.** | `snake.js:761-785` `eliminatePlayer` **hiçbirine puan vermiyor**, sadece meyve drop; skor yalnız son-kalan `:814-834`; `foodCount` `:672` yazılıyor hiç okunmuyor `[A]`. | Rakibin önünü kesip intihara zorlayan oyuncu hiçbir şey kazanmıyor → savunma/beceri ödülü yok. "Son temas eden = kill" kuralı oyunun karakterini değiştirir. |
| **CURVE** | **Ölmek rakiplere +1 vermeyi bıraksın** (kill kredisi) + pasif beraberlik çizgisini kes. | `curve.js:846-853` hayattaki her rakibe +1; `:884-892` 2 tie → maç berabere | 4 kişide raundu genelde 2. ölüm belirliyor; kalan ikisinin savaşma sebebi yok. Ayrıca ölmek rakibe hediye → "ölmemeye" değil "ölmeye" teşvik. |
| **PONG** | **SPIN'i zamanlama fiili yap** + timeout'ta maç berabere bitmesin (S1). | spin penceresi 6,0 sn vs uçuş ≤1 sn (`game.js:193-203`), yön bazen coin-flip (`ball.js:451-453`); cooldown 20 sn / raunt 120 sn; `game.js:571-576` timeout → `endMatch(null)`. | Şu an spin "körükörüne basılıyor" — isabetli bir read ödülü yok. Pencereyi topun geliş süresine bağla (etkili: çarpışma öncesi ~0,8 sn'lik "window"). Eleneen koltuk 120 sn izliyor (S2). |
| **HORDE** | **Dalga kronometresi saklanmayı ödüllendiriyor** + BLADE'in sonsuz dergi + solo ölüm = anında kayıp. | `horde.js:658-660` → `forceClearWave()` `:1858-1863` düşman+mermileri **cezasız** siliyor, puan yok; `hordeConfig.js:72-90` BLADE `Infinity` ammo; `:651-653`, `:1714` `alivePlayers===0` → `endMatch(false)`. | Ko-op'ta "bir oyuncu tek başına ölürse takım kaybeder" parti grubu için sert; zamanlayıcı da "hiç savaşmadan 90 sn" seçeneği veriyor. Kronometre dolunca **avcı dalga** spawn et (kaçmak değil savaşmak zorunda kal), veya dolma = raunt başarısız. |
| **COLOSSUS** | **Sahada kaynak yok** (can/ammo drop'u) + ölü kod `PILLAR_STAGGER_BONUS` + downed = ücretsiz güvenlik. | `colossusConfig.js:173-177` ve pickup yok (upgrade/pickup sistemi motorun içinde **hiç yok**); `PILLAR_STAGGER_BONUS: 60` tanımlı ama **hiç okunmuyor** `[A]`; `colossus.js:580`, `:655`, `:684`, `:718` boss saldırıları `isDowned` oyuncuyu atlıyor; `hasShieldPhase` üç boss'ta da `true` → `colossus.js:618-621` ölü dal. | Boss savaşında "devrilen arkadaş ölü ama dokunulmaz" = aciliyet yok. Kaynak crate + `PILLAR_STAGGER_BONUS`'u gerçekten bağlamak (boss'u direğe sürükleyen oyuncuya +stagger) hazır tasarım niyetini tamamlar. Ayrıca COLOSSUS'ta **haptics hiç yok** (fx'lerde `haptic:` alanı set edilmiyor). |

---

## 3. Önerilen uygulama sırası (batch'ler, her biri bağımsız gönderilebilir)

**Batch A — küçük, yüksek oran (bug + bedava kazanım):**
1. ARCHER raunt skorlarını sıfırla (`archer.js:240`) — tek satır, maç yapısını onarır.
2. `roundLimit` ekle → `climaxLevel` efektini 5 moda aç (S5).
3. HEIST botlarına `vaultGold` avı (`heistAI.js:23,45`).
4. CROWN haritasını raunt başına randomize et (`crown.js:51-57`).
5. Ölü iskeleti temizle: `consecutiveWallBounces` (yazılıyor/okunmuyor, `ball.js:70`), `tank.shield/stunTimer` (hep false, `tanks.js:1283-1284`), `snake.seg.isGap`, `player.relicTimer` (`zone.js` yazmıyor, `zoneView.js:85` okuyor), `p.carriedItems`, `heist.js:636-638` unreachable, `CURVE_NAMES`/`ARCHER_NAMES`/`CROWN_NAMES`, `entityStatus.drawRadialArc`/`drawCompactVitals` kullanımsız, `PILLAR_STAGGER_BONUS`, `LEGIBILITY_PX`/`AUTO_RELOAD_DELAY` (COLOSSUS), `CURVE_FIELD_TILES` alias.

**Batch B — ortak katman (`src/core/`, sonra motorlara bağlanır):**
6. `beginSuddenDeath` / overtime (S1) + pad'de tek kelime durum.
7. Paylaşılan **compulsion** primitifi: stall-detector + kapanan halka (PONG/TANKS koddan çıkar).
8. `leaderPressurePolicy` + `catchUpScale` (S4).
9. Out-but-armed / kısa-revive primitifi (S2) — önce Çözüm A (dinamik raunt süresi), sonra Çözüm B.
10. Birim normalizasyonu (S6) — `unit`-bağımsız eşikler.

**Batch C — mod fiilleri (sıra: en yüksek eğlence → en niş):**
11. TANKS ayri taret. 12. BOMB throw. 13. SNAKE kill kredisi. 14. COLLAPSE düşen-blok fiziği + lethal push. 15. CROWN tackle kapısı. 16. ZONE lider erozyonu. 17. NINJA görünmezlik sayacı. 18. CURVE skor teşviki. 19. HORDE zamanlayıcı sonucu + BLADE dergi. 20. COLOSSUS kaynak crate + pillar stagger + haptics. 21. PONG spin window.

---

## 4. YAPMA listesi (sözleşmeye ya da hisse zararlı)

- **Modal ile oynatma:** oyuncu seçeneği = tap-to-cycle + küçük inline chip. Açıklama/alarm metni, oynama alanını kaplayan hiçbir şey (AGENTS §5 + kullanıcı kuralı).
- **Salt görsel yeni ağ alanı** (§6.4). `world` paketi zaten ZONE'da 64×64 RLE grid taşıyor (`zoneView.js:94`) — bütçenin en yükseği orada.
- **Kare başına tahsis** (§6.5): kill-feed/streak/damage-number katmanı yazılacaksa `fxKit`/`fxRuntime` gibi **havuzlu** olmak zorunda. Uyarı: mevcut motorlarda bilinen ihlaller var — `ball.js:216` trail unshift, `game.js:541/593/645` `filter`, `curve.js:620-634` segment push + `performance.now()`/seg, `tanks.js:1274-1290` render'da `map`, `collapse.js:861` grid rebuild, `archer.js:914` spread+filter, `physics2d.js:302-306` `candidates`+`sort` (ok × engel × kare). Yeni özellik bunları **büyütmesin**.
- **Hissedilir rubber-band** (S3'te açıklanan): nesnel zorlama tercih et.
- **HORDE hit-stop'u yeniden açma**: `horde.js:633-638` bilinçli kapalı — sorgusuz geri getirme.
- Mod dallarını `main.js`/`gamepad.js`'e yazma (§6.1/§2); yeni fiil = `engineRegistry` schema + `handleRemoteInput` dalı.
- Her motor LOCAL'da 4 köşe dokunmatik + klavye ile tam oynanmalı (§2) — yeni fiil koltuk başına tek tuş/tek chip'e indirgenebilir olmalı.

---

## 5. Kanıt/ölçüm tarifesi (eğlence iddiasını sayıya bağlama)

`server.ssrLoadModule('/src/games/<mod>.js')` + 16,67 sn'lik `update(t)` döngüsü ile 30–60 sn simülasyon (mevcut tarif: `tests/hordeEngine.test.mjs` stub'ları). Ölçülecekler:
- **Pasiflik oranı:** bot+insan inputsuz bırakılan rauntlarda `score` delta'sı ve tie/timeout ile biten raunt yüzdesi → S1/S3'ün gerçek kanıtı (simülasyonda "hiçbir şey yapma" kazanıyorsa o mod bozuk).
- **Ölü bekleme süresi:** `isAlive=false` anından raunt sonuna kadar ortalama saniye → S2 hedefi < 15 sn.
- **Aygıtlar arası fark:** 844×390 ve 1280×720'de aynı girdi setiyle skor/kill dağılımı farkı → S6 kanıtı.
- Değişiklik sonrası orantılı doğrulama (§7): tek mod fiili → `node --test tests/<mod>.test.mjs`; `src/core` dokunuşu → `npm run check`.

---

## 6. Karar durumu (kullanıcı 2026-10-03)

1. ~~Eleme sonrası~~ **KARAR: elelenen bekler, raunt kısaltılmaz.** S2 rafa kalktı; "kısaltma" kelimesi içeren hiçbir madde uygulanmayacak.
2. **Berabere hâlâ açık:** S1 (overtime/sudden death) maçyı *uzattığı* için öncelik listesinin başında kalabilir — ama sadece "yeni içerikle" birlikte (bkz. §7 M4 final rauntu), kuru kural sıkıştırmasi olarak değil.
3. **HORDE/COLOSSUS "tek ölüm = takım kaybı":** soru hâlâ açık.

---

## 7. YENİ İÇERİK — yeni nesneler, yeni mekanikler (asıl istenen bu)

Kural: aşağıdaki her madde **bugün var olmayan bir şey ekliyor**; hiçbir mekaniği yeniden bağlamıyor.
Hiçbiri raundu kısaltmıyor — K3/M1/M2/M4 tam tersi, raundu ve maçı *dolduruyor*.

### 7.1 K1 — TAŞINABİLİR EŞYA (yeni nesne sınıfı: 3 durumlu fizik nesnesi)
Bugün sahada iki tür nesne var: **dokununca tüketilen pickup** (`pickupSystem.js`) ve **sabit engel** (`arenaKit.buildLayout`).
Üçücüsü yok: **yerde duran → kavranan → fırlatılan** nesne. Bu, parti oyunlarında en çok kahkaha üreten kategori.

- Durumlar: `GROUNDED → HELD(holderIdx) → AIRBORNE(vx,vy,spin) → SETTLED(okul: kısa süre engel)`.
- Fiiller: otomatik alma (temas + el boş), **fırlatma** (`BaseGame` aim API'si zaten jenerik: `setAimVector` `BaseGame.js:671`), bırakma.
- Fizik: `physics2d.getProjectileSubsteps`/`resolveAABB`/`clampToArena` üzerinden süpürülmüş çarpışma (motorlarda örnek var).
- GC: `fxRuntime` kalıbıyla **sabit havuz** (8 nesne); kare başına tahsis yok.
- Paket: `props: [[x, y, r, state, holder, rot]]` ≤ 8 → 30 Hz'de ~90 bayt, bütçeye girer (AGENTS §4).
- Mod kullanımı: **COLLAPSE** deliği kapatmak için tahta bırak, **TANKS** düştüğün yere siper bırak, **BOMB** kutuyu bombadan önce kapıya at, **HEIST** çuvalı ırak fırlat, **ZONE** taşıyla rakibin izini doldur, **NINJA** gürültü çıkaran kutuyu atla dikkati dağıt, **CROWN** taç taşınıp bir köşeye saklanamaz hâle gelir, **HORDE/COLOSSUS** zaten itilebilir varil istiyordu (`horde-backlog` açık maddesi) — aynı nesne iki modda bedava.

### 7.2 K2 — BAŞBELASI NPC (oyuncu olmayan, horde-düşmanı olmayan üçüncü taraf)
Bugün 11 FFA modunda sahada ya sadece oyuncular ya (HORDE/COLOSSUS'ta) sadece spawn düşmanlar var. **Kural bozan tarafsız varlık** hiç yok. Bu, "kimse oynamıyor" durumunu ceza değil içerikle çözen tek yol.

- 4 imza, aynı FSM iskeleti (4 durum: `ROAM → GRAB → FLEE → REVERT`), `botView.createReadOnlyView` + `physics2d.firstFreeDirection` ile yürür:
  - **HIRSIZ:** bir nesneyi (bomba/taç/altın/relic) kapıp kaçar; onu vuran nesneyi geri alır **+1 bonus**. Hareketsizliğe karşı doğal ceza.
  - **BULDOZER:** rauntun yarısında kenardan girip liderin bölge/izini süpürür; geçeceği hat önceden telegraflanır.
  - **GÖLGE AVCISI:** yalnız **görünmez/kamp** yapanı koklar; NINJA'daki "dur ve kazan" dejenere stratejisini nesneyle bitirir.
  - **AŞIRMACI:** sabit hatla arena boyunca geçen vagon; temas her iki tarafa da knockback verir, ezilmemek konum Alma becerisi olur.
- Maliyet: tek çekirdek modül (`core/nuisanceNpc.js`) + motora bir handler; 1 varlık = paket başına ~5 alan.

### 7.3 K3 — KAZANÇ NESNESİ (yok: skoru eleme dışında bir şey veren hiçbir nesne yok)
13 modun skor formülü ya "son kalan" ya "eleme". **Bir nesneye dokunmak/geçmek puan verseydi**, rauntlar uzar ama sıkılmaz — sürekli bir "bir sonraki hamle" olur.

Tek çekirdek tip: `ScoringGate { x, y, radius, value, axisMotion, cooldownSec }`, modlar arası fark yalnız çizim + konum kuralı.
- **CURVE / SNAKE:** hareketli **halka** — içinden geç +1, halka 3 geçişten sonra ışınlanıyor. Hayatta kalma, yarışa dönüşür (en büyük oynanış değişimi).
- **ARCHER:** raylı **hedef trolley** — 3 puanlık hareketli hedef; köşe kampını bozar.
- **CROWN / ZONE:** **taht/podyum** — kral tahtın içindeyken sayaç 2× hızlanır; kaçmak yerine konum Alma derinleşir.
- **HEIST:** **kaçış aracı** — ıraktaki bir araçla çıkmak: çuvalı 2× bankalarsın ama 6 sn sahasın dışındasın.
- **BOMB:** **çan** — çana çarpan fitili 3 sn dondurur (takım arkadaşı için altın an).
- **NINJA:** **kum saati/gong** — görünmezken bile puan veren tek nesne; "görünmez kal"ı ekonomik olarak anlamsız kılar.
- **TANKS / PONG:** **can halkası / santhalı kapı** — ortadaki geçişten 3'üncü mermi ya da "ağır top" yüklenir.
- **PONG ayrıca:** topu **rally ≥ 12'de yakala ve fırlat** fiili (aynı `ScoringGate`'in "catch" varyantı) — mevcut SPIN'in anlamsız 6 sn penceresine gerçek bir zamanlama becerisi kazandırır.

### 7.4 K4 — SAHA OLAYI (rauntun içinde 3 perde; aynı uzunluk, üç kat doluluk)
Raunt saatinin **%40 ve %70** noktasında, havuzdan seçilen **bir** scripted olay devreye girer. Köşe kelimesi + renk (UI kuralı: açıklama metni yok, oynama alanını kaplayan hiçbir şey yok).
- Havuz (8): `BLACKOUT` (3 sn: sadece avatar rim ışığı) · `CONVEYOR_STORM` (6 sn sürüklenme) · `FLOOD` (alçak karolar su) · `BOULDER_RUN` (kayan top) · `SUPPLY_RAIN` (3 K1 nesnesi düşer) · `CROSSWIND` (tek yöne rüzgâr) · `TRAFFIC` (Aşırmacı NPC girer) · `SPIN_FIELD` (saha 4 sn'de 90° döner).
- Çekirdek maliyet: `core/fieldEvents.js` — olay kuyruğu + motor başına bir `onFieldEvent(kind)` handler'ı.
- **Görsel olaylar 0 bayt** (client-side juice, AGENTS §3 "sıfır ağ maliyeti" ilkesine uyuyor); mekanik olaylar yalnız `eventPhase` int.
- Bu madde tek başına "uzun ve keyifli" isteğinin en büyük kaldıracı: 60-90 sn'lik raunt artık üç perdeli.

### 7.5 Maç katmanı (uzunluk buradan gelir)
- **M1 RAUNT ARASI SİLGÂH (draft):** her raunt sonrası 3 seçenekten 1 token, kumandada tap-to-cycle chip (modal yok). Kalıptaki kanıt: HORDE'un `ROUND_PAUSE` silah deposu (çalışıyor ve eğlenceli). Etki: kimlik + geri dönüş + "bir raunt daha" isteği. Maliyet: registry schema + `tokens[]` küçük dizisi.
- **M2 HARITA HAFIZASI:** COLLAPSE delikleri, TANKS'ta kırılan duvarlar, ZONE türfü rauntlar arasında **kalır** → maçın bir yayı olur. Motor-içi, 0 protokol.
- **M3 KİŞİSEL GÖREV:** `controllerStatus.js` zaten koltuk-bazında dizi okuyor (`data.chg[i]` deseni) → telefonda **sadece sana** yazan küçük hedef şeridi ("3 kez bankala, yakalanmadan"). **Dürüst not:** 8 Hz yük tek yayın (`main.js:438`, `stateSync.broadcastGameStateIfNeeded`) → sır yalnız *sosyal* olarak özel; TV yüzeyi hedefi asla göstermemeli.
- **M4 FİNAL RAUNTU:** biri `targetScore-1`e ulaşınca bir sonraki raunt modifye girer (çift puan + bir K4 olayı + bir K2 NPC). Maç uzamaz ama **zirvede** biter; berabere-bitme sorunu da (S1) doğal çözülür.

### 7.6 Önerilen ilk kesim (değer/maliyet)
1. **K3 Halka/Taht/Trolley** (1 çekirdek tip, 4 modda kullanılır, raundu uzatıp doldurur).
2. **K4 Saha olayı** (çekirdek + 2-3 olayla başla; görsel olaylar bedava).
3. **K2 HIRSIZ NPC** (camp/freeze sorununu içerikle çözer; CROWN/BOMB/HEIST/ZONE).
4. **K1 Taşınabilir eşya** (fizik + fiil; en pahalısı, en çok kahkaha üreteni).
5. **M1 Silgâh** + **M4 Final rauntu** (maç katmanı; sonra gelir).

---

## 8. BUG KAYITLARI — 2026-10-03 düzeltildi

| # | Bug | Kanıt | Düzeltme |
|---|---|---|---|
| B1 | ARCHER'de raunt kazananı **birikmeli** skordan seçiliyordu → 2. raunt 1. raunt liderine yazılıyordu | `archer.js:240` `startRound()` `scores`'ı sıfırlamıyor; `:734` vuruşta artıyor; `:829-836` kazanan `scores`'tan | `roundScores[]` eklendi (kurucu/`resetMatch`/`startRound` sıfırlar, vuruşta `scores` ile birlikte artar, `handleRoundEnd` artık ondan seçer). Maç toplamı skorboard/paket semantiği korundu. |
| B2 | ARCHER berabere maçı TV'de **"ŞAMPİYON"** basıyordu | `archerWorldView.js:87` `frame.matchDraw` okuyor; `archerView.js` paketi alanı hiç taşımıyordu | Pakete `matchDraw: game.matchDraw === true` eklendi. |
| B3 | TANKS avatar kalkan göstergesi **hiç yanmıyordu** | `tanks.js:1283` + `tanksView.js:54`: `eshield: tk.shield === true` — motorun gerçek alanı `hasShield` (`tanks.js:498,878,1187`), `.shield` diye alan yok → hep false; avatar çağrısı `tanksView.js:633` onu okuyor | `eshield` alanı **tamamen kaldırıldı** (2 mirror + validator `:112`), avatar `tank.shield`'dan okuyor. Paket bir boolean küçüldü. |
| B4 | ZONE'da relic alan avatarın **"excited" ifadesi hiç tetiklenmiyordu** | `zoneView.js:85` `p.relicTimer` okuyor; `zone.js` bu alanı **hiç yazmıyordu** | `ZONE_TUNING.RELIC_HYPE: 2.0` + `collectRelic`'te set + oyuncu güncelleme döngüsünde eritme + init'te `relicTimer: 0`. |
| B5 | HEIST timeout dalında **ulaşılamaz 3 satır** | `heist.js:636-638` (iki `return` sonrası) | Silindi. |

**Doğrulama:** hedefli paket testleri 12/12, `npm test` 702/702, `npm run check` bu değişikliklerde yeşil.

### 8.1 Doğrulanmış ama DOKUNULMADI (karar senin)
- **CİHAZ-BAĞIMLI HAM PİKSEL (adalet bug'ı):** `ARCHER_CLOSE_DIST = 150` (`archer.js:62`) → telefonda neredeyse **her** isabet 2 puan, masaüstünde zor 2 puan; stun eşikleri `110` (`:741`), knockback `26` (`:748-749`), slip `320`, AI `240/480/130` (`archerAI.js:13-14`) hepsi raw px; CURVE çarpışma yarıçapları + BOMB yarıçapı `70` (`curve.js:789,812-814`). AGENTS §3 ihlali. Düzeltmek masaüstü zorluğunu **yeniden ayarlar** (ve görsel baseline'ları kaydırabilir) → onayınla ayrı adım.
- **FLAKY TEST:** `tests/matchOverEnter.test.mjs` → "enter = 0: kart opaklık 0 ile başlar" 3 tam koşumda ~1 kez düşüyor; **tek başına hep geçiyor**; sadece `src/ui/hud.js` import ediyor (dokunduğum dosyalarla ilgisi yok). alpha yazımı tek yer (`hud.js:1256`), kart içinde `Math.random` yok. Kendi HUD commit'inin bölgesi — körlemesine "tamir" etmek istemedim.
- **TANKS `stun`:** motorda stun mekaniği hiç yok → mirror hep false. Bug değil içerik eksiği (K2/K3 ile gelirse anlamlı olur).
- **`ball.js: consecutiveWallBounces`** yazılıyor, hiç okunmuyor → silmedim; §7.3 PONG "ağır top / yakala-fırlat" fikri için doğal kanca.
- **Yanlış `[A]` iddiaları (ölü DEĞİLLER, silme!):** `entityStatus.drawRadialArc`, `entityStatus.drawCompactVitals`, `colossusConfig.LEGIBILITY_PX`, `CROWN_NAMES` — hepsinde gerçek tüketici var. **Gerçek ölü:** `CURVE_NAMES`, `ARCHER_NAMES`, `colossusConfig.PILLAR_STAGGER_BONUS` (1 hits = tanım), `heist.js carriedItems` (6 hits = hepsi yazım), `zone.js` eski `relicTimer` (B4 ile canlıya bağlandı).

