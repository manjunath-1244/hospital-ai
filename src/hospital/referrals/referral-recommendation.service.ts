import { Injectable, Logger } from '@nestjs/common';
import { HospitalService } from '../hospital.service';
import { ClinicalRecordsService } from '../clinical-records.service';
import { VisitsService } from '../visits/visits.service';
import {
  ReferralRulesService,
  ClinicalContextInput,
} from './referral-rules.service';
import { ReferralVerifierService } from './referral-verifier.service';
import { VectorRagService } from '../../ai/rag/vector-rag.service';
import { ReferralRecommendation } from './referral.types';

@Injectable()
export class ReferralRecommendationService {
  private readonly logger = new Logger(ReferralRecommendationService.name);

  constructor(
    private readonly hospital: HospitalService,
    private readonly records: ClinicalRecordsService,
    private readonly visits: VisitsService,
    private readonly rules: ReferralRulesService,
    private readonly verifier: ReferralVerifierService,
    private readonly rag: VectorRagService,
  ) {}

  /**
   * Generates a structured referral recommendation for a patient based on current visit context.
   * Performs 0 database writes. Returns a proposal object if specialist referral is recommended.
   */
  async evaluatePatient(patientId: string): Promise<ReferralRecommendation> {
    const patient = await this.hospital.getPatientById(patientId);
    const recentVisits = await this.visits.listForPatient(patientId, 3);
    const currentVisit = recentVisits.length > 0 ? recentVisits[0] : null;

    const vitals = await this.records.listVitals(patientId, 5);
    const labs = await this.hospital.getPatientLabs(patientId);
    const consultations = await this.records.listConsultations(patientId, 5);

    const ctxInput: ClinicalContextInput = {
      patientId: patient.id,
      visitId: currentVisit?.id ?? null,
      chiefComplaint: currentVisit?.chiefComplaint ?? null,
      vitals: vitals.map((v) => ({
        recordedAt:
          v.recordedAt instanceof Date
            ? v.recordedAt.toISOString()
            : String(v.recordedAt),
        heartRate: v.heartRate,
        bpSystolic: v.bpSystolic,
        bpDiastolic: null,
        spO2: v.spO2,
        tempCelsius: v.tempCelsius,
        respiratoryRate: v.respiratoryRate,
        consciousness: v.consciousness,
        news2Score: v.news2Score,
        riskLevel: v.riskLevel,
      })),
      labs: labs.map((l) => ({
        testName: l.testName,
        value: l.value,
        unit: l.unit,
        status: l.status,
        referenceRange: l.referenceRange,
      })),
      consultations: consultations.map((c) => ({
        diagnosis: c.diagnosis,
        notes: c.notes,
        prescriptions: c.prescriptions,
      })),
      conditions: patient.conditions,
      allergies: patient.allergies,
      currentMedications: patient.currentMedications,
    };

    // 1. Deterministic Rule Evaluation
    const ruleResult = this.rules.evaluate(ctxInput);

    if (!ruleResult.triggered) {
      const rationale: string[] = [
        'No acute clinical criteria met for specialist referral on current visit data.',
      ];
      if (ruleResult.historicalOnlyCandidates.length > 0) {
        rationale.push(
          `Historical background noted (${ruleResult.historicalOnlyCandidates.join(
            '; ',
          )}), but no acute indications present on current visit.`,
        );
      }

      return {
        recommendation: 'NONE',
        specialty: null,
        urgency: null,
        rationale,
        evidence: [],
        missingInfo: ruleResult.missingInfo,
        confidence: 0.95,
        verification: { verified: true, unverifiedEvidence: [] },
        proposal: null,
      };
    }

    // Pick top rule match
    const primaryMatch = ruleResult.matches[0];

    // 2. Fetch guideline RAG evidence citations
    let guidelineCitations: string[] = [];
    try {
      const hits = await this.rag.searchPolicies(
        `${primaryMatch.specialty} referral SOP guidelines`,
        2,
        { docTypes: ['guideline'] },
      );
      guidelineCitations = hits.map(
        (h) => `Guideline (${h.source}): ${h.heading}`,
      );
    } catch (err: any) {
      this.logger.warn(
        `Failed to retrieve guideline citations: ${err.message}`,
      );
    }

    const unverifiedRec = {
      recommendation: 'SPECIALIST' as const,
      specialty: primaryMatch.specialty,
      urgency: primaryMatch.urgency,
      rationale: [
        `Triggered by rule ${primaryMatch.ruleId}: ${primaryMatch.description}`,
        ...guidelineCitations,
      ],
      evidence: primaryMatch.matchedFacts,
      missingInfo: ruleResult.missingInfo,
      confidence: 0.92,
    };

    // 3. Evidence Verification
    return this.verifier.verify(unverifiedRec, ctxInput);
  }
}
