import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

export function useAuth() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  return {
    session,
    user: session?.user ?? null,
    loading: session === undefined,
    signInWithPassword: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signUp: (email, password) => supabase.auth.signUp({ email, password }),
    signInWithOAuth: (provider) => supabase.auth.signInWithOAuth({ provider }),
    signOut: () => supabase.auth.signOut()
  };
}
