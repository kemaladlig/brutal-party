# CİHAZ BAĞIMSIZLIK + KALİTE KAPISI PLANI

**Durum:** Ölçüm tamamlandı, uygulama başlamadı.
**Kapsam:** 15 oyunun cihazlar arasında *aynı oyun* gibi hissettirmesi — ve bunun
elle deneyerek değil, otomatik kapıyla korunması.
**Araç:** `node scripts/measure-bodies.mjs` (commit edilmemiş, motor koduna dokunmaz)

Bu belge bir **yürütme planıdır**. Her adım için: hedef, kanıt, dosyalar, test,
**negatif test** ve geri alma yolu tanımlıdır. Ölçülmemiş hiçbir şey plana
girmemiştir.

---

## 0. Ölçüm özeti

| # | Bulgu | Kanıt | Sonuç |
|---|---|---|---|
| B1 | Gövde boyutları kümelenmiyor | 6→43 px, saha% 1.20→8.94 (7.5×), o/ö: HORDE 0.42 · TANKS 1.00 · CROWN 2.10 | **Gövde sınıfları YAPILMAYACAK** |
| B2 | Ölçek cihazdan bağımsız | Gövde/saha sapması 11 oyunda 0.00–0.06%; ZONE 2.70%, CROWN 1.71% (tam sayı yuvarlama) | Ölçekleme sağlam |
| B3 | Geçiş süresi cihazdan bağımsız | 11/15 ölçülebilir oyunda masaüstü/telefon farkı 0.00% | Ölçekleme sağlam |
| B4 | Harita sorun değil | 7/7 koridor geçilebilir, 1.1×–3.4× marj | `minPassage` çalışıyor |
| B5 | Sınıflandırıcı çelişkisi | 4/5 gerçekçi viewport'ta pencere ve saha uzayı farklı sınıf veriyor | **Kanıtlanmış kusur** |
| B6 | 7 view/engine yarıçap kayması | BOMB 36/14 · HEIST 24/14 · ARCHER 28/18 · CROWN 20/18 · PONG 16/11 | **Kanıtlanmış kusur** |
| B7 | 3 oyunda gövde hiç ölçülemiyor | COLLAPSE · SNAKE · CLONE — runtime'ta okunacak alan yok | **Kanıtlanmış kusur** |
| B8 | 4 oyunda hız okunamıyor | PONG · ZONE · LASER · TANKS | Test kapsamı 11/15 |
| B9 | Saha en/boy oranı cihaza göre değişiyor | 1.43 (tablet 4:3) → **2.53 (ultrawide 21:9)**, %77 saçılım | **Tuning taşınabilirliği sorunu** |
| B10 | En/boy'u zorlamak pahalı | Hedef orana zorlama %3–30 oyun alanı kaybettiriyor (bkz. §2) | **Zorlama ÇÜRÜTTÜ** |
| B11 | Hareket ipuçları ölçeklenmemiş | `curve.js:868` → `lineWidth = 8.5 / 2.2 / 4`, `lineWidth = 6` sabit px | **Kanıtlanmış kusur** |
| B12 | Ultrawide hiç hedeflenmemiş | 2.53 oran — kimse test etmemiş, kimse ayarlamamış | **Görünmeyen en büyük boşluk** |

### B1 neden çürüttü

Saha yüzdesi 7.5 kat aralığında. `o/ö` sütunu (oyuncu / oyundaki en büyük öteki
gövde) aynı eksende uç uca: HORDE'da oyuncu tankın yarısından küçük (0.42),
CROWN'da taçtan büyük (2.10). Ortak bir "MEDIUM" sınıfı HORDE'da 14, CROWN'da 43
anlamına gelirdi — içeriği olmayan bir etiket. Ölçülmeden 15 dosyalık bir
refactoring bu yanlış kalıba kurulacaktı.

### Ölçüm aracı

`scripts/measure-bodies.mjs` motorları **gerçekten çalıştırır** (vite-SSR →
`resize` → `startNewMatch` → 1.5s girdi) ve runtime değerlerini okur. Kaynak metni
taramaz. Gerekçesi: bu projede kaynak taraması üç kez yanlış cevap verdi
(`pxConstants` regex'i tek haneli `9.5`'i kaçırdı, "45 çağrı" sayımı import
satırlarını saydı, `buildLayout` çağrı listesi eksikti).

