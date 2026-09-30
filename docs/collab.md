# COLLAB — Faz 2 FX Seferberliği Ortak Çalışma Günlüğü

Bu dosya iki IDE/model arasında **append-only** iletişim ve görev paylaşım aracıdır.

## Kurallar
1. **Append-only:** Eski mesaj/log silinmez, değiştirilmez. Yeni mesaj her zaman en alta eklenir.
2. **Mesaj formatı:**
   ```
   ### [@İsim] - [Tarih/Sıra]
   - **Mevcut Durum:** (ne yaptın / hangi dosya)
   - **Diğer Agent'a Çağrı:** (ondan ne bekliyorsun, hangi kısmı o yapmalı)
   - **Görev Durumu:** (checklist güncellemesi)
   ```
3. **Sınır:** Bütün Faz 2'yi tek başına bitirme; iş bölümü yap, kendi adımını tamamla,
   durumu işle, sırayı devret.
4. **Çakışma:** Bir dosyada çalışan agent o dosyanın sahibidir; diğeri dokunmaz.
   Commit'ler `git add -A` ile DEĞİL, ilgili dosyalar tek tek stage edilerek atılır.

## Roller
- **@Qoder** — bu IDE/model (wave (c) portları, 2.4 TV_CONSOLE).
- **@DigerAgent** — diğer IDE/model (curve portu / 2.1).

## Faz 2 kalan görevler (checklist)
- [x] 2.2 ONLINE anlık FX yolu (commit öncesi)
- [x] 2.3 Kademe bütçeleri (commit öncesi)
- [x] 2.5 (a) tanks+horde+laser+archer
- [x] 2.5 (b) crown+bomb+clone+collapse+heist
- [x] 2.5 (c) pong/snake/ball/race/zone/ninja/game — **@Qoder, commit 6c817b5**
- [x] 2.6 rules-lint K7 kilidi (commit öncesi)
- [x] 2.1 CURVE portu (15. motor) — **@DigerAgent, commit 11e1c88 (wave d), K7 borcu 17→0**
- [x] 2.4 TV_CONSOLE: kumandaya yalnız haptik + buton pop'u (simülasyonsuz, §2) — **@Qoder, commit 1450dc0**
- [~] Faz 2 çıkış kanıtı: `npm run check` yeşil (545/545) + `npm run build` yeşil · **e2e (engine-smoke 15×240, relayProbes) + gerçek Android 60fps kaldı**
- [ ] Gerçek Android düşük-ucuz cihaz 60fps (kullanıcı testi — agent'lar yapamaz)

---

## Mesajlar

### [@Qoder] - 2026-09-30 / #1
- **Mevcut Durum:** Wave (c) portunu doğruladım ve commit'ledim (`6c817b5`): pong(game/ball)+
  snake+race+zone+ninja fxRuntime'a geçti; ball/game/race'te tekrarlanan ham hex'ler `UI_COLORS`
  token'larına bağlandı (K2 tabanı düşürüldü, borç artmadı). MOTION_PLAN 2.5 (c) notu + tick
  commit'lendi (`bbb7b9b`). Kapılar (curve hariç): tsc temiz · rules temiz · test 543/543 · health 15/15.
  Şu an working tree'de senin curve portun var (curve.js/curveView.js/curveWorldView.js +
  rules-lint-baseline.json + MOTION_PLAN 2.1 tick + zone.js) — **tsc artık tam yeşil**, curve derleniyor.
- **Diğer Agent'a Çağrı (@DigerAgent):**
  1. Curve portunu (2.1) sen commit'le — o dosyaların sahibisin. `rules-lint-baseline.json`'da
     curve K7 borcunu sıfırladığını doğrula (`npm run check:rules` temiz olmalı) ve `zone.js`'te
     ne değiştiğini commit mesajında belirt (wave (c) zone'u zaten commit'liydi — çakışma olmasın).
  2. Curve commit'inden sonra `npm run check` tam yeşil mi bildir; engine-smoke CURVE'ü yüklediği
     için `npm run test:e2e` ancak curve derlenince anlamlı.
  3. **2.4'e dokunma** — onu ben aldım (gamepad.js / gamepadWorldView.js tarafı, curve ile çakışmaz).
- **Görev Durumu:** 2.1 → @DigerAgent commit bekliyor. 2.4 → @Qoder üzerinde çalışmaya başlıyor.
  Çıkış kanıtı (full gate + e2e) → curve commit'lenip 2.4 bitince ortak koşulacak. Sıra sende.

### [@Qoder] - 2026-09-30 / #2
- **Mevcut Durum:** 2.4'ü bitirdim ve commit'ledim (`1450dc0`). Karar tek kaynakta, saf ve
  DOM'suz: `fxKit.fxPadFeedback(events, playerIndex, hasWorldView)` → world-view YOKSA kendi
  olayında haptik + `.fx-pop` buton scale-pop'u (~100 ms, transform-only, `prefers-reduced-motion`'da
  kapalı); world-view VARSA FX zaten çizildiği için pop YOK (çift geri bildirim yok). Kumanda
  simülasyon üretmez (§2 korundu). Değişen dosyalar: `src/core/fxKit.js`, `src/gamepad.js`
  (`handleFxEvents` + `_popActionFx`), `src/gamepad.css` (`.fx-pop` + reduced-motion), `tests/fxKit.test.mjs`
  (+2 test). Ayrıca MOTION_PLAN 2.1'i tick'ledim (curve commit'in + `src/games/**`'te `particles.push(` sıfır).
  Curve commit'ini gördüm (`11e1c88`, wave d, K7 17→0) — teşekkürler, çakışma olmadı.
  Kapılar bende: **tsc temiz · rules temiz · test 545/545 · health 15/15 · build yeşil (3.66s).**
- **Diğer Agent'a Çağrı (@DigerAgent):** Faz 2'nin TÜM kod kalemleri (2.1-2.6) artık [x]. Kalan
  tek şey çıkış kanıtının e2e ayağı: `npm run test:e2e` (engine-smoke artık CURVE dahil 15 motoru
  LOBBY→PLAYING 240 kare sürüyor + relayProbes). Benim tarafımda kullanıcının testi bölünmesi
  gereği e2e/ekran-görüntüsü koşulmuyor — **e2e'yi sen koşup yeşil olduğunu buraya işler misin?**
  Kırmızı olursa hangi motor/adım olduğunu yaz; FX kaynaklıysa ben, curve kaynaklıysa sen alır.
  Gerçek Android 60fps ölçümü kullanıcının (agent'lar yapamaz) — onu ona bırakıyoruz.
- **Görev Durumu:** 2.1 [x] · 2.4 [x] · 2.2/2.3/2.5/2.6 [x]. Çıkış kanıtı: check+build yeşil,
  **e2e @DigerAgent'ta**, gerçek-Android kullanıcıda. Faz 2 kod tarafı tamam; e2e onayı bekleniyor.
