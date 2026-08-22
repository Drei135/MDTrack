/**
 * backgroundSync.js
 * -------------------------------------------------------------------------
 * Thin wrappers around the Background Sync / Periodic Background Sync APIs.
 * Both are feature-detected and fail silently (resolve to false) on browsers
 * that don't support them (Safari, Firefox) — the app already falls back to
 * the `online` event listener in offlineDb.js's attachAutoSync for those.
 * -------------------------------------------------------------------------
 */

/** Ask the service worker to replay the offline queue once connectivity is
 * back, even if this tab isn't open anymore. Call this right after queueing
 * an action while offline. */
export async function requestBackgroundSync(tag = 'sync-pending-changes') {
  if (!('serviceWorker' in navigator)) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    if (!('sync' in registration)) return false;
    await registration.sync.register(tag);
    return true;
  } catch {
    // Most common cause: no stable network right now, or the browser denied
    // the registration. Either way, attachAutoSync's `online` listener is
    // still there as a fallback the next time the app is open.
    return false;
  }
}

/** Best-effort: ask the browser for permission to periodically refresh
 * cached data in the background. Only grantable for installed PWAs on
 * supporting Chromium browsers; safe no-op everywhere else. Call once after
 * login. */
export async function requestPeriodicSync(tag = 'refresh-cached-data', minIntervalMs = 24 * 60 * 60 * 1000) {
  if (!('serviceWorker' in navigator)) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    if (!('periodicSync' in registration)) return false;

    const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (status.state !== 'granted') return false;

    const tags = await registration.periodicSync.getTags();
    if (tags.includes(tag)) return true;

    await registration.periodicSync.register(tag, { minInterval: minIntervalMs });
    return true;
  } catch {
    return false;
  }
}

/** Wire up the app's reaction to messages sw-extra.js posts back after a
 * `sync` or `periodicsync` event fires. Call once at app start; returns an
 * unsubscribe function. */
export function attachBackgroundSyncListener({ onSyncPendingChanges, onRefreshCachedData }) {
  if (!('serviceWorker' in navigator)) return () => {};
  const handler = (event) => {
    if (event.data?.type === 'SYNC_PENDING_CHANGES') onSyncPendingChanges?.();
    if (event.data?.type === 'REFRESH_CACHED_DATA') onRefreshCachedData?.();
  };
  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
}