Araç ölçülemeyeni bilerek `—` basar: **uydurma sayı doldurmaz.** `SNAKE ·
COLLAPSE · CLONE` gövde, `PONG · ZONE · LASER · TANKS` hız bu yüzden eksik —
bu bir araç eksiği değil, **B7/B8'in kendisidir.**

---

## 1. Terminoloji — ne "aynı his" değil

Bir oyunun mobilde ve PC'de birebir aynı olması **mümkün değil** ve hedeflenmemeli.
Hedef şudur:

> **Aynı mod içinde, cihaz boyutları arasında fark küçük olsun.**

Bu daha iyi bir tanımdır çünkü hem ulaşılabilir hem doğrulanabilir.

### Yetki modeli bunu "adalet" değil "taşınabilirlik" yapıyor

Önceki taslakta "telefonda oyun daha kolay" denmişti. **Bu yanlıştı ve geri
alındı.** `worldPacket` host'un arena geometrisini taşır; world view'lar
`arena.size = Math.min(arena.width, arena.height)` ile onu yeniden kurar
(`curveWorldView.js:75`, `heistWorldView.js:27`, `collapseWorldView.js:42`,
`cloneWorldView.js:28`). Relay'de `reservedHostSlot` vardır.

**Sahanın şekli tek cihazınki ve oturumdaki herkese aynıdır.** Kimse rakibe karşı
avantajlı değildir.

| Mod | Saha şeklini belirleyen | Kim etkilenir |
|---|---|---|
| TV_CONSOLE | TV | Kimse — herkes aynı ekrana bakar. Sadece kumanda telefonlarının *kumanda UI'ı* farklı |
| ONLINE | P1'in telefonu (host) | Rakip değil — **geliştiricinin ayarının** P1'in cihazına bağlı olması |
| LOCAL | O cihaz | Tek kişi; sorun tuning'in cihaza göre değişmesi |

Yani B9 bir **haksızlık kusuru değil, tuning taşınabilirliği kusurudur.** Bu iyi
haber: sorun gerçek ama varsayıldığından çok daha dar.

---

## 2. ÇÜRÜTÜLMÜŞ YÖN: en/boy oranını zorlamak

Saha en/boy oranını tek bir hedefe zorlama bedeli ölçüldü:

```
viewport             kutu          doğal   1.95   1.85   1.75   ← zorlamada KAYIP %
TV 16:9              1768x930      1.90     3      3      8
masaüstü 16:10       1546x904      1.71    12      8      2
ultrawide 21:9       2356x930      2.53    23     27     31
tablet yatay 4:3      944x662      1.43    27     23     19
tablet yatay 16:10    1086x706      1.54    21     17     12
tel 19.5:9             784x387      2.03     4      9     14
tel 16:9               778x384      2.03     4      9     14
```

Hiçbir hedef oran her cihazı ucuz tutmuyor. En/boy zorlamak, ikinci dereceden bir
sorunu birincil derecede **%3–30 oyun alanı** kaybıyla çözmektir.

**Bu yüzden en/boy oranı zorlanmayacak.** Raporlanacak, sınırlanacak — uygulanmayacak.

---

## 3. DOĞRU YÖN: chrome yoğunluğu

Hissedilen farkın kaynakları sıralandı:

