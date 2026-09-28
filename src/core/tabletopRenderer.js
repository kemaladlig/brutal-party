// TabletopRenderer: masa-ortası (tabletop) kontrol, lobi ve HUD çiziminin
// tek sahibi. BaseGame'ten mekanik taşımadır (Faz 2.1) — çizim birebir aynıdır;
// motor sözleşmesi BaseGame delegasyonuyla korunur (this.renderControls /
// this.renderHUD / renderStandard*). Ready-pulse gibi sunum-only durum motor
// instance'ı yerine burada yaşar.
//
// game referansı üzerinden okuma: motor alanları (arena, uiButtons, matchOverCard)
// ve motor metotları (getTabletopControlCorners, getAimVector, cycleSlotType)
// motorun kendisinden gelir, yeni motor davranış değiştirmeden geçerlidir.

import { getStandardSeatRects, renderLobbySeatCard, renderLobbyStartButton, getSeatColorDotRect, renderControlGuide } from '../controlGuide.js';
import { getLocalSeatColors } from './customizationManager.js';
import { resolveSlotName } from './slotManager.js';
import { keyboardVectorFrom, getKeyLabel, STEER_KEY_HINTS } from './inputMaps.js';
import { UI_COLORS, getDisplayProfile, shouldShowVirtualControls, isTouchDevice } from '../ui/tokens.js';
import { renderAdaptiveScoreboard, renderRoundBanner, renderMatchOver, cleanWinnerName } from '../ui/hud.js';
import { roundGapSeconds } from './roundLifecycle.js';
import { t } from '../i18n.js';
import { drawTabletopIcon } from './tabletopIcons.js';

function pathRoundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
  }
}

