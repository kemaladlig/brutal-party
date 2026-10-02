# 2.5D EĞİK SAHNE DÖNÜŞÜM KILAVUZU

> **Bu dosya ne:** Brutal Party'nin düz-top-down sahnelerini, sıfır 3D motoruyla
> (Three.js/WebGL yok, saf Canvas 2D) eğik/"oyuncak masa" 2.5D görünümüne
> çevirmenin **tek referansı**. Yeni bir modu dönüştürürken ya da ortak sahne
> dilini değiştirirken önce burayı oku.
>
> **Yerine geçtiği dosya:** `TACTILE_25D_ARENA_PLAN.md` (sahte ekstrüzyon +
> katmanlı elips gölge yaklaşımı **terk edildi**; gerçek projeksiyon kamerası
> onun yerini aldı).
>
> **Referans dönüşümler:** `BOMB` (harita→tema, engel/pickup/patlama, host↔client
> eşliği), `SNAKE` (projekte gövde polyline'ı, tek tema, yem/duvar), `HEIST`
> (zemin bölgesi = projekte alan + billboard, kumbara = projekte silindir,
> ganimet = yüzen rozet; tek sabit tema), `CROWN` (en zengin arena: zemin
> decalleri + sütun prizmaları + silindir bumper/tuzak + yüzen taç; tek sabit tema)
> ve `ARCHER` (projekte ok = yükseltilmiş şaft + zemin gölgesi, nişan/gösterge
> halkaları zemine projekte, `sceneKit.queuePlayers` ile oyuncu kuyruğu), `HORDE`
> (düz katmanlar `sceneKit.groundSpace` afin zemin uzayında — kapı/portal/telegraf/
> mezar/düşman/sandık; oyuncular ayakta penguen; mermiler `sceneKit.projectile25d`),
> `ZONE` ve `COLLAPSE` (ızgara/bölge/uyarı katmanları `groundSpace` zemin uzayında;
> oyuncular ayakta penguen + derinlik kuyruğu), `CURVE` (iz/bölge ızgarası zemin
> uzayında; host'un satır-içi kafa çizimi kaldırıldı → `drawCurveHeads` ortak,
> böylece host↔client eşliği kuruldu), `NINJA` (düz katmanlar — iz/decal/fener/
> hayalet/kılıç/darbe — `groundSpace` guard'ıyla sarmalandı; engeller prizma,
> oyuncular ayakta penguen + projekte rozetler), `TANKS` (araçlar yer nesnesi →
> zemin uzayı; arena/sudden-death/engel prizmaları 2.5D), `PONG` (kort 2.5D;
> raketler derinlik kuyruğunda taban-Y ile — alt raket alt rayın önünde kalır;
> canlı katman `groundSpace`).

---

## 1. Zihinsel model

Dünya **hâlâ bir düzlemdir**: `x` = doğu, `y` = güney (derinlik), `z` = yükseklik.
Görünen eğik kamera iki kuraldan doğar:

1. `y` ekseni `TILT` kadar **sıkışır** → kameranın yere eğik bakışı.
2. `z` (yükseklik) ekranda **yukarı** taşar → prizma/silindir/küre hacmi.

Projeksiyon **paralel/aksonometriktir** (`PERSP = 0`, ufuk noktası yok). Bu
yüzden top-down dikdörtgen bir saha, eğik kamerada **yine dikdörtgen** kalır
(sadece dikeyde kısalır) — "yamuk/perspektif" bekleme. Derinlik hissi
**yükseklik hacimlerinden** (prizma yüzleri, küre gölgesi), **temas
gölgelerinden** ve **oklüzyondan** (painter's order) gelir, trapezden değil.

**Simülasyona dokunulmaz.** `computePlayfield`, `fieldSpeed`, çarpışma hep
tepeden bakış `(x, y)` uzayında kalır; 2.5D yalnız **çizim/sunum dönüşümüdür**.
Tek istisna `proj.unproject` (ekran→zemin; şimdilik kullanılmıyor, çünkü oyun içi
girdi joystick vektörüdür).

---

## 2. Kamera ve açı — "sektör standardı kaç?"

`TILT` = **sin(kameranın yataydan yükseklik açısı)**. `0` = ufuk (yer bir çizgi),
`1` = tam tepeden (nadir).

| Yükseklik açısı | `TILT = sin(α)` | Görünüm |
|---:|---:|---|
| 30° | 0.500 | Klasik 2:1 izometrik; çok yatık, rekabetçi oyunda kör nokta büyük |
| 45° | 0.707 | Diablo-vari; engel yüzleri baskın, saklanma kolay |
| **46°** | **0.720** | **PROJE VARSAYILANI** — daha eğik/izometrik; güçlü derinlik, "masaya tepeden bakma" hissi gider |
| 55° | 0.819 | Oyuncak-masa tatlı noktası; engel hacimli, kör nokta küçük |
| 57° | 0.840 | Eski varsayılan — hacim + okunurluk, daha tepeden |
| 60° | 0.866 | Brawl Stars / MOBA aralığı; güvenli, hafif tepeden |
| 70° | 0.940 | Neredeyse tepeden; engel öne çıkmaz (eski varsayılan) |

**Kör nokta kuralı:** arkasında `d = h / tan(α)` kadar şerit saklanır
(`h` = engel yüksekliği). 70°'de `d = 0.36·h` (neredeyse yok), 57°'de `d = 0.65·h`,
46°'de `d ≈ 0.97·h` (saklanma belirgin).

**Karar:** parti/arena oyunu için ideal bant **46–60°**; varsayılan **0.72 ≈ 46°**.
Daha da yatık istersen 0.68 (43°), daha "güvenli/objektif" istersen 0.82 (55°).
**30°'ye inme** — saklanma ve okunurluk bozulur. `PERSP`'ı açmadan önce
`fit`'in güney-genişleme formülünü (`southD`) ve `_per`'i test et.

**Kritik tuzak — fit zoom:** kamera sahaya **sığdırıldığı** için (`fit`) açıyı
düşürmek projeksiyonu kısaltır ve `fit` ölçeği BÜYÜTÜR; bu da engellerin
**görünen** yüksekliğini artırır. Yani yatık kamera tek başına engelleri
kısaltmaz, çoğu zaman büyütür. Bu yüzden yükseklik **ayrı bir koldur** (§2.1).

Açı **tek sunum tercihidir**: host ve client aynı `tilt`'i kurarsa sahne birebir
eşleşir. Ayarı `core/projection2d.js` başındaki `TILT` sabitinden değiştir; tek
karede farklı açıları görmek için `createProjector({ tilt })` ile geçici proj
üret (bkz. §8 prova tarifi).

### 2.1 Yükseklik = ikinci, bağımsız kol (yalnız görsel)

Kamera açısı ile engel yüksekliği **aynı hedefin iki ayrı koludur**:
- Kamera açısı → tüm sahne, global mood.
- Engel yüksekliği → blok başına, **çarpışmaya dokunmaz** (çarpışma daima
  `(x,y,w,h)` taban izidir).

Kör nokta: `d = h / tan(α)`. Yatık kamera istiyorsan (derin görünüm) `h`'yi
kısarak arkada saklanan şeridi küçük tutarsın — *"derin ama haksız değil"*. İki
istek çelişmez çünkü iki ayrı koldur.

Uygulama: `core/arenaKit.js` → `obstacle25dHeight(obs, proj)` (tek kaynak,
deterministik: `obstacleMass` + en-boy oranı) ve sahne geneli çarpan
`proj.obstacleHeightScale` (`createProjector({ obstacleHeightScale })`,
varsayılan 1). Kaba yükseklik sözlüğü: uzun duvar → yüksek, kolon → orta,
kerb → kısa. Host ve client aynı ayak izinden **aynı** yüksekliği hesaplar;
paket büyümez.


---

## 3. Kit ve sahiplik (tek doğruluk kaynağı)

Hiçbir oyun kendi zeminini/engelini/kamerasını yazmaz. Sahiplik haritası:

| Katman | Sahip | Ana API |
|---|---|---|
| Kamera geometrisi | `core/projection2d.js` | `createProjector({tilt,persp,obstacleHeightScale})`, `fit`, `proj`, `quad`, `strokePoly`, `contactPatch`, `groundEllipse`, `groundRing`, `drawPrism`, `drawCylinder`, `drawSphere`, `materialFromColor`, `shade`, `paintMaterialTexture(ctx,pal,rect)`, `railMaterial`, `paintTable25d` |
| 2.5D kablolama yardımcısı | `core/projection2d.js` | `makeTiltedProjector(viewport, arena, theme, proj?)`, `arenaFromRect(rect)` |
| 2.5D sahne zarfı | `core/tiltedScene.js` | `createTiltedScene({camera})` → `open(ctx,{viewport,arena,theme})` (kamera sığdır + kuyruk aç), `depth(ctx,y,draw,a,b)`, `close(ctx)` — **kamera + derinlik kuyruğu yaşam döngüsü tek yerden**; host kalıcı proj'u, client renderer ömrü boyunca yaşar |
| 2.5D sahne yardımcıları | `core/sceneKit.js` | `groundRect(ctx,proj,rect,{fill,stroke,alpha})`, `groundSpace(ctx,proj,draw)` (zemin uzayı — proj paralel olduğundan afin), `chipAt(ctx,proj,{x,y,radius,z?},chipOpts)`, `projectile25d(ctx,proj,p)` (ok/mermi gövdesi), `queuePlayers(ctx,players,{state,drawItem,radiusOf,visible})` — **rule of two**: yalnız ≥2 tüketicisi olan yardımcı girer. **Düz katman 2.5D'leme deseni:** `export function drawX(ctx, …, proj = null) { if (proj) { groundSpace(ctx, proj, (c) => drawX(c, …)); return; } /* gövde değişmez */ }` **Derinlik kuyruğu deseni (ray hizasındaki öğeler):** `sceneDraw(ctx, baseY, (c, p) => groundSpace(c, p, (g2) => drawX(g2, …)), proj)` — taban-Y sıralaması alt rayın öğeyi örtmesini engeller |
| Power-up kataloğu | `core/pickupCatalog.js` | `PICKUP_CATALOG` (görsel + `effect` + `requires` tek kayıt), `PICKUP_META`/`EFFECTS` (türev), `pickupRequiresMet`, `availablePickupTypes` |
| Saha zemini + kenar | `core/fieldKit.js` | `drawField25d(ctx, proj, arena)`, `drawFieldRail(ctx, proj, {arena,side})`, `fieldRailBaseY(arena,side)` |
| Engel | `core/arenaKit.js` | `drawObstacle25dShadow(ctx, proj, obs)` (zemin, hemen), `drawObstacle25dMass(ctx, proj, obs)` (derinlik kuyruğu), `obstacle25dHeight(obs, proj)` (görsel yükseklik, tek kaynak), `obstacleBaseY(obs)`, `entitySceneY(y, r)` |
| Pickup | `core/arenaKit.js` | `drawPickup(ctx, pk, { proj })` — proj'la zeminden yüzen rozet |
| Derinlik kuyruğu | `core/arenaKit.js` | `sceneBegin()`, `sceneDraw(ctx, baseY, draw, a, b)`, `sceneEnd(ctx)` |
| Karakter | `core/avatarInGame.js` | `drawGameAvatar25d(ctx, proj, player, opts)` (tek projekte küre + yüz + uzuv), `drawGameAvatar` (top-down yol) |
| FX/partikül/patlama | `games/worldCore.js` | `drawFxRings`, `drawFxPops`, `drawCircleParticles`, `drawSquareParticles`, `drawBlast` — hepsi opsiyonel `proj` alır |
| Renk sözlüğü | `ui/tokens.js` | `arena25d` (taban), `arena25dThemes` (harita temaları, örn. `wood/marble/arcade/picnic/night/garden`) |

**Kablolama yardımcısı neden var:** her oyunun eskiden kopyaladığı
"projector kur + `fit` + tema bağla" ile "frame dikdörtgeninden arena türet"
kodunu tek yere indirir. Host kalıcı `proj`'unu yeniden kullanır (kare başına
tahsis yok); ONLINE client `arenaFromRect` ile host'la **aynı `unit`'i** türetir.

```js
// Host (motor): kalıcı proj kare başına yeniden sığdırılır.
this.proj = createProjector();                       // kurucuda bir kez
// render() içinde:
makeTiltedProjector(this.viewport, this.arena, THEME, this.proj);

// ONLINE client (world-view): taze proj, frame'den arena.
const arena = arenaFromRect(frame.arena);
const proj = makeTiltedProjector({ width, height }, arena, THEME);
```

---

## 4. Dönüşüm tarifi (yeni bir mod)

Her mod **4 katmana** ayrılır ve sırayla çevrilir. Bir oyun 2.5D ise dört
katmanın hepsi `proj` alır; almayan oyunlar tepeden bakış yolunda değişmeden kalır.

### 4.1 Paylaşılan görünüm (`<oyun>View.js`)
Çizim fonksiyonlarını **opsiyonel `proj`** alacak şekilde genişlet; `proj === null`
ise mevcut top-down yolu aynen koru (geriye dönük güvenlik + testler).

- `drawXxxArena(ctx, arena, walls, { proj })`:
  - `proj` varsa: `drawField25d(ctx, proj, arena)` → kenar tamponları
    (`sceneDraw(ctx, fieldRailBaseY(arena, s), drawFieldRail, proj, {arena, side})`)
    → her engel için `drawObstacle25dShadow` + `sceneDraw(ctx, obstacleBaseY(o), drawObstacle25dMass, proj, o)`.
  - yoksa: `drawField` + `drawObstacle` (eski yol).
- Her varlığı `sceneDraw(ctx, tabanY, drawItem, a, b)` ile kuyruğa al; `proj`
  yokken `sceneDraw` **anında** çizer (davranış aynı kalır).

### 4.2 Host motoru (`<oyun>.js`)
- Kurucuda bir kez `this.scene = createTiltedScene({ camera: TILTED_25D_CAMERA.<oyun> })`;
  `this.proj = this.scene.proj` (**kalıcı** örnek — kare başına tahsis yok).
- `render()` başında `this.scene.open(ctx, { viewport: this.viewport, arena: this.arena, theme })`
  — kamera sığdırma + derinlik kuyruğunu açma tek çağrıdır.
- Sahneyi `this.scene.open()` … `this.scene.close(ctx)` penceresine al (arena +
  yem/birim + oyuncular); FX ve HUD **pencere dışında**, üstte.
- 2.5D'de `paintBackdrop` **çağırma** — masa zemini `drawField25d` içinde boyanır.

### 4.3 ONLINE client (`ui/<oyun>WorldView.js`)
Host'la **aynı** çizim fonksiyonlarını çağır (eşlik kuralı §6):
- `createWorldViewRenderer()` içinde bir kez `const scene = createTiltedScene({ camera });`
  (proj kalıcı; renderer ömrü boyunca yaşar, kare başına tahsis yok).
- `render()` içinde `const arena = arenaFromRect(frame.arena);` →
  `const proj = scene.open(ctx, { viewport: { width, height }, arena, theme });`
- Aynı `scene.close(ctx)` sırası, aynı `proj` parametreleri.
- Client **simülasyon/AI import etmez**; yalnız snapshot doğrular ve çizer.

### 4.4 Registry (`core/engineRegistry.js`)
- `worldView.load` zaten var (ONLINE client). Dönüşüm için **paket değişikliği
  gerekmez** eğer tema sabitse (`SNAKE`). Tema haritaya bağlıysa pakete harita
  kimliği ekle (`BOMB.packet` → `mapIndex` + doğrulayıcı) ve client aynı
  `themeForMap` fonksiyonundan türetsin.

---

## 5. Varlık bazlı çeviri (kopyala-yapıştır kalıpları)

**Zemin/saha:** `drawField25d(ctx, proj, arena)` — motor asla kendi zeminini yazmaz.
Sahne iki fonksiyondan, **katmanlı** kurulur (hepsi tema tonundan `shade` ile
türer; yeni renk literalı yok):

1. `paintTable25d(ctx, view, T, themeName?)` — masa: taban dolgu → sol-üst
   **ana ışık** havuzu → **malzeme dokusu** (`paintSurfacePattern`; tema adına
   göre ahşap damar / taş damar / ızgara) → **vinyet**.
2. `drawField25d` — (a) tepsinin masaya düşen **katmanlı gölgesi**, (b) tepsi +
   mat, (c) mat'a kırpılı **yönlü ışık** (kuzey açık → güney koyu) + **malzeme
   dokusu** (`MAT_PATTERN`: dokuma / çim tutamı / taş damarı; `grid` deseni
   kareli okunduğu için 2.5D'de `weave`'e indirilir), (d) **iç gölge (AO)** mat
   kenarında, (e) dikiş çerçevesi + mat kenarı, (f) **merkez amblemi** (disk +
   eşkenar + halkalar). **2.5D zeminde KARE/DAMA IZGARA YOKTUR** — yüzeyi doku
   ve motifler taşır; kare dikiş ızgarası bilinçli olarak kaldırılmıştır.

Malzeme desenleri `core/projection2d.js`'te yaşar (`TABLE_PATTERN`/`MAT_PATTERN`
+ `paintSurfacePattern(ctx, kind, b0..b1, map, unit, lo, hi)`); `map` dünya→ekran
taşır, renkler `shade(...)`'den gelir. Deterministik hash (`h01`) vardır —
`Math.random`/`Date`/`performance` **yok**. Yeni tema = `TABLE_PATTERN`/`MAT_PATTERN`'e
bir satır (yoksa ahşap/dokuma varsayılanına düşer).

