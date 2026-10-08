'use client';

import React, { useEffect, useState } from 'react';
import { useRole, UserRole } from '../../context/RoleContext';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../lib/api';
import type { HealthResponse } from '../../lib/types';
import { Hospital, Bell, LogOut, X } from 'lucide-react';

const roleLabels: Record<UserRole, { title: string; color: string }> = {
  RECEPTIONIST: { title: 'Receptionist', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  ED_NURSE: { title: 'Nurse', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  DOCTOR: { title: 'Doctor', color: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' },
  RADIOLOGIST: { title: 'Radiologist', color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' },
  PHARMACIST: { title: 'Pharmacist', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  CARE_COORDINATOR: { title: 'Care Coordinator', color: 'bg-pink-500/20 text-pink-400 border-pink-500/30' },
  ADMIN: { title: 'Admin', color: 'bg-rose-500/20 text-rose-400 border-rose-500/30' },
};

const PORTALS = Object.keys(roleLabels) as UserRole[];

export const HeaderNav: React.FC = () => {
  const { user, logout } = useAuth();
  const { role, ownRole, setViewAs, socketConnected, unconsultedCount, news2AlertCount, alerts, dismissAlert } = useRole();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const isAdmin = ownRole === 'ADMIN';

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const load = async () => {
      try {
        const h = await apiFetch<HealthResponse>('/admin/health');
        if (!cancelled) {
          setHealth(h);
          setHealthError(false);
        }
      } catch {
        if (!cancelled) setHealthError(true);
      }
    };
    load();
    const t = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [isAdmin]);

  return (
    <header className="sticky top-0 z-40 w-full glass-panel border-b border-slate-700 px-6 lg:px-8 py-3.5">
      <div className="mx-auto flex max-w-[96rem] items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-emerald-400 p-2">
            <Hospital className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-white">
            CURA<span className="text-indigo-400">AI</span>
          </h1>
        </div>

        {/* Real status indicators */}
        <div className="hidden xl:flex items-center gap-3 text-sm">
          {isAdmin &&
            (health ? (
              (() => {
                const up = health.services.filter((s) => s.status === 'UP').length;
                const total = health.services.length;
                const ok = up === total;
                const down = health.services.filter((s) => s.status !== 'UP').map((s) => s.name);
                return (
                  <div
                    className="flex items-center space-x-1.5 rounded-full bg-slate-900/80 px-3.5 py-1.5 border border-slate-700"
                    title={health.services.map((s) => `${s.name}: ${s.status}`).join('\n')}
                  >
                    <span className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-rose-500'}`} />
                    <span className="text-slate-300">Services:</span>
                    <span className={`font-semibold ${ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {ok ? `All ${total} up` : `${up}/${total} up`}
                    </span>
                    {!ok && <span className="text-slate-400">({down.join(', ')} down)</span>}
                  </div>
                );
              })()
            ) : (
              <div className="rounded-full bg-slate-900/80 px-3.5 py-1.5 border border-slate-700 text-slate-400">
                {healthError ? 'Health unavailable' : 'Checking health...'}
              </div>
            ))}
          <div className="flex items-center space-x-1.5 rounded-full bg-slate-900/80 px-3.5 py-1.5 border border-slate-700">
            <span className={`h-2 w-2 rounded-full ${socketConnected ? 'bg-emerald-400' : 'bg-rose-500'}`} />
            <span className="text-slate-300">WebSocket:</span>
            <span className={`font-semibold ${socketConnected ? 'text-emerald-400' : 'text-rose-400'}`}>
              {socketConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className="relative">
            <button
              onClick={() => setShowAlerts((s) => !s)}
              className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-slate-200 hover:text-white hover:bg-slate-800 border border-slate-700"
              aria-label="Alerts"
            >
              <Bell className="h-5 w-5" aria-hidden="true" />
              {alerts.length > 0 && (
                <span className={`absolute -top-1 -right-1 flex min-w-6 h-6 px-1 items-center justify-center rounded-full text-xs font-bold text-white ${unconsultedCount + news2AlertCount > 0 ? 'bg-rose-600' : 'bg-indigo-500'}`}>
                  {alerts.length}
                </span>
              )}
            </button>
            {showAlerts && (
              <div className="absolute right-0 mt-2 w-[26rem] max-w-[90vw] max-h-[28rem] overflow-y-auto glass-panel rounded-xl border border-slate-700 p-2 space-y-2 z-50">
                {alerts.length === 0 && <p className="p-4 text-sm text-slate-400">No alerts this session.</p>}
                {alerts.map((a) => (
                  <div key={a.id} className="rounded-lg bg-slate-950 border border-slate-700 p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-bold text-white">{a.title}</p>
                      <button onClick={() => dismissAlert(a.id)} className="text-slate-400 hover:text-white" aria-label="Dismiss">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="text-slate-300">{a.message}</p>
                    <p className="text-xs text-slate-400 font-mono">{a.timestamp}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="text-right hidden sm:block">
            <p className="text-sm font-bold text-white leading-tight mb-0.5">{user?.displayName}</p>
            <span className={`inline-block rounded-full border px-3 py-0.5 text-xs font-bold ${ownRole ? roleLabels[ownRole].color : ''}`}>
              {user?.role}
            </span>
          </div>
          <button
            onClick={logout}
            className="flex h-11 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-bold text-slate-200 hover:text-white hover:bg-slate-800 border border-slate-700"
          >
            <LogOut className="h-4 w-4" /> Logout
          </button>
        </div>
      </div>

      {isAdmin && (
        <div className="mx-auto max-w-[96rem] mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-slate-300 font-semibold">View as:</span>
          <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-slate-700 bg-slate-950/70 p-1">
          {PORTALS.map((p) => (
            <button
              key={p}
              onClick={() => setViewAs(p)}
              aria-pressed={role === p}
              className={`rounded-lg border px-4 py-1.5 text-sm font-bold ${
                role === p ? roleLabels[p].color : 'bg-transparent text-slate-300 border-transparent hover:text-white hover:bg-slate-800'
              }`}
            >
              {roleLabels[p].title}
            </button>
          ))}
          </div>
        </div>
      )}
    </header>
  );
};
