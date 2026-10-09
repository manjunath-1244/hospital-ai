import { CONFIDENT, MINIMUM, type Entity, type QueryPlan } from './query-plan';

const PHRASE: Partial<Record<Entity, string>> = {
  PATIENT: 'the number or list of patients',
  APPOINTMENT: 'appointments',
  TASK: 'staff tasks',
  LAB: 'lab results',
  VITALS: 'vital signs',
  MEDICATION: 'medications',
  ALLERGY: 'allergies',
  CONDITION: 'conditions',
  IMAGING: 'imaging',
  VISIT: 'visits',
  QUEUE: 'the waiting room',
  SPECIALIST: 'the specialists',
  STAFF: 'the staff (doctors, nurses...)',
  REFERRAL: 'referrals',
  POLICY: 'a hospital policy or guideline',
};

/** The question to ask back, built from the readings the parser actually found (never invented options). */
export function clarificationFor(plan: QueryPlan): string | null {
  const options = [
    { intent: plan.intent, entity: plan.entity },
    ...plan.alternatives,
  ]
    .filter(
      (o) => o.entity !== 'NONE' && o.entity !== 'OTHER' && PHRASE[o.entity],
    )
    .map((o) => PHRASE[o.entity]!)
    .filter((p, i, all) => all.indexOf(p) === i)
    .slice(0, 4);
  if (plan.intent === 'COUNT' && options.length < 2)
    return 'What would you like me to count: patients waiting, appointments, tasks, doctors, specialists, or something else?';
  if (options.length >= 2)
    return `I want to answer the right question. Do you mean ${options.slice(0, -1).join(', ')} or ${options[options.length - 1]}?`;
  return null;
}

export type RouteOutcome = 'HANDLE' | 'CLARIFY' | 'AGENT';

/** The decision rule, as a pure function: confident -> handle; unsure but we know the options -> ask; unsure with no options -> agent (or handle above the minimum). */
export function decidePlan(plan: QueryPlan): {
  outcome: RouteOutcome;
  clarification?: string;
} {
  if (
    plan.confidence >= CONFIDENT() ||
    ['ACTION', 'CONFIRM', 'DECLINE'].includes(plan.intent)
  ) {
    // an action with nothing to act on is an unfinished request: ask what is meant
    if (
      plan.intent === 'ACTION' &&
      plan.entity === 'NONE' &&
      plan.confidence < CONFIDENT()
    )
      return {
        outcome: 'CLARIFY',
        clarification: 'What would you like me to do, and for which patient?',
      };
    return { outcome: 'HANDLE' };
  }
  const ask = clarificationFor(plan);
  if (plan.confidence >= MINIMUM() && !ask) return { outcome: 'HANDLE' };
  if (ask) return { outcome: 'CLARIFY', clarification: ask };
  // "list", "what is the": too little to act on, and a model would only guess
  if (plan.evidence.some((e) => e.startsWith('short fragment')))
    return {
      outcome: 'CLARIFY',
      clarification:
        'I did not catch what you need. Ask about a patient (name or ID), the waiting room, appointments, specialists or hospital policies, or tell me what to prepare for approval.',
    };
  return { outcome: 'AGENT' };
}