**Gerçek doku (opsiyonel, önerilen):** Prosedürel desenin üstüne gerçek seamless
foto-doku konabilir. `core/fieldTextures.js` `public/assets/textures/*.webp`
(ambientCG CC0 — `CREDITS.md`) yükler; `TABLE_TEXTURE`/`MAT_TEXTURE` tema→slot
eşler. Doku geldiyse `paintTable25d`/`drawField25d` onu döşer ve
`globalCompositeOperation='color'` ile tema tonuna boyar (ışık/parlaklık dokudan,
ton temadan) → tek doku çok temaya hizmet eder. Yüklenmemişse sessizce prosedürel
yola düşer (pop yok). `paintTiledTextureWorld(ctx,img,proj,x0,y0,x1,y1,tint,tileWorld)`
`persp=0` (aksonometrik) varsayımıyla mat'ı dünya-uzayında döşer. Yeni doku =
`SOURCES`'a satır + `TABLE_TEXTURE`/`MAT_TEXTURE` eşlemesi; paket alanı **eklenmez**,
`main.js` bir kez yükler, `sw.js` precache'ler.

Kural: yeni derinlik katmanı **buraya** eklenir (tek sahip); motor zemin/ızgara/
motif yazmaz. `fieldKit` içinde `Math.random`/`Date`/`performance` **yasak**;
doku/ışık girdilerden (tema, arena, viewport) türetilir — host↔client aynı.
Yeni tema = `ui/tokens.js arena25dThemes`'e kayıt; katmanlar `shade(T.mat/T.table)`
sayesinde otomatik uyum sağlar, ek alan şart değil.

