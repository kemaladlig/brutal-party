# MOBILE_SHELL_PLAN — Yatay App Shell + Görsel Rebrand

Durum: **Faz 0 + Faz 1 + koyu kimlik rebrand'i bitti** · Faz 2 (play chrome) ve Faz 3 (yaşam döngüsü) başlanmadı · Başlangıç: Eylül 2026
Mimari/protokol değişiklikleri bittikçe `docs/PROJECT_MAP.md` güncellenir; bu dosya yol haritası ve **tasarım anlayışı** kaydıdır.

Referans: Wild Rift (yatay sabit menü, shell + ekranlar) ve Brawl Stars (görsel dil: yumuşak, yuvarlak, doygun).

---

## Sabit kararlar

1. **App geneli landscape kilit.** Telefon dikeyde tam ekran rotate gate gösterir, yatayda shell gelir. Android/PWA'da `screen.orientation.lock` + fullscreen; iOS'ta lock API yok, gate yönlendirme yapar. `manifest.webmanifest` `orientation: "any"` → `"landscape"`.
2. **Sabit ana menü, yatay sayfalama.** Chrome (ray/şerit) hiç kaymaz. İçerik odakla yatay pan'lanır. Dikey sayfa akışı yok.
3. **Page-level scroll yasak.** Sığmayan içerik ya yatay sayfalanır ya da ekran içi tanımlı scroller'a gider (`overflow` yalnız orada, `overscroll-behavior: contain`, rubber-band yok).
4. **Brawl Stars görsel dili.** Yuvarlak radius, yumuşak katmanlı gölge, dikey gradient yüzeyler, doygun accent + glow, press = translateY + iç gölge. Palet değişiyor, yapı değişmiyor.
5. **Canvas içi sanat kapsam dışı** (opsiyonel Faz 5). Oyun sahanın görünümü Faz 0-4'te aynı kalıyor.

---

## Tasarım anlayışı (AGENTS.md §7'in arkasındaki sezgi)

Bunlar kural değil, **karar vermeyi kolaylaştıran ölçütlerdir.** Her biri bir gerçek hatadan çıktı; parantez içindeki not o hatanın kaynağıdır.

1. **Sahne sayfa değildir.** Her ekran aynı arenada oynar. Paneller **içerikleri kadar** yükseklikte durur; ekrandaki boşluk panel dolgusu değil, **sahnenin zeminidir**. (Lobide `1fr` + `stretch` denendi: paneller kutuya yapışıp kartların içi boşaldı; ~10 tur denendi.)
2. **Her şeyi aynı anda gösterme.** N>8 olan listeler ızgara değil **karusel/adım** olur: tek öğe + `◀ ▶` + sayaç. (15 oyun çipi → tek kapak.)
3. **Bir ekran = bir iş.** Aynı iş için ikinci bir ekran/modal açmak yanlıştır. (PROFIL, karakter düzenlemek için ayrı bir ÖZELLEŞTİR modalı açıyordu; düzenleyici ekrana taşındı.)
4. **Ana + ikincil eylem yan yana durur**, karşı köşelerde değil. (ODA KUR ve PLAY ayrı köşelerde sahneyi ikiye bölüyordu.)
5. **Eylem çubuğu ekranın dibine yapışır** (`margin-top: auto`). Alt bant kutsaldır: oradaki boşluk ölü alandır.
6. **Aynı bilgi iki yerde olmaz.** Sayaç hem bölüm başlığında hem şeritteyse biri silinir.
7. **Paneli germek içerik hatasıdır.** Bir kart büyüyüp içi boşalıyorsa ya kart içeriği büyür ya da kart büyümez.
8. **Kalıcı gezinme, geri düğmesi değil.** Üç hedef (ANASAYFA / OYUN / KARAKTER) yeterli; ara adımlar rayda görünmez. Geri düğmesi eklemek yasak.
9. **Kontrast, zeminden gelir.** Saydam yüzey + açık metin, sahnenin en aydınlık yerinde okunmaz; koyu bir ray taşımak gerekir (`--lobby-rail`).

### Doğrulama: hedef boyut zorunludur

Masaüstü (1440×900) **hedef değildir**; hedef **yatay telefon**dur (ör. 900×460). Üç kural:

