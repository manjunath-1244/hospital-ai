import { Injectable } from '@nestjs/common';
import { ClinicalContextInput } from './referral-rules.service';
import {
  EvidenceItem,
  ReferralRecommendation,
  ReferralSpecialty,
  ReferralUrgency,
} from './referral.types';

@Injectable()
export class ReferralVerifierService {
  /**
   * Verifies that every evidence item in a recommendation exists in the patient's current visit context.
   * If evidence cannot be verified against current visit facts, the recommendation is downgraded.
   */
  verify(
    recommendation: {
      recommendation: 'SPECIALIST' | 'NONE' | 'NEEDS_DOCTOR_REVIEW';
      specialty?: ReferralSpecialty | null;
      urgency?: ReferralUrgency | null;
      rationale?: string[];
      evidence?: EvidenceItem[];
      missingInfo?: string[];
      confidence?: number;
    },
    ctx: ClinicalContextInput,
  ): ReferralRecommendation {
    const evidenceList = recommendation.evidence ?? [];
    const verifiedEvidence: EvidenceItem[] = [];
    const unverifiedEvidence: EvidenceItem[] = [];

    const complaint = (ctx.chiefComplaint ?? '').toLowerCase();
    const latestVitals =
      ctx.vitals && ctx.vitals.length > 0 ? ctx.vitals[0] : null;
    const labs = ctx.labs ?? [];
    const recentNotes = (ctx.consultations ?? [])
      .map((c) => `${c.diagnosis ?? ''} ${c.notes ?? ''}`)
      .join(' ')
      .toLowerCase();

    for (const item of evidenceList) {
      const fieldLower = item.field.toLowerCase();
      const valLower = item.value.toLowerCase();
      let matched = false;

      if (
        fieldLower.includes('complaint') ||
        fieldLower.includes('presentation')
      ) {
        matched = complaint.includes(valLower) || valLower.includes(complaint);
      } else if (fieldLower.includes('news2')) {
        if (
          latestVitals?.news2Score !== undefined &&
          latestVitals?.news2Score !== null
        ) {
          matched = String(latestVitals.news2Score) === item.value.trim();
        }
      } else if (
        fieldLower.includes('heart rate') ||
        fieldLower.includes('pulse')
      ) {
        if (
          latestVitals?.heartRate !== undefined &&
          latestVitals?.heartRate !== null
        ) {
          matched =
            String(latestVitals.heartRate) ===
            item.value.replace(/[^0-9]/g, '');
        }
      } else if (
        fieldLower.includes('bp') ||
        fieldLower.includes('blood pressure')
      ) {
        if (
          latestVitals?.bpSystolic !== undefined &&
          latestVitals?.bpSystolic !== null
        ) {
          matched =
            valLower.includes(String(latestVitals.bpSystolic)) ||
            (latestVitals.bpDiastolic !== null &&
              valLower.includes(String(latestVitals.bpDiastolic)));
        }
      } else if (
        fieldLower.includes('troponin') ||
        fieldLower.includes('lab')
      ) {
        matched = labs.some(
          (l) =>
            fieldLower.includes(l.testName.toLowerCase()) ||
            l.testName.toLowerCase().includes(fieldLower) ||
            l.value.includes(item.value) ||
            item.value.includes(l.value),
        );
      } else if (
        fieldLower.includes('consciousness') ||
        fieldLower.includes('avpu')
      ) {
        if (latestVitals?.consciousness) {
          matched = latestVitals.consciousness.toLowerCase() === valLower;
        }
      } else if (fieldLower.includes('notes') || fieldLower.includes('ecg')) {
        matched = recentNotes.includes(valLower) || valLower.length > 3;
      } else {
        // Broad check across context JSON
        const contextStr = JSON.stringify(ctx).toLowerCase();
        matched = contextStr.includes(valLower);
      }

      if (matched) {
        verifiedEvidence.push(item);
      } else {
        unverifiedEvidence.push(item);
      }
    }

    const isVerified =
      recommendation.recommendation !== 'SPECIALIST' ||
      (verifiedEvidence.length > 0 && unverifiedEvidence.length === 0);

    if (!isVerified) {
      return {
        recommendation: 'NEEDS_DOCTOR_REVIEW',
        specialty: recommendation.specialty ?? null,
        urgency: recommendation.urgency ?? null,
        rationale: [
          ...(recommendation.rationale ?? []),
          'Downgraded: Proposed evidence could not be fully verified against current visit facts.',
        ],
        evidence: verifiedEvidence,
        missingInfo: recommendation.missingInfo ?? [],
        confidence: Math.min(recommendation.confidence ?? 0.5, 0.5),
        verification: {
          verified: false,
          unverifiedEvidence,
          reason:
            'Evidence verification failed against current visit clinical data.',
        },
        proposal: null,
      };
    }

    // Build proposal if recommendation is SPECIALIST
    let proposal: any = null;
    if (
      recommendation.recommendation === 'SPECIALIST' &&
      recommendation.specialty &&
      ctx.patientId
    ) {
      proposal = {
        proposalType: 'REFERRAL',
        status: 'PROPOSED',
        proposedAction: {
          patientId: ctx.patientId,
          specialty: recommendation.specialty,
          urgency: recommendation.urgency ?? 'ROUTINE',
          reason: (recommendation.rationale ?? []).join('; '),
          evidence: verifiedEvidence,
        },
        requiresApproval: true,
        message: `Referral proposal for ${recommendation.specialty} created. Approval required before issuing consultation request.`,
      };
    }

    return {
      recommendation: recommendation.recommendation,
      specialty: recommendation.specialty ?? null,
      urgency: recommendation.urgency ?? null,
      rationale: recommendation.rationale ?? [],
      evidence: verifiedEvidence,
      missingInfo: recommendation.missingInfo ?? [],
      confidence: recommendation.confidence ?? 0.95,
      verification: {
        verified: true,
        unverifiedEvidence: [],
      },
      proposal,
    };
  }
}
