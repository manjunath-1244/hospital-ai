'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CalendarCheck } from 'lucide-react';
import { useRealtime } from '../../context/RoleContext';
import { apiFetch, errorMessage } from '../../lib/api';
import type { AgentAction } from '../../lib/actions';
import { ApprovalCard } from '../ai/ApprovalCard';
import { ErrorBox, Loading, SuccessBox, fmtTime } from '../ui/common';
import { Badge, Button, Card, EmptyState, SectionTitle } from '../ui/kit';

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
    <Card as="div" data-testid="follow-up-panel">
      <SectionTitle
        icon={<CalendarCheck className="h-5 w-5" />}
        actions={
          <Button onClick={propose} loading={busy} disabled={busy || !visitOpen} title={visitOpen ? '' : 'Needs an open visit'}>
            {busy ? 'Proposing...' : 'Propose follow-up plan'}
          </Button>
        }
      >
        Follow-up plan
      </SectionTitle>
      <div className="space-y-4">
        {plan === undefined && !error && <Loading text="Loading plan..." />}
        <ErrorBox message={error} />
        <SuccessBox message={msg} />
        {plan === null && !error && <EmptyState title="No follow-up plan for this visit yet." hint={visitOpen ? 'Propose a plan to create an approval request for the follow-up items.' : undefined} />}
        {plan && (
          <div className="space-y-2">
            <p className="text-sm text-ink">
              State: <span className="font-semibold">{PLAN_STATE_LABEL[plan.status] ?? plan.status}</span> <span className="text-ink-3">• {plan.id} • {fmtTime(plan.createdAt)}</span>
            </p>
            <ul className="space-y-2">
              {plan.items.map((it, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-muted px-4 py-3 text-sm text-ink">
                  <Badge>{ITEM_TYPE_LABEL[it.type] ?? it.type}</Badge>
                  <span>{it.summary}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {proposal && <ApprovalCard action={proposal} onChanged={load} />}
      </div>
    </Card>
  );
};
