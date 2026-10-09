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

const TONE = {
  neutral: 'bg-surface-muted text-ink-2 border-line-strong',
  brand: 'bg-brand-50 text-brand-700 border-brand-200',
  info: 'bg-info-50 text-info-700 border-info-200',
  success: 'bg-success-50 text-success-700 border-success-200',
  warning: 'bg-warning-50 text-warning-700 border-warning-200',
  danger: 'bg-danger-50 text-danger-700 border-danger-200',
} as const;

export const STATUS_BADGE: Record<VisitStatus, string> = {
  WAITING_TRIAGE: TONE.warning,
  TRIAGED: TONE.warning,
  IN_CONSULTATION: TONE.brand,
  UNDER_REVIEW: TONE.info,
  TREATMENT: TONE.info,
  FOLLOW_UP: TONE.info,
  COMPLETED: TONE.success,
  CANCELLED: TONE.neutral,
  LEFT_WITHOUT_SEEN: TONE.danger,
};

export const statusLabel = (s: VisitStatus) => STATUS_LABEL[s] ?? s;

export const PRIORITY_BADGE: Record<number, string> = {
  1: TONE.danger,
  2: TONE.danger,
  3: TONE.warning,
  4: TONE.success,
  5: TONE.neutral,
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
