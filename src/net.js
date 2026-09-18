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

/** Aktif platforma göre kullanılacak network singleton'ını döndürür. */
export function getActiveNetwork(platformMode) {
  return isOnlineMode(platformMode) ? supabaseRelay : partyNetwork;
}

/** Kullanılmayan tarafı sessizce kapatır (mod değişiminde hayalet bağlantı kalmasın). */
export function disconnectInactiveNetwork(platformMode) {
  const inactive = isOnlineMode(platformMode) ? partyNetwork : supabaseRelay;
  try {
    inactive.disconnect();
  } catch {
    // best-effort
  }
}

export { partyNetwork, supabaseRelay };

const PLAYER_NAME_KEY = 'brutal-party-player-name';

/** Son kullanılan oyuncu ismini döndürür (yoksa ''). */
export function getStoredPlayerName() {
  try {
    return localStorage.getItem(PLAYER_NAME_KEY) || '';
  } catch {
    return '';
  }
}

/** Oyuncu ismini hatırlar. Varsayılan 'OYUNCU' placeholder'ı saklanmaz. */
export function storePlayerName(name) {
  const clean = (name || '').trim().slice(0, 12);
  if (!clean || clean === 'OYUNCU') return;
  try {
    localStorage.setItem(PLAYER_NAME_KEY, clean);
  } catch {
    // private mode vb. — sessiz geç
  }
}
