import { z } from 'zod';

/**
 * What a question MEANS, as data. Everything downstream (which data to fetch, which handler answers, whether to ask
 * back) is decided from this object, never from the raw wording. L1 (deterministic parser) fills it in; L2 (a
 * tool-free model call, only when L1 is unsure) may fill it in too; both are validated against this one schema.
 */
export const INTENTS = [
  'COUNT', //            how many / is there any ...
  'LIST', //             who are / list / which ...
  'LOOKUP', //           facts about something that exists (a patient's labs, a chart)
  'POLICY_QUERY', //     hospital rules, SOPs, guidelines
  'CLINICAL_REVIEW', //  is a specialist needed? review this patient
  'CLINICAL_QUESTION', // reasoning about care (drug safety, interactions)
  'CALCULATE', //        scores from numbers in the message (NEWS2)
  'ACTION', //           change something (book, refer, register ...)
  'CONFIRM', //          yes / go ahead (about a pending proposal)
  'DECLINE', //          no / cancel / don't (about a pending proposal)
  'SMALLTALK',
  'UNKNOWN',
] as const;
export type Intent = (typeof INTENTS)[number];

export const ENTITIES = [
  'PATIENT',
  'APPOINTMENT',
  'TASK',
  'LAB',
  'VITALS',
  'MEDICATION',
  'ALLERGY',
  'CONDITION',
  'IMAGING',
  'VISIT',
  'QUEUE',
  'SPECIALIST',
  'STAFF',
  'REFERRAL',
  'POLICY',
  'OTHER', //             something named that the system does not hold (beds, ambulances)
  'NONE',
] as const;
export type Entity = (typeof ENTITIES)[number];

export const SCOPES = [
  'HOSPITAL',
  'PATIENT',
  'SPECIALTY',
  'ROLE',
  'QUEUE',
] as const;
export type Scope = (typeof SCOPES)[number];

export const METRICS = [
  'patients',
  'waiting',
  'withDoctor',
  'completedToday',
  'criticalLabs',
  'tasks',
  'appointments',
] as const;
export type OverviewMetric = (typeof METRICS)[number];

export const QueryPlanSchema = z.object({
  intent: z.enum(INTENTS),
  entity: z.enum(ENTITIES),
  scope: z.enum(SCOPES),
  filters: z
    .object({
      specialty: z.string().max(60).optional(),
      role: z.string().max(40).optional(),
      availability: z.boolean().optional(),
      date: z.enum(['TODAY', 'TOMORROW', 'THIS_WEEK']).optional(),
      metrics: z.array(z.enum(METRICS)).optional(),
      sections: z.array(z.string().max(30)).max(10).optional(),
      docType: z.enum(['policy', 'sop', 'guideline']).optional(),
      /** "who has waited longest": the waiting list ordered by wait, longest first. */
      rank: z.enum(['LONGEST_WAIT']).optional(),
      /** "which patients have chest pain": a search across patient records, not a list. */
      search: z.boolean().optional(),
      /** A drug safety / dosing question (needs the safety tool), as opposed to a lookup of what is charted. */
      safety: z.boolean().optional(),
    })
    .default({}),
  patientRef: z
    .object({
      kind: z.enum(['ID', 'NAME', 'PRONOUN', 'NONE']),
      value: z.string().max(80).optional(),
    })
    .default({ kind: 'NONE' }),
  /** The thing counted/asked about when it is not something the system holds. */
  noun: z.string().max(60).optional(),
  confidence: z.number().min(0).max(1),
  alternatives: z
    .array(
      z.object({
        intent: z.enum(INTENTS),
        entity: z.enum(ENTITIES),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(4)
    .default([]),
  source: z.enum(['L1', 'L2']).default('L1'),
  evidence: z.array(z.string().max(120)).max(8).default([]),
});
export type QueryPlan = z.infer<typeof QueryPlanSchema>;

/** Confidence needed to act on a plan without asking or trying the model. */
export const CONFIDENT = () => Number(process.env.ROUTE_CONFIDENT ?? 0.75);
/** Below this even the model's plan is not trusted: ask the user (or fall back to the agent). */
export const MINIMUM = () => Number(process.env.ROUTE_MINIMUM ?? 0.5);

export const emptyPlan = (): QueryPlan => ({
  intent: 'UNKNOWN',
  entity: 'NONE',
  scope: 'HOSPITAL',
  filters: {},
  patientRef: { kind: 'NONE' },
  confidence: 0,
  alternatives: [],
  source: 'L1',
  evidence: [],
});

/** What the system already knows about WHO the question names (checked against the real patient and staff lists). */
export interface Hints {
  /** A patient or staff member was recognised by name in the message. */
  person?: 'PATIENT' | 'STAFF' | 'AMBIGUOUS' | 'NONE';
}

/** The vocabulary that comes from the data, not from the code (specialties on offer, staff roles). */
export interface Vocabulary {
  specialties: string[];
}