- **Her ekranı hedef boyutta da gör.** Geniş ekranda düzgün, 900×460'ta üst üste binen düzenler oldu (dar ekran `grid-template-areas` yeniden yazılıyordu; kaldırıldı, tek düzen her boyutta çalışıyor).
- **Ağ gerektiren ekranlar (oda/lobi) `?devlobby` kancasıyla açılır.** `main.js` sonuna geçici olarak `showHostLobbyModal('417', ...)` konur, doğrulanır, **kanca kaldırılır** — kalıcı araç bırakılmaz. Doğrulama sonrası `(Select-String main.js 'devlobby').Count` = 0 olmalı.
- **`browser.capture` rAF ile yarışır.** Tek `open` + `capture` boş canvas yakalar. 3–4 ardışık capture al, **sonuncuyu** oku. `UnknownVizError` ara sıra döner; tekrar denemek yeterli. Ölçüm gerekiyorsa `browser.inspect` ile `bounds` al — CSS yorumundan güvenilirdir.

## Değişmeyenler

Motorlar, ağ protokolü, 8 Hz HUD / 30 Hz world bütçesi, host authority, `playfield.js` geometri presetleri, `controlDefs.js` kontrol sözleşmesi, koltuk kuralları. Faz 0-4'te hiçbir motor dosyasına dokunulmuyor.

---

## Faz 0 — Token rebrand (davranış değişmez)

**Sorun:** 762 hardcoded hex: `menu.css` 154, `modals.css` 181, `gamepad.css` 260, `lobby.css` 99, `hud.css` 46, `tokens.css` 22.

- [x] 0.1 `src/styles/tokens.css` + `src/ui/tokens.js`'e semantik katman (iki taraf senkron kalmalı):
      `surface`, `surface-2`, `elevated`, `accent`, `accent-2`, gradient stop'ları, `shadow-soft`, `shadow-press`, `shadow-float`, `radius-card` (18), `radius-btn` (14), `radius-pill` (999), `glow-accent`.
- [x] 0.2 Palet eşlemesi: 4 oyuncu rengi doygunlaştırılır ama **slot kimliği korunur** (renk = oyuncu kimliği, AGENTS.md §16). `--gold`/`--danger` yeni accent'e bağlanır. `--shadow-hard` tüketicileri soft'a geçer.
- [x] 0.3 Sweep: 6 CSS dosyası hex'i token referansına çevrilir. Sayfa/satır sayısı korunur, sadece değerler.
- [x] 0.4 `scripts/token-lint.mjs` → `tokens.css` dışında hex arar; `package.json`'a `check:tokens`, `check` script'ine bağlanır.
- [x] 0.5 `public/manifest.webmanifest`: `theme_color` + `background_color` yeni yüzeye.

*Kabul:* görsel değişiklik var, hiçbir yerleşim/hit-test değişikliği yok. `npm run check` + `npm run test` yeşil.

**Faz 0 sonucu:** 687 literal / 109 farklı değer → 35 token'a indirildi. 64 token'lı sözlük, `token-lint` 76 token tanıyor (yerel tanımlar + runtime `setProperty` dahil). Lint iki gerçek hatayı yakaladı: silinen `--radius-brutal` referansı (2 kart, radius geçersizdi) ve `#176438` sızıntısı. 276 test + build temiz. Tarayıcıda masaüstü/mobil giriş ve PONG sahası görsel olarak doğrulandı.

Not: `--shadow-hard` DNA olarak korundu (sadece 6px→4px). Yumuşak gölgeler `--shadow-soft/float/edge/pop/press` olarak **tanımlandı ama henüz tüketilmedi**; tüketim Faz 1'de ekran bazında olacak.

---

## Faz 1 — App shell (asıl iş, en büyük diff)

