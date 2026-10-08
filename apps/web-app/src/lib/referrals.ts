/** Mirrors src/database/entities/consultation-request.entity.ts and the referral/specialist services. */
export type ReferralStatus = 'REQUESTED' | 'ACCEPTED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type ReferralUrgency = 'EMERGENCY' | 'URGENT' | 'ROUTINE';

export interface Referral {
  id: string;
  visitId: string;
  patientId: string;
  requestedById: string;
  requestedByName: string;
  specialty: string;
  assignedSpecialistId?: string | null;
  assignedSpecialistName?: string | null;
  urgency: ReferralUrgency;
  reason: string;
  aiRationale?: string | null;
  evidence?: unknown;
  status: ReferralStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  cancellationReason?: string | null;
}

export const REFERRAL_URGENCIES: readonly ReferralUrgency[] = ['ROUTINE', 'URGENT', 'EMERGENCY'];
/** Lower = more urgent (same ordering as the backend's specialist inbox). */
export const URGENCY_RANK: Record<ReferralUrgency, number> = { EMERGENCY: 1, URGENT: 2, ROUTINE: 3 };
export const URGENCY_BADGE: Record<ReferralUrgency, string> = {
  EMERGENCY: 'bg-rose-600/30 text-rose-200 border-rose-500/50',
  URGENT: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  ROUTINE: 'bg-slate-600/40 text-slate-300 border-slate-500/40',
};

export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  REQUESTED: 'Requested',
  ACCEPTED: 'Accepted',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};
export const REFERRAL_STATUS_BADGE: Record<ReferralStatus, string> = {
  REQUESTED: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  ACCEPTED: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
  IN_PROGRESS: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  COMPLETED: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  CANCELLED: 'bg-slate-600/40 text-slate-300 border-slate-500/40',
};
export const OPEN_REFERRAL_STATUSES: readonly ReferralStatus[] = ['REQUESTED', 'ACCEPTED', 'IN_PROGRESS'];
export const isOpenReferral = (r: Pick<Referral, 'status'>) => OPEN_REFERRAL_STATUSES.includes(r.status);

/** Open referrals first, then most urgent, then oldest first. */
export const byReferralUrgency = (a: Referral, b: Referral) =>
  Number(isOpenReferral(b)) - Number(isOpenReferral(a)) ||
  (URGENCY_RANK[a.urgency] ?? 9) - (URGENCY_RANK[b.urgency] ?? 9) ||
  new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

export const ageLabel = (iso: string, now = Date.now()) => {
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (Number.isNaN(m)) return '—';
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
};

/** GET /hospital/patients/:id/referral-recommendation */
export interface EvidenceItem { field: string; value: string; source: string }
export interface ReferralRecommendation {
  recommendation: 'SPECIALIST' | 'NONE' | 'NEEDS_DOCTOR_REVIEW';
  specialty: string | null;
  urgency: ReferralUrgency | null;
  rationale: string[];
  evidence: EvidenceItem[];
  missingInfo: string[];
  confidence: number;
  verification: { verified: boolean; unverifiedEvidence: EvidenceItem[]; reason?: string };
  proposal: unknown | null;
}

/** GET /hospital/referrals/:id/ai-summary (the `summary` field). */
export interface AiReferralSummary {
  referralId: string;
  patientId: string;
  visitId: string;
  specialty: string;
  urgency: string;
  reason: string;
  aiRationale?: string;
  evidence?: unknown[];
  keyClinicalFindings: {
    recentVitals?: Record<string, unknown>;
    abnormalLabs?: { test: string; value: string | number; unit: string; status: string }[];
    currentMedications?: string[];
    conditions?: string[];
  };
  guidelinesCited: { title: string; filename: string }[];
  generatedAt: string;
}

/** POST /hospital/referrals/:id/complete body (CompleteConsultationDto). */
export interface CompleteConsultationPayload {
  assessment: string;
  recommendation: string;
  treatment: string;
  followUp: string;
  followUpTests?: string[];
  followUpDays?: number;
}

export const evidenceText = (e: unknown): string => {
  if (e == null) return '';
  if (typeof e === 'string') return e;
  if (typeof e === 'object') {
    const o = e as Partial<EvidenceItem>;
    if (o.field) return `${o.field}: ${o.value ?? ''}${o.source ? ` (${o.source})` : ''}`;
    return JSON.stringify(e);
  }
  return String(e);
};
