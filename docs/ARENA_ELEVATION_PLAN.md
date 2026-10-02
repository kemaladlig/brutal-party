# BRUTAL PARTY — Living Diorama & Arena Elevation Plan
> **Hedef:** Brutal Party'nin oyun alanlarını basit bir "üzerinde koşulan 2D zemin" olmaktan çıkarıp; **Boomerang Fu, Mario Party, Smash Bros ve Brawl Stars** standartlarında, fiziksel derinliği olan, nefes alan, maçın hikayesini yansıtan ve çatışmaya tepki veren birinci sınıf bir **Yaşayan Masaüstü Dioraması (Living Tabletop Arena)** haline getirmek.

---

## 1. Temel Felsefe & Mimari İlkeler

```
┌────────────────────────────────────────────────────────────────────────┐
│                   YAŞAYAN DİORAMA ARENASI ANATOMİSİ                    │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   [ 1. SAHA DIŞI & AMBİYANS ] (Masaüstü Derinliği, Halo, Climax Nabzı) │
│       │                                                                │
│       ▼                                                                │
│   [ 2. KALIN DİORAMA KENARI ] (Pahlı Kütle Duvarı, Çarpma Esnemesi)    │
│       │                                                                │
│       ▼                                                                │
│   [ 3. ZEMİN & MALZEME DOKUSU ] (Işık Havuzu, Taktik Hatlar, Mat Şıklık) │
│       │                                                                │
│       ▼                                                                │
│   [ 4. SAVAŞ İZLERİ (DECALS) ] (İs Yanıkları, Patinajlar, Konfetiler)  │
│       │                                                                │
│       ▼                                                                │
│   [ 5. DİNAMİK IŞIK HAVUZLARI ] (Bomba Fitili, Taç Aurası, Mermi İzi) │
│       │                                                                │
│       ▼                                                                │
│   [ 6. 2.5D VE REAKTİF ENGELLER ] (Darbe Çatlakları, Talaş Sıçraması)  │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### Değişmez Mimari Kurallar (AGENTS.md & Core Kuralları)
1. **12 Oyun İçin Tek Merkez (§4):**
   - Her oyun moduna özel yama veya `if/else` dalı **YASAKTIR**.
   - Bütün saha çizimleri ve efektler `src/core/fieldKit.js`, `src/core/arenaKit.js` ve `src/core/fxKit.js` üzerinden yürür. Tüm mini oyunlar tek hamlede aynı konsol kalitesine ulaşır.
2. **Sıfır Ağ Ek Yükü (§6):**
   - Zemin izleri, ışık halkaları ve kenar esnemeleri tamamen istemci tarafı (client-side juice) olarak üretilir. 30 Hz world packet'ine veya Supabase/WS relay paketlerine tek bir byte bile eklenmez.
3. **Krem & Kontrast Bütçesi (§4, `fieldKit.test.mjs`):**
   - Zemin rengi $L^* \in [80, 97]$ aralığında kalır; sarı (#FFD24A) gibi açık renkli avatarlar zeminde kaybolmaz. Derinlik koyulukla değil, kroma ve ince temas gölgeleriyle (AO) verilir.
4. **60 FPS & Sıfır GC Çöpü Garantisi:**
   - Kare başına yeni `CanvasGradient`, `Path2D` veya nesne tahsisi yapılamaz. Statik zeminler offscreen canvas'a bir kez pişirilir (`fieldKit bake`), dinamik efektler ise önceden ayrılmış havuzlar (object pool) ve sprite damgaları üzerinden çizilir.

---

## 2. Faz Faz Uygulama Yol Haritası

---

### FAZ 1 — Dokunsal Kütle Kenarları & Kinetik Duvar Reaksiyonu
> **Amaç:** Sahayı düz bir çizgi çerçeveden çıkarıp, masanın üzerinde duran kalın, pahlı, fiziksel bir ahşap/metal/akrilik diorama tepsisi hissi vermek ve duvar çarpışmalarını elastik bir enerjiye dönüştürmek.

* **Merkezi Dosyalar:** `src/core/fieldKit.js` (`paintTrayEdge`, `paintBackdropLayer`), `src/core/fxKit.js`
* **Etkilenen:** 12 Oyunun Tamamı

#### Yapılacaklar:
1. **Kalın Pahlı Diorama Kenarı (Chunky Beveled Curb):**
   - Tek çizgi `paintTrayEdge` yerine; dışa doğru katmanlanan 2.5D derinlikli bordür dili:
     - İç Duvar Gölgesi (derinlik bandı, `edgeInk`).
     - Üst Işık Pahı (speküler açık yansıma, `edgeLight`).
     - Dış Gövde Kalınlığı (sahanın dış masaya oturan 3–5 mm'lik yükseltilmiş kenar profili).
2. **Kinetik Duvar Esnemesi & Dalgalanması (Kinetic Wall Rebound):**
   - Karakter duvara tosladığında (`DASH`, `TACKLE`, yüksek hızda çarpma) veya mermi sektiğinde:
     - `fxKit.emitFx('WALL_HIT', { x, y, nx, ny, intensity })` tetiklenir.
     - Çarpma noktasındaki kenar 1-2 kare içeri doğru elastik mikro-esneme yapar.
     - Çarpışma noktasından kenar boyunca iki yana doğru hızla sönen mikro-enerji dalgası (ripple) yayılır.
3. **Dinamik Kıvılcım & Toz:**
   - Taş duvarlarda 2-3 adet minik gri taş tozu; metalik/neon sahalarda 2-3 parlak sarı/turuncu kıvılcım zerresi.

---

### FAZ 2 — Canlı Savaş Alanı & Kalıcı Çatışma İzleri (Dynamic Battle Scars)
> **Amaç:** Parti oyununun en heyecan verici tarafı maç uzadıkça sahanın bir "savaş alanına" dönüşmesidir. Boş ve steril zeminler yerine raunt boyunca yaşayan bir mücadele hafızası oluşturmak.

* **Merkezi Dosyalar:** `src/core/fxKit.js`, `src/core/fieldKit.js`, `src/core/roundLifecycle.js`
* **Etkilenen:** Tüm Çatışmalı Modlar (TANKS, BOMB, ARCHER, HEIST, NINJA, HORDE, SNAKE)

#### Yapılacaklar:
1. **Zemin Çatışma Katmanı (Decal System):**
   - Varlıkların (karakterler, mermiler) ALTINDA, statik zemin pişirmesinin ÜSTÜNDE yer alan hafif, halkalı bir tampon dizi (ring buffer, maks 32 decal).
   - Kare başına sıfır bellek ayrımı: Önceden tahsis edilmiş dizi, bitenler ezilir.
2. **İz Türleri (Battle Scar Signatures):**
   - **Patlama İsi (Scorch Marks):** Bomba patlamalarında veya tank mermisi infilaklarında zeminde kalan, merkezden dışa doğru yayılan yarı saydam organik yanık lekesi (4-6 saniyede yavaşça solar).
   - **Patinaj & Fren Çizgileri (Skid Marks):** Hızlı yön değişimlerinde, tackle veya dash atıldığında zeminde kalan çift yönlü silik lastik/ayak sürtünme izleri.
   - **Boya / Konfeti Sıçramaları (Splatters):** Vurulan avatarların kendi renginde zemine dökülen minik renkli pul veya leke zerrecikleri.
3. **Raunt Temizliği:**
   - Raunt bittiğinde (`START_ROUND` / `ROUND_TRANSITION`) tüm decal katmanı yumuşak bir fade-out ile sıfırlanır, yeni raunt tertemiz açılır.

---

### FAZ 3 — Hacimsel Dinamik Işık Havuzları (Volumetric Light Pools)
> **Amaç:** Sahaya sinematik bir gece/arcade aydınlatması kazandırmak; kritik tehlike ve üstünlük durumlarını ışık diliyle oyuncunun bilinçaltına işlemek.

* **Merkezi Dosyalar:** `src/core/arenaKit.js`, `src/core/fxKit.js`, `src/core/avatarInGame.js`
* **Etkilenen:** BOMB, CROWN, TANKS, ARCHER, HEIST, NINJA

#### Yapılacaklar:
1. **Tehlike Işık Havuzu (Danger Pulse - BOMB):**
   - Bomba taşıyıcısının ayaklarının altında, fitil kısaldıkça kırmızı/turuncu renkte büyüyüp hızlanan nabız gibi atan radyal ışık havuzu.
   - Bomba devredildiğinde ışık havuzu anında yeni taşıyıcının altına geçer; sahadaki herkes tehlikenin nerede olduğunu doğrudan zemindeki ışıktan okur.
2. **Asalet & Liderlik Spotu (Royalty Glow - CROWN & HEIST):**
   - Tacı taşıyan veya en çok külçeye sahip olan oyuncunun altında zarif, yumuşak altın sarısı bir zemin spotu.
3. **Mermi Işık İzi (Tracer Illumination - TANKS & ARCHER):**
   - Roket veya ok hızla geçerken altındaki zemini 15-20 px çapında sıcak bir ışık huzmesiyle anlık aydınlatarak ilerlemesi.
4. **Tepe Ring Projektörü (Overhead Arena Spotlight):**
   - Sahanın merkezine hafifçe odaklanmış, köşeleri ise tatlı bir loşlukta bırakan çok düşük opaklıklı radyal tiyatro spotu hissi.

---

### FAZ 4 — Saha Dışı Derinlik & Dramatik Ambiyans (The Tabletop Universe)
> **Amaç:** Ekranın dışındaki siyah boşluğu ölü bir piksel alanı olmaktan çıkarıp, arenayı saran derinlikli bir stadyum/masaüstü atmosferine dönüştürmek.

* **Merkezi Dosyalar:** `src/core/fieldKit.js` (`paintBackdrop`), `src/core/roundLifecycle.js`, `src/ui/hud.js`
* **Etkilenen:** 12 Oyunun Tamamı

#### Yapılacaklar:
1. **Çok Katmanlı Diorama Alt Gölgeleri (Multi-tier Diffuse Drop Shadow):**
   - Sahanın arkasına düşen gölgeyi 3 katmanlı yumuşak oklüzyona çevirerek sahanın konsol masasının 3-5 cm üstünde havada asılı durduğu hissini vermek.
   - Sahanın altından masaya sızan hafif bir tema rengi parıltısı (*ambient under-glow*).
2. **Kritik Durum Nabzı (Heartbeat Climax Vignette):**
   - Maçın son 5 saniyesine girildiğinde, "SUDDEN DEATH" anında veya son 2 hayatta kalan kaldığında:
     - Saha dışındaki koyu vinyette kalp atışı temposunda atan kırmızı/altın ritmik parıltı.
     - Seyircideki ve oyuncudaki gerilimi tavana çıkarır.
3. **Şampiyonluk Konfetileri & Kutlama (Victory Confetti):**
   - Maç bittiğinde saha dışından sahanın içine doğru süzülen 2.5D renkli konfeti parçacıkları ve minik kamera flaşı parıltıları.

---

### FAZ 5 — Reaktif & Kırılabilir Engeller (Destructible Diorama Props)
> **Amaç:** Sahadaki taş, ahşap kasa ve metal blokları "statik çarpışma kutuları" olmaktan çıkarıp, vuruşları emen ve çatlayan fiziksel nesnelere dönüştürmek.

* **Merkezi Dosyalar:** `src/core/arenaKit.js` (`drawObstacle`), `src/core/fxKit.js`
* **Etkilenen:** Bloklu Modlar (TANKS, BOMB, HEIST, HORDE, NINJA, ARCHER, SNAKE)

#### Yapılacaklar:
1. **Darbe Tepkisi & Çatlama (Impact Shake & Micro-Cracks):**
   - Engellere mermi çarptığında veya tackle ile vurulduğunda bloğun 1-2 piksel mikro-titreşmesi (*prop flinch*).
   - Darbe noktasında deterministik mini çatlak çizgileri ve etrafa saçılan 2-3 adet minik talaş/taş kıymığı.
2. **İnteraktif Çevre Elemanları (Props & Gizmos):**
   - PONG ve BOMB gibi oyunlarda köşelere elastik yaylı tamponlar (*pinball bouncers*).
   - Sahanın kenarlarında veya merkezinde hafif rotasyon yapan görsel dişliler veya hava menfezleri (hazard vents).

---

## 3. Doğrulama, Test & Performans Kapıları

Her faz tamamlandığında aşağıdaki kontrol kapılarından eksiksiz geçilecektir:

| Kapı | Komut / Test | Beklenen Sonuç |
|---|---|---|
| **1. Tip Güvenliği** | `npm run typecheck` | 0 yeni hata, taban çizgisini aşmama |
| **2. Token & Stil Lint** | `npm run check:tokens` | Yasaklı renk veya tanımsız CSS değişkeni yok |
| **3. Kurallar & Mimari** | `npm run check:rules` | K1–K7 kurallarına tam uyum |
| **4. Zemin L\* Bütçesi** | `npm test tests/fieldKit.test.mjs` | $L^* \in [80, 97]$, $\Delta L^* \le 18$ tam yeşil |
| **5. Hareket & Tempo** | `npm test tests/movementBudget.test.mjs` | Tempo ve hız sınırları korunmuş |
| **6. Genel Check** | `npm run check` | Bütün kapılar eksiksiz yeşil |
| **7. E2E Simülasyon** | `npm run test:e2e` | 12 motor 240 kare kesintisiz 60 FPS |

---

## 4. İlerleme Takip Tablosu

- [x] **FAZ 1: Dokunsal Kütle Kenarları & Kinetik Duvar Reaksiyonu**
  - [x] Kalın pahlı diorama kenar profili (`paintTrayEdge` — temas gölgesi + speküler pah + AO bandı, dört kenar)
  - [x] Yükseltilmiş tepsi gövdesi ve masaya oturan kalınlık (`paintBackdropLayer` — halka gövde + üst/sol ışık yüzü + katmanlı temas gölgesi)
  - [x] Çarpışmalarda kinetik duvar esnemesi ve dalgalanma efekti (`fieldReactive.js` → `emitWallImpact`, `drawField`)
  - [x] Duvar darbe tozu ve kıvılcım parçacıkları (deterministik `hash01` yayılımı, arena kutusuna kırpılır)
- [ ] **FAZ 2: Canlı Savaş Alanı & Kalıcı Çatışma İzleri (Decals)**
  - [x] Hafif zemin izi yöneticisi (`fieldDecals.js` — 32 yuvalı halka tampon, kare başına sıfır tahsis)
  - [x] Patlama is ve yanık lekeleri (`kill` olayı → organik lob demeti, 5.2 sn'de solar)
  - [x] Ani dönüş patinaj ve ayak izleri (`dust` olayı → harekete paralel çift çizgi)
  - [x] Darbe boya/konfeti sıçramaları (`hit`/`slay` → vurulanın kendi renginde pul + zerrecikler)
  - [x] Raunt geçişi temizlik yaşam döngüsü (seed değişimi → 0.4 sn'lik yumuşak süpürme, süpürme bitene kadar üretim kapalı)
- [ ] **FAZ 3: Hacimsel Dinamik Işık Havuzları**
  - [ ] Bomba taşıyıcı tehlike aurası ve nabız havuzu
  - [ ] Lider / Kral altın taç spotu
  - [ ] Mermi & roket sıcak iz aydınlatması
  - [ ] Saha merkezi tepe projektör ambiyansı
- [ ] **FAZ 4: Saha Dışı Derinlik & Dramatik Ambiyans**
  - [ ] Çok katmanlı diorama alt gölgesi ve masaya vuran halo (`under-glow`)
  - [ ] Climax / Sudden Death kalp atışı vinyet nabzı
  - [ ] Şampiyonluk konfetisi ve kutlama flaşları
- [ ] **FAZ 5: Reaktif & Kırılabilir Engeller**
  - [ ] Darbe anı mikro-titreme ve çatlak detayları
  - [ ] Blok talaş ve taş kıymığı parçacıkları
  - [ ] Reaktif yaylı tamponlar ve zemin gizmo'ları

### 4b. Faz 1 Uygulama Notları (yapı kararları)

| Konu | Karar | Gerekçe |
|---|---|---|
| Nereye | Yeni çekirdek modülü `src/core/fieldReactive.js`; statik profil `fieldKit` içinde | Bake katmanı bir kez pişirildiği için darbe tepkisi oraya giremez. Modül `fieldKit`'e tek yönlü bağımlı (paleti dışarıdan alır), döngü yok |
| Motor kodu | **Sıfır.** 12 oyun zaten `drawField` çağırıyor; tepki oraya çizilir | §3/§9 "moda özel dal yasak" |
| Darbe üreticisi | Tek nokta: `physics2d.clampToArena` (normal eksen hâlinde + hız eşiği) | Bütün motorların saha duvarına temas ettiği tek geçit; aksi hâlde aynı satır 10 motora kopyalanırdı |
| Zaman | `performance.now()` damgası + `now − stamp` farkı | Motorun `update` sırasına girmeyi gerektirmez; boş havuz ctx'ye **hiç** dokunmaz (bake log eşitliği korunur) |
| Bellek | Sabit havuz (6 darbe / 18 zerre), kare başına sıfır tahsis | §1 madde 4; spam freni aynı noktadaki darbeleri tek kayıtta birleştirir |
| Görünürlük | Tepki **koyu** (tema `edgeTint` + `globalAlpha`), parlak değil | Zemin krem L* 92-97; beyaz vuruş zeminde kaybolur, koyu kıvrım okunur |
| Ağ | Sıfır alan. World-view client tepkiyi görmez | §6 bütçesi; bilinçli asimetri (2-3 px'lik kenar esnemesi uzaktan okunmaz) |
| L\* | Yeni koyu alan **eklenmedi**: eski sağ/alt `wallShade` bandı dört kenara yayıldı ve daraldı | §1 madde 3; `tests/fieldKit.test.mjs §8` bütçesi korunur |

Kilitler: `tests/fieldReactive.test.mjs` (fizik değişmezliği, hız eşiği, havuz tavanı, boş-havuz temsili, kırpma, eksen hâli normali), `tests/fieldKit.test.mjs` (bake op tavanı, determinizm, paket alanı yok).

### 4c. Faz 2 Uygulama Notları (yapı kararları)

| Konu | Karar | Gerekçe |
|---|---|---|
| Nereye | Yeni çekirdek modülü `src/core/fieldDecals.js`; çizim `fieldKit.drawField` içinden (blit üstü, `drawFieldReactive` altı) | İz sahaya aittir, kenar tepkisinden önce gelmeli; bake bir kez pişirildiği için oraya giremez |
| Motor kodu | **Sıfır.** 12 motor zaten `drawField` çağırıyor, olaylar zaten `FxRuntime.emit`'ten geçiyor | §3/§9 "moda özel dal yasak" |
| İz üreticisi | Tek nokta: `fxRuntime.emit` → `emitFxScar(kind, event, unit)`; eşleme `kill`→is, `hit`/`slay`→sıçrama, `dust`→patinaj | 12 motorun çatışma olaylarının ortak tek geçidi; `fxKit` kapalı kind kümesi yeni olay uydurulmasını engeller |
| Kumanda tarafı | İzler telefonda DA doğar: `GamepadWorldView.acceptFx` olayları kendi `FxRuntime`'ında oynattığı için aynı imza üretici görür | Faz 1'in bilinçli asimetrisi burada gerekmez — olayın koordinatı zaten dünya uzayında ve çizim `fitWorld` dönüşümü içinde |
| Raunt temizliği | `roundLifecycle`'e bağlantı YOK: `drawField`'e zaten verilen `seed = hash(mode, roundId)` değişince 0.4 sn'lik yumuşak süpürme + süpürme bitene kadar üretim kapalı | Host da kumanda da aynı seed'i okur; ayrı bir yaşam döngüsü kancası hem asimetri hem ağa alan riski doğururdu |
| Zaman | `performance.now()` damgası + `now − stamp` farkı (Faz 1 ile aynı üç satır koruma) | Motor `update` sırasına girilmez; boş havuz ctx'ye **hiç** dokunmaz (bake log eşitliği) |
| Bellek | Sabit 32 yuvalı halka tampon, kare başına sıfır tahsis; gradyan/Path2D yok, iz başına tek `fill`/`stroke`. Yeni iz açma temposu tavanlı (`SCAR_MIN_GAP` 0.14 sn ≈ 7 iz/sn) | §1 madde 4; aynı yerdeki aynı imza yeni slot yemez, mevcut izi tazeler. TANKS turbo dumanı / SNAKE egzozu KARE BAŞINA olay ürettiği için tek başına birleştirme yetmezdi — fren olmadan zemin halıya döner, 32 yuva bir tankın izleriyle dolardı |
| Görünürlük | Koyu is/patinaj tema `edgeTint`'inden, sıçrama olayın kendi renginden (α tavanları 0.30/0.20/0.50) | Krem zeminde parlak leke okunmaz; §8 ham renk literali çekirdekte yasak, renk olay verisidir |
| Ağ | Sıfır alan; world packet ve `isValid*WorldFrame` doğrulayıcıları değişmedi | §6 bütçesi |

Kilitler: `tests/fieldDecals.test.mjs` (olay→imza eşlemesi, `FxRuntime` bağlantısı, havuz tavanı + tazeleme, boş-havuz temsili, kendi kendine sona erme, seed süpürmesi ve üretim engeli, kırpma + save/restore dengesi, `unit` ölçeği, gradyan/tahsis ve ağ yasakları, determinizm).
