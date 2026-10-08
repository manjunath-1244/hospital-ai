'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { UserCog } from 'lucide-react';
import { apiFetch, errorMessage } from '../../lib/api';
import type { Specialist } from '../../lib/specialists';
import { Empty, ErrorBox, Loading } from '../ui/common';

/** Admin card: list specialists and flip their availability. */
export const SpecialistsCard: React.FC = () => {
  const [list, setList] = useState<Specialist[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    try {
      setList(await apiFetch<Specialist[]>('/hospital/specialists'));
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const toggle = async (s: Specialist) => {
    setBusyId(s.id);
    try {
      await apiFetch(`/hospital/specialists/${encodeURIComponent(s.id)}/availability`, { method: 'PATCH', body: { isAvailable: !s.isAvailable } });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="glass-panel p-7 rounded-2xl border border-slate-700 space-y-4">
      <h3 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2 border-b border-slate-700 pb-4">
        <UserCog className="h-5 w-5 text-teal-400" /> Specialists
      </h3>
      {!list && !error && <Loading text="Loading specialists..." />}
      <ErrorBox message={error} />
      {list && list.length === 0 && <Empty text="No specialists." />}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {list?.map((s) => (
          <div key={s.id} className="rounded-xl bg-slate-950 p-4 border border-slate-700 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-bold text-white truncate">{s.name}</p>
              <p className="text-sm text-slate-400">{s.specialty ?? '—'}{s.department ? ` • ${s.department}` : ''}</p>
            </div>
            <button
              type="button"
              disabled={busyId === s.id}
              onClick={() => toggle(s)}
              aria-pressed={s.isAvailable}
              className={`shrink-0 rounded-lg border px-3 py-2 text-sm font-bold disabled:opacity-50 ${s.isAvailable ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-slate-700/40 text-slate-300 border-slate-600'}`}
            >
              {s.isAvailable ? 'Available' : 'Unavailable'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