**Kenar tamponu:** `drawFieldRail` derinlik kuyruğuna girer
(`fieldRailBaseY`: kuzey/batı arkaya, güney/doğu öne). Prizmanın ardından
`drawRailDetail` görünen yan yüze **üstten ışık gradyanı + kontur**, üst yüze
**malzeme dokusu (varsa) + panel dikişleri + iç kenar aksan şeridi + pah ışığı +
cıvata dizisi** ekler. Sonra her kenar iki ucuna `drawRailCap` basar: ray genişliği
kadar hafif yüksek **köşe başlığı + tek cıvata**. Başlık olmadan iki prizmanın ucu
üst üste binip biçimsiz bir renk bloğu bırakıyordu (köşe "bozuk" görünürdü).
Tamamı `pal`/`arena`'dan türetilir, literal yok.

**Bake:** 2D saha gibi `drawField25d` de **pişirilir** (`field25dCache`;
anahtar = view + tema + arena + tilt + doku nesli). Masa dokusu + `'color'` harmanı
ve mat dokusu her karede yeniden çalışmasın diye kare başına tek `drawImage`.
Kenar tamponları bilinçli olarak bake DIŞINDADIR (derinlik kuyruğunda sıralanır);
`createPattern` sonuçları ctx başına önbelleğe alınır.

