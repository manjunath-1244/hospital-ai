import { apiFetch, errorMessage } from './api';

/** Mirrors src/database/entities/agent-action.entity.ts and src/ai/actions/action-policy.ts. */
export type ActionTier = 'AUTO' | 'ASK' | 'ASK_HUMAN' | 'NEVER';
export type ActionStatus = 'PENDING' | 'APPROVED' | 'DECLINED' | 'EXPIRED' | 'EXECUTING' | 'DONE' | 'FAILED';

export interface AgentAction {
  id: string;
  type: string;
  tier: ActionTier;
  summary: string;
  status: ActionStatus;
  patientId?: string | null;
  visitId?: string | null;
  expiresAt: string;
  payload?: Record<string, unknown>;
  proposedByUserId?: string;
  proposedByRole?: string;
  decidedByUserId?: string | null;
  decidedAt?: string | null;
  decisionNote?: string | null;
  result?: Record<string, unknown> | unknown[] | null;
  verification?: { verified: boolean; checks: string[]; error?: string; partial?: boolean } | null;
  createdAt?: string;
}

export const ACTION_STATUS_LABEL: Record<ActionStatus, string> = {
  PENDING: 'Awaiting approval',
  APPROVED: 'Approved',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  EXECUTING: 'Executing',
  DONE: 'Executed',
  FAILED: 'Failed',
};

export const ACTION_STATUS_BADGE: Record<ActionStatus, string> = {
  PENDING: 'bg-warning-50 text-warning-700 border-warning-200',
  APPROVED: 'bg-info-50 text-info-700 border-info-200',
  EXECUTING: 'bg-info-50 text-info-700 border-info-200',
  DONE: 'bg-success-50 text-success-700 border-success-200',
  FAILED: 'bg-danger-50 text-danger-700 border-danger-200',
  DECLINED: 'bg-surface-muted text-ink-2 border-line-strong',
  EXPIRED: 'bg-surface-muted text-ink-2 border-line-strong',
};

export const TIER_LABEL: Record<ActionTier, string> = {
  AUTO: 'Automatic',
  ASK: 'Needs your approval',
  ASK_HUMAN: 'Needs written clinician note',
  NEVER: 'Not allowed',
};

export const ACTION_TYPE_LABEL: Record<string, string> = {
  REFERRAL: 'Referral',
  APPOINTMENT: 'Appointment',
  REGISTER_PATIENT: 'Register patient',
  STAFF_TASK: 'Staff task',
  LAB_ORDER: 'Lab order',
  NOTIFICATION: 'Notification',
  FOLLOW_UP: 'Follow-up plan',
  CONSULTATION: 'Consultation',
  CLOSE_VISIT: 'Complete visit',
  REOPEN_VISIT: 'Reopen visit',
  COMPUTE_NEWS2: 'NEWS2 calculation',
  CREATE_SELF_TASK: 'Personal task',
};
export const actionTypeLabel = (t: string) => ACTION_TYPE_LABEL[t] ?? t;

/** The backend only accepts a decision for a PENDING action that has not passed its expiry. */
export const isExpired = (a: Pick<AgentAction, 'expiresAt'>, now = Date.now()) => new Date(a.expiresAt).getTime() < now;
export const isOpen = (a: AgentAction, now = Date.now()) => a.status === 'PENDING' && !isExpired(a, now);

export const HISTORY_STATUSES: readonly ActionStatus[] = ['DONE', 'FAILED', 'DECLINED', 'EXPIRED', 'APPROVED', 'EXECUTING'];

export const fetchActions = async (params: { status?: ActionStatus; patientId?: string; limit?: number }) => {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.patientId) q.set('patientId', params.patientId);
  q.set('limit', String(params.limit ?? 50));
  const r = await apiFetch<{ success: boolean; actions: AgentAction[] }>(`/ai/actions?${q}`);
  return r.actions;
};

export interface DecisionOutcome {
  /** The action as the server last reported it (re-read after an error so a FAILED run is never shown as success). */
  action: AgentAction | null;
  error: string;
}

/** The server's current copy of one action (null if it cannot be read). */
export const fetchAction = async (id: string): Promise<AgentAction | null> => {
  try {
    const r = await apiFetch<{ success: boolean; action?: AgentAction }>(`/ai/actions/${encodeURIComponent(id)}`);
    return r.success && r.action ? r.action : null;
  } catch {
    return null;
  }
};

export async function decideAction(id: string, decision: 'approve' | 'decline', note: string): Promise<DecisionOutcome> {
  const body = decision === 'approve' ? { decisionNote: note || undefined } : { reason: note || undefined };
  try {
    const r = await apiFetch<{ success: boolean; action: AgentAction }>(`/ai/actions/${encodeURIComponent(id)}/${decision}`, { method: 'POST', body });
    return { action: r.action, error: r.success ? '' : 'The server did not confirm the decision.' };
  } catch (e) {
    return { action: await fetchAction(id), error: errorMessage(e) };
  }
}