- [x] 1.1 Çekirdek — `src/ui/appShell.js`. Tek sahibi: `dvh`, safe-area, view stack (push/pop + yatay animasyon), donanım geri tuşu (history), Escape, rotate gate, orientation lock isteği, girdi sahipliği. Başka modül bu listener'ları eklemeyecek. *(Wake lock + install prompt 1.1 dışında: 1.5'te.)*
- [x] 1.2 View registry — `src/ui/views/registry.js`: `registerView(id, {title, rail, build, onEnter, onExit, focus})` + `listRailViews`/`setRootView`. Yeni ekran = bir dosya + bir kayıt satırı.
- [x] 1.3 Odak router — `src/ui/focusRouter.js`: roving tabindex, 2D en-yakın komşu skorlaması, `[data-h-track]` içinde yatay pan, PageUp/PageDown sayfa, `prefersReducedMotion`'a bağlı. Odak değişimi görünüme `shell:focuschange` olayı olarak yayılır.
- [x] 1.4 Girdi arbitration — `setShellInputOwner('menu'|'game')`. Menü sahibiyken klavye + gamepad (D-pad/analog, 250ms repeat) odağa gider; oyun açılınca `inputRouter`'a devredilir. `inputSource.js`'in engine içi arbitration'ından ayrı, üst seviye kural.
- [x] 1.5–1.9 ilk dilim: `home` (hero + 3 mod kartı) ve `games` (yatay poster şeridi + odakla sürülen önizleme + kategori şeridi) uçtan uca çalışıyor. `index.html`'e `#app-shell` + `#app-rotate-gate` iskeleti; `main.js` shell'i mount edip `setGameMode('MENU'|'oyun')` arasında gösteriyor/gizliyor.
### Kalan

- [x] `#menu-overlay` dikey akışı **silindi** (index.html −604 satır), `menuManager.js` ve `initMainMenu` kaldırıldı, picker modalı / showcase carousel / hero banner dropzone / oyun kartı döngüsü `main.js`'den silindi. `GAME_ORDER`, `RETIRED_GAME_IDS`, `preloadEngine` artık `main.js`'de kullanılmıyor → import'tan çıkarıldı.
- [x] `menu.css` (2500+ satır) **silindi**. Yalnız 40 sınıf canlıydı; profil kartının markup'ı `profileView.js`'e taşındığı için kart stilleri `src/styles/profile.css`te sıfırdan yazıldı. Toast + bağlantı bandı `src/styles/notices.css`e taşındı. `style.css` 8 import'tan 6'ya indi.
- [x] Kategori verisi `CARTRIDGES.category` olarak taşındı; eski HTML `data-category` kopyaları silindi. Not: eski sayaçlar **yanlıştı** (DÖVÜŞ 5 / HIZ 4 / TAKTİK 5 = 14, ARCHER'in `aim` kategorisi hiçbir şebe düşmüyordu). Yeni şerit registry'den sayıyor: DÖVÜŞ 6 · NİŞAN 1 · HIZ 3 · TAKTİK 5 = 15.
- [x] `src/ui/overlayHost.js` — overlay semantiğinin tek sahibi (odak trap, Escape, backdrop kilidi, `<html data-overlay>`, shell girdi askıya alma). `pause` / `settings` / `join` / `customize` bağlandı. **Bulunan gerçek hata:** shell `document` seviyesinde ok tuşu dinlediği için modal açıkken odak arkaya kaçıyordu; askıya alma ile giderildi.
- [x] `src/styles/sheets.css` — pause/settings/join ortak sheet dili. Sağ panel (geniş) ↔ alt sayfa (dokunmatik), yuvarlak yüzey, gerçek pill switch, pill segment seçici, okunabilir kontrol referansı satırları, blur backdrop. **Katman sırası önemli:** `sheets.css` `hud.css`/`modals.css`/`lobby.css`'ten SONRA gelmeli, aksi halde eski kurallar yenisini ezer (bu sırada iki kez görüldü).
- [x] "Kontrolleri düzenle" bir switch değil, eylem butonu — `.quick-action-btn` olarak ayrı bileşene ayrıldı (eskiden yanlışlıkla switch gibi görünüyordu).
- [x] `token-lint` `rgba()`/`hsl()` literal'lerini de yakalayacak şekilde genişletildi; 29 sızıntı (`gamepad.css` gradyan/glow'ları) token'a taşındı. Sözlük 106 token.

