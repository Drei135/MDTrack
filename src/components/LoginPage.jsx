import React, { useState } from 'react';
import { CloudCog, Mail, Lock, Loader2 } from 'lucide-react';
import { useAuth } from '../lib/useAuth';

export default function LoginPage() {
  const { signInWithPassword, signUp } = useAuth();
  const [mode, setMode] = useState('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      if (mode === 'sign-in') {
        const { error: err } = await signInWithPassword(email, password);
        if (err) throw err;
      } else {
        const { error: err } = await signUp(email, password);
        if (err) throw err;
        setNotice('Account created. Check your email to confirm, then sign in.');
        setMode('sign-in');
      }
    } catch (err) {
      setError(err.message || 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-8">
          <CloudCog className="text-accent-400" size={32} />
          <span className="text-2xl font-semibold tracking-tight">FileVault</span>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 animate-scale-in"
        >
          <h1 className="text-lg font-medium text-slate-100">
            {mode === 'sign-in' ? 'Sign in to your files' : 'Create your account'}
          </h1>

          {error && (
            <div className="text-sm text-red-300 bg-red-950/60 border border-red-900 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          {notice && (
            <div className="text-sm text-emerald-300 bg-emerald-950/60 border border-emerald-900 rounded-lg px-3 py-2">
              {notice}
            </div>
          )}

          <label className="block">
            <span className="text-xs uppercase tracking-wide text-slate-400">Email</span>
            <div className="mt-1 flex items-center gap-2 bg-slate-800/70 border border-slate-700 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-accent-500">
              <Mail size={16} className="text-slate-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-transparent outline-none w-full text-sm"
                placeholder="you@example.com"
              />
            </div>
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-wide text-slate-400">Password</span>
            <div className="mt-1 flex items-center gap-2 bg-slate-800/70 border border-slate-700 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-accent-500">
              <Lock size={16} className="text-slate-400" />
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-transparent outline-none w-full text-sm"
                placeholder="••••••••"
              />
            </div>
          </label>

          <button
            type="submit"
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 bg-accent-500 hover:bg-accent-600 disabled:opacity-60 transition-colors rounded-lg py-2 text-sm font-medium"
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            {mode === 'sign-in' ? 'Sign in' : 'Sign up'}
          </button>

          <button
            type="button"
            onClick={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
            className="w-full text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            {mode === 'sign-in' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </button>
        </form>

        <p className="text-center text-xs text-slate-500 mt-4">
          Once signed in, FileVault works offline — your files stay cached on this device.
        </p>
      </div>
    </div>
  );
}
