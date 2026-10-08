import { ReferralRulesService } from './referral-rules.service';
import { ReferralVerifierService } from './referral-verifier.service';

describe('W5 Referral Recommendation & Evidence Check', () => {
  let rulesService: ReferralRulesService;
  let verifierService: ReferralVerifierService;

  beforeEach(() => {
    rulesService = new ReferralRulesService();
    verifierService = new ReferralVerifierService();
  });

  describe('ReferralRulesService (Deterministic Layer)', () => {
    it('triggers Cardiology referral for acute chest pain and elevated troponin', () => {
      const res = rulesService.evaluate({
        patientId: 'P1001',
        chiefComplaint: 'Substernal chest pain and shortness of breath',
        vitals: [
          {
            heartRate: 110,
            bpSystolic: 130,
            spO2: 95,
            news2Score: 6,
            consciousness: 'ALERT',
          },
        ],
        labs: [
          {
            testName: 'Serum Cardiac Troponin I',
            value: '0.45',
            unit: 'ng/mL',
            status: 'HIGH',
          },
        ],
      });

      expect(res.triggered).toBe(true);
      expect(res.matches.some((m) => m.specialty === 'Cardiology')).toBe(true);
      expect(res.matches.some((m) => m.ruleId === 'CARD_RULE_01')).toBe(true);
      expect(res.matches.some((m) => m.ruleId === 'CARD_RULE_02')).toBe(true);
    });

    it('triggers Neurology referral for severe headache and altered consciousness', () => {
      const res = rulesService.evaluate({
        patientId: 'P1002',
        chiefComplaint: 'Sudden severe thunderclap headache',
        vitals: [
          {
            heartRate: 90,
            bpSystolic: 185,
            bpDiastolic: 115,
            consciousness: 'CONFUSION',
            news2Score: 5,
          },
        ],
      });

      expect(res.triggered).toBe(true);
      expect(res.matches.some((m) => m.specialty === 'Neurology')).toBe(true);
      expect(res.matches.some((m) => m.ruleId === 'NEURO_RULE_02')).toBe(true);
      expect(res.matches.some((m) => m.ruleId === 'NEURO_RULE_03')).toBe(true);
    });

    it('does NOT trigger a referral for benign symptoms', () => {
      const res = rulesService.evaluate({
        patientId: 'P1003',
        chiefComplaint: 'Mild skin rash on left arm',
        vitals: [
          {
            heartRate: 72,
            bpSystolic: 118,
            news2Score: 0,
            consciousness: 'ALERT',
          },
        ],
        labs: [],
      });

      expect(res.triggered).toBe(false);
      expect(res.matches).toHaveLength(0);
    });

    it('does NOT trigger referral based on historical cardiac condition alone', () => {
      const res = rulesService.evaluate({
        patientId: 'P1004',
        chiefComplaint: 'Left knee sprain after playing soccer',
        vitals: [
          {
            heartRate: 75,
            bpSystolic: 122,
            news2Score: 0,
            consciousness: 'ALERT',
          },
        ],
        conditions: [
          'Past Coronary Artery Disease (CAD) with stent in 2021',
          'Essential Hypertension',
        ],
      });

      expect(res.triggered).toBe(false);
      expect(res.matches).toHaveLength(0);
      expect(
        res.historicalOnlyCandidates.some((c) =>
          c.includes('Past cardiac history'),
        ),
      ).toBe(true);
    });
  });

  describe('ReferralVerifierService (Evidence Verifier)', () => {
    it('verifies valid evidence matching current visit context', () => {
      const ctx = {
        patientId: 'P1001',
        chiefComplaint: 'Acute chest pain',
        vitals: [
          {
            heartRate: 115,
            bpSystolic: 135,
            news2Score: 6,
            consciousness: 'ALERT',
          },
        ],
        labs: [{ testName: 'Troponin I', value: '0.50', unit: 'ng/mL' }],
      };

      const verified = verifierService.verify(
        {
          recommendation: 'SPECIALIST',
          specialty: 'Cardiology',
          urgency: 'EMERGENCY',
          rationale: ['Troponin elevated', 'Chest pain reported'],
          evidence: [
            {
              field: 'Chief Complaint',
              value: 'Acute chest pain',
              source: 'Current Visit Presentation',
            },
            { field: 'NEWS2', value: '6', source: 'Current Vitals' },
          ],
        },
        ctx,
      );

      expect(verified.recommendation).toBe('SPECIALIST');
      expect(verified.verification.verified).toBe(true);
      expect(verified.proposal).not.toBeNull();
      expect(verified.proposal.proposalType).toBe('REFERRAL');
    });

    it('downgrades recommendation when proposed evidence is hallucinated/unverified', () => {
      const ctx = {
        patientId: 'P1001',
        chiefComplaint: 'Mild sore throat',
        vitals: [
          {
            heartRate: 70,
            bpSystolic: 120,
            news2Score: 0,
            consciousness: 'ALERT',
          },
        ],
        labs: [],
      };

      const verified = verifierService.verify(
        {
          recommendation: 'SPECIALIST',
          specialty: 'Cardiology',
          urgency: 'EMERGENCY',
          rationale: ['Fake troponin alert'],
          evidence: [
            {
              field: 'Troponin',
              value: '5.2 ng/mL',
              source: 'Non-existent lab',
            },
          ],
        },
        ctx,
      );

      expect(verified.recommendation).toBe('NEEDS_DOCTOR_REVIEW');
      expect(verified.verification.verified).toBe(false);
      expect(verified.proposal).toBeNull();
    });
  });

  describe('End-to-End Referral Pipeline (Rules + Verifier)', () => {
    it('evaluates chest pain patient through rules and verifier to generate referral proposal', () => {
      const ctx = {
        patientId: 'P1001',
        chiefComplaint: 'Substernal chest tightness',
        vitals: [
          {
            heartRate: 105,
            bpSystolic: 140,
            news2Score: 6,
            consciousness: 'ALERT',
          },
        ],
        labs: [
          {
            testName: 'Serum Cardiac Troponin I',
            value: '0.48',
            unit: 'ng/mL',
            status: 'CRITICAL',
          },
        ],
      };

      const ruleRes = rulesService.evaluate(ctx);
      expect(ruleRes.triggered).toBe(true);

      const topMatch = ruleRes.matches[0];
      const rec = verifierService.verify(
        {
          recommendation: 'SPECIALIST',
          specialty: topMatch.specialty,
          urgency: topMatch.urgency,
          rationale: [`Triggered by rule ${topMatch.ruleId}`],
          evidence: topMatch.matchedFacts,
        },
        ctx,
      );

      expect(rec.recommendation).toBe('SPECIALIST');
      expect(rec.specialty).toBe('Cardiology');
      expect(rec.verification.verified).toBe(true);
      expect(rec.proposal).not.toBeNull();
      expect(rec.proposal.proposedAction.specialty).toBe('Cardiology');
    });
  });
});
