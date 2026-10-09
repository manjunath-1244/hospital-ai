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
  it('no tool writes directly any more, so a "booked" claim without a proposal is corrected', () => {
    const t = trace([{ name: 'getPatientSummary', ok: true }]);
    expect(
      reconcileActionClaims('I have booked the appointment.', t).text,
    ).toMatch(/No action was taken/);
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

describe('"give details" is a lookup, not a medication question', () => {
  it('only drug-giving phrasing counts as medication', () => {
    expect(classifyIntent('give details about James Miller').medication).toBe(
      false,
    );
    expect(classifyIntent('what did the doctor give him?').medication).toBe(
      false, // a chart lookup (what is recorded), not a safety question
    );
    expect(classifyIntent('is it safe to give her aspirin').medication).toBe(
      true,
    );
  });
});

describe('questions about specialists are not hospital-overview questions', () => {
  it('routes them to the staff data', () => {
    for (const q of [
      'how many specialists are there',
      'who are the cardiologists',
      'list the specialists',
    ]) {
      const i = classifyIntent(q);
      expect([q, i.specialists, i.overview]).toEqual([q, true, false]);
    }
  });
  it('leaves patient counts and referral requests alone', () => {
    expect(classifyIntent('how many patients are waiting').overview).toBe(true);
    expect(classifyIntent('how many patients are waiting').specialists).toBe(
      false,
    );
    expect(classifyIntent('refer him to a specialist').specialists).toBe(false);
    expect(
      classifyIntent('is a specialist required for P1002').specialists,
    ).toBe(false);
  });
});

import { appendClosestPassage } from './guardrails';

describe('a "not in the data" answer never leaves the user empty-handed', () => {
  const traceWith = (matches: any[]) => {
    const t = new ToolTrace();
    t.record(
      { name: 'searchHospitalPolicies', args: {}, success: true },
      { success: true, matches },
    );
    return t;
  };
  const passage = {
    file: 'appointment-policy.md',
    heading: '2. Cancellations & Rescheduling',
    text: '- Appointments cancelled with less than 24 hours notice require supervisory clearance.',
    similarity: 0.62,
  };
  it("shows the passage that shares the question's words", () => {
    const out = appendClosestPassage(
      'That is not in the data I retrieved.',
      traceWith([passage]),
      "Does cancelling an appointment with 12 hours notice need anyone's approval?",
    );
    expect(out).toContain('supervisory clearance');
    expect(out).toContain('appointment-policy.md');
  });
  it('shows nothing when no retrieved passage is related', () => {
    const unrelated = {
      ...passage,
      text: '- Visitors must sign in at the front desk.',
      heading: 'Visitors',
      similarity: 0.5,
    };
    expect(
      appendClosestPassage(
        'That is not in the data I retrieved.',
        traceWith([unrelated]),
        'staff parking fees',
      ),
    ).toBe('That is not in the data I retrieved.');
  });
  it('leaves a real answer alone', () => {
    expect(
      appendClosestPassage(
        'Routine follow-ups need 48 hours.',
        traceWith([passage]),
        'follow-up booking',
      ),
    ).toBe('Routine follow-ups need 48 hours.');
  });
});

describe('a claimed proposal must exist', () => {
  it('"prepared for your approval" without a saved proposal is replaced, with the refusal reason', () => {
    const t = trace([]);
    t.calls.push({
      name: 'proposeNotification',
      args: {},
      success: false,
      error: 'No staff in "NURSE" to notify.',
    });
    const r = reconcileActionClaims('Prepared for your approval.', t);
    expect(r.text).toMatch(/No proposal was created/);
    expect(r.text).toContain('No staff in "NURSE" to notify.');
  });
  it('a real saved proposal is untouched by this rule', () => {
    const t = trace([
      {
        name: 'proposeReferral',
        ok: true,
        output: {
          success: true,
          actionId: 'ACT1',
          proposalType: 'REFERRAL',
          summary: 'Referral',
          tier: 'ASK',
          status: 'PENDING_APPROVAL',
        },
      },
    ]);
    expect(
      reconcileActionClaims('I prepared a referral for approval.', t).text,
    ).toContain('waiting for your approval');
  });
});

describe('plain and passive "done" claims', () => {
  it('"I have done it for you" without an action is corrected', () => {
    expect(
      reconcileActionClaims('I have done it for you.', trace([])).text,
    ).toMatch(/No action was taken/);
  });
  it('"Your role was changed" is corrected only when a change was requested', () => {
    expect(
      reconcileActionClaims('Your role was changed.', trace([]), {
        actionRequested: true,
      }).text,
    ).toMatch(/No action was taken/);
    expect(
      reconcileActionClaims('The record was updated on 5 Oct.', trace([])).text,
    ).toBe('The record was updated on 5 Oct.');
  });
  it('first-person deletion claims are always corrected', () => {
    expect(
      reconcileActionClaims('I deleted the record.', trace([])).text,
    ).toMatch(/No action was taken/);
  });
});
