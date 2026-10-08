import type { VisitEntity } from '../../database/entities/visit.entity';
import {
  STATUS_LABEL,
  VisitOutcome,
  VisitStatus,
  isWaitingStatus,
} from './visit-status';

/** The shape of a visit in API responses, UIs and agent context (dates are ISO strings). */
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
  /** Minutes since arrival while the patient is still in the waiting room; otherwise null. */
  waitMinutes: number | null;
}

const iso = (d: Date | string | null | undefined) =>
  d ? new Date(d).toISOString() : null;

export function toVisitSummary(
  v: VisitEntity,
  now: number = Date.now(),
): VisitSummary {
  return {
    id: v.id,
    patientId: v.patientId,
    status: v.status,
    statusLabel: STATUS_LABEL[v.status],
    chiefComplaint: v.chiefComplaint,
    priority: v.priority,
    arrivedAt: new Date(v.arrivedAt).toISOString(),
    triagedAt: iso(v.triagedAt),
    consultationStartedAt: iso(v.consultationStartedAt),
    completedAt: iso(v.completedAt),
    primaryDoctorName: v.primaryDoctorName,
    outcome: v.outcome,
    closeReason: v.closeReason,
    waitMinutes: isWaitingStatus(v.status)
      ? Math.max(
          0,
          Math.floor((now - new Date(v.arrivedAt).getTime()) / 60_000),
        )
      : null,
  };
}