**Engel (duvar/kolon):** gölge `drawObstacle25dShadow` (zemin katmanı), gövde
`drawObstacle25dMass` (kuyruk). Şekil **en-boy oranından**: uzun blok → `drawPrism`
(duvar şekli korunur), kare/kısa → `drawCylinder` (kolon), büyük kare → `drawPrism`.
Yükseklik `obstacle25dHeight(obs, proj)`'ten gelir (§2.1): uzun duvar yüksek,
kolon orta, kerb kısa; `proj.obstacleHeightScale` sahne genelinde ölçekler.

**Malzeme (engelin görünüşü):** engel renk SEÇMEZ. Bulunduğu temanın derisini
taşır — `ui/tokens.js arena25dThemes.<tema>.block` → `arenaKit.OBSTACLE_STYLES`
kimliği. İki yol AYNI köprüden geçer: 2.5D `obstacleStyle({theme: proj.theme})`
(palet nesnesi), tepeden bakış `obstacleStyle({theme: FIELD_THEMES id})` (string).
`materialFromSkin(style, mass)` deriden `{top,front,side}` paleti türetir ve
`mass`'i 8 kovaya kuantlayıp ÖNBELLEKLER: saha içindeki bloklar birbirinden
ayrışır ama karede `shade()`/string tahsisi olmaz.

