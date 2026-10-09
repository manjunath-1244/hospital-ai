'use client';

import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleDashed, Clock, Loader2, ShieldCheck, TriangleAlert, XCircle } from 'lucide-react';
import { TIER_LABEL, actionTypeLabel, decideAction, fetchAction, isExpired, type AgentAction } from '../../lib/actions';
import { fmtTime } from '../ui/common';
import { Badge, Button, Field, Input, cx, type Tone } from '../ui/kit';

interface Props {
  action: AgentAction;
  /** Called with the server's latest copy after every decision attempt or refresh. */
  onChanged?: (a: AgentAction) => void;
}

/**
 * What the user sees for one agent proposal. Every state is derived from the SERVER's copy of the action, never
 * from the agent's wording: awaiting approval -> executing -> verified, or failed / partially completed / declined.
 */
export type CardState = 'AWAITING' | 'EXPIRED' | 'EXECUTING' | 'VERIFIED' | 'UNVERIFIED' | 'PARTIAL' | 'FAILED' | 'DECLINED';

export function cardState(a: AgentAction, now = Date.now()): CardState {
  switch (a.status) {
    case 'PENDING':
      return isExpired(a, now) ? 'EXPIRED' : 'AWAITING';
    case 'APPROVED':
    case 'EXECUTING':
      return 'EXECUTING';
    case 'DONE':
      return a.verification?.verified === false ? 'UNVERIFIED' : 'VERIFIED';
    case 'FAILED':
      return a.verification?.partial ? 'PARTIAL' : 'FAILED';
    case 'DECLINED':
      return 'DECLINED';
    default:
      return 'EXPIRED';
  }
}

const STATE_VIEW: Record<CardState, { tone: Tone; label: string; line: string }> = {
  AWAITING: { tone: 'warning', label: 'Awaiting approval', line: 'Nothing has been done yet. Review the details, then approve or decline.' },
  EXPIRED: { tone: 'neutral', label: 'Expired', line: 'This proposal expired without a decision. Nothing was done. Ask the assistant to propose it again.' },
  EXECUTING: { tone: 'info', label: 'Executing', line: 'Approved. The server is carrying it out and will read the result back to verify it.' },
  VERIFIED: { tone: 'success', label: 'Done and verified', line: 'Carried out, then read back from the record to confirm it.' },
  UNVERIFIED: { tone: 'warning', label: 'Done, not verified', line: 'It ran, but the read-back did not confirm it. Check the record before relying on it.' },
  PARTIAL: { tone: 'danger', label: 'Partially completed', line: 'Some items were created before one failed. Check the record; nothing is retried automatically.' },
  FAILED: { tone: 'danger', label: 'Failed', line: 'It did not complete. See the reason below.' },
  DECLINED: { tone: 'neutral', label: 'Declined', line: 'Declined. Nothing was done.' },
};

const STEPS = ['Proposed', 'Approved', 'Executing', 'Verified'];
function stepIndex(s: CardState): number {
  if (s === 'AWAITING' || s === 'EXPIRED' || s === 'DECLINED') return 0;
  if (s === 'EXECUTING') return 2;
  return 3;
}

const FRAME: Record<Tone, string> = {
  neutral: 'border-line-strong',
  brand: 'border-brand-200',
  info: 'border-info-200',
  success: 'border-success-200',
  warning: 'border-warning-200',
  danger: 'border-danger-200',
};

const Icon: React.FC<{ state: CardState }> = ({ state }) => {
  if (state === 'EXECUTING') return <Loader2 className="h-4 w-4 animate-spin" aria-hidden />;
  if (state === 'VERIFIED') return <CheckCircle2 className="h-4 w-4" aria-hidden />;
  if (state === 'FAILED' || state === 'DECLINED') return <XCircle className="h-4 w-4" aria-hidden />;
  if (state === 'PARTIAL' || state === 'UNVERIFIED') return <TriangleAlert className="h-4 w-4" aria-hidden />;
  if (state === 'EXPIRED') return <Clock className="h-4 w-4" aria-hidden />;
  return <CircleDashed className="h-4 w-4" aria-hidden />;
};