export function createTabletopRenderer(game) {
  // Cooldown → hazır geçiş anları: sunum durumu, motor alanı değil.
  const cooldownTracker = {};
  const readyPulseTracker = {};

  function getControlAlpha(value, active = false, near = false) {
    if (!isTouchDevice()) return value;
    if (near) return Math.min(value, 0.12);
    return Math.min(value, active ? 0.4 : 0.22);
  }

  function renderControls(ctx, { players = game.getEntitiesList(), extraEntities = [] } = {}) {
    if (game.state !== 'PLAYING' && game.state !== 'ROUND_PAUSE') return;
    if (!shouldShowVirtualControls({ mode: game.localControlMode })) {
      return;
    }

    const profile = getDisplayProfile(game.arena);
    const baseR = Math.round(44 * profile.baseUnit);
    const knobR = Math.round(19 * profile.baseUnit);
    const corners = game.getTabletopControlCorners();
    const schema = game.getTabletopSchema();

    for (let i = 0; i < 4; i++) {
      if (game.localControlSlot !== null && i !== game.localControlSlot) continue;
      const p = players?.[i];
      if (!p || !p.isJoined || p.isAlive === false || p.slotType !== 'human') {
        continue;
      }
      const corner = corners[i];
      const playerColor = p.color || UI_COLORS.primary || UI_COLORS.crownRed;

      // 1. DİREKSİYON (SOL / SAĞ) BUTONLARI ÇİZİMİ
      if (schema.steer && corner.steerButtons) {
        const isNear = game.checkEntityProximity(corner.box.cx, corner.box.cy, corner.box.w * 0.7, extraEntities);

        // A. OYUNCU İSİM VE KLAVYE ÇİPİ (Üst Bilgi Rozeti)
        const chipText = `${p.name || resolveSlotName(i)} [${STEER_KEY_HINTS[i]}]`;
        ctx.save();
        ctx.font = '900 11px "JetBrains Mono", monospace';
        const textMetrics = ctx.measureText(chipText);
        const chipW = Math.max(80, textMetrics.width + 20);
        const chipH = 18;
        const isTop = corner.rotation !== 0;
        const chipCx = corner.box.cx;
        const chipCy = isTop ? (corner.box.y + corner.box.h + chipH / 2 + 5) : (corner.box.y - chipH / 2 - 5);

        ctx.translate(chipCx, chipCy);
        if (corner.rotation) ctx.rotate(corner.rotation);
        ctx.globalAlpha = getControlAlpha(isNear ? 0.20 : 0.85, false, isNear);

        // Çip gölgesi ve gövdesi
        const chipR = chipH / 2;
        ctx.fillStyle = 'rgba(20, 16, 31, 0.18)';
        pathRoundRect(ctx, -chipW / 2, -chipH / 2 + 2, chipW, chipH, chipR);
        ctx.fill();
        ctx.fillStyle = UI_COLORS.card || UI_COLORS.crownPaperLight;
        pathRoundRect(ctx, -chipW / 2, -chipH / 2, chipW, chipH, chipR);
        ctx.fill();
        ctx.strokeStyle = UI_COLORS.faint;
        ctx.lineWidth = 1.5;
        pathRoundRect(ctx, -chipW / 2, -chipH / 2, chipW, chipH, chipR);
        ctx.stroke();

        // Slot renk noktası
        ctx.fillStyle = playerColor;
        ctx.beginPath();
        ctx.arc(-chipW / 2 + 8, 0, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = UI_COLORS.inkDark;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Çip metni
        ctx.fillStyle = UI_COLORS.inkDark;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(chipText, -chipW / 2 + 15, 0.5);
        ctx.restore();

        // B. DİREKSİYON BUTONLARI (SOL & SAĞ)
        for (const sBtn of corner.steerButtons) {
          const isPressed = game.tabletopSteerState[i] === sBtn.dir;
          const kb = keyboardVectorFrom(game.keys, i);
          const kbActive = (sBtn.dir < 0 && kb.x < 0) || (sBtn.dir > 0 && kb.x > 0);
          const active = isPressed || kbActive;

          ctx.save();
          ctx.globalAlpha = getControlAlpha(isNear ? 0.20 : (active ? 0.98 : 0.75), active, isNear);
          ctx.translate(sBtn.cx, sBtn.cy);
          if (sBtn.rotation) ctx.rotate(sBtn.rotation);

          const halfW = sBtn.w / 2;
          const halfH = sBtn.h / 2;
          const sR = Math.min(14, sBtn.h * 0.28);
          const shadow = active ? 1 : 3;
          const offset = active ? 2 : 0;

          // Tactile Soft Shadow
          ctx.fillStyle = 'rgba(20, 16, 31, 0.28)';
          pathRoundRect(ctx, -halfW, -halfH + shadow, sBtn.w, sBtn.h, sR);
          ctx.fill();

          // Buton Gövdesi
          ctx.fillStyle = active ? `${playerColor}33` : UI_COLORS.crownPaperLight;
          pathRoundRect(ctx, -halfW + offset, -halfH + offset, sBtn.w, sBtn.h, sR);
          ctx.fill();

          // Kenarlık
          ctx.strokeStyle = active ? playerColor : UI_COLORS.line;
          ctx.lineWidth = active ? 2.5 : 2;
          pathRoundRect(ctx, -halfW + offset, -halfH + offset, sBtn.w, sBtn.h, sR);
          ctx.stroke();

          // Vektör Direksiyon İkonu (◀ / ▶)
          const steerIconColor = active ? playerColor : UI_COLORS.inkDark;
          drawTabletopIcon(ctx, sBtn.label || sBtn.id, offset, offset + 1, 24, {
            color: steerIconColor,
            accentColor: playerColor,
          });

          // Klavye İpucu Rozeti ([A], [D] vb.)
          if (sBtn.keyHint) {
            ctx.fillStyle = 'rgba(20, 20, 22, 0.85)';
            const badgeW = Math.max(16, sBtn.keyHint.length * 6 + 6);
            ctx.fillRect(-halfW + offset + 2, -halfH + offset + 2, badgeW, 10);
            ctx.font = '900 7.5px monospace';
            ctx.fillStyle = UI_COLORS.white;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(sBtn.keyHint, -halfW + offset + 2 + badgeW / 2, -halfH + offset + 7);
          }

          ctx.restore();
        }
      } else if (schema.joystick !== false) {
        // 2. STANDART JOYSTICK ÇİZİMİ
        const joy = game.joysticks[i];
        if (joy.active) {
          const isNear = game.checkEntityProximity(joy.currX, joy.currY, baseR * 2.2, extraEntities) ||
                         game.checkEntityProximity(joy.originX, joy.originY, baseR * 2.2, extraEntities);

          ctx.save();
          ctx.globalAlpha = getControlAlpha(isNear ? 0.20 : 0.95, true, isNear);

          // Dış kontrast halka
          ctx.strokeStyle = UI_COLORS.outlineContrast || 'rgba(250, 247, 242, 0.9)';
          ctx.lineWidth = Math.max(3, Math.round(4.5 * profile.baseUnit));
          ctx.beginPath();
          ctx.arc(joy.originX, joy.originY, baseR, 0, Math.PI * 2);
          ctx.stroke();

          ctx.strokeStyle = UI_COLORS.ink || UI_COLORS.inkDark;
          ctx.lineWidth = Math.max(2, Math.round(2.5 * profile.baseUnit));
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(joy.originX, joy.originY, baseR, 0, Math.PI * 2);
          ctx.stroke();

          // Topuz (Knob)
          ctx.setLineDash([]);
          ctx.fillStyle = playerColor;
          ctx.beginPath();
          ctx.arc(joy.currX, joy.currY, knobR, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = UI_COLORS.ink || UI_COLORS.inkDark;
          ctx.lineWidth = Math.max(2, Math.round(2.5 * profile.baseUnit));
          ctx.stroke();
          ctx.restore();
        } else {
          // Dinlenme pedi (Masa-ortası ekran köşesi rehberi)
          const isNear = game.checkEntityProximity(corner.x, corner.y, baseR * 2.2, extraEntities);

          ctx.save();
          ctx.translate(corner.x, corner.y);
          if (corner.rotation) ctx.rotate(corner.rotation);
          ctx.globalAlpha = getControlAlpha(isNear ? 0.15 : 0.40, false, isNear);

          ctx.strokeStyle = playerColor;
          ctx.lineWidth = Math.max(2, Math.round(2.5 * profile.baseUnit));
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(0, 0, baseR, 0, Math.PI * 2);
          ctx.stroke();

          ctx.fillStyle = playerColor;
          ctx.font = '900 13px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`P${i + 1}`, 0, 0);
          ctx.restore();
        }
      }

      if (schema.aim && corner.aimBox) {
        const aim = game.getAimVector(i);
        const aimR = corner.aimBox.r || corner.aimBox.w / 2;
        const isAimNear = game.checkEntityProximity(corner.aimBox.cx, corner.aimBox.cy, aimR * 2.2, extraEntities);
        ctx.save();
        ctx.globalAlpha = getControlAlpha(isAimNear ? 0.15 : (aim.force > 0.05 ? 0.95 : 0.42), aim.force > 0.05, isAimNear);
        ctx.strokeStyle = playerColor;
        ctx.lineWidth = Math.max(2, Math.round(2.5 * profile.baseUnit));
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(corner.aimBox.cx, corner.aimBox.cy, aimR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        const knobDistance = aimR * 0.58 * aim.force;
        ctx.fillStyle = playerColor;
        ctx.beginPath();
        ctx.arc(
          corner.aimBox.cx + Math.cos(aim.angle || 0) * knobDistance,
          corner.aimBox.cy + Math.sin(aim.angle || 0) * knobDistance,
          Math.max(8, knobR * 0.72),
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.strokeStyle = UI_COLORS.ink || UI_COLORS.inkDark;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }

      // 2. STANDART AKSİYON BUTONLARI ÇİZİMİ
      if (corner.actionButtons && corner.actionButtons.length > 0) {
        for (const btn of corner.actionButtons) {
          const act = btn.schema;
          const isPressed = !!game.tabletopActionState[i]?.[btn.id];
          const isNear = game.checkEntityProximity(btn.cx, btn.cy, btn.w * 1.2, extraEntities);

          // Cooldown kontrolü (maxCooldown statik, cooldownMaxField varlık başına okunur)
          let cooldown = 0;
          let maxCooldown = act.maxCooldown || 1.0;
          let isReady = true;
          if (act.cooldownField && typeof p[act.cooldownField] === 'number') {
            cooldown = Math.max(0, p[act.cooldownField]);
            const perEntityMax = act.cooldownMaxField ? p[act.cooldownMaxField] : undefined;
            if (typeof perEntityMax === 'number' && perEntityMax > 0) {
              maxCooldown = perEntityMax;
            }
            isReady = cooldown <= 0;
          }
          // Hazırlık koşulu ayrı alandan okunabilir (ör. tanks şarjör sayacı:
          // dolum sürerken bile fişek varsa buton hazırdır)
          if (act.readyField && typeof p[act.readyField] === 'number') {
            isReady = p[act.readyField] > 0;
          }

          // Charge (yay gerilme vb.) kontrolü
          let chargeRatio = 0;
          if (act.holdToCharge) {
            const cVal = p[act.chargeField || 'charge'];
            const mVal = p[act.maxChargeField || 'maxCharge'] || 1.0;
            if (typeof cVal === 'number') {
              chargeRatio = Math.max(0, Math.min(1, cVal / mVal));
            } else if (p.charging || p.isAiming) {
              chargeRatio = 0.5;
            }
          }

          // Cooldown hazır olma (Ready pulse) takibi
          const pulseKey = `${i}_${btn.id}`;
          const prevCooldown = cooldownTracker[pulseKey] ?? 0;
          if (prevCooldown > 0 && cooldown <= 0 && isReady) {
            readyPulseTracker[pulseKey] = performance.now();
          }
          cooldownTracker[pulseKey] = cooldown;

          ctx.save();
          ctx.globalAlpha = getControlAlpha(isNear ? 0.20 : (isPressed ? 0.95 : 0.70), isPressed, isNear);
          ctx.translate(btn.cx, btn.cy);
          if (btn.rotation) ctx.rotate(btn.rotation);

          const halfW = btn.w / 2;
          const halfH = btn.h / 2;
          const bR = Math.min(14, btn.w * 0.28);
          const shadow = isPressed ? 1 : 3;
          const offset = isPressed ? 2 : 0;

          // Tactile Soft Shadow
          ctx.fillStyle = 'rgba(20, 16, 31, 0.28)';
          pathRoundRect(ctx, -halfW, -halfH + shadow, btn.w, btn.h, bR);
          ctx.fill();

          // Buton Gövdesi
          ctx.fillStyle = isReady ? (isPressed ? UI_COLORS.crownPressed : UI_COLORS.crownPaperLight) : UI_COLORS.crownUnreadyFill;
          pathRoundRect(ctx, -halfW + offset, -halfH + offset, btn.w, btn.h, bR);
          ctx.fill();

          // Cooldown Dolum Maskesi (Aşağıdan yukarıya kararır)
          if (!isReady && maxCooldown > 0) {
            const frac = Math.max(0, Math.min(1, cooldown / maxCooldown));
            ctx.save();
            pathRoundRect(ctx, -halfW + offset, -halfH + offset, btn.w, btn.h, bR);
            ctx.clip();
            ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
            ctx.fillRect(-halfW + offset, halfH + offset - btn.h * frac, btn.w, btn.h * frac);
            ctx.restore();
          }

          // Charge Barı (Sarı altın yay gerilme dolumu)
          if (chargeRatio > 0) {
            ctx.save();
            pathRoundRect(ctx, -halfW + offset, -halfH + offset, btn.w, btn.h, bR);
            ctx.clip();
            ctx.fillStyle = 'rgba(255, 222, 89, 0.55)';
            ctx.fillRect(-halfW + offset, halfH + offset - btn.h * chargeRatio, btn.w, btn.h * chargeRatio);
            ctx.restore();
          }

          // Kenarlık
          ctx.strokeStyle = isReady ? playerColor : UI_COLORS.crownUnreadyBorder;
          ctx.lineWidth = isReady ? 2.5 : 1.5;
          pathRoundRect(ctx, -halfW + offset, -halfH + offset, btn.w, btn.h, bR);
          ctx.stroke();

          // Yetenek Doldu "Ready!" Vurgusu (Tactile shockwave ring)
          const pulseStart = readyPulseTracker[pulseKey] || 0;
          const pulseAge = performance.now() - pulseStart;
          if (pulseAge < 400) {
            const pNorm = pulseAge / 400;
            const expand = Math.round(pNorm * 9);
            ctx.save();
            ctx.strokeStyle = playerColor;
            ctx.lineWidth = Math.max(1.5, 3.5 * (1 - pNorm));
            ctx.globalAlpha = (1 - pNorm) * 0.9;
            pathRoundRect(ctx, -halfW + offset - expand, -halfH + offset - expand, btn.w + expand * 2, btn.h + expand * 2, bR + expand);
            ctx.stroke();
            ctx.restore();
          }

          // Vektör Arcade İkon Çizimi (Brutalist net geometri, dinamik renk)
          const iconColor = isReady ? (isPressed ? playerColor : UI_COLORS.crownDarkIcon) : 'rgba(250, 247, 242, 0.40)';
          const iconY = cooldown > 0 ? (offset - 4) : (offset + 1);
          const iconKey = act.id === 'action' ? (act.icon || act.id) : (act.id || act.icon);
          drawTabletopIcon(ctx, iconKey, offset, iconY, 24, {
            color: iconColor,
            isReady,
            accentColor: playerColor,
          });

          if (!isReady && cooldown > 0) {
            ctx.font = '900 11px "JetBrains Mono", monospace';
            ctx.fillStyle = UI_COLORS.crownAmber;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${cooldown.toFixed(1)}s`, offset, halfH + offset - 8);
          }

          // Klavye İpucu Rozeti (slot başına doğru tuş; statik keyHint önceliklidir)
          const keyHintKind = act.id === 'smoke' ? 'smoke' : act.id === 'dash' ? 'dash' : 'action';
          const keyHint = act.keyHint || getKeyLabel(keyHintKind, i);
          if (keyHint) {
            ctx.fillStyle = 'rgba(20, 20, 22, 0.85)';
            const badgeW = Math.max(22, keyHint.length * 6 + 6);
            ctx.fillRect(-halfW + offset + 2, -halfH + offset + 2, badgeW, 10);
            ctx.font = '900 7.5px monospace';
            ctx.fillStyle = UI_COLORS.white;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(keyHint, -halfW + offset + 2 + badgeW / 2, -halfH + offset + 7);
          }

          ctx.restore();
        }
      }
    }
  }

  function renderStandardJoysticks(ctx, players = game.players) {
    renderControls(ctx, { players });
  }

  function renderStandardScoreboard(ctx, {
    targetScore = game.targetScore || 3,
    entities = null,
    forceLayout = null,
  } = {}) {
    const playersList = game.getEntitiesList();
    // "Hangi koltuk dolu" kararı TEK kaynaktan: `game.slotTypes`. Varlığın
    // `isJoined` aynası motorun kendi güncellemesine açıktı; ayna baydaysa
    // saha skoru 4 kişiyi gösteriyordu (2 kişi oynarken bile). Boş koltuk
    // `null` olur → o köşede kart çizilmez.
    const seated = playersList.map((p, i) => {
      if (!p) return null;
      const type = game.slotTypes?.[i];
      const joined = type !== undefined
        ? type !== 'empty'
        : (p.isJoined ?? (p.slotType !== 'empty'));
      return joined ? p : null;
    });
    const activeEntities = entities || seated.filter((p) => p && p.isAlive !== false);
    renderAdaptiveScoreboard(ctx, {
      arena: game.arena,
      players: seated,
      scores: game.scores || game.setScores || [0, 0, 0, 0],
      targetScore,
      entities: activeEntities,
      controlMode: game.localControlMode,
      state: game.state,
      forceLayout,
    });
  }

  function renderStandardRoundBanner(ctx, { title = null, titleColor = null, sub = '' } = {}) {
    const cleanWinner = game.roundWinner ? cleanWinnerName(game.roundWinner.name || '') : '';
    const defTitle = cleanWinner ? `${cleanWinner} KAZANDI!` : (t('game.draw') || 'BERABERE!');
    const defColor = game.roundWinner?.color || UI_COLORS.ink || UI_COLORS.inkDark;
    renderRoundBanner(ctx, {
      arena: game.arena,
      title: title || defTitle,
      titleColor: titleColor || defColor,
      sub,
      // Boşluğun kalan saniyesi: bant "kim kazandı"yı, sayı "ne zaman
      // dönüyoruz"u söyler. Okuma `roundLifecycle`'tadır — motorlar sayacı
      // farklı adta tutuyor ve buraya oyun-özel dal yazılmaz.
      countdown: roundGapSeconds(this),
    });
  }

  function renderStandardMatchOver(ctx, { headline = null, rows = null, onRestart = () => game.startNewMatch() } = {}) {
    const playersList = game.getEntitiesList();
    const cleanWinner = game.matchWinner ? cleanWinnerName(game.matchWinner.name || '') : '';
    const defRows = rows || playersList
      .filter((p) => p && p.isJoined)
      .map((p) => ({
        color: p.color || UI_COLORS.players[p.index] || UI_COLORS.resultInk,
        name: p.name || `P${p.index + 1}`,
        score: Number(game.scores?.[p.index] ?? game.setScores?.[p.index] ?? 0),
        value: `${game.scores?.[p.index] ?? game.setScores?.[p.index] ?? 0}★`,
      }));

    // Kart kutusu saklanır: "kartın dışına dokun = yeniden başlat" kısayolu
    // iki eylemli kartta LOBİ dokunuşunu çalmasın diye (`matchOverRestartTap`).
    game.matchOverCard = renderMatchOver(ctx, {
      arena: game.arena,
      viewport: game.viewport,
      uiButtons: game.uiButtons,
      headline: headline || t('canvas.champ') || 'ŞAMPİYON',
      winnerName: cleanWinner,
      // Kazanan rengi koyu panelde okunur olmalı: berabere/düşük renk gelirse
      // panelin altın vurgusuna düşer (eski `UI_COLORS.ink` koyu zeminde
      // görünmez metin üretiyordu).
      winnerColor: game.matchWinner?.color || UI_COLORS.resultGold,
      winnerEntity: game.matchWinner || null,
      rows: defRows,
      onRestart,
      onLobby: () => game.requestReturnToLobby(),
    });
  }

  function renderStandardLobby(ctx, {
    arena = game.arena,
    dockRect = null,
    colors = [],
    playerNames = [],
    onStart = () => game.startNewMatch(),
    accent = UI_COLORS.crownRed,
    customControls = null,
    rotateTop = false,
    onSeatChange = null,
  } = {}) {
    const bounds = dockRect || ((game.viewport && game.viewport.width > 0) ? game.viewport : arena);
    const corners = getStandardSeatRects(arena, undefined, bounds);
    const localMode = !game.hideLobbyStartButton;
    const localColors = localMode ? getLocalSeatColors() : null;

    for (let i = 0; i < 4; i++) {
      const pos = corners[i];
      const slotType = game.slotTypes[i];
      const p = game.players?.[i] || game.tanks?.[i] || game.paddles?.[i] || game.curves?.[i] || game.snakes?.[i];
      const name = p ? (p.name || '') : (playerNames[i] || '');
      const color = colors[i] || UI_COLORS.crownRed;
      const isTop = i === 1 || i === 2;

      renderLobbySeatCard(ctx, {
        x: pos.x,
        y: pos.y,
        w: pos.w,
        h: pos.h,
        slotIndex: i,
        slotType: slotType,
        playerName: name,
        playerColor: color,
        rotation: rotateTop && isTop ? Math.PI : 0,
        seatColor: localMode ? (localColors[i] || color) : null,
        showColorDot: localMode,
      });

      // Nokta önce: tap dispatch ilk eşleşmede durur, nokta kartın içindedir.
      if (localMode) {
        const dot = getSeatColorDotRect(pos);
        game.uiButtons.push({
          x: dot.x,
          y: dot.y,
          w: dot.w,
          h: dot.h,
          onClick: () => game.cycleLocalSeat(i),
        });
      }

      game.uiButtons.push({
        x: pos.x,
        y: pos.y,
        w: pos.w,
        h: pos.h,
        onClick: () => {
          game.cycleSlotType(i);
          if (typeof onSeatChange === 'function') onSeatChange(i);
        },
      });
    }

    if (typeof customControls === 'function') {
      customControls(ctx);
    }

    const joinedCount = game.getActivePlayerCount();
    renderLobbyStartButton(ctx, {
      arena,
      uiButtons: game.uiButtons,
      joinedCount,
      accent,
      minJoined: game.minPlayersToStart || 2,
      onStart,
      centerYOffset: customControls ? 18 : 0,
      hidden: !!game.hideLobbyStartButton,
    });
  }

  function renderHUD(ctx, options = {}) {
    game.uiButtons = [];

    const {
      guideTitle = '',
      guideEntries = null,
      colors = game.playerColors || [],
      playerNames = [],
      accent = UI_COLORS.crownRed,
      onStart = () => game.startNewMatch(),
      rotateTop = true,
      onSeatChange = null,
      customControls = null,
      customHud = null,
      showScoreboard = true,
      targetScore = game.targetScore || 3,
      scoreboardEntities = null,
      roundBannerTitle = null,
      roundBannerColor = null,
      roundBannerSub = '',
      matchOverHeadline = null,
      matchOverRows = null,
      onRestart = () => game.startNewMatch(),
      dockToViewport = true,
    } = options;

    const bounds = (dockToViewport && game.viewport && game.viewport.width > 0) ? game.viewport : game.arena;

    if (game.state === 'LOBBY') {
      if (guideTitle && guideEntries) {
        renderControlGuide(ctx, game.arena, guideTitle, guideEntries);
      }
      if (typeof options.customLobby === 'function') {
        options.customLobby(ctx);
      } else {
        renderStandardLobby(ctx, {
          arena: game.arena,
          dockRect: bounds,
          colors,
          playerNames,
          accent,
          onStart,
          rotateTop,
          onSeatChange,
          customControls,
        });
      }
    } else if (game.state === 'ROUND_OVER') {
      if (showScoreboard) {
        renderStandardScoreboard(ctx, { targetScore, entities: scoreboardEntities });
      }
      renderStandardRoundBanner(ctx, {
        title: roundBannerTitle,
        titleColor: roundBannerColor,
        sub: roundBannerSub,
      });
    } else if (game.state === 'MATCH_OVER') {
      // Skoru artık kartın kendisi taşıyor: aynı ekranda hem köşe/top-bar
      // skorboardu hem kartın sıralama satırları = aynı bilgi iki yerde.
      renderStandardMatchOver(ctx, {
        headline: matchOverHeadline,
        rows: matchOverRows,
        onRestart,
      });
    } else if (game.state === 'PLAYING' || game.state === 'ROUND_PAUSE') {
      if (showScoreboard) {
        renderStandardScoreboard(ctx, { targetScore, entities: scoreboardEntities });
      }
    }

    if (typeof customHud === 'function') {
      customHud(ctx);
    }
  }

  return {
    renderControls,
    renderStandardJoysticks,
    renderStandardScoreboard,
    renderStandardRoundBanner,
    renderStandardMatchOver,
    renderStandardLobby,
    renderHUD,
  };
}
