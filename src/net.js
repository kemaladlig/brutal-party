// Mod bazlı network seçici: TV_CONSOLE → lokal WebSocket, ONLINE → Supabase Broadcast.
// LOCAL modda network kullanılmaz (tek cihaz).

import { partyNetwork } from './network.js';
import { supabaseRelay } from './supabaseRelay.js';

export const PUBLIC_URL = (
  import.meta.env.VITE_PUBLIC_URL ||
  (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'https://mini-game-4p.vercel.app')
).replace(/\/$/, '');

/** Build'e Supabase bilgileri gömülmüş mü? (Vercel'de env eksikse false) */
export const HAS_SUPABASE_CONFIG = (() => {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return false;
  const u = String(url).trim();
  const k = String(key).trim();
  if (u === '' || k === '' || u === 'undefined' || k === 'undefined') return false;
  if (u.includes('placeholder') || u.includes('YOUR_') || k.includes('placeholder') || k.includes('YOUR_')) return false;
  return u.startsWith('http://') || u.startsWith('https://');
})();

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
  // bu yüzden Supabase tanımlıysa TV_CONSOLE ve ONLINE modu Supabase Broadcast üzerinden çalışır.
  if (isPublicOrigin() && HAS_SUPABASE_CONFIG) {
    return supabaseRelay;
  }
  return isOnlineMode(platformMode) && HAS_SUPABASE_CONFIG ? supabaseRelay : partyNetwork;
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

// ── Tek isim + nick generator ──
// Cihaz sahibinin nick'i: menü kartında bir kere belirlenir, katılım formu ve
// kumanda lobisi hep aynısını kullanır. Boşta "OYUNCU" ile başlanmaz.
const NICK_ADJ = [
  'HIZLI', 'ÇILGIN', 'DELİ', 'SERİ', 'UÇUK', 'KARA', 'SARI', 'KIZIL', 'MAVİ',
  'ZEKİ', 'ÇEVİK', 'SÜPER', 'MEGA', 'ULTRA', 'GİZLİ', 'YAMAN', 'ATEŞ', 'BUZ',
  'KESKİN', 'SİNSİ', 'VAHŞİ', 'ASİ', 'NEON', 'PİXEL', 'ŞANSLI', 'ATİK', 'GÖLGE',
  'DEMİR', 'ALTIN', 'KAYA', 'DEV', 'MİNİK', 'USTA', 'ÇAKAL', 'ALFA', 'CESUR', 'PARLAK'
];

const NICK_NOUN = [
  'TİLKİ', 'KURT', 'KOBRA', 'ASLAN', 'BOĞA', 'KARTAL', 'KAPLAN', 'ŞAHİN', 'ATMACA',
  'PUMA', 'AYI', 'PANDA', 'TAVŞAN', 'PENGUEN', 'ROKET', 'ŞİMŞEK', 'LİDER', 'BOMBA',
  'HAYALET', 'KORSAN', 'NİNJA', 'ROBOT', 'KAPTAN', 'AVCI', 'AJAN', 'KOZMO',
  'RADAR', 'BLOK', 'TURBO', 'SONİK', 'VORTEX', 'SAMURAY', 'UZAYLI', 'ŞERİF'
];

const NICK_STANDALONE = [
  'KASIRGA', 'VOLTRAN', 'VORTEX', 'FIRTINA', 'HAYALET', 'SAMURAY', 'KORSAN',
  'ŞAMPİYON', 'TITAN', 'METEOR', 'BLITZ', 'HAVOC', 'PHANTOM', 'GHOST', 'SHADOW',
  'VIPER', 'FALCON', 'HUNTER', 'RAPTOR', 'FRENZY', 'TURBO', 'SONIC', 'LEGEND',
  'BANDIT', 'CYBER', 'GLADIATOR', 'APEX', 'ZENITH'
];

const NICK_PREFIX = ['BAY', 'ŞEF', 'KRAL', 'LORD', 'KAPTAN', 'ALFA'];

const randOf = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Karışık stil zengin kısa nick üretir (sıfat+isim / isim+sayı / tekil / unvan). Her zaman ≤12 harf. */
export function generateNick(exclude = '') {
  const normExclude = String(exclude || '').trim().toUpperCase();
  for (let attempt = 0; attempt < 25; attempt++) {
    const roll = Math.random();
    let cand = '';
    if (roll < 0.42) {
      const adj = randOf(NICK_ADJ);
      const noun = randOf(NICK_NOUN);
      if (adj !== noun) cand = `${adj} ${noun}`;
    } else if (roll < 0.68) {
      const num = Math.random() < 0.65 ? (10 + Math.floor(Math.random() * 89)) : (2 + Math.floor(Math.random() * 8));
      cand = `${randOf(NICK_NOUN)} ${num}`;
    } else if (roll < 0.86) {
      cand = randOf(NICK_STANDALONE);
    } else {
      cand = `${randOf(NICK_PREFIX)} ${randOf(NICK_NOUN)}`;
    }
    if (cand && cand.length <= 12 && cand !== normExclude) {
      return cleanPlayerName(cand);
    }
  }
  const fallback = randOf(NICK_STANDALONE);
  return cleanPlayerName(fallback !== normExclude ? fallback : randOf(NICK_NOUN));
}

/** Kayıtlı nick yoksa üretip saklar; her zaman geçerli nick döner. */
export function ensureStoredNick() {
  const cur = getStoredPlayerName();
  if (cur && cur !== 'OYUNCU') return cur;
  const nick = generateNick();
  try {
    localStorage.setItem(PLAYER_NAME_KEY, nick);
  } catch {}
  return nick;
}

// İsim temizleyici (tek kaynak): trim + BÜYÜK HARF + 12 + etiket gruplarını
// ve tehlikeli karakterleri at. TV listesi ↔ relay ↔ kumanda hep buradan
// geçer (AGENTS §4 parity).
export function cleanPlayerName(name) {
  const clean = (name || '')
    .toString()
    .replace(/<[^>]*>/g, '')
    .trim()
    .toUpperCase()
    .slice(0, 12)
    .replace(/[<>&"'`=\\/]/g, '');
  return clean || 'OYUNCU';
}

// Kalıcı istemci kimliği (reclaim token): reload'da değişmez, gaspı önler.
// SenderId sekme başına değiştiği için isim-reclaim tek başına güvenli değil.
const CLIENT_ID_KEY = 'brutal-party-client-id';
export function getClientId() {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

// HTML'e gömülen isimler için kaçış (skor şeridi innerHTML kullanır)
export function escapeHtml(s) {
  return (s ?? '').toString().replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
