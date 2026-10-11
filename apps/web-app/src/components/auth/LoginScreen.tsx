'use client';

import React, { useState } from 'react';
import { Hospital, LogIn } from 'lucide-react';
import { Alert, Button, Field, Input } from '../ui/kit';
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
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <form onSubmit={submit} className="w-full max-w-md space-y-5 rounded-card border border-line bg-surface p-8 shadow-card">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-brand-800 text-white">
            <Hospital className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight text-brand-900">
              M<span className="text-brand-500">K</span>
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Sign in</h1>
          </div>
        </div>

        <Field label="Username">
          {(id) => (
            <Input
              id={id}
              autoFocus
              data-testid="login-username"
              required
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. doctor, nurse, receptionist"
            />
          )}
        </Field>
        <Field label="Password">
          {(id) => (
            <Input
              id={id}
              required
              type="password"
              data-testid="login-password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>

        {error && <Alert tone="danger" testId="login-error">{error}</Alert>}

        <Button type="submit" data-testid="login-submit" disabled={!username || !password} loading={loading} icon={<LogIn className="h-4 w-4" aria-hidden />} className="w-full">
          {loading ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
};
