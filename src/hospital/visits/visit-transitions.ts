import type { UserRole } from '../../security/roles.decorator';
import type { VisitStatus } from './visit-status';

/**
 * THE workflow, as data. A status change is allowed only if a rule below matches (from → to) AND the actor's role is
 * listed. `VisitsService.transition()` is the only code that changes a status and it consults this table, so the
 * whole lifecycle can be read, reviewed with a clinician and tested from this one file.
 *
 *  - `auto`: normally triggered by a workflow step (triage, first consultation…), not by a manual button.
 *  - `noteRequired`: the actor must explain (cancellations, reopening).
 */
export interface TransitionRule {
  from: VisitStatus;
  to: VisitStatus;
  roles: UserRole[];
  auto?: boolean;
  noteRequired?: boolean;
}

const CLINICAL: UserRole[] = ['DOCTOR', 'ADMIN'];
const FRONT: UserRole[] = ['RECEPTIONIST', 'NURSE', 'ADMIN'];

export const TRANSITIONS: readonly TransitionRule[] = [
  // --- waiting room ---
  {
    from: 'WAITING_TRIAGE',
    to: 'TRIAGED',
    roles: ['NURSE', 'DOCTOR', 'ADMIN'],
    auto: true,
  }, // recording triage vitals
  {
    from: 'WAITING_TRIAGE',
    to: 'IN_CONSULTATION',
    roles: CLINICAL,
    auto: true,
  }, // doctor sees an urgent patient first
  { from: 'TRIAGED', to: 'IN_CONSULTATION', roles: CLINICAL, auto: true }, // first consultation recorded
  { from: 'WAITING_TRIAGE', to: 'CANCELLED', roles: FRONT, noteRequired: true },
  { from: 'TRIAGED', to: 'CANCELLED', roles: FRONT, noteRequired: true },
  {
    from: 'WAITING_TRIAGE',
    to: 'LEFT_WITHOUT_SEEN',
    roles: FRONT,
    noteRequired: true,
  },
  {
    from: 'TRIAGED',
    to: 'LEFT_WITHOUT_SEEN',
    roles: FRONT,
    noteRequired: true,
  },

  // --- with the doctor ---
  { from: 'IN_CONSULTATION', to: 'UNDER_REVIEW', roles: CLINICAL },
  { from: 'IN_CONSULTATION', to: 'TREATMENT', roles: CLINICAL },
  { from: 'IN_CONSULTATION', to: 'FOLLOW_UP', roles: CLINICAL },
  { from: 'IN_CONSULTATION', to: 'COMPLETED', roles: CLINICAL },
  { from: 'UNDER_REVIEW', to: 'IN_CONSULTATION', roles: CLINICAL },
  { from: 'UNDER_REVIEW', to: 'TREATMENT', roles: CLINICAL },
  { from: 'UNDER_REVIEW', to: 'FOLLOW_UP', roles: CLINICAL },
  { from: 'UNDER_REVIEW', to: 'COMPLETED', roles: CLINICAL },
  { from: 'TREATMENT', to: 'UNDER_REVIEW', roles: CLINICAL },
  { from: 'TREATMENT', to: 'FOLLOW_UP', roles: CLINICAL },
  { from: 'TREATMENT', to: 'COMPLETED', roles: CLINICAL },
  { from: 'FOLLOW_UP', to: 'IN_CONSULTATION', roles: CLINICAL },
  { from: 'FOLLOW_UP', to: 'COMPLETED', roles: CLINICAL },

  // --- staff may close any open visit administratively (replaces the old "close session") ---
  {
    from: 'IN_CONSULTATION',
    to: 'CANCELLED',
    roles: ['ADMIN'],
    noteRequired: true,
  },

  // --- reopening a finished visit (rare; must be explained) ---
  {
    from: 'COMPLETED',
    to: 'IN_CONSULTATION',
    roles: CLINICAL,
    noteRequired: true,
  },
];

export function findTransition(
  from: VisitStatus,
  to: VisitStatus,
): TransitionRule | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

export type TransitionCheck =
  | { ok: true; rule: TransitionRule }
  | { ok: false; kind: 'ILLEGAL' | 'ROLE' | 'NOTE'; message: string };

/** Full verdict on a requested transition (the kind lets the API choose 409 / 403 / 400). */
export function checkTransition(
  from: VisitStatus,
  to: VisitStatus,
  role: UserRole,
  note?: string,
): TransitionCheck {
  const rule = findTransition(from, to);
  if (!rule)
    return {
      ok: false,
      kind: 'ILLEGAL',
      message: `A visit cannot go from ${from} to ${to}.`,
    };
  if (!rule.roles.includes(role))
    return {
      ok: false,
      kind: 'ROLE',
      message: `Role ${role} may not move a visit from ${from} to ${to}.`,
    };
  if (rule.noteRequired && !note?.trim())
    return {
      ok: false,
      kind: 'NOTE',
      message: `A reason is required to move a visit from ${from} to ${to}.`,
    };
  return { ok: true, rule };
}

/** Why a transition is refused, or `null` if it is allowed. */
export function transitionError(
  from: VisitStatus,
  to: VisitStatus,
  role: UserRole,
  note?: string,
): string | null {
  const verdict = checkTransition(from, to, role, note);
  return verdict.ok ? null : verdict.message;
}

/** Transitions a role may perform manually from a status (drives the buttons the UI offers). */
export function manualTransitionsFor(
  from: VisitStatus,
  role: UserRole,
): TransitionRule[] {
  return TRANSITIONS.filter(
    (t) => t.from === from && !t.auto && t.roles.includes(role),
  );
}
