'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { apiFetch, errorMessage } from '../../lib/api';
import { useRealtime } from '../../context/RoleContext';
import { statusLabel, transitionLabel, type TransitionOption, type VisitDetail, type VisitSummary } from '../../lib/visits';
import { ErrorBox, Loading, PriorityBadge, StatusBadge, fmtTime, inputCls, labelCls } from './common';

interface Props {
  visitId: string;
  /** Called after a transition succeeded so the parent can refresh its lists. */
  onChanged?: () => void;
}

/** Visit timeline plus the buttons the backend allows for this user (note prompt when `noteRequired`). */
export const VisitPanel: React.FC<Props> = ({ visitId, onChanged }) => {
  const [detail, setDetail] = useState<VisitDetail | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<TransitionOption | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await apiFetch<VisitDetail>(`/hospital/visits/${encodeURIComponent(visitId)}`));
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [visitId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    setPending(null);
    setNote('');
  }, [load]);
  useRealtime(['visit.updated'], load);

  const run = async (t: TransitionOption, text: string) => {
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/hospital/visits/${encodeURIComponent(visitId)}/transition`, {
        method: 'POST',
        body: { to: t.to, ...(text.trim() ? { note: text.trim() } : {}), ...(t.to === 'COMPLETED' ? { outcome: 'DISCHARGED' } : {}) },
      });
      setPending(null);
      setNote('');
      await load();
      onChanged?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const click = (t: TransitionOption) => {
    if (t.noteRequired || t.to === 'COMPLETED') {
      setPending(t);
      setNote('');
    } else run(t, '');
  };

  if (!detail) return error ? <ErrorBox message={error} /> : <Loading text="Loading visit..." />;
  const v = detail.visit;

  return (
    <div className="rounded-xl bg-slate-950 p-4 border border-slate-700 space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <p className="font-bold text-slate-300 uppercase flex items-center gap-1"><History className="h-4 w-4" /> Current visit</p>
        <StatusBadge visit={v} />
        <PriorityBadge priority={v.priority} />
        {v.primaryDoctorName && <span className="text-slate-400">Doctor: {v.primaryDoctorName}</span>}
      </div>
      <p className="text-slate-300">Chief complaint: {v.chiefComplaint || '—'}</p>

      {detail.allowedTransitions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {detail.allowedTransitions.map((t) => (
            <button
              key={t.to}
              type="button"
              disabled={busy}
              onClick={() => click(t)}
              className={`rounded-lg px-3 py-1.5 text-sm font-bold disabled:opacity-50 ${
                t.to === 'COMPLETED' || t.from === 'COMPLETED' ? 'bg-emerald-600 text-white hover:bg-emerald-500' : t.noteRequired ? 'bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700' : 'bg-indigo-600 text-white hover:bg-indigo-500'
              }`}
            >
              {transitionLabel(t)}
            </button>
          ))}
        </div>
      )}

      {pending && (
        <div className="space-y-2 rounded-xl border border-slate-700 p-3">
          <label className={labelCls}>
            {transitionLabel(pending)}: {pending.noteRequired ? 'reason (required)' : 'note (optional)'}
          </label>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} autoFocus />
          <div className="flex gap-2">
            <button type="button" disabled={busy || (!!pending.noteRequired && !note.trim())} onClick={() => run(pending, note)} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50">
              {busy ? 'Working...' : 'Confirm'}
            </button>
            <button type="button" disabled={busy} onClick={() => setPending(null)} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-bold text-slate-300 border border-slate-700">
              Cancel
            </button>
          </div>
        </div>
      )}
      <ErrorBox message={error} />

      <div>
        <p className="font-bold text-slate-400 uppercase mb-1">Timeline</p>
        <ul className="space-y-1 text-slate-300">
          {detail.timeline.map((t, i) => (
            <li key={i}>
              <span className="text-slate-500">{fmtTime(t.at)}</span> — {t.fromStatus ? `${statusLabel(t.fromStatus)} → ` : ''}<span className="font-semibold">{statusLabel(t.toStatus)}</span>
              {t.actorName && <span className="text-slate-400"> by {t.actorName}</span>}
              {t.note && <span className="text-slate-400"> — {t.note}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

/** Compact list of a patient's past and current visits. */
export const VisitHistory: React.FC<{ visits: VisitSummary[] }> = ({ visits }) =>
  visits.length === 0 ? (
    <p className="text-slate-500 text-sm">No visits yet.</p>
  ) : (
    <ul className="space-y-1 text-sm text-slate-300">
      {visits.map((v) => (
        <li key={v.id} className="flex flex-wrap items-center gap-2">
          <span className="text-slate-500">{fmtTime(v.arrivedAt)}</span>
          <StatusBadge visit={v} />
          <span>{v.chiefComplaint || '—'}</span>
          {v.primaryDoctorName && <span className="text-slate-400">• {v.primaryDoctorName}</span>}
          {v.outcome && <span className="text-slate-400">• {v.outcome}</span>}
          {v.closeReason && <span className="text-slate-400">• {v.closeReason}</span>}
        </li>
      ))}
    </ul>
  );
