import { reconcileActionClaims, proposalsFromTrace } from './guardrails';
import { ToolTrace } from './tools/tool-registry';
import { classifyIntent } from './routing/intent';
import { renderReferralReview } from './routing/referral-view';

const trace = (
  calls: Array<{ name: string; ok: boolean; output?: any; error?: string }>,
) => {
  const t = new ToolTrace();
  for (const c of calls)
    t.record(
      { name: c.name, args: {}, success: c.ok, error: c.error },
      c.output ?? { success: c.ok },
    );
  return t;
};
const proposal = {
  success: true,
  actionId: 'ACT1',
  proposalType: 'REFERRAL',
  tier: 'ASK',
  summary: 'Referral proposal to Cardiology for patient P1 (Urgency: URGENT)',
  proposedAction: { patientId: 'P1' },
};

describe('the agent never claims an action that did not happen', () => {
  it('replaces "I have referred" when the attempt was refused', () => {
    const t = trace([
      { name: 'proposeReferral', ok: false, error: 'Refused: not the patient' },
    ]);
    const r = reconcileActionClaims(
      'Done! I have referred the patient to Cardiology.',
      t,
    );
    expect(r.text).toMatch(/No action was taken/);
    expect(r.text).toMatch(/Refused/);
    expect(r.notes[0]).toMatch(/claimed/);
  });
  it('replaces the claim when no tool was called at all', () => {
    const r = reconcileActionClaims(
      'The referral has been created and the specialist notified.',
      trace([]),
    );
    expect(r.text).toMatch(/No action was taken/);
  });
  it('turns a "done" claim into "waiting for approval" when a proposal was saved', () => {
    const t = trace([{ name: 'proposeReferral', ok: true, output: proposal }]);
    const r = reconcileActionClaims('I have referred James to cardiology.', t);
    expect(r.text).toMatch(/nothing has been done yet/);
    expect(r.text).toContain('ACT1');
  });
  it('appends the pending proposal when the model words it honestly', () => {
    const t = trace([{ name: 'proposeReferral', ok: true, output: proposal }]);
    const r = reconcileActionClaims('I prepared a referral for approval.', t);
    expect(r.text).toContain('waiting for your approval');
    expect(proposalsFromTrace(t)).toHaveLength(1);
  });
  it('leaves a real direct write alone', () => {
    const t = trace([{ name: 'bookAppointment', ok: true }]);
    expect(
      reconcileActionClaims('I have booked the appointment.', t).text,
    ).toBe('I have booked the appointment.');
  });
  it('does not touch ordinary answers', () => {
    expect(
      reconcileActionClaims('The patient has hypertension.', trace([])).text,
    ).toBe('The patient has hypertension.');
  });
});

describe('routing of referral requests', () => {
  it('asking to refer needs the tool agent (write), not the grounded model', () => {
    expect(classifyIntent('refer James Miller to the cardiologist').write).toBe(
      true,
    );
    expect(classifyIntent('generate follow-up plan for P1004').write).toBe(
      true,
    );
  });
  it('asking whether a specialist is needed is a review, not a write', () => {
    const i = classifyIntent(
      'Review patient P1004 and tell me if a specialist is required',
    );
    expect(i.review).toBe(true);
    expect(i.write).toBe(false);
  });
});

describe('referral review rendering', () => {
  it('shows verdict, evidence, missing info and the approval path', () => {
    const text = renderReferralReview('James Miller (P1004)', {
      recommendation: 'SPECIALIST',
      specialty: 'Cardiology',
      urgency: 'EMERGENCY',
      rationale: ['Triggered by rule CARD_RULE_01'],
      evidence: [
        { field: 'Troponin T', value: '0.85 ng/mL', source: 'Lab results' },
      ],
      missingInfo: ['ECG'],
      verification: { verified: true, unverifiedEvidence: [] },
    });
    expect(text).toContain('refer to Cardiology (emergency)');
    expect(text).toContain('Troponin T: 0.85 ng/mL');
    expect(text).toContain('Missing information: ECG');
    expect(text).toContain('Nothing is created until you approve');
  });
  it('says plainly when no referral is indicated', () => {
    expect(
      renderReferralReview('X (P1)', { recommendation: 'NONE', rationale: [] }),
    ).toMatch(/no specialist referral is indicated/);
  });
});