| Sıra | Neden | Durum | Düzeltme bedeli |
|---|---|---|---|
| **1** | **Chrome alanı çalıyor** — telefonda HUD dikey payı yiyor (kompakt yatayda üst pay 3px'e iniyor); oyuncu sıkışık *farklı* bir oyun görüyor | ❌ | **Sıfır** |
| 2 | Gövde/saha ölçeği | ✅ B2 | — |
| 3 | Hız | ✅ B3 | — |
| 4 | Saha en/boy oranı | ⚠️ B9 | %3–30 (reddedildi) |
| 5 | Hareket ipuçları | ❌ B11 | Sıfır |

1 numaralı fark en büyük ve en ucuz düzeltileni. Düzeltme ilkesi:

> **Fazla alanı gizleme, chrome'a harca.**

- Telefon (yatay 19.5:9, alan kıtlığı): minimal chrome, üst şerit sadece skor
- Tablet 4:3 / ultrawide: **artık alan** → skorboard ve takım listesi yan panelde, gizlenmez
- TV 16:9: alan neredeyse tam dolu → chrome üste biner (bugünkü gibi). **Bu durum
  açıkça kabul edilir; 16:9'da artık alan yoktur**

Sınır dürüstçe kaydedilmiştir: "PC'de skorboard gizlemeye gerek kalmaz" cümlesi
16:9 masaüstü ve TV için doğru **değildir**; 4:3 tablet ve ultrawide için doğrudur.

### Bu, hangi mevcut kuralları siler

| Kural | Ne olur |
|---|---|
| AGENTS.md §8 "kompakt yatayda sürekli chrome çizme" | Gerekçesi yerine oturur → kural **kalır**, artık sınıflandırıcı değil **alan payı** kararı verir |
| `renderTopPill(persistent)` | `persistent` yerine **gerçek alan payı** belirleyici |
| Faz 1'deki 4 `isCompactLandscape(window…)` çağrısı | Kapsamı daralır; `hud.js:36` ve `hud.js:511` alan payına bağlanır, `controlGuide.js:26` cihaz sınıfına (giriş yöntemi) kalır |

---

## 4. KARAR: iki ayrı referans — ayar çıpası ve otorite

Saha en/boy oranını zorlamak reddedildi (§2). Onun yerine **iki ayrı referans**
kullanılır ve ikisi farklı işe yarar.

### 4.1 Ayar çıpası (tuning anchor) — tablet yatay

**Karar: tablet yatay 16:10 — `1180×820`.**

Gerekçe, "ortada duruyor" olması değil — **hata çeşididir:**

| Ayar yapılan ekran | Hangi hata görünmez |
|---|---|
| TV / büyük masaüstü | **Bolluk hataları.** Chrome bol bol sığar; telefonda patlar. Kıtlık hatası gizli kalır |
| Küçük telefon | **Kıtlık hataları.** Asgari sığar; tablette ekran boş görünür. Bolluk hatası gizli kalır |
| **Tablet** | **İkisi de görünür.** "Çok kalabalık" ve "çok boş" ikisi de otururken görülür |

**1180×820** seçildi (16:10 Android tablet). iPad 4:3 (`1024×768`) ayrı çıpa
gerektirmez — aralarındaki fark küçük ve aynı 1.43–1.54 bandında.

### 4.2 Otorite (authority) — hangi cihazın şekli geçerli

Sahayı belirleyen cihaz **moda göre değişir** (bkz. §1):

| Mod | Alan şeklini belirleyen |
|---|---|
| ONLINE | Host oyuncunun **telefonu** — herkes o şekli görür |
| TV_CONSOLE | **TV** — herkes aynı ekrana bakar |
| LOCAL | Oynanan cihaz |

Bu yüzden rapor, "bu oyun 16:10 tablete göre ayarlanmış; 2.03 oranlı telefonda
şekli %30 kayıyor" cümlesini kurabilmelidir. Sabit bir referans bunu ifade edemez.

### 4.3 ÖNEMLİ: yedi kontrolün referansa ihtiyacı yok

Aşağıdaki yedi kontrolün **tamamı kendi kendini normalleştiren oranlardır.**
"Bu doğru mu?" diye sormazlar; "bu iki ölçüm tutuyor mu?" diye sorarlar. Herhangi
bir ekranda çalışırlar:

```
gövde/saha oranı      → cihaz ↔ cihaz
geçiş süresi          → cihaz ↔ cihaz
koridor / oyuncu çapı → oyun içi
view vs motor yarıçapı → oyun içi
ölçeklenmemiş px       → kod içi
iz kalınlığı           → kod içi
okunabilirlik          → oyun içi
```

**Referans yalnız dört raporda gerekir** (I8–I11) ve bunlar bilgi amaçlıdır,
yapıyı kırmızıya döndürmez.

| | Sabit oran zorlama | Referans + tolerans |
|---|---|---|
| Oyun alanı kaybı | %3–30 | **%0** |
| Hissedilen fark | ölçülmüyor, ısınmış | ölçülüyor, sınırlı |
| "Aynı his" garantisi | 4:3 tablette %27 ödeyerek | Çıpada birebir; sapma raporlanır |

Bu, "aynı modda dağlar kadar fark olmasın" cümlenin makine-okunur hâlidir.

---

## 5. Kalite kapısı — `npm run health`

**Gerekçe:** 15 oyunu elle deneyemiyoruz. Kapı, denemeyi gereksiz kılar — kapı
yeşilken oynamaya gerek yoktur; kırmızıyken elle oynamak zorunludur.

Kural: **16. oyun bu kapıyı geçmeden tamamlanmış sayılmaz.** AGENTS.md §9'daki
elle kontrol listesi otomatik kapıya dönüşür.

### 5.1 Değişmezler

**Kapı (yeşil/kırmızı olmalı) — referansa ihtiyacı yok, oranlar kendi kendini
normalleştirir (bkz. §4.3):**

| # | Değişmez | Nasıl ölçülür | Bugün | Tolerans |
|---|---|---|---|---|
| I1 | Ölçek bağımsızlığı | gövde/saha oranı, cihaz ↔ cihaz | ✅ var | ≤ %1 |
| I2 | Hız bağımsızlığı | geçiş süresi, cihaz ↔ cihaz | ✅ 11/15 | ≤ %1 |
| I3 | Geçilebilirlik | en dar koridor / oyuncu çapı | ✅ var | ≥ 1.0 |
| I4 | Sadakat | view yarıçapı = motor yarıçapı | ⚠️ 7 kayma | 0 sapma |
| I5 | Ölçeklenmemiş geometri px | `arc`/`lineWidth`/`borderWidth` literal | ⚠️ kör nokta | 0 |
| I6 | Hareket ipuçları ölçekli mi | iz/kalınlık literal'leri | ❌ `lineWidth 8.5` | 0 |
| I7 | Gövde okunabilirliği | en yakın tehdit + oyuncu aynı anda okunuyor mu | ❌ yok | ≥ 1.0 |

**Rapor (kırmızı yapmaz, ama görünür olur) — referans burada gerekir:**

| # | Değişmez | Neden rapor |
|---|---|---|
| I8 | Saha en/boy sapması (B9) | Zorlanmayacak (B10); ama kayma fark edilir |
| I9 | Gövde / saha shortSide oranı | Ölçüldü (B1) ama bant yok; oyun başına değişken |
| I10 | Chrome'un saha alanına oranı | Hissedilen farkın 1 numaralı kaynağı |
| I11 | Tepki süresi (en yakın tehdit → oyuncu) | Ölçülmedi; taban değer oluşturulacak |

> **Tasarım kuralı:** Her şeyi kırmızı yapan kapı işe yaramaz. Yalnız "doğru
> olmalı" olanlar kapı; "izlenmeli" olanlar rapor. Bu ayrım 5.3'te sabitlenir.

### 5.2 Rapor çıktısı

```
ayar çıpası: tablet yatay 16:10 (1180x820)
otorite:     ONLINE→tel 852x393 · TV_CONSOLE→1920x1080 · LOCAL→o cihaz

OYUN      I1    I2    I3    I4    I5    I6    I7   │ I8(sapma) I9     I10
HORDE     ok    ok    ok    ok    ok    HAYIR ok   │ %24      2.9%   %14
ARCHER    ok    ok    ok    ok    ok    ok    ok   │ %25      5.9%   %12
...
sonuç: 14/15 geçti · 1 ihlal (HORDE I6: curveView lineWidth 8.5/2.2/4)
rapor: en büyük I8 sapması ARCHER — 16:10 tablete ayarlanmış, telefonda
       saha şekli %25 kayıyor. ONLINE'da host telefon olduğu için bu,
       o modda oyuncunun gördüğü şey.
```

Tek komut, 15 oyun, tek hüküm. Çıkış kodu: **yalnız kapı ihlali** varsa 1; rapor
sapmaları çıkış kodunu etkilemez.

### 5.3 Uygulama notları

- **Paket:** `src/core/qualityGate.js` — değişmez tanımları, ayar çıpası ve mod→otorite
  eşlemesi tek kaynakta. Motor kodu içine dağıtılmaz (AGENTS.md §8 ihlali olur).
- **Girdi:** `scripts/measure-bodies.mjs`'in yaptığı gibi vite-SSR ile motorları
  gerçekten çalıştırır. Statik taram **değil** — bu oturumda kaynak taraması
  üç kez yanlış cevap verdi.
- **`package.json`:** `"health": "node scripts/health.mjs"` eklenir.
  **Dikkat:** `npm test` sabit bir dosya listesi kullanıyor; yeni bir `*.test.mjs`
  eklenecekse package.json'a da eklenmeli, yoksa çalışmaz.
- **Negatif test:** bilerek bir sapma enjekte et (ör. bir engine'de `PLAYER_RADIUS`
  × 1.3) → kapı kırmızı. Enjekte et → yeşil. Ayrıca iki ayrı kanıt şart:
  **(a)** kapı gerçekten kırmızı gördü, **(b)** kapı bir şeyi kırmızı görmedi —
  yani "her şeyi rapor" moduna alındığında da yeşil kaldığı doğrulanmalı.
  Hiçbir koşulda kırmızı görmeyen bir kapı, kapı değildir.

---

## 6. Uygulama zinciri

### Adım 0 — Oyuncu değişmezleri + referans kuralı (kod değişikliği yok)

**Ne:** §5.1'deki 11 değişmezin yazılı hâli + §4'teki iki referansın kuralı.

**Çıktı:** Bu belgenin §4–§5 bölümleri + AGENTS.md'ye tek madde.

**Neden ilk:** Kapının neyi ölçeceğini ve neleri kırmızı yapacağını tanımlamadan
kapı kodu yazmak, bu oturumda beş kez düşülen tuzaktır. Adım 0 bir cümle değil,
**karar oturumudur.**

**Bu adımda alınacak kararlar:**

| Karar | Değer | Durum |
|---|---|---|
| Ayar çıpası | tablet yatay 16:10 — `1180×820` | ✅ §4.1'de gerekçelendirildi |
| Mod → otorite eşlemesi | ONLINE→tel · TV_CONSOLE→TV · LOCAL→o cihaz | ✅ §4.2 |
| Kapı mı rapor mu ayrımı | 7 kapı, 4 rapor | ✅ §5.1 |
| Kapı toleransları | I1 ≤ %1 · I2 ≤ %1 · I3 ≥ 1.0 · I4 0 · I5 0 · I6 0 · I7 ≥ 1.0 | ✅ §5.1 |
| Rapor toleransları | Yok — rapor kırmızı yapmaz | ✅ §5.1 |
| **I7'nin ölçüm yöntemi** | En yakın tehdit ile oyuncunun ekrandaki minimum ayrımı | ⚠️ **açık** |
| **I11'in taban değeri** | Tepki süresi için kabul edilebilir alt sınır | ⚠️ **açık — önce ölç, sonra sabitle** |

**Açık kalan iki kalem kod yazılmadan kapatılmalıdır.** İkisi de *yeni* ölçüm
gerektirir; tahminle kapatılmayacaktır. I11 için kapı ilk çalıştırmada yalnızca
**taban değer üretecek** (kırmızıya düşmeyecek), ikinci çalıştırmada sabit
toleransa dönecektir.

### Adım 1 — `npm run health` kalite kapısı (düzeltme değil, ALTYAPI)

**Ne:** §5'in uygulanması.
**Ne değiştirmez:** Oyun davranışı, render, hiçbir motor dosyası.
**Neden:** 15 oyunu elle deneyemiyoruz. Kapı olmadan 4–5 oyunda prototip yapıp
gerisini körlemesine bozacağız.
**Bağımlılık:** Adım 0. Bağımsız değil.

### Adım 2 — Kapıyı çalıştır, listeyi ölç

**Ne:** `npm run health` çalıştır → kırmızı listesi.
**Çıktı:** **Ölçülmüş** kusur listesi ve önceliklendirmesi.
**Neden:** Kusur listesi "buldukça yazdık" listesi olmaktan çıkar. Öncelikleme
elle değil, veriyle yapılır. Bu oturumda beş tahmimden dördü yanlış çıktı —
kapı tahminin yerine geçer.

### Adım 3 — Kanıtlanmış kırmızıları onar

Her alt adım: **negatif test önce yazılır**, sonra düzeltilir.

#### 3.1 Sınıflandırıcı tekliği (B5)

`src/core/playfield.js` → `computePlayfield` çıktısına `arena.profile`:

```js
arena.profile = { shortSide, unit, designShort, compactLandscape }
```

`isCompactLandscape(w, h)` saf predikat olarak kalır; çağıranlar `window` geçmez,
`arena` geçirir. Dört çağrı:

```
src/ui/controlGuide.js:26   → cihaz sınıfı (giriş yöntemi) sorusu — arena'ya bağlanmaz
src/games/hordeView.js:946  → alan payı — arena.profile
src/ui/hud.js:36            → alan payı — arena.profile
src/ui/hud.js:511           → alan payı — arena.profile
```

Eşik `tokens.js`'teki 540px cihaz eşiği **değildir** (kategori hatası — 900×600
masaüstü penceresinde saha ~500px diye "MOBILE" der, oysa sorulan soru cihaz değil).
Boyutsuz olmalıdır. Aday: saha kısa kenarının 952 referansına oranı.
**Sayıyı uydurma** — önce `tests/helpers/render-harness.html` ile gözle doğrula,
sonra sabitle ve teste pinle.

