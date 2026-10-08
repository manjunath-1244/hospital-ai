import { ReferralRulesService } from '../hospital/referrals/referral-rules.service';
import { ReferralVerifierService } from '../hospital/referrals/referral-verifier.service';

describe('W12 Agent Evaluation Suite & Safety Controls', () => {
  let referralRules: ReferralRulesService;
  let referralVerifier: ReferralVerifierService;

  beforeEach(() => {
    referralRules = new ReferralRulesService();
    referralVerifier = new ReferralVerifierService();
  });

  describe('Referral Rule Evaluation Scenarios', () => {
    it('Triggers Cardiology referral for acute chest pain with Troponin elevation', () => {
      const visit = {
        patientId: 'P1001',
        chiefComplaint: 'Severe chest pain radiating to left arm',
        vitals: [{ heartRate: 110, bpSystolic: 160, spO2: 95, news2Score: 6 }],
        conditions: ['Hypertension'],
        labs: [
          {
            testName: 'Troponin T',
            value: '0.8',
            unit: 'ng/mL',
            status: 'CRITICAL',
          },
        ],
      };

      const result = referralRules.evaluate(visit);

      expect(result.triggered).toBe(true);
      const specialties = result.matches.map((m) => m.specialty);
      expect(specialties).toContain('Cardiology');
      expect(result.matches.length).toBeGreaterThan(0);
    });

    it('Triggers Neurology referral for sudden onset headache with focal weakness', () => {
      const visit = {
        patientId: 'P1002',
        chiefComplaint: 'Sudden thunderclap headache and right-sided weakness',
        vitals: [{ heartRate: 90, bpSystolic: 180, spO2: 97, news2Score: 5 }],
        conditions: [],
        labs: [],
      };

      const result = referralRules.evaluate(visit);

      expect(result.triggered).toBe(true);
      const specialties = result.matches.map((m) => m.specialty);
      expect(specialties).toContain('Neurology');
    });

    it('Does NOT trigger Cardiology referral for historical CAD when current visit is non-cardiac with normal vitals', () => {
      const visit = {
        patientId: 'P1003',
        chiefComplaint: 'Ankle sprain after stepping off curb',
        vitals: [{ heartRate: 70, bpSystolic: 118, spO2: 99, news2Score: 0 }],
        conditions: ['Hypertension', 'History of CAD 2018'],
        labs: [
          {
            testName: 'Troponin T',
            value: '0.01',
            unit: 'ng/mL',
            status: 'NORMAL',
          },
        ],
      };

      const result = referralRules.evaluate(visit);

      const specialties = result.matches.map((m) => m.specialty);
      expect(specialties).not.toContain('Cardiology');
      expect(result.matches.length).toBe(0);
      expect(result.historicalOnlyCandidates.length).toBeGreaterThan(0);
    });
  });

  describe('Evidence Verification', () => {
    it('Verifies valid evidence present in patient context', () => {
      const context = {
        patientId: 'P1001',
        chiefComplaint: 'Chest pain',
        vitals: [{ news2Score: 6, heartRate: 115, bpSystolic: 130 }],
        labs: [
          {
            testName: 'Troponin T',
            value: '0.8',
            unit: 'ng/mL',
            status: 'CRITICAL',
          },
        ],
      };

      const recommendation = {
        recommendation: 'SPECIALIST' as const,
        specialty: 'Cardiology' as const,
        urgency: 'EMERGENCY' as const,
        rationale: ['Troponin elevation'],
        evidence: [{ field: 'Troponin T', value: '0.8', source: 'Labs' }],
        missingInfo: [],
        confidence: 0.95,
      };

      const verified = referralVerifier.verify(recommendation, context);

      expect(verified.verification.verified).toBe(true);
      expect(verified.verification.unverifiedEvidence.length).toBe(0);
    });

    it('Downgrades recommendation when evidence is unverified / fabricated', () => {
      const context = {
        patientId: 'P1001',
        chiefComplaint: 'Routine checkup',
        vitals: [{ news2Score: 0, heartRate: 72, bpSystolic: 120 }],
        labs: [],
      };

      const recommendation = {
        recommendation: 'SPECIALIST' as const,
        specialty: 'Cardiology' as const,
        urgency: 'EMERGENCY' as const,
        rationale: ['Troponin elevation'],
        evidence: [{ field: 'Troponin T', value: '5.0', source: 'Labs' }], // missing from context!
        missingInfo: [],
        confidence: 0.95,
      };

      const verified = referralVerifier.verify(recommendation, context);

      expect(verified.verification.verified).toBe(false);
      expect(verified.recommendation).toBe('NEEDS_DOCTOR_REVIEW');
    });
  });
});
