/**
 * The vocabulary of a hospital visit (one episode of care). Everything that needs "what stage is this patient at?"
 * uses these constants; no other file spells a status as a string literal.
 */
export const VISIT_STATUSES = [
  'WAITING_TRIAGE', // registered, waiting for the nurse
  'TRIAGED', // vitals taken, waiting for the doctor
  'IN_CONSULTATION', // with the doctor
  'UNDER_REVIEW', // doctor is waiting for results / another opinion
  'TREATMENT',
  'FOLLOW_UP',
  'COMPLETED',
  'CANCELLED',
  'LEFT_WITHOUT_SEEN',
] as const;

export type VisitStatus = (typeof VISIT_STATUSES)[number];

/** A visit that is still open: clinical records can be added to it. At most one per patient. */
export const ACTIVE_STATUSES: readonly VisitStatus[] = [
  'WAITING_TRIAGE',
  'TRIAGED',
  'IN_CONSULTATION',
  'UNDER_REVIEW',
  'TREATMENT',
  'FOLLOW_UP',
];

/** Finished visits (history). */
export const FINAL_STATUSES: readonly VisitStatus[] = [
  'COMPLETED',
  'CANCELLED',
  'LEFT_WITHOUT_SEEN',
];

/** Patient has not yet been seen by a doctor: these are the "waiting room" stages. */
export const WAITING_STATUSES: readonly VisitStatus[] = [
  'WAITING_TRIAGE',
  'TRIAGED',
];

export const isActiveStatus = (s: VisitStatus): boolean =>
  ACTIVE_STATUSES.includes(s);
export const isFinalStatus = (s: VisitStatus): boolean =>
  FINAL_STATUSES.includes(s);
export const isWaitingStatus = (s: VisitStatus): boolean =>
  WAITING_STATUSES.includes(s);
export const isVisitStatus = (s: unknown): s is VisitStatus =>
  typeof s === 'string' && (VISIT_STATUSES as readonly string[]).includes(s);

/** Human wording for UIs, notifications and agent answers. */
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

/** How the outcome of a finished visit is recorded. */
export const VISIT_OUTCOMES = [
  'DISCHARGED',
  'ADMITTED',
  'REFERRED',
  'CLOSED_BY_STAFF',
  'CANCELLED',
  'LEFT_WITHOUT_SEEN',
] as const;
export type VisitOutcome = (typeof VISIT_OUTCOMES)[number];
