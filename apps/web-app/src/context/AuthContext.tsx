'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  apiFetch,
  readStored,
  setApiToken,
  setUnauthorizedHandler,
  writeStored,
} from '../lib/api';
import type { AuthUser, LoginResponse } from '../lib/types';

interface AuthContextType {
  token: string | null;
  user: AuthUser | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    setApiToken(null);
    writeStored(null, null);
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    const t = readStored('token');
    const u = readStored('user');
    if (t && u) {
      try {
        const parsed = JSON.parse(u) as AuthUser;
        setApiToken(t);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setToken(t);
        setUser(parsed);
      } catch {
        writeStored(null, null);
      }
    }
    setReady(true);
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await apiFetch<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { username, password },
      skipAuthRedirect: true,
    });
    setApiToken(res.accessToken);
    writeStored(res.accessToken, JSON.stringify(res.user));
    setToken(res.accessToken);
    setUser(res.user);
  }, []);

  return (
    <AuthContext.Provider value={{ token, user, ready, login, logout }}>{children}</AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};
