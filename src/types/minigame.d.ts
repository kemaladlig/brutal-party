// Motor sözleşmesinin tip karşılığı — AGENTS.md §3 "tek kaynak" kuralının
// TypeScript hâli. BaseMiniGame bu alanları kurucuda bildirir, alt sınıf
// motorlar doldurur; tüketiciler (AI, view, host) bu tiplerle okur.
// DEĞER ÜRETMEZ — yalnız bildirim. Yeni motor alanı eklerken önce burada
// sözleşmeye yaz, sonra motorda kullan.

type MiniGameSlotType = 'empty' | 'human' | 'bot_normal' | 'bot_god';

/** keyboardDispatch'in event'lere yazdığı çapraz dinleyici rozeti. */
interface KeyboardEvent {
  __brutalKeyboardBlocked?: boolean;
}

/** WebKit öneki eski Safari için — audio.js'nin tek okuma noktası. */
interface Window {
  webkitAudioContext?: typeof AudioContext;
}

/** computePlayfield() çıktısı; `this.arena` bundan türer. Motorlar kendi
 *  ek alanlarını (bumperRatio, cornerChamfer…) sahaya yazabilir — index imzası. */
interface MiniGameArena {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
  cx?: number;
  cy?: number;
  width?: number;
  height?: number;
  size?: number;
  aspect?: number;
  unit?: number;
  insets?: { left?: number; right?: number; top?: number; bottom?: number };
  profile?: unknown;
  [key: string]: any;
}

/** Karekutusu (dokunmatik köşe/aimBox). */
interface MiniGameRect {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

/** Amaç vektörü — aimInput/keepalive ortak birimi. */
interface MiniGameAimVector {
  dx: number;
  dy: number;
  angle: number;
  force: number;
}

/** Kinetik parity sözleşmesi (Faz 0): görsel sistem ham player okumaz,
 *  bu normalize girdiyi okur. `getKineticState` tek üreticidir. */
interface KineticState {
  dashing: boolean;
  tackling: boolean;
  vx: number | null;
  vy: number | null;
  recoil: number;
}

/**
 * Sahadaki oyuncu/merbil/bottom varlığı. Motorlar kendi ek alanlarını
 * serbestçe genişletir (index imzası); paylaşılan çekirdek alanlar burada.
 */
interface MiniGameEntity {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  // Kinetik lehçeler (normalize edilir, ham okunmaz): dash.
  dashing?: boolean;
  isDashing?: boolean;
  dashTimer?: number;
  dash?: number;
  strikeTimer?: number;
  strike?: boolean;
  jumpTimer?: number;
  // Kinetik lehçeler: tackle + recoil.
  tackling?: boolean;
  isTackling?: boolean;
  recoil?: number;
  steerX?: number;
  steerY?: number;
  speed?: number;
  rotation?: number;
  radius?: number;
  name?: string;
  color?: string;
  slotType?: string;
  slotIndex?: number;
  isJoined?: boolean;
  isAlive?: boolean;
  isBot?: boolean;
  steer?: number;
  score?: number;
  lastTapTime?: number;
  [key: string]: any;
}

/** getTabletopControlCorners() köşe çıktısı (steer ve joystick varyantları). */
interface MiniGameControlCorner {
  index: number;
  rotation: number;
  isSteer?: boolean;
  box?: MiniGameRect;
  steerButtons?: any[];
  actionButtons?: any[];
  aimBox?: MiniGameRect & { r?: number };
  [key: string]: any;
}

/**
 * Motor sözleşmesi (AGENTS.md §3 + LOCAL lobi sözleşmesi). Alt sınıflar
 * motor-özgü alanları index imzasıyla genişletir; çekirdek alanlar burada.
 */
interface MiniGameEngine {
  state: string;
  scores: number[];
  targetScore: number;
  roundWinner: number | null;
  matchWinner: number | null;
  slotTypes: MiniGameSlotType[];
  trauma: number;
  // FX runtime (fxRuntime.FxRuntime) — FX kullanan motorlarda kurucuda oluşur;
  // motorlar olay üretir, partikül/ring/pop/hit-stop bütçeleri fxKit'tedir.
  fx?: {
    particles: any[];
    rings: any[];
    pops: any[];
    hitStop: number;
    flash: number;
    flashPeak: number;
    emit(kind: string, event: any): any;
    tick(rawDt: number): number;
    update(dt: number): void;
    clear(): void;
  };
  keys: Record<string, boolean>;
  uiButtons: any[];
  viewport: { left: number; top: number; right: number; bottom: number; width: number; height: number; cx: number; cy: number };

  // Alt sınıf varlık listeleri — BaseGame sırasıyla bakar (getEntitiesList).
  players?: MiniGameEntity[] | null;
  tanks?: MiniGameEntity[] | null;
  paddles?: MiniGameEntity[] | null;
  curves?: MiniGameEntity[] | null;
  snakes?: MiniGameEntity[] | null;
  playerColors?: string[] | null;
  arena?: MiniGameArena | null;
  controlMode?: string | null;
  hideLobbyStartButton?: boolean;

  localControlMode: string;
  localControlSlot: number | null;
  isLocalInputActive: boolean;
  onLobbySeatTap?: ((index: number) => boolean | void) | null;

  // Yaşam döngüsü — her motor bunları tanımlar.
  update(now: number): void;
  render(): void;
  resize(width: number, height: number): void;
  reset(): void;
  resetMatch(): void;
  startNewMatch(): void;
  startNewRound(): void;
  handleRemoteInput(slotIndex: number, data: any): void;
  getEntitiesList(): MiniGameEntity[];

  // İsteğe bağlı prototip kancaları (temel sınıf contractHook ile çağırır).
  onSlotAim?(slotIndex: number, input: any): void;
  onSlotAimHold?(slotIndex: number, isDown: boolean, event: any): void;
  onSlotSteer?(slotIndex: number, dir: number): void;
  onSlotAction?(slotIndex: number, actionId: string, isDown: boolean): void;

  // Koltuk sözleşmesi — slotManager'ın moda özel dallarının yerini tutar.
  // 16. oyun çekirdeğe dokunmadan gelir (PONG layout tazeliği için ezer).
  applySlotIdentity(index: number, identity: {
    slotType?: string;
    name?: string;
    color?: string;
    rimColor?: string;
    isJoined?: boolean;
  }): void;
  // scope: 'move' (aim korunur) | 'aim' (hareket korunur) | 'all' (ikisi de).
  neutralizeSlotInput(index: number, scope?: 'move' | 'aim' | 'all'): void;
  swapLocalSlots(slotA: number, slotB: number, isHosting: boolean): void;

  [key: string]: any;
}
