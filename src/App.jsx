import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, LogOut } from 'lucide-react';
import { useAuth } from './lib/useAuth';
import { supabase } from './lib/supabaseClient';
import LoginPage from './components/LoginPage';
import FileManager from './components/FileManager';

export default function App() {
  const { user, loading, signOut } = useAuth();
  const [profile, setProfile] = useState(null);
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

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-950 text-slate-400">
        <Loader2 className="animate-spin mr-2" size={20} /> Loading FileVault…
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <div className="relative h-screen">
      <FileManager user={user} profile={profile} refreshProfile={refreshProfile} />

      <button
        onClick={signOut}
        className="hidden md:flex items-center gap-1.5 absolute top-3 right-4 z-40 text-xs text-slate-500 hover:text-slate-200 bg-slate-900/80 border border-slate-800 rounded-full px-3 py-1.5 backdrop-blur"
      >
        <LogOut size={12} /> Sign out
      </button>

      {swUpdateAvailable && (
        <button
          onClick={() => window.location.reload()}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-accent-500 hover:bg-accent-600 text-sm px-4 py-2 rounded-full shadow-2xl"
        >
          <RefreshCw size={14} /> Update available — tap to refresh
        </button>
      )}
    </div>
  );
}
