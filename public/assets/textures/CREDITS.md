# Yüzey dokuları — kaynak ve lisans

2.5D saha/masa yüzeyleri için kullanılan seamless dokular. Hepsi **CC0**
(kamu malı) — ticari dahil serbest, atıf zorunlu değil; yine de kaynağı
kayda geçiriyoruz.

| dosya | slot | kaynak | lisans |
|---|---|---|---|
| `wood.webp` | masa ahşabı | [ambientCG — Wood096](https://ambientcg.com/a/Wood096) | CC0 |
| `felt.webp` | mat dokuma | [ambientCG — Fabric061](https://ambientcg.com/a/Fabric061) | CC0 |
| `grass.webp` | çim | [ambientCG — Grass008](https://ambientcg.com/a/Grass008) | CC0 |
| `stone.webp` | mermer/taş | [ambientCG — Marble012](https://ambientcg.com/a/Marble012) | CC0 |
| `metal.webp` | metal/panel | [ambientCG — CorrugatedSteel009](https://ambientcg.com/a/CorrugatedSteel009) | CC0 |

İşleme: ambientCG `1K-JPG` `Color` haritası → 1024×1024 → WebP (q~0.72).
Dokular `core/fieldTextures.js` üzerinden yüklenir ve canvas'ta tema tonuyla
(`globalCompositeOperation='color'`) yeniden renklendirilir; yani tek doku
birden çok temaya hizmet eder.
