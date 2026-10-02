// TiltedScene — 2.5D sahne zarfı (TEK kaynak): kamera sığdırma + derinlik kuyruğu.
//
// Neden var: dönüştürülen her oyun eskiden AYNI üç şeyi elle kabloluyordu —
//   (1) proj yaşam döngüsü (host kalıcı / client taze),
//   (2) `makeTiltedProjector` ile fit + kamera preset'i,
//   (3) `sceneBegin`/`sceneEnd` derinlik penceresi.
// Guide (§4.2/§4.3) bu üçünün host ile client'ta BİREBİR aynı olmasını şart
// koşar; elle kablolamada unutulan `sceneEnd`, çift `paintBackdrop` veya kayan
// kamera bu tekrarın doğrudan sonucudur. Bu modül o üçünü tek yere indirir.
//
// Kullanım (host motoru):
//   constructor:  this.scene = createTiltedScene({ camera: TILTED_25D_CAMERA.bomb });
//   render():     const proj = this.scene.open(ctx, { viewport: this.viewport, arena: this.arena, theme });
//                 ... drawXxxArena(ctx, arena, ..., { proj }) ...
//                 this.scene.close(ctx);
//
// Kullanım (ONLINE client, `ui/*WorldView.js`): renderer kurulumunda bir kez
// `createTiltedScene({ camera })`; `render()` içinde
//   const arena = arenaFromRect(frame.arena);
//   const proj = scene.open(ctx, { viewport: { width, height }, arena, theme });
//   ... host ile AYNI çizim çağrıları ...
//   scene.close(ctx);
//
// `proj` ÖRNEĞİ kalıcıdır (kare başına tahsis yok): `open()` mevcut örneği
// yeniden sığdırır, kimliği değişmez.

import { createProjector, makeTiltedProjector } from './projection2d.js';
import { sceneBegin, sceneEnd, sceneDraw } from './arenaKit.js';

/**
 * @param {{camera?: {tilt?:number, extraW?:number, extraH?:number, yBias?:number}|null}} [opts]
 */
export function createTiltedScene({ camera = null } = {}) {
  let proj = createProjector();
  let open = false;

  const scene = {
    /** En son `open()`'a verilen arena (HUD/ekran-kutusu hesabı için). */
    arena: null,
    /** Kalıcı projector örneği (kimlik sabit; `open()` yeniden sığdırır). */
    get proj() { return proj; },

    /**
     * Kamera proj'unu viewport+arena+temaya sığdır ve derinlik kuyruğunu AÇ.
     * Host ve client AYNI girdileri vermeli; aksi halde sahne kayar.
     * @returns {any} sığdırılmış projector (kalıcı örnek)
     */
    open(ctx, { viewport, arena, theme }) {
      scene.arena = arena;
      proj = makeTiltedProjector(viewport, arena, theme, proj, camera || undefined);
      sceneBegin();
      open = true;
      return proj;
    },

    /** Kuyruğa öğe ekle — açık pencerede taban-Y'ye göre sıralanır, kapalıyken anında çizilir. */
    depth(ctx, y, draw, a = null, b = null) {
      sceneDraw(ctx, y, draw, a, b);
    },

    /** Sahneyi sıralayıp çiz ve pencereyi kapat (idempotent — iki kez çağrı güvenli). */
    close(ctx) {
      if (!open) return;
      sceneEnd(ctx);
      open = false;
    },
  };
  return scene;
}