**Test:** `tests/arenaProfile.test.mjs` — eşik sınırı (eşik−1 / eşik / eşik+1),
40 rastgele viewport'ta alan sonluluğu, kaynak taramasıyla `isCompactLandscape`
çağrılarında `window` geçmemeli.
**Negatif test:** bir çağrıyı `window.innerWidth`'e geri çevir → kızar.
**Risk:** `arena.profile` ekleyicidir; geri almak 4 çağrıyı eski haline döndürmek.

#### 3.2 Ölçülemez gövdeleri ölçülebilir yap (B7)

| Oyun | Durum | Yapılacak |
|---|---|---|
| COLLAPSE | Runtime'ta gövde alanı yok | Motorda `PLAYER_RADIUS` tanımla, `resize()` içinde `unit` ile ölçekle, `players[].radius` doldur, `worldPacket`'e koy |
| SNAKE | Baş + iz, `players[]` yok | Baş yarıçapını açıkça tanımla, paketten okunabilir olsun |
| CLONE | Retired, ölçülemiyor | Aynı — retired olsa da view ölçeklenmemişse düzelt |

**Test:** `measure-bodies.mjs` bu üç satırda sayı gösterir; `arenaLayout.test.mjs`
içindeki `BODY_RADIUS` tablosu güncellenir (zaten kaynaktan okuyor).
**Negatif test:** COLLAPSE'e literal `9.5` geri koy → 3.3'ün testi kızar.

