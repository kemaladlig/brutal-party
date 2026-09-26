// src/core/qualityGate.js
// Central specification for device independence quality invariants and evaluation rules.
// Single source of truth for the 7 Gates (I1-I7) and 4 Reports (I8-I11).

/**
 * Ayar çıpası (Tuning anchor): tablet yatay 16:10.
 * Hem kıtlık (küçük telefon) hem bolluk (TV/desktop) hatalarının aynı anda
 * görülebildiği tek referans viewport.
 */
export const TUNING_ANCHOR = Object.freeze({
  width: 1180,
  height: 820,
  aspect: 1180 / 820,
  label: 'tablet yatay 16:10 (1180×820)',
});

/**
 * Otorite modeli: sahayı belirleyen cihaz moda göre değişir.
 * TV_CONSOLE -> TV (tüm telefonlar kumanda)
 * ONLINE     -> Host telefon (diğerleri snapshot ile aynı sahayı kurar)
 * LOCAL      -> Oynanan tek cihaz
 */
export const AUTHORITY_MODES = Object.freeze({
  TV_CONSOLE: { authority: 'TV (1920×1080)', description: 'TV ekranı otoriter, kumandalar input' },
  ONLINE: { authority: 'Host telefon (852×393)', description: 'Host telefon sahayı belirler, worldPacket ile yayınlar' },
  LOCAL: { authority: 'O cihaz', description: 'Tek cihaz yerel oyun' },
});

export const GATE_THRESHOLDS = Object.freeze({
  scaleDriftMax: 0.01,         // I1: Gövde/saha oranı cihazlar arası sapma <= %1
  speedDriftMax: 0.01,         // I2: Saha geçiş süresi cihazlar arası sapma <= %1
  minPassability: 1.0,         // I3: Koridor genişliği / oyuncu çapı >= 1.0
  maxFidelityDrift: 0,         // I4: View yarıçap fallback'i ile motor yarıçapı farkı == 0
  maxUnscaledGeometry: 0,      // I5: Geometrik çizim çağrılarında ölçeklenmemiş px literal == 0
  maxUnscaledMotionCues: 0,    // I6: İz ve hareket ipuçlarında ölçeklenmemiş lineWidth == 0
  minPlayerDiameterPx: 12,     // I7: En küçük ekranda (telefon) okunabilir minimum oyuncu çapı (CSS px; CURVE: >= 4.5px)
});

/**
 * Tek bir oyunun ölçüm verisini 7 kapı ve 4 rapor üzerinden değerlendirir.
 *
 * @param {object} input
 * @param {string} input.mode - Oyun modu (örn. 'HORDE', 'ARCHER')
 * @param {object|null} input.desktop - Masaüstü (1920x1080) ölçümü
 * @param {object|null} input.phone - Telefon (852x393) ölçümü
 * @param {object|null} [input.corridor] - Koridor geçilebilirlik ölçümü
 * @param {object|null} [input.viewFidelity] - View yarıçap fallback denetimi
 * @param {number} [input.unscaledGeometryCount] - I5 ölçeklenmemiş geometri px sayısı
 * @param {number} [input.unscaledMotionCuesCount] - I6 ölçeklenmemiş hareket ipucu sayısı
 * @returns {object} Değerlendirme sonucu: { mode, passed, gates, reports, failures }
 */