- [ ] 1.6 Ekranlar:
  - [x] **Home** — konsol menüsü olarak yeniden yazıldı (Wild Rift / Brawl Stars DNA'sı): tam kaplama sahne, **merkezde oyuncu karakteri** (canlı `heroAvatar.js`), **sola yapışık 3 mod butonu** (mod *seçimi*), sağa ikincil eylemler, **sağ altta tek dev OYNA butonu**. Eski "hero metin kartı + 3 kart ızgarası" yapısı atıldı — o bir web sayfasıydı. Mod seçimi `setPlatformMode` ile anında uygulanır, OYNA seçilen modu başlatır. `chrome: 'cinema'` ile üst şerit saydamlaşır.
  - [x] Home — **görsel dil yeniden yazıldı** (ikinci tur). Sahne artık neo-brutalist değil: derin lacivert → canlı altın gradyan, koyu üst/açık alt derinlik. Mod butonları artık beyaz kart değil **renkli gradyan dolgu + yumuşak gölge** (yeşil/mavi/kırmızı). OYNA butonu 3B alt kenar + parlaklık + dönen halka. Karaktere `volume: true` ile hacim (sol üst ışık + sağ alt gölge) ve ince kontur verildi; zemin gölgesi sert disk yerine yumuşak radyal gradyan. `characterRenderer.volume` seçeneği eklendi (oyun içi avatar **değişmedi**).
- [x] **Üst bar ayrı bir OVERLAY katmanı** — `chrome: 'cinema'` kipinde `.shell-topbar` `position:absolute` + `pointer-events:none` (çocuklar `auto`); sahne artık gerçekten tam kaplama, hiçbir yer kapmıyor. HUD öğeleri koyu zeminde cam yüzeyli, ray saydam.
- [x] Home — **son dokunuşlar**: (a) mod butonları ikon ağırlıklı (46px ikon + kısa etiket `AYNI CİHAZ`/`TV`/`ONLINE`), uzun açıklama ve numara gitti, **seçili olan yatay genişleyip açıklamayı gösteriyor**; (b) karakterin altındaki rozet **düzenlenebilir**: isim + kalem + zar, ortak `src/ui/playerNameField.js` bileşeniyle (profil kartı da aynısını kullanıyor — `customizeModal` kendi isim bağlantılarını bıraktı); (c) OYNA **dikdörtgen** (dairesel değil), altında 3B kenar, üstünde `OYNA` + **seçili modun adı**; (d) üst barda **ana sayfa**: marka logosu tıklanabilir → kök görünüm, aktif durumda vurgulu (ray'de ayrı girdi yok); (e) sağ butonlarda **daima görünen kısa yazı** (`KODLA`, `OYUNLAR`).
- [ ] Home: canlı oda "devam et" kartı, arka plan görseli (Faz 4 ikon setiyle birlikte).

### Bölüm B — Koyu kimliğin tüm uygulamaya yayılması

- [x] **Token tabanı koyuya çevrildi.** DOM yüzeyleri koyu; kanvas oyun içi paleti (`UI_COLORS` oyuncu/avatar renkleri) ve saha içi çizim **yerinde kaldı**. Nötr rampa ters çevrildi (`--n-900` artık en açık ton) — roller yeniden eşlenmeden tüm mevcut kurallar geçerli kaldı.
- [x] **Tuzak çözüldü:** krem saha üstüne oturan DOM kaplamaları (`#in-game-hud`, `#staging-bar`, `#countdown-overlay`, `#local-mobile-controls`) ve kumanda yüzeyi (`#gamepad-overlay`) `data-theme="field"` aldı; `tokens.css` bu kapsamda yüzey/mürekkep token'larını geri eşler. İki yüzey ailesi, ikisi de tek sözlükten. Tarayıcıda doğrulandı: sahne krem, üstteki kaplamalar koyu mürekkepli açık panel.
- [x] **Üç rol token'ı** kanıtlanmış çelişkileri çözdü: `--panel` (buton/kart yüzeyi), `--on-accent` (doygun dolgu üstündeki koyu mürekkep), `--edge`/`--edge-strong` (yüzey kenarı + basık gölge kenarı). 108 `border: … var(--ink)` ve 74 `Npx Npx 0 var(--ink)` kullanımı tek kaynağa taşındı — koyu temada `--ink` ile kenar tel kafes gibi görünüyordu.
- [x] **Sıra tamamlandı:** token flip → games → profile → sheets (pause/settings/join) → notices. Her adımda `check` + `test` + `build` + tarayıcıda görsel kontrol. `manifest.webmanifest` ve `theme_color` koyu yüzeye çevrildi.
- [x] **Bulunan gerçek hatalar (koyu temanın açığa çıkardıkları):**
  1. `<button>`'lar tarayıcının UA `buttontext` **siyahını** kullanıyordu — koyu zeminde oyun başlıkları, kategori çipleri ve numara rozetleri görünmezdi. Çözüm: `tokens.css`'te `button, input, select, textarea { font: inherit; color: inherit }`.
  2. **Global `.hidden` yardımcısı hiç tanımlı değildi** — her öğe kendi `#id.hidden` kuralını taşıyordu, kuralı olmayanlar (`#btn-clear-room-code`) görünmemeyi umuyordu ve görünüyordu. Çözüm: tek `.hidden { display: none !important }`.
  3. "Ters kontrast" düzeni (`background: var(--ink)` + `color: var(--white)`) koyu temada iki tarafı da açık bırakıyordu: dil segmenti (`TR` görünmez), birincil butonlar, lobi rozetleri. Çözüm: bu yüzeylerde `color: var(--surface)`.
  4. `token-lint` isimlendirilmiş renkleri yakalamıyordu (`color: black` yazmak sözlüğü atlamak demek). Genişletildi.
- [x] **Oyun rafı yeniden düzenlendi.** 1:1 kapak görselleri tek sırlı dikey afişte havada kalıyordu (yüksek kart, ortada küçük görsel). Track ızgaraya çevrildi: 15 oyun tek ekranda, kırpma yok, `focusRouter`'ın 2B gezinmesi bedava çalışıyor. Kapak penceresi `object-fit: contain` + `--art-board` (krem zemin) → afiş mantığı. CTA panele altına yaslandı.
- [x] **Kontrol referansı insan okunur.** Ham `KeyboardEvent.code` (`ArrowLeft/ArrowUp/…`, `KeyI`) gösteriliyordu; `inputMaps.getKeyCapLabel(code)` eklendi ve fiziksel diziliş okunduğu sırada yazılıyor: `W A S D + SPACE`, `↑ ← ↓ → + ENTER`, `I J K L + O`, `T F G H + B`.
- [x] **DOM emojileri temizlendi** (AGENTS.md §7): yeni `src/ui/iconSlots.js` (`hydrateIconSlots`) tek uygulama; `hostLobby.renderLobbyIcons` ona devredildi. Ayarlar sheet'i + katılım sheet'i + profil ifade çipi Lucide SVG'ye geçti, emojiler i18n sözlüğünden de çıkarıldı.
- [x] **Portre/dar düzen onarıldı.** Üç sütunlu "ray / sahne / yan" düzeni 390px'te çakışıyordu (mod butonu karakterin, yan butonlar sahnenin üstünde, bilgi şeridi OYNA'nın altında). Dar düzen yığıldı: modlar üstte tek sıra → sahne ortada → yan eylemler → tam genişlik OYNA.
- [ ] **Kalan:** staging bar ve in-game HUD butonlarındaki emojiler (`🏟`, `📺`, `▶`, `⋮`) + customize modalındaki 9 ifade emojisi (`customizationManager.AVATAR_EXPRESSIONS[].icon`) ve `custom.secFace`/`custom.tabFace` i18n anahtarları. `tabletopIcons`'ta karşılık gelen vektör ikon yok; ikon seti genişletilmeli.
- [ ] **Host lobi görsel doğrulaması kullanıcıda.** `#tv-host-modal` koyu temaya statik denetimle uygun (ters kontrast çiftleri tarandı, 2 bulgu düzeltildi) ama lobi **ağ üzerinden** açıldığı için tek cihazda açılamıyor; iki cihazla gözle doğrulanmalı.
  - [x] **Game picker** — ızgara rafı + odakla sürülen önizleme paneli + kategori çipleri (ikonlu). Kart verisi `CARTRIDGES`'ten; kategori sayıları registry'den.
  - [x] **Lobby** — iki satır × iki sütun, **tek düzen her boyutta**: üstte `ODA` (kod/QR/WhatsApp) + `KOLTUKLAR` (2×2, kart tek satır: avatar | isim | durum | takas), altta tam genişlik `OYUN` şeridi (karusel: büyük kapak + büyük ad + `n / 15`). Eylem çubuğu ekranın dibine yapışır (`margin-top: auto`, koyu `--lobby-rail`). Bölüm anahtarı ve dikey sayfa akışı yok.
  - [x] **Profile → KARAKTER (düzenleyici)** — ikinci bir ekran açmıyor: renk paleti, yüz ifadesi, isim alanı ve `ZARLA` doğrudan ekranda (`.profile-editor`, iki sütun; dar ekranda tek sütun). `keepAlive` + avatar döngüsü `IntersectionObserver` ile kart görünürlüğüne bağlı. Karakter başka yerden değişirse seçim ızgaraları `brutal_customization_changed` ile tazelenir.
  - [x] **Settings** — sheet olarak çalışıyor (`src/styles/sheets.css`): yuvarlak satırlar, pill switch'ler, segment seçici, accent slider. Shell üst şeridindeki ayar düğmesinden açılıyor; `overlayHost` kaydıyla odak trap + Escape.
  - [x] **Controls reference** — pause sheet içinde slot başına okunabilir satır (bkz. yukarıdaki `getKeyCapLabel` maddesi).
  - [x] Modallar → sheet dili (pause/settings/join ortak katman; dar ekranda alt sayfa).
- [x] 1.7 TV/host yolu aynı registry'ye. `#tv-host-modal` artık modal değil: `views/lobbyView.js` düğümü **devralır** (`keepAlive` + idempotent `build`), kabuk `revealView('lobby')` / `closeView('lobby')` ile görünürlüğü yönetir. `rail: null` + `backToRoot: true` — lobi navigasyon basamağı değil, odayı bırakıp ana menüye döner.
- [x] 1.10 Ana menü → oda → lobi akışı yeniden kurgulandı (kullanıcı düzeltmesi): ana menüde üç mod butonu yerine **tek OYNA** (altın) + **ODA KUR** (turkuaz) + KODLA/YÜKLE. Oda ekranı bir form değil, **ana menünün devamı olan bir sahne**: aynı arena, karakter sol köşede küçük, sağda `TV` / `ONLINE` dev yazıları. Yerel oynama oda ekranından kaldırıldı (OYNA zaten onu yapıyor). Buton ailesi ve arka plan `src/styles/scene.css`'e taşındı — iki ekran artık aynı dili kullanıyor, "farklı site" gibi görünmüyor.
- [x] 1.11 ~~Üst barda geri düğmesi~~ **GEÇERSİZ KILINDI (karar 32).** Yerine kalıcı gezinme: `ANASAYFA / OYUN / KARAKTER` (`rail.order`), sola yaslı. `#shell-back` markup + CSS'i silindi. `goHome()` yığını köke indirir, `onLobbyExit` açık odayı kapatır.
- [x] 1.12 Ölü stil kod temizliği: 37 CSS kuralı + 13 token silindi (bento kartları, eski D-pad ailesi, ölü pause/customize parçaları, ölü kumanda parçaları). Sözlük 148 → 135 tanım, 0 kullanılmayan.
- [x] 1.8 İlk dilim kuralı uygulandı: 1.1-1.4 + Home + Games uçtan uca, tarayıcıda doğrulandı, sonra genişletilecek.
- [ ] 1.9 Chrome varyantları. Kumanda telefonu (TV_CONSOLE): nav'suz slim shell + rotate gate dışında kod girişi ekranı.

*Kabul:* hiçbir ekran dikey kaymıyor; TV kumandayla ve ok tuşlarıyla gezinilebiliyor; hiçbir yerde sayfa scrollbar yok.

---

## Faz 2 — Play chrome + sonuç ekranı

- [ ] 2.1 Overlay polish: görünür thumb boyutlu joystick + yumuşak halka (sol-alt erişim yayı), yuvarlak glossy aksiyon butonları, radyal cooldown dolgusu, aktif squash. Ölçüler `controllerLayout.js`'ten, sözleşme `controlDefs.js`'ten — **yeni kontrol geometrisi yazılmaz**.
- [ ] 2.2 Üst HUD güvenli şeritte: skor/süre, takım güç barları, kill-feed toast'ları sağ üstte.
- [ ] 2.3 Her dokunuş/butonda haptik + ses, `haptics.js` gate'inden.
- [ ] 2.4 Sonuç = tam ekran: MVP banner, skor tablosu, büyük `TEKRAR OYNA` + `LOBİYE DÖN`, konfeti. `motionScale` bağlı.
- [ ] 2.5 Pause sheet: safe-area ve tema yeni palete bağlanır.

---

## Faz 3 — Yaşam döngüsü

Maç başında fullscreen + `lock('landscape')`, resume'da relock, wake lock, iOS fallback gate, `visibilitychange` temizliği, PWA standalone `orientation`.

---

## Faz 4 — Asset'ler

- [ ] 4.1 15 oyun ikonu yeni dilde. AGENTS.md §10 formülüne göre prompt listesi, görseli kullanıcı üretir. Önce `public/assets/games/` temizliği: `horde-1.jpg`, `race-1.jpg`, `horde.bak.jpg`, `race.bak.jpg` (~3.5 MB) dead weight.
- [ ] 4.2 PWA ikonları: `scripts/generate-icons.mjs` sharp+SVG; SVG yeni dile göre güncellenir. Not: `@google/genai` bağımlılığı **kullanılmıyor** — istenirse 4.1'i bir script'e yazabiliriz, anahtar `.env`'den okunur (commit edilmez).
- [ ] 4.3 Avatar hacim: `characterRenderer.js` + `avatarInGame.js`'e yumuşak üst ışık + alt gölge. Siluet ve yazısız kimlik kuralı korunur.
- [ ] 4.4 Font: gövde Space Grotesk kalır, başlık için yuvarlak display face (opsiyonel, PWA'da cache'lenir).

---

## Faz 5 (opsiyonel) — Canvas içi sanat

`arenaKit.drawObstacle`, `drawPickup`, `avatarInGame`, 15 `*View.js` renderer'ı yumuşak gölgeli Brawl diline. Oyun başına artı, ayrı iş, kapsam dışı bırakıldı.

---

## Contract güncellemeleri

- [x] `AGENTS.md` §7: görsel dil, **tek renk sözlüğü** (hex + rgba + hsl + isimlendirilmiş renk), **token rolleri** (`--panel`/`--on-accent`/`--edge`/krem saha kapsamı + global sıfırlamalar), **overlay semantiği**, **shell tek sahibi**, **ortak DOM bileşenleri**, **DOM emojisi yasağı**, **sayfa akışı yasağı**, app-geneli landscape kilidi.
- [x] `docs/PROJECT_MAP.md`: §1 dosya listesi (appShell, focusRouter, overlayHost, views/, heroAvatar, playerNameField, iconSlots, profile.css, notices.css; `menuManager.js` ve `menu.css` silindi), §5 karar defterine 27/28/29. maddeler, §6 oyun ekleme adımları (bento satırı kaldırıldı), §7 UI kuralları.
- [x] Yeni `.md` dosyası yok (bu yol haritası ve mevcut roadmap hariç).

## Riskler

- **1.1–1.5 diff büyüklüğü** — 1.8 dilim kuralı bunu yönetiyor.
- **TV/host regresyonu** — AGENTS.md §11'in 3 manuel provasına 4. madde: kumanda telefonu hâlâ katılıp oynuyor. `#tv-host-modal` ve kumanda yüzeyi (`#gamepad-overlay`) canlı olarak doğrulanamadı (ikisi de ağ/ikinci cihaz gerektiriyor); statik denetim + kapsam atamasıyla korundu.
- **`qualityGate.js` eşikleri** — I8-I11 raporları mevcut chrome'a göre; Faz 1 sonrası yeniden ölçülür. `TUNING_ANCHOR` tablet 16:10 1180×820 yatay olduğu için geçerli.
- ~~**762 hex**~~ — token lint + gözle kontrol. **Kapandı:** 687 hex → 35 token, lint `hex`/`rgb()`/`hsl()`/isimlendirilmiş renk ve çözülemeyen `var()` yasaklıyor.
- **Portrait kilidi motoru bozabilir** — rotate gate engine boot/resize'ı kilitlemeden önce durduracak.
- **Testler** — 48 test dosyası yeşil kalmalı; playfield/view regresyonları Faz 1'de en çok kırılacak yer.
- **Koyu temada gizli kalan yüzeyler** — koyu tema bir hata sınıfını görünür kıldı (UA `buttontext` siyahı, ters kontrast, eksik `.hidden`). Yeni bir yüzey eklerken koyu/açık çelişki denetimi yapılmalı: her kuralda `background` token'ı ile `color` token'ı **zıt sınıflarda** olmalı.

## Sıra

`0 → 1.1-1.4 + Home → 1.5-1.9 → 2 → 3 → 4`, Faz 5 isteğe bağlı. Her faz `npm run check` + `npm run test` + `npm run build` yeşil + 4 manuel prova.
