/**
 * Geçilebilirlik ölçümü — test yardımcısı.
 *
 * Bir oyuncu diski (yarıçap R) saha içinde hangi noktalara ulaşabilir? Izgara
 * tabanlı flood fill: hücre, engellerin R kadar şişirilmiş halinden ve saha
 * duvarından R kadar içerideyse boştur. Merkeze en yakın boş hücreden başlayıp
 * saha kenarına (R + 2 hücre içinde) ulaşılabiliyorsa rota vardır.
 *
 * Neden gerekli: "engeller çakışmıyor" testi GEÇİLEMEYEN koridorları
 * yakalamaz. `cross` preset'i çakışma testinden geçerken dikey geçişi
 * tamamen kapatıyordu (ölçülen boşluk 10px, karakter çapı 44px).
 */

/**
 * @param {Object} arena - computePlayfield çıktısı
 * @param {Array<{x:number,y:number,w:number,h:number}>} nodes - Engel AABB'leri
 * @param {number} radius - Gezen diskin yarıçapı (px)
 * @returns {{ reachable: boolean, freeCells: number, start: {x:number,y:number}|null }}
 */
export function discReachability(arena, nodes, radius) {
  const R = Math.max(0.5, radius);
  const step = Math.max(1.5, R * 0.35);
  const cols = Math.max(3, Math.ceil((arena.right - arena.left) / step));
  const rows = Math.max(3, Math.ceil((arena.bottom - arena.top) / step));

  // Engel + oyuncu: yarıçap R kadar şişirilmiş hâli engeldir.
  const blockers = nodes.map((n) => ({
    x: n.x - R, y: n.y - R, w: n.w + 2 * R, h: n.h + 2 * R,
  }));

  const free = new Uint8Array(cols * rows);
  const at = (gx, gy) => {
    const px = arena.left + (gx + 0.5) * step;
    const py = arena.top + (gy + 0.5) * step;
    if (px < arena.left + R || px > arena.right - R) return false;
    if (py < arena.top + R || py > arena.bottom - R) return false;
    for (let i = 0; i < blockers.length; i += 1) {
      const b = blockers[i];
      if (px > b.x && px < b.x + b.w && py > b.y && py < b.y + b.h) return false;
    }
    return true;
  };

  let freeCells = 0;
  // `edge` = kenara bu kadar yakın serbest hücre (kaçış noktası).
  const edgeMargin = R + step * 2;
  const edge = [];
  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      if (!at(gx, gy)) continue;
      free[gy * cols + gx] = 1;
      freeCells += 1;
      const px = arena.left + (gx + 0.5) * step;
      const py = arena.top + (gy + 0.5) * step;
      if (px - (arena.left + R) < edgeMargin
        || (arena.right - R) - px < edgeMargin
        || py - (arena.top + R) < edgeMargin
        || (arena.bottom - R) - py < edgeMargin) {
        edge.push(gy * cols + gx);
      }
    }
  }

  const cx = (arena.left + arena.right) / 2;
  const cy = (arena.top + arena.bottom) / 2;
  let start = -1;
  let bestDist = Infinity;
  for (let i = 0; i < free.length; i += 1) {
    if (!free[i]) continue;
    const gx = i % cols;
    const gy = (i / cols) | 0;
    const dx = arena.left + (gx + 0.5) * step - cx;
    const dy = arena.top + (gy + 0.5) * step - cy;
    const d = dx * dx + dy * dy;
    if (d < bestDist) { bestDist = d; start = i; }
  }

  if (start < 0 || freeCells === 0) {
    return { reachable: false, freeCells, start: null };
  }
  if (edge.includes(start)) {
    return {
      reachable: true,
      freeCells,
      start: { x: cx, y: cy },
    };
  }

  const seen = new Uint8Array(free.length);
  const queue = [start];
  seen[start] = 1;
  const edgeSet = new Set(edge);
  while (queue.length) {
    const i = queue.pop();
    if (edgeSet.has(i)) {
      return {
        reachable: true,
        freeCells,
        start: {
          x: arena.left + ((i % cols) + 0.5) * step,
          y: arena.top + (((i / cols) | 0) + 0.5) * step,
        },
      };
    }
    const gx = i % cols;
    const gy = (i / cols) | 0;
    if (gx > 0 && !seen[i - 1] && free[i - 1]) { seen[i - 1] = 1; queue.push(i - 1); }
    if (gx < cols - 1 && !seen[i + 1] && free[i + 1]) { seen[i + 1] = 1; queue.push(i + 1); }
    if (gy > 0 && !seen[i - cols] && free[i - cols]) { seen[i - cols] = 1; queue.push(i - cols); }
    if (gy < rows - 1 && !seen[i + cols] && free[i + cols]) { seen[i + cols] = 1; queue.push(i + cols); }
  }

  return { reachable: false, freeCells, start: null };
}

/**
 * Bir preset'in EN DAR geçişini ölçer: aynı hizadaki iki engel arasındaki
 * yatay/düşey açıklığın minimumu (px). Koridor "dikey olarak geçilemiyor"
 * gibi belirtilen hataları doğrudan görünür kılar.
 *
 * @param {Object} arena
 * @param {Array<{x:number,y:number,w:number,h:number}>} nodes
 * @returns {number} px cinsinden en dar geçiş (çarpışma yoksa Infinity)
 */
export function narrowestPassage(arena, nodes) {
  let min = Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      // Düşey hizalı: dikey açıklık ölçülür (y ekseni örtüşüyor).
      const yOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (yOverlap > 0) {
        const gap = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
        if (gap > 0) min = Math.min(min, gap);
      }
      // Yatay hizalı: yatay açıklık ölçülür.
      const xOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      if (xOverlap > 0) {
        const gap = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
        if (gap > 0) min = Math.min(min, gap);
      }
    }
  }
  return min;
}
