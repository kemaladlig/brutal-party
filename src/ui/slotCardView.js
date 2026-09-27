// Host lobi koltuk kartlarının DOM boyaması: avatar çipi, isim/hazır rozeti,
// bot düğmesi, hazır sayacı ve renk çakışması uyarısı.
//
// Durumun tek kaynağı `core/slotManager.js`'deki `hostPlayerSlots` dizisidir;
// burada yalnız boyama vardır (state iki yerde tutulmaz). Kart DOM'u yoksa
// (LOCAL/oyun içi kabuk) `hasSlotCard` false döner ve çağıran hiçbir şeye
// dokunmaz — eski `updateHostSlot` erken dönüşünün karşılığı.

import { drawBrutalAvatar } from './characterRenderer.js';
import { getBotPersona } from '../core/customizationManager.js';
import { t } from '../i18n.js';

const slotElOf = (i) => document.getElementById(`slot-p${i + 1}`);

/** Koltuk kartı DOM'da mı? (Yoksa çağıran durumu da boyamayı da atlar.) */
export function hasSlotCard(slotIndex) {
  return !!slotElOf(slotIndex);
}

/**
 * Avatar çipini çiz. `entry` bilerek ÖNCEKİ koltuk kaydıdır: kart metni yeni
 * kayıttan gelirken çip bir sonraki boyamada yeni avatarı alır (mevcut
 * davranış; state yazımı çizimden sonra gelir).
 */
