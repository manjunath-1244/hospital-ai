/**
 * Single source of truth for visit (episode of care) vocabulary in the UI: statuses, labels, badge colours,
 * stages and the API shapes. Mirrors the backend's src/hospital/visits/*; labels also arrive as `statusLabel`.
 */
export const VISIT_STATUSES = [
  'WAITING_TRIAGE',
  'TRIAGED',
  'IN_CONSULTATION',
  'UNDER_REVIEW',
  'TREATMENT',
  'FOLLOW_UP',
  'COMPLETED',
  'CANCELLED',
  'LEFT_WITHOUT_SEEN',
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const ACTIVE_STATUSES: readonly VisitStatus[] = [
  'WAITING_TRIAGE',
  'TRIAGED',
  'IN_CONSULTATION',
  'UNDER_REVIEW',
  'TREATMENT',
  'FOLLOW_UP',
];
export const FINAL_STATUSES: readonly VisitStatus[] = [
  'COMPLETED',
  'CANCELLED',
  'LEFT_WITHOUT_SEEN',
];

export const isActiveStatus = (s?: VisitStatus | null) =>
  !!s && ACTIVE_STATUSES.includes(s);
export const isFinalStatus = (s?: VisitStatus | null) =>
  !!s && FINAL_STATUSES.includes(s);

export const STATUS_LABEL: Record<VisitStatus, string> = {
  WAITING_TRIAGE: 'Waiting for triage',
  TRIAGED: 'Waiting for doctor',
  IN_CONSULTATION: 'In consultation',
  UNDER_REVIEW: 'Under review',
  TREATMENT: 'In treatment',
  FOLLOW_UP: 'Follow-up',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  LEFT_WITHOUT_SEEN: 'Left without being seen',
};

export const STATUS_BADGE: Record<VisitStatus, string> = {
  WAITING_TRIAGE: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  TRIAGED: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  IN_CONSULTATION: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  UNDER_REVIEW: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  TREATMENT: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  FOLLOW_UP: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
  COMPLETED: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  CANCELLED: 'bg-slate-600/40 text-slate-300 border-slate-500/40',
  LEFT_WITHOUT_SEEN: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
};

export const statusLabel = (s: VisitStatus) => STATUS_LABEL[s] ?? s;

export const PRIORITY_BADGE: Record<number, string> = {
  1: 'bg-rose-600/30 text-rose-200 border-rose-500/50',
  2: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  3: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  4: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  5: 'bg-slate-600/40 text-slate-300 border-slate-500/40',
};

export type VisitOutcome =
  | 'DISCHARGED'
  | 'ADMITTED'
  | 'REFERRED'
  | 'CLOSED_BY_STAFF'
  | 'CANCELLED'
  | 'LEFT_WITHOUT_SEEN';

export interface VisitSummary {
  id: string;
  patientId: string;
  status: VisitStatus;
  statusLabel: string;
  chiefComplaint: string | null;
  priority: number | null;
  arrivedAt: string;
  triagedAt: string | null;
  consultationStartedAt: string | null;
  completedAt: string | null;
  primaryDoctorName: string | null;
  outcome: VisitOutcome | null;
  closeReason: string | null;
  waitMinutes: number | null;
}

export interface VisitTimelineEntry {
  fromStatus: VisitStatus | null;
  toStatus: VisitStatus;
  actorName: string | null;
  actorRole: string | null;
  note: string | null;
  at: string;
}

export interface TransitionOption {
  from: VisitStatus;
  to: VisitStatus;
  roles: string[];
  auto?: boolean;
  noteRequired?: boolean;
}

export interface VisitDetail {
  visit: VisitSummary;
  patient: { id: string; name: string };
  timeline: VisitTimelineEntry[];
  allowedTransitions: TransitionOption[];
}

export type PatientStage =
  'ALL' | 'ACTIVE' | 'WAITING' | 'FINISHED' | 'NO_VISIT';
export const STAGE_TABS: { id: PatientStage; label: string }[] = [
  { id: 'ACTIVE', label: 'Active' },
  { id: 'WAITING', label: 'Waiting' },
  { id: 'FINISHED', label: 'Finished' },
  { id: 'ALL', label: 'All' },
];

/** Button label for a transition target. Completing/reopening get action wording; others use the status label. */
export const transitionLabel = (t: TransitionOption) =>
  t.from === 'COMPLETED'
    ? 'Reopen visit'
    : t.to === 'COMPLETED'
      ? 'Complete visit'
      : t.to === 'CANCELLED'
        ? 'Cancel visit'
        : t.to === 'LEFT_WITHOUT_SEEN'
          ? 'Left without being seen'
          : `Move to: ${STATUS_LABEL[t.to]}`;

/** Sort key for "who needs attention first": lower = earlier. Priority 1 is most urgent; unknown priority sorts last. */
export const byUrgency = (a: VisitSummary | null, b: VisitSummary | null) =>
  (a?.priority ?? 9) - (b?.priority ?? 9) ||
  (b?.waitMinutes ?? 0) - (a?.waitMinutes ?? 0);
