'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CalendarCheck } from 'lucide-react';
import { useRealtime } from '../../context/RoleContext';
import { apiFetch, errorMessage } from '../../lib/api';
import type { AgentAction } from '../../lib/actions';
import { ApprovalCard } from '../ai/ApprovalCard';
import { Empty, ErrorBox, Loading, SuccessBox, fmtTime } from '../ui/common';

/** Mirrors src/database/entities/follow-up-plan.entity.ts. */
interface FollowUpPlan {
  id: string;
  visitId: string;
  status: 'DRAFT' | 'PROPOSED' | 'APPROVED' | 'COMPLETED';
  items: { type: 'APPOINTMENT' | 'LAB_ORDER' | 'TASK' | 'PATIENT_NOTICE'; summary: string; details?: unknown }[];
  createdAt: string;
}

const PLAN_STATE_LABEL: Record<FollowUpPlan['status'], string> = {
  DRAFT: 'Draft',
  PROPOSED: 'Proposed - awaiting approval',
  APPROVED: 'Approved',
  COMPLETED: 'Completed',
};
const ITEM_TYPE_LABEL: Record<FollowUpPlan['items'][number]['type'], string> = {
  APPOINTMENT: 'Appointment',
  LAB_ORDER: 'Lab order',
  TASK: 'Staff task',
  PATIENT_NOTICE: 'Patient notice',
};

interface Props {
  visitId: string;
  visitOpen: boolean;
}

/** Follow-up plan of a visit: generate a proposal (becomes a pending action) and show the plan items and state. */
export const FollowUpPanel: React.FC<Props> = ({ visitId, visitOpen }) => {
  const [plan, setPlan] = useState<FollowUpPlan | null | undefined>(undefined);
  const [proposal, setProposal] = useState<AgentAction | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ plan: FollowUpPlan | null }>(`/hospital/visits/${encodeURIComponent(visitId)}/follow-up`);
      setPlan(r.plan ?? null);
      setError('');
    } catch (e) {
      setError(errorMessage(e));
      setPlan(null);
    }
  }, [visitId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlan(undefined);
    setProposal(null);
    setMsg('');
    load();
  }, [load]);
  useRealtime(['agent.action.decided', 'agent.action.executed'], load);

  const propose = async () => {
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const r = await apiFetch<{ plan: FollowUpPlan; proposalAction: AgentAction }>(`/hospital/visits/${encodeURIComponent(visitId)}/follow-up/propose`, { method: 'POST' });
      setPlan(r.plan);
      setProposal(r.proposalAction);
      setMsg('Follow-up plan proposed. Approve it below (or in Pending actions) to put it into effect.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-panel p-7 rounded-2xl border border-slate-700 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 pb-4">
        <h3 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2">
          <CalendarCheck className="h-5 w-5 text-indigo-400" /> Follow-up plan
        </h3>
        <button onClick={propose} disabled={busy || !visitOpen} className="min-h-11 rounded-xl bg-indigo-600 px-4 text-base font-bold text-white hover:bg-indigo-500 disabled:opacity-50" title={visitOpen ? '' : 'Needs an open visit'}>
          {busy ? 'Proposing...' : 'Propose follow-up plan'}
        </button>
      </div>
      {plan === undefined && !error && <Loading text="Loading plan..." />}
      <ErrorBox message={error} />
      <SuccessBox message={msg} />
      {plan === null && !error && <Empty text="No follow-up plan for this visit yet." />}
      {plan && (
        <div className="space-y-2">
          <p className="text-base text-slate-200">
            State: <span className="font-bold text-white">{PLAN_STATE_LABEL[plan.status] ?? plan.status}</span> <span className="text-sm text-slate-400">• {plan.id} • {fmtTime(plan.createdAt)}</span>
          </p>
          <ul className="space-y-2">
            {plan.items.map((it, i) => (
              <li key={i} className="rounded-xl bg-slate-950 border border-slate-700 px-4 py-3 text-base text-slate-200">
                <span className="mr-2 rounded-full border border-slate-600 px-2.5 py-0.5 text-xs font-bold text-slate-300">{ITEM_TYPE_LABEL[it.type] ?? it.type}</span>
                {it.summary}
              </li>
            ))}
          </ul>
        </div>
      )}
      {proposal && <ApprovalCard action={proposal} onChanged={load} />}
    </div>
  );
};
