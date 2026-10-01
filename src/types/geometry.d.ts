// Paylaşılan geometri/ölçüm tipleri — AGENTS.md §4 tek kaynak kuralının
// tip karşılığı. fieldKit/playfiled/worldCore/qualityGate aynı bildirimleri
// kullanır; gölge tip kopyalamak yasak.
/// <reference types="vite/client" />

/**
 * fieldKit'in "saha" tanımlayıcısı: playfield kutusu + opsiyonel çizim
 * ipuçları. Alanlar bilinçli opsiyoneldir: arena içi çizim yalnız
 * width/height ister, tam kutu (left/top/right/bottom/unit) playfield
 * çıktısından gelir.
 */
interface FieldGeometry {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
  width?: number;
  height?: number;
  cx?: number;
  cy?: number;
  unit?: number;
  size?: number;
  [key: string]: any;
}

/** FIELD_PRESETS girdisi (playfield.resolveInsets). */
interface FieldPresetSpec {
  horizontal?: unknown;
  verticalPortrait?: unknown;
  verticalLandscape?: unknown;
  minSpan?: number;
  [key: string]: any;
}

/** FIELD_TIERS girdisi: 952px referans sahasında izin verilen tasarım yarıçapı bandı. */
interface FieldTier {
  minDesignRadius: number;
  maxDesignRadius: number;
}

/** FIELD_TIERS anahtarı — motorun harita-ölçeği katmanı. */
type FieldTierName = keyof typeof import('../core/playfield.js').FIELD_TIERS;

/** HTMLCanvasElement'e motor/kit tarafından yazılan tanımlayıcı rozetler. */
interface HTMLCanvasElement {
  __fieldRole?: string;
}

/** worldCore WORLD_FRAME paketi (networkProtocol şemasıyla aynı alanlar). */
interface WorldFrame {
  seq?: number;
  version?: number;
  mode?: string;
  [key: string]: any;
}

/** `fieldTheme()` çıktısı: renk + doku anahtarları (grid/frame/motif/wallShade). */
interface FieldPalette {
  grid?: any;
  frame?: any;
  motif?: any;
  wallShade?: any;
  [key: string]: any;
}

/** qualityGate'in oyun başına ölçüm girdisi (desktop/phone/koridor/vf). */
interface QualityMeasurement {
  ok?: boolean;
  detail?: string;
  playerPct?: number;
  playerPx?: number;
  playerDiameter?: number;
  narrowest?: number;
  crossTime?: number;
  reachable?: boolean;
  passable?: boolean;
  drift?: number;
  arena?: FieldGeometry;
  [key: string]: any;
}
