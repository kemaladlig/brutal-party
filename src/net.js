// Mod bazlı network seçici: TV_CONSOLE → lokal WebSocket, ONLINE → Supabase Broadcast.
// LOCAL modda network kullanılmaz (tek cihaz).

import { partyNetwork } from './network.js';
import { supabaseRelay } from './supabaseRelay.js';

export const PUBLIC_URL = (import.meta.env.VITE_PUBLIC_URL || 'https://mini-game-4p.vercel.app').replace(/\/$/, '');

/** Build'e Supabase bilgileri gömülmüş mü? (Vercel'de env eksikse false) */
export const HAS_SUPABASE_CONFIG = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

export function isOnlineMode(mode) {
  return mode === 'ONLINE';
}

/**
 * Public domain'de miyiz? (Vercel, PWA veya localhost/LAN harici herhangi bir sunucu)
 */
export function isPublicOrigin() {
  try {
    const host = window.location.hostname;
    if (!host || host === 'localhost' || host === '127.0.0.1') return false;
    if (/^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

/** Aktif platforma göre kullanılacak network singleton'ını döndürür. */
export function getActiveNetwork(platformMode) {
  // Public sitede (Vercel, PWA vb.) yerel Node.js WS sunucusu bulunmaz;
  // bu yüzden hem TV_CONSOLE hem ONLINE modu Supabase Broadcast üzerinden çalışır.
  if (isPublicOrigin()) {
    return supabaseRelay;
  }
  return isOnlineMode(platformMode) ? supabaseRelay : partyNetwork;
}

/** Kullanılmayan tarafı sessizce kapatır (mod değişiminde hayalet bağlantı kalmasın). */
export function disconnectInactiveNetwork(platformMode) {
  const active = getActiveNetwork(platformMode);
  const inactive = active === supabaseRelay ? partyNetwork : supabaseRelay;
  try {
    inactive.disconnect();
  } catch {
    // best-effort
  }
}

export { partyNetwork, supabaseRelay };

const PLAYER_NAME_KEY = 'brutal-party-player-name';

/** Son kullanılan oyuncu ismini döndürür (her zaman BÜYÜK HARF). */
export function getStoredPlayerName() {
  try {
    return (localStorage.getItem(PLAYER_NAME_KEY) || '').toUpperCase().trim();
  } catch {
    return '';
  }
}

/** Oyuncu ismini hatırlar. Her zaman BÜYÜK HARFLE saklanır. */
export function storePlayerName(name) {
  const clean = (name || '').trim().toUpperCase().slice(0, 12);
  if (!clean || clean === 'OYUNCU') return;
  try {
    localStorage.setItem(PLAYER_NAME_KEY, clean);
  } catch {
    // private mode vb. — sessiz geç
  }
}