#### 3.3 World-packet yarıçap denetimi + 7 fallback'i sil (B6)

En kötüsü BOMB 36/14 = **2.6× sapma**. Şu an ölü kod; paket `radius` atladığında
hatayı sessizce yutuyor.

| | Değerlendirme |
|---|---|
| (a) Fallback'i motor sabitinden `import` et | Sapma imkânsız ama **ölü kod kalır** |
| **(b) Fallback'i sil, paketi tek kaynak yap, runtime denetimi koy** | **Doğru olan** — sapma *sınıfını* yok eder |

**Sıra önemli:**

1. **Önce paketin gerçek şeklini oku.** Sıkıştırılmış dizi formatıysa `radius`
   alanı hiç yoktur ve yedi fallback zaten tamamen ölü koddur → doğrudan sil, denetim
   testi gereksizleşir.
2. `radius` taşıyıyorsa **çalışma zamanı** denetim testini yaz (statik taram değil):
   `engine → resize(2 boyut) → startNewMatch → N kare girdi → worldPacket()` →
   her aktör nesnesinde `radius` sonlu mu. **Bu test kalıcı kalır.**
3. Denetim yeşilse → yedi fallback'i sil.
4. Denetim kırmızıysa → motorda eksik `radius` var, **önce motoru düzelt.**

