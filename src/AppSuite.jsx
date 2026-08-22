import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, LogOut, HardDrive, ListTodo, ClipboardList, Users } from 'lucide-react';
import { useAuth } from './lib/useAuth';
import { supabase } from './lib/supabaseClient';
import { syncPendingActions } from './lib/offlineDb';
import { attachBackgroundSyncListener, requestPeriodicSync } from './lib/backgroundSync';
import LoginPage from './components/LoginPage';
import FileManager from './components/FileManager';
import TasksManager from './components/TasksManager';
import MOMGenerator from './components/MOMGenerator';
import OrgChart from './components/OrgChart';
import Notifications from './components/Notifications';
import BottomNav from './components/BottomNav';

/**
 * AppSuite.jsx
 * -------------------------------------------------------------------------
 * A new, standalone entry point that composes the ORIGINAL, unmodified
 * FileManager alongside the new Tasks / Meeting Notes / Org Chart modules,
 * behind a shared top tab bar (desktop) and bottom tab bar (Android/mobile).
 *
 * Nothing in App.jsx, FileManager.jsx, or any other previously delivered
 * file was changed to build this - it's purely additive. To use the full
 * suite instead of the plain file manager, point src/main.jsx at this file
 * instead of ./App.jsx:
 *
 *   import App from './AppSuite.jsx';   // instead of './App.jsx'
 *
 * (Both entry points can coexist in the project; swapping the one import
 * line in main.jsx is the only change needed, and it's optional - App.jsx
 * keeps working exactly as before if you leave it untouched.)
 * -------------------------------------------------------------------------
 */

const TOP_TABS = [
  { id: 'drive', label: 'Files', icon: HardDrive },
  { id: 'org', label: 'Org Chart', icon: Users },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'mom', label: 'Minutes', icon: ClipboardList }
];

export default function AppSuite() {
  const { user, loading, signOut } = useAuth();
  const [profile, setProfile] = useState(null);
  const [tab, setTab] = useState('drive');
  const [swUpdateAvailable, setSwUpdateAvailable] = useState(false);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    if (data) setProfile(data);
  }, [user]);

  useEffect(() => {
    refreshProfile();
  }, [refreshProfile]);

  useEffect(() => {
    const handler = () => setSwUpdateAvailable(true);
    window.addEventListener('filevault:sw-update-available', handler);
    return () => window.removeEventListener('filevault:sw-update-available', handler);
  }, []);

  // Respond to the service worker waking up for a `sync` or `periodicsync`
  // event (see public/sw-extra.js): replay the offline queue, or refresh the
  // cached file list, without the user having to do anything.
  useEffect(() => {
    const detach = attachBackgroundSyncListener({
      onSyncPendingChanges: () => syncPendingActions(),
      onRefreshCachedData: () => {
        refreshProfile();
        window.dispatchEvent(new CustomEvent('filevault:refresh-cached-data'));
      }
    });
    return detach;
  }, [refreshProfile]);

  // Best-effort periodic background sync registration, once per session
  // after login (no-op on browsers/OSes that don't support it).
  useEffect(() => {
    if (user) requestPeriodicSync();
  }, [user]);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-950 text-slate-400">
        <Loader2 className="animate-spin mr-2" size={20} /> Loading FileVault Suite…
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <div className="h-screen flex flex-col bg-slate-950">
      {/* Top bar: desktop tabs + notifications + sign out */}
      <div className="hidden md:flex items-center justify-between border-b border-slate-800 px-4 py-2 shrink-0">
        <div className="flex items-center gap-1">
          {TOP_TABS.map((t) => {
            const Icon = t.icon;
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg ${
                  isActive ? 'bg-accent-500/15 text-accent-400' : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                <Icon size={15} /> {t.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <Notifications user={user} />
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-200 bg-slate-900 border border-slate-800 rounded-full px-3 py-1.5"
          >
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </div>

      {/* Mobile top bar: title + notifications (nav lives in the bottom tab bar) */}
      <div className="md:hidden flex items-center justify-between border-b border-slate-800 px-4 py-2.5 shrink-0">
        <span className="font-semibold text-sm">FileVault Suite</span>
        <div className="flex items-center gap-1">
          <Notifications user={user} />
          <button onClick={signOut} className="p-2 rounded-full hover:bg-slate-800 text-slate-400">
            <LogOut size={16} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 pb-14 md:pb-0">
        {tab === 'drive' && <FileManager user={user} profile={profile} refreshProfile={refreshProfile} />}
        {tab === 'org' && <OrgChart />}
        {tab === 'tasks' && <TasksManager user={user} />}
        {tab === 'mom' && <MOMGenerator user={user} />}
      </div>

      <BottomNav active={tab} onChange={setTab} />

      {swUpdateAvailable && (
        <button
          onClick={() => window.location.reload()}
          className="fixed bottom-16 md:bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-accent-500 hover:bg-accent-600 text-sm px-4 py-2 rounded-full shadow-2xl"
        >
          <RefreshCw size={14} /> Update available — tap to refresh
        </button>
      )}
    </div>
  );
}