export function evaluateGame(input) {
  const {
    mode,
    desktop,
    phone,
    corridor,
    viewFidelity = { ok: true, drift: 0, detail: '' },
    unscaledGeometryCount = 0,
    unscaledMotionCuesCount = 0,
  } = input;

  const gates = {};
  const reports = {};
  const failures = [];

  // --- I1: Ölçek bağımsızlığı (Gövde/saha oranı, masaüstü vs telefon) ---
  const deskFootprint = desktop?.playerPct != null ? desktop.playerPct / 100 : null;
  const phoneFootprint = phone?.playerPct != null ? phone.playerPct / 100 : null;
  if (deskFootprint != null && phoneFootprint != null && deskFootprint > 0) {
    const scaleDrift = Math.abs(phoneFootprint - deskFootprint) / deskFootprint;
    const ok = scaleDrift <= GATE_THRESHOLDS.scaleDriftMax;
    gates.I1 = {
      ok,
      value: +(scaleDrift * 100).toFixed(2),
      formatted: `${(scaleDrift * 100).toFixed(2)}%`,
      detail: ok ? 'ok' : `sapma ${(scaleDrift * 100).toFixed(2)}% > %1`,
    };
    if (!ok) failures.push(`I1: Gövde/saha sapması ${(scaleDrift * 100).toFixed(2)}% > %1`);
  } else {
    gates.I1 = {
      ok: false,
      value: null,
      formatted: '—',
      detail: 'gövde runtime alanından okunamadı',
    };
    failures.push('I1: Gövde runtime alanından okunamadı (B7 kusuru)');
  }

  // --- I2: Hız bağımsızlığı (Geçiş süresi, masaüstü vs telefon) ---
  const deskCross = desktop?.crossTime ?? null;
  const phoneCross = phone?.crossTime ?? null;
  if (deskCross != null && phoneCross != null && deskCross > 0) {
    const speedDrift = Math.abs(phoneCross - deskCross) / deskCross;
    const ok = speedDrift <= GATE_THRESHOLDS.speedDriftMax;
    gates.I2 = {
      ok,
      value: +(speedDrift * 100).toFixed(2),
      formatted: `${(speedDrift * 100).toFixed(2)}%`,
      detail: ok ? 'ok' : `hız sapması ${(speedDrift * 100).toFixed(2)}% > %1`,
    };
    if (!ok) failures.push(`I2: Hız sapması ${(speedDrift * 100).toFixed(2)}% > %1`);
  } else {
    gates.I2 = {
      ok: false,
      value: null,
      formatted: '—',
      detail: 'hız runtime alanından okunamadı',
    };
    failures.push('I2: Hız runtime alanından okunamadı (B8 kusuru)');
  }

  // --- I3: Geçilebilirlik (Koridor / oyuncu çapı) ---
  if (corridor != null && corridor.narrowest != null && corridor.playerDiameter != null && corridor.playerDiameter > 0) {
    const ratio = corridor.narrowest / corridor.playerDiameter;
    const ok = ratio >= GATE_THRESHOLDS.minPassability && corridor.passable && corridor.reachable;
    gates.I3 = {
      ok,
      value: +ratio.toFixed(2),
      formatted: `${ratio.toFixed(2)}x`,
      detail: ok ? 'ok' : `dar koridor (${corridor.narrowest}px / ${corridor.playerDiameter}px)`,
    };
    if (!ok) failures.push(`I3: Koridor geçilemez (${corridor.narrowest}px / ${corridor.playerDiameter}px = ${ratio.toFixed(2)}x)`);
  } else {
    // Haritasında koridor/engel olmayan oyunlar (PONG, CURVE, vb.) serbesttir
    gates.I3 = {
      ok: true,
      value: null,
      formatted: 'serbest',
      detail: 'açık arena (engel yok)',
    };
  }

  // --- I4: Sadakat (Fidelity: View yarıçapı = motor yarıçapı) ---
  gates.I4 = {
    ok: viewFidelity.ok,
    value: viewFidelity.drift,
    formatted: viewFidelity.ok ? 'ok' : `${viewFidelity.drift}px`,
    detail: viewFidelity.detail || (viewFidelity.ok ? 'ok' : 'view/motor yarıçap uyumsuzluğu'),
  };
  if (!viewFidelity.ok) {
    failures.push(`I4: View yarıçap fallback uyumsuzluğu (${viewFidelity.detail || 'sapma'})`);
  }

  // --- I5: Ölçeklenmemiş geometri px ---
  const geoOk = unscaledGeometryCount <= GATE_THRESHOLDS.maxUnscaledGeometry;
  gates.I5 = {
    ok: geoOk,
    value: unscaledGeometryCount,
    formatted: geoOk ? 'ok' : `${unscaledGeometryCount} adet`,
    detail: geoOk ? 'ok' : `${unscaledGeometryCount} adet ölçeklenmemiş px çağrısı`,
  };
  if (!geoOk) {
    failures.push(`I5: ${unscaledGeometryCount} adet ölçeklenmemiş geometri px literal`);
  }

  // --- I6: Hareket ipuçları ölçekli mi (lineWidth) ---
  const motionOk = unscaledMotionCuesCount <= GATE_THRESHOLDS.maxUnscaledMotionCues;
  gates.I6 = {
    ok: motionOk,
    value: unscaledMotionCuesCount,
    formatted: motionOk ? 'ok' : `${unscaledMotionCuesCount} adet`,
    detail: motionOk ? 'ok' : `${unscaledMotionCuesCount} adet sabit lineWidth`,
  };
  if (!motionOk) {
    failures.push(`I6: ${unscaledMotionCuesCount} adet ölçeklenmemiş hareket ipucu / lineWidth (B11)`);
  }

  // --- I7: Gövde okunabilirliği (Telefon ekranında oyuncu çapı >= 12 CSS px, CURVE için >= 4.5 CSS px) ---
  const phonePlayerPx = phone?.playerPx != null ? phone.playerPx * 2 : null;
  const isLineGame = mode === 'CURVE';
  const minRequiredDiameter = isLineGame ? 4.5 : GATE_THRESHOLDS.minPlayerDiameterPx;
  if (phonePlayerPx != null) {
    const ok = phonePlayerPx >= minRequiredDiameter;
    const ratio = phonePlayerPx / minRequiredDiameter;
    gates.I7 = {
      ok,
      value: +phonePlayerPx.toFixed(1),
      formatted: `${phonePlayerPx.toFixed(1)}px`,
      detail: ok ? 'ok' : `çap ${phonePlayerPx.toFixed(1)}px < ${minRequiredDiameter}px`,
    };
    if (!ok) failures.push(`I7: Telefonda gövde çapı ${phonePlayerPx.toFixed(1)}px < ${minRequiredDiameter}px eşiği`);
  } else {
    gates.I7 = {
      ok: false,
      value: null,
      formatted: '—',
      detail: 'gövde okunamadı',
    };
    failures.push('I7: Gövde çapı okunamadı');
  }

  // =========================================================================
  // RAPORLAR (Bilgi amaçlıdır — çıkış kodunu ve "passed" durumunu etkilemez)
  // =========================================================================

  // --- I8: Saha en/boy sapması (Tuning çıpası 1180x820'ye göre) ---
  const currentAspect = phone?.aspect ?? (desktop?.aspect ?? null);
  if (currentAspect != null) {
    const aspectDrift = Math.abs(currentAspect - TUNING_ANCHOR.aspect) / TUNING_ANCHOR.aspect;
    reports.I8 = {
      value: +(aspectDrift * 100).toFixed(1),
      formatted: `%${(aspectDrift * 100).toFixed(0)}`,
      detail: `doğal ${currentAspect.toFixed(2)} vs çıpa ${TUNING_ANCHOR.aspect.toFixed(2)}`,
    };
  } else {
    reports.I8 = { value: null, formatted: '—', detail: 'saha verisi yok' };
  }

  // --- I9: Gövde / saha shortSide oranı ---
  const pct = phone?.playerPct ?? (desktop?.playerPct ?? null);
  reports.I9 = {
    value: pct != null ? +pct.toFixed(1) : null,
    formatted: pct != null ? `${pct.toFixed(1)}%` : '—',
    detail: 'gövde çapı / saha kısa kenarı',
  };

  // --- I10: Saha üst kenar boşluğu / kısa kenar oranı (%) ---
  // Telefon yatayda HUD üst payı / saha yüksekliği
  const insets = phone?.insets ? phone.insets.split('/') : null;
  const topInset = insets && insets[0] ? Number(insets[0]) : 0;
  const shortSide = phone?.short ?? 393;
  const chromeRatio = shortSide > 0 ? (topInset / shortSide) * 100 : 0;
  reports.I10 = {
    value: +chromeRatio.toFixed(1),
    formatted: `%${chromeRatio.toFixed(0)}`,
    detail: 'üst kenar boşluğu / kısa kenar',
  };

  // --- I11: Tepki süresi tabanı (En yakın tehdit -> oyuncu mesafesi / bağıl hız) ---
  reports.I11 = {
    value: null,
    formatted: '—',
    detail: 'Adım 2 taban ölçümünde doldurulacak',
  };

  const passed = Object.values(gates).every((g) => g.ok);

  return {
    mode,
    passed,
    gates,
    reports,
    failures,
  };
}
