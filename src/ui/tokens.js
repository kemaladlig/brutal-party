// Tasarım Token'ları — TV canvas + DOM + kumanda için tek renk/tipografi/ölçü sözlüğü.
// Yeni HUD öğesi yazan önce buraya bakar; hardcoded renk/font/ölçü yasaktır.
// Değerler mevcut oyundan alındı (görsel değişiklik yok, sadece merkezileşme).

export const UI_COLORS = {
  ink: '#1A1A1A',
  paper: '#F4F4F0',
  paperWarm: '#F4F0EA',
  card: '#FAF7F2',
  white: '#FFFFFF',
  muted: '#75726B',
  faint: '#99948A',
  dim: '#8A857B',
  line: '#1C1C1A',
  gold: '#D99B26',
  danger: '#D84727',
  // Oyuncu renkleri (P1 kırmızı, P2 mavi, P3 sarı, P4 yeşil) — TV + kumanda aynı.
  players: ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'],
  // Bot rozetleri
  botFace: '#1F1F1D',
  botEdge: '#E5E0D6',
  botTag: '#FFDE59',
  botGod: '#FFD700',
  // Durum zeminleri
  disabled: '#E5E0D6',
};

export const UI_FONTS = {
  grotesk: '"Space Grotesk", sans-serif',
  mono: '"JetBrains Mono", monospace',
};

// Tipografi kademeleri: rol → [ağırlık, px, aile]
export const UI_TEXT = {
  label: [800, 11, 'grotesk'], // kart altı yazı, rozet altı
  nameTag: [900, 11, 'grotesk'], // oyuncu isim rozeti
  tag: [900, 12, 'grotesk'], // bot rozeti
  monoLabel: [900, 13, 'mono'], // kılavuz başlığı
  monoBody: [800, 12, 'mono'], // alt bilgi / skor satırı
  section: [900, 14, 'grotesk'], // bölüm başlığı
  seatNum: [900, 28, 'grotesk'], // koltuk numarası (dolu)
  seatEmpty: [900, 24, 'grotesk'], // koltuk numarası (boş)
  pill: [900, 15, 'mono'], // üst hap (süre/skor)
  body: [800, 13, 'grotesk'], // bekleme yazısı
  button: [900, 20, 'grotesk'], // BAŞLAT / YENİDEN OYNA (büyük)
  buttonSmall: [800, 15, 'grotesk'], // final butonu
  title: [900, 24, 'grotesk'], // final kazananı
  display: [900, 32, 'grotesk'], // lobi başlığı
  hero: [900, 52, 'grotesk'], // sinyal / devasa durum
};

// `900 15px "JetBrains Mono", monospace` üretir.
export function uiFont(role) {
  const [weight, px, family] = UI_TEXT[role] || UI_TEXT.body;
  return `${weight} ${px}px ${UI_FONTS[family]}`;
}

// Standart ölçüler (CSS pikseli)
export const UI_SIZES = {
  seatMin: 96,
  seatMax: 148,
  seatRatio: 0.22,
  seatInset: 20,
  startW: 220,
  startH: 60,
  finalBtnW: 190,
  finalBtnH: 46,
  pillH: 34,
  bannerW: 260,
  bannerH: 64,
};