**Risk:** Orta. Yanlış adımda ekranda oyuncu görünmez. Denetim testi önce yazılır.
**Geri alma:** `git checkout` ile yedi dosya.

#### 3.4 COLLAPSE ölçeklemesi + pxConstants kör noktası (B11 benzeri)

`tests/pxConstants.test.mjs` bu sınıf hatayı **kaçırdı** — regex'i `\d{2,}` tek haneli
`9.5`'i görmüyor. Testin kör noktasını kapatmak tek bir literali düzeltmekten daha
değerli.

**Mevcut `\d{2,}` → tüm sayılara açmak yanlıştır** (döngü indisleri, opacity 0–1,
sıra numaraları → yüzlerce yanlış pozitif). Doğrusu dar bir ikinci kural:

> **Kural 2 — geometrik çağrılarda ölçeklenmemiş px:** `arc(`, `ellipse(`,
> `lineWidth`, `borderWidth`, `font` argüman listelerindeki sayı literal'leri.

Bu kural hareket ipuçlarını da kapsar ve B11'i (`curve.js:868` →
`lineWidth = 8.5 / 2.2 / 4`, ayrıca `lineWidth = 6`) yakalar.

**Sıra:** kuralı genişlet → `collapseView`'in **kırmızıya döndüğünü gör** (yakalamazsa
kural yanlıştır, önce onu düzelt) → sonra `collapseView.js:265` ve çevresini
`unit`/`fieldPx` ile türet.

