import {
  canApproveAction,
  canProposeAction,
  getActionTier,
  renderActionSummary,
} from './action-policy';
import { checkGuardrails } from '../guardrails';
import { ToolTrace } from '../tools/tool-registry';

describe('W6 Approval Layer & Actions Policy', () => {
  describe('Autonomy Policy & Action Catalogue', () => {
    it('returns correct autonomy tiers for actions', () => {
      expect(getActionTier('COMPUTE_NEWS2')).toBe('AUTO');
      expect(getActionTier('REFERRAL')).toBe('ASK');
      expect(getActionTier('REGISTER_PATIENT')).toBe('ASK');
      expect(getActionTier('CONSULTATION')).toBe('ASK_HUMAN');
      expect(getActionTier('DELETE_PATIENT')).toBe('NEVER');
    });

    it('enforces role authorization on proposals', () => {
      expect(canProposeAction('REGISTER_PATIENT', 'RECEPTIONIST')).toBe(true);
      expect(canProposeAction('REGISTER_PATIENT', 'NURSE')).toBe(false);
      expect(canProposeAction('DELETE_PATIENT', 'ADMIN')).toBe(false); // NEVER tier
      expect(canProposeAction('CONSULTATION', 'DOCTOR')).toBe(true);
    });

    it('enforces role authorization on approvals', () => {
      expect(canApproveAction('REFERRAL', 'DOCTOR')).toBe(true);
      expect(canApproveAction('CONSULTATION', 'RECEPTIONIST')).toBe(false);
      expect(canApproveAction('DELETE_PATIENT', 'ADMIN')).toBe(false);
    });

    it('renders deterministic summary text from payload fields', () => {
      const regSummary = renderActionSummary('REGISTER_PATIENT', {
        name: 'Jane Doe',
        age: 38,
        gender: 'female',
        phone: '555-0199',
      });
      expect(regSummary).toContain('Register new patient "Jane Doe"');
      expect(regSummary).toContain('38 y/o');

      const refSummary = renderActionSummary('REFERRAL', {
        patientId: 'P1001',
        specialty: 'Cardiology',
        urgency: 'URGENT',
      });
      expect(refSummary).toContain('Referral proposal to Cardiology for patient P1001');
    });
  });

  describe('False Completion Claim Guardrail', () => {
    it('flags warning if response text claims completion without an executed action', () => {
      const trace = new ToolTrace();
      const res = checkGuardrails(
        'The patient has been registered successfully.',
        trace,
        'Register patient John',
        0, // 0 executed actions
      );

      expect(res.status).toBe('WARNING');
      expect(res.notes.some((n) => n.includes('Completion claim detected'))).toBe(true);
    });

    it('passes verified safe if matching action was executed this turn', () => {
      const trace = new ToolTrace();
      const res = checkGuardrails(
        'The patient has been registered successfully.',
        trace,
        'Register patient John',
        1, // 1 executed action
      );

      expect(res.status).toBe('VERIFIED_SAFE');
    });
  });
});