export function paintSlotAvatar(slotIndex, { isConnected, kind, entry }) {
  const slotCanvas = /** @type {HTMLCanvasElement} */ (document.getElementById(`slot-canvas-p${slotIndex + 1}`));
  if (!slotCanvas) return;

  const ctx = slotCanvas.getContext('2d');
  ctx.clearRect(0, 0, slotCanvas.width, slotCanvas.height);

  if (!isConnected) {
    // Boş yuvarlak kesikli sınır
    ctx.strokeStyle = '#C8C3BA';
    ctx.lineWidth = 4;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(34, 34, 24, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }

  if (kind === 'bot' || kind === 'bot_god') {
    const persona = getBotPersona(slotIndex, kind === 'bot_god');
    drawBrutalAvatar(ctx, 34, 34, 26, {
      slotIndex,
      color: persona.color,
      expression: persona.expression,
      showPointer: false,
      borderWidth: 4,
      shadowOffset: 3,
    });
    return;
  }

  drawBrutalAvatar(ctx, 34, 34, 26, {
    slotIndex,
    avatar: entry?.avatar || undefined,
    color: entry?.displayColor || entry?.avatar?.color || undefined,
    showPips: false,
    showPointer: false,
    borderWidth: 4,
    shadowOffset: 3,
  });
}

/**
 * Kartın sınıflarını, ismini, hazır rozetini ve bot düğmesini boya.
 * `entry` null ise koltuk boştur.
 */
export function paintSlotCard(slotIndex, entry, { botsEnabled = false } = {}) {
  const slotEl = slotElOf(slotIndex);
  if (!slotEl) return;

  const nameEl = slotEl.querySelector('.slot-name');
  const readyTag = document.getElementById(`ready-tag-p${slotIndex + 1}`);
  // Eylem düğmeleri koltuk sheet'i açıkken çipten sheet'e taşınır; sorgu
  // belge genelinde data-slot ile yapılır (taşıma sırasında da bulunur).
  const botBtn = document.querySelector(`.slot-bot-btn[data-slot="${slotIndex}"]`);

  if (!entry) {
    slotEl.classList.remove('connected', 'ready', 'is-bot', 'is-bot-god');
    if (nameEl) nameEl.textContent = t('pause.empty');
    if (readyTag) {
      // Boş koltukta durum rozeti ismi tekrarlar ("BOŞ / BOŞ") — çipte yalnız
      // isim kalsa yeter; rozet boşta boş kalır.
      readyTag.textContent = '';
      readyTag.classList.remove('ready');
    }
    if (botBtn) {
      if (botsEnabled) {
        const label = botBtn.querySelector('.slot-bot-label');
        if (label) label.textContent = t('host.addBot');
        else botBtn.textContent = t('host.addBot');
        botBtn.classList.remove('hidden');
      } else {
        botBtn.classList.add('hidden');
      }
    }
    return;
  }

  const isBotNormal = entry.kind === 'bot';
  const isBotGod = entry.kind === 'bot_god';
  const isAnyBot = isBotNormal || isBotGod;
  const persona = isAnyBot ? getBotPersona(slotIndex, isBotGod) : null;

  slotEl.classList.add('connected');
  slotEl.classList.toggle('is-bot', isAnyBot);
  slotEl.classList.toggle('is-bot-god', isBotGod);
  slotEl.classList.toggle('ready', entry.isReady && !isAnyBot);

  if (nameEl) nameEl.textContent = isAnyBot ? (entry.name || persona.name) : entry.name;
  if (readyTag) {
    if (isBotGod) {
      readyTag.textContent = persona.shortName || t('lobby.god');
      readyTag.classList.remove('ready');
    } else if (isBotNormal) {
      readyTag.textContent = persona.shortName || t('lobby.bot');
      readyTag.classList.remove('ready');
    } else {
      readyTag.textContent = entry.isReady ? t('lobby.ready') : t('lobby.wait');
      readyTag.classList.toggle('ready', entry.isReady);
    }
  }
  // Açık buton (sadece ayar açıksa): bot kartında ✕ (kaldır), boş koltukta +BOT.
  // Kapalıyken normal akışta sadece oyuncu eklenir/çıkarılır.
  if (botBtn) {
    if (botsEnabled && isAnyBot) {
      const label = botBtn.querySelector('.slot-bot-label');
      if (label) label.textContent = t('host.removeBot');
      else botBtn.textContent = '✕';
      botBtn.classList.remove('hidden');
    } else {
      botBtn.classList.add('hidden');
    }
  }
}

/**
 * Lobi hazır sayacı. Botlar sayıma dahil değildir (hazır vermezler, sayacı
 * kilitlemezler).
 */
export function paintReadyCounter(entries) {
  const humans = entries.filter((p) => p !== null && p.kind !== 'bot' && p.kind !== 'bot_god');
  const connectedCount = humans.length;
  const readyCount = humans.filter((p) => p?.isReady).length;
  const counter = document.getElementById('lobby-ready-counter');
  if (!counter) return;

  if (connectedCount === 0) {
    counter.textContent = t('lobby.waiting');
  } else if (readyCount === connectedCount) {
    counter.textContent = t('lobby.readyToStart', readyCount, connectedCount);
  } else {
    counter.textContent = t('lobby.connected', connectedCount, readyCount);
  }
}

/** Aynı display rengine sahip insan koltuklarına ⚠️ rozeti. */
export function paintColorClashBadges(clashIndices) {
  const clash = new Set(clashIndices);
  for (let i = 0; i < 4; i++) {
    const slotEl = slotElOf(i);
    if (!slotEl) continue;
    const isClash = clash.has(i);
    slotEl.classList.toggle('color-clash', isClash);
    let warn = slotEl.querySelector('.slot-clash-tag');
    if (isClash && !warn) {
      warn = document.createElement('span');
      warn.className = 'slot-clash-tag';
      slotEl.appendChild(warn);
    }
    if (warn) {
      warn.textContent = isClash ? t('lobby.clash') : '';
      warn.classList.toggle('hidden', !isClash);
    }
  }
}

/** Slot snapshot'ı değişti: host lobi düzenleyicisi anında tazelensin. */
export function dispatchHostSlotsChanged() {
  try {
    window.dispatchEvent(new CustomEvent('brutal_host_slots_changed'));
  } catch {}
}

/** Renk çakışması değişti (kumanda tarafı bu olayı dinler). */
export function dispatchColorClash(clashIndices) {
  try {
    window.dispatchEvent(new CustomEvent('brutal_color_clash', {
      detail: { clash: [...clashIndices] },
    }));
  } catch {}
}