Doku: `OBSTACLE_STYLES.<deri>.texture|grain|wear`. Damga (`obstacleGrain`,
48×48) deri başına BİR KEZ üretilir ve `paintMaterialTexture` ile **doğal
ölçekte karo karo** basılır (tek gerilmiş blit damarı bulanık gradyana çevirir;
gözle doğrulandı). `createPattern` kullanılmaz — bkz. §7 son madde. Kare başına
maliyet `drawImage`'dır, op bütçesine girmez; tavan `MATERIAL_TILE_MAX`.

**Prizma silueti:** `PERSP = 0` olduğu için prizma ALTIGEN DEĞİL DİKDÖRTGENDİR
(ayak izi çatısı + ön duvar) ve yan yüz ekranda sıfır genişliktedir. Bu yüzden
`drawPrism` iki dolgu + TEK siluet konturu basar; yüz ayrımı tonun işidir.
Mürekkep kalınlığı TASARIM px'idir ve `view.scale` ile ölçeklenir — sabit ekran
px mürekkep küçük saha ölçeğinde şişiyordu. Kenar tamponları aynı çağrıyı
kullandığı için (`drawFieldRail`) bu sözleşme rayları da bağlar.

**Pickup / power-up:** `drawPickup(ctx, pk, { proj })` — proj'la zeminden
`half` kadar yüzen ve kamera derinliğiyle ölçeklenen rozet. **Yeni bir power-up =
`core/pickupCatalog.js` `PICKUP_CATALOG`'a tek kayıt** (görsel + `effect` +
gerekiyorsa `requires`); görseli `drawPickup`, davranışı `collectPickups` aynı
kayıttan okur. Motor kendi rozetini/efekt sözlüğünü yazmaz; `spawnPickup({ strict:true })`
verilirse desteklenmeyen tip hiç doğmaz (sessiz no-op yok).