export const ApprovalCard: React.FC<Props> = ({ action: initial, onChanged }) => {
  const [action, setAction] = useState<AgentAction>(initial);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);
  const [error, setError] = useState('');
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  });

  useEffect(() => {
    // Parent re-fetched (socket event): trust the server copy.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAction(initial);
  }, [initial]);

  // A typed "yes" in the chat (or another tab) decides this same proposal: keep the card in step with the server.
  const open = action.status === 'PENDING' || action.status === 'APPROVED' || action.status === 'EXECUTING';
  useEffect(() => {
    if (!open || busy) return;
    let stop = false;
    const tick = async () => {
      const fresh = await fetchAction(action.id);
      if (!stop && fresh && (fresh.status !== action.status || fresh.verification?.verified !== action.verification?.verified)) {
        setAction(fresh);
        onChangedRef.current?.(fresh);
      }
    };
    const t = setInterval(tick, 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [open, busy, action.id, action.status, action.verification?.verified]);

  const state = cardState(action);
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
  const resultId = action.result && !Array.isArray(action.result) && typeof action.result === 'object' ? (action.result as { id?: string }).id : undefined;
  const live = busy === 'approve' ? 'EXECUTING' : state;
  const liveView = STATE_VIEW[live];

  return (
    <div data-testid="approval-card" data-state={state} className={cx('space-y-3 rounded-lg border bg-surface p-4 text-left shadow-card', FRAME[liveView.tone])}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <ShieldCheck className="h-4 w-4 text-brand-600" aria-hidden /> Proposed action: {actionTypeLabel(action.type)}
        </span>
        <Badge tone={liveView.tone}>
          <Icon state={live} /> {liveView.label}
        </Badge>
      </div>

      <p className="break-words text-sm text-ink">{action.summary}</p>
      <p className="text-xs text-ink-3">
        {TIER_LABEL[action.tier] ?? action.tier}
        {action.patientId ? ` · patient ${action.patientId}` : ''} · expires {fmtTime(action.expiresAt)} · <span className="font-mono">{action.id}</span>
      </p>

      <ol className="flex items-center gap-1.5 text-xs" aria-label="Progress">
        {STEPS.map((s, i) => {
          const done = i <= stepIndex(live) && live !== 'DECLINED' && live !== 'EXPIRED';
          const failed = (live === 'FAILED' || live === 'PARTIAL') && i === 3;
          return (
            <li key={s} className="flex items-center gap-1.5" aria-current={i === stepIndex(live) ? 'step' : undefined}>
              <span
                className={cx(
                  'rounded-full border px-2 py-0.5 font-medium',
                  failed ? 'border-danger-200 bg-danger-50 text-danger-700' : done ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-line bg-surface-muted text-ink-3',
                )}
              >
                {failed ? 'Failed' : s}
              </span>
              {i < STEPS.length - 1 && <span className="text-ink-3" aria-hidden>→</span>}
            </li>
          );
        })}
      </ol>

      <p className={cx('text-sm', liveView.tone === 'danger' ? 'font-medium text-danger-700' : liveView.tone === 'warning' ? 'text-warning-700' : 'text-ink-2')} aria-live="polite">
        {liveView.line}
      </p>

      {state === 'AWAITING' && (
        <div className="space-y-3">
          {needsNote && (
            <Field label="Written clinician note (at least 5 characters, required to approve)">
              {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
          )}
          <div className="flex gap-2">
            <Button
              data-testid="action-approve"
              onClick={() => decide('approve')}
              disabled={!!busy || (needsNote && note.trim().length < 5)}
              loading={busy === 'approve'}
              className="flex-1"
            >
              {busy === 'approve' ? 'Approving...' : 'Approve'}
            </Button>
            <Button data-testid="action-decline" variant="secondary" onClick={() => decide('decline')} disabled={!!busy} loading={busy === 'decline'} className="flex-1">
              {busy === 'decline' ? 'Declining...' : 'Decline'}
            </Button>
          </div>
        </div>
      )}

      {(state === 'VERIFIED' || state === 'UNVERIFIED') && (
        <div className="rounded-lg border border-line bg-surface-muted p-3 text-sm text-ink-2">
          <p className="font-medium text-ink">
            Result{resultId ? ` (${resultId})` : ''}
            {v ? (v.verified ? ': verified' : ': NOT verified') : ''}
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {v?.checks?.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {(state === 'FAILED' || state === 'PARTIAL') && (
        <div className="rounded-lg border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700">
          {v?.error && <p className="font-medium">Reason: {v.error}</p>}
          {v?.checks?.length ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {v.checks.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      {state === 'DECLINED' && action.decisionNote && <p className="text-sm text-ink-2">Note: {action.decisionNote}</p>}
      {error && (
        <p role="alert" className="break-words rounded-lg border border-danger-200 bg-danger-50 p-3 text-sm font-medium text-danger-700">
          {error}
        </p>
      )}
    </div>
  );
};