#### 3.5 Play-face sözleşmesi

Altı view `drawBrutalAvatar`'ı doğrudan çağırıp sözleşmeyi atlıyor:
`COLLAPSE · CLONE · LASER · SNAKE · TANKS · ZONE`

**Nüans:** TANKS'ta avatar bir **komutan figürü**, çizilmiş gövde üzerinde
(`s*0.32`, gövde `s×s`). Sözleşmenin kapsamı **"avatarın kendisi olduğu gövde"**
olmalıdır, aksi halde TANKS bozulur.

| View | Taşınacak mı? |
|---|---|
| COLLAPSE · CLONE · LASER · SNAKE · ZONE | Evet → `drawGameAvatar`, `faceMode: 'play'` |
| **TANKS** | **Hayır** — komutan figürü. İstisna olarak kalır, **nedeni yorum olarak yazılır** |

**Test:** `tests/avatarInGame.test.mjs` (zaten var) + "avatarın kendisi olduğu gövde
olan her view `drawGameAvatar` çağırıyor" kontrolü. TANKS istisnası listelenmiş
olmalı — istisnasız kural TANKS'i kırar.
**Negatif test:** ZONE'ı geri çevir → kızar.

### Adım 4 — Fazla alanı chrome'a harca (§3)

**Ne:** Saha en/boy oranı **zorlanmaz**. Bunun yerine saha kutusundaki artık alan
chrome için ayrılır.

- `hud.js:36` / `hud.js:511` → mevcut `arena` alan payı kararına bağlanır
- Skorboard / takım listesi artık alan varsa **yan panele** taşınır, gizlenmez
- `renderTopPill(persistent)` → `persistent` yerine gerçek alan payı belirleyici
- Telefon yatayda üst pay 3px'e inen durum ölçülür: chrome ne kadar alıyor?

**Önce ölç:** kaç viewport'ta artık alan gerçekten var, kaç px? Bu tablo
`hud.js`'in karar mantığını besler, tahminle değil.

**Neden 4. adımda:** Zorlamanın bedeli ölçüldü ve reddedildi (B10); alan
kaybı olmayan tek yöntem bu. Pahalı olduğu için kapı varken yapılır.

### Adım 5 — `getUiScale` / `baseUnit` (en son, en zayıf kanıt)

`getUiScale` `minDim`'den boyut türetiyor; AGENTS.md ilkesine aykırı (*"cihaz sınıfı
yalnız girdi ve safe area belirler, asla boyut"*). **Ama ölçülmüş kusur kanıtı yok.**

**Kanıt olmadan başlatma.** Önce göster: DOM chrome hangi viewport'larda gerçekten
bozuluyor? `getUiScale` birden fazla yerde kullanılıyorsa dokunuş yüzeyi geniştir.

---

## 7. Yapılmayacaklar (gerekçeli)

| Yapılmayacak | Neden |
|---|---|
| Gövde sınıfları (BODY_CLASSES) | B1 **çürüttü** — 7.5× saçılım, uç uca o/ö oranları |
| **Saha en/boy oranını zorlamak** | B10 **ölçtü ve reddetti** — %3–30 oyun alanı kaybı |
| En/boy sapmasını kapıda kırmızı yapmak | Zorlanmadığı için kırmızı olması anlamsız; **rapor** (I8) |
| `baseUnit`'i erken sökmek | En geniş patlama alanı, en zayıf kanıt — Adım 5 |
| Geçiş sürelerini eşitlemek | 3.81–7.76s fark **oyun başına bilinçli tempo**, cihaz farkı değil (B3) |
| pxConstants'i `\d{1,}`'e açmak | Yüzlerce yanlış pozitif; dar geometri kuralı doğru (3.4) |
| Gövdeye damped ölçek eğrisi | Sahaya göre şişirir; sadece RACE dekorunda `propPx`/`PROP_FLOOR` ile kullanıldı |