**Karakter:** yerden kalkan her oyuncu `drawGameAvatar25d(ctx, proj, player, { x, y, radius, color, facingAngle, expression, alpha })`. Karakter projekte bir **penguen siluetidir** (dikey oval gövde + açık karın + turuncu gaga/ayak); yüz ve uzuv/gaga ankrajları gövde küresinin yerel 3B eksenlerine çapalanır. (SNAKE gibi "gövde + kafa" oyunlarında gövde ayrı bir projekte polyline'dır, kafa aynı penguen karakteridir.)

**İz / gövde (SNAKE deseni):**
- Noktaları `proj.proj(x, y, 0)` ile ekrana çevir (tek yardımcı: `snakeScreenPoints`).
- Gövde = **silindir**: eşmerkezli taramalar (silüet → taban → alt gölge → üst
  ışık → spekül); ışık şeritleri hafif **yukarı** kaydırılır
  (`ctx.translate(0, offset)` ile). Üstüne periyodik **pul bandı** (noktalar
  arası çapraz kısa çizgi).
- Kalınlık kamera derinliğiyle ölçeklenir: `k = proj.view.scale * proj.proj(x,y,0).d`.

**Mermi/partikül/FX:** `worldCore` çizimleri opsiyonel `proj` alır. Proj'la her
nokta zemine projekte edilir ve boyut `view.scale * d` ile ölçeklenir.

**Yazı/rozet (status chip, isim):** proj'la **projekte konuma** taşı ama
genellikle **ekran-sabit** ölçekle (okunurluk); roket/hız gibi büyüme isteyen
şeylerde `view.scale * d` ile ölç.

---

## 6. Host ↔ client eşliği (kural)

1. **Aynı çizim fonksiyonu:** host motoru ve `ui/*WorldView.js` **aynı**
   `drawXxx...` fonksiyonlarını çağırır. Ayrı bir client çizimi yazmak yasak.
2. **Aynı girdiler:** `arena` (host `computePlayfield` → client `arenaFromRect`),
   `viewport`, `theme`, `tilt`. Bunlardan biri saparsa sahne kayar.
3. **Tema:** haritaya bağlıysa pakette harita kimliği gider (`mapIndex`), client
   aynı `themeForMap` ile türetir. Sabitse derleme-zamanı sabiti (`SNAKE_THEME_25D`).
4. **Derinlik sırası:** iki taraf da `sceneBegin/sceneDraw/sceneEnd` kullanır.
5. **Kozmetik animasyon** (adım salınımı, dil flick'i, `now` tabanlı salınım)
   host ile client'ta hafif faz farkı gösterebilir; bu **kabul edilir** —
   simülasyon/yetki değişmez. Simülasyona ait hiçbir değer client'ta uydurulmaz.
6. **Paket yükü düz kalır** (bkz. AGENTS §11 `STATE_SYNC` uyarısı): 2.5D için
   pakete yalnız harita/tema kimliği eklenir, render ayrıntısı gönderilmez.

---

## 7. Yasaklar / tuzaklar

- **Ham renk literali yok** (`rules-lint K2`): yeni renk `ui/tokens.js`
  `arena25dThemes`'e gider; `shade()` çalışma-zamanı ton üretir, literal sayılmaz.
- **Ham px yok** (`AGENTS §4`): her şey `fieldSpeed`/`fieldRadius`/`proj.view.scale`
  üzerinden. `canvas.width/height` okunmaz/yazılmaz (DPR `main.js`'in).
- **Kare başına tahsis yok:** host `proj`'u yeniden kullanır (`makeTiltedProjector`'a
  mevcut `proj` verilir).
- **Kendi kablolamanı yazma:** `createProjector().fit(...)` + arena kurma yerine
  `makeTiltedProjector` + `arenaFromRect`.
- **`paintBackdrop` + `drawField25d` birlikte çağrılmaz** (masa iki kez boyanır).
- **2D yol silinmez:** `proj` yokken eski `drawField`/`drawObstacle`/
  `drawGameAvatar` yolu korunur; dönüştürülmemiş oyunlar ve testler bozulmaz.
- **`sceneDraw` penceresi:** `sceneBegin` açıp `sceneEnd` çağırmayı unutma;
  aksi halde kuyruk boşalır ve `proj` yolu hiçbir şey çizmez.
- **Engel şeklini boyuta göre tut:** `drawObstacle25dMass` artık en-boy oranına
  bakar (uzun → prizma, kare/kısa → silindir); `obstacle25dHeight` yükseklik
  sözlüğünü tutar. Yeni şekil eklerken tek yer: `drawObstacle25dMass`.
- **Engel malzemesi temadan gelir:** yeni bir engel görünümü = `OBSTACLE_STYLES`'a
  deri kaydı + temanın `arena25dThemes.<tema>.block` alanına o kimlik. Motor hex
  ya da `variant` geçmez; sahaya geçtiği temayı geçirir. Kural: deri tonu zemin
  `mat` tonundan ΔL* ≥ 8 ayrışmalı (`tests/obstacleRender.test.mjs`) — açık
  zemine açık deri blok, blok zemine gömülür.
- **Yeni saha bitmap'i:** TEK üreticiden geç (`arenaKit.createSpriteCanvas`);
  `canvas.width/height` ataması K3 kapsamındadır ve taban 2 atamada donmuştur.
  Yeni bitmap eklemek yeni K3 noktası açmaz. Ham renk literalı eklenmez, ton
  `shade()`/token'dan türetilir (K2 borcu artmaz).
- **Doku için `createPattern` yok:** ctx başına önbellekli olsa bile
  `strictRecorder` çizim yolundaki desen üretimini hata sayar (§8). Desen
  yerine deri başına bir kez üretilen damga tuvali + `paintMaterialTexture`
  ile karo blit kullanılır; karolar görüntünün CİHAZ pikselinde 1:1 kalır
  (DPR'li ekranda gerilmiş doku bulanır).

---

## 8. Doğrulama

**Kapılar (yeşil olmadan iş bitmez):** `npx tsc --noEmit`, `node scripts/token-lint.mjs`,
`node scripts/rules-lint.mjs`, `node --test tests/*.test.mjs`, `npm run health`,
motor/akış değiştiyse `npx playwright test tests-e2e/engine-smoke.spec.js`.

**Görsel prova (headless):** geçici bir `.mjs` dosyasıyla (repo kökü, iş bitince sil):

```js
import { chromium } from '@playwright/test';
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://127.0.0.1:3011/favicon.ico');     // npx vite --port 3011
const data = await page.evaluate(async () => {
  const { CARTRIDGES } = await import('/src/core/engineRegistry.js');
  const Cls = await CARTRIDGES.SNAKE.load();
  const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720;
  const g = new Cls(cv); g.resize(1280, 720);
  g.slotTypes = ['human','human','bot_normal','empty'];
  g.reset(); g.startNewMatch();
  for (let i = 0; i < 200; i++) { g.update(1/60); g.render(); }
  return cv.toDataURL('image/png');
});
// yaz → prototype/xxx.png
```

**Açı karşılaştırması:** aynı kareyi farklı açılarla üretmek için
`g.proj = createProjector({ tilt })` atayıp `g.render()` çağır (host `proj`'u
yeniden kullanır, `tilt` korunur). Referans: `prototype/tilt-compare.png`.

**Uygulama içi:** `npm run dev` → OYUNLAR → BOMB/SNAKE → LOCAL (2.5D yolu her ağ
modunda koşar; BOMB'da harita düğmesi 5 temayı döner).

---

## 9. Ayar noktaları / yapılacaklar

- **Kamera preset'i:** `TILTED_25D_CAMERA` 12 oyunda da proje varsayılanıdır
  (`tilt: 0.72`). Dikey dolgu için açı YÜKSELTİLMEZ — 0.92'de `fit` ölçeği
  küçülüp zemin sıkışması gittiği için 2.5D etki çift taraflı söner ve sahne
  tepeden bakışa döner (ölçüldü: audit-*.png). Dolgu gerekiyorsa `extraW`/
  `extraH` ile oynanır, açıyla değil.
- **Engel yüksekliği:** sözlük + `obstacleHeightScale` hazır (§2.1). Varsayılan
  `scale = 1` **dengeli look**'tur (taban çarpanlar bunun için ayarlı). Daha
  dramatik/uzun istersen 1.2–1.3, daha düz istersen 0.75. Sayıyı buraya gömme —
  `createProjector` çağrısından ver.
- **Pickup boyutu:** 2.5D'de rozetler küçük kalıyor; `half`/`u` tabanını kamera
  ölçeğiyle biraz büyütmek okunurluğu artırır (host↔client aynı olmalı).
- **Gölge yönü:** temas gölgeleri şu an `+4,+6` ofsetli; ışık kaynağı yukarıdan
  varsayımıyla tutarlı. Yeni sahne dili eklerken bu yönü değiştirme.
- **`PERSP`:** 0'da kalsın. Açarsan `fit.southD` ve `proj._per`'i yeniden test et.
- **Uzuv okunurluğu:** çok yatık açılarda (≤50°) küre avatarın uzuvları
  kısalır/kaybolur; `drawGameAvatar25d` eşiklerini yeniden ayarla.

---

## 10. Hızlı kontrol listesi (yeni oyun dönüşümü)

- [ ] `core/tiltedScene.js`'ten `createTiltedScene`, `core/projection2d.js`'ten
      `arenaFromRect` + `TILTED_25D_CAMERA` import et.
- [ ] `<oyun>View.js`: `drawXxxArena` (drawField25d + rail + engel), tüm varlıklar
      `sceneDraw` kuyruğunda, pickup `drawPickup({proj})`, karakter
      `drawGameAvatar25d`.
- [ ] `<oyun>.js` (host): kurucuda `this.scene = createTiltedScene({camera})`
      (+ `this.proj = this.scene.proj`); render'da `this.scene.open(...)` /
      `this.scene.close(ctx)`, `paintBackdrop` kaldır.
- [ ] `ui/<oyun>WorldView.js` (client): renderer kurulumunda bir `scene`, render'da
      `arenaFromRect` + `scene.open(...)`/`scene.close(ctx)` + aynı çizim çağrıları.
- [ ] Tema: sabitse export et (`XXX_THEME_25D`), haritaya bağlıysa pakete harita
      kimliği ekle + client aynı `themeForMap`'ten türetsin.
- [ ] Pickup/power-up varsa tipleri `core/pickupCatalog.js`'ten seç; `spawnPickup`
      çağrısına `strict: true` ver (desteklenmeyen tip doğmaz).
- [ ] `ensemble`: FX çağrılarına `proj` geçir.
- [ ] Kapılar yeşil + headless prova görüntüsü (`prototype/...`).
