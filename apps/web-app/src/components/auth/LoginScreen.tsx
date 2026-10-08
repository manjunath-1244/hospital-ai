'use client';

import React, { useState } from 'react';
import { Hospital, LogIn, AlertCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { errorMessage } from '../../lib/api';

export const LoginScreen: React.FC = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0f1c] p-4">
      <form onSubmit={submit} className="glass-panel w-full max-w-lg rounded-2xl p-10 space-y-6 border border-slate-700">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-emerald-400 p-3">
            <Hospital className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            CURA<span className="text-indigo-400">AI</span> <span className="block text-base font-semibold text-slate-300">Sign in</span>
          </h1>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-200 mb-1.5">Username</label>
          <input
            autoFocus
            required
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="receptionist, nurse, doctor, radiologist, pharmacist, coordinator, admin"
            className="w-full min-h-12 rounded-xl bg-slate-950 px-4 py-3 text-base text-white border border-slate-700 placeholder:text-slate-500 focus:outline-none focus:border-indigo-400"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-200 mb-1.5">Password</label>
          <input
            required
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full min-h-12 rounded-xl bg-slate-950 px-4 py-3 text-base text-white border border-slate-700 placeholder:text-slate-500 focus:outline-none focus:border-indigo-400"
          />
          <p className="mt-2 text-sm text-slate-400">Hint: see SEED_USER_PASSWORD in the backend .env</p>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl bg-rose-500/10 border border-rose-500/30 p-4 text-sm font-semibold text-rose-300">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !username || !password}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 py-3 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 hover:opacity-90 disabled:opacity-50"
        >
          <LogIn className="h-5 w-5" />
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
};
