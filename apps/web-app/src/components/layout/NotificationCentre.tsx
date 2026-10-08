'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BellRing, CheckCheck } from 'lucide-react';
import { useRealtime, useRole } from '../../context/RoleContext';
import { apiFetch, errorMessage } from '../../lib/api';
import { destinationFor, type AppNotification } from '../../lib/notifications';
import { fmtTime } from '../ui/common';

/** Per-user inbox (GET /hospital/notifications). Works for every role; refreshes on `notification.new`. */
export const NotificationCentre: React.FC = () => {
  const { role, ownRole, setViewAs, navigateTo } = useRole();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const loadCount = useCallback(async () => {
    try {
      const r = await apiFetch<{ unreadCount: number }>('/hospital/notifications/unread-count');
      setUnread(r.unreadCount);
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  const loadList = useCallback(async () => {
    try {
      const r = await apiFetch<{ notifications: AppNotification[] }>('/hospital/notifications');
      setItems(r.notifications);
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCount();
  }, [loadCount]);

  useRealtime(['notification.new'], () => {
    loadCount();
    if (open) loadList();
  });

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadList();
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, loadList]);

  const markRead = async (n: AppNotification) => {
    if (n.readAt) return;
    try {
      await apiFetch(`/hospital/notifications/${encodeURIComponent(n.id)}/read`, { method: 'POST' });
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      setUnread((c) => Math.max(0, c - 1));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const markAll = async () => {
    try {
      await apiFetch('/hospital/notifications/read-all', { method: 'POST' });
      await Promise.all([loadCount(), loadList()]);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const openItem = async (n: AppNotification) => {
    await markRead(n);
    const dest = destinationFor(n, role, ownRole === 'ADMIN');
    if (!dest) return;
    if (dest.viewAs) setViewAs(dest.viewAs);
    navigateTo(dest.nav);
    setOpen(false);
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-slate-200 hover:text-white hover:bg-slate-800 border border-slate-700"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        aria-expanded={open}
        data-testid="notification-bell"
      >
        <BellRing className="h-5 w-5" aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 flex min-w-6 h-6 px-1 items-center justify-center rounded-full bg-indigo-500 text-xs font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[28rem] max-w-[90vw] max-h-[30rem] overflow-y-auto glass-panel rounded-xl border border-slate-700 p-3 space-y-2 z-50">
          <div className="flex items-center justify-between px-1">
            <p className="text-lg font-bold text-white">Notifications</p>
            <button onClick={markAll} disabled={unread === 0} className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-40">
              <CheckCheck className="h-4 w-4" /> Mark all read
            </button>
          </div>
          {error && <p className="px-1 text-sm font-semibold text-rose-300">{error}</p>}
          {loaded && items.length === 0 && !error && <p className="p-4 text-base text-slate-400">No notifications.</p>}
          {items.map((n) => {
            const dest = destinationFor(n, role, ownRole === 'ADMIN');
            return (
              <button
                key={n.id}
                onClick={() => openItem(n)}
                className={`w-full text-left rounded-lg border p-3 ${n.readAt ? 'bg-slate-950 border-slate-800' : 'bg-indigo-950/50 border-indigo-500/40'} hover:border-slate-500`}
              >
                <p className="text-base font-bold text-white flex items-center gap-2">
                  {!n.readAt && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-indigo-400" aria-label="Unread" />}
                  {n.title}
                </p>
                <p className="text-sm text-slate-300 mt-1 break-words">{n.body}</p>
                <p className="text-xs text-slate-400 mt-1 font-mono">
                  {fmtTime(n.createdAt)}{dest ? ' • click to open' : ''}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
