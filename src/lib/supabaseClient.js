import { createClient } from '@supabase/supabase-js';

// Environment variables are injected by Vite at build time (Netlify env vars
// prefixed with VITE_ are exposed to the client bundle).
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    '[FileVault] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
      'Set them in .env.local (dev) or Netlify site settings (prod).'
  );
}

// A thin wrapper around localStorage that never throws. Safari private mode /
// some embedded webviews can throw on localStorage access; falling back to an
// in-memory store keeps auth from crashing the app even if persistence fails.
function safeStorage() {
  try {
    const testKey = '__filevault_storage_test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return window.localStorage;
  } catch {
    const mem = new Map();
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, v),
      removeItem: (k) => mem.delete(k)
    };
  }
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Persist the session so the app can reopen "logged in" while offline;
    // combined with offlineDb.js, cached metadata + a persisted session lets
    // the shell fully render before the network round-trip resolves.
    storage: safeStorage(),
    storageKey: 'filevault-auth',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  },
  global: {
    headers: { 'x-client-info': 'filevault-pwa' }
  },
  realtime: {
    params: { eventsPerSecond: 5 }
  }
});

export const STORAGE_BUCKET = 'filevault';

/** Build the storage object path for a given user/file id/name. */
export function buildStoragePath(userId, fileId, fileName) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${userId}/${fileId}-${safeName}`;
}

export function isOnline() {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}