---

## 8. Doğrulama

```
npm run check              # tsc temiz
npm test                   # yeşil (sabit dosya listesi — yeni test eklenirse package.json'a da ekle)
npm run build              # temiz
npm run health             # yeni — 15 oyun, tek hüküm
node scripts/measure-bodies.mjs
tests/helpers/render-harness.html ?dry=1     # görsel doğrulama
```

**Disiplin kuralı:** Her guard önce **kusuru enjekte ederek kızarma kanıtı** üretir,
sonra düzeltilir. Yeşil teste güvenilerek geçilmez. Kapının kırmızı gördüğü de
ayrıca kanıtlanır — her şeyi yeşil gösteren bir kapı, kapı değildir.

**Commit:** yalnızca kullanıcı isterse. **Push:** yalnızca kullanıcı isterse.

---

## 9. Sıra gerekçesi

```
Adım 0  değişmezler + referans kuralı   ← kod yok, tanım
  └─> Adım 1  npm run health            ← ALTYAPI, hiçbir oyun davranışını değiştirmez
         └─> Adım 2  kapıyı çalıştır    ← kusur listesi ÖLÇÜMle çıkar
                └─> Adım 3  kırmızıları onar (3.1 → 3.5)
                       └─> Adım 4  artık alan → chrome   ← pahalı, kapı varken güvenli
                              └─> Adım 5  getUiScale/baseUnit  ← en zayıf kanıt
```

**Kullanıcının tahmini ile farkı:** Tahmin `kusur → plan → kalite` idi. Gerçek
sıra **`kalite kapısı → ölçüm → kusur → büyük değişiklik`**'dir.

Gerekçe: **kapısız kusur listesi yanlış önceliklendirir.** Bugünkü 4 faz
"buldukça yazdık" listesidir; kapı çalıştığında kırmızı listesi ölçümle gelir.
Ve **15 oyunu elle deneyemiyorsak, 15 motorda geometri değişikliğini de
göremeyiz** — Adım 4'ü beş oyunda prototip yapıp gerisini körlemesine
bozmamak için kapı önce gelmeli.

---

## 10. Doğrulanmamış açık sorular

Bunlar plana **girmek için ölçüm gerektiriyor**, tahminle kapatılmadı:

| Soru | Durum |
|---|---|
| `curve.js:868` dışında kaç ölçeklenmemiş hareket ipucu var? | Ölçülmedi — 3.4'ün kuralı bunu otomatik sayacak |
| Hangi viewport artık alan sunuyor, kaç px? | Ölçülmedi — Adım 4 "önce ölç" ile başlar |
| 16:9 TV'de yan panel açıkça kabul edilebilir mi? | Ürün kararı |
| `getUiScale` hangi viewport'larda gerçekten bozuyor? | Ölçülmedi — Adım 5 kanıt bekler |
| I7 (okunabilirlik) ölçüm yöntemi nedir? | **Açık — Adım 0'da kapatılmalı** (§6) |
| Tepki süresi (I11) taban değeri ne olmalı? | **Açık — Adım 0'da kapatılmalı** (§6) |

### Kapanan sorular (bu oturumda karara bağlandı)

| Soru | Karar | Nerede |
|---|---|---|
| Referans viewport ne olmalı? | **İki ayrı referans:** ayar çıpası = tablet yatay `1180×820`; otorite = moda göre değişir | §4.1, §4.2 |
| Yedi kapı referansa ihtiyaç duyar mı? | **Hayır** — hepsi kendi kendini normalleştiren oran | §4.3 |
| Saha en/boy'u sabitlemeli miyiz? | **Hayır** — %3–30 alan kaybı ölçüldü, reddedildi | §2 |
| B9 bir haksızlık kusuru mu? | **Hayır** — yetki modeli yüzünden tuning taşınabilirliği kusuru | §1 |
