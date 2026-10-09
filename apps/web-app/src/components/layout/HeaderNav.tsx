'use client';

import React, { useEffect, useState } from 'react';
import { useRole, UserRole } from '../../context/RoleContext';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../lib/api';
import type { HealthResponse } from '../../lib/types';
import { Hospital, Bell, LogOut, X } from 'lucide-react';
import { NotificationCentre } from './NotificationCentre';

const roleLabels: Record<UserRole, { title: string }> = {
  RECEPTIONIST: { title: 'Receptionist' },
  ED_NURSE: { title: 'Nurse' },
  DOCTOR: { title: 'Doctor' },
  RADIOLOGIST: { title: 'Radiologist' },
  PHARMACIST: { title: 'Pharmacist' },
  CARE_COORDINATOR: { title: 'Care Coordinator' },
  SPECIALIST: { title: 'Specialist' },
  ADMIN: { title: 'Admin' },
};

const PORTALS = Object.keys(roleLabels) as UserRole[];

const StatusDot: React.FC<{ ok: boolean }> = ({ ok }) => <span aria-hidden className={`h-2 w-2 rounded-full ${ok ? 'bg-success-700' : 'bg-danger-600'}`} />;

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
    <header className="sticky top-0 z-40 w-full border-b border-line bg-surface px-4 sm:px-6 lg:px-8 py-3 shadow-card">
      <div className="mx-auto flex max-w-[90rem] items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-800 text-white">
            <Hospital className="h-5 w-5" aria-hidden />
          </div>
          <p className="text-xl font-semibold tracking-tight text-brand-900">
            M<span className="text-brand-500">K</span>
            <span className="ml-2 hidden text-sm font-medium text-ink-3 md:inline">Clinical operations</span>
          </p>
        </div>

        {/* Real status indicators */}
        <div className="hidden xl:flex items-center gap-2 text-sm">
          {isAdmin &&
            (health ? (
              (() => {
                const up = health.services.filter((s) => s.status === 'UP').length;
                const total = health.services.length;
                const ok = up === total;
                const down = health.services.filter((s) => s.status !== 'UP').map((s) => s.name);
                return (
                  <div
                    className="flex items-center gap-1.5 rounded-full border border-line bg-surface-muted px-3 py-1"
                    title={health.services.map((s) => `${s.name}: ${s.status}`).join('\n')}
                  >
                    <StatusDot ok={ok} />
                    <span className="text-ink-3">Services:</span>
                    <span className={`font-semibold ${ok ? 'text-success-700' : 'text-danger-700'}`}>{ok ? `All ${total} up` : `${up}/${total} up`}</span>
                    {!ok && <span className="text-ink-3">({down.join(', ')} down)</span>}
                  </div>
                );
              })()
            ) : (
              <div className="rounded-full border border-line bg-surface-muted px-3 py-1 text-ink-3">{healthError ? 'Health unavailable' : 'Checking health...'}</div>
            ))}
          <div className="flex items-center gap-1.5 rounded-full border border-line bg-surface-muted px-3 py-1">
            <StatusDot ok={socketConnected} />
            <span className="text-ink-3">WebSocket:</span>
            <span className={`font-semibold ${socketConnected ? 'text-success-700' : 'text-danger-700'}`}>{socketConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <NotificationCentre />
          <div className="relative">
            <button
              onClick={() => setShowAlerts((s) => !s)}
              className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-line-strong bg-surface text-ink-2 hover:bg-surface-muted"
              aria-label="Alerts"
              aria-expanded={showAlerts}
            >
              <Bell className="h-5 w-5" aria-hidden="true" />
              {alerts.length > 0 && (
                <span className={`absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-semibold text-white ${unconsultedCount + news2AlertCount > 0 ? 'bg-danger-600' : 'bg-brand-600'}`}>
                  {alerts.length}
                </span>
              )}
            </button>
            {showAlerts && (
              <div className="absolute right-0 z-50 mt-2 max-h-[28rem] w-[26rem] max-w-[90vw] space-y-2 overflow-y-auto rounded-card border border-line bg-surface p-2 shadow-pop">
                {alerts.length === 0 && <p className="p-4 text-sm text-ink-3">No alerts this session.</p>}
                {alerts.map((a) => (
                  <div key={a.id} className="rounded-lg border border-line bg-surface-muted p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-ink">{a.title}</p>
                      <button onClick={() => dismissAlert(a.id)} className="btn-inline text-ink-3 hover:text-ink" aria-label="Dismiss">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="text-ink-2">{a.message}</p>
                    <p className="font-mono text-xs text-ink-3">{a.timestamp}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="hidden text-right sm:block">
            <p className="text-sm font-semibold leading-tight text-ink">{user?.displayName}</p>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-3">{user?.role}</p>
          </div>
          <button
            onClick={logout}
            className="flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3.5 text-sm font-semibold text-ink-2 hover:bg-surface-muted"
          >
            <LogOut className="h-4 w-4" aria-hidden /> Logout
          </button>
        </div>
      </div>

      {isAdmin && (
        <div className="mx-auto mt-3 flex max-w-[90rem] flex-wrap items-center gap-3 text-sm">
          <span className="font-medium text-ink-3">View as:</span>
          <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-line bg-surface-muted p-1">
            {PORTALS.map((p) => (
              <button
                key={p}
                onClick={() => setViewAs(p)}
                aria-pressed={role === p}
                className={`btn-inline rounded-md px-3.5 py-1.5 text-sm font-semibold ${
                  role === p ? 'bg-brand-700 text-white' : 'text-ink-2 hover:bg-surface hover:text-ink'
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
