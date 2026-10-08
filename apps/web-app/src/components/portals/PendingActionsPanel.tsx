'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, RefreshCw } from 'lucide-react';
import { useRealtime } from '../../context/RoleContext';
import { errorMessage } from '../../lib/api';
import {
  ACTION_STATUS_BADGE,
  ACTION_STATUS_LABEL,
  actionTypeLabel,
  fetchActions,
  isOpen,
  type AgentAction,
} from '../../lib/actions';
import { ApprovalCard } from '../ai/ApprovalCard';
import { Empty, ErrorBox, Loading, fmtTime } from '../ui/common';

interface Props {
  /** Limit to one patient (doctor workbench); omit for the whole queue (nurse, admin). */
  patientId?: string;
  title?: string;
}

/** Agent proposals awaiting a human decision, plus decided history. Refreshes on agent.action.* events. */
export const PendingActionsPanel: React.FC<Props> = ({ patientId, title = 'Pending actions' }) => {
  const [tab, setTab] = useState<'PENDING' | 'HISTORY'>('PENDING');
  const [pending, setPending] = useState<AgentAction[] | null>(null);
  const [history, setHistory] = useState<AgentAction[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [p, all] = await Promise.all([
        fetchActions({ status: 'PENDING', patientId }),
        fetchActions({ patientId, limit: 100 }),
      ]);
      setPending(p);
      setHistory(all.filter((a) => a.status !== 'PENDING'));
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [patientId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);
  useRealtime(['agent.action.proposed', 'agent.action.decided', 'agent.action.executed'], load);

  const open = (pending ?? []).filter((a) => isOpen(a));
  const stale = (pending ?? []).filter((a) => !isOpen(a));
  const tabCls = (on: boolean) => `rounded-lg px-4 py-2 text-base font-bold border ${on ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-slate-950 border-slate-700 text-slate-300 hover:text-white'}`;

  return (
    <div className="glass-panel p-7 rounded-2xl border border-slate-700 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 pb-4">
        <h3 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-indigo-400" /> {title}
          {open.length > 0 && <span className="rounded-full bg-amber-500/20 border border-amber-500/30 px-2.5 py-0.5 text-sm text-amber-300">{open.length}</span>}
        </h3>
        <div className="flex items-center gap-2">
          <button className={tabCls(tab === 'PENDING')} onClick={() => setTab('PENDING')}>Awaiting approval</button>
          <button className={tabCls(tab === 'HISTORY')} onClick={() => setTab('HISTORY')}>History</button>
          <button onClick={load} aria-label="Refresh pending actions" className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-700 text-slate-300 hover:text-white">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>
      <ErrorBox message={error} />
      {!pending && !error && <Loading text="Loading actions..." />}

      {tab === 'PENDING' && pending && (
        <div className="space-y-3">
          {open.length === 0 && <Empty text="Nothing is waiting for approval." />}
          {open.map((a) => <ApprovalCard key={a.id} action={a} onChanged={load} />)}
          {stale.length > 0 && <p className="text-sm text-slate-400">{stale.length} proposal(s) passed their expiry and can no longer be approved.</p>}
        </div>
      )}

      {tab === 'HISTORY' && history && (
        history.length === 0 ? (
          <Empty text="No decided actions yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-base">
              <thead>
                <tr className="border-b border-slate-800 text-sm text-slate-400 font-semibold uppercase tracking-wider">
                  <th className="pb-2 px-2">Action</th><th className="pb-2 px-2">Patient</th><th className="pb-2 px-2">Result</th><th className="pb-2 px-2">Decided by</th><th className="pb-2 px-2">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-200 align-top">
                {history.map((a) => (
                  <tr key={a.id}>
                    <td className="py-2 px-2">
                      <p className="font-bold">{actionTypeLabel(a.type)}</p>
                      <p className="text-sm text-slate-400 max-w-sm">{a.summary}</p>
                    </td>
                    <td className="py-2 px-2 font-mono text-sm">{a.patientId ?? '—'}</td>
                    <td className="py-2 px-2">
                      <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${ACTION_STATUS_BADGE[a.status]}`}>{ACTION_STATUS_LABEL[a.status] ?? a.status}</span>
                      {a.status === 'FAILED' && a.verification?.error && <p className="text-sm text-rose-300 mt-1">{a.verification.error}</p>}
                      {a.status === 'DONE' && a.verification?.checks?.[0] && <p className="text-sm text-slate-400 mt-1">{a.verification.checks[0]}</p>}
                      {a.decisionNote && <p className="text-sm text-slate-400 mt-1">Note: {a.decisionNote}</p>}
                    </td>
                    <td className="py-2 px-2 font-mono text-sm">{a.decidedByUserId ?? '—'}</td>
                    <td className="py-2 px-2 text-sm whitespace-nowrap">{fmtTime(a.decidedAt ?? a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
};
