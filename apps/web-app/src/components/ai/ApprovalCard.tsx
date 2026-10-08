'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2, ShieldCheck, XCircle } from 'lucide-react';
import {
  ACTION_STATUS_BADGE,
  ACTION_STATUS_LABEL,
  TIER_LABEL,
  actionTypeLabel,
  decideAction,
  isExpired,
  type AgentAction,
} from '../../lib/actions';
import { fmtTime, inputCls } from '../ui/common';

interface Props {
  action: AgentAction;
  /** Called with the server's latest copy after every decision attempt. */
  onChanged?: (a: AgentAction) => void;
}

/** One agent proposal: shows what will happen, and the REAL result after the human decides. */
export const ApprovalCard: React.FC<Props> = ({ action: initial, onChanged }) => {
  const [action, setAction] = useState<AgentAction>(initial);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    // Parent re-fetched (socket event): trust the server copy.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAction(initial);
  }, [initial]);

  const pending = action.status === 'PENDING';
  const expired = pending && isExpired(action);
  const needsNote = action.tier === 'ASK_HUMAN';

  const decide = async (d: 'approve' | 'decline') => {
    setBusy(d);
    setError('');
    const out = await decideAction(action.id, d, note.trim());
    if (out.action) {
      setAction(out.action);
      onChanged?.(out.action);
    }
    setError(out.error);
    setBusy(null);
  };

  const v = action.verification;
  const resultId = action.result && typeof action.result === 'object' ? (action.result as { id?: string }).id : undefined;

  return (
    <div className="rounded-xl border border-indigo-500/40 bg-slate-950 p-4 space-y-3 text-left">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-bold text-indigo-200">
          <ShieldCheck className="h-4 w-4" /> Proposed: {actionTypeLabel(action.type)}
        </span>
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${ACTION_STATUS_BADGE[action.status] ?? ''}`}>
          {expired ? 'Expired' : (ACTION_STATUS_LABEL[action.status] ?? action.status)}
        </span>
      </div>
      <p className="text-base text-white break-words">{action.summary}</p>
      <p className="text-sm text-slate-400">
        {TIER_LABEL[action.tier] ?? action.tier}
        {action.patientId ? ` • patient ${action.patientId}` : ''} • expires {fmtTime(action.expiresAt)} • <span className="font-mono">{action.id}</span>
      </p>

      {pending && !expired && (
        <div className="space-y-2">
          {needsNote && (
            <div>
              <label className="block text-sm font-semibold text-slate-200 mb-1">Written clinician note (min. 5 characters, required to approve)</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => decide('approve')}
              disabled={!!busy || (needsNote && note.trim().length < 5)}
              className="min-h-11 flex-1 rounded-xl bg-emerald-600 px-4 text-base font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy === 'approve' ? 'Approving...' : 'Approve'}
            </button>
            <button
              onClick={() => decide('decline')}
              disabled={!!busy}
              className="min-h-11 flex-1 rounded-xl border border-slate-600 bg-slate-900 px-4 text-base font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              {busy === 'decline' ? 'Declining...' : 'Decline'}
            </button>
          </div>
        </div>
      )}

      {action.status === 'DONE' && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200 space-y-1">
          <p className="flex items-center gap-1.5 font-bold"><CheckCircle2 className="h-4 w-4" /> Executed{resultId ? ` (${resultId})` : ''}{v ? (v.verified ? ' and verified' : ' but NOT verified') : ''}.</p>
          {v?.checks?.map((c, i) => <p key={i}>- {c}</p>)}
        </div>
      )}
      {action.status === 'FAILED' && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200 space-y-1">
          <p className="flex items-center gap-1.5 font-bold"><XCircle className="h-4 w-4" /> Execution failed.</p>
          {v?.error && <p>Reason: {v.error}</p>}
          {v?.checks?.map((c, i) => <p key={i}>- {c}</p>)}
        </div>
      )}
      {action.status === 'DECLINED' && <p className="text-sm text-slate-300">Declined{action.decisionNote ? `: ${action.decisionNote}` : '.'}</p>}
      {(action.status === 'APPROVED' || action.status === 'EXECUTING') && <p className="text-sm text-sky-300">Approved; the server has not reported the final result yet.</p>}
      {error && <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm font-semibold text-rose-200 break-words">{error}</p>}
    </div>
  );
};
