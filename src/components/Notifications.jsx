import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, X, CheckCheck, CalendarClock, Share2, FileText, ListTodo } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

const TYPE_ICON = {
  task_assigned: ListTodo,
  task_due_soon: CalendarClock,
  file_shared: Share2,
  mom_published: FileText
};

/**
 * Subscribes to the `notifications` table via Supabase Realtime, shows a
 * transient toast for each new row, and exposes a bell icon with a dropdown
 * of recent alerts (read/unread). Also offers to register the browser for
 * Web Push so deadline/assignment alerts can arrive even when the PWA isn't
 * in the foreground (requires a VAPID key configured server-side — see the
 * inline comment on `subscribeToWebPush`).
 *
 * Props: user
 */
export default function Notifications({ user }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [pushEnabled, setPushEnabled] = useState(false);
  const dropdownRef = useRef(null);

  const loadInitial = useCallback(async () => {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .or(`recipient_id.eq.${user.id},recipient_id.is.null`)
      .order('created_at', { ascending: false })
      .limit(30);
    if (!error) setItems(data);
  }, [user.id]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  // Realtime subscription: new notification rows trigger both the list
  // update and a transient toast. Each mount gets a unique channel topic
  // name (StrictMode double-invokes effects in dev; a shared literal name
  // can collide with the previous instance's channel before it's fully
  // torn down, which Supabase Realtime rejects).
  const channelNameRef = useRef(`notifications-realtime-${Math.random().toString(36).slice(2)}`);
  useEffect(() => {
    const channel = supabase
      .channel(channelNameRef.current)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload) => {
          const row = payload.new;
          if (row.recipient_id && row.recipient_id !== user.id) return; // not for this user
          setItems((prev) => [row, ...prev].slice(0, 50));
          pushToast(row);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user.id]);

  function pushToast(row) {
    const id = row.id;
    setToasts((prev) => [...prev, row]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 6000);
  }

  useEffect(() => {
    function onClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  async function markAllRead() {
    const unreadIds = items.filter((i) => !i.is_read).map((i) => i.id);
    if (unreadIds.length === 0) return;
    setItems((prev) => prev.map((i) => ({ ...i, is_read: true })));
    await supabase.from('notifications').update({ is_read: true }).in('id', unreadIds);
  }

  const unreadCount = items.filter((i) => !i.is_read).length;

  return (
    <>
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="relative p-2 rounded-full hover:bg-slate-800 text-slate-300"
          aria-label="Notifications"
        >
          <Bell size={18} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-[10px] leading-4 text-center text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-50 animate-scale-in">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-800 sticky top-0 bg-slate-900">
              <span className="text-sm font-medium">Notifications</span>
              <button onClick={markAllRead} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
                <CheckCheck size={13} /> Mark all read
              </button>
            </div>
            {items.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-8">You're all caught up.</p>
            ) : (
              items.map((n) => <NotificationRow key={n.id} n={n} />)
            )}
            <div className="border-t border-slate-800 px-3 py-2.5">
              <WebPushToggle enabled={pushEnabled} onChange={setPushEnabled} />
            </div>
          </div>
        )}
      </div>

      {/* Toasts */}
      <div className="fixed bottom-20 md:bottom-4 left-1/2 -translate-x-1/2 z-[70] space-y-2 w-[calc(100%-2rem)] max-w-sm">
        {toasts.map((t) => (
          <ToastCard key={t.id} n={t} onDismiss={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))} />
        ))}
      </div>
    </>
  );
}

function NotificationRow({ n }) {
  const Icon = TYPE_ICON[n.type] || Bell;
  return (
    <div className={`flex items-start gap-2.5 px-3 py-2.5 border-b border-slate-800/60 ${n.is_read ? 'opacity-60' : ''}`}>
      <Icon size={15} className="text-accent-400 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-100 truncate">{n.title}</p>
        {n.body && <p className="text-xs text-slate-500 truncate">{n.body}</p>}
        <p className="text-[10px] text-slate-600 mt-0.5">{new Date(n.created_at).toLocaleString()}</p>
      </div>
    </div>
  );
}

function ToastCard({ n, onDismiss }) {
  const Icon = TYPE_ICON[n.type] || Bell;
  return (
    <div className="flex items-start gap-2.5 bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-3 shadow-2xl animate-scale-in">
      <Icon size={16} className="text-accent-400 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-100 truncate">{n.title}</p>
        {n.body && <p className="text-xs text-slate-400 truncate">{n.body}</p>}
      </div>
      <button onClick={onDismiss} className="text-slate-500 hover:text-slate-300 shrink-0">
        <X size={14} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Web Push
// ---------------------------------------------------------------------------
function WebPushToggle({ enabled, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function toggle() {
    if (enabled) {
      onChange(false);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await subscribeToWebPush();
      onChange(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={toggle}
        disabled={busy}
        className="w-full flex items-center justify-center gap-1.5 text-xs px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-60"
      >
        <Bell size={13} /> {enabled ? 'Push notifications enabled' : 'Enable push notifications'}
      </button>
      {error && <p className="text-[11px] text-red-400 mt-1 text-center">{error}</p>}
    </div>
  );
}

/**
 * Registers for Web Push via the service worker's PushManager. This requires
 * a VAPID public key (generate one with `npx web-push generate-vapid-keys`
 * and set it as VITE_VAPID_PUBLIC_KEY) plus a server-side endpoint (e.g. a
 * Supabase Edge Function) that stores the resulting PushSubscription and
 * calls web-push's `sendNotification` against it when a `notifications` row
 * is inserted. The subscribe step here is fully functional on its own; only
 * the "deliver while backgrounded" half needs that server piece deployed.
 */
export async function subscribeToWebPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push notifications are not supported on this browser/device.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted.');
  }
  const registration = await navigator.serviceWorker.ready;
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidKey) {
    throw new Error('Push is not configured yet (missing VITE_VAPID_PUBLIC_KEY).');
  }
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey)
  });

  const { data: userData } = await supabase.auth.getUser();
  await supabase.from('push_subscriptions').upsert({
    user_id: userData.user.id,
    endpoint: subscription.endpoint,
    subscription_json: subscription.toJSON(),
    updated_at: new Date().toISOString()
  });
  return subscription;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}
