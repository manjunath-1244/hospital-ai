'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, RefreshCw } from 'lucide-react';
import { useRealtime } from '../../context/RoleContext';
import { errorMessage } from '../../lib/api';
import { actionTypeLabel, fetchActions, isOpen, type AgentAction } from '../../lib/actions';
import { ApprovalCard, cardState, type CardState } from '../ai/ApprovalCard';
import { ErrorBox, Loading, fmtTime } from '../ui/common';
import { Badge, Button, Card, EmptyState, SectionTitle, TableFrame, Tabs, type Tone } from '../ui/kit';

/** Same state vocabulary as ApprovalCard (derived by its cardState) so a proposal reads the same in chat and here. */
const STATE_LABEL: Record<CardState, { tone: Tone; label: string }> = {
  AWAITING: { tone: 'warning', label: 'Awaiting approval' },
  EXPIRED: { tone: 'neutral', label: 'Expired' },
  EXECUTING: { tone: 'info', label: 'Executing' },
  VERIFIED: { tone: 'success', label: 'Done and verified' },
  UNVERIFIED: { tone: 'warning', label: 'Done, not verified' },
  PARTIAL: { tone: 'danger', label: 'Partially completed' },
  FAILED: { tone: 'danger', label: 'Failed' },
  DECLINED: { tone: 'neutral', label: 'Declined' },
};

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

  return (
    <Card data-testid="pending-actions-panel">
      <SectionTitle
        icon={<ClipboardCheck className="h-5 w-5" />}
        hint="Changes the assistant proposed. Nothing happens until a person approves."
        actions={
          <Button variant="secondary" size="sm" onClick={load} aria-label="Refresh pending actions" icon={<RefreshCw className="h-4 w-4" />}>
            Refresh
          </Button>
        }
      >
        {title}
      </SectionTitle>
      <div className="mb-4">
        <Tabs
          label="Agent actions"
          value={tab}
          onChange={(id) => setTab(id as 'PENDING' | 'HISTORY')}
          tabs={[
            { id: 'PENDING', label: 'Awaiting approval', count: open.length },
            { id: 'HISTORY', label: 'History' },
          ]}
        />
      </div>
      <ErrorBox message={error} />
      {!pending && !error && <Loading text="Loading actions..." />}

      {tab === 'PENDING' && pending && (
        <div className="space-y-3">
          {open.length === 0 && <EmptyState title="Nothing is waiting for approval." hint="New proposals from the assistant appear here." />}
          {open.map((a) => <ApprovalCard key={a.id} action={a} onChanged={load} />)}
          {stale.length > 0 && <p className="text-sm text-ink-3">{stale.length} proposal(s) passed their expiry and can no longer be approved.</p>}
        </div>
      )}

      {tab === 'HISTORY' && history && (
        history.length === 0 ? (
          <EmptyState title="No decided actions yet." hint="Approved, declined and expired proposals are listed here with their result." />
        ) : (
          <TableFrame>
            <table>
              <thead>
                <tr>
                  <th scope="col">Action</th><th scope="col">Patient</th><th scope="col">Result</th><th scope="col">Decided by</th><th scope="col">When</th>
                </tr>
              </thead>
              <tbody className="align-top">
                {history.map((a) => {
                  const view = STATE_LABEL[cardState(a)];
                  return (
                    <tr key={a.id} data-testid="action-history-row">
                      <td>
                        <p className="font-semibold">{actionTypeLabel(a.type)}</p>
                        <p className="max-w-sm text-sm text-ink-3">{a.summary}</p>
                      </td>
                      <td className="text-sm">{a.patientId ?? '—'}</td>
                      <td>
                        <Badge tone={view.tone}>{view.label}</Badge>
                        {(a.status === 'FAILED' || a.status === 'DONE') && a.verification?.error && <p className="mt-1 text-sm text-danger-700">{a.verification.error}</p>}
                        {a.status === 'DONE' && a.verification?.checks?.[0] && <p className="mt-1 text-sm text-ink-3">{a.verification.checks[0]}</p>}
                        {a.decisionNote && <p className="mt-1 text-sm text-ink-3">Note: {a.decisionNote}</p>}
                      </td>
                      <td className="text-sm">{a.decidedByUserId ?? '—'}</td>
                      <td className="whitespace-nowrap text-sm">{fmtTime(a.decidedAt ?? a.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableFrame>
        )
      )}
    </Card>
  );
};
