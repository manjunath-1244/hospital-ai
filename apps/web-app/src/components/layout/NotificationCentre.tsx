'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BellRing, CheckCheck } from 'lucide-react';
import { useRealtime, useRole } from '../../context/RoleContext';
import { apiFetch, errorMessage } from '../../lib/api';
import { destinationFor, type AppNotification } from '../../lib/notifications';
import { fmtTime } from '../ui/common';
import { Alert, Button, Spinner } from '../ui/kit';

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
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-line-strong bg-surface text-ink-2 hover:bg-surface-muted"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="notification-popover"
        data-testid="notification-bell"
      >
        <BellRing className="h-5 w-5" aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-xs font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          id="notification-popover"
          role="dialog"
          aria-label="Notifications"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
          className="absolute right-0 z-50 mt-2 max-h-[30rem] w-[28rem] max-w-[90vw] space-y-2 overflow-y-auto rounded-card border border-line bg-surface p-2 shadow-pop"
        >
          <div className="flex items-center justify-between gap-2 px-1">
            <p className="text-base font-semibold text-ink">Notifications</p>
            <Button variant="secondary" size="sm" onClick={markAll} disabled={unread === 0} icon={<CheckCheck className="h-4 w-4" aria-hidden />}>
              Mark all read
            </Button>
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
          {!loaded && !error && <Spinner text="Loading notifications..." />}
          {loaded && items.length === 0 && !error && <p className="p-4 text-sm text-ink-3">No notifications.</p>}
          {items.map((n) => {
            const dest = destinationFor(n, role, ownRole === 'ADMIN');
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => openItem(n)}
                data-testid="notification-item"
                className={`min-h-11 w-full rounded-lg border p-3 text-left hover:bg-surface-muted ${n.readAt ? 'border-line bg-surface' : 'border-brand-200 bg-brand-50'}`}
              >
                <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                  {!n.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-hidden />}
                  {!n.readAt && <span className="sr-only">Unread: </span>}
                  {n.title}
                </p>
                <p className="mt-1 break-words text-sm text-ink-2">{n.body}</p>
                <p className="mt-1 text-xs text-ink-3">
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
