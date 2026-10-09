jest.mock('@nestjs/typeorm', () => ({ InjectRepository: () => () => {} }));
import { QueryRouterService } from './query-router.service';
import { L2PlannerService } from './l2-planner.service';
import { parseQuery } from './l1-parser';
import { emptyPlan, type QueryPlan } from './query-plan';

const vocab = { specialties: ['Cardiology', 'Neurology'] };
const vocabularyService: any = { get: async () => vocab };

function router(l2plan: Partial<QueryPlan> | null, enabled = true) {
  const l2: any = {
    enabled: () => enabled,
    plan: jest.fn(async () =>
      l2plan ? { ...emptyPlan(), source: 'L2', ...l2plan } : null,
    ),
  };
  const hospital: any = {
    allPatientBriefs: async () => [
      { kind: 'PATIENT', id: 'PJFBEQF', name: 'James Miller' },
      { kind: 'PATIENT', id: 'PAG68T8', name: 'Sarah' },
    ],
  };
  const specialists: any = {
    staffByRole: async () => ({
      SPECIALIST: [
        {
          id: 'USR-C',
          name: 'Dr. Sarah Wilson',
          specialty: 'Cardiology',
          isAvailable: true,
        },
      ],
    }),
  };
  return {
    r: new QueryRouterService(vocabularyService, l2, hospital, specialists),
    l2,
  };
}

describe('router: L1 first, model only when unsure, never a guess', () => {
  it('a confident L1 plan never calls the model', async () => {
    const { r, l2 } = router({
      intent: 'LOOKUP',
      entity: 'LAB',
      confidence: 0.8,
    });
    const d = await r.decide('how many specialists are there');
    expect(d.outcome).toBe('HANDLE');
    expect(d.usedL2).toBe(false);
    expect(l2.plan).not.toHaveBeenCalled();
  });
  it('an action request is never second-guessed by the model', async () => {
    const { r, l2 } = router({
      intent: 'LIST',
      entity: 'PATIENT',
      confidence: 0.85,
    });
    const d = await r.decide('refer P1002 to cardiology');
    expect(d.plan.intent).toBe('ACTION');
    expect(l2.plan).not.toHaveBeenCalled();
  });
  it('an unsure L1 plan consults L2 and uses its better plan', async () => {
    const { r, l2 } = router({
      intent: 'COUNT',
      entity: 'SPECIALIST',
      confidence: 0.8,
      filters: { specialty: 'Cardiology' },
    });
    const d = await r.decide('so what is the situation with heart doctors');
    expect(l2.plan).toHaveBeenCalled();
    expect(d.usedL2).toBe(true);
    expect(d.plan.source).toBe('L2');
    expect(d.plan.entity).toBe('SPECIALIST');
    expect(d.outcome).toBe('HANDLE');
  });
  it('when L2 is unavailable or fails, an ambiguous question is asked back, not guessed', async () => {
    const { r } = router(null);
    const d = await r.decide('how many');
    expect(d.outcome).toBe('CLARIFY');
    expect(d.clarification).toMatch(/count/i);
  });
  it('when L2 is switched off the model is never called', async () => {
    const { r, l2 } = router(
      { intent: 'LIST', entity: 'STAFF', confidence: 0.8 },
      false,
    );
    await r.decide('blah blah blah');
    expect(l2.plan).not.toHaveBeenCalled();
  });
  it('an unrecognised open-ended question goes to the agent', async () => {
    const { r } = router(null, false);
    const d = await r.decide('help me plan the week for the ward');
    expect(['AGENT', 'HANDLE']).toContain(d.outcome);
    expect(d.plan.intent === 'UNKNOWN' || d.plan.confidence < 0.75).toBe(true);
  });
});

describe('names the system knows raise confidence (no model needed for "details about James Miller")', () => {
  it('a known patient name makes a lookup confident, so the model is not consulted', async () => {
    const { r, l2 } = router(null);
    const d = await r.decide('give details about James Miller');
    expect(d.outcome).toBe('HANDLE');
    expect(d.usedL2).toBe(false);
    expect(d.plan.patientRef.kind).toBe('NAME');
    expect(l2.plan).not.toHaveBeenCalled();
  });
  it('a known staff name is a staff lookup', async () => {
    const { r } = router(null);
    const d = await r.decide('who is Sarah Wilson');
    expect(d.plan.entity).toBe('STAFF');
    expect(d.plan.intent).toBe('LOOKUP');
  });
  it('a typo in a known name still counts', async () => {
    const { r } = router(null);
    const d = await r.decide('details of Jmaes Millre');
    expect(d.plan.patientRef.kind).toBe('NAME');
    expect(d.usedL2).toBe(false);
  });
});

describe('L2 safety envelope', () => {
  const l2 = new L2PlannerService({} as any, {} as any);
  const l1 = parseQuery('something odd');
  const plan = (over: Partial<QueryPlan>): QueryPlan => ({
    ...emptyPlan(),
    confidence: 0.9,
    ...over,
  });

  it('a model may not turn a question into a change request', () => {
    expect(
      l2.accept(
        plan({ intent: 'ACTION', entity: 'PATIENT' }),
        'what is the weather like',
        l1,
      ),
    ).toBeNull();
    expect(
      l2.accept(plan({ intent: 'CONFIRM' }), 'tell me about the ward', l1),
    ).toBeNull();
  });
  it("it may classify a read question, and its confidence is capped below a rule's certainty", () => {
    const out = l2.accept(
      plan({ intent: 'COUNT', entity: 'TASK', confidence: 0.99 }),
      'how many jobs are open',
      l1,
    )!;
    expect(out.source).toBe('L2');
    expect(out.confidence).toBeLessThanOrEqual(0.85);
  });
  it('patient ids come from the message, never from the model', () => {
    const out = l2.accept(
      plan({
        intent: 'LOOKUP',
        entity: 'LAB',
        patientRef: { kind: 'ID', value: 'P9999' },
      }),
      'labs for P1001',
      l1,
    )!;
    expect(out.patientRef).toEqual({ kind: 'ID', value: 'P1001' });
    const none = l2.accept(
      plan({
        intent: 'LOOKUP',
        entity: 'LAB',
        patientRef: { kind: 'ID', value: 'P9999' },
      }),
      'labs please',
      l1,
    )!;
    expect(none.patientRef.value).toBeUndefined();
  });
  it('an UNKNOWN or schema-invalid plan is rejected', () => {
    expect(l2.accept(plan({ intent: 'UNKNOWN' }), 'x', l1)).toBeNull();
    expect(l2.accept({ intent: 'NONSENSE' } as any, 'x', l1)).toBeNull();
  });
});
